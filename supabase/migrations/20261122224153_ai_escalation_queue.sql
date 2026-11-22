-- البند 4 من برنامج المالك (21 نوفمبر): «طابور التصعيد» — 23 نوفمبر.
-- القياس اللي اتبنى عليه (16–22 نوفمبر · 113 تصعيد في 93 محادثة):
--   • الفريق سريع الصبح (100 من 103 اترد عليهم في أول ساعة من الشغل) — المشكلة في اللي بيقع من الطابور:
--   • أي رد من موظف بيقفل التصعيد حتى لو وعد بس («هيتم التواصل») ← العميل رجع بنفس المشكلة 6 مرات على الأقل
--   • «✓ اتعاملت» كان بيقفل من غير ما يتسجّل مين ولا ليه (7 اتقفلوا من غير ولا رد)
--   • العميل اللي كتب بالنهار بعد وعد (البوت مقفول) مابيتعلّمش خالص (د.وحيد «محدش كلمني» 21 نوفمبر)
--   • البوت ساكت عشان موظف كان بيرد والموظف مارجعش = 6 رسايل استنت في المتوسط 7 ساعات
-- قرارات المالك (23 نوفمبر ~00:15 القاهرة): رد الموظف بيقفل لوحده + «🔁» لو العميل رجع · التنبيه في اللوحة بس ·
--   البوت يكمّل بالليل لو الموظف ساب المحادثة نص ساعة.
-- 🔴 مفيش DROP (درس 53) · مفيش FK (درس 59: FK على tenants/wa_conversations = قفل على جدول شغّال) ·
--    كل التريجرات جوّه exception block: مستحيل توقّع إدخال رسالة ولا تحديث محادثة (أسوأ حالة = سطر ناقص في السجل).
-- تصعيد «الموظف كان بيرد — البوت سكت» (staff_active) سجل بس مش مشكلة عميل: مابيتحسبش «🔁» ولا بيفتح «🔁» بالنهار.
-- التصعيدات المفتوحة وقت التطبيق بتاخد صف في السجل (opened_at = وقتها) عشان قفلها يتسجّل.
-- الرجوع (من غير مسح حاجة):
--   alter table public.wa_conversations disable trigger trg_wa_esc_track;
--   alter table public.wa_messages disable trigger trg_wa_esc_reopen;
--   select cron.alter_job((select jobid from cron.job where jobname = 'sahl-ai-resume'), active := false);
--   (و app.wa_ai_escalation_clear / wa_ai_escalation_dismiss بيشتغلوا زي الأول من غير السجل لو التريجر اتقفل)

set lock_timeout = '3s';

-- 1) سجل لكل «حلقة» تصعيد: اتفتحت إمتى وبأنهي سبب · اتقفلت إمتى وإزاي ومين قفلها وقال إيه
create table if not exists public.wa_ai_escalations (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  opened_at timestamptz not null default now(),
  opened_kind text not null default 'bot',
  note text,
  repeat_n integer not null default 1,
  prev_id bigint,
  closed_at timestamptz,
  close_kind text,
  closed_by uuid,
  closed_by_name text,
  close_msg text,
  constraint wa_ai_esc_opened_kind_chk check (opened_kind in ('bot', 'reopen')),
  constraint wa_ai_esc_close_kind_chk check (close_kind is null or close_kind in ('staff_reply', 'resolved', 'no_action', 'bot_resumed', 'unknown'))
);
create index if not exists wa_ai_esc_conv_idx on public.wa_ai_escalations (conversation_id, opened_at desc);
create index if not exists wa_ai_esc_tenant_idx on public.wa_ai_escalations (tenant_id, opened_at desc);
alter table public.wa_ai_escalations enable row level security;
revoke all on public.wa_ai_escalations from public, anon, authenticated;
grant select on public.wa_ai_escalations to authenticated;
grant all on public.wa_ai_escalations to service_role;
do $s$ declare v_seq text := pg_get_serial_sequence('public.wa_ai_escalations', 'id'); begin
  if v_seq is not null then execute format('revoke all on sequence %s from public, anon, authenticated', v_seq); end if;
