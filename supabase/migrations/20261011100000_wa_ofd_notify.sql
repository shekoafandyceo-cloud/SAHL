-- wa_ofd_notify — رسالة واتساب أوتوماتيك للعميل «المندوب في الطريق» (11 أكتوبر — طلب المالك)
--
-- أول ما شحنة J&T تاخد مسح 94 ذهاب (Delivery scan = المندوب خرج بيها) العميل بيستلم قالب UTILITY فيه اسم المندوب
-- ورقمه ورقم المحل — عشان يتفق مع المندوب على معاد، ولو فيه مشكلة يكلّمنا على طول.
--
-- قرارات المالك (10 أكتوبر):
--   1) الإرسال على أول 94 ذهاب · تاني بس لو 94 أحدث **برقم مندوب مختلف** · نفس المندوب يوم تاني = مفيش · سقف 3 للأوردر.
--   2) اسم المندوب ورقمه بيتبعتوا (موافقته) + رقم المحل في {{5}} («لو في مشكلة يرن علينا على طول»).
--   3) الإرسال 9 الصبح–9 بالليل القاهرة بس. المسح بالليل (أو قبل 9) بيستنى لـ9 الصبح — بآخر مندوب بس، ولو الشحنة
--      لسه ماتسلّمتش. الساعات أعمدة إعداد بحدود 8–22 بالـCHECK.
--   4) القالب `order_out_for_delivery_ar` · ar_EG · UTILITY · 5 متغيرات بالترتيب: الاسم الأول · رقم الطلب · اسم المندوب ·
--      رقم المندوب · رقم المحل. مفيش متغير فاضي أبداً (ميتا بترفضه).
--   5) مقفول (mode='off') لحد ما المالك يأكد موافقة ميتا — والتشغيل عمره ما بيبعت للتاريخ (enabled_since من التريجر).
--
-- اللي اتقاس 10 أكتوبر (قراية بس):
--   • 14 يوم: 740 مسح 94 ذهاب على 432 بوليصة — اسم/رقم المندوب طلع من الـdesc في 740/740 (نفس regex app.jt_issue_courier).
--   • 122 بوليصة (28%) أخدت ≥2 مندوب مختلف ⇒ القاعدة دي ≈ 41 رسالة/يوم (السقف اليومي 150 حماية تكلفة).
--   • حارس «خرج من الفرع فعلاً»: 685 من 688 مسح 94 حقيقي قبله 50 أو 92 — و`10` مابيزوّدش ولا واحد وبيعدّي شكل 3 أكتوبر
--     (43 مسح 94 في فرع المرسل قبل أي استلام) — فالحارس 50/92 بس.
--   • tenant_id/order_id متعبّيين في 100% من jt_events آخر 14 يوم ⇒ العزل على الحدث نفسه (أوردر + متجر + بوليصة).
--   • تأخير الـpush: وسيط 1.4 د · p99 15.5 د ⇒ نافذة «طازة» 6 ساعات من وقت الاستحقاق.
--
-- الشكل:
--   wa_auto_templates (service بس — مفيش قراية من المتصفح: فيه رقم المحل وأرقام الـpilot) · wa_ofd_sends (صف لكل أوردر×مسح —
--   **صفر كتابة على orders** عشان الريل-تايم مايعيدش رسم نافذة التفاصيل ويمسح كلام الموظف) · wa_ofd_runs (سجل 14 يوم) ·
--   المرشّحين/الحجز/الختم/النتيجة/التنضيف = دوال service · wa-ofd-notify (EF) بتبعت لميتا · app.wa_ofd_tick من pg_cron
--   (migration تاني) · jt_sync_health + مفتاح `ofd` (بانر الأدمن — درس 51).
--
-- مراجعتين عدائيتين قبل الكتابة: الساعة مش باراميتر (wa_ofd_now — جلسة PostgREST دايماً now()) · الختم قبل ميتا
-- (dispatched_at) يفرّق «ماخرجتش» عن «مش عارفين» · كل claim = محاولة (مستحيل 4 إرسالات) · «الرقم ميّت» للرقم نفسه بس ·
-- circuit breaker على نفس الكود · العزل بالأوردر+المتجر+البوليصة · موبايل مصري بس · الحجز بالليل بيغطي الحدود (20:58).
--
-- 🔴 مفيش أي أمر حذف (درس 53) — التريجر `create trigger` من غير حذف قبله. اتجرّب بترانزاكشن راجعة الأول.

set local lock_timeout = '4s';

-- ── 1) فهرس ───────────────────────────────────────────────────────────────
-- المرشّحين بيبصوا على آخر 20 ساعة (بالإعداد الافتراضي) كل دقيقة — من غيره seq scan على الجدول كله (~380 صف/يوم)
create index if not exists jt_events_received_idx on public.jt_events (received_at);

-- ── 2) ساعة الاختبار ──────────────────────────────────────────────────────
-- 🔴 الساعة دي للاختبار جوّه ترانزاكشن راجعة بس: set_config('wa_ofd.test_clock', '…', true).
-- أي نداء من PostgREST (الـEF) session_user = authenticator ⇒ دايماً now() — مفيش باراميتر يقدر يحرّك الساعة للإرسال الحقيقي.
create or replace function app.wa_ofd_now() returns timestamptz
language sql stable set search_path = pg_catalog as $fn$
  select case when session_user::text <> 'authenticator'
               and nullif(current_setting('wa_ofd.test_clock', true), '') is not null
              then current_setting('wa_ofd.test_clock', true)::timestamptz
              else now() end
$fn$;
revoke all on function app.wa_ofd_now() from public, anon, authenticated;

-- ── 3) القوالب الأوتوماتيك ─────────────────────────────────────────────────
create table if not exists public.wa_auto_templates (
  tenant_id      uuid not null references public.tenants(id),
  event          text not null check (event in ('out_for_delivery')),
  template_name  text not null check (template_name ~ '^[a-z0-9_]+$' and length(template_name) <= 512),   -- ⚠️ {1,512} = خطأ (سقف التكرار في Postgres 255)
  lang           text not null default 'ar_EG',
  category       text not null default 'utility' check (category = 'utility'),
  body           text not null check (length(body) between 1 and 1024),   -- = المسجّل عند ميتا بالحرف
  param_count    smallint not null check (param_count between 0 and 10),
  store_phone    text,                                                    -- {{5}} — NULL = tenants.support_phone ← sender_phone
  mode           text not null default 'off' check (mode in ('off', 'pilot', 'on')),
  enabled_since  timestamptz,                                             -- بيتكتب من التريجر بس
  pilot_wa_ids   text[] not null default '{}',
  send_from_hour smallint not null default 9  check (send_from_hour between 8 and 12),   -- حد خارجي: مفيش إرسال قبل 8 الصبح
  send_to_hour   smallint not null default 21 check (send_to_hour between 18 and 22),    -- ولا بعد 10 بالليل مهما الإعداد اتغيّر
  max_per_order  smallint not null default 3   check (max_per_order between 1 and 5),
  max_per_day    smallint not null default 150 check (max_per_day between 1 and 500),   -- سقف تكلفة (~3.6× المقاس 41/يوم)
  fresh_minutes  int      not null default 360 check (fresh_minutes between 15 and 720),
  paused_at      timestamptz,
  paused_reason  text,
  paused_until   timestamptz,       -- NULL مع paused_at = إيقاف يدوي · قيمة = تجربة واحدة أوتوماتيك بعدها (132015 / circuit)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, event),
  check (send_to_hour > send_from_hour),
  check (mode = 'off' or enabled_since is not null)
);
comment on table public.wa_auto_templates is
  'قوالب واتساب أوتوماتيك على حدث (out_for_delivery = J&T مسح 94 ذهاب). service بس — مفيش قراية من المتصفح (فيها أرقام الـpilot ورقم المحل). التسجيل بـSQL بعد موافقة ميتا (النص = المسجّل بالحرف). mode off/pilot/on · enabled_since من التريجر = مفيش backfill · الساعات بحدود 8–22 بالـCHECK.';

