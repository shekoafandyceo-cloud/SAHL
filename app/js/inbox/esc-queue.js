// طابور التصعيد (v89 — البند 4 من برنامج المالك · 23 نوفمبر)
// «متأخرة» = عدّى عليها ساعة **من وقت شغل الموظفين** من غير ما موظف يرد — مش من الساعة:
//   تصعيد 2 الفجر الساعة 11 الصبح لسه مش متأخر (الصبح هو ميعاده) · وتصعيد 12 الضهر الساعة 1:05 متأخر.
// وقت الشغل = اللي برّه جدول البوت: الجدول 7م → 11ص = الشغل 11ص → 7م · يوم «طول اليوم» (الجمعة) = مفيش شغل.
// الجدول مقفول أو مش معروف = 11ص → 7م والجمعة إجازة (مواعيد الفريق الفعلية).
// 🔴 منطق نقي (مابيستوردش inbox.js ولا بيلمس الـDOM) — الهارنس بيختبره من غير متصفح.

import { ymdAddDays } from '../core/format.js';

export var ESC_LATE_MIN = 60;      // ساعة شغل من غير رد = متأخرة (تنبيه)
export var ESC_LATE2_MIN = 180;    // تلات ساعات = تذكير تاني
var ESC_DEF = { start: '19:00', end: '11:00', full: [5] };
var MIN_MS = 60000;

function escHm(t){
  var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
}

