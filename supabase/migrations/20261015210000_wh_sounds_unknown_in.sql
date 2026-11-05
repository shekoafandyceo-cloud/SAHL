-- v78 (15 أكتوبر مساءً — طلب المالك): أصوات السكانر بملفات يرفعها الأدمن + «المنتج اللي رجع» على بوليصة J&T مش في سهل
-- 🔴 السكانر **شغّال على الحي** (enabled=true من 15 أكتوبر 13:38 UTC) — كل دالة هنا create or replace / if not exists ·
--    مفيش DROP (درس 53) · wh_scan منسوخة من الحي بالحرف (md5 94f06423…) والتعديل في فرع «مش عندنا» بس.
--
-- 1) wh_config.sounds = {out|in|dup|unknown: {path, name, dur, at, by}} — مسار ملف WAV في wa-media تحت
--    <tenant>/wh-sounds/<slot>-<uuid>.wav (الأدمن بيقصّه ويحوّله في المتصفح). المفتاح الغايب = الصوت العادي.
--    الكتابة wh_sounds_set (أدمن بس · المسار لازم بتاع المتجر وبتاع الخانة نفسها · الملف لازم يكون اترفع فعلاً) — أي موظف
--    بيقدر يرفع في فولدر المتجر (سياسة wa-media) فالتحقق هنا مش في المتصفح.
-- 2) wh_unknown_in = بوليصة J&T مش متسجلة في سهل (استبدال اتعمل من داشبورد J&T — المالك): الموظف بيسجّل المنتج اللي رجع
--    (لأي موظف — حركات المخزون للأدمن بس غير كده). مرة واحدة لكل بوليصة (فهرس فريد + قفل) · لازم السكانر يكون قال
--    «مش عندنا» على نفس البوليصة آخر 24 ساعة · ≤ 5 منتجات × ≤ 5 قطع · وضع التجربة = النتيجة من غير كتابة (زي wh_scan) ·
--    بيتسجّل كسكان (wh_scans + wh_scan_lines + wh_post مصدر scan_in) فسجل النهارده والجرد بيشوفوه.
-- 3) wh_unknown_undo = التراجع (الأدمن أي وقت · صاحبه خلال 15 دقيقة) — wh_scan_undo بيرفض السكان اللي مالوش أوردر.
-- 4) wh_scan: البوليصة اتسجّل عليها يدوي = «unknown_already_in» (نبرة dup — «هبعتهولك برضو») مش «مش عندنا» تاني ·
--    ولو بقى ليها أوردر بعد التسجيل = «unknown_conflict» (وقّف — الأوردر كان هيضيف نفس القطعة مرة تانية).
-- 5) wh_unknown_list = قايمة التسجيلات دي (للأدمن في اللوحة).
--    (التسجيل بيتطلب سكان «مش عندنا» على نفس البوليصة آخر 24 ساعة — في التجربة السكان مابيتحفظش فالشرط ده بيتخطّى ·
--    التراجع: جرد اتطبّق بعد التسجيل = من غير حركة، نفس قاعدة wh_scan_undo للرجوع بالحرف)
set local lock_timeout = '4s';

alter table public.wh_config add column if not exists sounds jsonb not null default '{}'::jsonb;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'wh_config_sounds_obj' and conrelid = 'public.wh_config'::regclass) then
    alter table public.wh_config add constraint wh_config_sounds_obj check (jsonb_typeof(sounds) = 'object');
  end if;
end $c$;

create unique index if not exists wh_scans_unknown_in_once on public.wh_scans (tenant_id, tracking_no)
  where code = 'unknown_in' and reversed_at is null;

create or replace function public.wh_sounds_set(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  me record; k text; v jsonb; v_cur jsonb; v_path text; v_name text; v_dur numeric;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then return jsonb_build_object('ok', false, 'code', 'bad_args'); end if;
  insert into wh_config (tenant_id) values (me.tenant_id) on conflict (tenant_id) do nothing;
  select c.sounds into v_cur from wh_config c where c.tenant_id = me.tenant_id for update;
  v_cur := coalesce(v_cur, '{}'::jsonb);
  for k, v in select e.key, e.value from jsonb_each(p) e loop
    if k not in ('out', 'in', 'dup', 'unknown') then
      return jsonb_build_object('ok', false, 'code', 'bad_slot', 'slot', k);
    end if;
    if jsonb_typeof(v) = 'null' then
      v_cur := v_cur - k;
      continue;
    end if;
    if jsonb_typeof(v) <> 'object' then return jsonb_build_object('ok', false, 'code', 'bad_value', 'slot', k); end if;
    v_path := v ->> 'path';
    v_name := left(btrim(coalesce(v ->> 'name', '')), 80);
    v_dur := case when coalesce(v ->> 'dur', '') ~ '^[0-9]{1,2}(\.[0-9]{1,4})?$' then (v ->> 'dur')::numeric end;
    if v_path is null or v_path !~ ('^' || me.tenant_id::text || '/wh-sounds/' || k || '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.wav$') then
      return jsonb_build_object('ok', false, 'code', 'bad_path', 'slot', k);
    end if;
    if v_dur is null or v_dur < 0.1 or v_dur > 6 then return jsonb_build_object('ok', false, 'code', 'bad_dur', 'slot', k); end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'wa-media' and o.name = v_path) then
      return jsonb_build_object('ok', false, 'code', 'file_missing', 'slot', k);
    end if;
    v_cur := v_cur || jsonb_build_object(k, jsonb_build_object('path', v_path, 'name', v_name, 'dur', round(v_dur, 2),
                                                               'at', now(), 'by', me.name));
  end loop;
  update wh_config set sounds = v_cur where tenant_id = me.tenant_id;
  return jsonb_build_object('ok', true, 'code', 'ok', 'sounds', v_cur);
