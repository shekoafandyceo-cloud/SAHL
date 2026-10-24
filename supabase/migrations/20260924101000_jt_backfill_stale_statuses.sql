-- J&T — تصحيح الأوردرات اللي وقفت على 'BOSTA AUTO' قبل ما jt_status_map تتبني.
-- (اتنفّذ 24 سبتمبر 2026 10:10 UTC بموافقة المالك — مسجّل هنا للتأريخ.)
--
-- 🔴 مش idempotent بالمعنى الحرفي لكنه **آمن للإعادة**: app.jt_apply_trace
-- بترجّع 'same_status' لو الحالة زي ما هي، و'stale' لو المسح أقدم من آخر
-- تحديث اتسجّل. يعني تشغيله تاني مابيعملش حاجة.
--
-- الأثر المقيس وقت التنفيذ: 26 أوردر · status_set للـ26 · صفر مرفوض
--   21 Delivered · 2 Exception · 2 In transit between Hubs · 1 Returned to business
-- والآثار الجانبية (اتقاست بترانزاكشن راجعة قبلها):
--   • التلجرام صفر — tg_log_status_change بتبعت بس لما `by` فيها «واتساب»
--   • العمولات من غير تغيير (void 9 / earned 8 / pending 14 قبل وبعد)
--   • inventory_cost_snapshot 7,040 → 22,855 على نفس الـ109 صف — تريجر
--     lock_cogs_on_delivery بيجمّد تكلفة البضاعة لحظة التسليم. **مقصود**.
DO $$
DECLARE r record; res jsonb; v_notes jsonb := '{}'::jsonb; k text;
BEGIN
  FOR r IN
    with stale as (
      select id, tracking_no from orders
      where shipping_carrier = 'jt' and status = 'BOSTA AUTO' and tracking_no is not null
    ),
    scans as (
      select e.bill_code,
             (d->>'scanType') st, (d->>'scanTypeCode') code,
             (d->>'scanTime') tm, (d->>'desc') ds,
             row_number() over (partition by e.bill_code order by (d->>'scanTime') desc) rn
      from jt_events e
      cross join lateral jsonb_array_elements(coalesce(e.payload->'details','[]'::jsonb)) d
      where e.kind = 'trace' and e.digest_ok
    )
    select s.* from stale st join scans s on s.bill_code = st.tracking_no and s.rn = 1
  LOOP
    res := app.jt_apply_trace(r.bill_code, r.st, coalesce(r.code,''),
             (r.tm)::timestamp at time zone 'Africa/Cairo', r.ds);
    k := coalesce(res->>'note','?');
    v_notes := jsonb_set(v_notes, array[k], to_jsonb(coalesce((v_notes->>k)::int,0)+1));
  END LOOP;
  RAISE NOTICE 'jt backfill: %', v_notes;
END$$;
