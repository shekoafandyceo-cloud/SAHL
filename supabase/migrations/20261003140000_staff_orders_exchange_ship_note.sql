-- staff_orders_exchange_ship_note — طلبات المالك 3 أكتوبر:
--   1) «إنشاء أوردر يدوي على السيستم» لطلبات فيسبوك/إنستجرام (بدل ما الموظف يعملها في بوابة J&T
--      فتبقى مش موجودة في سهل خالص — 58 أوردر bosta_assigned من غير بوليصة من 20 سبتمبر).
--   2) «أوردر استبدال يدوي من جوّه أوردر العميل» — بنفس البيانات والمنتج الجديد.
--      قرار المالك: **أوردر جديد كامل** في الحسابات («هيتحسب عليه شحن جديد أصلاً»)، ومبلغ التحصيل
--      الموظف بيكتبه (الافتراضي فرق السعر)، والشحن بوليصة J&T عادية من سهل.
--   3) «الملاحظات المكتوبة في الطلب تتحط في البوليصة» — قرار المالك: ملاحظة العميل متعبّية في نافذة
--      الشحن والموظف يعدّلها. ship_note = اللي الموظف اختاره · jt_remark = اللي اتبعت لـJ&T بالحرف
--      (البوليصة المطبوعة بتطبعه هو — مش بتعيد تركيبه من صف ممكن يتعدّل بعد الشحن).
--
-- ⚠️ الأعمدة الجديدة ورثت منحة الجدول (authenticated=arwdm) — زي created_by: للمتابعة مش للفلوس.
--    exchange_of مالوش أي أثر على الحسابات (الاستبدال أوردر عادي بقرار المالك).

alter table public.orders
  add column if not exists exchange_of uuid references public.orders(id) on delete set null,
  add column if not exists ship_note  text,
  add column if not exists jt_remark  text;
create index if not exists orders_exchange_of_idx on public.orders (exchange_of) where exchange_of is not null;

-- نفس egMobile في _shared/jt-runtime.ts بالحرف (أرقام عربي/فارسي · 0020 · 20+12 · 10 أرقام تبدأ بـ1).
-- 🔴 لازم يطابقها: create_manual_order بتستخدم wa_id_from_phone اللي بتقبل أرضي (02…) وبترفض «٠١…»
-- و«0020…» — فأوردر بيتسجّل وjt-ship ترفضه بعدين. هنا الرقم اللي بيعدّي = الرقم اللي J&T هتقبله.
create or replace function app.eg_mobile(p text) returns text
language sql immutable as $$
  select case when d ~ '^01[0-9]{9}$' then d else null end
  from (
    select case when length(d1) = 10 and d1 like '1%' then '0' || d1 else d1 end as d
    from (
      select case
        when d0 like '0020%' then substr(d0, 5)
        when d0 like '20%' and length(d0) = 12 then substr(d0, 3)
        else d0 end as d1
      from (select regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') as d0) a
    ) b
  ) c
$$;

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
  v_cnt int; v_i int := 0; v_alloc numeric; v_unit numeric; v_chk numeric := 0;
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

  -- ── الاستبدال: الأصلي من نفس المتجر واتشحن فعلاً ───────────────────
  if p_exchange_of is not null then
    select * into v_orig from orders where id = p_exchange_of and tenant_id = v_tenant;
    if not found then return jsonb_build_object('ok', false, 'error', 'exchange_not_found'); end if;
    -- لسه ماتشحنش = عدّل منتجاته بدل استبدال (بوليصتين لنفس العميل في نفس الوقت = لخبطة)
    if lower(coalesce(v_orig.status, '')) in ('pending', 'confirmed') then
      return jsonb_build_object('ok', false, 'error', 'exchange_not_shipped');
    end if;
    if lower(coalesce(v_orig.status, '')) = 'cancelled' then
      return jsonb_build_object('ok', false, 'error', 'exchange_cancelled');
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
    if v_name = '' or v_qty is null or v_qty < 1 or v_qty > 999 or v_price is null or v_price < 0 then
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

  -- ── المبلغ = مبلغ التحصيل (total_cost = اللي المندوب هيحصّله — كل الحسابات وjt-ship بتفترض كده) ──
  if p_exchange_of is null then
    -- أوردر عادي: الإجمالي = مجموع السطور على السيرفر. رقم من المتصفح مختلف = رفض مش تصحيح صامت
    if p_total is not null and round(p_total, 2) <> v_sum then
      return jsonb_build_object('ok', false, 'error', 'total_mismatch', 'total', v_sum);
    end if;
    v_total := v_sum;
    v_lp := v_items;
  else
    if p_total is null or p_total < 0 then return jsonb_build_object('ok', false, 'error', 'bad_total'); end if;
    v_total := round(p_total, 2);
    -- أسعار السطور لازم مجموعها = التحصيل، وإلا محرر المنتجات يرجّع الإجمالي لأسعار المخزون في أول
    -- حفظة قبل الشحن. التوزيع بالنسبة؛ لو التقريب مايطلعش بالمليم = من غير أسعار سطور (fallback المحرر).
    v_cnt := jsonb_array_length(v_items);
    v_lp := '[]'::jsonb;
    for v_it in select value from jsonb_array_elements(v_items) loop
      v_i := v_i + 1;
      if v_sum > 0 then v_alloc := v_total * ((v_it->>'p')::numeric * (v_it->>'q')::int) / v_sum;
      elsif v_i = 1 then v_alloc := v_total; else v_alloc := 0; end if;
      v_unit := round(v_alloc / (v_it->>'q')::int, 2);
      v_chk := v_chk + v_unit * (v_it->>'q')::int;
      v_lp := v_lp || jsonb_build_array(jsonb_build_object('n', v_it->>'n', 'q', (v_it->>'q')::int, 'p', v_unit));
    end loop;
    if round(v_chk, 2) <> v_total then v_lp := null; end if;
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

revoke all on function public.create_staff_order(text, text, text, jsonb, text, text, text, text, text, text, text, numeric, numeric, uuid) from public;
revoke all on function public.create_staff_order(text, text, text, jsonb, text, text, text, text, text, text, text, numeric, numeric, uuid) from anon;
grant execute on function public.create_staff_order(text, text, text, jsonb, text, text, text, text, text, text, text, numeric, numeric, uuid) to authenticated, service_role;
revoke all on function app.eg_mobile(text) from public;
revoke all on function app.eg_mobile(text) from anon;
-- مفيش منحة لـauthenticated: create_staff_order (DEFINER) هي المستخدم الوحيد

-- ── التلجرام: تأكيد أوردر استبدال مايتقريش «بيعة جديدة» ─────────────────
-- نفس الدالة الحية بالحرف + سطر واحد في فرع حركة الموظف: لو الأوردر استبدال، رقم الأصلي ومبلغ التحصيل.
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
         '🔁 استبدال لأوردر #' || coalesce((select o2.order_uid from public.orders o2 where o2.id = new.exchange_of), '—')
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
