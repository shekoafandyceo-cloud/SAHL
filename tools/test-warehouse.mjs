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
// 17) تاب «ربط المنتجات» = ضغطات السكانر مابتعملش سكان · المودال الحقيقي (سبب التراجع) مفتوح والموظف ضرب طرد =
//     السكان بيتسجّل · حروفه بتتشال من خانة السبب (اللي كان مكتوب بيفضل) · المودال مابيتأكّدش ومفيش wh_scan_undo
// 18) hit-test على الخانة (ديسكتوب وموبايل 390)
// 19) rtOnlyScoreChanged: ختم stock_deducted_at بس = مش تعديل (النافذة المفتوحة مابتترسمش)
// 20) المحادثات: كود بوليصة بسرعة السكانر + Enter = مايتبعتش · نفس الكود بالإيد = بيتبعت
// 21) محرر المنتج: تغيير الكمية = مودال سبب → wh_stock_adjust · ومفيش PATCH فيه current_qty
// 22) الجرد: «افتح جرد» = wh_count_open · ناقص + جرد التشغيل = مفيش نداء · كامل = wh_count_apply بكل المنتجات و go_live
// 23) «محتاجة انتباهك»: قرار + وقّف ورا بعض وبعدهم سكان أخضر = الاتنين في القايمة · F9 = مرتجع على اللي فيه الاختيار
//     (مش الكارت الأخضر) · «✓ شفته» بيشيله
// 24) Ctrl+J (لاحقة السكانر) والخانة فاضية = preventDefault (كان بيفتح التحميلات) · F10 من غير اختيار = preventDefault
// 25) بحث بالإيد رده اتأخر وجه بعد سكان = الكارت بتاع السكان فاضل (الرد القديم مابيغطّيش)
// 26) سكانات جلسة تانية في الـlocalStorage = بانر + «ابعتهم» = wh_scan بنفس الـclient_id والمفتاح اتمسح
// 27) محرر المنتج: الكمية اتغيّرت والمحرر مفتوح (stale) = الفرق اللي التاجر قصده اتحفظ على الرقم الجديد ومفيش كتابة
// 28) ربط المنتجات: تحديث القوايم الدوري مابيمسحش اختيار الأدمن · اختيار خاصية (بنت) = النطاق «بالخاصية دي بس»
// ── المراجعة العدائية التانية ──
// 29) F9/F10 على الكارت بس: F10 على كارت «مرتجع؟» بس = ولا حاجة (كان بيفرض طرد تاني «خارج») · F9 متكرر من زرار متداس =
//     ولا حاجة · F9 مرتين ورا بعض والنتيجة لسه ماوصلتش = طرد واحد بس اتفرض
// 30) دبل كليك على «✓ شفته» في «محتاجة انتباهك» = صف واحد اتشال (الضغطة التانية كانت بتقفل اللي بعده)
// 31) «⏸️ وقّفه»: بعد الضغطة الزرار بيقول «▶️ شغّله» والفوكس لسه عليه (كان بيفضل «وقّفه» والسكان واقف)
// 32) المودال مفتوح وضربة سكانر بكود مش J&T (10 أرقام بسرعة السكانر) = مابتأكّدش المودال · السكان اتسجّل
// 33) الجرد: الكومة جنب المنتج · الفوكس والكارسر بيفضلوا في خانة العدّ والتحميل بيخلص · «ده جرد التشغيل» مابيرجعش
//     لافتراضه · ضربة سكانر في خانة العدّ بترجّعها · سكانات لسه ماتبعتتش = التطبيق ممنوع · عدد أقل من الكومة = ممنوع ·
//     الطبيعي = wh_count_apply والمودال بيقول القطع اللي هتتطرح
// 34) ربط المنتجات: صف مربوط بالاسم بخاصية = النطاق «للاسم ده» (كان «بالخاصية» = حفظ تاني بيعمل ربط جديد)
// 35) محرر المنتج stale والفرق هيخلّيها بالسالب = الخانة 0 (مش رقم سالب مايتحفظش)
// 36) «خرجت من غير سكان»: اللي اتعمل بعدها جرد عليه «🧮» ومابيتعدّش في الشارة الحمرا
// ── المراجعة العدائية التالتة ──
// 37) كارت «محتاج قرار» وبعده سكان لسه بيتسجّل (الكارت «⏳ بيتسجّل») = F9 مابيعملش حاجة (كان بيفرض القرار القديم
//     على طرد مش قدام الموظف) · النتيجة القديمة رجعت «محتاجة انتباهك»
// 38) المودال مفتوح: زرار متداس (e.repeat) = مش سكان والمودال بيتأكّد بالكلام · كود J&T مكتوب بالإيد (60ms/زرار) = سبب مش سكان
// 39) الجرد: «اتسلّمت وانت بتعدّ» و«مرتجع ماتضربش» = سؤالين · التطبيق ممنوع قبل الإجابة (مفيش نداء) · ❓ جنب المنتج ·
//     «✅ أيوه» = wh_count_opts {moved:counted} والكومة جنب المنتج بقت 2 · «🚫 مش هنا» = مفيش طرح · pile_questions من
//     السيرفر = تحميل تاني · التطبيق بعدها = wh_count_apply
// 40) «خرجت من غير سكان»: جرد عدّ جزء من منتجاتها = «🧮 جزء من منتجاتها اتعدّ» وبتتعدّ في الشارة
// 41) خانة العدّ: رقم متداس (e.repeat) + Enter = الرقم بيفضل (كان بيترجّع ويقول «اتضرب كود»)
//
// المعايرات (مرساة + حارس — درس 47): codeChar مابيقراش الزرار → 2 · شيل ت→J → 3 · WH_DEDUPE_MS = 0 → 5 ·
// client_id جديد مع كل محاولة → 6 · شيل !scanned → 12 · شيل esc من المنتجات في القايمة → 15 · شيل أعمدة المخزن من
// RT_SCORE_COLS → 19 · شيل looksScanned من حارس المحادثات → 20 · الكمية PATCH مباشر → 21 · الفاضي = 0 في الجرد → 22
// + التالتة: whCard فاضل وقت «بيتسجّل» → 37 · الزرار المتداس ضربة → 38 · الكود بالإيد سكان → 38 · التطبيق من غير إجابة → 39 ·
// «اتعدّوا» مابيطرحش → 39 · «جزء من منتجاتها» → 40 · الرقم المتداس بيترجّع → 41
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
  if(r && typeof r.then === 'function') return r.then(function(d){ return { data: d, error:null }; });
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
  await p.waitForTimeout(150);
  const n17a = (await calls(p, 'wh_scan')).filter(c => /77$/.test(c.args.p_code)).length;
  // المودال الحقيقي: «↶ تراجع» على كارت السكان اللي فات → خانة السبب
  await p.click('#wh-result [data-wh-act="undo"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  const m17 = await p.evaluate(async (code) => {
    const AR = { J: 'ت', E: 'ث', G: 'ل' };
    const mi = document.getElementById('cmodal-input'); mi.focus(); mi.value = 'اتضرب '; mi.setSelectionRange(6, 6);
    for(const ch of code.split('')){
      const c = /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch;
      const k = AR[ch] || ch;
      const ev = new KeyboardEvent('keydown', { code: c, key: k, bubbles: true, cancelable: true });
      mi.dispatchEvent(ev);
      if(!ev.defaultPrevented) mi.setRangeText(k, mi.selectionStart, mi.selectionEnd, 'end');
    }
    const en = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true });
    mi.dispatchEvent(en);
    await new Promise(r => setTimeout(r, 300));
    return { v: mi.value, open: document.getElementById('cmodal-backdrop').style.display === 'flex', prevented: en.defaultPrevented };
  }, 'JEG000700000078');
  const sc78 = (await calls(p, 'wh_scan')).filter(c => /78$/.test(c.args.p_code)).length;
  const und17 = (await calls(p, 'wh_scan_undo')).length;
  await p.click('#cmodal-cancel');
  ok(n17a === 0 && sc78 === 1 && und17 === 0 && m17.open && m17.v === 'اتضرب ' && m17.prevented,
    '17) تاب «ربط المنتجات» = مفيش سكان · المودال مفتوح = السكان اتسجّل وحروفه اتشالت من السبب والمودال لسه مفتوح ('
    + JSON.stringify({ n17a, sc78, und17, m17 }) + ')');
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
  // رد متكتب بالإيد ومابعتهوش وبعدين السكانر ضرب في نفس الخانة: الكود بس اللي يتشال
  await p.evaluate(async ({ code }) => {
    const inp = document.getElementById('wa-input'); inp.focus(); inp.value = '';
    const AR = { KeyS: 'س', KeyG: 'ل', KeyH: 'ا', KeyL: 'م', Space: ' ' };
    for(const c of ['KeyS', 'KeyG', 'KeyH', 'KeyL', 'Space']){
      inp.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: AR[c], bubbles: true }));
      inp.value += AR[c];
      await new Promise(r => setTimeout(r, 140));
    }
    const SC = { J: 'ت', E: 'ث', G: 'ل' };
    for(const ch of code.split('')){
      inp.dispatchEvent(new KeyboardEvent('keydown', { code: /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch, key: SC[ch] || ch, bubbles: true }));
      inp.value += SC[ch] || ch;
    }
    inp.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
  }, { code: CODE });
  await p.waitForTimeout(300);
  const draft = await p.evaluate(() => ({ v: document.getElementById('wa-input').value }));
  await fire(true);
  await p.waitForTimeout(500);
  const slow = await p.evaluate(() => (window.__FNCALLS || []).filter(c => c.slug === 'wa-send').length);
  await ctx.close();
  return { fast, draft, slow };
}
const cg = await chatGuard();
ok(cg.fast.n === 0 && cg.fast.v === '' && cg.draft.v === 'سلام ' && cg.slow === 1,
  '20) المحادثات: كود بسرعة السكانر = مايتبعتش (والخانة فضيت) · بعد رد متكتب = الكود بس اتشال والرد فضل · بالإيد = بيتبعت (' + JSON.stringify(cg) + ')');

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

