// كروت الإحصاء والإيرادات فوق جدول الأوردرات

import { currentTenantId } from '../auth/auth.js';
import { BOSTA_EXPECTED_STATUSES, BOSTA_OPERATION_STATUSES, BOSTA_POSITIVE_STATUSES, CANCELLED_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusIn } from '../core/constants.js';
import { $id } from '../core/dom.js';
// `val` كانت ناقصة من الاستوردات في الملف الضخم قبل التفكيك — updateRevenueStats
// كانت بترمي ReferenceError، والنداء الوحيد ليها (في الجولة) متلفوف بـswallow
// فالخطأ كان بيتبلع وكروت الإيرادات في الجولة تفضل فاضية من غير أي أثر.
import { cairoYMD, money, normalizePhone, num, val, ymdAddDays } from '../core/format.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { tourActive } from '../tour/tour.js';
import { loadStockProductsForCosts, orderInventoryCost } from './costs.js';
import { isAdmin } from './guards.js';
import { detectMergeable } from './merge.js';
import { doFilter, ordersInPeriod } from './orders.js';
import { fil, ordersPeriod, ordersSetPendingBosta, pendingBostaByPhone, selectedIds } from './state.js';
import { updateBulkBar, updateMasterCb } from './table.js';

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
  if(tourActive) clearStatsDeltas();   // أرقام الجولة ديمو — فروق الشهر الحقيقية هتلخبط
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
// جيل النداء — تبديل مدة سريع (شهر ← آخر 3 أيام) كان بيسيب رد المدة
// القديمة يوصل متأخر ويكتب أرقامه والـdeltas فوق الأحدث، والجدول
// وشريط المدة على حاجة تانية (الجدول نفسه محروس بـfetchGen — الكروت لأ)
var statsGen = 0;
export function loadOrdersCards(){
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  var myGen = ++statsGen;
  var d=ordersPeriodCairoDates();
  var statsQ = sb.rpc('sahl_orders_stats',{ p_tenant: currentTenantId, p_from: d?d.from:null, p_to: d?d.to:null });
  if(ordersPeriod.type==='month'){
    // وضع الشهر الحالي (الافتراضي): بنجيب الشهر اللي فات كمان عشان
    // كل كارت يعرض فرقه بالنسبة المئوية — نفس الـRPC بمدى تاني
    var pd = prevMonthCairoDates();
    Promise.all([statsQ,
      sb.rpc('sahl_orders_stats',{ p_tenant: currentTenantId, p_from: pd.from, p_to: pd.to })
    ]).then(function(rs){
      if(myGen !== statsGen || tourActive) return;   // طلب أحدث خرج بعدنا
      var cur=rs[0], prev=rs[1];
      if(cur.error || !cur.data){ if(cur.error&&cur.error.message) console.warn('stats RPC:',cur.error.message); return; }
      applyOrdersStats(cur.data);
      renderStatsDeltas(cur.data, (prev && !prev.error) ? prev.data : null, cairoRangeLabel(pd));
    });
  } else {
    clearStatsDeltas();
    statsQ.then(function(r){
      if(myGen !== statsGen || tourActive) return;   // طلب أحدث خرج بعدنا
      if(r.error || !r.data){ if(r.error&&r.error.message) console.warn('stats RPC:',r.error.message); return; }
      applyOrdersStats(r.data);
    });
  }
}

