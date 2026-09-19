// تصنيفات المحادثات — الأربعة الجداد (طلب المالك 19 سبتمبر) + إصلاح
// الفلتر الأعمى.
//
// 🔴 الفخ اللي الشغل ده اتبنى حواليه — **مقيس مش نظري**:
// `waFetchConvos` بتجيب **أحدث 200 محادثة بس**، و`waConvMatches` بتفلتر
// على المحمّل في الذاكرة. على الداتا الحية (19 سبتمبر) المحادثة رقم 200
// عند 3ataba عمرها **يومين**، و**6 من 18** محادثة عليها تصنيف كانت
// **بره النافذة** — يعني تلت التصنيفات مالهاش وجود في فلترها والشاشة
// بتقول «مفيش محادثات بالتصنيف ده» وهي موجودة (درس 6: الفلترة والترتيب
// مرتبطين، والنتيجة بتطلع غلط من غير أي خطأ في أي مكان).
//
// والتصنيفات الجديدة (استرجاع · استبدال · مكتمل) **طبيعتها** إنها على
// محادثات أقدم — فمن غير الإصلاح ده كانوا هيتولدوا مكسورين.
//
// الحل نفس شكل chip الإعلانات بالحرف: استعلام سيرفر
// (`.not('labels','is',null)`) في مصفوفة **منفصلة** (`waLabelExtra`)،
// والدمج جوّه فرع الفلتر بس — الدمج في `waConvos` اتجرّب في فلتر
// الإعلانات وطلع إن ترتيب وصول الاستعلامين بيحدد النتيجة.
//
// ⚠️ والستب اتظبط يطبّق `.not()` فعلاً — كان بيقبلها في السلسلة
// ومابيطبّقهاش، يعني الاستعلام المضيّق كان بيرجّع **كل** الصفوف وأي فحص
// عليه بيعدّي وهو أعمى (درس 33).
//
// اللي بيتفحص:
//   1) التسعة chips كلهم في الشريط + الأربعة الجداد في لوحة الاختيار
//   2) hit-test على chip جديد (درس 31/35) + ضغطة Playwright حقيقية
//   3) 🔴 الفلتر بيعرض المحادثة اللي **بره** أحدث 200
//   4) 🔴 والعدّاد على الـchip بيضمها **قبل أي ضغطة**
//   5) الاستعلام اللي خرج فعلاً فيه `.not(labels,is,null)` — سيرفر مش ذاكرة
//   6) 🔴 الضغط على صف من الفلتر بيفتح المحادثة الصح (`waConvById`)
//   7) تصنيف فيه **مسافة** («طلب واتساب») بيعدّي الـround-trip كامل
//   8) ملاحظة السقف مابتقولش «الأقدم مش بيظهر» وقت فلتر التصنيف
//   9) الرجوع لـ«الكل» بيرجّع القايمة كاملة
//  10) لون «مكتمل» مش لون الـfallback بتاع تصنيف مجهول
//  11) الصفوف المصنّفة بتترسم بشاراتها
//  12) 🔴 الشريط فاضل صفّين (75px) وصف التصنيفات بيتزحلق — مش 4 صفوف
//  13) 🔴 الشرايح ولوحة الاختيار بيتحدّثوا مع الـpoll (زميل صنّف من جهاز تاني)
//  12) معايرات:
//      (أ) خلي الفلتر يقرا من المحمّل بس  → فحص 3 يقع
//      (ب) شيل `waFetchLabelConvos` من الإقلاع → فحص 4 يقع
//      (ج) خلي `waConvById` تبص على `waConvos` بس → فحص 6 يقع
//      (د) شيل تطبيق `.not()` من الستب       → فحص 4 يقع (ستب أعمى)
//      (هـ) رجّع `flex-wrap:wrap` على الشريط  → فحص 12 يقع
//      (و) شيل تحديث التصنيفات من renderConvos  → فحص 13 يقع
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

