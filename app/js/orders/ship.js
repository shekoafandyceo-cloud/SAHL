// شحن الأوردر من نافذة التفاصيل — مسارين حسب حالة التاجر:
//
//   «🚚 شحن أوتوماتيك»  — للتاجر الرابط مفتاح شحن (has_shipping_api):
//     Edge Function `order-ship` بتفحص وتنده ويبهوك n8n، وn8n بيحلل
//     العنوان ويعمل البوليصة ويكتب الحالة + رقم التتبع **بعد رد شركة
//     الشحن الحقيقي بس**. الويبهوك بيرد فوراً من غير نتيجة، فمصدر
//     الحقيقة هو صف الأوردر: بنعمل poll لحد ما tracking_no يظهر
//     (القياس الحي: 12–30 ثانية) — الواجهة عمرها ما تقول «اتشحن»
//     من نفسها.
//
//   «📦 اتشحن يدوي» — للتاجر اللي بيعمل البوليصة بنفسه في موقع شركة
//     الشحن (أو مش رابط API أصلاً): RPC ذري بيسجّل الحالة + رقم
//     التتبع (اختياري) بنفس شكل سجل set_order_status.
//
// الأوردر اللي له tracking_no مابيشوفش ولا زرار — بوليصة واحدة بس.

import { currentTenant, currentTenantId, currentUser } from '../auth/auth.js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../core/config.js';
import { $id, esc } from '../core/dom.js';
import { CANCELLED_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusIn, statusLabel } from '../core/constants.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { loadBostaInventoryCard, loadOrdersCards } from './cards.js';
import { detailAbort, renderDetail } from './detail.js';
import { all, fil, ordersSetSelected, sel } from './state.js';
import { renderTable } from './table.js';
import { doFilter } from './orders.js';
import { printJtAwb } from './jt-awb.js';

// المدة اللي بعدها المحاولة المعلّقة بتتحسب «ماكملتش». النجاح المقاس حي
// 12–30 ثانية والفشل أسرع — 60 ثانية (نزلت من 90 بطلب المالك 8 أغسطس:
// ضعف أبطأ نجاح مقاس، والفشل بيبان بدري).
// window.__SHIP_STALE_MIN مدخل اختبار بس — الهارنس بيقصّر العتبة.
var STALE_MINUTES = (typeof window !== 'undefined' && window.__SHIP_STALE_MIN) || 1.0;
// الـpoll: كل 3 ثواني لحد العتبة نفسها — لما يخلص من غير tracking
// العلامة بتتقلب صفرا في نفس اللحظة ورسالة بتقول
var POLL_MS = 3000, POLL_TRIES = Math.max(1, Math.round(STALE_MINUTES * 60000 / POLL_MS));

var pollTimer = null, pollOrderId = null;
// الأوردرات اللي علامتها الصفرا اترسمت خلاص — عشان التيكر مايرسمش تاني
var staleShown = {};
// سبب فشل المحاولة (جلسة محلية): بيظهر في تلميح العلامة الصفرا وفي شارة
// النافذة — بدل رسايل الـtoast اللي المالك شالها. عبر الأجهزة/الريفريش
// السبب بيضيع والعلامة بتفضل بانقلاب الوقت (عادي — التلميح العام بيكفي).
var shipFail = {};

export function hasShipApi(){
  return isJt() || !!(currentTenant && currentTenant.has_shipping_api);
}

// J&T = شركة الشحن (tenants.shipping_provider) — أسرارها في secrets الـEdge Function،
// فمفيش مفتاح على صف التاجر ومفيش has_shipping_api. الزرار بيبان بالمزوّد نفسه.
export function isJt(){
  return !!(currentTenant && currentTenant.shipping_provider === 'jt');
}

function shippable(o){
  return o && !((o.tracking_no || '').trim()) &&
    (o.status === 'pending' || o.status === 'confirmed');
}

// حالة محاولة الشحن — بتتحسب من العمود مش من ذاكرة الجلسة، فبتشتغل
// حتى لو الموظف عمل refresh أو فتح من جهاز تاني.
// null = مفيش محاولة · {stale:false} = بيتبعت · {stale:true} = ماكملتش
export function shipPendingState(o){
  if(!o || !o.shipping_requested_at || (o.tracking_no || '').trim()) return null;
  var age = (Date.now() - new Date(o.shipping_requested_at).getTime()) / 60000;
  if(isNaN(age) || age < 0) return null;
  return { stale: age >= STALE_MINUTES, ageMin: age };
}

