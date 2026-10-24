// صيغة الصورة اللي بتتبعت لواتساب — JPEG/PNG بس (بلاغ المالك 2 أكتوبر)
//
// «آخر واحدة جيت ابعتلها رسالة مسجلة باسم "بيت مجات" موصلتش ليه»
// السبب مقيس: صورة الرد متخزّنة **webp**، وواتساب Cloud API بيقبل الصور
// JPEG/PNG بس. ميتا بترد 200 و`wamid` وبعدها الـwebhook يرجّع `failed` —
// الموظف شاف الرسالة اتبعتت والعميل عمره ما استلمها. على كل التاريخ:
// webp 17 من 17 وقعوا · jpg 1 من 498.
//
// اللي بيتفحص:
//   1) مرفق webp في الشات بيتحوّل JPEG **بالبايتات** (FF D8) والمسار .jpg
//   2) JPEG بيعدّي زي ما هو (نفس الحجم — مفيش إعادة ضغط)
//   3) PNG بيعدّي زي ما هو (.png · image/png)
//   4) الشفاف في webp بيبقى أبيض مش أسود
//   5) صورة المتصفح مايعرفش يفكّها = رسالة صريحة · مفيش رفع · مفيش إرسال
//   6) رد محفوظ صورته webp قديمة: الزرار عليه ⚠️ · الضغطة مابتبعتش · رسالة بالحل
//   7) نافذة الإدارة: ⚠️ في القايمة وعلى الصورة · الحفظ ممنوع لحد ما تتشال ·
//      شيلها وضيف webp تاني = بتترفع JPEG والحمولة image/jpeg
//   8) رد السيرفر `unsupported_image_type` (wa-send v9 — بـ200 عشان supabase-js مايخفيش الجسم)
//   9) 🔴 webp متسمّي .jpg بيتحوّل (الحكم من البايتات) · 10) PNG بـtype غلط بيعدّي زي ما هو
//  11) الصورة اللي تكبر بعد التحويل بتتصغّر بدل الرفض
// المعايرات (كل واحدة بحارس «المرساة اتلقت» — درس 47):
//   (أ) شيل التحويل → 1 · (ب) شيل حارس الرد المحفوظ → 6 · (ج) شيل الخلفية البيضا → 4 ·
//   (د) الحكم بالـtype مش البايتات → 9
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
const PJ = TENANT + '/quick-replies/ok.jpg';
const PW = TENANT + '/quick-replies/old.webp';
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const QR = [
  { id: 'qok', tenant_id: TENANT, title: 'مطبخ', body: 'منظم المطبخ', sort: 0, media: [{ path: PJ, mime: 'image/jpeg', name: 'ok.jpg' }] },
  { id: 'qbad', tenant_id: TENANT, title: 'بيت مجات', body: 'بيت المجات ايكيا', sort: 1, media: [{ path: PW, mime: 'image/webp', name: 'old.webp' }] }
];
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

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    window.__QR        = ${JSON.stringify(QR)};
    window.__MEDIA     = { ${JSON.stringify(PJ)}: ${JSON.stringify(PIX)}, ${JSON.stringify(PW)}: ${JSON.stringify(PIX)} };
    window.__UPLOAD_OK = true;
    window.__SENT = [];
    window.__FN = function(slug, body){
      window.__SENT.push({ slug: slug, body: body });
      ${opts.fnReply ? `return ${JSON.stringify(opts.fnReply)};` : `return { ok:true, message_id:'w'+window.__SENT.length };`}
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
  await p.click('.wa-conv[data-id="c1"]');
  await p.waitForTimeout(400);
  return p;
}

// صور حقيقية بيولّدها Chromium نفسه — webp فيه نص شفاف عشان فحص الخلفية
const makeImg = (p, mime, transparent) => p.evaluate(async ([m, tr]) => {
  const c = document.createElement('canvas'); c.width = 40; c.height = 40;
  const x = c.getContext('2d');
  x.fillStyle = '#c0392b'; x.fillRect(0, 0, 40, tr ? 20 : 40);   // النص التحت شفاف لو tr
  const blob = await new Promise(r => c.toBlob(r, m, 0.9));
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { type: blob.type, bytes: Array.from(buf) };
}, [mime, !!transparent]);

