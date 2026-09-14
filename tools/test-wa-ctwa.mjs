// شارة «جه من إعلان» في صندوق المحادثات (طلب المالك 14 سبتمبر)
//
// السياق: `wa_conversations` فيها 6 أعمدة `ctwa_*` بتتكتب من
// `wa-inbox-ingest` (v7)، و`inbox.js` بيعمل `select('*')` يعني الداتا
// **كانت بتوصل المتصفح وتترمي** — نفس عيلة `manufacturer_note` بالظبط.
//
// 🔴 قرار المالك: **عنوان الإعلان بس — مش معرّف الإعلان**، والشارة تظهر
// في **الاتنين**: المحادثة المفتوحة وقايمة المحادثات.
//
// اللي بيتفحص:
//   1) صف القايمة لمحادثة جاية من إعلان → الشارة فيها **العنوان**
//   2) محادثة عادية → **مفيش شارة خالص** (لا في القايمة ولا في الهيدر)
//   3) إعلان من غير عنوان (ميتا بتسيب headline أحياناً) → «جه من إعلان»
//      من غير أي عنوان مخترع
//   4) 🔴 **معرّف الإعلان عمره ما بيتعرض** في أي مكان في الصفحة
//   5) الهيدر بيعرض الشارة لما المحادثة تتفتح
//   6) hit-test: الشارتين **مش مدفونين** (درس 31/35)
//   7) 🔴 تبديل المحادثة: شارة المحادثة اللي فاتت **مابتفضلش معلّقة**
//   8) 🔴 الـreferral بييجي **والشات مفتوح** (العميل بيدوس الإعلان دلوقتي)
//      → الشارة بتظهر مع أول جلب، من غير ما الموظف يقفل ويفتح
//   9) العنوان بيتهرب — markup جوّه العنوان بيتعرض كنص مش كعنصر
//  10) عنوان طويل مايكسرش التخطيط (مفيش تمدد أفقي في الصفحة)
//  11) الوضع الليلي ليه تجاوز فعلي (لون مختلف عن النهاري)
//  12) معايرات:
//      (أ) شيل تصفير الهيدر عند الفتح  → فحص 7 يقع
//      (ب) اعرض الـad_id بدل العنوان   → فحص 4 يقع
//      (ج) شيل تحديث الشارة من renderConvos → فحص 8 يقع
//      (د) اخترع عنوان من الـad_id      → فحص 3 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

const TENANT = 't-test-1';
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();

// 🔴 معرّف إعلان حقيقي الشكل: 17 خانة (درس 40 — أكبر من MAX_SAFE_INTEGER
// فبييجي من ميتا كـstring). الفحص بيدوّر عليه في الصفحة كلها.
const AD_ID = '120212345678900123';
const HEADLINE = 'خصم 30% على ترولي المطبخ';

const base = (id, n, mins) => ({
  id, tenant_id: TENANT, wa_id: '2010000000' + n, customer_name: 'عميل ' + n,
  customer_phone: '2010000000' + n, last_message_at: iso(mins), last_inbound_at: iso(mins),
  last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
  labels: null, note: null,
  ctwa_clid: null, ctwa_ad_id: null, ctwa_headline: null, ctwa_source_type: null,
  ctwa_first_at: null, ctwa_last_at: null
});

// c1: إعلان بعنوان · c2: عادية · c3: إعلان من غير عنوان
const CONVOS = [
  Object.assign(base('c1', '01', 1), {
    ctwa_clid: 'ARAaBbCc123', ctwa_ad_id: AD_ID, ctwa_headline: HEADLINE,
    ctwa_source_type: 'ad', ctwa_first_at: iso(90), ctwa_last_at: iso(1)
  }),
  base('c2', '02', 5),
  Object.assign(base('c3', '03', 9), {
    ctwa_clid: 'ARZzYy987', ctwa_ad_id: AD_ID, ctwa_headline: null,
    ctwa_source_type: 'ad', ctwa_first_at: iso(30), ctwa_last_at: iso(9)
  })
];

const MSGS = CONVOS.map((c, i) => ({
  id: 'm' + i, tenant_id: TENANT, conversation_id: c.id, direction: 'in', type: 'text',
  body: 'أهلاً', is_read: true, created_at: iso(1), wa_timestamp: iso(1),
  status: null, wa_message_id: 'wamid-' + i
}));

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(opts.convos || CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(opts.msgs || MSGS)};
    // بوابة الإنبوكس: الستب بيرجّع wa_inbox_status = {verified:false}
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  if (opts.routeInbox) await ctx.route('**/js/inbox/inbox.js', opts.routeInbox);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  // لينك المحادثات مباشرةً — زرار القايمة بيفتح تاب لوحدها (openOwnTab)
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(300);
  return p;
}

