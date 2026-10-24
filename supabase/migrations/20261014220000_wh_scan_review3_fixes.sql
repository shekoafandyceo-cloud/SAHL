-- سكانر المخزن — إصلاحات المراجعة العدائية التالتة (14 أكتوبر · Workflow 3 عدسات + محقق لكل ملاحظة: 10 مؤكدة/محتملة)
-- الجداول كانت فاضية وقت التطبيق (وضع تجربة) فمفيش نقل داتا.
--
-- 🔴 القاعدة الموحّدة: سطر بيتلغي من الحساب (superseded) لو جرد اتفتح **بعد ما الحركة حصلت فعلاً في المخزن** —
--    الخروج = أول مسح J&T (طرد في الكومة لسه ماخرجش) · الرجوع = لما J&T سلّمته لنا (13/111) أو السكان (الأبدري).
--    الجرد شاف المخزن بعد الحركة، فلو اتسجّلت تاني = مرتين. طرد في الكومة الجرد بيطرحه (`wh_pile_lines`) فخصمه فاضل.
--  1) التراجع عن خروج بعد جرد: superseded بس لو الطرد كان **برّه** وقت الجرد (الكومة = التراجع بيرجّعه) — كان بيتلغي
--     دايماً، فطرد في الكومة اتراجع عنه = قطعة ناقصة.
--  2) wh_repost (الربط): نفس القاعدة بلحظة الحركة الفعلية — سطر خروج مش مربوط لطرد كان في الكومة وقت الجرد كان
--     بيتلغي ومايتخصمش أبداً.
--  3) المرتجع اللي سطر خروجه كان superseded (الجرد شاله وهو برّه): بيتضاف · إلا لو جرد اتفتح بعد ما J&T سلّمته (اتعدّ وهو هنا).
--     و«اخصمه» = superseded لو أي جرد اتفتح بعد ما J&T استلمته (الرجوع بيتسوّى في المرآة).
--  4) الجرد: «اتسلّمت للمندوب وانت بتعدّ» (moved — أول مسح J&T بعد فتح الجرد) و«مرتجع J&T سلّمته ومااتضربش» (ret)
--     مايتعرفش اتعدّوا ولا لأ — بيتسألوا صراحةً (`wh_count_opts` → `stock_counts.pile_opts`) وكل إجابة بتطرح أو لأ ·
--     «طبّق برضه» كان بيطرح المرتجع اللي «مش هنا» = قطعة ناقصة · الكومة (pile) بتتطرح دايماً.
--  5) wh_pile_lines من غير حد الـ60 يوم (365 + مش متسلّم) — طرد قديم في الكومة كان بيتضاف تاني.
--  6) wh_board: «اتعمل جرد بعدها» بالمنتج (`app.wh_order_products` — نفس حل wh_make_lines) — جرد لمنتج تاني كان بيخبّي
--     الخطأ من الشارة الحمرا. `counted` = كل المنتجات · `counted_some` = بعضها.

alter table public.stock_counts add column if not exists pile_opts jsonb not null default '{}'::jsonb;

-- منتجات الأوردر زي ما السكان هيحلّها (نفس wh_make_lines بالحرف — الخاصية على السطر الأول بس)
create or replace function app.wh_order_products(p_order uuid)
returns table(line_no int, product_id uuid)
language sql stable
set search_path = public, app, pg_temp
as $$
  select l.line_no, r.product_id
    from orders x
    cross join lateral app.wh_order_lines(x.product_name) l
    cross join lateral app.wh_resolve(x.tenant_id, l.item_key,
      case when l.line_no = 1 and x.line_prices is null and not coalesce(x.has_upsell, false)
           then coalesce(app.wh_props_key(coalesce(nullif(btrim(x.manufacturer_note), ''), x."var")), '') else '' end,
      case when l.line_no = 1 and x.line_prices is null and not coalesce(x.has_upsell, false)
           then coalesce(app.wh_props_key(x."var"), '') else '' end) r
   where x.id = p_order and r.state = 'posted' and r.product_id is not null
$$;