end $s$;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wa_ai_escalations' and policyname = 'wa_ai_esc_read') then
    create policy wa_ai_esc_read on public.wa_ai_escalations for select to authenticated using (tenant_id = app.current_tenant_id());
  end if;
end $p$;

-- 2) عمود العرض على المحادثة: {repeat, kind, prev:{at, kind, by, msg}} — السيرفر بس اللي بيكتبه
--    (الجدول منحته للمتصفح SELECT على مستوى الجدول و INSERT/UPDATE بالأعمدة — العمود الجديد مقروء ومش متكتب)
alter table public.wa_conversations add column if not exists ai_esc_info jsonb;

-- 3) تتبع الفتح والقفل — BEFORE UPDATE OF ai_escalated_at (الـEF والتريجر والزرار كلهم بيعدّوا من هنا)
create or replace function app.wa_esc_track() returns trigger
  language plpgsql security definer
  set search_path = public, app, pg_temp
  set lock_timeout = '2s'
as $fn$
declare
  c_staff_note constant text := 'العميل كتب وموظف كان بيرد في المحادثة من أقل من نص ساعة — البوت سكت';
  v_ctx jsonb;
  v_prev_id bigint; v_prev_closed timestamptz; v_prev_kind text; v_prev_by text; v_prev_msg text; v_prev_rep integer;
  v_rep integer := 1;
  v_kind text;
begin
  begin
    if old.ai_escalated_at is null and new.ai_escalated_at is not null then
      -- فتح: آخر حلقة اتقفلت في آخر 7 أيام = «🔁»
      select e.id, e.closed_at, e.close_kind, e.closed_by_name, e.close_msg, e.repeat_n
        into v_prev_id, v_prev_closed, v_prev_kind, v_prev_by, v_prev_msg, v_prev_rep
        from public.wa_ai_escalations e
       where e.conversation_id = new.id and e.closed_at is not null and e.closed_at > now() - interval '7 days'
         and coalesce(e.note, '') <> c_staff_note   -- «الموظف كان بيرد» سجل بس مش تصعيد سابق
       order by e.opened_at desc limit 1;
      if v_prev_id is not null then
        -- «رجعت تاني» = بعد ساعة على الأقل من القفل · أقل من كده = نفس الكلام لسه شغّال (العدّاد مابيزيدش)
        v_rep := case when new.ai_escalated_at - v_prev_closed >= interval '60 minutes' then coalesce(v_prev_rep, 1) + 1 else coalesce(v_prev_rep, 1) end;
      end if;
      update public.wa_ai_escalations set closed_at = now(), close_kind = 'unknown'
       where conversation_id = new.id and closed_at is null;   -- حلقة يتيمة (مش المفروض تحصل) — مانسيبش اتنين مفتوحين
      v_kind := case when coalesce(current_setting('sahl.esc_open', true), '') = 'reopen' then 'reopen' else 'bot' end;
      insert into public.wa_ai_escalations (tenant_id, conversation_id, opened_at, opened_kind, note, repeat_n, prev_id)
      values (new.tenant_id, new.id, new.ai_escalated_at, v_kind, left(new.ai_escalation_note, 2000), v_rep, v_prev_id);
      new.ai_esc_info := jsonb_build_object('repeat', v_rep, 'kind', v_kind)
        || case when v_prev_id is null then '{}'::jsonb else jsonb_build_object('prev', jsonb_build_object(
             'at', v_prev_closed, 'kind', v_prev_kind, 'by', v_prev_by, 'msg', left(v_prev_msg, 160))) end;
    elsif old.ai_escalated_at is not null and new.ai_escalated_at is null then
      -- قفل: مين وإزاي من «سياق» اللي قفل (رد موظف · الزرار · البوت كمّل) — من غير سياق = unknown (SQL بالإيد مثلاً)
      v_ctx := nullif(current_setting('sahl.esc_close', true), '')::jsonb;
      update public.wa_ai_escalations set
             closed_at = now(),
             close_kind = coalesce(v_ctx->>'kind', 'unknown'),
             closed_by = nullif(v_ctx->>'by', '')::uuid,
             closed_by_name = left(nullif(v_ctx->>'name', ''), 80),
             close_msg = left(nullif(v_ctx->>'msg', ''), 300)
       where conversation_id = new.id and closed_at is null;
      new.ai_esc_info := null;
    elsif new.ai_escalated_at is not null and new.ai_escalation_note is distinct from old.ai_escalation_note then
      -- لسه مفتوح والبوت زوّد سبب: السجل بياخد آخر سبب
      update public.wa_ai_escalations set note = left(new.ai_escalation_note, 2000)
       where conversation_id = new.id and closed_at is null;
    end if;
  exception when others then
    raise warning 'wa_esc_track: %', sqlstate;   -- مستحيل يوقّع تحديث المحادثة
  end;
  return new;