create or replace function app.wa_auto_tpl_guard() returns trigger
language plpgsql set search_path = pg_catalog as $fn$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.enabled_since := case when new.mode <> 'off' then now() end;
  elsif new.mode is distinct from old.mode then
    new.enabled_since := case when new.mode <> 'off' then now() end;
    new.paused_at := null; new.paused_reason := null; new.paused_until := null;   -- تشغيل من جديد = الإيقاف اتحل
  else
    new.enabled_since := old.enabled_since;                                       -- 🔴 مايتكتبش بإيد
  end if;
  new.pilot_wa_ids := coalesce(new.pilot_wa_ids, '{}');
  return new;
end $fn$;
create trigger trg_wa_auto_tpl_guard before insert or update on public.wa_auto_templates
  for each row execute function app.wa_auto_tpl_guard();      -- 🔴 من غير حذف قبله (درس 53)

alter table public.wa_auto_templates enable row level security;   -- مفيش ولا سياسة = مقفول على authenticated
revoke all on public.wa_auto_templates from public, anon, authenticated;
revoke all on function app.wa_auto_tpl_guard() from public, anon, authenticated;

-- البذرة (آمنة — mode الافتراضي off). النص = المسجّل عند ميتا بالحرف (سطور \n · سطر فاضي بين التلات بلوكات · 🚚)
insert into public.wa_auto_templates (tenant_id, event, template_name, lang, body, param_count)
select t.id, 'out_for_delivery', 'order_out_for_delivery_ar', 'ar_EG',
  E'أهلاً {{1}}،\nطلبك رقم {{2}} خرج النهارده مع مندوب الشحن وفي الطريق ليك 🚚\n\nاسم المندوب: {{3}}\nرقم المندوب: {{4}}\n\nتقدر تكلّم المندوب على طول لو حابب تتفق معاه على معاد الاستلام.\nولو فيه أي مشكلة كلّمنا على {{5}} أو رد على الرسالة دي.',
  5
from public.tenants t where t.slug = '3ataba'
on conflict (tenant_id, event) do nothing;

-- ── 4) اللي اتبعت ─────────────────────────────────────────────────────────
create table if not exists public.wa_ofd_sends (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null,
  order_id      uuid not null,                 -- مش FK عن قصد
  tracking_no   text not null,
  scan_at       timestamptz not null,          -- وقت مسح الـ94 عند J&T (app.jt_scan_ts)
  scan_rx       timestamptz,                   -- أول وصول للمسح عندنا
  courier_name  text,
  courier_phone text not null,                 -- 01xxxxxxxxx
  wa_id         text not null,                 -- 20xxxxxxxxxx
  status        text not null check (status in ('sending','sent','failed_transient','failed_permanent','deferred','unknown','expired')),
  error_class   text check (error_class in ('recipient','message','config','retries_exhausted','stuck')),
  attempts      smallint not null default 0,   -- = عدد مرات الـclaim للإرسال (الـrelease بيرجّع واحدة)
  next_try_at   timestamptz,
  claimed_at    timestamptz,
  dispatched_at timestamptz,                   -- 🔴 لحظة قبل fetch لميتا بالظبط — من غيرها الصف «ماخرجش مننا»
  sent_at       timestamptz,
  wa_message_id text,
  wa_msg_row    uuid,                          -- wa_messages.id
  error_code    text,
  error_detail  text,                          -- مقصوص 300 ومتنضّف من أي رقم (≥8 خانات بمسافات/شرط)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_id, scan_at)
);
create unique index if not exists wa_ofd_sends_one_inflight on public.wa_ofd_sends (order_id) where status = 'sending';
create index if not exists wa_ofd_sends_tenant_created on public.wa_ofd_sends (tenant_id, created_at desc);
create index if not exists wa_ofd_sends_open on public.wa_ofd_sends (status, claimed_at)
  where status in ('sending', 'failed_transient', 'deferred');
comment on table public.wa_ofd_sends is
  'رسايل «المندوب في الطريق» (wa-ofd-notify): صف لكل (أوردر، مسح 94). sent + unknown (اتبعت لميتا) بيتحسبوا في السقف وفي «آخر مندوب». الكتابة من دوال wa_ofd_* بس (service).';
alter table public.wa_ofd_sends enable row level security;
create policy wa_ofd_sends_select on public.wa_ofd_sends
  for select to authenticated using (is_super_admin() or tenant_id = app.current_tenant_id());
revoke all on public.wa_ofd_sends from public, anon, authenticated;
grant select on public.wa_ofd_sends to authenticated;

-- ── 5) سجل التشغيل (14 يوم — الـEF بتمسح القديم) ───────────────────────────
create table if not exists public.wa_ofd_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null, claimed int not null default 0,
  tenant_ids uuid[] not null default '{}',             -- المتاجر اللي الدورة لمستها ('{}' = خطأ عام قبل أي صف)
  tally jsonb not null default '{}'::jsonb,            -- مفاتيح = أكواد بس
  error text check (error is null or error ~ '^[a-z0-9_:.-]{1,80}$'));   -- 🔴 كود بس — مستحيل يتخزن نص Postgres/ميتا فيه رقم
alter table public.wa_ofd_runs enable row level security;
revoke all on public.wa_ofd_runs from public, anon, authenticated;
revoke all on sequence public.wa_ofd_sends_id_seq, public.wa_ofd_runs_id_seq from public, anon, authenticated;   -- pg_default_acl بيدّي rwU

-- ── 6) تنضيف أي نص خطأ من الأرقام (نفس maskDigits في الـEF بالحرف) ──────────
create or replace function app.wa_ofd_mask(p text) returns text
language sql immutable set search_path = pg_catalog as $fn$
  select left(regexp_replace(coalesce(p, ''), '\+?[0-9٠-٩][0-9٠-٩\s-]{6,}[0-9٠-٩]', '#', 'g'), 300)
$fn$;
revoke all on function app.wa_ofd_mask(text) from public, anon, authenticated;

