// استثناءات الشحن — تاب متابعة استثناءات J&T جوّه سهل (8 أكتوبر — طلب المالك)
//
// «لما اوردر يحصل عليه اي مشكلة "استثناء" او اي UPDATE وحش في شركة الشحن، ينزل جواه تلقائي
// رقم التتبع و رقم الموبايل بتاع العميل و عنوانه و طالب ايه و رقم المندوب، و خانة للموظف يكتب
// فيها عمل ايه، و خانة يختار منها FAKE UPDATE او تأجيل حقيقي». (كانت شيت جوجل الأول، والمالك
// غيّرها لتاب جوّه سهل.)
//
// المصدر: `v_jt_issues` = صف لكل مسح 110 (استثناء)، أو 172 لشحنة مالهاش استثناء — بيتملا من
// تريجر على `jt_events` لحظة وصول المسح (push أو pull)، ومعاه بيانات العميل من `orders`.
// الكتابة الوحيدة من هنا `jt_issue_save` (DEFINER — بتسجّل مين وإمتى من البروفايل مش من المتصفح).
//
// 🔴 «محتاجة متابعة» (`jxNeedsFollow`) مصدر واحد للشارة والكارت والفلتر — نسختين = الشارة تقول 5
//    والفلتر يعرض 3. الشرط: محدش صنّفها · ومفيش تصنيف على محاولة **أحدث** لنفس الشحنة (المتابعة
//    على الشحنة مش على الحدث) · والشحنة لسه فيها أمل: مع J&T، أو بدأت ترجع من أقل من 7 أيام.
// 🔴 النتيجة من مسحات J&T (`outcome`)، ولو فاضية من حالة الأوردر عندنا (`jxOutcome`): أوردر اتلغى
//    أو اتعلّم متسلّم بإيد موظف كان هيفضل «محتاج متابعة» للأبد، لأن المصالحة بتبطّل تسحب له.
// 🔴 قناة ريل-تايم **لوحدها** مش جوّه قناة الأوردرات: لو الجدول مش في الـpublication (الـSQL لسه
//    ماتطبّقش) الاشتراك بيقع — وقناة مشتركة كانت هتوقّع تحديث الأوردرات معاه. وبتتفتح بس بعد أول
//    استعلام ناجح (يعني الجدول موجود فعلاً).
// 🔴 postgres_changes مافيهوش replay: طول ما الصفحة مفتوحة فيه مزامنة تدريجية كل دقيقة بـ`updated_at`
//    (البوالص اللي اتغيّرت بس)، ورجوع الاتصال بعد قطع بيعمل نفس الحاجة.
// 🔴 الموظف وهو بيكتب ملاحظة مايتسحبش الكارت من تحت إيده: أي تحديث وقتها بيترقّع جوّه الكارت،
//    والرسم الكامل بيستنى لحد ما يسيب الخانة (الكتابة نفسها في `jxDrafts` — مابتضيعش مع أي رسم).

import { $id, esc } from '../core/dom.js';
import { emptyState } from '../core/empty.js';
import { fmtDT, money, normalizePhone, toLatinDigits, ymdAddDays } from '../core/format.js';
import { CANCELLED_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusIn, statusLabel } from '../core/constants.js';
import { renderLoadError } from '../core/loaderr.js';
import { swallow } from '../core/log.js';
import { openOwnTab } from '../core/router.js';
import { skelList } from '../core/skeleton.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { veilDone } from '../core/veil.js';
import { copyTextToClipboard } from '../ui/clipboard.js';
import { currentTenantId } from '../auth/auth.js';
import { walletStateCache } from '../billing/billing.js';
import { tourActive } from '../tour/tour.js';
import { openDetail } from '../orders/detail.js';
import { waIdFromPhone, waRequestOpenChat } from '../inbox/inbox.js';
import { showPage } from '../main.js';

// ── الثوابت ──────────────────────────────────────────────────────────
export var JX_WINDOW_DAYS = 30;          // التحميل: آخر 30 يوم (الشارة نفس النافذة)
export var JX_RETURN_FOLLOW_DAYS = 7;    // الراجعة بتفضل «محتاجة متابعة» أسبوع بس
var JX_LIMIT = 3000;
var JX_RENDER_MAX = 200;                 // سقف الكروت المرسومة — الباقي في التصدير
var JX_FULL_RELOAD_MS = 15 * 60000;      // فتح الصفحة بعد كده = تحميل كامل (حالة الأوردر بتتغيّر من غير updated_at)
var JX_POLL_MS = (typeof window !== 'undefined' && window.__JX_POLL_MS) || 60000;
var JX_NEW_MS = 10 * 60000;              // شارة «جديد» على اللي وصل لحظي
var DAY_MS = 86400000;

// تصنيف الموظف — نفس الـCHECK على `jt_issues.verdict` بالحرف (6 قيم)
export var JX_VERDICTS = [
  { k: 'fake_update',  t: 'FAKE UPDATE',             d: 'J&T كتبت حاجة مش حقيقية — العميل بينفيها' },
  { k: 'real_delay',   t: 'تأجيل حقيقي',             d: 'العميل فعلاً طلب يأجّل' },
  { k: 'real_refusal', t: 'رفض حقيقي',               d: 'العميل فعلاً رفض' },
  { k: 'no_answer_us', t: 'مش بيرد علينا إحنا كمان', d: 'كلّمناه ومابيردش' },
  { k: 'data_fixed',   t: 'بيانات غلط واتصلحت',      d: 'عنوان أو رقم غلط واتصلح' },
  { k: 'jt_error',     t: 'غلطة من J&T',             d: 'فرز غلط · فرع غلط · مشكلة عندهم' }
];

var JX_OUT = {
  none:      { t: 'لسه مع J&T',    cls: 'o-none' },
  delivered: { t: '✅ اتسلمت',      cls: 'o-del' },
  returning: { t: '↩️ راجعة',       cls: 'o-ret' },
  returned:  { t: '📦 رجعت لينا',   cls: 'o-back' },
  cancelled: { t: 'اتلغى عندنا',    cls: 'o-can' }
};

// الأعمدة بالاسم (درس 32 — مش *)
var JX_COLS = 'id,tenant_id,order_id,tracking_no,kind,event_at,reason_code,reason_en,reason_ar,courier_note,'
  + 'branch,branch_phone,courier_name,courier_phone,photo_url,verdict,staff_note,staff_updated_at,verdict_by_name,'
  + 'outcome,outcome_at,updated_at,attempt,order_uid,customer_name,phone,alt_phone,city,address,'
  + 'ship_prov,ship_city,ship_area,product_name,total_cost,jt_cod_amount,order_status';
var JX_BADGE_COLS = 'id,tracking_no,kind,event_at,verdict,outcome,outcome_at,order_status';

// ── الحالة ───────────────────────────────────────────────────────────
export var jxRows = [];
var jxById = {};
var jxLoadedAt = 0;            // آخر تحميل كامل ناجح
var jxSyncMs = 0;              // أكبر updated_at اتشاف (ms) — نقطة المزامنة التدريجية
var jxGen = 0, jxIncGen = 0;
var jxDrafts = {};             // id → نص ملاحظة لسه مااتحفظش
var jxPendingVerdict = {};     // id → التصنيف اللي الموظف اختاره ولسه السيرفر مارجّعهوش
var jxSaving = {}, jxResave = {};
var jxNew = {};                // id → وقت وصوله لحظي
var jxPendingRender = false, jxPendingFromOthers = false;
export var jxFilter = { chip: 'open', days: 7, reason: '', verdict: '', q: '' };
var jxPollTimer = null, jxSearchTimer = null;
var jxChannel = null, jxRtOff = false, jxRtQueue = {}, jxRtTimer = null;
var jxDbMissing = false;

// ── منطق خالص (الهارنس بيستورده) ─────────────────────────────────────
var JX_DAY_FMT = null;
export function jxYmd(v){
  try{
    if(!JX_DAY_FMT) JX_DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
    return JX_DAY_FMT.format(new Date(v));
  }catch(e){ return ''; }
}

// أول يوم في الفترة (توقيت القاهرة): «آخر 7 أيام» = النهارده + الستة اللي قبله
export function jxPeriodFrom(days, now){
  return ymdAddDays(jxYmd(now), -(Math.max(1, Number(days) || 1) - 1));
}

function jxPrep(r){
  r._t = Date.parse(r.event_at);
  r._ymd = isFinite(r._t) ? jxYmd(r._t) : '';
  return r;
}

