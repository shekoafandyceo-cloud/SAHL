-- wa_ofd_go_live (11 أكتوبر — قرار المالك بعد موافقة ميتا والتجربة على رقمه):
-- «شغلها للكل من اول بكرة. و لو تعرف تبعت للعملاء دلوقتي الي "في الطريق" ابعت لانها هتبقى في مصلحتنا جامد ان العميل
--  يعرف ان الاوردر جايله و مع المندوب و معاه رقم المندوب كمان»
--
-- mode = 'on' للكل · و🔴 enabled_since = أول النهارده بتوقيت القاهرة (2026-10-10 21:00 UTC) بدل now() — عشان الشحنات اللي
-- خرجت للتسليم النهارده الصبح ولسه ماتسلّمتش تاخد الرسالة دلوقتي (طلب المالك الصريح). كل قواعد المرشّح فاضلة زي ما هي:
-- آخر 94 ذهاب ومفيش أي مسح بعده (اتسلّم/استثناء/مرتجع = مفيش رسالة) · خرج من الفرع (50/92 قبله) · ≤ 6 ساعات من الاستحقاق ·
-- الساعات 9–21 · السقف 150/يوم و3/أوردر. يعني الـ«backfill» ده محدود بالطبيعة بالشحنات اللي لسه مع المندوب النهارده بس.
--
-- الحارس app.wa_auto_tpl_guard بيكتب enabled_since = now() مع أي تغيير mode ومابيسمحش بكتابته بالإيد (عن قصد — مفيش backfill
-- بالغلط). فهنا بيتقفل جوّه نفس الترانزاكشن لحظة الـUPDATE ويرجع على طول — مفيش DROP (درس 53).
-- اتجرّب بترانزاكشن راجعة الأول: الحارس رجع شغّال (كتابة enabled_since بالإيد بعدها اتجاهلت) · 52 مرشّح حقيقي · الشبكة 0.

set local lock_timeout = '4s';
alter table public.wa_auto_templates disable trigger trg_wa_auto_tpl_guard;
update public.wa_auto_templates
   set mode = 'on', enabled_since = '2026-10-10 21:00:00+00',
       paused_at = null, paused_reason = null, paused_until = null, updated_at = now()
 where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36' and event = 'out_for_delivery';
alter table public.wa_auto_templates enable trigger trg_wa_auto_tpl_guard;
