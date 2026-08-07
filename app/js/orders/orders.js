// الأوردرات — الحالة والتحميل والجدول والتفاصيل والتحديث الجماعي والريل-تايم

import { skelTable } from '../core/skeleton.js';
import { loadCommissions, myCommissionEnabled, refreshMyCommissionNav, renderMyCommissionBar } from '../finance/commissions.js';
import { currentTenantId, currentUser, forceSuspendLogout } from '../auth/auth.js';
import { loadWalletState } from '../billing/billing.js';
import { BOSTA_OPERATION_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES } from '../core/constants.js';
import { $id } from '../core/dom.js';
import { cairoYMD, normalizePhone, num, ymdAddDays } from '../core/format.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { handleWaRealtime, waRefreshNavBadge } from '../inbox/inbox.js';
import { setPeriod, showPage } from '../main.js';
import { renderMovements, renderProducts, stockMovements, stockProducts, stockSetMovements, updateStockStats } from '../stock/stock.js';
import { tourActive, tourMaybeAutoStart } from '../tour/tour.js';
import { printSelectedAwb } from './awb.js';
import { loadBostaInventoryCard, loadMergeCandidates, loadOrdersCards } from './cards.js';
import { detailAbort, renderDetail } from './detail.js';
import { reflectStatusCards, wireStatusCards } from './filters-ui.js';
import { ensureTenant } from './guards.js';
import { doBulkUpdate } from './mutations.js';
import { all, allLoaded, cur, fil, ordersLoading, ordersPeriod, ordersSetAll, ordersSetAllLoaded, ordersSetFiltered, ordersSetLoading, ordersSetPage, ordersSetPageSize, ordersSetPendingBosta, ordersSetPhoneCounts, ordersSetSelected, ordersSetTotalCount, pendingBostaByPhone, phoneCounts, PS, realtimeChannel, realtimeSetChannel, sel, selectedIds, totalCount } from './state.js';
import { renderTable, updateBulkBar, updateUnprintedBtn } from './table.js';
import { initShipTicker } from './ship.js';

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
  var anchor=$id('fbar');
  if(anchor) window.scrollTo({top:Math.max(0,anchor.offsetTop-80),behavior:'smooth'});
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

export function loadAll(){
  if(!ensureTenant())return;
  selectedIds.clear();updateBulkBar();
  // مش بنحمّل كل الأوردرات عند البداية — صفحة الأوردرات كلها من السيرفر.
  // all يتحمّل lazily بس لما الماليات أو الإحصائيات تتفتح.
  ordersSetAll([]); ordersSetAllLoaded(false);
  loadOrdersCards();         // s0..s7 + الإيرادات + عدّاد المدة من RPC
  loadMergeCandidates();     // تنبيه الدمج من كويري مخصّص
  loadBostaInventoryCard();  // كارت بضاعة بوسطة من كويري مخصّص (بيحمّل المخزون عند اللزوم)
  // شريط عمولة الموظف + زرار «عمولتي» — بيتحمّلوا مرة مع أول تحميل للطلبات.
  // بيرجعوا بدري لو العمولة مش مفعّلة، فمفيش نداء زيادة على أغلب التجار.
  if(myCommissionEnabled()){ refreshMyCommissionNav(); loadCommissions(renderMyCommissionBar); }
  doFilter();                // الجدول: صفحة واحدة من السيرفر
  startRealtime();
  waRefreshNavBadge();       // عدّاد المحادثات غير المقروءة على زرار التبويب
  loadWalletState();         // للجميع (أدمن + موظف) — للقفل عند نفاد الرصيد
  try{ tourMaybeAutoStart(); }catch(e){ swallow('loadAll/tourMaybeAutoStart', e); }
}

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
        showRealtimeDot(true);
      } else if(status === 'CLOSED' || status === 'CHANNEL_ERROR'){
        showRealtimeDot(false);
      }
    }));
}

