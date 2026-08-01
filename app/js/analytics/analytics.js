// صفحة إحصائيات الأداء — المنتجات والمنصات

import { emptyState } from '../core/empty.js';
import { ratePill } from './rate.js';
import { renderDaysCalendar } from './days.js';
import { veilDone } from '../core/veil.js';
import { parseProductItems } from './product-match.js';
import { BOSTA_POSITIVE_STATUSES, CANCELLED_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, normStatus, statusIn } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { num, val } from '../core/format.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { setPeriod } from '../main.js';
import { tourActive } from '../tour/tour.js';
import { ensureAllLoaded } from '../orders/orders.js';
import { loadStockProductsForCosts, ordersInRange, productCostByName, renderProductPerformance } from '../orders/costs.js';
import { ensureTenant, isAdmin } from '../orders/guards.js';

export function buildProductPerformance(){
  var map={};
  ordersInRange(getAnalyticsRange()).forEach(function(o){
    var items=parseProductItems(o.product_name);
    var totalQty=items.reduce(function(s,it){return s+(it.qty||1);},0)||1;
    var isDelivered=statusIn(o.status,DELIVERED_STATUSES);
    var isReturned=statusIn(o.status,RETURNED_STATUSES);
    var isFailed=(normStatus(o.status)==='failed');
    var isPending=statusIn(o.status,['pending']);
    var isPositive=statusIn(o.status,BOSTA_POSITIVE_STATUSES);
    items.forEach(function(it){
      var name=it.name, qty=it.qty||1;
      if(!map[name])map[name]={name:name,orders:0,processed:0,qty:0,revenue:0,delivered:0,deliveredQty:0,deliveredRevenue:0,confirmed:0,cancelled:0,returned:0,failed:0,paymob:0,cost:0,profit:0};
      var r=map[name];
      var share=val(o)*(qty/totalQty);
      r.orders++;
      r.qty+=qty;
      r.revenue+=share;
      if(!isPending)r.processed++;                                  // اتعامل معاه (خرج من Pending)
      if(isDelivered){r.delivered++;r.deliveredQty+=qty;r.deliveredRevenue+=share;}
      if(isPositive)r.confirmed++;                                  // دخل رحلة الشحن
      if(statusIn(o.status,CANCELLED_STATUSES))r.cancelled++;
      if(isReturned)r.returned++;
      if(isFailed)r.failed++;
      if(o.payment_stage==='paymob')r.paymob++;
    });
  });
  return Object.keys(map).map(function(k){
    var r=map[k], c=productCostByName(r.name);
    // الربح على الأوردرات المسلَّمة فقط (محقَّق) — زي منطق الماليات، قبل الشحن والمصاريف
    r.cost=c*r.deliveredQty;
    r.profit=c?(r.deliveredRevenue-r.cost):null;
    // نسبة التأكيد = الإيجابي ÷ اللي اتعامل معاه (يستبعد Pending) — نفس كروت اللوحة
    r.confirmRate=r.processed?(r.confirmed/r.processed*100):null;
    // التسليم/المرتجع = المسلَّم ÷ (المسلَّم + المرتجع) — نفس كروت اللوحة. الفاشل مش بيدخل لأنه ما وصلش لمرحلة شحن نهائية
    var finished=r.delivered+r.returned;
    r.deliveryRate=finished?(r.delivered/finished*100):null;
    r.returnRate=finished?(r.returned/finished*100):null;
    return r;
  }).sort(function(a,b){return b.revenue-a.revenue;});
}

// ════════════════ PERFORMANCE ANALYTICS PAGE ════════════════
export var analyticsCurrentTab = 'products';

export var analyticsPeriod = { type:'month', from:null, to:null };

export function getAnalyticsRange(){
  var now=new Date(), from, to, t=analyticsPeriod.type;
  if(t==='last3'){ from=new Date(now.getFullYear(),now.getMonth(),now.getDate()-2); to=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1); }
  else if(t==='last30'){ from=new Date(now.getFullYear(),now.getMonth(),now.getDate()-29); to=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1); }
  else if(t==='all'){ from=new Date(2020,0,1); to=new Date(now.getFullYear()+1,0,1); }
  else { from=new Date(now.getFullYear(),now.getMonth(),1); to=new Date(now.getFullYear(),now.getMonth()+1,1); }
  return { from:from, to:to };
}

export function renderAnalyticsActive(){
  if(analyticsCurrentTab==='products') renderProductPerformance();
  else if(analyticsCurrentTab==='platforms') renderFinancePlatforms();
  else if(analyticsCurrentTab==='days') renderDaysCalendar();
  // 'employees' is a static placeholder (under construction)
}

export function loadAnalytics(){
  if(!isAdmin()){veilDone('analytics');return;}
  if(tourActive){ renderAnalyticsActive(); return; }
  if(!ensureTenant()){veilDone('analytics');return;}
  // الإحصائيات بتحسب على كل الفترة → نحمّل الأوردرات للذاكرة هنا (مرة واحدة)
  ensureAllLoaded(function(err){
    if(err){ veilDone('analytics'); return; }   // فشل السحب — بلاش أرقام ناقصة تتعرض كحقيقية
    loadStockProductsForCosts(function(){ renderAnalyticsActive(); veilDone('analytics'); });
  });
}

