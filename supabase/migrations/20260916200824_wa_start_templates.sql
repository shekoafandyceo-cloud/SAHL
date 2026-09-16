-- قوالب «بدء شات مع رقم جديد» — طلب المالك 16 سبتمبر.
-- العميل بيكلم التاجر على الموبايل ويقوله «ابعتلي على واتساب»، والموظف
-- مايقدرش يبدأ من الـAPI لأن نافذة الـ24 ساعة مافتحتش أصلاً (العميل عمره
-- ما بعت حاجة). القالب هو الطريق الوحيد.

CREATE TABLE IF NOT EXISTS public.wa_start_templates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- الاسم عند ميتا بالحرف. حرف غلط = الإرسال بيفشل.
  template_name text not null,
  -- 🔴 `ar_EG` مش `ar` — نفس فخ `wa_followup_lang` بالظبط.
  lang          text not null default 'ar_EG',
  -- اللي الموظف بيشوفه في القايمة (مش بيتبعت لميتا)
  label         text not null,
  -- 🔴 النص المرسوم زي ما ميتا مسجّلاه. منه بتتبني المعاينة اللي الموظف
  -- بيوافق عليها والرسالة اللي بتتخزن في `wa_messages`. لو النص هنا خالف
  -- المسجّل عند ميتا، الصندوق بيعرض كلام العميل عمره ما استلمه — نفس سبب
  -- `tenants.wa_followup_body` بالحرف.
  body          text not null,
  -- 🔴 قيم المتغيرات **ثابتة ومتسجّلة هنا**، عمرها ما بتيجي من المتصفح.
  -- لو جت من الفرونت، أي موظف يقدر يبعت أي نص لأي رقم **برّه نافذة الـ24
  -- ساعة** تحت غطا قالب موافق عليه — وده بيحرق الـWABA بتاع التاجر.
  -- نفس الثابت الحاكم في `wa-followup` و`wa-send`.
  params        jsonb not null default '[]'::jsonb,
  -- تصنيف ميتا. `chat_start_ar` طلع `marketing` لأن تعريف ميتا للـutility
  -- هو «رسالة عن **أوردر أو حساب قايم**»، وفتح شات مالوش أوردر. الـclassifier
  -- بتاعهم رفض التسجيل كـutility قبل الإرسال أصلاً. التصنيف متسجّل هنا عشان
  -- التكلفة والمخاطرة تبقى مقروءة مش مخبّية.
  category      text not null default 'marketing',
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint wa_start_templates_name_uq unique (tenant_id, template_name),
  constraint wa_start_templates_cat_ck  check (category in ('marketing','utility')),
  constraint wa_start_templates_par_ck  check (jsonb_typeof(params) = 'array'),
  constraint wa_start_templates_body_ck check (btrim(body) <> ''),
  constraint wa_start_templates_lbl_ck  check (btrim(label) <> '')
);

CREATE INDEX IF NOT EXISTS wa_start_templates_tenant_idx
  ON public.wa_start_templates (tenant_id) WHERE enabled;

ALTER TABLE public.wa_start_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_start_templates_select ON public.wa_start_templates;
CREATE POLICY wa_start_templates_select ON public.wa_start_templates
  FOR SELECT USING (is_super_admin() OR tenant_id = app.current_tenant_id());

-- 🔴 **مفيش سياسة كتابة خالص — قرار مقصود.**
-- تسجيل قالب مش فعل داشبورد: النص هنا لازم يطابق المسجّل عند ميتا بالحرف،
-- وخانة في اللوحة بتسيب الأدمن يكتب نص **مختلف** عن قالب ميتا معناها
-- الصندوق بيعرض كلام العميل ماستلمهوش. التسجيل بيحصل مرة واحدة وقت موافقة
-- ميتا على القالب — بـSQL من المالك. (نفس منطق `tenants.wa_followup_template`
-- اللي بيتحط بالإيد كمان.)
REVOKE ALL ON public.wa_start_templates FROM anon, authenticated;
GRANT SELECT ON public.wa_start_templates TO authenticated;
GRANT ALL    ON public.wa_start_templates TO service_role;

COMMENT ON TABLE public.wa_start_templates IS
  'قوالب بدء محادثة جديدة مع رقم عمره ما كلّمنا. قراءة بس من المتصفح — الكتابة بـSQL وقت موافقة ميتا على القالب.';
