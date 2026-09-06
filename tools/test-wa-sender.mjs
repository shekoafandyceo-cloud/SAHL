// اسم الموظف تحت كل رد في الشات (طلب المالك 6 سبتمبر)
//
// السياق: `wa_messages` بقى فيها `sent_by` + `sent_by_name`، بيتكتبوا من
// `wa-send` (v6) **من الـJWT مش من الـbody**، والعمودين ممنوعين على
// `authenticated` بصلاحيات الأعمدة فالفرونت أصلاً مايقدرش يكتبهم.
//
// 🔴 الفحص الأهم هو رقم 2: **548 رسالة صادرة قديمة مالهاش اسم** (كل اللي
// اتبعت قبل 6 سبتمبر 2026). لازم تتعرض من غير أي اسم — لا «موظف» ولا اسم
// المتجر ولا فاصل يتيم. نسبة مخترعة أسوأ من مفيش نسبة، لأن التاجر بيقرا
// الشات ده عشان يحاسب حد.
//
// اللي بيتفحص:
//   1) رسالة صادرة ليها اسم → الاسم ظاهر تحتها
//   2) 🔴 رسالة صادرة من غير اسم → **مفيش أي أثر** (ولا فاصل)
//   3) الوارد عمره ما بياخد اسم — حتى لو الصف جاي فيه قيمة
//   4) الفقاعة الفورية بتعرض اسمي من أول لحظة (مايتنطّش)
//   5) بعد رد السيرفر، **الاسم بتاع السيرفر هو اللي يكسب** مش المحلي
//   6) 🔴 الفرونت عمره ما بيبعت اسم لـwa-send (بنقرا الحمولة الفعلية)
//   7) معايرات: (أ) fallback لاسم افتراضي → فحص 2 يقع ·
//      (ب) عرض الاسم للوارد كمان → فحص 3 يقع
//
// ── وشغل 6 سبتمبر (التحديث التاني) ──
//   8) «رد على رسالة»: الاقتباس بيتحل من الرسايل المحمّلة ويعرض النص
//   9) 🔴 رد على رسالة **مش عندنا** (تأكيد آلي من n8n) → «رد على رسالة أقدم»
//      من غير أي نص مخترع
//  10) رسالة عادية من غير رد → مفيش بلوك اقتباس خالص
//  11) محادثة اتعملت مع الأوردر ولسه مفيهاش رسايل: البانر بيقول «العميل لسه
//      مبعتش» مش «النافذة قفلت»، وخانة الكتابة مقفولة
//  12) معايرة: خلي المجهول يعرض نص مخترع → فحص 9 يقع
//  13) 🔴 رد على **صورة** → مصغّرة الصورة نفسها ظاهرة (بلاغ المالك: «📷 صورة»
//      لوحدها مكانتش بتقول أنهي صورة)
//  14) رد على صورة قديمة **في تحديث تدريجي** → الرابط الموقّع بيتحل كمان
//  15) معايرة: شيل المصغّرة → فحص 13 يقع
//
// ── الموظف يرد على رسالة (7 سبتمبر) ──
//  16) زرار «رد» على الفقاعة — موجود · مش مدفون · وضغطة حقيقية بتشتغل
//  17) المعاينة بتظهر فوق الكتابة وبتوصف الرسالة الصح
//  18) 🔴 الإرسال بيبعت `reply_to` = wamid بتاع الرسالة المختارة
//  19) الفقاعة الفورية بتعرض الاقتباس قبل رد السيرفر
//  20) 🔴 التصفير: نجاح الإرسال · زرار الإلغاء · **تبديل المحادثة**
//  21) رسالة من غير wa_message_id → **مفيش زرار رد** (درس 16)
//  22) معايرة: شيل التصفير عند تبديل المحادثة → فحص 20 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

// نفس معرّف المتجر اللي في الستب — الاستعلام بيفلتر بـeq('tenant_id', …)
const TENANT = 't-test-1';
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();

const CONVOS = [{
  id: 'c1', tenant_id: TENANT, wa_id: '201000000001', customer_name: 'عميل تجربة',
  last_message_at: iso(1), last_inbound_at: iso(5), unread_count: 0, status: 'open'
}];

