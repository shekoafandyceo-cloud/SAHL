-- ════════════════════════════════════════════════════════════════════════
-- سهل — تنضيف الداتابيز (23 أكتوبر 2026)
-- الملف بيفحص نفسه: فحص قبل ← التنضيف ← فحص بعد + تجربة إدخال أوردر بشكل n8n.
-- أي فحص يقع = كل حاجة بترجع ومفيش ولا حاجة بتتغيّر.
-- اتراجع بمراجعة عدائية (Workflow: 22 workflow في n8n + عدستين لكل مجموعة + ناقد).
-- ════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '3s';        -- مايستناش قفل أكتر من 3 ثواني (لو وقع بسبب القفل: شغّله تاني)
set local statement_timeout = '60s';

-- ── 0) فحص قبل: كل حاجة هتتمسح لسه هي نفسها اللي اتفحصت (md5 لتعريف كل دالة)
do $pre$
declare
  m text; bad text := ''; k text;
  want jsonb := '{
    "app.jt_issues_backfill()":"f526be43def733488050bffb1c07bd39",
    "app.wh_order_products(p_order uuid)":"d0ce7a6dad797059ccbd162ab9e55073",
    "app.wh_pile_lines(p_tenant uuid, p_at timestamp with time zone)":"4a8dc8830c2bf2ca8b2aff7707cca032",
    "public.current_user_role()":"2675236b2437db88c3a3fdba32b4f5ae",
    "public.eo_api_keys_v1()":"cdb57524b3a787eba3a7762d4b1201bf",
    "public.eo_rate_apply_v1(p_order_id uuid, p_meta jsonb, p_note text)":"45cad736a0903df235b53b500b7d3b0d",
    "public.eo_rate_candidates_v1(p_limit integer)":"4d8f210f96f23ce5fc722444f79c5912",
    "public.jt_issue_review(p_id bigint, p_reviewed boolean)":"b9d37aed03ab7d94a5f3893a80f179d2",
    "public.mark_awb_printed(p_order_ids uuid[], p_tenant_id uuid)":"a8ba39c33873d9b2ba74bdbfe598e409",
    "public.merchant_finance_summary(p_from date, p_to date)":"dcd97cb73c53c47de7baa27492f606ff",
    "public.request_topup(p_amount numeric, p_sender_phone text, p_screenshot_url text)":"a2649d269888e657e078a15998f1ef05",
    "public.switch_plan(p_plan_id text)":"f415d2b60268fd106055424f411ca918",
    "public.wa_ofd_test_finish(p_id bigint, p_kind text, p_code text, p_wamid text)":"839abedb1d22aa798d666fbecce6b98f",
    "public.wa_ofd_test_reserve(p_tenant uuid, p_wa_id text, p_order_uid text)":"50d8a022477d6ee10f63064da035bdb1",
    "public.wa_resolve_action(p_order_id uuid, p_customer_wa text, p_phone_number_id text)":"c3db316e2ace37d1b2aba7e00676b9c1",
    "public.wa_resolve_webhook(p_secret text, p_verify_token text)":"89de5bc98c6f173f428085e24fb724bb",
    "public.wh_stock_adjust(p_product_id uuid, p_new_qty integer, p_reason text)":"d809a530ab08ed8f05b434044ff64fb7"
  }';