// 23 — «محتاجة انتباهك»
const ATTN_WHR = `window.__WHR = function(n, a){ if(n !== 'wh_scan') return null;
  var c = a.p_code;
  if(/91$/.test(c) && !a.p_force) return { ok:true, code:'with_jt_confirm', tone:'warn', options:['in','out'], order:{ uid:'18291', tracking_no:c }, applied:false };
  if(/92$/.test(c)) return { ok:true, code:'blocked_cancelled', tone:'stop', order:{ uid:'18292', tracking_no:c }, applied:false };
  if(/95$/.test(c)) return { ok:true, code:'blocked_cancel_requested', tone:'stop', order:{ uid:'18295', tracking_no:c }, applied:false };
  if(/94$/.test(c) && !a.p_force) return { ok:true, code:'confirm_return', tone:'warn', options:['in'], order:{ uid:'18294', tracking_no:c }, applied:false };
  if(a.p_force && window.__FORCE_DELAY) return new Promise(function(res){ setTimeout(function(){ res({ ok:true, code:'in_ok', tone:'in', dir:'in', applied:true, order:{ uid:'1829x', tracking_no:c }, lines:[] }); }, window.__FORCE_DELAY); });
  if(a.p_force === 'in') return { ok:true, code:'in_ok', tone:'in', dir:'in', applied:true, order:{ uid:'18291', tracking_no:c }, lines:[] };
  return { ok:true, code:'out_ok', tone:'ok', dir:'out', applied:true, order:{ uid:'18293', tracking_no:c }, lines:[] }; };`;
async function attnFlow(patch){
  const p = await open({ patch, init: ATTN_WHR });
  await scanKeys(p, 'JEG000700000091', {}); await p.waitForTimeout(250);
  await scanKeys(p, 'JEG000700000092', {}); await p.waitForTimeout(250);
  await scanKeys(p, 'JEG000700000093', {}); await p.waitForTimeout(300);
  const a1 = await p.evaluate(() => ({ rows: document.querySelectorAll('#wh-attn .wh-attn-row').length, vis: !document.getElementById('wh-attn').hidden,
    inBtn: !!document.querySelector('#wh-attn [data-wh-act="force-in"]'), card: document.getElementById('wh-result').getAttribute('data-code') }));
  // F9 والكارت أخضر (مالوش اختيار) = ولا حاجة — الاختيار من زرار الصف نفسه
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', bubbles: true, cancelable: true })));
  await p.waitForTimeout(200);
  const f0 = (await calls(p, 'wh_scan')).filter(c => c.args.p_force === 'in').length;
  const rb = await p.$('#wh-attn [data-wh-act="force-in"]');
  if(rb) await rb.click();
  await p.waitForTimeout(300);
  const f = f0 ? ['f9-forced'] : (await calls(p, 'wh_scan')).filter(c => c.args.p_force === 'in').map(c => c.args.p_code);
  const a2 = await p.evaluate(() => document.querySelectorAll('#wh-attn .wh-attn-row').length);
  const okBtn = await p.$('#wh-attn [data-wh-act="attn-ok"]');
  if(okBtn) await okBtn.click();
  await p.waitForTimeout(150);
  const a3 = await p.evaluate(() => document.getElementById('wh-attn').hidden);
  await p.context().close();
  return { a1, f, a2, a3 };
}
const at = await attnFlow();
ok(at.a1.rows === 2 && at.a1.vis && at.a1.inBtn && at.a1.card === 'out_ok' && at.f.length === 1 && /91$/.test(at.f[0]) && at.a2 === 1 && at.a3 === true,
  '23) «محتاجة انتباهك»: قرار + وقّف فضلوا بعد السكان الأخضر · F9 والكارت أخضر = ولا حاجة · «↩️ مرتجع» في الصف = 91 · «✓ شفته» شاله (' + JSON.stringify(at) + ')');

