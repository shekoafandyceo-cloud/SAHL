// الردود المحفوظة — زراير باسم مختصر بتبعت بضغطة + نافذة إدارة (طلب المالك 24 سبتمبر)
//
// «الردود المحفوظة الي تحت تكون عبارة عن زراير عليها الاسم المختصر … ومجرد ما الموظف
//  يدوس عليها يبعت الرد المحفوظ على طول سواء بصور او من غير» + «زرار "إضافة و تعديل رد
//  محفوظ" … نحذف او نعدل … ونسجل الرد بأسم مختصر … ونعدل ترتيب الازرار».
//
// 🔴 ده بيلغي قرار 16 سبتمبر («الرد بصور بيتحضّر مش بيتبعت بالضغطة») بطلب صريح من
// المالك. الحراسات اللي كانت المعاينة بتديها اتنقلت للكود وبتتفحص هنا:
//   قفل أثناء الإرسال · الزراير بتختفي والنافذة مقفولة · الهدف ثابت لحظة الضغط.
// ومن قبل كده (فاضل زي ما هو — درس 46): **الكلام caption على آخر صورة**.
//
// اللي بيتفحص:
//   1) الزراير: الاسم المختصر · شارة 📎N · رد قديم من غير اسم بياخد أول كلامه
//   2) الصف مفتوح افتراضياً (مش ورا ⚡) + hit-test
//   3) 🔴 ضغطة واحدة = الرد كله: الصور بالترتيب والكلام caption على آخر واحدة
//   4) خانة الكتابة مابتتلمسش (الموظف ممكن يكون في نص رسالة)
//   5) 🔴 ضغطتين ورا بعض = رد واحد (قفل أثناء الإرسال)
//   6) 🔴 تبديل المحادثة في النص: كل الأجزاء بتروح للمحادثة اللي اتداس فيها
//   7) 🔴 النافذة مقفولة = مفيش زراير
//   8) رد نصي = رسالة نص واحدة
//   9) ⚡ بيطوي الصف والاختيار بيتفتكر بعد الريفريش
//  10) النافذة من زرار شريط الفلاتر: القايمة بالترتيب + hit-test
//  11) رد جديد: الاسم إجباري · الرفع مرة واحدة بمسار المتجر · الحمولة كاملة · الزرار ظهر
//  12) تعديل: الاسم والنص · والصور الموجودة بتتشال/تفضل
//  13) 🔴 الترتيب: ▼ بيغيّر الزراير تحت وبيتكتب في sort
//  14) الحذف بتأكيد: «إلغاء» مابيحذفش · «احذف» بيحذف
//  15) موبايل: زرار الشريط مخفي و«⚙️ إدارة الردود» بيفتح نفس النافذة
//  16) حارس `bad_media_path` في `wa-send` (منطق خالص على الكود المنشور)
//  17) نص فوق 1024 حرف = رسالة مستقلة (ميتا بترفض caption أطول)
// المعايرات (كل واحدة بحارس «المرساة اتلقت» — درس 47):
//   (أ) شيل القفل → 5 · (ب) صور بالتوازي → 3 · (ج) وقف عند تبديل المحادثة → 6 ·
//   (د) شيل بادئة المتجر → 11 · (هـ) الكلام رسالة مستقلة → 3 · (و) شيل إخفاء النافذة → 7 ·
//   (ز) الترتيب مايتكتبش → 13
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
const P1 = TENANT + '/quick-replies/a1.jpg';
const P2 = TENANT + '/quick-replies/a2.jpg';
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PIX.split(',')[1], 'base64');

// q1 رد قديم من غير اسم (زي الـ4 اللي على الحي) · q2 باسم وصورتين · q3 صور بس
const QR = [
  { id: 'q1', tenant_id: TENANT, title: null, body: 'أهلاً بحضرتك 👋 نورتنا', media: [], sort: 0 },
  { id: 'q2', tenant_id: TENANT, title: 'تيربو', body: 'دي صور المنتج والسعر 350ج', sort: 1,
    media: [{ path: P1, mime: 'image/jpeg', name: 'a1.jpg' }, { path: P2, mime: 'image/jpeg', name: 'a2.jpg' }] },
  { id: 'q3', tenant_id: TENANT, title: null, body: '', sort: 2, media: [{ path: P1, mime: 'image/jpeg', name: 'a1.jpg' }] }
];
// c3 نافذته قفلت (آخر رسالة من العميل من 30 ساعة)
const CONVOS = [[1, 1], [2, 2], [3, 30 * 60]].map(([n, ago]) => ({
  id: 'c' + n, tenant_id: TENANT, wa_id: '20100000' + n, customer_name: 'عميل ' + n,
  customer_phone: '20100000' + n, last_message_at: iso(n), last_inbound_at: iso(ago),
  last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
  labels: null, note: null, ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null,
  ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null
}));
const MSGS = CONVOS.map((c, i) => ({
  id: 'm' + i, tenant_id: TENANT, conversation_id: c.id, direction: 'in', type: 'text',
  body: 'أهلاً', is_read: true, created_at: iso(1), wa_timestamp: iso(1), status: null, wa_message_id: 'wamid-' + i
}));