// m1: صادرة **باسم** · m2: صادرة **قديمة بلا اسم** (الـ548) · m3: واردة
const MSGS = [
  { id: 'm3', tenant_id: TENANT, conversation_id: 'c1', direction: 'in', type: 'text',
    body: 'السلام عليكم', is_read: true, created_at: iso(9), wa_timestamp: iso(9),
    status: null, sent_by: null, sent_by_name: 'اسم مدسوس' },
  { id: 'm2', tenant_id: TENANT, conversation_id: 'c1', direction: 'out', type: 'text',
    body: 'رد قديم قبل التحديث', is_read: true, created_at: iso(8), wa_timestamp: iso(8),
    status: 'read', sent_by: null, sent_by_name: null },
  { id: 'm1', tenant_id: TENANT, conversation_id: 'c1', direction: 'out', type: 'text',
    body: 'رد جديد', is_read: true, created_at: iso(2), wa_timestamp: iso(2),
    status: 'read', sent_by: 'u9', sent_by_name: 'محمود', wa_message_id: 'wamid-OUT-1' },
  // r1: رد على رسالة **موجودة** (m1) · r2: رد على رسالة **مش عندنا**
  // (رسالة تأكيد آلية من n8n — مش متسجّلة في wa_messages أصلاً)
  { id: 'r1', tenant_id: TENANT, conversation_id: 'c1', direction: 'in', type: 'text',
    body: 'ده بكام؟', is_read: true, created_at: iso(1), wa_timestamp: iso(1),
    status: null, wa_message_id: 'wamid-IN-9', reply_to_wa_id: 'wamid-OUT-1' },
  { id: 'r2', tenant_id: TENANT, conversation_id: 'c1', direction: 'in', type: 'text',
    body: 'ايوة اكد', is_read: true, created_at: iso(0), wa_timestamp: iso(0),
    status: null, wa_message_id: 'wamid-IN-10', reply_to_wa_id: 'wamid-MAFEESH' },
  // img1: صورة منتج بعتها الموظف · r3: العميل بيرد عليها بيسأل عن سعرها
  { id: 'img1', tenant_id: TENANT, conversation_id: 'c1', direction: 'out', type: 'image',
    body: 'ترولي 3 دور', is_read: true, created_at: iso(4), wa_timestamp: iso(4),
    status: 'read', sent_by_name: 'محمود', wa_message_id: 'wamid-IMG-1',
    media_path: 't1/c1/prod.jpg' },
  { id: 'r3', tenant_id: TENANT, conversation_id: 'c1', direction: 'in', type: 'text',
    body: 'ده بكام؟', is_read: true, created_at: iso(0), wa_timestamp: iso(0),
    status: null, wa_message_id: 'wamid-IN-11', reply_to_wa_id: 'wamid-IMG-1' }
];

