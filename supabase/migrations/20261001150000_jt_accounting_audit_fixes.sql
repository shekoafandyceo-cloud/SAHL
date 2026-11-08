-- مراجعة الحسابات الشاملة (1 أكتوبر — طلب المالك: «الحسابات تكون مظبوطة بالشعرة»)
--
-- كل بند هنا اتقاس على الحي قبل ما يتكتب (مراجعة read-only على 221 بوليصة + trace/getOrders
-- من J&T). التفاصيل والأرقام في CLAUDE.md قسم «مراجعة الحسابات — 1 أكتوبر».
--
-- 1) 🔴 مسح 172 الضايع = أوردر راجع بيفضل «في السكة»: لو الـpush ضيّع «172 Returned parcel
--    scan» ووصل بعده مسح من رحلة المرتجع، الدالة كانت بتقدّم الساعة ومابتغيّرش الحالة —
--    والمصالحة مابتطبّقش غير الأحدث من الساعة، فالـ172 اتدفن. 17453 فضل «In transit»
--    20 ساعة فوق آخر يوم في الشهر (1,285 ج في «متوقع التحصيل» وهو مرتجع).
--    الإصلاح: مسح رحلة مرتجع = المرتجع بدأ **أكيد** (265/265 مسح refund في الـpull جايين
--    بعد 172، وisRefund في الـpush طابق الاستنتاج 100%) → «Returned to business».
-- 2) order:* مابقاش بيعطّل حارس stale — بيكتب الخام بس لو مفيش أي مسح تتبع لسه
--    (carrier_status_at فاضي). قبل كده كان بيكتب فوق كود فاضي (Holding/Enter branch)
--    وبعدها أي مسح قديم متأخر كان بيعدّي ويرجّع الحالة لورا. اتقاس: صفر صف شكله كده دلوقتي.
-- 3) مسح مش في الخريطة (unmapped) مابقاش بيقدّم الساعة — كان بيستهلك وقته في صمت، ولو
--    اتضافت خريطته بعدين المصالحة عمرها ما كانت هترجع تطبّقه. دلوقتي بيفضل «أحدث» من
--    الساعة فالمصالحة بتعيد محاولته كل دورة، وjt_sync_health بتعدّه.
-- 4) jt_cod_amount = الـCOD اللي J&T بتحصّله فعلاً (itemsValue من getOrders) — مش
--    total_cost. 3 من 223 أوردر مختلفين (17260 +226 · 17399 −100 · 17359 −5): الإجمالي
--    اتعدّل في سهل بعد الشحن أو الـCOD اتعدّل في بوابة J&T. رسوم الـCOD (1%) بقت على
--    مبلغ J&T، والاختلاف بقى ظاهر للأدمن بدل ما يعدّي في صمت.
-- 5) jt_apply_fee: isSign فاضي مابقاش بيمسح تكلفة نهائية · فرع «settlement_wins» بقى
--    بيحدّث jt_fee_for_status ورسوم COD (كان بيرجّع الأوردر مرشّح كل 25 دقيقة للأبد).
-- 6) jt_sync_health: صحة fee_sync (مسلّم من غير تكلفة نهائية > 24 ساعة) · unmapped ·
--    اختلاف الـCOD — كل اللي ممكن يخلّي رقم يكدب في صمت بقى ليه تنبيه.

-- 4) الـCOD الحقيقي عند J&T
alter table public.orders add column if not exists jt_cod_amount numeric(12,2);
alter table public.orders add column if not exists jt_cod_synced_at timestamptz;
comment on column public.orders.jt_cod_amount is
  'COD المسجّل عند J&T (getOrders itemsValue) — اللي هيتحصّل فعلاً. بيتحدّث من trace_sync. مختلف عن total_cost = إجمالي اتعدّل بعد الشحن (أو في البوابة).';

-- 1+2+3) jt_apply_trace
create or replace function app.jt_apply_trace(p_bill_code text, p_scan_type text, p_scan_code text,
  p_scan_at timestamptz, p_desc text, p_by text default 'J&T API')
returns jsonb language plpgsql security definer set search_path to 'public', 'app' as $function$
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
  if v_target is null then return jsonb_build_object('ok', true, 'note', 'unmapped', 'order_id', v_row.id, 'key', v_key); end if;
  update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
    carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
  if v_target = v_row.status then return jsonb_build_object('ok', true, 'note', 'same_status', 'order_id', v_row.id); end if;
  v_final := lower(v_row.status) in ('delivered','returned','returned to business','returned to business2','cancelled');
  if v_final and v_target not in ('Delivered','Returned to business') then
    return jsonb_build_object('ok', true, 'note', 'final_state_kept', 'order_id', v_row.id);
  end if;
  update orders set status = v_target, status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', v_target,
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', coalesce(nullif(btrim(p_by), ''), 'J&T API'), 'reason', nullif(left(coalesce(p_desc,''),120),'')))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $function$;

