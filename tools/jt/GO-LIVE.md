# تشغيل J&T على الإنتاج — خطوات التسليم والرجوع (20 سبتمبر 2026)

> كل اللي هنا اتبنى واتنشر. اللي **مش** بإيدي مكتوب صراحةً تحت «محتاج من المالك».
> مفيش سر في الملف ده ولا في الريبو.

## 1) اللي اتنشر فعلاً (Supabase — مشروع `gdphjfhelxaofugyiknb`)

| البند | الحالة |
|---|---|
| migration `jt_shipments` + `jt_public_rpc_wrappers` | ✅ مطبّقة (اتجرّبت بترانزاكشن راجعة الأول + ضابط انتحال موظف) |
| Edge Function `jt-ship` (v4) | ✅ منشورة — إنشاء الشحنة وتسجيل `tracking_no` + `jt_sorting_code` ذرياً. v2: `serviceType` اختياري + عنوان المرسل لازم يبقى في `jt_pca` · v3: الأسرار من الـVault · **v4 (21 سبتمبر): المنطقة نص حر ≤ 60 حرف، وفحص `jt_pca` على المحافظة/المدينة بس** (بند 2ب) |
| Edge Function `jt-status` (v1) | ✅ منشورة — استقبال الـ3 callbacks بتحقق التوقيع وتخزين الخام |
| Edge Function `jt-lookup` (v2) | ✅ منشورة — PCA sync · query · trace · subscribe · تشخيص |
| مفتاح الإنتاج `platform_settings.jt_production_enabled` | 🔒 `false` — بيتفتح لأول أوردر بس |
| حقول `addOrder` في `platform_settings.jt_addorder_fields` | ✅ متسجّلة (من Postman): `expressType=EZ` · `deliveryType=04` · `goodsType=ITN1` · `operateType=1` · `payType=PP_PM` — `serviceType` مش موجود في الطلب الناجح فبقى اختياري. اتأكد حيّ بنداء `config`: `addorder_fields_missing=[]` |
| المرسل على `tenants` (3ataba) | ✅ **كامل** من سكرين شوت «Sender Info» في بوابة J&T: `القاهرة` / `السلام` / `موقف بلبيس` + الاسم والتليفون والشارع. (الصف اليدوي في `jt_pca` اتشال 21 سبتمبر — المدينة بقت في قايمة القالب والمنطقة نص حر.) ⚠️ الليبل الإنجليزي للمنطقة مقصوص في الصورة (`Al Zabat Buil…`) — الاسم العربي هو اللي بيتبعت للـAPI (زي أمثلة التوثيق). |
| `tenants.shipping_provider` | ✅ `jt` (اتحطت 20 سبتمبر ليلاً — v55 الحية مش بتقرأه، وفرع n8n مفصول، فمفيش أثر لحد ما v56 تترفع) |
| **أوردر التجربة** | **`17170`** (منى رياض · 695 ج · استاند امريكانا أبيض 5 أدوار). ⚠️ `city` من اللاندنج «القاهره» **بس العنوان 6 أكتوبر الحي السابع** = محافظة الجيزة عند J&T. ✅ الأسماء اتحسمت من القالب: `الجيزة` / `مدينة السادس من أكتوبر` + المنطقة نص حر («الحي السابع») — مفيش حاجة ناقصة غير فتح المفتاح والضغطة |

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

~~✅ سكرين شوت «Interface Mgt.» من المالك (20 سبتمبر ليلاً) بيقول المفعّل بالظبط:
Delivery Time Inquiry · Logistics track query · **Create Order** · Query Order ·
Logistics track subscription · Waybill Model Query. يعني `addOrder` مفعّل~~

🔴 **أول محاولة حقيقية (21 سبتمبر 01:23 UTC — المالك من اللوحة، المفتاح مفتوح لدقايق):
J&T رفضت `order/addOrder` بـ`145003012 API account has no interface permissions`.**
مفيش شحنة اتعملت، والمفتاح اتقفل فوراً. يعني «Create Order» في شاشة Interface Mgt.
**مش بتساوي `order/addOrder` مفعّل** على الـ`apiAccount` بتاعنا (درس 24: الوثيقة/الشاشة
مش دليل — الرد هو الدليل). وقياس الصلاحيات الفعلي على الإنتاج بعدها مباشرةً
(نداءات قراءة بأرقام وهمية — صفر أثر):