// محادثة اتعملت مع الأوردر — مفيش أي رسالة، و`last_direction` فاضي
const CONVO_NEW = [{
  id: 'c9', tenant_id: TENANT, wa_id: '201000000009', customer_name: 'عميل أوردر جديد',
  last_message_at: iso(3), last_message_text: null, last_direction: null,
  last_inbound_at: null, unread_count: 0, status: 'open'
}];

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  // صورة حقيقية (1×1 PNG) عشان `naturalWidth > 0` يبقى دليل فعلي إن
  // المصغّرة اتحمّلت — وسم <img> بمصدر مكسور بيعدّي من أي فحص شكلي
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await ctx.addInitScript(`
    window.__MEDIA = { 't1/c1/prod.jpg': '${PNG}' };
    window.__WA_CONVOS = ${JSON.stringify(opts.convos || CONVOS)};
    // بوابة الإنبوكس: الستب بيرجّع wa_inbox_status = {verified:false} فالصفحة
    // بتتقفل قبل ما ترسم أي محادثة. الهوك بيفتحها بس — من غير أي سلوك تاني.
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
    window.__WA_MSGS   = ${JSON.stringify(opts.msgs || MSGS)};
    window.__FN = function(slug, body){
      // ردّ wa-send: الاسم بييجي **من السيرفر** — والاختبار بيخليه مختلف عن
      // الاسم المحلي عمداً عشان يثبت مين اللي بيكسب.
      // ⏱️ بتأخير 400ms عشان الحالة المؤقتة تبقى **مرصودة**: رد فوري بيخلي
      // الفقاعة تتأكد قبل ما الاختبار يبص، فيبان كأن الاسم المحلي مش بيتعرض.
      return new Promise(function(res){
        setTimeout(function(){
          res({ ok:true, message_id:'wamid-1', row_id:'new1', sent_by_name:'اسم السيرفر' });
        }, 400);
      });
    };
  `);
  await ctx.addInitScript(STUB);
  if (opts.routeView) await ctx.route('**/js/inbox/message-view.js', opts.routeView);
  if (opts.routeInbox) await ctx.route('**/js/inbox/inbox.js', opts.routeInbox);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  // 🔴 بندخل على **لينك المحادثات مباشرةً** مش بالضغط على زرار القايمة:
  // من 6 سبتمبر الزرار بيفتح **تاب لوحدها** (openOwnTab)، فالصفحة الحالية
  // عمرها ما بتروح للإنبوكس والانتظار بيقع في timeout. سلوك تاب المحادثات
  // نفسه متفحوص في `test-routing`.
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForTimeout(600);
  // افتح المحادثة
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.click('#wa-list-body .wa-conv');
  // محادثة من غير رسايل (اتفتحت مع الأوردر) مالهاش .wa-msg — الانتظار
  // بيبقى على المنطقة نفسها إنها اتملت بأي حاجة
  await p.waitForFunction(() => {
    const b = document.getElementById('wa-msgs');
    return b && b.textContent.trim().length > 0;
  }, { timeout: 8000 });
  await p.waitForTimeout(300);
  return p;
}

// نص الميتا (السطر اللي تحت الرسالة) لرسالة بعينها
const metaOf = (p, mid) => p.evaluate((id) => {
  const el = document.querySelector('#wa-msgs .wa-msg[data-mid="' + id + '"]');
  if (!el) return null;
  const t = el.querySelector('.wa-msg-time');
  return {
    meta: t ? t.textContent.trim() : '',
    sender: el.querySelector('.wa-sender') ? el.querySelector('.wa-sender').textContent.trim() : null,
    seps: el.querySelectorAll('.wa-sender-sep').length
  };
}, mid);

// ════ 1 · 2 · 3 ════
{
  const p = await openInbox();
  console.log('──── عرض الاسم ────');

  const a = await metaOf(p, 'm1');
  ok(a && a.sender === 'محمود', `صادرة ليها اسم → «${a && a.sender}» ظاهر تحتها`);

  // 🔴 الفحص الحاكم
  const old = await metaOf(p, 'm2');
  ok(old && old.sender === null,
     `🔴 صادرة قديمة بلا اسم → مفيش أي اسم — «${old && old.meta}»`);
  ok(old && old.seps === 0,
     `ومفيش حتى فاصل يتيم — ${old && old.seps} فاصل`);
  ok(old && !/موظف|متجر|الاختبار|أدمن/.test(old.meta),
     `ومفيش أي اسم مخترع في السطر — «${old && old.meta}»`);

  const inb = await metaOf(p, 'm3');
  ok(inb && inb.sender === null,
     `الوارد مابياخدش اسم حتى لو الصف جاي فيه قيمة — «${inb && inb.meta}»`);

  await p.close();
}