begin
  for k in select jsonb_object_keys(want) loop
    m := null;
    select md5(pg_get_functiondef(p.oid)) into m
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = k;
    if m is null then bad := bad || ' [مش موجودة: ' || k || ']';
    elsif m <> want->>k then bad := bad || ' [اتغيّرت: ' || k || ']';
    end if;
  end loop;
  if (select active from cron.job where jobname = 'sahl-eo-rate-sync') is distinct from false then
    bad := bad || ' [sahl-eo-rate-sync مش متوقف]'; end if;
  if not exists (select 1 from cron.job where jobname = 'sahl-daily-billing') then
    bad := bad || ' [sahl-daily-billing مش موجود]'; end if;
  if (select count(*) from public.wa_topics) <> 0 then bad := bad || ' [wa_topics مش فاضي]'; end if;
  if (select (value::jsonb->>'expires_at')::timestamptz from public.platform_settings where key = 'wa_ofd_test') > now() then
    bad := bad || ' [إعداد wa_ofd_test لسه مانتهاش]'; end if;
  if (select md5((value::jsonb)->'template'->>'body') from public.platform_settings where key = 'wa_ofd_test')
     is distinct from 'b4686f21b87987ca524367299253880a' then
    bad := bad || ' [قالب v2 في wa_ofd_test مش هو اللي اتأكد]'; end if;
  if exists (select 1 from public.platform_settings where key = 'wa_ofd_tpl_backup_v2') then
    bad := bad || ' [wa_ofd_tpl_backup_v2 موجود قبل كده]'; end if;
  if bad <> '' then raise exception 'فحص قبل وقع:%', bad; end if;
  -- بصمة أسرار J&T قبل التعديل (الوصف بس اللي هيتغيّر — القيم لازم تفضل بالحرف)
  perform set_config('sahl.jt_vault_md5',
    (select md5(string_agg(name || '=' || decrypted_secret, '|' order by name)) from vault.decrypted_secrets where name like 'jt\_%'), true);
end
$pre$;

-- ── 1) EasyOrders (اتشالت من الواجهة في v81)
--     ⚠️ التريجر trg_eo_rate_capture ودواله app.eo_rate_* فاضلين عن قصد: هما اللي بيفكّوا
--     الـJSON.stringify اللي n8n بيبعته في eo_metadata (من غيرهم بيتخزّن نص متشفّر مرتين)
--     ومسحهم = قفل على orders مقابل صفر مكسب. الأعمدة الـ3 على orders فاضلة.
select cron.unschedule('sahl-eo-rate-sync');
drop function public.eo_rate_apply_v1(uuid, jsonb, text);
drop function public.eo_rate_candidates_v1(integer);
drop function public.eo_api_keys_v1();
drop table public.eo_rate_checks;
drop table public.eo_sync_runs;
delete from vault.secrets where name like 'eo_api_key:%';

-- ── 2) أداة تجربة رسالة المندوب (wa-ofd-test) — الإنتاج (wa-ofd-notify) مالوش دعوة بيها
--     قالب v2 المتأكد بيتنقل لمفتاح احتياطي بنفس شكل wa_ofd_tpl_backup_v1 قبل مسح الإعداد
insert into public.platform_settings (key, value, description)
select 'wa_ofd_tpl_backup_v2',
       jsonb_build_object('template_name', t->>'name', 'body', t->>'body',
                          'param_count', (t->>'param_count')::int, 'lang', t->>'lang')::text,
       'نسخة احتياطية من قالب رسالة المندوب v2 (اتنقلت من wa_ofd_test قبل مسحه — 23 أكتوبر)'
  from (select (value::jsonb)->'template' t from public.platform_settings where key = 'wa_ofd_test') x;
drop function public.wa_ofd_test_reserve(uuid, text, text);
drop function public.wa_ofd_test_finish(bigint, text, text, text);
drop table public.wa_ofd_test_sends;
delete from public.platform_settings where key = 'wa_ofd_test';

-- ── 3) دوال ميتة (صفر نداء في pg_stat_statements، أو مستخدمها اتمسح، أو نسخة قديمة اتقفلت)
drop function app.jt_issues_backfill();
drop function app.wh_order_products(uuid);
drop function app.wh_pile_lines(uuid, timestamptz);
drop function public.current_user_role();
drop function public.merchant_finance_summary(date, date);
drop function public.wa_resolve_webhook(text, text);
drop function public.wa_resolve_action(uuid, text, text);
drop function public.mark_awb_printed(uuid[], uuid);
drop function public.request_topup(numeric, text, text);
drop function public.switch_plan(text);
drop function public.jt_issue_review(bigint, boolean);
drop function public.wh_stock_adjust(uuid, integer, text);

