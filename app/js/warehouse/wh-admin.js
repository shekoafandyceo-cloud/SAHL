// سكانر المخزن — شاشات الأدمن: ربط المنتجات · الجرد والتشغيل (14 أكتوبر)
//
// 🔗 ربط المنتجات: اسم المنتج في الأوردر (زي ما اللاندنج بيكتبه) ↔ منتج في المخزون. السيرفر بيحل لوحده
//    لو الاسم = اسم منتج واحد بالظبط بعد التطبيع؛ اللي مايتحلش بيظهر هنا «مش مربوط». الربط بيتعمل مرة
//    (`stock_item_aliases`) والسطور المعلّقة اللي اتضربت قبل كده بتتخصم لحظة الربط (`wh_alias_set`).
// 🧮 الجرد: عدّ حقيقي لكل منتج → حركة «جرد» بالفرق. أول جرد = «جرد التشغيل»: السكان بيبدأ يخصم من لحظة
//    فتح الجرد (`baseline_at`) — كل اللي خرج قبلها اتحسب في الجرد، واللي يرجع منه بيتضاف.
// 🔴 الكتابة كلها RPCs أدمن (السيرفر بيرفض أي حد تاني) — الواجهة مابتحسبش كميات.

import { $id, esc } from '../core/dom.js';
import { stripBidi } from '../core/format.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { currentRole, currentTenantId } from '../auth/auth.js';

var api = { reloadBoard: function(){}, setTab: function(){}, enqueue: function(){} };
var board = null;

// ── ربط المنتجات ─────────────────────────────────────────────────────
var mapRows = null, mapProducts = [], mapErr = false, mapLoading = false, mapFilter = '', mapQ = '';
var mapSaving = {};
// اختيار الأدمن في كل صف قبل ما يحفظ — أي رسم للقايمة (حفظ صف تاني · فلتر · بحث) كان بيرجّع الاختيارات
// اللي مااتحفظتش لأصلها في صمت
var mapPick = {};   // rowKey → {pid, scope}

// حالة الصف — مصدر واحد للشريحة والفلتر والشارة
export function whMapState(r){
  if(!r) return 'unmatched';
  if(r.state === 'ignored') return 'ignored';
  if(r.state !== 'posted' || !r.product_id) return 'unmatched';
  if(r.matched_by === 'unallocated') return 'unallocated';
  return 'ok';
}

var MAP_CHIPS = [
  { k: 'unmatched',   t: '❌ مش مربوط' },
  { k: 'unallocated', t: '📦 بيتخصم من «غير موزع»' },
  { k: 'ok',          t: '✅ مربوط' },
  { k: 'ignored',     t: '🚫 متجاهَل' },
  { k: 'all',         t: '🗂️ الكل' }
];
var MATCHED_BY = { alias: 'ربط بالخاصية', alias_item: 'ربط بالاسم', exact: 'نفس الاسم', child_label: 'الخاصية من الأوردر', unallocated: 'غير موزع' };

function rowKey(r){ return r.item_key + '|' + (r.props_key || '') + '|' + (r.var_key || ''); }

function loadMap(){
  if(!sb || mapLoading) return;
  mapLoading = true; mapErr = false;
  renderMap();
  sb.rpc('wh_items_unmapped', { p_days: 30 }).then(function(r){
    mapLoading = false;
    if(r.error || !r.data || !r.data.ok){ mapErr = true; renderMap(); return; }
    mapRows = r.data.rows || [];
    mapProducts = (r.data.products || []).filter(function(p){ return p.active !== false; });
    if(!mapFilter){
      var c = mapCounts();
      mapFilter = c.unmatched ? 'unmatched' : (c.unallocated ? 'unallocated' : 'all');
    }
    renderMap();
  });
}

function mapCounts(){
  var c = { unmatched: 0, unallocated: 0, ok: 0, ignored: 0, all: 0 };
  (mapRows || []).forEach(function(r){ c[whMapState(r)]++; c.all++; });
  return c;
}