// تجميع أحداث الـRealtime: كل حدث كان بيطلق 5 طلبات (كروت + دمج + بضاعة
// + جدول + محفظة) وبيرجّع الموظف لأول صفحة — رشقة استيراد 20 أوردر كانت
// بتضرب 100 طلب وتوست لكل واحد. بنحدّث الحالة المحلية فوراً، والطلبات
// بتتجمع في تحديث واحد بعد ما الرشقة تهدى، من غير لمس الصفحة الحالية.
var rtTimer = null, rtInserts = 0, rtFirstAt = 0;
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
    loadOrdersCards();
    loadMergeCandidates();
    loadBostaInventoryCard();
    fetchOrdersPage();   // مش doFilter — بيحافظ على الصفحة اللي الموظف واقف عليها
    loadWalletState();   // تغيير حالة ممكن يكون سبّب خصم
  }, (_now - rtFirstAt >= 3000) ? 0 : 800);
}

export function handleRealtimeChange(payload){
  // الجولة: all فيها بيانات الديمو — حدث حقيقي كان بيتخلط فيها، وبعد
  // الاسترجاع بيضيع (الـsnapshot المحفوظ مفهوش). tourRestore بتصفّر
  // allLoaded فأول فتح للماليات بيجيب كل حاجة من السيرفر تاني.
  if(tourActive) return;
  var ev = payload.eventType;
  var row = payload.new || {};
  var oldRow = payload.old || {};

  if(ev === 'INSERT'){
    if(allLoaded) all.unshift(row);
    rtInserts++;
  } else if(ev === 'UPDATE'){
    if(allLoaded){
      for(var i=0;i<all.length;i++){ if(all[i].id === row.id){ all[i] = row; break; } }
    }
    if(sel && sel.id === row.id){ ordersSetSelected(row); }
  } else if(ev === 'DELETE'){
    if(allLoaded) ordersSetAll(all.filter(function(o){ return o.id !== oldRow.id; }));
  }

  if(allLoaded){ try{ buildIndexes(); }catch(e){ swallow('handleRealtimeChange/buildIndexes', e); } }
  scheduleRealtimeRefresh();
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

export var ORDER_LIST_COLS = 'id,order_uid,tracking_no,customer_name,phone,alt_phone,city,address,product_name,payment_stage,status,status_changed_at,call_attempts,customer_notes,internal_notes,created_at,total_cost,platform,awb_printed_at,awb_print_count,customer_ranking,cancel_requested_at,cancel_resolved_at,var,has_upsell,shipping_requested_at';

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

export function fetchOrdersPage(){
  if(tourActive) return;                 // الجولة بترسم بيانات الديمو عبر doFilter()
  if(!ensureTenant()) return;
  var myGen = ++fetchGen;
  ordersSetLoading(true);
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
      query=query.or(['customer_name','phone','alt_phone','tracking_no','order_uid','city','address','product_name','campaign_name','platform'].map(function(c){return c+'.ilike.'+lk;}).join(','));
    }
  }
  var rng=ordersPeriodRangeISO();
  if(rng) query=query.gte('created_at',rng.fromTs).lt('created_at',rng.toTs);
  query.order('created_at',{ascending:false}).range(fromIdx,toIdx).then(function(r){
    if(myGen !== fetchGen) return;   // طلب أحدث خرج بعدنا — الرد ده بقى قديم
    ordersSetLoading(false);
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
  if($id('nav-issues'))$id('nav-issues').addEventListener('click',function(){showPage('issues');});
  $id('nav-finance').addEventListener('click',function(){showPage('finance');});
  if($id('nav-billing'))$id('nav-billing').addEventListener('click',function(){showPage('billing');});
  if($id('nav-settings'))$id('nav-settings').addEventListener('click',function(){showPage('settings');});
  if($id('nav-analytics'))$id('nav-analytics').addEventListener('click',function(){showPage('analytics');});
  if($id('nav-inbox'))$id('nav-inbox').addEventListener('click',function(){showPage('inbox');});
  // زرار «عمولتي» (للموظف اللي عمولته مفعّلة) — الأزرار هنا متوصّلة
  // بالـID واحد واحد، وأي زرار جديد في القايمة **لازم** يتضاف هنا
  // وإلا الضغطة بتروح في الفراغ من غير أي خطأ (حصلت فعلاً)
  if($id('nav-mycommission'))$id('nav-mycommission').addEventListener('click',function(){showPage('mycommission');});
}