| الـendpoint | رد J&T | الحكم |
|---|---|---|
| `order/addOrder` | `145003012` | 🔴 **مش مفعّل** — ده الحاجز الوحيد دلوقتي |
| `order/getOrders` | `999001030` (تحقق على الباراميتر) | ✅ مفعّل |
| `logistics/trace` | `145003316 billCode illegal` | ✅ مفعّل |
| `trace/subscribe` | `code 1` | ✅ مفعّل |
| `waybill/getWaybillInfo` | `code 1` (data فاضية) | ✅ مفعّل |
| `order/printOrder` | `1450033319 waybill not generated yet` | ✅ مفعّل — **مش في قايمة الشاشة أصلاً** |
| `online/pca` · `cover` · `getLocation` · `getComCost` | `145003012` | 🔴 مش مفعّلين |

يعني قايمة الشاشة **مش خريطة 1:1 للمسارات** (`printOrder` شغّال وهو مش فيها،
و«Create Order» مكتوبة وهي مش شغّالة). المطلوب من الـIT صار واضح ومحدد: تفعيل
`order/addOrder` (و`order/cancelOrder`) على الـ`apiAccount` بتاع الإنتاج.

✅ **والضابط اللي بيعزل المشكلة (نفس اللحظة): نفس الحمولة بالحرف على الـSandbox عدّت.**
`order/addOrder` عبر `jt-lookup raw env=sandbox` (مستلم وهمي «اختبار سهل» / `01000000000`
— مفيش بيانات عميل راحت للـSandbox، ومفيش أي كتابة على `orders`):
`code 1` · `billCode UEG088902635684` · `sortingCode "88,A01-67,"` · `lastCenterName
10thRamadanCityHub` · `txlogisticId SAHL-SBX-20260921-01`. يعني:
- المرسل `القاهرة` / `السلام` / `موقف بلبيس` والمستلم `الجيزة` / `مدينة السادس من أكتوبر`
  / «الحي السابع» **مقبولين** — ومعاهم **المنطقة نص حر اتأكدت من J&T نفسها** (مش من قرارنا).
- الحقول الخمسة والتوقيع والوزن والـremark كلهم سليمين.
- 🔴 **الحاجز الوحيد الفاضل: صلاحية `order/addOrder` على حساب الإنتاج** — مش في إيدنا.
⚠️ ملاحظة: `sortingCode` رجع بشرطة أخيرة فاضية (`88,A01-67,`) — القالب المعتمد بيطبعه
زي ما هو، ولو الإنتاج رجّع نفس الشكل ده طبيعي مش غلط عندنا.

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

**أسرار الـSandbox (21 سبتمبر — من المالك):** اتحطت في الـVault بأسماء `jt_sbx_*`
(`config` → `creds_sandbox=true`). الباسورد هي بتاعة حساب التوثيق التجريبي (المكتوبة في
جداول التوثيق نفسها) — اتأكدت لأن `query command:2` على `UEG088902573105` رجّع الأوردر
التجريبي كامل (`code 1`). **بس `online/pca` بيرجّع `145003012` على الـSandbox كمان** —
يعني الصلاحية مش مفعّلة على الحسابين، والطريق الوحيد للقايمة الكاملة هو الـIT (أو نسخة
من قوايم البوابة). ⚠️ الرد التجريبي أكّد إن الأسماء **عربي** (`الشرقية` / `الزقازيق` /
`حي الزهور` · `أسيوط` / `القوصية` / `الصبحه`) وإن `sortingCode` بيبقى فاضي لحد التوزيع
(`orderStatus 101`).

## 2ب) ✅ نطاق العناوين اتحسم من قالب البوابة (21 سبتمبر) — والمنطقة نص حر

**الشكل النهائي (قرار المالك بعد قراءة قالب الرفع الجماعي):**
- **المحافظة والمدينة** اختيار من قايمة `jt_pca` بأسماء J&T بالحرف — J&T بترفض
  الغلط فيهم (`145003060–61`).
- **المنطقة (area) نص حر مطلوب** — «الخانة التالتة مطلوبة بس عادي نكتب فيها أي
  حاجة، ملهاش اسطمبة أصلاً». حدها 60 حرف (توثيق `addOrder`: `area String(60)`).
  الموظف بيكتبها من العنوان (الحي / المنطقة / الشارع الرئيسي).
- الأدلة اللي أيّدت القرار قبل التنفيذ: قالب الرفع نفسه (عمود `*Arrival area` مطلوب
  ومن غير أي قايمة)، وأوردر الـSandbox (`حي الزهور` · `الصبحه` — نصوص حرة).
  ⚠️ **التأكيد النهائي = أول `addOrder` حقيقي يعدّي** بمنطقة حرة (درس 26).

