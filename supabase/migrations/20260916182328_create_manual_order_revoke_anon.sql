-- 🔴 `REVOKE ALL … FROM PUBLIC` **مابيشيلش** منحة `anon` — Supabase بيمنحها
-- صراحةً (`anon=X/postgres` في الـproacl)، والـREVOKE على PUBLIC مالوش
-- علاقة بمنحة الدور. نفس عيلة درس 41: الـREVOKE بينجح ومابيغيّرش حاجة،
-- والبند يتكتب «اتقفل» وهو مفتوح.
--
-- مش قابلة للاستغلال دلوقتي (الدالة definer بس `app.current_tenant_id()`
-- بتقرا `auth.uid()` فـanon بياخد `not_allowed`) — بس دالة definer بتدخل
-- أوردرات ومتاحة لـanon هي فخ مؤجّل لو الحارس اتغيّر يوم.
REVOKE EXECUTE ON FUNCTION public.create_manual_order(text,text,text,text,text,numeric,text,text,text) FROM anon;
