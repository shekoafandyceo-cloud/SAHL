// فئة «تطوير» في تاب المصاريف (v87 — 16 نوفمبر، طلب المالك)
//
// «عاوز اضيف في السيستم في تاب " المصاريف " اضيف مصروف جديد اسمه " تطوير " زي تغليف و كدا».
//
// 🔴 الخطر اللي الهارنس ده موجود عشانه: `renderFinanceOverview` بتجمع المصاريف **بالاسم**
// (مرتبات + إعلانات + … ) مش «كل اللي في الجدول». يعني فئة تتضاف للقايمة ومتتضافش للمجموع
// = المصروف بيتسجّل وبيبان في الجدول، وصافي الربح **مابيتخصمش منه** من غير أي خطأ.
//
// اللي بيتفحص:
//   1) الفلتر فيه «تطوير»
//   2) كارت الملخص `#exp-sum-dev` = مجموع مصاريف التطوير في الفترة
//   3) 🔴 صافي الربح وإجمالي التكاليف بيتحرّكوا بمبلغ التطوير بالظبط (مقارنة بنفس الداتا من غيره)
//   4) سطر «تطوير» في تفاصيل التكاليف بالمبلغ — ومابيظهرش لما مفيش مصروف تطوير
//   5) الفلتر بـ«تطوير» بيعرض مصاريفها بس
//   6) الشارة في الجدول ملوّنة (light + dark) — class `exp-cat-تطوير`
//   7) فورم «إضافة مصروف» فيه «تطوير» والحفظ بيبعت `category: 'تطوير'`
//   8) الكروت السبعة في صف واحد على 1440 و1366 · بتنزل صف تاني على 1100 بدل ما تتزنق · موبايل = عمود واحد زي الأول
//   9) باقي الفئات زي ما هي (تغليف · متفرقات) — الإضافة ماكسرتش حاجة
//  معايرات:
//      (أ) شيل `expDev` من المجموع      → فحص 3 يقع
//      (ب) شيل «تطوير» من قايمة الفورم  → فحص 7 يقع
//      (ج) شيل قاعدة لون الشارة          → فحص 6 يقع
//      (د) شيل سطر كارت الملخص من الـJS → فحص 2 يقع
//      (هـ) شيل تصغير رقم الكروت         → فحص 8و يقع
import { chromium } from 'playwright';
import fs from 'fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const SRC = fs.readFileSync(new URL('../app/js/finance/finance.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../app/css/14-finance.css', import.meta.url), 'utf8');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

const DEV = 1500 + 500;      // مصروفين تطوير
const PACK = 300, OTHER = 200;

// المصاريف بتتحقن **بعد** الستب بتاريخ النهارده (جوّه الفترة الافتراضية = الشهر الحالي)
function seed(withDev) {
  return (withDev0) => {
    const t = new Date();
    const d = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    const rows = [
      { id: 'e-pack', tenant_id: 't', category: 'تغليف', amount: 300, expense_date: d, note: 'كراتين' },
      { id: 'e-oth', tenant_id: 't', category: 'متفرقات', amount: 200, expense_date: d, note: 'حاجات' }
    ];
    if (withDev0) rows.push(
      { id: 'e-dev1', tenant_id: 't', category: 'تطوير', amount: 1500, expense_date: d, note: 'تجهيز ركن التصوير' },
      { id: 'e-dev2', tenant_id: 't', category: 'تطوير', amount: 500, expense_date: d, note: 'لوجو للحيطة' });
    window.__EXPENSES = rows;
  };
}

async function boot(opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1440, height: 900 } });
  page.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  if (opts.dark) await page.addInitScript(() => { try { localStorage.setItem('sahl_dark', '1'); } catch (e) {} });
  await page.addInitScript(STUB);
  await page.addInitScript(seed(), opts.withDev !== false);
  if (opts.big) await page.addInitScript(() => { window.__EXPENSES.forEach(e => { if (e.id === 'e-dev1') e.amount = 12000; }); });
  if (opts.routeFinance) await page.route('**/js/finance/finance.js', opts.routeFinance);
  if (opts.routeCss) await page.route('**/css/14-finance.css', opts.routeCss);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#page-orders', { state: 'visible', timeout: 10000 });
  await page.click('#nav-finance');
  await page.waitForSelector('#page-finance', { state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('page-finance').classList.contains('pg-busy'), { timeout: 10000 });
  await page.waitForTimeout(400);
  return page;
}