function isChildProduct(id){
  for(var i = 0; i < mapProducts.length; i++) if(mapProducts[i].id === id) return !!mapProducts[i].parent_id;
  return false;
}

// النطاق الافتراضي: «بالخاصية دي بس» لو الربط القديم كان بالخاصية، أو المنتج المختار خاصية (بنت) والصف ليه
// خاصية — ربط الاسم كله بخاصية واحدة معناه كل ألوان/مقاسات الاسم ده تتخصم منها (السيرفر بيصلّح لو خاصية
// الأوردر بتطابق أخت تانية، بس اللي مالوش أخت مطابقة بيروح للخاصية دي غلط)
export function whMapDefaultScope(r, pid){
  if(!r || !r.props_key) return 'item';
  if(r.alias_props || r.alias_props_ignore) return 'props';
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
    + 'اللي «مش مربوط» مش هيتخصم من المخزن لحد ما تربطه — والسكانات اللي اتعملت عليه قبل الربط بتتخصم لحظة الربط.</div>';
  h += '<div class="wh-map-bar"><div class="wh-chips">';
  MAP_CHIPS.forEach(function(ch){
    h += '<button type="button" class="wh-chip' + (mapFilter === ch.k ? ' on' : '') + (ch.k === 'unmatched' && c.unmatched ? ' hot' : '') + '" data-wha="map-filter" data-k="' + ch.k + '">'
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
      : (st === 'ignored' ? '<span class="wh-ms ignored">🚫 متجاهَل — مش بيتخصم</span>' : '<span class="wh-ms unmatched">❌ مش مربوط — مش بيتخصم</span>');
    var hasProps = !!(r.props_key);
    var pk = mapPick[k];
    var sel = pk ? pk.pid : (r.alias_props || r.alias_item || (st === 'ok' || st === 'unallocated' ? r.product_id : ''));
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

function draftKey(){ return 'sahl_wh_count_draft_' + (cnt ? cnt.id : 'x'); }
function draftLoad(){
  cntDraft = {};
  try{ var v = JSON.parse(localStorage.getItem(draftKey()) || '{}'); if(v && typeof v === 'object') cntDraft = v; }catch(e){ cntDraft = {}; }
}
function draftSave(){
  try{ localStorage.setItem(draftKey(), JSON.stringify(cntDraft)); }catch(e){ swallow('wh-admin/draft', e); }
}

function whenTxt(iso){
  if(!iso) return '—';
  try{ return stripBidi(new Date(iso).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })); }
  catch(e){ return '—'; }
}

function loadCount(){
  if(!sb || !currentTenantId || cntLoading) return;
  cntLoading = true; cntErr = false; renderCount();
  Promise.all([
    sb.from('stock_counts').select('id,opened_at,opened_by_name,note,applied_at,applied_by_name,go_live,cancelled_at')
      .eq('tenant_id', currentTenantId).order('opened_at', { ascending: false }).limit(6),
    sb.from('v_stock_products').select('id,name,current_qty,parent_id,variant_label,active')
      .eq('tenant_id', currentTenantId).order('name', { ascending: true })
  ]).then(function(res){
    cntLoading = false;
    if(res[0].error || res[1].error){ cntErr = true; renderCount(); return; }
    var rows = res[0].data || [];
    cnt = null;
    for(var i = 0; i < rows.length; i++) if(!rows[i].applied_at && !rows[i].cancelled_at){ cnt = rows[i]; break; }
    cntHist = rows.filter(function(x){ return x.applied_at; });
    // نفس شرط السيرفر بالحرف (`coalesce(active, true)`) — NULL = نشط، وإلا جرد التشغيل يترفض «ناقص»
    cntProducts = (res[1].data || []).filter(function(p){ return p.active !== false; });
    if(cnt) draftLoad();
    renderCount();
  });
}

// المنتجات بالعيلة: الأم الأول (لو ليها خصائص = «غير موزع») وبعدها بناتها
export function whCountFamilies(products){
  var parents = [], kids = {};
  (products || []).forEach(function(p){ if(p.parent_id) (kids[p.parent_id] = kids[p.parent_id] || []).push(p); else parents.push(p); });
  var out = [];
  parents.forEach(function(p){
    var k = kids[p.id] || [];
    out.push({ p: p, unalloc: k.length > 0, child: false });
    k.forEach(function(c){ out.push({ p: c, unalloc: false, child: true }); });
  });
  // بنت أمها مش نشطة/مش موجودة — تتعرض برضه (الجرد لازم يغطي كل النشط)
  (products || []).forEach(function(p){
    if(p.parent_id && !parents.some(function(x){ return x.id === p.parent_id; })) out.push({ p: p, unalloc: false, child: true });
  });
  return out;
}

export function whCountPayload(products, draft){
  var counts = [], missing = 0, changed = [];
  (products || []).forEach(function(p){
    var v = draft ? draft[p.id] : undefined;
    var s = v == null ? '' : String(v).trim();
    if(s === ''){ missing++; return; }
    if(!/^\d+$/.test(s)) { missing++; return; }
    var n = parseInt(s, 10);
    counts.push({ product_id: p.id, counted: n });
    var cur = Number(p.current_qty || 0);
    if(n !== cur) changed.push({ p: p, from: cur, to: n });
  });
  return { counts: counts, missing: missing, changed: changed };
}

function renderCount(){
  var el = $id('wh-count'); if(!el) return;
  if(cntLoading && !cntProducts){ el.innerHTML = '<div class="wh-empty">بنحمّل…</div>'; return; }
  if(cntErr && !cntProducts){ el.innerHTML = '<div class="wh-empty">مقدرناش نحمّل. <button type="button" class="wh-btn wh-btn-ghost" data-wha="count-reload">↻ حاول تاني</button></div>'; return; }
  if(!cntProducts){ el.innerHTML = ''; return; }
  var enabled = !!(board && board.enabled), base = board && board.baseline_at;
  var h = settingsHtml(enabled, base);
  if(!cnt){
    h += '<div class="wh-count-intro">'
      + '<h3>🧮 الجرد</h3>'
      + (base ? '<p>آخر جرد تشغيل: ' + esc(whenTxt(base)) + '. تقدر تعمل جرد دوري في أي وقت — الفرق بيتسجّل حركة «جرد».</p>'
              : '<p><b>جرد التشغيل</b> هو اللي بيبدأ السكان: بتعدّ كل منتج في المخزن بإيدك، والسيستم بيبدأ يخصم كل طرد يتضرب من لحظة فتح الجرد.</p>')
      + '<ol class="wh-steps">'
      + '<li>اربط المنتجات الأول (تاب «🔗 ربط المنتجات») — لحد ما «مش مربوط» تبقى صفر أو قريبة منه.</li>'
      + '<li>اختار وقت مفيش فيه تسليم للمندوب (مثلاً الصبح بدري). افتح الجرد، وعدّ <b>كل القطع اللي في المخزن — بما فيها الطرود المتغلّفة اللي المندوب لسه ماستلمهاش</b> (دي هتتخصم لما تتضرب خروج).</li>'
      + '<li>اكتب العدد لكل منتج هنا، وبعدين «طبّق الجرد» مع «ده جرد التشغيل».</li>'
      + '<li>من بعدها: كل طرد خارج يتضرب، وكل مرتجع يتضرب أول ما يوصل.</li></ol>'
      + '<button type="button" class="wh-btn wh-btn-main" data-wha="count-open"' + (cntBusy ? ' disabled' : '') + '>🧮 افتح جرد جديد</button>'
      + '</div>';
    h += histHtml();
    el.innerHTML = h;
    return;
  }
  var fam = whCountFamilies(cntProducts);
  var pay = whCountPayload(cntProducts, cntDraft);
  h += '<div class="wh-count-head"><div><h3>🧮 جرد مفتوح</h3><p>اتفتح ' + esc(whenTxt(cnt.opened_at)) + (cnt.opened_by_name ? ' · ' + esc(cnt.opened_by_name) : '')
    + '. اكتب العدد الحقيقي لكل منتج — الكلام بيتحفظ على الجهاز ده لحد ما تطبّق.</p></div>'
    + '<div class="wh-count-prog"><b>' + (cntProducts.length - pay.missing) + '</b> من ' + cntProducts.length + ' اتعدّوا'
    + ' <button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wha="count-reload" title="هات أرقام السيستم من جديد ومنتجات اتضافت — اللي كتبته بيفضل">↻</button></div></div>';
  h += '<div class="wh-count-list">';
  fam.forEach(function(f){
    var p = f.p, v = cntDraft[p.id];
    var s = v == null ? '' : String(v);
    var diff = '';
    if(cntPreview && s !== '' && /^\d+$/.test(s.trim())){
      var d = parseInt(s, 10) - Number(p.current_qty || 0);
      diff = d === 0 ? '<span class="wh-cd zero">=</span>' : '<span class="wh-cd ' + (d > 0 ? 'up' : 'down') + '" dir="ltr">' + (d > 0 ? '+' : '') + d + '</span>';
    }
    h += '<div class="wh-count-row' + (f.child ? ' child' : '') + '">'
      + '<span class="wh-cn">' + (f.child ? '↳ ' : '') + esc(p.name) + (f.unalloc ? ' <small>(غير موزع — اكتب 0 لو كل القطع على الخصائص)</small>' : '') + '</span>'
      + '<span class="wh-cs" title="الرقم في السيستم دلوقتي">السيستم ' + '<span dir="ltr">' + esc(String(p.current_qty || 0)) + '</span></span>'
      + '<input class="wh-ci" type="text" inputmode="numeric" data-pid="' + esc(p.id) + '" value="' + esc(s) + '" placeholder="العدد" autocomplete="off">'
      + diff + '</div>';
  });
  h += '</div>';
  var golive = !enabled;
  h += '<div class="wh-count-foot">'
    + (golive ? '<label class="wh-check"><input type="checkbox" id="wh-golive"' + (!base ? ' checked' : '') + '> ده <b>جرد التشغيل</b> — السكان يبدأ يخصم من لحظة فتح الجرد (' + esc(whenTxt(cnt.opened_at)) + ')</label>' : '')
    + '<div class="wh-count-acts">'
    + '<button type="button" class="wh-btn wh-btn-ghost" data-wha="count-preview">' + (cntPreview ? '🙈 اخفي الفرق' : '👀 وريني الفرق') + '</button>'
    + '<button type="button" class="wh-btn wh-btn-main" data-wha="count-apply"' + (cntBusy ? ' disabled' : '') + '>✅ طبّق الجرد</button>'
    + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-danger" data-wha="count-cancel"' + (cntBusy ? ' disabled' : '') + '>✖ الغي الجرد</button>'
    + '</div>'
    + (pay.changed.length ? '<div class="wh-hint">' + pay.changed.length + ' منتج رقمه هيتغيّر.</div>' : '')
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
  var h = '<div class="wh-set"><h3>⚙️ إعدادات السكان</h3>';
  if(base){
    h += '<div class="wh-set-row">' + (enabled ? '🟢 شغّال — بيخصم من ' + esc(whenTxt(base)) : '⏸️ متوقف — مابيخصمش')
      + ' <button type="button" class="wh-btn wh-btn-ghost" data-wha="cfg-toggle">' + (enabled ? '⏸️ وقّفه' : '▶️ شغّله') + '</button></div>';
  } else {
    h += '<div class="wh-set-row">🧪 وضع تجربة — بيشتغل لما تطبّق «جرد التشغيل» تحت.</div>';
  }
  h += '<label class="wh-check"><input type="checkbox" id="wh-hold"' + (hold ? ' checked' : '') + '> امنع خروج الطرد لو العميل طالب إلغاء ولسه الطلب ماتحسمش</label>';
  return h + '</div>';
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

function countApply(force){
  if(cntBusy || !cnt) return;
  var pay = whCountPayload(cntProducts, cntDraft);
  var gl = $id('wh-golive');
  var goLive = !!(gl && gl.checked);
  if(!pay.counts.length){ toast('اكتب العدد لمنتج واحد على الأقل', 'er'); return; }
  if(goLive && pay.missing){ toast('جرد التشغيل لازم يغطي كل المنتجات — فاضل ' + pay.missing, 'er'); return; }
  var go = function(f){
    cntBusy = true; renderCount();
    sb.rpc('wh_count_apply', { p_count_id: cnt.id, p_counts: pay.counts, p_go_live: goLive, p_force: !!f }).then(function(r){
      cntBusy = false;
      var d = (r && !r.error && r.data) || { ok: false, code: 'error' };
      if(d.code === 'scans_during_count'){
        renderCount();
        showModal({ icon: '⚠️', title: 'فيه طرود اتضربت بعد ما الجرد اتفتح', sub: 'المنتجات دي اتخصم منها بعد ما بدأت تعدّ. لو العدد اللي كتبته بعد ما الطرود خرجت، طبّق عادي. لو قبلها، الغي واعدّ تاني.',
          okLabel: 'طبّق برضه', onOk: function(){ go(true); } });
        return;
      }
      if(!d.ok){
        // منتج اتضاف في المخزون والجرد مفتوح = القايمة هنا قديمة — نجيبها تاني (الكلام المكتوب بيفضل)
        if(d.code === 'missing_lines') loadCount(); else renderCount();
        toast(d.code === 'missing_lines' ? 'جرد التشغيل لازم يغطي كل المنتجات — فاضل ' + (d.missing || '') : (d.code === 'bad_qty' ? 'فيه رقم مش مظبوط' : 'مقدرناش نطبّق — حاول تاني'), 'er');
        return;
      }
      try{ localStorage.removeItem(draftKey()); }catch(e){ /* */ }
      toast(d.go_live ? '🟢 السكان اشتغل — كل طرد يتضرب من دلوقتي بيتخصم' : 'اتطبّق الجرد ✓ — ' + (d.changed || 0) + ' منتج اتعدّل', 'ok');
      cntPreview = false;
      loadCount();
      api.reloadBoard();
    });
  };
  var sub = pay.changed.length + ' منتج رقمه هيتغيّر' + (pay.missing ? ' · ' + pay.missing + ' مااتعدّوش (هيفضلوا زي ما هم)' : '') + '.'
    + (goLive ? ' والسكان هيبدأ يخصم من لحظة فتح الجرد.' : '');
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
        try{ localStorage.removeItem(draftKey()); }catch(e){ /* */ }
        toast('اتلغى الجرد', 'ok');
        loadCount();
      });
    } });
}

