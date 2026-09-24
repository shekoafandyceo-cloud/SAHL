-- مزامنة تكلفة J&T النهائية كل 15 دقيقة: pg_cron → pg_net → jt-lookup {action: fee_sync}.
-- التوكن بيتقرا من platform_settings **وقت التنفيذ** — مش محفور في أمر الجدولة (قاعدة أمان 3).
-- fee_sync بياخد بس المسلّم/المرتجع اللي رقمه لسه مش نهائي وماتزامنش من 25 دقيقة (jt_fee_candidates)،
-- فالنداء الفاضي بيكلّف استعلام واحد ومفيش أي نداء لـJ&T.
select cron.schedule('sahl-jt-fee-sync', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-lookup',
    body := jsonb_build_object('action', 'fee_sync', 'limit', 120),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-diag-token', (select value from public.platform_settings where key = 'jt_diag_token')),
    timeout_milliseconds := 60000)
  where exists (select 1 from app.jt_fee_candidates(1));
$cron$);
