// order-form — «➕ أوردر جديد» من صفحة الأوردرات و«🔁 طلب استبدال» من جوّه أوردر العميل
// (طلبات المالك 3 أكتوبر). الاتنين بيعدّوا على RPC واحدة: create_staff_order.
//
// ليه: طلبات فيسبوك/إنستجرام كان الموظف بيعملها في بوابة J&T مباشرةً، فتبقى بره سهل خالص —
// مالهاش حالة ولا تكلفة ولا تحصيل (58 أوردر bosta_assigned من غير بوليصة من 20 سبتمبر). والاستبدال
// كان بيتعمل بره السيستم كله. دلوقتي الاتنين أوردر حقيقي بيتشحن من نافذة J&T العادية.
//
// 🔴 اللي السيرفر بيقرره (مش المتصفح): الحالة (مؤكد بسطر سجل حالة) · رقم W-n · الإجمالي = مجموع
// السطور · المنتج لازم يكون في المخزون (اسم حر = تكلفة صفر في الأرباح — W-24) · رقم الموبايل بنفس
// egMobile بتاع jt-ship · عنوان J&T في نطاق jt_pca. والاستبدال: الأصلي لازم يكون اتشحن، والمنصة
// بتتورث منه، ومبلغ التحصيل الموظف بيكتبه (الافتراضي فرق السعر — قرار المالك) وبيتحسب أوردر جديد كامل.
// ⚠️ الفورم ده **مش** #prod-list: نافذة التفاصيل ممكن تكون مفتوحة تحته، ومحرر منتجاتها بيقرا #prod-list
// (وحارس «تعديل مش محفوظ» قبل الشحن كمان) — فالصفوف هنا بكلاسات وid مختلفين عمداً.
import { walletStateCache } from '../billing/billing.js';
import { $id, esc } from '../core/dom.js';
import { num } from '../core/format.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { stockProducts, stockSetProducts } from '../stock/stock.js';
import { currentTenantId } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { loadOrdersCards } from './cards.js';
import { openDetail } from './detail.js';
import { ensureTenant } from './guards.js';
import { fetchOrdersPage } from './orders.js';
import { buildProductOptions, parseProducts } from './products-editor.js';
import { isJt, jtLoadAreas, jtLoadPca, jtNorm, jtOpts, jtUniq } from './ship.js';

// القيم = قيم orders.platform المسموحة (CHECK + normalize_order_platform) — نفس قايمة السيرفر
export var OF_PLATFORMS = [['fb', 'فيسبوك'], ['ig', 'إنستجرام'], ['whatsapp', 'واتساب'], ['tiktok', 'تيك توك'], ['threads', 'ثريدز'], ['other', 'أخرى']];

export var OF_ERR = {
  not_allowed: 'حسابك مش مفعّل على متجر',
  no_name: 'اكتب اسم العميل',
  bad_phone: 'رقم التليفون مش رقم موبايل مصري صالح (11 رقم يبدأ بـ01)',
  bad_alt_phone: 'التليفون التاني مش رقم موبايل مصري صالح',
  short_address: 'العنوان قصير — J&T بترفضه (10 حروف على الأقل)',
  no_items: 'اختار منتج واحد على الأقل',
  bad_item: 'فيه منتج كميته أو سعره مش صحيح',
  unknown_product: 'فيه منتج مش في المخزون — اختاره من القايمة',
  total_mismatch: 'الإجمالي اتغيّر — راجع الأسعار وجرّب تاني',
  bad_total: 'مبلغ التحصيل مش صحيح',
  bad_platform: 'اختار المنصة',
  bad_ship_address: 'كمّل المحافظة والمدينة والمنطقة',
  area_too_long: 'المنطقة أطول من 60 حرف',
  address_not_in_pca: 'المحافظة/المدينة مش في نطاق J&T — اختارها من القايمة',
  bad_weight: 'الوزن مش صحيح',
  duplicate: 'فيه أوردر لنفس الرقم اتسجّل من أقل من دقيقة ونص — راجع القايمة الأول',
  exchange_not_found: 'الأوردر الأصلي مش موجود',
  exchange_not_shipped: 'الأوردر الأصلي لسه ماتشحنش — عدّل منتجاته بدل الاستبدال',
  exchange_cancelled: 'الأوردر الأصلي ملغي — اعمل أوردر جديد بدل الاستبدال'
};

// الاستبدال مسموح بعد ما الأصلي يتشحن بس (نفس شرط السيرفر بالحرف)
export function ofExchangeAllowed(o){
  var st = String((o && o.status) || '').toLowerCase();
  return !!o && st !== 'pending' && st !== 'confirmed' && st !== 'cancelled';
}

