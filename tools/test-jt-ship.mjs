// نافذة شحن J&T في اللوحة (ship.js jtShipFlow) + طباعة القالب المعتمد (jt-awb.js).
//
// اللي بيتأكد هنا (الستب — من غير أي شبكة):
//  1) تاجر shipping_provider='jt' بيشوف زرار «شحن J&T» حتى من غير مفتاح بوسطة
//  2) النافذة بتحمّل المحافظات/المدن من jt_pca **بصفوف area='' بس** وبتقترح المحافظة من
//     مدينة الأوردر. 🔴 المنطقة خانة كتابة حرة (قرار 21 سبتمبر) — مش select، والاقتراحات
//     جاية من app/data/jt-areas.json مش من الجدول. منطقة فاضية = رفض قبل الإرسال.
//  3) الإرسال لـjt-ship بيشيل order_id + receiver{prov,city,area} + weight_kg — ومفيش tenant_id
//     وarea = النص المكتوب بالحرف (حتى لو مش في أي صف)
//  4) نجاح الـEF → الصف بياخد البوليصة وكود الفرز والحالة، والزرار بيختفي
//  5) فشل الـEF → الرسالة بتظهر في النافذة ومفيش نجاح كاذب
//  6) المعايرات: شيل receiver من الحمولة · شيل تطبيق .eq('area','') في الستب ·
//     ملف الاقتراحات بيقع → الشحن لازم يفضل شغّال (الاقتراحات مش قيد)
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

// زي الحي بعد migration jt_pca_cities_from_jt_it: كل الصفوف area='' (فهرس المدن).
// 🔴 صف id:2 فيه area وصف id:5 مدينته **مالهاش صف فاضي** — الاتنين موجودين عشان
// يثبتوا إن .eq('area','') بتتطبّق فعلاً: «الحي العاشر» مايظهرش كاقتراح، و«أكتوبر»
// مايظهرش في قايمة المدن. من غير الصفين دول الفحص أعمى (درس الستب اللي بيقبل
// الميثود ومابيطبّقهاش — 19 سبتمبر).
const PCA = [
  { id:1, prov:'القاهرة', city:'مدينة نصر', area:'' },
  { id:2, prov:'القاهرة', city:'مدينة نصر', area:'الحي العاشر' },
  { id:3, prov:'القاهرة', city:'المعادي', area:'' },
  { id:4, prov:'الجيزة', city:'الدقي', area:'' },
  { id:5, prov:'الجيزة', city:'أكتوبر', area:'الحي الأول' },
];
// اقتراحات الـdatalist — المصدر الوحيد بقى الملف الساكن مش الجدول
const AREAS = { 'القاهرة': { 'مدينة نصر': ['الحي الخامس', 'الحي الثامن'] } };
const FREE_AREA = 'الحي السابع — أمام قسم أول';   // مش في الاقتراحات: لازم يعدّي زي ما هو

async function openApp(pre, opts){
  opts = opts || {};
  const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
  // ملف الاقتراحات بيتخدم من الفيكستشر — عشان الفحص مايعتمدش على محتوى app/data الحقيقي
  await p.route('**/data/jt-areas.json', r => opts.areasFail
    ? r.fulfill({ status: 404, body: 'not found' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AREAS) }));
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  await p.addInitScript(`window.__TENANT = { shipping_provider: 'jt', has_shipping_api: false, sender_name: 'عتبة', sender_phone: '01200000000', sender_prov: 'القاهرة', sender_city: 'مدينة نصر', sender_area: 'الحي السابع', sender_street: 'شارع تجريبي 1' };
    window.__JT_PCA = ${JSON.stringify(PCA)};` + (pre || ''));
  await p.addInitScript(STUB);
  // الستب مايعرفش jt_pca — نلفّ from() عشان يرجّع الفيكستشر بالصفحات زي PostgREST
  await p.addInitScript(`(function(){
    var mk = window.supabase.createClient;
    window.supabase.createClient = function(){
      var c = mk.apply(this, arguments), from = c.from.bind(c);
      c.from = function(t){
        if(t !== 'jt_pca') return from(t);
        var q = { _from:0, _to:999, _eq:[] };
        q.select = function(){ return q; }; q.order = function(){ return q; };
        q.eq = function(col, val){ q._eq.push([col, val]); return q; };
        q.range = function(a, b){ q._from = a; q._to = b; return q; };
        q.then = function(res){
          // 🔴 الـeq بتتطبّق فعلاً — ستب بيقبلها ومايطبّقهاش بيخلي الفحص أعمى
          var rows = window.__JT_PCA.filter(function(r){
            return window.__EQ_OFF || q._eq.every(function(e){ return r[e[0]] === e[1]; });
          });
          return Promise.resolve({ data: rows.slice(q._from, q._to + 1), error:null }).then(res);
        };
        return q;
      };
      return c;
    };
  })();`);
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return p;
}
async function openDetailOf(p, orderId){
  await p.evaluate((id) => { const tr = document.querySelector('#tbody tr[data-id="' + id + '"]'); if(tr) tr.click(); }, orderId);
  await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
  await p.waitForTimeout(250);
}
// أوردر مؤكد من غير بوليصة في الستب
async function pickOrder(p){
  return await p.evaluate(() => {
    const o = (window.__ORDERS || []).filter(x => (x.status === 'confirmed' || x.status === 'pending') && !(x.tracking_no || '').trim())[0];
    if(o){ o.city = 'القاهره'; }
    return o ? o.id : null;
  });
}

