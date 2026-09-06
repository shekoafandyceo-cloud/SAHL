// لينك مستقل لكل قسم (/orders · /inventory · /chats …)
//
// المبدأ: `showPage` هي نقطة الاختناق الوحيدة للتنقل، فالـURL بيتحدّث من
// جوّاها بس. الراوتر في `core/router.js` ومعاه `app/_redirects` للـPages.
//
// اللي بيتفحص:
//   1) فتح لينك مباشر لكل قسم → الصفحة الصح ظاهرة وزرار القايمة متعلّم
//   2) الضغط على القايمة (ضغطة حقيقية hit-tested) بيغيّر الـURL
//   3) زرار الرجوع في المتصفح بيرجّع للقسم اللي فات
//   4) مسار مش معروف → الأوردرات، **واللينك بيتصحّح** مش بيفضل غلط
//   5) 🔴 الموظف بيفتح /finance → بيتحوّل للأوردرات **واللينك بيتصحّح كمان**
//      (لينك بيقول finance وإحنا في orders = لينك بيكدب)
//   6) الأصول (css/js) بتتحمّل من لينك عميق — صفر 404
//   7) الجولة مابتلوّثش تاريخ المتصفح
//   8) معايرات: (أ) تعطيل syncUrl → الفحوص بتقع · (ب) شيل تصحيح الحارس →
//      اللينك بيكدب على الموظف
//   9) استضافة من غير دعم → اللينك مايتلمسش (+ ضابط)
//  10) عنوان التاب لكل قسم — وبيتصحّح مع حارس الأدمن زي اللينك
//  11) 🔴 المحادثات بتفتح في تاب لوحدها، و**نفس التاب** لو اتفتحت تاني
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8901';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

async function open(path, opts) {
  opts = opts || {};
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], bad404 = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('response', r => { if (r.status() >= 400) bad404.push(r.status() + ' ' + r.url()); });
  if (opts.role) await p.addInitScript(`window.__ROLE = '${opts.role}';`);
  if (opts.pre) await p.addInitScript(opts.pre);
  await p.addInitScript(STUB);
  if (opts.route) await p.route('**/js/core/router.js', opts.route);
  if (opts.routeMain) await p.route('**/js/main.js', opts.routeMain);
  await p.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  await p.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await p.waitForTimeout(400);
  p.__errs = errs; p.__404 = bad404;
  return p;
}

const visiblePage = (p) => p.evaluate(() =>
  ['orders', 'stock', 'inbox', 'finance', 'analytics', 'billing', 'settings', 'mycommission']
    .filter(n => { const el = document.getElementById('page-' + n); return el && getComputedStyle(el).display !== 'none'; }));

const activeNav = (p) => p.evaluate(() => {
  const a = document.querySelector('.tnav-btn.active');
  return a ? a.getAttribute('data-page') : null;
});

const urlPath = (p) => p.evaluate(() => location.pathname);

// ════ 1) لينك مباشر لكل قسم ════
{
  console.log('──── فتح لينك مباشر ────');
  const CASES = [
    ['/orders', 'orders'], ['/inventory', 'stock'], ['/chats', 'inbox'],
    ['/finance', 'finance'], ['/analytics', 'analytics'],
    ['/billing', 'billing'], ['/settings', 'settings']
  ];
  for (const [path, page] of CASES) {
    const p = await open(path);
    const vis = await visiblePage(p);
    const nav = await activeNav(p);
    ok(vis.length === 1 && vis[0] === page && nav === page,
      `${path} → صفحة «${page}» ظاهرة لوحدها والزرار متعلّم — ${JSON.stringify(vis)} / ${nav}`);
    if (path === '/chats') {
      ok(p.__404.length === 0, `والأصول اتحمّلت من لينك عميق — ${p.__404.length ? p.__404[0] : 'صفر 404'}`);
      ok(p.__errs.length === 0, `وصفر أخطاء جافاسكربت — ${p.__errs[0] || 'نضيف'}`);
    }
    await p.close();
  }
}

