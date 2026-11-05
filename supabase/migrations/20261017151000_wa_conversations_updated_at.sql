-- 17 أكتوبر 2026 — v82 (تقليل الـEgress، موافقة المالك على «الخطوة 2»).
-- قايمة المحادثات كانت بتتجاب كاملة (200 محادثة `select *` ≈ 233 KB) كل 20 ثانية + مع **كل** رسالة واتساب جديدة في كل
-- تاب محادثات (حتى المخفية) — ~525 MB في يوم الشغل قبل الضغط (قياس 16–17 أكتوبر).
-- `updated_at` بيخلّي الواجهة تجيب **اللي اتغيّر بس** (رسالة جديدة · unread · تصنيف · ملاحظة من زميل) وبنفس سرعة اليوم.
--
-- 🔴 بيتكتب من التريجر بس (public.update_updated_at = now() — نفس تريجر orders) على **أي** UPDATE من أي حد
--    (wa-inbox-ingest · تريجر wa_after_message_insert · الواجهة · n8n لو حصل). المتصفح مالوش صلاحية كتابة عليه
--    (منح الكتابة على wa_conversations بالأعمدة — lock_ctwa_columns_from_browser) والتريجر بيكتبه برضه.
--    القراية: SELECT على الجدول (r) فبيبان للواجهة من غير منحة جديدة.
-- 🔴 القيمة الافتراضية now() على عمود جديد = «fast default» في PG17 (مفيش إعادة كتابة للجدول) — كل الصفوف القديمة
--    بتاخد وقت الـmigration، وده صح: الواجهة بتبدأ العلامة من أول جلب كامل.
-- الفهرس: الاستعلام التدريجي `tenant_id = X and updated_at > Y` — من غيره كل poll بيعدّي على كل المحادثات بالـRLS.
-- مفيش DROP (درس 53) · lock_timeout قصير عشان الجدول بيتكتب فيه مع كل رسالة.

set local lock_timeout = '5s';

alter table public.wa_conversations
  add column if not exists updated_at timestamptz not null default now();

comment on column public.wa_conversations.updated_at is
  'آخر تعديل على الصف (تريجر wa_conversations_updated_at) — الواجهة بتجيب اللي اتغيّر بس من غير القايمة كلها (v82).';

create index if not exists wa_conversations_tenant_updated_idx
  on public.wa_conversations (tenant_id, updated_at);

create or replace trigger wa_conversations_updated_at
  before update on public.wa_conversations
  for each row execute function public.update_updated_at();
