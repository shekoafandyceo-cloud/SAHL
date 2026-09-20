// نافذة شحن J&T في اللوحة (ship.js jtShipFlow) + طباعة القالب المعتمد (jt-awb.js).
//
// اللي بيتأكد هنا (الستب — من غير أي شبكة):
//  1) تاجر shipping_provider='jt' بيشوف زرار «شحن J&T» حتى من غير مفتاح بوسطة
//  2) النافذة بتحمّل نطاق J&T من jt_pca وبتقترح المحافظة من مدينة الأوردر
//  3) الإرسال لـjt-ship بيشيل order_id + receiver{prov,city,area} + weight_kg — ومفيش tenant_id
//  4) نجاح الـEF → الصف بياخد البوليصة وكود الفرز والحالة، والزرار بيختفي
//  5) فشل الـEF → الرسالة بتظهر في النافذة ومفيش نجاح كاذب
//  6) المعايرة: شيل receiver من الحمولة → الفحص (3) بيقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

const PCA = [
  { id:1, prov:'القاهرة', city:'مدينة نصر', area:'الحي السابع' },
  { id:2, prov:'القاهرة', city:'مدينة نصر', area:'الحي العاشر' },
  { id:3, prov:'القاهرة', city:'المعادي', area:'المعادي الجديدة' },
  { id:4, prov:'الجيزة', city:'الدقي', area:'الدقي' },
];

async function openApp(pre){
  const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
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
        var q = { _from:0, _to:999 };
        q.select = function(){ return q; }; q.order = function(){ return q; };
        q.range = function(a, b){ q._from = a; q._to = b; return q; };
        q.then = function(res){ return Promise.resolve({ data: window.__JT_PCA.slice(q._from, q._to + 1), error:null }).then(res); };
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
  await p.selectOption('#jt-city', 'مدينة نصر');
  await p.selectOption('#jt-area', 'الحي العاشر');
  await p.fill('#jt-weight', '1.5');
  // hit-test: زرار الإنشاء مش مدفون (درس 31)
  const hit = await p.evaluate(() => { const r = document.getElementById('jt-go').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return el && (el.id === 'jt-go' || el.closest('#jt-go') !== null); });
  ok(hit, 'زرار الإنشاء شايفه الماوس (elementFromPoint)');
  await p.click('#jt-go');
  await p.waitForFunction(() => document.getElementById('jt-done').style.display !== 'none', { timeout: 8000 });
  const body = await p.evaluate(() => window.__FETCH_BODIES[0]);
  ok(body && body.order_id === id, 'الحمولة فيها order_id');
  ok(body && !('tenant_id' in body), 'ومفيش tenant_id — السيرفر بياخده من الـJWT');
  ok(body && body.receiver && body.receiver.prov === 'القاهرة' && body.receiver.city === 'مدينة نصر' && body.receiver.area === 'الحي العاشر', 'receiver = الاختيار الثلاثي بأسماء J&T');
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
  await p.selectOption('#jt-city', 'مدينة نصر'); await p.selectOption('#jt-area', 'الحي السابع');
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
  await p.selectOption('#jt-city', 'مدينة نصر'); await p.selectOption('#jt-area', 'الحي السابع');
  await p.click('#jt-go');
  await p.waitForFunction(() => window.__FETCH_BODIES.length > 0, { timeout: 8000 });
  const body = await p.evaluate(() => window.__FETCH_BODIES[0]);
  ok(!body.receiver, 'معايرة: من غير receiver الفحص (3) كان هيقع');
  await p.close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
