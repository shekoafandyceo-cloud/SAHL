-- سكانر المخزن v76 — إصلاحات المراجعة العدائية (15 أكتوبر · Workflow على migration wh_scan_status: 20 مؤكدة)
-- مفيش نقل داتا: wh_config.enabled=false و baseline_at فاضي (وضع تجربة) — صفر سكان اتسجّل.
--
--  1) 🔴 «مرتجع مضروب» من غير دليل رجوع: F9 بالغلط على طرد J&T لسه رايح للعميل (أول مسح J&T = استلام المندوب على بابنا —
--     318 من 319 آخر 10 أيام، فكارت «J&T استلمته — مرتجع ولا خارج؟» طبيعي) كان بيقفل الأوردر «مرتجع مضروب»، والتسليم بعدها
--     (100) بيتبلع في jt_apply_trace والمصالحة مابتسحبهوش = أوردر اتحصّل فلوسه متسجّل مرتجع للأبد. دلوقتي:
--       · wh_core: «مرتجع مضروب» بس لو J&T قالت إنه راجع (الحالة مرتجع · رحلة مرتجع · 172/13/111) — غير كده الحالة زي ما هي
--         والكارت برتقاني (no_return_signal)
--       · jt_apply_trace: التسليم بيعدّي «مرتجع مضروب» بسبب صريح في السجل · المرتجع المتأخر لسه محمي
--       · jt_trace_candidates: «مرتجع مضروب» بيتسحب لحد ما J&T تقفله 13/111
--       · wh_board.in_delivered: «اتضربت مرتجع وJ&T سلّمتها» للأدمن (القطعة اتضافت وهي عند العميل — تراجع)
--  2) التراجع عن «مرتجع مضروب» بيطبّق آخر مسح J&T اللي اتحمى (كانت الحالة بترجع للي قبل السكان وتقف).
--  3) 🔴 ختم صفحة n8n بعد لحظة البداية مابيعدّش «اتسجل» في لوحة المرتجعات ولا في البحث: الصفحة بتختم stock_returned_at من غير
--     ما المخزون يرجع ولا الحالة تتغيّر — كان المرتجع بيختفي من «ناقص» والقطعة مابترجعش للأبد (134 من 134 مرتجع اتسجّلوا منها
--     من 30 سبتمبر). قبل البداية الختم بيعدّ زي ما هو · الكارت بيقول «متسجّل في صفحة المرتجعات» · n8n_only في الصفوف.
--  4) «ناقص» قبل البداية (J&T قفلته 13/111 ومحدش سجّله): كان «اتعدّ» = مابيتضافش لما يوصل متأخر. دلوقتي بيتضاف وبينبّه
--     (unregistered_before_start) — «محسوب» بس لو اتسجّل قبل البداية أو J&T قفلته قبل ما صفحة n8n تشتغل (30 سبتمبر).
--  5) شارة «ناقص» آخر 7 أيام بس (مرتجع ضايع من شهر كان بيخلّيها مولّعة للأبد — درس 9).
--  6) wh_start_check + wh_config_set(start) = needs_confirm: مش مربوط · «راجع» · مرتجعات ناقصة · عائلات رصيدها على الأم ·
--     حركة J&T من ساعة ما الأرقام اتظبطت (استلام المندوب العصر / مرتجعات الضهر) — والأدمن يأكّد بعد ما يشوفها.
--  7) wh_product_pile: محرر المخزون بعد التشغيل بيقول «منه N في الكومة اتخصموا خلاص» (التعديل بالرقم المطلق كان بيضيفهم تاني).
--  8) wh_items_unmapped.sibling = «⚠️ راجع»: «منظم المطبخ المتكامل» بخاصية «مقاس 65 عرض» (42 أوردر/30 يوم) كان بيتخصم من الـ85
--     في صمت وبيبان ✅ — المنتج «… مقاس ٦٥» موجود لوحده.