// 24 — Ctrl+J و F10
{
  const p = await open({});
  const r = await p.evaluate(() => {
    document.getElementById('wh-input').focus();
    const cj = new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', ctrlKey: true, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(cj);
    const f10 = new KeyboardEvent('keydown', { code: 'F10', key: 'F10', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(f10);
    return { cj: cj.defaultPrevented, f10: f10.defaultPrevented };
  });
  const n = (await calls(p, 'wh_scan')).length;
  await p.context().close();
  ok(r.cj && r.f10 && n === 0, '24) Ctrl+J والخانة فاضية · F10 من غير اختيار = preventDefault ومفيش سكان (' + JSON.stringify(r) + ')');
}

// 25 — رد البحث المتأخر
async function lateLookup(patch){
  const p = await open({ patch, init: `window.__WHR = function(n){ if(n === 'wh_lookup') return new Promise(function(res){ setTimeout(function(){ res({ ok:true, rows:[{ tracking_no:'JEG000700000044', uid:'18244', items:'منظم' }] }); }, 600); }); return null; };` });
  await p.evaluate(() => { const i = document.getElementById('wh-input'); i.focus(); i.value = '18244';
    i.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true })); });
  await p.waitForTimeout(100);
  await scanKeys(p, CODE, {});
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({ code: document.getElementById('wh-result').getAttribute('data-code'), pick: !!document.querySelector('#wh-result .wh-pick-row') }));
  await p.context().close();
  return r;
}
const ll = await lateLookup();
ok(ll.code === 'out_ok' && !ll.pick, '25) رد البحث وصل بعد سكان = الكارت بتاع السكان فاضل (' + JSON.stringify(ll) + ')');

// 26 — سكانات جلسة تانية
async function orphanFlow(patch){
  const p = await open({ patch, init: `try{ localStorage.setItem('sahl_wh_queue_other-user', JSON.stringify([{ cid:'11111111-2222-4333-8444-555555555555', code:'JEG000700000055', src:'scanner', at:new Date().toISOString(), tries:1 }])); }catch(e){}` });
  const vis = await p.evaluate(() => !document.getElementById('wh-orphan').hidden);
  const btn = await p.$('#wh-orphan [data-wh-act="orphans-send"]');
  if(btn) await btn.click();
  await p.waitForTimeout(400);
  const sc = (await calls(p, 'wh_scan')).filter(c => c.args.p_code === 'JEG000700000055').map(c => c.args.p_client_id);
  const left = await p.evaluate(() => localStorage.getItem('sahl_wh_queue_other-user'));
  const hid = await p.evaluate(() => document.getElementById('wh-orphan').hidden);
  await p.context().close();
  return { vis, sc, left, hid };
}
const of = await orphanFlow();
ok(of.vis && of.sc.length === 1 && of.sc[0] === '11111111-2222-4333-8444-555555555555' && of.left === null && of.hid,
  '26) سكانات جلسة تانية = بانر · «ابعتهم» = wh_scan بنفس الـclient_id والمفتاح اتمسح (' + JSON.stringify(of) + ')');

// 27 — stale في محرر المنتج
async function stockStale(patch){
  const p = await open({ patch, init: `window.__STOCK = [{ id:'p1', tenant_id:'t-test-1', name:'منظم', current_qty:10, unit_price:1000, wholesale_price:600, active:true, parent_id:null, variant_label:null }];
    window.__WHR = function(n, a){ if(n === 'wh_stock_adjust'){ if(a.p_expected_qty === 10) return { ok:false, code:'stale', qty:8 }; return { ok:true, code:'ok', qty:a.p_new_qty }; } return null; };` });
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.showPage('stock'); });
  await p.waitForSelector('.prod-edit-btn[data-id="p1"]', { timeout: 8000 });
  await p.click('.prod-edit-btn[data-id="p1"]');
  await p.waitForSelector('#pe-qty');
  await p.fill('#pe-qty', '12');
  await p.click('#pe-save');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible', timeout: 2000 });
  await p.fill('#cmodal-input', 'بضاعة وصلت'); await p.click('#cmodal-ok');
  await p.waitForTimeout(400);
  const v1 = await p.evaluate(() => { const q = document.getElementById('pe-qty'); return q ? q.value : null; });
  const open1 = await p.evaluate(() => document.getElementById('ovl').classList.contains('open'));
  if(open1){
    await p.click('#pe-save');
    await p.waitForSelector('#cmodal-backdrop', { state: 'visible', timeout: 2000 });
    await p.fill('#cmodal-input', 'بضاعة وصلت'); await p.click('#cmodal-ok');
    await p.waitForTimeout(400);
  }
  const adj = (await calls(p, 'wh_stock_adjust')).map(c => ({ n: c.args.p_new_qty, e: c.args.p_expected_qty }));
  await p.context().close();
  return { v1, open1, adj };
}
const ss = await stockStale();
ok(ss.v1 === '10' && ss.open1 && ss.adj.length === 2 && ss.adj[0].e === 10 && ss.adj[1].n === 10 && ss.adj[1].e === 8,
  '27) محرر المنتج stale: كتب 12 (كان 10) والسكانر خلّاه 8 = الخانة بقت 10 (+2 زي ما قصد) والحفظ التاني بـexpected 8 (' + JSON.stringify(ss) + ')');

// 28 — ربط المنتجات: التحديث الدوري + النطاق
async function mapFlow(patch){
  const p = await open({ patch, init: `window.__WHR = function(n){ if(n === 'wh_items_unmapped') return { ok:true, rows:[
      { item_key:'ترولي', props_key:'اسود', var_key:'اسود', sample:'ترولي 3 دور', orders:4, pieces:4, state:'unmatched' },
      { item_key:'منظم', props_key:'', var_key:'', sample:'منظم المطبخ', orders:2, pieces:2, state:'unmatched' }],
    products:[{ id:'p2', name:'ترولي', parent_id:null }, { id:'p2a', name:'ترولي — أسود', parent_id:'p2', variant_label:'أسود' }, { id:'p1', name:'منظم', parent_id:null }] }; return null; };` });
  await p.click('.wh-tab[data-wh-tab="map"]');
  await p.waitForSelector('#wh-map .wh-map-row', { timeout: 5000 });
  await p.selectOption('#wh-map .wh-map-row:first-child .wh-map-prod', 'p2a');
  const scope = await p.evaluate(() => document.querySelector('#wh-map .wh-map-row:first-child .wh-map-scope').value);
  await p.selectOption('#wh-map .wh-map-row:nth-child(2) .wh-map-prod', 'p1');
  await p.evaluate(async () => { window.__BOARD = Object.assign({}, window.__BOARD, { counts: Object.assign({}, window.__BOARD.counts, { pile: 9 }) }); });
  // تحديث القوايم (زي الـ30 ثانية) + رسم القايمة من حفظ صف تاني (فلتر)
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.evaluate(async () => { const m = await import('/js/warehouse/warehouse.js'); m.loadWarehouse(); });
  await p.waitForTimeout(400);
  await p.click('#wh-map [data-wha="map-filter"][data-k="unmatched"]');
  await p.waitForTimeout(150);
  const after = await p.evaluate(() => ({ a: document.querySelector('#wh-map .wh-map-row:first-child .wh-map-prod').value,
    s: document.querySelector('#wh-map .wh-map-row:first-child .wh-map-scope').value,
    b: document.querySelector('#wh-map .wh-map-row:nth-child(2) .wh-map-prod').value }));
  await p.context().close();
  return { scope, after };
}
const mf = await mapFlow();
ok(mf.scope === 'props' && mf.after.a === 'p2a' && mf.after.s === 'props' && mf.after.b === 'p1',
  '28) ربط المنتجات: اختيار خاصية = «بالخاصية دي بس» · تحديث القوايم ورسم القايمة مابيمسحوش الاختيارات (' + JSON.stringify(mf) + ')');

