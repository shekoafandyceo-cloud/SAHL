-- ai_agent_auto_mode — ⏳ لسه ماتطبّقش على الحي (16 نوفمبر 2026 — طلب المالك: زرار ON/OFF للبوت + «تصعيد» في فلاتر المحادثات).
--
-- بيضيف (كله خامل لحد ما المالك يدوس ON — mode بيفضل 'shadow'):
--   1) wa_conversations.ai_escalated_at / ai_escalation_note / ai_hold_at — «المحادثة دي البوت صعّدها ومحتاجة موظف».
--      بيكتبهم wa-ai-draft (service_role) بس — المتصفح بيقراهم ومايكتبهمش (الجدول منحته بالأعمدة: 14 سبتمبر).
--   2) trg_wa_ai_escalation_clear على wa_messages: أي رسالة **صادرة من موظف** (sent_by مش فاضي) بتشيل التصعيد.
--      رسايل البوت نفسه (sent_by فاضي) ورسايل «المندوب في الطريق» التلقائية مابتشيلوش.
--      🔴 trg_wa_after_message_insert و trg_wa_ai_draft_enqueue مايتلمسوش · مفيش DROP (درس 53) · كله جوّه exception block
--      (مستحيل يوقّع إدخال الرسالة) · lock_timeout قصير.
--   3) wa_ai_drafts.auto_sent_at / auto_sent_n / auto_result — إيه اللي البوت بعته فعلاً (للتقرير وللحماية من الإرسال مرتين).
--      🔴 مفيش تغيير على CHECK بتاع status (كان هيحتاج DROP CONSTRAINT): الرد اللي اتبعت تلقائي = status 'sent' + auto_sent_at.
--   4) ai_settings.auto_changed_at / auto_changed_by_name + جدول ai_mode_log (مين شغّل/طفّى وإمتى).
--   5) ai_agent_set_auto(p_on) — الزرار: أدمن المتجر بس · 'shadow' ⇄ 'auto' · لو الـAgent 'off' = رفض (مايشغّلوش من الصفر).
--   6) wa_ai_escalation_dismiss(p_conversation_id) — «✓ اتعاملت» من غير ما يبعت رسالة (أي موظف نشط في المتجر).
--   7) ai_settings.facts.hold_message — نص رسالة الاعتذار وقت التصعيد (المواعيد من كلام المالك: السبت–الخميس 12–7).
--      المفتاح ده إعداد مش معلومة للموديل (FACT_SKIP في _shared/ai-draft.ts) — مابيدخلش الـprompt.
do $mig$
begin
  perform set_config('lock_timeout', '3s', true);

  -- 1) التصعيد على المحادثة
  alter table public.wa_conversations add column if not exists ai_escalated_at timestamptz;
  alter table public.wa_conversations add column if not exists ai_escalation_note text;
  alter table public.wa_conversations add column if not exists ai_hold_at timestamptz;
  alter table public.wa_conversations add constraint wa_conv_ai_esc_note_len
    check (ai_escalation_note is null or char_length(ai_escalation_note) <= 600);
  create index if not exists wa_conversations_ai_esc_idx
    on public.wa_conversations (tenant_id, ai_escalated_at) where ai_escalated_at is not null;

  -- 3) أثر الإرسال التلقائي على المسودة
  alter table public.wa_ai_drafts add column if not exists auto_sent_at timestamptz;
  alter table public.wa_ai_drafts add column if not exists auto_sent_n integer;
  alter table public.wa_ai_drafts add column if not exists auto_result jsonb;

  -- 4) مين شغّل/طفّى
  alter table public.ai_settings add column if not exists auto_changed_at timestamptz;
  alter table public.ai_settings add column if not exists auto_changed_by_name text;
  create table if not exists public.ai_mode_log (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    mode text not null,
    by_user uuid,
    by_name text,
    at timestamptz not null default now()
  );
  create index if not exists ai_mode_log_tenant_at on public.ai_mode_log (tenant_id, at desc);
  alter table public.ai_mode_log enable row level security;
  revoke all on public.ai_mode_log from public, anon, authenticated;
  grant select on public.ai_mode_log to authenticated;
  create policy ai_mode_log_select on public.ai_mode_log for select to authenticated
    using (is_super_admin() or tenant_id = app.current_tenant_id());

  -- 2) موظف رد = التصعيد اتشال
  execute $f$
    create or replace function app.wa_ai_escalation_clear() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'app', 'pg_temp'
    set lock_timeout to '2s'
    as $fn$
    begin
      begin
        update public.wa_conversations
           set ai_escalated_at = null, ai_escalation_note = null, ai_hold_at = null
         where id = new.conversation_id and tenant_id = new.tenant_id
           and (ai_escalated_at is not null or ai_hold_at is not null);
      exception when others then
        -- مستحيل يوقّع إدخال الرسالة: أسوأ حالة التصعيد يفضل ظاهر
        raise warning 'wa_ai_escalation_clear: %', sqlstate;
      end;
      return null;
    end $fn$ $f$;
  execute 'revoke all on function app.wa_ai_escalation_clear() from public, anon, authenticated';
  execute $f$ create trigger trg_wa_ai_escalation_clear after insert on public.wa_messages for each row
    when (new.direction = 'out' and new.sent_by is not null)
    execute function app.wa_ai_escalation_clear() $f$;

  -- 5) الزرار
  execute $f$
    create or replace function public.ai_agent_set_auto(p_on boolean) returns jsonb
    language plpgsql security definer
    set search_path to 'public', 'app', 'pg_temp'
    as $fn$
    declare me record; v_mode text; v_new text;
    begin
      select * into me from app.wh_me();
      if me.uid is null or me.tenant_id is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
      if not coalesce(me.is_admin, false) then return jsonb_build_object('ok', false, 'error', 'admin_only'); end if;
      if p_on is null then return jsonb_build_object('ok', false, 'error', 'bad_value'); end if;
      select mode into v_mode from public.ai_settings where tenant_id = me.tenant_id for update;
      if v_mode is null or v_mode not in ('shadow', 'auto') then return jsonb_build_object('ok', false, 'error', 'agent_off'); end if;
      v_new := case when p_on then 'auto' else 'shadow' end;
      if v_new = v_mode then return jsonb_build_object('ok', true, 'mode', v_mode, 'unchanged', true); end if;
      update public.ai_settings
         set mode = v_new, auto_changed_at = now(), auto_changed_by_name = me.name, updated_at = now()
       where tenant_id = me.tenant_id;
      insert into public.ai_mode_log (tenant_id, mode, by_user, by_name) values (me.tenant_id, v_new, me.uid, me.name);
      return jsonb_build_object('ok', true, 'mode', v_new, 'by', me.name);
    end $fn$ $f$;
  execute 'revoke all on function public.ai_agent_set_auto(boolean) from public, anon';
  execute 'grant execute on function public.ai_agent_set_auto(boolean) to authenticated';

  -- 6) «اتعاملت» من غير رسالة
  execute $f$
    create or replace function public.wa_ai_escalation_dismiss(p_conversation_id uuid) returns jsonb
    language plpgsql security definer
    set search_path to 'public', 'app', 'pg_temp'
    as $fn$
    declare v_tenant uuid; n integer;
    begin
      v_tenant := app.current_tenant_id();
      if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
      update public.wa_conversations
         set ai_escalated_at = null, ai_escalation_note = null, ai_hold_at = null
       where id = p_conversation_id and tenant_id = v_tenant and ai_escalated_at is not null;
      get diagnostics n = row_count;
      return jsonb_build_object('ok', true, 'cleared', n);
    end $fn$ $f$;
  execute 'revoke all on function public.wa_ai_escalation_dismiss(uuid) from public, anon';
  execute 'grant execute on function public.wa_ai_escalation_dismiss(uuid) to authenticated';

  -- 7) نص رسالة الاعتذار (بيانات — المواعيد من كلام المالك 16 نوفمبر)
  update public.ai_settings
     set facts = facts || jsonb_build_object('hold_message',
       'معلش يا فندم، أنا المساعد الآلي لعتبة والنقطة دي محتاجة زميل مختص يرد على حضرتك فيها. مواعيد الشغل من السبت للخميس من 12 الضهر لـ 7 مساءً، وهيتواصلوا مع حضرتك أول ما يبدأوا 🙏')
   where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';

  perform pg_notify('pgrst', 'reload schema');
end $mig$;
