-- traceNode 13 = "Return signature" (tools/jt/docs/trace_subscribe.md) — المرتجع اتسلّم للمرسل.
-- ظهر أول مرة 24 سبتمبر 12:29 (القاهرة) على 3 بوالص كانوا Out for delivery.
-- ⚠️ الكود هنا = رقم traceNode نفسه، على عكس باقي الأنواع (10/50/92/94/100/110/172).
insert into public.jt_status_map (scan_type_code, scan_type, sahl_status, note)
values ('13', 'Returned Signed', 'Returned to business',
        'traceNode 13 = Return signature — المرتجع اتسلّم للمرسل (24 سبتمبر)')
on conflict (scan_type_code) do update
  set scan_type = excluded.scan_type, sahl_status = excluded.sahl_status, note = excluded.note;

-- إعادة تشغيل آخر مسح للأوردرات اللي وصلها الكود ده قبل الخريطة (آمن للإعادة:
-- same_status لو اتطبّق قبل كده). اتجرّب بترانزاكشن راجعة: 3 status_set · تلجرام صفر.
DO $$
DECLARE r record;
BEGIN
  FOR r IN select o.tracking_no, o.carrier_status_raw st, o.carrier_status_code code, o.carrier_status_at at
           from public.orders o
           where o.shipping_carrier = 'jt' and o.carrier_status_code = '13' and o.status <> 'Returned to business'
  LOOP
    PERFORM app.jt_apply_trace(r.tracking_no, r.st, r.code, r.at, 'replay: map 13 added');
  END LOOP;
END$$;
