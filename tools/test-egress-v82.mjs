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
// ساعة المتصفح وساعة الفيكستشر لازم يبقوا واحد: مع CLOCK (أول يومين في الشهر — درس 52) الصفحة على CLOCK والكتابة في
// الفيكستشر من جوّه المتصفح (new Date()) — فالفيكستشر نفسه لازم يتبني على نفس الساعة
const NOW = process.env.CLOCK ? Date.parse(process.env.CLOCK) : Date.now();
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
  // أكتر من حقنة على نفس الملف بتتطبّق ورا بعض (route واحد للملف) — وكل حقنة لازم تلاقي مرساتها
  const byFile = {};
  for(const pt of (o.patches || [])){
    const src = byFile[pt.file] || SRC(pt.file), out = pt.fn(src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة: ' + pt.file);
    byFile[pt.file] = out;
  }
  for(const f of Object.keys(byFile)){
    const body = byFile[f];
    await p.route('**/js/' + f, r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body }));
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
  convRow: c.filter(x => x.table === 'wa_conversations' && x.eqId !== undefined && !x.payload && x.cols === '*').length,
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
  // صف اتغيّر على السيرفر (updated_at أحدث) والحدث ضاع — الكامل لازم يجيبه مش يسيب النسخة القديمة اللي في الذاكرة
  await T.p.evaluate(() => { const c4 = window.__WA_CONVOS.filter(c => c.id === 'c4')[0]; c4.last_message_text = 'اتصلحت في الكامل'; c4.updated_at = new Date().toISOString(); });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waRefreshConvos());
  await T.p.waitForTimeout(600);
  const d = diff(a, await snap(T.p));
  d.c4 = await T.p.evaluate(() => { const e = document.querySelector('#wa-list-body .wa-conv[data-id="c4"] .wa-conv-prev'); return e ? e.textContent : null; });
  await T.ctx.close(); return d;
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


