// «📥 سجّل المنتج اللي رجع» — بوليصة J&T مش متسجلة في سهل (15 أكتوبر مساءً — طلب المالك · v78)
//
// «لو بوليصة بتبدأ ب JEG بس مش متسجلة في سهل … الاوردر دا هيكون اوردر استبدال معمول من داشبورد J&T نفسها فاحنا نفهم ان
// دي البوليصة بتاعت المنتج الي رجعلنا و المنتج يتسجل في المخزن يدوي من الموظف».
//
// السكانر قال «مش عندنا» (سرينة) → الموظف بيختار المنتج اللي في الطرد والعدد → `wh_unknown_in` (أي موظف — حركات المخزون
// للأدمن بس غير كده) بيضيفه للمخزن ويسجّله على البوليصة: الضربة الجاية لنفس البوليصة = «اتسجّلت قبل كده» (هبعتهولك برضو)
// ومش هتتضاف تاني. التراجع: صاحبه خلال 15 دقيقة أو الأدمن (wh_unknown_undo).
// 🔴 مفيش خانة كتابة في النافذة (زراير بس): السكانر لو ضرب وهي مفتوحة الحروف بتروح للسكان مش لخانة هنا.
// 🔴 client_id ثابت للنافذة دي — ضغطتين أو رد ضاع = نفس النتيجة من السيرفر (مش تسجيلين).

import { $id, esc } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { currentTenantId } from '../auth/auth.js';

var st = null;        // {code, cid, items: [{pid, name, qty}], busy, onRes}
var prods = null, prodsAt = 0, prodsErr = false;
var MAX_ITEMS = 5, MAX_QTY = 5;

function uuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){ /* قديم */ }
  return 'x'.repeat(8).replace(/x/g, function(){ return Math.floor(Math.random() * 16).toString(16); }) + '-4000-8000-0000-' + String(Date.now()).slice(-12).padStart(12, '0');
}

// Escape بيقفل النافذة حتى لو الفوكس برّاها (فتحها من «محتاجة انتباهك» بيسيب الفوكس على الزرار اللي تحت)
var escWired = false;
function wireEsc(){
  if(escWired) return;
  escWired = true;
  document.addEventListener('keydown', function(e){ if(st && e.key === 'Escape' && !st.busy) close(); });
}

export function whUnknownOpen(code, onRes){
  if(!code) return;
  wireEsc();
  if(st && st.code === code){ render(); return; }
  st = { code: code, cid: uuid(), items: [], busy: false, onRes: onRes };
  render();
  loadProducts();
}
export function whUnknownIsOpen(){ return !!st; }
// اتضرب طرد تاني والنافذة مفتوحة = بتتقفل (كانت هتغطي كارت النتيجة الجديدة والموظف مش شايفه) — إلا لو بتسجّل دلوقتي
export function whUnknownCloseIfOther(code){
  if(!st || st.busy || !code || code === st.code) return false;
  close();
  return true;
}

function close(){
  st = null;
  var el = $id('wh-unk'); if(el) el.remove();
}

function loadProducts(){
  if(!sb || !currentTenantId) return;
  if(prods && Date.now() - prodsAt < 5 * 60000){ render(); return; }
  prodsErr = false;
  Promise.resolve(sb.from('v_stock_products').select('id,name,parent_id,variant_label,active').eq('tenant_id', currentTenantId)
    .order('name', { ascending: true })).then(function(r){
    if(r.error){ prodsErr = true; render(); return; }
    prods = (r.data || []).filter(function(p){ return p.active !== false; });
    prodsAt = Date.now();
    render();
  }, function(e){ prodsErr = true; swallow('wh-unknown/products', e); render(); });
}

// المنتجات بالعيلة: الأم اللي ليها ألوان = «(غير موزع)» وتحتها كل لون
function prodButtons(){
  if(prodsErr) return '<div class="wh-empty">مقدرناش نجيب المنتجات. <button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whu="reload">↻</button></div>';
  if(!prods) return '<div class="wh-empty">بنحمّل المنتجات…</div>';
  var kids = {}, top = [];
  prods.forEach(function(p){ if(p.parent_id) (kids[p.parent_id] = kids[p.parent_id] || []).push(p); else top.push(p); });
  var chosen = {};
  st.items.forEach(function(it){ chosen[it.pid] = 1; });
  var btn = function(p, label){
    return '<button type="button" class="wh-unk-p' + (chosen[p.id] ? ' on' : '') + '" data-whu="pick" data-pid="' + esc(p.id) + '">' + esc(label) + '</button>';
  };
  var h = '';
  top.forEach(function(p){
    var k = kids[p.id] || [];
    if(!k.length){ h += btn(p, p.name || ''); return; }
    h += '<div class="wh-unk-fam"><div class="wh-unk-fam-h">' + esc(p.name || '') + '</div>';
    k.forEach(function(c){ h += btn(c, c.variant_label || c.name || ''); });
    h += btn(p, '(اللون مش معروف — غير موزع)') + '</div>';
  });
  // بنت أمها مش نشطة — تبان برضه
  prods.forEach(function(p){
    if(p.parent_id && !top.some(function(x){ return x.id === p.parent_id; })) h += btn(p, p.name || '');
  });
  return h || '<div class="wh-empty">مفيش منتجات في المخزون.</div>';
}

