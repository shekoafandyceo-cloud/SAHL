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
  waOrders: c.filter(x => x.table === 'orders' && x.limit === 25 && String(x.cols || '').indexOf('id,order_uid,status') === 0).length,
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
const PROD_UPDATED = `window.__ORDERS.forEach(function(o){ o.updated_at = '2026-10-01T08:00:00.000Z'; });`;
// وقت بمنطقة «+00» من غير دقايق — V8 بيفهمه بالمسافة («… 10:00:00+00») بس **مابيفهمهوش بالـT** («…T10:00:00.123+00») — rtTime بيطبّع الاتنين
const RT_STAMP = () => { const d = new Date(); return d.toISOString().replace('Z', '+00'); };
async function probeFlight(o, late){
  const T = await open('/orders', Object.assign({ pre: PROD_UPDATED }, o));
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'orders' && st.from !== undefined) ? 1200 : 0; });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/orders.js')).fetchOrdersPage());
  await T.p.waitForTimeout(100);
  // late: الحدث وصل بعد 16ث من بداية الجلب (نت بطيء) — كان بيتساب برّه الـbuffer (حد 15ث) والصف بيرجع للقديم لما الصفحة تنزل
  if(late){ const t0 = await T.p.evaluate(() => Date.now()); await T.ctx.clock.setFixedTime(new Date(t0 + 16000)); }
  await fireOrder(T.p, 'UPDATE', 'o2', { status: 'Delivered', updated_at: RT_STAMP() });
  await T.p.waitForTimeout(2600);
  const d = diff(a, await snap(T.p)); const bd = await badge(T.p, 'o2'); await T.ctx.close();
  return { d, bd };
}
// 18ج) حدث **أقدم** من الـsnapshot وصل والصفحة في السكة (push متأخر) = الـsnapshot الأحدث بيكسب
async function probeStaleEvent(o){
  const T = await open('/orders', Object.assign({ pre: PROD_UPDATED }, o));
  await T.p.evaluate(() => { const o2 = window.__ORDERS.filter(x => x.id === 'o2')[0]; o2.status = 'Delivered'; o2.updated_at = '2026-10-10T10:00:00.000Z';
    window.__TABLE_DELAY = (t, st) => (t === 'orders' && st.from !== undefined) ? 1200 : 0; });
  await T.p.evaluate(async () => (await import('/js/orders/orders.js')).fetchOrdersPage());
  await T.p.waitForTimeout(100);
  await T.p.evaluate(async () => { const m = await import('/js/orders/orders.js'); const base = window.__ORDERS.filter(x => x.id === 'o2')[0];
    m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base, { status: 'Out for delivery', updated_at: '2026-10-05 10:00:00+00' }), old: { id: 'o2' } }); });
  await T.p.waitForTimeout(2600);
  const bd = await badge(T.p, 'o2'); await T.ctx.close(); return { bd };
}
// 18د) الفلتر اتغيّر (الصفحة الجديدة في السكة) وحدث ختم على صف من الصفحة القديمة = الـskeleton فاضل (مش الصفحة القديمة فوقه)
async function probeSkeleton(o, kind){
  const T = await open('/orders', o);
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'orders' && st.from !== undefined) ? 3000 : 0; });
  await T.p.evaluate(() => { const el = document.getElementById('fst'); el.value = 'pending'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await T.p.waitForTimeout(150);
  await T.p.evaluate(async k => { const m = await import('/js/orders/orders.js'); const base = window.__ORDERS.filter(x => x.id === 'o1')[0]; const t = new Date().toISOString();
    const patch = k === 'status' ? { status: 'Exception', updated_at: t } : k === 'phone' ? { phone: '01000000002', updated_at: t } : { ship_rank: 90, ship_rank_at: t, updated_at: t };
    m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base, patch), old: { id: 'o1' } }); }, kind || 'stamp');
  // بدري: رسم الحالة متزامن مع الحدث والصفحة اللي الحدث طلبها (بعد 800ms) بترسم الـskeleton تاني فوقه
  await T.p.waitForTimeout(150);
  const early = await T.p.evaluate(() => !!document.querySelector('#tbody tr[data-id="o1"]'));
  await T.p.waitForTimeout(1150);
  const mid = await T.p.evaluate(() => !!document.querySelector('#tbody tr[data-id="o1"]'));
  await T.p.waitForTimeout(2500);
  const end = await T.p.evaluate(() => Array.from(document.querySelectorAll('#tbody tr[data-id]')).map(e => e.getAttribute('data-id')));
  await T.ctx.close(); return { early, mid, end };
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
// 19ج) نسخة السيرفر من التفاصيل وصلت **بعد** حدث أحدث (select('*') بطيء) = مابتدوسش عليه — الصدى التاني «مفيش تغيير»
async function probeDetailLate(o){
  const T = await open('/orders', Object.assign({ pre: `window.__ORDERS.push(Object.assign({}, window.__ORDERS[0], { id: 'zd2', order_uid: '7803', status: 'BOSTA AUTO',
    phone: '01044445555', created_at: '2026-01-05T10:00:00.000Z', updated_at: '2026-01-05T10:00:00.000Z' }));` }, o));
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'orders' && st.single && st.eqId === 'zd2') ? 1200 : 0; });
  await T.p.evaluate(async () => (await import('/js/orders/detail.js')).openDetail('zd2'));
  await T.p.waitForTimeout(150);
  const t = new Date().toISOString();
  // ⚠️ السيرفر بيتكتب بصف **جديد** مكان القديم: select('*') في الستب بيرجّع نفس الـobject (مش نسخة)، فالتعديل في مكانه كان بيوصل للرد
  // المتأخر نفسه ومفيش «نسخة أقدم» خالص (المعايرة كانت بتعدّي على الفاضي)
  const fire = () => T.p.evaluate(async tt => { const i = window.__ORDERS.findIndex(x => x.id === 'zd2');
    window.__ORDERS[i] = Object.assign({}, window.__ORDERS[i], { status: 'bosta_assigned', updated_at: tt });
    (await import('/js/orders/orders.js')).handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, window.__ORDERS[i]), old: { id: 'zd2' } }); }, t);
  await fire();
  await T.p.waitForTimeout(1300);   // التفاصيل نزلت بالنسخة الأقدم (BOSTA AUTO)
  const a = await snap(T.p);
  await fire();   // صدى تاني بنفس القيم
  await T.p.waitForTimeout(1300);
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
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
async function probeDoUpdate(o, v){
  v = v || {};
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
  if(v.idle){ const t0 = await T.p.evaluate(() => Date.now()); await T.ctx.clock.setFixedTime(new Date(t0 + 6 * 60000)); }   // شبكة الأمان (5 دقايق)
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/mutations.js')).doUpdate('cancelled', 'اختبار'));
  await T.p.waitForTimeout(1200);   // الصفحة نزلت (من غير تأخير) قبل الصدى
  await T.p.evaluate(async () => { const m = await import('/js/orders/orders.js'); const base = window.__ORDERS.filter(x => x.id === 'o2')[0];
    m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base), old: { id: 'o2' } }); });
  await T.p.waitForTimeout(1500);
  const d = diff(a, await snap(T.p)); const s1 = await jxBadgeTxt(T.p); await T.ctx.close();
  return { s0, s1, d };
}
// 29ج) فلتر شغّال والموظف غيّر حالة أوردر (doUpdate) والصدى وصل والصفحة اللي طلبها في السكة = صفحة واحدة ودمج واحد
async function probeDoUpdateFiltered(o){
  const T = await open('/orders', Object.assign({ pre: `var _h = window.__RPC_HOOK;
    window.__RPC_HOOK = function(n, a){
      if(n === 'set_order_status'){ var o = window.__ORDERS.filter(function(x){ return x.id === a.p_order_id; })[0]; o.status = a.p_status; o.updated_at = new Date().toISOString();
        return { data: [{ at: new Date().toISOString(), to: a.p_status, by: a.p_by }], error: null }; }
      return _h(n, a);
    };` }, o));
  await setFilter(T.p, 'fst', '__operation__');
  await T.p.evaluate(async () => (await import('/js/orders/detail.js')).openDetail('o2'));
  await T.p.waitForTimeout(700);
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'orders' && st.from !== undefined) ? 1200 : 0; });
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/mutations.js')).doUpdate('cancelled', 'اختبار'));
  await T.p.waitForTimeout(150);
  await T.p.evaluate(async () => { const m = await import('/js/orders/orders.js'); const base = window.__ORDERS.filter(x => x.id === 'o2')[0];
    m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base), old: { id: 'o2' } }); });
  await T.p.waitForTimeout(2800);
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return d;
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
// 25ج) المحادثة اتفتحت (مش في القايمة) وقايمة جابتها **قبل** الجلب برقمها = الهيدر واللوحات مرة واحدة (أوردرات العميل مرة)
async function probeOpenRace(o){
  const T = await openChat(o);
  await T.p.evaluate(() => { const n = new Date().toISOString();
    window.__WA_CONVOS.push(Object.assign({}, window.__WA_CONVOS[0], { id: 'cQ', wa_id: '201011112222', customer_phone: '01011112222', customer_name: 'سباق', last_message_at: n, updated_at: n }));
    window.__TABLE_DELAY = (t, st) => (t === 'wa_conversations' && st.eqId === 'cQ') ? 1000 : 0; });
  const a = await snap(T.p);
  await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js'); m.openConversation('cQ'); m.waRefreshConvos(); });
  await T.p.waitForTimeout(1800);
  const d = diff(a, await snap(T.p));
  const name = await T.p.evaluate(() => document.getElementById('wa-chat-name').textContent);
  await T.ctx.close(); return { d, name };
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
// إشعار المتصفح مزيّف: الإذن «granted» والعنوان بيتسجّل (الإشعار الحقيقي مابيظهرش في headless)
const FAKE_NOTIF = `window.__NOTES = []; window.Notification = function(t, o){ window.__NOTES.push(t); this.close = function(){}; }; window.Notification.permission = 'granted';`;
async function probeHiddenUnknown(o, v){
  v = v || {};
  const pre = v.notif === 'denied' ? FAKE_NOTIF + `window.Notification.permission = 'denied';`
    : v.notif === 'none' ? `window.__NOTES = []; try{ delete window.Notification; }catch(e){}` : FAKE_NOTIF;
  const T = await open('/chats', Object.assign({ pre }, o));
  const api = await T.p.evaluate(() => 'Notification' in window);
  if(!v.visible) await T.p.evaluate(HIDE('true'));
  // التاب مخفية من 11 دقيقة (آخر كامل قديم) — الشكل اللي كانت الدلتا فيه بتقع على الكامل (230 KB)
  const t0 = await T.p.evaluate(() => Date.now());
  await T.ctx.clock.setFixedTime(new Date(t0 + 11 * 60000));
  if(v.visible) await T.p.evaluate(async () => (await import('/js/inbox/inbox.js')).waFetchConvos(false));   // الظاهرة بيتعمل لها كامل مع الـpoll
  await T.p.waitForTimeout(300);
  const a = await snap(T.p);
  let err = null;
  try{
    await T.p.evaluate(async n0 => { const n = new Date().toISOString();
      window.__WA_CONVOS.push(Object.assign({}, window.__WA_CONVOS[0], { id: 'cY', wa_id: '201066667777', customer_name: 'جديد', last_message_at: n, updated_at: n }));
      const m = await import('/js/inbox/inbox.js');
      for(let i = 0; i < n0; i++) m.handleWaRealtime({ eventType: 'INSERT', new: { id: 'my' + i, conversation_id: 'cY', direction: 'in', type: 'text', body: 'سلام', created_at: n } }); }, v.burst || 1);
  }catch(e){ err = String(e.message || e).split('\n')[0]; }
  await T.p.waitForTimeout(900);
  const d = diff(a, await snap(T.p));
  const has = await T.p.evaluate(async () => !!(await import('/js/inbox/inbox.js')).waConvById('cY'));
  const notes = await T.p.evaluate(() => window.__NOTES);
  await T.ctx.close(); return { d, has, notes, err, api };
}
// 26و–26ط) الإشعار المستني في التاب الظاهرة (الجولة الخامسة): المهلة · مرة واحدة · الأحدث بيكسب · المهلة لكل محادثة
// المهلة من Date.now فالساعة لازم تمشي — CLOCK (أول الشهر) بيجمّدها (clock-preload) فكل المهل بتبقى نفس اللحظة وكل re-arm بيأجّل 2.5ث
// كاملة: بنرجّعها تمشي من نفس اللحظة · آخر كامل اتعمل وقت الفتح فالـpoll/الحدث = دلتا
const FAKE_NOTIF_B = `window.__NOTES = []; window.__NOTEB = []; window.Notification = function(t, o){ window.__NOTES.push(t); window.__NOTEB.push(o && o.body); this.close = function(){}; }; window.Notification.permission = 'granted';`;
const notesOf = p => p.evaluate(() => ({ t: window.__NOTES.slice(), b: window.__NOTEB.slice() }));
async function waIn(p, id, body, push){
  await p.evaluate(async a => { const n = new Date().toISOString();
    if(a.push) window.__WA_CONVOS.push(Object.assign({}, window.__WA_CONVOS[0], { id: a.id, wa_id: a.push.wa, customer_name: a.push.name, last_message_at: n, updated_at: n }));
    (await import('/js/inbox/inbox.js')).handleWaRealtime({ eventType: 'INSERT', new: { id: 'n' + Math.random(), conversation_id: a.id, direction: 'in', type: 'text', body: a.body, created_at: n } });
  }, { id, body, push: push || null });
}
async function probeNotify(o, kind){
  const T = await open('/chats', Object.assign({ pre: FAKE_NOTIF_B }, o));
  if(process.env.CLOCK){ const t0 = await T.p.evaluate(() => Date.now()); await T.ctx.clock.setSystemTime(new Date(t0)); }
  await T.p.waitForTimeout(300);
  const DELTA_SLOW = () => T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'wa_conversations' && st.order === 'updated_at') ? 600 : 0; });
  let r = {};
  if(kind === 'noRow'){            // الدلتا رجعت من غير المحادثة = المهلة هي اللي بتطلّعه («عميل»)
    await waIn(T.p, 'cX', 'سلام');
    await T.p.waitForTimeout(900); r.early = await notesOf(T.p);
    await T.p.waitForTimeout(2300); r.end = await notesOf(T.p);
  } else if(kind === 'once'){      // اتبلّغ مع الدلتا · الـpoll والكامل بعده مابيعيدوهوش
    await waIn(T.p, 'cY', 'سلام', { wa: '201066667777', name: 'جديد' });
    await T.p.waitForTimeout(900); r.early = await notesOf(T.p);
    await T.p.evaluate(async () => { const m = await import('/js/inbox/inbox.js'); m.waRefreshConvos(); m.waFetchConvos(false); });
    await T.p.waitForTimeout(3000); r.end = await notesOf(T.p);
  } else if(kind === 'stale'){     // m1 مستنية القايمة والتاب اتخفت ← m2 اتبلّغت على طول = m1 ماتطلعش بعدها (نفس الـtag)
    await DELTA_SLOW();
    await waIn(T.p, 'cY', 'أولى', { wa: '201066667777', name: 'جديد' });
    await T.p.waitForTimeout(100);
    await T.p.evaluate(HIDE('true'));
    await waIn(T.p, 'cY', 'تانية');
    await T.p.waitForTimeout(3300); r.end = await notesOf(T.p);
  } else if(kind === 'two'){       // A مستنية (الدلتا مش بتجيبها) · B جت بعدها بـ1.8ث = B بمهلتها (باسمها) مش بمهلة A
    await DELTA_SLOW();
    await waIn(T.p, 'cA', 'من أ');
    await T.p.waitForTimeout(1800);
    await waIn(T.p, 'cB', 'من ب', { wa: '201088889999', name: 'بي' });
    await T.p.waitForTimeout(2600); r.end = await notesOf(T.p);
  }
  await T.ctx.close(); return r;
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

