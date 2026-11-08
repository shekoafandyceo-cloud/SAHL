-- jt_issues_reported_by (8 أكتوبر) — من المراجعة العدائية التانية لـ«📣 بلاغاتنا لـJ&T» (v71).
--
-- reported_at بقى ثابت مع التبديل بين FAKE UPDATE و«غلطة من J&T» (jt_issues_report_times)، بس الواجهة كانت بتكتب جنبه
-- verdict_set_by_name — وده بيتغيّر مع أي تبديل. يعني ebrahim بلّغ 10:00 والأدمن بدّل النوع 15:00 = الكارت والتصدير بيقولوا
-- «📣 shekoz بلّغ 10:00» (نسبة لحد ماعملش الحاجة دي). الحل: مين بلّغ يتخزّن جنب إمتى، بنفس القاعدة بالحرف.
-- 🔴 مفيش أي أمر حذف هنا (درس 53). العمود الجديد في آخر الفيو (درس 12).

set local lock_timeout = '4s';

alter table public.jt_issues
  add column if not exists reported_by      uuid,
  add column if not exists reported_by_name text;
comment on column public.jt_issues.reported_by_name is
  'مين صنّف الاستثناء بلاغ لـJ&T أول مرة (مع reported_at) — مابيتغيّرش مع التبديل بين FAKE UPDATE و«غلطة من J&T».';

-- الموجود: من سطر السجل اللي عمل البلاغ (التصنيف بقى بلاغ وماكانش) — وإلا من اللي اختار التصنيف
update public.jt_issues i
   set reported_by = coalesce(x.by_user, i.verdict_set_by),
       reported_by_name = coalesce(x.by_name, i.verdict_set_by_name)
  from public.jt_issues i0
  left join lateral (
    select l.by_user, l.by_name from public.jt_issue_log l
     where l.issue_id = i0.id and l.action = 'save'
       and l.verdict in ('fake_update', 'jt_error')
       and (l.prev_verdict is null or l.prev_verdict not in ('fake_update', 'jt_error'))
       and l.at <= i0.reported_at + interval '1 second'
     order by l.at desc limit 1
  ) x on true
 where i.id = i0.id and i0.reported_at is not null and i.reported_by_name is null;