end
$fn$;
revoke all on function app.wa_esc_track() from public, anon, authenticated;

create or replace trigger trg_wa_esc_track
  before update of ai_escalated_at on public.wa_conversations
  for each row execute function app.wa_esc_track();

-- التصعيدات المفتوحة دلوقتي (قبل السجل): صف مفتوح لكل واحدة عشان قفلها يتسجّل (مين وإزاي)
insert into public.wa_ai_escalations (tenant_id, conversation_id, opened_at, opened_kind, note, repeat_n)
select c.tenant_id, c.id, c.ai_escalated_at, 'bot', left(c.ai_escalation_note, 2000), 1
  from public.wa_conversations c
 where c.ai_escalated_at is not null
   and not exists (select 1 from public.wa_ai_escalations e where e.conversation_id = c.id and e.closed_at is null);

-- 4) القفل برد الموظف — نفس الشرط زي ما هو (أي رسالة صادرة ليها sent_by) + بيسجّل مين رد وقال إيه
create or replace function app.wa_ai_escalation_clear() returns trigger
  language plpgsql security definer
  set search_path = public, app, pg_temp
  set lock_timeout = '2s'
as $fn$
    begin
      begin
        perform set_config('sahl.esc_close', jsonb_build_object('kind', 'staff_reply', 'by', new.sent_by, 'name', new.sent_by_name,
          'msg', left(coalesce(nullif(new.body, ''), '[' || new.type || ']'), 300))::text, true);
        update public.wa_conversations
           set ai_escalated_at = null, ai_escalation_note = null, ai_hold_at = null
         where id = new.conversation_id and tenant_id = new.tenant_id
           and (ai_escalated_at is not null or ai_hold_at is not null);
        perform set_config('sahl.esc_close', '', true);
      exception when others then
        -- مستحيل يوقّع إدخال الرسالة: أسوأ حالة التصعيد يفضل ظاهر
        raise warning 'wa_ai_escalation_clear: %', sqlstate;
      end;
      return null;
    end
$fn$;

-- 5) «✅ اتحلت» / «🚫 مالهاش لازمة» — القفل من غير رسالة بسبب وباسم اللي داس (أي موظف نشط في المتجر)
create or replace function public.wa_ai_escalation_close(p_conversation_id uuid, p_kind text)
  returns jsonb language plpgsql security definer
  set search_path = public, app, pg_temp
as $fn$
declare v_tenant uuid; v_uid uuid := auth.uid(); v_name text; n integer;
begin
  v_tenant := app.current_tenant_id();
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if p_kind is null or p_kind not in ('resolved', 'no_action') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  select nullif(btrim(full_name), '') into v_name from public.user_profiles where id = v_uid;
  perform set_config('sahl.esc_close', jsonb_build_object('kind', p_kind, 'by', v_uid, 'name', coalesce(v_name, 'موظف'))::text, true);
  update public.wa_conversations
     set ai_escalated_at = null, ai_escalation_note = null, ai_hold_at = null
   where id = p_conversation_id and tenant_id = v_tenant and ai_escalated_at is not null;
  get diagnostics n = row_count;
  perform set_config('sahl.esc_close', '', true);
  return jsonb_build_object('ok', true, 'cleared', n);
