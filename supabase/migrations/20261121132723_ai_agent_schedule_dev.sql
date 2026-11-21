-- ai_agent_schedule_dev — الجدول التلقائي للبوت + زرار ON DEVELOP (21 نوفمبر 2026 — طلب المالك)
-- المالك: «ان البوت يشتغل اوتوماتيك بجدول , كل يوم من الساعة 7 مساءً للساعة 11 الصبح. ماعدا يوم الجمعة يشتغل كامل.»
--         «زرار ON DEVELOP , دا لما افعله من جوة السيستم يخلي البوت مبيردش غير على رقمي انا بس " 01050005219 "»
--
-- 1) الجدول (edge-triggered): pg_cron كل دقيقة بينادي app.ai_schedule_tick() — اللي بيغيّر mode **لحظة الانتقال بس**:
--    دخول الفترة = 'auto' · خروجها = idle_mode. يعني الزرار اليدوي بيفضل شغّال: لو اتقفل بالإيد بالليل بيفضل مقفول
--    لحد الانتقال الجاي (والعكس). الفترة بتوقيت القاهرة (Africa/Cairo — بيمشي مع التوقيت الصيفي لوحده) والجمعة
--    (isodow 5) كلها جوّه الفترة = من الخميس 7م لحد السبت 11ص من غير قفل. مين وإمتى في ai_mode_log باسم «⏰ الجدول».
--    'off' والـidle 'shadow' (إيقاف طوارئ من برّه الزرار) = الجدول مايلمسوش.
-- 2) ON DEVELOP: dev_mode = true → mode بيبقى 'auto' والتريجر بيبعت لـwa-ai-draft رسايل أرقام dev_wa_ids بس
--    (أي عميل تاني = ولا موديل ولا مسودة ولا رد). الحالة اللي قبل التجربة في dev_prev_mode وبترجع لما تتقفل، والجدول وقت
--    التجربة بيحدّث dev_prev_mode بدل mode. الزرار الأساسي (ai_agent_set_auto) مقفول وقت التجربة ('dev_mode').
--    🔴 مفيش تغيير على wa-ai-draft: وقت التجربة المحادثات اللي بتوصلها هي أرقام التجربة بس (الفلتر في التريجر).
--    ⚠️ أوردرات البوت وقت التجربة (create_bot_order) أوردرات حقيقية في السيستم — تتلغى بالإيد.
--
-- 🔴 مفيش DROP (درس 53) · trg_wa_after_message_insert و wa-inbox-ingest و wa-send مايتلمسوش · التريجر لسه كله جوّه exception block.
-- اتجرّب بترانزاكشن راجعة على الحي قبل التطبيق (21 نوفمبر ~15:55 القاهرة): 25 فحص سليم — الفترة 12 حالة (منها الصيفي) ·
--   التِك 9 انتقالات · الزراير بانتحال الأدمن · التريجر وقت التجربة (عميل 0 نداء · رقم المالك 1) · الصلاحيات.
-- الرجوع:
--   select cron.unschedule('sahl-ai-schedule');
--   update public.ai_settings set schedule_on = false, mode = coalesce(dev_prev_mode, mode), dev_mode = false, dev_prev_mode = null
--    where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';

set local lock_timeout = '3s';

-- ── الأعمدة ──────────────────────────────────────────────────────────
alter table public.ai_settings
  add column if not exists schedule_on boolean not null default false,
  add column if not exists schedule_start time not null default '19:00',
  add column if not exists schedule_end time not null default '11:00',
  add column if not exists schedule_full_dows smallint[] not null default '{5}',
  add column if not exists schedule_last text,
  add column if not exists schedule_changed_at timestamptz,
  add column if not exists schedule_changed_by_name text,
  add column if not exists dev_mode boolean not null default false,
  add column if not exists dev_wa_ids text[] not null default '{}',
  add column if not exists dev_prev_mode text,
  add column if not exists dev_changed_at timestamptz,
  add column if not exists dev_changed_by_name text;

