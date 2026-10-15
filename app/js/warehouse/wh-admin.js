// سكانر المخزن — شاشات الأدمن: ربط المنتجات · الجرد والتشغيل (14 أكتوبر)
//
// 🔗 ربط المنتجات: اسم المنتج في الأوردر (زي ما اللاندنج بيكتبه) ↔ منتج في المخزون. السيرفر بيحل لوحده
//    لو الاسم = اسم منتج واحد بالظبط بعد التطبيع؛ اللي مايتحلش بيظهر هنا «مش مربوط». الربط بيتعمل مرة
//    (`stock_item_aliases`) والسطور المعلّقة اللي اتضربت قبل كده بتتخصم لحظة الربط (`wh_alias_set`).
// ⚙️ التشغيل (15 أكتوبر — قرار المالك): «▶️ شغّل السكانر» من غير جرد — لحظة البداية (`baseline_at`) = دلوقتي،
//    وأرقام المخزون بتتظبط مرة من محرر المخزون (حركة «تعديل» بسبب). من بعدها كل سكان بيغيّر الحالة ويحرّك المخزون.
//    قبل التشغيل `wh_start_check` (مش مربوط · «راجع» · مرتجعات ناقصة · عائلات رصيدها على الأم · حركة J&T من ساعة
//    ما الأرقام اتظبطت) بيتعرض في التأكيد — والسيرفر نفسه بيرفض التشغيل من غير `force` لو فيه حاجة (needs_confirm).
// 🧮 الجرد الكامل (اختياري — مطوي): عدّ حقيقي لكل منتج → حركة «جرد» بالفرق. «جرد التشغيل» = طريقة تانية للبداية:
//    السكان بيبدأ يخصم من لحظة فتح الجرد — كل اللي خرج قبلها اتحسب في الجرد، واللي يرجع منه بيتضاف.
// 🔴 الكتابة كلها RPCs أدمن (السيرفر بيرفض أي حد تاني) — الواجهة مابتحسبش كميات.

import { $id, esc } from '../core/dom.js';
import { stripBidi } from '../core/format.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { currentRole, currentTenant, currentTenantId } from '../auth/auth.js';
import { fontCss } from '../orders/jt-awb.js';

var api = { reloadBoard: function(){}, setTab: function(){}, enqueue: function(){}, pending: function(){ return 0; } };
var board = null;

// ── ربط المنتجات ─────────────────────────────────────────────────────
var mapRows = null, mapProducts = [], mapErr = false, mapLoading = false, mapFilter = '', mapQ = '';
var mapSaving = {};
var mapAgain = false;   // طلب تحميل جه والتحميل في السكة — بيتعاد بعده (كان بيترمي، فصف اتربط حالاً كان يبان «مش مربوط»)
// اختيار الأدمن في كل صف قبل ما يحفظ — أي رسم للقايمة (حفظ صف تاني · فلتر · بحث) كان بيرجّع الاختيارات
// اللي مااتحفظتش لأصلها في صمت
var mapPick = {};   // rowKey → {pid, scope}

// حالة الصف — مصدر واحد للشريحة والفلتر والشارة
export function whMapState(r){
  if(!r) return 'unmatched';
  if(r.state === 'ignored') return 'ignored';
  if(r.state !== 'posted' || !r.product_id) return 'unmatched';
  if(r.matched_by === 'unallocated') return 'unallocated';
  // (15 أكتوبر — المراجعة) اتربط بالاسم والسطر ليه خاصية، وفيه منتج تاني اسمه بيبدأ بنفس الاسم («… مقاس ٦٥»):
  // «مقاس 65 عرض» كان بيتخصم من الـ85 ويبان ✅ — لحد ما الأدمن يربط الخاصية بنفسه
  if(r.sibling && !r.alias_props && !r.alias_props_ignore) return 'review';
  return 'ok';
}

var MAP_CHIPS = [
  { k: 'unmatched',   t: '❌ مش مربوط' },
  { k: 'review',      t: '⚠️ راجع' },
  { k: 'unallocated', t: '📦 بيتخصم من «غير موزع»' },
  { k: 'ok',          t: '✅ مربوط' },
  { k: 'ignored',     t: '🚫 متجاهَل' },
  { k: 'all',         t: '🗂️ الكل' }
];
var MATCHED_BY = { alias: 'ربط بالخاصية', alias_item: 'ربط بالاسم', exact: 'نفس الاسم', child_label: 'الخاصية من الأوردر', unallocated: 'غير موزع' };

function rowKey(r){ return r.item_key + '|' + (r.props_key || '') + '|' + (r.var_key || ''); }

function loadMap(){
  if(!sb) return;
  if(mapLoading){ mapAgain = true; return; }
  mapLoading = true; mapErr = false;
  renderMap();
  sb.rpc('wh_items_unmapped', { p_days: 30 }).then(function(r){
    mapLoading = false;
    if(mapAgain){ mapAgain = false; loadMap(); return; }
    if(r.error || !r.data || !r.data.ok){ mapErr = true; renderMap(); return; }
    mapRows = r.data.rows || [];
    mapProducts = (r.data.products || []).filter(function(p){ return p.active !== false; });
    if(!mapFilter){
      var c = mapCounts();
      mapFilter = c.unmatched ? 'unmatched' : (c.review ? 'review' : (c.unallocated ? 'unallocated' : 'all'));
    }
    renderMap();
  });
}

function mapCounts(){
  var c = { unmatched: 0, review: 0, unallocated: 0, ok: 0, ignored: 0, all: 0 };
  (mapRows || []).forEach(function(r){ c[whMapState(r)]++; c.all++; });
  return c;
}

function isChildProduct(id){
  for(var i = 0; i < mapProducts.length; i++) if(mapProducts[i].id === id) return !!mapProducts[i].parent_id;
  return false;
}

// النطاق الافتراضي بيوصف الربط الموجود الأول: ربط بالخاصية = «بالخاصية دي بس» · ربط بالاسم والاختيار زي ما
// هو = «للاسم ده» (حفظ تاني = نفس الربط — كان بيقترح «بالخاصية» على ربط اسم بخاصية، والحفظ كان بيعمل ربط
// خاصية جديد بيسحب الأوردرات من الأخت الصح). وبعدين لاختيار جديد: المنتج خاصية (بنت) والصف ليه خاصية =
// «بالخاصية دي بس» — ربط الاسم كله بخاصية واحدة معناه كل ألوان/مقاسات الاسم تتخصم منها.
export function whMapDefaultScope(r, pid){
  if(!r || !r.props_key) return 'item';
  if(r.alias_props || r.alias_props_ignore) return 'props';
  if(whMapState(r) === 'review') return 'props';   // المقاس ده بالذات — مش الاسم كله
  if((r.alias_item || r.alias_item_ignore) && (!pid || pid === r.alias_item)) return 'item';
  if(pid && isChildProduct(pid)) return 'props';
  return 'item';
}

function productOptions(sel){
  var parents = mapProducts.filter(function(p){ return !p.parent_id; });
  var kids = {};
  mapProducts.forEach(function(p){ if(p.parent_id){ (kids[p.parent_id] = kids[p.parent_id] || []).push(p); } });
  var h = '<option value="">— اختار منتج من المخزون —</option>';
  parents.forEach(function(p){
    var k = kids[p.id] || [];
    h += '<option value="' + esc(p.id) + '"' + (sel === p.id ? ' selected' : '') + '>' + esc(p.name) + (k.length ? ' (غير موزع)' : '') + '</option>';
    k.forEach(function(c){
      h += '<option value="' + esc(c.id) + '"' + (sel === c.id ? ' selected' : '') + '>↳ ' + esc(c.name) + '</option>';
    });
  });
  return h;
}

function renderMap(){
  var el = $id('wh-map'); if(!el) return;
  if(mapLoading && !mapRows){ el.innerHTML = '<div class="wh-empty">بنحمّل أسامي المنتجات من أوردرات آخر 30 يوم…</div>'; return; }
  if(mapErr && !mapRows){ el.innerHTML = '<div class="wh-empty">مقدرناش نحمّل القايمة. <button type="button" class="wh-btn wh-btn-ghost" data-wha="map-reload">↻ حاول تاني</button></div>'; return; }
  if(!mapRows){ el.innerHTML = ''; return; }
  var c = mapCounts();
  var h = '<div class="wh-hint">كل اسم منتج اتكتب في الأوردرات آخر 30 يوم، والسيستم بيخصمه من أنهي منتج في المخزون. '
    + 'اللي «مش مربوط» مش هيتخصم من المخزن لحد ما تربطه — والسكانات اللي اتعملت عليه قبل الربط بتتخصم لحظة الربط. '
    + '«⚠️ راجع» = خاصية (مقاس) بتتخصم من منتج بالاسم، وفيه منتج تاني اسمه شبه — اختار الصح «بالخاصية دي بس». خلّي الاتنين صفر قبل التشغيل.</div>';
  h += '<div class="wh-map-bar"><div class="wh-chips">';
  MAP_CHIPS.forEach(function(ch){
    h += '<button type="button" class="wh-chip' + (mapFilter === ch.k ? ' on' : '') + (((ch.k === 'unmatched' && c.unmatched) || (ch.k === 'review' && c.review)) ? ' hot' : '') + '" data-wha="map-filter" data-k="' + ch.k + '">'
      + esc(ch.t) + ' <span class="n">' + c[ch.k] + '</span></button>';
  });
  h += '</div><div class="wh-map-tools"><input type="search" class="wh-search" id="wh-map-q" placeholder="دوّر باسم المنتج" value="' + esc(mapQ) + '">'
    + '<button type="button" class="wh-btn wh-btn-ghost" data-wha="map-repost" title="بعد ما تضيف منتج جديد في المخزون بنفس الاسم">🔄 حل المعلّق تاني</button>'
    + '<button type="button" class="wh-btn wh-btn-ghost" data-wha="map-reload">↻</button></div></div>';
  var q = mapQ.trim();
  var list = (mapRows || []).filter(function(r){
    if(mapFilter !== 'all' && whMapState(r) !== mapFilter) return false;
    if(q && String(r.sample || '').indexOf(q) < 0 && String(r.item_key || '').indexOf(q) < 0) return false;
    return true;
  });
  if(!list.length){ el.innerHTML = h + '<div class="wh-empty">مفيش حاجة هنا ✓</div>'; return; }
  h += '<div class="wh-map-list">';
  list.slice(0, 300).forEach(function(r){
    var st = whMapState(r), k = rowKey(r);
    var cur = st === 'ok' || st === 'unallocated'
      ? '<span class="wh-ms ' + st + '">' + (st === 'ok' ? '✅ ' : '📦 ') + esc(r.product_name || '') + ' <small>(' + esc(MATCHED_BY[r.matched_by] || r.matched_by || '') + ')</small></span>'
      : st === 'review' ? '<span class="wh-ms unmatched">⚠️ بيتخصم من «' + esc(r.product_name || '') + '» (نفس الاسم) — فيه منتج تاني اسمه شبه: اتأكد إن الخاصية دي بتاعته</span>'
      : (st === 'ignored' ? '<span class="wh-ms ignored">🚫 متجاهَل — مش بيتخصم</span>' : '<span class="wh-ms unmatched">❌ مش مربوط — مش بيتخصم</span>');
    var hasProps = !!(r.props_key);
    var pk = mapPick[k];
    var sel = pk ? pk.pid : (r.alias_props || r.alias_item || (st === 'ok' || st === 'unallocated' || st === 'review' ? r.product_id : ''));
    var scope = pk && pk.scope ? pk.scope : whMapDefaultScope(r, sel);
    h += '<div class="wh-map-row" data-k="' + esc(k) + '">'
      + '<div class="wh-map-name"><b>' + esc(r.sample || r.item_key) + '</b>'
      + (hasProps ? '<span class="wh-map-props">الخاصية: ' + esc(r.props_key) + '</span>' : '')
      + '<span class="wh-map-n">' + esc(String(r.orders || 0)) + ' أوردر · ' + esc(String(r.pieces || 0)) + ' قطعة</span></div>'
      + '<div class="wh-map-cur">' + cur + '</div>'
      + '<div class="wh-map-ctl">'
      + '<select class="wh-sel wh-map-prod">' + productOptions(sel) + '</select>'
      + (hasProps ? '<select class="wh-sel wh-map-scope"><option value="item">للاسم ده بكل خصايصه</option><option value="props"' + (scope === 'props' ? ' selected' : '') + '>للاسم ده بالخاصية دي بس</option></select>' : '')
      + '<button type="button" class="wh-btn" data-wha="map-save"' + (mapSaving[k] ? ' disabled' : '') + '>💾 اربط</button>'
      + '<button type="button" class="wh-btn wh-btn-ghost" data-wha="map-ignore"' + (mapSaving[k] ? ' disabled' : '') + ' title="مش منتج في المخزن (هدية · خدمة · شحن)">🚫 تجاهل</button>'
      + '</div></div>';
  });
  h += '</div>';
  if(list.length > 300) h += '<div class="wh-hint">بيعرض 300 من ' + list.length + ' — استخدم البحث.</div>';
  el.innerHTML = h;
}

