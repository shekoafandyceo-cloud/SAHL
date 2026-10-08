-- jt_issues_review_actions (8 أكتوبر) — مراجعة المالك بقت «✓ تمام» أو «↩️ رجّعها للموظف» بتعليق (فوق jt_issues_review_log).
--
-- اللي اتغيّر عن jt_issues_review_log (اتطبّق من ساعة):
--   • staff_rev = عدّاد تعديلات التعامل (كل حفظة فيها تغيير فعلي = +1). reviewed_rev = النسخة اللي المالك راجعها.
--     «محتاجة مراجعة» = اتصنّفت و(reviewed_rev فاضي أو أقل من staff_rev). ده بيحل محل «مسح المراجعة لما الموظف
--     يعدّل»: المراجعة القديمة بتفضل (السطر بيقول «اتعدّلت بعد مراجعتك») والكارت بيرجع للطابور لوحده.
--     🔴 رقم مش وقت: الـJS بيقص الميكروثانية من أي timestamp، فمقارنة الأوقات كانت هتغلط في الاتجاهين.
--   • review_state: ok (تمام) · sent_back (رجّعها للموظف — review_note إجباري) · self (الأدمن اتعامل بنفسه).
--   • jt_issue_review(p_id, p_action, p_note, p_seen_rev): ok · sent_back · undo. p_seen_rev = staff_rev اللي
--     المالك كان شايفه — اتغيّر (موظف عدّل وهو بيراجع) = مفيش كتابة ويرجع stale:true بالصف الحالي.
--   • jt_issue_save: الموظف بيعدّل = staff_rev+1 والمراجعة القديمة بتفضل · الأدمن = staff_rev+1 و«سجّلها بنفسه».
--   • السجل: prev_verdict/prev_note (قبل الحفظة) + review_state/review_note (في المراجعة) + actor_role.
--   • v_jt_issues + verdict_by · staff_rev · reviewed_rev · review_state · review_note · keep_loaded في الآخر.
--     keep_loaded = محتاجة مراجعة أو مترجّعة للموظف — الواجهة بتحمّلها حتى لو أقدم من الـ30 يوم.
--   • jt_issue_review(bigint, boolean) القديمة (عمرها ساعة ومحدش ناداها) = مقفولة على authenticated.
-- 🔴 مفيش أي أمر حذف هنا (درس 53). والـALTER على jt_issues بياخد قفل لحظة: لو مسح 110 وصل في نفس اللحظة
--    التريجر بيفشل بهدوء (lock_timeout 2s) — عشان كده app.jt_issues_backfill() في الآخر (idempotent).

set local lock_timeout = '4s';

-- ── 1) الأعمدة ────────────────────────────────────────────────────────────
alter table public.jt_issues
  add column if not exists staff_rev    integer not null default 0,
  add column if not exists reviewed_rev integer,
  add column if not exists review_state text,
  add column if not exists review_note  text;
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'jt_issues_review_state_chk') then
    alter table public.jt_issues add constraint jt_issues_review_state_chk
      check (review_state in ('ok', 'sent_back', 'self'));
  end if;
end
$c$;
comment on column public.jt_issues.staff_rev is
  'عدّاد تعديلات التعامل (تصنيف/ملاحظة) — بيزيد مع كل حفظة فيها تغيير فعلي. المراجعة بتتقارن بيه.';
comment on column public.jt_issues.reviewed_rev is
  'staff_rev اللي المالك راجعه. أقل من staff_rev = الموظف عدّل بعد المراجعة = محتاجة مراجعة تاني.';
comment on column public.jt_issues.review_state is
  'ok = المالك قال تمام · sent_back = رجّعها للموظف (review_note فيها المطلوب) · self = الأدمن اتعامل بنفسه.';

alter table public.jt_issue_log
  add column if not exists prev_verdict text,
  add column if not exists prev_note    text,
  add column if not exists review_state text,
  add column if not exists review_note  text,
  add column if not exists actor_role   text;