const rowBadge = (p, id) => p.evaluate((cid) => {
  const row = document.querySelector('.wa-conv[data-id="' + cid + '"]');
  if (!row) return null;
  const el = row.querySelector('.wa-conv-ctwa');
  return { has: !!el, txt: el ? el.textContent.trim() : '' };
}, id);

const headBadge = (p) => p.evaluate(() => {
  const el = document.getElementById('wa-chat-ctwa');
  if (!el) return null;
  return {
    txt: el.textContent.trim(),
    shown: el.offsetParent !== null && getComputedStyle(el).display !== 'none'
  };
});

// الدليل الوحيد إن العنصر شايفه حد (درس 31/35)
const hitTest = (p, sel) => p.evaluate(async (s) => {
  const el = document.querySelector(s);
  if (!el) return 'مش موجود';
  el.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 120));
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return 'مقاس صفر';
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return (top && (top === el || el.contains(top) || top.contains(el))) ? 'ظاهر' : 'مدفون تحت ' + (top ? top.className || top.tagName : 'null');
}, sel);

const openConv = async (p, id) => {
  await p.click('.wa-conv[data-id="' + id + '"]');
  await p.waitForTimeout(400);
};

// ════ 1 · 2 · 3 · 4 — القايمة ════
{
  const p = await openInbox();
  console.log('──── الشارة في قايمة المحادثات ────');

  const r1 = await rowBadge(p, 'c1');
  ok(r1 && r1.has && r1.txt.indexOf(HEADLINE) >= 0,
     `1) صف الإعلان فيه الشارة بالعنوان: «${r1 && r1.txt}»`);

  const r2 = await rowBadge(p, 'c2');
  ok(r2 && !r2.has, '2) المحادثة العادية من غير أي شارة');

  const r3 = await rowBadge(p, 'c3');
  ok(r3 && r3.has && r3.txt.indexOf('جه من إعلان') >= 0 && r3.txt.indexOf(AD_ID) < 0
     && !/\d{6,}/.test(r3.txt),
     `3) إعلان من غير عنوان → «${r3 && r3.txt}» من غير عنوان مخترع`);

  await openConv(p, 'c1');
  const pageTxt = await p.evaluate(() => document.getElementById('page-inbox').innerHTML);
  ok(pageTxt.indexOf(AD_ID) < 0,
     '4) 🔴 معرّف الإعلان مش معروض في أي مكان في الصفحة');

  // ════ 5 · 6 — الهيدر والـhit-test ════
  console.log('──── الشارة في المحادثة المفتوحة ────');
  const h1 = await headBadge(p);
  ok(h1 && h1.shown && h1.txt.indexOf(HEADLINE) >= 0,
     `5) هيدر المحادثة بيعرض الشارة: «${h1 && h1.txt}»`);

  const hitHead = await hitTest(p, '#wa-chat-ctwa');
  ok(hitHead === 'ظاهر', `6أ) شارة الهيدر مش مدفونة (${hitHead})`);
  const hitRow = await hitTest(p, '.wa-conv[data-id="c1"] .wa-conv-ctwa');
  ok(hitRow === 'ظاهر', `6ب) شارة صف القايمة مش مدفونة (${hitRow})`);

  // ════ 7 — تبديل المحادثة ════
  console.log('──── تبديل المحادثة ────');
  await openConv(p, 'c2');
  const h2 = await headBadge(p);
  ok(h2 && !h2.shown && h2.txt === '',
     `7) 🔴 بعد التبديل لمحادثة عادية الشارة اختفت وفضيت (نص: «${h2 && h2.txt}»)`);

  // 🔴 إشعار المتصفح (inbox.js:611) بيفتح محادثة بالـid وهي ممكن تكون
  // **لسه مش في القايمة** (أول رسالة لعميل جديد وصلت قبل جلب القايمة).
  // ساعتها renderConvos مابيلقاهاش فمابيصفّرش الشارة — التصفير لازم يبقى
  // جوّه openConversation نفسها، غير كده شارة عميل تاني بتفضل معلقة.
  await openConv(p, 'c1');
  const ghost = await p.evaluate(async () => {
    const m = await import('/js/inbox/inbox.js');
    m.openConversation('c-ghost-not-in-list');
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('wa-chat-ctwa');
    return { txt: el.textContent.trim(), shown: getComputedStyle(el).display !== 'none' };
  });
  ok(!ghost.shown && ghost.txt === '',
     `7ب) محادثة مش في القايمة (إشعار المتصفح) بتصفّر الشارة برضه (نص: «${ghost.txt}»)`);

  await openConv(p, 'c3');
  const h3 = await headBadge(p);
  ok(h3 && h3.shown && h3.txt.indexOf('جه من إعلان') >= 0 && h3.txt.indexOf(AD_ID) < 0,
     `8) هيدر الإعلان بلا عنوان: «${h3 && h3.txt}»`);

  // ════ 9 — referral بيوصل والشات مفتوح ════
  console.log('──── العميل بيدوس الإعلان والشات مفتوح ────');
  await openConv(p, 'c2');
  const before = await headBadge(p);
  const live = await p.evaluate(async (args) => {
    const [tenant, ad, head] = args;
    window.__WA_CONVOS = window.__WA_CONVOS.map(function (c) {
      return c.id === 'c2'
        ? Object.assign({}, c, { ctwa_ad_id: ad, ctwa_headline: head, ctwa_clid: 'ARnew1',
                                 ctwa_source_type: 'ad' })
        : c;
    });
    const m = await import('/js/inbox/inbox.js');
    m.waFetchConvos(false);
    await new Promise(r => setTimeout(r, 600));
    const el = document.getElementById('wa-chat-ctwa');
    const row = document.querySelector('.wa-conv[data-id="c2"] .wa-conv-ctwa');
    return { head: el ? el.textContent.trim() : null,
             shown: el ? getComputedStyle(el).display !== 'none' : false,
             row: row ? row.textContent.trim() : null };
  }, [TENANT, AD_ID, 'إعلان جديد من الستوري']);
  ok(before && !before.shown, '9أ) قبل الجلب: مفيش شارة على المحادثة دي');
  ok(live.shown && live.head.indexOf('إعلان جديد من الستوري') >= 0,
     `9ب) 🔴 الشارة ظهرت في الهيدر من غير إعادة فتح: «${live.head}»`);
  ok(live.row && live.row.indexOf('إعلان جديد من الستوري') >= 0,
     `9ج) وظهرت في صف القايمة كمان: «${live.row}»`);

  await p.close();
}

