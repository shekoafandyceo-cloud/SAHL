-- بعد إصلاحين (24 سبتمبر): وقت J&T = UTC+2 ثابت (jt-status v4) · وorder:* مابقاش بيقدّم الساعة.
-- 1) الأوقات القديمة اتخزّنت متأخرة ساعة (كانت بتتقرا +3) → +1 ساعة، للصفوف اللي مجالهاش أي
--    حدث بعد نشر v4 (T0) — اللي جالها اتكتبت بالوقت الصح.
-- 2) إعادة تشغيل آخر مسح «ذهاب» لكل بوليصة حالتها مش مطابقة للخريطة: الـ32 اللي علقوا BOSTA AUTO
--    (مسحهم اترمى stale بسبب order:*) + 17264/17266 (فضلوا In transit برغم مسح 172 — مسحات رحلة
--    المرتجع كانت بتتطابق على حالات الذهاب). carrier_status_at بيتصفّر للصفوف دي بس عشان المسح
--    الحاسم يعدّي من حارس stale — والدالة نفسها بتطبّق حارس final_state_kept.
do $$
declare t0 timestamptz := to_timestamp(1790284271); r record; n_shift int; n_set int := 0;
begin
  update orders o set carrier_status_at = o.carrier_status_at + interval '1 hour'
   where o.shipping_carrier = 'jt' and o.carrier_status_at is not null
     and not exists (select 1 from jt_events e where e.bill_code = o.tracking_no and e.received_at >= t0);
  get diagnostics n_shift = row_count;

  for r in
    with d as (
      select e.bill_code, x->>'scanTypeCode' code, x->>'scanType' t, coalesce(x->>'isRefund','') rf, x->>'scanTime' st, x->>'desc' ds
        from jt_events e, jsonb_array_elements(e.payload->'details') x
       where e.kind = 'trace' and e.digest_ok and (x->>'scanTime') ~ '^\d{4}-\d\d-\d\d \d\d:\d\d')
    select distinct on (d.bill_code) d.*, o.id oid
      from d join orders o on o.tracking_no = d.bill_code and o.shipping_carrier = 'jt'
     where not (d.rf = '1' and coalesce(d.code,'') not in ('13','172'))
     order by d.bill_code, d.st desc
  loop
    if exists (select 1 from orders o join jt_status_map m
                on m.scan_type_code = coalesce(nullif(r.code,''), 'name:'||lower(r.t))
               where o.id = r.oid and m.sahl_status is distinct from o.status) then
      update orders set carrier_status_at = null where id = r.oid;
      if (app.jt_apply_trace(r.bill_code, r.t, coalesce(r.code,''),
            (r.st::timestamp - interval '2 hours') at time zone 'UTC', r.ds)->>'note') = 'status_set' then
        n_set := n_set + 1;
      end if;
    end if;
  end loop;
  raise notice 'shifted %, status_set %', n_shift, n_set;
end $$;
