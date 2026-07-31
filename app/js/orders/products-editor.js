// محرّر منتجات الأوردر جوّه نافذة التفاصيل

import { currentTenantId } from '../auth/auth.js';
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
  if(!products.length){toast('مينفعش تحفظ منتجات فاضية','er');return;}
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