const base = (id, n, mins) => ({
  id, tenant_id: TENANT, wa_id: '2010' + String(n).padStart(7, '0'),
  customer_name: 'عميل ' + n, customer_phone: '2010' + String(n).padStart(7, '0'),
  last_message_at: iso(mins), last_inbound_at: iso(mins),
  last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
  labels: null, note: null,
  ctwa_clid: null, ctwa_ad_id: null, ctwa_headline: null, ctwa_source_type: null,
  ctwa_ad_body: null, ctwa_source_url: null, ctwa_first_at: null, ctwa_last_at: null
});

// 🔴 600 محادثة. «استرجاع» على واحدة جوّه الـ200 وواحدة **رقم 550**.
// الرقم 550 مقصود مش عشوائي: `waFetchLabelConvos` بتستعلم بـ
// `.not(labels,is,null).limit(500)`. لو الاستعلام **مضيّق على السيرفر**
// (زي الإنتاج) الـ500 بتتحسب على الصفوف المصنّفة بس فالقديمة بتدخل؛
// ولو الستب رجّع كل حاجة (ستب أعمى — درس 33) الـ500 بتتحسب على الكل
// فالصف رقم 551 **يقع بره** والعدّاد يرجع 1.
// يعني الفيكستشر ده بيخلي تطبيق `.not()` في الستب **حامل حمل فعلاً**
// — ومعايرة (د) تحت بتثبت كده.
const CONVOS = [];
for (let i = 0; i < 600; i++) CONVOS.push(base('c' + i, i, i + 1));
CONVOS[7].labels   = ['استرجاع'];                 // جوّه أحدث 200
CONVOS[550].labels = ['استرجاع'];                 // 🔴 بره أحدث 200 وبره أحدث 500
CONVOS[12].labels  = ['طلب واتساب', 'مهم'];       // تصنيف فيه مسافة
CONVOS[30].labels  = ['استبدال'];
CONVOS[45].labels  = ['مكتمل', 'تم الحل'];
// مصفوفة فاضية: `.not(labels,is,null)` بترجّعها من PostgREST، والكود هو
// اللي بيستبعدها. من غير الصف ده العدّاد ممكن يعدّي وهو بيعد صفوف فاضية.
CONVOS[60].labels  = [];
CONVOS[550].customer_name = 'عميلة الاسترجاع القديمة';

const MSGS = [{
  id: 'm1', tenant_id: TENANT, conversation_id: 'c550', direction: 'in', type: 'text',
  body: 'عايزة أرجّع الأوردر', is_read: true, created_at: iso(551), wa_timestamp: iso(551),
  status: null, wa_message_id: 'wamid-550'
}];

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(opts.stub || STUB);
  if (opts.routeInbox) await ctx.route('**/js/inbox/inbox.js', opts.routeInbox);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(600);
  return p;
}

// الدليل الوحيد إن العنصر شايفه حد (درس 31/35)
const hitTest = (p, sel) => p.evaluate(async (s) => {
  const el = document.querySelector(s);
  if (!el) return 'مش موجود';
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise(r => setTimeout(r, 120));
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return 'مقاس صفر';
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return (top && (top === el || el.contains(top) || top.contains(el))) ? 'ظاهر' : 'مدفون تحت ' + (top ? top.className || top.tagName : 'null');
}, sel);

const listIds = (p) => p.evaluate(() =>
  Array.from(document.querySelectorAll('#wa-list-body .wa-conv')).map(e => e.getAttribute('data-id')));

const chipFor = (p, label) => p.evaluate((l) => {
  const el = document.querySelector('#wa-filters .wa-flabel[data-label="' + l + '"]');
  return el ? el.textContent.trim() : null;
}, label);

const NEW_LABELS = ['طلب واتساب', 'استبدال', 'استرجاع', 'مكتمل'];

