-- ⚠️ اتطبّقت على الإنتاج 7 أغسطس 2026 باسم migration `manual_ship_and_ship_request`.
-- الملف ده نسخة مرجعية — مفيش CI بيشغّله، موجود عشان الكود يبقى مقروء من الريبو.
--
-- اتجرّبت الأول بترانزاكشن راجعة مرتين:
--   1. انتحال «أدمن عتبة» — طلع هو السوبر أدمن نفسه، فـ«العبور» اللي شفناه
--      كان صلاحية مقصودة مش ثغرة (السياسات فيها is_super_admin() OR ...).
--   2. انتحال موظف حقيقي مش سوبر: صفر رؤية لأوردر تاجر تاني · العبور
--      مرفوض (order_not_found) · التعليم اليدوي بيسجّل الحالة والتتبع ·
--      bad_status على الملغي · الموظف شايف has_shipping_api والمفتاح نفسه
--      محجوب عنه.

-- 1) علامة «اتطلب شحن أوتوماتيك» — مش حالة. الحالة بتتغير بس لما n8n
--    يكتب BOSTA AUTO بعد رد شركة الشحن الحقيقي. العلامة للواجهة:
--    سبينر «بيتبعت...»، وتحذير «محاولة ماكملتش» لو عدّى وقت من غير tracking،
--    وسدّ الضغط المتكرر في الـEdge Function (cooldown 90 ثانية).
alter table orders add column if not exists shipping_requested_at timestamptz;

-- 2) الشحن اليدوي — للتاجر اللي بيعمل البوليصة بنفسه في موقع شركة الشحن.
--    SECURITY INVOKER عن قصد: نطاق المتجر وقفل النفاد بييجوا من الـRLS
--    نفسها (زي set_order_status بالظبط). الحراسات الإضافية جوّه الدالة:
--    مفيش تعليم على أوردر ليه بوليصة، ولا على حالة نهائية.
--    شكل سجل الحالة منسوخ حرفياً من set_order_status عشان القارئين
--    (تايم لاين التفاصيل) مايفرقوش بين المسارين.
create or replace function mark_shipped_manual(p_order_id uuid, p_tracking text default null, p_by text default null)
returns jsonb language plpgsql security invoker set search_path = public, app as $fn$
declare v_row orders; v_trk text := nullif(trim(coalesce(p_tracking,'')), '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_row from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if coalesce(v_row.tracking_no,'') <> '' then raise exception 'already_has_tracking'; end if;
  if lower(v_row.status) in ('delivered','cancelled','returned','returned to business','returned to business2') then
    raise exception 'bad_status';
  end if;
  update orders set
    status = 'bosta_assigned',
    tracking_no = coalesce(v_trk, tracking_no),
    status_changed_at = now(),
    status_log = coalesce(status_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', status, 'to', 'bosta_assigned',
      'at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', coalesce(nullif(trim(coalesce(p_by,'')),''), 'يدوي'), 'reason', null))
   where id = p_order_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'status', v_row.status, 'tracking_no', v_row.tracking_no);
end$fn$;
revoke all on function mark_shipped_manual(uuid,text,text) from public, anon;
grant execute on function mark_shipped_manual(uuid,text,text) to authenticated, service_role;

-- 3) عنوان ويبهوك الشحن — إعداد منصة مش ثابت في الكود.
--    المسار `ordercreate` مش سري **بقرار المالك** (7 أغسطس): محدش هيخمّنه
--    ومعاه لازم زوج UUIDs صحيح. مسجّل كقبول مخاطرة في CLAUDE.md.
insert into platform_settings(key, value) values ('ship_webhook_url','https://play.sheko.tech/webhook/ordercreate')
on conflict (key) do update set value = excluded.value;

-- 4) has_shipping_api — boolean مايكشفش المفتاح، عشان زرار الشحن يعرف
--    التاجر مربوط ولا لأ حتى للموظفين (المفتاح نفسه محجوب عنهم).
--    الفيو بنمط الحجب بالدور زي ما هو (مش invoker — تصميم قديم مقصود،
--    الفلترة جوّاه بـcurrent_tenant_id) — بس زوّدنا عمود في الآخر.
create or replace view v_my_tenant as
select id, slug, store_name, active, created_at, shipping_provider, whatsapp_phone_id,
  plan, plan_expires_at, subscription_status, grace_period_days, monthly_price,
  wallet_balance, overdraft_limit, billing_exempt, orders_used_cycle, cycle_started_at,
  cycle_ends_at, is_lifetime, whatsapp_confirmation_enabled, telegram_chat_id_set_at,
  support_phone, wa_template_name, trial_ends_at, billing_cycle, last_payment_at,
  lifetime_forfeited_at, payment_method,
  case when is_tenant_admin() then whatsapp_token else null::text end as whatsapp_token,
  case when is_tenant_admin() then shipping_api_key else null::text end as shipping_api_key,
  case when is_tenant_admin() then webhook_secret else null::text end as webhook_secret,
  case when is_tenant_admin() then telegram_chat_id else null::text end as telegram_chat_id,
  case when is_tenant_admin() then error_notify_chat else null::text end as error_notify_chat,
  case when is_tenant_admin() then telegram_group_id else null::text end as telegram_group_id,
  case when is_tenant_admin() then ops_chat_id else null::text end as ops_chat_id,
  case when is_tenant_admin() then whatsapp_app_secret else null::text end as whatsapp_app_secret,
  case when is_tenant_admin() then telegram_bot_token else null::text end as telegram_bot_token,
  case when is_tenant_admin() then notes else null::text end as notes,
  case when is_tenant_admin() then wa_webhook_secret else null::text end as wa_webhook_secret,
  (coalesce(shipping_api_key,'') <> '') as has_shipping_api
from tenants t where id = app.current_tenant_id();
