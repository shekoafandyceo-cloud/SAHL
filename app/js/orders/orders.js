// الأوردرات — الحالة والتحميل والجدول والتفاصيل والتحديث الجماعي والريل-تايم

import { currentRole, hasTenant } from '../auth/auth.js';
import { STATUS_OPTIONS, statusClass, statusLabel } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { fmtDT } from '../core/format.js';
import { toast } from '../core/toast.js';
import { askCancelReason } from './cancel-reason.js';
import { copyable } from '../ui/clipboard.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { setPeriod, showPage } from '../main.js';
import { buildProductPerformance } from '../analytics/analytics.js';
import { nameKey, normalizeProductName, parseProductItems, tokenSortKey } from '../analytics/product-match.js';
import { currentTenantId, currentUser, forceSuspendLogout } from '../auth/auth.js';
import { loadBilling, loadWalletState, walletStateCache, wireBillingEvents } from '../billing/billing.js';
import { SUPABASE_URL } from '../core/config.js';
import { BOSTA_EXPECTED_STATUSES, BOSTA_INVENTORY_STATUSES, BOSTA_OPERATION_STATUSES, BOSTA_POSITIVE_STATUSES, CANCELLED_STATUSES, CR, DELIVERED_STATUSES, RETURNED_STATUSES, SL, statusIn } from '../core/constants.js';
import { cairoYMD, firstName, fmt, fmtD, money, normalizePhone, num, short, toLatinDigits, ymdAddDays } from '../core/format.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { fmtMoney, loadFinance, pRange, unmatchedCogsItems } from '../finance/finance.js';
import { handleWaRealtime, waRefreshNavBadge } from '../inbox/inbox.js';
import { loadIssues } from '../issues/issues.js';
import { loadSettings } from '../settings/settings.js';
import { loadStock, renderMovements, renderProducts, stockMovements, stockProducts, stockSetMovements, stockSetProducts, updateStockStats } from '../stock/stock.js';
import { tourActive, tourMaybeAutoStart } from '../tour/tour.js';
import { attachCopyHandlers, copyTextToClipboard } from '../ui/clipboard.js';
import { CALL_WAIT_MS, startTimerTick } from './call-timer.js';

// ── ملكية الحالة عبر المجالات ────────────────────────────────────────
// تحت ES modules الـbinding المستورد **للقراءة بس**: أي موديول يقدر يقرا
// `all` عادي، إنما `all = [...]` من موديول تاني بترمي TypeError وقت الربط،
// والخطأ ده بيقتل جراف الموديولات كله قبل ما ينفّذ سطر واحد.
// فكل حالة ليها مالك واحد بيصدّر setter، وأي كاتب من بره بينادي الـsetter.
// القراءة سايبة زي ما هي — الـlive bindings بتشتغل صح.
export function ordersSetAll(v){ all = v || []; }

export function ordersSetSelected(v){ sel = v; }

export function ordersSetPageSize(v){ PS = v; }

export function realtimeSetChannel(v){ realtimeChannel = v; }

export var all=[], fil=[], cur=1, PS=50, sel=null, stm=null, intNotesTimer=null;

export var allLoaded=false;           // هل تم تحميل كل الأوردرات للذاكرة؟ (يتحمّل lazily للماليات/الإحصائيات فقط)

export var detailHistory=null;        // ملخّص طلبات العميل لشاشة التفاصيل (من كويري بالتليفون)

export var phoneCounts = {}; // map: phone => total order count for that customer

// ── حالة مشتركة عبر أكتر من قسم ──────────────────────────────────
// الخمسة دول كانوا متعرّفين على بعد آلاف السطور من أول موضع بيكتب فيهم
// (financeExpenses كانت الفجوة 3,600 سطر). شغّال دلوقتي بس لأن var
// بتتـhoist — وبيبقى TDZ ReferenceError فوراً لو اتحوّلوا لـlet/const،
// حتى من غير أي تقسيم. اتنقلوا لفوق عشان الكتابة تيجي بعد التعريف.
export var realtimeChannel = null;  // قناة الريل-تايم — بتتصفّر في forceSuspendLogout

export var pendingBostaByPhone = {};  // فهرس الدمج — loadMergeCandidates بتملاه

export var selectedIds = new Set();

export function ensureTenant(){if(!hasTenant()){toast('حصلت مشكلة في الحساب. تواصل مع الدعم.','er');return false;}return true;}

export function isAdmin(){return currentRole==='admin';}

export function requireAdmin(){if(!isAdmin()){toast('الصلاحية دي للأدمن فقط','er');return false;}return true;}

// حقل قابل للتعديل في نافذة التفاصيل (موبايل/عنوان): نسخ + زرار تعديل
export function fieldEditable(val,label,field){
  return '<span class="fld-wrap" data-field="'+field+'">'
    + copyable(val,label)
    + '<button class="fld-edit-btn" data-field="'+field+'" title="تعديل '+esc(label||'')+'">✏️</button>'
    + '</span>';
}

// تحديث قيمة حقل عبر sel + الذاكرة (all + fil) بعد الحفظ
export function patchOrderField(id,patch){
  var k;
  if(sel && sel.id===id){ for(k in patch){ sel[k]=patch[k]; } }
  if(all){ for(var i=0;i<all.length;i++){ if(all[i].id===id){ for(k in patch){ all[i][k]=patch[k]; } break; } } }
  if(fil){ for(var j=0;j<fil.length;j++){ if(fil[j].id===id){ for(k in patch){ fil[j][k]=patch[k]; } break; } } }
}

// ربط أزرار تعديل الموبايل/العنوان داخل نافذة التفاصيل
export function attachFieldEditors(){
  if(!$id('dcnt'))return;
  $id('dcnt').querySelectorAll('.fld-edit-btn').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      if(!sel)return;
      var field=btn.getAttribute('data-field');
      var wrap=btn.parentNode;
      var cur=(sel[field]==null?'':String(sel[field]));
      wrap.innerHTML='<input type="text" class="fld-edit-input" value="'+cur.replace(/"/g,'&quot;')+'">'
        +'<button class="fld-edit-save">حفظ</button>'
        +'<button class="fld-edit-cancel">إلغاء</button>'
        +'<span class="fld-edit-status"></span>';
      var input=wrap.querySelector('.fld-edit-input');
      input.focus(); try{input.setSelectionRange(input.value.length,input.value.length);}catch(e2){ swallow('attachFieldEditors/input.setSelectionRange', e2); }
      wrap.querySelector('.fld-edit-cancel').addEventListener('click',function(){ renderDetail(); });
      function save(){
        var val=input.value.trim();
        if(field==='phone' && val){
          var digits=toLatinDigits(val).replace(/[\s-]/g,'');
          if(!/^[0-9+]{6,}$/.test(digits)){ toast('رقم موبايل غير صالح','er'); return; }
          val=digits;
        }
        if(!sb||!currentTenantId){ toast('غير متصل بالسيرفر','er'); return; }
        var stt=wrap.querySelector('.fld-edit-status'); if(stt)stt.textContent='جاري الحفظ...';
        var upd={}; upd[field]=val||null;
        sb.from('orders').update(upd).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
          if(r.error){ if(stt)stt.textContent=''; toast('خطأ في الحفظ: '+r.error.message,'er'); return; }
          patchOrderField(sel.id,upd);
          toast('تم تعديل '+(field==='phone'?'الموبايل':(field==='address'?'العنوان':'البيانات'))+' ✓','ok');
          try{renderTable();}catch(e3){ swallow('save/renderTable', e3); }
          renderDetail();
        });
      }
      wrap.querySelector('.fld-edit-save').addEventListener('click',save);
      input.addEventListener('keydown',function(ev){
        if(ev.key==='Enter'){ ev.preventDefault(); save(); }
        else if(ev.key==='Escape'){ renderDetail(); }
      });
    });
  });
}

// ===== orders-page period scope (controls BOTH the table and the top stat cards) =====
export var ordersPeriod = { type:'all', from:null, to:null };

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

// كرت "جاهز للخروج" — اضغط يروح لفلتر بوسطة + scroll للجدول
// كارت الجاهزية فوق جدول الأوردرات
export function initReadyCard(){
  (function(){
    var c = document.getElementById('card-ready');
    if(!c) return;
    c.addEventListener('click', function(){
      var fst = $id('fst');
      if(fst){ fst.value = 'bosta_assigned'; }
      if(window.__syncFilterUI) window.__syncFilterUI();
      try{ doFilter(); }catch(e){ swallow('refreshOrdersScope/doFilter', e); }
      window.scrollTo({ top: $id('fbar') ? $id('fbar').offsetTop - 80 : 200, behavior:'smooth' });
    });
  })();

  // زرار "حدد غير المطبوع" — يحدّد كل الأوردرات اللي لسه ماتطبعش في القايمة الحالية
  (function(){
    var btn = document.getElementById('bb-sel-unprinted');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var added = 0;
      (fil||[]).forEach(function(o){
        if(o.tracking_no && String(o.tracking_no).trim() && !(o.awb_print_count > 0)){
          selectedIds.add(o.id);
          added++;
        }
      });
      // علّم الـ checkboxes الظاهرة في الجدول
      $id('tbody').querySelectorAll('.cb-row').forEach(function(cb){
        var id = cb.getAttribute('data-id');
        if(selectedIds.has(id)){
          cb.checked = true;
          var tr = cb.closest('tr'); if(tr) tr.classList.add('sel');
        }
      });
      updateBulkBar(); updateMasterCb();
      if(added > 0){ toast('تم تحديد '+num(added)+' أوردر غير مطبوع — دوس "🖨️ طبع البوالص"','ok'); }
      else { toast('كل الأوردرات في القايمة دي اتطبعت بالفعل','er'); }
    });
  })();
}