-- اللي اتعامل قبل كده = نسخة 1 · واللي الأدمن اتعامل معاه بنفسه (reviewed_at متسجّل من الـmigration اللي فاتت) = self
update public.jt_issues i
   set staff_rev = 1
 where i.staff_updated_at is not null and (i.verdict is not null or i.staff_note is not null) and i.staff_rev = 0;
update public.jt_issues i
   set reviewed_rev = i.staff_rev, review_state = 'self'
 where i.reviewed_at is not null and i.review_state is null;
update public.jt_issue_log l
   set actor_role = up.role
  from public.user_profiles up
 where up.id = l.by_user and l.actor_role is null;

-- ── 2) الحفظ ──────────────────────────────────────────────────────────────
create or replace function public.jt_issue_save(p_id bigint, p_verdict text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_verdict text := nullif(trim(coalesce(p_verdict, '')), '');
  v_note    text := nullif(left(trim(coalesce(p_note, '')), 2000), '');
  v_name    text;
  v_admin   boolean := coalesce(is_tenant_admin(), false);
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
    update jt_issues i
       set verdict = v_verdict, staff_note = v_note, staff_updated_at = now(), updated_at = now(),
           verdict_by = auth.uid(), verdict_by_name = v_name,
           staff_rev = i.staff_rev + 1,
           -- الأدمن اتعامل بنفسه (بتصنيف) = مفيش حد يراجعه · الموظف = المراجعة القديمة بتفضل والـrev بيرجّعها للطابور
           reviewed_rev     = case when v_admin and v_verdict is not null then i.staff_rev + 1 else i.reviewed_rev end,
           review_state     = case when v_admin and v_verdict is not null then 'self' else i.review_state end,
           review_note      = case when v_admin and v_verdict is not null then null else i.review_note end,
           reviewed_at      = case when v_admin and v_verdict is not null then now() else i.reviewed_at end,
           reviewed_by      = case when v_admin and v_verdict is not null then auth.uid() else i.reviewed_by end,
           reviewed_by_name = case when v_admin and v_verdict is not null then v_name else i.reviewed_by_name end
     where i.id = p_id
    returning i.* into r;
    insert into jt_issue_log (tenant_id, issue_id, by_user, by_name, actor_role, action, verdict, note,
                              verdict_changed, note_changed, prev_verdict, prev_note)
    values (v_tenant, p_id, auth.uid(), v_name, case when v_admin then 'admin' else 'employee' end, 'save',
            v_verdict, v_note, o.verdict is distinct from v_verdict, o.staff_note is distinct from v_note,
            o.verdict, o.staff_note);
  else
    r := o;   -- نفس القيم = مفيش تعديل (مابيغيّرش اسم اللي سجّل ولا المراجعة ولا الـrev)
  end if;
  return jsonb_build_object('id', r.id, 'verdict', r.verdict, 'staff_note', r.staff_note,
                            'staff_updated_at', r.staff_updated_at, 'verdict_by', r.verdict_by,
                            'verdict_by_name', r.verdict_by_name, 'staff_rev', r.staff_rev,
                            'reviewed_rev', r.reviewed_rev, 'review_state', r.review_state, 'review_note', r.review_note,
                            'reviewed_at', r.reviewed_at, 'reviewed_by_name', r.reviewed_by_name);
end
$fn$;
comment on function public.jt_issue_save(bigint, text, text) is
  'تاب استثناءات الشحن: حفظ التصنيف والملاحظة + مين وإمتى + staff_rev+1 + سطر في jt_issue_log. الأدمن بتصنيف = self.';
revoke all on function public.jt_issue_save(bigint, text, text) from public, anon;
grant execute on function public.jt_issue_save(bigint, text, text) to authenticated;

-- ── 3) المراجعة (الأدمن بس) ───────────────────────────────────────────────
create or replace function public.jt_issue_review(p_id bigint, p_action text, p_note text, p_seen_rev integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tenant uuid := app.current_tenant_id();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_note   text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
  v_name   text;
  v_stale  boolean := false;
  o        jt_issues;
  r        jt_issues;
begin
  if v_tenant is null or not coalesce(is_tenant_admin(), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_action not in ('ok', 'sent_back', 'undo') then
    raise exception 'bad_action' using errcode = '22023';
  end if;
  if v_action = 'sent_back' and v_note is null then
    raise exception 'note_required' using errcode = '22023';
  end if;
  select * into o from jt_issues i where i.id = p_id and i.tenant_id = v_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_action in ('ok', 'sent_back') and o.verdict is null then
    raise exception 'not_handled' using errcode = '22023';
  end if;

  if p_seen_rev is not null and p_seen_rev <> o.staff_rev then
    v_stale := true; r := o;   -- الموظف عدّل وانت بتراجع — مانكتبش حاجة، ونرجّع الجديد
  elsif v_action = 'undo' and o.review_state is null then
    r := o;
  elsif v_action = 'ok' and o.review_state = 'ok' and o.reviewed_rev = o.staff_rev then
    r := o;
  else
    select nullif(trim(up.full_name), '') into v_name from user_profiles up where up.id = auth.uid();
    v_name := coalesce(v_name, 'الأدمن');
    if v_action = 'undo' then
      update jt_issues i
         set reviewed_rev = null, review_state = null, review_note = null,
             reviewed_at = null, reviewed_by = null, reviewed_by_name = null, updated_at = now()
       where i.id = p_id returning i.* into r;
    else
      update jt_issues i
         set reviewed_rev = o.staff_rev, review_state = v_action,
             review_note = case when v_action = 'sent_back' then v_note end,
             reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_name = v_name, updated_at = now()
       where i.id = p_id returning i.* into r;
    end if;
    insert into jt_issue_log (tenant_id, issue_id, by_user, by_name, actor_role, action, verdict, note,
                              review_state, review_note)
    values (v_tenant, p_id, auth.uid(), v_name, 'admin',
            case when v_action = 'undo' then 'unreview' else 'review' end,
            o.verdict, o.staff_note,
            case when v_action = 'undo' then null else v_action end,
            case when v_action = 'sent_back' then v_note end);
  end if;
  return jsonb_build_object('id', r.id, 'stale', v_stale, 'verdict', r.verdict, 'staff_note', r.staff_note,
                            'staff_updated_at', r.staff_updated_at, 'verdict_by', r.verdict_by,
                            'verdict_by_name', r.verdict_by_name, 'staff_rev', r.staff_rev,
                            'reviewed_rev', r.reviewed_rev, 'review_state', r.review_state, 'review_note', r.review_note,
                            'reviewed_at', r.reviewed_at, 'reviewed_by_name', r.reviewed_by_name,
                            'updated_at', r.updated_at);
end
$fn$;
comment on function public.jt_issue_review(bigint, text, text, integer) is
  'تاب استثناءات الشحن (الأدمن بس): ok · sent_back (بتعليق) · undo. p_seen_rev اتغيّر = stale ومفيش كتابة. + سطر في jt_issue_log.';
revoke all on function public.jt_issue_review(bigint, text, text, integer) from public, anon;
grant execute on function public.jt_issue_review(bigint, text, text, integer) to authenticated;

-- القديمة (بوليان) محدش ناداها — مقفولة عشان المراجعة يبقى ليها طريق واحد بحارس stale
revoke all on function public.jt_issue_review(bigint, boolean) from public, anon, authenticated;
comment on function public.jt_issue_review(bigint, boolean) is
  'قديمة (8 أكتوبر — عاشت ساعة) ومقفولة. المراجعة من jt_issue_review(bigint, text, text, integer).';

-- ── 4) الفيو: + أعمدة المراجعة في الآخر ─────────────────────────────────────
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
         or (i.review_state = 'sent_back' and i.reviewed_rev >= i.staff_rev) as keep_loaded
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
         x.verdict_by, x.staff_rev, x.reviewed_rev, x.review_state, x.review_note
  from public.jt_issues x
) i
left join public.orders o on o.id = i.order_id
where i.event_at >= app.jt_issues_since();
revoke all on public.v_jt_issues from anon, authenticated;
grant select on public.v_jt_issues to authenticated;

-- أي مسح 110/172 وصل وقت قفل الـALTER واتفوّت = بيتسجّل هنا (idempotent · بيحترم بداية التتبع)
select app.jt_issues_backfill();

notify pgrst, 'reload schema';
