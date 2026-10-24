// v79 — بيانات صفحة الأوردرات بتتجاب بس وهي ظاهرة + poll المحادثات بيقف والتاب في الخلفية.
//
// الخلفية (مراجعة التنضيف 16 أكتوبر): تاب المحادثات وتاب السكانر بيفضلوا مفتوحين طول اليوم،
// و`loadAll` + كل رشقة ريل-تايم على orders كانوا بيجيبوا الكروت (sahl_orders_stats ×2) والدمج
// والبضاعة والجدول في **كل** تاب — حتى اللي مش عارضة الأوردرات. والـpoll بتاع المحادثات كان
// بيجيب 200 محادثة كل 20 ثانية والتاب في الخلفية.
//
//  1) /orders: الكروت اتطلبت (الحالي + المقارنة = نداءين) والجدول اتجاب
//  2) /chats: صفر sahl_orders_stats وصفر جلب لجدول الأوردرات عند الدخول
//  3) /chats + حدث ريل-تايم على orders = برضه صفر (بس اتعلّمت «قديمة»)
//  4) التحويل للأوردرات = الكروت والجدول اتجابوا
//  5) /orders والتاب في الخلفية + حدث ريل-تايم = صفر · رجوع التاب = اتجابوا
//  6) poll المحادثات والتاب في الخلفية = صفر جلب · رجوع التاب = جلب واحد بس
//  7) لينك /mycommission مباشر (أو F5) = الصفحة مرسومة مش «—» — applyInitialRoute بقت قبل loadAll، ونداء
//     العمولة اللي في loadAll بيبقى الأحدث (cmGen) فلازم يرسم الصفحة كمان (مراجعة v79)
//
// المعايرات (كل واحدة لازم تقع على الكود السليم وتعدّي على المحقون):
//  (أ) ordersShown دايماً true → فحص 2 بيقع
//  (ب) شيل refreshOrdersIfStale من showPage → فحص 4 بيقع
//  (ج) شيل حارس document.hidden من الـpoll → فحص 6 بيقع
//  (د) loadAll ترجع لـloadCommissions(renderMyCommissionBar) → فحص 7 بيقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8901';
const SRC = {
  orders: fs.readFileSync(new URL('../app/js/orders/orders.js', import.meta.url), 'utf8'),
  main:   fs.readFileSync(new URL('../app/js/main.js', import.meta.url), 'utf8'),
  inbox:  fs.readFileSync(new URL('../app/js/inbox/inbox.js', import.meta.url), 'utf8'),
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

// المعايرة: بنعترض الموديول ونحقن فيه — والمرساة المفقودة = فشل بصوت عالي (درس 47)
function patched(name, from, to){
  const out = SRC[name].replace(from, to);
  if (out === SRC[name]) throw new Error('المعايرة مالقتش المرساة: ' + name);
  return out;
}

async function open(path, patch, pre){
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (pre) await ctx.addInitScript(pre);
  // الإنبوكس محتاج يعدّي البوابة عشان الـpoll يشتغل
  const now = new Date().toISOString();
  const CONVOS = [{ id: 'c1', tenant_id: 't1', wa_id: '201011111111', customer_name: 'عميل', last_message_at: now,
    last_inbound_at: now, last_direction: 'in', last_message_text: 'أهلاً', unread_count: 0, labels: [] }];
  await ctx.addInitScript(`window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__RPC_HOOK = function(name){ if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null }; return null; };`);
  await ctx.addInitScript(STUB);
  if (patch) {
    for (const [name, body] of Object.entries(patch)) {
      const glob = name === 'orders' ? '**/js/orders/orders.js' : name === 'main' ? '**/js/main.js' : '**/js/inbox/inbox.js';
      await ctx.route(glob, r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body }));
    }
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  await p.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await p.waitForTimeout(900);
  p.__errs = errs;
  return p;
}

// العدّادات من سجل الستب: الكروت = sahl_orders_stats · الجدول = select على orders فيه range (الصفحة)
const count = p => p.evaluate(() => {
  const c = window.__calls || [];
  return {
    stats: c.filter(x => x.rpc === 'sahl_orders_stats').length,
    page:  c.filter(x => x.table === 'orders' && x.from !== undefined).length,
    convos: c.filter(x => x.table === 'wa_conversations' && x.limit === 200 && x.order === 'last_message_at').length,   // جلب القايمة (مش البادج ولا الفلاتر)
  };
});

const fireOrderUpdate = p => p.evaluate(async () => {
  const m = await import('/js/orders/orders.js');
  const base = (window.__ORDERS || [])[0] || { id: 'o1' };
  m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base, { status: 'Delivered' }), old: { id: base.id } });
  await new Promise(r => setTimeout(r, 1300));   // نافذة التجميع 800ms
});

const setHidden = (p, hidden) => p.evaluate(h => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

// ════ 1) /orders ════
{
  const p = await open('/orders');
  const n = await count(p);
  ok(n.stats === 2, `1) /orders: الكروت اتطلبت (sahl_orders_stats ${n.stats} = 2)`);
  ok(n.page >= 1, `1) والجدول اتجاب (${n.page})`);
  ok(!p.__errs.length, '1) مفيش pageerror ' + p.__errs.join(' | '));
  await p.context().close();
}

// ════ 2–4) /chats ════
{
  const p = await open('/chats');
  const n0 = await count(p);
  ok(n0.stats === 0 && n0.page === 0, `2) /chats: صفر كروت وصفر جدول عند الدخول (stats ${n0.stats} · page ${n0.page})`);
  await fireOrderUpdate(p);
  const n1 = await count(p);
  ok(n1.stats === 0 && n1.page === 0, `3) حدث ريل-تايم على orders والأوردرات مش ظاهرة = برضه صفر (stats ${n1.stats} · page ${n1.page})`);
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.showPage('orders'); });
  await p.waitForTimeout(900);
  const n2 = await count(p);
  ok(n2.stats >= 1 && n2.page >= 1, `4) التحويل للأوردرات = الكروت والجدول اتجابوا (stats ${n2.stats} · page ${n2.page})`);
  ok(!p.__errs.length, '2–4) مفيش pageerror ' + p.__errs.join(' | '));
  await p.context().close();
}

