// سهل — لوحة تحكم التاجر
//
// الملف ده كان بلوك <script> inline جوه index.html. بقى ES module.
//
// ⚠️ بيعتمد على متغيّرين عامّين من الـCDN (supabase-js و chart.js) بيتحمّلوا
//    بـ<script src> كلاسيكية قبله في index.html. الكلاسيكية بتتنفّذ قبل أي
//    موديول، فـwindow.supabase و Chart متاحين وقت ما الموديول ده يشتغل.
//    متحطّش defer ولا type=module عليهم ومتنقلهمش تحت السطر ده.
//
// الموديول strict تلقائياً — "use strict" تحت زيادة مقصودة عشان الملف
// يفضل صالح لو اتحمّل كسكربت كلاسيك بالغلط.

import { initNav, initOrdersUI, openOrdersForDay, refreshOrdersIfStale } from './orders/orders.js';
import './orders/awb.js';
import './orders/billing-summary.js';
import { initReadyCard } from './orders/cards.js';
import { perfSortBy } from './orders/costs.js';
import { daysShift, daysToday } from './analytics/days.js';
import './orders/detail.js';
import { initFilterDropdowns, initRefreshAndSearch } from './orders/filters-ui.js';
import { isAdmin } from './orders/guards.js';
import './orders/merge.js';
import './orders/mutations.js';
import './orders/products-editor.js';
import { ordersSetPageSize } from './orders/state.js';
import { refreshSetupChecklist, setupDismiss } from './ui/setup-checklist.js';
import { veilBegin } from './core/veil.js';
import './orders/table.js';

import { fetchProfileAndEnter, initLoginForm, initSignupForm } from './auth/auth.js';

import { initTourResize, tourActive, tourFinish, tourNext, tourPrev, tourStart } from './tour/tour.js';

import { initFinanceAndIssues, loadFinance } from './finance/finance.js';

import { loadSettings, wireSettingsEvents } from './settings/settings.js';

import { initAnalyticsTabs, loadAnalytics } from './analytics/analytics.js';

import { loadIssues } from './issues/issues.js';

import './billing/billing.js';

import { initStockButtons, initStockTabs, loadStock } from './stock/stock.js';

import { initInbox, loadInbox, waSetReplyTo } from './inbox/inbox.js';

import './billing/expiry.js';

import { initExceptions, loadJtIssues } from './exceptions/exceptions.js';
import { initWarehouse, loadWarehouse } from './warehouse/warehouse.js';
import { initAlertSound } from './core/alert-sound.js';

import './settings/webhook.js';

import { loadMyCommission, myCommissionEnabled } from './finance/commissions.js';

import './settings/staff.js';

import './orders/cancel-reason.js';

import './tour/position.js';

import './tour/demo-data.js';

import './finance/period.js';

import './analytics/product-match.js';

import './inbox/message-view.js';

import './ui/clipboard.js';

import './orders/call-timer.js';

import './core/modal.js';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './core/config.js';

import { toast } from './core/toast.js';

import './core/format.js';

import './core/constants.js';

import { swallow } from './core/log.js';
import { DEFAULT_PAGE, claimOwnTab, onPopState, probeDeepLinks, routeFromUrl, setPageTitle, syncUrl } from './core/router.js';

import { sb, setSb } from './core/supabase.js';

import { $id } from './core/dom.js';

// تحميل مسطّح: الموديولات دي بتتطلب من main.js مباشرةً عشان المتصفح يكتشفها
// في نفس الدفعة بدل ما يستنى أبوها يتحمّل (Cache-Control: max-age=0 = كل
// تحميل بيعيد التحقق من كل ملف، فكل مستوى في الشجرة = رحلة شبكة زيادة).
// مالهاش أثر على ترتيب التنفيذ — كلهم بيتقيّموا قبل كده من الاستيرادات اللي فوق.
import './core/skeleton.js';
import './core/empty.js';
import './core/loaderr.js';
import './core/code128.js';
import './analytics/rate.js';
import './orders/delivery-score.js';
import './orders/ship.js';
import './orders/jt-health.js';
import './orders/jt-remark.js';
import './orders/jt-awb.js';
import './orders/order-form.js';
import './warehouse/scan-code.js';
import './warehouse/scan-sound.js';
import './warehouse/wh-sounds.js';
import './warehouse/wh-unknown.js';
import './warehouse/wh-admin.js';

