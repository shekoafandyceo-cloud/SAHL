// اختبار تضييق أعمدة ensureAllLoaded:
// بنرندر الماليات والإحصائيات مرتين — مرة والستب بيرجّع الصف كامل
// (سلوك select('*') القديم) ومرة وهو بيقطع الأعمدة زي PostgREST —
// وبنقارن **كل رقم مرندَر**. أي عمود ناقص من ALL_COLS هيغيّر رقم.
import { chromium } from 'playwright';
import fs from 'fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function capture(project){
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(STUB);
  await page.addInitScript(p => { window.__project = p; }, project);
  await page.goto(APP, { waitUntil:'networkidle' });
  await page.waitForSelector('#page-orders', { state:'visible', timeout:10000 });
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0, { timeout:10000 });

  const out = {};
  // الماليات
  await page.click('#nav-finance');
  await page.waitForSelector('#page-finance', { state:'visible' });
  await page.waitForFunction(() => !document.getElementById('page-finance').classList.contains('pg-busy'), { timeout:10000 });
  await page.waitForTimeout(500);
  out.finance = await page.evaluate(() => document.getElementById('page-finance').innerText.replace(/\s+/g,' ').trim());

  // الإحصائيات — التلات تبويبات
  await page.click('#nav-analytics');
  await page.waitForSelector('#page-analytics', { state:'visible' });
  await page.waitForFunction(() => !document.getElementById('page-analytics').classList.contains('pg-busy'), { timeout:10000 });
  await page.waitForTimeout(400);
  out.products = await page.evaluate(() => document.getElementById('perf-tbody').innerText.replace(/\s+/g,' ').trim());
  await page.click('.stock-tab[data-atab="platforms"]'); await page.waitForTimeout(300);
  out.platforms = await page.evaluate(() => document.getElementById('finplat-tbody').innerText.replace(/\s+/g,' ').trim());
  await page.click('.stock-tab[data-atab="days"]'); await page.waitForTimeout(300);
  out.days = await page.evaluate(() => document.getElementById('dcal').innerText.replace(/\s+/g,' ').trim());

  // كروت الإحصاء الأربعة فوق جدول المنتجات
  out.perfCards = await page.evaluate(() => ['pf-products','pf-top-rev','pf-top-del','pf-top-ret']
    .map(id => (document.getElementById(id)||{}).textContent).join(' | '));

  out.errors = errs;
  await page.close();
  return out;
}

console.log('  … رندر بالصف الكامل (سلوك select(*) القديم)');
const before = await capture(false);
console.log('  … رندر بأعمدة مقطوعة زي السيرفر (ALL_COLS)');
const after  = await capture(true);

let bad = 0;
for(const k of ['finance','products','platforms','days','perfCards']){
  if(before[k] === after[k]) console.log('  ✓', k, '— مطابق');
  else {
    bad++;
    console.log('  ✗', k, '— اختلف!');
    console.log('     قبل:', before[k].slice(0,320));
    console.log('     بعد:', after[k].slice(0,320));
  }
}
if(before.finance.length < 40){ bad++; console.log('  ✗ الماليات مارندرتش أصلاً — الاختبار مش بيثبت حاجة'); }
else console.log('  ✓ الماليات رندرت فعلاً', `(${before.finance.length} حرف)`);

const realErr = [...before.errors, ...after.errors].filter(e => !/favicon|ERR_/i.test(e));
realErr.length ? (bad++, console.log('  ✗ أخطاء صفحة:', realErr.slice(0,3))) : console.log('  ✓ صفر أخطاء صفحة');

// ── حالة فشل السحب: لازم تظهر رسالة صريحة مش صفحة فاضية ──────────
const page = await browser.newPage({ viewport:{width:1440, height:900} });
await page.addInitScript(STUB);
await page.addInitScript(() => { window.__failOrders = true; });
await page.goto(APP, { waitUntil:'networkidle' });
await page.waitForSelector('#page-orders', { state:'visible', timeout:10000 });
await page.click('#nav-analytics');
await page.waitForTimeout(1500);
const errState = await page.evaluate(() => ({
  txt: (document.getElementById('perf-tbody')||{}).innerText || '',
  busy: document.getElementById('page-analytics').classList.contains('pg-busy'),
  btn: !!document.querySelector('#perf-tbody [data-act="retry-load"]')
}));
errState.txt.includes('مقدرناش نحمّل')
  ? console.log('  ✓ فشل السحب بيعرض رسالة صريحة مش صفحة فاضية')
  : (bad++, console.log('  ✗ فشل السحب سايب الصفحة فاضية:', JSON.stringify(errState)));
errState.btn ? console.log('  ✓ وفيه زرار «حاول تاني»') : (bad++, console.log('  ✗ مفيش زرار إعادة محاولة'));
!errState.busy ? console.log('  ✓ الحجاب اتشال') : (bad++, console.log('  ✗ الحجاب فضل شغال'));
await page.close();

await browser.close();
console.log('\n' + '='.repeat(52));
if(bad){ console.log(`❌ ${bad} مشكلة`); process.exit(1); }
console.log('✅ الأرقام مطابقة قبل وبعد التضييق — مفيش عمود ناقص');