// ── 29–36: المراجعة العدائية التانية ──────────────────────────────────
const key = (p, k, extra) => p.evaluate(({ k, extra }) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, code: k, bubbles: true, cancelable: true }, extra || {}))), { k, extra });
async function f9Flow(patch){
  const p = await open({ patch, init: ATTN_WHR + 'window.__FORCE_DELAY = 500;' });
  await scanKeys(p, 'JEG000700000091', {}); await p.waitForTimeout(250);
  await scanKeys(p, 'JEG000700000094', {}); await p.waitForTimeout(250);
  const card = await p.evaluate(() => document.getElementById('wh-result').getAttribute('data-code'));
  await key(p, 'F10'); await p.waitForTimeout(150);
  const out = (await calls(p, 'wh_scan')).filter(c => c.args.p_force === 'out').length;
  await key(p, 'F9', { repeat: true }); await p.waitForTimeout(150);
  const rep = (await calls(p, 'wh_scan')).filter(c => c.args.p_force === 'in').length;
  await key(p, 'F9'); await p.waitForTimeout(60); await key(p, 'F9'); await p.waitForTimeout(900);
  const ins = (await calls(p, 'wh_scan')).filter(c => c.args.p_force === 'in').map(c => c.args.p_code.slice(-2));
  await p.context().close();
  return { card, out, rep, ins };
}
const f9 = await f9Flow();
ok(f9.card === 'confirm_return' && f9.out === 0 && f9.rep === 0 && f9.ins.length === 1 && f9.ins[0] === '94',
  '29) F9/F10 على الكارت بس: F10 على «مرتجع؟» = ولا حاجة · F9 متكرر = ولا حاجة · F9 مرتين = 94 بس (' + JSON.stringify(f9) + ')');

async function dblFlow(patch){
  const p = await open({ patch, init: ATTN_WHR });
  await scanKeys(p, 'JEG000700000092', {}); await p.waitForTimeout(250);
  await scanKeys(p, 'JEG000700000095', {}); await p.waitForTimeout(250);
  await scanKeys(p, 'JEG000700000093', {}); await p.waitForTimeout(300);
  const before = await p.evaluate(() => document.querySelectorAll('#wh-attn .wh-attn-row').length);
  await p.locator('#wh-attn .wh-attn-row').first().locator('[data-wh-act="attn-ok"]').dblclick();
  await p.waitForTimeout(250);
  const after = await p.evaluate(() => document.querySelectorAll('#wh-attn .wh-attn-row').length);
  await p.context().close();
  return { before, after };
}
const dc = await dblFlow();
ok(dc.before === 2 && dc.after === 1, '30) دبل كليك على «✓ شفته» = صف واحد اتشال (' + JSON.stringify(dc) + ')');

const BOARD_ON = Object.assign({}, BOARD, { enabled: true, baseline_at: NOW() });
async function cfgFlow(patch){
  const p = await open({ patch, board: BOARD_ON, init: `window.__WHR = function(n, a){ if(n === 'wh_config_set'){ var en = a.p && a.p.enabled; if(en != null) window.__BOARD = Object.assign({}, window.__BOARD, { enabled: !!en });
      return { ok:true, code:'ok', enabled: window.__BOARD.enabled, hold_cancel_requested:true }; } return null; };` });
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('#wh-count [data-wha="cfg-toggle"]', { timeout: 5000 });
  const l0 = await p.textContent('#wh-count [data-wha="cfg-toggle"]');
  await p.click('#wh-count [data-wha="cfg-toggle"]');
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const b = document.querySelector('#wh-count [data-wha="cfg-toggle"]');
    return { l1: b ? b.textContent : null, foc: document.activeElement === b, mode: document.getElementById('wh-mode').className }; });
  await p.click('#wh-count [data-wha="cfg-toggle"]');
  await p.waitForTimeout(400);
  const sent = (await calls(p, 'wh_config_set')).map(c => c.args.p.enabled);
  await p.context().close();
  return Object.assign({ l0, sent }, r);
}
const cfg31 = await cfgFlow();
ok(/وقّفه/.test(cfg31.l0) && /شغّله/.test(cfg31.l1 || '') && cfg31.foc && cfg31.sent.length === 2 && cfg31.sent[0] === false && cfg31.sent[1] === true,
  '31) «⏸️ وقّفه» بعد الضغطة = «▶️ شغّله» والفوكس عليه · الضغطة التانية = تشغيل (' + JSON.stringify(cfg31) + ')');

async function modalBurst(patch){
  const p = await open({ patch });
  await scanKeys(p, CODE, {}); await p.waitForTimeout(250);
  await p.click('#wh-result [data-wh-act="undo"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  const m = await p.evaluate(async () => {
    const mi = document.getElementById('cmodal-input'); mi.focus(); mi.value = 'سبب '; mi.setSelectionRange(4, 4);
    for(const ch of '1234567890'.split('')){
      const ev = new KeyboardEvent('keydown', { code: 'Digit' + ch, key: ch, bubbles: true, cancelable: true });
      mi.dispatchEvent(ev); if(!ev.defaultPrevented) mi.setRangeText(ch, mi.selectionStart, mi.selectionEnd, 'end');
    }
    mi.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 300));
    return { v: mi.value, open: document.getElementById('cmodal-backdrop').style.display === 'flex' };
  });
  const sc = (await calls(p, 'wh_scan')).filter(c => c.args.p_code === '1234567890').length;
  const und = (await calls(p, 'wh_scan_undo')).length;
  await p.context().close();
  return Object.assign({ sc, und }, m);
}
const mb = await modalBurst();
ok(mb.open && mb.v === 'سبب ' && mb.sc === 1 && mb.und === 0, '32) المودال مفتوح + ضربة 10 أرقام بسرعة السكانر = المودال فاضل · السكان اتسجّل (' + JSON.stringify(mb) + ')');

