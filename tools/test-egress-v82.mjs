// v82 — تقليل الـEgress (17 أكتوبر — طلب المالك «الداتابيز تفضل مكملة معانا على الـFree Plan»).
//
// الخلفية (اتقاست من الحي): Egress الشهر 11.3 GB من 5 (227%) وأغلبه الواجهة نفسها — كل حدث ريل-تايم على orders
// (~1,460/يوم · رسوم J&T والتحصيل ونسبة الاستلام) كان بيجيب الكروت + الدمج (745 صف) + البضاعة + صفحة الجدول (200 صف)
// في **كل** تاب أوردرات مفتوحة · وكل رسالة واتساب = قايمة المحادثات كاملة (200 صف `*`) + الرسايل كاملة (500).
//
// اللي بيتفحص (الستب — من غير أي شبكة):
//  ── الأوردرات (تصنيف الحدث بدل الجلب الكامل) ──
//  1) ختم مزامنة (jt_fee_synced_at = updated_at) على أوردر مش في الصفحة = صفر جلب
//  2) ضابط: نفس الحدث من غير ختم = الكروت + الدمج + البضاعة بس (مفيش صفحة — مفيش فلتر)
//  3) أوردر في الصفحة اتغيّرت حالته ومفيش فلتر = الكروت بس + الشارة اتغيّرت من الحدث (مفيش جلب صفحة)
//  4) أوردر في الصفحة اتغيّر فيه عمود مالوش كارت (awb_print_count) = صفر جلب والصف اترسم (✓×2)
//  5) أوردر جديد (INSERT) = الكروت + الصفحة
//  6) فلتر الحالة شغّال وأوردر خرج منه = الصفحة اتجابت · ضابط: عمود تاني = مفيش صفحة
//  7) البحث شغّال والعنوان اتغيّر (عمود بحث مش عمود كارت) = الصفحة بس
//  8) شبكة الأمان: آخر تحديث للكروت أقدم من 5 دقايق = أي حدث (حتى الختم) بيجيبها
//  ── تنبيه الدمج (RPC بدل 745 صف) ──
//  9) التنبيه من merge_candidates_v1 (3 صيغ لنفس الرقم = عميل واحد · الرقم التاني برّه) ومفيش select الدمج القديم
// 10) الدالة مش موجودة على السيرفر (PGRST202 — قبل الـmigration) = رجوع للاستعلام القديم والتنبيه زي ما هو
//  ── المحادثات ──
// 11) الـpoll بيجيب اللي اتغيّر بس (gt updated_at) · الجديدة فوق والمتعدّلة بعدها والنص اتحدّث · العدد صح
// 12) آخر جلب كامل أقدم من 10 دقايق = كامل
// 13) الدلتا رجعت 200 = كامل (اتغيّر كتير)
// 14) رسالة وصلت والتاب في الخلفية = صفر جلب · رجوع التاب = جلب واحد
// 15) المحادثة المفتوحة: الرسالة الجديدة من غير جلب الـ500 (gte created_at · limit 100)
// 16) حدث UPDATE لحالة رسالة = اتطبّق من الحدث نفسه (صفر جلب)
//  ── شارة الاستثناءات ──
// 17) حدث jt_issues والتاب لسه ماتفتحتش = بوالص الحدث بس (in tracking_no) مش الـ30 يوم
//
// المعايرات (كل واحدة لازم توقّع فحص — والمرساة المفقودة = فشل · درس 56):
//  (أ) الختم مش متشاف → 1 يقع       (ب) التصنيف القديم (كله light+page) → 3 يقع
//  (ج) الصف مابيترسمش → 4 يقع       (د) فلتر البحث مش متشاف → 7 يقع
//  (هـ) شبكة الأمان اتشالت → 8 يقع   (و) الدمج بالاستعلام القديم → 9 يقع
//  (ز) مفيش رجوع للقديم → 10 يقع     (ح) المحادثات كامل دايماً → 11 يقع
//  (ط) الدمج مابيرتّبش → 11 يقع      (ي) مفيش كامل بعد 10 دقايق → 12 يقع
//  (ك) مفيش كامل بعد 200 → 13 يقع    (ل) التاب المخفية بتجيب → 14 يقع
//  (م) الرسايل كامل دايماً → 15 يقع  (ن) حالة الرسالة بجلب → 16 يقع
//  (س) الشارة بالجلب الكامل → 17 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const SRC = f => fs.readFileSync(new URL('../app/js/' + f, import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';
const TENANT = 't-test-1';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

