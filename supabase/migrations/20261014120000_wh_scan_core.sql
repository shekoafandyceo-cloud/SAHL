-- ════════════════════════════════════════════════════════════════════
-- سكانر المخزن — المرحلة A (14 أكتوبر 2026 — طلب المالك)
--
-- «المخزون عندي مش لايف … محتاج كل قطعة بتخرج تتضرب باسكانر».
-- السكانر القديم (n8n scannerpostbase) بيشيل الحروف من الكود
-- (replaceAll(/[^0-9]/g,'')) فبوليصة J&T «JEG…» عمرها ما بتطابق —
-- 740 شحنة J&T ولا واحدة اتخصمت. وصفحة استلام المرتجعات في n8n بتختم
-- stock_returned_at من غير حركة 'in'. يعني المخزون واقف من 10 سبتمبر.
--
-- الشكل: صفحة /warehouse في سهل + سكانر USB (keyboard-wedge) →
--   public.wh_scan(كود) — DEFINER: الأوردر من البوليصة · السطور من
--   product_name على السيرفر (مش من المتصفح) · المنتج من ربط المالك
--   (stock_item_aliases) أو تطابق تام · حركة لكل منتج · مفيش تخمين.
--
-- 🔴 القواعد اللي الملف ده بيلتزم بيها:
--   • مفيش لمس لـ orders.status ولا status_log — الحالة ملك J&T
--     (BOSTA2 كانت هتبعت تلجرام لكل سكان وJ&T بتدوسها بعد ساعات).
--     الكتابة على orders = stock_deducted_at / stock_returned_at بس.
--   • مفيش backfill — الرصيد الافتتاحي = جرد (wh_count_apply go_live).
--   • وضع التجربة (wh_config.enabled=false): كل منطق السكان بيتنفّذ فعلاً
--     وبيترجع بـ exception — النتيجة اللي بتظهر = اللي كان هيحصل بالظبط،
--     وصفر كتابة.
--   • المرتجع بيرجّع نفس سطور الخروج بالظبط (مش parse جديد).
--   • حركات السكان مسموح تودّي الرصيد تحت الصفر (بتتعلّم «ناقص») — الحجز
--     كان هيعدّ مرتين بعد الجرد. الحركات اليدوية لسه ممنوعة تحت الصفر.
--   • مفيش حذف لأي كائن (درس 53) · كل UPDATE فيه WHERE.
-- ════════════════════════════════════════════════════════════════════

set local lock_timeout = '4s';

-- ── 1) دوال مساعدة نقية ──────────────────────────────────────────────

-- مفتاح مقارنة الأسماء: NFKC · أرقام لاتيني · توحيد الهمزات/التاء/الياء ·
-- شيل التشكيل والتطويل وعلامات الاتجاه والأقواس · lower · مسافات مفردة.
create or replace function app.wh_key(t text)
returns text language sql immutable parallel safe
set search_path = pg_catalog
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(
             lower(translate(normalize(coalesce(t, ''), NFKC),
               '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أإآٱةىیکۀ–—'
                 || chr(8206) || chr(8207) || chr(1564) || chr(1600)
                 || chr(8204) || chr(8205) || chr(65279) || '()[]{}',
               '01234567890123456789ااااهييكه--')),
             '[' || chr(1611) || '-' || chr(1618) || ']', '', 'g'),
           '\s+', ' ', 'g')), '')
$$;

-- مفتاح الخاصية: نفس wh_key + «ادوار» = «دور» (التيربو/الاستاند بيتكتبوا الاتنين)
create or replace function app.wh_props_key(t text)
returns text language sql immutable parallel safe
set search_path = pg_catalog, app
as $$
  select nullif(btrim(regexp_replace(replace(coalesce(app.wh_key(t), ''), 'ادوار', 'دور'), '\s+', ' ', 'g')), '')
$$;

-- كود البوليصة من أي نص السكانر كتبه: أرقام عربي/فارسي · كيبورد عربي
-- (J E G = ت ث ل بدون شيفت · ـ ُ لأ بالشيفت) · CapsLock · أي بادئة.
-- 🔴 مفيش حالة بنحط فيها JEG قبل أرقام من عندنا — 12 رقم لوحدهم ممكن
-- يبقوا باركود منتج (UPC-A).
create or replace function app.wh_code(t text)
returns text language sql immutable parallel safe
set search_path = pg_catalog
as $$
  select substring(
           regexp_replace(
             upper(replace(replace(replace(
               translate(normalize(coalesce(t, ''), NFKC), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
               'تثل', 'JEG'), 'ـُلأ', 'JEG'), 'عثل', 'UEG')),
             '[^A-Z0-9]', '', 'g')
           from '([JU]EG[0-9]{12})(?![0-9])')
$$;

-- سطور الأوردر من product_name: نفس قاعدة الواجهة (splitProductSegments) —
-- القسمة بعد علامة الكمية «(عدد N)» بس، مش على « - » (اسم «استاند امريكانا
-- … - جزامة» فيه شرطة). الذيل من غير علامة = لاحقة variant بتتلزق في اللي
-- قبله. مفيش ولا علامة = سطر واحد كميته 1. اتقاس: 787 سطر / 822 قطعة على
-- الـ740 أوردر J&T.
create or replace function app.wh_order_lines(p text)
returns table(line_no int, line_text text, item_key text, qty int)
language plpgsql immutable parallel safe
set search_path = pg_catalog, app
as $$
declare
  v_src  text := translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  c_re   constant text := '(.*?)\(\s*(?:عدد|العدد|qty|quantity)\s*[:：-]?\s*([0-9]+)\s*\)';
  c_lead constant text := '^[\s+–—،,:-]+';
  m      text[];
  v_name text;
  v_tail text;
  v_names text[] := '{}';
  v_qtys  int[]  := '{}';
  n int;
begin
  for m in select regexp_matches(v_src, c_re, 'gi') loop
    v_name := btrim(regexp_replace(regexp_replace(m[1], c_lead, ''), '[\s–—-]+$', ''));
    continue when v_name = '';
    v_names := v_names || v_name;
    v_qtys  := v_qtys  || greatest(1, least(999, m[2]::int));
  end loop;
  n := coalesce(array_length(v_names, 1), 0);
  if n = 0 then
    v_name := btrim(regexp_replace(v_src, c_lead, ''));
    if v_name <> '' then v_names := array[v_name]; v_qtys := array[1]; n := 1; end if;
  else
    v_tail := btrim(regexp_replace(regexp_replace(v_src, c_re, '', 'gi'), c_lead, ''));
    if v_tail <> '' then v_names[n] := v_names[n] || ' - ' || v_tail; end if;
  end if;
  for i in 1..n loop
    line_no := i; line_text := v_names[i]; item_key := app.wh_key(v_names[i]); qty := v_qtys[i];
    continue when item_key is null;
    return next;
  end loop;
end $$;

-- ── 2) الجداول ──────────────────────────────────────────────────────

create table if not exists public.wh_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,          -- false = وضع تجربة (مفيش كتابة)
  baseline_at timestamptz,                         -- لحظة فتح جرد التشغيل
  hold_cancel_requested boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_name text
);

create table if not exists public.wh_scans (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null,
  order_id uuid references public.orders(id) on delete set null,
  tracking_no text,
  raw_code text check (raw_code is null or char_length(raw_code) <= 80),
  dir text check (dir is null or dir in ('out', 'in', 'pull_back', 'undo', 'dismiss')),
  code text not null,
  applied boolean not null default false,
  source text not null default 'scanner' check (source in ('scanner', 'manual', 'admin', 'undo')),
  forced text,
  reason text check (reason is null or char_length(reason) <= 300),
  station text check (station is null or char_length(station) <= 40),
  scanned_by uuid not null,                        -- مش FK: الموظف يتمسح والسجل يفضل
  scanned_by_name text not null,
  result jsonb not null default '{}'::jsonb,
  reverses_scan_id bigint references public.wh_scans(id),
  reversed_at timestamptz,
  reversed_by_name text,
  reversed_by_scan_id bigint,
  created_at timestamptz not null default now(),
  unique (tenant_id, client_id)
);
create index if not exists wh_scans_tenant_created_idx on public.wh_scans (tenant_id, created_at desc);
create index if not exists wh_scans_order_idx on public.wh_scans (order_id, id desc);

create table if not exists public.wh_scan_lines (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scan_id bigint not null references public.wh_scans(id) on delete cascade,
  order_id uuid,
  dir text not null check (dir in ('out', 'in')),
  line_no int not null,
  line_text text not null,
  item_key text not null,
  props_key text not null default '',
  var_key text not null default '',
  qty int not null check (qty between 1 and 999),
  product_id uuid references public.stock_products(id) on delete set null,
  matched_by text check (matched_by is null or matched_by in ('alias', 'alias_item', 'exact', 'child_label', 'unallocated', 'mirror')),
  state text not null check (state in ('posted', 'unmatched', 'ignored', 'void', 'superseded', 'reversed')),
  movement_id uuid,
  qty_after int,
  note text,
  resolved_at timestamptz,
  resolved_by_name text,
  created_at timestamptz not null default now(),
  unique (scan_id, line_no)
);
create index if not exists wh_scan_lines_unmatched_idx on public.wh_scan_lines (tenant_id, item_key) where state = 'unmatched';

