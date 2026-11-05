-- استثناءات الشحن — تاب متابعة استثناءات J&T جوّه سهل (8 أكتوبر — طلب المالك)
--
-- «لما اوردر يحصل عليه اي مشكلة "استثناء" او يحصل عليه اي UPDATE وحش في شركة الشحن، ينزل
-- جواه تلقائي رقم التتبع و رقم الموبايل بتاع العميل و عنوانه و طالب ايه و رقم المندوب، و يكون
-- في خانة للموظف يكتب فيها عمل ايه … و خانة يختار منها FAKE UPDATE او تأجيل حقيقي».
-- (كانت شيت جوجل الأول، والمالك غيّرها لتاب جوّه سهل.)
--
-- الشكل:
--   jt_issues        = صف لكل مسح 110 (استثناء)، أو 172 (بداية مرتجع) لشحنة مالهاش استثناء.
--                      بيتملا من تريجر على jt_events لحظة وصول المسح (push أو pull).
--   jt_problem_map   = سبب J&T (problemType) بالعربي.
--   v_jt_issues      = الصف + بيانات العميل من orders (security_invoker — RLS بتاعة الاتنين شغالة).
--   jt_issue_save()  = الطريق الوحيد لكتابة تصنيف الموظف وملاحظته — بيسجّل مين وإمتى.
--
-- 🔴 التريجر على مسار الإدخال الخام نفسه: jt-status بيرجّع 500 لـJ&T لو إدخال jt_events فشل،
-- فكل حاجة جوّه exception block، وأسوأ حالة: مفيش صف استثناء والحدث الخام يدخل عادي.
-- 🔴 وقت J&T = UTC+2 ثابت (اتقاس 7 أكتوبر: الـpush بيوصل بعد المسح بثواني لما بنحوّل كده).
-- 🔴 المندوب ورقمه ورقم الفرع من آخر مسح 94 («خرج للتسليم») قبل المشكلة — J&T بتكتبهم في
-- الـdesc. اتقاس: موجودين في 184 من 190 استثناء (آخر 7 أيام، 7 أكتوبر).

-- 1) أسباب J&T بالعربي
create table if not exists public.jt_problem_map (
  problem_type text primary key,
  reason_en    text not null,
  reason_ar    text not null,
  updated_at   timestamptz not null default now()
);
alter table public.jt_problem_map enable row level security;
revoke all on public.jt_problem_map from anon, authenticated;
comment on table public.jt_problem_map is
  'أسباب استثناءات J&T (problemType في مسح 110) بالعربي — اتبنت من الداتا الحية 7 أكتوبر 2026. كود جديد مش هنا = بيظهر بالإنجليزي.';

insert into public.jt_problem_map (problem_type, reason_en, reason_ar) values
  ('205',  'Change The Delivery Time',                    'العميل طلب تأجيل'),
  ('202',  'No Answer or Phone Switched Off',             'العميل مش بيرد أو تليفونه مقفول'),
  ('1010', 'Customer refuse by WhatsApp',                 'العميل رفض على الواتساب'),
  ('1002', 'Customer refuse by call',                     'العميل رفض في التليفون'),
  ('1004', 'The goods do not match after opening',        'العميل فتح وقال المنتج مش مطابق'),
  ('1005', 'Poor product quality',                        'العميل قال الجودة وحشة'),
  ('1001', 'Directly refuse without opening the package', 'العميل رفض من غير ما يفتح'),
  ('1006', 'Package is damaged',                          'الشحنة متضررة'),
  ('203',  'Wrong Phone number or Contact Person',        'رقم التليفون غلط'),
  ('204',  'Customer''s Address Cannot Be Entered',       'المندوب مقدرش يوصل للعنوان'),
  ('206',  'Change The Delivery Address',                 'العميل عايز يغيّر العنوان'),
  ('209',  'No Sign Receiving  Because Holiday',          'أجازة ومفيش حد يستلم'),
  ('211',  'Self Take Shipment',                          'العميل هيستلم بنفسه من الفرع'),
  ('301',  'Wrong or Undetailed Address Information',     'العنوان غلط أو ناقص'),
  ('303',  'Delivery/Pick UP - out of coverage',          'العنوان خارج تغطية J&T'),
  ('306',  'miss-sorting from DC',                        'غلطة فرز من J&T'),
  ('310',  'Three-segment code error',                    'غلطة فرز من J&T (كود المنطقة)'),
  ('311',  'Abnormal Interception',                       'الشحنة اتوقفت عند J&T'),
  ('402',  'Over Standard Shipment',                      'J&T بتقول الشحنة أكبر من المسموح'),
  ('801',  'Other Kind Of Problems',                      'مشكلة تانية')
