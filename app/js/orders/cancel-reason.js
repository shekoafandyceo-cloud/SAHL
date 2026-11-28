// سبب الإلغاء — قايمة أسباب ثابتة بضغطة (v90 · 28 نوفمبر 2026 — طلب المالك)
//
// قبل كده: خانة كتابة حرة إجبارية — والنتيجة 361 إلغاء في نوفمبر مايتحللوش (كلام مش سبب).
// دلوقتي: أزرار — يضغط السبب ويأكد، من غير كتابة. الملاحظة اختيارية (إجبارية لـ«سبب تاني» بس).
//
// 🔴 النص اللي بيتبعت للسيرفر = `label` بالحرف (+ « — ملاحظة») في نفس `p_cancel_reason` القديم —
//    مفيش تغيير في `set_order_status`. التصنيف بيتعمل على السيرفر من أول النص
//    (`app.cancel_reason_code` — migration `cancel_report`)، فالـlabels هنا وهناك لازم يفضلوا
//    متطابقين بالحرف (`tools/test-cancel-reason.mjs` بيقارنهم).
//
// 🔴 مفيش قفل: الموظف يقدر يلغي دايماً. اللي ناقصه محاولات اتصال بيشوف سطر تنبيه بس،
//    والإلغاء بيتعلّم «مبكر» في تقرير الأدمن (السيرفر هو اللي بيحسبها — مش الواجهة).

import { $id, esc } from '../core/dom.js';
import { isAdmin } from './guards.js';

export var CANCEL_REASONS = [
  { code: 'no_answer',    ic: '📵', label: 'العميل مش بيرد أو التليفون مقفول' },
  { code: 'changed_mind', ic: '🔄', label: 'العميل غيّر رأيه' },
  { code: 'price',        ic: '💸', label: 'السعر غالي أو عايز خصم' },
  { code: 'size',         ic: '📏', label: 'المقاس مش مناسب' },
  { code: 'other_model',  ic: '📦', label: 'عايز موديل تاني مش متوفر' },
  { code: 'expectation',  ic: '🤔', label: 'فاكر المنتج حاجة تانية' },
  { code: 'duplicate',    ic: '👥', label: 'أوردر مكرر' },
  { code: 'fake',         ic: '👻', label: 'أوردر وهمي' },
  { code: 'wrong_number', ic: '☎️', label: 'الرقم غلط' },
  { code: 'address',      ic: '📍', label: 'مشكلة عنوان أو استلام' },
  { code: 'deposit',      ic: '💳', label: 'رفض الديبوزت' },
  { code: 'other',        ic: '✏️', label: 'سبب تاني', needNote: true }
];

// الأسباب اللي «من غير أي تواصل» بيتعلّم عليها مبكر — نفس قايمة السيرفر (no_contact)
var NEED_CONTACT = ['changed_mind', 'price', 'size', 'other_model', 'expectation', 'address', 'deposit', 'other'];
export var CR_MIN_CALLS = 3;      // «مش بيرد» = 3 محاولات
export var CR_MIN_DAYS = 2;       // على يومين
var NOTE_MAX = 160;

function cairoDay(iso){
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); } catch (e) { return ''; }
}

// محاولات الاتصال المتسجّلة على الأوردر: العدد وعدد الأيام المختلفة (القاهرة)
export function callStats(ord){
  var calls = (ord && Array.isArray(ord.call_attempts)) ? ord.call_attempts : [];
  var days = {};
  calls.forEach(function(c){ var d = c && c.iso ? cairoDay(c.iso) : ''; if (d && d !== 'Invalid Date') days[d] = 1; });
  return { calls: calls.length, days: Object.keys(days).length };
}

// سطر التنبيه (مش قفل) — null = مفيش تنبيه. الأدمن مابيتعلّمش عليه فمالوش تنبيه.
export function cancelEarlyHint(code, ord){
  if (!ord || !code || isAdmin()) return null;
  var st = callStats(ord);
  if (code === 'no_answer') {
    if (st.calls >= CR_MIN_CALLS && st.days >= CR_MIN_DAYS) return null;
    var have = st.calls === 0 ? 'مفيش ولا محاولة اتصال متسجّلة'
      : st.calls === 1 ? 'متسجّل محاولة اتصال واحدة'
      : st.calls === 2 ? 'متسجّل محاولتين اتصال'
      : 'متسجّل ' + st.calls + ' محاولات في يوم واحد';
    return have + ' — «مش بيرد» بيتحسب بعد ' + CR_MIN_CALLS + ' محاولات على يومين. تقدر تلغي عادي، بس الإلغاء هيتعلّم «مبكر» عند الأدمن.';
  }
  if (NEED_CONTACT.indexOf(code) < 0 || st.calls > 0) return null;
  var log = '';
  try { log = typeof ord.status_log === 'string' ? ord.status_log : JSON.stringify(ord.status_log || ''); } catch (e) { log = ''; }
  if (log.indexOf('confirmed') >= 0) return null;                     // اتأكد قبل كده
  var age = Date.now() - new Date(ord.created_at || 0).getTime();
  if (!(age >= 0 && age < 24 * 3600 * 1000)) return null;             // عدّى عليه يوم
  return 'مفيش محاولة اتصال متسجّلة على الأوردر ده — لو العميل ماكتبش في الواتساب، الإلغاء هيتعلّم «مبكر» عند الأدمن.';
}

