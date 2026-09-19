// «إنشاء طلب» يدوي من صندوق المحادثات — طلب المالك 16 سبتمبر
//
// «لو العميل طلب أوردر واتساب وكتب بياناته، يكون في إمكانية إنشاء طلب
// يدوي على السيستم بحيث يتسجل الطلب عندنا فعلاً ويدخل الداتابيز كأنه
// طالب عادي.»
//
// 🔴 كل الحراسات الحقيقية على السيرفر في `create_manual_order`
// (SECURITY DEFINER): `tenant_id` من الـJWT · الحالة على السيرفر
// (فورم بتسيب الموظف يختار «مؤكد» = أوردرات مجانية، لأن
// `charge_order_on_status_change` بتعدّي أي أوردر بيدخل لأول مرة بحالة
// محاسَبة من غير خصم) · رقم الطلب `W-n` في نطاق منفصل عن ترقيم اللاندنج
// (`short_id`) عشان أوردر جاي من الويبهوك مايقعش على UNIQUE ويضيع في صمت.
//
// اللي بيتفحص هنا هو **الواجهة**: الحمولة اللي بتخرج والحقول اللي بتتعبّى
// والحالات اللي بتترفض قبل ما توصل الشبكة.
//   1) الزرار موجود في كارت أوردرات العميل + hit-test (درس 31/35)
//   2) 🔴 الفتح بيعبّي الاسم والتليفون من المحادثة — والتليفون **محلي**
//      (`01…`) مش `wa_id` (`20…`)
//   3) الضغط على الزرار مابيطويش الكارت (stopPropagation)
//   4) 🔴 اسم المنتج بيتبعت بصيغة n8n «الاسم (عدد N)» بالحرف
//   5) 🔴 الحمولة **مافيهاش** status ولا order_uid ولا tenant_id
//   6) الرفض المحلي: عنوان قصير · من غير اسم · من غير منتج · إجمالي فاضي
//   7) نجاح: رسالة فيها رقم الطلب + الفورم بتتقفل + كارت الأوردرات بيتحدث
//   8) الرفض من السيرفر بيتقال بسببه (duplicate · bad_phone · …)
//   9) 🔴 تبديل المحادثة بيقفل الفورم — الحقول متعبّية من محادثة قديمة
//  10) قايمة المنتجات جاية من المخزون (الاسم لازم يطابق `stock_products`)
//  11) معايرات:
//      (أ) شيل إقفال تبديل المحادثة → فحص 9 يقع
//      (ب) ابعت status في الحمولة   → فحص 5 يقع
//      (ج) شيل صيغة «(عدد N)»       → فحص 4 يقع
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
    ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null },
  { id: 'c2', tenant_id: TENANT, wa_id: '201099998888', customer_name: 'منى فؤاد',
    customer_phone: '201099998888', last_message_at: iso(5), last_inbound_at: iso(5),
    last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
    labels: null, note: null, ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null,
    ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null }
];

const MSGS = CONVOS.map((c, i) => ({
  id: 'm' + i, tenant_id: TENANT, conversation_id: c.id, direction: 'in', type: 'text',
  body: 'أهلاً', is_read: true, created_at: iso(1), wa_timestamp: iso(1),
  status: null, wa_message_id: 'wamid-' + i
}));

const STOCK = [
  { id: 's1', tenant_id: TENANT, name: 'منظم المطبخ المتكامل', current_qty: 12,
    unit_price: 450, wholesale_price: 300, parent_id: null, variant_label: null, active: true },
  { id: 's2', tenant_id: TENANT, name: 'استاند امريكانا', current_qty: 5,
    unit_price: 700, wholesale_price: 500, parent_id: null, variant_label: null, active: true }
];