// الشهر السابق بتوقيت القاهرة — **لحد نفس اليوم من الشهر** مش الشهر كامل.
//
// كانت بترجع الشهر السابق كله، فيوم 4 أغسطس الكارت كان بيقارن 4 أيام
// (94 أوردر) بـ31 يوم (786 أوردر) ويطلّع «▼ 88%» — رقم بيقيس فرق طول
// المدة مش فرق الأداء. القاهرة هنا مقصودة: الـRPC بيفلتر بـ
// `(created_at at time zone 'Africa/Cairo')::date` فالطرفين على نفس المرجع.
//
// الشهر الحالي (ordersPeriodCairoDates) سايب `to` على آخر يوم في الشهر —
// وده مساوي عملياً لـ«لحد النهاردة» لأن مفيش أوردرات بتاريخ مستقبلي
// (اتفحص على الداتا الحية: صفر من 2,609).
export function prevMonthCairoDates(){
  var today=cairoYMD(new Date());
  var y=+today.slice(0,4), m=+today.slice(5,7), d=+today.slice(8,10);
  var py=m===1?y-1:y, pm=m===1?12:m-1;
  var pmStr=('0'+pm).slice(-2);
  var last=new Date(py,pm,0).getDate();   // آخر يوم في الشهر السابق
  // 31 مارس بيقارن بـ28/29 فبراير — مفيش يوم 31 نوقف عنده
  var toD=Math.min(d, last);
  return { from: py+'-'+pmStr+'-01', to: py+'-'+pmStr+'-'+('0'+toD).slice(-2) };
}

// "1–4 يوليو" — الطرفين دايماً في نفس الشهر فاسم شهر واحد بيكفي
var AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
export function cairoRangeLabel(r){
  if(!r || !r.from || !r.to) return '';
  var a=r.from.split('-'), b=r.to.split('-');
  var mon=AR_MONTHS[(+a[1])-1] || '';
  return (+a[2] === +b[2]) ? ((+a[2])+' '+mon) : ((+a[2])+'–'+(+b[2])+' '+mon);
}

// خريطة الكروت: عنصر القيمة ← إزاي نطلّع الرقم من ناتج الـRPC،
// وهل الزيادة كويسة (أخضر) ولا وحشة (أحمر — إلغاءات/مرتجع/مهدر)
var DELTA_METRICS = [
  { el:'s0', get:function(s){return s.total_count||0;}, goodUp:true },
  { el:'s1', get:function(s){return s.pending||0;}, goodUp:null },
  { el:'s3', get:function(s){return s.delivered||0;}, goodUp:true },
  { el:'s4', get:function(s){return s.cancelled||0;}, goodUp:false },
  { el:'s5', get:function(s){return s.returned||0;}, goodUp:false },
  { el:'s6', get:function(s){return s.processed>0?(s.positive/s.processed)*100:null;}, goodUp:true, points:true },
  { el:'s7', get:function(s){var dd=(s.delivered||0)+(s.returned||0);return dd>0?(s.delivered/dd)*100:null;}, goodUp:true, points:true },
  { el:'rv-total', get:function(s){return s.sum_total||0;}, goodUp:true },
  { el:'rv-collected', get:function(s){return s.sum_collected||0;}, goodUp:true },
  { el:'rv-expected', get:function(s){return s.sum_expected||0;}, goodUp:true },
  { el:'rv-lost', get:function(s){return s.sum_lost||0;}, goodUp:false },
  { el:'rv-aov', get:function(s){return s.total_count?(s.sum_total/s.total_count):null;}, goodUp:true }
];

function deltaSlot(valueEl){
  var d=valueEl.parentElement.querySelector('.sdelta');
  if(!d){ d=document.createElement('div'); d.className='sdelta'; valueEl.insertAdjacentElement('afterend', d); }
  return d;
}

// بنمسح خانات الفرق **بتاعة كروت الأوردرات بس**.
// النسخة القديمة كانت `querySelectorAll('.sdelta')` على الصفحة كلها —
// فأول ما التاجر يبدّل المدة لغير «الشهر الحالي» كانت بتمسح تسميات ثابتة
// في صفحة الماليات كمان (`fin-revenue-delta` = «تشمل كل الحالات» و
// `fin-margin`) — مفيش كود بيعيد كتابتها، فكانت بتضيع لآخر الجلسة.
export function clearStatsDeltas(){
  DELTA_METRICS.forEach(function(m){
    var valueEl=$id(m.el); if(!valueEl || !valueEl.parentElement) return;
    var d=valueEl.parentElement.querySelector('.sdelta');
    if(d){ d.textContent=''; d.className='sdelta'; d.title=''; }
  });
}

