-- ai_agent_bot_reactivate — «الأوردر الملغي من أقل من يومين البوت يفعّله تاني» (17 نوفمبر — طلب المالك:
--   «الاوردر الملغي من اقل من يومين هو يفعله تاني يخليه مؤكد عادي عشان وارد يكون العميل داس الغاء بالغلط اصلاً»).
--
-- دالة واحدة: public.reactivate_bot_order — بيناديها wa-ai-draft (service_role) بعد ما _shared/ai-order.ts (planReactivate) يقرر.
-- 🔴 الثوابت (كلها بتتعاد هنا على السيرفر — الـEF مايتصدّقش):
--   • service_role بس + الزرار لازم ON (ai_settings.mode = 'auto').
--   • الأوردر بتاع نفس المتجر وحالته «cancelled» ومالوش بوليصة · ورقم واتساب المحادثة = رقم الأوردر (الأساسي أو الإضافي).
--   • **العميل هو اللي لغاه من زرار الواتساب** (آخر مدخل في سجل الحالة: to = cancelled و by فيه «واتساب») — اللي لغاه موظف ليه سبب
--     (تكرار · مبيستلمش · الرقم غلط…) فتفعيله بإيد موظف · والإلغاء من أقل من 48 ساعة.
--   • العميل مالوش أوردر تاني (آخر 60 يوم) مفتوح أو مرتجع/استثناء (نفس قاعدة create_bot_order) · والبوت مافعّلش الأوردر ده قبل كده (مرة واحدة).
--   • النتيجة «confirmed» بسطر سجل باسم «🤖 AI Agent» (فالتايم لاين والتلجرام زي أي تأكيد) — مفيش شحن هنا: الموظف هو اللي بيدوس شحن.
-- مفيش DROP ومفيش تعديل على أي جدول. إعادة التشغيل آمنة (create or replace).
-- اتجرّب بترانزاكشن راجعة على الحي قبل التطبيق (10 نتايج — CLAUDE.md قسم «AI Agent للشات» ← «تفعيل الأوردر الملغي») · اتطبّق 17 نوفمبر 12:50 UTC · الحي = الملف بالـmd5 (0198fa06…).

