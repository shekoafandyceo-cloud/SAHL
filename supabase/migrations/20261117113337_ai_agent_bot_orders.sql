-- ai_agent_bot_orders — «البوت يسجّل الأوردر بنفسه» (17 نوفمبر — طلب المالك:
--   «عاوزه لما عميل يطلب اوردر هو الي يعمل الاوردر بنفسه و يلم البيانات بتاعته و يعملها هو ميصعدش»).
--
-- دالة واحدة: public.create_bot_order — بيناديها wa-ai-draft (service_role) بعد ما _shared/ai-order.ts يقرر إن البيانات كاملة.
-- 🔴 الثوابت:
--   • service_role بس (مفيش anon ولا authenticated) + الزرار لازم ON (ai_settings.mode = 'auto') — البوت مايسجّلش وهو مقفول.
--   • المنتج لازم صنف مخزون نشط **ومربوط بمقاس في ai_products** — والسعر لازم قريب من سعر الكارت بتاع المقاس (±50%) = مفيش سعر مخترع.
--   • عميل ليه أوردر سابق (آخر 60 يوم) مرتجع/استثناء أو لسه مفتوح = رفض (قرار المالك: يتراجع بإيد موظف) · أوردر بنفس الرقم من أقل من
--     10 دقايق = رفض (تكرار) · سقف 60 أوردر من البوت في 24 ساعة (حماية من حلقة).
--   • الرقم في نطاق «B-n» لوحده (قفل advisory) — عمره ما بياخد من ترقيم اللاندنج ولا من W-n.
--   • pending ثم confirmed في نفس الترانزاكشن (زي create_manual_order بالظبط): سطر سجل الحالة باسم «🤖 AI Agent» + إشعار التلجرام.
--   • مفيش شحن هنا — الأوردر بينزل «مؤكد» والموظف هو اللي بيدوس شحن (شبكة الأمان: بيشوف المنتج والمبلغ والعنوان).
-- مفيش DROP ومفيش تعديل على أي جدول. إعادة التشغيل آمنة (create or replace).
-- اتجرّب بترانزاكشن راجعة على الحي قبل التطبيق (النتايج في CLAUDE.md — قسم «AI Agent للشات» ← «v8»).