-- ── 6ب) آخر «استحقاق» ممكن للمسح (مراجعة 10 أكتوبر — الثوابت كانت محفورة 16س/20س ومش بتمشي مع الإعداد) ─────
-- نفس قاعدة الحجز في المرشّحين (9): المسح من ساعة قبل القفلة لحد آخر اليوم = فتحة بكرة · قبل الفتحة = فتحة النهارده ·
-- غير كده = وقته. المرشّحين بيشوفوا المسح «طازة» لحد ده + fresh_minutes بس ⇒ التنضيف بيقفل الصف بعده بالظبط (مش قبله).
create or replace function app.wa_ofd_last_due(p_t timestamptz, p_from int, p_to int) returns timestamptz
language sql stable set search_path = pg_catalog as $fn$
  select case when extract(hour from l) >= p_to - 1
              then (date_trunc('day', l) + interval '1 day' + make_interval(hours => p_from)) at time zone 'Africa/Cairo'
              when extract(hour from l) < p_from
              then (date_trunc('day', l) + make_interval(hours => p_from)) at time zone 'Africa/Cairo'
              else p_t end
  from (select p_t at time zone 'Africa/Cairo' as l) x
$fn$;
revoke all on function app.wa_ofd_last_due(timestamptz, int, int) from public, anon, authenticated;

-- ── 7) مسحات البوليصة بشكل واحد (push details[] + pull) ───────────────────
-- 🔴 بالأوردر والمتجر والبوليصة مع بعض (عزل المتاجر مش على رقم J&T لوحده)
create or replace function app.jt_bill_scans(p_order uuid, p_tenant uuid, p_bill text)
returns table (t timestamptz, code text, refund boolean, descr text, src text, rx timestamptz)
language sql stable set search_path = public, app, pg_temp as $fn$
  select app.jt_scan_ts(d->>'scanTime'),
         coalesce(nullif(d->>'scanTypeCode', ''), 'name:' || lower(btrim(coalesce(d->>'scanType', '')))),
         coalesce(d->>'isRefund', '') = '1',
         coalesce(d->>'desc', ''), 'push', e.received_at
  from public.jt_events e
  cross join lateral jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
                                               then e.payload->'details' else '[]'::jsonb end) d
  where e.bill_code = p_bill and e.order_id = p_order and e.tenant_id = p_tenant and e.kind = 'trace' and e.digest_ok
    and coalesce(nullif(d->>'billCode', ''), e.bill_code) = p_bill
  union all
  select app.jt_scan_ts(e.payload->>'scanTime'),
         regexp_replace(coalesce(e.payload->>'scanCode', ''), '^refund:', ''),
         coalesce(e.payload->>'refund', '') = 'true' or coalesce(e.payload->>'scanCode', '') like 'refund:%',
         coalesce(e.payload->>'desc', ''), 'pull', e.received_at
  from public.jt_events e
  where e.bill_code = p_bill and e.order_id = p_order and e.tenant_id = p_tenant and e.kind = 'pull' and e.digest_ok
$fn$;
revoke all on function app.jt_bill_scans(uuid, uuid, text) from public, anon, authenticated;

-- ── 8) المرشّحين — قراية بس (مفيش باراميتر ساعة) ───────────────────────────
-- p_shadow = معاينة بس (dry_run + shadow): بيتجاهل mode/pilot/enabled_since — بيحترم الإيقاف والساعات والطازة والسقف.
create or replace function public.wa_ofd_candidates_v1(p_limit int default 8, p_uids text[] default null, p_shadow boolean default false)
returns table (
  order_id uuid, tenant_id uuid, order_uid text, tracking_no text, customer_name text, wa_id text,
  scan_at timestamptz, scan_rx timestamptz, courier_name text, courier_phone text, due_at timestamptz, send_until timestamptz,
  send_no int, retry_id bigint, probing boolean, template_name text, lang text, body text, param_count int, store_phone text)
