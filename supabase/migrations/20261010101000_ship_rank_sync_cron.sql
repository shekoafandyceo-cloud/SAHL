-- ship_rank_sync_cron (10 أكتوبر) — نسبة استلام العميل من شركة الشحن كل دقيقتين (مزحزح دقيقة عن sahl-eo-rate-sync).
--
-- pg_cron → pg_net → ship-rank-sync. **بس لو فيه مرشّحين** (`where exists`) — النداء الفاضي بيكلّف استعلام واحد ومفيش
-- أي نداء لبوسطة. أوردر جديد = مرشّح على طول → النسبة بتظهر في اللوحة خلال ~1–3 دقايق من نزوله (ريل-تايم).
-- التوكن بيتقرا من platform_settings وقت التنفيذ — مفيش سر هنا. ومفتاح بوسطة في الـVault (`bosta_rank_key:<tenant_id>`).
-- ⚠️ دليل الحياة = ship_rank_runs (بيتسجّل مع كل تشغيل فيه مرشّحين). أوردرات أقدم من 10 دقايق ship_rank_at فاضي = السحب واقف.
select cron.schedule('sahl-ship-rank-sync', '1-59/2 * * * *', $cron$
  select net.http_post(
    url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/ship-rank-sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-diag-token', (select value from public.platform_settings where key = 'jt_diag_token')),
    timeout_milliseconds := 60000)
  where exists (select 1 from public.ship_rank_candidates_v1(1, null));
$cron$);
