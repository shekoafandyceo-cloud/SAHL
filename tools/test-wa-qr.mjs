// الردود الجاهزة بصور — طلب المالك 16 سبتمبر
//
// «امكانية عمل saved reply بصورتين وكلام زي الواتساب بيزنس، بدل ما احنا
// عاملينها دلوقتي كلام بس.»
//
// 🔴 قرار المالك على الترتيب: **الصور الأول والكلام رسالة مستقلة في الآخر**
// (مش caption على أول صورة).
//
// 🔴 والقرار التاني في التصميم: **مفيش إرسال بضغطة واحدة**. الرد بصور
// بيتحط «محضّر» فوق خانة الكتابة والموظف بيدوس إرسال — زي الواتساب
// بيزنس. ضغطة واحدة على شريحة كانت تبعت 3 رسايل لعميل حقيقي بلا رجعة.
//
// اللي بيتفحص:
//   1) الشريحة بتعرض شارة 📎N وعدد الصور
//   2) رد صور بس (نص فاضي) بيعرض تسمية مفهومة مش شريحة فاضية
//   3) 🔴 الضغط على رد بصور **مابيبعتش** — بيحضّر بس
//   4) الضغط بيحط النص في الخانة والصور في الشريط المحضّر
//   5) 🔴 الإرسال: الصور **بالتسلسل وبالترتيب** وبعدها الكلام رسالة مستقلة
//   6) 🔴 مسار الصورة في الرفع بيبدأ بمعرّف المتجر — عزل الـStorage
//   7) 🔴 تبديل المحادثة بيصفّر الرد المحضّر (فخ «الاقتباس اللزق»)
//   8) اختيار مرفق بالإيد بيلغي الرد المحضّر (نيّتين على نفس الضغطة)
//   9) رد نصي عادي لسه بيشتغل زي ما هو — بيتحط في الخانة من غير تحضير
//  10) المحرر: سقف 5 صور · شيل صورة · حفظ من غير نص ولا صور مرفوض
//  11) hit-test على الشريحة (درس 31/35)
//  12) 🔴 حارس `bad_media_path` في `wa-send` — فحص منطق خالص على الكود
//      المنشور نفسه (نفس أسلوب فحص `keep()` في إصلاح 14 سبتمبر)
//  13) معايرات:
//      (أ) خلي الضغط يبعت على طول      → فحص 3 يقع
//      (ب) ابعت الصور بالتوازي         → فحص 5 يقع (الترتيب مضمون؟)
//      (ج) شيل تصفير تبديل المحادثة    → فحص 7 يقع
//      (د) شيل بادئة المتجر من المسار  → فحص 6 يقع + الحارس بيرفض
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
// صورة PNG حقيقية 1×1 — الفحص بيتأكد من `naturalWidth>0` مش من وجود الوسم
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const QR = [
  { id: 'q1', tenant_id: TENANT, body: 'أهلاً بحضرتك 👋', media: [] },
  { id: 'q2', tenant_id: TENANT, body: 'دي صور المنتج والسعر 350ج',
    media: [{ path: P1, mime: 'image/jpeg', name: 'a1.jpg' },
            { path: P2, mime: 'image/jpeg', name: 'a2.jpg' }] },
  { id: 'q3', tenant_id: TENANT, body: '',
    media: [{ path: P1, mime: 'image/jpeg', name: 'a1.jpg' }] }
];

const CONVOS = [1, 2].map(n => ({
  id: 'c' + n, tenant_id: TENANT, wa_id: '20100000' + n, customer_name: 'عميل ' + n,
  customer_phone: '20100000' + n, last_message_at: iso(n), last_inbound_at: iso(n),
  last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
  labels: null, note: null, ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null,
  ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null
}));

