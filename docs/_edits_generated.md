# الإشارات الـ46 — قبل/بعد

> **مولّد آلياً** من `Whatsapp_WEBHOOK` (`versionId=55e68908`) يوم 6 أغسطس 2026 — مش مكتوب بالإيد.
> اقرا `n8n-SHIP-CTX.md` الأول. متنسخش من هنا قبل ما تتأكد إن نسخة الوركفلو عندك هي دي.


### `AI Agent` — agent · 1 إشارة

```diff
- =أنت مساعد ذكي لشركة شحن.
- 
- عنوان العميل هو: {{ $('Update Order → confirmed').item.json.address }}
- 
- قاعدة البيانات المتاحة لهذه المحافظة:
- {{ $json.database_text }}
- 
- 
- المطلوب:
- طابق عنوان العميل بقاعدة البيانات واستخرج Zone_Id و District_Id و City_Name.
- أعد الناتج بصيغة JSON Object فقط بدون أي نصوص إضافية."
- 
- 
+ =أنت مساعد ذكي لشركة شحن.
+ 
+ عنوان العميل هو: {{ $('SHIP CTX').item.json.order.address }}
+ 
+ قاعدة البيانات المتاحة لهذه المحافظة:
+ {{ $json.database_text }}
+ 
+ 
+ المطلوب:
+ طابق عنوان العميل بقاعدة البيانات واستخرج Zone_Id و District_Id و City_Name.
+ أعد الناتج بصيغة JSON Object فقط بدون أي نصوص إضافية."
+ 
+ 
```

### `AI Agent3` — agent · 1 إشارة

```diff
- =أنت مساعد ذكي لشركة شحن.
- 
- عنوان العميل هو: {{ $('Update Order → confirmed').item.json.address }}
- 
- قاعدة البيانات المتاحة لهذه المحافظة:
- {{ $json.database_text }}
- 
- 
- المطلوب:
- طابق عنوان العميل بقاعدة البيانات واستخرج Zone_Id و District_Id و City_Name.
- أعد الناتج بصيغة JSON Object فقط بدون أي نصوص إضافية."
- 
- 
+ =أنت مساعد ذكي لشركة شحن.
+ 
+ عنوان العميل هو: {{ $('SHIP CTX').item.json.order.address }}
+ 
+ قاعدة البيانات المتاحة لهذه المحافظة:
+ {{ $json.database_text }}
+ 
+ 
+ المطلوب:
+ طابق عنوان العميل بقاعدة البيانات واستخرج Zone_Id و District_Id و City_Name.
+ أعد الناتج بصيغة JSON Object فقط بدون أي نصوص إضافية."
+ 
+ 
```

### `AI Agent4` — agent · 1 إشارة

```diff
- =أنت مساعد ذكي لشركة شحن.
- 
- عنوان العميل هو: {{ $('Update Order → confirmed').item.json.address }}
- 
- قاعدة البيانات المتاحة لهذه المحافظة:
- {{ $json.database_text }}
- 
- المطلوب:
- 
- طابق عنوان العميل بأقرب منطقة في قاعدة البيانات المرفقة فوق. استخرج البيانات التالية لشركة بوسطة:
- 
- City_Name
- 
- Zone_Id
- 
- District_Id
- 
- أعد الناتج بصيغة JSON فقط بدون أي نص إضافي
- 
+ =أنت مساعد ذكي لشركة شحن.
+ 
+ عنوان العميل هو: {{ $('SHIP CTX').item.json.order.address }}
+ 
+ قاعدة البيانات المتاحة لهذه المحافظة:
+ {{ $json.database_text }}
+ 
+ المطلوب:
+ 
+ طابق عنوان العميل بأقرب منطقة في قاعدة البيانات المرفقة فوق. استخرج البيانات التالية لشركة بوسطة:
+ 
+ City_Name
+ 
+ Zone_Id
+ 
+ District_Id
+ 
+ أعد الناتج بصيغة JSON فقط بدون أي نص إضافي
+ 
```

