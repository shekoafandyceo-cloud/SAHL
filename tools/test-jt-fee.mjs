// تكلفة شحن J&T النهائية في نافذة التفاصيل (طلب المالك 24 سبتمبر).
//
// على السيرفر (migration jt_final_shipping_fee): getWaybillInfo → jt_freight + رسوم COD
// (1% بحد أدنى 5 ج — من العقد، مش في الـAPI)، وreal_shipping_fee بيتكتب **لما الرقم يبقى
// نهائي بس**: اتسلّم (isSign 1) · مرتجع اتقفل (isSign 2) · فاتورة settlementReturn.
//
// اللي بيتأكد هنا (الستب — من غير شبكة):
//  1) أوردر نهائي: الإجمالي + التفصيل (شحن + رسوم تحصيل + وزن J&T) + «نهائي»
//  2) أوردر مبدئي: «مبدئي» ومفيش إجمالي — حتى لو real_shipping_fee فيه رقم قديم
//  3) مصدر الفاتورة: «من فاتورة J&T»
//  4) أوردر مالوش jt_freight: مفيش سطر خالص (مش «0.00 ج»)
//  5) الموظف مايشوفش السطر (زي باقي أسطر التكلفة في النافذة)
//
// المعايرات (لازم تقع على الكود المحقون):
//  (أ) شيل حارس isAdmin → فحص 5 يقع
//  (ب) الإجمالي من غير شرط jt_fee_final → فحص 2 يقع (الرقم القديم بيتعرض كإنه نهائي)
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const SRC = new URL('../app/js/orders/detail.js', import.meta.url);
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// o1 delivered (COD 1000) نهائي · o5 returned مبدئي ومعاه real_shipping_fee قديم (88) ·
// o4 delivered من الفاتورة · o2 J&T من غير jt_freight
const FIX = `(function(){
  var set = function(id, patch){ var o = window.__ORDERS.find(function(x){ return x.id === id; }); Object.assign(o, patch); };
  set('o1', { shipping_carrier:'jt', jt_freight:57.68, jt_cod_fee:10, jt_charge_weight_kg:4.43, jt_is_sign:1,
              jt_fee_final:true, jt_fee_source:'waybill_info', real_shipping_fee:67.68 });
  set('o5', { shipping_carrier:'jt', jt_freight:81.51, jt_cod_fee:0, jt_charge_weight_kg:4.38, jt_is_sign:0,
              jt_fee_final:false, jt_fee_source:'waybill_info' });
  set('o4', { shipping_carrier:'jt', jt_freight:60, jt_cod_fee:9, jt_fee_final:true, jt_fee_source:'settlement', real_shipping_fee:69 });
  set('o2', { shipping_carrier:'jt' });
})();`;

async function openApp(opts){
  opts = opts || {};
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  if(opts.role) await p.addInitScript(`window.__ROLE = '${opts.role}';`);
  await p.addInitScript(STUB);
  await p.addInitScript(`window.__TENANT = { shipping_provider: 'jt' };` + FIX);
  if(opts.patch){
    const src = fs.readFileSync(SRC, 'utf8');
    const out = opts.patch(src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة');
    await p.route('**/js/orders/detail.js', r =>
      r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(URL_, { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-orders', { state: 'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return p;
}
async function feeRow(p, id){
  await p.evaluate(i => { const tr = document.querySelector('#tbody tr[data-id="' + i + '"]'); if(tr) tr.click(); }, id);
  const uid = '900' + id.slice(1);
  await p.waitForFunction(u => { const t = document.getElementById('dtit'); return t && t.textContent.indexOf(u) >= 0 && document.querySelector('#dcnt .dsec'); }, uid, { timeout: 8000 });
  await p.waitForTimeout(150);
  const r = await p.evaluate(() => { const el = document.getElementById('jt-fee-row'); return el ? { text: el.textContent.replace(/\s+/g, ' ').trim(), bold: !!el.querySelector('b') } : null; });
  await p.evaluate(() => { const c = document.querySelector('#ovl .dclose, #ovl [data-act="closeDetail"]'); if(c) c.click(); else document.getElementById('ovl').classList.remove('open'); });
  await p.waitForTimeout(100);
  return r;
}

async function run(opts){
  const p = await openApp(opts);
  const res = { o1: await feeRow(p, 'o1'), o5: await feeRow(p, 'o5'), o4: await feeRow(p, 'o4'), o2: await feeRow(p, 'o2') };
  await p.close();
  return res;
}

console.log('— أدمن');
const A = await run();
ok(A.o1 && /67\.68 ج/.test(A.o1.text) && A.o1.bold, '1) النهائي: الإجمالي 67.68 ج بالعريض — ' + (A.o1 && A.o1.text));
ok(A.o1 && /شحن 57\.68 ج \+ رسوم تحصيل 10\.00 ج/.test(A.o1.text), '1) التفصيل: شحن + رسوم تحصيل');
ok(A.o1 && /وزن J&T 4\.43 كجم/.test(A.o1.text) && /نهائي/.test(A.o1.text), '1) وزن J&T + «نهائي»');
ok(A.o5 && /مبدئي/.test(A.o5.text) && !A.o5.bold && !/88/.test(A.o5.text), '2) المبدئي: «مبدئي» ومفيش إجمالي ولا الرقم القديم — ' + (A.o5 && A.o5.text));
ok(A.o5 && !/رسوم تحصيل/.test(A.o5.text), '2) المرتجع: مفيش رسوم تحصيل (0) في النص');
ok(A.o4 && /من فاتورة J&T/.test(A.o4.text) && /69\.00 ج/.test(A.o4.text), '3) الفاتورة: «من فاتورة J&T» — ' + (A.o4 && A.o4.text));
ok(A.o2 === null, '4) أوردر J&T من غير jt_freight: مفيش سطر');

console.log('— موظف');
const E = await run({ role: 'employee' });
ok(E.o1 === null && E.o4 === null, '5) الموظف مايشوفش سطر التكلفة');

console.log('— المعايرات');
const cA = await run({ role: 'employee', patch: s => s.replace("+(isAdmin()?jtFeeRow(o):'')", '+jtFeeRow(o)') });
ok(cA.o1 !== null, '(أ) من غير حارس isAdmin الموظف بيشوف السطر — فحص 5 بيمسكها');
const cB = await run({ patch: s => s.replace('o.jt_fee_final && o.real_shipping_fee!=null', 'o.real_shipping_fee!=null') });
ok(cB.o5 && cB.o5.bold && /88/.test(cB.o5.text), '(ب) من غير شرط النهائي الرقم القديم بيتعرض كإجمالي — فحص 2 بيمسكها');

await b.close();
console.log(bad ? '\n❌ ' + bad + ' فشل' : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