export function updateStats(){
  var monthOrders=ordersInPeriod();

  $id('s0').textContent=num(monthOrders.length);
  $id('s1').textContent=num(monthOrders.filter(function(o){return statusIn(o.status,['pending']);}).length);

  var confirmed=monthOrders.filter(function(o){return statusIn(o.status,['confirmed']);}).length;
  var delivered=monthOrders.filter(function(o){return statusIn(o.status,DELIVERED_STATUSES);}).length;
  var cancelled=monthOrders.filter(function(o){return statusIn(o.status,CANCELLED_STATUSES);}).length;
  var returned=monthOrders.filter(function(o){return statusIn(o.status,RETURNED_STATUSES);}).length;

  $id('s2').textContent=num(confirmed);
  $id('s3').textContent=num(delivered);
  $id('s4').textContent=num(cancelled);
  $id('s5').textContent=num(returned);
  
  // كرت "جاهز للخروج" (حساب من الـ cache كـ fallback؛ المصدر الأساسي هو applyOrdersStats من السيرفر)
  var bostaReadyN = monthOrders.filter(function(o){return statusIn(o.status, ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2']);}).length;
  var sRdyEl = $id('s-ready'); if(sRdyEl) sRdyEl.textContent = num(bostaReadyN);

  // نسبة التأكيد = كل الأوردرات التي اتأكدت أو دخلت رحلة بوسطة ÷ كل الأوردرات التي خرجت من Pending.
  // حالات الشحن اللاحقة مثل Delivered / Exception / Returned to business لا تنزل النسبة.
  var processed=monthOrders.filter(function(o){
    return !statusIn(o.status,['pending']);
  }).length;

  var positive=monthOrders.filter(function(o){
    return statusIn(o.status,BOSTA_POSITIVE_STATUSES);
  }).length;

  $id('s6').textContent=processed>0?((positive/processed)*100).toFixed(1)+'%':'—';

  // نسبة التسليم = الطلبات المُسلّمة ÷ الطلبات التي أنهت رحلة الشحن (تسليم + مرتجع).
  // تقيس نجاح التوصيل من الأوردرات التي اتشحنت فعلاً، وليس من إجمالي الأوردرات.
  var deliveryDecided = delivered + returned;
  $id('s7').textContent = deliveryDecided > 0 ? ((delivered/deliveryDecided)*100).toFixed(1)+'%' : '—';
}

export function updateRevenueStats(){
  var monthOrders=ordersInPeriod();
  var total=monthOrders.reduce(function(s,o){return s+val(o);},0);
  var collected=monthOrders.filter(function(o){return statusIn(o.status,DELIVERED_STATUSES);}).reduce(function(s,o){return s+val(o);},0);
  var expected=monthOrders.filter(function(o){return statusIn(o.status,BOSTA_EXPECTED_STATUSES);}).reduce(function(s,o){return s+val(o);},0);
  var lost=monthOrders.filter(function(o){return statusIn(o.status,CANCELLED_STATUSES) || statusIn(o.status,RETURNED_STATUSES) || o.status==='failed';}).reduce(function(s,o){return s+val(o);},0);
  var paymob=monthOrders.filter(function(o){return o.payment_stage==='paymob';}).reduce(function(s,o){return s+val(o);},0);
  $id('rv-total').textContent=money(total);
  $id('rv-collected').textContent=money(collected);
  $id('rv-expected').textContent=money(expected);
  $id('rv-lost').textContent=money(lost);
  $id('rv-aov').textContent=monthOrders.length?money(total/monthOrders.length):'—';
  $id('rv-paymob').textContent=money(paymob);
}

export function orderCostSnapshotValue(o){
  // Supports multiple possible column names so n8n/Supabase can evolve without breaking the dashboard.
  var candidates = [
    o.inventory_cost_snapshot,
    o.inventory_value_snapshot,
    o.inventory_value_at_bosta,
    o.product_cost_snapshot,
    o.products_cost_snapshot,
    o.manufacturer_cost_snapshot
  ];
  for(var i=0;i<candidates.length;i++){
    var n=Number(candidates[i]||0);
    if(n>0)return n;
  }
  return 0;
}

export function hasCostSnapshot(o){
  return orderCostSnapshotValue(o)>0;
}

export function orderLiveInventoryCost(o){
  var items=parseProductItems(o.product_name||'');
  return items.reduce(function(sum,it){
    return sum + (productCostByName(it.name) * (it.qty||1));
  },0);
}

export function orderInventoryCost(o){
  // Prefer locked snapshot if workflow stored it at shipping time.
  // Fallback to live stock_products.wholesale_price × qty for backward compatibility.
  var snap=orderCostSnapshotValue(o);
  if(snap>0)return snap;
  return orderLiveInventoryCost(o);
}

export function orderInventoryCostSource(o){
  return hasCostSnapshot(o) ? 'Snapshot محفوظ وقت الشحن' : 'Live من أسعار المخزون الحالية';
}

export function loadStockProductsForCosts(done){
  if(!isAdmin()){done&&done();return;}
  // Skip the load only if stockProducts is BOTH non-empty AND has wholesale_price
  // populated. Some code paths (order-detail modal) load a narrower projection
  // without wholesale_price — that would make every COGS lookup return 0.
  var hasFullData = stockProducts && stockProducts.length &&
                    stockProducts.some(function(p){ return p.hasOwnProperty('wholesale_price'); });
  if(hasFullData){done&&done();return;}
  sb.from('v_stock_products')
    .select('id,name,current_qty,wholesale_price,unit_price,active')
    .eq('tenant_id',currentTenantId)
    .eq('active',true)
    .then(function(r){
      if(!r.error && r.data)stockSetProducts(r.data);
      done&&done();
    });
}

export function ordersPeriodCairoDates(){
  var p=ordersPeriod;
  if(p.type==='all') return null;
  var today=cairoYMD(new Date());
  if(p.type==='last3')  return { from: ymdAddDays(today,-2),  to: today };
  if(p.type==='last30') return { from: ymdAddDays(today,-29), to: today };
  if(p.type==='month'){
    var y=+today.slice(0,4), m=+today.slice(5,7), last=new Date(y,m,0).getDate();
    return { from: today.slice(0,7)+'-01', to: today.slice(0,7)+'-'+('0'+last).slice(-2) };
  }
  if(p.type==='custom'){ var f=p.from||'2000-01-01', t=p.to||'2999-12-31'; if(f>t){var x=f;f=t;t=x;} return { from:f, to:t }; }
  return null;
}

// يطبّق ناتج RPC على كروت الإحصائيات والإيرادات (بنفس معادلات updateStats/updateRevenueStats بالظبط)
export function applyOrdersStats(s){
  if(tourActive || !s) return;   // لو وصل متأخر أثناء الجولة → ماتلمسش الديمو
  $id('s0').textContent=num(s.total_count);
  $id('s1').textContent=num(s.pending);
  $id('s2').textContent=num(s.confirmed);
  $id('s3').textContent=num(s.delivered);
  $id('s4').textContent=num(s.cancelled);
  $id('s5').textContent=num(s.returned);
  $id('s-ready').textContent=num(s.bosta_ready);
  $id('s6').textContent = s.processed>0 ? ((s.positive/s.processed)*100).toFixed(1)+'%' : '—';
  var dd=(s.delivered||0)+(s.returned||0);
  $id('s7').textContent = dd>0 ? ((s.delivered/dd)*100).toFixed(1)+'%' : '—';
  $id('rv-total').textContent=money(s.sum_total);
  $id('rv-collected').textContent=money(s.sum_collected);
  $id('rv-expected').textContent=money(s.sum_expected);
  $id('rv-lost').textContent=money(s.sum_lost);
  $id('rv-aov').textContent = s.total_count ? money(s.sum_total/s.total_count) : '—';
  $id('rv-paymob').textContent=money(s.sum_paymob);
  var pc=$id('orders-period-cnt');
  if(pc) pc.textContent = ordersPeriod.type==='all' ? num(s.total_count)+' طلب (كل الفترات)' : num(s.total_count)+' طلب في المدة';
}

// كروت الأوردرات (s0..s7 + الإيرادات + عدّاد المدة) في نداء RPC واحد
export function loadOrdersCards(){
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  var d=ordersPeriodCairoDates();
  sb.rpc('sahl_orders_stats',{ p_tenant: currentTenantId, p_from: d?d.from:null, p_to: d?d.to:null }).then(function(r){
    if(tourActive) return;
    if(r.error || !r.data){ if(r.error&&r.error.message) console.warn('stats RPC:',r.error.message); return; }
    applyOrdersStats(r.data);
  });
}

// تنبيه الدمج: عملاء معاهم أوردرين+ جاهزين للشحن — كويري مخصّص بدل المصفوفة الكاملة
export var MERGE_QUERY_STATUSES = ['bosta_assigned','BOSTA AUTO','bosta_auto','BOSTA2','bosta2'];

export function loadMergeCandidates(){
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  sb.from('orders').select('order_uid,tracking_no,customer_name,city,phone,total_cost,status')
    .eq('tenant_id',currentTenantId).in('status',MERGE_QUERY_STATUSES).then(function(r){
      if(tourActive) return;
      if(r.error) return;
      pendingBostaByPhone={};
      (r.data||[]).forEach(function(o){
        var p=normalizePhone(o.phone); if(!p)return;
        if(!pendingBostaByPhone[p]) pendingBostaByPhone[p]=[];
        pendingBostaByPhone[p].push(o);
      });
      detectMergeable();
    });
}

// كارت "بضاعة مع بوسطة": تكلفة بضاعة الأوردرات في تشغيل بوسطة — كويري مخصّص
export function loadBostaInventoryCard(){
  var el=$id('rv-bosta-stock'); if(!el) return;
  var sub=$id('rv-bosta-stock-sub');
  if(!isAdmin()){ el.textContent='—'; if(sub)sub.textContent='للأدمن فقط'; return; }
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  loadStockProductsForCosts(function(){
    sb.from('orders').select('product_name,inventory_cost_snapshot,inventory_value_snapshot,inventory_value_at_bosta,status')
      .eq('tenant_id',currentTenantId).in('status',BOSTA_OPERATION_STATUSES).then(function(r){
        if(tourActive) return;
        if(r.error) return;
        var orders=r.data||[];
        var total=orders.reduce(function(s,o){return s+orderInventoryCost(o);},0);
        el.textContent=money(total);
        if(sub)sub.textContent=num(orders.length)+' شحنة في التشغيل حاليًا';
      });
  });
}

// تحميل كل الأوردرات للذاكرة عند الحاجة فقط (الماليات/الإحصائيات بتحسب على كل الفترة).
export function ensureAllLoaded(cb){
  if(tourActive){ cb&&cb(); return; }            // الجولة: all = بيانات ديمو محمّلة بالفعل
  if(allLoaded){ cb&&cb(); return; }
  if(!sb||!currentTenantId){ cb&&cb(); return; }
  // ⚠️ مهم: select() من غير range بيتوقف عند سقف PostgREST (١٠٠٠ صف) في صمت —
  // وده كان بيخلّي الماليات والإحصائيات تتحسب على جزء من البيانات من غير أي تحذير.
  // بنسحب على دفعات لحد ما الداتا تخلص.
  var CHUNK = 1000, acc = [], fromIdx = 0, MAXROWS = 200000;
  (function pull(){
    sb.from('orders').select('*').eq('tenant_id',currentTenantId)
      .order('created_at',{ascending:false})
      .range(fromIdx, fromIdx + CHUNK - 1)
      .then(function(r){
        if(r.error){ toast('خطأ في تحميل البيانات: '+r.error.message,'er'); cb&&cb(); return; }
        var got = r.data || [];
        acc = acc.concat(got);
        if(got.length === CHUNK && acc.length < MAXROWS){ fromIdx += CHUNK; pull(); return; }
        all = acc; allLoaded = true;
        try{ buildIndexes(); }catch(e){ swallow('pull/buildIndexes', e); }           // phoneCounts كامل
        cb&&cb();
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
  all=[]; allLoaded=false;
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
    realtimeChannel = null;
  }
  realtimeChannel = sb
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
    });
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
  phoneCounts={};
  pendingBostaByPhone={};
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

// Customers with 2+ orders all in "bosta_assigned" status — can be merged into one shipment
export var mergeableCustomers = []; // [{ phone, name, orders: [...] }]

export function detectMergeable(){
  mergeableCustomers = [];
  Object.keys(pendingBostaByPhone).forEach(function(phone){
    var orders = pendingBostaByPhone[phone];
    if(orders.length >= 2){
      mergeableCustomers.push({
        phone: phone,
        name: orders[0].customer_name || 'عميل',
        city: orders[0].city || '',
        orders: orders,
        totalCost: orders.reduce(function(s,o){return s+(o.total_cost||0);},0)
      });
    }
  });
  renderMergeAlert();
}

export function renderMergeAlert(){
  var container = $id('merge-alert-container');
  if(!container) return;
  if(!mergeableCustomers.length){
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  var totalDuplicateOrders = mergeableCustomers.reduce(function(s,c){return s+c.orders.length;},0);
  var savings = mergeableCustomers.reduce(function(s,c){return s+(c.orders.length-1);},0); // shipments saved
  var h = '<div class="merge-alert">'
    + '<div class="merge-alert-header">'
    +   '<div class="merge-alert-icon">⚠️</div>'
    +   '<div class="merge-alert-title">انتبه يا ريس! فيه عملاء معاهم أوردرات متعددة جاهزة للشحن</div>'
    +   '<div class="merge-alert-count">'+mergeableCustomers.length+' عميل</div>'
    + '</div>';
  mergeableCustomers.forEach(function(c){
    var chips = c.orders.map(function(o){
      return '<span class="merge-order-chip">#'+(o.order_uid||o.tracking_no||'?')+'</span>';
    }).join('');
    h += '<div class="merge-customer">'
      + '<div style="flex:1">'
      +   '<div class="merge-cust-name">'+esc(c.name)+(c.city?' — '+esc(c.city):'')+'</div>'
      +   '<div class="merge-cust-meta">📱 '+esc(c.phone)+' · 💰 '+num(c.totalCost)+' ج · '+c.orders.length+' أوردرات</div>'
      + '</div>'
      + '<div class="merge-cust-orders">'+chips+'</div>'
      + '<button class="merge-show-btn" data-phone="'+esc(c.phone)+'">👁️ اعرض الأوردرات</button>'
      + '</div>';
  });
  h += '<div class="merge-savings">💡 لو دمجتهم في شحنة واحدة لكل عميل، هتوفر تكلفة شحن لـ '+savings+' شحنة!</div>';
  h += '</div>';
  container.innerHTML = h;
  container.style.display = 'block';
  // Wire up "show orders" buttons — filter table by phone
  container.querySelectorAll('.merge-show-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var phone = b.getAttribute('data-phone');
      $id('qinp').value = phone;
      $id('fst').value = ''; $id('fpl').value = ''; $id('fpy').value = '';
      if(window.__syncFilterUI)window.__syncFilterUI();
      doFilter();
      window.scrollTo({top: $id('fbar') ? $id('fbar').offsetTop - 80 : 200, behavior:'smooth'});
      toast('عرض أوردرات هذا العميل','ok');
    });
  });
}

export function customerOrderCount(o){
  var p=normalizePhone(o.phone);
  return p ? (phoneCounts[p]||1) : 1;
}

// Statuses shown under OPERATION filter — official Bosta API movement statuses only; excludes Delivered and internal Bosta statuses
export var OPERATION_STATUSES = BOSTA_OPERATION_STATUSES;

// ===== Server-side orders pagination =====
export var totalCount = 0;                 // إجمالي الأوردرات المطابقة للفلتر (من عدّاد السيرفر)

export var ordersLoading = false;

export var BOSTA_FILTER_STATUSES = ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2'];

// الأعمدة اللي الجدول + المؤقّت محتاجينها فقط (مفيش select('*'))
// حدود سمعة العميل من بوسطة (سهل تغييرها): >= جامد، >= متوسط، أقل = زبالة
export var RANK_GOOD = 80, RANK_MID = 50;

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
  cur=1;
  fetchOrdersPage();
}

export function fetchOrdersPage(){
  if(tourActive) return;                 // الجولة بترسم بيانات الديمو عبر doFilter()
  if(!ensureTenant()) return;
  ordersLoading = true;
  $id('tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري التحميل...</div>';
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
    ordersLoading=false;
    refreshCancelBar();
    if(r.error){
      toast('خطأ في تحميل الأوردرات: '+r.error.message,'er');
      $id('tbody').innerHTML='<div class="ldg">تعذّر تحميل الأوردرات. اضغط ↻ تحديث وحاول تاني.</div>';
      $id('pag').style.display='none';
      return;
    }
    fil=r.data||[];
    totalCount=(typeof r.count==='number')?r.count:fil.length;
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
    cur=1; totalCount=f.length; fil=f.slice(0,PS);
    $id('fcnt').textContent=f.length!==base.length?num(f.length)+' نتيجة':num(base.length)+' طلب';
    var pc=$id('orders-period-cnt'); if(pc) pc.textContent=ordersPeriod.type==='all'?num(all.length)+' طلب (كل الفترات)':num(base.length)+' طلب في المدة';
    renderTable();
    return;
  }
  // الوضع العادي: عدّاد المدة بيتحدّث من الـ RPC (loadOrdersCards). هنا بس نجيب صفحة الجدول.
  cur=1;
  fetchOrdersPage();
}

// Get deadline ISO string ONLY if order is pending and has call attempts
// Returns '' if order is not pending, or has no calls, or deadline already passed long ago
// Parse status_log safely — Supabase sometimes returns it as a JSON string
export function parseStatusLog(val){
  if(!val) return [];
  if(Array.isArray(val)) return val;
  // May be a JSON string, or even a double-encoded JSON string ("\"[...]\"")
  var v = val;
  for(var i=0;i<3;i++){
    if(Array.isArray(v)) return v;
    if(typeof v !== 'string') return [];
    try{ v = JSON.parse(v); }catch(e){ return []; }
  }
  return Array.isArray(v) ? v : [];
}

export function getCallDeadline(o){
  // Timer only runs for pending orders
  if(!o || o.status !== 'pending') return '';
  if(!Array.isArray(o.call_attempts) || !o.call_attempts.length) return '';
  var last = o.call_attempts[o.call_attempts.length - 1];
  if(!last || !last.iso) return '';
  var deadline = new Date(new Date(last.iso).getTime() + CALL_WAIT_MS);
  return deadline.toISOString();
}

export function renderTable(){
  var st=(cur-1)*PS, pg=fil;   // fil = الصفحة الحالية (جاية من السيرفر مباشرة)
  if(!totalCount){$id('tbody').innerHTML='<div class="ldg">مفيش أوردرات مطابقة للبحث أو الفلتر.</div>';$id('pag').style.display='none';return;}
  if(!pg.length){$id('tbody').innerHTML='<div class="ldg">لا توجد نتائج في هذه الصفحة</div>';}
  // NEW COLUMN ORDER: رقم الطلب - رقم التتبع - اسم العميل - موبايل أساسي - موبايل إضافي - المدينة - العنوان - المنتج - الحالة - التاريخ
  // Default column widths (saved per-user in localStorage)
  var DEFAULT_WIDTHS = {cb:42,uid:100,track:110,name:160,phone:120,alt:120,city:100,addr:240,prod:200,pay:75,status:120,timer:90,date:90};
  var widths;
  try{ widths = JSON.parse(localStorage.getItem('sb_cols')||'null'); }catch(e){ widths = null; }
  if(!widths) widths = Object.assign({},DEFAULT_WIDTHS);
  if(!widths.pay)widths.pay=75;
  if(!widths.timer)widths.timer=90;

  var h='<table><colgroup>'
    +'<col style="width:'+widths.cb+'px">'
    +'<col style="width:'+widths.uid+'px">'
    +'<col style="width:'+widths.track+'px">'
    +'<col style="width:'+widths.name+'px">'
    +'<col style="width:'+widths.phone+'px">'
    +'<col style="width:'+widths.alt+'px">'
    +'<col style="width:'+widths.city+'px">'
    +'<col style="width:'+widths.addr+'px">'
    +'<col style="width:'+widths.prod+'px">'
    +'<col style="width:'+widths.pay+'px">'
    +'<col style="width:'+widths.status+'px">'
    +'<col style="width:'+widths.timer+'px">'
    +'<col style="width:'+widths.date+'px">'
    +'</colgroup>'
    +'<thead><tr>'
    +'<th class="cbcol"><input type="checkbox" class="cb" id="cb-all"></th>'
    +'<th data-col="uid">رقم الطلب<div class="col-resize" data-col="uid"></div></th>'
    +'<th data-col="track">رقم التتبع<div class="col-resize" data-col="track"></div></th>'
    +'<th data-col="name">اسم العميل<div class="col-resize" data-col="name"></div></th>'
    +'<th data-col="phone">موبايل أساسي<div class="col-resize" data-col="phone"></div></th>'
    +'<th data-col="alt">موبايل إضافي<div class="col-resize" data-col="alt"></div></th>'
    +'<th data-col="city">المدينة<div class="col-resize" data-col="city"></div></th>'
    +'<th data-col="addr">العنوان<div class="col-resize" data-col="addr"></div></th>'
    +'<th data-col="prod">المنتج<div class="col-resize" data-col="prod"></div></th>'
    +'<th data-col="pay">الدفع<div class="col-resize" data-col="pay"></div></th>'
    +'<th data-col="status">الحالة<div class="col-resize" data-col="status"></div></th>'
    +'<th data-col="timer">⏱ المكالمة<div class="col-resize" data-col="timer"></div></th>'
    +'<th data-col="date">التاريخ<div class="col-resize" data-col="date"></div></th>'
    +'</tr></thead><tbody>';
  for(var i=0;i<pg.length;i++){
    var o=pg[i],s=o.status||'pending';
    var checked=selectedIds.has(o.id)?'checked':'';
    var classes=[];
    if(selectedIds.has(o.id))classes.push('sel');
    if(o.customer_notes&&o.customer_notes.trim())classes.push('has-note');
    if(o.internal_notes&&o.internal_notes.trim())classes.push('has-int-note');
    if(o.cancel_requested_at && !o.cancel_resolved_at)classes.push('cancel-req');
    var clsAttr=classes.length?' class="'+classes.join(' ')+'"':'';
    var noteIcon=(o.customer_notes&&o.customer_notes.trim())?'<span class="note-icon" title="يوجد ملاحظة من العميل">📝</span>':'';
    var vipCount=customerOrderCount(o);
    var vipBadge=vipCount>1?'<span class="vip-badge" title="عميل متكرر — '+vipCount+' طلبات">×'+vipCount+'</span>':'';
    var rankBadge='';
    if(o.customer_ranking !== null && o.customer_ranking !== undefined && o.customer_ranking !== ''){
      var _rk=Number(o.customer_ranking);
      if(!isNaN(_rk)){
        var _rkCls=_rk>=RANK_GOOD?'rk-good':(_rk>=RANK_MID?'rk-mid':'rk-bad');
        var _rkLbl=_rk>=RANK_GOOD?'جامد':(_rk>=RANK_MID?'متوسط':'زبالة');
        rankBadge='<span class="rk-badge '+_rkCls+'" title="نسبة استلام العميل عبر بوسطة: '+_rk.toFixed(1)+'%">'+_rkLbl+'</span>';
      }
    }
    var cancelBadge = (o.cancel_requested_at && !o.cancel_resolved_at)
      ? '<span class="cx-badge" title="العميل طلب إلغاء الأوردر بعد ما كان مؤكد — '+esc(fmtD(o.cancel_requested_at))+'">\u26A0 طلب إلغاء</span>'
      : '';
    var locked = walletStateCache && walletStateCache.is_depleted;
    var addrTitle = locked ? '' : esc(fmt(o.address));
    var prodTitle = locked ? '' : esc(fmt(o.product_name));
    h+='<tr data-id="'+o.id+'"'+clsAttr+'>'
      +'<td class="cbcol"><input type="checkbox" class="cb cb-row" data-id="'+o.id+'" '+checked+'></td>'
      +'<td class="id">'+noteIcon+esc(fmt(o.order_uid))+cancelBadge+'</td>'
      +'<td class="mn awb-cell">'+(o.tracking_no?esc(o.tracking_no)+'<button class="awb-btn" data-id="'+o.id+'" title="طبع بوليصة بوسطة">🖨️</button>'+(o.awb_print_count>0?'<span class="awb-printed-badge" title="مطبوع '+o.awb_print_count+' مرة'+(o.awb_printed_at?' — آخر طباعة: '+fmtD(o.awb_printed_at):'')+'">✓×'+o.awb_print_count+'</span>':''):'<span class="notrack">في الانتظار</span>')+'</td>'
      +'<td class="nm">'+vipBadge+lockMaybe(fmt(o.customer_name))+rankBadge+'</td>'
      +'<td class="mn">'+lockMaybe(fmt(o.phone))+'</td>'
      +'<td class="mn">'+lockMaybe(fmt(o.alt_phone))+'</td>'
      +'<td>'+lockMaybe(fmt(o.city))+'</td>'
      +'<td class="addr" title="'+addrTitle+'">'+lockMaybe(short(o.address,45))+'</td>'
      +'<td class="pr" title="'+prodTitle+'">'+lockMaybe(short(o.product_name,30))+(!locked&&o['var']&&String(o['var']).trim()?'<span class="var-badge" title="اللون / المقاس: '+esc(String(o['var']))+'">'+esc(short(String(o['var']),18))+'</span>':'')+'</td>'
      +'<td class="pay'+(o.payment_stage==='paymob'?' paid':'')+'">'+(o.payment_stage==='paymob'?'<span class="pay-badge">مدفوع</span>':'<span class="pay-cod">COD</span>')+'</td>'
      +'<td><span class="badge '+statusClass(s)+'"><span class="bdot"></span>'+statusLabel(s)+'</span></td>'
      +'<td class="timer-cell" data-deadline="'+getCallDeadline(o)+'" data-id="'+o.id+'"></td>'
      +'<td class="mn">'+fmtD(o.created_at)+'</td>'
      +'</tr>';
  }
  h+='</tbody></table>';
  $id('tbody').innerHTML=h;
  startTimerTick(); // start/restart the 1-second countdown ticker

  $id('tbody').querySelectorAll('tr[data-id]').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.classList.contains('cb-row')||e.target.classList.contains('cbcol')||e.target.classList.contains('awb-btn'))return;
      openDetail(row.getAttribute('data-id'));
    });
  });
  $id('tbody').querySelectorAll('.cb-row').forEach(function(cb){
    cb.addEventListener('click',function(e){e.stopPropagation();});
    cb.addEventListener('change',function(){
      var id=cb.getAttribute('data-id');
      if(cb.checked)selectedIds.add(id);else selectedIds.delete(id);
      var tr=cb.closest('tr');if(tr)tr.classList.toggle('sel',cb.checked);
      updateBulkBar();updateMasterCb();
    });
  });
  
  // أزرار طباعة AWB لكل صف
  $id('tbody').querySelectorAll('.awb-btn').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var id = btn.getAttribute('data-id');
      if(id && typeof printAwbForOrders === 'function'){
        printAwbForOrders([id], btn);
      }
    });
  });
  var cbAll=$id('cb-all');
  if(cbAll){
    updateMasterCb();
    cbAll.addEventListener('change',function(){
      $id('tbody').querySelectorAll('.cb-row').forEach(function(cb){
        cb.checked=cbAll.checked;
        var id=cb.getAttribute('data-id');
        if(cbAll.checked)selectedIds.add(id);else selectedIds.delete(id);
        var tr=cb.closest('tr');if(tr)tr.classList.toggle('sel',cbAll.checked);
      });
      updateBulkBar();
    });
  }

  var tp=Math.max(1,Math.ceil(totalCount/PS));
  $id('pag').style.display='flex';
  $id('pinf').textContent=(st+1)+'–'+Math.min(st+PS,totalCount)+' من '+num(totalCount);
  var pr=pRange(cur,tp);
  var pb='<button class="pbtn" data-p="'+(cur-1)+'" '+(cur===1?'disabled':'')+'>‹</button>';
  pr.forEach(function(p){
    if(p==='…')pb+='<span style="padding:6px 7px;color:var(--muted)">…</span>';
    else pb+='<button class="pbtn'+(p===cur?' act':'')+'" data-p="'+p+'">'+p+'</button>';
  });
  pb+='<button class="pbtn" data-p="'+(cur+1)+'" '+(cur===tp?'disabled':'')+'>›</button>';
  $id('pbtns').innerHTML=pb;
  $id('pbtns').querySelectorAll('button').forEach(function(b){
    b.addEventListener('click',function(){goPage(parseInt(b.getAttribute('data-p')));});
  });

  // Column resize handlers
  $id('tbody').querySelectorAll('.col-resize').forEach(function(handle){
    handle.addEventListener('mousedown',function(e){
      e.preventDefault();e.stopPropagation();
      var col=handle.getAttribute('data-col');
      var th=handle.closest('th');
      var startX=e.clientX;
      var startW=th.offsetWidth;
      handle.classList.add('dragging');
      function onMove(ev){
        // RTL: dragging left = wider (because handle is on the left edge in RTL)
        var dx=startX-ev.clientX;
        var newW=Math.max(50,startW+dx);
        // Update colgroup col element
        var cols=$id('tbody').querySelectorAll('col');
        var colIdx=Array.from(th.parentNode.children).indexOf(th);
        if(cols[colIdx])cols[colIdx].style.width=newW+'px';
        widths[col]=newW;
      }
      function onUp(){
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
        handle.classList.remove('dragging');
        localStorage.setItem('sb_cols',JSON.stringify(widths));
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
  });
}

export function updateMasterCb(){
  var cbAll=$id('cb-all');if(!cbAll)return;
  var rows=$id('tbody').querySelectorAll('.cb-row');
  if(!rows.length){cbAll.checked=false;return;}
  var checked=0;rows.forEach(function(cb){if(cb.checked)checked++;});
  cbAll.checked=checked===rows.length;
  cbAll.indeterminate=checked>0&&checked<rows.length;
}

export function updateBulkBar(){
  var n=selectedIds.size;
  $id('bulkbar').classList.toggle('show',n>0);
  $id('bcnt').textContent=num(n)+' طلب محدد';
}

// زرار "حدد غير المطبوع" — يظهر بس في فلتر بوسطة/OPERATION ويحدّد كل اللي لسه ماتطبعش
export function updateUnprintedBtn(){
  var btn = $id('bb-sel-unprinted');
  if(!btn) return;
  var st = $id('fst') ? $id('fst').value : '';
  var relevant = (st === 'bosta_assigned' || st === '__operation__');
  if(!relevant){ btn.classList.remove('show'); return; }
  var cnt = 0;
  (fil||[]).forEach(function(o){
    if(o.tracking_no && String(o.tracking_no).trim() && !(o.awb_print_count > 0)) cnt++;
  });
  if(cnt > 0){
    btn.classList.add('show');
    btn.textContent = '✓ حدد غير المطبوع (' + num(cnt) + ')';
  } else {
    btn.classList.remove('show');
  }
}

export function goPage(p){var tp=Math.max(1,Math.ceil(totalCount/PS));if(p<1||p>tp)return;cur=p;if(tourActive){renderTable();}else{fetchOrdersPage();}window.scrollTo({top:0,behavior:'smooth'});}

export function buildWaUrl(o){
  var phone=normalizePhone(o.phone);
  if(!phone)return null;
  var fn=firstName(o.customer_name);
  var msg='استاذة '+fn+' صباح الخير يافندم .. حاولنا نتصل بحضرتك بخصوص الاوردر بس مكانش في رد .. حضرتك تحبي نشحن الاوردر يافندم ؟\n\nالاوردر : '+(o.product_name||'');
  return 'https://web.whatsapp.com/send?phone=20'+phone+'&text='+encodeURIComponent(msg);
}

export function openDetail(id){
  // Guard: when the wallet is depleted, sensitive data is locked across the app.
  if(walletStateCache && walletStateCache.is_depleted && !tourActive){
    toast('بياناتك مقفلة لحد ما تشحن المحفظة','er');
    try{ showPage('billing'); }catch(e){ swallow('openDetail/showPage', e); }
    return;
  }
  if(tourActive){
    // الجولة: الأوردر موجود في بيانات الديمو في الذاكرة
    sel=null;for(var i=0;i<all.length;i++){if(all[i].id===id){sel=all[i];break;}}
    if(!sel)return;
    detailHistory=computeHistoryFromAll(sel);
    renderDetail();
    return;
  }
  if(!sb||!currentTenantId)return;
  // الجدول عنده أعمدة محدودة بس → نجيب الأوردر كامل من السيرفر بالـ id
  sel=null; detailHistory=null;
  $id('dtit').textContent='جاري التحميل...';
  $id('dcnt').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل تفاصيل الطلب...</div>';
  $id('ovl').classList.add('open');
  sb.from('orders').select('*').eq('id',id).eq('tenant_id',currentTenantId).single().then(function(r){
    if(r.error || !r.data){ toast('تعذّر تحميل تفاصيل الطلب','er'); $id('ovl').classList.remove('open'); return; }
    sel=r.data;
    loadDetailHistory(sel, function(){ renderDetail(); });
  });
}

// ملخّص طلبات العميل من الذاكرة (للجولة)
export function computeHistoryFromAll(o){
  var p=normalizePhone(o.phone);
  if(!p) return {count:1, delivered:0, cancelled:0};
  var same=all.filter(function(x){return normalizePhone(x.phone)===p;});
  var others=same.filter(function(x){return x.id!==o.id;});
  return { count: same.length,
    delivered: others.filter(function(x){return statusIn(x.status,DELIVERED_STATUSES);}).length,
    cancelled: others.filter(function(x){return statusIn(x.status,CANCELLED_STATUSES);}).length };
}

// ملخّص طلبات العميل من السيرفر بالتليفون (للبانر في شاشة التفاصيل)
export function loadDetailHistory(o, cb){
  detailHistory=null;
  if(!sb||!currentTenantId||!o.phone){ cb&&cb(); return; }
  sb.from('orders').select('id,status').eq('tenant_id',currentTenantId).eq('phone',o.phone).then(function(r){
    if(!r.error && r.data){
      var others=r.data.filter(function(x){return x.id!==o.id;});
      detailHistory={ count: r.data.length,
        delivered: others.filter(function(x){return statusIn(x.status,DELIVERED_STATUSES);}).length,
        cancelled: others.filter(function(x){return statusIn(x.status,CANCELLED_STATUSES);}).length };
    }
    cb&&cb();
  });
}

export function renderDetail(){
  var o=sel;
  if(!o)return;
  $id('dtit').textContent='طلب #'+(o.order_uid||o.tracking_no||o.id.slice(0,8));
  function dr(k,v){return'<div class="drow"><span class="dkey">'+k+'</span>'+v+'</div>';}

  var calls=Array.isArray(o.call_attempts)?o.call_attempts:[];
  var callsHtml='';
  if(calls.length){
    callsHtml='<div class="calls-list">';
    calls.forEach(function(c,idx){
      callsHtml+='<div class="call-item">'
        +'<span class="call-time">'+esc(c.time||'—')+'</span>'
        +'<div class="call-meta">'
        +'<span class="call-res '+(c.result||'no_answer')+'">'+(CR[c.result]||c.result||'—')+'</span>'
        +(c.note?'<span style="color:var(--txt)">— '+esc(c.note)+'</span>':'')
        +(c.by?'<span class="log-by">👤 '+esc(c.by)+'</span>':'')
        +'<button class="call-del" data-idx="'+idx+'">✕</button>'
        +'</div></div>';
    });
    callsHtml+='</div>';
  }else{
    callsHtml='<div class="calls-empty">لا توجد محاولات اتصال مسجلة</div>';
  }

  var cxBanner='';
  if(o.cancel_requested_at && !o.cancel_resolved_at){
    cxBanner='<div class="cx-banner">'
      +'<div class="cx-banner-txt">'
      +'<b>\u26A0 العميل طلب إلغاء الأوردر</b><br>'
      +'<span>الأوردر ما اتغيّرش ولا اتلغت بوليصة. كلّم العميل وقرّر — ولما تخلص دوس "تم التعامل".</span><br>'
      +'<span class="cx-banner-date">وقت الطلب: '+esc(fmtD(o.cancel_requested_at))+'</span>'
      +'</div>'
      +'<button class="cx-resolve-btn" id="cx-resolve">\u2713 تم التعامل</button>'
      +'</div>';
  } else if(o.cancel_requested_at && o.cancel_resolved_at){
    cxBanner='<div class="cx-banner cx-done">'
      +'<div class="cx-banner-txt"><b>\u2713 طلب إلغاء — تم التعامل معاه</b><br>'
      +'<span class="cx-banner-date">طلب: '+esc(fmtD(o.cancel_requested_at))+' \u00B7 اتقفل: '+esc(fmtD(o.cancel_resolved_at))+'</span></div>'
      +'</div>';
  }

  var waUrl=buildWaUrl(o);
  var hasCustomerNote = o.customer_notes && o.customer_notes.trim();

  // Returning customer detection (من كويري بالتليفون — مش من الذاكرة)
  var custCount=detailHistory?detailHistory.count:1;
  var vipBanner='';
  if(custCount>1){
    var prevDelivered=detailHistory?detailHistory.delivered:0;
    var prevCancelled=detailHistory?detailHistory.cancelled:0;
    vipBanner='<div class="vip-banner">'
      +'<div class="vip-banner-icon">⭐</div>'
      +'<div class="vip-banner-text">'
      +'<div class="vip-banner-title">عميل متكرر — مش أول طلب</div>'
      +'<div class="vip-banner-sub">طلب من قبل '+(custCount-1)+' مرة'
      +(prevDelivered>0?' · <span style="color:var(--teal)">'+prevDelivered+' تم تسليمها</span>':'')
      +(prevCancelled>0?' · <span style="color:var(--red)">'+prevCancelled+' ألغاها</span>':'')
      +'</div>'
      +'</div>'
      +'<button class="vip-show-btn" id="vip-show">إظهار التفاصيل</button>'
      +'<div class="vip-banner-count">×'+custCount+'</div>'
      +'</div>';
  }

  $id('dcnt').innerHTML=
    // WhatsApp button at top
    (waUrl?'<a class="wa-btn" id="wa-btn" href="'+esc(waUrl)+'" target="_blank" rel="noopener"><span class="wa-ico">📩</span> إرسال رسالة واتساب للعميل</a>':'')
    +cxBanner
    +vipBanner

    +'<div class="dsec"><div class="dstt">بيانات العميل</div>'
    +dr('الاسم',copyable(o.customer_name,'الاسم'))
    +(function(){
       if(o.customer_ranking===null||o.customer_ranking===undefined||o.customer_ranking==='')return '';
       var _rk=Number(o.customer_ranking); if(isNaN(_rk))return '';
       var _c=_rk>=RANK_GOOD?'rk-good':(_rk>=RANK_MID?'rk-mid':'rk-bad');
       var _l=_rk>=RANK_GOOD?'جامد':(_rk>=RANK_MID?'متوسط':'زبالة');
       return dr('سمعة العميل (بوسطة)','<span class="rk-badge '+_c+'" style="margin:0">'+_l+'</span> <span class="dval" style="font-family:\'JetBrains Mono\',monospace">'+_rk.toFixed(1)+'%</span>');
     })()
    +dr('الموبايل الأساسي',fieldEditable(o.phone,'الموبايل','phone'))
    +dr('الموبايل الإضافي',copyable(o.alt_phone,'الموبايل'))
    +dr('المدينة','<span class="dval ar">'+esc(fmt(o.city))+'</span>')
    +dr('العنوان',fieldEditable(o.address,'العنوان','address'))
    +'</div>'

    +'<div class="dsec"><div class="dstt">بيانات الطلب</div>'
    +dr('رقم الطلب','<span class="dval">'+esc(fmt(o.order_uid))+'</span>')
    +dr('رقم التتبع','<span class="dval">'+(o.tracking_no?esc(o.tracking_no):'<span style="color:var(--muted);font-style:italic">في انتظار بوسطة</span>')+'</span>')
    +'</div>'

    +'<div class="dsec"><div class="dstt">المنتجات</div>'
    +((o['var']&&String(o['var']).trim())?'<div class="drow"><span class="dkey">اللون / المقاس</span>'+copyable(String(o['var']),'اللون/المقاس')+'</div>':'')
    +'<div class="prod-list" id="prod-list"></div>'
    +'<button class="prod-add-btn" id="prod-add">+ إضافة منتج آخر</button>'
    +'<div class="save-row" style="margin-top:10px"><button class="save-btn" id="save-prod">💾 حفظ المنتجات</button><button class="copy-prod-btn" id="copy-prod">📋 نسخ كل المنتجات</button><span class="save-status" id="prod-status"></span></div>'
    +'</div>'

    +'<div class="dsec"><div class="dstt">تفاصيل إضافية</div>'
    +dr('المبلغ','<span class="dval" style="color:var(--txt);font-weight:600">'+(o.total_cost?num(o.total_cost)+' ج.م':'—')+'</span>')
    +(isAdmin()?dr('تكلفة البضاعة','<span class="dval" style="color:var(--ora);font-weight:800">'+money(orderInventoryCost(o))+'</span>'):'')
    +(isAdmin()?dr('مصدر التكلفة','<span class="dval ar">'+esc(orderInventoryCostSource(o))+'</span>'):'')
    +dr('الدفع','<span class="dval">'+esc(fmt(o.payment_stage))+'</span>')
    +dr('المنصة','<span class="dval">'+esc(fmt(o.platform))+'</span>')
    +dr('الحملة','<span class="dval" style="font-size:.76rem;direction:ltr">'+esc(fmt(o.campaign_name))+'</span>')
    +dr('تاريخ الإنشاء','<span class="dval">'+fmtDT(o.created_at)+'</span>')
    +'</div>'

    // CUSTOMER NOTES (from webhook) — highlighted yellow when present
    +'<div class="dsec"><div class="dstt">📌 ملاحظات العميل (من الويب هوك)</div>'
    +'<div class="notes-box'+(hasCustomerNote?' has-content':' notes-empty')+'">'+(hasCustomerNote?esc(o.customer_notes):'لا توجد ملاحظات من العميل')+'</div>'
    +'</div>'

    // INTERNAL NOTES (between employees) — editable
    +'<div class="dsec"><div class="dstt">💬 ملاحظات داخلية بين الموظفين</div>'
    +'<textarea class="int-notes" id="int-notes" placeholder="اكتب أي ملاحظات للموظفين الآخرين عن هذا الطلب...">'+esc(o.internal_notes||'')+'</textarea>'
    +'<div class="save-row"><button class="save-btn" id="save-notes">💾 حفظ الملاحظات</button><span class="save-status" id="save-status"></span></div>'
    +'</div>'

    +'<div class="dsec"><div class="dstt">📞 محاولات الاتصال ('+calls.length+'/9)</div>'
    +callsHtml
    +'<div class="add-call">'
    +'<select id="ca-res">'
    +'<option value="no_answer">لم يرد</option>'
    +'<option value="busy">مشغول</option>'
    +'<option value="refused">رفض</option>'
    +'<option value="confirmed">أكد</option>'
    +'<option value="callback">يعاود الاتصال</option>'
    +'</select>'
    +'<input type="text" id="ca-note" placeholder="ملاحظة (اختياري)">'
    +'<button id="ca-add">+ إضافة (الآن)</button>'
    +'</div></div>'

    +(function(){
      var slog=parseStatusLog(o.status_log);
      if(!slog.length)return '';
      // Build a chronologically-ordered copy so we can derive each entry's real
      // previous status from the entry before it (the stored "from" is often
      // a system marker like "البوت", not the actual prior status).
      var chrono = slog.slice().sort(function(a,b){
        return new Date(a.at||0) - new Date(b.at||0);
      });
      // System "from" markers that should NOT be displayed as the previous status.
      var SYS_FROM = ['البوت','Bosta API','السيستم','🤖','BOSTA AUTO'];
      function isSysFrom(v){
        if(!v) return true;
        for(var i=0;i<SYS_FROM.length;i++){ if(String(v).indexOf(SYS_FROM[i])>=0) return true; }
        return false;
      }
      // Compute real "from" for each entry = previous entry's "to".
      chrono.forEach(function(e,idx){
        if(idx>0){
          e._realFrom = chrono[idx-1].to;   // continuous chain
        } else {
          // First entry: keep its stored from unless it's a system marker.
          e._realFrom = isSysFrom(e.from) ? 'pending' : e.from;
        }
      });
      var rows='<div class="log-list">';
      chrono.slice().reverse().forEach(function(e){
        // Determine icon based on who made the change
        var byLabel = e.by || '—';
        var byIcon;
        var byClean = byLabel.replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}️ ]+/u, '').trim();
        if(byLabel.indexOf('السكانر') >= 0 || byLabel.indexOf('scanner') >= 0 || byLabel.indexOf('📷') >= 0){
          byIcon = '📷';
          byLabel = byClean || 'السكانر';
        } else if(byLabel.indexOf('واتساب') >= 0 || byLabel.indexOf('whatsapp') >= 0 || byLabel.indexOf('💬') >= 0){
          byIcon = '💬';
          byLabel = byClean || 'واتساب';
        } else if(byLabel.indexOf('البوت') >= 0 || byLabel.indexOf('Bosta API') >= 0 || byLabel.indexOf('السيستم') >= 0 || byLabel.indexOf('🤖') >= 0){
          byIcon = '⚙️';
          byLabel = byClean || 'السيستم';
        } else if(byLabel === 'manual' || byLabel === 'bulk'){
          byIcon = '👤';
        } else {
          byIcon = '👤';
        }
        var fromStatus = e._realFrom;
        rows+='<div class="log-item">'
          +'<span class="badge '+statusClass(fromStatus)+'"><span class="bdot"></span>'+statusLabel(fromStatus)+'</span>'
          +'<span class="log-arrow">←</span>'
          +'<span class="badge '+statusClass(e.to)+'"><span class="bdot"></span>'+statusLabel(e.to)+'</span>'
          +(e.reason?'<span style="color:var(--red);font-size:.76rem">— '+esc(e.reason)+'</span>':'')
          +'<span class="log-by">'+byIcon+' '+esc(byLabel)+'</span>'
          +'<span class="log-time">'+fmtDT(e.at)+'</span>'
          +'</div>';
      });
      rows+='</div>';
      return '<div class="dsec"><div class="dstt">📜 سجل تغييرات الحالة</div>'+rows+'</div>';
    })()
    +'<div class="dsec"><div class="dstt">تغيير الحالة</div>'
    +'<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge '+statusClass(o.status||'pending')+'" style="font-size:.88rem;padding:5px 12px"><span class="bdot"></span>'+statusLabel(o.status||'pending')+'</span>'
    +(o.status_changed_at?'<span style="color:var(--muted);font-size:.78rem">آخر تغيير: '+fmtDT(o.status_changed_at)+'</span>':'')
    +'</div>'
    +(o.status==='cancelled'&&o.cancel_reason?'<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#fecaca;font-size:.85rem"><b>سبب الإلغاء:</b> '+esc(o.cancel_reason)+'</div>':'')
    +'<select class="fsel" id="dsel" style="width:100%">'
    +STATUS_OPTIONS.map(function(s){return'<option value="'+s+'"'+(s===o.status?' selected':'')+'>'+statusLabel(s)+'</option>';}).join('')
    +'</select></div>'

    // 3 main action buttons: تأكيد - بوسطة - إلغاء
    +'<div class="dacts">'
    +'<button class="abtn ok" id="da-ok">✓ تأكيد</button>'
    +'<button class="abtn bs" id="da-bs">📦 بوسطة</button>'
    +'<button class="abtn cn" id="da-cn">✕ إلغاء</button>'
    +'</div>'
    +'<button class="abtn" id="da-up" style="width:100%;margin-top:8px;background:var(--sur);color:var(--txt)">تحديث الحالة المختارة ↑</button>';

  $id('da-ok').addEventListener('click',function(){doUpdate('confirmed');});
  $id('da-bs').addEventListener('click',function(){doUpdate('bosta_assigned');});
  $id('da-cn').addEventListener('click',function(){askCancelReason(function(reason){doUpdate('cancelled',reason);});});
  $id('da-up').addEventListener('click',function(){
    var v=$id('dsel').value;
    if(v==='cancelled'){askCancelReason(function(reason){doUpdate('cancelled',reason);});}
    else doUpdate(v);
  });
  $id('ca-add').addEventListener('click',addCallAttempt);
  $id('save-notes').addEventListener('click',saveInternalNotes);
  // Auto-save internal notes 1.2s after stop typing
  $id('int-notes').addEventListener('input',function(){
    clearTimeout(intNotesTimer);
    $id('save-status').textContent='يتم الحفظ تلقائياً...';
    $id('save-status').className='save-status';
    intNotesTimer=setTimeout(saveInternalNotes,1200);
  });
  $id('dcnt').querySelectorAll('.call-del').forEach(function(b){
    b.addEventListener('click',function(){deleteCallAttempt(parseInt(b.getAttribute('data-idx')));});
  });

  // Render and wire up products editor — load stock first if needed.
  // CRITICAL: must select wholesale_price too. If we don't, and the user
  // then opens Finance, loadStockProductsForCosts will skip its own load
  // (because stockProducts.length > 0) and every COGS lookup returns 0
  // because wholesale_price is undefined on these rows.
  if(!stockProducts || !stockProducts.length){
    sb.from('v_stock_products').select('id,name,current_qty,unit_price,wholesale_price').eq('tenant_id',currentTenantId).eq('active',true).order('current_qty',{ascending:false}).then(function(r){
      if(!r.error && r.data) stockSetProducts(r.data);
      renderProductsEditor(o.product_name||'');
    });
  } else {
    renderProductsEditor(o.product_name||'');
  }
  $id('prod-add').addEventListener('click', addEmptyProductRow);
  $id('save-prod').addEventListener('click',saveProducts);

  // Attach copy handlers for name/phone/address
  attachCopyHandlers();
  // تعديل الموبايل/العنوان + نسخ كل المنتجات بفورمات الأوردر
  attachFieldEditors();
  var _cpb=$id('copy-prod');
  if(_cpb){ _cpb.addEventListener('click',function(){
    var v=(sel['var']&&String(sel['var']).trim())?String(sel['var']).trim():'';
    var items=parseProductItems(sel.product_name||'');
    var txt=items.map(function(it){
      var line=it.name+' (عدد '+(it.qty||1)+')';
      return v?line+' - '+v:line;
    }).join(v?' | ':' - ');
    copyTextToClipboard(txt,'المنتجات');
  }); }

  // Wire up VIP show-history button if present
  var vipBtn=$id('vip-show');
  if(vipBtn){
    vipBtn.addEventListener('click',function(){
      var phone=normalizePhone(o.phone);
      if(!phone){toast('لا يوجد رقم موبايل','er');return;}
      // Close detail and filter table by this phone
      $id('ovl').classList.remove('open');sel=null;
      $id('qinp').value=phone;
      // Clear other filters to ensure all orders show
      $id('fst').value='';$id('fpl').value='';$id('fpy').value='';
      if(window.__syncFilterUI)window.__syncFilterUI();
      doFilter();
      window.scrollTo({top:0,behavior:'smooth'});
      toast('تم عرض كل طلبات العميل ⭐','ok');
    });
  }

  $id('ovl').classList.add('open');
}

