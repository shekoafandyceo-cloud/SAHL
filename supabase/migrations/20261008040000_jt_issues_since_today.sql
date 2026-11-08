-- jt_issues_since_today (8 أكتوبر) — تاب «استثناءات الشحن» بيتابع من النهاردة بس (طلب المالك).
--
-- «انا عاوز في التاب بتاعت Exception دي يتابع من اول الي هيحصل النهاردة، و يسيبه من اي حالة حصلت قبل كدا خلاص.»
--
-- jt-issues-tab.sql اتشغّل 8 أكتوبر 02:50 UTC والـbackfill دخّل 332 استثناء من 22 سبتمبر لـ7 أكتوبر — صفر منهم النهاردة.
--
-- الشكل (من غير مسح — الصفوف القديمة فاضلة في الجدول، متجمّدة ومش ظاهرة):
--   • app.jt_issues_since() = بداية التتبع: 8 أكتوبر 2026 00:00 بتوقيت القاهرة (= 7 أكتوبر 21:00 UTC — مصر صيفي +3).
--   • v_jt_issues بيعرض اللي event_at بتاعه من البداية دي وبعدها بس — والواجهة بتقرا من الفيو في كل حتة
--     (التحميل · المزامنة · الشارة)، فمفيش تعديل فرونت.
--   • «المحاولة» لسه بتتعدّ على كل استثناءات البوليصة (القديمة كمان) — استثناء النهاردة لشحنة اتعثّرت مرتين قبل كده
--     = «المحاولة 3» وده الحقيقي. الفلتر بعد الـwindow.
--   • jt_issue_apply_scan مابيعملش صف لمسح أقدم من البداية (push متأخر · pull · backfill).
--   • و172 لشحنة ليها استثناء قديم = مفيش صف «رجوع من غير سبب» (الصف القديم موجود في الجدول — ده سبب إن المسح مش مسح).
--   • jt_issue_refresh_outcome مابتلمسش الصفوف القديمة → مفيش updated_at ولا realtime منها.
--   • jt_issues_backfill بيحترم البداية لو اتعاد.
-- ⚠️ صفين قدام كانوا اتصنّفوا (02:54 UTC) — فاضلين في الجدول ومش ظاهرين.
-- 🔴 مفيش أي أمر حذف هنا (درس 53).

set local lock_timeout = '4s';

-- ── 1) بداية التتبع ──────────────────────────────────────────────────────
create or replace function app.jt_issues_since() returns timestamptz
language sql immutable set search_path = pg_catalog as $fn$
  select timestamptz '2026-10-07 21:00:00+00'
$fn$;
comment on function app.jt_issues_since() is
  'تاب استثناءات الشحن بيتابع من هنا: 8 أكتوبر 2026 00:00 القاهرة (طلب المالك). اللي قبله فاضل في jt_issues متجمّد ومش ظاهر في v_jt_issues.';
revoke all on function app.jt_issues_since() from public, anon;
grant execute on function app.jt_issues_since() to authenticated, service_role;

-- ── 2) الفيو: من البداية وبعدها — «المحاولة» قبل الفلتر ──────────────────────
create or replace view public.v_jt_issues with (security_invoker = on) as
select i.id, i.tenant_id, i.order_id, i.tracking_no, i.kind, i.event_at,
       i.reason_code, i.reason_en, i.reason_ar, i.courier_note,
       i.branch, i.branch_phone, i.courier_name, i.courier_phone, i.photo_url,
       i.verdict, i.staff_note, i.staff_updated_at, i.verdict_by_name,
       i.outcome, i.outcome_at, i.created_at, i.updated_at,
       i.attempt,
       o.order_uid, o.customer_name, o.phone, o.alt_phone, o.city, o.address,
       o.ship_prov, o.ship_city, o.ship_area, o.product_name, o.total_cost, o.jt_cod_amount,
       o.status as order_status
from (
  select x.id, x.tenant_id, x.order_id, x.tracking_no, x.kind, x.event_at,
         x.reason_code, x.reason_en, x.reason_ar, x.courier_note,
         x.branch, x.branch_phone, x.courier_name, x.courier_phone, x.photo_url,
         x.verdict, x.staff_note, x.staff_updated_at, x.verdict_by_name,
         x.outcome, x.outcome_at, x.created_at, x.updated_at,
         case when x.kind = 'exception' then
           count(*) filter (where x.kind = 'exception')
             over (partition by x.tracking_no order by x.event_at rows between unbounded preceding and current row)
         end as attempt
  from public.jt_issues x
) i
left join public.orders o on o.id = i.order_id
where i.event_at >= app.jt_issues_since();
revoke all on public.v_jt_issues from anon, authenticated;
grant select on public.v_jt_issues to authenticated;

-- ── 3) النتيجة: الصفوف القديمة متجمّدة ──────────────────────────────────────
create or replace function app.jt_issue_refresh_outcome(p_bill text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_out text;
  v_at  timestamptz;
begin
  if not exists (select 1 from jt_issues where tracking_no = p_bill and event_at >= app.jt_issues_since()) then return; end if;
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
   where tracking_no = p_bill and event_at >= app.jt_issues_since()
     and (outcome is distinct from v_out or outcome_at is distinct from v_at);
end
$fn$;

-- ── 4) التقاط المسح: مفيش صف لمسح أقدم من البداية ──────────────────────────
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

  -- 🔴 من بداية التتبع وبعدها بس (طلب المالك 8 أكتوبر). و172 بيبص على كل صفوف الاستثناء (القديمة كمان):
  -- شحنة ليها استثناء قبل البداية ورجعت النهاردة = مش «رجوع من غير سبب».
  if v_t >= app.jt_issues_since()
     and ((v_code = 110 and not v_refund)
          or (v_code = 172 and not exists (select 1 from jt_issues where tracking_no = p_bill and kind = 'exception'))) then

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

-- ── 5) الـbackfill لو اتعاد: من البداية وبعدها بس ───────────────────────────
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
    where x.t is not null and x.t >= app.jt_issues_since()
    order by x.t, x.src, x.id
  loop
    perform app.jt_issue_apply_scan(r.bill, r.order_id, r.tenant_id, r.scan);
    v_scans := v_scans + 1;
  end loop;
  for b in select distinct tracking_no from jt_issues where event_at >= app.jt_issues_since() loop
    perform app.jt_issue_refresh_outcome(b);
  end loop;
  return jsonb_build_object('scans', v_scans, 'issues_before', v_before, 'issues_after', (select count(*) from jt_issues));
end
$fn$;

revoke all on function app.jt_issue_refresh_outcome(text)               from public, anon, authenticated;
revoke all on function app.jt_issue_apply_scan(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function app.jt_issues_backfill()                         from public, anon, authenticated;

notify pgrst, 'reload schema';