// ── الفيكستشر ──────────────────────────────────────────────────────────
const NOW = Date.now();
const isoAgo = mins => new Date(NOW - mins * 60000).toISOString();
// تنبيه الدمج: 3 صيغ لنفس الرقم (محلي · +20 · أرقام هندية) + رقم تاني لوحده — كلهم «جاهز للشحن»
const MERGE_ORDERS = `
  (function(){
    var base = window.__ORDERS[0];
    function m(id, uid, phone){ return Object.assign({}, base, { id:id, order_uid:uid, status:'BOSTA AUTO', phone:phone,
      tracking_no:'JEG' + uid, customer_name:'سارة', city:'الجيزة', total_cost:500, created_at:new Date(Date.now() - 3600000).toISOString(),
      status_log:[] }); }
    window.__ORDERS.push(m('m1','8801','01012345678'), m('m2','8802','+201012345678'), m('m3','8803','٠١٠١٢٣٤٥٦٧٨'), m('m4','8804','01099999999'));
  })();`;

const conv = (i, mins, txt) => ({
  id: 'c' + i, tenant_id: TENANT, wa_id: '2010' + String(i).padStart(8, '0'), customer_phone: '010' + String(i).padStart(8, '0'),
  customer_name: 'عميل ' + i, last_message_at: isoAgo(mins), last_inbound_at: isoAgo(mins), updated_at: isoAgo(mins),
  last_message_text: txt || ('رسالة ' + i), last_direction: 'in', unread_count: 0, status: 'open', labels: [], note: null,
  ctwa_clid: null, ctwa_ad_id: null, ctwa_headline: null, ctwa_source_type: null, ctwa_ad_body: null, ctwa_source_url: null,
  ctwa_first_at: null, ctwa_last_at: null
});
const CONVOS = []; for(let i = 0; i < 30; i++) CONVOS.push(conv(i, i * 10 + 1));
const msg = (id, mins, dir, st) => ({ id, tenant_id: TENANT, conversation_id: 'c5', wa_message_id: 'wamid.' + id, direction: dir || 'in',
  type: 'text', body: 'نص ' + id, media_path: null, media_filename: null, wa_timestamp: isoAgo(mins), is_read: true,
  created_at: isoAgo(mins), status: st || null, sent_by_name: dir === 'out' ? 'أدمن' : null, reply_to_wa_id: null });
const MSGS = [msg('m1', 30), msg('m2', 20, 'out', 'sent'), msg('m3', 10)];

