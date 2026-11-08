-- orders.jt_subscribe_error — فشل الاشتراك في تحديثات التتبع (trace/subscribe).
--
-- 🔴 الاشتراك بيحصل **بعد** ما البوليصة تتسجّل عن قصد: الشحنة اتعملت وفلوسها راحت،
--    فمينفعش فشل الاشتراك يرجّع خطأ ويخلي الموظف يضغط تاني. العمود ده بيخلّي الفشل
--    **باين** بدل ما يتبلع في صمت — أوردر عليه قيمة هنا يعني J&T مش هتبعت أي
--    callback ليه، والحل إعادة الاشتراك من jt-lookup action=subscribe.
-- NULL = اتسجّل تمام (أو أوردر قديم قبل jt-ship v5).

alter table public.orders add column if not exists jt_subscribe_error text;

comment on column public.orders.jt_subscribe_error is
  'فشل trace/subscribe بعد إنشاء الشحنة — NULL = تمام. قيمة = مفيش callbacks للبوليصة دي.';

-- الـ5 شحنات الأولى اتسجّلوا يدوياً بنجاح (isSuccess:true للخمسة) — بنعلّمهم NULL صراحةً.
update public.orders set jt_subscribe_error = null where shipping_carrier = 'jt';