**المصدر:** `Download_template.xls` من بوابة J&T (المالك بعته) — 26 محافظة و237
مدينة (named ranges في `Sheet2`)، محفوظين في `docs/pca-prov-city-template-2023.json`
و**متحمّلين في `jt_pca` بصفوف `area=''`** (migration `jt_pca_area_free_text` —
اتجرّبت بترانزاكشن راجعة الأول). صف `area=''` = «المدينة متسجّلة والمنطقة حرة»؛
لو `pca_sync` اتفعّل يوم وجاب مناطق، بتظهر **كاقتراحات** في `datalist` مش كقيد.
⚠️ القالب قديم (آخر حفظ أكتوبر 2023) وناقص: «الزقازيق» مش تحت الشرقية مع إن
الـSandbox استخدمتها — مدينة ناقصة = `address_not_in_pca` صريح، مش شحنة غلط.
ومحافظات اللاندنج (30 يوم) كلها بتتطابق بالتطبيع ما عدا «شمال سيناء» (أوردر واحد).

**اللي اتنفّذ:** `jt-ship` v4 (فحص `jt_pca` على المحافظة/المدينة بس + `area_too_long`) ·
نافذة الشحن v57 (المنطقة `<input>` + `datalist`، فاضية = رفض قبل الإرسال) ·
`test-jt-ship.mjs` 27 فحص. **اتأكد حيّ بعد النشر** بنداءين `diag` على `17170`:
مدينة وهمية → `422 address_not_in_pca` · `الجيزة` / `مدينة السادس من أكتوبر` /
«الحي السابع» → عدّى كل الحراسات ووقف عند `423 production_disabled` بس.

**لسه مطلوب من الـIT (مش حاجز دلوقتي):** تفعيل `online/pca` عشان القايمة تبقى
من J&T نفسها ومحدّثة (مش من قالب 2023). الرسالة تحت.

**رسالة للـIT (صلاحيات):**

> حساب J0086011282 (3ataba.com) — apiAccount بتاع الإنتاج (نفس الحساب اللي `order/getOrders`
> و`logistics/trace` و`trace/subscribe` و`order/printOrder` شغّالين عليه) بيرجّع
> `145003012 API account has no interface permissions` على **`order/addOrder`** (Create Order).
> برجاء تفعيل `order/addOrder` و`order/cancelOrder` على الحساب ده — ومعاهم لو أمكن:
> `online/pca` · `online/cover` · `location/getLocation` · `spmComCost/getComCost`.

## 3) محتاج من المالك — بيانات مش سرية (ابعتها في الشات)

1. ✅ ~~**القيم الستة** من طلب Create Order الناجح في Postman~~ — اتسجّلت (خمسة؛
   `serviceType` مش في الطلب الناجح فبقى اختياري في `jt-ship` v2 ومابيتبعتش لو فاضي).
2. ✅ ~~**عنوان المرسل**~~ — كامل: `القاهرة` / `السلام` (في قايمة القالب) / `موقف بلبيس` (نص حر).
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
2. ✅ `jt_pca` اتملى من قالب البوابة (26 محافظة / 237 مدينة) والمنطقة نص حر (بند 2ب).
   `pca_sync` لسه محجوب بـ`145003012` — تحسين مش حاجز.
3. ✅ الحقول اتسجّلت والمرسل كامل وعدّى حارس `sender_not_in_pca` (اتقاس حيّ بنداء diag).
4. لو Sandbox متسجّل: إنشاء تجريبي على Sandbox من السيرفر بنفس الحمولة → نتأكد من `billCode`/`sortingCode`.
5. ✅ v56 اترفعت (21 سبتمبر) واتأكدت بالبايت من الحي. ⏳ **v57** (المنطقة خانة كتابة) — الزيب اتسلّم ومستني الرفع.
6. ✅ `tenants.shipping_provider = 'jt'` لعتبة · ⏳ `jt_production_enabled = 'true'` — بيتفتح **لحظة** الشحنة الأولى بس.
7. ✅ الأوردر اتحدد: **`17170`** وعنوانه محلول ومحفوظ في `ship_*`. ✅ v57 اترفعت. 🔴 **أول ضغطة حقيقية
   (21 سبتمبر 01:23 UTC) اترفضت من J&T بـ`145003012`** — `order/addOrder` مش مفعّل على حساب الإنتاج
   (بند 2 — الجدول). المفتاح اتقفل تاني. **الفاضل: الـIT يفعّل `addOrder` → نفتح المفتاح → نفس الضغطة.**
   الحمولة نفسها اتأكدت على الـSandbox (`UEG088902635684`) فمفيش حاجة تتعدّل عندنا.
8. نتأكد بـ`query` (getOrders command:1) إن الأوردر موجود عند J&T **مرة واحدة**.
9. بعد موافقتك: خطوات n8n (بند 5) عشان تأكيد الواتساب يشحن أوتوماتيك.

**الرجوع في أي لحظة:** `jt_production_enabled = 'false'` (يمنع أي إنشاء جديد فوراً) +
`shipping_provider = 'bosta'` (يرجّع الزرار القديم) + فصل وصلة n8n.
