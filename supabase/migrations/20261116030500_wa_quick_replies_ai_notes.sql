-- 16 نوفمبر 2026 — طلب المالك «كله في السيستم»: معلومات عن المنتج للـAI Agent بس
-- (مابتتبعتش للعميل مع الرد المحفوظ). بيقراها wa-ai-draft وبتتحط تحت نص الكارت في الـprompt.
-- الجدول منحته على مستوى الجدول فالعمود مايحتاجش GRANT — والكتابة بنفس سياسات الرد المحفوظ.
set local lock_timeout = '3s';
alter table public.wa_quick_replies add column if not exists ai_notes text;
alter table public.wa_quick_replies add constraint wa_qr_ai_notes_len
  check (ai_notes is null or char_length(ai_notes) <= 2000);
comment on column public.wa_quick_replies.ai_notes is
  'معلومات عن المنتج للـAI Agent بس — مابتتبعتش للعميل. بيقراها wa-ai-draft (v6).';
notify pgrst, 'reload schema';
