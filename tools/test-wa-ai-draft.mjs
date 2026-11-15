// كارت «رد مقترح» من الـAI Agent في صندوق المحادثات (v84 — 15 نوفمبر، طلب المالك)
//
// السياق: `wa-ai-draft` (shadow) بتكتب مسودة في `wa_ai_drafts` لكل رسالة واردة. الكارت بيعرضها فوق خانة الكتابة،
// و🔴 **مفيش أي مسار فيه بيبعت للعميل** — «حطّه في خانة الكتابة» بيملا الخانة بس، والإرسال بزرار الإرسال العادي.
//
// اللي بيتفحص:
//   1) آخر رسالة من العميل وليها مسودة pending → الكارت ظاهر (النص · النوع · «تجربة») وطلب واحد بس لـwa_ai_drafts
//   2) 🔴 «حطّه في خانة الكتابة» (ضغطة حقيقية + hit-test): النص في الخانة · **صفر نداء wa-send** · الكارت لسه ظاهر
//   3) إرسال النص زي ما هو → wa-send مرة بنفس النص · `wa_ai_draft_review` = sent · الكارت اتشال
//   4) تعديل وبعدين إرسال → edited بالنص النهائي
//   5) الموظف رد من دماغه (من غير «حطّه») → مفيش review خالص · الكارت اتشال
//   6) ✕ → rejected · الكارت اتشال ومابيرجعش مع إعادة الرسم
//   7) الخانة فيها كلام → «حطّه» بيرفض والكلام بيفضل
//   8) 🔴 آخر رسالة صادرة (اترد عليه) → مفيش كارت و**صفر طلب** لـwa_ai_drafts
//   9) 🔴 تبديل المحادثة: كارت عميل (أ) مايظهرش على شات (ب) · ورد متأخر بتاع (أ) مابيترسمش على (ب)
//  10) escalate من غير نص: «محتاج موظف» + الملاحظة · مفيش زرار «حطّه»
//  11) مسودة معاها كارت محفوظ → سطر «كارت «…»»
//  12) مسودة مش pending (زميل اتعامل) → مفيش كارت
//  13) تفاعل (reaction) بعد كلام العميل → المسودة على الكلام بتظهر
//  14) رسالة عميل جديدة والمسودة لسه ماتعملتش → مفيش كارت دلوقتي، وبيظهر لوحده في المعاد الجاي
//  15) 🔴 XSS: نص المسودة والملاحظة متهرّبين
//  16) النافذة مقفولة (آخر رسالة من أكتر من 24 ساعة) → مفيش كارت ومفيش طلب
//  17) إعادة الرسم (↻) والمسودة معروضة → مفيش طلب تاني
//  18) التاب في الخلفية → مفيش طلب · ولما ترجع = طلب واحد والكارت يظهر
//  19) الطي: الديسكتوب مفتوح افتراضياً وبيتطوي بضغطة على العنوان · الموبايل مطوي افتراضياً (الرسايل تبان) وبيتفتح بضغطة
//  معايرات: (أ) «حطّه» بيبعت · (ب) شيل حارس الخانة · (ج) شيل حارس الرد القديم · (د) شيل esc ·
//           (هـ) شيل «الصادرة = مفيش مسودة» · (و) شيل شرط pending · (ز) شيل aiDraftNoteSent · (ح) شيل reset عند التبديل
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

const TENANT = 't-test-1';
const now = Date.now();
const iso = (secsAgo) => new Date(now - secsAgo * 1000).toISOString();

const conv = (id, name, inboundSecsAgo) => ({
  id, tenant_id: TENANT, wa_id: '2010000000' + id.slice(1), customer_name: name,
  last_message_at: iso(inboundSecsAgo), last_inbound_at: iso(inboundSecsAgo), last_direction: 'in',
  last_message_text: '…', unread_count: 0, status: 'open', labels: []
});
const msg = (id, c, dir, body, secsAgo, type) => ({
  id, tenant_id: TENANT, conversation_id: c, direction: dir, type: type || 'text', body,
  is_read: true, created_at: iso(secsAgo), wa_timestamp: iso(secsAgo), status: dir === 'out' ? 'read' : null,
  wa_message_id: 'wamid-' + id, sent_by_name: dir === 'out' ? 'محمود' : null
});
const draft = (id, c, trig, o) => Object.assign({
  id, tenant_id: TENANT, conversation_id: c, trigger_message_id: trig, behavior: 'answer', intent: 'سؤال عن السعر',
  body: 'السعر 1499 جنيه يا فندم والشحن مجاني 🌷', media: { card: null, note: null }, status: 'pending', error: null,
  created_at: iso(200), model: 'gemini-3.8-flash', tokens_in: 7000
}, o || {});

