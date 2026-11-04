// v83 — الصور التقيلة بتتصغّر قبل الرفع + «⚠️ صور تقيلة» و«🗜️ صغّرها» في الردود المحفوظة (4 نوفمبر)
//
// السبب: رد محفوظ واحد («مطبببببببببببببخ 2») صوره 5.2 MB واتبعت ~40 مرة في اليوم — ميتا بتنزّل
// الصورة مع كل إرسال والموظفين مع كل فتح للشات، والـEgress رجع لـ250–400 MB/يوم والحد ~75.
//
// اللي بيتفحص:
//   C1) JPEG تقيل (> 400 KB) في الشات بيترفع JPEG أطول ضلعه ≤ 1600 وأصغر من الأصل
//   C2) صورة 5–25 ميجا بقت بتتقبل (كانت بتترفض) وبتترفع ≤ 5 ميجا JPEG
//   C3) ضابط: الصورة الخفيفة بتعدّي زي ما هي بالبايت
//   Q1) قايمة الإدارة: «⚠️ صور تقيلة (2.1 MB)» على الرد التقيل بس · الحجم من قايمة الـStorage
//   Q2) الفورم: الصورة التقيلة عليها ⚠️ وحجمها · الخفيفة لأ · شريط «🗜️ صغّرها (1)»
//   Q3) «صغّرها» = في المتصفح بس — مفيش رفع ولا كتابة لحد «احفظ»
//   Q4) «احفظ» = الصورة المصغّرة اترفعت **في مكانها** (الأولى) والخفيفة زي ما هي · الحجم في media[].size
//   Q5) «رجوع» بعد «صغّرها» = ولا رفع ولا كتابة
// المعايرات (بحارس «المرساة اتلقت» — درس 47 · الشرط بيقيس إن الفحص **هيقع** — درس 56):
//   (أ) الصورة التقيلة بتعدّي زي ما هي → C1 · (ب) المصغّرة بتترفع في الآخر → Q4 ·
//   (ج) مفتاح الحجم من غير الفولدر → Q1 · (د) حد الاختيار 5 ميجا → C2
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
const DIR = TENANT + '/quick-replies';
const H1 = DIR + '/h1.png', L1 = DIR + '/l1.jpg', OK1 = DIR + '/ok.jpg';
const QR = [
  { id: 'qok', tenant_id: TENANT, title: 'مطبخ', body: 'منظم', sort: 0, media: [{ path: OK1, mime: 'image/jpeg', name: 'ok.jpg' }] },
  { id: 'qh', tenant_id: TENANT, title: 'مطبخ 2', body: 'المنظم الكبير', sort: 1,
    media: [{ path: H1, mime: 'image/png', name: 'h1.png' }, { path: L1, mime: 'image/jpeg', name: 'l1.jpg' }] }
];
const LIST = { [DIR]: [
  { name: 'h1.png', metadata: { size: 2218945 } }, { name: 'l1.jpg', metadata: { size: 120000 } }, { name: 'ok.jpg', metadata: { size: 90000 } }
] };
const CONVOS = [{
  id: 'c1', tenant_id: TENANT, wa_id: '201000000001', customer_name: 'ضوء القمر', customer_phone: '201000000001',
  last_message_at: iso(1), last_inbound_at: iso(5), last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0,
  status: 'open', labels: [], note: null, ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null,
  ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null
}];
const MSGS = [{ id: 'm1', tenant_id: TENANT, conversation_id: 'c1', direction: 'in', type: 'text', body: 'أهلاً',
  is_read: true, created_at: iso(5), wa_timestamp: iso(5), status: null, wa_message_id: 'wamid-1' }];

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