// ── من المراجعة العدائية (v82) ────────────────────────────────────────
// 18) الصفحة في السكة (رد بطيء = snapshot قبل الحدث) وحدث وصل وهي في السكة → الصفحة بتتجاب تاني والصف على الحالة الجديدة
async function probeFlight(o){
  const T = await open('/orders', o);
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'orders' && st.from !== undefined) ? 1200 : 0; });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/orders.js')).fetchOrdersPage());
  await T.p.waitForTimeout(100);
  await fireOrder(T.p, 'UPDATE', 'o2', { status: 'Delivered', updated_at: STAMP() });
  await T.p.waitForTimeout(2600);
  const d = diff(a, await snap(T.p)); const bd = await badge(T.p, 'o2'); await T.ctx.close();
  return { d, bd };
}
// 18ب) صدى تعديل الموظف نفسه: السيرفر اتكتب **قبل** ما الصفحة تتطلب (doFilter بعد رد الـRPC) والصدى وصل وهي في السكة = مفيش جلب تاني
async function probeOwnEcho(o){
  const T = await open('/orders', o);
  const t = new Date().toISOString();
  await T.p.evaluate(tt => { const o2 = window.__ORDERS.filter(x => x.id === 'o2')[0]; o2.status = 'Delivered'; o2.updated_at = tt;
    window.__TABLE_DELAY = (tb, st) => (tb === 'orders' && st.from !== undefined) ? 1200 : 0; }, t);
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/orders.js')).fetchOrdersPage());
  await T.p.waitForTimeout(100);
  await T.p.evaluate(async tt => { const m = await import('/js/orders/orders.js'); const base = window.__ORDERS.filter(x => x.id === 'o2')[0];
    m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base, { updated_at: tt }), old: { id: 'o2' } }); }, t);
  await T.p.waitForTimeout(2600);
  const d = diff(a, await snap(T.p)); const bd = await badge(T.p, 'o2'); await T.ctx.close();
  return { d, bd };
}
// 19ب) أوردر مش في الصفحة اتفتح في التفاصيل (من تاب الاستثناءات) واتعدّل تليفونه محلي (sel) = صدى الحدث بيتقارن بنسخة السيرفر
async function probeDetailOnly(o){
  const T = await open('/orders', Object.assign({ pre: `window.__ORDERS.push(Object.assign({}, window.__ORDERS[0], { id: 'zd1', order_uid: '7801', status: 'BOSTA AUTO',
    phone: '01033334444', created_at: '2026-01-05T10:00:00.000Z', updated_at: '2026-01-05T10:00:00.000Z' }));` }, o));
  await T.p.evaluate(async () => (await import('/js/orders/detail.js')).openDetail('zd1'));
  await T.p.waitForTimeout(700);
  const inFil = await T.p.evaluate(async () => (await import('/js/orders/state.js')).fil.some(x => x.id === 'zd1'));
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const st = await import('/js/orders/state.js'); st.sel.phone = '01000000003'; });
  await T.p.evaluate(() => { const z = window.__ORDERS.filter(x => x.id === 'zd1')[0]; z.phone = '01000000003'; });
  await fireOrder(T.p, 'UPDATE', 'zd1', { phone: '01000000003', updated_at: STAMP() });
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return { d, inFil };
}
// 21ب) أوردر برّه الصفحة **معروف** (ختم قبل كده) واتغيّر تليفونه لرقم صف في الصفحة = عدّ الرقم ده
async function probeKnownPhone(o){
  const T = await open('/orders', o);
  await fireOrder(T.p, 'UPDATE', 'zk1', { order_uid: '7802', status: 'Delivered', phone: '01088887777', updated_at: '2026-10-01T10:00:00.000Z', jt_fee_synced_at: '2026-10-01T10:00:00.000Z' });
  const before = await T.p.evaluate(() => window.__calls.filter(x => x.table === 'orders' && x.cols === 'phone').length);
  await fireOrder(T.p, 'UPDATE', 'zk1', { order_uid: '7802', status: 'Delivered', phone: '01000000003', updated_at: STAMP() });
  const calls = await T.p.evaluate(() => window.__calls.filter(x => x.table === 'orders' && x.cols === 'phone'));
  await T.ctx.close();
  const last = calls[calls.length - 1];
  return { n: calls.length - before, phones: last ? ((last.f || []).filter(f => f.op === 'in' && f.col === 'phone')[0] || {}).val : null };
}
// 29ب) الموظف لغى أوردر **في الصفحة** ليه استثناء من نافذة التفاصيل (doUpdate) والصفحة نزلت **قبل** صدى الحدث = الدمج والشارة اتحدّثوا برضه
async function probeDoUpdate(o){
  const T = await open('/orders', Object.assign({ pre: `window.__JT_ISSUES = [{ id: 811, tenant_id: 't-test-1', tracking_no: 'TRK002', kind: 'exception',
      event_at: new Date(Date.now() - 2 * 3600000).toISOString(), verdict: null, outcome: null, order_status: 'Exception', review_state: null, staff_rev: 0, reviewed_rev: null,
      updated_at: new Date(Date.now() - 3600000).toISOString() }];
    var _h = window.__RPC_HOOK;
    window.__RPC_HOOK = function(n, a){
      if(n === 'set_order_status'){ var o = window.__ORDERS.filter(function(x){ return x.id === a.p_order_id; })[0]; o.status = a.p_status; o.updated_at = new Date().toISOString();
        window.__JT_ISSUES.forEach(function(r){ if(r.tracking_no === o.tracking_no) r.order_status = a.p_status; });
        return { data: [{ at: new Date().toISOString(), to: a.p_status, by: a.p_by }], error: null }; }
      return _h(n, a);
    };` }, o));
  await T.p.waitForTimeout(500);
  const s0 = await jxBadgeTxt(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/detail.js')).openDetail('o2'));
  await T.p.waitForTimeout(700);
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/mutations.js')).doUpdate('cancelled', 'اختبار'));
  await T.p.waitForTimeout(1200);   // الصفحة نزلت (من غير تأخير) قبل الصدى
  await T.p.evaluate(async () => { const m = await import('/js/orders/orders.js'); const base = window.__ORDERS.filter(x => x.id === 'o2')[0];
    m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base), old: { id: 'o2' } }); });
  await T.p.waitForTimeout(1500);
  const d = diff(a, await snap(T.p)); const s1 = await jxBadgeTxt(T.p); await T.ctx.close();
  return { s0, s1, d };
}
// 30) الكامل الدوري للرسايل في السكة وحالة «اتقرت» وصلت = اتطبّقت على نتيجته (الـsnapshot القديم مايرجّعهاش «اتبعتت»)
async function probeFlightPatch(o){
  const T = await openChat(o);
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'wa_messages' && st.limit === 500) ? 1200 : 0; });
  const t0 = await T.p.evaluate(() => Date.now());
  await T.ctx.clock.setFixedTime(new Date(t0 + 6 * 60000));
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waRefreshMessages('c5', true));
  await T.p.waitForTimeout(100);
  await T.p.evaluate(async () => { window.__WA_MSGS[1].status = 'read';
    (await import('/js/inbox/inbox.js')).handleWaRealtime({ eventType: 'UPDATE', new: Object.assign({}, window.__WA_MSGS[1], { status: 'read' }) }); });
  await T.p.waitForTimeout(200);
  const st = async () => T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js'); const x = (m.waLastMsgs || []).filter(r => r.id === 'm2')[0]; return x ? x.status : null; });
  const mid = await st();
  await T.p.waitForTimeout(2000);
  const end = await st(); const d = diff(a, await snap(T.p)); await T.ctx.close();
  return { mid, end, d };
}
// 30ب/ج) المحادثة بتتفتح (الكامل في السكة) وأحداث وصلت ليها: حالة (30ب) أو رسالة جديدة (30ج) = كامل واحد بس
async function probeOpenFlight(o, kind){
  const T = await open('/chats', o);
  // ⚠️ الستب بيرجّع كل __WA_MSGS لأي محادثة في الجلب الكامل — c3 لازم تبقى فاضية فعلاً (من غيرها waLastMsgs = رسايل c5 والسيناريو
  // «القايمة لسه مش المحادثة دي» عمره ما بيحصل والمعايرة بتعدّي على الفاضي)
  await T.p.evaluate(() => { window.__MSGS_C5 = window.__WA_MSGS; window.__WA_MSGS = []; });
  await T.p.click('#wa-list-body .wa-conv[data-id="c3"]');
  await T.p.waitForTimeout(500);
  await T.p.evaluate(() => { window.__WA_MSGS = window.__MSGS_C5; window.__TABLE_DELAY = (t, st) => (t === 'wa_messages' && st.limit === 500) ? 1200 : 0; });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).openConversation('c5'));
  await T.p.waitForTimeout(150);
  await T.p.evaluate(async k => { const m = await import('/js/inbox/inbox.js'); const n = new Date().toISOString();
    if(k === 'upd') m.handleWaRealtime({ eventType: 'UPDATE', new: Object.assign({}, window.__WA_MSGS[0], { is_read: true }) });
    else { window.__WA_MSGS.push(Object.assign({}, window.__WA_MSGS[2], { id: 'm5', wa_message_id: 'wamid.m5', body: 'وصلت وهي بتفتح', created_at: n, wa_timestamp: n }));
      m.handleWaRealtime({ eventType: 'INSERT', new: { id: 'm5', conversation_id: 'c5', direction: 'in', type: 'text', body: 'وصلت وهي بتفتح', created_at: n } }); } }, kind);
  await T.p.waitForTimeout(2200);
  const d = diff(a, await snap(T.p));
  const ids = await T.p.evaluate(() => Array.from(document.querySelectorAll('#wa-msgs .wa-msg[data-mid]')).map(e => e.getAttribute('data-mid')));
  await T.ctx.close(); return { d, ids };
}
// 25ب) المحادثة اتفتحت قبل ما صفها يتلاقي (الجلب برقمها مالقاهاش) ووصلت بعدين في الدلتا = الهيدر اتملى
async function probeOpenLate(o){
  const T = await openChat(o);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).openConversation('cL'));
  await T.p.waitForTimeout(500);
  const h0 = await T.p.evaluate(() => document.getElementById('wa-chat-name').textContent);
  await T.p.evaluate(async () => { const n = new Date().toISOString();
    window.__WA_CONVOS.push(Object.assign({}, window.__WA_CONVOS[0], { id: 'cL', wa_id: '201022223333', customer_phone: '01022223333', customer_name: 'وصلت متأخر', last_message_at: n, updated_at: n }));
    (await import('/js/inbox/inbox.js')).waRefreshConvos(); });
  await T.p.waitForTimeout(700);
  const h1 = await T.p.evaluate(() => document.getElementById('wa-chat-name').textContent);
  await T.ctx.close(); return { h0, h1 };
}

