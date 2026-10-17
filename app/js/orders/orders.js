// الأوردرات — الحالة والتحميل والجدول والتفاصيل والتحديث الجماعي والريل-تايم

import { skelTable } from '../core/skeleton.js';
import { loadMyCommission, myCommissionEnabled, refreshMyCommissionNav } from '../finance/commissions.js';
import { currentTenantId, currentUser, forceSuspendLogout } from '../auth/auth.js';
import { loadWalletState } from '../billing/billing.js';
import { BOSTA_OPERATION_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusLabel } from '../core/constants.js';
import { $id } from '../core/dom.js';
import { cairoYMD, normalizePhone, num, ymdAddDays } from '../core/format.js';
import { swallow } from '../core/log.js';
import { openOwnTab } from '../core/router.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { handleWaRealtime, waRefreshNavBadge } from '../inbox/inbox.js';
import { setPeriod, showPage } from '../main.js';
import { renderMovements, renderProducts, stockMovements, stockProducts, stockSetMovements, updateStockStats } from '../stock/stock.js';
import { tourActive, tourMaybeAutoStart } from '../tour/tour.js';
import { printSelectedAwb } from './awb.js';
import { loadBostaInventoryCard, loadMergeCandidates, loadOrdersCards } from './cards.js';
import { detailAbort, renderDetail } from './detail.js';
import { deliveryScoreSection } from './delivery-score.js';
import { reflectStatusCards, wireStatusCards } from './filters-ui.js';
import { ensureTenant } from './guards.js';
import { doBulkUpdate } from './mutations.js';
import { all, allLoaded, cur, fil, ordersPeriod, ordersSetAll, ordersSetAllLoaded, ordersSetFiltered, ordersSetPage, ordersSetPageSize, ordersSetPendingBosta, ordersSetPhoneCounts, ordersSetSelected, ordersSetTotalCount, pendingBostaByPhone, phoneCounts, PS, realtimeChannel, realtimeSetChannel, sel, selectedIds, totalCount } from './state.js';
import { parseStatusLog, renderTable, updateBulkBar, updateUnprintedBtn } from './table.js';
import { initShipTicker } from './ship.js';
import { initJtHealth } from './jt-health.js';
import { initOrderForm } from './order-form.js';
import { jtRefreshNavBadge, jxNoteOrderChange } from '../exceptions/exceptions.js';
import { whRefreshNavBadge } from '../warehouse/warehouse.js';

export function ordersInPeriod(){
  var p=ordersPeriod;
  if(p.type==='all') return all.slice();
  var today=cairoYMD(new Date()), fromY, toY;   // inclusive YYYY-MM-DD bounds
  if(p.type==='last3'){ fromY=ymdAddDays(today,-2); toY=today; }            // أخر 3 أيام (شامل النهاردة)
  else if(p.type==='month'){ fromY=today.slice(0,7)+'-01'; toY=today.slice(0,7)+'-31'; } // الشهر الحالي
  else if(p.type==='last30'){ fromY=ymdAddDays(today,-29); toY=today; }      // أخر 30 يوم
  else if(p.type==='custom'){ fromY=p.from||'2000-01-01'; toY=p.to||'2999-12-31'; if(fromY>toY){ var t=fromY; fromY=toY; toY=t; } }
  else return all.slice();   // 'all'
  return all.filter(function(o){ if(!o.created_at)return false; var y=cairoYMD(o.created_at); return y>=fromY && y<=toY; });
}

export function setOrdersPeriod(type){
  ordersPeriod.type=type;
  var bar=$id('orders-period-bar');
  if(bar) bar.querySelectorAll('.pseg-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-period')===type); });
  var cust=$id('orders-period-custom'); if(cust) cust.classList.toggle('show', type==='custom');
  positionPeriodInd();
  if(type!=='custom') refreshOrdersScope();   // custom waits for the "تطبيق" button
}

export function positionPeriodInd(){
  var bar=$id('orders-period-bar'); if(!bar) return;
  var seg=bar.querySelector('.pseg'); if(!seg) return;
  var ind=seg.querySelector('.pseg-ind'), act=seg.querySelector('.pseg-btn.active');
  if(!ind||!act) return;
  if(act.offsetWidth===0){ seg.classList.remove('has-ind'); return; }  // bar hidden → keep CSS fallback
  ind.style.transform='translate('+act.offsetLeft+'px,'+act.offsetTop+'px)';
  ind.style.width=act.offsetWidth+'px';
  ind.style.height=act.offsetHeight+'px';
  seg.classList.add('has-ind');
}

export function refreshOrdersScope(){
  try{ loadOrdersCards(); }catch(e){ swallow('refreshOrdersScope/loadOrdersCards', e); }
  try{ doFilter(); }catch(e){ swallow('refreshOrdersScope/doFilter', e); }
}

// فتح يوم واحد في جدول الأوردرات — بيتنادى من كالندر أداء الأيام.
// المدة بتتحوّل لـ«مخصص» من اليوم ده لليوم ده بالظبط.
//
// حدود اليوم متطابقة بين الاتنين عن قصد: الكالندر بيجمّع بتاريخ الجهاز
// (`new Date(created_at).getDate()`) و`ordersPeriodRangeISO` بتبني حدود
// custom بنص ليل الجهاز كمان — فاليوم اللي اتضغط بيوري بالظبط الأوردرات
// اللي الكالندر عدّها. (كروت الإحصاء فوق بتحسب بتوقيت القاهرة من الـRPC،
// فبرّه مصر ممكن يبان فرق أوردر أو اتنين — بند مؤجّل موثّق.)
export function openOrdersForDay(ymd){
  if(!ymd || tourActive) return;
  showPage('orders');          // الأول: شريط المدة لازم يبقى ظاهر عشان مؤشّر الـpill يتقاس صح
  var f=$id('op-from'), t=$id('op-to');
  if(f) f.value=ymd;
  if(t) t.value=ymd;
  setPeriod(ordersPeriod, 'custom', ymd, ymd);
  setOrdersPeriod('custom');   // بتظبّط الشريط وبتفتح صف التواريخ — ومابتجيبش (custom بيستنى «تطبيق»)
  refreshOrdersScope();        // فالجلب بيتنادى من هنا صراحةً
}

// تحميل كل الأوردرات للذاكرة عند الحاجة فقط (الماليات/الإحصائيات بتحسب على كل الفترة).
// الـcb بياخد باراميتر err: لو السحب فشل في النص، اللي نادى لازم مايرندرش
// أرقام ناقصة كأنها حقيقية. وفيه طابور مشترك — فتح الماليات والأداء ورا
// بعض كان بيبدأ سحبتين كاملتين متوازيتين لنفس الجدول.
var allLoadingCbs = null;

// الأعمدة اللي الماليات والإحصائيات بتقرا منها فعلاً — مش `*`.
//
// `select('*')` كان بيجيب ~3 ميجا لـ2,600 أوردر، **نصها `status_log`**
// (سجل تغيير الحالة) وهو مش مقروء من `all` خالص — بيتقرا من `sel` بعد
// فتح الأوردر ومن صفحة الجدول. النتيجة كانت تحميل بطيء محسوس على كل
// دخول للماليات أو الإحصائيات.
//
// ⚠️ أي حقل جديد تقراه الماليات/الإحصائيات/الكالندر من `all` **لازم
// يتضاف هنا** — من غيره بيرجع `undefined` والأرقام تطلع غلط **في صمت**.
// (الجرد اتعمل بمقارنة كل رقم مرندَر قبل وبعد التضييق، مش بالقراءة بس.)
// أعمدة الـsnapshot الاحتياطية في `orderCostSnapshotValue`
// (product_cost_snapshot / products_cost_snapshot / manufacturer_cost_snapshot)
// **مش موجودة في الجدول** — طلبها من PostgREST بيرمي خطأ، وهي أصلاً
// `undefined` مع `*` برضه.
var ALL_COLS = 'id,created_at,status,total_cost,product_name,payment_stage,platform,phone,tracking_no,real_shipping_fee,inventory_cost_snapshot,inventory_value_snapshot,inventory_value_at_bosta,has_upsell';