end $$;


create or replace function public.wh_unknown_in(p_code text, p_items jsonb, p_client_id uuid, p_note text default null)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; cfg record; v_dry boolean; v_code text; v_scan_id bigint; v_res jsonb; v_err text;
  it jsonb; v_pid uuid; v_q int; v_n int := 0; v_pids uuid[] := '{}'; p record; v_prev record;
begin
  select * into me from app.wh_me();
  if me.uid is null then
    return jsonb_build_object('ok', false, 'code', case when auth.uid() is null then 'not_authenticated' else 'not_allowed' end, 'tone', 'stop');
  end if;
  if p_client_id is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 5 then
    return jsonb_build_object('ok', false, 'code', 'bad_args', 'tone', 'stop');
  end if;
  for it in select e.value from jsonb_array_elements(p_items) e loop
    v_pid := case when coalesce(it ->> 'product_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then (it ->> 'product_id')::uuid end;
    v_q := case when coalesce(it ->> 'qty', '') ~ '^[0-9]{1,2}$' then (it ->> 'qty')::int end;
    if v_pid is null or v_q is null or v_q < 1 or v_q > 5 or v_pid = any(v_pids) then
      return jsonb_build_object('ok', false, 'code', 'bad_args', 'tone', 'stop');
    end if;
    if not exists (select 1 from stock_products sp where sp.id = v_pid and sp.tenant_id = me.tenant_id and coalesce(sp.active, true)) then
      return jsonb_build_object('ok', false, 'code', 'bad_product', 'tone', 'stop');
    end if;
    v_pids := v_pids || v_pid;
  end loop;
  select c.* into cfg from wh_config c where c.tenant_id = me.tenant_id;
  v_dry := not coalesce(cfg.enabled, false);
  if not v_dry then
    select s.result into v_res from wh_scans s where s.tenant_id = me.tenant_id and s.client_id = p_client_id;
    if found then return v_res || jsonb_build_object('replay', true); end if;
  end if;
  v_code := app.wh_code(p_code);
  if v_code is null or v_code not like 'JEG%' then
    return jsonb_build_object('ok', false, 'code', 'bad_code', 'tone', 'stop');
  end if;
  if exists (select 1 from orders x where x.tenant_id = me.tenant_id and x.tracking_no = v_code) then
    return jsonb_build_object('ok', false, 'code', 'has_order', 'tone', 'stop', 'tracking_no', v_code);
  end if;
  if not v_dry and not exists (select 1 from wh_scans s where s.tenant_id = me.tenant_id and s.tracking_no = v_code
                                  and s.code = 'not_found' and s.created_at > now() - interval '24 hours') then
    return jsonb_build_object('ok', false, 'code', 'scan_first', 'tone', 'stop', 'tracking_no', v_code);
  end if;
  begin
    perform pg_advisory_xact_lock(hashtextextended(me.tenant_id::text || ':wh_unknown:' || v_code, 0));
    select s.id, s.created_at, s.scanned_by_name into v_prev
      from wh_scans s
     where s.tenant_id = me.tenant_id and s.tracking_no = v_code and s.code = 'unknown_in' and s.reversed_at is null
     order by s.id desc limit 1;
    if v_prev.id is not null then
      return jsonb_build_object('ok', true, 'code', 'unknown_already_in', 'tone', 'dup', 'applied', false, 'tracking_no', v_code,
                                'prev', jsonb_build_object('scan_id', v_prev.id, 'at', v_prev.created_at, 'by', v_prev.scanned_by_name),
                                'lines', app.wh_scan_lines_json(v_prev.id), 'dry', v_dry);
    end if;
    insert into wh_scans (tenant_id, client_id, tracking_no, raw_code, dir, code, scanned_by, scanned_by_name, source, reason)
    values (me.tenant_id, p_client_id, v_code, left(coalesce(p_code, ''), 80), 'in', 'pending', me.uid, me.name, 'manual',
            left(nullif(btrim(coalesce(p_note, '')), ''), 300))
    on conflict (tenant_id, client_id) do nothing
    returning id into v_scan_id;
    if v_scan_id is null then
      select s.result into v_res from wh_scans s where s.tenant_id = me.tenant_id and s.client_id = p_client_id;
      return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('replay', true);
    end if;
    for it in select e.value from jsonb_array_elements(p_items) e loop
      select sp.id, sp.name,
             exists (select 1 from stock_products c where c.parent_id = sp.id and coalesce(c.active, true)) as fam
        into p from stock_products sp where sp.id = (it ->> 'product_id')::uuid;
      v_n := v_n + 1;
      insert into wh_scan_lines (tenant_id, scan_id, dir, line_no, line_text, item_key, qty, product_id, matched_by, state, note)
      values (me.tenant_id, v_scan_id, 'in', v_n, p.name, app.wh_key(p.name), (it ->> 'qty')::int, p.id,
              case when p.fam then 'unallocated' end, 'posted', 'بوليصة J&T مش في سهل — اتسجّل يدوي');
    end loop;
    perform app.wh_post(v_scan_id, 'scan_in', me.name, '↩️ مرتجع J&T مش متسجّل في سهل · ' || v_code || ' · ' || me.name);
    v_res := jsonb_build_object('ok', true, 'code', 'unknown_in', 'tone', 'in', 'applied', true, 'dir', 'in',
                                'scan_id', v_scan_id, 'tracking_no', v_code, 'lines', app.wh_scan_lines_json(v_scan_id),
                                'warnings', '[]'::jsonb, 'by', me.name);
    update wh_scans set code = 'unknown_in', applied = true, result = v_res where id = v_scan_id;
    if v_dry then
      raise exception using errcode = 'WHD01', message = 'wh_dry';
    end if;
  exception
    when sqlstate 'WHD01' then
      v_res := v_res || jsonb_build_object('dry', true);
    when lock_not_available or deadlock_detected or serialization_failure or unique_violation then
      return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn', 'dry', v_dry);
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err, 'dry', v_dry);
  end;
  return v_res || jsonb_build_object('dry', v_dry);