### `AI Agent6` — agent · 1 إشارة

```diff
- =أنت مساعد ذكي لشركة شحن.
- 
- عنوان العميل هو: {{ $('Update Order → confirmed').item.json.address }}
- 
- قاعدة البيانات المتاحة لهذه المحافظة:
- {{ $json.database_text }}
- 
- المطلوب:
- 
- طابق عنوان العميل بأقرب منطقة في قاعدة البيانات المرفقة فوق. استخرج البيانات التالية لشركة بوسطة:
- 
- City_Name
- 
- Zone_Id
- 
- District_Id
- 
- أعد الناتج بصيغة JSON فقط بدون أي نص إضافي
- 
+ =أنت مساعد ذكي لشركة شحن.
+ 
+ عنوان العميل هو: {{ $('SHIP CTX').item.json.order.address }}
+ 
+ قاعدة البيانات المتاحة لهذه المحافظة:
+ {{ $json.database_text }}
+ 
+ المطلوب:
+ 
+ طابق عنوان العميل بأقرب منطقة في قاعدة البيانات المرفقة فوق. استخرج البيانات التالية لشركة بوسطة:
+ 
+ City_Name
+ 
+ Zone_Id
+ 
+ District_Id
+ 
+ أعد الناتج بصيغة JSON فقط بدون أي نص إضافي
+ 
```

### `BOSTA API` — httpRequest · 9 إشارة

```diff
- ={
-   "Authorization": "{{ $('Get Tenant').item.json.shipping_api_key }}",
-   "Content-Type": "application/json"
- }
+ ={
+   "Authorization": "{{ $('SHIP CTX').item.json.tenant.shipping_api_key }}",
+   "Content-Type": "application/json"
+ }
```
```diff
- ={
-   "type": 10,
-   "allowToOpenPackage": true,
-   "specs": {
-     "packageType": "Parcel",
-     "size": "MEDIUM",
-     "packageDetails": {
-       "itemsCount": 1,
-       "description": "{{ $('Update Order → confirmed').item.json.product_name + (String($('Update Order → confirmed').item.json.manufacturer_note ?? '').trim() ? ' ' + String($('Update Order → confirmed').item.json.manufacturer_note ?? '').trim() : '') }}"
-     }
-   },
-   "notes": "{{ String($('Update Order → confirmed').item.json.manufacturer_note ?? '').trim() }}",
-   "cod":{{ $('Update Order → confirmed').item.json.total_cost }} ,
- 
-   "dropOffAddress": {
-     "city": "{{ $json.City_Name }}",
-     "zoneId": "{{ $json.Zone_Id }}",
-     "districtId": "{{ $json.District_Id }}",
-     "firstLine": "{{ $('Update Order → confirmed').item.json.address.replace(/\
- /g, ' ') }}"
-   },
- 
-   "receiver": {
-     "firstName": "{{ $('Update Order → confirmed').item.json.customer_name }}",
-     "phone": "{{ $('Update Order → confirmed').item.json.phone }}"
-   }
- }
+ ={
+   "type": 10,
+   "allowToOpenPackage": true,
+   "specs": {
+     "packageType": "Parcel",
+     "size": "MEDIUM",
+     "packageDetails": {
+       "itemsCount": 1,
+       "description": "{{ $('SHIP CTX').item.json.order.product_name + (String($('SHIP CTX').item.json.order.manufacturer_note ?? '').trim() ? ' ' + String($('SHIP CTX').item.json.order.manufacturer_note ?? '').trim() : '') }}"
+     }
+   },
+   "notes": "{{ String($('SHIP CTX').item.json.order.manufacturer_note ?? '').trim() }}",
+   "cod":{{ $('SHIP CTX').item.json.order.total_cost }} ,
+ 
+   "dropOffAddress": {
+     "city": "{{ $json.City_Name }}",
+     "zoneId": "{{ $json.Zone_Id }}",
+     "districtId": "{{ $json.District_Id }}",
+     "firstLine": "{{ $('SHIP CTX').item.json.order.address.replace(/\
+ /g, ' ') }}"
+   },
+ 
+   "receiver": {
+     "firstName": "{{ $('SHIP CTX').item.json.order.customer_name }}",
+     "phone": "{{ $('SHIP CTX').item.json.order.phone }}"
+   }
+ }
```