const numOf = (s) => Number(String(s || '').replace(/[^0-9.\-]/g, ''));
const overview = (page) => page.evaluate(() => {
  const txt = (id) => (document.getElementById(id) || {}).textContent || '';
  const rows = Array.from(document.querySelectorAll('#fin-cost-breakdown .cost-row')).map(r => ({
    label: (r.querySelector('.cost-row-label') || {}).textContent || '',
    value: (r.querySelector('.cost-row-value') || {}).textContent || ''
  }));
  return { net: txt('fin-net-profit'), costs: txt('fin-total-costs'), rows };
});
const openExpenses = async (page) => {
  await page.click('.stock-tab[data-ftab="expenses"]');
  await page.waitForSelector('#finance-expenses-tab', { state: 'visible' });
  await page.waitForTimeout(150);
};

// ════════════════ الحساب ════════════════
let baseNet, baseCosts;
{
  const page = await boot({ withDev: false });
  const o = await overview(page);
  baseNet = numOf(o.net); baseCosts = numOf(o.costs);
  console.log('──── من غير مصاريف تطوير ────');
  ok(!o.rows.some(r => r.label.indexOf('تطوير') >= 0), '4ب) مفيش مصروف تطوير → مفيش سطر «تطوير» في تفاصيل التكاليف');
  ok(o.rows.some(r => r.label.indexOf('تغليف') >= 0 && numOf(r.value) === -PACK), `9أ) سطر «تغليف» زي ما هو (${PACK})`);
  await openExpenses(page);
  const zero = await page.textContent('#exp-sum-dev');
  ok(numOf(zero) === 0 && zero.indexOf('ج') >= 0, `2ب) كارت «تطوير» = صفر لما مفيش — «${zero.trim()}»`);
  await page.context().close();
}

{
  const page = await boot();
  console.log('──── بمصاريف تطوير (1500 + 500) ────');
  const o = await overview(page);
  const net = numOf(o.net), costs = numOf(o.costs);
  ok(costs - baseCosts === DEV, `3أ) 🔴 إجمالي التكاليف زاد بمبلغ التطوير بالظبط: ${baseCosts} → ${costs} (الفرق ${costs - baseCosts} · المتوقع ${DEV})`);
  ok(baseNet - net === DEV, `3ب) 🔴 صافي الربح نقص بمبلغ التطوير بالظبط: ${baseNet} → ${net} (الفرق ${baseNet - net})`);
  const row = o.rows.find(r => r.label.indexOf('تطوير') >= 0);
  ok(!!row && numOf(row.value) === -DEV, `4أ) سطر «تطوير» في تفاصيل التكاليف = ${row ? row.value.trim() : 'مش موجود'}`);
  ok(o.rows.some(r => r.label.indexOf('متفرقات') >= 0 && numOf(r.value) === -OTHER), `9ب) سطر «متفرقات» زي ما هو (${OTHER})`);

  await openExpenses(page);
  const opts = await page.$$eval('#exp-filter-cat option', os => os.map(o => o.value));
  ok(opts.indexOf('تطوير') >= 0, `1) الفلتر فيه «تطوير» — ${opts.filter(Boolean).join(' · ')}`);
  ok(opts[opts.length - 1] === 'متفرقات', '1ب) «متفرقات» لسه آخر اختيار');
  ok(numOf(await page.textContent('#exp-sum-dev')) === DEV, `2أ) كارت الملخص «تطوير» = ${DEV}`);
  ok(numOf(await page.textContent('#exp-sum-packaging')) === PACK && numOf(await page.textContent('#exp-sum-other')) === OTHER,
     '9ج) كروت «تغليف» و«متفرقات» بأرقامهم');

  // 6) الشارة
  const badge = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#exp-tbody .exp-cat-badge')).find(x => x.textContent.trim() === 'تطوير');
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { cls: b.className, bg: cs.backgroundColor, color: cs.color };
  });
  ok(!!badge && badge.cls.indexOf('exp-cat-تطوير') >= 0, `6أ) شارة الصف class = «${badge ? badge.cls : '—'}»`);
  ok(!!badge && badge.bg === 'rgb(207, 250, 254)', `6ب) الشارة ملوّنة (light): ${badge ? badge.bg : '—'}`);

  // 5) الفلتر
  await page.selectOption('#exp-filter-cat', 'تطوير');
  await page.waitForTimeout(100);
  const f = await page.evaluate(() => ({
    count: document.getElementById('exp-count').textContent,
    cats: Array.from(document.querySelectorAll('#exp-tbody .exp-cat-badge')).map(b => b.textContent.trim())
  }));
  ok(f.cats.length === 2 && f.cats.every(c => c === 'تطوير'), `5) الفلتر بـ«تطوير» = مصاريفها بس (${f.cats.length}) — «${f.count.trim()}»`);
  await page.selectOption('#exp-filter-cat', '');

  // 8) الكروت
  const grid = await page.evaluate(() => {
    const g = document.querySelector('#finance-expenses-tab .sgrid');
    const cards = Array.from(g.children).map(c => c.getBoundingClientRect());
    const rows = new Set(cards.map(r => Math.round(r.top)));
    return { n: cards.length, rows: rows.size, minW: Math.min.apply(null, cards.map(r => r.width)),
             over: cards.some(r => r.right > innerWidth + 1 || r.left < -1),
             clip: Array.from(g.querySelectorAll('.sval')).some(v => v.scrollWidth > v.clientWidth + 1) };
  });
  ok(grid.n === 7 && grid.rows === 1, `8أ) 7 كروت في صف واحد على 1440 (${grid.n} كارت · ${grid.rows} صف · أقل عرض ${Math.round(grid.minW)}px)`);
  ok(!grid.over && !grid.clip, '8ب) مفيش كارت طالع بره الشاشة ولا رقم مقصوص');

  // 7) الفورم
  await page.click('#add-expense-btn');
  await page.waitForSelector('#exp-cat');
  const cats = await page.$$eval('#exp-cat option', os => os.map(o => o.value));
  ok(cats.indexOf('تطوير') >= 0, `7أ) فورم «إضافة مصروف» فيه «تطوير» — ${cats.join(' · ')}`);
  let payload = null;
  if (cats.indexOf('تطوير') >= 0) {
    await page.selectOption('#exp-cat', 'تطوير');
    await page.fill('#exp-amount', '750');
    await page.fill('#exp-note', 'تجربة');
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.click('#exp-save');
    await page.waitForTimeout(300);
    payload = await page.evaluate(() => {
      const c = (window.__calls || []).find(x => x.table === 'expenses' && x.inserted);
      return c ? c.payload : null;
    });
  }
  ok(!!payload && payload.category === 'تطوير' && payload.amount === 750, `7ب) الحفظ بعت category = «${payload ? payload.category : '—'}» بمبلغ ${payload ? payload.amount : '—'}`);
  await page.context().close();
}