export function ensureAllLoaded(cb){
  if(tourActive){ cb&&cb(); return; }            // الجولة: all = بيانات ديمو محمّلة بالفعل
  if(allLoaded){ cb&&cb(); return; }
  if(!sb||!currentTenantId){ cb&&cb(); return; }
  if(allLoadingCbs){ if(cb)allLoadingCbs.push(cb); return; }   // سحبة شغالة — استنى معاها
  allLoadingCbs = cb ? [cb] : [];
  function finish(err){
    var cbs = allLoadingCbs || []; allLoadingCbs = null;
    cbs.forEach(function(f){ try{ f(err); }catch(e){ swallow('ensureAllLoaded/cb', e); } });
  }
  function fail(err){ toast('خطأ في تحميل البيانات: '+(err.message||err),'er'); finish(err); }

  // ⚠️ مهم: select() من غير range بيتوقف عند سقف PostgREST (١٠٠٠ صف) في صمت —
  // وده كان بيخلّي الماليات والإحصائيات تتحسب على جزء من البيانات من غير أي تحذير.
  // الدفعة الأولى بتجيب العدد الكلي معاها، والباقي بيتسحب **بالتوازي** —
  // كانت متسلسلة (دفعة تستنى اللي قبلها) فوقت التحميل كان بيتضاعف مع النمو.
  var CHUNK = 1000, MAXROWS = 200000;
  function chunkAt(from, withCount){
    var q = withCount
      ? sb.from('orders').select(ALL_COLS, {count:'exact'})
      : sb.from('orders').select(ALL_COLS);
    return q.eq('tenant_id',currentTenantId)
            .order('created_at',{ascending:false})
            .range(from, from + CHUNK - 1);
  }
  function done(parts){
    var acc = [].concat.apply([], parts);
    // dedupe بالـid: أوردر جديد بيوصل أثناء السحب بيزحزح الـoffset فصف
    // الحدود بيتكرر بين دفعتين والماليات تحسبه مرتين. (النقص النادر
    // بنفس الآلية مابيتصلحش هنا — بيتصلح مع أول إعادة جلب)
    var seenIds={}, dedup=[];
    for(var ai=0;ai<acc.length;ai++){ var rw=acc[ai]; if(rw&&rw.id){ if(seenIds[rw.id])continue; seenIds[rw.id]=1; } dedup.push(rw); }
    ordersSetAll(dedup); ordersSetAllLoaded(true);
    try{ buildIndexes(); }catch(e){ swallow('ensureAllLoaded/buildIndexes', e); }   // phoneCounts كامل
    finish(null);
  }
  chunkAt(0, true).then(function(r){
    if(r.error){ fail(r.error); return; }
    var first = r.data || [];
    var total = (typeof r.count === 'number') ? Math.min(r.count, MAXROWS) : first.length;
    if(first.length < CHUNK || total <= CHUNK){ done([first]); return; }
    var rest = [];
    for(var f = CHUNK; f < total; f += CHUNK) rest.push(chunkAt(f, false));
    Promise.all(rest).then(function(rs){
      for(var i=0;i<rs.length;i++){ if(rs[i].error){ fail(rs[i].error); return; } }
      done([first].concat(rs.map(function(x){ return x.data || []; })));
    });
  });
}

// عدد طلبات كل عميل لصفحة الجدول الحالية (شارة العميل المتكرر) — كويري صغير بدل تحميل الكل
export function fetchPhoneCounts(rawPhones, cb){
  if(tourActive || !sb || !currentTenantId || !rawPhones || !rawPhones.length){ cb&&cb(); return; }
  sb.from('orders').select('phone').eq('tenant_id',currentTenantId).in('phone',rawPhones).then(function(r){
    if(!r.error && r.data){
      var c={};
      r.data.forEach(function(o){ var p=normalizePhone(o.phone); if(p) c[p]=(c[p]||0)+1; });
      Object.keys(c).forEach(function(k){ phoneCounts[k]=c[k]; });
    }
    cb&&cb();
  });
}

// 🔴 بيانات صفحة الأوردرات بتتجاب بس وهي ظاهرة (v79): تاب المحادثات وتاب السكانر
// مفتوحين طول اليوم، وكل رشقة ريل-تايم على orders كانت بتجيب الكروت والدمج
// والبضاعة والجدول (~8 نداءات) في كل تاب. الصفحة مش ظاهرة (أو التاب في الخلفية) =
// علامة «قديمة» وبتتجاب أول ما الصفحة تبان (showPage('orders') · رجوع التاب).
// ⚠️ تحديث `fil` من الحدث نفسه (handleRealtimeChange) زي ما هو — وtoast الحالة بيطلع للصفوف اللي في الجدول
// المتحمّل بس (تاب فتحت على المحادثات مالهاش جدول لحد ما الأوردرات تتفتح) · toast الأوردر الجديد في كل تاب.
var ordersStale = false;
function ordersShown(){ var p=$id('page-orders'); return !!(p && p.style.display!=='none' && !document.hidden); }
export function refreshOrdersIfStale(){
  if(!ordersStale || tourActive || !ordersShown()) return;
  ordersStale = false;
  refreshOrdersLight();
  if(fil.length) fetchOrdersPage(); else doFilter();   // fetchOrdersPage بيحافظ على الصفحة اللي الموظف واقف عليها
}

// الكروت (sahl_orders_stats) + تنبيه الدمج + كارت البضاعة — «الخفيف» (بضع KB) من غير صفحة الجدول (~320 KB لـ200 صف)
var rtLastLightAt = 0;
function refreshOrdersLight(){
  rtLastLightAt = Date.now();
  loadOrdersCards(); loadMergeCandidates(); loadBostaInventoryCard();
}

export function loadAll(){
  // بانر «مزامنة J&T واقفة» للأدمن — بعد الدخول (initNav بيشتغل قبل ما sb يجهز) ومع كل ↻
  initJtHealth();
  if(!ensureTenant())return;
  selectedIds.clear();updateBulkBar();
  // مش بنحمّل كل الأوردرات عند البداية — صفحة الأوردرات كلها من السيرفر.
  // all يتحمّل lazily بس لما الماليات أو الإحصائيات تتفتح.
  ordersSetAll([]); ordersSetAllLoaded(false);
  // شريط عمولة الموظف + زرار «عمولتي» — بيتحمّلوا مرة مع أول تحميل للطلبات.
  // بيرجعوا بدري لو العمولة مش مفعّلة، فمفيش نداء زيادة على أغلب التجار.
  // 🔴 loadMyCommission (الصفحة + الشريط) مش loadCommissions(الشريط بس): applyInitialRoute بقت قبل loadAll (v79)،
  // فعلى لينك /mycommission نداء الصفحة بيطلع الأول ونداءنا بيبقى الأحدث (cmGen) — لو رسم الشريط بس، الصفحة تفضل «—»
  if(myCommissionEnabled()){ refreshMyCommissionNav(); loadMyCommission(); }
  if(ordersShown()){
    ordersStale = false;
    // الكروت (s0..s7 + الإيرادات + عدّاد المدة من RPC) · تنبيه الدمج (merge_candidates_v1) · كارت البضاعة
    refreshOrdersLight();
    doFilter();                // الجدول: صفحة واحدة من السيرفر
  } else ordersStale = true;   // بتتجاب أول ما صفحة الأوردرات تبان
  startRealtime();
  waRefreshNavBadge();       // عدّاد المحادثات غير المقروءة على زرار التبويب
  jtRefreshNavBadge();       // عدّاد «استثناءات الشحن» اللي محتاجة متابعة (وبيفتح الريل-تايم بتاعها)
  whRefreshNavBadge();       // عدّاد «سكانر المخزن» (اسحب من «جاهز للشحن» · رجع ومااتضربش — والأدمن: خرج من غير سكان)
  loadWalletState();         // للجميع (أدمن + موظف) — للقفل عند نفاد الرصيد
  try{ tourMaybeAutoStart(); }catch(e){ swallow('loadAll/tourMaybeAutoStart', e); }
}