// ════ 4 · 5 · 6 ════
{
  const p = await openInbox();
  console.log('──── الإرسال ────');

  await p.fill('#wa-input', 'رد بالتجربة');
  // الفقاعة الفورية قبل ما السيرفر يرد
  await p.evaluate(() => document.getElementById('wa-send-btn').click());
  await p.waitForTimeout(120);   // جوّه نافذة الـ400ms
  const optimistic = await p.evaluate(() => {
    const el = document.querySelector('#wa-msgs .wa-optimistic');
    if (!el) return null;
    const s = el.querySelector('.wa-sender');
    return { sender: s ? s.textContent.trim() : null, pending: el.classList.contains('wa-msg-pending') };
  });
  ok(optimistic && optimistic.sender === 'أدمن الاختبار',
     `الفقاعة الفورية بتعرض اسمي من أول لحظة — «${optimistic && optimistic.sender}»`);

  // بعد رد السيرفر
  await p.waitForTimeout(900);   // بعد ما الرد يوصل
  const settled = await p.evaluate(() => {
    const el = document.querySelector('#wa-msgs .wa-optimistic');
    if (!el) return null;
    const s = el.querySelector('.wa-sender');
    return { sender: s ? s.textContent.trim() : null, pending: el.classList.contains('wa-msg-pending') };
  });
  ok(settled && !settled.pending, 'والفقاعة اتأكدت (اتشال منها wa-msg-pending)');
  ok(settled && settled.sender === 'اسم السيرفر',
     `🔴 والاسم بقى بتاع **السيرفر** مش المحلي — «${settled && settled.sender}»`);

  // 🔴 الفرونت عمره ما بيبعت اسم
  const calls = await p.evaluate(() => (window.__FNCALLS || []).filter(c => c.slug === 'wa-send'));
  ok(calls.length === 1, `نداء واحد لـwa-send — ${calls.length}`);
  const keys = calls.length ? Object.keys(calls[0].body) : [];
  ok(!keys.some(k => /sent_by|name|user|employee/i.test(k)),
     `والحمولة مافيهاش أي اسم ولا هوية — ${JSON.stringify(keys)}`);
  await p.close();
}

// ════ 7أ) معايرة: fallback لاسم افتراضي ════
console.log('──── معايرات ────');
{
  const p = await openInbox({
    routeView: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // الشكل الخطر: بدل ما نسيبها فاضية، نحط اسم عام
      body = body.replace("  if(!n) return '';", "  if(!n) n = 'موظف';");
      await r.fulfill({ response: res, body });
    }
  });
  const old = await metaOf(p, 'm2');
  ok(old && old.sender === 'موظف',
     `معايرة أ: بـfallback الرسالة القديمة بقت منسوبة لـ«${old && old.sender}» — فحص 2 بيمسكها`);
  await p.close();
}

// ════ 7ب) معايرة: عرض الاسم للوارد كمان ════
{
  const p = await openInbox({
    routeView: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("  if(side !== 'out') return '';", "  if(false) return '';");
      await r.fulfill({ response: res, body });
    }
  });
  const inb = await metaOf(p, 'm3');
  ok(inb && inb.sender === 'اسم مدسوس',
     `معايرة ب: من غير حارس الاتجاه الوارد بياخد اسم مدسوس — فحص 3 بيمسكها`);
  await p.close();
}

// ════ 8 · 9 · 10) «رد على رسالة» ════
{
  const p = await openInbox();
  console.log('──── رد على رسالة ────');

  const quoteOf = (mid) => p.evaluate((id) => {
    const el = document.querySelector('#wa-msgs .wa-msg[data-mid="' + id + '"] .wa-quote');
    if (!el) return null;
    return {
      who: el.querySelector('.wa-quote-who') ? el.querySelector('.wa-quote-who').textContent.trim() : null,
      txt: el.querySelector('.wa-quote-txt') ? el.querySelector('.wa-quote-txt').textContent.trim() : null,
      lost: el.classList.contains('wa-quote-lost'),
      all: el.textContent.trim()
    };
  }, mid);

  const q1 = await quoteOf('r1');
  ok(q1 && !q1.lost, 'رد على رسالة موجودة → الاقتباس اتحل');
  ok(q1 && q1.txt === 'رد جديد', `وبيعرض نصها — «${q1 && q1.txt}»`);
  ok(q1 && q1.who === 'محمود', `وبيقول مين كاتبها — «${q1 && q1.who}»`);

  // 🔴 الحالة اللي هتحصل كتير: رد على رسالة تأكيد آلية مش متسجّلة عندنا
  const q2 = await quoteOf('r2');
  ok(q2 && q2.lost, 'رد على رسالة مش عندنا → البلوك بيتعلّم «مفقود»');
  ok(q2 && /أقدم/.test(q2.all) && !/بكام|رد جديد|تأكيد/.test(q2.all),
     `🔴 وبيقول «رد على رسالة أقدم» من غير أي نص مخترع — «${q2 && q2.all}»`);

  // رسالة عادية من غير رد
  const q3 = await quoteOf('m1');
  ok(q3 === null, 'رسالة من غير رد → مفيش بلوك اقتباس خالص');
  await p.close();
}