// المعايرة: بتعدّل موديول الإنبوكس وبترمي لو المرساة مااتلقتش (درس 47)
const patchInbox = (pairs) => async r => {
  const res = await r.fetch();
  let body = await res.text();
  for (const [a, c] of pairs) {
    const before = body;
    body = body.replace(a, c);
    if (body === before) throw new Error('المعايرة مالقتش المرساة: ' + String(a).slice(0, 60));
  }
  await r.fulfill({ response: res, body });
};

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    if(!window.__QR) window.__QR = ${JSON.stringify(opts.qr || QR)};
    window.__MEDIA     = { ${JSON.stringify(P1)}: ${JSON.stringify(PIX)}, ${JSON.stringify(P2)}: ${JSON.stringify(PIX)} };
    window.__UPLOAD_OK = true;
    window.__SENT = [];
    window.__FN = function(slug, body){
      window.__SENT.push({ slug: slug, body: body, at: performance.now() });
      ${opts.fnDelayMs ? `return new Promise(function(r){ setTimeout(function(){ r({ok:true, message_id:'w'+window.__SENT.length}); }, ${opts.fnDelayMs}); });`
                       : `return { ok:true, message_id:'w'+window.__SENT.length };`}
    };
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  if (opts.patch) await ctx.route('**/js/inbox/inbox.js', patchInbox(opts.patch));
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  if (opts.conv !== false) {
    await p.click('.wa-conv[data-id="' + (opts.conv || 'c1') + '"]');
    await p.waitForTimeout(400);
  }
  return p;
}

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
const chips = p => p.evaluate(() => Array.from(document.querySelectorAll('#wa-qr-panel .wa-qr')).map(e => ({
  id: e.getAttribute('data-qid'), badge: (e.querySelector('.wa-qr-badge') || {}).textContent || '',
  txt: ((e.querySelector('.wa-qr-txt') || {}).textContent || '').trim() })));
const sentList = p => p.evaluate(() => window.__SENT.map(s => ({
  conv: s.body.conversation_id, img: s.body.image_path || null, text: s.body.text || null, cap: s.body.caption || null })));
const panelShown = p => p.evaluate(() => { const x = document.getElementById('wa-qr-panel'); return !!x && getComputedStyle(x).display !== 'none'; });
const qrCalls = (p, pred) => p.evaluate(src => { const f = eval(src); return (window.__calls || []).filter(c => c.table === 'wa_quick_replies').filter(f); }, String(pred));

