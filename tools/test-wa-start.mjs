// «بدأ شات مع رقم جديد» — طلب المالك 16 سبتمبر
//
// «ساعات العميل بيكون بيكلمنا على الموبايل ويقولنا ابعتولي رسالة على
// واتساب واحنا مش بنعرف نبعتله لو من الـAPI، فعاوز يبقى في إمكانية إني
// أبدأ شات مع عميل عمره ما كلمنا وأبعتله template.»
//
// 🔴 كل الحراسات الحقيقية على السيرفر في `wa-start`: التصريح بقراية
// القالب بتوكن المستخدم عبر RLS · النص وقيم المتغيرات من الداتابيز ·
// `window_open` بيرفض لما نافذة الـ24 ساعة مفتوحة (رسالة عادية ببلاش) ·
// قالب واحد لكل رقم كل 24 ساعة · قفل النفاد.
//
// اللي بيتفحص هنا هو **الواجهة**: الحمولة اللي بتخرج، والمعاينة اللي
// الموظف بيوافق عليها، والرفض اللي بيتقال بسببه.
//   1) 🔴 مفيش قالب مسجّل = الزرار مايبانش خالص (درس 16 — وعد كاذب)
//   2) فيه قوالب = الزرار بيبان + hit-test مش مدفون (درس 31/35)
//   3) الفتح بيملا قايمة القوالب والمعاينة
//   4) 🔴 المعاينة بتعرض النص **المرسوم** مش `{{1}}` الخام
//   5) 🔴 المعاينة مطابقة لدلالة `renderTemplate` بتاعة السيرفر بالحرف:
//      تعويض بمرة واحدة، فـ`$&` في القيمة مابيتفكّش و`{{1}}` جوّه قيمة
//      مابيتعوّضش تاني
//   6) تبديل القالب بيحدّث المعاينة
//   7) 🔴 مفيش إرسال من غير مودال تأكيد بالنص الكامل — الرسالة بفلوس
//   8) 🔴 الحمولة **phone + template_id + name بس** — مفيش نص ولا params
//      ولا tenant_id (غير كده الموظف بيبعت أي كلام برّه النافذة)
//   9) رفض محلي: رقم قصير
//  10) نجاح: الفورم بتتقفل والشات بيتفتح
//  11) 🔴 `window_open` بيقول «ابعتله رسالة عادية ببلاش» مش «حصلت مشكلة»
//  12) كل رفض من السيرفر بسببه الحقيقي (too_soon · bad_phone · depleted ·
//      template_failed بتفصيلة ميتا)
//  13) معايرات:
//      (أ) شيل مودال التأكيد          → فحص 7 يقع
//      (ب) حط نص القالب في الحمولة    → فحص 8 يقع
//      (ج) خلّي المعاينة تعرض الخام   → فحص 4 و5 يقعوا
//      (د) خلّي الزرار ظاهر دايماً     → فحص 1 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

const TENANT = 't-test-1';
const now = Date.now();
const iso = (m) => new Date(now - m * 60000).toISOString();

const CONVOS = [
  { id: 'c1', tenant_id: TENANT, wa_id: '201012345678', customer_name: 'سعاد محمد',
    customer_phone: '201012345678', last_message_at: iso(1), last_inbound_at: iso(1),
    last_message_text: 'عايزة اطلب', last_direction: 'in', unread_count: 0, status: 'open',
    labels: null, note: null, ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null,
    ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null }
];
const MSGS = [{ id: 'm0', tenant_id: TENANT, conversation_id: 'c1', direction: 'in', type: 'text',
  body: 'أهلاً', is_read: true, created_at: iso(1), wa_timestamp: iso(1), status: null, wa_message_id: 'wamid-0' }];

const BODY1 = 'أهلاً حضرتك 👋\nدي رسالة من {{1}} بخصوص طلب حضرتك إننا نكلمك على واتساب.\nتقدر ترد على الرسالة دي وهنكمل معاك من هنا على طول.';
const RENDERED1 = BODY1.replace('{{1}}', 'عتبة دوت كوم');

