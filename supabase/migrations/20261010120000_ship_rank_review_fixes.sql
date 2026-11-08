-- ship_rank_review_fixes (10 أكتوبر) — إصلاحات المراجعة العدائية لسحب نسبة استلام شركة الشحن (Workflow · 23 ملاحظة → 16 مؤكدة).
--
-- 1) app.ship_rank_p10 أضيق: موبايل مصري بس بصيغه المعروفة (1x · 01x · 201x · 2001x · 00201x — والتالت 0/1/2/5).
--    القديمة كانت بتاخد آخر 10 أرقام من أي حاجة: «011234567890» (رقم زيادة) → رقم واحد تاني، و«+971501234567» (إمارات) →
--    «1501234567» = نسبة شخص غريب على الأوردر. اتقاس 60 يوم: الجديدة بترفض 3 أساسي + 7 إضافي (كلهم شكلهم بايظ:
--    رقمين لازقين · 12–13 رقم) ومابتغيّرش ولا رقم سليم (0 اتقبل جديد · 0 اتغيّر).
-- 2) app.ship_rank_part: العدّ بيتقبل رقم أو نص رقمي ("3") — وصف من غير أي عدّ مفهوم = `bad_row` → **مفيش كتابة** (الأوردر
--    يفضل مرشّح والتشغيل بيتسجّل غلط) بدل ما يتعلّم «عميل جديد» للأبد لو بوسطة غيّرت شكل الرد (الـendpoint مش موثّق).
-- 3) ship_rank_apply_v1: `rated` لو الأساسي **أو** الإضافي ليه شحنات · `unknown_checks` في الخام (الاتنين مش معروفين = +1).
-- 4) ship_rank_candidates_v1:
--    • اللي ماتسألش: آخر 72 ساعة (كانت 24) — عطل بوسطة أو وقفة الـcron لحد 3 أيام مابيسيبش فجوة دايمة.
--    • التليفون اتعدّل بعد السؤال: أي أوردر من آخر 30 يوم (كانت 24 ساعة بس — التعديل يوم 2 كان بيسيب نسبة الرقم القديم).
--    • «عميل جديد» عند الرقمين: بيتسأل مرة تانية بعد 30 دقيقة (unknown_checks = 1) — رد فاضي مؤقت من بوسطة مايثبتش.
--    • اللي ماتسألش الأول (قبل إعادة السؤال).
-- 5) jt_sync_health (البانر الأحمر للأدمن): + `rank_stale` (أوردرات ماتسألتش لشركة الشحن بقالها > 15 دقيقة) و`rank_last_error` ·
--    + `eo_stale` (أوردرات EasyOrders ماتحاولش تتسحب بقالها > 15 دقيقة) — قبل كده لو السحب وقف (مفتاح · cron · بوسطة)
--    محدش كان هيعرف (درس 51: شبكة أمان بتقع في صمت أخطر من مفيش شبكة).
-- 🔴 مفيش أي أمر حذف (درس 53). اتجرّب بترانزاكشن راجعة الأول.

set local lock_timeout = '4s';

-- ── 1) تطبيع الرقم ─────────────────────────────────────────────────────────
create or replace function app.ship_rank_p10(p text)
returns text language sql immutable set search_path = pg_catalog
as $$
  select case
    when d ~ '^1[0125][0-9]{8}$'      then d
    when d ~ '^01[0125][0-9]{8}$'     then substr(d, 2)
    when d ~ '^201[0125][0-9]{8}$'    then substr(d, 3)
    when d ~ '^2001[0125][0-9]{8}$'   then substr(d, 4)
    when d ~ '^00201[0125][0-9]{8}$'  then substr(d, 5)
  end
  from (select regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
                              '[^0-9]', '', 'g') as d) s;
$$;
revoke all on function app.ship_rank_p10(text) from public, anon, authenticated;
grant execute on function app.ship_rank_p10(text) to service_role;

