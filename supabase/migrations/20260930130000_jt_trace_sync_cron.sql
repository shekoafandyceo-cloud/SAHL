-- jt_trace_sync_cron (30 سبتمبر) — المصالحة بالسحب كل 15 دقيقة.
--
-- 🔴 ليه: الـpush من J&T بيضيع ~1% (19 من 1,995 مسح) — 17309 فضل «استثناء» 3 أيام
-- وهو متسلّم ومتحصّل لأن مسح التسليم (100) عمره ما وصل jt-status. trace_sync بيسحب
-- logistics/trace لكل أوردر J&T لسه ماوصلش حالة نهائية ويطبّق المسحات الناقصة على
-- **نفس** jt_apply_trace (نفس الخريطة ونفس الحراسات).
--
-- ⚠️ مزحزح 7 دقايق عن sahl-jt-fee-sync (*/15) عشان الاتنين مايضربوش J&T في نفس الثانية،
-- وعشان التسليم اللي المصالحة تلقطه تكلفته تتقفل في دورة fee_sync اللي بعدها.
-- ⚠️ من غير شرط `where exists` (بعكس fee_sync) — كل تشغيل بيتسجّل في jt_sync_runs،
-- والواجهة بتنبّه الأدمن لو آخر تشغيل ناجح أقدم من ساعة. شرط = صمت = مفيش دليل حياة.
-- التوكن بيتقرا من platform_settings وقت التنفيذ — مفيش سر هنا.
select cron.unschedule('sahl-jt-trace-sync') where exists (select 1 from cron.job where jobname = 'sahl-jt-trace-sync');
select cron.schedule('sahl-jt-trace-sync', '7-59/15 * * * *', $cron$
  select net.http_post(
    url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-lookup',
    body := jsonb_build_object('action', 'trace_sync', 'limit', 300),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-diag-token', (select value from public.platform_settings where key = 'jt_diag_token')),
    timeout_milliseconds := 120000);
$cron$);
