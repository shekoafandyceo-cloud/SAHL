-- سكانر المخزن — إصلاحات المراجعة العدائية الخامسة (15 أكتوبر · Workflow على migration E: 9 مؤكدة من 9)
-- الجداول كانت فاضية وقت التطبيق (وضع تجربة — صفر جرد وصفر سكان) فمفيش نقل داتا.
--
--  1) 🔴 مرتجع J&T سلّمه لنا **وانت بتعدّ** لطرد **عمره ما اتخصم** (خرج قبل التشغيل · خرج من غير سكان · «اخصمه» اتلغى بجرد)
--     ماكانش بيتسأل عليه، والسكان بعدها بيضيفه +1 حتى لو اتعدّ = قطعة زيادة. المرتجعات بتوصل الضهر (94 من 123 آخر أسبوعين بين
--     11 و1) وأي جرد بالنهار هيلاقيها. دلوقتي بيتسأل (ret · posted=true): «اتعدّ» = بيتطرح دلوقتي والسكان يضيفه = صح ·
--     «ماتعدّش» = لا طرح والسكان يضيفه = صح. نفس منطق المرتجع اللي اتخصم بالظبط.
--  2) 🔴 طرد **اتضرب خروج وانت بتعدّ** ولسه في الكومة مابيتطرحش (الكومة كانت للسكانات قبل الفتح بس) والتحذير بيقول «طبّق
--     برضه» = قطعة زيادة. wh_pile_lines2 بقت بتشمل سكانات الخروج بعد الفتح: لسه في الكومة = بيتطرح · المندوب أخده = السؤال.
--     scans_during_count بقى للمرتجع اللي اتضرب (اتضاف) والسطور المش مربوطة بس.
--  3) مرتجع «خرج من غير سكان» فيه سطر **مش مربوط**: wh_in_settle كان بيلغيه (void) من غير ما يبص على الجرد — جرد شال المنتج
--     وهو برّه = القطعة عمرها ما ترجع بعد الربط. القرار بقى وقت الربط (wh_repost) بنفس القاعدة بالمنتج.
--  4) wh_count_pile بيرجّع pile_list (الطرود اللي في الكومة لكل منتج — الواجهة بتوريها على «غير موزع»).

-- الطرود اللي ممكن تكون في المخزن عند لحظة p_at (فتح الجرد) — posted = بيتطرح لو «اتعدّ» (اتخصم · أو السكان هيضيفه):
--   pile  = اتضربت خروج (قبل الفتح **أو وانت بتعدّ**) وJ&T عمرها ما مسحتها — لسه في الكومة → بتتطرح دايماً
--   moved = أول مسح J&T **بعد** فتح الجرد (اتسلّمت للمندوب وانت بتعدّ — اتعدّت ولا لأ؟) · «متسلّم» مابيشيلهاش ·
--           ومعاها اللي خرجت **من غير سكان** وانت بتعدّ (posted=false — بتتسأل بس: عمرها ما اتخصمت، والإجابة بتحكم «اخصمه»)
--   ret   = J&T سلّمتها لنا (13/111) ومحدش ضربها مرتجع: اتخصمت (قبل الجرد أو وانت بتعدّ) · أو **عمرها ما اتخصمت** ورجعت
--           وانت بتعدّ (السكان بعدها هيضيفها — فـ«اتعدّ» لازم يتطرح دلوقتي)
create or replace function app.wh_pile_lines2(p_tenant uuid, p_at timestamptz)
returns table(order_id uuid, product_id uuid, qty int, kind text, posted boolean)
language sql stable
set search_path = public, app, pg_temp
as $$
  select st.order_id, l.product_id, l.qty,
         case when x.first_at is null then 'pile' when x.first_at >= p_at then 'moved' else 'ret' end, true
    from wh_order_stock st
    join wh_scans s on s.id = st.out_scan_id
    join orders o on o.id = st.order_id
    cross join lateral (select min(coalesce(j.t, j.rx)) as first_at,
                               min(coalesce(j.t, j.rx)) filter (where j.code in ('13', '111')) as ret_at
                          from app.jt_bill_scans(o.id, o.tenant_id, o.tracking_no) j) x
    join wh_scan_lines l on l.scan_id = s.id
   where st.tenant_id = p_tenant and st.in_scan_id is null and s.reversed_at is null
     and s.created_at > p_at - interval '365 days'
     and (x.first_at >= p_at or lower(coalesce(o.status, '')) <> 'delivered')
     and l.dir = 'out' and l.state = 'posted' and l.movement_id is not null and l.product_id is not null
     and (x.first_at is null or x.first_at >= p_at or x.ret_at is not null)
  union all
  select o.id, pp.product_id, pp.q,
         case when x.first_at >= p_at then 'moved' else 'ret' end,
         x.first_at < p_at
    from orders o
    left join wh_order_stock st on st.order_id = o.id
    cross join lateral (select min(coalesce(j.t, j.rx)) as first_at,
                               min(coalesce(j.t, j.rx)) filter (where j.code in ('13', '111')) as ret_at
                          from app.jt_bill_scans(o.id, o.tenant_id, o.tracking_no) j) x
    cross join lateral (
      -- مالوش سكان خروج: منتجات الأوردر زي ما السكان هيحلّها
      select r.product_id, sum(r.qty)::int as q from app.wh_order_products2(o.id) r
       where st.out_scan_id is null and r.state = 'posted' and r.product_id is not null group by r.product_id
      union all
      -- «اخصمه» اتلغى بجرد (superseded — مفيش حركة): نفس سطوره
      select l.product_id, sum(l.qty)::int from wh_scan_lines l
       where st.out_scan_id is not null and l.scan_id = st.out_scan_id and l.dir = 'out' and l.state = 'superseded'
         and l.product_id is not null
       group by l.product_id) pp
   where o.tenant_id = p_tenant and o.shipping_carrier = 'jt' and o.tracking_no is not null
     and o.created_at > p_at - interval '90 days'
     and st.in_scan_id is null
     and ((st.out_scan_id is null and coalesce(st.leak_state, '') <> 'dismissed' and x.first_at >= p_at)
          or (x.first_at < p_at and x.ret_at >= p_at))
