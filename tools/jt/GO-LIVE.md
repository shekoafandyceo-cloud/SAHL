# تشغيل J&T على الإنتاج — خطوات التسليم والرجوع (20 سبتمبر 2026)

> كل اللي هنا اتبنى واتنشر. اللي **مش** بإيدي مكتوب صراحةً تحت «محتاج من المالك».
> مفيش سر في الملف ده ولا في الريبو.

## 1) اللي اتنشر فعلاً (Supabase — مشروع `gdphjfhelxaofugyiknb`)

| البند | الحالة |
|---|---|
| migration `jt_shipments` + `jt_public_rpc_wrappers` | ✅ مطبّقة (اتجرّبت بترانزاكشن راجعة الأول + ضابط انتحال موظف) |
| Edge Function `jt-ship` (v2) | ✅ منشورة — إنشاء الشحنة وتسجيل `tracking_no` + `jt_sorting_code` ذرياً. v2: `serviceType` اختياري + عنوان المرسل لازم يبقى في `jt_pca` |
| Edge Function `jt-status` (v1) | ✅ منشورة — استقبال الـ3 callbacks بتحقق التوقيع وتخزين الخام |
| Edge Function `jt-lookup` (v2) | ✅ منشورة — PCA sync · query · trace · subscribe · تشخيص |
| مفتاح الإنتاج `platform_settings.jt_production_enabled` | 🔒 `false` — بيتفتح لأول أوردر بس |
| حقول `addOrder` في `platform_settings.jt_addorder_fields` | ✅ متسجّلة (من Postman): `expressType=EZ` · `deliveryType=04` · `goodsType=ITN1` · `operateType=1` · `payType=PP_PM` — `serviceType` مش موجود في الطلب الناجح فبقى اختياري. اتأكد حيّ بنداء `config`: `addorder_fields_missing=[]` |
| المرسل على `tenants` (3ataba) | ✅ **كامل** من سكرين شوت «Sender Info» في بوابة J&T: `القاهرة` / `السلام` / `موقف بلبيس` + الاسم والتليفون والشارع. وصف يدوي مطابق في `jt_pca` (`raw.source=manual`) عشان حارس `sender_not_in_pca` يعدّي. ⚠️ الليبل الإنجليزي للمنطقة مقصوص في الصورة (`Al Zabat Buil…`) — الاسم العربي هو اللي بيتبعت للـAPI (زي أمثلة التوثيق). |
| `tenants.shipping_provider` | ✅ `jt` (اتحطت 20 سبتمبر ليلاً — v55 الحية مش بتقرأه، وفرع n8n مفصول، فمفيش أثر لحد ما v56 تترفع) |
| **أوردر التجربة** | **`17170`** (منى رياض · 695 ج · استاند امريكانا أبيض 5 أدوار). ⚠️ `city` من اللاندنج «القاهره» **بس العنوان 6 أكتوبر الحي السابع** = محافظة الجيزة عند J&T. محتاج أسماء J&T للمستلم من قوايم البوابة (بند 2ب) |

## 2) ✅ أسرار J&T اتسجّلت في Supabase Vault (20 سبتمبر ليلاً)

المالك بعت بيانات «User configuration» من بوابة J&T في الشات (سكرين شوت + الباسورد).
اتحطت في **Supabase Vault** (`vault.create_secret`) بالأسماء
`jt_api_account` · `jt_private_key` · `jt_customer_code` · `jt_password_processed`
(الـMD5 المعالج بس — مش النص الصريح)، والـEFs بتقراها عبر RPC `jt_secrets_v1`
(migration `jt_vault_rpc` — SECURITY DEFINER، **service_role بس**؛ اتقاس بانتحال
anon وauthenticated: الاتنين `insufficient_privilege`). secrets البيئة لو اتسجّلت
بعدين ليها الأولوية — الشكل تحت لسه شغّال بس **مش مطلوب** دلوقتي.

