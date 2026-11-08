-- سكانر المخزن — إصلاحات المراجعة العدائية (14 أكتوبر · Workflow 4 عدسات + محقق لكل عدسة: 29 ملاحظة مؤكدة)
-- الجداول كانت فاضية وقت التطبيق (وضع تجربة = مفيش كتابة) فمفيش نقل داتا.
--
--  1) المرتجع/السحب من الكومة بينقل السطور المعلّقة (unmatched/ignored) كسطور «رجوع» معلّقة بدل ما يلغيها،
--     والسطر اللي اتغطّى بجرد (superseded) بيرجع كإضافة — الجرد كان شال القطعة من الحساب. الزوج (خروج/رجوع)
--     بيتحل مع بعض لما المنتج يتربط (wh_repost) فالصافي صح في كل الحالات. التراجع بس هو اللي بيلغي المعلّق.
--  2) أي سكان بعد ما الطرد رجع = «already_in» (مفيش خصم تاني ولا سحب من الكومة تاني) — حتى خصم الأدمن.
--  3) الموظف مايقدرش يفرض «مرتجع» على طرد J&T عمرها ما استلمته (كان بيعدّي لو الطرد اتضرب خروج).
--  4) أول مسح J&T = وقت المسح نفسه (app.jt_bill_scans) مش وقت وصول الـpush (التأخير الوسيط 3.6 دقيقة) —
--     طرد استلمه المندوب قبل فتح جرد التشغيل بدقايق كان هيتحسب «خرج من غير سكان».
--  5) الأقفال: FOR NO KEY UPDATE على المنتجات (FOR UPDATE كان بيتقفل مع KEY SHARE بتاع الـFK = deadlock بين
--     سكانرين) · التراجع بيقفل الأوردر قبل السكان · wh_repost بيقفل الأوردر قبل السطر (نفس ترتيب wh_core) ·
--     المرآة بتقفل سطور المصدر قبل ما تقراها · deadlock/serialization = «busy» من غير ما تتسجّل نتيجة نهائية.
--  6) جرد: الأقفال قبل فحص «سكانات أثناء الجرد» · الفحص بيشمل السطور المعلّقة · سطر اتعمل قبل تطبيق الجرد
--     (applied_at) = superseded لما يتربط.
--  7) ربط اسم بخاصية (بنت) على مستوى الاسم: لو خاصية الأوردر بتطابق أخت تانية، الأخت هي اللي بتتخصم.
--  8) wh_repost بيعيد حل السطور المتجاهَلة كمان (تجاهل اتغيّر لربط).
--  9) wh_stock_adjust بقى فيه p_expected_qty: الرقم اتغيّر وانت فاتح المحرر = «stale» (كان بيمسح خصم السكانر).
-- 10) الكمية في product_name مابتوقّعش القراية لو رقمها ضخم (999 سقف قبل الـcast).

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
    v_qtys  := v_qtys  || case when length(ltrim(m[2], '0')) > 3 then 999
                               else greatest(1, coalesce(nullif(ltrim(m[2], '0'), '')::int, 1)) end;
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

create or replace function app.wh_resolve(p_tenant uuid, p_item text, p_props text, p_var text,
  out product_id uuid, out matched_by text, out state text)
language plpgsql stable
set search_path = public, app, pg_temp
as $$
declare
  v_pid uuid; v_ign boolean; v_cnt int; v_child uuid; v_found boolean := false; v_par uuid;
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
    select c.parent_id into v_par from stock_products c where c.id = v_pid;
    if v_par is not null then
      select c.id into v_child
        from stock_products c
       where c.parent_id = v_par and coalesce(c.active, true) and c.id <> v_pid
         and app.wh_props_key(c.variant_label) is not null
         and app.wh_props_key(c.variant_label) in (nullif(p_var, ''), nullif(p_props, ''))
       order by (app.wh_props_key(c.variant_label) = nullif(p_var, '')) desc nulls last, c.id
       limit 1;
      if v_child is not null then product_id := v_child; matched_by := 'child_label';
      else product_id := v_pid; end if;
      state := 'posted';
      return;
    end if;
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
   order by sp.id for no key update;
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

create or replace function app.wh_mirror_lines(p_new_scan bigint, p_src_scan bigint, p_dir text, p_note text)
returns void language plpgsql
set search_path = public, app, pg_temp
as $$
declare v_undo boolean;
begin
  select s.source = 'undo' into v_undo from wh_scans s where s.id = p_new_scan;
  perform 1 from wh_scan_lines l where l.scan_id = p_src_scan order by l.id for update;
  if coalesce(v_undo, false) then
    update wh_scan_lines l
       set state = 'void', note = p_note, resolved_at = now()
     where l.scan_id = p_src_scan and l.state in ('unmatched', 'ignored');
    insert into wh_scan_lines (tenant_id, scan_id, order_id, dir, line_no, line_text, item_key, props_key, var_key,
                               qty, product_id, matched_by, state)
    select l.tenant_id, p_new_scan, l.order_id, p_dir, l.line_no, l.line_text, l.item_key, l.props_key, l.var_key,
           l.qty, l.product_id, 'mirror', 'posted'
      from wh_scan_lines l
     where l.scan_id = p_src_scan and l.state = 'posted' and l.movement_id is not null and l.product_id is not null;
  else
    insert into wh_scan_lines (tenant_id, scan_id, order_id, dir, line_no, line_text, item_key, props_key, var_key,
                               qty, product_id, matched_by, state, note)
    select l.tenant_id, p_new_scan, l.order_id, p_dir, l.line_no, l.line_text, l.item_key, l.props_key, l.var_key,
           l.qty,
           case when l.state in ('posted', 'superseded') then l.product_id end,
           case when l.state in ('posted', 'superseded') then 'mirror' end,
           case when l.state in ('posted', 'superseded') then 'posted' else l.state end,
           case when l.state = 'superseded' then 'الخروج اتغطّى بجرد — الرجوع بيتضاف' end
      from wh_scan_lines l
     where l.scan_id = p_src_scan
       and ((l.state = 'posted' and l.movement_id is not null and l.product_id is not null)
            or (l.state = 'superseded' and l.product_id is not null)
            or l.state in ('unmatched', 'ignored'));
  end if;
