-- v79 (16 أكتوبر): sahl_orders_stats بقت sargable — كانت أغلى استعلام في الداتابيز
-- (174,843 نداء · متوسط 1.7ث · ~300 ألف ثانية من مايو). الفلتر كان `tenant_id::text = p_tenant`
-- و`(created_at at time zone 'Africa/Cairo')::date` = Seq Scan على orders كلها في كل نداء
-- (الكروت بتناديها مرتين في كل تحميل للأوردرات). دلوقتي نفس النطاق بالظبط بس كمقارنة
-- على العمود نفسه = Index Scan على idx_orders_tenant_created.
--   • `d::timestamp at time zone 'Africa/Cairo'` = أول لحظة في اليوم ده بتوقيت القاهرة (بالصيفي) —
--     اتقاس على 1,827 يوم (2024–2028): bad=0.
--   • p_tenant مش uuid (slug · uppercase · فاضي) = نفس النتيجة القديمة (أصفار) — من غير 22P02.
--   • plan_cache_mode=force_custom_plan: الـcase بيتطوي لثابت فالـindex بيتستخدم.
-- اتجرّب بترانزاكشن راجعة على الحي بانتحال موظف: 11 حالة (أكتوبر · سبتمبر · النهارده · أبريل ·
-- 25 أكتوبر · 30–31 أكتوبر · يوليو · الكل · من · لحد · slug) = نفس الـJSON بالحرف · 1,631ms → 176ms.
-- CREATE OR REPLACE = نفس الـACL والمالك وSTABLE/INVOKER.
CREATE OR REPLACE FUNCTION public.sahl_orders_stats(p_tenant text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  delivered_arr text[] := array['delivered'];
  cancelled_arr text[] := array['cancelled'];
  returned_arr  text[] := array['returned','returned to business','returned to business2'];
  -- "جاهز للخروج" = نفس فلتر بوسطة (BOSTA_FILTER_STATUSES بعد التصغير)
  bosta_ready_arr text[] := array['bosta_assigned','bosta auto','bosta2','bosta_auto'];
  -- نفس BOSTA_POSITIVE_STATUSES (بعد التصغير) — أي حالة خرجت من Pending ودخلت رحلة التأكيد/الشحن
  positive_arr  text[] := array[
    'confirmed',
    'bosta_assigned','bosta auto','bosta2','bosta_auto',
    'delivered',
    'out for delivery','received at warehouse','route assigned','in transit between hubs','picking up from consignee','out for exchange',
    'exception',
    'returned to business','returned to business2','returned',
    'out_for_delivery','received_at_warehouse','route_assigned','in_transit','picked_up',
    'returned_to_business','returned_to_business2'
  ];
  -- نفس BOSTA_EXPECTED_STATUSES (بعد التصغير) — متوقع التحصيل
  expected_arr  text[] := array[
    'bosta_assigned','bosta auto','bosta2','bosta_auto',
    'out for delivery','received at warehouse','route assigned','in transit between hubs','picking up from consignee','out for exchange',
    'exception',
    'out_for_delivery','received_at_warehouse','route_assigned','picked_up','in_transit'
  ];
  res json;
begin
  with f as (
    select
      lower(btrim(status))            as st,
      coalesce(total_cost, 0)::numeric as amt,
      payment_stage
    from public.orders
    where tenant_id = case when p_tenant ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_tenant::uuid end
      and created_at >= coalesce(p_from::timestamp at time zone 'Africa/Cairo', '-infinity'::timestamptz)
      and created_at <  coalesce((p_to + 1)::timestamp at time zone 'Africa/Cairo', 'infinity'::timestamptz)
  )
  select json_build_object(
    -- العدّادات (s0..s5 + processed/positive لحساب النِسب)
    'total_count', count(*),
    'pending',     count(*) filter (where st = 'pending'),
    'confirmed',   count(*) filter (where st = 'confirmed'),
    'delivered',   count(*) filter (where st = any(delivered_arr)),
    'cancelled',   count(*) filter (where st = any(cancelled_arr)),
    'returned',    count(*) filter (where st = any(returned_arr)),
    'bosta_ready', count(*) filter (where st = any(bosta_ready_arr)),
    'processed',   count(*) filter (where st <> 'pending'),
    'positive',    count(*) filter (where st = any(positive_arr)),
    -- مجاميع الإيرادات (rv-*)
    'sum_total',     coalesce(sum(amt), 0),
    'sum_collected', coalesce(sum(amt) filter (where st = any(delivered_arr)), 0),
    'sum_expected',  coalesce(sum(amt) filter (where st = any(expected_arr)), 0),
    'sum_lost',      coalesce(sum(amt) filter (where st = any(cancelled_arr) or st = any(returned_arr) or st = 'failed'), 0),
    'sum_paymob',    coalesce(sum(amt) filter (where payment_stage = 'paymob'), 0)
  ) into res
  from f;

  return res;
end;
$function$
;