### `BOSTA API1` — httpRequest · 9 إشارة

```diff
- ={
-   "Authorization": "{{ $('Get Tenant').item.json.shipping_api_key }}",
-   "Content-Type": "application/json"
- }
+ ={
+   "Authorization": "{{ $('SHIP CTX').item.json.tenant.shipping_api_key }}",
+   "Content-Type": "application/json"
+ }
```
```diff
- ={
-   "type": 10,
-   "allowToOpenPackage": true,
-   "specs": {
-     "packageType": "Parcel",
-     "size": "MEDIUM",
-     "packageDetails": {
-       "itemsCount": 1,
-       "description": "{{ $('Update Order → confirmed').item.json.product_name + (String($('Update Order → confirmed').item.json.manufacturer_note ?? '').trim() ? ' ' + String($('Update Order → confirmed').item.json.manufacturer_note ?? '').trim() : '') }}"
-     }
-   },
-   "notes": "{{ String($('Update Order → confirmed').item.json.manufacturer_note ?? '').trim() }}",
-   "cod":{{ $('Update Order → confirmed').item.json.total_cost }} ,
- 
-   "dropOffAddress": {
-     "city": "{{ $json.City_Name }}",
-     "zoneId": "{{ $json.Zone_Id }}",
-     "districtId": "{{ $json.District_Id }}",
-     "firstLine": "{{ $('Update Order → confirmed').item.json.address.replace(/\
- /g, ' ') }}"
-   },
- 
-   "receiver": {
-     "firstName": "{{ $('Update Order → confirmed').item.json.customer_name }}",
-     "phone": "{{ $('Update Order → confirmed').item.json.phone }}"
-   }
- }
+ ={
+   "type": 10,
+   "allowToOpenPackage": true,
+   "specs": {
+     "packageType": "Parcel",
+     "size": "MEDIUM",
+     "packageDetails": {
+       "itemsCount": 1,
+       "description": "{{ $('SHIP CTX').item.json.order.product_name + (String($('SHIP CTX').item.json.order.manufacturer_note ?? '').trim() ? ' ' + String($('SHIP CTX').item.json.order.manufacturer_note ?? '').trim() : '') }}"
+     }
+   },
+   "notes": "{{ String($('SHIP CTX').item.json.order.manufacturer_note ?? '').trim() }}",
+   "cod":{{ $('SHIP CTX').item.json.order.total_cost }} ,
+ 
+   "dropOffAddress": {
+     "city": "{{ $json.City_Name }}",
+     "zoneId": "{{ $json.Zone_Id }}",
+     "districtId": "{{ $json.District_Id }}",
+     "firstLine": "{{ $('SHIP CTX').item.json.order.address.replace(/\
+ /g, ' ') }}"
+   },
+ 
+   "receiver": {
+     "firstName": "{{ $('SHIP CTX').item.json.order.customer_name }}",
+     "phone": "{{ $('SHIP CTX').item.json.order.phone }}"
+   }
+ }
```

### `If5` — if · 1 إشارة

```diff
- ={{ $('Get Tenant').item.json.shipping_api_key }}
+ ={{ $('SHIP CTX').item.json.tenant.shipping_api_key }}
```

### `RANKING` — httpRequest · 3 إشارة