// ⚠️ الستب بيرجّع __WA_MSGS زي ما هي في الجلب الكامل والواجهة بتعكسها — فالمصفوفة أحدث رسالة الأول
const C1 = [conv('c1', 'عميل أول', 300)];
const M1 = [msg('m2', 'c1', 'in', 'بكام المنظم؟', 300), msg('m1', 'c1', 'out', 'أهلاً بحضرتك', 900)];
const D1 = [draft('d1', 'c1', 'm2')];

async function open(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(opts.convos || C1)};
    window.__WA_MSGS = ${JSON.stringify(opts.msgs || M1)};
    window.__AI_DRAFTS = ${JSON.stringify(opts.drafts === undefined ? D1 : opts.drafts)};
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
    window.__FN = function(slug, body){ return { ok:true, message_id:'wamid-new', row_id:'new1', sent_by_name:'أدمن الاختبار' }; };
    ${opts.init || ''}
  `);
  await ctx.addInitScript(STUB);
  if (opts.routeAi) await ctx.route('**/js/inbox/ai-draft.js', opts.routeAi);
  if (opts.routeInbox) await ctx.route('**/js/inbox/inbox.js', opts.routeInbox);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(300);
  if (opts.beforeOpen) await opts.beforeOpen(p);
  if (!opts.noOpen) {
    await p.click('#wa-list-body .wa-conv');
    await p.waitForFunction(() => { const x = document.getElementById('wa-msgs'); return x && x.querySelector('.wa-msg'); }, { timeout: 8000 });
    await p.waitForTimeout(350);
  }
  return p;
}

const card = (p) => p.evaluate(() => {
  const el = document.getElementById('wa-ai-draft');
  if (!el) return null;
  const q = (s) => { const x = el.querySelector(s); return x ? x.textContent.trim() : ''; };
  return { did: el.getAttribute('data-did'), body: q('.wa-ai-body'), beh: q('.wa-ai-beh'), note: q('.wa-ai-note'),
    card: q('.wa-ai-card'), trial: q('.wa-ai-trial'), use: !!el.querySelector('[data-ai="use"]'),
    imgs: el.querySelectorAll('img').length, html: el.innerHTML,
    above: (function(){ const r = document.getElementById('wa-compose-row'); return r ? el.getBoundingClientRect().bottom <= r.getBoundingClientRect().top + 1 : false; })() };
});
const draftReqs = (p) => p.evaluate(() => (window.__calls || []).filter(c => c.table === 'wa_ai_drafts').length);
const sends = (p) => p.evaluate(() => (window.__FNCALLS || []).filter(c => c.slug === 'wa-send').map(c => c.body));
const reviews = (p) => p.evaluate(() => (window.__calls || []).filter(c => c.rpc === 'wa_ai_draft_review').map(c => c.args));
// hit-test: نص الزرار لازم يرجّع الزرار نفسه (مش مدفون تحت حاجة — درس 31)
const hit = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return false;
  el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!at && (at === el || el.contains(at));
}, sel);
// معايرة: استبدال بمرساة — المرساة المفقودة = رمي (درس 47/56)
const patch = (anchor, repl) => async (r) => {
  const res = await r.fetch();
  const src = await res.text();
  const out = src.replace(anchor, repl);
  if (out === src) throw new Error('المعايرة مالقتش المرساة: ' + String(anchor).slice(0, 70));
  await r.fulfill({ response: res, body: out });
};
const cal = async (name, fn) => {
  try { const failed = await fn(); ok(failed, 'معايرة ' + name); }
  catch (e) { ok(false, 'معايرة ' + name + ' — ماتحقنتش: ' + e.message); }
};

// ════ 1 · 2 · 3 ════
console.log('──── الكارت + «حطّه في خانة الكتابة» + الإرسال زي ما هو ────');
{
  const p = await open();
  const c = await card(p);
  ok(c && c.did === 'd1' && c.body === D1[0].body, `1) الكارت ظاهر بنص المسودة — «${c && c.body}»`);
  ok(c && c.beh === 'إجابة' && /تجربة/.test(c.trial), `1) النوع «${c && c.beh}» وعلامة «تجربة»`);
  ok(c && c.above, '1) الكارت فوق خانة الكتابة');
  ok(await draftReqs(p) === 1, `1) طلب واحد بس لـwa_ai_drafts — ${await draftReqs(p)}`);
  ok((await sends(p)).length === 0, '1) فتح المحادثة مابعتش حاجة للعميل');

  ok(await hit(p, '#wa-ai-draft [data-ai="use"]'), '2) زرار «حطّه» مش مدفون (hit-test)');
  await p.click('#wa-ai-draft [data-ai="use"]');
  await p.waitForTimeout(200);
  ok(await p.inputValue('#wa-input') === D1[0].body, '2) النص اتحط في خانة الكتابة');
  ok((await sends(p)).length === 0, '2) 🔴 «حطّه» مابعتش حاجة — صفر نداء wa-send');
  ok((await reviews(p)).length === 0, '2) ولسه مفيش review (ماتبعتش)');
  ok(!!(await card(p)), '2) الكارت لسه ظاهر');

  await p.click('#wa-send-btn');
  await p.waitForTimeout(400);
  const s = await sends(p), rv = await reviews(p);
  ok(s.length === 1 && s[0].text === D1[0].body && s[0].conversation_id === 'c1', '3) زرار الإرسال العادي بعت النص مرة واحدة');
  ok(rv.length === 1 && rv[0].p_id === 'd1' && rv[0].p_status === 'sent' && rv[0].p_final_body === D1[0].body, `3) review = sent — ${JSON.stringify(rv)}`);
  ok(!(await card(p)), '3) الكارت اتشال بعد الإرسال');
  await p.close();
}

// ════ 4 ════
console.log('──── التعديل · الرد من دماغه · التجاهل · الخانة فيها كلام ────');
{
  const p = await open();
  await p.click('#wa-ai-draft [data-ai="use"]');
  await p.fill('#wa-input', 'السعر 1499 يا فندم');
  await p.click('#wa-send-btn');
  await p.waitForTimeout(400);
  const rv = await reviews(p);
  ok(rv.length === 1 && rv[0].p_status === 'edited' && rv[0].p_final_body === 'السعر 1499 يا فندم', `4) عدّل وبعت → edited بالنص النهائي — ${JSON.stringify(rv)}`);
  await p.close();
}
// ════ 5 ════
{
  const p = await open();
  await p.fill('#wa-input', 'ثواني يا فندم');
  await p.click('#wa-send-btn');
  await p.waitForTimeout(400);
  ok((await reviews(p)).length === 0, '5) رد من دماغه → مفيش review (المسودة بتفضل pending للتقرير)');
  ok(!(await card(p)), '5) والكارت اتشال');
  await p.close();
}
// ════ 6 · 17 ════
{
  const p = await open();
  // 17 الأول: ↻ والمسودة معروضة = مفيش طلب تاني
  await p.click('#wa-refresh'); await p.waitForTimeout(500);
  ok(await draftReqs(p) === 1 && !!(await card(p)), `17) ↻ والمسودة معروضة → مفيش طلب تاني (${await draftReqs(p)}) والكارت مكانه`);
  ok(await hit(p, '#wa-ai-draft [data-ai="reject"]'), '6) زرار ✕ مش مدفون');
  await p.click('#wa-ai-draft [data-ai="reject"]');
  await p.waitForTimeout(250);
  const rv = await reviews(p);
  ok(rv.length === 1 && rv[0].p_status === 'rejected' && rv[0].p_id === 'd1', `6) ✕ → rejected — ${JSON.stringify(rv)}`);
  ok(!(await card(p)), '6) الكارت اتشال');
  await p.click('#wa-refresh'); await p.waitForTimeout(500);
  ok(!(await card(p)) && await draftReqs(p) === 1, '6) ومابيرجعش مع إعادة الرسم (ومن غير طلب جديد)');
  ok((await sends(p)).length === 0, '6) ومفيش حاجة اتبعتت للعميل');
  await p.close();
}
// ════ 7 ════
{
  const p = await open();
  await p.fill('#wa-input', 'كلام الموظف');
  await p.click('#wa-ai-draft [data-ai="use"]');
  await p.waitForTimeout(200);
  ok(await p.inputValue('#wa-input') === 'كلام الموظف', '7) الخانة فيها كلام → «حطّه» مابيمسحهوش');
  await p.close();
}

// ════ 8 ════
console.log('──── مفيش كارت: اترد عليه · مش pending · النافذة مقفولة ────');
{
  const p = await open({ msgs: [msg('m3', 'c1', 'out', 'تمام يا فندم', 100), msg('m2', 'c1', 'in', 'بكام المنظم؟', 300)] });
  ok(!(await card(p)), '8) آخر رسالة صادرة → مفيش كارت');
  ok(await draftReqs(p) === 0, `8) 🔴 وصفر طلب لـwa_ai_drafts — ${await draftReqs(p)}`);
  await p.close();
}
// ════ 12 ════
{
  const p = await open({ drafts: [draft('d1', 'c1', 'm2', { status: 'sent' })] });
  ok(!(await card(p)), '12) مسودة مش pending (زميل اتعامل) → مفيش كارت');
  await p.close();
}
// ════ 16 ════
{
  const old = 25 * 3600;
  const p = await open({ convos: [conv('c1', 'عميل قديم', old)], msgs: [msg('m2', 'c1', 'in', 'بكام؟', old)] });
  ok(!(await card(p)) && await draftReqs(p) === 0, `16) النافذة مقفولة → مفيش كارت ومفيش طلب (${await draftReqs(p)})`);
  await p.close();
}

// ════ 9 ════
console.log('──── تبديل المحادثة ────');
const TWO = [conv('c1', 'عميل أول', 300), conv('c2', 'عميل تاني', 320)];
const M2 = [msg('n1', 'c2', 'in', 'عايزة أعرف المقاس', 320)];
{
  const p = await open({ convos: TWO });
  ok(!!(await card(p)), '9) (أ) ليها كارت');
  // (ب) مالهاش مسودة — الستب بيرجّع __WA_MSGS لأي محادثة فبنبدّلها قبل الضغط
  await p.evaluate((m) => { window.__WA_MSGS = m; }, M2);
  await p.click('#wa-list-body .wa-conv:nth-child(2)');
  // 🔴 قبل ما رسايل (ب) تترسم كمان — الكارت مايفضلش لحظة فوق شات عميل تاني
  const during = await card(p);
  await p.waitForTimeout(600);
  ok(!during && !(await card(p)), '9) 🔴 كارت (أ) مش ظاهر على شات (ب) — لا لحظة التبديل ولا بعدها');
  await p.close();
}
{
  // رد (أ) متأخر: يوصل بعد ما الموظف فتح (ب)
  const p = await open({ convos: TWO, init: `window.__TABLE_DELAY = function(t, st){ return t === 'wa_ai_drafts' && JSON.stringify(st.f||[]).indexOf('m2') >= 0 ? 900 : 0; };` });
  ok(!(await card(p)), '9) رد (أ) لسه في السكة — مفيش كارت');
  await p.evaluate((m) => { window.__WA_MSGS = m; }, M2);
  await p.click('#wa-list-body .wa-conv:nth-child(2)');
  await p.waitForTimeout(1400);
  ok(!(await card(p)), '9) 🔴 رد (أ) المتأخر مااترسمش على شات (ب)');
  await p.close();
}

// ════ 10 · 11 · 13 · 15 ════
console.log('──── أشكال المسودة ────');
{
  const p = await open({ drafts: [draft('d1', 'c1', 'm2', { behavior: 'escalate', body: null, media: { card: null, note: 'العميل عايز يرجّع المنتج — محتاج موظف' } })] });
  const c = await card(p);
  ok(c && /محتاج موظف/.test(c.beh) && /يرجّع المنتج/.test(c.note), `10) escalate → «${c && c.beh}» + الملاحظة`);
  ok(c && !c.use && !c.body, '10) ومفيش زرار «حطّه» ولا نص (مفيش رد يتبعت)');
  await p.close();
}
{
  const p = await open({ drafts: [draft('d1', 'c1', 'm2', { body: 'اتفضل يا فندم التفاصيل', media: { card: { quick_reply_id: 'q1', title: 'مطبخ' }, note: null } })] });
  const c = await card(p);
  ok(c && /كارت «مطبخ»/.test(c.card), `11) سطر الكارت المحفوظ — «${c && c.card}»`);
  await p.close();
}
{
  const p = await open({ msgs: [msg('m3', 'c1', 'in', '👍', 200, 'reaction'), msg('m2', 'c1', 'in', 'بكام المنظم؟', 300)] });
  const c = await card(p);
  ok(c && c.did === 'd1', '13) تفاعل بعد كلام العميل → مسودة الكلام بتظهر');
  await p.close();
}
{
  const p = await open({ drafts: [draft('d1', 'c1', 'm2', { body: 'سعر <img src=x onerror="window.__XSS=1"> كويس', media: { card: null, note: '<b id="xb">ملاحظة</b>' } })] });
  const c = await card(p);
  const x = await p.evaluate(() => ({ xss: window.__XSS || 0, b: !!document.getElementById('xb') }));
  ok(c && c.imgs === 0 && !x.xss && !x.b && /<img src=x/.test(c.body), '15) 🔴 نص المسودة والملاحظة متهرّبين (مفيش وسم اترسم)');
  await p.close();
}

// ════ 14 ════
console.log('──── رسالة جديدة والمسودة لسه بتتعمل · التاب في الخلفية ────');
{
  // رسالة العميل من 25ث: معاد 19ث فات (طلب فوري مايلاقيش) والمعاد الجاي 28ث = بعد ~3ث
  const p = await open({ convos: [conv('c1', 'عميل أول', 25)], msgs: [msg('m9', 'c1', 'in', 'متاح أسود؟', 25), msg('m1', 'c1', 'out', 'أهلاً', 900)], drafts: [] });
  ok(!(await card(p)) && await draftReqs(p) === 1, `14) المسودة لسه ماتعملتش → مفيش كارت (طلب واحد: ${await draftReqs(p)})`);
  await p.evaluate((d) => { window.__AI_DRAFTS = [d]; }, draft('d9', 'c1', 'm9', { body: 'أيوه يا فندم متاح أسود' }));
  await p.waitForFunction(() => !!document.getElementById('wa-ai-draft'), { timeout: 6000 }).catch(() => {});
  const c = await card(p);
  ok(c && c.did === 'd9', '14) والكارت ظهر لوحده في المعاد الجاي (من غير ما الموظف يعمل حاجة)');
  const n = await draftReqs(p);
  await p.waitForTimeout(1500);
  ok(await draftReqs(p) === n, `14) وبعد ما اتلاقت المواعيد الباقية اتلغت (الطلبات ${n})`);
  await p.close();
}
// ════ 18 ════
{
  const p = await open({ noOpen: true });
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  await p.click('#wa-list-body .wa-conv');
  await p.waitForFunction(() => { const x = document.getElementById('wa-msgs'); return x && x.querySelector('.wa-msg'); }, { timeout: 8000 });
  await p.waitForTimeout(400);
  ok(!(await card(p)) && await draftReqs(p) === 0, `18) التاب في الخلفية → مفيش طلب (${await draftReqs(p)})`);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(500);
  ok(!!(await card(p)) && await draftReqs(p) === 1, `18) رجعت → طلب واحد والكارت ظهر (${await draftReqs(p)})`);
  await p.close();
}

// ════ 19 ════
console.log('──── الطي ────');
{
  const vis = (p) => p.evaluate(() => { const x = document.querySelector('#wa-ai-draft .wa-ai-body'); return !!x && getComputedStyle(x).display !== 'none'; });
  const p = await open();
  ok(await vis(p), '19) الديسكتوب: النص ظاهر افتراضياً');
  await p.click('#wa-ai-draft .wa-ai-tag'); await p.waitForTimeout(150);
  ok(!(await vis(p)) && !!(await card(p)), '19) ضغطة على العنوان → اتطوى (والكارت لسه موجود)');
  await p.click('#wa-refresh'); await p.waitForTimeout(500);
  ok(!(await vis(p)), '19) وبيفضل مطوي مع إعادة الرسم');
  ok((await reviews(p)).length === 0 && (await sends(p)).length === 0, '19) والطي مابيسجّلش حاجة ومابيبعتش');
  await p.close();
  const m = await open({ viewport: { width: 390, height: 844 } });
  ok(!!(await card(m)) && !(await vis(m)), '19) الموبايل: مطوي افتراضياً (العنوان بس)');
  await m.click('#wa-ai-draft .wa-ai-tag'); await m.waitForTimeout(150);
  ok(await vis(m) && await hit(m, '#wa-ai-draft [data-ai="use"]'), '19) ضغطة → اتفتح وزرار «حطّه» مش مدفون');
  await m.close();
}

// ════ المعايرات ════
console.log('──── المعايرات ────');
await cal('(أ) «حطّه» بيبعت على طول → فحص 2 بيمسكها', async () => {
  const p = await open({ routeAi: patch("  aiUsed = { id: d.id, body: body };\n}", "  aiUsed = { id: d.id, body: body };\n  var sbtn = $id('wa-send-btn'); if(sbtn) sbtn.click();\n}") });
  await p.click('#wa-ai-draft [data-ai="use"]'); await p.waitForTimeout(300);
  const n = (await sends(p)).length; await p.close();
  return n > 0;
});
await cal('(ب) شيل حارس «الخانة فيها كلام» → فحص 7 بيمسكها', async () => {
  const p = await open({ routeAi: patch("  if(cur && cur !== body){ toast('خانة الكتابة فيها كلام — ابعته أو امسحه الأول', 'er'); return; }", "") });
  await p.fill('#wa-input', 'كلام الموظف');
  await p.click('#wa-ai-draft [data-ai="use"]'); await p.waitForTimeout(200);
  const v = await p.inputValue('#wa-input'); await p.close();
  return v !== 'كلام الموظف';
});
await cal('(ج) شيل حارس الرد القديم + reset التبديل → فحص 9 بيمسكها', async () => {
  const p = await open({ convos: TWO,
    init: `window.__TABLE_DELAY = function(t, st){ return t === 'wa_ai_drafts' && JSON.stringify(st.f||[]).indexOf('m2') >= 0 ? 900 : 0; };`,
    routeAi: async (r) => {
      const res = await r.fetch(); let src = await res.text(); const o = src;
      src = src.replace("    if(myGen !== aiGen || trig !== aiTrigger) return;   // محادثة/رسالة تانية — رد قديم\n", "");
      if (src === o) throw new Error('المعايرة مالقتش المرساة (ج)');
      await r.fulfill({ response: res, body: src });
    } });
  await p.evaluate((m) => { window.__WA_MSGS = m; }, M2);
  await p.click('#wa-list-body .wa-conv:nth-child(2)'); await p.waitForTimeout(1400);
  const c = await card(p); await p.close();
  return !!c;
});
await cal('(د) شيل esc من نص المسودة → فحص 15 بيمسكها', async () => {
  const p = await open({ drafts: [draft('d1', 'c1', 'm2', { body: 'سعر <img src=x onerror="window.__XSS=1"> كويس' })],
    routeAi: patch("'<div class=\"wa-ai-body\">' + esc(body) + '</div>'", "'<div class=\"wa-ai-body\">' + body + '</div>'") });
  const c = await card(p); await p.close();
  return !!c && c.imgs > 0;
});
await cal('(هـ) شيل «الصادرة = اترد عليه» → فحص 8 بيمسكها', async () => {
  const p = await open({ msgs: [msg('m3', 'c1', 'out', 'تمام يا فندم', 100), msg('m2', 'c1', 'in', 'بكام المنظم؟', 300)],
    routeAi: patch("    if(m.direction === 'out') return null;\n", "    if(m.direction === 'out') continue;\n") });
  const n = await draftReqs(p), c = await card(p); await p.close();
  return n > 0 || !!c;
});
await cal('(و) شيل شرط pending → فحص 12 بيمسكها', async () => {
  const p = await open({ drafts: [draft('d1', 'c1', 'm2', { status: 'sent' })],
    routeAi: patch("    if(row.status !== 'pending'){ aiDone[trig] = 1; return; }   // زميل اتعامل معاها خلاص\n", "") });
  const c = await card(p); await p.close();
  return !!c;
});
await cal('(ز) شيل aiDraftNoteSent من waSend → فحص 3 بيمسكها', async () => {
  const p = await open({ routeInbox: patch("    aiDraftNoteSent(convAtSend, text);\n", "") });
  await p.click('#wa-ai-draft [data-ai="use"]'); await p.click('#wa-send-btn'); await p.waitForTimeout(400);
  const rv = await reviews(p); await p.close();
  return rv.length === 0;
});
await cal('(ح) شيل reset من openConversation → فحص 9 (لحظة التبديل) بيمسكها', async () => {
  const p = await open({ convos: TWO,
    init: `window.__TABLE_DELAY = function(t){ return t === 'wa_messages' ? 500 : 0; };`,
    routeInbox: patch("  // 🔴 كارت الرد المقترح بتاع العميل اللي فات مايفضلش فوق شات العميل ده (v84)\n  aiDraftReset();\n", "") });
  await p.evaluate((m) => { window.__WA_MSGS = m; }, M2);
  await p.click('#wa-list-body .wa-conv:nth-child(2)');
  const during = await card(p); await p.close();
  return !!during;
});

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
