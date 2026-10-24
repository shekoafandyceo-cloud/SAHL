-- wa_ofd_daily_reminder (11 أكتوبر مساءً — قرار المالك بعد مراجعة الخطة)
--
-- «يبعت طبعاً عادي كتذكير للعميل ان في اوردر و دا هو المندوب» — الشحنة اللي خرجت تاني في يوم جديد مع **نفس المندوب**
-- (بعد تأجيل · مابيردش · محاولة فاشلة) بقت تاخد رسالة. القاعدة (14) قبل كده: «نفس المندوب = مفيش» مهما كان اليوم.
-- اتقاس (14 يوم): ~8–13 شحنة/يوم بتخرج تاني مع نفس المندوب في يوم جديد، و111 من 119 منهم كان عليهم استثناء قبلها —
-- يعني بالظبط العميل اللي الرسالة معمولة عشانه.
--
-- القاعدة الجديدة (في المرشّحين والحجز بالحرف): نفس المندوب **ونفس يوم القاهرة** لآخر رسالة = مفيش.
--   • اليوم = يوم **خروج الرسالة لميتا** (sent_at ← dispatched_at ← created_at) مش يوم المسح ولا أول حجز: مسح 10 بالليل بيتبعت
--     9 الصبح اللي بعده (ولو المندوب مسح تاني الصبح مايتبعتش رسالتين نفس الصبح) · retry اتحجز امبارح 20:58 وخرج النهارده 9:00
--     بـunknown (مالوش sent_at) = النهارده — من غير dispatched_at كان هيبان امبارح وتطلع رسالة تانية نفس الصبح (المراجعة — اتجرّبت).
--   • مندوب مختلف = رسالة زي ما كان (حتى في نفس اليوم) · السقف 3 للأوردر زي ما هو (قرار المالك 10 أكتوبر).
--   • 🔴 التذكير (نفس المندوب) مابياخدش **آخر خانة** في السقف — محجوزة لتغيير المندوب. من غيرها: A · A (تذكير) · A (تذكير) = 3
--     والمندوب B بعدها مالوش رسالة = العميل معاه رقم قديم (المراجعة: 11 أوردر في 20 يوم كانوا هيخسروا رسالة تغيير المندوب).
--     بالسقف 3: التذكير بيبقى الرسالة 2 بالكتير، والخانة 3 لتغيير المندوب. رفع السقف (max_per_order ≤ 5) = تذكيرات أكتر.
--   • اللي اتبعت قبل كده مابيتعادش: الرسالة بتطلع على مسح 94 **جديد** بس (الصف الموجود لنفس المسح = القاعدة 16).
--
-- create or replace بنفس التوقيع (مفيش DROP — درس 53). الجسمين = 20261011100000_wa_ofd_notify.sql (md5 الحي اتطابق
-- قبل التعديل: 6e175536… / 641b106a…) + التعديل ده بس. اتجرّب بترانزاكشن راجعة على الحي مرتين (7 حالات + ضابطين — الشبكة 0).

set local lock_timeout = '4s';