create table if not exists public.wh_order_stock (
  order_id uuid primary key references public.orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tracking_no text,
  out_scan_id bigint references public.wh_scans(id),
  out_at timestamptz,
  out_by_name text,
  in_scan_id bigint references public.wh_scans(id),
  in_at timestamptz,
  in_by_name text,
  in_kind text check (in_kind is null or in_kind in ('mirror', 'precount', 'counted', 'leak', 'flag', 'manual')),
  leak_state text check (leak_state is null or leak_state in ('dismissed', 'closed_by_return', 'deducted')),
  leak_note text,
  updated_at timestamptz not null default now()
);
create index if not exists wh_order_stock_tenant_idx on public.wh_order_stock (tenant_id);

create table if not exists public.stock_item_aliases (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_key text not null,
  props_key text not null default '',
  product_id uuid references public.stock_products(id) on delete cascade,
  ignore boolean not null default false,
  sample_text text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, item_key, props_key),
  check (ignore or product_id is not null)
);

create table if not exists public.stock_counts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opened_at timestamptz not null default now(),
  opened_by_name text,
  applied_at timestamptz,
  applied_by_name text,
  go_live boolean not null default false,
  cancelled_at timestamptz,
  note text check (note is null or char_length(note) <= 300)
);
create unique index if not exists stock_counts_one_open on public.stock_counts (tenant_id) where applied_at is null and cancelled_at is null;

create table if not exists public.stock_count_lines (
  count_id bigint not null references public.stock_counts(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.stock_products(id) on delete cascade,
  system_before int not null,
  counted int not null check (counted >= 0),
  delta int not null,
  primary key (count_id, product_id)
);

-- RLS: قراية للمتجر بس · مفيش ولا سياسة كتابة (الكتابة من الدوال DEFINER)
do $rls$
declare t text;
begin
  foreach t in array array['wh_config', 'wh_scans', 'wh_scan_lines', 'wh_order_stock', 'stock_item_aliases', 'stock_counts', 'stock_count_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass and polname = t || '_select_same_tenant') then
      execute format('create policy %I on public.%I for select to authenticated using (tenant_id = app.current_tenant_id())', t || '_select_same_tenant', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $rls$;

insert into public.wh_config (tenant_id, enabled)
select id, false from public.tenants where slug = '3ataba'
on conflict (tenant_id) do nothing;

-- ── 3) أعمدة جديدة على stock_movements (nullable — metadata بس) ────────

alter table public.stock_movements
  add column if not exists scan_id bigint references public.wh_scans(id),
  add column if not exists source text,
  add column if not exists created_by_name text;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_source_check') then
    alter table public.stock_movements add constraint stock_movements_source_check
      check (source is null or source in ('scan_out', 'late_out', 'leak_fix', 'scan_in', 'scan_in_precount',
                                          'pull_back', 'undo', 'repost', 'count', 'adjust'));
  end if;
end $c$;
create index if not exists stock_movements_scan_idx on public.stock_movements (scan_id) where scan_id is not null;
-- 🔴 order_id مايتملاش عن قصد: الـunique indexes النايمة على
-- (tenant, order_id, product_id, movement_type) كانت هتمنع: سحب ثم إعادة
-- شحن · تراجع ثم سكان تاني · خروج ثم مرتجع.

-- ── 4) التريجرات ────────────────────────────────────────────────────

-- التحديث بقى نسبي (current_qty + in - out) — قبل كده كان بيكتب رقم مطلق
-- محسوب من SELECT من غير قفل، فحركتين في نفس اللحظة = واحدة بتضيع.
-- وحركات السكان (scan_id) معفية من حارس السالب.
create or replace function public.update_stock_on_movement()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_product_tenant uuid;
  v_current_qty    int;
  v_new_qty        int;
begin
  select tenant_id, coalesce(current_qty, 0)
    into v_product_tenant, v_current_qty
  from stock_products
  where id = NEW.product_id;
  if v_product_tenant is null then
    raise exception 'product_id % does not exist', NEW.product_id
      using errcode = '23503';
  end if;
  if v_product_tenant <> NEW.tenant_id then
    raise exception 'product_id % belongs to a different tenant', NEW.product_id
      using errcode = '42501';
  end if;
  v_new_qty := v_current_qty + coalesce(NEW.qty_in, 0) - coalesce(NEW.qty_out, 0);
  if v_new_qty < 0 and NEW.scan_id is null then
    raise exception 'لا يمكن خصم % من المخزون — المتاح حالياً: %', NEW.qty_out, v_current_qty
      using errcode = '23514';
  end if;
  update stock_products
     set current_qty = coalesce(current_qty, 0) + coalesce(NEW.qty_in, 0) - coalesce(NEW.qty_out, 0),
         updated_at  = now()
   where id = NEW.product_id and tenant_id = NEW.tenant_id;
  return NEW;
end;
$function$;

-- توجيه حركات السكان للبنت مسؤولية الـRPC (بالسطر الأول بس وبالربط) —
-- التريجر بيفضل شغّال للحركات اليدوية وn8n زي ما هو.
create or replace function public.resolve_variant_movement()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_var text; v_child_id uuid; v_child_name text;
begin
  if NEW.scan_id is not null then return NEW; end if;
  if NEW.product_id is null then return NEW; end if;
  if not exists (select 1 from public.stock_products c where c.parent_id = NEW.product_id) then
    return NEW;
  end if;
  if NEW.tracking_no is null or btrim(NEW.tracking_no) = '' then return NEW; end if;
  select app.norm_variant(o."var") into v_var
    from public.orders o
   where o.tracking_no = NEW.tracking_no and o.tenant_id = NEW.tenant_id
   order by o.created_at desc limit 1;
  if v_var is null then return NEW; end if;
  select c.id, c.name into v_child_id, v_child_name
    from public.stock_products c
   where c.parent_id = NEW.product_id and app.norm_variant(c.variant_label) = v_var
   limit 1;
  if v_child_id is not null then
    NEW.product_id := v_child_id;
    NEW.product_name := v_child_name;
  end if;
  return NEW;
end $function$;

-- الموظف كان بيقدر يدخّل حركة (سياسة phase2 مفتوحة لأي عضو) والتريجر
-- (invoker) مايقدرش يعدّل الكمية تحت RLS = حركة متسجّلة وكمية واقفة في صمت.
-- المودال أصلاً للأدمن بس، وn8n شغّال بـservice_role.
alter policy phase2_stock_movements_insert on public.stock_movements
  with check (is_super_admin() or ((tenant_id = current_tenant_id()) and is_tenant_admin()));

-- ── 5) دوال داخلية (app — مقفولة على الكل، بتتنادى من الـRPCs بس) ──────

-- حل سطر لمنتج: ربط (سطر+خاصية) ← ربط (سطر) ← تطابق تام لصف واحد بس.
-- منتج ليه بنات: البنت من الخاصية (var أو manufacturer_note) وإلا الأب
-- (السلة «غير موزع»). 🔴 صفر fuzzy — الـsubstring كان بيخصم «تيربو بريمو»
-- من بنت «5 دور» و14 من 16 أوردر «4 أدوار» (اتقاس).
create or replace function app.wh_resolve(p_tenant uuid, p_item text, p_props text, p_var text,
  out product_id uuid, out matched_by text, out state text)
language plpgsql stable
set search_path = public, app, pg_temp
as $$
declare
  v_pid uuid; v_ign boolean; v_cnt int; v_child uuid; v_found boolean := false;
begin
  state := 'unmatched';
  if p_item is null or p_item = '' then return; end if;
  if coalesce(p_props, '') <> '' then
    select a.product_id, a.ignore into v_pid, v_ign
      from stock_item_aliases a
     where a.tenant_id = p_tenant and a.item_key = p_item and a.props_key = p_props;
    if found then
      matched_by := 'alias';
      if v_ign then state := 'ignored'; return; end if;
      product_id := v_pid; state := 'posted'; return;
    end if;
  end if;
  select a.product_id, a.ignore into v_pid, v_ign
    from stock_item_aliases a
   where a.tenant_id = p_tenant and a.item_key = p_item and a.props_key = '';
  if found then
    matched_by := 'alias_item';
    if v_ign then state := 'ignored'; return; end if;
  else
    select count(*), min(sp.id::text)::uuid into v_cnt, v_pid
      from stock_products sp
     where sp.tenant_id = p_tenant and coalesce(sp.active, true) and app.wh_key(sp.name) = p_item;
    if v_cnt <> 1 then v_pid := null; matched_by := null; return; end if;
    matched_by := 'exact';
  end if;
  if exists (select 1 from stock_products c where c.parent_id = v_pid and coalesce(c.active, true)) then
    select c.id into v_child
      from stock_products c
     where c.parent_id = v_pid and coalesce(c.active, true)
       and app.wh_props_key(c.variant_label) is not null
       and app.wh_props_key(c.variant_label) in (nullif(p_var, ''), nullif(p_props, ''))
     order by (app.wh_props_key(c.variant_label) = nullif(p_var, '')) desc nulls last, c.id
     limit 1;
    if v_child is not null then product_id := v_child; matched_by := 'child_label';
    else product_id := v_pid; matched_by := 'unallocated'; end if;
  else
    product_id := v_pid;
  end if;
  state := 'posted';