// ── الفتح ─────────────────────────────────────────────────────────────
async function open(path, o){
  o = o || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.__errs = [];
  p.on('pageerror', e => { p.__errs.push(e.message); console.log('  ⚠ pageerror:', e.message); });
  await p.addInitScript(STUB);
  await p.addInitScript(`window.__TENANT = { shipping_provider: 'jt' };
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)}; window.__WA_MSGS = ${JSON.stringify(MSGS)}; window.__JT_ISSUES = [];
    window.__RPC_HOOK = function(n){ if(n === 'wa_inbox_status') return { data:{ verified:true }, error:null }; return null; };
    ${o.merge ? MERGE_ORDERS : ''} ${o.pre || ''}`);
  for(const pt of (o.patches || [])){
    const src = SRC(pt.file), out = pt.fn(src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة: ' + pt.file);
    await p.route('**/js/' + pt.file, r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  if(path === '/chats') await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 10000 });
  else await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  return { ctx, p };
}

// عدّ النداءات من __calls — الفرق قبل/بعد الحدث هو الدليل
const MERGE_COLS = 'order_uid,tracking_no,customer_name,city,phone,total_cost,status';
const snap = p => p.evaluate(MC => { const c = window.__calls; return {
  stats: c.filter(x => x.rpc === 'sahl_orders_stats').length,
  merge: c.filter(x => x.rpc === 'merge_candidates_v1').length,
  mergeSel: c.filter(x => x.table === 'orders' && x.cols === MC).length,
  page: c.filter(x => x.table === 'orders' && x.from !== undefined).length,
  inv: c.filter(x => x.table === 'orders' && String(x.cols || '').indexOf('product_name,inventory_cost_snapshot') === 0).length,
  convFull: c.filter(x => x.table === 'wa_conversations' && x.order === 'last_message_at' && x.limit === 200).length,
  convDelta: c.filter(x => x.table === 'wa_conversations' && x.order === 'updated_at' && (x.f || []).some(f => f.op === 'gt' && f.col === 'updated_at')).length,
  msgFull: c.filter(x => x.table === 'wa_messages' && x.limit === 500).length,
  msgDelta: c.filter(x => x.table === 'wa_messages' && x.limit === 100 && (x.f || []).some(f => f.op === 'gte' && f.col === 'created_at')).length,
  jxFull: c.filter(x => x.table === 'v_jt_issues' && (x.f || []).some(f => f.op === 'gte' && f.col === 'event_at')).length,
  jxDelta: c.filter(x => x.table === 'v_jt_issues' && (x.f || []).some(f => f.op === 'in' && f.col === 'tracking_no')).length
}; }, MERGE_COLS);
const diff = (a, z) => { const d = {}; for(const k in a) d[k] = z[k] - a[k]; return d; };

// حدث ريل-تايم على orders — المعالج نفسه بالحمولة اللي Supabase بتبعتها (الصف كامل · old = المفتاح بس)
async function fireOrder(p, ev, id, patch){
  await p.evaluate(async a => {
    const m = await import('/js/orders/orders.js');
    // السيرفر اتكتب فعلاً (زي الحقيقي) — من غيره جلب الصفحة بعد الحدث بيرجّع النسخة القديمة
    let base = (window.__ORDERS || []).filter(x => x.id === a.id)[0];
    if(base) Object.assign(base, a.patch);
    else if(a.ev === 'INSERT'){ base = Object.assign({}, window.__ORDERS[0], { id: a.id }, a.patch); window.__ORDERS.push(base); }
    const row = Object.assign({}, base || {}, { id: a.id }, a.patch);
    m.handleRealtimeChange({ eventType: a.ev, new: row, old: { id: a.id } });
  }, { ev, id, patch: patch || {} });
  await p.waitForTimeout(1300);   // نافذة التجميع 800ms + الجلب
}
const badge = (p, id) => p.evaluate(i => { const tr = document.querySelector('#tbody tr[data-id="' + i + '"]'); const bd = tr && tr.querySelector('.badge'); return bd ? bd.textContent.trim() : null; }, id);
const rowHtml = (p, id) => p.evaluate(i => { const tr = document.querySelector('#tbody tr[data-id="' + i + '"]'); return tr ? tr.innerHTML : ''; }, id);
async function setFilter(p, sel, val){
  await p.evaluate(a => { const el = document.getElementById(a.sel); el.value = a.val; el.dispatchEvent(new Event(a.sel === 'qinp' ? 'input' : 'change', { bubbles: true })); }, { sel, val });
  await p.waitForTimeout(900);
}
const STAMP = () => new Date().toISOString();

// ── المسبارات (الفحص والمعايرة بيستخدموا نفس الدالة) ──────────────────
async function probeStampUnknown(o){
  const T = await open('/orders', o);
  const a = await snap(T.p); const t = STAMP();
  await fireOrder(T.p, 'UPDATE', 'zz1', { order_uid: '7777', status: 'Delivered', updated_at: t, jt_fee_synced_at: t, tracking_no: 'JEG7777' });
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
}
async function probeKnownStatus(o){
  const T = await open('/orders', o);
  const before = await badge(T.p, 'o2');
  const a = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'o2', { status: 'Delivered', updated_at: STAMP() });
  const d = diff(a, await snap(T.p)); const after = await badge(T.p, 'o2'); await T.ctx.close();
  return { d, before, after };
}
async function probeAwb(o){
  const T = await open('/orders', o);
  const h0 = await rowHtml(T.p, 'o2'); const a = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'o2', { awb_print_count: 2, updated_at: STAMP() });
  const d = diff(a, await snap(T.p)); const h1 = await rowHtml(T.p, 'o2'); await T.ctx.close();
  return { d, had: h0.indexOf('✓×2') >= 0, has: h1.indexOf('✓×2') >= 0 };
}
async function probeSearchAddr(o){
  const T = await open('/orders', o);
  await setFilter(T.p, 'qinp', 'عنوان');
  const a = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'o2', { address: 'عنوان تاني خالص', updated_at: STAMP() });
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
}
async function probeSafety(o){
  const T = await open('/orders', o);
  const t0 = await T.p.evaluate(() => Date.now());
  await T.ctx.clock.setFixedTime(new Date(t0 + 6 * 60000));
  const a = await snap(T.p); const t = new Date(t0 + 6 * 60000).toISOString();
  await fireOrder(T.p, 'UPDATE', 'zz2', { order_uid: '7778', status: 'Delivered', updated_at: t, jt_cod_synced_at: t });
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
}
const mergeView = p => p.evaluate(() => { const c = document.getElementById('merge-alert-container');
  return { shown: !!(c && c.style.display !== 'none' && c.innerHTML), count: (c && c.querySelector('.merge-alert-count') || {}).textContent || '',
    chips: Array.from(document.querySelectorAll('#merge-alert-container .merge-order-chip')).map(e => e.textContent.trim()) }; });