// 19) الموظف عدّل التليفون في التفاصيل (patchOrderField بيكتب على صف fil نفسه) وصدى الحدث وصل = الدمج والكروت اتحدّثوا
async function probeLocalPatch(o){
  const T = await open('/orders', o);
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const st = await import('/js/orders/state.js'); const r = st.fil.filter(x => x.id === 'o2')[0]; r.phone = '01011112222'; });
  await fireOrder(T.p, 'UPDATE', 'o2', { phone: '01011112222', updated_at: STAMP() });
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
}
// 20) أوردر معروف من مخزن الماليات بس (all — ALL_COLS من غير أعمدة الإلغاء) والعميل طلب إلغاء = الكروت وشريط الإلغاء اتحدّثوا
async function probeAllOnly(o){
  const T = await open('/orders', o);
  await T.p.evaluate(async () => { const st = await import('/js/orders/state.js');
    st.ordersSetAll([{ id: 'zall', status: 'Delivered', total_cost: 900, created_at: new Date(Date.now() - 86400000).toISOString(), payment_stage: 'cod', platform: 'fb' }]);
    st.ordersSetAllLoaded(true); });
  const a = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'zall', { order_uid: '7790', status: 'Delivered', cancel_requested_at: STAMP(), updated_at: STAMP() });
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
}
// 21) تليفون صف في الصفحة اتغيّر من تاب تانية = عدّ الرقمين (شارة العميل المتكرر)
async function probePhoneCounts(o){
  const T = await open('/orders', o);
  const before = await T.p.evaluate(() => window.__calls.filter(x => x.table === 'orders' && x.cols === 'phone').length);
  await fireOrder(T.p, 'UPDATE', 'o2', { phone: '01000000001', updated_at: STAMP() });
  const calls = await T.p.evaluate(() => window.__calls.filter(x => x.table === 'orders' && x.cols === 'phone'));
  await T.ctx.close();
  const last = calls[calls.length - 1];
  return { n: calls.length - before, phones: last ? ((last.f || []).filter(f => f.op === 'in' && f.col === 'phone')[0] || {}).val : null };
}
// 22) التاب مخفية وحالة رسالة في المحادثة المفتوحة اتغيّرت = اتطبّقت من الحدث (صفر جلب)
async function probeHiddenPatch(o){
  const T = await openChat(o);
  await T.p.evaluate(HIDE('true'));
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js');
    m.handleWaRealtime({ eventType: 'UPDATE', new: Object.assign({}, window.__WA_MSGS[1], { status: 'read' }) }); });
  await T.p.waitForTimeout(500);
  const d = diff(a, await snap(T.p));
  const st = await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js'); const x = (m.waLastMsgs || []).filter(r => r.id === 'm2')[0]; return x ? x.status : null; });
  await T.ctx.close(); return { d, st };
}
// 23) حالة اتغيّرت على السيرفر والحدث ضاع (قطع اتصال) = الجلب الكامل الدوري (5 دقايق — مسار الـpoll) بيصلّحها
async function probeFullRepair(o){
  const T = await openChat(o);
  await T.p.evaluate(() => { window.__WA_MSGS[1].status = 'read'; });
  const t0 = await T.p.evaluate(() => Date.now());
  await T.ctx.clock.setFixedTime(new Date(t0 + 6 * 60000));
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waRefreshMessages('c5', true));
  await T.p.waitForTimeout(700);
  const r = await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js'); const x = (m.waLastMsgs || []).filter(r => r.id === 'm2')[0];
    return { st: x ? x.status : null, full: window.__calls.filter(c => c.table === 'wa_messages' && c.limit === 500).length }; });
  await T.ctx.close(); return r;
}
// 24) جلب كامل للرسايل في السكة (بطيء) ورسالة جديدة وصلت = الدلتا بتستناه وبتتعمل بعده — الرسالة مابتختفيش
async function probeMsgFlight(o){
  const T = await openChat(o);
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'wa_messages' && st.limit === 500) ? 1200 : 0; });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waFetchMessages('c5', false, false));
  await T.p.waitForTimeout(100);
  await T.p.evaluate(async () => { const n = new Date().toISOString();
    window.__WA_MSGS.push(Object.assign({}, window.__WA_MSGS[2], { id: 'm4', wa_message_id: 'wamid.m4', body: 'جديدة', created_at: n, wa_timestamp: n }));
    const m = await import('/js/inbox/inbox.js');
    m.handleWaRealtime({ eventType: 'INSERT', new: { id: 'm4', conversation_id: 'c5', direction: 'in', type: 'text', body: 'جديدة', created_at: n } }); });
  await T.p.waitForTimeout(300);
  const mid = diff(a, await snap(T.p));
  await T.p.waitForTimeout(2000);
  const d = diff(a, await snap(T.p));
  const ids = await T.p.evaluate(() => Array.from(document.querySelectorAll('#wa-msgs .wa-msg[data-mid]')).map(e => e.getAttribute('data-mid')));
  await T.ctx.close(); return { mid, d, ids };
}
// 25) إشعار لعميل جديد مش في القايمة واتفتح = الهيدر بيتملى من المحادثة نفسها (مش العميل اللي قبلها)
async function probeOpenUnknown(o){
  const T = await openChat(o);
  await T.p.evaluate(() => { window.__WA_CONVOS.push(Object.assign({}, window.__WA_CONVOS[0], { id: 'cZ', wa_id: '201055554444', customer_phone: '01055554444', customer_name: 'هالة الجديدة', updated_at: new Date().toISOString() })); });
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).openConversation('cZ'));
  await T.p.waitForTimeout(700);
  const r = await T.p.evaluate(() => ({ name: document.getElementById('wa-chat-name').textContent, phone: document.getElementById('wa-chat-phone').textContent }));
  await T.ctx.close(); return r;
}
// 26) التاب مخفية ورسالة من محادثة مش في القايمة = الدلتا الصغيرة (عشان الإشعار وفتحه)
async function probeHiddenUnknown(o){
  const T = await open('/chats', o);
  await T.p.evaluate(HIDE('true'));
  // التاب مخفية من 11 دقيقة (آخر كامل قديم) — الشكل اللي كانت الدلتا فيه بتقع على الكامل (230 KB)
  const t0 = await T.p.evaluate(() => Date.now());
  await T.ctx.clock.setFixedTime(new Date(t0 + 11 * 60000));
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const n = new Date().toISOString();
    window.__WA_CONVOS.push(Object.assign({}, window.__WA_CONVOS[0], { id: 'cY', wa_id: '201066667777', customer_name: 'جديد', last_message_at: n, updated_at: n }));
    const m = await import('/js/inbox/inbox.js');
    m.handleWaRealtime({ eventType: 'INSERT', new: { id: 'my', conversation_id: 'cY', direction: 'in', type: 'text', body: 'سلام', created_at: n } }); });
  await T.p.waitForTimeout(900);
  const d = diff(a, await snap(T.p));
  const has = await T.p.evaluate(async () => !!(await import('/js/inbox/inbox.js')).waConvById('cY'));
  await T.ctx.close(); return { d, has };
}
// 27) جلب كامل للمحادثات في السكة ودلتا رسمت نسخة أحدث = الكامل مابيرجّعش القديم
async function probeConvFlight(o){
  const T = await open('/chats', o);
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'wa_conversations' && st.order === 'last_message_at') ? 1200 : 0; });
  await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waFetchConvos(false));
  await T.p.waitForTimeout(100);
  await T.p.evaluate(async () => { const n = new Date().toISOString(), c7 = window.__WA_CONVOS.filter(c => c.id === 'c7')[0];
    c7.last_message_text = 'نسخة أحدث'; c7.updated_at = n; c7.last_message_at = n;
    window.__WA_CONVOS.push(Object.assign({}, c7, { id: 'cF', wa_id: '201077778888', customer_name: 'جت وهو في السكة', last_message_text: 'جديدة' }));
    (await import('/js/inbox/inbox.js')).waRefreshConvos(); });
  await T.p.waitForTimeout(400);
  const mid = await T.p.evaluate(() => { const e = document.querySelector('#wa-list-body .wa-conv[data-id="c7"] .wa-conv-prev'); return e ? e.textContent : null; });
  await T.p.waitForTimeout(1600);
  const end = await T.p.evaluate(() => { const e = document.querySelector('#wa-list-body .wa-conv[data-id="c7"] .wa-conv-prev'); return e ? e.textContent : null; });
  const hasF = await T.p.evaluate(() => !!document.querySelector('#wa-list-body .wa-conv[data-id="cF"]'));
  await T.ctx.close(); return { mid, end, hasF };
}
// 28) شارة الاستثناءات على مسار الحدث: العدد بيتحسب على **كل** صفوف الشارة مش صفوف الحدث بس
const JX_ROWS = `window.__JT_ISSUES = ['B1','B2','B3'].map(function(b, i){ return { id: 700 + i, tenant_id: 't-test-1', tracking_no: b, kind: 'exception',
  event_at: new Date(Date.now() - (i + 2) * 3600000).toISOString(), verdict: null, outcome: null, order_status: 'Exception', review_state: null,
  staff_rev: 0, reviewed_rev: null, updated_at: new Date(Date.now() - 3600000).toISOString() }; });`;
