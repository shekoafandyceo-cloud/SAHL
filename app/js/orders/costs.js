// تكلفة البضاعة والمخزون وتصنيف الأوردر — دوال حسابية خالصة

import { emptyState } from '../core/empty.js';
import { buildProductPerformance } from '../analytics/analytics.js';
import { ratePill } from '../analytics/rate.js';
import { nameKey, normalizeProductName, parseProductItems, tokenSortKey } from '../analytics/product-match.js';
import { currentTenantId } from '../auth/auth.js';
import { BOSTA_INVENTORY_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusIn } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { money, num, short } from '../core/format.js';
import { sb } from '../core/supabase.js';
import { unmatchedCogsItems } from '../finance/finance.js';
import { stockMovements, stockProducts, stockSetMovements, stockSetProducts } from '../stock/stock.js';
import { isAdmin } from './guards.js';
import { all } from './state.js';

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
    .select('id,name,current_qty,wholesale_price,unit_price,active,parent_id,variant_label')
    .eq('tenant_id',currentTenantId)
    .eq('active',true)
    .then(function(r){
      if(!r.error && r.data)stockSetProducts(r.data);
      done&&done();
    });
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

// فرز جدول أداء المنتجات — ضغطة على عنوان العمود بتقلب الاتجاه.
// الحالة هنا لأن الرندر هنا (كل حالة ليها كاتب واحد). الافتراضي زي
// ما كان دايماً: الأعلى Revenue الأول.
export var perfSort = { key:'revenue', dir:'desc' };

export function perfSortBy(key){
  if(perfSort.key === key){ perfSort.dir = perfSort.dir === 'desc' ? 'asc' : 'desc'; }
  else { perfSort.key = key; perfSort.dir = 'desc'; }
  renderProductPerformance();
}

export function renderProductPerformance(){
  var q=($id('perf-search')?($id('perf-search').value||'').trim().toLowerCase():'');
  var data=buildProductPerformance();
  var list=data.filter(function(p){return !q||p.name.toLowerCase().indexOf(q)>=0;});
  // الكروت الأربعة فوق ثابتة على معاييرها مهما اتغيّر فرز الجدول
  $id('pf-products').textContent=num(data.length);
  $id('pf-top-rev').textContent=data[0]?short(data[0].name,18):'—';
  // null في المقارنة بيتحول 0 والفرز يقع على عدد الأوردرات — متجر من غير
  // ولا شحنة محسومة كان بيشوف "أفضل تسليم" و"أعلى مرتجع" مخترعين.
  // النسبة null = المنتج مالوش شحنات مكتملة فمايدخلش المنافسة أصلاً.
  var bestDel=data.filter(function(p){return p.deliveryRate!=null;})
    .sort(function(a,b){return b.deliveryRate-a.deliveryRate||b.orders-a.orders;})[0];
  var worstRet=data.filter(function(p){return p.returnRate!=null;})
    .sort(function(a,b){return b.returnRate-a.returnRate||b.orders-a.orders;})[0];
  $id('pf-top-del').textContent=bestDel?short(bestDel.name,18):'—';
  $id('pf-top-ret').textContent=worstRet?short(worstRet.name,18):'—';
  $id('perf-count').textContent=list.length!==data.length?num(list.length)+' نتيجة':num(data.length)+' منتج';
  if(!list.length){$id('perf-tbody').innerHTML=emptyState({icon:'📈',
      title:'مفيش أداء منتجات لسه',
      sub:'أول ما توصل أوردرات بأسماء منتجاتك هتشوف هنا أنهي منتج بيكسب وأنهي بيخسر.'});return;}
  var adminView = isAdmin();
  // الفرز: null دايماً في الآخر مهما كان الاتجاه — عشان منتج من غير
  // شحنات مكتملة مايطلعش "أحسن منتج تسليم" بالصدفة
  var sk=perfSort.key, sd=perfSort.dir==='asc'?1:-1;
  list=list.slice().sort(function(a,b){
    var av=a[sk], bv=b[sk];
    var an=(av==null||isNaN(av)), bn=(bv==null||isNaN(bv));
    if(an&&bn)return 0; if(an)return 1; if(bn)return -1;
    return (av-bv)*sd || b.orders-a.orders;
  });
  function th(key,label,title){
    var on=perfSort.key===key;
    return '<th class="psort'+(on?' on':'')+'" data-act="perf-sort" data-key="'+key+'"'
      +(title?' title="'+title+'"':'')+'>'+label
      +'<span class="psort-ar">'+(on?(perfSort.dir==='desc'?'▼':'▲'):'⇅')+'</span></th>';
  }
  var h='<table><thead><tr>'
    +'<th>المنتج</th>'+th('orders','طلبات')+th('qty','قطع')
    +th('revenue','Revenue تقديري','قيمة كل الأوردرات في الفترة بأي حالة — مش المتحصل فعلاً')
    +th('confirmRate','مؤكد/شحن','نسبة التأكيد = اللي دخل رحلة الشحن ÷ اللي اتعامل معاه (يستبعد Pending) — نفس كروت اللوحة. اضغط للفرز')
    +th('deliveryRate','تسليم','نسبة التسليم = المسلَّم ÷ (المسلَّم + المرتجع) — نفس كروت اللوحة. اضغط للفرز')
    +th('cancelled','إلغاء')
    +th('returnRate','مرتجع/فشل','نسبة المرتجع = المرتجع ÷ (المسلَّم + المرتجع). اضغط للفرز')
    +th('paymob','Paymob')
    +(adminView?th('profit','ربح المنتج','ربح تقديري على الأوردرات المسلَّمة فقط (إيراد المسلَّم − تكلفة القطع المسلَّمة)، قبل الشحن والمصاريف'):'')
    +'</tr></thead><tbody>';
  list.forEach(function(p){
    h+='<tr>'
      +'<td class="nm" title="'+esc(p.name)+'">'+esc(short(p.name,42))+'</td>'
      +'<td class="mn">'+num(p.orders)+'</td>'
      +'<td class="mn">'+num(p.qty)+'</td>'
      +'<td class="price-cell">'+money(p.revenue)+'</td>'
      +'<td>'+ratePill(p.confirmRate)+'</td>'
      +'<td>'+ratePill(p.deliveryRate)+'</td>'
      +'<td class="mn">'+num(p.cancelled)+'</td>'
      +'<td>'+ratePill(p.returnRate,true)+'</td>'
      +'<td class="mn">'+num(p.paymob)+'</td>'
      +(adminView?'<td class="price-cell">'+(p.profit===null?'—':money(p.profit))+'</td>':'')
      +'</tr>';
  });
  h+='</tbody></table>';
  $id('perf-tbody').innerHTML=h;
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

// Status category helpers
export function isDeliveredOrder(o){ return o.status === 'delivered' || o.status === 'Delivered'; }

export function isWithBosta(o){
  return ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2',
    'Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs',
    'Picking up from consignee','Out for exchange'].indexOf(o.status) >= 0;
}
