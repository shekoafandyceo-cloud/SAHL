// نسبة استلام العميل (7 أكتوبر — طلب المالك): EasyOrders (تصنيف) + شركة الشحن (نسبة %).
//
// على السيرفر: trg_eo_rate_capture بيحسب eo_rate/eo_rate_alt من eo_metadata (اتجرّب بترانزاكشن
// راجعة على الحي). هنا الواجهة بس (الستب — من غير شبكة):
//  1–6) شارات الجدول: high/moderate/low/unknown بنفس مفردات شارة الشحن (جامد/متوسط/زبالة/جديد) ·
//       pending وقيمة جديدة = مفيش شارة · شارة الشحن القديمة فاضلة زي ما هي
//  7–14) قسم «نسبة استلام العميل» في التفاصيل: الشريط 5/3/1/0 · الرقم الإضافي · pending بالكلام ·
//       مفيش تقييم · مفيش بيانات شحن · قيمة جديدة متهرّبة (XSS) · السطر القديم «سمعة العميل» اتشال
//
// المعايرات (لازم تقع على الكود المحقون):
//  (أ) شيل eo_rate من ORDER_LIST_COLS → الستب بيقطع العمود فشارات الجدول تختفي (درس 33)
//  (ب) pending ياخد شارة → فحص 5 يقع
//  (ج) شيل esc من القيمة الجديدة → فحص XSS يقع
//  (د) شيل القسم من التفاصيل → فحوص التفاصيل تقع
//  (هـ) شارتين في خانة الاسم (الشكل اللي اتقص في الصورة) → فحص 5ب يقع
//  (و) حدث ريل-تايم بنسبة الاستلام بس يعمل رسم كامل للنافذة → فحص 15 يقع (الكلام اللي بيتكتب بيضيع)
//
// 15–17) الريل-تايم (8 أكتوبر — مراجعة سحب EasyOrders): سحب التقييم بيعمل UPDATE بعد ~45ث–3د من نزول
//        الأوردر. الحدث ده لازم يبدّل قسم النسبة بس — مايمسحش اللي الموظف بيكتبه في النافذة. وأي تغيير
//        تاني (الحالة) = رسم كامل زي الأول.
// 18–28) شركة الشحن (10 أكتوبر — ship-rank-sync): ship_rank/ship_rank_n/ship_rank_at + الخام بالعدّ · الشارة = متوسط
//        المصدرين (EasyOrders 100/60/20 + نسبة شركة الشحن) · «جديد» عند الاتنين · الجديد بيكسب القديم (customer_ranking) ·
//        سطر المتوسط والرقم الإضافي في التفاصيل · وحدث شركة الشحن في الريل-تايم مابيمسحش الكلام.
//  (ز) EasyOrders الأول بدل المتوسط → 21 يقع · (ح) القديم يكسب الجديد → 22 يقع · (ط) شيل ship_rank من ORDER_LIST_COLS →
//  18 يقع · (ي) شيل أعمدة شركة الشحن من RT_SCORE_COLS → 28 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// o1 high + شحن 90 · o2 moderate (مفيش شحن) · o3 low + رقم إضافي unknown · o4 unknown ·
// o5 pending · o6 مفيش EasyOrders + شحن 40 · o7 قيمة جديدة فيها HTML
const FIX = `(function(){
  var set = function(id, patch){ var o = window.__ORDERS.find(function(x){ return x.id === id; }); Object.assign(o, patch); };
  set('o1', { eo_rate:'high', customer_ranking:90 });
  set('o2', { eo_rate:'moderate' });
  set('o3', { eo_rate:'low', alt_phone:'01222222222', eo_rate_alt:'unknown' });
  set('o4', { eo_rate:'unknown' });
  set('o5', { eo_rate:'pending' });
  set('o6', { customer_ranking:40 });
  var o2 = window.__ORDERS.find(function(x){ return x.id === 'o2'; });
  window.__ORDERS.push(Object.assign({}, o2, { id:'o7', order_uid:'9007', phone:'01000000007', eo_rate:'<b id="xss">v</b>' }));
  // شركة الشحن (ship-rank-sync): [اتسلّم, رجع] في الخام — والجدول بيقرا ship_rank/ship_rank_n/ship_rank_at بس
  var part = function(ph, d, r){ var n = d + r; return { phone10: ph, found: n > 0, delivered: d, returned: r, rate: n ? Math.round(10000 * d / n) / 100 : null }; };
  var sr = function(ph, d, r, alt){
    var pr = part(ph, d, r), al = alt ? part(alt[0], alt[1], alt[2]) : null;
    return { ship_rank: pr.rate, ship_rank_n: d + r, ship_rank_alt: al ? al.rate : null, ship_rank_alt_n: al ? al.delivered + al.returned : null,
             ship_rank_at: '2026-10-10T11:00:00+00:00', ship_rank_raw: { at: '2026-10-10T11:00:00+00:00', primary: pr, alt: al } };
  };
  var mk = function(id, uid, ph, patch){ window.__ORDERS.push(Object.assign({}, o2, { id: id, order_uid: uid, phone: ph, eo_rate: null, eo_rate_alt: null, alt_phone: null, customer_ranking: null }, patch)); };
  mk('o8',  '9008',  '01000000008', Object.assign({ eo_rate: 'unknown' }, sr('1000000008', 7, 16)));              // EasyOrders جديد + شركة الشحن 30.4% = زبالة
  mk('o9',  '9009',  '01000000009', Object.assign({ eo_rate: 'high' }, sr('1000000009', 0, 0)));                  // شركة الشحن جديد → EasyOrders لوحده = جامد
  mk('o10', '90010', '01000000010', sr('1000000010', 0, 0));                                                      // جديد عند الاتنين (مفيش EasyOrders) = «جديد»
  mk('o11', '90011', '01000000011', Object.assign({ eo_rate: 'low', alt_phone: '01233334444' },
     sr('1000000011', 2, 0, ['1233334444', 5, 5])));                                                             // 20 + 100 = 60 متوسط · إضافي 50%
  mk('o12', '90012', '01000000012', Object.assign({ customer_ranking: 90 }, sr('1000000012', 10, 12)));            // الجديد 45.5% يكسب القديم 90
})();`;

