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
//
// المراحل (8 أكتوبر — «مش عارف مين اتعامل وامتى · والي اتعامل معاها اجيبها منين عشان اتابعها»):
//   📥 محتاجة تعامل (`jxNeedsFollow`) → 👀 مستنية مراجعتك (`jxNeedsReview`) → ✅ اتراجعت — تابع النتيجة → 🗂️ الكل.
//   كل كارت اتعامل معاه عليه سطر واضح تحت العنوان: مين · إمتى (بالساعة) · اختار إيه · كتب إيه · المراجعة.
// 🔴 المراجعة بالـrev مش بالوقت: `staff_rev` بيزيد مع كل حفظة فيها تغيير، و`reviewed_rev` = النسخة اللي الأدمن
//    راجعها. الـJS بيقص الميكروثانية من أي timestamp فمقارنة الأوقات كانت هتغلط في الاتجاهين. والـrev نفسه
//    بيتبعت مع «✓ تمام» (`p_seen_rev`) — الموظف عدّل وانت بتراجع = السيرفر بيرفض (stale) مش بيعلّم القديم.
// 🔴 «↩️ رجّعها للموظف» بترجّع الكارت لـ«محتاجة تعامل» فوق الكل لحد ما الموظف يعدّل — حتى لو الشحنة اتقفلت
//    (الأدمن طلب صراحةً). والفلاتر المخفية (الفترة · السبب · التصنيف · مين) بتتطبّق في «الكل» بس — فلتر
//    مستخبي مايقصّش طابور أبداً.

import { $id, esc } from '../core/dom.js';
import { emptyState } from '../core/empty.js';
import { fmtDT, money, normalizePhone, toLatinDigits, ymdAddDays } from '../core/format.js';
import { CANCELLED_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusIn, statusLabel } from '../core/constants.js';
import { renderLoadError } from '../core/loaderr.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { openOwnTab } from '../core/router.js';
import { skelList } from '../core/skeleton.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { veilDone } from '../core/veil.js';
import { copyTextToClipboard } from '../ui/clipboard.js';
import { audioReady, deviceSoundOn, playAlert, setDeviceSound, unlockAudio } from '../core/alert-sound.js';
import { currentTenantId, currentRole, currentUser } from '../auth/auth.js';
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
  + 'ship_prov,ship_city,ship_area,product_name,total_cost,jt_cod_amount,order_status,'
  + 'reviewed_at,reviewed_by_name,verdict_by,staff_rev,reviewed_rev,review_state,review_note,verdict_set_by_name,verdict_set_at,'
  + 'reported_at,return_started_at';
// الشارة: «محتاجة تعامل» محتاجة أعمدة المراجعة كمان (المترجّعة للموظف بتتعدّ فيها) — من غير ملاحظات/عناوين
var JX_BADGE_COLS = 'id,tracking_no,kind,event_at,verdict,outcome,outcome_at,order_status,staff_rev,reviewed_rev,review_state,reported_at';
var JX_LOG_COLS = 'id,at,by_name,actor_role,action,verdict,note,prev_verdict,prev_note,verdict_changed,note_changed,review_state,review_note';

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
// chip = المرحلة: open · review · done · all. days/reason/verdict/who بيتطبّقوا في «الكل» بس · out في «اتراجعت» و«الكل»
export var jxFilter = { chip: 'open', days: 7, repDays: 30, reason: '', verdict: '', who: '', out: '', rep: '', q: '' };
var jxReviewing = {};          // id → مراجعة في السكة (قفل في الكود — مش disabled)
var jxEditOpen = {};           // id → الأدمن داس «✏️ عدّل» على كارت متصنّف
var jxLogOpen = {}, jxLogCache = {};  // id → السجل مفتوح / { key: updated_at, rows }
var jxStageChosen = false;
// الكارت اللي الأدمن لسه راجعه بيفضل مكانه (متعلّم) لحد ما يغيّر المرحلة — الطابور مايتحركش تحت إيده فضغطة سريعة
// تانية ماتقعش على كارت ماقراهوش. العدّادات بتتحدّث فوراً عادي.
var jxHold = {};               // id → المرحلة اللي اتعمل فيها الفعل (review · done)
var jxRvLast = {};             // id → تعليق «رجّعها» اللي رجع stale — بيتكتب تاني في المودال
var jxShownDay = '';     // الأدمن بيفتح على «مستنية مراجعتك» لو فيها حاجة — مرة واحدة أول تحميل
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

// الأدمن رجّعها للموظف ولسه محدش عدّل بعدها (الـrev اللي اترجّع = آخر rev)
export function jxSentBack(r){
  return !!(r && r.verdict && r.review_state === 'sent_back' && r.reviewed_rev != null
    && Number(r.reviewed_rev) >= Number(r.staff_rev || 0));
}

// اتصنّفت ولسه الأدمن ماراجعهاش — أو اتعدّلت بعد ما راجعها (الـrev زاد)
export function jxNeedsReview(r){
  return !!(r && r.verdict && (r.reviewed_rev == null || Number(r.reviewed_rev) < Number(r.staff_rev || 0)));
}

export function jxNeedsFollow(r, lv, now){
  if(!r) return false;
  // المترجّعة للموظف: فوق الطابور لحد ما يعدّل — حتى لو الشحنة اتقفلت (الأدمن طلب ده صراحةً)
  if(jxSentBack(r)) return true;
  // اترجّعت والموظف شال التصنيف = لسه محتاجة «الحقيقة إيه؟» — مهما كانت النتيجة (طلب الأدمن مايضيعش)
  if(!r.verdict && r.review_state === 'sent_back') return true;
  // اتراجعت (أو اتعامل معاها الأدمن) وبعدين التصنيف اتشال = محتاجة «الحقيقة إيه؟» تاني — مهما كانت النتيجة
  if(!r.verdict && r.review_state && r.reviewed_rev != null && Number(r.reviewed_rev) < Number(r.staff_rev || 0)) return true;
  if(r.verdict) return false;
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

// المرحلة — مصدر واحد للشرايح والعدّادات والشارة والكارت: open · review · done · null (مالهاش طابور — في «الكل» بس)
// حد اتعامل معاها (تصنيف أو ملاحظة)
export function jxActed(r){ return !!(r && r.staff_updated_at && (r.verdict || r.staff_note)); }

export function jxStage(r, lv, now){
  if(jxNeedsFollow(r, lv, now)) return 'open';
  if(jxNeedsReview(r)) return 'review';
  if(r && r.verdict) return 'done';
  // ملاحظة بس والشحنة اتقفلت = اتعامل معاها (من غير تصنيف) — مكانها «اتراجعت» مش «الكل» بس
  if(jxActed(r) && !jxSuperseded(r, lv)) return 'done';
  return null;
}

export function jxCountReview(rows){
  var n = 0;
  for(var i = 0; i < rows.length; i++) if(jxNeedsReview(rows[i]) && !jxSentBack(rows[i])) n++;
  return n;
}

// «اتراجعت — تابع النتيجة»: آخر محاولة متصنّفة لكل شحنة (المتابعة على الشحنة) — والشحنة اللي رجعت للطابور مش هنا
function jxDoneBills(rows, lv, now){
  var open = {};
  for(var i = 0; i < rows.length; i++) if(jxNeedsFollow(rows[i], lv, now)) open[rows[i].tracking_no] = 1;
  return open;
}
function jxInDone(r, lv, openBills, now){
  if(jxStage(r, lv, now) !== 'done') return false;
  var t = isFinite(r._t) ? r._t : Date.parse(r.event_at);
  if(lv[r.tracking_no] > t) return false;          // محاولة أحدث على نفس الشحنة اتصنّفت
  return !openBills[r.tracking_no];                 // استثناء جديد على نفس الشحنة = رجعت للطابور
}

function jxOutMatch(o, k){
  if(!k) return true;
  if(k === 'with_jt') return o === null;
  if(k === 'returned') return o === 'returning' || o === 'returned';
  return o === k;
}

var JX_TIME_FMT = null;
// «النهارده 12:33 م» · «إمبارح 6:05 م» · «6/10 6:05 م» — توقيت القاهرة (المالك سأل «اتعامل امتى؟»)
export function jxWhen(iso, now){
  var t = Date.parse(iso || '');
  if(!isFinite(t)) return '';
  var tm = '';
  try{
    if(!JX_TIME_FMT) JX_TIME_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true });
    tm = JX_TIME_FMT.format(new Date(t)).replace(/\s*AM$/i, ' ص').replace(/\s*PM$/i, ' م');
  }catch(e){ tm = ''; }
  var d = jxYmd(t), today = jxYmd(now);
  var day = d === today ? 'النهارده' : (d === ymdAddDays(today, -1) ? 'إمبارح' : (Number(d.slice(8, 10)) + '/' + Number(d.slice(5, 7))));
  return day + (tm ? ' ' + tm : '');
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

function jxTs(iso){ var t = Date.parse(iso || ''); return isFinite(t) ? t : 0; }

// ── بلاغاتنا لـJ&T (8 أكتوبر — طلب المالك) ─────────────────────────────
// «لو اوردر اتسلم من الي احنا مبلغين عليهم انهم Fake Update او مشكلة … عشان نعرف المتابعة مجدية ولا لا، هل هما في J&T حلوا
// المشكلة فعلا بعد الابلاغ». البلاغ = التصنيف الحالي FAKE UPDATE أو «غلطة من J&T». الوحدة = **الشحنة** (البوليصة):
// وقت البلاغ = reported_at (أول مرة اتصنّف بلاغ — مابيتحركش بين النوعين · migration jt_issues_report_times) ·
// النتيجة من أحدث صف على البوليصة (مسحات J&T: outcome_at = التسليم/توقيع المرتجع · return_started_at = أول 172) ·
// «اتكرر» = J&T سجّلت استثناء تاني بعد البلاغ والفريق ماأكّدش إنه من العميل (يعني ماحلّتش).
export var JX_REPORTED = ['fake_update', 'jt_error'];
// تصنيفات معناها «المشكلة مش من J&T» — محاولة بعد البلاغ اتصنّفت كده مابتتحسبش على J&T
export var JX_NOT_JT = ['real_delay', 'real_refusal', 'no_answer_us', 'data_fixed'];
export function jxIsReported(r){ return !!(r && JX_REPORTED.indexOf(r.verdict) >= 0); }
function jxReportAt(r){ return jxTs(r.reported_at || r.verdict_set_at || r.staff_updated_at); }

// bucket: after (اتسلمت بعد البلاغ) · before (اتسلمت قبل ما نبلّغ) · pending (لسه مع J&T) · returned (رجعت رغم البلاغ) ·
//         ret_cust (رجعت والفريق أكّد إن السبب من العميل بعد البلاغ) · ret_before (بدأت ترجع قبل ما نبلّغ) · cancelled.
// اللي بيدخل «اتحلّت %» = after و returned بس — الباقي مش حكم على J&T.
function jxRepBucket(s){
  var out = s.out, outAt = s.outAt, firstAt = s.firstAt;
  if(out === 'delivered') return (outAt && outAt < firstAt) ? 'before' : 'after';
  if(out === 'returning' || out === 'returned'){
    // بداية المرتجع: من السيرفر — ولو مش متاحة: «راجعة» = وقتها هو بدايتها · صف «رجوع من غير سبب» = وقته
    var rs = s.retStart || (out === 'returning' ? outAt : 0);
    if(rs ? rs < firstAt : (outAt && outAt < firstAt)) return 'ret_before';
    if(s.lastPost && JX_NOT_JT.indexOf(s.lastPost.verdict) >= 0) return 'ret_cust';
    return 'returned';
  }
  if(out === 'cancelled') return 'cancelled';
  return 'pending';
}

// كل الشحنات اللي بلّغنا عنها (من غير فلاتر) — مصدر واحد للمرحلة والملخص والعدّاد وسطر الكارت والتنبيه
export function jxReportedShipments(rows){
  var by = {}, order = [];
  for(var i = 0; i < rows.length; i++){
    var r = rows[i];
    if(!jxIsReported(r)) continue;
    var b = by[r.tracking_no];
    if(!b){ b = by[r.tracking_no] = { bill: r.tracking_no, rows: [], firstAt: Infinity, latest: null, verdicts: {} }; order.push(b); }
    b.rows.push(r);
    b.verdicts[r.verdict] = 1;
    var t = jxReportAt(r);
    if(t && t < b.firstAt){ b.firstAt = t; b.first = r; }
    if(!b.latest || jxTs(r.event_at) > jxTs(b.latest.event_at)) b.latest = r;
  }
  var list = [];
  for(var j = 0; j < order.length; j++){
    var s = order[j];
    if(!isFinite(s.firstAt)) continue;
    // النتيجة من أحدث صف على البوليصة (أي نوع) — المسحات اللي بعد آخر استثناء هي اللي بتحسم
    var last = s.latest, repeats = [], custLater = [], lastPost = null, retStart = 0, retRow = 0;
    for(var k = 0; k < rows.length; k++){
      var x = rows[k];
      if(x.tracking_no !== s.bill) continue;
      if(jxTs(x.event_at) > jxTs(last.event_at)) last = x;
      var rsx = jxTs(x.return_started_at);
      if(rsx && (!retStart || rsx < retStart)) retStart = rsx;
      if(x.kind === 'return'){ var rr = jxTs(x.event_at); if(rr && (!retRow || rr < retRow)) retRow = rr; }
      if(x.kind === 'exception' && jxTs(x.event_at) > s.firstAt){
        if(!lastPost || jxTs(x.event_at) > jxTs(lastPost.event_at)) lastPost = x;
        if(JX_NOT_JT.indexOf(x.verdict) >= 0) custLater.push(x); else repeats.push(x);
      }
    }
    var byEv = function(a, b2){ return jxTs(a.event_at) - jxTs(b2.event_at); };
    repeats.sort(byEv); custLater.sort(byEv);
    s.out = jxOutcome(last);
    s.outAt = last.outcome ? jxTs(last.outcome_at) : 0;
    s.retStart = retStart || retRow;
    s.repeats = repeats; s.custLater = custLater; s.lastPost = lastPost;
    s.bucket = jxRepBucket(s);
    s.hours = (s.bucket === 'after' && s.outAt) ? (s.outAt - s.firstAt) / 3600000 : null;
    list.push(s);
  }
  return list;
}

