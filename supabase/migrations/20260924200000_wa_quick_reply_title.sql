-- الردود المحفوظة بقت زراير باسم مختصر («تيربو») بتبعت بضغطة، ومرتّبة من نافذة الإدارة
-- (طلب المالك 24 سبتمبر). الترتيب بيستخدم عمود sort الموجود من الأول (كان محدش بيكتبه).
-- الاسم اختياري في الداتابيز عشان الـ4 ردود الموجودة (مفيش تخمين لأسمائها) — والواجهة
-- بتطلبه لأي رد جديد أو متعدّل، وبتعرض أول كلام الرد لحد ما يتسمّى.
-- ⚠️ الصلاحيات على مستوى الجدول (authenticated=arwdm) فالعمود بياخدها تلقائي — زي باقي الجدول.
alter table public.wa_quick_replies
  add column if not exists title text
  constraint wa_qr_title_len check (title is null or char_length(btrim(title)) between 1 and 40);

comment on column public.wa_quick_replies.media is
  'صور الرد [{path,mime,name}] — ≤5. بتتبعت بالتسلسل والنص caption على آخر صورة (درس 46)؛ النص الأطول من 1024 رسالة مستقلة';
comment on column public.wa_quick_replies.title is
  'الاسم المختصر اللي بيظهر على زرار الرد (≤40 حرف)';
