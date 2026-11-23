-- رسوم إلغاء الأوردر اللي مع شركة الشحن (23 نوفمبر — طلب المالك):
--   «لو في حد حب يلغي طلب و هو مع شركة الشحن يقوله انه كلفنا شحن و انه المفروض يحول 50% من ثمن الشحن … و يطلب منه يحول
--    50 جنيه فودافون كاش و انستا باي و يطلب اسكرين و يفضل يستفسر كل شوية حول ولا لا».
-- الكود في wa-ai-draft v16 (_shared/ai-fee.ts). الجدول ده بيمسك «طلب الرسوم» لكل محادثة عشان التذكير يعرف يستفسر:
--   • بيتعمل لما رد البوت اللي فيه رقم التحويل **اتبعت فعلاً** لأوردر J&T استلمته من عندنا (feeAfterSend).
--   • waiting = التذكير شغّال · quiet = التذكير وقف (الحد · نافذة واتساب · العميل رد ومحدش اتعامل) بس لسه مستنيين السكرين ·
--     paid (صورة أو قال حوّل) · refused · keep (هيستلم) · closed (موظف كتب · التصعيد اتقفل · الأوردر اتسلّم/اتلغى/رجع).
--   • asked_at = آخر مرة البوت سأل (الطلب · سؤال تاني · آخر تذكير) — التذكير بيتعد منها، وبس لو العميل ماردش بعدها.
-- 🔴 مفيش DROP (درس 53) · مفيش FK (درس 59) · service_role بس (الواجهة مابتقراش الجدول ده — اللي يهم الموظف بيتكتب في «🚩 تصعيد»).
-- التذكير: pg_cron sahl-ai-fee-followup كل نص ساعة → app.ai_fee_tick() → wa-ai-draft { action: "fee_followup" } — بس من 10 الصبح
--   لـ 10 بالليل (القاهرة) ولو فيه طلب waiting عدّى عليه 3 ساعات من آخر سؤال (غير كده مفيش نداء أصلاً).
-- الميزة نفسها بتشتغل بـ ai_settings.facts.cancel_fee (migration بيانات منفصل) — من غيره البوت ماعرفش حاجة عن الرسوم والجدول فاضي.
-- الرجوع (من غير مسح حاجة):
--   select cron.alter_job((select jobid from cron.job where jobname = 'sahl-ai-fee-followup'), active := false);  -- التذكير بس
--   update public.ai_settings set facts = facts - 'cancel_fee' where tenant_id = '9c58b214-f11d-4de5-afc7-a0de0b903f36';  -- الميزة كلها

set lock_timeout = '3s';

create table if not exists public.wa_ai_fee_requests (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  conversation_id uuid not null,
  order_id uuid,
  order_uid text,
  amount numeric(10, 2) not null,
  state text not null default 'waiting',
  requested_at timestamptz not null default now(),
  asked_at timestamptz not null default now(),
  reminders integer not null default 0,
  last_reminder_at timestamptz,
  state_at timestamptz,
  close_reason text,
  trigger_message_id uuid,
  constraint wa_ai_fee_amount_chk check (amount > 0 and amount <= 1000),
  constraint wa_ai_fee_state_chk check (state in ('waiting', 'quiet', 'paid', 'refused', 'keep', 'closed')),
  constraint wa_ai_fee_reminders_chk check (reminders between 0 and 10),
  constraint wa_ai_fee_reason_len check (close_reason is null or length(close_reason) <= 200),
  constraint wa_ai_fee_uid_len check (order_uid is null or length(order_uid) <= 40)
);
-- طلب مفتوح واحد للمحادثة (نداءين للبوت مع بعض مايعملوش طلبين — التاني بيقع والبوت مابيعملش أي أثر)
create unique index if not exists wa_ai_fee_one_open on public.wa_ai_fee_requests (conversation_id) where state in ('waiting', 'quiet');
create index if not exists wa_ai_fee_waiting on public.wa_ai_fee_requests (asked_at) where state = 'waiting';
create index if not exists wa_ai_fee_conv on public.wa_ai_fee_requests (conversation_id, requested_at desc);

alter table public.wa_ai_fee_requests enable row level security;
revoke all on table public.wa_ai_fee_requests from public, anon, authenticated;
grant select, insert, update on table public.wa_ai_fee_requests to service_role;
comment on table public.wa_ai_fee_requests is
  'رسوم إلغاء الأوردر اللي مع شركة الشحن (wa-ai-draft v16 · _shared/ai-fee.ts) — طلب لكل محادثة + التذكير. service_role بس.';

create or replace function app.ai_fee_tick() returns integer
  language plpgsql security definer
  set search_path = public, app, pg_temp
  set lock_timeout = '2s'
  set statement_timeout = '10s'
as $fn$
declare
  v_token text; v_h integer;
begin
  v_h := extract(hour from (now() at time zone 'Africa/Cairo'))::integer;
  if v_h < 10 or v_h >= 22 then return 0; end if;  -- نفس FEE_HOUR_FROM / FEE_HOUR_TO في ai-fee.ts
  if not exists (select 1 from public.wa_ai_fee_requests
                  where state = 'waiting' and asked_at <= now() - interval '3 hours') then return 0; end if;  -- FEE_FIRST_GAP_MS
  select value into v_token from public.platform_settings where key = 'jt_diag_token';
  if v_token is null or length(v_token) < 24 then return 0; end if;
  perform net.http_post(
    url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/wa-ai-draft',
    body := jsonb_build_object('action', 'fee_followup'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-diag-token', v_token),
    timeout_milliseconds := 30000);
  return 1;
end
$fn$;
revoke all on function app.ai_fee_tick() from public, anon, authenticated;

select cron.schedule('sahl-ai-fee-followup', '13,43 * * * *', $$select app.ai_fee_tick()$$);