async function probeMerge(o){
  const T = await open('/orders', Object.assign({ merge: true }, o));
  await T.p.waitForTimeout(500);
  const v = await mergeView(T.p); const s = await snap(T.p); await T.ctx.close(); return { v, s };
}
// المحادثات: الدلتا فيها محادثة جديدة + محادثة قديمة اتحرّكت فوق
async function probeConvDelta(o){
  const T = await open('/chats', o);
  const ids0 = await T.p.evaluate(() => Array.from(document.querySelectorAll('#wa-list-body .wa-conv')).map(e => e.getAttribute('data-id')));
  await T.p.evaluate(() => {
    const n = new Date().toISOString(), c20 = window.__WA_CONVOS.filter(c => c.id === 'c20')[0];
    c20.last_message_at = new Date(Date.now() - 30000).toISOString(); c20.updated_at = n; c20.last_message_text = 'اتحرّكت فوق';
    const nw = Object.assign({}, c20, { id: 'cNEW', wa_id: '201099990000', customer_name: 'جديدة', last_message_at: n, updated_at: n, last_message_text: 'أول رسالة' });
    window.__WA_CONVOS.push(nw);
  });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waRefreshConvos());
  await T.p.waitForTimeout(600);
  const d = diff(a, await snap(T.p));
  const view = await T.p.evaluate(() => { const rows = Array.from(document.querySelectorAll('#wa-list-body .wa-conv'));
    const c20 = document.querySelector('#wa-list-body .wa-conv[data-id="c20"] .wa-conv-prev');
    return { ids: rows.map(e => e.getAttribute('data-id')), c20: c20 ? c20.textContent : null }; });
  await T.ctx.close();
  return { d, ids0, view };
}
async function probeConvFull10(o){
  const T = await open('/chats', o);
  const t0 = await T.p.evaluate(() => Date.now());
  await T.ctx.clock.setFixedTime(new Date(t0 + 11 * 60000));
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waRefreshConvos());
  await T.p.waitForTimeout(600);
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
}
async function probeConv200(o){
  const T = await open('/chats', o);
  await T.p.evaluate(() => { const n = new Date().toISOString(), base = window.__WA_CONVOS[0];
    for(let i = 0; i < 205; i++) window.__WA_CONVOS.push(Object.assign({}, base, { id: 'cb' + i, wa_id: '2011' + String(i).padStart(8, '0'), last_message_at: n, updated_at: n })); });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waRefreshConvos());
  await T.p.waitForTimeout(700);
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
}
const HIDE = v => `Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return ${v}; } });`;
async function probeHidden(o){
  const T = await open('/chats', o);
  await T.p.evaluate(HIDE('true'));
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js');
    m.handleWaRealtime({ eventType: 'INSERT', new: { id: 'mx', conversation_id: 'c3', direction: 'in', type: 'text', body: 'هاي', created_at: new Date().toISOString() } }); });
  await T.p.waitForTimeout(900);
  const hid = diff(a, await snap(T.p));
  await T.p.evaluate(HIDE('false'));
  await T.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await T.p.waitForTimeout(700);
  const back = diff(a, await snap(T.p)); await T.ctx.close();
  return { hid, back };
}
async function openChat(o){
  const T = await open('/chats', o);
  await T.p.click('#wa-list-body .wa-conv[data-id="c5"]');
  await T.p.waitForSelector('#wa-msgs .wa-msg[data-mid="m3"]', { timeout: 8000 });
  await T.p.waitForTimeout(300);
  return T;
}
async function probeMsgDelta(o){
  const T = await openChat(o);
  await T.p.evaluate(() => { const n = new Date().toISOString(); window.__WA_MSGS.push(Object.assign({}, window.__WA_MSGS[2], { id: 'm4', wa_message_id: 'wamid.m4', body: 'جديدة', created_at: n, wa_timestamp: n })); });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waRefreshMessages('c5', true));
  await T.p.waitForTimeout(700);
  const d = diff(a, await snap(T.p));
  const ids = await T.p.evaluate(() => Array.from(document.querySelectorAll('#wa-msgs .wa-msg[data-mid]')).map(e => e.getAttribute('data-mid')));
  await T.ctx.close(); return { d, ids };
}
async function probeMsgPatch(o){
  const T = await openChat(o);
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js');
    m.handleWaRealtime({ eventType: 'UPDATE', new: Object.assign({}, window.__WA_MSGS[1], { status: 'read' }) }); });
  await T.p.waitForTimeout(700);
  const d = diff(a, await snap(T.p));
  const st = await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js'); const x = (m.waLastMsgs || []).filter(r => r.id === 'm2')[0]; return x ? x.status : null; });
  await T.ctx.close(); return { d, st };
}
async function probeJxBadge(o){
  const T = await open('/orders', o);
  await T.p.waitForTimeout(500);
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const m = await import('/js/exceptions/exceptions.js');
    m.jxHandleRealtime({ eventType: 'INSERT', new: { id: 501, tracking_no: 'JEG000111222333' } }); });
  await T.p.waitForTimeout(1100);
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return { d, base: a };
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── الأوردرات: تصنيف الحدث');
{
  const d = await probeStampUnknown();
  ok(d.stats === 0 && d.merge === 0 && d.inv === 0 && d.page === 0, '1) ختم مزامنة J&T على أوردر مش في الصفحة = صفر جلب — ' + JSON.stringify(d));
}
{
  const T = await open('/orders'); const a = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'zz3', { order_uid: '7779', status: 'Delivered', updated_at: STAMP(), jt_fee_synced_at: '2026-01-01T00:00:00Z' });
  const d = diff(a, await snap(T.p)); await T.ctx.close();
  ok(d.stats >= 1 && d.merge === 1 && d.inv === 1 && d.page === 0, '2) ضابط: أوردر مش في الصفحة من غير ختم = الكروت + الدمج + البضاعة (مفيش فلتر = مفيش صفحة) — ' + JSON.stringify(d));
}
{
  const r = await probeKnownStatus();
  ok(r.before === 'استلام في المخزن' && r.after === 'تم التسليم' && r.d.stats >= 1 && r.d.page === 0,
    '3) أوردر في الصفحة اتغيّرت حالته ومفيش فلتر: الشارة اتغيّرت من الحدث + الكروت · مفيش جلب صفحة — ' + JSON.stringify(r));
}
{
  const r = await probeAwb();
  ok(!r.had && r.has && r.d.stats === 0 && r.d.merge === 0 && r.d.page === 0, '4) awb_print_count (مالوش كارت) = صفر جلب والصف اترسم ✓×2 — ' + JSON.stringify(r));
}
{
  const T = await open('/orders'); const a = await snap(T.p);
  await fireOrder(T.p, 'INSERT', 'nw1', { order_uid: '9100', status: 'pending', created_at: STAMP(), updated_at: STAMP() });
  const d = diff(a, await snap(T.p)); const t = await T.p.evaluate(() => Array.from(document.querySelectorAll('.toast, #toasts > *')).map(x => x.textContent).join('|'));
  await T.ctx.close();
  ok(d.stats >= 1 && d.page === 1 && /طلب جديد/.test(t), '5) أوردر جديد = الكروت + الصفحة + toast — ' + JSON.stringify(d));
}
{
  const T = await open('/orders');
  await setFilter(T.p, 'fst', '__operation__');
  const inFil = await badge(T.p, 'o2');
  const a = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'o2', { status: 'Delivered', updated_at: STAMP() });
  const d = diff(a, await snap(T.p));
  const a2 = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'o2', { status: 'Delivered', awb_print_count: 3, updated_at: STAMP() });
  const d2 = diff(a2, await snap(T.p)); await T.ctx.close();
  ok(inFil === 'استلام في المخزن' && d.page === 1, '6) فلتر «مع شركة الشحن» والأوردر اتسلّم = الصفحة اتجابت (الصف خرج من الفلتر) — ' + JSON.stringify({ inFil, d }));
  ok(d2.page === 0, '6ب) ضابط: نفس الفلتر وعمود مالوش علاقة = مفيش صفحة — ' + JSON.stringify(d2));
}
{
  const d = await probeSearchAddr();
  ok(d.page === 1 && d.stats === 0, '7) البحث شغّال والعنوان اتغيّر = الصفحة بس (العنوان عمود بحث مش عمود كارت) — ' + JSON.stringify(d));
}
{
  const d = await probeSafety();
  ok(d.stats >= 1 && d.merge === 1 && d.page === 0, '8) شبكة الأمان: آخر تحديث للكروت من 6 دقايق = حتى الختم بيجيب الكروت — ' + JSON.stringify(d));
}

