# عقود J&T المؤكدة من توثيق مصر — والمجهولات اللي فاضلة

> كل بند هنا ليه صفحة في نفس المجلد. اللي مش مكتوب هنا **مش متأكد**.
> اتقرا 20 سبتمبر 2026 من `open.jtjms-eg.com` (الطريقة في `README.md`).

## 1) البيئات والغلاف — ✅ مؤكد (صفحة basic + المثال الرسمي)

| البند | القيمة |
|---|---|
| Sandbox | `https://demoopenapi.jtjms-eg.com/webopenplatformapi/api/<path>` |
| Production | `https://openapi.jtjms-eg.com/webopenplatformapi/api/<path>` |
| Method | `POST` · `application/x-www-form-urlencoded` · حقل واحد `bizContent` = JSON string |
| Headers | `apiAccount` · `digest` · `timestamp` (ملّي ثانية) |
| `digest` (هيدر) | `Base64(MD5(bizContent + privateKey))` — على النص **بالحرف** |
| `digest` (جوّه bizContent) | `Base64(MD5(strtoupper(customerCode + MD5hex(password + "jadada236t2")) + privateKey))` |
| الرد | `{code, msg, data}` — `code = "1"` نجاح |

المثال الرسمي (Java) بيبعت بالظبط: `.form("bizContent", …)` + الهيدرات التلاتة،
والتوقيع `Base64(MD5(customerCode + pwdUpperHex + key))`. مثال PHP بيحط
`strtoupper` على `customerCode + md5hex` مع بعض — عميلنا بيعمل كده.

## 2) `order/addOrder` — ✅ الحقول مؤكدة

**إجباري (`Y`):** `customerCode` · `digest` · `txlogisticId` (50 — رقم أوردرنا)
· `expressType` · `deliveryType` · `sender{}` · `receiver{}` · `goodsType` ·
`weight` (String، كجم، مثال `0.02`) · `totalQuantity` (**لازم 1**) · `operateType`.

**`sender`/`receiver` إجباري:** `name` (50) · `mobile` (11) · `phone` (11) ·
`countryCode` (`EGY`) · `prov` (60) · `city` (60) · `area` (60) · `street` (200).
اختياري: `building` · `floor` · `flats` · `longitude` · `latitude` · `company`.

**اختياري مهم:** `itemsValue` (مبلغ التحصيل COD — String) · `payType`
(الرسالة `145003113` بتقول القيم `PP_CASH, CC_CASH, PP_MM`؛ المثال الرسمي بيبعت
`PP_PM`) · `remark` (**200 حرف**) · `pickInfo` (500 — «Iphone 15 *1; Bag *1») ·
`items[]` (`itemType` `ITN1..ITN16` · `itemName` 30 · `number` · `itemValue`) ·
`serviceType` (`01` door-to-door pickup · `02` store delivery) · `network`.

**الرد `data`:** `txlogisticId` · **`billCode`** (رقم البوليصة) · **`sortingCode`**
(مثال `20,J01-01,000` — ثلاثي بفواصل) · `createOrderTime` · `lastCenterName` ·
`sumFreight` (اختياري — «reference total freight»).

**أخطاء لها معنى تشغيلي:** `145002001` «order duplicate» و`145003101` «customer
order number exists» → **الإعادة بنفس `txlogisticId` بتترفض** (ده اللي بيخلي
`txlogisticId = orders.id` حارس تكرار طبيعي) · `145003060/61/62` منطقة/مدينة/
محافظة غير صالحة (لازم أسماء J&T من `online/pca`) · `145003092` وزن غير صالح ·
`145003108` ملاحظات/وصف غير صالح · `145003112` «COD مش مفعّل» · `145003113`
`payType` مش مطابق.

⚠️ **قيم `expressType` / `deliveryType` / `goodsType` / `operateType` مش
موثّقة كقايمة** — المثال الرسمي بيبعت `EZ` · `04` · `ITN16` · `1` (و`orderType:"1"`
و`serviceType:"01"`). صفحة Query بتقول `deliveryType 04 = home delivery`.
**القيم اللي نجحت في الـSandbox عندنا هي المرجع** — تتسجّل من طلب Postman الناجح.

## 3) `order/getOrders` — ✅ مؤكد

`command`: `1` برقم أوردرنا · `2` برقم البوليصة · `3` بفترة (`startDate`/`endDate`
+ `current`/`size`) · `4` serial. `serialNumber` مصفوفة. الرد فيه `orderStatus`
(`100` لسه ماتوزّعش · `101` اتوزّع فرع · `102` اتوزّع مندوب · `103` اتلمّ ·
`104` اتلغى) + `sortingCode` + `sumFreight` + `weight` + كل بيانات الطلب.

## 4) التتبع — ✅ مؤكد الشكل، ⏳ الأكواد لأ

