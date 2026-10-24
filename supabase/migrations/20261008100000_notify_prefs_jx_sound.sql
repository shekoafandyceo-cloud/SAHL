-- صوت تنبيه الاستثناءات (8 أكتوبر — طلب المالك): مفتاح `jx_sound` في tenants.notify_prefs.
-- الأدمن بيشغّله/يقفله للفريق كله من الإعدادات (update_notify_prefs — الأدمن بس)، وكل لوحة
-- بتقراه بـget_notify_prefs (أي حد في المتجر) وتشغّل الصوت لما استثناء جديد ينزل.
-- الغايب = شغّال (نفس قاعدة باقي المفاتيح في notify_enabled).
-- + قفل anon على الدالتين (Supabase بيمنحه صراحةً — مالوش لازمة هنا).
create or replace function public.update_notify_prefs(p_prefs jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $f$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_clean  jsonb := '{}'::jsonb;
  v_key    text;
  v_allowed text[] := ARRAY[
    'staff_activity','confirmations','cancellations','outgoing_today','daily_inventory',
    'jx_sound'
  ];
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT public.is_tenant_admin() THEN RAISE EXCEPTION 'admin_only'; END IF;
  FOREACH v_key IN ARRAY v_allowed LOOP
    IF p_prefs ? v_key THEN
      v_clean := v_clean || jsonb_build_object(v_key, (p_prefs ->> v_key)::boolean);
    END IF;
  END LOOP;
  UPDATE public.tenants SET notify_prefs = coalesce(notify_prefs,'{}'::jsonb) || v_clean WHERE id = v_tenant;
  RETURN (SELECT coalesce(notify_prefs,'{}'::jsonb) FROM public.tenants WHERE id = v_tenant);
END;
$f$;

revoke execute on function public.update_notify_prefs(jsonb) from public, anon;
revoke execute on function public.get_notify_prefs() from public, anon;
