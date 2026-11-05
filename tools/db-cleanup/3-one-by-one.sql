-- ════════════════════════════════════════════════════════════════════════
-- سهل — تنضيف الداتابيز (23 أكتوبر 2026) — الجزء التالت: الحاجات اللي على جداول شغّالة
-- 🔴 كل سطر يتشغّل لوحده: حدّد السطر واضغط Run (أو Ctrl+Enter على السطر المحدد).
--    CONCURRENTLY مابيشتغلش جوّه ترانزاكشن — وهو اللي بيخلّي المسح مايوقّفش الأوردرات
--    ولا المحادثات ولا السكانر ولا ثانية. شغّله بعد ملف 2.
-- ════════════════════════════════════════════════════════════════════════

-- 1) نسخة طبق الأصل من idx_orders_tenant_created (اللي شايل 182 ألف استخدام)
drop index concurrently if exists public.idx_orders_created;

-- 2) عمود bosta_delivery_id عمره ما اتملا
drop index concurrently if exists public.idx_orders_bosta_delivery_id;

-- 3) نسخة من tenants_wa_webhook_secret_uniq (هو اللي هيشيل الشغل بعدها)
drop index concurrently if exists public.tenants_wa_webhook_secret_idx;

-- 4) order_id فاضي في كل صفوف stock_movements = مابيمنعش حاجة · stock_movements_order_product_type_uniq مكانه
drop index concurrently if exists public.stock_movements_order_product_out_uniq;

-- 5) صفر استخدام
drop index concurrently if exists public.idx_expenses_category;

-- 6) جدول فاضي (موضوعات التلجرام عايشة في جدول n8n) — ليه FK على tenants فبيقفلها
--    مللي ثواني بس لما يتشغّل لوحده. لو ظهر lock timeout شغّله تاني.
set lock_timeout = '3s'; drop table if exists public.wa_topics;

-- 7) التأكيد (المفروض: صفر صف)
select relname from pg_class where relname in ('idx_orders_created','idx_orders_bosta_delivery_id','tenants_wa_webhook_secret_idx',
  'stock_movements_order_product_out_uniq','idx_expenses_category','wa_topics');