end $$;

-- ملخص الأوردر اللي بيترجع للواجهة — من غير تليفونات.
create or replace function app.wh_order_brief(p_order_id uuid)
returns jsonb language sql stable
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'uid', o.order_uid,
    'first_name', nullif(split_part(btrim(coalesce(o.customer_name, '')), ' ', 1), ''),
    'status', o.status,
    'tracking_no', o.tracking_no,
    'pieces', coalesce((select sum(l.qty) from app.wh_order_lines(o.product_name) l), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('text', l.line_text, 'qty', l.qty) order by l.line_no)
                         from app.wh_order_lines(o.product_name) l), '[]'::jsonb))
  from orders o where o.id = p_order_id
$$;

-- كتابة الحركات: دالة الكتابة الوحيدة اللي كل المسارات بتعدّي عليها
-- (درس 51). بتقفل صفوف المنتجات بترتيب الـid (منع deadlock بين سكانرين)،
-- وبتجمّع الكمية لكل (منتج، اتجاه) في حركة واحدة.
create or replace function app.wh_post(p_scan_id bigint, p_source text, p_by text, p_note text)
returns void language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  r record; v_mid uuid; v_after int; v_tenant uuid; v_trk text;
begin
  select s.tenant_id, s.tracking_no into v_tenant, v_trk from wh_scans s where s.id = p_scan_id;
  perform 1 from stock_products sp
   where sp.id in (select l.product_id from wh_scan_lines l
                    where l.scan_id = p_scan_id and l.state = 'posted' and l.movement_id is null and l.product_id is not null)
   order by sp.id for update;
  for r in
    select l.product_id, l.dir, sum(l.qty)::int as q
      from wh_scan_lines l
     where l.scan_id = p_scan_id and l.state = 'posted' and l.movement_id is null and l.product_id is not null
     group by l.product_id, l.dir
     order by l.product_id, l.dir
  loop
    insert into stock_movements (tenant_id, product_id, product_name, movement_type, qty_in, qty_out,
                                 tracking_no, movement_date, notes, scan_id, source, created_by_name)
    select v_tenant, sp.id, sp.name, r.dir,
           case when r.dir = 'in' then r.q else 0 end,
           case when r.dir = 'out' then r.q else 0 end,
           v_trk, (now() at time zone 'Africa/Cairo')::date, left(p_note, 300), p_scan_id, p_source, p_by
      from stock_products sp where sp.id = r.product_id
    returning id into v_mid;
    select sp.current_qty into v_after from stock_products sp where sp.id = r.product_id;
    update wh_scan_lines l
       set movement_id = v_mid, qty_after = v_after
     where l.scan_id = p_scan_id and l.state = 'posted' and l.movement_id is null
       and l.product_id = r.product_id and l.dir = r.dir;
  end loop;
end $$;

-- سطور الخروج/المرتجع من product_name + الحل. الخاصية من السطر الأول بس
-- (manufacturer_note وإلا var) ولو المنتجات ماتعدّلتش (نفس قاعدة wa-ofd —
-- أوردر اتعدّل الخاصية بتاعته ممكن تبقى لمنتج اتشال).
create or replace function app.wh_make_lines(p_scan_id bigint, p_order_id uuid, p_dir text)
returns void language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  o record; l record; r record; v_props text; v_var text;
begin
  select x.id, x.tenant_id, x.product_name, x.manufacturer_note, x."var" as v, x.line_prices, x.has_upsell
    into o from orders x where x.id = p_order_id;
  for l in select * from app.wh_order_lines(o.product_name) loop
    if l.line_no = 1 and o.line_prices is null and not coalesce(o.has_upsell, false) then
      v_props := coalesce(app.wh_props_key(coalesce(nullif(btrim(o.manufacturer_note), ''), o.v)), '');
      v_var   := coalesce(app.wh_props_key(o.v), '');
    else
      v_props := ''; v_var := '';
    end if;
    select * into r from app.wh_resolve(o.tenant_id, l.item_key, v_props, v_var);
    insert into wh_scan_lines (tenant_id, scan_id, order_id, dir, line_no, line_text, item_key, props_key, var_key,
                               qty, product_id, matched_by, state)
    values (o.tenant_id, p_scan_id, o.id, p_dir, l.line_no, l.line_text, l.item_key, v_props, v_var,
            l.qty, r.product_id, r.matched_by, r.state);
  end loop;
end $$;

-- مرآة: سطور اتجاه عكسي لنفس المنتجات والكميات اللي اتحركت فعلاً في
-- سكان سابق. السطور المعلّقة في الأصل بتبقى void (رجعت قبل ما تتخصم).
create or replace function app.wh_mirror_lines(p_new_scan bigint, p_src_scan bigint, p_dir text, p_note text)
returns void language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  insert into wh_scan_lines (tenant_id, scan_id, order_id, dir, line_no, line_text, item_key, props_key, var_key,
                             qty, product_id, matched_by, state)
  select l.tenant_id, p_new_scan, l.order_id, p_dir, l.line_no, l.line_text, l.item_key, l.props_key, l.var_key,
         l.qty, l.product_id, 'mirror', 'posted'
    from wh_scan_lines l
   where l.scan_id = p_src_scan and l.state = 'posted' and l.movement_id is not null and l.product_id is not null;
  update wh_scan_lines l
     set state = 'void', note = p_note, resolved_at = now()
   where l.scan_id = p_src_scan and l.state = 'unmatched';
end $$;

-- السطور اللي بترجع للواجهة
create or replace function app.wh_scan_lines_json(p_scan_id bigint)
returns jsonb language sql stable
set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'text', l.line_text, 'qty', l.qty, 'dir', l.dir, 'state', l.state, 'matched_by', l.matched_by,
           'product_id', l.product_id, 'product_name', sp.name, 'qty_after', l.qty_after)
         order by l.line_no), '[]'::jsonb)
    from wh_scan_lines l left join stock_products sp on sp.id = l.product_id
   where l.scan_id = p_scan_id
$$;

-- قلب السكان: بيتنادى بأوردر معروف + صف wh_scans محجوز. بيرجّع الرد.
-- p_mode: 'scan' (السكانر/الكتابة) أو 'admin' (wh_scan_order — الأدمن).
create or replace function app.wh_core(p_scan_id bigint, p_order_id uuid, p_mode text, p_force text,
                                       p_by text, p_is_admin boolean)
returns jsonb language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  o record; st record; cfg record;
  v_base timestamptz; v_jt_first timestamptz;
  v_return_ev boolean; v_cancel_req boolean; v_has_out boolean; v_has_in boolean;
  v_code text; v_tone text; v_dir text := null; v_applied boolean := false;
  v_warn text[] := '{}'; v_opts text[] := '{}'; v_prev jsonb := null;
  v_source text; v_note text; v_stamp_d boolean := false; v_stamp_r boolean := false;
  v_res jsonb; v_kind text; v_src_scan bigint;