// (الموديولات strict تلقائياً — التوجيه القديم اتشال)


// كل كائنات الفترة (ordersPeriod / analyticsPeriod / financePeriod) بتتعدّل
// بخصايصها مش بالاستبدال. الاستبدال كان في اتنين من التلاتة والتالت لأ، فأي
// helper مشترك كان هيشتغل مع واحد ويفشل بصمت مع التانيين. وتحت ES modules
// إسناد لـbinding مستورد بيرمي TypeError صريح.
export function setPeriod(p, type, from, to){
  p.type = type;
  p.from = from || null;
  p.to   = to   || null;
  return p;
}

// ── توجيه الضغطات بالـdata-act ──────────────────────────────────────
// بديل onclick المضمّنة. سببين:
//  1. الـCSP محتاجة 'unsafe-inline' في script-src عشانها — وده بيفتح
//     الباب لأي سكربت محقون في الصفحة
//  2. تحت ES modules الدوال بتبقى في نطاق الموديول مش على window، فأي
//     onclick بيشاور على اسم عام بيموت **وقت الضغط** مش وقت التحميل:
//     مفيش خطأ في أي مكان لحد ما التاجر يدوس الزرار
// الموزّع واحد على document فبيشتغل مع الـmarkup الثابت والمتولّد سوا.
var CLICK_ACTIONS = {
  'reload':      function(){ location.reload(); },
  'tour-start':  function(){ tourStart(); },
  'tour-next':   function(){ tourNext(); },
  'tour-prev':   function(){ tourPrev(); },
  'tour-finish': function(){ tourFinish(); },
  // CTAs بتوع الحالات الفاضية (core/empty.js)
  'goto-settings': function(){ showPage('settings'); },
  'goto-stock':    function(){ showPage('stock'); },
  'setup-dismiss': function(){ setupDismiss(); },
  'add-product':   function(){ var b=$id('add-product-btn'); if(b)b.click(); },
  'add-expense':   function(){ var b=$id('add-expense-btn'); if(b)b.click(); },
  'side-toggle':   function(){ sideToggle(); },
  // فرز جدول أداء المنتجات بالضغط على عنوان العمود
  'perf-sort':     function(el){ perfSortBy(el.getAttribute('data-key')); },
  // كالندر أداء الأيام
  'days-prev':     function(){ daysShift(-1); },
  'days-next':     function(){ daysShift(1); },
  'days-today':    function(){ daysToday(); },
  'day-open':      function(el){ openOrdersForDay(el.getAttribute('data-ymd')); },
  // إعادة محاولة تحميل الصفحة الحالية بعد فشل السحب (core/loaderr.js)
  'retry-load':    function(){
    var a = document.querySelector('.tnav-btn.active');
    showPage(a ? a.getAttribute('data-page') : 'orders');
  },
  'dark-toggle':   function(){ darkToggle(); },
  // «رد على رسالة» في شات الواتساب — الزرار بيتولّد مع كل فقاعة، والموزّع
  // واحد على document فبيلحق المتولّد زي الثابت
  'wa-reply':      function(el){ waSetReplyTo(el.getAttribute('data-mid')); }
};
function initClickActions(){
  document.addEventListener('click', function(ev){
    var t = ev.target;
    if(!t || !t.closest) return;
    var el = t.closest('[data-act]');
    if(!el) return;
    var name = el.getAttribute('data-act');
    var fn = CLICK_ACTIONS[name];
    if(!fn){ swallow('clickActions', new Error('data-act مش معروف: ' + name)); return; }
    fn(el, ev);
  });
}

// ── طيّ/فرد السايدبار ──────────────────────────────────────────────
// أيقونات بس أو أيقونات + أسامي. التفضيل بيتحفظ ويترجع مع كل دخول.
// ديسكتوب بس — على الموبايل القايمة شريط أفقي والزرار مخفي من الـCSS.
function sideToggle(){
  var sn = $id('sidenav'); if(!sn) return;
  var on = sn.classList.toggle('collapsed');
  try{ localStorage.setItem('sahl_side_collapsed', on ? '1' : '0'); }catch(e){}
}
function initSideCollapse(){
  try{
    if(localStorage.getItem('sahl_side_collapsed') === '1'){
      var sn = $id('sidenav'); if(sn) sn.classList.add('collapsed');
    }
  }catch(e){}
}

