// الماليات — التكاليف والأرباح والمصاريف والرسم البياني

import { emptyState } from '../core/empty.js';
import { veilDone } from '../core/veil.js';
import { BOSTA_POSITIVE_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusIn } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { fmtD, num } from '../core/format.js';
import { autoChartGran, financePeriod, getPeriodRange } from './period.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { setPeriod } from '../main.js';
import { BOSTA_EXPECTED_STATUSES, CANCELLED_STATUSES } from '../core/constants.js';
import { pad2 } from '../core/format.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { loadIssues, renderIssuesTable } from '../issues/issues.js';
import { stockProducts, stockSetProducts } from '../stock/stock.js';
import { tourDemoExpenses, tourDemoStock } from '../tour/demo-data.js';
import { currentTenantId, currentUser } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { ensureAllLoaded } from '../orders/orders.js';
import { isDeliveredOrder, loadStockProductsForCosts, orderInventoryCost, ordersInRange } from '../orders/costs.js';
import { ensureTenant, isAdmin, requireAdmin } from '../orders/guards.js';
import { all } from '../orders/state.js';

export function financeSetExpenses(v){ financeExpenses = v || []; }

export var financeExpenses = [];  // المصاريف — الجولة بتبدّلها بديمو

export function pRange(c,t){
  if(t<=7)return Array.from({length:t},function(_,i){return i+1;});
  if(c<=4)return[1,2,3,4,5,'…',t];
  if(c>=t-3)return[1,'…',t-4,t-3,t-2,t-1,t];
  return[1,'…',c-1,c,c+1,'…',t];
}

// Track items we couldn't match to stock during the last finance render.
// Used by the UI to show a warning banner with the offending product names.
export var unmatchedCogsItems = [];

// ═══════════════════════════════════════════════════════════════
// ════════════════ FINANCE SECTION (admin only) ═════════════════
// ═══════════════════════════════════════════════════════════════
export var SHIPPING_COST_DEFAULT = 85;

// سعر الشحن الحقيقي من Bosta (شامل VAT) لو اتسجّل، وإلا الافتراضي 85
export function orderShippingCost(o){
  var f = parseFloat(o && o.real_shipping_fee);
  return (isFinite(f) && f > 0) ? f : SHIPPING_COST_DEFAULT;
}

export var financeCurrentTab = 'overview';

export var financeChartInstance = null;

export function expensesInRange(range){
  return financeExpenses.filter(function(e){
    var d = new Date(e.expense_date);
    return d >= range.from && d < range.to;
  });
}

export function fmtMoney(n){
  var v = parseFloat(n) || 0;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ar-EG', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + 'ج';
}

export function loadFinance(){
  // During the guided tour, keep the injected demo numbers (real COGS from demo
  // stock + demo expenses) instead of fetching the empty real tenant data.
  if(tourActive){
    if(!isAdmin())return;
    if(!stockProducts || !stockProducts.length) stockSetProducts(tourDemoStock());
    if(!financeExpenses || !financeExpenses.length) financeExpenses = tourDemoExpenses();
    renderFinance();
    return;
  }
  if(!requireAdmin()){veilDone('finance');return;}
  if(!ensureTenant()){veilDone('finance');return;}
  // الماليات بتحسب على كل الفترة → نحمّل الأوردرات للذاكرة هنا (مرة واحدة)
  ensureAllLoaded(function(){
    // Finance depends on wholesale_price from stock_products, so load stock first.
    loadStockProductsForCosts(function(){
      sb.from('expenses').select('*').eq('tenant_id', currentTenantId).order('expense_date', {ascending:false}).then(function(r){
        if(r.error){ console.error(r.error); toast('خطأ في تحميل المصاريف','er'); veilDone('finance'); return; }
        financeExpenses = r.data || [];
        renderFinance();
        veilDone('finance');
      });
    });
  });
}

export function renderFinance(){
  if(!isAdmin())return;
  renderFinanceOverview();
  renderExpenses();
}