async function countFlow2(patch){
  const p = await open({ patch, init: `window.__STOCK = [{ id:'p1', tenant_id:'t-test-1', name:'منظم', current_qty:10, active:true, parent_id:null },
      { id:'p2', tenant_id:'t-test-1', name:'ترولي', current_qty:5, active:true, parent_id:null }];
    window.__WH_COUNTS = [{ id: 7, tenant_id:'t-test-1', opened_at: new Date().toISOString(), opened_by_name:'أدمن', applied_at:null, cancelled_at:null, go_live:false }];
    window.__WHR = function(n){
      if(n === 'wh_count_pile') return new Promise(function(res){ setTimeout(function(){ res({ ok:true, count_id:7, opts:{}, pile:[{ product_id:'p1', pile:2, moved:0, ret:0 }], pile_orders:1, moved_orders:0, ret_orders:0, moved_list:[], ret_list:[] }); }, window.__PILE_DELAY || 0); });
      if(n === 'wh_count_apply') return { ok:true, code:'ok', changed:1, pile:2 }; return null; };` });
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('#wh-count .wh-ci[data-pid="p1"]', { timeout: 5000 });
  const R = {};
  R.pile = await p.evaluate(() => { const r = document.querySelector('#wh-count .wh-ci[data-pid="p1"]').closest('.wh-count-row').querySelector('.wh-cpile'); return r ? r.textContent : null; });
  R.warn = await p.evaluate(() => !!document.querySelector('#wh-count .wh-count-warn'));
  await p.click('#wh-golive');
  await p.evaluate(() => { window.__PILE_DELAY = 700; });
  await p.focus('#wh-count .wh-ci[data-pid="p2"]');
  await p.keyboard.type('4');
  await p.evaluate(() => document.querySelector('#wh-count [data-wha="count-reload"]').click());
  await p.keyboard.type('2');
  await p.waitForTimeout(1000);
  await p.keyboard.type('3');
  R.focus = await p.evaluate(() => { const a = document.activeElement; return { pid: a && a.getAttribute('data-pid'), v: a && a.value }; });
  R.gl = await p.evaluate(() => !!document.getElementById('wh-golive').checked);
  await p.evaluate(() => { window.__PILE_DELAY = 0; });
  // ضربة سكانر في خانة العدّ
  await p.fill('#wh-count .wh-ci[data-pid="p1"]', '9');
  R.burst = await p.evaluate(() => { const t = document.querySelector('#wh-count .wh-ci[data-pid="p1"]'); t.focus();
    for(const ch of 'JEG000538937803'.split('')){ const ev = new KeyboardEvent('keydown', { code: /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch, key: ch, bubbles: true, cancelable: true });
      t.dispatchEvent(ev); if(!ev.defaultPrevented) t.setRangeText(ch, t.selectionStart, t.selectionEnd, 'end'); }
    t.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
    return t.value; });
  // سكانات لسه ماتبعتتش (جلسة تانية على الجهاز) = ممنوع
  await p.evaluate(() => localStorage.setItem('sahl_wh_queue_other', JSON.stringify([{ cid:'11111111-2222-4333-8444-555555555555', code:'JEG000700000066', src:'scanner', at:new Date().toISOString(), tries:0 }])));
  const closeModal = async () => { if(await p.evaluate(() => document.getElementById('cmodal-backdrop').style.display === 'flex')){ await p.click('#cmodal-cancel'); await p.waitForTimeout(100); return 1; } return 0; };
  await p.click('[data-wha="count-apply"]'); await p.waitForTimeout(200);
  R.pend = (await closeModal()) + (await calls(p, 'wh_count_apply')).length;
  await p.evaluate(() => localStorage.removeItem('sahl_wh_queue_other'));
  // أقل من الكومة = ممنوع
  await p.fill('#wh-count .wh-ci[data-pid="p1"]', '1');
  await p.click('[data-wha="count-apply"]'); await p.waitForTimeout(200);
  R.short = (await closeModal()) + (await calls(p, 'wh_count_apply')).length;
  await p.fill('#wh-count .wh-ci[data-pid="p1"]', '9');
  await p.click('[data-wha="count-apply"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  R.sub = await p.textContent('#cmodal-sub');
  await p.click('#cmodal-ok'); await p.waitForTimeout(300);
  R.ap = (await calls(p, 'wh_count_apply')).map(c => c.args);
  await p.context().close();
  return R;
}
const c2 = await countFlow2();
ok(/2/.test(c2.pile || '') && c2.warn && c2.focus.pid === 'p2' && c2.focus.v === '423' && c2.gl === false && c2.burst === '9'
   && c2.pend === 0 && c2.short === 0 && /2 قطعة/.test(c2.sub || '') && c2.ap.length === 1 && c2.ap[0].p_go_live === false
   && c2.ap[0].p_counts.some(x => x.product_id === 'p1' && x.counted === 9),
  '33) الجرد: الكومة · الفوكس فاضل · جرد التشغيل مابيرجعش · ضربة السكانر اترجعت · معلّق = ممنوع · أقل من الكومة = ممنوع · التطبيق (' + JSON.stringify(c2) + ')');

async function mapScope(patch){
  const p = await open({ patch, init: `window.__WHR = function(n){ if(n === 'wh_items_unmapped') return { ok:true, rows:[
      { item_key:'ترولي', props_key:'اسود', var_key:'اسود', sample:'ترولي 3 دور', orders:4, pieces:4, state:'posted', product_id:'p2a', matched_by:'alias_item', product_name:'ترولي — أسود', alias_item:'p2a', alias_item_ignore:false }],
    products:[{ id:'p2', name:'ترولي', parent_id:null }, { id:'p2a', name:'ترولي — أسود', parent_id:'p2', variant_label:'أسود' }] }; return null; };` });
  await p.click('.wh-tab[data-wh-tab="map"]');
  await p.click('#wh-map [data-wha="map-filter"][data-k="all"]').catch(() => {});
  await p.waitForSelector('#wh-map .wh-map-row .wh-map-scope', { timeout: 5000 });
  const v = await p.evaluate(() => document.querySelector('#wh-map .wh-map-row .wh-map-scope').value);
  await p.context().close();
  return v;
}
const ms = await mapScope();
ok(ms === 'item', '34) ربط بالاسم بخاصية = النطاق «للاسم ده» (' + ms + ')');

async function stockNeg(patch){
  const p = await open({ patch, init: `window.__STOCK = [{ id:'p1', tenant_id:'t-test-1', name:'منظم', current_qty:2, unit_price:1000, wholesale_price:600, active:true, parent_id:null, variant_label:null }];
    window.__WHR = function(n, a){ if(n === 'wh_stock_adjust'){ if(a.p_expected_qty === 2) return { ok:false, code:'stale', qty:-2 }; return { ok:true, code:'ok', qty:a.p_new_qty }; } return null; };` });
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.showPage('stock'); });
  await p.waitForSelector('.prod-edit-btn[data-id="p1"]', { timeout: 8000 });
  await p.click('.prod-edit-btn[data-id="p1"]');
  await p.waitForSelector('#pe-qty');
  await p.fill('#pe-qty', '3');
  await p.click('#pe-save');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible', timeout: 2000 });
  await p.fill('#cmodal-input', 'بضاعة وصلت'); await p.click('#cmodal-ok');
  await p.waitForTimeout(400);
  const v = await p.evaluate(() => { const q = document.getElementById('pe-qty'); return q ? q.value : null; });
  await p.context().close();
  return v;
}
const sn = await stockNeg();
ok(sn === '0', '35) stale والفرق هيخلّيها بالسالب = الخانة 0 (' + sn + ')');

const BOARD_LC = Object.assign({}, BOARD, { counts: Object.assign({}, BOARD.counts, { leak: 3, leak_counted: 2, unmatched_lines: 1, negative_products: 0 }),
  lists: Object.assign({}, BOARD.lists, { leak: [{ id: 'o-leak-1', t: 'JEG000700000021', uid: '18221', items: 'منظم', jt_at: NOW(), cancelled: false, counted: true }] }) });
async function leakCounted(patch){
  const p = await open({ patch, board: BOARD_LC });
  await p.click('#wh-chips .wh-chip[data-wh-list="leak"]'); await p.waitForTimeout(150);
  const r = await p.evaluate(() => ({ mark: /🧮/.test(document.getElementById('wh-lists').textContent), b2: (document.getElementById('wh-nav-badge2') || {}).textContent }));
  await p.context().close();
  return r;
}
const lc = await leakCounted();
ok(lc.mark && lc.b2 === '2', '36) «خرجت من غير سكان» اتعمل بعدها جرد = «🧮» ومابتتعدّش في الشارة (' + JSON.stringify(lc) + ')');

