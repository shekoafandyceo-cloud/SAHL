// بحث المحادثات بيلاقي الشات القديم (بلاغ المالك 24 سبتمبر:
// «لما بنبحث عن أي رقم عدّى عليه وقت حتى لو بسيط مش بيظهر خالص»).
//
// 🔴 السبب مقيس: `waFetchConvos` بتجيب **أحدث 200** بس و`waConvMatches`
// كانت بتفلتر المحمّل في الذاكرة — والمحادثة رقم 200 عند 3ataba عمرها يومين.
// الإصلاح: استعلام سيرفر بالشرط (نفس شكل فلتر الإعلانات والتصنيفات) والنتيجة
// في `waSearchExtra` منفصلة.
//
// ⚠️ الستب بقى **بيطبّق** `.or('col.ilike.*x*')` زي PostgREST — قبل كده كان
// بيخزّنه ويطنّشه، فأي فحص هنا كان هيرجّع كل المحادثات ويعدّي أعمى (درس 33).
//
// اللي بيتفحص:
//  1) رقم محلي كامل (01…) بيلاقي محادثة **بره أحدث 200**
//  2) نفس الرقم بصيغة 20… · 3) بأرقام عربي · 4) جزء من الرقم
//  5) 🔴 «احمد» بتلاقي «أحمد» و«فاطمه» بتلاقي «فاطمة» (همزة وتاء مربوطة)
//  6) اسم فيه فاصلة ماكسرش الاستعلام وبيتلاقي
//  7) الاستعلام خرج فعلاً للسيرفر بشرط `wa_id.ilike` — سيرفر مش ذاكرة
//  8) الضغط على النتيجة القديمة بيفتحها والاسم في الهيدر
//  9) 🔴 بعد مسح البحث المحادثة المفتوحة لسه ليها صف في `waConvById`
//     (من غيره التصنيف والملاحظة و«إنشاء طلب» بيرجعوا في صمت)
// 10) 🔴 قبل ما السيرفر يرد: «بيدوّر…» مش «مفيش نتائج»
// 11) ملاحظة السقف مابتقولش «الأقدم مش بيظهر» وقت البحث
// 12) 🔴 رد متأخر لكلمة قديمة مايكتبش فوق النتيجة الحالية
// 13) رقم أقل من 3 أرقام («5») مايطابقش كل المحادثات
// المعايرات (كل واحدة لازم توقع فحص):
//  (أ) شيل الاستعلام من السيرفر      → 1 يقع
//  (ب) شيل `waSearchExtra` من `waConvById` → 8 يقع
//  (ج) شيل تطبيع الهمزة               → 5 يقع
//  (د) شيل حارس الكلمة القديمة        → 12 يقع
//  (هـ) شيل الاحتفاظ بالمحادثة المفتوحة → 9 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const INBOX_SRC = fs.readFileSync(new URL('../app/js/inbox/inbox.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

const TENANT = 't-test-1';
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();

// شكل الداتا الحية بالظبط: wa_id = 20 + 10 أرقام · customer_phone = 0 + 10 أرقام
const conv = (i, core, name) => ({
  id: 'c' + i, tenant_id: TENANT, wa_id: '20' + core, customer_phone: '0' + core,
  customer_name: name || 'عميل',   // من غير أرقام — عشان فحص 13 يقيس الرقم مش الاسم last_message_at: iso(i * 30 + 1), last_inbound_at: iso(i * 30 + 1),
  last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
  labels: [], note: null, ctwa_clid: null, ctwa_ad_id: null, ctwa_headline: null, ctwa_source_type: null,
  ctwa_ad_body: null, ctwa_source_url: null, ctwa_first_at: null, ctwa_last_at: null
});
const CONVOS = [];
for (let i = 0; i < 260; i++) CONVOS.push(conv(i, '10' + String(i).padStart(8, '0')));
// 🔴 كلهم **بره** أحدث 200
CONVOS[240] = conv(240, '1551234614', 'سارة القديمة');
CONVOS[245] = conv(245, '1099887766', 'أحمد سالم');
CONVOS[250] = conv(250, '1277001122', 'فاطمة محمود');
CONVOS[255] = conv(255, '1144556677', 'محمد, علي');

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS = [];
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  if (opts.patch) {
    const out = opts.patch(INBOX_SRC);
    if (out === INBOX_SRC) throw new Error('المعايرة مالقتش المرساة');
    await ctx.route('**/js/inbox/inbox.js', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 10000 });
  await p.waitForTimeout(300);
  return p;
}

