// تاب «استثناءات الشحن» (8 أكتوبر — طلب المالك): كل مسح استثناء من J&T بينزل لوحده، والموظف
// بيختار «الحقيقة إيه؟» ويكتب «عملت إيه؟».
//
// على السيرفر: jt_issues + التريجر + v_jt_issues + jt_issue_save (اتفحصوا بـdo $verify$ جوّه ملف
// الـSQL نفسه — savepoint بيترجع). هنا الواجهة بس (الستب — من غير شبكة):
//  1–2)  الشارة على الزرار من استعلام خفيف + الريل-تايم على قناة **لوحدها** (مش قناة الأوردرات)
//  3–6)  الصفحة: اللينك والعنوان · طابور «محتاجة متابعة» بالترتيب (الأقدم فوق) · الكروت · الشرايح
//  7–10) محتوى الكارت: أرقام بـtel · صورة المندوب (منتهية/javascript: = مفيش لينك) · XSS · رجوع من غير سبب
//  11–14) الفلاتر: الشرايح · الفترة · البحث · السبب · التصنيف
//  15–19) الحفظ: الاختيار بيتحفظ فوراً · الملاحظة على الـblur · Ctrl+Enter · رفض السيرفر · الكتابة ماتضيعش مع الريل-تايم
//  20–22) الشات: تاب المحادثات بتفتح على العميل (حتى لو أقدم من الـ200) · نفس التاب على الموبايل · رقم مالوش محادثة
//  23–28) الداتابيز لسه ماتطبّقتش · التصدير (BOM + injection + أرقام) · التقرير · الموبايل · الليلي · الموظف · المزامنة التدريجية
//  32–41) v70 — المراحل: الأدمن بيفتح على «مستنية مراجعتك» · المترجّعة فوق «محتاجة تعامل» · سطر «مين/إمتى/اختار إيه»
//         · ✓ تمام (بالـrev اللي شافه) · ↩️ رجّعها (مودال + تعليق) · stale · الموظف مالوش أزرار مراجعة
//         · تعديل بعد المراجعة = رجعت للطابور · السجل · «اتراجعت — تابع النتيجة» · الفلاتر المخفية مابتقصّش الطوابير
//
// المعايرات (لازم تقع على الكود المحقون — كل واحدة بحارس «المرساة اتلقت»):
//  (أ) شيل «اتصنّفت محاولة أحدث» → (ب) شيل حالة الأوردر من النتيجة → (ج) شيل esc من ملاحظة المندوب
//  (د) الجدول على قناة الأوردرات → (هـ) الرسم بيدوس على الكتابة → (و) قاعدة wa_id غلط
//  (ز) شيل فحص انتهاء الصورة → (ح) شيل حارس CSV injection → (ط) الطابور بيتقيّد بالفترة
//  (م) شيل قاعدة «المترجّعة» من jxNeedsFollow → (ن) p_seen_rev مابيتبعتش → (س) أزرار المراجعة للموظف
//  (ع) فلتر السبب بيتطبّق في الطابور → (ف) الحفظ مابيطبّقش رد السيرفر (المراجعة)
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';
const NOW_ISO = process.env.CLOCK || '2026-10-15T10:00:00Z';   // 13:00 القاهرة — «النهارده» محدد
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ── الفيكستشر: بشكل صف v_jt_issues بالحرف (attempt وأعمدة الأوردر بيحسبهم الفيو على السيرفر) ──
// مفتوح متوقّع = {11, 4, 6, 12, 1, 2} (الأقدم فوق). 9 اتغطّى بتصنيف 10 (محاولة أحدث) · 7 اتلغى عندنا ·
// 8 الأوردر متعلّم متسلّم · 5 راجعة من 10 أيام · 15 بره نافذة الـ30 يوم (مايتحمّلش أصلاً).
const FIX = `(function(){
  var now = Date.now(), H = 3600000, D = 86400000;
  var ago = function(ms){ return new Date(now - ms).toISOString(); };
  var fut = new Date(now + 3 * D).toISOString().replace(/\\.\\d+Z$/, 'Z');
  var past = new Date(now - 2 * D).toISOString().replace(/\\.\\d+Z$/, 'Z');
  var base = { tenant_id:'t-test-1', kind:'exception', reason_code:'202', reason_en:'No Answer or Phone Switched Off',
    reason_ar:'العميل مش بيرد أو تليفونه مقفول', courier_note:null, branch:'Nasr City', branch_phone:'0223456789',
    courier_name:'محمد علي', courier_phone:'01011112222', photo_url:null, verdict:null, staff_note:null,
    staff_updated_at:null, verdict_by_name:null, outcome:null, outcome_at:null, attempt:1, order_uid:'9001', order_id:'o1',
    verdict_by:null, staff_rev:0, reviewed_rev:null, review_state:null, review_note:null, reviewed_at:null, reviewed_by_name:null,
    customer_name:'أحمد سامي', phone:'01000000001', alt_phone:null, city:'القاهره', address:'15 شارع التحرير',
    ship_prov:'القاهرة', ship_city:'مدينة نصر', ship_area:'الحي السابع', product_name:'منظم المطبخ (عدد 1)',
    total_cost:1450, jt_cod_amount:1450, order_status:'Exception' };
  var mk = function(o){ var r = Object.assign({}, base, o); r.updated_at = r.updated_at || r.reviewed_at || r.staff_updated_at || r.event_at;
    if(r.verdict && r.verdict_set_by_name === undefined){ r.verdict_set_by_name = r.verdict_by_name; r.verdict_set_at = r.staff_updated_at; } return r; };
  window.__JT_ISSUES = [
    mk({ id:1, tracking_no:'JEG001', event_at:ago(2*H), courier_note:'مش بيرد', photo_url:'https://jt.blob.core.windows.net/p/a.jpg?sv=1&se=' + encodeURIComponent(fut) + '&sig=x' }),
    mk({ id:2, tracking_no:'JEG001', attempt:2, event_at:ago(30*60000), reason_code:'205', reason_en:'Change The Delivery Time', reason_ar:'العميل طلب تأجيل' }),
    mk({ id:3, tracking_no:'JEG002', order_id:'o2', order_uid:'9002', customer_name:'منى', phone:'01000000002', event_at:ago(1*D),
         verdict:'fake_update', staff_note:'العميل قال محدش كلمه', verdict_by_name:'shekoz', staff_updated_at:ago(1*H),
         outcome:'delivered', outcome_at:ago(5*H), order_status:'Delivered',
         staff_rev:1, reviewed_rev:1, review_state:'self', reviewed_by_name:'shekoz', reviewed_at:ago(1*H) }),
    mk({ id:4, tracking_no:'JEG003', event_at:ago(3*D), outcome:'returning', outcome_at:ago(2*D), order_status:'Returned to business',
         order_id:'o4', order_uid:'9004', phone:'01000000004', customer_name:'كريم' }),
    mk({ id:5, tracking_no:'JEG004', event_at:ago(10*D), outcome:'returning', outcome_at:ago(9*D), order_status:'Returned to business',
         order_id:'o5', order_uid:'9005', phone:'01000000005' }),
    mk({ id:6, tracking_no:'JEG005', kind:'return', attempt:null, event_at:ago(1*D + 2*H), reason_code:null,
         reason_en:'Returned parcel scan without an exception', reason_ar:'بدأت ترجع من غير ما J&T تسجّل أي سبب',
         outcome:'returning', outcome_at:ago(1*D + 2*H), order_status:'Returned to business', order_id:'o6', order_uid:'9006', phone:'01000000006' }),
    mk({ id:7, tracking_no:'JEG006', event_at:ago(2*D), order_status:'cancelled', order_id:'o7', order_uid:'9007', phone:'01000000007' }),
    mk({ id:8, tracking_no:'JEG007', event_at:ago(5*H), order_status:'Delivered', order_id:'o8', order_uid:'9008', phone:'01000000008' }),
    mk({ id:9, tracking_no:'JEG008', event_at:ago(4*D), order_id:'o9', order_uid:'9009', phone:'01000000009' }),
    mk({ id:10, tracking_no:'JEG008', attempt:2, event_at:ago(1*D), verdict:'real_delay', staff_note:'قال بكرة', verdict_by_name:'ebrahim',
         staff_updated_at:ago(30*H), order_id:'o9', order_uid:'9009', phone:'01000000009', staff_rev:1 }),
    mk({ id:11, tracking_no:'JEG009', event_at:ago(20*D), order_id:'o11', order_uid:'9011', phone:'01000000011', customer_name:'قديم عالق' }),
    mk({ id:12, tracking_no:'JEG010', event_at:ago(6*H), courier_note:'<img src=x id="xss1" onerror="window.__XSS=1">',
         branch:'<b id="xss2">B</b>', courier_name:'<i id="xss3">c</i>', customer_name:'<u id="xss4">n</u>',
         order_id:'o12', order_uid:'9012', phone:'01000000012', photo_url:'javascript:window.__XSS=2' }),
    mk({ id:13, tracking_no:'JEG011', event_at:ago(7*H), photo_url:'https://jt.blob.core.windows.net/p/b.jpg?se=' + encodeURIComponent(past) + '&sig=y',
         order_id:'o13', order_uid:'9013', phone:'01000000013', verdict:'jt_error', staff_note:'=1+1', verdict_by_name:'shekoz', staff_updated_at:ago(2*H),
         staff_rev:1, reviewed_rev:1, review_state:'self', reviewed_by_name:'shekoz', reviewed_at:ago(2*H) }),
    // 16: ebrahim اتعامل والأدمن رجّعهاله بتعليق — فوق «محتاجة تعامل» (وتعليق فيه HTML عشان esc)
    mk({ id:16, tracking_no:'JEG012', event_at:ago(3*H), order_id:'o16', order_uid:'9016', phone:'01000000016', customer_name:'مترجّعة',
         verdict:'no_answer_us', staff_note:'اتصلت مرتين', verdict_by_name:'ebrahim', staff_updated_at:ago(150*60000), staff_rev:1,
         reviewed_rev:1, review_state:'sent_back', review_note:'كلّمه تاني بكرة <b id="xss5">x</b>', reviewed_by_name:'shekoz', reviewed_at:ago(2*H) }),
    // 17: ebrahim اتعامل والأدمن قال تمام — لسه مع J&T («اتراجعت — تابع النتيجة» فوق)
    mk({ id:17, tracking_no:'JEG013', event_at:ago(26*H), order_id:'o17', order_uid:'9017', phone:'01000000017', customer_name:'اتراجعت',
         verdict:'real_delay', staff_note:'قال السبت', verdict_by_name:'ebrahim', staff_updated_at:ago(20*H), staff_rev:1,
         reviewed_rev:1, review_state:'ok', reviewed_by_name:'shekoz', reviewed_at:ago(19*H) }),
    mk({ id:15, tracking_no:'JEG099', event_at:ago(40*D), order_id:'o15', order_uid:'9015', phone:'01000000015', customer_name:'بره النافذة' })
  ];
  // المحادثات: 210 — العميل 1 **أقدم واحدة** (بره أحدث 200) فالفتح لازم يجيبها من السيرفر بالرقم
  var cv = [];
  for(var i = 0; i < 209; i++) cv.push({ id:'cx' + i, tenant_id:'t-test-1', wa_id:'2011' + String(10000000 + i), customer_name:'عميل ' + i,
    customer_phone:'011' + String(10000000 + i), last_message_at:ago(i * 60000), last_direction:'in', last_inbound_at:ago(i * 60000), labels:[], unread_count:0 });
  cv.push({ id:'c-ahmed', tenant_id:'t-test-1', wa_id:'201000000001', customer_name:'أحمد سامي', customer_phone:'01000000001',
    last_message_at:ago(9 * D), last_direction:'in', last_inbound_at:ago(9 * D), labels:[], unread_count:0 });
  window.__WA_CONVOS = cv;
  window.__WA_MSGS = [];
  // سجل التعامل على 10: ebrahim كتب ملاحظة وبعدين صنّف
  window.__JT_LOG = [
    { id:1, tenant_id:'t-test-1', issue_id:10, at:ago(23*H), by_name:'ebrahim', actor_role:'employee', action:'save', verdict:null, note:'قال بكرة',
      prev_verdict:null, prev_note:null, verdict_changed:false, note_changed:true, review_state:null, review_note:null },
    { id:2, tenant_id:'t-test-1', issue_id:10, at:ago(22*H), by_name:'ebrahim', actor_role:'employee', action:'save', verdict:'real_delay', note:'قال بكرة',
      prev_verdict:null, prev_note:'قال بكرة', verdict_changed:true, note_changed:false, review_state:null, review_note:null },
    { id:3, tenant_id:'t-test-1', issue_id:3, at:ago(1*H), by_name:'shekoz', actor_role:'admin', action:'save', verdict:'fake_update', note:'x',
      prev_verdict:null, prev_note:null, verdict_changed:true, note_changed:true, review_state:null, review_note:null }
  ];
})();`;

const HOOK = `window.__SAVES = []; window.__REVIEWS = []; window.__PREF_SAVES = [];
window.__ALERTS = 0; window.addEventListener('sahl:alert', function(){ window.__ALERTS++; });
window.__RPC_HOOK = function(name, args){
  if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
  if(name === 'get_notify_prefs') return { data: Object.assign({}, window.__NOTIFY_PREFS || {}), error:null };
  if(name === 'update_notify_prefs'){ window.__PREF_SAVES.push(args); window.__NOTIFY_PREFS = Object.assign({}, window.__NOTIFY_PREFS || {}, args.p_prefs); return { data: window.__NOTIFY_PREFS, error:null }; }
  var isAdmin = (window.__ROLE || 'admin') === 'admin';
  var pick = function(r){ var o = {}; ['id','verdict','staff_note','staff_updated_at','verdict_by_name','verdict_set_by_name','verdict_set_at','reported_at','staff_rev','reviewed_rev','review_state','review_note','reviewed_at','reviewed_by_name','updated_at'].forEach(function(k){ o[k] = r[k] === undefined ? null : r[k]; }); return o; };
  if(name === 'jt_issue_review'){
    window.__REVIEWS.push(args);
    if(!isAdmin) return { data:null, error:{ code:'42501', message:'not_allowed' } };
    var x = window.__JT_ISSUES.find(function(y){ return y.id === args.p_id; });
    if(!x) return { data:null, error:{ code:'P0002', message:'not_found' } };
    if(window.__REVIEW_STALE){ x.staff_rev = (x.staff_rev || 0) + 1; x.staff_note = 'عدّلها الموظف'; x.updated_at = new Date().toISOString(); var o0 = pick(x); o0.stale = true; return { data:o0, error:null }; }
    if(args.p_action === 'sent_back' && !String(args.p_note || '').trim()) return { data:null, error:{ code:'22023', message:'note_required' } };
    var nw = new Date().toISOString();
    if(args.p_action === 'undo'){ x.reviewed_rev = null; x.review_state = null; x.review_note = null; x.reviewed_at = null; x.reviewed_by_name = null; }
    else { x.reviewed_rev = x.staff_rev; x.review_state = args.p_action; x.review_note = args.p_action === 'sent_back' ? args.p_note : null; x.reviewed_at = nw; x.reviewed_by_name = 'أدمن الاختبار'; }
    x.updated_at = nw;
    var o1 = pick(x); o1.stale = false; return { data:o1, error:null };
  }
  if(name !== 'jt_issue_save') return null;
  window.__SAVES.push(args);
  if(window.__SAVE_FAIL) return { data:null, error:{ code:'22023', message:'bad_verdict' } };
  var r = window.__JT_ISSUES.find(function(x){ return x.id === args.p_id; });
  if(!r) return { data:null, error:{ code:'P0002', message:'not_found' } };
  // نفس قواعد السيرفر: تغيير فعلي = staff_rev+1 · الأدمن بتصنيف = «اتعامل بنفسه» · الموظف = المراجعة القديمة بتفضل
  var apply = function(){
    if((r.verdict || null) !== (args.p_verdict || null) || (r.staff_note || null) !== (args.p_note || null)){
      var me = isAdmin ? 'أدمن الاختبار' : 'موظف الاختبار', vchg = (r.verdict || null) !== (args.p_verdict || null);
      var self = vchg || r.verdict_set_by_name === me;
      var REP = ['fake_update', 'jt_error'], wasRep = REP.indexOf(r.verdict) >= 0, isRep = REP.indexOf(args.p_verdict) >= 0;
      var repAt = isRep ? (wasRep ? (r.reported_at || r.verdict_set_at || new Date().toISOString()) : new Date().toISOString()) : null;
      r.verdict = args.p_verdict; r.staff_note = args.p_note; r.reported_at = repAt;
      r.staff_updated_at = new Date().toISOString(); r.updated_at = r.staff_updated_at;
      r.verdict_by_name = me;
      if(vchg){ r.verdict_set_by_name = r.verdict ? me : null; r.verdict_set_at = r.verdict ? r.staff_updated_at : null; }
      r.staff_rev = (r.staff_rev || 0) + 1;
      if(isAdmin && r.verdict){ r.reviewed_rev = r.staff_rev; r.review_state = self ? 'self' : 'ok'; r.review_note = null; r.reviewed_at = r.staff_updated_at; r.reviewed_by_name = me; }
    }
    return { data:pick(r), error:null };
  };
  // حفظ «في السكة»: الرد بيتأخر — عشان سباق «غيّر ورجع قبل ما الحفظ يرجع» يتقاس
  if(window.__SAVE_DELAY) return new Promise(function(res){ setTimeout(function(){ res(apply()); }, window.__SAVE_DELAY); });
  return apply();
};`;