on conflict (problem_type) do nothing;

-- 2) الاستثناءات
create table if not exists public.jt_issues (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  order_id         uuid,
  tracking_no      text not null,
  kind             text not null check (kind in ('exception', 'return')),
  event_at         timestamptz not null,
  reason_code      text,
  reason_en        text,
  reason_ar        text,
  courier_note     text,
  branch           text,
  branch_phone     text,
  courier_name     text,
  courier_phone    text,
  photo_url        text,
  verdict          text check (verdict in ('fake_update', 'real_delay', 'real_refusal', 'no_answer_us', 'data_fixed', 'jt_error')),
  staff_note       text,
  staff_updated_at timestamptz,
  verdict_by       uuid,
  verdict_by_name  text,
  outcome          text check (outcome in ('delivered', 'returning', 'returned')),
  outcome_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint jt_issues_event_uidx unique (tracking_no, kind, event_at)
);
create index if not exists jt_issues_tenant_event_idx on public.jt_issues (tenant_id, event_at desc);
comment on table public.jt_issues is
  'تاب «استثناءات الشحن»: صف لكل مسح 110، أو 172 لشحنة مالهاش استثناء. بيتملا من تريجر على jt_events. التصنيف والملاحظة من الواجهة عبر jt_issue_save بس.';
comment on column public.jt_issues.verdict is
  'تصنيف الموظف: fake_update · real_delay (تأجيل حقيقي) · real_refusal · no_answer_us · data_fixed · jt_error';
comment on column public.jt_issues.outcome is
  'بتتحسب لوحدها من مسحات J&T: delivered · returning (172 بدأ المرتجع) · returned (13/111 رجعت لنا). NULL = لسه مع J&T';
comment on column public.jt_issues.verdict_by_name is
  'لقطة اسم الموظف وقت التصنيف — بتفضل لو الموظف اتمسح (نفس فكرة user_name في upsell_events).';
comment on column public.jt_issues.updated_at is
  'آخر تغيير في الصف لأي سبب (مسح J&T جديد · النتيجة · تصنيف الموظف) — التاب بيعمل منه مزامنة تدريجية بدل ما يجيب كله.';

-- القراية لأي حد في نفس المتجر. الكتابة: التريجر (DEFINER) و jt_issue_save بس — مفيش سياسة
-- INSERT/UPDATE/DELETE، فالموظف مايقدرش يزوّر نتيجة أو يمسح استثناء من الكونسول.
alter table public.jt_issues enable row level security;
drop policy if exists jt_issues_select_same_tenant on public.jt_issues;
create policy jt_issues_select_same_tenant on public.jt_issues
  for select to authenticated
  using (is_super_admin() or tenant_id = app.current_tenant_id());
revoke all on public.jt_issues from anon, authenticated;
grant select on public.jt_issues to authenticated;

-- 3) أدوات
create or replace function app.jt_scan_ts(p text) returns timestamptz
language sql stable set search_path = pg_catalog, pg_temp as $fn$
  select case when p ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' then p::timestamp at time zone 'Etc/GMT-2' end
$fn$;

