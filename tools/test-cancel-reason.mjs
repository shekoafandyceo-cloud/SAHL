// سبب الإلغاء بالأزرار + «📞 اتصلت ومردش» + تقرير الإلغاء (v90 — 28 نوفمبر 2026، طلب المالك)
//
// «قايمة أسباب ثابتة في Sahl بدل الكتابة الحرة» · «مش عاوز الـUX بتاعت الموظف تكون صعبة» · «نمشي بالعلامة بدل القفل».
//
// 🔴 الخطر اللي الهارنس ده موجود عشانه:
//    - الـlabel اللي بيتبعت للسيرفر لازم يطابق `app.cancel_reason_code` بالحرف — حرف واحد مختلف = الإلغاء
//      بيتصنّف «كتابة حرة» في صمت والتقرير يبقى غلط من غير أي خطأ.
//    - مفيش قفل: أي حاجة بتمنع الموظف يلغي (حتى بالغلط) = عكس قرار المالك.
//
// اللي بيتفحص:
//   1) القايمة في الواجهة = القايمة في الـmigration (كود ↔ label) بالحرف، وكل label مش بادئة لـlabel تاني
//   2) «✕ إلغاء» بيفتح النافذة بـ12 زرار · «إلغاء الطلب» من غير سبب = مفيش نداء والنافذة مفتوحة
//   3) سبب + تأكيد = `set_order_status` بـ`p_cancel_reason` = الـlabel بالحرف
//   4) سبب + ملاحظة = «label — ملاحظة»
//   5) «سبب تاني» من غير ملاحظة = مفيش نداء · بملاحظة = «سبب تاني — …»
//   6) ضغطتين على «إلغاء الطلب» = نداء واحد
//   7) «رجوع» و Esc = مفيش نداء
//   8) الإلغاء من قايمة الحالات (#dsel + «تحديث الحالة») بيفتح نفس النافذة
//   9) «📞 اتصلت ومردش»: `append_call_attempt` بـno_answer و`iso` · ضغطتين = محاولة واحدة · العدّاد بيزيد ·
//      مابيظهرش على أوردر اتشحن
//  10) سطر التنبيه (موظف): «مش بيرد» بمحاولة واحدة = تنبيه · 3 محاولات على يومين = مفيش · «السعر» على أوردر جديد
//      مااتأكدش ومن غير مكالمات = تنبيه · «مكرر» = مفيش · الأدمن = مفيش · 🔴 والتنبيه مابيمنعش الإلغاء
//  11) التقرير: التاب للأدمن · نداء واحد عند الفتح · الرجوع للتاب = من الكاش · ↻ = نداء تاني · فلتر المنتج ·
//      «إلغاء مبكر» · السيرفر من غير الدالة = رسالة واضحة · اسم منتج فيه HTML = متهرّب
//  معايرات:
//      (أ) label اتغيّر فيه حرف                 → فحص 1 يقع
//      (ب) شيل شرط الملاحظة لـ«سبب تاني»        → فحص 5 يقع
//      (ج) شيل قفل «اتصلت ومردش»                → فحص 9 (ضغطتين) يقع
//      (د) التنبيه بيتجاهل عدد المحاولات          → فحص 10 (3 على يومين) يقع
//      (هـ) كاش التقرير = صفر                    → فحص 11 (من الكاش) يقع
import { chromium } from 'playwright';
import fs from 'fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const JS_CR = fs.readFileSync(new URL('../app/js/orders/cancel-reason.js', import.meta.url), 'utf8');
const JS_MUT = fs.readFileSync(new URL('../app/js/orders/mutations.js', import.meta.url), 'utf8');
const JS_CX = fs.readFileSync(new URL('../app/js/analytics/cancels.js', import.meta.url), 'utf8');
const MIG_DIR = new URL('../supabase/migrations/', import.meta.url);
const MIG = fs.readFileSync(new URL(fs.readdirSync(MIG_DIR).filter(f => /_cancel_report\.sql$/.test(f)).sort().pop(), MIG_DIR), 'utf8');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