// ════ 1–4 · 8: الزراير والإرسال بضغطة ════
{
  const p = await openInbox();
  console.log('──── الزراير ────');
  const cs = await chips(p);
  ok(cs.length === 3, `1أ) التلات ردود ظهروا كزراير: ${cs.length}`);
  const q2 = cs.find(c => c.id === 'q2'), q1 = cs.find(c => c.id === 'q1'), q3 = cs.find(c => c.id === 'q3');
  ok(q2 && q2.txt === 'تيربو' && q2.badge.indexOf('2') >= 0, `1ب) الزرار بالاسم المختصر وشارة الصور: «${q2 && q2.txt}» ${q2 && q2.badge}`);
  ok(q1 && q1.txt.indexOf('أهلاً بحضرتك') === 0 && !q1.badge, `1ج) رد قديم من غير اسم بياخد أول كلامه: «${q1 && q1.txt}»`);
  ok(q3 && q3.txt.length > 1 && q3.badge.indexOf('1') >= 0, `1د) رد صور بس ليه تسمية: «${q3 && q3.txt}»`);
  ok(await panelShown(p), '2أ) صف الزراير ظاهر من غير ما حد يدوس ⚡');
  ok(await hitTest(p, '.wa-qr[data-qid="q2"]') === 'ظاهر', '2ب) hit-test: الزرار مش مدفون');

  console.log('──── ضغطة واحدة = الرد كله ────');
  await p.fill('#wa-input', 'مسودة الموظف');
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(900);
  const sent = await sentList(p);
  ok(sent.length === 2, `3أ) 🔴 الضغطة بعتت الرد على طول — رسالتين (صورتين والكلام راكب التانية): ${sent.length}`);
  ok(sent[0] && sent[0].img === P1 && sent[1] && sent[1].img === P2, '3ب) 🔴 الصور بالترتيب المحفوظ');
  ok(!sent.some(m => m.text && !m.img), '3ج) 🔴 مفيش رسالة نص لوحدها — الكلام مايقدرش يتوسط الصور');
  ok(sent[1] && sent[1].cap === 'دي صور المنتج والسعر 350ج' && !sent[0].cap, '3د) 🔴 الكلام caption على **آخر** صورة بس');
  ok(sent.every(m => m.conv === 'c1'), '3هـ) كله راح للمحادثة المفتوحة');
  ok(await p.inputValue('#wa-input') === 'مسودة الموظف', '4) خانة الكتابة مااتلمستش');

  await p.evaluate(() => { window.__SENT.length = 0; });
  await p.click('.wa-qr[data-qid="q1"]');
  await p.waitForTimeout(600);
  const s8 = await sentList(p);
  ok(s8.length === 1 && s8[0].text === 'أهلاً بحضرتك 👋 نورتنا' && !s8[0].img, `8) الرد النصي = رسالة نص واحدة: ${s8.length}`);
  await p.close();
}

// ════ 5 · 6: القفل والهدف الثابت ════
{
  console.log('──── القفل والهدف ────');
  const p = await openInbox({ fnDelayMs: 150 });
  await p.evaluate(() => { const b = document.querySelector('.wa-qr[data-qid="q2"]'); b.click(); b.click(); });
  await p.waitForTimeout(1000);
  const n5 = (await sentList(p)).length;
  ok(n5 === 2, `5) 🔴 ضغطتين ورا بعض = رد واحد (رسالتين مش أربعة): ${n5}`);

  await p.evaluate(() => { window.__SENT.length = 0; });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(40);
  await p.click('.wa-conv[data-id="c2"]');
  await p.waitForTimeout(1000);
  const s6 = await sentList(p);
  ok(s6.length === 2 && s6.every(m => m.conv === 'c1'),
     `6) 🔴 تبديل المحادثة في النص: الرد كمل كله لنفس العميل (${s6.length} · ${[...new Set(s6.map(m => m.conv))].join(',')})`);
  await p.close();
}

// ════ 7 · 9: النافذة المقفولة والطيّ ════
{
  console.log('──── النافذة والطيّ ────');
  const p = await openInbox({ conv: 'c3' });
  ok(!(await panelShown(p)), '7) 🔴 النافذة مقفولة = مفيش زراير بتبعت');
  await p.click('.wa-conv[data-id="c1"]');
  await p.waitForTimeout(400);
  ok(await panelShown(p), '7ب) ورجعت لما فتحنا محادثة نافذتها مفتوحة');
  await p.click('#wa-qr-btn');
  await p.waitForTimeout(200);
  const col = await p.evaluate(() => ({ shown: getComputedStyle(document.getElementById('wa-qr-panel')).display !== 'none',
    key: localStorage.getItem('sahl_qr_collapsed') }));
  ok(!col.shown && col.key === '1', '9أ) ⚡ طوى الصف واتفتكر');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.click('.wa-conv[data-id="c1"]');
  await p.waitForTimeout(400);
  ok(!(await panelShown(p)), '9ب) وبعد الريفريش فضل مطوي');
  await p.close();
}

