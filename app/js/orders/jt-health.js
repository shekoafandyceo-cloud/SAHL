// بانر «مزامنة حالات J&T واقفة» + «حسابات J&T محتاجة مراجعة» + «سحب نسبة استلام العميل واقف» + «رسايل المندوب في الطريق» — للأدمن بس
// (30 سبتمبر · 1 أكتوبر · 10 أكتوبر · 11 أكتوبر)
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
import { fmtDT } from '../core/format.js';
import { sb } from '../core/supabase.js';

export var JT_SYNC_STALE_MIN = 45;
var CHECK_MS = (typeof window !== 'undefined' && window.__JT_HEALTH_MS) || 600000;
var dismissed = false;
var started = false;

// الحالة من رد السيرفر — مصدر واحد للبانر وللهارنس
export function jtSyncState(h){
  if(!h) return { show: false };
  var rate = rateSyncIssues(h);
  var ofd = ofdIssues(h);
  // سحب نسبة الاستلام ورسايل المندوب مالهمش علاقة بمزامنة J&T — بيبانوا حتى لو المتجر مش على J&T أو ساعة السيرفر مش مفهومة
  var rateOnly = (rate.length || ofd.length) ? { show: true, stale: false, minutes: null, error: '', issues: [], rate: rate, ofd: ofd } : { show: false, ofd: ofd };
  if(!h.enabled) return rateOnly;
  var now = Date.parse(h.now || '');
  var last = Date.parse(h.trace_last_ok || '');
  if(!isFinite(now)) return rateOnly;
  var issues = jtAccountingIssues(h);
  if(!isFinite(last)) return { show: true, stale: true, minutes: null, error: h.trace_last_error || '', issues: issues, rate: rate, ofd: ofd };
  var min = Math.floor((now - last) / 60000);
  var stale = min >= JT_SYNC_STALE_MIN;
  return { show: stale || issues.length > 0 || ofd.length > 0 || rate.length > 0, stale: stale, minutes: min, error: h.trace_last_error || '', issues: issues, rate: rate, ofd: ofd };
}

// (10 أكتوبر) سحب «نسبة استلام العميل» واقف — الطبيعي إن الأوردر يتسأل خلال 1–3 دقايق من نزوله، فـ>15 دقيقة = السحب
// نفسه واقف (مفتاح · cron · شركة الشحن قافلة · EasyOrders). من غير التنبيه ده الشارة بتختفي في صمت (درس 51).
export function rateSyncIssues(h){
  var out = [];
  if(!h) return out;
  var rs = Number(h.rank_stale || 0);
  if(h.rank_enabled && rs > 0)
    out.push('نسبة الاستلام من شركة الشحن: ' + rs + ' أوردر ماتسألش بقاله أكتر من ربع ساعة — السحب واقف'
      + (h.rank_last_error ? ' (آخر خطأ: ' + String(h.rank_last_error).slice(0, 120) + ')' : '')
      + '. الشارة على الأوردرات دي من EasyOrders لوحدها لحد ما يرجع.');
  var es = Number(h.eo_stale || 0);
  if(es > 0)
    out.push('نسبة الاستلام من EasyOrders: ' + es + ' أوردر تقييمه ماتسحبش بقاله أكتر من ربع ساعة — السحب واقف.');
  return out;
}

// (11 أكتوبر) رسايل «المندوب في الطريق» (h.ofd من app.wa_ofd_health) — درس 51: شبكة الأمان لازم تقول لما تقع.
// mode=off = ولا سطر (الميزة مقفولة لحد موافقة ميتا). last_error بيتقال لوحده حتى لو stale=0 (الـEF وقعت والشحنات اتلمّت بعدها).
export function ofdIssues(h){
  var o = h && h.ofd, out = [];
  if(!o) return out;
  if(o.health_error){ out.push('فحص رسايل «المندوب في الطريق» نفسه وقع ('+String(o.health_error).slice(0,20)+').'); return out; }
  if(!o.mode || o.mode==='off') return out;
  if(o.paused) out.push('رسايل «المندوب في الطريق» واقفة: '+String(o.paused).slice(0,120)+' — '
    + (o.paused_until ? 'هتتجرّب تاني لوحدها '+fmtDT(o.paused_until)+'.'
       : 'محتاج مراجعة القالب في WhatsApp Manager، وبعدها اطلب من Claude يشغّلها تاني (مفيش زرار في اللوحة).'));
  if(o.cap_hit) out.push('رسايل «المندوب في الطريق» وصلت السقف اليومي ('+Number(o.max_per_day||0)+') — هتكمّل بكرة.');
  var errAt = Date.parse(o.last_error_at || ''), okAt = Date.parse(o.last_ok || '');
  if(o.last_error && (!isFinite(okAt) || (isFinite(errAt) && errAt > okAt)))
    out.push('آخر تشغيل لرسايل «المندوب في الطريق» وقف بخطأ: '+String(o.last_error).slice(0,80)+'.');
  var n = Number(o.stale||0) + Number(o.overdue||0);
  if(n>0 && !o.paused && !o.cap_hit) out.push('رسايل «المندوب في الطريق»: '+n+' شحنة خرجت للتسليم ورسالتها ماخرجتش من أكتر من 10–15 دقيقة.');
  if(Number(o.unparsed_24h||0)>0) out.push('J&T غيّرت شكل بيانات المندوب؟ '+Number(o.unparsed_24h)+' شحنة خرجت للتسليم من غير رقم مندوب مفهوم (آخر 24 ساعة).');
  return out;
}

