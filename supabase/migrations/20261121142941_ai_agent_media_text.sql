-- 21 نوفمبر (طلب المالك — البند 2 من 5: «فهم ال Voice Notes و الصور الي العملاء بيبعتوها»)
-- wa_messages.ai_media_text = اللي الـAI Agent فهمه من رسالة صوتية/صورة واردة (كلام الفويس بالحرف · وصف الصورة + المكتوب فيها).
-- بيكتبه wa-ai-draft (service_role) مرة واحدة لما العمود فاضي — والمسودات اللي بعدها بتقراه من غير نداء تاني لـGemini.
-- 🔴 المتصفح بيقراه ومايكتبوش: الجدول منحته INSERT/UPDATE بالأعمدة (authenticated=rdm) فالعمود الجديد مالوش منحة كتابة (اتقاس بترانزاكشن راجعة).
-- 🔴 مفيش تريجر بيتأثر: تريجرات wa_messages كلها AFTER INSERT — الـUPDATE على العمود ده مابيعملش مسودة ولا بيشيل «تصعيد».
-- الرجوع: wa-ai-draft v12 مابيقراش العمود (العمود فاضي ومالوش أثر) — مفيش داعي لمسحه.
-- اتطبّق 21 نوفمبر 14:29 UTC (بعد ترانزاكشن راجعة: authenticated مايكتبش العمود · service_role بيكتب · 2001 حرف = check_violation · الشبكة 0).
set lock_timeout = '3s';
alter table public.wa_messages add column if not exists ai_media_text text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wa_msg_ai_media_text_len' and conrelid = 'public.wa_messages'::regclass) then
    alter table public.wa_messages add constraint wa_msg_ai_media_text_len
      check (ai_media_text is null or char_length(ai_media_text) <= 2000) not valid;
  end if;
end $$;
comment on column public.wa_messages.ai_media_text is
  'اللي الـAI Agent فهمه من رسالة صوتية/صورة واردة — wa-ai-draft بيكتبه مرة (service_role). "(مش مفهومة)" = مافيهاش كلام/صورة واضحة.';
notify pgrst, 'reload schema';
