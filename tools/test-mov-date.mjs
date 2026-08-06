// عمود التاريخ في حركات المخزون — لازم يبقى **خالي من علامات الاتجاه الخفية**
// والمقاطع في مكانها. الباج الأصلي: fmtStoredDateTime كانت الدالة الوحيدة اللي
// مابتشيلش U+200F، فجوّه خلية direction:ltr اليوم كان بيطير لآخر السطر
// ("06 م 03:33:34 ،2026/08/" بدل "06/08/2026 · 03:33:34 م").
//
// الفحص هنا مش «الخلية فيها نص» — ده كان هيعدّي على الباج. الفحص:
//   1) صفر محارف اتجاه في النص المرندَر
//   2) التاريخ المرندَر = التاريخ المتوقع بتوقيت القاهرة للطابع الزمني المحقون
//   3) هندسة: التاريخ والوقت عنصرين منفصلين، والاتنين راسيين على يمين الخلية
//      (درس 30 — «الأرقام مش تحت العناوين» اتمسك بقياس المرساة مش بالعين)
//   4) معايرة: نرجّع الباج بالحرف (نحقن U+200F) ونتأكد إن الفحص بيسقط
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const BIDI = /[‎‏؜]/;

// طابع زمني ثابت — عشان المتوقع يتحسب من نفس المرجع اللي الكود بيستخدمه
// المتوقع بيتحسب في الاختبار بنفس Intl اللي الكود بيستخدمه — مش مكتوب بالإيد.
// السبب: مصر رجّعت التوقيت الصيفي، فأغسطس UTC+3 ويناير UTC+2. أي رقم متسمّر
// هنا كان هيبقى صح نص السنة وغلط النص التاني.
const T1 = '2026-08-06T13:33:34.000Z';   // صيف (UTC+3) → 06/08/2026
const T2 = '2026-01-15T22:10:05.000Z';   // شتا (UTC+2) — بيعدّي منتصف الليل بالقاهرة → 16/01/2026
const MOVEMENTS = [
  { id:'m1', tenant_id:'t-test-1', product_id:'p1', product_name:'منتج أ', movement_type:'in',
    qty_in:1, qty_out:0, created_at:T1, movement_date:'2026-08-06', tracking_no:'TRK-A', notes:null },
  { id:'m2', tenant_id:'t-test-1', product_id:'p1', product_name:'منتج أ', movement_type:'out',
    qty_in:0, qty_out:1, created_at:T2, movement_date:'2026-01-15', tracking_no:'TRK-B', notes:null },
  // من غير created_at خالص → المسار التاني (fmtDateOnly) اللي كان فيه نفس الباج نايم
  { id:'m3', tenant_id:'t-test-1', product_id:'p1', product_name:'منتج ب', movement_type:'in',
    qty_in:2, qty_out:0, created_at:null, movement_date:'2026-03-09', tracking_no:null, notes:null }
];

const expectCairo = (isoStr) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  timeZone:'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit'
}).format(new Date(isoStr)).replace(/[‎‏؜]/g,'');

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{ width:1440, height:900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));

await p.addInitScript(`window.__MOVEMENTS = ${JSON.stringify(MOVEMENTS)};`);
await p.addInitScript(STUB);
await p.goto(process.env.APP_URL || 'http://127.0.0.1:8899/index.html', { waitUntil:'networkidle' });
await p.waitForSelector('#page-orders', { state:'visible' });

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

// افتح المخزون → تبويب الحركات
await p.click('[data-page="stock"]');
await p.waitForSelector('#page-stock', { state:'visible' });
await p.click('.stock-tab[data-tab="movements"]');
await p.waitForSelector('#mov-tbody table tbody tr');
await p.waitForTimeout(300);

const readCells = () => p.evaluate(() => {
  const cells = [...document.querySelectorAll('#mov-tbody tbody tr td.mv-when')];
  return cells.map(td => {
    const d = td.querySelector('.mv-date'), t = td.querySelector('.mv-time');
    const R = el => { if(!el) return null; const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height, right:r.right}; };
    const cr = td.getBoundingClientRect();
    return {
      raw: td.textContent,
      date: d ? d.textContent : null,
      time: t ? t.textContent : null,
      dRect: R(d), tRect: R(t),
      lineH: t ? parseFloat(getComputedStyle(t).lineHeight) || 0 : 0,
      cell: { x:cr.x, right:cr.right, w:cr.width },
      // الـhit-test: مين اللي فعلاً مرسوم فوق نص التاريخ (درس 31/35)
      hit: (() => {
        if(!d) return null;
        const r = d.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
        return el ? (el === d || d.contains(el) || el.contains(d)) : false;
      })()
    };
  });
});

