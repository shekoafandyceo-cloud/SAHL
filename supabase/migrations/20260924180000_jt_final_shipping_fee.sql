-- تكلفة شحن J&T النهائية على الأوردر — عند «تم التسليم» و«مرتجع» (طلب المالك 24 سبتمبر)
--
-- المصدر مقيس مش مفترض (24 سبتمبر، 70 بوليصة):
--   waybill/getWaybillInfo → totalFreight (= freight) + packageChargeWeight + isSign
--   • isSign 1 = اتسلّم · 2 = مرتجع اتقفل (مش موثّقة — ظهرت على 3 بوالص آخر مسح فيهم 13 Returned Signed)
--   • totalFreight = تعريفة × 1.254 بالمنطقة والوزن — طابقت 67/67. **مافيهاش رسوم COD**
--     (نفس الشريحة بـCOD مختلف = نفس الرقم) → الرسوم بنحسبها إحنا من العقد: 1% بحد أدنى 5 ج.
--   • المرتجع بعد ما يتقفل بيبقى 50% من الذهاب (28.84 = 57.68 / 2) — فالرقم قبل isSign=2 مش نهائي.
--
-- 🔴 القاعدة: real_shipping_fee (اللي الماليات بتقراه) بيتكتب **لما الرقم يبقى نهائي بس**:
--   settlementReturn · أو Delivered + isSign=1 · أو مرتجع + isSign=2.
--   قبل كده الرقم بيتحفظ في jt_freight مع jt_fee_final=false — «متسجّلش تقديري كأنه مؤكد».
-- رسوم الـCOD على المرتجع: مقفولة افتراضياً (on_returns=false) — مفيش COD اتحصّل. بتتفتح من الإعداد.

alter table public.orders
  add column if not exists jt_freight numeric,
  add column if not exists jt_cod_fee numeric,
  add column if not exists jt_charge_weight_kg numeric,
  add column if not exists jt_is_sign smallint,
  add column if not exists jt_fee_final boolean not null default false,
  add column if not exists jt_fee_source text,
  add column if not exists jt_fee_for_status text,
  add column if not exists jt_fee_synced_at timestamptz;

insert into public.platform_settings(key, value, description)
values ('jt_cod_fee', '{"pct":1,"min":5,"on_returns":false}',
        'رسوم COD عند J&T (من العقد — مش في أي API): نسبة من الـCOD بحد أدنى. on_returns = تتحسب على المرتجع ولا لأ')
on conflict (key) do nothing;

create or replace function app.jt_cod_fee_for(p_status text, p_cod numeric)
returns numeric language plpgsql stable security definer set search_path = public, app
as $$
declare v jsonb; v_pct numeric; v_min numeric; v_ret boolean; s text := lower(coalesce(p_status,''));
begin
  select value::jsonb into v from platform_settings where key = 'jt_cod_fee';
  v_pct := coalesce((v->>'pct')::numeric, 1);
  v_min := coalesce((v->>'min')::numeric, 5);
  v_ret := coalesce((v->>'on_returns')::boolean, false);
  if s = 'delivered' or (v_ret and s in ('returned','returned to business','returned to business2')) then
    return round(greatest(coalesce(p_cod,0) * v_pct / 100, v_min), 2);
  end if;
  if s in ('returned','returned to business','returned to business2') then return 0; end if;
  return null;
end $$;

create or replace function app.jt_apply_fee(p_bill_code text, p_freight numeric, p_charge_weight numeric, p_is_sign int, p_source text)
returns jsonb language plpgsql security definer set search_path = public, app
as $$
declare r orders; s text; v_cod numeric; v_final boolean; v_deliv boolean; v_ret boolean;
begin
  select * into r from orders where tracking_no = p_bill_code and shipping_carrier = 'jt'
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  -- J&T بتسقط البوليصة من الرد لو لسه مااتمسحتش → بنعلّم وقت المحاولة بس
  if p_freight is null or p_freight <= 0 then
    update orders set jt_fee_synced_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'note', 'no_data', 'order_id', r.id);
  end if;
  -- التسوية هي الفاتورة — waybill_info مايكتبش فوقها
  if p_source <> 'settlement' and r.jt_fee_source = 'settlement' then
    update orders set jt_fee_synced_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'note', 'settlement_wins', 'order_id', r.id);
  end if;
  s := lower(coalesce(r.status,''));
  v_deliv := s = 'delivered';
  v_ret := s in ('returned','returned to business','returned to business2');
  v_cod := app.jt_cod_fee_for(r.status, r.total_cost);
  v_final := p_source = 'settlement'
          or (v_deliv and p_is_sign = 1)
          or (v_ret and p_is_sign = 2);
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
                             when r.jt_fee_final then null      -- كان نهائي لحالة تانية واتغيّرت
                             else real_shipping_fee end,
    real_shipping_fee_at = case when v_final then now()
                                when r.jt_fee_final then null
                                else real_shipping_fee_at end
   where id = r.id;
  return jsonb_build_object('ok', true, 'note', case when v_final then 'final' else 'provisional' end,
    'order_id', r.id, 'freight', p_freight, 'cod_fee', v_cod,
    'fee', case when v_final then round(p_freight + coalesce(v_cod,0), 2) end);