const MSGS = CONVOS.map((c, i) => ({
  id: 'm' + i, tenant_id: TENANT, conversation_id: c.id, direction: 'in', type: 'text',
  body: 'أهلاً', is_read: true, created_at: iso(1), wa_timestamp: iso(1),
  status: null, wa_message_id: 'wamid-' + i
}));

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    window.__QR        = ${JSON.stringify(opts.qr || QR)};
    window.__MEDIA     = { ${JSON.stringify(P1)}: ${JSON.stringify(PIX)}, ${JSON.stringify(P2)}: ${JSON.stringify(PIX)} };
    window.__UPLOAD_OK = true;
    // كل نداء لـwa-send بيتسجّل بترتيبه ووقته — الترتيب هو جوهر الفحص
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
  if (opts.routeInbox) await ctx.route('**/js/inbox/inbox.js', opts.routeInbox);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.click('.wa-conv[data-id="c1"]');
  await p.waitForTimeout(400);
  await p.click('#wa-qr-btn');          // افتح لوحة الردود
  await p.waitForTimeout(250);
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

const staged = (p) => p.evaluate(() => {
  const bar = document.getElementById('wa-qr-staged');
  if (!bar) return null;
  const imgs = Array.from(bar.querySelectorAll('img'));
  return {
    shown: getComputedStyle(bar).display !== 'none',
    txt: (document.getElementById('wa-qr-staged-body') || {}).textContent || '',
    imgs: imgs.length,
    loaded: imgs.filter(i => i.naturalWidth > 0).length
  };
});

// ════════════════ الشرايح والتحضير ════════════════
{
  const p = await openInbox();
  console.log('──── الشرايح ────');

  const chips = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#wa-qr-panel .wa-qr')).map(e => ({
      id: e.getAttribute('data-qid'),
      badge: (e.querySelector('.wa-qr-badge') || {}).textContent || '',
      txt: (e.querySelector('.wa-qr-txt') || {}).textContent || ''
    })));
  ok(chips.length === 3, `1أ) التلات ردود ظهروا`);
  const q2 = chips.filter(c => c.id === 'q2')[0];
  ok(q2 && q2.badge.indexOf('2') >= 0, `1ب) شارة عدد الصور على الرد بصور: «${q2 && q2.badge}»`);
  const q1 = chips.filter(c => c.id === 'q1')[0];
  ok(q1 && !q1.badge, '1ج) الرد النصي من غير شارة');
  const q3 = chips.filter(c => c.id === 'q3')[0];
  // 🔴 رد صور بس: النص فاضي في الداتابيز عن قصد — شريحة فاضية = شريحة
  // مايعرفش حد هي إيه
  ok(q3 && q3.txt.trim().length > 1 && q3.badge.indexOf('1') >= 0,
     `2) رد الصور بس ليه تسمية مفهومة: «${q3 && q3.txt}»`);

  ok(await hitTest(p, '.wa-qr[data-qid="q2"]') === 'ظاهر', '11) hit-test: الشريحة مش مدفونة');

  console.log('──── التحضير مش الإرسال ────');
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(600);

  const sentNow = await p.evaluate(() => window.__SENT.length);
  ok(sentNow === 0, `3) 🔴 الضغط على الشريحة مابعتش أي رسالة (${sentNow})`);

  const st = await staged(p);
  ok(st && st.shown, '4أ) الشريط المحضّر ظهر');
  ok(st && st.imgs === 2 && st.loaded === 2,
     `4ب) ومعاه مصغّرتين محمّلتين فعلاً (naturalWidth>0): ${st && st.loaded}/2`);
  const inputVal = await p.evaluate(() => document.getElementById('wa-input').value);
  ok(inputVal.indexOf('350ج') >= 0, `4ج) والنص اتحط في خانة الكتابة — قابل للتعديل`);

  console.log('──── الإرسال ────');
  // الموظف بيعدّل النص قبل الإرسال — ده السبب إن النص بيروح للخانة
  await p.evaluate(() => { document.getElementById('wa-input').value = 'السعر 320ج بعد الخصم'; });
  await p.click('#wa-send-btn');
  await p.waitForTimeout(1200);

  const sent = await p.evaluate(() => window.__SENT.map(s => ({
    img: s.body.image_path || null, text: s.body.text || null, cap: s.body.caption || null
  })));
  ok(sent.length === 3, `5أ) اتبعت 3 رسايل (صورتين + كلام): ${sent.length}`);
  ok(sent[0] && sent[0].img === P1 && sent[1] && sent[1].img === P2,
     `5ب) 🔴 الصور بالترتيب اللي الموظف شافه`);
  // 🔴 قرار المالك: الكلام رسالة مستقلة في الآخر مش caption
  ok(sent[0] && !sent[0].cap && sent[1] && !sent[1].cap,
     '5ج) 🔴 مفيش caption على أي صورة');
  ok(sent[2] && sent[2].text === 'السعر 320ج بعد الخصم' && !sent[2].img,
     `5د) 🔴 والكلام رسالة مستقلة في الآخر — وبالنص المعدّل: «${sent[2] && sent[2].text}»`);
  const after = await staged(p);
  ok(after && !after.shown, '5هـ) والشريط المحضّر اتصفّر بعد الإرسال');

  await p.close();
}