const FILES = { exc: '../app/js/exceptions/exceptions.js', inbox: '../app/js/inbox/inbox.js' };
const ROUTE = { exc: '**/js/exceptions/exceptions.js', inbox: '**/js/inbox/inbox.js' };

async function open(path, o){
  o = o || {};
  const ctx = await b.newContext({ viewport: o.viewport || { width: 1440, height: 1000 }, acceptDownloads: true });
  if(!process.env.CLOCK) await ctx.clock.setFixedTime(new Date(NOW_ISO));
  if(o.role) await ctx.addInitScript(`window.__ROLE = '${o.role}';`);
  if(o.pre) await ctx.addInitScript(o.pre);
  await ctx.addInitScript(STUB);
  await ctx.addInitScript(FIX);
  await ctx.addInitScript(HOOK);
  if(o.post) await ctx.addInitScript(o.post);
  for(const k of Object.keys(o.patches || {})){
    const src = fs.readFileSync(new URL(FILES[k], import.meta.url), 'utf8');
    const out = o.patches[k](src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة: ' + k);
    await ctx.route(ROUTE[k], r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  const p = await ctx.newPage();
  p.__errs = [];
  p.on('pageerror', e => p.__errs.push(e.message));
  await p.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  await p.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await p.waitForTimeout(250);
  // الأدمن بيفتح على «مستنية مراجعتك» لما فيها حاجة — الفحوص اللي على الطابور بتروح «محتاجة تعامل» الأول
  if(o.stage && /\/exceptions$/.test(path)){
    await p.waitForSelector('#jx-list .jx-card, #jx-list .empt', { timeout: 8000 }).catch(() => {});
    await p.click('#jx-chips [data-jx-chip="' + o.stage + '"]');
    await p.waitForTimeout(150);
  }
  return { p, ctx };
}

async function gotoExceptions(p){
  await p.click('#nav-exceptions');
  await p.waitForFunction(() => { const l = document.getElementById('jx-list'); return l && (l.querySelector('.jx-card') || l.querySelector('.empt')); }, null, { timeout: 8000 });
  await p.waitForTimeout(150);
}

const cardIds = (p) => p.evaluate(() => [...document.querySelectorAll('#jx-list .jx-card')].map(c => Number(c.dataset.id)));
const txt = (p, id) => p.evaluate(i => { const el = document.getElementById(i); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, id);
async function chip(p, k){ await p.click('#jx-chips [data-jx-chip="' + k + '"]'); await p.waitForTimeout(120); }
async function days(p, v){ await p.selectOption('#jx-fdays', String(v)); await p.waitForTimeout(150); }

// ═══ التشغيل الأساسي ═══
console.log('— الشارة والقناة');
const M = await open('/orders');
let p = M.p;
await p.waitForTimeout(400);
const badge0 = await p.evaluate(() => { const b = document.getElementById('jx-nav-badge'); return b ? { shown: getComputedStyle(b).display !== 'none', t: b.textContent } : null; });
ok(badge0 && badge0.shown && badge0.t === '7', '1) شارة «استثناءات الشحن» على الزرار = 7 (6 + المترجّعة للموظف) من الاستعلام الخفيف (قبل فتح الصفحة) — ' + JSON.stringify(badge0));
const badge2 = await p.evaluate(() => { const b = document.getElementById('jx-nav-badge2'); return b ? { shown: getComputedStyle(b).display !== 'none', t: b.textContent } : null; });
ok(badge2 && badge2.shown && badge2.t === '1', '1ج) الشارة الزرقا للأدمن = 1 مستنية مراجعته (10 — ebrahim) — ' + JSON.stringify(badge2));
// (الاستعلام الأساسي = اللي بـgte على event_at — جنبه استعلام «القديم اللي لسه محتاج حد» بـlt + keep_loaded)
const q1 = await p.evaluate(() => (window.__calls || []).filter(c => c.table === 'v_jt_issues').map(c => ({ cols: c.cols, f: c.f }))
  .filter(c => (c.f || []).some(f => f.op === 'gte' && f.col === 'event_at')));
ok(q1.length >= 1 && q1[0].cols.indexOf('staff_note') < 0 && q1[0].f.some(f => f.op === 'eq' && f.col === 'tenant_id') && q1[0].f.some(f => f.op === 'gte' && f.col === 'event_at'),
  '1ب) استعلام الشارة خفيف (من غير الملاحظات/العناوين) ومتقيّد بالمتجر والنافذة');
const rt = await p.evaluate(() => (window.__RT_ON || []).filter(h => h.opts && h.opts.table === 'jt_issues').map(h => h.channel));
ok(rt.length === 1 && /^jt-issues-/.test(rt[0]), '2) الريل-تايم على jt_issues في قناة **لوحدها** (مش قناة الأوردرات) — ' + JSON.stringify(rt));

console.log('— الصفحة');
const hit = await p.evaluate(() => { const el = document.getElementById('nav-exceptions'); const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(at && el.contains(at)); });
await gotoExceptions(p);
const pg = await p.evaluate(() => ({ path: location.pathname, title: document.title,
  vis: ['orders', 'stock', 'inbox', 'exceptions', 'finance', 'analytics', 'settings'].filter(n => { const el = document.getElementById('page-' + n); return el && getComputedStyle(el).display !== 'none'; }) }));
ok(hit && pg.path === '/exceptions' && pg.title === 'استثناءات الشحن · سهل' && pg.vis.join() === 'exceptions', '3) الزرار (hit-test) بيفتح /exceptions بعنوانها والصفحة لوحدها — ' + JSON.stringify(pg));
const st0 = await p.evaluate(() => ({ stage: document.getElementById('page-exceptions').getAttribute('data-stage'),
  on: (document.querySelector('#jx-chips .jx-chip.on') || {}).dataset.jxChip, ids: [...document.querySelectorAll('#jx-list .jx-card')].map(c => Number(c.dataset.id)),
  hint: document.getElementById('jx-hint').textContent }));
ok(st0.stage === 'review' && st0.on === 'review' && JSON.stringify(st0.ids) === '[10]' && /النهارده: shekoz 2/.test(st0.hint),
  '32) الأدمن بيفتح على «مستنية مراجعتك» (فيها 10) · ومين سجّل النهارده في السطر اللي فوق — ' + JSON.stringify(st0));
const c10 = await p.evaluate(() => { const c = document.querySelector('.jx-card[data-id="10"]'); return c ? { meta: (c.querySelector('.jx-meta') || {}).textContent.replace(/\s+/g, ' '),
  ok: !!c.querySelector('[data-jx="rv-ok"]'), back: !!c.querySelector('[data-jx="rv-back"]'), sel: !!c.querySelector('select.jx-verdict'), rev: c.classList.contains('is-review') } : null; });
ok(c10 && /ebrahim/.test(c10.meta) && /تأجيل حقيقي/.test(c10.meta) && /إمبارح 7:00 ص/.test(c10.meta) && /مستنية مراجعتك/.test(c10.meta) && /قال بكرة/.test(c10.meta)
  && c10.ok && c10.back && !c10.sel && c10.rev,
  '33) سطر «مين اتعامل» ظاهر تحت العنوان: ebrahim · اختار تأجيل حقيقي · إمبارح 7:00 ص (بالساعة) · مستنية مراجعتك · كتب «قال بكرة» + زرارين ✓ تمام / ↩️ رجّعها — ' + JSON.stringify(c10));
await chip(p, 'open');
const ids0 = await cardIds(p);
ok(JSON.stringify(ids0) === JSON.stringify([16, 11, 4, 6, 12, 1, 2]), '4) «محتاجة تعامل»: المترجّعة (16) فوق الكل · بعدها الأقدم (العالق من 20 يوم موجود رغم الفترة 7) — ' + JSON.stringify(ids0));
const c16 = await p.evaluate(() => { const c = document.querySelector('.jx-card[data-id="16"]'); return c ? { back: c.classList.contains('is-back'), meta: c.querySelector('.jx-meta').textContent.replace(/\s+/g, ' '),
  xss: !!document.getElementById('xss5'), sel: !!c.querySelector('select.jx-verdict') } : null; });
ok(c16 && c16.back && /shekoz/.test(c16.meta) && /رجّعها/.test(c16.meta) && /كلّمه تاني بكرة/.test(c16.meta) && !c16.xss && c16.sel,
  '34) المترجّعة: سطر أحمر «shekoz رجّعها: …» بتعليقه (متهرّب) والخانات قدام الأدمن عشان يعدّل — ' + JSON.stringify(c16));
const st = await p.evaluate(() => ({ stats: !!document.querySelector('#page-exceptions .jx-stats'), visF: ['jx-fdays', 'jx-freason', 'jx-fverdict', 'jx-fwho', 'jx-fout', 'jx-export', 'jx-search', 'jx-refresh']
  .filter(i => { const el = document.getElementById(i); return el && getComputedStyle(el).display !== 'none'; }), rep: getComputedStyle(document.getElementById('jx-report-box')).display }));
ok(!st.stats && st.visF.join() === 'jx-search,jx-refresh' && st.rep === 'none', '5) الكروت الخمسة اتشالت · في «محتاجة تعامل» البحث و↻ بس · التقرير مستخبي — ' + JSON.stringify(st));
const chips = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#jx-chips .jx-chip')].map(c => [c.dataset.jxChip, c.querySelector('.n').textContent])));
ok(chips.open === '7' && chips.review === '1' && chips.done === '3' && chips.all === '13', '6) أعداد المراحل: محتاجة تعامل 7 · مستنية مراجعة 1 · اتراجعت 3 · الكل (7 أيام) 13 — ' + JSON.stringify(chips));

console.log('— محتوى الكارت');
const c1 = await p.evaluate(() => {
  const c = document.querySelector('.jx-card[data-id="1"]'); if(!c) return null;
  const a = c.querySelector('a.jx-photo');
  return { text: c.textContent.replace(/\s+/g, ' '), tels: [...c.querySelectorAll('a.jx-tel')].map(x => x.getAttribute('href')),
    photo: a ? { t: a.target, rel: a.rel, href: a.getAttribute('href') } : null, open: c.classList.contains('is-open') };
});
ok(c1 && /العميل مش بيرد أو تليفونه مقفول/.test(c1.text) && /المندوب كتب: «مش بيرد»/.test(c1.text) && /المحاولة 1/.test(c1.text) && /لسه مع J&T/.test(c1.text)
  && /أحمد سامي/.test(c1.text) && /JEG001/.test(c1.text) && /1,450 ج/.test(c1.text) && /مدينة نصر/.test(c1.text) && /محمد علي/.test(c1.text) && /Nasr City/.test(c1.text) && c1.open,
  '7) الكارت فيه: السبب بالعربي · كلام المندوب · المحاولة · النتيجة · العميل · البوليصة · التحصيل · العنوان · المندوب · الفرع');
ok(c1 && ['tel:01000000001', 'tel:01011112222', 'tel:0223456789'].every(t => c1.tels.indexOf(t) >= 0), '7ب) العميل والمندوب والفرع لينكات tel: — ' + JSON.stringify(c1 && c1.tels));
ok(c1 && c1.photo && c1.photo.t === '_blank' && /noopener/.test(c1.photo.rel) && /noreferrer/.test(c1.photo.rel) && /^https:/.test(c1.photo.href), '8) صورة المندوب لينك في تاب جديدة بـnoopener noreferrer');
const c12 = await p.evaluate(() => ({ xss: ['xss1', 'xss2', 'xss3', 'xss4'].filter(i => document.getElementById(i)).length + (window.__XSS ? 10 : 0),
  photo: !!document.querySelector('.jx-card[data-id="12"] a.jx-photo'), text: (document.querySelector('.jx-card[data-id="12"]') || {}).textContent || '' }));
ok(c12.xss === 0 && /<img src=x/.test(c12.text), '9) نص J&T والعميل بيتعرض نص متهرّب (مفيش HTML ولا onerror)');
ok(!c12.photo, '8ب) لينك صورة javascript: = مفيش لينك خالص');
const c6 = await p.evaluate(() => (document.querySelector('.jx-card[data-id="6"] .jx-head') || {}).textContent || '');
ok(/رجوع من غير سبب/.test(c6) && !/المحاولة/.test(c6) && /راجعة/.test(c6), '10) «رجوع من غير سبب» بشارته (مش «المحاولة») + راجعة');

console.log('— المراحل والفلاتر');
await chip(p, 'done');
const dn = await p.evaluate(() => ({ ids: [...document.querySelectorAll('#jx-list .jx-card')].map(c => Number(c.dataset.id)),
  m17: (document.querySelector('.jx-card[data-id="17"] .jx-meta') || {}).textContent || '', m3: (document.querySelector('.jx-card[data-id="3"] .jx-meta') || {}).textContent || '',
  fout: getComputedStyle(document.getElementById('jx-fout')).display !== 'none', fdays: getComputedStyle(document.getElementById('jx-fdays')).display }));
ok(JSON.stringify(dn.ids) === '[17,13,3]' && /shekoz راجعها/.test(dn.m17) && /الأدمن اتعامل بنفسه/.test(dn.m3) && dn.fout && dn.fdays === 'none',
  '35) «اتراجعت — تابع النتيجة»: اللي لسه مع J&T فوق (17 · 13) وبعدها المتسلّمة (3) · «shekoz راجعها» / «الأدمن اتعامل بنفسه» · فلتر النتيجة بس — ' + JSON.stringify(dn));
await p.selectOption('#jx-fout', 'delivered'); await p.waitForTimeout(150);
const dnDel = await cardIds(p);
await p.selectOption('#jx-fout', ''); await p.waitForTimeout(150);
ok(JSON.stringify(dnDel) === '[3]', '35ب) فلتر النتيجة جوّه «اتراجعت»: اتسلمت = {3} — ' + JSON.stringify(dnDel));
await chip(p, 'all');
const c13 = await p.evaluate(() => { const c = document.querySelector('.jx-card[data-id="13"]'); return c ? { photo: !!c.querySelector('a.jx-photo'), t: c.textContent } : null; });
ok(c13 && !c13.photo && /انتهت صلاحيتها/.test(c13.t), '8ج) صورة J&T اللي `se=` بتاعها فات = «انتهت صلاحيتها» من غير لينك ميت');
await p.selectOption('#jx-fout', 'delivered'); await p.waitForTimeout(150);
const dl = (await cardIds(p)).sort((x, y) => x - y);
await p.selectOption('#jx-fout', 'returned'); await p.waitForTimeout(150);
const rt7 = (await cardIds(p)).sort((x, y) => x - y);
await days(p, 30);
const rt30 = (await cardIds(p)).sort((x, y) => x - y);
await p.selectOption('#jx-fout', ''); await p.waitForTimeout(150);
const all30 = await cardIds(p);
ok(JSON.stringify(dl) === '[3,8]' && JSON.stringify(rt7) === '[4,6]' && JSON.stringify(rt30) === '[4,5,6]' && all30.indexOf(15) < 0 && all30.length === 15 && all30[0] === 2,
  '11) «الكل» + النتيجة: اتسلمت {3،8 — متعلّم متسلّم عندنا} · رجعت 7 أيام {4،6} · 30 يوم {4،5،6} · الكل 30 يوم 15 (من غير بره النافذة) والأحدث فوق — ' + JSON.stringify({ dl, rt7, rt30, n: all30.length }));
await p.selectOption('#jx-fwho', 'ebrahim'); await p.waitForTimeout(150);
const wE = (await cardIds(p)).sort((x, y) => x - y);
await p.selectOption('#jx-fwho', '__none'); await p.waitForTimeout(150);
const wN = await p.evaluate(() => [...document.querySelectorAll('#jx-list .jx-card')].every(c => !/✍️/.test((c.querySelector('.jx-meta') || {}).textContent || '')) && document.querySelectorAll('#jx-list .jx-card').length);
await p.selectOption('#jx-fwho', ''); await p.waitForTimeout(150);
ok(JSON.stringify(wE) === '[10,16,17]' && wN === 10, '36) فلتر «مين اتعامل»: ebrahim {10،16،17} · «محدش اتعامل» 10 كلهم من غير «✍️» — ' + JSON.stringify([wE, wN]));
await p.fill('#jx-search', 'JEG010'); await p.waitForTimeout(350);
const s1 = await cardIds(p);
await p.fill('#jx-search', '1000000004'); await p.waitForTimeout(350);
const s2 = await cardIds(p);
await p.fill('#jx-search', 'كريم'); await p.waitForTimeout(350);
const s3 = await cardIds(p);
await p.fill('#jx-search', ''); await p.waitForTimeout(350);
ok(JSON.stringify(s1) === '[12]' && JSON.stringify(s2) === '[4]' && JSON.stringify(s3) === '[4]', '12) البحث بالبوليصة · بالتليفون من غير صفر · بالاسم — ' + JSON.stringify([s1, s2, s3]));
await p.selectOption('#jx-freason', 'العميل طلب تأجيل'); await p.waitForTimeout(150);
const r1 = await cardIds(p);
await p.selectOption('#jx-freason', ''); await p.selectOption('#jx-fverdict', 'none'); await p.waitForTimeout(150);
const v1 = await p.evaluate(() => [...document.querySelectorAll('#jx-list .jx-card')].every(c => !c.classList.contains('has-verdict')) && document.querySelectorAll('#jx-list .jx-card').length);
await p.selectOption('#jx-fverdict', 'fake_update'); await p.waitForTimeout(150);
const v2 = await cardIds(p);
ok(JSON.stringify(r1) === '[2]' && v1 === 10 && JSON.stringify(v2) === '[3]', '13–14) فلتر السبب {2} · «لسه متصنفتش» 10 كلهم من غير تصنيف · FAKE UPDATE {3} — ' + JSON.stringify([r1, v1, v2]));
// 🔴 فلاتر «الكل» متعلّقة (FAKE UPDATE + سبب) والطابور مايتقصّش بيها
await p.selectOption('#jx-freason', 'العميل طلب تأجيل'); await p.waitForTimeout(100);
await chip(p, 'open');
const hid = await cardIds(p);
await chip(p, 'all'); await p.selectOption('#jx-freason', ''); await p.selectOption('#jx-fverdict', ''); await days(p, 7); await chip(p, 'open');
ok(hid.length === 7, '37) فلتر سبب وتصنيف متعلّقين من «الكل» مابيقصّوش «محتاجة تعامل» (الفلتر المستخبي مابيتطبّقش) — ' + JSON.stringify(hid));

console.log('— الحفظ');
// الموظف الحقيقي بيدوس على الخانة الأول (focus) وبعدين بيختار — selectOption لوحدها مابتعملش focus
await p.focus('.jx-card[data-id="2"] select.jx-verdict');
await p.selectOption('.jx-card[data-id="2"] select.jx-verdict', 'fake_update');
await p.waitForTimeout(250);
const sv1 = await p.evaluate(() => ({ saves: window.__SAVES.slice(), still: !!document.querySelector('.jx-card[data-id="2"]'),
  meta: (document.querySelector('.jx-card[data-id="2"] .jx-meta') || {}).textContent || '', badge: document.getElementById('jx-nav-badge').textContent,
  open: document.querySelector('#jx-chips [data-jx-chip="open"] .n').textContent, dv: (document.querySelector('.jx-card[data-id="2"] select.jx-verdict') || {}).dataset }));
ok(sv1.saves.length === 1 && sv1.saves[0].p_id === 2 && sv1.saves[0].p_verdict === 'fake_update' && sv1.saves[0].p_note === null,
  '15) الاختيار بيتحفظ فوراً: jt_issue_save(2, fake_update, null) — ' + JSON.stringify(sv1.saves));
ok(sv1.still && /أدمن الاختبار/.test(sv1.meta) && /اتعامل بنفسه/.test(sv1.meta) && sv1.badge === '5' && sv1.open === '5' && sv1.dv && sv1.dv.v === 'fake_update',
  '15ب) الكارت مايتسحبش من تحت إيد الموظف (الاختيار لسه في إيده) · «مين سجّل» اتكتب (الأدمن = اتعامل بنفسه) · الشارة 7→5 (المحاولة 1 اتغطّت) — ' + JSON.stringify({ still: sv1.still, badge: sv1.badge, meta: sv1.meta }));
await p.click('#page-exceptions .sp-head h2'); await p.waitForTimeout(450);
const ids1 = await cardIds(p);
ok(JSON.stringify(ids1) === '[16,11,4,6,12]', '15ج) أول ما ساب الخانة: 1 و2 خرجوا من الطابور — ' + JSON.stringify(ids1));
await p.click('.jx-card[data-id="4"] textarea.jx-note');
await p.keyboard.type('كلمته وقال هيستلم من الفرع');
const dirty = await p.evaluate(() => getComputedStyle(document.querySelector('.jx-card[data-id="4"] .jx-save')).display !== 'none');
await p.click('#page-exceptions .sp-head h2'); await p.waitForTimeout(450);
const sv2 = await p.evaluate(() => ({ s: window.__SAVES[window.__SAVES.length - 1], ids: [...document.querySelectorAll('#jx-list .jx-card')].map(c => Number(c.dataset.id)),
  meta: (document.querySelector('.jx-card[data-id="4"] .jx-meta') || {}).textContent || '', val: (document.querySelector('.jx-card[data-id="4"] textarea.jx-note') || {}).value }));
ok(dirty && sv2.s && sv2.s.p_id === 4 && sv2.s.p_verdict === null && sv2.s.p_note === 'كلمته وقال هيستلم من الفرع' && sv2.ids.indexOf(4) >= 0 && /أدمن الاختبار/.test(sv2.meta) && sv2.val === 'كلمته وقال هيستلم من الفرع',
  '16) الملاحظة: زرار «حفظ» بيظهر وهو بيكتب · بتتحفظ أول ما يسيب الخانة · من غير تصنيف الكارت فاضل في الطابور');
const nSaves = await p.evaluate(() => window.__SAVES.length);
await p.click('.jx-card[data-id="6"] textarea.jx-note');
await p.keyboard.type('هكلم J&T');
await p.keyboard.press('Control+Enter'); await p.waitForTimeout(250);
const sv3 = await p.evaluate(() => window.__SAVES.slice(-1)[0]);
ok(await p.evaluate(n => window.__SAVES.length, nSaves) === nSaves + 1 && sv3.p_id === 6 && sv3.p_note === 'هكلم J&T', '17) Ctrl+Enter بيحفظ من غير ما يسيب الخانة');
await p.click('#page-exceptions .sp-head h2'); await p.waitForTimeout(400);
await p.evaluate(() => { window.__SAVE_FAIL = true; });
await p.click('.jx-card[data-id="11"] textarea.jx-note');
await p.keyboard.type('مسودة مهمة');
await p.selectOption('.jx-card[data-id="11"] select.jx-verdict', 'jt_error');
await p.waitForTimeout(300);
const sv4 = await p.evaluate(() => ({ toast: document.getElementById('toast').textContent, v: document.querySelector('.jx-card[data-id="11"] select.jx-verdict').value,
  note: document.querySelector('.jx-card[data-id="11"] textarea.jx-note').value, open: document.querySelector('.jx-card[data-id="11"]').classList.contains('is-open') }));
ok(/التصنيف ده مش معروف/.test(sv4.toast) && sv4.v === '' && sv4.note === 'مسودة مهمة' && sv4.open, '18) رفض السيرفر: السبب بالعربي · الاختيار رجع للمحفوظ · الكلام فاضل (ماضاعش) — ' + JSON.stringify(sv4));
await p.evaluate(() => { window.__SAVE_FAIL = false; });
await p.click('#page-exceptions .sp-head h2'); await p.waitForTimeout(400);

// 19) الكتابة ماتضيعش لما يوصل استثناء جديد لحظي
await p.click('.jx-card[data-id="12"] textarea.jx-note');
await p.keyboard.type('بكتب دلوقتي');
await p.evaluate(() => {
  var now = Date.now();
  window.__JT_ISSUES.push(Object.assign({}, window.__JT_ISSUES[0], { id: 20, tracking_no: 'JEG020', attempt: 1, event_at: new Date(now - 60000).toISOString(),
    updated_at: new Date(now).toISOString(), courier_note: null, customer_name: 'وصل لحظي', order_id: 'o20', order_uid: '9020', phone: '01000000020' }));
  var h = (window.__RT_ON || []).find(function(x){ return x.opts && x.opts.table === 'jt_issues'; });
  h.cb({ eventType: 'INSERT', new: { id: 20, tracking_no: 'JEG020', tenant_id: 't-test-1' } });
});
await p.waitForTimeout(1000);
const rt1 = await p.evaluate(() => ({ focus: document.activeElement && document.activeElement.closest && !!document.activeElement.closest('.jx-card[data-id="12"]'),
  val: document.querySelector('.jx-card[data-id="12"] textarea.jx-note').value, has20: !!document.querySelector('.jx-card[data-id="20"]'),
  bar: getComputedStyle(document.getElementById('jx-newbar')).display !== 'none', badge: document.getElementById('jx-nav-badge').textContent }));
ok(rt1.focus && rt1.val === 'بكتب دلوقتي' && !rt1.has20 && rt1.bar && rt1.badge === '6', '19) وصل جديد وهو بيكتب: الخانة في إيده بنفس الكلام · الكارت الجديد مستني · شريط «وصل تحديث» · الشارة 6 — ' + JSON.stringify(rt1));
await p.click('#page-exceptions .sp-head h2'); await p.waitForTimeout(500);
const rt2 = await p.evaluate(() => { const c = document.querySelector('.jx-card[data-id="20"]'); return { has: !!c, isNew: !!(c && c.classList.contains('is-new') && /جديد/.test(c.textContent)), note12: (window.__SAVES.slice(-1)[0] || {}).p_note }; });
ok(rt2.has && rt2.isNew && rt2.note12 === 'بكتب دلوقتي', '19ب) أول ما ساب الخانة: كلامه اتحفظ والكارت الجديد ظهر بعلامة «جديد»');

console.log('— التقرير والتصدير');
await chip(p, 'all');
await p.click('#jx-report-box > summary'); await p.waitForTimeout(200);
const rep = await p.evaluate(() => ({ pct: /\u2066\d+%\u2069/.test((document.querySelector('.jx-rsum') || {}).textContent || ''), sum: document.querySelector('.jx-rsum') ? document.querySelector('.jx-rsum').textContent.replace(/\s+/g, ' ') : '',
  hot: document.querySelectorAll('#jx-report tr.hot').length, tables: document.querySelectorAll('#jx-report .jx-rtable').length }));
ok(/FAKE UPDATE 2/.test(rep.sum) && /غلطة J&T 1/.test(rep.sum) && rep.tables === 3 && rep.hot >= 2 && rep.pct, '23) تقرير J&T (مطوي جوّه «الكل» ويترسم لما يتفتح): الملخص (FAKE بعد الحفظ 2 · غلطة J&T 1) + 3 جداول + النسبة معزولة اتجاهياً — ' + rep.sum.slice(0, 160));
const rtext = await p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); return m.jxReportText(m.jxRows.filter(r => r._ymd >= m.jxPeriodFrom(7, Date.now())), 7, Date.now()); });
ok(/FAKE UPDATE: 2/.test(rtext) && /Nasr City/.test(rtext), '23ب) الملخص النصي لـJ&T فيه الأرقام والفرع');
await days(p, 30);
const [dlf] = await Promise.all([p.waitForEvent('download'), p.click('#jx-export')]);
const csv = fs.readFileSync(await dlf.path(), 'utf8');
const lines = csv.split('\r\n');
ok(csv.charCodeAt(0) === 0xFEFF && /البوليصة/.test(lines[0]) && /المراجعة/.test(lines[0]) && lines.length === 17 && /"=""01000000001"""/.test(csv) && /'=1\+1/.test(csv) && /<img src=x/.test(csv) && /بره النافذة/.test(csv) === false,
  '24) التصدير: BOM + العناوين بالعربي (+ المراجعة) + 16 صف · التليفون نص (="010…") · خلية بتبدأ بـ= متحيّدة (\'=1+1) — ' + dlf.suggestedFilename());
await days(p, 7); await chip(p, 'open');
ok(p.__errs.length === 0, 'صفر أخطاء جافاسكربت في التشغيل الأساسي — ' + (p.__errs[0] || 'نضيف'));
await M.ctx.close();

console.log('— الشات');
{
  const T = await open('/exceptions', { stage: 'open' });
  const pp = T.p;
  await pp.waitForSelector('.jx-card[data-id="1"]');
  const [tab] = await Promise.all([T.ctx.waitForEvent('page'), pp.click('.jx-card[data-id="1"] [data-jx="chat"]')]);
  await tab.waitForLoadState('networkidle');
  await tab.waitForFunction(() => { const n = document.getElementById('wa-chat-name'); return n && n.textContent.trim().length > 0; }, null, { timeout: 8000 }).catch(() => {});
  const ch = await tab.evaluate(() => ({ path: location.pathname, name: (document.getElementById('wa-chat-name') || {}).textContent, left: localStorage.getItem('sahl_open_chat'),
    q: (window.__calls || []).some(c => c.table === 'wa_conversations' && c.eqWa === '201000000001') }));
  ok(ch.path === '/chats' && ch.name === 'أحمد سامي' && ch.q && ch.left === null, '20) «💬 شات» فتح تاب المحادثات على العميل نفسه — وهو أقدم من الـ200 (اتجاب بالرقم) والطلب اتمسح — ' + JSON.stringify(ch));
  await T.ctx.close();
}
{
  const T = await open('/exceptions', { viewport: { width: 390, height: 844 }, stage: 'open' });
  const pp = T.p;
  await pp.waitForSelector('.jx-card[data-id="1"]');
  await pp.evaluate(() => document.querySelector('.jx-card[data-id="1"] [data-jx="chat"]').scrollIntoView({ block: 'center' }));
  await pp.click('.jx-card[data-id="1"] [data-jx="chat"]');
  await pp.waitForFunction(() => { const n = document.getElementById('wa-chat-name'); return n && n.textContent.trim().length > 0; }, null, { timeout: 8000 }).catch(() => {});
  const ch = await pp.evaluate(() => ({ path: location.pathname, name: (document.getElementById('wa-chat-name') || {}).textContent, pages: window.__pagesOpened, left: localStorage.getItem('sahl_open_chat') }));
  ok(ch.path === '/chats' && ch.name === 'أحمد سامي' && ch.left === null && T.ctx.pages().length === 1, '21) الموبايل: نفس التاب بتروح للمحادثات وتفتح العميل (من غير تاب جديدة ولا طلب فاضل) — ' + JSON.stringify(ch));
  await T.ctx.close();
}
{
  const T = await open('/exceptions', { viewport: { width: 390, height: 844 }, stage: 'open', post: `window.__START_TPLS = [{ id:'tp1', tenant_id:'t-test-1', template_name:'chat_start_ar', lang:'ar_EG', label:'بدء محادثة', body:'أهلاً {{1}}', params:['عتبة'], enabled:true }];` });
  const pp = T.p;
  await pp.waitForSelector('.jx-card[data-id="4"]');
  await pp.evaluate(() => document.querySelector('.jx-card[data-id="4"] [data-jx="chat"]').scrollIntoView({ block: 'center' }));
  await pp.click('.jx-card[data-id="4"] [data-jx="chat"]');
  await pp.waitForTimeout(1200);
  const nc = await pp.evaluate(() => ({ form: (document.getElementById('wa-newchat') || {}).style ? document.getElementById('wa-newchat').style.display : null,
    phone: (document.getElementById('wa-nc-phone') || {}).value, name: (document.getElementById('wa-nc-name') || {}).value, toast: document.getElementById('toast').textContent }));
  ok(nc.form === 'flex' && nc.phone === '01000000004' && nc.name === 'كريم' && /مفيش محادثة/.test(nc.toast), '22) رقم مالوش محادثة خالص: «شات جديد» بالقالب بيفتح والرقم والاسم متعبّيين — ' + JSON.stringify(nc));
  await T.ctx.close();
}

console.log('— الداتابيز لسه ماتطبّقتش · الموبايل · الليلي · الموظف · المزامنة');
{
  const T = await open('/orders', { pre: 'window.__JT_FAIL = true;' });
  await T.p.waitForTimeout(400);
  const b1 = await T.p.evaluate(() => ({ badge: getComputedStyle(document.getElementById('jx-nav-badge')).display, ch: (window.__RT_CHANNELS || []).filter(n => /^jt-issues-/.test(n)).length,
    orders: (window.__RT_CHANNELS || []).filter(n => /^orders-realtime-/.test(n)).length }));
  await gotoExceptions(T.p);
  const msg = await txt(T.p, 'jx-list');
  ok(b1.badge === 'none' && b1.ch === 0 && b1.orders >= 1 && /لسه مااتطبّقش/.test(msg || '') && !/jt-issues-tab/.test(msg || '') && T.p.__errs.length === 0,
    '25) الجدول مش موجود: مفيش شارة · مفيش قناة jt-issues (قناة الأوردرات شغالة عادي) · الصفحة بتقول التحديث لسه مااتطبّقش (من غير ما تقول شغّل jt-issues-tab.sql — ممنوع) — ' + JSON.stringify(b1));
  await T.ctx.close();
}
{
  const T = await open('/exceptions', { viewport: { width: 390, height: 844 }, stage: 'open' });
  await T.p.waitForSelector('.jx-card');
  const mob = await T.p.evaluate(() => {
    // ⚠️ behavior:'instant' — 02-base فيها scroll-behavior:smooth فالقياس بعد scrollIntoView العادية بيبقى قبل ما يتحرك
    const sel = document.querySelector('.jx-card select.jx-verdict'); sel.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = sel.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { over: document.documentElement.scrollWidth - window.innerWidth, hit: at === sel, w: Math.round(document.querySelector('.jx-card').getBoundingClientRect().width) };
  });
  ok(mob.over <= 1 && mob.hit && mob.w <= 390, '26) الموبايل 390: مفيش سكرول عرضي · الكارت جوّه الشاشة · خانة الاختيار مش مدفونة (hit-test) — ' + JSON.stringify(mob));
  await T.ctx.close();
}
{
  const T = await open('/exceptions', { stage: 'open', pre: "try{ localStorage.setItem('sahl_dark','1'); }catch(e){}" });
  await T.p.waitForSelector('.jx-card');
  const dk = await T.p.evaluate(() => { const c = s => getComputedStyle(document.querySelector(s)).backgroundColor;
    return { dark: document.documentElement.classList.contains('dark'), act: c('.jx-card .jx-act'), sel: c('.jx-card select.jx-verdict'), chip: c('.jx-chip:not(.on)') }; });
  const isLight = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return m[0] > 200 && m[1] > 200 && m[2] > 200; };
  ok(dk.dark && !isLight(dk.act) && !isLight(dk.sel) && !isLight(dk.chip), '27) الليلي: خلفية الكارت والاختيار والشرايح غامقة (مش بيضا) — ' + JSON.stringify(dk));
  await T.ctx.close();
}
{
  const T = await open('/exceptions', { role: 'employee' });
  await T.p.waitForSelector('.jx-card[data-id="1"]');
  const vis = await T.p.evaluate(() => location.pathname);
  await T.p.selectOption('.jx-card[data-id="1"] select.jx-verdict', 'real_delay');
  await T.p.waitForTimeout(250);
  const s = await T.p.evaluate(() => window.__SAVES.slice(-1)[0]);
  ok(vis === '/exceptions' && s && s.p_id === 1 && s.p_verdict === 'real_delay', '28) الموظف بيدخل التاب ويسجّل (مش للأدمن بس)');
  await T.ctx.close();
}
{
  const T = await open('/exceptions', { stage: 'open', pre: 'window.__JX_POLL_MS = 400;' });
  await T.p.waitForSelector('.jx-card[data-id="1"]');
  await T.p.evaluate(() => { const r = window.__JT_ISSUES.find(x => x.id === 1); r.outcome = 'delivered'; r.outcome_at = new Date().toISOString(); r.updated_at = new Date(Date.now() + 1000).toISOString(); });
  await T.p.waitForTimeout(1500);
  const inc = await T.p.evaluate(() => ({ has1: !!document.querySelector('.jx-card[data-id="1"]'), q: (window.__calls || []).some(c => c.table === 'jt_issues' && (c.f || []).some(f => f.op === 'gte' && f.col === 'updated_at')),
    badge: document.getElementById('jx-nav-badge').textContent }));
  ok(!inc.has1 && inc.q && inc.badge === '6', '29) المزامنة التدريجية (من غير ريل-تايم): اتسلمت عند J&T → خرجت من الطابور والشارة 7→6 — ' + JSON.stringify(inc));
  await T.ctx.close();
}

