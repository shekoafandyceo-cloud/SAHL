// بانر «مزامنة حالات J&T واقفة» — للأدمن بس (30 سبتمبر)
//
// 🔴 ليه: الـpush من J&T بيضيع ~1% من المسحات (17309 فضل «استثناء» 3 أيام وهو
// متسلّم ومتحصّل). الحل الجذري `trace_sync` كل 15 دقيقة (pg_cron) — بس لو المزامنة
// نفسها وقفت (توكن اتغيّر · J&T قافلة · cron اتمسح) هنرجع لنفس الكذب في صمت.
// فالتنبيه ده هو الدليل إن شبكة الأمان نفسها عايشة.
//
// - `jt_sync_health()` بترجع null لأي حد مش أدمن — فمفيش فحص دور هنا.
// - العمر بيتحسب من `now` بتاع السيرفر مش ساعة الجهاز (نفس درس الاشتراك).
// - العتبة 45 دقيقة = 3 دورات فاتت — دورة واحدة بتقع عادي (J&T بطيئة) ومش تنبيه.
// - الإقفال (×) للجلسة دي بس (درس 9) — لو لسه واقفة بعد ريفريش يرجع.

import { $id, esc } from '../core/dom.js';
import { sb } from '../core/supabase.js';

export var JT_SYNC_STALE_MIN = 45;
var CHECK_MS = (typeof window !== 'undefined' && window.__JT_HEALTH_MS) || 600000;
var dismissed = false;
var started = false;

// الحالة من رد السيرفر — مصدر واحد للبانر وللهارنس
export function jtSyncState(h){
  if(!h || !h.enabled) return { show: false };
  var now = Date.parse(h.now || '');
  var last = Date.parse(h.trace_last_ok || '');
  if(!isFinite(now)) return { show: false };
  if(!isFinite(last)) return { show: true, minutes: null, error: h.trace_last_error || '' };
  var min = Math.floor((now - last) / 60000);
  return { show: min >= JT_SYNC_STALE_MIN, minutes: min, error: h.trace_last_error || '' };
}

function ago(min){
  if(min == null) return 'عمرها ما اشتغلت';
  if(min < 60) return 'من ' + min + ' دقيقة';
  var h = Math.floor(min / 60);
  if(h < 48) return 'من ' + h + (h >= 3 && h <= 10 ? ' ساعات' : ' ساعة');
  var d = Math.floor(h / 24);
  return 'من ' + d + (d >= 3 && d <= 10 ? ' أيام' : ' يوم');
}

export function renderJtSyncAlert(st){
  var el = $id('jt-sync-alert');
  if(!el) return;
  if(!st || !st.show || dismissed){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.innerHTML =
      '<div class="jt-sync-alert" role="alert">'
    +   '<span class="jsa-ic">⚠️</span>'
    +   '<div class="jsa-body">'
    +     '<b>مزامنة حالات J&amp;T واقفة — آخر مزامنة ناجحة ' + esc(ago(st.minutes)) + '</b>'
    +     '<span>حالات الشحنات في الجدول ممكن تكون متأخرة عن J&amp;T (أوردر متسلّم ممكن يفضل «استثناء» أو «خرج للتسليم»). '
    +     'ماتعتمدش على الحالات لحد ما التنبيه يختفي.</span>'
    +     (st.error ? '<span class="jsa-err">آخر خطأ: ' + esc(String(st.error).slice(0, 160)) + '</span>' : '')
    +   '</div>'
    +   '<button type="button" class="jsa-x" id="jsa-x" title="إخفاء لحد الريفريش">×</button>'
    + '</div>';
  el.style.display = '';
  var x = $id('jsa-x');
  if(x) x.addEventListener('click', function(){ dismissed = true; renderJtSyncAlert(null); });
}

export async function checkJtSyncHealth(){
  try{
    var r = await sb.rpc('jt_sync_health');
    if(r && !r.error) renderJtSyncAlert(jtSyncState(r.data));
  }catch(e){ /* فشل الفحص نفسه مش دليل إن المزامنة واقفة — مانخترعش تنبيه */ }
}

// بتتنادى من loadAll (بعد الدخول ومع كل ↻): فحص فوري + مؤقّت واحد بس
export function initJtHealth(){
  checkJtSyncHealth();
  if(started) return;
  started = true;
  setInterval(checkJtSyncHealth, CHECK_MS);
}