// ── 37–41: المراجعة العدائية التالتة ──────────────────────────────────
async function pendingF9(patch){
  const p = await open({ patch, init: ATTN_WHR + `var __w0 = window.__WHR; window.__WHR = function(n, a){
      if(n === 'wh_scan' && /96$/.test(a.p_code)) return new Promise(function(res){ setTimeout(function(){ res({ ok:true, code:'out_ok', tone:'ok', dir:'out', applied:true, order:{ uid:'18296', tracking_no:a.p_code }, lines:[] }); }, 900); });
      return __w0(n, a); };` });
  await scanKeys(p, 'JEG000700000091', {}); await p.waitForTimeout(250);
  const c0 = await p.evaluate(() => document.getElementById('wh-result').getAttribute('data-code'));
  await scanKeys(p, 'JEG000700000096', {}); await p.waitForTimeout(150);
  const pend = await p.evaluate(() => /is-pending/.test(document.getElementById('wh-result').className));
  await key(p, 'F9'); await p.waitForTimeout(150);
  const attn = await p.evaluate(() => ({ vis: !document.getElementById('wh-attn').hidden, rows: document.querySelectorAll('#wh-attn .wh-attn-row').length,
    txt: document.getElementById('wh-attn').textContent.indexOf('18291') >= 0 || document.getElementById('wh-attn').textContent.indexOf('00000091') >= 0 }));
  // القرار المفروض بيستنى في الطابور ورا السكان اللي في السكة — العدّ بعد ما الاتنين يخلصوا
  await p.waitForTimeout(1300);
  const forced = (await calls(p, 'wh_scan')).filter(c => c.args.p_force).length;
  const c1 = await p.evaluate(() => document.getElementById('wh-result').getAttribute('data-code'));
  await p.context().close();
  return { c0, pend, forced, attn, c1 };
}
const pf = await pendingF9();
ok(pf.c0 === 'with_jt_confirm' && pf.pend && pf.forced === 0 && pf.attn.vis && pf.attn.rows === 1 && pf.c1 === 'out_ok',
  '37) الكارت «بيتسجّل» = F9 مابيفرضش القرار القديم · رجع «محتاجة انتباهك» (' + JSON.stringify(pf) + ')');

// المودال مفتوح: ضغطات في خانة السبب (كل زرار: keydown ولو مااتمنعش يتكتب) ثم Enter
async function modalKeys(patch, seq, gap){
  const p = await open({ patch });
  await scanKeys(p, CODE, {}); await p.waitForTimeout(250);
  await p.click('#wh-result [data-wh-act="undo"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  const m = await p.evaluate(async ({ seq, gap }) => {
    const mi = document.getElementById('cmodal-input'); mi.focus(); mi.value = 'سبب '; mi.setSelectionRange(4, 4);
    for(const k of seq){
      const ev = new KeyboardEvent('keydown', { code: /\d/.test(k.ch) ? 'Digit' + k.ch : 'Key' + k.ch, key: k.ch, repeat: !!k.rep, bubbles: true, cancelable: true });
      mi.dispatchEvent(ev); if(!ev.defaultPrevented) mi.setRangeText(k.ch, mi.selectionStart, mi.selectionEnd, 'end');
      if(gap) await new Promise(r => setTimeout(r, gap));
    }
    const v = mi.value;
    mi.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 300));
    return { v, open: document.getElementById('cmodal-backdrop').style.display === 'flex' };
  }, { seq, gap });
  const scans = (await calls(p, 'wh_scan')).map(c => c.args.p_code).filter(c => c !== CODE);
  const und = (await calls(p, 'wh_scan_undo')).map(c => c.args.p_reason);
  await p.context().close();
  return Object.assign({ scans, und }, m);
}
const HELD = [{ ch: '1' }].concat(Array.from({ length: 11 }, () => ({ ch: '1', rep: true })));
const MANUAL = 'JEG000700000077'.split('').map(ch => ({ ch }));
const mh = await modalKeys(null, HELD, 0);
const mm = await modalKeys(null, MANUAL, 60);
ok(mh.scans.length === 0 && mh.und.length === 1 && /1{12}/.test(mh.und[0] || '') && mm.scans.length === 0 && mm.und.length === 1 && /JEG000700000077/.test(mm.und[0] || ''),
  '38) المودال: زرار متداس = مش سكان والسبب اتبعت · كود مكتوب بالإيد = سبب مش سكان (' + JSON.stringify({ mh, mm }) + ')');

const Q_INIT = `window.__STOCK = [{ id:'p1', tenant_id:'t-test-1', name:'منظم', current_qty:10, active:true, parent_id:null },
      { id:'p2', tenant_id:'t-test-1', name:'ترولي', current_qty:5, active:true, parent_id:null }];
    window.__WH_COUNTS = [{ id: 7, tenant_id:'t-test-1', opened_at: new Date().toISOString(), opened_by_name:'أدمن', applied_at:null, cancelled_at:null, go_live:false }];
    window.__OPTS = {}; window.__PILEN = 0; window.__APPLY_Q = 0;
    window.__WHR = function(n, a){
      if(n === 'wh_count_pile'){ window.__PILEN++; return { ok:true, count_id:7, opts: JSON.parse(JSON.stringify(window.__OPTS)),
        pile:[{ product_id:'p1', pile:1, moved:1, ret:0 }, { product_id:'p2', pile:0, moved:0, ret:2 }], pile_orders:1, moved_orders:1, ret_orders:1,
        moved_list:[{ uid:'18300', t:'00000033' }], ret_list:[{ uid:'18301', t:'00000044' }] }; }
      if(n === 'wh_count_opts'){ var o = a.p_opts || {};
        if(o.moved){ window.__OPTS.moved = o.moved; window.__OPTS.moved_n = 1; window.__OPTS.moved_by = 'أدمن'; }
        if(o.ret){ window.__OPTS.ret = o.ret; window.__OPTS.ret_n = 1; window.__OPTS.ret_by = 'أدمن'; }
        return { ok:true, code:'ok', opts: JSON.parse(JSON.stringify(window.__OPTS)) }; }
      if(n === 'wh_count_apply'){ if(window.__APPLY_Q){ window.__APPLY_Q = 0; return { ok:false, code:'pile_questions', moved:1, returns_unscanned:1 }; }
        return { ok:true, code:'ok', changed:1, pile:2 }; }
      return null; };`;