language sql stable security definer set search_path = public, app, pg_temp as $fn$
with clk as (
  select app.wa_ofd_now() as now_, (app.wa_ofd_now() at time zone 'Africa/Cairo') as loc
),
cfg as (                                                     -- (1) الإعداد + الساعات + واتساب التاجر + السقف اليومي
  select a.tenant_id as cfg_tenant, a.template_name, a.lang, a.body, a.param_count::int as param_count, a.mode, a.pilot_wa_ids,
         a.max_per_order, a.fresh_minutes, a.enabled_since, clk.now_, (a.paused_at is not null) as probing,
         coalesce(nullif(btrim(a.store_phone), ''), nullif(btrim(t.support_phone), ''), nullif(btrim(t.sender_phone), '')) as store_ph,
         ((date_trunc('day', clk.loc) + make_interval(hours => a.send_from_hour)) at time zone 'Africa/Cairo') as open_today,
         ((date_trunc('day', clk.loc) + make_interval(hours => a.send_to_hour)) at time zone 'Africa/Cairo') as close_today,
         ((date_trunc('day', clk.loc) - interval '1 day' + make_interval(hours => a.send_to_hour)) at time zone 'Africa/Cairo') as close_prev,
         -- أطول عمر للمسح (من وصوله) ممكن يتبعت فيه = أطول حجز (25 - to + from) + الطازة + ساعة هامش (تغيير الساعة)
         -- الافتراضي (9/21/360) = 20 ساعة بالظبط زي ما كان — بس بيتمد مع الإعداد بدل ما يقص في صمت
         make_interval(hours => 26 - a.send_to_hour + a.send_from_hour, mins => a.fresh_minutes) as horizon
  from wa_auto_templates a
  join tenants t on t.id = a.tenant_id
  cross join clk
  where a.event = 'out_for_delivery'
    and (a.paused_at is null or (a.paused_until is not null and a.paused_until <= clk.now_))      -- إيقاف · أو تجربة بعد 3 ساعات
    and (p_shadow or (a.mode <> 'off' and a.enabled_since is not null))
    and extract(hour from clk.loc) >= a.send_from_hour and extract(hour from clk.loc) < a.send_to_hour   -- (2) بره الساعات = ولا مرشّح
    and t.whatsapp_phone_id is not null and t.whatsapp_token is not null
    and not coalesce((select w.is_depleted from wallet_state w where w.tenant_id = a.tenant_id), false)
    and (select count(*) from wa_ofd_sends x where x.tenant_id = a.tenant_id
           and x.status in ('sent', 'unknown', 'sending')
           and x.created_at >= (date_trunc('day', clk.loc) at time zone 'Africa/Cairo')) < a.max_per_day   -- سقف اليوم (القاهرة)
),
bills as (                                                   -- (3) 94 ذهاب في نافذة الإعداد (20س بالافتراضي) — بالأوردر والمتجر من الحدث نفسه
  select distinct e.bill_code as bill, e.order_id as ev_order, e.tenant_id as ev_tenant
  from jt_events e cross join clk cross join (select max(horizon) as hz from cfg) z
  where e.received_at > clk.now_ - z.hz and e.digest_ok and e.order_id is not null and e.tenant_id is not null
    and ((e.kind = 'pull' and e.payload->>'scanCode' = '94' and coalesce(e.payload->>'refund', '') <> 'true')
      or (e.kind = 'trace' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
                                            then e.payload->'details' else '[]'::jsonb end) d
                                       where d->>'scanTypeCode' = '94' and coalesce(d->>'isRefund', '') <> '1')))
),
ord as (                                                     -- (4) J&T · مش نهائي · موبايل مصري · pilot
  select o.id, o.tenant_id, o.order_uid, o.tracking_no, o.customer_name, app.wa_id_from_phone(o.phone) as wa_id, c.*
  from bills b
  join orders o on o.id = b.ev_order and o.tenant_id = b.ev_tenant and o.tracking_no = b.bill and o.shipping_carrier = 'jt'
  join cfg c on c.cfg_tenant = o.tenant_id
  where lower(coalesce(o.status, '')) not in ('delivered', 'returned to business', 'returned to business2', 'returned', 'cancelled', 'failed')
    and app.wa_id_from_phone(o.phone) is not null
    and app.ship_rank_p10(o.phone) is not null                                      -- 🔴 موبايل مصري بس (مش أرضي/غلط)
    and (p_uids is null or o.order_uid = any(p_uids))
    and (p_shadow or c.mode = 'on' or app.wa_id_from_phone(o.phone) = any(c.pilot_wa_ids))
),
l94 as (                                                     -- (5) آخر 94 ذهاب — push وpull لنفس المسح = صف واحد
  select ord.*, s.t, s.rx, s.descr
  from ord cross join lateral (
    select x.t, min(x.rx) as rx, max(x.descr) as descr
    from app.jt_bill_scans(ord.id, ord.tenant_id, ord.tracking_no) x
    where x.code = '94' and not x.refund and x.t is not null
    group by x.t order by x.t desc limit 1) s
),
g as (
  select l.*, f.ret_before, f.picked, f.superseded,
         nullif(btrim(substring(l.descr from 'courier ([^(]+)\(')), '') as c_name,      -- نفس regex app.jt_issue_courier
         substring(l.descr from 'courier [^(]*\((0[0-9]{10})\)') as c_phone,
         -- (9) الإيقاف: أي مسح من ساعة قبل قفلة امبارح لحد فتحة النهارده (اتعمل بالليل · أو اتعمل قبل 9 ومالحقش يتبعت) = يستنى الفتحة
         case when l.t >= l.close_prev - interval '1 hour' and l.t < l.open_today then l.open_today else l.t end as due
  from l94 l cross join lateral (
    select bool_or(x.t < l.t and (x.refund or x.code in ('172', '13', '111'))) as ret_before,   -- (6) رحلة مرتجع
           bool_or(x.t < l.t and not x.refund and x.code in ('50', '92')) as picked,           -- (7) خرج من الفرع فعلاً (مش 10)
           bool_or(x.t > l.t) as superseded                                                    -- (8) حصل حاجة بعد الـ94
    from app.jt_bill_scans(l.id, l.tenant_id, l.tracking_no) x where x.t is not null) f
),
h as (                                                       -- (10) اللي اتبعت قبل كده للأوردر
  select g.*,
         coalesce(s.n_sent, 0) as n_sent, s.last_phone, coalesce(s.dead, false) as dead,
         r.id as row_id, r.status as row_status, r.attempts as row_attempts, r.next_try_at as row_next
  from g
  left join lateral (
    select count(*) filter (where x.status in ('sent', 'unknown', 'sending')) as n_sent,
           (array_agg(x.courier_phone order by x.scan_at desc) filter (where x.status in ('sent', 'unknown', 'sending')))[1] as last_phone,
           -- 🔴 «الرقم ده ميّت» للرقم نفسه بس — الموظف صلّح التليفون = يتبعت للجديد
           bool_or(x.wa_id = g.wa_id and (
                     (x.status = 'failed_permanent' and x.error_class = 'recipient')
                     or exists (select 1 from wa_messages m where m.id = x.wa_msg_row and m.status = 'failed'))) as dead
    from wa_ofd_sends x where x.order_id = g.id) s on true
  left join wa_ofd_sends r on r.order_id = g.id and r.scan_at = g.t
)
select h.id, h.tenant_id, h.order_uid, h.tracking_no, h.customer_name, h.wa_id,
       h.t, h.rx, h.c_name, h.c_phone, h.due, h.close_today, (h.n_sent + 1)::int, h.row_id, h.probing,
       h.template_name, h.lang, h.body, h.param_count, h.store_ph
from h
-- (11) مفيش backfill — على المسحات الجديدة بس: صف موجود (retry/deferred) اتعمل وهو مشغّل، فتغيير mode (pilot→on ·
--      off→on بعد إيقاف) مايسيبوش متعلّق 16 ساعة والبانر يقول «متأخرة» (مراجعة 10 أكتوبر)
where (p_shadow or h.row_id is not null or h.t >= h.enabled_since)
  and not coalesce(h.ret_before, false) and coalesce(h.picked, false) and not coalesce(h.superseded, false)
  and h.c_phone is not null and app.ship_rank_p10(h.c_phone) is not null
  and h.store_ph is not null
  and h.now_ >= h.due and h.now_ - h.due <= make_interval(mins => h.fresh_minutes) -- (12) طازة (6 ساعات من due)
  and h.n_sent < h.max_per_order                                                  -- (13) السقف 3
  and h.last_phone is distinct from h.c_phone                                     -- (14) نفس المندوب = مفيش
  and not h.dead                                                                  -- (15)
  and (h.row_id is null                                                           -- (16) جديد أو retry مستحق
       or (h.row_status = 'failed_transient' and h.row_attempts < 3 and h.row_next <= h.now_)
       or (h.row_status = 'deferred' and h.row_next <= h.now_))
order by h.due, h.t
limit greatest(1, least(coalesce(p_limit, 8), 20));
$fn$;
revoke all on function public.wa_ofd_candidates_v1(int, text[], boolean) from public, anon, authenticated;
grant execute on function public.wa_ofd_candidates_v1(int, text[], boolean) to service_role;