end
$fn$;
revoke all on function public.wa_ai_escalation_close(uuid, text) from public, anon;
grant execute on function public.wa_ai_escalation_close(uuid, text) to authenticated, service_role;

-- الواجهة القديمة (v88 — «✓ اتعاملت») بتنادي ده: بقى = «✅ اتحلت» وبيتسجّل باسم اللي داس
create or replace function public.wa_ai_escalation_dismiss(p_conversation_id uuid)
  returns jsonb language plpgsql security definer
  set search_path = public, app, pg_temp
as $fn$
    begin
      return public.wa_ai_escalation_close(p_conversation_id, 'resolved');
    end
$fn$;

-- 6) «🔁» بالنهار: العميل رجع كتب بعد ما موظف قفل التصعيد برده (آخر 7 أيام)، والبوت مش شغّال على العملاء.
--    مش لأي رسالة: شكر/تمام/تحية/تفاعل مابتعلّمش · وكلام شغّال مع موظف (رد من أقل من ساعة) مابيعلّمش.
create or replace function app.wa_esc_reopen() returns trigger
  language plpgsql security definer
  set search_path = public, app, pg_temp
  set lock_timeout = '2s'
as $fn$
declare
  c_staff_note constant text := 'العميل كتب وموظف كان بيرد في المحادثة من أقل من نص ساعة — البوت سكت';
  v_mode text; v_dev boolean; v_esc timestamptz;
  v_prev_id bigint; v_prev_closed timestamptz; v_prev_kind text; v_prev_by text; v_prev_msg text;
  v_last_staff timestamptz; v_t text; v_note text;
begin
  begin
    select mode, coalesce(dev_mode, false) into v_mode, v_dev from public.ai_settings where tenant_id = new.tenant_id;
    if v_mode is null then return null; end if;                    -- المتجر مالوش AI Agent
    if v_mode = 'auto' and not v_dev then return null; end if;     -- البوت بيرد = هو اللي بيقرر يصعّد (و«🔁» بيتحسب في wa_esc_track)
    if new.type in ('reaction', 'sticker', 'button', 'unsupported') then return null; end if;
    if new.type = 'text' then
      v_t := regexp_replace(replace(lower(coalesce(new.body, '')), 'ـ', ''), '[^ء-يa-z0-9٠-٩]', '', 'g');
      if length(v_t) <= 3 or v_t ~ '^(شكرا|شكرن|شكر|متشكر|متشكره|متشكرة|متشكرين|مشكور|مشكوره|مشكورة|تسلم|تسلمي|تسلمى|تسلمو|تسلموا|يسلمو|يسلموا|تمام|ماشي|ماشى|اوك|أوك|اوكي|اوكى|اوكيه|ok|okay|okk|حاضر|الحمدلله|جزاكاللهخيرا|جزاكاللهخير|ربنايخليك|اللهيسلمك|صباحالخير|صباحالنور|مساءالخير|مساءالنور|مسالخير|مساالخير|السلامعليكم|وعليكمالسلام|جدا|جزيلا|ليك|ليكي|ليكى|لحضرتك|يافندم|فندم|كتير|خالص|اوي|قوي|حبيبي|حبيبى|ياباشا|باشا|الف|ألف|thanks|thank|thx|you|good|nice|ياغالي|اللهفيك|فيك|ربنايكرمك|اللهيكرمك|يكرمك|ميرسي|مرسي|merci|ايدك|ايديك|بالتوفيق|يارب|انشاءالله|انشالله|انشاالله|خلاص|كده|كدا|حبيبتي|حبيبتى|ياحبيبي|ياحبيبتي|منور|منوره|نورت|ربنايسعدك|اللهيسعدك|يسعدك|وصل|وصلت|وصلني|وصلتني|استلمت|استلمته|استلمتها|اتسلم|اتسلمت)+$' then
        return null;   -- شكر · تمام · تحية = مش محتاجة موظف
      end if;
    end if;
    select ai_escalated_at into v_esc from public.wa_conversations where id = new.conversation_id and tenant_id = new.tenant_id;
    if not found or v_esc is not null then return null; end if;
    select e.id, e.closed_at, e.close_kind, e.closed_by_name, e.close_msg
      into v_prev_id, v_prev_closed, v_prev_kind, v_prev_by, v_prev_msg
      from public.wa_ai_escalations e
     where e.conversation_id = new.conversation_id
       and coalesce(e.note, '') <> c_staff_note   -- «الموظف كان بيرد» سجل بس: مش مشكلة اترد عليها
     order by e.opened_at desc limit 1;
    if v_prev_id is null or v_prev_kind is distinct from 'staff_reply' or v_prev_closed < now() - interval '7 days' then return null; end if;
    select max(m.created_at) into v_last_staff from public.wa_messages m
     where m.conversation_id = new.conversation_id and m.direction = 'out' and m.sent_by is not null and m.created_at <= new.created_at;
    if v_last_staff is not null and v_last_staff > new.created_at - interval '60 minutes' then return null; end if;   -- كلام شغّال مع موظف
    v_note := '🔁 العميل كتب تاني بعد رد ' || coalesce(nullif(btrim(v_prev_by), ''), 'موظف')
      || coalesce(': «' || nullif(left(regexp_replace(btrim(coalesce(v_prev_msg, '')), '\s+', ' ', 'g'), 80), '') || '»', '');
    perform set_config('sahl.esc_open', 'reopen', true);
    update public.wa_conversations set ai_escalated_at = now(), ai_escalation_note = left(v_note, 2000)
     where id = new.conversation_id and tenant_id = new.tenant_id and ai_escalated_at is null;
    perform set_config('sahl.esc_open', '', true);
  exception when others then
    raise warning 'wa_esc_reopen: %', sqlstate;   -- مستحيل يوقّع إدخال الرسالة
  end;
  return null;
