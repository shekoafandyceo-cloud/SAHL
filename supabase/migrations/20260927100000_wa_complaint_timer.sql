-- عدّاد الشكاوى (طلب المالك 27 سبتمبر): الشكوى مهلتها 14 يوم، وعايز
-- تنبيه بعد 10 أيام عشان العميل مايتنساش.
--
-- 🔴 `labels` مصفوفة من غير أي تاريخ — مفيش طريقة نعرف «الشكوى اتعلّمت
-- إمتى» غير إننا نسجّله لحظة الإضافة. فالتريجر هو الكاتب الوحيد:
--   * «شكوى» اتضافت        → complaint_at = now()
--   * «شكوى» اتشالت         → NULL (إعادة إضافتها = عدّاد جديد)
--   * أي تعديل تاني للتصنيفات → التاريخ زي ما هو (حتى «تم الحل» — الواجهة
--     هي اللي بتوقّف العدّاد لما تلاقي «تم الحل»، والتاريخ بيفضل للتاريخ)
--
-- 🔴 الأعمدة **مش ممنوحة للكتابة** لـauthenticated: الجدول منحته `rdm` على
-- مستوى الجدول والكتابة بالأعمدة (الـ15 الشرعيين) — فالعمود الجديد قراءة
-- بس، والموظف مايقدرش يرجّع تاريخ شكوى من الكونسول عشان التنبيه يسكت.
-- التريجر بيكتب عادي لأن فحص الصلاحيات على أعمدة الـSET مش على تعديلات
-- الـBEFORE trigger. (اتقاس بانتحال موظف: التزوير = insufficient_privilege،
-- وتعديل التصنيف العادي نجح.)
--
-- ⚠️ الشكاوى الموجودة قبل الـmigration مالهاش تاريخ حقيقي — اتعبّت بـ
-- `last_message_at` ومتعلّمة `complaint_at_estimated = true` (الواجهة بتقول
-- «تقريبي»). ده تقدير معلن مش حقيقة.

alter table public.wa_conversations
  add column complaint_at timestamptz,
  add column complaint_at_estimated boolean not null default false;

comment on column public.wa_conversations.complaint_at is
  'لحظة إضافة تصنيف «شكوى» — بيكتبه تريجر wa_complaint_clock بس. NULL = مفيش شكوى.';
comment on column public.wa_conversations.complaint_at_estimated is
  'true = التاريخ تقديري (شكاوى قبل 27 سبتمبر 2026 اتعبّت بآخر رسالة) مش لحظة التعليم الحقيقية.';

create or replace function app.wa_complaint_clock() returns trigger
language plpgsql set search_path = '' as $f$
declare had boolean; has boolean;
begin
  has := 'شكوى' = any(coalesce(new.labels, '{}'::text[]));
  had := tg_op = 'UPDATE' and 'شكوى' = any(coalesce(old.labels, '{}'::text[]));
  if has and not had then
    new.complaint_at := now(); new.complaint_at_estimated := false;
  elsif not has then
    new.complaint_at := null; new.complaint_at_estimated := false;
  elsif tg_op = 'UPDATE' then
    new.complaint_at := old.complaint_at; new.complaint_at_estimated := old.complaint_at_estimated;
  end if;
  return new;
end $f$;

-- `of labels`: الـingest بيحدّث المحادثة مع كل رسالة — التريجر مالوش لازمة هناك
create trigger wa_complaint_clock
  before insert or update of labels on public.wa_conversations
  for each row execute function app.wa_complaint_clock();

update public.wa_conversations
   set complaint_at = last_message_at, complaint_at_estimated = true
 where 'شكوى' = any(labels);