// ── 1) القايمة هنا = القايمة في الـmigration ─────────────────────────────────
function listsMatch(js, sql) {
  const fe = [...js.matchAll(/\{ code: '([a-z_]+)',\s+ic: '[^']*', label: '([^']+)'/g)].map(m => ({ code: m[1], label: m[2] }));
  const be = [...sql.matchAll(/when btrim\(p\) like '([^']+)%' then '([a-z_]+)'/g)].map(m => ({ label: m[1], code: m[2] }));
  if (fe.length !== 12 || be.length !== 12) return 'العدد: الواجهة ' + fe.length + ' · السيرفر ' + be.length;
  for (const f of fe) {
    const b = be.find(x => x.code === f.code);
    if (!b) return 'كود مش في السيرفر: ' + f.code;
    if (b.label !== f.label) return 'label مختلف لـ' + f.code + ': «' + f.label + '» ≠ «' + b.label + '»';
  }
  // بادئة: «like 'X%'» — لو label بادئة لتاني، الترتيب في الـCASE هو اللي بيحكم = تصنيف غلط في صمت
  for (const a of fe) for (const b of fe) if (a !== b && b.label.startsWith(a.label)) return '«' + a.label + '» بادئة لـ«' + b.label + '»';
  return '';
}
console.log('── 1) القايمة = الـmigration');
{
  const r = listsMatch(JS_CR, MIG);
  ok(r === '', '1) الـ12 سبب في الواجهة = `app.cancel_reason_code` بالحرف' + (r ? ' — ' + r : ''));
  ok(listsMatch(JS_CR.replace("label: 'أوردر مكرر'", "label: 'اوردر مكرر'"), MIG) !== '', '(أ) معايرة: label اتغيّر فيه حرف → فحص 1 بيقع');
}

// ── تشغيل الصفحة ────────────────────────────────────────────────────────────
// الأوردر o3 (pending): بنظبط محاولاته وسجله ووقته من الاختبار. `__RPC_HOOK` بيحاكي السيرفر للنداءين.
async function boot(opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1366, height: 860 } });
  page.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  if (opts.role) await page.addInitScript((r) => { window.__ROLE = r; }, opts.role);
  await page.addInitScript(STUB);
  await page.addInitScript((o) => {
    const ord = (window.__ORDERS || []).find(x => x.id === 'o3');
    if (ord) {
      ord.status_log = o.confirmed ? [{ at: new Date(Date.now() - 3600e3).toISOString(), to: 'confirmed', by: 'واتساب' }] : [];
      ord.created_at = new Date(Date.now() - (o.ageH == null ? 2 : o.ageH) * 3600e3).toISOString();
      ord.call_attempts = (o.calls || []).map(h => ({ iso: new Date(Date.now() - h * 3600e3).toISOString(), result: 'no_answer', note: '', by: 'x', time: '' }));
    }
    window.__RPC_HOOK = function (name, args) {
      const row = (window.__ORDERS || []).find(x => x.id === (args && args.p_order_id));
      if (name === 'set_order_status' && row) {
        row.status_log = (row.status_log || []).concat([{ from: row.status, to: args.p_status, by: args.p_by, reason: args.p_cancel_reason }]);
        row.status = args.p_status; if (args.p_cancel_reason) row.cancel_reason = args.p_cancel_reason;
        return { data: row.status_log, error: null };
      }
      if (name === 'append_call_attempt' && row) {
        row.call_attempts = (row.call_attempts || []).concat([args.p_attempt]);
        return { data: row.call_attempts.slice(), error: null };
      }
      return null;
    };
    if (o.report !== undefined) window.__CANCEL_REPORT = o.report;
    if (o.reportMissing) window.__CANCEL_REPORT_MISSING = true;
  }, { confirmed: !!opts.confirmed, ageH: opts.ageH, calls: opts.calls, report: opts.report, reportMissing: !!opts.reportMissing });
  for (const [pat, fn] of (opts.routes || [])) await page.route(pat, fn);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#page-orders', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('#tbody tr[data-id]', { timeout: 10000 });
  return page;
}
const openOrder = async (page, id) => {
  await page.click('#tbody tr[data-id="' + (id || 'o3') + '"]');
  await page.waitForSelector('#ovl.open', { state: 'visible' });
  await page.waitForTimeout(150);
};
const rpcs = (page, name) => page.evaluate((n) => (window.__calls || []).filter(c => c.rpc === n).map(c => c.args), name);
const modalOpen = (page) => page.evaluate(() => !!(document.getElementById('cr-bd') && document.getElementById('cr-bd').classList.contains('open')));
const openCancel = async (page) => { await page.click('#da-cn'); await page.waitForSelector('#cr-bd.open', { state: 'visible' }); };
const swap = (src, from, to) => async (route) => {
  if (!src.includes(from)) { console.log('  ✗ مرساة المعايرة مش موجودة:', from); bad++; }
  await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: src.split(from).join(to) });
};