function findRow(k){
  var rows = mapRows || [];
  for(var i = 0; i < rows.length; i++) if(rowKey(rows[i]) === k) return rows[i];
  return null;
}

function mapSave(btn, ignore){
  var rowEl = btn.closest('.wh-map-row'); if(!rowEl) return;
  var k = rowEl.getAttribute('data-k'), r = findRow(k);
  if(!r || mapSaving[k]) return;
  var pid = null;
  if(!ignore){
    var ps = rowEl.querySelector('.wh-map-prod');
    pid = ps ? ps.value : '';
    if(!pid){ toast('اختار المنتج من المخزون الأول', 'er'); return; }
  }
  var sc = rowEl.querySelector('.wh-map-scope');
  var props = (sc && sc.value === 'props') ? (r.props_key || '') : '';
  var send = function(replace){
    mapSaving[k] = true; renderMap();
    sb.rpc('wh_alias_set', { p_item_key: r.item_key, p_props_key: props, p_product_id: pid, p_ignore: !!ignore,
                             p_replace: !!replace, p_sample: r.sample || null }).then(function(res){
      mapSaving[k] = false;
      var d = (res && !res.error && res.data) || { ok: false, code: 'error' };
      if(d.ok) delete mapPick[k];
      if(d.code === 'exists_use_replace'){
        renderMap();
        showModal({ icon: '🔗', title: 'الاسم ده مربوط بحاجة تانية', sub: 'تغيّر الربط؟ السكانات اللي جاية بس هي اللي هتتخصم بالربط الجديد.',
          okLabel: 'غيّره', onOk: function(){ send(true); } });
        return;
      }
      if(!d.ok){ renderMap(); toast(d.code === 'bad_product' ? 'المنتج مش موجود' : 'مقدرناش نحفظ — حاول تاني', 'er'); return; }
      var msg = ignore ? 'اتجاهل ✓' : 'اتربط ✓';
      if(d.reposted) msg += ' — اتخصم ' + d.reposted + ' سطر كان معلّق';
      if(d.superseded) msg += ' · ' + d.superseded + ' اتغطّوا بالجرد';
      toast(msg, 'ok');
      loadMap();
      api.reloadBoard();
    });
  };
  send(false);
}

function mapRepost(){
  sb.rpc('wh_repost_unmatched').then(function(r){
    var d = (r && !r.error && r.data) || { ok: false };
    if(!d.ok){ toast('مقدرناش — حاول تاني', 'er'); return; }
    toast('اتخصم ' + (d.reposted || 0) + ' سطر · ' + (d.superseded || 0) + ' اتغطّوا بالجرد', 'ok');
    loadMap(); api.reloadBoard();
  });
}

// ── الجرد والتشغيل ───────────────────────────────────────────────────
var cnt = null;            // الجرد المفتوح {id, opened_at, opened_by_name}
var cntHist = [];
var cntProducts = null;
var cntLoading = false, cntErr = false, cntBusy = false;
var cntDraft = {};
var cntPreview = false;
var cntAgain = false;      // نفس فكرة mapAgain
// wh_count_pile — نفس الدالة اللي wh_count_apply بيطرح بيها: {count_id, rows:{pid:{pile, moved, moved_leak, ret,
// moved_ids, ret_ids, moved_ans, ret_ans, moved_by, ret_by, moved_need, ret_need, moved_list, ret_list}}, pile_orders,
// moved_orders, ret_orders}
//   pile  = طرود اتضربت خروج ولسه في الكومة → بتتطرح دايماً
//   moved = اتسلّمت للمندوب **بعد** ما الجرد اتفتح (وانت بتعدّ — moved_leak = خرجت من غير سكان: بتتسأل ومابتتطرحش)
//   ret   = مرتجع J&T سلّمه لنا (قبل الجرد أو وانت بتعدّ) ومحدش ضربه
//   🔴 الإجابة **لكل منتج** وعلى **الطرود اللي اتعرضت** (ids): منتج اتعدّ قبل المندوب وتاني بعده = إجابتين · طرد ظهر
//   بعد ما الشاشة اترسمت = السيرفر مابيحطّلوش إجابة (code=changed) والسؤال بيرجع عليه
var cntPile = null;
var cntPileErr = false;    // wh_count_pile وقع — من غيره الصفحة كانت بتتعرض كأن مفيش كومة ولا أسئلة (والتأكيد بيكدب)
var cntOptBusy = false;
var cntGoLive = null, cntGoLiveFor = null;   // اختيار «ده جرد التشغيل» — كان بيرجع لافتراضه مع كل رسم
var cfgBusy = false;
var cntAdvOpen = false;   // «🧮 جرد كامل (اختياري)» مفتوح — بيفضل زي ما الأدمن سابه مع أي رسم
var cntOrder = null, cntOrderFor = null;   // ترتيب الجرد المتجمّد (pids) — whCountFreeze
var cntPrinting = false;   // الطباعة مستنية الأرقام الجديدة — ضغطة تانية مابتفتحش نافذة تانية
var cntWaiters = [];   // مستنيين التحميل الجاي يخلص (الطباعة بتجيب الأرقام من جديد الأول) — fn(ok)

function draftKey(){ return 'sahl_wh_count_draft_' + (cnt ? cnt.id : 'x'); }
function draftLoad(){
  cntDraft = {};
  try{ var v = JSON.parse(localStorage.getItem(draftKey()) || '{}'); if(v && typeof v === 'object') cntDraft = v; }catch(e){ cntDraft = {}; }
}
function draftSave(){
  try{ localStorage.setItem(draftKey(), JSON.stringify(cntDraft)); }catch(e){ swallow('wh-admin/draft', e); }
}
// الصفوف بالترتيب المتجمّد للجرد المفتوح — مصدر واحد للشاشة والورقة (الرقم # واحد في الاتنين)
function orderKey(){ return 'sahl_wh_count_order_' + (cnt ? cnt.id : 'x'); }
function cntRows(){
  var fam = whCountFamilies(cntProducts);
  if(!cnt) return fam;
  if(cntOrderFor !== cnt.id){
    cntOrderFor = cnt.id; cntOrder = null;
    try{ var v = JSON.parse(localStorage.getItem(orderKey()) || 'null'); if(Array.isArray(v)) cntOrder = v; }catch(e){ cntOrder = null; }
  }
  fam = whCountFreeze(fam, cntOrder);
  var ids = fam.map(function(f){ return f.p.id; });
  if(!cntOrder || ids.length !== cntOrder.length || ids.some(function(x, i){ return x !== cntOrder[i]; })){
    cntOrder = ids;
    try{ localStorage.setItem(orderKey(), JSON.stringify(ids)); }catch(e){ swallow('wh-admin/order', e); }
  }
  return fam;
}

function whenTxt(iso){
  if(!iso) return '—';
  try{ return stripBidi(new Date(iso).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })); }
  catch(e){ return '—'; }
}

function cntFlush(ok){
  var w = cntWaiters; cntWaiters = [];
  w.forEach(function(fn){ try{ fn(ok); }catch(e){ swallow('wh-admin/count.wait', e); } });
}
// cb(ok) = بعد ما التحميل الجاي يخلص ويترسم (تحميل في السكة = بيستنى اللي بعده — اللي في السكة ممكن يكون قديم)
function loadCount(cb){
  if(cb) cntWaiters.push(cb);
  if(!sb || !currentTenantId){ cntFlush(false); return; }
  if(cntLoading){ cntAgain = true; return; }
  cntLoading = true; cntErr = false; renderCount();
  Promise.all([
    sb.from('stock_counts').select('id,opened_at,opened_by_name,note,applied_at,applied_by_name,go_live,cancelled_at')
      .eq('tenant_id', currentTenantId).order('opened_at', { ascending: false }).limit(6),
    sb.from('v_stock_products').select('id,name,current_qty,parent_id,variant_label,active')
      .eq('tenant_id', currentTenantId).order('name', { ascending: true }),
    Promise.resolve(sb.rpc('wh_count_pile')).catch(function(){ return { error: true }; })
  ]).then(function(res){
    cntLoading = false;
    if(cntAgain){ cntAgain = false; loadCount(); return; }
    if(res[0].error || res[1].error){ cntErr = true; renderCount(); cntFlush(false); return; }
    var pd = res[2] && !res[2].error && res[2].data;
    cntPile = null;
    cntPileErr = !(pd && pd.ok && Array.isArray(pd.pile));
    if(pd && pd.ok && Array.isArray(pd.pile)){
      var rw = {}, arr = function(v){ return Array.isArray(v) ? v : []; };
      pd.pile.forEach(function(x){
        if(!x || !x.product_id) return;
        rw[x.product_id] = { pile: Number(x.pile != null ? x.pile : x.qty) || 0, moved: Number(x.moved) || 0, moved_leak: Number(x.moved_leak) || 0,
                             ret: Number(x.ret) || 0, moved_ids: arr(x.moved_ids), ret_ids: arr(x.ret_ids),
                             moved_ans: x.moved_ans || null, ret_ans: x.ret_ans || null, moved_by: x.moved_by || '', ret_by: x.ret_by || '',
                             moved_need: !!x.moved_need, ret_need: !!x.ret_need, moved_list: arr(x.moved_list), ret_list: arr(x.ret_list),
                             pile_list: arr(x.pile_list) };
      });
      cntPile = { count_id: pd.count_id, rows: rw,
                  pile_orders: Number(pd.pile_orders) || 0, moved_orders: Number(pd.moved_orders) || 0, ret_orders: Number(pd.ret_orders) || 0 };
    }
    var rows = res[0].data || [];
    cnt = null;
    for(var i = 0; i < rows.length; i++) if(!rows[i].applied_at && !rows[i].cancelled_at){ cnt = rows[i]; break; }
    cntHist = rows.filter(function(x){ return x.applied_at; });
    // نفس شرط السيرفر بالحرف (`coalesce(active, true)`) — NULL = نشط، وإلا جرد التشغيل يترفض «ناقص»
    cntProducts = (res[1].data || []).filter(function(p){ return p.active !== false; });
    if(cnt) draftLoad();
    renderCount();
    cntFlush(true);
  }, function(e){
    cntLoading = false; swallow('wh-admin/count.load', e);
    if(cntAgain){ cntAgain = false; loadCount(); return; }
    cntErr = true; renderCount(); cntFlush(false);
  });
}

// اللي هيتطرح فعلاً من العدّ لكل منتج = الكومة + (اللي اتسلّم وانت بتعدّ لو المنتج ده «اتعدّوا») + (المرتجع لو
// «هنا واتعدّ») — نفس شرط wh_count_apply بالحرف (اللي خرج من غير سكان مابيتطرحش: عمره ما اتخصم)
export function whPileEffective(cp, countId){
  var out = {};
  if(!cp || cp.count_id !== countId) return out;
  Object.keys(cp.rows || {}).forEach(function(pid){
    var r = cp.rows[pid];
    out[pid] = r.pile + (r.moved_ans === 'counted' ? r.moved : 0) + (r.ret_ans === 'counted' ? r.ret : 0);
  });
  return out;
}
// السؤال لسه محتاج إجابة = السيرفر قال (طرد للمنتج مش في الإجابة — wh_count_apply بيرفض بـpile_questions بنفس الشرط) ·
// pids = المنتجات اللي هتتطبّق بس (منتج مش في العدّ مالوش دعوة)
export function whPileNeed(cp, countId, pids){
  var out = { moved: false, ret: false, pids: [] };
  if(!cp || cp.count_id !== countId) return out;
  Object.keys(cp.rows || {}).forEach(function(pid){
    if(pids && pids.indexOf(pid) < 0) return;
    var r = cp.rows[pid], m = r.moved_need && r.moved_ids.length > 0, t = r.ret_need && r.ret_ids.length > 0;
    if(m) out.moved = true;
    if(t) out.ret = true;
    if(m || t) out.pids.push(pid);
  });
  return out;
}
function pileMap(){ return cnt ? whPileEffective(cntPile, cnt.id) : {}; }

