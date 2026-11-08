-- بوتات التلجرام (ai.finance_summary · merchant_ai.get_report) + merchant_finance_summary —
-- نفس قواعد لوحة الماليات بالحرف (1 أكتوبر — مراجعة الحسابات)
--
-- 🔴 كانوا بيحسبوا الشحن = 85 × العدد — رقم بوسطة اتشال من اللوحة 16 سبتمبر (قرار المالك:
-- «مفيش سعر شحن افتراضي»). سبتمبر: البوت كان بيقول شحن 23,715 والمسجّل فعلاً 18,143.
-- المالك بيسأل البوت على التلجرام، فرقمين مختلفين لنفس الشهر = واحد منهم بيكدب.
--
-- القواعد (من finance.js / costs.js):
--   الشحن     = Σ real_shipping_fee (لو > 0) للمسلّم + المرتجع — من غير أي افتراضي،
--               وعدد الناقص بيترجع صريح (shipping_unknown_count) بدل ما يتخبّى.
--   البضاعة   = snapshot (> 0) وإلا سعر المخزون الحالي (compute_order_cogs) — للمسلّم بس.
--               🔴 manufacturer_cost **مش** fallback (قرار المالك 30 أغسطس — عرض بس).
--   «exception» مش «مفقود» — لسه في السكة (كان بيتعد في المتوقع والمفقود الاتنين).

