-- ship_rank_pull (10 أكتوبر) — «نسبة استلام العميل من شركة الشحن» من بوسطة **من غير أي شحنة** (طلب المالك).
--
-- المالك اقترح أوردر وهمي على أكونت بوسطة قديم عشان ناخد النسبة بس. البحث (Workflow — قراية بس) لقى إن بوسطة
-- عندها lookup بالتليفون: `POST https://app.bosta.co/api/v2/consignee/ranking` بـ`{"phoneNumbers":["+20…"]}`
-- (من كود البلجن الرسمي bosta-woocommerce v4.5.7 — بيتنادى لحظة الـcheckout قبل أي شحنة، ولوحة التجار بتناديه
-- في فورم الإنشاء). مش في الـOpenAPI العام = ممكن يتغيّر من غير إشعار.
-- اتقاس 10 أكتوبر بمفتاح الأكونت القديم (`pg_net` — المفتاح مابيظهرش في أي لوج):
--   • 3 عملا شحنوا مع بوسطة قبل كده → 200 · `deliverySuccessRate` + `deliveredDeliveriesCount` + `returnedDeliveriesCount`
--     = المتسجّل عندنا في سبتمبر بعد شحنات أحدث (17147 100→100 · 17136 2/3→3/6 · 16969 1/22→1/24).
--   • 100 رقم في نداء = `400 errorCode 777 «phoneNumbers must contain less than or equal to 50 items»` → السقف 50.
--   • 50 رقم من الأسبوع اللي فات → 45 رجعوا · **الرقم اللي بوسطة ماتعرفوش مابيرجعش خالص** (مش صف بأصفار).
--   • النسبة = اتسلم ÷ (اتسلم + رجع) على شبكة بوسطة كلها (مش تجارنا بس) — مقرّبة لـ4 أرقام عشرية.
--
-- الشكل (نفس عيلة eo-rate-sync — درس 51: سحب + دليل حياة):
--   • المفتاح في الـVault باسم `bosta_rank_key:<tenant_id>` — ship_rank_keys_v1 (service بس).
--   • أعمدة جديدة على orders (مش customer_ranking: ده بيكتبه «Mora2eb Bosta» في n8n لسه — كان هيمسح قيمتنا بـNULL):
--       ship_rank / ship_rank_n        = نسبة الرقم الأساسي % / عدد شحناته المحسومة عند بوسطة (0 = عميل جديد عندهم)
--       ship_rank_alt / ship_rank_alt_n = نفس الحاجة للرقم الإضافي (NULL لو مالوش رقم إضافي صالح)
--       ship_rank_at                    = إمتى اتسأل (NULL = لسه)
--       ship_rank_raw                   = اللي رجع {at, primary:{phone10, found, delivered, returned, rate}, alt:…}
--   • ship_rank_candidates_v1: أوردرات آخر 24 ساعة اللي ماتسألتش — أو اتسألت والتليفون اتعدّل بعدها (phone10 في الخام
--     ≠ الحالي) — أو أوردرات بعينها بالـorder_uid (ملء القديم/اختبار). التطبيع في SQL بس (app.ship_rank_p10).
--   • ship_rank_apply_v1(p_items): دفعة واحدة. التليفون اتغيّر من ساعة ما اتسأل = مفيش كتابة (الدورة الجاية تسأل تاني).
--   • ship_rank_runs: سجل كل تشغيل (14 يوم).
-- 🔴 النداء لبوسطة بيبعت **رقم التليفون بس** (من غير اسم ولا عنوان ولا مبلغ) — بموافقة المالك 10 أكتوبر.
-- ⚠️ الأعمدة مش محصّنة من الكونسول (orders ممنوح على مستوى الجدول) — معلومة عرض مش محاسبة، زي eo_metadata.
-- 🔴 مفيش أي أمر حذف (درس 53).

set local lock_timeout = '4s';

alter table public.orders
  add column if not exists ship_rank       numeric,
  add column if not exists ship_rank_n     int,
  add column if not exists ship_rank_alt   numeric,
  add column if not exists ship_rank_alt_n int,
  add column if not exists ship_rank_at    timestamptz,
  add column if not exists ship_rank_raw   jsonb;
