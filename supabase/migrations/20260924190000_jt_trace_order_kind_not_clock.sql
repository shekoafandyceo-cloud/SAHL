-- 🔴 الـcallbacks من نوع order (已取件/已揽收 — «اتاخد من التاجر») كانت بتقدّم carrier_status_at،
-- وحارس stale بيقارن مسح التتبع بالوقت ده. J&T بتبعت order بعد ما مسح «Sending scan» يحصل
-- بدقيقة-اتنين، فالمسح الحقيقي كان بيتحسب stale ويترمي — 32 أوردر فضلوا BOSTA AUTO
-- وهم في السكة فعلاً (اتقاس 24 سبتمبر: 17232 → order 16:58:21 ثم trace 16:56:22 = stale).
--
-- الإصلاح:
--   • order:* بيكتب carrier_status_raw/code **بس لو مفيش مسح تتبع لسه** — ومابيلمسش carrier_status_at أبداً.
--   • حارس stale مابيتفعّلش لو الحالة الخام الحالية جاية من order:* (الصفوف القديمة).
create or replace function app.jt_apply_trace(p_bill_code text, p_scan_type text, p_scan_code text, p_scan_at timestamp with time zone, p_desc text)
returns jsonb language plpgsql security definer set search_path = public, app
as $function$
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
      'by', 'J&T API', 'reason', nullif(left(coalesce(p_desc,''),120),'')))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $function$;