$$;

-- سطور «رجوع» اتعملت من الأوردر (مش مرآة لخروج اتخصم): p_away = إمتى خرج (أول مسح J&T) · p_back = إمتى J&T
-- سلّمته لنا (13/111) · p_need_count = عمره ما اتخصم (خرج من غير سكان) فمايتضافش غير لو جرد شاله وهو برّه
-- (اتفتح بعد ما خرج — أو خرج وانت بتعدّ والإجابة «قبل ما أعدّه»: wh_last_count2 بالأوردر من السكان)
create or replace function app.wh_in_settle(p_scan_id bigint, p_tenant uuid, p_away timestamptz, p_back timestamptz, p_need_count boolean)
returns void language plpgsql
set search_path = public, app, pg_temp
as $$
declare l record; v_lc timestamptz; v_order uuid;
begin
  select s.order_id into v_order from wh_scans s where s.id = p_scan_id;
  for l in select x.id, x.state, x.product_id from wh_scan_lines x where x.scan_id = p_scan_id order by x.id for update loop
    if l.state = 'posted' and l.product_id is not null then
      v_lc := app.wh_last_count2(p_tenant, l.product_id, p_away, v_order);
      if p_back is not null and v_lc is not null and v_lc > p_back then
        update wh_scan_lines set state = 'superseded', note = 'اتعدّ في جرد بعد ما رجع — مفيش إضافة تاني', resolved_at = now() where id = l.id;
      elsif p_need_count and v_lc is null then
        update wh_scan_lines set state = 'void', note = 'خرج من غير سكان — عمره ما اتخصم', resolved_at = now() where id = l.id;
      end if;
    end if;
    -- 🔴 السطر المش مربوط/المتجاهَل مابيتلغيش هنا: منتجه مش معروف، فمانعرفش جرد شاله وهو برّه ولا لأ — القرار وقت
    -- الربط (wh_repost: مفيش جرد بعد ما خرج = void · جرد بعد ما رجع = superseded · غير كده = بيتضاف)
  end loop;
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
    -- أو السكان (الأبدري) · طرد عمره ما خرج = مفيش حركة (الخروج والرجوع بيلغوا بعض) — إلا المرتجع اليدوي
    -- (in_kind='manual': مالوش سطر خروج يلغيه) = لحظة السكان، وإلا جرد بعده + ربط = القطعة مرتين
    v_m := case when v_first is null then
                  case when l.dir = 'in' and exists (select 1 from wh_order_stock st where st.order_id = l.order_id
                                                         and st.in_scan_id = l.scan_id and st.in_kind = 'manual')
                       then l.created_at end
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
    -- مرتجع «خرج من غير سكان» (عمره ما اتخصم): مفيش جرد شال المنتج وهو برّه = مفيش إضافة (نفس wh_in_settle بالمنتج)
    if l.dir = 'in' and exists (select 1 from wh_order_stock st where st.order_id = l.order_id and st.in_scan_id = l.scan_id
                                    and st.in_kind = 'leak' and st.leak_state is distinct from 'dismissed')
       and app.wh_last_count2(p_tenant, r.product_id, v_first, l.order_id) is null then
      update wh_scan_lines set state = 'void', product_id = r.product_id, matched_by = r.matched_by,
             note = 'خرج من غير سكان — عمره ما اتخصم', resolved_at = now(), resolved_by_name = p_by where id = l.id;
      v_void := v_void + 1; continue;
    end if;
    if v_m is not null and (case when l.dir = 'out' then app.wh_last_count2(p_tenant, r.product_id, v_m, l.order_id)
                                 else app.wh_last_count(p_tenant, r.product_id, v_m) end) is not null then
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
  v_pile jsonb := '{}'::jsonb; v_pq int; v_tgt int; v_pile_total int := 0;
  v_opts jsonb; v_need jsonb; v_dur_in int;
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
    -- بيجاوب **لكل منتج** (wh_count_opts — منتج اتعدّ قبل المندوب وتاني بعده = إجابتين مختلفتين) وعلى **الطرود اللي
    -- شافها بس**: أي طرد للمنتج مش في الإجابة (ظهر بعدها) = السؤال تاني. «الكومة» (pile) بتتطرح دايماً ·
    -- الطرود اللي خرجت من غير سكان (posted=false) بتتسأل بس مابتتطرحش (عمرها ما اتخصمت — الإجابة بتحكم «اخصمه»)
    v_opts := coalesce(c.pile_opts, '{}'::jsonb);
    select coalesce(jsonb_agg(distinct pl.product_id::text), '[]'::jsonb) into v_need
      from app.wh_pile_lines2(me.tenant_id, c.opened_at) pl
     where pl.kind in ('moved', 'ret') and pl.product_id = any(v_ids)
       and not coalesce((v_opts -> pl.kind -> (pl.product_id::text) -> 'ids') ? (pl.order_id::text), false);
    if jsonb_array_length(v_need) > 0 then
      return jsonb_build_object('ok', false, 'code', 'pile_questions', 'products', v_need);
    end if;
    select coalesce(jsonb_object_agg(x.product_id::text, x.q), '{}'::jsonb) into v_pile
      from (select pl.product_id, sum(pl.qty)::int as q from app.wh_pile_lines2(me.tenant_id, c.opened_at) pl
             where pl.posted and (pl.kind = 'pile'
                    or (pl.kind in ('moved', 'ret') and (v_opts -> pl.kind -> (pl.product_id::text) ->> 'v') = 'counted'))
             group by pl.product_id) x;
    -- سكانات وانت بتعدّ: الخروج **محسوب** (wh_pile_lines2 بقت بتشمل الطرود اللي اتضربت خروج بعد فتح الجرد — كومة بتتطرح
    -- أو اتسلّمت وعليها سؤال) · فاضل المرتجع اللي اتضرب (اتضاف — اتعدّ ولا لأ؟) والسطور المش مربوطة
    if not coalesce(p_force, false) then
      select count(*) filter (where l.state = 'posted' and l.product_id = any(v_ids) and l.dir = 'in'),
             count(*) filter (where l.state in ('unmatched', 'ignored')),
             count(*) filter (where l.state = 'posted' and l.product_id = any(v_ids) and l.dir = 'in')
        into v_dur_posted, v_dur_unm, v_dur_in
        from wh_scan_lines l join wh_scans s on s.id = l.scan_id
       where l.tenant_id = me.tenant_id and s.created_at > c.opened_at and s.reversed_at is null;
      if v_dur_posted > 0 or v_dur_unm > 0 then
        return jsonb_build_object('ok', false, 'code', 'scans_during_count', 'posted', v_dur_posted, 'unmatched', v_dur_unm,
                                  'posted_in', v_dur_in);
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

