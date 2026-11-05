-- v80 (16 أكتوبر — قرار المالك «اعمل التعديل»): السيستم خاص بـ3ataba والمحاسبة اتلغت (19 سبتمبر)،
-- بس plan_expires_at كان 2027-09-02 → tenant_subscription_state كان هيقول 'expired' بعد 3 أيام سماح
-- والواجهة (showSubscriptionLock) كانت هتعمل signOut للكل ~5 سبتمبر 2027 (وبانر التجديد من ~26 أغسطس).
--
-- NULL + trial_ends_at NULL = computed_status 'active' و days_remaining NULL (الواجهة: expiry.js بترجع 'active'
-- والبانر بيرجع بدري). اتجرّب بترانزاكشن راجعة بانتحال موظف حقيقي: active · NULL · طابور الشبكة 0.
-- الـcron sahl-daily-billing بيتخطّى 3ataba (billing_exempt = true) فمش هيرجّع تاريخ.
-- ⚠️ record_subscription_payment / renew_subscription / switch_plan بيكتبوا plan_expires_at — متتنادوش
--    (يعني متسجّلش «دفعة» من لوحة الأدمن).
update tenants set plan_expires_at = null where slug = '3ataba' and plan_expires_at is not null;
