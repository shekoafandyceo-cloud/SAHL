// اختبار ميزة "اضغط على يوم في الكالندر يفتحه في جدول الطلبات"
// بضغطة Playwright حقيقية (hit-tested) — درس 31: الضغط البرمجي أعمى
// عن طبقات الرسم، فـ el.click() بتنجح حتى لو العنصر مدفون بالكامل.
import { chromium } from 'playwright';
import fs from 'fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');

const results = [];
const ok  = (n, d='') => { results.push(['PASS', n, d]); console.log('  ✓', n, d); };
const bad = (n, d='') => { results.push(['FAIL', n, d]); console.log('  ✗', n, d); };

// النسخة المثبّتة في البيئة — مش اللي بتنزّلها playwright
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport:{width:1440, height:900} });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if(m.type()==='error') errors.push('console: ' + m.text()); });

await page.addInitScript(STUB);
await page.goto(APP, { waitUntil:'networkidle' });

// الدخول بحساب أدمن (عبر الستب) — الجدول لازم يظهر
await page.waitForSelector('#page-orders', { state:'visible', timeout:10000 });
await page.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0, { timeout:10000 });
ok('اللوحة فتحت بدخول أدمن وجدول الأوردرات اترسم');

// ── الانتقال لإحصائيات الأداء ← تبويب كالندر الأيام ──────────────
await page.click('#nav-analytics');
await page.waitForSelector('#page-analytics', { state:'visible' });
await page.click('.stock-tab[data-atab="days"]');
await page.waitForSelector('#dcal .dcal-day', { timeout:10000 });

const DAY1 = await page.evaluate(() => window.__DAY1);
const DAY2 = await page.evaluate(() => window.__DAY2);

// 1) الخلية موجودة ومعلّمة صح
const cell = page.locator(`.dcal-day[data-ymd="${DAY1}"]`);
(await cell.count()) === 1
  ? ok('خلية اليوم موجودة ومعلّمة بـdata-ymd', DAY1)
  : bad('خلية اليوم مش موجودة', DAY1);

const act = await cell.getAttribute('data-act');
act === 'day-open' ? ok('الخلية عليها data-act=day-open') : bad('data-act غلط', String(act));

// 2) الأيام الفاضية/الجاية مش قابلة للضغط (مفيش وعد كاذب)
const falseAffordance = await page.evaluate(() =>
  document.querySelectorAll('.dcal-day.q-none.dcal-clickable, .dcal-day.q-future.dcal-clickable, .dcal-day.q-empty.dcal-clickable').length);
falseAffordance === 0
  ? ok('الأيام الفاضية/الجاية مش قابلة للضغط')
  : bad('فيه أيام فاضية معلّمة كقابلة للضغط', String(falseAffordance));

// 3) 🔴 الدليل الحقيقي إن العنصر شايفه حد — elementFromPoint في نص الخلية
const visible = await page.evaluate((ymd) => {
  const el = document.querySelector(`.dcal-day[data-ymd="${ymd}"]`);
  if(!el) return {err:'no-el'};
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return { self: el.contains(hit) || hit === el, hitTag: hit ? (hit.className||hit.tagName) : null,
           cursor: getComputedStyle(el).cursor, w: Math.round(r.width), h: Math.round(r.height) };
}, DAY1);
visible.self
  ? ok('elementFromPoint في نص الخلية بيرجّعها هي — مفيش حاجة مغطّياها', `${visible.w}×${visible.h}px`)
  : bad('الخلية مغطّاة بعنصر تاني', JSON.stringify(visible));
visible.cursor === 'pointer' ? ok('الـcursor بيقول إنها قابلة للضغط') : bad('cursor مش pointer', String(visible.cursor));

// 4) ضغطة حقيقية (Playwright بيعمل hit-test قبلها)
await page.evaluate(() => { window.__calls.length = 0; });
await cell.click();
await page.waitForTimeout(700);

// 5) اتنقلنا لصفحة الأوردرات فعلاً
const onOrders = await page.evaluate(() =>
  getComputedStyle(document.getElementById('page-orders')).display !== 'none' &&
  getComputedStyle(document.getElementById('page-analytics')).display === 'none');
onOrders ? ok('اتنقلنا لصفحة الطلبات') : bad('مااتنقلناش لصفحة الطلبات');

// 6) شريط المدة بقى "مخصص" باليوم ده في الخانتين
const bar = await page.evaluate(() => ({
  active: (document.querySelector('#orders-period-bar .pseg-btn.active')||{}).getAttribute?.('data-period'),
  from: (document.getElementById('op-from')||{}).value,
  to: (document.getElementById('op-to')||{}).value,
  customShown: document.getElementById('orders-period-custom').classList.contains('show')
}));
bar.active === 'custom' ? ok('زرار «مخصص» بقى نشط') : bad('الزرار النشط غلط', String(bar.active));
(bar.from === DAY1 && bar.to === DAY1)
  ? ok('خانتا التاريخ اتملّوا باليوم المضغوط', `${bar.from} → ${bar.to}`)
  : bad('خانات التاريخ غلط', JSON.stringify(bar));