comment on column public.orders.ship_rank is
  'نسبة استلام العميل عند شركة الشحن (بوسطة /consignee/ranking — شبكتهم كلها): اتسلم ÷ (اتسلم + رجع) %. NULL = مالوش شحنات محسومة عندهم أو لسه ماتسألش (ship_rank_at).';
comment on column public.orders.ship_rank_n is 'عدد شحنات الرقم الأساسي المحسومة عند شركة الشحن (اتسلم + رجع). 0 = عميل جديد عندهم.';
comment on column public.orders.ship_rank_at is 'إمتى اتسأل عن الرقم عند شركة الشحن (ship-rank-sync). NULL = لسه.';
comment on column public.orders.ship_rank_raw is 'رد شركة الشحن المختصر لكل رقم: {at, primary:{phone10, found, delivered, returned, rate}, alt}.';

-- ── 1) المفتاح لكل متجر من الـVault ───────────────────────────────────────
create or replace function public.ship_rank_keys_v1()
returns table(tenant_id uuid, api_key text)
language sql stable security definer set search_path = public, vault
as $$
  select substr(s.name, 16)::uuid, s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name ~ '^bosta_rank_key:[0-9a-f-]{36}$';
$$;
revoke all on function public.ship_rank_keys_v1() from public, anon, authenticated;
grant execute on function public.ship_rank_keys_v1() to service_role;

-- ── 2) تطبيع الرقم: آخر 10 أرقام بعد تحويل الهندي/الفارسي — موبايل مصري بس (1xxxxxxxxx) ──
create or replace function app.ship_rank_p10(p text)
returns text language sql immutable set search_path = pg_catalog
as $$
  select case when x ~ '^1[0-9]{9}$' then x end
  from (select right(regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
                                    '[^0-9]', '', 'g'), 10) as x) s;
$$;

-- ── 3) سجل التشغيل ───────────────────────────────────────────────────────
create table if not exists public.ship_rank_runs (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  ok         boolean not null,
  candidates int not null default 0,
  tally      jsonb not null default '{}'::jsonb,
  error      text
);
alter table public.ship_rank_runs enable row level security;
revoke all on public.ship_rank_runs from anon, authenticated;

