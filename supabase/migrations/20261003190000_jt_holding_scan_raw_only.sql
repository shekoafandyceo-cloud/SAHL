-- «Holding scan» (push من غير كود) و«120 Left Over Scan» (pull) = J&T حجزت الشحنة في فرع
-- («Detention Scaned») — مش استثناء. 3 أكتوبر: فرع السلام حجز 43 شحنة بعد ما خرجوا، فاتعلّموا
-- «Exception» كلهم في 12 دقيقة والمالك افتكرهم مشاكل. القياس: الـ247 مسح Holding من 22 سبتمبر
-- كلهم نفس النص «Detention Scaned»، والاستثناء الحقيقي («Fail to Receive» · «Customer refuse»)
-- بييجي كمسح 110 Abnormal — وده فاضل Exception.
--
-- الشكل: sahl_status = NULL في jt_status_map = «مسح معروف — خام بس». الخام والساعة بيتكتبوا
-- (فالمصالحة مابتعيدوش ومابيتعدّش unmapped)، والحالة ماتتغيّرش: بعد 110 بتفضل Exception،
-- وبعد Sending بتفضل «In transit between Hubs».

alter table public.jt_status_map alter column sahl_status drop not null;
comment on column public.jt_status_map.sahl_status is
  'حالة سهل. NULL = مسح معروف بيتسجّل خام بس (الحالة ماتتغيّرش) — مش زي «مش في الخريطة» (unmapped).';

update public.jt_status_map
   set sahl_status = null,
       note = 'خام بس (3 أكتوبر): «Detention Scaned» = محجوزة في فرع J&T مش استثناء. الاستثناء الحقيقي بييجي 110',
       updated_at = now()
 where scan_type_code in ('name:holding scan', '120');

create or replace function app.jt_apply_trace(p_bill_code text, p_scan_type text, p_scan_code text, p_scan_at timestamp with time zone, p_desc text, p_by text default 'J&T API'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app'
as $function$
declare v_row orders; v_target text; v_final boolean; v_key text;
begin
  select * into v_row from orders where tracking_no = p_bill_code and shipping_carrier = 'jt' order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  -- (2) order:* خام بس — ومايلمسش أي حاجة لو فيه مسح تتبع اتسجّل قبل كده
  if coalesce(p_scan_code,'') like 'order:%' then
    if v_row.carrier_status_at is null then
      update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code where id = v_row.id;
    end if;
    return jsonb_build_object('ok', true, 'note', 'order_event', 'order_id', v_row.id);
  end if;
  if v_row.carrier_status_at is not null and p_scan_at is not null and p_scan_at < v_row.carrier_status_at then
    return jsonb_build_object('ok', true, 'note', 'stale', 'order_id', v_row.id);
  end if;
  -- (1) رحلة المرتجع: الساعة بتتقدّم، والحالة بتبقى «Returned to business» لو لسه ماتبقتش
  if coalesce(p_scan_code,'') like 'refund:%' then
    update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
      carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
    if v_row.status in ('Returned to business', 'Delivered') or lower(v_row.status) in ('returned','returned to business2') then
      return jsonb_build_object('ok', true, 'note', 'refund_journey', 'order_id', v_row.id);
    end if;
    update orders set status = 'Returned to business', status_changed_at = now(),
      status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'from', status, 'to', 'Returned to business',
        'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'by', coalesce(nullif(btrim(p_by), ''), 'J&T API'),
        'reason', left('رحلة مرتجع (مسح 172 ماوصلش): ' || coalesce(p_desc,''), 120)))
     where id = v_row.id;
    return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id,
      'status', 'Returned to business', 'inferred', 'refund_journey');
  end if;
  v_key := coalesce(nullif(btrim(coalesce(p_scan_code,'')), ''), 'name:' || lower(btrim(coalesce(p_scan_type,''))));
  select sahl_status into v_target from jt_status_map where scan_type_code = v_key;
  -- (3) مش في الخريطة: ولا حرف بيتكتب — الساعة مابتتقدّمش فالمصالحة بتعيد المحاولة
  if not found then return jsonb_build_object('ok', true, 'note', 'unmapped', 'order_id', v_row.id, 'key', v_key); end if;
  update orders set carrier_status_raw = p_scan_type, carrier_status_code = p_scan_code,
    carrier_status_at = coalesce(p_scan_at, now()) where id = v_row.id;
  -- (4) في الخريطة بـNULL = خام بس (Holding / 120 — محجوزة في فرع): الحالة ماتتغيّرش
  if v_target is null then return jsonb_build_object('ok', true, 'note', 'raw_only', 'order_id', v_row.id, 'key', v_key); end if;
  if v_target = v_row.status then return jsonb_build_object('ok', true, 'note', 'same_status', 'order_id', v_row.id); end if;
  v_final := lower(v_row.status) in ('delivered','returned','returned to business','returned to business2','cancelled');
  if v_final and v_target not in ('Delivered','Returned to business') then
    return jsonb_build_object('ok', true, 'note', 'final_state_kept', 'order_id', v_row.id);
  end if;
  update orders set status = v_target, status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', v_target,
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', coalesce(nullif(btrim(p_by), ''), 'J&T API'), 'reason', nullif(left(coalesce(p_desc,''),120),'')))
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'note', 'status_set', 'order_id', v_row.id, 'status', v_target);
end $function$;

-- التصحيح: أوردرات حالتها دلوقتي Exception **وآخر سطر في سجلها** جه من مسح «Detention» →
-- ترجع للحالة اللي كانت عليها قبله (= اللي كانت القاعدة الجديدة هتسيبها). أي أوردر اتحرّك بعدها
-- بمسح تاني مابيتلمسش (آخر سطر مش Detention). والـ5 الاستثناء الحقيقي (110) مابيتلمسوش.
with x as (
  select o.id,
         (case when jsonb_typeof(o.status_log) = 'array' then o.status_log
               else (o.status_log #>> '{}')::jsonb end) -> -1 as last_e
    from orders o
   where o.shipping_carrier = 'jt' and o.status = 'Exception'
)
update orders o
   set status = x.last_e->>'from',
       status_changed_at = now(),
       status_log = coalesce(o.status_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         'from', 'Exception', 'to', x.last_e->>'from',
         'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'by', 'J&T API · تصحيح',
         'reason', 'Holding scan («Detention») = محجوزة في فرع J&T مش استثناء — رجوع للحالة قبلها'))
  from x
 where o.id = x.id
   and (x.last_e->>'reason') ilike '%Detention Scaned%'
   and x.last_e->>'to' = 'Exception'
   and coalesce(x.last_e->>'from', '') not in ('', 'Exception');