// ════════════════ 1-2 — الـchips موجودة وشايفها حد ════════════════
{
  const p = await openInbox();
  console.log('──── الـchips ────');
  const chips = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#wa-filters .wa-flabel')).map(e => e.getAttribute('data-label')));
  ok(chips.length === 9, `1أ) 9 chips تصنيف في الشريط (${chips.length})`);
  for (const l of NEW_LABELS) ok(chips.indexOf(l) >= 0, `1ب) «${l}» في الشريط`);

  // لوحة الاختيار جوّه المحادثة
  await p.click('.wa-conv[data-id="c7"]'); await p.waitForTimeout(400);
  await p.click('#wa-label-btn'); await p.waitForTimeout(300);
  const picks = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#wa-label-picker .wa-lp')).map(e => e.getAttribute('data-label')));
  for (const l of NEW_LABELS) ok(picks.indexOf(l) >= 0, `1ج) «${l}» في لوحة الاختيار`);

  const ht = await hitTest(p, '#wa-filters .wa-flabel[data-label="استرجاع"]');
  ok(ht === 'ظاهر', `2) hit-test على chip «استرجاع»: ${ht}`);
  await p.close();
}

// ════════════════ 3-6 — الفلتر بيشوف بره الـ200 ════════════════
{
  const p = await openInbox();
  console.log('──── الفلتر بيقرا من السيرفر ────');

  // 🔴 العدّاد **قبل** أي ضغطة — رقم بيتغير لما تدوس عليه = رقم بيكدب
  const before = await chipFor(p, 'استرجاع');
  ok(/\(2\)/.test(before || ''), `4) 🔴 العدّاد بيضم اللي بره أحدث 200 قبل الضغط: «${before}»`);

  await p.click('#wa-filters .wa-flabel[data-label="استرجاع"]');
  await p.waitForTimeout(700);
  const ids = await listIds(p);
  ok(ids.length === 2 && ids.indexOf('c550') >= 0 && ids.indexOf('c7') >= 0,
     `3) 🔴 الفلتر عرض الاتنين ومنهم c550 اللي بره الـ200 والـ500 (${JSON.stringify(ids)})`);

  // الاستعلام اللي خرج فعلاً
  const q = await p.evaluate(() => (window.__calls || [])
    .filter(c => c.table === 'wa_conversations' && c.not)
    .map(c => c.not));
  ok(q.length > 0 && q.some(n => n.col === 'labels' && n.op === 'is' && n.val === null),
     `5) الاستعلام خرج بـ.not(labels,is,null) — سيرفر مش ذاكرة (${JSON.stringify(q)})`);

  // ملاحظة السقف مالهاش لازمة هنا — الفلتر شايف الأقدم
  const cap = await p.evaluate(() => {
    const el = document.querySelector('#wa-list-body .wa-cap-note');
    return el ? el.textContent : '';
  });
  ok(cap.indexOf('الأقدم مش بيظهر') < 0,
     `8) ملاحظة «الأقدم مش بيظهر» مش بتتعرض وقت فلتر التصنيف («${cap.trim()}»)`);

  // 🔴 الضغط على الصف اللي بره الـ200 لازم يفتح **محادثته هو**
  await p.click('.wa-conv[data-id="c550"]');
  await p.waitForTimeout(600);
  const head = await p.evaluate(() => {
    const el = document.querySelector('.wa-chat-name');
    return el ? el.textContent.trim() : '';
  });
  ok(head === 'عميلة الاسترجاع القديمة',
     `6) 🔴 الهيدر بتاع المحادثة الصح — waConvById شايفة waLabelExtra («${head}»)`);

  // الرجوع للكل
  await p.click('#wa-filters .wa-filter[data-f="all"]');
  await p.waitForTimeout(500);
  const all = await listIds(p);
  ok(all.length === 200, `9) الرجوع لـ«الكل» رجّع القايمة كاملة (${all.length})`);
  await p.close();
}