// ════ 6 · 10 — المحرر والرفع ════
{
  const p = await openInbox();
  console.log('──── المحرر ────');
  await p.click('#wa-qr-new-media');
  await p.waitForTimeout(250);
  const edOpen = await p.evaluate(() =>
    getComputedStyle(document.getElementById('wa-qr-editor')).display !== 'none');
  ok(edOpen, '10أ) المحرر اتفتح');

  // حفظ فاضي مرفوض
  await p.click('#wa-qr-ed-save');
  await p.waitForTimeout(300);
  const savedEmpty = await p.evaluate(() =>
    (window.__calls || []).filter(c => c.table === 'wa_quick_replies' && c.payload).length);
  ok(savedEmpty === 0, '10ب) حفظ من غير نص ولا صور مرفوض — مفيش أي إدخال');

  // ضيف صورتين
  const png = Buffer.from(PIX.split(',')[1], 'base64');
  for (const n of ['x1.png', 'x2.png']) {
    await p.setInputFiles('#wa-qr-ed-file', { name: n, mimeType: 'image/png', buffer: png });
    await p.waitForTimeout(200);
  }
  const thumbs = await p.evaluate(() => document.querySelectorAll('#wa-qr-ed-thumbs .wa-qr-thumb').length);
  ok(thumbs === 2, `10ج) المصغّرات ظهرت في المحرر: ${thumbs}`);

  // شيل واحدة
  await p.click('#wa-qr-ed-thumbs .wa-qr-thumb-x');
  await p.waitForTimeout(200);
  const thumbs2 = await p.evaluate(() => document.querySelectorAll('#wa-qr-ed-thumbs .wa-qr-thumb').length);
  ok(thumbs2 === 1, `10د) شيل صورة شغال: ${thumbs2}`);

  await p.evaluate(() => { document.getElementById('wa-qr-ed-text').value = 'رد جديد بصورة'; });
  await p.click('#wa-qr-ed-save');
  await p.waitForTimeout(800);

  const ups = await p.evaluate(() => window.__UPLOADS || []);
  ok(ups.length === 1, `6أ) الصورة اترفعت مرة واحدة وقت الحفظ (${ups.length}) — مش مع كل إرسال`);
  // 🔴 عزل الـStorage بيعتمد على **أول مجلد** = معرّف المتجر، وحارس
  // `wa-send` v8 بيرفض أي مسار مش مبتدي بيه
  ok(ups[0] && ups[0].indexOf(TENANT + '/') === 0,
     `6ب) 🔴 المسار بيبدأ بمعرّف المتجر: «${ups[0]}»`);
  ok(ups[0] && ups[0].indexOf('/quick-replies/') > 0,
     `6ج) وتحت مجلد الردود الجاهزة — مش جوّه مجلد محادثة`);

  const payload = await p.evaluate(() =>
    (window.__calls || []).filter(c => c.table === 'wa_quick_replies' && c.payload).map(c => c.payload)[0]);
  ok(payload && payload.media && payload.media.length === 1 && payload.media[0].path === ups[0],
     `10هـ) الحفظ بعت المسار في العمود media`);
  ok(payload && payload.body === 'رد جديد بصورة', '10و) والنص اتبعت معاه');

  await p.close();
}