-- ── 9) التنضيف: صفوف متعلّقة + retry عدّى زمنه (كل دقيقة من الـtick وفي أول كل claim) ─────
create or replace function public.wa_ofd_housekeep_v1() returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $fn$
declare v_now timestamptz := app.wa_ofd_now(); n_rel int; n_unk int; n_exp int;
begin
  -- (أ) اتعلّمت sending ومحدش بعتها لميتا (الـEF ماتت/اتقطعت قبل الإرسال) = ترجع deferred فوراً ومحاولتها ترجع (ماخرجتش مننا)
  update wa_ofd_sends s set status = 'deferred', next_try_at = v_now, attempts = greatest(0, s.attempts - 1),
         error_code = 'released_undispatched', updated_at = v_now
   where s.status = 'sending' and s.dispatched_at is null and s.claimed_at < v_now - interval '5 minutes';
  get diagnostics n_rel = row_count;
  -- (ب) خرجت لميتا ومعرفناش الرد = unknown (بتتحسب مبعوتة — التكرار أسوأ من الغياب). 15 د > أطول دورة ممكنة (~60ث)
  update wa_ofd_sends s set status = 'unknown', error_class = 'stuck', error_code = 'stuck_sending', updated_at = v_now
   where s.status = 'sending' and s.dispatched_at is not null and s.claimed_at < v_now - interval '15 minutes';
  get diagnostics n_unk = row_count;
  -- (ج) retry مستحيل يترشّح تاني: فيه صف أحدث للأوردر · مسح أحدث على البوليصة (المرشّحين بيشوفوا آخر 94 بس ومن غير أي
  --     حاجة بعده) · الأوردر بقى نهائي · عدّى آخر استحقاق + الطازة (من الإعداد — كانت 16س ثابتة: بتقص الليلة بإعداد 12/18
  --     وبتسيب صف ميّت «متأخر» في البانر). متجر من غير صف إعداد = 16 ساعة زي الأول.
  update wa_ofd_sends s set status = 'expired',
         error_code = case when exists (select 1 from orders o where o.id = s.order_id and lower(coalesce(o.status, ''))
                             in ('delivered', 'returned to business', 'returned to business2', 'returned', 'cancelled', 'failed'))
                           then 'order_final' else 'superseded_or_stale' end,
         updated_at = v_now
   where s.status in ('failed_transient', 'deferred') and (
         exists (select 1 from wa_ofd_sends n where n.order_id = s.order_id and n.scan_at > s.scan_at)
      or exists (select 1 from app.jt_bill_scans(s.order_id, s.tenant_id, s.tracking_no) x where x.t > s.scan_at)
      or v_now > coalesce((select app.wa_ofd_last_due(s.scan_at, a.send_from_hour, a.send_to_hour) + make_interval(mins => a.fresh_minutes)
                             from wa_auto_templates a where a.tenant_id = s.tenant_id and a.event = 'out_for_delivery'),
                          s.scan_at + interval '16 hours')
      or exists (select 1 from orders o where o.id = s.order_id and lower(coalesce(o.status, ''))
                   in ('delivered', 'returned to business', 'returned to business2', 'returned', 'cancelled', 'failed')));
  get diagnostics n_exp = row_count;
  return jsonb_build_object('released', n_rel, 'stuck', n_unk, 'expired', n_exp);
end $fn$;
revoke all on function public.wa_ofd_housekeep_v1() from public, anon, authenticated;
grant execute on function public.wa_ofd_housekeep_v1() to service_role;

-- ── 10) الحجز الذري (مفيش باراميتر ساعة) ───────────────────────────────────
-- الحساب: صف جديد 1 → مؤقت → claim 2 → مؤقت → claim 3 → مؤقت ⇒ failed_permanent/retries_exhausted = 3 إرسالات لميتا بالظبط.
-- release/deferred قبل أو بدل الإرسال بيرجّع واحدة (1→0) والـclaim الجاي بيرجّعها 1.
create or replace function public.wa_ofd_claim_v1(p_limit int default 8, p_uids text[] default null)
returns table (id bigint, attempt int, order_id uuid, tenant_id uuid, order_uid text, tracking_no text, customer_name text,
               wa_id text, scan_at timestamptz, courier_name text, courier_phone text, send_no int, send_until timestamptz,
               probing boolean, template_name text, lang text, body text, param_count int, store_phone text, claimed_at timestamptz)
language plpgsql security definer set search_path = public, app, pg_temp as $fn$
#variable_conflict use_column
declare c record; v_id bigint; v_att int; v_n int; v_last text; v_now timestamptz := app.wa_ofd_now(); v_probed uuid[] := '{}';
        v_day int; v_cap int;
begin
  perform public.wa_ofd_housekeep_v1();
  for c in select * from public.wa_ofd_candidates_v1(least(greatest(coalesce(p_limit, 8), 1), 8), p_uids, false) loop
    if c.probing and c.tenant_id = any(v_probed) then continue; end if;   -- متجر متوقف بيتجرّب برسالة واحدة بس
    begin
      -- 🔴 السقف اليومي لكل صف (مراجعة 10 أكتوبر): المرشّحين بيفحصوه مرة للدفعة كلها — 149/150 + 8 مستحقين كان = 157.
      -- قفل المتجر **قبل** قفل الأوردر (نفس الترتيب في كل تشغيل = مفيش deadlock) · والعدّ بعد القفل = تشغيلين متداخلين مايعدّوش السقف
      perform pg_advisory_xact_lock(hashtextextended('wa_ofd_cap:' || c.tenant_id::text, 0));
      select a.max_per_day into v_cap from wa_auto_templates a where a.tenant_id = c.tenant_id and a.event = 'out_for_delivery';
      select count(*) into v_day from wa_ofd_sends x where x.tenant_id = c.tenant_id and x.status in ('sent', 'unknown', 'sending')
         and x.created_at >= (date_trunc('day', v_now at time zone 'Africa/Cairo') at time zone 'Africa/Cairo');
      if v_day >= coalesce(v_cap, 0) then continue; end if;
      perform pg_advisory_xact_lock(hashtextextended('wa_ofd:' || c.order_id::text, 0));
      select count(*) filter (where x.status in ('sent','unknown','sending')),
             (array_agg(x.courier_phone order by x.scan_at desc) filter (where x.status in ('sent','unknown','sending')))[1]
        into v_n, v_last from wa_ofd_sends x where x.order_id = c.order_id;
      if coalesce(v_n, 0) + 1 <> c.send_no or v_last is not distinct from c.courier_phone then continue; end if;

      v_id := null;
      if c.retry_id is null then
        insert into wa_ofd_sends (tenant_id, order_id, tracking_no, scan_at, scan_rx, courier_name, courier_phone, wa_id,
                                  status, attempts, claimed_at, created_at, updated_at)
        values (c.tenant_id, c.order_id, c.tracking_no, c.scan_at, c.scan_rx, c.courier_name, c.courier_phone, c.wa_id,
                'sending', 1, v_now, v_now, v_now)
        on conflict (order_id, scan_at) do nothing
        returning wa_ofd_sends.id, wa_ofd_sends.attempts into v_id, v_att;
      else
        -- 🔴 كل claim = محاولة (+1 دايماً). الـrelease/deferred بيرجّعوها لو ماحصلش إرسال ⇒ مستحيل 4 إرسالات
        update wa_ofd_sends s set status = 'sending', claimed_at = v_now, dispatched_at = null, updated_at = v_now,
               wa_id = c.wa_id, attempts = s.attempts + 1
         where s.id = c.retry_id and s.status in ('failed_transient', 'deferred') and s.next_try_at <= v_now
        returning s.id, s.attempts into v_id, v_att;
      end if;
      if v_id is null then continue; end if;
      if c.probing then v_probed := v_probed || c.tenant_id; end if;
      id := v_id; attempt := v_att; order_id := c.order_id; tenant_id := c.tenant_id; order_uid := c.order_uid;
      tracking_no := c.tracking_no; customer_name := c.customer_name; wa_id := c.wa_id; scan_at := c.scan_at;
      courier_name := c.courier_name; courier_phone := c.courier_phone; send_no := c.send_no; send_until := c.send_until;
      probing := c.probing; template_name := c.template_name; lang := c.lang; body := c.body;
      param_count := c.param_count; store_phone := c.store_phone; claimed_at := v_now;
      return next;
    exception when unique_violation then
      continue;   -- wa_ofd_sends_one_inflight: تشغيل تاني ماسك الأوردر ده
    end;
  end loop;