const listIds = (p) => p.evaluate(() =>
  Array.from(document.querySelectorAll('#wa-list-body .wa-conv')).map(e => e.getAttribute('data-id')));
async function search(p, q, wait) {
  await p.fill('#wa-search', q);
  await p.waitForTimeout(wait === undefined ? 700 : wait);
}

// ════ المسار الأساسي ════
{
  const p = await openInbox();
  ok((await listIds(p)).length === 200, 'ضابط: القايمة العادية عند سقف الـ200 — c240 بره');
  ok((await listIds(p)).indexOf('c240') < 0, 'ضابط: c240 مش معروضة قبل البحث');

  console.log('──── البحث بالرقم ────');
  await search(p, '01551234614');
  ok((await listIds(p)).indexOf('c240') >= 0, '1) 🔴 الرقم المحلي كامل لقى محادثة بره أحدث 200');
  await search(p, '201551234614');
  ok((await listIds(p)).indexOf('c240') >= 0, '2) نفس الرقم بصيغة 20…');
  await search(p, '٠١٥٥١٢٣٤٦١٤');
  ok((await listIds(p)).indexOf('c240') >= 0, '3) نفس الرقم بأرقام عربي');
  await search(p, '1234614');
  ok((await listIds(p)).indexOf('c240') >= 0, '4) جزء من الرقم');

  console.log('──── البحث بالاسم ────');
  await search(p, 'احمد');
  ok((await listIds(p)).indexOf('c245') >= 0, '5أ) 🔴 «احمد» لقت «أحمد سالم»');
  await search(p, 'فاطمه');
  ok((await listIds(p)).indexOf('c250') >= 0, '5ب) «فاطمه» لقت «فاطمة محمود»');
  await search(p, 'محمد, علي');
  ok((await listIds(p)).indexOf('c255') >= 0, '6) اسم فيه فاصلة ماكسرش `.or()` واتلاقى');

  const sent = await p.evaluate(() => (window.__calls || []).filter(c => c.table === 'wa_conversations' && String(c.or || '').indexOf('wa_id.ilike') >= 0).length);
  ok(sent >= 1, `7) الاستعلام خرج للسيرفر بشرط wa_id.ilike (${sent} مرة)`);

  console.log('──── الفتح والمسح ────');
  await search(p, '01551234614');
  await p.click('.wa-conv[data-id="c240"]');
  await p.waitForTimeout(400);
  const head = await p.evaluate(() => (document.querySelector('.wa-chat-id') || {}).textContent || '');
  ok(head.indexOf('سارة القديمة') >= 0, `8) النتيجة القديمة اتفتحت والاسم في الهيدر («${head.trim().slice(0, 30)}»)`);
  // بحث تاني بيستبدل waSearchExtra كلها (c240 مش في نتيجته) وبعدين مسح
  await search(p, 'فاطمه');
  await search(p, '');
  const still = await p.evaluate(async () => { const m = await import('./js/inbox/inbox.js'); return !!m.waConvById('c240'); });
  ok(still, '9) 🔴 بعد بحث تاني ومسح، المحادثة المفتوحة لسه ليها صف في waConvById');

  console.log('──── حالات الانتظار ────');
  await search(p, '01277001122', 40);   // أقل من مهلة الـ300ms
  const pending = await p.evaluate(() => document.getElementById('wa-list-body').textContent);
  ok(pending.indexOf('بيدوّر') >= 0 && pending.indexOf('مفيش نتائج') < 0, '10) 🔴 قبل رد السيرفر «بيدوّر…» مش «مفيش نتائج»');
  await p.waitForTimeout(700);
  ok((await listIds(p)).indexOf('c250') >= 0, '10ب) وبعد الرد النتيجة ظهرت');
  const cap = await p.evaluate(() => { const el = document.querySelector('#wa-list-body .wa-cap-note'); return el ? el.textContent : ''; });
  ok(cap.indexOf('مش بيظهر') < 0, `11) ملاحظة السقف مابتكدبش وقت البحث (${cap ? '«' + cap + '»' : 'مفيش'})`);

  // 12) رد متأخر لكلمة قديمة: البحث الحالي «01277001122»، ورد «عميل» يوصل بعده
  await p.evaluate(async () => { const m = await import('./js/inbox/inbox.js'); m.waFetchSearchConvos('عميل'); });
  await p.waitForTimeout(300);
  const after = await listIds(p);
  ok(after.length === 1 && after[0] === 'c250', `12) 🔴 رد كلمة قديمة ماكتبش فوق النتيجة (${after.length} صف)`);

  await search(p, '5');
  const n5 = (await listIds(p)).length;
  ok(n5 < 50, `13) رقم واحد «5» مابيطابقش كل الأرقام (${n5} صف)`);
  await p.close();
}