console.log('\n── تنبيه الدمج');
{
  const r = await probeMerge();
  ok(r.v.shown && /^1 عميل/.test(r.v.count.trim()) && r.v.chips.join(',') === '#8801,#8802,#8803' && r.s.merge >= 1 && r.s.mergeSel === 0,
    '9) التنبيه من merge_candidates_v1: 3 صيغ للرقم = عميل واحد · الرقم التاني برّه · مفيش select الـ745 صف — ' + JSON.stringify(r));
}
{
  const r = await probeMerge({ pre: 'window.__MERGE_RPC_MISSING = true;' });
  ok(r.v.shown && /^1 عميل/.test(r.v.count.trim()) && r.s.mergeSel >= 1, '10) الدالة مش موجودة (PGRST202) = رجوع للاستعلام القديم والتنبيه زي ما هو — ' + JSON.stringify(r));
}

console.log('\n── المحادثات');
{
  const r = await probeConvDelta();
  ok(r.ids0.length === 30 && r.d.convDelta === 1 && r.d.convFull === 0 && r.view.ids[0] === 'cNEW' && r.view.ids[1] === 'c20' && r.view.ids.length === 31 && r.view.c20 === 'اتحرّكت فوق',
    '11) الـpoll بيجيب اللي اتغيّر بس (gt updated_at): الجديدة فوق · المتعدّلة بعدها بنصها الجديد · 31 — ' + JSON.stringify({ d: r.d, top: r.view.ids.slice(0, 3), n: r.view.ids.length, c20: r.view.c20 }));
}
{
  const d = await probeConvFull10();
  ok(d.convFull === 1 && d.convDelta === 0, '12) آخر جلب كامل من 11 دقيقة = كامل — ' + JSON.stringify(d));
}
{
  const d = await probeConv200();
  ok(d.convDelta === 1 && d.convFull === 1, '13) الدلتا رجعت 200 = كامل بعدها — ' + JSON.stringify(d));
}
{
  const r = await probeHidden();
  ok(r.hid.convDelta + r.hid.convFull === 0 && r.back.convDelta + r.back.convFull === 1, '14) رسالة والتاب في الخلفية = صفر جلب · رجوع التاب = جلب واحد — ' + JSON.stringify(r));
}
{
  const r = await probeMsgDelta();
  ok(r.d.msgDelta === 1 && r.d.msgFull === 0 && r.ids.join(',') === 'm1,m2,m3,m4', '15) الرسالة الجديدة من غير جلب الـ500 (gte created_at · limit 100) — ' + JSON.stringify(r));
}
{
  const r = await probeMsgPatch();
  ok(r.st === 'read' && r.d.msgDelta === 0 && r.d.msgFull === 0, '16) حالة الرسالة (اتقرت) من الحدث نفسه = صفر جلب — ' + JSON.stringify(r));
}

