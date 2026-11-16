-- AI Agent: تسجيل التوكنز المتكيّشة (cachedContentTokenCount من Gemini) مع كل مسودة — قياس بس، مفيش سلوك بيتغيّر.
-- 16 نوفمبر — بموافقة المالك («ماشي اعمل الي بتقول عليه»). اتجرّب بترانزاكشن راجعة الأول.
-- اتطبّق على الحي 16 نوفمبر 02:20 UTC (apply_migration — نفس النص ده).
set local lock_timeout = '3s';
alter table public.wa_ai_drafts add column if not exists tokens_cached integer;
comment on column public.wa_ai_drafts.tokens_cached is 'Gemini cachedContentTokenCount — جزء من tokens_in اتحسب بسعر الكاش (NULL = مسودة من غير موديل أو قبل 16 نوفمبر)';
