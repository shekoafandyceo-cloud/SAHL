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
  var v = val != null ? esc(String(val)) : '';
  return '<input type="text" inputmode="decimal" class="prod-price" data-idx="'+idx+'"'
    +' placeholder="السعر" title="سعر البيع للقطعة في الأوردر ده بس — سعر المخزون والتكلفة ثابتين"'
    +' data-init="'+v+'" value="'+v+'">';
}

export function renderProductsEditor(str, priceOverrides){
  var products=parseProducts(str);
  var list=$id('prod-list');
  if(!list)return;
  // أسعار السطور المحفوظة مع الأوردر — [{n,q,p}] بييجي من عمود line_prices
  var lp = (sel && Array.isArray(sel.line_prices)) ? sel.line_prices : [];
  var lpUsed = {};
  function savedPriceOf(name, qty){
    for(var i=0;i<lp.length;i++){
      var e = lp[i];
      if(!lpUsed[i] && e && e.n === name && Number(e.q) === qty && e.p != null && isFinite(Number(e.p))){
        lpUsed[i] = true; return Number(e.p);
      }
    }
    return null;
  }
  var h='';
  products.forEach(function(p,i){
    var nm=p.replace(/\s*\(عدد\s*\d+\)\s*$/, '').trim();
    var qty=p.match(/\(عدد\s*(\d+)\)/)?parseInt(p.match(/\(عدد\s*(\d+)\)/)[1]):1;
    // أولوية السعر: تجاوز مؤقت (حذف صف) ← المحفوظ ← إجمالي/كمية (سطر
    // واحد — بيرجّع سعر العرض حتى للأوردرات القديمة) ← سعر السيستم
    var pv = (priceOverrides && priceOverrides[i] != null) ? priceOverrides[i] : savedPriceOf(nm, qty);
    if(pv == null && products.length === 1 && sel && Number(sel.total_cost) > 0 && qty > 0){
      pv = Math.round((Number(sel.total_cost) / qty) * 100) / 100;
    }
    if(pv == null) pv = stockPriceOf(nm);
    h+='<div class="prod-item" data-idx="'+i+'">'
      +'<select class="prod-select prod-input" data-idx="'+i+'" style="flex:2;min-width:140px;">'+buildProductOptions(nm)+'</select>'
      +priceInputHtml(i, pv)
      +'<input type="text" class="prod-qty" data-idx="'+i+'" placeholder="الكمية" style="flex:0 0 70px;min-width:60px;" value="'+qty+'">'
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
      var prices=[];
      list.querySelectorAll('.prod-item .prod-price').forEach(function(inp){
        var v=parseFloat(String(inp.value).replace(/[^\d.]/g,''));
        prices.push(isFinite(v)&&v>=0?v:null);
      });
      var di=parseInt(b.getAttribute('data-idx'));
      prods.splice(di,1); prices.splice(di,1);
      if(!prods.length){prods=[''];prices=[null];}
      renderProductsEditor(prods.join('\n+ '), prices);
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

  // ─── الحساب المطلق: الرقم اللي في الخانات هو اللي بيتحفظ ───
  // (النسخة الأولى كانت بتحسب «فرق» ضد سعر السيستم — فالمكتوب كان بيضيع
  // بعد القفل والفتح والنتايج بقت غير متوقعة. المالك: «عاوز الرقم اللي
  // أكتبه وأدوس حفظ يتعمله حفظ» — 8 أغسطس.)
  var rows = $id('prod-list') ? $id('prod-list').querySelectorAll('.prod-item') : [];
  var lines = [], allKnown = true, newTotal = 0, touched = false;
  rows.forEach(function(row){
    var slEl = row.querySelector('.prod-select');
    var qEl  = row.querySelector('.prod-qty');
    var pEl  = row.querySelector('.prod-price');
    var name = (slEl ? slEl.value : '').trim();
    if(!name) return;
    var qty = qEl ? parseInt(qEl.value) : 1;
    if(!isFinite(qty) || qty < 1) qty = 1;
    var raw = pEl ? String(pEl.value).trim() : '';
    var price = parseFloat(raw.replace(/[^\d.]/g,''));
    var known = raw !== '' && isFinite(price) && price >= 0;
    if(!known){ allKnown = false; price = null; }
    else { newTotal += price * qty; }
    if(pEl && String(pEl.getAttribute('data-init') || '') !== raw) touched = true;
    lines.push({ n: name, q: qty, p: known ? price : null });
  });
  newTotal = Math.round(newTotal * 100) / 100;
  var productsChanged = combined !== (ord.product_name || '');
  // مفيش أي تغيير (نفس المنتجات ونفس الأسعار اللي اتفتحت بيها) = مانبعتش
  // إجمالي خالص — مانلمسش أوردر ماحدش عدّله
  var noChange = !productsChanged && !touched;
  var sendTotal = (!noChange && allKnown) ? newTotal : null;

  sb.rpc('save_order_products',{
    p_order_id: ord.id,
    p_product_name: combined,
    p_total_cost: sendTotal,
    p_prices: noChange ? null : lines
  }).then(function(r){
    if(r.error){$id('prod-status').textContent='خطأ: '+r.error.message;$id('prod-status').className='save-status';return;}
    var out = r.data || {};
    var srvOrder = out.order || null;
    // نمشي على أرقام السيرفر مش نسختنا — لو حد تاني غيّر السعر في نفس اللحظة
    var savedTotal = srvOrder && srvOrder.total_cost != null ? Number(srvOrder.total_cost) : newTotal;
    ord.product_name=combined;
    if(sendTotal != null) ord.total_cost=savedTotal;
    if(!noChange) ord.line_prices = lines;
    for(var i=0;i<all.length;i++){
      if(all[i].id===ord.id){
        all[i].product_name=combined;
        if(sendTotal != null) all[i].total_cost=savedTotal;
        break;
      }
    }
    // الحفظة الجاية تقارن بالمحفوظ الجديد — مش باللي كان وقت الفتح
    if($id('prod-list')) $id('prod-list').querySelectorAll('.prod-price').forEach(function(inp){
      inp.setAttribute('data-init', String(inp.value).trim());
    });
    var msg = '✓ تم الحفظ';
    if(sendTotal != null) msg += ' — الإجمالي: ' + num(savedTotal) + ' ج';
    else if(!noChange && !allKnown) msg = '✓ المنتجات اتحفظت — بس الإجمالي ماتغيرش: فيه منتج من غير سعر';
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
