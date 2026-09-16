-- أسماء إعلانات CTWA — بلاغ المالك 16 سبتمبر
--
-- 🔴 السبب: إعلانين مختلفين ممكن يبقى ليهم **نفس الكوبي بالحرف**. اتقاس
-- على الحي: `FOMO HOOK` (120250918845800034) و`realone` (120250918831800034)
-- الاتنين نص إعلانهم «القطعة اللي هتنظم بيتك كله.. مش المطبخ بس!» — فالشارة
-- بتعرض نفس الكلام على الاتنين والمالك مش قادر يفرّق.
--
-- ده **نفس درس 44 بيتكرر على مستوى أعمق**: نقلنا من `headline` لـ`body`
-- لأن الـheadline طلع اسم الصفحة، والـ`body` كمان مش مميّز. اللي بيعرّف
-- الإعلان فعلاً هو **اسمه في Meta Ads** — وده **مش بييجي في الـwebhook
-- خالص**، فلازم جدول.
--
-- ليه جدول مش عمود على `wa_conversations`؟ الاسم خاصية **الإعلان** مش
-- المحادثة: صف واحد بيخدم كل المحادثات الجاية من نفس الإعلان، وإعادة
-- تسمية الإعلان بتتعدّل في مكان واحد.
CREATE TABLE IF NOT EXISTS public.ctwa_ads (
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_id      text        NOT NULL,
  ad_name    text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ad_id)
);

ALTER TABLE public.ctwa_ads ENABLE ROW LEVEL SECURITY;

-- القراءة لأي عضو نشط — الموظف محتاج يشوف اسم الإعلان وهو بيرد
CREATE POLICY ctwa_ads_select ON public.ctwa_ads FOR SELECT
  USING (is_super_admin() OR tenant_id = app.current_tenant_id());

-- 🔴 الكتابة لأدمن المتجر بس. الاسم ده بيتعرض على إنه مصدر العميل، فلو
-- أي موظف يقدر يعدّله بيبقى نفس تصنيف تزوير نسبة الإعلان اللي اتقفل في
-- `ctwa_*` (14 سبتمبر). اتجرّب بانتحال موظف حقيقي: التزوير اتمنع
-- والقراءة نجحت (ضابط) والأدمن كتب عادي.
CREATE POLICY ctwa_ads_write ON public.ctwa_ads FOR ALL
  USING (is_super_admin() OR (app.is_admin() AND tenant_id = app.current_tenant_id()))
  WITH CHECK (is_super_admin() OR (app.is_admin() AND tenant_id = app.current_tenant_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ctwa_ads TO authenticated;

COMMENT ON TABLE public.ctwa_ads IS
  'ctwa_ad_id → اسم الإعلان في Meta Ads. الاسم مش بييجي في webhook الواتساب، فبيتعبّى من Meta Ads API. إعلانين ممكن يبقى ليهم نفس الكوبي فالاسم هو المميّز الوحيد.';
