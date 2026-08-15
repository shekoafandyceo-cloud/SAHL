// خصائص المنتجات (ألوان/مقاسات) — عيلات في جدول المخزون + توزيع + محررات
//
// اللي بيتفحص:
//   1) الكروت: «المنتجات» بتعدّ العيلات مش الصفوف · «نواقص» مابتعدّش أم ليها
//      خصائص (صفر «غير الموزع» حالة طبيعية مش نفاد)
//   2) الجدول: صف العيلة بإجمالي العيلة وشارة عدد الخصائص، البنات مخفية
//      وبتظهر بضغطة حقيقية (hit-tested — درس 35)، وصف «غير موزع» بيبان لو
//      فيه رصيد على الأم
//   3) البحث بيطابق العيلة من لابل البنت وبيفتحها لوحده
//   4) التنبؤ (stockForecastRows) بيستبعد الأم اللي ليها خصائص — من غير
//      الاستبعاد كل عيلة موزعة بالكامل كانت بتطلع «نفد» كاذبة
//   5) محرر الحركة: العيلة متجمعة والأم اسمها «(غير موزع)» والاختيار بيقع
//      على صف الخاصية نفسه
//   6) محرر المنتج: قسم الخصائص + توزيع/استرجاع عبر transfer_stock RPC
//      (الاتجاه بيتفحص بالأرقام بعد النقل مش بس بنجاح النداء — درس 34) +
//      إضافة خاصية من غير إرسال name (السيرفر بيولّده) + حراسات الحذف
//   7) معايرات: (أ) ضياع أعمدة الربط = الفحوص بتقع بصوت عالي
//      (ب) سواب اتجاه التوزيع بيتمسك من الأرقام (ج) حقن درس 31 بالحرف —
//      عنصر راسم فوق صف العيلة بيسقط الـhit-test
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const T = 't-test-1';
const STOCK = [
  { id:'p1', tenant_id:T, name:'ترولي تست', current_qty:5, wholesale_price:100, unit_price:150, active:true, parent_id:null, variant_label:null },
  { id:'c1', tenant_id:T, name:'ترولي تست — أحمر', current_qty:8, wholesale_price:100, unit_price:150, active:true, parent_id:'p1', variant_label:'أحمر' },
  { id:'c2', tenant_id:T, name:'ترولي تست — أزرق', current_qty:0, wholesale_price:100, unit_price:150, active:true, parent_id:'p1', variant_label:'أزرق' },
  { id:'p2', tenant_id:T, name:'منتج مستقل', current_qty:3, wholesale_price:50, unit_price:80, active:true, parent_id:null, variant_label:null },
  { id:'p3', tenant_id:T, name:'منتج نافد', current_qty:0, wholesale_price:40, unit_price:60, active:true, parent_id:null, variant_label:null },
  // عيلة موزعة بالكامل: رصيد الأم صفر والبضاعة كلها على البنت — الفخ الكلاسيكي
  { id:'p4', tenant_id:T, name:'عيلة موزعة', current_qty:0, wholesale_price:70, unit_price:90, active:true, parent_id:null, variant_label:null },
  { id:'c4', tenant_id:T, name:'عيلة موزعة — أسود', current_qty:7, wholesale_price:70, unit_price:90, active:true, parent_id:'p4', variant_label:'أسود' }
];
// المجاميع المتوقعة: عيلات 4 · قطع 23 · نواقص 2 (أزرق + منتج نافد، وp4 مستبعدة)

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

