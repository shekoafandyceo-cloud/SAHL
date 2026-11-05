-- wa_ofd_health_numeric_scan_code (11 أكتوبر — من المراجعة قبل التشغيل للكل):
-- app.wa_ofd_health (بانر «رسايل المندوب في الطريق» للأدمن) كان بيدوّر على مسح الخروج من الفرع (50/92) بـ
--   payload->'details' @> '[{"scanTypeCode":"50"}]'  = نص — وJ&T بتبعته رقم في الـpush (3,478 من 3,478 · صفر نص).
-- فعدّاد «stale» (شحنة خرجت للتسليم ورسالتها ماخرجتش > 15 د) كان شايف اللي اتلقط بالـpull بس: 17 من 51 يوم التشغيل.
-- يعني لو الإرسال وقف في صمت، البانر كان هيعدّ تلت الحقيقة. التصليح: ->> زي wa_ofd_candidates_v1 بالظبط (بيقرا الرقم والنص).
-- create or replace بس (مفيش DROP — درس 53) · نفس التوقيع والصلاحيات. باقي الدالة = 20261011100000_wa_ofd_notify §13 بالحرف.

create or replace function app.wa_ofd_health(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $fn$
declare a wa_auto_templates; loc timestamp := now() at time zone 'Africa/Cairo'; v_open timestamptz; v_close_prev timestamptz;
        v_stale int := 0; v_overdue int := 0; v_unparsed int := 0; v_today int := 0; v_last_ok timestamptz; v_err text; v_err_at timestamptz;
begin
  select * into a from wa_auto_templates where tenant_id = p_tenant and event = 'out_for_delivery';
  if not found or a.mode = 'off' then return jsonb_build_object('mode', coalesce(a.mode, 'off')); end if;
  v_open := (date_trunc('day', loc) + make_interval(hours => a.send_from_hour)) at time zone 'Africa/Cairo';
  v_close_prev := (date_trunc('day', loc) - interval '1 day' + make_interval(hours => a.send_to_hour)) at time zone 'Africa/Cairo';
  select count(*) into v_today from wa_ofd_sends x where x.tenant_id = p_tenant and x.status in ('sent','unknown','sending')
     and x.created_at >= (date_trunc('day', loc) at time zone 'Africa/Cairo');
  if a.paused_at is null and v_today < a.max_per_day
     and extract(hour from loc) >= a.send_from_hour and extract(hour from loc) < a.send_to_hour then
    -- (أ) شحنات خرجت للتسليم (بعد فرز/خروج من الفرع) ورسالتها الأولى عمرها ما اتعملت — بقالها > 15 د
    select count(*) into v_stale from orders o
     where o.tenant_id = p_tenant and o.shipping_carrier = 'jt' and lower(coalesce(o.status, '')) = 'out for delivery'
       and o.carrier_status_code = '94' and o.carrier_status_at >= a.enabled_since
       and (case when o.carrier_status_at >= v_close_prev - interval '1 hour' and o.carrier_status_at < v_open then v_open
                 else o.carrier_status_at end) between now() - make_interval(mins => a.fresh_minutes) and now() - interval '15 minutes'
       and app.ship_rank_p10(o.phone) is not null
       and (a.mode = 'on' or app.wa_id_from_phone(o.phone) = any(a.pilot_wa_ids))
       and exists (select 1 from jt_events e where e.bill_code = o.tracking_no and e.order_id = o.id and e.tenant_id = o.tenant_id
                     and ((e.kind = 'pull' and e.payload->>'scanCode' in ('50', '92'))
                       -- 🔴 J&T بتبعت scanTypeCode **رقم** في الـpush (3,478 من 3,478 آخر 7 أيام) — الـ@> بنص كان مابيطابقش
                       --    غير اللي اتلقط بالـpull (17 من 51 يوم التشغيل). ->> بيقرا الرقم والنص زي بعض (نفس المرشّحين)
                       or (e.kind = 'trace' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
                                                          then e.payload->'details' else '[]'::jsonb end) d
                                                        where d->>'scanTypeCode' in ('50', '92')))))
       and not exists (select 1 from wa_ofd_sends x where x.order_id = o.id);
    -- (ب) retry مستحق بقاله > 10 د ومحدش لمسه · أو sending متعلّق > 15 د (الـtick/الـEF واقفين)
    select count(*) into v_overdue from wa_ofd_sends x where x.tenant_id = p_tenant and (
        (x.status in ('failed_transient', 'deferred') and x.next_try_at < now() - interval '10 minutes')
     or (x.status = 'sending' and x.claimed_at < now() - interval '15 minutes'));
  end if;
  -- (ج) J&T غيّرت شكل الـdesc؟ 94 ذهاب آخر 24 س من غير رقم مندوب مفهوم
  select count(distinct e.bill_code) into v_unparsed from jt_events e
   where e.tenant_id = p_tenant and e.received_at > now() - interval '24 hours' and e.digest_ok
     and ((e.kind = 'pull' and e.payload->>'scanCode' = '94' and coalesce(e.payload->>'desc', '') !~ 'courier [^(]*\(0[0-9]{10}\)')
       or (e.kind = 'trace' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e.payload->'details') = 'array'
             then e.payload->'details' else '[]'::jsonb end) d
             where d->>'scanTypeCode' = '94' and coalesce(d->>'isRefund', '') <> '1'
               and coalesce(d->>'desc', '') !~ 'courier [^(]*\(0[0-9]{10}\)')));
  select max(r.ran_at) into v_last_ok from wa_ofd_runs r where r.ok and p_tenant = any(r.tenant_ids);
  select r.error, r.ran_at into v_err, v_err_at from wa_ofd_runs r
   where not r.ok and (p_tenant = any(r.tenant_ids) or r.tenant_ids = '{}') order by r.ran_at desc limit 1;
  return jsonb_build_object('mode', a.mode, 'enabled_since', a.enabled_since,
    'paused', case when a.paused_at is not null then app.wa_ofd_mask(a.paused_reason) end,
    'paused_until', a.paused_until, 'sent_today', v_today, 'max_per_day', a.max_per_day, 'cap_hit', v_today >= a.max_per_day,
    'stale', v_stale, 'overdue', v_overdue, 'unparsed_24h', v_unparsed,
    'last_ok', v_last_ok, 'last_error', v_err, 'last_error_at', v_err_at);
exception when others then
  return jsonb_build_object('health_error', sqlstate);
end $fn$;
revoke all on function app.wa_ofd_health(uuid) from public, anon, authenticated;