// ════════════════ 7 — تصنيف فيه مسافة ════════════════
{
  const p = await openInbox();
  console.log('──── تصنيف فيه مسافة ────');
  const dataF = await p.evaluate(() => {
    const el = document.querySelector('#wa-filters .wa-flabel[data-label="طلب واتساب"]');
    return el ? el.getAttribute('data-f') : null;
  });
  ok(dataF === 'label:طلب واتساب', `7أ) data-f اتكتب صح: «${dataF}»`);
  await p.click('#wa-filters .wa-flabel[data-label="طلب واتساب"]');
  await p.waitForTimeout(600);
  const ids = await listIds(p);
  ok(ids.length === 1 && ids[0] === 'c12',
     `7ب) 🔴 المسافة عدّت الـround-trip كامل والفلتر اشتغل (${JSON.stringify(ids)})`);
  const active = await p.evaluate(() => {
    const el = document.querySelector('#wa-filters .wa-flabel.active');
    return el ? el.getAttribute('data-label') : null;
  });
  ok(active === 'طلب واتساب', `7ج) والـchip اتعلّم active: «${active}»`);
  await p.close();
}

// ════════════════ 10-11 — الألوان والشارات ════════════════
{
  const p = await openInbox();
  console.log('──── الألوان والشارات ────');
  // 🔴 #64748b هو لون التصنيف **المجهول** — لو تصنيف حقيقي أخده، التاجر
  // مش هيفرّق بين «مكتمل» و«تصنيف مش في القايمة»
  const cssColors = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll('#wa-list-body .wa-conv-label').forEach(e => {
      out[e.textContent.trim()] = e.style.background;
    });
    return out;
  });
  ok(Object.keys(cssColors).length > 0, `11) الصفوف المصنّفة بترسم شاراتها (${JSON.stringify(cssColors)})`);
  const fallback = ['rgb(100, 116, 139)', '#64748b'];
  const done = cssColors['مكتمل'];
  ok(!done || fallback.indexOf(done) < 0,
     `10) لون «مكتمل» مش لون الـfallback بتاع المجهول («${done}»)`);
  await p.close();
}

// ════════════════ 12 — الشريط مابيكلش القايمة ════════════════
{
  // 🔴 اتقاس قبل الإصلاح: 9 تصنيفات في شريط `flex-wrap:wrap` = **4 صفوف
  // و135px**، وعمود المحادثات نزل من 4.7 لـ3.7 محادثة على 1280×720.
  // الصف المتزحلق رجّعه 75px. الفحص ده بيمنع رجوع الـwrap في صمت.
  const p = await openInbox({ viewport: { width: 1280, height: 720 } });
  console.log('──── تخطيط الشريط ────');
  const m = await p.evaluate(() => {
    const f = document.getElementById('wa-filters');
    const lab = document.querySelector('.wa-f-labels');
    const chips = Array.from(f.querySelectorAll('.wa-filter'));
    return {
      h: Math.round(f.getBoundingClientRect().height),
      rows: new Set(chips.map(c => c.offsetTop)).size,
      scrollable: lab ? (lab.scrollWidth > lab.clientWidth + 2) : false,
      bodyH: Math.round(document.querySelector('.wa-list-body').getBoundingClientRect().height)
    };
  });
  ok(m.rows === 2, `12أ) 🔴 الشريط صفّين مش أكتر (${m.rows})`);
  ok(m.h <= 90, `12ب) 🔴 وارتفاعه ${m.h}px — كان 135px بالـwrap`);
  ok(m.scrollable, `12ج) وصف التصنيفات بيتزحلق أفقي فالتسعة كلهم واصلين`);
  await p.close();
}

