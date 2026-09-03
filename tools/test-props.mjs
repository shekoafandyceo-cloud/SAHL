// خصائص المنتج من الويبهوك (`manufacturer_note`) — عرض بس
//
// السياق: n8n بقى يكتب كل الـprops في `manufacturer_note` («أبيض 4 أدوار»)
// و`var` فيه أول prop بس. العمود كان **مكتوب ومحدش بيقراه** — صفر إشارة
// في الفرونت كله. وقرار المالك (30 أغسطس): عرض بس ·
// `manufacturer_cost` مش بتدخل حساب الأرباح.
//
// اللي بيتفحص:
//   1) الشارة في الجدول بتعرض الـprops كاملة مش أول واحد بس
//   2) fallback على `var` للأوردرات القديمة (آلاف الأوردرات قبل 29 أغسطس)
//   3) نافذة التفاصيل: سطر «خصائص المنتج» واحد — مش سطرين مكررين
//   4) 🔴 الحارس: `manufacturer_cost` **مالهاش أي أثر** على تكلفة البضاعة —
//      نفس الأوردر بتكلفة مصنّع ومن غيرها لازم يدّي نفس الرقم بالظبط
//   5) الموظف مايشوفش تكلفة المصنّع (زي سعر الجملة)
//   6) معايرات: (أ) شيل manufacturer_note من ORDER_LIST_COLS → الشارة ترجع
//      لأول prop بس (درس 33 — قطع الأعمدة) · (ب) ضمّ manufacturer_cost
//      لمرشّحات التكلفة → حارس الأرباح يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

// o1: props كاملة + تكلفة مصنّع · o2: قديم (var بس) · o3: مفيش خصائص خالص
const PROPS = {
  o1: { 'var':'أبيض', manufacturer_note:'أبيض 4 أدوار', manufacturer_cost:375 },
  o2: { 'var':'مقاس 85 عرض', manufacturer_note:null, manufacturer_cost:null },
  o3: { 'var':null, manufacturer_note:null, manufacturer_cost:null }
};

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

async function openApp(opts){
  opts = opts || {};
  const p = await b.newPage({ viewport:{ width:1440, height:900 } });
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.addInitScript(`
    window.__PROPS = ${JSON.stringify(opts.props || PROPS)};
    ${opts.role ? `window.__ROLE = '${opts.role}';` : ''}
  `);
  await p.addInitScript(STUB);
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return p;
}

const badgeOf = (p, id) => p.evaluate((oid) => {
  const tr = document.querySelector('#tbody tr[data-id="'+oid+'"]');
  const b = tr && tr.querySelector('.var-badge');
  return b ? { txt: b.textContent.trim(), title: b.getAttribute('title') || '' } : null;
}, id);

async function openDetailOf(p, id){
  await p.evaluate((oid) => {
    const tr = document.querySelector('#tbody tr[data-id="'+oid+'"]');
    if(tr) tr.click();
  }, id);
  await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
  await p.waitForTimeout(250);
}

const rowsOf = (p) => p.evaluate(() =>
  [...document.querySelectorAll('#dcnt .drow')].map(r => ({
    k: (r.querySelector('.dkey') || {}).textContent || '',
    v: (r.querySelector('.dval') || {}).textContent || r.textContent
  })));