// ════ 10 — الهروب ════
{
  const evil = '<img src=x onerror="window.__PWNED=1">خصم';
  const convos = [Object.assign(base('c1', '01', 1), { ctwa_ad_id: AD_ID, ctwa_headline: evil })];
  const p = await openInbox({ convos });
  console.log('──── الهروب والتخطيط ────');
  await openConv(p, 'c1');
  const r = await p.evaluate(() => ({
    pwned: !!window.__PWNED,
    imgs: document.querySelectorAll('.wa-conv-ctwa img, #wa-chat-ctwa img').length,
    rowTxt: (document.querySelector('.wa-conv[data-id="c1"] .wa-conv-ctwa') || {}).textContent || ''
  }));
  ok(!r.pwned && r.imgs === 0 && r.rowTxt.indexOf('<img') >= 0,
     '10) markup جوّه العنوان بيتعرض كنص — مفيش عنصر متحقون');
  await p.close();
}

// ════ 11 — عنوان طويل ════
{
  const long = 'اشتري ترولي المطبخ 5 أدوار ستانلس ستيل بخصم 30% والتوصيل مجاني لحد باب البيت في كل محافظات مصر خلال 48 ساعة';
  const convos = [Object.assign(base('c1', '01', 1), { ctwa_ad_id: AD_ID, ctwa_headline: long })];
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const p = await openInbox({ convos, viewport: vp });
    await openConv(p, 'c1');
    const g = await p.evaluate(() => {
      const head = document.querySelector('.wa-chat-head');
      const row = document.querySelector('.wa-conv[data-id="c1"]');
      const list = document.getElementById('wa-list-body');
      return {
        docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        headOver: head ? head.scrollWidth - head.clientWidth : -1,
        rowOver: (row && list) ? Math.round(row.getBoundingClientRect().width - list.getBoundingClientRect().width) : 0,
        backVisible: !!document.getElementById('wa-back')
      };
    });
    ok(g.docOver <= 1 && g.headOver <= 1 && g.rowOver <= 1,
       `11) عنوان طويل على ${vp.width}px مايمددش التخطيط (doc ${g.docOver} · head ${g.headOver} · row ${g.rowOver})`);
    await p.close();
  }
}

