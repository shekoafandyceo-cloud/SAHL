// محرّر منتجات الأوردر جوّه نافذة التفاصيل

import { $id, esc } from '../core/dom.js';
import { num } from '../core/format.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { stockProducts } from '../stock/stock.js';
import { loadBostaInventoryCard, loadOrdersCards } from './cards.js';
import { ensureTenant } from './guards.js';
import { doFilter } from './orders.js';
import { all, sel } from './state.js';

export function parseProducts(str){
  if(!str)return [''];
  var parts=String(str).split(/\s*[\n]\s*\+\s*|\s*\n\s*/).filter(function(p){return p.trim().length>0;});
  return parts.length?parts:[''];
}

export function buildProductOptions(selected){
  // Build <option> list from stockProducts (already loaded when stock page loads)
  // If stock not loaded yet, just return one empty option
  // القيمة الفاضية = صف من غير منتج. التسمية القديمة «اكتب يدوياً» كانت
  // وعد كاذب: مفيش حقل نصي، وcollectProducts بتتجاهل الصف — والاختيار ده
  // مع الحفظ كان بيشيل المنتج من الأوردر في صمت (قرار المالك: مفيش حقل يدوي)
  var opts='<option value="">— اختار منتج من القايمة —</option>';
  if(stockProducts && stockProducts.length){
    stockProducts.forEach(function(p){
      var sel2=(selected && p.name===selected)?'selected':'';
      opts+='<option value="'+esc(p.name)+'" '+sel2+'>'+esc(p.name)+(p.current_qty!==undefined?' ('+num(p.current_qty)+' متاح)':'')+'</option>';
    });
  }
  return opts;
}

// سعر السيستم لمنتج بالاسم — null لو مش في المخزون
function stockPriceOf(name){
  var it = (stockProducts||[]).find(function(s){ return s.name === name; });
  return it && it.unit_price != null ? Number(it.unit_price) : null;
}

// خانة السعر: بتتملى تلقائي بسعر السيستم وبتتعدل بحرية —
// التعديل بيأثر على إجمالي **الأوردر ده بس** (عرض/خصم على قطعة)،
// سعر المنتج في المخزون وسعر التكلفة مايتلمسوش (طلب المالك 8 أغسطس)
function priceInputHtml(idx, val){
  return '<input type="text" inputmode="decimal" class="prod-price" data-idx="'+idx+'"'
    +' placeholder="السعر" title="سعر البيع للقطعة في الأوردر ده بس — سعر المخزون والتكلفة ثابتين"'
    +' style="flex:0 0 88px;min-width:70px;direction:ltr;text-align:center;"'
    +' value="'+(val!=null?esc(String(val)):'')+'">';
}