⚠️ الأسرار دي بقت في سجل الشات — لو حابب تغيّر `privateKey` من البوابة بعد أول
شحنة ناجحة، حدّثها في الـVault بـ`vault.update_secret` (مفيش نشر).
⚠️ الملف اتسمّى `jt_vault_rpc` مش `jt_secrets_*` لأن `.gitignore` فيه `*secret*`.

**اللي اتقاس على إنتاج J&T بالأسرار دي (20 سبتمبر):**

| النداء | الرد | المعنى |
|---|---|---|
| `logistics/trace` ببوليصة الـSandbox | `145003316 The billCode is illegal` | الهيدر (apiAccount+privateKey) **صح** |
| `order/getOrders` بتوقيع أعمال **غلط عمداً** | `145003031 Business parameter signature verification failed` | ضابط |
| `order/getOrders` بكود عميل غلط عمداً | `145003080 Customer not found` | ضابط |
| `order/getOrders` بتوقيعنا | عدّى التحقق (`999001030 waybillNos size…` = مفيش نتيجة للمرجع الوهمي) | **الباسورد الأولى (اسم الموقع) هي الصح** |
| `online/pca` · `online/cover` · `location/getLocation` · `spmComCost/getComCost` | `145003012 API account has no interface permissions` | 🔴 **مش مفعّلين على حساب الإنتاج** |
| callback موقّع بمفتاحنا على `jt-status/trace` | `code 1` + صف في `jt_events` بـ`digest_ok=true` | الاستقبال شغّال بالمفتاح الحقيقي |

✅ **سكرين شوت «Interface Mgt.» من المالك (20 سبتمبر ليلاً) بيقول المفعّل بالظبط:**
Delivery Time Inquiry · Logistics track query · **Create Order** · Query Order ·
Logistics track subscription · Waybill Model Query. يعني `addOrder` مفعّل، و`online/pca`
و`online/cover` و`getComCost` **مش** في القايمة — مطابق للقياس فوق.

✅ **`dry_run` على أوردر `17170` عدّى** (بمفتاح الإنتاج مفتوح لثواني وقفل تاني، والعنوان
المؤقت اترجّع فاضي): الحمولة اتبنت كاملة — المرسل بأسماء J&T · المستلم بالاسم والموبايل
المطبّع · `weight "3"` · `itemsValue "695"` · `remark` = المنتج + الخصائص · الحقول الخمسة ·
التوقيعين. **مفيش أي نداء راح لـJ&T** في الـ`dry_run`.

<details><summary>الشكل القديم (secrets البيئة عبر Codex) — اختياري</summary>

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

</details>

## 2ب) 🔴 محتاج من المالك — صلاحية `online/pca` على حساب الإنتاج (أو الأسماء بالإيد)

نطاق الخدمة (المحافظة/المدينة/المنطقة بأسماء J&T) هو اللي بيملى قوايم نافذة
الشحن وبيتأكد بيه عنوان المرسل. حساب الإنتاج **مالوش صلاحية** عليه. طريقين:

1. **الأفضل:** رسالة للـIT بتاع J&T (تحت) يفعّلوا `online/pca` (+ `online/cover`
   و`spmComCost/getComCost` لو أمكن) على `apiAccount` بتاع الإنتاج. بعدها أنا أعمل
   `pca_sync` وأطابق «القاهرة / مدينة السلام» من القايمة.
2. **بديل فوري لأول شحنة:** ابعتلي الأسماء **بالحرف زي ما J&T كاتباها** لـ:
   عنوان المرسل (القاهرة / مدينة السلام / المنطقة) وعنوان أوردر التجربة —
   من بلوك `sender`/`receiver` في طلب Postman الناجح أو من القوايم المنسدلة في
   بوابة J&T وقت إنشاء أوردر يدوي. هسجّلهم في `jt_pca` كصفوف يدوية (مش تخمين)
   والنافذة هتشتغل بيهم، وJ&T نفسها بترفض الاسم الغلط (`145003060–62`) من غير
   ما تعمل شحنة.