const cells = await readCells();
ok(cells.length === 3, `اتعرضت 3 حركات — ${cells.length}`);

// (1) صفر محارف اتجاه — ده الباج نفسه
const withBidi = cells.filter(c => BIDI.test(c.raw));
ok(withBidi.length === 0,
   `صفر محارف اتجاه خفية في كل الخلايا${withBidi.length ? ' — لسه فيه: ' + JSON.stringify(withBidi.map(c=>c.raw)) : ''}`);

// (2) القيمة نفسها صح بتوقيت القاهرة (درس 34: افحص القيمة اللي خرجت مش بس إنها خرجت)
const e1 = expectCairo(T1), e2 = expectCairo(T2);
ok(cells[0] && cells[0].date === e1, `الصف 1 تاريخه = ${e1} (المرندَر: ${cells[0] && cells[0].date})`);
ok(cells[1] && cells[1].date === e2, `الصف 2 تاريخه = ${e2} (المرندَر: ${cells[1] && cells[1].date})`);
ok(cells[0] && /\d{2}:\d{2}:\d{2}/.test(cells[0].time || ''), `الصف 1 وقته ظاهر: ${cells[0] && cells[0].time}`);
// الصف اللي مالوش created_at: تاريخ بس من غير وقت — والمسار ده كان فيه نفس الباج
ok(cells[2] && cells[2].date === '09/03/2026', `الصف 3 (من غير created_at) = 09/03/2026 (المرندَر: ${cells[2] && cells[2].date})`);
ok(cells[2] && !cells[2].time, 'الصف 3 من غير وقت — movement_date تاريخ بس');

// (3) الهندسة: عنصرين منفصلين، سطر تحت سطر، والاتنين راسيين يمين الخلية
const g = cells[0];
if(g && g.dRect && g.tRect){
  ok(g.tRect.y >= g.dRect.y + g.dRect.h - 1, `الوقت تحت التاريخ (تاريخ y=${g.dRect.y.toFixed(0)} وقت y=${g.tRect.y.toFixed(0)})`);
  const dGap = Math.abs(g.cell.right - g.dRect.right);
  const tGap = Math.abs(g.cell.right - g.tRect.right);
  ok(dGap < 26 && tGap < 26, `الاتنين راسيين على يمين الخلية (فرق التاريخ ${dGap.toFixed(0)}px · الوقت ${tGap.toFixed(0)}px)`);
} else ok(false, 'التاريخ والوقت مش عنصرين منفصلين');
// كل مقطع لازم يفضل سطر واحد — العمود ضيّق و«04:33:34 م» كان بيتقص عند
// المسافة والـ«م» تنزل سطر تالت لوحدها. القياس لوحده مامسكهاش، السكرين شوت
// هو اللي مسكها (درس 31) — فالفحص ده بيمنع رجوعها.
const wrapped = cells.filter(c => c.tRect && c.lineH && c.tRect.h > c.lineH * 1.55);
ok(wrapped.length === 0,
   `الوقت سطر واحد مش متقصّم — متقصّم: ${wrapped.length}` +
   (wrapped.length ? ` (ارتفاع ${wrapped[0].tRect.h.toFixed(0)}px مقابل سطر ${wrapped[0].lineH.toFixed(0)}px)` : ''));
ok(cells.every(c => c.hit !== false), 'الـhit-test: نص التاريخ مش مدفون تحت أي حاجة');

// (4) المعايرة — نرجّع الباج بالحرف: نحقن U+200F بين المقاطع زي ما الـlocale بيعمل
const caught = await p.evaluate(() => {
  const td = document.querySelector('#mov-tbody tbody tr td.mv-when .mv-date');
  if(!td) return null;
  const before = td.textContent;
  td.textContent = before.replace(/\//g, '‏/');   // نفس شكل ناتج ar-EG بالظبط
  const now = document.querySelector('#mov-tbody tbody tr td.mv-when').textContent;
  const detected = /[‎‏؜]/.test(now);
  td.textContent = before;                              // رجّع
  return detected;
});
ok(caught === true, 'المعايرة: لما نرجّع الباج (حقن U+200F) الفحص بيمسكه');

const after = await readCells();
ok(!BIDI.test(after[0].raw), 'وبعد الرجوع النص رجع نضيف — المعايرة مالوّثتش الحالة');

ok(errs.filter(e => !/favicon|ERR_/i.test(e)).length === 0,
   `صفر أخطاء صفحة${errs.length ? ' — ' + JSON.stringify(errs.slice(0,3)) : ''}`);

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
