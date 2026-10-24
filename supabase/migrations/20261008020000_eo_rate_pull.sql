-- eo_rate_pull (8 أكتوبر) — سحب «نسبة استلام العميل» من EasyOrders بعد الويبهوك.
--
-- 🔴 ليه: EasyOrders بتحسب التقييم وتكتبه على الأوردر عندها بعد ~0.3–0.5ث من إنشائه، والويبهوك
-- بيتبني لحظة الإنشاء — سباق. أول 9 أوردرات بعد خطوة n8n: 8 وصلوا `tracking` بس، والـ`API` رجّع
-- التقييم للعشرة كلهم (`GET /external-apps/orders/short/:short_id` بـApi-Key صلاحية orders:read).
-- اتقاس 8 أكتوبر: 17944 · 17945 · 17946 · 17948 الـupdated_at عندهم = الإنشاء + 0.3–0.46ث، و17948
-- ماحدش فتحه في لوحتهم = الحساب في الخلفية مش لما اللوحة تتفتح.
--
-- الشكل:
--   • المفتاح في الـVault باسم `eo_api_key:<tenant_id>` (مفتاح لكل متجر — central، مش محفور).
--   • eo_rate_candidates_v1: أوردرات EasyOrders (eo_metadata موجود = جت من الويبهوك بعد خطوة n8n)
--     من غير تقييم أو pending، عمرها بين 45ث و24 ساعة، بحد 5 محاولات كل 10 دقايق.
--   • eo_rate_apply_v1: بتدمج الـmetadata اللي رجعت (`القديم || الجديد`) — والتريجر trg_eo_rate_capture
--     بيعيد حساب eo_rate/eo_rate_alt لوحده (BEFORE UPDATE OF eo_metadata). مفيش parsing جديد.
--   • eo_rate_checks: سجل المحاولات **برّه orders** — تسجيل محاولة فاضية على orders كان هيولّع
--     realtime وupdated_at على الفاضي كل 10 دقايق.
--   • eo_sync_runs: سجل كل تشغيل (14 يوم) — دليل حياة (درس 51).
--   • app.eo_rate_of: الأرقام الهندية بتتحوّل قبل المطابقة (70 من 980 alt_phone في 30 يوم بأرقام هندية،
--     والتنضيف القديم كان بيمسحها).
-- 🔴 كل حاجة هنا service_role بس. ومفيش أي أمر حذف (درس 53 — أداة MCP بتعلّق عليه).

set local lock_timeout = '4s';

-- ── 1) مفتاح EasyOrders لكل متجر من الـVault ─────────────────────────────
create or replace function public.eo_api_keys_v1()
returns table(tenant_id uuid, api_key text)
language sql stable security definer set search_path = public, vault
as $$
  select substr(s.name, 12)::uuid, s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name ~ '^eo_api_key:[0-9a-f-]{36}$';
$$;
revoke all on function public.eo_api_keys_v1() from public, anon, authenticated;
grant execute on function public.eo_api_keys_v1() to service_role;

-- ── 2) سجل المحاولات + سجل التشغيل ───────────────────────────────────────
create table if not exists public.eo_rate_checks (
  order_id  uuid primary key,
  checks    int not null default 0,
  last_at   timestamptz not null default now(),
  last_note text
);
alter table public.eo_rate_checks enable row level security;
revoke all on public.eo_rate_checks from anon, authenticated;

create table if not exists public.eo_sync_runs (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  ok         boolean not null,
  candidates int not null default 0,
  tally      jsonb not null default '{}'::jsonb,
  error      text
);
alter table public.eo_sync_runs enable row level security;
revoke all on public.eo_sync_runs from anon, authenticated;