create or replace function public.reactivate_bot_order(p_tenant uuid, p_order_id uuid, p_wa_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
set lock_timeout to '3s'
as $function$
declare
  o record; v_wa text; v_local text; v_forms text[]; v_log jsonb; v_last jsonb; v_at timestamptz; v_prev record; v_status text;
begin
  if p_tenant is null or p_order_id is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  -- الزرار لازم ON
  if not exists (select 1 from ai_settings where tenant_id = p_tenant and mode = 'auto') then
    return jsonb_build_object('ok', false, 'error', 'bot_off');
  end if;

  select id, order_uid, status, phone, alt_phone, tracking_no, status_log, status_changed_at into o
    from orders where id = p_order_id and tenant_id = p_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if lower(coalesce(o.status, '')) <> 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'not_cancelled', 'order_uid', o.order_uid, 'status', o.status);
  end if;

  -- صاحب المحادثة هو صاحب الأوردر (نفس تطبيع تريجر المحادثات)
  v_wa := app.wa_id_from_phone(p_wa_id);
  if v_wa is null or not (coalesce(app.wa_id_from_phone(o.phone), '') = v_wa or coalesce(app.wa_id_from_phone(o.alt_phone), '') = v_wa) then
    return jsonb_build_object('ok', false, 'error', 'wrong_customer', 'order_uid', o.order_uid);
  end if;
  if btrim(coalesce(o.tracking_no, '')) <> '' then
    return jsonb_build_object('ok', false, 'error', 'has_tracking', 'order_uid', o.order_uid);
  end if;

  -- آخر مدخل في سجل الحالة. n8n بيكتب السجل string (JSON.stringify على عمود jsonb) وأول عنصر في المخلوط string — بنفكّ الاتنين.
  begin
    v_log := o.status_log;
    if jsonb_typeof(v_log) = 'string' then v_log := (v_log #>> '{}')::jsonb; end if;
    if jsonb_typeof(v_log) = 'array' and jsonb_array_length(v_log) > 0 then
      v_last := v_log -> (jsonb_array_length(v_log) - 1);
      if jsonb_typeof(v_last) = 'string' then
        v_last := (v_last #>> '{}')::jsonb;
        if jsonb_typeof(v_last) = 'array' and jsonb_array_length(v_last) > 0 then
          v_last := v_last -> (jsonb_array_length(v_last) - 1);
        else
          v_last := null;
        end if;
      end if;
    end if;
  exception when others then
    v_last := null;
  end;
  if v_last is null or jsonb_typeof(v_last) <> 'object' or lower(coalesce(v_last->>'to', '')) <> 'cancelled'
     or not (coalesce(v_last->>'by', '') ilike '%واتساب%' or coalesce(v_last->>'by', '') ilike '%whatsapp%') then
    return jsonb_build_object('ok', false, 'error', 'not_customer_cancel', 'order_uid', o.order_uid);
  end if;
  begin
    v_at := (v_last->>'at')::timestamptz;
  exception when others then
    v_at := null;
  end;
  v_at := coalesce(v_at, o.status_changed_at);
  if v_at is null or v_at < now() - interval '48 hours' or v_at > now() + interval '10 minutes' then
    return jsonb_build_object('ok', false, 'error', 'too_old', 'order_uid', o.order_uid);
  end if;
  -- مرة واحدة: البوت فعّله قبل كده والعميل لغاه تاني = موظف يراجع (العلامة في نص السجل — حتى لو n8n رجّع كتبه string)
  if position('طلب تفعيله تاني' in coalesce(o.status_log::text, '')) > 0 then
    return jsonb_build_object('ok', false, 'error', 'already_reactivated', 'order_uid', o.order_uid);
  end if;

  -- أوردرات العميل التانية (آخر 60 يوم): مرتجع/استثناء أو مفتوح = مايتفعّلش تلقائي (نفس قاعدة create_bot_order)
  v_local := '0' || substr(v_wa, 3);
  v_forms := array[v_local, v_wa, '+' || v_wa, substr(v_local, 2)];
  for v_prev in
    select order_uid, status from orders
     where tenant_id = p_tenant and id <> o.id and created_at > now() - interval '60 days'
       and (phone = any(v_forms) or alt_phone = any(v_forms))
     order by created_at desc limit 12
  loop
    if v_prev.status ~* '(returned|exception|failed)' then
      return jsonb_build_object('ok', false, 'error', 'has_returned_order', 'order_uid', v_prev.order_uid, 'status', v_prev.status);
    end if;
    if lower(v_prev.status) not in ('delivered', 'cancelled') then
      return jsonb_build_object('ok', false, 'error', 'has_open_order', 'order_uid', v_prev.order_uid, 'status', v_prev.status);
    end if;
  end loop;

  update orders set
    status            = 'confirmed',
    status_changed_at = now(),
    status_log        = coalesce(status_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'from', 'cancelled', 'to', 'confirmed',
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', '🤖 AI Agent', 'reason', 'العميل طلب تفعيله تاني في شات الواتساب (كان لغاه من زرار الواتساب)'))
  where id = o.id
  returning status into v_status;
  if v_status is distinct from 'confirmed' then raise exception 'bot_order_reactivate_failed'; end if;

  return jsonb_build_object('ok', true, 'order_id', o.id, 'order_uid', o.order_uid, 'status', v_status);
end;
$function$;

-- 🔴 service_role بس. Supabase بيمنح anon/authenticated صراحةً فالـREVOKE من PUBLIC لوحده مش كفاية (درس 41).
revoke all on function public.reactivate_bot_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reactivate_bot_order(uuid, uuid, text) to service_role;