end
$fn$;
revoke all on function app.wa_esc_reopen() from public, anon, authenticated;

create or replace trigger trg_wa_esc_reopen
  after insert on public.wa_messages
  for each row when (new.direction = 'in')
  execute function app.wa_esc_reopen();

-- 7) البوت يكمّل بالليل لو الموظف ساب المحادثة: رسالة وصلت والبوت شغّال، وموظف كان رد قبلها بأقل من نص ساعة
--    (فالبوت سكت — staff_active)، ومحدش رد بعدها، وآخر رد للموظف عدّى عليه أكتر من نص ساعة = نداء wa-ai-draft
--    للرسالة دي مرة واحدة (wa_ai_resume). الـEF بتعيد كل حراستها (staff_active · answered · superseded) — مفيش تغيير فيها.
create table if not exists public.wa_ai_resume (
  message_id uuid primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  at timestamptz not null default now(),
  done boolean not null default false
);
alter table public.wa_ai_resume enable row level security;
revoke all on public.wa_ai_resume from public, anon, authenticated;
grant all on public.wa_ai_resume to service_role;

create or replace function app.ai_resume_tick() returns integer
  language plpgsql security definer
  set search_path = public, app, pg_temp
  set lock_timeout = '2s'
  set statement_timeout = '20s'
as $fn$
declare
  c_staff_note constant text := 'العميل كتب وموظف كان بيرد في المحادثة من أقل من نص ساعة — البوت سكت';
  c_bot constant text := '🤖 AI Agent';
  v_token text; r record; n integer := 0; v_note text; v_clean text;