// ════ 12 — الوضع الليلي ════
{
  const p = await openInbox();
  await openConv(p, 'c1');
  const colors = await p.evaluate(async () => {
    const pick = () => {
      const h = getComputedStyle(document.getElementById('wa-chat-ctwa'));
      const r = getComputedStyle(document.querySelector('.wa-conv[data-id="c1"] .wa-conv-ctwa'));
      return { head: h.color + '|' + h.backgroundColor, row: r.color };
    };
    const light = pick();
    document.documentElement.classList.add('dark');
    await new Promise(r => setTimeout(r, 150));
    return { light, dark: pick() };
  });
  ok(colors.light.head !== colors.dark.head && colors.light.row !== colors.dark.row,
     `12) الليلي ليه تجاوز فعلي (نهاري ${colors.light.row} ← ليلي ${colors.dark.row})`);
  await p.close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');

// (أ) شيل تصفير الهيدر من openConversation → فحص 7ب لازم يقع.
// ⚠️ الفحص 7 العادي **مابيقعش** هنا لأن renderConvos بتغطيه — والمعايرة
// دي هي اللي كشفت إن النداءين مش تكرار: كل واحد بيغطي مسار لوحده.
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('  waUpdateCtwa(c);\n  renderConvos();', '  renderConvos();');
      await r.fulfill({ response: res, body });
    }
  });
  await openConv(p, 'c1');
  const g = await p.evaluate(async () => {
    const m = await import('/js/inbox/inbox.js');
    m.openConversation('c-ghost-not-in-list');
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('wa-chat-ctwa');
    return { txt: el.textContent.trim(), shown: getComputedStyle(el).display !== 'none' };
  });
  ok(g.shown && g.txt.indexOf(HEADLINE) >= 0,
     `معايرة أ: من غير التصفير الشارة فضلت «${g.txt}» على محادثة تانية — فحص 7ب بيمسكها`);
  await p.close();
}

// (ب) اعرض معرّف الإعلان بدل العنوان → فحص 4 لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('  if(h) return h;', '  if(h) return h+" · "+c.ctwa_ad_id;');
      await r.fulfill({ response: res, body });
    }
  });
  await openConv(p, 'c1');
  const pageTxt = await p.evaluate(() => document.getElementById('page-inbox').innerHTML);
  ok(pageTxt.indexOf(AD_ID) >= 0,
     'معايرة ب: بعرض الـad_id المعرّف بان في الصفحة — فحص 4 بيمسكها');
  await p.close();
}

// (ج) شيل تحديث الشارة من renderConvos → فحص 9ب لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('{ waUpdateWindow(ac); waUpdateCtwa(ac); }', '{ waUpdateWindow(ac); }');
      await r.fulfill({ response: res, body });
    }
  });
  await openConv(p, 'c2');
  const live = await p.evaluate(async (ad) => {
    window.__WA_CONVOS = window.__WA_CONVOS.map(function (c) {
      return c.id === 'c2' ? Object.assign({}, c, { ctwa_ad_id: ad, ctwa_headline: 'إعلان جديد من الستوري' }) : c;
    });
    const m = await import('/js/inbox/inbox.js');
    m.waFetchConvos(false);
    await new Promise(r => setTimeout(r, 600));
    const el = document.getElementById('wa-chat-ctwa');
    return { shown: el ? getComputedStyle(el).display !== 'none' : false,
             row: !!document.querySelector('.wa-conv[data-id="c2"] .wa-conv-ctwa') };
  }, AD_ID);
  ok(!live.shown && live.row,
     'معايرة ج: من غير تحديث renderConvos الصف اتحدث والهيدر لأ — فحص 9ب بيمسكها');
  await p.close();
}

// (د) اخترع عنوان من الـad_id → فحص 3 لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("if(c.ctwa_ad_id||c.ctwa_clid) return 'جه من إعلان';",
                          "if(c.ctwa_ad_id||c.ctwa_clid) return 'إعلان '+c.ctwa_ad_id;");
      await r.fulfill({ response: res, body });
    }
  });
  const r3 = await rowBadge(p, 'c3');
  ok(r3 && r3.has && /\d{6,}/.test(r3.txt),
     `معايرة د: بعنوان مخترع الصف بقى «${r3 && r3.txt}» — فحص 3 بيمسكها`);
  await p.close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
