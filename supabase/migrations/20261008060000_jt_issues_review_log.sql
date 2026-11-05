-- jt_issues_review_log (8 أكتوبر) — تاب «استثناءات الشحن»: مين اتعامل وإمتى + المالك يراجع (بلاغ المالك).
--
-- «انا مش عارف مين اتعامل على الاوردر و اتعامل امتى ؟ و الاوردرات الي تم التعامل معاها اجيبها منين عشان
--  اتابعها انا بعد ما الموظفين يتعاملوا معاهم»
--
-- قبل كده: أول ما الموظف يصنّف الكارت بيخرج من «محتاجة متابعة» ومالوش مكان، و`jt_issues` بيحفظ **آخر**
-- تصنيف/ملاحظة/اسم بس (أي تعديل بيمسح اللي قبله).
--
-- الشكل:
--   • jt_issues.reviewed_at/by/by_name = «المالك راجعها». المرحلة التانية في التاب = اتصنّفت ولسه محدش راجعها.
--   • jt_issue_log = سطر لكل فعل (حفظ · مراجعة · رجوع للمراجعة) بمين وإمتى وإيه — مابيتمسحش ومحدش بيكتبه
--     غير الدالتين (DEFINER). القراية للمتجر بس (RLS).
--   • jt_issue_save: التعديل من موظف = المراجعة بتتشال (رجعت للمالك يشوف الجديد) · التعديل من الأدمن نفسه =
--     متراجعة أوتوماتيك (هو اللي عمل — مفيش حد يراجعه). وكل تغيير فعلي = سطر في السجل.
--   • jt_issue_review(id, reviewed): الأدمن بس · لازم تكون اتصنّفت.
--   • v_jt_issues + reviewed_at/reviewed_by_name في الآخر (create or replace — الأعمدة الجديدة آخر الفيو).
-- 🔴 مفيش أي أمر حذف هنا (درس 53). والواجهة القديمة (v68/v69) متوافقة: أعمدة جديدة وسجل جديد بس، ورد
--    jt_issue_save فيه نفس المفاتيح + مفاتيح زيادة.

set local lock_timeout = '4s';

-- ── 1) المراجعة على الاستثناء ────────────────────────────────────────────
alter table public.jt_issues
  add column if not exists reviewed_at      timestamptz,
  add column if not exists reviewed_by      uuid,
  add column if not exists reviewed_by_name text;
comment on column public.jt_issues.reviewed_at is
  'المالك (أدمن) راجع تعامل الموظف — NULL = لسه. أي تعديل من موظف بعدها بيرجّعها NULL. التعديل من أدمن = متراجعة.';

-- ── 2) السجل ──────────────────────────────────────────────────────────────
create table if not exists public.jt_issue_log (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null,
  issue_id        bigint not null references public.jt_issues(id),
  at              timestamptz not null default now(),
  by_user         uuid,
  by_name         text,
  action          text not null check (action in ('save', 'review', 'unreview')),
  verdict         text,
  note            text,
  verdict_changed boolean not null default false,
  note_changed    boolean not null default false
);
create index if not exists jt_issue_log_issue_idx  on public.jt_issue_log (issue_id, at);
create index if not exists jt_issue_log_tenant_idx on public.jt_issue_log (tenant_id, at desc);
comment on table public.jt_issue_log is
  'تاب استثناءات الشحن: سطر لكل فعل (save · review · unreview) بمين وإمتى — بيكتبه jt_issue_save/jt_issue_review بس.';
alter table public.jt_issue_log enable row level security;
do $do$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jt_issue_log'
                 and policyname = 'jt_issue_log_select_same_tenant') then
    create policy jt_issue_log_select_same_tenant on public.jt_issue_log
      for select to authenticated
      using (is_super_admin() or tenant_id = app.current_tenant_id());
  end if;
end
$do$;
revoke all on public.jt_issue_log from anon, authenticated;
grant select on public.jt_issue_log to authenticated;

-- اللي اتعمل قبل السجل: سطر واحد بآخر تعامل متسجّل (هو كل اللي نعرفه — اللي اتمسح قبل كده مالوش أثر)
insert into public.jt_issue_log (tenant_id, issue_id, at, by_user, by_name, action, verdict, note, verdict_changed, note_changed)
select i.tenant_id, i.id, i.staff_updated_at, i.verdict_by, i.verdict_by_name, 'save', i.verdict, i.staff_note,
       i.verdict is not null, i.staff_note is not null
from public.jt_issues i
where i.staff_updated_at is not null
  and not exists (select 1 from public.jt_issue_log l where l.issue_id = i.id);

-- اللي الأدمن نفسه صنّفه من بداية التتبع = متراجع (هو اللي عمل — نفس قاعدة jt_issue_save تحت)
update public.jt_issues i
   set reviewed_at = i.staff_updated_at, reviewed_by = i.verdict_by, reviewed_by_name = i.verdict_by_name, updated_at = now()
 where i.verdict is not null and i.reviewed_at is null and i.event_at >= app.jt_issues_since()
   and exists (select 1 from public.user_profiles up where up.id = i.verdict_by and up.role = 'admin');