export function renderFinanceOverview(){
  var range = getPeriodRange();
  var orders = ordersInRange(range);
  var expenses = expensesInRange(range);

  // Reset diagnostics — productCostByName() will repopulate this as it processes items
  unmatchedCogsItems = [];

  // Revenue calculations — use SAME status lists as orders page for consistency
  var totalRevenue = orders.reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);
  var collected = orders.filter(function(o){return statusIn(o.status, DELIVERED_STATUSES);}).reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);
  var expected = orders.filter(function(o){return statusIn(o.status, BOSTA_EXPECTED_STATUSES);}).reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);
  var lost = orders.filter(function(o){return statusIn(o.status, CANCELLED_STATUSES) || statusIn(o.status, RETURNED_STATUSES) || o.status==='failed';}).reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);

  // Cost calculations — for DELIVERED orders only (those we paid costs on)
  var deliveredOrders = orders.filter(function(o){return statusIn(o.status, DELIVERED_STATUSES);});
  var manufacturerCost = deliveredOrders.reduce(function(s,o){ return s + orderInventoryCost(o); }, 0);
  var shippingCost = deliveredOrders.reduce(function(s,o){ return s + orderShippingCost(o); }, 0);
  var packagingCost = deliveredOrders.reduce(function(s,o){ return s + (parseFloat(o.packaging_cost)||0); }, 0);

  // ALSO charge shipping for orders that bounced/returned (we paid Bosta anyway)
  // الشحن بيتخصم لما الأوردر يتسلّم أو يرجع مرتجع فقط — دول الحالتين اللي
  // بوسطة بتحاسب عليهم فعلاً. الملغي والفاشل و Exception (تأجيل/رفض مؤقت)
  // لسه ماتحسمتش، ولما تحسم هتبقى إما تسليم أو مرتجع ويتخصم وقتها.
  var lostOrdersShipping = orders.filter(function(o){
    return statusIn(o.status, RETURNED_STATUSES);
  }).reduce(function(s,o){ return s + orderShippingCost(o); }, 0);
  shippingCost += lostOrdersShipping;

  // Manual expenses by category
  var expSalaries  = expenses.filter(function(e){return e.category==='مرتبات';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expAds       = expenses.filter(function(e){return e.category==='إعلانات فيسبوك';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expPackaging = expenses.filter(function(e){return e.category==='تغليف';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expBills     = expenses.filter(function(e){return e.category==='فواتير';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expWarehouse = expenses.filter(function(e){return e.category==='مخزن';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expOther     = expenses.filter(function(e){return e.category==='متفرقات';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var totalManualExpenses = expSalaries + expAds + expPackaging + expBills + expWarehouse + expOther;

  var totalCosts = manufacturerCost + shippingCost + packagingCost + totalManualExpenses;
  var netProfit = collected - totalCosts;
  var marginPct = collected > 0 ? (netProfit/collected*100) : 0;
  var aov = deliveredOrders.length > 0 ? (collected/deliveredOrders.length) : 0;

  // Render top cards
  $id('fin-revenue').textContent = num(totalRevenue.toFixed(0))+' ج';
  $id('fin-collected').textContent = num(collected.toFixed(0))+' ج';
  $id('fin-expected').textContent = num(expected.toFixed(0))+' ج';
  $id('fin-lost').textContent = num(lost.toFixed(0))+' ج';

  // Net profit: green if profit, red if loss, white/default if zero
  var npEl = $id('fin-net-profit');
  npEl.textContent = num(netProfit.toFixed(0))+' ج';
  npEl.classList.remove('profit-positive','profit-negative','profit-zero');
  var profitCard = npEl.closest('.sc');
  if(profitCard){
    profitCard.classList.remove('profit-positive-card','profit-negative-card','profit-zero-card');
    profitCard.style.borderColor = '';
    profitCard.style.background = '';
  }
  if(netProfit > 0){
    npEl.classList.add('profit-positive');
    if(profitCard){
      profitCard.style.borderColor = 'rgba(16,185,129,.45)';
      profitCard.style.background = 'rgba(16,185,129,.06)';
    }
  } else if(netProfit < 0){
    npEl.classList.add('profit-negative');
    if(profitCard){
      profitCard.style.borderColor = 'rgba(239,68,68,.45)';
      profitCard.style.background = 'rgba(239,68,68,.06)';
    }
  } else {
    npEl.classList.add('profit-zero');
  }

  $id('fin-margin-pct').textContent = marginPct.toFixed(1)+'%';
  $id('fin-total-costs').textContent = num(totalCosts.toFixed(0))+' ج';
  $id('fin-aov').textContent = num(aov.toFixed(0))+' ج';

  // Cost breakdown
  var costRows = [
    {label:'💰 المتحصل (إيرادات فعلية)', value:collected, isRevenue:true, tip:'إجمالي قيمة الأوردرات Delivered فقط في الفترة المختارة.'},
    {label:'🏭 تكلفة المنتجات (جملة)', value:-manufacturerCost, alwaysShow:true, tip:'الأولوية للـ Snapshot المحفوظ وقت الشحن. لو مش موجود، بيتحسب Live من سعر الجملة الحالي في المخزون × الكمية.'},
    {label:'🚚 تكلفة الشحن الحقيقية (شامل المرتجع)', value:-shippingCost, tip:'سعر الشحن الحقيقي من Bosta (شامل VAT) لكل أوردر اتسلّم، وللي لسه ماجبناش سعره الحقيقي بنحسبه 85 جنيه. وبيتحسب كمان لكل أوردر مرتجع أو فاشل عنده رقم تتبع لأن الشحنة خرجت فعلاً.'},
    {label:'📦 تكلفة التغليف', value:-packagingCost, tip:'تكلفة التغليف المسجلة على الأوردرات المسلمة من عمود packaging_cost لو موجود.'},
    {label:'👤 مرتبات', value:-expSalaries, tip:'مصاريف فئة المرتبات المسجلة يدويًا في الفترة.'},
    {label:'📱 إعلانات فيسبوك', value:-expAds, tip:'مصاريف إعلانات فيسبوك المسجلة يدويًا في الفترة.'},
    {label:'📦 تغليف (مصاريف يدوية)', value:-expPackaging, tip:'مصاريف تغليف عامة أضفتها يدويًا في تبويب المصاريف.'},
    {label:'🧾 فواتير', value:-expBills, tip:'إجمالي الفواتير المسجلة يدويًا في الفترة.'},
    {label:'🏭 مخزن', value:-expWarehouse, tip:'مصاريف المخزن المسجلة يدويًا في الفترة.'},
    {label:'🔧 متفرقات', value:-expOther, tip:'أي مصاريف أخرى مسجلة يدويًا في الفترة.'},
    {label:'💎 صافي الربح', value:netProfit, isProfit:true, tip:'صافي الربح النهائي بعد خصم كل التكاليف والمصاريف من المتحصل فعلاً.'}
  ];
  var html = '';

  // Warning banner — show ABOVE the breakdown if any products couldn't be matched to stock
  if(unmatchedCogsItems.length > 0){
    var sample = unmatchedCogsItems.slice(0,5).map(function(n){return '<li style="margin:2px 0;">'+esc(n)+'</li>';}).join('');
    var more = unmatchedCogsItems.length > 5 ? '<li style="margin:2px 0;color:var(--muted);">… و '+(unmatchedCogsItems.length-5)+' غيرها</li>' : '';
    html += '<div style="background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1.5px dashed rgba(234,88,12,.5);border-radius:14px;padding:14px 18px;margin-bottom:14px;">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
      +'<span style="font-size:1.2rem;">⚠️</span>'
      +'<b style="color:#9a3412;font-size:.95rem;">'+unmatchedCogsItems.length+' منتج في الأوردرات مش لاقي ليه match في المخزون</b>'
      +'</div>'
      +'<p style="margin:0 0 8px;color:#7c2d12;font-size:.82rem;font-weight:600;line-height:1.7;">تكلفة المنتجات دي محسوبة بصفر (مش بتتخصم من الربح). راجع أسماء المنتجات في الأوردرات أو ضيفهم للمخزون عشان الحسابات تطلع صح.</p>'
      +'<ul style="margin:0;padding-right:18px;font-size:.78rem;color:#7c2d12;font-family:\'JetBrains Mono\',monospace;">'+sample+more+'</ul>'
      +'</div>';
  }

  costRows.forEach(function(r){
    if(r.value === 0 && !r.isRevenue && !r.isProfit && !r.alwaysShow) return;
    var pct = collected > 0 ? (Math.abs(r.value)/collected*100).toFixed(1) : 0;
    var cls = 'cost-row';
    var sign = '';
    var color = 'var(--red)';
    if(r.isRevenue){
      sign = '';
      color = 'var(--blue)';
    } else if(r.isProfit){
      if(r.value > 0){ cls = 'cost-row profit'; color = 'var(--green)'; sign = '+'; }
      else if(r.value < 0){ cls = 'cost-row profit-negative'; color = 'var(--red)'; sign = '-'; }
      else { cls = 'cost-row profit-zero'; color = 'var(--txt)'; sign = ''; }
    } else {
      sign = r.value < 0 ? '-' : '+';
    }
    html += '<div class="'+cls+'">'
      + '<span class="info-i" tabindex="0" title="'+esc(r.tip||r.label)+'" data-tip="'+esc(r.tip||r.label)+'">i</span>'
      + '<div class="cost-row-label">'+r.label+'</div>'
      + '<div class="cost-row-value" style="color:'+color+'">'+sign+num(Math.abs(r.value).toFixed(0))+' ج</div>'
      + '<div class="cost-row-pct">'+pct+'% من الإيرادات</div>'
      + '</div>';
  });
  $id('fin-cost-breakdown').innerHTML = html;

  renderFinanceChart();
}

export var financeChartPeriod = 'monthly';

export var financeChartManual = false;   // true once the user picks a granularity manually

export function renderFinanceChart(){
  var canvas = $id('fin-chart');
  if(!canvas || typeof Chart === 'undefined') return;

  var now = new Date();
  var labels = [], revData = [], profData = [];

  function calcPeriod(from, to){
    var orders = all.filter(function(o){ var d=new Date(o.created_at); return d>=from && d<to; });
    var exps = financeExpenses.filter(function(e){ var d=new Date(e.expense_date); return d>=from && d<to; });
    var rev = orders.filter(isDeliveredOrder).reduce(function(s,o){return s+(parseFloat(o.total_cost)||0);},0);
    var costs = orders.filter(isDeliveredOrder).reduce(function(s,o){return s+orderInventoryCost(o);},0)
      + orders.filter(function(o){return isDeliveredOrder(o)||statusIn(o.status,RETURNED_STATUSES);}).reduce(function(s,o){return s+orderShippingCost(o);},0)
      + orders.filter(isDeliveredOrder).reduce(function(s,o){return s+(parseFloat(o.packaging_cost)||0);},0)
      + exps.reduce(function(s,e){return s+parseFloat(e.amount);},0);
    return { rev: Math.round(rev), profit: Math.round(rev - costs) };
  }

  // Chart window follows the SELECTED finance period exactly.
  var range = getPeriodRange();
  var from = new Date(range.from), to = new Date(range.to);
  if(financePeriod.type === 'all'){
    // span the actual data: earliest order → end of current month
    var minD = null;
    all.forEach(function(o){ var d=new Date(o.created_at); if(!isNaN(d) && (!minD || d<minD)) minD=d; });
    from = minD ? new Date(minD.getFullYear(), minD.getMonth(), 1) : new Date(now.getFullYear(), 0, 1);
    to = new Date(now.getFullYear(), now.getMonth()+1, 1);
  }
  var spanDays = Math.max(1, Math.round((to - from)/86400000));
  if(!financeChartManual) financeChartPeriod = autoChartGran();   // follow the period by default
  var gran = financeChartPeriod;
  // safety clamps so the bucket count stays sane
  if(spanDays <= 3 && gran!=='daily') gran='daily';
  if(gran==='daily' && spanDays > 92) gran='weekly';
  if(gran==='weekly' && spanDays > 2*366) gran='monthly';
  financeChartPeriod = gran;
  document.querySelectorAll('.chart-period-btn').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-cp')===gran); });

  if(gran === 'daily'){
    var d0 = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    while(d0 < to){
      var d1 = new Date(d0.getTime() + 86400000);
      var rD = calcPeriod(d0, d1 > to ? to : d1);
      labels.push(d0.toLocaleDateString('ar-EG',{day:'numeric',month:'short'}));
      revData.push(rD.rev); profData.push(rD.profit);
      d0 = d1;
    }
  } else if(gran === 'weekly'){
    var w0 = new Date(from), wi = 1;
    while(w0 < to){
      var w1 = new Date(w0.getTime() + 7*86400000);
      var rW = calcPeriod(w0, w1 > to ? to : w1);
      labels.push('أسبوع '+(wi++));
      revData.push(rW.rev); profData.push(rW.profit);
      w0 = w1;
    }
  } else if(gran === 'yearly'){
    var lastY = new Date(to.getTime()-1).getFullYear();
    for(var y = from.getFullYear(); y <= lastY; y++){
      var rY = calcPeriod(new Date(y,0,1), new Date(y+1,0,1));
      labels.push(String(y));
      revData.push(rY.rev); profData.push(rY.profit);
    }
  } else {
    // monthly
    var m0 = new Date(from.getFullYear(), from.getMonth(), 1);
    while(m0 < to){
      var m1 = new Date(m0.getFullYear(), m0.getMonth()+1, 1);
      var rM = calcPeriod(m0, m1 > to ? to : m1);
      labels.push(m0.toLocaleDateString('ar-EG',{month:'short',year:'2-digit'}));
      revData.push(rM.rev); profData.push(rM.profit);
      m0 = m1;
    }
  }

  if(financeChartInstance){ financeChartInstance.destroy(); }
  financeChartInstance = new Chart(canvas, {
    type:'line',
    data:{
      labels:labels,
      datasets:[
        {label:'الإيرادات', data:revData, borderColor:'rgba(59,130,246,1)', backgroundColor:'rgba(59,130,246,.1)', fill:true, tension:.35, pointRadius:3, pointHoverRadius:6},
        {label:'صافي الربح', data:profData, borderColor:'rgba(16,185,129,1)', backgroundColor:'rgba(16,185,129,.1)', fill:true, tension:.35, pointRadius:3, pointHoverRadius:6}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins:{
        legend:{position:'top',labels:{font:{family:'Cairo',weight:'700'},padding:16}},
        tooltip:{callbacks:{label:function(ctx){return ctx.dataset.label+': '+ctx.parsed.y.toLocaleString('ar-EG')+' ج';}}}
      },
      scales:{
        y:{beginAtZero:true, ticks:{font:{family:'JetBrains Mono'}, callback:function(v){return v.toLocaleString('ar-EG');}}},
        x:{ticks:{font:{family:'Cairo',size:financeChartPeriod==='daily'?9:11}}}
      }
    }
  });
}

export function isConfirmedForFinance(o){
  // Explicitly exclude pending/cancelled from confirmation calculations.
  if(!o || o.status==='pending' || o.status==='cancelled') return false;
  return o.status==='confirmed'
    || statusIn(o.status, BOSTA_POSITIVE_STATUSES)
    || statusIn(o.status, DELIVERED_STATUSES)
    || statusIn(o.status, RETURNED_STATUSES)
    || o.status==='Exception'
    || o.status==='exception'
    || o.status==='failed';
}

// ────────────────── EXPENSES TAB ──────────────────
export function renderExpenses(){
  var q = ($id('exp-search').value || '').trim().toLowerCase();
  var cat = $id('exp-filter-cat').value;
  var range = getPeriodRange();
  var list = financeExpenses.filter(function(e){
    var d = new Date(e.expense_date);
    if(d < range.from || d >= range.to) return false;
    if(cat && e.category !== cat) return false;
    if(q && (e.note||'').toLowerCase().indexOf(q) < 0 && e.category.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  $id('exp-count').textContent = num(list.length) + ' مصروف';

  // Update category summary cards
  function sumCat(c){ return list.filter(function(e){return e.category===c;}).reduce(function(s,e){return s+parseFloat(e.amount);},0); }
  $id('exp-sum-salaries').textContent = num(sumCat('مرتبات').toFixed(0))+' ج';
  $id('exp-sum-ads').textContent = num(sumCat('إعلانات فيسبوك').toFixed(0))+' ج';
  $id('exp-sum-packaging').textContent = num(sumCat('تغليف').toFixed(0))+' ج';
  $id('exp-sum-bills').textContent = num(sumCat('فواتير').toFixed(0))+' ج';
  $id('exp-sum-warehouse').textContent = num(sumCat('مخزن').toFixed(0))+' ج';
  $id('exp-sum-other').textContent = num(sumCat('متفرقات').toFixed(0))+' ج';

  if(!list.length){ $id('exp-tbody').innerHTML = emptyState({icon:'🧾',
      title:'مفيش مصاريف متسجّلة',
      sub:'سجّل مصاريفك — إعلانات، تغليف، تشغيل — عشان صافي الربح اللي بتشوفه يبقى حقيقي مش شكلي.',
      act:'add-expense', actLabel:'+ سجّل أول مصروف'}); return; }

  var h = '<table><thead><tr>'
    + '<th>التاريخ</th><th>الفئة</th><th>المبلغ</th><th>ملاحظة</th><th></th>'
    + '</tr></thead><tbody>';
  list.forEach(function(e){
    var catSafe = e.category.replace(' ','-').replace('فيسبوك','');
    h += '<tr>'
      + '<td class="mn">'+fmtD(e.expense_date)+'</td>'
      + '<td><span class="exp-cat-badge exp-cat-'+e.category.split(' ')[0]+'">'+esc(e.category)+'</span></td>'
      + '<td class="mn" style="font-weight:900;color:var(--red);">'+num(e.amount)+' ج</td>'
      + '<td>'+esc(e.note||'')+'</td>'
      + '<td><div class="exp-row-actions">'
      +   '<button class="exp-edit-btn" data-id="'+e.id+'">✏️</button>'
      +   '<button class="exp-del-btn" data-id="'+e.id+'">🗑️</button>'
      +   '</div></td>'
      + '</tr>';
  });
  h += '</tbody></table>';
  $id('exp-tbody').innerHTML = h;

  $id('exp-tbody').querySelectorAll('.exp-edit-btn').forEach(function(b){
    b.addEventListener('click', function(){ openExpenseEditor(b.getAttribute('data-id')); });
  });
  $id('exp-tbody').querySelectorAll('.exp-del-btn').forEach(function(b){
    b.addEventListener('click', function(){ deleteExpense(b.getAttribute('data-id')); });
  });
}

export function openExpenseEditor(id){
  var exp = null;
  if(id){
    for(var i=0;i<financeExpenses.length;i++){ if(financeExpenses[i].id === id){ exp = financeExpenses[i]; break; } }
  }
  var isNew = !exp;
  // Build today's date in Cairo timezone (local), NOT UTC.
  // toISOString().slice(0,10) returns the UTC date which can be off-by-one
  // for users in Cairo between 22:00-23:59 (summer) or 21:00-23:59 (winter).
  var _t = new Date();
  var todayLocal = _t.getFullYear()+'-'+pad2(_t.getMonth()+1)+'-'+pad2(_t.getDate());
  exp = exp || { category:'إعلانات فيسبوك', amount:0, expense_date:todayLocal, note:'' };

  $id('dtit').textContent = isNew ? 'إضافة مصروف' : 'تعديل مصروف';
  $id('dcnt').innerHTML = '<div class="dsec">'
    + '<label class="slbl" style="text-align:right;display:block">الفئة</label>'
    + '<select class="fsel" id="exp-cat" style="width:100%">'
    +   ['مرتبات','إعلانات فيسبوك','تغليف','فواتير','مخزن','متفرقات'].map(function(c){
          return '<option value="'+c+'" '+(c===exp.category?'selected':'')+'>'+c+'</option>';
        }).join('')
    + '</select>'
    + '<label class="slbl" style="text-align:right;display:block;margin-top:10px">المبلغ (جنيه)</label>'
    + '<input class="sinp" id="exp-amount" type="number" step="0.01" value="'+exp.amount+'">'
    + '<label class="slbl" style="text-align:right;display:block;margin-top:10px">التاريخ</label>'
    + '<input class="sinp" id="exp-date" type="date" value="'+(exp.expense_date||'').slice(0,10)+'">'
    + '<label class="slbl" style="text-align:right;display:block;margin-top:10px">ملاحظة</label>'
    + '<input class="sinp" id="exp-note" type="text" value="'+esc(exp.note||'')+'" style="direction:rtl;text-align:right">'
    + '</div>'
    + '<div class="dacts">'
    +   (isNew ? '' : '<button class="abtn cn" id="exp-del">🗑️ حذف</button>')
    +   '<button class="abtn ok" id="exp-save">💾 حفظ</button>'
    + '</div>';

  $id('exp-save').addEventListener('click', function(){
    var data = {
      tenant_id: currentTenantId,
      category: $id('exp-cat').value,
      amount: parseFloat($id('exp-amount').value) || 0,
      expense_date: $id('exp-date').value,
      note: $id('exp-note').value.trim() || null,
      created_by: currentUser ? currentUser.id : null
    };
    if(data.amount <= 0){ toast('المبلغ لازم يكون أكبر من صفر','er'); return; }
    var op = isNew
      ? sb.from('expenses').insert(data)
      : sb.from('expenses').update({category:data.category, amount:data.amount, expense_date:data.expense_date, note:data.note}).eq('id', exp.id).eq('tenant_id', currentTenantId);
    op.then(function(r){
      if(r.error){ toast('خطأ: '+r.error.message,'er'); return; }
      toast(isNew ? 'تم إضافة المصروف ✓' : 'تم التحديث ✓','ok');
      $id('ovl').classList.remove('open');
      loadFinance();
    });
  });

  if(!isNew){
    $id('exp-del').addEventListener('click', function(){ deleteExpense(exp.id); });
  }

  $id('ovl').classList.add('open');
}

export function deleteExpense(id){
  if(!confirm('حذف المصروف؟')) return;
  sb.from('expenses').delete().eq('id', id).eq('tenant_id', currentTenantId).then(function(r){
    if(r.error){ toast('خطأ: '+r.error.message,'er'); return; }
    toast('تم الحذف','ok');
    $id('ovl').classList.remove('open');
    loadFinance();
  });
}

// ────────────────── FINANCE EVENT WIREUP ──────────────────
// الفاينانس والمصاريف والمشاكل والتلميحات
export function initFinanceAndIssues(){
  document.querySelectorAll('.period-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var type = b.getAttribute('data-period');
      document.querySelectorAll('.period-btn').forEach(function(x){ x.classList.toggle('active', x===b); });
      var crow = $id('fin-custom-row');
      if(type === 'custom'){ if(crow) crow.style.display='flex'; return; }  // wait for طبّق
      if(crow) crow.style.display='none';
      setPeriod(financePeriod, type);
      financeChartManual = false;             // chart auto-follows the new period
      financeChartPeriod = autoChartGran();
      renderFinance();
    });
  });

  // Chart period toggle (daily/weekly/monthly/yearly)
  document.querySelectorAll('.chart-period-btn').forEach(function(b){
    b.addEventListener('click', function(){
      financeChartManual = true;   // user override — stops auto-following the period
      financeChartPeriod = b.getAttribute('data-cp');
      document.querySelectorAll('.chart-period-btn').forEach(function(x){ x.classList.toggle('active', x===b); });
      renderFinanceChart();
    });
  });
  $id('fin-custom-apply').addEventListener('click', function(){
    var from = $id('fin-from').value;
    var to = $id('fin-to').value;
    if(!from || !to){ toast('اختر التاريخين','er'); return; }
    if(from > to){ var sw=from; from=to; to=sw; }
    setPeriod(financePeriod, 'custom', from, to);
    document.querySelectorAll('.period-btn').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-period')==='custom'); });
    financeChartManual = false;
    financeChartPeriod = autoChartGran();   // chart follows the custom range
    renderFinance();
  });
  // Finance tabs
  document.querySelectorAll('.stock-tab[data-ftab]').forEach(function(b){
    b.addEventListener('click', function(){
      financeCurrentTab = b.getAttribute('data-ftab');
      document.querySelectorAll('.stock-tab[data-ftab]').forEach(function(x){ x.classList.toggle('active', x===b); });
      $id('finance-overview-tab').style.display = financeCurrentTab==='overview' ? 'block' : 'none';
      $id('finance-expenses-tab').style.display = financeCurrentTab==='expenses' ? 'block' : 'none';
    });
  });
  $id('exp-search').addEventListener('input', renderExpenses);
  $id('exp-filter-cat').addEventListener('change', renderExpenses);
  $id('add-expense-btn').addEventListener('click', function(){ openExpenseEditor(null); });
  if($id('issues-refresh'))$id('issues-refresh').addEventListener('click',loadIssues);
  if($id('issues-search'))$id('issues-search').addEventListener('input',renderIssuesTable);
  if($id('issues-filter-prio'))$id('issues-filter-prio').addEventListener('change',renderIssuesTable);
  if($id('issues-filter-scope'))$id('issues-filter-scope').addEventListener('change',renderIssuesTable);

  // ═══════════════════ END FINANCE SECTION ═══════════════════════

  // ═══════════════════ INFO TOOLTIP (floating, never clipped) ═══════════════
  (function initInfoTooltips(){
    var tip = document.createElement('div');
    tip.id = 'sc-floating-tip';
    document.body.appendChild(tip);

    function showTip(icon){
      var text = icon.getAttribute('data-tip');
      if(!text) return;
      tip.textContent = text;
      tip.classList.add('show');
      // Measure after content set
      var r = icon.getBoundingClientRect();
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      // Position above the icon, aligned so arrow (right:18px) points near icon
      var left = r.left + r.width/2 - (tw - 18);
      var top = r.top - th - 10;
      // Keep within viewport
      if(left < 8) left = 8;
      if(left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
      if(top < 8){ // not enough room above → show below
        top = r.bottom + 10;
        tip.style.setProperty('--arrow-side','top');
      }
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function hideTip(){ tip.classList.remove('show'); }

    document.addEventListener('mouseover', function(e){
      var icon = e.target.closest('.sc-info');
      if(icon) showTip(icon);
    });
    document.addEventListener('mouseout', function(e){
      if(e.target.closest('.sc-info')) hideTip();
    });
    // Mobile: tap to toggle
    document.addEventListener('click', function(e){
      var icon = e.target.closest('.sc-info');
      if(icon){
        if(tip.classList.contains('show')) hideTip();
        else showTip(icon);
        e.stopPropagation();
      } else {
        hideTip();
      }
    });
  })();

}
