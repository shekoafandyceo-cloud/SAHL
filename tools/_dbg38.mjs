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
// 38) المودال مفتوح: زرار متداس (e.repeat) = مش سكان والمودال بيتأكّد بالكلام · كود J&T مكتوب بالإيد (60ms/زرار) = سبب مش سكان ·
//     سكانر أبطأ (~38ms) وفيه تهنيجة 150ms = سكان والمودال فاضل مفتوح (المراجعة الرابعة — كان بيتأكّد بالكود كسبب)
// 39) الجرد (المراجعة الرابعة): السؤال **جنب كل منتج** · التطبيق ممنوع قبل الإجابة (مفيش نداء) · منتجين بإجابتين مختلفتين
//     (اتعدّ قبل المندوب / بعده) · «للكل» من فوق · الإجابة بتبعت **الطرود اللي اتعرضت** (ids) · طرد جديد ظهر = changed
//     والسؤال بيرجع على المنتج ده بس · زرار الإجابة بالكيبورد الفوكس بيفضل عليه · pile_questions = تحميل تاني
// 40) «خرجت من غير سكان»: جرد عدّ جزء من منتجاتها = «🧮 جزء من منتجاتها اتعدّ» وبتتعدّ في الشارة
// 41) خانة العدّ: رقم متداس (e.repeat) + Enter = الرقم بيفضل (كان بيترجّع ويقول «اتضرب كود»)
// ── المراجعة العدائية الخامسة ──
// 42) الجرد: سؤال المرتجع بالتوقيت («كانوا هنا لما عدّيت المنتج» / «ماتعدّوش — وصلوا بعد ما عدّيته») · الملخص فوق بيعدّ
//     المنتجات اللي في القايمة بس (منتج مش نشط مالوش سؤال) و«للكل» مابيبعتهوش · الأحمر فوق = منتج مكتوب عدده لسه
//     محتاج إجابة · «غير موزع» عليه طرود = «اعدّها هنا مش تحت لونها» + الكومة بأرقامها (والفاضي = «اكتب 0») · السكرول على
//     سؤال المنتج اللي اتقال اسمه (مش أول سؤال في الصفحة) · «طبّق» والإجابة لسه بتتحفظ = ولا حاجة · مودال «سكانات وانت
//     بتعدّ» بيتكلم عن المرتجع اللي اتضرب والسطور المش مربوطة (مش «سطر خروج»)
// 43) wh_count_pile وقع = بانر أحمر بـ↻ و«طبّق» مقفول (كانت الصفحة بتتعرض كأن مفيش كومة والتأكيد بيكدب)
//
// المعايرات (مرساة + حارس — درس 47): codeChar مابيقراش الزرار → 2 · شيل ت→J → 3 · WH_DEDUPE_MS = 0 → 5 ·
// client_id جديد مع كل محاولة → 6 · شيل !scanned → 12 · شيل esc من المنتجات في القايمة → 15 · شيل أعمدة المخزن من
// RT_SCORE_COLS → 19 · شيل looksScanned من حارس المحادثات → 20 · الكمية PATCH مباشر → 21 · الفاضي = 0 في الجرد → 22
// + التالتة: whCard فاضل وقت «بيتسجّل» → 37 · الزرار المتداس ضربة → 38 · الكود بالإيد سكان → 38 · التطبيق من غير إجابة → 39 ·
// «اتعدّوا» مابيطرحش → 39 · «جزء من منتجاتها» → 40 · الرقم المتداس بيترجّع → 41
// + الرابعة: حد السرعة الضيق على كود J&T في المودال → 38 · الإجابة لكل المنتجات → 39 · من غير الطرود اللي اتعرضت → 39 ·
// الفوكس مابيرجعش للزرار → 39 · «طرود جديدة ظهرت» مابتتقالش → 39
// + الخامسة: كلام المرتجع القديم → 42 · «طبّق» مابيستناش الإجابة → 42 · السكرول لأول سؤال → 42 · الملخص بيعدّ المش نشط → 42 ·
// «اكتب 0» على «غير موزع» عليه طرود → 42 · السطور المش مربوطة مش في المودال → 42 · وقوع الكومة صامت → 43
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
  // نفس شكل السيرفر: ok دايماً معاه pile (فاضي لو مفيش كومة) — الواجهة بتعتبر الرد الناقص وقوع
  if(name === 'wh_count_pile'){ var oc = (window.__WH_COUNTS || []).filter(function(c){ return !c.applied_at && !c.cancelled_at; })[0];
    return { data:{ ok:true, count_id: oc ? oc.id : null, opts:{}, pile:[], pile_orders:0, moved_orders:0, ret_orders:0, moved_need:0, ret_need:0 }, error:null }; }
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

