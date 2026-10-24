-- مصالحة J&T بالسحب (30 سبتمبر — بلاغ المالك: JEG000543975786 «استثناء» وهو متسلّم ومتحصّل)
--
-- 🔴 السبب مقيس: مسح التسليم (100) عند J&T 27/9 19:11 **عمره ما وصل jt-status**.
-- الـpush مش مضمون: 19 من 1,995 مسح (~1%) ضاعوا، ولما الضايع يبقى **آخر** مسح
-- الأوردر بيفضل على الحالة الغلط للأبد — مفيش أي حاجة في السيستم بتراجع.
-- الحل: jt-lookup action `trace_sync` بيسحب logistics/trace كل 15 دقيقة لكل أوردر
-- J&T لسه ماوصلش حالة نهائية، وبيطبّق المسحات الناقصة على **نفس** jt_apply_trace.
--
-- 1) الخريطة: الـpull بيتكلم بأكواد الـpush نفسها ما عدا اتنين (اتقاس على 209 بوليصة):
--    120 «Left Over Scan» = «Holding scan» اللي بيوصل في الـpush من غير كود
--    111 «Return Sign»    = «13 Returned Signed» في الـpush
insert into public.jt_status_map (scan_type_code, scan_type, sahl_status, note) values
  ('120', 'Left Over Scan', 'Exception',
   '🔴 اسمه في الـpull — نفس «Holding scan» اللي بيوصل في الـpush من غير كود (30 سبتمبر)'),
  ('111', 'Return Sign', 'Returned to business',
   '🔴 اسمه في الـpull — نفس «13 Returned Signed» في الـpush: المرتجع اتسلّم للمرسل (30 سبتمبر)')
on conflict (scan_type_code) do nothing;

-- 2) مسحات الـpull بتتسجّل خام في jt_events (kind='pull') — دليل إن الحالة جت من
--    المصالحة مش من الـpush (يعني الـpush بتاعها ضاع)
alter table public.jt_events drop constraint jt_events_kind_check;
alter table public.jt_events add constraint jt_events_kind_check
  check (kind = any (array['trace','order','settlement','unknown','pull']));

-- 3) jt_apply_trace: نفس الجسم بالحرف + p_by (default 'J&T API' فـjt-status ماتتلمسش).
--    المصالحة بتكتب «J&T API · مصالحة» في سجل الحالة — المالك يشوف إن الـpush ضاع.
--    ⚠️ drop + create في نفس الترانزاكشن: overload تاني بنفس الأسماء كان هيخلّي
--    PostgREST مايعرفش يختار (named args بتطابق الاتنين).
drop function public.jt_apply_trace_v1(text, text, text, timestamptz, text);
drop function app.jt_apply_trace(text, text, text, timestamptz, text);

create function app.jt_apply_trace(p_bill_code text, p_scan_type text, p_scan_code text,
  p_scan_at timestamptz, p_desc text, p_by text default 'J&T API')
returns jsonb language plpgsql security definer set search_path to 'public', 'app' as $function$
declare v_row orders; v_target text; v_final boolean; v_key text;
begin
  select * into v_row from orders where tracking_no = p_bill_code and shipping_carrier = 'jt' order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  if coalesce(p_scan_code,'') like 'order:%' then
    if coalesce(v_row.carrier_status_code,'') = '' or v_row.carrier_status_code like 'order:%' then
      update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code where id = v_row.id;
    end if;
    return jsonb_build_object('ok', true, 'note', 'order_event', 'order_id', v_row.id);
  end if;
  if v_row.carrier_status_at is not null and p_scan_at is not null and p_scan_at < v_row.carrier_status_at
     and coalesce(v_row.carrier_status_code,'') not like 'order:%' then
    return jsonb_build_object('ok', true, 'note', 'stale', 'order_id', v_row.id);
  end if;
  update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
    carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
  if coalesce(p_scan_code,'') like 'refund:%' then
    return jsonb_build_object('ok', true, 'note', 'refund_journey', 'order_id', v_row.id);
  end if;
  v_key := coalesce(nullif(btrim(coalesce(p_scan_code,'')), ''), 'name:' || lower(btrim(coalesce(p_scan_type,''))));
  select sahl_status into v_target from jt_status_map where scan_type_code = v_key;
  if v_target is null then return jsonb_build_object('ok', true, 'note', 'unmapped', 'order_id', v_row.id, 'key', v_key); end if;
  if v_target = v_row.status then return jsonb_build_object('ok', true, 'note', 'same_status', 'order_id', v_row.id); end if;
  v_final := lower(v_row.status) in ('delivered','returned','returned to business','returned to business2','cancelled');
  if v_final and v_target not in ('Delivered','Returned to business') then
    return jsonb_build_object('ok', true, 'note', 'final_state_kept', 'order_id', v_row.id);
  end if;
  update orders set status = v_target, status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', v_target,
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', coalesce(nullif(btrim(p_by), ''), 'J&T API'), 'reason', nullif(left(coalesce(p_desc,''),120),'')))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $function$;