-- ── 4) المرشّحين ─────────────────────────────────────────────────────────
-- p_uids = أوردرات بعينها (من غير شرط الوقت — ملء القديم بقرار المالك). من غيرها = آخر 24 ساعة.
create or replace function public.ship_rank_candidates_v1(p_limit int default 25, p_uids text[] default null)
returns table(order_id uuid, tenant_id uuid, order_uid text, p10 text, alt10 text)
language sql stable security definer set search_path = public, app, vault
as $$
  select o.id, o.tenant_id, o.order_uid, app.ship_rank_p10(o.phone), app.ship_rank_p10(o.alt_phone)
  from public.orders o
  where o.tenant_id in (select substr(s.name, 16)::uuid from vault.secrets s where s.name ~ '^bosta_rank_key:[0-9a-f-]{36}$')
    and app.ship_rank_p10(o.phone) is not null
    and (case when p_uids is not null then o.order_uid = any(p_uids)
              else o.created_at >= now() - interval '24 hours'
                   and (o.ship_rank_at is null
                        or (o.ship_rank_at < now() - interval '2 minutes'
                            and (coalesce(o.ship_rank_raw #>> '{primary,phone10}', '') <> app.ship_rank_p10(o.phone)
                                 or coalesce(o.ship_rank_raw #>> '{alt,phone10}', '') <> coalesce(app.ship_rank_p10(o.alt_phone), ''))))
         end)
  order by o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 25));
$$;
revoke all on function public.ship_rank_candidates_v1(int, text[]) from public, anon, authenticated;
grant execute on function public.ship_rank_candidates_v1(int, text[]) to service_role;

-- ── 5) التطبيق — دفعة واحدة ───────────────────────────────────────────────
-- p_items = [{order_id, p10, alt10, primary: <صف بوسطة أو null>, alt: <صف أو null>}]
-- null = بوسطة ماتعرفش الرقم ده (الرد بيحذفه خالص) → عميل جديد عندهم (n = 0). الدالة دي بتتنادى بعد رد 200 بس.
create or replace function app.ship_rank_part(p_phone10 text, p_row jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog
as $$
declare d int := 0; r int := 0; rate numeric;
begin
  if p_phone10 is null then return null; end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('phone10', p_phone10, 'found', false, 'delivered', 0, 'returned', 0, 'rate', null);
  end if;
  if jsonb_typeof(p_row -> 'deliveredDeliveriesCount') = 'number' then d := greatest(0, floor((p_row ->> 'deliveredDeliveriesCount')::numeric))::int; end if;
  if jsonb_typeof(p_row -> 'returnedDeliveriesCount') = 'number' then r := greatest(0, floor((p_row ->> 'returnedDeliveriesCount')::numeric))::int; end if;
  -- النسبة من العدّ نفسه (نفس معادلتهم — اتقاست على 48 صف) — والـ`deliverySuccessRate` بتاعهم بيتحفظ جنبها في الخام
  rate := case when d + r > 0 then round(100.0 * d / (d + r), 2) end;
  return jsonb_build_object('phone10', p_phone10, 'found', true, 'delivered', d, 'returned', r, 'rate', rate,
                            'bosta_rate', case when jsonb_typeof(p_row -> 'deliverySuccessRate') = 'number' then p_row -> 'deliverySuccessRate' end);
end $$;

create or replace function public.ship_rank_apply_v1(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public, app
as $$
declare it jsonb; v_id uuid; v_p10 text; v_alt10 text; c_p10 text; c_alt10 text; pr jsonb; al jsonb;
        tally jsonb := '{}'::jsonb; note text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('ok', false, 'note', 'bad_items'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_id := (it ->> 'order_id')::uuid;
      v_p10 := nullif(it ->> 'p10', '');
      v_alt10 := nullif(it ->> 'alt10', '');
      select app.ship_rank_p10(o.phone), app.ship_rank_p10(o.alt_phone) into c_p10, c_alt10
        from public.orders o where o.id = v_id for update;
      if not found then note := 'order_not_found';
      elsif c_p10 is distinct from v_p10 or c_alt10 is distinct from v_alt10 then note := 'phone_changed';
      else
        pr := app.ship_rank_part(v_p10, it -> 'primary');
        al := case when v_alt10 is null then null
                   when v_alt10 = v_p10 then pr
                   else app.ship_rank_part(v_alt10, it -> 'alt') end;
        update public.orders
           set ship_rank = (pr ->> 'rate')::numeric,
               ship_rank_n = (pr ->> 'delivered')::int + (pr ->> 'returned')::int,
               ship_rank_alt = (al ->> 'rate')::numeric,
               ship_rank_alt_n = case when al is null then null else (al ->> 'delivered')::int + (al ->> 'returned')::int end,
               ship_rank_at = now(),
               ship_rank_raw = jsonb_build_object('at', now(), 'primary', pr, 'alt', al)
         where id = v_id;
        note := case when (pr ->> 'delivered')::int + (pr ->> 'returned')::int > 0 then 'rated' else 'new_customer' end;
      end if;
    exception when others then
      note := 'apply_error';
      raise warning 'ship_rank_apply_v1: % %', it ->> 'order_id', sqlerrm;
    end;
    tally := jsonb_set(tally, array[note], to_jsonb(coalesce((tally ->> note)::int, 0) + 1));
  end loop;
  return jsonb_build_object('ok', true, 'tally', tally);
end $$;
revoke all on function public.ship_rank_apply_v1(jsonb) from public, anon, authenticated;
grant execute on function public.ship_rank_apply_v1(jsonb) to service_role;
revoke all on function app.ship_rank_part(text, jsonb) from public, anon, authenticated;
revoke all on function app.ship_rank_p10(text) from public, anon, authenticated;
grant execute on function app.ship_rank_p10(text) to service_role;

notify pgrst, 'reload schema';
