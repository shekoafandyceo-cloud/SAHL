-- 4 نوفمبر: صور الردود المحفوظة بتترفع لميتا **مرة** وبتتبعت بالـ`media id` بدل اللينك.
--
-- 🔴 السبب (`Egress` — الـgrace period بيخلص 8 نوفمبر): `wa-send` كان بيبعت كل صورة بلينك موقّع
-- جديد، فميتا بتنزّل الصورة من الـStorage **مع كل إرسال**. الردود المحفوظة بتتبعت 85–156 صورة في
-- اليوم (اتقاس 30 أكتوبر → 4 نوفمبر) = ميتا لوحدها نزّلت 177 MB يوم 3 نوفمبر.
-- الـ`media id` بتاع ميتا بيعيش 30 يوم ويتبعت لأي عميل من نفس الرقم — فالصورة بتنزل من عندنا
-- مرة كل 25 يوم بدل كل إرسال.
--
-- · صف لكل (متجر · رقم الواتساب · مسار الصورة). المسار ثابت: صورة اتغيّرت = مسار جديد (الرفع
--   بيعمل اسم جديد دايماً) فمفيش كاش قديم لصورة اتبدّلت.
-- · مفيش FK على tenants عن قصد — إنشاء FK بياخد قفل على tenants (درس 59) ومكسبه صفر.
-- · service بس (wa-send) — RLS شغّال ومفيش ولا سياسة · مفيش أي صلاحية لـanon/authenticated.
-- · بيتكتب لصور `<tenant>/quick-replies/…` بس — مرفق الشات بيتبعت مرة واحدة فالرفع لميتا مالوش لازمة.

create table if not exists public.wa_media_ids (
  tenant_id   uuid        not null,
  phone_id    text        not null,
  path        text        not null,
  media_id    text        not null,
  uploaded_at timestamptz not null default now(),
  primary key (tenant_id, phone_id, path)
);

alter table public.wa_media_ids enable row level security;
revoke all on table public.wa_media_ids from anon, authenticated;
grant select, insert, update, delete on table public.wa_media_ids to service_role;

comment on table public.wa_media_ids is
  'media id بتاع ميتا لصور الردود المحفوظة (بيعيش 30 يوم — بنستخدمه 25). wa-send بس — صورة تتنزل من الـStorage مرة مش مع كل إرسال (Egress).';