-- ── لوحة المرتجعات: بعد لحظة البداية «اتسجل» = اتضرب هنا (ختم صفحة n8n مابيرجّعش المخزن) · الشارة آخر 7 أيام ──
create or replace function app.wh_returns_board(p_tenant uuid, p_lite boolean)
returns jsonb language sql stable
set search_path = public, app, pg_temp
as $$
  with cfg as (select max(c.baseline_at) as base from wh_config c where c.tenant_id = p_tenant),
  r as (
    select x.id, x.order_uid, x.tracking_no, x.product_name,
           coalesce(x.jt_cod_amount, x.total_cost) as cod,
           coalesce(x.carrier_status_code, '') as code, x.carrier_status_at as at,
           -- 🔴 (15 أكتوبر — المراجعة) بعد لحظة البداية «اتسجل» = اتضرب هنا بس: صفحة n8n بتختم stock_returned_at من غير
           -- ما المخزون يرجع ولا الحالة تتغيّر — كان المرتجع بيختفي من «ناقص» والقطعة مابترجعش للأبد. قبل البداية الختم بيعدّ
           coalesce(s.in_at, case when cfg.base is null or x.stock_returned_at < cfg.base then x.stock_returned_at end) as sc,
           coalesce(s.in_by_name, case when x.stock_returned_at is not null then 'صفحة المرتجعات' end) as sc_by,
           (s.in_at is null and cfg.base is not null and x.stock_returned_at >= cfg.base) as n8n_only,
           (date_trunc('day', now() at time zone 'Africa/Cairo')) at time zone 'Africa/Cairo' as today0
      from orders x left join wh_order_stock s on s.order_id = x.id cross join cfg
     where x.tenant_id = p_tenant and x.shipping_carrier = 'jt' and x.tracking_no is not null
       and x.created_at > now() - interval '45 days'
       and (x.status in ('Returned to business', 'Returned to business2')
            or coalesce(x.carrier_status_code, '') like 'refund:%'
            or coalesce(x.carrier_status_code, '') in ('13', '111', '172'))
  ), d as (
    select r.*, li.items, li.q,
           (r.code in ('13', '111')) as closed,
           case when r.code = '172' then 'بدأ المرتجع'
                when r.code in ('refund:92', 'refund:name:enter branch scan') then 'وصل فرع'
                when r.code = 'refund:50' then 'بين الفروع'
                when r.code in ('refund:110', 'refund:name:holding scan') then 'متعطّل في فرع'
                else 'في الطريق' end as stage
      from r
      left join lateral (
        select coalesce(string_agg(l.line_text || case when l.qty > 1 then ' ×' || l.qty else '' end, ' · ' order by l.line_no), '') as items,
               greatest(coalesce(sum(l.qty), 0), 1)::int as q
          from app.wh_order_lines(r.product_name) l) li on true
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'courier',       count(*) filter (where code = 'refund:94'),
      'courier_done',  count(*) filter (where code = 'refund:94' and sc is not null),
      'closed_today',  count(*) filter (where closed and at >= today0),
      'scanned_today', count(*) filter (where sc >= today0),
      'missing',       count(*) filter (where closed and sc is null and at >= timestamptz '2026-09-29 21:00:00+00'),
      -- الشارة: آخر 7 أيام بس (مرتجع ضايع من شهر مايتقفلش من هنا — كان بيخلّي الشارة مولّعة للأبد · القايمة بتعرضه)
      'missing_old',   count(*) filter (where closed and sc is null
                                          and at >= greatest(timestamptz '2026-09-29 21:00:00+00', now() - interval '7 days')
                                          and at < now() - interval '30 minutes'),
      'n8n_only',      count(*) filter (where n8n_only),
      'transit',       count(*) filter (where sc is null and not closed and code <> 'refund:94')),
    'courier', case when p_lite then null else coalesce(jsonb_agg(jsonb_build_object(
        't', tracking_no, 'uid', order_uid, 'items', items, 'q', q, 'cod', cod, 'at', at, 'done', sc is not null, 'sc', sc, 'n8n', n8n_only)
        order by at desc nulls last) filter (where code = 'refund:94'), '[]'::jsonb) end,
    'missing', case when p_lite then null else coalesce(jsonb_agg(jsonb_build_object(
        't', tracking_no, 'uid', order_uid, 'items', items, 'q', q, 'cod', cod, 'at', at,
        'fresh', at >= now() - interval '30 minutes', 'n8n', n8n_only)
        order by at desc) filter (where closed and sc is null and at >= timestamptz '2026-09-29 21:00:00+00'), '[]'::jsonb) end,
    'scanned', case when p_lite then null else coalesce(jsonb_agg(jsonb_build_object(
        't', tracking_no, 'uid', order_uid, 'items', items, 'q', q, 'at', sc, 'by', sc_by)
        order by sc desc) filter (where sc >= today0), '[]'::jsonb) end,
    'transit', case when p_lite then null else coalesce(jsonb_agg(jsonb_build_object(
        't', tracking_no, 'uid', order_uid, 'items', items, 'q', q, 'at', at, 's', stage, 'n8n', n8n_only)
        order by at desc nulls last) filter (where sc is null and not closed and code <> 'refund:94'), '[]'::jsonb) end)
  from d;
$$;

-- ── المصالحة: «مرتجع مضروب» بيتسحب لحد ما J&T تقفله (13/111) ──
create or replace function app.jt_trace_candidates(p_limit integer default 300)
returns table(bill_code text, order_id uuid, tenant_id uuid, carrier_status_at timestamp with time zone, carrier_status_code text)
language sql stable security definer set search_path to 'public', 'app' as $function$
  select o.tracking_no, o.id, o.tenant_id, o.carrier_status_at, o.carrier_status_code from orders o
   where o.shipping_carrier = 'jt' and coalesce(o.tracking_no,'') <> ''
     and o.status not in ('Delivered', 'Returned to business')
     -- «مرتجع مضروب» نهائي بس لما J&T نفسها قفلته (13/111) — غير كده بيتسحب: لو التسليم ضاع في الـpush المصالحة تلقطه
     and not (o.status = 'Returned to business2' and coalesce(o.carrier_status_code, '') in ('13', '111'))
     and o.created_at > now() - interval '90 days'
   order by o.carrier_status_at nulls first, o.created_at
   limit greatest(1, least(coalesce(p_limit, 300), 1000));
$function$;

-- ── wh_core: «مرتجع مضروب» بإشارة رجوع من J&T بس · «ناقص» قبل البداية بيتضاف · ختم صفحة n8n بيبان ──
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
    perform app.wh_post(p_scan_id, 'pull_back', p_by, '⛔ اتسحب من الكومة · #' || coalesce(o.order_uid, '') || ' · ' || p_by);
    -- طالب إلغاء ولسه مااتلغاش: الطرد رجع الرف = الحالة بترجع زي ما كانت قبل سكان الخروج (الملغي بيفضل ملغي)
    if o.status = 'BOSTA2' then
      v_st_from := o.status;
      v_st_to := coalesce((select nullif(x.result ->> 'status_from', '') from wh_scans x where x.id = v_src_scan), 'BOSTA AUTO');
      perform app.wh_set_status(o.id, v_st_to, p_by, '⛔ اتسحب من الكومة — العميل طالب إلغاء');
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