export function parseProducts(str){
  if(!str)return [''];
  var parts=String(str).split(/\s*[\n]\s*\+\s*|\s*\n\s*/).filter(function(p){return p.trim().length>0;});
  return parts.length?parts:[''];
}

export function buildProductOptions(selected){
  // Build <option> list from stockProducts (already loaded when stock page loads)
  // If stock not loaded yet, just return one empty option
  var opts='<option value="">— اكتب يدوياً —</option>';
  if(stockProducts && stockProducts.length){
    stockProducts.forEach(function(p){
      var sel2=(selected && p.name===selected)?'selected':'';
      opts+='<option value="'+esc(p.name)+'" '+sel2+'>'+esc(p.name)+(p.current_qty!==undefined?' ('+num(p.current_qty)+' متاح)':'')+'</option>';
    });
  }
  return opts;
}

export function renderProductsEditor(str){
  var products=parseProducts(str);
  var list=$id('prod-list');
  if(!list)return;
  var h='';
  products.forEach(function(p,i){
    // Each product row: stock dropdown + quantity input + manual text override + delete button
    h+='<div class="prod-item" data-idx="'+i+'">'
      +'<select class="prod-select prod-input" data-idx="'+i+'" style="flex:2;min-width:140px;">'+buildProductOptions(p.replace(/\s*\(عدد\s*\d+\)\s*$/, '').trim())+'</select>'
      +'<input type="text" class="prod-qty" data-idx="'+i+'" placeholder="الكمية" style="flex:0 0 70px;min-width:60px;" value="'+(p.match(/\(عدد\s*(\d+)\)/)?p.match(/\(عدد\s*(\d+)\)/)[1]:'1')+'">'
      +(products.length>1?'<button class="prod-del" data-idx="'+i+'" title="حذف">✕</button>':'')
      +'</div>';
  });
  list.innerHTML=h;
  // If a product has a name that's not in stock list → show it as first option
  list.querySelectorAll('.prod-select').forEach(function(sel2,i){
    var rawVal=products[i]||'';
    var rawName=rawVal.replace(/\s*\(عدد\s*\d+\)\s*$/, '').trim();
    // If the name isn't in the dropdown options, add it as a custom option and select it
    var found=false;
    Array.from(sel2.options).forEach(function(o){if(o.value===rawName)found=true;});
    if(rawName && !found){
      var opt=document.createElement('option');
      opt.value=rawName;opt.textContent=rawName+' (مُدخل يدوياً)';opt.selected=true;
      sel2.insertBefore(opt, sel2.options[1]||null);
    }
  });
  list.querySelectorAll('.prod-del').forEach(function(b){
    b.addEventListener('click',function(){
      var prods=collectProducts();
      prods.splice(parseInt(b.getAttribute('data-idx')),1);
      if(!prods.length)prods=[''];
      renderProductsEditor(prods.join('\n+ '));
    });
  });
}