// الاتصال وقع قبل كده في الجلسة دي؟ — بيحدّد إن رجوعه يستاهل جلب تعويضي
var rtEverOff = false;

export function startRealtime(){
  // Remove any existing channel before creating a new one
  if(realtimeChannel){
    sb.removeChannel(realtimeChannel);
    realtimeSetChannel(null);
  }
  realtimeSetChannel(sb
    .channel('orders-realtime-'+currentTenantId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      handleRealtimeChange(payload);
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'stock_products',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      if(tourActive) return;   // stockProducts وقتها ديمو
      // Update in-memory stock products when qty changes (e.g. after scanner deduction)
      if(payload.new && stockProducts){
        for(var i=0;i<stockProducts.length;i++){
          if(stockProducts[i].id === payload.new.id){
            stockProducts[i] = Object.assign(stockProducts[i], payload.new);
            break;
          }
        }
        // If stock page is open, refresh it silently
        if($id('page-stock').style.display !== 'none'){
          updateStockStats();
          loadBostaInventoryCard();
          renderProducts();
        }
      }
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'stock_movements',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      if(tourActive) return;   // stockMovements وقتها ديمو — الحركة الحقيقية كانت بتضيع مع الاسترجاع
      // Add new movement to in-memory list and re-render if stock page open
      if(payload.new){
        if(!stockMovements) stockSetMovements([]);
        // dedupe بالـid: رد loadStock ممكن يكون شايل الحركة بالفعل والحدث
        // يوصل بعده — كانت بتتكرر في القايمة وتدخل توقع الـ7 أيام مرتين
        var mvDup=false;
        for(var mi=0;mi<stockMovements.length;mi++){ if(stockMovements[mi].id===payload.new.id){ mvDup=true; break; } }
        if(!mvDup) stockMovements.unshift(payload.new);
        if($id('page-stock').style.display !== 'none') renderMovements();
      }
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'tenants',
      filter: 'id=eq.'+currentTenantId
    }, function(payload){
      // Instant suspension: if the super admin deactivates this tenant,
      // force-logout immediately without waiting for a page refresh.
      if(payload.new && payload.new.active === false){
        forceSuspendLogout();
        return;
      }
      // Wallet balance changed (super admin top-up/adjust, or plan switch) → refresh wallet state immediately
      if(payload.new && payload.old && (
        payload.new.wallet_balance !== payload.old.wallet_balance
        || payload.new.plan !== payload.old.plan
        || payload.new.overdraft_limit !== payload.old.overdraft_limit
      )){
        loadWalletState();  // refresh for everyone — depletion lock applies to all roles
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'wa_messages',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      handleWaRealtime(payload);
    })
    .subscribe(function(status){
      if(status === 'SUBSCRIBED'){
        // 🔴 رجوع الاتصال بعد قطع = فترة عمياء: كل حدث حصل والـsocket
        // مقفول ضاع للأبد (مفيش replay في postgres_changes). فأول ما
        // يرجع بنجيب الصفحة والكروت من السيرفر — من غير ده الموظف بيفضل
        // على حالات قديمة والنقطة خضرا، وده أسوأ من نقطة حمرا.
        var wasOff = rtEverOff;
        showRealtimeDot(true);
        if(wasOff){ rtEverOff = false; rtNeedLight = true; rtNeedPage = true; scheduleRealtimeRefresh(); loadWalletState(); }   // tenants مالهاش replay — المحفظة بتتقرا تاني بعد القطع
      } else if(status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
        rtEverOff = true;
        showRealtimeDot(false);
      }
    }));
}

// تجميع أحداث الـRealtime: كل حدث كان بيطلق 5 طلبات (كروت + دمج + بضاعة
// + جدول + محفظة) وبيرجّع الموظف لأول صفحة — رشقة استيراد 20 أوردر كانت
// بتضرب 100 طلب وتوست لكل واحد. بنحدّث الحالة المحلية فوراً، والطلبات
// بتتجمع في تحديث واحد بعد ما الرشقة تهدى، من غير لمس الصفحة الحالية.
var rtTimer = null, rtInserts = 0, rtFirstAt = 0;
// تغييرات الحالة اللي وصلت من الريل-تايم في الرشقة الحالية — بتتجمّع في
// toast واحد زي الأوردرات الجديدة بالظبط. الشكل: [{uid, to}]
var rtStatusChanges = [];
// 🔴 v82 — احتياجات الرشقة: كل حدث بيتصنّف (rtNeeds) وبيقول محتاج إيه، والتنفيذ مرة واحدة في آخر الرشقة.
// قبل كده **كل** حدث على orders — حتى ختم وقت من مزامنة J&T أو نسبة الاستلام — كان بيجيب صفحة الجدول كاملة
// (200 صف ≈ 320 KB) + الدمج (768 صف) + الكروت في كل تاب أوردرات ظاهرة: ~نص الـEgress الشهري (قياس 17 أكتوبر —
// الـgrace period بتاع Supabase بيخلص 8 نوفمبر). الصف المعروض بيتحدّث من الحدث نفسه (fil[k]=row) فمش محتاج جلب.
//   light  = الكروت + الدمج + البضاعة + شريط الإلغاء (بضع KB) — لما الحدث غيّر حاجة بيقروها
//   page   = صفحة الجدول من السيرفر — أوردر جديد/اتمسح، أو تغيير بيخرّج/يدخّل صف في الفلتر النشط
//   render = صف في الصفحة اتحدّث من الحدث ومحتاج يترسم
var rtNeedLight = false, rtNeedPage = false, rtNeedRender = false;
// شبكة أمان: حدث اتصنّف «مالوش أثر» غلط (نادر — عمود مش في النسخة اللي في الذاكرة) = الكروت (الرخيصة) بتتجاب
// على الأكثر كل 5 دقايق مع أي حدث، فأي فرق مايعيشش أكتر من كده.
var RT_LIGHT_SAFETY_MS = 5 * 60 * 1000;
function scheduleRealtimeRefresh(){
  // debounce بحد أقصى: رشقة مستمرة بفواصل أقل من 800ms كانت بتأجّل
  // التحديث لما الرشقة تخلص خالص — دلوقتي بنفضفض على الأكثر كل ~3 ثواني
  var _now = Date.now();
  if(!rtTimer) rtFirstAt = _now;
  if(rtTimer) clearTimeout(rtTimer);
  rtTimer = setTimeout(function(){
    rtTimer = null;
    if(rtInserts > 0){
      toast(rtInserts === 1 ? '📦 طلب جديد وصل!' : ('📦 '+rtInserts+' طلبات جديدة وصلت!'), 'ok');
      rtInserts = 0;
    }
    if(rtStatusChanges.length){
      // سكانر المخزن (📷) لوحده — «من شركة الشحن» كان بيكذب على طرد اتضرب في المخزن
      var c = rtStatusChanges.filter(function(x){ return !x.wh; });
      var w = rtStatusChanges.filter(function(x){ return x.wh; });
      if(c.length) toast(c.length === 1
        ? ('🚚 طلب #' + c[0].uid + ' بقى «' + c[0].to + '»')
        : ('🚚 ' + c.length + ' طلبات اتغيّرت حالتهم من شركة الشحن'), 'ok');
      if(w.length) toast(w.length === 1
        ? ('📦 طلب #' + w[0].uid + ' بقى «' + w[0].to + '» من سكانر المخزن')
        : ('📦 ' + w.length + ' طرد اتضرب في سكانر المخزن'), 'ok');
      rtStatusChanges = [];
    }
    var light = rtNeedLight, page = rtNeedPage, render = rtNeedRender;
    rtNeedLight = false; rtNeedPage = false; rtNeedRender = false;
    if(!light && Date.now() - rtLastLightAt > RT_LIGHT_SAFETY_MS) light = true;
    var fetched = false;
    if(light || page){
      if(ordersShown()){
        if(light) refreshOrdersLight();
        if(page){ fetchOrdersPage(); fetched = true; }   // مش doFilter — بيحافظ على الصفحة اللي الموظف واقف عليها
        else refreshCancelBar();                          // fetchOrdersPage بتعمله لوحدها
      } else ordersStale = true;
    }
    if(render && !fetched){
      try{ renderTable(); }catch(e){ swallow('scheduleRealtimeRefresh/renderTable', e); }
      try{ updateUnprintedBtn(); }catch(e){ swallow('scheduleRealtimeRefresh/updateUnprintedBtn', e); }   // awb_print_count اتغيّر من تاب تانية
    }
  }, (_now - rtFirstAt >= 3000) ? 0 : 800);
}