const lastUpload = p => p.evaluate(async () => {
  const u = (window.__UPLOAD_FILES || []).slice(-1)[0];
  if (!u) return null;
  const buf = new Uint8Array(await u.file.arrayBuffer());
  // البكسل في النص الشفاف (تحت) بعد فك الملف اللي اترفع فعلاً
  let px = null;
  try {
    const bm = await createImageBitmap(u.file);
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    px = Array.from(x.getImageData(Math.floor(bm.width / 2), bm.height - 5, 1, 1).data);
  } catch (e) {}
  return { path: u.path, contentType: u.contentType, type: u.file.type, name: u.file.name, size: buf.length,
           head: Array.from(buf.slice(0, 3)), px, n: window.__UPLOAD_FILES.length };
});
const sentImgs = p => p.evaluate(() => window.__SENT.filter(s => s.slug === 'wa-send').map(s => s.body.image_path || null));
const toastTxt = p => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');

async function attachAndSend(p, img, name) {
  await p.setInputFiles('#wa-file', { name: name, mimeType: img.type, buffer: Buffer.from(img.bytes) });
  await p.fill('#wa-input', 'دي الصورة');
  await p.click('#wa-send-btn');
  await p.waitForTimeout(900);
}

// ════ 1–5 · 8: مرفقات الشات ════
{
  const p = await openInbox();
  console.log('──── مرفق الشات ────');
  const webp = await makeImg(p, 'image/webp', true);
  ok(webp.type === 'image/webp', `ضابط: Chromium عمل webp فعلاً (${webp.type})`);
  await attachAndSend(p, webp, 'mugs.webp');
  const u = await lastUpload(p);
  ok(u && /\.jpg$/.test(u.path), `1أ) المسار اتحوّل .jpg: ${u && u.path}`);
  ok(u && u.contentType === 'image/jpeg' && u.type === 'image/jpeg', `1ب) contentType = image/jpeg: ${u && u.contentType}`);
  ok(u && u.head[0] === 0xFF && u.head[1] === 0xD8 && u.head[2] === 0xFF, `1ج) 🔴 البايتات JPEG فعلاً (FF D8 FF): ${u && u.head.map(x => x.toString(16)).join(' ')}`);
  ok(u && u.name === 'mugs.jpg', `1د) اسم الملف بقى mugs.jpg: ${u && u.name}`);
  const s1 = await sentImgs(p);
  ok(s1.length === 1 && s1[0] === (u && u.path), `1هـ) wa-send اتنده بنفس المسار المحوّل: ${s1[0]}`);
  ok(u && u.px && u.px[0] > 235 && u.px[1] > 235 && u.px[2] > 235, `4) الشفاف بقى أبيض مش أسود: rgb(${u && u.px && u.px.slice(0, 3)})`);

  const jpg = await makeImg(p, 'image/jpeg');
  await attachAndSend(p, jpg, 'a.jpg');
  const u2 = await lastUpload(p);
  ok(u2 && /\.jpg$/.test(u2.path) && u2.size === jpg.bytes.length, `2) JPEG عدّى زي ما هو (${u2 && u2.size} = ${jpg.bytes.length} بايت)`);

  const png = await makeImg(p, 'image/png');
  await attachAndSend(p, png, 'a.png');
  const u3 = await lastUpload(p);
  ok(u3 && /\.png$/.test(u3.path) && u3.contentType === 'image/png' && u3.size === png.bytes.length, `3) PNG عدّى زي ما هو: ${u3 && u3.path}`);

  const nUp = u3.n, nSent = (await sentImgs(p)).length;
  await attachAndSend(p, { type: 'image/webp', bytes: [1, 2, 3, 4, 5, 6, 7, 8] }, 'broken.webp');
  const t5 = await toastTxt(p);
  const u5 = await lastUpload(p);
  ok(u5.n === nUp && (await sentImgs(p)).length === nSent, `5أ) صورة مش متفكّة: مفيش رفع ولا إرسال (${u5.n}/${nUp})`);
  ok(/مش مدعومة في واتساب/.test(t5), `5ب) الرسالة صريحة: «${t5}»`);
  ok((await p.inputValue('#wa-input')) === 'دي الصورة', '5ج) الكلام رجع للخانة (مااتمسحش)');

  // 9) 🔴 webp متسمّي .jpg (المتصفح بيدّيه image/jpeg من الامتداد) — الحكم من البايتات
  const webp9 = await makeImg(p, 'image/webp', true);
  await attachAndSend(p, { type: 'image/jpeg', bytes: webp9.bytes }, 'product.jpg');
  const u9 = await lastUpload(p);
  ok(u9 && u9.head[0] === 0xFF && u9.head[1] === 0xD8 && u9.contentType === 'image/jpeg' && /\.jpg$/.test(u9.path),
    `9) 🔴 webp متسمّي .jpg اتحوّل JPEG بالبايتات (${u9 && u9.head.map(x => x.toString(16)).join(' ')})`);
  // 10) PNG بالبايتات وtype غلط = نفس البايتات بالـtype الصح (من غير إعادة ضغط)
  const png10 = await makeImg(p, 'image/png');
  await attachAndSend(p, { type: 'image/jpeg', bytes: png10.bytes }, 'shot.jpg');
  const u10 = await lastUpload(p);
  ok(u10 && /\.png$/.test(u10.path) && u10.contentType === 'image/png' && u10.size === png10.bytes.length,
    `10) PNG متسمّي .jpg اترفع PNG زي ما هو: ${u10 && u10.path} (${u10 && u10.size} بايت)`);
  await p.context().close();
}
// 11) صورة كبيرة بعد التحويل: بتتصغّر/تقل جودتها بدل الرفض. السقف بيتحط على 60% من
//     حجم أول محاولة (q 0.92 بالمقاس الكامل) — يعني أول محاولة **لازم** تفشل والحلقة تشتغل
const BIG = async (p) => p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 1200;
  const x = c.getContext('2d');
  for (let i = 0; i < 400; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,' + (30 + i % 50) + '%)'; x.fillRect((i * 97) % 1200, (i * 53) % 1200, 60 + i % 90, 40 + i % 70); }
  const w = await new Promise(r => c.toBlob(r, 'image/webp', 0.95));
  const j = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return { type: w.type, bytes: Array.from(new Uint8Array(await w.arrayBuffer())), jpegFull: j.size };
});
{
  const p0 = await openInbox();
  const big = await BIG(p0);
  await p0.context().close();
  const cap = Math.floor(big.jpegFull * 0.6);
  const p = await openInbox({ patch: [["var WA_IMG_MAX=5*1024*1024;", "var WA_IMG_MAX=" + cap + ";"]] });
  await attachAndSend(p, big, 'big.webp');
  await p.waitForTimeout(1500);
  const u = await lastUpload(p);
  ok(u && u.head[0] === 0xFF && u.size <= cap && (await sentImgs(p)).length === 1,
    `11) الصورة اللي كبرت بعد التحويل اتصغّرت واتبعتت (${u && u.size} ≤ ${cap} · أول محاولة كانت ${big.jpegFull})`);
  await p.context().close();
}
{
  const p = await openInbox({ fnReply: { ok: false, error: 'unsupported_image_type' } });
  const jpg = await makeImg(p, 'image/jpeg');
  await attachAndSend(p, jpg, 'a.jpg');
  const t = await toastTxt(p);
  ok(/JPG وPNG بس/.test(t), `8) رد السيرفر unsupported_image_type بيتقال بالعربي: «${t}»`);
  await p.context().close();
}

