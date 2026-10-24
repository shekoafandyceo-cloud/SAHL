-- أسرار J&T في Supabase Vault (مش في الكود ولا في platform_settings).
-- الـEdge Functions بتقراها عبر الغلاف ده لما secrets البيئة مش موجودة.
-- القيم نفسها اتحطت بـvault.create_secret من جلسة SQL — مش في الملف ده.
--
-- الأسماء في الـVault:
--   jt_api_account · jt_private_key · jt_customer_code · jt_password_processed
--   (اختياري) jt_sbx_api_account · jt_sbx_private_key · jt_sbx_customer_code · jt_sbx_password_processed
--
-- التصريح: service_role بس. anon/authenticated/public مسحوبين صراحةً
-- (درس 41/43: REVOKE ... FROM PUBLIC مابيشيلش منحة anon الصريحة — فبنشيلها بالاسم).

create or replace function public.jt_secrets_v1(p_env text default 'production')
returns jsonb
language sql
security definer
set search_path = public, vault
as $$
  select coalesce(jsonb_object_agg(
           case when p_env = 'sandbox' then substr(name, 8) else substr(name, 4) end,
           decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where case when p_env = 'sandbox' then name like 'jt\_sbx\_%' escape '\'
             else name like 'jt\_%' escape '\' and name not like 'jt\_sbx\_%' escape '\' end;
$$;

revoke all on function public.jt_secrets_v1(text) from public;
revoke all on function public.jt_secrets_v1(text) from anon;
revoke all on function public.jt_secrets_v1(text) from authenticated;
grant execute on function public.jt_secrets_v1(text) to service_role;