async function countQ(patch){
  const p = await open({ patch, init: Q_INIT });
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('#wh-count .wh-count-q[data-k="moved"]', { timeout: 5000 });
  const rowTxt = (pid) => p.evaluate(pid => { const r = document.querySelector('#wh-count .wh-ci[data-pid="' + pid + '"]').closest('.wh-count-row');
    const a = r.querySelector('.wh-cpile:not(.q)'), q = r.querySelector('.wh-cpile.q'); return { pile: a ? a.textContent : '', q: q ? q.textContent : '' }; }, pid);
  const R = {};
  R.need0 = await p.evaluate(() => document.querySelectorAll('#wh-count .wh-count-q.need').length);
  R.r1 = await rowTxt('p1'); R.r2 = await rowTxt('p2');
  await p.fill('#wh-count .wh-ci[data-pid="p1"]', '9');
  await p.fill('#wh-count .wh-ci[data-pid="p2"]', '5');
  await p.click('[data-wha="count-apply"]'); await p.waitForTimeout(200);
  R.block = (await calls(p, 'wh_count_apply')).length + (await p.evaluate(() => document.getElementById('cmodal-backdrop').style.display === 'flex' ? 1 : 0));
  await p.click('#wh-count [data-wha="count-opt"][data-k="moved"][data-v="counted"]'); await p.waitForTimeout(300);
  R.opt1 = (await calls(p, 'wh_count_opts')).map(c => c.args.p_opts);
  R.r1b = await rowTxt('p1');
  await p.click('#wh-count [data-wha="count-opt"][data-k="ret"][data-v="absent"]'); await p.waitForTimeout(300);
  R.r2b = await rowTxt('p2');
  R.need1 = await p.evaluate(() => document.querySelectorAll('#wh-count .wh-count-q.need').length);
  // السيرفر لقى طرد جديد وقت التأكيد = pile_questions → تحميل تاني
  await p.evaluate(() => { window.__APPLY_Q = 1; });
  const pn0 = await p.evaluate(() => window.__PILEN);
  await p.click('[data-wha="count-apply"]'); await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  await p.click('#cmodal-ok'); await p.waitForTimeout(400);
  R.reload = (await p.evaluate(() => window.__PILEN)) > pn0;
  await p.click('[data-wha="count-apply"]'); await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  R.sub = await p.textContent('#cmodal-sub');
  await p.click('#cmodal-ok'); await p.waitForTimeout(300);
  R.ap = (await calls(p, 'wh_count_apply')).length;
  await p.context().close();
  return R;
}
const cq = await countQ();
ok(cq.need0 === 2 && /1/.test(cq.r1.pile) && /1/.test(cq.r1.q) && /2/.test(cq.r2.q) && cq.block === 0
   && cq.opt1.length === 1 && cq.opt1[0].moved === 'counted' && /2/.test(cq.r1b.pile) && !cq.r1b.q && cq.r2b.pile === '' && !cq.r2b.q
   && cq.need1 === 0 && cq.reload && /2 قطعة/.test(cq.sub || '') && cq.ap === 2,
  '39) الجرد: سؤالين · التطبيق ممنوع قبل الإجابة · «اتعدّوا» = الكومة 2 · «مش هنا» = مفيش طرح · pile_questions = تحميل تاني · التطبيق (' + JSON.stringify(cq) + ')');

const BOARD_CS = Object.assign({}, BOARD, { counts: Object.assign({}, BOARD.counts, { leak: 1, leak_counted: 0, unmatched_lines: 0, negative_products: 0 }),
  lists: Object.assign({}, BOARD.lists, { leak: [{ id: 'o-leak-2', t: 'JEG000700000022', uid: '18222', items: 'منظم · استاند', jt_at: NOW(), cancelled: false, counted: false, counted_some: true }] }) });
async function leakSome(patch){
  const p = await open({ patch, board: BOARD_CS });
  await p.click('#wh-chips .wh-chip[data-wh-list="leak"]'); await p.waitForTimeout(150);
  const r = await p.evaluate(() => ({ some: /جزء من منتجاتها اتعدّ/.test(document.getElementById('wh-lists').textContent), b2: (document.getElementById('wh-nav-badge2') || {}).textContent }));
  await p.context().close();
  return r;
}
const ls = await leakSome();
ok(ls.some && ls.b2 === '1', '40) «خرجت من غير سكان» وجرد عدّ جزء من منتجاتها = «جزء من منتجاتها اتعدّ» وبتتعدّ في الشارة (' + JSON.stringify(ls) + ')');

async function ciHeld(patch){
  const p = await open({ patch, init: `window.__STOCK = [{ id:'p1', tenant_id:'t-test-1', name:'منظم', current_qty:10, active:true, parent_id:null }];
    window.__WH_COUNTS = [{ id: 7, tenant_id:'t-test-1', opened_at: new Date().toISOString(), opened_by_name:'أدمن', applied_at:null, cancelled_at:null, go_live:false }];` });
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('#wh-count .wh-ci[data-pid="p1"]', { timeout: 5000 });
  const v = await p.evaluate(() => { const t = document.querySelector('#wh-count .wh-ci[data-pid="p1"]'); t.focus(); t.value = '';
    for(let i = 0; i < 10; i++){ const ev = new KeyboardEvent('keydown', { code: 'Digit5', key: '5', repeat: i > 0, bubbles: true, cancelable: true });
      t.dispatchEvent(ev); if(!ev.defaultPrevented) t.setRangeText('5', t.selectionStart, t.selectionEnd, 'end'); }
    t.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
    return t.value; });
  await p.context().close();
  return v;
}
const ch = await ciHeld();
ok(ch === '5555555555', '41) خانة العدّ: رقم متداس + Enter = الرقم فاضل (' + ch + ')');

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
  const c = await chatGuard(s => s.replace("if(cut && parseWaybill(cut).code===tail){", "if(false){"));
  ok(c.draft.v !== 'سلام ', 'معايرة (ص) الكود مابيتشالش من آخر الرد → 20 وقع (' + JSON.stringify(c.draft) + ')');
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