-- الطرود اللي اتخصمت ولسه ممكن تكون في المخزن عند لحظة p_at (فتح الجرد): اتضربت خروج قبلها ومارجعتش بسكان ولا اتلغت ·
--   pile  = J&T عمرها ما مسحتها (لسه في الكومة)
--   moved = أول مسح J&T **بعد** فتح الجرد (اتسلّمت للمندوب وانت بتعدّ — اتعدّت ولا لأ؟)
--   ret   = J&T سلّمتها لنا (13/111) قبل فتح الجرد ومحدش ضربها مرتجع (هنا ولا لأ؟)
create or replace function app.wh_pile_lines(p_tenant uuid, p_at timestamptz)
returns table(order_id uuid, product_id uuid, qty int, kind text)
language sql stable
set search_path = public, app, pg_temp
as $$
  select st.order_id, l.product_id, l.qty,
         case when x.first_at is null then 'pile' when x.first_at >= p_at then 'moved' else 'ret' end
    from wh_order_stock st
    join wh_scans s on s.id = st.out_scan_id
    join orders o on o.id = st.order_id
    cross join lateral (select min(coalesce(j.t, j.rx)) as first_at,
                               min(coalesce(j.t, j.rx)) filter (where j.code in ('13', '111')) as ret_at
                          from app.jt_bill_scans(o.id, o.tenant_id, o.tracking_no) j) x
    join wh_scan_lines l on l.scan_id = s.id
   where st.tenant_id = p_tenant and st.in_scan_id is null and s.reversed_at is null
     and s.created_at < p_at and s.created_at > p_at - interval '365 days'
     and lower(coalesce(o.status, '')) <> 'delivered'
     and l.dir = 'out' and l.state = 'posted' and l.movement_id is not null and l.product_id is not null
     and (x.first_at is null or x.first_at >= p_at or x.ret_at < p_at)
$$;

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
        if (o.stock_returned_at is not null and o.stock_returned_at < v_base)
           or (coalesce(o.carrier_status_code, '') in ('13', '111') and o.carrier_status_at < v_base) then
          v_kind := 'counted'; v_code := 'in_counted';
        else
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
      -- (حتى لو رجع بعدها واتعدّ: الرجوع بيتسوّى في المرآة تحت بنفس القاعدة)
      update wh_scan_lines l
         set state = 'superseded', note = 'اتعدّ في جرد بعد ما J&T استلمته — مفيش خصم تاني', resolved_at = now()
       where l.scan_id = p_scan_id and l.state = 'posted' and l.product_id is not null
         and exists (select 1 from stock_count_lines cl join stock_counts k on k.id = cl.count_id
                      where cl.product_id = l.product_id and k.tenant_id = o.tenant_id and k.applied_at is not null
                        and k.opened_at > v_jt_first);
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
    if exists (select 1 from wh_scan_lines l where l.scan_id = p_scan_id and l.state = 'superseded') then v_warn := array_append(v_warn, 'counted'::text); end if;
  end if;
  if v_dir = 'out' then
    if (select coalesce(sum(l.qty), 0) from wh_scan_lines l where l.scan_id = p_scan_id) > 1 then v_warn := array_append(v_warn, 'multi_piece'::text); end if;
    if o.jt_cod_amount is not null and o.total_cost is not null and o.jt_cod_amount <> o.total_cost then v_warn := array_append(v_warn, 'cod_mismatch'::text); end if;
    if v_cancel_req then v_warn := array_append(v_warn, 'cancel_requested'::text); end if;
  end if;
  v_tone := case
    when v_code in ('out_ok', 'out_leak_fix') then case when 'short' = any(v_warn) or 'unmatched' = any(v_warn) then 'warn' else 'ok' end
    when v_code in ('in_ok', 'in_ok_precount', 'in_counted', 'in_ok_manual', 'in_ok_leak') then 'in'
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