alter table public.ai_settings
  add constraint ai_settings_schedule_last_check check (schedule_last in ('in', 'out')),
  add constraint ai_settings_schedule_span_check check (schedule_start <> schedule_end),
  add constraint ai_settings_schedule_dows_check check (schedule_full_dows <@ '{1,2,3,4,5,6,7}'::smallint[]),
  add constraint ai_settings_dev_prev_mode_check check (dev_prev_mode in ('off', 'shadow', 'auto')),
  add constraint ai_settings_dev_wa_ids_check check (cardinality(dev_wa_ids) <= 5);

-- ── الجدول: الفترة المطلوبة دلوقتي ('in' / 'out') بتوقيت القاهرة ──────────
create or replace function app.ai_schedule_want(p_start time, p_end time, p_full smallint[], p_at timestamptz)
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $fn$
  select case
    when extract(isodow from (p_at at time zone 'Africa/Cairo'))::smallint = any(coalesce(p_full, '{}'::smallint[])) then 'in'
    when p_start > p_end then
      case when (p_at at time zone 'Africa/Cairo')::time >= p_start or (p_at at time zone 'Africa/Cairo')::time < p_end then 'in' else 'out' end
    else
      case when (p_at at time zone 'Africa/Cairo')::time >= p_start and (p_at at time zone 'Africa/Cairo')::time < p_end then 'in' else 'out' end
  end
$fn$;