// ── 2–8) النافذة ─────────────────────────────────────────────────────────────
console.log('── 2–8) نافذة سبب الإلغاء');
{
  let p = await boot();
  await openOrder(p);
  await openCancel(p);
  ok(await p.locator('#cr-grid .cr-opt').count() === 12, '2أ) النافذة فيها 12 زرار سبب');
  ok(await p.locator('#cr-ok.off').count() === 1, '2ب) «إلغاء الطلب» باهت قبل اختيار السبب');
  await p.click('#cr-ok');
  await p.waitForTimeout(250);
  ok((await rpcs(p, 'set_order_status')).length === 0 && await modalOpen(p), '2ج) من غير سبب = مفيش نداء والنافذة لسه مفتوحة');
  const noKb = await p.evaluate(() => document.activeElement && document.activeElement.id);
  await p.click('.cr-opt[data-code="size"]');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.id) !== 'cr-note' && noKb !== 'cr-note', '2د) اختيار سبب عادي مابيفتحش خانة الكتابة (الكيبورد على الموبايل)');
  await p.click('#cr-ok');
  await p.waitForTimeout(300);
  let c = await rpcs(p, 'set_order_status');
  ok(c.length === 1 && c[0].p_status === 'cancelled' && c[0].p_cancel_reason === 'المقاس مش مناسب', '3) سبب + تأكيد = `p_cancel_reason` «المقاس مش مناسب» بالحرف' + (c[0] ? '' : ' — مفيش نداء'));
  ok(!(await modalOpen(p)), '3ب) النافذة اتقفلت بعد التأكيد');
  await p.close();

  p = await boot();
  await openOrder(p); await openCancel(p);
  await p.click('.cr-opt[data-code="price"]');
  await p.fill('#cr-note', '  عايز   1200  ');
  await p.dblclick('#cr-ok');
  await p.waitForTimeout(350);
  c = await rpcs(p, 'set_order_status');
  ok(c.length === 1 && c[0].p_cancel_reason === 'السعر غالي أو عايز خصم — عايز 1200', '4) سبب + ملاحظة = «label — ملاحظة» (المسافات متنضّفة): ' + (c[0] && c[0].p_cancel_reason));
  ok(c.length === 1, '6) ضغطتين على «إلغاء الطلب» = نداء واحد (' + c.length + ')');
  await p.close();

  p = await boot();
  await openOrder(p); await openCancel(p);
  await p.click('.cr-opt[data-code="other"]');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'cr-note', '5أ) «سبب تاني» بيحط المؤشر في خانة الكتابة');
  await p.click('#cr-ok');
  await p.waitForTimeout(250);
  ok((await rpcs(p, 'set_order_status')).length === 0 && await modalOpen(p) && await p.locator('#cr-note.bad').count() === 1, '5ب) «سبب تاني» من غير ملاحظة = مفيش نداء والخانة حمرا');
  await p.fill('#cr-note', 'مسافر شهر');
  await p.press('#cr-note', 'Enter');
  await p.waitForTimeout(300);
  c = await rpcs(p, 'set_order_status');
  ok(c.length === 1 && c[0].p_cancel_reason === 'سبب تاني — مسافر شهر', '5ج) بملاحظة (و Enter) = «سبب تاني — مسافر شهر»');
  await p.close();

  p = await boot();
  await openOrder(p); await openCancel(p);
  await p.click('.cr-opt[data-code="fake"]');
  await p.click('#cr-x');
  await p.waitForTimeout(200);
  const closed1 = !(await modalOpen(p));
  await openCancel(p);
  ok(await p.locator('#cr-grid .cr-opt.on').count() === 0 && await p.locator('#cr-ok.off').count() === 1, '7ب) النافذة بتفتح نضيفة بعد «رجوع» (مفيش سبب متعلّم من المرة اللي فاتت)');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  ok(closed1 && !(await modalOpen(p)) && (await rpcs(p, 'set_order_status')).length === 0, '7) «رجوع» و Esc = النافذة بتتقفل ومفيش نداء');
  ok(await p.evaluate(() => document.getElementById('ovl').classList.contains('open')), '7ج) Esc قفل نافذة السبب بس — تفاصيل الأوردر لسه مفتوحة');
  // 8) من قايمة الحالات
  await p.selectOption('#dsel', 'cancelled');
  await p.click('#da-up');
  await p.waitForSelector('#cr-bd.open', { state: 'visible' });
  await p.click('.cr-opt[data-code="duplicate"]');
  await p.click('#cr-ok');
  await p.waitForTimeout(300);
  c = await rpcs(p, 'set_order_status');
  ok(c.length === 1 && c[0].p_cancel_reason === 'أوردر مكرر', '8) الإلغاء من قايمة الحالات = نفس النافذة ونفس النص');
  await p.close();

  // (ب) معايرة: شيل شرط الملاحظة
  p = await boot({ routes: [['**/js/orders/cancel-reason.js', swap(JS_CR, 'if (r.needNote && !val)', 'if (false)')]] });
  await openOrder(p); await openCancel(p);
  await p.click('.cr-opt[data-code="other"]');
  await p.click('#cr-ok');
  await p.waitForTimeout(300);
  ok((await rpcs(p, 'set_order_status')).length === 1, '(ب) معايرة: من غير شرط الملاحظة «سبب تاني» بيتسجّل فاضي → فحص 5ب بيقع');
  await p.close();
}

