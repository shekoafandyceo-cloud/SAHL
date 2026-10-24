-- v79 (16 أكتوبر): cron.job_run_details عمره ما بيتمسح — 21,821 صف / 11 MB (12% من الداتابيز)
-- وبيزيد ~3,070 صف في اليوم (~1.6 MB) من الـ6 jobs (wa-ofd كل دقيقة · eo/ship-rank كل دقيقتين …).
-- مفيش حاجة بتقراه (اتقاس) غير التشخيص بإيدنا — 7 أيام كفاية (wa_ofd_tick فشله بيتسجّل هنا بس،
-- و`app.wa_ofd_health` هو دليل الحياة المستقل). 03:17 UTC (cron.timezone=GMT) = 06:17 القاهرة صيفي / 05:17 شتوي.
select cron.schedule('sahl-cron-history-purge', '17 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