-- ── 3) الحفظ: سطر في السجل + المراجعة ─────────────────────────────────────
create or replace function public.jt_issue_save(p_id bigint, p_verdict text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_verdict text := nullif(trim(coalesce(p_verdict, '')), '');
  v_note    text := nullif(left(trim(coalesce(p_note, '')), 2000), '');
  v_name    text;
  v_admin   boolean := is_tenant_admin();
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
    v_name := coalesce(v_name, 'موظف');
    update jt_issues i
       set verdict = v_verdict, staff_note = v_note, staff_updated_at = now(), updated_at = now(),
           verdict_by = auth.uid(), verdict_by_name = v_name,
           -- موظف عدّل = المالك لازم يشوف الجديد · الأدمن عدّل = هو اللي عمل، مفيش حد يراجعه
           reviewed_at      = case when v_admin and v_verdict is not null then now() end,
           reviewed_by      = case when v_admin and v_verdict is not null then auth.uid() end,
           reviewed_by_name = case when v_admin and v_verdict is not null then v_name end
     where i.id = p_id
    returning i.* into r;
    insert into jt_issue_log (tenant_id, issue_id, by_user, by_name, action, verdict, note, verdict_changed, note_changed)
    values (v_tenant, p_id, auth.uid(), v_name, 'save', v_verdict, v_note,
            o.verdict is distinct from v_verdict, o.staff_note is distinct from v_note);
  else
    r := o;   -- نفس القيم = مفيش تعديل (مابيغيّرش اسم اللي سجّل ولا المراجعة)
  end if;
  return jsonb_build_object('id', r.id, 'verdict', r.verdict, 'staff_note', r.staff_note,
                            'staff_updated_at', r.staff_updated_at, 'verdict_by_name', r.verdict_by_name,
                            'reviewed_at', r.reviewed_at, 'reviewed_by_name', r.reviewed_by_name);
end
$fn$;
comment on function public.jt_issue_save(bigint, text, text) is
  'تاب استثناءات الشحن: حفظ التصنيف والملاحظة + مين وإمتى + سطر في jt_issue_log. موظف عدّل = المراجعة اتشالت · أدمن = متراجعة.';
revoke all on function public.jt_issue_save(bigint, text, text) from public, anon;
grant execute on function public.jt_issue_save(bigint, text, text) to authenticated;

-- ── 4) المراجعة (الأدمن بس) ───────────────────────────────────────────────
create or replace function public.jt_issue_review(p_id bigint, p_reviewed boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tenant uuid := app.current_tenant_id();
  v_name   text;
  o        jt_issues;
  r        jt_issues;
begin
  if v_tenant is null or not is_tenant_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into o from jt_issues i where i.id = p_id and i.tenant_id = v_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_reviewed, true) and o.verdict is null then
    raise exception 'not_handled' using errcode = '22023';
  end if;
  if coalesce(p_reviewed, true) = (o.reviewed_at is not null) then
    r := o;   -- نفس الحالة = مفيش تعديل
  else
    select nullif(trim(up.full_name), '') into v_name from user_profiles up where up.id = auth.uid();
    v_name := coalesce(v_name, 'أدمن');
    update jt_issues i
       set reviewed_at      = case when coalesce(p_reviewed, true) then now() end,
           reviewed_by      = case when coalesce(p_reviewed, true) then auth.uid() end,
           reviewed_by_name = case when coalesce(p_reviewed, true) then v_name end,
           updated_at = now()
     where i.id = p_id
    returning i.* into r;
    insert into jt_issue_log (tenant_id, issue_id, by_user, by_name, action, verdict, note)
    values (v_tenant, p_id, auth.uid(), v_name, case when coalesce(p_reviewed, true) then 'review' else 'unreview' end,
            o.verdict, o.staff_note);
  end if;
  return jsonb_build_object('id', r.id, 'reviewed_at', r.reviewed_at, 'reviewed_by_name', r.reviewed_by_name);
end
$fn$;
comment on function public.jt_issue_review(bigint, boolean) is
  'تاب استثناءات الشحن: الأدمن بيعلّم إنه راجع تعامل الموظف (أو يرجّعها للمراجعة) + سطر في jt_issue_log.';
revoke all on function public.jt_issue_review(bigint, boolean) from public, anon;
grant execute on function public.jt_issue_review(bigint, boolean) to authenticated;

-- ── 5) الفيو: + المراجعة في الآخر ─────────────────────────────────────────
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
       i.reviewed_at, i.reviewed_by_name
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
         x.reviewed_at, x.reviewed_by_name
  from public.jt_issues x
) i
left join public.orders o on o.id = i.order_id
where i.event_at >= app.jt_issues_since();
revoke all on public.v_jt_issues from anon, authenticated;
grant select on public.v_jt_issues to authenticated;

notify pgrst, 'reload schema';
