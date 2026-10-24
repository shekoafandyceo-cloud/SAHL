// نسبة استلام العميل — شركة الشحن بس (17 أكتوبر — قرار المالك: تقييم EasyOrders اتشال «مش مفيد ومضلل»).
// كان اسمه test-eo-rate.mjs (7 أكتوبر — EasyOrders + شركة الشحن «متوسط الاتنين»).
//
// على السيرفر: ship-rank-sync بيكتب ship_rank/ship_rank_n/ship_rank_at/ship_rank_raw (اتجرّب بترانزاكشن راجعة على الحي).
// هنا الواجهة بس (الستب — من غير شبكة). الفيكستشر **لسه فيه eo_rate** على أوردرات كتير عن قصد: العمود موجود على الجدول
// والـn8n لسه بيكتبه. ⚠️ صفوف الجدول بتتقطع زي PostgREST (eo_rate مش في ORDER_LIST_COLS) — فشارة الجدول من التحميل عمرها ما بتشوف
// العمود؛ استقلال الشارة عنه بيتحرس بفحوص 36–37 على **صف كامل** (نفس شكل الريل-تايم و select('*')). النافذة بتجيب الصف كامل أصلاً.
//  1–6) الجدول: الشارة من شركة الشحن بس · eo_rate مالوش أي أثر (low + شحن 90% = جامد · high + مفيش شحن = مفيش شارة ·
//       unknown لوحده = مفيش «جديد») · شارة واحدة بس · «EasyOrders» مش في أي تلميح
//  7–14) التفاصيل: سطر شركة الشحن بالعدّ · مفيش سطر EasyOrders ولا متوسط ولا شريط · القسم ظاهر دايماً · «سمعة العميل» القديم اتشال
// 18–28) شركة الشحن: «جديد» · الجديد بيكسب القديم (customer_ranking) · الرقم الإضافي · حدث الريل-تايم بيبدّل القسم بس
// 29–35) المراجعة العدائية (10 أكتوبر): الإضافي لما الأساسي جديد · التليفون اتعدّل = مفيش شارة · الدرجة من النسبة نفسها
//        (79.6% = «متوسط» في الشارة والتفاصيل — مش «جامد» من التقريب) · shipP10 = app.ship_rank_p10
//
// المعايرات (لازم تقع على الكود المحقون):
//  (أ) EasyOrders رجعت في الشارة (متوسط الاتنين — الشكل القديم بالحرف) → 1/3 يقعوا
//  (ب) «جديد» من EasyOrders unknown → 4 يقع · (ج) سطر EasyOrders رجع في التفاصيل → 7 يقع
//  (د) شيل القسم من التفاصيل · (هـ) شارتين في خانة الاسم · (و) حدث النسبة = رسم كامل (الكلام ضاع)
//  (ح) القديم يكسب الجديد · (ط) شيل ship_rank من ORDER_LIST_COLS · (ي) أعمدة شركة الشحن مش في RT_SCORE_COLS
//  (ك) شيل الإضافي · (ل) شيل كشف التليفون المتعدّل · (م) الدرجة من المقرّب (الشكل القديم)
//  (ن) الشارة لوحدها بتوزن EasyOrders والتلميح زي ما هو (orders.js مااتلمسش) → 36/37 يقعوا (من المراجعة العدائية 17 أكتوبر)
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// eo_rate متحط عن قصد (العمود لسه بيتكتب على الحي) — ومالوش أي أثر:
// o1 low + شحن قديم 90 · o2 high (مفيش شحن) · o3 moderate + رقم إضافي · o4 unknown (مفيش شحن) ·
// o5 pending · o6 مفيش EasyOrders + شحن قديم 40 · o7 قيمة جديدة فيها HTML (EasyOrders)
const FIX = `(function(){
  var set = function(id, patch){ var o = window.__ORDERS.find(function(x){ return x.id === id; }); Object.assign(o, patch); };
  set('o1', { eo_rate:'low', customer_ranking:90 });
  set('o2', { eo_rate:'high' });
  set('o3', { eo_rate:'moderate', alt_phone:'01222222222', eo_rate_alt:'unknown' });
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
  mk('o8',  '9008',  '01000000008', Object.assign({ eo_rate: 'high' }, sr('1000000008', 7, 16)));                 // EasyOrders مرتفعة + شركة الشحن 30.4% = زبالة (كان «متوسط»)
  mk('o9',  '9009',  '01000000009', Object.assign({ eo_rate: 'high' }, sr('1000000009', 0, 0)));                  // شركة الشحن جديد = «جديد» (كان «جامد» من EasyOrders)
  mk('o10', '90010', '01000000010', sr('1000000010', 0, 0));                                                      // جديد ومفيش EasyOrders = «جديد»
  mk('o11', '90011', '01000000011', Object.assign({ eo_rate: 'low', alt_phone: '01233334444' },
     sr('1000000011', 2, 0, ['1233334444', 5, 5])));                                                             // 100% جامد (كان 60 «متوسط») · إضافي 50%
  mk('o12', '90012', '01000000012', Object.assign({ customer_ranking: 90 }, sr('1000000012', 10, 12)));            // الجديد 45.5% يكسب القديم 90
  mk('o13', '90013', '01000000013', Object.assign({ alt_phone: '01155556666' }, sr('1000000013', 0, 0, ['1155556666', 8, 2])));   // الأساسي جديد · الإضافي 80% = جامد
  mk('o14', '90014', '01000000014', Object.assign({ eo_rate: 'moderate' }, sr('1000000099', 1, 9)));              // اتسأل على رقم تاني (اتعدّل بعده) = مفيش شارة
  mk('o15', '90015', '01000000015', Object.assign({ eo_rate: 'high' }, sr('1000000015', 199, 51)));               // 79.6% = «متوسط» (من النسبة مش من المقرّب)
  mk('o16', '90016', '01000000016', Object.assign({ eo_rate: 'high' }, sr('1000000016', 3, 7)));                  // 30% على 10 = زبالة (كان «متوسط ⚠»)
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
    const sec = document.getElementById('ds-sec');
    return {
      sec: !!sec,
      rows: sec ? sec.querySelectorAll('.drow').length : 0,
      secText: sec ? sec.textContent.replace(/\s+/g, ' ').trim() : '',
      eoAny: /EasyOrders/.test(document.getElementById('dcnt').textContent || ''),
      eoEls: !!document.querySelector('#ds-eo, #ds-eo-alt, #ds-avg, .eo-meter, .ds-warn'),
      ship: t('ds-ship'), shipAlt: t('ds-ship-alt'),
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
  for(const id of ['o1','o2','o3','o4','o5','o6','o7','o8','o9','o10','o11','o12','o13','o14','o15','o16']) res[id] = await detail(p, id);
  await p.close();
  return res;
}

console.log('— الجدول');
const R = await runAll();
const B = R.b;
const IDS = Object.keys(B);
ok(B.o1 && /rk-good/.test(B.o1.eo || '') && /جامد/.test(B.o1.eo || '') && /90\.0%/.test(B.o1.eoTitle || ''),
  '1) 🔴 EasyOrders «منخفضة» + شركة الشحن 90% = «جامد» — EasyOrders مالهاش وزن — ' + (B.o1 && B.o1.eo));
ok(B.o2 && B.o2.eo === null && B.o3 && B.o3.eo === null && B.o5 && B.o5.eo === null && B.o7 && B.o7.eo === null,
  '2) EasyOrders مرتفعة/متوسطة/pending/قيمة جديدة من غير بيانات شحن = مفيش شارة');
ok(B.o8 && /rk-bad\b/.test(B.o8.eo || '') && /زبالة/.test(B.o8.eo || '') && /30\.4%/.test(B.o8.eoTitle || '') && /اتسلّم 7 من 23/.test(B.o8.eoTitle || ''),
  '3) 🔴 EasyOrders «مرتفعة» + شركة الشحن 30.4% = «زبالة» (كانت «متوسط» من متوسط الاتنين) — ' + (B.o8 && B.o8.eoTitle));
ok(B.o4 && B.o4.eo === null, '4) EasyOrders «عميل جديد» لوحدها = مفيش «جديد» (الـ«جديد» من شركة الشحن بس)');
ok(IDS.every(k => B[k].n <= 1), '5) عمرها ما بتبقى أكتر من شارة واحدة في خانة الاسم');
ok(IDS.every(k => !/EasyOrders|المصدرين/.test(B[k].eoTitle || '')) && B.o6 && /rk-bad\b/.test(B.o6.eo || '') && /40\.0%/.test(B.o6.eoTitle || ''),
  '6) مفيش «EasyOrders» ولا «المصدرين» في أي تلميح · شحن قديم 40% = زبالة — ' + (B.o6 && B.o6.eoTitle));
console.log('— شركة الشحن');
ok(B.o9 && /rk-new/.test(B.o9.eo || '') && /جديد/.test(B.o9.eo || '') && /عميل جديد/.test(B.o9.eoTitle || ''),
  '19) جديد عند شركة الشحن + EasyOrders مرتفعة = «جديد» (مش «جامد») — ' + (B.o9 && B.o9.eo));
ok(B.o10 && /rk-new/.test(B.o10.eo || '') && /جديد/.test(B.o10.eo || ''), '20) جديد عند شركة الشحن ومفيش EasyOrders = «جديد»');
ok(B.o11 && /rk-good/.test(B.o11.eo || '') && /100\.0%/.test(B.o11.eoTitle || ''), '21) EasyOrders منخفضة + شركة الشحن 100% = «جامد» (كانت 60 «متوسط») — ' + (B.o11 && B.o11.eoTitle));
ok(B.o12 && /rk-bad\b/.test(B.o12.eo || '') && /45\.5%/.test(B.o12.eoTitle || '') && !/90\.0%/.test(B.o12.eoTitle || ''), '22) اللي اتسأل دلوقتي (45.5%) يكسب القديم وقت الشحن (90%)');

console.log('— نافذة التفاصيل');
const DS = ['o1','o2','o3','o4','o5','o6','o7','o8','o9','o10','o11','o12','o13','o14','o15','o16'];
ok(DS.every(k => !R[k].eoAny && !R[k].eoEls), '7) 🔴 مفيش «EasyOrders» في النافذة كلها ولا سطر/شريط/متوسط ليها — في الـ16 أوردر');
ok(DS.every(k => R[k].sec && !R[k].oldRow), '8) القسم ظاهر في كل الأوردرات والسطر القديم «سمعة العميل» اتشال');
ok(R.o2.rows === 1 && /مفيش بيانات/.test(R.o2.ship || '') && R.o3.rows === 1, '9) مفيش بيانات شحن = سطر واحد «مفيش بيانات» (حتى لو EasyOrders قيّمته · ولو فيه رقم إضافي)');
ok(/90\.0%/.test(R.o1.ship || '') && /جامد/.test(R.o1.ship || '') && /وقت الشحن/.test(R.o1.ship || ''), '10) القديم (customer_ranking) 90.0% جامد «وقت الشحن» — ' + R.o1.ship);
ok(!R.o7.xss, '13) قيمة EasyOrders فيها HTML مابتترسمش في أي حتة');
ok(/30\.4%/.test(R.o8.ship || '') && /اتسلّم 7/.test(R.o8.ship || '') && /رجع 16/.test(R.o8.ship || ''), '23) التفاصيل: شركة الشحن بالعدّ من الخام — ' + R.o8.ship);
ok(/جديد/.test(R.o9.ship || '') && /مالوش شحنات/.test(R.o9.ship || ''), '24) التفاصيل: جديد عند شركة الشحن بالكلام — ' + R.o9.ship);
ok(/45\.5%/.test(R.o12.ship || '') && !/وقت الشحن/.test(R.o12.ship || ''), '25) واللي اتسأل بيكسب القديم في التفاصيل كمان');
ok(R.o11.shipAlt && /50\.0%/.test(R.o11.shipAlt) && /اتسلّم 5/.test(R.o11.shipAlt) && R.o8.shipAlt === null, '27) الرقم الإضافي عند شركة الشحن سطر لوحده — ' + R.o11.shipAlt);

console.log('— المراجعة العدائية (10 أكتوبر)');
ok(B.o13 && /rk-good/.test(B.o13.eo || '') && /الرقم الإضافي/.test(B.o13.eoTitle || '') && /80\.0%/.test(B.o13.eoTitle || ''),
  '29) الأساسي «جديد» والإضافي 80% = الشارة «جامد» من الإضافي والتلميح بيقول كده — ' + (B.o13 && B.o13.eoTitle));
ok(/جديد/.test(R.o13.ship || '') && R.o13.shipAlt && /80\.0%/.test(R.o13.shipAlt), '29ب) التفاصيل: سطر الأساسي «جديد» وسطر الإضافي 80% لوحده');
ok(B.o14 && B.o14.eo === null, '30) 🔴 التليفون اتعدّل بعد السؤال = نسبة الرقم القديم (10%) مش في الشارة — ومفيش EasyOrders بدالها');
ok(/اتعدّل/.test(R.o14.ship || '') && !/10\.0%/.test(R.o14.ship || ''), '30ب) التفاصيل: «التليفون اتعدّل بعد ما اتسأل» — ' + R.o14.ship);
ok(B.o15 && /rk-mid/.test(B.o15.eo || '') && /79\.6%/.test(B.o15.eoTitle || '') && /متوسط/.test(R.o15.ship || '') && /79\.6%/.test(R.o15.ship || ''),
  '31) 79.6% = «متوسط» في الشارة والتفاصيل مع بعض (الدرجة من النسبة اللي بتتكتب) — ' + (B.o15 && B.o15.eo) + ' / ' + R.o15.ship);
ok(B.o16 && /rk-bad\b/.test(B.o16.eo || '') && !/⚠/.test(B.o16.eo || '') && !/ds-conflict/.test(B.o16.eo || ''),
  '32) مرتفعة عند EasyOrders + 30% على 10 شحنات = «زبالة» من غير ⚠ (مفيش مصدر تاني يتعارض) — ' + (B.o16 && B.o16.eo));
const P10 = await (async () => {
  const p = await openApp();
  const r = await p.evaluate(async () => {
    const m = await import('./js/orders/delivery-score.js');
    // نفس المدخلات بالترتيب اللي اتجرّبت على app.ship_rank_p10 في الحي (ترانزاكشن راجعة 10 أكتوبر)
    return ['011234567890','+971501234567','01012345678','+201012345678','+2001012345678','00201012345678','\u0660\u0661\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668','01412345678','1012345678','02 25551234']
      .map(x => m.shipP10(x) || 'NULL').join(',');
  });
  await p.close();
  return r;
})();
ok(P10 === 'NULL,NULL,1012345678,1012345678,1012345678,1012345678,1012345678,NULL,1012345678,NULL',
  '34) shipP10 = app.ship_rank_p10 على الحي (نفس العشر مدخلات) — ' + P10);
const EXP = await (async () => {
  const p = await openApp();
  const r = await p.evaluate(async () => Object.keys(await import('./js/orders/delivery-score.js')).sort().join(','));
  await p.close();
  return r;
})();
ok(EXP === 'deliveryScoreBadges,deliveryScoreSection,shipInfo,shipP10', '35) الموديول مابقاش بيصدّر أي حاجة EasyOrders (EO_RATES · eoRateCell · deliveryScore) — ' + EXP);

// 36–37 (المراجعة العدائية 17 أكتوبر): شارة الجدول على **صف كامل** — صفوف التحميل متقطّعة فمابتشوفش eo_rate، بس حدث الريل-تايم
// بيحط الصف كامل في fil ويرسم الجدول (orders.js: fil[k] = row → renderTable) — فلو الشارة رجعت تقرا eo_rate هتتقلب هناك
async function fullRow(patches){
  const p = await openApp(patches);
  const direct = await p.evaluate(async () => {
    const m = await import('./js/orders/delivery-score.js');
    const o8 = Object.assign({}, window.__ORDERS.find(x => x.id === 'o8'));   // eo_rate 'high' + شحن 30.4%
    return { low90: m.deliveryScoreBadges({ eo_rate: 'low', customer_ranking: 90 }), o8: m.deliveryScoreBadges(o8) };
  });
  await p.evaluate(async () => {
    const m = await import('./js/orders/orders.js');
    const base = window.__ORDERS.find(x => x.id === 'o8');
    m.handleRealtimeChange({ eventType: 'UPDATE', old: { id: 'o8' }, new: Object.assign({}, base, { status: 'Out for delivery', eo_rate: 'high' }) });
  });
  await p.waitForTimeout(100);   // قبل إعادة الجلب (~800ms) — اللي بيترسم من الحدث نفسه
  const rt = await p.evaluate(() => { const b = document.querySelector('#tbody tr[data-id="o8"] td.nm .ds-badge'); return b ? b.className + '|' + b.textContent + '|' + b.title : null; });
  await p.close();
  return { direct, rt };
}
const FR = await fullRow();
ok(/rk-good/.test(FR.direct.low90) && /جامد/.test(FR.direct.low90) && /rk-bad\b/.test(FR.direct.o8) && !/EasyOrders/.test(FR.direct.low90 + FR.direct.o8),
  '36) صف كامل فيه eo_rate: «منخفضة» + شحن 90% = «جامد» · o8 («مرتفعة» + 30.4%) = «زبالة» — ومفيش «EasyOrders» في التلميح');
ok(FR.rt && /rk-bad\b/.test(FR.rt) && /زبالة/.test(FR.rt) && !/EasyOrders/.test(FR.rt),
  '37) حدث ريل-تايم بتغيير الحالة (الصف كامل بـeo_rate «مرتفعة» يدخل الجدول) = الشارة فاضلة «زبالة» — ' + FR.rt);

console.log('— الريل-تايم (سحب شركة الشحن)');
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
    // حدث «تايه» على أعمدة EasyOrders بس (الأعمدة لسه على الجدول) + updated_at — والإجمالي مكتوب بشكل تاني (نص بدل رقم)
    // زي ما ممكن الريل-تايم يبعته. لازم مايعملش رسم كامل (مفيش حاجة اتغيّرت في اللي بيتعرض)
    const row = Object.assign({}, base, { eo_rate: 'high', eo_metadata: { tracking: {}, '01000000001': { rate_result: 'low', delivery_rate_status: 'completed' } },
      updated_at: '2026-10-15T10:05:00.123456+00:00', total_cost: base.total_cost == null ? base.total_cost : String(base.total_cost) });
    m.handleRealtimeChange({ eventType: 'UPDATE', new: row, old: { id: 'o1' } });
  });
  await p.waitForTimeout(80);
  const r1 = await p.evaluate(() => ({
    open: document.getElementById('ovl').classList.contains('open'),
    notes: (document.getElementById('int-notes') || {}).value,
    focused: document.activeElement && document.activeElement.id,
    sec: ((document.getElementById('ds-sec') || {}).textContent || '').replace(/\s+/g, ' ').trim()
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
ok(RT.r1.open && RT.r1.notes === RT.TYPED && RT.r1.focused === 'int-notes', '15) حدث على أعمدة EasyOrders بس: الكلام اللي بيتكتب فضل زي ما هو والتركيز مااتنقلش — ' + JSON.stringify(RT.r1.notes));
ok(!/EasyOrders|مرتفعة/.test(RT.r1.sec) && /90\.0%/.test(RT.r1.sec), '16) والقسم فاضل على شركة الشحن (90.0%) — EasyOrders مادخلتش من الحدث — ' + RT.r1.sec);
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
// (أ) الشكل القديم بالحرف: «متوسط الاتنين» (EasyOrders 100/60/20 + شركة الشحن)
const OLD_AVG = `function deliveryScoreBadges(o){
  var s = shipInfo(o);
  var EOS = { high: 100, moderate: 60, low: 20 };
  var eo = o && Object.prototype.hasOwnProperty.call(EOS, o.eo_rate) ? EOS[o.eo_rate] : null;
  var sh = s && (s.kind === 'rate' || s.kind === 'old') ? s.rate : null;
  var parts = []; if(eo !== null) parts.push(eo); if(sh !== null) parts.push(sh);
  if(!parts.length) return (s && s.kind === 'new') || (o && o.eo_rate === 'unknown') ? '<span class="rk-badge rk-new ds-badge" title="x">جديد</span>' : '';
  var t = tierOf(Math.round(parts.reduce(function(a, b){ return a + b; }, 0) / parts.length));
  return '<span class="rk-badge ' + t.cls + ' ds-badge" title="' + (eo !== null ? 'EasyOrders' : '') + '">' + t.tag + '</span>';
}
function deliveryScoreBadges_new(o){`;
// الشكل القديم = الحتتين مع بعض: الأعمدة في ORDER_LIST_COLS + المتوسط (الستب بيقطع الأعمدة زي PostgREST — من غير العمود الحقنة مالهاش داتا)
const cA = await runAll({ orders: s => s.replace('customer_ranking,ship_rank,', 'customer_ranking,eo_rate,eo_rate_alt,ship_rank,'),
  score: s => s.replace('function deliveryScoreBadges(o){', OLD_AVG) });
ok(!/rk-good/.test(cA.b.o1.eo || '') && !/rk-bad\b/.test(cA.b.o8.eo || ''), '(أ) متوسط الاتنين رجع → o1 مش «جامد» وo8 مش «زبالة» (الفحصين 1 و3 كانوا هيقعوا) — ' + cA.b.o1.eo + ' / ' + cA.b.o8.eo);
ok(cA.b.o4.eo !== null, '(ب) «جديد» من EasyOrders unknown رجع → o4 بقى ليه شارة (الفحص 4 كان هيقع)');
const cC = await runAll({ score: s => s.replace("  h += row('شركة الشحن', shipCell(o), 'ds-ship');", "  h += row('EasyOrders', '<span class=\"dval ar\">' + esc(String(o.eo_rate || 'مفيش تقييم')) + '</span>', 'ds-eo');\n  h += row('شركة الشحن', shipCell(o), 'ds-ship');") });
ok(cC.o1.eoAny && cC.o1.eoEls, '(ج) سطر EasyOrders رجع في التفاصيل → الفحص 7 كان هيقع');
const cE = await runAll({ score: s => s.replace("ds-badge\" title=\"' + tip + '\">' + t.tag + '</span>';", "ds-badge\" title=\"' + tip + '\">' + t.tag + '</span><span class=\"rk-badge rk-good\">x</span>';") });
ok(cE.b.o1.n === 2, '(هـ) شارتين جنب بعض → الفحص 5 كان هيقع');
const cD = await runAll({ detail: s => s.replace('    +deliveryScoreSection(o)\n', '') });
ok(!cD.o1.sec, '(د) القسم اتشال → فحص 8 كان هيقع');
const cF = await rtScore({ orders: s => s.replace("var ds = scoreOnly ? $id('ds-sec') : null;", 'var ds = null;') });
ok(cF.r1.notes !== cF.TYPED, '(و) رسم كامل مع حدث النسبة → الكلام ضاع (الفحص 15 كان هيقع)');
const cH = await runAll({ score: s => s.replace('  if(o.ship_rank_at){', '  if(o.ship_rank_at && (o.customer_ranking === null || o.customer_ranking === undefined)){') });
ok(/rk-good/.test(cH.b.o12.eo || ''), '(ح) القديم يكسب الجديد → o12 «جامد» من الـ90 القديمة (الفحص 22 كان هيقع)');
const cI = await runAll({ orders: s => s.replace('customer_ranking,ship_rank,ship_rank_n,ship_rank_at,', 'customer_ranking,') });
ok(!/rk-bad\b/.test(cI.b.o8.eo || ''), '(ط) ship_rank مش في ORDER_LIST_COLS → o8 مالهاش «زبالة» (الفحص 3 كان هيقع) — ' + cI.b.o8.eo);
const cJ = await rtShip({ orders: s => s.replace('  ship_rank: 1, ship_rank_n: 1, ship_rank_alt: 1, ship_rank_alt_n: 1, ship_rank_at: 1, ship_rank_raw: 1,\n', '') });
ok(cJ.r.notes !== cJ.TYPED, '(ي) أعمدة شركة الشحن مش في RT_SCORE_COLS → رسم كامل والكلام ضاع (الفحص 28 كان هيقع)');
const cK = await runAll({ score: s => s.replace("    if(a) return { kind: 'rate', rate: a.rate, n: a.n, alt: true };\n", '') });
ok(/rk-new/.test(cK.b.o13.eo || ''), '(ك) من غير الإضافي → o13 «جديد» رغم إن الإضافي 80% (الفحص 29 كان هيقع) — ' + cK.b.o13.eo);
const cL = await runAll({ score: s => s.replace("    if(partStale(o, 'primary', o.phone)) return { kind: 'stale' };\n", '') });
ok(/rk-bad\b/.test(cL.b.o14.eo || ''), '(ل) من غير كشف التليفون المتعدّل → o14 «زبالة» من نسبة الرقم القديم (الفحص 30 كان هيقع) — ' + cL.b.o14.eo);
const cM = await runAll({ score: s => s.replace('  var t = tierOf(s.rate);\n  return', '  var t = tierOf(Math.round(s.rate));\n  return') });
ok(/rk-good/.test(cM.b.o15.eo || ''), '(م) الدرجة من المقرّب (الشكل القديم) → 79.6% «جامد» في الشارة و«متوسط» في التفاصيل (الفحص 31 كان هيقع)');

// (ن) الشارة لوحدها بتوزن EasyOrders والتلميح زي ما هو — orders.js مااتلمسش (الأعمدة لسه متقطّعة في التحميل)
const W = "  var EOW = { high: 100, moderate: 60, low: 20 };\n  var eo = o && Object.prototype.hasOwnProperty.call(EOW, o.eo_rate) ? EOW[o.eo_rate] : null;\n  var t = tierOf(eo === null ? s.rate : (s.rate + eo) / 2);\n  return";
const cN = await fullRow({ score: s => s.replace('  var t = tierOf(s.rate);\n  return', W) });
ok(!/rk-good/.test(cN.direct.low90) && !/rk-bad\b/.test(cN.direct.o8) && cN.rt && !/rk-bad\b/.test(cN.rt),
  '(ن) الشارة بتوزن EasyOrders (والتلميح زي ما هو) → 36 و37 كانوا هيقعوا — ' + cN.rt);

await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
