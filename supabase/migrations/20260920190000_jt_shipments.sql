-- J&T Express (مصر) — الدفعة 2: أعمدة الشحنة + سجل الـcallbacks الخام + كاش PCA + خريطة الحالات
-- القواعد: بيانات بوسطة التاريخية ماتتلمسش (الأعمدة الجديدة NULL للقديم = بوسطة).
--          مفيش أسرار هنا — مفاتيح J&T في Edge Function secrets.

-- ── orders ──────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists shipping_carrier      text,          -- 'bosta' | 'jt' ؛ NULL للقديم
  add column if not exists carrier_ref           text,          -- مرجعنا عند الشركة (J&T: txlogisticId = orders.id)
  add column if not exists jt_sorting_code       text,          -- sortingCode من رد addOrder — بيتطبع بالحرف
  add column if not exists carrier_status_raw    text,          -- آخر scanType خام من J&T
  add column if not exists carrier_status_code   text,          -- آخر scanTypeCode خام
  add column if not exists carrier_status_at     timestamptz,   -- وقت آخر مسح (scanTime) — للترتيب الزمني
  add column if not exists shipping_weight_kg    numeric,       -- الوزن اللي اتبعت لـJ&T
  add column if not exists shipping_fee_estimated numeric,      -- sumFreight من رد addOrder = **تقدير** مش تكلفة مؤكدة
  add column if not exists ship_prov             text,          -- عنوان المستلم بأسماء J&T (من online/pca)
  add column if not exists ship_city             text,
  add column if not exists ship_area             text,
  add column if not exists jt_ship_error         text,          -- آخر سبب فشل إنشاء الشحنة (بيتصفّر مع النجاح)
  add column if not exists jt_ship_attempted_at  timestamptz;   -- آخر محاولة إنشاء — حارس التكرار مع getOrders

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_shipping_carrier_check') then
    alter table public.orders add constraint orders_shipping_carrier_check
      check (shipping_carrier is null or shipping_carrier in ('bosta','jt'));
  end if;
end $$;

create index if not exists orders_carrier_ref_idx on public.orders (carrier_ref) where carrier_ref is not null;
-- بوليصة J&T واحدة لكل رقم داخل المتجر (القديم فيه 31 تكرار من بوسطة — فالقيد على J&T بس)
create unique index if not exists orders_jt_tracking_uidx on public.orders (tenant_id, tracking_no)
  where shipping_carrier = 'jt' and tracking_no is not null;

-- ── tenants: بيانات المرسل (الـFROM في البوليصة + sender في addOrder) ──
alter table public.tenants
  add column if not exists sender_name   text,
  add column if not exists sender_phone  text,
  add column if not exists sender_prov   text,
  add column if not exists sender_city   text,
  add column if not exists sender_area   text,
  add column if not exists sender_street text;
grant select (sender_name, sender_phone, sender_prov, sender_city, sender_area, sender_street) on public.tenants to authenticated;