-- ── التراجع عن «مرتجع مضروب»: آخر مسح J&T اللي اتحمى بيتطبّق تاني ──
create or replace function public.wh_scan_undo(p_scan_id bigint, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
set lock_timeout = '3s'
as $$
declare
  me record; s record; st record; o record; v_new bigint; v_res jsonb; v_err text; v_first timestamptz; v_ret timestamptz;
  v_back text := null;
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
    select x.id, x.tenant_id, x.tracking_no, x.order_uid, x.stock_deducted_at, x.stock_returned_at,
           x.carrier_status_raw, x.carrier_status_code, x.carrier_status_at
      into o from orders x where x.id = s.order_id for update;
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
    --   خروج: بس لو **آخر** جرد للمنتج بعد ما J&T استلمته شافه **برّه** (اتفتح قبل ما J&T ترجّعه — أو خرج وانت بتعدّ
    --         والإجابة «خرج قبل ما أعدّه»). جرد بعد ما رجع شافه هنا (والكومة/المرتجع اتطرحوا) = التراجع بيرجّعه —
    --         «أي جرد في النص» كان بيلغيه حتى لو جرد أحدث شافه هنا = قطعة ناقصة للأبد
    --   رجوع: جرد اتطبّق بعد سكان الرجوع (شاف المخزن بعده)
    update wh_scan_lines l
       set state = 'superseded', note = 'اتعدّ في جرد بعد السكان — التراجع من غير حركة', resolved_at = now(), resolved_by_name = me.name
     where l.scan_id = v_new and l.state = 'posted' and l.movement_id is null and l.product_id is not null
       and case when s.dir = 'out'
                then v_first is not null
                     and coalesce(app.wh_last_count2(me.tenant_id, l.product_id, v_first, s.order_id) < v_ret, v_ret is null
                                  and app.wh_last_count2(me.tenant_id, l.product_id, v_first, s.order_id) is not null)
                else exists (select 1 from stock_count_lines cl join stock_counts k on k.id = cl.count_id
                              where cl.product_id = l.product_id and k.tenant_id = me.tenant_id and k.applied_at is not null
                                and k.applied_at > s.created_at) end;
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
    -- (15 أكتوبر) الحالة اللي السكان كتبها بترجع — بس لو محدش غيّرها بعده (J&T حرّكته = حالتها هي الأحدث)
    if nullif(s.result ->> 'status_to', '') is not null and nullif(s.result ->> 'status_from', '') is not null
       and exists (select 1 from orders x where x.id = s.order_id and x.status = s.result ->> 'status_to') then
      v_back := s.result ->> 'status_from';
      perform app.wh_set_status(s.order_id, v_back, me.name, '↶ تراجع عن سكان المخزن: ' || left(btrim(p_reason), 80));
      -- (15 أكتوبر — المراجعة) مسحات J&T اللي وصلت وهو «مرتجع مضروب» اتكتبت خام بس (الحالة كانت محمية) — بعد الرجوع
      -- آخر مسح بيتطبّق تاني بنفس الدالة، وإلا الحالة تفضل على اللي قبل السكان والمصالحة مابتعيدهوش (الساعة اتقدّمت)
      if s.result ->> 'status_to' = 'Returned to business2' and o.tracking_no is not null
         and o.carrier_status_at is not null and o.carrier_status_at > s.created_at
         and coalesce(o.carrier_status_code, '') not like 'order:%' then
        perform app.jt_apply_trace(o.tracking_no, o.carrier_status_raw, o.carrier_status_code, o.carrier_status_at,
                                   'إعادة آخر مسح J&T بعد التراجع عن سكان المخزن', 'J&T API · تراجع');
      end if;
    end if;
    update wh_scans set reversed_at = now(), reversed_by_name = me.name, reversed_by_scan_id = v_new where id = s.id;
    v_res := jsonb_build_object('ok', true, 'code', 'undone', 'tone', 'warn', 'applied', true, 'scan_id', v_new,
                                'reverses', s.id, 'order', app.wh_order_brief(s.order_id),
                                'lines', app.wh_scan_lines_json(v_new), 'status_to', v_back);
    update wh_scans set code = 'undone', applied = true, result = v_res where id = v_new;
  exception
    when lock_not_available or deadlock_detected or serialization_failure then return jsonb_build_object('ok', false, 'code', 'busy', 'tone', 'warn');
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      return jsonb_build_object('ok', false, 'code', 'error', 'tone', 'stop', 'sqlstate', v_err);
  end;
  return v_res;
end $$;

-- ── البحث بالإيد: «مرتجع مستني يتسجل» بنفس قاعدة اللوحة ──
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
  -- (15 أكتوبر) آخر 4–5 أرقام = البوليصة كمان (زي صفحة استلام المرتجعات) — مش رقم الأوردر بس ·
  -- المرتجع اللي لسه ماتضربش فوق (هو اللي بيتكتب بالإيد على الباب)
  with c as (
    select x.id, ((x.status in ('Returned to business', 'Returned to business2')
                   or coalesce(x.carrier_status_code, '') like 'refund:%'
                   or coalesce(x.carrier_status_code, '') in ('13', '111', '172'))
                  -- نفس قاعدة لوحة المرتجعات: بعد لحظة البداية ختم صفحة n8n مابيقفلوش
                  and s0.in_scan_id is null
                  and not (x.stock_returned_at is not null and (cfg.base is null or x.stock_returned_at < cfg.base))) as open_ret,
           x.created_at
      from orders x
      left join wh_order_stock s0 on s0.order_id = x.id
      cross join (select max(c.baseline_at) as base from wh_config c where c.tenant_id = me.tenant_id) cfg
     where x.tenant_id = me.tenant_id and x.tracking_no is not null
       and (   (v_code is not null and x.tracking_no = v_code)
            or (v_code is null and q ~ '^W-?[0-9]{1,6}$' and upper(x.order_uid) = 'W-' || regexp_replace(q, '^W-?', ''))
            or (v_code is null and q ~ '^[0-9]{4,5}$' and (x.order_uid = q or x.tracking_no like '%' || q))
            or (v_code is null and q ~ '^[0-9]{6,12}$' and x.tracking_no like '%' || q))
     order by 2 desc, x.created_at desc limit 6)
  select coalesce(jsonb_agg(jsonb_build_object(
           'tracking_no', x.tracking_no, 'uid', x.order_uid, 'status', x.status,
           'first_name', nullif(split_part(btrim(coalesce(x.customer_name, '')), ' ', 1), ''),
           'items', (select string_agg(l.line_text || case when l.qty > 1 then ' ×' || l.qty else '' end, ' · ' order by l.line_no)
                       from app.wh_order_lines(x.product_name) l),
           'out_at', s.out_at, 'in_at', s.in_at, 'open_return', c.open_ret) order by c.open_ret desc, x.created_at desc), '[]'::jsonb)
    into v_rows
    from c join orders x on x.id = c.id left join wh_order_stock s on s.order_id = x.id;
  if v_code is null and q !~ '^W-?[0-9]{1,6}$' and q !~ '^[0-9]{4,12}$' then
    return jsonb_build_object('ok', true, 'code', 'too_short', 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok', 'rows', v_rows);
end $$;

-- ── قبل «▶️ شغّل السكانر»: الحاجات اللي هتطلّع أرقام غلط من أول يوم ─────────────────────────────────────────
--   unmatched = أسامي منتجات مش مربوطة (الطرد هيغيّر حالته بس مش هيتخصم لحد الربط) · review = «⚠️ راجع» (wh_items_unmapped)
--   missing   = مرتجعات J&T قالت سلّمتها ومحدش سجّلها («ناقص») — اللي على الرف يتسجّل في صفحة n8n قبل التشغيل
--   families  = منتجات ليها خصائص ورصيدها كله على الأم (السكان بيخصم من الخاصية = بالسالب من أول ساعة)
--   gap       = من أول تعديل رقم في المخزون آخر 24 ساعة: J&T استلمت كام طرد ووصل كام مرتجع (مش محسوبين صح)
create or replace function public.wh_start_check()
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare
  me record; v_map jsonb; v_un int := 0; v_un_pcs int := 0; v_rev int := 0; v_rev_pcs int := 0;
  v_un_top jsonb := '[]'::jsonb; v_rev_top jsonb := '[]'::jsonb;
  v_missing int := 0; v_fam jsonb := '[]'::jsonb; v_t0 timestamptz; v_pick int := 0; v_ret int := 0;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  v_map := public.wh_items_unmapped(30);
  -- نفس whMapState في الواجهة بالحرف
  with k as (
    select e, case when e ->> 'state' = 'ignored' then 'ignored'
                   when e ->> 'state' is distinct from 'posted' or e ->> 'product_id' is null then 'unmatched'
                   when coalesce((e ->> 'sibling')::boolean, false) and e ->> 'alias_props' is null
                        and not coalesce((e ->> 'alias_props_ignore')::boolean, false) then 'review'
                   else 'ok' end as st
      from jsonb_array_elements(coalesce(v_map -> 'rows', '[]'::jsonb)) e)
  select count(*) filter (where st = 'unmatched'), coalesce(sum((e ->> 'pieces')::int) filter (where st = 'unmatched'), 0),
         count(*) filter (where st = 'review'), coalesce(sum((e ->> 'pieces')::int) filter (where st = 'review'), 0),
         coalesce((select jsonb_agg(t.s) from (select k2.e ->> 'sample' as s from k k2 where k2.st = 'unmatched'
                                                 order by (k2.e ->> 'orders')::int desc limit 5) t), '[]'::jsonb),
         coalesce((select jsonb_agg(t.s) from (select (k2.e ->> 'sample') || ' · ' || coalesce(k2.e ->> 'props_key', '') as s
                                                  from k k2 where k2.st = 'review'
                                                 order by (k2.e ->> 'orders')::int desc limit 5) t), '[]'::jsonb)
    into v_un, v_un_pcs, v_rev, v_rev_pcs, v_un_top, v_rev_top
    from k;
  v_missing := coalesce((app.wh_returns_board(me.tenant_id, true) -> 'counts' ->> 'missing')::int, 0);
  select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.current_qty) order by p.name), '[]'::jsonb)
    into v_fam
    from stock_products p
   where p.tenant_id = me.tenant_id and coalesce(p.active, true) and p.parent_id is null and coalesce(p.current_qty, 0) > 0
     and exists (select 1 from stock_products c where c.parent_id = p.id and coalesce(c.active, true))
     and not exists (select 1 from stock_products c where c.parent_id = p.id and coalesce(c.active, true)
                       and coalesce(c.current_qty, 0) <> 0);
  select min(m.created_at) into v_t0 from stock_movements m
   where m.tenant_id = me.tenant_id and m.source = 'adjust' and m.created_at > now() - interval '24 hours';
  if v_t0 is not null then
    select count(*) filter (where x.first_at >= v_t0), count(*) filter (where x.ret_at >= v_t0)
      into v_pick, v_ret
      from orders o
      cross join lateral (select min(coalesce(j.t, j.rx)) as first_at,
                                 min(coalesce(j.t, j.rx)) filter (where j.code in ('13', '111')) as ret_at
                            from app.jt_bill_scans(o.id, o.tenant_id, o.tracking_no) j) x
     where o.tenant_id = me.tenant_id and o.shipping_carrier = 'jt' and o.tracking_no is not null
       and o.created_at > now() - interval '60 days'
       and (o.carrier_status_at is null or o.carrier_status_at >= v_t0);
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok',
    'has_issues', (v_un > 0 or v_rev > 0 or v_missing > 0 or jsonb_array_length(v_fam) > 0 or v_pick > 0 or v_ret > 0),
    'unmatched', jsonb_build_object('n', v_un, 'pieces', v_un_pcs, 'top', v_un_top),
    'review', jsonb_build_object('n', v_rev, 'pieces', v_rev_pcs, 'top', v_rev_top),
    'missing_returns', v_missing,
    'families', v_fam,
    'gap', jsonb_build_object('since', v_t0, 'pickups', v_pick, 'returns', v_ret));
