-- jt_status_map — اتبنت من **716 حمولة حقيقية** (21–24 سبتمبر · 70 بوليصة · كلهم digest_ok).
-- الجدول كان فاضي عمداً لحد أول داتا حقيقية (درس 44) — وده كان القرار الصح:
--
-- 🔴 1) `scanTypeCode` اللي بييجي فعلاً **مش** الأرقام 1–15 اللي في صفحة التوثيق.
--       الأرقام دي `traceNode` (عُقد الاشتراك اللي إحنا بنطلبها)، واللي بيرجع في
--       الـcallback حاجة تانية خالص: 10 · 50 · 92 · 94 · 100 · 110 · 172.
--       لو الخريطة اتبنت على أرقام التوثيق كانت هتطلع غلط بالكامل وفي صمت.
-- 🔴 2) نوعين بيوصلوا **من غير `scanTypeCode` خالص** (`Enter branch scan` 70 حدث ·
--       `Holding scan` 19 حدث) رغم إن التوثيق كاتب الحقل إجباري (`Y`). المطابقة
--       بالكود لوحدها كانت هتسقّط 89 حدث في صمت — عشان كده فيه مفتاح احتياطي
--       بالاسم (`name:<scan_type>`) والدالة بتحسبه لوحدها.
-- 🔴 3) `scanType` بييجي **إنجليزي** (مش صيني زي حمولات الـdebugging بتاعة J&T).
--
-- ⚠️ القيم المستهدفة **كلها موجودة أصلاً** في `core/constants.js`
--    (`BOSTA_INVENTORY_STATUSES` · `BOSTA_OPERATION_STATUSES` · `BOSTA_EXPECTED_STATUSES`
--    · `DELIVERED_STATUSES` · `RETURNED_STATUSES`) — صفر قيمة جديدة، فكروت البضاعة
--    ومتوقع التحصيل ونسبة التسليم بتشتغل زي ما هي من غير أي تعديل فرونت.
--    أي قيمة جديدة هنا = أوردر بيختفي من الحسابات من غير أي خطأ (الخطر الموثّق).

insert into public.jt_status_map (scan_type_code, scan_type, sahl_status, note) values
  ('10',                      'Pickup scan',                  'Picking up from consignee', 'المندوب استلم الشحنة من مخزننا'),
  ('50',                      'Sending scan',                 'In transit between Hubs',   'خرجت من فرع/مركز لللي بعده'),
  ('92',                      'DC arrival & Station arrival', 'Received at warehouse',     'وصلت مركز فرز أو فرع'),
  ('94',                      'Delivery scan',                'Out for delivery',          'المندوب خرج يسلّمها'),
  ('100',                     'Signing scan',                 'Delivered',                 'اتسلّمت للعميل ووقّع'),
  ('110',                     'Abnormal parcels scan',        'Exception',                 'مسح استثنائي — مشكلة محتاجة متابعة'),
  ('172',                     'Returned parcel scan',         'Returned to business',      'مرتجع'),
  ('name:enter branch scan',  'Enter branch scan',            'Received at warehouse',     '🔴 بيوصل من غير scanTypeCode — المطابقة بالاسم'),
  ('name:holding scan',       'Holding scan',                 'Exception',                 '🔴 بيوصل من غير scanTypeCode — محتجزة في الفرع')
on conflict (scan_type_code) do update
  set scan_type = excluded.scan_type, sahl_status = excluded.sahl_status,
      note = excluded.note, updated_at = now();

-- المطابقة: الكود أولاً، ولو مفيش كود نستخدم مفتاح الاسم. باقي الدالة زي ما هي.
create or replace function app.jt_apply_trace(p_bill_code text, p_scan_type text, p_scan_code text, p_scan_at timestamp with time zone, p_desc text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'app'
as $function$
declare v_row orders; v_target text; v_final boolean; v_key text;
begin
  select * into v_row from orders where tracking_no = p_bill_code and shipping_carrier = 'jt' order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  if v_row.carrier_status_at is not null and p_scan_at is not null and p_scan_at < v_row.carrier_status_at then
    return jsonb_build_object('ok', true, 'note', 'stale', 'order_id', v_row.id);
  end if;
  update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
    carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
  -- 🔴 الكود أولاً ثم الاسم — نوعين من J&T بيوصلوا بلا scanTypeCode (شوف هيدر الـmigration)
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
      'by', 'J&T API', 'reason', nullif(left(coalesce(p_desc,''),120),'')))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $function$;