export function renderProductsEditor(str){
  var products=parseProducts(str);
  var list=$id('prod-list');
  if(!list)return;
  var h='';
  products.forEach(function(p,i){
    // Each product row: stock dropdown + quantity input + manual text override + delete button
    var nm=p.replace(/\s*\(عدد\s*\d+\)\s*$/, '').trim();
    h+='<div class="prod-item" data-idx="'+i+'">'
      +'<select class="prod-select prod-input" data-idx="'+i+'" style="flex:2;min-width:140px;">'+buildProductOptions(nm)+'</select>'
      +priceInputHtml(i, stockPriceOf(nm))
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
  wirePriceRefill(list);
  list.querySelectorAll('.prod-del').forEach(function(b){
    b.addEventListener('click',function(){
      var prods=collectProducts();
      prods.splice(parseInt(b.getAttribute('data-idx')),1);
      if(!prods.length)prods=[''];
      renderProductsEditor(prods.join('\n+ '));
    });
  });
}

// اختيار منتج من القايمة بيرجّع السعر لسعر السيستم — نقطة بداية للتعديل
function wirePriceRefill(scope){
  scope.querySelectorAll('.prod-select').forEach(function(sl){
    if(sl.__priceWired) return;
    sl.__priceWired = true;
    sl.addEventListener('change', function(){
      var priceInp = sl.parentNode.querySelector('.prod-price');
      if(!priceInp) return;
      var sp = stockPriceOf(sl.value.trim());
      priceInp.value = sp != null ? String(sp) : '';
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
    // كمية سالبة أو صفر أو كلام = 1 — parseInt لوحدها كانت بتقبل السالب
    var qty=qtyInp?parseInt(qtyInp.value):1;
    if(!isFinite(qty)||qty<1)qty=1;
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
    +priceInputHtml(idx, null)
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
  wirePriceRefill(div);
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
  var ord=sel;   // التقاط الأوردر — sel الحي ممكن يتبدل قبل رد السيرفر
  var products=collectProducts();
  if(!products.length){toast('مينفعش تحفظ منتجات فاضية','er');return;}
  // صف على الخيار الفاضي كان بيتشال من الأوردر في صمت وقت الحفظ —
  // نمنع الحفظ بدل ما نمسح منتج التاجر من وراه
  var rowsN=$id('prod-list')?$id('prod-list').querySelectorAll('.prod-item').length:0;
  if(rowsN && products.length<rowsN){toast('فيه صف من غير منتج مختار — اختار من القايمة أو امسح الصف','er');return;}
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

  // الجانب الجديد بيتحسب من **الأسعار المكتوبة في الخانات** مش من سعر
  // السيستم — الخانة بتتملى بسعر السيستم تلقائياً، فلو التاجر ماغيّرهاش
  // الناتج مطابق للقديم والفرق صفر. ولو كتب سعر عرض، الفرق بيتحسب بسعره
  // هو — للأوردر ده بس. سعر فاضي/مش رقم = مجهول (مانلمسش الإجمالي).
  function buildEnteredMap(){
    var map = {};
    var rows = $id('prod-list') ? $id('prod-list').querySelectorAll('.prod-item') : [];
    rows.forEach(function(row){
      var sl = row.querySelector('.prod-select');
      var qInp = row.querySelector('.prod-qty');
      var pInp = row.querySelector('.prod-price');
      var name = (sl ? sl.value : '').trim();
      if(!name) return;
      var qty = qInp ? parseInt(qInp.value) : 1;
      if(!isFinite(qty) || qty < 1) qty = 1;
      var key = name + '|' + qty;
      var price = pInp ? parseFloat(String(pInp.value).replace(/[^\d.]/g,'')) : NaN;
      if(!isFinite(price) || price < 0){
        map[key] = null;                       // سعر مجهول — زي القديم بالظبط
      }else{
        map[key] = (map[key] || 0) + price * qty;
      }
    });
    return map;
  }

  // Parse old product list (the one saved in the order before this edit)
  var oldProducts = parseProducts(ord.product_name || '');
  var oldMap = buildPriceMap(oldProducts);
  var newMap = buildEnteredMap();

  // Calculate delta: sum of (new - old) for items where we have prices.
  // بيتحسب على union المفاتيح بفرق القيمة المتراكمة — المنتج المكرر بنفس
  // الكمية بيتجمع في مفتاح واحد، والمقارنة القديمة (موجود/مش موجود بس)
  // كانت بتفوّت حذف نسخة من نسختين والإجمالي يفضل أعلى من الصح
  var delta = 0;
  var hasKnownChange = false;
  var keys = {};
  Object.keys(newMap).forEach(function(k){ keys[k]=1; });
  Object.keys(oldMap).forEach(function(k){ keys[k]=1; });
  Object.keys(keys).forEach(function(key){
    var nv = newMap[key], ov = oldMap[key];
    if(nv === null || ov === null) return;   // سعر مجهول — مانلمسش الإجمالي
    var d = (nv === undefined ? 0 : nv) - (ov === undefined ? 0 : ov);
    if(d !== 0){ delta += d; hasKnownChange = true; }
  });

  var currentTotal = parseFloat(ord.total_cost) || 0;
  var newTotal = currentTotal + delta;
  if(newTotal < 0) newTotal = 0;

  // الحفظ بقى RPC ذرية بدل update مباشر — سببين:
  //  1) عمولة الـupselling لازم تتحسب على السيرفر من إجمالي **صف السيرفر**
  //     قبل التعديل. لو الفرونت بعت الرقم القديم، أي موظف يقدر يبعت صفر
  //     ويطلّع لنفسه عمولة على الأوردر كله.
  //  2) تحديث المنتجات + تسجيل الحدث في عملية واحدة — مفيش نص طريق.
  // `p_total_cost` بـnull معناها «ماتلمسش الإجمالي» (سعر غير معروف).
  sb.rpc('save_order_products',{
    p_order_id: ord.id,
    p_product_name: combined,
    p_total_cost: hasKnownChange ? newTotal : null
  }).then(function(r){
    if(r.error){$id('prod-status').textContent='خطأ: '+r.error.message;$id('prod-status').className='save-status';return;}
    var out = r.data || {};
    var srvOrder = out.order || null;
    // نمشي على أرقام السيرفر مش نسختنا — لو حد تاني غيّر السعر في نفس اللحظة
    var savedTotal = srvOrder && srvOrder.total_cost != null ? Number(srvOrder.total_cost) : newTotal;
    ord.product_name=combined;
    if(hasKnownChange) ord.total_cost=savedTotal;
    for(var i=0;i<all.length;i++){
      if(all[i].id===ord.id){
        all[i].product_name=combined;
        if(hasKnownChange) all[i].total_cost=savedTotal;
        break;
      }
    }
    var msg = '✓ تم الحفظ';
    if(hasKnownChange){
      var sign = delta >= 0 ? '+' : '';
      msg += ' — السعر: ' + num(savedTotal) + ' ج (' + sign + num(delta) + ' ج)';
    }
    $id('prod-status').textContent = msg;
    $id('prod-status').className='save-status ok';
    setTimeout(function(){if($id('prod-status'))$id('prod-status').textContent='';},3500);
    // العمولة بترجع من السيرفر لو اتسجّلت — الموظف يشوف إنه كسب حاجة
    if(out.upsell && out.upsell.commission_amount != null){
      toast('عمولة upselling ' + num(out.upsell.commission_amount) + ' ج اتسجّلت — بتستحق لما الأوردر يتسلّم', 'ok');
    }
    loadOrdersCards();
    loadBostaInventoryCard();
    doFilter();
  });
}
