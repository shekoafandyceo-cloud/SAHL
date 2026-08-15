// المخزون — الحالة والتحميل والرسم والمحرّرات والتنبيهات

import { emptyState } from '../core/empty.js';
import { veilDone } from '../core/veil.js';
import { normalizeProductName } from '../analytics/product-match.js';
import { $id, esc } from '../core/dom.js';
import { fmt, fmtMovementDateParts, num, pad2, short } from '../core/format.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { tourDemoMovements, tourDemoStock } from '../tour/demo-data.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { showPage } from '../main.js';
import { currentRole, currentTenantId } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { loadBostaInventoryCard } from '../orders/cards.js';
import { movementWholesalePrice, renderProductPerformance } from '../orders/costs.js';
import { ensureTenant, isAdmin, requireAdmin } from '../orders/guards.js';

export function stockSetProducts(v){ stockProducts = v || []; }

export function stockSetMovements(v){ stockMovements = v || []; }

export var stockProducts=[], stockMovements=[], currentStockTab='products';  // المخزون — الجولة بتبدّله بديمو
export var stockMovementsCapped=false;   // القايمة عند سقف الـ500 — فيه أقدم مش محمّل

// ── خصائص المنتجات (ألوان/مقاسات) ────────────────────────────────
// الخاصية = صف بنت في stock_products (parent_id + variant_label)،
// والاسم بيتولّد على السيرفر «أم — لابل». كمية الأم نفسها = «غير موزع».
export function childrenOf(pid){
  return (stockProducts||[]).filter(function(p){return p.parent_id===pid;});
}
export function hasVariants(pid){
  for(var i=0;i<(stockProducts||[]).length;i++){if(stockProducts[i].parent_id===pid)return true;}
  return false;
}
var expandedFamilies={};   // عيلة مفتوحة في الجدول — حالة جلسة بس

