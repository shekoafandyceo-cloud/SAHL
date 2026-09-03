// توجيه بالمسار — لينك مستقل لكل قسم بدل صفحة واحدة
//
// المبدأ: `showPage` في main.js هي **نقطة الاختناق الوحيدة** للتنقل في اللوحة
// (كل زرار وكل CTA بيعدّي عليها)، فالـURL بيتحدّث من جوّاها ومحدش تاني بيلمسه.
// الموديول ده مالوش حالة غير الجذر، وبيتحسب مرة واحدة وقت التحميل.
//
// ⚠️ لازم يبقى معاه `_redirects` على Cloudflare Pages (`/* /index.html 200`) —
// من غيره أي فتح مباشر لـ/orders بيدي 404 لأن Pages بيدوّر على ملف بالاسم ده.

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

// جذر التطبيق — **بيتحسب مرة واحدة** من أول URL وبعدها إحنا اللي بنتحكم في
// كل تنقّل، فمفيش انحراف. بيشتغل على الجذر (app.sahlgedan.com/) وعلى أي
// مجلد فرعي (المعاينة المحلية) بنفس المنطق.
var BASE = (function(){
  var p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '/';
  var i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i + 1) : '/';
})();

export function routeBase(){ return BASE; }

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