-- ── 4) فيوهات ميتة + جدول فاضي
drop view public.daily_summary;                 -- ai.daily_summary (البوت) فاضل
drop view public.platform_stats;
drop view public.orders_needing_shipping_fee;   -- كان لـn8n «Bosta - Capture Real Shipping Fee» (متوقف من يوليو)
drop view ai.platform_settings;                 -- 🔴 كان بيكشف كل الأسرار لـSQL اللي البوت بيكتبه (مش في الـprompt)
drop table public.wa_topics;

-- ── 5) indexes ميتة على جداول هادية (جوّه الترانزاكشن)
drop index public.stock_movements_order_product_out_uniq;   -- order_id فاضي في كل الصفوف = مابيمنعش حاجة · _type_uniq مكانه
drop index public.idx_expenses_category;                    -- صفر استخدام

-- ── 6) إعداد ميت (قارئه الوحيد كان order-ship اللي اتمسحت 17 أكتوبر)
delete from public.platform_settings where key = 'ship_webhook_url';

-- ── 7) الـcron بتاع المحاسبة الليلية (اتلغت 19 سبتمبر) — بيرجع بسطر واحد لو احتجناه
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'sahl-daily-billing'), active := false);

-- ── 8) جدول في الريل-تايم ومحدش بيسمعه
alter publication supabase_realtime drop table public.expenses;

-- ── 9) 🔴 وصف سرّ الـSandbox في الـVault كان فيه كلمة السر بالنص الصريح (الوصف مش متشفّر)
select vault.update_secret(id, new_description => 'J&T Sandbox — password processed (الوصف اتنضّف 23 أكتوبر)')
  from vault.secrets where name = 'jt_sbx_password_processed';

-- ── 10) فحص بعد
do $post$
declare
  bad text := ''; n int; nm text; v_id uuid;
  gone text[] := array['eo_rate_apply_v1','eo_rate_candidates_v1','eo_api_keys_v1','eo_rate_checks','eo_sync_runs',
    'wa_ofd_test_reserve','wa_ofd_test_finish','wa_ofd_test_sends','jt_issues_backfill',
    'current_user_role','merchant_finance_summary','wa_resolve_webhook','wa_resolve_action','mark_awb_printed',
    'request_topup','switch_plan','platform_stats','orders_needing_shipping_fee','wa_topics'];
