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

import { BOSTA_FILTER_STATUSES, buildIndexes, doFilter, ensureAllLoaded, fetchOrdersPage, fetchPhoneCounts, handleRealtimeChange, initNav, initOrdersUI, loadAll, OPERATION_STATUSES, ORDER_LIST_COLS, ordersInPeriod, ordersPeriodRangeISO, positionPeriodInd, refreshCancelBar, refreshOrdersScope, resolveCancelRequest, setOrdersPeriod, showCancelRequested, showRealtimeDot, startRealtime } from './orders/orders.js';
import { _b64ToBlob, printAwbForOrders, printSelectedAwb } from './orders/awb.js';
import { fmtDate, fmtDateTime, fmtMoneyShort, inboxVerified, loadVfcashNumber, lockMaybe, refreshInboxGate, renderBillingSummary, renderInboxLocked, VFCASH_NUMBER } from './orders/billing-summary.js';
import { applyOrdersStats, initReadyCard, loadBostaInventoryCard, loadMergeCandidates, loadOrdersCards, MERGE_QUERY_STATUSES, ordersPeriodCairoDates, updateRevenueStats, updateStats } from './orders/cards.js';
import { hasCostSnapshot, isDeliveredOrder, isWithBosta, loadStockMovementsForOps, loadStockProductsForCosts, movementWholesalePrice, orderCostSnapshotValue, orderInventoryCost, orderInventoryCostSource, orderLiveInventoryCost, ordersInRange, perfSortBy, productCostByName, productExists, renderProductPerformance, shippedOrOperational } from './orders/costs.js';
import { daysShift, daysToday, renderDaysCalendar } from './analytics/days.js';
import { attachFieldEditors, buildWaUrl, computeHistoryFromAll, detailHistory, fieldEditable, intNotesTimer, loadDetailHistory, openDetail, patchOrderField, renderDetail } from './orders/detail.js';
import { enhanceFilters, fdropCloseAll, initFilterDropdowns, initRefreshAndSearch, reflectStatusCards, wireStatusCards } from './orders/filters-ui.js';
import { ensureTenant, isAdmin, requireAdmin } from './orders/guards.js';
import { customerOrderCount, detectMergeable, mergeableCustomers, renderMergeAlert } from './orders/merge.js';
import { addCallAttempt, deleteCallAttempt, doBulkUpdate, doUpdate, saveInternalNotes } from './orders/mutations.js';
import { addEmptyProductRow, buildProductOptions, collectProducts, parseProducts, renderProductsEditor, saveProducts } from './orders/products-editor.js';
import { all, allLoaded, cur, fil, ordersLoading, ordersPeriod, ordersSetAll, ordersSetPageSize, ordersSetSelected, pendingBostaByPhone, phoneCounts, PS, realtimeChannel, realtimeSetChannel, sel, selectedIds, stm, totalCount } from './orders/state.js';
import { refreshSetupChecklist, setupDismiss } from './ui/setup-checklist.js';
import { veilBegin } from './core/veil.js';
import { getCallDeadline, goPage, parseStatusLog, RANK_GOOD, RANK_MID, renderTable, updateBulkBar, updateMasterCb, updateUnprintedBtn } from './orders/table.js';

import { _suspending, applyTenantBranding, bootstrapTenantIfNeeded, currentRole, currentTenant, currentTenantId, currentUser, doLogin, doLogout, doSignup, fetchProfileAndEnter, forceSuspendLogout, hasTenant, initLoginForm, initSignupForm, loadTenantAndEnter, loginErrorMessage, resetTenantBranding, showAuthView, showSubscriptionLock, signupErrorMessage, tenantDisplayName } from './auth/auth.js';

import { TOUR_KEY, initTourResize, markTourDone, tourActive, tourBackupAndInject, tourDone, tourFinish, tourMaybeAutoStart, tourNext, tourPrev, tourRender, tourReopenWelcome, tourRestore, tourSavedHTML, tourStart, tourStep, tourSteps } from './tour/tour.js';