function qListHtml(list, n){
  if(!list || !list.length) return '';
  var h = '<span class="wh-q-list">';
  list.forEach(function(x){ h += '<span>' + (x.uid ? '#' + esc(x.uid) + ' ' : '') + '<span dir="ltr">' + esc(x.t || '') + '</span>'
    + (x.leak ? ' <small>(من غير سكان)</small>' : '') + '</span>'; });
  if(n > list.length) h += '<span>+ ' + (n - list.length) + '</span>';
  return h + '</span>';
}
var Q_TXT = {
  moved: { yes: ['counted', '✅ كانوا هنا واتعدّوا'], no: ['left', '🚚 خرجوا قبل ما أعدّه'],
           all: ['✅ كلهم كانوا هنا واتعدّوا', '🚚 كلهم خرجوا قبل ما أعدّ منتجاتهم'] },
  // 🔴 المرتجع بيوصل الضهر — ممكن يوصل **بعد** ما المنتج اتعدّ: موجود في المخزن بس مش في العدد، و«مش في المخزن»
  // كانت بتبان كذب فالأدمن يدوس «هنا» = قطعة ناقصة. السؤال بقى بالتوقيت زي «المندوب استلم»
  ret:   { yes: ['counted', '✅ كانوا هنا لما عدّيت المنتج'], no: ['absent', '🚫 ماتعدّوش (وصلوا بعد ما عدّيته — أو مش موجودين)'],
           all: ['✅ كلهم وصلوا قبل ما أعدّ منتجاتهم', '🚫 كلهم ماتعدّوش'] }
};
function qBtn(k, v, pid, label, on){
  return '<button type="button" class="wh-btn wh-btn-sm' + (on ? ' on' : ' wh-btn-ghost') + '" data-wha="count-opt" data-k="' + k
    + '" data-v="' + v + '" data-pid="' + esc(pid || '') + '"' + (cntOptBusy ? ' aria-busy="true"' : '') + '>' + label + '</button>';
}
// السؤال جنب المنتج: الطرود بتاعته + زرارين + الحالة (اتجاوب · مين · طرد جديد ظهر)
function qRowHtml(k, pid, r){
  var ids = r[k + '_ids'], ans = r[k + '_ans'], need = r[k + '_need'], by = r[k + '_by'], tx = Q_TXT[k];
  if(!ids || !ids.length) return '';
  var n = ids.length;
  var h = '<div class="wh-cq' + (need ? ' need' : '') + '" data-k="' + k + '" data-pid="' + esc(pid) + '"><span class="wh-cq-t">'
    + (k === 'moved' ? '🚚 <b>' + n + '</b> طرد منه المندوب استلمهم وانت بتعدّ — كانوا لسه هنا لما عدّيته؟'
                     : '↩️ <b>' + n + '</b> مرتجع منه J&amp;T سلّمته لنا ومحدش ضربه — كان وصل المخزن لما عدّيت المنتج؟') + '</span>'
    + qListHtml(r[k + '_list'], n)
    + '<span class="wh-q-acts">' + qBtn(k, tx.yes[0], pid, tx.yes[1], ans === tx.yes[0] && !need) + qBtn(k, tx.no[0], pid, tx.no[1], ans === tx.no[0] && !need) + '</span>';
  if(ans && need) h += '<span class="wh-q-a bad">⚠️ طرد جديد ظهر بعد آخر إجابة' + (by ? ' (' + esc(by) + ')' : '') + ' — جاوب تاني</span>';
  else if(ans) h += '<span class="wh-q-a">✓ اتجاوب' + (by ? ' · ' + esc(by) : '') + '</span>';
  return h + '</div>';
}
// الشرح فوق + «جاوب للكل» (لو عدّيت كل المنتجات قبل المندوب أو بعده)
// 🔴 المنتجات اللي في القايمة بس (cntActive): منتج مش نشط مالوش صف ولا سؤال — كان بيتعدّ «فاضل 1» للأبد و«للكل»
// بتاعته كانت بتدوس الإجابات اللي اتجاوبت لكل منتج · الأحمر = منتج مكتوب عدده (هيتطبّق) لسه محتاج إجابة —
// زي wh_count_apply بالظبط (بيسأل على المنتجات اللي في العدّ بس)
function cntActive(){
  var m = {};
  (cntProducts || []).forEach(function(p){ m[p.id] = true; });
  return m;
}
function typedCount(pid){
  var v = cntDraft[pid];
  return v != null && /^\s*\d+\s*$/.test(String(v));
}
function qTopHtml(k, cp){
  var n = k === 'moved' ? cp.moved_orders : cp.ret_orders, tx = Q_TXT[k], left = 0, block = 0, all = null, same = true, act = cntActive();
  Object.keys(cp.rows).forEach(function(pid){
    var r = cp.rows[pid];
    if(!act[pid] || !r[k + '_ids'].length) return;
    if(r[k + '_need']){ left++; if(typedCount(pid)) block++; }
    var a = r[k + '_need'] ? null : r[k + '_ans'];
    if(all === null) all = a; else if(all !== a) same = false;
  });
  if(all === null && !left) return '';
  var h = '<div class="wh-count-q' + (block ? ' need' : '') + '" data-k="' + k + '"><div class="wh-q-t">'
    + (k === 'moved' ? '🚚 <b>' + n + '</b> طرد المندوب استلمهم <b>بعد ما فتحت الجرد</b> (وانت بتعدّ):'
                     : '↩️ <b>' + n + '</b> مرتجع J&amp;T سلّمته لنا (قبل الجرد أو وانت بتعدّ) <b>ومحدش ضربه مرتجع</b>:') + '</div>'
    + '<div class="wh-q-s">' + (k === 'moved'
        ? 'السؤال جنب كل منتج تحت: لما عدّيت المنتج، الطرد كان لسه هنا؟ — منتج عدّيته قبل ما المندوب ييجي = «كانوا هنا»، وبعده = «خرجوا». لو كل المنتجات زي بعض جاوب مرة واحدة:'
        : 'السؤال جنب كل منتج تحت: لما عدّيت المنتج، المرتجع كان وصل المخزن؟ — وصل قبل ما تعدّه = «كانوا هنا» (اتعدّ معاه)، وصل بعد ما عدّيته أو مش موجود = «ماتعدّوش». متضربهمش مرتجع وانت بتعدّ — اضربهم بعد ما تطبّق. لو كل المنتجات زي بعض جاوب مرة واحدة:')
    + '</div><div class="wh-q-acts">' + qBtn(k, tx.yes[0], '', tx.all[0], same && all === tx.yes[0]) + qBtn(k, tx.no[0], '', tx.all[1], same && all === tx.no[0]) + '</div>';
  h += left ? '<div class="wh-q-a' + (block ? ' bad' : ' wait') + '">❓ فاضل ' + left + ' منتج من غير إجابة'
               + (block < left ? (block ? ' (' + block + ' منهم عدده مكتوب)' : ' — مش هيوقف التطبيق غير لما تكتب عدده') : '') + '</div>'
             : '<div class="wh-q-a">✓ كل المنتجات اتجاوب عليها</div>';
  return h + '</div>';
}

// «غير موزع» = قطع متسجّلة على الأم (خاصيتها مش معروفة — لون مش في الخصائص زي «روز»). 🔴 لو فيه طرود متسجّلة
// عليه (كومة · المندوب أخدها · مرتجع) القطع دي لازم تتعدّ **هنا** مش تحت لونها — الطرح بيتعمل من المنتج اللي في
// السطر بس، فـ«اكتب 0» + القطعة تحت لونها = قطعة زيادة على اللون (والكومة بترفض الـ0 أصلاً)
function unallocHint(rq, undist){
  var n = rq ? rq.pile + rq.moved + rq.moved_leak + rq.ret : 0;
  // رصيد العيلة لسه على الأم: المخزن كان بيكتب الرقم ده هنا ويعدّ الألوان كمان = مرتين
  var ud = undistTxt(undist);
  if(!n) return '(غير موزع' + (ud ? ud + ' (أو 0)' : ' — اكتب 0 لو كل القطع على الخصائص') + ')';
  return '(غير موزع' + ud + ' — فيه <b dir="ltr">' + n + '</b> قطعة في طرود متسجّلة هنا (خاصيتها مش معروفة): اللي منها كان في المخزن وانت بتعدّ <b>اعدّها هنا مش تحت لونها</b>'
    + (rq.pile_list && rq.pile_list.length ? ' · الكومة: ' + qListHtml(rq.pile_list, rq.pile_list.length) : '') + ')';
}

// «غير موزع» عليه رصيد: all = رصيد العيلة كله على الأم · part = جزء منه لسه مااتوزّعش — كل لون معروف يتعدّ في سطره
function undistTxt(u){
  return u === 'all' ? ' — <b>الرقم ده على العيلة كلها لسه مااتوزّعش</b>: اعدّ كل لون في سطره، واكتب هنا بس اللي لونه مش معروف'
       : u === 'part' ? ' — <b>فيه قطع لسه مااتوزّعتش على الألوان</b>: اللي لونه معروف اعدّه في سطر لونه، واكتب هنا بس اللي لونه مش معروف'
       : '';
}

// المنتجات بالعيلة: الأم الأول (لو ليها خصائص = «غير موزع») وبعدها بناتها
// 🔴 الترتيب (طلب المالك 15 أكتوبر): **الأكتر في السيستم فوق والأقل تحت** — بالعيلة: العيلة بمجموعها (الأم «غير موزع»
// + خصائصها) والخصائص جوّاها من الأكتر للأقل، فألوان المنتج الواحد بتفضل جنب بعض (على الرف وفي ورقة الجرد). الترتيب
// من رقم السيستم بس — مش من اللي بيتكتب (الصف كان هيتنطّ من تحت إيد الأدمن وهو بيكتب) · نفس الترتيب في الشاشة
// والورقة (مصدر واحد) · zero = صفر في السيستم (بيتعلّم أحمر) — إلا «غير موزع» على أم ليها خصائص: صفرها الطبيعي
// (كل القطع اتوزّعت) · neg = بالسالب (أحمر دايماً)
function cntQty(p){ var n = Number(p && p.current_qty); return isFinite(n) ? n : 0; }
function cntByQty(a, b){ return cntQty(b) - cntQty(a) || String(a.name || '').localeCompare(String(b.name || ''), 'ar'); }
export function whCountFamilies(products){
  var parents = [], kids = {};
  (products || []).forEach(function(p){ if(p.parent_id) (kids[p.parent_id] = kids[p.parent_id] || []).push(p); else parents.push(p); });
  var groups = parents.map(function(p){
    var k = (kids[p.id] || []).slice().sort(cntByQty), tot = cntQty(p);
    k.forEach(function(c){ tot += cntQty(c); });
    return { p: p, k: k, tot: tot, orphan: false };
  });
  // بنت أمها مش نشطة/مش موجودة — تتعرض برضه (الجرد لازم يغطي كل النشط) — عيلة لوحدها في مكانها بالرقم
  (products || []).forEach(function(p){
    if(p.parent_id && !parents.some(function(x){ return x.id === p.parent_id; })) groups.push({ p: p, k: [], tot: cntQty(p), orphan: true });
  });
  groups.sort(function(a, b){ return b.tot - a.tot || String(a.p.name || '').localeCompare(String(b.p.name || ''), 'ar'); });
  var out = [];
  groups.forEach(function(g){
    var un = g.k.length > 0, q = cntQty(g.p);
    // 🔴 رصيد العيلة كله على الأم (لسه مااتوزّعش — «تيربو بريمو» 43 والخصائص 0 على الحي): صفر الخصائص مش «دوّر عليه» —
    // القطع موجودة بس مسجّلة على الأم. الأم عليها undist = «الرقم ده على العيلة كلها» (من غيره المخزن بيكتب 43 على الأم
    // ويعدّ الألوان كمان = مرتين)
    var allOnParent = un && q > 0 && g.k.every(function(c){ return cntQty(c) === 0; });
    out.push({ p: g.p, unalloc: un, child: g.orphan, zero: !un && q === 0, neg: q < 0, undist: un && q > 0 ? (allOnParent ? 'all' : 'part') : '' });
    g.k.forEach(function(c){ var cq = cntQty(c); out.push({ p: c, unalloc: false, child: true, zero: cq === 0 && !allOnParent, neg: cq < 0 }); });
  });
  return out;
}