```diff
- ={{ $('Update Order → confirmed').item.json.phone }}
+ ={{ $('SHIP CTX').item.json.order.phone }}
```
```diff
- ={
-   "Authorization": "{{ $('Get Tenant').item.json.shipping_api_key }}",
-   "Content-Type": "application/json"
- }
+ ={
+   "Authorization": "{{ $('SHIP CTX').item.json.tenant.shipping_api_key }}",
+   "Content-Type": "application/json"
+ }
```
```diff
- ={
-   "mobilePhones": "{{ $('Update Order → confirmed').item.json.phone }}"
- }
+ ={
+   "mobilePhones": "{{ $('SHIP CTX').item.json.order.phone }}"
+ }
```

### `RANKING1` — httpRequest · 3 إشارة

```diff
- ={{ $('Update Order → confirmed').item.json.phone }}
+ ={{ $('SHIP CTX').item.json.order.phone }}
```
```diff
- ={
-   "Authorization": "{{ $('Get Tenant').item.json.shipping_api_key }}",
-   "Content-Type": "application/json"
- }
+ ={
+   "Authorization": "{{ $('SHIP CTX').item.json.tenant.shipping_api_key }}",
+   "Content-Type": "application/json"
+ }
```
```diff
- ={
-   "mobilePhones": "{{ $('Update Order → confirmed').item.json.phone }}"
- }
+ ={
+   "mobilePhones": "{{ $('SHIP CTX').item.json.order.phone }}"
+ }
```

### `Send a text message4` — telegram · 3 إشارة

```diff
- =العميل دا أكد بس انا مش عارف اظبط البوليصة حد يعملها يا شباب 
- 
- {{ $('Update Order → confirmed').item.json.phone }}
- رقم الاوردر
- {{ $('Update Order → confirmed').item.json.order_uid }}
- 
- عنوانه اهو 
- {{ $('Update Order → confirmed').item.json.address }}
- 
- و انا عملت المحافظة 
- ( {{ $('Code in JavaScript').item.json.city }} )
- و المنطقة
- ( {{ $('Code in JavaScript').item.json.zone_name }} )
- و الحي
- ( {{ $('Code in JavaScript').item.json.district }} )
- 
- بس مش ظابطة.
+ =العميل دا أكد بس انا مش عارف اظبط البوليصة حد يعملها يا شباب 
+ 
+ {{ $('SHIP CTX').item.json.order.phone }}
+ رقم الاوردر
+ {{ $('SHIP CTX').item.json.order.order_uid }}
+ 
+ عنوانه اهو 
+ {{ $('SHIP CTX').item.json.order.address }}
+ 
+ و انا عملت المحافظة 
+ ( {{ $('Code in JavaScript').item.json.city }} )
+ و المنطقة
+ ( {{ $('Code in JavaScript').item.json.zone_name }} )
+ و الحي
+ ( {{ $('Code in JavaScript').item.json.district }} )
+ 
+ بس مش ظابطة.
```

### `Send a text message5` — telegram · 3 إشارة

```diff
- =العميل دا أكد بس انا مش عارف اظبط البوليصة حد يعملها يا شباب 
- 
- {{$('Update Order → confirmed').item.json.phone }}
- رقم الاوردر
- {{ $('Update Order → confirmed').item.json.order_uid }}
- 
- عنوانه اهو 
- {{ $('Update Order → confirmed').item.json.address }}
- 
- و انا عملت المحافظة 
- ( {{ $('Code in JavaScript').item.json.city }} )
- و المنطقة
- ( {{ $('Code in JavaScript').item.json.zone_name }} )
- و الحي
- ( {{ $('Code in JavaScript').item.json.district }} )
- 
- بس مش ظابطة.
+ =العميل دا أكد بس انا مش عارف اظبط البوليصة حد يعملها يا شباب 
+ 
+ {{$('SHIP CTX').item.json.order.phone }}
+ رقم الاوردر
+ {{ $('SHIP CTX').item.json.order.order_uid }}
+ 
+ عنوانه اهو 
+ {{ $('SHIP CTX').item.json.order.address }}
+ 
+ و انا عملت المحافظة 
+ ( {{ $('Code in JavaScript').item.json.city }} )
+ و المنطقة
+ ( {{ $('Code in JavaScript').item.json.zone_name }} )
+ و الحي
+ ( {{ $('Code in JavaScript').item.json.district }} )
+ 
+ بس مش ظابطة.
```

