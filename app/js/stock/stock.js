// المخزون — الحالة والتحميل والرسم والمحرّرات والتنبيهات

import { normalizeProductName } from '../analytics/product-match.js';
import { $id, esc } from '../core/dom.js';
import { fmt, fmtMovementDate, num, pad2, short } from '../core/format.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { tourDemoMovements, tourDemoStock } from '../tour/demo-data.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { ensureTenant, isAdmin, loadBostaInventoryCard, movementWholesalePrice, renderProductPerformance, requireAdmin, showPage } from '../main.js';
import { currentRole, currentTenantId } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';

export function stockSetProducts(v){ stockProducts = v || []; }

export function stockSetMovements(v){ stockMovements = v || []; }

export var stockProducts=[], stockMovements=[], currentStockTab='products';  // المخزون — الجولة بتبدّله بديمو

export function loadStock(){
  // During the guided tour, never hit Supabase — keep the injected demo data
  // so the cards/products/movements actually show something to learn from.
  if(tourActive){
    if(!stockProducts || !stockProducts.length) stockProducts = tourDemoStock();
    if(!stockMovements || !stockMovements.length) stockMovements = tourDemoMovements();
    updateStockStats();
    renderProducts();
    renderMovements();
    return;
  }
  if(!ensureTenant())return;
  $id('prod-tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل المنتجات...</div>';
  $id('mov-tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل الحركات...</div>';

  // v_stock_products بيحجب wholesale_price عن غير الأدمن على مستوى السيرفر —
  // مش محتاجين نفلتر الأعمدة من هنا تاني.
  sb.from('v_stock_products').select('*').eq('tenant_id',currentTenantId).order('current_qty',{ascending:false}).then(function(r){
    if(r.error){toast('خطأ في المنتجات: '+r.error.message,'er');return;}
    stockProducts=r.data||[];
    updateStockStats();
    loadBostaInventoryCard();
    renderProducts();
    if(stockMovements && stockMovements.length)renderMovements();
  });
  sb.from('stock_movements').select('*').eq('tenant_id',currentTenantId).order('created_at',{ascending:false}).limit(500).then(function(r){
    if(r.error){return;}
    stockMovements=r.data||[];
    renderMovements();
  });
}

export function updateStockStats(){
  $id('st-products').textContent=num(stockProducts.length);
  var totalQty=stockProducts.reduce(function(s,p){return s+(p.current_qty||0);},0);
  $id('st-qty').textContent=num(totalQty);
  var totalVal=stockProducts.reduce(function(s,p){return s+((p.current_qty||0)*(p.wholesale_price||0));},0);
  $id('st-value').textContent=num(totalVal)+' ج';
  var empty=stockProducts.filter(function(p){return (p.current_qty||0)<=0;}).length;
  $id('st-empty').textContent=num(empty);
}

export function renderProducts(){
  var q=($id('prod-search').value||'').trim().toLowerCase();
  var list=stockProducts.filter(function(p){return !q||(p.name||'').toLowerCase().indexOf(q)>=0;});
  $id('prod-count').textContent=list.length!==stockProducts.length?num(list.length)+' نتيجة':num(stockProducts.length)+' منتج';

  if(!list.length){$id('prod-tbody').innerHTML='<div class="ldg">لا توجد منتجات</div>';return;}

  var isAdmin = currentRole === 'admin';
  var h='<table><thead><tr>'
    +'<th>اسم المنتج</th>'
    +'<th>المخزون</th>'
    +(isAdmin?'<th>سعر الجملة</th>':'')
    +'<th>سعر القطعة</th>'
    +(isAdmin?'<th>القيمة الإجمالية</th>':'')
    +(isAdmin?'<th></th>':'')
    +'</tr></thead><tbody>';
  list.forEach(function(p){
    var qty=p.current_qty||0;
    var qtyClass=qty<=0?'zero':qty<10?'low':'ok';
    var val=qty*(p.wholesale_price||0);
    h+='<tr>'
      +'<td class="nm">'+esc(p.name)+'</td>'
      +'<td><span class="qty-cell '+qtyClass+'">'+num(qty)+'</span></td>'
      +(isAdmin?'<td class="price-cell">'+(p.wholesale_price?num(p.wholesale_price)+' ج':'—')+'</td>':'')
      +'<td class="price-cell">'+(p.unit_price?num(p.unit_price)+' ج':'—')+'</td>'
      +(isAdmin?'<td class="price-cell">'+num(val)+' ج</td>':'')
      +(isAdmin?'<td><button class="prod-edit-btn" data-id="'+p.id+'">✏️ تعديل</button></td>':'')
      +'</tr>';
  });
  h+='</tbody></table>';
  $id('prod-tbody').innerHTML=h;
  $id('prod-tbody').querySelectorAll('.prod-edit-btn').forEach(function(b){
    b.addEventListener('click',function(){openProductEditor(b.getAttribute('data-id'));});
  });
}

export function renderMovements(){
  var q=($id('mov-search').value||'').trim().toLowerCase();
  var typeFilter=$id('mov-type').value;
  var list=stockMovements.filter(function(m){
    if(typeFilter&&m.movement_type!==typeFilter)return false;
    if(q){
      var h=[m.product_name,m.tracking_no,m.notes].filter(Boolean).join(' ').toLowerCase();
      if(h.indexOf(q)<0)return false;
    }
    return true;
  });
  $id('mov-count').textContent=list.length!==stockMovements.length?num(list.length)+' نتيجة':num(stockMovements.length)+' حركة';

  if(!list.length){$id('mov-tbody').innerHTML='<div class="ldg">لا توجد حركات</div>';return;}

  var adminView=isAdmin();
  var h='<table><thead><tr>'
    +'<th>التاريخ</th>'
    +'<th>المنتج</th>'
    +(adminView?'<th>سعر الجملة</th>':'')
    +'<th>دخول</th>'
    +'<th>خروج</th>'
    +'<th>رقم التتبع</th>'
    +'<th>ملاحظات</th>'
    +'</tr></thead><tbody>';
  list.forEach(function(m){
    var wholesale=movementWholesalePrice(m);
    var wholesaleHtml=wholesale>0
      ? '<span class="movement-cost ok">'+num(wholesale)+' ج</span>'
      : '<span class="movement-cost zero" title="سعر الجملة غير مسجل أو صفر — راجع stock_products.wholesale_price">⚠️ 0 ج</span>';
    h+='<tr>'
      +'<td class="mn">'+fmtMovementDate(m.movement_date,m.created_at)+'</td>'
      +'<td class="nm">'+esc(m.product_name)+'</td>'
      +(adminView?'<td>'+wholesaleHtml+'</td>':'')
      +'<td>'+(m.qty_in?'<span class="mov-in">+'+num(m.qty_in)+'</span>':'—')+'</td>'
      +'<td>'+(m.qty_out?'<span class="mov-out">-'+num(m.qty_out)+'</span>':'—')+'</td>'
      +'<td class="mn">'+esc(fmt(m.tracking_no))+'</td>'
      +'<td class="pr">'+esc(fmt(m.notes))+'</td>'
      +'</tr>';
  });
  h+='</tbody></table>';
  $id('mov-tbody').innerHTML=h;
}

export function openProductEditor(id){
  if(!requireAdmin())return;
  if(!ensureTenant())return;
  var p=null;
  if(id){for(var i=0;i<stockProducts.length;i++){if(stockProducts[i].id===id){p=stockProducts[i];break;}}}
  var isNew=!p;
  p=p||{name:'',current_qty:0,wholesale_price:0,unit_price:0};

  $id('dtit').textContent=isNew?'إضافة منتج جديد':'تعديل المنتج';
  $id('dcnt').innerHTML='<div class="dsec">'
    +'<label class="slbl" style="text-align:right;display:block">اسم المنتج</label>'
    +'<input class="sinp" id="pe-name" type="text" value="'+esc(p.name||'')+'" style="direction:rtl;text-align:right">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">'+(isNew?'الكمية الافتتاحية':'المخزون الحالي')+'</label>'
    +'<input class="sinp" id="pe-qty" type="number" value="'+(p.current_qty||0)+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">سعر الجملة (للقطعة الواحدة)</label>'
    +'<input class="sinp" id="pe-wholesale" type="number" step="0.01" value="'+(p.wholesale_price||0)+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">سعر البيع للقطعة</label>'
    +'<input class="sinp" id="pe-unit" type="number" step="0.01" value="'+(p.unit_price||0)+'">'
    +'</div>'
    +'<div class="dacts">'
    +(isNew?'':'<button class="abtn cn" id="pe-del">🗑️ حذف</button>')
    +'<button class="abtn ok" id="pe-save">💾 حفظ</button>'
    +'</div>';

  $id('pe-save').addEventListener('click',function(){
    var data={
      tenant_id:currentTenantId,
      name:$id('pe-name').value.trim(),
      current_qty:parseInt($id('pe-qty').value)||0,
      wholesale_price:parseFloat($id('pe-wholesale').value)||0,
      unit_price:parseFloat($id('pe-unit').value)||0
    };
    if(!data.name){toast('اسم المنتج مطلوب','er');return;}
    var op = isNew ? sb.from('stock_products').insert(data) : sb.from('stock_products').update(data).eq('id',p.id).eq('tenant_id',currentTenantId);
    op.then(function(r){
      if(r.error){toast('خطأ: '+r.error.message,'er');return;}
      toast(isNew?'تم إضافة المنتج ✓':'تم تحديث المنتج ✓','ok');
      $id('ovl').classList.remove('open');
      loadStock();
    });
  });

  if(!isNew){
    $id('pe-del').addEventListener('click',function(){
      if(!confirm('حذف المنتج "'+p.name+'"؟ هتُحذف كل بياناته.'))return;
      sb.from('stock_products').delete().eq('id',p.id).eq('tenant_id',currentTenantId).then(function(r){
        if(r.error){toast('خطأ: '+r.error.message,'er');return;}
        toast('تم الحذف','ok');
        $id('ovl').classList.remove('open');
        loadStock();
      });
    });
  }

  $id('ovl').classList.add('open');
}

export function openMovementEditor(){
  if(!requireAdmin())return;
  if(!ensureTenant())return;
  $id('dtit').textContent='تسجيل حركة مخزون';
  var prodOptions=stockProducts.map(function(p){return '<option value="'+p.id+'" data-name="'+esc(p.name)+'">'+esc(p.name)+' (متاح: '+(p.current_qty||0)+')</option>';}).join('');
  var _nowDate=new Date();
  var nowValue=_nowDate.getFullYear()+'-'+pad2(_nowDate.getMonth()+1)+'-'+pad2(_nowDate.getDate());
  $id('dcnt').innerHTML='<div class="dsec">'
    +'<label class="slbl" style="text-align:right;display:block">المنتج</label>'
    +'<select class="fsel" id="me-prod" style="width:100%"><option value="">اختر المنتج...</option>'+prodOptions+'</select>'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">نوع الحركة</label>'
    +'<select class="fsel" id="me-type" style="width:100%"><option value="in">دخول (إضافة للمخزن)</option><option value="out">خروج (خصم من المخزن)</option></select>'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">الكمية</label>'
    +'<input class="sinp" id="me-qty" type="number" value="1" min="1">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">التاريخ</label>'
    +'<input class="sinp" id="me-date" type="date" value="'+nowValue+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">رقم التتبع (اختياري)</label>'
    +'<input class="sinp" id="me-uid" type="text" placeholder="رقم التتبع إذا كانت الحركة مرتبطة بشحنة">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">ملاحظات</label>'
    +'<input class="sinp" id="me-notes" type="text" placeholder="ملاحظة (اختياري)" style="direction:rtl;text-align:right">'
    +'</div>'
    +'<div class="dacts">'
    +'<button class="abtn ok" id="me-save">💾 تسجيل الحركة</button>'
    +'</div>';

  $id('me-save').addEventListener('click',function(){
    var prodSel=$id('me-prod');
    var prodId=prodSel.value;
    if(!prodId){toast('اختر المنتج','er');return;}
    var prodName=prodSel.options[prodSel.selectedIndex].getAttribute('data-name');
    var type=$id('me-type').value;
    var qty=parseInt($id('me-qty').value)||0;
    if(qty<=0){toast('الكمية يجب أن تكون أكبر من صفر','er');return;}
    var data={
      tenant_id:currentTenantId,
      product_id:prodId,
      product_name:prodName,
      movement_type:type,
      qty_in: type==='in'?qty:0,
      qty_out:type==='out'?qty:0,
      // movement_date is date-only; actual timestamp comes from created_at.
      movement_date: $id('me-date').value,
      tracking_no:$id('me-uid').value.trim()||null,
      notes:$id('me-notes').value.trim()||null
    };
    sb.from('stock_movements').insert(data).then(function(r){
      if(r.error){toast('خطأ: '+r.error.message,'er');return;}
      toast('تم تسجيل الحركة ✓ المخزون اتحدث تلقائياً','ok');
      $id('ovl').classList.remove('open');
      loadStock();
    });
  });

  $id('ovl').classList.add('open');
}

// تابات المخزون والبحث فيه
export function initStockTabs(){
  document.querySelectorAll('.stock-tab[data-tab]').forEach(function(b){
    b.addEventListener('click',function(){
      currentStockTab=b.getAttribute('data-tab');
      document.querySelectorAll('.stock-tab[data-tab]').forEach(function(x){x.classList.toggle('active',x===b);});
      $id('stock-products-tab').style.display = currentStockTab==='products'?'block':'none';
      $id('stock-movements-tab').style.display = currentStockTab==='movements'?'block':'none';
    });
  });
  $id('prod-search').addEventListener('input',renderProducts);
  $id('mov-search').addEventListener('input',renderMovements);
  $id('mov-type').addEventListener('change',renderMovements);
  $id('perf-search').addEventListener('input',renderProductPerformance);
}

// أزرار إضافة منتج وحركة
export function initStockButtons(){
  $id('add-product-btn').addEventListener('click',function(){openProductEditor(null);});
  $id('add-mov-btn').addEventListener('click',openMovementEditor);
}

  // ─────────────────────────────────────────────────
  // SMART STOCK ALERTS + ISSUES CENTER
  // ─────────────────────────────────────────────────

export function parseMovementDate(m){
  var raw=m.created_at || m.movement_date;
  if(!raw)return null;
  var d=new Date(raw);
  return isNaN(d.getTime())?null:d;
}

export function recentQtyOutByProduct(days){
  var now=Date.now();
  var windowMs=days*24*60*60*1000;
  var map={};
  (stockMovements||[]).forEach(function(m){
    if(m.movement_type!=='out')return;
    var d=parseMovementDate(m); if(!d)return;
    if(now-d.getTime()>windowMs)return;
    var name=normalizeProductName(m.product_name);
    var key=name.toLowerCase();
    map[key]=(map[key]||0)+(Number(m.qty_out||0)||0);
  });
  return map;
}

export function stockForecastRows(){
  var out7=recentQtyOutByProduct(7);
  var rows=(stockProducts||[]).map(function(p){
    var name=normalizeProductName(p.name);
    var qty=Number(p.current_qty||0)||0;
    var sold7=out7[name.toLowerCase()]||0;
    var avg=sold7/7;
    var daysLeft=avg>0 ? qty/avg : null;
    var level='ok', msg='مخزون مستقر';
    if(qty<=0){level='critical';msg='نفد من المخزون';daysLeft=0;}
    else if(avg>0 && daysLeft<=3){level='critical';msg='هينفد خلال 3 أيام أو أقل';}
    else if(avg>0 && daysLeft<=7){level='warn';msg='هينفد خلال أسبوع تقريبًا';}
    else if(avg===0 && qty>0 && qty<10){level='warn';msg='مخزون قليل لكن مفيش سحب حديث';}
    return {product:p,name:name,qty:qty,sold7:sold7,avg:avg,daysLeft:daysLeft,level:level,msg:msg,wholesale:Number(p.wholesale_price||0)||0};
  });
  rows.sort(function(a,b){
    var pr={critical:0,warn:1,ok:2};
    if(pr[a.level]!==pr[b.level])return pr[a.level]-pr[b.level];
    var da=a.daysLeft===null?9999:a.daysLeft, db=b.daysLeft===null?9999:b.daysLeft;
    return da-db;
  });
  return rows;
}

export function renderSmartStockAlerts(targetId, limit){
  var target=$id(targetId);
  if(!target)return;
  var rows=stockForecastRows().filter(function(r){return r.level!=='ok';}).slice(0,limit||6);
  if(!rows.length){
    target.innerHTML='<div class="smart-alert-card info"><div class="alert-head"><span>✅</span><span class="alert-title">المخزون مستقر حاليًا</span></div><div class="alert-sub">مفيش منتجات متوقعة تنفد قريبًا بناءً على حركات الخروج آخر 7 أيام.</div></div>';
    return;
  }
  target.innerHTML=rows.map(function(r){
    var cls=r.level==='critical'?'critical':'warn';
    var icon=r.level==='critical'?'🚨':'⚠️';
    var daysTxt=r.daysLeft===null?'غير محسوب':(r.daysLeft<=0?'نفد':r.daysLeft.toFixed(1)+' يوم');
    return '<div class="smart-alert-card '+cls+'">'
      + '<div class="alert-head"><span>'+icon+'</span><span class="alert-title">'+esc(short(r.name,34))+'</span><span class="alert-badge">'+esc(r.msg)+'</span></div>'
      + '<div class="alert-main">'+daysTxt+'</div>'
      + '<div class="alert-sub">المتاح: '+num(r.qty)+' قطعة · سحب آخر 7 أيام: '+num(r.sold7)+' · متوسط يومي: '+(r.avg?r.avg.toFixed(1):'0')+' قطعة</div>'
      + '<div class="alert-actions"><button class="alert-action" data-stock-search="'+esc(r.name)+'">افتح المنتج</button></div>'
      + '</div>';
  }).join('');
  target.querySelectorAll('[data-stock-search]').forEach(function(b){
    b.addEventListener('click',function(){openStockProductByName(b.getAttribute('data-stock-search'));});
  });
}

export function openStockProductByName(name){
  showPage('stock');
  currentStockTab='products';
  document.querySelectorAll('.stock-tab[data-tab]').forEach(function(x){x.classList.toggle('active',x.getAttribute('data-tab')==='products');});
  $id('stock-products-tab').style.display='block';
  $id('stock-movements-tab').style.display='none';
  if($id('prod-search'))$id('prod-search').value=name||'';
  renderProducts();
  window.scrollTo({top:0,behavior:'smooth'});
}
