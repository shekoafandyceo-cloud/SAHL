-- 16 نوفمبر 2026 — قرار المالك («اعمل الاثنين»): الردود الحية على شكل الدخل v3
-- (نص كروت منتجات المحادثة بس + فهرس لباقي الكروت). الرجوع:
--   update public.ai_settings set facts = facts - 'prompt_layout' where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
update public.ai_settings
   set facts = facts || '{"prompt_layout":"v3"}'::jsonb
 where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
