# تشغيل J&T على الإنتاج — خطوات التسليم والرجوع (20 سبتمبر 2026)

> كل اللي هنا اتبنى واتنشر. اللي **مش** بإيدي مكتوب صراحةً تحت «محتاج من المالك».
> مفيش سر في الملف ده ولا في الريبو.

## 1) اللي اتنشر فعلاً (Supabase — مشروع `gdphjfhelxaofugyiknb`)

| البند | الحالة |
|---|---|
| migration `jt_shipments` + `jt_public_rpc_wrappers` | ✅ مطبّقة (اتجرّبت بترانزاكشن راجعة الأول + ضابط انتحال موظف) |
| Edge Function `jt-ship` (v1) | ✅ منشورة — إنشاء الشحنة وتسجيل `tracking_no` + `jt_sorting_code` ذرياً |
| Edge Function `jt-status` (v1) | ✅ منشورة — استقبال الـ3 callbacks بتحقق التوقيع وتخزين الخام |
| Edge Function `jt-lookup` (v1) | ✅ منشورة — PCA sync · query · trace · subscribe · تشخيص |
| مفتاح الإنتاج `platform_settings.jt_production_enabled` | 🔒 `false` — بيتفتح لأول أوردر بس |

## 2) محتاج من المالك — أسرار J&T في Supabase (يعملها Codex محلياً)

الأسرار **مش** بتتبعت في الشات. الشكل: ملف محلي بره الريبو ثم أمر واحد.

```bash
# ملف: ~/jt-secrets.env  (خارج أي ريبو — امسحه بعد الأمر)
JT_ENV=production
JT_API_ACCOUNT=<apiAccount بتاع الإنتاج>
JT_PRIVATE_KEY=<privateKey بتاع الإنتاج>
JT_CUSTOMER_CODE=J0086011282
JT_PASSWORD=<كلمة سر التكامل النص الصريح>        # أو بدلها: JT_PASSWORD_PROCESSED=<UPPER HEX MD5 اللي Postman بيحسبه>
# Sandbox (اختياري — بيخلّينا نجرّب الإنشاء على Sandbox من السيرفر قبل الإنتاج):
JT_SBX_API_ACCOUNT=<...>
JT_SBX_PRIVATE_KEY=<...>
JT_SBX_CUSTOMER_CODE=<...>
JT_SBX_PASSWORD=<...>
```

```bash
npx supabase login                     # مرة واحدة (بيفتح المتصفح)
npx supabase secrets set --project-ref gdphjfhelxaofugyiknb --env-file ~/jt-secrets.env
npx supabase secrets list --project-ref gdphjfhelxaofugyiknb      # لازم تشوف الأسماء (مش القيم)
rm ~/jt-secrets.env
```

بديل من غير CLI: Supabase Dashboard → Edge Functions → Secrets → Add بنفس الأسماء.

⚠️ كلمة السر: نفس اللي Postman بيستخدمها. لو Postman عنده الـMD5 المعالج
بس، حط `JT_PASSWORD_PROCESSED` بدل `JT_PASSWORD`. **متغيّرش الباسورد عند J&T.**

## 3) محتاج من المالك — بيانات مش سرية (ابعتها في الشات)

1. **القيم الستة** من طلب Create Order الناجح في Postman (Body → `bizContent`):
   `expressType` · `deliveryType` · `goodsType` · `operateType` · `payType` · `serviceType`.
   بتتسجّل في `platform_settings.jt_addorder_fields` (أنا بسجّلها).
2. **عنوان المرسل** (المخزن اللي المندوب بيستلم منه) بأسماء J&T:
   اسم المرسل · تليفون 11 رقم · المحافظة · المدينة · المنطقة · الشارع/العنوان التفصيلي.
   أسهل مصدر: بلوك `sender` من نفس طلب Postman الناجح.
3. **الوزن الافتراضي بالكيلو** لو الموظف مااختارش (مثلاً 1) — أو نسيبه إجباري في النافذة.

## 4) الـcallbacks — روابط الاستقبال (منشورة، مستنية التسجيل عند J&T)

| عند J&T | الرابط بتاعنا |
|---|---|
| `logistics/statusFeedback` (تتبع) | `https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-status/trace` |
| `orderserve/statusFeedback` (حالة الأوردر) | `https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-status/order` |
| `other/settlementReturn` (الفاتورة) | `https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-status/settlement` |

