-- الأوردر اليدوي من الشات بيدخل **مؤكد** — طلب المالك 19 سبتمبر
--
-- السبب زي ما قاله بالحرف: «العميل أصلاً طالبه واتساب بنفسه وأكّد معانا
-- بالفعل على الواتساب». والقياس على الحي بيأيّده: **كل الـ9 أوردرات
-- اليدوية** أول سطر في `status_log` بتاعها `pending → confirmed` بإيد
-- موظف، والفرق بين الإنشاء والتأكيد **من 5 لـ13 ثانية** في التسعة.
-- يعني الضغطة دي زايدة 9 من 9.
--
-- ⚠️ الرقم ده من `status_log->0->>'at'` **مش** من `status_changed_at`:
-- في 7 من الـ9 صفوف `status_changed_at` بيبقى التحويل **اللاحق** لشركة
-- الشحن (لحد 24 دقيقة بعد الإنشاء) مش التأكيد. قياس أولي مني استخدم
-- العمود الغلط وطلّع «6 ثواني في اتنين» — والصح أقوى.
--
-- ═══════════════════════════════════════════════════════════════════
-- 🔴 ليه مش مجرد `'confirmed'` في الـINSERT؟ — اتقاس، مش اتفترض
-- ═══════════════════════════════════════════════════════════════════
-- `charge_order_on_status_change` (BEFORE INSERT OR UPDATE OF status)
-- أول بند فيها صريح:
--     IF TG_OP = 'INSERT' AND is_billable_status(NEW.status) THEN RETURN NEW;
-- و`confirmed` **حالة محاسَبة**. فالإدخال المباشر بـ'confirmed' معناه
-- أوردر **مجاني** — ومش وقتها بس: `billed_at` بيفضل NULL، والبند التالت
-- بيعدّي أي تحويل بعد كده لأن `OLD` كانت محاسَبة أصلاً. يعني **مجاني
-- للأبد**.
--
-- اتقاس في ترانزاكشن راجعة بضابط (19 سبتمبر) على متجر حقيقي:
--
--   | المسار                      | billed_at | العدّاد | معاملات المحفظة |
--   |-----------------------------|-----------|--------|------------------|
--   | INSERT مباشر 'confirmed'    | false     | +0     | 0                |
--   | ...وبعد التحويل لـbosta     | لسه false | +0     | 0                |
--   | INSERT 'pending' ثم UPDATE  | **true**  | **+1** | **1**            |
--
-- عشان كده الحالة بتتحوّل بـ**UPDATE جوّه نفس الترانزاكشن**: الخصم
-- بيولّع على التحويل بالظبط زي ما بيحصل النهاردة لما الموظف يدوس «مؤكد»
-- بإيده. القرار المحسوم «الخصم على التحويل مش على الإدخال» **محفوظ
-- بالحرف** — اللي اتشال هو ضغطة الموظف مش الخصم.
--
-- ⚠️ والقرار المحسوم التاني («الفورم ماتسيبش الموظف يختار الحالة») برضه
-- محفوظ: الحالة **عمرها ما بتيجي من المتصفح** — لا كباراميتر ولا غيره.
-- الدالة هي اللي بتقررها، وفيه فحص في `test-wa-neworder.mjs` ومعايرة
-- بتحقن `p_status` في الحمولة وبتتأكد إن الفحص بيقع.
--
-- ═══════════════════════════════════════════════════════════════════
-- شكل سطر السجل
-- ═══════════════════════════════════════════════════════════════════
-- مطابق لـ`set_order_status` **بالحرف** (`from`/`to`/`at`/`by`/`reason`
-- بنفس `to_char`) — نفس ما عمل `mark_shipped_manual`. ده مش تزويق:
--   * `detail.js` بترسم «قيد الانتظار ← مؤكد · 👤 <الموظف>» من الشكل ده.
--   * `tg_log_status_change` بتقرا **آخر مدخل** وبتقارن `to` بالحالة
--     الجديدة — فبشكل مطابق التلجرام اللي بيوصل المالك هو **نفس** اللي
--     بيوصله النهاردة («👤 <الموظف> أكّد الأوردر ✅»)، لأن الاسم موظف
--     عادي مش مصدر آلي. صفر تغيير في الإشعارات.
-- و`by` = `user_profiles.full_name` بتاع اللي عمل الأوردر — **مش**
-- «واتساب»: اللي أكّد فعلياً في السيستم هو الموظف، وإن العميل طلب على
-- الواتساب مسجّل أصلاً في `platform='whatsapp'` و`order_uid='W-n'`.
-- نسبة مخترعة أسوأ من نسبة صادقة.

