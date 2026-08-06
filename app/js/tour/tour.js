// الجولة التعريفية — الخطوات والرسم وحقن الديمو

import { $id } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { financeCurrentTab, financeExpenses, financeSetExpenses, renderFinanceOverview } from '../finance/finance.js';
import { renderMovements, renderProducts, stockMovements, stockProducts, stockSetMovements, stockSetProducts, updateStockStats } from '../stock/stock.js';
import { tourDemoExpenses, tourDemoMovements, tourDemoOrders, tourDemoStock } from './demo-data.js';
import { tourPositionFor } from './position.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { showPage } from '../main.js';
import { currentTenantId, currentUser } from '../auth/auth.js';
import { buildIndexes, doFilter } from '../orders/orders.js';
import { loadBostaInventoryCard, loadMergeCandidates, loadOrdersCards, updateRevenueStats, updateStats } from '../orders/cards.js';
import { openDetail } from '../orders/detail.js';
import { isAdmin } from '../orders/guards.js';
import { all, ordersPeriod, ordersSetAll, ordersSetAllLoaded } from '../orders/state.js';

export var tourActive=false, tourStep=0, tourSavedHTML=null;

// ===== PRODUCT TOUR (interactive walkthrough with demo data) =====
export var TOUR_KEY='sahl_tour_done_';

// العقد الموثّق (CLAUDE.md): sahl_tour_done_<uid> — النسخة القديمة كانت
// بتكتب بالـtenantId، فبنقرا الاتنين عشان أدمن خلّص الجولة قبل كده
// ماياخدهاش تاني بعد التحويل
export function tourDone(){ try{
  var uid = currentUser && currentUser.id;
  return localStorage.getItem(TOUR_KEY+(uid||currentTenantId))==='1'
      || localStorage.getItem(TOUR_KEY+currentTenantId)==='1';
}catch(e){return false;} }

export function markTourDone(){ try{
  var uid = currentUser && currentUser.id;
  localStorage.setItem(TOUR_KEY+(uid||currentTenantId),'1');
}catch(e){ swallow('markTourDone/localStorage.setItem', e); } }

export function tourBackupAndInject(){
  // remember current table + stats; swap in demo data
  tourSavedHTML = $id('tbody') ? $id('tbody').innerHTML : null;
  // حالة الفلاتر والبحث والمدة الحقيقية — الجولة بتفلتر الديمو بنفس doFilter،
  // فبحث/فلتر/مدة قديمة كانت بتخلي جدول الديمو فاضي وخطوات تتخطى في صمت
  window.__tourSavedUI = {
    q:   $id('qinp')?$id('qinp').value:'',
    fst: $id('fst')?$id('fst').value:'',
    fpl: $id('fpl')?$id('fpl').value:'',
    fpy: $id('fpy')?$id('fpy').value:'',
    period: ordersPeriod.type
  };
  if($id('qinp'))$id('qinp').value='';
  if($id('fst'))$id('fst').value='';
  if($id('fpl'))$id('fpl').value='';
  if($id('fpy'))$id('fpy').value='';
  ordersPeriod.type='all';   // الديمو كله يبان مهما كانت تواريخه
  if(window.__syncFilterUI)window.__syncFilterUI();
  // تبويب الماليات على Expenses كان بيخفي أهداف خطوات الماليات
  try{
    if(financeCurrentTab!=='overview'){
      var ovTab=document.querySelector('.stock-tab[data-ftab="overview"]');
      if(ovTab) ovTab.click();
    }
  }catch(e){ swallow('tourBackupAndInject/financeTab', e); }
  window.__tourRealAll = (typeof all!=='undefined') ? all : null;
  window.__tourRealStock = (typeof stockProducts!=='undefined') ? stockProducts : null;
  window.__tourRealMov = (typeof stockMovements!=='undefined') ? stockMovements : null;
  window.__tourRealExp = (typeof financeExpenses!=='undefined') ? financeExpenses : null;
  ordersSetAll(tourDemoOrders());
  stockSetProducts(tourDemoStock());
  stockSetMovements(tourDemoMovements());
  try{ financeSetExpenses(tourDemoExpenses()); }catch(e){ swallow('tourBackupAndInject/tourDemoExpenses', e); }
  try{ buildIndexes && buildIndexes(); }catch(e){ swallow('tourBackupAndInject/buildIndexes', e); }
  try{ updateStats && updateStats(); }catch(e){ swallow('tourBackupAndInject/updateStats', e); }
  try{ updateRevenueStats && updateRevenueStats(); }catch(e){ swallow('tourBackupAndInject/updateRevenueStats', e); }
  try{ renderFinanceOverview && renderFinanceOverview(); }catch(e){ swallow('tourBackupAndInject/renderFinanceOverview', e); }
  try{ updateStockStats && updateStockStats(); }catch(e){ swallow('tourBackupAndInject/updateStockStats', e); }
  try{ renderProducts && renderProducts(); }catch(e){ swallow('tourBackupAndInject/renderProducts', e); }
  try{ renderMovements && renderMovements(); }catch(e){ swallow('tourBackupAndInject/renderMovements', e); }
  try{ doFilter && doFilter(); }catch(e){ swallow('tourBackupAndInject/doFilter', e); }
}