// نفس egMobile في _shared/jt-runtime.ts وapp.eg_mobile على السيرفر — الرفض هنا بس أسرع
var OF_DIGITS = '٠١٢٣٤٥٦٧٨٩';
var OF_DIGITS_FA = '۰۱۲۳۴۵۶۷۸۹';
export function ofMobile(raw){
  var d = String(raw || '').split('').map(function(ch){
    var i = OF_DIGITS.indexOf(ch); if(i >= 0) return String(i);
    i = OF_DIGITS_FA.indexOf(ch); if(i >= 0) return String(i);
    return ch;
  }).join('').replace(/\D/g, '');
  if(d.indexOf('0020') === 0) d = d.slice(4);
  else if(d.indexOf('20') === 0 && d.length === 12) d = d.slice(2);
  if(d.length === 10 && d.charAt(0) === '1') d = '0' + d;
  return /^01[0-9]{9}$/.test(d) ? d : null;
}

var ofState = null;   // { mode:'new'|'exchange', orig, busy, codTouched }

function ofStockPrice(name){
  for(var i = 0; i < (stockProducts || []).length; i++){
    var p = stockProducts[i];
    if(p && p.name === name) return p.unit_price != null && isFinite(Number(p.unit_price)) ? Number(p.unit_price) : null;
  }
  return null;
}

function ofEnsureStock(){
  if(stockProducts && stockProducts.length) return Promise.resolve();
  return sb.from('v_stock_products').select('id,name,current_qty,unit_price,wholesale_price,parent_id,variant_label')
    .eq('tenant_id', currentTenantId).eq('active', true).order('current_qty', { ascending: false })
    .then(function(r){ if(!r.error && r.data) stockSetProducts(r.data); });
}

function ofModalEl(){
  var bd = $id('of-modal');
  if(bd) return bd;
  bd = document.createElement('div');
  bd.id = 'of-modal'; bd.className = 'jt-bd';
  bd.innerHTML = '<div class="jt-box of-box" role="dialog" aria-modal="true">'
    + '<div class="jt-ttl" id="of-ttl"></div>'
    + '<div class="jt-sub" id="of-sub"></div>'
    + '<div class="jt-grid">'
    + '<label>اسم العميل<input class="fsel" id="of-name" type="text" autocomplete="off"></label>'
    + '<label>التليفون<input class="fsel" id="of-phone" type="tel" inputmode="tel" placeholder="01xxxxxxxxx" autocomplete="off"></label>'
    + '<label>تليفون تاني (اختياري)<input class="fsel" id="of-alt" type="tel" inputmode="tel" autocomplete="off"></label>'
    + '<label id="of-plat-wrap">المنصة<select class="fsel" id="of-platform">' + OF_PLATFORMS.map(function(p){ return '<option value="' + p[0] + '">' + esc(p[1]) + '</option>'; }).join('') + '</select></label>'
    + '<label class="of-jt">المحافظة<select class="fsel" id="of-prov"></select></label>'
    + '<label class="of-jt">المدينة<select class="fsel" id="of-city"></select></label>'
    + '<label class="of-jt">المنطقة (اكتبها)<input class="fsel" id="of-area" type="text" maxlength="60" list="of-area-list" autocomplete="off" placeholder="مثال: الحي السابع"><datalist id="of-area-list"></datalist></label>'
    + '<label class="of-jt">الوزن (كجم)<input class="fsel" id="of-weight" type="number" min="0.1" step="0.1" inputmode="decimal"></label>'
    + '</div>'
    + '<label class="of-full">العنوان بالتفصيل<textarea class="fsel" id="of-addr" rows="2" placeholder="الشارع · رقم العمارة · الدور · علامة مميزة"></textarea></label>'
    + '<div class="of-items-head">المنتجات <span class="of-hint">(من المخزون بس)</span></div>'
    + '<div id="of-items"></div>'
    + '<button class="prod-add-btn" id="of-add" type="button">+ منتج تاني</button>'
    + '<div class="of-sum" id="of-sum"></div>'
    + '<label class="of-full" id="of-cod-wrap">مبلغ التحصيل من العميل (ج)<input class="fsel" id="of-cod" type="text" inputmode="decimal"></label>'
    + '<label class="of-full">ملاحظة (بتظهر في خانة «ملاحظة على البوليصة» وقت الشحن — تقدر تعدّلها هناك)<textarea class="fsel" id="of-note" rows="2" maxlength="300"></textarea></label>'
    + '<div class="jt-err" id="of-err"></div>'
    + '<div class="dacts"><button class="abtn ok" id="of-save" type="button"></button><button class="abtn" id="of-cancel" type="button">إلغاء</button></div>'
    + '</div>';
  document.body.appendChild(bd);
  bd.addEventListener('click', function(e){ if(e.target === bd) ofClose(); });
  $id('of-cancel').addEventListener('click', ofClose);
  $id('of-add').addEventListener('click', function(){ ofAddRow('', 1, null); });
  $id('of-save').addEventListener('click', ofSubmit);
  $id('of-cod').addEventListener('input', function(){ if(ofState) ofState.codTouched = true; });
  return bd;
}