// ════ 11) محادثة اتعملت مع الأوردر ولسه مفيهاش رسايل ════
{
  console.log('──── محادثة من أوردر ────');
  const p = await openInbox({ convos: CONVO_NEW, msgs: [] });
  const st = await p.evaluate(() => {
    const bn = document.getElementById('wa-window-closed');
    const row = document.getElementById('wa-compose-row');
    const prev = document.querySelector('#wa-list-body .wa-conv-prev');
    return {
      banner: bn ? bn.textContent.trim() : '',
      bannerShown: bn ? getComputedStyle(bn).display !== 'none' : false,
      composeShown: row ? getComputedStyle(row).display !== 'none' : false,
      preview: prev ? prev.textContent.trim() : '',
      empty: (document.getElementById('wa-msgs') || {}).textContent || ''
    };
  });
  ok(st.bannerShown && /لسه مبعتش/.test(st.banner),
     `البانر بيقول «العميل لسه مبعتش» — «${st.banner.slice(0, 60)}»`);
  ok(!/نافذة الرد/.test(st.banner),
     'ومش بيقول «النافذة قفلت» — مفيش نافذة قفلت أصلاً');
  ok(!st.composeShown, 'وخانة الكتابة مقفولة (واتساب مابيسمحش نبدأ إحنا)');
  ok(/لسه مبعتش/.test(st.preview), `وفي القايمة معاينة واضحة — «${st.preview}»`);
  ok(/اتفتحت مع أوردر/.test(st.empty), 'وجوّه الشات رسالة بتشرح ليه فاضي');
  await p.close();
}

// ════ 12) معايرة: نص مخترع للمقتبسة المجهولة ════
{
  const p = await openInbox({
    routeView: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace(
        "return '<div class=\"wa-quote wa-quote-lost\">↩︎ رد على رسالة أقدم</div>';",
        "return '<div class=\"wa-quote\"><span class=\"wa-quote-who\">العميل</span><span class=\"wa-quote-txt\">تأكيد الطلب</span></div>';");
      await r.fulfill({ response: res, body });
    }
  });
  const q = await p.evaluate(() => {
    const el = document.querySelector('#wa-msgs .wa-msg[data-mid="r2"] .wa-quote');
    return el ? { txt: el.textContent.trim(), lost: el.classList.contains('wa-quote-lost') } : null;
  });
  ok(q && !q.lost && /تأكيد الطلب/.test(q.txt),
     `معايرة ج: بنص مخترع الرسالة المجهولة بقت «${q && q.txt}» — فحص 9 بيمسكها`);
  await p.close();
}

// ════ 13) 🔴 رد على صورة → المصغّرة ════
{
  const p = await openInbox();
  console.log('──── رد على صورة ────');
  const q = await p.evaluate(() => {
    const el = document.querySelector('#wa-msgs .wa-msg[data-mid="r3"] .wa-quote');
    if (!el) return null;
    const img = el.querySelector('.wa-quote-thumb');
    return {
      hasThumb: !!img,
      src: img ? img.getAttribute('src') : null,
      // 🔴 الدليل إن المصغّرة **اتحمّلت فعلاً** مش بس الوسم موجود
      loaded: img ? (img.complete && img.naturalWidth > 0) : false,
      w: img ? Math.round(img.getBoundingClientRect().width) : 0,
      txt: el.textContent.trim()
    };
  });
  ok(q && q.hasThumb, 'رد على صورة → المصغّرة موجودة في بلوك الرد');
  ok(q && q.w >= 20, `وليها مقاس حقيقي على الشاشة — ${q && q.w}px`);
  ok(q && q.loaded, `🔴 والصورة **اتحمّلت فعلاً** مش وسم فاضي — naturalWidth>0`);
  ok(q && /ترولي 3 دور/.test(q.txt),
     `والكابشن ظاهر جنبها فالموظف يعرف المنتج — «${q && q.txt}»`);
  ok(q && !/📷/.test(q.txt), 'والأيقونة اتشالت — الصورة نفسها بتقول إنها صورة');
  await p.close();
}