// علامة جوه إطار شارة الحالة في الجدول (طلب المالك): الموظف بيدوس
// «شحن أوتوماتيك» ويمشي يشتغل على غيره — الجدول هو اللي بيحكي.
export function shipIndicatorHtml(o){
  if(!o || (o.tracking_no || '').trim()) return '';
  var st = shipPendingState(o);
  if(st && !st.stale)
    return '<span class="ship-ind wait" title="بيتبعت لشركة الشحن أوتوماتيك — العلامة هتتحدث لوحدها"></span>';
  var reason = shipFail[o.id];
  if(reason || (st && st.stale))
    return '<span class="ship-ind warn" title="' + esc(reason || 'محاولة الشحن الأوتوماتيك ماكملتش — افتح الأوردر واشحنه يدوي أو جرّب تاني') + '"></span>';
  return '';
}

// تحديث جراحي لعلامة صف واحد — من غير أي إعادة رسم للجدول.
// (المالك شاف الرسم الكامل بعد الضغطة كـ«ريفريش» ورفضه — الرسم الكامل
// بقى محجوز لتغيير الحالة الفعلي بس.)
function updateRowIndicator(orderId){
  var tr = document.querySelector('#tbody tr[data-id="' + orderId + '"]');
  var row = findRow(orderId);
  if(!tr || !row) return;
  var badge = tr.querySelector('.badge');
  if(!badge) return;
  var old = badge.querySelector('.ship-ind');
  if(old) old.remove();
  var html = shipIndicatorHtml(row);
  if(html) badge.insertAdjacentHTML('beforeend', html);
}

// ── الجزء اللي بيترسم جوّه نافذة التفاصيل ───────────────────────────
export function shipControlsHtml(o){
  if(!o) return '';
  var h = '';
  var req = shipPendingState(o);
  var reason = (!((o.tracking_no || '').trim()) && shipFail[o.id]) || null;
  if(req && !req.stale){
    h += '<div class="ship-chip wait" id="ship-chip"><span class="spin sm"></span> بيتبعت لشركة الشحن... تقدر تقفل وتكمّل شغلك — العلامة جنب الحالة هتتحدث لوحدها</div>';
  }else if(reason){
    h += '<div class="ship-chip warn" id="ship-chip">⚠️ ' + esc(reason) + '</div>';
  }else if(req && req.stale){
    h += '<div class="ship-chip warn" id="ship-chip">⚠️ فيه محاولة شحن ماكملتش — راجع العنوان وجرّب تاني. الحالة ماتغيّرتش ومفيش بوليصة اتعملت.</div>';
  }
  if(isJt() && !reason && !(req && !req.stale) && (o.jt_ship_error || '').trim() && !((o.tracking_no || '').trim())){
    h += '<div class="ship-chip warn" id="ship-chip">⚠️ آخر محاولة J&T: ' + esc(o.jt_ship_error) + '</div>';
  }
  if(shippable(o) && hasShipApi() && !(req && !req.stale)){
    h += '<button class="ship-auto-btn" id="ship-auto">' + (isJt() ? '🚚 شحن J&T — إنشاء بوليصة' : '🚚 شحن أوتوماتيك — إنشاء بوليصة') + '</button>';
  }
  return h;
}

export function wireShipControls(){
  var b = $id('ship-auto');
  if(b) b.addEventListener('click', function(){ autoShipFlow(); });
}