create or replace function public.create_bot_order(
  p_tenant uuid, p_customer_name text, p_phone text, p_alt_phone text, p_city text, p_address text,
  p_stock_product_id uuid, p_qty int, p_unit_price numeric, p_var text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
set lock_timeout to '3s'
as $function$
declare
  v_phone text; v_alt text; v_name text; v_addr text; v_pname text; v_card numeric;
  v_prev record; v_n bigint; v_uid_txt text; v_id uuid; v_status text; v_total numeric; v_cnt int;
begin
  if p_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  -- الزرار لازم ON
  if not exists (select 1 from ai_settings where tenant_id = p_tenant and mode = 'auto') then
    return jsonb_build_object('ok', false, 'error', 'bot_off');
  end if;

  v_name := regexp_replace(btrim(coalesce(p_customer_name, '')), '\s+', ' ', 'g');
  if char_length(v_name) < 2 then return jsonb_build_object('ok', false, 'error', 'no_name'); end if;
  v_phone := app.eg_mobile(p_phone);
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'bad_phone'); end if;
  if btrim(coalesce(p_alt_phone, '')) <> '' then
    v_alt := app.eg_mobile(p_alt_phone);
    if v_alt is null then return jsonb_build_object('ok', false, 'error', 'bad_alt_phone'); end if;
    if v_alt = v_phone then v_alt := null; end if;
  end if;
  v_addr := regexp_replace(btrim(coalesce(p_address, '')), '\s+', ' ', 'g');
  if char_length(v_addr) < 12 then return jsonb_build_object('ok', false, 'error', 'short_address'); end if;
  if btrim(coalesce(p_city, '')) = '' then return jsonb_build_object('ok', false, 'error', 'no_city'); end if;
  if p_qty is null or p_qty < 1 or p_qty > 3 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;

  -- المنتج: صنف مخزون نشط ومربوط بمقاس في ai_products (المنتجات اللي البوت مسموحله يسجّلها)
  select sp.name into v_pname from stock_products sp where sp.id = p_stock_product_id and sp.tenant_id = p_tenant and sp.active;
  if v_pname is null then return jsonb_build_object('ok', false, 'error', 'unknown_product'); end if;
  select (v.value->>'card_price')::numeric into v_card
    from ai_products ap, jsonb_array_elements(coalesce(ap.facts->'variants', '[]'::jsonb)) v
   where ap.tenant_id = p_tenant and ap.active and v.value->>'stock_product_id' = p_stock_product_id::text
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'product_not_allowed'); end if;
  -- 🔴 NaN أكبر من أي رقم في Postgres — المقارنة بالنطاق بتمسكه هو وInfinity
  if p_unit_price is null or p_unit_price = 'NaN'::numeric or p_unit_price <= 0 or p_unit_price > 1000000 then
    return jsonb_build_object('ok', false, 'error', 'bad_price');
  end if;
  if v_card is null or v_card <= 0 or p_unit_price < v_card * 0.5 or p_unit_price > v_card * 1.5 then
    return jsonb_build_object('ok', false, 'error', 'price_out_of_range');
  end if;
  v_total := round(p_unit_price * p_qty, 2);

  -- أوردرات العميل السابقة (آخر 60 يوم — بالرقم أو الرقم الإضافي): مرتجع/استثناء أو مفتوح = مايتسجّلش تلقائي
  for v_prev in
    select order_uid, status, created_at from orders
     where tenant_id = p_tenant and created_at > now() - interval '60 days'
       and (phone in (v_phone, coalesce(v_alt, v_phone)) or alt_phone in (v_phone, coalesce(v_alt, v_phone)))
     order by created_at desc limit 12
  loop
    if v_prev.created_at > now() - interval '10 minutes' then
      return jsonb_build_object('ok', false, 'error', 'duplicate', 'order_uid', v_prev.order_uid);
    end if;
    if v_prev.status ~* '(returned|exception|failed)' then
      return jsonb_build_object('ok', false, 'error', 'has_returned_order', 'order_uid', v_prev.order_uid, 'status', v_prev.status);
    end if;
    if lower(v_prev.status) not in ('delivered', 'cancelled') then
      return jsonb_build_object('ok', false, 'error', 'has_open_order', 'order_uid', v_prev.order_uid, 'status', v_prev.status);
    end if;
  end loop;

  -- نطاق B-n + سقف يومي (تحت نفس القفل)
  perform pg_advisory_xact_lock(hashtext('bot_order:' || p_tenant::text));
  select count(*) into v_cnt from orders
   where tenant_id = p_tenant and order_uid ~ '^B-[0-9]+$' and created_at > now() - interval '24 hours';
  if v_cnt >= 60 then return jsonb_build_object('ok', false, 'error', 'day_cap'); end if;
  select coalesce(max((substring(order_uid from '^B-([0-9]+)$'))::bigint), 0) + 1 into v_n
    from orders where tenant_id = p_tenant and order_uid ~ '^B-[0-9]+$';
  v_uid_txt := 'B-' || v_n::text;

  insert into orders (
    tenant_id, order_uid, customer_name, phone, alt_phone, city, address,
    product_name, total_cost, status, payment_stage, platform, var,
    internal_notes, created_at, status_changed_at
  ) values (
    p_tenant, v_uid_txt, left(v_name, 80), v_phone, v_alt, left(btrim(p_city), 40), left(v_addr, 300),
    v_pname || ' (عدد ' || p_qty || ')', v_total, 'pending', 'cod', 'whatsapp',
    nullif(left(btrim(coalesce(p_var, '')), 60), ''),
    '🤖 الأوردر ده سجّله الـAI Agent من شات الواتساب — راجع المنتج والعنوان قبل الشحن', now(), now()
  ) returning id into v_id;

  update orders set
    status            = 'confirmed',
    status_changed_at = now(),
    status_log        = coalesce(status_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', 'pending', 'to', 'confirmed',
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', '🤖 AI Agent', 'reason', 'العميل طلبه في شات الواتساب'))
  where id = v_id
  returning status into v_status;
  if v_status is distinct from 'confirmed' then raise exception 'bot_order_confirm_failed'; end if;

  return jsonb_build_object('ok', true, 'order_id', v_id, 'order_uid', v_uid_txt, 'status', v_status, 'total_cost', v_total);
end;
$function$;

-- 🔴 service_role بس. Supabase بيمنح anon/authenticated صراحةً فالـREVOKE من PUBLIC لوحده مش كفاية (درس 41).
revoke all on function public.create_bot_order(uuid, text, text, text, text, text, uuid, int, numeric, text) from public, anon, authenticated;
grant execute on function public.create_bot_order(uuid, text, text, text, text, text, uuid, int, numeric, text) to service_role;