end $$;

-- ── محرر المخزون بعد التشغيل: الرقم المكتوب = اللي على الرف بس — كام قطعة من المنتج ده في الكومة (اتخصمت خلاص) وكام مرتجع
-- J&T قالت سلّمته ومااتضربش (هيتضاف لما يتضرب). نفس app.wh_pile_lines2 بتاعة الجرد عند اللحظة دي
create or replace function public.wh_product_pile(p_product_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare me record; v_base timestamptz; v_pile int := 0; v_ret int := 0;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select c.baseline_at into v_base from wh_config c where c.tenant_id = me.tenant_id;
  if v_base is null then return jsonb_build_object('ok', true, 'code', 'not_started', 'pile', 0, 'ret', 0); end if;
  if not exists (select 1 from stock_products p where p.id = p_product_id and p.tenant_id = me.tenant_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select coalesce(sum(pl.qty) filter (where pl.kind = 'pile'), 0), coalesce(sum(pl.qty) filter (where pl.kind = 'ret'), 0)
    into v_pile, v_ret
    from app.wh_pile_lines2(me.tenant_id, now()) pl
   where pl.product_id = p_product_id and pl.posted;
  return jsonb_build_object('ok', true, 'code', 'ok', 'pile', v_pile, 'ret', v_ret, 'baseline_at', v_base);
end $$;

-- ── «▶️ شغّل السكانر»: الفحص قبلها ──
create or replace function public.wh_config_set(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare me record; cfg record; v_en boolean; v_hold boolean; v_start boolean; v_base timestamptz; v_chk jsonb;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  insert into wh_config (tenant_id) values (me.tenant_id) on conflict (tenant_id) do nothing;
  select c.* into cfg from wh_config c where c.tenant_id = me.tenant_id for update;
  v_en := coalesce((p ->> 'enabled')::boolean, cfg.enabled);
  v_hold := coalesce((p ->> 'hold_cancel_requested')::boolean, cfg.hold_cancel_requested);
  v_start := coalesce((p ->> 'start')::boolean, false);
  -- (15 أكتوبر — قرار المالك) التشغيل من غير جرد: «▶️ شغّل السكانر» بيكتب لحظة البداية دلوقتي، وأرقام المخزون
  -- الأدمن بيظبطها من محرر المخزون (حركة «تعديل» بسبب). التشغيل الأول لازم يبقى صريح (start) — مش أثر جانبي
  if v_en and cfg.baseline_at is null and not v_start then return jsonb_build_object('ok', false, 'code', 'needs_start'); end if;
  -- (15 أكتوبر — المراجعة) قبل لحظة البداية: الفحص (مش مربوط · راجع · مرتجعات ناقصة · عائلات رصيدها على الأم · حركة J&T من
  -- ساعة ما الأرقام اتظبطت) — فيه حاجة = needs_confirm بالتفاصيل، والأدمن يأكّد (force) بعد ما يشوفها
  if v_en and cfg.baseline_at is null and v_start and not coalesce((p ->> 'force')::boolean, false) then
    v_chk := public.wh_start_check();
    if coalesce((v_chk ->> 'has_issues')::boolean, false) then
      return jsonb_build_object('ok', false, 'code', 'needs_confirm', 'check', v_chk);
    end if;
  end if;
  v_base := case when v_en and cfg.baseline_at is null then now() else cfg.baseline_at end;
  update wh_config set enabled = v_en, hold_cancel_requested = v_hold, baseline_at = v_base,
         updated_at = now(), updated_by_name = me.name
   where tenant_id = me.tenant_id;
  return jsonb_build_object('ok', true, 'code', 'ok', 'enabled', v_en, 'hold_cancel_requested', v_hold, 'baseline_at', v_base);
end $$;

-- ── wh_board: «اتضربت مرتجع وJ&T سلّمتها» للأدمن ──
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
           x.carrier_status_code, x.carrier_status_at, x.awb_printed_at, x.created_at, x.stock_returned_at, x.status_changed_at,
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
      -- (15 أكتوبر — المراجعة) اتضرب مرتجع وبعدها J&T سلّمته للعميل = السكان كان غلط (F9 على طرد رايح): القطعة اتضافت
      -- للمخزن وهي عند العميل — الأدمن يتراجع عن السكان
      (o.in_scan_id is not null and lower(coalesce(o.status, '')) = 'delivered' and o.in_at < o.status_changed_at
         and o.in_at > now() - interval '30 days') as k_in_delivered,
      (v_base is not null and o.jt_first >= v_base and o.out_scan_id is null and o.leak_state is null and o.in_scan_id is null) as k_leak,
      (o.carrier_status_code = 'refund:94' and o.carrier_status_at > now() - interval '6 hours') as k_courier,
      (o.carrier_status_code in ('13', '111') and o.carrier_status_at >= coalesce(v_base, now())
         and o.carrier_status_at < now() - interval '2 hours' and o.in_scan_id is null) as k_closed_unscanned,
      (select string_agg(l.line_text || case when l.qty > 1 then ' ×' || l.qty else '' end, ' · ' order by l.line_no)
         from app.wh_order_lines(o.product_name) l) as items
      from o
  ), b as (
    -- «اتعمل جرد بعدها» بالمنتج — نفس قاعدة «اخصمه» بالحرف (app.wh_order_products2 = نفس حل wh_make_lines ·
    -- wh_last_count2 = جرد اتفتح بعدها أو «خرج قبل ما أعدّه»): all = كل منتجات الأوردر (اخصمه مش هيخصم حاجة) ·
    -- some = بعضها · 🔴 سطر مش مربوط بيتحسب «مااتعدّش» (كان بيتشال فالأوردر يبان all ويخرج من الشارة الحمرا)
    select b0.*,
      case when b0.k_leak then (
        select case when count(*) filter (where pp.product_id is not null) = 0 then null
                    when bool_and(pp.product_id is not null and app.wh_last_count2(me.tenant_id, pp.product_id, b0.jt_first, b0.id) is not null) then 'all'
                    when bool_or(pp.product_id is not null and app.wh_last_count2(me.tenant_id, pp.product_id, b0.jt_first, b0.id) is not null) then 'some'
                    end
          from app.wh_order_products2(b0.id) pp where pp.state <> 'ignored') end as counted_kind
      from b0
  )
  select jsonb_build_object(
    'ok', true,
    'enabled', coalesce(cfg.enabled, false),
    'baseline_at', v_base,
    'hold_cancel_requested', coalesce(cfg.hold_cancel_requested, true),
    'is_admin', me.is_admin,
    'returns', app.wh_returns_board(me.tenant_id, p_lite),
    'counts', jsonb_build_object(
      'not_scanned', count(*) filter (where k_not_scanned),
      'not_scanned_old', count(*) filter (where k_not_scanned and created_at < v_today),
      'pile', count(*) filter (where k_pile),
      'pull', count(*) filter (where k_pull),
      'leak', count(*) filter (where k_leak),
      'leak_cancelled', count(*) filter (where k_leak and status = 'cancelled'),
      'leak_counted', count(*) filter (where k_leak and counted_kind = 'all'),
      'in_delivered', count(*) filter (where k_in_delivered),
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
      'in_delivered', coalesce(jsonb_agg(jsonb_build_object('t', tracking_no, 'uid', order_uid, 'items', items, 'at', in_at,
                         'scan', in_scan_id, 'del_at', status_changed_at) order by in_at desc) filter (where k_in_delivered), '[]'::jsonb),
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

-- ── jt_apply_trace: التسليم بيعدّي «مرتجع مضروب» بسبب صريح في السجل ──
create or replace function app.jt_apply_trace(p_bill_code text, p_scan_type text, p_scan_code text, p_scan_at timestamp with time zone, p_desc text, p_by text default 'J&T API'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app'
as $function$
declare v_row orders; v_target text; v_final boolean; v_key text;
begin
  select * into v_row from orders where tracking_no = p_bill_code and shipping_carrier = 'jt' order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  -- (2) order:* خام بس — ومايلمسش أي حاجة لو فيه مسح تتبع اتسجّل قبل كده
  if coalesce(p_scan_code,'') like 'order:%' then
    if v_row.carrier_status_at is null then
      update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code where id = v_row.id;
    end if;
    return jsonb_build_object('ok', true, 'note', 'order_event', 'order_id', v_row.id);
  end if;
  if v_row.carrier_status_at is not null and p_scan_at is not null and p_scan_at < v_row.carrier_status_at then
    return jsonb_build_object('ok', true, 'note', 'stale', 'order_id', v_row.id);
  end if;
  -- (1) رحلة المرتجع: الساعة بتتقدّم، والحالة بتبقى «Returned to business» لو لسه ماتبقتش
  if coalesce(p_scan_code,'') like 'refund:%' then
    update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
      carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
    if v_row.status in ('Returned to business', 'Delivered') or lower(v_row.status) in ('returned','returned to business2') then
      return jsonb_build_object('ok', true, 'note', 'refund_journey', 'order_id', v_row.id);
    end if;
    update orders set status = 'Returned to business', status_changed_at = now(),
      status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'from', status, 'to', 'Returned to business',
        'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'by', coalesce(nullif(btrim(p_by), ''), 'J&T API'),
        'reason', left('رحلة مرتجع (مسح 172 ماوصلش): ' || coalesce(p_desc,''), 120)))
     where id = v_row.id;
    return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id,
      'status', 'Returned to business', 'inferred', 'refund_journey');
  end if;
  v_key := coalesce(nullif(btrim(coalesce(p_scan_code,'')), ''), 'name:' || lower(btrim(coalesce(p_scan_type,''))));
  select sahl_status into v_target from jt_status_map where scan_type_code = v_key;
  -- (3) مش في الخريطة: ولا حرف بيتكتب — الساعة مابتتقدّمش فالمصالحة بتعيد المحاولة
  if not found then return jsonb_build_object('ok', true, 'note', 'unmapped', 'order_id', v_row.id, 'key', v_key); end if;
  update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
    carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
  -- (4) في الخريطة بـNULL = خام بس (Holding / 120 — محجوزة في فرع): الحالة ماتتغيّرش
  if v_target is null then return jsonb_build_object('ok', true, 'note', 'raw_only', 'order_id', v_row.id, 'key', v_key); end if;
  -- (5) «مرتجع مضروب» = المخزن ضرب المرتجع وهو في إيده (15 أكتوبر): أي مسح J&T بعده (13/111/172 «رجع للتاجر» اتأخر)
  -- مايرجّعهوش لـ«مرتجع» — الخام والساعة اتكتبوا فوق، الحالة بس اللي بتفضل. 🔴 إلا التسليم (المراجعة): J&T سلّمته للعميل
  -- = ده اللي حصل فعلاً (نفس قاعدة «مسح التسليم بيدوس أي حالة نهائية») — كان بيتبلع ويفضل «مرتجع» والفلوس اتحصّلت
  if v_row.status = 'Returned to business2' and v_target is distinct from 'Delivered' then
    return jsonb_build_object('ok', true, 'note', 'warehouse_return_kept', 'order_id', v_row.id);
  end if;
  if v_target = v_row.status then return jsonb_build_object('ok', true, 'note', 'same_status', 'order_id', v_row.id); end if;
  v_final := lower(v_row.status) in ('delivered','returned','returned to business','returned to business2','cancelled');
  if v_final and v_target not in ('Delivered','Returned to business') then
    return jsonb_build_object('ok', true, 'note', 'final_state_kept', 'order_id', v_row.id);
  end if;
  update orders set status = v_target, status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', v_target,
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', coalesce(nullif(btrim(p_by), ''), 'J&T API'),
      'reason', case when v_row.status = 'Returned to business2'
                     then left('J&T سلّمته بعد ما المخزن ضربه مرتجع · ' || coalesce(p_desc,''), 120)
                     else nullif(left(coalesce(p_desc,''),120),'') end))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $function$;

