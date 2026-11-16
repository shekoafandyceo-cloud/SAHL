-- ai_agent_idle_off — اتطبّق على الحي 16 نوفمبر 21:37 UTC (طلب المالك 16 نوفمبر 07:12 القاهرة:
-- «الزرار مقفول النهاردة فقط، لكن بعد كدا عاوزه لما يكون مقفول حتى ميقترحش حاجة خالص»).
-- بيانات بس. ترانزاكشن راجعة الأول: auto/shadow → auto/off · الشبكة 0.
-- وقت التطبيق البوت كان ON (mode='auto' من 16:59 UTC بإيد المالك) ففضل ON —
-- والزرار OFF بعدها بيرجّع لـ idle_mode = 'off' = التريجر مابيناديش wa-ai-draft = صفر توكنز.
-- الرجوع لـ«مقفول = بيقترح»:
--   update public.ai_settings set idle_mode = 'shadow', mode = case when mode = 'off' then 'shadow' else mode end
--    where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
update public.ai_settings
   set idle_mode = 'off',
       mode = case when mode = 'shadow' then 'off' else mode end
 where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