// ── 9) «📞 اتصلت ومردش» ──────────────────────────────────────────────────────
console.log('── 9) «اتصلت ومردش»');
{
  let p = await boot({ calls: [] });
  await openOrder(p);
  ok(await p.locator('#da-na').count() === 1 && await p.locator('#da-na .na-cnt').count() === 0, '9أ) الزرار ظاهر على أوردر pending ومن غير عدّاد لما مفيش محاولات');
  await p.dblclick('#da-na');
  await p.waitForTimeout(500);
  let c = await rpcs(p, 'append_call_attempt');
  ok(c.length === 1, '9ب) ضغطتين ورا بعض = محاولة واحدة (' + c.length + ')');
  ok(c[0] && c[0].p_order_id === 'o3' && c[0].p_attempt.result === 'no_answer' && /^\d{4}-\d\d-\d\dT/.test(c[0].p_attempt.iso || ''), '9ج) المحاولة «لم يرد» بـiso وعلى الأوردر الصح');
  ok((await p.locator('#da-na .na-cnt').textContent().catch(() => '')).includes('1'), '9د) العدّاد على الزرار بقى 1 بعد التسجيل');
  await p.waitForTimeout(1300);                             // القفل 1.2ث من الضغطة
  await p.click('#da-na');
  await p.waitForTimeout(500);
  ok((await rpcs(p, 'append_call_attempt')).length === 2, '9هـ) ضغطة تانية بعد الرد = محاولة تانية (القفل بيتفك)');
  await p.evaluate(() => { document.querySelector('#ovl').classList.remove('open'); });
  await openOrder(p, 'o2');
  ok(await p.locator('#da-na').count() === 0, '9و) الزرار مابيظهرش على أوردر اتشحن');
  await p.close();

  // (ج) معايرة: شيل القفل
  p = await boot({ calls: [], routes: [['**/js/orders/mutations.js', swap(JS_MUT, 'if(naBusy)return;', '')]] });
  await openOrder(p);
  await p.evaluate(() => { const b = document.getElementById('da-na'); b.click(); b.click(); });
  await p.waitForTimeout(500);
  ok((await rpcs(p, 'append_call_attempt')).length === 2, '(ج) معايرة: من غير القفل ضغطتين = محاولتين → فحص 9ب بيقع');
  await p.close();
}