begin
  -- (أ) مفيش ولا دالة ولا فيو ولا سياسة ولا cron بيشاور على حاجة اتمسحت
  foreach nm in array gone loop
    select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname in ('public','app','ai','merchant_ai') and p.prosrc ~ ('\m' || nm || '\M');
    if n > 0 then bad := bad || ' [دالة لسه بتشاور على ' || nm || ']'; end if;
    select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where c.relkind in ('v','m') and s.nspname in ('public','ai') and pg_get_viewdef(c.oid) ~ ('\m' || nm || '\M');
    if n > 0 then bad := bad || ' [فيو لسه بيشاور على ' || nm || ']'; end if;
    select count(*) into n from pg_policies where coalesce(qual,'') || coalesce(with_check,'') ~ ('\m' || nm || '\M');
    if n > 0 then bad := bad || ' [سياسة لسه بتشاور على ' || nm || ']'; end if;
    select count(*) into n from cron.job where command ~ ('\m' || nm || '\M');
    if n > 0 then bad := bad || ' [cron لسه بيشاور على ' || nm || ']'; end if;
  end loop;
  if to_regprocedure('public.jt_issue_review(bigint, boolean)') is not null then bad := bad || ' [jt_issue_review القديمة لسه موجودة]'; end if;
  if to_regprocedure('public.wh_stock_adjust(uuid, integer, text)') is not null then bad := bad || ' [wh_stock_adjust القديمة لسه موجودة]'; end if;

  -- (ب) اللي لازم يفضل موجود وشغّال
  if to_regprocedure('public.jt_issue_review(bigint, text, text, integer)') is null then bad := bad || ' [jt_issue_review الجديدة راحت]'; end if;
  if to_regprocedure('public.wh_stock_adjust(uuid, integer, text, integer)') is null then bad := bad || ' [wh_stock_adjust الجديدة راحت]'; end if;
  if not exists (select 1 from pg_proc where proname = 'wa_should_send') then bad := bad || ' [wa_should_send راحت]'; end if;
  if not exists (select 1 from pg_proc where proname = 'get_platform_config') then bad := bad || ' [get_platform_config راحت]'; end if;
  if not exists (select 1 from pg_proc where proname = 'jt_sync_health') then bad := bad || ' [jt_sync_health راحت]'; end if;
  if not exists (select 1 from pg_proc where proname = 'wa_ofd_candidates_v1') then bad := bad || ' [wa_ofd_candidates_v1 راحت]'; end if;
  if not exists (select 1 from pg_proc where proname = 'eo_rate_capture') then bad := bad || ' [eo_rate_capture راحت]'; end if;
  if to_regclass('public.v_orders_live') is null then bad := bad || ' [v_orders_live راح]'; end if;
  if to_regclass('public.products') is null or to_regclass('ai.products') is null then bad := bad || ' [products/ai.products راحوا]'; end if;
  if to_regclass('ai.daily_summary') is null then bad := bad || ' [ai.daily_summary راح]'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'ai' and c.relkind = 'v';
  if n <> 13 then bad := bad || ' [فيوهات ai بقت ' || n || ' مش 13]'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'merchant_ai';
  if n <> 3 then bad := bad || ' [دوال merchant_ai بقت ' || n || ' مش 3]'; end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'eo_metadata' and attnum > 0) then
    bad := bad || ' [orders.eo_metadata راح — n8n هيقع]'; end if;
  if (select tgenabled from pg_trigger where tgname = 'trg_eo_rate_capture') is distinct from 'O' then bad := bad || ' [تريجر eo_rate_capture اتأثر]'; end if;
  select count(*) into n from cron.job where active and jobname in
    ('sahl-wa-ofd-notify','sahl-ship-rank-sync','sahl-jt-fee-sync','sahl-jt-trace-sync','sahl-cron-history-purge');
  if n <> 5 then bad := bad || ' [cron أساسي اتوقف أو اتمسح: ' || n || ' من 5]'; end if;
  if exists (select 1 from cron.job where jobname = 'sahl-eo-rate-sync') then bad := bad || ' [sahl-eo-rate-sync لسه موجود]'; end if;
  if (select active from cron.job where jobname = 'sahl-daily-billing') is distinct from false then bad := bad || ' [sahl-daily-billing مااتوقفش]'; end if;
  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime'
   and tablename in ('orders','jt_issues','stock_movements','stock_products','tenants','wa_messages');
  if n <> 6 then bad := bad || ' [جداول الريل-تايم اللي الواجهة بتسمعها بقت ' || n || ' مش 6]'; end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'expenses') then
    bad := bad || ' [expenses لسه في الريل-تايم]'; end if;
  if exists (select 1 from vault.secrets where name like 'eo_api_key:%') then bad := bad || ' [مفتاح EasyOrders لسه في الـVault]'; end if;
  if exists (select 1 from vault.secrets s join vault.decrypted_secrets d on d.id = s.id, regexp_split_to_table(coalesce(s.description,''), '[\s:،,()«»"]+') tok
              where s.name = 'jt_sbx_password_processed' and length(tok) >= 4
                and upper(md5(tok || 'jadada236t2')) = upper(d.decrypted_secret)) then
    bad := bad || ' [كلمة السر لسه في وصف الـVault]'; end if;
  if (select count(*) from vault.secrets where name like 'jt\_%') <> 8 then bad := bad || ' [أسرار J&T اتأثرت]'; end if;
  if (select md5(string_agg(name || '=' || decrypted_secret, '|' order by name)) from vault.decrypted_secrets where name like 'jt\_%')
     is distinct from current_setting('sahl.jt_vault_md5', true) then bad := bad || ' [قيمة سرّ J&T اتغيّرت]'; end if;
  if (select md5((value::jsonb)->>'body') from public.platform_settings where key = 'wa_ofd_tpl_backup_v2')
     is distinct from 'b4686f21b87987ca524367299253880a' then bad := bad || ' [wa_ofd_tpl_backup_v2 مش مطابق]'; end if;
  if (select md5(body) from public.wa_auto_templates where event = 'out_for_delivery')
     is distinct from 'b4686f21b87987ca524367299253880a' then bad := bad || ' [قالب الإنتاج اتغيّر!]'; end if;
  if not exists (select 1 from public.platform_settings where key = 'wa_ofd_tpl_backup_v1') then bad := bad || ' [wa_ofd_tpl_backup_v1 راح]'; end if;
  if bad <> '' then raise exception 'فحص بعد وقع:%', bad; end if;

  -- (ج) إدخال أوردر بنفس شكل n8n (eo_metadata نص زي JSON.stringify) + تأكيده — جوّه بلوك بيترجع دايماً
  begin
    insert into public.orders (tenant_id, order_uid, customer_name, phone, address, city, product_name, total_cost, status, platform, eo_metadata)
    values ('9c58b214-f11d-4de5-afc7-a0de0b903f36', 'ZZ-CLEANUP-PROBE', 'probe', '01000000000',
            'شارع التجربة عنوان طويل كفاية', 'القاهرة', 'probe (عدد 1)', 100, 'pending', 'fb',
            to_jsonb('{"tracking":{"orders_count":0}}'::text))
    returning id into v_id;
    if (select jsonb_typeof(eo_metadata) from public.orders where id = v_id) <> 'object' then
      raise exception 'eo_metadata ماتفكّش لـobject (التريجر مش شغّال)'; end if;
    update public.orders set eo_metadata = to_jsonb('{"x":1}'::text) where id = v_id;
    raise exception using errcode = 'SH001', message = 'probe_ok';
  exception when sqlstate 'SH001' then null;     -- الإدخال نجح والبلوك رجع
  end;
  if exists (select 1 from public.orders where order_uid = 'ZZ-CLEANUP-PROBE') then
    raise exception 'أوردر التجربة فضل موجود'; end if;