{
  // (ك) شيل حارس المودال: السكان مابيتسجّلش / الكود بيتكتب في السبب
  const p = await open({ patch: { wh: s => s.replace('  if(modalScanGuard(e)) return;\n', '') } });
  await scanKeys(p, CODE, {}); await p.waitForTimeout(250);
  await p.click('#wh-result [data-wh-act="undo"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  await p.evaluate(() => { const mi = document.getElementById('cmodal-input'); mi.focus();
    for(const ch of 'JEG000700000078'.split('')){ const ev = new KeyboardEvent('keydown', { code: /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch, key: ch, bubbles: true, cancelable: true });
      mi.dispatchEvent(ev); if(!ev.defaultPrevented) mi.setRangeText(ch, mi.selectionStart, mi.selectionEnd, 'end'); }
    mi.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true })); });
  await p.waitForTimeout(300);
  const sc = (await calls(p, 'wh_scan')).filter(c => /78$/.test(c.args.p_code)).length;
  const und = (await calls(p, 'wh_scan_undo')).length;
  await p.context().close();
  ok(sc === 0 || und > 0, 'معايرة (ك) شيل حارس المودال → 17 وقع (' + JSON.stringify({ sc, und }) + ')');
}
{
  const r = await attnFlow({ wh: s => s.replace("  if(!res || res.code === 'net') return null;\n", "  return null;\n") });
  ok(!(r.a1.rows === 2 && r.f.length === 1 && /91$/.test(r.f[0] || '')), 'معايرة (ل) مفيش قايمة انتباه → 23 وقع');
}
{
  const p = await open({ patch: { wh: s => s.replace('    if(e.ctrlKey) e.preventDefault();\n', '') } });
  const cj = await p.evaluate(() => { document.getElementById('wh-input').focus();
    const e = new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', ctrlKey: true, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(e); return e.defaultPrevented; });
  await p.context().close();
  ok(!cj, 'معايرة (م) شيل preventDefault على Ctrl+J → 24 وقع');
}
{
  const r = await lateLookup({ wh: s => s.replace(/    if\(gen !== whCardGen\)\{ toast\([^\n]*\n/, '') });
  ok(!(r.code === 'out_ok' && !r.pick), 'معايرة (ن) شيل فحص الجيل في البحث → 25 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await orphanFlow({ wh: s => s.replace("function renderOrphans(){\n  var el = $id('wh-orphan'); if(!el) return;", "function renderOrphans(){\n  var el = $id('wh-orphan'); if(!el) return; return;") });
  ok(!(r.vis && r.sc.length === 1), 'معايرة (س) البانر مابيظهرش → 26 وقع');
}
{
  const r = await stockStale({ stock: s => s.replace(',p_expected_qty:expected}', '}') });
  ok(!(r.adj.length === 2 && r.adj[0].e === 10 && r.adj[1].e === 8), 'معايرة (ع) من غير p_expected_qty → 27 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await mapFlow({ adm: s => s.replace('    var pk = mapPick[k];\n', '    var pk = null;\n') });
  ok(!(r.after.a === 'p2a' && r.after.b === 'p1'), 'معايرة (ف) الرسم بيمسح الاختيار → 28 وقع (' + JSON.stringify(r) + ')');
}

{
  const r = await f9Flow({ wh: s => s.replace("    var co = (whCard && !whCard.forced && whCard.res && whCard.res.options) || [];\n    if(co.indexOf(want) >= 0) whForce(want, whCard.attnId || null);\n",
    "    for(var i9 = 0; i9 < whAttn.length; i9++){ if((whAttn[i9].res.options || []).indexOf(want) >= 0){ whForce(want, whAttn[i9].id); break; } }\n") });
  ok(!(r.out === 0 && r.ins.length === 1), 'معايرة (ق) F9/F10 بيمشوا على «محتاجة انتباهك» → 29 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await dblFlow({ wh: s => s.replace(/  if\(e\.detail > 1 && [^\n]*\n/, '') });
  ok(r.after !== 1, 'معايرة (ر) شيل حارس الدبل كليك → 30 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await cfgFlow({ adm: s => s.replace("  if(inside && !force && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName || '')) return;\n", "  if(inside) return;\n") });
  ok(!/شغّله/.test(r.l1 || ''), 'معايرة (ش) الإعدادات مابتترسمش والفوكس على الزرار → 31 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await modalBurst({ wh: s => s.replace('    if(!isWay && bn >= 8 && bt.avg <= 35 && bt.max <= 120 && !/^(.)\\1+$/.test(bTail)){', '    if(false){') });
  ok(!(r.open && r.sc === 1 && r.und === 0), 'معايرة (ت) المودال بيقبل JEG بس → 32 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await countFlow2({ adm: s => s.replace('  renderCountBody(el);\n  if(keep && keep.pid){', '  renderCountBody(el);\n  if(false){') });
  ok(r.focus.v !== '423', 'معايرة (ث) الفوكس بيضيع مع الرسم → 33 وقع (' + JSON.stringify(r.focus) + ')');
}
{
  const r = await countFlow2({ adm: s => s.replace("(cntGoLive ? ' checked' : '')", "(!base ? ' checked' : '')") });
  ok(r.gl !== false, 'معايرة (خ) «جرد التشغيل» بيرجع لافتراضه → 33 وقع');
}
{
  const r = await countFlow2({ adm: s => s.replace('  if(pay.short.length){\n', '  if(false){\n') });
  ok(r.short !== 0, 'معايرة (ذ) أقل من الكومة بيعدّي → 33 وقع');
}
{
  const r = await countFlow2({ adm: s => s.replace('    if(b.el === t && b.n >= 8', '    if(false && b.n >= 8') });
  ok(r.burst !== '9', 'معايرة (ض) ضربة السكانر بتتكتب في خانة العدّ → 33 وقع (' + r.burst + ')');
}
{
  const r = await countFlow2({ adm: s => s.replace('  if(pend > 0){', '  if(false){') });
  ok(r.pend !== 0, 'معايرة (ظ) سكانات معلّقة مابتمنعش التطبيق → 33 وقع');
}
{
  const v = await mapScope({ adm: s => s.replace("  if((r.alias_item || r.alias_item_ignore) && (!pid || pid === r.alias_item)) return 'item';\n", '') });
  ok(v !== 'item', 'معايرة (غ) النطاق مابيوصفش الربط الموجود → 34 وقع (' + v + ')');
}
{
  const v = await stockNeg({ stock: s => s.replace('            if(want<0){', '            if(false){') });
  ok(v !== '0', 'معايرة (أأ) الفرق بالسالب في الخانة → 35 وقع (' + v + ')');
}
{
  const r = await leakCounted({ wh: s => s.replace('Math.max(0, (c.leak || 0) - (c.leak_counted || 0))', '(c.leak || 0)') });
  ok(r.b2 !== '2', 'معايرة (بب) الشارة بتعدّ اللي اتعمل بعدها جرد → 36 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await pendingF9({ wh: s => s.replace("  whCard = null;\n  renderAttn();\n  el.className = 'wh-result is-pending';", "  el.className = 'wh-result is-pending';") });
  ok(r.forced !== 0, 'معايرة (تت) الكارت «بيتسجّل» وwhCard فاضل → 37 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await modalKeys({ code: s => s.replace("      if(e.repeat){ if(!/^(Shift|Caps|Control|Alt|Meta)/.test(String(e.key || ''))) dirty = true; return; }\n", ''),
                              wh: s => s.replace(" && !/^(.)\\1+$/.test(bTail)){", "){") }, HELD, 0);
  ok(!(r.scans.length === 0 && r.und.length === 1), 'معايرة (ثث) الزرار المتداس بيتحسب ضربة سكانر → 38 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await modalKeys({ wh: s => s.replace(" && looksScanned(whModalKeys.timing(15));", ";") }, MANUAL, 60);
  ok(!(r.scans.length === 0 && r.und.length === 1), 'معايرة (جج) كود J&T مكتوب بالإيد بيتحسب سكان → 38 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await countQ({ adm: s => s.replace("  var nq = whPileNeed(cntPile, cnt.id);\n  if(nq.moved || nq.ret){", "  var nq = whPileNeed(cntPile, cnt.id);\n  if(false){") }).catch(e => ({ err: String(e) }));
  ok(r.err || r.block !== 0, 'معايرة (حح) التطبيق مابيستناش الإجابة → 39 وقع');
}
{
  const r = await countQ({ adm: s => s.replace("(o.moved === 'counted' ? r.moved : 0)", '0') }).catch(e => ({ err: String(e) }));
  ok(r.err || !/2/.test((r.r1b || {}).pile || ''), 'معايرة (خخ) «اتعدّوا» مابيطرحش → 39 وقع (' + JSON.stringify(r.r1b || r.err) + ')');
}
{
  const r = await leakSome({ wh: s => s.replace("        : x.counted_some ? '<span", "        : false ? '<span") });
  ok(!r.some, 'معايرة (دد) «جزء من منتجاتها» مش ظاهر → 40 وقع');
}
{
  const v = await ciHeld({ adm: s => s.replace("  if(e.repeat){ ciBurst = { el: null, snap: '', last: 0, n: 0, sum: 0, max: 0 }; return; }\n", '') });
  ok(v !== '5555555555', 'معايرة (ذذ) الرقم المتداس بيترجّع → 41 وقع (' + v + ')');
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
