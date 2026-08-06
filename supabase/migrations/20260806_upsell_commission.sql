-- ⚠️ اتطبّقت على الإنتاج 6 أغسطس 2026 باسم migration `upsell_commission`.
-- الملف ده نسخة مرجعية — مفيش CI بيشغّله، موجود عشان الكود يبقى مقروء من الريبو.
--
-- اتجرّبت الأول بترانزاكشن راجعة (8 حالات) وصفر أثر بعد الرجوع، وبعد التطبيق
-- اتجرّبت الـRLS: أدمن يشوف متجره · موظف يشوف بتاعه بس · تاجر تاني صفر ·
-- INSERT مباشر مرفوض · UPDATE/DELETE مباشر بيعدّلوا صفر صف.

-- عمولة الـupselling للموظفين.
-- الشكل: الموظف بيفتح الأوردر ويضيف منتج → الإجمالي يزيد → الفرق = upsell،
-- والعمولة عليه (مبلغ ثابت أو نسبة). بتتسجّل «معلّقة» وبتبقى «مستحقة» لما
-- الأوردر يتسلّم، وبتتلغي لو رجع أو اتلغى.

-- 1) إعدادات العمولة لكل موظف
alter table user_profiles
  add column if not exists upsell_commission_enabled boolean not null default false,
  add column if not exists upsell_commission_type text,
  add column if not exists upsell_commission_value numeric(12,2) not null default 0;

alter table user_profiles drop constraint if exists user_profiles_upsell_chk;
alter table user_profiles add constraint user_profiles_upsell_chk check (
  (upsell_commission_type is null or upsell_commission_type in ('fixed','percent'))
  and upsell_commission_value >= 0
  and (upsell_commission_type is distinct from 'percent' or upsell_commission_value <= 100)
);

-- 2) سجل الأحداث. `user_id` **مش** FK عن قصد: الأدمن يقدر يحذف موظف
--    (ميزة إدارة الموظفين)، والسجل المالي لازم يفضل. `user_name` لقطة
--    وقت الحدث عشان الاسم مايضيعش مع الحساب.
--    و`commission_rate` مجمّدة كمان — تغيير النسبة بكرة مايعيدش حساب القديم.
create table if not exists upsell_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id  uuid not null references orders(id)  on delete cascade,
  user_id   uuid,
  user_name text not null,
  before_total numeric(12,2) not null,
  after_total  numeric(12,2) not null,
  delta        numeric(12,2) not null,
  commission_type   text not null check (commission_type in ('fixed','percent')),
  commission_rate   numeric(12,2) not null,
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  status text not null default 'pending' check (status in ('pending','earned','void')),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists upsell_events_tenant_created_idx on upsell_events (tenant_id, created_at desc);
create index if not exists upsell_events_order_idx on upsell_events (order_id);
create index if not exists upsell_events_user_idx  on upsell_events (user_id);

alter table upsell_events enable row level security;

-- قراءة بس: الأدمن يشوف متجره كله، والموظف يشوف عمولته هو.
-- **مفيش سياسة INSERT/UPDATE/DELETE خالص** — الكتابة من الدوال بس، فموظف
-- مايقدرش يزوّد لنفسه عمولة بنداء PostgREST مباشر.
drop policy if exists upsell_events_select on upsell_events;
create policy upsell_events_select on upsell_events for select using (
  is_super_admin()
  or (tenant_id = current_tenant_id()
      and (is_tenant_admin() or user_id = auth.uid())
      and not (select app.wallet_depleted()))
);