{
  // 30) مهلة «راجعة» من بداية المرتجع (outcome_at) مش من الاستثناء — الفرق وصل 3.9 يوم على الحي
  const T = await open('/exceptions', { stage: 'open' });
  await T.p.waitForSelector('.jx-card');
  const nf = await T.p.evaluate(async () => {
    const m = await import('/js/exceptions/exceptions.js');
    const D = 86400000, now = Date.now(), iso = ms => new Date(now - ms).toISOString();
    const base = { kind:'exception', verdict:null, tracking_no:'JX-T', order_status:'Returned to business' };
    return {
      late: m.jxNeedsFollow(Object.assign({}, base, { event_at: iso(9 * D), outcome:'returning', outcome_at: iso(2 * D) }), {}, now),
      old:  m.jxNeedsFollow(Object.assign({}, base, { event_at: iso(10 * D), outcome:'returning', outcome_at: iso(8 * D) }), {}, now),
      fromOrder: m.jxNeedsFollow(Object.assign({}, base, { event_at: iso(3 * D), outcome:null, outcome_at:null }), {}, now)
    };
  });
  ok(nf.late === true && nf.old === false && nf.fromOrder === true, '30) «راجعة» محتاجة متابعة 7 أيام من بداية المرتجع (استثناء من 9 أيام ورجعت من يومين = لسه) · النتيجة من حالة الأوردر = من الاستثناء — ' + JSON.stringify(nf));
  // 31) سباق الحفظ: اختار FAKE UPDATE ورجع «— اختار —» قبل ما الحفظ الأول يرجع → اللي يتسجّل في الآخر = فاضي
  await T.p.evaluate(() => { window.__SAVE_DELAY = 400; window.__SAVES.length = 0; });
  await T.p.focus('.jx-card[data-id="11"] select.jx-verdict');
  await T.p.selectOption('.jx-card[data-id="11"] select.jx-verdict', 'fake_update');
  await T.p.waitForTimeout(80);
  await T.p.selectOption('.jx-card[data-id="11"] select.jx-verdict', '');
  await T.p.waitForTimeout(1300);
  const race = await T.p.evaluate(() => ({ saves: window.__SAVES.map(x => x.p_verdict), final: window.__JT_ISSUES.find(x => x.id === 11).verdict,
    ui: document.querySelector('.jx-card[data-id="11"] select.jx-verdict').value }));
  ok(JSON.stringify(race.saves) === '["fake_update",null]' && race.final === null && race.ui === '',
    '31) غيّر ورجع والحفظ في السكة: حفظة تانية بآخر قيمة (FAKE ثم فاضي) — ماتسجّلش FAKE UPDATE باسمه — ' + JSON.stringify(race));
  await T.ctx.close();
}