const FILES = {
  orders: '../app/js/orders/orders.js',
  score: '../app/js/orders/delivery-score.js',
  detail: '../app/js/orders/detail.js'
};
async function openApp(patches){
  patches = patches || {};
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  await p.addInitScript(STUB);
  await p.addInitScript(FIX);
  for(const k of Object.keys(patches)){
    const src = fs.readFileSync(new URL(FILES[k], import.meta.url), 'utf8');
    const out = patches[k](src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة: ' + k);
    const name = FILES[k].split('/').pop();
    await p.route('**/js/orders/' + name, r =>
      r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(URL_, { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-orders', { state: 'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length >= 12);
  return p;
}
async function badges(p){
  return p.evaluate(() => {
    const r = {};
    document.querySelectorAll('#tbody tr[data-id]').forEach(tr => {
      const nm = tr.querySelector('td.nm');
      const bd = nm && nm.querySelector('.ds-badge');
      r[tr.dataset.id] = { eo: bd ? bd.className + '|' + bd.textContent : null, eoTitle: bd ? bd.title : null, n: nm ? nm.querySelectorAll('.rk-badge').length : 0 };
    });
    return r;
  });
}
async function detail(p, id){
  await p.evaluate(i => { const tr = document.querySelector('#tbody tr[data-id="' + i + '"]'); if(tr) tr.click(); }, id);
  const uid = '900' + id.slice(1);   // o10 → 90010
  await p.waitForFunction(u => { const t = document.getElementById('dtit'); return t && t.textContent.indexOf(u) >= 0 && document.querySelector('#dcnt .dsec'); }, uid, { timeout: 8000 });
  await p.waitForTimeout(120);
  const r = await p.evaluate(() => {
    const t = id => { const el = document.getElementById(id); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };
    const meter = document.querySelector('#ds-eo .eo-meter');
    return {
      sec: !!document.getElementById('ds-sec'),
      eo: t('ds-eo'), alt: t('ds-eo-alt'), ship: t('ds-ship'), shipAlt: t('ds-ship-alt'), avg: t('ds-avg'),
      on: meter ? meter.querySelectorAll('i.on').length : null,
      cells: meter ? meter.querySelectorAll('i').length : null,
      xss: !!document.querySelector('#dcnt #xss'),
      oldRow: (document.getElementById('dcnt').textContent || '').indexOf('سمعة العميل') >= 0
    };
  });
  await p.evaluate(() => { const c = document.querySelector('#ovl .dclose, #ovl [data-act="closeDetail"]'); if(c) c.click(); else document.getElementById('ovl').classList.remove('open'); });
  await p.waitForTimeout(80);
  return r;
}
async function runAll(patches){
  const p = await openApp(patches);
  const res = { b: await badges(p) };
  for(const id of ['o1','o2','o3','o4','o5','o6','o7','o8','o9','o10','o11','o12']) res[id] = await detail(p, id);
  await p.close();
  return res;
}

console.log('— الجدول');
const R = await runAll();
const B = R.b;
ok(B.o1 && /rk-good/.test(B.o1.eo || '') && /جامد/.test(B.o1.eo || ''), '1) high = «جامد» أخضر — ' + (B.o1 && B.o1.eo));
ok(B.o2 && /rk-mid/.test(B.o2.eo || '') && /متوسط/.test(B.o2.eo || ''), '2) moderate = «متوسط»');
ok(B.o3 && /rk-bad/.test(B.o3.eo || '') && /زبالة/.test(B.o3.eo || ''), '3) low = «زبالة»');
ok(B.o4 && /rk-new/.test(B.o4.eo || '') && /جديد/.test(B.o4.eo || ''), '4) unknown = «جديد» رمادي');
ok(B.o5 && B.o5.eo === null && B.o7 && B.o7.eo === null, '5) pending وقيمة جديدة = مفيش شارة في الجدول');
ok(Object.keys(B).every(k => B[k].n <= 1), '5ب) عمرها ما بتبقى أكتر من شارة واحدة في خانة الاسم');
ok(B.o1 && /rk-good/.test(B.o1.eo || '') && /متوسط المصدرين: 95/.test(B.o1.eoTitle || '') && /90\.0%/.test(B.o1.eoTitle || '') && /مرتفعة/.test(B.o1.eoTitle || '')
  && B.o6 && /rk-bad/.test(B.o6.eo || '') && /40\.0%/.test(B.o6.eoTitle || '') && !/EasyOrders/.test(B.o6.eoTitle || '') && !/شركة الشحن/.test(B.o2.eoTitle || ''),
  '6) شارة واحدة بس: الاتنين = المتوسط (100+90)/2 = 95 جامد وتلميحها فيه الاتنين · شحن لوحده = 40% زبالة — ' + (B.o1 && B.o1.eoTitle));
console.log('— شركة الشحن (ship-rank-sync) + المتوسط');
ok(B.o8 && /rk-bad/.test(B.o8.eo || '') && /زبالة/.test(B.o8.eo || '') && /30\.4%/.test(B.o8.eoTitle || '') && /اتسلّم 7 من 23/.test(B.o8.eoTitle || ''),
  '18) EasyOrders «جديد» + شركة الشحن 30.4% = زبالة — بوسطة بتكمّل الفجوة — ' + (B.o8 && B.o8.eoTitle));
ok(B.o9 && /rk-good/.test(B.o9.eo || '') && /عميل جديد/.test(B.o9.eoTitle || ''), '19) جديد عند شركة الشحن + EasyOrders مرتفعة = جامد (EasyOrders لوحده)');
ok(B.o10 && /rk-new/.test(B.o10.eo || '') && /جديد/.test(B.o10.eo || ''), '20) جديد عند شركة الشحن ومفيش EasyOrders = «جديد»');
ok(B.o11 && /rk-mid/.test(B.o11.eo || '') && /متوسط المصدرين: 60/.test(B.o11.eoTitle || ''), '21) منخفضة (20) + شركة الشحن 100% = 60 «متوسط» — المتوسط مش EasyOrders الأول — ' + (B.o11 && B.o11.eoTitle));
ok(B.o12 && /rk-bad/.test(B.o12.eo || '') && /45\.5%/.test(B.o12.eoTitle || '') && !/90\.0%/.test(B.o12.eoTitle || ''), '22) اللي اتسأل دلوقتي (45.5%) يكسب القديم وقت الشحن (90%)');

console.log('— نافذة التفاصيل');
ok(R.o1.sec && R.o1.on === 5 && R.o1.cells === 5 && /مرتفعة/.test(R.o1.eo || ''), '7) high: الشريط 5/5 + «مرتفعة» — ' + R.o1.eo);
ok(R.o2.on === 3 && R.o3.on === 1 && R.o4.on === 0 && /عميل جديد/.test(R.o4.eo || ''), '8) الشريط 3/1/0 + «عميل جديد»');
ok(/90\.0%/.test(R.o1.ship || '') && /جامد/.test(R.o1.ship || ''), '9) شركة الشحن 90.0% جامد');
ok(R.o3.alt && /عميل جديد/.test(R.o3.alt) && R.o1.alt === null, '10) الرقم الإضافي سطر لوحده بس لما يبقى ليه تقييم');
ok(/خلّصت الحساب/.test(R.o5.eo || '') && R.o5.on === null, '11) pending بالكلام من غير شريط — ' + R.o5.eo);
ok(/مفيش تقييم/.test(R.o6.eo || '') && /مفيش بيانات/.test(R.o2.ship || ''), '12) مفيش تقييم EasyOrders · مفيش بيانات شحن');
ok(/قيمة جديدة/.test(R.o7.eo || '') && !R.o7.xss, '13) قيمة جديدة بتتعرض نص متهرّب (مفيش HTML) — ' + R.o7.eo);
ok(['o1','o2','o3','o4','o5','o6','o7'].every(k => R[k].sec && !R[k].oldRow), '14) القسم ظاهر في كل الأوردرات والسطر القديم «سمعة العميل» اتشال');
ok(/30\.4%/.test(R.o8.ship || '') && /اتسلّم 7/.test(R.o8.ship || '') && /رجع 16/.test(R.o8.ship || ''), '23) التفاصيل: شركة الشحن بالعدّ من الخام — ' + R.o8.ship);
ok(/جديد/.test(R.o9.ship || '') && /مالوش شحنات/.test(R.o9.ship || ''), '24) التفاصيل: جديد عند شركة الشحن بالكلام — ' + R.o9.ship);
ok(/وقت الشحن/.test(R.o1.ship || '') && /90\.0%/.test(R.o1.ship || '') && /45\.5%/.test(R.o12.ship || '') && !/وقت الشحن/.test(R.o12.ship || ''),
  '25) القديم (customer_ranking) بيتقال «وقت الشحن» · واللي اتسأل بيكسبه');
ok(R.o11.avg && /60/.test(R.o11.avg) && /EasyOrders \(20\)/.test(R.o11.avg) && /شركة الشحن \(100\)/.test(R.o11.avg) && R.o2.avg === null && R.o8.avg === null,
  '26) سطر «المتوسط» بس لما المصدرين موجودين — ' + R.o11.avg);
ok(R.o11.shipAlt && /50\.0%/.test(R.o11.shipAlt) && /اتسلّم 5/.test(R.o11.shipAlt) && R.o8.shipAlt === null, '27) الرقم الإضافي عند شركة الشحن سطر لوحده — ' + R.o11.shipAlt);

console.log('— الريل-تايم (سحب التقييم)');
async function rtScore(patches){
  const p = await openApp(patches);
  await p.evaluate(() => { const tr = document.querySelector('#tbody tr[data-id="o1"]'); if(tr) tr.click(); });
  await p.waitForFunction(() => { const t = document.getElementById('dtit'); return t && t.textContent.indexOf('9001') >= 0 && document.getElementById('int-notes') && document.getElementById('ds-sec'); }, null, { timeout: 8000 });
  await p.waitForTimeout(120);
  const TYPED = 'العميل طلب يتصل بعد العصر — لسه بكتب';
  await p.evaluate(t => { const el = document.getElementById('int-notes'); el.focus(); el.value = t; }, TYPED);   // من غير input = لسه مااتحفظش
  await p.evaluate(async () => {
    const m = await import('./js/orders/orders.js');
    const base = window.__ORDERS.find(x => x.id === 'o1');
    // نفس الصف + نسبة الاستلام + updated_at — والإجمالي مكتوب بشكل تاني (نص بدل رقم) زي ما ممكن الريل-تايم يبعته
    const row = Object.assign({}, base, { eo_rate: 'low', eo_metadata: { tracking: {}, '01000000001': { rate_result: 'low', delivery_rate_status: 'completed' } },
      updated_at: '2026-10-15T10:05:00.123456+00:00', total_cost: base.total_cost == null ? base.total_cost : String(base.total_cost) });
    m.handleRealtimeChange({ eventType: 'UPDATE', new: row, old: { id: 'o1' } });
  });
  await p.waitForTimeout(80);
  const r1 = await p.evaluate(() => ({
    open: document.getElementById('ovl').classList.contains('open'),
    notes: (document.getElementById('int-notes') || {}).value,
    focused: document.activeElement && document.activeElement.id,
    eo: (document.getElementById('ds-eo') || {}).textContent || '',
    on: document.querySelectorAll('#ds-eo .eo-meter i.on').length
  }));
  // ضابط: تغيير حالة على نفس الأوردر = رسم كامل (النافذة بتتحدث زي الأول)
  await p.evaluate(async () => {
    const m = await import('./js/orders/orders.js');
    const base = window.__ORDERS.find(x => x.id === 'o1');
    m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base, { eo_rate: 'low', status: 'cancelled' }), old: { id: 'o1' } });
  });
  await p.waitForTimeout(80);
  const st = await p.evaluate(() => { const s = document.getElementById('dsel'); return s ? s.value : null; });
  await p.close();
  return { r1, st, TYPED };
}
const RT = await rtScore();
ok(RT.r1.open && RT.r1.notes === RT.TYPED && RT.r1.focused === 'int-notes', '15) حدث نسبة الاستلام بس: الكلام اللي بيتكتب فضل زي ما هو والتركيز مااتنقلش — ' + JSON.stringify(RT.r1.notes));
ok(/منخفضة/.test(RT.r1.eo) && RT.r1.on === 1, '16) والقسم نفسه اتحدّث لـ«منخفضة» (1/5) من الحدث — ' + RT.r1.eo.replace(/\s+/g, ' ').trim());
ok(RT.st === 'cancelled', '17) ضابط: تغيير الحالة على نفس الأوردر = رسم كامل زي الأول (#dsel = ' + RT.st + ')');

async function rtShip(patches){
  const p = await openApp(patches);
  await p.evaluate(() => { const tr = document.querySelector('#tbody tr[data-id="o8"]'); if(tr) tr.click(); });
  await p.waitForFunction(() => { const t = document.getElementById('dtit'); return t && t.textContent.indexOf('9008') >= 0 && document.getElementById('int-notes') && document.getElementById('ds-sec'); }, null, { timeout: 8000 });
  await p.waitForTimeout(120);
  const TYPED = 'بكلم العميل دلوقتي — لسه بكتب';
  await p.evaluate(t => { const el = document.getElementById('int-notes'); el.focus(); el.value = t; }, TYPED);
  await p.evaluate(async () => {
    const m = await import('./js/orders/orders.js');
    const base = window.__ORDERS.find(x => x.id === 'o8');
    const pr = { phone10: '1000000008', found: true, delivered: 2, returned: 2, rate: 50 };
    m.handleRealtimeChange({ eventType: 'UPDATE', old: { id: 'o8' }, new: Object.assign({}, base, {
      ship_rank: '50.00', ship_rank_n: 4, ship_rank_at: '2026-10-10T11:30:00.123456+00:00',
      ship_rank_raw: { at: '2026-10-10T11:30:00.123456+00:00', primary: pr, alt: null }, updated_at: '2026-10-10T11:30:00.123456+00:00' }) });
  });
  await p.waitForTimeout(80);
  const r = await p.evaluate(() => ({
    notes: (document.getElementById('int-notes') || {}).value,
    ship: ((document.getElementById('ds-ship') || {}).textContent || '').replace(/\s+/g, ' ')
  }));
  await p.close();
  return { r, TYPED };
}
const RS = await rtShip();
ok(RS.r.notes === RS.TYPED && /50\.0%/.test(RS.r.ship) && /رجع 2/.test(RS.r.ship), '28) حدث شركة الشحن بس: القسم اتحدّث (50.0% · رجع 2) والكلام فضل — ' + RS.r.ship);

console.log('— المعايرات');
const cA = await runAll({ orders: s => s.replace('customer_ranking,eo_rate,eo_rate_alt,', 'customer_ranking,') });
ok(!/EasyOrders/.test(cA.b.o1.eoTitle || '') && cA.b.o4.eo === null, '(أ) العمود مش في ORDER_LIST_COLS → EasyOrders اختفت من الشارات (الفحص 1 كان هيقع)');
const cI = await runAll({ orders: s => s.replace('eo_rate_alt,ship_rank,ship_rank_n,ship_rank_at,', 'eo_rate_alt,') });
ok(/rk-new/.test(cI.b.o8.eo || ''), '(ط) ship_rank مش في ORDER_LIST_COLS → o8 بقت على EasyOrders لوحدها «جديد» (الفحص 18 كان هيقع) — ' + cI.b.o8.eo);
const cB = await runAll({ score: s => s.replace("var EO_SCORE = { high: 100, moderate: 60, low: 20 };", "var EO_SCORE = { high: 100, moderate: 60, low: 20, pending: 50 };") });
ok(cB.b.o5.eo !== null, '(ب) pending بشارة → الفحص 5 كان هيقع');
const cC = await runAll({ score: s => s.replace("'قيمة جديدة من EasyOrders: ' + esc(String(v))", "'قيمة جديدة من EasyOrders: ' + String(v)") });
ok(cC.o7.xss === true, '(ج) من غير esc → الـHTML اترسم (الفحص 13 كان هيقع)');
const cE = await runAll({ score: s => s.replace("return '<span class=\"rk-badge ' + t.cls + ' ds-badge\" title=\"' + esc(head + ' · ' + tip.join(' · ')) + '\">' + t.tag + '</span>';", "return '<span class=\"rk-badge ' + t.cls + ' ds-badge\" title=\"' + esc(head + ' · ' + tip.join(' · ')) + '\">' + t.tag + '</span>' + (s ? '<span class=\"rk-badge rk-good\">x</span>' : '');") });
ok(cE.b.o1.n === 2, '(هـ) شارتين جنب بعض → الفحص 5ب كان هيقع');
const cD = await runAll({ detail: s => s.replace('    +deliveryScoreSection(o)\n', '') });
ok(!cD.o1.sec && cD.o1.on === null, '(د) القسم اتشال → فحوص التفاصيل كانت هتقع');
const cF = await rtScore({ orders: s => s.replace("var ds = scoreOnly ? $id('ds-sec') : null;", 'var ds = null;') });
ok(cF.r1.notes !== cF.TYPED, '(و) رسم كامل مع حدث النسبة → الكلام ضاع (الفحص 15 كان هيقع)');
const cG = await runAll({ score: s => s.replace('  if(sh !== null) parts.push(sh);', '  if(sh !== null && eo === null) parts.push(sh);') });
ok(!/rk-mid/.test(cG.b.o11.eo || ''), '(ز) EasyOrders الأول بدل المتوسط → o11 مش «متوسط» (الفحص 21 كان هيقع)');
const cH = await runAll({ score: s => s.replace('  if(o.ship_rank_at){', '  if(o.ship_rank_at && (o.customer_ranking === null || o.customer_ranking === undefined)){') });
ok(/rk-good/.test(cH.b.o12.eo || ''), '(ح) القديم يكسب الجديد → o12 «جامد» من الـ90 القديمة (الفحص 22 كان هيقع)');
const cJ = await rtShip({ orders: s => s.replace('  ship_rank: 1, ship_rank_n: 1, ship_rank_alt: 1, ship_rank_alt_n: 1, ship_rank_at: 1, ship_rank_raw: 1 };', ' };') });
ok(cJ.r.notes !== cJ.TYPED, '(ي) أعمدة شركة الشحن مش في RT_SCORE_COLS → رسم كامل والكلام ضاع (الفحص 28 كان هيقع)');

await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