// ════ 10–14: نافذة الإدارة ════
{
  console.log('──── نافذة «إضافة و تعديل رد محفوظ» ────');
  const p = await openInbox();
  ok(await hitTest(p, '#wa-qrm-open') === 'ظاهر', '10أ) زرار الشريط ظاهر ومش مدفون');
  await p.click('#wa-qrm-open');
  await p.waitForTimeout(300);
  const rows = () => p.evaluate(() => Array.from(document.querySelectorAll('#wa-qrm .wa-qrm-row')).map(r => r.getAttribute('data-id')));
  ok(JSON.stringify(await rows()) === '["q1","q2","q3"]', `10ب) النافذة اتفتحت بالقايمة بالترتيب: ${await rows()}`);

  // 11) رد جديد
  await p.click('#wa-qrm-new');
  await p.fill('#wa-qrm-text', 'السعر النهاردة 499ج');
  await p.click('#wa-qrm-save');
  await p.waitForTimeout(300);
  ok((await qrCalls(p, 'c => c.inserted')).length === 0, '11أ) من غير اسم مختصر الحفظ اترفض — مفيش إدخال');
  await p.fill('#wa-qrm-name', 'عرض');
  for (const n of ['x1.png', 'x2.png']) { await p.setInputFiles('#wa-qrm-file', { name: n, mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(150); }
  await p.click('#wa-qrm-thumbs .wa-qr-thumb-x');
  await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.querySelectorAll('#wa-qrm-thumbs .wa-qr-thumb').length) === 1, '11ب) إضافة صورتين وشيل واحدة');
  await p.click('#wa-qrm-save');
  await p.waitForTimeout(700);
  const ups = await p.evaluate(() => window.__UPLOADS || []);
  ok(ups.length === 1 && ups[0].indexOf(TENANT + '/quick-replies/') === 0, `11ج) 🔴 صورة واحدة اترفعت بمسار المتجر: «${ups[0]}»`);
  const ins = (await qrCalls(p, 'c => c.inserted'))[0];
  const pl = ins && ins.payload;
  ok(pl && pl.title === 'عرض' && pl.body === 'السعر النهاردة 499ج' && pl.media.length === 1 && pl.media[0].path === ups[0] && pl.sort === 3,
     `11د) الحمولة: الاسم والنص والصورة وآخر ترتيب (${pl && pl.sort})`);
  const cs11 = await chips(p);
  ok(cs11.length === 4 && cs11[3].txt === 'عرض', '11هـ) الزرار الجديد ظهر تحت بالاسم في الآخر');

  // 12) تعديل q1 (من غير اسم) → اسم
  await p.click('#wa-qrm .wa-qrm-row[data-id="q1"] [data-ed]');
  await p.waitForTimeout(200);
  const pre = await p.evaluate(() => ({ n: document.getElementById('wa-qrm-name').value, t: document.getElementById('wa-qrm-text').value }));
  ok(pre.n === '' && pre.t.indexOf('أهلاً بحضرتك') === 0, '12أ) فورم التعديل اتعبّى بالرد (والاسم فاضي للقديم)');
  await p.fill('#wa-qrm-name', 'ترحيب');
  await p.click('#wa-qrm-save');
  await p.waitForTimeout(400);
  const qr1 = await p.evaluate(() => window.__QR.find(q => q.id === 'q1'));
  ok(qr1 && qr1.title === 'ترحيب' && qr1.body.indexOf('أهلاً') === 0, '12ب) التعديل اتكتب في الصف');
  ok((await chips(p)).find(c => c.id === 'q1').txt === 'ترحيب', '12ج) والزرار اتسمّى');
  // تعديل صور q2: شيل الأولى
  await p.click('#wa-qrm .wa-qrm-row[data-id="q2"] [data-ed]');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.querySelectorAll('#wa-qrm-thumbs .wa-qr-thumb img').length) === 2, '12د) صور الرد الموجود ظهرت في التعديل');
  await p.click('#wa-qrm-thumbs .wa-qr-thumb-x');
  await p.click('#wa-qrm-save');
  await p.waitForTimeout(400);
  const qr2 = await p.evaluate(() => window.__QR.find(q => q.id === 'q2'));
  ok(qr2 && qr2.media.length === 1 && qr2.media[0].path === P2 && qr2.title === 'تيربو', '12هـ) شيل صورة من رد موجود اتحفظ والباقي زي ما هو');

  // 13) الترتيب
  await p.click('#wa-qrm .wa-qrm-row[data-id="q1"] [data-mv="1"]');
  await p.waitForTimeout(400);
  ok(JSON.stringify((await rows()).slice(0, 3)) === '["q2","q1","q3"]', '13أ) ▼ نزّل الرد في القايمة');
  ok(JSON.stringify((await chips(p)).map(c => c.id).slice(0, 3)) === '["q2","q1","q3"]', '13ب) 🔴 والزراير تحت اترتبت زيها');
  const sorts = await p.evaluate(() => Object.fromEntries(window.__QR.map(q => [q.id, q.sort])));
  ok(sorts.q2 === 0 && sorts.q1 === 1 && sorts.q3 === 2, `13ج) 🔴 الترتيب اتكتب في sort: ${JSON.stringify(sorts)}`);

  // 14) الحذف بتأكيد
  await p.click('#wa-qrm .wa-qrm-row[data-id="q3"] [data-del]');
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('cmodal-backdrop')).display !== 'none'), '14أ) الحذف بيطلب تأكيد');
  await p.click('#cmodal-cancel');
  await p.waitForTimeout(200);
  ok((await qrCalls(p, 'c => c.deleted')).length === 0, '14ب) «إلغاء» مابيحذفش');
  await p.click('#wa-qrm .wa-qrm-row[data-id="q3"] [data-del]');
  await p.waitForTimeout(200);
  await p.click('#cmodal-ok');
  await p.waitForTimeout(400);
  ok((await qrCalls(p, 'c => c.deleted && c.eqId === "q3"')).length === 1 && !(await chips(p)).some(c => c.id === 'q3'),
     '14ج) «احذف» حذف الرد والزرار اختفى');
  await p.close();
}