// النتيجة الفعلية: مسحات J&T الأول، ولو مفيش فحالة الأوردر عندنا لو نهائية
export function jxOutcome(r){
  if(!r) return null;
  if(r.outcome === 'delivered' || r.outcome === 'returning' || r.outcome === 'returned') return r.outcome;
  var st = r.order_status;
  if(statusIn(st, DELIVERED_STATUSES)) return 'delivered';
  if(statusIn(st, RETURNED_STATUSES)) return 'returning';
  if(statusIn(st, CANCELLED_STATUSES)) return 'cancelled';
  return null;
}

// آخر وقت اتصنّف فيه استثناء لكل بوليصة
export function jxLatestVerdictAt(rows){
  var m = {};
  for(var i = 0; i < rows.length; i++){
    var r = rows[i];
    if(!r.verdict) continue;
    var t = isFinite(r._t) ? r._t : Date.parse(r.event_at);
    if(!(m[r.tracking_no] >= t)) m[r.tracking_no] = t;
  }
  return m;
}

export function jxSuperseded(r, lv){
  if(!r || r.verdict || !lv) return false;
  var t = isFinite(r._t) ? r._t : Date.parse(r.event_at);
  return lv[r.tracking_no] > t;
}

export function jxNeedsFollow(r, lv, now){
  if(!r || r.verdict) return false;
  if(jxSuperseded(r, lv)) return false;
  var t = isFinite(r._t) ? r._t : Date.parse(r.event_at);
  var out = jxOutcome(r);
  if(out === null) return true;
  if(out === 'returning'){
    // المهلة من **بداية المرتجع** (outcome_at) مش من الاستثناء — الفرق بينهم وصل 3.9 يوم على الحي.
    // (النتيجة جاية من حالة الأوردر = مفيش outcome_at → من الاستثناء)
    var rs = (r.outcome === 'returning' && r.outcome_at) ? Date.parse(r.outcome_at) : t;
    return isFinite(rs) && (now - rs) < JX_RETURN_FOLLOW_DAYS * DAY_MS;
  }
  return false;   // اتسلمت · رجعت لينا · اتلغت عندنا
}

export function jxCountOpen(rows, now){
  var lv = jxLatestVerdictAt(rows), n = 0;
  for(var i = 0; i < rows.length; i++) if(jxNeedsFollow(rows[i], lv, now)) n++;
  return n;
}

// تطبيع البحث بالاسم — نفس فكرة waNormName (الهمزات/التاء/الياء)
function jxNorm(s){
  return String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
}

function jxMatches(r, q, qd){
  if(String(r.tracking_no || '').toLowerCase().indexOf(q) >= 0) return true;
  if(String(r.order_uid || '').toLowerCase().indexOf(q) >= 0) return true;
  if(jxNorm(r.customer_name).indexOf(q) >= 0) return true;
  if(qd.length >= 3 && (normalizePhone(r.phone).indexOf(qd) >= 0 || normalizePhone(r.alt_phone).indexOf(qd) >= 0)) return true;
  return false;
}

export function jxFilterRows(rows, f, now){
  var lv = jxLatestVerdictAt(rows);
  var from = jxPeriodFrom(f.days, now);
  var q = jxNorm(toLatinDigits(f.q));
  var qd = normalizePhone(f.q);
  var out = [];
  for(var i = 0; i < rows.length; i++){
    var r = rows[i], o = jxOutcome(r);
    if(f.chip === 'open'){
      // الطابور مابيتقيّدش بالفترة: اللي محتاج متابعة لازم يبان مهما كان تاريخه
      if(!jxNeedsFollow(r, lv, now)) continue;
    } else {
      if(!(r._ymd >= from)) continue;
      if(f.chip === 'with_jt' && o !== null) continue;
      if(f.chip === 'delivered' && o !== 'delivered') continue;
      if(f.chip === 'returned' && o !== 'returning' && o !== 'returned') continue;
    }
    if(f.reason && (r.reason_ar || '') !== f.reason) continue;
    if(f.verdict === 'none'){ if(r.verdict) continue; }
    else if(f.verdict && r.verdict !== f.verdict) continue;
    if(q && !jxMatches(r, q, qd)) continue;
    out.push(r);
  }
  // الطابور: الأقدم فوق (الأقرب إنها ترجع) · الباقي: الأحدث فوق
  var asc = f.chip === 'open';
  out.sort(function(a, b){ return asc ? (a._t - b._t) : (b._t - a._t); });
  return out;
}