create or replace function app.jt_issue_courier(p_bill text, p_before timestamptz)
returns table (courier_name text, courier_phone text, branch text, branch_phone text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  -- آخر مسح «خرج للتسليم» (94) قبل المشكلة: J&T بتكتب فيه اسم المندوب ورقمه ورقم الفرع
  with s as (
    select app.jt_scan_ts(d->>'scanTime') as t, d->>'desc' as descr, nullif(d->>'scanNetworkName', '') as net
    from jt_events e
    cross join lateral jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
                                                 then e.payload->'details' else '[]'::jsonb end) d
    where e.bill_code = p_bill and e.kind = 'trace' and coalesce(e.digest_ok, false) and d->>'scanTypeCode' = '94'
    union all
    select app.jt_scan_ts(e.payload->>'scanTime'), e.payload->>'desc', null
    from jt_events e
    where e.bill_code = p_bill and e.kind = 'pull' and e.payload->>'scanCode' = '94'
  )
  select nullif(trim(substring(descr from 'courier ([^(]+)\(')), ''),
         substring(descr from 'courier [^(]*\((0[0-9]{10})\)'),
         coalesce(net, substring(descr from '】【([^】]+)】')),
         substring(descr from 'phone number[：:]\s*(0[0-9]{10})')
  from s
  where t is not null and t <= p_before
  order by t desc
  limit 1
$fn$;

create or replace function app.jt_issue_refresh_outcome(p_bill text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_out text;
  v_at  timestamptz;
begin
  if not exists (select 1 from jt_issues where tracking_no = p_bill) then return; end if;
  with ev as (
    select app.jt_scan_ts(d->>'scanTime') as t,
           case when d->>'scanTypeCode' ~ '^\d+$' then (d->>'scanTypeCode')::int end as code,
           coalesce(d->>'isRefund', '') = '1' as rf,
           coalesce(d->>'scanType', '') as st
    from jt_events e
    cross join lateral jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
                                                 then e.payload->'details' else '[]'::jsonb end) d
    where e.bill_code = p_bill and e.kind = 'trace' and coalesce(e.digest_ok, false)
    union all
    select app.jt_scan_ts(e.payload->>'scanTime'),
           case when e.payload->>'scanCode' ~ '^\d+$' then (e.payload->>'scanCode')::int end,
           coalesce(e.payload->>'refund', '') = 'true' or coalesce(e.payload->>'scanCode', '') like 'refund:%',
           coalesce(e.payload->>'scanType', '')
    from jt_events e
    where e.bill_code = p_bill and e.kind = 'pull'
  ), r as (
    select min(t) filter (where code in (13, 111) or st in ('Returned Signed', 'Return Sign')) as returned_at,
           min(t) filter (where code = 172 or rf)                                            as returning_at,
           min(t) filter (where code = 100 and not rf)                                       as delivered_at
    from ev where t is not null
  )
  select case when returned_at is not null then 'returned'
              when delivered_at is not null and (returning_at is null or delivered_at < returning_at) then 'delivered'
              when returning_at is not null then 'returning' end,
         case when returned_at is not null then returned_at
              when delivered_at is not null and (returning_at is null or delivered_at < returning_at) then delivered_at
              when returning_at is not null then returning_at end
    into v_out, v_at
  from r;

  update jt_issues set outcome = v_out, outcome_at = v_at, updated_at = now()
   where tracking_no = p_bill and (outcome is distinct from v_out or outcome_at is distinct from v_at);
end
$fn$;