create or replace function public.wh_scan_undo(p_scan_id bigint, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; s record; st record; o record; v_new bigint; v_res jsonb; v_err text; v_first timestamptz; v_ret timestamptz;
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
    select x.id, x.tenant_id, x.tracking_no, x.order_uid, x.stock_deducted_at, x.stock_returned_at into o from orders x where x.id = s.order_id for update;
    if o.tracking_no is not null then
      select min(coalesce(j.t, j.rx)), min(coalesce(j.t, j.rx)) filter (where j.code in ('13', '111'))
        into v_first, v_ret from app.jt_bill_scans(o.id, o.tenant_id, o.tracking_no) j;
    end if;
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
    -- جرد صلّح الرقم بعد السكان = العكس دلوقتي كان هيبوّظه تاني:
    --   خروج: بس لو الطرد كان **برّه** وقت الجرد (J&T استلمته قبل فتحه ولسه مارجعش) — طرد في الكومة الجرد بيطرحه
    --         (wh_pile_lines) فالخصم فاضل والتراجع لازم يرجّعه
    --   رجوع: جرد اتطبّق بعد سكان الرجوع (شاف المخزن بعده)
    update wh_scan_lines l
       set state = 'superseded', note = 'اتعدّ في جرد بعد السكان — التراجع من غير حركة', resolved_at = now(), resolved_by_name = me.name
     where l.scan_id = v_new and l.state = 'posted' and l.movement_id is null and l.product_id is not null
       and exists (select 1 from stock_count_lines cl join stock_counts k on k.id = cl.count_id
                    where cl.product_id = l.product_id and k.tenant_id = me.tenant_id and k.applied_at is not null
                      and case when s.dir = 'out'
                               then v_first is not null and k.opened_at > v_first and (v_ret is null or k.opened_at < v_ret)
                               else k.applied_at > s.created_at end);
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

create or replace function app.wh_repost(p_tenant uuid, p_item text, p_by text)
returns jsonb language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  c record; l record; r record; v_pass int; v_rep int := 0; v_sup int := 0; v_void int := 0; v_scans bigint[] := '{}'; v_sid bigint;
  v_first timestamptz; v_ret timestamptz; v_m timestamptz; v_oid uuid := null;
begin
  for v_pass in 1..2 loop
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
    if l.order_id is distinct from v_oid then
      v_oid := l.order_id; v_first := null; v_ret := null;
      select min(coalesce(j.t, j.rx)), min(coalesce(j.t, j.rx)) filter (where j.code in ('13', '111'))
        into v_first, v_ret
        from orders x cross join lateral app.jt_bill_scans(x.id, x.tenant_id, x.tracking_no) j
       where x.id = l.order_id and x.tracking_no is not null;
    end if;
    -- لحظة الحركة الفعلية في المخزن: الخروج = أول مسح J&T (طرد في الكومة لسه ماتحرّكش) · الرجوع = لما J&T سلّمته لنا
    -- أو السكان (الأبدري) · طرد عمره ما خرج = مفيش حركة (الخروج والرجوع بيلغوا بعض)
    v_m := case when v_first is null then null
                when l.dir = 'out' then v_first
                else least(coalesce(v_ret, l.created_at), l.created_at) end;
    if r.state = 'unmatched' then
      update wh_scan_lines set state = 'unmatched', matched_by = null, product_id = null, resolved_at = now(), resolved_by_name = p_by where id = l.id;
      continue;
    end if;
    if r.state = 'ignored' then
      update wh_scan_lines set state = 'ignored', matched_by = r.matched_by, product_id = null, resolved_at = now(), resolved_by_name = p_by where id = l.id;
      continue;
    end if;
    if v_m is not null and app.wh_last_count(p_tenant, r.product_id, v_m) is not null then
      update wh_scan_lines set state = 'superseded', product_id = r.product_id, matched_by = r.matched_by,
             note = 'المنتج اتعدّ في جرد بعد الحركة', resolved_at = now(), resolved_by_name = p_by where id = l.id;
      v_sup := v_sup + 1; continue;
    end if;
    update wh_scan_lines set state = 'posted', product_id = r.product_id, matched_by = r.matched_by, movement_id = null,
           resolved_at = now(), resolved_by_name = p_by where id = l.id;
    if not (l.scan_id = any(v_scans)) then v_scans := v_scans || l.scan_id; end if;
    v_rep := v_rep + 1;
  end loop;
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
  v_pile jsonb := '{}'::jsonb; v_pq int; v_tgt int; v_ret int := 0; v_pile_total int := 0;
  v_mov int := 0; v_opts jsonb; v_take_mov boolean; v_take_ret boolean;
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
    -- 🔴 الطرود اللي اتضربت خروج ولسه في المخزن وقت فتح الجرد (الكومة · مرتجع J&T سلّمته ومااتضربش) اتخصمت
    -- خلاص — العدّ بيشملها (التعليمات: «اعدّ كل اللي في المخزن») فبتتطرح، وإلا كل طرد كان هيتضاف تاني
    -- 🔴 «اتسلّمت للمندوب وانت بتعدّ» (moved) و«مرتجع J&T سلّمته ومااتضربش» (ret) مايتعرفش اتعدّوا ولا لأ — الأدمن
    -- بيجاوب صراحةً (wh_count_opts) · الإجابة بتتسأل تاني لو العدد زاد بعدها · «الكومة» (pile) بتتطرح دايماً
    select count(distinct pl.order_id) filter (where pl.kind = 'moved'), count(distinct pl.order_id) filter (where pl.kind = 'ret')
      into v_mov, v_ret from app.wh_pile_lines(me.tenant_id, c.opened_at) pl;
    v_opts := coalesce(c.pile_opts, '{}'::jsonb);
    if (v_mov > 0 and (v_opts ->> 'moved' is null or coalesce((v_opts ->> 'moved_n')::int, 0) < v_mov))
       or (v_ret > 0 and (v_opts ->> 'ret' is null or coalesce((v_opts ->> 'ret_n')::int, 0) < v_ret)) then
      return jsonb_build_object('ok', false, 'code', 'pile_questions', 'moved', v_mov, 'returns_unscanned', v_ret);
    end if;
    v_take_mov := coalesce(v_opts ->> 'moved', '') = 'counted';
    v_take_ret := coalesce(v_opts ->> 'ret', '') = 'counted';
    select coalesce(jsonb_object_agg(x.product_id::text, x.q), '{}'::jsonb) into v_pile
      from (select pl.product_id, sum(pl.qty)::int as q from app.wh_pile_lines(me.tenant_id, c.opened_at) pl
             where pl.kind = 'pile' or (pl.kind = 'moved' and v_take_mov) or (pl.kind = 'ret' and v_take_ret)
             group by pl.product_id) x;
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
      v_pq := coalesce((v_pile ->> v_pid::text)::int, 0);
      if v_cnt < v_pq then
        return jsonb_build_object('ok', false, 'code', 'pile_exceeds', 'product_id', v_pid, 'counted', v_cnt, 'pile', v_pq);
      end if;
    end loop;
    for e in select * from jsonb_array_elements(p_counts) loop
      v_pid := (e ->> 'product_id')::uuid; v_cnt := (e ->> 'counted')::int;
      v_pq := coalesce((v_pile ->> v_pid::text)::int, 0);
      v_tgt := v_cnt - v_pq;
      v_pile_total := v_pile_total + v_pq;
      select coalesce(p.current_qty, 0), p.name into v_cur, v_name from stock_products p where p.id = v_pid;
      v_delta := v_tgt - v_cur;
      insert into stock_count_lines (count_id, tenant_id, product_id, system_before, counted, delta, pile_qty)
      values (c.id, me.tenant_id, v_pid, v_cur, v_cnt, v_delta, v_pq);
      if v_delta <> 0 then
        insert into stock_movements (tenant_id, product_id, product_name, movement_type, qty_in, qty_out, movement_date,
                                     notes, source, created_by_name)
        values (me.tenant_id, v_pid, v_name, case when v_delta > 0 then 'in' else 'out' end,
                greatest(v_delta, 0), greatest(-v_delta, 0), (now() at time zone 'Africa/Cairo')::date,
                '🧮 جرد · كان ' || v_cur || ' ← اتعدّ ' || v_cnt
                  || case when v_pq > 0 then ' (منهم ' || v_pq || ' في طرود اتضربت خروج)' else '' end || ' · ' || me.name, 'count', me.name);
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
    when lock_not_available or deadlock_detected or serialization_failure then return jsonb_build_object('ok', false, 'code', 'busy');
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'sqlstate', v_err);
  end;
  return jsonb_build_object('ok', true, 'code', 'ok', 'count_id', c.id, 'lines', jsonb_array_length(p_counts),
                            'changed', v_changed, 'go_live', coalesce(p_go_live, false), 'pile', v_pile_total, 'baseline_at',
                            case when coalesce(p_go_live, false) then c.opened_at end);
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
  ), b0 as (
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
  ), b as (
    -- «اتعمل جرد بعدها» بالمنتج — نفس قاعدة «اخصمه» بالحرف (app.wh_order_products = نفس حل wh_make_lines):
    -- all = كل منتجات الأوردر اتعدّت في جرد اتفتح بعد ما J&T استلمته (اخصمه مش هيخصم حاجة) · some = بعضها
    select b0.*,
      case when b0.k_leak then (
        select case when count(*) filter (where pp.product_id is not null) = 0 then null
                    when bool_and(pp.product_id is not null and app.wh_last_count(me.tenant_id, pp.product_id, b0.jt_first) is not null) then 'all'
                    when bool_or(pp.product_id is not null and app.wh_last_count(me.tenant_id, pp.product_id, b0.jt_first) is not null) then 'some'
                    end
          from app.wh_order_products(b0.id) pp) end as counted_kind
      from b0
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
      'leak_counted', count(*) filter (where k_leak and counted_kind = 'all'),
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
                         'cancelled', status = 'cancelled', 'counted', counted_kind = 'all', 'counted_some', counted_kind = 'some') order by jt_first desc) filter (where k_leak), '[]'::jsonb),
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