end $$;

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
    select min(coalesce(s.t, s.rx)) into v_jt_first
      from app.jt_bill_scans(o.id, o.tenant_id, o.tracking_no) s;
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
  elsif v_has_in then
    v_code := 'already_in';
    v_prev := jsonb_build_object('at', st.in_at, 'by', st.in_by_name);
  elsif (v_return_ev and p_force is distinct from 'out') or p_force = 'in' then
    if p_force = 'in' and not v_return_ev and v_jt_first is null and p_mode <> 'admin' then
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
    when lock_not_available or deadlock_detected or serialization_failure then return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn', 'dry', v_dry);
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      v_res := jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err, 'dry', v_dry);
  end;
  return v_res || jsonb_build_object('dry', v_dry);
end $$;

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
    perform 1 from orders x
     where x.id = (select y.order_id from wh_scans y where y.id = p_scan_id and y.tenant_id = me.tenant_id)
     for update;
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
     where scan_id = s.id and state in ('posted', 'superseded');
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
    when lock_not_available or deadlock_detected or serialization_failure then return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn');
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err);
  end;
  return v_res;
end $$;

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
           (select min(coalesce(j.t, j.rx)) from app.jt_bill_scans(x.id, x.tenant_id, x.tracking_no) j) as jt_first
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

create or replace function app.wh_repost(p_tenant uuid, p_item text, p_by text)
returns jsonb language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  c record; l record; r record; v_rep int := 0; v_sup int := 0; v_void int := 0; v_scans bigint[] := '{}'; v_sid bigint;
begin
  for c in
    select x.id, x.order_id from wh_scan_lines x
     where x.tenant_id = p_tenant and x.state in ('unmatched', 'ignored') and (p_item is null or x.item_key = p_item)
     order by x.order_id, x.id
  loop
    if c.order_id is not null then
      perform 1 from orders o where o.id = c.order_id for update;
    end if;
    select x.* into l from wh_scan_lines x where x.id = c.id and x.state in ('unmatched', 'ignored') for update;
    if l.id is null then continue; end if;
    select * into r from app.wh_resolve(p_tenant, l.item_key, l.props_key, l.var_key);
    if r.state = l.state then continue; end if;
    if r.state = 'unmatched' then
      update wh_scan_lines set state = 'unmatched', matched_by = null, product_id = null, resolved_at = now(), resolved_by_name = p_by where id = l.id;
      continue;
    end if;
    if r.state = 'ignored' then
      update wh_scan_lines set state = 'ignored', matched_by = r.matched_by, product_id = null, resolved_at = now(), resolved_by_name = p_by where id = l.id;
      continue;
    end if;
    if exists (select 1 from stock_count_lines cl join stock_counts k on k.id = cl.count_id
                where cl.product_id = r.product_id and k.applied_at is not null and k.applied_at > l.created_at) then
      update wh_scan_lines set state = 'superseded', product_id = r.product_id, matched_by = r.matched_by,
             note = 'المنتج اتعدّ في جرد بعد السكان', resolved_at = now(), resolved_by_name = p_by where id = l.id;
      v_sup := v_sup + 1; continue;
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

create or replace function public.wh_count_apply(p_count_id bigint, p_counts jsonb,
                                                 p_go_live boolean default false, p_force boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '4s'
as $$
declare
  me record; c record; e jsonb; v_pid uuid; v_cnt int; v_cur int; v_name text; v_delta int;
  v_ids uuid[] := '{}'; v_changed int := 0; v_err text; v_missing int; v_dur_posted int; v_dur_unm int;
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
  begin
    perform 1 from stock_products p where p.id = any(v_ids) order by p.id for no key update;
    if not coalesce(p_force, false) then
      select count(*) filter (where l.state = 'posted' and l.product_id = any(v_ids)),
             count(*) filter (where l.state in ('unmatched', 'ignored'))
        into v_dur_posted, v_dur_unm
        from wh_scan_lines l join wh_scans s on s.id = l.scan_id
       where l.tenant_id = me.tenant_id and s.created_at > c.opened_at and s.reversed_at is null;
      if v_dur_posted > 0 or v_dur_unm > 0 then
        return jsonb_build_object('ok', false, 'code', 'scans_during_count', 'posted', v_dur_posted, 'unmatched', v_dur_unm);
      end if;
    end if;
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

create or replace function public.wh_stock_adjust(p_product_id uuid, p_new_qty int, p_reason text, p_expected_qty int)
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
      from stock_products p where p.id = p_product_id and p.tenant_id = me.tenant_id for no key update;
    if v_name is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if p_expected_qty is not null and v_cur <> p_expected_qty then
      return jsonb_build_object('ok', false, 'code', 'stale', 'qty', v_cur);
    end if;
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


-- الصلاحيات: الـoverload الجديد لـwh_stock_adjust للمتجر بس، والقديم (3 باراميترات) اتقفل
revoke all on function public.wh_stock_adjust(uuid, int, text, int) from public, anon;
grant execute on function public.wh_stock_adjust(uuid, int, text, int) to authenticated;
revoke execute on function public.wh_stock_adjust(uuid, int, text) from authenticated;