// ════ 14) رد جديد على صورة قديمة (تحديث تدريجي) ════
// السيناريو الحقيقي: الشات مفتوح، والعميل بيرد **دلوقتي** على صورة بعتناها
// من شوية. المسار التدريجي كان بيحل ميديا الرسايل الجديدة بس.
{
  const p = await openInbox({ msgs: MSGS.filter(m => m.id !== 'r3') });
  const before = await p.evaluate(() =>
    document.querySelectorAll('#wa-msgs .wa-msg').length);
  // الرسالة الجديدة بتوصل من الـpoll
  await p.evaluate((rows) => { window.__WA_MSGS = rows; }, MSGS);
  await p.evaluate(async () => {
    const m = await import('./js/inbox/inbox.js');
    m.waFetchMessages('c1', false, true);
  });
  await p.waitForTimeout(1200);
  const q = await p.evaluate(() => {
    const el = document.querySelector('#wa-msgs .wa-msg[data-mid="r3"] .wa-quote');
    const img = el ? el.querySelector('.wa-quote-thumb') : null;
    return { added: document.querySelectorAll('#wa-msgs .wa-msg').length,
             loaded: img ? (img.complete && img.naturalWidth > 0) : false };
  });
  ok(q.added > before, `الرسالة الجديدة اتضافت تدريجياً — ${before} → ${q.added}`);
  ok(q.loaded, '🔴 ومصغّرة الصورة القديمة اتحلّت كمان — مش وسم مكسور');
  await p.close();
}

// ════ 15) معايرة: شيل المصغّرة ════
{
  const p = await openInbox({
    routeView: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("if((q.type==='image'||q.type==='sticker') && q.media_path && urlMap && urlMap[q.media_path]){",
                          "if(false){");
      await r.fulfill({ response: res, body });
    }
  });
  const q = await p.evaluate(() => {
    const el = document.querySelector('#wa-msgs .wa-msg[data-mid="r3"] .wa-quote');
    return el ? { thumb: !!el.querySelector('.wa-quote-thumb'), txt: el.textContent.trim() } : null;
  });
  ok(q && !q.thumb && /📷/.test(q.txt),
     `معايرة د: من غير المصغّرة بترجع «${q && q.txt}» — الموظف مايعرفش أنهي صورة، وفحص 13 بيمسكها`);
  await p.close();
}