-- v_my_tenant: DEFINER عن قصد (درس 39) — نفس الجسم + أعمدة المرسل في الآخر
create or replace view public.v_my_tenant as
 SELECT id, slug, store_name, active, created_at, shipping_provider, whatsapp_phone_id, plan, plan_expires_at,
    subscription_status, grace_period_days, monthly_price, wallet_balance, overdraft_limit, billing_exempt,
    orders_used_cycle, cycle_started_at, cycle_ends_at, is_lifetime, whatsapp_confirmation_enabled,
    telegram_chat_id_set_at, support_phone, wa_template_name, trial_ends_at, billing_cycle, last_payment_at,
    lifetime_forfeited_at, payment_method,
    CASE WHEN is_tenant_admin() THEN whatsapp_token ELSE NULL::text END AS whatsapp_token,
    CASE WHEN is_tenant_admin() THEN shipping_api_key ELSE NULL::text END AS shipping_api_key,
    CASE WHEN is_tenant_admin() THEN webhook_secret ELSE NULL::text END AS webhook_secret,
    CASE WHEN is_tenant_admin() THEN telegram_chat_id ELSE NULL::text END AS telegram_chat_id,
    CASE WHEN is_tenant_admin() THEN error_notify_chat ELSE NULL::text END AS error_notify_chat,
    CASE WHEN is_tenant_admin() THEN telegram_group_id ELSE NULL::text END AS telegram_group_id,
    CASE WHEN is_tenant_admin() THEN ops_chat_id ELSE NULL::text END AS ops_chat_id,
    CASE WHEN is_tenant_admin() THEN whatsapp_app_secret ELSE NULL::text END AS whatsapp_app_secret,
    CASE WHEN is_tenant_admin() THEN telegram_bot_token ELSE NULL::text END AS telegram_bot_token,
    CASE WHEN is_tenant_admin() THEN notes ELSE NULL::text END AS notes,
    CASE WHEN is_tenant_admin() THEN wa_webhook_secret ELSE NULL::text END AS wa_webhook_secret,
    COALESCE(shipping_api_key, ''::text) <> ''::text AS has_shipping_api,
    wa_followup_template, wa_followup_lang, wa_followup_body,
    sender_name, sender_phone, sender_prov, sender_city, sender_area, sender_street
   FROM tenants t
  WHERE id = app.current_tenant_id();

-- ── سجل الـcallbacks الخام — كل نداء من J&T بيتسجّل زي ما هو (idempotent بالـhash) ──
create table if not exists public.jt_events (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('trace','order','settlement','unknown')),
  bill_code     text,
  txlogistic_id text,
  order_id      uuid,
  tenant_id     uuid,
  payload       jsonb not null,
  payload_hash  text not null,
  digest_ok     boolean not null,
  applied       boolean not null default false,
  apply_note    text,
  received_at   timestamptz not null default now()
);
create unique index if not exists jt_events_hash_uidx on public.jt_events (payload_hash);
create index if not exists jt_events_bill_idx on public.jt_events (bill_code);
alter table public.jt_events enable row level security;
revoke all on public.jt_events from anon, authenticated;

-- ── خريطة scanTypeCode → حالة سهل — فاضية عمداً لحد أول حمولة حقيقية (متثبتش عقد بالتخمين) ──
create table if not exists public.jt_status_map (
  scan_type_code text primary key,
  scan_type      text,
  sahl_status    text not null,
  note           text,
  updated_at     timestamptz not null default now()
);
alter table public.jt_status_map enable row level security;
revoke all on public.jt_status_map from anon, authenticated;

-- ── كاش نطاق الخدمة (online/pca) — الواجهة بتقرا منه قوايم المحافظة/المدينة/المنطقة ──
create table if not exists public.jt_pca (
  id        bigint generated always as identity primary key,
  prov      text not null,
  city      text not null,
  area      text not null,
  raw       jsonb,
  synced_at timestamptz not null default now(),
  unique (prov, city, area)
);
alter table public.jt_pca enable row level security;
drop policy if exists jt_pca_read on public.jt_pca;
create policy jt_pca_read on public.jt_pca for select to authenticated using (true);
grant select on public.jt_pca to authenticated;

-- ── مرادفات العناوين: نص المدينة/العنوان اللي بيجي من اللاندنج → أسماء J&T ──
-- بيتعبّى من الاختيارات اليدوية للموظفين (كل شحنة ناجحة بتسجّل city→prov/city/area)
create table if not exists public.jt_pca_alias (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null,
  alias_norm text not null,
  prov       text not null,
  city       text not null,
  area       text not null,
  hits       integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (tenant_id, alias_norm)
);
alter table public.jt_pca_alias enable row level security;
revoke all on public.jt_pca_alias from anon, authenticated;

-- ── تسجيل نجاح الإنشاء ذرياً (نفس شكل سجل mark_shipped_manual) — service_role بس ──
create or replace function app.jt_record_shipment(
  p_order_id uuid, p_bill_code text, p_sorting_code text,
  p_fee_estimated numeric, p_weight numeric, p_by text default 'J&T API')