export function tourRestore(){
  if(window.__tourRealAll){ ordersSetAll(window.__tourRealAll); window.__tourRealAll=null; }
  if(typeof window.__tourRealStock!=='undefined'){ try{ stockSetProducts(window.__tourRealStock); }catch(e){ swallow('tourRestore/stockProducts', e); } window.__tourRealStock=undefined; }
  if(typeof window.__tourRealMov!=='undefined'){ try{ stockSetMovements(window.__tourRealMov); }catch(e){ swallow('tourRestore/stockMovements', e); } window.__tourRealMov=undefined; }
  if(typeof window.__tourRealExp!=='undefined'){ try{ financeSetExpenses(window.__tourRealExp); }catch(e){ swallow('tourRestore/financeExpenses', e); } window.__tourRealExp=undefined; }
  // كاش all اتجمّد طول الجولة (أحداث الـRealtime بتتطنش وقتها) — لو كان
  // متحمّل قبلها كامل، الـsnapshot المسترجع بقى قديم وallLoaded=true كانت
  // بتمنع إعادة الجلب، فالماليات والإحصائيات يفضلوا غلط لحد reload
  ordersSetAllLoaded(false);
  // رجوع فلاتر وبحث ومدة التاجر زي ما كانوا قبل الجولة — قبل نداءات
  // إعادة التحميل تحت عشان تقرا الحالة الصح
  var savedUI = window.__tourSavedUI; window.__tourSavedUI = null;
  if(savedUI){
    if($id('qinp'))$id('qinp').value=savedUI.q||'';
    if($id('fst'))$id('fst').value=savedUI.fst||'';
    if($id('fpl'))$id('fpl').value=savedUI.fpl||'';
    if($id('fpy'))$id('fpy').value=savedUI.fpy||'';
    ordersPeriod.type=savedUI.period||'month';
    if(window.__syncFilterUI)window.__syncFilterUI();
  }
  // بعد الجولة: all الحقيقي بقى فاضي (مش بيتحمّل عند البداية) — فنرجّع صفحة الأوردرات
  // الحقيقية من السيرفر بدل ما نحسبها من الذاكرة الفاضية.
  try{ buildIndexes && buildIndexes(); }catch(e){ swallow('tourRestore/buildIndexes', e); }   // يصفّر phoneCounts (all فاضي)
  try{ loadOrdersCards(); }catch(e){ swallow('tourRestore/loadOrdersCards', e); }                 // الكروت + الإيرادات من الـ RPC
  try{ loadMergeCandidates(); }catch(e){ swallow('tourRestore/loadMergeCandidates', e); }
  try{ loadBostaInventoryCard(); }catch(e){ swallow('tourRestore/loadBostaInventoryCard', e); }
  try{ doFilter(); }catch(e){ swallow('tourRestore/doFilter', e); }                        // الجدول: صفحة من السيرفر
}