// 🔴 الحساب ده بيتنادى مع كل رسم للقايمة لكل محادثة متصعّدة (العدّاد + السطر + التلميح) — إنشاء Intl.DateTimeFormat
// هو الغالي (~0.1ms للواحد · كان ~1ms لتصعيد عمره 3 أيام) فبيتعمل مرة، وفترات الشغل لكل يوم محفوظة
var CAIRO_FMT = null, CAIRO_YMD = null;
function cairoFmt(){
  if(!CAIRO_FMT) CAIRO_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return CAIRO_FMT;
}
// تاريخ اليوم بتوقيت القاهرة 'YYYY-MM-DD' (= cairoYMD في core/format.js — بنسخة محفوظة)
export function escYmd(ms){
  try{
    if(!CAIRO_YMD) CAIRO_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
    return CAIRO_YMD.format(new Date(ms));
  }catch(e){ var d = new Date(ms); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
}

// فرق القاهرة عن UTC بالدقايق في لحظة معيّنة — من Intl نفسه (الصيفي بيتظبط لوحده · مصر بتغيّر أواخر أبريل وأكتوبر)
export function cairoOffsetMin(ms){
  try{
    var parts = cairoFmt().formatToParts(new Date(ms));
    var o = {};
    for(var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
    var asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, (+o.hour) % 24, +o.minute, +o.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN_MS);
  }catch(e){ return 120; }
}

// الدقيقة m من يوم ymd (بتوقيت القاهرة) → ms
export function cairoMs(ymd, minOfDay){
  var p = String(ymd).split('-');
  var guess = Date.UTC(+p[0], +p[1] - 1, +p[2]) + minOfDay * MIN_MS;
  var off = cairoOffsetMin(guess - 120 * MIN_MS);
  var t = guess - off * MIN_MS;
  var off2 = cairoOffsetMin(t);
  return off2 === off ? t : (guess - off2 * MIN_MS);
}

function escIsoDow(ymd){
  var p = String(ymd).split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  return d === 0 ? 7 : d;
}

// فترات شغل الموظفين في يوم ymd: [[من, لحد], …] بالـms. sched = {on, start, end, full} من ai_settings (waAi.sched)
// (محفوظة باليوم والجدول — النتيجة للقراية بس)
var SW_CACHE = {}, SW_N = 0;
export function staffWindows(ymd, sched){
  var sc = (sched && sched.on) ? sched : null;
  var s = escHm(sc ? sc.start : ESC_DEF.start), e = escHm(sc ? sc.end : ESC_DEF.end);
  var full = sc ? (Array.isArray(sc.full) ? sc.full : []) : ESC_DEF.full;
  if(s == null || e == null){ s = escHm(ESC_DEF.start); e = escHm(ESC_DEF.end); }
  var key = ymd + '|' + s + '|' + e + '|' + full.join(',');
  if(Object.prototype.hasOwnProperty.call(SW_CACHE, key)) return SW_CACHE[key];
  var out = [];
  if(full.indexOf(escIsoDow(ymd)) < 0){   // يوم «طول اليوم» (الجمعة) = البوت شغّال اليوم كله = مفيش شغل
    var add = function(a, b){ if(b > a) out.push([cairoMs(ymd, a), cairoMs(ymd, b)]); };
    if(s > e) add(e, s);                   // البوت بالليل (7م → 11ص) = الشغل 11ص → 7م
    else { add(0, s); add(e, 1440); }      // جدول بالنهار (نادر): الشغل = اللي برّاه
  }
  if(++SW_N > 400){ SW_CACHE = {}; SW_N = 1; }
  SW_CACHE[key] = out;
  return out;
}

// دقايق الشغل اللي عدّت من fromIso لحد nowMs
export function escStaffMinutes(fromIso, nowMs, sched){
  var a = Date.parse(fromIso); if(!isFinite(a)) return 0;
  var b = (nowMs == null) ? Date.now() : nowMs; if(b <= a) return 0;
  var d = escYmd(a), last = escYmd(b), tot = 0;
  for(var guard = 0; guard < 16; guard++){   // أقدم من 16 يوم = متأخرة أصلاً — مانلفّش للأبد
    var w = staffWindows(d, sched);
    for(var i = 0; i < w.length; i++){
      var x = Math.max(a, w[i][0]), y = Math.min(b, w[i][1]);
      if(y > x) tot += y - x;
    }
    if(d === last) break;
    d = ymdAddDays(d, 1);
  }
  return Math.floor(tot / MIN_MS);
}

// حالة التأخير لمحادثة متصعّدة: {mins: دقايق شغل, wall: دقايق من التصعيد, level: ok | late | late2}
export function escLate(c, nowMs, sched){
  if(!c || !c.ai_escalated_at) return null;
  var at = Date.parse(c.ai_escalated_at); if(!isFinite(at)) return null;
  var now = (nowMs == null) ? Date.now() : nowMs;
  var mins = escStaffMinutes(c.ai_escalated_at, now, sched);
  return { mins: mins, wall: Math.max(0, Math.floor((now - at) / MIN_MS)),
           level: mins >= ESC_LATE2_MIN ? 'late2' : (mins >= ESC_LATE_MIN ? 'late' : 'ok') };
}

// «من 3 ساعات» — عربي مصري: 3–10 جمع · 11+ مفرد
export function escAgoAr(mins){
  var m = Math.max(0, Math.floor(Number(mins) || 0));
  if(m < 1) return 'دلوقتي';
  if(m < 60) return m === 1 ? 'دقيقة' : (m === 2 ? 'دقيقتين' : (m <= 10 ? (m + ' دقايق') : (m + ' دقيقة')));
  var h = Math.floor(m / 60);
  if(h < 24) return h === 1 ? 'ساعة' : (h === 2 ? 'ساعتين' : (h <= 10 ? (h + ' ساعات') : (h + ' ساعة')));
  var d = Math.floor(h / 24);
  return d === 1 ? 'يوم' : (d === 2 ? 'يومين' : (d <= 10 ? (d + ' أيام') : (d + ' يوم')));
}

// سطر الانتظار تحت الصف وفي البانر
export function escWaitText(st){
  if(!st) return '';
  if(st.level === 'ok') return '⏰ مستنية من ' + escAgoAr(st.wall);
  return '⚠️ متأخرة — ' + escAgoAr(st.mins) + ' في وقت الشغل من غير رد';
}

export function escWaitTitle(st){
  if(!st) return '';
  return 'مستنية من ' + escAgoAr(st.wall) + ' · وقت الشغل اللي عدّى من غير رد: ' + escAgoAr(st.mins)
    + '\nبتبقى «متأخرة» بعد ساعة شغل من غير رد (وقت الشغل = اللي البوت مش شغّال فيه)';
}

var ESC_ORD = { 2: 'التانية', 3: 'التالتة', 4: 'الرابعة', 5: 'الخامسة', 6: 'السادسة' };
var ESC_HOW = { resolved: 'علّمها «اتحلت»', no_action: 'علّمها «مالهاش لازمة»' };

// «🔁 المرة التانية — آخر رد: ebrahim «هيتم التواصل» · من 5 ساعات» — من ai_esc_info (السيرفر بيكتبه لحظة التصعيد)
// reopen = سبب التصعيد نفسه فيه مين رد وقال إيه، فالسطر بيقول المرة وإمتى اتقفلت بس
export function escRepeatText(info, nowMs){
  if(!info || typeof info !== 'object') return '';
  var n = Math.floor(Number(info.repeat) || 1);
  if(n < 2) return '';
  var head = '🔁 المرة ' + (ESC_ORD[n] || String(n));
  var p = (info.prev && typeof info.prev === 'object') ? info.prev : null;
  if(!p) return head;
  var at = Date.parse(p.at), now = (nowMs == null) ? Date.now() : nowMs;
  var ago = isFinite(at) ? (' · من ' + escAgoAr(Math.max(0, Math.floor((now - at) / MIN_MS)))) : '';
  if(info.kind === 'reopen') return head + ' — اتقفلت قبلها' + ago;
  var by = String(p.by || '').trim() || 'موظف';
  var msg = String(p.msg || '').replace(/\s+/g, ' ').trim();
  if(msg.length > 60) msg = msg.slice(0, 59) + '…';
  var what = p.kind === 'staff_reply' ? ('آخر رد: ' + by + (msg ? (' «' + msg + '»') : ''))
    : (ESC_HOW[p.kind] ? (by + ' ' + ESC_HOW[p.kind]) : 'اتقفلت قبل كده');
  return head + ' — ' + what + ago;
}

// «🔁 المرة التانية» لوحدها — للسطر تحت الصف (التفاصيل في البانر والتلميح)
export function escRepeatShort(info){
  if(!info || typeof info !== 'object') return '';
  var n = Math.floor(Number(info.repeat) || 1);
  return n >= 2 ? ('🔁 المرة ' + (ESC_ORD[n] || String(n))) : '';
}

// ملخص الصبح: التصعيدات اللي اتفتحت **والموظفين مش موجودين** — من آخر فترة شغل خلصت لحد أول فترة النهارده
// (الجمعة طول اليوم = بتدخل في ملخص السبت) · اللي اتصعّد وقت الشغل امبارح مش منهم (تنبيه «متأخرة» بيغطّيه).
// {inWindow: الساعة دي جوّه وقت الشغل · since: دقايق من أول فترة النهارده (لو جوّاها) · n}
export function escNightCount(rows, nowMs, sched){
  var now = (nowMs == null) ? Date.now() : nowMs;
  var today = escYmd(now), w = staffWindows(today, sched), idx = -1;
  for(var k = 0; k < w.length; k++){ if(now >= w[k][0] && now < w[k][1]) idx = k; }
  if(idx < 0) return { inWindow: false, since: null, n: 0 };
  var prevEnd = -Infinity;
  for(var b = 1; b <= 8; b++){
    var pw = staffWindows(ymdAddDays(today, -b), sched);
    if(pw.length){ prevEnd = pw[pw.length - 1][1]; break; }
  }
  var n = 0;
  for(var i = 0; i < (rows || []).length; i++){
    var t = Date.parse(rows[i] && rows[i].ai_escalated_at);
    if(isFinite(t) && t >= prevEnd && t < w[0][0]) n++;
  }
  return { inWindow: true, since: idx === 0 ? Math.floor((now - w[0][0]) / MIN_MS) : null, n: n };
}
