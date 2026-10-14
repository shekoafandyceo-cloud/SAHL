// سكانر المخزن (14 أكتوبر) — صفحة /warehouse في المتصفح (warehouse.js + wh-admin.js + scan-code.js).
//
//  1) الصفحة بتفتح على /warehouse · عنوان التاب · بانر وضع التجربة · مفيش pageerror
//  2) الكيبورد العربي: ضغطات KeyJ… بحروف «تثل» والخانة فيها زبالة = الكود من الزراير (البافر) = JEG…
//  3) اللصق: الخانة فيها «تثل…» من غير ضغطات = نفس الكود (scanToLatin)
//  4) الكارت: نبرة ok · «اتخصم» · المنتج و«باقي» · شارة «وضع تجربة» لما dry
//  5) قراية مزدوجة (نفس الكود مرتين ورا بعض) = نداء واحد
//  6) النت وقع: الطابور في localStorage + بانر «النت مش واصل» · رجع (online) = اتبعت بنفس الـclient_id · الطابور فضي
//  7) ريفريش والطابور فيه سكان = بيتبعت بعد التحميل بنفس الـclient_id
//  8) «J&T استلمته» = زرارين · F9 = p_force in · F10 = p_force out (نفس الكود)
//  9) طالب إلغاء: الأدمن بيشوف «اشحنه برضه» · الموظف لأ
// 10) تراجع: الزرار على سكان اتطبّق (مش dry) → مودال سبب → wh_scan_undo بالـscan_id والسبب
// 11) الكتابة بالإيد «18201» = wh_lookup · اختيار طرد = wh_scan بـp_source manual
// 12) 12 رقم بالإيد (بطيء) = بحث · 12 رقم بسرعة السكانر = wh_scan
// 13) القوايم: عدّادات الشرايح · «في الكومة» بتعرض الصفوف · «خرجت من غير سكان» للأدمن بس + «اخصمه» = wh_scan_order out
// 14) الشارات: البرتقاني = اسحب + رجعت ومااتضربتش · الأحمر للأدمن بس
// 15) XSS: اسم منتج فيه وسم في القايمة والكارت = مفيش عنصر اتعمل
// 16) الفوكس برّه الخانة (اتضغط على العنوان) = السكان بيتقري برضه والفوكس بيرجع
// 17) تاب «ربط المنتجات» = ضغطات السكانر مابتعملش سكان · ومودال مفتوح كمان
// 18) hit-test على الخانة (ديسكتوب وموبايل 390)
// 19) rtOnlyScoreChanged: ختم stock_deducted_at بس = مش تعديل (النافذة المفتوحة مابتترسمش)
// 20) المحادثات: كود بوليصة بسرعة السكانر + Enter = مايتبعتش · نفس الكود بالإيد = بيتبعت
// 21) محرر المنتج: تغيير الكمية = مودال سبب → wh_stock_adjust · ومفيش PATCH فيه current_qty
// 22) الجرد: «افتح جرد» = wh_count_open · ناقص + جرد التشغيل = مفيش نداء · كامل = wh_count_apply بكل المنتجات و go_live
//
// المعايرات (مرساة + حارس — درس 47): codeChar مابيقراش الزرار → 2 · شيل ت→J → 3 · WH_DEDUPE_MS = 0 → 5 ·
// client_id جديد مع كل محاولة → 6 · شيل !scanned → 12 · شيل esc من المنتجات في القايمة → 15 · شيل أعمدة المخزن من
// RT_SCORE_COLS → 19 · شيل looksScanned من حارس المحادثات → 20 · الكمية PATCH مباشر → 21 · الفاضي = 0 في الجرد → 22
// تشغيل:  python3 tools/spa-server.py 8899 app &   ثم   cd tools && node --import ./clock-preload.mjs test-warehouse.mjs
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';
const SRC = {
  code: new URL('../app/js/warehouse/scan-code.js', import.meta.url),
  wh: new URL('../app/js/warehouse/warehouse.js', import.meta.url),
  adm: new URL('../app/js/warehouse/wh-admin.js', import.meta.url),
  orders: new URL('../app/js/orders/orders.js', import.meta.url),
  inbox: new URL('../app/js/inbox/inbox.js', import.meta.url),
  stock: new URL('../app/js/stock/stock.js', import.meta.url)
};
const ROUTE = { code: '**/js/warehouse/scan-code.js', wh: '**/js/warehouse/warehouse.js', adm: '**/js/warehouse/wh-admin.js',
  orders: '**/js/orders/orders.js', inbox: '**/js/inbox/inbox.js', stock: '**/js/stock/stock.js' };
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const CODE = 'JEG000538937803';
const NOW = () => new Date().toISOString();
const BOARD = {
  ok: true, enabled: false, baseline_at: null, hold_cancel_requested: true, is_admin: true,
  counts: { not_scanned: 1, not_scanned_old: 0, pile: 2, pull: 1, leak: 3, leak_cancelled: 0, stale_pile: 0, courier: 1,
            courier_scanned: 0, closed_unscanned: 2, out_today: 4, in_today: 1, unmatched_lines: 1, negative_products: 0 },
  lists: {
    not_scanned: [{ t: 'JEG000700000001', uid: '18201', n: 'منى', items: 'منظم المطبخ', printed: null, created: NOW(), old: false }],
    pile: [{ t: 'JEG000700000011', uid: '18211', items: 'ترولي <img src=x onerror="window.__XSS=1">', at: NOW(), by: 'ebrahim', stale: false },
           { t: 'JEG000700000012', uid: '18212', items: 'منظم المطبخ', at: NOW(), by: 'ebrahim', stale: true }],
    pull: [{ t: 'JEG000700000013', uid: '18213', items: 'منظم', at: NOW(), by: 'ebrahim', cancelled: true }],
    leak: [{ id: 'o-leak-1', t: 'JEG000700000021', uid: '18221', items: 'منظم', jt_at: NOW(), cancelled: false }],
    courier: [{ t: 'JEG000700000031', uid: '18231', items: 'منظم', at: NOW(), done: false }],
    closed_unscanned: [], today: []
  }
};
const order = (o) => Object.assign({ id: 'o-1', uid: '18201', first_name: 'منى', status: 'BOSTA AUTO', tracking_no: CODE, pieces: 1, items: [{ text: 'منظم المطبخ المتكامل', qty: 1 }] }, o || {});
const OUT_OK = { ok: true, code: 'out_ok', tone: 'ok', dir: 'out', applied: true, scan_id: 501, order: order(),
  lines: [{ text: 'منظم المطبخ المتكامل', qty: 1, dir: 'out', state: 'posted', matched_by: 'exact', product_id: 'p1', product_name: 'منظم المطبخ المتكامل', qty_after: 61 }],
  warnings: [], options: [], dry: false };

