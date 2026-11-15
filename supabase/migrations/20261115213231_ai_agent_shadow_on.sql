-- ai_agent_shadow_on — ✅ اتطبّق على الحي 15 نوفمبر 2026 21:32 UTC (بموافقة المالك: «طبق الخطوتين»). مفتاح تشغيل الـAI Agent في وضع shadow.
-- من دلوقتي كل رسالة واردة (غير button/reaction/sticker/unsupported) بتتعملها مسودة رد في wa_ai_drafts — مفيش إرسال للعميل.
-- اتجرّب بترانزاكشن راجعة الأول (mode=shadow · الطابور 0→0 · مفيش تريجرات على ai_settings).
-- الإيقاف الفوري: update public.ai_settings set mode = 'off' where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
update public.ai_settings set mode = 'shadow', updated_at = now()
 where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36' and mode = 'off';