begin
  select x.* into o from orders x where x.id = p_order_id for update;
  select c.* into cfg from wh_config c where c.tenant_id = o.tenant_id;
  v_base := coalesce(cfg.baseline_at, now());
  insert into wh_order_stock (order_id, tenant_id, tracking_no) values (o.id, o.tenant_id, o.tracking_no)
  on conflict (order_id) do nothing;
  select s.* into st from wh_order_stock s where s.order_id = o.id for update;
  if o.tracking_no is not null then
    select min(e.received_at) into v_jt_first
      from jt_events e where e.bill_code = o.tracking_no and e.kind in ('trace', 'pull') and e.digest_ok;
  end if;
  v_return_ev := o.status in ('Returned to business', 'Returned to business2')
              or coalesce(o.carrier_status_code, '') like 'refund:%'
              or coalesce(o.carrier_status_code, '') in ('13', '111', '172');
  v_cancel_req := o.cancel_requested_at is not null and o.cancel_resolved_at is null;
  v_has_out := st.out_scan_id is not null;
  v_has_in  := st.in_scan_id is not null;
  update wh_scans set order_id = o.id, tracking_no = o.tracking_no where id = p_scan_id;
  if lower(coalesce(o.status, '')) = 'delivered' and p_mode <> 'admin' then
    v_code := 'blocked_delivered';
  elsif (v_return_ev and p_force is distinct from 'out') or p_force = 'in' then
    if p_force = 'in' and not v_return_ev and not v_has_out and v_jt_first is null and p_mode <> 'admin' then
      v_code := 'not_a_return';
    elsif v_has_in then
      v_code := 'already_in';
      v_prev := jsonb_build_object('at', st.in_at, 'by', st.in_by_name);
    else
      v_dir := 'in';
      if v_has_out then
        v_kind := 'mirror'; v_source := 'scan_in'; v_src_scan := st.out_scan_id;
        perform app.wh_mirror_lines(p_scan_id, st.out_scan_id, 'in', 'رجع قبل ما يتخصم');
        v_code := 'in_ok';
      elsif p_mode = 'admin' and v_jt_first is null then
        v_kind := 'manual'; v_source := 'scan_in';
        perform app.wh_make_lines(p_scan_id, o.id, 'in');
        v_code := 'in_ok_manual';
      elsif v_jt_first is null then
        v_kind := 'flag'; v_code := 'in_flag_only';
      elsif v_jt_first < v_base then
        if (o.stock_returned_at is not null and o.stock_returned_at < v_base)
           or (coalesce(o.carrier_status_code, '') in ('13', '111') and o.carrier_status_at < v_base) then
          v_kind := 'counted'; v_code := 'in_counted';
        else
          v_kind := 'precount'; v_source := 'scan_in_precount';
          perform app.wh_make_lines(p_scan_id, o.id, 'in');
          v_code := 'in_ok_precount';
        end if;
      else
        v_kind := 'leak'; v_code := 'in_leak';
      end if;
      if v_source is not null then
        v_note := '↩️ مرتجع · #' || coalesce(o.order_uid, '') || ' · ' || p_by;
        perform app.wh_post(p_scan_id, v_source, p_by, v_note);
      end if;
      update wh_order_stock
         set in_scan_id = p_scan_id, in_at = now(), in_by_name = p_by, in_kind = v_kind,
             leak_state = case when v_kind = 'leak' and leak_state is null then 'closed_by_return' else leak_state end,
             updated_at = now()
       where order_id = o.id;
      if o.stock_returned_at is null then
        update orders set stock_returned_at = now() where id = o.id;
        v_stamp_r := true;
      end if;
      v_applied := true;
    end if;
  elsif v_jt_first is not null and p_force is distinct from 'out' and p_mode <> 'admin' then
    if v_has_out then v_code := 'confirm_return'; v_opts := array['in'];
    else v_code := 'with_jt_confirm'; v_opts := array['in', 'out']; end if;
  elsif o.status = 'cancelled' then
    if v_has_out then v_code := 'pulled_back'; else v_code := 'blocked_cancelled'; end if;
  elsif v_cancel_req and coalesce(cfg.hold_cancel_requested, true) and p_force is distinct from 'ship_anyway' then
    if v_has_out then v_code := 'pulled_back'; else v_code := 'blocked_cancel_requested'; end if;
  elsif v_has_out then
    v_code := 'already_out';
    v_prev := jsonb_build_object('at', st.out_at, 'by', st.out_by_name);
  else
    v_dir := 'out';
    v_source := case when p_mode = 'admin' and v_jt_first is not null then 'leak_fix'
                     when v_jt_first is not null then 'late_out'
                     else 'scan_out' end;
    perform app.wh_make_lines(p_scan_id, o.id, 'out');
    v_note := '📦 خروج · #' || coalesce(o.order_uid, '') || ' · ' || p_by;
    perform app.wh_post(p_scan_id, v_source, p_by, v_note);
    update wh_order_stock
       set out_scan_id = p_scan_id, out_at = now(), out_by_name = p_by,
           leak_state = case when v_source = 'leak_fix' then 'deducted' else leak_state end,
           updated_at = now()
     where order_id = o.id;
    if o.stock_deducted_at is null then
      update orders set stock_deducted_at = now() where id = o.id;
      v_stamp_d := true;
    end if;
    v_code := case when v_source = 'leak_fix' then 'out_leak_fix' else 'out_ok' end;
    if v_source = 'late_out' then v_warn := array_append(v_warn, 'late'::text); end if;
    v_applied := true;
  end if;
  if v_code = 'pulled_back' then
    v_dir := 'pull_back';
    v_src_scan := st.out_scan_id;
    perform app.wh_mirror_lines(p_scan_id, st.out_scan_id, 'in', 'اتسحب قبل ما يتخصم');
    perform app.wh_post(p_scan_id, 'pull_back', p_by, '⛔ اتسحب من الكومة · #' || coalesce(o.order_uid, '') || ' · ' || p_by);
    update wh_scans
       set reversed_at = now(), reversed_by_name = p_by, reversed_by_scan_id = p_scan_id
     where id = st.out_scan_id and reversed_at is null;
    update wh_order_stock
       set out_scan_id = null, out_at = null, out_by_name = null, updated_at = now()
     where order_id = o.id;
    if o.stock_deducted_at is not null then
      update orders set stock_deducted_at = null where id = o.id;
    end if;
    v_applied := true;
  end if;
  if v_applied then
    if exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.state = 'unmatched') then v_warn := array_append(v_warn, 'unmatched'::text); end if;
    if exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.matched_by = 'unallocated') then v_warn := array_append(v_warn, 'unallocated'::text); end if;
    if exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.qty_after < 0) then v_warn := array_append(v_warn, 'short'::text); end if;
  end if;
  if v_dir = 'out' then
    if (select coalesce(sum(l.qty), 0) from wh_scan_lines l where l.scan_id = p_scan_id) > 1 then v_warn := array_append(v_warn, 'multi_piece'::text); end if;
    if o.jt_cod_amount is not null and o.total_cost is not null and o.jt_cod_amount <> o.total_cost then v_warn := array_append(v_warn, 'cod_mismatch'::text); end if;
    if v_cancel_req then v_warn := array_append(v_warn, 'cancel_requested'::text); end if;
  end if;
  v_tone := case
    when v_code in ('out_ok', 'out_leak_fix') then case when 'short' = any(v_warn) or 'unmatched' = any(v_warn) then 'warn' else 'ok' end
    when v_code in ('in_ok', 'in_ok_precount', 'in_counted', 'in_ok_manual') then 'in'
    when v_code in ('already_out', 'already_in') then 'dup'
    when v_code in ('confirm_return', 'with_jt_confirm', 'in_leak', 'in_flag_only', 'pulled_back') then 'warn'
    else 'stop' end;
  v_res := jsonb_build_object(
    'ok', true, 'code', v_code, 'tone', v_tone, 'dir', v_dir, 'applied', v_applied,
    'scan_id', p_scan_id, 'order', app.wh_order_brief(o.id),
    'lines', app.wh_scan_lines_json(p_scan_id),
    'warnings', to_jsonb(v_warn), 'options', to_jsonb(v_opts), 'prev', v_prev,
    'stamped_deducted', v_stamp_d, 'stamped_returned', v_stamp_r, 'in_kind', v_kind,
    'by', p_by);
  update wh_scans
     set code = v_code, applied = v_applied, dir = v_dir, result = v_res
   where id = p_scan_id;
  return v_res;
end $$;

revoke all on function app.wh_key(text) from public;
revoke all on function app.wh_props_key(text) from public;
revoke all on function app.wh_code(text) from public;
revoke all on function app.wh_order_lines(text) from public;
revoke all on function app.wh_resolve(uuid, text, text, text) from public;
revoke all on function app.wh_order_brief(uuid) from public;
revoke all on function app.wh_post(bigint, text, text, text) from public;
revoke all on function app.wh_make_lines(bigint, uuid, text) from public;
revoke all on function app.wh_mirror_lines(bigint, bigint, text, text) from public;
revoke all on function app.wh_scan_lines_json(bigint) from public;
revoke all on function app.wh_core(bigint, uuid, text, text, text, boolean) from public;

-- ── 6) الـRPCs (public · DEFINER · jsonb · مابترميش exception) ──────────

-- هوية المستخدم من الـJWT + البروفايل — الاسم عمره ما بييجي من المتصفح.
create or replace function app.wh_me(out uid uuid, out tenant_id uuid, out name text, out is_admin boolean)
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select up.id, up.tenant_id, coalesce(nullif(btrim(up.full_name), ''), 'موظف'), up.role = 'admin'
    from user_profiles up
   where up.id = auth.uid() and coalesce(up.active, true)
   limit 1
$$;
revoke all on function app.wh_me() from public;

-- 1) السكان
create or replace function public.wh_scan(p_code text, p_client_id uuid, p_force text default null,
                                          p_reason text default null, p_station text default null,
                                          p_source text default 'scanner')
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; cfg record; v_dry boolean; v_code text; v_digits text; v_scan_id bigint;
  v_res jsonb; v_err text; v_state text; v_oid uuid; v_cnt int;
