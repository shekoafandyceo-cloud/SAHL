// تكلفة الشحن في الماليات — بعد شيل الافتراضي المحفور (16 سبتمبر، طلب المالك)
//
// كان في `finance.js`: `SHIPPING_COST_DEFAULT = 85` وأي أوردر مالوش تكلفة
// حقيقية بيتحسب بيه. ده كان **رقم بوسطة** محفور في الفرونت — ومع الانتقال
// لـJ&T بقى كذب مركّب (تعريفة مختلفة تماماً بسعر شركة اتلغى التعاقد معاها).
//
// 🔴 وشيل الافتراضي لوحده **خطر بالمقلوب**: الأوردر المجهول بيبقى صفر،
// فتكلفة الشحن تنقص والأرباح تطلع **أعلى** من الحقيقة في صمت. عشان كده
// الشيل جه معاه عدّاد وبانر — الرقم يظهر والسياق يظهر معاه (درس 36).
//
// اللي بيتفحص:
//   1) أوردر مسلّم بلا تكلفة **مايضيفش ولا جنيه** (مش 85)
//   2) الأوردرات اللي ليها تكلفة بتتجمع زي ما هي بالظبط
//   3) 🔴 مفيش أي أثر للرقم 85 في الحساب
//   4) `unknownShippingCount` بيعد المسلّم والمرتجع بس (مش الملغي/في السكة)
//   5) البانر بيظهر بالعدد وبيقول إن الربح أعلى من الحقيقي
//   6) مفيش بانر لما كل التكاليف مسجّلة
//   7) معايرات:
//      (أ) رجّع الافتراضي 85  → فحص 1 و3 يقعوا
//      (ب) شيل البانر         → فحص 5 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const SRC = fs.readFileSync(new URL('../app/js/finance/finance.js', import.meta.url), 'utf8');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

// الستب فيه: o1 مسلّم 97 · o4 مسلّم 112 · o5 مرتجع 88  → المجموع 297
const KNOWN_TOTAL = 97 + 112 + 88;

async function boot(opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await page.addInitScript(STUB);
  // أوردرات مجهولة التكلفة بتتحقن **بعد** الستب — نفس المرجع بتاع TABLES.orders
  await page.addInitScript(() => {
    const base = window.__ORDERS[0];
    const mk = (over) => Object.assign({}, base, over);
    window.__ORDERS.push(
      // مسلّم بلا تكلفة — ده اللي كان بياخد 85
      mk({ id: 'x1', order_uid: '9101', status: 'delivered', tracking_no: 'TRKX1',
           real_shipping_fee: null, inventory_cost_snapshot: 0 }),
      // مرتجع بلا تكلفة — بيتخصم عليه شحن كمان
      mk({ id: 'x2', order_uid: '9102', status: 'returned', tracking_no: 'TRKX2',
           real_shipping_fee: null, inventory_cost_snapshot: 0 }),
      // ملغي بلا تكلفة — **مايتعدش** (الشحن مابيتخصمش عليه أصلاً)
      mk({ id: 'x3', order_uid: '9103', status: 'cancelled', tracking_no: null,
           real_shipping_fee: null, inventory_cost_snapshot: 0 })
    );
  });
  if (opts.routeFinance) await page.route('**/js/finance/finance.js', opts.routeFinance);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#page-orders', { state: 'visible', timeout: 10000 });
  await page.click('#nav-finance');
  await page.waitForSelector('#page-finance', { state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('page-finance').classList.contains('pg-busy'), { timeout: 10000 });
  await page.waitForTimeout(500);
  return page;
}

// مجموع التكلفة زي ما الماليات بتحسبها بالظبط — من الموديول نفسه مش من النص
const shippingSum = (page) => page.evaluate(async () => {
  const f = await import('/js/finance/finance.js');
  const rows = (window.__ORDERS || []);
  const DEL = ['delivered', 'Delivered'];
  const RET = ['returned', 'Returned to business', 'Returned to business2'];
  let sum = 0, unknown = 0;
  rows.forEach(o => {
    if (DEL.indexOf(o.status) >= 0 || RET.indexOf(o.status) >= 0) {
      sum += f.orderShippingCost(o);
      if (f.orderShippingUnknown(o)) unknown++;
    }
  });
  return { sum, unknown, counted: f.unknownShippingCount };
});

const bannerText = (page) => page.evaluate(() => {
  const t = document.getElementById('page-finance').innerText;
  const i = t.indexOf('تكلفة شحنه لسه مش مسجّلة');
  return i < 0 ? '' : t.slice(Math.max(0, i - 40), i + 200);
});

// ════════════════ الحساب ════════════════
{
  const page = await boot();
  console.log('──── الحساب ────');
  const r = await shippingSum(page);

  ok(r.sum === KNOWN_TOTAL, `1+2) المجموع = التكاليف المسجّلة بس: ${r.sum} (المتوقع ${KNOWN_TOTAL})`);
  ok(r.sum !== KNOWN_TOTAL + 85 && r.sum !== KNOWN_TOTAL + 170,
     '3) 🔴 مفيش أي أثر للرقم 85 — الأوردر المجهول بصفر مش بافتراضي');
  ok(r.unknown === 2, `4أ) المجهول = 2 (مسلّم + مرتجع) — الملغي مش معدود: ${r.unknown}`);
  ok(r.counted === 2, `4ب) العدّاد المعروض مطابق للحساب: ${r.counted}`);

  console.log('──── البانر ────');
  const b = await bannerText(page);
  ok(b.indexOf('2') >= 0, `5أ) البانر بيقول العدد — «${b.split('\n')[0].trim()}»`);
  ok(b.indexOf('أعلى من الحقيقي') >= 0, '5ب) 🔴 البانر بيقول إن الربح أعلى من الحقيقي');
  await page.context().close();
}

// ════════════════ مفيش بانر لما كله مسجّل ════════════════
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(STUB);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#page-orders', { state: 'visible', timeout: 10000 });
  await page.click('#nav-finance');
  await page.waitForFunction(() => !document.getElementById('page-finance').classList.contains('pg-busy'), { timeout: 10000 });
  await page.waitForTimeout(400);
  const b = await bannerText(page);
  ok(b === '', '6) كل التكاليف مسجّلة → مفيش بانر (مش تنبيه دايم يتعوّد عليه — درس 9)');
  await page.context().close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');
const patch = (fn) => async (route) => {
  const src = fn(SRC);
  if (src === SRC) { console.log('  ✗ المعايرة ماغيّرتش الكود — الاستبدال مابيطابقش'); bad++; }
  await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: src });
};

// (أ) رجّع الافتراضي المحفور
{
  const page = await boot({
    routeFinance: patch(s => s.replace(
      'return (isFinite(f) && f > 0) ? f : 0;',
      'return (isFinite(f) && f > 0) ? f : 85;'))
  });
  const r = await shippingSum(page);
  ok(r.sum !== KNOWN_TOTAL, `(أ) رجوع الافتراضي 85 → فحص 1/3 وقع زي ما المفروض (${r.sum})`);
  await page.context().close();
}

// (ب) شيل البانر
{
  const page = await boot({
    routeFinance: patch(s => s.replace('if(unknownShippingCount > 0){', 'if(false){'))
  });
  const b = await bannerText(page);
  ok(b === '', '(ب) شيل البانر → فحص 5 وقع زي ما المفروض');
  await page.context().close();
}

await browser.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