// (1 أكتوبر — مراجعة الحسابات) حاجات بتخلّي رقم يكدب في صمت حتى والمزامنة شغّالة:
//   مسلّم بقاله > 24 ساعة من غير تكلفة شحن نهائية (fee_sync واقفة — الطبيعي 10 دقايق) ·
//   مسح J&T جديد مالوش مكان في الخريطة (الحالة واقفة لحد ما يتضاف) ·
//   الـCOD اللي J&T بتحصّله ≠ إجمالي الأوردر عندنا (المتحصّل في الماليات غلط بالفرق)
export function jtAccountingIssues(h){
  var out = [];
  if(!h) return out;
  var stuck = Array.isArray(h.fee_stuck) ? h.fee_stuck : [];
  if(stuck.length) out.push('تكلفة شحن J&T ماتقفلتش لـ' + stuck.length + ' أوردر متسلّم من أكتر من يوم (' + stuck.slice(0, 5).join('، ') + (stuck.length > 5 ? '…' : '') + ') — تكلفة الشحن في الماليات ناقصة بيهم');
  var um = Number(h.unmapped_48h || 0);
  if(um > 0) out.push('J&T بعتت ' + um + ' مسح بنوع جديد مش في خريطة الحالات — الأوردرات دي حالتها ممكن تكون واقفة');
  var cm = Array.isArray(h.cod_mismatch) ? h.cod_mismatch : [];
  cm.forEach(function(x){
    out.push('أوردر ' + x.uid + ': J&T بتحصّل ' + money2(x.jt) + ' والإجمالي عندنا ' + money2(x.total) + ' — المتحصّل في الماليات مختلف بالفرق. صحّح الإجمالي أو راجع J&T');
  });
  return out;
}

function money2(v){ var n = Number(v); return isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString('en-US') + ' ج' : '—'; }

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
  var issues = Array.isArray(st.issues) ? st.issues : [];
  var staleHtml = (st.stale === false) ? '' :
        '<b>مزامنة حالات J&amp;T واقفة — آخر مزامنة ناجحة ' + esc(ago(st.minutes)) + '</b>'
    +   '<span>حالات الشحنات في الجدول ممكن تكون متأخرة عن J&amp;T (أوردر متسلّم ممكن يفضل «استثناء» أو «خرج للتسليم»). '
    +   'ماتعتمدش على الحالات لحد ما التنبيه يختفي.</span>'
    +   (st.error ? '<span class="jsa-err">آخر خطأ: ' + esc(String(st.error).slice(0, 160)) + '</span>' : '');
  var issuesHtml = issues.length
    ? '<b>حسابات J&amp;T محتاجة مراجعة</b>' + issues.map(function(t){ return '<span class="jsa-issue">• ' + esc(t) + '</span>'; }).join('')
    : '';
  var rate = Array.isArray(st.rate) ? st.rate : [];
  var rateHtml = rate.length
    ? '<b>سحب نسبة استلام العميل واقف</b>' + rate.map(function(t){ return '<span class="jsa-issue jsa-rate">• ' + esc(t) + '</span>'; }).join('')
    : '';
  var ofd = Array.isArray(st.ofd) ? st.ofd : [];
  var ofdHtml = ofd.length
    ? '<b>رسايل «المندوب في الطريق»</b>' + ofd.map(function(t){ return '<span class="jsa-issue jsa-rate">• ' + esc(t) + '</span>'; }).join('')
    : '';
  el.innerHTML =
      '<div class="jt-sync-alert" role="alert">'
    +   '<span class="jsa-ic">⚠️</span>'
    +   '<div class="jsa-body">' + staleHtml + issuesHtml + rateHtml + ofdHtml + '</div>'
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