export function collectProducts(){
  var list=$id('prod-list');
  if(!list)return[];
  var rows=list.querySelectorAll('.prod-item');
  var arr=[];
  rows.forEach(function(row){
    var sel2=row.querySelector('.prod-select');
    var qtyInp=row.querySelector('.prod-qty');
    var name=(sel2?sel2.value:'').trim();
    var qty=qtyInp?parseInt(qtyInp.value)||1:1;
    if(name){
      arr.push(name+' (عدد '+qty+')'); // ALWAYS include quantity
    }
  });
  return arr;
}

// Add a completely fresh empty row to the product editor
export function addEmptyProductRow(){
  var list=$id('prod-list');
  if(!list)return;
  var idx=list.querySelectorAll('.prod-item').length;
  var div=document.createElement('div');
  div.className='prod-item';
  div.setAttribute('data-idx',idx);
  div.innerHTML='<select class="prod-select prod-input" data-idx="'+idx+'" style="flex:2;min-width:140px;">'+buildProductOptions('')+'</select>'
    +'<input type="text" class="prod-qty" data-idx="'+idx+'" placeholder="الكمية" style="flex:0 0 70px;min-width:60px;" value="1">'
    +'<button class="prod-del" data-idx="'+idx+'" title="حذف">✕</button>';
  list.appendChild(div);
  // Wire delete
  div.querySelector('.prod-del').addEventListener('click',function(){
    div.remove();
    // Re-enable delete on first item if now only 1 left
    var remaining=list.querySelectorAll('.prod-item');
    if(remaining.length===1) remaining[0].querySelector('.prod-del') && (remaining[0].querySelector('.prod-del').style.display='none');
  });
  div.querySelector('.prod-select').focus();
  // Show delete button on first row now that there are multiple
  list.querySelectorAll('.prod-item').forEach(function(r){
    var b=r.querySelector('.prod-del');
    if(b)b.style.display='';
  });
}