-- 4+5) jt_apply_fee
create or replace function app.jt_apply_fee(p_bill_code text, p_freight numeric, p_charge_weight numeric, p_is_sign integer, p_source text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app' as $function$
declare r orders; s text; v_cod numeric; v_final boolean; v_deliv boolean; v_ret boolean; v_sign integer;
begin
  select * into r from orders where tracking_no = p_bill_code and shipping_carrier = 'jt'
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  if p_freight is null or p_freight <= 0 then
    update orders set jt_fee_synced_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'note', 'no_data', 'order_id', r.id);
  end if;
  -- (5) الفاتورة بتكسب — بس رسوم COD وjt_fee_for_status لازم يمشوا مع الحالة الحالية،
  --     وإلا الأوردر بيفضل مرشّح كل 25 دقيقة للأبد
  if p_source <> 'settlement' and r.jt_fee_source = 'settlement' then
    v_cod := app.jt_cod_fee_for(r.status, coalesce(r.jt_cod_amount, r.total_cost));
    update orders set jt_fee_synced_at = now(), jt_cod_fee = v_cod, jt_fee_for_status = r.status,
      real_shipping_fee = round(coalesce(r.jt_freight, 0) + coalesce(v_cod, 0), 2)
     where id = r.id;
    return jsonb_build_object('ok', true, 'note', 'settlement_wins', 'order_id', r.id);
  end if;
  s := lower(coalesce(r.status,''));
  v_deliv := s = 'delivered';
  v_ret := s in ('returned','returned to business','returned to business2');
  -- (4) رسوم COD على المبلغ اللي J&T بتحصّله فعلاً
  v_cod := app.jt_cod_fee_for(r.status, coalesce(r.jt_cod_amount, r.total_cost));
  -- (5) isSign غايب ≠ «لسه مااتقفلش»: آخر قيمة معروفة بتفضل
  v_sign := coalesce(p_is_sign, r.jt_is_sign);
  v_final := p_source = 'settlement'
          or (v_deliv and v_sign = 1)
          or (v_ret and v_sign = 2);
  update orders set
    jt_freight = p_freight,
    jt_charge_weight_kg = coalesce(p_charge_weight, jt_charge_weight_kg),
    jt_is_sign = coalesce(p_is_sign, jt_is_sign),
    jt_cod_fee = v_cod,
    jt_fee_source = p_source,
    jt_fee_for_status = r.status,
    jt_fee_synced_at = now(),
    jt_fee_final = v_final,
    real_shipping_fee = case when v_final then round(p_freight + coalesce(v_cod,0), 2)
                             when r.jt_fee_final then null
                             else real_shipping_fee end,
    real_shipping_fee_at = case when v_final then now()
                                when r.jt_fee_final then null
                                else real_shipping_fee_at end
   where id = r.id;
  return jsonb_build_object('ok', true, 'note', case when v_final then 'final' else 'provisional' end,
    'order_id', r.id, 'freight', p_freight, 'cod_fee', v_cod,
    'fee', case when v_final then round(p_freight + coalesce(v_cod,0), 2) end);
end $function$;

-- 4) تسجيل الـCOD من J&T — ولو التكلفة نهائية والمبلغ اتغيّر، رسوم COD بتتحسب تاني
create or replace function app.jt_set_cod(p_bill_code text, p_cod numeric)
returns jsonb language plpgsql security definer set search_path to 'public', 'app' as $function$
declare r orders; v_fee numeric;
begin
  if p_cod is null or p_cod < 0 then return jsonb_build_object('ok', false, 'note', 'bad_cod'); end if;
  select * into r from orders where tracking_no = p_bill_code and shipping_carrier = 'jt'
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  if r.jt_cod_amount is not distinct from round(p_cod, 2) then
    update orders set jt_cod_synced_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'note', case when round(p_cod,2) = r.total_cost then 'same' else 'same_mismatch' end, 'order_id', r.id);
  end if;
  if r.jt_fee_final and r.jt_freight is not null then
    v_fee := app.jt_cod_fee_for(r.status, p_cod);
    update orders set jt_cod_amount = round(p_cod, 2), jt_cod_synced_at = now(), jt_cod_fee = v_fee,
      real_shipping_fee = round(r.jt_freight + coalesce(v_fee, 0), 2)
     where id = r.id;
  else
    update orders set jt_cod_amount = round(p_cod, 2), jt_cod_synced_at = now() where id = r.id;
  end if;
  return jsonb_build_object('ok', true, 'order_id', r.id,
    'note', case when round(p_cod,2) = r.total_cost then 'set' else 'set_mismatch' end);