returns jsonb
language plpgsql security definer set search_path = public, app
as $fn$
declare v_row orders;
begin
  select * into v_row from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if coalesce(v_row.tracking_no,'') <> '' and v_row.tracking_no <> p_bill_code then
    raise exception 'already_has_tracking';
  end if;
  if v_row.tracking_no = p_bill_code then
    return jsonb_build_object('ok', true, 'idempotent', true, 'status', v_row.status, 'tracking_no', v_row.tracking_no);
  end if;
  update orders set
    status = 'BOSTA AUTO',
    tracking_no = p_bill_code,
    shipping_carrier = 'jt',
    carrier_ref = p_order_id::text,
    jt_sorting_code = nullif(trim(coalesce(p_sorting_code,'')), ''),
    shipping_fee_estimated = p_fee_estimated,
    shipping_weight_kg = coalesce(p_weight, shipping_weight_kg),
    jt_ship_error = null,
    shipping_requested_at = null,
    status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', 'BOSTA AUTO',
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', coalesce(nullif(trim(coalesce(p_by,'')),''), 'J&T API'), 'reason', null))
   where id = p_order_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'status', v_row.status, 'tracking_no', v_row.tracking_no, 'sorting_code', v_row.jt_sorting_code);
end $fn$;
revoke all on function app.jt_record_shipment(uuid,text,text,numeric,numeric,text) from public, anon, authenticated;
grant execute on function app.jt_record_shipment(uuid,text,text,numeric,numeric,text) to service_role;

-- ── تطبيق حدث تتبع: الخام دايماً بيتسجّل، والحالة بتتغيّر بس لو فيه خريطة وبترتيب زمني ──
create or replace function app.jt_apply_trace(
  p_bill_code text, p_scan_type text, p_scan_code text, p_scan_at timestamptz, p_desc text)
returns jsonb
language plpgsql security definer set search_path = public, app
as $fn$
declare v_row orders; v_target text; v_note text := ''; v_final boolean;
begin
  select * into v_row from orders where tracking_no = p_bill_code and shipping_carrier = 'jt' order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  -- أقدم من آخر مسح متسجّل = بيتطنّش (الـcallbacks ممكن توصل بالمقلوب)
  if v_row.carrier_status_at is not null and p_scan_at is not null and p_scan_at < v_row.carrier_status_at then
    return jsonb_build_object('ok', true, 'note', 'stale', 'order_id', v_row.id);
  end if;
  update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
    carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
  select sahl_status into v_target from jt_status_map where scan_type_code = p_scan_code;
  if v_target is null then
    return jsonb_build_object('ok', true, 'note', 'unmapped', 'order_id', v_row.id);
  end if;
  if v_target = v_row.status then
    return jsonb_build_object('ok', true, 'note', 'same_status', 'order_id', v_row.id);
  end if;
  v_final := lower(v_row.status) in ('delivered','returned','returned to business','returned to business2','cancelled');
  if v_final and v_target not in ('Delivered','Returned to business') then
    return jsonb_build_object('ok', true, 'note', 'final_state_kept', 'order_id', v_row.id);
  end if;
  update orders set status = v_target, status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', v_target,
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', 'J&T API', 'reason', nullif(left(coalesce(p_desc,''),120),'')))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $fn$;
revoke all on function app.jt_apply_trace(text,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function app.jt_apply_trace(text,text,text,timestamptz,text) to service_role;

-- ── الفاتورة المؤكدة (other/settlementReturn) → real_shipping_fee ──
create or replace function app.jt_apply_settlement(p_bill_code text, p_total_freight numeric, p_charge_weight numeric)
returns jsonb
language plpgsql security definer set search_path = public, app
as $fn$
declare v_id uuid;
begin
  update orders set real_shipping_fee = p_total_freight, real_shipping_fee_at = now(),
    shipping_weight_kg = coalesce(p_charge_weight, shipping_weight_kg)
   where tracking_no = p_bill_code and shipping_carrier = 'jt'
   returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  return jsonb_build_object('ok', true, 'order_id', v_id);
end $fn$;
revoke all on function app.jt_apply_settlement(text,numeric,numeric) from public, anon, authenticated;
grant execute on function app.jt_apply_settlement(text,numeric,numeric) to service_role;