// ---- the steps ----
export function tourSteps(){
  return [
    {sel:'#s0', page:'orders', title:'كارت إجمالي الطلبات',
     text:'ده بيجمّع كل الأوردرات اللي نزلت الشهر الحالي بكل حالاتها — مؤكدة، ملغية، مرتجعة، تحت التسليم.. كله. الرقم ده نبضة المتجر.'},
    {sel:'#s1', page:'orders', title:'قيد الانتظار',
     text:'الأوردرات اللي لسه محتاجة تأكيد من العميل ومتاخدش فيها أي إجراء. دي أهم خانة لفريق التأكيد — كل ما تقل، كل ما الشغل ماشي.'},
    {sel:'#s2', page:'orders', title:'مؤكدة',
     text:'العميل أكّد الأوردر وجاهز يتشحن (لسه متبعتش لشركة الشحن). من هنا بيروح للتغليف والشحن.'},
    {sel:'#s3', page:'orders', title:'تم التسليم',
     text:'الأوردرات اللي وصلت العميل فعلاً (Delivered). دي الفلوس اللي اتحصّلت بجد.'},
    {sel:'#s4', page:'orders', title:'ملغية',
     text:'اتلغت سواء من العميل أو منك. بنتتبّعها عشان نعرف نسبة الإلغاء وأسبابها.'},
    {sel:'#s5', page:'orders', title:'مرتجعة',
     text:'رجعت بعد ما اتشحنت (مرتجع). دي بتكلّفك فلوس شحن — لو وفّرتها هتزوّد معدّل ربحك بشكل كبير.'},
    {sel:'#s6', page:'orders', title:'نسبة التأكيد',
     text:'= كل اللي دخل رحلة الشحن ÷ كل اللي اتعامل معاه (أي أوردر خرج من قيد الانتظار). حالات الشحن اللاحقة زي التسليم والمرتجع مش بتنزّل النسبة — الرقم بيقيس شطارة فريق التأكيد بس.'},
    {sel:'#s7', page:'orders', title:'نسبة التسليم',
     text:'= المسلَّمة ÷ (المسلَّمة + المرتجعة). بتقيس نجاحك في توصيل اللي اتشحن فعلاً — مش من إجمالي الأوردرات.'},
    {sel:'#qinp', page:'orders', title:'البحث الذكي',
     text:'دوّر بأي حاجة: اسم المنتج، رقم العميل، رقم الطلب، رقم التتبع (البوليصة)، أو حتى بعنوان العميل. اكتب أي جزء وهيرشّحلك على طول.'},
    {sel:'#fst-wrap', page:'orders', title:'فلتر الحالات',
     text:'صفّي الأوردرات حسب الحالة: قيد الانتظار، مؤكدة، مع شركة الشحن دلوقتي، تم التسليم، ملغية، مرتجعة... عشان تركّز على اللي مهم.'},
    {sel:'#fpl-wrap', page:'orders', title:'فلتر المنصة وطريقة الدفع',
     text:'اعرف كل أوردر جه منين — فيسبوك، إنستجرام، تيك توك — وطريقة الدفع (كاش عند الاستلام أو Paymob). مفيد جداً لتقييم إعلاناتك.'},
    {sel:'#dcnt .log-list, #dcnt', page:'orders', title:'تفاصيل كل أوردر + الـ LOG',
     text:'لما تضغط على أي أوردر بيفتحلك تفاصيله كاملة زي ما إنت شايف دلوقتي. أهم حاجة: الـ LOG تحت — تاريخ كامل لكل حاجة حصلت: مين أكّد الأوردر وامتى، مين سجّل خروجه من المخزن لما ضرب البوليصة، ومين لغاه وإيه السبب. كل حركة باسم صاحبها ووقتها.',
     openOrder:'demo-1039', exact:true},
    {sel:'.timer-cell[data-deadline]:not([data-deadline=""])', page:'orders', title:'مواعيد الاتصال (تايمر ساعة ونص)',
     text:'لما الموظف يعمل محاولة اتصال والعميل مايردش، النظام بيبدأ تايمر تنازلي ساعة ونص جنب الأوردر (شوف العمود ده). كده الموظف يعرف بالظبط هيكلّم العميل تاني امتى — من غير ما يفتكر أو يكلّمه بدري ويزهّقه.',
     closeOrder:true, exact:true},
    {sel:'#nav-stock', page:'orders', title:'المخزون',
     text:'تعالى نشوف المخزون.', click:true},
    {sel:'#stock-cards-row', page:'stock', exact:true, title:'كروت المخزون',
     text:'هنا بتشوف عدد المنتجات، إجمالي القطع في المخزن، والمنتجات اللي خلصت. كل ده بيتحدّث أوتوماتيك مع كل بيع أو إرجاع.'},
    {sel:'#page-stock .stock-tabs', page:'stock', title:'حركات المخزون',
     text:'فيه تبويب "حركات المخزون" بيسجّل كل دخول وخروج: خروج لما الأوردر يضرب البوليصة، ودخول لما يرجع. كل حركة بكميتها ووقتها — فمتعرفش تتلغبط في المخزن أبداً.'},
    {sel:'#nav-finance', page:'stock', title:'الماليات',
     text:'دلوقتي أهم جزء — الماليات.', click:true},
    {sel:'#fin-revenue', page:'finance', title:'الماليات — قيمة الطلبات',
     text:'إجمالي قيمة كل الأوردرات في الفترة (بكل الحالات). ده حجم شغلك، مش الفلوس المحصّلة فعلاً.'},
    {sel:'#fin-collected', page:'finance', title:'المتحصّل فعلاً',
     text:'الفلوس اللي دخلت جيبك بجد من الأوردرات المسلَّمة. ده الرقم اللي بيهمك.'},
    {sel:'#fin-net-profit', page:'finance', title:'صافي الربح',
     text:'= المتحصّل − (تكلفة البضاعة + الشحن + التغليف + المصاريف). ده اللي كسبته صح بعد خصم كل حاجة.'},
    {sel:'#fin-cost-section', page:'finance', exact:true, title:'تفكيك التكاليف',
     text:'بنفصّلك فلوسك راحت فين بالظبط: بضاعة، شحن، إعلانات، مرتبات، تغليف... كل بند ونسبته من الإيراد. كدا تعرف فلوسك بتتهدر على إيه وتظبط الأمور أكثر.'}
  ];
}

