-- staff_orders_review_fixes — إصلاحات المراجعة العدائية لشغل 3 أكتوبر (أوردر يدوي · استبدال · ملاحظة البوليصة).
--
-- 1) create_staff_order:
--    · الاستبدال من أوردر **متسلّم** بس (exchange_not_delivered). قبل كده كان مسموح من أي حالة غير
--      pending/confirmed/cancelled: مرتجع (192 في 60 يوم) = التحصيل الافتراضي 0 والعميل ياخد المنتج
--      ببلاش · في السكة = بوليصتين شغّالين لنفس العميل ولو رفض الأصلي المندوب يحصّل الفرق بس.
--    · NaN/Infinity في السعر أو التحصيل كانوا بيعدّوا (`NaN < 0` = false) → total_cost = NaN بيبوّظ أي SUM
--      وJ&T تاخد itemsValue "0". سقف 1,000,000 للقطعة و10,000,000 للأوردر بيمسكهم.
--    · أسعار سطور الاستبدال مابقتش NULL لما التقريب مايطلعش بالمليم — الفرق على سطر كميته 1.
-- 2) save_order_products:
--    · أوردر الاستبدال مقفول على المنتجات والإجمالي (exchange_locked) + مالوش upsell.
--    · jt_ship_in_flight: الشحنة بتتعمل عند J&T دلوقتي = التعديل ممنوع (نفس 17532 من الناحية التانية).
-- 3) tg_log_status_change: رقم الأوردر الأصلي بيتقرا من نفس المتجر بس (الدالة DEFINER).
-- ⚠️ تريجر حارس على exchange_of (نفس المتجر · مش نفسه) اتشال من هنا: CREATE/DROP TRIGGER على orders
--    محتاج قفل بيستنى ورا ترافيك اللوحة (اتجرّب 3 أكتوبر 14:30 القاهرة — علّق). الأثر الوحيد للعمود
--    على المتجر التاني كان سطر التلجرام، واتقفل بفلتر tenant_id في (3).