### `Send a text message8` — telegram · 3 إشارة

```diff
- =العميل دا أكد بس عنوانه أهطل أوي  
- 
- {{ $('Update Order → confirmed').item.json.PHONE }}
- رقم العامود
- {{ $('Update Order → confirmed').item.json.row_number }}
- 
- 
- عنوانه اهو 
- {{ $('Update Order → confirmed').item.json.ADDRESS }}
- 
- كلموه انتوا و ظبطوا الدنيا معاه
+ =العميل دا أكد بس عنوانه أهطل أوي  
+ 
+ {{ $('SHIP CTX').item.json.order.PHONE }}
+ رقم العامود
+ {{ $('SHIP CTX').item.json.order.row_number }}
+ 
+ 
+ عنوانه اهو 
+ {{ $('SHIP CTX').item.json.order.ADDRESS }}
+ 
+ كلموه انتوا و ظبطوا الدنيا معاه
```

### `Switch1` — switch · 2 إشارة

```diff
- ={{ $('Get Tenant').item.json.shipping_provider }}
+ ={{ $('SHIP CTX').item.json.tenant.shipping_provider }}
```

### `Ta7leel el Address` — agent · 1 إشارة

```diff
- =أنت مساعد ذكي متخصص في تحليل عناوين الشحن داخل مصر لشركات التوصيل.
- 
- حلل العنوان التالي:
- "{{ $('Update Order → confirmed').item.json.address }}"
- 
- المطلوب:
- 1- تقييم ما إذا كان العنوان "مكتملاً وصالحاً للتوصيل الفعلي لباب العميل" أم "ناقصاً".
- 2- استخراج اسم المحافظة (city).
- 3- استخراج اسم المنطقة التابع ليها العنوان في المحافظة (zone_name).
- 4- استخراج اسم الحي الداخلي (district).
- 
- شروط التقييم الصارمة جداً لـ (status):
- - الحالة [ VALID ]: فقط إذا كان العنوان يحتوي على تفاصيل داخلية دقيقة تسمح للمندوب بالوصول (مثل: اسم منطقة + اسم شارع، أو رقم عمارة، أو علامة مميزة واضحة).
- - الحالة [ INVALID ]: إذا كان العنوان عاماً أو قصيراً ومكوناً من (اسم محافظة فقط، أو مدينة فقط، أو كمبوند/حي فقط) بدون تفاصيل. أمثلة لعناوين يجب أن تعتبرها (INVALID): "مدينة نصر"، "نيو جيزه"، "المعادي"، "اسكندريه العصافره"، "التجمع الخامس". كل هذه عناوين ناقصة ومرفوضة.
- 
- قواعد إملائية إجبارية (تطبق على كل المخرجات):
- - أي كلمة تنتهي بالتاء المربوطة (ة) استبدلها فوراً بالهاء (ه). (مثال: "الدقهلية" تكتب "الدقهليه"، "القاهرة" تكتب "القاهره"، "مدينة" تكتب "مدينه").
- - أي كلمة تنتهي بالألف المقصورة (ى) استبدلها فوراً بالياء (ي). (مثال: "مصطفى" تكتب "مصطفي"، "المعادى" تكتب "المعادي").
- 
- ممنوع كتابة أي نصوص أو شروحات. أعد الرد بصيغة JSON فقط بهذا الهيكل:
- 
- {
-   "status": "VALID أو INVALID",
-   "city": "اسم المحافظه",
-   "zone_name": "اسم المنطقه",
-   "district": "اسم الحي"
- }
+ =أنت مساعد ذكي متخصص في تحليل عناوين الشحن داخل مصر لشركات التوصيل.
+ 
+ حلل العنوان التالي:
+ "{{ $('SHIP CTX').item.json.order.address }}"
+ 
+ المطلوب:
+ 1- تقييم ما إذا كان العنوان "مكتملاً وصالحاً للتوصيل الفعلي لباب العميل" أم "ناقصاً".
+ 2- استخراج اسم المحافظة (city).
+ 3- استخراج اسم المنطقة التابع ليها العنوان في المحافظة (zone_name).
+ 4- استخراج اسم الحي الداخلي (district).
+ 
+ شروط التقييم الصارمة جداً لـ (status):
+ - الحالة [ VALID ]: فقط إذا كان العنوان يحتوي على تفاصيل داخلية دقيقة تسمح للمندوب بالوصول (مثل: اسم منطقة + اسم شارع، أو رقم عمارة، أو علامة مميزة واضحة).
+ - الحالة [ INVALID ]: إذا كان العنوان عاماً أو قصيراً ومكوناً من (اسم محافظة فقط، أو مدينة فقط، أو كمبوند/حي فقط) بدون تفاصيل. أمثلة لعناوين يجب أن تعتبرها (INVALID): "مدينة نصر"، "نيو جيزه"، "المعادي"، "اسكندريه العصافره"، "التجمع الخامس". كل هذه عناوين ناقصة ومرفوضة.
+ 
+ قواعد إملائية إجبارية (تطبق على كل المخرجات):
+ - أي كلمة تنتهي بالتاء المربوطة (ة) استبدلها فوراً بالهاء (ه). (مثال: "الدقهلية" تكتب "الدقهليه"، "القاهرة" تكتب "القاهره"، "مدينة" تكتب "مدينه").
+ - أي كلمة تنتهي بالألف المقصورة (ى) استبدلها فوراً بالياء (ي). (مثال: "مصطفى" تكتب "مصطفي"، "المعادى" تكتب "المعادي").
+ 
+ ممنوع كتابة أي نصوص أو شروحات. أعد الرد بصيغة JSON فقط بهذا الهيكل:
+ 
+ {
+   "status": "VALID أو INVALID",
+   "city": "اسم المحافظه",
+   "zone_name": "اسم المنطقه",
+   "district": "اسم الحي"
+ }
```