export function saveProducts(){
  if(!ensureTenant())return;
  if(!sel)return;
  var products=collectProducts();
  if(!products.length){toast('لا يمكن حفظ منتجات فارغة','er');return;}
  var combined = products.length===1 ? products[0] : products.join('\n+ ');

  // ─── Smart price update: only adjust by the DIFFERENCE between old and new product lists ───
  // This keeps the original price for any product not found in stock_products.
  function buildPriceMap(list){
    // Returns { "productName|qty": totalContribution } for products we know prices for
    var map = {};
    list.forEach(function(p){
      var match = p.match(/^(.+?)\s*\(عدد\s*(\d+)\)\s*$/);
      var name = match ? match[1].trim() : p.trim();
      var qty  = match ? parseInt(match[2]) : 1;
      var key  = name + '|' + qty;
      var stockItem = (stockProducts||[]).find(function(s){ return s.name === name; });
      if(stockItem && stockItem.unit_price){
        map[key] = (map[key] || 0) + stockItem.unit_price * qty;
      } else {
        map[key] = null; // unknown price — track presence only
      }
    });
    return map;
  }

  // Parse old product list (the one saved in the order before this edit)
  var oldProducts = parseProducts(sel.product_name || '');
  var oldMap = buildPriceMap(oldProducts);
  var newMap = buildPriceMap(products);

  // Calculate delta: sum of (new - old) for items where we have prices
  var delta = 0;
  var hasKnownChange = false;
  // Items added or increased
  Object.keys(newMap).forEach(function(key){
    if(newMap[key] === null) return; // skip unknown-price items
    var oldVal = oldMap[key] !== undefined ? (oldMap[key] || 0) : 0;
    if(oldMap[key] === undefined){
      // Brand new item → add its price
      delta += newMap[key];
      hasKnownChange = true;
    }
  });
  // Items removed
  Object.keys(oldMap).forEach(function(key){
    if(oldMap[key] === null || oldMap[key] === undefined) return;
    if(newMap[key] === undefined){
      // Removed item → subtract its price
      delta -= oldMap[key];
      hasKnownChange = true;
    }
  });

  var currentTotal = parseFloat(sel.total_cost) || 0;
  var newTotal = currentTotal + delta;
  if(newTotal < 0) newTotal = 0;

  var updateData = {product_name: combined};
  if(hasKnownChange) updateData.total_cost = newTotal;

  sb.from('orders').update(updateData).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){$id('prod-status').textContent='خطأ: '+r.error.message;$id('prod-status').className='save-status';return;}
    sel.product_name=combined;
    if(hasKnownChange) sel.total_cost=newTotal;
    for(var i=0;i<all.length;i++){
      if(all[i].id===sel.id){
        all[i].product_name=combined;
        if(hasKnownChange) all[i].total_cost=newTotal;
        break;
      }
    }
    var msg = '✓ تم الحفظ';
    if(hasKnownChange){
      var sign = delta >= 0 ? '+' : '';
      msg += ' — السعر: ' + num(newTotal) + ' ج (' + sign + num(delta) + ' ج)';
    }
    $id('prod-status').textContent = msg;
    $id('prod-status').className='save-status ok';
    setTimeout(function(){if($id('prod-status'))$id('prod-status').textContent='';},3500);
    loadOrdersCards();
    loadBostaInventoryCard();
    doFilter();
  });
}