// ── 10) سطر التنبيه (مش قفل) ─────────────────────────────────────────────────
console.log('── 10) سطر التنبيه');
{
  const hintFor = async (p, code) => {
    await p.click('.cr-opt[data-code="' + code + '"]');
    return p.evaluate(() => { const h = document.getElementById('cr-hint'); return h.style.display === 'none' ? '' : h.textContent; });
  };
  let p = await boot({ role: 'employee', calls: [1], ageH: 2 });
  await openOrder(p); await openCancel(p);
  const h1 = await hintFor(p, 'no_answer');
  ok(/محاولة اتصال واحدة/.test(h1) && /مبكر/.test(h1), '10أ) موظف · «مش بيرد» بمحاولة واحدة = تنبيه بيقول المتسجّل وإنه هيتعلّم «مبكر»');
  ok(await hintFor(p, 'duplicate') === '', '10ب) «أوردر مكرر» = مفيش تنبيه');
  ok(await hintFor(p, 'price') === '', '10ج) «السعر» وفيه محاولة متسجّلة = مفيش تنبيه');
  await hintFor(p, 'no_answer');
  await p.click('#cr-ok');
  await p.waitForTimeout(300);
  let c = await rpcs(p, 'set_order_status');
  ok(c.length === 1 && c[0].p_cancel_reason === 'العميل مش بيرد أو التليفون مقفول', '10د) 🔴 التنبيه مابيمنعش: الإلغاء اتسجّل عادي');
  await p.close();

  p = await boot({ role: 'employee', calls: [30, 26, 1], ageH: 40 });
  await openOrder(p); await openCancel(p);
  ok(await hintFor(p, 'no_answer') === '', '10هـ) 3 محاولات على يومين = مفيش تنبيه');
  await p.close();

  p = await boot({ role: 'employee', calls: [3, 2, 1], ageH: 5 });
  await openOrder(p); await openCancel(p);
  ok(/في يوم واحد/.test(await hintFor(p, 'no_answer')), '10و) 3 محاولات في نفس اليوم = تنبيه «في يوم واحد»');
  await p.close();

  p = await boot({ role: 'employee', calls: [], ageH: 2, confirmed: false });
  await openOrder(p); await openCancel(p);
  ok(/مفيش محاولة اتصال متسجّلة/.test(await hintFor(p, 'price')), '10ز) «السعر» · أوردر جديد مااتأكدش · صفر مكالمات = تنبيه');
  ok(await hintFor(p, 'wrong_number') === '' && await hintFor(p, 'fake') === '', '10ح) «الرقم غلط» و«وهمي» = مفيش تنبيه');
  await p.close();

  p = await boot({ role: 'employee', calls: [], ageH: 2, confirmed: true });
  await openOrder(p); await openCancel(p);
  ok(await hintFor(p, 'price') === '', '10ط) أوردر اتأكد قبل كده = مفيش تنبيه «من غير تواصل»');
  await p.close();

  p = await boot({ role: 'employee', calls: [], ageH: 30, confirmed: false });
  await openOrder(p); await openCancel(p);
  ok(await hintFor(p, 'price') === '', '10ي) أوردر عدّى عليه يوم = مفيش تنبيه «من غير تواصل»');
  await p.close();

  p = await boot({ calls: [], ageH: 2 });                  // أدمن
  await openOrder(p); await openCancel(p);
  ok(await hintFor(p, 'no_answer') === '' && await hintFor(p, 'price') === '', '10ك) الأدمن = مفيش تنبيه (إلغاؤه مابيتعلّمش)');
  await p.close();

  // (د) معايرة: التنبيه بيتجاهل عدد المحاولات
  p = await boot({ role: 'employee', calls: [30, 26, 1], ageH: 40,
    routes: [['**/js/orders/cancel-reason.js', swap(JS_CR, 'if (st.calls >= CR_MIN_CALLS && st.days >= CR_MIN_DAYS) return null;', '')]] });
  await openOrder(p); await openCancel(p);
  ok(await hintFor(p, 'no_answer') !== '', '(د) معايرة: من غير شرط العدد التنبيه بيطلع على 3 محاولات → فحص 10هـ بيقع');
  await p.close();
}