create or replace function ai.finance_summary(p_tenant uuid, p_from date, p_to date)
 returns table(total_revenue numeric, collected numeric, expected_revenue numeric, lost_revenue numeric, manufacturer_cost numeric, shipping_cost numeric, packaging_cost_orders numeric, exp_salaries numeric, exp_ads numeric, exp_packaging numeric, exp_bills numeric, exp_warehouse numeric, exp_other numeric, total_manual_expenses numeric, total_costs numeric, net_profit numeric, margin_pct numeric, aov numeric, delivered_count integer, lost_shipped_count integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_total_revenue numeric := 0; v_collected numeric := 0; v_expected numeric := 0; v_lost numeric := 0;
  v_cogs numeric := 0; v_shipping numeric := 0; v_delivered_count integer := 0; v_ship_unknown integer := 0;
  v_exp_sal numeric := 0; v_exp_ads numeric := 0; v_exp_pkg numeric := 0; v_exp_bills numeric := 0;
  v_exp_wh numeric := 0; v_exp_other numeric := 0; v_total_manual numeric := 0; v_total_costs numeric := 0;
  v_net numeric := 0; v_margin numeric := 0; v_aov numeric := 0;
begin
  with o as (
    select x.total_cost, lower(btrim(x.status)) st, x.real_shipping_fee,
      coalesce(nullif(x.inventory_cost_snapshot,0), nullif(x.inventory_value_snapshot,0), nullif(x.inventory_value_at_bosta,0),
               public.compute_order_cogs(x.product_name, x.tenant_id), 0) cogs
    from public.orders x
    where x.tenant_id = p_tenant and (x.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
  )
  select coalesce(sum(total_cost),0),
    coalesce(sum(total_cost) filter (where st = 'delivered'),0),
    count(*) filter (where st = 'delivered'),
    coalesce(sum(total_cost) filter (where st in ('bosta_assigned','bosta auto','bosta2','bosta_auto','out for delivery',
      'received at warehouse','route assigned','in transit between hubs','picking up from consignee','out for exchange',
      'exception','out_for_delivery','received_at_warehouse','route_assigned','picked_up','in_transit')),0),
    coalesce(sum(total_cost) filter (where st in ('cancelled','failed','returned','returned to business','returned to business2')),0),
    coalesce(sum(cogs) filter (where st = 'delivered'),0),
    coalesce(sum(real_shipping_fee) filter (where real_shipping_fee > 0 and st in ('delivered','returned','returned to business','returned to business2')),0),
    count(*) filter (where coalesce(real_shipping_fee,0) <= 0 and st in ('delivered','returned','returned to business','returned to business2'))
  into v_total_revenue, v_collected, v_delivered_count, v_expected, v_lost, v_cogs, v_shipping, v_ship_unknown
  from o;

  select
    coalesce(sum(case when e.category = 'مرتبات'         then e.amount else 0 end), 0),
    coalesce(sum(case when e.category = 'إعلانات فيسبوك' then e.amount else 0 end), 0),
    coalesce(sum(case when e.category = 'تغليف'          then e.amount else 0 end), 0),
    coalesce(sum(case when e.category = 'فواتير'         then e.amount else 0 end), 0),
    coalesce(sum(case when e.category = 'مخزن'           then e.amount else 0 end), 0),
    coalesce(sum(case when e.category = 'متفرقات'        then e.amount else 0 end), 0)
  into v_exp_sal, v_exp_ads, v_exp_pkg, v_exp_bills, v_exp_wh, v_exp_other
  from public.expenses e where e.tenant_id = p_tenant and e.expense_date between p_from and p_to;

  v_total_manual := v_exp_sal + v_exp_ads + v_exp_pkg + v_exp_bills + v_exp_wh + v_exp_other;
  v_total_costs := v_cogs + v_shipping + v_total_manual;
  v_net := v_collected - v_total_costs;
  v_margin := case when v_collected > 0 then (v_net / v_collected * 100) else 0 end;
  v_aov := case when v_delivered_count > 0 then v_collected / v_delivered_count else 0 end;

  -- ⚠️ manufacturer_cost (اسم العمود في الرد) = تكلفة البضاعة بالقاعدة الجديدة — الاسم فضل
  -- عشان الوركفلو اللي بيقراه (ممنوع تعديله آلياً). lost_shipped_count بقى = عدد المسلّم/المرتجع
  -- **من غير تكلفة شحن مسجّلة** (الشحن المعروض أقل من الحقيقي بيهم).
  return query select v_total_revenue, v_collected, v_expected, v_lost, v_cogs, v_shipping, 0::numeric,
    v_exp_sal, v_exp_ads, v_exp_pkg, v_exp_bills, v_exp_wh, v_exp_other, v_total_manual,
    v_total_costs, v_net, v_margin, v_aov, v_delivered_count, v_ship_unknown;
end;
$function$;

create or replace function merchant_ai.get_report(p_tenant uuid, p_report text, p_from date default null, p_to date default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_from date := coalesce(p_from, date_trunc('month', (now() at time zone 'Africa/Cairo'))::date);
  v_to   date := coalesce(p_to,   (now() at time zone 'Africa/Cairo')::date);
  v_res  jsonb;
  returned_arr text[] := array['returned','returned to business','returned to business2'];
begin
  if p_report in ('pnl', 'expenses') then
    with d as (
      select coalesce(total_cost,0)::numeric rev, lower(btrim(status)) st, real_shipping_fee fee,
        coalesce(nullif(inventory_cost_snapshot,0), nullif(inventory_value_snapshot,0), nullif(inventory_value_at_bosta,0),
                 public.compute_order_cogs(product_name, p_tenant), 0)::numeric cogs
      from public.orders
      where tenant_id = p_tenant and (created_at at time zone 'Africa/Cairo')::date between v_from and v_to
    ),
    agg as (
      select
        coalesce(sum(rev)  filter (where st = 'delivered'),0) revenue_collected,
        coalesce(sum(cogs) filter (where st = 'delivered'),0) cogs_total,
        coalesce(sum(fee)  filter (where fee > 0 and (st = 'delivered' or st = any(returned_arr))),0) shipping_total,
        count(*) filter (where coalesce(fee,0) <= 0 and (st = 'delivered' or st = any(returned_arr))) shipping_unknown,
        count(*) filter (where st = 'delivered') delivered_cnt,
        count(*) filter (where st = any(returned_arr)) returned_cnt,
        count(*) orders_cnt
      from d
    ),
    e as (select coalesce(sum(amount),0) manual_expenses from public.expenses
          where tenant_id = p_tenant and expense_date between v_from and v_to),
    cats as (
      select coalesce(jsonb_object_agg(category, total),'{}'::jsonb) breakdown from (
        select category, round(sum(amount)) total from public.expenses
        where tenant_id = p_tenant and expense_date between v_from and v_to group by category) x
    )
    select case when p_report = 'pnl' then jsonb_build_object(
      'report','pnl', 'from', v_from, 'to', v_to,
      'revenue_collected', round(agg.revenue_collected),
      'cogs',              round(agg.cogs_total),
      'shipping',          round(agg.shipping_total, 2),
      'shipping_unknown_count', agg.shipping_unknown,
      'manual_expenses',   round(e.manual_expenses),
      'net_profit',        round(agg.revenue_collected - agg.cogs_total - agg.shipping_total - e.manual_expenses),
      'margin_pct', case when agg.revenue_collected > 0
                         then round((agg.revenue_collected - agg.cogs_total - agg.shipping_total - e.manual_expenses)/agg.revenue_collected*100,1)
                         else null end,
      'note', case when agg.shipping_unknown > 0
                   then agg.shipping_unknown || ' أوردر مسلّم/مرتجع من غير تكلفة شحن مسجّلة — الربح أعلى من الحقيقي بيهم' end,
      'orders_count', agg.orders_cnt, 'delivered_count', agg.delivered_cnt, 'returned_count', agg.returned_cnt)
    else jsonb_build_object(
      'report','expenses', 'from', v_from, 'to', v_to,
      'بضاعة', round(agg.cogs_total),
      'شحن',   round(agg.shipping_total, 2),
      'شحن_ناقص_تكلفته', agg.shipping_unknown,
      'مصاريف_يدوية_بالتفصيل', cats.breakdown,
      'إجمالي_المصاريف_اليدوية', round(e.manual_expenses),
      'ملحوظة','أكبر بند عادة البضاعة. الترتيب من الأكبر للأصغر بيوريك على إيه بتصرف أكتر.') end
    into v_res
    from agg, e, cats;

  elsif p_report = 'orders' then
    v_res := public.sahl_orders_stats(p_tenant::text, v_from, v_to)::jsonb
             || jsonb_build_object('report','orders','from',v_from,'to',v_to);

  elsif p_report = 'top_products' then
    with d as (
      select product_name, coalesce(total_cost,0)::numeric rev,
        coalesce(nullif(inventory_cost_snapshot,0), nullif(inventory_value_snapshot,0), nullif(inventory_value_at_bosta,0),
                 public.compute_order_cogs(product_name,p_tenant),0)::numeric cogs
      from public.orders
      where tenant_id = p_tenant and lower(btrim(status))='delivered'
        and (created_at at time zone 'Africa/Cairo')::date between v_from and v_to
    ),
    g as (select product_name, count(*) cnt, round(sum(rev)) revenue, round(sum(rev)-sum(cogs)) profit from d group by product_name)
    select jsonb_build_object('report','top_products','from',v_from,'to',v_to,
      'top',   coalesce((select jsonb_agg(row_to_json(t)) from (select * from g order by profit desc nulls last limit 5) t),'[]'::jsonb),
      'worst', coalesce((select jsonb_agg(row_to_json(t)) from (select * from g order by profit asc  nulls last limit 5) t),'[]'::jsonb)
    ) into v_res;

  elsif p_report = 'inventory' then
    select jsonb_build_object('report','inventory',
      'total_value', round(coalesce(sum(current_qty*wholesale_price),0)),
      'total_items', count(*),
      'out_of_stock', coalesce(jsonb_agg(name) filter (where current_qty <= 0),'[]'::jsonb),
      'low_stock',    coalesce(jsonb_agg(jsonb_build_object('name',name,'qty',current_qty)) filter (where current_qty > 0 and current_qty <= 5),'[]'::jsonb)
    ) into v_res
    from public.stock_products where tenant_id = p_tenant;

  else
    v_res := jsonb_build_object('error','unknown report','valid_reports', jsonb_build_array('pnl','expenses','orders','top_products','inventory'));
  end if;
  return v_res;
end$function$;

-- merchant_finance_summary: الواجهة مابتناديهاش (اتقاس) — بس الـ85 اتشالت عشان محدش يبني عليها
create or replace function public.merchant_finance_summary(p_from date, p_to date)
 returns table(revenue_total numeric, revenue_collected numeric, revenue_expected numeric, revenue_lost numeric, cogs numeric, shipping numeric, packaging numeric, exp_salaries numeric, exp_ads numeric, exp_packaging numeric, exp_bills numeric, exp_warehouse numeric, exp_other numeric, exp_total numeric, costs_total numeric, net_profit numeric, margin_pct numeric, aov numeric, cnt_total integer, cnt_delivered integer, cnt_lost integer, cnt_no_snapshot integer)
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
DECLARE v_tenant uuid; v_role text; v_lo timestamptz; v_hi timestamptz;
BEGIN
  SELECT up.tenant_id, up.role INTO v_tenant, v_role
  FROM public.user_profiles up
  WHERE up.id = auth.uid() AND COALESCE(up.active,false) = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admin role required' USING ERRCODE='42501'; END IF;

  v_lo := (p_from::timestamp) AT TIME ZONE 'Africa/Cairo';
  v_hi := ((p_to + 1)::timestamp) AT TIME ZONE 'Africa/Cairo';

  RETURN QUERY
  WITH o AS (
    SELECT ord.total_cost, ord.packaging_cost, lower(btrim(ord.status)) AS st,
      COALESCE(NULLIF(ord.inventory_cost_snapshot,0), NULLIF(ord.inventory_value_snapshot,0),
               NULLIF(ord.inventory_value_at_bosta,0),
               public.compute_order_cogs(ord.product_name, ord.tenant_id), 0) AS unit_cogs,
      COALESCE(NULLIF(ord.real_shipping_fee,0), 0) AS ship_fee,
      (COALESCE(NULLIF(ord.inventory_cost_snapshot,0), NULLIF(ord.inventory_value_snapshot,0),
                NULLIF(ord.inventory_value_at_bosta,0)) IS NULL) AS no_snap
    FROM public.orders ord
    WHERE ord.tenant_id = v_tenant AND ord.created_at >= v_lo AND ord.created_at < v_hi
  ),
  f AS (
    SELECT *,
      (st = 'delivered') AS is_del,
      (st LIKE 'returned%') AS is_ret,
      (st IN ('cancelled','returned','returned to business','returned to business2','failed')) AS is_lost,
      (st IN ('bosta_assigned','bosta auto','bosta2','bosta_auto','out for delivery',
              'received at warehouse','route assigned','in transit between hubs',
              'picking up from consignee','out for exchange','exception',
              'out_for_delivery','received_at_warehouse','route_assigned','picked_up','in_transit')) AS is_exp
    FROM o
  ),
  agg AS (
    SELECT
      COALESCE(SUM(total_cost),0) AS rev_total,
      COALESCE(SUM(total_cost) FILTER (WHERE is_del),0)  AS rev_coll,
      COALESCE(SUM(total_cost) FILTER (WHERE is_exp),0)  AS rev_exp,
      COALESCE(SUM(total_cost) FILTER (WHERE is_lost),0) AS rev_lost,
      COALESCE(SUM(unit_cogs)  FILTER (WHERE is_del),0)  AS c_cogs,
      COALESCE(SUM(ship_fee) FILTER (WHERE is_del OR is_ret),0) AS c_ship,
      0::numeric AS c_pack,
      COUNT(*)::int AS n_total,
      COUNT(*) FILTER (WHERE is_del)::int  AS n_del,
      COUNT(*) FILTER (WHERE is_lost)::int AS n_lost,
      COUNT(*) FILTER (WHERE is_del AND no_snap)::int AS n_nosnap
    FROM f
  ),
  e AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE category='مرتبات'),0)        AS e_sal,
      COALESCE(SUM(amount) FILTER (WHERE category='إعلانات فيسبوك'),0) AS e_ads,
      COALESCE(SUM(amount) FILTER (WHERE category='تغليف'),0)          AS e_pack,
      COALESCE(SUM(amount) FILTER (WHERE category='فواتير'),0)         AS e_bill,
      COALESCE(SUM(amount) FILTER (WHERE category='مخزن'),0)           AS e_wh,
      COALESCE(SUM(amount) FILTER (WHERE category='متفرقات'),0)        AS e_oth
    FROM public.expenses
    WHERE tenant_id=v_tenant AND expense_date::date >= p_from AND expense_date::date <= p_to
  )
  SELECT
    round(agg.rev_total,2), round(agg.rev_coll,2), round(agg.rev_exp,2), round(agg.rev_lost,2),
    round(agg.c_cogs,2), round(agg.c_ship,2), round(agg.c_pack,2),
    round(e.e_sal,2), round(e.e_ads,2), round(e.e_pack,2),
    round(e.e_bill,2), round(e.e_wh,2), round(e.e_oth,2),
    round(e.e_sal+e.e_ads+e.e_pack+e.e_bill+e.e_wh+e.e_oth,2),
    round(agg.c_cogs+agg.c_ship+agg.c_pack+e.e_sal+e.e_ads+e.e_pack+e.e_bill+e.e_wh+e.e_oth,2),
    round(agg.rev_coll-(agg.c_cogs+agg.c_ship+agg.c_pack+e.e_sal+e.e_ads+e.e_pack+e.e_bill+e.e_wh+e.e_oth),2),
    CASE WHEN agg.rev_coll>0 THEN round((agg.rev_coll-(agg.c_cogs+agg.c_ship+agg.c_pack
      +e.e_sal+e.e_ads+e.e_pack+e.e_bill+e.e_wh+e.e_oth))/agg.rev_coll*100,2) ELSE 0 END,
    CASE WHEN agg.n_del>0 THEN round(agg.rev_coll/agg.n_del,2) ELSE 0 END,
    agg.n_total, agg.n_del, agg.n_lost, agg.n_nosnap
  FROM agg, e;
END;
$function$;