export function saveInternalNotes(){
  if(!ensureTenant())return;
  if(!sel)return;
  var notes=$id('int-notes').value;
  sb.from('orders').update({internal_notes:notes}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){$id('save-status').textContent='خطأ: '+r.error.message;$id('save-status').className='save-status';return;}
    sel.internal_notes=notes;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].internal_notes=notes;break;}}
    $id('save-status').textContent='✓ تم الحفظ';
    $id('save-status').className='save-status ok';
    setTimeout(function(){if($id('save-status'))$id('save-status').textContent='';},2200);
  });
}

export function addCallAttempt(){
  if(!ensureTenant())return;
  if(!sel)return;
  var result=$id('ca-res').value;
  var note=$id('ca-note').value.trim();
  // Use exact current time — no datetime input, no timezone conversion needed
  var now = new Date();
  var isoNow = now.toISOString();
  var formatted = now.toLocaleString('ar-EG',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
  var calls=Array.isArray(sel.call_attempts)?sel.call_attempts.slice():[];
  calls.push({time:formatted, iso:isoNow, result:result, note:note, by: currentUser ? currentUser.name : '—'});
  sb.from('orders').update({call_attempts:calls}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    sel.call_attempts=calls;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].call_attempts=calls;break;}}
    toast('تم تسجيل المحاولة ✓','ok');
    renderDetail();
  });
}

export function deleteCallAttempt(idx){
  if(!ensureTenant())return;
  if(!sel)return;
  var calls=Array.isArray(sel.call_attempts)?sel.call_attempts.slice():[];
  calls.splice(idx,1);
  sb.from('orders').update({call_attempts:calls}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    sel.call_attempts=calls;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].call_attempts=calls;break;}}
    toast('تم الحذف','ok');
    renderDetail();
  });
}

export function doUpdate(ns,cancelReason){
  if(!ensureTenant())return;
  if(!sel)return;
  var id=sel.id;
  var nowISO=new Date().toISOString();
  var oldStatus=sel.status||'pending';
  var log=parseStatusLog(sel.status_log).slice();
  log.push({from:oldStatus,to:ns,at:nowISO,by: currentUser ? currentUser.name : 'manual',reason:cancelReason||null});
  var update={status:ns,status_changed_at:nowISO,status_log:log};
  if(ns==='cancelled'&&cancelReason){update.cancel_reason=cancelReason;}
  sb.from('orders').update(update).eq('id',id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    for(var i=0;i<all.length;i++){if(all[i].id===id){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=log;if(ns==='cancelled'&&cancelReason)all[i].cancel_reason=cancelReason;break;}}
    $id('ovl').classList.remove('open');sel=null;
    toast('تم تحديث الحالة ✓','ok');
    loadOrdersCards();loadBostaInventoryCard();doFilter();
  });
}