// ════ 2+3) التنقل بالقايمة وزرار الرجوع ════
{
  console.log('──── التنقل والرجوع ────');
  const p = await open('/orders');

  // ضغطة حقيقية hit-tested (درس 35)
  const hit = await p.evaluate(() => {
    const el = document.getElementById('nav-stock');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(at && (at === el || el.contains(at)));
  });
  ok(hit, 'hit-test: زرار المخزون في القايمة مش مدفون');

  await p.click('#nav-stock');
  await p.waitForTimeout(350);
  ok(await urlPath(p) === '/inventory', `الضغط على المخزون غيّر اللينك — ${await urlPath(p)}`);
  ok((await visiblePage(p))[0] === 'stock', 'والصفحة اتبدّلت فعلاً');

  await p.click('#nav-inbox');
  await p.waitForTimeout(350);
  ok(await urlPath(p) === '/chats', `والمحادثات — ${await urlPath(p)}`);

  await p.goBack();
  await p.waitForTimeout(400);
  ok(await urlPath(p) === '/inventory' && (await visiblePage(p))[0] === 'stock',
    `زرار الرجوع رجّع للمخزون — ${await urlPath(p)} / ${(await visiblePage(p))[0]}`);

  await p.goBack();
  await p.waitForTimeout(400);
  ok(await urlPath(p) === '/orders' && (await visiblePage(p))[0] === 'orders',
    `ورجعة تانية للأوردرات — ${await urlPath(p)}`);
  await p.close();
}

// ════ 4) مسار مش معروف ════
{
  console.log('──── مسار غلط ────');
  const p = await open('/kalam-fady');
  ok((await visiblePage(p))[0] === 'orders', 'مسار مش معروف بيفتح الأوردرات');
  ok(await urlPath(p) === '/orders', `واللينك اتصحّح — ${await urlPath(p)}`);
  await p.close();
}

// ════ 5) 🔴 الموظف على قسم للأدمن ════
{
  console.log('──── حارس الأدمن ────');
  const p = await open('/finance', { role: 'employee' });
  ok((await visiblePage(p))[0] === 'orders', 'الموظف اتحوّل للأوردرات');
  ok(await urlPath(p) === '/orders',
    `واللينك اتصحّح لـ/orders — مايفضلش بيقول finance وإحنا في orders (${await urlPath(p)})`);
  // ومايبقاش في التاريخ مدخل مرفوض يرجّعه ليه زرار الرجوع في حلقة
  const len = await p.evaluate(() => history.length);
  await p.goBack().catch(() => {});
  await p.waitForTimeout(300);
  ok(await urlPath(p) !== '/finance', `والرجوع مايرجعش لمسار مرفوض — ${await urlPath(p)} (تاريخ ${len})`);
  await p.close();
}

// ════ 7) الجولة مابتلوّثش التاريخ ════
{
  console.log('──── الجولة ────');
  const p = await open('/orders');
  const before = await p.evaluate(() => history.length);
  await p.evaluate(async () => {
    const m = await import('./js/main.js');
    const t = await import('./js/tour/tour.js');
    // الجولة بتنقّل بين الأقسام — لازم تعدّي من غير ما تضيف مداخل تاريخ
    if (t.tourStart) { try { t.tourStart(); } catch (e) {} }
    m.showPage('stock'); m.showPage('finance'); m.showPage('orders');
  });
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => history.length);
  const tourOn = await p.evaluate(async () => (await import('./js/tour/tour.js')).tourActive);
  ok(!tourOn || after === before,
    `الجولة شغالة (${tourOn}) والتاريخ ما زادش — ${before} → ${after}`);
  await p.close();
}

