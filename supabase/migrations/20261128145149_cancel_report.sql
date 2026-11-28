-- cancel_report — تقرير الإلغاء (v90 · 28 نوفمبر 2026 — طلب المالك)
--
-- «قايمة أسباب ثابتة في Sahl بدل الكتابة الحرة» + علامة «إلغاء مبكر» بدل قفل زرار الإلغاء.
--
-- 🔴 قراية بس: مفيش عمود جديد · مفيش تريجر · `set_order_status` و`append_call_attempt` ماتلمسوش.
--    الواجهة (v90) بتبعت السبب نص ثابت من القايمة في نفس `p_cancel_reason` القديم (+ « — ملاحظة»)،
--    والتصنيف والعلامة بيتحسبوا هنا وقت القراية — فالواجهة القديمة (نص حر) شغّالة زي ما هي = «نص حر».
--
-- القايمة في مكانين لازم يفضلوا متطابقين بالحرف:
--   هنا (`app.cancel_reason_code`) · `app/js/orders/cancel-reason.js` (`CANCEL_REASONS`)
--   — `tools/test-cancel-reason.mjs` بيقارنهم.
--
-- علامة «إلغاء مبكر» (للإلغاءات من `app.cancel_flags_since()` وطالع بس · اللي لغاه أدمن مابيتعلّمش):
--   few_calls  = السبب «مش بيرد» ومتسجّل أقل من 3 محاولات اتصال أو كلهم في يوم واحد.
--   no_contact = أوردر عمره ما اتأكد · اتلغى في أول 24 ساعة · صفر محاولة اتصال متسجّلة ·
--                والعميل ماكتبش حاجة في الواتساب بين الأوردر والإلغاء.
--                (مش على: مكرر · وهمي · الرقم غلط · إلغاء العميل من زرار الواتساب · الإلغاء الجماعي)
--
-- الرجوع: drop function public.cancel_report(integer);  — الباقي دوال مساعدة مالهاش أثر.

create or replace function app.cancel_flags_since()
returns timestamptz language sql immutable
as $fn$ select timestamptz '2026-11-28 15:00:00+00' $fn$;

create or replace function app.try_timestamptz(p text)
returns timestamptz language plpgsql stable
as $fn$
begin
  return p::timestamptz;
exception when others then
  return null;
end
$fn$;

create or replace function app.cancel_reason_code(p text)
returns text language sql immutable
as $fn$
  select case
    when p is null or btrim(p) = '' then 'none'
    when btrim(p) = 'إلغاء من العميل عبر واتساب' then 'wa_customer'
    when btrim(p) = 'إلغاء من المدير' then 'admin_bulk'
    when btrim(p) like 'العميل مش بيرد أو التليفون مقفول%' then 'no_answer'
    when btrim(p) like 'الرقم غلط%' then 'wrong_number'
    when btrim(p) like 'العميل غيّر رأيه%' then 'changed_mind'
    when btrim(p) like 'السعر غالي أو عايز خصم%' then 'price'
    when btrim(p) like 'المقاس مش مناسب%' then 'size'
    when btrim(p) like 'عايز موديل تاني مش متوفر%' then 'other_model'
    when btrim(p) like 'فاكر المنتج حاجة تانية%' then 'expectation'
    when btrim(p) like 'أوردر مكرر%' then 'duplicate'
    when btrim(p) like 'أوردر وهمي%' then 'fake'
    when btrim(p) like 'مشكلة عنوان أو استلام%' then 'address'
    when btrim(p) like 'رفض الديبوزت%' then 'deposit'
    when btrim(p) like 'سبب تاني%' then 'other'
    else 'free_text' end
$fn$;