console.log('— المراجعة والسجل (v70)');
{
  // 38) ✓ تمام: الـrev اللي الأدمن شافه بيتبعت · الكارت بيخرج من الطابور ويبان في «اتراجعت»
  const T = await open('/exceptions');
  const pp = T.p;
  await pp.waitForSelector('.jx-card[data-id="10"]');
  await pp.click('.jx-card[data-id="10"] [data-jx="rv-ok"]');
  await pp.waitForTimeout(300);
  const r1 = await pp.evaluate(() => ({ rv: window.__REVIEWS.slice(), has10: !!document.querySelector('.jx-card[data-id="10"]'),
    held: !!document.querySelector('.jx-card[data-id="10"].is-held [data-mode="held"]') && !document.querySelector('.jx-card[data-id="10"] [data-jx="rv-ok"]'),
    n: document.querySelector('#jx-chips [data-jx-chip="review"] .n').textContent, b2: getComputedStyle(document.getElementById('jx-nav-badge2')).display,
    toast: document.getElementById('toast').textContent }));
  ok(r1.rv.length === 1 && r1.rv[0].p_id === 10 && r1.rv[0].p_action === 'ok' && r1.rv[0].p_seen_rev === 1 && r1.rv[0].p_note === null && r1.has10 && r1.held && r1.n === '0' && r1.b2 === 'none' && /اتراجعت/.test(r1.toast),
    '38) «✓ تمام»: jt_issue_review(10, ok, seen_rev=1) · الكارت فاضل مكانه متعلّم «اتراجعت» من غير أزرار (الطابور مايتحركش تحت إيده) · العدّاد والشارة الزرقا صفر — ' + JSON.stringify(r1));
  await chip(pp, 'done');
  const d10 = await pp.evaluate(() => ({ ids: [...document.querySelectorAll('#jx-list .jx-card')].map(c => Number(c.dataset.id)),
    m: (document.querySelector('.jx-card[data-id="10"] .jx-meta') || {}).textContent || '', undo: !!document.querySelector('.jx-card[data-id="10"] [data-jx="rv-undo"]') }));
  ok(d10.ids.indexOf(10) >= 0 && /أدمن الاختبار راجعها/.test(d10.m) && d10.undo, '38ب) بقت في «اتراجعت — تابع النتيجة» بـ«راجعها» + «↶ رجّعها لمراجعتي» — ' + JSON.stringify(d10));
  // 39) ↩️ رجّعها: مودال برّه القايمة · التعليق إجباري · بترجع فوق «محتاجة تعامل»
  await pp.click('.jx-card[data-id="17"] [data-jx="rv-back"]');
  await pp.waitForTimeout(200);
  const mo = await pp.evaluate(() => ({ shown: getComputedStyle(document.getElementById('cmodal-backdrop')).display !== 'none', t: document.getElementById('cmodal-title').textContent }));
  await pp.click('#cmodal-ok'); await pp.waitForTimeout(150);
  const empty = await pp.evaluate(() => ({ still: getComputedStyle(document.getElementById('cmodal-backdrop')).display !== 'none', n: window.__REVIEWS.length }));
  await pp.fill('#cmodal-input', 'كلّمه تاني الساعة 6');
  await pp.click('#cmodal-ok'); await pp.waitForTimeout(300);
  await chip(pp, 'open');
  const sb17 = await pp.evaluate(() => ({ rv: window.__REVIEWS.slice(-1)[0], ids: [...document.querySelectorAll('#jx-list .jx-card')].map(c => Number(c.dataset.id)),
    back: (document.querySelector('.jx-card[data-id="17"]') || { classList: { contains: () => false } }).classList.contains('is-back'),
    m: (document.querySelector('.jx-card[data-id="17"] .jx-meta') || {}).textContent || '', badge: document.getElementById('jx-nav-badge').textContent }));
  ok(mo.shown && /ebrahim/.test(mo.t) && empty.still && empty.n === 1 && sb17.rv && sb17.rv.p_action === 'sent_back' && sb17.rv.p_note === 'كلّمه تاني الساعة 6' && sb17.rv.p_seen_rev === 1
    && sb17.ids.slice(0, 2).indexOf(17) >= 0 && sb17.back && /كلّمه تاني الساعة 6/.test(sb17.m) && sb17.badge === '8',
    '39) «↩️ رجّعها»: مودال باسم الموظف · فاضي = مايتبعتش · بالتعليق = sent_back(seen_rev=1) · بقت فوق «محتاجة تعامل» بسطر أحمر · الشارة 7→8 — ' + JSON.stringify({ mo, empty, ids: sb17.ids, badge: sb17.badge }));
  // 40) السجل: J&T في الأول + مين عمل إيه
  await chip(pp, 'done');
  await pp.click('.jx-card[data-id="10"] [data-jx="log"]');
  await pp.waitForTimeout(300);
  const lg = await pp.evaluate(() => { const c = document.querySelector('.jx-card[data-id="10"] .jx-log'); return { t: c ? c.textContent.replace(/\s+/g, ' ') : '',
    q: (window.__calls || []).filter(x => x.table === 'jt_issue_log').map(x => x.f) }; });
  ok(/J&T سجّلت/.test(lg.t) && /ebrahim كتب: «قال بكرة»/.test(lg.t) && /ebrahim اختار تأجيل حقيقي/.test(lg.t) && lg.q.length >= 1
    && lg.t.indexOf('J&T سجّلت') < lg.t.indexOf('ebrahim كتب') && lg.t.indexOf('ebrahim كتب') < lg.t.indexOf('ebrahim اختار')
    && lg.q[0].some(f => f.op === 'eq' && f.col === 'issue_id' && String(f.val) === '10') && lg.q[0].some(f => f.op === 'eq' && f.col === 'tenant_id'),
    '40) «🕘 السجل»: J&T سجّلت … · ebrahim كتب «قال بكرة» · ebrahim اختار تأجيل حقيقي — من jt_issue_log بالـissue والمتجر — ' + lg.t.slice(0, 200));
  ok(pp.__errs.length === 0, 'صفر أخطاء جافاسكربت في المراجعة والسجل — ' + (pp.__errs[0] || 'نضيف'));
  await T.ctx.close();
}
{
  // 41) stale: الموظف عدّل وانت بتراجع → السيرفر رفض والكارت فاضل في الطابور بالجديد
  const T = await open('/exceptions', { post: 'window.__REVIEW_STALE = true;' });
  await T.p.waitForSelector('.jx-card[data-id="10"]');
  await T.p.click('.jx-card[data-id="10"] [data-jx="rv-ok"]');
  await T.p.waitForTimeout(300);
  const st = await T.p.evaluate(() => ({ has: !!document.querySelector('.jx-card[data-id="10"]'), toast: document.getElementById('toast').textContent,
    m: (document.querySelector('.jx-card[data-id="10"] .jx-meta') || {}).textContent || '' }));
  ok(st.has && /عدّل عليها وانت بتراجع/.test(st.toast) && /عدّلها الموظف/.test(st.m), '41) stale: «ebrahim عدّل عليها وانت بتراجع» · الكارت فاضل في «مستنية مراجعتك» بالملاحظة الجديدة — ' + JSON.stringify(st));
  await T.ctx.close();
}
{
  // 42) الموظف: نفس المراحل · مالوش أزرار مراجعة · تعديله على اللي اتراجعت = رجعت للطابور «اتعدّلت بعد ما … راجعها»
  const T = await open('/exceptions', { role: 'employee' });
  await T.p.waitForSelector('.jx-card');
  await chip(T.p, 'review');
  const e1 = await T.p.evaluate(() => ({ lbl: document.querySelector('#jx-chips [data-jx-chip="review"] .jx-rv-lbl').textContent,
    btns: document.querySelectorAll('#jx-list [data-jx^="rv-"]').length, sel: !!document.querySelector('.jx-card[data-id="10"] select.jx-verdict'),
    m: (document.querySelector('.jx-card[data-id="10"] .jx-meta') || {}).textContent || '', b2: getComputedStyle(document.getElementById('jx-nav-badge2')).display }));
  await chip(T.p, 'done');
  const e2 = await T.p.evaluate(() => document.querySelectorAll('#jx-list [data-jx^="rv-"]').length);
  await T.p.focus('.jx-card[data-id="17"] select.jx-verdict');
  await T.p.selectOption('.jx-card[data-id="17"] select.jx-verdict', 'real_refusal');
  await T.p.click('#page-exceptions .sp-head h2'); await T.p.waitForTimeout(450);
  await chip(T.p, 'review');
  const e3 = await T.p.evaluate(() => ({ ids: [...document.querySelectorAll('#jx-list .jx-card')].map(c => Number(c.dataset.id)),
    m: (document.querySelector('.jx-card[data-id="17"] .jx-meta') || {}).textContent || '' }));
  ok(/مستنية مراجعة الأدمن/.test(e1.lbl) && e1.btns === 0 && e1.sel && /لسه الأدمن ماراجعهاش/.test(e1.m) && e1.b2 === 'none' && e2 === 0
    && e3.ids.indexOf(17) >= 0 && /اتعدّلت بعد ما shekoz راجعها/.test(e3.m),
    '42) الموظف: «مستنية مراجعة الأدمن» من غير أي زرار مراجعة (ولا شارة زرقا) · تعديله على اللي اتراجعت رجّعها للطابور «اتعدّلت بعد ما shekoz راجعها» — ' + JSON.stringify({ e1, e2, e3 }));
  await T.ctx.close();
}

