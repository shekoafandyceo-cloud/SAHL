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
    status: null, wa_message_id: 'wamid-IN-10', reply_to_wa_id: 'wamid-MAFEESH' }
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
  await ctx.addInitScript(`
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

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
