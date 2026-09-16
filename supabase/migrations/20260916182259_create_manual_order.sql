-- «إنشاء طلب» يدوي من صندوق المحادثات — طلب المالك 16 سبتمبر
-- العميل بيطلب على الواتساب ويكتب بياناته، والموظف بيسجّل الأوردر في
-- السيستم زي أي أوردر جاي من اللاندنج.

-- مين عمل الأوردر. **مش FK** عن قصد (نفس `upsell_events.user_id`):
-- الأدمن بيحذف موظف والسجل لازم يفضل.
-- ⚠️ **مش محصّن ضد التزوير**: `orders` منحته لـauthenticated على مستوى
-- الجدول ومفيش أي منحة بالعمود (اتقاس على الحي)، يعني أي موظف يقدر
-- يعدّل العمود ده من الكونسول زي أي عمود تاني في `orders`. هو للمتابعة
-- مش للمحاسبة — نفس تصنيف `wa_followup_sent_at` بالظبط. قفله يحتاج
-- REVOKE على الجدول + GRANT بالـ56 عمود الشرعيين، وده خطر حقيقي على
-- أكتر جدول بيتكتب فيه في السيستم (درس 43).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS created_by uuid;
COMMENT ON COLUMN public.orders.created_by IS
  'الموظف اللي عمل الأوردر يدوي من الصندوق. للمتابعة مش للمحاسبة — قابل للتعديل من المتصفح زي أي عمود في orders.';

-- منصة جديدة: الأوردر اللي اتعمل من صندوق المحادثات. من غيرها التريجر
-- `normalize_order_platform` بيحوّلها `other` **في صمت** (اتقاس في
-- ترانزاكشن راجعة: أول محاولة طلعت `other` بالظبط) والتاجر مايعرفش كام
-- أوردر جه من الشات.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_platform_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_platform_check
  CHECK (platform = ANY (ARRAY['cod','fb','ig','paymob','shopify','easyorders','tiktok','threads','whatsapp','other']));

CREATE OR REPLACE FUNCTION public.normalize_order_platform()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
declare
  v text;
  m text;
begin
  if NEW.platform is null then
    return NEW;
  end if;
  v := lower(btrim(NEW.platform));
  -- ترجمة الاختصارات الشائعة لمصادر EasyOrders
  m := case v
         when 'th' then 'threads'
         when 'fb' then 'fb'
         when 'facebook' then 'fb'
         when 'ig' then 'ig'
         when 'instagram' then 'ig'
         when 'insta' then 'ig'
         when 'tt' then 'tiktok'
         when 'wa' then 'whatsapp'
         else v
       end;
  -- لو ضمن المسموح → استخدمها، غير كده → other (مايكسرش التسجيل أبداً)
  if m in ('cod','fb','ig','paymob','shopify','easyorders','tiktok','threads','whatsapp','other') then
    NEW.platform := m;
  else
    NEW.platform := 'other';
  end if;
  return NEW;
end;
$fn$;

-- 🔴 SECURITY DEFINER — انحراف مقصود ومبرر، نفس منطق `save_order_products`:
-- لو INVOKER، الموظف كان هيدخل الصف بنفسه ويحط `status` و`order_uid`
-- و`billed_at` بأي قيمة. والفرق مش شكلي:
--   * `charge_order_on_status_change` عندها بند صريح إن أوردر بيدخل
--     **لأول مرة** بحالة محاسَبة = **صفر خصم** (استيراد بوسطة). يعني فورم
--     بتسيب الموظف يختار «مؤكد» = باب مفتوح لأوردرات مجانية. هنا الحالة
--     متسمّرة `pending` والخصم بيحصل على التحويل — نفس القرار المحسوم.
--   * `order_uid` عليه UNIQUE(tenant_id, order_uid) وبييجي من اللاندنج
--     (`body.short_id` في نود `Insert Order to Supabase`). لو الأوردر
--     اليدوي أخد `max+1`، أول أوردر جاي من اللاندنج بنفس الرقم **هيقع في
--     n8n ويضيع في صمت** (النود عليها onError:continueErrorOutput).
--     فالترقيم في نطاق منفصل تماماً: `W-1` · `W-2` … (قرار المالك)
--     وبقفل advisory عشان ضغطتين في نفس اللحظة مايدّوش نفس الرقم.
-- و`tenant_id` من `app.current_tenant_id()` **مش من الباراميترات** — نفس
-- الثابت الحاكم في `tenant-staff` و`order-ship` و`wa-send` و`wa-followup`.
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
  -- وبيتخزن بالشكل المحلي `01xxxxxxxxx` — ده شكل 4,051 من 4,076 أوردر
  -- في الجدول (اتقاس). أي رقم الدالة دي مش فاهماه = **رفض** مش تخزين
  -- كما هو: رقم مش مفهوم يبقى أوردر مالوش محادثة ومايتشحنش.
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

  -- نفس عتبة `order-ship` بالحرف (عنوان < 10 حروف). الرفض هنا أرخص:
  -- هناك الأوردر بيبقى متسجّل ومايتشحنش والموظف يكتشف بعدين.
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

  RETURN jsonb_build_object('ok', true, 'order_id', v_id, 'order_uid', v_uid_txt);
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_manual_order(text,text,text,text,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_manual_order(text,text,text,text,text,numeric,text,text,text) TO authenticated, service_role;