// ════════════════ 13 — التصنيفات بتتحدّث مع الـpoll ════════════════
{
  // 🔴 الـpoll (20ث) بيستبدل `waConvos` بالكامل. لو زميل ضاف تصنيف وأنت
  // فاتح نفس المحادثة، الشرايح ولوحة الاختيار كانوا بيفضلوا على النسخة
  // القديمة — و`waToggleLabel` بتقرا الصف الطازة، فالضغطة بتعمل **عكس**
  // اللي الموظف شايفه. زرار بيعمل عكس وعده أسوأ من زرار ميت (درس 16).
  const p = await openInbox();
  console.log('──── التحديث مع الـpoll ────');
  await p.click('.wa-conv[data-id="c30"]'); await p.waitForTimeout(400);
  await p.click('#wa-label-btn'); await p.waitForTimeout(300);
  const before = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#wa-label-picker .wa-lp.active')).map(e => e.getAttribute('data-label')));
  ok(before.length === 1 && before[0] === 'استبدال',
     `13أ) لوحة الاختيار بتعلّم التصنيف الحالي (${JSON.stringify(before)})`);

  // زميل ضاف «مكتمل» من جهاز تاني — الـpoll الجاي بيجيبه
  await p.evaluate(() => {
    const c = window.__WA_CONVOS.find(x => x.id === 'c30');
    c.labels = ['استبدال', 'مكتمل'];
  });
  await p.evaluate(async () => {
    const m = await import('/js/inbox/inbox.js');
    await m.waFetchConvos(false);
    await new Promise(r => setTimeout(r, 300));
  });
  const after = await p.evaluate(() => ({
    picker: Array.from(document.querySelectorAll('#wa-label-picker .wa-lp.active')).map(e => e.getAttribute('data-label')),
    chips:  Array.from(document.querySelectorAll('#wa-clabels .wa-clabel')).map(e => e.textContent.trim())
  }));
  ok(after.picker.indexOf('مكتمل') >= 0,
     `13ب) 🔴 لوحة الاختيار لحقت تصنيف الزميل (${JSON.stringify(after.picker)})`);
  ok(after.chips.indexOf('مكتمل') >= 0,
     `13ج) وشرايح المحادثة المفتوحة كمان (${JSON.stringify(after.chips)})`);
  await p.close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');

// (أ) خلي الفلتر يقرا من المحمّل بس → فحص 3 يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // بنشيل فرع الدمج بتاع التصنيف — السطر اللي بيضيف من waLabelExtra
      body = body.replace(/if\(!seenL\[waLabelExtra\[z2\]\.id\][^\n]*\n/, '');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-filters .wa-flabel[data-label="استرجاع"]');
  await p.waitForTimeout(700);
  const ids = await listIds(p);
  ok(ids.length === 1 && ids.indexOf('c550') < 0,
     `معايرة أ: من غير الدمج الفلتر عرض ${ids.length} بس والقديمة اختفت — فحص 3 بيمسكها`);
  await p.close();
}

// (ب) شيل `waFetchLabelConvos()` من الإقلاع → فحص 4 يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // 🔴 السطر نفسه بـregex — مش سطرين متجاورين (درس 47)
      body = body.replace(/\n\s*waFetchLabelConvos\(\);\n\s*waFetchConvos\(true\);/,
                          '\n  waFetchConvos(true);');
      await r.fulfill({ response: res, body });
    }
  });
  const c = await chipFor(p, 'استرجاع');
  ok(/\(1\)/.test(c || ''),
     `معايرة ب: من غير الجلب وقت الإقلاع العدّاد قال «${c}» بدل (2) — فحص 4 بيمسكها`);
  await p.close();
}

// (ج) خلي `waConvById` تبص على `waConvos` بس → فحص 6 يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace(/for\(var m=0;m<waLabelExtra\.length;m\+\+\)\{[^\n]*\n/, '');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-filters .wa-flabel[data-label="استرجاع"]');
  await p.waitForTimeout(700);
  await p.click('.wa-conv[data-id="c550"]');
  await p.waitForTimeout(600);
  const head = await p.evaluate(() => {
    const el = document.querySelector('.wa-chat-name');
    return el ? el.textContent.trim() : '';
  });
  ok(head !== 'عميلة الاسترجاع القديمة',
     `معايرة ج: من غير waLabelExtra في waConvById الهيدر طلع «${head}» — فحص 6 بيمسكها`);
  await p.close();
}

