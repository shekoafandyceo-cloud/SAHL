# SHIPT CTX — توصيل زرار «شحن» من اللوحة بمسار الشحن في `Whatsapp_WEBHOOK`

> **آخر قراءة للحالة الحية:** `Whatsapp_WEBHOOK` (`9XzDXtvG64WkVoO4`)
> · `versionId = activeVersionId = cd6e1009-e2e7-4421-a81d-df941cf834e8` → **منشور** ✅
> · 89 نود · 6 أغسطس 2026.
>
> الأقسام 1–3 اتكتبت على النسخة اللي قبلها (`55e68908`) وقت ما `SHIPT CTX`
> ماكانتش موجودة — سيبتها زي ما هي كتوثيق للسبب الجذري. **حالة التنفيذ
> الحالية في القسم 0 تحت.**
>
> كل الخطوات دي **يدوية على n8n**. أنا مابعدّلش وركفلو إنتاجي (قاعدة الأمان 1).

---

## 0) حالة التنفيذ — مراجعة 6 أغسطس بعد تعديل المالك

> النود اتسمّت **`SHIPT CTX`** (بحرف T) مش `SHIP&#8203;CTX` زي المقترح. مش مشكلة —
> الـ36 إشارة كلها `$('SHIPT CTX')` **مطابقة للاسم بالحرف**، وده أخطر
> حاجة كانت ممكن تغلط (درس 3). الملف ده اتظبط على الاسم الجديد.
>
> `versionId == activeVersionId == cd6e1009` → **منشور** ✅

### اتعمل ✅

| البند | الحالة |
|---|---|
| نود `SHIPT CTX` موجودة | ✅ |
| 13 نود اتحوّلت (36 إشارة) | ✅ الاسم مطابق |
| `ConfirmReply → SHIPT CTX → If5 → Switch1` | ✅ |
| `Webhook2` بقت **POST** | ✅ |
| `If5` بقت `{{ $json.tenant.shipping_api_key }}` | ✅ **أنضف من المقترح** — بتقرا من الـinput مباشرة بدل الاسم |
| المسار القديم سليم | ✅ 6 نودز (`ConfirmReply` · `CancelledReply` · `checkExistance` · `CancelledReply1` · `If9` · `If10`) لسه على الأسماء القديمة — **وده صح**، دول قبل `SHIPT CTX` |

### ناقص ❌

| # | البند | الأثر |
|---|---|---|
| 1 | 🔴 **`get_order_details` مش موجودة خالص** | الكود بينادي `$('get_order_details')` — نود مش موجودة. **مسار اللوحة ميّت** |
| 2 | 🔴 **`get_tenant_details` الفلتر لسه فاضي** (`keyName:"id"` من غير `keyValue`) | التاجر مش هيتجاب |
| 3 | 🔴 **`Send a text message4/5/8` لسه على `$('Update Order → confirmed')`** (9 إشارات) | مسارات **الفشل** بس — التست العادي مش هيمسكها |
| 4 | 🟠 الكود مافيهوش حارس `tracking_no` ولا رمي صريح | شحنة مكررة · ورسالة خطأ غامضة |
| 5 | 🟠 `Webhook2` المسار لسه `ordercreate` | مكشوف ويتخمّن |
| 6 | 🟠 `alwaysOutputData` مش مفعّلة على `get_tenant_details` | وقوف صامت (درس 5) |

---

## 1) المشكلة

انت ضفت المدخل الجديد كده:

```
Webhook2 (path: ordercreate) → get_tenant_details → If5 → Switch1 ─[bosta]→ Ta7leel el Address → … → BOSTA API → Update a row
                                                     ↑              └─[jt] → (فاضي)
ConfirmReply ────────────────────────────────────────┘
```

الشكل ده صح معمارياً — بس **مش هيمشي**، والسبب أسماء النودز.

كل نود بعد `If5` بتقرا بياناتها بالاسم الصريح (وده الحل الصح لدرس 2):

| بتقرا من | كام نود | كام إشارة |
|---|---|---|
| `$('Get Tenant')` | 6 | 6 |
| `$('Update Order → confirmed')` | 17 | 40 |
| **الإجمالي** | **17 نود** | **46 إشارة** |

على مسار `Webhook2` النودتين دول **عمرهم ما بينفّذوا**:
- اللي بينفّذ هو `get_tenant_details` — **اسم تاني**
- ومفيش نود بتجيب الأوردر خالص

فمن أول `If5` نفسه:

| النود | بتقرا | النتيجة على مسار Webhook2 |
|---|---|---|
| `If5` | `$('Get Tenant').shipping_api_key` (notEmpty) | النود مانفّذتش |
| `Switch1` | `$('Get Tenant').shipping_provider` (×2 — bosta / jt) | النود مانفّذتش |
| `Ta7leel el Address` | `$('Update Order → confirmed').address` | النود مانفّذتش |
| `BOSTA API` | الاتنين (×9) — المنتج، المبلغ، العنوان، الاسم، التليفون | النود مانفّذتش |
| `Update a row` | `$('Update Order → confirmed').id` / `.tenant_id` | البوليصة مش هتتكتب |

> **ملحوظة:** `If5` بقت بتشيك على **المفتاح بس** — شرط `shipping_provider`
> اتنقل لـ`Switch1` في تعديلك الأخير. ده تقسيم صح: `If5` = «التاجر جاهز
> يشحن؟» و`Switch1` = «يشحن بمين؟». الملف ده متوافق مع الشكل ده.

يا يرمي خطأ يا يرجّع فاضي — والحالتين **الشحنة مابتتعملش والتنفيذ ممكن يتسجّل ناجح** (درس 5).

**وحاجتين ناقصين في الشكل:**
- `get_tenant_details` الفلتر بتاعه **فاضي**: `{"keyName":"id"}` من غير `keyValue`
- **مفيش نود بتجيب الأوردر** — والسلسلة كلها قايمة عليه

---

## 2) الحل — نود سياق واحدة

بدل ما نصلّح 46 إشارة كل واحدة بـfallback، نخلي المسارين يتلاقوا في **نود واحدة قبل `If5`**:

```
ConfirmReply ─────────────────────────────────────────────┐
                                                          ├→ SHIPT CTX → If5 → Switch1 ─[bosta]→ Ta7leel el Address → …
Webhook2 → get_tenant_details → get_order_details ────────┘                          └─[jt] → (J&T بعدين)
```

`SHIPT CTX` بترجّع `{ tenant:{…}, order:{…} }` من أي مسار، والسلسلة كلها بتقرا منها هي بس.

**ليه ده أحسن من الحلول التانية:**
- **مسار الواتساب لحد `ConfirmReply` مايتلمسش خالص** — صفر تعديل على المسار الحي اللي بيشتغل دلوقتي
- **J&T بتتعمل مرة واحدة.** فرع جديد في `Switch1` بيقرا نفس `SHIPT CTX` — مش هتدوّر على أسماء نودز تاني
- **مفيش تكرار للسلسلة.** (البديل — نسخ الـ25 نود في وركفلو تاني — كان معناه تعمل J&T مرتين)
- الـ`try/catch` جوّه نود Code بيمسك خطأ «النود مانفّذتش» لأنه **جافاسكربت حقيقي** — التعبيرة العادية (`{{ }}`) ماتقدرش

---

## 3) 🔴 حاجات لازم تتحل مع الميزة (مش تحسينات)

### أ) `ordercreate` مسار مكشوف — أخطر بند هنا
`Webhook2` مالهاش أي auth، والمسار **يتخمّن**. أي حد يبعت `{tenant_id, order_id}` على
`https://play.sheko.tech/webhook/ordercreate` **يعمل شحنة بوسطة حقيقية بفلوس** على حساب أي تاجر.

قارن بالـ`Webhook` عندك في نفس الوركفلو: `wa-ae875b1352c9fd9b21d4fe661f20e7f5` — السر في المسار.

**المطلوب — الاتنين مع بعض:**
1. غيّر المسار لحاجة سرية: `ship-<32 حرف عشوائي>`
2. والنداء من **Edge Function** مش من المتصفح — عشان الـFunction تعرف التاجر من الـJWT،
   فتاجر مايقدرش يشحن أوردر تاجر تاني حتى لو عرف المسار

### ب) `Webhook2` مافيهاش `httpMethod`
الافتراضي **GET**، والـGET مابيشيلش body. لازم **POST**.

### ج) الشحنة المكررة = فلوس حقيقية
`BOSTA API` بينشئ شحنة فعلية. دبل-كليك أو ضغطة على أوردر عنده `tracking_no` = **شحنتين**.
زرار disabled في الفرونت **مش كفاية**. الحارس لازم يبقى على السيرفر:
- الـEdge Function ترفض لو `orders.tracking_no` مش فاضي
- وتختم `shipping_requested_at` قبل ما تنادي n8n، وترفض لو مختوم من أقل من دقيقتين

### د) `chat_id` متسمّر في نودز التنبيه
`Send a text message8` / `4` / `5` (رسايل «العنوان أهطل» و«مش عارف اظبط البوليصة»)
كلهم على `chatId: -5130323197` — جروب عتبة.

**أول ما تاجر تاني يشحن من اللوحة، شكاوى عناوين عملائه هتنزل في جروب عتبة.**
ده نفس بند 🟠 المفتوح في `CLAUDE.md`. لازم يتقرا من صف التاجر:
`{{ $('SHIPT CTX').item.json.tenant.telegram_group_id }}` (أو `ops_chat_id`)
**قبل** ما الميزة تتفتح لغير عتبة.