// 🔴 الترتيب بيتجمّد لكل جرد (أول رسم) — الأرقام بتتحرك (سكان · تعديل من المخزون) و↻ كان بيعيد الترتيب: الورقة المطبوعة
// والشاشة كانوا هيختلفوا، واللي بيكتب من الورقة بالـEnter كان هيحط عدد منتج في سطر منتج تاني. order = pids بالترتيب
// المتجمّد · اللي مش فيه (منتج اتضاف بعد ما الجرد اتفتح): الخاصية بعد آخر سطر في عيلتها، والباقي في الآخر بترتيبه
export function whCountFreeze(fam, order){
  if(!Array.isArray(order) || !order.length) return fam.slice();
  var pos = {};
  order.forEach(function(id, i){ if(pos[id] == null) pos[id] = i; });
  var known = fam.filter(function(f){ return pos[f.p.id] != null; }).sort(function(a, b){ return pos[a.p.id] - pos[b.p.id]; });
  fam.forEach(function(f){
    if(pos[f.p.id] != null) return;
    var par = f.child && f.p.parent_id, at = -1;
    if(par) known.forEach(function(k, i){ if(k.p.id === par || (k.p.parent_id && k.p.parent_id === par)) at = i; });
    if(at >= 0) known.splice(at + 1, 0, f); else known.push(f);
  });
  return known;
}

// ── ورقة الجرد للطباعة (طلب المالك 15 أكتوبر — «يراجعوا بيها وهما واقفين وبعدها يسجلوا») ──
// نفس صفوف الشاشة بالظبط وبنفس الرقم # (rows = cntRows المتجمّد) · رقم السيستم + الكومة (الطرود اللي اتضربت خروج ولسه
// هنا — لازم تتعدّ معاهم) + خانة فاضية للعدد وخانة للملاحظات · الصفر/السالب مضلّل وعليه ⚠ (الطابعة الأبيض والأسود
// مابتفرّقش الأحمر) · كل الأسامي متهرّبة (esc)
var SHEET_CSS = '@page{size:A4 portrait;margin:11mm 9mm 12mm;@bottom-center{content:"صفحة " counter(page) " من " counter(pages);font:400 8pt "Cairo",Arial,sans-serif}}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}'
  + 'body{direction:rtl;font-family:"Cairo","Liberation Sans",Arial,sans-serif;font-size:10.5pt;line-height:1.35}'
  + '.sh-bar{display:none}.sh-head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:.5mm solid #000;padding-bottom:2.2mm;margin-bottom:2.5mm}'
  + '.sh-head h1{margin:0 0 .6mm;font-size:16pt;font-weight:800;line-height:1.2}.sh-meta{font-size:9pt;line-height:1.6}.sh-meta b{font-weight:800}.sh-side{text-align:left;font-size:9pt;line-height:1.6;white-space:nowrap}'
  + '.sh-tips{margin:0 0 2.2mm;padding:0 5mm 0 0;font-size:8.8pt;line-height:1.55}.sh-tips b{font-weight:800}'
  + '.sh-inc{border:.4mm dashed #000;padding:1.6mm 2.5mm;margin:0 0 2.8mm;font-size:8.8pt;line-height:1.9;break-inside:avoid}.sh-inc b{font-weight:800}'
  + 'table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}'
  + 'th,td{border:.3mm solid #000;padding:1.2mm 1.8mm;vertical-align:middle;height:9.5mm}th{height:auto;background:#e5e7eb;font-size:8.8pt;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
  + '.c-n{width:8mm;text-align:center;font:700 9pt "Liberation Sans",Arial,sans-serif}.c-sys,.c-pile{width:19mm;text-align:center}.c-cnt{width:27mm}.c-note{width:40mm}'
  + 'td.c-sys,td.c-pile{font:800 12pt "Liberation Sans",Arial,sans-serif}td.c-name{font-weight:700;overflow-wrap:anywhere}td.c-name small{display:block;font-weight:400;font-size:8pt;line-height:1.4}td.c-name small b{font-weight:800}'
  + 'tr.kid td.c-name{padding-right:7mm}tr.kid td.c-name::before{content:"↳ ";font-weight:400}'
  + 'tr.zero td{background:#fde2e2;-webkit-print-color-adjust:exact;print-color-adjust:exact}tr.zero td.c-sys{color:#b91c1c}tr.zero td.c-sys::after{content:" ⚠";font-size:9pt}'
  + '.sh-foot{margin-top:5mm;display:grid;grid-template-columns:1fr 1fr;gap:5mm 10mm;font-size:10pt;break-inside:avoid}.sh-foot div{border-bottom:.3mm solid #000;padding-bottom:5mm}'
  + '@media screen{body{background:#9ca3af;padding:6mm}.sheet{max-width:210mm;margin:0 auto;background:#fff;padding:10mm 9mm;box-shadow:0 0 3mm rgba(0,0,0,.35)}'
  + '.sh-bar{display:block;max-width:210mm;margin:0 auto 4mm;padding:2.5mm 4mm;border-radius:2mm;background:#fff7ed;border:.3mm solid #fdba74;font-size:10pt}}';

// o = {count, rows (cntRows) أو products, pile (cntPile), store, openedTxt, dataTxt (وقت الأرقام), printedTxt, fontCss}
export function whCountSheetHtml(o){
  o = o || {};
  var c = o.count || {}, fam = o.rows || whCountFamilies(o.products || []), cp = o.pile || null;
  var rowOf = function(pid){ return (cp && cp.rows && cp.rows[pid]) || null; };
  var pileOf = function(pid){ var r = rowOf(pid); return r ? Number(r.pile) || 0 : 0; };
  var showPile = fam.some(function(f){ return pileOf(f.p.id) > 0; });
  var zeros = fam.filter(function(f){ return f.zero || f.neg; }).length;
  var unPile = fam.some(function(f){ var r = f.unalloc && rowOf(f.p.id); return r && (r.pile + r.moved + r.moved_leak + r.ret) > 0; });
  var num = function(n){ return '<span dir="ltr">' + esc(String(n)) + '</span>'; };
  var h = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + esc('ورقة جرد المخزن' + (c.id ? ' #' + c.id : '')) + '</title>'
    + '<style>' + (o.fontCss || '') + SHEET_CSS + '</style></head><body>'
    + '<div class="sh-bar">🖨️ ورقة الجرد جاهزة — لو نافذة الطباعة مافتحتش لوحدها دوس <b dir="ltr">Ctrl + P</b> (من الموبايل: قايمة المتصفح ← مشاركة ← طباعة).</div><div class="sheet">'
    + '<div class="sh-head"><div><h1>📋 ورقة جرد المخزن' + (o.store ? ' — ' + esc(o.store) : '') + '</h1>'
    + '<div class="sh-meta">جرد رقم <b>' + num(c.id || '—') + '</b> · اتفتح ' + esc(o.openedTxt || '—') + (c.opened_by_name ? ' · ' + esc(c.opened_by_name) : '') + '</div>'
    + '<div class="sh-meta"><b>' + num(fam.length) + '</b> سطر · مترتبين من الأكتر للأقل في السيستم' + (zeros ? ' · <b>' + num(zeros) + '</b> صفر/بالسالب في السيستم (⚠)' : '') + '</div></div>'
    + '<div class="sh-side">أرقام السيستم: ' + esc(o.dataTxt || o.printedTxt || '') + '<br>اتطبعت: ' + esc(o.printedTxt || '') + '</div></div>'
    + '<ol class="sh-tips">'
    + '<li>اعدّ <b>كل القطع اللي في المخزن فعلاً</b> — بما فيها الطرود المتغلّفة اللي لسه ماخرجتش.</li>'
    + (showPile ? '<li>عمود <b>«في الكومة»</b> = قطع في طرود اتضربت خروج ولسه هنا — <b>اعدّها مع الباقي</b> (السيستم بيطرحها لوحده).</li>' : '')
    + '<li>المنتج اللي ليه ألوان/مقاسات: اكتب <b>كل لون في سطره</b> (↳) — «غير موزع» للقطع اللي خاصيتها مش معروفة بس'
    + (unPile ? '، <b>والطرود المكتوب قدامها «اعدّها هنا»</b> (متسجّلة عليه — حتى لو لونها باين)' : '') + '.</li>'
    + (zeros ? '<li>السطر المضلّل (⚠) = <b>صفر أو بالسالب في السيستم</b> — دوّر عليه كويس؛ لو لقيت منه حاجة اكتبها.</li>' : '')
    + '<li>لما تخلص: اكتب كل عدد على السيستم <b>قدّام نفس الرقم (#) والاسم</b> — الترتيب على الشاشة هو نفسه — وبعدين «طبّق الجرد».</li></ol>'
    // 🔴 السيستم بيسأل لكل منتج «كانوا هنا لما عدّيته؟» لو المندوب استلم أو وصل مرتجع وانت بتعدّ — الإجابة محتاجة الساعة وآخر سطر
    + '<div class="sh-inc">⏱️ وانت بتعدّ: الأحسن <b>متسلّمش طرود للمندوب ولا تستلم مرتجعات</b> (المرتجع يتضرب بعد ما الجرد يتطبّق). ولو حصل، اكتب هنا:<br>'
    + '🚚 المندوب استلم الساعة ________ وكنا عدّينا لحد سطر # ______ &nbsp;&nbsp; ↩️ وصل مرتجع الساعة ________ وكنا عدّينا لحد سطر # ______</div>'
    + '<table><thead><tr><th class="c-n">#</th><th class="c-name">المنتج</th><th class="c-sys">السيستم</th>'
    + (showPile ? '<th class="c-pile">في الكومة</th>' : '') + '<th class="c-cnt">العدد الفعلي</th><th class="c-note">ملاحظات</th></tr></thead><tbody>';
  fam.forEach(function(f, i){
    var p = f.p, q = cntQty(p), pl = pileOf(p.id), rq = rowOf(p.id);
    var cls = [f.child ? 'kid' : '', f.unalloc ? 'un' : '', (f.zero || f.neg) ? 'zero' : ''].filter(Boolean).join(' ');
    var note = '';
    if(f.unalloc){
      var un = rq ? rq.pile + rq.moved + rq.moved_leak + rq.ret : 0;
      note = '<small>(غير موزع'
        + (f.undist ? undistTxt(f.undist) + ' (أو 0)' : '')
        + (un ? ' — فيه <b>' + num(un) + '</b> قطعة في طرود متسجّلة هنا: <b>اعدّها في السطر ده مش تحت لونها</b>'
               + (rq.pile_list && rq.pile_list.length ? ' · الكومة: ' + qListHtml(rq.pile_list, rq.pile_list.length) : '') : '') + ')</small>';
    }
    h += '<tr' + (cls ? ' class="' + cls + '"' : '') + ' data-pid="' + esc(p.id) + '"><td class="c-n">' + (i + 1) + '</td>'
      + '<td class="c-name">' + esc(p.name || '') + note + '</td>'
      + '<td class="c-sys">' + num(q) + '</td>'
      + (showPile ? '<td class="c-pile">' + (pl ? num(pl) : '') + '</td>' : '')
      + '<td class="c-cnt"></td><td class="c-note"></td></tr>';
  });
  h += '</tbody></table>'
    + '<div class="sh-foot"><div>اللي عدّ: </div><div>التوقيع: </div><div>اللي راجع: </div><div>اتسجّل على السيستم الساعة: </div></div>'
    + '</div></body></html>';
  return h;
}

// pile = {pid: qty} — القطع اللي في طرود اتضربت خروج ولسه هنا: العدّ بيشملها والسيستم خاصمها، فالرقم
// الجديد = المعدود − الكومة (نفس wh_count_apply بالحرف)
export function whCountPayload(products, draft, pile){
  var counts = [], missing = 0, changed = [], short = [];
  (products || []).forEach(function(p){
    var v = draft ? draft[p.id] : undefined;
    var s = v == null ? '' : String(v).trim();
    if(s === ''){ missing++; return; }
    if(!/^\d+$/.test(s)) { missing++; return; }
    var n = parseInt(s, 10);
    counts.push({ product_id: p.id, counted: n });
    var pq = (pile && pile[p.id]) || 0;
    if(n < pq) short.push({ p: p, counted: n, pile: pq });
    var cur = Number(p.current_qty || 0);
    if(n - pq !== cur) changed.push({ p: p, from: cur, to: n - pq });
  });
  return { counts: counts, missing: missing, changed: changed, short: short };
}

