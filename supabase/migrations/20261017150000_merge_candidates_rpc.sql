-- 17 أكتوبر 2026 — v82 (تقليل الـEgress، موافقة المالك على «الخطوة 2»).
-- تنبيه الدمج كان بيجيب **كل** أوردرات «جاهز للشحن» (~768 صف ≈ 138 KB) من غير أي حد، مع **كل** حدث ريل-تايم على orders
-- في كل تاب أوردرات ظاهرة — ~2,600 مرة في اليوم (قياس 16–17 أكتوبر) عشان يدوّر على تليفون متكرر، والنتيجة صفر.
-- الدالة دي بترجّع **الصفوف اللي تليفونها متكرر بس** بنفس الأعمدة السبعة، والواجهة بتجمّعها زي ما كانت بالظبط.
--
-- 🔴 تطبيع التليفون = normalizePhone في app/js/core/format.js **بالحرف**: أرقام عربي/فارسي → لاتيني · شيل أي حاجة مش رقم ·
--    شيل «20» مرة واحدة من الأول · شيل الأصفار اللي في الأول · الفاضي مايتجمّعش. أي فرق = تنبيه بيختفي أو يظهر غلط.
-- 🔴 SECURITY INVOKER: الـRLS (عزل المتجر + قفل النفاد wallet_depleted) بتتطبّق زي الاستعلام القديم بالظبط.
--    p_tenant = نفس `.eq('tenant_id', currentTenantId)` القديم (السوبر أدمن RLS بتاعته بتشوف كل المتاجر).
-- الحالات = MERGE_QUERY_STATUSES في app/js/orders/cards.js بالحرف.

create or replace function public.merge_candidates_v1(p_tenant uuid)
returns table(order_uid text, tracking_no text, customer_name text, city text, phone text, total_cost numeric, status text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with m as (
    select o.order_uid, o.tracking_no, o.customer_name, o.city, o.phone, o.total_cost, o.status, o.created_at,
           regexp_replace(regexp_replace(regexp_replace(
             translate(coalesce(o.phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
             '[^0-9]', '', 'g'), '^20', ''), '^0+', '') as np
    from public.orders o
    where o.tenant_id = p_tenant
      and o.status in ('bosta_assigned', 'BOSTA AUTO', 'bosta_auto', 'BOSTA2', 'bosta2')
  ), d as (
    select m.np from m where m.np <> '' group by m.np having count(*) >= 2
  )
  select m.order_uid, m.tracking_no, m.customer_name, m.city, m.phone, m.total_cost, m.status
  from m join d on d.np = m.np
  order by m.np, m.created_at;
$fn$;

comment on function public.merge_candidates_v1(uuid) is
  'تنبيه الدمج (v82): أوردرات «جاهز للشحن» اللي تليفونها (بعد تطبيع normalizePhone بالحرف) متكرر بس — بدل تحميل كل الحالات مع كل حدث ريل-تايم.';

revoke all on function public.merge_candidates_v1(uuid) from public;
revoke all on function public.merge_candidates_v1(uuid) from anon;
grant execute on function public.merge_candidates_v1(uuid) to authenticated, service_role;