function ofAddRow(name, qty, price){
  var box = $id('of-items');
  var row = document.createElement('div');
  row.className = 'of-row';
  var p = price != null ? price : (name ? ofStockPrice(name) : null);
  row.innerHTML = '<select class="fsel of-prod">' + buildProductOptions(name || '') + '</select>'
    + '<input class="fsel of-price" type="text" inputmode="decimal" placeholder="السعر" value="' + (p != null ? esc(String(p)) : '') + '">'
    + '<input class="fsel of-qty" type="text" inputmode="numeric" value="' + esc(String(qty || 1)) + '">'
    + '<button class="prod-del of-del" type="button" title="حذف">✕</button>';
  box.appendChild(row);
  row.querySelector('.of-prod').addEventListener('change', function(){
    var sp = ofStockPrice(this.value);
    row.querySelector('.of-price').value = sp != null ? String(sp) : '';
    ofRefreshTotals();
  });
  row.querySelector('.of-price').addEventListener('input', ofRefreshTotals);
  row.querySelector('.of-qty').addEventListener('input', ofRefreshTotals);
  row.querySelector('.of-del').addEventListener('click', function(){
    if(box.querySelectorAll('.of-row').length > 1){ row.remove(); ofRefreshTotals(); }
  });
  ofRefreshTotals();
}

// الصفوف → [{name, qty, price}] + أول مشكلة لو فيه
export function ofCollect(){
  var out = [], err = null, sum = 0;
  ($id('of-items') ? $id('of-items').querySelectorAll('.of-row') : []).forEach(function(row){
    var name = String(row.querySelector('.of-prod').value || '').trim();
    var qRaw = String(row.querySelector('.of-qty').value || '').trim();
    var pRaw = String(row.querySelector('.of-price').value || '').trim();
    if(!name){ if(!err) err = 'no_items'; return; }
    var qty = parseInt(qRaw, 10), price = parseFloat(pRaw.replace(/[^\d.]/g, ''));
    if(!(qty >= 1 && qty <= 999) || pRaw === '' || !isFinite(price) || price < 0){ if(!err) err = 'bad_item'; return; }
    price = Math.round(price * 100) / 100;
    out.push({ name: name, qty: qty, price: price });
    sum += price * qty;
  });
  if(!out.length && !err) err = 'no_items';
  return { items: out, err: err, sum: Math.round(sum * 100) / 100 };
}

function ofRefreshTotals(){
  if(!ofState) return;
  var c = ofCollect();
  var el = $id('of-sum');
  if(ofState.mode === 'exchange'){
    var origTotal = Number(ofState.orig.total_cost) || 0;
    var diff = Math.max(0, Math.round((c.sum - origTotal) * 100) / 100);
    el.textContent = 'سعر المنتجات الجديدة ' + num(c.sum) + ' ج − الأوردر الأصلي ' + num(origTotal) + ' ج = فرق ' + num(diff) + ' ج';
    if(!ofState.codTouched) $id('of-cod').value = String(diff);
  }else{
    el.textContent = 'الإجمالي (مبلغ التحصيل): ' + num(c.sum) + ' ج';
  }
}