-- ── الجدول: التِك (كل دقيقة من pg_cron) — بيغيّر mode لحظة الانتقال بس ──────
create or replace function app.ai_schedule_tick(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
set lock_timeout = '2s'
as $fn$
declare r record; v_want text; v_target text; v_n int := 0;
begin
  for r in
    select tenant_id, mode, idle_mode, dev_mode, schedule_start, schedule_end, schedule_full_dows, schedule_last
      from public.ai_settings where schedule_on for update skip locked
  loop
    v_want := app.ai_schedule_want(r.schedule_start, r.schedule_end, r.schedule_full_dows, p_at);
    continue when r.schedule_last is not distinct from v_want;
    v_target := case when v_want = 'in' then 'auto' else coalesce(r.idle_mode, 'shadow') end;
    if r.dev_mode then
      -- وقت ON DEVELOP: mode محجوز للتجربة — الجدول بيحدّث الحالة اللي هترجع لما التجربة تتقفل
      update public.ai_settings set schedule_last = v_want, dev_prev_mode = v_target where tenant_id = r.tenant_id;
    elsif r.mode is null or r.mode = v_target or (r.mode = 'off' and coalesce(r.idle_mode, 'shadow') <> 'off') then
      -- مفيش تغيير · أو إيقاف طوارئ (off + idle shadow) = مايتلمسش
      update public.ai_settings set schedule_last = v_want where tenant_id = r.tenant_id;
    else
      update public.ai_settings
         set mode = v_target, schedule_last = v_want, auto_changed_at = now(), auto_changed_by_name = '⏰ الجدول', updated_at = now()
       where tenant_id = r.tenant_id;
      insert into public.ai_mode_log (tenant_id, mode, by_user, by_name) values (r.tenant_id, v_target, null, '⏰ الجدول');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$fn$;

-- ── الزرار الأساسي: مقفول وقت ON DEVELOP (التجربة ليها زرارها) ─────────────
create or replace function public.ai_agent_set_auto(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
    declare me record; v_mode text; v_idle text; v_new text; v_dev boolean;
    begin
      select * into me from app.wh_me();
      if me.uid is null or me.tenant_id is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
      if not coalesce(me.is_admin, false) then return jsonb_build_object('ok', false, 'error', 'admin_only'); end if;
      if p_on is null then return jsonb_build_object('ok', false, 'error', 'bad_value'); end if;
      select mode, coalesce(idle_mode, 'shadow'), coalesce(dev_mode, false) into v_mode, v_idle, v_dev from public.ai_settings where tenant_id = me.tenant_id for update;
      -- 'off' و idle_mode = 'shadow' = إيقاف يدوي من برّه الزرار (مايتشغّلش من اللوحة) · 'off' و idle_mode = 'off' = وضع القفل العادي
      if v_mode is null or (v_mode not in ('shadow', 'auto') and v_idle <> 'off') then return jsonb_build_object('ok', false, 'error', 'agent_off'); end if;
      -- 🧪 وقت ON DEVELOP الزرار ده مقفول — التجربة الأول تتقفل (ai_agent_set_dev) وبعدها الحالة بترجع لوحدها
      if v_dev then return jsonb_build_object('ok', false, 'error', 'dev_mode'); end if;
      v_new := case when p_on then 'auto' else v_idle end;
      if v_new = v_mode then return jsonb_build_object('ok', true, 'mode', v_mode, 'idle', v_idle, 'unchanged', true); end if;
      update public.ai_settings
         set mode = v_new, auto_changed_at = now(), auto_changed_by_name = me.name, updated_at = now()
       where tenant_id = me.tenant_id;
      insert into public.ai_mode_log (tenant_id, mode, by_user, by_name) values (me.tenant_id, v_new, me.uid, me.name);
      return jsonb_build_object('ok', true, 'mode', v_new, 'idle', v_idle, 'by', me.name);
    end
$fn$;

-- ── زرار الجدول: أدمن المتجر بس · التشغيل بيطبّق الجدول على طول ────────────
create or replace function public.ai_agent_set_schedule(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare me record; v_on boolean;
begin
  select * into me from app.wh_me();
  if me.uid is null or me.tenant_id is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if not coalesce(me.is_admin, false) then return jsonb_build_object('ok', false, 'error', 'admin_only'); end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'bad_value'); end if;
  select schedule_on into v_on from public.ai_settings where tenant_id = me.tenant_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'agent_off'); end if;
  if v_on = p_on then return jsonb_build_object('ok', true, 'schedule_on', v_on, 'unchanged', true); end if;
  update public.ai_settings
     set schedule_on = p_on, schedule_last = null, schedule_changed_at = now(), schedule_changed_by_name = me.name, updated_at = now()
   where tenant_id = me.tenant_id;
  -- التشغيل = الجدول بيتطبّق دلوقتي (لو إحنا جوّه الفترة البوت بيشتغل على طول — مش مستني الانتقال الجاي)
  if p_on then perform app.ai_schedule_tick(); end if;
  return (select jsonb_build_object('ok', true, 'schedule_on', s.schedule_on, 'mode', s.mode, 'by', me.name)
            from public.ai_settings s where s.tenant_id = me.tenant_id);
end
$fn$;

-- ── زرار ON DEVELOP: أدمن المتجر بس ────────────────────────────────────
create or replace function public.ai_agent_set_dev(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare me record; s record; v_back text;
begin
  select * into me from app.wh_me();
  if me.uid is null or me.tenant_id is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if not coalesce(me.is_admin, false) then return jsonb_build_object('ok', false, 'error', 'admin_only'); end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'bad_value'); end if;
  select mode, coalesce(idle_mode, 'shadow') idle_mode, coalesce(dev_mode, false) dev_mode, dev_wa_ids, dev_prev_mode into s
    from public.ai_settings where tenant_id = me.tenant_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'agent_off'); end if;
  if s.dev_mode = p_on then return jsonb_build_object('ok', true, 'dev_mode', p_on, 'mode', s.mode, 'unchanged', true); end if;

  if p_on then
    if coalesce(cardinality(s.dev_wa_ids), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'no_dev_numbers'); end if;
    -- إيقاف طوارئ (off + idle shadow) = مايتشغّلش من اللوحة (زي ai_agent_set_auto)
    if s.mode is null or (s.mode not in ('shadow', 'auto') and s.idle_mode <> 'off') then
      return jsonb_build_object('ok', false, 'error', 'agent_off');
    end if;
    update public.ai_settings
       set dev_mode = true, dev_prev_mode = s.mode, mode = 'auto',
           auto_changed_at = now(), auto_changed_by_name = me.name || ' · 🧪 ON DEVELOP',
           dev_changed_at = now(), dev_changed_by_name = me.name, updated_at = now()
     where tenant_id = me.tenant_id;
    insert into public.ai_mode_log (tenant_id, mode, by_user, by_name) values (me.tenant_id, 'auto', me.uid, me.name || ' · 🧪 ON DEVELOP');
    return jsonb_build_object('ok', true, 'dev_mode', true, 'mode', 'auto', 'by', me.name);
  end if;

  -- القفل: الحالة اللي قبل التجربة (أو اللي الجدول حدّثها وقتها) بترجع
  v_back := coalesce(s.dev_prev_mode, s.idle_mode);
  -- البوت وقف تلقائي وقت التجربة (قاطع أخطاء الإرسال / رصيد Gemini) = مايرجعش يشتغل لوحده
  if s.mode <> 'auto' and v_back = 'auto' then v_back := s.idle_mode; end if;
  update public.ai_settings
     set dev_mode = false, dev_prev_mode = null, mode = v_back,
         auto_changed_at = now(), auto_changed_by_name = me.name || ' · نهاية ON DEVELOP',
         dev_changed_at = now(), dev_changed_by_name = me.name, updated_at = now()
   where tenant_id = me.tenant_id;
  insert into public.ai_mode_log (tenant_id, mode, by_user, by_name) values (me.tenant_id, v_back, me.uid, me.name || ' · نهاية ON DEVELOP');
  return jsonb_build_object('ok', true, 'dev_mode', false, 'mode', v_back, 'by', me.name);
