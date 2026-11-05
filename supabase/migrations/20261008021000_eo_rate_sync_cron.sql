-- eo_rate_sync_cron (8 أكتوبر) — سحب نسبة استلام العميل من EasyOrders كل دقيقتين.
--
-- pg_cron → pg_net → eo-rate-sync. **بس لو فيه مرشّحين** (`where exists`) — النداء الفاضي بيكلّف
-- استعلام واحد ومفيش أي نداء لـEasyOrders. التقييم بيبقى جاهز عندهم بعد ~0.5ث من الإنشاء، والمرشّح
-- لازم يكون عدّى 45ث → الشارة بتظهر في اللوحة خلال ~1–3 دقايق من نزول الأوردر.
-- التوكن بيتقرا من platform_settings وقت التنفيذ — مفيش سر هنا. ومفتاح EasyOrders في الـVault.
-- ⚠️ دليل الحياة = eo_sync_runs (بيتسجّل مع كل تشغيل فيه مرشّحين). صمت الجدول طول ما فيه أوردرات
-- EasyOrders من غير تقييم أقدم من 15 دقيقة = السحب واقف.
select cron.schedule('sahl-eo-rate-sync', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/eo-rate-sync',
    body := jsonb_build_object('limit', 30),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-diag-token', (select value from public.platform_settings where key = 'jt_diag_token')),
    timeout_milliseconds := 60000)
  where exists (select 1 from public.eo_rate_candidates_v1(1));
$cron$);
