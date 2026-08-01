// الأوردرات — الحالة والتحميل والجدول والتفاصيل والتحديث الجماعي والريل-تايم

import { skelTable } from '../core/skeleton.js';
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
import { renderDetail } from './detail.js';
import { reflectStatusCards, wireStatusCards } from './filters-ui.js';
import { ensureTenant } from './guards.js';
import { doBulkUpdate } from './mutations.js';
import { all, allLoaded, cur, fil, ordersLoading, ordersPeriod, ordersSetAll, ordersSetAllLoaded, ordersSetFiltered, ordersSetLoading, ordersSetPage, ordersSetPageSize, ordersSetPendingBosta, ordersSetPhoneCounts, ordersSetSelected, ordersSetTotalCount, pendingBostaByPhone, phoneCounts, PS, realtimeChannel, realtimeSetChannel, sel, selectedIds, totalCount } from './state.js';
import { renderTable, updateBulkBar, updateUnprintedBtn } from './table.js';

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

// تحميل كل الأوردرات للذاكرة عند الحاجة فقط (الماليات/الإحصائيات بتحسب على كل الفترة).
// الـcb بياخد باراميتر err: لو السحب فشل في النص، اللي نادى لازم مايرندرش
// أرقام ناقصة كأنها حقيقية. وفيه طابور مشترك — فتح الماليات والأداء ورا
// بعض كان بيبدأ سحبتين كاملتين متوازيتين لنفس الجدول.
var allLoadingCbs = null;
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
  // ⚠️ مهم: select() من غير range بيتوقف عند سقف PostgREST (١٠٠٠ صف) في صمت —
  // وده كان بيخلّي الماليات والإحصائيات تتحسب على جزء من البيانات من غير أي تحذير.
  // بنسحب على دفعات لحد ما الداتا تخلص.
  var CHUNK = 1000, acc = [], fromIdx = 0, MAXROWS = 200000;
  (function pull(){
    sb.from('orders').select('*').eq('tenant_id',currentTenantId)
      .order('created_at',{ascending:false})
      .range(fromIdx, fromIdx + CHUNK - 1)
      .then(function(r){
        if(r.error){ toast('خطأ في تحميل البيانات: '+r.error.message,'er'); finish(r.error); return; }
        var got = r.data || [];
        acc = acc.concat(got);
        if(got.length === CHUNK && acc.length < MAXROWS){ fromIdx += CHUNK; pull(); return; }
        ordersSetAll(acc); ordersSetAllLoaded(true);
        try{ buildIndexes(); }catch(e){ swallow('pull/buildIndexes', e); }           // phoneCounts كامل
        finish(null);
      });
  })();
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
      // Add new movement to in-memory list and re-render if stock page open
      if(payload.new){
        if(!stockMovements) stockSetMovements([]);
        stockMovements.unshift(payload.new);
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

export function handleRealtimeChange(payload){
  var ev = payload.eventType;
  var row = payload.new || {};
  var oldRow = payload.old || {};

  if(ev === 'INSERT'){
    if(allLoaded) all.unshift(row);
    toast('📦 طلب جديد وصل!','ok');
  } else if(ev === 'UPDATE'){
    if(allLoaded){
      for(var i=0;i<all.length;i++){ if(all[i].id === row.id){ all[i] = row; break; } }
    }
    if(sel && sel.id === row.id){ ordersSetSelected(row); }
  } else if(ev === 'DELETE'){
    if(allLoaded) ordersSetAll(all.filter(function(o){ return o.id !== oldRow.id; }));
  }

  if(allLoaded){ try{ buildIndexes(); }catch(e){ swallow('handleRealtimeChange/buildIndexes', e); } }
  loadOrdersCards();
  loadMergeCandidates();
  loadBostaInventoryCard();
  doFilter();
  // refresh wallet (status change may have triggered a charge) — for everyone
  if(ev !== 'DELETE') loadWalletState();
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

export var ORDER_LIST_COLS = 'id,order_uid,tracking_no,customer_name,phone,alt_phone,city,address,product_name,payment_stage,status,status_changed_at,call_attempts,customer_notes,internal_notes,created_at,total_cost,platform,awb_printed_at,awb_print_count,customer_ranking,cancel_requested_at,cancel_resolved_at,var';

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
  $id('xcls').addEventListener('click',function(){$id('ovl').classList.remove('open');ordersSetSelected(null);});
  $id('ovl').addEventListener('click',function(e){if(e.target===$id('ovl')){$id('ovl').classList.remove('open');ordersSetSelected(null);}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){$id('ovl').classList.remove('open');ordersSetSelected(null);}});
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
  $id('nav-orders').addEventListener('click',function(){showPage('orders');});
  $id('nav-stock').addEventListener('click',function(){showPage('stock');});
  if($id('nav-issues'))$id('nav-issues').addEventListener('click',function(){showPage('issues');});
  $id('nav-finance').addEventListener('click',function(){showPage('finance');});
  if($id('nav-billing'))$id('nav-billing').addEventListener('click',function(){showPage('billing');});
  if($id('nav-settings'))$id('nav-settings').addEventListener('click',function(){showPage('settings');});
  if($id('nav-analytics'))$id('nav-analytics').addEventListener('click',function(){showPage('analytics');});
  if($id('nav-inbox'))$id('nav-inbox').addEventListener('click',function(){showPage('inbox');});
}