- الاستقبال بيتحقق من الهيدر `digest` بمفتاحنا الخاص (`Base64(MD5(bizContent + privateKey))`).
  نداء مش موقّع → `401` ومفيش كتابة. اتأكد حيّ بنداء بتوقيع غلط.
- ⚠️ **التسجيل عند J&T إجراء إداري** — مايتعملش قبل ما الأسرار تتسجّل (من غيرها كل
  callback هيترفض 401). رسالة الـIT جاهزة تحت.

**رسالة للـIT بتاع J&T (بعد تسجيل الأسرار):**

> السلام عليكم، حساب العميل J0086011282 (3ataba.com). برجاء تسجيل روابط الاستقبال التالية للـcallbacks:
> - Logistics status feedback: https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-status/trace
> - Order status feedback: https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-status/order
> - Settlement return: https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-status/settlement
>
> الاستقبال POST بنفس هيدرات apiAccount/digest/timestamp وحقل bizContent، والرد `{"code":"1","msg":"success"}`.
> وبرجاء تأكيد: (1) قائمة قيم scanTypeCode ومعناها، (2) هل الـtimestamp في scanTime بتوقيت القاهرة.

⚠️ التحقق إن التسجيل اشتغل = **وصول أول callback حقيقي** في جدول `jt_events` — مش رد الـIT.

## 5) خطوات n8n (يدوي — قاعدة أمان 1) — بعد نجاح أول أوردر وموافقتك

الوركفلو `Whatsapp_WEBHOOK` (`9XzDXtvG64WkVoO4`). **خد Duplicate الأول كنسخة احتياطية.**

1. من مخرج `Switch1` → `jt` ضيف نود **HTTP Request**:
   - Method `POST` · URL `https://gdphjfhelxaofugyiknb.supabase.co/functions/v1/jt-ship`
   - Authentication: Header Auth → `Authorization: Bearer <service_role key>` (من credential Supabase الموجودة — متكتبهاش نص صريح)
   - Headers: `apikey: <service_role key>` · `Content-Type: application/json`
   - Body JSON: `{"order_id": "{{ $('get_order_details').item.json.id }}"}`
   - Options → Timeout 40000 · Retry off (الـEF نفسها بتستعلم قبل إعادة الإرسال)
2. **مفيش نود بعدها بتكتب حالة** — `jt-ship` هي اللي بتكتب `BOSTA AUTO` + `tracking_no` بعد رد J&T.
3. لو الرد `address_unresolved` (422): الأوردر بيفضل `confirmed` وعليه `jt_ship_error`،
   والموظف بيشحنه من نافذة التفاصيل باختيار العنوان (والمرادف بيتحفظ للمرة الجاية).
4. Publish → واتأكد من `activeVersionId` (درس 1).
5. **الرجوع**: افصل الوصلة `Switch1.jt → HTTP Request` وPublish — نفس وضع النهاردة.

فرع بوسطة يفضل مفصول. `BOSTA_WEBHOOK` و`Mora2eb Bosta` ماتتلمسش (تتبع الشحنات القديمة).

## 6) الترتيب التشغيلي لأول أوردر

1. الأسرار اتسجّلت (بند 2) → أنا أشغّل `config` وأتأكد `creds_production=true`.
2. `pca_sync` → `jt_pca` يتملى (قوايم المحافظة/المدينة/المنطقة في نافذة الشحن).
3. تسجيل الحقول الستة + عنوان المرسل (بند 3).
4. لو Sandbox متسجّل: إنشاء تجريبي على Sandbox من السيرفر بنفس الحمولة → نتأكد من `billCode`/`sortingCode`.
5. رفع `app/` (v56) على Cloudflare — زي كل مرة (الفولدر كله).
6. `tenants.shipping_provider = 'jt'` لعتبة + `jt_production_enabled = 'true'`.
7. المالك يختار **أوردر واحد** → من نافذة التفاصيل «🚚 شحن J&T» → البوليصة + كود الفرز → «اطبع البوليصة المعتمدة».
8. نتأكد بـ`query` (getOrders command:1) إن الأوردر موجود عند J&T **مرة واحدة**.
9. بعد موافقتك: خطوات n8n (بند 5) عشان تأكيد الواتساب يشحن أوتوماتيك.

**الرجوع في أي لحظة:** `jt_production_enabled = 'false'` (يمنع أي إنشاء جديد فوراً) +
`shipping_provider = 'bosta'` (يرجّع الزرار القديم) + فصل وصلة n8n.