import { SHIPPING_COST_DEFAULT, deleteExpense, expensesInRange, financeChartInstance, financeChartManual, financeChartPeriod, financeCurrentTab, financeExpenses, financeSetExpenses, fmtMoney, initFinanceAndIssues, isConfirmedForFinance, loadFinance, openExpenseEditor, orderShippingCost, pRange, renderExpenses, renderFinance, renderFinanceChart, renderFinanceOverview, unmatchedCogsItems } from './finance/finance.js';

import { NOTIFY_KEYS, TG_LOCK_DAYS, loadNotifyPrefs, loadSettings, renderSettings, saveBosta, saveIntegrations, saveNotifyPref, saveTelegram, saveWaConfirmToggle, saveWhatsApp, sendTelegramConfirm, setNotifyGate, settingsBotUsername, tgChatLocked, toggleSecretVisibility, wireSettingsEvents } from './settings/settings.js';

import { analyticsCurrentTab, analyticsPeriod, buildProductPerformance, getAnalyticsRange, initAnalyticsTabs, loadAnalytics, renderAnalyticsActive, renderFinancePlatforms } from './analytics/analytics.js';

import { _allIssues, buildIssues, loadIssues, renderIssues, renderIssuesTable } from './issues/issues.js';

import { applyDepletionLock, billingTopupFile, loadBilling, loadMyTopupRequests, loadWalletHistory, loadWalletState, renderPlanCards, selectPlan, submitTopupRequest, switchPlan, updateWalletChip, walletStateCache, wireBillingEvents } from './billing/billing.js';

import { currentStockTab, initStockButtons, initStockTabs, loadStock, openMovementEditor, openProductEditor, openStockProductByName, parseMovementDate, recentQtyOutByProduct, renderMovements, renderProducts, renderSmartStockAlerts, stockForecastRows, stockMovements, stockProducts, stockSetMovements, stockSetProducts, updateStockStats } from './stock/stock.js';

import { WA_LABELS, handleWaRealtime, initInbox, loadInbox, openConversation, renderConvos, renderMessages, waActiveId, waAppendOptimistic, waBuildFilters, waClearImage, waConvMatches, waConvos, waDateShort, waDeleteQuickReply, waEnsureNotifyPermission, waFetchConvos, waFetchMessages, waFilter, waInitials, waLabelColor, waLoadConvMeta, waLoadOrders, waLoadQuickReplies, waMarkRead, waNotify, waPendingDoc, waPendingImage, waPickFile, waPickImage, waPollTimer, waQuickReplies, waRefreshNavBadge, waRenderConvLabels, waRenderLabelPicker, waRenderQuickReplies, waRenderedCount, waRenderedState, waResolveUrls, waSaveNote, waSaveQuickReply, waScrollBottom, waSearchQuery, waSend, waSetFilter, waSetNavBadge, waToggleLabel, waUpdateWindow, waUrlCache } from './inbox/inbox.js';

import { maybeShowExpiryBanner, subscriptionLockState } from './billing/expiry.js';

import { copyWebhookUrl } from './settings/webhook.js';

import { askCancelReason } from './orders/cancel-reason.js';

import { tourPositionFor } from './tour/position.js';

import { tourDemoExpenses, tourDemoMovements, tourDemoOrders, tourDemoStock } from './tour/demo-data.js';

import { autoChartGran, financePeriod, getPeriodRange, parseLocalYMD } from './finance/period.js';

import { cleanProductName, extractProductQty, nameKey, normalizeProductName, parseProductItems, stripAlPrefix, tokenSortKey } from './analytics/product-match.js';

import { waMsgInner, waTicks, waTimeShort } from './inbox/message-view.js';

import { attachCopyHandlers, copyTextToClipboard, copyable, fallbackCopy } from './ui/clipboard.js';

import { CALL_WAIT_MS, startTimerTick, tickTimers, timerInterval } from './orders/call-timer.js';