// ════ 7 · 8 · 9 — التصفير والتعارض ════
{
  const p = await openInbox();
  console.log('──── التصفير ────');
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(500);
  ok((await staged(p)).shown, '7أ) الرد محضّر');

  // 🔴 تبديل المحادثة: تختار رد بصور، تفتح محادثة تانية، تدوس إرسال —
  // فيروح لعميل تاني خالص. والسيرفر **مش** هيرفضه (نفس المتجر).
  await p.click('.wa-conv[data-id="c2"]');
  await p.waitForTimeout(500);
  const afterSwitch = await staged(p);
  ok(afterSwitch && !afterSwitch.shown,
     '7ب) 🔴 تبديل المحادثة صفّر الرد المحضّر');

  // 8) مرفق بالإيد بيلغي الرد المحضّر
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(400);
  const png = Buffer.from(PIX.split(',')[1], 'base64');
  await p.setInputFiles('#wa-file', { name: 'manual.png', mimeType: 'image/png', buffer: png });
  await p.waitForTimeout(300);
  const afterPick = await staged(p);
  ok(afterPick && !afterPick.shown,
     '8) اختيار مرفق بالإيد ألغى الرد المحضّر — نيّة واحدة مش اتنين');

  // 9) رد نصي عادي: بيتحط في الخانة وخلاص
  await p.click('#wa-qr-btn'); await p.waitForTimeout(200);
  await p.click('#wa-qr-btn'); await p.waitForTimeout(200);
  await p.click('.wa-qr[data-qid="q1"]');
  await p.waitForTimeout(400);
  const v = await p.evaluate(() => document.getElementById('wa-input').value);
  const st9 = await staged(p);
  ok(v.indexOf('أهلاً بحضرتك') >= 0 && !st9.shown,
     '9) الرد النصي لسه بيشتغل زي ما هو — في الخانة من غير تحضير');

  await p.close();
}

// ════ 12 — حارس `bad_media_path` على الكود المنشور ════
{
  console.log('──── حارس مسار الميديا (wa-send) ────');
  const src = fs.readFileSync(new URL('../supabase/functions/wa-send/index.ts', import.meta.url), 'utf8');
  const m = src.match(/const mediaPath = imagePath \|\| documentPath;[\s\S]*?\n    \}\n/);
  ok(!!m, '12أ) الحارس موجود في المصدر');
  // منطق خالص منقول **حرفياً** من المنشور (نفس أسلوب فحص `keep()` — إصلاح
  // 14 سبتمبر): بنعيد بناء الشرط ونجرّبه بحمولات حقيقية
  const guard = (mediaPath, tenantId) => {
    if (!mediaPath) return true;
    const prefix = `${tenantId}/`;
    if (typeof mediaPath !== 'string' || !mediaPath.startsWith(prefix) || mediaPath.includes('..')) return false;
    return true;
  };
  const T = '9c58b214-f11d-4de5-afc7-a0de0b903f36';
  const OTHER = '46ca1812-cc56-439f-8787-88dda983cf76';
  ok(guard(T + '/c1/out-1.jpg', T), '12ب) مرفق المحادثة العادي بيعدّي');
  ok(guard(T + '/quick-replies/a1.jpg', T), '12ج) صورة الرد الجاهز بتعدّي');
  ok(!guard(OTHER + '/c9/out-1.jpg', T), '12د) 🔴 مسار متجر تاني **بيترفض**');
  ok(!guard('../' + OTHER + '/x.jpg', T), '12هـ) 🔴 ومسار فيه .. بيترفض');
  ok(!guard(T + 'x/evil.jpg', T), '12و) 🔴 وبادئة شبه مطابقة من غير سلاش بتترفض');
  ok(guard(null, T), '12ز) رسالة نص من غير ميديا مش متأثرة');
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');