// تابات وفترات صفحة الأداء
export function initAnalyticsTabs(){
  // Analytics (performance) sub-tabs
  document.querySelectorAll('.stock-tab[data-atab]').forEach(function(b){
    b.addEventListener('click',function(){
      analyticsCurrentTab=b.getAttribute('data-atab');
      document.querySelectorAll('.stock-tab[data-atab]').forEach(function(x){x.classList.toggle('active',x===b);});
      $id('analytics-products-tab').style.display = analyticsCurrentTab==='products'?'block':'none';
      $id('analytics-platforms-tab').style.display = analyticsCurrentTab==='platforms'?'block':'none';
      if($id('analytics-days-tab'))$id('analytics-days-tab').style.display = analyticsCurrentTab==='days'?'block':'none';
      $id('analytics-employees-tab').style.display = analyticsCurrentTab==='employees'?'block':'none';
      // شريط المدة مالوش لازمة في الكالندر (ليه تنقّل شهور خاص) ولا الموظفين
      if($id('analytics-period-bar'))$id('analytics-period-bar').style.display = (analyticsCurrentTab==='employees'||analyticsCurrentTab==='days')?'none':'';
      renderAnalyticsActive();
    });
  });
  document.querySelectorAll('.aperiod-btn').forEach(function(b){
    b.addEventListener('click',function(){
      setPeriod(analyticsPeriod, b.getAttribute('data-aperiod'));
      document.querySelectorAll('.aperiod-btn').forEach(function(x){x.classList.toggle('active',x===b);});
      renderAnalyticsActive();
    });
  });
}

// ────────────────── PRODUCT FINANCIAL PERFORMANCE TAB ──────────────────
export function renderFinancePlatforms(){
  if(!$id('finplat-tbody')) return;
  var orders = ordersInRange(getAnalyticsRange());
  var PLAT = { fb:{name:'Facebook',ic:'📘'}, ig:{name:'Instagram',ic:'📸'}, tiktok:{name:'TikTok',ic:'🎵'} };
  var by = {};
  orders.forEach(function(o){
    var key = PLAT[o.platform] ? o.platform : 'other';
    if(!by[key]) by[key] = { key:key, total:0, processed:0, positive:0, delivered:0, returned:0 };
    var b = by[key];
    b.total++;
    if(!statusIn(o.status, ['pending'])) b.processed++;            // اتعامل معاه (خرج من قيد الانتظار)
    if(statusIn(o.status, BOSTA_POSITIVE_STATUSES)) b.positive++;  // مؤكَّد / دخل رحلة الشحن
    if(statusIn(o.status, DELIVERED_STATUSES)) b.delivered++;
    if(statusIn(o.status, RETURNED_STATUSES)) b.returned++;
  });
  var list = Object.keys(by).map(function(k){
    var b = by[k];
    b.confRate = b.processed > 0 ? (b.positive / b.processed * 100) : null;   // = نسبة التأكيد (كروت اللوحة)
    var dd = b.delivered + b.returned;
    b.delivRate = dd > 0 ? (b.delivered / dd * 100) : null;                   // = نسبة التسليم (كروت اللوحة)
    var meta = PLAT[k] || { name:'أخرى', ic:'🌐' };
    b.label = meta.name; b.ic = meta.ic;
    return b;
  });
  list.sort(function(a,b){ return b.total - a.total; });

  if($id('finplat-count')) $id('finplat-count').textContent = num(list.length) + ' منصة';
  if(!list.length){ $id('finplat-tbody').innerHTML = emptyState({icon:'📊',
      title:'مفيش بيانات في المدة دي',
      sub:'الأرقام بتتبني من أوردراتك — جرّب مدة أطول أو استنى أوردرات جديدة.'}); return; }

  var h = '<table><thead><tr>'
    + '<th>المنصة</th>'
    + '<th>إجمالي الطلبات</th>'
    + '<th>نسبة التأكيد</th>'
    + '<th>نسبة التسليم</th>'
    + '<th>تم التسليم</th>'
    + '<th>مرتجعة</th>'
    + '</tr></thead><tbody>';
  list.forEach(function(b){
    h += '<tr>'
      + '<td class="nm">'+b.ic+' '+esc(b.label)+'</td>'
      + '<td class="mn">'+num(b.total)+'</td>'
      + '<td>'+ratePill(b.confRate)+'</td>'
      + '<td>'+ratePill(b.delivRate)+'</td>'
      + '<td class="mn" style="color:var(--green)">'+num(b.delivered)+'</td>'
      + '<td class="mn" style="color:var(--ora)">'+num(b.returned)+'</td>'
      + '</tr>';
  });
  h += '</tbody></table>';
  $id('finplat-tbody').innerHTML = h;
}