// جيل الرندر — الـtimeouts المتداخلة من غير إلغاء: نقر سريع (التالي/السابق)
// أو resize كان بيسيب callback خطوة قديمة يرندر فوقة الخطوة الأحدث
var tourRenderGen=0;

export function tourRender(){
  var myGen=++tourRenderGen;
  var steps=tourSteps();
  var s=steps[tourStep];
  if(!s){ tourFinish(); return; }
  // close the order overlay unless this step wants it open
  if(!s.openOrder){ try{ if($id('ovl')) $id('ovl').classList.remove('open'); }catch(e){ swallow('tourRender/$id', e); } }
  // switch page if needed
  if(s.page && typeof showPage==='function'){
    var cur=document.querySelector('.tnav-btn.active');
    var curPage=cur?cur.getAttribute('data-page'):'orders';
    if(curPage!==s.page){ showPage(s.page); }
  }
  // open the order detail for steps that need it (e.g. the LOG step)
  if(s.openOrder){
    try{
      // seed demo stock so openDetail skips its DB query during the tour
      if(!stockProducts || !stockProducts.length){
        stockSetProducts([{id:'d1',name:'تيربو بريمو ٥ دور',current_qty:12,unit_price:1290},
                       {id:'d2',name:'مطبقية ريكي ٢ دور',current_qty:8,unit_price:980},
                       {id:'d3',name:'استاند أمريكانا',current_qty:5,unit_price:1150},
                       {id:'d4',name:'ترابيزة IKEA',current_qty:3,unit_price:1420},
                       {id:'d5',name:'ترولي خشب ايكيا',current_qty:0,unit_price:870}]);
      }
      openDetail(s.openOrder);
    }catch(e){ swallow('tourRender', e); }
  }
  var settleDelay = s.openOrder ? 260 : (s.page?380:60);
  setTimeout(function(){
    if(!tourActive || myGen!==tourRenderGen) return;   // خطوة أحدث خرجت أو الجولة قفلت
    var el=document.querySelector(s.sel);
    if(!el){ // fallback: skip missing target
      tourStep++; if(tourStep>=steps.length){tourFinish();return;} tourRender(); return;
    }
    // highlight the whole card if the target is a value inside a stat card
    if(!s.exact){
      var card=el.closest('.sc, .rev-card, tr');
      if(card) el=card;
    }
    el.scrollIntoView({behavior:'smooth',block:'center'});
    // give smooth-scroll a moment (esp. inside the order overlay) before positioning
    setTimeout(function(){
      if(!tourActive || myGen!==tourRenderGen) return;
      var bubble=document.getElementById('tour-bubble');
      // dots
      var dots=''; for(var i=0;i<steps.length;i++){ dots+='<span class="tour-dot'+(i===tourStep?' active':'')+'"></span>'; }
      var isLast=tourStep===steps.length-1;
      bubble.innerHTML=
        '<div class="tour-step-n">خطوة '+(tourStep+1)+' من '+steps.length+'</div>'
        +'<div class="tour-title">'+s.title+'</div>'
        +'<div class="tour-text">'+s.text+'</div>'
        +'<div class="tour-actions">'
        +'<div class="tour-dots">'+dots+'</div>'
        +'<div class="tour-btns">'
        +(tourStep>0?'<button class="tour-btn prev" data-act="tour-prev">السابق</button>':'<button class="tour-btn skip" data-act="tour-finish">تخطّي</button>')
        +'<button class="tour-btn next" data-act="tour-next">'+(isLast?'تمام، خلصنا':'التالي')+'</button>'
        +'</div></div>';
      tourPositionFor(el, bubble);
    }, 280);
  }, settleDelay);
}

