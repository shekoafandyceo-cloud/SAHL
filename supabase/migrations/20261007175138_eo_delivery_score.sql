-- نسبة استلام العميل من EasyOrders (7 أكتوبر — طلب المالك)
--
-- EasyOrders بتبعت في الـwebhook `body.metadata` = object، وجواه مفتاح **اسمه رقم تليفون العميل نفسه**
-- (`"01011359182"`، وكمان مفتاح للرقم الإضافي لو موجود) فيه:
--   { delivery_rate_status, order_delivery_rate_id, rate_result }
-- اتقاس من شكل تنفيذات CentralORDERS (prepare_test_pin_data) + كود لوحة EasyOrders نفسها
-- (app.easy-orders.net — المكوّن اللي بيرسم «نسبة التسليم للعميل»):
--   • rate_result **تصنيف مش نسبة**: high (مرتفعة) · moderate (متوسطة) · low (منخفضة) ·
--     unknown («عميل جديد — لا توجد طلبات»). لوحتهم بترسم 5/3/1/0 من 5.
--   • delivery_rate_status ≠ 'completed' = لسه بيتحسب (لوحتهم بتعرض زرار Refresh بدل النتيجة).
--   • التقييم **لكل رقم لوحده** (phone و phone_alt كل واحد بمفتاحه).
--
-- الشكل:
--   orders.eo_metadata  = الـmetadata الخام زي ما وصل (بيشمل tracking: عدد الطلبات/الزيارات…)
--   orders.eo_rate      = تقييم الرقم الأساسي   ┐ high|moderate|low|unknown|pending
--   orders.eo_rate_alt  = تقييم الرقم الإضافي   ┘ أو قيمة جديدة من EasyOrders زي ما هي (≤30) · NULL = مفيش
-- n8n (خطوة يدوية للمالك — قاعدة أمان 1) بيكتب حقل واحد بس:
--   eo_metadata = {{ JSON.stringify($('Webhook').item.json.body.metadata ?? null) }}
-- الـstring بيوصل jsonb كـscalar نصّي (نفس فخ status_log) — والتريجر بيفكّه.
--
-- 🔴 التريجر على مسار إدخال الأوردر نفسه، و`Insert Order to Supabase` عليه continueErrorOutput
-- من غير توصيل = أي خطأ هنا **أوردر ضايع في صمت**. فكل حاجة جوّه exception block، وأسوأ
-- حالة: التقييم NULL والأوردر يدخل عادي. ومفيش CHECK على القيم لنفس السبب (قيمة جديدة من
-- EasyOrders مش هتوقع الإدخال).
-- 🔴 بيتحسب وقت الإدخال/تغيّر الـmetadata بس — مش لما الموظف يعدّل الرقم (المفتاح عند EasyOrders
-- هو الرقم الأصلي، وإعادة الحساب بالرقم الجديد كانت هتمسح التقييم).
-- تعديل eo_rate/eo_rate_alt مباشرة من غير الخام = القيم القديمة بترجع (التزوير من الكونسول مالوش أثر).
--
-- ⚠️ اتطبّق على الحي في 5 migrations صغيرة (eo_delivery_score_cols · eo_rate_of_fn · eo_rate_capture_fn ·
-- eo_rate_capture_trigger · eo_delivery_score_comments) — المحتوى = الملف ده بالحرف ما عدا نص التعليقات
-- على الأعمدة (إنجليزي على الحي). 🔴 السبب: أداة Supabase MCP **بتعلّق 60ث على أي DROP** (بتستنى تأكيد
-- يدوي مش بييجي) والطلب عمره ما بيوصل الداتابيز — مش قفل على orders. فمفيش DROP هنا (التريجر جديد).

set local lock_timeout = '4s';

alter table public.orders
  add column if not exists eo_metadata jsonb,
  add column if not exists eo_rate text,
  add column if not exists eo_rate_alt text;

comment on column public.orders.eo_metadata is 'EasyOrders body.metadata raw (key per phone: rate_result + tracking). Written by n8n.';
comment on column public.orders.eo_rate is 'EasyOrders delivery score for phone: high|moderate|low|unknown|pending. Computed by trg_eo_rate_capture.';
comment on column public.orders.eo_rate_alt is 'Same as eo_rate for alt_phone.';

-- تقييم رقم واحد من الـmetadata: المفتاح بالحرف الأول، وبعدين آخر 10 أرقام (+20 / مسافات).
-- زي لوحة EasyOrders بالحرف: أي حالة غير completed = pending (لسه بيتحسب) حتى لو فيه نتيجة قديمة.
create or replace function app.eo_rate_of(p_meta jsonb, p_phone text)
 returns text language plpgsql immutable set search_path to 'pg_catalog'
as $function$
declare v jsonb; k text; d text; st text; r text;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' or coalesce(btrim(p_phone), '') = '' then return null; end if;
  v := p_meta -> btrim(p_phone);
  if v is null then
    d := right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10);
    if length(d) = 10 then
      for k in select jsonb_object_keys(p_meta) loop
        if right(regexp_replace(k, '[^0-9]', '', 'g'), 10) = d then v := p_meta -> k; exit; end if;
      end loop;
    end if;
  end if;
  if v is null or jsonb_typeof(v) <> 'object' then return null; end if;
  st := lower(btrim(coalesce(v ->> 'delivery_rate_status', '')));
  r  := lower(btrim(coalesce(v ->> 'rate_result', '')));
  if st <> 'completed' then return 'pending'; end if;
  if r = '' then return null; end if;
  return left(r, 30);
end $function$;
revoke all on function app.eo_rate_of(jsonb, text) from public, anon, authenticated;

-- التريجر: (1) تعديل eo_rate/eo_rate_alt من غير ما الخام يتغيّر = القيم القديمة بترجع (تزوير من الكونسول).
-- (2) n8n بيبعت JSON.stringify(...) فبيوصل jsonb scalar نصّي — بيتفك (لحد مرتين).
-- (3) 🔴 أي خطأ = التقييم NULL والأوردر يدخل عادي (الخام بيفضل زي ما وصل للتشخيص). مستحيل نوقّع الإدخال.
create or replace function app.eo_rate_capture()
 returns trigger language plpgsql security definer set search_path to 'public', 'app', 'pg_temp'
as $function$
declare i int;
begin
  if tg_op = 'UPDATE' and new.eo_metadata is not distinct from old.eo_metadata then
    new.eo_rate := old.eo_rate; new.eo_rate_alt := old.eo_rate_alt; return new;
  end if;
  begin
    for i in 1..2 loop
      exit when new.eo_metadata is null or jsonb_typeof(new.eo_metadata) <> 'string';
      new.eo_metadata := nullif(btrim(new.eo_metadata #>> '{}'), '')::jsonb;
    end loop;
    if new.eo_metadata is not null and jsonb_typeof(new.eo_metadata) = 'null' then new.eo_metadata := null; end if;
    new.eo_rate := app.eo_rate_of(new.eo_metadata, new.phone);
    new.eo_rate_alt := app.eo_rate_of(new.eo_metadata, new.alt_phone);
  exception when others then
    new.eo_rate := null; new.eo_rate_alt := null;
  end;
  return new;
end $function$;
revoke all on function app.eo_rate_capture() from public, anon, authenticated;

set local lock_timeout = '4s';
create trigger trg_eo_rate_capture before insert or update of eo_metadata, eo_rate, eo_rate_alt on public.orders
  for each row execute function app.eo_rate_capture();