// 🔴 قالب الحالات الحدّية. التعويض **بمرة واحدة** معناه:
//   `{{1}}` → `$& حاجة`  — الـ`$&` بيفضل نص حرفي (مع `replaceAll` كان
//                          هيتفك لنص المطابقة نفسه `{{1}}`)
//   `{{2}}` → `{{1}}`    — والقيمة دي **مابتتعوّضش تاني** (التعويض على
//                          مراحل كان هيحوّلها لـ`$& حاجة`)
const TPLS = [
  { id: 't1', tenant_id: TENANT, label: 'بدء شات', template_name: 'chat_start_ar',
    lang: 'ar_EG', body: BODY1, params: ['عتبة دوت كوم'], enabled: true },
  { id: 't2', tenant_id: TENANT, label: 'حالات حدّية', template_name: 'edge_ar',
    lang: 'ar_EG', body: 'سعر {{1}} و{{2}}', params: ['$& حاجة', '{{1}}'], enabled: true }
];
const RENDERED2 = 'سعر $& حاجة و{{1}}';

async function openChats(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS  = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS    = ${JSON.stringify(MSGS)};
    window.__START_TPLS = ${JSON.stringify(opts.tpls === undefined ? TPLS : opts.tpls)};
    window.__START_RES  = ${JSON.stringify(opts.res || { ok: true, conversation_id: 'c-new-1', message_id: 'wamid-new' })};
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
    window.__FN = function(slug){ return slug === 'wa-start' ? window.__START_RES : { ok:false }; };
  `);
  await ctx.addInitScript(STUB);
  if (opts.routeInbox) await ctx.route('**/js/inbox/inbox.js', opts.routeInbox);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(350);
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

const shown = (p, id) => p.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 1;
}, id);

const fnCalls = (p) => p.evaluate(() => (window.__FNCALLS || []).filter(c => c.slug === 'wa-start'));
const toastText = (p) => p.evaluate(() => {
  const t = document.querySelector('.toast, #toast, .toast-box');
  return t ? (t.textContent || '').trim() : '';
});

// فتح الفورم وملء الرقم ثم الضغط على «ابعت» (من غير تأكيد المودال)
async function askSend(p, phone, tpl) {
  await p.click('#wa-newchat-btn');
  await p.waitForTimeout(250);
  await p.evaluate((v) => {
    document.getElementById('wa-nc-phone').value = v.phone;
    const s = document.getElementById('wa-nc-tpl');
    if (v.tpl) { s.value = v.tpl; s.dispatchEvent(new Event('change')); }
  }, { phone, tpl });
  await p.click('#wa-nc-send');
  await p.waitForTimeout(250);
}
const confirmModal = async (p) => { await p.click('#cmodal-ok'); await p.waitForTimeout(400); };

// ════════════════ 1) مفيش قوالب = مفيش زرار ════════════════
{
  const p = await openChats({ tpls: [] });
  console.log('──── الزرار ────');
  ok(!(await shown(p, 'wa-newchat-btn')), '1) 🔴 مفيش قالب مسجّل → الزرار مايبانش (مش وعد كاذب)');
  await p.context().close();
}

// ════════════════ 2–9) الفورم والمعاينة والحمولة ════════════════
{
  const p = await openChats();
  ok(await shown(p, 'wa-newchat-btn'), '2أ) فيه قوالب → الزرار بيبان');
  ok(await hitTest(p, '#wa-newchat-btn') === 'ظاهر', '2ب) hit-test: الزرار مش مدفون');

  console.log('──── المعاينة ────');
  await p.click('#wa-newchat-btn');
  await p.waitForTimeout(300);
  ok(await shown(p, 'wa-newchat'), '3أ) الفورم اتفتحت');
  const opts = await p.evaluate(() => [...document.querySelectorAll('#wa-nc-tpl option')].map(o => o.textContent));
  ok(opts.length === 2 && opts[0] === 'بدء شات', `3ب) قايمة القوالب اتملت: ${opts.join(' · ')}`);

  const prev1 = await p.evaluate(() => document.getElementById('wa-nc-prev').textContent);
  ok(prev1 === RENDERED1, '4) 🔴 المعاينة بالنص المرسوم مش `{{1}}` الخام');
  ok(prev1.indexOf('{{') < 0, '4ب) مفيش أي `{{n}}` باقي في المعاينة');

  await p.evaluate(() => { const s = document.getElementById('wa-nc-tpl'); s.value = 't2'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(150);
  const prev2 = await p.evaluate(() => document.getElementById('wa-nc-prev').textContent);
  ok(prev2 === RENDERED2, `5) 🔴 تعويض بمرة واحدة زي السيرفر بالحرف: «${prev2}»`);
  ok(prev2.indexOf('$& حاجة') === 0 + 4, '5ب) `$&` فضل نص حرفي (مش اتفك لنص المطابقة)');
  ok(prev2.endsWith('{{1}}'), '5ج) قيمة جوّاها `{{1}}` ماتعوّضتش تاني');
  ok(prev2 !== RENDERED1, '6) تبديل القالب بيحدّث المعاينة');

  console.log('──── التأكيد والحمولة ────');
  await p.evaluate(() => { const s = document.getElementById('wa-nc-tpl'); s.value = 't1'; s.dispatchEvent(new Event('change')); });
  await p.evaluate(() => {
    document.getElementById('wa-nc-phone').value = '01012345678';
    document.getElementById('wa-nc-name').value = 'أم كريم';
  });
  await p.click('#wa-nc-send');
  await p.waitForTimeout(300);
  ok(await shown(p, 'cmodal-backdrop'), '7أ) 🔴 مودال تأكيد بيظهر قبل أي إرسال');
  ok((await fnCalls(p)).length === 0, '7ب) 🔴 مفيش نداء للسيرفر قبل التأكيد');
  const sub = await p.evaluate(() => document.getElementById('cmodal-sub').textContent);
  ok(sub.indexOf(RENDERED1) === 0, '7ج) 🔴 المودال فيه النص الكامل اللي العميل هيقراه');

  await confirmModal(p);
  const calls = await fnCalls(p);
  ok(calls.length === 1, '8أ) نداء واحد لـ`wa-start`');
  const body = calls[0] ? calls[0].body : {};
  const keys = Object.keys(body).sort();
  ok(keys.join(',') === 'name,phone,template_id', `8ب) 🔴 الحمولة phone + template_id + name بس: ${keys.join(',')}`);
  ok(body.phone === '01012345678' && body.template_id === 't1', '8ج) الرقم والقالب اتبعتوا صح');
  ok(body.body === undefined && body.text === undefined && body.params === undefined,
     '8د) 🔴 مفيش نص ولا params في الحمولة (الموظف مايبعتش كلام برّه النافذة)');
  ok(body.tenant_id === undefined, '8هـ) 🔴 مفيش tenant_id في الحمولة');

  ok(!(await shown(p, 'wa-newchat')), '10أ) الفورم اتقفلت بعد النجاح');
  ok((await toastText(p)).indexOf('اتبعتت') >= 0, '10ب) رسالة نجاح');
  await p.context().close();
}

// ════════════════ 9) رفض محلي ════════════════
{
  const p = await openChats();
  console.log('──── الرفض المحلي ────');
  await askSend(p, '0101', 't1');
  ok(!(await shown(p, 'cmodal-backdrop')), '9أ) رقم قصير → مفيش مودال');
  ok((await fnCalls(p)).length === 0, '9ب) رقم قصير → مفيش نداء للسيرفر');
  ok((await toastText(p)).indexOf('رقم') >= 0, '9ج) الرسالة بتقول إن الرقم غلط');
  await p.context().close();
}

// ════════════════ 11–12) رفض السيرفر بسببه الحقيقي ════════════════
const CASES = [
  { res: { ok: false, error: 'window_open', conversation_id: 'c1' }, want: 'ببلاش',
    label: '11) 🔴 `window_open` بيقول ابعتله رسالة عادية ببلاش' },
  { res: { ok: false, error: 'too_soon', conversation_id: 'c1' }, want: '24 ساعة',
    label: '12أ) `too_soon` بيقول استنى 24 ساعة' },
  { res: { ok: false, error: 'bad_phone' }, want: 'الرقم مش مظبوط',
    label: '12ب) `bad_phone` بسببه' },
  { res: { ok: false, error: 'depleted' }, want: 'الرصيد',
    label: '12ج) `depleted` بيقول اشحن' },
  { res: { ok: false, error: 'no_wa_config' }, want: 'الواتساب مش مركّب',
    label: '12د) `no_wa_config` بسببه' },
  { res: { ok: false, error: 'template_failed', detail: 'Template name does not exist' },
    want: 'Template name does not exist',
    label: '12هـ) 🔴 `template_failed` بيعرض تفصيلة ميتا الحقيقية' }
];
console.log('──── رفض السيرفر ────');
for (const c of CASES) {
  const p = await openChats({ res: c.res });
  await askSend(p, '01012345678', 't1');
  await confirmModal(p);
  const t = await toastText(p);
  ok(t.indexOf(c.want) >= 0, `${c.label} — «${t}»`);
  ok(t.indexOf('حصلت مشكلة') < 0, `${c.label} (مش رسالة عامة)`);
  await p.context().close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');
const SRC = fs.readFileSync(new URL('../app/js/inbox/inbox.js', import.meta.url), 'utf8');
const patch = (fn) => async (route) => {
  const src = fn(SRC);
  if (src === SRC) { console.log('  ✗ المعايرة ماغيّرتش الكود — الاستبدال مابيطابقش'); bad++; }
  await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: src });
};

// (أ) شيل مودال التأكيد — الإرسال يخرج على طول
{
  let caught = 0;
  const p = await openChats({
    routeInbox: patch(s => s.replace(
      /showModal\(\{\s*\n\s*icon:'💬',/,
      "(function(o){o.onOk();})({\n    icon:'💬',"))
  });
  await askSend(p, '01012345678', 't1');
  if (await shown(p, 'cmodal-backdrop')) caught++;
  if ((await fnCalls(p)).length === 0) caught++;
  ok(caught === 0, '(أ) شيل المودال → فحص 7 وقع زي ما المفروض');
  await p.context().close();
}

// (ب) النص بيتبعت في الحمولة
{
  const p = await openChats({
    routeInbox: patch(s => s.replace(
      "body:{phone:phone,template_id:tpl.id,name:name||null}",
      "body:{phone:phone,template_id:tpl.id,name:name||null,body:waStartRender(tpl)}"))
  });
  await askSend(p, '01012345678', 't1');
  await confirmModal(p);
  const keys = Object.keys(((await fnCalls(p))[0] || {}).body || {}).sort();
  ok(keys.join(',') !== 'name,phone,template_id', '(ب) نص في الحمولة → فحص 8ب/8د وقع زي ما المفروض');
  await p.context().close();
}

// (ج) المعاينة بتعرض الخام
{
  const p = await openChats({
    routeInbox: patch(s => s.replace(
      'box.textContent = waStartRender(waStartTplById(sel?sel.value:\'\'));',
      "var _t=waStartTplById(sel?sel.value:''); box.textContent = _t?String(_t.body||''):'';"))
  });
  await p.click('#wa-newchat-btn');
  await p.waitForTimeout(300);
  const prev = await p.evaluate(() => document.getElementById('wa-nc-prev').textContent);
  ok(prev !== RENDERED1 && prev.indexOf('{{1}}') >= 0, '(ج) معاينة خام → فحص 4 وقع زي ما المفروض');
  await p.context().close();
}

// (د) الزرار ظاهر دايماً
{
  const p = await openChats({
    tpls: [],
    routeInbox: patch(s => s.replace(
      "if(b) b.style.display = waStartTpls.length ? '' : 'none';",
      "if(b) b.style.display = '';"))
  });
  ok(await shown(p, 'wa-newchat-btn'), '(د) زرار ظاهر بلا قوالب → فحص 1 وقع زي ما المفروض');
  await p.context().close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