begin
  select * into me from app.wh_me();
  if me.uid is null then
    return jsonb_build_object('ok', false, 'code', case when auth.uid() is null then 'not_authenticated' else 'not_allowed' end, 'tone', 'stop');
  end if;
  if p_client_id is null or (p_force is not null and p_force not in ('in', 'out', 'ship_anyway'))
     or coalesce(p_source, 'scanner') not in ('scanner', 'manual') then
    return jsonb_build_object('ok', false, 'code', 'bad_args', 'tone', 'stop');
  end if;
  if p_force = 'ship_anyway' and not me.is_admin then
    return jsonb_build_object('ok', false, 'code', 'not_allowed', 'tone', 'stop');
  end if;
  if p_force = 'ship_anyway' and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'tone', 'stop');
  end if;
  select c.* into cfg from wh_config c where c.tenant_id = me.tenant_id;
  v_dry := not coalesce(cfg.enabled, false);
  if not v_dry then
    select s.result into v_res from wh_scans s where s.tenant_id = me.tenant_id and s.client_id = p_client_id;
    if found then return v_res || jsonb_build_object('replay', true); end if;
  end if;
  v_code := app.wh_code(p_code);
  begin
    insert into wh_scans (tenant_id, client_id, raw_code, code, scanned_by, scanned_by_name, source, station, forced, reason)
    values (me.tenant_id, p_client_id, left(coalesce(p_code, ''), 80), 'pending', me.uid, me.name,
            coalesce(p_source, 'scanner'), left(nullif(btrim(coalesce(p_station, '')), ''), 40), p_force,
            left(nullif(btrim(coalesce(p_reason, '')), ''), 300))
    on conflict (tenant_id, client_id) do nothing
    returning id into v_scan_id;
    if v_scan_id is null then
      select s.result into v_res from wh_scans s where s.tenant_id = me.tenant_id and s.client_id = p_client_id;
      return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('replay', true);
    end if;
    if v_code is null then
      v_digits := regexp_replace(translate(coalesce(p_code, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
      v_state := case
        when v_digits ~ '^[0-9]{8,10}$' and regexp_replace(coalesce(p_code, ''), '[\s0-9٠-٩۰-۹]', '', 'g') = '' then 'legacy_code'
        when v_digits ~ '^[0-9]{12,14}$' and regexp_replace(coalesce(p_code, ''), '[\s0-9٠-٩۰-۹]', '', 'g') = '' then 'product_barcode'
        else 'bad_code' end;
      v_res := jsonb_build_object('ok', true, 'code', v_state, 'tone', 'stop', 'applied', false, 'scan_id', v_scan_id);
      update wh_scans set code = v_state, result = v_res where id = v_scan_id;
    elsif v_code like 'UEG%' then
      v_res := jsonb_build_object('ok', true, 'code', 'sandbox_code', 'tone', 'stop', 'applied', false, 'scan_id', v_scan_id);
      update wh_scans set code = 'sandbox_code', tracking_no = v_code, result = v_res where id = v_scan_id;
    else
      select count(*) into v_cnt from orders x where x.tenant_id = me.tenant_id and x.tracking_no = v_code;
      select x.id into v_oid from orders x
       where x.tenant_id = me.tenant_id and x.tracking_no = v_code
       order by (x.shipping_carrier = 'jt') desc nulls last, x.created_at desc limit 1;
      if v_oid is null then
        v_res := jsonb_build_object('ok', true, 'code', 'not_found', 'tone', 'stop', 'applied', false,
                                    'scan_id', v_scan_id, 'tracking_no', v_code);
        update wh_scans set code = 'not_found', tracking_no = v_code, result = v_res where id = v_scan_id;
      elsif v_cnt > 1 and not exists (select 1 from orders x where x.id = v_oid and x.shipping_carrier = 'jt') then
        v_res := jsonb_build_object('ok', true, 'code', 'ambiguous', 'tone', 'stop', 'applied', false,
                                    'scan_id', v_scan_id, 'tracking_no', v_code);
        update wh_scans set code = 'ambiguous', tracking_no = v_code, result = v_res where id = v_scan_id;
      else
        v_res := app.wh_core(v_scan_id, v_oid, 'scan', p_force, me.name, me.is_admin);
      end if;
    end if;
    if v_dry then
      raise exception using errcode = 'WHD01', message = 'wh_dry';
    end if;
  exception
    when sqlstate 'WHD01' then
      v_res := v_res || jsonb_build_object('dry', true);
    when lock_not_available then
      return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn', 'dry', v_dry);
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      v_res := jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err, 'dry', v_dry);
      if not v_dry then
        insert into wh_scans (tenant_id, client_id, raw_code, code, scanned_by, scanned_by_name, source, result)
        values (me.tenant_id, p_client_id, left(coalesce(p_code, ''), 80), 'error', me.uid, me.name,
                coalesce(p_source, 'scanner'), v_res)
        on conflict (tenant_id, client_id) do nothing;
      end if;
  end;
  return v_res || jsonb_build_object('dry', v_dry);
end $$;

-- 2) أدمن: خصم طرد خرج من غير سكان · مرتجع يدوي · قفل تسريب
create or replace function public.wh_scan_order(p_order_id uuid, p_dir text, p_client_id uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; cfg record; v_dry boolean; v_scan_id bigint; v_res jsonb; v_err text; o record; st record;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed', 'tone', 'stop'); end if;
  if p_order_id is null or p_client_id is null or p_dir not in ('out', 'in', 'dismiss_leak') then
    return jsonb_build_object('ok', false, 'code', 'bad_args', 'tone', 'stop');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'tone', 'stop');
  end if;
  select x.id, x.tenant_id, x.tracking_no into o from orders x where x.id = p_order_id and x.tenant_id = me.tenant_id;
  if o.id is null then return jsonb_build_object('ok', false, 'code', 'not_found', 'tone', 'stop'); end if;
  select c.* into cfg from wh_config c where c.tenant_id = me.tenant_id;
  v_dry := not coalesce(cfg.enabled, false);
  if not v_dry then
    select s.result into v_res from wh_scans s where s.tenant_id = me.tenant_id and s.client_id = p_client_id;
    if found then return v_res || jsonb_build_object('replay', true); end if;
  end if;
  begin
    insert into wh_scans (tenant_id, client_id, order_id, tracking_no, code, scanned_by, scanned_by_name, source, forced, reason)
    values (me.tenant_id, p_client_id, o.id, o.tracking_no, 'pending', me.uid, me.name, 'admin', p_dir, left(btrim(p_reason), 300))
    on conflict (tenant_id, client_id) do nothing
    returning id into v_scan_id;
    if v_scan_id is null then
      select s.result into v_res from wh_scans s where s.tenant_id = me.tenant_id and s.client_id = p_client_id;
      return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('replay', true);
    end if;
    if p_dir = 'dismiss_leak' then
      insert into wh_order_stock (order_id, tenant_id, tracking_no) values (o.id, o.tenant_id, o.tracking_no)
      on conflict (order_id) do nothing;
      select s.* into st from wh_order_stock s where s.order_id = o.id for update;
      if st.out_scan_id is not null or st.leak_state is not null then
        v_res := jsonb_build_object('ok', true, 'code', 'not_leak', 'tone', 'stop', 'applied', false, 'scan_id', v_scan_id);
        update wh_scans set code = 'not_leak', result = v_res where id = v_scan_id;
      else
        update wh_order_stock set leak_state = 'dismissed', leak_note = left(btrim(p_reason), 300), updated_at = now()
         where order_id = o.id;
        v_res := jsonb_build_object('ok', true, 'code', 'leak_dismissed', 'tone', 'ok', 'applied', true, 'scan_id', v_scan_id,
                                    'order', app.wh_order_brief(o.id));
        update wh_scans set code = 'leak_dismissed', applied = true, dir = 'dismiss', result = v_res where id = v_scan_id;
      end if;
    else
      v_res := app.wh_core(v_scan_id, o.id, 'admin', p_dir, me.name, true);
    end if;
    if v_dry then raise exception using errcode = 'WHD01', message = 'wh_dry'; end if;
  exception
    when sqlstate 'WHD01' then v_res := v_res || jsonb_build_object('dry', true);
    when lock_not_available then return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn', 'dry', v_dry);
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      v_res := jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err, 'dry', v_dry);
  end;
  return v_res || jsonb_build_object('dry', v_dry);
end $$;

