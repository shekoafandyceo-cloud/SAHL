// توجيه بالمسار — لينك مستقل لكل قسم بدل صفحة واحدة
//
// المبدأ: `showPage` في main.js هي **نقطة الاختناق الوحيدة** للتنقل في اللوحة
// (كل زرار وكل CTA بيعدّي عليها)، فالـURL بيتحدّث من جوّاها ومحدش تاني بيلمسه.
// الموديول ده مالوش حالة غير الجذر، وبيتحسب مرة واحدة وقت التحميل.
//
// ⚠️ الاستضافة **Cloudflare Worker** مش Pages، والآلية **صفحة حقيقية لكل قسم**
// (`app/orders.html` وأخواتها — نسخ بالبايت من `index.html` بيتولّدوا بـ
// `tools/make-route-pages.py`). الاستضافة بتشيل امتداد `.html` تلقائياً
// وبتشيل السلاش الزايدة كمان (اتقاس حيّ: `/probe/` → 307 → `/probe`)، فعنوان
// المستند بيفضل من غير سلاش والمسارات النسبية بتتحل من الجذر صح.
//
// ❌ **مش** `_redirects` (بيخلي رفعة الداشبورد ترفض في صمت — تجربة A/B) ولا
// `assets.not_found_handling` (بيحتاج wrangler، **وبيخلي أي ملف ناقص يرجع
// الصفحة بـ200** فشبكة الأمان «كله أو مفيش» بتموت).
//
// والبوابة تحت بتتأكد إن الاستضافة بتخدم فعلاً قبل ما نكتب أي لينك.

import { swallow } from './log.js';

// slug في اللينك ↔ اسم الصفحة الداخلي.
// الأسماء الإنجليزية اللي المالك اختارها — مش لازم تطابق أسماء الصفحات
// الداخلية (`stock` بقى `inventory` و`inbox` بقى `chats`).
var ROUTES = {
  orders:       'orders',
  inventory:    'stock',
  chats:        'inbox',
  finance:      'finance',
  analytics:    'analytics',
  billing:      'billing',
  settings:     'settings',
  mycommission: 'mycommission'
};

// المعكوس: صفحة → slug
var PAGE_SLUG = {};
(function(){
  for(var s in ROUTES){
    if(Object.prototype.hasOwnProperty.call(ROUTES, s)) PAGE_SLUG[ROUTES[s]] = s;
  }
})();

export var DEFAULT_PAGE = 'orders';

// عنوان التاب لكل صفحة — **نفس تسميات القايمة بالحرف** عشان اللي في التاب
// يطابق اللي التاجر دايس عليه. المفتاح اسم الصفحة الداخلي مش الـslug.
// (صفحة `issues` الميتة مالهاش عنوان — بتقع على الافتراضي.)
var PAGE_TITLES = {
  orders:       'الطلبات',
  stock:        'المخزون',
  inbox:        'المحادثات',
  finance:      'الماليات',
  analytics:    'إحصائيات الأداء',
  billing:      'المحفظة',
  settings:     'الإعدادات',
  mycommission: 'عمولتي'
};
var BRAND = 'سهل';
var DEFAULT_TITLE = 'سهل — لوحة التحكم';

// 🔴 صفحات الأقسام نسخ **بالبايت** من `index.html` (فحص في check.py)، فالعنوان
// الثابت في الـmarkup واحد فيهم كلهم — التفريق لازم يبقى من هنا وقت التشغيل.
// يعني قبل اللوجين التاب بتقول العنوان العام، وبعد ما اللوحة تبان بتتسمّى.
export function setPageTitle(page){
  var t = Object.prototype.hasOwnProperty.call(PAGE_TITLES, page) ? PAGE_TITLES[page] : null;
  try{ document.title = t ? (t + ' · ' + BRAND) : DEFAULT_TITLE; }
  catch(e){ swallow('router/setPageTitle', e); }
}

// ════ تاب مستقلة للمحادثات (طلب المالك 6 سبتمبر) ════
// الصفحة → **اسم ثابت للتاب**. الاسم هو المهم: `window.open` باسم بيعيد
// استخدام نفس التاب، فالضغط 10 مرات بيركّز تاب واحدة مش بيفتح 10.
var OWN_TAB = { inbox: 'sahl-chats' };

function ownTabName(page){
  return Object.prototype.hasOwnProperty.call(OWN_TAB, page) ? OWN_TAB[page] : null;
}

function isOwnTabName(v){
  for(var k in OWN_TAB){
    if(Object.prototype.hasOwnProperty.call(OWN_TAB, k) && OWN_TAB[k] === v) return true;
  }
  return false;
}

