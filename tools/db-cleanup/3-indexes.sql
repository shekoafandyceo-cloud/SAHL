-- ════════════════════════════════════════════════════════════════════════
-- سهل — تنضيف الداتابيز (23 أكتوبر 2026) — الجزء التالت: 2 index على orders
-- 🔴 كل سطر يتشغّل لوحده (حدّده واضغط Run) — CONCURRENTLY مابيشتغلش جوّه ترانزاكشن،
--    وهو اللي بيخلّي المسح مايقفلش جدول الأوردرات ولا ثانية.
-- ════════════════════════════════════════════════════════════════════════

-- 1) نسخة طبق الأصل من idx_orders_tenant_created (اللي شايل 182 ألف استخدام)
drop index concurrently if exists public.idx_orders_created;

-- 2) عمود bosta_delivery_id عمره ما اتملا
drop index concurrently if exists public.idx_orders_bosta_delivery_id;