{
  // 43) جلب قديم وصل متأخر (خرج قبل «✓ تمام» ورجع بعدها) مايرجّعش الكارت لـ«مستنية مراجعتك»
  const T = await open('/exceptions');
  await T.p.waitForSelector('.jx-card[data-id="10"]');
  await T.p.evaluate(() => { window.__OLD10 = JSON.parse(JSON.stringify(window.__JT_ISSUES.find(x => x.id === 10))); });
  await T.p.click('.jx-card[data-id="10"] [data-jx="rv-ok"]');
  await T.p.waitForTimeout(300);
  await T.p.evaluate(() => {
    const i = window.__JT_ISSUES.findIndex(x => x.id === 10); const cur = window.__JT_ISSUES[i];
    window.__JT_ISSUES[i] = window.__OLD10;   // السيرفر «رد» بنسخة قبل المراجعة (جلب قديم)
    (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 10, tracking_no: 'JEG008' } });
    window.__CUR10 = cur;
  });
  await T.p.waitForTimeout(1000);
  const late = await T.p.evaluate(() => ({ n: document.querySelector('#jx-chips [data-jx-chip="review"] .n').textContent,
    btn: !!document.querySelector('.jx-card[data-id="10"] [data-jx="rv-ok"]') }));
  ok(late.n === '0' && !late.btn, '43) جلب قديم وصل بعد «✓ تمام» (نفس الـrev وupdated_at أقدم) اتجاهل — الكارت مارجعش «مستنية مراجعتك» — ' + JSON.stringify(late));
  // 44) دوال خالصة: مين اختار ≠ مين عدّل بعده · المترجّعة اللي التصنيف اتشال منها تفضل في الطابور حتى لو الشحنة اتقفلت
  const pure = await T.p.evaluate(async () => {
    const m = await import('/js/exceptions/exceptions.js');
    const now = Date.now(), H = 3600000, iso = ms => new Date(now - ms).toISOString();
    const row = { id: 99, tracking_no: 'JX99', kind: 'exception', event_at: iso(5 * H), verdict: 'fake_update', staff_note: 'زوّدت تفاصيل',
      verdict_set_by_name: 'ebrahim', verdict_set_at: iso(4 * H), verdict_by_name: 'شيكو', staff_updated_at: iso(1 * H), staff_rev: 2, reviewed_rev: 2, review_state: 'ok', reviewed_by_name: 'شيكو', reviewed_at: iso(1 * H) };
    const meta = m.jxMetaHtml(row, false, now).replace(/<[^>]+>/g, '');
    const cleared = { id: 98, tracking_no: 'JX98', kind: 'exception', event_at: iso(30 * H), verdict: null, staff_note: 'شلته', staff_updated_at: iso(1 * H),
      staff_rev: 2, reviewed_rev: 1, review_state: 'sent_back', review_note: 'كلّمه', outcome: 'delivered', outcome_at: iso(2 * H), order_status: 'Delivered' };
    const tl = m.jxLogLines({ kind: 'exception', event_at: iso(10 * H), reason_ar: 'x', outcome: 'delivered', outcome_at: iso(6 * H), order_status: 'Delivered' },
      [{ action: 'save', by_name: 'ebrahim', at: iso(2 * H), verdict: 'real_delay', note: null, prev_verdict: null, verdict_changed: true, note_changed: false }], now).map(x => x.h.replace(/<[^>]+>/g, ''));
    const noteOnly = { id: 97, tracking_no: 'JX97', kind: 'exception', event_at: iso(30 * H), verdict: null, staff_note: 'كلمته', staff_updated_at: iso(20 * H),
      outcome: 'delivered', outcome_at: iso(2 * H), order_status: 'Delivered', staff_rev: 1 };
    return { meta, nf: m.jxNeedsFollow(cleared, {}, now), noteStage: m.jxStage(noteOnly, {}, now), older: m.jxOlderSnapshot({ staff_rev: 1, updated_at: iso(2 * H) }, { staff_rev: 2, updated_at: iso(3 * H) }),
      older2: m.jxOlderSnapshot({ staff_rev: 2, updated_at: iso(3 * H) }, { staff_rev: 2, updated_at: iso(2 * H) }), newer: m.jxOlderSnapshot({ staff_rev: 3, updated_at: iso(1 * H) }, { staff_rev: 2, updated_at: iso(2 * H) }), tl };
  });
  ok(/ebrahim اختار FAKE UPDATE/.test(pure.meta) && /شيكو عدّل الملاحظة بعدها/.test(pure.meta) && pure.nf === true && pure.noteStage === 'done' && pure.older && pure.older2 && !pure.newer
    && /سلّمتها/.test(pure.tl[1]) && /ebrahim/.test(pure.tl[2]),
    '44) «ebrahim اختار … · شيكو عدّل الملاحظة بعدها» · المترجّعة من غير تصنيف فاضلة في الطابور رغم التسليم · ملاحظة بس والشحنة اتقفلت = «اتراجعت» · نسخة أقدم بالـrev أو بالوقت = تتجاهل · السجل بالترتيب الزمني (التسليم قبل تعديل بعده) — ' + JSON.stringify(pure));
  await T.ctx.close();
}

const EXTRA18 = `window.__JT_ISSUES.push(Object.assign({}, window.__JT_ISSUES.find(x => x.id === 10), { id: 18, tracking_no: 'JEG018', order_id: 'o18', order_uid: '9018',
  phone: '01000000018', customer_name: 'تانية في المراجعة', staff_note: 'قال الحد', staff_updated_at: new Date(Date.now() - 25 * 3600000).toISOString(),
  updated_at: new Date(Date.now() - 25 * 3600000).toISOString(), event_at: new Date(Date.now() - 26 * 3600000).toISOString() }));`;
async function pointerProbe(T){
  const p = T.p;
  await p.waitForSelector('.jx-card[data-id="18"]');
  const before = await cardIds(p);
  const bx = await p.locator('.jx-card[data-id="18"] [data-jx="rv-ok"]').boundingBox();
  await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await p.evaluate(() => { const r = window.__JT_ISSUES.find(x => x.id === 10); r.staff_note = 'ebrahim زوّد'; r.staff_rev = 2;
    r.staff_updated_at = new Date().toISOString(); r.updated_at = r.staff_updated_at;
    (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 10, tracking_no: 'JEG008' } }); });
  await p.waitForTimeout(900);
  const during = await cardIds(p);
  const bar = await p.evaluate(() => getComputedStyle(document.getElementById('jx-newbar')).display !== 'none');
  const under = await p.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); const c = el && el.closest('.jx-card'); return c ? Number(c.dataset.id) : null; }, { x: bx.x + bx.width / 2, y: bx.y + bx.height / 2 });
  return { before, during, bar, under, p };
}
{
  // 45) الأدمن ماسك الماوس على «✓ تمام» في طابور المراجعة وزميل عدّل كارت فوقه → الطابور مايتحركش تحت إيده
  const T = await open('/exceptions', { post: EXTRA18 });
  const r = await pointerProbe(T);
  await r.p.mouse.move(5, 5); await r.p.waitForTimeout(1800);
  const after = await cardIds(r.p);
  ok(JSON.stringify(r.before) === '[10,18]' && JSON.stringify(r.during) === '[10,18]' && r.bar && r.under === 18 && JSON.stringify(after) === '[18,10]',
    '45) زميل عدّل كارت والماوس على «✓ تمام»: الترتيب ثابت (تحت الماوس نفس الكارت 18) + شريط «وصل تحديث» · أول ما الماوس يسيب القايمة بيترتّب [18،10] — ' + JSON.stringify({ before: r.before, during: r.during, under: r.under, after }));
  await T.ctx.close();
}
{
  // 46) تصنيف محفوظ = مفيش «— اختار —» (المسح كان بيلغي مراجعة الأدمن في صمت) · 47) حفظة فشلت مابتسيبش «مسودة» نسخة من المحفوظ
  const T = await open('/exceptions', { role: 'employee' });
  await T.p.waitForSelector('.jx-card[data-id="1"]');
  const opt = await T.p.evaluate(() => ({ saved: [...document.querySelectorAll('.jx-card[data-id="16"] select.jx-verdict option')].map(o => o.value),
    fresh: [...document.querySelectorAll('.jx-card[data-id="1"] select.jx-verdict option')].map(o => o.value) }));
  await T.p.evaluate(() => { window.__SAVE_FAIL = true; });
  await T.p.focus('.jx-card[data-id="1"] select.jx-verdict');
  await T.p.selectOption('.jx-card[data-id="1"] select.jx-verdict', 'real_delay');
  await T.p.waitForTimeout(300);
  await T.p.click('#page-exceptions .sp-head h2'); await T.p.waitForTimeout(300);
  await T.p.evaluate(() => { window.__SAVE_FAIL = false; const r = window.__JT_ISSUES.find(x => x.id === 1); r.staff_note = 'زميل كتب الجديد'; r.staff_rev = 1;
    r.verdict_by_name = 'ebrahim'; r.staff_updated_at = new Date().toISOString(); r.updated_at = r.staff_updated_at;
    (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 1, tracking_no: 'JEG001' } }); });
  await T.p.waitForTimeout(1200);
  const st = await T.p.evaluate(() => ({ val: (document.querySelector('.jx-card[data-id="1"] textarea.jx-note') || {}).value,
    dirty: (() => { const b = document.querySelector('.jx-card[data-id="1"] .jx-save'); return !!b && getComputedStyle(b).display !== 'none'; })() }));
  ok(opt.saved.indexOf('') < 0 && opt.fresh.indexOf('') === 0, '46) الكارت المتصنّف مافيهوش «— اختار —» (التغيير لتصنيف تاني بس) · اللي لسه ماتصنّفش فيه — ' + JSON.stringify(opt));
  ok(st.val === 'زميل كتب الجديد' && !st.dirty, '47) حفظة فشلت وبعدها زميل كتب ملاحظة: الخانة بتعرض الجديد ومفيش «حفظ» معلّق بالقديم (مش هيكتب فوقه) — ' + JSON.stringify(st));
  await T.ctx.close();
}