// التاب اللي بتعرض المحادثات بتاخد الاسم لنفسها، وبتسيبه لما تخرج منها.
// من غير ده، تاب اتفتحت على اللينك مباشرةً (`/chats`) مش هيبقى ليها اسم،
// فتاب تانية تدوس «المحادثات» تفتح تاب تالتة بدل ما تركّز اللي مفتوحة.
// وبنمسح الاسم **بس لو إحنا اللي حطيناه** — مش بنلمس اسم حطه حد تاني.
export function claimOwnTab(page){
  var name = ownTabName(page);
  try{
    if(name) window.name = name;
    else if(isOwnTabName(window.name)) window.name = '';
  }catch(e){ swallow('router/claimOwnTab', e); }
}

// بترجّع `true` يعني «اتعامل معاها — ماتنقلش في نفس التاب».
// كل مخرج بـ`false` هنا معناه ارجع للتنقّل العادي — الزرار **لازم** يعمل
// حاجة في كل الحالات (درس 16: الزرار اللي مايعملش حاجة أسوأ من الخطأ).
export function openOwnTab(page){
  var name = ownTabName(page);
  if(!name) return false;

  // إحنا التاب دي أصلاً — الضغطة مالهاش معنى، ومانعملش loadInbox على الفاضي
  try{ if(window.name === name) return true; }catch(e){ swallow('router/ownTab.name', e); }

  // الاستضافة مش بتخدم اللينكات العميقة → التاب الجديدة هتطلّع 404
  if(!deepLinksOk) return false;
  var url = routeUrl(page);
  if(!url) return false;

  // 🔴 الموبايل: تاب جديدة هناك معناها الموظف يخرج من اللوحة ومايعرفش يرجع
  // غير من مبدّل التابات. التنقّل العادي أوضح — نفس حد الـ768 بتاع الشِل.
  try{
    if(window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return false;
  }catch(e){ swallow('router/ownTab.mq', e); }

  var w = null;
  // URL فاضية عن قصد: بتركّز التاب الموجودة **من غير ما تنقّلها**، فلو فيه
  // رد نصّه مكتوب مايضيعش. لو مفيش تاب بالاسم ده بتتفتح فاضية ونودّيها.
  try{ w = window.open('', name); }catch(e){ swallow('router/ownTab.open', e); }
  if(!w) return false;   // حاجب النوافذ — نرجع للتنقّل العادي

  try{
    var cur = w.location.href;
    if(!cur || cur === 'about:blank') w.location.href = url;
  }catch(e){
    swallow('router/ownTab.href', e);
    try{ w.location.href = url; }catch(e2){ swallow('router/ownTab.href2', e2); }
  }
  try{ w.focus(); }catch(e){ swallow('router/ownTab.focus', e); }
  return true;
}

// جذر التطبيق — **بيتحسب مرة واحدة** من أول URL وبعدها إحنا اللي بنتحكم في
// كل تنقّل، فمفيش انحراف. بيشتغل على الجذر (app.sahlgedan.com/) وعلى أي
// مجلد فرعي (المعاينة المحلية) بنفس المنطق.
var BASE = (function(){
  var p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '/';
  var i = p.lastIndexOf('/');
  var base = i >= 0 ? p.slice(0, i + 1) : '/';
  // 🔴 `/orders/` بسلاش زايدة: آخر segment **slug مش مجلد**. من غير الشيلة دي
  // الجذر بيبقى `/orders/` وكل لينك بعدها يطلع `/orders/finance` — لينك مخترع
  // مايفتحش. (وأصول الصفحة نفسها بتتحل من عنوان المستند مش من هنا — دي مسؤولية
  // تطبيع السلاش عند الاستضافة.)
  // (من غير regex عمداً — `check.py` بيقرا `$` جوه الـregex كأنه اسم حر، درس 18)
  var trimmed = base.slice(0, base.length - 1);
  var lastSeg = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  if(lastSeg && Object.prototype.hasOwnProperty.call(ROUTES, lastSeg.toLowerCase())){
    base = trimmed.slice(0, trimmed.length - lastSeg.length);
  }
  return base || '/';
})();

export function routeBase(){ return BASE; }

// 🔴 هل الاستضافة بتخدم اللينكات العميقة أصلاً؟
// اللوحة على Cloudflare **Worker** مش Pages، و`_redirects` بإعادة كتابة 200
// ميزة Pages — ممكن تتجاهل. ولو اتجاهلت، أي لينك بنكتبه هيدي 404 عند الريفريش،
// يعني الميزة تبقى **ضارة** مش ناقصة. فالافتراضي إننا **مانلمسش الـURL** لحد
// ما نثبت إن الاستضافة بتخدمه — ساعتها اللوحة بتتصرف زي ما كانت بالظبط.
var deepLinksOk = false;
var PROBE_KEY = 'sahl_deep_links_ok';

export function deepLinksSupported(){ return deepLinksOk; }
export function setDeepLinksSupported(v){ deepLinksOk = !!v; }

// بيتنادى مرة واحدة وقت الإقلاع
export function probeDeepLinks(){
  // **الدليل القاطع**: اتحمّلنا على مسار مش ملف والصفحة اشتغلت → الاستضافة
  // عملت fallback فعلاً. ده بيشمل المسار المعروف (/orders) والمجهول
  // (/kalam-fady) — الاتنين بيثبتوا نفس الحاجة، فمفيش داعي لأي طلب شبكة.
  var here = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '/';
  var rest = (BASE && here.indexOf(BASE) === 0) ? here.slice(BASE.length) : here;
  rest = rest.replace(/^\/+/, '');
  if(rest && rest !== 'index.html'){ deepLinksOk = true; return; }
  // 🔴 الكاش **للنتيجة الموجبة بس**. لو كاشينا السالبة كمان، تاب مفتوح من قبل
  // ما الاستضافة تبقى داعمة كان هيفضل قافل البوابة طول عمره — والمجس نفسه
  // طلب HEAD واحد على 404، تكلفته صفر عملياً. فالميزة بتولّع لوحدها أول
  // ريفريش بعد النشر بدل ما تستنى تاب جديد.
  try{
    if(sessionStorage.getItem(PROBE_KEY) === '1'){ deepLinksOk = true; return; }
  }catch(e){ swallow('router/probe.cache', e); }
  try{
    fetch(BASE + 'orders', { method:'HEAD' }).then(function(r){
      deepLinksOk = !!(r && r.ok);
      if(deepLinksOk){ try{ sessionStorage.setItem(PROBE_KEY, '1'); }catch(e2){} }
    }).catch(function(){ deepLinksOk = false; });
  }catch(e){ swallow('router/probe', e); }
}

export function slugForPage(page){
  return Object.prototype.hasOwnProperty.call(PAGE_SLUG, page) ? PAGE_SLUG[page] : null;
}

export function pageForSlug(slug){
  var s = String(slug || '').replace(/^\/+|\/+$/g, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROUTES, s) ? ROUTES[s] : null;
}

// الصفحة المطلوبة من الـURL الحالي — null لو المسار مش معروف (بيتعامل معاه
// المنادي على إنه الافتراضي)
export function routeFromUrl(){
  var p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '/';
  if(BASE && p.indexOf(BASE) === 0) p = p.slice(BASE.length);
  p = p.replace(/^\/+/, '');
  if(!p || p === 'index.html') return null;
  return pageForSlug(p);
}

export function routeUrl(page){
  var slug = slugForPage(page);
  return slug ? (BASE + slug) : null;
}

// تحديث شريط العنوان ليطابق الصفحة المعروضة.
// `replace` بيستبدل المدخل الحالي بدل ما يضيف واحد جديد — بيتستخدم في
// الإقلاع وفي تصحيح مسار ممنوع (موظف فتح /finance) عشان زرار الرجوع
// مايرجّعهوش لمكان مرفوض في حلقة.
export function syncUrl(page, replace){
  // الاستضافة مش بتخدم اللينكات العميقة → مانكتبش لينك بيدي 404 لو اتعمله
  // ريفريش. اللوحة بتفضل شغالة عادي على المسار اللي هي فيه.
  if(!deepLinksOk) return;
  var url = routeUrl(page);
  // صفحة مالهاش slug (زي `issues` الميتة) — بنسيب الـURL زي ما هو بدل ما
  // نخترعله مسار مايفتحش
  if(!url) return;
  try{
    if(typeof location !== 'undefined' && (location.pathname + location.search) === url) {
      // نفس المسار بالفعل — مفيش داعي لمدخل جديد في التاريخ
      if(!replace) return;
    }
    if(replace) history.replaceState({ page: page }, '', url);
    else history.pushState({ page: page }, '', url);
  }catch(e){ swallow('router/syncUrl', e); }   // file:// بترمي SecurityError
}

// زرار الرجوع/الجاي في المتصفح
export function onPopState(handler){
  try{
    window.addEventListener('popstate', function(){
      handler(routeFromUrl() || DEFAULT_PAGE);
    });
  }catch(e){ swallow('router/onPopState', e); }
}