// تعديل مصروف «تطوير» موجود — الفورم لازم يفتح على فئته مش على أول اختيار
{
  const page = await boot();
  await openExpenses(page);
  await page.click('#exp-tbody .exp-edit-btn[data-id="e-dev1"]');
  await page.waitForSelector('#exp-cat');
  const sel = await page.$eval('#exp-cat', s => s.value);
  ok(sel === 'تطوير', `7ج) تعديل مصروف «تطوير» بيفتح على فئته: «${sel}» (من غير الاختيار في القايمة كان هيفتح على «مرتبات» ويتحفظ بيها)`);
  await page.context().close();
}

// dark
{
  const page = await boot({ dark: true });
  await openExpenses(page);
  const d = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#exp-tbody .exp-cat-badge')).find(x => x.textContent.trim() === 'تطوير');
    return { dark: document.documentElement.classList.contains('dark'), color: b ? getComputedStyle(b).color : null };
  });
  ok(d.dark && d.color === 'rgb(34, 211, 238)', `6ج) الشارة في الـdark بلونها (${d.color}) — الوضع ${d.dark ? 'dark' : 'مش dark!'}`);
  await page.context().close();
}

// موبايل
{
  const page = await boot({ viewport: { width: 390, height: 844 } });
  await openExpenses(page);
  const g = await page.evaluate(() => {
    const el = document.querySelector('#finance-expenses-tab .sgrid');
    const cards = Array.from(el.children).map(c => c.getBoundingClientRect());
    return { cols: new Set(cards.map(r => Math.round(r.left))).size, over: cards.some(r => r.right > innerWidth + 1 || r.left < -1) };
  });
  ok(g.cols === 1 && !g.over, `8ج) الموبايل (390px): عمود واحد زي الأول (19-mobile بـ!important) ومفيش كارت بره الشاشة (${g.cols} عمود)`);
  await page.context().close();
}

// لابتوب (1366px) = صف واحد · لابتوب صغير (1100px) = الكروت بتنزل صف تاني بدل ما تتزنق —
// الشبكة auto-fit (حد أدنى 130px للكارت): 7 في صف على 828px = 109px للكارت والأرقام الكبيرة بتتقص
for (const [w, rows, tag] of [[1366, 1, 'د'], [1100, 2, 'هـ']]) {
  const page = await boot({ viewport: { width: w, height: 800 } });
  await openExpenses(page);
  const g = await page.evaluate(() => {
    const el = document.querySelector('#finance-expenses-tab .sgrid');
    const cards = Array.from(el.children).map(c => c.getBoundingClientRect());
    return { n: cards.length, rows: new Set(cards.map(r => Math.round(r.top))).size, minW: Math.min.apply(null, cards.map(r => r.width)),
             over: cards.some(r => r.right > innerWidth + 1 || r.left < -1),
             clip: Array.from(el.querySelectorAll('.sval')).some(v => v.scrollWidth > v.clientWidth + 1) };
  });
  ok(g.n === 7 && g.rows === rows && g.minW >= 130 && !g.over && !g.clip,
     `8${tag}) ${w}px: ${g.rows} صف (المتوقع ${rows}) · أقل عرض كارت ${Math.round(g.minW)}px (≥ 130) · من غير قص`);
  await page.context().close();
}

