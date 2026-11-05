-- wa_ofd_test_gate (11 أكتوبر — رسالة تجربة «المندوب في الطريق» على رقم المالك)
--
-- من المراجعة العدائية على EF wa-ofd-test قبل أول إرسال:
--  1) المستلم كان من wa_auto_templates.pilot_wa_ids — ودي قايمة الإنتاج (في وضع pilot العميل بيستلم عن أوردره هو).
--     التجربة بتبعت بيانات أوردر عميل تاني (اسمه الأول ورقم طلبه والمندوب)، فلو القايمة كبرت يوم = تسريب بين العملاء،
--     والـEF بتفضل منشورة بنفس الـdiag token بتاع الكرون. → قايمة لوحدها في platform_settings('wa_ofd_test')
--     بتنتهي (expires_at) وبسقف إجمالي (max_sends).
--  2) حارس الـ60ث كان بيقرا صف الصندوق اللي بيتكتب بعد رد ميتا = ضغطتين متوازيين · timeout · فشل الصندوق = تكرار.
--     → حجز ذري قبل ميتا (wa_ofd_test_reserve — قفل + فحص + صف) والنتيجة بعدين (wa_ofd_test_finish).
--     الحجز بيتعدّ مهما كانت النتيجة (unknown = اتبعت غالباً — نفس قاعدة الإنتاج).
--
-- مفيش DROP (درس 53) · service_role بس.

create table if not exists public.wa_ofd_test_sends (
  id          bigserial primary key,
  tenant_id   uuid not null,
  wa_id       text not null,
  order_uid   text,
  reserved_at timestamptz not null default now(),
  kind        text,          -- sent · unknown · transient · permanent · pause · deferred · skipped
  code        text,
  wamid       text,
  finished_at timestamptz
);
alter table public.wa_ofd_test_sends enable row level security;   -- مفيش سياسات = المتصفح مالوش وصول
revoke all on public.wa_ofd_test_sends from public, anon, authenticated;
grant select, insert, update on public.wa_ofd_test_sends to service_role;
grant usage on sequence public.wa_ofd_test_sends_id_seq to service_role;
comment on table public.wa_ofd_test_sends is
  'سجل رسايل تجربة قالب «المندوب في الطريق» (EF wa-ofd-test) — حجز قبل ميتا والنتيجة بعدها. service_role بس.';

-- الإعداد: رقم المالك بس · بينتهي آخر يوم 12 أكتوبر بتوقيت القاهرة · 3 رسايل بالكتير
insert into public.platform_settings (key, value, description)
values ('wa_ofd_test',
        '{"tenant_id":"9c58b214-f11d-4de5-afc7-a0de0b903f36","wa_ids":["201050005219"],"expires_at":"2026-10-12T21:00:00Z","max_sends":3}',
        'تجربة قالب «المندوب في الطريق» (EF wa-ofd-test): المستلمين (wa_id) · انتهاء · سقف إجمالي. منفصلة عن pilot_wa_ids عمداً.')
on conflict (key) do nothing;

create or replace function public.wa_ofd_test_reserve(p_tenant uuid, p_wa_id text, p_order_uid text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_cfg jsonb; v_exp timestamptz; v_max int; v_used int; v_last timestamptz; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('wa_ofd_test'));             -- نداءين متوازيين = واحد ورا التاني
  begin
    select value::jsonb into v_cfg from platform_settings where key = 'wa_ofd_test';
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_config');
  end;
  if v_cfg is null then return jsonb_build_object('ok', false, 'reason', 'no_config'); end if;
  if (v_cfg->>'tenant_id') is distinct from p_tenant::text then
    return jsonb_build_object('ok', false, 'reason', 'wrong_tenant');
  end if;
  begin
    v_exp := (v_cfg->>'expires_at')::timestamptz;
    v_max := coalesce((v_cfg->>'max_sends')::int, 0);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_config');
  end;
  if v_exp is null or now() >= v_exp then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not (coalesce(v_cfg->'wa_ids', '[]'::jsonb) ? p_wa_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  select count(*) into v_used from wa_ofd_test_sends where tenant_id = p_tenant;
  if v_used >= v_max then
    return jsonb_build_object('ok', false, 'reason', 'cap_reached', 'used', v_used, 'max', v_max);
  end if;
  select max(reserved_at) into v_last from wa_ofd_test_sends where tenant_id = p_tenant and wa_id = p_wa_id;
  if v_last is not null and now() - v_last < interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'cooldown');
  end if;
  insert into wa_ofd_test_sends (tenant_id, wa_id, order_uid) values (p_tenant, p_wa_id, left(p_order_uid, 40))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'used', v_used + 1, 'max', v_max);
end$$;

create or replace function public.wa_ofd_test_finish(p_id bigint, p_kind text, p_code text, p_wamid text)
returns void
language sql
set search_path = public
as $$
  update wa_ofd_test_sends
     set kind = left(p_kind, 20), code = left(p_code, 40), wamid = left(p_wamid, 200), finished_at = now()
   where id = p_id and finished_at is null;
$$;

revoke all on function public.wa_ofd_test_reserve(uuid, text, text) from public, anon, authenticated;
revoke all on function public.wa_ofd_test_finish(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.wa_ofd_test_reserve(uuid, text, text) to service_role;
grant execute on function public.wa_ofd_test_finish(bigint, text, text, text) to service_role;