// الرسم بيحافظ على خانة العدّ اللي في إيد الأدمن (الكارسر مكانه) — التحميل بيخلص وهو بيكتب
function renderCount(){
  var el = $id('wh-count'); if(!el) return;
  var ae = document.activeElement, keep = null, keepBtn = null;
  if(ae && el.contains(ae) && ae.classList && ae.classList.contains('wh-ci')){
    keep = { pid: ae.getAttribute('data-pid'), s: ae.selectionStart, e: ae.selectionEnd };
  } else if(ae && el.contains(ae) && ae.getAttribute && ae.getAttribute('data-wha') === 'count-opt'){
    // زرار الإجابة اتداس بالكيبورد — الرسم بيشيله من الـDOM والفوكس كان بيروح للـbody
    keepBtn = { k: ae.getAttribute('data-k'), v: ae.getAttribute('data-v'), pid: ae.getAttribute('data-pid') || '' };
  }
  renderCountBody(el);
  if(keep && keep.pid){
    var n = null, all = el.querySelectorAll('.wh-ci');
    for(var i = 0; i < all.length; i++) if(all[i].getAttribute('data-pid') === keep.pid){ n = all[i]; break; }
    if(n){ n.focus(); try{ n.setSelectionRange(keep.s, keep.e); }catch(er){ /* */ } }
  } else if(keepBtn){
    var bs = el.querySelectorAll('[data-wha="count-opt"]');
    for(var j = 0; j < bs.length; j++){
      var b = bs[j];
      if(b.getAttribute('data-k') === keepBtn.k && b.getAttribute('data-v') === keepBtn.v && (b.getAttribute('data-pid') || '') === keepBtn.pid){
        try{ b.focus({ preventScroll: true }); }catch(er){ b.focus(); }
        break;
      }
    }
  }
}

function renderCountBody(el){
  if(cntLoading && !cntProducts){ el.innerHTML = '<div class="wh-empty">بنحمّل…</div>'; return; }
  if(cntErr && !cntProducts){ el.innerHTML = '<div class="wh-empty">مقدرناش نحمّل. <button type="button" class="wh-btn wh-btn-ghost" data-wha="count-reload">↻ حاول تاني</button></div>'; return; }
  if(!cntProducts){ el.innerHTML = ''; return; }
  var enabled = !!(board && board.enabled), base = board && board.baseline_at;
  var h = settingsHtml(enabled, base);
  if(!cnt){
    // مطوي: الطريق العادي هو «▶️ شغّل السكانر» فوق وتظبيط الأرقام من المخزون — الجرد الكامل لما تحب تعدّ كله مرة واحدة
    h += '<details class="wh-count-adv"' + (cntAdvOpen ? ' open' : '') + '><summary>🧮 جرد كامل للمخزن (اختياري)</summary>'
      + '<div class="wh-count-intro">'
      + (base ? '<p>بداية السكان: ' + esc(whenTxt(base)) + '. تقدر تعمل جرد في أي وقت — الفرق بيتسجّل حركة «جرد».</p>'
              : '<p>بدل ما تظبط الأرقام بإيدك من المخزون: تقدر تعدّ كل منتج هنا، و<b>«جرد التشغيل»</b> بيبدأ السكان من لحظة فتح الجرد.</p>')
      + (base
        // 🔴 الجرد الدوري: الطرود اللي في الكومة اتخصمت خلاص — السيستم بيطرحها من العدّ لوحده، والمرتجع اللي
        // ماتضربش كان هيتضاف مرتين (مرة في العدّ ومرة لما يتضرب)
        ? '<ol class="wh-steps">'
          + '<li>اضرب كل المرتجعات اللي وصلت <b>الأول</b> — قايمة «🚨 J&amp;T قالت سلّمتها ومش متسجلة» لازم تبقى فاضية.</li>'
          + '<li>افتح الجرد وعدّ <b>كل القطع اللي في المخزن فعلاً — بما فيها الطرود المتغلّفة في الكومة</b> (اللي اتضربت خروج السيستم بيطرحها من العدّ لوحده). 🖨️ «اطبع ورقة الجرد» = نفس القايمة على ورق، المخزن يعدّ عليها وهما واقفين.</li>'
          + '<li>وانت بتعدّ: الأحسن <b>متسلّمش طرود للمندوب ولا تستلم مرتجعات</b> — ولو حصل، السيستم هيسألك جنب كل منتج «كانوا هنا لما عدّيته؟». الطرد اللي تضربه خروج وانت بتعدّ عادي (بيتحسب مع الكومة) · <b>المرتجع اضربه بعد ما تطبّق</b>.</li>'
          + '<li>اكتب العدد لكل منتج هنا، وبعدين «طبّق الجرد».</li></ol>'
        : '<ol class="wh-steps">'
          + '<li>اربط المنتجات الأول (تاب «🔗 ربط المنتجات») — لحد ما «مش مربوط» تبقى صفر أو قريبة منه.</li>'
          + '<li>اختار وقت مفيش فيه تسليم للمندوب (مثلاً الصبح بدري). افتح الجرد، وعدّ <b>كل القطع اللي في المخزن — بما فيها الطرود المتغلّفة اللي المندوب لسه ماستلمهاش</b> (دي هتتخصم لما تتضرب خروج). 🖨️ «اطبع ورقة الجرد» = نفس القايمة على ورق، المخزن يعدّ عليها وهما واقفين.</li>'
          + '<li>اكتب العدد لكل منتج هنا، وبعدين «طبّق الجرد» مع «ده جرد التشغيل».</li>'
          + '<li>من بعدها: كل طرد خارج يتضرب، وكل مرتجع يتضرب أول ما يوصل.</li></ol>')
      + '<button type="button" class="wh-btn wh-btn-main" data-wha="count-open"' + (cntBusy ? ' disabled' : '') + '>🧮 افتح جرد جديد</button>'
      + '</div>' + histHtml() + '</details>';
    el.innerHTML = h;
    return;
  }
  var fam = cntRows();
  var pmap = pileMap();
  var pay = whCountPayload(cntProducts, cntDraft, pmap);
  if(cntGoLiveFor !== cnt.id){ cntGoLive = !base; cntGoLiveFor = cnt.id; }
  var zeroN = fam.filter(function(f){ return f.zero || f.neg; }).length;
  h += '<div class="wh-count-head"><div><h3>🧮 جرد مفتوح</h3><p>اتفتح ' + esc(whenTxt(cnt.opened_at)) + (cnt.opened_by_name ? ' · ' + esc(cnt.opened_by_name) : '')
    + '. اكتب العدد الحقيقي لكل منتج — الكلام بيتحفظ على الجهاز ده لحد ما تطبّق.'
    // القاعدة دي كانت بتظهر قبل ما الجرد يتفتح بس — والأسئلة «كانوا هنا لما عدّيته؟» بتطلع بعده
    + ' وانت بتعدّ: متسلّمش للمندوب ولا تستلم مرتجعات (المرتجع اضربه بعد ما تطبّق) — ولو حصل، السيستم هيسألك جنب كل منتج «كانوا هنا لما عدّيته؟» (الورقة فيها مكان للساعة وآخر سطر اتعدّ).</p>'
    + '<p class="wh-count-order">مترتبين من الأكتر للأقل في السيستم (ألوان المنتج جنب بعض) — الترتيب بيتثبّت أول ما الجرد يظهر على الجهاز ده ومابيتغيّرش لحد ما تطبّق حتى لو الأرقام اتحرّكت، والرقم # هو نفسه في الورقة اللي تطبعها من هنا'
    + (zeroN ? ' · <span class="wh-zero-key">' + zeroN + ' صفر/بالسالب في السيستم</span> — دوّر عليهم كويس قبل ما تكتب 0' : '') + '.</p></div>'
    + '<div class="wh-count-prog"><b>' + (cntProducts.length - pay.missing) + '</b> من ' + cntProducts.length + ' اتعدّوا'
    + ' <button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wha="count-reload" title="هات أرقام السيستم من جديد ومنتجات اتضافت — اللي كتبته بيفضل">↻</button></div>'
    + '<div class="wh-count-print"><button type="button" class="wh-btn" data-wha="count-print" title="ورقة A4 بنفس الترتيب والرقم # — المخزن يعدّ عليها وهما واقفين وبعدين تكتب الأرقام هنا">🖨️ اطبع ورقة الجرد</button>'
    + '<span class="wh-hint">بتجيب أرقام السيستم من جديد قبل الطباعة.</span></div></div>';
  var cp = cntPile && cntPile.count_id === cnt.id ? cntPile : null;
  if(cntPileErr){
    h += '<div class="wh-count-warn bad">⚠️ مقدرناش نجيب الطرود اللي في الكومة والأسئلة — الأرقام والفرق هنا ناقصين، و«طبّق» مقفول لحد ما تتحمّل.'
      + ' <button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wha="count-reload">↻ حاول تاني</button></div>';
  }
  if(cp && (cp.pile_orders || cp.moved_orders || cp.ret_orders)){
    // الأسئلة على منتجات مش في القايمة بس = qTopHtml فاضي — من غير الشرط ده كان صندوق برتقاني فاضي
    var wq = (cp.pile_orders ? '<div>📦 فيه <b>' + cp.pile_orders + '</b> طرد اتضربوا خروج ولسه في المخزن (الكومة) — <b>اعدّهم مع الباقي</b>، والسيستم بيطرحهم من العدّ لوحده (الرقم جنب كل منتج).</div>' : '')
      + (cp.moved_orders ? qTopHtml('moved', cp) : '')
      + (cp.ret_orders ? qTopHtml('ret', cp) : '');
    if(wq) h += '<div class="wh-count-warn">' + wq + '</div>';
  }
  h += '<div class="wh-count-list">';
  fam.forEach(function(f, fi){
    var p = f.p, v = cntDraft[p.id];
    var s = v == null ? '' : String(v);
    var diff = '', pq = pmap[p.id] || 0, rq = cp && cp.rows[p.id];
    // قطع المنتج ده في طرود لسه السؤال عليها مااتجاوبش — الرقم جنبه لسه ممكن يتغيّر
    var qn = rq ? (rq.moved_need ? rq.moved + rq.moved_leak : 0) + (rq.ret_need ? rq.ret : 0) : 0;
    if(cntPreview && s !== '' && /^\d+$/.test(s.trim())){
      var d = parseInt(s, 10) - pq - Number(p.current_qty || 0);
      diff = d === 0 ? '<span class="wh-cd zero">=</span>' : '<span class="wh-cd ' + (d > 0 ? 'up' : 'down') + '" dir="ltr">' + (d > 0 ? '+' : '') + d + '</span>';
    }
    var red = f.zero || f.neg;
    h += '<div class="wh-count-row' + (f.child ? ' child' : '') + (red ? ' zero' : '') + '">'
      + '<span class="wh-cno" dir="ltr" title="نفس الرقم في ورقة الجرد">#' + (fi + 1) + '</span>'
      + '<span class="wh-cn">' + (f.child ? '↳ ' : '') + esc(p.name) + (f.unalloc ? ' <small>' + unallocHint(rq, f.undist) + '</small>' : '') + '</span>'
      + '<span class="wh-cs" title="' + (f.neg ? 'بالسالب في السيستم — اتخصم أكتر من اللي اتسجّل' : red ? 'صفر في السيستم — اتأكد إنه مش موجود فعلاً' : 'الرقم في السيستم دلوقتي') + '">'
      + (red ? '⚠ ' : '') + 'السيستم ' + '<span dir="ltr">' + esc(String(cntQty(p))) + '</span>' + (f.neg ? ' (بالسالب)' : '') + '</span>'
      + '<input class="wh-ci" type="text" inputmode="numeric" data-pid="' + esc(p.id) + '" value="' + esc(s) + '" placeholder="العدد" autocomplete="off">'
      + (pq ? '<span class="wh-cpile" title="قطع في طرود اتضربت خروج ولسه هنا — اعدّها مع الباقي، وبتتطرح من العدّ">📦 منهم <span dir="ltr">' + pq + '</span> في الكومة</span>' : '')
      + (qn ? '<span class="wh-cpile q" title="قطع في طرود عليها سؤال تحت لسه مااتجاوبش">❓ <span dir="ltr">' + qn + '</span> مستنية إجابتك</span>' : '')
      + diff + (rq ? qRowHtml('moved', p.id, rq) + qRowHtml('ret', p.id, rq) : '') + '</div>';
  });
  h += '</div>';
  var golive = !enabled;
  h += '<div class="wh-count-foot">'
    + (golive ? '<label class="wh-check"><input type="checkbox" id="wh-golive"' + (cntGoLive ? ' checked' : '') + '> ده <b>جرد التشغيل</b> — السكان يبدأ يخصم من لحظة فتح الجرد (' + esc(whenTxt(cnt.opened_at)) + ')</label>' : '')
    + '<div class="wh-count-acts">'
    + '<button type="button" class="wh-btn wh-btn-ghost" data-wha="count-preview">' + (cntPreview ? '🙈 اخفي الفرق' : '👀 وريني الفرق') + '</button>'
    + '<button type="button" class="wh-btn wh-btn-main" data-wha="count-apply"' + (cntBusy ? ' disabled' : '') + '>✅ طبّق الجرد</button>'
    + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-danger" data-wha="count-cancel"' + (cntBusy ? ' disabled' : '') + '>✖ الغي الجرد</button>'
    + '</div>'
    + (pay.changed.length ? '<div class="wh-hint">' + pay.changed.length + ' منتج رقمه هيتغيّر.</div>' : '')
    + (pay.short.length ? '<div class="wh-hint bad">⚠️ ' + pay.short.length + ' منتج العدد اللي اتكتب أقل من اللي في الكومة — الكومة لازم تتعدّ معاه.</div>' : '')
    + '</div>';
  h += histHtml();
  el.innerHTML = h;
}