// ── المسار اليدوي — من زرار «📦 اتشحن يدوي» (da-bs) ─────────────────
export function manualShipFlow(){
  var ord = sel;
  if(!ord) return;
  if((ord.tracking_no || '').trim()){
    toast('الأوردر له بوليصة بالفعل (' + ord.tracking_no + ')','er');
    return;
  }
  showModal({
    icon: '📦',
    title: 'الأوردر اتشحن يدوي؟',
    sub: 'هيتعلّم «شحن» من غير ما نبعت حاجة لشركة الشحن.\nلو معاك رقم البوليصة (التتبع) حطه هنا — بيفعّل التتبع والجرد. ولو مفيش سيبه فاضي.',
    input: true,
    inputOptional: true,   // «اختياري» في الـplaceholder لازم يبقى حقيقي
    placeholder: 'رقم التتبع (اختياري)',
    okLabel: 'تعليم كأنه اتشحن',
    okColor: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
    onOk: function(val){
      var trk = String(val || '').trim();
      sb.rpc('mark_shipped_manual', {
        p_order_id: ord.id,
        p_tracking: trk || null,
        p_by: currentUser ? currentUser.name : 'يدوي'
      }).then(function(r){
        if(r.error){
          var m = r.error.message || '';
          if(m.indexOf('already_has_tracking') >= 0) toast('الأوردر له بوليصة بالفعل — حدّث الصفحة','er');
          else if(m.indexOf('bad_status') >= 0) toast('الأوردر في حالة نهائية — لو محتاج ترجّعه غيّر الحالة من القايمة الأول','er');
          else toast('خطأ: ' + m,'er');
          return;
        }
        // «الموظف يدوس ويمشي» — نفس عقد الأوتوماتيك: النافذة بتتقفل مع
        // التأكيد. القفل لازم يسبق applyShipped: لو sel لسه شايل الأوردر،
        // applyShipped هترندر التفاصيل تاني والنافذة تفضل مفتوحة
        if(sel && sel.id === ord.id){
          $id('ovl').classList.remove('open');
          ordersSetSelected(null);
          detailAbort();
        }
        applyShipped(ord.id, 'bosta_assigned', trk || null);
        toast('اتعلّم «شحن»' + (trk ? ' ورقم التتبع اتسجل ✓' : ' ✓'),'ok');
      });
    }
  });
}

// ── المسار الأوتوماتيك — بوليصة حقيقية بفلوس ────────────────────────
function autoShipFlow(){
  var ord = sel;
  if(!ord || !shippable(ord)) return;
  if(isJt()){ jtShipFlow(ord); return; }
  showModal({
    icon: '🚚',
    title: 'إنشاء بوليصة حقيقية',
    sub: 'هيتبعت لشركة الشحن على حسابك وهتتعمل بوليصة بفلوس حقيقية.\nالنظام هيحلل العنوان ويأكدلك النتيجة هنا — الحالة مش هتتغير غير لما البوليصة تتعمل فعلاً.',
    okLabel: 'اشحن الأوردر',
    okColor: 'linear-gradient(135deg,#10b981,#059669)',
    onOk: function(){ callShipFunction(ord); }
  });
}

async function callShipFunction(ord){
  // النافذة بتتقفل فوراً والموظف يكمّل شغله — **من غير أي toast ولا أي
  // إعادة رسم للجدول** (طلب المالك بعد التجربة الحية التالتة): العلامة
  // جنب الحالة هي القناة الوحيدة، وبتتحدث بتحديث جراحي لخلية الصف بس.
  // الرسم الكامل محجوز لتغيير الحالة الفعلي (البوليصة وصلت).
  if(sel && sel.id === ord.id){
    $id('ovl').classList.remove('open');
    ordersSetSelected(null);
    detailAbort();
  }
  delete shipFail[ord.id];
  delete staleShown[ord.id];
  var row = findRow(ord.id);
  var optimistic = new Date().toISOString();
  if(row) row.shipping_requested_at = optimistic;
  updateRowIndicator(ord.id);
  var out = {};
  try{
    var sess = await sb.auth.getSession();
    var tk = sess && sess.data && sess.data.session ? sess.data.session.access_token : null;
    if(!tk) throw new Error('جلسة الدخول انتهت. سجّل دخول تاني.');
    // 🔴 مفيش tenant_id في الطلب — السيرفر بياخده من الـJWT (نفس ثابت tenant-staff)
    var res = await fetch(SUPABASE_URL + '/functions/v1/order-ship', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + tk },
      body: JSON.stringify({ order_id: ord.id })
    });
    out = await res.json().catch(function(){ return {}; });
    if(!res.ok || !out.ok) throw new Error(out.message || 'حصلت مشكلة — حاول تاني');
  }catch(e){
    // الطلب اترفض قبل ما يتبعت أصلاً — العلامة بتتقلب صفرا فوراً والسبب
    // الحقيقي جوّاها (تلميح الماوس + شارة النافذة لو اتفتح) — مفيش toast
    if(row && row.shipping_requested_at === optimistic) row.shipping_requested_at = null;
    shipFail[ord.id] = String(e.message || e);
    updateRowIndicator(ord.id);
    if(sel && sel.id === ord.id) renderDetail();
    return;
  }
  if(row) row.shipping_requested_at = out.requested_at || optimistic;
  startPoll(ord.id);
}