var JX_REP_ORDER = { after: 0, pending: 1, returned: 2, ret_cust: 3, ret_before: 4, before: 5, cancelled: 6 };
var JX_REP_GROUP = {
  after:      '✅ اتسلمت بعد البلاغ',
  pending:    '⏳ لسه مع J&T',
  returned:   '↩️ رجعت رغم البلاغ',
  ret_cust:   '↩️ رجعت — والفريق أكّد إن السبب من العميل بعد البلاغ (مش على J&T)',
  ret_before: '↩️ كانت بدأت ترجع قبل ما نبلّغ (مابتتحسبش للمتابعة)',
  before:     '✅ اتسلمت قبل ما نبلّغ (مابتتحسبش للمتابعة)',
  cancelled:  'اتلغت عندنا'
};

// الفترة في المرحلة دي ليها قيمتها (الافتراضي 30 يوم = كل اللي اتحمّل) — مش فترة «الكل»
export function jxRepDays(f){ return f.repDays != null ? f.repDays : 30; }

// فلاتر المرحلة: الفترة بتاريخ البلاغ (مش الاستثناء) · النتيجة · نوع البلاغ · البحث
export function jxReportFilter(list, f, now){
  var from = jxPeriodFrom(jxRepDays(f), now), q = jxNorm(toLatinDigits(f.q)), qd = normalizePhone(f.q);
  var out = list.filter(function(s){
    if(!(jxYmd(s.firstAt) >= from)) return false;
    if(f.rep && !s.verdicts[f.rep]) return false;
    if(f.out){
      if(f.out === 'with_jt' && s.bucket !== 'pending') return false;
      if(f.out === 'delivered' && s.bucket !== 'after' && s.bucket !== 'before') return false;
      if(f.out === 'returned' && s.bucket !== 'returned' && s.bucket !== 'ret_cust' && s.bucket !== 'ret_before') return false;
      if(f.out === 'cancelled' && s.bucket !== 'cancelled') return false;
    }
    if(q){
      var hit = false;
      for(var i = 0; i < s.rows.length && !hit; i++) hit = jxMatches(s.rows[i], q, qd);
      if(!hit) return false;
    }
    return true;
  });
  // اتسلمت بعد البلاغ فوق (الأحدث تسليم) · لسه مع J&T (الأقدم بلاغ) · رجعت · … · قبل البلاغ · اتلغت
  out.sort(function(a, b){
    return JX_REP_ORDER[a.bucket] - JX_REP_ORDER[b.bucket]
      || (a.bucket === 'after' ? b.outAt - a.outAt : (a.bucket === 'pending' ? a.firstAt - b.firstAt : b.firstAt - a.firstAt));
  });
  return out;
}