// ── الوضع الليلي ────────────────────────────────────────────────────
// الكلاس على <html> عشان 24-dark.css يمسك كل حاجة، والتفضيل محفوظ.
// ألوان Chart.js مش CSS فبتتظبط هنا — الرسم البياني بيترندر من جديد
// مع كل فتح لصفحة الماليات فبياخد القيم الجديدة.
function applyDark(on){
  document.documentElement.classList.toggle('dark', on);
  if(window.Chart){
    window.Chart.defaults.color = on ? '#9aa7bd' : '#666';
    window.Chart.defaults.borderColor = on ? 'rgba(154,167,189,.14)' : 'rgba(0,0,0,.1)';
  }
}
function darkToggle(){
  var on = !document.documentElement.classList.contains('dark');
  applyDark(on);
  try{ localStorage.setItem('sahl_dark', on ? '1' : '0'); }catch(e){}
}
function initDarkMode(){
  try{ if(localStorage.getItem('sahl_dark') === '1') applyDark(true); }catch(e){}
}



















function initApp(){
  setSb(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storage:window.localStorage, storageKey:'sb-auth'}
  }));
  var savedPs=localStorage.getItem('sb_ps');
  if(savedPs){var _ps=parseInt(savedPs); if([25,50,100,200].indexOf(_ps)<0)_ps=50; ordersSetPageSize(_ps); var el=$id('psize'); if(el)el.value=String(_ps);}
  // رسالة الإيقاف من forceSuspendLogout — بتتسلم عبر sessionStorage لأن
  // الخروج بقى reload كامل والحالة القديمة كلها بتتمسح معاه
  var suspendMsg = null;
  try{
    if(sessionStorage.getItem('sahl_suspend_msg')){
      sessionStorage.removeItem('sahl_suspend_msg');
      suspendMsg = '⚠️ تم إيقاف الاشتراك. تواصل مع الدعم لإعادة التفعيل.';
    }
  }catch(e){ swallow('initApp/sessionStorage', e); }
  // Check if user already has a valid session
  sb.auth.getSession().then(function(res){
    if(res.data && res.data.session){
      fetchProfileAndEnter(res.data.session.user);
    } else {
      $id('login').style.display = 'flex';
      if(suspendMsg) $id('login-err').textContent = suspendMsg;
    }
  });
}


























































// ── END CALL TIMER ENGINE ────────────────────────────






























// ============================================================================




