### `Ta7leel el Address2` — agent · 1 إشارة

```diff
- =أنت مساعد ذكي متخصص في تحليل عناوين الشحن داخل مصر لشركات التوصيل.
- 
- حلل العنوان التالي:
- "{{ $('Update Order → confirmed').item.json.address }}"
- 
- المطلوب:
- 1- تقييم ما إذا كان العنوان "مكتملاً وصالحاً للتوصيل الفعلي لباب العميل" أم "ناقصاً".
- 2- استخراج اسم المحافظة (city).
- 3- استخراج اسم المنطقة التابع ليها العنوان في المحافظة (zone_name).
- 4- استخراج اسم الحي الداخلي (district).
- 
- شروط التقييم الصارمة جداً لـ (status):
- - الحالة [ VALID ]: فقط إذا كان العنوان يحتوي على تفاصيل داخلية دقيقة تسمح للمندوب بالوصول (مثل: اسم منطقة + اسم شارع، أو رقم عمارة، أو علامة مميزة واضحة).
- - الحالة [ INVALID ]: إذا كان العنوان عاماً أو قصيراً ومكوناً من (اسم محافظة فقط، أو مدينة فقط، أو كمبوند/حي فقط) بدون تفاصيل. أمثلة لعناوين يجب أن تعتبرها (INVALID): "مدينة نصر"، "نيو جيزه"، "المعادي"، "اسكندريه العصافره"، "التجمع الخامس". كل هذه عناوين ناقصة ومرفوضة.
- 
- قواعد إملائية إجبارية (تطبق على كل المخرجات):
- - أي كلمة تنتهي بالتاء المربوطة (ة) استبدلها فوراً بالهاء (ه). (مثال: "الدقهلية" تكتب "الدقهليه"، "القاهرة" تكتب "القاهره"، "مدينة" تكتب "مدينه").
- - أي كلمة تنتهي بالألف المقصورة (ى) استبدلها فوراً بالياء (ي). (مثال: "مصطفى" تكتب "مصطفي"، "المعادى" تكتب "المعادي").
- 
- ممنوع كتابة أي نصوص أو شروحات. أعد الرد بصيغة JSON فقط بهذا الهيكل:
- 
- {
-   "status": "VALID أو INVALID",
-   "city": "اسم المحافظه",
-   "zone_name": "اسم المنطقه",
-   "district": "اسم الحي"
- }
+ =أنت مساعد ذكي متخصص في تحليل عناوين الشحن داخل مصر لشركات التوصيل.
+ 
+ حلل العنوان التالي:
+ "{{ $('SHIP CTX').item.json.order.address }}"
+ 
+ المطلوب:
+ 1- تقييم ما إذا كان العنوان "مكتملاً وصالحاً للتوصيل الفعلي لباب العميل" أم "ناقصاً".
+ 2- استخراج اسم المحافظة (city).
+ 3- استخراج اسم المنطقة التابع ليها العنوان في المحافظة (zone_name).
+ 4- استخراج اسم الحي الداخلي (district).
+ 
+ شروط التقييم الصارمة جداً لـ (status):
+ - الحالة [ VALID ]: فقط إذا كان العنوان يحتوي على تفاصيل داخلية دقيقة تسمح للمندوب بالوصول (مثل: اسم منطقة + اسم شارع، أو رقم عمارة، أو علامة مميزة واضحة).
+ - الحالة [ INVALID ]: إذا كان العنوان عاماً أو قصيراً ومكوناً من (اسم محافظة فقط، أو مدينة فقط، أو كمبوند/حي فقط) بدون تفاصيل. أمثلة لعناوين يجب أن تعتبرها (INVALID): "مدينة نصر"، "نيو جيزه"، "المعادي"، "اسكندريه العصافره"، "التجمع الخامس". كل هذه عناوين ناقصة ومرفوضة.
+ 
+ قواعد إملائية إجبارية (تطبق على كل المخرجات):
+ - أي كلمة تنتهي بالتاء المربوطة (ة) استبدلها فوراً بالهاء (ه). (مثال: "الدقهلية" تكتب "الدقهليه"، "القاهرة" تكتب "القاهره"، "مدينة" تكتب "مدينه").
+ - أي كلمة تنتهي بالألف المقصورة (ى) استبدلها فوراً بالياء (ي). (مثال: "مصطفى" تكتب "مصطفي"، "المعادى" تكتب "المعادي").
+ 
+ ممنوع كتابة أي نصوص أو شروحات. أعد الرد بصيغة JSON فقط بهذا الهيكل:
+ 
+ {
+   "status": "VALID أو INVALID",
+   "city": "اسم المحافظه",
+   "zone_name": "اسم المنطقه",
+   "district": "اسم الحي"
+ }
```

### `Update a row` — supabase · 2 إشارة

```diff
- ={{ $('Update Order → confirmed').item.json.id }}
+ ={{ $('SHIP CTX').item.json.order.id }}
```
```diff
- ={{ $('Update Order → confirmed').item.json.tenant_id }}
+ ={{ $('SHIP CTX').item.json.order.tenant_id }}
```

### `Update a row2` — supabase · 2 إشارة

```diff
- ={{ $('Update Order → confirmed').item.json.id }}
+ ={{ $('SHIP CTX').item.json.order.id }}
```
```diff
- ={{ $('Update Order → confirmed').item.json.tenant_id }}
+ ={{ $('SHIP CTX').item.json.order.tenant_id }}
```

> **الإجمالي: 17 نود · 46 إشارة.**