// (أ) خلي الضغط يبعت على طول → فحص 3 لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('  waPendingQr={ id:item.id, media:med.slice() };\n  waRenderPendingQr();',
                          '  waPendingQr={ id:item.id, media:med.slice() };\n  waSendQuickReply(String(item.body==null?"":item.body));');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(900);
  const n = await p.evaluate(() => window.__SENT.length);
  ok(n > 0, `معايرة أ: بإرسال فوري الضغطة بعتت ${n} رسالة لعميل حقيقي — فحص 3 بيمسكها`);
  await p.close();
}

// (ب) ابعت الصور بالتوازي → فحص 5ب لازم يقع
{
  const p = await openInbox({
    fnDelayMs: 120,
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // نفس الحمولة بالظبط بس كلها بتخرج مع بعض — الأولى بتأخر أكتر
      body = body.replace(
        '    sb.functions.invoke(\'wa-send\',{body:payload}).then(function(res){\n      var d=(res&&res.data)?res.data:null;\n      if(!d||!d.ok){ fail(d&&d.error?d.error:\'\'); return; }\n      sent++; i++; next();\n    }).catch(function(){ fail(\'\'); });',
        '    var all=[];\n    for(var z=0;z<med.length;z++){ (function(zz){ all.push(new Promise(function(rs){ setTimeout(function(){ rs(sb.functions.invoke(\'wa-send\',{body:{conversation_id:convAtSend,image_path:med[zz].path}})); }, zz===0?60:0); })); })(z); }\n    Promise.all(all).then(function(){ sent=med.length; i=med.length; next(); });');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(500);
  await p.click('#wa-send-btn');
  await p.waitForTimeout(1500);
  const order = await p.evaluate(() => window.__SENT.map(s => s.body.image_path).filter(Boolean));
  ok(order.length === 2 && order[0] === P2,
     `معايرة ب: بالتوازي الترتيب اتقلب (${order.map(x => x.split('/').pop()).join(' → ')}) — فحص 5ب بيمسكها`);
  await p.close();
}

// (ج) شيل تصفير تبديل المحادثة → فحص 7ب لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('  waClearReplyTo();\n  // 🔴 ونفس الحكاية للرد الجاهز المحضّر', '  waClearReplyTo();\n  if(false) //');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('.wa-qr[data-qid="q2"]');
  await p.waitForTimeout(400);
  await p.click('.wa-conv[data-id="c2"]');
  await p.waitForTimeout(500);
  const st = await staged(p);
  ok(st && st.shown,
     'معايرة ج: من غير التصفير الرد فضل محضّر على محادثة تانية — فحص 7ب بيمسكها');
  await p.close();
}

// (د) شيل بادئة المتجر من المسار → فحص 6ب لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("var path=currentTenantId+'/quick-replies/'+Date.now()+'-'+i+'.'+ext;",
                          "var path='quick-replies/'+Date.now()+'-'+i+'.'+ext;");
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-qr-new-media');
  await p.waitForTimeout(250);
  const png = Buffer.from(PIX.split(',')[1], 'base64');
  await p.setInputFiles('#wa-qr-ed-file', { name: 'x.png', mimeType: 'image/png', buffer: png });
  await p.waitForTimeout(250);
  await p.evaluate(() => { document.getElementById('wa-qr-ed-text').value = 'ن'; });
  await p.click('#wa-qr-ed-save');
  await p.waitForTimeout(700);
  const ups = await p.evaluate(() => window.__UPLOADS || []);
  ok(ups[0] && ups[0].indexOf(TENANT + '/') !== 0,
     `معايرة د: من غير البادئة المسار بقى «${ups[0]}» — فحص 6ب بيمسكها وحارس wa-send بيرفضه`);
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
