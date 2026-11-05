-- jt_issues_keep_loaded_sent_back (8 أكتوبر) — من المراجعة العدائية لتاب الاستثناءات v70.
-- الواجهة بقت تعتبر «اترجّعت للموظف وهو شال التصنيف» لسه محتاجة تعامل (jxNeedsFollow) — فـkeep_loaded لازم
-- يغطيها هي كمان، وإلا بعد 30 يوم من الاستثناء تختفي من الطابور (التحميل الأساسي آخر 30 يوم بس).
-- نفس الفيو بالحرف (الأعمدة ونفس الترتيب) — التعبير بتاع keep_loaded بس. 🔴 مفيش أي أمر حذف (درس 53).

set local lock_timeout = '4s';

create or replace view public.v_jt_issues with (security_invoker = on) as
select i.id, i.tenant_id, i.order_id, i.tracking_no, i.kind, i.event_at,
       i.reason_code, i.reason_en, i.reason_ar, i.courier_note,
       i.branch, i.branch_phone, i.courier_name, i.courier_phone, i.photo_url,
       i.verdict, i.staff_note, i.staff_updated_at, i.verdict_by_name,
       i.outcome, i.outcome_at, i.created_at, i.updated_at,
       i.attempt,
       o.order_uid, o.customer_name, o.phone, o.alt_phone, o.city, o.address,
       o.ship_prov, o.ship_city, o.ship_area, o.product_name, o.total_cost, o.jt_cod_amount,
       o.status as order_status,
       i.reviewed_at, i.reviewed_by_name,
       i.verdict_by, i.staff_rev, i.reviewed_rev, i.review_state, i.review_note,
       (i.verdict is not null and (i.reviewed_rev is null or i.reviewed_rev < i.staff_rev))
         or (i.review_state = 'sent_back' and i.reviewed_rev >= i.staff_rev)
         or (i.review_state = 'sent_back' and i.verdict is null) as keep_loaded,
       i.verdict_set_by_name, i.verdict_set_at
from (
  select x.id, x.tenant_id, x.order_id, x.tracking_no, x.kind, x.event_at,
         x.reason_code, x.reason_en, x.reason_ar, x.courier_note,
         x.branch, x.branch_phone, x.courier_name, x.courier_phone, x.photo_url,
         x.verdict, x.staff_note, x.staff_updated_at, x.verdict_by_name,
         x.outcome, x.outcome_at, x.created_at, x.updated_at,
         case when x.kind = 'exception' then
           count(*) filter (where x.kind = 'exception')
             over (partition by x.tracking_no order by x.event_at rows between unbounded preceding and current row)
         end as attempt,
         x.reviewed_at, x.reviewed_by_name,
         x.verdict_by, x.staff_rev, x.reviewed_rev, x.review_state, x.review_note,
         x.verdict_set_by_name, x.verdict_set_at
  from public.jt_issues x
) i
left join public.orders o on o.id = i.order_id
where i.event_at >= app.jt_issues_since();
revoke all on public.v_jt_issues from anon, authenticated;
grant select on public.v_jt_issues to authenticated;

notify pgrst, 'reload schema';
