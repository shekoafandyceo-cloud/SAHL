// سكانر المخزن (14 أكتوبر — طلب المالك)
//
// «المخزون عندي مش لايف .. مش بيتحرك نهائي لاني مش بضرب الاوردرات اسكانر … محتاج كل قطعة بتخرج
// تتضرب باسكانر، حتى لو هشتري اسكانر و يتوصل على الكمبيوتر».
//
// الشكل: سكانر USB (keyboard-wedge) على الكمبيوتر + الصفحة دي مفتوحة. كل بوليصة J&T خارجة تتضرب
// → `wh_scan` على السيرفر بيخصم كل سطر في الأوردر من المخزون (الحساب كله هناك — المتصفح مابيبعتش
// كميات ولا منتجات، الكود بس). المرتجع بيتضرب بنفس الطريقة والسيرفر بيعرف إنه مرتجع من J&T.
//
// 🔴 مفيش سكان بيضيع: كل سكان بياخد `client_id` ثابت ويتحفظ في طابور (`sahl_wh_queue_<uid>`) قبل ما
//    يتبعت. النت وقع = بيفضل في الطابور ويتبعت تاني **بنفس الـclient_id**، والسيرفر بيرجّع نفس النتيجة
//    لو كان وصله (idempotent) — فمفيش خصم مرتين.
// 🔴 الكود بيتقرا من الزراير (`e.code`) مش من الحروف: الكيبورد العربي بيحوّل «JEG» لـ«تثل» — وده كان
//    هيخلّي كل سكان «كود مش مفهوم» على أي جهاز لغته عربي. ونص الخانة احتياطي (`scanToLatin`).
// 🔴 الحالة بتتغيّر على السيرفر مع المخزون (15 أكتوبر — طلب المالك): خروج = «اوردر اتضرب» · مرتجع = «مرتجع
//    مضروب» · الصفحة بتعرض اللي السيرفر رجّعه (`status_to`) بس — عمرها ما بتكتب حالة.
// ⚠️ وضع التجربة (`wh_config.enabled=false`): السكان بيعدّي على كل المنطق ويرجّع النتيجة الحقيقية
//    ومابيكتبش حرف (`dry`) — لحد ما الأدمن يدوس «▶️ شغّل السكانر».
// 📥 لوحة المرتجعات (`wh_board.returns`) = صفحة «استلام مرتجعات J&T» اللي كانت في n8n بالحرف.

import { $id, esc } from '../core/dom.js';
import { stripBidi } from '../core/format.js';
import { statusLabel } from '../core/constants.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { veilDone } from '../core/veil.js';
import { playScanTone, scanSoundOn, setScanSound, unlockAudio } from '../core/alert-sound.js';
import { whSoundCritical, whSoundSlot } from './scan-sound.js';
import { whClipFor, whLoadSounds, whSound, whSoundsInit, whSoundsRender } from './wh-sounds.js';
import { whUnknownCloseIfOther, whUnknownOpen } from './wh-unknown.js';
import { currentRole, currentTenantId, currentUser } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { createKeyBuffer, isEndKey, looksScanned, parseWaybill, scanToLatin } from './scan-code.js';
import { whAdminBoard, whAdminInit, whAdminRender } from './wh-admin.js';

// ── الثوابت ──────────────────────────────────────────────────────────
export var WH_DEDUPE_MS = 3000;        // نفس الكود مرتين خلال 3ث = السكانر قرا مرتين — بنطنّش التانية
export var WH_UNDO_MIN = 15;           // الموظف يتراجع عن سكانه خلال 15 دقيقة (السيرفر هو الحكم)
var WH_LOG_MAX = 40;                   // سجل الجلسة — آخر 40 نتيجة
var WH_BOARD_MS = 30000;               // تحديث القوايم والصفحة ظاهرة
var WH_BADGE_MS = 5 * 60000;           // الشارة على زرار التبويب
var WH_RETRY_MAX_MS = 30000;

// ── الحالة ───────────────────────────────────────────────────────────
var whQueue = [];          // [{cid, code, raw, src, force, reason, at, tries}]
var whBusy = false;        // طلب في السكة
var whRetryTimer = null;
var whRetryMs = 0;
var whLastCode = '', whLastAt = 0;
var whLog = [];            // نتايج الجلسة (الأحدث الأول)
var whCard = null;         // آخر نتيجة معروضة (بالأوبشنز لو فيه)
var whBoard = null;        // آخر رد من wh_board
var whBoardAt = 0;
var whBoardReq = 0;
var whBoardTimer = null;
var whBadgeTimer = null;
var whList = 'today';      // القايمة المفتوحة تحت
var whTab = 'scan';        // scan · map · count (الأدمن)
var whKeys = createKeyBuffer();
var whNetFails = 0;
var whDone = {};           // client_ids خلصت في التاب دي — عشان الحفظ مايرجّعهاش من نسخة تاب تانية
var whQueueFor = '';       // مفتاح الطابور اللي اتحمّل (المستخدم)
var whAuthOff = false;     // الجلسة خلصت — السكانات بتفضل في الطابور
var WH_REQ_TIMEOUT_MS = 20000;
var whAttn = [];           // نتايج محتاجة انتباه (قرار · وقّف · تحذير) لحد ما الموظف يقول «شفته» أو تتحل
var whAttnSeq = 0;
var WH_ATTN_MAX = 20;
var whCardGen = 0;         // بيزيد مع كل رسم للكارت — رد قديم (بحث · تراجع · خصم) مايغطّيش على سكان أحدث
var whUnk = null;          // wh_unknown_list (الأدمن) — بوالص J&T مش في سهل اتسجّل عليها «المنتج اللي رجع»
var whModalKeys = createKeyBuffer();   // السكانر ضرب والمودال مفتوح (سبب التراجع مثلاً)