// (و) شيل تحديث التصنيفات من `renderConvos` → فحص 13 يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // السطر نفسه بس (درس 47)
      body = body.replace(/\n\s*waUpdateWindow\(ac\); waUpdateCtwa\(ac\); waRenderConvLabels\(ac\);/,
                          '\n    waUpdateWindow(ac); waUpdateCtwa(ac);');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('.wa-conv[data-id="c30"]'); await p.waitForTimeout(400);
  await p.click('#wa-label-btn'); await p.waitForTimeout(300);
  await p.evaluate(() => {
    const c = window.__WA_CONVOS.find(x => x.id === 'c30');
    c.labels = ['استبدال', 'مكتمل'];
  });
  await p.evaluate(async () => {
    const m = await import('/js/inbox/inbox.js');
    await m.waFetchConvos(false);
    await new Promise(r => setTimeout(r, 300));
  });
  const chips = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#wa-clabels .wa-clabel')).map(e => e.textContent.trim()));
  ok(chips.indexOf('مكتمل') < 0,
     `معايرة و: من غير التحديث الشرايح فضلت ${JSON.stringify(chips)} — فحص 13ج بيمسكها`);
  await p.close();
}

// (هـ) رجّع `flex-wrap:wrap` على الشريط → فحص 12 يقع
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  await ctx.route('**/css/21-inbox.css', async r => {
    const res = await r.fetch();
    let body = await res.text();
    // 🔴 السطر نفسه بـregex (درس 47) — بنرجّع الشريط لصف واحد بيلفّ
    body = body.replace(/\.wa-f-labels\{display:flex;flex-wrap:nowrap;[^}]*\}/,
                        '.wa-f-labels{display:flex;flex-wrap:wrap;gap:6px;}');
    await r.fulfill({ response: res, body });
  });
  const p = await ctx.newPage();
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(600);
  const m = await p.evaluate(() => {
    const f = document.getElementById('wa-filters');
    const chips = Array.from(f.querySelectorAll('.wa-filter'));
    return { h: Math.round(f.getBoundingClientRect().height),
             rows: new Set(chips.map(c => c.offsetTop)).size };
  });
  ok(m.rows > 2 && m.h > 90,
     `معايرة هـ: برجوع الـwrap الشريط بقى ${m.rows} صفوف و${m.h}px — فحص 12 بيمسكها`);
  await p.close();
}

// (د) شيل تطبيق `.not()` من الستب → فحص 4 يقع (ستب أعمى — درس 33)
{
  const blindStub = STUB.replace(
    /if\(st\.not && st\.not\.op === 'is' && st\.not\.val === null\)\{[\s\S]*?\n      \}/,
    '');
  if (blindStub === STUB) { ok(false, 'معايرة د: الاستبدال مالقاش الكود — المعايرة نفسها بايظة (درس 47)'); }
  const p = await openInbox({ stub: blindStub });
  const c = await chipFor(p, 'استرجاع');
  // 🔴 من غير التضييق الـlimit(500) بتتحسب على الـ600 كلهم فالصف رقم 551
  // يقع بره — العدّاد بيرجع 1 والفلتر بيكدب. الفحص ده هو اللي بيثبت إن
  // الستب بيقطع **زي PostgREST** مش بيرجّع كل حاجة.
  // الـ«+» في «(1+)» دليل إضافي: الستب الأعمى رجّع 500 صف بالظبط فعلامة
  // السقف ولّعت كمان — يعني الاستعلام مارجعش الصفوف المصنّفة، رجّع الكل.
  ok(/\(1\+?\)/.test(c || ''),
     `معايرة د: ستب بيقبل .not() ومابيطبّقهاش رجّع «${c}» بدل (2) — فحص 4 بيمسكها`);
  await p.close();
}

console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
await b.close();
process.exit(bad ? 1 : 0);