async function openChat(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    window.__STOCK     = ${JSON.stringify(STOCK)};
    window.__RPC_RESULT = ${JSON.stringify(opts.rpcResult || { ok: true, order_id: 'o-new-1', order_uid: 'W-1' })};
    window.__RPC_HOOK = function(name, args){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      if(name === 'create_manual_order') return { data: window.__RPC_RESULT, error:null };
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
  await p.click('.wa-conv[data-id="' + (opts.conv || 'c1') + '"]');
  await p.waitForTimeout(450);
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

const formOpen = (p) => p.evaluate(() => {
  const el = document.getElementById('wa-neworder');
  return !!el && getComputedStyle(el).display !== 'none';
});

const fill = (p, vals) => p.evaluate((v) => {
  Object.keys(v).forEach(k => { const e = document.getElementById(k); if (e) e.value = v[k]; });
}, vals);

const rpcCalls = (p) => p.evaluate(() =>
  (window.__calls || []).filter(c => c.rpc === 'create_manual_order').map(c => c.args));

const GOOD = {
  'wa-no-address': 'مدينة نصر شارع عباس العقاد عمارة 12 الدور 3',
  'wa-no-product': 'منظم المطبخ المتكامل',
  'wa-no-qty': '2',
  'wa-no-total': '900',
  'wa-no-city': 'القاهرة',
  'wa-no-var': 'أبيض'
};

// ════════════════ الفتح والتعبئة ════════════════
{
  const p = await openChat();
  console.log('──── الزرار والتعبئة ────');

  ok(await hitTest(p, '#wa-neworder-btn') === 'ظاهر', '1) hit-test: زرار «طلب جديد» مش مدفون');

  await p.click('#wa-neworder-btn');
  await p.waitForTimeout(400);
  ok(await formOpen(p), '1ب) الفورم اتفتحت');

  // 3) الزرار جوّه هيدر بيطوي الكارت — من غير stopPropagation الكارت بيتطوي
  const collapsed = await p.evaluate(() =>
    document.getElementById('wa-orders-body').classList.contains('collapsed'));
  ok(!collapsed, '3) الضغط مابيطويش كارت الأوردرات');

  const v = await p.evaluate(() => ({
    name: document.getElementById('wa-no-name').value,
    phone: document.getElementById('wa-no-phone').value
  }));
  ok(v.name === 'سعاد محمد', `2أ) الاسم اتعبّى من المحادثة: «${v.name}»`);
  // 🔴 `wa_id` = `20…` والأوردرات متخزّنة محلي `01…` (4,051 من 4,076 صف)
  ok(v.phone === '01012345678', `2ب) 🔴 التليفون بالشكل المحلي مش wa_id: «${v.phone}»`);

  // 10) قايمة المنتجات من المخزون
  const opts = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#wa-no-prodlist option')).map(o => o.value));
  ok(opts.length === 2 && opts.indexOf('منظم المطبخ المتكامل') >= 0,
     `10) قايمة المنتجات من المخزون: ${opts.length} منتج`);

  console.log('──── الرفض المحلي ────');
  // عنوان قصير
  await fill(p, Object.assign({}, GOOD, { 'wa-no-address': 'ق' }));
  await p.click('#wa-no-save'); await p.waitForTimeout(250);
  ok((await rpcCalls(p)).length === 0, '6أ) عنوان قصير اترفض قبل الشبكة');

  await fill(p, Object.assign({}, GOOD, { 'wa-no-name': '' }));
  await p.click('#wa-no-save'); await p.waitForTimeout(250);
  ok((await rpcCalls(p)).length === 0, '6ب) من غير اسم اترفض');

  await fill(p, Object.assign({}, GOOD, { 'wa-no-name': 'سعاد', 'wa-no-product': '' }));
  await p.click('#wa-no-save'); await p.waitForTimeout(250);
  ok((await rpcCalls(p)).length === 0, '6ج) من غير منتج اترفض');

  await fill(p, Object.assign({}, GOOD, { 'wa-no-name': 'سعاد', 'wa-no-total': '' }));
  await p.click('#wa-no-save'); await p.waitForTimeout(250);
  ok((await rpcCalls(p)).length === 0, '6د) من غير إجمالي اترفض');

  console.log('──── الحمولة ────');
  await fill(p, Object.assign({}, GOOD, { 'wa-no-name': 'سعاد محمد', 'wa-no-phone': '01012345678' }));
  await p.click('#wa-no-save');
  await p.waitForTimeout(600);

  const calls = await rpcCalls(p);
  ok(calls.length === 1, `4أ) نداء واحد للسيرفر (${calls.length})`);
  const a = calls[0] || {};
  // 🔴 نفس صيغة n8n بالحرف — أي شكل تاني بيكسر `parseProductItems`
  ok(a.p_product_name === 'منظم المطبخ المتكامل (عدد 2)',
     `4ب) 🔴 اسم المنتج بصيغة n8n: «${a.p_product_name}»`);
  ok(a.p_total_cost === 900 && typeof a.p_total_cost === 'number',
     `4ج) الإجمالي رقم مش نص: ${JSON.stringify(a.p_total_cost)}`);
  ok(a.p_var === 'أبيض' && a.p_city === 'القاهرة', '4د) الخاصية والمحافظة اتبعتوا');
  // 🔴 الحقول دي بتتحدد على السيرفر — وجودها في الحمولة معناه إن الموظف
  // يقدر يتحكم فيها (حالة محاسَبة من غير خصم · رقم يتصادم مع اللاندنج ·
  // أوردر في متجر تاني)
  const keys = Object.keys(a);
  ok(keys.indexOf('p_status') < 0 && keys.indexOf('status') < 0,
     '5أ) 🔴 مفيش `status` في الحمولة — السيرفر وحده بيقررها');
  ok(keys.filter(k => /uid/i.test(k)).length === 0,
     '5ب) 🔴 ومفيش `order_uid` — الترقيم على السيرفر بقفل');
  ok(keys.filter(k => /tenant/i.test(k)).length === 0,
     '5ج) 🔴 ومفيش `tenant_id` — من الـJWT');

  ok(!(await formOpen(p)), '7أ) الفورم اتقفلت بعد النجاح');
  const toastTxt = await p.evaluate(() => {
    const t = document.querySelector('.toast, #toast, [class*=toast]');
    return t ? t.textContent : '';
  });
  ok(toastTxt.indexOf('W-1') >= 0, `7ب) الرسالة فيها رقم الطلب: «${toastTxt.trim()}»`);
  // 🔴 الأوردر بقى بينزل **مؤكد** (19 سبتمبر) — والتوست لازم يقول كده،
  // غير كده الموظف بيروح يدوّر عليه تحت فلتر «قيد الانتظار»
  ok(toastTxt.indexOf('مؤكد') >= 0, `7ج) 🔴 والتوست بيقول إنه مؤكد: «${toastTxt.trim()}»`);

  // 🔴 الإنشاء بقى **بيخصم** (الأوردر بينزل في حالة محاسَبة)، فشريط
  // الباقة والرصيد لازم يتحدّثوا — من غير كده الرقم بيفضل قديم،
  // والأخطر إن `is_depleted` مايتحدّثش فالواجهة مش هتقفل عند النفاد
  const walletCalls = await p.evaluate(() =>
    (window.__calls || []).filter(c => c.table === 'wallet_state').length);
  ok(walletCalls >= 2,
     `7د) 🔴 الرصيد اتجاب تاني بعد الإنشاء (${walletCalls} نداء لـwallet_state — واحد وقت التحميل وواحد بعد الحفظ)`);

  await p.close();
}

// ════ 7هـ — نص الفورم بيقول الحقيقة ════
{
  const p = await openChat();
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  const note = await p.evaluate(() => {
    const el = document.querySelector('#wa-neworder .wa-no-note');
    return el ? el.textContent : '';
  });
  // 🔴 النص ده هو الوعد الوحيد اللي الموظف بيقراه قبل ما يحفظ. لو قال
  // «قيد الانتظار» وهو بينزل مؤكد، ده كذب مباشر على الشاشة (درس 24)
  ok(note.indexOf('مؤكد') >= 0 && note.indexOf('قيد الانتظار') < 0,
     `7هـ) 🔴 نص الفورم بيقول «مؤكد» مش «قيد الانتظار»: «${note.trim()}»`);
  await p.close();
}

// ════ 8 — الرفض من السيرفر بيتقال بسببه ════
{
  for (const [err, needle] of [['duplicate', 'نفس الرقم'], ['bad_phone', 'التليفون'],
                               ['short_address', 'العنوان'], ['not_allowed', 'مفعّل']]) {
    const p = await openChat({ rpcResult: { ok: false, error: err } });
    await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
    await fill(p, GOOD);
    await p.click('#wa-no-save'); await p.waitForTimeout(500);
    const t = await p.evaluate(() => {
      const el = document.querySelector('.toast, #toast, [class*=toast]');
      return el ? el.textContent : '';
    });
    ok(t.indexOf(needle) >= 0, `8) رفض «${err}» بيتقال بسببه: «${t.trim()}»`);
    ok(await formOpen(p), `8ب) والفورم فضلت مفتوحة بالبيانات (${err})`);
    await p.close();
  }
}

// ════ 9 — تبديل المحادثة ════
{
  const p = await openChat();
  console.log('──── تبديل المحادثة ────');
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  ok(await formOpen(p), '9أ) الفورم مفتوحة على c1');
  await p.click('.wa-conv[data-id="c2"]');
  await p.waitForTimeout(500);
  ok(!(await formOpen(p)),
     '9ب) 🔴 تبديل المحادثة قفل الفورم — الحقول كانت متعبّية من العميل اللي فات');
  // وبعد إعادة الفتح البيانات بتبقى بتاعة العميل الجديد
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  const v = await p.evaluate(() => ({
    name: document.getElementById('wa-no-name').value,
    phone: document.getElementById('wa-no-phone').value
  }));
  ok(v.name === 'منى فؤاد' && v.phone === '01099998888',
     `9ج) وبيانات العميل الجديد اتعبّت: «${v.name}» / ${v.phone}`);
  await p.close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');

// (أ) شيل إقفال تبديل المحادثة → فحص 9ب لازم يقع
{
  const p = await openChat({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('  waNewOrderClose();\n}', '}');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  await p.click('.wa-conv[data-id="c2"]');
  await p.waitForTimeout(500);
  const stillOpen = await formOpen(p);
  const nm = await p.evaluate(() => document.getElementById('wa-no-name').value);
  ok(stillOpen && nm === 'سعاد محمد',
     `معايرة أ: من غير الإقفال الفورم فضلت مفتوحة باسم «${nm}» على شات منى — فحص 9ب بيمسكها`);
  await p.close();
}

// (ب) ابعت status في الحمولة → فحص 5أ لازم يقع
{
  const p = await openChat({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("    p_var:val('wa-no-var')||null", "    p_var:val('wa-no-var')||null, p_status:'confirmed'");
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  await fill(p, GOOD);
  await p.click('#wa-no-save'); await p.waitForTimeout(600);
  const a = (await rpcCalls(p))[0] || {};
  ok(Object.keys(a).indexOf('p_status') >= 0,
     `معايرة ب: الحمولة بقت فيها p_status=«${a.p_status}» — فحص 5أ بيمسكها`);
  await p.close();
}

// (ج2) شيل `loadWalletState()` بعد النجاح → فحص 7د لازم يقع
{
  const p = await openChat({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // 🔴 السطر نفسه بس — مش سطرين متجاورين (درس 47: معايرة بتستهدف
      // سطرين بتبوظ في صمت أول ما حد يضيف سطر بينهم)
      body = body.replace(/\n\s*loadWalletState\(\);/, '');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  await fill(p, GOOD);
  await p.click('#wa-no-save'); await p.waitForTimeout(700);
  const n = await p.evaluate(() => (window.__calls||[]).filter(c => c.table==='wallet_state').length);
  ok(n < 2, `معايرة ج2: من غير loadWalletState الرصيد فضل قديم (${n} نداء) — فحص 7د بيمسكها`);
  await p.close();
}

// (ج3) رجّع نص «قيد الانتظار» في الفورم → فحص 7هـ لازم يقع
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  await ctx.route('**/chats', async r => {
    const res = await r.fetch();
    let body = await res.text();
    body = body.replace(/الطلب بيتسجّل <b>مؤكد<\/b>[^<]*/,
                        'الطلب بيتسجّل <b>قيد الانتظار</b> ومفيش رسالة تأكيد آلية — ');
    await r.fulfill({ response: res, body });
  });
  const p = await ctx.newPage();
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.click('.wa-conv[data-id="c1"]'); await p.waitForTimeout(450);
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  const note = await p.evaluate(() => {
    const el = document.querySelector('#wa-neworder .wa-no-note');
    return el ? el.textContent : '';
  });
  ok(note.indexOf('قيد الانتظار') >= 0,
     `معايرة ج3: النص رجع يقول «قيد الانتظار» — فحص 7هـ بيمسكها`);
  await p.close();
}

// (ج) شيل صيغة «(عدد N)» → فحص 4ب لازم يقع
{
  const p = await openChat({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("var productName=product+' (عدد '+qty+')';", "var productName=product;");
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-neworder-btn'); await p.waitForTimeout(350);
  await fill(p, GOOD);
  await p.click('#wa-no-save'); await p.waitForTimeout(600);
  const a = (await rpcCalls(p))[0] || {};
  ok(a.p_product_name === 'منظم المطبخ المتكامل',
     `معايرة ج: من غير الصيغة الاسم اتبعت «${a.p_product_name}» — فحص 4ب بيمسكها`);
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