export function showPage(page, opts){
  var requested = page;   // اللي اتطلب فعلاً — للتفريق بين تنقّل عادي وتصحيح حارس
  // 🔴 المحاسبة اتلغت (19 سبتمبر) — السيستم بقى خاص بـ3ataba وحدها فمفيش
  // باقات ولا محفظة يتفرّج عليهم. صفحة المحفظة اتشالت من الـmarkup (v79)
  // والموديول فاضل لأن `walletStateCache` بتغذّي قفل النفاد في 6 ملفات —
  // ده الحارس للينك المباشر القديم.
  if(page==='billing'){ page='orders'; }
  // Finance and Issues are admin-only in code as well, not just hidden by CSS.
  if((page==='finance' || page==='issues' || page==='analytics') && !isAdmin()){
    toast('القسم ده للأدمن فقط','er');
    page='orders';
  }
  // «عمولتي» متاحة بس لمين عمولته مفعّلة — الأدمن عنده الصورة الكاملة
  // في الماليات فمش محتاج نسخة مصغّرة
  if(page==='mycommission' && !myCommissionEnabled()){ page='orders'; }
  $id('page-orders').style.display  = page==='orders'  ? 'block' : 'none';
  $id('page-stock').style.display   = page==='stock'   ? 'block' : 'none';
  $id('page-finance').style.display = page==='finance' ? 'block' : 'none';
  if($id('page-settings'))$id('page-settings').style.display = page==='settings' ? 'block' : 'none';
  if($id('page-issues'))$id('page-issues').style.display = page==='issues' ? 'block' : 'none';
  if($id('page-analytics'))$id('page-analytics').style.display = page==='analytics' ? 'block' : 'none';
  if($id('page-inbox'))$id('page-inbox').style.display = page==='inbox' ? 'block' : 'none';
  if($id('page-exceptions'))$id('page-exceptions').style.display = page==='exceptions' ? 'block' : 'none';
  if($id('page-warehouse'))$id('page-warehouse').style.display = page==='warehouse' ? 'block' : 'none';
  if($id('page-mycommission'))$id('page-mycommission').style.display = page==='mycommission' ? 'block' : 'none';
  document.querySelectorAll('.tnav-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-page')===page);
  });
  // أول دخول للتاب في الجلسة: حجاب تحميل بدل الأصفار الكدابة —
  // كل loader بيشيله بـveilDone لما بياناته الأساسية توصل (core/veil.js)
  if(page==='orders'){refreshSetupChecklist(); refreshOrdersIfStale();}
  if(page==='stock'){veilBegin('stock');loadStock();}
  if(page==='finance'){veilBegin('finance');loadFinance();}
  if(page==='settings'){veilBegin('settings');loadSettings();}
  if(page==='issues'){veilBegin('issues');loadIssues();}
  if(page==='analytics'){veilBegin('analytics');loadAnalytics();}
  if(page==='inbox'){veilBegin('inbox');loadInbox();}
  if(page==='exceptions'){veilBegin('exceptions');loadJtIssues();}
  if(page==='warehouse'){veilBegin('warehouse');loadWarehouse();}
  if(page==='mycommission'){loadMyCommission();}
  // بالاستبدال مش بالإضافة في حالتين: تصحيح مسار ممنوع (عشان زرار الرجوع
  // مايرجّعش لنفس المرفوض في حلقة)، والإقلاع.
  // عنوان التاب بيتحدّث مع الصفحة المعروضة فعلاً (بعد الحراسات) — نفس منطق
  // الـURL بالظبط: تاب بتقول «الماليات» وفيها أوردرات = عنوان بيكدب.
  // ومابيتستثناش في الجولة: بيوصف اللي باين قدام التاجر وده صح في الحالتين.
  setPageTitle(page);
  // اسم التاب (للمحادثات) — مستثنى في الجولة عشان مرورها على المحادثات
  // مايخطفش دور «تاب الشات» لتاب التاجر اللي شغال عليها
  if(!tourActive) claimOwnTab(page);
  // الـURL بيتحدّث هنا **بعد** حراسات الأدمن فوق — يعني لو موظف طلب
  // /finance واتحوّل لorders، اللينك بيتصحّح معاه ومايفضلش بيكدب.
  if(!tourActive) syncUrl(page, (opts && opts.replace) || page !== requested);
}

// الصفحة الأولى بعد الدخول — بتتقرا من اللينك اللي التاجر فتحه.
// بتتنادى من `loadTenantAndEnter` بعد ما اللوحة تبان.
export function applyInitialRoute(){
  probeDeepLinks();   // بيحدد إذا كنا هنكتب لينكات أصلاً — قبل أول showPage
  showPage(routeFromUrl() || DEFAULT_PAGE, { replace: true });
}

// زرار الرجوع/الجاي في المتصفح — بيعرض الصفحة من غير ما يضيف مدخل جديد
onPopState(function(page){ showPage(page, { replace: true }); });













































































// Auto-init on page load — no setup screen needed
// ── ترتيب التشغيل ────────────────────────────────────────────────
// كان ضمنياً بترتيب السطور في الملف: أي نقل نود أو تقسيم لموديولات
// كان بيغيّره في صمت. بقى صريح ومقصود. الترتيب هنا = الترتيب اللي
// كان بيحصل فعلاً قبل التغيير.
initClickActions();
initSideCollapse();
initDarkMode();
initReadyCard();
initTourResize();
initLoginForm();
initSignupForm();
initRefreshAndSearch();
initFilterDropdowns();
initOrdersUI();
  initNav();
  initInbox();
  initExceptions();
  initWarehouse();
  initAlertSound();
  initStockTabs();
  initAnalyticsTabs();
  initStockButtons();
wireSettingsEvents();
initFinanceAndIssues();

initApp();
