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
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { loadBostaInventoryCard, loadOrdersCards } from './cards.js';
import { detailAbort, renderDetail } from './detail.js';
import { all, fil, ordersSetSelected, sel } from './state.js';
import { renderTable } from './table.js';
import { doFilter } from './orders.js';

// المدة اللي بعدها المحاولة المعلّقة بتتحسب «ماكملتش». النجاح المقاس حي
// 12–30 ثانية والفشل في n8n بييجي أسرع (اتقاس ~12ث) — 90 ثانية = هامش
// تلات أضعاف من غير ما الموظف يفضل شايف علامة بتلف على محاولة ميتة.
// (كانت 3 دقايق والمالك شافها طويلة على الهواء — الفشل كان باين في n8n
// بعد 12 ثانية والعلامة لسه بتلف بعد دقيقة.)
// window.__SHIP_STALE_MIN مدخل اختبار بس — الهارنس بيقصّر العتبة.
var STALE_MINUTES = (typeof window !== 'undefined' && window.__SHIP_STALE_MIN) || 1.5;
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
  return !!(currentTenant && currentTenant.has_shipping_api);
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
  if(shippable(o) && hasShipApi() && !(req && !req.stale)){
    h += '<button class="ship-auto-btn" id="ship-auto">🚚 شحن أوتوماتيك — إنشاء بوليصة</button>';
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



// ── تيكر الجدول ─────────────────────────────────────────────────────
// نافذة المتابعة: من لحظة الطلب لحد ما يبقى قديم بمدة كافية إن العلامة
// الصفرا تكون اترسمت — بعدها مفيش داعي لإعادة الجلب كل 30 ثانية
var TICK_MS = (typeof window !== 'undefined' && window.__SHIP_TICK_MS) || 30000;
var WATCH_WINDOW_MIN = STALE_MINUTES + 10;

export function initShipTicker(){
  setInterval(function(){
    // صفوف الجدول في fil (الصفحة الحالية من السيرفر) — وall مخزن
    // الماليات الكسول وممكن يبقى فاضي. بنمسح الاتنين.
    var watch = [], seen = {}, flipped = [];
    var scan = fil.concat(all);
    for(var i=0;i<scan.length;i++){
      var o = scan[i];
      if(seen[o.id] || !o.shipping_requested_at || (o.tracking_no||'').trim()) continue;
      seen[o.id] = true;
      var age = (Date.now() - new Date(o.shipping_requested_at).getTime()) / 60000;
      if(age < 0 || age >= WATCH_WINDOW_MIN) continue;
      watch.push(o.id);
      // العلامة اتقلبت صفرا من آخر رسمة؟ تحديث جراحي للصف ده بس —
      // الرسم الكامل كان باين للمالك كـ«ريفريش على الفاضي» واترفض
      if(age >= STALE_MINUTES && !staleShown[o.id]){ staleShown[o.id] = true; flipped.push(o.id); }
    }
    flipped.forEach(updateRowIndicator);
    if(!watch.length || !sb || !currentTenantId) return;
    // إعادة جلب الصفوف المعلّقة بس — لو النجاح وصل والـRealtime فاتته
    // (تاب مفصول مثلاً) العلامة بتتصلّح من هنا. **صامت**: مفيش أي رسم
    // غير لو فيه تغيير فعلي من السيرفر أو انقلاب علامة.
    sb.from('orders').select('id,status,tracking_no,shipping_requested_at')
      .eq('tenant_id', currentTenantId).in('id', watch)
      .then(function(r){
        var changed = false;
        (r && r.data || []).forEach(function(d){
          var row = findRow(d.id);
          if(!row) return;
          if((d.tracking_no||'') !== (row.tracking_no||'') || d.status !== row.status){
            row.status = d.status; row.tracking_no = d.tracking_no;
            row.shipping_requested_at = d.shipping_requested_at;
            changed = true;
            delete staleShown[d.id]; delete shipFail[d.id];
            if((d.tracking_no||'').trim())
              toast('البوليصة اتعملت لأوردر #' + (row.order_uid || '') + ' ✓ رقم التتبع: ' + d.tracking_no,'ok');
          }
        });
        // الرسم الكامل عند تغيير الحالة الفعلي بس — ده المسموح
        if(changed){ renderTable(); loadOrdersCards(); loadBostaInventoryCard(); }
      });
  }, TICK_MS);
}