// ═══ «📣 بلاغاتنا لـJ&T» (8 أكتوبر — طلب المالك) ═══
// الشحنات المتبلّغ عنها (FAKE UPDATE + غلطة من J&T) — اتسلمت بعد البلاغ ولا لأ.
// المتوقع (30 يوم): 31 اتسلمت بعده بـ20 ساعة · 33 لسه (واتكرر عليها 34 بعد البلاغ) · 13 لسه · 32 رجعت · 3 اتسلمت قبل البلاغ
console.log('— بلاغاتنا لـJ&T');
const EXTRA_REP = `(function(){ var now = Date.now(), H = 3600000, ago = function(ms){ return new Date(now - ms).toISOString(); };
  var b = window.__JT_ISSUES.find(function(x){ return x.id === 1; });
  var mk = function(o){ var r = Object.assign({}, b, { verdict:null, staff_note:null, staff_updated_at:null, verdict_by_name:null, verdict_set_by_name:null, verdict_set_at:null,
    staff_rev:0, reviewed_rev:null, review_state:null, review_note:null, reviewed_at:null, reviewed_by_name:null, photo_url:null, courier_note:null,
    outcome:null, outcome_at:null, order_status:'Exception', attempt:1 }, o); r.updated_at = r.updated_at || r.staff_updated_at || r.event_at; return r; };
  window.__JT_ISSUES.push(
    mk({ id:31, tracking_no:'JEG031', order_id:'o31', order_uid:'9031', phone:'01000000031', customer_name:'اتسلمت بعد البلاغ', event_at:ago(32*H),
      verdict:'fake_update', staff_note:'العميل قال محدش جاله', verdict_by_name:'ebrahim', verdict_set_by_name:'ebrahim', staff_updated_at:ago(30*H), verdict_set_at:ago(30*H),
      staff_rev:1, reviewed_rev:1, review_state:'ok', reviewed_by_name:'shekoz', reviewed_at:ago(29*H), outcome:'delivered', outcome_at:ago(10*H), order_status:'Delivered', updated_at:ago(10*H) }),
    mk({ id:32, tracking_no:'JEG032', order_id:'o32', order_uid:'9032', phone:'01000000032', customer_name:'رجعت رغم البلاغ', event_at:ago(52*H), branch:'Giza Hub', courier_name:'سيد',
      verdict:'jt_error', verdict_by_name:'shekoz', verdict_set_by_name:'shekoz', staff_updated_at:ago(50*H), verdict_set_at:ago(50*H), staff_rev:1, reviewed_rev:1, review_state:'self',
      reviewed_by_name:'shekoz', reviewed_at:ago(50*H), outcome:'returning', outcome_at:ago(20*H), order_status:'Returned to business', updated_at:ago(20*H) }),
    mk({ id:33, tracking_no:'JEG033', order_id:'o33', order_uid:'9033', phone:'01000000033', customer_name:'اتكرر بعد البلاغ', event_at:ago(45*H),
      verdict:'fake_update', verdict_by_name:'ebrahim', verdict_set_by_name:'ebrahim', staff_updated_at:ago(40*H), verdict_set_at:ago(40*H), staff_rev:1, reviewed_rev:1, review_state:'ok',
      reviewed_by_name:'shekoz', reviewed_at:ago(39*H) }),
    mk({ id:34, tracking_no:'JEG033', attempt:2, order_id:'o33', order_uid:'9033', phone:'01000000033', customer_name:'اتكرر بعد البلاغ', event_at:ago(5*H),
      reason_code:'205', reason_en:'Change The Delivery Time', reason_ar:'العميل طلب تأجيل', courier_name:'<i id="xss9">م</i>' })
  );
})();`;
const repIds = (p) => p.evaluate(() => [...document.querySelectorAll('#jx-list .jx-rep')].map(c => Number(c.dataset.id)));
async function repProbe(T){
  const p = T.p;
  await p.waitForSelector('#jx-list .jx-card, #jx-list .empt', { timeout: 8000 }).catch(() => {});
  const before = await p.evaluate(() => { const c = document.querySelector('#jx-chips [data-jx-chip="reports"]'); const nn = c.querySelector('.jx-nn');
    return { n: c.querySelector('.n').textContent, nn: nn.hidden ? '' : nn.textContent }; });
  await chip(p, 'reports');
  const inside = await p.evaluate(() => ({ ids: [...document.querySelectorAll('#jx-list .jx-rep')].map(c => Number(c.dataset.id)),
    sum: (document.querySelector('.jx-repsum') || {}).innerText.replace(/\s+/g, ' '),
    groups: [...document.querySelectorAll('.jx-rep-group')].map(g => g.className.replace(/.*g-/, '') + ':' + g.querySelector('.n').textContent),
    c31: (document.querySelector('.jx-rep[data-id="31"]') || {}).textContent.replace(/\s+/g, ' '),
    new31: !!document.querySelector('.jx-rep[data-id="31"] .jx-newtag'), new32: !!document.querySelector('.jx-rep[data-id="32"] .jx-newtag'),
    rpt33: (document.querySelector('.jx-rep[data-id="33"] .jx-rep-rpt') || {}).textContent || '', xss: !!document.getElementById('xss9'),
    nn: document.querySelector('#jx-chips [data-jx-chip="reports"] .jx-nn').hidden,
    visF: ['jx-frep', 'jx-fdays', 'jx-freason', 'jx-fverdict', 'jx-fwho', 'jx-fout', 'jx-export', 'jx-search', 'jx-refresh']
      .filter(i => { const el = document.getElementById(i); return el && getComputedStyle(el).display !== 'none'; }),
    fd: document.getElementById('jx-fdays').value, rb: getComputedStyle(document.getElementById('jx-report-box')).display }));
  await chip(p, 'open');
  const after = await p.evaluate(() => ({ nn: document.querySelector('#jx-chips [data-jx-chip="reports"] .jx-nn').hidden,
    seen: Object.keys(localStorage).filter(k => /^sahl_jx_rep_seen_/.test(k)).length }));
  return { before, inside, after };
}
{
  const T = await open('/exceptions', { post: EXTRA_REP });
  const r = await repProbe(T);
  const p = T.p;
  ok(r.before.n === '5' && r.before.nn === '🆕 1', 'R1) شريحة «📣 بلاغاتنا لـJ&T» = 5 شحنات · و«🆕 1» (اتسلمت بعد البلاغ من آخر 24 ساعة — أول مرة) — ' + JSON.stringify(r.before));
  ok(JSON.stringify(r.inside.ids) === '[31,33,13,32,3]' && r.inside.groups.join() === 'after:1,pending:2,returned:1,before:1',
    'R2) شحنة لكل بوليصة بالمجموعات: اتسلمت بعد البلاغ (31) · لسه مع J&T الأقدم بلاغ فوق (33 ثم 13) · رجعت (32) · قبل البلاغ (3) — ' + JSON.stringify({ ids: r.inside.ids, g: r.inside.groups }));
  ok(/5 شحنة بلّغنا عنها/.test(r.inside.sum) && /FAKE UPDATE 3/.test(r.inside.sum) && /غلطة J&T 2/.test(r.inside.sum) && /1 اتسلمت بعد البلاغ في المتوسط بعد 20 ساعة/.test(r.inside.sum)
    && /1 رجعت رغم البلاغ/.test(r.inside.sum) && /2 لسه مع J&T/.test(r.inside.sum) && /50%/.test(r.inside.sum) && /1 من 2 اتقفلت/.test(r.inside.sum)
    && /🔁 1 شحنة J&T سجّلت عليها استثناء تاني بعد البلاغ/.test(r.inside.sum) && /1 اتسلمت قبل ما نبلّغ/.test(r.inside.sum),
    'R3) الملخص: 5 (FAKE 3 · غلطة J&T 2) · اتسلمت بعده 1 (متوسط 20 ساعة) · رجعت 1 · لسه 2 · اتحلّت 50% (1 من 2) · 🔁 1 · قبل البلاغ 1 مش محسوبة — ' + r.inside.sum.slice(0, 260));
  ok(/اتسلمت بعد البلاغ بـ20 ساعة/.test(r.inside.c31) && /ebrahim بلّغ/.test(r.inside.c31) && /العميل قال محدش جاله/.test(r.inside.c31) && /JEG031/.test(r.inside.c31)
    && r.inside.new31 && !r.inside.new32 && /العميل طلب تأجيل/.test(r.inside.rpt33) && !r.inside.xss,
    'R4) الكارت: «اتسلمت بعد البلاغ بـ20 ساعة» · مين بلّغ وكتب إيه · البوليصة · 🆕 على 31 بس · 33 عليه «🔁 J&T سجّلت استثناء تاني بعد البلاغ: العميل طلب تأجيل» (متهرّب) — ' + JSON.stringify({ c31: r.inside.c31.slice(0, 160), rpt: r.inside.rpt33.slice(0, 120) }));
  ok(r.inside.nn && r.after.nn && r.after.seen === 1, 'R5) جوّه المرحلة «🆕» على الشريحة بيختفي، وبعد ما تخرج مابيرجعش (اتسجّل إنك شفته — sahl_jx_rep_seen_<uid>) — ' + JSON.stringify(r.after));
  ok(r.inside.visF.join() === 'jx-frep,jx-fdays,jx-fout,jx-export,jx-search,jx-refresh' && r.inside.fd === '30' && r.inside.rb === 'none',
    'R6) فلاتر المرحلة: نوع البلاغ · الفترة (افتراضي 30 يوم — مش فترة «الكل») · النتيجة · تصدير · بحث — والتقرير مستخبي — ' + JSON.stringify({ v: r.inside.visF, fd: r.inside.fd }));
  await chip(p, 'reports');
  await p.selectOption('#jx-fout', 'with_jt'); await p.waitForTimeout(150);
  const fo = await repIds(p);
  await p.selectOption('#jx-fout', ''); await p.selectOption('#jx-frep', 'jt_error'); await p.waitForTimeout(150);
  const fr = await repIds(p);
  const frSum = await p.evaluate(() => document.querySelector('.jx-repsum').innerText.replace(/\s+/g, ' '));
  await p.selectOption('#jx-frep', ''); await days(p, 1);
  const f1 = await repIds(p);
  await chip(p, 'all');
  const allDays = await p.evaluate(() => document.getElementById('jx-fdays').value);
  ok(JSON.stringify(fo) === '[33,13]' && JSON.stringify(fr) === '[13,32]' && /2 شحنة بلّغنا عنها/.test(frSum) && JSON.stringify(f1) === '[13,3]' && allDays === '7',
    'R7) «لسه مع J&T» = [33،13] · «غلطة من J&T» = [13،32] والملخص بقى 2 · الفترة «النهارده» بتاريخ البلاغ = [13،3] · «الكل» لسه على 7 أيام بتاعتها — ' + JSON.stringify({ fo, fr, f1, allDays }));
  await chip(p, 'reports'); await days(p, 30);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#jx-export')]);
  const rcsv = fs.readFileSync(await dl.path(), 'utf8').split('\r\n').filter(Boolean);
  const copy = await p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); const l = m.jxReportFilter(m.jxReportedShipments(m.jxRows), { repDays: 30, q: '', out: '', rep: '' }, Date.now());
    return m.jxReportCopyText(l, m.jxReportTotals(l), { repDays: 30 }, Date.now()); });
  const r31 = rcsv.find(l => /JEG031/.test(l)) || '';
  ok(rcsv.length === 6 && /reports-/.test(dl.suggestedFilename()) && /وقت البلاغ/.test(rcsv[0]) && /النتيجة/.test(rcsv[0]) && /استثناء تاني بعد البلاغ/.test(rcsv[0])
    && /اتسلمت بعد البلاغ/.test(r31) && /,20,/.test(r31) && r31.includes('=""01000000031""')
    && /بلّغنا عن 5 شحنة/.test(copy) && /اتسلم بعد البلاغ: 1/.test(copy) && /اتحلّت 50%/.test(copy) && /JEG032 — رجعت — Giza Hub — سيد/.test(copy) && /JEG033 — اتكرر الاستثناء 1 مرة/.test(copy),
    'R8) التصدير = صف لكل شحنة بأعمدة البلاغ (وقت البلاغ · النتيجة · بعد 20 ساعة · التليفون نص) · «📋 نسخ الملخص لـJ&T» فيه الأرقام والشحنات اللي المشكلة فضلت فيها (الفرع والمندوب) — ' + JSON.stringify({ n: rcsv.length, h: rcsv[0].slice(0, 120), r31: r31.slice(0, 160), copy: copy.slice(0, 160) }));
  await chip(p, 'done');
  const strip = await p.evaluate(() => (document.querySelector('.jx-card[data-id="31"] .jx-m-rep') || {}).textContent || '');
  ok(/نتيجة البلاغ/.test(strip) && /اتسلمت بعد البلاغ بـ20 ساعة/.test(strip), 'R9) في باقي المراحل الكارت المتبلّغ عنه عليه سطر «📣 نتيجة البلاغ: ✅ اتسلمت بعد البلاغ بـ20 ساعة» — ' + strip.trim().slice(0, 120));
  // R10) شحنة بلّغنا عنها (13) اتسلمت دلوقتي على الريل-تايم → toast فوري
  // التسليم اتمسح من نص ساعة (قبل آخر مرة فتحنا المرحلة) ووصلنا دلوقتي — لازم يتعلّم «🆕» برضه
  await p.evaluate(() => { const r = window.__JT_ISSUES.find(x => x.id === 13); r.outcome = 'delivered'; r.outcome_at = new Date(Date.now() - 30 * 60000).toISOString(); r.order_status = 'Delivered'; r.updated_at = new Date().toISOString();
    (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 13, tracking_no: 'JEG011' } }); });
  await p.waitForTimeout(1000);
  const t10 = await p.evaluate(() => ({ toast: document.getElementById('toast').textContent, nn: (() => { const nn = document.querySelector('#jx-chips [data-jx-chip="reports"] .jx-nn'); return nn.hidden ? '' : nn.textContent; })() }));
  await chip(p, 'reports');
  const t10b = await p.evaluate(() => ({ tag13: !!document.querySelector('.jx-rep[data-id="13"] .jx-newtag'), tag31: !!document.querySelector('.jx-rep[data-id="31"] .jx-newtag') }));
  await chip(p, 'open');
  const t10c = await p.evaluate(() => document.querySelector('#jx-chips [data-jx-chip="reports"] .jx-nn').hidden);
  ok(/شحنة بلّغنا عنها J&T اتسلمت/.test(t10.toast) && t10.nn === '🆕 1' && t10b.tag13 && !t10b.tag31 && t10c,
    'R10) شحنة متبلّغ عنها اتسلمت على الريل-تايم (مسح التسليم أقدم من آخر زيارة — وصل متأخر): toast + «🆕 1» · جوّه المرحلة 🆕 على 13 بس (31 اتشافت قبل كده) · وبعد الخروج اتصفّرت — ' + JSON.stringify({ t10, t10b, t10c }));
  ok(p.__errs.length === 0, 'R11) صفر أخطاء جافاسكربت في مرحلة البلاغات — ' + (p.__errs[0] || 'نضيف'));
  await T.ctx.close();
}

// R12–R17: المراجعة العدائية — رجعت قبل البلاغ · رجعت والسبب من العميل · وقت البلاغ مابيتحركش مع تغيير النوع · التسليم من استعلام الشارة
const EXTRA_REP2 = `(function(){ var now = Date.now(), H = 3600000, ago = function(ms){ return new Date(now - ms).toISOString(); };
  var b = window.__JT_ISSUES.find(function(x){ return x.id === 1; });
  var mk = function(o){ var r = Object.assign({}, b, { verdict:null, staff_note:null, staff_updated_at:null, verdict_by_name:null, verdict_set_by_name:null, verdict_set_at:null,
    reported_at:null, return_started_at:null, staff_rev:0, reviewed_rev:null, review_state:null, review_note:null, reviewed_at:null, reviewed_by_name:null, photo_url:null,
    courier_note:null, outcome:null, outcome_at:null, order_status:'Exception', attempt:1 }, o); r.updated_at = r.updated_at || r.staff_updated_at || r.event_at; return r; };
  var ok1 = { staff_rev:1, reviewed_rev:1, review_state:'ok', reviewed_by_name:'shekoz' };
  window.__JT_ISSUES.push(
    // 35: بدأت ترجع (172) قبل ما نبلّغ بـ10 ساعات
    mk(Object.assign({ id:35, tracking_no:'JEG035', order_id:'o35', order_uid:'9035', phone:'01000000035', customer_name:'رجعت قبل البلاغ', event_at:ago(60*H),
      verdict:'fake_update', verdict_by_name:'ebrahim', verdict_set_by_name:'ebrahim', staff_updated_at:ago(40*H), verdict_set_at:ago(40*H), reported_at:ago(40*H),
      reviewed_at:ago(39*H), outcome:'returning', outcome_at:ago(50*H), return_started_at:ago(50*H), order_status:'Returned to business' }, ok1)),
    // 36 + 37: بلّغنا · المحاولة 2 الفريق أكّد إنه رفض حقيقي · ورجعت
    mk(Object.assign({ id:36, tracking_no:'JEG036', order_id:'o36', order_uid:'9036', phone:'01000000036', customer_name:'رجعت بسبب العميل', event_at:ago(70*H),
      verdict:'fake_update', verdict_by_name:'ebrahim', verdict_set_by_name:'ebrahim', staff_updated_at:ago(68*H), verdict_set_at:ago(68*H), reported_at:ago(68*H),
      reviewed_at:ago(67*H), outcome:'returned', outcome_at:ago(5*H), return_started_at:ago(20*H), order_status:'Returned to business' }, ok1)),
    mk(Object.assign({ id:37, tracking_no:'JEG036', attempt:2, order_id:'o36', order_uid:'9036', phone:'01000000036', customer_name:'رجعت بسبب العميل', event_at:ago(30*H),
      reason_code:'1002', reason_en:'Customer refuse by call', reason_ar:'العميل رفض في التليفون',
      verdict:'real_refusal', staff_note:'كلمته وأكّد إنه مش عايزه', verdict_by_name:'ebrahim', verdict_set_by_name:'ebrahim', staff_updated_at:ago(29*H), verdict_set_at:ago(29*H),
      reviewed_at:ago(28*H), outcome:'returned', outcome_at:ago(5*H), return_started_at:ago(20*H), order_status:'Returned to business' }, ok1)),
    // 38: بلّغنا من 30 ساعة (FAKE UPDATE) وبعدين اتغيّر لـ«غلطة من J&T» من 3 ساعات — اتسلمت من 10 ساعات = بعد البلاغ مش قبله
    mk(Object.assign({ id:38, tracking_no:'JEG038', order_id:'o38', order_uid:'9038', phone:'01000000038', customer_name:'نوع البلاغ اتغيّر', event_at:ago(32*H),
      verdict:'jt_error', verdict_by_name:'shekoz', verdict_set_by_name:'shekoz', staff_updated_at:ago(3*H), verdict_set_at:ago(3*H), reported_at:ago(30*H),
      reviewed_at:ago(3*H), outcome:'delivered', outcome_at:ago(10*H), order_status:'Delivered' }, ok1))
  );
})();`;
{
  const T = await open('/exceptions', { post: EXTRA_REP + EXTRA_REP2 });
  const p = T.p;
  await p.waitForSelector('#jx-list .jx-card, #jx-list .empt', { timeout: 8000 }).catch(() => {});
  await chip(p, 'reports');
  const b = await p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js');
    const l = m.jxReportedShipments(m.jxRows); const o = {}; l.forEach(s => { o[s.bill] = s.bucket + '/' + s.repeats.length + '/' + s.custLater.length; });
    const t = m.jxReportTotals(m.jxReportFilter(l, { repDays: 30, q: '', out: '', rep: '' }, Date.now()));
    return { o, closed: t.closed, after: t.after, returned: t.returned, ret_cust: t.ret_cust, ret_before: t.ret_before,
      sum: document.querySelector('.jx-repsum').innerText.replace(/\s+/g, ' '),
      c36: (document.querySelector('.jx-rep[data-id="37"]') || document.querySelector('.jx-rep[data-id="36"]') || {}).textContent || '',
      groups: [...document.querySelectorAll('.jx-rep-group')].map(g => g.className.replace(/.*g-/, '')) }; });
  ok(b.o.JEG035 === 'ret_before/0/0' && b.o.JEG032 === 'returned/0/0',
    'R12) بدأت ترجع (172) قبل ما نبلّغ = «كانت بدأت ترجع قبل البلاغ» مش «رجعت رغم البلاغ» (مش محسوبة على J&T) — ' + JSON.stringify(b.o));
  ok(b.o.JEG036 === 'ret_cust/0/1' && b.o.JEG033 === 'pending/1/0' && /المحاولة 2 اتصنّفت/.test(b.c36) && /رفض حقيقي/.test(b.c36) && /مش محسوبة على J&T/.test(b.c36),
    'R13) محاولة بعد البلاغ الفريق صنّفها «رفض حقيقي» مابتتعدّش «🔁 اتكرر» والمرتجع = «السبب من العميل» (مش على J&T) · واللي لسه محدش صنّفها بتتعد — ' + JSON.stringify({ o: b.o, c36: b.c36.slice(0, 200) }));
  ok(b.o.JEG038 === 'after/0/0' && b.after === 2 && b.returned === 1 && b.closed === 3 && /67%/.test(b.sum) && /1 رجعت والسبب من العميل/.test(b.sum) && /1 كانت بدأت ترجع قبل البلاغ/.test(b.sum)
    && b.groups.indexOf('ret_cust') > b.groups.indexOf('returned') && b.groups.indexOf('ret_before') > b.groups.indexOf('ret_cust') && b.groups[0] === 'after',
    'R14) وقت البلاغ = reported_at (FAKE UPDATE من 30 ساعة → غلطة J&T من 3) فالتسليم من 10 ساعات «بعد البلاغ» · اتحلّت 67% (2 من 3 — من غير السبب من العميل وقبل البلاغ) · المجموعات بالترتيب — ' + JSON.stringify({ o38: b.o.JEG038, closed: b.closed, groups: b.groups, sum: b.sum.slice(0, 220) }));
  const copyJ = await p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); const now = Date.now();
    const l = m.jxReportFilter(m.jxReportedShipments(m.jxRows), { repDays: 30, q: '', out: '', rep: 'jt_error' }, now);
    return m.jxReportCopyText(l, m.jxReportTotals(l), { repDays: 30, rep: 'jt_error' }, now).split('\n')[0]; });
  ok(/\(غلطة من J&T\)/.test(copyJ) && !/FAKE UPDATE/.test(copyJ), 'R15) الملخص المنسوخ بفلتر «غلطة من J&T» عنوانه النوع ده بس (مش الاتنين) — ' + copyJ);
  ok(p.__errs.length === 0, 'R16) صفر أخطاء جافاسكربت — ' + (p.__errs[0] || 'نضيف'));
  await T.ctx.close();
}
{
  // R17) التاب ماتفتحتش (صفحة الأوردرات): شحنة متبلّغ عنها اتسلمت على الريل-تايم → toast برضه (من استعلام الشارة)
  const T = await open('/orders', { post: EXTRA_REP });
  await T.p.waitForTimeout(600);
  await T.p.evaluate(() => { const r = window.__JT_ISSUES.find(x => x.id === 13); r.outcome = 'delivered'; r.outcome_at = new Date(Date.now() - 5 * 60000).toISOString(); r.order_status = 'Delivered'; r.updated_at = new Date().toISOString();
    (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 13, tracking_no: 'JEG011' } }); });
  await T.p.waitForTimeout(1300);
  const t = await T.p.evaluate(() => document.getElementById('toast').textContent);
  ok(/شحنة بلّغنا عنها J&T اتسلمت/.test(t) && /JEG011/.test(t), 'R17) والموظف على صفحة الأوردرات (تاب الاستثناءات ماتفتحتش): التسليم بيطلّع toast برضه — ' + t);
  await T.ctx.close();
}

