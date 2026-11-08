-- eo_rate_pull_review_fixes (8 أكتوبر) — من المراجعة العدائية لسحب نسبة الاستلام (Workflow — 6 مؤكد من 11 = 3 مشاكل).
--
-- 1) عطل مؤقت عند EasyOrders (5xx · timeout · رد مش JSON) كان بيستهلك الـ5 محاولات في ~40 دقيقة، والأوردر يفضل
--    من غير تقييم للأبد رغم إن نافذة الـ24 ساعة لسه مفتوحة. → المحاولات دي **مابتتعدّش** (last_at بس — الـ10 دقايق
--    بين المحاولات والـ24 ساعة لسه بيحدّوها: أقصى 144 محاولة للأوردر طول ما EasyOrders واقعة). اللي بيتعدّ:
--    no_rating · still_pending · not_found · short_id_mismatch · no_meta · http_4xx.
--    (والـEdge Function v2 بتقف بعد 3 أعطال ورا بعض وبتسجّل التشغيل ok=false — دليل الحياة بقى بيقول الحقيقة.)
-- 2) التقييم بيتطابق على التليفون **الحالي** — الموظف عدّل الرقم قبل السحب = المفتاح عند EasyOrders (الرقم الأصلي)
--    مابيطابقش والتقييم مايظهرش. → لو الأساسي والإضافي الاتنين مالقوش مفتاح، وفيه **مفتاح تليفون واحد بس** في الخام،
--    يبقى ده بتاع الأساسي (EasyOrders بتقيّم الأساسي دايماً والإضافي لو موجود). مفتاحين ومحدش طابق = مفيش تخمين.
--    + في الـUPDATE: الخام اتغيّر والحساب الجديد طلع فاضي = القيمة القديمة بتفضل (التليفون اتعدّل بعد التقييم
--    وجه خام تاني — كان بيمسح التقييم). الخام نفسه اتمسح (NULL) = التقييم بيتمسح معاه.
-- 🔴 مفيش أي أمر حذف هنا (درس 53). والتريجر لسه مستحيل يوقّع الإدخال (كله جوّه exception block).

set local lock_timeout = '4s';

-- ── 1) مفتاح التليفون الوحيد في الخام ──────────────────────────────────────
create or replace function app.eo_rate_single(p_meta jsonb)
returns text language plpgsql immutable set search_path to 'pg_catalog'
as $fn$
declare k text; n int := 0; kk text;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then return null; end if;
  for k in select jsonb_object_keys(p_meta) loop
    if jsonb_typeof(p_meta -> k) = 'object'
       and length(regexp_replace(translate(k, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g')) >= 10 then
      n := n + 1; kk := k;
    end if;
  end loop;
  if n <> 1 then return null; end if;
  return app.eo_rate_of(p_meta, kk);
end $fn$;
revoke all on function app.eo_rate_single(jsonb) from public, anon, authenticated;

-- ── 2) التريجر: fallback للمفتاح الوحيد + الحساب الفاضي مابيمسحش القديم ─────────
create or replace function app.eo_rate_capture()
 returns trigger language plpgsql security definer set search_path to 'public', 'app', 'pg_temp'
as $fn$
declare i int;
begin
  if tg_op = 'UPDATE' and new.eo_metadata is not distinct from old.eo_metadata then
    new.eo_rate := old.eo_rate; new.eo_rate_alt := old.eo_rate_alt; return new;
  end if;
  begin
    for i in 1..2 loop
      exit when new.eo_metadata is null or jsonb_typeof(new.eo_metadata) <> 'string';
      new.eo_metadata := nullif(btrim(new.eo_metadata #>> '{}'), '')::jsonb;
    end loop;
    if new.eo_metadata is not null and jsonb_typeof(new.eo_metadata) = 'null' then new.eo_metadata := null; end if;
    new.eo_rate := app.eo_rate_of(new.eo_metadata, new.phone);
    new.eo_rate_alt := app.eo_rate_of(new.eo_metadata, new.alt_phone);
    -- التليفون اتعدّل قبل السحب؟ مفتاح واحد بس ومحدش طابق = بتاع الأساسي
    if new.eo_rate is null and new.eo_rate_alt is null then
      new.eo_rate := app.eo_rate_single(new.eo_metadata);
    end if;
    -- خام جديد وحسابه فاضي (التليفون اتعدّل بعد التقييم) = القديم بيفضل · الخام اتمسح = التقييم يتمسح
    if tg_op = 'UPDATE' and new.eo_metadata is not null then
      new.eo_rate := coalesce(new.eo_rate, old.eo_rate);
      new.eo_rate_alt := coalesce(new.eo_rate_alt, old.eo_rate_alt);
    end if;
  exception when others then
    if tg_op = 'UPDATE' then new.eo_rate := old.eo_rate; new.eo_rate_alt := old.eo_rate_alt;
    else new.eo_rate := null; new.eo_rate_alt := null; end if;
  end;
  return new;
end $fn$;

-- ── 3) المحاولة الفاشلة من عطل مؤقت مابتتعدّش ───────────────────────────────
create or replace function public.eo_rate_apply_v1(p_order_id uuid, p_meta jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, app
as $fn$
declare v_old jsonb; v_new jsonb; v_old_rate text; v_old_alt text; v_rate text; v_alt text; v_note text;
        v_transient boolean := false;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    v_note := coalesce(nullif(btrim(p_note), ''), 'no_meta');
    -- عطل عند EasyOrders مش رد عن الأوردر — مايستهلكش محاولة (الـ10 دقايق والـ24 ساعة بيحدّوه)
    v_transient := v_note in ('fetch_error', 'bad_json') or v_note ~ '^http_5[0-9][0-9]$';
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
  values (p_order_id, case when v_transient then 0 else 1 end, now(), left(v_note, 80))
  on conflict (order_id) do update
    set checks = public.eo_rate_checks.checks + case when v_transient then 0 else 1 end,
        last_at = now(), last_note = excluded.last_note;
  return jsonb_build_object('ok', true, 'note', v_note, 'eo_rate', v_rate, 'eo_rate_alt', v_alt, 'counted', not v_transient);
end $fn$;
revoke all on function public.eo_rate_apply_v1(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.eo_rate_apply_v1(uuid, jsonb, text) to service_role;
