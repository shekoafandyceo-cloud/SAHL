-- الردود الجاهزة بصور — طلب المالك 16 سبتمبر
-- الشكل: مصفوفة [{path, mime, name}] · الملفات في bucket `wa-media` تحت
-- `<tenant_id>/quick-replies/…` فسياسة الـStorage الموجودة (أول مجلد =
-- المتجر) بتعزلها من غير أي سياسة جديدة.
--
-- ⚠️ الجدول ده منحته لـauthenticated على مستوى الجدول (`arwdm`) ومفيش
-- ولا منحة على مستوى عمود (اتأكد على الحي قبل التطبيق — درس 41)، يعني
-- العمود الجديد بياخد نفس الصلاحية تلقائياً. ده **مقصود** هنا: الجدول
-- معزول بالـRLS على المتجر ومفيش فيه حاجة تتزوّر. عكس `wa_conversations`
-- اللي أعمدة الـctwa فيه اتقفلت عمداً.
ALTER TABLE public.wa_quick_replies
  ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb;

-- سقف 5 صور للرد الواحد: كل صورة = رسالة واتساب مستقلة (مفيش «ألبوم» في
-- الـAPI)، فرد بـ12 صورة = 12 رسالة على العميل في ثانيتين.
ALTER TABLE public.wa_quick_replies
  ADD CONSTRAINT wa_qr_media_shape
    CHECK (jsonb_typeof(media) = 'array' AND jsonb_array_length(media) <= 5);

-- رد من غير نص ومن غير صور = صف مالوش معنى. الحارس ده هو اللي بيخلي
-- `body` يقدر يبقى فاضي لما يكون فيه صور (رد صور بس).
ALTER TABLE public.wa_quick_replies
  ADD CONSTRAINT wa_qr_not_empty
    CHECK (btrim(coalesce(body,'')) <> '' OR jsonb_array_length(media) > 0);

COMMENT ON COLUMN public.wa_quick_replies.media IS
  'مصفوفة [{path,mime,name}] — مسارات في bucket wa-media تحت <tenant_id>/quick-replies/. الإرسال: كل صورة رسالة، وبعدها النص رسالة مستقلة.';