// ════ المعايرات ════
console.log('──── المعايرات ────');
{
  const p = await openInbox({ patch: s => s.replace("  var orq=waSearchOr(q);\n  if(!orq){ waSearchPending=false; return; }", "  var orq=''; waSearchPending=false; return;") });
  await search(p, '01551234614');
  ok((await listIds(p)).indexOf('c240') < 0, '(أ) من غير استعلام السيرفر c240 مابتظهرش — فحص 1 بيمسكها');
  await p.close();
}
{
  const p = await openInbox({ patch: s => s.replace("  for(var n=0;n<waSearchExtra.length;n++){ if(waSearchExtra[n].id===id) return waSearchExtra[n]; }\n", '') });
  await search(p, '01551234614');
  await p.click('.wa-conv[data-id="c240"]');
  await p.waitForTimeout(400);
  const head = await p.evaluate(() => (document.querySelector('.wa-chat-id') || {}).textContent || '');
  ok(head.indexOf('سارة القديمة') < 0, '(ب) من غير waSearchExtra في waConvById الهيدر غلط — فحص 8 بيمسكها');
  await p.close();
}
{
  const p = await openInbox({ patch: s => s.replace(".replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي');", ';') });
  await search(p, 'احمد');
  ok((await listIds(p)).indexOf('c245') < 0, '(ج) من غير تطبيع الهمزة «احمد» مابتلاقيش «أحمد» — فحص 5 بيمسكها');
  await p.close();
}
{
  const p = await openInbox({ patch: s => s.replace("if(myGen!==waSearchGen || q!==waSearchQuery) return;", 'if(false) return;') });
  await search(p, '01277001122');
  await p.evaluate(async () => { const m = await import('./js/inbox/inbox.js'); m.waFetchSearchConvos('عميل'); });
  await p.waitForTimeout(300);
  const ids = await listIds(p);
  // من غير الحارس نتيجة «عميل» بتتكتب ومتتفلترش بالكلمة الحالية… بس
  // waConvMatches بتفلترها — فالعلامة الحقيقية إن waSearchedFor اتغيّرت
  ok(!(ids.length === 1 && ids[0] === 'c250'), `(د) من غير الحارس الرد القديم كتب فوق النتيجة (${ids.length} صف) — فحص 12 بيمسكها`);
  await p.close();
}

{
  // (هـ) شيل الاحتفاظ بالمحادثة المفتوحة لما البحث يتبدّل
  const p = await openInbox({ patch: s => s.replace("  if(act && !rows.some(function(x){ return x.id===act.id; })) rows.push(act);\n", '') });
  await search(p, '01551234614');
  await p.click('.wa-conv[data-id="c240"]');
  await p.waitForTimeout(400);
  await search(p, 'فاطمه');
  await search(p, '');
  const still = await p.evaluate(async () => { const m = await import('./js/inbox/inbox.js'); return !!m.waConvById('c240'); });
  ok(!still, '(هـ) من غير الاحتفاظ بالمفتوحة c240 بتضيع من waConvById — فحص 9 بيمسكها');
  await p.close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✅ كله تمام');
process.exit(bad ? 1 : 0);