async function openApp(opts){
  const p = await b.newPage({ viewport:{ width:1440, height:900 } });
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.addInitScript(`
    window.__STOCK = ${JSON.stringify(opts && opts.stock ? opts.stock : STOCK)};
    ${opts && opts.role ? `window.__ROLE = '${opts.role}';` : ''}
    window.__RPC_HOOK = function(name, args){
      if(name !== 'transfer_stock') return null;
      var S = window.__STOCK;
      var from = args.p_from, to = args.p_to;
      if(window.__RPC_SWAP){ var tmp = from; from = to; to = tmp; }   // معايرة (ب)
      var f = null, t = null;
      for(var i=0;i<S.length;i++){ if(S[i].id===from) f=S[i]; if(S[i].id===to) t=S[i]; }
      if(!f || !t) return { data:null, error:{ message:'not_found' } };
      if((f.current_qty||0) < args.p_qty) return { data:null, error:{ message:'لا يمكن خصم '+args.p_qty+' — المتاح: '+f.current_qty } };
      f.current_qty -= args.p_qty; t.current_qty += args.p_qty;
      return { data:{ ok:true }, error:null };
    };
  `);
  await p.addInitScript(STUB);
  await p.goto(process.env.APP_URL || 'http://127.0.0.1:8899/index.html', { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.click('[data-page="stock"]');
  await p.waitForSelector('#page-stock', { state:'visible' });
  await p.waitForSelector('#prod-tbody table, #prod-tbody .empty-state', { timeout: 5000 }).catch(()=>{});
  await p.waitForTimeout(250);
  return p;
}

const txt = (p, sel) => p.$eval(sel, el => el.textContent.trim()).catch(() => null);
const digits = s => parseInt(String(s||'').replace(/[^0-9]/g,''), 10);

// ════ 1) الكروت ════
{
  const p = await openApp();
  console.log('──── الكروت ────');
  ok(await txt(p, '#st-products') === '4', 'كارت «المنتجات» = 4 عيلات (مش 7 صفوف)');
  ok(digits(await txt(p, '#st-qty')) === 23, 'إجمالي القطع 23 — بيجمع البنات وغير الموزع');
  ok(await txt(p, '#st-empty') === '2', 'النواقص 2 (أزرق + منتج نافد) — أم «عيلة موزعة» رصيدها صفر ومش معدودة نفاد');

  // ════ 2) الجدول: العيلة والفتح بضغطة حقيقية ════
  console.log('──── جدول العيلات ────');
  const fam = await p.$('#prod-tbody tr.fam-row[data-fam="p1"]');
  ok(!!fam, 'صف عيلة «ترولي تست» موجود');
  const famRow = await p.evaluate(() => {
    const r = document.querySelector('#prod-tbody tr.fam-row[data-fam="p1"]');
    const tds = [...r.querySelectorAll('td')].map(td => td.textContent.trim());
    return { tds, badge: r.querySelector('.fam-count') ? r.querySelector('.fam-count').textContent : '' };
  });
  ok(digits(famRow.tds[1]) === 13, `إجمالي العيلة 13 (5 غير موزع + 8 + 0) — ${famRow.tds[1]}`);
  ok(famRow.badge.indexOf('2') >= 0, `شارة عدد الخصائص «${famRow.badge}»`);
  ok(digits(famRow.tds[4]) === 1300, `قيمة العيلة 1,300 (13×100) — ${famRow.tds[4]}`);
  const hiddenBefore = await p.evaluate(() =>
    [...document.querySelectorAll('#prod-tbody tr.var-row[data-parent="p1"]')].map(r => r.classList.contains('hid')));
  ok(hiddenBefore.length === 3 && hiddenBefore.every(Boolean), 'البنات + «غير موزع» = 3 صفوف مخفية قبل الفتح');

  // hit-test (درس 35): مركز صف العيلة لازم يرجّع عنصر جوّه الصف نفسه
  const hit = await p.evaluate(() => {
    const r = document.querySelector('#prod-tbody tr.fam-row[data-fam="p1"]');
    const b = r.getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
    return !!(el && r.contains(el));
  });
  ok(hit, 'hit-test: مركز صف العيلة مش مغطي بحاجة');
  await p.click('#prod-tbody tr.fam-row[data-fam="p1"]');
  await p.waitForTimeout(150);
  const kidsAfter = await p.evaluate(() =>
    [...document.querySelectorAll('#prod-tbody tr.var-row[data-parent="p1"]')]
      .filter(r => !r.classList.contains('hid'))
      .map(r => [...r.querySelectorAll('td')].slice(0,2).map(td => td.textContent.trim())));
  ok(kidsAfter.length === 3, 'الضغطة فتحت الصفوف الثلاثة');
  ok(kidsAfter.some(k => k[0].indexOf('أحمر') >= 0 && digits(k[1]) === 8), 'أحمر: 8');
  ok(kidsAfter.some(k => k[0].indexOf('أزرق') >= 0 && digits(k[1]) === 0), 'أزرق: 0');
  ok(kidsAfter.some(k => k[0].indexOf('غير موزع') >= 0 && digits(k[1]) === 5), 'غير موزع: 5');
  await p.click('#prod-tbody tr.fam-row[data-fam="p1"]');
  await p.waitForTimeout(150);
  const closedAgain = await p.evaluate(() =>
    [...document.querySelectorAll('#prod-tbody tr.var-row[data-parent="p1"]')].every(r => r.classList.contains('hid')));
  ok(closedAgain, 'ضغطة تانية بتقفل العيلة');

  // ════ 3) البحث ════
  console.log('──── البحث ────');
  await p.fill('#prod-search', 'أحمر');
  await p.waitForTimeout(200);
  const searchState = await p.evaluate(() => ({
    count: document.getElementById('prod-count').textContent,
    fams: document.querySelectorAll('#prod-tbody tr.fam-row').length,
    openKids: [...document.querySelectorAll('#prod-tbody tr.var-row')].filter(r => !r.classList.contains('hid')).length
  }));
  ok(searchState.fams === 1 && searchState.count.indexOf('1') >= 0, 'بحث «أحمر» بيرجّع عيلة ترولي بس (المطابقة من اللابل)');
  ok(searchState.openKids === 3, 'العيلة المطابقة اتفتحت لوحدها — نتيجة مخفية = بحث بيكدب');
  await p.fill('#prod-search', 'حاجة مش موجودة خالص');
  await p.waitForTimeout(200);
  ok((await txt(p, '#prod-tbody')).indexOf('مفيش منتجات مطابقة') >= 0, 'بحث فاضي = رسالة «مفيش مطابق» مش «لسه مضفتش»');
  await p.fill('#prod-search', '');
  await p.waitForTimeout(200);

  // ════ 4) التنبؤ بيستبعد الأمهات ════
  console.log('──── التنبؤ ────');
  const forecast = await p.evaluate(async () => {
    const m = await import('./js/stock/stock.js');
    return m.stockForecastRows().map(r => ({ name: r.product.name, level: r.level }));
  });
  ok(!forecast.some(r => r.name === 'عيلة موزعة'), 'أم موزعة بالكامل (رصيدها 0) مش بتطلع «نفد» كاذبة');
  ok(!forecast.some(r => r.name === 'ترولي تست'), 'وأم ليها رصيد غير موزع برضه مستبعدة من التنبؤ');
  ok(forecast.some(r => r.name === 'ترولي تست — أزرق' && r.level === 'critical'), 'البنت النافدة (أزرق) هي اللي بتنبّه');
  ok(forecast.some(r => r.name === 'منتج نافد' && r.level === 'critical'), 'والمنتج المستقل النافد لسه بينبّه عادي');

  // ════ 5) محرر الحركة ════ (زراره جوه تبويب الحركات)
  console.log('──── محرر الحركة ────');
  await p.click('.stock-tab[data-tab="movements"]');
  await p.waitForTimeout(150);
  await p.click('#add-mov-btn');
  await p.waitForSelector('#me-prod');
  const opts = await p.evaluate(() =>
    [...document.querySelectorAll('#me-prod option')].map(o => ({ v: o.value, t: o.textContent, n: o.getAttribute('data-name') })));
  ok(opts.length === 8, `7 صفوف + placeholder = 8 اختيارات — ${opts.length}`);
  const poolOpt = opts.find(o => o.v === 'p1');
  ok(poolOpt && poolOpt.t.indexOf('غير موزع') >= 0 && poolOpt.n === 'ترولي تست', 'الأم بتتعرض «(غير موزع)» وبتحتفظ باسمها الحقيقي');
  const redOpt = opts.find(o => o.v === 'c1');
  ok(redOpt && redOpt.t.indexOf('↳') >= 0 && redOpt.n === 'ترولي تست — أحمر', 'البنت باسمها الكامل ومتعلمة ↳');
  ok(opts.findIndex(o => o.v === 'c1') === opts.findIndex(o => o.v === 'p1') + 1, 'البنت جاية مباشرة بعد أمها مش مبعثرة');
  await p.selectOption('#me-prod', 'c1');
  await p.click('#me-save');
  await p.waitForTimeout(300);
  const movIns = await p.evaluate(() =>
    window.__calls.filter(c => c.table === 'stock_movements' && c.payload).pop());
  ok(movIns && movIns.payload.product_id === 'c1' && movIns.payload.product_name === 'ترولي تست — أحمر',
     'الحركة اليدوية بتتسجل على صف الخاصية نفسه بالاسم الكامل');

  // ════ 6) محرر المنتج: الخصائص والتوزيع ════
  console.log('──── محرر المنتج ────');
  await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); });
  await p.click('.stock-tab[data-tab="products"]');
  await p.waitForTimeout(150);
  await p.click('#prod-tbody tr.fam-row[data-fam="p1"] .prod-edit-btn');
  await p.waitForSelector('#pe-vars');
  let vsec = await txt(p, '#pe-vars');
  ok(vsec.indexOf('غير الموزع: 5') >= 0, 'شارة «غير الموزع: 5» في قسم الخصائص');
  ok(vsec.indexOf('أحمر') >= 0 && vsec.indexOf('أزرق') >= 0, 'الخاصيتين معروضين');
  const takeBtns = await p.evaluate(() =>
    [...document.querySelectorAll('.pe-var-take')].map(b => b.getAttribute('data-vid')));
  ok(takeBtns.indexOf('c1') >= 0 && takeBtns.indexOf('c2') < 0, 'زرار الاسترجاع للبنت اللي فيها كمية بس');

  // توزيع 3 لأحمر — الفيصل الأرقام بعد النقل مش نجاح النداء (درس 34)
  await p.click('.pe-var-give[data-vid="c1"]');
  await p.waitForSelector('.pe-var-qty-inp');
  await p.fill('.pe-var-qty-inp', '3');
  await p.evaluate(() => { [...document.querySelectorAll('.pe-var-btn.ok')].find(b => b.textContent === 'تم').click(); });
  await p.waitForSelector('#pe-vars');
  await p.waitForTimeout(300);
  const rpcCall = await p.evaluate(() => window.__calls.filter(c => c.rpc === 'transfer_stock').pop());
  ok(rpcCall && rpcCall.args.p_from === 'p1' && rpcCall.args.p_to === 'c1' && rpcCall.args.p_qty === 3,
     'transfer_stock اتنده بالاتجاه الصح (من غير الموزع → أحمر)');
  vsec = await txt(p, '#pe-vars');
  ok(vsec.indexOf('غير الموزع: 2') >= 0, 'بعد التوزيع: غير الموزع بقى 2');
  const redQty = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.pe-var-row')].find(r => r.textContent.indexOf('أحمر') >= 0);
    return row ? row.querySelector('.pe-var-qty').textContent.trim() : null;
  });
  ok(digits(redQty) === 11, `وأحمر بقى 11 — ${redQty}`);

  // استرجاع 1 من أحمر
  await p.click('.pe-var-take[data-vid="c1"]');
  await p.waitForSelector('.pe-var-qty-inp');
  await p.fill('.pe-var-qty-inp', '1');
  await p.evaluate(() => { [...document.querySelectorAll('.pe-var-btn.ok')].find(b => b.textContent === 'تم').click(); });
  await p.waitForSelector('#pe-vars');
  await p.waitForTimeout(300);
  const rpcBack = await p.evaluate(() => window.__calls.filter(c => c.rpc === 'transfer_stock').pop());
  ok(rpcBack && rpcBack.args.p_from === 'c1' && rpcBack.args.p_to === 'p1' && rpcBack.args.p_qty === 1,
     'الاسترجاع بالاتجاه المعكوس (أحمر → غير الموزع)');
  ok((await txt(p, '#pe-vars')).indexOf('غير الموزع: 3') >= 0, 'غير الموزع رجع 3');

  // إضافة خاصية — من غير إرسال name (السيرفر هو اللي بيولّده)
  await p.fill('#pe-var-new', 'روز');
  await p.click('#pe-var-add');
  await p.waitForTimeout(300);
  const varIns = await p.evaluate(() =>
    window.__calls.filter(c => c.table === 'stock_products' && c.payload && c.payload.variant_label).pop());
  ok(varIns && varIns.payload.parent_id === 'p1' && varIns.payload.variant_label === 'روز'
       && !('name' in varIns.payload) && varIns.payload.current_qty === 0,
     'إضافة خاصية: parent_id + لابل من غير name ومن غير كمية مخترعة');

  // ════ محرر الخاصية نفسها ════
  await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); });
  await p.click('#prod-tbody tr.fam-row[data-fam="p1"]');
  await p.waitForTimeout(150);
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#prod-tbody tr.var-row[data-parent="p1"]')];
    const red = rows.find(r => r.textContent.indexOf('أحمر') >= 0);
    red.querySelector('.prod-edit-btn').click();
  });
  await p.waitForSelector('#pe-label');
  ok(await txt(p, '#dtit') === 'تعديل الخاصية', 'عنوان محرر الخاصية');
  ok(await p.$('#pe-name') === null, 'مفيش خانة اسم كامل — الاسم بيتولّد على السيرفر');
  ok(await p.$eval('#pe-label', i => i.value) === 'أحمر', 'خانة اللابل فيها «أحمر»');
  const parentShown = await p.evaluate(() => document.getElementById('dcnt').textContent.indexOf('ترولي تست') >= 0);
  ok(parentShown, 'اسم الأم معروض للسياق');
  await p.fill('#pe-label', 'أحمر غامق');
  await p.click('#pe-save');
  await p.waitForTimeout(300);
  const labelUpd = await p.evaluate(() =>
    window.__calls.filter(c => c.table === 'stock_products' && c.payload && c.payload.variant_label).pop());
  ok(labelUpd && labelUpd.payload.variant_label === 'أحمر غامق' && !('name' in labelUpd.payload),
     'تعديل اللابل بيبعت variant_label بس — الاسم بيتجدد من الحارس');

  // ════ حراسات الحذف ════
  console.log('──── حراسات الحذف ────');
  await p.click('#prod-tbody tr.fam-row[data-fam="p1"] .prod-edit-btn');
  await p.waitForSelector('#pe-vars');
  await p.click('#pe-del');
  await p.waitForTimeout(200);
  let delCalls = await p.evaluate(() => window.__calls.filter(c => c.table === 'stock_products' && !c.payload && !c.cols).length);
  const stillOpen = await p.evaluate(() => document.getElementById('ovl').classList.contains('open'));
  ok(stillOpen, 'حذف أم ليها خصائص اترفض والمودال لسه مفتوح');
  await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); });
  await p.close();
}

