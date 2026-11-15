-- الخطوة 3 للـAI Agent — 🔴 لسه مااتطبّقتش · مستنية موافقة المالك (اتجهّزت واتجرّبت بترانزاكشن راجعة 15 نوفمبر 2026).
-- trigger تاني على wa_messages بينادي wa-ai-draft لكل رسالة واردة (pg_net) — trg_wa_after_message_insert و wa-inbox-ingest و wa-send مايتلمسوش.
-- التشغيل على مرحلتين: (أ) الملف ده = الدالة + التريجر (خامل طول ما mode='off') · (ب) update ai_settings set mode='shadow' = مفتاح التشغيل.
-- الإيقاف الفوري: update public.ai_settings set mode = 'off' where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
--
-- التجربة الراجعة على الحي (الطابور = net.http_request_queue):
--   mode=off → 0 نداء · shadow + نص وارد → 1 (الحمولة {message_id} بس · timeout 15000) · صادر → 0 · زرار → 0 · صوت → 1 ·
--   التوكن مش موجود → 0 · خطأ جوّه الدالة (عمود اتغيّر اسمه) → 0 والرسالة دخلت عادي · الخمس رسايل اتسجّلوا · الصلاحية postgres بس.
-- 🔴 قايمة الأنواع المستبعدة = قايمة skip في preRule (_shared/ai-draft.ts) بالحرف — لو واحدة اتغيّرت التانية تتغيّر.
-- 🔴 مفيش DROP (درس 53) · lock_timeout قصير: CREATE TRIGGER بياخد قفل على wa_messages لحظة.

set local lock_timeout = '3s';

create or replace function app.wa_ai_draft_enqueue() returns trigger
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
set lock_timeout to '2s'
as $fn$
declare v_mode text; v_token text;
begin
  begin
    select mode into v_mode from public.ai_settings where tenant_id = new.tenant_id;
    if v_mode is null or v_mode not in ('shadow', 'auto') then return null; end if;
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
end $fn$;

revoke all on function app.wa_ai_draft_enqueue() from public, anon, authenticated;

create trigger trg_wa_ai_draft_enqueue after insert on public.wa_messages for each row
  when (new.direction = 'in' and new.type not in ('button', 'reaction', 'sticker', 'unsupported'))
  execute function app.wa_ai_draft_enqueue();