// ── تصنيف الحدث (v82) ─────────────────────────────────────────────────────
// الأعمدة اللي الكروت (sahl_orders_stats: status · total_cost · payment_stage · created_at) والدمج
// (merge_candidates_v1: الحالة · التليفون · والأعمدة المعروضة) والبضاعة (loadBostaInventoryCard) وشريط الإلغاء بيقروها.
// ⚠️ أي كارت/تنبيه جديد بيقرا عمود تاني من orders لازم العمود يتضاف هنا — وإلا تغييره مش هيحدّث الكارت غير
// مع شبكة الأمان (5 دقايق) أو ↻.
var RT_LIGHT_COLS = ['status','total_cost','payment_stage','created_at','phone','customer_name','city','order_uid','tracking_no',
  'product_name','inventory_cost_snapshot','inventory_value_snapshot','inventory_value_at_bosta','cancel_requested_at','cancel_resolved_at'];
var RT_CANCEL_COLS = ['cancel_requested_at','cancel_resolved_at'];
// ختم وقت بيتكتب بـnow() في **نفس الترانزاكشن** مع updated_at (تريجر orders_updated_at = now()) — UPDATE كل اللي فيه
// الختم ده: مزامنة رسوم J&T (app.jt_apply_fee) · مبلغ التحصيل (app.jt_set_cod) · نسبة الاستلام (ship_rank_apply_v1) ·
// customer_ranking_at (n8n القديم). ولا واحد منهم بيلمس عمود من RT_LIGHT_COLS.
var RT_STAMP_COLS = ['jt_fee_synced_at','jt_cod_synced_at','ship_rank_at','customer_ranking_at'];
// آخر نسخة شفناها من كل أوردر في الريل-تايم (الأعمدة اللي بنقارن بيها بس) — أوردر مش في الصفحة اتلمس مرتين
// (رسوم J&T كل نص ساعة على نفس الأوردرات) = المرة التانية بتتقارن بدل ما تتحسب «مش معروف»
var rtSeen = new Map(), RT_SEEN_MAX = 1500;
function rtTrackCols(){ return RT_LIGHT_COLS.concat(ORDER_SEARCH_COLS, ['updated_at']); }
// وقت من PostgREST أو الريل-تايم ("2026-10-17 10:00:00.123+00" — Date.parse مابيفهمش ±HH من غير دقايق)
function rtTime(v){
  if(v == null || v === '') return NaN;
  return Date.parse(String(v).trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
}
// الصفحة نزلت والأحداث اللي وصلت وهي في السكة: الأحدث من الـsnapshot (updated_at) بيكسب — الـsnapshot من غير updated_at = الحدث
function rtOverlayFlight(flight){
  for(var k=0;k<fil.length;k++){
    var ev = flight[fil[k].id];
    if(!ev) continue;
    var te = rtTime(ev.updated_at), ts = rtTime(fil[k].updated_at);
    if(!isNaN(ts) && (isNaN(te) || te <= ts)) continue;
    fil[k] = ev;
  }
}
// نسخة السيرفر من نافذة التفاصيل (select('*')) — أوردر مش في الصفحة اتفتح من تاب الاستثناءات واتعدّل محلي، فصدى الحدث لازم
// يتقارن بالنسخة اللي قبل التعديل مش بـsel المعدّل
export function rtNoteServerRow(row){ rtRemember(row); }
function rtRemember(row){
  if(!row || !row.id) return;
  // نسخة أقدم من اللي معانا (جلب صفحة طلع قبل حدث وصل) مابتدوسش عليها
  var old = rtSeen.get(row.id), to = old ? rtTime(old.updated_at) : NaN, tn = rtTime(row.updated_at);
  if(!isNaN(to) && !isNaN(tn) && tn < to) return;
  var o = {}, cols = rtTrackCols();
  for(var i=0;i<cols.length;i++){ if(Object.prototype.hasOwnProperty.call(row, cols[i])) o[cols[i]] = row[cols[i]]; }
  rtSeen.delete(row.id); rtSeen.set(row.id, o);
  if(rtSeen.size > RT_SEEN_MAX) rtSeen.delete(rtSeen.keys().next().value);
}
// النسخة اللي بنقارن بيها **قبل** الحدث: نسخة السيرفر (آخر جلب للصفحة أو آخر حدث — مش التعديل المحلي) ← الصفحة ← نافذة
// التفاصيل. 🔴 مخزن الماليات (all) مش منهم: أعمدته (ALL_COLS) ناقصة أعمدة الكروت (طلب الإلغاء · الاسم · المدينة) فالتغيير
// فيها كان بيعدّي «مفيش تغيير» — الأوردر اللي مش معروف بيتعامل «مش معروف» (light لو مش ختم)
function rtKnownRow(id){
  if(!id) return null;
  var s = rtSeen.get(id); if(s) return s;
  for(var i=0;i<fil.length;i++){ if(fil[i].id === id) return fil[i]; }
  if(sel && sel.id === id) return sel;
  return null;
}
function rtActiveFilters(){
  function g(id){ var el = $id(id); return el ? String(el.value || '').trim() : ''; }
  var f = { st: g('fst'), pl: g('fpl'), py: g('fpy'), q: g('qinp') };
  f.any = !!(f.st || f.pl || f.py || f.q);
  return f;
}
// عمود ناقص من أي ناحية = مانقدرش نحكم عليه فبيتساب (شبكة الأمان بتغطّيه)
function rtChanged(prev, row, cols){
  for(var i=0;i<cols.length;i++){
    var k = cols[i];
    if(!Object.prototype.hasOwnProperty.call(prev, k) || !Object.prototype.hasOwnProperty.call(row, k)) continue;
    if(!rtSameValue(prev[k], row[k])) return true;
  }
  return false;
}
export function rtStampOnly(row){
  var u = row && row.updated_at;
  if(!u) return false;
  for(var i=0;i<RT_STAMP_COLS.length;i++){ var v = row[RT_STAMP_COLS[i]]; if(v && rtSameValue(v, u)) return true; }
  return false;
}
export function rtNeeds(row, prev){
  var f = rtActiveFilters();
  if(!prev){
    // أوردر مش في الذاكرة ومانعرفش اتغيّر فيه إيه: ختم وقت = ولا حاجة · غير كده = الخفيف (رخيص) + الصفحة لو فيه فلتر
    if(rtStampOnly(row)) return { light: false, page: false };
    return { light: true, page: f.any };
  }
  var page = false;
  if(f.st) page = rtChanged(prev, row, f.st === '__cancelreq__' ? RT_CANCEL_COLS : ['status']);
  if(!page && f.pl) page = rtChanged(prev, row, ['platform']);
  if(!page && f.py) page = rtChanged(prev, row, ['payment_stage']);
  if(!page && f.q) page = rtChanged(prev, row, ORDER_SEARCH_COLS);
  return { light: rtChanged(prev, row, RT_LIGHT_COLS), page: page };
}

export function handleRealtimeChange(payload){
  // الجولة: all فيها بيانات الديمو — حدث حقيقي كان بيتخلط فيها، وبعد
  // الاسترجاع بيضيع (الـsnapshot المحفوظ مفهوش). tourRestore بتصفّر
  // allLoaded فأول فتح للماليات بيجيب كل حاجة من السيرفر تاني.
  if(tourActive) return;
  var ev = payload.eventType;
  var row = payload.new || {};
  var oldRow = payload.old || {};
  var need = { light: true, page: true, render: false };   // INSERT/DELETE (وأي نوع مش معروف) = كل حاجة زي الأول

  if(ev === 'INSERT'){
    if(allLoaded) all.unshift(row);
    rtInserts++;
    rtRemember(row);
  } else if(ev === 'UPDATE'){
    // التصنيف **قبل** ما أي نسخة في الذاكرة تتحدّث — هي اللي بنقارن بيها
    var known = rtKnownRow(row.id);
    need = rtNeeds(row, known);
    var phoneMoved = !!(known && Object.prototype.hasOwnProperty.call(known, 'phone') && !rtSameValue(known.phone, row.phone));
    // حالة أوردر ليه استثناء اتغيّرت = نتيجة الاستثناء ممكن تتغيّر (اتلغى · اتسلّم) — الشارة والتاب بيعيدوا البوليصة دي بس
    if(row.tracking_no && !rtStampOnly(row) && (!known || !rtSameValue(known.status, row.status))){
      try{ jxNoteOrderChange(row.tracking_no); }catch(e){ swallow('handleRealtimeChange/jxNoteOrderChange', e); }
    }
    rtRemember(row);
    if(allLoaded){
      for(var i=0;i<all.length;i++){ if(all[i].id === row.id){ all[i] = row; break; } }
    }
    // 🔴 `fil` هو مصدر الجدول (الصفحة الحالية من السيرفر) و`all` مخزن
    // الماليات الكسول — بيبقى فاضي على طول الوقت. تحديث `all` لوحده كان
    // معناه إن الصف المعروض مابيتغيّرش غير لما `fetchOrdersPage` ترجع،
    // فتغيير الحالة من شركة الشحن كان بيستنى الرحلة دي.
    var prev = null;
    for(var k=0;k<fil.length;k++){ if(fil[k].id === row.id){ prev = fil[k]; fil[k] = row; break; } }
    if(prev) need.render = true;   // الصف المعروض اتحدّث — بيترسم في آخر الرشقة لو مفيش جلب للصفحة
    // شارة العميل المتكرر (phoneCounts) كانت بتتحدّث مع جلب الصفحة اللي كان بيحصل مع كل حدث — التليفون اتغيّر = عدّ الرقمين
    // أوردر مش معروف (مش في الصفحة) ومش ختم وتليفونه زي صف في الصفحة = ممكن يكون اتغيّر للرقم ده — عدّ الرقم ده بس
    // أوردر برّه الصفحة (معروف أو لأ) ومش ختم: الرقمين (الجديد والقديم) لو واحد منهم زي صف في الصفحة
    var phs = [];
    if(prev && phoneMoved) phs = [row.phone, known.phone];
    else if(!prev && !rtStampOnly(row) && (!known || phoneMoved)){
      var cand = [row.phone, known && known.phone].filter(function(x){ return !!x; });
      phs = cand.filter(function(ph){
        var np = normalizePhone(ph);
        for(var q=0; q<fil.length; q++){ if(fil[q].id !== row.id && np && normalizePhone(fil[q].phone) === np) return true; }
        return false;
      });
    }
    phs = phs.filter(function(x){ return !!x; });
    if(phs.length) fetchPhoneCounts(phs, function(){ try{ renderTable(); }catch(e){ swallow('handleRealtimeChange/phoneCounts', e); } });
    // 🔴 REPLICA IDENTITY على `orders` = default، يعني `payload.old` فيه
    // المفتاح بس — الحالة القديمة بتتقرا من الصف اللي في الذاكرة مش من
    // الحدث. لو الصف مش معروض، مفيش مقارنة ومفيش toast (وده صح: الجدول
    // مش شايفه أصلاً). ⚠️ من v79 تاب فتحت على صفحة تانية (المحادثات · السكانر)
    // جدولها مابيتحمّلش لحد ما الأوردرات تتفتح = مفيش toast حالة فيها خالص
    // (قبل كده كانت بتطلع للصفوف اللي في أول صفحة بالصدفة). toast الأوردر الجديد زي ما هو.
    if(prev && prev.status !== row.status){
      var by = rtChangedBy(row);
      // سكانر المخزن بيكتب «📷 <الموظف>» — الاسم من غير البادئة هو اللي بيتقارن (كان كل سكان بيعمل toast لصاحبه)
      var wh = by.indexOf('📷') === 0;
      var byName = wh ? by.replace(/^📷\s*/, '') : by;
      // الموظف اللي غيّر الحالة بنفسه شاف النتيجة قدامه — toast على فعله
      // هو ضوضاء. اللي يستاهل إشعار هو اللي جه من برّه: شركة الشحن أو زميل.
      // وسكانات المخزن والصفحة بتاعته مفتوحة قدامه = القوايم بتعرضها (toast لكل طرد = ضوضاء)
      var whOpen = wh && (function(){ var pg = document.getElementById('page-warehouse'); return !!(pg && pg.style.display !== 'none'); })();
      if(byName !== (currentUser && currentUser.name) && !whOpen){
        rtStatusChanges.push({ uid: row.order_uid || (row.id || '').slice(0,8), to: statusLabel(row.status), wh: wh });
      }
      try{ renderTable(); }catch(e){ swallow('handleRealtimeChange/renderTable', e); }
    }
    if(sel && sel.id === row.id){
      // `sel` جاي من `select('*')` والحدث كمان بيحمل كل الأعمدة — بس الدمج
      // بيحمي من أي عمود الريل-تايم ميبعتهوش (صلاحيات بالعمود).
      var scoreOnly = rtOnlyScoreChanged(sel, row);
      var merged = Object.assign({}, sel, row);
      ordersSetSelected(merged);
      // النافذة مفتوحة قدام الموظف؟ لازم تتحدث هي كمان — من غير ده الحالة
      // في الجدول بتتغيّر والنافذة فاضلة على القديم.
      // 🔴 إلا لو اللي اتغيّر نسبة الاستلام بس: سحب شركة الشحن (ship-rank-sync) بيعمل UPDATE بعد
      // ~0–3د من نزول الأوردر، والرسم الكامل كان بيمسح أي حاجة الموظف بيكتبها ومحفظهاش
      // (المنتجات · التليفون · ملاحظة المكالمة · الملاحظات الداخلية). فالقسم بتاعها بس بيتبدّل.
      try{
        if($id('ovl').classList.contains('open')){
          var ds = scoreOnly ? $id('ds-sec') : null;
          if(ds) ds.outerHTML = deliveryScoreSection(merged);
          else renderDetail();
        }
      }
      catch(e){ swallow('handleRealtimeChange/renderDetail', e); }
    }
  } else if(ev === 'DELETE'){
    if(allLoaded) ordersSetAll(all.filter(function(o){ return o.id !== oldRow.id; }));
    rtSeen.delete(oldRow.id);
  }
  if(ev === 'UPDATE' && pageFlightRows && pageFlightAt && Date.now() - pageFlightAt < PAGE_FLIGHT_MS) pageFlightRows[row.id] = row;   // الصفحة اللي في السكة ممكن تكون قبل الحدث
  if(need.light) rtNeedLight = true;
  if(need.page) rtNeedPage = true;
  if(need.render) rtNeedRender = true;

  if(allLoaded){ try{ buildIndexes(); }catch(e){ swallow('handleRealtimeChange/buildIndexes', e); } }
  scheduleRealtimeRefresh();
}

// أعمدة نسبة الاستلام (+ updated_at اللي تريجر orders بيحطه مع أي UPDATE): شركة الشحن (ship-rank-sync — 10 أكتوبر)
// بيعمل UPDATE بعد ~0–2 دقيقة من نزول الأوردر · و`eo_*` (EasyOrders — اتشالت من الواجهة 17 أكتوبر والسحب اتوقف) لسه
// على الجدول ومابتتعرضش، فتغييرها لو حصل مايستاهلش رسم كامل
// + ختم مزامنة J&T (`jt_cod_synced_at`/`jt_fee_synced_at` — v79): ختم وقت بس من غير أي تغيير في الأوردر
// + سكانر المخزن (14 أكتوبر): السكان بيختم `stock_deducted_at`/`stock_returned_at` بس — مايتحسبش تعديل في
//   الأوردر، فنافذة التفاصيل المفتوحة مابتترسمش من جديد (وكلام الموظف اللي مااتحفظش مابيضيعش)
var RT_SCORE_COLS = { eo_metadata: 1, eo_rate: 1, eo_rate_alt: 1, updated_at: 1,
  ship_rank: 1, ship_rank_n: 1, ship_rank_alt: 1, ship_rank_alt_n: 1, ship_rank_at: 1, ship_rank_raw: 1,
  jt_cod_synced_at: 1, jt_fee_synced_at: 1,
  stock_deducted_at: 1, stock_returned_at: 1 };
// نفس القيمة بشكلين؟ PostgREST والريل-تايم ممكن يختلفوا في كتابة الرقم أو الوقت — والفرق ده
// مايتحسبش تغيير (ولو اتحسب: رسم كامل زي الأول، يعني الغلط في الاتجاه الآمن).
function rtSameValue(a, b){
  if(a === b) return true;
  if(a == null || b == null) return a == b;
  if(typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  var na = Number(a), nb = Number(b);
  if(String(a).trim() !== '' && String(b).trim() !== '' && !isNaN(na) && !isNaN(nb)) return na === nb;
  if(typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d/.test(a) && /^\d{4}-\d{2}-\d{2}[T ]\d/.test(b)){
    var ta = rtTime(a), tb = rtTime(b);
    return !isNaN(ta) && ta === tb;
  }
  return false;
}
// الحدث ده غيّر نسبة الاستلام بس؟ (لازم تكون اتغيّرت فعلاً — حدث مكرر = رسم كامل زي الأول)
export function rtOnlyScoreChanged(prev, row){
  if(!prev || !row) return false;
  var scoreMoved = false;
  for(var k in row){
    if(!Object.prototype.hasOwnProperty.call(row, k) || rtSameValue(prev[k], row[k])) continue;
    if(!RT_SCORE_COLS[k]) return false;
    if(k !== 'updated_at') scoreMoved = true;
  }
  return scoreMoved;
}

// مين آخر واحد غيّر الحالة — من آخر مدخل في سجل الحالة.
// ⚠️ `status_log` ممكن يبقى متخزّن كـstring (نود n8n بتعمل stringify على
// عمود jsonb) — `parseStatusLog` بتفكّه، فمانقراهوش مباشرةً.
function rtChangedBy(row){
  try{
    var log = parseStatusLog(row && row.status_log);
    if(!Array.isArray(log) || !log.length) return '';
    return String(log[log.length-1].by || '');
  }catch(e){ return ''; }
}

export function buildIndexes(){
  ordersSetPhoneCounts({});
  ordersSetPendingBosta({});
  var MERGE_STATUSES = ['bosta_assigned','BOSTA AUTO','bosta_auto','BOSTA2','bosta2'];
  all.forEach(function(o){
    var p=normalizePhone(o.phone);
    if(!p)return;
    phoneCounts[p]=(phoneCounts[p]||0)+1;
    if(MERGE_STATUSES.indexOf(o.status) >= 0){
      if(!pendingBostaByPhone[p]) pendingBostaByPhone[p]=[];
      pendingBostaByPhone[p].push(o);
    }
  });
}

export function showRealtimeDot(connected){
  var dot = $id('realtime-dot');
  if(!dot) return;
  dot.title = connected ? 'متصل — تحديث فوري مفعّل ✅' : 'غير متصل — تحديث يدوي فقط';
  dot.className = 'realtime-dot ' + (connected ? 'on' : 'off');
}

// Statuses shown under OPERATION filter — official Bosta API movement statuses only; excludes Delivered and internal Bosta statuses
export var OPERATION_STATUSES = BOSTA_OPERATION_STATUSES;

export var BOSTA_FILTER_STATUSES = ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2'];

// manufacturer_note = خصائص المنتج كاملة من الويبهوك (لون + مقاس…) — **عرض بس**.
// عمود نصي قصير فمالوش أثر يُذكر على حجم النقل (درس 32 عن الـJSONB).
// ship_rank_raw (jsonb ~295 بايت · أقصى 362 — اتقاس 10 أكتوبر): الشارة محتاجاه عشان تعرف الرقم اللي اتسأل فعلاً
// (التليفون اتعدّل بعده = النسبة مش بتاعته) — من غيره الجدول يعرض نسبة رقم قديم والتفاصيل تقول غير كده.
export var ORDER_LIST_COLS = 'id,order_uid,tracking_no,customer_name,phone,alt_phone,city,address,product_name,payment_stage,status,status_changed_at,call_attempts,customer_notes,internal_notes,created_at,total_cost,platform,awb_printed_at,awb_print_count,customer_ranking,ship_rank,ship_rank_n,ship_rank_at,ship_rank_alt,ship_rank_alt_n,ship_rank_raw,cancel_requested_at,cancel_resolved_at,var,manufacturer_note,has_upsell,shipping_carrier,jt_sorting_code,jt_ship_error,ship_prov,ship_city,ship_area,shipping_weight_kg,exchange_of,updated_at';

// المدة (بتوقيت القاهرة) → حدود created_at [from, to). NULL = كل الفترات.
export function ordersPeriodRangeISO(){
  var p=ordersPeriod;
  if(p.type==='all') return null;
  function dISO(y,mi,d){ return new Date(y,mi,d,0,0,0,0).toISOString(); }
  var now=new Date();
  if(p.type==='month') return { fromTs:dISO(now.getFullYear(),now.getMonth(),1), toTs:dISO(now.getFullYear(),now.getMonth()+1,1) };
  if(p.type==='last3'){ var f=new Date(now); f.setDate(f.getDate()-2); return { fromTs:dISO(f.getFullYear(),f.getMonth(),f.getDate()), toTs:dISO(now.getFullYear(),now.getMonth(),now.getDate()+1) }; }
  if(p.type==='last30'){ var g=new Date(now); g.setDate(g.getDate()-29); return { fromTs:dISO(g.getFullYear(),g.getMonth(),g.getDate()), toTs:dISO(now.getFullYear(),now.getMonth(),now.getDate()+1) }; }
  if(p.type==='custom'){ var fr=p.from,to=p.to; if(fr&&to&&fr>to){var t=fr;fr=to;to=t;} var a=(fr||'2000-01-01').split('-'),b=(to||'2999-12-31').split('-'); return { fromTs:dISO(+a[0],+a[1]-1,+a[2]), toTs:dISO(+b[0],+b[1]-1,+b[2]+1) }; }
  return null;
}

// أعمدة البحث في جدول الأوردرات — مصدر واحد للاستعلام (fetchOrdersPage) ولتصنيف أحداث الريل-تايم (rtNeeds)
export var ORDER_SEARCH_COLS = ['customer_name','phone','alt_phone','tracking_no','order_uid','city','address','product_name','campaign_name','platform'];

// جلب صفحة واحدة من الأوردرات من Supabase بكل الفلاتر مطبّقة على مستوى الـ query.
// شريط تنبيه طلبات الإلغاء — بيعدّ كل الأوردرات اللي العميل طلب إلغاءها
export function refreshCancelBar(){
  var bar=$id('cxbar');
  if(!bar) return;
  if(tourActive || !currentTenantId){ bar.style.display='none'; return; }
  sb.from('orders').select('id',{count:'exact',head:true})
    .eq('tenant_id',currentTenantId)
    .not('cancel_requested_at','is',null)
    .is('cancel_resolved_at',null)
    .then(function(r){
      var c = r && r.count || 0;
      if(!c || r.error){ bar.style.display='none'; return; }
      bar.innerHTML = '\u26A0 <span>فيه <b>'+c+'</b> '+(c===1?'أوردر العميل طلب إلغاءه':'أوردرات العملاء طلبوا إلغاءها')+' — الأوردر لسه زي ما هو، كلّمهم وقرّر.</span>'
                    + '<span class="cxb-go">عرضهم \u2190</span>';
      bar.style.display='flex';
    });
}

// إقفال يدوي: التاجر بيأكد إنه شاف وتعامل
export function resolveCancelRequest(){
  if(!sel || !sel.id || !currentTenantId) return;
  if(!confirm('تأكيد إنك اتعاملت مع طلب الإلغاء ده؟\n\nالتنبيه هيختفي من اللوحة، والسجل هيفضل محفوظ.')) return;
  var btn=$id('cx-resolve');
  if(btn){ btn.disabled=true; btn.textContent='جاري الحفظ...'; }
  var upd={ cancel_resolved_at:(new Date()).toISOString() };
  if(currentUser && currentUser.id) upd.cancel_resolved_by=currentUser.id;
  sb.from('orders').update(upd).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){
      toast('خطأ: '+(r.error.message||r.error),'er');
      if(btn){ btn.disabled=false; btn.textContent='\u2713 تم التعامل'; }
      return;
    }
    sel.cancel_resolved_at=upd.cancel_resolved_at;
    toast('تم التعامل \u2713','ok');
    renderDetail();
    refreshCancelBar();
    fetchOrdersPage();
  });
}