// ════ 8أ) معايرة: تعطيل تحديث الـURL ════
console.log('──── معايرات ────');
{
  const p = await open('/orders', {
    route: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('export function syncUrl(page, replace){',
        'export function syncUrl(page, replace){ if(1) return;');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#nav-stock');
  await p.waitForTimeout(350);
  ok(await urlPath(p) === '/orders',
    `معايرة أ: بتعطيل syncUrl اللينك بيقف على /orders رغم إننا في المخزون — فحص 2 كان هيقع`);
  await p.close();
}

// ════ 8ب) معايرة: شيل تصحيح الحارس (اللينك يكدب على الموظف) ════
{
  const p = await open('/finance', {
    role: 'employee',
    routeMain: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // الشكل الأصلي قبل الإصلاح: push عادي من غير ما يفرّق إن الحارس حوّل
      body = body.replace('syncUrl(page, (opts && opts.replace) || page !== requested);',
        'syncUrl(requested, false);');
      await r.fulfill({ response: res, body });
    }
  });
  ok(await urlPath(p) === '/finance' && (await visiblePage(p))[0] === 'orders',
    `معايرة ب: من غير تصحيح الحارس اللينك بيقول /finance والصفحة أوردرات — فحص 5 بيمسكها`);
  await p.close();
}

// ════ 9) 🔴 استضافة من غير SPA fallback (الـWorker لو _redirects اتجاهلت) ════
// اللوحة **مالهاش حق** تكتب لينك الاستضافة مش عارفة تخدمه — الريفريش عليه
// بيدي 404 وده أسوأ من إن الميزة مش موجودة أصلاً.
{
  console.log('──── استضافة من غير fallback ────');
  const NOFB = process.env.APP_PLAIN || 'http://127.0.0.1:8902';
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(STUB);
  await p.goto(NOFB + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await p.waitForTimeout(900);   // نسيب المجس يخلص

  const before = await p.evaluate(() => location.pathname);
  await p.click('#nav-stock');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => location.pathname);
  const vis = await p.evaluate(() =>
    ['orders','stock'].filter(n => { const el=document.getElementById('page-'+n);
      return el && getComputedStyle(el).display !== 'none'; }));

  ok(after === before,
     `اللينك ما اتغيرش على استضافة مش داعمة — ${before} → ${after}`);
  ok(vis.length === 1 && vis[0] === 'stock',
     `واللوحة اشتغلت عادي والصفحة اتبدّلت — ${JSON.stringify(vis)}`);
  ok(errs.length === 0, `وصفر أخطاء — ${errs[0] || 'نضيف'}`);

  // والدليل إن السبب هو الاستضافة مش عطل عندنا: نفس الكود على سيرفر بيدعم
  // الـfallback بيكتب اللينك (ضابط — درس 21)
  const p2 = await open('/orders');
  await p2.click('#nav-stock');
  await p2.waitForTimeout(400);
  ok(await urlPath(p2) === '/inventory',
     'ضابط: نفس الكود على استضافة داعمة بيكتب اللينك — فالفرق من الاستضافة مش من عطل');
  await p2.close();
  await p.close();
}

// ════ 10) عنوان التاب ════
{
  console.log('──── عنوان التاب ────');
  const T = [['/orders','الطلبات'], ['/inventory','المخزون'], ['/chats','المحادثات'],
             ['/finance','الماليات'], ['/settings','الإعدادات']];
  for (const [path, want] of T) {
    const p = await open(path);
    const t = await p.title();
    ok(t.indexOf(want) === 0, `${path} → التاب اسمها «${want}» — «${t}»`);
    await p.close();
  }

  // بيتغير مع التنقّل مش بس مع أول تحميل
  const p = await open('/orders');
  await p.click('#nav-stock'); await p.waitForTimeout(350);
  ok((await p.title()).indexOf('المخزون') === 0, `والضغط على المخزون غيّر العنوان — «${await p.title()}»`);
  await p.goBack(); await p.waitForTimeout(400);
  ok((await p.title()).indexOf('الطلبات') === 0, `وزرار الرجوع رجّع العنوان — «${await p.title()}»`);
  await p.close();

  // 🔴 نفس منطق اللينك: العنوان بيتحدّث **بعد** الحارس مش قبله
  const pe = await open('/finance', { role: 'employee' });
  ok((await pe.title()).indexOf('الطلبات') === 0,
     `موظف فتح /finance → العنوان «الطلبات» مش «الماليات» — «${await pe.title()}»`);
  await pe.close();
}

// ════ 10ب) معايرة: العنوان قبل الحارس (عنوان بيكدب) ════
{
  const p = await open('/finance', {
    role: 'employee',
    routeMain: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // الشكل الغلط: العنوان من اللي **اتطلب** مش اللي اتعرض
      body = body.replace('setPageTitle(page);', 'setPageTitle(requested);');
      await r.fulfill({ response: res, body });
    }
  });
  ok((await p.title()).indexOf('الماليات') === 0,
     `معايرة ج: بالعنوان قبل الحارس التاب بتقول «الماليات» والصفحة أوردرات — الفحص فوق بيمسكها`);
  await p.close();
}