end
$fn$;

-- ── التريجر: وقت ON DEVELOP رسايل أرقام التجربة بس هي اللي بتوصل للـAgent ───────
create or replace function app.wa_ai_draft_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
set lock_timeout = '2s'
as $fn$
    declare v_mode text; v_dev boolean; v_ids text[]; v_wa text; v_token text;
    begin
      begin
        select mode, coalesce(dev_mode, false), dev_wa_ids into v_mode, v_dev, v_ids from public.ai_settings where tenant_id = new.tenant_id;
        if v_mode is null or v_mode not in ('shadow', 'auto') then return null; end if;
        -- 🧪 ON DEVELOP (21 نوفمبر): البوت بيرد على أرقام التجربة بس — أي محادثة تانية = ولا نداء ولا توكنز
        if v_dev then
          select wa_id into v_wa from public.wa_conversations where id = new.conversation_id and tenant_id = new.tenant_id;
          if v_wa is null or not (v_wa = any(coalesce(v_ids, '{}'::text[]))) then return null; end if;
        end if;
        select value into v_token from public.platform_settings where key = 'jt_diag_token';
        if v_token is null or length(v_token) < 24 then return null; end if;
        perform net.http_post(
          url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/wa-ai-draft',
          body := jsonb_build_object('message_id', new.id),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-diag-token', v_token),
          timeout_milliseconds := 15000);
      exception when others then
        -- مستحيل يوقّع إدخال الرسالة: أي خطأ هنا = مفيش مسودة بس
        raise warning 'wa_ai_draft_enqueue: %', sqlstate;
      end;
      return null;
    end
$fn$;

-- ── الصلاحيات ─────────────────────────────────────────────────────────
revoke all on function app.ai_schedule_want(time, time, smallint[], timestamptz) from public, anon, authenticated;
revoke all on function app.ai_schedule_tick(timestamptz) from public, anon, authenticated;
revoke all on function public.ai_agent_set_schedule(boolean) from public, anon;
revoke all on function public.ai_agent_set_dev(boolean) from public, anon;
grant execute on function public.ai_agent_set_schedule(boolean) to authenticated;
grant execute on function public.ai_agent_set_dev(boolean) to authenticated;

-- ── التشغيل: الجدول شغّال من دلوقتي + رقم المالك للتجربة ─────────────────────
update public.ai_settings
   set schedule_on = true, schedule_last = null, schedule_changed_at = now(), schedule_changed_by_name = 'المالك (طلب 21 نوفمبر)'
 where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
update public.ai_settings
   set dev_wa_ids = array['201050005219']
 where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';

select cron.schedule('sahl-ai-schedule', '* * * * *', $cron$ select app.ai_schedule_tick(); $cron$);