// ── أدوات ────────────────────────────────────────────────────────────
export function whUuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){ /* http */ }
  var b = new Uint8Array(16);
  try{ crypto.getRandomValues(b); }catch(e){ for(var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;   // نسخة 4 (check.py مابيقراش 0x)
  var h = '';
  for(var j = 0; j < 16; j++){ h += (b[j] < 16 ? '0' : '') + b[j].toString(16); if(j === 3 || j === 5 || j === 7 || j === 9) h += '-'; }
  return h;
}

export function whTime(iso){
  if(!iso) return '—';
  try{
    return stripBidi(new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }));
  }catch(e){ return '—'; }
}
function whDayTime(iso){
  if(!iso) return '—';
  try{
    return stripBidi(new Date(iso).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
  }catch(e){ return '—'; }
}
function ltr(s){ return '<span class="wh-ltr" dir="ltr">' + esc(s) + '</span>'; }
function isAdminUser(){ return currentRole === 'admin'; }
function queueKey(){ return 'sahl_wh_queue_' + ((currentUser && currentUser.id) || 'x'); }

function whPageVisible(){
  var p = $id('page-warehouse');
  return !!(p && p.style.display !== 'none' && !document.hidden);
}

// ── نصوص النتايج ─────────────────────────────────────────────────────
// كل كود من السيرفر ليه عنوان وسطر «تعمل إيه». المصدر الوحيد (الكارت والسجل والهارنس).
var WH_TEXT = {
  out_ok:                    ['✅ اتخصم من المخزن', 'حطه مع الطرود الجاهزة للشحن.'],
  out_leak_fix:              ['✅ اتخصم من المخزن', 'الطرد ده J&T كانت استلمته من غير سكان — اتخصم دلوقتي.'],
  already_out:               ['🔁 الطرد ده اتضرب خروج قبل كده', 'مفيش حاجة اتخصمت تاني.'],
  blocked_cancelled:         ['⛔ الأوردر ده ملغي — ماتسلّموش للمندوب', 'حطه على جنب ورجّع البضاعة مكانها.'],
  blocked_cancel_requested:  ['⛔ العميل طالب إلغاء — ماتسلّموش', 'استنى قرار الأدمن على طلب الإلغاء.'],
  blocked_delivered:         ['⛔ الأوردر ده اتسلّم للعميل خلاص', 'غالباً بوليصة قديمة اتطبعت تاني — اسأل الأدمن.'],
  pulled_back:               ['⛔ اسحبه من «جاهز للشحن»', 'الأوردر اتلغى أو العميل طلب إلغاء — البضاعة رجعت للمخزن.'],
  with_jt_confirm:           ['⚠️ J&T استلمت الطرد ده قبل كده', 'ده مرتجع رجعلنا؟ ولا طرد خارج دلوقتي؟'],
  confirm_return:            ['⚠️ الطرد ده خرج وJ&T استلمته', 'ده مرتجع رجعلنا؟'],
  in_ok:                     ['↩️ مرتجع — رجع للمخزن', 'رجّع القطع مكانها على الرف.'],
  in_ok_precount:            ['↩️ مرتجع — رجع للمخزن', 'الطرد خرج قبل تشغيل السكانر (أو قبل الجرد) — القطع اتضافت للمخزن.'],
  in_ok_manual:              ['↩️ رجع للمخزن', 'اتسجّل بإيد الأدمن.'],
  in_ok_leak:                ['↩️ مرتجع — رجع للمخزن', 'الطرد ده كان خرج من غير سكان، والجرد أو الأدمن كان شاله من الحساب — فالقطع اتضافت.'],
  in_counted:                ['↩️ المرتجع ده محسوب في أرقام المخزون', 'اتعلّم إنه رجع — من غير إضافة (كان هنا قبل التشغيل أو الجرد، فهو محسوب).'],
  in_leak:                   ['⚠️ مرتجع لطرد خرج من غير سكان', 'اتعلّم إنه رجع — من غير إضافة (عمره ما اتخصم).'],
  in_flag_only:              ['⚠️ اتعلّم إنه رجع — من غير إضافة', 'J&T عمرها ما استلمته ومكانش اتخصم.'],
  already_in:                ['🔁 المرتجع ده اتضرب قبل كده', 'مفيش حاجة اتضافت تاني.'],
  not_a_return:              ['⛔ ده مش مرتجع', 'J&T عمرها ما استلمت الطرد ده.'],
  not_found:                 ['🚨 بوليصة J&T مش متسجلة في سهل', 'غالباً استبدال اتعمل من داشبورد J&T — لو ده المنتج اللي رجعلنا: «📥 سجّل المنتج اللي رجع». لو طرد خارج اتعمل من بوابة J&T: متسجّلوش — قول للأدمن.'],
  unknown_in:                ['📥 المنتج اللي رجع اتسجّل في المخزن', 'بوليصة J&T مش متسجلة في سهل — اتضاف للمخزن يدوي. لو اتسجّل غلط اتراجع.'],
  unknown_already_in:        ['🔁 البوليصة دي اتسجّلت قبل كده', 'المنتج اللي رجع عليها اتضاف للمخزن — مفيش حاجة اتضافت تاني.'],
  unknown_conflict:          ['⛔ البوليصة دي اتسجّلت يدوي وبقى ليها أوردر', 'الأدمن يتراجع عن التسجيل اليدوي (قايمة «📥 مرتجعات من غير أوردر») وبعدين اضربها تاني — وإلا القطعة هتتضاف مرتين.'],
  scan_first:                ['⛔ اضرب البوليصة بالسكانر الأول', 'التسجيل بيبقى على بوليصة السكانر قال عليها «مش متسجلة».'],
  has_order:                 ['⛔ البوليصة دي ليها أوردر', 'اضربها عادي بالسكانر.'],
  bad_product:               ['⛔ المنتج ده مش موجود في المخزون', 'هات القايمة تاني واختار.'],
  ambiguous:                 ['⛔ الرقم ده على أكتر من أوردر', 'اسأل الأدمن.'],
  legacy_code:               ['⛔ ده كود شركة الشحن القديمة', 'السكانر للبوالص J&T بس.'],
  product_barcode:           ['⛔ ده باركود منتج مش بوليصة', 'اضرب الباركود اللي على البوليصة.'],
  bad_code:                  ['⛔ الكود مش مفهوم', 'اضرب تاني — أو اكتب آخر أرقام البوليصة.'],
  sandbox_code:              ['⛔ ده كود تجريبي مش بوليصة حقيقية', ''],
  busy:                      ['⏳ السيرفر مشغول', 'بنبعته تاني لوحده.'],
  error:                     ['⛔ حصلت مشكلة في السيرفر', 'اضرب الطرد تاني.'],
  not_allowed:               ['⛔ مالكش صلاحية', ''],
  not_authenticated:         ['⛔ الجلسة خلصت', 'اخرج وادخل تاني.'],
  reason_required:           ['⛔ اكتب السبب', ''],
  bad_args:                  ['⛔ طلب ناقص', ''],
  undone:                    ['↶ السكان اتلغى', 'المخزون رجع زي ما كان — والحالة رجعت لو السكان كان غيّرها ومحدش غيّرها بعده.'],
  leak_dismissed:            ['✓ اتقفل', 'الطرد ده مش هيتخصم.'],
  not_leak:                  ['⛔ ده مش طرد خرج من غير سكان', ''],
  too_old:                   ['⛔ عدّى أكتر من ' + WH_UNDO_MIN + ' دقيقة', 'التراجع بعد كده للأدمن بس.'],
  already_reversed:          ['🔁 السكان ده اتلغى قبل كده', ''],
  nothing_applied:           ['⛔ السكان ده ماغيّرش حاجة', 'مفيش حاجة تتلغى.'],
  has_later_scan:            ['⛔ فيه سكان بعده على نفس الطرد', 'الغي اللي بعده الأول.'],
  busy_manual:               ['⏳ السيرفر مشغول — جرّب تاني', 'مااتعملش حاجة — اضغط تاني كمان ثانية.'],
  net:                       ['📡 مستني النت', 'السكان محفوظ وهيتبعت لوحده أول ما النت يرجع.']
};

var WH_WARN = {
  late:             '⏰ J&T كانت استلمته قبل السكان',
  unmatched:        '🔗 فيه منتج مش مربوط بالمخزن — الأدمن يربطه',
  unallocated:      '📦 اتخصم من «غير موزع» — الخاصية مش معروفة',
  short:            '📉 المخزون بقى بالسالب — ظبط الرقم من «المخزون» (أو اعمل جرد)',
  multi_piece:      '🔢 الطرد فيه أكتر من قطعة — اتأكد إنهم كلهم جوّه',
  cod_mismatch:     '💰 مبلغ التحصيل عند J&T مختلف عن السيستم',
  cancel_requested: '⚠️ العميل طالب إلغاء',
  counted:          '🧮 فيه منتج اتعدّ في جرد — مالوش حركة تاني (الجرد صلّح رقمه)',
  // (15 أكتوبر — المراجعة) نبرتهم برتقاني = بيدخلوا «محتاجة انتباهك»
  no_return_signal: '⚠️ J&T ماقالتش إنه مرتجع — الحالة ماتغيّرتش. لو الطرد ده لسه رايح للعميل اتراجع عن السكان (المخزون اتحرك)',
  unregistered_before_start: '⚠️ J&T قفلته قبل التشغيل ومحدش سجّله — اتضاف للمخزن دلوقتي. لو كان على الرف وانت بتظبط الأرقام، اتراجع عن السكان',
  ext_registered:   '⚠️ كان متسجّل في صفحة المرتجعات (n8n) بس — المخزون رجع دلوقتي. وقّف الصفحة دي'
};

export function whText(code){ return WH_TEXT[code] || ['⛔ ' + (code || 'نتيجة مش معروفة'), '']; }
export function whWarnText(w){ return WH_WARN[w] || w; }

// الصوت حسب النبرة — والنتيجة اللي مالهاش نبرة من السيرفر (رفض قبل أي حاجة) = stop
export function whTone(res){
  var t = res && res.tone;
  return (t === 'ok' || t === 'in' || t === 'dup' || t === 'warn' || t === 'stop') ? t : 'stop';
}

// ── الطابور ──────────────────────────────────────────────────────────
function queueLoad(){
  whQueueFor = queueKey();
  try{
    var raw = localStorage.getItem(queueKey());
    var q = raw ? JSON.parse(raw) : [];
    whQueue = Array.isArray(q) ? q.filter(function(it){ return it && it.cid && it.code; }) : [];
  }catch(e){ whQueue = []; }
}
// 🔴 الحفظ بيدمج مع اللي في الـstorage: تاب سكانر تانية مفتوحة (نادر — التاب ليها اسم ثابت) كانت هتكتب
// فوق سكانات التاب دي اللي لسه ماتبعتتش، ولو اتقفلت قبل ما تبعت = سكان ضايع. اللي خلص هنا مابيرجعش.
function queueSave(){
  try{
    var stored = [];
    try{ stored = JSON.parse(localStorage.getItem(queueKey()) || '[]'); }catch(e2){ stored = []; }
    var mine = {};
    for(var i = 0; i < whQueue.length; i++) mine[whQueue[i].cid] = 1;
    var keep = Array.isArray(stored) ? stored.filter(function(it){ return it && it.cid && it.code && !mine[it.cid] && !whDone[it.cid]; }) : [];
    var all = whQueue.concat(keep).slice(0, 200);
    if(all.length) localStorage.setItem(queueKey(), JSON.stringify(all));
    else localStorage.removeItem(queueKey());
  }catch(e){ swallow('warehouse/queueSave', e); }
}

// كل سكان بيدخل من هنا (السكانر · الكتابة · زرار التأكيد)
export function whEnqueue(code, opts){
  opts = opts || {};
  var it = { cid: whUuid(), code: String(code || '').slice(0, 80), raw: opts.raw || null,
             src: opts.src === 'manual' ? 'manual' : 'scanner', force: opts.force || null,
             reason: opts.reason || null, at: new Date().toISOString(), tries: 0 };
  whQueue.push(it);
  queueSave();
  if(!whBusy) renderPending(it);
  renderQueueState();
  pumpQueue();
  return it;
}

function pumpQueue(){
  if(whBusy || !whQueue.length || !sb) return;
  if(whRetryTimer){ return; }
  var it = whQueue[0];
  whBusy = true;
  it.tries = (it.tries || 0) + 1;
  queueSave();
  var args = { p_code: it.code, p_client_id: it.cid, p_force: it.force, p_reason: it.reason,
               p_station: null, p_source: it.src };
  var done = false;
  var p;
  // طلب مالوش رد (نت نص واقع) = نعتبره فشل ونبعته تاني بنفس الـclient_id — السيرفر بيرجّع نفس النتيجة
  // لو الأول كان وصل، والرد المتأخر بتاعه بيترمي (`done`)
  var tmo = setTimeout(function(){
    if(done) return; done = true;
    whBusy = false;
    onNetFail(it, { message: 'timeout' });
  }, WH_REQ_TIMEOUT_MS);
  try{ p = sb.rpc('wh_scan', args); }catch(e){ p = Promise.reject(e); }
  Promise.resolve(p).then(function(r){
    if(done) return; done = true;
    clearTimeout(tmo);
    whBusy = false;
    if(r && r.error){ onNetFail(it, r.error); return; }
    var res = (r && r.data) || {};
    // مشغول = الطلب اترجع كله على السيرفر — نبعته تاني بنفس الـclient_id
    if(res.code === 'busy'){ onBusy(); return; }
    // الجلسة خلصت = السيرفر ماعملش حاجة — السكان يفضل في الطابور لحد ما الجلسة ترجع
    if(res.code === 'not_authenticated'){ whAuthOff = true; onNetFail(it, { message: 'auth' }); return; }
    whAuthOff = false;
    whDone[it.cid] = 1;
    whQueue.shift(); queueSave();
    whNetFails = 0; whRetryMs = 0;
    onResult(it, res);
    renderQueueState();
    pumpQueue();
  }, function(err){
    if(done) return; done = true;
    clearTimeout(tmo);
    whBusy = false;
    onNetFail(it, err);
  });
}

function onBusy(){
  renderQueueState();
  clearTimeout(whRetryTimer);
  whRetryTimer = setTimeout(function(){ whRetryTimer = null; pumpQueue(); }, 1500);
}

function onNetFail(it, err){
  whNetFails++;
  whRetryMs = Math.min(WH_RETRY_MAX_MS, whRetryMs ? whRetryMs * 2 : 2000);
  renderQueueState(err);
  if(whNetFails === 1){
    renderCard({ code: 'net', tone: 'warn', _code: it.code });
    whSound(null, 'warn');
  }
  clearTimeout(whRetryTimer);
  whRetryTimer = setTimeout(function(){ whRetryTimer = null; pumpQueue(); }, whRetryMs);
}

// النت رجع = نبعت على طول من غير ما نستنى الـbackoff
function onOnline(){
  if(!whQueue.length) return;
  clearTimeout(whRetryTimer); whRetryTimer = null; whRetryMs = 0;
  pumpQueue();
}

function renderQueueState(err){
  var el = $id('wh-queue'); if(!el) return;
  var n = whQueue.length - (whBusy ? 1 : 0);
  if(whNetFails > 0 && whQueue.length){
    el.className = 'wh-queue is-off';
    el.textContent = whAuthOff
      ? '🔒 الجلسة خلصت — اخرج وادخل تاني · ' + whQueue.length + ' سكان محفوظين وهيتبعتوا بعدها'
      : '📡 النت مش واصل — ' + whQueue.length + ' سكان محفوظين وهيتبعتوا لوحدهم';
    el.title = err && err.message ? String(err.message) : '';
    el.hidden = false;
  } else if(n > 0){
    el.className = 'wh-queue';
    el.textContent = '⏳ ' + n + ' سكان في الطابور';
    el.title = '';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// ── النتيجة ──────────────────────────────────────────────────────────
function onResult(it, res){
  res = res || {};
  var entry = { cid: it.cid, code: it.code, at: new Date().toISOString(), res: res };
  whLog.unshift(entry);
  if(whLog.length > WH_LOG_MAX) whLog.length = WH_LOG_MAX;
  // نتيجة جديدة لنفس الطرد = اللي قبلها اتحلّت (اتضرب تاني · اختار مرتجع/خارج)
  var pc = resCode(res, it);
  if(pc) whAttn = whAttn.filter(function(a){ return a.code !== pc; });
  if(it.cid !== 'unk' && whUnknownCloseIfOther(pc)) toast('📥 نافذة التسجيل اتقفلت — اتضرب طرد تاني. اضرب البوليصة المجهولة تاني لو عايز تسجّلها', 'er');
  var a = attnPush(res, it);
  renderCard(res, it, a);
  renderLog();
  // 🔴 الطابور فيه كذا نتيجة ورا بعض (النت رجع): كل «وقّف» و«محتاج قرار» ليه صوته **ورا بعض بمسافة** —
  // كانوا بيتبلعوا لو جم في نفس الثانية، والموظف مش باصص للشاشة. الأخضر صوت واحد في الآخر.
  // (v78) الصوت من نوع النتيجة (whSoundSlot): مظبوط · وصل · هبعتهولك · سرينة — مقطع الأدمن لو موجود وإلا النغمة العادية
  var tone = whTone(res), slot = whSoundSlot(res);
  if(whSoundCritical(slot, tone, !!whClipFor(slot)) || !whQueue.length) whSound(slot, tone);
  if(res.applied || res.code === 'pulled_back') scheduleBoard(1200);
  try{ window.dispatchEvent(new CustomEvent('sahl:wh-result', { detail: { code: res.code, tone: tone, slot: slot } })); }catch(e){ /* قديم */ }
}

// ── النتايج اللي محتاجة انتباه ───────────────────────────────────────
// الكارت بيعرض آخر نتيجة بس — والموظف بيضرب بسرعة: «⛔ ملغي» عدّى عليه وهو بيضرب اللي بعده = طرد ملغي
// اتسلّم للمندوب. فكل نتيجة فيها قرار أو وقّف أو تحذير بتفضل في قايمة تحت الكارت لحد «✓ شفته» أو ما تتحل.
function resCode(res, it){
  return (res && res.order && res.order.tracking_no) || (res && res.tracking_no) || (it && it.code) || '';
}
function attnPush(res, it){
  if(!res || res.code === 'net') return null;
  var tone = whTone(res);
  var opts = Array.isArray(res.options) ? res.options : [];
  if(!opts.length && tone !== 'warn' && tone !== 'stop') return null;
  var a = { id: ++whAttnSeq, res: res, code: resCode(res, it), at: new Date().toISOString() };
  whAttn.unshift(a);
  if(whAttn.length > WH_ATTN_MAX) whAttn.length = WH_ATTN_MAX;
  return a;
}
function attnFind(id){
  for(var i = 0; i < whAttn.length; i++) if(whAttn[i].id === id) return whAttn[i];
  return null;
}
function attnRemove(id){ whAttn = whAttn.filter(function(a){ return a.id !== id; }); }

function renderAttn(){
  var el = $id('wh-attn'); if(!el) return;
  var cur = whCard && whCard.attnId;
  var list = whAttn.filter(function(a){ return a.id !== cur; });
  if(!list.length){ el.hidden = true; el.innerHTML = ''; return; }
  var h = '<div class="wh-attn-head"><b>⚠️ نتايج محتاجة انتباهك (' + list.length + ')</b> — عدّت وانت بتضرب اللي بعدها'
    + ' <button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wh-act="attn-clear">✓ شفتهم كلهم</button></div>';
  for(var i = 0; i < list.length; i++){
    var a = list[i], r = a.res || {}, t = whText(r.code), o = r.order || {}, opts = r.options || [];
    h += '<div class="wh-attn-row tone-' + whTone(r) + '">'
      + '<span class="wh-log-t">' + esc(whTime(a.at)) + '</span>'
      + '<span class="wh-attn-c">' + esc(t[0]) + '</span>'
      + '<span class="wh-log-o">' + (o.uid ? '#' + esc(o.uid) + ' ' : '') + ltr((a.code || '').slice(-8)) + '</span>'
      + '<span class="wh-attn-acts">'
      + (opts.indexOf('in') >= 0 ? '<button type="button" class="wh-btn wh-btn-in wh-btn-sm" data-wh-act="force-in" data-attn="' + a.id + '">↩️ مرتجع</button>' : '')
      + (opts.indexOf('out') >= 0 ? '<button type="button" class="wh-btn wh-btn-out wh-btn-sm" data-wh-act="force-out" data-attn="' + a.id + '">📦 خارج</button>' : '')
      + (r.code === 'not_found' && r.tracking_no ? '<button type="button" class="wh-btn wh-btn-in wh-btn-sm" data-wh-act="unk-open" data-code="' + esc(r.tracking_no) + '">📥 سجّله</button>' : '')
      + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wh-act="attn-ok" data-attn="' + a.id + '">✓ شفته</button>'
      + '</span></div>';
  }
  el.innerHTML = h;
  el.hidden = false;
}

function renderPending(it){
  var el = $id('wh-result'); if(!el) return;
  whCardGen++;
  // 🔴 الكارت بقى «بيتسجّل» = النتيجة اللي كانت عليه مش ظاهرة — F9/F10 كانوا لسه بيفرضوا قرارها (طرد مش قدام
  // الموظف). بتتنسى هنا، ولو كانت محتاجة انتباه بترجع لقايمة «محتاجة انتباهك» تحت
  whCard = null;
  renderAttn();
  el.className = 'wh-result is-pending';
  el.innerHTML = '<div class="wh-r-title">⏳ بيتسجّل…</div><div class="wh-r-code">' + ltr(it.code) + '</div>';
}

export function whCardHtml(res, it, attnId){
  res = res || {};
  var t = whText(res.code);
  var o = res.order || null;
  var tone = res.code === 'net' ? 'warn' : whTone(res);
  var h = '';
  if(res.dry) h += '<div class="wh-r-dry">🧪 وضع تجربة — مفيش حاجة اتكتبت في المخزن</div>';
  if(res.replay) h += '<div class="wh-r-dry">↻ السكان ده كان وصل قبل كده — دي نتيجته</div>';
  h += '<div class="wh-r-title">' + esc(t[0]) + '</div>';
  if(t[1]) h += '<div class="wh-r-sub">' + esc(t[1]) + '</div>';
  if(o){
    h += '<div class="wh-r-order">'
      + (o.uid ? '<b>#' + esc(o.uid) + '</b>' : '')
      + (o.first_name ? ' · ' + esc(o.first_name) : '')
      + (o.tracking_no ? ' · ' + ltr(o.tracking_no) : '')
      + (o.pieces > 1 ? ' · <span class="wh-pcs">' + esc(String(o.pieces)) + ' قطع</span>' : '')
      + '</div>';
  } else if(res.tracking_no || (it && it.code)){
    h += '<div class="wh-r-code">' + ltr(res.tracking_no || it.code) + '</div>';
  }
  // الحالة اللي السيرفر كتبها (أو كان هيكتبها في التجربة) — «undone» بيرجّع الحالة اللي رجعت لها
  if(res.status_to){
    h += '<div class="wh-r-st">🔄 حالة الأوردر ' + (res.dry ? 'كانت هتبقى' : (res.code === 'undone' ? 'رجعت' : 'بقت'))
      + ': <b>' + esc(statusLabel(res.status_to)) + '</b></div>';
  }
  // prev.src = ext: اتسجّل في صفحة المرتجعات (n8n) قبل السكان ده — مش «اتضرب بإيد صفحة المرتجعات»
  if(res.prev && res.prev.src === 'ext'){
    h += '<div class="wh-r-prev">📋 متسجّل قبل كده في صفحة المرتجعات ' + esc(whDayTime(res.prev.at)) + '</div>';
  } else if(res.prev && (res.prev.at || res.prev.by)){
    var unkPrev = res.code === 'unknown_already_in' || res.code === 'unknown_conflict';
    h += '<div class="wh-r-prev">' + (unkPrev ? '📥 اتسجّل يدوي ' : 'اتضرب ') + esc(whDayTime(res.prev.at)) + (res.prev.by ? ' · بإيد ' + esc(res.prev.by) : '') + '</div>';
  }
  var lines = Array.isArray(res.lines) ? res.lines : [];
  if(lines.length){
    h += '<ul class="wh-r-lines">';
    for(var i = 0; i < lines.length; i++){
      var l = lines[i] || {};
      var sign = l.dir === 'in' ? '+' : '−';
      var st = '';
      if(l.state === 'unmatched') st = '<span class="wh-l-bad">مش مربوط بالمخزن</span>';
      else if(l.state === 'ignored') st = '<span class="wh-l-mute">متجاهَل</span>';
      else if(l.state === 'superseded') st = '<span class="wh-l-mute">' + esc(l.product_name || '') + ' — اتعدّ في الجرد، مفيش حركة</span>';
      else if(l.state === 'void') st = '<span class="wh-l-mute">مااتضافش — عمره ما اتخصم</span>';
      else if(l.state === 'posted' || l.state === 'reversed'){
        st = '<span class="wh-l-prod">' + esc(l.product_name || '') + (l.matched_by === 'unallocated' ? ' (غير موزع)' : '') + '</span>'
           + (l.qty_after != null ? ' <span class="wh-l-after' + (l.qty_after < 0 ? ' neg' : '') + '">باقي ' + ltr(String(l.qty_after)) + '</span>' : '');
      }
      h += '<li><span class="wh-l-qty">' + sign + esc(String(l.qty || 1)) + '</span> <span class="wh-l-txt">' + esc(l.text || '') + '</span> ' + st + '</li>';
    }
    h += '</ul>';
  } else if(o && Array.isArray(o.items) && o.items.length && !res.applied){
    h += '<ul class="wh-r-lines is-plain">';
    for(var j = 0; j < o.items.length; j++){
      h += '<li><span class="wh-l-qty">×' + esc(String(o.items[j].qty || 1)) + '</span> <span class="wh-l-txt">' + esc(o.items[j].text || '') + '</span></li>';
    }
    h += '</ul>';
  }
  var w = Array.isArray(res.warnings) ? res.warnings : [];
  if(w.length){
    h += '<div class="wh-r-warns">';
    for(var k = 0; k < w.length; k++) h += '<span class="wh-warn" data-w="' + esc(w[k]) + '">' + esc(whWarnText(w[k])) + '</span>';
    h += '</div>';
  }
  var acts = '';
  var opts = Array.isArray(res.options) ? res.options : [];
  var da = attnId ? ' data-attn="' + esc(String(attnId)) + '"' : '';
  if(opts.indexOf('in') >= 0) acts += '<button type="button" class="wh-btn wh-btn-in" data-wh-act="force-in"' + da + '>↩️ أيوه مرتجع رجع <kbd>F9</kbd></button>';
  if(opts.indexOf('out') >= 0) acts += '<button type="button" class="wh-btn wh-btn-out" data-wh-act="force-out"' + da + '>📦 لا — ده خارج دلوقتي <kbd>F10</kbd></button>';
  if(res.code === 'blocked_cancel_requested' && isAdminUser()) acts += '<button type="button" class="wh-btn" data-wh-act="ship-anyway">🚚 اشحنه برضه (أدمن)</button>';
  // (v78) بوليصة J&T مش في سهل = «سجّل المنتج اللي رجع» (أي موظف) · والتسجيل نفسه بيتراجع بدالته (مالوش أوردر)
  if(res.code === 'not_found' && res.tracking_no){
    acts += '<button type="button" class="wh-btn wh-btn-in" data-wh-act="unk-open" data-code="' + esc(res.tracking_no) + '">📥 سجّل المنتج اللي رجع</button>';
  }
  if(res.scan_id && res.applied && (res.dir === 'out' || res.dir === 'in') && !res.dry){
    acts += '<button type="button" class="wh-btn wh-btn-ghost" data-wh-act="undo" data-scan="' + esc(String(res.scan_id)) + '"'
      + (res.code === 'unknown_in' ? ' data-kind="unknown"' : '') + '>↶ تراجع</button>';
  }
  if(attnId && !opts.length) acts += '<button type="button" class="wh-btn wh-btn-ghost" data-wh-act="attn-ok"' + da + '>✓ شفته</button>';
  if(acts) h += '<div class="wh-r-acts">' + acts + '</div>';
  return { tone: tone, html: h };
}

function renderCard(res, it, attn){
  var el = $id('wh-result'); if(!el) return;
  whCardGen++;
  var c = whCardHtml(res, it, attn ? attn.id : null);
  whCard = { res: res, code: resCode(res, it) || res._code || '', attnId: attn ? attn.id : null };
  el.className = 'wh-result tone-' + c.tone + (res.dry ? ' is-dry' : '');
  el.innerHTML = c.html;
  el.setAttribute('data-code', res.code || '');
  renderAttn();
}

function renderLog(){
  var el = $id('wh-log'); if(!el) return;
  if(!whLog.length){ el.innerHTML = '<div class="wh-empty">لسه مفيش سكانات من الجهاز ده.</div>'; return; }
  var h = '';
  for(var i = 0; i < whLog.length; i++){
    var e = whLog[i], r = e.res || {}, t = whText(r.code), o = r.order || {};
    h += '<div class="wh-log-row tone-' + whTone(r) + '">'
      + '<span class="wh-log-t">' + esc(whTime(e.at)) + '</span>'
      + '<span class="wh-log-c">' + esc(t[0]) + (r.dry ? ' 🧪' : '') + '</span>'
      + '<span class="wh-log-o">' + (o.uid ? '#' + esc(o.uid) : '') + ' ' + ltr((o.tracking_no || r.tracking_no || e.code || '').slice(-8)) + '</span>'
      + '</div>';
  }
  el.innerHTML = h;
}

// ── القراية من السكانر ──────────────────────────────────────────────
// الطريقة: كل ضغطة بتتسجّل بالزرار الفعلي، وEnter (أو Tab · Ctrl+J/M) = آخر الكود.
// الأولوية: بافر الزراير (مستقل عن لغة الكيبورد) ← نص الخانة بعد `scanToLatin` ← بحث بآخر الأرقام.
function captureActive(){
  if(!whPageVisible() || whTab !== 'scan') return false;
  var bd = $id('cmodal-backdrop');
  if(bd && bd.style.display === 'flex') return false;
  var ovl = $id('ovl');
  if(ovl && ovl.classList.contains('open')) return false;
  return true;
}

// الموبايل/التابلت: الفوكس الأوتوماتيك بيطلّع الكيبورد ويغطي نص الشاشة — هناك الفوكس بضغطة بس
function autoFocusOk(){
  try{ if(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return false; }catch(e){ /* قديم */ }
  return !(window.innerWidth && window.innerWidth <= 768);
}

function focusInput(force){
  var inp = $id('wh-input');
  if(inp && captureActive() && document.activeElement !== inp && (force || autoFocusOk())){
    try{ inp.focus({ preventScroll: true }); }catch(e){ inp.focus(); }
  }
}

// 🔴 المودال مفتوح (سبب التراجع · اشحنه برضه · خصم) والموظف ضرب طرد: الحروف كانت بتتكتب في خانة السبب وEnter
// بيأكّد المودال **بكود البوليصة كسبب** — والطرد نفسه مااتسجّلش. دلوقتي: الضربة بتتعرف من سرعتها وشكلها
// (JEG + 12 رقم)، الحروف بتتشال من الخانة، والسكان بيدخل الطابور عادي، والمودال يفضل مفتوح زي ما هو.
function modalOpenOnScan(){
  if(!whPageVisible() || whTab !== 'scan') return false;
  var bd = $id('cmodal-backdrop');
  return !!(bd && bd.style.display === 'flex');
}
function modalScanGuard(e){
  if(!modalOpenOnScan()){ whModalKeys.reset(); return false; }
  var mi = $id('cmodal-input');
  var inMi = mi && document.activeElement === mi;
  if(isEndKey(e)){
    // كود البوليصة بشكله (JEG + 12 رقم) كفاية — وأي ضربة تانية بسرعة السكانر (≥ 8 زراير ورا بعض بمتوسط ≤ 35ms)
    // = قراية سكانر برضه (كود قديم · باركود منتج · قراية ناقصة): ماتأكّدش المودال بيها، والسيرفر يقول نوعها
    var tail = whModalKeys.tail(15), start = whModalKeys.markAt(15);
    var bn = whModalKeys.burstLen(120), bt = whModalKeys.timing(bn);
    // 🔴 والشكل لوحده مش كفاية: كود مكتوب بالإيد كسبب = سبب مش سكان · وزرار متداس (e.repeat — البافر مابيعدّوش)
    // أو حرف واحد متكرر = مش سكانر. بس حد السرعة هنا **أوسع** من looksScanned (متوسط ≤ 50ms وأقصى فجوة ≤ 300ms):
    // سكانر بلوتوث/أبطأ شوية أو فيه «تهنيجة» واحدة كان بيتحسب كتابة إيد، فالمودال يتأكّد بالكود كسبب والطرد يضيع —
    // والصفحة نفسها بتقبل كود J&T من غير أي حد سرعة. الكتابة بالإيد (~60ms+ بين الزراير) لسه برّه.
    var wt = whModalKeys.timing(15);
    var isWay = /^[JU]EG\d{12}$/.test(tail) && wt.n >= 15 && wt.avg <= 50 && wt.max <= 300;
    var bTail = whModalKeys.tail(bn);
    if(!isWay && bn >= 8 && bt.avg <= 35 && bt.max <= 120 && !/^(.)\1+$/.test(bTail)){ tail = bTail; start = whModalKeys.markAt(bn); isWay = true; }
    whModalKeys.reset();
    if(isWay){
      e.preventDefault();
      if(e.stopImmediatePropagation) e.stopImmediatePropagation();
      if(inMi && typeof start === 'number'){
        var v = mi.value || '', end = mi.selectionStart == null ? v.length : mi.selectionStart;
        if(start >= 0 && start <= end && end <= v.length) mi.value = v.slice(0, start) + v.slice(end);
      }
      var now = Date.now();
      if(!(tail === whLastCode && now - whLastAt < WH_DEDUPE_MS)){
        whLastCode = tail; whLastAt = now;
        unlockAudio();
        whEnqueue(tail, { raw: tail });
        toast('📦 السكان اتسجّل — النافذة اللي فوق لسه مفتوحة', 'ok');
      }
      return true;
    }
    if(e.ctrlKey && (e.code === 'KeyJ' || e.code === 'KeyM')) e.preventDefault();
    return true;   // Enter عادي = المودال يكمّل شغله
  }
  whModalKeys.push(e, inMi ? mi.selectionStart : undefined);
  return true;
}

function onKeyDown(e){
  if(modalScanGuard(e)) return;
  if(!captureActive()) return;
  var inp = $id('wh-input');
  var ae = document.activeElement;
  var inOther = ae && ae !== inp && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '');
  if(inOther) return;
  // F9/F10 = أزرار التأكيد — على النتيجة اللي على الكارت **بس** (اللي الموظف شايفها).
  // 🔴 كانت بتمشي على «محتاجة انتباهك» لو الكارت مافيهوش الاختيار: ضغطتين F9 (أو زرار متداس) = طرد تاني
  // اتفرض «مرتجع» من غير ما حد يختاره. ومرة واحدة لكل كارت (الضغطة المتكررة من الزرار المتداس بتترمي).
  // 🔴 دايماً preventDefault: F10 بيفتح قايمة المتصفح، والفوكس كان بيروح هناك والسكان اللي بعده يضيع.
  if(e.key === 'F9' || e.key === 'F10'){
    e.preventDefault();
    if(e.repeat) return;
    var want = e.key === 'F9' ? 'in' : 'out';
    var co = (whCard && !whCard.forced && whCard.res && whCard.res.options) || [];
    if(co.indexOf(want) >= 0) whForce(want, whCard.attnId || null);
    return;
  }
  if(isEndKey(e)){
    // Ctrl+J (لاحقة بعض السكانرات) بيفتح التحميلات في كروم — حتى لو مفيش كود اتقرا
    if(e.ctrlKey) e.preventDefault();
    var txt = inp ? inp.value : '';
    var buf = whKeys.value();
    if(!buf && !String(txt).trim()) { whKeys.reset(); return; }
    e.preventDefault();
    var scanned = looksScanned(whKeys.timing(16));
    whKeys.reset();
    if(inp) inp.value = '';
    whSubmit(buf, txt, scanned);
    return;
  }
  if(e.key === 'Escape'){ whKeys.reset(); if(inp) inp.value = ''; return; }
  whKeys.push(e);
  // الفوكس مش في الخانة (اتضغط على حاجة في الصفحة): الحروف بتتجمّع في البافر، ونرجّع الفوكس
  // (فيه كيبورد/سكانر حقيقي بيكتب — فالفوكس هنا مايطلّعش كيبورد الموبايل)
  if(inp && ae !== inp){ focusInput(true); }
}

// القرار: الكود من البافر لو مفهوم، وإلا من نص الخانة، وإلا بحث.
// `scanned` = الضغطات جت بسرعة السكانر: أرقام بس من السكانر = باركود (السيرفر بيقول نوعه)، ومن الإيد = بحث
// بآخر أرقام البوليصة (الموظف بيكتب «000538937803» من غير JEG).
export function whResolveInput(buf, txt, scanned){
  var a = parseWaybill(buf || '');
  if(a.kind === 'jt' || a.kind === 'jt_sandbox') return { type: 'scan', code: a.code };
  var b = parseWaybill(txt || '');
  if(b.kind === 'jt' || b.kind === 'jt_sandbox') return { type: 'scan', code: b.code };
  var t = scanToLatin(txt || '') || scanToLatin(buf || '');
  if(!t) return { type: 'none' };
  if(/^W-?\d{1,6}$/.test(t) || /^\d{4,7}$/.test(t)) return { type: 'lookup', q: t };
  if(/^\d{8,12}$/.test(t) && !scanned) return { type: 'lookup', q: t };
  return { type: 'scan', code: t.slice(0, 80) };
}

export function whSubmit(buf, txt, scanned){
  var d = whResolveInput(buf, txt, scanned);
  if(d.type === 'none') return;
  if(d.type === 'lookup'){ whLookup(d.q); return; }
  var now = Date.now();
  if(d.code === whLastCode && now - whLastAt < WH_DEDUPE_MS){ return; }   // قراية مزدوجة من السكانر
  whLastCode = d.code; whLastAt = now;
  unlockAudio();
  whEnqueue(d.code, { raw: String(txt || buf || '').slice(0, 80) });
}

// ── الكتابة بالإيد: آخر أرقام البوليصة أو رقم الأوردر ───────────────
function whLookup(q){
  var el = $id('wh-result'); if(!el || !sb) return;
  whCard = null;   // نفس renderPending: الكارت مابقاش بيعرض النتيجة القديمة
  renderAttn();
  el.className = 'wh-result is-pending';
  el.innerHTML = '<div class="wh-r-title">🔎 بندوّر على ' + ltr(q) + '…</div>';
  var gen = ++whCardGen;
  sb.rpc('wh_lookup', { p_q: q }).then(function(r){
    // اتضرب طرد بعد ما البحث خرج = الكارت بتاعه — نتيجة البحث ماتغطّيش عليه
    if(gen !== whCardGen){ toast('🔎 نتيجة البحث عن ' + q + ' وصلت بعد سكان تاني — اكتبه تاني', 'er'); return; }
    if(r.error || !r.data || !r.data.ok){
      renderCard({ code: 'error', tone: 'stop' });
      return;
    }
    var rows = r.data.rows || [];
    if(!rows.length){
      el.className = 'wh-result tone-stop';
      el.innerHTML = '<div class="wh-r-title">⛔ مفيش بوليصة بالرقم ده</div><div class="wh-r-sub">اكتب آخر 5 أرقام أو أكتر من البوليصة، أو رقم الأوردر.</div>';
      whSound(null, 'stop');
      return;
    }
    // نتيجة واحدة وهي مرتجع مستني يتسجل = بيتسجّل على طول (زي صفحة n8n — الموظف على الباب كاتب آخر 5 أرقام)
    if(rows.length === 1 && rows[0].open_return && rows[0].tracking_no){
      unlockAudio();
      whEnqueue(rows[0].tracking_no, { src: 'manual', raw: 'typed:' + String(q).slice(0, 20) });
      return;
    }
    var h = '<div class="wh-r-title">🔎 اختار الطرد</div><div class="wh-pick">';
    for(var i = 0; i < rows.length; i++){
      var x = rows[i];
      h += '<button type="button" class="wh-pick-row" data-wh-act="pick" data-code="' + esc(x.tracking_no) + '">'
        + '<b>#' + esc(x.uid || '') + '</b> ' + (x.first_name ? esc(x.first_name) + ' · ' : '') + ltr(x.tracking_no)
        + '<span class="wh-pick-items">' + esc(x.items || '') + '</span>'
        + (x.open_return ? '<span class="wh-pick-st is-ret">↩️ مرتجع مستني يتسجل</span>' : '')
        + (x.out_at ? '<span class="wh-pick-st">خرج ' + esc(whDayTime(x.out_at)) + '</span>' : '')
        + (x.in_at ? '<span class="wh-pick-st">رجع ' + esc(whDayTime(x.in_at)) + '</span>' : '')
        + '</button>';
    }
    h += '</div>';
    el.className = 'wh-result tone-info';
    el.innerHTML = h;
    whCard = null;
    renderAttn();
  });
}

// ── الأزرار في الكارت ────────────────────────────────────────────────
// الاختيار على نتيجة بعينها (`attnId` من الزرار) — وإلا النتيجة اللي على الكارت (F9/F10)
export function whForce(dir, attnId){
  var a = attnId ? attnFind(Number(attnId)) : null;
  var onCard = !!(whCard && !whCard.forced && (a ? whCard.attnId === a.id : !attnId));
  var code = '';
  if(a && (a.res.options || []).indexOf(dir) >= 0) code = a.code;
  else if(onCard && whCard.code && ((whCard.res && whCard.res.options) || []).indexOf(dir) >= 0) code = whCard.code;
  if(!code) return;
  if(a) attnRemove(a.id);
  // 🔴 الكارت مابيتصفّرش (كان بيرجّع نتيجته في القايمة تحت الماوس — الضغطة التانية كانت بتقع على صف تاني):
  // بيتعلّم «اتاخد قراره» والأزرار بتتقفل لحد ما النتيجة الجديدة توصل
  if(onCard){
    whCard.forced = true;
    var el = $id('wh-result');
    if(el) el.querySelectorAll('[data-wh-act="force-in"],[data-wh-act="force-out"]').forEach(function(b){ b.disabled = true; });
  }
  renderAttn();
  whEnqueue(code, { force: dir, src: 'manual' });
}

function attnOk(attnId){
  var id = Number(attnId);
  attnRemove(id);
  if(whCard && whCard.attnId === id){
    var el = $id('wh-result');
    whCard.attnId = null;
    if(el){ var b = el.querySelector('[data-wh-act="attn-ok"]'); if(b) b.remove(); }
  }
  renderAttn();
}

function whShipAnyway(){
  if(!whCard || !whCard.code || !isAdminUser()) return;
  var code = whCard.code;
  showModal({ icon: '🚚', title: 'اشحنه رغم طلب الإلغاء؟', sub: 'العميل طالب إلغاء. اكتب ليه هيتشحن برضه — هيتسجّل باسمك.',
    okLabel: 'اشحنه', input: true, placeholder: 'السبب (مثلاً: العميل رجع في كلامه)',
    onOk: function(reason){ whEnqueue(code, { force: 'ship_anyway', reason: reason, src: 'manual' }); } });
}

export function whUndo(scanId, kind){
  if(!scanId || !sb) return;
  var unk = kind === 'unknown';
  showModal({ icon: '↶', title: unk ? 'تراجع عن تسجيل المنتج اللي رجع؟' : 'تراجع عن السكان ده؟',
    sub: unk ? 'القطع اللي اتضافت للمخزن على البوليصة دي هتتشال تاني. اكتب السبب.'
             : 'المخزون هيرجع زي ما كان قبل السكان — والحالة كمان لو محدش غيّرها بعده. اكتب السبب.',
    okLabel: 'تراجع', okColor: 'var(--red)', input: true, placeholder: 'السبب (مثلاً: اتضرب بالغلط)',
    onOk: function(reason){
      var gen = whCardGen;
      sb.rpc(unk ? 'wh_unknown_undo' : 'wh_scan_undo', { p_scan_id: Number(scanId), p_reason: reason }).then(function(r){
        var res = (r && r.data) || { code: 'error', tone: 'stop' };
        if(r && r.error) res = { code: 'error', tone: 'stop' };
        // «مشغول» هنا مش بيتبعت تاني لوحده (مش في الطابور) — الرسالة بتقول جرّب تاني
        if(res.code === 'busy') res = Object.assign({}, res, { code: 'busy_manual' });
        // اتضرب طرد وانت مستني = الكارت بتاعه، والنتيجة دي toast بس
        if(gen === whCardGen) renderCard(res);
        whSound(null, res.ok ? 'warn' : 'stop');
        if(res.ok){ toast('اتلغى السكان ✓', 'ok'); scheduleBoard(300); }
        else toast(whText(res.code)[0], 'er');
      });
    } });
}

// ── القوايم (wh_board) ───────────────────────────────────────────────
// rc = عدّادات لوحة المرتجعات (wh_board.returns.counts) — نفس صفحة n8n
var WH_LISTS = [
  { k: 'today',            t: '🧾 سكانات النهارده',             n: function(c){ return (c.out_today || 0) + (c.in_today || 0); } },
  { k: 'not_scanned',      t: '🖨️ اتطبعت ولسه ماتضربتش',       n: function(c){ return c.not_scanned || 0; } },
  { k: 'pile',             t: '📦 جاهز للشحن — مستني المندوب', n: function(c){ return c.pile || 0; } },
  { k: 'pull',             t: '⛔ اسحبها من «جاهز للشحن»',    n: function(c){ return c.pull || 0; }, hot: true },
  { k: 'ret_courier',      t: '🚚 مرتجعات مع المندوب',          n: function(c, rc){ return rc.courier || 0; } },
  { k: 'ret_missing',      t: '🚨 J&T قالت سلّمتها ومش متسجلة', n: function(c, rc){ return rc.missing || 0; }, hot: true },
  { k: 'ret_scanned',      t: '✅ مرتجعات اتسجلت النهارده',     n: function(c, rc){ return rc.scanned_today || 0; } },
  { k: 'ret_transit',      t: '🔄 مرتجعات لسه في الطريق',       n: function(c, rc){ return rc.transit || 0; } },
  { k: 'leak',             t: '🔴 خرجت من غير سكان',            n: function(c){ return c.leak || 0; }, hot: true, admin: true },
  { k: 'in_delivered',     t: '↩️ اتضربت مرتجع وJ&T سلّمتها',   n: function(c){ return c.in_delivered || 0; }, hot: true, admin: true },
  { k: 'unknown',          t: '📥 مرتجعات من غير أوردر',         n: function(){ return (whUnk || []).filter(function(x){ return !x.reversed; }).length; }, admin: true }
];

// الشارة البرتقاني: اسحبها من «جاهز للشحن» + المرتجع اللي J&T قفلته من أكتر من 30 دقيقة ومحدش سجّله (نفس سماح تنبيه
// n8n — الطرد بيتسلّم والسكان بعده بدقايق) · الحمرا للأدمن: خرج من غير سكان + سطور مش مربوطة + رصيد بالسالب
export function whCountsBadge(c, rc){
  c = c || {}; rc = rc || {};
  return { staff: (c.pull || 0) + (rc.missing_old || 0),
           admin: Math.max(0, (c.leak || 0) - (c.leak_counted || 0)) + (c.unmatched_lines || 0) + (c.negative_products || 0)
                  + (c.in_delivered || 0) };
}

export function whSetNavBadge(c, rc){
  var n = whCountsBadge(c, rc);
  var b = $id('wh-nav-badge');
  if(b){
    if(n.staff > 0){ b.textContent = n.staff > 99 ? '99+' : String(n.staff); b.title = n.staff + ' طرد محتاج تتحرك له في المخزن'; b.style.display = 'inline-flex'; }
    else b.style.display = 'none';
  }
  var b2 = $id('wh-nav-badge2');
  if(b2){
    if(n.admin > 0 && isAdminUser()){ b2.textContent = n.admin > 99 ? '99+' : String(n.admin); b2.title = n.admin + ' حاجة محتاجة الأدمن (خرج من غير سكان · منتج مش مربوط · رصيد بالسالب · اتضرب مرتجع وJ&T سلّمته)'; b2.style.display = 'inline-flex'; }
    else b2.style.display = 'none';
  }
}

// بتتنادى من loadAll (بعد الدخول ومع كل ↻) وكل 5 دقايق
export function whRefreshNavBadge(){
  if(!sb || !currentTenantId || tourActive) return;
  if(!whBadgeTimer){
    whBadgeTimer = setInterval(function(){ if(!document.hidden) whRefreshNavBadge(); }, WH_BADGE_MS);
  }
  if(whPageVisible()) return;   // الصفحة مفتوحة = التحميل الكامل بيحدّثها
  sb.rpc('wh_board', { p_lite: true }).then(function(r){
    if(r.error || !r.data || !r.data.ok) return;
    whSetNavBadge(r.data.counts, r.data.returns && r.data.returns.counts);
  });
}

function scheduleBoard(ms){
  clearTimeout(whBoardTimer);
  whBoardTimer = setTimeout(function(){ if(whPageVisible()) loadBoard(); }, ms || 0);
}

function loadBoard(){
  if(!sb || !currentTenantId) { veilDone('warehouse'); return; }
  var req = ++whBoardReq;
  sb.rpc('wh_board', { p_lite: false }).then(function(r){
    if(req !== whBoardReq) return;   // رد قديم وصل بعد الأحدث
    veilDone('warehouse');
    if(r.error || !r.data || !r.data.ok){
      var host = $id('wh-lists');
      if(host && !whBoard) host.innerHTML = '<div class="wh-empty">مقدرناش نحمّل قوايم المخزن — السكان نفسه شغّال. <button type="button" class="wh-btn wh-btn-ghost" data-wh-act="reload-board">↻ حاول تاني</button></div>';
      return;
    }
    whBoard = r.data; whBoardAt = Date.now();
    if(isAdminUser()) loadUnknown();
    whSetNavBadge(whBoard.counts, retCounts());
    renderMode();
    renderRet();
    renderChips();
    renderList();
    whAdminBoard(whBoard);
  });
}

// قايمة «📥 مرتجعات من غير أوردر» (الأدمن) — مع كل تحميل للوحة
function loadUnknown(){
  Promise.resolve(sb.rpc('wh_unknown_list', { p_days: 30 })).then(function(r){
    var d = r && !r.error && r.data;
    if(!d || !d.ok || !Array.isArray(d.rows)) return;
    whUnk = d.rows;
    renderChips();
    if(whList === 'unknown') renderList();
  }, function(e){ swallow('warehouse/unknown', e); });
}

function renderMode(){
  var el = $id('wh-mode'); if(!el || !whBoard) return;
  if(!whBoard.enabled && !whBoard.baseline_at){
    el.className = 'wh-mode is-trial';
    el.innerHTML = '🧪 <b>وضع تجربة</b> — السكان شغّال وبيقولك النتيجة الحقيقية، بس <b>مابيغيّرش الحالة ومابيخصمش من المخزن لسه</b>.'
      + (isAdminUser() ? ' عشان يشتغل: اربط المنتجات، ظبط أرقام المخزون، وبعدين «▶️ شغّل السكانر» من تاب «⚙️ التشغيل».' : ' الأدمن هيشغّله.');
    el.hidden = false;
  } else if(!whBoard.enabled){
    el.className = 'wh-mode is-paused';
    el.innerHTML = '⏸️ <b>السكان متوقف</b> — مابيغيّرش الحالة ومابيخصمش من المخزن' + (isAdminUser() ? ' (شغّله من تاب «⚙️ التشغيل»).' : ' — كلّم الأدمن.');
    el.hidden = false;
  } else {
    el.className = 'wh-mode is-on';
    var n8 = retCounts().n8n_only || 0;
    el.innerHTML = '🟢 شغّال — الخروج «اوردر اتضرب» ويتخصم · المرتجع «مرتجع مضروب» ويرجع المخزن · من ' + esc(whDayTime(whBoard.baseline_at))
      // 🔴 صفحة n8n بعد التشغيل بتعلّم المرتجع من غير ما المخزون يرجع — لازم تبان مش تختفي في «ناقص» بس
      + (n8 ? '<br>⚠️ <b>' + esc(String(n8)) + ' مرتجع اتسجل في صفحة n8n بعد التشغيل</b> — المخزون مارجعلهمش: اضربهم هنا (في «ناقص»)' + (isAdminUser() ? ' ووقّف الصفحة دي.' : ' وقول للأدمن.') : '');
    el.hidden = false;
  }
}

function retCounts(){ return (whBoard && whBoard.returns && whBoard.returns.counts) || {}; }

// ── لوحة المرتجعات — نفس كروت صفحة «استلام مرتجعات J&T» (n8n): مع المندوب · J&T قفلت النهارده · اتسجل النهارده · ناقص
function renderRet(){
  var el = $id('wh-ret'); if(!el || !whBoard) return;
  var rc = retCounts();
  var tile = function(list, n, label, cls, sub){
    return '<button type="button" class="wh-ret-stat' + (cls ? ' ' + cls : '') + (whList === list ? ' on' : '') + '" data-wh-list="' + list + '">'
      + '<b>' + esc(String(n || 0)) + '</b><span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
  };
  var cd = rc.courier ? esc(String(rc.courier_done || 0)) + ' من ' + esc(String(rc.courier)) + ' ✅' : '';
  el.innerHTML = '<div class="wh-ret-head">↩️ <b>المرتجعات</b> — سجّل كل مرتجع أول ما يوصل. وقبل ما المندوب يمشي، اتأكد إن «مع المندوب» كلها ✅.</div>'
    + '<div class="wh-ret-stats">'
    + tile('ret_courier', rc.courier, 'مع المندوب', '', cd)
    + '<div class="wh-ret-stat is-static"><b>' + esc(String(rc.closed_today || 0)) + '</b><span>J&amp;T قفلت النهارده</span></div>'
    + tile('ret_scanned', rc.scanned_today, 'اتسجل النهارده', 'ok', '')
    + tile('ret_missing', rc.missing, 'ناقص', (rc.missing ? 'bad' : ''), rc.missing ? 'J&amp;T قالت سلّمتها' : '')
    + '</div>';
  el.hidden = false;
}

function renderChips(){
  var el = $id('wh-chips'); if(!el || !whBoard) return;
  var c = whBoard.counts || {}, rc = retCounts();
  var h = '';
  for(var i = 0; i < WH_LISTS.length; i++){
    var L = WH_LISTS[i];
    if(L.admin && !isAdminUser()) continue;
    var n = L.n(c, rc);
    h += '<button type="button" class="wh-chip' + (whList === L.k ? ' on' : '') + (L.hot && n > 0 ? ' hot' : '') + '" data-wh-list="' + L.k + '">'
      + esc(L.t) + ' <span class="n">' + esc(String(n)) + '</span></button>';
  }
  el.innerHTML = h;
  var st = $id('wh-stats');
  if(st){
    st.innerHTML = '<span>📦 خرج النهارده <b>' + esc(String(c.out_today || 0)) + '</b></span>'
      + '<span>↩️ رجع النهارده <b>' + esc(String(c.in_today || 0)) + '</b></span>'
      + (isAdminUser() && c.unmatched_lines ? '<span class="bad">🔗 سطور مش مربوطة <b>' + esc(String(c.unmatched_lines)) + '</b></span>' : '')
      + (isAdminUser() && c.negative_products ? '<span class="bad">📉 منتجات بالسالب <b>' + esc(String(c.negative_products)) + '</b></span>' : '');
  }
}

var WH_LIST_HINT = {
  today:            'كل السكانات النهارده من كل الأجهزة. تقدر تتراجع عن سكانك خلال ' + WH_UNDO_MIN + ' دقيقة.',
  not_scanned:      'بوالص J&T اتطبعت والمندوب لسه مااستلمهاش — ومحدش ضربها خروج. اضربها قبل ما تسلّمها.',
  pile:             'اتضربت خروج ومستنية المندوب. لو فضلت أكتر من 30 ساعة اسأل J&T.',
  pull:             'اتضربت خروج وبعدين الأوردر اتلغى أو العميل طلب إلغاء — اسحبها من «جاهز للشحن» واضربها تاني (هترجع للمخزن).',
  ret_courier:      'مندوب J&T طالع لكم بالمرتجعات دي — اضرب كل واحد أول ما يوصل، وقبل ما المندوب يمشي اتأكد إنهم كلهم ✅.',
  ret_missing:      'J&T قفلتها إنها اتسلّمت لكم ومحدش ضربها هنا (أو اتسجّلت في صفحة n8n بس بعد التشغيل). لو المرتجع وصل فعلاً اضربه — لو ما وصلش، كلّم المندوب والفرع فوراً.',
  ret_scanned:      'المرتجعات اللي اتسجلت النهارده — بعد التشغيل السكانر بس هو اللي بيسجّل (صفحة n8n بتعلّم من غير ما المخزون يرجع).',
  ret_transit:      'مرتجعات J&T لسه راجعة ومش مع المندوب — مرحلتها جنب كل واحد.',
  unknown:          'بوالص J&T مش متسجلة في سهل (غالباً استبدال من داشبورد J&T) اتسجّل عليها «المنتج اللي رجع» يدوي — آخر 30 يوم. لو اتسجّلت غلط اتراجع. ولو البوليصة بقى ليها أوردر، السكانر هيوقّف لحد ما تتراجع هنا.',
  in_delivered:     'اتضربت مرتجع في المخزن وبعدها J&T سلّمتها للعميل — يعني السكان كان غلط (F9 على طرد رايح) والقطع اتضافت للمخزن وهي عند العميل. اتراجع عن السكان.',
  leak:             'J&T استلمتها ومحدش ضربها خروج (بعد ما السكان اشتغل). خصمها بإيدك لو خرجت فعلاً — اللي عليها «🧮» اتعمل جرد بعدها، فالمنتج اللي اتعدّ فيه مش هيتخصم تاني (الجرد شاله).'
};

function rowsFor(k){
  if(k === 'unknown') return whUnk || [];
  if(k.indexOf('ret_') === 0){
    var R = (whBoard && whBoard.returns) || {};
    var v = R[k.slice(4)];
    return Array.isArray(v) ? v : [];
  }
  var L = (whBoard && whBoard.lists) || {};
  return Array.isArray(L[k]) ? L[k] : [];
}

// البوليصة بآخر 5 أرقام بارزين (هما اللي بيتكتبوا بالإيد على الباب — زي صفحة n8n)
function wbHtml(t){
  t = String(t || '');
  return '<span class="wh-ltr wh-wb" dir="ltr">' + esc(t.slice(0, -5)) + '<b>' + esc(t.slice(-5)) + '</b></span>';
}
function money(n){ var v = Number(n); return isFinite(v) && v > 0 ? v.toLocaleString('en-US') + ' ج' : ''; }

function renderList(){
  var el = $id('wh-lists'); if(!el || !whBoard) return;
  var rows = rowsFor(whList);
  var h = '<div class="wh-hint">' + esc(WH_LIST_HINT[whList] || '') + '</div>';
  if(!rows.length){ el.innerHTML = h + '<div class="wh-empty">مفيش حاجة هنا ✓</div>'; return; }
  h += '<div class="wh-rows">';
  var lim = Math.min(rows.length, 300);
  for(var i = 0; i < lim; i++) h += rowHtml(whList, rows[i]);
  h += '</div>';
  if(rows.length > lim) h += '<div class="wh-hint">بيعرض ' + lim + ' من ' + rows.length + '.</div>';
  el.innerHTML = h;
}

function rowHtml(k, x){
  var base = '<span class="wh-row-t">' + ltr(x.t || '') + '</span>'
    + (x.uid ? '<span class="wh-row-uid">#' + esc(x.uid) + '</span>' : '')
    + (x.n ? '<span class="wh-row-n">' + esc(x.n) + '</span>' : '')
    + (x.items ? '<span class="wh-row-items">' + esc(x.items) + '</span>' : '');
  var meta = '', acts = '', cls = '';
  if(k.indexOf('ret_') === 0){
    base = '<span class="wh-row-t">' + wbHtml(x.t) + '</span>'
      + (x.uid ? '<span class="wh-row-uid">#' + esc(x.uid) + '</span>' : '')
      + (x.items ? '<span class="wh-row-items">' + esc(x.items) + '</span>' : '')
      + (money(x.cod) ? '<span class="wh-row-by">' + ltr(money(x.cod)) + '</span>' : '');
    if(k === 'ret_courier'){
      meta = '<span class="wh-row-by">مع المندوب ' + esc(whDayTime(x.at)) + '</span>'
        + (x.done ? '<span class="wh-row-ok">✅ اتسجل</span>' : '<span class="wh-row-old">⏳ لسه</span>')
        + (x.n8n ? '<span class="wh-row-old">⚠️ متسجّل في صفحة n8n بس — اضربه هنا عشان يرجع المخزن</span>' : '');
    } else if(k === 'ret_missing'){
      meta = '<span class="wh-row-old">J&amp;T قفلته ' + esc(whDayTime(x.at)) + '</span>'
        + (x.fresh ? '<span class="wh-row-by">من أقل من نص ساعة</span>' : '')
        + (x.n8n ? '<span class="wh-row-old">⚠️ متسجّل في صفحة n8n بس — اضربه هنا عشان يرجع المخزن</span>' : '');
    } else if(k === 'ret_scanned'){
      meta = '<span class="wh-row-ok">اتسجل ' + esc(whTime(x.at)) + '</span>' + (x.by ? '<span class="wh-row-by">' + esc(x.by) + '</span>' : '');
    } else if(k === 'ret_transit'){
      meta = '<span class="wh-row-old">' + esc(x.s || 'في الطريق') + '</span>' + (x.at ? '<span class="wh-row-by">' + esc(whDayTime(x.at)) + '</span>' : '')
        + (x.n8n ? '<span class="wh-row-old">⚠️ متسجّل في صفحة n8n بس</span>' : '');
    }
  } else if(k === 'today'){
    var t = whText(x.code);
    cls = ' tone-' + (x.tone || (x.applied ? 'ok' : 'stop'));
    base = '<span class="wh-row-time">' + esc(whTime(x.at)) + '</span><span class="wh-row-c">' + esc(t[0]) + '</span>'
      + (x.uid ? '<span class="wh-row-uid">#' + esc(x.uid) + '</span>' : '') + (x.t ? '<span class="wh-row-t">' + ltr(x.t) + '</span>' : '');
    meta = '<span class="wh-row-by">' + esc(x.by || '') + '</span>' + (x.reversed ? '<span class="wh-row-rev">↶ اتلغى</span>' : '');
    var fresh = x.at && (Date.now() - new Date(x.at).getTime()) < WH_UNDO_MIN * 60000;
    if(x.applied && !x.reversed && (x.dir === 'out' || x.dir === 'in') && ((x.mine && fresh) || isAdminUser())){
      acts = '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wh-act="undo" data-scan="' + esc(String(x.id)) + '"'
        + (x.code === 'unknown_in' ? ' data-kind="unknown"' : '') + '>↶ تراجع</button>';
    }
  } else if(k === 'unknown'){
    var li = (Array.isArray(x.lines) ? x.lines : []).map(function(l){ return (l.product_name || l.text || '') + (l.qty > 1 ? ' ×' + l.qty : ''); }).join(' · ');
    cls = x.reversed ? ' is-rev' : '';
    base = '<span class="wh-row-t">' + wbHtml(x.t) + '</span>' + (li ? '<span class="wh-row-items">' + esc(li) + '</span>' : '');
    meta = '<span class="wh-row-by">' + esc(whDayTime(x.at)) + (x.by ? ' · ' + esc(x.by) : '') + '</span>'
      + (x.reversed ? '<span class="wh-row-rev">↶ اتلغى' + (x.reversed_by ? ' · ' + esc(x.reversed_by) : '') + '</span>' : '');
    var fr = x.at && (Date.now() - new Date(x.at).getTime()) < WH_UNDO_MIN * 60000;
    if(!x.reversed && ((x.mine && fr) || isAdminUser())){
      acts = '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wh-act="undo" data-kind="unknown" data-scan="' + esc(String(x.id)) + '">↶ تراجع</button>';
    }
  } else if(k === 'in_delivered'){
    meta = '<span class="wh-row-by">اتضرب مرتجع ' + esc(whDayTime(x.at)) + '</span><span class="wh-row-old">J&amp;T سلّمته ' + esc(whDayTime(x.del_at)) + '</span>';
    if(isAdminUser() && x.scan){
      acts = '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wh-act="undo" data-scan="' + esc(String(x.scan)) + '">↶ تراجع عن السكان</button>';
    }
  } else if(k === 'not_scanned'){
    meta = '<span class="wh-row-by">' + (x.printed ? 'اتطبعت ' + esc(whDayTime(x.printed)) : 'لسه مااتطبعتش') + '</span>' + (x.old ? '<span class="wh-row-old">من قبل النهارده</span>' : '');
  } else if(k === 'pile' || k === 'pull'){
    meta = '<span class="wh-row-by">خرج ' + esc(whDayTime(x.at)) + (x.by ? ' · ' + esc(x.by) : '') + '</span>'
      + (x.stale ? '<span class="wh-row-old">أكتر من 30 ساعة</span>' : '') + (k === 'pull' ? '<span class="wh-row-old">' + (x.cancelled ? 'اتلغى' : 'طالب إلغاء') + '</span>' : '');
  } else if(k === 'leak'){
    meta = '<span class="wh-row-by">J&amp;T استلمتها ' + esc(whDayTime(x.jt_at)) + '</span>' + (x.cancelled ? '<span class="wh-row-old">ملغي عندنا</span>' : '')
      + (x.counted ? '<span class="wh-row-ok" title="جرد اتفتح بعد ما J&amp;T استلمتها وعدّ كل منتجاتها — «اخصمه» مش هيخصم حاجة (الجرد شالها خلاص)">🧮 اتعمل جرد بعدها</span>'
        : x.counted_some ? '<span class="wh-row-old" title="جرد اتفتح بعد ما J&amp;T استلمتها وعدّ جزء من منتجاتها بس — «اخصمه» بيخصم الباقي">🧮 جزء من منتجاتها اتعدّ</span>' : '');
    if(isAdminUser() && x.id){
      acts = '<button type="button" class="wh-btn wh-btn-sm" data-wh-act="leak-out" data-oid="' + esc(x.id) + '">📦 اخصمه</button>'
        + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-wh-act="leak-dismiss" data-oid="' + esc(x.id) + '">✖ مش محتاج خصم</button>';
    }
  }
  return '<div class="wh-row' + cls + '">' + base + '<span class="wh-row-meta">' + meta + '</span>' + (acts ? '<span class="wh-row-acts">' + acts + '</span>' : '') + '</div>';
}

function whLeakAct(oid, dir){
  if(!oid || !sb || !isAdminUser()) return;
  var out = dir === 'out';
  showModal({ icon: out ? '📦' : '✖', title: out ? 'اخصم الطرد ده من المخزن؟' : 'الطرد ده مش محتاج خصم؟',
    sub: out ? 'بيتخصم كأنه اتضرب خروج — اكتب السبب (مثلاً: اتسلّم للمندوب من غير سكان).' : 'مش هيتخصم من المخزن ومش هيظهر هنا تاني. اكتب السبب.',
    okLabel: out ? 'اخصمه' : 'اقفله', input: true, placeholder: 'السبب',
    onOk: function(reason){
      var gen = whCardGen;
      sb.rpc('wh_scan_order', { p_order_id: oid, p_dir: out ? 'out' : 'dismiss_leak', p_client_id: whUuid(), p_reason: reason }).then(function(r){
        var res = (r && !r.error && r.data) || { code: 'error', tone: 'stop' };
        if(res.code === 'busy') res = Object.assign({}, res, { code: 'busy_manual' });
        if(gen === whCardGen) renderCard(res);
        else toast(whText(res.code)[0], res.ok ? 'ok' : 'er');
        whSound(null, whTone(res));
        if(res.ok && res.applied) scheduleBoard(300);
        else if(!res.ok && gen === whCardGen) toast(whText(res.code)[0], 'er');
      });
    } });
}

// ── الصوت (زرار 🔔 في الصفحة) ───────────────────────────────────────
function renderSoundBtn(){
  var b = $id('wh-sound'); if(!b) return;
  var on = scanSoundOn();
  b.textContent = on ? '🔔' : '🔕';
  b.classList.toggle('is-off', !on);
  b.title = on ? 'أصوات السكانر شغّالة على الجهاز ده — اضغط تكتمها' : 'أصوات السكانر مكتومة على الجهاز ده — اضغط تشغّلها';
}

// ── التابات (السكان · ربط المنتجات · الجرد) ─────────────────────────
function setTab(t){
  if(t !== 'scan' && !isAdminUser()) t = 'scan';
  whTab = t;
  var page = $id('page-warehouse'); if(page) page.setAttribute('data-tab', t);
  document.querySelectorAll('#page-warehouse .wh-tab[data-wh-tab]').forEach(function(b){
    b.classList.toggle('on', b.getAttribute('data-wh-tab') === t);
  });
  if(t === 'scan') setTimeout(focusInput, 30);
  else { whAdminRender(whBoard, t); if(t === 'count') whSoundsRender(); }
}

// ── سكانات جلسة تانية على نفس الجهاز ─────────────────────────────────
// الطابور بمفتاح المستخدم: الجلسة خلصت والسكانات لسه ماتبعتتش، ودخل موظف تاني = سكاناته مستخبية للأبد.
// بنقول عليها ونبعتها بضغطة (بنفس الـclient_id — اللي كان وصل السيرفر بيرجع نتيجته من غير تكرار).
function orphanQueues(){
  var mine = queueKey(), out = [];
  try{
    for(var i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i);
      if(!k || k.indexOf('sahl_wh_queue_') !== 0 || k === mine) continue;
      var q = [];
      try{ q = JSON.parse(localStorage.getItem(k) || '[]'); }catch(e2){ q = []; }
      q = Array.isArray(q) ? q.filter(function(it){ return it && it.cid && it.code; }) : [];
      if(q.length) out.push({ k: k, q: q });
    }
  }catch(e){ swallow('warehouse/orphans', e); }
  return out;
}
function renderOrphans(){
  var el = $id('wh-orphan'); if(!el) return;
  var n = 0;
  orphanQueues().forEach(function(x){ n += x.q.length; });
  if(!n){ el.hidden = true; el.innerHTML = ''; return; }
  el.innerHTML = '📥 فيه <b>' + n + '</b> سكان على الجهاز ده من جلسة تانية (موظف تاني أو جلسة خلصت) لسه ماتبعتوش. '
    + '<button type="button" class="wh-btn wh-btn-sm" data-wh-act="orphans-send">📤 ابعتهم دلوقتي</button>';
  el.hidden = false;
}
function sendOrphans(){
  var have = {}, added = 0;
  whQueue.forEach(function(it){ have[it.cid] = 1; });
  orphanQueues().forEach(function(x){
    x.q.forEach(function(it){ if(!have[it.cid] && !whDone[it.cid]){ whQueue.push(it); have[it.cid] = 1; added++; } });
    try{ localStorage.removeItem(x.k); }catch(e){ swallow('warehouse/orphans-rm', e); }
  });
  queueSave();
  renderQueueState();
  renderOrphans();
  pumpQueue();
  toast(added ? 'اتضافوا للطابور: ' + added + ' سكان — هيتسجّلوا باسمك' : 'مفيش سكانات جديدة', 'ok');
}

// ── 📷 صوّر الباركود (الموبايل على الباب — زي «صوّر الليبل» في صفحة n8n) ──────────────────────────
// مش مدعوم (آيفون · كروم ديسكتوب) والجهاز موبايل = سطر «اكتب آخر 5 أرقام» تحت الخانة (كان الزرار بيختفي من غير أي إشارة)
// من غير أي خدمة بره: `BarcodeDetector` بتاع المتصفح (أندرويد كروم). مش موجود (آيفون) = الزرار مايبانش، والموظف
// بيكتب آخر 5 أرقام. أكتر من بوليصة في الصورة = كلهم بيتسجّلوا ورا بعض (كل واحدة سكان لوحدها في الطابور).
export function whCamCodes(found){
  var seen = {}, out = [];
  (Array.isArray(found) ? found : []).forEach(function(x){
    var w = parseWaybill((x && x.rawValue) || '');
    if(w.kind === 'jt' && !seen[w.code]){ seen[w.code] = 1; out.push(w.code); }
  });
  return out;
}
function camInit(){
  var b = $id('wh-cam'), inp = $id('wh-cam-in');
  if(!b || !inp) return;
  // الزرار بيبان بس لو المتصفح بيقرا Code128 فعلاً — كروم الديسكتوب (ويندوز/لينكس) عنده الكلاس من غير أي صيغة
  b.hidden = true;
  var hint = $id('wh-cam-hint');
  var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var setOk = function(ok){ b.hidden = !ok; if(hint) hint.hidden = ok || !touch; };
  var BD = window.BarcodeDetector;
  if(typeof BD !== 'function' || typeof BD.getSupportedFormats !== 'function'){ setOk(false); }
  else Promise.resolve(BD.getSupportedFormats()).then(function(f){
    setOk(Array.isArray(f) && f.indexOf('code_128') >= 0);
  }, function(){ setOk(false); });
  inp.addEventListener('change', function(){
    var f = inp.files && inp.files[0];
    inp.value = '';
    if(f) camRead(f);
  });
}
function camRead(f){
  var det;
  try{ det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code'] }); }
  catch(e){ toast('الموبايل ده مايقدرش يقرا الباركود من الصورة — اكتب آخر 5 أرقام من البوليصة', 'er'); return; }
  Promise.resolve(window.createImageBitmap ? window.createImageBitmap(f) : null).then(function(img){
    if(!img) throw new Error('no_bitmap');
    return det.detect(img);
  }).then(function(found){
    var codes = whCamCodes(found);
    if(!codes.length){ toast('مالقيتش بوليصة J&T في الصورة — قرّب الموبايل أو اكتب آخر 5 أرقام', 'er'); whSound(null, 'stop'); return; }
    unlockAudio();
    codes.forEach(function(c){ whEnqueue(c, { src: 'manual', raw: 'photo' }); });
    if(codes.length > 1) toast('📷 لقيت ' + codes.length + ' بوالص في الصورة — بيتسجّلوا ورا بعض', 'ok');
  }).catch(function(e){ swallow('warehouse/cam', e); toast('مقدرناش نقرا الصورة — جرّب تاني أو اكتب آخر 5 أرقام', 'er'); });
}

// ── الدخول للصفحة ────────────────────────────────────────────────────
export function loadWarehouse(){
  if(tourActive){ veilDone('warehouse'); return; }
  if(!sb || !currentTenantId){ veilDone('warehouse'); return; }
  // الطابور اتحمّل وقت الإقلاع — بيتحمّل تاني بس لو المستخدم اتغيّر أو مفيش حاجة في السكة
  if(queueKey() !== whQueueFor || (!whBusy && !whQueue.length)) queueLoad();
  renderQueueState();
  renderOrphans();
  renderSoundBtn();
  renderLog();
  renderAttn();
  setTab(whTab === 'scan' || isAdminUser() ? whTab : 'scan');
  loadBoard();
  whLoadSounds(false);
  if(whQueue.length) pumpQueue();
  setTimeout(focusInput, 60);
}

function onClick(e){
  var t = e.target.closest ? e.target.closest('[data-wh-act],[data-wh-list],[data-wh-tab]') : null;
  if(!t) { if(whTab === 'scan' && !(e.target.closest && e.target.closest('input,select,textarea,button,a'))) focusInput(); return; }
  var l = t.getAttribute('data-wh-list');
  if(l){ whList = l; renderRet(); renderChips(); renderList(); focusInput(); return; }
  var tb = t.getAttribute('data-wh-tab');
  if(tb){ setTab(tb); return; }
  var a = t.getAttribute('data-wh-act');
  // 🔴 دبل كليك: الضغطة الأولى بتشيل الصف والقايمة بتطلع لفوق — التانية كانت بتقع على الصف اللي بعده
  // (تقفل تحذير «ملغي» أو تفرض طرد تاني). الضغطة التانية من نفس الدبل كليك بتترمي.
  if(e.detail > 1 && /^(force-in|force-out|attn-ok|attn-clear|ship-anyway|undo|leak-out|leak-dismiss|pick|orphans-send|unk-open)$/.test(a)) return;
  if(a === 'force-in') whForce('in', t.getAttribute('data-attn'));
  else if(a === 'force-out') whForce('out', t.getAttribute('data-attn'));
  else if(a === 'attn-ok') attnOk(t.getAttribute('data-attn'));
  else if(a === 'attn-clear'){ var keep = whCard && whCard.attnId; whAttn = whAttn.filter(function(x){ return x.id === keep; }); renderAttn(); }
  else if(a === 'orphans-send') sendOrphans();
  else if(a === 'ship-anyway') whShipAnyway();
  else if(a === 'undo') whUndo(t.getAttribute('data-scan'), t.getAttribute('data-kind'));
  else if(a === 'unk-open'){ unlockAudio(); unkOpen(t.getAttribute('data-code')); return; }
  else if(a === 'pick'){ var c = t.getAttribute('data-code'); if(c){ unlockAudio(); whEnqueue(c, { src: 'manual' }); } }
  else if(a === 'leak-out') whLeakAct(t.getAttribute('data-oid'), 'out');
  else if(a === 'leak-dismiss') whLeakAct(t.getAttribute('data-oid'), 'dismiss');
  else if(a === 'reload-board') loadBoard();
  else if(a === 'sound'){ var on = !scanSoundOn(); setScanSound(on); if(on){ unlockAudio(); playScanTone('ok'); } renderSoundBtn(); }
  else if(a === 'focus') focusInput(true);
  else if(a === 'cam'){ var ci = $id('wh-cam-in'); if(ci) ci.click(); return; }
  if(whTab === 'scan' && a !== 'undo' && a !== 'ship-anyway' && a !== 'leak-out' && a !== 'leak-dismiss') focusInput();
}

// نتيجة التسجيل بتمشي زي أي سكان (الكارت · السجل · «وصل» · القوايم)
function unkOpen(code){
  whUnknownOpen(code, function(res){
    onResult({ cid: 'unk', code: code }, res);
    if(res && res.applied) setTimeout(loadUnknown, 400);
  });
}

function renderFocus(){
  var el = $id('wh-focus'); if(!el) return;
  var inp = $id('wh-input');
  var ready = document.hasFocus && document.hasFocus() && inp && document.activeElement === inp;
  el.className = 'wh-focus' + (ready ? ' is-ready' : ' is-lost');
  el.textContent = ready ? '🎯 جاهز — اضرب البوليصة' : '⚠️ اضغط هنا الأول — السكانر مش هيكتب في الصفحة دي دلوقتي';
}

export function initWarehouse(){
  var page = $id('page-warehouse');
  if(!page) return;
  queueLoad();
  page.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown, true);
  var inp = $id('wh-input');
  if(inp){
    inp.addEventListener('focus', renderFocus);
    inp.addEventListener('blur', function(){ setTimeout(renderFocus, 0); });
  }
  window.addEventListener('focus', function(){ renderFocus(); if(whPageVisible()) setTimeout(focusInput, 30); });
  window.addEventListener('blur', renderFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener('storage', function(e){
    if(e.key === 'sahl_wh_sound') renderSoundBtn();
    else if(e.key && e.key.indexOf('sahl_wh_queue_') === 0) renderOrphans();
  });
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && whPageVisible()){
      if(Date.now() - whBoardAt > WH_BOARD_MS) loadBoard();
      whLoadSounds(false);
      setTimeout(focusInput, 30);
    }
  });
  setInterval(function(){
    if(whPageVisible() && Date.now() - whBoardAt >= WH_BOARD_MS - 500) loadBoard();
  }, WH_BOARD_MS);
  whAdminInit({ reloadBoard: loadBoard, setTab: setTab, enqueue: whEnqueue,
                pending: function(){ return whQueue.length + orphanQueues().reduce(function(n, x){ return n + x.q.length; }, 0); } });
  camInit();
  whSoundsInit();
  renderSoundBtn();
  renderFocus();
}

// للهارنس: حالة داخلية للقراية بس
export function whDebugState(){
  return { queue: whQueue.slice(), log: whLog.slice(), board: whBoard, list: whList, tab: whTab, busy: whBusy, netFails: whNetFails,
           attn: whAttn.map(function(a){ return { id: a.id, code: a.code, res: a.res.code }; }), cardGen: whCardGen };
}