export function showCancelRequested(){
  var el=$id('fst'); if(!el) return;
  el.value='__cancelreq__';
  // القيمة اتحطت برمجياً فمفيش change event — القايمة المنسدلة المخصصة
  // وكروت الحالة كانوا بيفضلوا على الفلتر القديم والنتايج على فلتر تاني
  if(window.__syncFilterUI)window.__syncFilterUI();
  ordersSetPage(1);
  fetchOrdersPage();
}

// رقم جيل الجلب — رد بحث قديم وصل متأخر مايستبدلش نتيجة بحث أحدث
var fetchGen = 0;
// v82: الصفحة في السكة من إمتى (0 = مفيش) — حدث ريل-تايم وصل وهي في السكة ممكن يكون اتعمل بعد الـsnapshot بتاعها،
// فالرد كان هيرجّع الصف القديم والحدث مش هيتعاد (قبل v82 كل حدث كان بيجيب الصفحة). فالحدث ده بيجيب الصفحة تاني بعدها.
// 🔴 ومش جلب تاني على طول (المراجعة التانية): صدى تعديل الموظف نفسه بيوصل والصفحة اللي doFilter طلبها في السكة، والـsnapshot
// بتاعها **بعد** الـcommit — فالجلب التاني كان على الفاضي. الحدث بيتحفظ (pageFlightRows) ولما الصفحة تنزل بيتقارن بـupdated_at:
// أحدث من الـsnapshot = الصف من الحدث · غير كده = ولا حاجة. خروج/دخول الفلتر اتحكم عليه وقت الحدث (rtNeeds) زي أي حدث.
var pageFlightAt = 0, pageFlightRows = null, PAGE_FLIGHT_MS = 15000;