const jxBadgeTxt = p => p.evaluate(() => { const b = document.getElementById('jx-nav-badge'); return b && b.style.display !== 'none' ? b.textContent : '0'; });
async function jxEvent(p, bill){
  await p.evaluate(async b => (await import('/js/exceptions/exceptions.js')).jxHandleRealtime({ eventType: 'UPDATE', new: { id: 1, tracking_no: b } }), bill);
  await p.waitForTimeout(1000);
}
async function probeJxCount(o){
  const T = await open('/orders', Object.assign({ pre: JX_ROWS }, o));
  await T.p.waitForTimeout(500);
  const s0 = await jxBadgeTxt(T.p);
  await jxEvent(T.p, 'B1');
  const s1 = await jxBadgeTxt(T.p);
  await T.p.evaluate(() => { window.__JT_ISSUES[1].outcome = 'delivered'; });
  await jxEvent(T.p, 'B2');
  const s2 = await jxBadgeTxt(T.p);
  await T.p.evaluate(() => { const r = Object.assign({}, window.__JT_ISSUES[0], { id: 799, tracking_no: 'B4', event_at: new Date().toISOString() }); window.__JT_ISSUES.push(r); });
  await jxEvent(T.p, 'B4');
  const s3 = await jxBadgeTxt(T.p);
  const sn = await snap(T.p);
  await T.ctx.close(); return { s: [s0, s1, s2, s3], jxFull: sn.jxFull };
}
// 29) الموظف لغى أوردر ليه استثناء (حالة الأوردر بتغيّر النتيجة من غير أي حدث على jt_issues) = ريل-تايم الأوردرات بيعيد البوليصة
// دي بس والشارة نزلت · ضابط: أوردر بوليصته مالهاش استثناء = ولا نداء للاستثناءات
async function probeJxOrderChange(o){
  const T = await open('/orders', Object.assign({ pre: JX_ROWS }, o));
  await T.p.waitForTimeout(500);
  const s0 = await jxBadgeTxt(T.p);
  const a = await snap(T.p);
  await T.p.evaluate(() => { window.__JT_ISSUES[1].order_status = 'cancelled'; });
  await fireOrder(T.p, 'UPDATE', 'zb2', { order_uid: '7795', tracking_no: 'B2', status: 'cancelled', updated_at: STAMP() });
  await T.p.waitForTimeout(800);
  const d = diff(a, await snap(T.p)); const s1 = await jxBadgeTxt(T.p);
  const a2 = await snap(T.p);
  await fireOrder(T.p, 'UPDATE', 'zb9', { order_uid: '7796', tracking_no: 'JEGNOEXC', status: 'cancelled', updated_at: STAMP() });
  await T.p.waitForTimeout(800);
  const d2 = diff(a2, await snap(T.p));
  await T.ctx.close(); return { s0, s1, d, d2 };
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
  ok(d.convFull === 1 && d.convDelta === 0 && d.c4 === 'اتصلحت في الكامل', '12) آخر جلب كامل من 11 دقيقة = كامل · وصف اتغيّر على السيرفر ظهر بنسخته الجديدة — ' + JSON.stringify(d));
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


console.log('\n── من المراجعة العدائية');
{
  const r = await probeFlight();
  ok(r.d.page === 1 && r.bd === 'تم التسليم', '18) الصفحة في السكة وحدث أحدث وصل = الصف من الحدث (مش الـsnapshot القديم) ومن غير جلب تاني — ' + JSON.stringify(r));
}
{
  const r = await probeOwnEcho();
  ok(r.d.page === 1 && r.bd === 'تم التسليم', '18ب) صدى تعديل الموظف وصل والصفحة في السكة (الـsnapshot بعد الـcommit) = مفيش جلب تاني — ' + JSON.stringify(r));
}
{
  const r = await probeDetailOnly();
  ok(!r.inFil && r.d.merge >= 1 && r.d.stats >= 1, '19ب) أوردر مش في الصفحة اتفتح في التفاصيل واتعدّل محلي = الصدى اتقارن بنسخة السيرفر (الدمج والكروت) — ' + JSON.stringify(r));
}
{
  const d = await probeLocalPatch();
  ok(d.merge >= 1 && d.stats >= 1, '19) التليفون اتعدّل محلي (fil نفسه) وصدى الحدث = الدمج والكروت اتحدّثوا عند الموظف اللي عدّل — ' + JSON.stringify(d));
}
{
  const d = await probeAllOnly();
  ok(d.stats >= 1 && d.merge >= 1, '20) أوردر معروف من مخزن الماليات بس وطلب إلغاء = الكروت وشريط الإلغاء اتحدّثوا — ' + JSON.stringify(d));
}
{
  const r = await probePhoneCounts();
  ok(r.n >= 1 && Array.isArray(r.phones) && r.phones.indexOf('01000000001') >= 0 && r.phones.indexOf('01000000002') >= 0,
    '21) تليفون صف في الصفحة اتغيّر من تاب تانية = عدّ الرقمين (الجديد والقديم) — ' + JSON.stringify(r));
}
{
  const r = await probeKnownPhone();
  ok(r.n === 1 && Array.isArray(r.phones) && r.phones.indexOf('01000000003') >= 0, '21ب) أوردر برّه الصفحة معروف (ختم قبل كده) واتغيّر لرقم صف في الصفحة = عدّ الرقم ده — ' + JSON.stringify(r));
}
{
  const r = await probeHiddenPatch();
  ok(r.st === 'read' && r.d.msgFull + r.d.msgDelta === 0, '22) التاب مخفية وحالة رسالة اتغيّرت = اتطبّقت من الحدث (صفر جلب) — ' + JSON.stringify(r));
}
{
  const r = await probeFullRepair();
  ok(r.st === 'read' && r.full >= 2, '23) الحالة اتغيّرت والحدث ضاع = الكامل الدوري (مسار الـpoll) صلّحها — ' + JSON.stringify(r));
}
{
  const r = await probeMsgFlight();
  ok(r.mid.msgDelta === 0 && r.d.msgDelta === 1 && r.ids.indexOf('m4') >= 0, '24) الكامل في السكة ورسالة وصلت = الدلتا استنته واتعملت بعده والرسالة ظاهرة — ' + JSON.stringify(r));
}
{
  const r = await probeOpenUnknown();
  ok(r.name === 'هالة الجديدة' && r.phone === '01055554444', '25) محادثة مش في القايمة اتفتحت = الهيدر من المحادثة نفسها — ' + JSON.stringify(r));
}
{
  const r = await probeOpenLate();
  ok(r.h0 === '…' && r.h1 === 'وصلت متأخر', '25ب) اتفتحت قبل ما صفها يتلاقي ووصل بعدين في الدلتا = الهيدر اتملى (مش «…» للأبد) — ' + JSON.stringify(r));
}
{
  const r = await probeHiddenUnknown();
  ok(r.d.convDelta + r.d.convFull === 0 && r.d.convRow === 1 && r.has, '26) التاب مخفية من 11 دقيقة ورسالة من عميل جديد = صف المحادثة دي بس (مش القايمة) — ' + JSON.stringify(r));
}
{
  const r = await probeConvFlight();
  ok(r.mid === 'نسخة أحدث' && r.end === 'نسخة أحدث' && r.hasF, '27) الكامل في السكة والدلتا رسمت الأحدث = الكامل مارجّعش القديم · والمحادثة اللي جت في الدلتا فضلت (دلتا بعد الكامل) — ' + JSON.stringify(r));
}
{
  const r = await probeJxCount();
  ok(r.s.join(',') === '3,3,2,3', '28) شارة الاستثناءات على مسار الحدث: حدث من غير تغيير = 3 · اتسلّمت = 2 · بوليصة جديدة = 3 — ' + JSON.stringify(r));
}
{
  const r = await probeJxOrderChange();
  ok(r.s0 === '3' && r.s1 === '2' && r.d.jxDelta === 1 && r.d.jxFull === 0 && r.d2.jxDelta + r.d2.jxFull === 0,
    '29) أوردر ليه استثناء اتلغى = البوليصة دي اتعادت والشارة 3 ← 2 · ضابط: بوليصة مالهاش استثناء = ولا نداء — ' + JSON.stringify(r));
}
{
  const r = await probeDoUpdate();
  ok(r.s0 === '1' && r.s1 === '0' && r.d.merge >= 1 && r.d.jxDelta >= 1, '29ب) الموظف لغى أوردر في الصفحة ليه استثناء والصفحة نزلت قبل الصدى = الدمج والشارة (1 ← 0) اتحدّثوا — ' + JSON.stringify(r));
}
{
  const r = await probeFlightPatch();
  ok(r.mid === 'read' && r.end === 'read' && r.d.msgFull === 1, '30) الكامل الدوري في السكة و«اتقرت» وصلت = اتطبّقت على نتيجته (مارجعتش «اتبعتت») — ' + JSON.stringify(r));
}
{
  const r = await probeOpenFlight(undefined, 'upd');
  ok(r.d.msgFull === 1 && r.d.msgDelta === 0, '30ب) المحادثة بتتفتح وحالة رسالة فيها وصلت = كامل واحد ومفيش دلتا بعده — ' + JSON.stringify(r));
}
{
  const r = await probeOpenFlight(undefined, 'ins');
  ok(r.d.msgFull === 1 && r.d.msgDelta === 1 && r.ids.indexOf('m5') >= 0, '30ج) المحادثة بتتفتح ورسالة جديدة وصلت = كامل واحد + دلتا بعده والرسالة ظاهرة — ' + JSON.stringify(r));
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
  [P('orders/orders.js', '    need = rtNeeds(row, known);', '    need = { light: true, page: true, render: false };')],
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
  [P('inbox/inbox.js', '    if(document.hidden){\n      waPollMissed=true;', '    if(false){\n      waPollMissed=true;')],
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

await cal('(ع) الحدث الأحدث مابيتطبّقش على الصفحة اللي نزلت → فحص 18 كان هيقع',
  [P('orders/orders.js', '    if(flight) rtOverlayFlight(flight);\n', '')],
  probeFlight, r => r.bd !== 'تم التسليم');
await cal('(عع) أي حدث وقت ما الصفحة في السكة = جلب تاني (إصلاح الجولة الأولى) → فحص 18ب كان هيقع',
  [P('orders/orders.js', "  if(ev === 'UPDATE' && pageFlightRows && pageFlightAt && Date.now() - pageFlightAt < PAGE_FLIGHT_MS) pageFlightRows[row.id] = row;", '  if(pageFlightAt && Date.now() - pageFlightAt < PAGE_FLIGHT_MS) need.page = true;')],
  probeOwnEcho, r => r.d.page > 1);
await cal('(فف) التفاصيل مابتسجّلش نسخة السيرفر → فحص 19ب كان هيقع',
  [P('orders/detail.js', "    try{ rtNoteServerRow(r.data); }catch(e){ swallow('openDetail/rtNoteServerRow', e); }\n", '')],
  probeDetailOnly, r => r.d.merge === 0);
await cal('(قق) الأوردر المعروف برّه الصفحة مابيتعدّش → فحص 21ب كان هيقع',
  [P('orders/orders.js', '    else if(!prev && !rtStampOnly(row) && (!known || phoneMoved)){', '    else if(!prev && !rtStampOnly(row) && !known){')],
  probeKnownPhone, r => r.n === 0);
await cal('(ثث) الهيدر مابيتصلّحش لما الصف يوصل → فحص 25ب كان هيقع',
  [P('inbox/inbox.js', '    if(waHdrPendingId===waActiveId){ waHdrPendingId=null; waFillChatHeader(ac); waLoadConvMeta(ac); waLoadOrders(ac); }\n', '')],
  probeOpenLate, r => r.h1 !== 'وصلت متأخر');
await cal('(طط) doUpdate مابيبلّغش الدمج والاستثناءات → فحص 29ب كان هيقع',
  [P('orders/mutations.js', 'loadOrdersCards();loadBostaInventoryCard();loadMergeCandidates();doFilter();\n    if(ord.tracking_no) jxNoteOrderChange(ord.tracking_no);\n', 'loadOrdersCards();loadBostaInventoryCard();doFilter();\n')],
  probeDoUpdate, r => r.s1 !== '0');
await cal('(حح) حالات الأحداث وقت الكامل مابتتطبّقش على نتيجته → فحص 30 كان هيقع',
  [P('inbox/inbox.js', '      if(fl) waApplyFlightPatches(data, fl.patches);\n', '')],
  probeFlightPatch, r => r.end !== 'read');
await cal('(حح2) ترتيب الحالة بالمقلوب → فحص 30 كان هيقع',
  [P('inbox/inbox.js', '<= (WA_STATUS_RANK[data[i].status]||0)) continue;', '>= (WA_STATUS_RANK[data[i].status]||0)) continue;')],
  probeFlightPatch, r => r.end !== 'read');
await cal('(حح3) الحالة مابتتسجّلش وقت الكامل → فحص 30 كان هيقع',
  [P('inbox/inbox.js', '  if(inFlight) waMsgFlight.patches[row.id]=row;', '  if(inFlight) void 0;')],
  probeFlightPatch, r => r.end !== 'read');
await cal('(ضض) الحالة وقت الفتح بتجيب دلتا بعده → فحص 30ب كان هيقع',
  [P('inbox/inbox.js', '    if(inFlight) return;   // الكامل اللي في السكة هيجيبها والحالة بتتطبّق على نتيجته\n', '')],
  o => probeOpenFlight(o, 'upd'), r => r.d.msgDelta > 0);
await cal('(ظظ) فحص الكامل في السكة بعد «القايمة مش المحادثة دي» → فحص 30ج كان هيقع (كامل تاني)',
  [P('inbox/inbox.js', '  if(waMsgFlight && waMsgFlight.conv===convId && Date.now()-waMsgFlight.at<WA_MSG_FLIGHT_MS){ waMsgFlight.delta=true; return; }\n  var last=waLastMsgs||[];', '  var last=waLastMsgs||[];')],
  o => probeOpenFlight(o, 'ins'), r => r.d.msgFull > 1);
await cal('(يي) الكامل بيسيب النسخة القديمة اللي في الذاكرة (المقارنة بالمقلوب) → فحص 12 كان هيقع',
  [P('inbox/inbox.js', 'if(o && !waConvNewer(data[di], o)) data[di]=o;', 'if(o && waConvNewer(data[di], o)) data[di]=o;')],
  probeConvFull10, d => d.c4 !== 'اتصلحت في الكامل');
await cal('(ف) المقارنة بصف fil المعدّل محلي → فحص 19 كان هيقع',
  [P('orders/orders.js', '    for(var ri=0; ri<fil.length; ri++) rtRemember(fil[ri]);\n', '')],
  probeLocalPatch, d => d.merge === 0);
await cal('(ص) المقارنة بمخزن الماليات (all) → فحص 20 كان هيقع',
  [P('orders/orders.js', '  if(sel && sel.id === id) return sel;\n  return null;', '  if(sel && sel.id === id) return sel;\n  if(allLoaded){ for(var j=0;j<all.length;j++){ if(all[j].id === id) return all[j]; } }\n  return null;')],
  probeAllOnly, d => d.stats === 0);
await cal('(ق) مفيش عدّ للتليفون اللي اتغيّر → فحص 21 كان هيقع',
  [P('orders/orders.js', '    if(prev && phoneMoved) phs = [row.phone, known.phone];', '    if(false) phs = [];')],
  probePhoneCounts, r => r.n === 0);
await cal('(ر) التاب المخفية بترمي حالة الرسالة → فحص 22 كان هيقع',
  [P('inbox/inbox.js', '      if(isUpdate && m.id && m.conversation_id && m.conversation_id===waActiveId) waPatchMessage(m, true);\n', '')],
  probeHiddenPatch, r => r.st !== 'read');
await cal('(ش) الكامل الدوري بيرجع بدري من غير ما يقارن الحالات → فحص 23 كان هيقع',
  [P('inbox/inbox.js', ' && waSameMsgs(data, waLastMsgs)){', '){')],
  probeFullRepair, r => r.st !== 'read');
await cal('(ت) الدلتا مابتستناش الكامل اللي في السكة → فحص 24 كان هيقع',
  [P('inbox/inbox.js', '  if(waMsgFlight && waMsgFlight.conv===convId && Date.now()-waMsgFlight.at<WA_MSG_FLIGHT_MS){ waMsgFlight.delta=true; return; }\n', '')],
  probeMsgFlight, r => r.mid.msgDelta > 0 || r.ids.indexOf('m4') < 0);
await cal('(ث) المحادثة المش معروفة مابتتجابش برقمها → فحص 25 كان هيقع',
  [P('inbox/inbox.js', '  if(!c && sb && currentTenantId){', '  if(false){')],
  probeOpenUnknown, r => r.name !== 'هالة الجديدة');
await cal('(خ) التاب المخفية مابتجيبش صف المحادثة الجديدة → فحص 26 كان هيقع',
  [P('inbox/inbox.js', '    if(inboxOpen && m.conversation_id && !waConvById(m.conversation_id)) waFetchConvRow(m.conversation_id, function(){ waNotify(m); });\n    else waNotify(m);', '    waNotify(m);')],
  probeHiddenUnknown, r => !r.has);
await cal('(خخ) التاب المخفية بتجيب القايمة (الدلتا ← الكامل بعد 10 دقايق) → فحص 26 كان هيقع',
  [P('inbox/inbox.js', '    if(inboxOpen && m.conversation_id && !waConvById(m.conversation_id)) waFetchConvRow(m.conversation_id, function(){ waNotify(m); });', '    if(inboxOpen && m.conversation_id && !waConvById(m.conversation_id)){ waRefreshConvos(); waNotify(m); }')],
  probeHiddenUnknown, r => r.d.convDelta + r.d.convFull > 0);
// الحمايتين (الأحدث بيكسب + دلتا بعد الكامل) بيغطّوا الصف المتعدّل مع بعض — كل معايرة بتشيل الاتنين للحالة اللي بتختبرها
await cal('(ذ) الكامل بيكتب فوق الأحدث (من غير الحمايتين) → فحص 27 كان هيقع',
  [P('inbox/inbox.js', '      for(var di=0;di<data.length;di++){ var o=cur[data[di].id]; if(o && !waConvNewer(data[di], o)) data[di]=o; }\n', ''),
   P('inbox/inbox.js', '      if(waConvDeltaDraws!==draws0) waFetchConvosDelta();', '')],
  probeConvFlight, r => r.end !== 'نسخة أحدث');
await cal('(أأ) مفيش دلتا بعد الكامل → المحادثة اللي جت وهو في السكة اختفت (فحص 27 كان هيقع)',
  [P('inbox/inbox.js', '      if(waConvDeltaDraws!==draws0) waFetchConvosDelta();', '')],
  probeConvFlight, r => !r.hasF);
await cal('(ض) الشارة بتتحسب على صفوف الحدث بس → فحص 28 كان هيقع',
  [P('exceptions/exceptions.js', '        jxBadgeAll(allRows, Date.now());', '        jxBadgeAll(rows, Date.now());')],
  probeJxCount, r => r.s.join(',') !== '3,3,2,3');
await cal('(ظ) الأوردرات مابتبلّغش الاستثناءات بتغيير الحالة → فحص 29 كان هيقع',
  [P('orders/orders.js', '      try{ jxNoteOrderChange(row.tracking_no); }catch(e){', '      try{ void 0; }catch(e){')],
  probeJxOrderChange, r => r.s1 !== '2');
await cal('(غ) البلاغ لأي بوليصة حتى اللي مالهاش استثناء → ضابط فحص 29 كان هيقع',
  [P('exceptions/exceptions.js', '  if(known) jxHandleRealtime({ new: { tracking_no: trk } });', '  jxHandleRealtime({ new: { tracking_no: trk } });')],
  probeJxOrderChange, r => r.d2.jxDelta + r.d2.jxFull > 0);

await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