-- 3) التراجع عن سكان غلط — سكانك أنت خلال 15 دقيقة، والأدمن أي وقت.
create or replace function public.wh_scan_undo(p_scan_id bigint, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; s record; st record; o record; v_new bigint; v_res jsonb; v_err text;
begin
  select * into me from app.wh_me();
  if me.uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed', 'tone', 'stop'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'tone', 'stop');
  end if;
  begin
    select x.* into s from wh_scans x where x.id = p_scan_id and x.tenant_id = me.tenant_id for update;
    if s.id is null then return jsonb_build_object('ok', false, 'code', 'not_found', 'tone', 'stop'); end if;
    if not me.is_admin and (s.scanned_by <> me.uid or s.created_at < now() - interval '15 minutes') then
      return jsonb_build_object('ok', false, 'code', 'too_old', 'tone', 'stop');
    end if;
    if s.reversed_at is not null then return jsonb_build_object('ok', false, 'code', 'already_reversed', 'tone', 'dup'); end if;
    if not s.applied or s.dir not in ('out', 'in') or s.order_id is null then
      return jsonb_build_object('ok', false, 'code', 'nothing_applied', 'tone', 'stop');
    end if;
    select x.id, x.order_uid, x.stock_deducted_at, x.stock_returned_at into o from orders x where x.id = s.order_id for update;
    select x.* into st from wh_order_stock x where x.order_id = s.order_id for update;
    if (s.dir = 'out' and (st.out_scan_id is distinct from s.id or st.in_scan_id is not null))
       or (s.dir = 'in' and st.in_scan_id is distinct from s.id) then
      return jsonb_build_object('ok', false, 'code', 'has_later_scan', 'tone', 'stop');
    end if;
    insert into wh_scans (tenant_id, client_id, order_id, tracking_no, dir, code, scanned_by, scanned_by_name, source, reason, reverses_scan_id)
    values (me.tenant_id, gen_random_uuid(), s.order_id, s.tracking_no, 'undo', 'pending', me.uid, me.name, 'undo',
            left(btrim(p_reason), 300), s.id)
    returning id into v_new;
    perform app.wh_mirror_lines(v_new, s.id, case when s.dir = 'out' then 'in' else 'out' end, 'اتلغى بالتراجع');
    update wh_scan_lines set state = 'reversed', resolved_at = now(), resolved_by_name = me.name
     where scan_id = s.id and state = 'posted';
    perform app.wh_post(v_new, 'undo', me.name, '↶ تراجع · #' || coalesce(o.order_uid, '') || ' · ' || me.name);
    if s.dir = 'out' then
      update wh_order_stock
         set out_scan_id = null, out_at = null, out_by_name = null,
             leak_state = case when leak_state = 'deducted' then null else leak_state end, updated_at = now()
       where order_id = s.order_id;
      if coalesce((s.result ->> 'stamped_deducted')::boolean, false) then
        update orders set stock_deducted_at = null where id = s.order_id;
      end if;
    else
      update wh_order_stock
         set in_scan_id = null, in_at = null, in_by_name = null, in_kind = null,
             leak_state = case when leak_state = 'closed_by_return' then null else leak_state end, updated_at = now()
       where order_id = s.order_id;
      if coalesce((s.result ->> 'stamped_returned')::boolean, false) then
        update orders set stock_returned_at = null where id = s.order_id;
      end if;
    end if;
    update wh_scans set reversed_at = now(), reversed_by_name = me.name, reversed_by_scan_id = v_new where id = s.id;
    v_res := jsonb_build_object('ok', true, 'code', 'undone', 'tone', 'warn', 'applied', true, 'scan_id', v_new,
                                'reverses', s.id, 'order', app.wh_order_brief(s.order_id),
                                'lines', app.wh_scan_lines_json(v_new));
    update wh_scans set code = 'undone', applied = true, result = v_res where id = v_new;
  exception
    when lock_not_available then return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn');
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err);
  end;
  return v_res;
end $$;

-- 4) الكتابة اليدوية: آخر أرقام البوليصة أو رقم الأوردر → اختيارات (مابيكتبش)
create or replace function public.wh_lookup(p_q text)
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare
  me record; q text; v_code text; v_rows jsonb;
begin
  select * into me from app.wh_me();
  if me.uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  q := upper(regexp_replace(translate(coalesce(p_q, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\s', '', 'g'));
  v_code := app.wh_code(q);
  with c as (
    select x.id from orders x
     where x.tenant_id = me.tenant_id and x.tracking_no is not null
       and (   (v_code is not null and x.tracking_no = v_code)
            or (v_code is null and q ~ '^W-?[0-9]{1,6}$' and upper(x.order_uid) = 'W-' || regexp_replace(q, '^W-?', ''))
            or (v_code is null and q ~ '^[0-9]{4,5}$' and x.order_uid = q)
            or (v_code is null and q ~ '^[0-9]{6,12}$' and x.tracking_no like '%' || q))
     order by x.created_at desc limit 6)
  select coalesce(jsonb_agg(jsonb_build_object(
           'tracking_no', x.tracking_no, 'uid', x.order_uid, 'status', x.status,
           'first_name', nullif(split_part(btrim(coalesce(x.customer_name, '')), ' ', 1), ''),
           'items', (select string_agg(l.line_text || case when l.qty > 1 then ' ×' || l.qty else '' end, ' · ' order by l.line_no)
                       from app.wh_order_lines(x.product_name) l),
           'out_at', s.out_at, 'in_at', s.in_at) order by x.created_at desc), '[]'::jsonb)
    into v_rows
    from c join orders x on x.id = c.id left join wh_order_stock s on s.order_id = x.id;
  if v_code is null and q !~ '^W-?[0-9]{1,6}$' and q !~ '^[0-9]{4,12}$' then
    return jsonb_build_object('ok', true, 'code', 'too_short', 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok', 'rows', v_rows);
end $$;

-- 5) لوحة المخزن: العدّادات والقوايم (من غير تليفونات)
create or replace function public.wh_board(p_lite boolean default false)
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare
  me record; cfg record; v_base timestamptz;
  v_today timestamptz := (date_trunc('day', now() at time zone 'Africa/Cairo')) at time zone 'Africa/Cairo';
  v_res jsonb;
begin
  select * into me from app.wh_me();
  if me.uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select c.* into cfg from wh_config c where c.tenant_id = me.tenant_id;
  v_base := cfg.baseline_at;
  with o as (
    select x.id, x.order_uid, x.customer_name, x.product_name, x.status, x.tracking_no,
           x.carrier_status_code, x.carrier_status_at, x.awb_printed_at, x.created_at, x.stock_returned_at,
           (x.cancel_requested_at is not null and x.cancel_resolved_at is null) as cancel_req,
           s.out_scan_id, s.out_at, s.out_by_name, s.in_scan_id, s.in_at, s.leak_state,
           (select min(e.received_at) from jt_events e where e.bill_code = x.tracking_no and e.kind in ('trace', 'pull') and e.digest_ok) as jt_first
      from orders x left join wh_order_stock s on s.order_id = x.id
     where x.tenant_id = me.tenant_id and x.shipping_carrier = 'jt' and x.tracking_no is not null
       and x.created_at > now() - interval '60 days'
  ), b as (
    select o.*,
      (o.out_scan_id is null and o.jt_first is null and o.status = 'BOSTA AUTO' and not o.cancel_req) as k_not_scanned,
      (o.out_scan_id is not null and o.jt_first is null and o.in_scan_id is null and o.status <> 'cancelled' and not o.cancel_req) as k_pile,
      (o.out_scan_id is not null and o.jt_first is null and o.in_scan_id is null and (o.status = 'cancelled' or o.cancel_req)) as k_pull,
      (v_base is not null and o.jt_first >= v_base and o.out_scan_id is null and o.leak_state is null and o.in_scan_id is null) as k_leak,
      (o.carrier_status_code = 'refund:94' and o.carrier_status_at > now() - interval '6 hours') as k_courier,
      (o.carrier_status_code in ('13', '111') and o.carrier_status_at >= coalesce(v_base, now())
         and o.carrier_status_at < now() - interval '2 hours' and o.in_scan_id is null) as k_closed_unscanned,
      (select string_agg(l.line_text || case when l.qty > 1 then ' ×' || l.qty else '' end, ' · ' order by l.line_no)
         from app.wh_order_lines(o.product_name) l) as items
      from o
  )
  select jsonb_build_object(
    'ok', true,
    'enabled', coalesce(cfg.enabled, false),
    'baseline_at', v_base,
    'hold_cancel_requested', coalesce(cfg.hold_cancel_requested, true),
    'is_admin', me.is_admin,
    'counts', jsonb_build_object(
      'not_scanned', count(*) filter (where k_not_scanned),
      'not_scanned_old', count(*) filter (where k_not_scanned and created_at < v_today),
      'pile', count(*) filter (where k_pile),
      'pull', count(*) filter (where k_pull),
      'leak', count(*) filter (where k_leak),
      'leak_cancelled', count(*) filter (where k_leak and status = 'cancelled'),
      'stale_pile', count(*) filter (where k_pile and out_at < now() - interval '30 hours'),
      'courier', count(*) filter (where k_courier),
      'courier_scanned', count(*) filter (where k_courier and in_scan_id is not null),
      'closed_unscanned', count(*) filter (where k_closed_unscanned),
      'out_today', (select count(*) from wh_scans s where s.tenant_id = me.tenant_id and s.applied and s.dir = 'out'
                      and s.reversed_at is null and s.created_at >= v_today),
      'in_today', (select count(*) from wh_scans s where s.tenant_id = me.tenant_id and s.applied and s.dir = 'in'
                      and s.reversed_at is null and s.created_at >= v_today),
      'unmatched_lines', (select count(*) from wh_scan_lines l where l.tenant_id = me.tenant_id and l.state = 'unmatched'),
      'negative_products', (select count(*) from stock_products p where p.tenant_id = me.tenant_id and coalesce(p.active, true)
                              and coalesce(p.current_qty, 0) < 0)),
    'lists', case when p_lite then null else jsonb_build_object(
      'not_scanned', coalesce(jsonb_agg(jsonb_build_object('t', tracking_no, 'uid', order_uid, 'n', split_part(btrim(coalesce(customer_name, '')), ' ', 1),
                         'items', items, 'printed', awb_printed_at, 'created', created_at, 'old', created_at < v_today)
                       order by created_at) filter (where k_not_scanned), '[]'::jsonb),
      'pile', coalesce(jsonb_agg(jsonb_build_object('t', tracking_no, 'uid', order_uid, 'items', items, 'at', out_at, 'by', out_by_name,
                         'stale', out_at < now() - interval '30 hours') order by out_at) filter (where k_pile), '[]'::jsonb),
      'pull', coalesce(jsonb_agg(jsonb_build_object('t', tracking_no, 'uid', order_uid, 'items', items, 'at', out_at, 'by', out_by_name,
                         'cancelled', status = 'cancelled') order by out_at) filter (where k_pull), '[]'::jsonb),
      'leak', coalesce(jsonb_agg(jsonb_build_object('id', id, 't', tracking_no, 'uid', order_uid, 'items', items, 'jt_at', jt_first,
                         'cancelled', status = 'cancelled') order by jt_first desc) filter (where k_leak), '[]'::jsonb),
      'courier', coalesce(jsonb_agg(jsonb_build_object('t', tracking_no, 'uid', order_uid, 'items', items, 'at', carrier_status_at,
                         'done', in_scan_id is not null) order by carrier_status_at desc) filter (where k_courier), '[]'::jsonb),
      'closed_unscanned', coalesce(jsonb_agg(jsonb_build_object('t', tracking_no, 'uid', order_uid, 'items', items, 'at', carrier_status_at,
                         'marked', stock_returned_at is not null) order by carrier_status_at) filter (where k_closed_unscanned), '[]'::jsonb),
      'today', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'dir', s.dir, 'at', s.created_at, 'by', s.scanned_by_name,
                          't', s.tracking_no, 'uid', (s.result -> 'order' ->> 'uid'), 'applied', s.applied, 'reversed', s.reversed_at is not null,
                          'tone', s.result ->> 'tone', 'mine', s.scanned_by = me.uid) order by s.id desc), '[]'::jsonb)
                  from (select * from wh_scans s2 where s2.tenant_id = me.tenant_id and s2.created_at >= v_today
                         order by s2.id desc limit 200) s)
    ) end)
    into v_res
    from b;
  return v_res;