// النص اللي بيتسجّل: label بالحرف (+ « — ملاحظة»)
export function cancelReasonText(code, note){
  var r = null;
  for (var i = 0; i < CANCEL_REASONS.length; i++) if (CANCEL_REASONS[i].code === code) r = CANCEL_REASONS[i];
  if (!r) return '';
  var n = String(note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  return r.label + (n ? ' — ' + n : '');
}

// label المعروض لكود (للتقرير) — الأكواد اللي مش في القايمة ليها أسامي ثابتة هناك
export function cancelReasonLabel(code){
  for (var i = 0; i < CANCEL_REASONS.length; i++) if (CANCEL_REASONS[i].code === code) return CANCEL_REASONS[i].label;
  return null;
}

var crState = { code: null, cb: null, ord: null, busy: false };

function crBuild(){
  if ($id('cr-bd')) return;
  var bd = document.createElement('div');
  bd.className = 'jt-bd cr-bd';
  bd.id = 'cr-bd';
  bd.innerHTML = '<div class="jt-box cr-box" role="dialog" aria-modal="true" aria-labelledby="cr-title">'
    + '<div class="cr-title" id="cr-title">❌ سبب الإلغاء</div>'
    + '<div class="cr-sub">اختار السبب وبعدين «إلغاء الطلب»</div>'
    + '<div class="cr-grid" id="cr-grid">'
    + CANCEL_REASONS.map(function(r){
        return '<button type="button" class="cr-opt" data-code="' + esc(r.code) + '"><span class="cr-ic">' + r.ic + '</span><span class="cr-lb">' + esc(r.label) + '</span></button>';
      }).join('')
    + '</div>'
    + '<input type="text" id="cr-note" class="cr-note" maxlength="' + NOTE_MAX + '" autocomplete="off" placeholder="ملاحظة (اختياري)">'
    + '<div class="cr-hint" id="cr-hint" style="display:none"></div>'
    + '<div class="cr-acts">'
    + '<button type="button" class="cr-x" id="cr-x">رجوع</button>'
    + '<button type="button" class="cr-ok off" id="cr-ok">إلغاء الطلب</button>'
    + '</div></div>';
  document.body.appendChild(bd);

  $id('cr-grid').addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('.cr-opt') : null;
    if (b) crPick(b.getAttribute('data-code'));
  });
  $id('cr-ok').addEventListener('click', crConfirm);
  $id('cr-x').addEventListener('click', crClose);
  bd.addEventListener('click', function(e){ if (e.target === bd) crClose(); });
  $id('cr-note').addEventListener('keydown', function(e){
    if (e.key === 'Enter') { e.preventDefault(); crConfirm(); }
    else $id('cr-note').classList.remove('bad');
  });
  // Esc بيقفل النافذة دي بس — على window بالـcapture عشان هاندلر orders.js (على document) مايقفلش
  // نافذة تفاصيل الأوردر اللي وراها في نفس الضغطة.
  window.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && $id('cr-bd') && $id('cr-bd').classList.contains('open')) { e.stopPropagation(); crClose(); }
  }, true);
}

function crReason(code){
  for (var i = 0; i < CANCEL_REASONS.length; i++) if (CANCEL_REASONS[i].code === code) return CANCEL_REASONS[i];
  return null;
}

function crPick(code){
  var r = crReason(code);
  if (!r) return;
  crState.code = code;
  var opts = $id('cr-grid').querySelectorAll('.cr-opt');
  for (var i = 0; i < opts.length; i++) opts[i].classList.toggle('on', opts[i].getAttribute('data-code') === code);
  var note = $id('cr-note');
  note.placeholder = r.needNote ? 'اكتب السبب (لازم)' : 'ملاحظة (اختياري)';
  note.classList.remove('bad');
  $id('cr-ok').classList.remove('off');
  var hint = cancelEarlyHint(code, crState.ord);
  $id('cr-hint').textContent = hint ? '⚠️ ' + hint : '';
  $id('cr-hint').style.display = hint ? '' : 'none';
  // «سبب تاني» بس اللي بيفتح الكيبورد — الباقي ضغطة والزرار على طول (الكيبورد على الموبايل بيغطي الأزرار)
  if (r.needNote) { try { note.focus(); } catch (e) {} }
}

function crClose(){
  var bd = $id('cr-bd');
  if (bd) bd.classList.remove('open');
  crState.cb = null; crState.ord = null; crState.code = null;
}

function crConfirm(){
  if (crState.busy) return;
  var r = crReason(crState.code);
  if (!r) {
    // من غير سبب = مفيش إلغاء — الأزرار بتتهز عشان تبان
    var g = $id('cr-grid');
    g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake');
    return;
  }
  var note = $id('cr-note');
  var val = String(note.value || '').replace(/\s+/g, ' ').trim();
  if (r.needNote && !val) { note.classList.add('bad'); try { note.focus(); } catch (e) {} return; }
  var cb = crState.cb, text = cancelReasonText(r.code, val);
  crState.busy = true;
  setTimeout(function(){ crState.busy = false; }, 600);   // ضغطتين ورا بعض = إلغاء واحد
  crClose();
  if (cb) cb(text, r.code);
}

// callback(text, code) — text هو اللي بيتسجّل في cancel_reason. ord (اختياري) = الأوردر، لسطر التنبيه.
export function askCancelReason(callback, ord){
  crBuild();
  crState.cb = callback; crState.ord = ord || null; crState.code = null;
  var opts = $id('cr-grid').querySelectorAll('.cr-opt');
  for (var i = 0; i < opts.length; i++) opts[i].classList.remove('on');
  $id('cr-grid').classList.remove('shake');
  var note = $id('cr-note');
  note.value = ''; note.placeholder = 'ملاحظة (اختياري)'; note.classList.remove('bad');
  $id('cr-hint').textContent = ''; $id('cr-hint').style.display = 'none';
  $id('cr-ok').classList.add('off');
  $id('cr-bd').classList.add('open');
  var box = $id('cr-bd').querySelector('.cr-box');
  if (box) box.scrollTop = 0;
}