function histHtml(){
  if(!cntHist.length) return '';
  var h = '<div class="wh-count-hist"><h4>الجرد اللي فات</h4>';
  cntHist.forEach(function(x){
    h += '<div>' + (x.go_live ? '🟢 جرد تشغيل' : '🧮 جرد') + ' · اتفتح ' + esc(whenTxt(x.opened_at)) + ' · اتطبّق ' + esc(whenTxt(x.applied_at))
      + (x.applied_by_name ? ' · ' + esc(x.applied_by_name) : '') + '</div>';
  });
  return h + '</div>';
}

function settingsHtml(enabled, base){
  var hold = !board || board.hold_cancel_requested !== false;
  var h = '<div class="wh-set"><h3>⚙️ تشغيل السكانر</h3>';
  if(base){
    h += '<div class="wh-set-row">' + (enabled ? '🟢 شغّال من ' + esc(whenTxt(base)) + ' — كل سكان بيغيّر الحالة ويحرّك المخزون' : '⏸️ متوقف — السكان بيرجع وضع تجربة (مابيغيّرش حالة ولا مخزون)')
      + ' <button type="button" class="wh-btn wh-btn-ghost" data-wha="cfg-toggle" data-en="' + (enabled ? '0' : '1') + '"' + (cfgBusy ? ' aria-busy="true"' : '') + '>' + (enabled ? '⏸️ وقّفه' : '▶️ شغّله') + '</button></div>'
      // تذكير دايم بعد التشغيل — الاتنين اللي بيبوّظوا الأرقام في صمت
      + '<div class="wh-hint bad">🔴 صفحة المرتجعات وسكانر التلجرام في n8n لازم يفضلوا واقفين — صفحة n8n بتعلّم المرتجع من غير ما المخزون يرجع.</div>'
      + '<div class="wh-hint">✏️ تصحيح رقم منتج: من «المخزون» — اكتب اللي على الرف بس (الطرود اللي اتضربت خروج ولسه في الكومة اتخصمت خلاص) · أو اعمل جرد كامل تحت (بيطرح الكومة لوحده).</div>';
  } else {
    h += '<div class="wh-set-row">🧪 وضع تجربة — السكان بيقولك النتيجة بس، مابيغيّرش الحالة ولا المخزون.</div>'
      + '<ol class="wh-steps">'
      + '<li>🔗 اربط المنتجات (تاب «ربط المنتجات») لحد ما «❌ مش مربوط» و«⚠️ راجع» يبقوا صفر — المنتج المش مربوط مابيتخصمش، و«راجع» = مقاس ممكن يتخصم من منتج غلط.</li>'
      + '<li>↩️ مرتجعات «🚨 ناقص» (J&amp;T قالت سلّمتها ومحدش سجّلها): اللي وصل فعلاً سجّله في صفحة n8n <b>قبل</b> التشغيل — بعد التشغيل اضربه هنا.</li>'
      + '<li>📦 ظبط أرقام المخزون من صفحة «المخزون»: اكتب <b>كل اللي في المخزن فعلاً</b> — حتى الطرود المتغلّفة اللي لسه ماخرجتش (دي هتتخصم لما تتضرب خروج). المنتج اللي ليه ألوان/مقاسات: اكتب العدد على <b>كل خاصية</b> (✏️ على صفها أو ⬅ توزيع) — «غير موزع» للي خاصيته مش معروفة بس.</li>'
      + '<li>▶️ اضغط «شغّل السكانر» <b>في نفس القعدة</b> — ومايكونش في النص استلام مندوب J&amp;T (بيستلم العصر) ولا مرتجعات (بتوصل الضهر): أي طرد خرج أو مرتجع وصل بين ظبط الأرقام والتشغيل مش هيتحسب صح.</li>'
      + '<li>🔴 في نفس اللحظة: وقّف سكانر التلجرام القديم وصفحة المرتجعات في n8n بإيدك — صفحة n8n بتعلّم المرتجع من غير ما المخزون يرجع، والسكانر القديم بيخصم مرتين.</li></ol>'
      + '<button type="button" class="wh-btn wh-btn-main" data-wha="cfg-start"' + (cfgBusy ? ' aria-busy="true"' : '') + '>▶️ شغّل السكانر من دلوقتي</button>';
  }
  h += '<label class="wh-check"><input type="checkbox" id="wh-hold"' + (hold ? ' checked' : '') + '> امنع خروج الطرد لو العميل طالب إلغاء ولسه الطلب ماتحسمش</label>';
  return h + '</div>';
}

// 🔴 النافذة بتتفتح **جوّه الضغطة** (من غير await قبلها) — حاجب النوافذ بيسمح بس لنافذة من ضغطة المستخدم · about:blank
// بترث CSP اللوحة: مفيش script جوّه الورقة — اللوحة هي اللي بتكتب وبتطبع (نفس بوليصة J&T) · الأرقام بتتجاب من جديد
// **قبل** ما الورقة تتكتب (الورقة كانت بتطلع بأرقام لحظة دخول التاب ومختومة بوقت الطباعة) · الكومة مااتحمّلتش والسكان
// شغّال = ممنوع (الورقة كانت هتطلع من غير «في الكومة» والمخزن يعدّ الطرود المتغلّفة من غير ما يعرف إنها هتتطرح)
var PRINT_WAIT = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ورقة الجرد</title></head>'
  + '<body style="font:16px Arial,sans-serif;direction:rtl;padding:24px">⏳ بنجهّز ورقة الجرد بأحدث أرقام…</body></html>';
function printMsg(win, txt){
  try{ var d = win.document; d.open(); d.write(PRINT_WAIT.replace('⏳ بنجهّز ورقة الجرد بأحدث أرقام…', esc(txt))); d.close(); }catch(e){ swallow('wh-admin/print.msg', e); }
}
function countPrint(){
  if(!cnt || !cntProducts || cntPrinting) return;
  var win = null;
  try{ win = window.open('', '_blank'); }catch(e){ swallow('wh-admin/print.open', e); }
  if(!win){ toast('المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة (Pop-ups) للوحة وجرّب تاني', 'er'); return; }
  try{ var d0 = win.document; d0.open(); d0.write(PRINT_WAIT); d0.close(); }catch(e){ swallow('wh-admin/print.wait', e); }
  var cid = cnt.id;
  cntPrinting = true;
  loadCount(function(ok){
    cntPrinting = false;
    if(win.closed) return;
    if(!ok || !cnt || !cntProducts){ printMsg(win, 'مقدرناش نجيب أرقام السيستم — اقفل النافذة دي ودوس «🖨️ اطبع ورقة الجرد» تاني.'); toast('مقدرناش نجيب الأرقام — جرّب تاني', 'er'); return; }
    if(cnt.id !== cid){ printMsg(win, 'الجرد ده اتقفل (اتطبّق أو اتلغى من جهاز تاني) — ارجع للوحة.'); return; }
    if(cntPileErr && !(board && board.enabled === false)){
      printMsg(win, 'مقدرناش نجيب الطرود اللي في الكومة — اقفل النافذة دي، دوس ↻ في الجرد وبعدين اطبع.');
      toast('مقدرناش نجيب الطرود اللي في الكومة — دوس ↻ الأول وبعدين اطبع', 'er'); return;
    }
    var now = whenTxt(new Date().toISOString());
    var html = whCountSheetHtml({ count: cnt, rows: cntRows(), pile: cntPile && cntPile.count_id === cnt.id ? cntPile : null,
      store: (currentTenant && (currentTenant.store_name || currentTenant.name)) || '', openedTxt: whenTxt(cnt.opened_at),
      dataTxt: now, printedTxt: now, fontCss: fontCss() });
    var doc = win.document;
    doc.open(); doc.write(html); doc.close();
    var done = false;
    var go = function(){ if(done) return; done = true; try{ win.focus(); win.print(); }catch(e){ swallow('wh-admin/print', e); } };
    // الخطوط لازم تكون اتحمّلت قبل الطباعة (Cairo) — وإلا الورقة بتطلع بخط احتياطي · سقف 4ث (فترة الحجب عند المتصفح 3ث)
    try{ if(doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function(){ setTimeout(go, 120); }, go); else setTimeout(go, 250); }catch(e){ go(); }
    setTimeout(go, 4000);
  });
}

function countOpen(){
  if(cntBusy) return;
  cntBusy = true; renderCount();
  sb.rpc('wh_count_open', { p_note: null }).then(function(r){
    cntBusy = false;
    var d = (r && !r.error && r.data) || { ok: false };
    if(!d.ok){ toast('مقدرناش نفتح الجرد', 'er'); renderCount(); return; }
    toast(d.code === 'count_open_exists' ? 'فيه جرد مفتوح بالفعل — كمّل فيه' : 'اتفتح الجرد ✓ — ابدأ عدّ', 'ok');
    loadCount();
  });
}

// القفل في الكود مش disabled على الزرار (درس 54 — الفوكس) · pid فاضي = كل المنتجات اللي عليها السؤال ده.
// 🔴 بيبعت **الطرود اللي اتعرضت** (ids) — طرد ظهر بعد ما الشاشة اترسمت مايتجاوبش عليه في صمت (السيرفر بيرجّع changed)
function countOpt(k, v, pid){
  if(cntOptBusy || !cnt || !cntPile || cntPile.count_id !== cnt.id || (k !== 'moved' && k !== 'ret') || !v) return;
  var rows = cntPile.rows || {}, m = {}, n = 0, act = cntActive();
  Object.keys(rows).forEach(function(id){
    if(pid && id !== pid) return;
    if(!pid && !act[id]) return;   // «للكل» = المنتجات اللي قدامك بس
    var ids = rows[id][k + '_ids'];
    if(!ids || !ids.length) return;
    m[id] = { v: v, ids: ids.slice() }; n++;
  });
  if(!n) return;
  var o = {}; o[k] = m;
  var cid = cnt.id;
  cntOptBusy = true; renderCount();
  sb.rpc('wh_count_opts', { p_count_id: cid, p_opts: o }).then(function(r){
    cntOptBusy = false;
    var d = (r && !r.error && r.data) || { ok: false };
    if(!d.ok){ toast(d.code === 'not_found' ? 'الجرد ده اتقفل — هات الجديد' : 'مقدرناش نحفظ الإجابة — حاول تاني', 'er'); loadCount(); return; }
    if(cntPile && cntPile.count_id === cid){
      Object.keys(m).forEach(function(id){ var r2 = cntPile.rows[id]; if(r2 && d.code !== 'changed'){ r2[k + '_ans'] = v; r2[k + '_need'] = false; } });
    }
    renderCount();
    if(d.code === 'changed') toast('فيه طرود جديدة ظهرت وانت بتجاوب — جاوب عليها هي كمان', 'er');
    loadCount();   // اللي في الكومة ممكن يكون اتغيّر وقت الإجابة — السيرفر بيقول مين لسه محتاج إجابة
  }, function(){ cntOptBusy = false; toast('مقدرناش نحفظ الإجابة — حاول تاني', 'er'); renderCount(); });
}