// ════ 15: موبايل ════
{
  console.log('──── موبايل ────');
  const p = await openInbox({ mobile: true, conv: false });
  ok(await p.evaluate(() => { const x = document.getElementById('wa-qrm-open'); return !x || getComputedStyle(x).display === 'none'; }),
     '15أ) زرار الشريط مخفي على الموبايل (كان هيعمل صف تالت)');
  await p.click('.wa-conv[data-id="c1"]');
  await p.waitForTimeout(400);
  await p.click('#wa-qr-manage');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.getElementById('wa-qrm').classList.contains('open')), '15ب) «⚙️ إدارة الردود» فتح نفس النافذة');
  await p.close();
}

// ════ 16 — حارس `bad_media_path` على الكود المنشور ════
{
  console.log('──── حارس مسار الميديا (wa-send) ────');
  const src = fs.readFileSync(new URL('../supabase/functions/wa-send/index.ts', import.meta.url), 'utf8');
  ok(/const mediaPath = imagePath \|\| documentPath;[\s\S]*?\n    \}\n/.test(src), '16أ) الحارس موجود في المصدر');
  const guard = (mediaPath, tenantId) => {
    if (!mediaPath) return true;
    const prefix = `${tenantId}/`;
    if (typeof mediaPath !== 'string' || !mediaPath.startsWith(prefix) || mediaPath.includes('..')) return false;
    return true;
  };
  const T = '9c58b214-f11d-4de5-afc7-a0de0b903f36', OTHER = '46ca1812-cc56-439f-8787-88dda983cf76';
  ok(guard(T + '/quick-replies/a1.jpg', T), '16ب) صورة الرد المحفوظ بتعدّي');
  ok(!guard(OTHER + '/c9/out-1.jpg', T), '16ج) 🔴 مسار متجر تاني بيترفض');
  ok(!guard('../' + OTHER + '/x.jpg', T) && !guard(T + 'x/evil.jpg', T), '16د) 🔴 و«..» والبادئة الشبه مطابقة بيترفضوا');
}