// ════ 6–7: الردود المحفوظة ════
{
  const p = await openInbox();
  console.log('──── الرد المحفوظ ────');
  const bad6 = await p.evaluate(() => {
    const e = document.querySelector('#wa-qr-panel .wa-qr[data-qid="qbad"]');
    const g = document.querySelector('#wa-qr-panel .wa-qr[data-qid="qok"]');
    return { bad: !!e && e.classList.contains('wa-qr-bad') && !!e.querySelector('.wa-qr-warn'),
             good: !!g && !g.classList.contains('wa-qr-bad'), tip: e && e.title };
  });
  ok(bad6.bad && bad6.good, `6أ) زرار «بيت مجات» عليه ⚠️ و«مطبخ» سليم`);
  await p.click('#wa-qr-panel .wa-qr[data-qid="qbad"]');
  await p.waitForTimeout(500);
  ok((await sentImgs(p)).length === 0, '6ب) 🔴 الضغطة مابعتتش حاجة (رد هيموت failed)');
  ok(/webp/.test(await toastTxt(p)) && /✏️/.test(await toastTxt(p)), `6ج) الرسالة بتقول السبب والحل: «${await toastTxt(p)}»`);
  await p.click('#wa-qr-panel .wa-qr[data-qid="qok"]');
  await p.waitForTimeout(500);
  ok((await sentImgs(p)).length === 1, '6د) ضابط: الرد السليم بيتبعت عادي');

  await p.click('#wa-qrm-open');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => /صورة webp/.test((document.querySelector('.wa-qrm-row[data-id="qbad"] .wa-qrm-bad') || {}).textContent || '')),
    '7أ) القايمة في نافذة الإدارة عليها «⚠️ صورة webp — عدّلها»');
  await p.click('.wa-qrm-row[data-id="qbad"] [data-ed="1"]');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => !!document.querySelector('#wa-qrm-thumbs .wa-qr-thumb-bad .wa-qr-thumb-warn')), '7ب) الصورة القديمة عليها ⚠️ في الفورم');
  const upBefore = await p.evaluate(() => (window.__UPLOAD_FILES || []).length);
  await p.click('#wa-qrm-save');
  await p.waitForTimeout(400);
  const wr1 = await p.evaluate(() => (window.__calls || []).filter(c => c.table === 'wa_quick_replies' && c.payload).length);
  ok(wr1 === 0 && /شيلها/.test(await toastTxt(p)), `7ج) الحفظ ممنوع والصورة القديمة موجودة: «${await toastTxt(p)}»`);
  await p.click('#wa-qrm-thumbs [data-keep="0"]');
  const webp = await makeImg(p, 'image/webp', true);
  await p.setInputFiles('#wa-qrm-file', { name: 'mugs.webp', mimeType: 'image/webp', buffer: Buffer.from(webp.bytes) });
  await p.waitForTimeout(200);
  await p.click('#wa-qrm-save');
  await p.waitForTimeout(900);
  const u7 = await lastUpload(p);
  ok(u7 && u7.n === upBefore + 1 && /\/quick-replies\/.*\.jpg$/.test(u7.path) && u7.head[0] === 0xFF && u7.head[1] === 0xD8,
    `7د) 🔴 الصورة الجديدة اترفعت JPEG بالبايتات: ${u7 && u7.path}`);
  const pay = await p.evaluate(() => {
    const c = (window.__calls || []).filter(x => x.table === 'wa_quick_replies' && x.payload && !x.inserted).slice(-1)[0];
    return c && c.payload;
  });
  const m0 = pay && pay.media && pay.media[0];
  ok(m0 && m0.mime === 'image/jpeg' && /\.jpg$/.test(m0.path) && pay.media.length === 1, `7هـ) حمولة الحفظ: صورة واحدة image/jpeg ${m0 && m0.path}`);
  ok(await p.evaluate(() => !document.querySelector('#wa-qr-panel .wa-qr.wa-qr-bad')), '7و) الـ⚠️ اختفت من الزرار بعد الحفظ');
  await p.context().close();
}

