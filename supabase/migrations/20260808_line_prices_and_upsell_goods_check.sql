-- ⚠️ اتطبّقت على الإنتاج 8 أغسطس 2026 باسم migration `line_prices_and_upsell_goods_check`.
-- الملف ده نسخة مرجعية — مفيش CI بيشغّله.
--
-- السبب: تجربة المالك الحية كشفت باجين في خانة سعر القطعة:
--   1. حساب «الفروقات» ضد سعر السيستم كان بيضيّع الرقم المكتوب بعد
--      القفل والفتح والنتايج بقت غير متوقعة (1450→1200 ترجع تبان 1450).
--   2. أي زيادة في الإجمالي كانت بتتعلّم upsell + عمولة — حتى تصحيح سعر
--      من غير أي بضاعة جديدة (3 أحداث وهمية اتعملت أثناء تجربته واتمسحوا).
--
-- الحل:
--   • عمود `line_prices jsonb` — أسعار السطور [{n,q,p}] بتتخزن مع الأوردر
--     فالمكتوب بيرجع زي ما هو.
--   • `save_order_products` بقت 4 باراميترات (p_prices) والإجمالي مطلق.
--   • الفيصل بين «upsell» و«تصحيح سعر» بقى **على السيرفر**: مقارنة قايمة
--     البضاعة (أسماء + كميات، متطبّعة ومترتبة) قبل وبعد — الشارة والعمولة
--     للبضاعة المضافة بس. إعادة الترتيب مش تغيير.
--
-- اتجرّبت بترانزاكشن راجعة على أوردر تجربة المالك نفسه (#15653):
-- خصم/رفع سعر = صفر شارة وصفر أحداث · بضاعة جديدة = شارة + عمولة صح ·
-- إعادة ترتيب = مش تغيير. وبعد التطبيق اتمسحت الأحداث الوهمية التلاتة
-- (pending، من حساب التجربة) واتقفلت الشارة الغلط.

alter table orders add column if not exists line_prices jsonb;

drop function if exists save_order_products(uuid, text, numeric);
create or replace function save_order_products(
  p_order_id uuid, p_product_name text, p_total_cost numeric default null, p_prices jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, app as $fn$
declare
  v_uid uuid := auth.uid(); v_p user_profiles; v_o orders;
  v_before numeric; v_after numeric; v_delta numeric; v_amt numeric; v_ev upsell_events;
  v_goods_changed boolean; v_mark boolean := false;
  v_old_lines text[]; v_new_lines text[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_p from user_profiles where id = v_uid;
  if not found or coalesce(v_p.active,false) is not true then raise exception 'no_profile'; end if;
  if v_p.tenant_id is null then raise exception 'no_tenant'; end if;
  if app.wallet_depleted() then raise exception 'wallet_depleted'; end if;

  select * into v_o from orders where id = p_order_id and tenant_id = v_p.tenant_id for update;
  if not found then raise exception 'order_not_found'; end if;

  v_before := coalesce(v_o.total_cost, 0);
  v_after  := case when p_total_cost is null then v_before else round(p_total_cost, 2) end;
  if v_after < 0 then raise exception 'negative_total'; end if;
  v_delta := round(v_after - v_before, 2);

  select coalesce(array_agg(l order by l), '{}') into v_old_lines from (
    select regexp_replace(trim(x), '^\+\s*', '') as l
    from unnest(regexp_split_to_array(coalesce(v_o.product_name,''), E'\n')) x
  ) t where l <> '';
  select coalesce(array_agg(l order by l), '{}') into v_new_lines from (
    select regexp_replace(trim(x), '^\+\s*', '') as l
    from unnest(regexp_split_to_array(coalesce(p_product_name,''), E'\n')) x
  ) t where l <> '';
  v_goods_changed := v_old_lines is distinct from v_new_lines;

  v_mark := v_goods_changed and v_delta > 0;

  update orders set product_name = p_product_name,
         total_cost = case when p_total_cost is null then total_cost else v_after end,
         line_prices = case when p_prices is null then line_prices else p_prices end,
         has_upsell = has_upsell or v_mark
   where id = p_order_id and tenant_id = v_p.tenant_id
  returning * into v_o;

  if v_mark
     and coalesce(v_p.upsell_commission_enabled,false)
     and v_p.upsell_commission_type is not null
     and coalesce(v_p.upsell_commission_value,0) > 0 then
    v_amt := case when v_p.upsell_commission_type = 'fixed'
                  then v_p.upsell_commission_value
                  else round(v_delta * v_p.upsell_commission_value / 100.0, 2) end;
    insert into upsell_events (tenant_id, order_id, user_id, user_name, before_total,
           after_total, delta, commission_type, commission_rate, commission_amount, status)
    values (v_p.tenant_id, p_order_id, v_uid, coalesce(v_p.full_name,'—'),
            v_before, v_after, v_delta, v_p.upsell_commission_type,
            v_p.upsell_commission_value, v_amt, 'pending')
    returning * into v_ev;
  end if;

  return jsonb_build_object('order', to_jsonb(v_o), 'upsell', to_jsonb(v_ev));
end$fn$;
revoke all on function save_order_products(uuid, text, numeric, jsonb) from public, anon;
grant execute on function save_order_products(uuid, text, numeric, jsonb) to authenticated;
