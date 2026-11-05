-- 23 أكتوبر (التنضيف): المحاسبة اتلغت 19 سبتمبر — التريجر كان بيكتب سطر wallet_transactions
-- + تحديثين على tenants مع كل أوردر بيتأكد (حدث ريل-تايم لكل تاب + قراية wallet_state).
-- قفل النفاد في الـRLS (app.wallet_depleted) مالوش دعوة. الرجوع بسطر:
--   alter table public.orders enable trigger trg_charge_order_on_status_change;
-- ✅ اتطبّق على الحي 23 أكتوبر 09:25 UTC (اتجرّب بترانزاكشن راجعة الأول: charge=D · الباقي 10 شغّالين)
set local lock_timeout = '3s';
alter table public.orders disable trigger trg_charge_order_on_status_change;