end $$;

create or replace function public.wh_unknown_undo(p_scan_id bigint, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; s record; v_new bigint; v_res jsonb; v_err text;
begin
  select * into me from app.wh_me();
  if me.uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed', 'tone', 'stop'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'tone', 'stop');
  end if;
  begin
    select x.* into s from wh_scans x where x.id = p_scan_id and x.tenant_id = me.tenant_id for update;
    if s.id is null then return jsonb_build_object('ok', false, 'code', 'not_found', 'tone', 'stop'); end if;
    if s.code <> 'unknown_in' or not s.applied then
      return jsonb_build_object('ok', false, 'code', 'nothing_applied', 'tone', 'stop');
    end if;
    if not me.is_admin and (s.scanned_by <> me.uid or s.created_at < now() - interval '15 minutes') then
      return jsonb_build_object('ok', false, 'code', 'too_old', 'tone', 'stop');
    end if;
    if s.reversed_at is not null then return jsonb_build_object('ok', false, 'code', 'already_reversed', 'tone', 'dup'); end if;
    perform pg_advisory_xact_lock(hashtextextended(me.tenant_id::text || ':wh_unknown:' || coalesce(s.tracking_no, ''), 0));
    insert into wh_scans (tenant_id, client_id, tracking_no, dir, code, scanned_by, scanned_by_name, source, reason, reverses_scan_id)
    values (me.tenant_id, gen_random_uuid(), s.tracking_no, 'undo', 'pending', me.uid, me.name, 'undo', left(btrim(p_reason), 300), s.id)
    returning id into v_new;
    perform app.wh_mirror_lines(v_new, s.id, 'out', 'اتلغى بالتراجع');
    update wh_scan_lines l
       set state = 'superseded', note = 'اتعدّ في جرد بعد التسجيل — التراجع من غير حركة', resolved_at = now(), resolved_by_name = me.name
     where l.scan_id = v_new and l.state = 'posted' and l.movement_id is null and l.product_id is not null
       and exists (select 1 from stock_count_lines cl join stock_counts k on k.id = cl.count_id
                    where cl.product_id = l.product_id and k.tenant_id = me.tenant_id and k.applied_at is not null
                      and k.applied_at > s.created_at);
    update wh_scan_lines set state = 'reversed', resolved_at = now(), resolved_by_name = me.name
     where scan_id = s.id and state in ('posted', 'superseded');
    perform app.wh_post(v_new, 'undo', me.name, '↶ تراجع · مرتجع من غير أوردر · ' || coalesce(s.tracking_no, '') || ' · ' || me.name);
    update wh_scans set reversed_at = now(), reversed_by_name = me.name, reversed_by_scan_id = v_new where id = s.id;
    v_res := jsonb_build_object('ok', true, 'code', 'undone', 'tone', 'warn', 'applied', true, 'scan_id', v_new,
                                'reverses', s.id, 'tracking_no', s.tracking_no, 'lines', app.wh_scan_lines_json(v_new));
    update wh_scans set code = 'undone', applied = true, result = v_res where id = v_new;
  exception
    when lock_not_available or deadlock_detected or serialization_failure then
      return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn');
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err);
  end;
  return v_res;