// رقم من 5 خانات لازم يفضل في سطر واحد (زي الستة القدام) — الكارت السابع ضيّق الكروت،
// والرقم بـ2.1rem كان بينزّل «ج» في سطر لوحده
const oneLine = async (routeCss) => {
  const out = [];
  for (const w of [1440, 1366]) {
    const page = await boot({ viewport: { width: w, height: 800 }, big: true, routeCss });
    await openExpenses(page);
    out.push(await page.evaluate(() => {
      const v = document.getElementById('exp-sum-dev');
      return Math.round(v.getBoundingClientRect().height / parseFloat(getComputedStyle(v).lineHeight)) + ':' + v.textContent.trim();
    }));
    await page.context().close();
  }
  return out;
};
{
  const r = await oneLine();
  ok(r.every(x => x.indexOf('1:') === 0), `8و) كارت «تطوير» برقم 5 خانات في سطر واحد على 1440 و1366 — ${r.join(' · ')}`);
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');
const patch = (orig, fn, type) => async (route) => {
  const src = fn(orig);
  if (src === orig) { console.log('  ✗ المعايرة ماغيّرتش الكود — الاستبدال مابيطابقش'); bad++; }
  await route.fulfill({ status: 200, contentType: (type || 'application/javascript') + '; charset=utf-8', body: src });
};

// (أ) الفئة في القايمة بس مش في المجموع — ده الباج الصامت
{
  const page = await boot({ routeFinance: patch(SRC, s => s.replace('expWarehouse + expDev + expOther', 'expWarehouse + expOther')) });
  const o = await overview(page);
  ok(numOf(o.costs) - baseCosts !== DEV, `(أ) شيل expDev من المجموع → فحص 3 وقع زي ما المفروض (الفرق ${numOf(o.costs) - baseCosts} مش ${DEV})`);
  await page.context().close();
}
// (ب) الفورم من غير الفئة
{
  const page = await boot({ routeFinance: patch(SRC, s => s.replace("'مخزن','تطوير','متفرقات'", "'مخزن','متفرقات'")) });
  await openExpenses(page);
  await page.click('#add-expense-btn');
  await page.waitForSelector('#exp-cat');
  const cats = await page.$$eval('#exp-cat option', os => os.map(o => o.value));
  ok(cats.indexOf('تطوير') < 0, '(ب) شيل «تطوير» من قايمة الفورم → فحص 7 وقع زي ما المفروض');
  await page.context().close();
}
// (ج) من غير لون الشارة
{
  const page = await boot({ routeCss: patch(CSS, s => s.replace('.exp-cat-تطوير{background:#cffafe;color:#155e75;}', ''), 'text/css') });
  await openExpenses(page);
  const bg = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#exp-tbody .exp-cat-badge')).find(x => x.textContent.trim() === 'تطوير');
    return b ? getComputedStyle(b).backgroundColor : null;
  });
  ok(bg !== 'rgb(207, 250, 254)', `(ج) شيل قاعدة اللون → فحص 6 وقع زي ما المفروض (${bg})`);
  await page.context().close();
}
// (هـ) من غير تصغير الرقم
{
  const r = await oneLine(patch(CSS, s => s.replace('#page-finance .exp-sum-grid .sval{font-size:1.7rem !important;}', ''), 'text/css'));
  ok(r.some(x => x.indexOf('1:') !== 0), `(هـ) شيل تصغير الرقم → فحص 8و وقع زي ما المفروض (${r.join(' · ')})`);
}
// (د) كارت الملخص مابيتملاش
{
  const page = await boot({ routeFinance: patch(SRC, s => s.replace("  $id('exp-sum-dev').textContent = num(sumCat('تطوير').toFixed(0))+' ج';\n", '')) });
  await openExpenses(page);
  ok(numOf(await page.textContent('#exp-sum-dev')) !== DEV, '(د) شيل سطر الكارت من الـJS → فحص 2 وقع زي ما المفروض');
  await page.context().close();
}

await browser.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