async function ofFillAddress(o){
  var provSel = $id('of-prov'), citySel = $id('of-city'), areaList = $id('of-area-list');
  var areas = null;
  function fillAreas(){
    var byProv = (areas && areas[provSel.value]) || null;
    var list = jtUniq((byProv && byProv[citySel.value]) || []);
    areaList.innerHTML = list.map(function(a){ return '<option value="' + esc(a) + '"></option>'; }).join('');
  }
  jtLoadAreas().then(function(a){ areas = a; try{ fillAreas(); }catch(e){} });
  var pca;
  try{ pca = await jtLoadPca(); }catch(e){ $id('of-err').textContent = 'مقدرناش نحمّل نطاق J&T: ' + (e.message || e); return; }
  var provs = jtUniq(pca.map(function(x){ return x.prov; }));
  var k = jtNorm(o && o.city);
  var guessProv = (o && o.ship_prov) || provs.filter(function(p){ return jtNorm(p) === k; })[0] || '';
  var guessCity = (o && o.ship_city) || '';
  if(!guessProv && k){
    var hit = pca.filter(function(x){ return jtNorm(x.city) === k; })[0];
    if(hit){ guessProv = hit.prov; guessCity = hit.city; }
  }
  function fillCities(){
    var cities = jtUniq(pca.filter(function(x){ return x.prov === provSel.value; }).map(function(x){ return x.city; }));
    jtOpts(citySel, cities, guessCity, 'اختار المدينة');
    if(cities.length === 1) citySel.value = cities[0];
    fillAreas();
  }
  jtOpts(provSel, provs, guessProv, 'اختار المحافظة');
  fillCities();
  provSel.onchange = function(){ guessCity = ''; fillCities(); };
  citySel.onchange = fillAreas;
}

// opts: { mode:'new' } أو { mode:'exchange', order: <الأوردر الأصلي كامل> }
export function openOrderForm(opts){
  opts = opts || {};
  if(tourActive){ toast('مش متاح أثناء الجولة', 'er'); return; }
  if(walletStateCache && walletStateCache.is_depleted){ toast('بياناتك مقفلة لحد ما تشحن المحفظة', 'er'); return; }
  if(!ensureTenant()) return;
  var ex = opts.mode === 'exchange';
  var o = ex ? opts.order : null;
  if(ex && !ofExchangeAllowed(o)){ toast(OF_ERR.exchange_not_shipped, 'er'); return; }
  ofState = { mode: ex ? 'exchange' : 'new', orig: o, busy: false, codTouched: false };
  var bd = ofModalEl();
  $id('of-ttl').textContent = ex ? ('🔁 طلب استبدال لأوردر #' + (o.order_uid || '')) : '➕ أوردر جديد';
  $id('of-sub').textContent = ex
    ? ('المنتجات القديمة: ' + parseProducts(o.product_name || '').filter(Boolean).join(' + ') + ' · الإجمالي ' + num(Number(o.total_cost) || 0) + ' ج\n'
      + 'الاستبدال بيتسجّل أوردر جديد مؤكد (W-…) بشحنة J&T جديدة — والأوردر الأصلي مابيتغيّرش.')
    : 'للطلبات اللي جاية من فيسبوك/إنستجرام/التليفون — بيتسجّل مؤكد وتشحنه J&T من نافذة الأوردر زي أي أوردر.';
  $id('of-name').value = ex ? (o.customer_name || '') : '';
  $id('of-phone').value = ex ? (o.phone || '') : '';
  $id('of-alt').value = ex ? (o.alt_phone || '') : '';
  $id('of-addr').value = ex ? (o.address || '') : '';
  $id('of-weight').value = ex && Number(o.shipping_weight_kg) > 0 ? o.shipping_weight_kg : 1;
  $id('of-area').value = ex ? (o.ship_area || '') : '';
  $id('of-platform').value = 'fb';
  $id('of-plat-wrap').style.display = ex ? 'none' : '';
  $id('of-cod-wrap').style.display = ex ? '' : 'none';
  $id('of-cod').value = '';
  $id('of-note').value = ex
    ? ('استبدال لأوردر #' + (o.order_uid || '') + ' — المنتج القديم: ' + parseProducts(o.product_name || '').filter(Boolean).join(' + '))
    : '';
  $id('of-err').textContent = '';
  $id('of-save').textContent = ex ? 'تسجيل الاستبدال' : 'تسجيل الأوردر';
  $id('of-save').disabled = false;
  bd.querySelectorAll('.of-jt').forEach(function(l){ l.style.display = isJt() ? '' : 'none'; });
  $id('of-items').innerHTML = '';
  bd.classList.add('open');
  ofEnsureStock().then(function(){ if(ofState) ofAddRow('', 1, null); });
  if(isJt()) ofFillAddress(o);
}

function ofClose(){
  var bd = $id('of-modal'); if(bd) bd.classList.remove('open');
  ofState = null;
}