function startPoll(orderId){
  stopPoll();
  pollOrderId = orderId;
  var tries = 0;
  pollTimer = setInterval(function(){
    tries++;
    sb.from('orders').select('id,status,tracking_no,shipping_requested_at')
      .eq('id', orderId).eq('tenant_id', currentTenantId).single()
      .then(function(r){
        if(pollOrderId !== orderId) return;         // اتلغى — محاولة أجدد بدأت
        var d = r && r.data;
        var row = findRow(orderId);
        var uid = row && row.order_uid ? ('#' + row.order_uid) : '';
        if(d && (d.tracking_no || '').trim()){
          stopPoll();
          applyShipped(orderId, d.status, d.tracking_no, d.shipping_requested_at);
          toast('البوليصة اتعملت لأوردر ' + uid + ' ✓ رقم التتبع: ' + d.tracking_no,'ok');
          return;
        }
        if(tries >= POLL_TRIES){
          // العتبة خلصت من غير بوليصة — العلامة بتتقلب صفرا (تحديث جراحي
          // للصف بس، من غير toast ولا رسم كامل — قرار المالك)
          stopPoll();
          shipFail[orderId] = 'محاولة الشحن الأوتوماتيك ماكملتش — راجع العنوان واشحنه يدوي أو جرّب تاني';
          staleShown[orderId] = true;
          updateRowIndicator(orderId);
          if(sel && sel.id === orderId) renderDetail();
        }
      });
  }, POLL_MS);
}

function stopPoll(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  pollOrderId = null;
}

function findRow(id){
  for(var i=0;i<fil.length;i++) if(fil[i].id===id) return fil[i];
  for(var j=0;j<all.length;j++) if(all[j].id===id) return all[j];
  return null;
}

// نجاح (يدوي أو أوتوماتيك): تحديث الذاكرة المحلية + الجدول + النافذة
function applyShipped(orderId, status, tracking, requestedAt){
  delete shipFail[orderId]; delete staleShown[orderId];
  var row = findRow(orderId);
  if(row){
    row.status = status || row.status;
    if(tracking) row.tracking_no = tracking;
    if(requestedAt !== undefined) row.shipping_requested_at = requestedAt;
    row.status_changed_at = new Date().toISOString();
  }
  if(sel && sel.id === orderId){
    sel.status = status || sel.status;
    if(tracking) sel.tracking_no = tracking;
    renderDetail();
  }
  loadOrdersCards(); loadBostaInventoryCard(); doFilter();
}



