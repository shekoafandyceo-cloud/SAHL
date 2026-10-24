-- save_products_jt_waybill_lock — بعد بوليصة J&T، المنتجات والإجمالي مايتغيّروش في سهل لوحدهم.
--
-- 🔴 بلاغ المالك 3 أكتوبر (أوردر 17532): الموظف شال منتج من محرر المنتجات، وداس «🚚 شحن J&T»
-- **قبل** ما يحفظ، وبعدين حفظ. المقاس من اللوجات:
--   08:32:33 jt-ship قرا الأوردر من الداتابيز (1759 ج + منتجين) → البوليصة اتعملت بيهم
--   08:33:19 save_order_products → السيستم بقى 1450 ج + منتج واحد   (بعد البوليصة بـ46 ثانية)
-- J&T (getOrders): itemsValue 1759 والـremark فيه المنتجين — يعني المندوب هيحصّل 1759 والسيستم
-- بيقول 1450، ومحدش اتنبّه غير بالصدفة. ونفس الشكل اتقاس قبل كده: 17260 (اتعدّل بعد التسليم).
--
-- القاعدة: لو للأوردر بوليصة J&T (shipping_carrier='jt' + tracking_no)، أي تغيير في **البضاعة أو
-- الإجمالي** بيترفض بـ`jt_waybill_locked` — التعديل لازم يحصل عند J&T الأول. الاستثناء الوحيد:
-- إجمالي = `jt_cod_amount` (المبلغ اللي J&T نفسها شايلاه) من غير تغيير بضاعة = مزامنة لـJ&T مش انحراف.
-- حفظة من غير أي تغيير (نفس الاسم ونفس الإجمالي) بتعدّي زي ما هي. تعديل أسعار السطور بنفس الإجمالي بيعدّي.
-- ⚠️ أوردرات الشحن اليدوي (من غير shipping_carrier='jt') مش داخلة — مالهاش بوليصة عندنا نقارن بيها.
create or replace function public.save_order_products(p_order_id uuid, p_product_name text, p_total_cost numeric default null::numeric, p_prices jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app'
as $function$
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

  -- الفيصل بين «upsell» و«تصحيح سعر»: قايمة البضاعة نفسها (أسماء + كميات).
  -- سطور متطبّعة (قص الـ+ والمسافات) ومترتبة — إعادة الترتيب مش تغيير.
  select coalesce(array_agg(l order by l), '{}') into v_old_lines from (
    select regexp_replace(trim(x), '^\+\s*', '') as l
    from unnest(regexp_split_to_array(coalesce(v_o.product_name,''), E'\n')) x
  ) t where l <> '';
  select coalesce(array_agg(l order by l), '{}') into v_new_lines from (
    select regexp_replace(trim(x), '^\+\s*', '') as l
    from unnest(regexp_split_to_array(coalesce(p_product_name,''), E'\n')) x
  ) t where l <> '';
  v_goods_changed := v_old_lines is distinct from v_new_lines;

  -- 🔴 بوليصة J&T اتعملت = المبلغ والمنتجات اتبعتوا لـJ&T خلاص (itemsValue + remark).
  -- تغييرهم هنا لوحدهم = المندوب يحصّل رقم والسيستم يقول رقم تاني في صمت (17532).
  if v_o.shipping_carrier = 'jt'
     and nullif(trim(coalesce(v_o.tracking_no, '')), '') is not null
     and (v_goods_changed or v_after <> v_before)
     and not (not v_goods_changed and v_o.jt_cod_amount is not null and v_after = v_o.jt_cod_amount) then
    raise exception 'jt_waybill_locked';
  end if;

  -- الشارة والعمولة للبضاعة المضافة بس
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
end$function$;