// ════ 5) /orders والتاب في الخلفية ════
{
  const p = await open('/orders');
  const n0 = await count(p);
  await setHidden(p, true);
  await fireOrderUpdate(p);
  const n1 = await count(p);
  ok(n1.stats === n0.stats && n1.page === n0.page, `5) التاب في الخلفية + حدث ريل-تايم = مفيش جلب (stats ${n0.stats}→${n1.stats})`);
  await setHidden(p, false);
  await p.waitForTimeout(900);
  const n2 = await count(p);
  ok(n2.stats > n1.stats && n2.page > n1.page, `5) رجوع التاب = الكروت والجدول اتجابوا (stats ${n1.stats}→${n2.stats} · page ${n1.page}→${n2.page})`);
  await p.context().close();
}

// ════ 6) poll المحادثات والتاب في الخلفية (الـpoll كل 20 ثانية) ════
async function pollCheck(patch){
  const p = await open('/chats', patch);
  await setHidden(p, true);
  const n0 = await count(p);
  await p.waitForTimeout(21500);
  const n1 = await count(p);
  await setHidden(p, false);
  await p.waitForTimeout(700);
  const n2 = await count(p);
  await setHidden(p, false);            // رجوع تاني من غير poll فايت = مفيش جلب زيادة
  await p.waitForTimeout(500);
  const n3 = await count(p);
  await p.context().close();
  return { hiddenFetches: n1.convos - n0.convos, resume: n2.convos - n1.convos, again: n3.convos - n2.convos };
}
{
  const r = await pollCheck();
  ok(r.hiddenFetches === 0, `6) التاب في الخلفية 21ث = صفر جلب محادثات (${r.hiddenFetches})`);
  ok(r.resume === 1, `6) رجوع التاب = جلب واحد بس (${r.resume})`);
  ok(r.again === 0, `6) رجوع تاني من غير poll فايت = مفيش جلب (${r.again})`);
}

// ════ 7) لينك /mycommission مباشر — الموظف اللي عمولته مفعّلة ════
const CM_PRE = `window.__CM_ON = true; window.__ROLE = 'employee';
  window.__CM_BAL = [{ user_id:'u1', user_name:'موظف', events_count:1, pending_total:30, earned_total:90, void_total:0,
    settled_total:100, settlements_count:1, outstanding:-10 }];`;
async function mycm(patch){
  const p = await open('/mycommission', patch, CM_PRE);
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => ({
    shown: getComputedStyle(document.getElementById('page-mycommission')).display !== 'none',
    out: (document.getElementById('my-cm-out') || {}).textContent || '',
    pend: (document.getElementById('my-cm-pending') || {}).textContent || '' }));
  r.errs = p.__errs.slice();
  await p.context().close();
  return r;
}
{
  const r = await mycm();
  ok(r.shown && /10/.test(r.out) && /30/.test(r.pend), `7) /mycommission مباشر = الصفحة مرسومة (رصيد «${r.out}» · معلّق «${r.pend}»)`);
  ok(!r.errs.length, '7) مفيش pageerror ' + r.errs.join(' | '));
}

// ════ المعايرات ════
{
  const p = await open('/chats', { orders: patched('orders',
    "function ordersShown(){ var p=$id('page-orders'); return !!(p && p.style.display!=='none' && !document.hidden); }",
    "function ordersShown(){ return true; }") });
  const n = await count(p);
  ok(n.stats > 0, `معايرة (أ): ordersShown دايماً true → /chats جابت الكروت (${n.stats}) — فحص 2 بيمسكها`);
  await p.context().close();
}
{
  const p = await open('/chats', { main: patched('main',
    "  if(page==='orders'){refreshSetupChecklist(); refreshOrdersIfStale();}",
    "  if(page==='orders'){refreshSetupChecklist();}") });
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.showPage('orders'); });
  await p.waitForTimeout(900);
  const n = await count(p);
  ok(n.stats === 0, `معايرة (ب): من غير refreshOrdersIfStale التحويل للأوردرات ماجابش حاجة (${n.stats}) — فحص 4 بيمسكها`);
  await p.context().close();
}
{
  const r = await pollCheck({ inbox: patched('inbox',
    "    if(document.hidden){ waPollMissed=true; return; }   // التاب في الخلفية — بنجيب لما ترجع (v79)\n", "") });
  ok(r.hiddenFetches > 0, `معايرة (ج): من غير الحارس الـpoll جاب والتاب في الخلفية (${r.hiddenFetches}) — فحص 6 بيمسكها`);
}

{
  let body = patched('orders',
    "import { loadMyCommission, myCommissionEnabled, refreshMyCommissionNav } from '../finance/commissions.js';",
    "import { loadCommissions, myCommissionEnabled, refreshMyCommissionNav, renderMyCommissionBar } from '../finance/commissions.js';");
  const before = body;
  body = body.replace("refreshMyCommissionNav(); loadMyCommission(); }", "refreshMyCommissionNav(); loadCommissions(renderMyCommissionBar); }");
  if (body === before) throw new Error('المعايرة مالقتش المرساة: loadMyCommission في loadAll');
  const r = await mycm({ orders: body });
  ok(!/10/.test(r.out), `معايرة (د): loadAll بترسم الشريط بس → /mycommission مباشر فاضلة «${r.out}» — فحص 7 بيمسكها`);
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