end $function$;

-- المرشّحين: كل اللي لسه في السكة (الـCOD ممكن يتعدّل في البوابة لحد التسليم) + أي
-- أوردر عمره ما اتسجّل له COD أو اتسجّل قبل آخر تغيير حالة (يعني قبل ما يتقفل)
create or replace function app.jt_cod_candidates(p_limit integer default 300)
returns table(bill_code text) language sql stable security definer set search_path to 'public', 'app' as $function$
  select o.tracking_no from orders o
   where o.shipping_carrier = 'jt' and coalesce(o.tracking_no,'') <> ''
     and o.created_at > now() - interval '90 days'
     and (o.jt_cod_synced_at is null
          or o.status not in ('Delivered', 'Returned to business', 'cancelled')
          or o.jt_cod_synced_at < o.status_changed_at)
   order by o.jt_cod_synced_at nulls first, o.created_at
   limit greatest(1, least(coalesce(p_limit, 300), 1000));
$function$;

create or replace function public.jt_set_cod_v1(p_bill_code text, p_cod numeric)
returns jsonb language sql security definer set search_path to 'public', 'app' as $function$
  select app.jt_set_cod(p_bill_code, p_cod); $function$;
create or replace function public.jt_cod_candidates_v1(p_limit integer default 300)
returns table(bill_code text) language sql security definer set search_path to 'public', 'app' as $function$
  select * from app.jt_cod_candidates(p_limit); $function$;
revoke all on function app.jt_set_cod(text, numeric) from public, anon, authenticated;
revoke all on function app.jt_cod_candidates(integer) from public, anon, authenticated;
revoke all on function public.jt_set_cod_v1(text, numeric) from public, anon, authenticated;
revoke all on function public.jt_cod_candidates_v1(integer) from public, anon, authenticated;
grant execute on function public.jt_set_cod_v1(text, numeric) to service_role;
grant execute on function public.jt_cod_candidates_v1(integer) to service_role;

-- 6) صحة المزامنة — كل اللي ممكن يخلّي رقم يكدب في صمت
create or replace function public.jt_sync_health()
returns jsonb language sql stable security definer set search_path to 'public', 'app' as $function$
  select case when not public.is_tenant_admin() then null else jsonb_build_object(
    'enabled', exists (select 1 from tenants t where t.id = app.current_tenant_id() and t.shipping_provider = 'jt'),
    'now', now(),
    'trace_last_ok', (select max(ran_at) from jt_sync_runs where job = 'trace_sync' and ok),
    'trace_last_run', (select max(ran_at) from jt_sync_runs where job = 'trace_sync'),
    'trace_last_error', (select error from jt_sync_runs where job = 'trace_sync' and not ok order by ran_at desc limit 1),
    -- مسلّم من غير تكلفة شحن نهائية بعد 24 ساعة (الوسيط الطبيعي 10 دقايق) = fee_sync واقفة
    'fee_stuck', (select coalesce(jsonb_agg(o.order_uid order by o.status_changed_at), '[]'::jsonb) from orders o
       where o.tenant_id = app.current_tenant_id() and o.shipping_carrier = 'jt' and o.status = 'Delivered'
         and not coalesce(o.jt_fee_final, false) and o.status_changed_at < now() - interval '24 hours'),
    -- مسح J&T مالوش مكان في الخريطة = حالة واقفة لحد ما يتضاف
    'unmapped_48h', (select count(*) from jt_events e where e.apply_note = 'unmapped'
       and e.received_at > now() - interval '48 hours' and (e.tenant_id is null or e.tenant_id = app.current_tenant_id())),
    -- الـCOD عند J&T ≠ إجمالي الأوردر عندنا (المرتجع والملغي مالهمش تحصيل — مالهمش أثر)
    'cod_mismatch', (select coalesce(jsonb_agg(jsonb_build_object('uid', o.order_uid, 'total', o.total_cost,
         'jt', o.jt_cod_amount, 'status', o.status) order by o.created_at desc), '[]'::jsonb) from orders o
       where o.tenant_id = app.current_tenant_id() and o.shipping_carrier = 'jt' and o.jt_cod_amount is not null
         and o.jt_cod_amount <> o.total_cost
         and o.status not in ('cancelled', 'Returned to business', 'returned', 'Returned to business2'))
  ) end;
$function$;