-- ── 2) قراية عدّ من صف بوسطة: رقم أو نص رقمي — غير كده NULL ────────────────
create or replace function app.ship_rank_cnt(v jsonb)
returns int language sql immutable set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(v) = 'number' then greatest(0, floor((v #>> '{}')::numeric))::int
    when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then greatest(0, floor(btrim(v #>> '{}')::numeric))::int
  end;
$$;
revoke all on function app.ship_rank_cnt(jsonb) from public, anon, authenticated;

create or replace function app.ship_rank_part(p_phone10 text, p_row jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, app
as $$
declare d int; r int; rate numeric;
begin
  if p_phone10 is null then return null; end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('phone10', p_phone10, 'found', false, 'delivered', 0, 'returned', 0, 'rate', null);
  end if;
  d := app.ship_rank_cnt(p_row -> 'deliveredDeliveriesCount');
  r := app.ship_rank_cnt(p_row -> 'returnedDeliveriesCount');
  -- صف رجع بس مفيش ولا عدّ مفهوم = بوسطة غيّرت الشكل → مانكتبش «جديد» (الدالة اللي فوق بتوقف الأوردر ده)
  if d is null and r is null then
    return jsonb_build_object('phone10', p_phone10, 'found', true, 'bad_row', true);
  end if;
  d := coalesce(d, 0); r := coalesce(r, 0);
  -- النسبة من العدّ نفسه (نفس معادلتهم — اتقاست على 48 صف) — والـ`deliverySuccessRate` بتاعهم بيتحفظ جنبها في الخام
  rate := case when d + r > 0 then round(100.0 * d / (d + r), 2) end;
  return jsonb_build_object('phone10', p_phone10, 'found', true, 'delivered', d, 'returned', r, 'rate', rate,
                            'bosta_rate', case when jsonb_typeof(p_row -> 'deliverySuccessRate') = 'number' then p_row -> 'deliverySuccessRate' end);
end $$;
revoke all on function app.ship_rank_part(text, jsonb) from public, anon, authenticated;

-- ── 3) التطبيق ───────────────────────────────────────────────────────────
create or replace function public.ship_rank_apply_v1(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public, app
as $$
declare it jsonb; v_id uuid; v_p10 text; v_alt10 text; c_p10 text; c_alt10 text; c_raw jsonb; pr jsonb; al jsonb;
        pn int; an int; unk int; tally jsonb := '{}'::jsonb; note text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('ok', false, 'note', 'bad_items'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_id := (it ->> 'order_id')::uuid;
      v_p10 := nullif(it ->> 'p10', '');
      v_alt10 := nullif(it ->> 'alt10', '');
      select app.ship_rank_p10(o.phone), app.ship_rank_p10(o.alt_phone), o.ship_rank_raw into c_p10, c_alt10, c_raw
        from public.orders o where o.id = v_id for update;
      if not found then note := 'order_not_found';
      elsif c_p10 is distinct from v_p10 or c_alt10 is distinct from v_alt10 then note := 'phone_changed';
      else
        pr := app.ship_rank_part(v_p10, it -> 'primary');
        al := case when v_alt10 is null then null
                   when v_alt10 = v_p10 then pr
                   else app.ship_rank_part(v_alt10, it -> 'alt') end;
        if coalesce((pr ->> 'bad_row')::boolean, false) or coalesce((al ->> 'bad_row')::boolean, false) then
          note := 'bad_row';   -- مفيش كتابة: ship_rank_at بيفضل زي ما هو والأوردر بيتسأل تاني
        else
          pn := (pr ->> 'delivered')::int + (pr ->> 'returned')::int;
          an := case when al is null then null else (al ->> 'delivered')::int + (al ->> 'returned')::int end;
          unk := case when pn = 0 and coalesce(an, 0) = 0
                      then coalesce((c_raw ->> 'unknown_checks')::int, 0) + 1 else 0 end;
          update public.orders
             set ship_rank = (pr ->> 'rate')::numeric,
                 ship_rank_n = pn,
                 ship_rank_alt = (al ->> 'rate')::numeric,
                 ship_rank_alt_n = an,
                 ship_rank_at = now(),
                 ship_rank_raw = jsonb_build_object('at', now(), 'primary', pr, 'alt', al, 'unknown_checks', unk)
           where id = v_id;
          note := case when pn > 0 or coalesce(an, 0) > 0 then 'rated' else 'new_customer' end;
        end if;
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

-- ── 4) المرشّحين ─────────────────────────────────────────────────────────
create or replace function public.ship_rank_candidates_v1(p_limit int default 25, p_uids text[] default null)
returns table(order_id uuid, tenant_id uuid, order_uid text, p10 text, alt10 text)
language sql stable security definer set search_path = public, app, vault
as $$
  select o.id, o.tenant_id, o.order_uid, app.ship_rank_p10(o.phone), app.ship_rank_p10(o.alt_phone)
  from public.orders o
  where o.tenant_id in (select substr(s.name, 16)::uuid from vault.secrets s where s.name ~ '^bosta_rank_key:[0-9a-f-]{36}$')
    and app.ship_rank_p10(o.phone) is not null
    and (case when p_uids is not null then o.order_uid = any(p_uids)
              else
                -- ماتسألش لسه (آخر 3 أيام)
                (o.ship_rank_at is null and o.created_at >= now() - interval '72 hours')
                -- التليفون اتعدّل بعد السؤال (آخر 30 يوم)
                or (o.ship_rank_at < now() - interval '2 minutes' and o.created_at >= now() - interval '30 days'
                    and (coalesce(o.ship_rank_raw #>> '{primary,phone10}', '') <> app.ship_rank_p10(o.phone)
                         or coalesce(o.ship_rank_raw #>> '{alt,phone10}', '') <> coalesce(app.ship_rank_p10(o.alt_phone), '')))
                -- «جديد» عند الرقمين: سؤال تاني بعد 30 دقيقة (مرة واحدة)
                or (o.ship_rank_at < now() - interval '30 minutes' and o.created_at >= now() - interval '24 hours'
                    and coalesce((o.ship_rank_raw ->> 'unknown_checks')::int, 0) = 1)
         end)
  order by (o.ship_rank_at is null) desc, o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 25));
$$;
revoke all on function public.ship_rank_candidates_v1(int, text[]) from public, anon, authenticated;
grant execute on function public.ship_rank_candidates_v1(int, text[]) to service_role;

-- ── 5) دليل الحياة في البانر الموجود ─────────────────────────────────────
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
  ) end;
$function$;
revoke all on function public.jt_sync_health() from public, anon;
grant execute on function public.jt_sync_health() to authenticated, service_role;

notify pgrst, 'reload schema';