end $fn$;
revoke all on function public.wa_ofd_claim_v1(int, text[]) from public, anon, authenticated;
grant execute on function public.wa_ofd_claim_v1(int, text[]) to service_role;

-- ── 11) الختم قبل ميتا بالظبط ──────────────────────────────────────────────
-- 🔴 بالحجز نفسه (p_claimed_at من wa_ofd_claim_v1) ومتكرر بأمان (مراجعة 10 أكتوبر): الـEF بتعيد النداء مرة لو الرد ضاع —
-- لو أول نداء اتسجّل والرد ضاع، الإعادة كانت بترجع NULL والـEF مابتبعتش والصف يبقى «اتبعت غالباً» بعد 15د وهو عمره ما خرج.
-- دلوقتي نفس الحجز = true تاني (الـEF لسه مانادتش ميتا — النداء الواحد بعد الختم) · حجز تاني (اتعمله release واتحجز من
-- تشغيل تاني) = NULL ⇒ تشغيل قديم متأخر مستحيل يبعت صف تشغيل جديد.
create or replace function public.wa_ofd_dispatch_v1(p_id bigint, p_claimed_at timestamptz) returns boolean
language sql security definer set search_path = public, app, pg_temp as $fn$
  with u as (
    update wa_ofd_sends set dispatched_at = app.wa_ofd_now(), updated_at = app.wa_ofd_now()
     where id = p_id and status = 'sending' and claimed_at = p_claimed_at and dispatched_at is null
    returning true as ok)
  select coalesce((select ok from u),
                  (select true from wa_ofd_sends where id = p_id and status = 'sending' and claimed_at = p_claimed_at
                     and dispatched_at is not null))
