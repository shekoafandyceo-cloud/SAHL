// «المندوب في الطريق» (11 أكتوبر) — سطر «رسالة المندوب للعميل» في نافذة التفاصيل (wa_ofd_sends · قراية بس).
//
//  1) رسالة اتبعتت: السطر ظاهر · اسم المندوب · الرقم جوّه [dir=ltr] · الوقت
//  2) رسالتين بمندوبين مختلفين: آخر مندوب + «الرسالة 2»
//  3) حالة الرسالة من wa_messages: read = «اتقرت» · failed = «⚠️ ماوصلتش للعميل»
//  4) failed_permanent بس: الأدمن بيشوف الكود · الموظف مايشوفش حاجة
//  5) expired (أدمن) = «ماتبعتتش (المسح اتغيّر/قدم)» مش «هتتحاول تاني» · deferred = «هتتحاول تاني»
//  6) unknown اتختم قبل ميتا = «اتبعتت غالباً» · unknown من غير dispatched_at = مش «اتبعت»
//  7) مفيش صفوف = السطر مخفي ومن غير نص
//  8) أوردر مش J&T = صفر استعلامات على wa_ofd_sends
//  9) XSS: اسم مندوب فيه وسم = مفيش عنصر اتعمل
// 10) شكل الاستعلام: أعمدة صريحة (مفيش *) + order_id + tenant_id
// 11) رد قديم: فتحت A (الرد متأخر) وبعدين B = B عمره ما بيعرض مندوب A
// 12) hit-test: elementFromPoint في نص السطر = السطر (بعد scrollIntoView instant — درس 55)
// 13) (مراجعة 10 أكتوبر) السطر المخفي مايبقاش :last-child — آخر سطر ظاهر في «بيانات الطلب» من غير شَرطة تحت
//  1) الوقت نفسه مكتوب (بعد شيل رقم المندوب من النص — الرقم كان بيعدّي /\d{4}/ لوحده)
//
// المعايرات (مرساة + حارس — درس 47): شيل esc → 9 · شيل حارس الأدمن → 4 · أقدم رسالة بدل الأحدث → 2 · شيل حارس J&T → 8 ·
// شيل حارس sel.id → 11 · expired كأنها retry → 5 · unknown من غير شرط dispatched_at → 6 · شيل الوقت → 1 · السطر المخفي آخر القسم → 13
// تشغيل:  cd tools && node --import ./clock-preload.mjs test-wa-ofd.mjs
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const SRC = new URL('../app/js/orders/detail.js', import.meta.url);
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// o2 + o4 = J&T · o1 مش J&T
const FIX = `(function(){
  var set = function(id, patch){ var o = window.__ORDERS.find(function(x){ return x.id === id; }); Object.assign(o, patch); };
  set('o2', { shipping_carrier:'jt', tracking_no:'JEGTESTOFD02', carrier_status_raw:'Delivery scan' });
  set('o4', { shipping_carrier:'jt', tracking_no:'JEGTESTOFD04', carrier_status_raw:'Delivery scan' });
})();`;
const T = (h) => '2026-10-10T' + String(h).padStart(2, '0') + ':30:00Z';
const S = (o) => Object.assign({ id: Math.floor(Math.random() * 1e9), tenant_id: 't-test-1', order_id: 'o2', status: 'sent', courier_name: 'Sherif Ashraf Ismail',
  courier_phone: '01000000011', scan_at: T(8), sent_at: T(9), dispatched_at: T(9), updated_at: T(9), created_at: T(9), wa_message_id: null,
  error_code: null, error_detail: null, attempts: 1 }, o);