end
$post$;

-- ── 11) الجداول الساخنة في الآخر عن قصد: القفل بيتاخد هنا وبيتساب مع آخر سطر على طول
--     تريجر المحاسبة (اتلغت 19 سبتمبر) كان بيكتب سطر wallet_transactions + تحديثين على tenants
--     مع كل أوردر بيتأكد (كل تحديث = حدث ريل-تايم لكل تاب + قراية wallet_state).
--     قفل النفاد في الـRLS مالوش دعوة بيه. الرجوع: alter table public.orders enable trigger trg_charge_order_on_status_change;
alter table public.orders disable trigger trg_charge_order_on_status_change;
drop index public.tenants_wa_webhook_secret_idx;   -- نسخة من tenants_wa_webhook_secret_uniq (هو اللي هيشيل الشغل بعدها)

do $final$
declare n int;
begin
  if (select tgenabled from pg_trigger where tgname = 'trg_charge_order_on_status_change') is distinct from 'D' then
    raise exception 'تريجر المحاسبة مااتقفلش'; end if;
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'orders' and not t.tgisinternal and t.tgenabled = 'O';
  if n <> 10 then raise exception 'تريجرات orders الشغّالة بقت % مش 10', n; end if;
  if to_regclass('public.tenants_wa_webhook_secret_uniq') is null then
    raise exception 'الـunique index بتاع tenants راح'; end if;
end
$final$;

commit;

-- ── النتيجة
select pg_size_pretty(pg_database_size(current_database())) as "حجم الداتابيز",
       (select count(*) from cron.job where active) as "cron شغّال",
       (select count(*) from vault.secrets) as "أسرار الـVault";