CREATE OR REPLACE FUNCTION public.create_manual_order(
  p_customer_name  text,
  p_phone          text,
  p_city           text,
  p_address        text,
  p_product_name   text,
  p_total_cost     numeric,
  p_alt_phone      text DEFAULT NULL,
  p_customer_notes text DEFAULT NULL,
  p_var            text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app' AS $fn$
DECLARE
  v_tenant  uuid;
  v_uid     uuid := auth.uid();
  v_wa      text;
  v_phone   text;
  v_alt     text;
  v_n       bigint;
  v_uid_txt text;
  v_dupe    uuid;
  v_id      uuid;
  v_by      text;
  v_status  text;
BEGIN
  -- موظف نشط في متجر — الدالة definer فالحارس ده هو الوحيد
  v_tenant := app.current_tenant_id();
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  IF btrim(coalesce(p_customer_name,'')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_name');
  END IF;
  IF btrim(coalesce(p_product_name,'')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_product');
  END IF;
  IF p_total_cost IS NULL OR p_total_cost < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_total');
  END IF;

  -- 🔴 التليفون بيتطبّع بـ**نفس** دالة تريجر المحادثات (`wa_id_from_phone`)
  -- وبيتخزن بالشكل المحلي `01xxxxxxxxx`. رقم الدالة مش فاهماه = **رفض**
  -- مش تخزين كما هو: رقم مش مفهوم يبقى أوردر مالوش محادثة ومايتشحنش.
  v_wa := app.wa_id_from_phone(p_phone);
  IF v_wa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_phone');
  END IF;
  v_phone := '0' || substr(v_wa, 3);

  IF btrim(coalesce(p_alt_phone,'')) <> '' THEN
    v_alt := app.wa_id_from_phone(p_alt_phone);
    IF v_alt IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_alt_phone');
    END IF;
    v_alt := '0' || substr(v_alt, 3);
  END IF;

  -- نفس عتبة `order-ship` بالحرف (عنوان < 10 حروف)
  IF length(btrim(coalesce(p_address,''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'short_address');
  END IF;

  -- ضغطتين = أوردرين. نفس مدة cooldown بتاعة `order-ship` و`wa-followup`.
  SELECT id INTO v_dupe FROM orders
   WHERE tenant_id = v_tenant AND phone = v_phone
     AND created_at > now() - interval '90 seconds'
   LIMIT 1;
  IF v_dupe IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate', 'order_id', v_dupe);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('manual_order:' || v_tenant::text));
  SELECT coalesce(max((substring(order_uid from '^W-([0-9]+)$'))::bigint), 0) + 1
    INTO v_n
    FROM orders
   WHERE tenant_id = v_tenant AND order_uid ~ '^W-[0-9]+$';
  v_uid_txt := 'W-' || v_n::text;

  -- الإدخال بيفضل `pending` — البوابة الوحيدة اللي بتخلّي التريجر يخصم
  INSERT INTO orders (
    tenant_id, order_uid, customer_name, phone, alt_phone, city, address,
    product_name, total_cost, status, payment_stage, platform, var,
    customer_notes, created_by, created_at, status_changed_at
  ) VALUES (
    v_tenant, v_uid_txt, btrim(p_customer_name), v_phone, v_alt,
    nullif(btrim(coalesce(p_city,'')),''), btrim(p_address),
    btrim(p_product_name), p_total_cost, 'pending', 'cod', 'whatsapp',
    nullif(btrim(coalesce(p_var,'')),''),
    nullif(btrim(coalesce(p_customer_notes,'')),''),
    v_uid, now(), now()
  ) RETURNING id INTO v_id;

  -- اسم الموظف للسجل. فشل القراءة **مايوقفش الإنشاء** — أوردر بسجل
  -- اسمه «موظف» أحسن من أوردر ماتسجّلش (نفس منطق `wa-send`).
  SELECT full_name INTO v_by FROM user_profiles WHERE id = v_uid;
  v_by := coalesce(nullif(btrim(coalesce(v_by,'')),''), 'موظف');

  UPDATE orders SET
    status            = 'confirmed',
    status_changed_at = now(),
    status_log        = coalesce(status_log, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'from',   'pending',
        'to',     'confirmed',
        'at',     to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'by',     v_by,
        'reason', NULL))
  WHERE id = v_id
  RETURNING status INTO v_status;

  -- 🔴 صفر فشل صامت: لو التحويل ماحصلش لأي سبب، الترانزاكشن كلها
  -- بترجع والموظف بيشوف رسالة فشل — بدل أوردر «قيد الانتظار» والتوست
  -- قال ✅ ومحدش خصم عليه. (عملياً مستحيل: نفس الترانزاكشن وبصلاحية
  -- definer، بس السكوت هنا كان هيبقى أغلى من أي حارس.)
  IF v_status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'manual_order_confirm_failed';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'order_id', v_id, 'order_uid', v_uid_txt, 'status', v_status);
END;
$fn$;

COMMENT ON FUNCTION public.create_manual_order(text,text,text,text,text,numeric,text,text,text) IS
  'أوردر يدوي من صندوق المحادثات. بيدخل pending وبيتحوّل confirmed في نفس الترانزاكشن عشان charge_order_on_status_change تخصم على التحويل — الإدخال المباشر بحالة محاسَبة بيعدّي من غير خصم للأبد. الحالة عمرها ما بتيجي من المتصفح.';