// ── 11) التقرير ──────────────────────────────────────────────────────────────
console.log('── 11) تقرير الإلغاء');
{
  const W = [{ start: '2026-11-07', end: '2026-11-13' }, { start: '2026-11-14', end: '2026-11-20' }, { start: '2026-11-21', end: '2026-11-27' }, { start: '2026-11-28', end: '2026-12-04' }];
  const XSS = 'منتج <img src=x onerror="window.__xss=1">';
  const REPORT = { ok: true, since: '2026-11-28T15:00:00Z', weeks: W,
    rows: [
      { w: W[0].start, product: 'منتج أ', code: 'free_text', n: 20, early: 0 },
      { w: W[2].start, product: 'منتج أ', code: 'no_answer', n: 6, early: 2 },
      { w: W[3].start, product: 'منتج أ', code: 'size', n: 3, early: 0 },
      { w: W[3].start, product: 'منتج ب', code: 'price', n: 4, early: 1 },
      { w: W[3].start, product: XSS, code: 'wa_customer', n: 1, early: 0 }
    ],
    by: [{ by: 'ebrahim', n: 30, early: 3 }, { by: 'العميل (زرار الواتساب)', n: 1, early: 0 }],
    early: [
      { id: 'e1', uid: '20411', product: 'منتج أ', code: 'no_answer', reason: 'العميل مش بيرد أو التليفون مقفول', by: 'ebrahim', at: '2026-11-25T10:00:00Z', calls: 1, days: 1, flag: 'few_calls' },
      { id: 'e2', uid: '20398', product: 'منتج ب', code: 'price', reason: 'السعر غالي أو عايز خصم', by: 'ebrahim', at: '2026-11-28T10:00:00Z', calls: 0, days: 0, flag: 'no_contact' }
    ],
    notes: [{ uid: '20001', w: W[0].start, product: 'منتج أ', code: 'free_text', text: 'نص <b>حر</b>', by: 'ebrahim', at: '2026-11-08T10:00:00Z' }] };
  const openTab = async (p) => {
    await p.click('#nav-analytics');
    await p.waitForSelector('#page-analytics', { state: 'visible' });
    await p.waitForSelector('.stock-tab[data-atab="cancels"]', { timeout: 5000 });
    await p.click('.stock-tab[data-atab="cancels"]');
    await p.waitForTimeout(500);
  };
  let p = await boot({ report: REPORT });
  ok((await rpcs(p, 'cancel_report')).length === 0, '11أ) صفحة الأوردرات = صفر نداء للتقرير (Egress)');
  await openTab(p);
  ok((await rpcs(p, 'cancel_report')).length === 1, '11ب) فتح التاب = نداء واحد');
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('analytics-cancels-tab')).display !== 'none' && getComputedStyle(document.getElementById('analytics-products-tab')).display === 'none'), '11ج) التاب ظاهر وتاب المنتجات مخفي');
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('analytics-period-bar')).display === 'none'), '11د) شريط المدة مخفي في التاب (ليه 4 أسابيع ثابتة)');
  const chips = await p.$$eval('.cxr-chip b', els => els.map(e => e.textContent.trim()));
  ok(chips[0] === '34' && chips[1] === '3' && chips[2] === '20', '11هـ) الإجمالي 34 · مبكر 3 · كتابة حرة 20 — ' + chips.join(' / '));
  const firstRow = await p.$eval('.cxr-tbl tbody tr', tr => tr.textContent);
  ok(/كتابة حرة/.test(firstRow) && /20/.test(firstRow), '11و) الصفوف مترتبة بالأكتر (كتابة حرة 20 الأول)');
  ok(await p.locator('.cxr-item').count() >= 2 && /20411/.test(await p.locator('.cxr-list').first().textContent()), '11ز) قايمة «إلغاء مبكر» فيها الأوردرات بأرقامها');
  ok(await p.evaluate(() => !window.__xss && !document.querySelector('#cxr img') && !document.querySelector('#cxr-product img')), '11ح) اسم منتج فيه HTML اتعرض نص (مفيش عنصر اتحقن)');
  ok(await p.evaluate(() => !document.querySelector('#cxr .cxr-notes b:not(bdi b)') || !/<b>/.test(document.querySelector('#cxr .cxr-notes').innerHTML.replace(/<bdi><b>#[^<]*<\/b><\/bdi>/g, ''))), '11ط) نص السبب المكتوب بالإيد متهرّب');
  await p.selectOption('#cxr-product', 'منتج ب');
  await p.waitForTimeout(200);
  const chips2 = await p.$$eval('.cxr-chip b', els => els.map(e => e.textContent.trim()));
  ok(chips2[0] === '4' && chips2[1] === '1' && await p.locator('.cxr-list').first().locator('.cxr-item').count() === 1, '11ي) فلتر المنتج: الإجمالي 4 · مبكر 1 · والقايمة أوردر واحد');
  ok((await rpcs(p, 'cancel_report')).length === 1, '11ك) الفلتر من غير نداء جديد');
  await p.click('.stock-tab[data-atab="products"]');
  await p.waitForTimeout(200);
  await p.click('.stock-tab[data-atab="cancels"]');
  await p.waitForTimeout(400);
  ok((await rpcs(p, 'cancel_report')).length === 1, '11ل) الرجوع للتاب = من الكاش (لسه نداء واحد)');
  await p.click('#cxr-refresh');
  await p.waitForTimeout(400);
  ok((await rpcs(p, 'cancel_report')).length === 2, '11م) ↻ = نداء تاني');
  await p.close();

  p = await boot({ reportMissing: true });
  await openTab(p);
  ok(/مش متفعّل على السيرفر/.test(await p.locator('#cxr').textContent()), '11ن) السيرفر من غير الدالة = رسالة واضحة مش صفحة فاضية');
  await p.close();

  p = await boot({ role: 'employee', report: REPORT });
  ok((await rpcs(p, 'cancel_report')).length === 0, '11ع) الموظف = صفر نداء للتقرير');
  await p.close();

  // (هـ) معايرة: الكاش صفر
  p = await boot({ report: REPORT, routes: [['**/js/analytics/cancels.js', swap(JS_CX, 'var CX_TTL_MS = 5 * 60 * 1000;', 'var CX_TTL_MS = 0;')]] });
  await openTab(p);
  await p.click('.stock-tab[data-atab="products"]');
  await p.waitForTimeout(200);
  await p.click('.stock-tab[data-atab="cancels"]');
  await p.waitForTimeout(400);
  ok((await rpcs(p, 'cancel_report')).length === 2, '(هـ) معايرة: من غير كاش الرجوع للتاب = نداء تاني → فحص 11ل بيقع');
  await p.close();
}

// ── موبايل: النافذة جوّه الشاشة ──────────────────────────────────────────────
console.log('── موبايل');
{
  const p = await boot({ viewport: { width: 375, height: 667 } });
  await openOrder(p);
  await p.evaluate(() => document.getElementById('da-cn').scrollIntoView({ block: 'center' }));
  await openCancel(p);
  const g = await p.evaluate(() => {
    const b = document.querySelector('.cr-box').getBoundingClientRect(), k = document.getElementById('cr-ok').getBoundingClientRect();
    const sc = document.querySelector('.cr-box');
    return { top: b.top, bottom: b.bottom, okBottom: k.bottom, vh: innerHeight, vw: innerWidth, right: b.right, left: b.left, scrollable: sc.scrollHeight > sc.clientHeight + 1 };
  });
  ok(g.top >= 0 && g.left >= 0 && g.right <= g.vw, '12أ) 375×667: النافذة جوّه عرض الشاشة');
  ok(g.bottom <= g.vh && (g.okBottom <= g.vh || g.scrollable), '12ب) 375×667: «إلغاء الطلب» في الشاشة أو النافذة بتتسكرول ليه — ' + JSON.stringify(g));
  await p.close();
}

await browser.close();
console.log(bad ? '\n✗ ' + bad + ' فحص وقع' : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