- `logistics/trace`: `billCodes` بفاصلة (≤30). الرد `data[]` لكل بوليصة:
  `details[]` بـ`scanTime` · `desc` · `scanType` (نص) · `scanTypeCode` (رقم —
  المثال `10`) · الفرع والمحافظة والمدينة والمنطقة · `nextStopName` ·
  `sigPicUrl` / `electronicSignaturePicUrl` (عند التسليم) · `probleDescription`
  / `problemPicUrl` (عند مشكلة) · `otp`.
- `trace/subscribe`: `{id: apiAccount, list:[{traceNode:"1&2&…", waybillCode}]}`
  ≤1000. أرقام العُقد: 1 collection · 3 mail scan · 4 arrival · 5 out of warehouse
  · 6 inbound · 8 express take-out · 9 outbound · **10 signed (تسليم)** · **11 problem**
  · 12 stored · **13 return signature** · **14 return scan** · 15 forward.
- 🔴 **`scanTypeCode` ↔ الحالة النهائية مش موثّق كجدول.** الافتراض إن أرقامه =
  أرقام `traceNode` **افتراض** لازم يتأكد من أول حمولة حقيقية. لحد ما يتأكد:
  الحالة تتخزن **خام** (`scanType` + `scanTypeCode` + `desc`) ومايتبنيش عليها
  حساب.

## 5) الـCallbacks — ✅ الشكل مؤكد، ⏳ ولا حمولة حقيقية وصلت

J&T بتنده URL بتاعنا بنفس الهيدرات (`apiAccount` · `digest` · `timestamp`)
و`bizContent`، وبتستنى رد `{code, msg, data}`:
- **`logistics/statusFeedback`**: `{billCode, txlogisticId, details:[…]}` — نفس
  شكل `details` بتاع `trace`. **ده اللي بيبدّل `BOSTA_WEBHOOK`.**
- **`orderserve/statusFeedback`**: `{txlogisticId, billCode, jtOrderId, scanType
  («اتوزّع مندوب» / «اتلمّ» / «اتاخد» / «اتلغى»), time, weight?, reason?,
  carrierCode}` — الوزن بيرجع مع الاستلام.
- **`other/settlementReturn`**: `{waybillNo, totalFreight, packageChargeWeight,
  insuredFee?, freight, customerCode}` — «بعد مراجعة الحساب» = 🔴 **مصدر
  `real_shipping_fee` المؤكد**. تسجيل الـURL بتاعنا عندهم إجراء إداري مش API.

🔴 **التحقق من الـcallback**: الهيدر `digest` = `Base64(MD5(bizContent + privateKey))`
بنفس مفتاحنا — فنقدر نرفض أي نداء مش موقّع. لازم يتطبّق في `jt-status`.

## 6) التكلفة — ✅ فيه 3 مصادر، بترتيب الثقة

1. `other/settlementReturn` (callback بعد المراجعة) — **مؤكد**.
2. `waybill/getWaybillInfo` (`isSign` · `packageChargeWeight` · `totalFreight` ·
   `freight`) — بعد التسليم. الـSandbox رجّع `data` فاضية للتجريبي (طبيعي).
3. `spmComCost/getComCost` → `totalPrice` (**تقدير** قبل الإنشاء) و`sumFreight`
   في رد `addOrder` (**reference**) — تقديرات.
⚠️ نسبة الـ1% COD وحد الـ5 ج **مش في أي صفحة** — دي من العقد، وتتأكد منه.

## 7) العناوين — 🔴 أهم مدخل ناقص عندنا

`prov` / `city` / `area` لازم تطابق أسماء J&T (`online/pca` بيرجّعها،
و`145003060–62` بيرفض الغلط). عندنا `orders.city` بإملاء مختلط
(`القاهره` / `Cairo` / `القاهرة`) ومفيش `area` أصلاً — لازم: تحميل `pca` مرة،
خريطة تطبيع للمحافظات، واستخراج `area` من العنوان (زي ما بيحصل لبوسطة بالـAI
+ الشيت) أو `online/cover` للتأكد.

## 8) الطباعة

`order/printOrder` بيرجّع **بوليصة J&T** كـPDF base64 (`printSize` · `printCod` ·
`showCustomerOrderId`). بوليصتنا المخصصة المعتمدة بتتطبع عندنا من الرد
(`billCode` + `sortingCode`) — مش من هنا.

## المجهولات اللي لسه محتاجة Sandbox أو الطلبات المحفوظة

1. قيم `expressType` / `deliveryType` / `goodsType` / `operateType` / `payType`
   / `serviceType` اللي **نجحت فعلاً** في `SAHL-SBX-20260917-01`.
2. حمولة `logistics/statusFeedback` حقيقية واحدة (عشان `scanTypeCode`).
3. هل `logistics/trace` و`waybill/getWaybillInfo` بيقبلوا `digest`/`customerCode`
   جوّه `bizContent` ولا بيرفضوهم (الصفحات مابتحطهمش، والـSandbox عندنا نجح
   بيهم في Query).
4. شكل `sortingCode` على البوليصة المعتمدة: الرد `20,J01-01,000` والقالب
   `20 C01-03` — الفواصل بتتحول مسافات؟ يتأكد من J&T.