// ════ 17 — نص فوق 1024 ════
{
  const LONG = 'ن'.repeat(1100);
  const p = await openInbox({ qr: [{ id: 'q2', tenant_id: TENANT, title: 'طويل', body: LONG, sort: 0,
    media: [{ path: P1, mime: 'image/jpeg', name: 'a1.jpg' }, { path: P2, mime: 'image/jpeg', name: 'a2.jpg' }] }] });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(900);
  const s = await sentList(p);
  ok(s.length === 3 && !s.some(m => m.cap) && s[2].text && s[2].text.length > 1024,
     `17) نص فوق 1024 حرف رجع رسالة مستقلة (${s.length} رسايل) — ميتا مابترفضوش`);
  await p.close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');
{ // (أ) شيل القفل → 5
  const p = await openInbox({ fnDelayMs: 150, patch: [['if(!item || !sb || !waActiveId || waQrSending) return;', 'if(!item || !sb || !waActiveId) return;']] });
  await p.evaluate(() => { const b = document.querySelector('.wa-qr[data-qid="q2"]'); b.disabled = false; b.click(); b.disabled = false; b.click(); });
  await p.waitForTimeout(1000);
  const n = (await sentList(p)).length;
  ok(n === 4, `معايرة أ: من غير القفل ضغطتين = ${n} رسايل — فحص 5 بيمسكها`);
  await p.close();
}
{ // (ب) الصور بالتوازي → 3ب
  const p = await openInbox({ fnDelayMs: 120, patch: [[
    '    sb.functions.invoke(\'wa-send\',{body:payload}).then(function(res){\n      var d=(res&&res.data)?res.data:null;\n      if(!d||!d.ok){ fail(d&&d.error?d.error:\'\'); return; }\n      sent++; i++; next();\n    }).catch(function(){ fail(\'\'); });',
    '    var all=[];\n    for(var z=0;z<med.length;z++){ (function(zz){ all.push(new Promise(function(rs){ setTimeout(function(){ rs(sb.functions.invoke(\'wa-send\',{body:{conversation_id:convAtSend,image_path:med[zz].path}})); }, zz===0?60:0); })); })(z); }\n    Promise.all(all).then(function(){ sent=med.length; i=med.length; next(); });']] });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(1200);
  const order = (await sentList(p)).map(s => s.img).filter(Boolean);
  ok(order.length === 2 && order[0] === P2, `معايرة ب: بالتوازي الترتيب اتقلب — فحص 3ب بيمسكها`);
  await p.close();
}
{ // (ج) الوقف عند تبديل المحادثة (السلوك القديم) → 6
  const p = await openInbox({ fnDelayMs: 150, patch: [['  function next(){\n    if(i>=med.length){\n      // الكلام راكب آخر صورة خلاص',
    '  function next(){\n    if(waActiveId!==convAtSend){ finish(); return; }\n    if(i>=med.length){\n      // الكلام راكب آخر صورة خلاص']] });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(40);
  await p.click('.wa-conv[data-id="c2"]');
  await p.waitForTimeout(1000);
  const n = (await sentList(p)).length;
  ok(n < 2, `معايرة ج: بالوقف عند التبديل اتبعت ${n} من 2 — نص رد عند العميل، فحص 6 بيمسكها`);
  await p.close();
}
{ // (د) شيل بادئة المتجر → 11ج
  const p = await openInbox({ patch: [["var path=currentTenantId+'/quick-replies/'+Date.now()+'-'+i+'.'+ext;", "var path='quick-replies/'+Date.now()+'-'+i+'.'+ext;"]] });
  await p.click('#wa-qrm-open'); await p.waitForTimeout(200);
  await p.click('#wa-qrm-new');
  await p.fill('#wa-qrm-name', 'ن');
  await p.setInputFiles('#wa-qrm-file', { name: 'x.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForTimeout(150);
  await p.click('#wa-qrm-save');
  await p.waitForTimeout(600);
  const ups = await p.evaluate(() => window.__UPLOADS || []);
  ok(ups[0] && ups[0].indexOf(TENANT + '/') !== 0, `معايرة د: من غير البادئة المسار «${ups[0]}» — فحص 11ج بيمسكها`);
  await p.close();
}
{ // (هـ) الكلام رسالة مستقلة → 3ج/3د
  const p = await openInbox({ patch: [['  var asCaption = !!(text && med.length && text.length<=WA_CAPTION_MAX);', '  var asCaption = false;']] });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(900);
  const s = await sentList(p);
  ok(s.length === 3 && s.some(m => m.text && !m.img), `معايرة هـ: بالشكل القديم ${s.length} رسايل والكلام لوحده — فحص 3ج بيمسكها`);
  await p.close();
}
{ // (و) شيل إخفاء الزراير مع النافذة → 7
  const p = await openInbox({ conv: 'c3', patch: [["var qp=$id('wa-qr-panel'); if(qp) qp.style.display=open?'':'none';", '']] });
  ok(await panelShown(p), 'معايرة و: من غير الإخفاء الزراير ظاهرة والنافذة مقفولة — فحص 7 بيمسكها');
  await p.close();
}
{ // (ز) الترتيب مايتكتبش → 13ج
  const p = await openInbox({ patch: [["writes.push(sb.from('wa_quick_replies').update({sort:n})", "void(sb.from('wa_quick_replies').update({sort:n})"]] });
  await p.click('#wa-qrm-open'); await p.waitForTimeout(200);
  await p.click('#wa-qrm .wa-qrm-row[data-id="q1"] [data-mv="1"]');
  await p.waitForTimeout(400);
  const sorts = await p.evaluate(() => Object.fromEntries(window.__QR.map(q => [q.id, q.sort])));
  ok(!(sorts.q2 === 0 && sorts.q1 === 1), `معايرة ز: من غير الكتابة sort فضل ${JSON.stringify(sorts)} — فحص 13ج بيمسكها`);
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