**رسالة للـIT (صلاحيات):**

> حساب J0086011282 (3ataba.com) — apiAccount بتاع الإنتاج بيرجّع
> `145003012 API account has no interface permissions` على:
> `online/pca` · `online/cover` · `location/getLocation` · `spmComCost/getComCost`.
> برجاء تفعيلهم، والتأكد إن `order/addOrder` و`order/cancelOrder` و`order/printOrder`
> مفعّلين على نفس الحساب.

## 3) محتاج من المالك — بيانات مش سرية (ابعتها في الشات)

1. ✅ ~~**القيم الستة** من طلب Create Order الناجح في Postman~~ — اتسجّلت (خمسة؛
   `serviceType` مش في الطلب الناجح فبقى اختياري في `jt-ship` v2 ومابيتبعتش لو فاضي).
2. ✅ ~~**عنوان المرسل**~~ — الاسم والتليفون والشارع اتسجّلوا. ⏳ **الفاضل**: المحافظة/المدينة/المنطقة
   **بأسماء J&T** — بتتحسم بعد `pca_sync` (**محجوب بصلاحية الحساب — بند 2ب**) أو
   بالأسماء بالإيد من Postman/البوابة. لو «مدينة السلام» طلعت أكتر من
   صف في `jt_pca` هرجع أسألك تختار، مش هخمّن.
3. **الوزن الافتراضي بالكيلو** لو الموظف مااختارش (مثلاً 1) — أو نسيبه إجباري في النافذة.
   (حالياً إجباري: مفيش `jt_default_weight_kg` فالنافذة لازم فيها وزن.)

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

1. ✅ الأسرار اتسجّلت (Vault) → `config` رجّع `creds_production=true` والباسورد اتأكدت بضابط.
2. ⏳ `pca_sync` → `jt_pca` يتملى (قوايم المحافظة/المدينة/المنطقة في نافذة الشحن) —
   **محجوب** بـ`145003012` لحد ما الـIT يفعّل `online/pca`، أو صفوف يدوية بأسماء من Postman/البوابة (بند 2ب).
3. ✅ الحقول اتسجّلت. الفاضل: مطابقة «القاهرة / مدينة السلام» على `jt_pca` بـSQL وتسجيل
   `sender_prov/city/area` (بند 3). ⚠️ `jt-ship` بترفض `sender_incomplete` لحد ما يتملوا،
   و`sender_not_in_pca` لو القيم مش من القايمة المتزامنة.
4. لو Sandbox متسجّل: إنشاء تجريبي على Sandbox من السيرفر بنفس الحمولة → نتأكد من `billCode`/`sortingCode`.
5. ⏳ رفع `app/` (v56) على Cloudflare — الزيب `sahl-app-v56.zip` اتسلّم 20 سبتمبر ليلاً (117 ملف — كله أو مفيش).
6. ✅ `tenants.shipping_provider = 'jt'` لعتبة · ⏳ `jt_production_enabled = 'true'` — بيتفتح **لحظة** الشحنة الأولى بس.
7. ✅ الأوردر اتحدد: **`17170`**. ⏳ الفاضل: أسماء J&T لعنوان المستلم (6 أكتوبر الحي السابع) → صف يدوي في `jt_pca` →
   من نافذة التفاصيل «🚚 شحن J&T» → البوليصة + كود الفرز → «اطبع البوليصة المعتمدة».
8. نتأكد بـ`query` (getOrders command:1) إن الأوردر موجود عند J&T **مرة واحدة**.
9. بعد موافقتك: خطوات n8n (بند 5) عشان تأكيد الواتساب يشحن أوتوماتيك.

**الرجوع في أي لحظة:** `jt_production_enabled = 'false'` (يمنع أي إنشاء جديد فوراً) +
`shipping_provider = 'bosta'` (يرجّع الزرار القديم) + فصل وصلة n8n.