end $$;

create or replace function public.wh_unknown_list(p_days int default 30)
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare me record;
begin
  select * into me from app.wh_me();
  if me.uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 't', s.tracking_no, 'at', s.created_at, 'by', s.scanned_by_name,
                                        'note', s.reason, 'lines', app.wh_scan_lines_json(s.id),
                                        'reversed', s.reversed_at is not null, 'reversed_by', s.reversed_by_name,
                                        'mine', s.scanned_by = me.uid) order by s.id desc)
      from (select * from wh_scans x
             where x.tenant_id = me.tenant_id and x.code = 'unknown_in'
               and x.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
             order by x.id desc limit 200) s), '[]'::jsonb));
end $$;

revoke all on function public.wh_sounds_set(jsonb) from public, anon;
revoke all on function public.wh_unknown_in(text, jsonb, uuid, text) from public, anon;
revoke all on function public.wh_unknown_undo(bigint, text) from public, anon;
revoke all on function public.wh_unknown_list(int) from public, anon;
grant execute on function public.wh_sounds_set(jsonb) to authenticated;
grant execute on function public.wh_unknown_in(text, jsonb, uuid, text) to authenticated;
grant execute on function public.wh_unknown_undo(bigint, text) to authenticated;
grant execute on function public.wh_unknown_list(int) to authenticated;

create or replace function public.wh_scan(p_code text, p_client_id uuid, p_force text default null,
                                          p_reason text default null, p_station text default null,
                                          p_source text default 'scanner')
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; cfg record; v_dry boolean; v_code text; v_digits text; v_scan_id bigint;
  v_res jsonb; v_err text; v_state text; v_oid uuid; v_cnt int; v_unk record;
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
      -- (v78) بوليصة J&T مش في سهل واتسجّل عليها «المنتج اللي رجع» يدوي (wh_unknown_in) = اتضربت قبل كده (نبرة dup)
      -- مش «مش عندنا» تاني · ولو بقى ليها أوردر بعد التسجيل = وقّف (الأوردر كان هيضيف نفس القطعة مرة تانية)
      select s.id, s.created_at, s.scanned_by_name into v_unk
        from wh_scans s
       where s.tenant_id = me.tenant_id and s.tracking_no = v_code and s.code = 'unknown_in' and s.reversed_at is null
       order by s.id desc limit 1;
      if v_oid is null and v_unk.id is not null then
        v_res := jsonb_build_object('ok', true, 'code', 'unknown_already_in', 'tone', 'dup', 'applied', false,
                                    'scan_id', v_scan_id, 'tracking_no', v_code,
                                    'prev', jsonb_build_object('scan_id', v_unk.id, 'at', v_unk.created_at, 'by', v_unk.scanned_by_name),
                                    'lines', app.wh_scan_lines_json(v_unk.id));
        update wh_scans set code = 'unknown_already_in', tracking_no = v_code, result = v_res where id = v_scan_id;
      elsif v_oid is null then
        v_res := jsonb_build_object('ok', true, 'code', 'not_found', 'tone', 'stop', 'applied', false,
                                    'scan_id', v_scan_id, 'tracking_no', v_code);
        update wh_scans set code = 'not_found', tracking_no = v_code, result = v_res where id = v_scan_id;
      elsif v_unk.id is not null then
        v_res := jsonb_build_object('ok', true, 'code', 'unknown_conflict', 'tone', 'stop', 'applied', false,
                                    'scan_id', v_scan_id, 'tracking_no', v_code,
                                    'prev', jsonb_build_object('scan_id', v_unk.id, 'at', v_unk.created_at, 'by', v_unk.scanned_by_name),
                                    'order', app.wh_order_brief(v_oid));
        update wh_scans set code = 'unknown_conflict', tracking_no = v_code, result = v_res where id = v_scan_id;
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
    when lock_not_available or deadlock_detected or serialization_failure then
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