async function modalKeys(patch, seq, gap){
  const p = await open({ patch });
  await scanKeys(p, CODE, {}); await p.waitForTimeout(250);
  await p.click('#wh-result [data-wh-act="undo"]');
  await p.waitForSelector('#cmodal-backdrop', { state: 'visible' });
  const m = await p.evaluate(async ({ seq, gap }) => {
    const mi = document.getElementById('cmodal-input'); mi.focus(); mi.value = 'سبب '; mi.setSelectionRange(4, 4);
    // 🔴 الحارس بيقيس السرعة من e.timeStamp — الحدث المصطنع بياخد وقت إنشاءه، و setTimeout(36) تحت حمل الجهاز بيطلع 50+
    // (الفحص وقع مرة كده والكود ماتغيّرش). الوقت بيتثبّت على الفجوة المقصودة بالظبط زي السكانر الحقيقي (وقت الجهاز)
    let ts = performance.now();
    for(const k of seq){
      const ev = new KeyboardEvent('keydown', { code: /\d/.test(k.ch) ? 'Digit' + k.ch : 'Key' + k.ch, key: k.ch, repeat: !!k.rep, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'timeStamp', { value: ts });
      mi.dispatchEvent(ev); if(!ev.defaultPrevented) mi.setRangeText(k.ch, mi.selectionStart, mi.selectionEnd, 'end');
      const g = k.gap != null ? k.gap : gap;
      ts += g;
      if(g) await new Promise(r => setTimeout(r, g));
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
// سكانر أبطأ شوية (~38ms بين الزراير — فوق حد looksScanned مع التهنيجة) وفيه «تهنيجة» واحدة 150ms — الصفحة نفسها بتقبله، فالمودال لازم يقبله
const SLOW = 'JEG000700000088'.split('').map((ch, i) => ({ ch, gap: i === 6 ? 150 : 36 }));
const mh = await modalKeys(null, HELD, 0);
const mm = await modalKeys(null, MANUAL, 60);
const mslow = await modalKeys(null, SLOW, 0);
ok(mh.scans.length === 0 && mh.und.length === 1 && /1{12}/.test(mh.und[0] || '') && mm.scans.length === 0 && mm.und.length === 1 && /JEG000700000077/.test(mm.und[0] || '')
   && mslow.scans.indexOf('JEG000700000088') >= 0 && mslow.und.length === 0 && mslow.open,
  '38) المودال: زرار متداس = مش سكان والسبب اتبعت · كود مكتوب بالإيد = سبب مش سكان · سكانر أبطأ بتهنيجة = سكان والمودال مفتوح (' + JSON.stringify({ mh, mm, mslow }) + ')');

{
  const r = await modalKeys({ code: s => s.replace("      if(e.repeat){ if(!/^(Shift|Caps|Control|Alt|Meta)/.test(String(e.key || ''))) dirty = true; return; }\n", ''),
                              wh: s => s.replace(" && !/^(.)\\1+$/.test(bTail)){", "){") }, HELD, 0);
  ok(!(r.scans.length === 0 && r.und.length === 1), 'معايرة (ثث) الزرار المتداس بيتحسب ضربة سكانر → 38 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await modalKeys({ wh: s => s.replace(" && wt.n >= 15 && wt.avg <= 50 && wt.max <= 300;", ";") }, MANUAL, 60);
  ok(!(r.scans.length === 0 && r.und.length === 1), 'معايرة (جج) كود J&T مكتوب بالإيد بيتحسب سكان → 38 وقع (' + JSON.stringify(r) + ')');
}
{
  const r = await modalKeys({ wh: s => s.replace(" && wt.n >= 15 && wt.avg <= 50 && wt.max <= 300;", " && looksScanned(wt);") }, SLOW, 0);
  ok(!(r.scans.indexOf('JEG000700000088') >= 0 && r.und.length === 0), 'معايرة (رر) حد السرعة الضيق على كود J&T في المودال → السكانر الأبطأ بيضيع → 38 وقع (' + JSON.stringify(r) + ')');
}

await b.close();
console.log(bad?'BAD '+bad:'OK', JSON.stringify(mslow));