// ════ 16 · 17 · 18 · 19) الموظف يرد على رسالة ════
{
  const p = await openInbox();
  console.log('──── الموظف يرد على رسالة ────');

  // 🔴 hit-test (درس 31/35): الزرار مش مدفون تحت حاجة.
  // ⚠️ لازم نسكرول للرسالة الأول — `elementFromPoint` بتشتغل بإحداثيات
  // **الشاشة**، والفقاعة اللي فوق الطية بتدي إحداثيات واقعة على لوحة
  // الأوردرات فوق الشات. الموظف نفسه بيسكرول للرسالة قبل ما يرد عليها،
  // فالقياس من غير سكرول بيقيس حاجة تانية خالص (اتلسعنا فيها هنا).
  await p.$eval('.wa-msg[data-mid="img1"]', el => el.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(200);
  const hit = await p.evaluate(() => {
    const btn = document.querySelector('.wa-msg[data-mid="img1"] .wa-reply-btn');
    if (!btn) return { ok: false, why: 'مفيش زرار' };
    const r = btn.getBoundingClientRect();
    if (r.width < 8) return { ok: false, why: 'مقاس صفر' };
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: !!(at && (at === btn || btn.contains(at) || at.contains(btn))),
             why: at ? (at.className || at.tagName) : 'مفيش عنصر',
             w: Math.round(r.width) };
  });
  ok(hit.ok, `زرار الرد على الفقاعة مش مدفون (${hit.w}px) — ${hit.why}`);

  // 🔴 والزرار **مايغطيش** نص الرسالة — ده اللي خلّى العوم فوق الفقاعة يترفض
  const overlap = await p.evaluate(() => {
    const bub = document.querySelector('.wa-msg[data-mid="m1"]');
    const btn = bub.querySelector('.wa-reply-btn');
    const txt = bub.querySelector('.wa-text');
    if (!btn || !txt) return { bad: true, why: 'ناقص عنصر' };
    const a = btn.getBoundingClientRect(), t = txt.getBoundingClientRect();
    const hit = !(a.right <= t.left || a.left >= t.right || a.bottom <= t.top || a.top >= t.bottom);
    return { bad: hit, why: hit ? 'الزرار فوق النص' : 'مفيش تقاطع' };
  });
  ok(!overlap.bad, `والزرار مش فوق نص الرسالة — ${overlap.why}`);

  // ضغطة حقيقية (مش el.click)
  await p.hover('.wa-msg[data-mid="img1"]');
  await p.click('.wa-msg[data-mid="img1"] .wa-reply-btn');
  await p.waitForTimeout(350);

  const bar = await p.evaluate(() => {
    const el = document.getElementById('wa-reply-bar');
    if (!el) return null;
    const q = el.querySelector('.wa-quote');
    return {
      shown: getComputedStyle(el).display !== 'none',
      txt: q ? q.textContent.trim() : '',
      thumb: !!el.querySelector('.wa-quote-thumb')
    };
  });
  ok(bar && bar.shown, 'المعاينة ظهرت فوق خانة الكتابة');
  ok(bar && /ترولي 3 دور/.test(bar.txt), `وبتوصف الرسالة الصح — «${bar && bar.txt}»`);
  ok(bar && bar.thumb, 'وفيها مصغّرة الصورة — الموظف شايف هيرد على إيه');

  // 🔴 الإرسال بيبعت المعرّف الصح
  await p.fill('#wa-input', 'بـ1200 يافندم');
  await p.click('#wa-send-btn');
  await p.waitForTimeout(120);

  const optimistic = await p.evaluate(() => {
    const el = document.querySelector('#wa-msgs .wa-optimistic');
    const q = el ? el.querySelector('.wa-quote') : null;
    return { hasQuote: !!q, txt: q ? q.textContent.trim() : '' };
  });
  ok(optimistic.hasQuote, 'الفقاعة الفورية بتعرض الاقتباس قبل رد السيرفر');
  ok(/ترولي 3 دور/.test(optimistic.txt), `وبنفس المحتوى — «${optimistic.txt}»`);

  await p.waitForTimeout(900);
  const call = await p.evaluate(() => {
    const c = (window.__FNCALLS || []).filter(x => x.slug === 'wa-send');
    return c.length ? c[c.length - 1].body : null;
  });
  ok(call && call.reply_to === 'wamid-IMG-1',
     `🔴 الحمولة فيها reply_to = wamid بتاع الرسالة المختارة — ${call && call.reply_to}`);

  // ════ 20أ) التصفير بعد نجاح الإرسال ════
  const after = await p.evaluate(() => {
    const el = document.getElementById('wa-reply-bar');
    return el ? getComputedStyle(el).display !== 'none' : false;
  });
  ok(!after, 'والمعاينة اتصفّرت بعد الإرسال — مش هتلزق في الرسالة اللي بعدها');
  await p.close();
}

// ════ 20ب) زرار الإلغاء ════
{
  const p = await openInbox();
  await p.hover('.wa-msg[data-mid="m1"]');
  await p.click('.wa-msg[data-mid="m1"] .wa-reply-btn');
  await p.waitForTimeout(300);
  await p.click('#wa-reply-cancel');
  await p.waitForTimeout(200);
  const gone = await p.evaluate(() => {
    const el = document.getElementById('wa-reply-bar');
    return el ? getComputedStyle(el).display === 'none' : true;
  });
  ok(gone, 'زرار الإلغاء بيقفل المعاينة');

  // وبعد الإلغاء الإرسال مايبعتش reply_to
  await p.fill('#wa-input', 'رسالة عادية');
  await p.click('#wa-send-btn');
  await p.waitForTimeout(900);
  const call = await p.evaluate(() => {
    const c = (window.__FNCALLS || []).filter(x => x.slug === 'wa-send');
    return c.length ? c[c.length - 1].body : null;
  });
  ok(call && !call.reply_to, `وبعدها الرسالة بتتبعت من غير reply_to — ${JSON.stringify(call && call.reply_to)}`);
  await p.close();
}