### هـ) `Trendose` مالهاش `shipping_api_key`
اتأكدت على الحالة الحية 6 أغسطس: `3ataba` هي التاجر الوحيد اللي عنده مفتاح شحن.
يعني `If5` هترجّع **false** لـTrendose والزرار مايعملش حاجة.
اللوحة لازم تقول ليه صراحةً («اربط مفتاح الشحن الأول من الإعدادات») مش تفضل ساكتة.

---

## 4) الخطوات

### خطوة 0 — قبل أي حاجة
- [ ] افتح الوركفلو وشوف هل فيه تعديلات مش منشورة (الـ`versionId` مختلف عن `activeVersionId`)
- [ ] خد **Download** للوركفلو كـJSON — ده الـrollback الوحيد المضمون
- [ ] اتأكد إن التعديلات المحفوظة الحالية هي اللي انت عايزها فعلاً

### خطوة 1 — صلّح `get_tenant_details`
الفلتر فاضي دلوقتي.

| الحقل | القيمة |
|---|---|
| Operation | `get` |
| Table | `tenants` |
| Filter → keyName | `id` |
| Filter → **keyValue** | `={{ $('Webhook2').item.json.body.tenant_id }}` |

☑️ فعّل **Always Output Data** (درس 5 — نود فاضية = وقوف صامت والتنفيذ «ناجح»)

### خطوة 2 — نود جديدة `get_order_details`
Supabase · **بعد** `get_tenant_details`.

| الحقل | القيمة |
|---|---|
| Operation | `getAll` |
| Table | `orders` |
| Return All | ✅ |
| Match Type | `allFilters` |
| فلتر 1 | `id` · `eq` · `={{ $('Webhook2').item.json.body.order_id }}` |
| فلتر 2 | `tenant_id` · `eq` · `={{ $('Webhook2').item.json.body.tenant_id }}` |

☑️ **Always Output Data**

> فلتر الـ`tenant_id` مش زيادة — من غيره `order_id` من تاجر تاني بيمر.
> ده الحاجز التاني بعد الـEdge Function.

### خطوة 3 — نود جديدة `SHIPT CTX` (Code)
**اسمها `SHIPT CTX` بالحرف** — الـ46 إشارة كلها هتنادي الاسم ده.

```javascript
// نقطة الالتقاء بين المسارين. الـtry/catch هنا هو اللي بيخلي الحكاية تمشي:
//   - من الواتساب: Get Tenant و Update Order → confirmed هما اللي نفّذوا
//   - من اللوحة  : get_tenant_details و get_order_details
// نداء $('نود مانفّذتش') بيرمي — والرمي ده بيتمسك هنا لأن ده جافاسكربت
// حقيقي. التعبيرة العادية {{ }} ماكانتش هتقدر.
let tenant = null, order = null;

try { tenant = $('Get Tenant').first().json; } catch (e) { /* مش مسار الواتساب */ }
if (!tenant || !tenant.id) {
  try { tenant = $('get_tenant_details').first().json; } catch (e) {}
}

try { order = $('Update Order → confirmed').first().json; } catch (e) { /* مش مسار الواتساب */ }
if (!order || !order.id) {
  try { order = $('get_order_details').first().json; } catch (e) {}
}

// وقوف صريح أحسن من تمرير undefined لسلسلة بتعمل شحنات بفلوس (درس 5)
if (!tenant || !tenant.id) throw new Error('SHIPT CTX: مفيش بيانات تاجر من أي مسار');
if (!order  || !order.id)  throw new Error('SHIPT CTX: مفيش بيانات أوردر من أي مسار');

// حارس الشحنة المكررة — طبقة تانية جوّه n8n نفسه، مستقلة عن الـEdge Function
if (order.tracking_no) {
  throw new Error('SHIPT CTX: الأوردر عنده بوليصة بالفعل (' + order.tracking_no + ') — وقفنا قبل ما نعمل شحنة تانية');
}

return [{ json: { tenant, order, source: $('Get Tenant').isExecuted === undefined ? 'unknown' : 'wa' } }];
```

> **ملحوظة على السطر الأخير:** `isExecuted` **مااتأكدناش منها** في نسخة n8n
> اللي عندك — فمحطوطة في حقل `source` اللي **محدش بيقراه**. لو رمت، شيل السطر
> وخلّيها `return [{ json: { tenant, order } }];`. متبنيش عليها أي منطق.

### خطوة 4 — إعادة التوصيل