console.log('\n── شارة الاستثناءات');
{
  const r = await probeJxBadge();
  ok(r.base.jxFull >= 1 && r.d.jxDelta === 1 && r.d.jxFull === 0, '17) حدث jt_issues والتاب لسه ماتفتحتش = بوالص الحدث بس (in tracking_no) مش الـ30 يوم — ' + JSON.stringify(r));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── المعايرات (كل واحدة لازم توقّع فحص)');
const P = (file, from, to) => ({ file, fn: s => s.replace(from, to) });
async function cal(name, patches, probe, fails){
  try{
    const r = await probe({ patches });
    const f = fails(r);
    console.log(f ? '  ✓' : '  ✗', name, f ? '' : '— المعايرة عدّت والفحص مش هيمسك: ' + JSON.stringify(r));
    if(!f) bad++;
  }catch(e){ console.log('  ✗', name, '—', e.message); bad++; }
}
await cal('(أ) الختم مش متشاف → فحص 1 كان هيقع',
  [P('orders/orders.js', '    if(rtStampOnly(row)) return { light: false, page: false };\n', '')],
  probeStampUnknown, d => d.stats > 0);
await cal('(ب) التصنيف القديم (كل حدث = كروت + صفحة) → فحص 3 كان هيقع',
  [P('orders/orders.js', '    need = rtNeeds(row, rtKnownRow(row.id));', '    need = { light: true, page: true, render: false };')],
  probeKnownStatus, r => r.d.page > 0);
await cal('(ج) الصف المعروض مابيترسمش → فحص 4 كان هيقع',
  [P('orders/orders.js', '    if(prev) need.render = true;', '    if(false) need.render = true;')],
  probeAwb, r => !r.has);
await cal('(د) فلتر البحث مش متشاف → فحص 7 كان هيقع',
  [P('orders/orders.js', '  if(!page && f.q) page = rtChanged(prev, row, ORDER_SEARCH_COLS);\n', '')],
  probeSearchAddr, d => d.page === 0);
await cal('(هـ) شبكة الأمان اتشالت → فحص 8 كان هيقع',
  [P('orders/orders.js', '    if(!light && Date.now() - rtLastLightAt > RT_LIGHT_SAFETY_MS) light = true;\n', '')],
  probeSafety, d => d.stats === 0);
await cal('(و) الدمج بالاستعلام القديم (745 صف) → فحص 9 كان هيقع',
  [P('orders/cards.js', "sb.rpc('merge_candidates_v1', { p_tenant: currentTenantId })", "Promise.resolve({ data:null, error:{ code:'PGRST202' } })")],
  probeMerge, r => r.s.mergeSel > 0);
await cal('(ز) مفيش رجوع للقديم لما الدالة مش موجودة → فحص 10 كان هيقع',
  [P('orders/cards.js', '    if(!mergeRpcMissing(r.error)) return;', '    return;')],
  o => probeMerge(Object.assign({ pre: 'window.__MERGE_RPC_MISSING = true;' }, o)), r => !r.v.shown);
await cal('(ح) المحادثات كامل دايماً → فحص 11 كان هيقع',
  [P('inbox/inbox.js', '  waFetchConvosDelta();\n}', '  waFetchConvos(false);\n}')],
  probeConvDelta, r => r.d.convDelta === 0);
await cal('(ط) الدمج مابيرتّبش → الجديدة مش فوق (فحص 11 كان هيقع)',
  [P('inbox/inbox.js', '  waConvos.sort(function(a,b){\n    var ta=waLastMsgMs(a)', '  [].sort(function(a,b){\n    var ta=waLastMsgMs(a)')],
  probeConvDelta, r => r.view.ids[0] !== 'cNEW');
await cal('(ي) مفيش كامل بعد 10 دقايق → فحص 12 كان هيقع',
  [P('inbox/inbox.js', ' || Date.now()-waConvFullAt>WA_CONV_FULL_MS', '')],
  probeConvFull10, d => d.convFull === 0);
await cal('(ك) مفيش كامل بعد 200 → فحص 13 كان هيقع',
  [P('inbox/inbox.js', '      if(rows.length>=WA_CONV_DELTA_LIMIT){ waFetchConvos(false); return; }', '')],
  probeConv200, d => d.convFull === 0);
await cal('(ل) التاب المخفية بتجيب → فحص 14 كان هيقع',
  [P('inbox/inbox.js', '    if(document.hidden){ waPollMissed=true; }', '    if(false){ waPollMissed=true; }')],
  probeHidden, r => r.hid.convDelta + r.hid.convFull > 0);
await cal('(م) الرسايل كامل دايماً → فحص 15 كان هيقع',
  [P('inbox/inbox.js', '  var fullGen=waMsgGen, myGen=++waMsgDeltaGen;', '  waFetchMessages(convId,false,isPoll); return;\n  var fullGen=waMsgGen, myGen=++waMsgDeltaGen;')],
  probeMsgDelta, r => r.d.msgFull > 0);
await cal('(ن) حالة الرسالة بجلب → فحص 16 كان هيقع',
  [P('inbox/inbox.js', 'if(isUpdate && m.id) waPatchMessage(m); else waRefreshMessages(waActiveId,false);', 'waFetchMessages(waActiveId,false,false);')],
  probeMsgPatch, r => r.d.msgFull > 0);
await cal('(س) الشارة بالجلب الكامل مع كل حدث → فحص 17 كان هيقع',
  [P('exceptions/exceptions.js', '    else if(jxBadgeRows && list.length) jxBadgeFetch(list);\n', '')],
  probeJxBadge, r => r.d.jxFull > 0);

await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