function jxMedian(a){
  if(!a.length) return null;
  var b = a.slice().sort(function(x, y){ return x - y; }), m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

// الأرقام: «اتحلّت» = اتسلمت بعد البلاغ ÷ (اتسلمت بعد البلاغ + رجعت رغمه) — اللي لسه مع J&T مابيدخلش الحساب لسه، ولا اللي
// رجعت بسبب العميل (الفريق أكّد) ولا اللي كانت بدأت ترجع أو اتسلمت قبل البلاغ.
// ⚠️ مفيش مقارنة بالشحنات اللي مابلّغناش عنها عن قصد: فيها الرفض الحقيقي (هترجع أكيد) فالمقارنة هتنفخ أثر البلاغ.
export function jxReportTotals(list){
  var t = { n: list.length, after: 0, before: 0, pending: 0, returned: 0, ret_cust: 0, ret_before: 0, cancelled: 0,
            repeated: 0, hours: [], oldestPending: null, byV: {} };
  for(var i = 0; i < list.length; i++){
    var s = list[i];
    t[s.bucket]++;
    if(s.repeats.length) t.repeated++;
    if(s.hours != null) t.hours.push(s.hours);
    if(s.bucket === 'pending' && (t.oldestPending === null || s.firstAt < t.oldestPending)) t.oldestPending = s.firstAt;
    for(var v in s.verdicts){
      if(!Object.prototype.hasOwnProperty.call(s.verdicts, v)) continue;
      var e = t.byV[v] || (t.byV[v] = { n: 0, after: 0, returned: 0 });
      e.n++; if(s.bucket === 'after') e.after++; if(s.bucket === 'returned') e.returned++;
    }
  }
  t.closed = t.after + t.returned;
  t.medianHours = jxMedian(t.hours);
  return t;
}

export function jxDur(h){
  if(h == null || !isFinite(h)) return '';
  if(h < 1) return 'أقل من ساعة';
  if(h < 48) return Math.round(h) + ' ساعة';
  return (Math.round(h / 24 * 10) / 10) + ' يوم';
}

// «🆕» = شحنة اتسلمت بعد البلاغ ولسه ماظهرتش قدامك في المرحلة دي على الجهاز ده (sahl_jx_rep_seen_<uid> = قايمة بوالص
// اتشافت). بالبوليصة مش بالوقت: وقت التسليم من مسح J&T (ممكن يوصل متأخر دقايق)، وساعة الجهاز مالهاش دخل.
var JX_REP_SEEN_KEY = 'sahl_jx_rep_seen_';
var JX_REP_SEEN_MAX = 600;
var jxRepSeen = null;          // { bill: 1 } — من localStorage
var jxRepFresh = {};           // البوالص اللي ظهرت «جديدة» في الزيارة دي — العلامة بتفضل لحد ما تسيب المرحلة
function jxRepSeenKey(){ return JX_REP_SEEN_KEY + (currentUser && currentUser.id || 'x'); }
var jxRepSeenFor = '';
function jxRepSeenLoad(list, now){
  if(jxRepSeen && jxRepSeenFor === jxRepSeenKey()) return jxRepSeen;
  jxRepSeenFor = jxRepSeenKey();
  var raw = null;
  try{ raw = localStorage.getItem(jxRepSeenKey()); }catch(e){ raw = null; }
  var arr = null;
  try{ arr = raw ? JSON.parse(raw) : null; }catch(e){ arr = null; }
  jxRepSeen = {};
  if(Array.isArray(arr)){ for(var i = 0; i < arr.length; i++) jxRepSeen[arr[i]] = 1; }
  else {
    // أول مرة خالص على الجهاز ده: اللي اتسلم من أكتر من 24 ساعة يتحسب متشاف (مش التاريخ كله «جديد»)
    for(var j = 0; j < (list || []).length; j++){
      var s = list[j];
      if(s.bucket === 'after' && s.outAt && s.outAt < now - DAY_MS) jxRepSeen[s.bill] = 1;
    }
    jxRepSeenSave();
  }
  return jxRepSeen;
}
function jxRepSeenSave(){
  var keys = Object.keys(jxRepSeen || {});
  if(keys.length > JX_REP_SEEN_MAX) keys = keys.slice(keys.length - JX_REP_SEEN_MAX);
  try{ localStorage.setItem(jxRepSeenKey(), JSON.stringify(keys)); }catch(e){ /* مفيش storage */ }
}
export function jxRepIsNew(s, seen){ return s.bucket === 'after' && !(seen && seen[s.bill]); }

function jxRepLabel(f){
  return f && f.rep ? (f.rep === 'fake_update' ? 'FAKE UPDATE' : 'غلطة من J&T') : 'FAKE UPDATE + غلطة من J&T';
}

export function jxReportCopyText(list, t, f, now){
  var from = jxPeriodFrom(jxRepDays(f), now), to = jxYmd(now);
  var lines = ['نتيجة بلاغاتنا لـJ&T (' + jxRepLabel(f) + ') — من ' + from + ' لـ ' + to,
    '• بلّغنا عن ' + t.n + ' شحنة',
    '• اتسلم بعد البلاغ: ' + t.after + (t.medianHours != null ? ' (في المتوسط بعد ' + jxDur(t.medianHours) + ')' : ''),
    '• رجع رغم البلاغ: ' + t.returned + (t.closed ? ' — يعني اتحلّت ' + Math.round(t.after * 100 / t.closed) + '% من اللي اتقفلت' : ''),
    '• لسه معاكم: ' + t.pending,
    '• سجّلتوا عليها استثناء تاني بعد البلاغ: ' + t.repeated];
  if(t.ret_cust) lines.push('• رجعت بسبب العميل بعد ما اتأكدنا (مش محسوبة عليكم): ' + t.ret_cust);
  if(t.ret_before) lines.push('• كانت بدأت ترجع قبل البلاغ (مش محسوبة): ' + t.ret_before);
  if(t.before) lines.push('• اتسلمت قبل البلاغ (مش محسوبة): ' + t.before);
  var bad = list.filter(function(s){ return s.bucket === 'returned' || s.repeats.length; }).slice(0, 15);
  if(bad.length){
    lines.push('', 'الشحنات اللي المشكلة فضلت فيها بعد البلاغ:');
    bad.forEach(function(s, i){
      var x = s.repeats.length ? s.repeats[s.repeats.length - 1] : s.latest;
      lines.push((i + 1) + ') ' + s.bill + ' — ' + (s.bucket === 'returned' ? 'رجعت' + (s.repeats.length ? ' واتكرر الاستثناء ' + s.repeats.length + ' مرة' : '')
                                                                             : 'اتكرر الاستثناء ' + s.repeats.length + ' مرة')
        + (x.branch ? ' — ' + x.branch : '') + (x.courier_name ? ' — ' + x.courier_name : ''));
    });
  }
  return lines.join('\n');
}

// تصدير المرحلة: صف لكل شحنة بأعمدة البلاغ (مش أعمدة الاستثناء العامة)
var JX_REP_RESULT_TXT = { after: 'اتسلمت بعد البلاغ', before: 'اتسلمت قبل البلاغ', pending: 'لسه مع J&T', returned: 'رجعت رغم البلاغ',
  ret_cust: 'رجعت — السبب من العميل', ret_before: 'كانت بدأت ترجع قبل البلاغ', cancelled: 'اتلغت عندنا' };
export function jxReportCsv(list){
  var head = ['البوليصة', 'رقم الأوردر', 'العميل', 'التليفون', 'نوع البلاغ', 'مين بلّغ', 'وقت البلاغ', 'النتيجة', 'وقت النتيجة',
    'اتسلمت بعد (ساعة)', 'استثناء تاني بعد البلاغ', 'آخر سبب من J&T', 'الفرع', 'المندوب', 'ملاحظة الفريق'];
  var lines = [head.map(jxCsvCell).join(',')];
  for(var i = 0; i < list.length; i++){
    var s = list[i], f = s.first || s.latest, r = s.latest, x = s.repeats.length ? s.repeats[s.repeats.length - 1] : f;
    lines.push([
      jxCsvCell(s.bill), jxCsvDigits(r.order_uid), jxCsvCell(r.customer_name), jxCsvDigits(r.phone),
      jxCsvCell(Object.keys(s.verdicts).map(jxVerdictLabel).join(' + ')), jxCsvCell(f.verdict_set_by_name || f.verdict_by_name),
      jxCsvCell(fmtDT(new Date(s.firstAt).toISOString())), jxCsvCell(JX_REP_RESULT_TXT[s.bucket]),
      jxCsvCell(s.outAt ? fmtDT(new Date(s.outAt).toISOString()) : ''),
      jxCsvCell(s.hours != null ? Math.round(s.hours * 10) / 10 : ''), jxCsvCell(s.repeats.length),
      jxCsvCell(x.reason_ar || x.reason_en), jxCsvCell(x.branch), jxCsvCell(x.courier_name), jxCsvCell(f.staff_note)
    ].join(','));
  }
  return '﻿' + lines.join('\r\n');
}

export function jxFilterRows(rows, f, now){
  // بلاغاتنا: صف لكل شحنة (أحدث استثناء متبلّغ عنه) — والتصدير بياخد نفس القايمة
  if(f.chip === 'reports') return jxReportFilter(jxReportedShipments(rows), f, now).map(function(x){ return x.latest; });
  var lv = jxLatestVerdictAt(rows);
  var openBills = f.chip === 'done' ? jxDoneBills(rows, lv, now) : null;
  var from = jxPeriodFrom(f.days, now);
  var q = jxNorm(toLatinDigits(f.q));
  var qd = normalizePhone(f.q);
  var out = [];
  for(var i = 0; i < rows.length; i++){
    var r = rows[i], o = jxOutcome(r);
    if(f.chip === 'open'){
      // الطابور مابيتقيّدش بالفترة: اللي محتاج تعامل لازم يبان مهما كان تاريخه
      if(!jxNeedsFollow(r, lv, now)) continue;
    } else if(f.chip === 'review'){
      if(jxStage(r, lv, now) !== 'review' && jxHold[r.id] !== 'review') continue;
    } else if(f.chip === 'done'){
      if(jxHold[r.id] !== 'done'){
        if(!jxInDone(r, lv, openBills, now)) continue;
        if(!jxOutMatch(o, f.out)) continue;
      }
    } else {
      // «الكل» — الفلاتر دي بتتطبّق هنا بس (مستخبية في الطوابير ومابتقصّهاش)
      if(!(r._ymd >= from)) continue;
      if(!jxOutMatch(o, f.out)) continue;
      if(f.reason && (r.reason_ar || '') !== f.reason) continue;
      if(f.verdict === 'none'){ if(r.verdict) continue; }
      else if(f.verdict === 'any'){ if(!r.verdict) continue; }
      else if(f.verdict && r.verdict !== f.verdict) continue;
      if(f.who === '__none'){ if(r.staff_updated_at && (r.verdict || r.staff_note)) continue; }
      else if(f.who && (r.verdict_by_name || '') !== f.who) continue;
    }
    if(q && !jxMatches(r, q, qd)) continue;
    out.push(r);
  }
  if(f.chip === 'open'){
    // المترجّعة من الأدمن فوق · بعدها الأقدم (الأقرب إنها ترجع)
    out.sort(function(a, b){ return (jxSentBack(b) ? 1 : 0) - (jxSentBack(a) ? 1 : 0) || a._t - b._t; });
  } else if(f.chip === 'review'){
    // الأقدم تعامل فوق — مفيش حاجة تتدفن
    out.sort(function(a, b){ return jxTs(a.staff_updated_at) - jxTs(b.staff_updated_at) || a._t - b._t; });
  } else if(f.chip === 'done'){
    // اللي لسه مع J&T فوق (الأقدم من ساعة التعامل = الأولى بالمتابعة) · بعدها الأحدث نتيجة
    out.sort(function(a, b){
      var oa = jxOutcome(a) === null, ob = jxOutcome(b) === null;
      if(oa !== ob) return oa ? -1 : 1;
      if(oa) return jxTs(a.staff_updated_at) - jxTs(b.staff_updated_at);
      return jxTs(b.outcome_at || b.staff_updated_at) - jxTs(a.outcome_at || a.staff_updated_at);
    });
  } else {
    out.sort(function(a, b){ return b._t - a._t; });
  }
  return out;
}

// اتعامل قبل كده على محاولة أقدم لنفس الشحنة (للكارت الجديد: «اتقال إيه للعميل المرة اللي فاتت»)
function jxPrevHandled(r){
  var best = null;
  for(var i = 0; i < jxRows.length; i++){
    var x = jxRows[i];
    if(x === r || x.tracking_no !== r.tracking_no || !x.verdict || !(x._t < r._t)) continue;
    if(!best || x._t > best._t) best = x;
  }
  return best;
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

function jxReviewWord(r){
  if(!r || !r.verdict) return '';
  if(jxSentBack(r)) return 'اترجّعت للموظف';
  if(jxNeedsReview(r)) return r.reviewed_rev != null ? 'اتعدّلت بعد المراجعة' : 'مستنية مراجعة';
  return r.review_state === 'self' ? 'الأدمن اتعامل بنفسه' : 'اتراجعت';
}

export function jxCsv(rows){
  var H = ['التاريخ', 'البوليصة', 'رقم الأوردر', 'العميل', 'التليفون', 'تليفون إضافي', 'المحافظة', 'المدينة',
    'المنطقة', 'العنوان', 'المنتج', 'مبلغ التحصيل', 'النوع', 'المحاولة', 'سبب J&T', 'السبب (إنجليزي)',
    'كود السبب', 'ملاحظة المندوب', 'المندوب', 'تليفون المندوب', 'الفرع', 'تليفون الفرع', 'التصنيف',
    'عملت إيه', 'سجّل', 'وقت التسجيل', 'النتيجة', 'حالة الأوردر', 'صورة J&T',
    'المراجعة', 'راجعها', 'وقت المراجعة', 'ملاحظة المراجعة'];
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
      jxCsvCell(r.order_status ? statusLabel(r.order_status) : ''), jxCsvCell(r.photo_url),
      jxCsvCell(jxReviewWord(r)), jxCsvCell(r.reviewed_at ? r.reviewed_by_name : ''),
      jxCsvCell(r.reviewed_at ? fmtDT(r.reviewed_at) : ''), jxCsvCell(r.review_state === 'sent_back' ? r.review_note : '')
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
  jxSeeRows(rows);
  jxWatchReported(rows);
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

// الجدول مش موجود (PGRST205/42P01) — أو الفيو أقدم من الواجهة وعمود جديد ناقص (42703: الواجهة اترفعت قبل الـSQL)
function jxIsDbMissing(err){
  var s = String((err && (err.code || '')) + ' ' + (err && err.message || ''));
  return /PGRST205|42P01|42703|v_jt_issues|jt_issues/.test(s) && /PGRST205|42P01|42703|does not exist|Could not find/i.test(s);
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
  Promise.all([
    sb.from('v_jt_issues').select(JX_COLS)
      .eq('tenant_id', currentTenantId)
      .gte('event_at', since)
      .order('event_at', { ascending: false })
      .limit(JX_LIMIT),
    jxKeptQuery(JX_COLS, since)
  ]).then(function(res){
      var r = res[0], k = res[1];
      if(my !== jxGen) return;   // طلب أحدث خرج بعدنا
      veilDone('exceptions');
      if(r.error){ jxShowLoadError(r.error); return; }
      jxDbMissing = false;
      jxSetRows(jxWithKept(r.data || [], k));
      jxLoadedAt = Date.now();
      jxLogCache = {};
      jxRenderAll();
      jxEnsureRealtime();
    }, function(e){
      if(my !== jxGen) return;
      veilDone('exceptions');
      jxShowLoadError(e);
    });
}

// اللي محتاج مراجعة أو مترجّع للموظف ومن قبل نافذة الـ30 يوم — طابور مايختفيش لمجرد إن الاستثناء قدم.
// بيرجع دايماً (فشله = مفيش زيادة، مش فشل التحميل كله)
function jxKeptQuery(cols, since){
  return sb.from('v_jt_issues').select(cols)
    .eq('tenant_id', currentTenantId)
    .lt('event_at', since)
    .eq('keep_loaded', true)
    .limit(500)
    .then(function(r){ return r; }, function(e){ swallow('exceptions/kept', e); return { data: null, error: e }; });
}
function jxWithKept(rows, k){
  if(!k || k.error || !k.data || !k.data.length) return rows;
  var seen = {}, out = rows.slice();
  for(var i = 0; i < rows.length; i++) seen[rows[i].id] = 1;
  for(var j = 0; j < k.data.length; j++) if(!seen[k.data[j].id]) out.push(k.data[j]);
  return out;
}

function jxShowLoadError(err){
  swallow('exceptions/load', err);
  var list = $id('jx-list');
  if(jxIsDbMissing(err)){
    jxDbMissing = true;
    // 🔴 مش «شغّل jt-issues-tab.sql» — الملف ده ممنوع يتشغّل تاني (بيرجّع الدوال القديمة ويدخّل التاريخ كله)
    if(list) list.innerHTML = emptyState({ icon: '🛠️', title: 'تحديث الداتابيز بتاع التاب ده لسه مااتطبّقش',
      sub: 'الواجهة الجديدة اترفعت قبل تحديث الداتابيز — كلّم المطوّر، وبعدين اضغط ↻ هنا.' });
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

function jxMerge(rows, noNew){
  var changed = [], now = Date.now();
  jxSeeRows(rows);
  jxWatchReported(rows);
  for(var i = 0; i < rows.length; i++){
    var n = rows[i], old = jxById[n.id];
    if(!old){
      jxPrep(n);
      jxRows.push(n);
      jxById[n.id] = n;
      changed.push(n.id);
      if(jxLoadedAt && !noNew) jxNew[n.id] = now;
    } else if(jxOlderSnapshot(n, old)){
      // نسخة أقدم وصلت متأخرة (جلب خرج قبل الحفظ/المراجعة ورجع بعدها) — مانرجّعش اللي اتأكد
    } else if(JSON.stringify(jxPlain(old)) !== JSON.stringify(jxPlain(n))){
      Object.assign(old, n);
      jxPrep(old);
      changed.push(n.id);
    }
    jxNoteSync(n.updated_at);
  }
  return changed;
}

// ── شحنة بلّغنا عنها اتسلمت دلوقتي — ده بالظبط اللي المالك عايز يعرفه لحظتها ──────────
// بيتابع كل صف متبلّغ عنه: كان «مش متسلّم» في آخر لقطة وبقى متسلّم = toast (مرة لكل بوليصة). من أي مسار بيجيب صفوف:
// الشارة (التاب ماتفتحش — الريل-تايم بيعيد استعلامها) · التحميل الكامل · المزامنة. أول لقطة = خط بداية (مفيش toast).
var jxDelivWatch = null;       // id → 'd' (متسلّم) | 'n'
var jxToasted = {};
function jxWatchReported(rows){
  if(tourActive) return;
  var first = !jxDelivWatch, hits = {}, order = [];
  if(first) jxDelivWatch = {};
  for(var i = 0; i < rows.length; i++){
    var r = rows[i];
    if(!r || r.id == null) continue;
    if(!jxIsReported(r)){ delete jxDelivWatch[r.id]; continue; }
    var d = jxOutcome(r) === 'delivered' ? 'd' : 'n';
    if(!first && jxDelivWatch[r.id] === 'n' && d === 'd' && !jxToasted[r.tracking_no] && !hits[r.tracking_no]){ hits[r.tracking_no] = r; order.push(r); }
    jxDelivWatch[r.id] = d;
  }
  if(!order.length) return;
  for(var j = 0; j < order.length; j++) jxToasted[order[j].tracking_no] = 1;
  var h = order[0], rep = jxTs(h.reported_at || h.verdict_set_at), at = jxTs(h.outcome_at);
  jxToastQ(order.length === 1
    ? '✅ شحنة بلّغنا عنها J&T اتسلمت: ' + (h.customer_name || h.tracking_no) + (rep && at > rep ? ' — بعد البلاغ بـ' + jxDur((at - rep) / 3600000) : '')
    : '✅ ' + order.length + ' شحنات بلّغنا عنها J&T اتسلمت — شوف «📣 بلاغاتنا لـJ&T»', 'ok');
}

// رسالتين ورا بعض (استثناء جديد + تسليم بلاغ في نفس الجلب) — التانية بتستنى الأولى تخلص بدل ما تمسحها
var jxToastUntil = 0;
function jxToastQ(msg, type){
  var now = Date.now(), wait = Math.max(0, jxToastUntil - now);
  jxToastUntil = now + wait + 3200;
  if(!wait){ toast(msg, type); return; }
  setTimeout(function(){ toast(msg, type); }, wait);
}

// الـrev بيزيد مع كل حفظة و`updated_at` مع كل تغيير (حفظ · مراجعة · نتيجة) — الأقل من اللي عندنا = نسخة قديمة
export function jxOlderSnapshot(n, old){
  if(n.staff_rev != null && old.staff_rev != null && Number(n.staff_rev) < Number(old.staff_rev)) return true;
  var tn = jxTs(n.updated_at), to = jxTs(old.updated_at);
  return !!(tn && to && tn < to);
}

function jxPlain(r){
  var o = {};
  for(var k in r){ if(Object.prototype.hasOwnProperty.call(r, k) && k.charAt(0) !== '_') o[k] = r[k]; }
  return o;
}

// ── صوت التنبيه: أول ما استثناء جديد ينزل (من أي صفحة في اللوحة) ────────────
// «جديد» = id أكبر من أكبر id شفناه في الجلسة دي (أول جلب = خط البداية، مابيرنّش على اللي موجود).
// المصادر التلاتة: الشارة (الصفحة لسه ماتفتحتش) · التحميل الكامل · المزامنة/الريل-تايم (jxMerge).
// الإعداد: jx_sound في notify_prefs (الأدمن للفريق كله — الغايب = شغّال) + الجهاز ده (localStorage).
var jxKnownMax = 0, jxKnownReady = false;
var jxTeamSound = true, jxPrefAt = 0;
var JX_BEEP_LAST = 'sahl_jx_beep_last';   // أكبر id رنّ عليه — بين التابات (المحادثات تاب لوحدها)

export function jxSetTeamSound(on){ jxTeamSound = on !== false; jxPrefAt = Date.now(); jxRenderSoundBtn(); }
export function jxSoundEnabled(){ return jxTeamSound && deviceSoundOn(); }

function jxLoadSoundPref(){
  if(!sb || (jxPrefAt && Date.now() - jxPrefAt < 5 * 60000)) return;
  jxPrefAt = Date.now();
  try{
    sb.rpc('get_notify_prefs').then(function(r){
      if(r && !r.error && r.data){ jxTeamSound = r.data.jx_sound !== false; jxRenderSoundBtn(); }
    });
  }catch(e){ swallow('exceptions/sound-pref', e); }
}

function jxSeeRows(rows){
  if(tourActive) return;
  var mx = jxKnownMax, fresh = [];
  for(var i = 0; i < rows.length; i++){
    var id = Number(rows[i] && rows[i].id) || 0;
    if(jxKnownReady && id > jxKnownMax) fresh.push(rows[i]);
    if(id > mx) mx = id;
  }
  jxKnownMax = mx;
  jxKnownReady = true;
  if(fresh.length) jxAlertNew(fresh, mx);
}

function jxAlertNew(fresh, maxId){
  jxToastNew(fresh);
  if(!deviceSoundOn()) return;
  // إعداد الفريق ممكن الأدمن يكون غيّره من جهاز تاني والتاب دي مفتوحة من الصبح — نسأل تاني لو آخر قراية أقدم من دقيقة
  jxFreshTeamPref(function(on){ if(on && deviceSoundOn()) jxRingOnce(maxId); });
}

// نص الـtoast: السبب والعميل — ولو الصفوف جاية من استعلام الشارة الخفيف (مافيهاش النص) نجيبهم بالـid
function jxToastNew(fresh){
  var show = function(f, n){
    var what = f && f.reason_ar ? ': ' + f.reason_ar + (f.customer_name ? ' — ' + f.customer_name : '') : '';
    jxToastQ('🔔 ' + (n > 1 ? n + ' استثناءات جديدة من J&T' : 'استثناء جديد من J&T' + what), 'er');
  };
  var f = fresh[0];
  if(fresh.length > 1 || f.reason_ar || !sb || !currentTenantId){ show(f, fresh.length); return; }
  try{
    sb.from('v_jt_issues').select('id,reason_ar,customer_name').eq('tenant_id', currentTenantId).eq('id', f.id).limit(1)
      .then(function(r){ show(r && !r.error && r.data && r.data[0] ? r.data[0] : f, 1); },
            function(){ show(f, 1); });
  }catch(e){ show(f, 1); }
}

function jxFreshTeamPref(cb){
  if(!sb || (jxPrefAt && Date.now() - jxPrefAt < 60000)){ cb(jxTeamSound); return; }
  jxPrefAt = Date.now();
  try{
    sb.rpc('get_notify_prefs').then(function(r){
      if(r && !r.error && r.data) jxTeamSound = r.data.jx_sound !== false;
      cb(jxTeamSound);
    }, function(){ cb(jxTeamSound); });
  }catch(e){ cb(jxTeamSound); }
}

// صوت واحد بين التابات (اللوحة + المحادثات): التاب اللي قدامك الأول، بعدها أي تاب الصوت فيها جاهز.
// 🔴 التاب اللي مش هتقدر ترنّ (المتصفح لسه مانع الصوت فيها) مابتحجزش الرنّة — كانت هتسكّت التابات التانية.
function jxBeepLast(){ try{ return Number(localStorage.getItem(JX_BEEP_LAST)) || 0; }catch(e){ return 0; } }
function jxRingOnce(maxId){
  var focused = false;
  try{ focused = !document.hidden && document.hasFocus(); }catch(e){ focused = false; }
  var claim = function(){
    if(jxBeepLast() >= maxId) return;                         // تاب تانية رنّت عليه
    try{ localStorage.setItem(JX_BEEP_LAST, String(maxId)); }catch(e){ /* مفيش storage = نرنّ وخلاص */ }
    playAlert();
  };
  setTimeout(function(){
    if(jxBeepLast() >= maxId) return;
    if(audioReady()){ claim(); return; }
    unlockAudio();                                            // لو الصفحة اتلمست قبل كده الـresume بينجح
    setTimeout(function(){ if(audioReady()) claim(); }, 350);
  }, focused ? 0 : 250);
}

// ── الشارة على زرار التبويب ──────────────────────────────────────────
// البرتقاني = محتاجة تعامل (للكل) · الأزرق = مستنية مراجعتك (للأدمن بس — admin-only في الـmarkup)
export function jxSetNavBadge(n, rv){
  var b = $id('jx-nav-badge');
  if(b){
    if(n > 0){
      b.textContent = n > 99 ? '99+' : String(n);
      b.title = n + ' استثناء محتاج تعامل';
      b.style.display = 'inline-flex';
    } else {
      b.style.display = 'none';
    }
  }
  var b2 = $id('jx-nav-badge2');
  if(b2){
    if(rv > 0 && currentRole === 'admin'){
      b2.textContent = rv > 99 ? '99+' : String(rv);
      b2.title = rv + ' اتعامل معاها الموظفين ومستنية مراجعتك';
      b2.style.display = 'inline-flex';
    } else {
      b2.style.display = 'none';
    }
  }
}

function jxBadgeAll(rows, now){ jxSetNavBadge(jxCountOpen(rows, now), jxCountReview(rows)); }

// بتتنادى من loadAll (بعد الدخول ومع كل ↻) ومن الريل-تايم لما الصفحة لسه ماتحمّلتش
export function jtRefreshNavBadge(){
  if(!sb || !currentTenantId || tourActive) return;
  jxLoadSoundPref();
  if(jxLoadedAt){ jxBadgeAll(jxRows, Date.now()); jxEnsureRealtime(); return; }
  var since = new Date(Date.now() - JX_WINDOW_DAYS * DAY_MS).toISOString();
  Promise.all([
    sb.from('v_jt_issues').select(JX_BADGE_COLS)
      .eq('tenant_id', currentTenantId)
      .gte('event_at', since)
      .order('event_at', { ascending: false })
      .limit(JX_LIMIT),
    jxKeptQuery(JX_BADGE_COLS, since)
  ]).then(function(res){
      var r = res[0];
      if(jxLoadedAt) return;   // التحميل الكامل سبق — هو اللي بيحسب
      // الجدول مش موجود (الـSQL لسه ماتطبّقش) = مفيش شارة ومفيش ريل-تايم
      if(r.error){ jxSetNavBadge(0, 0); return; }
      var rows = jxWithKept(r.data || [], res[1]);
      for(var i = 0; i < rows.length; i++) jxPrep(rows[i]);
      jxSeeRows(rows);
      jxWatchReported(rows);
      jxBadgeAll(rows, Date.now());
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

// الأدمن بيراجع والماوس على القايمة: تحديث من زميل كان بيعيد الترتيب فـ«✓ تمام» تقع على كارت ماقراهوش
// (تايمر مش مقارنة أوقات: «اتحرك من أقل من ثانية» = لسه ماعدّاش 1.2ث على آخر حركة)
var jxPointerMoving = false, jxPointerIn = false, jxPointerTimer = null;
function jxPointerBusy(){
  return jxFilter.chip === 'review' && (jxPointerIn || jxPointerMoving);
}
function jxPointerMoved(){
  jxPointerMoving = true;
  clearTimeout(jxPointerTimer);
  jxPointerTimer = setTimeout(function(){ jxPointerMoving = false; }, 1200);
}

function jxAfterChange(ids, own){
  var now = Date.now();
  jxBadgeAll(jxRows, now);
  if(!jxPageVisible()) return;
  jxRenderChips(now);
  jxRenderFilterOptions(now);
  jxRenderReport(now);
  if(jxEditing() || (!own && jxPointerBusy())){
    // الموظف في إيده خانة (أو الأدمن ماسك الماوس على طابور المراجعة) — نرقّع الكروت من غير ما نحرّكهم من تحت إيده
    for(var i = 0; i < ids.length; i++) jxPatchCard(ids[i]);
    jxPendingRender = true;
    if(!own){ jxPendingFromOthers = true; jxShowNewBar(true); }
    return;
  }
  jxRenderList();
}

export function jxRenderAll(){
  var now = Date.now();
  jxShownDay = jxYmd(now);
  jxBadgeAll(jxRows, now);
  // أول تحميل: الأدمن بيفتح على «مستنية مراجعتك» لو فيها حاجة (ده اللي داخل عشانه) — مرة واحدة بس، وبعدها اختياره
  if(jxLoadedAt && !jxStageChosen){
    jxStageChosen = true;
    if(jxIsAdmin() && jxFilter.chip === 'open' && jxCountReview(jxRows) > 0) jxFilter.chip = 'review';
  }
  jxApplyStage();
  jxRenderChips(now);
  jxRenderFilterOptions(now);
  jxRenderList();
  jxRenderReport(now);
}

// «25%» جوّه جملة عربي بيتقلب «%25» — العزل (LRI…PDI) بيثبّت الرقم والعلامة مع بعض
export function jxPct(n, d){ return d ? '⁦' + Math.round(n * 100 / d) + '%⁩' : '—'; }

function jxIsAdmin(){ return currentRole === 'admin'; }

// المرحلة على الصفحة نفسها — الـCSS بيخبّي الفلاتر اللي مالهاش لازمة فيها (data-stage)
function jxApplyStage(){
  var page = $id('page-exceptions');
  if(page) page.setAttribute('data-stage', jxFilter.chip);
  // الفترة ليها قيمة في «بلاغاتنا» وقيمة في «الكل»
  var fd = $id('jx-fdays');
  if(fd && document.activeElement !== fd) fd.value = String(jxFilter.chip === 'reports' ? jxRepDays(jxFilter) : jxFilter.days);
}

// عدّادات المراحل — نفس الدوال اللي بتفلتر الطوابير (مصدر واحد: رقم الشريحة = الكروت اللي تحتها)
export function jxStageCounts(rows, now, f){
  f = f || jxFilter;
  var lv = jxLatestVerdictAt(rows), openBills = jxDoneBills(rows, lv, now), from = jxPeriodFrom(f.days, now);
  var c = { open: 0, review: 0, done: 0, done_jt: 0, all: 0, reports: 0, reports_new: 0 };
  for(var i = 0; i < rows.length; i++){
    var r = rows[i], st = jxStage(r, lv, now);
    if(st === 'open') c.open++;
    else if(st === 'review') c.review++;
    if(jxInDone(r, lv, openBills, now)){ c.done++; if(jxOutcome(r) === null) c.done_jt++; }
    if(r._ymd >= from) c.all++;
  }
  // بلاغاتنا: نفس قايمة المرحلة بفترتها (من غير النتيجة/النوع/البحث) — والـ🆕 = اتسلمت بعد آخر مرة اتفتحت
  var rl = jxReportFilter(jxReportedShipments(rows), { repDays: jxRepDays(f), q: '', out: '', rep: '' }, now);
  var seen = f.seenSet || jxRepSeenLoad(jxReportedShipments(rows), now);
  c.reports = rl.length;
  for(var k = 0; k < rl.length; k++) if(jxRepIsNew(rl[k], seen)) c.reports_new++;
  return c;
}

// مين سجّل النهارده (توقيت القاهرة) — «النهارده: shekoz 2 · ebrahim 1»
export function jxTodayBy(rows, now){
  var today = jxYmd(now), by = {};
  for(var i = 0; i < rows.length; i++){
    var r = rows[i];
    if(r.staff_updated_at && (r.verdict || r.staff_note) && jxYmd(r.staff_updated_at) === today){
      var nm = r.verdict_by_name || 'موظف';
      by[nm] = (by[nm] || 0) + 1;
    }
  }
  return Object.keys(by).sort(function(a, b){ return by[b] - by[a] || a.localeCompare(b); })
    .map(function(k){ return k + ' ' + by[k]; }).join(' · ');
}

function jxRenderChips(now){
  var c = jxStageCounts(jxRows, now);
  var chips = document.querySelectorAll('#jx-chips .jx-chip');
  for(var j = 0; j < chips.length; j++){
    var k = chips[j].getAttribute('data-jx-chip');
    chips[j].classList.toggle('on', k === jxFilter.chip);
    var n = chips[j].querySelector('.n');
    if(n) n.textContent = String(c[k] || 0);
    if(k === 'done') chips[j].title = c.done_jt + ' لسه مع J&T من ' + c.done + ' اتعاملنا معاها واتراجعت';
    if(k === 'reports'){
      var nn = chips[j].querySelector('.jx-nn');
      // جوّه المرحلة نفسها مفيش «جديد» على الشريحة — الكروت نفسها عليها 🆕
      var nw = jxFilter.chip === 'reports' ? 0 : c.reports_new;
      if(nn){ nn.textContent = nw ? '🆕 ' + nw : ''; nn.hidden = !nw; }
      chips[j].title = 'الشحنات اللي صنّفناها FAKE UPDATE أو «غلطة من J&T» — اتسلمت بعد البلاغ ولا لأ'
        + (nw ? ' · ' + nw + ' اتسلمت من آخر مرة فتحتها' : '');
    }
  }
  // الموظف مش هو اللي بيراجع — نفس الشريحة بكلام تاني
  var lbl = document.querySelector('#jx-chips [data-jx-chip="review"] .jx-rv-lbl');
  if(lbl) lbl.textContent = jxIsAdmin() ? '👀 مستنية مراجعتك' : '⏳ مستنية مراجعة الأدمن';
}

function jxSelOptions(sel, html){
  if(!sel || document.activeElement === sel) return;   // القايمة مفتوحة في إيد الموظف — إعادة بنائها بتقفلها
  sel.innerHTML = html;
}

// قوايم «الكل» (السبب · مين اتعامل) — بتتعدّ على الفترة
function jxRenderFilterOptions(now){
  var from = jxPeriodFrom(jxFilter.days, now), cnt = {}, who = {}, none = 0;
  for(var i = 0; i < jxRows.length; i++){
    var r = jxRows[i];
    if(!(r._ymd >= from)) continue;
    var k = r.reason_ar || '';
    if(k) cnt[k] = (cnt[k] || 0) + 1;
    if(r.staff_updated_at && (r.verdict || r.staff_note)){ var w = r.verdict_by_name || 'موظف'; who[w] = (who[w] || 0) + 1; }
    else none++;
  }
  var keys = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a] || a.localeCompare(b); });
  if(jxFilter.reason && !cnt[jxFilter.reason]){ keys.push(jxFilter.reason); cnt[jxFilter.reason] = 0; }
  var html = '<option value="">كل الأسباب</option>';
  for(var j = 0; j < keys.length; j++){
    html += '<option value="' + esc(keys[j]) + '"' + (keys[j] === jxFilter.reason ? ' selected' : '') + '>'
      + esc(keys[j]) + ' (' + cnt[keys[j]] + ')</option>';
  }
  jxSelOptions($id('jx-freason'), html);
  var wk = Object.keys(who).sort(function(a, b){ return who[b] - who[a] || a.localeCompare(b); });
  if(jxFilter.who && jxFilter.who !== '__none' && !who[jxFilter.who]){ wk.push(jxFilter.who); who[jxFilter.who] = 0; }
  var wh = '<option value="">أي حد اتعامل</option><option value="__none"' + (jxFilter.who === '__none' ? ' selected' : '') + '>محدش اتعامل معاها (' + none + ')</option>';
  for(var m = 0; m < wk.length; m++){
    wh += '<option value="' + esc(wk[m]) + '"' + (wk[m] === jxFilter.who ? ' selected' : '') + '>✍️ ' + esc(wk[m]) + ' (' + who[wk[m]] + ')</option>';
  }
  jxSelOptions($id('jx-fwho'), wh);
}

var JX_EMPTY_EMP = {
  review: { icon: '✓', title: 'مفيش حاجة مستنية مراجعة الأدمن', sub: 'اللي تتعاملوا معاه بيظهر هنا لحد ما الأدمن يراجعه.' },
  done:   { icon: '📭', title: 'لسه مفيش استثناءات اتراجعت', sub: 'بعد ما الأدمن يراجع، الشحنة بتنزل هنا عشان تتابع اتسلمت ولا رجعت.' }
};
var JX_EMPTY = {
  open:   { icon: '🎉', title: 'مفيش حاجة محتاجة تعامل', sub: 'أي استثناء جديد من J&amp;T هينزل هنا لوحده — والشارة على زرار التبويب هتنوّر.' },
  review: { icon: '✓', title: 'مفيش حاجة مستنية مراجعة', sub: 'أول ما موظف يختار «الحقيقة إيه؟» على استثناء، هيظهر هنا عشان تراجعه.' },
  done:   { icon: '📭', title: 'لسه مفيش استثناءات اتعاملنا معاها واتراجعت', sub: 'بعد ما تراجع شغل الموظفين بـ«✓ تمام»، الشحنة بتنزل هنا عشان تتابع اتسلمت ولا رجعت.' }
};

function jxRenderList(force){
  var list = $id('jx-list'); if(!list) return;
  if(!force && jxEditing()){ jxPendingRender = true; return; }
  jxPendingRender = false; jxPendingFromOthers = false;
  jxShowNewBar(false);
  var now = Date.now();
  if(jxFilter.chip === 'reports'){ jxRenderReports(list, now); return; }
  var rows = jxFilterRows(jxRows, jxFilter, now);
  var lv = jxLatestVerdictAt(jxRows);
  if(!jxRows.length){
    list.innerHTML = emptyState({ icon: '✅', title: 'مفيش استثناءات J&amp;T في آخر ' + JX_WINDOW_DAYS + ' يوم',
      sub: 'التاب بيتابع من 8 أكتوبر — أول ما J&amp;T تسجّل مشكلة على أي شحنة هتنزل هنا لوحدها.' });
  } else if(!rows.length){
    var e = jxIsAdmin() ? JX_EMPTY[jxFilter.chip] : (JX_EMPTY_EMP[jxFilter.chip] || JX_EMPTY[jxFilter.chip]);
    list.innerHTML = e && !jxFilter.q && !(jxFilter.chip === 'done' && jxFilter.out)
      ? emptyState(e)
      : emptyState({ icon: '📭', title: 'مفيش استثناءات بالفلتر ده' });
  } else {
    var shown = rows.slice(0, JX_RENDER_MAX), html = '';
    for(var i = 0; i < shown.length; i++) html += jxCardHtml(shown[i], lv, now);
    if(rows.length > shown.length){
      html += '<div class="jx-more">بيعرض أول ' + shown.length + ' من ' + rows.length + ' — '
        + (jxFilter.chip === 'all' || jxFilter.chip === 'done' ? 'ضيّق الفلتر، أو صدّرهم كلهم بزرار «تصدير».' : 'ضيّق بالبحث.') + '</div>';
    }
    list.innerHTML = html;
    // السجل اللي كان مفتوح يفضل مفتوح بعد الرسم
    for(var j = 0; j < shown.length; j++) if(jxLogOpen[shown[j].id]) jxRenderLog(shown[j].id);
  }
  jxRenderHint(rows.length, now);
}

// ── مرحلة «📣 بلاغاتنا لـJ&T» ─────────────────────────────────────────
function jxRepResult(s, now){
  if(s.bucket === 'after'){
    return '✅ اتسلمت بعد البلاغ' + (s.hours != null ? ' بـ' + jxDur(s.hours) : '')
      + (s.outAt ? ' <span class="jx-sep">·</span> ' + jxAtHtml(new Date(s.outAt).toISOString(), now) : ' <span class="jx-muted">(من حالة الأوردر)</span>');
  }
  if(s.bucket === 'before') return '✅ اتسلمت قبل ما نبلّغ' + (s.outAt ? ' <span class="jx-sep">·</span> ' + jxAtHtml(new Date(s.outAt).toISOString(), now) : '');
  if(s.bucket === 'returned') return (s.out === 'returned' ? '📦 رجعت لينا رغم البلاغ' : '↩️ راجعة رغم البلاغ')
    + (s.outAt ? ' <span class="jx-sep">·</span> ' + jxAtHtml(new Date(s.outAt).toISOString(), now) : '');
  if(s.bucket === 'ret_cust') return '↩️ ' + (s.out === 'returned' ? 'رجعت' : 'راجعة') + ' — والفريق أكّد إن السبب من العميل بعد البلاغ'
    + (s.lastPost ? ' (' + esc(jxVerdictLabel(s.lastPost.verdict)) + ')' : '');
  if(s.bucket === 'ret_before') return '↩️ كانت بدأت ترجع قبل ما نبلّغ'
    + (s.retStart ? ' <span class="jx-sep">·</span> ' + jxAtHtml(new Date(s.retStart).toISOString(), now) : '');
  if(s.bucket === 'cancelled') return 'اتلغت عندنا';
  return '⏳ لسه مع J&amp;T — بقالها ' + esc(jxDur((now - s.firstAt) / 3600000)) + ' من البلاغ';
}

function jxRepRepeatsHtml(s, now){
  var h = '';
  if(s.repeats.length){
    var x = s.repeats[s.repeats.length - 1];
    h += '<div class="jx-rep-rpt">🔁 J&amp;T سجّلت استثناء تاني بعد البلاغ'
      + (s.repeats.length > 1 ? ' (' + s.repeats.length + ' مرات)' : '') + ': <b>' + esc(x.reason_ar || x.reason_en || 'استثناء') + '</b> · '
      + jxAtHtml(x.event_at, now) + (x.courier_name ? ' · 🛵 ' + esc(x.courier_name) : '')
      + (x.verdict ? '' : ' <span class="jx-muted">— لسه محدش صنّفها</span>') + '</div>';
  }
  // محاولة بعد البلاغ الفريق أكّد إن سببها من العميل — مش محسوبة على J&T
  for(var i = 0; i < s.custLater.length; i++){
    var c = s.custLater[i];
    h += '<div class="jx-rep-line jx-muted">📝 بعد البلاغ: المحاولة ' + (Number(c.attempt) || '') + ' اتصنّفت ' + jxVerdictPill(c.verdict)
      + ' · ' + jxAtHtml(c.event_at, now) + ' — مش محسوبة على J&amp;T</div>';
  }
  return h;
}

function jxRepItemHtml(s, now, isNew){
  var r = s.latest, f = s.first || r;
  var cod = r.jt_cod_amount != null ? r.jt_cod_amount : r.total_cost;
  var vs = Object.keys(s.verdicts).map(jxVerdictPill).join(' ');
  return '<article class="jx-rep b-' + s.bucket + (isNew ? ' is-new' : '') + '" data-id="' + esc(String(r.id)) + '">'
    + '<div class="jx-rep-top"><span class="jx-rep-res">' + jxRepResult(s, now) + '</span>'
    + (isNew ? '<span class="jx-newtag">🆕 جديد</span>' : '') + vs + '</div>'
    + '<div class="jx-rep-line">📣 <b>' + esc(f.verdict_set_by_name || f.verdict_by_name || 'موظف') + '</b> بلّغ '
    + jxAtHtml(new Date(s.firstAt).toISOString(), now)
    + (f.staff_note ? ' — <span class="jx-rep-note" title="' + esc(f.staff_note) + '">«' + esc(f.staff_note) + '»</span>' : '') + '</div>'
    + '<div class="jx-rep-line jx-muted">J&amp;T قالت: <b>' + esc(f.reason_ar || f.reason_en || 'استثناء') + '</b>'
    + (f.kind === 'return' ? '' : ' (المحاولة ' + (Number(f.attempt) || 1) + ')')
    + (f.courier_name ? ' · 🛵 ' + esc(f.courier_name) : '') + (f.branch ? ' · 🏢 ' + esc(f.branch) : '') + '</div>'
    + jxRepRepeatsHtml(s, now)
    + '<div class="jx-rep-line">👤 <b>' + esc(r.customer_name || '—') + '</b>'
    + (r.order_uid && r.order_id ? ' <button type="button" class="jx-link" data-jx="detail" title="افتح تفاصيل الأوردر">#' + esc(r.order_uid) + '</button>' : '')
    + ' <span class="jx-sep">·</span> <span class="jx-mono" dir="ltr">' + esc(s.bill) + '</span>' + jxCopyBtn(s.bill, 'رقم البوليصة')
    + (cod != null ? ' <span class="jx-sep">·</span> <b class="jx-cod">' + money(cod) + '</b>' : '') + '</div>'
    + '</article>';
}

function jxRepSummaryHtml(t, now){
  var rate = t.closed ? jxPct(t.after, t.closed) : '—';
  var v = function(k){ var e = t.byV[k]; return e ? e.n : 0; };
  return '<div class="jx-repsum">'
    + '<div class="jx-rs-cards">'
    + '<div class="jx-rs b-n"><b>' + t.n + '</b><span>شحنة بلّغنا عنها</span><small><bdi>FAKE UPDATE</bdi> ' + v('fake_update') + ' · غلطة <bdi>J&amp;T</bdi> ' + v('jt_error') + '</small></div>'
    + '<div class="jx-rs b-after"><b>' + t.after + '</b><span>اتسلمت بعد البلاغ</span><small>' + (t.medianHours != null ? 'في المتوسط بعد ' + esc(jxDur(t.medianHours)) : '—') + '</small></div>'
    + '<div class="jx-rs b-returned"><b>' + t.returned + '</b><span>رجعت رغم البلاغ</span><small>' + (t.cancelled ? t.cancelled + ' اتلغت عندنا' : '&nbsp;') + '</small></div>'
    + '<div class="jx-rs b-pending"><b>' + t.pending + '</b><span>لسه مع J&amp;T</span><small>' + (t.oldestPending ? 'أقدمها من ' + esc(jxDur((now - t.oldestPending) / 3600000)) : '&nbsp;') + '</small></div>'
    + '<div class="jx-rs b-rate"><b>' + rate + '</b><span>اتحلّت</span><small>' + (t.closed ? t.after + ' من ' + t.closed + ' اتقفلت' : 'لسه مفيش حاجة اتقفلت') + '</small></div>'
    + '</div>'
    + '<div class="jx-rs-foot">'
    + (t.repeated ? '<span class="jx-rs-warn">🔁 ' + t.repeated + ' شحنة J&amp;T سجّلت عليها استثناء تاني بعد البلاغ</span>' : '<span class="jx-muted">مفيش شحنة اتكرر عليها استثناء بعد البلاغ</span>')
    + (t.ret_cust ? ' <span class="jx-sep">·</span> <span class="jx-muted">' + t.ret_cust + ' رجعت والسبب من العميل (مش محسوبة)</span>' : '')
    + (t.ret_before ? ' <span class="jx-sep">·</span> <span class="jx-muted">' + t.ret_before + ' كانت بدأت ترجع قبل البلاغ (مش محسوبة)</span>' : '')
    + (t.before ? ' <span class="jx-sep">·</span> <span class="jx-muted">' + t.before + ' اتسلمت قبل ما نبلّغ (مش محسوبة)</span>' : '')
    + '<button type="button" class="jx-btn" id="jx-rep-copy" title="ملخص نصي تبعته لمسؤول حسابك في J&amp;T">📋 نسخ الملخص لـJ&amp;T</button>'
    + '</div></div>';
}

function jxRenderReports(list, now){
  var all = jxReportedShipments(jxRows);
  var period = jxReportFilter(all, { repDays: jxRepDays(jxFilter), q: '', out: '', rep: jxFilter.rep }, now);
  var shown = jxReportFilter(all, jxFilter, now);
  var html = '';
  if(!all.length){
    html = emptyState({ icon: '📣', title: 'لسه مفيش شحنات اتصنّفت FAKE UPDATE أو «غلطة من J&amp;T»',
      sub: 'أول ما الفريق يصنّف استثناء كده، الشحنة هتنزل هنا ونتابع J&amp;T حلّت المشكلة ولا لأ.' });
  } else {
    html = jxRepSummaryHtml(jxReportTotals(period), now);
    if(!shown.length) html += emptyState({ icon: '📭', title: 'مفيش بلاغات بالفلتر ده' });
    var cur = '', cnt = 0;
    for(var i = 0; i < shown.length && cnt < JX_RENDER_MAX; i++, cnt++){
      var s = shown[i];
      if(s.bucket !== cur){
        cur = s.bucket;
        var gn = shown.filter(function(x){ return x.bucket === cur; }).length;
        html += '<div class="jx-rep-group g-' + cur + '">' + esc(JX_REP_GROUP[cur]) + ' <span class="n">' + gn + '</span></div>';
      }
      html += jxRepItemHtml(s, now, jxRepMarkSeen(s, now, all));
    }
    if(jxRepSeenDirty){ jxRepSeenDirty = false; jxRepSeenSave(); }
    if(shown.length > cnt) html += '<div class="jx-more">بيعرض أول ' + cnt + ' من ' + shown.length + ' — ضيّق الفلتر، أو صدّرهم كلهم بزرار «تصدير».</div>';
  }
  list.innerHTML = html;
  jxRenderHint(shown.length, now);
}

// «🆕»: اتسلمت بعد البلاغ ولسه ماظهرتش قدامك — بتتعلّم «اتشافت» بس والصفحة قدامك فعلاً (مش رسم في الخلفية)،
// والعلامة بتفضل على الكارت طول ما انت في المرحلة (jxRepFresh) وبتتمسح لما تخرج
var jxRepSeenDirty = false;
function jxRepMarkSeen(s, now, all){
  if(s.bucket !== 'after') return false;
  var seen = jxRepSeenLoad(all, now);
  if(!seen[s.bill]){
    jxRepFresh[s.bill] = 1;
    if(!document.hidden && jxPageVisible()){ seen[s.bill] = 1; jxRepSeenDirty = true; }
  }
  return !!jxRepFresh[s.bill];
}

function jxCopyReportsSummary(){
  var now = Date.now();
  var list = jxReportFilter(jxReportedShipments(jxRows), { repDays: jxRepDays(jxFilter), q: '', out: '', rep: jxFilter.rep }, now);
  if(!list.length){ toast('مفيش بلاغات في الفترة دي', 'er'); return; }
  copyTextToClipboard(jxReportCopyText(list, jxReportTotals(list), jxFilter, now), 'الملخص');
}

// سطر «نتيجة البلاغ» على الكارت في باقي المراحل
function jxRepStripHtml(r, now){
  if(!jxIsReported(r)) return '';
  var bill = [];
  for(var i = 0; i < jxRows.length; i++) if(jxRows[i].tracking_no === r.tracking_no) bill.push(jxRows[i]);
  var s = jxReportedShipments(bill)[0];
  if(!s) return '';
  return '<div class="jx-m-row jx-m-rep b-' + s.bucket + '">📣 نتيجة البلاغ: ' + jxRepResult(s, now)
    + (s.repeats.length ? ' <span class="jx-sep">·</span> <span class="jx-rs-warn">🔁 J&amp;T سجّلت استثناء تاني بعده</span>' : '') + '</div>';
}

function jxRenderHint(n, now){
  var h = $id('jx-hint'); if(!h) return;
  var admin = jxIsAdmin(), k = jxFilter.chip, t;
  if(k === 'open'){
    t = 'الأقدم فوق (الأقرب إنها ترجع) — واللي الأدمن رجّعها بتطلع فوق الكل. كلّم العميل، اختار «الحقيقة إيه؟» واكتب عملت إيه، والكارت بيروح «'
      + (admin ? 'مستنية مراجعتك' : 'مستنية مراجعة الأدمن') + '»' + (admin ? ' (ولو انت اللي اتعاملت، بيروح «اتراجعت» على طول).' : '.');
  } else if(k === 'review'){
    var tb = jxTodayBy(jxRows, now);
    t = (admin ? 'اللي الموظفين اتعاملوا معاه ولسه ماراجعتهوش — الأقدم فوق. «✓ تمام» لو مظبوط، «↩️ رجّعها للموظف» لو عايزه يكمّل.'
               : 'اللي اتعاملتوا معاه ومستني الأدمن يراجعه — لو عدّلت فيه بيفضل هنا بالجديد.')
      + ' · ' + (tb ? 'النهارده: ' + tb : 'لسه محدش سجّل حاجة النهارده');
  } else if(k === 'reports'){
    t = 'الشحنات اللي صنّفناها FAKE UPDATE أو «غلطة من J&T» — شحنة واحدة لكل بوليصة، والفترة بتاريخ البلاغ. «اتحلّت» = اتسلمت بعد البلاغ من اللي اتقفلت (اللي لسه مع J&T مابتدخلش الحساب لسه).'
      + (jxFilter.out || jxFilter.rep || jxFilter.q ? ' · بيعرض ' + n + ' بالفلتر' : '');
  } else if(k === 'done'){
    t = 'اتعاملنا معاها واتراجعت — آخر محاولة لكل شحنة. اللي لسه مع J&T فوق (الأقدم من ساعة التعامل)، وبعدها اللي اتسلمت أو رجعت.'
      + (jxFilter.out || jxFilter.q ? ' · بيعرض ' + n + ' بالفلتر' : '');
  } else {
    var from = jxPeriodFrom(jxFilter.days, now);
    t = n + ' — من ' + Number(from.slice(8, 10)) + '/' + Number(from.slice(5, 7)) + ' لحد النهارده (توقيت القاهرة) · الأحدث فوق';
  }
  h.textContent = t;
}

function jxShowNewBar(on){
  var b = $id('jx-newbar'); if(!b) return;
  if(on && jxPendingFromOthers){
    b.textContent = '🔔 وصل تحديث جديد — اضغط هنا تعرضه (أو هيتعرض لوحده أول ما تخلّص)';
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

// «إمتى» بالساعة + «من قد إيه» (بيتحدّث كل دقيقة من jxTickTimes)
function jxAtHtml(iso, now){
  return '<span class="jx-at" title="' + esc(fmtDT(iso)) + '">' + esc(jxWhen(iso, now)) + '</span>'
    + ' <span class="jx-ago" data-jx-at="' + esc(iso) + '">(' + esc(jxAgo(iso, now)) + ')</span>';
}

function jxVerdictPill(v){
  return '<span class="jx-vpill" data-v="' + esc(v) + '">' + esc(jxVerdictLabel(v)) + '</span>';
}

// حالة المراجعة جنب «مين اتعامل»
function jxReviewPillHtml(r, now){
  if(!r.verdict || jxSentBack(r)) return '';
  var who = esc(r.reviewed_by_name || 'الأدمن');
  if(jxNeedsReview(r)){
    if(r.reviewed_rev != null){
      return '<span class="jx-rpill rp-edit" title="' + esc(r.reviewed_at ? fmtDT(r.reviewed_at) : '') + '">✏️ اتعدّلت بعد ما ' + who
        + (r.review_state === 'sent_back' ? ' رجّعها' : ' راجعها') + '</span>'
        // طلب الأدمن يفضل ظاهر وهو بيراجع الرد عليه
        + (r.review_state === 'sent_back' && r.review_note ? ' <span class="jx-m-req">كان طالب: «' + esc(r.review_note) + '»</span>' : '');
    }
    return '<span class="jx-rpill rp-wait">' + (jxIsAdmin() ? '⏳ مستنية مراجعتك' : '⏳ لسه الأدمن ماراجعهاش') + '</span>';
  }
  if(r.review_state === 'self') return '<span class="jx-rpill rp-ok">✓ الأدمن اتعامل بنفسه</span>';
  return '<span class="jx-rpill rp-ok">✓ ' + who + ' راجعها · ' + jxAtHtml(r.reviewed_at, now) + '</span>'
    + (jxIsAdmin() && r.review_state === 'ok' ? ' <button type="button" class="jx-link jx-undo" data-jx="rv-undo" title="ترجع «مستنية مراجعتك»">↶ رجّعها لمراجعتي</button>' : '');
}

// السطر اللي تحت العنوان — جواب «مين اتعامل · إمتى · اختار إيه · كتب إيه · اتراجعت؟» في مكان واحد ظاهر
export function jxMetaHtml(r, superseded, now){
  var h = '', acted = !!(r.staff_updated_at && (r.verdict || r.staff_note));
  if(jxSentBack(r)){
    h += '<div class="jx-m-back">↩️ <b>' + esc(r.reviewed_by_name || 'الأدمن') + '</b> رجّعها · ' + jxAtHtml(r.reviewed_at, now)
      + (r.review_note ? ': «' + esc(r.review_note) + '»' : '')
      + ' <span class="jx-m-hint">— عدّل التصنيف أو اكتب عملت إيه، وهترجع للمراجعة.</span>'
      // داسها بالغلط؟ الأدمن يلغيها (بترجع «مستنية مراجعتك» زي ما كانت)
      + (jxIsAdmin() ? ' <button type="button" class="jx-link jx-undo" data-jx="rv-undo">↶ إلغاء الرجوع</button>' : '') + '</div>';
  }
  if(acted && r.verdict){
    // «مين اختار» من verdict_set_* (بيتغيّر مع التصنيف بس) — والتعديل اللي بعده (ملاحظة بس) سطر لوحده
    var setBy = r.verdict_set_by_name || r.verdict_by_name || 'موظف', setAt = r.verdict_set_at || r.staff_updated_at;
    var later = r.verdict_set_at && jxTs(r.staff_updated_at) - jxTs(r.verdict_set_at) > 1000;
    h += '<div class="jx-m-row">✍️ <b class="jx-by">' + esc(setBy) + '</b> اختار ' + jxVerdictPill(r.verdict)
      + ' <span class="jx-sep">·</span> ' + jxAtHtml(setAt, now) + ' ' + jxReviewPillHtml(r, now) + '</div>';
    if(later){
      h += '<div class="jx-m-row jx-m-edit">✏️ <b>' + esc(r.verdict_by_name || 'موظف') + '</b> عدّل الملاحظة بعدها <span class="jx-sep">·</span> '
        + jxAtHtml(r.staff_updated_at, now) + '</div>';
    }
    h += jxRepStripHtml(r, now);
  } else if(acted){
    var stillOpen = jxNeedsFollow(r, jxLatestVerdictAt(jxRows), now);
    h += '<div class="jx-m-row">✍️ <b class="jx-by">' + esc(r.verdict_by_name || 'موظف') + '</b> كتب ملاحظة <span class="jx-sep">·</span> '
      + jxAtHtml(r.staff_updated_at, now) + ' <span class="jx-muted">— ' + (stillOpen ? 'لسه محدش اختار «الحقيقة إيه؟»' : 'من غير تصنيف (كتب ملاحظة بس)') + '</span></div>';
  }
  // على نفس الشحنة استثناء أحدث محدش اتعامل معاه (والشحنة اتقفلت فمش في الطابور) — مايتعرضش الكارت ده كإنه آخر حاجة
  if(acted){
    var newer = jxNewerUnhandled(r);
    if(newer) h += '<div class="jx-m-row jx-m-miss">⚠️ حصل استثناء أحدث على نفس الشحنة' + (newer.attempt ? ' (المحاولة ' + Number(newer.attempt) + ')' : '')
      + ' · ' + jxAtHtml(newer.event_at, now) + ' — محدش اتعامل معاه</div>';
  }
  // الملاحظة هنا لما الخانة مش ظاهرة (المراجعة) — غير كده الخانة تحت بتعرضها ومانكررش
  if(acted && r.staff_note && jxActMode(r) !== 'edit') h += '<div class="jx-m-note" title="' + esc(r.staff_note) + '">💬 «' + esc(r.staff_note) + '»</div>';
  if(!acted){
    if(superseded){
      h += '<div class="jx-m-row jx-muted">اتصنّفت محاولة أحدث على نفس الشحنة — مش محتاجة تعامل</div>';
    } else {
      var prev = jxPrevHandled(r);
      if(prev){
        h += '<div class="jx-m-row jx-m-prev">↪ المرة اللي فاتت (المحاولة ' + (Number(prev.attempt) || 1) + '): <b>' + esc(prev.verdict_by_name || 'موظف')
          + '</b> اختار ' + jxVerdictPill(prev.verdict) + ' · ' + jxAtHtml(prev.staff_updated_at, now)
          + (prev.staff_note ? ' — «' + esc(prev.staff_note) + '»' : '') + '</div>';
      }
      var o = jxOutcome(r);
      if(!jxNeedsFollow(r, jxLatestVerdictAt(jxRows), now)){
        if(o === 'returning' || o === 'returned') h += '<div class="jx-m-row jx-m-miss">⚠️ رجعت من غير ما حد يتعامل معاها</div>';
        else if(o === 'delivered') h += '<div class="jx-m-row jx-muted">اتسلمت من غير ما حد يسجّل حاجة</div>';
      }
    }
  }
  if(r.staff_updated_at || r.reviewed_at){
    h += '<div class="jx-m-tools"><button type="button" class="jx-link jx-logbtn" data-jx="log">'
      + (jxLogOpen[r.id] ? '🕘 اقفل السجل' : '🕘 السجل — مين عمل إيه') + '</button></div>';
  }
  return h;
}

function jxNewerUnhandled(r){
  var best = null;
  for(var i = 0; i < jxRows.length; i++){
    var x = jxRows[i];
    if(x === r || x.tracking_no !== r.tracking_no || !(x._t > r._t) || jxActed(x)) continue;
    if(!best || x._t > best._t) best = x;
  }
  return best;
}

function jxWantVerdict(r){
  return jxPendingVerdict[r.id] !== undefined ? jxPendingVerdict[r.id] : (r.verdict || '');
}

// شكل عمود الإجراء: review (الأدمن · مستنية مراجعة) · done (الأدمن · اتراجعت) · edit (الخانات)
function jxActMode(r){
  if(jxHold[r.id] && jxHold[r.id] === jxFilter.chip && jxStage(r, jxLatestVerdictAt(jxRows), Date.now()) !== jxHold[r.id]) return 'held';
  if(!jxIsAdmin() || jxEditOpen[r.id] || jxPendingVerdict[r.id] !== undefined || jxDrafts[r.id] !== undefined) return 'edit';
  if(jxNeedsReview(r)) return 'review';
  if(r.verdict && !jxSentBack(r)) return 'done';
  return 'edit';
}

function jxCommonBtns(r){
  return '<button type="button" class="jx-btn jx-chat" data-jx="chat" title="افتح شات العميل في المحادثات">💬 شات</button>'
    + (r.order_id ? '<button type="button" class="jx-btn" data-jx="detail">📄 الأوردر</button>' : '');
}

function jxActHtml(r, superseded, now){
  var mode = jxActMode(r);
  if(mode === 'held'){
    var what = jxSentBack(r) ? '↩️ اترجّعت لـ' + esc(r.verdict_by_name || 'الموظف') + ' — بقت فوق «محتاجة تعامل»'
      : (r.review_state === 'ok' ? '✓ اتراجعت — نزلت «اتراجعت — تابع النتيجة»' : '↶ رجعت «مستنية مراجعتك»');
    return '<div class="jx-act-in" data-mode="held"><div class="jx-held">' + what + '</div>'
      + '<div class="jx-muted">هتختفي من هنا لما تغيّر المرحلة.</div><div class="jx-btns">' + jxCommonBtns(r) + '</div></div>';
  }
  if(mode === 'review'){
    return '<div class="jx-act-in" data-mode="review"><div class="jx-lbl">راجعت شغل <b>' + esc(r.verdict_by_name || 'الموظف') + '</b>؟</div>'
      + '<div class="jx-btns jx-rvbtns"><button type="button" class="jx-btn jx-rvok" data-jx="rv-ok">✓ تمام</button>'
      + '<button type="button" class="jx-btn jx-rvback" data-jx="rv-back">↩️ رجّعها للموظف</button></div>'
      + '<div class="jx-btns"><button type="button" class="jx-btn" data-jx="edit" title="تعدّل التصنيف أو الملاحظة بنفسك">✏️ عدّل بنفسك</button>' + jxCommonBtns(r) + '</div></div>';
  }
  if(mode === 'done'){
    return '<div class="jx-act-in" data-mode="done">'
      + '<div class="jx-btns"><button type="button" class="jx-btn jx-rvback" data-jx="rv-back">↩️ رجّعها للموظف</button>'
      + '<button type="button" class="jx-btn" data-jx="edit">✏️ عدّل بنفسك</button></div>'
      + '<div class="jx-btns">' + jxCommonBtns(r) + '</div></div>';
  }
  var v = jxWantVerdict(r);
  var draft = jxDrafts[r.id];
  var note = draft !== undefined ? draft : (r.staff_note || '');
  var dirty = draft !== undefined && String(draft).trim() !== String(r.staff_note || '').trim();
  // تصنيف محفوظ = مفيش «— اختار —» (المسح كان الطريق الوحيد اللي بيلغي مراجعة الأدمن في صمت) — التغيير لتصنيف تاني متاح
  var opts = (r.verdict && v) ? '' : '<option value="">— اختار —</option>';
  for(var i = 0; i < JX_VERDICTS.length; i++){
    var x = JX_VERDICTS[i];
    opts += '<option value="' + x.k + '"' + (x.k === v ? ' selected' : '') + ' title="' + esc(x.d) + '">' + esc(x.t) + '</option>';
  }
  return '<div class="jx-act-in" data-mode="edit"><div class="jx-field"><label class="jx-lbl">الحقيقة إيه؟</label>'
    + '<select class="jx-verdict" data-v="' + esc(v) + '">' + opts + '</select></div>'
    + '<div class="jx-field"><label class="jx-lbl">عملت إيه؟</label>'
    + '<textarea class="jx-note" rows="2" maxlength="2000" placeholder="كلّمت العميل وقال… · بلّغت J&amp;T… · اتفقنا على معاد…">' + esc(note) + '</textarea></div>'
    + '<div class="jx-btns">'
    + '<button type="button" class="jx-btn jx-save' + (dirty ? ' show' : '') + '" data-jx="save">💾 حفظ</button>'
    + jxCommonBtns(r)
    + (jxEditOpen[r.id] ? '<button type="button" class="jx-btn" data-jx="edit-close">خلّصت</button>' : '')
    + '</div></div>';
}

function jxCardCls(r, lv, now){
  var st = jxStage(r, lv, now);
  return 'jx-card' + (jxActMode(r) === 'held' ? ' is-held' : '') + (st === 'open' ? ' is-open' : '') + (r.verdict ? ' has-verdict' : '')
    + (st === 'review' ? ' is-review' : '') + (jxSentBack(r) ? ' is-back' : '')
    + (jxIsNew(r.id, Date.now()) ? ' is-new' : '') + (jxSaving[r.id] || jxReviewing[r.id] ? ' is-saving' : '');
}

function jxCardHtml(r, lv, now){
  var sup = jxSuperseded(r, lv);
  var meta = jxMetaHtml(r, sup, now);
  return '<article class="' + jxCardCls(r, lv, now) + '" data-id="' + esc(String(r.id)) + '">'
    + '<div class="jx-head">' + jxHeadHtml(r, now) + '</div>'
    + '<div class="jx-meta"' + (meta ? '' : ' hidden') + '>' + meta + '</div>'
    + '<div class="jx-body">'
    + '<div class="jx-info">' + jxInfoHtml(r, now) + '</div>'
    + '<div class="jx-act">' + jxActHtml(r, sup, now) + '</div>'
    + '</div>'
    + (jxLogOpen[r.id] ? '<div class="jx-log"></div>' : '')
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
  // شكل عمود الإجراء اتغيّر (اتراجعت · اترجّعت · اتصنّفت) ومفيش خانة في الإيد جوّاه = نبنيه تاني
  var act = el.querySelector('.jx-act'), inner = act && act.querySelector('.jx-act-in');
  var a = document.activeElement;
  if(act && inner && inner.getAttribute('data-mode') !== jxActMode(r) && !(a && act.contains(a))){
    act.innerHTML = jxActHtml(r, sup, now);
  }
  jxSyncActionUi(el, r, sup, now);
  el.className = jxCardCls(r, lv, now);
  if(jxLogOpen[id]) jxRenderLog(id);
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
  var meta = el.querySelector('.jx-meta');
  if(meta){
    var mh = jxMetaHtml(r, sup, now || Date.now());
    meta.innerHTML = mh;
    if(mh) meta.removeAttribute('hidden'); else meta.setAttribute('hidden', '');
  }
}

function jxTickTimes(){
  var now = Date.now();
  // عدّى نص الليل والصفحة مفتوحة: «النهارده/إمبارح» والفترات اتغيّروا — رسم كامل (بيستنى لو في الإيد خانة)
  var day = jxYmd(now);
  if(jxShownDay && day !== jxShownDay){ jxShownDay = day; jxRenderAll(); return; }
  jxShownDay = day;
  var cards = document.querySelectorAll('#jx-list .jx-card');
  for(var i = 0; i < cards.length; i++){
    var r = jxById[cards[i].getAttribute('data-id')];
    var w = cards[i].querySelector('.jx-when');
    if(r && w) w.textContent = jxAgo(r.event_at, now);
  }
  var ag = document.querySelectorAll('#jx-list [data-jx-at]');
  for(var j = 0; j < ag.length; j++) ag[j].textContent = '(' + jxAgo(ag[j].getAttribute('data-jx-at'), now) + ')';
}

// ── السجل: «مين عمل إيه» على الاستثناء (jt_issue_log) + مسحات J&T في أوله وآخره ─────────
export function jxLogLines(r, rows, now){
  var L = [];
  L.push({ at: r.event_at, h: r.kind === 'return'
    ? '↩️ J&amp;T بدأت ترجّع الشحنة من غير ما تسجّل سبب'
    : '⚠️ J&amp;T سجّلت «' + esc(r.reason_ar || r.reason_en || 'استثناء') + '»' + (r.courier_name ? ' — المندوب ' + esc(r.courier_name) : '') });
  for(var i = 0; i < rows.length; i++){
    var x = rows[i], by = '<b>' + esc(x.by_name || 'موظف') + '</b>' + (x.actor_role === 'admin' ? ' <span class="jx-muted">(أدمن)</span>' : '');
    var h = '';
    if(x.action === 'save'){
      var parts = [];
      if(x.verdict_changed || (x.prev_verdict == null && x.verdict && !x.note_changed)){
        if(!x.verdict) parts.push('شال التصنيف');
        else if(x.prev_verdict) parts.push('غيّر التصنيف من ' + jxVerdictPill(x.prev_verdict) + ' لـ' + jxVerdictPill(x.verdict));
        else parts.push('اختار ' + jxVerdictPill(x.verdict));
      }
      if(x.note_changed){
        if(!x.note) parts.push('مسح الملاحظة');
        else parts.push((x.prev_note ? 'عدّل الملاحظة: ' : 'كتب: ') + '«' + esc(x.note) + '»');
      }
      if(!parts.length) parts.push(x.verdict ? 'اختار ' + jxVerdictPill(x.verdict) : 'سجّل');
      h = '✍️ ' + by + ' ' + parts.join(' · ');
    } else if(x.action === 'review'){
      h = x.review_state === 'sent_back'
        ? '↩️ ' + by + ' رجّعها للموظف' + (x.review_note ? ': «' + esc(x.review_note) + '»' : '')
        : '✓ ' + by + ' راجعها وقال تمام';
    } else if(x.action === 'unreview'){
      h = '↶ ' + by + ' رجّعها لمراجعته';
    } else continue;
    L.push({ at: x.at, h: h });
  }
  var o = jxOutcome(r);
  if(r.outcome && r.outcome_at){
    L.push({ at: r.outcome_at, h: o === 'delivered' ? '✅ J&amp;T سلّمتها للعميل' : (o === 'returned' ? '📦 رجعت لينا' : '↩️ J&amp;T بدأت ترجّعها') });
  } else if(o === 'cancelled'){
    L.push({ at: null, h: 'الأوردر اتلغى عندنا' });
  }
  // بالترتيب الزمني (التسليم ممكن يبقى قبل آخر تعديل) — اللي مالوش وقت في الآخر · الثابت بيحافظ على ترتيب نفس اللحظة
  return L.map(function(x, i){ return { x: x, i: i, t: x.at ? jxTs(x.at) : Infinity }; })
    .sort(function(a, b){ return a.t - b.t || a.i - b.i; }).map(function(y){ return y.x; });
}

function jxRenderLog(id){
  var el = jxCardEl(id), r = jxById[id];
  if(!el || !r) return;
  var box = el.querySelector('.jx-log');
  if(!box){ box = document.createElement('div'); box.className = 'jx-log'; el.appendChild(box); }
  var c = jxLogCache[id];
  if(c && c.err){ box.innerHTML = '<div class="jx-muted">' + esc(c.err) + '</div>'; return; }
  if(!c || c.key !== String(r.updated_at || '')){
    if(!c || !c.loading){
      box.innerHTML = '<div class="jx-muted">بيحمّل السجل…</div>';
      jxFetchLog(id);
    }
    if(!c || !c.rows) return;
  }
  var now = Date.now(), L = jxLogLines(r, c.rows || [], now), h = '<div class="jx-log-t">🕘 اللي حصل على الاستثناء ده</div><ol class="jx-tl">';
  for(var i = 0; i < L.length; i++){
    h += '<li><span class="jx-tl-at">' + (L[i].at ? esc(jxWhen(L[i].at, now)) : '') + '</span><span class="jx-tl-h">' + L[i].h + '</span></li>';
  }
  box.innerHTML = h + '</ol>';
}

function jxFetchLog(id){
  var r = jxById[id];
  if(!r || !sb || !currentTenantId) return;
  var key = String(r.updated_at || '');
  var prev = jxLogCache[id];
  jxLogCache[id] = { key: prev ? prev.key : '', rows: prev ? prev.rows : null, loading: true };
  // الأحدث 100 (لو السجل طويل اللي يتشال هو الأقدم) — وبعدين بالترتيب الزمني
  sb.from('jt_issue_log').select(JX_LOG_COLS)
    .eq('tenant_id', currentTenantId)
    .eq('issue_id', Number(id))
    .order('at', { ascending: false })
    .limit(100)
    .then(function(res){
      if(res.error){
        // الخطأ مابيتحفظش تحت المفتاح — فتح السجل تاني بيجرّب من الأول فعلاً
        jxLogCache[id] = { key: '', rows: null, err: jxIsDbMissing(res.error) ? 'السجل محتاج تحديث الداتابيز' : 'مقدرناش نجيب السجل — اقفله وافتحه تاني' };
      } else {
        jxLogCache[id] = { key: key, rows: (res.data || []).slice().reverse() };
      }
      if(jxLogOpen[id]) jxRenderLog(id);
    }, function(e){
      swallow('exceptions/log', e);
      jxLogCache[id] = { key: '', rows: null, err: 'مقدرناش نجيب السجل — اقفله وافتحه تاني' };
      if(jxLogOpen[id]) jxRenderLog(id);
    });
}

function jxToggleLog(id){
  jxLogOpen[id] = !jxLogOpen[id];
  if(jxLogOpen[id] && jxLogCache[id] && jxLogCache[id].err) delete jxLogCache[id];   // «اقفله وافتحه تاني» = محاولة جديدة
  var el = jxCardEl(id);
  if(!el) return;
  var btn = el.querySelector('.jx-logbtn');
  if(btn) btn.textContent = jxLogOpen[id] ? '🕘 اقفل السجل' : '🕘 السجل — مين عمل إيه';
  if(jxLogOpen[id]) jxRenderLog(id);
  else { var box = el.querySelector('.jx-log'); if(box) box.remove(); }
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
  // مقفول (أو مش في «الكل») = مانرسمش — بيترسم أول ما يتفتح (حدث toggle في initExceptions)
  var det = $id('jx-report-box');
  if(det && !det.open) return;
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
  // بلاغاتنا: صف لكل شحنة بأعمدة البلاغ (وقت البلاغ · النتيجة · بعد قد إيه · اتكرر)
  var csv = jxFilter.chip === 'reports'
    ? jxReportCsv(jxReportFilter(jxReportedShipments(jxRows), jxFilter, now))
    : jxCsv(rows);
  var name = 'jt-exceptions-' + (jxFilter.chip === 'all' ? (jxPeriodFrom(jxFilter.days, now) + '_' + jxYmd(now))
    : (jxFilter.chip === 'reports' ? 'reports-' + jxPeriodFrom(jxRepDays(jxFilter), now) + '_' + jxYmd(now) : jxFilter.chip)) + '.csv';
  try{
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
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
// رد السيرفر (jt_issue_save / jt_issue_review) على الصف — المفاتيح الموجودة بس، والـnull مقصود (مراجعة اتشالت)
var JX_SERVER_KEYS = ['verdict', 'staff_note', 'staff_updated_at', 'verdict_by', 'verdict_by_name', 'verdict_set_by_name',
  'verdict_set_at', 'reported_at', 'staff_rev', 'reviewed_rev', 'review_state', 'review_note', 'reviewed_at', 'reviewed_by_name', 'updated_at'];
function jxApplyServer(r, d){
  for(var i = 0; i < JX_SERVER_KEYS.length; i++){
    var k = JX_SERVER_KEYS[i];
    if(Object.prototype.hasOwnProperty.call(d, k)) r[k] = d[k] === undefined ? null : d[k];
  }
}

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
  // المسودة = كلام مختلف عن المحفوظ بس — نسخة من المحفوظ كانت بتفضل «مسودة» بعد حفظة فشلت، فتكتب فوق ملاحظة زميل بعدين
  if(ta){
    if(String(ta.value).trim() !== String(r.staff_note || '').trim()) jxDrafts[id] = ta.value;
    else delete jxDrafts[id];
  }
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
    if(jxDrafts[id] !== undefined && String(jxDrafts[id]).trim() === String(r.staff_note || '').trim()) delete jxDrafts[id];
    // شكل عمود الإجراء اتحسب على المسودة — يتحسب تاني (لو مفيش خانة في الإيد جوّاه)
    var act3 = c3 && c3.querySelector('.jx-act'), a3 = document.activeElement;
    if(act3 && !(a3 && act3.contains(a3))) jxRebuildAct(id);
    // الاختيار يرجع للمحفوظ — والكلام فاضل في الخانة (مسودة) ماضاعش
    jxSyncActionUi(c3, r, jxSuperseded(r, jxLatestVerdictAt(jxRows)), Date.now());
  };
  sb.rpc('jt_issue_save', { p_id: Number(id), p_verdict: verdict || null, p_note: noteT || null }).then(function(res){
    if(res.error || !res.data){ fail(res.error); return; }
    jxSaving[id] = false;
    var c2 = jxCardEl(id);
    if(c2) c2.classList.remove('is-saving');
    var d = res.data;
    jxApplyServer(r, d);
    delete jxLogCache[id];
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

// ── المراجعة (الأدمن بس — والسيرفر بيرفض غيره) ─────────────────────────────
function jxReviewErr(e){
  var m = String((e && (e.message || e.code)) || '');
  if(/not_allowed|42501/.test(m)) return 'المراجعة للأدمن بس';
  if(/note_required/.test(m)) return 'اكتب للموظف المطلوب إيه قبل ما ترجّعها';
  if(/not_handled/.test(m)) return 'لسه محدش اختار «الحقيقة إيه؟» على الاستثناء ده';
  if(/not_found|P0002/.test(m)) return 'الاستثناء ده مش موجود — اعمل ↻';
  if(/PGRST202|Could not find the function|jt_issue_review/.test(m)) return 'تحديث الداتابيز بتاع المراجعة لسه مااتطبّقش';
  return 'ماتسجّلتش — جرّب تاني';
}

// seenRev = staff_rev اللي الأدمن كان شايفه لحظة الضغط (قبل ما المودال يفتح) — الموظف عدّل في النص = stale
export function jxReview(id, action, note, seenRev){
  var r = jxById[id];
  if(!r || !sb || jxReviewing[id] || !jxIsAdmin()) return;
  if(seenRev === undefined) seenRev = r.staff_rev == null ? null : Number(r.staff_rev);
  jxReviewing[id] = true;
  var card = jxCardEl(id);
  if(card) card.classList.add('is-saving');
  var done = function(){ jxReviewing[id] = false; var c = jxCardEl(id); if(c) c.classList.remove('is-saving'); };
  sb.rpc('jt_issue_review', { p_id: Number(id), p_action: action, p_note: note || null,
    p_seen_rev: action === 'undo' ? null : seenRev }).then(function(res){
    done();
    if(res.error || !res.data){ toast(jxReviewErr(res.error), 'er'); return; }
    var d = res.data;
    jxApplyServer(r, d);
    jxNoteSync(d.updated_at);
    delete jxLogCache[id];
    if(d.stale){
      if(action === 'sent_back' && note) jxRvLast[id] = note;   // التعليق مايضيعش — بيرجع في المودال الجاي
      toast((r.verdict_by_name || 'حد من الفريق') + ' عدّل عليها وانت بتراجع — بص على الجديد وراجع تاني', 'er');
      jxAfterChange([id], true);
      return;
    }
    if(jxFilter.chip === 'review' || jxFilter.chip === 'done') jxHold[id] = jxFilter.chip;
    delete jxRvLast[id];
    toast(action === 'ok' ? 'اتراجعت ✓' : (action === 'sent_back' ? 'اترجّعت للموظف ↩️ — بقت فوق «محتاجة تعامل»' : 'رجعت «مستنية مراجعتك»'), 'ok');
    jxAfterChange([id], true);
  }, function(e){ done(); toast(jxReviewErr(e), 'er'); });
}

// التعليق في مودال برّه القايمة — أي رسم للكروت وهو بيكتب مايقدرش ياكله
function jxAskSendBack(id){
  var r = jxById[id];
  if(!r) return;
  var seen = r.staff_rev == null ? null : Number(r.staff_rev);
  showModal({ icon: '↩️', title: 'رجّعها لـ' + (r.verdict_by_name || 'الموظف'),
    sub: 'هترجع فوق «محتاجة تعامل» عند الكل بتعليقك، لحد ما حد يعدّل التصنيف أو يكتب عمل إيه — وبعدها ترجعلك تراجعها تاني.',
    input: true, inputValue: jxRvLast[id] || null, placeholder: 'عايزه يعمل إيه؟ (مثلاً: كلّمه تاني بكرة الصبح وأكّد العنوان)', okLabel: '↩️ ابعتها',
    onOk: function(v){ jxReview(id, 'sent_back', v, seen); } });
}

function jxRebuildAct(id){
  var el = jxCardEl(id), r = jxById[id];
  if(!el || !r) return;
  var act = el.querySelector('.jx-act');
  if(act) act.innerHTML = jxActHtml(r, jxSuperseded(r, jxLatestVerdictAt(jxRows)), Date.now());
}

// ── الأحداث ──────────────────────────────────────────────────────────
function jxSetChip(k){
  if(!k) return;
  var now = Date.now();
  // خروج من «بلاغاتنا» = علامات 🆕 اللي ظهرت تتمسح (اتشافت خلاص)
  if(k !== 'reports') jxRepFresh = {};
  jxFilter.chip = k;
  jxEditOpen = {}; jxHold = {};
  jxApplyStage();
  jxRenderChips(now);
  jxRenderFilterOptions(now);
  jxRenderList(true);
  jxRenderReport(now);
}

function jxCardId(el){
  var card = el && el.closest ? el.closest('.jx-card,.jx-rep') : null;
  return card ? card.getAttribute('data-id') : null;
}

function jxOnClick(e){
  var t = e.target;
  if(!t || !t.closest) return;
  if(t.closest('.sc-info')) return;   // أيقونة الشرح على الكارت مش ضغطة فلتر
  var chip = t.closest('[data-jx-chip]');
  if(chip){ jxSetChip(chip.getAttribute('data-jx-chip')); return; }
  if(t.closest('#jx-refresh')){ jxHold = {}; loadJtIssues(true); return; }
  if(t.closest('#jx-sound')){ jxToggleDeviceSound(); return; }
  if(t.closest('#jx-export')){ jxExport(); return; }
  if(t.closest('#jx-copy-report')){ jxCopyReport(); return; }
  if(t.closest('#jx-rep-copy')){ jxCopyReportsSummary(); return; }
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
  if(act === 'log'){ jxToggleLog(id); return; }
  if(act === 'rv-ok'){ jxReview(id, 'ok'); return; }
  if(act === 'rv-undo'){ jxReview(id, 'undo'); return; }
  if(act === 'rv-back'){ jxAskSendBack(id); return; }
  if(act === 'edit'){
    jxEditOpen[id] = true; jxRebuildAct(id);
    var c2 = jxCardEl(id), sel = c2 && c2.querySelector('select.jx-verdict');
    if(sel) sel.focus();
    return;
  }
  if(act === 'edit-close'){ delete jxEditOpen[id]; jxRebuildAct(id); if(jxPendingRender) jxRenderList(); return; }
}

function jxOnChange(e){
  var t = e.target;
  if(!t) return;
  if(t.id === 'jx-fdays'){
    if(jxFilter.chip === 'reports') jxFilter.repDays = Number(t.value) || 30;
    else jxFilter.days = Number(t.value) || 7;
    jxRenderAll(); return;
  }
  if(t.id === 'jx-frep'){ jxFilter.rep = t.value; jxRenderList(true); return; }
  if(t.id === 'jx-freason'){ jxFilter.reason = t.value; jxRenderList(true); return; }
  if(t.id === 'jx-fverdict'){ jxFilter.verdict = t.value; jxRenderList(true); return; }
  if(t.id === 'jx-fwho'){ jxFilter.who = t.value; jxRenderList(true); return; }
  if(t.id === 'jx-fout'){ jxFilter.out = t.value; jxRenderChips(Date.now()); jxRenderList(true); return; }
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

// 🔔/🔕 صوت الاستثناءات على الجهاز ده — لكل الأدوار (الإعدادات للأدمن بس، والموظف محتاج يكتم جهازه من غير ما يسكّت الفريق)
export function jxRenderSoundBtn(){
  var b = $id('jx-sound'); if(!b) return;
  var dev = deviceSoundOn();
  b.textContent = dev ? '🔔' : '🔕';
  b.classList.toggle('is-off', !dev);
  b.title = !jxTeamSound ? 'الأدمن قافل صوت الاستثناءات للفريق كله (من الإعدادات)'
    : (dev ? 'صوت التنبيه شغّال على الجهاز ده — اضغط تكتمه' : 'صوت التنبيه مكتوم على الجهاز ده — اضغط تشغّله');
  var cb = $id('set-jx-sound-device'); if(cb) cb.checked = dev;
}
function jxToggleDeviceSound(){
  var on = !deviceSoundOn();
  setDeviceSound(on);
  if(on) unlockAudio();
  jxRenderSoundBtn();
  toast(on ? (jxTeamSound ? '🔔 صوت الاستثناءات شغّال على الجهاز ده' : '🔔 اتشغّل على الجهاز ده — بس الأدمن قافله للفريق كله')
           : '🔕 صوت الاستثناءات اتكتم على الجهاز ده', 'ok');
}

export function initExceptions(){
  var page = $id('page-exceptions');
  if(!page) return;
  jxRenderSoundBtn();
  var fv = $id('jx-fverdict');
  if(fv){
    var html = '<option value="">أي تصنيف</option><option value="none">لسه متصنفتش</option><option value="any">اتصنّفت (أي تصنيف)</option>';
    for(var i = 0; i < JX_VERDICTS.length; i++) html += '<option value="' + JX_VERDICTS[i].k + '">' + esc(JX_VERDICTS[i].t) + '</option>';
    fv.innerHTML = html;
  }
  var fd = $id('jx-fdays'); if(fd) fd.value = String(jxFilter.days);
  jxApplyStage();
  page.addEventListener('click', jxOnClick);
  page.addEventListener('change', jxOnChange);
  page.addEventListener('input', jxOnInput);
  page.addEventListener('focusout', jxOnFocusOut);
  page.addEventListener('keydown', jxOnKeyDown);
  var list = $id('jx-list');
  if(list){
    list.addEventListener('pointermove', jxPointerMoved);
    list.addEventListener('pointerenter', function(){ jxPointerIn = true; jxPointerMoved(); });
    list.addEventListener('pointerleave', function(){
      jxPointerIn = false;
      // الرسم المؤجّل بيستنى الماوس يسيب القايمة (والخانة)
      if(jxPendingRender) setTimeout(function(){ if(jxPendingRender && !jxEditing() && !jxPointerBusy()) jxRenderList(); }, 1300);
    });
  }
  // التقرير بيترسم لما يتفتح بس — `toggle` مابيطلعش للأب، فلازم على الـdetails نفسه
  var rb = $id('jx-report-box');
  if(rb) rb.addEventListener('toggle', function(){ if(rb.open) jxRenderReport(Date.now()); });
}