// جيل التحميل — فتحتين متتاليتين بسرعة: رد أقدم كان بيستبدل المصفوفات
// بعد الأحدث ويمسح اللي الـRealtime ضافه في النص
var stockLoadGen=0;
export function loadStock(cb){
  // During the guided tour, never hit Supabase — keep the injected demo data
  // so the cards/products/movements actually show something to learn from.
  if(tourActive){
    if(!stockProducts || !stockProducts.length) stockProducts = tourDemoStock();
    if(!stockMovements || !stockMovements.length) stockMovements = tourDemoMovements();
    updateStockStats();
    renderProducts();
    renderMovements();
    if(cb)cb();
    return;
  }
  if(!ensureTenant()){veilDone('stock');return;}
  var myGen=++stockLoadGen;
  $id('prod-tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل المنتجات...</div>';
  $id('mov-tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل الحركات...</div>';

  // v_stock_products بيحجب wholesale_price عن غير الأدمن على مستوى السيرفر —
  // مش محتاجين نفلتر الأعمدة من هنا تاني.
  sb.from('v_stock_products').select('*').eq('tenant_id',currentTenantId).order('current_qty',{ascending:false}).then(function(r){
    if(myGen!==stockLoadGen) return;
    if(r.error){toast('خطأ في المنتجات: '+r.error.message,'er');veilDone('stock');return;}
    stockProducts=r.data||[];
    updateStockStats();
    loadBostaInventoryCard();
    renderProducts();
    veilDone('stock');
    if(stockMovements && stockMovements.length)renderMovements();
    if(cb)cb();
  });
  // فلاج السقف — العدّاد والتنبؤ لازم يصارحوا إن في أقدم من كده
  sb.from('stock_movements').select('*').eq('tenant_id',currentTenantId).order('created_at',{ascending:false}).limit(500).then(function(r){
    if(myGen!==stockLoadGen) return;
    if(r.error){return;}
    stockMovements=r.data||[];
    stockMovementsCapped=(stockMovements.length===500);
    renderMovements();
  });
}

export function updateStockStats(){
  // كارت «المنتجات» بيعدّ العيلات (الأم أو المنتج المستقل) — مش صفوف الخصائص
  var families=stockProducts.filter(function(p){return !p.parent_id;});
  $id('st-products').textContent=num(families.length);
  var totalQty=stockProducts.reduce(function(s,p){return s+(p.current_qty||0);},0);
  $id('st-qty').textContent=num(totalQty);
  var totalVal=stockProducts.reduce(function(s,p){return s+((p.current_qty||0)*(p.wholesale_price||0));},0);
  $id('st-value').textContent=num(totalVal)+' ج';
  // أم ليها خصائص وكمية «غير الموزع» بتاعتها صفر = حالة طبيعية مش نفاد —
  // النفاد بيتعدّ على الخصائص نفسها والمنتجات المستقلة بس
  var empty=stockProducts.filter(function(p){
    if(!p.parent_id && hasVariants(p.id))return false;
    return (p.current_qty||0)<=0;
  }).length;
  $id('st-empty').textContent=num(empty);
}

export function renderProducts(){
  var q=($id('prod-search').value||'').trim().toLowerCase();
  var kidsByParent={};
  stockProducts.forEach(function(p){
    if(p.parent_id){(kidsByParent[p.parent_id]=kidsByParent[p.parent_id]||[]).push(p);}
  });
  var parents=stockProducts.filter(function(p){return !p.parent_id;});
  // البحث بيطابق العيلة كلها: اسم الأم أو أي لابل/اسم بنت
  function famMatch(p){
    if(!q)return true;
    if((p.name||'').toLowerCase().indexOf(q)>=0)return true;
    return (kidsByParent[p.id]||[]).some(function(c){
      return (c.name||'').toLowerCase().indexOf(q)>=0
          || (c.variant_label||'').toLowerCase().indexOf(q)>=0;
    });
  }
  var list=parents.filter(famMatch);
  $id('prod-count').textContent=list.length!==parents.length?num(list.length)+' نتيجة':num(parents.length)+' منتج';

  if(!list.length){
    // بحث مش مطابق ≠ مفيش منتجات — الرسالة القديمة كانت بتقول
    // "لسه مضفتش أي منتجات" والمنتجات موجودة فعلاً
    if(q && stockProducts.length){
      $id('prod-tbody').innerHTML=emptyState({icon:'🔍',
        title:'مفيش منتجات مطابقة للبحث',
        sub:'جرّب كلمة تانية أو امسح البحث.'});
      return;
    }
    $id('prod-tbody').innerHTML=emptyState({icon:'📦',
      title:'لسه مضفتش أي منتجات',
      sub:'سجّل منتجاتك عشان المخزون يتخصم أوتوماتيك مع كل أوردر بيخرج، وتعرف قيمة بضاعتك في أي لحظة.',
      act:'add-product', actLabel:'+ أضف أول منتج', adminOnly:true});return;}

  function famQtyOf(p){
    return (p.current_qty||0)+(kidsByParent[p.id]||[]).reduce(function(s,c){return s+(c.current_qty||0);},0);
  }
  // الترتيب بإجمالي العيلة — الفرز القديم من السيرفر كان على الصف الواحد
  list=list.slice().sort(function(a,b){return famQtyOf(b)-famQtyOf(a);});

  var isAdmin = currentRole === 'admin';
  function qtyCls(n){return n<=0?'zero':n<10?'low':'ok';}
  var h='<table><thead><tr>'
    +'<th>اسم المنتج</th>'
    +'<th>المخزون</th>'
    +(isAdmin?'<th>سعر الجملة</th>':'')
    +'<th>سعر القطعة</th>'
    +(isAdmin?'<th>القيمة الإجمالية</th>':'')
    +(isAdmin?'<th></th>':'')
    +'</tr></thead><tbody>';
  list.forEach(function(p){
    var kids=(kidsByParent[p.id]||[]).slice().sort(function(a,b){return (b.current_qty||0)-(a.current_qty||0);});
    var fam=kids.length>0;
    // مع البحث العيلات المطابقة بتتفتح لوحدها — نتيجة مخفية = بحث بيكدب
    var open=fam&&(!!q||!!expandedFamilies[p.id]);
    var famQty=famQtyOf(p);
    var famVal=(p.current_qty||0)*(p.wholesale_price||0)
      +kids.reduce(function(s,c){return s+((c.current_qty||0)*(c.wholesale_price||0));},0);
    h+='<tr'+(fam?' class="fam-row" data-fam="'+p.id+'"':'')+'>'
      +'<td class="nm">'+(fam?'<span class="fam-tg'+(open?' open':'')+'">▸</span>':'')+esc(p.name)
      +(fam?'<span class="fam-count">'+num(kids.length)+' خصائص</span>':'')
      +'</td>'
      +'<td><span class="qty-cell '+qtyCls(famQty)+'">'+num(famQty)+'</span></td>'
      +(isAdmin?'<td class="price-cell">'+(p.wholesale_price?num(p.wholesale_price)+' ج':'—')+'</td>':'')
      +'<td class="price-cell">'+(p.unit_price?num(p.unit_price)+' ج':'—')+'</td>'
      +(isAdmin?'<td class="price-cell">'+num(famVal)+' ج</td>':'')
      +(isAdmin?'<td><button class="prod-edit-btn" data-id="'+p.id+'">✏️ تعديل</button></td>':'')
      +'</tr>';
    if(fam){
      kids.forEach(function(c){
        var cq=c.current_qty||0;
        h+='<tr class="var-row'+(open?'':' hid')+'" data-parent="'+p.id+'">'
          +'<td class="nm var-nm">↳ '+esc(c.variant_label||'')+'</td>'
          +'<td><span class="qty-cell '+qtyCls(cq)+'">'+num(cq)+'</span></td>'
          +(isAdmin?'<td class="price-cell">'+(c.wholesale_price?num(c.wholesale_price)+' ج':'—')+'</td>':'')
          +'<td class="price-cell">'+(c.unit_price?num(c.unit_price)+' ج':'—')+'</td>'
          +(isAdmin?'<td class="price-cell">'+num(cq*(c.wholesale_price||0))+' ج</td>':'')
          +(isAdmin?'<td><button class="prod-edit-btn" data-id="'+c.id+'">✏️ تعديل</button></td>':'')
          +'</tr>';
      });
      // رصيد الأم نفسها = كمية لسه ماتوزعتش على الخصائص
      if((p.current_qty||0)>0){
        h+='<tr class="var-row'+(open?'':' hid')+'" data-parent="'+p.id+'">'
          +'<td class="nm var-nm pool-nm" title="كمية متسجلة على المنتج نفسه من غير خاصية — وزعها من محرر المنتج">↳ غير موزع</td>'
          +'<td><span class="qty-cell '+qtyCls(p.current_qty||0)+'">'+num(p.current_qty||0)+'</span></td>'
          +(isAdmin?'<td class="price-cell">—</td>':'')
          +'<td class="price-cell">—</td>'
          +(isAdmin?'<td class="price-cell">—</td>':'')
          +(isAdmin?'<td></td>':'')
          +'</tr>';
      }
    }
  });
  h+='</tbody></table>';
  $id('prod-tbody').innerHTML=h;
  $id('prod-tbody').querySelectorAll('.prod-edit-btn').forEach(function(b){
    b.addEventListener('click',function(ev){
      ev.stopPropagation();   // زرار التعديل جوه صف عيلة قابل للضغط
      openProductEditor(b.getAttribute('data-id'));
    });
  });
  $id('prod-tbody').querySelectorAll('.fam-row').forEach(function(r){
    r.addEventListener('click',function(){
      var pid=r.getAttribute('data-fam');
      expandedFamilies[pid]=!expandedFamilies[pid];
      renderProducts();
    });
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
  $id('mov-count').textContent=list.length!==stockMovements.length
    ? num(list.length)+' نتيجة'
    : num(stockMovements.length)+(stockMovementsCapped?'+ حركة (معروض آخر 500)':' حركة');
  if(stockMovementsCapped) $id('mov-count').title='فيه حركات أقدم مش معروضة — البحث والفلترة على آخر 500 بس';

  if(!list.length){$id('mov-tbody').innerHTML=emptyState({icon:'🔄',
      title:'مفيش حركات مخزون لسه',
      sub:'الحركات بتتسجّل لوحدها أول ما الأوردرات تخرج من المخزن أو ترجع له — مش محتاج تعمل حاجة.'});return;}

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
      +(function(){
         var dt=fmtMovementDateParts(m.movement_date,m.created_at);
         return '<td class="mn mv-when"><span class="mv-date">'+esc(dt.date)+'</span>'
              + (dt.time?'<span class="mv-time">'+esc(dt.time)+'</span>':'')
              + '</td>';
       })()
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
  var isChild=!!p.parent_id;
  var parentRow=null;
  if(isChild){for(var j=0;j<stockProducts.length;j++){if(stockProducts[j].id===p.parent_id){parentRow=stockProducts[j];break;}}}
  var kids=(!isNew&&!isChild)?childrenOf(p.id):[];
  // نسخة مجمّدة من قيم لحظة الفتح: صف stockProducts نفسه بيتعدل في مكانه
  // من الـRealtime (Object.assign في startRealtime)، فالمقارنة وقت الحفظ
  // لازم تبقى ضد اللي التاجر شافه فعلاً وقت ما فتح المحرر
  var orig={name:p.name||'', label:p.variant_label||'', qty:p.current_qty||0, wholesale:p.wholesale_price||0, unit:p.unit_price||0};

  $id('dtit').textContent=isNew?'إضافة منتج جديد':(isChild?'تعديل الخاصية':'تعديل المنتج');

  // خانة الاسم: للخاصية بنعرض اسم الأم ثابت + خانة اللابل بس —
  // الاسم الكامل بيتولّد على السيرفر ومايتبعتش أبداً من هنا
  var nameField;
  if(isChild){
    nameField='<label class="slbl" style="text-align:right;display:block">المنتج الأم</label>'
      +'<div class="sinp" style="direction:rtl;text-align:right;background:var(--sur);cursor:default">'+esc(parentRow?parentRow.name:'')+'</div>'
      +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">اسم الخاصية (اللون / المقاس)</label>'
      +'<input class="sinp" id="pe-label" type="text" value="'+esc(p.variant_label||'')+'" style="direction:rtl;text-align:right">';
  } else {
    nameField='<label class="slbl" style="text-align:right;display:block">اسم المنتج</label>'
      +'<input class="sinp" id="pe-name" type="text" value="'+esc(p.name||'')+'" style="direction:rtl;text-align:right">';
  }

  // قسم الخصائص — للمنتج المحفوظ اللي مش خاصية بنفسه
  var varSection='';
  if(!isNew&&!isChild){
    var poolQty=p.current_qty||0;
    varSection='<div class="dsec" id="pe-vars">'
      +'<label class="slbl" style="text-align:right;display:block">الخصائص (ألوان / مقاسات)'
      +(kids.length?' <span class="fam-count">غير الموزع: '+num(poolQty)+'</span>':'')
      +'</label>';
    if(!kids.length){
      varSection+='<div class="pe-var-hint">لو المنتج ده ليه ألوان أو مقاسات، ضيفها هنا — '
        +'كل خاصية هيبقى ليها عدّاد مخزون لوحدها، والخصم الأوتوماتيكي هيروح للون اللي في الأوردر.</div>';
    }
    kids.slice().sort(function(a,b){return (b.current_qty||0)-(a.current_qty||0);}).forEach(function(c){
      varSection+='<div class="pe-var-row" data-vid="'+c.id+'">'
        +'<span class="pe-var-name">'+esc(c.variant_label||'')+'</span>'
        +'<span class="pe-var-qty">'+num(c.current_qty||0)+'</span>'
        +'<button class="pe-var-btn pe-var-give" data-vid="'+c.id+'" title="نقل كمية من غير الموزع للخاصية دي">⬅ توزيع</button>'
        +((c.current_qty||0)>0?'<button class="pe-var-btn pe-var-take" data-vid="'+c.id+'" title="رجّع كمية من الخاصية دي لغير الموزع">↩ استرجاع</button>':'')
        +'</div>';
    });
    varSection+='<div class="pe-var-add-row">'
      +'<input class="sinp" id="pe-var-new" type="text" placeholder="مثلاً: أحمر · مقاس 85" style="direction:rtl;text-align:right;flex:1">'
      +'<button class="pe-var-btn ok" id="pe-var-add">+ إضافة خاصية</button>'
      +'</div>'
      +'</div>';
  }

  $id('dcnt').innerHTML='<div class="dsec">'
    +nameField
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">'
    +(isNew?'الكمية الافتتاحية':(kids.length?'المخزون الحالي (غير الموزع)':'المخزون الحالي'))+'</label>'
    +'<input class="sinp" id="pe-qty" type="number" min="0" value="'+(p.current_qty||0)+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">سعر الجملة (للقطعة الواحدة)</label>'
    +'<input class="sinp" id="pe-wholesale" type="number" min="0" step="0.01" value="'+(p.wholesale_price||0)+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">سعر البيع للقطعة</label>'
    +'<input class="sinp" id="pe-unit" type="number" min="0" step="0.01" value="'+(p.unit_price||0)+'">'
    +'</div>'
    +varSection
    +'<div class="dacts">'
    +(isNew?'':'<button class="abtn cn" id="pe-del">🗑️ حذف</button>')
    +'<button class="abtn ok" id="pe-save">💾 حفظ</button>'
    +'</div>';

  // بعد أي عملية على الخصائص: تحميل من السيرفر (الاسم بيتولّد هناك) وإعادة فتح المحرر
  function reloadAndReopen(){ loadStock(function(){ openProductEditor(p.id); }); }

  // توزيع/استرجاع inline: الضغطة بتحوّل الزرار لخانة كمية + تأكيد
  function wireTransferBtn(btn, fromId, toId){
    btn.addEventListener('click',function(){
      if(btn.getAttribute('data-armed')){return;}
      btn.setAttribute('data-armed','1');
      var row=btn.parentElement;
      var inp=document.createElement('input');
      inp.type='number';inp.min='1';inp.value='1';inp.className='sinp pe-var-qty-inp';
      var go=document.createElement('button');
      go.className='pe-var-btn ok';go.textContent='تم';
      row.insertBefore(go,btn);row.insertBefore(inp,go);
      inp.focus();inp.select();
      go.addEventListener('click',function(){
        var n=parseInt(inp.value)||0;
        if(n<=0){toast('اكتب كمية أكبر من صفر','er');return;}
        go.disabled=true;
        sb.rpc('transfer_stock',{p_from:fromId,p_to:toId,p_qty:n}).then(function(r){
          go.disabled=false;
          if(r.error){toast('خطأ: '+r.error.message,'er');return;}
          toast('تم النقل ✓','ok');
          reloadAndReopen();
        });
      });
    });
  }

  if(!isNew&&!isChild){
    $id('dcnt').querySelectorAll('.pe-var-give').forEach(function(b){
      wireTransferBtn(b, p.id, b.getAttribute('data-vid'));
    });
    $id('dcnt').querySelectorAll('.pe-var-take').forEach(function(b){
      wireTransferBtn(b, b.getAttribute('data-vid'), p.id);
    });
    $id('pe-var-add').addEventListener('click',function(){
      var btn=this;
      if(btn.disabled)return;
      var lbl=$id('pe-var-new').value.trim();
      if(!lbl){toast('اكتب اسم الخاصية الأول (مثلاً: أحمر)','er');return;}
      btn.disabled=true;
      // الاسم مايتبعتش — السيرفر بيولّده «أم — لابل» ويمنع التكرار
      sb.from('stock_products').insert({tenant_id:currentTenantId,parent_id:p.id,variant_label:lbl,
        current_qty:0,wholesale_price:p.wholesale_price||0,unit_price:p.unit_price||0}).then(function(r){
        btn.disabled=false;
        if(r.error){
          toast(r.error.code==='23505'?'الخاصية دي متسجلة بالفعل':'خطأ: '+r.error.message,'er');
          return;
        }
        toast('اتضافت ✓ — وزّعلها كمية من غير الموزع','ok');
        reloadAndReopen();
      });
    });
  }

  $id('pe-save').addEventListener('click',function(){
    var btn=this;
    if(btn.disabled)return;   // دبل-تاب على شبكة بطيئة = منتجين مكررين
    var name=isChild?orig.name:$id('pe-name').value.trim();
    var label=isChild?$id('pe-label').value.trim():'';
    var qty=parseInt($id('pe-qty').value)||0;
    var wholesale=parseFloat($id('pe-wholesale').value)||0;
    var unit=parseFloat($id('pe-unit').value)||0;
    if(isChild){ if(!label){toast('اسم الخاصية مطلوب','er');return;} }
    else if(!name){toast('اسم المنتج مطلوب','er');return;}
    // مفيش قيود على الجدول في الداتابيز — السالب كان بيتقبل ويعدّي
    if(qty<0||wholesale<0||unit<0){toast('مفيش قيم سالبة في المخزون أو الأسعار','er');return;}
    var data, op;
    if(isNew){
      data={tenant_id:currentTenantId, name:name, current_qty:qty, wholesale_price:wholesale, unit_price:unit};
      op=sb.from('stock_products').insert(data);
    } else {
      // بنبعت بس الحقول اللي التاجر غيّرها فعلاً عن لحظة الفتح — إرسال
      // current_qty دايماً كان بيرجّع كمية خصمها السكانر والمحرر مفتوح
      // (حفظ تعديل سعر = الكمية القديمة ترجع تتكتب فوق الخصم)
      data={};
      if(isChild){ if(label!==orig.label) data.variant_label=label; }
      else if(name!==orig.name) data.name=name;
      if(qty!==orig.qty) data.current_qty=qty;
      if(wholesale!==orig.wholesale) data.wholesale_price=wholesale;
      if(unit!==orig.unit) data.unit_price=unit;
      if(!Object.keys(data).length){ $id('ovl').classList.remove('open'); return; }
      op=sb.from('stock_products').update(data).eq('id',p.id).eq('tenant_id',currentTenantId);
    }
    btn.disabled=true;
    op.then(function(r){
      btn.disabled=false;
      if(r.error){
        toast(r.error.code==='23505'?'فيه منتج/خاصية بنفس الاسم بالفعل':'خطأ: '+r.error.message,'er');
        return;
      }
      toast(isNew?'تم إضافة المنتج ✓':'تم التحديث ✓','ok');
      $id('ovl').classList.remove('open');
      loadStock();
    });
  });

  if(!isNew){
    $id('pe-del').addEventListener('click',function(){
      // حراسات قبل الحذف — الداتابيز بتمنع برضه (FK RESTRICT) بس الرسالة هنا أوضح
      if(!isChild&&kids.length){
        toast('المنتج ليه خصائص — امسح الخصائص الأول أو رجّع كمياتها','er');return;
      }
      if(isChild&&(p.current_qty||0)>0){
        toast('الخاصية فيها كمية — رجّعها لغير الموزع الأول (زرار ↩ استرجاع عند الأم)','er');return;
      }
      if(!confirm((isChild?'حذف الخاصية "':'حذف المنتج "')+p.name+'"؟ هتُحذف كل بياناته.'))return;
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
  // العيلة بتتعرض مع بعض: الأم (لو ليها خصائص بتتسمى «غير موزع») وبعدها بناتها —
  // الحركة اليدوية بتختار الخاصية مباشرة فمفيش توجيه ولا لبس
  var prodOptions='';
  stockProducts.filter(function(p){return !p.parent_id;}).forEach(function(p){
    var kids=childrenOf(p.id);
    var label=kids.length?p.name+' (غير موزع)':p.name;
    prodOptions+='<option value="'+p.id+'" data-name="'+esc(p.name)+'">'+esc(label)+' (متاح: '+(p.current_qty||0)+')</option>';
    kids.forEach(function(c){
      prodOptions+='<option value="'+c.id+'" data-name="'+esc(c.name)+'">↳ '+esc(c.name)+' (متاح: '+(c.current_qty||0)+')</option>';
    });
  });
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
    var btn=this;
    if(btn.disabled)return;   // دبل-تاب = حركتين خروج = خصم المخزون مرتين
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
    btn.disabled=true;
    sb.from('stock_movements').insert(data).then(function(r){
      btn.disabled=false;
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
  // أم ليها خصائص بتتستبعد: كميتها «غير موزع» مش مخزون بيع، وصفرها حالة
  // طبيعية بعد التوزيع الكامل — من غير الاستبعاد كل عيلة موزعة بالكامل
  // كانت هتطلع «نفد من المخزون» بالغلط. الإشارة الحقيقية على البنات نفسها.
  var rows=(stockProducts||[]).filter(function(p){
    return !(!p.parent_id && hasVariants(p.id));
  }).map(function(p){
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
  }).join('')
  + (stockMovementsCapped?'<div class="cap-note">⚠ التنبؤ مبني على آخر 500 حركة بس — الأقدم مش محمّل فالتقدير ممكن يكون متفائل</div>':'');
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