// ════ 20ج) 🔴 تبديل المحادثة بيصفّر الرد ════
// السيناريو الخطر: الموظف يختار رسالة، يفتح محادثة تانية، ويكتب — الاقتباس
// بتاع المحادثة القديمة كان هيتبعت مع رسالة في محادثة جديدة.
{
  const TWO = [
    CONVOS[0],
    { id: 'c2', tenant_id: TENANT, wa_id: '201000000002', customer_name: 'عميل تاني',
      last_message_at: iso(1), last_inbound_at: iso(5), unread_count: 0, status: 'open',
      last_direction: 'in' }
  ];
  const p = await openInbox({ convos: TWO });
  await p.hover('.wa-msg[data-mid="m1"]');
  await p.click('.wa-msg[data-mid="m1"] .wa-reply-btn');
  await p.waitForTimeout(300);
  const before = await p.evaluate(() => {
    const el = document.getElementById('wa-reply-bar');
    return el ? getComputedStyle(el).display !== 'none' : false;
  });
  ok(before, 'اخترنا رسالة في المحادثة الأولى والمعاينة ظاهرة');

  // بدّل للمحادثة التانية
  await p.click('#wa-list-body .wa-conv:nth-child(2)');
  await p.waitForTimeout(700);
  const cleared = await p.evaluate(() => {
    const el = document.getElementById('wa-reply-bar');
    return el ? getComputedStyle(el).display === 'none' : true;
  });
  ok(cleared, '🔴 وتبديل المحادثة صفّر الرد — مفيش اقتباس بيهاجر لمحادثة تانية');
  await p.close();
}

// ════ 21) رسالة من غير wa_message_id → مفيش زرار ════
{
  const p = await openInbox();
  const noBtn = await p.evaluate(() => {
    // m2 و m3 في الداتا من غير wa_message_id
    const a = document.querySelector('.wa-msg[data-mid="m2"] .wa-reply-btn');
    const withId = document.querySelector('.wa-msg[data-mid="m1"] .wa-reply-btn');
    return { none: !a, has: !!withId };
  });
  ok(noBtn.none, 'رسالة من غير معرّف واتساب → مفيش زرار رد (بدل زرار ميت)');
  ok(noBtn.has, 'وضابط: اللي ليها معرّف عندها الزرار');
  await p.close();
}

// ════ 22) معايرة: شيل التصفير عند تبديل المحادثة ════
{
  const TWO = [
    CONVOS[0],
    { id: 'c2', tenant_id: TENANT, wa_id: '201000000002', customer_name: 'عميل تاني',
      last_message_at: iso(1), last_inbound_at: iso(5), unread_count: 0, status: 'open',
      last_direction: 'in' }
  ];
  const p = await openInbox({
    convos: TWO,
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("  // 🔴 اقتباس من محادثة قديمة في محادثة جديدة = رد على رسالة مش موجودة\n  waClearReplyTo();", "");
      await r.fulfill({ response: res, body });
    }
  });
  await p.hover('.wa-msg[data-mid="m1"]');
  await p.click('.wa-msg[data-mid="m1"] .wa-reply-btn');
  await p.waitForTimeout(300);
  await p.click('#wa-list-body .wa-conv:nth-child(2)');
  await p.waitForTimeout(700);
  const still = await p.evaluate(() => {
    const el = document.getElementById('wa-reply-bar');
    return el ? getComputedStyle(el).display !== 'none' : false;
  });
  ok(still, 'معايرة هـ: من غير التصفير الاقتباس بيفضل ظاهر في المحادثة التانية — فحص 20ج بيمسكها');
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