function cfgSet(patch){
  sb.rpc('wh_config_set', { p: patch }).then(function(r){
    var d = (r && !r.error && r.data) || { ok: false };
    if(!d.ok){ toast(d.code === 'needs_count' ? 'لازم جرد التشغيل الأول' : 'مقدرناش نحفظ', 'er'); api.reloadBoard(); return; }
    toast('اتحفظ ✓', 'ok');
    api.reloadBoard();
  });
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
  if(!page || page.getAttribute('data-tab') !== 'count' || !cntProducts) return;
  var set = document.querySelector('#wh-count .wh-set');
  if(!set || (document.activeElement && set.contains(document.activeElement))) return;
  var tmp = document.createElement('div');
  tmp.innerHTML = settingsHtml(!!(board && board.enabled), board && board.baseline_at);
  if(tmp.firstChild) set.replaceWith(tmp.firstChild);
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
  else if(a === 'cfg-toggle') cfgSet({ enabled: !(board && board.enabled) });
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
  }
}

function onChange(e){
  var t = e.target;
  if(t && t.id === 'wh-hold') cfgSet({ hold_cancel_requested: !!t.checked });
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
function onKeyDown(e){
  var t = e.target;
  if(e.key === 'Enter' && t && t.classList && t.classList.contains('wh-ci')){
    e.preventDefault();
    var all = Array.prototype.slice.call(document.querySelectorAll('#wh-count .wh-ci'));
    var i = all.indexOf(t);
    if(i >= 0 && all[i + 1]){ all[i + 1].focus(); all[i + 1].select(); }
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
}