function render(){
  if(!st) return;
  var el = $id('wh-unk');
  if(!el){
    el = document.createElement('div');
    el.id = 'wh-unk';
    el.className = 'wh-unk-bd';
    el.addEventListener('click', onClick);
    var page = $id('page-warehouse') || document.body;
    page.appendChild(el);
  }
  var n = st.items.length;
  var h = '<div class="wh-unk-box" role="dialog" aria-label="سجّل المنتج اللي رجع">'
    + '<div class="wh-unk-h"><b>📥 سجّل المنتج اللي رجع</b><button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whu="close" aria-label="اقفل">✖</button></div>'
    + '<div class="wh-unk-code">بوليصة J&amp;T مش متسجلة في سهل: <span class="wh-ltr" dir="ltr">' + esc(st.code) + '</span></div>'
    + '<div class="wh-hint">غالباً استبدال اتعمل من داشبورد J&amp;T — ده المنتج اللي رجعلنا. اختار المنتج اللي في الطرد (واللون) والعدد، وهيتضاف للمخزن. '
    + '<b>لو ده طرد خارج</b> اتعمل من بوابة J&amp;T: متسجّلوش — قول للأدمن.</div>'
    + '<div class="wh-unk-sel">';
  if(!n) h += '<div class="wh-empty">اختار المنتج من تحت ⬇️</div>';
  st.items.forEach(function(it, i){
    h += '<div class="wh-unk-it"><span class="wh-unk-it-n">' + esc(it.name) + '</span>'
      + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whu="dec" data-i="' + i + '"' + (it.qty <= 1 ? ' disabled' : '') + '>−</button>'
      + '<b class="wh-unk-q" dir="ltr">' + it.qty + '</b>'
      + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whu="inc" data-i="' + i + '"' + (it.qty >= MAX_QTY ? ' disabled' : '') + '>+</button>'
      + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whu="rm" data-i="' + i + '" aria-label="شيل">🗑</button></div>';
  });
  h += '</div><div class="wh-unk-acts">'
    + '<button type="button" class="wh-btn wh-btn-in" data-whu="save"' + (n ? '' : ' disabled') + '>' + (st.busy ? '⏳ بيتسجّل…' : '✅ سجّله رجع للمخزن') + '</button>'
    + '<button type="button" class="wh-btn wh-btn-ghost" data-whu="close">إلغاء</button></div>'
    + '<div class="wh-unk-list">' + prodButtons() + '</div></div>';
  el.innerHTML = h;
}

function onClick(e){
  if(e.target === e.currentTarget){ close(); return; }   // الضغط برّه الصندوق
  var t = e.target.closest ? e.target.closest('[data-whu]') : null;
  if(!t || !st) return;
  var a = t.getAttribute('data-whu'), i = Number(t.getAttribute('data-i'));
  if(a === 'close'){ close(); return; }
  if(a === 'reload'){ prods = null; loadProducts(); return; }
  if(st.busy) return;
  if(a === 'pick'){
    var pid = t.getAttribute('data-pid');
    var ex = st.items.filter(function(x){ return x.pid === pid; })[0];
    if(ex){ if(ex.qty < MAX_QTY) ex.qty++; }
    else {
      if(st.items.length >= MAX_ITEMS){ toast('لحد ' + MAX_ITEMS + ' منتجات في الطرد الواحد', 'er'); return; }
      var p = (prods || []).filter(function(x){ return x.id === pid; })[0];
      if(!p) return;
      st.items.push({ pid: pid, name: p.name || '', qty: 1 });
    }
  }
  else if(a === 'inc' && st.items[i]){ if(st.items[i].qty < MAX_QTY) st.items[i].qty++; }
  else if(a === 'dec' && st.items[i]){ if(st.items[i].qty > 1) st.items[i].qty--; }
  else if(a === 'rm' && st.items[i]) st.items.splice(i, 1);
  else if(a === 'save'){ save(); return; }
  render();
}

function save(){
  if(!st || st.busy || !st.items.length || !sb) return;
  var s = st;
  s.busy = true; render();
  var items = s.items.map(function(it){ return { product_id: it.pid, qty: it.qty }; });
  Promise.resolve(sb.rpc('wh_unknown_in', { p_code: s.code, p_items: items, p_client_id: s.cid, p_note: null })).then(function(r){
    var res = (r && !r.error && r.data) || null;
    s.busy = false;
    if(!res || res.code === 'busy' || res.code === 'error'){
      if(st === s) render();
      toast(res && res.code === 'busy' ? 'السيرفر مشغول — دوس «سجّله» تاني' : 'مقدرناش نسجّل — دوس «سجّله» تاني', 'er');
      return;
    }
    if(st === s) close();
    if(typeof s.onRes === 'function') s.onRes(res, s);
  }, function(e){
    s.busy = false;
    if(st === s) render();
    swallow('wh-unknown/save', e);
    toast('مقدرناش نسجّل (النت؟) — دوس «سجّله» تاني', 'er');
  });
}