import { showModal } from './core/modal.js';

import { SUPABASE_ANON_KEY, SUPABASE_URL, WEBHOOK_BASE_URL } from './core/config.js';

import { toast } from './core/toast.js';

import { cairoYMD, firstName, fmt, fmtD, fmtDT, fmtDateOnly, fmtMovementDate, fmtStoredDateTime, money, normalizePhone, num, pad2, short, toLatinDigits, val, ymdAddDays } from './core/format.js';

import { BOSTA_EXPECTED_STATUSES, BOSTA_INVENTORY_STATUSES, BOSTA_OPERATION_STATUSES, BOSTA_POSITIVE_STATUSES, CANCELLED_STATUSES, CR, DELIVERED_STATUSES, RETURNED_STATUSES, SL, STATUS_OPTIONS, normStatus, statusClass, statusIn, statusLabel } from './core/constants.js';

import { swallow } from './core/log.js';

import { sb, setSb } from './core/supabase.js';

import { $id, esc } from './core/dom.js';

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
  'tour-reopen': function(){ tourReopenWelcome(); },
  'plan-select': function(el){ selectPlan(el.getAttribute('data-plan')); },
  // CTAs بتوع الحالات الفاضية (core/empty.js)
  'goto-settings': function(){ showPage('settings'); },
  'goto-stock':    function(){ showPage('stock'); },
  'goto-billing':  function(){ showPage('billing'); },
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
  'dark-toggle':   function(){ darkToggle(); }
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
// الكلاس على <html> عشان 22-dark.css يمسك كل حاجة، والتفضيل محفوظ.
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
  // Check if user already has a valid session
  sb.auth.getSession().then(function(res){
    if(res.data && res.data.session){
      fetchProfileAndEnter(res.data.session.user);
    } else {
      $id('login').style.display = 'flex';
    }
  });
}


























































// ── END CALL TIMER ENGINE ────────────────────────────






























// ============================================================================




















export function showPage(page){
  // Finance and Issues are admin-only in code as well, not just hidden by CSS.
  if((page==='finance' || page==='issues' || page==='billing' || page==='analytics') && !isAdmin()){
    toast('القسم ده للأدمن فقط','er');
    page='orders';
  }
  $id('page-orders').style.display  = page==='orders'  ? 'block' : 'none';
  $id('page-stock').style.display   = page==='stock'   ? 'block' : 'none';
  $id('page-finance').style.display = page==='finance' ? 'block' : 'none';
  $id('page-billing').style.display = page==='billing' ? 'block' : 'none';
  if($id('page-settings'))$id('page-settings').style.display = page==='settings' ? 'block' : 'none';
  if($id('page-issues'))$id('page-issues').style.display = page==='issues' ? 'block' : 'none';
  if($id('page-analytics'))$id('page-analytics').style.display = page==='analytics' ? 'block' : 'none';
  if($id('page-inbox'))$id('page-inbox').style.display = page==='inbox' ? 'block' : 'none';
  document.querySelectorAll('.tnav-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-page')===page);
  });
  // أول دخول للتاب في الجلسة: حجاب تحميل بدل الأصفار الكدابة —
  // كل loader بيشيله بـveilDone لما بياناته الأساسية توصل (core/veil.js)
  if(page==='orders'){refreshSetupChecklist();}
  if(page==='stock'){veilBegin('stock');loadStock();}
  if(page==='finance'){veilBegin('finance');loadFinance();}
  if(page==='billing'){veilBegin('billing');loadBilling();}
  if(page==='settings'){veilBegin('settings');loadSettings();}
  if(page==='issues'){veilBegin('issues');loadIssues();}
  if(page==='analytics'){veilBegin('analytics');loadAnalytics();}
  if(page==='inbox'){veilBegin('inbox');loadInbox();}
}













































































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
  initStockTabs();
  initAnalyticsTabs();
  initStockButtons();
wireSettingsEvents();
initFinanceAndIssues();

initApp();