function ofSubmit(){
  if(!ofState || ofState.busy) return;
  var err = $id('of-err');
  err.textContent = '';
  var ex = ofState.mode === 'exchange';
  var name = $id('of-name').value.trim();
  var phone = ofMobile($id('of-phone').value);
  var altRaw = $id('of-alt').value.trim();
  var alt = altRaw ? ofMobile(altRaw) : null;
  var addr = $id('of-addr').value.replace(/\s+/g, ' ').trim();
  var c = ofCollect();
  var prov = isJt() ? $id('of-prov').value : '', city = isJt() ? $id('of-city').value : '';
  var area = isJt() ? $id('of-area').value.replace(/\s+/g, ' ').trim() : '';
  var w = isJt() ? parseFloat($id('of-weight').value) : NaN;
  var cod = null;
  if(!name){ err.textContent = OF_ERR.no_name; return; }
  if(!phone){ err.textContent = OF_ERR.bad_phone; return; }
  if(altRaw && !alt){ err.textContent = OF_ERR.bad_alt_phone; return; }
  if(addr.length < 10){ err.textContent = OF_ERR.short_address; return; }
  if(isJt() && (!prov || !city || !area)){ err.textContent = OF_ERR.bad_ship_address; return; }
  if(isJt() && !(w > 0 && w <= 100)){ err.textContent = OF_ERR.bad_weight; return; }
  if(c.err){ err.textContent = OF_ERR[c.err]; return; }
  if(ex){
    var codRaw = $id('of-cod').value.trim();
    cod = parseFloat(codRaw.replace(/[^\d.]/g, ''));
    if(codRaw === '' || !isFinite(cod) || cod < 0){ err.textContent = OF_ERR.bad_total; return; }
    cod = Math.round(cod * 100) / 100;
  }
  var total = ex ? cod : c.sum;
  var lines = c.items.map(function(it){ return it.name + ' (عدد ' + it.qty + ')'; });
  showModal({
    icon: ex ? '🔁' : '➕',
    title: ex ? 'تسجيل الاستبدال؟' : 'تسجيل الأوردر؟',
    sub: name + ' · ' + phone + '\n' + lines.join(' + ') + '\nمبلغ التحصيل: ' + num(total) + ' ج'
      + (ex ? '\nأوردر جديد مؤكد بشحنة J&T جديدة — الأصلي #' + (ofState.orig.order_uid || '') + ' مابيتغيّرش' : '\nهيتسجّل مؤكد — الشحن من نافذة الأوردر بعدها'),
    okLabel: ex ? 'سجّل الاستبدال' : 'سجّل الأوردر',
    okColor: 'linear-gradient(135deg,#10b981,#059669)',
    onOk: function(){ ofCreate({ name: name, phone: phone, alt: alt, addr: addr, items: c.items, prov: prov, city: city, area: area, w: w, total: total, ex: ex }); }
  });
}

function ofCreate(f){
  if(!ofState || ofState.busy) return;
  var st = ofState;
  st.busy = true;
  var btn = $id('of-save');
  btn.disabled = true; btn.textContent = '⏳ بنسجّل...';
  var args = {
    p_customer_name: f.name, p_phone: f.phone, p_address: f.addr,
    p_items: f.items, p_alt_phone: f.alt || null,
    p_city: f.prov || null, p_platform: f.ex ? null : $id('of-platform').value,
    p_customer_notes: $id('of-note').value.trim() || null,
    p_ship_prov: f.prov || null, p_ship_city: f.city || null, p_ship_area: f.area || null,
    p_weight: isFinite(f.w) && f.w > 0 ? f.w : null,
    p_total: f.total,
    p_exchange_of: f.ex ? st.orig.id : null
  };
  sb.rpc('create_staff_order', args).then(function(r){
    var d = r && r.data;
    if(r.error || !d || !d.ok){
      st.busy = false;
      btn.disabled = false; btn.textContent = f.ex ? 'تسجيل الاستبدال' : 'تسجيل الأوردر';
      var code = d && d.error;
      $id('of-err').textContent = (code && OF_ERR[code]) ? OF_ERR[code] + (code === 'unknown_product' && d.name ? ' («' + d.name + '»)' : '')
        : 'الأوردر مااتسجّلش — حاول تاني' + (r.error ? ' (' + (r.error.message || '') + ')' : '');
      return;
    }
    ofClose();
    toast((f.ex ? 'الاستبدال اتسجّل ✅ ' : 'الأوردر اتسجّل ✅ ') + d.order_uid + ' — مؤكد. اشحنه من «🚚 شحن J&T»', 'ok');
    try{ fetchOrdersPage(); loadOrdersCards(); }catch(e){}
    openDetail(d.order_id);
  }, function(){
    st.busy = false;
    btn.disabled = false; btn.textContent = f.ex ? 'تسجيل الاستبدال' : 'تسجيل الأوردر';
    $id('of-err').textContent = 'الأوردر مااتسجّلش — حاول تاني';
  });
}

export function initOrderForm(){
  var b = $id('ord-new-btn');
  if(b) b.addEventListener('click', function(){ openOrderForm({ mode: 'new' }); });
}