export function doBulkUpdate(ns){
  if(!ensureTenant())return;
  if(!ns||selectedIds.size===0)return;
  var ids=Array.from(selectedIds);
  var count=ids.length;
  showModal({
    icon: ns==='cancelled'?'❌': ns==='confirmed'?'✅':'🔄',
    title:'تغيير جماعي',
    sub:'سيتم تغيير حالة '+count+' طلب إلى "'+SL[ns]+'"\nمتأكد من التغيير؟',
    okLabel:'تأكيد التغيير',
    okColor: ns==='cancelled'?'linear-gradient(135deg,#ef4444,#dc2626)':'linear-gradient(135deg,var(--acc),var(--acc2))',
    onOk:function(){
  var nowISO=new Date().toISOString();
  var bulkReason = ns==='cancelled' ? 'إلغاء من المدير' : null;

  // نجيب حالة + سجل كل أوردر مختار من السيرفر (all مش متحمّل في صفحة الأوردرات)
  sb.from('orders').select('id,status,status_log').eq('tenant_id',currentTenantId).in('id',ids).then(function(res){
    if(res.error){ toast('خطأ: '+res.error.message,'er'); return; }
    var rows=res.data||[];
    if(!rows.length){ toast('تعذّر تحميل الأوردرات','er'); return; }
    var done=0, errors=0, n=rows.length;
    rows.forEach(function(ord){
      var oldStatus=ord.status||'pending';
      var log=parseStatusLog(ord.status_log).slice();
      log.push({from:oldStatus,to:ns,at:nowISO,by: (currentUser ? currentUser.name : 'bulk') + ' (جماعي)',reason:bulkReason});
      var update={status:ns,status_changed_at:nowISO,status_log:log};
      if(bulkReason)update.cancel_reason=bulkReason;
      sb.from('orders').update(update).eq('id',ord.id).eq('tenant_id',currentTenantId).then(function(r){
        done++;
        if(r.error){errors++;}
        else if(allLoaded){ for(var i=0;i<all.length;i++){if(all[i].id===ord.id){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=log;if(bulkReason)all[i].cancel_reason=bulkReason;break;}} }
        if(done===n){
          selectedIds.clear();updateBulkBar();
          if(errors)toast('تم تحديث '+(n-errors)+' من '+count+' (فيه '+errors+' خطأ)','er');
          else toast('تم تحديث '+count+' طلب ✓','ok');
          loadOrdersCards();loadBostaInventoryCard();doFilter();
        }
      });
    });
  });
    } // end onOk
  }); // end showModal
}

// زرار التحديث + بحث وفلاتر الأوردرات
export function initRefreshAndSearch(){
  $id('rbtn').addEventListener('click', function(){
    // Refresh whichever page is currently visible (not just orders).
    // Wallet is refreshed for everyone (admin + employee) because the depletion lock applies to both.
    var active = document.querySelector('.tnav-btn.active');
    var page = active ? active.getAttribute('data-page') : 'orders';
    if(page === 'stock'){
      loadStock();
      loadWalletState();
    } else if(page === 'finance'){
      loadFinance();
      loadWalletState();
    } else if(page === 'billing'){
      loadBilling();
    } else if(page === 'settings'){
      loadSettings();
    } else if(page === 'issues' && typeof loadIssues === 'function'){
      loadIssues();
      loadWalletState();
    } else {
      loadAll(); // orders (and everything it pulls in)
    }
  });
  $id('qinp').addEventListener('input',function(){clearTimeout(stm);stm=setTimeout(doFilter,240);});
  $id('fst').addEventListener('change',doFilter);
  $id('fpl').addEventListener('change',doFilter);
  $id('fpy').addEventListener('change',doFilter);

  // ---- custom animated filter dropdowns: native <select>s stay as the source of truth ----
}

export function fdropCloseAll(except){
  document.querySelectorAll('.fdrop.open').forEach(function(w){ if(w!==except) w.classList.remove('open'); });
}