async function openApp(opts){
  opts = opts || {};
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  if(opts.role) await p.addInitScript(`window.__ROLE = '${opts.role}';`);
  await p.addInitScript(STUB);
  await p.addInitScript(`window.__TENANT = { shipping_provider: 'jt' };` + FIX
    + `window.__OFD_SENDS = ${JSON.stringify(opts.sends || [])};`
    + `window.__WA_MSGS = ${JSON.stringify(opts.msgs || [])};`
    + (opts.delayOrder ? `window.__TABLE_DELAY = function(t, st){ return t === 'wa_ofd_sends' && (st.f || []).some(function(f){ return f.col === 'order_id' && f.val === '${opts.delayOrder}'; }) ? 700 : 0; };` : ''));
  if(opts.patch){
    const src = fs.readFileSync(SRC, 'utf8');
    const out = opts.patch(src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة (درس 47)');
    await p.route('**/js/orders/detail.js', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(URL_, { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-orders', { state: 'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return p;
}
async function openOrder(p, id){
  await p.evaluate(i => { const tr = document.querySelector('#tbody tr[data-id="' + i + '"]'); if(tr) tr.click(); }, id);
  const uid = '900' + id.slice(1);
  await p.waitForFunction(u => { const t = document.getElementById('dtit'); return t && t.textContent.indexOf(u) >= 0 && document.querySelector('#dcnt .dsec'); }, uid, { timeout: 8000 });
}
async function row(p){
  return p.evaluate(() => {
    const el = document.getElementById('ofd-row');
    if(!el) return { exists: false };
    const ltr = el.querySelector('[dir="ltr"]');
    const cl = el.cloneNode(true); cl.querySelectorAll('[dir="ltr"]').forEach(function(x){ x.remove(); });
    const sec = el.closest('.dsec');
    const vis = sec ? Array.prototype.filter.call(sec.children, function(x){ return x.classList.contains('drow') && getComputedStyle(x).display !== 'none'; }) : [];
    return { exists: true, visible: el.style.display !== 'none' && el.offsetParent !== null, text: el.textContent.replace(/\s+/g, ' ').trim(),
      noLtr: cl.textContent.replace(/\s+/g, ' ').trim(),
      lastBorder: vis.length ? getComputedStyle(vis[vis.length - 1]).borderBottomStyle : null,
      ltr: ltr ? ltr.textContent : null, xss: !!document.getElementById('xss') };
  });
}
async function scenario(opts, id){
  const p = await openApp(opts);
  await openOrder(p, id || 'o2');
  await p.waitForTimeout(300);
  const r = await row(p);
  const calls = await p.evaluate(() => window.__calls.filter(c => c.table === 'wa_ofd_sends'));
  await p.close();
  return Object.assign(r, { calls });
}

const ONE = [S({})];
const TWO = [S({ created_at: T(7), sent_at: T(7), courier_name: 'Old Courier', courier_phone: '01000000099' }),
             S({ created_at: T(9), courier_name: 'Mahmoud Goma Al Sayed', courier_phone: '01200000022', wa_message_id: 'wamid.x2' })];

console.log('── أدمن');
let r = await scenario({ sends: ONE });
ok(r.visible && /رسالة المندوب للعميل/.test(r.text) && /Sherif Ashraf Ismail/.test(r.text), '1) اتبعتت: السطر ظاهر باسم المندوب — ' + (r.text || '').slice(0, 80));
ok(r.ltr === '01000000011', '1) الرقم جوّه [dir=ltr] (' + r.ltr + ')');
ok(/\d{1,2}:\d{2}/.test(r.noLtr) && /2026/.test(r.noLtr) && /اتبعت للعميل رقم المندوب/.test(r.text), '1) الوقت مكتوب (من غير رقم المندوب): ' + (r.noLtr || '').slice(-40));
const R1 = r;
r = await scenario({ sends: TWO, msgs: [{ wa_message_id: 'wamid.x2', status: 'read' }] });
ok(/Mahmoud Goma Al Sayed/.test(r.text) && !/Old Courier/.test(r.text) && /الرسالة 2/.test(r.text), '2) رسالتين: آخر مندوب + «الرسالة 2» — ' + (r.text || '').slice(0, 90));
ok(/اتقرت/.test(r.text), '3) wa_messages read = «اتقرت»');
r = await scenario({ sends: [S({ wa_message_id: 'wamid.f' })], msgs: [{ wa_message_id: 'wamid.f', status: 'failed' }] });
ok(/ماوصلتش للعميل/.test(r.text), '3) wa_messages failed = «⚠️ ماوصلتش للعميل»');
const FP = [S({ status: 'failed_permanent', sent_at: null, error_code: '131026', error_detail: 'Message undeliverable' })];
r = await scenario({ sends: FP });
ok(r.visible && /ماتبعتتش/.test(r.text) && /131026/.test(r.text), '4) failed_permanent: الأدمن بيشوف الكود — ' + (r.text || '').slice(0, 80));
r = await scenario({ sends: [S({ status: 'expired', sent_at: null, error_code: 'superseded_or_stale' })] });
ok(/ماتبعتتش \(المسح اتغيّر\/قدم\)/.test(r.text) && !/هتتحاول تاني/.test(r.text), '5) expired = «ماتبعتتش (المسح اتغيّر/قدم)» — ' + (r.text || '').slice(0, 80));
r = await scenario({ sends: [S({ status: 'deferred', sent_at: null, dispatched_at: null, error_code: 'quiet_hours' })] });
ok(/هتتحاول تاني/.test(r.text), '5) deferred = «هتتحاول تاني»');
r = await scenario({ sends: [S({ status: 'unknown', sent_at: null, error_code: 'timeout' })] });
ok(/اتبعتت غالباً/.test(r.text), '6) unknown + dispatched_at = «اتبعتت غالباً»');
r = await scenario({ sends: [S({ status: 'unknown', sent_at: null, dispatched_at: null, error_code: 'stuck' })] });
ok(!r.visible && !/اتبعت/.test(r.text), '6) unknown من غير dispatched_at = مش «اتبعت» (' + (r.text || 'مخفي') + ')');
r = await scenario({ sends: [] });
ok(r.exists && !r.visible && r.text === '', '7) مفيش صفوف = مخفي ومن غير نص');
ok(r.lastBorder === 'none', '13) السطر المخفي مش آخر القسم: آخر سطر ظاهر من غير شَرطة (' + r.lastBorder + ')');
r = await scenario({ sends: ONE }, 'o1');
ok(!r.exists && r.calls.length === 0, '8) أوردر مش J&T = صفر استعلام على wa_ofd_sends (' + r.calls.length + ')');
r = await scenario({ sends: [S({ courier_name: '<img id=xss src=x onerror=1>' })] });
ok(!r.xss && /<img/.test(r.text), '9) XSS: الاسم بيتعرض نص ومفيش عنصر اتعمل');
const q = R1.calls[0] || {};
const fcols = (q.f || []).filter(f => f.op === 'eq').map(f => f.col);
ok(q.cols && q.cols.indexOf('*') < 0 && /courier_phone/.test(q.cols) && fcols.indexOf('order_id') >= 0 && fcols.indexOf('tenant_id') >= 0,
  '10) الاستعلام: أعمدة صريحة + order_id + tenant_id (' + fcols.join(',') + ')');

console.log('── رد قديم (11)');
async function staleRun(patch){
  const p = await openApp({ sends: [S({ order_id: 'o2', courier_name: 'Courier From A' })], delayOrder: 'o2', patch });
  await openOrder(p, 'o2');
  await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); });
  await openOrder(p, 'o4');
  await p.waitForTimeout(1100);
  const rr = await row(p);
  await p.close();
  return rr;
}
r = await staleRun();
ok(!/Courier From A/.test(r.text || ''), '11) فتحت B بعد A: B مابيعرضش مندوب A (' + (r.text || 'مخفي') + ')');

console.log('── موظف');
r = await scenario({ role: 'employee', sends: FP });
ok(r.exists && !r.visible && r.text === '', '4) failed_permanent: الموظف مايشوفش حاجة');
r = await scenario({ role: 'employee', sends: ONE });
ok(r.visible && /Sherif Ashraf Ismail/.test(r.text), '4) ضابط: الموظف بيشوف الرسالة اللي اتبعتت');

console.log('── hit-test (12)');
{
  const p = await openApp({ sends: ONE });
  await openOrder(p, 'o2');
  await p.waitForFunction(() => { const e = document.getElementById('ofd-row'); return e && e.style.display !== 'none'; }, null, { timeout: 4000 });
  const hit = await p.evaluate(() => {
    const el = document.getElementById('ofd-row');
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rc = el.getBoundingClientRect();
    const h = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
    return !!(h && el.contains(h));
  });
  ok(hit, '12) السطر مش مدفون (elementFromPoint)');
  await p.close();
}

console.log('── المعايرات');
r = await scenario({ sends: [S({ courier_name: '<img id=xss src=x onerror=1>' })], patch: s => s.replace("'<b>'+esc(last.courier_name||'—')+'</b>", "'<b>'+(last.courier_name||'—')+'</b>") });
ok(r.xss, 'معايرة (9): من غير esc الوسم بيتعمل — فحص 9 بيمسكها');
r = await scenario({ role: 'employee', sends: FP, patch: s => s.replace("  if(!admin) return '';\n", '') });
ok(r.visible && /131026/.test(r.text), 'معايرة (4): من غير حارس الأدمن الموظف بيشوف الخطأ — فحص 4 بيمسكها');
r = await scenario({ sends: TWO, patch: s => s.replace('  var last = sent[0];', '  var last = sent[sent.length-1];') });
ok(/Old Courier/.test(r.text), 'معايرة (2): أقدم رسالة بدل الأحدث — فحص 2 بيمسكها');
r = await scenario({ sends: ONE, patch: s => { const o = s.replace("o.shipping_carrier!=='jt' || ", '').replace("  var box = $id('ofd-row');\n  if(!box", "  var box = $id('ofd-row') || document.body;\n  if(!box"); if(o.split('ofd-row\') || document.body').length !== 2 || o.indexOf("o.shipping_carrier!=='jt' || ") >= 0) throw new Error('المعايرة مالقتش المرساة (8)'); return o; } }, 'o1');   // (السطر نفسه لو اتنقل بره فرع J&T)
ok(r.calls.length > 0, 'معايرة (8): من غير حارس J&T بيستعلم على أوردر مش J&T — فحص 8 بيمسكها');
r = await staleRun(s => { if(s.split('sel.id!==o.id').length < 3) throw new Error('المعايرة مالقتش المرساة (11)'); return s.split('sel.id!==o.id').join('false'); });
ok(/Courier From A/.test(r.text || ''), 'معايرة (11): من غير حارس sel.id الرد القديم بيترسم في B — فحص 11 بيمسكها');
r = await scenario({ sends: [S({ status: 'expired', sent_at: null, error_code: 'superseded_or_stale' })], patch: s => s.replace("    : f.status==='expired' ? 'ماتبعتتش (المسح اتغيّر/قدم)'\n", '') });
ok(/هتتحاول تاني/.test(r.text), 'معايرة (5): expired كأنها retry — فحص 5 بيمسكها');
r = await scenario({ sends: [S({ status: 'unknown', sent_at: null, dispatched_at: null, error_code: 'stuck' })], patch: s => s.replace("(r.status==='unknown' && r.dispatched_at)", "r.status==='unknown'") });
ok(/اتبعتت غالباً/.test(r.text), 'معايرة (6): unknown من غير شرط الختم بيتعرض «اتبعت» — فحص 6 بيمسكها');

{
  const seg = " + esc(fmtDT(last.sent_at||last.dispatched_at||last.updated_at)) + tick";
  r = await scenario({ sends: ONE, patch: s => { if(s.indexOf(seg) < 0) throw new Error('المعايرة مالقتش المرساة (1)'); return s.replace(seg, ' + tick'); } });
  ok(!(/\d{1,2}:\d{2}/.test(r.noLtr) && /2026/.test(r.noLtr)), 'معايرة (1): من غير الوقت الفحص بيقع (رقم المندوب مابيعدّيهوش) — ' + (r.noLtr || '').slice(-40));
  const ph = "      +'<div class=\"drow\" id=\"ofd-row\" style=\"display:none\"></div>'\n";
  const tail = "      +(isAdmin()?jtFeeRow(o)+jtCodRow(o):'')\n";
  r = await scenario({ sends: [], patch: s => { if(s.split(ph).length !== 2 || s.split(tail).length !== 2) throw new Error('المعايرة مالقتش المرساة (13)'); return s.replace(ph, '').replace(tail, ph + tail); } });
  ok(r.lastBorder === 'dashed', 'معايرة (13): المخفي آخر القسم = آخر سطر ظاهر بشَرطة — فحص 13 بيمسكها (' + r.lastBorder + ')');
}

await b.close();
console.log(bad ? '\n❌ ' + bad + ' فشل' : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
