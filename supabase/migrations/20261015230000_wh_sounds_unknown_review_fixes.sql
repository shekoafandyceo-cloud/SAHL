-- v78 — إصلاحات المراجعة العدائية على أصوات السكانر وتسجيل البوليصة المجهولة (15 أكتوبر مساءً)
--
-- 1) wh_unknown_in: «اضرب الأول» (scan_first) بقى بعد البحث عن تسجيل قديم — بوليصة اتسجّلت من أكتر من 24 ساعة كانت بترجع
--    scan_first بدل «اتسجّلت قبل كده» (wh_scan مابيكتبش not_found لبوليصة متسجّلة، فالشرط مستحيل يعدّي).
-- 2) app.wh_core: «⛔ اتسحب من الكومة» في ملاحظة الحركة وسطر سجل الحالة ← «⛔ اتسحب من «جاهز للشحن»» (طلب المالك — الواجهة
--    اتغيّرت والسيرفر كان لسه بيكتب الاسم القديم في التايم لاين وحركات المخزون). الدالة = الحي بالحرف (md5 59f04488…) غير النصّين.
--    السطور القديمة ماتلمستش (إصلاح للأمام بس).
-- اتجرّب بترانزاكشن راجعة على الحي الأول. مفيش DROP.

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
    -- (المراجعة) «اضرب الأول» بعد ما نتأكد إنها مااتسجّلتش: بوليصة اتسجّلت بقالها أكتر من يوم كانت بترجع scan_first غلط
    -- (wh_scan مابيكتبش not_found لبوليصة متسجّلة — بيرجّع unknown_already_in)
    if not v_dry and not exists (select 1 from wh_scans s where s.tenant_id = me.tenant_id and s.tracking_no = v_code
                                    and s.code = 'not_found' and s.created_at > now() - interval '24 hours') then
      return jsonb_build_object('ok', false, 'code', 'scan_first', 'tone', 'stop', 'tracking_no', v_code);
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
  v_res jsonb; v_kind text; v_src_scan bigint; v_ret_at timestamptz; v_leakfix boolean := false;
  v_st_from text := null; v_st_to text := null;
