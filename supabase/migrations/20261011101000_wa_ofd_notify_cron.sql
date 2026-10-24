-- wa_ofd_notify_cron (11 أكتوبر) — «المندوب في الطريق» كل دقيقة.
--
-- pg_cron → app.wa_ofd_tick(): التنضيف دايماً (رخيص — صفوف متعلّقة/retry عدّى زمنه) · ونداء الـEF (wa-ofd-notify)
-- **بس لو فيه مرشّحين** — بره 9–21 القاهرة / mode=off / متوقف / السقف اليومي = مفيش نداء خالص.
-- التوكن بيتقرا من platform_settings وقت التنفيذ (جوّه الدالة) — مفيش سر هنا.
-- ⚠️ لو المرشّحين نفسهم وقعوا، التشغيل بيفشل في cron.job_run_details بس — وapp.wa_ofd_health (استعلام مستقل) بيطلّع
--    `stale > 0` في بانر الأدمن خلال 15 دقيقة (درس 51).
-- 🔴 بيتطبّق **بعد** نشر الـEF (wa-ofd-notify) — وطول ما mode='off' الـtick بيعمل تنضيف بس (صفر نداء).
select cron.schedule('sahl-wa-ofd-notify', '* * * * *', $cron$ select app.wa_ofd_tick(); $cron$);