| احذف الوصلة | ضيف الوصلة |
|---|---|
| `ConfirmReply → If5` | `ConfirmReply → SHIPT CTX` |
| `get_tenant_details → If5` | `get_tenant_details → get_order_details` |
| — | `get_order_details → SHIPT CTX` |
| — | `SHIPT CTX → If5` |

الباقي زي ما هو: `If5 → Switch1 → Ta7leel el Address → …`

### خطوة 5 — `Webhook2`

| الحقل | القيمة |
|---|---|
| HTTP Method | **POST** (مش GET الافتراضي) |
| Path | `ship-<32 حرف عشوائي>` — مش `ordercreate` |
| Response Mode | حسب اختيارك (تحت) |

**Body المتوقع:**
```json
{ "tenant_id": "uuid", "order_id": "uuid" }
```

### خطوة 6 — الـ46 إشارة
كلها في [`_edits_generated.md`](./_edits_generated.md) — متولّدة من الوركفلو نفسه مش مكتوبة بالإيد.
القاعدة بسيطة:

```
$('Get Tenant').item.json.X                → $('SHIPT CTX').item.json.tenant.X
$('Update Order → confirmed').item.json.X  → $('SHIPT CTX').item.json.order.X
```

🔴 **`Update a row` فيها استثناء:** الإشارة لـ`$('BOSTA API')` **ماتتغيرش** —
دي جوّه السلسلة نفسها وشغّالة على المسارين.

---

## 5) الاختبار — من غيره احنا واثقين من الشكل مش من السلوك

> درس 26: «مفيش تنفيذ» مش «شغّال». البوابة اللي فاتت اتبنت واتراجعت نود بنود
> وعدد تنفيذاتها صفر — ومراجعة الشكل مابتثبتش إن السلوك صح.

**رتّب كده — من الأرخص للأغلى:**

| # | الاختبار | المتوقع |
|---|---|---|
| 1 | `Execute step` على `SHIPT CTX` لوحدها من مسار الواتساب (Pin data من تنفيذ قديم) | `{tenant:{…}, order:{…}}` — والاتنين مليانين |
| 2 | POST على الـwebhook بـ`order_id` **عنده `tracking_no`** | يقف عند `SHIPT CTX` برسالة «عنده بوليصة بالفعل» — **مفيش نداء لبوسطة** |
| 3 | POST بـ`tenant_id` تاجر **مالوش `shipping_api_key`** (مثلاً Trendose) | `If5` ترجّع false — الفرع يقف، مفيش شحنة |
| 4 | POST بـ`order_id` من تاجر و`tenant_id` من تاجر تاني | `get_order_details` ترجّع فاضي → `SHIPT CTX` ترمي. **لو عملت شحنة = العزل مكسور** |
| 5 | POST بأوردر حقيقي من `3ataba` من غير `tracking_no` | شحنة واحدة · `status='BOSTA AUTO'` · `tracking_no` اتكتب |
| 6 | **بعد 5 على طول** — نفس الأوردر تاني | يقف عند الحارس. **لو عمل شحنة تانية = فلوس ضاعت** |
| 7 | أوردر تأكيد حقيقي من الواتساب (المسار القديم) | زي ما كان بالظبط — ده اختبار عدم الانحدار |

**اختبار 7 هو الأهم.** كل الشغل ده معناه إن مسار الواتساب اتغيّر مدخله لـ`If5`.
لو 7 وقع، الميزة الجديدة مش مهمة خالص — أهم حاجة إن اللي شغّال يفضل شغّال.

**واختبار 4 و6 هما اللي بيمنعوا الضرر الحقيقي** — العزل بين التجار، والفلوس.

---

## 6) الرجوع

| الحالة | التصرف |
|---|---|
| لسه في المحرر ومانشرتش | **Publish** النسخة القديمة (`activeVersionId = 1b749480…`) |
| اتنشر وطلع غلط | ارفع الـJSON اللي نزّلته في خطوة 0 وانشره |
| عايز تقفل الميزة بسرعة من غير rollback | عطّل `Webhook2` (Disable node). المسار القديم بيفضل شغّال عبر `ConfirmReply → SHIPT CTX` |

آخر واحد ده هو **أرخص مفتاح إطفاء** — خليه في بالك.

---

## 7) اللي فاضل بعد كده

- [ ] Edge Function `ship-order` (`verify_jwt`) — بتاخد `order_id` بس، والتاجر من الـJWT
- [ ] زرار «شحن» في `orders/detail.js` بينادي الـFunction + حالة انتظار + رسالة صريحة لو مفيش مفتاح شحن
- [ ] `chat_id` في `Send a text message4/5/8` يتقرا من `SHIPT CTX.tenant` (بند د فوق) — **قبل** فتح الميزة لغير عتبة
- [ ] فرع `jt` في `Switch1` لما J&T تيجي
- [ ] عمود `shipping_requested_at` على `orders` لحارس التكرار