end $$;

-- 6) ربط المنتجات: الأسماء اللي في الأوردرات وبتتحل لإيه دلوقتي
create or replace function public.wh_items_unmapped(p_days int default 30)
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare me record; v_res jsonb;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  with ol as (
    select x.id, l.line_no, l.line_text, l.item_key, l.qty,
           case when l.line_no = 1 and x.line_prices is null and not coalesce(x.has_upsell, false)
                then coalesce(app.wh_props_key(coalesce(nullif(btrim(x.manufacturer_note), ''), x."var")), '') else '' end as props,
           case when l.line_no = 1 and x.line_prices is null and not coalesce(x.has_upsell, false)
                then coalesce(app.wh_props_key(x."var"), '') else '' end as vkey
      from orders x cross join lateral app.wh_order_lines(x.product_name) l
     where x.tenant_id = me.tenant_id and x.status <> 'cancelled'
       and x.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 120)))
  ), g as (
    select item_key, props, vkey, min(line_text) as sample, count(distinct id) as orders, sum(qty)::int as pieces
      from ol group by item_key, props, vkey
  )
  select jsonb_build_object('ok', true, 'rows', coalesce(jsonb_agg(jsonb_build_object(
           'item_key', g.item_key, 'props_key', g.props, 'var_key', g.vkey, 'sample', g.sample,
           'orders', g.orders, 'pieces', g.pieces,
           'state', r.state, 'matched_by', r.matched_by, 'product_id', r.product_id, 'product_name', sp.name,
           'alias_item', ai.product_id, 'alias_item_ignore', ai.ignore,
           'alias_props', ap.product_id, 'alias_props_ignore', ap.ignore)
         order by g.orders desc, g.item_key, g.props), '[]'::jsonb),
         'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'parent_id', p.parent_id,
                         'label', p.variant_label, 'qty', p.current_qty, 'active', coalesce(p.active, true)) order by p.name), '[]'::jsonb)
                        from stock_products p where p.tenant_id = me.tenant_id))
    into v_res
    from g
    cross join lateral app.wh_resolve(me.tenant_id, g.item_key, g.props, g.vkey) r
    left join stock_products sp on sp.id = r.product_id
    left join stock_item_aliases ai on ai.tenant_id = me.tenant_id and ai.item_key = g.item_key and ai.props_key = ''
    left join stock_item_aliases ap on ap.tenant_id = me.tenant_id and ap.item_key = g.item_key and ap.props_key = g.props and g.props <> '';
  return v_res;
end $$;

-- إعادة حل السطور المعلّقة (بعد ربط أو منتج جديد). السطر اللي منتجه
-- اتعدّ في جرد اتفتح بعد السكان = superseded (الجرد شايفه أصلاً)، وسطر
-- خروج لأوردر رجع بعدها = void.
create or replace function app.wh_repost(p_tenant uuid, p_item text, p_by text)
returns jsonb language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  l record; r record; v_rep int := 0; v_sup int := 0; v_void int := 0; v_scans bigint[] := '{}'; v_sid bigint;
begin
  for l in
    select x.* from wh_scan_lines x
     where x.tenant_id = p_tenant and x.state = 'unmatched' and (p_item is null or x.item_key = p_item)
     order by x.id
     for update
  loop
    select * into r from app.wh_resolve(p_tenant, l.item_key, l.props_key, l.var_key);
    if r.state = 'unmatched' then continue; end if;
    if r.state = 'ignored' then
      update wh_scan_lines set state = 'ignored', matched_by = r.matched_by, resolved_at = now(), resolved_by_name = p_by where id = l.id;
      continue;
    end if;
    if exists (select 1 from stock_count_lines cl join stock_counts c on c.id = cl.count_id
                where cl.product_id = r.product_id and c.applied_at is not null and c.opened_at > l.created_at) then
      update wh_scan_lines set state = 'superseded', product_id = r.product_id, matched_by = r.matched_by,
             note = 'المنتج اتعدّ في جرد بعد السكان', resolved_at = now(), resolved_by_name = p_by where id = l.id;
      v_sup := v_sup + 1; continue;
    end if;
    if l.dir = 'out' and exists (select 1 from wh_order_stock s where s.order_id = l.order_id and s.in_scan_id is not null) then
      update wh_scan_lines set state = 'void', product_id = r.product_id, matched_by = r.matched_by,
             note = 'رجع قبل ما يتخصم', resolved_at = now(), resolved_by_name = p_by where id = l.id;
      v_void := v_void + 1; continue;
    end if;
    update wh_scan_lines set state = 'posted', product_id = r.product_id, matched_by = r.matched_by, movement_id = null,
           resolved_at = now(), resolved_by_name = p_by where id = l.id;
    if not (l.scan_id = any(v_scans)) then v_scans := v_scans || l.scan_id; end if;
    v_rep := v_rep + 1;
  end loop;
  foreach v_sid in array v_scans loop
    perform app.wh_post(v_sid, 'repost', p_by, '🔗 بعد الربط · ' || p_by);
  end loop;
  return jsonb_build_object('reposted', v_rep, 'superseded', v_sup, 'voided', v_void);
end $$;
revoke all on function app.wh_repost(uuid, text, text) from public;

-- 7) حفظ ربط اسم → منتج (أو «تجاهل»). p_props '' = كل خصائص الاسم ده.
create or replace function public.wh_alias_set(p_item_key text, p_props_key text, p_product_id uuid,
                                               p_ignore boolean default false, p_replace boolean default false,
                                               p_sample text default null)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare me record; v_old record; v_rep jsonb; v_props text := coalesce(p_props_key, '');
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if coalesce(btrim(p_item_key), '') = '' or char_length(p_item_key) > 300 or char_length(v_props) > 300 then
    return jsonb_build_object('ok', false, 'code', 'bad_args');
  end if;
  if not coalesce(p_ignore, false) and not exists (select 1 from stock_products p where p.id = p_product_id and p.tenant_id = me.tenant_id) then
    return jsonb_build_object('ok', false, 'code', 'bad_product');
  end if;
  select a.* into v_old from stock_item_aliases a where a.tenant_id = me.tenant_id and a.item_key = p_item_key and a.props_key = v_props;
  if v_old.item_key is not null and not coalesce(p_replace, false)
     and (v_old.ignore is distinct from coalesce(p_ignore, false) or v_old.product_id is distinct from p_product_id) then
    return jsonb_build_object('ok', false, 'code', 'exists_use_replace');
  end if;
  insert into stock_item_aliases (tenant_id, item_key, props_key, product_id, ignore, sample_text, created_by_name)
  values (me.tenant_id, p_item_key, v_props, case when coalesce(p_ignore, false) then null else p_product_id end,
          coalesce(p_ignore, false), left(p_sample, 200), me.name)
  on conflict (tenant_id, item_key, props_key) do update
     set product_id = excluded.product_id, ignore = excluded.ignore, sample_text = coalesce(excluded.sample_text, stock_item_aliases.sample_text),
         created_by_name = excluded.created_by_name, updated_at = now();
  v_rep := app.wh_repost(me.tenant_id, p_item_key, me.name);
  return jsonb_build_object('ok', true, 'code', 'ok') || v_rep;
end $$;


-- إعادة حل كل المعلّق (بعد ما المالك يعمل منتج بنفس الاسم مثلاً)
create or replace function public.wh_repost_unmatched()
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare me record;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  return jsonb_build_object('ok', true, 'code', 'ok') || app.wh_repost(me.tenant_id, null, me.name);
end $$;

