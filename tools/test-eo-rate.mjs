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
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length >= 7);
  return p;
}
async function badges(p){
  return p.evaluate(() => {
    const r = {};
    document.querySelectorAll('#tbody tr[data-id]').forEach(tr => {
      const nm = tr.querySelector('td.nm');
      const eo = nm && nm.querySelector('.eo-badge');
      const sh = nm && nm.querySelector('.ship-badge');
      r[tr.dataset.id] = { eo: eo ? eo.className + '|' + eo.textContent : null, eoTitle: eo ? eo.title : null, ship: sh ? sh.className + '|' + sh.textContent + '|' + sh.title : null, n: nm ? nm.querySelectorAll('.rk-badge').length : 0 };
    });
    return r;
  });
}
async function detail(p, id){
  await p.evaluate(i => { const tr = document.querySelector('#tbody tr[data-id="' + i + '"]'); if(tr) tr.click(); }, id);
  const uid = '900' + id.slice(1);
  await p.waitForFunction(u => { const t = document.getElementById('dtit'); return t && t.textContent.indexOf(u) >= 0 && document.querySelector('#dcnt .dsec'); }, uid, { timeout: 8000 });
  await p.waitForTimeout(120);
  const r = await p.evaluate(() => {
    const t = id => { const el = document.getElementById(id); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };
    const meter = document.querySelector('#ds-eo .eo-meter');
    return {
      sec: !!document.getElementById('ds-sec'),
      eo: t('ds-eo'), alt: t('ds-eo-alt'), ship: t('ds-ship'),
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
  for(const id of ['o1','o2','o3','o4','o5','o6','o7']) res[id] = await detail(p, id);
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
ok(B.o1 && B.o1.ship === null && /90\.0%/.test(B.o1.eoTitle || '') && B.o6 && B.o6.ship && /rk-bad/.test(B.o6.ship) && /40\.0%/.test(B.o6.ship) && B.o2.ship === null,
  '6) شارة واحدة بس: الاتنين موجودين = EasyOrders وتلميحها فيه 90% · شحن لوحده = 40% زبالة · مفيش = مفيش');

console.log('— نافذة التفاصيل');
ok(R.o1.sec && R.o1.on === 5 && R.o1.cells === 5 && /مرتفعة/.test(R.o1.eo || ''), '7) high: الشريط 5/5 + «مرتفعة» — ' + R.o1.eo);
ok(R.o2.on === 3 && R.o3.on === 1 && R.o4.on === 0 && /عميل جديد/.test(R.o4.eo || ''), '8) الشريط 3/1/0 + «عميل جديد»');
ok(/90\.0%/.test(R.o1.ship || '') && /جامد/.test(R.o1.ship || ''), '9) شركة الشحن 90.0% جامد');
ok(R.o3.alt && /عميل جديد/.test(R.o3.alt) && R.o1.alt === null, '10) الرقم الإضافي سطر لوحده بس لما يبقى ليه تقييم');
ok(/خلّصت الحساب/.test(R.o5.eo || '') && R.o5.on === null, '11) pending بالكلام من غير شريط — ' + R.o5.eo);
ok(/مفيش تقييم/.test(R.o6.eo || '') && /مفيش بيانات/.test(R.o2.ship || ''), '12) مفيش تقييم EasyOrders · مفيش بيانات شحن');
ok(/قيمة جديدة/.test(R.o7.eo || '') && !R.o7.xss, '13) قيمة جديدة بتتعرض نص متهرّب (مفيش HTML) — ' + R.o7.eo);
ok(['o1','o2','o3','o4','o5','o6','o7'].every(k => R[k].sec && !R[k].oldRow), '14) القسم ظاهر في كل الأوردرات والسطر القديم «سمعة العميل» اتشال');

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

console.log('— المعايرات');
const cA = await runAll({ orders: s => s.replace('customer_ranking,eo_rate,eo_rate_alt,', 'customer_ranking,') });
ok(cA.b.o1.eo === null && cA.b.o4.eo === null, '(أ) العمود مش في ORDER_LIST_COLS → الشارات اختفت (الفحص 1 كان هيقع)');
const cB = await runAll({ score: s => s.replace("  unknown:  {", "  pending:  { lbl: 'p', tag: '⏳', cls: 'rk-new', steps: 0 },\n  unknown:  {") });
ok(cB.b.o5.eo !== null, '(ب) pending بشارة → الفحص 5 كان هيقع');
const cC = await runAll({ score: s => s.replace("'قيمة جديدة من EasyOrders: ' + esc(String(v))", "'قيمة جديدة من EasyOrders: ' + String(v)") });
ok(cC.o7.xss === true, '(ج) من غير esc → الـHTML اترسم (الفحص 13 كان هيقع)');
const cE = await runAll({ score: s => s.replace("  if(n !== null){\n    var t = shipTier(n);", "  if(n !== null && !e){ return ''; }\n  if(n !== null){\n    var t = shipTier(n);").replace("    return '<span class=\"rk-badge ' + e.cls + ' eo-badge\" title=\"' + esc(t1) + '\">' + e.tag + '</span>';", "    return '<span class=\"rk-badge ' + e.cls + ' eo-badge\" title=\"' + esc(t1) + '\">' + e.tag + '</span>' + (n !== null ? '<span class=\"rk-badge rk-good ship-badge\">x</span>' : '');") });
ok(cE.b.o1.n === 2, '(هـ) شارتين جنب بعض → الفحص 5ب كان هيقع');
const cD = await runAll({ detail: s => s.replace('    +deliveryScoreSection(o)\n', '') });
ok(!cD.o1.sec && cD.o1.on === null, '(د) القسم اتشال → فحوص التفاصيل كانت هتقع');
const cF = await rtScore({ orders: s => s.replace("var ds = scoreOnly ? $id('ds-sec') : null;", 'var ds = null;') });
ok(cF.r1.notes !== cF.TYPED, '(و) رسم كامل مع حدث النسبة → الكلام ضاع (الفحص 15 كان هيقع)');

await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