// الهوك: wh_* من window.__WHR (دالة) أو الافتراضي · كل نداء بيتسجّل في __WHC
const HOOK = `
window.__WHC = [];
window.__RPC_HOOK = function(name, args){
  if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
  if(String(name).indexOf('wh_') !== 0) return null;
  window.__WHC.push({ name: name, args: JSON.parse(JSON.stringify(args || {})) });
  if(window.__WHFAIL && name === 'wh_scan') return { data:null, error:{ message:'TypeError: Failed to fetch' } };
  if(name === 'wh_board') return { data: window.__BOARD, error:null };
  var r = window.__WHR ? window.__WHR(name, args || {}) : null;
  if(r) return { data: r, error:null };
  if(name === 'wh_scan') return { data: window.__OUT_OK, error:null };
  return { data:{ ok:true, code:'ok' }, error:null };
};`;

async function open(opts){
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  p.on('dialog', d => d.dismiss());
  if(opts.role) await p.addInitScript(`window.__ROLE = '${opts.role}';`);
  await p.addInitScript(STUB);
  await p.addInitScript(HOOK + `window.__BOARD = ${JSON.stringify(opts.board || BOARD)}; window.__OUT_OK = ${JSON.stringify(opts.outOk || OUT_OK)};`
    + (opts.init || ''));
  for(const k of Object.keys(opts.patch || {})){
    const src = fs.readFileSync(SRC[k], 'utf8');
    const out = opts.patch[k](src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة (درس 47): ' + k);
    await p.route(ROUTE[k], r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(ORIGIN + (opts.path || '/warehouse'), { waitUntil: 'networkidle' });
  if((opts.path || '/warehouse') === '/warehouse'){
    await p.waitForSelector('#page-warehouse', { state: 'visible', timeout: 10000 });
    await p.waitForFunction(() => document.querySelectorAll('#wh-chips .wh-chip').length > 0, null, { timeout: 8000 });
  }
  return p;
}
const calls = (p, name) => p.evaluate(n => (window.__WHC || []).filter(c => c.name === n), name);
// ضغطات السكانر: الزرار الفعلي + الحرف اللي الكيبورد هيكتبه · fast = ورا بعض في نفس اللحظة
async function scanKeys(p, code, opts){
  opts = opts || {};
  await p.evaluate(async ({ code, opts }) => {
    const AR = { J: 'ت', E: 'ث', G: 'ل', U: 'ع' };
    const target = () => document.activeElement || document.body;
    const inp = document.getElementById('wh-input');
    if(opts.text != null && inp) inp.value = opts.text;
    for(const ch of code.split('')){
      const c = /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch;
      const key = opts.arabic && AR[ch] ? AR[ch] : ch;
      target().dispatchEvent(new KeyboardEvent('keydown', { code: c, key: key, bubbles: true, cancelable: true }));
      if(opts.slow) await new Promise(r => setTimeout(r, 150));
    }
    if(opts.typeInto && inp) inp.value = opts.typeInto;
    target().dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
  }, { code, opts });
}
async function pasteEnter(p, text){
  await p.evaluate(t => {
    const inp = document.getElementById('wh-input'); inp.focus(); inp.value = t;
    inp.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
  }, text);
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ── الفحوص الأساسية ──────────────────────────────────────────────────
async function core(patch, only){
  const R = {};
  // 1 · 2 · 4
  let p = await open({ patch });
  R.c1 = await p.evaluate(() => ({ title: document.title, trial: !!document.querySelector('#wh-mode.is-trial:not([hidden])'),
    vis: getComputedStyle(document.getElementById('page-warehouse')).display !== 'none' }));
  await p.click('#wh-input');
  await scanKeys(p, CODE, { arabic: true, typeInto: '؟؟؟' });
  await p.waitForTimeout(250);
  let sc = await calls(p, 'wh_scan');
  R.c2 = sc.length === 1 && sc[0].args.p_code === CODE && sc[0].args.p_source === 'scanner' && /^[0-9a-f-]{36}$/.test(sc[0].args.p_client_id);
  R.c4 = await p.evaluate(() => { const el = document.getElementById('wh-result'); return { cls: el.className, txt: el.textContent }; });
  // 5 — قراية مزدوجة: نفس الكود تاني على طول
  await scanKeys(p, 'JEG000700000099', {});
  await scanKeys(p, 'JEG000700000099', {});
  await p.waitForTimeout(250);
  R.c5 = (await calls(p, 'wh_scan')).filter(c => c.args.p_code === 'JEG000700000099').length;
  // 12 — 12 رقم: بطيء = بحث · سريع = سكان
  await p.evaluate(() => { window.__WHC.length = 0; });
  await scanKeys(p, '000538937803', { slow: true, typeInto: '000538937803' });
  await p.waitForTimeout(250);
  const slow12 = await p.evaluate(() => window.__WHC.map(c => c.name));
  await p.evaluate(() => { window.__WHC.length = 0; });
  await scanKeys(p, '622300123456', { typeInto: '622300123456' });
  await p.waitForTimeout(250);
  const fast12 = await p.evaluate(() => window.__WHC.map(c => c.name));
  R.c12 = { slow: slow12, fast: fast12 };
  // 15 — XSS في القايمة
  await p.click('#wh-chips .wh-chip[data-wh-list="pile"]');
  await p.waitForTimeout(100);
  R.c15 = await p.evaluate(() => ({ img: document.querySelectorAll('#page-warehouse img').length, xss: window.__XSS === 1,
    rows: document.querySelectorAll('#wh-lists .wh-row').length, txt: document.getElementById('wh-lists').textContent.indexOf('<img') >= 0 }));
  await p.context().close();
  if(only === 'basic') return R;

  // 3 — اللصق (من غير ضغطات)
  p = await open({ patch });
  await pasteEnter(p, 'تثل000538937803');
  await p.waitForTimeout(250);
  sc = await calls(p, 'wh_scan');
  R.c3 = sc.length === 1 && sc[0].args.p_code === CODE;
  await p.context().close();

  // 6 — النت وقع ثم رجع
  p = await open({ patch, init: 'window.__WHFAIL = true;' });
  await p.click('#wh-input');
  await scanKeys(p, CODE, {});
  await p.waitForTimeout(400);
  const off = await p.evaluate(() => ({ q: JSON.parse(localStorage.getItem('sahl_wh_queue_u1') || '[]').length,
    banner: !!document.querySelector('#wh-queue.is-off:not([hidden])') }));
  await p.evaluate(() => { window.__WHFAIL = false; window.dispatchEvent(new Event('online')); });
  await p.waitForTimeout(400);
  sc = await calls(p, 'wh_scan');
  const cids = sc.map(c => c.args.p_client_id);
  R.c6 = { off, n: sc.length, same: cids.length >= 2 && cids.every(c => c === cids[0]),
    qAfter: await p.evaluate(() => localStorage.getItem('sahl_wh_queue_u1')) };
  await p.context().close();
  return R;
}

console.log('السكان');
const R = await core();
ok(R.c1.vis && R.c1.title === 'سكانر المخزن · سهل' && R.c1.trial, '1) الصفحة على /warehouse · العنوان «سكانر المخزن · سهل» · بانر وضع التجربة');
ok(R.c2, '2) الكيبورد العربي («تثل») والخانة فيها زبالة = الكود من الزراير JEG… (scanner · client_id)');
ok(R.c3, '3) اللصق «تثل…» من غير ضغطات = JEG… (scanToLatin)');
ok(/tone-ok/.test(R.c4.cls) && R.c4.txt.indexOf('اتخصم') >= 0 && R.c4.txt.indexOf('منظم المطبخ المتكامل') >= 0 && R.c4.txt.indexOf('باقي') >= 0,
  '4) الكارت أخضر · «اتخصم» · المنتج · «باقي»');
ok(R.c5 === 1, '5) نفس الكود مرتين ورا بعض = نداء واحد (' + R.c5 + ')');
ok(R.c6.off.q === 1 && R.c6.off.banner && R.c6.n >= 2 && R.c6.same && !R.c6.qAfter,
  '6) النت وقع: الطابور محفوظ + البانر · رجع = اتبعت بنفس الـclient_id والطابور فضي (' + JSON.stringify(R.c6) + ')');
ok(R.c12.slow.indexOf('wh_lookup') >= 0 && R.c12.slow.indexOf('wh_scan') < 0 && R.c12.fast.indexOf('wh_scan') >= 0 && R.c12.fast.indexOf('wh_lookup') < 0,
  '12) 12 رقم بالإيد = بحث · بسرعة السكانر = سكان (' + JSON.stringify(R.c12) + ')');
ok(R.c15.rows === 2 && R.c15.img === 0 && !R.c15.xss && R.c15.txt, '15) XSS في القايمة = نص مش عنصر');

// 7 — الريفريش والطابور فيه سكان
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  await p.addInitScript(STUB);
  await p.addInitScript(HOOK + `window.__BOARD = ${JSON.stringify(BOARD)}; window.__OUT_OK = ${JSON.stringify(OUT_OK)};`
    + `window.__WHFAIL = sessionStorage.getItem('whf') !== '0';`);
  await p.goto(ORIGIN + '/warehouse', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-warehouse', { state: 'visible' });
  await p.click('#wh-input');
  await scanKeys(p, CODE, {});
  await p.waitForTimeout(300);
  const cid1 = (await calls(p, 'wh_scan'))[0].args.p_client_id;
  await p.evaluate(() => sessionStorage.setItem('whf', '0'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('#page-warehouse', { state: 'visible' });
  await p.waitForTimeout(500);
  const sc = await calls(p, 'wh_scan');
  ok(sc.length === 1 && sc[0].args.p_client_id === cid1 && !(await p.evaluate(() => localStorage.getItem('sahl_wh_queue_u1'))),
    '7) ريفريش والطابور فيه سكان = اتبعت بعد التحميل بنفس الـclient_id');
  await ctx.close();
}

// 8 · 9 · 10 · 11
{
  const WITHJT = { ok: true, code: 'with_jt_confirm', tone: 'warn', applied: false, order: order(), options: ['in', 'out'], lines: [], warnings: [] };
  // الكارت بياخد الكود من `order.tracking_no` اللي السيرفر رجّعه — فالرد بيرجّع الكود اللي اتبعت
  const p = await open({ init: `window.__WHR = function(n, a){ if(n === 'wh_scan' && !a.p_force){ var r = ${JSON.stringify(WITHJT)}; r.order.tracking_no = a.p_code; return r; } return null; };` });
  await p.click('#wh-input');
  await scanKeys(p, CODE, {});
  await p.waitForTimeout(250);
  const btns = await p.evaluate(() => document.querySelectorAll('#wh-result [data-wh-act="force-in"], #wh-result [data-wh-act="force-out"]').length);
  await p.keyboard.press('F9');
  await p.waitForTimeout(250);
  let sc = await calls(p, 'wh_scan');
  const f9 = sc[sc.length - 1].args;
  await scanKeys(p, CODE.replace('03', '04'), {});
  await p.waitForTimeout(250);
  await p.keyboard.press('F10');
  await p.waitForTimeout(250);
  sc = await calls(p, 'wh_scan');
  const f10 = sc[sc.length - 1].args;
  ok(btns === 2 && f9.p_force === 'in' && f9.p_code === CODE && f10.p_force === 'out' && f10.p_code === CODE.replace('03', '04'),
    '8) «J&T استلمته» = زرارين · F9 = مرتجع · F10 = خروج (نفس الكود)');

  // 10 — التراجع (الكارت الأخضر بتاع الخروج)
  const card = await p.evaluate(() => !!document.querySelector('#wh-result [data-wh-act="undo"][data-scan="501"]'));
  await p.click('#wh-result [data-wh-act="undo"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  await p.fill('#cmodal-input', 'اتضرب بالغلط');
  await p.click('#cmodal-ok');
  await p.waitForTimeout(250);
  const un = await calls(p, 'wh_scan_undo');
  ok(card && un.length === 1 && un[0].args.p_scan_id === 501 && un[0].args.p_reason === 'اتضرب بالغلط', '10) التراجع: مودال سبب → wh_scan_undo بالـscan_id والسبب');

  // 11 — الكتابة بالإيد
  await p.evaluate(() => { window.__WHR = function(n){ if(n === 'wh_lookup') return { ok:true, code:'ok', rows:[{ tracking_no:'JEG000700000001', uid:'18201', first_name:'منى', items:'منظم', out_at:null, in_at:null }] }; return null; }; window.__WHC.length = 0; });
  await p.click('#wh-input');
  await scanKeys(p, '18201', { slow: true, typeInto: '18201' });
  await p.waitForTimeout(300);
  const lk = await calls(p, 'wh_lookup');
  await p.click('#wh-result [data-wh-act="pick"]');
  await p.waitForTimeout(250);
  sc = await calls(p, 'wh_scan');
  ok(lk.length === 1 && lk[0].args.p_q === '18201' && sc.length === 1 && sc[0].args.p_code === 'JEG000700000001' && sc[0].args.p_source === 'manual',
    '11) «18201» بالإيد = wh_lookup · الاختيار = wh_scan يدوي');
  await p.context().close();

  const BLK = { ok: true, code: 'blocked_cancel_requested', tone: 'stop', applied: false, order: order(), options: [], lines: [], warnings: [] };
  const roles = {};
  for(const role of ['admin', 'employee']){
    const q = await open({ role, init: `window.__WHR = function(n, a){ if(n === 'wh_scan') return ${JSON.stringify(BLK)}; return null; };` });
    await q.click('#wh-input');
    await scanKeys(q, CODE, {});
    await q.waitForTimeout(250);
    roles[role] = await q.evaluate(() => ({ btn: !!document.querySelector('#wh-result [data-wh-act="ship-anyway"]'),
      leakChip: !!document.querySelector('#wh-chips [data-wh-list="leak"]'),
      b1: (document.getElementById('wh-nav-badge') || {}).textContent, b1v: getComputedStyle(document.getElementById('wh-nav-badge')).display !== 'none',
      b2v: getComputedStyle(document.getElementById('wh-nav-badge2')).display !== 'none' }));
    if(role === 'admin'){
      await q.click('#wh-chips [data-wh-list="leak"]');
      await q.click('#wh-lists [data-wh-act="leak-out"]');
      await q.waitForSelector('#cmodal-backdrop', { state: 'visible' });
      await q.fill('#cmodal-input', 'اتسلّم للمندوب');
      await q.click('#cmodal-ok');
      await q.waitForTimeout(250);
      roles.leak = (await calls(q, 'wh_scan_order'))[0];
    }
    await q.context().close();
  }
  ok(roles.admin.btn && !roles.employee.btn, '9) طالب إلغاء: «اشحنه برضه» للأدمن بس');
  ok(roles.admin.leakChip && !roles.employee.leakChip && roles.leak && roles.leak.args.p_dir === 'out' && roles.leak.args.p_order_id === 'o-leak-1',
    '13) «خرجت من غير سكان» للأدمن بس · «اخصمه» = wh_scan_order out بالأوردر');
  ok(roles.admin.b1v && roles.admin.b1 === '3' && roles.admin.b2v && roles.employee.b1v && !roles.employee.b2v,
    '14) الشارة البرتقاني = اسحب + رجعت ومااتضربتش (3) · الحمرا للأدمن بس');
}

// 16 · 17 · 18
{
  const p = await open({});
  await p.click('#page-warehouse .sp-head h2');
  await p.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await scanKeys(p, CODE, {});
  await p.waitForTimeout(250);
  const n16 = (await calls(p, 'wh_scan')).length;
  const foc = await p.evaluate(() => document.activeElement && document.activeElement.id);
  ok(n16 === 1 && foc === 'wh-input', '16) الفوكس برّه الخانة = السكان اتقري والفوكس رجع للخانة');
  await p.click('.wh-tab[data-wh-tab="map"]');
  await p.waitForTimeout(150);
  await scanKeys(p, 'JEG000700000077', {});
  await p.click('.wh-tab[data-wh-tab="scan"]');
  await p.evaluate(() => { document.getElementById('cmodal-backdrop').style.display = 'flex'; });
  await scanKeys(p, 'JEG000700000078', {});
  await p.evaluate(() => { document.getElementById('cmodal-backdrop').style.display = 'none'; });
  await p.waitForTimeout(200);
  const n17 = (await calls(p, 'wh_scan')).filter(c => /7[78]$/.test(c.args.p_code)).length;
  ok(n17 === 0, '17) تاب «ربط المنتجات» أو مودال مفتوح = ضغطات السكانر مابتعملش سكان');
  const hit = async (q) => q.evaluate(() => { const el = document.getElementById('wh-input'); el.scrollIntoView({ behavior: 'instant', block: 'center' });
    const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el; });
  const h1 = await hit(p);
  await p.context().close();
  const m = await open({ viewport: { width: 390, height: 844 } });
  const h2 = await hit(m);
  await m.context().close();
  ok(h1 && h2, '18) hit-test على خانة السكان (1440 و390)');
}

// 19 — RT
async function rtCheck(patch){
  const p = await open({ patch });
  const r = await p.evaluate(async () => { const m = await import('/js/orders/orders.js');
    return m.rtOnlyScoreChanged({ id: 'o1', status: 'BOSTA AUTO', stock_deducted_at: null }, { id: 'o1', status: 'BOSTA AUTO', stock_deducted_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:00Z' }); });
  await p.context().close();
  return r;
}
ok(await rtCheck() === true, '19) ختم stock_deducted_at بس = مش تعديل في الأوردر (النافذة مابتترسمش)');

// 20 — المحادثات
async function chatGuard(patch){
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  await p.addInitScript(`window.__WA_CONVOS = [{ id:'c1', tenant_id:'t-test-1', wa_id:'201000000001', customer_name:'عميل', last_message_at:new Date().toISOString(), last_inbound_at:new Date().toISOString(), unread_count:0, status:'open' }];
    window.__WA_MSGS = []; window.__FN = function(){ return Promise.resolve({ ok:true, message_id:'w1', row_id:'r1', sent_by_name:'x' }); };`);
  await p.addInitScript(STUB);
  await p.addInitScript(HOOK);
  if(patch){ const src = fs.readFileSync(SRC.inbox, 'utf8'); const out = patch(src); if(out === src) throw new Error('المعايرة مالقتش المرساة'); await p.route(ROUTE.inbox, r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out })); }
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.click('#wa-list-body .wa-conv');
  await p.waitForTimeout(400);
  const fire = (slow) => p.evaluate(async ({ code, slow }) => {
    const inp = document.getElementById('wa-input'); inp.focus(); inp.value = '';
    for(const ch of code.split('')){
      inp.dispatchEvent(new KeyboardEvent('keydown', { code: /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch, key: ch, bubbles: true }));
      inp.value += ch;
      if(slow) await new Promise(r => setTimeout(r, 140));
    }
    inp.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
  }, { code: CODE, slow });
  await fire(false);
  await p.waitForTimeout(300);
  const fast = await p.evaluate(() => ({ n: (window.__FNCALLS || []).filter(c => c.slug === 'wa-send').length, v: document.getElementById('wa-input').value }));
  await fire(true);
  await p.waitForTimeout(500);
  const slow = await p.evaluate(() => (window.__FNCALLS || []).filter(c => c.slug === 'wa-send').length);
  await ctx.close();
  return { fast, slow };
}
const cg = await chatGuard();
ok(cg.fast.n === 0 && cg.fast.v === '' && cg.slow === 1, '20) المحادثات: كود بسرعة السكانر = مايتبعتش (والخانة فضيت) · بالإيد = بيتبعت (' + JSON.stringify(cg) + ')');

// 21 — محرر المنتج
async function stockEdit(patch){
  const p = await open({ patch, init: `window.__STOCK = [{ id:'p1', tenant_id:'t-test-1', name:'منظم', current_qty:10, unit_price:1000, wholesale_price:600, active:true, parent_id:null, variant_label:null }];` });
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.showPage('stock'); });
  await p.waitForSelector('.prod-edit-btn[data-id="p1"]', { timeout: 8000 });
  await p.click('.prod-edit-btn[data-id="p1"]');
  await p.waitForSelector('#pe-qty');
  await p.fill('#pe-qty', '7');
  await p.click('#pe-save');
  let modal = false;
  try{ await p.waitForSelector('#cmodal-backdrop', { state: 'visible', timeout: 1500 }); modal = true; }catch(e){ modal = false; }
  if(modal){ await p.fill('#cmodal-input', 'جرد'); await p.click('#cmodal-ok'); }
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ adj: (window.__WHC || []).filter(c => c.name === 'wh_stock_adjust').map(c => c.args),
    patch: (window.__calls || []).filter(c => c.table === 'stock_products' && c.payload && Object.prototype.hasOwnProperty.call(c.payload, 'current_qty')).length }));
  await p.context().close();
  return Object.assign({ modal }, r);
}
const se = await stockEdit();
ok(se.modal && se.adj.length === 1 && se.adj[0].p_new_qty === 7 && se.adj[0].p_reason === 'جرد' && se.adj[0].p_product_id === 'p1' && se.patch === 0,
  '21) محرر المنتج: الكمية = مودال سبب → wh_stock_adjust · مفيش PATCH فيه current_qty (' + JSON.stringify(se) + ')');

// 22 — الجرد
async function countFlow(patch){
  const p = await open({ patch, init: `window.__STOCK = [{ id:'p1', tenant_id:'t-test-1', name:'منظم', current_qty:10, active:true, parent_id:null },
      { id:'p2', tenant_id:'t-test-1', name:'ترولي', current_qty:5, active:true, parent_id:null },
      { id:'p2a', tenant_id:'t-test-1', name:'ترولي — أسود', current_qty:3, active:true, parent_id:'p2', variant_label:'أسود' }];
    window.__WH_COUNTS = [];
    window.__WHR = function(n){ if(n === 'wh_count_open'){ window.__WH_COUNTS = [{ id: 7, tenant_id:'t-test-1', opened_at: new Date().toISOString(), opened_by_name:'أدمن', applied_at:null, cancelled_at:null, go_live:false }]; return { ok:true, code:'ok', count_id:7 }; }
      if(n === 'wh_count_apply') return { ok:true, code:'ok', changed:1, go_live:true }; return null; };` });
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('[data-wha="count-open"]', { timeout: 5000 });
  await p.click('[data-wha="count-open"]');
  await p.waitForSelector('#wh-count .wh-ci', { timeout: 5000 });
  const nIn = await p.evaluate(() => document.querySelectorAll('#wh-count .wh-ci').length);
  await p.fill('#wh-count .wh-ci[data-pid="p1"]', '9');
  await p.fill('#wh-count .wh-ci[data-pid="p2"]', '0');
  const gl = await p.evaluate(() => !!(document.getElementById('wh-golive') || {}).checked);
  await p.click('[data-wha="count-apply"]');
  await p.waitForTimeout(250);
  const before = (await calls(p, 'wh_count_apply')).length;
  await p.fill('#wh-count .wh-ci[data-pid="p2a"]', '٣');
  await p.click('[data-wha="count-apply"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  await p.click('#cmodal-ok');
  await p.waitForTimeout(300);
  const ap = await calls(p, 'wh_count_apply');
  await p.context().close();
  return { nIn, gl, before, ap: ap.map(c => c.args), opened: true };
}
const cf = await countFlow();
ok(cf.nIn === 3 && cf.gl && cf.before === 0 && cf.ap.length === 1 && cf.ap[0].p_go_live === true && cf.ap[0].p_count_id === 7
   && cf.ap[0].p_counts.length === 3 && cf.ap[0].p_counts.some(x => x.product_id === 'p2a' && x.counted === 3),
  '22) الجرد: ناقص + جرد التشغيل = مفيش نداء · كامل (والرقم الهندي اتحوّل) = wh_count_apply بالتلاتة و go_live (' + JSON.stringify(cf) + ')');

// ── المعايرات ─────────────────────────────────────────────────────────
console.log('المعايرات');
{
  const r = await core({ code: s => s.replace("if(m) return m[1];\n  m = c.match(/^(?:Digit|Numpad)(\\d)$/);", "if(m) return '';\n  m = c.match(/^(?:Digit|Numpad)(\\d)$/);") }, 'basic');
  ok(!r.c2, 'معايرة (أ) codeChar مابيقراش الزرار → 2 وقع');
}
{
  const p = await open({ patch: { code: s => s.replace("'ت': 'J', ", '') } });
  await pasteEnter(p, 'تثل000538937803'); await p.waitForTimeout(250);
  const sc = await calls(p, 'wh_scan'); await p.context().close();
  ok(!(sc.length === 1 && sc[0].args.p_code === CODE), 'معايرة (ب) شيل ت→J → 3 وقع');
}
{
  const r = await core({ wh: s => s.replace('export var WH_DEDUPE_MS = 3000;', 'export var WH_DEDUPE_MS = 0;') }, 'basic');
  ok(r.c5 !== 1, 'معايرة (ج) WH_DEDUPE_MS = 0 → 5 وقع (' + r.c5 + ')');
}
{
  const r = await core({ wh: s => s.replace('  it.tries = (it.tries || 0) + 1;\n', '  it.tries = (it.tries || 0) + 1; it.cid = whUuid();\n') });
  ok(!r.c6.same, 'معايرة (د) client_id جديد مع كل محاولة → 6 وقع');
}
{
  const r = await core({ wh: s => s.replace("if(/^\\d{8,12}$/.test(t) && !scanned)", "if(/^\\d{8,12}$/.test(t))") }, 'basic');
  ok(!(r.c12.fast.indexOf('wh_scan') >= 0 && r.c12.fast.indexOf('wh_lookup') < 0), 'معايرة (هـ) شيل !scanned → 12 وقع');
}
{
  const r = await core({ wh: s => s.replace("(x.items ? '<span class=\"wh-row-items\">' + esc(x.items) + '</span>' : '')", "(x.items ? '<span class=\"wh-row-items\">' + x.items + '</span>' : '')") }, 'basic');
  ok(r.c15.img > 0 || r.c15.xss, 'معايرة (و) شيل esc من المنتجات → 15 وقع');
}
ok(await rtCheck({ orders: s => s.replace(",\n  stock_deducted_at: 1, stock_returned_at: 1 };", " };") }) === false, 'معايرة (ز) شيل أعمدة المخزن من RT_SCORE_COLS → 19 وقع');
{
  const c = await chatGuard(s => s.replace("&& looksScanned(t)){", "&& false){"));
  ok(c.fast.n !== 0, 'معايرة (ح) شيل حارس المحادثات → 20 وقع');
}
{
  const r = await stockEdit({ stock: s => s.replace('      qtyChanged = qty!==orig.qty;\n', '      if(qty!==orig.qty) data.current_qty=qty;\n') });
  ok(!(r.adj.length === 1 && r.patch === 0), 'معايرة (ط) الكمية PATCH مباشر → 21 وقع');
}
{
  let r = null, threw = false;
  try{ r = await countFlow({ adm: s => s.replace("    if(s === ''){ missing++; return; }\n", "    if(s === ''){ s = '0'; }\n") }); }catch(e){ threw = true; }
  ok(threw || !(r && r.before === 0), 'معايرة (ي) الفاضي = 0 في الجرد → 22 وقع');
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