export function enhanceFilters(){
  [{id:'fst',ic:'🏷️'},{id:'fpl',ic:'📣'},{id:'fpy',ic:'💳'}].forEach(function(cfg){
    var sel=$id(cfg.id); if(!sel||sel.__enhanced) return; sel.__enhanced=true;
    var wrap=document.createElement('div'); wrap.className='fdrop'; wrap.id=cfg.id+'-wrap';
    sel.parentNode.insertBefore(wrap,sel); wrap.appendChild(sel); sel.classList.add('fdrop-native');
    var btn=document.createElement('button'); btn.type='button'; btn.className='fdrop-btn';
    btn.innerHTML='<span class="fd-ic">'+cfg.ic+'</span><span class="fd-lbl"></span><span class="fd-chev">▾</span>';
    wrap.appendChild(btn);
    var panel=document.createElement('div'); panel.className='fdrop-panel'; wrap.appendChild(panel);
    Array.prototype.forEach.call(sel.options,function(opt){
      var it=document.createElement('button'); it.type='button'; it.className='fdrop-item';
      it.setAttribute('data-value',opt.value); it.appendChild(document.createTextNode(opt.textContent));
      it.addEventListener('click',function(ev){
        ev.stopPropagation();
        if(sel.value!==opt.value){ sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        sync(); wrap.classList.remove('open');
      });
      panel.appendChild(it);
    });
    function sync(){
      var o=sel.options[sel.selectedIndex]||sel.options[0];
      var lbl=wrap.querySelector('.fd-lbl'); if(lbl) lbl.textContent=o?o.textContent:'';
      wrap.classList.toggle('active', sel.value!=='');
      panel.querySelectorAll('.fdrop-item').forEach(function(it){ it.classList.toggle('sel', it.getAttribute('data-value')===sel.value); });
    }
    btn.addEventListener('click',function(ev){
      ev.stopPropagation();
      var willOpen=!wrap.classList.contains('open');
      fdropCloseAll(wrap); wrap.classList.toggle('open',willOpen);
    });
    sel.addEventListener('change',sync);
    sel.__fsync=sync; sync();
  });
}

// القوايم المنسدلة + شريط طلبات الإلغاء
export function initFilterDropdowns(){
  document.addEventListener('click',function(){ fdropCloseAll(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') fdropCloseAll(); });
  window.__syncFilterUI=function(){ ['fst','fpl','fpy'].forEach(function(id){ var s=$id(id); if(s&&s.__fsync)s.__fsync(); }); reflectStatusCards(); };
  (function(){ var b=$id('cxbar'); if(b) b.addEventListener('click', showCancelRequested); })();
  document.addEventListener('click', function(ev){ var t=ev.target; if(t && t.id==='cx-resolve'){ ev.preventDefault(); resolveCancelRequest(); } });
  enhanceFilters();
  wireBillingEvents();

  // ---- clickable status cards: tap a card to filter orders by that status (no-op during the demo/tour) ----
}

export function reflectStatusCards(){
  var v=$id('fst')?$id('fst').value:'';
  var map={pending:'s1',confirmed:'s2',delivered:'s3',cancelled:'s4',returned:'s5'};
  ['s0','s1','s2','s3','s4','s5'].forEach(function(sid){
    var el=$id(sid), card=el&&el.closest('.sc');
    if(card) card.classList.toggle('sc-on', map[v]===sid);
  });
}

export function wireStatusCards(){
  var map={s0:'',s1:'pending',s2:'confirmed',s3:'delivered',s4:'cancelled',s5:'returned'};
  Object.keys(map).forEach(function(sid){
    var val=map[sid], el=$id(sid); if(!el)return;
    var card=el.closest('.sc'); if(!card||card.__statusWired)return; card.__statusWired=true;
    card.classList.add('sc-clickable');
    card.addEventListener('click',function(e){
      if(e.target.closest('.sc-info'))return;  // keep the info "i" tooltip working
      if(tourActive)return;                    // demo: clicking does nothing
      var fst=$id('fst'); if(!fst)return;
      fst.value=val;
      fst.dispatchEvent(new Event('change',{bubbles:true}));  // runs doFilter + syncs UI + highlights card
      var anchor=$id('fbar'); if(anchor) window.scrollTo({top:Math.max(0,anchor.offsetTop-80),behavior:'smooth'});
    });
  });
}

// كروت الحالة وشريط الفترة والدرج والتحديد الجماعي
// ============================================================================
// AWB Printing — يطبع بوليصة بوسطة عبر Edge Function `bosta-print-awb`
// ============================================================================
export function _b64ToBlob(base64, mimeType){
  var byteChars = atob(base64);
  var byteArrays = [];
  var sliceSize = 512;
  for(var offset = 0; offset < byteChars.length; offset += sliceSize){
    var slice = byteChars.slice(offset, offset + sliceSize);
    var byteNumbers = new Array(slice.length);
    for(var i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, {type: mimeType});
}

export async function printAwbForOrders(orderIds, btnEl){
  if(!orderIds || orderIds.length === 0){ toast('اختار أوردرات الأول','er'); return; }
  if(tourActive){ toast('الطباعة مش متاحة في جولة التعريف','er'); return; }
  
  var origText = '';
  if(btnEl){ origText = btnEl.textContent; btnEl.disabled = true; btnEl.textContent = '⏳ جاري الطباعة...'; }
  
  try {
    var sessionResp = await sb.auth.getSession();
    var session = sessionResp && sessionResp.data && sessionResp.data.session;
    if(!session){ toast('لازم تسجل دخول الأول','er'); return; }
    
    var resp = await fetch(SUPABASE_URL + '/functions/v1/bosta-print-awb', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({order_ids: orderIds})
    });
    
    var data = await resp.json();
    
    if(!resp.ok){
      var msg = data.message || data.error || 'فشل طباعة البوليصة';
      if(data.bosta_status === 400 && /final state/i.test(msg)){
        msg = 'مينفعش تطبع بوالص أوردرات مسلّمة أو ملغية';
      }
      toast(msg, 'er');
      return;
    }
    
    if(!data.pdf_base64){ toast('بوسطة ما رجعتش PDF','er'); return; }
    
    var pdfBlob = _b64ToBlob(data.pdf_base64, 'application/pdf');
    var pdfUrl = URL.createObjectURL(pdfBlob);
    
    var win = window.open(pdfUrl, '_blank');
    if(!win){
      toast('السماح بفتح نوافذ جديدة في المتصفح الأول','er');
      // fallback: download
      var a = document.createElement('a');
      a.href = pdfUrl;
      a.download = 'awb-'+Date.now()+'.pdf';
      a.click();
      return;
    }
    
    // Auto-trigger print() لما الـ PDF يتحمل
    win.addEventListener('load', function(){
      setTimeout(function(){ try{ win.print(); }catch(e){ swallow('printAwbForOrders/win.print', e); } }, 600);
    });
    // backup trigger في حالة الـ load event ما اطلقش
    setTimeout(function(){ try{ win.focus(); win.print(); }catch(e){ swallow('printAwbForOrders/win.focus', e); } }, 1500);
    
    if(data.skipped_no_tracking && data.skipped_no_tracking > 0){
      toast('✅ اتطبع '+data.printed_count+' بوليصة ('+data.skipped_no_tracking+' أوردر مفيش فيهم tracking)','ok');
    } else {
      toast('✅ اتطبع '+data.printed_count+' بوليصة','ok');
    }
    
    // امسح الـ blob URL بعد دقيقة (revoke)
    setTimeout(function(){ URL.revokeObjectURL(pdfUrl); }, 60000);
    
    // مفيش تحديث للأوردرات بعد الطباعة: الحارس القديم كان بينادي loadOrders وهي
    // مش موجودة في المشروع خالص — كان كود ميت من قبل الريفاكتور.
    
  } catch(err){
    console.error('AWB print error:', err);
    toast('فشل الاتصال بالخادم: '+(err.message||err),'er');
  } finally {
    if(btnEl){ btnEl.disabled = false; btnEl.textContent = origText || '🖨️ طبع البوالص'; }
  }
}

export function printSelectedAwb(){
  var ids = Array.from(selectedIds || []);
  if(ids.length === 0){ toast('اختار أوردرات الأول','er'); return; }
  // مفيش filter محلي — الـ Edge Function بتعمل الفلترة من DB مباشرة
  // (الفرونت بيستخدم lazy loading، فالأوردرات مش كلها في الذاكرة دايماً)
  printAwbForOrders(ids, $id('bb-print'));
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
  $id('psize').addEventListener('change',function(){PS=parseInt($id('psize').value)||50;localStorage.setItem('sb_ps',PS);cur=1;if(tourActive){doFilter();}else{fetchOrdersPage();}});
  $id('xcls').addEventListener('click',function(){$id('ovl').classList.remove('open');sel=null;});
  $id('ovl').addEventListener('click',function(e){if(e.target===$id('ovl')){$id('ovl').classList.remove('open');sel=null;}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){$id('ovl').classList.remove('open');sel=null;}});
  $id('tdate').textContent=new Date().toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

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

export function productCostByName(name){
  var raw = normalizeProductName(name);
  var nn  = raw.toLowerCase();
  var nnKey = nameKey(raw);
  var nnTokens = tokenSortKey(raw);

  // Tier 1 — exact (current behavior, fastest path)
  for(var i=0;i<stockProducts.length;i++){
    if(normalizeProductName(stockProducts[i].name).toLowerCase()===nn){
      return Number(stockProducts[i].wholesale_price||0)||0;
    }
  }
  // Tier 2 — bi-directional substring containment
  // Handles BOTH cases: order has extra words, OR stock name has extra words.
  // We pick the LONGEST matching stock name to avoid greedy false positives.
  var bestSubstr = null, bestSubstrLen = 0;
  for(var j=0;j<stockProducts.length;j++){
    var sName = normalizeProductName(stockProducts[j].name);
    var sKey = nameKey(sName);
    if(sKey.length < 8) continue; // too short → too risky for substring matches
    var hit = (nnKey.indexOf(sKey) !== -1) || (sKey.indexOf(nnKey) !== -1 && nnKey.length >= 8);
    if(hit && sKey.length > bestSubstrLen){
      bestSubstr = stockProducts[j]; bestSubstrLen = sKey.length;
    }
  }
  if(bestSubstr) return Number(bestSubstr.wholesale_price||0)||0;

  // Tier 3 — token-sort (with 'ال' stripped) — same words any order, with/without definite article
  // Handles: "ترولي ايكيا 3 دور" ≡ "ترولي 3 دور ايكيا"
  //          "منظم مطبخ متكامل" ≡ "منظم المطبخ المتكامل"
  for(var k=0;k<stockProducts.length;k++){
    if(tokenSortKey(stockProducts[k].name)===nnTokens){
      return Number(stockProducts[k].wholesale_price||0)||0;
    }
  }
  // No match → record diagnostic and return 0
  if(unmatchedCogsItems.indexOf(raw) === -1) unmatchedCogsItems.push(raw);
  return 0;
}

export function movementWholesalePrice(m){
  if(!m)return 0;
  for(var i=0;i<stockProducts.length;i++){
    var p=stockProducts[i];
    if(m.product_id && p.id===m.product_id)return Number(p.wholesale_price||0)||0;
  }
  return productCostByName(m.product_name);
}

export function renderProductPerformance(){
  var q=($id('perf-search')?($id('perf-search').value||'').trim().toLowerCase():'');
  var data=buildProductPerformance();
  var list=data.filter(function(p){return !q||p.name.toLowerCase().indexOf(q)>=0;});
  $id('pf-products').textContent=num(data.length);
  $id('pf-top-rev').textContent=data[0]?short(data[0].name,18):'—';
  var bestDel=data.slice().sort(function(a,b){return b.deliveryRate-a.deliveryRate||b.orders-a.orders;})[0];
  var worstRet=data.slice().sort(function(a,b){return b.returnRate-a.returnRate||b.orders-a.orders;})[0];
  $id('pf-top-del').textContent=bestDel?short(bestDel.name,18):'—';
  $id('pf-top-ret').textContent=worstRet?short(worstRet.name,18):'—';
  $id('perf-count').textContent=list.length!==data.length?num(list.length)+' نتيجة':num(data.length)+' منتج';
  if(!list.length){$id('perf-tbody').innerHTML='<div class="ldg">لا يوجد أداء منتجات حتى الآن</div>';return;}
  var adminView = isAdmin();
  function pct(x){return x==null?'—':x.toFixed(0)+'%';}
  var h='<table><thead><tr>'
    +'<th>المنتج</th><th>طلبات</th><th>قطع</th>'
    +'<th title="قيمة كل الأوردرات في الفترة بأي حالة — مش المتحصل فعلاً">Revenue تقديري</th>'
    +'<th title="نسبة التأكيد = اللي دخل رحلة الشحن ÷ اللي اتعامل معاه (يستبعد Pending) — نفس كروت اللوحة">مؤكد/شحن</th>'
    +'<th title="نسبة التسليم = المسلَّم ÷ (المسلَّم + المرتجع) — نفس كروت اللوحة. الفاشل مش بيدخل لأنه ما وصلش لمرحلة شحن نهائية">تسليم</th>'
    +'<th>إلغاء</th>'
    +'<th title="نسبة المرتجع = المرتجع ÷ (المسلَّم + المرتجع). الفاشل مش بيدخل لأنه ما وصلش لمرحلة شحن نهائية">مرتجع/فشل</th>'
    +'<th>Paymob</th>'
    +(adminView?'<th title="ربح تقديري على الأوردرات المسلَّمة فقط (إيراد المسلَّم − تكلفة القطع المسلَّمة)، قبل الشحن والمصاريف">ربح المنتج</th>':'')
    +'</tr></thead><tbody>';
  list.forEach(function(p){
    h+='<tr>'
      +'<td class="nm" title="'+esc(p.name)+'">'+esc(short(p.name,42))+'</td>'
      +'<td class="mn">'+num(p.orders)+'</td>'
      +'<td class="mn">'+num(p.qty)+'</td>'
      +'<td class="price-cell">'+money(p.revenue)+'</td>'
      +'<td><span class="badge confirmed"><span class="bdot"></span>'+pct(p.confirmRate)+'</span></td>'
      +'<td><span class="badge delivered"><span class="bdot"></span>'+pct(p.deliveryRate)+'</span></td>'
      +'<td class="mn">'+num(p.cancelled)+'</td>'
      +'<td><span class="badge returned"><span class="bdot"></span>'+pct(p.returnRate)+'</span></td>'
      +'<td class="mn">'+num(p.paymob)+'</td>'
      +(adminView?'<td class="price-cell">'+(p.profit===null?'—':money(p.profit))+'</td>':'')
      +'</tr>';
  });
  h+='</tbody></table>';
  $id('perf-tbody').innerHTML=h;
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

export function loadStockMovementsForOps(done){
  if(stockMovements && stockMovements.length){done&&done();return;}
  sb.from('stock_movements').select('*').eq('tenant_id',currentTenantId).order('created_at',{ascending:false}).limit(1000).then(function(r){
    if(!r.error && r.data)stockSetMovements(r.data);
    done&&done();
  });
}

export function shippedOrOperational(o){
  return BOSTA_INVENTORY_STATUSES.indexOf(o.status)>=0 || statusIn(o.status,DELIVERED_STATUSES) || statusIn(o.status,RETURNED_STATUSES) || o.status==='failed';
}

export function productExists(name){
  var nn=normalizeProductName(name).toLowerCase();
  return (stockProducts||[]).some(function(p){return normalizeProductName(p.name).toLowerCase()===nn;});
}

export function ordersInRange(range){
  return all.filter(function(o){
    var d = new Date(o.created_at);
    return d >= range.from && d < range.to;
  });
}

// ============================================================
// BILLING / WALLET MODULE
// ============================================================
// Vodafone Cash number — loaded dynamically from platform_settings (updatable by super admin)
export var VFCASH_NUMBER = '—';

export function loadVfcashNumber(){
  if(!sb) return;
  sb.from('platform_settings').select('value').eq('key','vfcash_number').maybeSingle().then(function(r){
    if(r.error || !r.data) return;
    VFCASH_NUMBER = r.data.value || '—';
    var el = $id('vfcash-number');
    if(el) el.textContent = VFCASH_NUMBER;
  });
}

export function fmtMoneyShort(n){
  var v = parseFloat(n) || 0;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ar-EG', {maximumFractionDigits: 2}) + 'ج';
}

export function fmtDate(s){ if(!s) return '—'; var d=new Date(s); return d.toLocaleDateString('ar-EG',{day:'numeric',month:'short',year:'numeric'}); }

export function fmtDateTime(s){ if(!s) return '—'; var d=new Date(s); return d.toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); }

// helper used inside the row renderer (defined in the existing table code)
export function lockMaybe(value){
  if(walletStateCache && walletStateCache.is_depleted){
    // Never put the real value in the DOM — inspect/copy/screen-readers would expose it.
    // Render a fixed placeholder; the actual data stays only in the in-memory `all` array.
    return '<span class="locked-cell">••••••••</span>';
  }
  return esc(String(value||''));
}

export function renderBillingSummary(){
  var s = walletStateCache;
  if(!s) return;
  $id('bill-balance').textContent = fmtMoney(s.wallet_balance);
  var hint = '';
  if(s.is_depleted){ hint = '⚠️ الرصيد انتهى — اشحن دلوقتي'; }
  else if(parseFloat(s.overdraft_limit) > 0){ hint = 'سماح: ' + fmtMoneyShort(s.overdraft_limit); }
  else { hint = 'بدون سماح (PAYG)'; }
  $id('bill-balance-hint').textContent = hint;

  $id('bill-plan-name').textContent = s.plan_name || '—';
  if(s.pricing_type === 'per_order'){
    $id('bill-plan-price').textContent = (parseFloat(s.per_order_price)||0).toLocaleString('ar-EG') + 'ج / أوردر مؤكد';
  } else {
    $id('bill-plan-price').textContent = (parseFloat(s.monthly_price)||0).toLocaleString('ar-EG') + 'ج / شهر';
  }

  // Cycle stat
  if(s.max_orders){
    $id('bill-cycle-used').textContent = (s.orders_used_cycle||0).toLocaleString('ar-EG') + ' / ' + s.max_orders.toLocaleString('ar-EG');
    var rem = s.orders_remaining;
    if(rem !== null && rem < 0){
      $id('bill-cycle-hint').textContent = '⚠️ تجاوزت بـ ' + Math.abs(rem) + ' أوردر · مديونية: ' + fmtMoneyShort(s.overage_debt);
    } else {
      $id('bill-cycle-hint').textContent = (rem || 0) + ' أوردر متبقّي';
    }
  } else if(s.pricing_type === 'per_order'){
    $id('bill-cycle-used').textContent = (s.orders_used_cycle||0).toLocaleString('ar-EG');
    $id('bill-cycle-hint').textContent = 'أوردر مؤكد · بتُحاسَب 75 قرش لكل واحد';
  } else {
    $id('bill-cycle-used').textContent = (s.orders_used_cycle||0).toLocaleString('ar-EG');
    $id('bill-cycle-hint').textContent = 'أوردر مؤكد · بدون سقف';
  }

  // Renewal
  if(s.cycle_ends_at){
    $id('bill-renew-date').textContent = fmtDate(s.cycle_ends_at);
    var days = Math.ceil((new Date(s.cycle_ends_at) - new Date()) / 86400000);
    $id('bill-renew-hint').textContent = (days > 0 ? 'بعد ' + days + ' يوم' : (days === 0 ? 'اليوم' : 'متأخر ' + Math.abs(days) + ' يوم'));
  } else {
    $id('bill-renew-date').textContent = '—';
    $id('bill-renew-hint').textContent = (s.pricing_type === 'per_order' ? 'لا يوجد تجديد (PAYG)' : '—');
  }

  // VF cash number
  $id('vfcash-number').textContent = VFCASH_NUMBER;
}

// ---- بوابة تبويب المحادثات: مفتوح للموثّقين بس ----
export var inboxVerified = null;

export function refreshInboxGate(){
  if(!sb) return Promise.resolve(false);
  return sb.rpc('wa_inbox_status').then(function(r){
    var d = (!r.error && r.data) ? r.data : {};
    inboxVerified = !!d.verified;
    return inboxVerified;
  }).catch(function(){ inboxVerified = null; return false; });
}

export function renderInboxLocked(){
  var wrap = $id('wa-wrap');
  if(!wrap) return;
  wrap.innerHTML =
    '<div class="inbox-lock">'
    + '<div class="inbox-lock-ico">💬</div>'
    + '<h3>المحادثات متاحة للمتاجر اللي ربطت رقم واتساب خاص بيها</h3>'
    + '<p>عشان نستقبل رسايل عملائك ونعرضهالك هنا، لازم تربط رقم واتساب بيزنس بتاعك مع الـ Access Token. '
    + 'ولو شغّال على رقم سهل المشترك، الرسايل بتروح لخدمة عملاء متجرك مباشرةً زي ما هو مكتوب في رسالة التأكيد.</p>'
    + '<button class="sbtn" id="inbox-go-settings">اربط رقمك دلوقتي ←</button>'
    + '</div>';
  var b = $id('inbox-go-settings');
  if(b) b.addEventListener('click', function(){ showPage('settings'); });
}

// Status category helpers
export function isDeliveredOrder(o){ return o.status === 'delivered' || o.status === 'Delivered'; }

export function isWithBosta(o){
  return ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2',
    'Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs',
    'Picking up from consignee','Out for exchange'].indexOf(o.status) >= 0;
}