-- 8) الجرد: فتح · تطبيق (حركة 'count' بالفرق) · إلغاء
create or replace function public.wh_count_open(p_note text default null)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare me record; c record;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select x.* into c from stock_counts x where x.tenant_id = me.tenant_id and x.applied_at is null and x.cancelled_at is null;
  if c.id is not null then
    return jsonb_build_object('ok', true, 'code', 'count_open_exists', 'count_id', c.id, 'opened_at', c.opened_at, 'opened_by', c.opened_by_name);
  end if;
  insert into stock_counts (tenant_id, opened_by_name, note) values (me.tenant_id, me.name, left(nullif(btrim(p_note), ''), 300))
  returning * into c;
  return jsonb_build_object('ok', true, 'code', 'ok', 'count_id', c.id, 'opened_at', c.opened_at, 'opened_by', c.opened_by_name);
end $$;

create or replace function public.wh_count_cancel(p_count_id bigint)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare me record; v_n int;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  update stock_counts x set cancelled_at = now()
   where x.id = p_count_id and x.tenant_id = me.tenant_id and x.applied_at is null and x.cancelled_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'code', case when v_n > 0 then 'ok' else 'not_found' end);
end $$;

-- p_counts = [{product_id, counted}] · p_go_live = أول جرد: لازم كل المنتجات
-- النشطة، وبيكتب baseline_at = لحظة فتح الجرد وenabled = true في نفس
-- الترانزاكشن (السكان بيبدأ يكتب من بعدها).
create or replace function public.wh_count_apply(p_count_id bigint, p_counts jsonb,
                                                 p_go_live boolean default false, p_force boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '4s'
as $$
declare
  me record; c record; e jsonb; v_pid uuid; v_cnt int; v_cur int; v_name text; v_delta int;
  v_ids uuid[] := '{}'; v_changed int := 0; v_err text; v_missing int;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select x.* into c from stock_counts x where x.id = p_count_id and x.tenant_id = me.tenant_id for update;
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if c.applied_at is not null then return jsonb_build_object('ok', false, 'code', 'already_applied'); end if;
  if c.cancelled_at is not null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_qty');
  end if;
  for e in select * from jsonb_array_elements(p_counts) loop
    begin
      v_pid := (e ->> 'product_id')::uuid;
      v_cnt := (e ->> 'counted')::int;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'bad_qty');
    end;
    if v_pid is null or v_cnt is null or v_cnt < 0 or v_cnt > 1000000 or (e ->> 'counted') !~ '^\s*[0-9]+\s*$'
       or not exists (select 1 from stock_products p where p.id = v_pid and p.tenant_id = me.tenant_id) then
      return jsonb_build_object('ok', false, 'code', 'bad_qty', 'product_id', v_pid);
    end if;
    if v_pid = any(v_ids) then return jsonb_build_object('ok', false, 'code', 'bad_qty', 'product_id', v_pid); end if;
    v_ids := v_ids || v_pid;
  end loop;
  if coalesce(p_go_live, false) then
    select count(*) into v_missing from stock_products p
     where p.tenant_id = me.tenant_id and coalesce(p.active, true) and not (p.id = any(v_ids));
    if v_missing > 0 then return jsonb_build_object('ok', false, 'code', 'missing_lines', 'missing', v_missing); end if;
  end if;
  if not coalesce(p_force, false) and exists (
       select 1 from wh_scan_lines l join wh_scans s on s.id = l.scan_id
        where l.tenant_id = me.tenant_id and l.product_id = any(v_ids) and l.state = 'posted' and s.created_at > c.opened_at) then
    return jsonb_build_object('ok', false, 'code', 'scans_during_count');
  end if;
  begin
    perform 1 from stock_products p where p.id = any(v_ids) order by p.id for update;
    for e in select * from jsonb_array_elements(p_counts) loop
      v_pid := (e ->> 'product_id')::uuid; v_cnt := (e ->> 'counted')::int;
      select coalesce(p.current_qty, 0), p.name into v_cur, v_name from stock_products p where p.id = v_pid;
      v_delta := v_cnt - v_cur;
      insert into stock_count_lines (count_id, tenant_id, product_id, system_before, counted, delta)
      values (c.id, me.tenant_id, v_pid, v_cur, v_cnt, v_delta);
      if v_delta <> 0 then
        insert into stock_movements (tenant_id, product_id, product_name, movement_type, qty_in, qty_out, movement_date,
                                     notes, source, created_by_name)
        values (me.tenant_id, v_pid, v_name, case when v_delta > 0 then 'in' else 'out' end,
                greatest(v_delta, 0), greatest(-v_delta, 0), (now() at time zone 'Africa/Cairo')::date,
                '🧮 جرد · كان ' || v_cur || ' ← اتعدّ ' || v_cnt || ' · ' || me.name, 'count', me.name);
        v_changed := v_changed + 1;
      end if;
    end loop;
    update stock_counts set applied_at = now(), applied_by_name = me.name, go_live = coalesce(p_go_live, false) where id = c.id;
    if coalesce(p_go_live, false) then
      insert into wh_config (tenant_id, enabled, baseline_at, updated_at, updated_by_name)
      values (me.tenant_id, true, c.opened_at, now(), me.name)
      on conflict (tenant_id) do update
         set enabled = true, baseline_at = excluded.baseline_at, updated_at = now(), updated_by_name = me.name;
    end if;
  exception
    when lock_not_available then return jsonb_build_object('ok', false, 'code', 'busy');
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'sqlstate', v_err);
  end;
  return jsonb_build_object('ok', true, 'code', 'ok', 'count_id', c.id, 'lines', jsonb_array_length(p_counts),
                            'changed', v_changed, 'go_live', coalesce(p_go_live, false), 'baseline_at',
                            case when coalesce(p_go_live, false) then c.opened_at end);
end $$;

-- 9) تعديل كمية منتج من المحرر = حركة 'adjust' بسبب (بدل PATCH مباشر
-- مابيسيبش أثر — اتقاس: تعديلات 30 سبتمبر و7 أكتوبر من غير ولا حركة)
create or replace function public.wh_stock_adjust(p_product_id uuid, p_new_qty int, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare me record; v_cur int; v_name text; v_delta int; v_err text;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_new_qty is null or p_new_qty < 0 or p_new_qty > 1000000 then return jsonb_build_object('ok', false, 'code', 'bad_qty'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 2 then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  begin
    select coalesce(p.current_qty, 0), p.name into v_cur, v_name
      from stock_products p where p.id = p_product_id and p.tenant_id = me.tenant_id for update;
    if v_name is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    v_delta := p_new_qty - v_cur;
    if v_delta = 0 then return jsonb_build_object('ok', true, 'code', 'no_change', 'qty', v_cur); end if;
    insert into stock_movements (tenant_id, product_id, product_name, movement_type, qty_in, qty_out, movement_date,
                                 notes, source, created_by_name)
    values (me.tenant_id, p_product_id, v_name, case when v_delta > 0 then 'in' else 'out' end,
            greatest(v_delta, 0), greatest(-v_delta, 0), (now() at time zone 'Africa/Cairo')::date,
            left('✏️ تعديل · كان ' || v_cur || ' ← ' || p_new_qty || ' · ' || btrim(p_reason) || ' · ' || me.name, 300),
            'adjust', me.name);
  exception
    when lock_not_available then return jsonb_build_object('ok', false, 'code', 'busy');
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'sqlstate', v_err);
  end;
  return jsonb_build_object('ok', true, 'code', 'ok', 'qty', p_new_qty, 'delta', v_delta);
end $$;

-- 10) إعدادات: إيقاف/تشغيل (التشغيل محتاج baseline — يعني جرد اتطبّق) +
-- منع طلب الإلغاء
create or replace function public.wh_config_set(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare me record; cfg record; v_en boolean; v_hold boolean;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  insert into wh_config (tenant_id) values (me.tenant_id) on conflict (tenant_id) do nothing;
  select c.* into cfg from wh_config c where c.tenant_id = me.tenant_id for update;
  v_en := coalesce((p ->> 'enabled')::boolean, cfg.enabled);
  v_hold := coalesce((p ->> 'hold_cancel_requested')::boolean, cfg.hold_cancel_requested);
  if v_en and cfg.baseline_at is null then return jsonb_build_object('ok', false, 'code', 'needs_count'); end if;
  update wh_config set enabled = v_en, hold_cancel_requested = v_hold, updated_at = now(), updated_by_name = me.name
   where tenant_id = me.tenant_id;
  return jsonb_build_object('ok', true, 'code', 'ok', 'enabled', v_en, 'hold_cancel_requested', v_hold);
end $$;

-- الصلاحيات: الافتراضي بيدّي PUBLIC/anon تنفيذ — بنشيله ونمنح authenticated بس
do $g$
declare f text;
begin
  foreach f in array array[
    'public.wh_scan(text, uuid, text, text, text, text)',
    'public.wh_scan_order(uuid, text, uuid, text)',
    'public.wh_scan_undo(bigint, text)',
    'public.wh_lookup(text)',
    'public.wh_board(boolean)',
    'public.wh_items_unmapped(int)',
    'public.wh_alias_set(text, text, uuid, boolean, boolean, text)',
    'public.wh_repost_unmatched()',
    'public.wh_count_open(text)',
    'public.wh_count_cancel(bigint)',
    'public.wh_count_apply(bigint, jsonb, boolean, boolean)',
    'public.wh_stock_adjust(uuid, int, text)',
    'public.wh_config_set(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;