bar.customShown ? ok('صف التواريخ المخصصة ظاهر') : bad('صف التواريخ متخفي');

// 7) 🔴 الجوهر: الاستعلام اللي خرج للسيرفر بحدود اليوم ده بالظبط
const q = await page.evaluate(() => (window.__calls||[]).filter(c => c.table==='orders' && c.gte && c.lt).pop());
if(!q){ bad('مفيش استعلام أوردرات بحدود تاريخ بعد الضغطة'); }
else {
  const from = new Date(q.gte.val), to = new Date(q.lt.val);
  const p2 = n => String(n).padStart(2,'0');
  const fLocal = `${from.getFullYear()}-${p2(from.getMonth()+1)}-${p2(from.getDate())}`;
  const spanH = Math.round((to - from)/3600000);
  fLocal === DAY1 ? ok('بداية النطاق = نص ليل اليوم المضغوط', fLocal) : bad('بداية النطاق غلط', `${fLocal} ≠ ${DAY1}`);
  (spanH === 24 || spanH === 23 || spanH === 25)
    ? ok('طول النطاق يوم واحد', spanH+'h') : bad('طول النطاق مش يوم', spanH+'h');
}

// 8) الجدول عرض أوردرات اليوم ده بس — والعدد مطابق للي الكالندر عدّه
const shown = await page.evaluate(() => Array.from(document.querySelectorAll('#tbody tr[data-id]')).map(r => r.getAttribute('data-id')));
const expected = await page.evaluate((ymd) => {
  const p2 = n => String(n).padStart(2,'0');
  return window.__ORDERS.filter(o => { const d = new Date(o.created_at);
    return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}` === ymd; }).map(o => o.id);
}, DAY1);
JSON.stringify(shown.slice().sort()) === JSON.stringify(expected.slice().sort())
  ? ok('الجدول عرض أوردرات اليوم ده بالظبط', `${shown.length} أوردر`)
  : bad('أوردرات الجدول مش مطابقة', `ظهر [${shown}] والمتوقع [${expected}]`);

// 9) ضغطة على يوم تاني بتغيّر النطاق (مش بتتعلّق على الأول)
await page.click('#nav-analytics');
await page.waitForSelector('#page-analytics', { state:'visible' });
await page.waitForSelector(`.dcal-day[data-ymd="${DAY2}"]`);
await page.evaluate(() => { window.__calls.length = 0; });
await page.locator(`.dcal-day[data-ymd="${DAY2}"]`).click();
await page.waitForTimeout(700);
const bar2 = await page.evaluate(() => ({ from:document.getElementById('op-from').value, to:document.getElementById('op-to').value }));
(bar2.from === DAY2 && bar2.to === DAY2) ? ok('يوم تاني بيفتح نطاقه هو', DAY2) : bad('اليوم التاني مافتحش صح', JSON.stringify(bar2));

// 10) الموبايل — الخلايا بتضيق، لازم تفضل مضغوطة
await page.setViewportSize({ width:390, height:844 });
await page.click('#nav-analytics');
await page.waitForSelector('#page-analytics', { state:'visible' });
await page.waitForSelector(`.dcal-day[data-ymd="${DAY1}"]`);
const mob = await page.evaluate((ymd) => {
  const el = document.querySelector(`.dcal-day[data-ymd="${ymd}"]`);
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return { self: el.contains(hit) || hit === el, w:Math.round(r.width), h:Math.round(r.height) };
}, DAY1);
mob.self ? ok('على الموبايل الخلية مكشوفة وقابلة للمس', `${mob.w}×${mob.h}px`) : bad('الخلية مغطّاة على الموبايل', JSON.stringify(mob));
await page.evaluate(() => { window.__calls.length = 0; });
await page.locator(`.dcal-day[data-ymd="${DAY1}"]`).click();
await page.waitForTimeout(700);
const mobOk = await page.evaluate(() => document.getElementById('op-from').value);
mobOk === DAY1 ? ok('اللمس على الموبايل بيفتح اليوم', mobOk) : bad('اللمس على الموبايل مااشتغلش', String(mobOk));

// أخطاء الكونسول
const real = errors.filter(e => !/favicon|net::ERR_|Failed to load resource/i.test(e));
real.length === 0 ? ok('صفر أخطاء في الكونسول') : bad('أخطاء في الكونسول', real.slice(0,4).join(' | '));

await browser.close();

const fails = results.filter(r => r[0]==='FAIL');
console.log(`\n${'='.repeat(56)}\n${results.length - fails.length}/${results.length} نجحت`);
if(fails.length){ console.log('❌ فشل:'); fails.forEach(f => console.log('   -', f[1], f[2])); process.exit(1); }
console.log('✅ كل الفحوص عدّت');