// ── الجولة الرابعة من المراجعة ────────────────────────────────────────
// 31) شحن يدوي والصدى وصل **قبل** رد الـRPC (الريل-تايم أسرع من رد الـHTTP) = الكروت والدمج مرة واحدة (من applyShipped) مش مرتين
async function probeManualShip(o, v){
  v = v || {};
  // v.fail = الرد رجع خطأ والشحنة اتعملت (الصدى وصل) · v.late = الصدى وصل بعد 21ث من الضغطة (ساعة الصفحة مزحزحة وقت الحدث بس)
  // v.idle = آخر تحديث للكروت من 6 دقايق (شبكة الأمان) · v.after = حدث حقيقي على نفس الأوردر بعد الشحن (طلب إلغاء)
  // v.hang = الرد عمره ما رجع (الصدى اتأجّل) وحدث تاني على نفس الأوردر (awb_print_count — مش عمود كروت) بعد 71ث = اللي اتأجّل رجع معاه
  const T = await open('/orders', Object.assign({ pre: `var _h = window.__RPC_HOOK;
    window.__RPC_HOOK = function(n, a){
      if(n === 'mark_shipped_manual'){ var i = window.__ORDERS.findIndex(function(x){ return x.id === a.p_order_id; });
        window.__ORDERS[i] = Object.assign({}, window.__ORDERS[i], { status: 'bosta_assigned', tracking_no: a.p_tracking, updated_at: new Date().toISOString() });
        if(window.__ORD){ var _dn = Date.now; if(window.__ECHO_LATE) Date.now = function(){ return _dn() + window.__ECHO_LATE; };
          try{ window.__ORD.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, window.__ORDERS[i]), old: { id: a.p_order_id } }); }
          finally{ Date.now = _dn; } }
        if(window.__SHIP_HANG) return { then: function(){} };   // Promise.resolve(thenable) = عمره ما بيرجع
        return window.__SHIP_FAIL ? { data: null, error: { message: 'network' } } : { data: true, error: null }; }
      return _h(n, a);
    };` + (v.fail ? 'window.__SHIP_FAIL = true;' : '') + (v.hang ? 'window.__SHIP_HANG = true;' : '') + (v.late ? 'window.__ECHO_LATE = 45000;' : '') }, o));
  await T.p.evaluate(async () => { window.__ORD = await import('/js/orders/orders.js'); await (await import('/js/orders/detail.js')).openDetail('o3'); });
  await T.p.waitForTimeout(700);
  if(v.idle){ const t0 = await T.p.evaluate(() => Date.now()); await T.ctx.clock.setFixedTime(new Date(t0 + 6 * 60000)); }
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/orders/ship.js')).manualShipFlow());
  await T.p.waitForTimeout(200);
  await T.p.click('#cmodal-ok');
  await T.p.waitForTimeout(2500);
  const d = diff(a, await snap(T.p)); const bd = await badge(T.p, 'o3');
  let d2 = null;
  if(v.after){
    const a2 = await snap(T.p);
    await fireOrder(T.p, 'UPDATE', 'o3', { cancel_requested_at: STAMP(), updated_at: STAMP() });
    d2 = diff(a2, await snap(T.p));
  }
  if(v.hang){
    const a2 = await snap(T.p);
    await T.p.evaluate(() => { const r = window.__ORDERS.filter(x => x.id === 'o3')[0];
      r.awb_print_count = (r.awb_print_count || 0) + 1; r.updated_at = new Date().toISOString();
      const _dn = Date.now; Date.now = function(){ return _dn() + 71000; };
      try{ window.__ORD.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, r), old: { id: 'o3' } }); } finally{ Date.now = _dn; } });
    await T.p.waitForTimeout(1300);
    d2 = diff(a2, await snap(T.p));
  }
  await T.ctx.close(); return { d, bd, d2 };
}
// 32) تغيير جماعي بفلتر والصفحة اللي طلبها في السكة وصدى الأوردرين وصل = صفحة واحدة ودمج واحد
const SET_STATUS_HOOK = `var _h = window.__RPC_HOOK;
    window.__RPC_HOOK = function(n, a){
      if(n === 'set_order_status'){ var i = window.__ORDERS.findIndex(function(x){ return x.id === a.p_order_id; });
        window.__ORDERS[i] = Object.assign({}, window.__ORDERS[i], { status: a.p_status, updated_at: new Date().toISOString() });
        var o = window.__ORDERS[i];
        (window.__JT_ISSUES || []).forEach(function(r){ if(r.tracking_no === o.tracking_no) r.order_status = a.p_status; });
        return { data: [{ at: new Date().toISOString(), to: a.p_status, by: a.p_by }], error: null }; }
      return _h(n, a);
    };`;