create or replace function public.cancel_report(p_weeks integer default 4)
returns jsonb
language sql stable security definer
set search_path to 'public', 'app', 'pg_temp'
as $fn$
with me as (
  select public.current_tenant_id() as tid, public.is_tenant_admin() as adm
), wk as (
  select n, today, (today - ((extract(dow from today)::int + 1) % 7))::date as w0
  from (select greatest(1, least(coalesce(p_weeks, 4), 12)) as n,
               (now() at time zone 'Africa/Cairo')::date as today) p
), o as (
  select x.id, x.order_uid, x.product_name, x.cancel_reason, x.status_log, x.call_attempts, x.created_at, x.phone,
         coalesce(x.status_changed_at, x.updated_at, x.created_at) as cancel_at
  from orders x, me, wk
  where me.adm and x.tenant_id = me.tid and x.status = 'cancelled'
    and coalesce(x.status_changed_at, x.updated_at, x.created_at)
        >= ((wk.w0 - (wk.n - 1) * 7)::timestamp at time zone 'Africa/Cairo')
), d as (
  select o.id, o.order_uid, o.cancel_reason, o.created_at, o.cancel_at,
    (o.cancel_at at time zone 'Africa/Cairo')::date as cday,
    app.cancel_reason_code(o.cancel_reason) as code,
    coalesce(nullif(btrim(regexp_replace(split_part(coalesce(o.product_name, ''), E'\n', 1), '\s*\(عدد\s*\d+\)\s*', '', 'g')), ''), '—') as product,
    coalesce((select e ->> 'by'
                from jsonb_array_elements(case when jsonb_typeof(o.status_log) = 'array' then o.status_log else '[]'::jsonb end)
                     with ordinality as t(e, i)
               where jsonb_typeof(e) = 'object' and e ->> 'to' = 'cancelled'
               order by i desc limit 1), '') as by_who,
    (coalesce(o.status_log::text, '') like '%confirmed%') as was_confirmed,
    ca.calls, ca.call_days,
    exists (select 1 from wa_conversations c join wa_messages m on m.conversation_id = c.id, me
             where c.tenant_id = me.tid and c.wa_id = app.wa_id_from_phone(o.phone)
               and m.direction = 'in' and m.type not in ('button', 'reaction', 'sticker', 'unsupported')
               and m.created_at >= o.created_at and m.created_at <= o.cancel_at) as wa_contact
  from o
  cross join lateral (
    select count(*)::int as calls,
           count(distinct ((t.ts at time zone 'Africa/Cairo')::date))::int as call_days
    from (select app.try_timestamptz(c ->> 'iso') as ts
            from jsonb_array_elements(case when jsonb_typeof(o.call_attempts) = 'array' then o.call_attempts else '[]'::jsonb end) c) t
    where t.ts is null or t.ts <= o.cancel_at + interval '2 minutes'
  ) ca
), f as (
  select d.*,
    (d.cday - ((extract(dow from d.cday)::int + 1) % 7))::date as w,
    case
      when d.cancel_at < app.cancel_flags_since() then null
      when exists (select 1 from user_profiles up, me where up.tenant_id = me.tid and up.role = 'admin'
                    and (d.by_who = up.full_name or d.by_who = up.full_name || ' (جماعي)')) then null
      when d.code = 'no_answer' and (d.calls < 3 or d.call_days < 2) then 'few_calls'
      when d.code in ('changed_mind', 'price', 'size', 'other_model', 'expectation', 'address', 'deposit', 'other')
           and not d.was_confirmed and d.cancel_at - d.created_at < interval '24 hours'
           and d.calls = 0 and not d.wa_contact then 'no_contact'
    end as flag
  from d
)
select case when not coalesce((select adm from me), false) then null else jsonb_build_object(
  'ok', true,
  'since', app.cancel_flags_since(),
  'weeks', (select jsonb_agg(jsonb_build_object('start', ws, 'end', ws + 6) order by ws)
              from (select (wk.w0 - g * 7)::date as ws from wk, generate_series(0, (select n from wk) - 1) g) q),
  'rows', coalesce((select jsonb_agg(jsonb_build_object('w', w, 'product', product, 'code', code, 'n', n, 'early', early) order by w, product, code)
                      from (select w, product, code, count(*)::int as n, count(flag)::int as early from f group by 1, 2, 3) a), '[]'::jsonb),
  'by', coalesce((select jsonb_agg(jsonb_build_object('by', by_who, 'n', n, 'early', early) order by n desc)
                    from (select case when code = 'wa_customer' then 'العميل (زرار الواتساب)' when by_who = '' then '—' else by_who end as by_who,
                                 count(*)::int as n, count(flag)::int as early from f group by 1) b), '[]'::jsonb),
  'early', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'uid', order_uid, 'product', product, 'code', code, 'reason', left(coalesce(cancel_reason, ''), 200),
                                                         'by', by_who, 'at', cancel_at, 'calls', calls, 'days', call_days, 'flag', flag) order by cancel_at desc)
                       from (select * from f where flag is not null order by cancel_at desc limit 200) e), '[]'::jsonb),
  'notes', coalesce((select jsonb_agg(jsonb_build_object('uid', order_uid, 'w', w, 'product', product, 'code', code, 'text', left(coalesce(cancel_reason, ''), 200),
                                                         'by', by_who, 'at', cancel_at) order by cancel_at desc)
                       from (select * from f where code in ('other', 'free_text') order by cancel_at desc limit 80) t), '[]'::jsonb)
) end
$fn$;

revoke all on function public.cancel_report(integer) from public, anon;
grant execute on function public.cancel_report(integer) to authenticated, service_role;
revoke all on function app.cancel_reason_code(text) from public, anon;
revoke all on function app.try_timestamptz(text) from public, anon;
revoke all on function app.cancel_flags_since() from public, anon;

comment on function public.cancel_report(integer) is
  'تقرير الإلغاء للأدمن (v90): الإلغاءات حسب السبب والمنتج والأسبوع (السبت–الجمعة · القاهرة) + «إلغاء مبكر». قراية بس.';