-- ── 3) المرشّحين ─────────────────────────────────────────────────────────
-- الأسماء من vault.secrets (من غير فك تشفير) — الدالة دي بتتنادى كل دقيقتين من الـcron.
create or replace function public.eo_rate_candidates_v1(p_limit int default 30)
returns table(order_id uuid, tenant_id uuid, order_uid text)
language sql stable security definer set search_path = public, vault
as $$
  select o.id, o.tenant_id, o.order_uid
  from public.orders o
  where o.eo_metadata is not null
    and (o.eo_rate is null or o.eo_rate = 'pending')
    and o.created_at <= now() - interval '45 seconds'
    and o.created_at >= now() - interval '24 hours'
    and o.order_uid ~ '^[0-9]+$'
    and o.tenant_id in (select substr(s.name, 12)::uuid from vault.secrets s where s.name ~ '^eo_api_key:[0-9a-f-]{36}$')
    and not exists (select 1 from public.eo_rate_checks c
                    where c.order_id = o.id and (c.checks >= 5 or c.last_at > now() - interval '10 minutes'))
  order by o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 35));
$$;
revoke all on function public.eo_rate_candidates_v1(int) from public, anon, authenticated;
grant execute on function public.eo_rate_candidates_v1(int) to service_role;

-- ── 4) التطبيق ───────────────────────────────────────────────────────────
-- p_meta = metadata زي ما رجعت من EasyOrders (أو NULL = محاولة فشلت وp_note فيه السبب).
-- الدمج `القديم || الجديد`: المفاتيح اللي رجعت بتكسب، وأي مفتاح عندنا مارجعش بيفضل (tracking مثلاً).
create or replace function public.eo_rate_apply_v1(p_order_id uuid, p_meta jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, app
as $$
declare v_old jsonb; v_new jsonb; v_old_rate text; v_old_alt text; v_rate text; v_alt text; v_note text;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    v_note := coalesce(nullif(btrim(p_note), ''), 'no_meta');
  else
    select o.eo_metadata, o.eo_rate, o.eo_rate_alt into v_old, v_old_rate, v_old_alt
      from public.orders o where o.id = p_order_id for update;
    if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
    v_new := (case when jsonb_typeof(v_old) = 'object' then v_old else '{}'::jsonb end) || p_meta;
    if v_new is distinct from v_old then
      update public.orders set eo_metadata = v_new where id = p_order_id;
    end if;
    select o.eo_rate, o.eo_rate_alt into v_rate, v_alt from public.orders o where o.id = p_order_id;
    -- «rated» = التقييم نفسه اتغيّر (مش أي مفتاح في الـmetadata زي tracking)
    v_note := case when v_rate is null then 'no_rating'
                   when v_rate = 'pending' then 'still_pending'
                   when v_rate is distinct from v_old_rate or v_alt is distinct from v_old_alt then 'rated'
                   else 'unchanged' end;
  end if;
  insert into public.eo_rate_checks(order_id, checks, last_at, last_note)
  values (p_order_id, 1, now(), left(v_note, 80))
  on conflict (order_id) do update
    set checks = public.eo_rate_checks.checks + 1, last_at = now(), last_note = excluded.last_note;
  return jsonb_build_object('ok', true, 'note', v_note, 'eo_rate', v_rate, 'eo_rate_alt', v_alt);
end $$;
revoke all on function public.eo_rate_apply_v1(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.eo_rate_apply_v1(uuid, jsonb, text) to service_role;

-- ── 5) app.eo_rate_of: الأرقام الهندية/الفارسي بتتحوّل قبل المطابقة ────────
create or replace function app.eo_rate_of(p_meta jsonb, p_phone text)
 returns text language plpgsql immutable set search_path to 'pg_catalog'
as $function$
declare v jsonb; k text; d text; st text; r text;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' or coalesce(btrim(p_phone), '') = '' then return null; end if;
  v := p_meta -> btrim(p_phone);
  if v is null then
    d := right(regexp_replace(translate(p_phone, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g'), 10);
    if length(d) = 10 then
      for k in select jsonb_object_keys(p_meta) loop
        if right(regexp_replace(translate(k, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g'), 10) = d then
          v := p_meta -> k; exit;
        end if;
      end loop;
    end if;
  end if;
  if v is null or jsonb_typeof(v) <> 'object' then return null; end if;
  st := lower(btrim(coalesce(v ->> 'delivery_rate_status', '')));
  r  := lower(btrim(coalesce(v ->> 'rate_result', '')));
  if st <> 'completed' then return 'pending'; end if;
  if r = '' then return null; end if;
  return left(r, 30);
end $function$;
revoke all on function app.eo_rate_of(jsonb, text) from public, anon, authenticated;