// فرق كل كارت عن **نفس الأيام** من الشهر اللي فات: ▲ +12% أخضر لو الزيادة
// كويسة، أحمر لو وحشة (إلغاءات مثلاً)، وكروت النسب بتتقارن بالنقاط.
// prevLabel = النافذة اللي اتقارن بيها ("1–4 يوليو") — بتتحط في الـtooltip
// عشان التاجر يشوف بعينه إحنا قارنّا بإيه بالظبط بدل ما يخمّن.
export function renderStatsDeltas(cur, prev, prevLabel){
  if(!prev){ clearStatsDeltas(); return; }
  var when = prevLabel ? ('مقارنة بـ'+prevLabel) : 'مقارنة بنفس الأيام من الشهر اللي فات';
  DELTA_METRICS.forEach(function(m){
    var valueEl=$id(m.el); if(!valueEl) return;
    var d=deltaSlot(valueEl);
    var c=m.get(cur), p=m.get(prev);
    if(c===null || p===null){ d.textContent=''; d.className='sdelta'; return; }
    var diff, txt;
    if(m.points){ diff=c-p; txt=Math.abs(diff).toFixed(1)+' نقطة'; }
    else if(p===0){
      if(c===0){ d.textContent=''; d.className='sdelta'; return; }
      d.textContent='جديد'; d.className='sdelta flat';
      d.title='مفيش بيانات في '+(prevLabel||'الشهر اللي فات')+' للمقارنة'; return;
    }
    else { diff=(c-p)/p*100; txt=Math.abs(diff).toFixed(0)+'%'; }
    if(Math.abs(diff) < 0.05){ d.textContent='زي نفس الفترة'; d.className='sdelta flat'; d.title=when; return; }
    var up=diff>0;
    var good = m.goodUp===null ? null : (up === m.goodUp);
    d.textContent=(up?'▲ ':'▼ ')+txt;
    d.className='sdelta '+(good===null?'flat':(good?'up':'down'));
    d.title=(up?'أعلى':'أقل')+' بـ'+txt+' — '+when;
  });
}

// تنبيه الدمج: عملاء معاهم أوردرين+ جاهزين للشحن — كويري مخصّص بدل المصفوفة الكاملة
export var MERGE_QUERY_STATUSES = ['bosta_assigned','BOSTA AUTO','bosta_auto','BOSTA2','bosta2'];
export var mergeQueryCapped = false;   // الكويري رجع سقف PostgREST (1000) — العدّ ناقص

export function loadMergeCandidates(){
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  sb.from('orders').select('order_uid,tracking_no,customer_name,city,phone,total_cost,status')
    .eq('tenant_id',currentTenantId).in('status',MERGE_QUERY_STATUSES).then(function(r){
      if(tourActive) return;
      if(r.error) return;
      mergeQueryCapped=((r.data||[]).length===1000);
      ordersSetPendingBosta({});
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
    // BOSTA_OPERATION_STATUSES هنا مقصودة — مش BOSTA_INVENTORY_STATUSES:
    // BOSTA2/bosta2 معناها السكانر بتاعنا ضرب الأوردر في مخزننا وبوسطة
    // لسه ماستلمتش، فمش "بضاعة مع بوسطة" (قرار المالك 1 أغسطس — أي مراجعة
    // تقترح "تصليح" ده تعتبر غلط)
    sb.from('orders').select('product_name,inventory_cost_snapshot,inventory_value_snapshot,inventory_value_at_bosta,status')
      .eq('tenant_id',currentTenantId).in('status',BOSTA_OPERATION_STATUSES).then(function(r){
        if(tourActive) return;
        if(r.error) return;
        var orders=r.data||[];
        var total=orders.reduce(function(s,o){return s+orderInventoryCost(o);},0);
        // سقف PostgREST الافتراضي 1000 صف — لو وصلناله الرقم ناقص ولازم نقول
        var capped=(orders.length===1000);
        el.textContent=money(total)+(capped?'+':'');
        if(sub)sub.textContent=capped
          ? '1,000+ شحنة في التشغيل — الرقم تقريبي (سقف العرض)'
          : num(orders.length)+' شحنة في التشغيل حاليًا';
      });
  });
}