const FN_OK = `window.__FNCALLS = []; window.__FETCH_BODIES = [];
  (function(){ var of = window.fetch; window.fetch = function(u, init){
    if(String(u).indexOf('/functions/v1/jt-ship') >= 0){
      var body = JSON.parse(init.body); window.__FETCH_BODIES.push(body);
      if(window.__JT_FAIL) return Promise.resolve(new Response(JSON.stringify({ error:'address_not_in_pca', message: window.__JT_FAIL }), { status: 422, headers:{ 'Content-Type':'application/json' } }));
      var o = (window.__ORDERS || []).filter(function(x){ return x.id === body.order_id; })[0];
      if(o){ o.tracking_no = 'UEG088902573105'; o.status = 'BOSTA AUTO'; o.shipping_carrier = 'jt'; o.jt_sorting_code = '20,J01-01,000'; }
      return Promise.resolve(new Response(JSON.stringify({ ok:true, tracking_no:'UEG088902573105', sorting_code:'20,J01-01,000', record:{ status:'BOSTA AUTO' } }), { status: 200, headers:{ 'Content-Type':'application/json' } }));
    }
    return of.apply(this, arguments);
  }; })();`;

// ════ 1–4) المسار الناجح ════
{
  const p = await openApp(FN_OK);
  const id = await pickOrder(p);
  ok(!!id, 'فيه أوردر قابل للشحن في الستب');
  await openDetailOf(p, id);
  const btn = await p.$('#ship-auto');
  ok(!!btn, 'زرار الشحن ظاهر لتاجر J&T من غير has_shipping_api');
  ok((await p.textContent('#ship-auto')).indexOf('J&T') >= 0, 'الزرار بيقول J&T مش «أوتوماتيك»');
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open');
  await p.waitForFunction(() => !document.getElementById('jt-go').disabled);
  ok(await p.$eval('#jt-prov', s => s.value) === 'القاهرة', 'المحافظة اتقترحت من «القاهره» بالتطبيع');
  ok((await p.$$eval('#jt-city option', o => o.length)) === 3, 'قايمة المدن = مدن المحافظة + placeholder (2+1)');
  ok(!(await p.$$eval('#jt-prov option', o => o.map(x => x.value))).includes('أكتوبر'), 'ضابط: المحافظات مش فيها اسم مدينة');
  await p.selectOption('#jt-city', 'مدينة نصر');
  ok(await p.$eval('#jt-area', el => el.tagName === 'INPUT' && el.getAttribute('list') === 'jt-area-list'), 'المنطقة خانة كتابة حرة (input + datalist) مش select');
  await p.waitForFunction(() => document.querySelectorAll('#jt-area-list option').length > 0, { timeout: 8000 });
  const sugg = await p.$$eval('#jt-area-list option', o => o.map(x => x.value));
  ok(sugg.join('|') === 'الحي الخامس|الحي الثامن', 'الاقتراحات جاية من jt-areas.json: ' + sugg.join('|'));
  ok(!sugg.includes('الحي العاشر'), 'وصف الـarea اللي في jt_pca مش بيتعرض — الجدول بقى فهرس مدن بس');
  // منطقة فاضية = رفض قبل أي إرسال
  await p.fill('#jt-area', '   ');
  await p.click('#jt-go');
  await p.waitForFunction(() => document.getElementById('jt-err').textContent.length > 0);
  ok((await p.textContent('#jt-err')).indexOf('اكتب المنطقة') >= 0 && (await p.evaluate(() => window.__FETCH_BODIES.length)) === 0, 'منطقة فاضية → رسالة ومفيش إرسال');
  await p.fill('#jt-area', '  ' + FREE_AREA + '  ');
  await p.fill('#jt-weight', '1.5');
  // hit-test: زرار الإنشاء مش مدفون (درس 31)
  const hit = await p.evaluate(() => { const r = document.getElementById('jt-go').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return el && (el.id === 'jt-go' || el.closest('#jt-go') !== null); });
  ok(hit, 'زرار الإنشاء شايفه الماوس (elementFromPoint)');
  await p.click('#jt-go');
  await p.waitForFunction(() => document.getElementById('jt-done').style.display !== 'none', { timeout: 8000 });
  const body = await p.evaluate(() => window.__FETCH_BODIES[0]);
  ok(body && body.order_id === id, 'الحمولة فيها order_id');
  ok(body && !('tenant_id' in body), 'ومفيش tenant_id — السيرفر بياخده من الـJWT');
  ok(body && body.receiver && body.receiver.prov === 'القاهرة' && body.receiver.city === 'مدينة نصر' && body.receiver.area === FREE_AREA, 'receiver = المحافظة/المدينة من القايمة + المنطقة المكتوبة بالحرف (بعد trim)');
  ok(body && body.weight_kg === 1.5, 'weight_kg = 1.5');
  ok((await p.textContent('#jt-note')).indexOf('20,J01-01,000') >= 0, 'كود الفرز اتعرض بالحرف زي ما J&T رجّعته');
  const row = await p.evaluate((id) => { return (window.__ORDERS || []).filter(x => x.id === id)[0]; }, id);
  ok(row.tracking_no === 'UEG088902573105' && row.status === 'BOSTA AUTO', 'الصف أخد البوليصة والحالة');
  const cell = await p.$eval('#tbody tr[data-id="' + id + '"] .awb-cell', td => td.textContent);
  ok(cell.indexOf('UEG088902573105') >= 0, 'الجدول بيعرض رقم البوليصة');
  ok(!!(await p.$('#jt-print')), 'زرار «اطبع البوليصة المعتمدة» ظهر بعد النجاح');
  // الطباعة: نافذة جديدة فيها label واحد بالباركود وكود الفرز والملاحظات
  const [popup] = await Promise.all([ p.waitForEvent('popup'), p.click('#jt-print') ]);
  await popup.waitForFunction(() => document.querySelectorAll('.label').length > 0);
  await popup.waitForTimeout(400);
  const lab = await popup.evaluate(() => {
    const l = document.querySelector('.label'); const r = l.getBoundingClientRect();
    const mm = px => px / 96 * 25.4;
    const bc = document.querySelector('.bc svg').getBoundingClientRect();
    const sortBox = document.querySelector('.sort-box').getBoundingClientRect();
    return { w: mm(r.width), h: mm(r.height), bcW: mm(bc.width), bcH: mm(bc.height), sortW: mm(sortBox.width), sortH: mm(sortBox.height),
      sort: document.querySelector('.sort-text').textContent, wb: document.querySelector('.wb').textContent,
      lines: document.querySelectorAll('.items-list li').length, rects: document.querySelectorAll('.bc svg rect').length, labels: document.querySelectorAll('.label').length };
  });
  ok(Math.abs(lab.w - 100) < 0.6 && Math.abs(lab.h - 150) < 0.6, 'البوليصة 100×150 مم (' + lab.w.toFixed(1) + '×' + lab.h.toFixed(1) + ')');
  ok(Math.abs(lab.bcW - 70) < 0.3 && Math.abs(lab.bcH - 10) < 0.3, 'الباركود 70×10 مم');
  ok(Math.abs(lab.sortW - 35) < 0.3 && Math.abs(lab.sortH - 10) < 0.3, 'صندوق كود الفرز 35×10 مم');
  ok(lab.sort === '20,J01-01,000', 'كود الفرز مطبوع بالحرف: ' + lab.sort);
  ok(lab.wb === 'UEG088902573105' && lab.rects > 20, 'رقم البوليصة + باركود مرسوم (' + lab.rects + ' rect)');
  ok(lab.lines >= 1 && lab.labels === 1, 'الملاحظات فيها ' + lab.lines + ' سطر · بوليصة واحدة');
  await popup.close();
  await p.click('#jt-close');
  await p.close();
}