// ════ 1) الجدول ════
{
  const p = await openApp();
  console.log('──── شارة الجدول ────');
  const b1 = await badgeOf(p, 'o1');
  ok(b1 && b1.txt === 'أبيض 4 أدوار',
     `o1: الشارة بتعرض الـprops كاملة — «${b1 && b1.txt}»`);
  ok(b1 && b1.title.indexOf('أبيض 4 أدوار') >= 0 && b1.title.indexOf('خصائص المنتج') >= 0,
     `والتلميح بالنص الكامل — «${b1 && b1.title}»`);
  const b2 = await badgeOf(p, 'o2');
  ok(b2 && b2.txt === 'مقاس 85 عرض',
     `o2 (أوردر قديم بلا manufacturer_note): fallback على var — «${b2 && b2.txt}»`);
  const b3 = await badgeOf(p, 'o3');
  ok(b3 === null, 'o3 (مفيش خصائص): مفيش شارة فاضية');

  // ════ 3) نافذة التفاصيل ════
  console.log('──── نافذة التفاصيل ────');
  await openDetailOf(p, 'o1');
  let rows = await rowsOf(p);
  const propRows = rows.filter(r => r.k.indexOf('خصائص المنتج') >= 0);
  ok(propRows.length === 1, `سطر خصائص واحد بس مش مكرر — ${propRows.length}`);
  ok(propRows[0] && propRows[0].v.indexOf('أبيض 4 أدوار') >= 0,
     `وفيه الـprops كاملة — «${propRows[0] && propRows[0].v.trim()}»`);
  ok(!rows.some(r => r.k.indexOf('اللون / المقاس') >= 0),
     'والسطر القديم «اللون / المقاس» (أول prop بس) اتشال — مفيش تكرار');

  // ════ 4) 🔴 الحارس: تكلفة المصنّع مالهاش أثر على الأرباح ════
  console.log('──── حارس الأرباح ────');
  const mfRow = rows.filter(r => r.k.indexOf('تكلفة المصنّع') >= 0);
  ok(mfRow.length === 1, 'تكلفة المصنّع ظاهرة للأدمن');
  ok(mfRow[0] && /مش داخلة في الأرباح/.test(mfRow[0].k),
     'والتسمية بتقول صراحةً إنها مش داخلة في الأرباح');

  // نفس الأوردر: بتكلفة مصنّع vs من غيرها — تكلفة البضاعة لازم تبقى واحدة
  const costWith = await p.evaluate(async () => {
    const m = await import('./js/orders/costs.js');
    const st = await import('./js/orders/state.js');
    const o = (st.fil || []).filter(x => x.id === 'o1')[0];
    return m.orderInventoryCost(Object.assign({}, o, { manufacturer_cost: 375 }));
  });
  const costWithout = await p.evaluate(async () => {
    const m = await import('./js/orders/costs.js');
    const st = await import('./js/orders/state.js');
    const o = (st.fil || []).filter(x => x.id === 'o1')[0];
    return m.orderInventoryCost(Object.assign({}, o, { manufacturer_cost: null }));
  });
  const costHuge = await p.evaluate(async () => {
    const m = await import('./js/orders/costs.js');
    const st = await import('./js/orders/state.js');
    const o = (st.fil || []).filter(x => x.id === 'o1')[0];
    return m.orderInventoryCost(Object.assign({}, o, { manufacturer_cost: 999999 }));
  });
  ok(costWith === costWithout && costWith === costHuge,
     `تكلفة البضاعة ثابتة مهما كانت تكلفة المصنّع (${costWithout} / ${costWith} / ${costHuge}) — مش داخلة الحساب`);

  // والرقم المرندَر في النافذة هو تكلفة المخزون مش 375
  const shownCost = rows.filter(r => r.k.indexOf('تكلفة البضاعة') >= 0)[0];
  ok(shownCost && shownCost.v.indexOf('375') < 0,
     `و«تكلفة البضاعة» المعروضة مش 375 — «${shownCost && shownCost.v.trim()}»`);
  await p.close();
}

// ════ 4ب) زرار «نسخ كل المنتجات» ════
// الباج (3 سبتمبر — بلاغ المالك): الزرار كان بيقرا `sel['var']` (أول prop بس)
// فالمنسوخ كان «تيربو بريمو 5 دور (عدد 1) - 4 أدوار» بدل «… - 4 أدوار مدور».
// v33 وحّدت عرض الخصائص في الجدول والتفاصيل **وفاتها مسار النسخ**.
{
  const p = await openApp();
  console.log('──── نسخ كل المنتجات ────');

  // التقاط النص المنسوخ بدل الكليبورد الحقيقي
  const armClipboard = () => p.evaluate(() => {
    window.__COPIED = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: function(t){ window.__COPIED.push(t); return Promise.resolve(); } }
    });
  });

  async function copyFrom(orderId){
    await openDetailOf(p, orderId);
    await armClipboard();
    await p.$eval('#copy-prod', el => el.scrollIntoView({ block:'center' }));
    await p.waitForTimeout(120);
    // درس 35: ضغطة حقيقية + hit-test — مش el.click()
    const hit = await p.evaluate(() => {
      const b = document.getElementById('copy-prod');
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return !!(el && (el === b || b.contains(el) || el.contains(b)));
    });
    await p.click('#copy-prod');
    await p.waitForTimeout(200);
    const copied = await p.evaluate(() => (window.__COPIED || [])[0] || '');
    await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); });
    return { hit, copied };
  }

  const r1 = await copyFrom('o1');
  ok(r1.hit, 'hit-test: زرار النسخ مش مدفون تحت أي حاجة');
  ok(r1.copied.indexOf('أبيض 4 أدوار') >= 0,
     `المنسوخ فيه الخصائص كاملة — «${r1.copied}»`);
  ok(!/- أبيض$/.test(r1.copied) && !/- أبيض /.test(r1.copied.replace('أبيض 4 أدوار','')),
     'ومش بيقطعها عند أول prop');
  ok(r1.copied.indexOf('(عدد 1)') >= 0, 'والكمية زي ما هي في الفورمات');

  // o2: أوردر قديم بلا manufacturer_note → لازم يقع على var
  const r2 = await copyFrom('o2');
  ok(r2.copied.indexOf('مقاس 85 عرض') >= 0,
     `أوردر قديم: fallback على var شغال — «${r2.copied}»`);

  // o3: مفيش خصائص خالص → الاسم من غير أي لاحقة
  const r3 = await copyFrom('o3');
  ok(r3.copied.length > 0 && r3.copied.indexOf(' - ') < 0,
     `مفيش خصائص = مفيش فاصل معلّق — «${r3.copied}»`);
  await p.close();
}