begin
  -- (أ) البوت رد بعد ما كمّل: تصعيد «الموظف كان بيرد» لوحده بيتقفل (مالوش لازمة الصبح) — أي سبب تاني بيفضل
  for r in
    select rs.message_id, rs.conversation_id, rs.tenant_id
      from public.wa_ai_resume rs
     where not rs.done and rs.at > now() - interval '12 hours'
       and exists (select 1 from public.wa_messages b where b.conversation_id = rs.conversation_id
                    and b.direction = 'out' and b.sent_by_name = c_bot and b.created_at > rs.at)
  loop
    select ai_escalation_note into v_note from public.wa_conversations where id = r.conversation_id and tenant_id = r.tenant_id;
    v_clean := replace(replace(coalesce(v_note, ''), c_staff_note || ' · ', ''), ' · ' || c_staff_note, '');
    if v_note = c_staff_note then
      perform set_config('sahl.esc_close', jsonb_build_object('kind', 'bot_resumed', 'name', c_bot)::text, true);
      update public.wa_conversations set ai_escalated_at = null, ai_escalation_note = null, ai_hold_at = null
       where id = r.conversation_id and tenant_id = r.tenant_id and ai_escalation_note = c_staff_note;
      perform set_config('sahl.esc_close', '', true);
    elsif v_note is not null and v_clean <> v_note and v_clean <> '' then
      -- البوت رد وصعّد بسبب تاني: سطر «الموظف كان بيرد» بقى قديم — السبب الجديد بس (ai_escalated_at في الـSET عشان السجل ياخده)
      update public.wa_conversations set ai_escalated_at = ai_escalated_at, ai_escalation_note = v_clean
       where id = r.conversation_id and tenant_id = r.tenant_id and ai_escalation_note = v_note;
    end if;
    update public.wa_ai_resume set done = true where message_id = r.message_id;
  end loop;

  -- (ب) الرسايل اللي مستنية
  select value into v_token from public.platform_settings where key = 'jt_diag_token';
  if v_token is null or length(v_token) < 24 then return n; end if;
  for r in
    select m.id, m.tenant_id, m.conversation_id
      from public.ai_settings s
      join lateral (select max(l.at) as since from public.ai_mode_log l where l.tenant_id = s.tenant_id and l.mode = 'auto') ml on true
      join public.wa_conversations cv on cv.tenant_id = s.tenant_id and cv.last_message_at > now() - interval '6 hours'
      join lateral (
        select m1.id, m1.tenant_id, m1.conversation_id, m1.created_at
          from public.wa_messages m1
         where m1.conversation_id = cv.id and m1.direction = 'in'
           and m1.type not in ('reaction', 'sticker', 'button', 'unsupported')
         order by m1.created_at desc limit 1) m on true
     where s.mode = 'auto'
       and (not coalesce(s.dev_mode, false) or cv.wa_id = any(coalesce(s.dev_wa_ids, '{}'::text[])))
       and ml.since is not null and m.created_at >= ml.since           -- وصلت والبوت شغّال (رسايل النهار مالهاش دعوة)
       and m.created_at > now() - interval '6 hours'
       and not exists (select 1 from public.wa_messages o where o.conversation_id = cv.id and o.direction = 'out'
                        and (o.sent_by is not null or o.sent_by_name = c_bot) and o.created_at > m.created_at)
       and exists (select 1 from public.wa_messages st where st.conversation_id = cv.id and st.direction = 'out' and st.sent_by is not null
                    and st.created_at < m.created_at and st.created_at > m.created_at - interval '30 minutes')
       and not exists (select 1 from public.wa_messages st2 where st2.conversation_id = cv.id and st2.direction = 'out' and st2.sent_by is not null
                        and st2.created_at > now() - interval '31 minutes')
       and not exists (select 1 from public.wa_ai_drafts d where d.trigger_message_id = m.id)
       and not exists (select 1 from public.wa_ai_resume x where x.message_id = m.id)
     limit 10
  loop
    insert into public.wa_ai_resume (message_id, tenant_id, conversation_id) values (r.id, r.tenant_id, r.conversation_id)
      on conflict (message_id) do nothing;
    perform net.http_post(
      url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/wa-ai-draft',
      body := jsonb_build_object('message_id', r.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-diag-token', v_token),
      timeout_milliseconds := 15000);
    n := n + 1;
  end loop;
  return n;
end
$fn$;
revoke all on function app.ai_resume_tick() from public, anon, authenticated;

select cron.schedule('sahl-ai-resume', '1-59/2 * * * *', $$select app.ai_resume_tick()$$);

notify pgrst, 'reload schema';
