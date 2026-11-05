-- v79 (16 أكتوبر): public.wa_resolve_action مقفولة على authenticated.
-- دالة DEFINER قديمة (مش في الريبو ولا بيناديها أي كود ولا دالة ولا cron — اتقاس) بترجّع
-- whatsapp_token + shipping_api_key + telegram_chat_id لأي حد معاه order id + آخر 10 أرقام
-- من تليفون العميل — بالظبط الأسرار اللي منح الأعمدة على tenants مخبّيها. والـorder id بيسافر
-- في payload أزرار الواتساب، وفورم التسجيل مفتوح = أي حد يقدر يبقى authenticated.
-- REVOKE مش DROP (درس 53 + 4 وركفلوهات n8n مش مقروءة ممكن تناديها بالـservice_role).
-- اتجرّب بترانزاكشن راجعة بانتحال موظف: النداء = 42501 · الـservice_role لسه عنده · ضابط: RPC عادي شغّال.
revoke execute on function public.wa_resolve_action(uuid, text, text) from authenticated;