create function public.jt_apply_trace_v1(p_bill_code text, p_scan_type text, p_scan_code text,
  p_scan_at timestamptz, p_desc text, p_by text default 'J&T API')
returns jsonb language sql security definer set search_path to 'public', 'app' as
$function$ select app.jt_apply_trace(p_bill_code, p_scan_type, p_scan_code, p_scan_at, p_desc, p_by); $function$;

revoke all on function app.jt_apply_trace(text, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.jt_apply_trace_v1(text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function app.jt_apply_trace(text, text, text, timestamptz, text, text) to service_role;
grant execute on function public.jt_apply_trace_v1(text, text, text, timestamptz, text, text) to service_role;

-- 4) المرشّحين: كل أوردر J&T لسه ماوصلش حالة نهائية (المسلّم والمرتجع بس برّه —
--    الملغي جوّه عن قصد: الـpush نفسه بيحوّله لـDelivered لو J&T سلّمته فعلاً).
create function app.jt_trace_candidates(p_limit int default 300)
returns table(bill_code text, order_id uuid, tenant_id uuid, carrier_status_at timestamptz, carrier_status_code text)
language sql stable security definer set search_path to 'public', 'app' as $function$
  select o.tracking_no, o.id, o.tenant_id, o.carrier_status_at, o.carrier_status_code from orders o
   where o.shipping_carrier = 'jt' and coalesce(o.tracking_no,'') <> ''
     and o.status not in ('Delivered', 'Returned to business')
     and o.created_at > now() - interval '90 days'
   order by o.carrier_status_at nulls first, o.created_at
   limit greatest(1, least(coalesce(p_limit, 300), 1000));
$function$;
create function public.jt_trace_candidates_v1(p_limit int default 300)
returns table(bill_code text, order_id uuid, tenant_id uuid, carrier_status_at timestamptz, carrier_status_code text)
language sql security definer set search_path to 'public', 'app' as
$function$ select * from app.jt_trace_candidates(p_limit); $function$;
revoke all on function app.jt_trace_candidates(int) from public, anon, authenticated;
revoke all on function public.jt_trace_candidates_v1(int) from public, anon, authenticated;
grant execute on function public.jt_trace_candidates_v1(int) to service_role;

-- 5) سجل تشغيل المزامنة — من غيره الجدولة لو وقفت (توكن اتغيّر · J&T واقعة) الحالات
--    بتبوظ تاني **في صمت**. الواجهة بتقرا آخر نجاح عبر jt_sync_health (للأدمن بس).
create table public.jt_sync_runs (
  id bigserial primary key,
  job text not null check (job in ('trace_sync', 'fee_sync')),
  ran_at timestamptz not null default now(),
  ok boolean not null,
  candidates int,
  tally jsonb,
  error text
);
create index jt_sync_runs_job_ran_idx on public.jt_sync_runs (job, ran_at desc);
alter table public.jt_sync_runs enable row level security;
revoke all on table public.jt_sync_runs from anon, authenticated;
grant all on table public.jt_sync_runs to service_role;
grant usage, select on sequence public.jt_sync_runs_id_seq to service_role;

create function public.jt_sync_health() returns jsonb
language sql stable security definer set search_path to 'public', 'app' as $function$
  select case when not public.is_tenant_admin() then null else jsonb_build_object(
    'enabled', exists (select 1 from tenants t where t.id = app.current_tenant_id() and t.shipping_provider = 'jt'),
    'now', now(),
    'trace_last_ok', (select max(ran_at) from jt_sync_runs where job = 'trace_sync' and ok),
    'trace_last_run', (select max(ran_at) from jt_sync_runs where job = 'trace_sync'),
    'trace_last_error', (select error from jt_sync_runs where job = 'trace_sync' and not ok order by ran_at desc limit 1)
  ) end;
$function$;
revoke all on function public.jt_sync_health() from public, anon;
grant execute on function public.jt_sync_health() to authenticated;