create or replace function app.jt_issue_apply_scan(p_bill text, p_order_id uuid, p_tenant_id uuid, s jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_code_txt text := coalesce(nullif(s->>'scanTypeCode', ''), nullif(s->>'scanCode', ''));
  v_code     int;
  v_st       text := coalesce(s->>'scanType', '');
  v_t        timestamptz := app.jt_scan_ts(s->>'scanTime');
  v_refund   boolean;
  v_order    uuid := p_order_id;
  v_tenant   uuid := p_tenant_id;
  v_desc     text := coalesce(s->>'desc', '');
  v_pd       text := coalesce(s->>'probleDescription', '');
  v_ptype    text := nullif(trim(coalesce(s->>'problemType', '')), '');
  v_en       text;
  v_ar       text;
  v_note     text;
  v_photo    text;
  c          record;
begin
  if coalesce(p_bill, '') = '' or v_t is null then return; end if;
  if v_code_txt ~ '^\d+$' then v_code := v_code_txt::int; end if;
  v_refund := coalesce(s->>'isRefund', '') = '1' or coalesce(s->>'refund', '') = 'true'
              or coalesce(v_code_txt, '') like 'refund:%';

  if (v_code = 110 and not v_refund)
     or (v_code = 172 and not exists (select 1 from jt_issues where tracking_no = p_bill and kind = 'exception')) then

    if v_order is null or v_tenant is null then
      select o.id, o.tenant_id into v_order, v_tenant
        from orders o
       where o.tracking_no = p_bill and o.shipping_carrier = 'jt'
       order by o.created_at desc
       limit 1;
    end if;
    if v_order is null or v_tenant is null then return; end if;   -- مش بوليصة من أوردراتنا

    select * into c from app.jt_issue_courier(p_bill, v_t);

    if v_code = 110 then
      if v_ptype is not null then
        select m.reason_en, m.reason_ar into v_en, v_ar from jt_problem_map m where m.problem_type = v_ptype;
      end if;
      v_en := coalesce(v_en,
                       nullif(trim(split_part(v_pd, ',', 3)), ''),
                       substring(v_desc from 'abnormal reason is 【([^】]*)】'),
                       nullif(trim(substring(v_desc from '^【[^】]*】([^，,]+)')), ''));
      v_ar := coalesce(v_ar,
                       case when v_en ilike 'Fail to Receive%' then 'فشل التسليم (J&T مابعتتش السبب)' end,
                       v_en, 'استثناء من J&T');
      v_note  := nullif(trim(substring(v_pd from '^[^,]*,[^,]*,[^,]*,(.*)$')), '');
      v_photo := nullif(trim(split_part(coalesce(s->>'problemPicUrl', ''), ',', 1)), '');

      insert into jt_issues as i (tenant_id, order_id, tracking_no, kind, event_at, reason_code, reason_en, reason_ar,
                                  courier_note, branch, branch_phone, courier_name, courier_phone, photo_url)
      values (v_tenant, v_order, p_bill, 'exception', v_t, v_ptype, v_en, v_ar, v_note,
              coalesce(nullif(s->>'scanNetworkName', ''), c.branch), c.branch_phone, c.courier_name,
              coalesce(c.courier_phone, substring(v_desc from 'courier:\s*(0[0-9]{10})')), v_photo)
      on conflict (tracking_no, kind, event_at) do update set
        reason_code   = coalesce(excluded.reason_code, i.reason_code),
        reason_en     = case when excluded.reason_code is not null then excluded.reason_en else coalesce(i.reason_en, excluded.reason_en) end,
        reason_ar     = case when excluded.reason_code is not null then excluded.reason_ar else coalesce(i.reason_ar, excluded.reason_ar) end,
        courier_note  = coalesce(i.courier_note, excluded.courier_note),
        photo_url     = coalesce(i.photo_url, excluded.photo_url),
        branch        = coalesce(i.branch, excluded.branch),
        branch_phone  = coalesce(i.branch_phone, excluded.branch_phone),
        courier_name  = coalesce(i.courier_name, excluded.courier_name),
        courier_phone = coalesce(i.courier_phone, excluded.courier_phone),
        updated_at    = now()
      where (excluded.reason_code is not null and i.reason_code is distinct from excluded.reason_code)
         or (i.courier_note  is null and excluded.courier_note  is not null)
         or (i.photo_url     is null and excluded.photo_url     is not null)
         or (i.branch        is null and excluded.branch        is not null)
         or (i.branch_phone  is null and excluded.branch_phone  is not null)
         or (i.courier_name  is null and excluded.courier_name  is not null)
         or (i.courier_phone is null and excluded.courier_phone is not null);
    else
      insert into jt_issues (tenant_id, order_id, tracking_no, kind, event_at, reason_en, reason_ar,
                             branch, branch_phone, courier_name, courier_phone)
      values (v_tenant, v_order, p_bill, 'return', v_t, 'Returned parcel scan without an exception',
              'بدأت ترجع من غير ما J&T تسجّل أي سبب',
              coalesce(nullif(s->>'scanNetworkName', ''), substring(v_desc from '】【([^】]+)】'), substring(v_desc from '^【([^】]+)】')),
              c.branch_phone, c.courier_name, c.courier_phone)
      on conflict (tracking_no, kind, event_at) do nothing;
    end if;
  end if;

  if v_code in (100, 110, 172, 13, 111) or v_refund or v_st in ('Returned Signed', 'Return Sign') then
    perform app.jt_issue_refresh_outcome(p_bill);
  end if;
end
$fn$;

-- 🔴 lock_timeout 2s: لو صف في jt_issues مقفول (backfill بيتعاد · ترانزاكشن طويلة في SQL Editor) الانتظار
-- بيقع بـ55P03 والـexception block بيمسكه. من غيره الانتظار بيوصل لـstatement_timeout (8s على الحي) = 57014،
-- و`when others` **مابيمسكش** query_canceled — فإدخال الخام كان هيقع وjt-status يرجّع 500 لـJ&T.
create or replace function app.jt_issues_capture() returns trigger
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '2s' as $fn$
declare
  d jsonb;
begin
  if new.kind not in ('trace', 'pull') or not coalesce(new.digest_ok, false) then return null; end if;
  begin
    if new.kind = 'trace' then
      if jsonb_typeof(new.payload->'details') = 'array' then
        for d in select x from jsonb_array_elements(new.payload->'details') as t(x) loop
          perform app.jt_issue_apply_scan(coalesce(nullif(d->>'billCode', ''), new.bill_code), new.order_id, new.tenant_id, d);
        end loop;
      end if;
    else
      perform app.jt_issue_apply_scan(new.bill_code, new.order_id, new.tenant_id, new.payload);
    end if;
  exception when others then
    -- 🔴 ممنوع نوقّع الإدخال الخام: jt-status بيرجّع 500 لـJ&T لو فشل
    raise warning 'jt_issues_capture: jt_events.id=% → % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end
$fn$;

drop trigger if exists trg_jt_issues_capture on public.jt_events;
create trigger trg_jt_issues_capture after insert on public.jt_events
  for each row execute function app.jt_issues_capture();

-- 4) الواجهة بتقرا من هنا: الاستثناء + العميل. security_invoker = RLS بتاعة jt_issues و orders
-- الاتنين شغالين بصلاحيات الموظف (درس 13) — وأعمدة صريحة مش * (درس 12).
-- «المحاولة» = ترتيب الاستثناء بين استثناءات نفس البوليصة (window على كل صفوف المتجر —
-- فلتر التاريخ من الواجهة بيتطبّق بعدها فالرقم مابيتغيّرش مع الفترة).
create or replace view public.v_jt_issues with (security_invoker = on) as
select i.id, i.tenant_id, i.order_id, i.tracking_no, i.kind, i.event_at,
       i.reason_code, i.reason_en, i.reason_ar, i.courier_note,
       i.branch, i.branch_phone, i.courier_name, i.courier_phone, i.photo_url,
       i.verdict, i.staff_note, i.staff_updated_at, i.verdict_by_name,
       i.outcome, i.outcome_at, i.created_at, i.updated_at,
       case when i.kind = 'exception' then
         count(*) filter (where i.kind = 'exception')
           over (partition by i.tracking_no order by i.event_at rows between unbounded preceding and current row)
       end as attempt,
       o.order_uid, o.customer_name, o.phone, o.alt_phone, o.city, o.address,
       o.ship_prov, o.ship_city, o.ship_area, o.product_name, o.total_cost, o.jt_cod_amount,
       o.status as order_status