// رابط صورة J&T (SAS) بيعيش ~6 أيام — بعدها بيرجع 403، فمانعرضش لينك ميت
export function jxPhotoState(url, now){
  var u = String(url || '').trim();
  if(!/^https?:\/\//i.test(u)) return null;
  var m = /[?&]se=([^&#]+)/i.exec(u);
  if(m){
    var t = NaN;
    try{ t = Date.parse(decodeURIComponent(m[1])); }catch(e){ t = NaN; }
    if(isFinite(t) && t < now) return { expired: true };
  }
  return { url: u, expired: false };
}

export function jxTel(p){
  var d = toLatinDigits(p).replace(/[^0-9+]/g, '');
  return d.replace(/\D/g, '').length >= 7 ? d : '';
}

export function jxVerdictLabel(k){
  for(var i = 0; i < JX_VERDICTS.length; i++) if(JX_VERDICTS[i].k === k) return JX_VERDICTS[i].t;
  return k ? String(k) : '';
}

export function jxAgo(iso, now){
  var t = Date.parse(iso);
  if(!isFinite(t)) return '';
  var m = Math.max(0, Math.floor((now - t) / 60000));
  if(m < 1) return 'دلوقتي';
  if(m < 60) return 'من ' + m + ' دقيقة';
  var h = Math.floor(m / 60);
  if(h < 24) return 'من ' + h + (h >= 3 && h <= 10 ? ' ساعات' : ' ساعة');
  var d = Math.floor(h / 24);
  return 'من ' + d + (d >= 3 && d <= 10 ? ' أيام' : ' يوم');
}

// تقرير J&T: حسب الفرع/المندوب/السبب — الشحنات (بوالص متميزة) في «اتسلمت/رجعت» مش الأحداث
export function jxReport(rows){
  var dims = { branch: {}, courier: {}, reason: {} };
  var tot = { exc: 0, ret: 0, bills: {}, cls: 0, fake: 0, jterr: 0, del: {}, back: {} };
  for(var i = 0; i < rows.length; i++){
    var r = rows[i], o = jxOutcome(r);
    var keys = {
      branch: r.branch || 'مش معروف',
      courier: (r.courier_name || r.courier_phone) ? ((r.courier_name || 'مندوب') + (r.courier_phone ? ' — ' + r.courier_phone : '')) : 'مش معروف',
      reason: r.reason_ar || r.reason_en || 'استثناء من J&T'
    };
    for(var dim in keys){
      if(!Object.prototype.hasOwnProperty.call(keys, dim)) continue;
      var m = dims[dim], k = keys[dim];
      var e = m[k] || (m[k] = { k: k, branch: r.branch || '', exc: 0, ret: 0, cls: 0, fake: 0, jterr: 0, delB: {}, backB: {} });
      if(r.kind === 'return') e.ret++; else e.exc++;
      if(r.verdict) e.cls++;
      if(r.verdict === 'fake_update') e.fake++;
      if(r.verdict === 'jt_error') e.jterr++;
      if(o === 'delivered') e.delB[r.tracking_no] = 1;
      if(o === 'returning' || o === 'returned') e.backB[r.tracking_no] = 1;
    }
    if(r.kind === 'return') tot.ret++; else tot.exc++;
    tot.bills[r.tracking_no] = 1;
    if(r.verdict) tot.cls++;
    if(r.verdict === 'fake_update') tot.fake++;
    if(r.verdict === 'jt_error') tot.jterr++;
    if(o === 'delivered') tot.del[r.tracking_no] = 1;
    if(o === 'returning' || o === 'returned') tot.back[r.tracking_no] = 1;
  }
  function list(m){
    return Object.keys(m).map(function(k){
      var e = m[k];
      e.del = Object.keys(e.delB).length; e.back = Object.keys(e.backB).length;
      return e;
    }).sort(function(a, b){
      return (b.fake + b.jterr) - (a.fake + a.jterr) || (b.exc + b.ret) - (a.exc + a.ret) || String(a.k).localeCompare(String(b.k));
    });
  }
  return {
    branch: list(dims.branch), courier: list(dims.courier), reason: list(dims.reason),
    tot: { exc: tot.exc, ret: tot.ret, bills: Object.keys(tot.bills).length, cls: tot.cls, fake: tot.fake,
           jterr: tot.jterr, del: Object.keys(tot.del).length, back: Object.keys(tot.back).length }
  };
}

// ── التصدير (Excel) ──────────────────────────────────────────────────
// 🔴 خلية بتبدأ بـ= + - @ = معادلة في Excel (CSV injection) — نص J&T والملاحظات جايين من بره.
function jxCsvCell(v){
  var s = v == null ? '' : String(v);
  if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if(/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
// رقم تليفون/أوردر أرقام بس: Excel بيشيل الصفر اللي في الأول — ="010…" بيخلّيه نص
function jxCsvDigits(v){
  var s = v == null ? '' : String(v).trim();
  if(/^\d+$/.test(s)) return '"=""' + s + '"""';
  return jxCsvCell(s);
}

export function jxCsv(rows){
  var H = ['التاريخ', 'البوليصة', 'رقم الأوردر', 'العميل', 'التليفون', 'تليفون إضافي', 'المحافظة', 'المدينة',
    'المنطقة', 'العنوان', 'المنتج', 'مبلغ التحصيل', 'النوع', 'المحاولة', 'سبب J&T', 'السبب (إنجليزي)',
    'كود السبب', 'ملاحظة المندوب', 'المندوب', 'تليفون المندوب', 'الفرع', 'تليفون الفرع', 'التصنيف',
    'عملت إيه', 'سجّل', 'وقت التسجيل', 'النتيجة', 'حالة الأوردر', 'صورة J&T'];
  var out = [H.map(jxCsvCell).join(',')];
  for(var i = 0; i < rows.length; i++){
    var r = rows[i], o = jxOutcome(r);
    var cod = r.jt_cod_amount != null ? r.jt_cod_amount : r.total_cost;
    out.push([
      jxCsvCell(fmtDT(r.event_at)), jxCsvCell(r.tracking_no), jxCsvDigits(r.order_uid), jxCsvCell(r.customer_name),
      jxCsvDigits(r.phone), jxCsvDigits(r.alt_phone), jxCsvCell(r.ship_prov || r.city), jxCsvCell(r.ship_city),
      jxCsvCell(r.ship_area), jxCsvCell(r.address), jxCsvCell(r.product_name), jxCsvCell(cod == null ? '' : cod),
      jxCsvCell(r.kind === 'return' ? 'رجوع من غير سبب' : 'استثناء'), jxCsvCell(r.kind === 'return' ? '' : (r.attempt || '')),
      jxCsvCell(r.reason_ar), jxCsvCell(r.reason_en), jxCsvCell(r.reason_code), jxCsvCell(r.courier_note),
      jxCsvCell(r.courier_name), jxCsvDigits(r.courier_phone), jxCsvCell(r.branch), jxCsvDigits(r.branch_phone),
      jxCsvCell(jxVerdictLabel(r.verdict)), jxCsvCell(r.staff_note), jxCsvCell(r.staff_updated_at ? r.verdict_by_name : ''),
      jxCsvCell(r.staff_updated_at ? fmtDT(r.staff_updated_at) : ''), jxCsvCell(JX_OUT[o || 'none'].t),
      jxCsvCell(r.order_status ? statusLabel(r.order_status) : ''), jxCsvCell(r.photo_url)
    ].join(','));
  }
  // BOM عشان Excel يقرا العربي صح · CRLF زي ما Excel متوقع
  return '﻿' + out.join('\r\n');
}

// ── التحميل ──────────────────────────────────────────────────────────
function jxPageVisible(){
  var p = $id('page-exceptions');
  return !!(p && p.style.display !== 'none');
}

function jxNoteSync(iso){
  var t = Date.parse(iso || '');
  if(isFinite(t) && t > jxSyncMs) jxSyncMs = t;
}

function jxSetRows(rows){
  jxRows = rows;
  jxById = {};
  jxSyncMs = 0;
  for(var i = 0; i < rows.length; i++){
    jxPrep(rows[i]);
    jxById[rows[i].id] = rows[i];
    jxNoteSync(rows[i].updated_at);
  }
  // جدول فاضي = مفيش updated_at نبدأ منه — من غير ده المزامنة التدريجية عمرها ما كانت هتشتغل
  // ولو الريل-تايم واقع أول استثناء كان هيستنى ريفريش. (هامش 10 دقايق لفرق ساعة الجهاز)
  if(!jxSyncMs) jxSyncMs = Date.now() - 10 * 60000;
}

function jxIsDbMissing(err){
  var s = String((err && (err.code || '')) + ' ' + (err && err.message || ''));
  return /PGRST205|42P01|v_jt_issues|jt_issues/.test(s) && /PGRST205|42P01|does not exist|Could not find/i.test(s);
}

export function loadJtIssues(force){
  var list = $id('jx-list');
  if(tourActive){
    if(list) list.innerHTML = '<div class="jx-empty-sm">التبويب ده بيشتغل بالبيانات الحقيقية بعد ما تخلّص الجولة.</div>';
    veilDone('exceptions'); return;
  }
  if(!sb || !currentTenantId){ veilDone('exceptions'); return; }
  if(walletStateCache && walletStateCache.is_depleted){
    if(list) list.innerHTML = '<div class="jx-empty-sm">🔒 البيانات مقفولة لحد ما تشحن المحفظة.</div>';
    veilDone('exceptions'); return;
  }
  jxStartPoll();
  // فتح الصفحة تاني بعد شوية: مزامنة تدريجية بس (اللي اتغيّر) بدل ما نجيب كله
  if(!force && jxLoadedAt && (Date.now() - jxLoadedAt) < JX_FULL_RELOAD_MS){
    jxRenderAll();
    veilDone('exceptions');
    jxIncremental();
    return;
  }
  jxFullLoad();
}

function jxFullLoad(){
  var my = ++jxGen;
  var list = $id('jx-list');
  if(list && !jxRows.length) list.innerHTML = skelList(4);
  var since = new Date(Date.now() - JX_WINDOW_DAYS * DAY_MS).toISOString();
  sb.from('v_jt_issues').select(JX_COLS)
    .eq('tenant_id', currentTenantId)
    .gte('event_at', since)
    .order('event_at', { ascending: false })
    .limit(JX_LIMIT)
    .then(function(r){
      if(my !== jxGen) return;   // طلب أحدث خرج بعدنا
      veilDone('exceptions');
      if(r.error){ jxShowLoadError(r.error); return; }
      jxDbMissing = false;
      jxSetRows(r.data || []);
      jxLoadedAt = Date.now();
      jxRenderAll();
      jxEnsureRealtime();
    }, function(e){
      if(my !== jxGen) return;
      veilDone('exceptions');
      jxShowLoadError(e);
    });
}

function jxShowLoadError(err){
  swallow('exceptions/load', err);
  var list = $id('jx-list');
  if(jxIsDbMissing(err)){
    jxDbMissing = true;
    if(list) list.innerHTML = emptyState({ icon: '🛠️', title: 'تحديث الداتابيز بتاع التاب ده لسه مااتطبّقش',
      sub: 'شغّل ملف jt-issues-tab.sql مرة واحدة في Supabase ← SQL Editor، وبعدين اضغط ↻ هنا.' });
    return;
  }
  if(jxRows.length){ toast('مقدرناش نحدّث الاستثناءات — المعروض آخر نسخة اتحمّلت', 'er'); return; }
  renderLoadError('exceptions');
}

// اللي اتغيّر من آخر مزامنة — خفيف: أرقام البوالص بس، وبعدين صفوفها كاملة
function jxIncremental(){
  if(!sb || !currentTenantId || !jxSyncMs || tourActive) return;
  var my = ++jxIncGen;
  // هامش دقيقتين: ترانزاكشن بدأت قبل التانية وخلصت بعدها بيبقى updated_at بتاعها أقدم
  var since = new Date(jxSyncMs - 120000).toISOString();
  sb.from('jt_issues').select('tracking_no,updated_at')
    .eq('tenant_id', currentTenantId)
    .gte('updated_at', since)
    .limit(1000)
    .then(function(r){
      if(my !== jxIncGen || r.error || !r.data || !r.data.length) return;
      var t = {};
      for(var i = 0; i < r.data.length; i++) t[r.data[i].tracking_no] = 1;
      jxFetchTrackings(Object.keys(t));
    });
}

// صفوف بوالص معيّنة كاملة (من الفيو — عشان «المحاولة» تتحسب صح لو اتضاف استثناء جديد)
function jxFetchTrackings(list){
  if(!list.length || !sb || !currentTenantId) return;
  for(var i = 0; i < list.length; i += 80){
    var chunk = list.slice(i, i + 80);
    sb.from('v_jt_issues').select(JX_COLS)
      .eq('tenant_id', currentTenantId)
      .in('tracking_no', chunk)
      .limit(JX_LIMIT)
      .then(function(r){
        if(r.error || !r.data) return;
        var changed = jxMerge(r.data);
        if(changed.length) jxAfterChange(changed, false);
      });
  }
}

function jxMerge(rows){
  var changed = [], now = Date.now();
  for(var i = 0; i < rows.length; i++){
    var n = rows[i], old = jxById[n.id];
    if(!old){
      jxPrep(n);
      jxRows.push(n);
      jxById[n.id] = n;
      changed.push(n.id);
      if(jxLoadedAt) jxNew[n.id] = now;
    } else if(JSON.stringify(jxPlain(old)) !== JSON.stringify(jxPlain(n))){
      Object.assign(old, n);
      jxPrep(old);
      changed.push(n.id);
    }
    jxNoteSync(n.updated_at);
  }
  return changed;
}

function jxPlain(r){
  var o = {};
  for(var k in r){ if(Object.prototype.hasOwnProperty.call(r, k) && k.charAt(0) !== '_') o[k] = r[k]; }
  return o;
}

// ── الشارة على زرار التبويب ──────────────────────────────────────────
export function jxSetNavBadge(n){
  var b = $id('jx-nav-badge'); if(!b) return;
  if(n > 0){
    b.textContent = n > 99 ? '99+' : String(n);
    b.title = n + ' استثناء محتاج متابعة';
    b.style.display = 'inline-flex';
  } else {
    b.style.display = 'none';
  }
}

// بتتنادى من loadAll (بعد الدخول ومع كل ↻) ومن الريل-تايم لما الصفحة لسه ماتحمّلتش
export function jtRefreshNavBadge(){
  if(!sb || !currentTenantId || tourActive) return;
  if(jxLoadedAt){ jxSetNavBadge(jxCountOpen(jxRows, Date.now())); jxEnsureRealtime(); return; }
  var since = new Date(Date.now() - JX_WINDOW_DAYS * DAY_MS).toISOString();
  sb.from('v_jt_issues').select(JX_BADGE_COLS)
    .eq('tenant_id', currentTenantId)
    .gte('event_at', since)
    .order('event_at', { ascending: false })
    .limit(JX_LIMIT)
    .then(function(r){
      if(jxLoadedAt) return;   // التحميل الكامل سبق — هو اللي بيحسب
      // الجدول مش موجود (الـSQL لسه ماتطبّقش) = مفيش شارة ومفيش ريل-تايم
      if(r.error){ jxSetNavBadge(0); return; }
      var rows = r.data || [];
      for(var i = 0; i < rows.length; i++) jxPrep(rows[i]);
      jxSetNavBadge(jxCountOpen(rows, Date.now()));
      jxEnsureRealtime();
    });
}

// ── الريل-تايم ───────────────────────────────────────────────────────
function jxEnsureRealtime(){
  if(jxChannel || !sb || !currentTenantId) return;
  try{
    jxChannel = sb.channel('jt-issues-' + currentTenantId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jt_issues',
        filter: 'tenant_id=eq.' + currentTenantId
      }, function(payload){ jxHandleRealtime(payload); })
      .subscribe(function(status){
        if(status === 'SUBSCRIBED'){
          if(jxRtOff){ jxRtOff = false; jxCatchUp(); }
        } else if(status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
          jxRtOff = true;
        }
      });
  }catch(e){ swallow('exceptions/realtime', e); jxChannel = null; }
}

// رجوع الاتصال بعد قطع = فترة عمياء — نجيب اللي فاتنا
function jxCatchUp(){
  if(jxLoadedAt) jxIncremental();
  else jtRefreshNavBadge();
}

// الأحداث بتيجي رشقات (المسح الواحد بيلمس كذا صف + النتيجة) — بنجمّعها 600ms في استعلام واحد
export function jxHandleRealtime(payload){
  if(tourActive) return;
  var n = (payload && (payload.new || payload.old)) || {};
  if(!n.tracking_no && !n.id) return;
  if(n.tracking_no) jxRtQueue[n.tracking_no] = 1;
  if(jxRtTimer) return;
  jxRtTimer = setTimeout(function(){
    jxRtTimer = null;
    var list = Object.keys(jxRtQueue);
    jxRtQueue = {};
    if(jxLoadedAt) jxFetchTrackings(list);
    else jtRefreshNavBadge();
  }, 600);
}

function jxStartPoll(){
  if(jxPollTimer) return;
  jxPollTimer = setInterval(function(){
    if(!jxPageVisible()){ clearInterval(jxPollTimer); jxPollTimer = null; return; }
    if(document.hidden) return;
    jxIncremental();
    jxTickTimes();
  }, JX_POLL_MS);
}

// ── الرسم ────────────────────────────────────────────────────────────
function jxEditing(){
  var a = document.activeElement;
  return !!(a && a.closest && a.closest('#jx-list') && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
}

function jxAfterChange(ids, own){
  var now = Date.now();
  jxSetNavBadge(jxCountOpen(jxRows, now));
  if(!jxPageVisible()) return;
  jxRenderStats(now);
  jxRenderChips(now);
  jxRenderReasonOptions(now);
  jxRenderReport(now);
  if(jxEditing()){
    // الموظف في إيده خانة — نرقّع الكروت من غير ما نشيلها من تحت إيده
    for(var i = 0; i < ids.length; i++) jxPatchCard(ids[i]);
    jxPendingRender = true;
    if(!own){ jxPendingFromOthers = true; jxShowNewBar(true); }
    return;
  }
  jxRenderList();
}

export function jxRenderAll(){
  var now = Date.now();
  jxSetNavBadge(jxCountOpen(jxRows, now));
  jxRenderStats(now);
  jxRenderChips(now);
  jxRenderReasonOptions(now);
  jxRenderList();
  jxRenderReport(now);
}

function jxSetText(id, v){ var el = $id(id); if(el) el.textContent = v; }

// «25%» جوّه جملة عربي بيتقلب «%25» — العزل (LRI…PDI) بيثبّت الرقم والعلامة مع بعض
export function jxPct(n, d){ return d ? '\u2066' + Math.round(n * 100 / d) + '%\u2069' : '—'; }

function jxRenderStats(now){
  var lv = jxLatestVerdictAt(jxRows);
  var from = jxPeriodFrom(jxFilter.days, now), today = jxYmd(now);
  var open = 0, openRet = 0, exc = 0, excBills = {}, fake = 0, cls = 0, savedBills = {}, todayN = 0, todayBy = {};
  for(var i = 0; i < jxRows.length; i++){
    var r = jxRows[i];
    if(jxNeedsFollow(r, lv, now)){ open++; if(jxOutcome(r) === 'returning') openRet++; }
    if(r.staff_updated_at && (r.verdict || r.staff_note) && jxYmd(r.staff_updated_at) === today){
      todayN++;
      var nm = r.verdict_by_name || 'موظف';
      todayBy[nm] = (todayBy[nm] || 0) + 1;
    }
    if(!(r._ymd >= from)) continue;
    if(r.verdict) cls++;
    if(r.verdict === 'fake_update') fake++;
    if(r.kind === 'exception'){
      exc++;
      excBills[r.tracking_no] = 1;
      if(jxOutcome(r) === 'delivered') savedBills[r.tracking_no] = 1;
    }
  }
  var nb = Object.keys(excBills).length, ns = Object.keys(savedBills).length;
  jxSetText('jx-s-open', String(open));
  jxSetText('jx-s-open-sub', open ? (openRet ? ('منهم ' + openRet + ' راجعة') : 'كلها لسه مع J&T') : 'مفيش حاجة مستنية 🎉');
  jxSetText('jx-s-total', String(exc));
  jxSetText('jx-s-total-sub', exc ? ('على ' + nb + ' شحنة') : 'مفيش في الفترة دي');
  jxSetText('jx-s-fake', String(fake));
  jxSetText('jx-s-fake-sub', cls ? ('من ' + cls + ' اتصنّفت') : 'لسه محدش صنّف');
  jxSetText('jx-s-saved', String(ns));
  jxSetText('jx-s-saved-sub', nb ? ('من ' + nb + ' شحنة · ' + jxPct(ns, nb)) : '—');
  jxSetText('jx-s-today', String(todayN));
  var names = Object.keys(todayBy).sort(function(a, b){ return todayBy[b] - todayBy[a]; }).slice(0, 2)
    .map(function(k){ return k + ' ' + todayBy[k]; });
  jxSetText('jx-s-today-sub', names.length ? names.join(' · ') : 'لسه محدش سجّل النهارده');
}

function jxRenderChips(now){
  var lv = jxLatestVerdictAt(jxRows), from = jxPeriodFrom(jxFilter.days, now);
  var c = { open: 0, with_jt: 0, delivered: 0, returned: 0, all: 0 };
  for(var i = 0; i < jxRows.length; i++){
    var r = jxRows[i];
    if(jxNeedsFollow(r, lv, now)) c.open++;
    if(!(r._ymd >= from)) continue;
    var o = jxOutcome(r);
    c.all++;
    if(o === null) c.with_jt++;
    if(o === 'delivered') c.delivered++;
    if(o === 'returning' || o === 'returned') c.returned++;
  }
  var chips = document.querySelectorAll('#jx-chips .jx-chip');
  for(var j = 0; j < chips.length; j++){
    var k = chips[j].getAttribute('data-jx-chip');
    chips[j].classList.toggle('on', k === jxFilter.chip);
    var n = chips[j].querySelector('.n');
    if(n) n.textContent = String(c[k] || 0);
  }
}

function jxRenderReasonOptions(now){
  var sel = $id('jx-freason'); if(!sel) return;
  if(document.activeElement === sel) return;   // القايمة مفتوحة في إيد الموظف — إعادة بنائها بتقفلها
  var from = jxPeriodFrom(jxFilter.days, now), cnt = {};
  for(var i = 0; i < jxRows.length; i++){
    var r = jxRows[i];
    if(!(r._ymd >= from) && !(jxFilter.chip === 'open')) continue;
    var k = r.reason_ar || '';
    if(k) cnt[k] = (cnt[k] || 0) + 1;
  }
  var keys = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a] || a.localeCompare(b); });
  if(jxFilter.reason && !cnt[jxFilter.reason]){ keys.push(jxFilter.reason); cnt[jxFilter.reason] = 0; }
  var html = '<option value="">كل الأسباب</option>';
  for(var j = 0; j < keys.length; j++){
    html += '<option value="' + esc(keys[j]) + '"' + (keys[j] === jxFilter.reason ? ' selected' : '') + '>'
      + esc(keys[j]) + ' (' + cnt[keys[j]] + ')</option>';
  }
  sel.innerHTML = html;
}

function jxRenderList(force){
  var list = $id('jx-list'); if(!list) return;
  if(!force && jxEditing()){ jxPendingRender = true; return; }
  jxPendingRender = false; jxPendingFromOthers = false;
  jxShowNewBar(false);
  var now = Date.now();
  var rows = jxFilterRows(jxRows, jxFilter, now);
  var lv = jxLatestVerdictAt(jxRows);
  if(!jxRows.length){
    list.innerHTML = emptyState({ icon: '✅', title: 'مفيش استثناءات J&amp;T في آخر ' + JX_WINDOW_DAYS + ' يوم',
      sub: 'أول ما J&amp;T تسجّل مشكلة على أي شحنة هتنزل هنا لوحدها.' });
  } else if(!rows.length){
    list.innerHTML = jxFilter.chip === 'open' && !jxFilter.q && !jxFilter.reason && !jxFilter.verdict
      ? emptyState({ icon: '🎉', title: 'مفيش استثناءات محتاجة متابعة', sub: 'أي استثناء جديد من J&amp;T هينزل هنا لوحده — والشارة على زرار التبويب هتنوّر.' })
      : emptyState({ icon: '📭', title: 'مفيش استثناءات بالفلتر ده' });
  } else {
    var shown = rows.slice(0, JX_RENDER_MAX), html = '';
    for(var i = 0; i < shown.length; i++) html += jxCardHtml(shown[i], lv, now);
    if(rows.length > shown.length){
      html += '<div class="jx-more">بيعرض أول ' + shown.length + ' من ' + rows.length + ' — ضيّق الفلتر، أو صدّرهم كلهم بزرار «تصدير».</div>';
    }
    list.innerHTML = html;
  }
  jxRenderHint(rows.length, now);
}

function jxRenderHint(n, now){
  var h = $id('jx-hint'); if(!h) return;
  if(jxFilter.chip === 'open'){
    h.textContent = 'بيعرض كل اللي محتاج متابعة مهما كان تاريخه — الأقدم فوق (الأقرب إنها ترجع). اختار «الحقيقة إيه؟» واكتب عملت إيه، والكارت بيخرج من هنا.';
  } else {
    var from = jxPeriodFrom(jxFilter.days, now);
    h.textContent = n + ' — من ' + Number(from.slice(8, 10)) + '/' + Number(from.slice(5, 7)) + ' لحد النهارده (توقيت القاهرة) · الأحدث فوق';
  }
}

function jxShowNewBar(on){
  var b = $id('jx-newbar'); if(!b) return;
  if(on && jxPendingFromOthers){
    b.textContent = '🔔 وصل تحديث جديد — هيتعرض أول ما تخلّص الخانة اللي في إيدك (أو اضغط هنا)';
    b.style.display = '';
  } else {
    b.style.display = 'none';
  }
}

function jxIsNew(id, now){ return !!jxNew[id] && (now - jxNew[id]) < JX_NEW_MS; }

function jxCopyBtn(v, label){
  return '<button type="button" class="jx-copy" data-jx="copy" data-v="' + esc(v) + '" data-l="' + esc(label) + '" title="نسخ">⧉</button>';
}

function jxPhone(p, label){
  var d = jxTel(p);
  if(!d) return '<span class="jx-muted">—</span>';
  return '<a class="jx-tel" href="tel:' + esc(d) + '" dir="ltr">' + esc(d) + '</a>' + jxCopyBtn(d, label);
}

function jxOutTitle(r, o){
  if(r.outcome) return 'من مسحات J&T' + (r.outcome_at ? ' · ' + fmtDT(r.outcome_at) : '');
  if(o) return 'من حالة الأوردر عندنا: ' + statusLabel(r.order_status);
  return 'لسه مفيش مسح تسليم ولا مرتجع من J&T';
}

function jxHeadHtml(r, now){
  var o = jxOutcome(r), ol = JX_OUT[o || 'none'];
  var tag = r.kind === 'return'
    ? '<span class="jx-att jx-att-ret" title="J&amp;T بدأت ترجّع الشحنة من غير ما تسجّل أي استثناء قبلها">رجوع من غير سبب</span>'
    : '<span class="jx-att" title="ترتيب الاستثناء ده بين استثناءات الشحنة">المحاولة ' + (Number(r.attempt) || 1) + '</span>';
  var en = (r.reason_en && r.reason_en !== r.reason_ar ? r.reason_en : '') + (r.reason_code ? ' · كود ' + r.reason_code : '');
  return '<div class="jx-hrow">' + tag
    + (jxIsNew(r.id, now) ? '<span class="jx-newtag">جديد</span>' : '')
    + '<span class="jx-reason" title="' + esc(en) + '">' + esc(r.reason_ar || r.reason_en || 'استثناء من J&T') + '</span>'
    + '<span class="jx-out ' + ol.cls + '" title="' + esc(jxOutTitle(r, o)) + '">' + esc(ol.t) + '</span>'
    + '<span class="jx-when" title="' + esc(fmtDT(r.event_at)) + '">' + esc(jxAgo(r.event_at, now)) + '</span>'
    + '</div>'
    + (r.courier_note ? '<div class="jx-cnote">📝 المندوب كتب: «' + esc(r.courier_note) + '»</div>' : '');
}

function jxPhotoHtml(ph){
  if(!ph) return '<span class="jx-muted">مفيش صورة من J&amp;T</span>';
  if(ph.expired) return '<span class="jx-muted" title="روابط صور J&amp;T بتعيش حوالي 6 أيام">📷 الصورة انتهت صلاحيتها</span>';
  return '<a class="jx-photo" href="' + esc(ph.url) + '" target="_blank" rel="noopener noreferrer">📷 صورة المندوب</a>';
}

function jxInfoHtml(r, now){
  var addr = [r.ship_prov, r.ship_city, r.ship_area].filter(function(x){ return !!x; }).join(' / ') || r.city || '';
  var cod = r.jt_cod_amount != null ? r.jt_cod_amount : r.total_cost;
  return '<div class="jx-col">'
    + '<div class="jx-ch">👤 العميل</div>'
    + '<div class="jx-line jx-cust"><b>' + esc(r.customer_name || '—') + '</b>'
    + (r.order_uid && r.order_id ? ' <button type="button" class="jx-link" data-jx="detail" title="افتح تفاصيل الأوردر">#' + esc(r.order_uid) + '</button>' : '')
    + '</div>'
    + '<div class="jx-line">📞 ' + jxPhone(r.phone, 'رقم العميل')
    + (jxTel(r.alt_phone) ? ' <span class="jx-sep">·</span> ☎️ ' + jxPhone(r.alt_phone, 'الرقم الإضافي') : '') + '</div>'
    + '<div class="jx-line jx-addr">📍 ' + (addr ? '<b>' + esc(addr) + '</b>' : '')
    + (r.address ? (addr ? ' — ' : '') + esc(r.address) : (addr ? '' : '<span class="jx-muted">مفيش عنوان</span>')) + '</div>'
    + '<div class="jx-line jx-prod">🛍️ ' + esc(r.product_name || '—')
    + (cod != null ? ' <span class="jx-sep">·</span> <b class="jx-cod">' + money(cod) + '</b>' : '') + '</div>'
    + '</div>'
    + '<div class="jx-col">'
    + '<div class="jx-ch">🚚 J&amp;T</div>'
    + '<div class="jx-line">المندوب: ' + (r.courier_name ? '<b>' + esc(r.courier_name) + '</b> ' : '')
    + (jxTel(r.courier_phone) ? jxPhone(r.courier_phone, 'رقم المندوب') : (r.courier_name ? '' : '<span class="jx-muted">مش معروف</span>')) + '</div>'
    + '<div class="jx-line">الفرع: ' + (r.branch ? '<b>' + esc(r.branch) + '</b> ' : '')
    + (jxTel(r.branch_phone) ? jxPhone(r.branch_phone, 'رقم الفرع') : (r.branch ? '' : '<span class="jx-muted">مش معروف</span>')) + '</div>'
    + '<div class="jx-line">البوليصة: <span class="jx-mono" dir="ltr">' + esc(r.tracking_no) + '</span>' + jxCopyBtn(r.tracking_no, 'رقم البوليصة') + '</div>'
    + '<div class="jx-line">' + jxPhotoHtml(jxPhotoState(r.photo_url, now))
    + (r.order_status ? ' <span class="jx-sep">·</span> <span class="jx-muted">الأوردر: ' + esc(statusLabel(r.order_status)) + '</span>' : '') + '</div>'
    + '</div>';
}

function jxMetaHtml(r, superseded, now){
  if(r.staff_updated_at && (r.verdict || r.staff_note)){
    return '✍️ ' + esc(r.verdict_by_name || 'موظف') + ' · <span title="' + esc(fmtDT(r.staff_updated_at)) + '">'
      + esc(jxAgo(r.staff_updated_at, now)) + '</span>';
  }
  if(superseded) return '<span class="jx-muted">اتصنّفت محاولة أحدث على نفس الشحنة</span>';
  return '<span class="jx-muted">لسه محدش سجّل حاجة</span>';
}

function jxWantVerdict(r){
  return jxPendingVerdict[r.id] !== undefined ? jxPendingVerdict[r.id] : (r.verdict || '');
}

function jxActHtml(r, superseded, now){
  var v = jxWantVerdict(r);
  var draft = jxDrafts[r.id];
  var note = draft !== undefined ? draft : (r.staff_note || '');
  var dirty = draft !== undefined && String(draft).trim() !== String(r.staff_note || '').trim();
  var opts = '<option value="">— اختار —</option>';
  for(var i = 0; i < JX_VERDICTS.length; i++){
    var x = JX_VERDICTS[i];
    opts += '<option value="' + x.k + '"' + (x.k === v ? ' selected' : '') + ' title="' + esc(x.d) + '">' + esc(x.t) + '</option>';
  }
  return '<div class="jx-field"><label class="jx-lbl">الحقيقة إيه؟</label>'
    + '<select class="jx-verdict" data-v="' + esc(v) + '">' + opts + '</select></div>'
    + '<div class="jx-field"><label class="jx-lbl">عملت إيه؟</label>'
    + '<textarea class="jx-note" rows="2" maxlength="2000" placeholder="كلّمت العميل وقال… · بلّغت J&amp;T… · اتفقنا على معاد…">' + esc(note) + '</textarea></div>'
    + '<div class="jx-btns">'
    + '<button type="button" class="jx-btn jx-save' + (dirty ? ' show' : '') + '" data-jx="save">💾 حفظ</button>'
    + '<button type="button" class="jx-btn jx-chat" data-jx="chat" title="افتح شات العميل في المحادثات">💬 شات</button>'
    + (r.order_id ? '<button type="button" class="jx-btn" data-jx="detail">📄 الأوردر</button>' : '')
    + '</div>'
    + '<div class="jx-meta">' + jxMetaHtml(r, superseded, now) + '</div>';
}

function jxCardHtml(r, lv, now){
  var open = jxNeedsFollow(r, lv, now), sup = jxSuperseded(r, lv);
  return '<article class="jx-card' + (open ? ' is-open' : '') + (r.verdict ? ' has-verdict' : '')
    + (jxIsNew(r.id, now) ? ' is-new' : '') + (jxSaving[r.id] ? ' is-saving' : '') + '" data-id="' + esc(String(r.id)) + '">'
    + '<div class="jx-head">' + jxHeadHtml(r, now) + '</div>'
    + '<div class="jx-body">'
    + '<div class="jx-info">' + jxInfoHtml(r, now) + '</div>'
    + '<div class="jx-act">' + jxActHtml(r, sup, now) + '</div>'
    + '</div>'
    + '</article>';
}

function jxCardEl(id){
  return document.querySelector('#jx-list .jx-card[data-id="' + String(id).replace(/[^0-9]/g, '') + '"]');
}

// ترقيع كارت واحد في مكانه — من غير ما نلمس خانة في إيد الموظف
function jxPatchCard(id){
  var el = jxCardEl(id), r = jxById[id];
  if(!el || !r) return;
  var now = Date.now(), lv = jxLatestVerdictAt(jxRows), sup = jxSuperseded(r, lv);
  var head = el.querySelector('.jx-head'); if(head) head.innerHTML = jxHeadHtml(r, now);
  var info = el.querySelector('.jx-info'); if(info) info.innerHTML = jxInfoHtml(r, now);
  jxSyncActionUi(el, r, sup, now);
  el.classList.toggle('is-open', jxNeedsFollow(r, lv, now));
  el.classList.toggle('has-verdict', !!r.verdict);
  el.classList.toggle('is-saving', !!jxSaving[r.id]);
}

function jxSyncActionUi(el, r, sup, now){
  if(!el || !r) return;
  var sel = el.querySelector('select.jx-verdict');
  if(sel && document.activeElement !== sel){ var wv = jxWantVerdict(r); sel.value = wv; sel.setAttribute('data-v', wv); }
  var ta = el.querySelector('textarea.jx-note');
  if(ta && document.activeElement !== ta && jxDrafts[r.id] === undefined) ta.value = r.staff_note || '';
  var save = el.querySelector('.jx-save');
  if(save){
    var d = jxDrafts[r.id];
    save.classList.toggle('show', d !== undefined && String(d).trim() !== String(r.staff_note || '').trim());
  }
  var meta = el.querySelector('.jx-meta'); if(meta) meta.innerHTML = jxMetaHtml(r, sup, now || Date.now());
}

function jxTickTimes(){
  var now = Date.now();
  var cards = document.querySelectorAll('#jx-list .jx-card');
  for(var i = 0; i < cards.length; i++){
    var r = jxById[cards[i].getAttribute('data-id')];
    var w = cards[i].querySelector('.jx-when');
    if(r && w) w.textContent = jxAgo(r.event_at, now);
  }
}

// ── تقرير J&T ────────────────────────────────────────────────────────
function jxReportTable(title, rows, withBranch){
  if(!rows.length) return '';
  var max = 12, html = '<div class="jx-rbox"><div class="jx-rtitle">' + title + '</div><div class="thscroll"><table class="jx-rtable"><thead><tr>'
    + '<th>' + (withBranch === 'reason' ? 'السبب' : (withBranch ? 'المندوب' : 'الفرع')) + '</th>'
    + (withBranch === true ? '<th>الفرع</th>' : '')
    + '<th>استثناءات</th><th>رجوع من غير سبب</th><th>FAKE UPDATE</th><th>غلطة J&amp;T</th><th>اتصنّفت</th><th>اتسلمت</th><th>رجعت</th>'
    + '</tr></thead><tbody>';
  for(var i = 0; i < Math.min(max, rows.length); i++){
    var e = rows[i];
    html += '<tr' + ((e.fake + e.jterr) > 0 ? ' class="hot"' : '') + '><td class="k">' + esc(e.k) + '</td>'
      + (withBranch === true ? '<td>' + esc(e.branch || '—') + '</td>' : '')
      + '<td>' + e.exc + '</td><td>' + e.ret + '</td><td class="f">' + e.fake + '</td><td class="f">' + e.jterr + '</td>'
      + '<td>' + e.cls + '</td><td>' + e.del + '</td><td>' + e.back + '</td></tr>';
  }
  html += '</tbody></table></div>';
  if(rows.length > max) html += '<div class="jx-more">و ' + (rows.length - max) + ' كمان — كلهم في التصدير.</div>';
  return html + '</div>';
}

function jxPeriodRows(now){
  var from = jxPeriodFrom(jxFilter.days, now);
  return jxRows.filter(function(r){ return r._ymd >= from; });
}

function jxRenderReport(now){
  var box = $id('jx-report'); if(!box) return;
  var rows = jxPeriodRows(now);
  if(!rows.length){ box.innerHTML = '<div class="jx-empty-sm">مفيش استثناءات في الفترة دي.</div>'; return; }
  var R = jxReport(rows), t = R.tot;
  box.innerHTML = '<div class="jx-rsum"><span class="jx-rsum-t">'
    + '<b>' + t.exc + '</b> استثناء على <b>' + t.bills + '</b> شحنة'
    + (t.ret ? ' · <b>' + t.ret + '</b> رجوع من غير سبب' : '')
    + ' · اتصنّف <b>' + t.cls + '</b>'
    // <bdi> حوالين الإنجليزي: من غيره الرقم اللي بعده بيلزق في نفس المقطع ويتقلب مكانه
    + ' · <bdi>FAKE UPDATE</bdi> <b class="f">' + t.fake + '</b>' + (t.cls ? ' (' + jxPct(t.fake, t.cls) + ' من المتصنّف)' : '')
    + ' · غلطة <bdi>J&amp;T</bdi> <b class="f">' + t.jterr + '</b>'
    + ' · اتسلمت بعد الاستثناء <b>' + t.del + '</b> · رجعت <b>' + t.back + '</b></span>'
    + '<button type="button" class="jx-btn" id="jx-copy-report" title="ملخص نصي تبعته لمسؤول حسابك في J&amp;T">📋 نسخ الملخص</button>'
    + '</div>'
    + jxReportTable('🏢 حسب الفرع', R.branch, false)
    + jxReportTable('🛵 حسب المندوب', R.courier, true)
    + jxReportTable('🧾 حسب السبب', R.reason, 'reason');
}

export function jxReportText(rows, days, now){
  var R = jxReport(rows), t = R.tot;
  var from = jxPeriodFrom(days, now), to = jxYmd(now);
  var lines = [
    'تقرير استثناءات J&T — من ' + from + ' لـ ' + to,
    '• ' + t.exc + ' استثناء على ' + t.bills + ' شحنة' + (t.ret ? ' · ' + t.ret + ' رجوع من غير سبب' : ''),
    '• اتصنّف ' + t.cls + ' — FAKE UPDATE: ' + t.fake + ' · غلطة من J&T: ' + t.jterr,
    '• اتسلمت بعد الاستثناء: ' + t.del + ' شحنة · رجعت: ' + t.back
  ];
  var bad = function(list){ return list.filter(function(e){ return (e.fake + e.jterr) > 0; }).slice(0, 8); };
  var br = bad(R.branch), co = bad(R.courier);
  if(br.length){
    lines.push('', 'الفروع (FAKE UPDATE + غلطة J&T من إجمالي المشاكل):');
    br.forEach(function(e, i){ lines.push((i + 1) + ') ' + e.k + ' — ' + (e.fake + e.jterr) + ' من ' + (e.exc + e.ret)); });
  }
  if(co.length){
    lines.push('', 'المناديب:');
    co.forEach(function(e, i){ lines.push((i + 1) + ') ' + e.k + (e.branch ? ' (' + e.branch + ')' : '') + ' — ' + (e.fake + e.jterr) + ' من ' + (e.exc + e.ret)); });
  }
  return lines.join('\n');
}

function jxCopyReport(){
  var now = Date.now(), rows = jxPeriodRows(now);
  if(!rows.length){ toast('مفيش استثناءات في الفترة دي', 'er'); return; }
  copyTextToClipboard(jxReportText(rows, jxFilter.days, now), 'الملخص');
}

function jxExport(){
  var now = Date.now();
  var rows = jxFilterRows(jxRows, jxFilter, now);
  if(!rows.length){ toast('مفيش صفوف بالفلتر ده تتصدّر', 'er'); return; }
  var name = 'jt-exceptions-' + (jxFilter.chip === 'open' ? 'open' : (jxPeriodFrom(jxFilter.days, now) + '_' + jxYmd(now))) + '.csv';
  try{
    var blob = new Blob([jxCsv(rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ try{ URL.revokeObjectURL(url); a.remove(); }catch(e){ swallow('exceptions/export.cleanup', e); } }, 1500);
    toast('اتصدّر ' + rows.length + ' صف ✓', 'ok');
  }catch(e){ swallow('exceptions/export', e); toast('التصدير ماشتغلش على المتصفح ده', 'er'); }
}

// ── الحفظ ────────────────────────────────────────────────────────────
function jxSaveErr(e){
  var m = String((e && (e.message || e.code)) || '');
  if(/not_allowed|42501/.test(m)) return 'مش مسموحلك تسجّل هنا — اتأكد إنك داخل بحساب شغّال';
  if(/bad_verdict|22023/.test(m)) return 'التصنيف ده مش معروف';
  if(/not_found|P0002/.test(m)) return 'الاستثناء ده مش موجود — اعمل ↻';
  if(/PGRST202|Could not find the function|jt_issue_save/.test(m)) return 'تحديث الداتابيز بتاع التاب لسه مااتطبّقش';
  return 'ماتحفظش — جرّب تاني';
}

export function jxSave(id){
  var r = jxById[id];
  if(!r || !sb) return;
  var card = jxCardEl(id);
  var sel = card && card.querySelector('select.jx-verdict');
  var ta = card && card.querySelector('textarea.jx-note');
  // اللي في الخانات دلوقتي هو «المطلوب» — بيتحفظ في الذاكرة عشان أي رسم وقت الحفظ مايرجّعش القديم
  if(sel) jxPendingVerdict[id] = sel.value;
  if(ta) jxDrafts[id] = ta.value;
  // 🔴 حفظ شغّال = نعيد بعده بآخر قيم — **قبل** فحص «مفيش تغيير»: الفحص بيقارن بآخر نسخة **اتأكدت**،
  // فلو الموظف رجع للقيمة القديمة والحفظ في السكة كان هيطلع «مفيش تغيير» والقيمة اللي في السكة تتسجّل باسمه.
  if(jxSaving[id]){ jxResave[id] = true; return; }
  var verdict = jxWantVerdict(r);
  var noteT = String(jxDrafts[id] !== undefined ? jxDrafts[id] : (r.staff_note || '')).trim();
  if(verdict === (r.verdict || '') && noteT === String(r.staff_note || '').trim()){
    delete jxDrafts[id];
    delete jxPendingVerdict[id];
    jxSyncActionUi(card, r, jxSuperseded(r, jxLatestVerdictAt(jxRows)), Date.now());
    return;
  }
  jxSaving[id] = true;
  // ⚠️ مش disabled: تعطيل خانة في إيد الموظف بيشيل الـfocus منها، فالكارت كان بيتسحب من تحت
  // إيده قبل ما يكتب «عملت إيه» (درس 54). أي تغيير وقت الحفظ = jxResave بآخر قيم.
  if(card) card.classList.add('is-saving');
  var fail = function(err){
    jxSaving[id] = false;
    delete jxResave[id];
    delete jxPendingVerdict[id];   // الاختيار بيرجع للمحفوظ — الكلام بيفضل مسودة
    var c3 = jxCardEl(id);
    if(c3) c3.classList.remove('is-saving');
    toast(jxSaveErr(err), 'er');
    // الاختيار يرجع للمحفوظ — والكلام فاضل في الخانة (مسودة) ماضاعش
    jxSyncActionUi(c3, r, jxSuperseded(r, jxLatestVerdictAt(jxRows)), Date.now());
  };
  sb.rpc('jt_issue_save', { p_id: Number(id), p_verdict: verdict || null, p_note: noteT || null }).then(function(res){
    if(res.error || !res.data){ fail(res.error); return; }
    jxSaving[id] = false;
    var c2 = jxCardEl(id);
    if(c2) c2.classList.remove('is-saving');
    var d = res.data;
    r.verdict = d.verdict || null;
    r.staff_note = d.staff_note || null;
    r.staff_updated_at = d.staff_updated_at || r.staff_updated_at;
    r.verdict_by_name = d.verdict_by_name || r.verdict_by_name;
    if(jxDrafts[id] !== undefined && String(jxDrafts[id]).trim() === String(r.staff_note || '').trim()) delete jxDrafts[id];
    if(jxPendingVerdict[id] !== undefined && jxPendingVerdict[id] === (r.verdict || '')) delete jxPendingVerdict[id];
    // الموظف غيّر تاني والحفظ في السكة → حفظة كمان بآخر قيم (لو مفيش فرق بترجع من غير نداء).
    // والكروت/الشارة بتتحدّث بالمتأكد دلوقتي في الحالتين — مش بعد الحفظة التانية بس.
    var again = !!jxResave[id];
    delete jxResave[id];
    if(again) jxSave(id);
    if(!jxSaving[id]) toast('اتحفظ ✓', 'ok');
    jxAfterChange([id], true);
  }, function(e){ fail(e); });   // من غير ده شبكة وقعت = jxSaving فاضل true للأبد وأي حفظ بعده بيتأجّل في صمت
}

// ── الشات ────────────────────────────────────────────────────────────
// 🔴 المحادثات ليها تاب لوحدها: الطلب بيتكتب في localStorage قبل ما نركّز التاب — التاب المفتوحة
// بتسمعه بحدث `storage`، والجديدة بتلاقيه أول ما المحادثات تتحمّل. ولو مفيش تاب (موبايل · حاجب
// نوافذ) بنفتح المحادثات هنا والطلب بيتسلّم في الذاكرة مش localStorage (عشان تاب تانية ماتخطفهوش).
function jxOpenChat(id){
  var r = jxById[id]; if(!r) return;
  var wa = waIdFromPhone(r.phone);
  if(!wa){ toast('رقم العميل مش مفهوم — مانقدرش نفتح بيه شات', 'er'); return; }
  var req = { wa: wa, name: r.customer_name || '', phone: r.phone || '' };
  // الطلب بيتكتب **بعد** ما التاب اتأكدت (جديدة لسه بتحمّل فهتقراه · مفتوحة بتسمع حدث storage) —
  // لو اتكتب قبل وطلعنا هنعرض هنا (موبايل · حاجب نوافذ)، أي تاب محادثات تانية كانت هتخطفه وتبدّل شاتها
  if(openOwnTab('inbox')){ waRequestOpenChat(req, false); return; }
  waRequestOpenChat(req, true);
  showPage('inbox');
}

// ── الأحداث ──────────────────────────────────────────────────────────
function jxSetChip(k){
  if(!k) return;
  jxFilter.chip = k;
  var now = Date.now();
  jxRenderChips(now);
  jxRenderReasonOptions(now);
  jxRenderList(true);
}

function jxCardId(el){
  var card = el && el.closest ? el.closest('.jx-card') : null;
  return card ? card.getAttribute('data-id') : null;
}

function jxOnClick(e){
  var t = e.target;
  if(!t || !t.closest) return;
  if(t.closest('.sc-info')) return;   // أيقونة الشرح على الكارت مش ضغطة فلتر
  var chip = t.closest('[data-jx-chip]');
  if(chip){ jxSetChip(chip.getAttribute('data-jx-chip')); return; }
  if(t.closest('#jx-refresh')){ loadJtIssues(true); return; }
  if(t.closest('#jx-export')){ jxExport(); return; }
  if(t.closest('#jx-copy-report')){ jxCopyReport(); return; }
  if(t.closest('#jx-newbar')){ jxRenderList(true); return; }
  var b = t.closest('[data-jx]');
  if(!b) return;
  var act = b.getAttribute('data-jx');
  if(act === 'copy'){ e.preventDefault(); copyTextToClipboard(b.getAttribute('data-v'), b.getAttribute('data-l') || 'الرقم'); return; }
  var id = jxCardId(b);
  if(id === null) return;
  if(act === 'detail'){ var r = jxById[id]; if(r && r.order_id) openDetail(r.order_id); return; }
  if(act === 'chat'){ jxOpenChat(id); return; }
  if(act === 'save'){ jxSave(id); return; }
}

function jxOnChange(e){
  var t = e.target;
  if(!t) return;
  if(t.id === 'jx-fdays'){ jxFilter.days = Number(t.value) || 7; jxRenderAll(); return; }
  if(t.id === 'jx-freason'){ jxFilter.reason = t.value; jxRenderList(true); return; }
  if(t.id === 'jx-fverdict'){ jxFilter.verdict = t.value; jxRenderList(true); return; }
  if(t.classList && t.classList.contains('jx-verdict')){
    t.setAttribute('data-v', t.value);
    var id = jxCardId(t);
    if(id !== null){ jxPendingVerdict[id] = t.value; jxSave(id); }
  }
}

function jxOnInput(e){
  var t = e.target;
  if(!t) return;
  if(t.id === 'jx-search'){
    clearTimeout(jxSearchTimer);
    var v = t.value;
    jxSearchTimer = setTimeout(function(){ jxFilter.q = v; jxRenderList(true); }, 200);
    return;
  }
  if(t.classList && t.classList.contains('jx-note')){
    var id = jxCardId(t);
    if(id === null) return;
    jxDrafts[id] = t.value;
    var r = jxById[id], card = t.closest('.jx-card');
    var save = card && card.querySelector('.jx-save');
    if(save) save.classList.toggle('show', !!r && String(t.value).trim() !== String(r.staff_note || '').trim());
  }
}

function jxOnFocusOut(e){
  var t = e.target;
  if(t && t.classList && t.classList.contains('jx-note')){
    var id = jxCardId(t);
    if(id !== null) jxSave(id);
  }
  // رسم مؤجّل: نستنى لحد ما مفيش خانة في إيد الموظف (الانتقال من الاختيار للكلام في نفس الكارت مايرسمش)
  if(jxPendingRender) setTimeout(function(){ if(jxPendingRender && !jxEditing()) jxRenderList(); }, 250);
}

function jxOnKeyDown(e){
  var t = e.target;
  if(t && t.classList && t.classList.contains('jx-note') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    var id = jxCardId(t);
    if(id !== null) jxSave(id);
  }
}

export function initExceptions(){
  var page = $id('page-exceptions');
  if(!page) return;
  var fv = $id('jx-fverdict');
  if(fv){
    var html = '<option value="">أي تصنيف</option><option value="none">لسه متصنفتش</option>';
    for(var i = 0; i < JX_VERDICTS.length; i++) html += '<option value="' + JX_VERDICTS[i].k + '">' + esc(JX_VERDICTS[i].t) + '</option>';
    fv.innerHTML = html;
  }
  var fd = $id('jx-fdays'); if(fd) fd.value = String(jxFilter.days);
  page.addEventListener('click', jxOnClick);
  page.addEventListener('change', jxOnChange);
  page.addEventListener('input', jxOnInput);
  page.addEventListener('focusout', jxOnFocusOut);
  page.addEventListener('keydown', jxOnKeyDown);
}