-- ── المرشّحين ──
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
         coalesce(s.n_sent, 0) as n_sent, s.last_phone, s.last_day, coalesce(s.dead, false) as dead,
         r.id as row_id, r.status as row_status, r.attempts as row_attempts, r.next_try_at as row_next
  from g
  left join lateral (
    select count(*) filter (where x.status in ('sent', 'unknown', 'sending')) as n_sent,
           (array_agg(x.courier_phone order by x.scan_at desc) filter (where x.status in ('sent', 'unknown', 'sending')))[1] as last_phone,
           -- يوم آخر رسالة بتوقيت القاهرة = يوم خروجها لميتا (sent_at ← dispatched_at ← created_at) مش يوم المسح ولا أول حجز:
           -- مسح 10 بالليل بيتبعت 9 الصبح اللي بعده · retry اتعمل امبارح وخرج النهارده بـunknown (مالوش sent_at) = النهارده
           (array_agg((coalesce(x.sent_at, x.dispatched_at, x.created_at) at time zone 'Africa/Cairo')::date order by x.scan_at desc)
              filter (where x.status in ('sent', 'unknown', 'sending')))[1] as last_day,
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
  -- (14) نفس المندوب في نفس اليوم = مفيش · يوم تاني (خروج تاني بعد تأجيل/مابيردش) = تذكير — قرار المالك 11 أكتوبر ·
  --      و🔴 التذكير مابياخدش آخر خانة في السقف: محجوزة لتغيير المندوب (من غيرها العميل يفضل معاه رقم مندوب قديم — المراجعة)
  and not (h.last_phone is not distinct from h.c_phone
           and (h.last_day = (h.now_ at time zone 'Africa/Cairo')::date or h.n_sent >= h.max_per_order - 1))
  and not h.dead                                                                  -- (15)
  and (h.row_id is null                                                           -- (16) جديد أو retry مستحق
       or (h.row_status = 'failed_transient' and h.row_attempts < 3 and h.row_next <= h.now_)
       or (h.row_status = 'deferred' and h.row_next <= h.now_))
order by h.due, h.t
limit greatest(1, least(coalesce(p_limit, 8), 20));
$fn$;
revoke all on function public.wa_ofd_candidates_v1(int, text[], boolean) from public, anon, authenticated;
grant execute on function public.wa_ofd_candidates_v1(int, text[], boolean) to service_role;

-- ── الحجز ──
create or replace function public.wa_ofd_claim_v1(p_limit int default 8, p_uids text[] default null)
returns table (id bigint, attempt int, order_id uuid, tenant_id uuid, order_uid text, tracking_no text, customer_name text,
               wa_id text, scan_at timestamptz, courier_name text, courier_phone text, send_no int, send_until timestamptz,
               probing boolean, template_name text, lang text, body text, param_count int, store_phone text, claimed_at timestamptz)
language plpgsql security definer set search_path = public, app, pg_temp as $fn$
#variable_conflict use_column
declare c record; v_id bigint; v_att int; v_n int; v_last text; v_now timestamptz := app.wa_ofd_now(); v_probed uuid[] := '{}';
        v_day int; v_cap int; v_last_day date; v_max_order int;
begin
  perform public.wa_ofd_housekeep_v1();
  for c in select * from public.wa_ofd_candidates_v1(least(greatest(coalesce(p_limit, 8), 1), 8), p_uids, false) loop
    if c.probing and c.tenant_id = any(v_probed) then continue; end if;   -- متجر متوقف بيتجرّب برسالة واحدة بس
    begin
      -- 🔴 السقف اليومي لكل صف (مراجعة 10 أكتوبر): المرشّحين بيفحصوه مرة للدفعة كلها — 149/150 + 8 مستحقين كان = 157.
      -- قفل المتجر **قبل** قفل الأوردر (نفس الترتيب في كل تشغيل = مفيش deadlock) · والعدّ بعد القفل = تشغيلين متداخلين مايعدّوش السقف
      perform pg_advisory_xact_lock(hashtextextended('wa_ofd_cap:' || c.tenant_id::text, 0));
      select a.max_per_day, a.max_per_order into v_cap, v_max_order from wa_auto_templates a
       where a.tenant_id = c.tenant_id and a.event = 'out_for_delivery';
      select count(*) into v_day from wa_ofd_sends x where x.tenant_id = c.tenant_id and x.status in ('sent', 'unknown', 'sending')
         and x.created_at >= (date_trunc('day', v_now at time zone 'Africa/Cairo') at time zone 'Africa/Cairo');
      if v_day >= coalesce(v_cap, 0) then continue; end if;
      perform pg_advisory_xact_lock(hashtextextended('wa_ofd:' || c.order_id::text, 0));
      select count(*) filter (where x.status in ('sent','unknown','sending')),
             (array_agg(x.courier_phone order by x.scan_at desc) filter (where x.status in ('sent','unknown','sending')))[1],
             (array_agg((coalesce(x.sent_at, x.dispatched_at, x.created_at) at time zone 'Africa/Cairo')::date order by x.scan_at desc)
                filter (where x.status in ('sent','unknown','sending')))[1]
        into v_n, v_last, v_last_day from wa_ofd_sends x where x.order_id = c.order_id;
      -- (14) زي المرشّحين بالحرف: نفس المندوب ونفس يوم القاهرة = مفيش · يوم تاني = تذكير (إلا آخر خانة — لتغيير المندوب)
      if coalesce(v_n, 0) + 1 <> c.send_no
         or (v_last is not distinct from c.courier_phone
             and (v_last_day = (v_now at time zone 'Africa/Cairo')::date or coalesce(v_n, 0) >= coalesce(v_max_order, 3) - 1)) then
        continue;
      end if;

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

notify pgrst, 'reload schema';