-- إجابة الأدمن على «اتسلّمت وانت بتعدّ» (moved: counted | left) و«مرتجع ماتضربش» (ret: counted | absent) — بتتحفظ على الجرد
-- المفتوح ومعاها العدد وقتها (لو زاد بعدها بيتسأل تاني)
create or replace function public.wh_count_opts(p_count_id bigint, p_opts jsonb)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare me record; c record; v_mov int; v_ret int; v_new jsonb;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select x.* into c from stock_counts x where x.id = p_count_id and x.tenant_id = me.tenant_id for update;
  if c.id is null or c.applied_at is not null or c.cancelled_at is not null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if jsonb_typeof(p_opts) is distinct from 'object'
     or (p_opts ? 'moved' and coalesce(p_opts ->> 'moved', '') not in ('counted', 'left'))
     or (p_opts ? 'ret' and coalesce(p_opts ->> 'ret', '') not in ('counted', 'absent')) then
    return jsonb_build_object('ok', false, 'code', 'bad_args');
  end if;
  select count(distinct pl.order_id) filter (where pl.kind = 'moved'), count(distinct pl.order_id) filter (where pl.kind = 'ret')
    into v_mov, v_ret from app.wh_pile_lines(me.tenant_id, c.opened_at) pl;
  v_new := coalesce(c.pile_opts, '{}'::jsonb);
  if p_opts ? 'moved' then v_new := v_new || jsonb_build_object('moved', p_opts ->> 'moved', 'moved_n', v_mov, 'moved_by', me.name); end if;
  if p_opts ? 'ret' then v_new := v_new || jsonb_build_object('ret', p_opts ->> 'ret', 'ret_n', v_ret, 'ret_by', me.name); end if;
  update stock_counts set pile_opts = v_new where id = c.id;
  return jsonb_build_object('ok', true, 'code', 'ok', 'opts', v_new);