-- ── tg_log_status_change: زي ما هي (تاريخ التعليق اتصحّح لـ15 أكتوبر) ──
create or replace function public.tg_log_status_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_log     jsonb;
  v_last    jsonb;
  v_by      text;
  v_to      text;
  v_chat_id text;
  v_token   text;
  v_action  text;
  v_msg     text;
  v_time    text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if coalesce(new.status_log::text,'') = '' then return new; end if;

  if jsonb_typeof(new.status_log) = 'string' then
    v_log := (new.status_log #>> '{}')::jsonb;
  else
    v_log := new.status_log;
  end if;
  if v_log is null or jsonb_typeof(v_log) <> 'array' or jsonb_array_length(v_log) = 0 then return new; end if;

  v_last := v_log -> (jsonb_array_length(v_log) - 1);
  v_to := coalesce(v_last->>'to','');
  v_by := coalesce(v_last->>'by','');

  if v_to is distinct from new.status then return new; end if;
  if v_by = '' then return new; end if;

  v_time := to_char((now() at time zone 'Africa/Cairo'), 'HH24:MI');

  -- تأكيد أو إلغاء من العميل نفسه عبر الواتساب
  if (v_by ilike '%واتساب%' or v_by ilike '%whatsapp%')
     and lower(new.status) in ('confirmed','cancelled') then

    -- (جديد) تفضيلات التاجر
    if lower(new.status) = 'confirmed'
       and not public.notify_enabled(new.tenant_id,'confirmations') then return new; end if;
    if lower(new.status) = 'cancelled'
       and not public.notify_enabled(new.tenant_id,'cancellations') then return new; end if;

    select telegram_chat_id into v_chat_id from public.tenants where id = new.tenant_id;
    if coalesce(v_chat_id,'') = '' then return new; end if;

    select decrypted_secret into v_token
      from vault.decrypted_secrets where name = 'ops_bot_token' limit 1;
    if coalesce(v_token,'') = '' then return new; end if;

    if lower(new.status) = 'confirmed' then
      v_msg := '✅ العميل أكّد الأوردر على واتساب' || E'\n\n';
    else
      v_msg := '❌ العميل ألغى الأوردر على واتساب' || E'\n\n';
    end if;

    v_msg := v_msg
      || '🛍️ ' || coalesce(new.customer_name,'—') || ' (' || coalesce(new.phone,'—') || ')' || E'\n'
      || case when coalesce(new.product_name,'')<>'' then '📦 ' || new.product_name || E'\n' else '' end
      || case when new.total_cost is not null then '💰 ' || trim(to_char(new.total_cost,'FM999999990.00')) || ' ج' || E'\n' else '' end
      || '🕐 ' || v_time;

    perform net.http_post(
      url  => 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      body => jsonb_build_object('chat_id', v_chat_id, 'text', v_msg),
      timeout_milliseconds => 15000
    );

    return new;
  end if;

  -- استبعد باقي المصادر الأوتوماتيك
  if v_by ilike '%واتساب%' or v_by ilike '%whatsapp%'
     or v_by ilike '%bosta%' or v_by = 'بوسطة' or v_by ilike '%api%' or v_by = 'البوت'
     or v_by ilike '%system%' or v_by ilike '%النظام%' or v_by = 'النظام'
     -- (15 أكتوبر) سكانر المخزن (📷): ~30–60 طرد في اليوم — رسالة لكل طرد كانت هتغرق الجروب، والمتابعة في صفحة المخزن
     or v_by like '📷%'
  then return new; end if;

  -- (جديد) حركة موظف → تفضيل staff_activity
  if not public.notify_enabled(new.tenant_id,'staff_activity') then return new; end if;

  select telegram_chat_id into v_chat_id from public.tenants where id = new.tenant_id;
  if coalesce(v_chat_id, '') = '' then return new; end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'ops_bot_token' limit 1;
  if coalesce(v_token, '') = '' then return new; end if;

  v_action := case new.status
    when 'confirmed' then 'أكّد الأوردر ✅'
    when 'cancelled' then 'ألغى الأوردر ❌'
    when 'returned' then 'رجّع الأوردر ↩️'
    when 'pending' then 'رجّع الأوردر لقيد الانتظار ⏳'
    when 'bosta_assigned' then 'بعت الأوردر لبوسطة 🚚'
    when 'BOSTA AUTO' then 'بعت الأوردر لبوسطة 🚚'
    when 'bosta_auto' then 'بعت الأوردر لبوسطة 🚚'
    when 'BOSTA2' then 'بعت الأوردر لبوسطة 🚚'
    when 'bosta2' then 'بعت الأوردر لبوسطة 🚚'
    when 'delivered' then 'سلّم الأوردر 📦'
    when 'Delivered' then 'سلّم الأوردر 📦'
    when 'failed' then 'علّم الأوردر فاشل ⚠️'
    else 'غيّر حالة الأوردر لـ ' || new.status
  end;

  v_msg := '👤 ' || v_by || ' ' || v_action || E'\n'
    -- (3 أكتوبر) أوردر استبدال: رقم الأصلي ومبلغ التحصيل — من غيرها التأكيد بيتقري «بيعة جديدة»
    || case when new.exchange_of is not null then
         '🔁 استبدال لأوردر #' || coalesce((select o2.order_uid from public.orders o2 where o2.id = new.exchange_of and o2.tenant_id = new.tenant_id), '—')
         || ' · التحصيل ' || trim(to_char(coalesce(new.total_cost, 0), 'FM999999990.00')) || ' ج' || E'\n'
       else '' end
    || '🛍️ العميل: ' || coalesce(new.customer_name,'—') || ' (' || coalesce(new.phone,'—') || ')' || E'\n'
    || case when coalesce(new.product_name,'')<>'' then '📦 ' || new.product_name || E'\n' else '' end
    || case when new.status in ('bosta_assigned','BOSTA AUTO','bosta_auto','BOSTA2','bosta2')
              and coalesce(new.tracking_no,'')<>'' then '🚚 تتبّع: ' || new.tracking_no || E'\n' else '' end
    || '🕐 الساعة: ' || v_time;

  perform net.http_post(
    url  => 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body => jsonb_build_object('chat_id', v_chat_id, 'text', v_msg),
    timeout_milliseconds => 15000
  );

  return new;
exception when others then
  return new;
end;
$function$;

-- ── ربط المنتجات: علامة «راجع» للمقاسات اللي منتجها اسمه شبه ──
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
           'alias_props', ap.product_id, 'alias_props_ignore', ap.ignore,
           -- (15 أكتوبر — المراجعة) «⚠️ راجع»: اتربط بالاسم (exact) والسطر ليه خاصية، وفيه منتج تاني اسمه بيبدأ بنفس الاسم
           -- («منظم المطبخ المتكامل» و«… مقاس ٦٥»): «مقاس 65 عرض» كان بيتخصم من الـ85 في صمت وبيبان ✅
           'sibling', (r.matched_by = 'exact' and g.props <> '' and exists (
              select 1 from stock_products p2
               where p2.tenant_id = me.tenant_id and coalesce(p2.active, true) and p2.parent_id is null
                 and p2.id is distinct from r.product_id
                 and left(app.wh_key(p2.name), char_length(g.item_key) + 1) = g.item_key || ' ')))
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

revoke all on function public.wh_start_check() from public, anon;
grant execute on function public.wh_start_check() to authenticated;
revoke all on function public.wh_product_pile(uuid) from public, anon;
grant execute on function public.wh_product_pile(uuid) to authenticated;