export function fetchOrdersPage(){
  if(tourActive) return;                 // الجولة بترسم بيانات الديمو عبر doFilter()
  if(!ensureTenant()) return;
  var myGen = ++fetchGen;
  pageFlightAt = Date.now(); pageFlightRows = {};
  $id('tbody').innerHTML=skelTable(8);
  var st=$id('fst').value, pl=$id('fpl').value, py=$id('fpy').value;
  var q=$id('qinp').value.trim();
  var fromIdx=(cur-1)*PS, toIdx=fromIdx+PS-1;
  var query=sb.from('orders').select(ORDER_LIST_COLS,{count:'exact'}).eq('tenant_id',currentTenantId);
  if(st){
    if(st==='__cancelreq__') query=query.not('cancel_requested_at','is',null).is('cancel_resolved_at',null);
    else if(st==='__operation__') query=query.in('status',OPERATION_STATUSES);
    else if(st==='bosta_assigned') query=query.in('status',BOSTA_FILTER_STATUSES);
    else if(st==='delivered') query=query.in('status',DELIVERED_STATUSES);
    else if(st==='returned') query=query.in('status',RETURNED_STATUSES);
    else query=query.eq('status',st);
  }
  if(pl) query=query.eq('platform',pl);
  if(py) query=query.eq('payment_stage',py);
  if(q){
    var qs=q.replace(/[,()*\\%]/g,' ').trim();
    if(qs){
      var lk='*'+qs+'*';
      query=query.or(ORDER_SEARCH_COLS.map(function(c){return c+'.ilike.'+lk;}).join(','));
    }
  }
  var rng=ordersPeriodRangeISO();
  if(rng) query=query.gte('created_at',rng.fromTs).lt('created_at',rng.toTs);
  query.order('created_at',{ascending:false}).range(fromIdx,toIdx).then(function(r){
    if(myGen !== fetchGen) return;   // طلب أحدث خرج بعدنا — الرد ده بقى قديم
    var flight = pageFlightRows;
    pageFlightAt = 0; pageFlightRows = null;
    refreshCancelBar();
    if(r.error){
      toast('خطأ في تحميل الأوردرات: '+r.error.message,'er');
      $id('tbody').innerHTML='<div class="ldg">حصلت مشكلة في تحميل الأوردرات — دوس ↻ تحديث وحاول تاني.</div>';
      $id('pag').style.display='none';
      return;
    }
    // العدد نقص (حذف/تغيير حالة من Realtime) والموظف واقف على صفحة بقت
    // بعد الآخر — من غير الـclamp كان بيشوف جدول فاضي وعدّاد "101–99 من 99"
    var srvCount=(typeof r.count==='number')?r.count:(r.data||[]).length;
    var maxPage=Math.max(1,Math.ceil(srvCount/PS));
    if(cur>maxPage){ ordersSetPage(maxPage); fetchOrdersPage(); return; }
    ordersSetFiltered(r.data||[]);
    if(flight) rtOverlayFlight(flight);
    // نسخة السيرفر للمقارنة في الريل-تايم — التعديل المحلي (تليفون · شحن يدوي) بيكتب على صفوف fil نفسها، فصدى
    // الحدث كان بيتقارن بالنسخة المعدّلة ويبان «مفيش تغيير» والدمج والكروت مايتحدّثوش عند الموظف اللي عدّل
    for(var ri=0; ri<fil.length; ri++) rtRemember(fil[ri]);
    ordersSetTotalCount((typeof r.count==='number')?r.count:fil.length);
    var hasFilter=!!(st||pl||py||q);
    $id('fcnt').textContent=num(totalCount)+(hasFilter?' نتيجة':' طلب');
    try{ updateUnprintedBtn(); }catch(e){ swallow('fetchOrdersPage/updateUnprintedBtn', e); }
    renderTable();
    // شارة العميل المتكرر: عدّ طلبات تليفونات الصفحة من كويري صغير ثم إعادة عرض
    var phs=[], seen={};
    fil.forEach(function(o){ if(o.phone && !seen[o.phone]){ seen[o.phone]=1; phs.push(o.phone); } });
    if(phs.length) fetchPhoneCounts(phs, renderTable);
  });
}

