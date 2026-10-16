// ملخّص الفوترة وبوابة الإنبوكس داخل صفحة الأوردرات

import { walletStateCache } from '../billing/billing.js';
import { $id, esc } from '../core/dom.js';
import { sb } from '../core/supabase.js';
import { showPage } from '../main.js';

// helper used inside the row renderer (defined in the existing table code)
export function lockMaybe(value){
  if(walletStateCache && walletStateCache.is_depleted){
    // Never put the real value in the DOM — inspect/copy/screen-readers would expose it.
    // Render a fixed placeholder; the actual data stays only in the in-memory `all` array.
    return '<span class="locked-cell">••••••••</span>';
  }
  return esc(String(value||''));
}

// ---- بوابة تبويب المحادثات: مفتوح للموثّقين بس ----
export var inboxVerified = null;

export function refreshInboxGate(){
  if(!sb) return Promise.resolve(false);
  return sb.rpc('wa_inbox_status').then(function(r){
    // فشل الـRPC (شبكة/سيرفر) = "مش معروف" مش "مش موثّق" — كانت false
    // فتاجر موثّق بيشوف شاشة "اربط رقمك" طول الجلسة بعد أول فشل عابر،
    // وnull بتخلي loadInbox يعيد السؤال في الفتحة الجاية
    if(r.error){ inboxVerified = null; return false; }
    var d = r.data || {};
    inboxVerified = !!d.verified;
    return inboxVerified;
  }).catch(function(){ inboxVerified = null; return false; });
}

// القفل overlay فوق الشِل مش بديل ليه — الاستبدال بـinnerHTML كان بيمسح
// wa-list-body وأخواته، وأول فتح للإنبوكس بعد التوثيق (من غير reload)
// كان بيرمي TypeError على null ويسيب الصفحة واقفة تحت الحجاب
export function renderInboxLocked(){
  var wrap = $id('wa-wrap');
  if(!wrap) return;
  var lock = $id('wa-lock');
  if(!lock){
    lock = document.createElement('div');
    lock.id = 'wa-lock';
    lock.innerHTML =
      '<div class="inbox-lock">'
      + '<div class="inbox-lock-ico">💬</div>'
      + '<h3>المحادثات متاحة للمتاجر اللي ربطت رقم واتساب خاص بيها</h3>'
      + '<p>عشان نستقبل رسايل عملائك ونعرضهالك هنا، لازم تربط رقم واتساب بيزنس بتاعك مع الـ Access Token. '
      + 'ولو شغّال على رقم سهل المشترك، الرسايل بتروح لخدمة عملاء متجرك مباشرةً زي ما هو مكتوب في رسالة التأكيد.</p>'
      + '<button class="sbtn" id="inbox-go-settings">اربط رقمك دلوقتي ←</button>'
      + '</div>';
    wrap.appendChild(lock);
    var b = $id('inbox-go-settings');
    if(b) b.addEventListener('click', function(){ showPage('settings'); });
  }
  lock.style.display = 'flex';
}

export function clearInboxLock(){
  var lock = $id('wa-lock');
  if(lock) lock.style.display = 'none';
}