// ════ 11) 🔴 المحادثات في تاب لوحدها ════
{
  console.log('──── تاب المحادثات ────');
  const p = await open('/orders');

  // الضغطة الأولى: تاب جديدة على /chats
  const [tab1] = await Promise.all([
    p.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
    p.click('#nav-inbox')
  ]);
  await p.waitForTimeout(500);
  ok(!!tab1, 'الضغط على المحادثات فتح تاب جديدة');
  if (tab1) {
    await tab1.waitForLoadState('domcontentloaded').catch(() => {});
    await tab1.waitForTimeout(900);
    ok(tab1.url().endsWith('/chats'), `والتاب الجديدة على /chats — ${tab1.url()}`);
    ok((await tab1.title()).indexOf('المحادثات') === 0, `واسمها «المحادثات» — «${await tab1.title()}»`);
  }
  // 🔴 والتاب الأصلية **ما اتحركتش** — ده بيت القصيد
  ok(await urlPath(p) === '/orders', `والتاب الأصلية فضلت على الأوردرات — ${await urlPath(p)}`);
  ok((await visiblePage(p))[0] === 'orders', 'والصفحة فيها لسه الأوردرات');

  // الضغطة التانية: **نفس** التاب مش تالتة
  const ctx = p.context();
  const before = ctx.pages().length;
  await p.click('#nav-inbox');
  await p.waitForTimeout(1200);
  ok(ctx.pages().length === before,
     `الضغطة التانية ما فتحتش تاب زيادة — ${before} → ${ctx.pages().length}`);

  // وباقي الأقسام في نفس التاب زي ما هي
  await p.click('#nav-stock'); await p.waitForTimeout(350);
  ok(await urlPath(p) === '/inventory' && ctx.pages().length === before,
     'والأقسام التانية لسه بتفتح في نفس التاب');
  await p.close();
  if (tab1) await tab1.close();
}

// ════ 11ب) الرجوع للتنقّل العادي لما التاب مش مضمونة ════
{
  // استضافة مش بتخدم اللينكات → التاب الجديدة كانت هتطلّع 404. المتوقع:
  // تنقّل عادي في نفس التاب — **مش** زرار ميت (درس 16)
  const NOFB = process.env.APP_PLAIN || 'http://127.0.0.1:8902';
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(STUB);
  await p.goto(NOFB + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await p.waitForTimeout(900);
  const n0 = p.context().pages().length;
  const [pop] = await Promise.all([
    p.waitForEvent('popup', { timeout: 2500 }).catch(() => null),
    p.click('#nav-inbox')
  ]);
  await p.waitForTimeout(400);
  ok(!pop && p.context().pages().length === n0, 'استضافة مش داعمة: ما اتفتحتش تاب');
  ok((await visiblePage(p))[0] === 'inbox', 'والمحادثات اتفتحت في نفس التاب — الزرار عمل حاجة');
  await p.close();
}

// ════ 11ج) الموبايل: تنقّل عادي مش تاب جديدة ════
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.addInitScript(STUB);
  await p.goto(ORIGIN + '/orders', { waitUntil: 'networkidle' });
  await p.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await p.waitForTimeout(500);
  const n0 = p.context().pages().length;
  const [pop] = await Promise.all([
    p.waitForEvent('popup', { timeout: 2500 }).catch(() => null),
    p.click('#nav-inbox')
  ]);
  await p.waitForTimeout(400);
  ok(!pop && p.context().pages().length === n0, 'موبايل: ما اتفتحتش تاب جديدة');
  ok((await visiblePage(p))[0] === 'inbox', 'والمحادثات اتفتحت في نفس التاب');
  await p.close();
}

// ════ 11د) معايرة: من غير اسم ثابت للتاب كل ضغطة بتفتح واحدة جديدة ════
{
  const p = await open('/orders', {
    route: async r => {
      const res = await r.fetch();
      let body = await res.text();
      // الشكل الساذج: تاب جديدة كل مرة بدل إعادة استخدام تاب بالاسم
      body = body.replace("var OWN_TAB = { inbox: 'sahl-chats' };",
                          "var OWN_TAB = { inbox: '_blank' };");
      await r.fulfill({ response: res, body });
    }
  });
  const ctx = p.context();
  await p.click('#nav-inbox'); await p.waitForTimeout(900);
  const afterFirst = ctx.pages().length;
  await p.click('#nav-inbox'); await p.waitForTimeout(900);
  ok(ctx.pages().length > afterFirst,
     `معايرة د: بـ_blank الضغطة التانية فتحت تاب تالتة (${afterFirst} → ${ctx.pages().length}) — فحص «نفس التاب» بيمسكها`);
  for (const pg of ctx.pages()) if (pg !== p) await pg.close().catch(() => {});
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