// ── مسار J&T — نافذة الشحن (المحافظة/المدينة/المنطقة بأسماء J&T + الوزن) ──
// 🔴 J&T بترفض أي اسم محافظة/مدينة مش من نطاقها (145003060–61)، فالاتنين اختيار من قايمة
// jt_pca (القايمة الرسمية من J&T IT — 267 مدينة) مش كتابة حرة. المدينة اللي جت من اللاندنج
// بتتحط كاقتراح بس — ⚠️ وهي فعلياً **اسم محافظة** (765 أوردر «القاهره» في 30 يوم)، وعشان كده
// التطبيع بيطابق على المحافظات الأول ثم المدن، وJ&T مسجّلة اسم كل محافظة كمدينة جوّاها كمان.
// 🔴 المنطقة (area) **نص حر مطلوب** — قرار المالك 21 سبتمبر من قالب الرفع في البوابة: «الخانة
// التالتة مطلوبة بس ملهاش اسطمبة أصلاً». صف area='' في jt_pca = المدينة متسجّلة والمنطقة حرة؛
// والاقتراحات في الـdatalist جاية من app/data/jt-areas.json (6,464 منطقة من ملف J&T IT).
// 🔴 الاقتراحات **مش قيد** — والدليل مقيس: 4 من أول 5 شحنات إنتاج حقيقية اتعملت بمناطق
// مش في الملف ده (ميامي · المنزه ثاني · التجمع الخامس · المحمودية) وJ&T قبلت الخمسة،
// و«شمال سيناء» جه من J&T بلا أي منطقة خالص. فشل تحميل الملف = الاقتراحات بس اللي بتضيع.
// ⚠️ المناطق في ملف ساكن مش في jt_pca عمداً: هي عرض بحت (الحارس في jt-ship بيتحقق من
// prov+city بس)، و6.4k صف في الجدول كانوا هيبقوا 7 نداءات PostgREST كل جلسة بلا فايدة.
// الإنشاء نفسه في Edge Function jt-ship (تسجيل البوليصة وكود الفرز بعد رد J&T).
var jtPca = null, jtPcaLoading = null, jtAreas = null, jtAreasLoading = null;
function jtNorm(s){
  return String(s || '').replace(/[ً-ْـ‎‏؜]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^ال/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
async function jtLoadPca(){
  if(jtPca) return jtPca;
  if(jtPcaLoading) return jtPcaLoading;
  jtPcaLoading = (async function(){
    // صفوف المدن بس (area='') — دي فهرس المحافظة/المدينة اللي الحارس بيتحقق منه.
    var rows = [], from = 0, page = 1000;
    for(var i = 0; i < 30; i++){
      var r = await sb.from('jt_pca').select('prov,city,area').eq('area', '').order('id').range(from, from + page - 1);
      if(r.error) throw new Error(r.error.message);
      var d = r.data || [];
      rows = rows.concat(d);
      if(d.length < page) break;
      from += page;
    }
    jtPca = rows;
    return rows;
  })();
  try{ return await jtPcaLoading; } finally { jtPcaLoading = null; }
}
// اقتراحات المناطق: { محافظة: { مدينة: [مناطق] } } — ملف ساكن جنب اللوحة.
// المسار من import.meta.url عشان يشتغل على الجذر وعلى أي مجلد فرعي (المعاينة) زي router.js.
// 🔴 الفشل **مايوقفش الشحن**: مفيش اقتراحات والكتابة الحرة زي ما هي.
async function jtLoadAreas(){
  if(jtAreas) return jtAreas;
  if(jtAreasLoading) return jtAreasLoading;
  jtAreasLoading = (async function(){
    try{
      var res = await fetch(new URL('../../data/jt-areas.json', import.meta.url).href, { cache: 'force-cache' });
      jtAreas = res.ok ? await res.json() : {};
    }catch(e){ jtAreas = {}; }
    return jtAreas;
  })();
  try{ return await jtAreasLoading; } finally { jtAreasLoading = null; }
}
function jtUniq(list){ var seen = {}, out = []; list.forEach(function(x){ if(x && !seen[x]){ seen[x] = 1; out.push(x); } }); return out; }
function jtOpts(sel, values, chosen, placeholder){
  sel.innerHTML = '<option value="">' + esc(placeholder) + '</option>' + values.map(function(v){ return '<option value="' + esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
}
function jtModalEl(){
  var bd = $id('jt-modal');
  if(bd) return bd;
  bd = document.createElement('div');
  bd.id = 'jt-modal'; bd.className = 'jt-bd';
  bd.innerHTML = '<div class="jt-box" role="dialog" aria-modal="true">'
    + '<div class="jt-ttl">🚚 شحنة J&T — <span id="jt-uid"></span></div>'
    + '<div class="jt-sub" id="jt-sub"></div>'
    + '<div class="jt-grid">'
    + '<label>المحافظة<select class="fsel" id="jt-prov"></select></label>'
    + '<label>المدينة<select class="fsel" id="jt-city"></select></label>'
    + '<label>المنطقة (اكتبها)<input class="fsel" id="jt-area" type="text" maxlength="60" list="jt-area-list" placeholder="مثال: الحي السابع" autocomplete="off"><datalist id="jt-area-list"></datalist></label>'
    + '<label>الوزن (كجم)<input class="fsel" id="jt-weight" type="number" min="0.1" step="0.1" inputmode="decimal"></label>'
    + '</div>'
    + '<div class="jt-note" id="jt-note"></div>'
    + '<div class="jt-err" id="jt-err"></div>'
    + '<div class="dacts"><button class="abtn ok" id="jt-go">إنشاء البوليصة عند J&T</button><button class="abtn" id="jt-cancel">إلغاء</button></div>'
    + '<div class="dacts" id="jt-done" style="display:none"><button class="abtn bs" id="jt-print">🖨️ اطبع البوليصة المعتمدة</button><button class="abtn" id="jt-close">إغلاق</button></div>'
    + '</div>';
  document.body.appendChild(bd);
  bd.addEventListener('click', function(e){ if(e.target === bd) jtClose(); });
  $id('jt-cancel').addEventListener('click', jtClose);
  $id('jt-close').addEventListener('click', jtClose);
  return bd;
}
function jtClose(){ var bd = $id('jt-modal'); if(bd) bd.classList.remove('open'); }

async function jtShipFlow(ord){
  var bd = jtModalEl();
  bd.classList.add('open');
  $id('jt-uid').textContent = '#' + (ord.order_uid || '');
  $id('jt-sub').textContent = (ord.customer_name || '') + ' · ' + (ord.phone || '') + ' · ' + (ord.city || '') + '\n' + (ord.address || '');
  $id('jt-err').textContent = '';
  $id('jt-note').textContent = 'اختار المحافظة والمدينة بأسماء J&T (اسم غلط = J&T ترفض الشحنة) — الاقتراح جاي من مدينة اللاندنج. المنطقة اكتبها زي ما هي في العنوان (نص حر، مطلوبة).';
  $id('jt-done').style.display = 'none';
  $id('jt-go').style.display = ''; $id('jt-cancel').style.display = '';
  $id('jt-go').disabled = true; $id('jt-go').textContent = '⏳ بنحمّل نطاق J&T...';
  var provSel = $id('jt-prov'), citySel = $id('jt-city'), areaIn = $id('jt-area'), areaList = $id('jt-area-list'), wIn = $id('jt-weight');
  wIn.value = ord.shipping_weight_kg > 0 ? ord.shipping_weight_kg : 1;
  areaIn.value = ord.ship_area || '';
  // الاقتراحات بتتحمّل بالتوازي ومابتوقفش فتح النافذة — لما توصل بنعيد ملّ الـdatalist.
  jtLoadAreas().then(function(){ try{ fillAreas(); }catch(e){} });
  var pca;
  try{ pca = await jtLoadPca(); }catch(e){ $id('jt-err').textContent = 'مقدرناش نحمّل نطاق J&T: ' + (e.message || e); $id('jt-go').textContent = 'إنشاء البوليصة عند J&T'; return; }
  if(!pca.length){ $id('jt-err').textContent = 'نطاق J&T (jt_pca) فاضي — لازم يتعمل pca_sync الأول.'; $id('jt-go').textContent = 'إنشاء البوليصة عند J&T'; return; }
  var provs = jtUniq(pca.map(function(x){ return x.prov; }));
  // اقتراح: المحفوظ على الأوردر → مطابقة المدينة على المحافظات ثم المدن
  var k = jtNorm(ord.city);
  var guessProv = ord.ship_prov || provs.filter(function(p){ return jtNorm(p) === k; })[0] || '';
  var guessCity = ord.ship_city || '';
  if(!guessProv && k){
    var hit = pca.filter(function(x){ return jtNorm(x.city) === k; })[0];
    if(hit){ guessProv = hit.prov; guessCity = hit.city; }
  }
  function fillCities(){
    var cities = jtUniq(pca.filter(function(x){ return x.prov === provSel.value; }).map(function(x){ return x.city; }));
    jtOpts(citySel, cities, guessCity, 'اختار المدينة');
    if(cities.length === 1){ citySel.value = cities[0]; }
    fillAreas();
  }
  function fillAreas(){
    // اقتراحات بس (datalist) — الكتابة الحرة هي الأصل، والقايمة ممكن تبقى فاضية تماماً
    // (شمال سيناء مثلاً مالهاش ولا منطقة عند J&T) وده **مش عطل**.
    var byProv = (jtAreas && jtAreas[provSel.value]) || null;
    var areas = jtUniq((byProv && byProv[citySel.value]) || []);
    areaList.innerHTML = areas.map(function(a){ return '<option value="' + esc(a) + '"></option>'; }).join('');
  }
  jtOpts(provSel, provs, guessProv, 'اختار المحافظة');
  fillCities();
  provSel.onchange = function(){ guessCity = ''; fillCities(); };
  citySel.onchange = fillAreas;
  $id('jt-go').disabled = false; $id('jt-go').textContent = 'إنشاء البوليصة عند J&T';
  $id('jt-go').onclick = function(){ jtSubmit(ord); };
}

async function jtSubmit(ord){
  var prov = $id('jt-prov').value, city = $id('jt-city').value, area = $id('jt-area').value.replace(/\s+/g, ' ').trim(), w = parseFloat($id('jt-weight').value);
  var err = $id('jt-err');
  if(!prov || !city){ err.textContent = 'اختار المحافظة والمدينة الأول'; return; }
  if(!area){ err.textContent = 'اكتب المنطقة — J&T بتطلبها (أي اسم من العنوان: الحي / المنطقة / الشارع الرئيسي)'; return; }
  if(!(w > 0)){ err.textContent = 'الوزن لازم يبقى أكبر من صفر'; return; }
  var btn = $id('jt-go');
  btn.disabled = true; btn.textContent = '⏳ بنبعت لـJ&T...'; err.textContent = '';
  var out = {};
  try{
    var sess = await sb.auth.getSession();
    var tk = sess && sess.data && sess.data.session ? sess.data.session.access_token : null;
    if(!tk) throw new Error('جلسة الدخول انتهت. سجّل دخول تاني.');
    var res = await fetch(SUPABASE_URL + '/functions/v1/jt-ship', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + tk },
      body: JSON.stringify({ order_id: ord.id, receiver: { prov: prov, city: city, area: area }, weight_kg: w })
    });
    out = await res.json().catch(function(){ return {}; });
    if(!res.ok || !out.ok) throw new Error(out.message || 'حصلت مشكلة — حاول تاني');
  }catch(e){
    btn.disabled = false; btn.textContent = 'إنشاء البوليصة عند J&T';
    err.textContent = String(e.message || e);
    var row0 = findRow(ord.id); if(row0) row0.jt_ship_error = String(e.message || e);
    shipFail[ord.id] = String(e.message || e); updateRowIndicator(ord.id);
    return;
  }
  // نجاح: الصف والجدول بيتحدّثوا من رد J&T (البوليصة + كود الفرز)
  var row = findRow(ord.id);
  if(row){ row.shipping_carrier = 'jt'; row.jt_sorting_code = out.sorting_code || null; row.jt_ship_error = null; row.ship_prov = prov; row.ship_city = city; row.ship_area = area; row.shipping_weight_kg = w; }
  if(sel && sel.id === ord.id){ sel.shipping_carrier = 'jt'; sel.jt_sorting_code = out.sorting_code || null; sel.jt_ship_error = null; }
  applyShipped(ord.id, (out.record && out.record.status) || 'BOSTA AUTO', out.tracking_no);
  toast('البوليصة اتعملت عند J&T ✓ ' + out.tracking_no + (out.sorting_code ? ' · كود الفرز ' + out.sorting_code : ''), 'ok');
  $id('jt-note').textContent = 'رقم البوليصة: ' + out.tracking_no + '\nكود الفرز: ' + (out.sorting_code || '— (J&T مرجّعتش كود)') + (out.recovered ? '\n(الشحنة كانت متعملة عند J&T من محاولة سابقة — اتسجّلت من غير تكرار)' : '');
  btn.style.display = 'none'; $id('jt-cancel').style.display = 'none';
  $id('jt-done').style.display = '';
  $id('jt-print').onclick = function(){ printJtAwb([ord.id]); };
}

// ── تيكر الجدول ─────────────────────────────────────────────────────
// نافذة المتابعة: من لحظة الطلب لحد ما يبقى قديم بمدة كافية إن العلامة
// الصفرا تكون اترسمت — بعدها مفيش داعي لإعادة الجلب كل 30 ثانية
var TICK_MS = (typeof window !== 'undefined' && window.__SHIP_TICK_MS) || 30000;
var WATCH_WINDOW_MIN = STALE_MINUTES + 10;

// حالات نهائية — الشحنة خلصت رحلتها فمفيش مسح جديد جاي ليها.
// أي حاجة غير دي على أوردر J&T معناها إنه لسه في السكة وتحديثه ممكن ييجي
// في أي لحظة.
function shipmentSettled(o){
  return statusIn(o && o.status, DELIVERED_STATUSES)
      || statusIn(o && o.status, RETURNED_STATUSES)
      || statusIn(o && o.status, CANCELLED_STATUSES);
}

export function initShipTicker(){
  setInterval(function(){
    // صفوف الجدول في fil (الصفحة الحالية من السيرفر) — وall مخزن
    // الماليات الكسول وممكن يبقى فاضي. بنمسح الاتنين.
    var watch = [], seen = {}, flipped = [];
    var scan = fil.concat(all);
    for(var i=0;i<scan.length;i++){
      var o = scan[i];
      if(seen[o.id]) continue;
      // (أ) محاولة شحن معلّقة — لسه مفيش بوليصة
      if(o.shipping_requested_at && !(o.tracking_no||'').trim()){
        var age = (Date.now() - new Date(o.shipping_requested_at).getTime()) / 60000;
        if(age >= 0 && age < WATCH_WINDOW_MIN){
          seen[o.id] = true; watch.push(o.id);
          // العلامة اتقلبت صفرا من آخر رسمة؟ تحديث جراحي للصف ده بس —
          // الرسم الكامل كان باين للمالك كـ«ريفريش على الفاضي» واترفض
          if(age >= STALE_MINUTES && !staleShown[o.id]){ staleShown[o.id] = true; flipped.push(o.id); }
          continue;
        }
      }
      // (ب) 🔴 شحنة J&T لسه في السكة — شبكة أمان للريل-تايم.
      // `postgres_changes` مافيهوش replay: أي تحديث بيوصل والـsocket
      // مقفول (تاب نايمة · نت قطع · الجهاز قفل) بيضيع للأبد، والموظف
      // بيفضل بصّ على حالة قديمة والنقطة خضرا. الجلب ده بيصلّحها لوحده.
      // محصور في الصفحة المعروضة — ده اللي الموظف شايفه فعلاً.
      if(o.shipping_carrier === 'jt' && (o.tracking_no||'').trim() && !shipmentSettled(o)){
        seen[o.id] = true; watch.push(o.id);
      }
    }
    flipped.forEach(updateRowIndicator);
    if(!watch.length || !sb || !currentTenantId) return;
    // **صامت**: مفيش أي رسم غير لو فيه تغيير فعلي من السيرفر أو انقلاب علامة.
    sb.from('orders').select('id,status,tracking_no,shipping_requested_at,carrier_status_raw,carrier_status_at')
      .eq('tenant_id', currentTenantId).in('id', watch)
      .then(function(r){
        var changed = false;
        (r && r.data || []).forEach(function(d){
          var row = findRow(d.id);
          if(!row) return;
          if((d.tracking_no||'') !== (row.tracking_no||'') || d.status !== row.status){
            var hadTracking = (row.tracking_no||'').trim();
            row.status = d.status; row.tracking_no = d.tracking_no;
            row.shipping_requested_at = d.shipping_requested_at;
            row.carrier_status_raw = d.carrier_status_raw;
            row.carrier_status_at = d.carrier_status_at;
            changed = true;
            delete staleShown[d.id]; delete shipFail[d.id];
            if(!hadTracking && (d.tracking_no||'').trim())
              toast('البوليصة اتعملت لأوردر #' + (row.order_uid || '') + ' ✓ رقم التتبع: ' + d.tracking_no,'ok');
            else if(hadTracking)
              toast('🚚 طلب #' + (row.order_uid || '') + ' بقى «' + statusLabel(d.status) + '»','ok');
            // النافذة مفتوحة على نفس الأوردر؟ تتحدث معاه
            if(sel && sel.id === d.id){
              sel.status = d.status;
              sel.carrier_status_raw = d.carrier_status_raw;
              sel.carrier_status_at = d.carrier_status_at;
              try{ if($id('ovl').classList.contains('open')) renderDetail(); }catch(e){}
            }
          }
        });
        // الرسم الكامل عند تغيير الحالة الفعلي بس — ده المسموح
        if(changed){ renderTable(); loadOrdersCards(); loadBostaInventoryCard(); }
      });
  }, TICK_MS);
}
