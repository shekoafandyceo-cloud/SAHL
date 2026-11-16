-- اتطبّق على الحي 16 نوفمبر 2026 11:17 UTC (13:17 القاهرة) — قرار المالك: «عاوز المصروف "تطوير" بيتوزع على الشهر كله عادي».
-- المرآة = اللي اتطبّق بالحرف (من أول السطر اللي تحت).
--
-- قبل التطبيق (ترانزاكشن راجعة على الحي): الدالة الجديدة من غير أي مصروف «تطوير» = نفس خرج rev_daily(0) و(1) بالحرف ·
-- مصروف 3000 بتاريخ النهارده: القديمة = النهارده +3000 والـ15 يوم التانيين صفر · الجديدة = كل يوم في الشهر +100.00 (16 من 16)
-- والشهر اللي فات زي ما هو · مصروف تاني 600 بتاريخ أول الشهر = كل يوم +120.00 · باقي مفاتيح اليوم ماتلمستش · الشبكة 0 · 78 صف بعدها.
-- بعد التطبيق: md5 = 162ac53d… · SECURITY DEFINER · ACL {postgres, service_role} · anon/authenticated مالهمش تنفيذ.
-- ⚠️ rev_daily / rev_rates / rev_expenses مش متسجّلين في الريبو (اتعملوا من سيشن صفحة الأرباح) — عشان كده التعديل على التعريف الحي
--    بحراسة md5 مش CREATE OR REPLACE بنص كامل.

-- حسبة rev: مصروف «تطوير» بيتوزّع على كل أيام الشهر زي «تغليف»/«نقل»/«مخزن» (قرار المالك 16 نوفمبر).
-- قبل كده كان بيتخصم كامل في يوم المصروف. التغيير سطر واحد في public.rev_daily:
--   ... OR x.category LIKE '%مخزن%'   →   ... OR x.category LIKE '%مخزن%' OR x.category LIKE '%تطوير%'
-- الدالة مش متسجّلة في الريبو، فالتعديل بيتعمل على التعريف الحي نفسه بحراسة md5 قبل وبعد
-- (نفس اللي اتجرّب بترانزاكشن راجعة). مفيش DROP · CREATE OR REPLACE بيحافظ على الـACL والمالك.
-- إعادة التشغيل آمنة: لو الدالة فيها «تطوير» أصلاً بيرجع من غير ما يعمل حاجة.
DO $m$
DECLARE
  v_def text;
  v_new text;
  v_anchor constant text := $a$x.category LIKE '%مخزن%'$a$;
BEGIN
  v_def := pg_get_functiondef('public.rev_daily(integer)'::regprocedure);

  IF position('%تطوير%' in v_def) > 0 THEN
    RAISE NOTICE 'rev_daily: «تطوير» متوزّع أصلاً — مفيش تغيير';
    RETURN;
  END IF;

  IF md5(v_def) <> 'fe1b6753e07505df20e327da9229311b' THEN
    RAISE EXCEPTION 'rev_daily: التعريف الحي اتغيّر عن اللي اتجرّب (md5 %) — راجع قبل التطبيق', md5(v_def);
  END IF;

  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'rev_daily: المرساة مش موجودة مرة واحدة بالظبط';
  END IF;

  v_new := replace(v_def, v_anchor, v_anchor || $a$ OR x.category LIKE '%تطوير%'$a$);
  EXECUTE v_new;

  IF md5(pg_get_functiondef('public.rev_daily(integer)'::regprocedure)) <> '162ac53dcdc50a8d05aa2d9cc6204109' THEN
    RAISE EXCEPTION 'rev_daily: النتيجة مش زي اللي اتجرّب (md5 %)', md5(pg_get_functiondef('public.rev_daily(integer)'::regprocedure));
  END IF;
END
$m$;