// ════ المعايرات ════
console.log('──── المعايرات ────');
{
  const p = await openInbox({ patch: [["  if(!f) return Promise.resolve(f);\n  return waSniffImage(f)", "  if(!f || /^image\\/(jpeg|png)$/i.test(f.type||'')) return Promise.resolve(f);\n  return waSniffImage(f)"]] });
  const webp = await makeImg(p, 'image/webp', true);
  await attachAndSend(p, { type: 'image/jpeg', bytes: webp.bytes }, 'product.jpg');
  const u = await lastUpload(p);
  ok(u && !(u.head[0] === 0xFF && u.head[1] === 0xD8), `(د) الحكم بالـtype بس (الشكل الأول): webp متسمّي .jpg اترفع webp (${u && u.head.map(x => x.toString(16)).join(' ')}) → فحص 9 كان هيقع`);
  await p.context().close();
}
{
  const p = await openInbox({ patch: [["    return waToJpeg(f);\n  });", "    return f;\n  });"]] });
  const webp = await makeImg(p, 'image/webp', true);
  await attachAndSend(p, webp, 'mugs.webp');
  const u = await lastUpload(p);
  ok(u && /\.webp$/.test(u.path), `(أ) من غير التحويل: اترفع webp زي ما كان قبل الإصلاح (${u && u.path}) → فحص 1 كان هيقع`);
  await p.context().close();
}
{
  const p = await openInbox({ patch: [["if(waQrBroken(item)){ toast(WA_QR_BROKEN_MSG,'er'); return; }", ""]] });
  await p.click('#wa-qr-panel .wa-qr[data-qid="qbad"]');
  await p.waitForTimeout(500);
  const s = await sentImgs(p);
  ok(s.length === 1 && /\.webp$/.test(s[0]), `(ب) من غير الحارس: الرد الـwebp اتبعت (${s[0]}) → فحص 6ب كان هيقع`);
  await p.context().close();
}
{
  const p = await openInbox({ patch: [["ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);", ""]] });
  const webp = await makeImg(p, 'image/webp', true);
  await attachAndSend(p, webp, 'mugs.webp');
  const u = await lastUpload(p);
  ok(u && u.px && u.px[0] < 40 && u.px[1] < 40, `(ج) من غير الخلفية البيضا: الشفاف طلع أسود rgb(${u && u.px && u.px.slice(0, 3)}) → فحص 4 كان هيقع`);
  await p.context().close();
}

await b.close();
console.log(bad ? `❌ ${bad} فحص وقع` : '✅ تمام');
process.exit(bad ? 1 : 0);