// صور حقيقية من Chromium: «ضوضاء» عشان الحجم يبقى تقيل فعلاً (صور المنتجات الحقيقية كده)
async function genImg(mime, w, h, q) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const out = await p.evaluate(async ([m, W, H, Q]) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const id = x.createImageData(W, H);
    let s = 12345;
    for (let i = 0; i < id.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      id.data[i] = s & 255; id.data[i + 1] = (s >> 8) & 255; id.data[i + 2] = (s >> 16) & 255; id.data[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, m, Q));
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    return { type: blob.type, b64 };
  }, [mime, w, h, q]);
  await ctx.close();
  return { type: out.type, buf: Buffer.from(out.b64, 'base64') };
}
const BIGJPG = await genImg('image/jpeg', 2400, 1800, 0.95);
const HUGEPNG = await genImg('image/png', 1600, 1400, 1);
const HEAVYPNG = await genImg('image/png', 2000, 1000, 1);
const SMALLJPG = await genImg('image/jpeg', 60, 60, 0.9);
const LIGHTJPG = await genImg('image/jpeg', 300, 200, 0.8);

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    window.__QR        = ${JSON.stringify(QR)};
    window.__STORAGE_LIST = ${JSON.stringify(LIST)};
    window.__MEDIA     = { ${JSON.stringify(H1)}: ${JSON.stringify(ORIGIN + '/__img/h1.png')}, ${JSON.stringify(L1)}: ${JSON.stringify(ORIGIN + '/__img/l1.jpg')}, ${JSON.stringify(OK1)}: ${JSON.stringify(ORIGIN + '/__img/l1.jpg')} };
    window.__UPLOAD_OK = true;
    window.__SENT = [];
    window.__FN = function(slug, body){ window.__SENT.push({ slug: slug, body: body }); return { ok:true, message_id:'w'+window.__SENT.length }; };
    window.__RPC_HOOK = function(name){ if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null }; return null; };
  `);
  await ctx.addInitScript(STUB);
  await ctx.route('**/__img/h1.png', r => r.fulfill({ status: 200, contentType: 'image/png', body: HEAVYPNG.buf }));
  await ctx.route('**/__img/l1.jpg', r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: LIGHTJPG.buf }));
  if (opts.patch) await ctx.route('**/js/inbox/inbox.js', patchInbox(opts.patch));
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.click('.wa-conv[data-id="c1"]');
  await p.waitForTimeout(400);
  return p;
}
const lastUpload = p => p.evaluate(async () => {
  const u = (window.__UPLOAD_FILES || []).slice(-1)[0];
  if (!u) return null;
  const buf = new Uint8Array(await u.file.arrayBuffer());
  let w = 0, h = 0;
  try { const bm = await createImageBitmap(u.file); w = bm.width; h = bm.height; } catch (e) {}
  return { path: u.path, type: u.file.type, size: buf.length, head: Array.from(buf.slice(0, 3)), w, h, n: window.__UPLOAD_FILES.length };
});
const nUploads = p => p.evaluate(() => (window.__UPLOAD_FILES || []).length);
const toastTxt = p => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
async function attachAndSend(p, img, name, waitMs) {
  await p.setInputFiles('#wa-file', { name: name, mimeType: img.type, buffer: img.buf });
  await p.fill('#wa-input', 'دي الصورة');
  await p.click('#wa-send-btn');
  await p.waitForTimeout(waitMs || 2500);
}
const qrWrites = p => p.evaluate(() => (window.__calls || []).filter(c => c.table === 'wa_quick_replies' && c.payload && !('sort' in c.payload && Object.keys(c.payload).length === 1)));
async function openEditHeavy(p) {
  await p.click('#wa-qrm-open'); await p.waitForTimeout(400);
  await p.click('.wa-qrm-row[data-id="qh"] [data-ed="1"]'); await p.waitForTimeout(500);
}

// ════ C: مرفق الشات ════
console.log('──── مرفق الشات ────');
async function C1(p) {
  await attachAndSend(p, BIGJPG, 'big.jpg');
  return lastUpload(p);
}
{
  const p = await openInbox();
  ok(BIGJPG.buf.length > 400 * 1024, `ضابط: الـJPEG التقيل فعلاً ${(BIGJPG.buf.length / 1024 / 1024).toFixed(1)} MB`);
  const u = await C1(p);
  ok(u && u.head[0] === 0xFF && u.head[1] === 0xD8 && Math.max(u.w, u.h) <= 1600 && u.size < BIGJPG.buf.length,
    `C1) JPEG التقيل اتصغّر: ${u && u.w}×${u && u.h} · ${u && (u.size / 1024).toFixed(0)} KB (الأصل ${(BIGJPG.buf.length / 1024).toFixed(0)} KB)`);
  ok(HUGEPNG.buf.length > 5 * 1024 * 1024, `ضابط: الـPNG فوق 5 ميجا فعلاً (${(HUGEPNG.buf.length / 1024 / 1024).toFixed(1)} MB)`);
  const n0 = await nUploads(p);
  await attachAndSend(p, HUGEPNG, 'huge.png', 4000);
  const u2 = await lastUpload(p);
  ok(u2 && u2.n === n0 + 1 && /\.jpg$/.test(u2.path) && u2.size <= 5 * 1024 * 1024 && !/الحد/.test(await toastTxt(p)),
    `C2) صورة ${(HUGEPNG.buf.length / 1024 / 1024).toFixed(1)} ميجا اتقبلت واترفعت JPEG ${u2 && (u2.size / 1024).toFixed(0)} KB`);
  await attachAndSend(p, SMALLJPG, 'small.jpg', 1200);
  const u3 = await lastUpload(p);
  ok(u3 && u3.size === SMALLJPG.buf.length, `C3) ضابط: الصورة الخفيفة عدّت زي ما هي (${u3 && u3.size} = ${SMALLJPG.buf.length} بايت)`);
  await p.context().close();
}

// ════ Q: الردود المحفوظة ════
console.log('──── الردود المحفوظة ────');
async function Q1(p) {
  await p.click('#wa-qrm-open'); await p.waitForTimeout(500);
  return p.evaluate(() => ({
    h: ((document.querySelector('.wa-qrm-row[data-id="qh"] .wa-qrm-heavy') || {}).textContent || ''),
    ok: !!document.querySelector('.wa-qrm-row[data-id="qok"] .wa-qrm-heavy'),
    lists: window.__LIST_CALLS || 0
  }));
}
async function Q4(p) {
  await openEditHeavy(p);
  await p.click('#wa-qrm-shrink'); await p.waitForTimeout(2500);
  const up0 = await nUploads(p);
  await p.click('#wa-qrm-save'); await p.waitForTimeout(2500);
  const pay = await p.evaluate(() => {
    const c = (window.__calls || []).filter(x => x.table === 'wa_quick_replies' && x.payload && x.payload.media).slice(-1)[0];
    return c && c.payload;
  });
  return { pay, up: await lastUpload(p), up0 };
}
{
  const p = await openInbox();
  const r1 = await Q1(p);
  ok(/صور تقيلة \(2\.1 MB\)/.test(r1.h) && !r1.ok && r1.lists >= 1, `Q1) «${r1.h.trim()}» على الرد التقيل بس · قايمة الـStorage اتقرت ${r1.lists}`);
  await p.click('.wa-qrm-row[data-id="qh"] [data-ed="1"]'); await p.waitForTimeout(600);
  const r2 = await p.evaluate(() => {
    const th = Array.from(document.querySelectorAll('#wa-qrm-thumbs .wa-qr-thumb'));
    return { n: th.length, h0: th[0] && th[0].classList.contains('wa-qr-thumb-heavy'), h1: th[1] && th[1].classList.contains('wa-qr-thumb-heavy'),
      s0: th[0] && (th[0].querySelector('.wa-qr-thumb-size') || {}).textContent, btn: (document.getElementById('wa-qrm-shrink') || {}).textContent || '' };
  });
  ok(r2.n === 2 && r2.h0 && !r2.h1 && /2\.1 MB/.test(r2.s0 || '') && /صغّرها \(1\)/.test(r2.btn),
    `Q2) الأولى ⚠️ «${r2.s0}» والتانية لأ · «${r2.btn}»`);
  const up0 = await nUploads(p);
  await p.click('#wa-qrm-shrink'); await p.waitForTimeout(2500);
  const r3 = await p.evaluate(() => ({ shr: !!document.querySelector('#wa-qrm-thumbs .wa-qr-thumb:first-child.wa-qr-thumb-shrunk'),
    bar: !!document.getElementById('wa-qrm-shrink') }));
  const w3 = await qrWrites(p);
  ok(r3.shr && !r3.bar && (await nUploads(p)) === up0 && w3.length === 0 && /اتصغّرت/.test(await toastTxt(p)),
    `Q3) اتصغّرت في المتصفح بس (رفع ${(await nUploads(p)) - up0} · كتابة ${w3.length}) — «${await toastTxt(p)}»`);
  const shrunk = await p.evaluate(() => { const t = document.querySelector('#wa-qrm-thumbs .wa-qr-thumb:first-child .wa-qr-thumb-size'); return t ? t.textContent : ''; });
  await p.click('#wa-qrm-save'); await p.waitForTimeout(2500);
  const u = await lastUpload(p);
  ok(u && shrunk.indexOf(Math.max(1, Math.round(u.size / 1024)) + ' KB') >= 0, `Q4أ) المصغّرة اترفعت زي ما هي من غير ضغط تاني (${shrunk} = ${u && Math.round(u.size / 1024)} KB)`);
  const pay = await p.evaluate(() => {
    const c = (window.__calls || []).filter(x => x.table === 'wa_quick_replies' && x.payload && x.payload.media).slice(-1)[0];
    return c && c.payload;
  });
  const m = (pay && pay.media) || [];
  ok(!!(u && u.n === up0 + 1 && m.length === 2 && m[0].path === u.path && /\.jpg$/.test(m[0].path)
     && m[0].size === u.size && m[1].path === L1 && m[1].size === 120000 && Math.max(u.w, u.h) <= 1600),
    `Q4) المصغّرة اترفعت في مكانها (${m[0] && m[0].path} · ${u && (u.size / 1024).toFixed(0)} KB) والخفيفة زي ما هي (${m[1] && m[1].path})`);
  await p.context().close();
}
{
  const p = await openInbox();
  await openEditHeavy(p);
  const up0 = await nUploads(p);
  await p.click('#wa-qrm-shrink'); await p.waitForTimeout(2500);
  await p.click('#wa-qrm-cancel'); await p.waitForTimeout(400);
  ok((await nUploads(p)) === up0 && (await qrWrites(p)).length === 0, 'Q5) «رجوع» بعد «صغّرها» = ولا رفع ولا كتابة');
  await p.context().close();
}

// ════ المعايرات ════
console.log('──── المعايرات ────');
{
  const p = await openInbox({ patch: [['    if(same && same.size<=WA_IMG_LIGHT) return same;', '    if(same) return same;']] });
  const u = await C1(p);
  ok(!(u && Math.max(u.w, u.h) <= 1600 && u.size < BIGJPG.buf.length), `(أ) من غير التصغير: اترفع ${u && u.w}×${u && u.h} زي ما هو → C1 كان هيقع`);
  await p.context().close();
}
{
  const p = await openInbox({ patch: [["  var queue=waQrmKeep.map(function(k){ return {keep:k}; }).concat(",
    "  var queue=waQrmKeep.filter(function(k){ return !k.file; }).map(function(k){ return {keep:k}; }).concat(waQrmKeep.filter(function(k){ return k.file; }).map(function(k){ return {keep:k}; })).concat("]] });
  const r = await Q4(p);
  const m = (r.pay && r.pay.media) || [];
  ok(!(m[0] && r.up && m[0].path === r.up.path), `(ب) المصغّرة في الآخر: أول صورة بقت ${m[0] && m[0].path} → Q4 كان هيقع`);
  await p.context().close();
}
{
  const p = await openInbox({ patch: [["if(o && o.name && isFinite(z) && z>0) m[dir+'/'+o.name]=z;", "if(o && o.name && isFinite(z) && z>0) m[o.name]=z;"]] });
  const r = await Q1(p);
  ok(!/صور تقيلة/.test(r.h), `(ج) مفتاح الحجم من غير الفولدر: مفيش علامة «تقيلة» → Q1 كان هيقع`);
  await p.context().close();
}
{
  const p = await openInbox({ patch: [['var WA_IMG_PICK_MAX=25*1024*1024;', 'var WA_IMG_PICK_MAX=5*1024*1024;']] });
  const n0 = await nUploads(p);
  await attachAndSend(p, HUGEPNG, 'huge.png', 2500);
  ok((await nUploads(p)) === n0 && /الحد/.test(await toastTxt(p)), `(د) حد الاختيار 5 ميجا: اترفضت «${await toastTxt(p)}» → C2 كان هيقع`);
  await p.context().close();
}

await b.close();
console.log(bad ? `❌ ${bad} فحص وقع` : '✅ تمام');
process.exit(bad ? 1 : 0);