async function bulk(p, ids, ns){
  await p.evaluate(async a => { const st = await import('/js/orders/state.js'); a.ids.forEach(id => st.selectedIds.add(id));
    (await import('/js/orders/mutations.js')).doBulkUpdate(a.ns); }, { ids, ns });
  await p.waitForTimeout(200);
  await p.click('#cmodal-ok');
}
async function probeBulk(o, v){
  v = v || {};
  const T = await open('/orders', Object.assign({ pre: SET_STATUS_HOOK + `window.__ORDERS.push(Object.assign({}, window.__ORDERS[1], { id: 'o2b', order_uid: '9022',
    status: 'Out for delivery', phone: '01077770000', tracking_no: 'TRK022' }));` }, o));
  await setFilter(T.p, 'fst', '__operation__');
  const ids = await T.p.evaluate(async () => (await import('/js/orders/state.js')).fil.slice(0, 2).map(x => x.id));
  await T.p.evaluate(() => { window.__TABLE_DELAY = (t, st) => (t === 'orders' && st.from !== undefined) ? 1200 : 0; });
  if(v.idle){ const t0 = await T.p.evaluate(() => Date.now()); await T.ctx.clock.setFixedTime(new Date(t0 + 6 * 60000)); }
  const a = await snap(T.p);
  await bulk(T.p, ids, 'cancelled');
  await T.p.waitForTimeout(150);
  await T.p.evaluate(async ids => { const m = await import('/js/orders/orders.js');
    ids.forEach(id => { const base = window.__ORDERS.filter(x => x.id === id)[0]; m.handleRealtimeChange({ eventType: 'UPDATE', new: Object.assign({}, base), old: { id } }); }); }, ids);
  await T.p.waitForTimeout(2800);
  const d = diff(a, await snap(T.p)); await T.ctx.close(); return { d, ids };
}
// 33) تغيير جماعي على أوردر **برّه الصفحة** ليه استثناء (اتختار من بحث/صفحة تانية — معروف من حدث قبل كده) = الشارة اتحدّثت
async function probeBulkJx(o){
  const T = await open('/orders', Object.assign({ pre: JX_ROWS + `window.__ORDERS.push(Object.assign({}, window.__ORDERS[0], { id: 'zb2', order_uid: '7797', status: 'Exception',
    tracking_no: 'B2', phone: '01055556666', created_at: '2026-01-05T10:00:00.000Z', updated_at: '2026-01-05T10:00:00.000Z' }));` + SET_STATUS_HOOK }, o));
  await T.p.waitForTimeout(500);
  const t = STAMP();
  await fireOrder(T.p, 'UPDATE', 'zb2', { jt_fee_synced_at: t, updated_at: t });   // ختم بس = اتعرف (rtSeen) من غير أي جلب
  const inFil = await T.p.evaluate(async () => (await import('/js/orders/state.js')).fil.some(x => x.id === 'zb2'));
  const s0 = await jxBadgeTxt(T.p);
  await bulk(T.p, ['zb2'], 'cancelled');
  await T.p.waitForTimeout(1600);
  const s1 = await jxBadgeTxt(T.p); await T.ctx.close(); return { s0, s1, inFil };
}