end $$;

-- الأرقام دي للواجهة قبل التطبيق — نفس الدالة اللي wh_count_apply بيطرح بيها · بالنوع (pile/moved/ret) + القوايم + الإجابات
create or replace function public.wh_count_pile()
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare me record; c record;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select x.* into c from stock_counts x where x.tenant_id = me.tenant_id and x.applied_at is null and x.cancelled_at is null;
  if c.id is null then return jsonb_build_object('ok', true, 'count_id', null, 'pile', '[]'::jsonb, 'opts', '{}'::jsonb,
                                                 'pile_orders', 0, 'moved_orders', 0, 'ret_orders', 0); end if;
  return (
    with pl as (select * from app.wh_pile_lines(me.tenant_id, c.opened_at))
    select jsonb_build_object('ok', true, 'count_id', c.id, 'opts', coalesce(c.pile_opts, '{}'::jsonb),
      'pile', coalesce((select jsonb_agg(jsonb_build_object('product_id', y.product_id, 'pile', y.p, 'moved', y.m, 'ret', y.r))
                          from (select pl.product_id,
                                       coalesce(sum(pl.qty) filter (where pl.kind = 'pile'), 0)::int as p,
                                       coalesce(sum(pl.qty) filter (where pl.kind = 'moved'), 0)::int as m,
                                       coalesce(sum(pl.qty) filter (where pl.kind = 'ret'), 0)::int as r
                                  from pl group by pl.product_id) y), '[]'::jsonb),
      'pile_orders', (select count(distinct pl.order_id) from pl where pl.kind = 'pile'),
      'moved_orders', (select count(distinct pl.order_id) from pl where pl.kind = 'moved'),
      'ret_orders', (select count(distinct pl.order_id) from pl where pl.kind = 'ret'),
      'moved_list', coalesce((select jsonb_agg(jsonb_build_object('uid', o.order_uid, 't', right(o.tracking_no, 8)) order by o.order_uid)
                                from (select distinct pl.order_id from pl where pl.kind = 'moved' limit 30) z join orders o on o.id = z.order_id), '[]'::jsonb),
      'ret_list', coalesce((select jsonb_agg(jsonb_build_object('uid', o.order_uid, 't', right(o.tracking_no, 8)) order by o.order_uid)
                              from (select distinct pl.order_id from pl where pl.kind = 'ret' limit 30) z join orders o on o.id = z.order_id), '[]'::jsonb)));
end $$;

-- الصلاحيات
revoke all on function app.wh_order_products(uuid) from public, anon, authenticated;
revoke all on function app.wh_pile_lines(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.wh_count_opts(bigint, jsonb) from public, anon;
grant execute on function public.wh_count_opts(bigint, jsonb) to authenticated;
revoke all on function public.wh_count_pile() from public, anon;
grant execute on function public.wh_count_pile() to authenticated;