create or replace function public.jt_issue_save(p_id bigint, p_verdict text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_verdict text := nullif(trim(coalesce(p_verdict, '')), '');
  v_note    text := nullif(left(trim(coalesce(p_note, '')), 2000), '');
  v_name    text;
  v_admin   boolean := coalesce(is_tenant_admin(), false);
  v_vchg    boolean;
  v_self    boolean;
  o         jt_issues;
  r         jt_issues;
begin
  if v_tenant is null or not app.is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_verdict is not null and v_verdict not in
     ('fake_update', 'real_delay', 'real_refusal', 'no_answer_us', 'data_fixed', 'jt_error') then
    raise exception 'bad_verdict' using errcode = '22023';
  end if;
  select * into o from jt_issues i where i.id = p_id and i.tenant_id = v_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  if o.verdict is distinct from v_verdict or o.staff_note is distinct from v_note then
    select nullif(trim(up.full_name), '') into v_name from user_profiles up where up.id = auth.uid();
    v_name := coalesce(v_name, case when v_admin then 'الأدمن' else 'موظف' end);
    v_vchg := o.verdict is distinct from v_verdict;
    -- «اتعامل بنفسه» = الأدمن هو اللي اختار التصنيف (دلوقتي أو قبل كده) · عدّل ملاحظة موظف بس = «راجعها»
    v_self := v_vchg or o.verdict_set_by = auth.uid();
    update jt_issues i
       set verdict = v_verdict, staff_note = v_note, staff_updated_at = now(), updated_at = now(),
           verdict_by = auth.uid(), verdict_by_name = v_name,
           verdict_set_by      = case when v_vchg then case when v_verdict is null then null else auth.uid() end else i.verdict_set_by end,
           verdict_set_by_name = case when v_vchg then case when v_verdict is null then null else v_name end else i.verdict_set_by_name end,
           verdict_set_at      = case when v_vchg then case when v_verdict is null then null else now() end else i.verdict_set_at end,
           -- البلاغ لـJ&T: أول مرة بس (إمتى ومين) — التبديل بين النوعين مابيحرّكهمش، والخروج منه بيمسحهم
           reported_at = case when v_verdict in ('fake_update', 'jt_error')
                              then case when o.verdict in ('fake_update', 'jt_error')
                                        then coalesce(i.reported_at, i.verdict_set_at, now()) else now() end
                         end,
           reported_by = case when v_verdict in ('fake_update', 'jt_error')
                              then case when o.verdict in ('fake_update', 'jt_error')
                                        then coalesce(i.reported_by, i.verdict_set_by) else auth.uid() end
                         end,
           reported_by_name = case when v_verdict in ('fake_update', 'jt_error')
                                   then case when o.verdict in ('fake_update', 'jt_error')
                                             then coalesce(i.reported_by_name, i.verdict_set_by_name) else v_name end
                              end,
           staff_rev = i.staff_rev + 1,
           reviewed_rev     = case when v_admin and v_verdict is not null then i.staff_rev + 1 else i.reviewed_rev end,
           review_state     = case when v_admin and v_verdict is not null then (case when v_self then 'self' else 'ok' end) else i.review_state end,
           review_note      = case when v_admin and v_verdict is not null then null else i.review_note end,
           reviewed_at      = case when v_admin and v_verdict is not null then now() else i.reviewed_at end,
           reviewed_by      = case when v_admin and v_verdict is not null then auth.uid() else i.reviewed_by end,
           reviewed_by_name = case when v_admin and v_verdict is not null then v_name else i.reviewed_by_name end
     where i.id = p_id
    returning i.* into r;
    insert into jt_issue_log (tenant_id, issue_id, by_user, by_name, actor_role, action, verdict, note,
                              verdict_changed, note_changed, prev_verdict, prev_note)
    values (v_tenant, p_id, auth.uid(), v_name, case when v_admin then 'admin' else 'employee' end, 'save',
            v_verdict, v_note, v_vchg, o.staff_note is distinct from v_note, o.verdict, o.staff_note);
  else
    r := o;   -- نفس القيم = مفيش تعديل (مابيغيّرش اسم اللي سجّل ولا المراجعة ولا الـrev)
  end if;
  return jsonb_build_object('id', r.id, 'verdict', r.verdict, 'staff_note', r.staff_note,
                            'staff_updated_at', r.staff_updated_at, 'verdict_by', r.verdict_by,
                            'verdict_by_name', r.verdict_by_name, 'verdict_set_by_name', r.verdict_set_by_name,
                            'verdict_set_at', r.verdict_set_at, 'reported_at', r.reported_at,
                            'reported_by_name', r.reported_by_name, 'staff_rev', r.staff_rev,
                            'reviewed_rev', r.reviewed_rev, 'review_state', r.review_state, 'review_note', r.review_note,
                            'reviewed_at', r.reviewed_at, 'reviewed_by_name', r.reviewed_by_name, 'updated_at', r.updated_at);
end
$fn$;
comment on function public.jt_issue_save(bigint, text, text) is
  'تاب استثناءات الشحن: حفظ التصنيف والملاحظة + مين وإمتى (ومين اختار التصنيف) + reported_at/reported_by_name (أول بلاغ لـJ&T) + staff_rev+1 + سطر في jt_issue_log. الأدمن: اختار = self · عدّل ملاحظة موظف = ok.';
revoke all on function public.jt_issue_save(bigint, text, text) from public, anon;
grant execute on function public.jt_issue_save(bigint, text, text) to authenticated;

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
       i.verdict_set_by_name, i.verdict_set_at,
       i.reported_at, i.return_started_at,
       i.reported_by_name
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
         x.verdict_set_by_name, x.verdict_set_at,
         x.reported_at, x.return_started_at,
         x.reported_by_name
  from public.jt_issues x
) i
left join public.orders o on o.id = i.order_id
where i.event_at >= app.jt_issues_since();
revoke all on public.v_jt_issues from anon, authenticated;
grant select on public.v_jt_issues to authenticated;

notify pgrst, 'reload schema';