create or replace function public.save_order_products(p_order_id uuid, p_product_name text, p_total_cost numeric default null::numeric, p_prices jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app'
as $function$
declare
  v_uid uuid := auth.uid(); v_p user_profiles; v_o orders;
  v_before numeric; v_after numeric; v_delta numeric; v_amt numeric; v_ev upsell_events;
  v_goods_changed boolean; v_mark boolean := false;
  v_old_lines text[]; v_new_lines text[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_p from user_profiles where id = v_uid;
  if not found or coalesce(v_p.active,false) is not true then raise exception 'no_profile'; end if;
  if v_p.tenant_id is null then raise exception 'no_tenant'; end if;
  if app.wallet_depleted() then raise exception 'wallet_depleted'; end if;

  select * into v_o from orders where id = p_order_id and tenant_id = v_p.tenant_id for update;
  if not found then raise exception 'order_not_found'; end if;

  v_before := coalesce(v_o.total_cost, 0);
  v_after  := case when p_total_cost is null then v_before else round(p_total_cost, 2) end;
  if v_after < 0 then raise exception 'negative_total'; end if;
  v_delta := round(v_after - v_before, 2);

  -- الفيصل بين «upsell» و«تصحيح سعر»: قايمة البضاعة نفسها (أسماء + كميات).
  -- سطور متطبّعة (قص الـ+ والمسافات) ومترتبة — إعادة الترتيب مش تغيير.
  select coalesce(array_agg(l order by l), '{}') into v_old_lines from (
    select regexp_replace(trim(x), '^\+\s*', '') as l
    from unnest(regexp_split_to_array(coalesce(v_o.product_name,''), E'\n')) x
  ) t where l <> '';
  select coalesce(array_agg(l order by l), '{}') into v_new_lines from (
    select regexp_replace(trim(x), '^\+\s*', '') as l
    from unnest(regexp_split_to_array(coalesce(p_product_name,''), E'\n')) x
  ) t where l <> '';
  v_goods_changed := v_old_lines is distinct from v_new_lines;

  -- 🔴 بوليصة J&T اتعملت = المبلغ والمنتجات اتبعتوا لـJ&T خلاص (itemsValue + remark).
  -- تغييرهم هنا لوحدهم = المندوب يحصّل رقم والسيستم يقول رقم تاني في صمت (17532).
  if v_o.shipping_carrier = 'jt'
     and nullif(trim(coalesce(v_o.tracking_no, '')), '') is not null
     and (v_goods_changed or v_after <> v_before)
     and not (not v_goods_changed and v_o.jt_cod_amount is not null and v_after = v_o.jt_cod_amount) then
    raise exception 'jt_waybill_locked';
  end if;

  -- (مراجعة 3 أكتوبر) الشحنة لسه بتتعمل عند J&T: jt-ship قرا المنتجات والمبلغ وبعتهم، ولسه مارجعش.
  -- jt-ship v7 بيمسح jt_ship_error لحظة المحاولة وبيكتبه لو فشلت — فـ«محاولة من أقل من دقيقة ومفيش
  -- خطأ ومفيش بوليصة» = في السكة لـJ&T. التعديل دلوقتي = نفس شكل 17532 من الناحية التانية.
  -- الدقيقة سقف أمان لو الدالة وقعت في النص (jt-ship نفسها مهلتها 25+15 ثانية).
  if nullif(trim(coalesce(v_o.tracking_no, '')), '') is null
     and v_o.jt_ship_attempted_at is not null and v_o.jt_ship_attempted_at > now() - interval '60 seconds'
     and v_o.jt_ship_error is null
     and (v_goods_changed or v_after <> v_before) then
    raise exception 'jt_ship_in_flight';
  end if;

  -- (مراجعة 3 أكتوبر) أوردر الاستبدال: الإجمالي = مبلغ التحصيل اللي الموظف كتبه (فرق سعر غالباً) وأسعار
  -- السطور توزيع ليه مش سعر قطعة — أي حفظة من المحرر كانت بترجّع الإجمالي لأسعار المخزون الكاملة
  -- وتسجّل upsell وهمي بالفرق. التغيير = إلغاء الاستبدال وتسجيله تاني من الأوردر الأصلي.
  if v_o.exchange_of is not null and (v_goods_changed or v_after <> v_before) then
    raise exception 'exchange_locked';
  end if;

  -- الشارة والعمولة للبضاعة المضافة بس — وأوردر الاستبدال مالوش upsell (مقفول فوق؛ هنا حزام تاني)
  v_mark := v_goods_changed and v_delta > 0 and v_o.exchange_of is null;

  update orders set product_name = p_product_name,
         total_cost = case when p_total_cost is null then total_cost else v_after end,
         line_prices = case when p_prices is null then line_prices else p_prices end,
         has_upsell = has_upsell or v_mark
   where id = p_order_id and tenant_id = v_p.tenant_id
  returning * into v_o;

  if v_mark
     and coalesce(v_p.upsell_commission_enabled,false)
     and v_p.upsell_commission_type is not null
     and coalesce(v_p.upsell_commission_value,0) > 0 then
    v_amt := case when v_p.upsell_commission_type = 'fixed'
                  then v_p.upsell_commission_value
                  else round(v_delta * v_p.upsell_commission_value / 100.0, 2) end;
    insert into upsell_events (tenant_id, order_id, user_id, user_name, before_total,
           after_total, delta, commission_type, commission_rate, commission_amount, status)
    values (v_p.tenant_id, p_order_id, v_uid, coalesce(v_p.full_name,'—'),
            v_before, v_after, v_delta, v_p.upsell_commission_type,
            v_p.upsell_commission_value, v_amt, 'pending')
    returning * into v_ev;
  end if;

  return jsonb_build_object('order', to_jsonb(v_o), 'upsell', to_jsonb(v_ev));
end$function$;

create or replace function public.create_staff_order(
  p_customer_name  text,
  p_phone          text,
  p_address        text,
  p_items          jsonb,
  p_alt_phone      text    default null,
  p_city           text    default null,
  p_platform       text    default 'fb',
  p_customer_notes text    default null,
  p_ship_prov      text    default null,
  p_ship_city      text    default null,
  p_ship_area      text    default null,
  p_weight         numeric default null,
  p_total          numeric default null,
  p_exchange_of    uuid    default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  v_tenant uuid; v_uid uuid := auth.uid(); v_by text;
  v_phone text; v_alt text; v_n bigint; v_uid_txt text; v_dupe uuid; v_id uuid; v_status text;
  v_orig orders; v_platform text; v_items jsonb := '[]'::jsonb; v_lines text[] := '{}';
  v_it jsonb; v_name text; v_qty int; v_price numeric; v_sum numeric := 0; v_total numeric;
  v_lp jsonb; v_prov text; v_city text; v_area text; v_reason text;
  v_cnt int; v_i int := 0; v_alloc numeric; v_chk numeric := 0;
  v_q int; v_r int; v_units numeric[] := '{}'; v_qs int[] := '{}'; v_names text[] := '{}';
begin
  v_tenant := app.current_tenant_id();
  if v_uid is null or v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if app.wallet_depleted() then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;

  if btrim(coalesce(p_customer_name, '')) = '' then return jsonb_build_object('ok', false, 'error', 'no_name'); end if;
  v_phone := app.eg_mobile(p_phone);
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'bad_phone'); end if;
  if btrim(coalesce(p_alt_phone, '')) <> '' then
    v_alt := app.eg_mobile(p_alt_phone);
    if v_alt is null then return jsonb_build_object('ok', false, 'error', 'bad_alt_phone'); end if;
  end if;
  if length(regexp_replace(btrim(coalesce(p_address, '')), '\s+', ' ', 'g')) < 10 then
    return jsonb_build_object('ok', false, 'error', 'short_address');
  end if;

  -- ── الاستبدال: الأصلي من نفس المتجر و**اتسلّم** ───────────────────
  if p_exchange_of is not null then
    select * into v_orig from orders where id = p_exchange_of and tenant_id = v_tenant;
    if not found then return jsonb_build_object('ok', false, 'error', 'exchange_not_found'); end if;
    -- (مراجعة 3 أكتوبر) «التحصيل = فرق السعر» صح بس لو العميل دفع الأصلي واستلمه. قبل التسليم
    -- (في السكة · خرج للتسليم · استثناء) = بوليصتين شغّالين لنفس العميل، ولو رفض الأصلي المندوب
    -- يحصّل الفرق بس على منتج كامل. والمرتجع/الفاشل ماتحصّلش أصلاً. الحالتين: أوردر جديد بسعره كامل.
    if lower(coalesce(v_orig.status, '')) <> 'delivered' then
      return jsonb_build_object('ok', false, 'error', 'exchange_not_delivered', 'status', v_orig.status);
    end if;
    v_platform := v_orig.platform;   -- العميل جه من نفس المصدر — المنصة بتتورث مش بتتختار
  else
    v_platform := lower(btrim(coalesce(p_platform, '')));
    if v_platform not in ('fb', 'ig', 'tiktok', 'whatsapp', 'threads', 'other') then
      return jsonb_build_object('ok', false, 'error', 'bad_platform');
    end if;
  end if;

  -- ── المنتجات: من المخزون بس (اسم حر = تكلفة صفر في الأرباح — W-24) ──
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_items');
  end if;
  if jsonb_array_length(p_items) > 20 then return jsonb_build_object('ok', false, 'error', 'bad_item'); end if;
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_name := btrim(coalesce(v_it->>'name', ''));
    begin v_qty := (v_it->>'qty')::int; exception when others then v_qty := null; end;
    begin v_price := round((v_it->>'price')::numeric, 2); exception when others then v_price := null; end;
    -- 🔴 NaN أكبر من أي رقم في Postgres فـ`< 0` مابيمسكهوش — السقف بيمسكه هو وInfinity وأي overflow
    if v_name = '' or v_qty is null or v_qty < 1 or v_qty > 999 or v_price is null or v_price < 0
       or v_price = 'NaN'::numeric or v_price > 1000000 then
      return jsonb_build_object('ok', false, 'error', 'bad_item');
    end if;
    if not exists (select 1 from stock_products where tenant_id = v_tenant and active and name = v_name) then
      return jsonb_build_object('ok', false, 'error', 'unknown_product', 'name', v_name);
    end if;
    v_lines := v_lines || (v_name || ' (عدد ' || v_qty || ')');
    v_items := v_items || jsonb_build_array(jsonb_build_object('n', v_name, 'q', v_qty, 'p', v_price));
    v_sum := v_sum + v_price * v_qty;
  end loop;
  v_sum := round(v_sum, 2);
  if v_sum > 10000000 then return jsonb_build_object('ok', false, 'error', 'bad_item'); end if;

  -- ── المبلغ = مبلغ التحصيل (total_cost = اللي المندوب هيحصّله — كل الحسابات وjt-ship بتفترض كده) ──
  if p_exchange_of is null then
    -- أوردر عادي: الإجمالي = مجموع السطور على السيرفر. رقم من المتصفح مختلف = رفض مش تصحيح صامت
    if p_total is not null and round(p_total, 2) <> v_sum then
      return jsonb_build_object('ok', false, 'error', 'total_mismatch', 'total', v_sum);
    end if;
    v_total := v_sum;
    v_lp := v_items;
  else
    if p_total is null or p_total < 0 or p_total = 'NaN'::numeric or p_total > 10000000 then
      return jsonb_build_object('ok', false, 'error', 'bad_total');
    end if;
    v_total := round(p_total, 2);
    -- أسعار السطور = توزيع التحصيل بالنسبة (للعرض في محرر المنتجات — المحرر مقفول على أوردر الاستبدال،
    -- شوف save_order_products). (مراجعة 3 أكتوبر) فرق التقريب بيتحط على سطر كميته 1 (بالمليم بالظبط)
    -- بدل ما أسعار السطور تبقى NULL والمحرر يعرض أسعار المخزون الكاملة كأنها المطلوب من العميل.
    v_cnt := jsonb_array_length(v_items);
    for v_it in select value from jsonb_array_elements(v_items) loop
      v_i := v_i + 1;
      v_q := (v_it->>'q')::int;
      if v_sum > 0 then v_alloc := v_total * ((v_it->>'p')::numeric * v_q) / v_sum;
      elsif v_i = 1 then v_alloc := v_total; else v_alloc := 0; end if;
      v_units := v_units || round(v_alloc / v_q, 2);
      v_qs := v_qs || v_q;
      v_names := v_names || (v_it->>'n');
    end loop;
    select coalesce(min(i) filter (where v_qs[i] = 1), v_cnt) into v_r from generate_subscripts(v_qs, 1) i;
    for v_i in 1 .. v_cnt loop
      if v_i <> v_r then v_chk := v_chk + v_units[v_i] * v_qs[v_i]; end if;
    end loop;
    v_units[v_r] := round((v_total - v_chk) / v_qs[v_r], 2);
    if v_units[v_r] < 0 then
      v_lp := null;
    else
      v_lp := '[]'::jsonb;
      for v_i in 1 .. v_cnt loop
        v_lp := v_lp || jsonb_build_array(jsonb_build_object('n', v_names[v_i], 'q', v_qs[v_i], 'p', v_units[v_i]));
      end loop;
    end if;
  end if;

  -- ── عنوان J&T (اختياري — بس لو اتبعت يبقى كامل وصحيح، نفس حراسات jt-ship) ──
  v_prov := nullif(btrim(coalesce(p_ship_prov, '')), '');
  v_city := nullif(btrim(coalesce(p_ship_city, '')), '');
  v_area := nullif(regexp_replace(btrim(coalesce(p_ship_area, '')), '\s+', ' ', 'g'), '');
  if v_prov is not null or v_city is not null or v_area is not null then
    if v_prov is null or v_city is null or v_area is null then
      return jsonb_build_object('ok', false, 'error', 'bad_ship_address');
    end if;
    if char_length(v_area) > 60 then return jsonb_build_object('ok', false, 'error', 'area_too_long'); end if;
    if not exists (select 1 from jt_pca where prov = v_prov and city = v_city) then
      return jsonb_build_object('ok', false, 'error', 'address_not_in_pca');
    end if;
  end if;
  if p_weight is not null and (p_weight <= 0 or p_weight > 100) then
    return jsonb_build_object('ok', false, 'error', 'bad_weight');
  end if;

  -- ضغطتين = أوردرين (نفس حارس create_manual_order)
  select id into v_dupe from orders
   where tenant_id = v_tenant and phone = v_phone and created_at > now() - interval '90 seconds' limit 1;
  if v_dupe is not null then return jsonb_build_object('ok', false, 'error', 'duplicate', 'order_id', v_dupe); end if;

  -- 🔴 نفس قفل ونفس نطاق create_manual_order بالحرف — نطاق W-n واحد للأوردرات اليدوية كلها
  perform pg_advisory_xact_lock(hashtext('manual_order:' || v_tenant::text));
  select coalesce(max((substring(order_uid from '^W-([0-9]+)$'))::bigint), 0) + 1 into v_n
    from orders where tenant_id = v_tenant and order_uid ~ '^W-[0-9]+$';
  v_uid_txt := 'W-' || v_n::text;

  -- pending الأول ثم confirmed في نفس الترانزاكشن — سطر سجل الحالة + التلجرام زي أي تأكيد بإيد موظف
  insert into orders (
    tenant_id, order_uid, customer_name, phone, alt_phone, city, address,
    product_name, total_cost, line_prices, status, payment_stage, platform,
    customer_notes, ship_prov, ship_city, ship_area, shipping_weight_kg,
    exchange_of, created_by, created_at, status_changed_at
  ) values (
    v_tenant, v_uid_txt, btrim(p_customer_name), v_phone, v_alt,
    coalesce(nullif(btrim(coalesce(p_city, '')), ''), v_prov), regexp_replace(btrim(p_address), '\s+', ' ', 'g'),
    array_to_string(v_lines, E'\n+ '), v_total, v_lp, 'pending', 'cod', v_platform,
    nullif(btrim(coalesce(p_customer_notes, '')), ''), v_prov, v_city, v_area, p_weight,
    p_exchange_of, v_uid, now(), now()
  ) returning id into v_id;

  select full_name into v_by from user_profiles where id = v_uid;
  v_by := coalesce(nullif(btrim(coalesce(v_by, '')), ''), 'موظف');
  v_reason := case when p_exchange_of is not null
                   then 'استبدال لأوردر #' || coalesce(v_orig.order_uid, '—')
                   else 'أوردر يدوي من اللوحة' end;

  update orders set
    status            = 'confirmed',
    status_changed_at = now(),
    status_log        = coalesce(status_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', 'pending', 'to', 'confirmed',
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', v_by, 'reason', v_reason))
  where id = v_id
  returning status into v_status;
  if v_status is distinct from 'confirmed' then raise exception 'manual_order_confirm_failed'; end if;

  return jsonb_build_object('ok', true, 'order_id', v_id, 'order_uid', v_uid_txt, 'status', v_status, 'total_cost', v_total);
end;
$function$;


create or replace function public.tg_log_status_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_log     jsonb;
  v_last    jsonb;
  v_by      text;
  v_to      text;
  v_chat_id text;
  v_token   text;
  v_action  text;
  v_msg     text;
  v_time    text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if coalesce(new.status_log::text,'') = '' then return new; end if;

  if jsonb_typeof(new.status_log) = 'string' then
    v_log := (new.status_log #>> '{}')::jsonb;
  else
    v_log := new.status_log;
  end if;
  if v_log is null or jsonb_typeof(v_log) <> 'array' or jsonb_array_length(v_log) = 0 then return new; end if;

  v_last := v_log -> (jsonb_array_length(v_log) - 1);
  v_to := coalesce(v_last->>'to','');
  v_by := coalesce(v_last->>'by','');

  if v_to is distinct from new.status then return new; end if;
  if v_by = '' then return new; end if;

  v_time := to_char((now() at time zone 'Africa/Cairo'), 'HH24:MI');

  -- تأكيد أو إلغاء من العميل نفسه عبر الواتساب
  if (v_by ilike '%واتساب%' or v_by ilike '%whatsapp%')
     and lower(new.status) in ('confirmed','cancelled') then

    -- (جديد) تفضيلات التاجر
    if lower(new.status) = 'confirmed'
       and not public.notify_enabled(new.tenant_id,'confirmations') then return new; end if;
    if lower(new.status) = 'cancelled'
       and not public.notify_enabled(new.tenant_id,'cancellations') then return new; end if;

    select telegram_chat_id into v_chat_id from public.tenants where id = new.tenant_id;
    if coalesce(v_chat_id,'') = '' then return new; end if;

    select decrypted_secret into v_token
      from vault.decrypted_secrets where name = 'ops_bot_token' limit 1;
    if coalesce(v_token,'') = '' then return new; end if;

    if lower(new.status) = 'confirmed' then
      v_msg := '✅ العميل أكّد الأوردر على واتساب' || E'\n\n';
    else
      v_msg := '❌ العميل ألغى الأوردر على واتساب' || E'\n\n';
    end if;

    v_msg := v_msg
      || '🛍️ ' || coalesce(new.customer_name,'—') || ' (' || coalesce(new.phone,'—') || ')' || E'\n'
      || case when coalesce(new.product_name,'')<>'' then '📦 ' || new.product_name || E'\n' else '' end
      || case when new.total_cost is not null then '💰 ' || trim(to_char(new.total_cost,'FM999999990.00')) || ' ج' || E'\n' else '' end
      || '🕐 ' || v_time;

    perform net.http_post(
      url  => 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      body => jsonb_build_object('chat_id', v_chat_id, 'text', v_msg),
      timeout_milliseconds => 15000
    );

    return new;
  end if;

  -- استبعد باقي المصادر الأوتوماتيك
  if v_by ilike '%واتساب%' or v_by ilike '%whatsapp%'
     or v_by ilike '%bosta%' or v_by = 'بوسطة' or v_by ilike '%api%' or v_by = 'البوت'
     or v_by ilike '%system%' or v_by ilike '%النظام%' or v_by = 'النظام'
  then return new; end if;

  -- (جديد) حركة موظف → تفضيل staff_activity
  if not public.notify_enabled(new.tenant_id,'staff_activity') then return new; end if;

  select telegram_chat_id into v_chat_id from public.tenants where id = new.tenant_id;
  if coalesce(v_chat_id, '') = '' then return new; end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'ops_bot_token' limit 1;
  if coalesce(v_token, '') = '' then return new; end if;

  v_action := case new.status
    when 'confirmed' then 'أكّد الأوردر ✅'
    when 'cancelled' then 'ألغى الأوردر ❌'
    when 'returned' then 'رجّع الأوردر ↩️'
    when 'pending' then 'رجّع الأوردر لقيد الانتظار ⏳'
    when 'bosta_assigned' then 'بعت الأوردر لبوسطة 🚚'
    when 'BOSTA AUTO' then 'بعت الأوردر لبوسطة 🚚'
    when 'bosta_auto' then 'بعت الأوردر لبوسطة 🚚'
    when 'BOSTA2' then 'بعت الأوردر لبوسطة 🚚'
    when 'bosta2' then 'بعت الأوردر لبوسطة 🚚'
    when 'delivered' then 'سلّم الأوردر 📦'
    when 'Delivered' then 'سلّم الأوردر 📦'
    when 'failed' then 'علّم الأوردر فاشل ⚠️'
    else 'غيّر حالة الأوردر لـ ' || new.status
  end;

  v_msg := '👤 ' || v_by || ' ' || v_action || E'\n'
    -- (3 أكتوبر) أوردر استبدال: رقم الأصلي ومبلغ التحصيل — من غيرها التأكيد بيتقري «بيعة جديدة»
    || case when new.exchange_of is not null then
         '🔁 استبدال لأوردر #' || coalesce((select o2.order_uid from public.orders o2 where o2.id = new.exchange_of and o2.tenant_id = new.tenant_id), '—')
         || ' · التحصيل ' || trim(to_char(coalesce(new.total_cost, 0), 'FM999999990.00')) || ' ج' || E'\n'
       else '' end
    || '🛍️ العميل: ' || coalesce(new.customer_name,'—') || ' (' || coalesce(new.phone,'—') || ')' || E'\n'
    || case when coalesce(new.product_name,'')<>'' then '📦 ' || new.product_name || E'\n' else '' end
    || case when new.status in ('bosta_assigned','BOSTA AUTO','bosta_auto','BOSTA2','bosta2')
              and coalesce(new.tracking_no,'')<>'' then '🚚 تتبّع: ' || new.tracking_no || E'\n' else '' end
    || '🕐 الساعة: ' || v_time;

  perform net.http_post(
    url  => 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body => jsonb_build_object('chat_id', v_chat_id, 'text', v_msg),
    timeout_milliseconds => 15000
  );

  return new;
exception when others then
  return new;
end;
$function$;