$fn$;   -- NULL = الصف مابقاش بتاع الحجز ده ⇒ الـEF مابتبعتش
revoke all on function public.wa_ofd_dispatch_v1(bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.wa_ofd_dispatch_v1(bigint, timestamptz) to service_role;

-- ── 12) النتيجة ───────────────────────────────────────────────────────────
-- p_result = {outcome: 'sent'|'transient'|'permanent'|'unknown'|'deferred'|'pause'|'release',
--             wamid?, body?, error_code?, error_detail?, error_class?, circuit?: bool, run_stop?: bool}
--   run_stop مع deferred = خطأ على مستوى الحساب ⇒ إيقاف مؤقت للمتجر (15د سقف نداءات · ساعة الباقي) + تجربة واحدة بعده
-- ⚠️ فجوة معروفة (مااتصلحتش هنا): webhook «failed» أسرع من الـmark (~100–300ms) بيترمي في wa-inbox-ingest
-- (`if (!cur.data) continue`) — التخفيف: «الرقم ميّت» بيقرا wa_messages.status='failed' كمان.
create or replace function public.wa_ofd_mark_v1(p_id bigint, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $fn$
declare s wa_ofd_sends; v_out text := p_result->>'outcome'; v_conv uuid; v_msg uuid; v_note text := 'ok';
        v_now timestamptz := app.wa_ofd_now();
        v_code text := left(nullif(regexp_replace(coalesce(p_result->>'error_code', ''), '[^a-z0-9_:.-]', '', 'g'), ''), 40);
        v_det  text := app.wa_ofd_mask(p_result->>'error_detail');
        v_name text; v_phone text; v_paused boolean := false; v_n int;
begin
  select * into s from wa_ofd_sends where id = p_id for update;
  if not found or s.status <> 'sending' then return jsonb_build_object('ok', false, 'note', 'not_sending'); end if;
  -- 🔴 نتيجة من ميتا من غير dispatch = تناقض — مانكتبش (الـEF لازم تختم قبل fetch)
  -- (permanent مسموح من غير dispatch: خطأ عندنا قبل ميتا زي bad_courier_phone — وقف نهائي آمن ومايلفّش كل دقيقة)
  if v_out in ('sent', 'transient', 'unknown') and s.dispatched_at is null then
    return jsonb_build_object('ok', false, 'note', 'not_dispatched');
  end if;
  if v_out = 'release' and s.dispatched_at is not null then
    return jsonb_build_object('ok', false, 'note', 'already_dispatched');
  end if;

  if v_out = 'sent' then
    update wa_ofd_sends set status = 'sent', sent_at = v_now, wa_message_id = nullif(p_result->>'wamid', ''),
           error_code = null, error_detail = null, updated_at = v_now where id = p_id;
    update wa_auto_templates set paused_at = null, paused_reason = null, paused_until = null      -- التجربة نجحت = الإيقاف اتشال
     where tenant_id = s.tenant_id and event = 'out_for_delivery' and paused_at is not null;
    begin   -- 🔴 الصندوق في بلوك لوحده: لو وقع، الإرسال فاضل «sent» (وإلا رسالة مكررة)
      select o.customer_name, o.phone into v_name, v_phone from orders o where o.id = s.order_id;
      insert into wa_conversations (tenant_id, wa_id, customer_phone, customer_name, last_message_at)
      values (s.tenant_id, s.wa_id, v_phone, v_name, v_now)
      on conflict (tenant_id, wa_id) do nothing;
      select c.id into v_conv from wa_conversations c where c.tenant_id = s.tenant_id and c.wa_id = s.wa_id;
      insert into wa_messages (tenant_id, conversation_id, wa_message_id, direction, type, body, status, wa_timestamp, sent_by, sent_by_name)
      values (s.tenant_id, v_conv, nullif(p_result->>'wamid', ''), 'out', 'template',
              left(coalesce(nullif(p_result->>'body', ''), 'رسالة المندوب في الطريق'), 4096), 'sent', v_now, null,
              'تلقائي · المندوب في الطريق')
      on conflict (tenant_id, wa_message_id) where wa_message_id is not null do nothing
      returning id into v_msg;
      update wa_ofd_sends set wa_msg_row = v_msg where id = p_id;
    exception when others then
      v_note := 'inbox_failed'; raise warning 'wa_ofd_mark_v1 inbox: % %', p_id, sqlstate;
    end;
  elsif v_out = 'transient' then
    if s.attempts >= 3 then
      update wa_ofd_sends set status = 'failed_permanent', error_class = 'retries_exhausted', error_code = v_code, error_detail = v_det, updated_at = v_now where id = p_id;
    else
      update wa_ofd_sends set status = 'failed_transient',
             next_try_at = v_now + case when s.attempts <= 1 then interval '2 minutes' else interval '5 minutes' end,
             error_code = v_code, error_detail = v_det, updated_at = v_now where id = p_id;
    end if;
  elsif v_out = 'permanent' then
    update wa_ofd_sends set status = 'failed_permanent',
           error_class = case when p_result->>'error_class' in ('recipient','message','config') then p_result->>'error_class' else 'message' end,
           error_code = v_code, error_detail = v_det, updated_at = v_now where id = p_id;
    -- 🔴 circuit breaker: نفس الكود «message» مرتين في الدورة (الـEF بتبعت circuit) أو 3 في آخر 30 د = خطأ عام مش ذنب عميل ⇒ إيقاف
    if coalesce(p_result->>'error_class', 'message') = 'message' then
      select count(*) into v_n from wa_ofd_sends x
       where x.tenant_id = s.tenant_id and x.status = 'failed_permanent' and x.error_class = 'message'
         and x.error_code is not distinct from v_code and x.updated_at > v_now - interval '30 minutes';
      if coalesce((p_result->>'circuit')::boolean, false) or v_n >= 3 then
        update wa_auto_templates set paused_at = v_now, paused_reason = 'circuit:' || coalesce(v_code, 'unknown'),
               paused_until = v_now + interval '3 hours'
         where tenant_id = s.tenant_id and event = 'out_for_delivery';
        v_paused := true;
      end if;
    end if;
  elsif v_out = 'unknown' then
    update wa_ofd_sends set status = 'unknown', error_code = coalesce(v_code, 'no_answer'), error_detail = v_det, updated_at = v_now where id = p_id;
  elsif v_out in ('deferred', 'pause', 'release') then
    update wa_ofd_sends set status = 'deferred',
           next_try_at = v_now + case when v_out = 'release' then interval '0' else interval '15 minutes' end,
           attempts = greatest(0, s.attempts - 1),        -- مفيش رسالة اتبعتت ⇒ المحاولة بترجع
           error_code = v_code, error_detail = v_det, updated_at = v_now where id = p_id;
    if v_out = 'pause' then
      update wa_auto_templates set paused_at = v_now, paused_reason = left(coalesce(v_code, '') || ' ' || v_det, 300),
             paused_until = case when v_code = '132015' then v_now + interval '3 hours' end   -- ميتا وقفته مؤقتاً: تجربة بعد 3 س
       where tenant_id = s.tenant_id and event = 'out_for_delivery';
      v_paused := true;
    elsif v_out = 'deferred' and coalesce(p_result->>'run_stop', '') = 'true' then
      -- 🔴 خطأ على مستوى الحساب (توكن 190 · سقف/سبام 131048 · حظر 368 · حساب مقفول 131031 · 401/403…) — مراجعة 10 أكتوبر:
      -- وقف الدورة لوحده كان بيخلّي الدقيقة الجاية تبعت لميتا تاني (≈ نداء فاشل كل دقيقة طول اليوم، والإصرار وقت حظر
      -- السبام بيطوّله). دلوقتي إيقاف مؤقت للمتجر + تجربة واحدة بعده (نفس مسار 132015) · و«sent» بيشيله.
      update wa_auto_templates set paused_at = v_now, paused_reason = left('stop:' || coalesce(v_code, '') || ' ' || v_det, 300),
             paused_until = v_now + case when v_code in ('4', '80007', 'no_wa_config') then interval '15 minutes'   -- سقف نداءات/إعداد
                                         else interval '1 hour' end
       where tenant_id = s.tenant_id and event = 'out_for_delivery';
      v_paused := true;
    end if;
  else
    return jsonb_build_object('ok', false, 'note', 'bad_outcome');
  end if;
  return jsonb_build_object('ok', true, 'note', v_note, 'paused', v_paused);
end $fn$;
revoke all on function public.wa_ofd_mark_v1(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.wa_ofd_mark_v1(bigint, jsonb) to service_role;

-- ── 13) صحة الإرسال للبانر ────────────────────────────────────────────────
-- 🔴 منفصلة عن المرشّحين عن قصد (مفيش كود مشترك): لو المرشّحين نفسهم وقعوا، ده اللي بيقول. وبلوك exception
-- عشان أي خطأ هنا مايوقّعش jt_sync_health كلها (البانرات التانية — درس 51).
-- ⚠️ `exception when others` مابيمسكش query_canceled — الاستعلامات كلها محدودة بفهرس (orders بالمتجر/الحالة · jt_events
-- بـreceived_at أو bill_code).
create or replace function app.wa_ofd_health(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $fn$
declare a wa_auto_templates; loc timestamp := now() at time zone 'Africa/Cairo'; v_open timestamptz; v_close_prev timestamptz;
        v_stale int := 0; v_overdue int := 0; v_unparsed int := 0; v_today int := 0; v_last_ok timestamptz; v_err text; v_err_at timestamptz;
begin
  select * into a from wa_auto_templates where tenant_id = p_tenant and event = 'out_for_delivery';
  if not found or a.mode = 'off' then return jsonb_build_object('mode', coalesce(a.mode, 'off')); end if;
  v_open := (date_trunc('day', loc) + make_interval(hours => a.send_from_hour)) at time zone 'Africa/Cairo';
  v_close_prev := (date_trunc('day', loc) - interval '1 day' + make_interval(hours => a.send_to_hour)) at time zone 'Africa/Cairo';
  select count(*) into v_today from wa_ofd_sends x where x.tenant_id = p_tenant and x.status in ('sent','unknown','sending')
     and x.created_at >= (date_trunc('day', loc) at time zone 'Africa/Cairo');
  if a.paused_at is null and v_today < a.max_per_day
     and extract(hour from loc) >= a.send_from_hour and extract(hour from loc) < a.send_to_hour then
    -- (أ) شحنات خرجت للتسليم (بعد فرز/خروج من الفرع) ورسالتها الأولى عمرها ما اتعملت — بقالها > 15 د
    select count(*) into v_stale from orders o
     where o.tenant_id = p_tenant and o.shipping_carrier = 'jt' and lower(coalesce(o.status, '')) = 'out for delivery'
       and o.carrier_status_code = '94' and o.carrier_status_at >= a.enabled_since
       and (case when o.carrier_status_at >= v_close_prev - interval '1 hour' and o.carrier_status_at < v_open then v_open
                 else o.carrier_status_at end) between now() - make_interval(mins => a.fresh_minutes) and now() - interval '15 minutes'
       and app.ship_rank_p10(o.phone) is not null
       and (a.mode = 'on' or app.wa_id_from_phone(o.phone) = any(a.pilot_wa_ids))
       and exists (select 1 from jt_events e where e.bill_code = o.tracking_no and e.order_id = o.id and e.tenant_id = o.tenant_id
                     and ((e.kind = 'pull' and e.payload->>'scanCode' in ('50', '92'))
                       or (e.kind = 'trace' and (e.payload->'details' @> '[{"scanTypeCode":"50"}]'
                                              or e.payload->'details' @> '[{"scanTypeCode":"92"}]'))))
       and not exists (select 1 from wa_ofd_sends x where x.order_id = o.id);
    -- (ب) retry مستحق بقاله > 10 د ومحدش لمسه · أو sending متعلّق > 15 د (الـtick/الـEF واقفين)
    select count(*) into v_overdue from wa_ofd_sends x where x.tenant_id = p_tenant and (
        (x.status in ('failed_transient', 'deferred') and x.next_try_at < now() - interval '10 minutes')
     or (x.status = 'sending' and x.claimed_at < now() - interval '15 minutes'));
  end if;
  -- (ج) J&T غيّرت شكل الـdesc؟ 94 ذهاب آخر 24 س من غير رقم مندوب مفهوم
  select count(distinct e.bill_code) into v_unparsed from jt_events e
   where e.tenant_id = p_tenant and e.received_at > now() - interval '24 hours' and e.digest_ok
     and ((e.kind = 'pull' and e.payload->>'scanCode' = '94' and coalesce(e.payload->>'desc', '') !~ 'courier [^(]*\(0[0-9]{10}\)')
       or (e.kind = 'trace' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
             then e.payload->'details' else '[]'::jsonb end) d
             where d->>'scanTypeCode' = '94' and coalesce(d->>'isRefund', '') <> '1'
               and coalesce(d->>'desc', '') !~ 'courier [^(]*\(0[0-9]{10}\)')));
  select max(r.ran_at) into v_last_ok from wa_ofd_runs r where r.ok and p_tenant = any(r.tenant_ids);
  select r.error, r.ran_at into v_err, v_err_at from wa_ofd_runs r
   where not r.ok and (p_tenant = any(r.tenant_ids) or r.tenant_ids = '{}') order by r.ran_at desc limit 1;
  return jsonb_build_object('mode', a.mode, 'enabled_since', a.enabled_since,
    'paused', case when a.paused_at is not null then app.wa_ofd_mask(a.paused_reason) end,
    'paused_until', a.paused_until, 'sent_today', v_today, 'max_per_day', a.max_per_day, 'cap_hit', v_today >= a.max_per_day,
    'stale', v_stale, 'overdue', v_overdue, 'unparsed_24h', v_unparsed,
    'last_ok', v_last_ok, 'last_error', v_err, 'last_error_at', v_err_at);