export function doFilter(){
  var q=$id('qinp').value.trim().toLowerCase();
  var st=$id('fst').value, pl=$id('fpl').value, py=$id('fpy').value;
  if(tourActive){
    // الجولة التعليمية: فلترة على بيانات الديمو في الذاكرة (نفس السلوك القديم)
    var base=ordersInPeriod();
    var f=base.filter(function(o){
      if(st){
        if(st==='__operation__'){ if(OPERATION_STATUSES.indexOf(o.status)<0) return false; }
        else if(st==='bosta_assigned'){ if(BOSTA_FILTER_STATUSES.indexOf(o.status)<0) return false; }
        else if(st==='delivered'){ if(DELIVERED_STATUSES.indexOf(o.status)<0) return false; }
        else if(st==='returned'){ if(RETURNED_STATUSES.indexOf(o.status)<0) return false; }
        else if(o.status!==st) return false;
      }
      if(pl&&o.platform!==pl)return false;
      if(py&&o.payment_stage!==py)return false;
      if(q){var h=[o.customer_name,o.phone,o.alt_phone,o.tracking_no,o.order_uid,o.city,o.address,o.product_name,o.campaign_name,o.platform].filter(Boolean).join(' ').toLowerCase();if(h.indexOf(q)<0)return false;}
      return true;
    });
    ordersSetPage(1); ordersSetTotalCount(f.length); ordersSetFiltered(f.slice(0,PS));
    $id('fcnt').textContent=f.length!==base.length?num(f.length)+' نتيجة':num(base.length)+' طلب';
    var pc=$id('orders-period-cnt'); if(pc) pc.textContent=ordersPeriod.type==='all'?num(all.length)+' طلب (كل الفترات)':num(base.length)+' طلب في المدة';
    renderTable();
    return;
  }
  // الوضع العادي: عدّاد المدة بيتحدّث من الـ RPC (loadOrdersCards). هنا بس نجيب صفحة الجدول.
  ordersSetPage(1);
  fetchOrdersPage();
}