begin
  select x.* into o from orders x where x.id = p_order_id for update;
  select c.* into cfg from wh_config c where c.tenant_id = o.tenant_id;
  v_base := coalesce(cfg.baseline_at, now());
  insert into wh_order_stock (order_id, tenant_id, tracking_no) values (o.id, o.tenant_id, o.tracking_no)
  on conflict (order_id) do nothing;
  select s.* into st from wh_order_stock s where s.order_id = o.id for update;
  if o.tracking_no is not null then
    select min(coalesce(s.t, s.rx)), min(coalesce(s.t, s.rx)) filter (where s.code in ('13', '111'))
      into v_jt_first, v_ret_at
      from app.jt_bill_scans(o.id, o.tenant_id, o.tracking_no) s;
  end if;
  v_return_ev := o.status in ('Returned to business', 'Returned to business2')
              or coalesce(o.carrier_status_code, '') like 'refund:%'
              or coalesce(o.carrier_status_code, '') in ('13', '111', '172');
  v_cancel_req := o.cancel_requested_at is not null and o.cancel_resolved_at is null;
  v_has_out := st.out_scan_id is not null;
  v_has_in  := st.in_scan_id is not null;
  -- «اخصمه» من قايمة «خرجت من غير سكان»: J&T استلمته فعلاً، فطلب الإلغاء/الإلغاء مايمنعوش (كان بيقع دايماً)
  v_leakfix := p_mode = 'admin' and p_force = 'out' and not v_has_out and v_jt_first is not null;
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
      -- اتسجّل مرتجع برّه السكانر (صفحة المرتجعات في n8n): السكان هنا هو اللي بيرجّع المخزن والحالة — والكارت بيقول
      -- إنه كان متسجّل (بعد لحظة البداية = تنبيه: الختم ده مابيرجّعش حاجة)
      if o.stock_returned_at is not null then
        v_prev := jsonb_build_object('at', o.stock_returned_at, 'by', 'صفحة المرتجعات', 'src', 'ext');
        if cfg.baseline_at is not null and o.stock_returned_at >= cfg.baseline_at then
          v_warn := array_append(v_warn, 'ext_registered'::text);
        end if;
      end if;
      if v_has_out then
        v_kind := 'mirror'; v_source := 'scan_in'; v_src_scan := st.out_scan_id;
        perform app.wh_mirror_lines(p_scan_id, st.out_scan_id, 'in', 'رجع قبل ما يتخصم');
        -- سطر الخروج كان superseded (الجرد شاله وهو برّه — مفيش حركة): الرجوع بيتضاف · إلا لو جرد اتفتح بعد ما J&T سلّمته
        -- لنا (اتعدّ وهو هنا) — كان بيتضاف برضه = قطعة زيادة
        if v_ret_at is not null then
          update wh_scan_lines l
             set state = 'superseded', note = 'اتعدّ في جرد بعد ما رجع — مفيش إضافة تاني', resolved_at = now()
           where l.scan_id = p_scan_id and l.state = 'posted' and l.movement_id is null and l.product_id is not null
             and exists (select 1 from wh_scan_lines s2 where s2.scan_id = st.out_scan_id and s2.line_no = l.line_no and s2.state = 'superseded')
             and app.wh_last_count(o.tenant_id, l.product_id, v_ret_at) is not null;
        end if;
        v_code := case when not exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.state <> 'superseded')
                        and exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.state = 'superseded')
                       then 'in_counted' else 'in_ok' end;
      elsif p_mode = 'admin' and v_jt_first is null then
        v_kind := 'manual'; v_source := 'scan_in';
        perform app.wh_make_lines(p_scan_id, o.id, 'in');
        v_code := 'in_ok_manual';
      elsif v_jt_first is null then
        v_kind := 'flag'; v_code := 'in_flag_only';
      elsif v_jt_first < v_base then
        -- (15 أكتوبر — المراجعة) «محسوب في الأرقام» = اتسجّل مرتجع قبل لحظة البداية (صفحة n8n) · أو J&T قفلته قبل ما
        -- صفحة n8n تشتغل (30 سبتمبر — مكانش فيه تسجيل). J&T قفلته قبل البداية **ومحدش سجّله** («ناقص») = مش متأكدين إنه
        -- كان على الرف لما الأرقام اتظبطت — بيتضاف وبينبّه (كان بيتحسب «اتعدّ» = قطعة ناقصة للأبد لما يوصل متأخر)
        if (o.stock_returned_at is not null and o.stock_returned_at < v_base)
           or (v_ret_at is not null and v_ret_at < least(v_base, timestamptz '2026-09-29 21:00:00+00')) then
          v_kind := 'counted'; v_code := 'in_counted';
        else
          if v_ret_at is not null and v_ret_at < v_base and o.stock_returned_at is null then
            v_warn := array_append(v_warn, 'unregistered_before_start'::text);
          end if;
          v_kind := 'precount'; v_source := 'scan_in_precount';
          perform app.wh_make_lines(p_scan_id, o.id, 'in');
          perform app.wh_in_settle(p_scan_id, o.tenant_id, v_jt_first, v_ret_at, false);
          v_code := case when not exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.state <> 'superseded')
                          and exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id)
                         then 'in_counted' else 'in_ok_precount' end;
        end if;
      else
        -- خرج من غير سكان: عمره ما اتخصم — إلا لو جرد اتعمل وهو برّه (الجرد شاله) أو الأدمن قفله «مش محتاج خصم»
        v_kind := 'leak';
        perform app.wh_make_lines(p_scan_id, o.id, 'in');
        perform app.wh_in_settle(p_scan_id, o.tenant_id, v_jt_first, v_ret_at, coalesce(st.leak_state, '') <> 'dismissed');
        if exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and (l.state = 'posted' or (l.state = 'unmatched' and st.leak_state = 'dismissed'))) then
          v_source := 'scan_in'; v_code := 'in_ok_leak';
        elsif exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.state = 'superseded') then
          v_code := 'in_counted';
        else
          v_code := 'in_leak';
        end if;
      end if;
      if v_source is not null then
        v_note := '↩️ مرتجع · #' || coalesce(o.order_uid, '') || ' · ' || p_by;
        perform app.wh_post(p_scan_id, v_source, p_by, v_note);
      end if;
      -- (15 أكتوبر — طلب المالك) الحالة بتتغيّر مع المخزون: مرتجع J&T رجّعته واتضرب = «مرتجع مضروب» ·
      -- J&T عمرها ما استلمته (الأدمن رجّع طرد من الكومة) = يرجع لحالته قبل سكان الخروج · متسلّم/ملغي = زي ما هي
      -- 🔴 (15 أكتوبر — المراجعة) «مرتجع مضروب» بس لو J&T نفسها قالت إنه راجع (الحالة مرتجع · رحلة مرتجع · 172/13/111):
      -- F9 بالغلط على طرد لسه رايح للعميل كان بيقفله «مرتجع مضروب» والتسليم بعدها بيتبلع. من غير إشارة رجوع = الحالة زي
      -- ما هي وتنبيه (المخزون اتحرك — لو غلط اتراجع عن السكان)
      if v_kind is distinct from 'flag' and v_jt_first is not null and not (v_return_ev or v_ret_at is not null) then
        v_warn := array_append(v_warn, 'no_return_signal'::text);
      elsif v_kind is distinct from 'flag' and v_jt_first is not null
         and lower(coalesce(o.status, '')) not in ('delivered', 'cancelled', 'returned to business2') then
        v_st_from := o.status; v_st_to := 'Returned to business2';
      elsif v_jt_first is null and v_has_out and o.status = 'BOSTA2' then
        v_st_from := o.status;
        v_st_to := coalesce((select nullif(x.result ->> 'status_from', '') from wh_scans x where x.id = st.out_scan_id), 'BOSTA AUTO');
      end if;
      if v_st_to is not null then
        perform app.wh_set_status(o.id, v_st_to, p_by,
          case when v_st_to = 'Returned to business2' then '↩️ المرتجع وصل المخزن واتضرب' else '↩️ رجع المخزن قبل ما J&T تستلمه' end);
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
  elsif o.status = 'cancelled' and not v_leakfix then
    if v_has_out then v_code := 'pulled_back'; else v_code := 'blocked_cancelled'; end if;
  elsif v_cancel_req and coalesce(cfg.hold_cancel_requested, true) and p_force is distinct from 'ship_anyway' and not v_leakfix then
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
    if v_source = 'leak_fix' then
      -- جرد اتفتح بعد ما الطرد خرج فعلاً (أول مسح J&T) = الجرد شاف المخزن من غيره — الخصم دلوقتي كان هيخصمها مرتين
      -- (حتى لو رجع بعدها واتعدّ: الرجوع بيتسوّى في المرآة تحت بنفس القاعدة) · أو خرج **وانت بتعدّ** والأدمن جاوب
      -- «خرج قبل ما أعدّه» للمنتج ده (wh_last_count2) — العدّ ماشملوش
      update wh_scan_lines l
         set state = 'superseded', note = 'اتعدّ في جرد بعد ما J&T استلمته — مفيش خصم تاني', resolved_at = now()
       where l.scan_id = p_scan_id and l.state = 'posted' and l.product_id is not null
         and app.wh_last_count2(o.tenant_id, l.product_id, v_jt_first, o.id) is not null;
    end if;
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
    -- (15 أكتوبر) الطرد خرج = «اوردر اتضرب» — بس من حالة الشحن الأولى: J&T حرّكته قبل السكان = حالتها هي الأحدث
    if o.status in ('BOSTA AUTO', 'bosta_assigned') then
      v_st_from := o.status; v_st_to := 'BOSTA2';
      perform app.wh_set_status(o.id, 'BOSTA2', p_by, '📦 اتضرب خروج من المخزن');
    end if;
    v_code := case when v_source = 'leak_fix' then 'out_leak_fix' else 'out_ok' end;
    if v_source = 'late_out' then v_warn := array_append(v_warn, 'late'::text); end if;
    v_applied := true;
  end if;
  if v_code = 'pulled_back' then
    v_dir := 'pull_back';
    v_src_scan := st.out_scan_id;
    perform app.wh_mirror_lines(p_scan_id, st.out_scan_id, 'in', 'اتسحب قبل ما يتخصم');
    perform app.wh_post(p_scan_id, 'pull_back', p_by, '⛔ اتسحب من «جاهز للشحن» · #' || coalesce(o.order_uid, '') || ' · ' || p_by);
    -- طالب إلغاء ولسه مااتلغاش: الطرد رجع الرف = الحالة بترجع زي ما كانت قبل سكان الخروج (الملغي بيفضل ملغي)
    if o.status = 'BOSTA2' then
      v_st_from := o.status;
      v_st_to := coalesce((select nullif(x.result ->> 'status_from', '') from wh_scans x where x.id = v_src_scan), 'BOSTA AUTO');
      perform app.wh_set_status(o.id, v_st_to, p_by, '⛔ اتسحب من «جاهز للشحن» — العميل طالب إلغاء');
    end if;
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
    if exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.state = 'superseded') then v_warn := array_append(v_warn, 'counted'::text); end if;
  end if;
  if v_dir = 'out' then
    if (select coalesce(sum(l.qty), 0) from wh_scan_lines l where l.scan_id = p_scan_id) > 1 then v_warn := array_append(v_warn, 'multi_piece'::text); end if;
    if o.jt_cod_amount is not null and o.total_cost is not null and o.jt_cod_amount <> o.total_cost then v_warn := array_append(v_warn, 'cod_mismatch'::text); end if;
    if v_cancel_req then v_warn := array_append(v_warn, 'cancel_requested'::text); end if;
  end if;
  v_tone := case
    when v_code in ('out_ok', 'out_leak_fix') then case when 'short' = any(v_warn) or 'unmatched' = any(v_warn) then 'warn' else 'ok' end
    when v_code in ('in_ok', 'in_ok_precount', 'in_counted', 'in_ok_manual', 'in_ok_leak') then
      case when 'no_return_signal' = any(v_warn) or 'unregistered_before_start' = any(v_warn) then 'warn' else 'in' end
    when v_code in ('already_out', 'already_in') then 'dup'
    when v_code in ('confirm_return', 'with_jt_confirm', 'in_leak', 'in_flag_only', 'pulled_back') then 'warn'
    else 'stop' end;
  v_res := jsonb_build_object(
    'ok', true, 'code', v_code, 'tone', v_tone, 'dir', v_dir, 'applied', v_applied,
    'scan_id', p_scan_id, 'order', app.wh_order_brief(o.id),
    'lines', app.wh_scan_lines_json(p_scan_id),
    'warnings', to_jsonb(v_warn), 'options', to_jsonb(v_opts), 'prev', v_prev,
    'stamped_deducted', v_stamp_d, 'stamped_returned', v_stamp_r, 'in_kind', v_kind,
    'by', p_by, 'status_from', v_st_from, 'status_to', v_st_to);
  update wh_scans
     set code = v_code, applied = v_applied, dir = v_dir, result = v_res
   where id = p_scan_id;
  return v_res;
end $$;