-- الأرقام دي للواجهة قبل التطبيق — نفس الدالة ونفس شرط wh_count_apply بالحرف: صف لكل منتج بالنوع + الطرود (ids والقوايم)
-- + الإجابة + «محتاج إجابة» (طرد للمنتج مش في الإجابة)
create or replace function public.wh_count_pile()
returns jsonb language plpgsql security definer stable
set search_path = public, app, pg_temp
as $$
declare me record; c record; o jsonb;
begin
  select * into me from app.wh_me();
  if me.uid is null or not me.is_admin then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select x.* into c from stock_counts x where x.tenant_id = me.tenant_id and x.applied_at is null and x.cancelled_at is null;
  if c.id is null then return jsonb_build_object('ok', true, 'count_id', null, 'pile', '[]'::jsonb, 'opts', '{}'::jsonb,
                                                 'pile_orders', 0, 'moved_orders', 0, 'ret_orders', 0, 'moved_need', 0, 'ret_need', 0); end if;
  o := coalesce(c.pile_opts, '{}'::jsonb);
  return (
    with pl as materialized (select * from app.wh_pile_lines2(me.tenant_id, c.opened_at)),
    pq as (
      select pl.product_id,
             coalesce(sum(pl.qty) filter (where pl.kind = 'pile'), 0)::int as p,
             coalesce(sum(pl.qty) filter (where pl.kind = 'moved' and pl.posted), 0)::int as m,
             coalesce(sum(pl.qty) filter (where pl.kind = 'moved' and not pl.posted), 0)::int as ml,
             coalesce(sum(pl.qty) filter (where pl.kind = 'ret'), 0)::int as r,
             coalesce(jsonb_agg(distinct pl.order_id::text) filter (where pl.kind = 'moved'), '[]'::jsonb) as mids,
             coalesce(jsonb_agg(distinct pl.order_id::text) filter (where pl.kind = 'ret'), '[]'::jsonb) as rids,
             coalesce(bool_or(pl.kind = 'moved' and not coalesce((o -> 'moved' -> (pl.product_id::text) -> 'ids') ? (pl.order_id::text), false)), false) as mneed,
             coalesce(bool_or(pl.kind = 'ret' and not coalesce((o -> 'ret' -> (pl.product_id::text) -> 'ids') ? (pl.order_id::text), false)), false) as rneed
        from pl group by pl.product_id)
    select jsonb_build_object('ok', true, 'count_id', c.id, 'opts', o,
      'pile', coalesce((select jsonb_agg(jsonb_build_object(
                 'product_id', pq.product_id, 'pile', pq.p, 'moved', pq.m, 'moved_leak', pq.ml, 'ret', pq.r,
                 'moved_ids', pq.mids, 'ret_ids', pq.rids,
                 'moved_ans', o -> 'moved' -> (pq.product_id::text) ->> 'v', 'ret_ans', o -> 'ret' -> (pq.product_id::text) ->> 'v',
                 'moved_by', o -> 'moved' -> (pq.product_id::text) ->> 'by', 'ret_by', o -> 'ret' -> (pq.product_id::text) ->> 'by',
                 'moved_need', pq.mneed, 'ret_need', pq.rneed,
                 'moved_list', (select coalesce(jsonb_agg(jsonb_build_object('uid', oo.order_uid, 't', right(oo.tracking_no, 8), 'leak', not z.posted)
                                                order by oo.order_uid), '[]'::jsonb)
                                  from (select distinct pl.order_id, pl.posted from pl where pl.kind = 'moved' and pl.product_id = pq.product_id limit 30) z
                                  join orders oo on oo.id = z.order_id),
                 'ret_list', (select coalesce(jsonb_agg(jsonb_build_object('uid', oo.order_uid, 't', right(oo.tracking_no, 8)) order by oo.order_uid), '[]'::jsonb)
                                from (select distinct pl.order_id from pl where pl.kind = 'ret' and pl.product_id = pq.product_id limit 30) z
                                join orders oo on oo.id = z.order_id),
                 'pile_list', (select coalesce(jsonb_agg(jsonb_build_object('uid', oo.order_uid, 't', right(oo.tracking_no, 8)) order by oo.order_uid), '[]'::jsonb)
                                 from (select distinct pl.order_id from pl where pl.kind = 'pile' and pl.product_id = pq.product_id limit 30) z
                                 join orders oo on oo.id = z.order_id)))
          from pq), '[]'::jsonb),
      'pile_orders', (select count(distinct pl.order_id) from pl where pl.kind = 'pile'),
      'moved_orders', (select count(distinct pl.order_id) from pl where pl.kind = 'moved'),
      'ret_orders', (select count(distinct pl.order_id) from pl where pl.kind = 'ret'),
      'moved_need', (select count(*) from pq where pq.mneed),
      'ret_need', (select count(*) from pq where pq.rneed)));
end $$;

-- الصلاحيات
revoke all on function app.wh_pile_lines2(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.wh_in_settle(bigint, uuid, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function app.wh_repost(uuid, text, text) from public, anon, authenticated;
revoke all on function public.wh_count_pile() from public, anon;
grant execute on function public.wh_count_pile() to authenticated;
revoke all on function public.wh_count_apply(bigint, jsonb, boolean, boolean) from public, anon;
grant execute on function public.wh_count_apply(bigint, jsonb, boolean, boolean) to authenticated;