-- 3) حفظ منتجات الأوردر + تسجيل الـupsell في عملية واحدة.
--
-- SECURITY DEFINER عن قصد — والاستثناء ده مقصود ومبرر:
-- لو الدالة INVOKER كنا هنحتاج سياسة INSERT على upsell_events، وساعتها
-- أي موظف يقدر يدخل صف بعمولة من اختراعه من الكونسول. بدل كده الدالة
-- بتشتغل بصلاحية المالك وبتعيد كل حراسات الـRLS بإيدها:
--   • البروفايل موجود ونشط
--   • الأوردر في متجر صاحب الطلب (مافيش عبور)
--   • قفل النفاد (app.wallet_depleted) — نفس حارس سياسات SELECT
-- والأهم: `before` بيتقرا من **صف السيرفر** مش من المتصفح، فالفرق
-- مايتزوّدش من الكلاينت.
create or replace function save_order_products(
  p_order_id uuid, p_product_name text, p_total_cost numeric default null)
returns jsonb language plpgsql security definer set search_path = public, app as $fn$
declare
  v_uid uuid := auth.uid(); v_p user_profiles; v_o orders;
  v_before numeric; v_after numeric; v_delta numeric; v_amt numeric; v_ev upsell_events;
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

  update orders set product_name = p_product_name,
         total_cost = case when p_total_cost is null then total_cost else v_after end
   where id = p_order_id and tenant_id = v_p.tenant_id
  returning * into v_o;

  v_delta := round(v_after - v_before, 2);
  if v_delta > 0
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

revoke all on function save_order_products(uuid, text, numeric) from public, anon;
grant execute on function save_order_products(uuid, text, numeric) to authenticated;

-- 4) استحقاق العمولة من حالة الأوردر.
-- تريجر مش نداء من الفرونت — عشان يشتغل كمان لما n8n (service_role) هو
-- اللي بيغيّر الحالة، وده اللي بيحصل فعلاً في أغلب التسليمات.
create or replace function app.resolve_upsell_on_status() returns trigger
language plpgsql security definer set search_path = public, app as $fn$
begin
  if new.status is distinct from old.status then
    if lower(new.status) = 'delivered' then
      -- 'void' جوّه الشرط عشان الأوردر اللي رجع وبعدين اتسلّم يرجع مستحق
      update upsell_events set status='earned', resolved_at=now()
       where order_id = new.id and status in ('pending','void');
    elsif lower(new.status) in ('cancelled','returned','returned to business',
          'returned to business2','failed') then
      update upsell_events set status='void', resolved_at=now()
       where order_id = new.id and status in ('pending','earned');
    end if;
  end if;
  return new;
end$fn$;

drop trigger if exists trg_resolve_upsell_on_status on orders;
create trigger trg_resolve_upsell_on_status after update of status on orders
  for each row execute function app.resolve_upsell_on_status();

-- 5) إعدادات عمولة الموظف — للأدمن على متجره بس
create or replace function set_upsell_commission(
  p_user_id uuid, p_enabled boolean, p_type text default null, p_value numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, app as $fn$
declare v_tenant uuid; v_row user_profiles;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not is_tenant_admin() then raise exception 'admin_only'; end if;
  v_tenant := current_tenant_id();
  if v_tenant is null then raise exception 'no_tenant'; end if;

  if p_enabled then
    if p_type not in ('fixed','percent') then raise exception 'bad_type'; end if;
    if coalesce(p_value,0) <= 0 then raise exception 'bad_value'; end if;
    if p_type = 'percent' and p_value > 100 then raise exception 'bad_value'; end if;
  end if;

  update user_profiles
     set upsell_commission_enabled = coalesce(p_enabled,false),
         upsell_commission_type    = case when p_enabled then p_type else null end,
         upsell_commission_value   = case when p_enabled then round(p_value,2) else 0 end
   where id = p_user_id and tenant_id = v_tenant and coalesce(is_super_admin,false) = false
  returning * into v_row;
  if not found then raise exception 'user_not_found'; end if;

  return jsonb_build_object('id', v_row.id, 'enabled', v_row.upsell_commission_enabled,
                            'type', v_row.upsell_commission_type, 'value', v_row.upsell_commission_value);
end$fn$;

revoke all on function set_upsell_commission(uuid, boolean, text, numeric) from public, anon;
grant execute on function set_upsell_commission(uuid, boolean, text, numeric) to authenticated;