// ════ 5) فشل الـEF → رسالة في النافذة، مفيش نجاح كاذب ════
{
  const p = await openApp(FN_OK + " window.__JT_FAIL = 'العنوان (x) مش في نطاق J&T المتسجّل';");
  const id = await pickOrder(p);
  await openDetailOf(p, id);
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open');
  await p.waitForFunction(() => !document.getElementById('jt-go').disabled);
  await p.selectOption('#jt-city', 'مدينة نصر'); await p.fill('#jt-area', 'الحي السابع');
  await p.click('#jt-go');
  await p.waitForFunction(() => document.getElementById('jt-err').textContent.length > 0, { timeout: 8000 });
  ok((await p.textContent('#jt-err')).indexOf('نطاق J&T') >= 0, 'سبب الرفض الحقيقي ظاهر في النافذة');
  ok(await p.$eval('#jt-done', d => d.style.display === 'none'), 'ومفيش زرار طباعة — مفيش نجاح كاذب');
  const row = await p.evaluate((id) => (window.__ORDERS || []).filter(x => x.id === id)[0], id);
  ok(!(row.tracking_no || '').trim(), 'والصف من غير بوليصة');
  await p.close();
}

// ════ 6) معايرة: شيل receiver من الحمولة → الفحص بيقع ════
{
  const src = fs.readFileSync(new URL('../app/js/orders/ship.js', import.meta.url), 'utf8');
  const ANCHOR = "body: JSON.stringify({ order_id: ord.id, receiver: { prov: prov, city: city, area: area }, weight_kg: w })";
  if(src.indexOf(ANCHOR) < 0) throw new Error('المعايرة مالقتش المرساة');
  const tampered = src.replace(ANCHOR, "body: JSON.stringify({ order_id: ord.id, weight_kg: w })");
  const p = await openApp(FN_OK);
  await p.route('**/js/orders/ship.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: tampered }));
  await p.reload({ waitUntil:'networkidle' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  const id = await pickOrder(p);
  await openDetailOf(p, id);
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open');
  await p.waitForFunction(() => !document.getElementById('jt-go').disabled);
  await p.selectOption('#jt-city', 'مدينة نصر'); await p.fill('#jt-area', 'الحي السابع');
  await p.click('#jt-go');
  await p.waitForFunction(() => window.__FETCH_BODIES.length > 0, { timeout: 8000 });
  const body = await p.evaluate(() => window.__FETCH_BODIES[0]);
  ok(!body.receiver, 'معايرة: من غير receiver الفحص (3) كان هيقع');
  await p.close();
}

// ════ 7) معايرة: الستب يتجاهل .eq → مدينة مالهاش صف area='' بتظهر في القايمة ════
{
  const p = await openApp(FN_OK + ' window.__EQ_OFF = 1;');
  const id = await pickOrder(p);
  await openDetailOf(p, id);
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open');
  await p.waitForFunction(() => !document.getElementById('jt-go').disabled);
  await p.selectOption('#jt-prov', 'الجيزة');
  const cities = await p.$$eval('#jt-city option', o => o.map(x => x.value));
  ok(cities.includes('أكتوبر'), 'معايرة: من غير تطبيق .eq(area,\'\') «أكتوبر» بتظهر — يعني الفحص بيحمل حمل');
  await p.close();
}

// ════ 8) ملف الاقتراحات وقع → الشحن لازم يفضل شغّال (الاقتراحات مش قيد) ════
{
  const p = await openApp(FN_OK, { areasFail: true });
  const id = await pickOrder(p);
  await openDetailOf(p, id);
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open');
  await p.waitForFunction(() => !document.getElementById('jt-go').disabled);
  await p.selectOption('#jt-city', 'مدينة نصر');
  ok((await p.$$eval('#jt-area-list option', o => o.length)) === 0, 'ملف الاقتراحات وقع → datalist فاضية');
  ok((await p.textContent('#jt-err')) === '', 'ومفيش رسالة خطأ — دي اقتراحات مش قيد');
  await p.fill('#jt-area', FREE_AREA);
  await p.click('#jt-go');
  await p.waitForFunction(() => document.getElementById('jt-done').style.display !== 'none', { timeout: 8000 });
  const body = await p.evaluate(() => window.__FETCH_BODIES[0]);
  ok(body && body.receiver && body.receiver.area === FREE_AREA, 'والشحنة اتعملت بالمنطقة المكتوبة — من غير أي اقتراح');
  await p.close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