exception when others then
  return jsonb_build_object('health_error', sqlstate);
end $fn$;
revoke all on function app.wa_ofd_health(uuid) from public, anon, authenticated;

-- ── 14) jt_sync_health (البانر): من الجسم الحي بالحرف (md5 e3bed69681c9efa71f13a87bd0e3bf01 = مرآة
--     20261010120000_ship_rank_review_fixes §5) + مفتاح `ofd` في الآخر ─────────────────────────────
create or replace function public.jt_sync_health()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'app'
as $function$
  select case when not public.is_tenant_admin() then null else jsonb_build_object(
    'enabled', exists (select 1 from tenants t where t.id = app.current_tenant_id() and t.shipping_provider = 'jt'),
    'now', now(),
    'trace_last_ok', (select max(ran_at) from jt_sync_runs where job = 'trace_sync' and ok),
    'trace_last_run', (select max(ran_at) from jt_sync_runs where job = 'trace_sync'),
    'trace_last_error', (select error from jt_sync_runs where job = 'trace_sync' and not ok order by ran_at desc limit 1),
    'fee_stuck', (select coalesce(jsonb_agg(o.order_uid order by o.status_changed_at), '[]'::jsonb) from orders o
       where o.tenant_id = app.current_tenant_id() and o.shipping_carrier = 'jt' and o.status = 'Delivered'
         and not coalesce(o.jt_fee_final, false) and o.status_changed_at < now() - interval '24 hours'),
    'unmapped_48h', (select count(*) from jt_events e where e.apply_note = 'unmapped'
       and e.received_at > now() - interval '48 hours' and (e.tenant_id is null or e.tenant_id = app.current_tenant_id())),
    -- المرتجع والملغي مالهمش تحصيل — الاختلاف هناك مالوش أثر على الفلوس
    'cod_mismatch', (select coalesce(jsonb_agg(jsonb_build_object('uid', o.order_uid, 'total', o.total_cost,
         'jt', o.jt_cod_amount, 'status', o.status) order by o.created_at desc), '[]'::jsonb) from orders o
       where o.tenant_id = app.current_tenant_id() and o.shipping_carrier = 'jt' and o.jt_cod_amount is not null
         and o.jt_cod_amount <> o.total_cost
         and o.status not in ('cancelled', 'Returned to business', 'returned', 'Returned to business2')),
    -- (10 أكتوبر) نسبة استلام العميل من شركة الشحن: أوردرات رقمها سليم وماتسألتش بقالها > 15 دقيقة (الطبيعي ≤ 3)
    'rank_enabled', exists (select 1 from vault.secrets s where s.name = 'bosta_rank_key:' || app.current_tenant_id()::text),
    'rank_stale', (select count(*) from orders o where o.tenant_id = app.current_tenant_id() and o.ship_rank_at is null
       and o.created_at >= now() - interval '72 hours' and o.created_at < now() - interval '15 minutes'
       and app.ship_rank_p10(o.phone) is not null),
    'rank_last_ok', (select max(ran_at) from ship_rank_runs where ok),
    'rank_last_error', (select error from ship_rank_runs r where not r.ok
       and r.ran_at > coalesce((select max(ran_at) from ship_rank_runs where ok), '-infinity') order by r.ran_at desc limit 1),
    -- و EasyOrders: أوردرات جت من الويبهوك من غير تقييم وعمر السحب ماحاولها بقالها > 15 دقيقة (الطبيعي ≤ 3)
    'eo_stale', (select count(*) from orders o where o.tenant_id = app.current_tenant_id() and o.eo_metadata is not null
       and o.eo_rate is null and o.created_at >= now() - interval '24 hours' and o.created_at < now() - interval '15 minutes'
       and not exists (select 1 from eo_rate_checks c where c.order_id = o.id))
    ,
    -- (11 أكتوبر) رسايل «المندوب في الطريق» — دالة لوحدها ببلوك exception (لو وقعت مابتوقّعش باقي البانر)
    'ofd', app.wa_ofd_health(app.current_tenant_id())
  ) end;
$function$;
revoke all on function public.jt_sync_health() from public, anon;
grant execute on function public.jt_sync_health() to authenticated, service_role;

-- ── 15) اللي الـcron بينده (الجدولة في migration تاني) ─────────────────────
-- كل دقيقة: التنضيف دايماً (رخيص) · ونداء الـEF بس لو فيه مرشّحين — بره 9–21 / off / متوقف / السقف = مفيش نداء
create or replace function app.wa_ofd_tick() returns void
language plpgsql security definer set search_path = public, app, pg_temp as $fn$
begin
  begin perform public.wa_ofd_housekeep_v1();
  exception when others then raise warning 'wa_ofd housekeep: %', sqlstate; end;
  if exists (select 1 from public.wa_ofd_candidates_v1(1, null, false)) then
    perform net.http_post(
      url := 'https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/wa-ofd-notify',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-diag-token', (select value from public.platform_settings where key = 'jt_diag_token')),
      timeout_milliseconds := 60000);
  end if;
end $fn$;
revoke all on function app.wa_ofd_tick() from public, anon, authenticated;

notify pgrst, 'reload schema';