function prodName(id){
  var ps = cntProducts || [];
  for(var i = 0; i < ps.length; i++) if(ps[i].id === id) return ps[i].name || '';
  return '';
}

function countApply(force){
  if(cntBusy || !cnt) return;
  // 🔴 إجابة في السكة: الصف المحلي لسه على الإجابة القديمة، فالتأكيد كان هيتبني عليها
  if(cntOptBusy){ toast('استنى ثانية — الإجابة لسه بتتحفظ', 'er'); return; }
  if(cntPileErr){ toast('مقدرناش نجيب الطرود اللي في الكومة — دوس ↻ الأول', 'er'); return; }
  var pmap = pileMap();
  var pay = whCountPayload(cntProducts, cntDraft, pmap);
  var gl = $id('wh-golive');
  var goLive = !!(gl && gl.checked);
  if(!pay.counts.length){ toast('اكتب العدد لمنتج واحد على الأقل', 'er'); return; }
  if(goLive && pay.missing){ toast('جرد التشغيل لازم يغطي كل المنتجات — فاضل ' + pay.missing, 'er'); return; }
  // 🔴 سكانات محفوظة على الجهاز ده لسه ماوصلتش السيرفر (النت كان واقع): هتتسجّل بوقت وصولها — بعد الجرد —
  // فالسيرفر مش هيعرف إنها اتعملت وانت بتعدّ. تتبعت الأول.
  var pend = api.pending ? api.pending() : 0;
  if(pend > 0){ toast('فيه ' + pend + ' سكان على الجهاز ده لسه ماوصلوش السيرفر — استنى لحد ما يتبعتوا (تاب «السكان») وبعدين طبّق', 'er'); return; }
  var nq = whPileNeed(cntPile, cnt.id, pay.counts.map(function(c){ return c.product_id; }));
  if(nq.moved || nq.ret){
    toast('جاوب على السؤال جنب ' + (nq.pids.length === 1 ? '«' + prodName(nq.pids[0]) + '»' : nq.pids.length + ' منتجات') + ' الأول ('
      + (nq.moved ? 'الطرود اللي اتسلّمت وانت بتعدّ' : 'المرتجع اللي ماتضربش') + ') — الإجابة بتغيّر الرقم', 'er');
    // السؤال بتاع المنتج اللي اتقال اسمه — مش أول سؤال في الصفحة (ممكن يكون لمنتج مش مكتوب عدده)
    var qe = null, qs = document.querySelectorAll('#wh-count .wh-cq.need');
    for(var qi = 0; qi < qs.length && !qe; qi++) if(qs[qi].getAttribute('data-pid') === nq.pids[0]) qe = qs[qi];
    qe = qe || document.querySelector('#wh-count .wh-count-q.need');
    if(qe && qe.scrollIntoView) qe.scrollIntoView({ behavior: 'instant', block: 'center' });
    return;
  }
  if(pay.short.length){
    var sh = pay.short[0];
    toast('«' + (sh.p.name || '') + '»: العدد ' + sh.counted + ' أقل من اللي في الكومة (' + sh.pile + ') — الكومة لازم تتعدّ معاه', 'er');
    return;
  }
  var go = function(f){
    cntBusy = true; renderCount();
    sb.rpc('wh_count_apply', { p_count_id: cnt.id, p_counts: pay.counts, p_go_live: goLive, p_force: !!f }).then(function(r){
      cntBusy = false;
      var d = (r && !r.error && r.data) || { ok: false, code: 'error' };
      if(d.code === 'scans_during_count'){
        renderCount();
        // الخروج وانت بتعدّ بقى محسوب (الكومة · أو سؤال المندوب) — فاضل المرتجع اللي اتضرب (اتضاف) والسطور المش مربوطة
        var pin = Number(d.posted_in != null ? d.posted_in : d.posted) || 0, unm = Number(d.unmatched) || 0;
        showModal({ icon: '⚠️', title: 'فيه طرود اتضربت بعد ما الجرد اتفتح',
          sub: (pin ? 'فيه ' + pin + ' مرتجع اتضرب (اتضاف) وانت بتعدّ: قطعه لازم تكون في العدد اللي كتبته — لو عدّيت منتجه قبل ما يوصل، زوّده قبل ما تطبّق. ' : '')
            + (unm ? 'وفيه ' + unm + ' سطر في سكانات وانت بتعدّ منتجه مش مربوط — السيستم مش هيقدر يحسبه مع الكومة؛ الأحسن تربطه الأول (تاب «🔗 ربط المنتجات») وبعدين تطبّق.' : '')
            + ((!pin && !unm) ? 'فيه سكانات اتعملت وانت بتعدّ. لو العدد اللي كتبته بعدها، طبّق عادي. لو قبلها، الغي واعدّ تاني.' : ''),
          okLabel: 'طبّق برضه', onOk: function(){ go(true); } });
        return;
      }
      // طرد اتسلّم للمندوب أو مرتجع وصل وانت بتأكّد (أو العدد زاد من آخر إجابة) — السؤال بيظهر فوق
      if(d.code === 'pile_questions'){
        loadCount();
        toast('فيه طرود محتاجة إجابتك قبل التطبيق — السؤال جنب ' + ((d.products || []).length === 1 ? '«' + prodName(d.products[0]) + '»' : 'المنتجات اللي عليها ❓'), 'er');
        return;
      }
      if(!d.ok){
        // منتج اتضاف في المخزون والجرد مفتوح = القايمة هنا قديمة — نجيبها تاني (الكلام المكتوب بيفضل)
        // · الكومة اتغيّرت (طرد اتضرب/اتسحب) = نجيب أرقامها تاني
        if(d.code === 'missing_lines' || d.code === 'pile_exceeds') loadCount(); else renderCount();
        var nm = d.product_id ? prodName(d.product_id) : '';
        toast(d.code === 'missing_lines' ? 'جرد التشغيل لازم يغطي كل المنتجات — فاضل ' + (d.missing || '')
          : d.code === 'pile_exceeds' ? '«' + nm + '»: العدد ' + d.counted + ' أقل من اللي في الكومة (' + d.pile + ') — الكومة لازم تتعدّ معاه'
          : d.code === 'bad_qty' ? (nm ? 'الرقم بتاع «' + nm + '» مش مظبوط' : 'فيه رقم مش مظبوط')
          : d.code === 'busy' ? 'السيرفر مشغول — جرّب تاني كمان ثانية'
          : 'مقدرناش نطبّق — حاول تاني', 'er');
        return;
      }
      try{ localStorage.removeItem(draftKey()); localStorage.removeItem(orderKey()); }catch(e){ /* */ }
      toast(d.go_live ? '🟢 السكان اشتغل — كل طرد يتضرب من دلوقتي بيتخصم'
        : 'اتطبّق الجرد ✓ — ' + (d.changed || 0) + ' منتج اتعدّل' + (d.pile ? ' · اتطرح ' + d.pile + ' قطعة في الكومة' : ''), 'ok');
      cntPreview = false;
      loadCount();
      api.reloadBoard();
    });
  };
  var pileN = 0;
  pay.counts.forEach(function(c){ pileN += pmap[c.product_id] || 0; });   // الكومة + اللي جاوبت إنه اتعدّ
  var sub = pay.changed.length + ' منتج رقمه هيتغيّر' + (pay.missing ? ' · ' + pay.missing + ' مااتعدّوش (هيفضلوا زي ما هم)' : '') + '.'
    + (pileN ? ' و' + pileN + ' قطعة في الكومة (اتضربت خروج) هتتطرح من العدّ.' : '')
    + (goLive ? ' والسكان هيبدأ يخصم من لحظة فتح الجرد.' : '');
  if(goLive){
    // عيلة العدد اللي اتكتب فيها كله على «غير موزع» = السكان بيخصم من الخاصية = بالسالب من أول ساعة (نفس فحص «▶️ شغّل»)
    var famOn = [];
    whCountFamilies(cntProducts).forEach(function(f){
      if(!f.unalloc) return;
      var kids = cntProducts.filter(function(c){ return c.parent_id === f.p.id; });
      var pv = parseInt(cntDraft[f.p.id], 10) || 0;
      if(pv > 0 && kids.length && kids.every(function(c){ return !(parseInt(cntDraft[c.id], 10) > 0); })) famOn.push(f.p.name + ' (' + pv + ')');
    });
    if(famOn.length) sub += '\n📦 العدد كله على «غير موزع» في: ' + famOn.join(' · ') + ' — السكان بيخصم من اللون/المقاس، فهتبان بالسالب من أول ساعة. الأحسن تكتب كل لون في سطره.';
    sub += '\n🔴 في نفس اللحظة وقّف سكانر التلجرام القديم وصفحة المرتجعات في n8n — صفحة n8n بتعلّم المرتجع من غير ما المخزون يرجع.';
  }
  if(force){ go(true); return; }
  showModal({ icon: goLive ? '🟢' : '🧮', title: goLive ? 'طبّق جرد التشغيل وشغّل السكان؟' : 'طبّق الجرد؟', sub: sub,
    okLabel: 'طبّق', onOk: function(){ go(false); } });
}

function countCancel(){
  if(!cnt) return;
  showModal({ icon: '✖', title: 'تلغي الجرد ده؟', sub: 'مفيش حاجة هتتكتب في المخزن، والأرقام اللي كتبتها هتتمسح.', okLabel: 'الغيه', okColor: 'var(--red)',
    onOk: function(){
      cntBusy = true;
      sb.rpc('wh_count_cancel', { p_count_id: cnt.id }).then(function(r){
        cntBusy = false;
        if(r.error){ toast('مقدرناش — حاول تاني', 'er'); renderCount(); return; }
        try{ localStorage.removeItem(draftKey()); localStorage.removeItem(orderKey()); }catch(e){ /* */ }
        toast('اتلغى الجرد', 'ok');
        loadCount();
      });
    } });
}

// 🔴 الزرار بيبعت الحالة اللي **مكتوبة عليه** (data-en) مش عكس آخر قراية، وكتلة الإعدادات بتترسم من رد السيرفر
// فوراً حتى والفوكس على الزرار: كانت بتفضل «⏸️ وقّفه» والسكان واقف، والضغطة التانية بتشغّله تاني في صمت.
// ⚠️ مفيش `disabled` وقت الحفظ (درس 54 — بيشيل الفوكس) — القفل من التكرار في الكود (`cfgBusy`).
function cfgSet(patch){
  if(cfgBusy) return;
  cfgBusy = true; refreshSet(true);
  Promise.resolve(sb.rpc('wh_config_set', { p: patch })).then(function(r){
    cfgBusy = false;
    var d = (r && !r.error && r.data) || { ok: false };
    if(d.ok && board){ board = Object.assign({}, board, { enabled: !!d.enabled, hold_cancel_requested: d.hold_cancel_requested !== false,
                                                         baseline_at: d.baseline_at || board.baseline_at }); }
    refreshSet(true);
    // السيرفر لقى حاجة قبل التشغيل (مش مربوط · ناقص · …) = التأكيد بالتفاصيل، والتشغيل بعده بـforce
    if(!d.ok && d.code === 'needs_confirm'){ startConfirm(d.check || null, true); return; }
    if(!d.ok){ toast(d.code === 'needs_start' ? 'لازم «▶️ شغّل السكانر» الأول' : 'مقدرناش نحفظ', 'er'); api.reloadBoard(); return; }
    toast('اتحفظ ✓', 'ok');
    api.reloadBoard();
  }, function(){ cfgBusy = false; refreshSet(true); toast('مقدرناش نحفظ', 'er'); });
}