// ════ 5) الموظف ════
{
  const p = await openApp({ role:'employee' });
  console.log('──── الموظف ────');
  await openDetailOf(p, 'o1');
  const rows = await rowsOf(p);
  ok(rows.some(r => r.k.indexOf('خصائص المنتج') >= 0), 'الموظف بيشوف خصائص المنتج');
  ok(!rows.some(r => r.k.indexOf('تكلفة المصنّع') >= 0), 'ومايشوفش تكلفة المصنّع');
  ok(!rows.some(r => r.k.indexOf('تكلفة البضاعة') >= 0), 'ولا تكلفة البضاعة (زي ما كان)');
  await p.close();
}

// ════ 6أ) معايرة: العمود اتشال من ORDER_LIST_COLS (درس 33) ════
console.log('──── معايرات ────');
{
  const p = await b.newPage({ viewport:{ width:1440, height:900 } });
  await p.addInitScript(`window.__PROPS = ${JSON.stringify(PROPS)};`);
  await p.addInitScript(STUB);
  // الستب بيقطع الأعمدة زي PostgREST — بنشيل العمود من الطلب نفسه
  await p.route('**/js/orders/orders.js', async r => {
    const res = await r.fetch();
    let body = await res.text();
    body = body.replace(',manufacturer_note,has_upsell', ',has_upsell');
    await r.fulfill({ response: res, body });
  });
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  const b1 = await badgeOf(p, 'o1');
  ok(b1 && b1.txt === 'أبيض',
     `معايرة أ: من غير العمود في الـselect الشارة بترجع لأول prop بس («${b1 && b1.txt}») — فحص 1 كان هيقع`);
  await p.close();
}

// ════ 6ب) معايرة: ضمّ manufacturer_cost لمرشّحات التكلفة ════
{
  const p = await b.newPage({ viewport:{ width:1440, height:900 } });
  await p.addInitScript(`window.__PROPS = ${JSON.stringify(PROPS)};`);
  await p.addInitScript(STUB);
  await p.route('**/js/orders/costs.js', async r => {
    const res = await r.fetch();
    let body = await res.text();
    body = body.replace('o.products_cost_snapshot', 'o.products_cost_snapshot,\n    o.manufacturer_cost');
    await r.fulfill({ response: res, body });
  });
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  const drift = await p.evaluate(async () => {
    const m = await import('./js/orders/costs.js');
    const st = await import('./js/orders/state.js');
    const o = (st.fil || []).filter(x => x.id === 'o1')[0];
    return [
      m.orderInventoryCost(Object.assign({}, o, { manufacturer_cost: null })),
      m.orderInventoryCost(Object.assign({}, o, { manufacturer_cost: 999999 }))
    ];
  });
  ok(drift[0] !== drift[1],
     `معايرة ب: لو manufacturer_cost اتضمّت للتكلفة الرقم بينحرف (${drift[0]} → ${drift[1]}) — حارس الأرباح بيمسكها`);
  await p.close();
}

// ════ 6ج) معايرة: رجوع زرار النسخ لـsel['var'] (الباج الأصلي بالحرف) ════
{
  const p = await b.newPage({ viewport:{ width:1440, height:900 } });
  await p.addInitScript(`window.__PROPS = ${JSON.stringify(PROPS)};`);
  await p.addInitScript(STUB);
  await p.route('**/js/orders/detail.js', async r => {
    const res = await r.fetch();
    let body = await res.text();
    body = body.replace(
      'var v=orderProps(sel);',
      "var v=(sel['var']&&String(sel['var']).trim())?String(sel['var']).trim():'';");
    await r.fulfill({ response: res, body });
  });
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  await openDetailOf(p, 'o1');
  await p.evaluate(() => {
    window.__COPIED = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: function(t){ window.__COPIED.push(t); return Promise.resolve(); } }
    });
  });
  await p.$eval('#copy-prod', el => el.scrollIntoView({ block:'center' }));
  await p.click('#copy-prod');
  await p.waitForTimeout(200);
  const copied = await p.evaluate(() => (window.__COPIED || [])[0] || '');
  ok(copied.indexOf('أبيض 4 أدوار') < 0 && copied.indexOf('أبيض') >= 0,
     `معايرة ج: برجوع sel['var'] المنسوخ بيتقطع عند أول prop («${copied}») — الفحص بيمسكه`);
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