export function tourNext(){ var steps=tourSteps(); tourStep++; if(tourStep>=steps.length){tourFinish();return;} tourRender(); }

export function tourPrev(){ if(tourStep>0){tourStep--; tourRender();} }

export function tourStart(){
  if(typeof isAdmin==='function' && !isAdmin()) return;
  tourActive=true; tourStep=0;
  var center=document.getElementById('tour-center'); if(center)center.style.display='none';
  var ov=document.getElementById('tour-overlay'); ov.classList.add('active');
  tourBackupAndInject();
  tourRender();
}

export function tourFinish(){
  tourActive=false;
  tourRenderGen++;   // إبطال أي timeouts رندر معلّقة
  try{ $id('ovl').classList.remove('open'); }catch(e){ swallow('tourFinish/$id', e); }
  var ov=document.getElementById('tour-overlay'); ov.classList.remove('active');
  // BUGFIX: hide the welcome card too — if the user clicked "Skip" before starting,
  // tourStart() never ran and the welcome modal would stay visible forever.
  var center=document.getElementById('tour-center'); if(center) center.style.display='none';
  markTourDone();
  tourRestore();
  if(typeof showPage==='function') showPage('orders');
  var fab=document.getElementById('tour-fab'); if(fab)fab.style.display='flex';
}

export function tourReopenWelcome(){
  var center=document.getElementById('tour-center');
  if(center) center.style.display='flex';
}

export function tourMaybeAutoStart(){
  if(typeof isAdmin==='function' && !isAdmin()) return;
  // always show the FAB for admins
  var fab=document.getElementById('tour-fab'); if(fab)fab.style.display='flex';
  if(tourDone()) return;
  var center=document.getElementById('tour-center');
  if(center) center.style.display='flex';
}

// reposition on resize while active
// إعادة رسم الجولة عند تغيير المقاس
export function initTourResize(){
  window.addEventListener('resize', function(){ if(tourActive) tourRender(); });
  // expose tour controls for inline onclick handlers (bubble + welcome card)
  // exports الجولة على window اتشالت — الأزرار بقت data-act

  // ===== كروت/تنبيهات صفحة الأوردرات من السيرفر (RPC + كويريهات مخصّصة) =====
  // المدة الحالية بتواريخ القاهرة للـ RPC. NULL = كل الفترات.
}