from public.jt_issues i
left join public.orders o on o.id = i.order_id;
revoke all on public.v_jt_issues from anon, authenticated;
grant select on public.v_jt_issues to authenticated;

-- 5) حفظ تصنيف الموظف وملاحظته — DEFINER لأن مفيش سياسة UPDATE على الجدول، والدالة بتعيد
-- حراسة الـRLS بإيدها (نفس نمط save_order_products). الاسم بيتقرا من البروفايل على السيرفر
-- مش من المتصفح، فمحدش يقدر يسجّل باسم زميله.
create or replace function public.jt_issue_save(p_id bigint, p_verdict text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_verdict text := nullif(trim(coalesce(p_verdict, '')), '');
  v_note    text := nullif(left(trim(coalesce(p_note, '')), 2000), '');
  v_name    text;
  r         jt_issues;
begin
  if v_tenant is null or not app.is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_verdict is not null and v_verdict not in
     ('fake_update', 'real_delay', 'real_refusal', 'no_answer_us', 'data_fixed', 'jt_error') then
    raise exception 'bad_verdict' using errcode = '22023';
  end if;
  select nullif(trim(up.full_name), '') into v_name from user_profiles up where up.id = auth.uid();

  update jt_issues i
     set verdict = v_verdict, staff_note = v_note, staff_updated_at = now(), updated_at = now(),
         verdict_by = auth.uid(), verdict_by_name = coalesce(v_name, 'موظف')
   where i.id = p_id and i.tenant_id = v_tenant
     and (i.verdict is distinct from v_verdict or i.staff_note is distinct from v_note)
  returning i.* into r;
  if not found then
    select * into r from jt_issues i where i.id = p_id and i.tenant_id = v_tenant;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('id', r.id, 'verdict', r.verdict, 'staff_note', r.staff_note,
                            'staff_updated_at', r.staff_updated_at, 'verdict_by_name', r.verdict_by_name);
end
$fn$;
comment on function public.jt_issue_save(bigint, text, text) is
  'تاب استثناءات الشحن: حفظ التصنيف والملاحظة + مين وإمتى. نفس القيم = مفيش تعديل (مابيغيّرش اسم اللي سجّل).';

-- 6) Backfill — بيعدّي على كل الأحداث الخام بالترتيب (idempotent)
create or replace function app.jt_issues_backfill() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  r        record;
  b        text;
  v_scans  int := 0;
  v_before int := (select count(*) from jt_issues);
