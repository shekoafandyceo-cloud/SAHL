// رسالة متابعة الأوردر بقالب معتمد (طلب المالك 7 سبتمبر)
//
// السياق: زرار «إرسال رسالة واتساب للعميل» كان بيفتح `web.whatsapp.com` على
// **جهاز الموظف** — الرسالة بتخرج من رقمه الشخصي وده اللي بياخد Ban. القالب
// (`order_shipping_confirm_ar`، utility) بيخلي الإرسال من رقم الـAPI بتاع
// المتجر عبر Edge Function `wa-followup`.
//
// 🔴 أهم فحصين هنا:
//   • **الاستبدال** (فحص 2): لما القالب يبقى مظبوط، اللينك الشخصي لازم
//     **يختفي**. لو الاتنين ظهروا، الموظف هيدوس على اللي اتعوّد عليه ويرجع
//     يبعت من موبايله — والميزة كلها اتعملت تمنع ده بالظبط.
//   • **الحمولة** (فحص 8): الفرونت بيبعت `order_id` **بس**. لو بعت نص الرسالة
//     أو الاسم أو رقم الطلب، أي موظف يقدر يبعت أي كلام لأي عميل **بره نافذة
//     الـ24 ساعة** تحت غطا قالب موافق عليه — وده بيحرق الـWABA بتاع التاجر.
//     نفس ثابت `wa-send` و`tenant-staff`: الهوية والبيانات من السيرفر.
//
// اللي بيتفحص:
//   1) قالب مظبوط → زرار المتابعة ظاهر
//   2) 🔴 واللينك الشخصي (`web.whatsapp.com`) **اختفى**
//   3) مفيش قالب → اللينك القديم زي ما هو وزرار المتابعة مش موجود
//      (Trendose والـ5 التانيين — ميزة ناقصة أحسن من زرار بيرمي خطأ)
//   4) الزرار مش مدفون — `elementFromPoint` + ضغطة Playwright حقيقية (درس 31/35)
//   5) المودال بيعرض النص **مرسوم**: الاسم ورقم الطلب والمنتج متعوّضين
//   6) ومفيش أي `{{n}}` فاضل
//   7) والسطور بتبان فعلاً (`white-space` مش `normal`) — المعاينة كلها سطر
//      واحد ملزوق = الموظف مش قاريها
//   8) 🔴 التأكيد بيبعت `order_id` بس لـ`wa-followup`
//   9) النجاح: علامة «اتبعتت متابعة» بتظهر في النافذة
//  10) `too_soon` → رسالة مفهومة مش «حصلت مشكلة»
//  11) `template_failed` → **سبب ميتا الحقيقي** بيتعرض (القالب لسه تحت المراجعة)
//  12) اتبعتت قبل كده → المودال بيحذّر قبل ما يبعت تاني
//  13) معايرة أ: خلي الزرارين يظهروا مع بعض → فحص 2 يقع
//  14) معايرة ب: اعرض نص القالب خام من غير تعويض → فحص 5/6 يقع
//  15) معايرة ج: ضيف نص الرسالة للحمولة → فحص 8 يقع
//  16) معايرة د: شيل `white-space:pre-line` → فحص 7 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

// نص القالب زي ما هو متخزن في `tenants.wa_followup_body` — بمتغيراته
const BODY = 'أهلاً {{1}}، بخصوص طلبك رقم {{2}}.\n\n'
  + 'حاولنا نتصل بحضرتك عشان نأكد شحن الطلب ومقدرناش نوصلك.\n\n'
  + 'الطلب: {{3}}\n\n'
  + 'ردّ على الرسالة دي لو تحب نشحن الطلب أو تلغيه، وهنكمّل على طول.';

const TPL_ON = { wa_followup_template: 'order_shipping_confirm_ar',
                 wa_followup_lang: 'ar_EG', wa_followup_body: BODY };