export function initOrdersUI(){
  // التاب رجعت قدامك وصفحة الأوردرات ظاهرة = هات اللي فات وهي في الخلفية
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) refreshOrdersIfStale(); });
  if($id('fst')) $id('fst').addEventListener('change',reflectStatusCards);
  wireStatusCards();

  // ---- orders period bar: scope table + top cards to a chosen date range (no-op during the demo) ----
  (function(){
    var bar=$id('orders-period-bar'); if(!bar)return;
    bar.querySelectorAll('.pseg-btn').forEach(function(b){
      b.addEventListener('click',function(){ if(tourActive)return; setOrdersPeriod(b.getAttribute('data-period')); });
    });
    var ap=$id('op-apply');
    if(ap) ap.addEventListener('click',function(){
      if(tourActive)return;
      setPeriod(ordersPeriod, 'custom', $id('op-from').value, $id('op-to').value);
      refreshOrdersScope();
    });
    // keep the sliding pill aligned: on resize, when the bar becomes visible (after login), and once now
    window.addEventListener('resize',positionPeriodInd);
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting) positionPeriodInd(); }); }).observe(bar);
    }
    requestAnimationFrame(positionPeriodInd);
    setTimeout(positionPeriodInd,300);
  })();
  $id('psize').addEventListener('change',function(){ordersSetPageSize(parseInt($id('psize').value)||50);localStorage.setItem('sb_ps',PS);ordersSetPage(1);if(tourActive){doFilter();}else{fetchOrdersPage();}});
  // detailAbort مع كل إغلاق: من غيرها رد فتح قديم لسه في السكة كان بيرجع
  // يفتح الـoverlay تاني بعد ما المستخدم قفله
  $id('xcls').addEventListener('click',function(){$id('ovl').classList.remove('open');ordersSetSelected(null);detailAbort();});
  $id('ovl').addEventListener('click',function(e){if(e.target===$id('ovl')){$id('ovl').classList.remove('open');ordersSetSelected(null);detailAbort();}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){$id('ovl').classList.remove('open');ordersSetSelected(null);detailAbort();}});
  $id('tdate').textContent=new Date().toLocaleDateString('ar-EG-u-nu-latn',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

    $id('bb-ok').addEventListener('click',function(){doBulkUpdate('confirmed');});
  $id('bb-bs').addEventListener('click',function(){doBulkUpdate('bosta_assigned');});
  $id('bb-cn').addEventListener('click',function(){doBulkUpdate('cancelled');});
  $id('bb-sel').addEventListener('change',function(){if(this.value){doBulkUpdate(this.value);this.value='';}});
  $id('bclear').addEventListener('click',function(){selectedIds.clear();updateBulkBar();renderTable();});
     $id('bb-print').addEventListener('click', printSelectedAwb);
  // «➕ أوردر جديد» (فيسبوك/إنستجرام/تليفون) — order-form.js
  initOrderForm();

  // ─────────────────────────────────────────────────
  // STOCK MANAGEMENT
  // ─────────────────────────────────────────────────

  // ===== WhatsApp Inbox (مرحلة 1: استقبال + قراءة) =====
}

// Stock event wireup
// التنقّل بين الصفحات وتابات المخزون والتحليلات
// أزرار التنقّل بين الصفحات
export function initNav(){
  initShipTicker();   // متابعة علامات الشحن في الجدول — مرة واحدة مع الإقلاع
  $id('nav-orders').addEventListener('click',function(){showPage('orders');});
  $id('nav-stock').addEventListener('click',function(){showPage('stock');});
  $id('nav-finance').addEventListener('click',function(){showPage('finance');});
  if($id('nav-settings'))$id('nav-settings').addEventListener('click',function(){showPage('settings');});
  if($id('nav-analytics'))$id('nav-analytics').addEventListener('click',function(){showPage('analytics');});
  // 🔴 المحادثات ليها **تاب لوحدها** (طلب المالك 6 سبتمبر) — عشان تفضل مفتوحة
  // قدام الموظف طول اليوم. `openOwnTab` بترجّع false في كل حالة مش مضمونة
  // (موبايل · حاجب نوافذ · استضافة مش بتخدم اللينكات) وساعتها بننقل عادي —
  // الزرار لازم يعمل حاجة دايماً (درس 16).
  if($id('nav-inbox'))$id('nav-inbox').addEventListener('click',function(){
    if(openOwnTab('inbox')) return;
    showPage('inbox');
  });
  // زرار «عمولتي» (للموظف اللي عمولته مفعّلة) — الأزرار هنا متوصّلة
  // بالـID واحد واحد، وأي زرار جديد في القايمة **لازم** يتضاف هنا
  // وإلا الضغطة بتروح في الفراغ من غير أي خطأ (حصلت فعلاً)
  if($id('nav-mycommission'))$id('nav-mycommission').addEventListener('click',function(){showPage('mycommission');});
  // «استثناءات الشحن» (8 أكتوبر) — للأدمن والموظف
  if($id('nav-exceptions'))$id('nav-exceptions').addEventListener('click',function(){showPage('exceptions');});
  // «سكانر المخزن» (14 أكتوبر) — للأدمن والموظف · تاب لوحدها زي المحادثات (جهاز المخزن فاتحها طول اليوم)
  if($id('nav-warehouse'))$id('nav-warehouse').addEventListener('click',function(){
    if(openOwnTab('warehouse')) return;
    showPage('warehouse');
  });
}