begin
  for r in
    select x.bill, x.order_id, x.tenant_id, x.scan
    from (
      select coalesce(nullif(d->>'billCode', ''), e.bill_code) as bill, e.order_id, e.tenant_id, d as scan,
             app.jt_scan_ts(d->>'scanTime') as t, 0 as src, e.id
      from jt_events e
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
                                                   then e.payload->'details' else '[]'::jsonb end) d
      where e.kind = 'trace' and coalesce(e.digest_ok, false) and d->>'scanTypeCode' in ('110', '172')
      union all
      select e.bill_code, e.order_id, e.tenant_id, e.payload, app.jt_scan_ts(e.payload->>'scanTime'), 1, e.id
      from jt_events e
      where e.kind = 'pull' and coalesce(e.digest_ok, false) and e.payload->>'scanCode' in ('110', '172')
    ) x
    where x.t is not null
    order by x.t, x.src, x.id
  loop
    perform app.jt_issue_apply_scan(r.bill, r.order_id, r.tenant_id, r.scan);
    v_scans := v_scans + 1;
  end loop;
  for b in select distinct tracking_no from jt_issues loop
    perform app.jt_issue_refresh_outcome(b);
  end loop;
  return jsonb_build_object('scans', v_scans, 'issues_before', v_before, 'issues_after', (select count(*) from jt_issues));
end
$fn$;

-- 7) الصلاحيات
revoke all on function app.jt_scan_ts(text)                             from public, anon, authenticated;
revoke all on function app.jt_issue_courier(text, timestamptz)          from public, anon, authenticated;
revoke all on function app.jt_issue_refresh_outcome(text)               from public, anon, authenticated;
revoke all on function app.jt_issue_apply_scan(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function app.jt_issues_capture()                          from public, anon, authenticated;
revoke all on function app.jt_issues_backfill()                         from public, anon, authenticated;
revoke all on function public.jt_issue_save(bigint, text, text)         from public, anon;
grant execute on function public.jt_issue_save(bigint, text, text)      to authenticated;

-- 8) لحظي: الاستثناء الجديد والنتيجة بيوصلوا للتاب من غير ريفريش (الـRLS بتحكم مين يشوف)
do $do$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jt_issues') then
    alter publication supabase_realtime add table public.jt_issues;
  end if;
end
$do$;

-- 9) املا الجدول من أحداث J&T اللي فاتت
select app.jt_issues_backfill();

notify pgrst, 'reload schema';