// نتيجة wh_start_check → سطور بالكلام (مصدر واحد للتأكيد ولرد needs_confirm من السيرفر)
export function whStartIssues(chk){
  var out = [];
  if(!chk || !chk.ok) return out;
  var un = chk.unmatched || {}, rv = chk.review || {}, g = chk.gap || {};
  if(un.n) out.push('❌ ' + un.n + ' اسم منتج مش مربوط (' + (un.pieces || 0) + ' قطعة آخر 30 يوم' + (un.top && un.top.length ? ': ' + un.top.slice(0, 3).join(' · ') : '') + ') — الطرود دي هتغيّر حالتها بس مش هتتخصم لحد ما تربطها. ولو صلّحت رقمها من المخزون قبل الربط، اللي اتضرب قبل الربط هيتخصم تاني لحظة الربط.');
  if(rv.n) out.push('⚠️ ' + rv.n + ' خاصية «راجع» (' + (rv.pieces || 0) + ' قطعة) — مقاس ممكن يتخصم من منتج تاني' + (rv.top && rv.top.length ? ': ' + rv.top.slice(0, 2).join(' · ') : '') + '.');
  if(chk.missing_returns) out.push('🚨 ' + chk.missing_returns + ' مرتجع J&T قالت سلّمته ومحدش سجّله — اللي على الرف سجّله في صفحة n8n قبل ما تشغّل (بعد التشغيل السكان هيضيفه للمخزن، ولو كنت عدّيته يبقى مرتين).');
  if(Array.isArray(chk.families) && chk.families.length) out.push('📦 منتجات ليها خصائص ورصيدها كله على الأم: ' + chk.families.map(function(f){ return f.name + ' (' + f.qty + ')'; }).join(' · ') + ' — السكان بيخصم من الخاصية، فهتبان بالسالب من أول ساعة. وزّع العدد على الخصائص من «المخزون».');
  if(g.pickups || g.returns) out.push('⏰ من ساعة ما بدأت تظبط الأرقام (' + whenTxt(g.since) + '): J&T استلمت ' + (g.pickups || 0) + ' طرد ووصل ' + (g.returns || 0) + ' مرتجع — مش محسوبين صح. ظبط أرقام المنتجات دي تاني قبل التشغيل.');
  return out;
}

function startConfirm(chk, force){
  var n = api.pending();
  var issues = whStartIssues(chk);
  showModal({ icon: issues.length ? '⚠️' : '▶️', title: issues.length ? 'قبل ما تشغّل — فيه ' + issues.length + ' حاجة محتاجة تتشاف' : 'تشغّل السكانر من دلوقتي؟',
    sub: (issues.length ? issues.join('\n') + '\n\n' : '')
      + 'من اللحظة دي: كل طرد يتضرب خروج حالته بتبقى «اوردر اتضرب» ويتخصم من المخزن، وكل مرتجع يتضرب حالته بتبقى «مرتجع مضروب» ويرجع للمخزن.\n'
      + '🔴 في نفس اللحظة وقّف سكانر التلجرام القديم وصفحة المرتجعات في n8n.'
      + (chk ? '' : '\n⚠️ مقدرناش نعمل فحص ما قبل التشغيل — السيرفر هيعمله.')
      + (n ? '\n⚠️ فيه ' + n + ' سكان على الجهاز ده لسه ماوصلوش السيرفر — هيتسجّلوا بعد التشغيل.' : ''),
    okLabel: issues.length ? 'شغّله برضه' : 'شغّله',
    onOk: function(){ cfgSet(force ? { enabled: true, start: true, force: true } : { enabled: true, start: true }); } });
}

// التشغيل الأول — الفحص الأول، وبعدين تأكيد صريح بالأثر والمشاكل اللي اتلقت
function cfgStart(){
  if(cfgBusy || (board && board.baseline_at)) return;
  cfgBusy = true; refreshSet(true);
  Promise.resolve(sb.rpc('wh_start_check')).then(function(r){
    cfgBusy = false; refreshSet(true);
    var d = r && !r.error && r.data;
    // الفحص وقع = التأكيد من غير تفاصيل والتشغيل من غير force (السيرفر هيفحص بنفسه ويرد needs_confirm)
    if(!d || !d.ok){ startConfirm(null, false); return; }
    startConfirm(d, true);
  }, function(){ cfgBusy = false; refreshSet(true); startConfirm(null, false); });
}

// كتلة الإعدادات لوحدها — force = حتى والفوكس جوّاها (والفوكس بيرجع لنفس الزرار/الخانة)
function refreshSet(force){
  var set = document.querySelector('#wh-count .wh-set');
  if(!set) return;
  var ae = document.activeElement, inside = !!(ae && set.contains(ae));
  if(inside && !force && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName || '')) return;
  var key = inside ? (ae.id ? '#' + ae.id : (ae.getAttribute('data-wha') ? '[data-wha="' + ae.getAttribute('data-wha') + '"]' : '')) : '';
  var tmp = document.createElement('div');
  tmp.innerHTML = settingsHtml(!!(board && board.enabled), board && board.baseline_at);
  if(!tmp.firstChild) return;
  set.replaceWith(tmp.firstChild);
  if(key){ var n = document.querySelector('#wh-count .wh-set ' + key); if(n){ try{ n.focus({ preventScroll: true }); }catch(e){ n.focus(); } } }
}

// ── الربط بالصفحة ────────────────────────────────────────────────────
// الدخول للتاب (اختيار صريح): الجرد بيتجاب من جديد كل مرة (أرقام السيستم بتتحرك مع السكان، ومنتج اتضاف
// = جرد التشغيل يترفض «ناقص») — الكلام المكتوب في الـlocalStorage فمابيضيعش.
export function whAdminRender(b, tab){
  if(b) board = b;
  if(currentRole !== 'admin') return;
  var page = $id('page-warehouse');
  var t = tab || (page && page.getAttribute('data-tab')) || 'scan';
  if(t === 'map'){ if(!mapRows && !mapLoading) loadMap(); else renderMap(); }
  else if(t === 'count'){ loadCount(); }
}

// 🔴 تحديث القوايم الدوري (كل 30ث) **مابيعيدش رسم** شاشة الربط ولا الجرد: كان بيمسح اختيار الأدمن في الـselect
// والفوكس من خانة العدّ وهو بيكتب. بيحدّث حالة السكان بس (كتلة الإعدادات) ولو الفوكس مش جوّاها.
export function whAdminBoard(b){
  if(b) board = b;
  if(currentRole !== 'admin') return;
  var page = $id('page-warehouse');
  if(!page || page.getAttribute('data-tab') !== 'count' || !cntProducts || cfgBusy) return;
  refreshSet(false);
}

function onClick(e){
  var t = e.target.closest ? e.target.closest('[data-wha]') : null;
  if(!t) return;
  var a = t.getAttribute('data-wha');
  if(a === 'map-filter'){ mapFilter = t.getAttribute('data-k') || 'all'; renderMap(); }
  else if(a === 'map-reload') loadMap();
  else if(a === 'map-repost') mapRepost();
  else if(a === 'map-save') mapSave(t, false);
  else if(a === 'map-ignore') mapSave(t, true);
  else if(a === 'count-open') countOpen();
  else if(a === 'count-apply') countApply(false);
  else if(a === 'count-cancel') countCancel();
  else if(a === 'count-reload') loadCount();
  else if(a === 'count-preview'){ cntPreview = !cntPreview; renderCount(); }
  else if(a === 'count-print') countPrint();
  else if(a === 'count-opt') countOpt(t.getAttribute('data-k'), t.getAttribute('data-v'), t.getAttribute('data-pid') || '');
  else if(a === 'cfg-toggle') cfgSet({ enabled: t.getAttribute('data-en') === '1' });
  else if(a === 'cfg-start') cfgStart();
}

function onInput(e){
  var t = e.target;
  if(t && t.id === 'wh-map-q'){
    mapQ = t.value || '';
    var pos = t.selectionStart;
    renderMap();
    var n = $id('wh-map-q'); if(n){ n.focus(); try{ n.setSelectionRange(pos, pos); }catch(er){ /* */ } }
    return;
  }
  if(t && t.classList && t.classList.contains('wh-ci')){
    var pid = t.getAttribute('data-pid');
    var v = String(t.value || '').replace(/[٠-٩]/g, function(d){ return String(d.charCodeAt(0) - 1632); }).replace(/[^\d]/g, '');
    if(v !== t.value) t.value = v;
    if(v === '') delete cntDraft[pid]; else cntDraft[pid] = v;
    draftSave();
    qTopRefresh();
  }
}

// الملخص فوق بيتحدّث وانت بتكتب (الأحمر = منتج مكتوب عدده لسه محتاج إجابة) — من غير رسم كامل: الخانة اللي في إيدك
// مابتتلمسش (الملخص زراير بس)
function qTopRefresh(){
  var cp = cnt && cntPile && cntPile.count_id === cnt.id ? cntPile : null;
  if(!cp) return;
  ['moved', 'ret'].forEach(function(k){
    var el = document.querySelector('#wh-count .wh-count-q[data-k="' + k + '"]');
    if(!el) return;
    var h = qTopHtml(k, cp);
    if(!h){ el.remove(); return; }
    var tmp = document.createElement('div'); tmp.innerHTML = h;
    if(tmp.firstChild) el.replaceWith(tmp.firstChild);
  });
}

function onChange(e){
  var t = e.target;
  if(t && t.id === 'wh-hold') cfgSet({ hold_cancel_requested: !!t.checked });
  if(t && t.id === 'wh-golive') cntGoLive = !!t.checked;
  if(t && t.classList && (t.classList.contains('wh-map-prod') || t.classList.contains('wh-map-scope'))){
    var rowEl = t.closest('.wh-map-row'); if(!rowEl) return;
    var k = rowEl.getAttribute('data-k'), r = findRow(k);
    var ps = rowEl.querySelector('.wh-map-prod'), sc = rowEl.querySelector('.wh-map-scope');
    var pk = mapPick[k] || {};
    pk.pid = ps ? ps.value : '';
    if(t.classList.contains('wh-map-prod')){
      // المنتج اتغيّر = النطاق يرجع للافتراضي بتاعه (بنت = بالخاصية) لو الأدمن مااختارش نطاق بإيده
      if(!pk.scopeSet && sc){ sc.value = whMapDefaultScope(r, pk.pid); }
    } else pk.scopeSet = true;
    pk.scope = sc ? sc.value : 'item';
    mapPick[k] = pk;
  }
}

// Enter في خانة الجرد = الخانة اللي بعدها (العدّ بيتعمل بالكيبورد)
// 🔴 السكانر ضرب والأدمن في خانة العدّ: أرقام البوليصة كانت بتتكتب كعدد والـEnter بينقل للخانة اللي بعدها.
// الضربة بتتعرف من سرعتها (≥ 8 زراير ورا بعض بمتوسط ≤ 35ms) وبترجّع الخانة لقيمتها قبلها.
var ciBurst = { el: null, snap: '', last: 0, n: 0, sum: 0, max: 0 };
function onKeyDown(e){
  var t = e.target;
  if(!(t && t.classList && t.classList.contains('wh-ci'))) return;
  var end = e.key === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Tab' || (e.ctrlKey && (e.code === 'KeyJ' || e.code === 'KeyM'));
  if(end){
    var b = ciBurst;
    ciBurst = { el: null, snap: '', last: 0, n: 0, sum: 0, max: 0 };
    if(b.el === t && b.n >= 8 && b.sum / Math.max(1, b.n - 1) <= 35 && b.max <= 120){
      e.preventDefault();
      t.value = b.snap;
      onInput({ target: t });
      toast('📦 اتضرب كود في خانة العدّ — اتشال. السكان بيتعمل من تاب «السكان»', 'er');
      return;
    }
    if(e.ctrlKey) e.preventDefault();
    if(e.key === 'Enter' || e.code === 'NumpadEnter'){
      e.preventDefault();
      var all = Array.prototype.slice.call(document.querySelectorAll('#wh-count .wh-ci'));
      var i = all.indexOf(t);
      if(i >= 0 && all[i + 1]){ all[i + 1].focus(); all[i + 1].select(); }
    }
    return;
  }
  // زرار متداس (رقم واحد بيتكرر كل ~30ms) مش سكانر — كان بيترجّع الخانة ويقول «اتضرب كود»
  if(e.repeat){ ciBurst = { el: null, snap: '', last: 0, n: 0, sum: 0, max: 0 }; return; }
  if(e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey){
    var ts = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now();
    if(ciBurst.el !== t || ts - ciBurst.last > 120){ ciBurst = { el: t, snap: t.value, last: ts, n: 1, sum: 0, max: 0 }; }
    else { var d = ts - ciBurst.last; ciBurst.n++; ciBurst.sum += d; if(d > ciBurst.max) ciBurst.max = d; ciBurst.last = ts; }
  }
}

export function whAdminInit(a){
  if(a) api = a;
  var map = $id('wh-map'), count = $id('wh-count');
  [map, count].forEach(function(el){
    if(!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKeyDown);
  });
  // `toggle` مابيعملش bubble — بنمسكه في الطريق (capture)
  if(count) count.addEventListener('toggle', function(e){
    if(e.target && e.target.classList && e.target.classList.contains('wh-count-adv')) cntAdvOpen = !!e.target.open;
  }, true);
}