// ═══ صوت التنبيه (8 أكتوبر — طلب المالك) ═══
console.log('— صوت التنبيه');
const NEW50 = () => { const b0 = window.__JT_ISSUES.find(x => x.id === 1); const r = Object.assign({}, b0, { id: 50, tracking_no: 'JEG050', attempt: 1, order_id: 'o50', order_uid: '9050',
  customer_name: 'عميل جديد', event_at: new Date(Date.now() - 60000).toISOString(), updated_at: new Date().toISOString(), reason_ar: 'العميل رفض في التليفون' });
  window.__JT_ISSUES.push(r); (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'INSERT', new: { id: 50, tracking_no: 'JEG050' } }); };
async function soundProbe(o){
  const T = await open('/orders', o);
  await T.p.waitForTimeout(500);
  await T.p.waitForTimeout(1000);
  const a0 = await T.p.evaluate(() => window.__ALERTS);
  const t0 = await T.p.evaluate(() => document.getElementById('toast').textContent);
  await T.p.evaluate(NEW50);
  await T.p.waitForTimeout(1500);
  const a1 = await T.p.evaluate(() => ({ n: window.__ALERTS, toast: document.getElementById('toast').textContent }));
  // نفس الصف تاني (حدث تحديث عليه) = مفيش رنّة تانية
  await T.p.evaluate(() => { const r = window.__JT_ISSUES.find(x => x.id === 50); r.verdict = 'real_delay'; r.updated_at = new Date().toISOString();
    (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 50, tracking_no: 'JEG050' } }); });
  await T.p.waitForTimeout(1500);
  const a2 = await T.p.evaluate(() => window.__ALERTS);
  return { T, a0, t0, a1, a2 };
}
{
  const r = await soundProbe();
  ok(r.a0 === 0 && !/استثناء/.test(r.t0) && r.a1.n === 1 && /استثناء جديد من J&T: العميل رفض في التليفون — عميل جديد/.test(r.a1.toast) && r.a2 === 1,
    'S1) على صفحة الأوردرات (تاب الاستثناءات ماتفتحتش): اللي موجود وقت الفتح مابيرنّش ولا بيطلّع toast · استثناء جديد = رنّة واحدة + toast «🔔 استثناء جديد من J&T: السبب — العميل» · تحديث نفس الصف مابيرنّش تاني — ' + JSON.stringify({ a0: r.a0, t0: r.t0, a1: r.a1, a2: r.a2 }));
  await r.T.ctx.close();
}
{
  const r = await soundProbe({ pre: "window.__NOTIFY_PREFS = { jx_sound: false };" });
  ok(r.a1.n === 0 && /استثناء جديد/.test(r.a1.toast), 'S2) الأدمن قفل الصوت للفريق (jx_sound=false): مفيش رنّة — والـtoast فاضل — ' + JSON.stringify(r.a1));
  await r.T.ctx.close();
}
{
  const r = await soundProbe({ pre: "try{ localStorage.setItem('sahl_jx_sound', '0'); }catch(e){}" });
  ok(r.a1.n === 0, 'S3) الصوت مكتوم على الجهاز ده (sahl_jx_sound=0): مفيش رنّة — ' + JSON.stringify(r.a1));
  await r.T.ctx.close();
}
{
  const r = await soundProbe({ pre: "try{ localStorage.setItem('sahl_jx_beep_last', '50'); }catch(e){}" });
  ok(r.a1.n === 0, 'S4) تاب تانية (المحادثات) رنّت على نفس الاستثناء (sahl_jx_beep_last ≥ id): مفيش رنّة مكررة — ' + JSON.stringify(r.a1));
  await r.T.ctx.close();
}
{
  // S5) الإعدادات: الاتنين شغّالين افتراضياً · قفل «للفريق» بيكتب jx_sound=false ويوقف الرنّة فوراً · «الجهاز ده» في localStorage · «جرّب الصوت» بيرنّ
  const T = await open('/settings');
  const p = T.p;
  await p.waitForSelector('#set-jx-sound-team', { state: 'visible', timeout: 8000 });
  await p.waitForTimeout(400);
  const d0 = await p.evaluate(() => ({ team: document.getElementById('set-jx-sound-team').checked, dev: document.getElementById('set-jx-sound-device').checked }));
  const hit = await p.evaluate(() => { const el = document.querySelector('label[for="set-jx-sound-team"]'); el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(at && el.contains(at)); });
  await p.click('label[for="set-jx-sound-team"]'); await p.waitForTimeout(300);
  const saves = await p.evaluate(() => window.__PREF_SAVES);
  await p.click('#set-jx-sound-test'); await p.waitForTimeout(300);
  const tested = await p.evaluate(() => window.__ALERTS);
  await p.evaluate(NEW50); await p.waitForTimeout(1500);
  const afterOff = await p.evaluate(() => window.__ALERTS);
  await p.click('label[for="set-jx-sound-device"]'); await p.waitForTimeout(200);
  const dev = await p.evaluate(() => localStorage.getItem('sahl_jx_sound'));
  ok(d0.team && d0.dev && hit && saves.length === 1 && saves[0].p_prefs && saves[0].p_prefs.jx_sound === false && tested === 1 && afterOff === 1 && dev === '0',
    'S5) الإعدادات: كارت «🔔 صوت تنبيه الاستثناءات» (hit-test) · الاتنين شغّالين افتراضياً · قفل «للفريق كله» = update_notify_prefs({jx_sound:false}) والاستثناء الجديد بعدها مارنّش · «▶️ جرّب الصوت» رنّ · «الجهاز ده» = localStorage — ' + JSON.stringify({ d0, hit, saves, tested, afterOff, dev }));
  ok(p.__errs.length === 0, 'S6) صفر أخطاء جافاسكربت في الإعدادات — ' + (p.__errs[0] || 'نضيف'));
  await T.ctx.close();
}

const SUSP = "window.AudioContext = function(){ this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }; window.AudioContext.prototype.resume = function(){ return Promise.resolve(); }; window.webkitAudioContext = window.AudioContext;";
{
  // S7) التاب دي الصوت فيها مقفول من المتصفح (لسه محدش لمسها) → مابتحجزش الرنّة (التابات التانية ترنّ)
  const r = await soundProbe({ pre: SUSP });
  const last = await r.T.p.evaluate(() => localStorage.getItem('sahl_jx_beep_last'));
  ok(r.a1.n === 0 && last !== '50', 'S7) تاب الصوت فيها ممنوع: مارنّتش ومحجزتش الرنّة (sahl_jx_beep_last ماتكتبش) — تاب تانية جاهزة هي اللي ترنّ — ' + JSON.stringify({ n: r.a1.n, last }));
  await r.T.ctx.close();
}
{
  // S8) الأدمن قفل الصوت من جهاز تاني والتاب دي مفتوحة من بدري → قبل ما ترنّ بتسأل تاني (آخر قراية أقدم من دقيقة)
  const T = await open('/orders');
  await T.p.waitForTimeout(500);
  await T.p.evaluate(() => { window.__NOTIFY_PREFS = { jx_sound: false }; });
  const t0 = await T.p.evaluate(() => Date.now());
  await T.ctx.clock.setFixedTime(new Date(t0 + 120000));
  await T.p.evaluate(NEW50);
  await T.p.waitForTimeout(1500);
  const n = await T.p.evaluate(() => window.__ALERTS);
  ok(n === 0, 'S8) إعداد الفريق اتقفل من جهاز تاني: التاب المفتوحة قرت الإعداد تاني قبل ما ترنّ ومارنّتش — ' + n);
  await T.ctx.close();
}
{
  // S9) الموظف (مالوش إعدادات) يكتم جهازه من زرار 🔔 في التاب
  const T = await open('/exceptions', { role: 'employee' });
  await T.p.waitForSelector('#jx-sound', { state: 'visible' });
  const hit = await T.p.evaluate(() => { const el = document.getElementById('jx-sound'); const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(at && el.contains(at)); });
  const before = await T.p.evaluate(() => document.getElementById('jx-sound').textContent);
  await T.p.click('#jx-sound'); await T.p.waitForTimeout(150);
  const st = await T.p.evaluate(() => ({ t: document.getElementById('jx-sound').textContent, ls: localStorage.getItem('sahl_jx_sound') }));
  await T.p.evaluate(NEW50); await T.p.waitForTimeout(1500);
  const n = await T.p.evaluate(() => window.__ALERTS);
  ok(hit && before === '🔔' && st.t === '🔕' && st.ls === '0' && n === 0, 'S9) زرار 🔔 في التاب لكل الأدوار (hit-test): الموظف كتم جهازه → 🔕 + sahl_jx_sound=0 والاستثناء الجديد مارنّش — ' + JSON.stringify({ hit, before, st, n }));
  await T.ctx.close();
}

// ═══ المعايرات ═══
console.log('— المعايرات');
async function calib(label, patches, probe, expectFail, o){
  const T = await open((o && o.path) || '/exceptions', Object.assign({ patches, stage: 'open' }, o || {}));
  await T.p.waitForSelector('#jx-list .jx-card', { timeout: 8000 }).catch(() => {});
  const r = await probe(T);
  await T.ctx.close();
  ok(expectFail(r), label);
}
await calib('(أ) من غير «اتصنّفت محاولة أحدث» → 9 رجع للطابور (الفحص 4 كان هيقع)',
  { exc: s => s.replace('  if(jxSuperseded(r, lv)) return false;\n', '') },
  T => cardIds(T.p), ids => ids.indexOf(9) >= 0);
await calib('(ب) النتيجة من مسحات J&T بس (من غير حالة الأوردر) → الملغي والمتعلّم متسلّم رجعوا (الفحص 4 كان هيقع)',
  { exc: s => s.replace("  var st = r.order_status;\n  if(statusIn(st, DELIVERED_STATUSES)) return 'delivered';", "  var st = r.order_status;\n  if(false) return 'delivered';") },
  T => cardIds(T.p), ids => ids.indexOf(8) >= 0);
await calib('(ج) من غير esc على كلام المندوب → الـHTML اترسم (الفحص 9 كان هيقع)',
  { exc: s => s.replace("'<div class=\"jx-cnote\">📝 المندوب كتب: «' + esc(r.courier_note) + '»</div>'", "'<div class=\"jx-cnote\">📝 المندوب كتب: «' + r.courier_note + '»</div>'") },
  T => T.p.evaluate(() => !!document.getElementById('xss1')), x => x === true);
await calib('(د) jt_issues على قناة الأوردرات → الفحص 2 كان هيقع',
  { exc: s => s.replace("sb.channel('jt-issues-' + currentTenantId)", "sb.channel('orders-realtime-' + currentTenantId)") },
  T => T.p.evaluate(() => (window.__RT_ON || []).filter(h => h.opts && h.opts.table === 'jt_issues').map(h => h.channel)), ch => !/^jt-issues-/.test(ch[0] || ''));
await calib('(هـ) الرسم بيدوس على الخانة اللي في إيد الموظف → الفحص 19 كان هيقع',
  { exc: s => s.replace('  if(jxEditing() || (!own && jxPointerBusy())){\n', '  if(false){\n').replace("  if(!force && jxEditing()){ jxPendingRender = true; return; }", '') },
  async T => {
    await T.p.click('.jx-card[data-id="12"] textarea.jx-note');
    await T.p.keyboard.type('x');
    await T.p.evaluate(() => { window.__JT_ISSUES.push(Object.assign({}, window.__JT_ISSUES[0], { id: 21, tracking_no: 'JEG021', event_at: new Date(Date.now() - 1000).toISOString(), updated_at: new Date().toISOString() }));
      (window.__RT_ON || []).find(x => x.opts && x.opts.table === 'jt_issues').cb({ eventType: 'INSERT', new: { id: 21, tracking_no: 'JEG021' } }); });
    await T.p.waitForTimeout(1000);
    return T.p.evaluate(() => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.jx-card[data-id="12"]')));
  }, focused => focused === false);
await calib('(و) wa_id بيسيب الصفر → الشات مايلاقيش العميل (الفحص 20 كان هيقع)',
  { inbox: s => s.replace("if(d.indexOf('0')===0 && d.length===11) return '20'+d.slice(1);", "if(d.indexOf('0')===0 && d.length===11) return '20'+d;") },
  async T => {
    const [tab] = await Promise.all([T.ctx.waitForEvent('page'), T.p.click('.jx-card[data-id="1"] [data-jx="chat"]')]);
    await tab.waitForLoadState('networkidle'); await tab.waitForTimeout(800);
    return tab.evaluate(() => (document.getElementById('wa-chat-name') || {}).textContent || '');
  }, name => name !== 'أحمد سامي');
await calib('(ز) من غير فحص انتهاء الصورة → لينك ميت ظهر (الفحص 8ج كان هيقع)',
  { exc: s => s.replace('    if(isFinite(t) && t < now) return { expired: true };\n', '') },
  async T => { await chip(T.p, 'all'); return T.p.evaluate(() => !!document.querySelector('.jx-card[data-id="13"] a.jx-photo')); }, x => x === true);
await calib('(ح) من غير حارس CSV injection → =1+1 اتصدّرت معادلة (الفحص 24 كان هيقع)',
  { exc: s => s.replace("  if(/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s;\n", '') },
  T => T.p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); return m.jxCsv(m.jxRows); }), csvx => !/'=1\+1/.test(csvx));
await calib('(ي) تعطيل الاختيار وقت الحفظ → الـfocus بيروح والكارت بيتسحب قبل ما يكتب (الفحص 15ب كان هيقع)',
  { exc: s => s.replace("  if(card) card.classList.add('is-saving');", "  if(card){ card.classList.add('is-saving'); var dz = card.querySelector('select.jx-verdict'); if(dz) dz.disabled = true; }") },
  async T => {
    await T.p.focus('.jx-card[data-id="2"] select.jx-verdict');
    await T.p.selectOption('.jx-card[data-id="2"] select.jx-verdict', 'fake_update');
    await T.p.waitForTimeout(300);
    return T.p.evaluate(() => !!document.querySelector('.jx-card[data-id="2"]'));
  }, still => still === false);
await calib('(ط) الطابور بيتقيّد بالفترة → العالق من 20 يوم اختفى (الفحص 4 كان هيقع)',
  { exc: s => s.replace("      if(!jxNeedsFollow(r, lv, now)) continue;\n", "      if(!jxNeedsFollow(r, lv, now)) continue;\n      if(!(r._ymd >= from)) continue;\n") },
  T => cardIds(T.p), ids => ids.indexOf(11) < 0);

await calib('(ك) مهلة «راجعة» من الاستثناء مش من بداية المرتجع → الفحص 30 كان هيقع',
  { exc: s => s.replace("var rs = (r.outcome === 'returning' && r.outcome_at) ? Date.parse(r.outcome_at) : t;", 'var rs = t;') },
  T => T.p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); const D = 86400000, now = Date.now();
    return m.jxNeedsFollow({ kind:'exception', verdict:null, tracking_no:'JX-T', event_at:new Date(now - 9 * D).toISOString(), outcome:'returning', outcome_at:new Date(now - 2 * D).toISOString() }, {}, now); }),
  x => x === false);