// ════ 7) الموظف: مفيش أعمدة أسعار جملة ولا أزرار تعديل — والعيلات شغالة ════
{
  const p = await openApp({ role:'employee' });
  console.log('──── واجهة الموظف ────');
  const emp = await p.evaluate(() => ({
    fam: !!document.querySelector('#prod-tbody tr.fam-row[data-fam="p1"]'),
    editBtns: document.querySelectorAll('#prod-tbody .prod-edit-btn').length,
    headCols: document.querySelectorAll('#prod-tbody thead th').length
  }));
  ok(emp.fam && emp.editBtns === 0 && emp.headCols === 3, 'الموظف بيشوف العيلات من غير تعديل ولا أسعار جملة');
  await p.close();
}

// ════ المعايرات ════
console.log('──── معايرات ────');
// (أ) ضياع أعمدة الربط (select ناسي parent_id — درس 33): الفحوص الأساسية لازم تقع
{
  const broken = STOCK.map(({ parent_id, variant_label, ...rest }) => rest);
  const p = await openApp({ stock: broken });
  const sig = await p.evaluate(() => ({
    products: document.getElementById('st-products').textContent,
    fams: document.querySelectorAll('#prod-tbody tr.fam-row').length,
    empty: document.getElementById('st-empty').textContent
  }));
  ok(sig.products === '7' && sig.fams === 0 && sig.empty === '3',
     `معايرة أ: من غير parent_id الكروت بتنقلب (7 منتجات/3 نواقص/صفر عيلات) — فحوص 1+3+4 كانت هتقع — ${JSON.stringify(sig)}`);
  await p.close();
}
// (ب) سواب اتجاه التوزيع: الأرقام بعد النقل هي اللي بتمسكه
{
  const p = await openApp();
  await p.evaluate(() => { window.__RPC_SWAP = true; });
  await p.click('#prod-tbody tr.fam-row[data-fam="p1"] .prod-edit-btn');
  await p.waitForSelector('#pe-vars');
  await p.click('.pe-var-give[data-vid="c1"]');
  await p.waitForSelector('.pe-var-qty-inp');
  await p.fill('.pe-var-qty-inp', '3');
  await p.evaluate(() => { [...document.querySelectorAll('.pe-var-btn.ok')].find(b => b.textContent === 'تم').click(); });
  await p.waitForSelector('#pe-vars');
  await p.waitForTimeout(300);
  const v = await txt(p, '#pe-vars');
  ok(v.indexOf('غير الموزع: 8') >= 0,
     'معايرة ب: توزيع معكوس (سواب) بيبان فوراً في الأرقام (غير الموزع 8 بدل 2) — فحص الأرقام بيمسكه');
  await p.close();
}
// (ج) درس 31 بالحرف: عنصر جاي بعد الجدول بيرسم فوق صف العيلة → الـhit-test يقع
{
  const p = await openApp();
  await p.evaluate(() => {
    const r = document.querySelector('#prod-tbody tr.fam-row[data-fam="p1"]');
    const b = r.getBoundingClientRect();
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:'+b.left+'px;top:'+b.top+'px;width:'+b.width+'px;height:'+b.height+'px;z-index:50;background:transparent';
    document.body.appendChild(d);
  });
  const buried = await p.evaluate(() => {
    const r = document.querySelector('#prod-tbody tr.fam-row[data-fam="p1"]');
    const b = r.getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
    return !(el && r.contains(el));
  });
  ok(buried, 'معايرة ج: عنصر مغطي = الـhit-test بيرجّع غيره — فحص الدفن شغال');
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
