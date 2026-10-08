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
//
// المعايرات (لازم تقع على الكود المحقون — كل واحدة بحارس «المرساة اتلقت»):
//  (أ) شيل «اتصنّفت محاولة أحدث» → (ب) شيل حالة الأوردر من النتيجة → (ج) شيل esc من ملاحظة المندوب
//  (د) الجدول على قناة الأوردرات → (هـ) الرسم بيدوس على الكتابة → (و) قاعدة wa_id غلط
//  (ز) شيل فحص انتهاء الصورة → (ح) شيل حارس CSV injection → (ط) الطابور بيتقيّد بالفترة
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
    customer_name:'أحمد سامي', phone:'01000000001', alt_phone:null, city:'القاهره', address:'15 شارع التحرير',
    ship_prov:'القاهرة', ship_city:'مدينة نصر', ship_area:'الحي السابع', product_name:'منظم المطبخ (عدد 1)',
    total_cost:1450, jt_cod_amount:1450, order_status:'Exception' };
  var mk = function(o){ var r = Object.assign({}, base, o); r.updated_at = r.updated_at || r.staff_updated_at || r.event_at; return r; };
  window.__JT_ISSUES = [
    mk({ id:1, tracking_no:'JEG001', event_at:ago(2*H), courier_note:'مش بيرد', photo_url:'https://jt.blob.core.windows.net/p/a.jpg?sv=1&se=' + encodeURIComponent(fut) + '&sig=x' }),
    mk({ id:2, tracking_no:'JEG001', attempt:2, event_at:ago(30*60000), reason_code:'205', reason_en:'Change The Delivery Time', reason_ar:'العميل طلب تأجيل' }),
    mk({ id:3, tracking_no:'JEG002', order_id:'o2', order_uid:'9002', customer_name:'منى', phone:'01000000002', event_at:ago(1*D),
         verdict:'fake_update', staff_note:'العميل قال محدش كلمه', verdict_by_name:'shekoz', staff_updated_at:ago(1*H),
         outcome:'delivered', outcome_at:ago(5*H), order_status:'Delivered' }),
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
         staff_updated_at:ago(30*H), order_id:'o9', order_uid:'9009', phone:'01000000009' }),
    mk({ id:11, tracking_no:'JEG009', event_at:ago(20*D), order_id:'o11', order_uid:'9011', phone:'01000000011', customer_name:'قديم عالق' }),
    mk({ id:12, tracking_no:'JEG010', event_at:ago(6*H), courier_note:'<img src=x id="xss1" onerror="window.__XSS=1">',
         branch:'<b id="xss2">B</b>', courier_name:'<i id="xss3">c</i>', customer_name:'<u id="xss4">n</u>',
         order_id:'o12', order_uid:'9012', phone:'01000000012', photo_url:'javascript:window.__XSS=2' }),
    mk({ id:13, tracking_no:'JEG011', event_at:ago(7*H), photo_url:'https://jt.blob.core.windows.net/p/b.jpg?se=' + encodeURIComponent(past) + '&sig=y',
         order_id:'o13', order_uid:'9013', phone:'01000000013', verdict:'jt_error', staff_note:'=1+1', verdict_by_name:'shekoz', staff_updated_at:ago(2*H) }),
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
})();`;

const HOOK = `window.__SAVES = [];
window.__RPC_HOOK = function(name, args){
  if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
  if(name !== 'jt_issue_save') return null;
  window.__SAVES.push(args);
  if(window.__SAVE_FAIL) return { data:null, error:{ code:'22023', message:'bad_verdict' } };
  var r = window.__JT_ISSUES.find(function(x){ return x.id === args.p_id; });
  if(!r) return { data:null, error:{ code:'P0002', message:'not_found' } };
  var apply = function(){
    r.verdict = args.p_verdict; r.staff_note = args.p_note;
    r.staff_updated_at = new Date().toISOString(); r.updated_at = r.staff_updated_at; r.verdict_by_name = 'أدمن الاختبار';
    return { data:{ id:r.id, verdict:r.verdict, staff_note:r.staff_note, staff_updated_at:r.staff_updated_at, verdict_by_name:r.verdict_by_name }, error:null };
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
ok(badge0 && badge0.shown && badge0.t === '6', '1) شارة «استثناءات الشحن» على الزرار = 6 من الاستعلام الخفيف (قبل فتح الصفحة) — ' + JSON.stringify(badge0));
const q1 = await p.evaluate(() => (window.__calls || []).filter(c => c.table === 'v_jt_issues').map(c => ({ cols: c.cols, f: c.f })));
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
const ids0 = await cardIds(p);
ok(JSON.stringify(ids0) === JSON.stringify([11, 4, 6, 12, 1, 2]), '4) «محتاجة متابعة»: 6 بالترتيب (الأقدم فوق · العالق من 20 يوم موجود رغم الفترة 7) — ' + JSON.stringify(ids0));
// (علامات العزل حوالين النسبة بتتشال قبل المقارنة — وجودها نفسه متفحوص تحت)
const st = await p.evaluate(() => { const t = id => document.getElementById(id).textContent.replace(/[\u2066-\u2069]/g, '').trim(); return [t('jx-s-open'), t('jx-s-open-sub'), t('jx-s-total'), t('jx-s-total-sub'), t('jx-s-fake'), t('jx-s-fake-sub'), t('jx-s-saved'), t('jx-s-saved-sub'), t('jx-s-today'), t('jx-s-today-sub')]; });
ok(st[0] === '6' && /2 راجعة/.test(st[1]) && st[2] === '10' && /8 شحنة/.test(st[3]) && st[4] === '1' && /من 3/.test(st[5]) && st[6] === '2' && /من 8 شحنة · 25%/.test(st[7]) && st[8] === '2' && /shekoz 2/.test(st[9]),
  '5) الكروت: متابعة 6 (2 راجعة) · 10 استثناء على 8 شحنة · FAKE 1 من 3 · اتسلمت 2 من 8 (25%) · النهارده 2 (shekoz) — ' + JSON.stringify(st));
ok(await p.evaluate(() => /\u2066\d+%\u2069/.test(document.getElementById('jx-s-saved-sub').textContent)), '5ب) النسبة معزولة اتجاهياً (مابتتقلبش «%25» جوّه الجملة العربي)');
const chips = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#jx-chips .jx-chip')].map(c => [c.dataset.jxChip, c.querySelector('.n').textContent])));
ok(chips.open === '6' && chips.with_jt === '6' && chips.delivered === '2' && chips.returned === '2' && chips.all === '11', '6) أعداد الشرايح: 6 · 6 · 2 · 2 · 11 — ' + JSON.stringify(chips));

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

console.log('— الفلاتر');
await chip(p, 'all');
const c13 = await p.evaluate(() => { const c = document.querySelector('.jx-card[data-id="13"]'); return c ? { photo: !!c.querySelector('a.jx-photo'), t: c.textContent } : null; });
ok(c13 && !c13.photo && /انتهت صلاحيتها/.test(c13.t), '8ج) صورة J&T اللي `se=` بتاعها فات = «انتهت صلاحيتها» من غير لينك ميت');
await chip(p, 'delivered');
const dl = (await cardIds(p)).sort((x, y) => x - y);
await chip(p, 'returned');
const rt7 = (await cardIds(p)).sort((x, y) => x - y);
await days(p, 30);
const rt30 = (await cardIds(p)).sort((x, y) => x - y);
await chip(p, 'all');
const all30 = await cardIds(p);
ok(JSON.stringify(dl) === '[3,8]' && JSON.stringify(rt7) === '[4,6]' && JSON.stringify(rt30) === '[4,5,6]' && all30.indexOf(15) < 0 && all30.length === 13 && all30[0] === 2,
  '11) اتسلمت {3،8 — متعلّم متسلّم عندنا} · رجعت 7 أيام {4،6} · 30 يوم {4،5،6} · الكل 30 يوم 13 (من غير بره النافذة) والأحدث فوق — ' + JSON.stringify({ dl, rt7, rt30, n: all30.length }));
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
await p.selectOption('#jx-fverdict', ''); await days(p, 7); await chip(p, 'open');
ok(JSON.stringify(r1) === '[2]' && v1 === 10 && JSON.stringify(v2) === '[3]', '13–14) فلتر السبب {2} · «لسه متصنفتش» 10 كلهم من غير تصنيف · FAKE UPDATE {3} — ' + JSON.stringify([r1, v1, v2]));

console.log('— الحفظ');
// الموظف الحقيقي بيدوس على الخانة الأول (focus) وبعدين بيختار — selectOption لوحدها مابتعملش focus
await p.focus('.jx-card[data-id="2"] select.jx-verdict');
await p.selectOption('.jx-card[data-id="2"] select.jx-verdict', 'fake_update');
await p.waitForTimeout(250);
const sv1 = await p.evaluate(() => ({ saves: window.__SAVES.slice(), still: !!document.querySelector('.jx-card[data-id="2"]'),
  meta: (document.querySelector('.jx-card[data-id="2"] .jx-meta') || {}).textContent || '', badge: document.getElementById('jx-nav-badge').textContent,
  open: document.getElementById('jx-s-open').textContent, dv: (document.querySelector('.jx-card[data-id="2"] select.jx-verdict') || {}).dataset }));
ok(sv1.saves.length === 1 && sv1.saves[0].p_id === 2 && sv1.saves[0].p_verdict === 'fake_update' && sv1.saves[0].p_note === null,
  '15) الاختيار بيتحفظ فوراً: jt_issue_save(2, fake_update, null) — ' + JSON.stringify(sv1.saves));
ok(sv1.still && /أدمن الاختبار/.test(sv1.meta) && sv1.badge === '4' && sv1.open === '4' && sv1.dv && sv1.dv.v === 'fake_update',
  '15ب) الكارت مايتسحبش من تحت إيد الموظف (الاختيار لسه في إيده) · «مين سجّل» اتكتب · الشارة 6→4 (المحاولة 1 اتغطّت) — ' + JSON.stringify({ still: sv1.still, badge: sv1.badge, meta: sv1.meta }));
await p.click('#page-exceptions .sp-head h2'); await p.waitForTimeout(450);
const ids1 = await cardIds(p);
ok(JSON.stringify(ids1) === '[11,4,6,12]', '15ج) أول ما ساب الخانة: 1 و2 خرجوا من الطابور — ' + JSON.stringify(ids1));
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
ok(rt1.focus && rt1.val === 'بكتب دلوقتي' && !rt1.has20 && rt1.bar && rt1.badge === '5', '19) وصل جديد وهو بيكتب: الخانة في إيده بنفس الكلام · الكارت الجديد مستني · شريط «وصل تحديث» · الشارة 5 — ' + JSON.stringify(rt1));
await p.click('#page-exceptions .sp-head h2'); await p.waitForTimeout(500);
const rt2 = await p.evaluate(() => { const c = document.querySelector('.jx-card[data-id="20"]'); return { has: !!c, isNew: !!(c && c.classList.contains('is-new') && /جديد/.test(c.textContent)), note12: (window.__SAVES.slice(-1)[0] || {}).p_note }; });
ok(rt2.has && rt2.isNew && rt2.note12 === 'بكتب دلوقتي', '19ب) أول ما ساب الخانة: كلامه اتحفظ والكارت الجديد ظهر بعلامة «جديد»');

console.log('— التقرير والتصدير');
const rep = await p.evaluate(() => ({ sum: document.querySelector('.jx-rsum') ? document.querySelector('.jx-rsum').textContent.replace(/\s+/g, ' ') : '',
  hot: document.querySelectorAll('#jx-report tr.hot').length, tables: document.querySelectorAll('#jx-report .jx-rtable').length }));
ok(/FAKE UPDATE 2/.test(rep.sum) && /غلطة J&T 1/.test(rep.sum) && rep.tables === 3 && rep.hot >= 2, '23) تقرير J&T: الملخص (FAKE بعد الحفظ 2 · غلطة J&T 1) + 3 جداول والفروع/المناديب «السخنة» متعلّمة — ' + rep.sum.slice(0, 160));
const rtext = await p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js'); return m.jxReportText(m.jxRows.filter(r => r._ymd >= m.jxPeriodFrom(7, Date.now())), 7, Date.now()); });
ok(/FAKE UPDATE: 2/.test(rtext) && /Nasr City/.test(rtext), '23ب) الملخص النصي لـJ&T فيه الأرقام والفرع');
await chip(p, 'all'); await days(p, 30);
const [dlf] = await Promise.all([p.waitForEvent('download'), p.click('#jx-export')]);
const csv = fs.readFileSync(await dlf.path(), 'utf8');
const lines = csv.split('\r\n');
ok(csv.charCodeAt(0) === 0xFEFF && /البوليصة/.test(lines[0]) && lines.length === 15 && /"=""01000000001"""/.test(csv) && /'=1\+1/.test(csv) && /<img src=x/.test(csv) && /بره النافذة/.test(csv) === false,
  '24) التصدير: BOM + العناوين بالعربي + 14 صف · التليفون نص (="010…") · خلية بتبدأ بـ= متحيّدة (\'=1+1) — ' + dlf.suggestedFilename());
await days(p, 7); await chip(p, 'open');
ok(p.__errs.length === 0, 'صفر أخطاء جافاسكربت في التشغيل الأساسي — ' + (p.__errs[0] || 'نضيف'));
await M.ctx.close();

console.log('— الشات');
{
  const T = await open('/exceptions');
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
  const T = await open('/exceptions', { viewport: { width: 390, height: 844 } });
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
  const T = await open('/exceptions', { viewport: { width: 390, height: 844 }, post: `window.__START_TPLS = [{ id:'tp1', tenant_id:'t-test-1', template_name:'chat_start_ar', lang:'ar_EG', label:'بدء محادثة', body:'أهلاً {{1}}', params:['عتبة'], enabled:true }];` });
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
  ok(b1.badge === 'none' && b1.ch === 0 && b1.orders >= 1 && /لسه مااتطبّقش/.test(msg || '') && T.p.__errs.length === 0,
    '25) الجدول مش موجود: مفيش شارة · مفيش قناة jt-issues (قناة الأوردرات شغالة عادي) · الصفحة بتقول شغّل ملف الـSQL — ' + JSON.stringify(b1));
  await T.ctx.close();
}
{
  const T = await open('/exceptions', { viewport: { width: 390, height: 844 } });
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
  const T = await open('/exceptions', { pre: "try{ localStorage.setItem('sahl_dark','1'); }catch(e){}" });
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
  const T = await open('/exceptions', { pre: 'window.__JX_POLL_MS = 400;' });
  await T.p.waitForSelector('.jx-card[data-id="1"]');
  await T.p.evaluate(() => { const r = window.__JT_ISSUES.find(x => x.id === 1); r.outcome = 'delivered'; r.outcome_at = new Date().toISOString(); r.updated_at = new Date(Date.now() + 1000).toISOString(); });
  await T.p.waitForTimeout(1500);
  const inc = await T.p.evaluate(() => ({ has1: !!document.querySelector('.jx-card[data-id="1"]'), q: (window.__calls || []).some(c => c.table === 'jt_issues' && (c.f || []).some(f => f.op === 'gte' && f.col === 'updated_at')),
    badge: document.getElementById('jx-nav-badge').textContent }));
  ok(!inc.has1 && inc.q && inc.badge === '5', '29) المزامنة التدريجية (من غير ريل-تايم): اتسلمت عند J&T → خرجت من الطابور والشارة 6→5 — ' + JSON.stringify(inc));
  await T.ctx.close();
}

{
  // 30) مهلة «راجعة» من بداية المرتجع (outcome_at) مش من الاستثناء — الفرق وصل 3.9 يوم على الحي
  const T = await open('/exceptions');
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

// ═══ المعايرات ═══
console.log('— المعايرات');
async function calib(label, patches, probe, expectFail){
  const T = await open('/exceptions', { patches });
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
  { exc: s => s.replace('  if(jxEditing()){\n    // الموظف في إيده خانة', '  if(false){\n    // الموظف في إيده خانة').replace("  if(!force && jxEditing()){ jxPendingRender = true; return; }", '') },
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

await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