await calib('(ل) فحص «مفيش تغيير» قبل «الحفظ في السكة» → FAKE UPDATE اتسجّل باسمه (الفحص 31 كان هيقع)',
  { exc: s => s.replace("  if(jxSaving[id]){ jxResave[id] = true; return; }\n  var verdict = jxWantVerdict(r);", "  var verdict = jxWantVerdict(r);")
                .replace("    jxSyncActionUi(card, r, jxSuperseded(r, jxLatestVerdictAt(jxRows)), Date.now());\n    return;\n  }\n  jxSaving[id] = true;", "    jxSyncActionUi(card, r, jxSuperseded(r, jxLatestVerdictAt(jxRows)), Date.now());\n    return;\n  }\n  if(jxSaving[id]){ jxResave[id] = true; return; }\n  jxSaving[id] = true;") },
  async T => {
    await T.p.evaluate(() => { window.__SAVE_DELAY = 400; });
    await T.p.focus('.jx-card[data-id="11"] select.jx-verdict');
    await T.p.selectOption('.jx-card[data-id="11"] select.jx-verdict', 'fake_update');
    await T.p.waitForTimeout(80);
    await T.p.selectOption('.jx-card[data-id="11"] select.jx-verdict', '');
    await T.p.waitForTimeout(1300);
    return T.p.evaluate(() => window.__JT_ISSUES.find(x => x.id === 11).verdict);
  }, v => v === 'fake_update');

await calib('(م) من غير قاعدة «المترجّعة» في jxNeedsFollow → 16 مش في «محتاجة تعامل» (الفحص 4 كان هيقع)',
  { exc: s => s.replace('  if(jxSentBack(r)) return true;\n', '') },
  T => cardIds(T.p), ids => ids.indexOf(16) < 0);
await calib('(ن) «✓ تمام» من غير الـrev اللي اتشاف → stale مستحيل يتكشف (الفحص 38 كان هيقع)',
  { exc: s => s.replace("p_seen_rev: action === 'undo' ? null : seenRev", 'p_seen_rev: null') },
  async T => { await chip(T.p, 'review'); await T.p.click('.jx-card[data-id="10"] [data-jx="rv-ok"]'); await T.p.waitForTimeout(300); return T.p.evaluate(() => window.__REVIEWS[0] && window.__REVIEWS[0].p_seen_rev); },
  v => v !== 1);
await calib('(س) أزرار المراجعة للموظف → الفحص 42 كان هيقع',
  { exc: s => s.replace("  if(!jxIsAdmin() || jxEditOpen[r.id]", "  if(jxEditOpen[r.id]") },
  async T => { await chip(T.p, 'review'); return T.p.evaluate(() => document.querySelectorAll('#jx-list [data-jx^="rv-"]').length); },
  n => n > 0, { role: 'employee' });
await calib('(ع) فلتر السبب بيتطبّق برّه «الكل» → متعلّق من «الكل» بيقصّ «محتاجة تعامل» (الفحص 37 كان هيقع)',
  { exc: s => s.replace("    if(q && !jxMatches(r, q, qd)) continue;\n    out.push(r);", "    if(f.reason && (r.reason_ar || '') !== f.reason) continue;\n    if(q && !jxMatches(r, q, qd)) continue;\n    out.push(r);") },
  async T => { await chip(T.p, 'all'); await T.p.selectOption('#jx-freason', 'العميل طلب تأجيل'); await T.p.waitForTimeout(100); await chip(T.p, 'open'); return cardIds(T.p); },
  ids => ids.length !== 7);
await calib('(ف) الحفظ مابيطبّقش رد السيرفر → الأدمن صنّف والكارت فاضل في الطابور (الفحص 15ج كان هيقع)',
  { exc: s => s.replace("    var d = res.data;\n    jxApplyServer(r, d);\n    delete jxLogCache[id];", "    var d = res.data;\n    delete jxLogCache[id];") },
  async T => {
    await T.p.focus('.jx-card[data-id="2"] select.jx-verdict');
    await T.p.selectOption('.jx-card[data-id="2"] select.jx-verdict', 'fake_update');
    await T.p.waitForTimeout(250);
    await T.p.click('#page-exceptions .sp-head h2'); await T.p.waitForTimeout(450);
    return cardIds(T.p);
  }, ids => ids.indexOf(2) >= 0);

await calib('(ص) من غير حارس «نسخة أقدم» في jxMerge → الجلب القديم رجّع الكارت لـ«مستنية مراجعتك» (الفحص 43 كان هيقع)',
  { exc: s => s.replace("    } else if(jxOlderSnapshot(n, old)){\n", "    } else if(false){\n") },
  async T => {
    await chip(T.p, 'review');
    await T.p.evaluate(() => { window.__OLD10 = JSON.parse(JSON.stringify(window.__JT_ISSUES.find(x => x.id === 10))); });
    await T.p.click('.jx-card[data-id="10"] [data-jx="rv-ok"]'); await T.p.waitForTimeout(300);
    await T.p.evaluate(() => { const i = window.__JT_ISSUES.findIndex(x => x.id === 10); window.__JT_ISSUES[i] = window.__OLD10;
      (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 10, tracking_no: 'JEG008' } }); });
    await T.p.waitForTimeout(1000);
    return T.p.evaluate(() => document.querySelector('#jx-chips [data-jx-chip="review"] .n').textContent);
  }, n => n !== '0');
await calib('(ق) «مين اختار» من آخر واحد حفظ (verdict_by_name) → «ebrahim اختار» بقت «شيكو اختار» (الفحص 44 كان هيقع)',
  { exc: s => s.replace("var setBy = r.verdict_set_by_name || r.verdict_by_name || 'موظف'", "var setBy = r.verdict_by_name || 'موظف'") },
  T => T.p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); const now = Date.now();
    return m.jxMetaHtml({ id: 99, tracking_no: 'JX99', verdict: 'fake_update', staff_note: 'x', verdict_set_by_name: 'ebrahim', verdict_set_at: new Date(now - 4 * 3600000).toISOString(),
      verdict_by_name: 'شيكو', staff_updated_at: new Date(now - 3600000).toISOString(), staff_rev: 2, reviewed_rev: 2, review_state: 'ok' }, false, now).replace(/<[^>]+>/g, ''); }),
  t => !/ebrahim اختار/.test(t));

await calib('(ر) من غير «الكارت يفضل مكانه» بعد المراجعة → الطابور اتحرك تحت إيد الأدمن (الفحص 38 كان هيقع)',
  { exc: s => s.replace("    if(jxFilter.chip === 'review' || jxFilter.chip === 'done') jxHold[id] = jxFilter.chip;\n", '') },
  async T => { await chip(T.p, 'review'); await T.p.click('.jx-card[data-id="10"] [data-jx="rv-ok"]'); await T.p.waitForTimeout(300);
    return T.p.evaluate(() => !!document.querySelector('.jx-card[data-id="10"]')); }, has => has === false);

await calib('(ش) من غير حارس الماوس في طابور المراجعة → الكارت اتحرك من تحت «✓ تمام» (الفحص 45 كان هيقع)',
  { exc: s => s.replace("  return jxFilter.chip === 'review' && (jxPointerIn || jxPointerMoving);", '  return false;') },
  async T => { const r = await pointerProbe(T); return r.during; }, d => JSON.stringify(d) !== '[10,18]', { stage: null, post: EXTRA18 });
await calib('(ت) «— اختار —» على التصنيف المحفوظ → الموظف يقدر يمسح مراجعة الأدمن (الفحص 46 كان هيقع)',
  { exc: s => s.replace("  var opts = (r.verdict && v) ? '' : '<option value=\"\">— اختار —</option>';", "  var opts = '<option value=\"\">— اختار —</option>';") },
  T => T.p.evaluate(() => [...document.querySelectorAll('.jx-card[data-id="16"] select.jx-verdict option')].map(o => o.value).indexOf('')), i => i >= 0, { role: 'employee' });
await calib('(ث) المسودة بتتسجّل حتى لو نفس المحفوظ → بعد حفظة فشلت الخانة فضلت بالقديم وزرار «حفظ» معلّق (الفحص 47 كان هيقع)',
  { exc: s => s.replace("    if(String(ta.value).trim() !== String(r.staff_note || '').trim()) jxDrafts[id] = ta.value;\n    else delete jxDrafts[id];", '    jxDrafts[id] = ta.value;')
                .replace("    if(jxDrafts[id] !== undefined && String(jxDrafts[id]).trim() === String(r.staff_note || '').trim()) delete jxDrafts[id];\n    // شكل عمود الإجراء", '    // شكل عمود الإجراء') },
  async T => {
    await T.p.evaluate(() => { window.__SAVE_FAIL = true; });
    await T.p.focus('.jx-card[data-id="1"] select.jx-verdict');
    await T.p.selectOption('.jx-card[data-id="1"] select.jx-verdict', 'real_delay');
    await T.p.waitForTimeout(300); await T.p.click('#page-exceptions .sp-head h2'); await T.p.waitForTimeout(300);
    await T.p.evaluate(() => { window.__SAVE_FAIL = false; const r = window.__JT_ISSUES.find(x => x.id === 1); r.staff_note = 'زميل كتب الجديد'; r.staff_rev = 1;
      r.verdict_by_name = 'ebrahim'; r.staff_updated_at = new Date().toISOString(); r.updated_at = r.staff_updated_at;
      (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 1, tracking_no: 'JEG001' } }); });
    await T.p.waitForTimeout(1200);
    return T.p.evaluate(() => (document.querySelector('.jx-card[data-id="1"] textarea.jx-note') || {}).value);
  }, v => v !== 'زميل كتب الجديد', { role: 'employee' });

// ⚠️ وقت التحميل صوت المتصفح لسه معلّق (مفيش ضغطة) فالرنّة نفسها مابتبانش — اللي بيبان هو الـtoast «N استثناءات جديدة» على القديم
await calib('(خ) من غير خط البداية → كل الموجود وقت الفتح اتعامل «جديد» (الفحص S1 كان هيقع)',
  { exc: s => s.replace('    if(jxKnownReady && id > jxKnownMax) fresh.push(rows[i]);', '    if(id > jxKnownMax) fresh.push(rows[i]);') },
  async T => { await T.p.waitForTimeout(1500); return T.p.evaluate(() => document.getElementById('toast').textContent); }, t => /استثناء/.test(t), { path: '/orders' });
await calib('(ذ) إعداد الفريق متطنّش → رنّ والأدمن قافله (الفحص S2 كان هيقع)',
  { exc: s => s.replace('jxFreshTeamPref(function(on){ if(on && deviceSoundOn()) jxRingOnce(maxId); });', 'jxRingOnce(maxId);') },
  async T => { await T.p.evaluate(NEW50); await T.p.waitForTimeout(1500); return T.p.evaluate(() => window.__ALERTS); }, n => n > 0,
  { pre: "window.__NOTIFY_PREFS = { jx_sound: false };" });
await calib('(أأ) التاب اللي مش هتقدر ترنّ بتحجز الرنّة → التابات التانية سكتت (الفحص S7 كان هيقع)',
  { exc: s => s.replace("    if(audioReady()){ claim(); return; }", "    claim(); return;") },
  async T => { await T.p.evaluate(NEW50); await T.p.waitForTimeout(1500); return T.p.evaluate(() => localStorage.getItem('sahl_jx_beep_last')); }, last => last === '50',
  { pre: SUSP });
await calib('(بب) إعداد الفريق مابيتقراش تاني قبل الرنّة → رنّت والأدمن قافله من جهاز تاني (الفحص S8 كان هيقع)',
  { exc: s => s.replace("  if(!sb || (jxPrefAt && Date.now() - jxPrefAt < 60000)){ cb(jxTeamSound); return; }", "  if(true){ cb(jxTeamSound); return; }") },
  async T => { await T.p.evaluate(() => { window.__NOTIFY_PREFS = { jx_sound: false }; }); const t0 = await T.p.evaluate(() => Date.now());
    await T.ctx.clock.setFixedTime(new Date(t0 + 120000)); await T.p.evaluate(NEW50); await T.p.waitForTimeout(1500); return T.p.evaluate(() => window.__ALERTS); }, n => n > 0);
await calib('(ض) «اتسلمت قبل البلاغ» بتتحسب «بعده» → الملخص بقى 2 بعد البلاغ (الفحص R3 كان هيقع)',
  { exc: s => s.replace("  if(out === 'delivered') return (outAt && outAt < firstAt) ? 'before' : 'after';", "  if(out === 'delivered') return 'after';") },
  async T => { await chip(T.p, 'reports'); return T.p.evaluate(() => (document.querySelector('.jx-repsum') || {}).innerText.replace(/\s+/g, ' ')); }, t => !/1 اتسلمت بعد البلاغ في المتوسط/.test(t), { post: EXTRA_REP });
await calib('(ظ) «اتكرر» بيعدّ استثناءات قبل البلاغ → كل شحنة بقت «اتكرر» (الفحص R3 كان هيقع)',
  { exc: s => s.replace("      if(x.kind === 'exception' && jxTs(x.event_at) > s.firstAt){", "      if(x.kind === 'exception'){") },
  async T => { await chip(T.p, 'reports'); return T.p.evaluate(() => (document.querySelector('.jx-repsum') || {}).innerText.replace(/\s+/g, ' ')); }, t => !/🔁 1 شحنة/.test(t), { post: EXTRA_REP });
await calib('(غ) المرحلة مابتسجّلش إنك شفتها → «🆕» رجع على الشريحة بعد ما خرجت (الفحص R5 كان هيقع)',
  { exc: s => s.replace("    if(!document.hidden && jxPageVisible()){ seen[s.bill] = 1; jxRepSeenDirty = true; }", "") },
  async T => { await chip(T.p, 'reports'); await chip(T.p, 'open'); return T.p.evaluate(() => document.querySelector('#jx-chips [data-jx-chip="reports"] .jx-nn').hidden); }, hid => !hid, { post: EXTRA_REP });

await calib('(جج) من غير «رجعت قبل البلاغ» → المرتجع اللي بدأ قبل البلاغ اتحسب على J&T (الفحص R12 كان هيقع)',
  { exc: s => s.replace("    if(rs ? rs < firstAt : (outAt && outAt < firstAt)) return 'ret_before';\n", '') },
  async T => T.p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); return (m.jxReportedShipments(m.jxRows).find(s => s.bill === 'JEG035') || {}).bucket; }),
  b => b !== 'ret_before', { post: EXTRA_REP + EXTRA_REP2 });
await calib('(دد) المحاولة اللي الفريق صنّفها من العميل بتتعدّ «اتكرر» → اتحسبت على J&T (الفحص R13 كان هيقع)',
  { exc: s => s.replace("        if(JX_NOT_JT.indexOf(x.verdict) >= 0) custLater.push(x); else repeats.push(x);", "        repeats.push(x);") },
  async T => T.p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); return (m.jxReportedShipments(m.jxRows).find(s => s.bill === 'JEG036') || {}).repeats.length; }),
  n => n !== 0, { post: EXTRA_REP + EXTRA_REP2 });
await calib('(هه) وقت البلاغ من verdict_set_at (بيتحرك مع تغيير النوع) → التسليم اتحسب «قبل البلاغ» (الفحص R14 كان هيقع)',
  { exc: s => s.replace("function jxReportAt(r){ return jxTs(r.reported_at || r.verdict_set_at || r.staff_updated_at); }", "function jxReportAt(r){ return jxTs(r.verdict_set_at || r.staff_updated_at); }") },
  async T => T.p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); return (m.jxReportedShipments(m.jxRows).find(s => s.bill === 'JEG038') || {}).bucket; }),
  b => b !== 'after', { post: EXTRA_REP + EXTRA_REP2 });
await calib('(وو) استعلام الشارة مابيتابعش التسليم → الموظف على الأوردرات ماعرفش (الفحص R17 كان هيقع)',
  { exc: s => s.replace("      jxSeeRows(rows);\n      jxWatchReported(rows);\n      jxBadgeAll(rows, Date.now());", "      jxSeeRows(rows);\n      jxBadgeAll(rows, Date.now());") },
  async T => { await T.p.waitForTimeout(600); await T.p.evaluate(() => { const r = window.__JT_ISSUES.find(x => x.id === 13); r.outcome = 'delivered'; r.outcome_at = new Date(Date.now() - 5 * 60000).toISOString(); r.order_status = 'Delivered'; r.updated_at = new Date().toISOString();
      (window.__RT_ON || []).find(h => h.opts && h.opts.table === 'jt_issues').cb({ eventType: 'UPDATE', new: { id: 13, tracking_no: 'JEG011' } }); });
    await T.p.waitForTimeout(1300); return T.p.evaluate(() => document.getElementById('toast').textContent); },
  t => !/اتسلمت/.test(t), { post: EXTRA_REP, path: '/orders' });

await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