end $$;

-- التسوية بتعدّي على نفس المسار (قبل كده كانت بتكتب totalFreight لوحده من غير COD
-- وبتدوس shipping_weight_kg اللي إحنا بعتناه)
create or replace function app.jt_apply_settlement(p_bill_code text, p_total_freight numeric, p_charge_weight numeric)
returns jsonb language sql security definer set search_path = public, app
as $$ select app.jt_apply_fee(p_bill_code, p_total_freight, p_charge_weight, null, 'settlement'); $$;

-- اللي محتاج مزامنة: J&T في حالة نهائية، والرقم مش نهائي أو اتحسب لحالة تانية
create or replace function app.jt_fee_candidates(p_limit int default 60)
returns table(bill_code text) language sql stable security definer set search_path = public, app
as $$
  select o.tracking_no from orders o
   where o.shipping_carrier = 'jt' and coalesce(o.tracking_no,'') <> ''
     and lower(o.status) in ('delivered','returned','returned to business','returned to business2')
     and (not o.jt_fee_final or o.jt_fee_for_status is distinct from o.status)
     and (o.jt_fee_synced_at is null or o.jt_fee_synced_at < now() - interval '25 minutes')
   order by o.jt_fee_synced_at nulls first, o.status_changed_at desc nulls last
   limit greatest(1, least(coalesce(p_limit,60), 200));
$$;

create or replace function public.jt_apply_fee_v1(p_bill_code text, p_freight numeric, p_charge_weight numeric, p_is_sign int, p_source text)
returns jsonb language sql security definer set search_path = public, app
as $$ select app.jt_apply_fee(p_bill_code, p_freight, p_charge_weight, p_is_sign, p_source); $$;
create or replace function public.jt_fee_candidates_v1(p_limit int default 60)
returns table(bill_code text) language sql security definer set search_path = public, app
as $$ select * from app.jt_fee_candidates(p_limit); $$;

revoke all on function app.jt_cod_fee_for(text,numeric) from public, anon, authenticated;
revoke all on function app.jt_apply_fee(text,numeric,numeric,int,text) from public, anon, authenticated;
revoke all on function app.jt_fee_candidates(int) from public, anon, authenticated;
revoke all on function public.jt_apply_fee_v1(text,numeric,numeric,int,text) from public, anon, authenticated;
revoke all on function public.jt_fee_candidates_v1(int) from public, anon, authenticated;
grant execute on function public.jt_apply_fee_v1(text,numeric,numeric,int,text) to service_role;
grant execute on function public.jt_fee_candidates_v1(int) to service_role;

-- رحلة المرتجع (isRefund=1): jt-status بيبعت الكود بـprefix «refund:» — المسحات دي
-- (Sending/DC arrival/Delivery/Holding في طريق الرجوع) كانت بتتطابق على حالات الذهاب
-- فأوردر راجع يترجع «In transit»/«Out for delivery». بتتسجّل خام ومابتغيّرش الحالة.
-- (13 Returned Signed و172 بيتبعتوا من غير prefix — دول بيحسموا المرتجع.)
create or replace function app.jt_apply_trace(p_bill_code text, p_scan_type text, p_scan_code text, p_scan_at timestamp with time zone, p_desc text)
returns jsonb language plpgsql security definer set search_path = public, app
as $function$
declare v_row orders; v_target text; v_final boolean; v_key text;
begin
  select * into v_row from orders where tracking_no = p_bill_code and shipping_carrier = 'jt' order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  if v_row.carrier_status_at is not null and p_scan_at is not null and p_scan_at < v_row.carrier_status_at then
    return jsonb_build_object('ok', true, 'note', 'stale', 'order_id', v_row.id);
  end if;
  update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
    carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
  if coalesce(p_scan_code,'') like 'refund:%' then
    return jsonb_build_object('ok', true, 'note', 'refund_journey', 'order_id', v_row.id);
  end if;
  -- 🔴 الكود أولاً ثم الاسم — نوعين من J&T بيوصلوا بلا scanTypeCode (شوف هيدر jt_status_map_from_live_payloads)
  v_key := coalesce(nullif(btrim(coalesce(p_scan_code,'')), ''), 'name:' || lower(btrim(coalesce(p_scan_type,''))));
  select sahl_status into v_target from jt_status_map where scan_type_code = v_key;
  if v_target is null then return jsonb_build_object('ok', true, 'note', 'unmapped', 'order_id', v_row.id, 'key', v_key); end if;
  if v_target = v_row.status then return jsonb_build_object('ok', true, 'note', 'same_status', 'order_id', v_row.id); end if;
  v_final := lower(v_row.status) in ('delivered','returned','returned to business','returned to business2','cancelled');
  if v_final and v_target not in ('Delivered','Returned to business') then
    return jsonb_build_object('ok', true, 'note', 'final_state_kept', 'order_id', v_row.id);
  end if;
  update orders set status = v_target, status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', v_target,
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', 'J&T API', 'reason', nullif(left(coalesce(p_desc,''),120),'')))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $function$;