// 34) حفظ المنتجات والإجمالي ماتغيّرش (منتج اتضاف بسعر 0) = مفيش دمج (التنبيه بيعرض الإجمالي) · ضابط: الإجمالي اتغيّر = دمج مرة
const SAVE_HOOK = `window.__ORDERS.filter(function(x){ return x.id === 'o1'; })[0].status = 'BOSTA AUTO';
    var _h = window.__RPC_HOOK;
    window.__RPC_HOOK = function(n, a){
      if(n === 'save_order_products'){ var i = window.__ORDERS.findIndex(function(x){ return x.id === a.p_order_id; });
        window.__ORDERS[i] = Object.assign({}, window.__ORDERS[i], { product_name: a.p_product_name, total_cost: a.p_total_cost == null ? window.__ORDERS[i].total_cost : a.p_total_cost,
          line_prices: a.p_prices, updated_at: new Date().toISOString() });
        window.__SAVED = a;
        return { data: { order: { id: a.p_order_id, product_name: a.p_product_name, total_cost: window.__ORDERS[i].total_cost }, upsell: null }, error: null }; }
      return _h(n, a);
    };`;
async function probeSaveProducts(o, same){
  const T = await open('/orders', Object.assign({ pre: SAVE_HOOK }, o));
  await T.p.evaluate(() => { document.querySelector('#tbody tr[data-id="o1"]').click(); });
  await T.p.waitForSelector('#prod-list .prod-price', { timeout: 8000 });
  await T.p.waitForTimeout(900);
  const a = await snap(T.p);
  if(same){
    await T.p.click('#prod-add'); await T.p.waitForTimeout(200);
    await T.p.selectOption('#prod-list .prod-item:nth-child(2) .prod-select', { index: 1 });
    await T.p.fill('#prod-list .prod-item:nth-child(2) .prod-price', '0');
  } else await T.p.fill('#prod-list .prod-price', '900');
  await T.p.click('#save-prod');
  await T.p.waitForTimeout(1500);
  const d = diff(a, await snap(T.p)); const saved = await T.p.evaluate(() => window.__SAVED || null); await T.ctx.close();
  return { d, total: saved && saved.p_total_cost, name: saved && saved.p_product_name };
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
  ok(r.d.page === 1 && r.bd === 'تم التسليم', '18) الصفحة في السكة وحدث أحدث وصل (وقت الريل-تايم «+00») = الصف من الحدث (مش الـsnapshot القديم) ومن غير جلب تاني — ' + JSON.stringify(r));
}
{
  const r = await probeFlight(undefined, true);
  ok(r.bd === 'تم التسليم', '18هـ) الحدث وصل بعد 16ث من بداية الجلب (نت بطيء) = اتحفظ برضه والصف من الحدث — ' + JSON.stringify(r));
}
{
  const r = await probeStaleEvent();
  ok(r.bd === 'تم التسليم', '18ج) حدث أقدم من الـsnapshot وصل والصفحة في السكة = الـsnapshot الأحدث كسب — ' + JSON.stringify(r));
}
{
  const r = await probeSkeleton();
  ok(!r.mid && r.end.indexOf('o3') >= 0 && r.end.indexOf('o1') < 0, '18د) الفلتر اتغيّر وحدث ختم على صف قديم = الـskeleton فاضل لحد ما الصفحة الجديدة تنزل — ' + JSON.stringify(r));
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
  const d = await probeDetailLate();
  ok(d.merge === 0 && d.stats === 0, '19ج) التفاصيل نزلت بنسخة أقدم من حدث وصل قبلها = مادستش عليه — الصدى التاني «مفيش تغيير» — ' + JSON.stringify(d));
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
  ok(r.d.convDelta + r.d.convFull === 0 && r.d.convRow === 1 && r.has && r.notes.join('|') === '💬 رسالة من جديد', '26) التاب مخفية من 11 دقيقة ورسالة من عميل جديد = صف المحادثة دي بس (مش القايمة) والإشعار باسمه — ' + JSON.stringify(r));
}
{
  const r = await probeHiddenUnknown(undefined, { visible: true });
  ok(r.d.convRow === 0 && r.d.convDelta === 1 && r.has && r.notes.join('|') === '💬 رسالة من جديد',
    '26ب) التاب ظاهرة ورسالة من عميل جديد = الدلتا بس (مفيش طلب تاني للصف) والإشعار بعدها باسمه — ' + JSON.stringify(r));
}
{
  const r = await probeHiddenUnknown(undefined, { burst: 3 });
  ok(r.d.convRow === 1 && r.notes.length === 3, '26ج) رشقة 3 رسايل من عميل جديد والتاب مخفية = طلب واحد للصف و3 إشعارات — ' + JSON.stringify(r));
}
{
  const r = await probeHiddenUnknown(undefined, { notif: 'denied' });
  ok(!r.err && r.d.convRow === 0 && r.d.convDelta + r.d.convFull === 0 && r.notes.length === 0,
    '26د) إذن الإشعارات مرفوض والتاب مخفية = ولا طلب (الصف كان للإشعار بس) — ' + JSON.stringify(r));
}
{
  const r = await probeHiddenUnknown(undefined, { notif: 'none' });
  ok(r.api === false && !r.err && r.d.convRow === 0, '26هـ) المتصفح مافيهوش Notification خالص = مفيش خطأ ولا طلب — ' + JSON.stringify(r));
}
{
  const r = await probeOpenRace();
  ok(r.d.waOrders === 1 && r.name === 'سباق', '25ج) القايمة جابت المحادثة قبل الجلب برقمها = الهيدر واللوحات مرة واحدة (أوردرات العميل مرة) — ' + JSON.stringify(r));
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
  ok(r.s0 === '1' && r.s1 === '0' && r.d.merge === 1 && r.d.jxDelta >= 1, '29ب) الموظف لغى أوردر في الصفحة ليه استثناء والصفحة نزلت قبل الصدى = الدمج والشارة (1 ← 0) اتحدّثوا — ' + JSON.stringify(r));
}
{
  const d = await probeDoUpdateFiltered();
  ok(d.page === 1 && d.merge === 1, '29ج) فلتر شغّال والموظف غيّر الحالة والصدى وصل والصفحة في السكة = صفحة واحدة ودمج واحد (الصدى «مفيش تغيير») — ' + JSON.stringify(d));
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
{
  const r = await probeSkeleton(undefined, 'status');
  ok(!r.early && !r.mid, '18و) الفلتر اتغيّر والصفحة في السكة وحالة صف من الصفحة القديمة اتغيّرت = الـskeleton فاضل (مش رسم القديم فوقه) — ' + JSON.stringify(r));
}
{
  const r = await probeSkeleton(undefined, 'phone');
  ok(!r.mid, '18ز) …وتليفون صف من الصفحة القديمة اتغيّر (عدّ الأرقام رجع والصفحة لسه في السكة) = الـskeleton فاضل — ' + JSON.stringify(r));
}
{
  const r = await probeManualShip();
  ok(r.d.merge === 1 && r.bd === 'شحن', '31) شحن يدوي والصدى قبل رد الـRPC = الدمج والكروت مرة واحدة (مش مرتين) — ' + JSON.stringify(r));
}
{
  const r = await probeBulk();
  ok(r.ids.length === 2 && r.d.page === 1 && r.d.merge === 1, '32) تغيير جماعي بفلتر والصفحة في السكة وصدى الأوردرين وصل = صفحة واحدة ودمج واحد — ' + JSON.stringify(r));
}
{
  const r = await probeBulkJx();
  ok(!r.inFil && r.s0 === '3' && r.s1 === '2', '33) تغيير جماعي على أوردر برّه الصفحة ليه استثناء = الشارة 3 ← 2 (البوليصة من نسخة السيرفر) — ' + JSON.stringify(r));
}

{
  const r = await probeSaveProducts(undefined, true);
  ok(r.total === 1000 && ((r.name || '').match(/\(عدد/g) || []).length === 2 && r.d.merge === 0, '34) حفظ منتجات والإجمالي زي ما هو (منتج اتضاف بـ0) = مفيش دمج — ' + JSON.stringify(r));
  const c = await probeSaveProducts(undefined, false);
  ok(c.total === 900 && c.d.merge === 1, '34ب) ضابط: الإجمالي اتغيّر (1000 ← 900) = الدمج مرة — ' + JSON.stringify(c));
}
{
  const r = await probeNotify(undefined, 'noRow');
  ok(r.early.t.length === 0 && r.end.t.join('|') === '💬 رسالة من عميل', '26و) التاب الظاهرة والدلتا رجعت من غير المحادثة = مفيش إشعار قبل المهلة وإشعار واحد («عميل») بعدها — ' + JSON.stringify(r));
}
{
  const r = await probeNotify(undefined, 'once');
  ok(r.early.t.join('|') === '💬 رسالة من جديد' && r.end.t.length === 1, '26ز) اتبلّغ مع الدلتا · الـpoll والكامل بعده = مفيش إشعار تاني — ' + JSON.stringify(r));
}
{
  const r = await probeNotify(undefined, 'stale');
  ok(r.end.b.length >= 1 && r.end.b[r.end.b.length - 1] === 'تانية', '26ح) رسالة مستنية القايمة والتاب اتخفت ورسالة أحدث اتبلّغت = الأقدم ماطلعتش بعدها (آخر إشعار = الأحدث) — ' + JSON.stringify(r));
}
{
  const r = await probeNotify(undefined, 'two');
  ok(r.end.t.indexOf('💬 رسالة من بي') >= 0 && r.end.t.length === 2, '26ط) محادثتين جداد ورا بعض والأولى مستنية = التانية بمهلتها هي (طلعت باسمها مش «عميل») — ' + JSON.stringify(r));
}
{
  const r = await probeManualShip(undefined, { fail: true });
  ok(r.d.merge === 1, '31ب) الشحن اليدوي رجع خطأ والصدى كان وصل = اللي اتأجّل رجع (الدمج مرة) — ' + JSON.stringify(r));
}
{
  const r = await probeManualShip(undefined, { after: true });
  ok(r.d.merge === 1 && r.d2.merge >= 1 && r.d2.stats >= 1, '31ج) بعد الشحن حدث حقيقي على نفس الأوردر (طلب إلغاء) = الكروت والدمج اتحدّثوا (التوقّع اتشال مع الرد) — ' + JSON.stringify(r));
}
{
  const r = await probeManualShip(undefined, { late: true });
  ok(r.d.merge === 1, '31د) صدى الشحن وصل بعد 45ث من الضغطة (jt-ship ممكن ياخد ~40ث) = اتأجّل برضه (الدمج مرة) — ' + JSON.stringify(r));
}
{
  const r = await probeManualShip(undefined, { idle: true });
  ok(r.d.merge === 1, '31هـ) آخر تحديث للكروت من 6 دقايق والموظف شحن = الدمج مرة (شبكة الأمان ماجابتهمش تاني مع الصدى) — ' + JSON.stringify(r));
}
{
  const r = await probeManualShip(undefined, { hang: true });
  ok(r.d.merge === 0 && r.d2.merge === 1, '31و) رد الشحن عمره ما رجع (الصدى اتأجّل) وحدث تاني على الأوردر بعد 71ث = اللي اتأجّل رجع معاه (الدمج مرة) — ' + JSON.stringify(r));
}
{
  const r = await probeDoUpdate(undefined, { idle: true });
  ok(r.d.merge === 1 && r.d.stats >= 1, '29د) آخر تحديث للكروت من 6 دقايق والموظف غيّر الحالة = الدمج مرة (doUpdate ختم شبكة الأمان) — ' + JSON.stringify(r));
}
{
  const r = await probeBulk(undefined, { idle: true });
  ok(r.d.merge === 1 && r.d.page === 1, '32ب) آخر تحديث للكروت من 6 دقايق وتغيير جماعي = الدمج مرة (doBulkUpdate ختم شبكة الأمان) — ' + JSON.stringify(r));
}


// ── المراجعة الأخيرة ─────────────────────────────────────────────────
const TOAST_REC = () => { window.__TOASTS = []; const t = document.getElementById('toast');
  if(t) new MutationObserver(function(){ window.__TOASTS.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true }); };
// 33) دلتا الشارة وقعت (5xx · timeout) والـsocket شغّال = البوليصة بتركب مع الدلتا الجاية لأي بوليصة (العدّ والـtoast مايضيعوش)
async function probeJxRetry(o){
  const T = await open('/orders', Object.assign({ pre: JX_ROWS }, o));
  await T.p.waitForTimeout(500);
  await T.p.evaluate(TOAST_REC);
  const s0 = await jxBadgeTxt(T.p);
  await T.p.evaluate(() => { const r = Object.assign({}, window.__JT_ISSUES[0], { id: 799, tracking_no: 'B4', event_at: new Date().toISOString() }); window.__JT_ISSUES.push(r); window.__JT_FAIL = true; });
  await jxEvent(T.p, 'B4');
  await T.p.evaluate(() => { window.__JT_FAIL = false; });
  const s1 = await jxBadgeTxt(T.p);
  await jxEvent(T.p, 'B1');
  await T.p.waitForTimeout(400);
  const s2 = await jxBadgeTxt(T.p);
  const r = await T.p.evaluate(() => ({ toasts: window.__TOASTS.join(' | '),
    rode: window.__calls.filter(x => x.table === 'v_jt_issues' && (x.f || []).some(f => f.op === 'in' && f.col === 'tracking_no' && (f.val || []).indexOf('B4') >= 0)).length }));
  await T.ctx.close(); return { s0, s1, s2, toast: /استثناء جديد/.test(r.toasts), rode: r.rode };
}
// 34) استثناء نزل وقت الجولة (أحداث jt_issues بتتطنش وقتها) = الجولة خلصت والشارة اتعدّت كاملة مرة
async function probeJxTour(o){
  const T = await open('/orders', Object.assign({ pre: JX_ROWS }, o));
  await T.p.waitForTimeout(500);
  const s0 = await jxBadgeTxt(T.p);
  await T.p.evaluate(async () => (await import('/js/tour/tour.js')).tourStart());
  await T.p.waitForTimeout(500);
  await T.p.evaluate(() => { const r = Object.assign({}, window.__JT_ISSUES[0], { id: 799, tracking_no: 'B4', event_at: new Date().toISOString() }); window.__JT_ISSUES.push(r); });
  await jxEvent(T.p, 'B4');
  const a = await snap(T.p);
  await T.p.evaluate(async () => (await import('/js/tour/tour.js')).tourFinish());
  await T.p.waitForTimeout(1500);
  const d = diff(a, await snap(T.p)); const s1 = await jxBadgeTxt(T.p);
  await T.ctx.close(); return { s0, s1, jxFull: d.jxFull };
}

{
  const r = await probeJxRetry();
  ok(r.s0 === '3' && r.s1 === '3' && r.s2 === '4' && r.toast && r.rode >= 2, '33) دلتا الشارة وقعت لاستثناء جديد وبعدها حدث على بوليصة تانية = البوليصة ركبت مع الدلتا · الشارة 3 ← 3 ← 4 · toast «استثناء جديد» — ' + JSON.stringify(r));
}
{
  const r = await probeJxTour();
  ok(r.s0 === '3' && r.s1 === '4' && r.jxFull === 1, '34) استثناء نزل وقت الجولة (الحدث اتطنش) = بعد الجولة الشارة اتعدّت كاملة مرة (3 ← 4) — ' + JSON.stringify(r));
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
  [P('orders/orders.js', "  if(ev === 'UPDATE' && pageFlightRows) pageFlightRows[row.id] = row;", '  if(pageFlightRows) need.page = true;')],
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
  [P('orders/mutations.js', 'loadOrdersCards();loadBostaInventoryCard();loadMergeCandidates();rtNoteLightRefresh();doFilter();\n    if(ord.tracking_no) jxNoteOrderChange(ord.tracking_no);\n', 'loadOrdersCards();loadBostaInventoryCard();rtNoteLightRefresh();doFilter();\n')],
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
const ROWCOND = '    if(inboxOpen && document.hidden && willNotify && unknownConv) waFetchConvRow(m.conversation_id, function(){ waNotify(m); });';
await cal('(خ) التاب المخفية مابتجيبش صف المحادثة الجديدة → فحص 26 كان هيقع',
  [P('inbox/inbox.js', ROWCOND, '    if(false) void 0;')],
  probeHiddenUnknown, r => !r.has || r.notes[0] !== '💬 رسالة من جديد');
await cal('(خخ) التاب المخفية بتجيب القايمة (الدلتا ← الكامل بعد 10 دقايق) → فحص 26 كان هيقع',
  [P('inbox/inbox.js', ROWCOND, '    if(inboxOpen && document.hidden && willNotify && unknownConv){ waRefreshConvos(); waNotify(m); }')],
  probeHiddenUnknown, r => r.d.convDelta + r.d.convFull > 0);
await cal('(خ2) الصف بيتجاب في التاب الظاهرة كمان → فحص 26ب كان هيقع',
  [P('inbox/inbox.js', 'if(inboxOpen && document.hidden && willNotify && unknownConv)', 'if(inboxOpen && willNotify && unknownConv)')],
  o => probeHiddenUnknown(o, { visible: true }), r => r.d.convRow > 0);
await cal('(خ3) مفيش منع تكرار للصف → فحص 26ج كان هيقع',
  [P('inbox/inbox.js', '  if(waConvRowFlight[id]){ if(done) waConvRowFlight[id].push(done); return; }\n', '')],
  o => probeHiddenUnknown(o, { burst: 3 }), r => r.d.convRow > 1);
await cal('(خ4) فتح المحادثة بيعيد الهيدر واللوحات بعد ما القايمة سبقت → فحص 25ج كان هيقع',
  [P('inbox/inbox.js', "      if(!row || waActiveId!==id || waHdrPendingId!==id) return;", "      if(!row || waActiveId!==id) return;")],
  probeOpenRace, r => r.d.waOrders > 1);
await cal('(ع2) الـsnapshot بيكسب دايماً (المقارنة اتشالت) → فحص 18 كان هيقع',
  [P('orders/orders.js', '    if(!isNaN(ts) && (isNaN(te) || te <= ts)) continue;', '    if(!isNaN(ts)) continue;')],
  probeFlight, r => r.bd !== 'تم التسليم');
await cal('(ع3) المقارنة بالمقلوب (الأقدم بيكسب) → فحص 18ج كان هيقع',
  [P('orders/orders.js', '    if(!isNaN(ts) && (isNaN(te) || te <= ts)) continue;', '    if(!isNaN(ts) && (isNaN(te) || te >= ts)) continue;')],
  probeStaleEvent, r => r.bd !== 'تم التسليم');
await cal('(ع4) rtTime = Date.parse لوحده (الوقت «+00» من الريل-تايم بيبقى NaN) → فحص 18 كان هيقع',
  [P('orders/orders.js', "  return Date.parse(String(v).trim().replace(' ', 'T').replace(/([+-]\\d{2})$/, '$1:00'));", '  return Date.parse(v);')],
  probeFlight, r => r.bd !== 'تم التسليم');
await cal('(ع5) الـbuffer بحد 15ث تاني → فحص 18هـ كان هيقع',
  [P('orders/orders.js', "  if(ev === 'UPDATE' && pageFlightRows) pageFlightRows[row.id] = row;", "  if(ev === 'UPDATE' && pageFlightRows && Date.now() - pageFlightAt < 15000) pageFlightRows[row.id] = row;")],
  o => probeFlight(o, true), r => r.bd !== 'تم التسليم');
await cal('(ع6) الرسم وقت ما الصفحة في السكة → فحص 18د كان هيقع',
  [P('orders/orders.js', '    if(render && !fetched && !pageInFlight()){', '    if(render && !fetched){')],
  probeSkeleton, r => r.mid);
await cal('(ف2) نسخة أقدم بتدوس على الأحدث في rtSeen → فحص 19ج كان هيقع',
  [P('orders/orders.js', '  if(!isNaN(to) && !isNaN(tn) && tn < to) return;\n', '')],
  probeDetailLate, d => d.merge > 0);
await cal('(طط2) doUpdate مابيحدّثش نسخة السيرفر → فحص 29ج كان هيقع (صفحة/دمج مرتين)',
  [P('orders/mutations.js', '    rtNoteLocalCommit(id, { status: ns });\n', '')],
  probeDoUpdateFiltered, d => d.page > 1 || d.merge > 1);
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

// الجولة الرابعة
await cal('(ب1) الإشعار في التاب الظاهرة مابيستناش القايمة → فحص 26ب كان هيقع («عميل» بدل الاسم)',
  [P('inbox/inbox.js', '    else if(inboxOpen && !document.hidden && willNotify && unknownConv) waNotifyAfterList(m);\n', '')],
  o => probeHiddenUnknown(o, { visible: true }), r => r.notes.join('|') !== '💬 رسالة من جديد');
await cal('(ب2) الدلتا مابتطلّعش الإشعار المستني (المهلة بس) → فحص 26ب كان هيقع',
  [P('inbox/inbox.js', '      renderConvos();\n      waFlushNotify();\n    });', '      renderConvos();\n    });')],
  o => probeHiddenUnknown(o, { visible: true }), r => r.notes.join('|') !== '💬 رسالة من جديد');
await cal('(ب3) الصف بيتجاب من غير إذن الإشعارات → فحص 26د كان هيقع',
  [P('inbox/inbox.js', "    var willNotify = ('Notification' in window) && Notification.permission==='granted';", '    var willNotify = true;')],
  o => probeHiddenUnknown(o, { notif: 'denied' }), r => r.d.convRow > 0);
await cal('(ب4) Notification.permission من غير ما نسأل هو موجود → فحص 26هـ كان هيقع',
  [P('inbox/inbox.js', "    var willNotify = ('Notification' in window) && Notification.permission==='granted';", "    var willNotify = Notification.permission==='granted';")],
  o => probeHiddenUnknown(o, { notif: 'none' }), r => !!r.err);
await cal('(ب5) رسم الجدول على تغيير الحالة وقت ما الصفحة في السكة → فحص 18و كان هيقع',
  [P('orders/orders.js', "      if(!pageInFlight()){ try{ renderTable(); }catch(e){ swallow('handleRealtimeChange/renderTable', e); } }", "      try{ renderTable(); }catch(e){ swallow('handleRealtimeChange/renderTable', e); }")],
  o => probeSkeleton(o, 'status'), r => r.early || r.mid);
await cal('(ب6) رسم الجدول بعد عدّ الأرقام وقت ما الصفحة في السكة → فحص 18ز كان هيقع',
  [P('orders/orders.js', 'if(phs.length) fetchPhoneCounts(phs, function(){ if(pageInFlight()) return; try{', 'if(phs.length) fetchPhoneCounts(phs, function(){ try{')],
  o => probeSkeleton(o, 'phone'), r => r.mid);
await cal('(ب7) الشحن اليدوي مابيستناش الصدى → فحص 31 كان هيقع (الدمج مرتين)',
  [P('orders/ship.js', "      rtExpectLocal(ord.id);\n      sb.rpc('mark_shipped_manual', {", "      sb.rpc('mark_shipped_manual', {")],
  probeManualShip, r => r.d.merge !== 1);
await cal('(ب8) التغيير الجماعي مابيحدّثش نسخة السيرفر → فحص 32 كان هيقع',
  [P('orders/mutations.js', '        var was = rtNoteLocalCommit(oid, { status: ns });', '        var was = null;')],
  probeBulk, r => r.d.page !== 1 || r.d.merge !== 1);
await cal('(ب9) البوليصة من fil/all بس → فحص 33 كان هيقع',
  [P('orders/mutations.js', '        var trk0 = (was && was.tracking_no) || (', '        var trk0 = (')],
  probeBulkJx, r => r.s1 !== '2');

await cal('(ب10) saveProducts بيحمّل الدمج من غير ما الإجمالي يتغيّر → فحص 34 كان هيقع',
  [P('orders/products-editor.js', 'if(sendTotal != null && savedTotal !== prevTotal && MERGE_QUERY_STATUSES.indexOf(ord.status) >= 0) loadMergeCandidates();', 'if(MERGE_QUERY_STATUSES.indexOf(ord.status) >= 0) loadMergeCandidates();')],
  o => probeSaveProducts(o, true), r => r.d.merge !== 0);

// الجولة الخامسة
await cal('(ج1) مفيش مهلة للإشعار المستني → فحص 26و كان هيقع',
  [P('inbox/inbox.js', '  waNotifyTimer=setTimeout(function(){ waNotifyTimer=null; waFlushNotify(next); }, Math.max(0, next-Date.now()));', '  void next;')],
  o => probeNotify(o, 'noRow'), r => r.end.t.length !== 1);
await cal('(ج2) المهلة مابتطلّعش المحادثة المش معروفة → فحص 26و كان هيقع',
  [P('inbox/inbox.js', '    if(waConvById(k) || (upTo && e.due<=upTo)){', '    if(waConvById(k)){')],
  o => probeNotify(o, 'noRow'), r => r.end.t.length !== 1);
await cal('(ج3) المستني مابيتشالش بعد ما يطلع → فحص 26ز كان هيقع (إشعار مع كل رسم)',
  [P('inbox/inbox.js', '{ delete waNotifyPending[k]; waNotify(e.m); }', '{ waNotify(e.m); }'),
   P('inbox/inbox.js', '  if(m && m.conversation_id) delete waNotifyPending[m.conversation_id];\n', '')],
  o => probeNotify(o, 'once'), r => r.end.t.length !== 1);
await cal('(ج4) الإشعار المباشر مابيشيلش المستني → فحص 26ح كان هيقع (الأقدم آخر واحد)',
  [P('inbox/inbox.js', '  if(m && m.conversation_id) delete waNotifyPending[m.conversation_id];\n', '')],
  o => probeNotify(o, 'stale'), r => r.end.b[r.end.b.length - 1] !== 'تانية');
await cal('(ج5) مهلة واحدة للكل (أول ما ترنّ بتطلّع كل المستني) → فحص 26ط كان هيقع',
  [P('inbox/inbox.js', '    if(waConvById(k) || (upTo && e.due<=upTo)){', '    if(waConvById(k) || upTo){')],
  o => probeNotify(o, 'two'), r => r.end.t.indexOf('💬 رسالة من بي') < 0);
await cal('(ج6) الشحن اليدوي اللي فشل مابيرجّعش اللي اتأجّل → فحص 31ب كان هيقع',
  [P('orders/ship.js', '        if(r.error){\n          rtExpectEnd(ord.id, false);\n', '        if(r.error){\n')],
  o => probeManualShip(o, { fail: true }), r => r.d.merge !== 1);
await cal('(ج7) التوقّع مابيتشالش مع الرد → فحص 31ج كان هيقع (حدث حقيقي اتبلع)',
  [P('orders/orders.js', '  if(!e) return;\n  delete rtExpect[id];\n', '  if(!e) return;\n')],
  o => probeManualShip(o, { after: true }), r => !(r.d2.merge >= 1 && r.d2.stats >= 1));
await cal('(ج8) نافذة التوقّع 20ث تاني → فحص 31د كان هيقع (الدمج مرتين)',
  [P('orders/orders.js', 'RT_EXPECT_MS = 70000;', 'RT_EXPECT_MS = 20000;')],
  o => probeManualShip(o, { late: true }), r => r.d.merge !== 1);
await cal('(ج9) تعديل الموظف مابيختمش شبكة الأمان → فحص 31هـ كان هيقع (الدمج مرتين)',
  [P('orders/ship.js', ' loadMergeCandidates(); rtNoteLightRefresh(); doFilter();\n}', ' loadMergeCandidates(); doFilter();\n}')],
  o => probeManualShip(o, { idle: true }), r => r.d.merge !== 1);

// الجولة السادسة
await cal('(ج10) الحدث بعد انتهاء التوقّع مابيرجّعش اللي اتأجّل → فحص 31و كان هيقع',
  [P('orders/orders.js', '    if(ex.light) need.light = true;\n    if(ex.page) need.page = true;\n', '')],
  o => probeManualShip(o, { hang: true }), r => !(r.d2 && r.d2.merge === 1));
await cal('(ج11) نافذة التوقّع 40ث (أقل من jt-ship) → فحص 31د كان هيقع',
  [P('orders/orders.js', 'RT_EXPECT_MS = 70000;', 'RT_EXPECT_MS = 40000;')],
  o => probeManualShip(o, { late: true }), r => r.d.merge !== 1);
await cal('(ج12) doUpdate مابيختمش شبكة الأمان → فحص 29د كان هيقع (الدمج مرتين)',
  [P('orders/mutations.js', 'loadMergeCandidates();rtNoteLightRefresh();doFilter();\n    if(ord.tracking_no)', 'loadMergeCandidates();doFilter();\n    if(ord.tracking_no)')],
  o => probeDoUpdate(o, { idle: true }), r => r.d.merge !== 1);
await cal('(ج13) doBulkUpdate مابيختمش شبكة الأمان → فحص 32ب كان هيقع (الدمج مرتين)',
  [P('orders/mutations.js', '        loadOrdersCards();loadBostaInventoryCard();loadMergeCandidates();rtNoteLightRefresh();doFilter();\n      }', '        loadOrdersCards();loadBostaInventoryCard();loadMergeCandidates();doFilter();\n      }')],
  o => probeBulk(o, { idle: true }), r => r.d.merge !== 1);


// المراجعة الأخيرة
await cal('(ج14) دلتا الشارة اللي وقعت مابتتعادش → فحص 33 كان هيقع (الشارة 3 والـtoast ضاع)',
  [P('exceptions/exceptions.js', 'if(r.error || !r.data){ retryLater(); return; }', 'if(r.error || !r.data){ return; }')],
  o => probeJxRetry(o), r => !(r.s2 === '4' && r.toast));
await cal('(ج15) tourRestore مابيعدّش الشارة → فحص 34 كان هيقع',
  [P('tour/tour.js', "  try{ jxCatchUp(); }catch(e){ swallow('tourRestore/jxCatchUp', e); }", '')],
  o => probeJxTour(o), r => !(r.s1 === '4' && r.jxFull === 1));
await b.close();
console.log(bad ? `\n✗ ${bad} فشل` : '\n✓ كله تمام');
process.exit(bad ? 1 : 0);