async function open(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (opts.pre) await ctx.addInitScript(opts.pre);
  await ctx.addInitScript(STUB);
  await ctx.addInitScript(`
    window.__TENANT = ${JSON.stringify(opts.tenant === null ? null : (opts.tenant || TPL_ON))};
    window.__FN = function(slug, body){
      window.__LAST = { slug: slug, body: body };
      return ${opts.fn || 'null'} || { ok:true, sent_at:new Date().toISOString(), message_id:'wamid-F1' };
    };
    // 🔴 تعديل الأوردر **قبل** التحميل: الستب بيقرا الصفوف وقت الاستعلام،
    // والاستعلامات بتخرج مع تنفيذ موديولات ES — أي تعديل بعد التحميل بيوصل متأخر
    // (نفس فخ الحقن على DOMContentLoaded الموثّق في CLAUDE.md).
    (function(){
      var patch = ${JSON.stringify(opts.order || {})};
      var o = (window.__ORDERS || []).filter(function(x){ return x.id === 'o3'; })[0];
      if(o) for(var k in patch) o[k] = patch[k];
    })();
  `);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ⚠ خطأ في الصفحة:', e.message); bad++; });
  await p.goto(ORIGIN + '/orders', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-orders', { state: 'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return { ctx, p };
}

// الفتح بضغطة صف **حقيقية** زي الموظف — مش نداء openDetail من الكونسول
async function openOrder(p, id) {
  await p.click('#tbody tr[data-id="' + id + '"]');
  await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
  await p.waitForTimeout(200);
}

// ═══════════ 1–2: القالب مظبوط ═══════════
console.log('──── القالب مظبوط ────');
{
  // اسم ومنتج واضحين عشان التعويض يبقى مرصود
  const { ctx, p } = await open({ order: {
    customer_name: 'صابرين محمد', order_uid: '16524',
    product_name: 'تيربو بريمو 5 دور (عدد 1)'
  } });
  await openOrder(p, 'o3');

  const r = await p.evaluate(() => ({
    hasBtn: !!document.getElementById('wa-follow-btn'),
    hasOldLink: !!document.querySelector('#dcnt a[href*="web.whatsapp.com"]'),
    label: (document.getElementById('wa-follow-btn') || {}).textContent || ''
  }));
  ok(r.hasBtn, 'زرار «إرسال رسالة متابعة للعميل» ظاهر');
  ok(!r.hasOldLink, '🔴 واللينك الشخصي (web.whatsapp.com) اختفى — الموظف مالوش طريق يبعت من موبايله');

  // ═══════════ 4: مش مدفون ═══════════
  const hit = await p.evaluate(() => {
    const el = document.getElementById('wa-follow-btn');
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { same: el === top || el.contains(top), got: top ? (top.id || top.className) : 'null' };
  });
  ok(hit.same, 'الزرار مش مدفون تحت أي طبقة — ' + hit.got);
  await p.click('#wa-follow-btn');                 // ضغطة hit-tested حقيقية
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible', timeout: 4000 });

  // ═══════════ 5–7: المعاينة ═══════════
  const pv = await p.evaluate(() => {
    const s = document.getElementById('cmodal-sub');
    return { txt: s.textContent, ws: getComputedStyle(s).whiteSpace };
  });
  ok(pv.txt.includes('صابرين') && pv.txt.includes('16524') && pv.txt.includes('تيربو بريمو 5 دور'),
     'المعاينة بتعرض النص **مرسوم** — الاسم ورقم الطلب والمنتج');
  ok(!/\{\{\d+\}\}/.test(pv.txt), 'ومفيش أي {{n}} فاضل في اللي الموظف بيوافق عليه');
  ok(pv.ws === 'pre-line' || pv.ws.startsWith('pre'),
     'وسطور الرسالة بتبان فعلاً — white-space=' + pv.ws);

  // ═══════════ 8: الحمولة ═══════════
  await p.click('#cmodal-ok');
  await p.waitForFunction(() => window.__LAST, { timeout: 4000 });
  const call = await p.evaluate(() => window.__LAST);
  ok(call.slug === 'wa-followup', 'التأكيد بينده wa-followup');
  const keys = Object.keys(call.body || {});
  ok(keys.length === 1 && keys[0] === 'order_id' && call.body.order_id === 'o3',
     '🔴 الحمولة `order_id` **بس** — مفيش نص ولا اسم ولا رقم طلب: ' + JSON.stringify(call.body));

  // ═══════════ 9: العلامة ═══════════
  await p.waitForFunction(() => (document.getElementById('dcnt') || {}).textContent
    && document.getElementById('dcnt').textContent.indexOf('اتبعتت متابعة') >= 0, { timeout: 5000 })
    .catch(() => {});
  const note = await p.evaluate(() => ({
    shown: !!document.querySelector('.wa-sent-note'),
    row: (window.__ORDERS.filter(x => x.id === 'o3')[0] || {}).wa_followup_sent_at || null
  }));
  ok(note.shown, 'بعد النجاح: علامة «اتبعتت متابعة» ظهرت في النافذة');
  await ctx.close();
}

// ═══════════ 3: من غير قالب ═══════════
console.log('──── تاجر من غير قالب ────');
{
  const { ctx, p } = await open({ tenant: { wa_followup_template: null, wa_followup_body: null } });
  await openOrder(p, 'o3');
  const r = await p.evaluate(() => ({
    hasBtn: !!document.getElementById('wa-follow-btn'),
    hasOldLink: !!document.querySelector('#dcnt a[href*="web.whatsapp.com"]')
  }));
  ok(!r.hasBtn, 'مفيش قالب → زرار المتابعة مش موجود');
  ok(r.hasOldLink, 'واللينك القديم شغّال زي ما هو — مفيش تاجر بيخسر الزرار');
  await ctx.close();
}

// ═══════════ 10–11: الأخطاء ═══════════
console.log('──── رسايل الفشل ────');
{
  const { ctx, p } = await open({ fn: `{ ok:false, error:'too_soon' }` });
  await openOrder(p, 'o3');
  await p.click('#wa-follow-btn');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  await p.click('#cmodal-ok');
  await p.waitForSelector('.toast', { timeout: 4000 });
  const t = await p.evaluate(() => document.querySelector('.toast').textContent);
  ok(/استنى شوية/.test(t), 'too_soon → «اتبعتت من ثواني — استنى شوية» مش رسالة عامة');
  await ctx.close();
}
{
  const { ctx, p } = await open({
    fn: `{ ok:false, error:'template_failed', detail:'Template name does not exist in the translation' }`
  });
  await openOrder(p, 'o3');
  await p.click('#wa-follow-btn');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  await p.click('#cmodal-ok');
  await p.waitForSelector('.toast', { timeout: 4000 });
  const t = await p.evaluate(() => document.querySelector('.toast').textContent);
  ok(/does not exist/.test(t),
     '🔴 template_failed → سبب ميتا الحقيقي ظاهر (القالب لسه تحت المراجعة مثلاً) — ' + t.slice(0, 60));
  await ctx.close();
}

// ═══════════ 12: اتبعتت قبل كده ═══════════
console.log('──── تحذير التكرار ────');
{
  const { ctx, p } = await open({
    order: { wa_followup_sent_at: new Date(Date.now() - 3600e3).toISOString() } });
  await openOrder(p, 'o3');
  const noteShown = await p.evaluate(() => !!document.querySelector('.wa-sent-note'));
  ok(noteShown, 'الأوردر اللي اتبعتله قبل كده بيبان عليه في النافذة');
  await p.click('#wa-follow-btn');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  const sub = await p.evaluate(() => document.getElementById('cmodal-sub').textContent);
  ok(/اتبعتله متابعة قبل كده/.test(sub), 'والمودال بيحذّر قبل ما يبعت تاني — الرسالة بفلوس');
  await ctx.close();
}

// ═══════════ 13–16: المعايرات ═══════════
console.log('──── المعايرات ────');

// (أ) الزرارين مع بعض
{
  const { ctx, p } = await open();
  await openOrder(p, 'o3');
  await p.evaluate(() => {
    const btn = document.getElementById('wa-follow-btn');
    const a = document.createElement('a');
    a.className = 'wa-btn'; a.href = 'https://web.whatsapp.com/send?phone=2010';
    a.textContent = 'إرسال رسالة واتساب للعميل';
    btn.parentNode.insertBefore(a, btn);
  });
  const both = await p.evaluate(() => ({
    hasBtn: !!document.getElementById('wa-follow-btn'),
    hasOldLink: !!document.querySelector('#dcnt a[href*="web.whatsapp.com"]')
  }));
  ok(both.hasBtn && both.hasOldLink,
     'معايرة أ: بالزرارين مع بعض — فحص 2 (اللينك اختفى) بيقع');
  await ctx.close();
}

// (ب) نص خام من غير تعويض
{
  const { ctx, p } = await open();
  await openOrder(p, 'o3');
  const raw = await p.evaluate(async () => {
    const m = await import('/js/orders/detail.js');
    const st = await import('/js/orders/state.js');
    // نفس مدخل الدالة، بس من غير التعويض — ده شكل الباج
    const auth = await import('/js/auth/auth.js');
    return { rendered: m.waFollowupPreview(st.sel), rawBody: auth.currentTenant.wa_followup_body };
  });
  ok(/\{\{\d+\}\}/.test(raw.rawBody) && !/\{\{\d+\}\}/.test(raw.rendered),
     'معايرة ب: النص الخام فيه {{n}} والمرسوم مفهوش — فحص 6 بيمسك أي رجوع للخام');
  await ctx.close();
}

// (ج) حمولة فيها نص الرسالة
{
  const { ctx, p } = await open();
  await openOrder(p, 'o3');
  const leak = await p.evaluate(async () => {
    const sbm = await import('/js/core/supabase.js');
    // شكل الباج: الفرونت يبعت النص — الحمولة بتبقى أكتر من مفتاح
    await sbm.sb.functions.invoke('wa-followup', { body: { order_id: 'o3', text: 'أي كلام' } });
    return window.__LAST.body;
  });
  const keys = Object.keys(leak);
  ok(keys.length > 1,
     'معايرة ج: حمولة فيها نص → مفاتيح ' + JSON.stringify(keys) + ' — فحص 8 بيقع');
  await ctx.close();
}

// (د) من غير pre-line
{
  const { ctx, p } = await open();
  await openOrder(p, 'o3');
  await p.click('#wa-follow-btn');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  const collapsed = await p.evaluate(() => {
    const s = document.getElementById('cmodal-sub');
    const before = s.getBoundingClientRect().height;
    s.style.whiteSpace = 'normal';               // شكل الباج بالحرف
    const after = s.getBoundingClientRect().height;
    return { ws: getComputedStyle(s).whiteSpace, before: before, after: after };
  });
  ok(collapsed.ws === 'normal' && collapsed.after < collapsed.before,
     'معايرة د: من غير pre-line المعاينة بتتلم (' + Math.round(collapsed.before) + 'px → '
     + Math.round(collapsed.after) + 'px) — فحص 7 بيمسكها');
  await ctx.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
