-- 17 أكتوبر 2026 — قرار المالك: تقييم EasyOrders اتشال من السيستم («مش مفيد ومضلل») · الشارة = شركة الشحن بس.
-- القياس اللي أيّد القرار: جوّه «زبالة» عند شركة الشحن، EasyOrders «منخفضة» اتسلّم منهم 64% و«مرتفعة» 46%.
--
-- 1) سحب EasyOrders (sahl-eo-rate-sync → EF eo-rate-sync) اتوقف — active=false مش unschedule (الرجوع بسطر واحد:
--    select cron.alter_job((select jobid from cron.job where jobname = 'sahl-eo-rate-sync'), active := true);).
-- 2) jt_sync_health مابقتش بتبعت eo_stale — من غيرها السحب الواقف بقصد كان هيطلّع بانر أحمر «السحب واقف» للأدمن
--    في اللوحة الحية (v76 بتقرا المفتاح ده) على كل أوردر جديد من EasyOrders.
-- 🔴 اللي اتساب عن قصد (إصلاح للأمام بس · مفيش DROP على MCP — درس 53):
--    أعمدة orders.eo_metadata/eo_rate/eo_rate_alt (تاريخ) · trg_eo_rate_capture (exception-safe — n8n لسه بيبعت eo_metadata
--    مع الإدخال ومستحيل يوقّعه) · eo_rate_checks · eo_sync_runs · دوال eo_* · مفتاح Vault eo_api_key:<tenant> · EF eo-rate-sync.

select cron.alter_job((select jobid from cron.job where jobname = 'sahl-eo-rate-sync'), active := false);

CREATE OR REPLACE FUNCTION public.jt_sync_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
  select case when not public.is_tenant_admin() then null else jsonb_build_object(
    'enabled', exists (select 1 from tenants t where t.id = app.current_tenant_id() and t.shipping_provider = 'jt'),
    'now', now(),
    'trace_last_ok', (select max(ran_at) from jt_sync_runs where job = 'trace_sync' and ok),
    'trace_last_run', (select max(ran_at) from jt_sync_runs where job = 'trace_sync'),
    'trace_last_error', (select error from jt_sync_runs where job = 'trace_sync' and not ok order by ran_at desc limit 1),
    'fee_stuck', (select coalesce(jsonb_agg(o.order_uid order by o.status_changed_at), '[]'::jsonb) from orders o
       where o.tenant_id = app.current_tenant_id() and o.shipping_carrier = 'jt' and o.status = 'Delivered'
         and not coalesce(o.jt_fee_final, false) and o.status_changed_at < now() - interval '24 hours'),
    'unmapped_48h', (select count(*) from jt_events e where e.apply_note = 'unmapped'
       and e.received_at > now() - interval '48 hours' and (e.tenant_id is null or e.tenant_id = app.current_tenant_id())),
    -- المرتجع والملغي مالهمش تحصيل — الاختلاف هناك مالوش أثر على الفلوس
    'cod_mismatch', (select coalesce(jsonb_agg(jsonb_build_object('uid', o.order_uid, 'total', o.total_cost,
         'jt', o.jt_cod_amount, 'status', o.status) order by o.created_at desc), '[]'::jsonb) from orders o
       where o.tenant_id = app.current_tenant_id() and o.shipping_carrier = 'jt' and o.jt_cod_amount is not null
         and o.jt_cod_amount <> o.total_cost
         and o.status not in ('cancelled', 'Returned to business', 'returned', 'Returned to business2')),
    -- (10 أكتوبر) نسبة استلام العميل من شركة الشحن: أوردرات رقمها سليم وماتسألتش بقالها > 15 دقيقة (الطبيعي ≤ 3)
    'rank_enabled', exists (select 1 from vault.secrets s where s.name = 'bosta_rank_key:' || app.current_tenant_id()::text),
    'rank_stale', (select count(*) from orders o where o.tenant_id = app.current_tenant_id() and o.ship_rank_at is null
       and o.created_at >= now() - interval '72 hours' and o.created_at < now() - interval '15 minutes'
       and app.ship_rank_p10(o.phone) is not null),
    'rank_last_ok', (select max(ran_at) from ship_rank_runs where ok),
    'rank_last_error', (select error from ship_rank_runs r where not r.ok
       and r.ran_at > coalesce((select max(ran_at) from ship_rank_runs where ok), '-infinity') order by r.ran_at desc limit 1),
    -- (17 أكتوبر) eo_stale (EasyOrders) اتشال — التقييم اتشال والسحب اتوقف بقصد
    -- (11 أكتوبر) رسايل «المندوب في الطريق» — دالة لوحدها ببلوك exception (لو وقعت مابتوقّعش باقي البانر)
    'ofd', app.wa_ofd_health(app.current_tenant_id())
  ) end;
$function$;
