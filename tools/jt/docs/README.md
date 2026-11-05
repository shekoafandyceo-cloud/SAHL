# توثيق J&T Egypt Open Platform — نسخة مستخرجة

**المصدر:** `https://open.jtjms-eg.com` — صفحات `#/apiDoc/*`.
**تاريخ الاستخراج:** 20 سبتمبر 2026.

## إزاي اتقرت من غير لوجين

البوابة SPA (Vue) وصفحات التوثيق **مضمّنة جوّه ملفات الـJS بتاعتها**
(`js/chunk-*.js`) — الجداول (`postDataList` / `responseDataList`) والأمثلة
(`requestCode` / `responseCode`) وأكواد الأخطاء (`errcodeJson`) كلها في الكود
نفسه، والترجمة الإنجليزية في `app.js` (vue-i18n). اللوجين محتاجه بس لأداة
الاختبار (`apiTestApiMock`) مش للقراءة.

الاستخراج آلي (parser بايثون على الـchunks) — فالوصف اللي مالوش ترجمة
إنجليزية في `app.js` فاضل **بالصيني** زي ما هو، وأسماء بعض الحقول في جدول
الرد جت غلط من المصدر نفسه (مثلاً `10000000001299` مكان `txlogisticId` و
`zhangsan` مكان `name` — قيمة المثال اتحطت مكان الاسم في التوثيق الأصلي).

## الملفات

| الملف | الصفحة | الأهمية لينا |
|---|---|---|
| `order_addOrder.md` | Create Order | 🔴 الحقول الإجبارية · `remark` 200 حرف · الرد فيه `billCode` + `sortingCode` + `sumFreight` |
| `order_getOrders.md` | Query Order | `command` 1/2/3/4 · `orderStatus` 100–104 · `sortingCode` · `sumFreight` |
| `order_cancelOrder.md` | Cancel | بيرجّع `billCode` |
| `order_printOrder.md` | Print | بوليصة J&T كـPDF base64 (مش بوليصتنا المخصصة) |
| `order_addLooseOrder.md` | Loose order | مش هنستخدمه |
| `logistics_trace.md` | Track query | `billCodes` ≤30 · `details[]` بـ`scanType`/`scanTypeCode`/صور التوقيع |
| `trace_subscribe.md` | Subscribe | `traceNode` 1–15 · ≤1000 بوليصة |
| `logistics_statusFeedback.md` | **Callback** تحديثات التتبع | J&T بتنده URL بتاعنا بنفس الهيدرات + `details[]` |
| `orderserve_statusFeedback.md` | **Callback** حالة الأوردر | «اتوزّع مندوب / اتلمّ / اتلغى» + `weight` |
| `other_settlementReturn.md` | **Callback** الفاتورة | 🔴 `totalFreight` · `packageChargeWeight` · `freight` بعد مراجعة الحساب — **مصدر التكلفة المؤكدة** |
| `waybill_getWaybillInfo.md` | Waybill info | `isSign` · `packageChargeWeight` · `totalFreight` · `freight` |
| `spmComCost_getComCost.md` | Freight estimate | 🔴 تقدير الشحن: `sender`/`receiver` {prov,city,area,address} + `weight` → `totalPrice` |
| `online_pca.md` · `online_cover.md` | نطاق الخدمة | قايمة المحافظات/المدن/المناطق بأسمائهم عند J&T |
| `threeCode_getThreeSegmentCode.md` · `network_getInfo.md` | كود الفرز / الفرع | كود الفرز من العنوان قبل الإنشاء |
| `location_getLocation.md` | PCA بكود الدولة | |
| `official-java-example.java` | مثال التوقيع الرسمي (صفحة basic) | 🔴 المرجع الحاكم للتوقيع والـform |
| `official-php-signature-example.php.txt` | مثال PHP الرسمي (من `download.jtjms-eg.com`) | نفس المواصفة بـ`strtoupper` |

الخلاصة العربية للعقود المؤكدة والمجهولات في `CONTRACTS.md`.
