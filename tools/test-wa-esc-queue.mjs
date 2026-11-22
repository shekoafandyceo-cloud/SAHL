// طابور التصعيد (v89 — البند 4 من برنامج المالك · 23 نوفمبر): التأخير بوقت الشغل · «🔁» · «✅ اتحلت / 🚫 مالهاش لازمة» · التنبيه في اللوحة.
//   ن) منطق نقي (esc-queue.js من غير متصفح): وقت الشغل = برّه جدول البوت · الجمعة · الصيفي · الجمع العربي · نص «🔁» · ملخص الصبح
//   1) الشريحة «🚩 تصعيد (5 · ⚠️3)» — المتأخر بس (ساعة شغل من غير رد) مش القديم بالساعة · الشارة ⚠3 على زرار «المحادثات»
//   2) toast واحد للمتأخر — بعد ما استعلام المتصعّد ينزل (من غيره toast لأحدث 200 وبعدين تاني للباقي) · «اتشاف» على الجهاز
//   3) سطور الصفوف: «⚠️ متأخرة …» / «⏰ مستنية من …» · «🔁 المرة التانية/التالتة»
//   4) البانر: متأخرة + «🔁 … آخر رد: ebrahim «…»» · الزرارين ظاهرين (hit-test) · reopen بيقول «اتقفلت قبلها»
//   5) «🚫 مالهاش لازمة» = wa_ai_escalation_close(id, 'no_action') والعدّاد والشارة نقصوا
//   6) نفس الجهاز تاني = مفيش toast تاني للي اتشاف
//   7) السيرفر قبل v89 (PGRST202) = الزرار بيرجع لـwa_ai_escalation_dismiss
//   8) ملخص الصبح: 11:05 = toast «🌅 … وانتو مش موجودين» مرة في اليوم · 10:30 (قبل الشغل) = مفيش · 12:15 (بعد أول ساعة) = «متأخرة» بس
//   9) صفحة تانية (الأوردرات): الشارة من استعلام المتصعّد لوحده · وبعد ما الوقت يعدّي (tick كل دقيقة) المتأخر الجديد بيبان + toast
//  10) السيرفر من غير ai_esc_info (42703) = الاستعلام بيرجع من غيره والشارة شغّالة · الموظف كمان شايف الشارة
//  11) رسالة واردة والصندوق مقفول = عدّاد غير المقروء بس — المتصعّد مابيتجابش تاني قبل 5 دقايق (Egress)
// المعايرات (بحارس المرساة — درس 47 · المرساة المفقودة = فشل — درس 56): (أ) التأخير بالساعة مش بوقت الشغل → 8 · (ب) مفيش «اتشاف» → 6 ·
//   (ج) الشريحة من غير المتأخر → 1 · (د) «مالهاش لازمة» بتبعت resolved → 5 · (هـ) مفيش رجوع لـdismiss → 7 · (و) مفيش استعلام في الصفحات التانية → 9 ·
//   (ز) التنبيه قبل ما المتصعّد كله ينزل → 2 · (ح) offset القاهرة ثابت (الصيفي) → ن · (ط) كل رسالة بتجيب المتصعّد → 11
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';
const EQ_SRC = fs.readFileSync(new URL('../app/js/inbox/esc-queue.js', import.meta.url), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };
const cal = (r, m) => { if (r && r.anchorMissing) { console.log('  ✗ معايرة', m, '— المرساة مالقتش'); bad++; } else ok(!!r, 'معايرة ' + m); };

// ── ن) المنطق النقي ──
async function loadEq(patch) {
  let src = EQ_SRC, miss = false;
  for (const [a, c] of (patch || [])) { const before = src; src = src.replace(a, c); if (src === before) miss = true; }
  const fmt = new URL('../app/js/core/format.js', import.meta.url).href;
  src = src.replace("from '../core/format.js'", "from '" + fmt + "'");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'escq-')), 'esc-queue.mjs');
  fs.writeFileSync(f, src);
  const m = await import(f);
  return Object.assign({}, m, { __miss: miss });   // الـnamespace نفسه مش extensible
}
const SCHED = { on: true, start: '19:00:00', end: '11:00:00', full: [5] };
const Z = (s) => Date.parse(s);
{
  const q = await loadEq();
  const st = (at, now, sc) => q.escLate({ ai_escalated_at: at }, Z(now), sc === undefined ? SCHED : sc);
  ok(st('2026-11-23T00:00:00Z', '2026-11-23T08:59:00Z').mins === 0 && st('2026-11-23T00:00:00Z', '2026-11-23T08:59:00Z').level === 'ok',
     'ن1) تصعيد 2 الفجر الساعة 10:59 الصبح = صفر دقايق شغل (مش متأخر)');
  ok(st('2026-11-23T00:00:00Z', '2026-11-23T10:00:00Z').level === 'late' && st('2026-11-23T00:00:00Z', '2026-11-23T12:00:00Z').level === 'late2',
     'ن2) 12 الضهر = ساعة شغل = متأخرة · 2 الضهر = 3 ساعات = تذكير');
  ok(q.escStaffMinutes('2026-11-26T18:00:00Z', Z('2026-11-28T09:30:00Z'), SCHED) === 30, 'ن3) الخميس 8م → السبت 11:30ص = 30 دقيقة (الجمعة البوت طول اليوم)');
  const sw = q.staffWindows('2026-07-15', SCHED), ww = q.staffWindows('2026-11-23', SCHED);
  ok(sw.length === 1 && new Date(sw[0][0]).toISOString() === '2026-07-15T08:00:00.000Z' && new Date(ww[0][0]).toISOString() === '2026-11-23T09:00:00.000Z',
     'ن4) الصيفي: 11ص القاهرة = 08:00Z في يوليو و09:00Z في نوفمبر');
  ok(q.staffWindows('2026-11-27', SCHED).length === 0 && q.staffWindows('2026-11-23', { on: false }).length === 1 && q.staffWindows('2026-11-27', null).length === 0,
     'ن5) الجمعة مفيش شغل · الجدول مقفول/مش معروف = 11ص → 7م والجمعة إجازة');
  const ago = [0, 1, 2, 5, 11, 60, 120, 180, 700, 1440, 2880, 4320, 20000].map(q.escAgoAr).join('|');
  ok(ago === 'دلوقتي|دقيقة|دقيقتين|5 دقايق|11 دقيقة|ساعة|ساعتين|3 ساعات|11 ساعة|يوم|يومين|3 أيام|13 يوم', 'ن6) الجمع العربي (' + ago + ')');
  const now = Z('2026-11-23T10:30:00Z');
  const r1 = q.escRepeatText({ repeat: 2, kind: 'bot', prev: { at: '2026-11-22T15:00:00Z', kind: 'staff_reply', by: 'ebrahim', msg: 'هيتم التواصل مع حضرتك' } }, now);
  const r2 = q.escRepeatText({ repeat: 3, kind: 'reopen', prev: { at: '2026-11-23T08:00:00Z', kind: 'staff_reply', by: 'shekoz', msg: 'x' } }, now);
  const r3 = q.escRepeatText({ repeat: 2, kind: 'bot', prev: { at: '2026-11-23T08:00:00Z', kind: 'no_action', by: 'shekoz' } }, now);
  ok(r1 === '🔁 المرة التانية — آخر رد: ebrahim «هيتم التواصل مع حضرتك» · من 19 ساعة' && r2 === '🔁 المرة التالتة — اتقفلت قبلها · من ساعتين'
     && r3 === '🔁 المرة التانية — shekoz علّمها «مالهاش لازمة» · من ساعتين' && q.escRepeatText({ repeat: 1 }) === '' && q.escRepeatText(null) === '',
     'ن7) نص «🔁»: آخر رد · reopen · «مالهاش لازمة» · المرة الأولى = مفيش');
  // امبارح 5م (وقت شغل) مابيتعدّش · 2 الفجر بيتعدّ · 11:30 (بعد ما الشغل بدأ) مابيتعدّش
  const nc1 = q.escNightCount([{ ai_escalated_at: '2026-11-22T15:00:00Z' }, { ai_escalated_at: '2026-11-23T00:00:00Z' }, { ai_escalated_at: '2026-11-23T09:30:00Z' }], Z('2026-11-23T09:40:00Z'), SCHED);
  const nc2 = q.escNightCount([{ ai_escalated_at: '2026-11-23T00:00:00Z' }], Z('2026-11-23T08:40:00Z'), SCHED);
  const nc3 = q.escNightCount([{ ai_escalated_at: '2026-11-23T00:00:00Z' }], Z('2026-11-23T16:00:00Z'), SCHED);   // 6م القاهرة
  // السبت: الجمعة كلها (البوت طول اليوم) بتدخل في الملخص — من الخميس 7م
  const nc4 = q.escNightCount([{ ai_escalated_at: '2026-11-26T17:30:00Z' }, { ai_escalated_at: '2026-11-27T12:00:00Z' }, { ai_escalated_at: '2026-11-26T16:30:00Z' }], Z('2026-11-28T09:10:00Z'), SCHED);
  ok(nc1.inWindow && nc1.n === 1 && nc1.since === 40 && !nc2.inWindow && nc3.inWindow && nc3.since === 420 && nc4.n === 2 && nc4.since === 10,
     `ن8) ملخص الصبح: جوّه وقت الشغل بس · اللي اتصعّد والموظفين مش موجودين بس · الجمعة في ملخص السبت (${nc1.n}/${nc1.since} · ${nc4.n})`);
  // (ح) offset ثابت = الصيفي بيبوظ
  const qh = await loadEq([["return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN_MS);", 'return 120;']]);
  const swh = qh.staffWindows('2026-07-15', SCHED);
  cal(qh.__miss ? { anchorMissing: true } : new Date(swh[0][0]).toISOString() !== '2026-07-15T08:00:00.000Z', '(ح) offset القاهرة ثابت → ن4 بيقع');
}

// ── المتصفح ──
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const TENANT = 't-test-1';
const T_NOON = '2026-11-23T10:30:00Z';   // الاتنين 12:30 الضهر القاهرة
function convos(spec) {
  const out = [];
  for (let i = 0; i < 230; i++) {
    out.push({ id: 'n' + i, tenant_id: TENANT, wa_id: '20100' + String(100000 + i), customer_name: 'عميل ' + i, customer_phone: '010' + String(10000000 + i),
      last_message_at: new Date(Z('2026-11-23T10:29:00Z') - i * 60000).toISOString(), last_inbound_at: new Date(Z('2026-11-23T10:29:00Z') - i * 60000).toISOString(),
      last_message_text: 'رسالة ' + i, last_direction: 'in', unread_count: 0, status: 'open', labels: [], note: null,
      ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null, ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null,
      updated_at: '2026-11-20T10:00:00Z', ai_escalated_at: null, ai_escalation_note: null, ai_hold_at: null, ai_esc_info: null });
  }
  for (const s of spec) Object.assign(out[s.i], s.row);
  return out;
}
const FULL = convos([
  { i: 3, row: { id: 'cA', customer_name: 'عميل A', ai_escalated_at: '2026-11-23T00:00:00.000Z', ai_escalation_note: 'سأل عن الشحن لأسوان' } },
  { i: 5, row: { id: 'cC', customer_name: 'عميل C', ai_escalated_at: '2026-11-23T07:00:00.000Z', ai_escalation_note: 'مش فاهم التركيب',
      ai_esc_info: { repeat: 2, kind: 'bot', prev: { at: '2026-11-22T15:00:00Z', kind: 'staff_reply', by: 'ebrahim', msg: 'هيتم التواصل مع حضرتك' } } } },
  { i: 7, row: { id: 'cB', customer_name: 'عميل B', ai_escalated_at: '2026-11-23T10:00:00.000Z', ai_escalation_note: 'عايز يعرف المقاسات' } },
  { i: 9, row: { id: 'cE', customer_name: 'عميل E', ai_escalated_at: '2026-11-23T09:45:00.000Z', ai_escalation_note: '🔁 العميل كتب تاني بعد رد shekoz: «تمام هنكلمك»',
      ai_esc_info: { repeat: 3, kind: 'reopen', prev: { at: '2026-11-23T08:00:00Z', kind: 'staff_reply', by: 'shekoz', msg: 'تمام هنكلمك' } } } },
  // بره أحدث 200: بيتشاف من استعلام المتصعّد بس
  { i: 220, row: { id: 'cD', customer_name: 'د. وحيد', ai_escalated_at: '2026-11-22T13:00:00.000Z', ai_escalation_note: 'عايز استبدال المقاس' } },
]);
const NIGHT = convos([
  { i: 2, row: { id: 'cA', customer_name: 'عميل A', ai_escalated_at: '2026-11-23T00:00:00.000Z', ai_escalation_note: 'سؤال بالليل' } },
  { i: 4, row: { id: 'cF', customer_name: 'عميل F', ai_escalated_at: '2026-11-23T02:00:00.000Z', ai_escalation_note: 'سؤال تاني بالليل' } },
]);
const SETTINGS = [{ tenant_id: TENANT, mode: 'off', idle_mode: 'off', auto_changed_at: null, auto_changed_by_name: null,
  schedule_on: true, schedule_start: '19:00:00', schedule_end: '11:00:00', schedule_full_dows: [5], dev_mode: false, dev_wa_ids: [] }];

async function newCtx(opts) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.clock.setFixedTime(new Date(opts.T || T_NOON));
  await ctx.addInitScript(`
    window.__ROLE = ${JSON.stringify(opts.role || 'admin')};
    window.__WA_CONVOS = ${JSON.stringify(opts.convos || FULL)}; window.__WA_MSGS = [];
    window.__AI_SETTINGS = ${JSON.stringify(SETTINGS)};
    window.__ESC_NO_INFO = ${opts.noInfo ? 'true' : 'false'};
    window.__TABLE_DELAY = function(t, st){ return (t === 'wa_conversations' && st.not && st.not.col === 'ai_escalated_at') ? 900 : 0; };
    window.__RPC_HOOK = function(name, args){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      if(name === 'wa_ai_escalation_close' && ${opts.noClose ? 'true' : 'false'}) return { data:null, error:{ code:'PGRST202', message:'Could not find the function' } };
      if(name === 'wa_ai_escalation_close' || name === 'wa_ai_escalation_dismiss'){
        (window.__WA_CONVOS || []).forEach(function(c){ if(c.id === args.p_conversation_id){ c.ai_escalated_at = null; c.ai_escalation_note = null; c.ai_esc_info = null; c.updated_at = new Date(Date.now() + 1000).toISOString(); } });
        return { data:{ ok:true, cleared:1 }, error:null };
      }
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  ctx.__miss = false;
  if (opts.patch) await ctx.route('**/js/inbox/*.js', async r => {
    const res = await r.fetch(); let body = await res.text();
    const file = r.request().url().split('/').pop().split('?')[0];
    for (const [f, a, c] of opts.patch) { if (f !== file) continue; const before = body; body = body.replace(a, c); if (body === before) ctx.__miss = true; }
    await r.fulfill({ response: res, body });
  });
  return ctx;
}
async function openPage(ctx, where) {
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + (where || '/chats'), { waitUntil: 'networkidle' });
  if ((where || '/chats') === '/chats') await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(1500);
  return p;
}
const chip = (p) => p.evaluate(() => { const e = document.getElementById('wa-filter-esc'); return e ? { t: e.textContent, late: e.classList.contains('has-late') } : null; });
const navEsc = (p) => p.evaluate(() => { const e = document.getElementById('wa-nav-esc'); return e && e.style.display !== 'none' ? e.textContent : ''; });
const toastTxt = (p) => p.evaluate(() => { const t = document.getElementById('toast'); return t && /show/.test(t.className) ? t.textContent : ''; });
const seenN = (p) => p.evaluate(() => { try{ return JSON.parse(localStorage.getItem('sahl_esc_seen_u1') || '[]').length; }catch(e){ return -1; } });
const rpcs = (p, n) => p.evaluate((x) => (window.__calls || []).filter(c => c.rpc === x).map(c => c.args), n);
const hit = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); }, sel);

async function inboxScenario(opts) {
  const ctx = await newCtx(opts || {});
  const p = await openPage(ctx);
  const R = {};
  R.chip = await chip(p); R.nav = await navEsc(p); R.toast = await toastTxt(p); R.seen = await seenN(p);
  await p.click('#wa-filter-esc'); await p.waitForTimeout(400);
  R.ids = await p.evaluate(() => Array.from(document.querySelectorAll('#wa-list-body .wa-conv')).map(r => r.getAttribute('data-id')).join(','));
  R.lines = await p.evaluate(() => { const o = {}; document.querySelectorAll('#wa-list-body .wa-conv').forEach(r => {
    const w = r.querySelector('.wa-conv-escw'); o[r.getAttribute('data-id')] = w ? { t: w.textContent, late: w.classList.contains('late') } : null; }); return o; });
  await p.click('.wa-conv[data-id="cC"]'); await p.waitForTimeout(400);
  R.banC = await p.evaluate(() => { const e = document.getElementById('wa-esc-banner'); return e ? { t: e.textContent, late: e.classList.contains('late') } : null; });
  R.btnHit = (await hit(p, '#wa-esc-solved')) && (await hit(p, '#wa-esc-noact'));
  await p.click('#wa-esc-noact'); await p.waitForTimeout(600);
  R.close = await rpcs(p, 'wa_ai_escalation_close'); R.dismiss = await rpcs(p, 'wa_ai_escalation_dismiss');
  R.chip2 = await chip(p); R.nav2 = await navEsc(p); R.toast2 = await toastTxt(p); R.banGone = await p.evaluate(() => !document.getElementById('wa-esc-banner'));
  await p.click('.wa-conv[data-id="cE"]'); await p.waitForTimeout(400);
  R.banE = await p.evaluate(() => { const e = document.getElementById('wa-esc-banner'); return e ? { t: e.textContent, late: e.classList.contains('late') } : null; });
  // نفس الجهاز تاني (نفس الـlocalStorage) — مفيش toast للي اتشاف
  const p2 = await openPage(ctx);
  R.toastAgain = await toastTxt(p2);
  R.anchorMissing = ctx.__miss;
  await ctx.close();
  return R;
}
async function morningScenario(T, patch) {
  const ctx = await newCtx({ T, convos: NIGHT, patch });
  const p = await openPage(ctx);
  const R = { toast: await toastTxt(p), key: await p.evaluate(() => localStorage.getItem('sahl_esc_morning_u1')), chip: await chip(p) };
  const p2 = await openPage(ctx);
  R.toastAgain = await toastTxt(p2);
  R.anchorMissing = ctx.__miss;
  await ctx.close();
  return R;
}
async function ordersScenario(opts) {
  const ctx = await newCtx(opts || {});
  const p = await openPage(ctx, '/orders');
  const R = { nav: await navEsc(p), toast: await toastTxt(p) };
  R.q = await p.evaluate(() => (window.__calls || []).filter(c => c.table === 'wa_conversations' && c.not && c.not.col === 'ai_escalated_at').map(c => String(c.cols || '')));
  if (opts && opts.fireMsg) {
    // رسالة واردة والصندوق مقفول: عدّاد غير المقروء بيتجاب — المتصعّد لأ (آخر جلب من أقل من 5 دقايق)
    R.fired = await p.evaluate(() => {
      const h = (window.__RT_ON || []).filter(x => x.opts && x.opts.table === 'wa_messages');
      h.forEach(x => x.cb({ eventType: 'INSERT', new: { id: 'm-new', conversation_id: 'cB', direction: 'in', type: 'text', body: 'ألو' }, old: {} }));
      return h.length;
    });
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => (window.__calls || []).filter(c => c.table === 'wa_conversations'));
    R.escAfter = after.filter(c => c.not && c.not.col === 'ai_escalated_at').length;
    R.unreadAfter = after.filter(c => String(c.cols || '') === 'unread_count').length;
  }
  if (opts && opts.advance) {
    await ctx.clock.setFixedTime(new Date('2026-11-23T11:05:00Z'));   // 1:05 الضهر — B وE بقوا متأخرين
    await p.waitForTimeout(62000);   // الـtick كل دقيقة
    R.nav2 = await navEsc(p); R.toast2 = await toastTxt(p);
  }
  R.anchorMissing = ctx.__miss;
  await ctx.close();
  return R;
}

{
  const R = await inboxScenario();
  ok(R.chip && R.chip.t === '🚩 تصعيد (5 · ⚠️3)' && R.chip.late && R.nav === '⚠3', `1) الشريحة والشارة: المتأخر بوقت الشغل بس (${R.chip && R.chip.t} · ${R.nav})`);
  ok(/^⏰ 3 محادثات متصعّدة متأخرة — أقدمها د\. وحيد من/.test(R.toast) && R.seen === 3, `2) toast واحد بعد ما المتصعّد كله نزل · «اتشاف» 3 (${R.toast} · ${R.seen})`);
  ok(R.ids === 'cD,cA,cC,cE,cB', '3أ) الفلتر: الأقدم تصعيداً فوق (' + R.ids + ')');
  const L = R.lines || {};
  ok(L.cD && L.cD.late && L.cD.t === '⚠️ متأخرة — 5 ساعات في وقت الشغل من غير رد' && L.cA && L.cA.late && L.cA.t === '⚠️ متأخرة — ساعة في وقت الشغل من غير رد'
     && L.cB && !L.cB.late && L.cB.t === '⏰ مستنية من 30 دقيقة', '3ب) سطر الانتظار: متأخرة بوقت الشغل / مستنية من (' + (L.cB && L.cB.t) + ')');
  ok(L.cC && L.cC.t.indexOf('🔁 المرة التانية') > 0 && L.cE && !L.cE.late && L.cE.t.indexOf('🔁 المرة التالتة') > 0, '3ج) «🔁 المرة التانية/التالتة» على الصف');
  ok(R.banC && R.banC.late && R.banC.t.indexOf('⚠️ متأخرة — ساعة في وقت الشغل من غير رد') >= 0
     && R.banC.t.indexOf('🔁 المرة التانية — آخر رد: ebrahim «هيتم التواصل مع حضرتك» · من 19 ساعة') >= 0 && R.btnHit, '4أ) البانر: متأخرة + آخر رد · الزرارين ظاهرين');
  ok(R.banE && !R.banE.late && R.banE.t.indexOf('🔁 المرة التالتة — اتقفلت قبلها · من ساعتين') >= 0, '4ب) reopen: «اتقفلت قبلها» (السبب فيه مين رد)');
  ok(R.close.length === 1 && R.close[0].p_conversation_id === 'cC' && R.close[0].p_kind === 'no_action' && R.dismiss.length === 0
     && R.chip2 && R.chip2.t === '🚩 تصعيد (4 · ⚠️2)' && R.nav2 === '⚠2' && /مالهاش لازمة/.test(R.toast2) && R.banGone,
     `5) «🚫 مالهاش لازمة» = close(cC, no_action) والعدّاد والشارة نقصوا (${R.chip2 && R.chip2.t} · ${R.nav2})`);
  ok(!/متأخرة/.test(R.toastAgain), '6) نفس الجهاز تاني = مفيش toast للي اتشاف (' + (R.toastAgain || 'مفيش') + ')');
}
{
  const R = await inboxScenario({ noClose: true });
  ok(R.close.length === 1 && R.dismiss.length === 1 && R.dismiss[0].p_conversation_id === 'cC' && R.chip2 && R.chip2.t === '🚩 تصعيد (4 · ⚠️2)',
     '7) السيرفر قبل v89 (PGRST202) = رجوع لـwa_ai_escalation_dismiss');
}
{
  const M = await morningScenario('2026-11-23T09:05:00Z');
  ok(/^🌅 البوت صعّد 2 محادثات وانتو مش موجودين ولسه مستنية/.test(M.toast) && M.key === '2026-11-23' && !/🌅/.test(M.toastAgain) && M.chip && M.chip.t === '🚩 تصعيد (2)',
     `8أ) ملخص الصبح 11:05 مرة في اليوم (${M.toast})`);
  const E = await morningScenario('2026-11-23T08:30:00Z');
  ok(!/🌅/.test(E.toast) && E.key === null, '8ب) 10:30 (قبل الشغل) = مفيش ملخص');
  const L = await morningScenario('2026-11-23T10:15:00Z');
  ok(!/🌅/.test(L.toast) && /^⚠️ 2 محادثات متصعّدة متأخرة/.test(L.toast) && L.key === null && !/🌅|متأخرة/.test(L.toastAgain),
     `8ج) 12:15 (بعد أول ساعة): تنبيه «متأخرة» بس — الملخص كان هيكرره (${L.toast})`);
}
{
  const O = await ordersScenario({ advance: true });
  ok(O.nav === '⚠3' && /^⏰ 3 محادثات متصعّدة متأخرة/.test(O.toast) && O.q.length >= 1 && O.q.every(c => c.indexOf('ai_esc_info') >= 0 && c !== '*'),
     `9أ) صفحة الأوردرات: الشارة من استعلام المتصعّد بس (${O.nav} · ${O.q.length} استعلام)`);
  ok(O.nav2 === '⚠5' && /^⚠️ 2 محادثات متصعّدة متأخرة — أقدمها عميل E/.test(O.toast2), `9ب) بعد ما الوقت عدّى (الـtick): ⚠5 + toast للجداد (${O.nav2} · ${O.toast2})`);
  const N = await ordersScenario({ noInfo: true });
  ok(N.nav === '⚠3' && N.q.length === 2 && N.q[0].indexOf('ai_esc_info') >= 0 && N.q[1].indexOf('ai_esc_info') < 0, '10أ) من غير ai_esc_info (42703): الاستعلام رجع من غيره والشارة شغّالة');
  const Em = await ordersScenario({ role: 'employee' });
  ok(Em.nav === '⚠3', '10ب) الموظف شايف الشارة');
  const F = await ordersScenario({ fireMsg: true });
  ok(F.fired >= 1 && F.escAfter === F.q.length && F.unreadAfter >= 2,
     `11) رسالة واردة والصندوق مقفول: عدّاد غير المقروء اتجاب والمتصعّد لأ (Egress — ${F.q.length} → ${F.escAfter} · unread ${F.unreadAfter})`);
}
// المعايرات
{ const M = await morningScenario('2026-11-23T09:05:00Z', [['esc-queue.js', 'var mins = escStaffMinutes(c.ai_escalated_at, now, sched);', 'var mins = Math.floor((now - at) / MIN_MS);']]);
  cal(M.anchorMissing ? M : !/^🌅/.test(M.toast), '(أ) التأخير بالساعة → 8أ بيقع (' + M.toast + ')'); }
{ const R = await inboxScenario({ patch: [['inbox.js', 'if(!seen[key]) fresh.push({c:c, st:st, key:key});', 'fresh.push({c:c, st:st, key:key});']] });
  cal(R.anchorMissing ? R : /متأخرة/.test(R.toastAgain), '(ب) مفيش «اتشاف» → 6 بيقع'); }
{ const R = await inboxScenario({ patch: [['inbox.js', "(lateCount>0?(' · ⚠️'+lateCount):'')", "''"]] });
  cal(R.anchorMissing ? R : !(R.chip && R.chip.t === '🚩 تصعيد (5 · ⚠️3)'), '(ج) الشريحة من غير المتأخر → 1 بيقع'); }
{ const R = await inboxScenario({ patch: [['inbox.js', "waEscClose('no_action')", "waEscClose('resolved')"]] });
  cal(R.anchorMissing ? R : !(R.close[0] && R.close[0].p_kind === 'no_action'), '(د) «مالهاش لازمة» بتبعت resolved → 5 بيقع'); }
{ const R = await inboxScenario({ noClose: true, patch: [['inbox.js', "{ legacy=true; return sb.rpc('wa_ai_escalation_dismiss',{p_conversation_id:id}); }", "{ legacy=true; }"]] });
  cal(R.anchorMissing ? R : R.dismiss.length === 0, '(هـ) مفيش رجوع لـdismiss → 7 بيقع'); }
{ const O = await ordersScenario({ patch: [['inbox.js', '  if(waInboxShown() || !waEscOk) return;', '  return;']] });
  cal(O.anchorMissing ? O : O.nav !== '⚠3', '(و) مفيش استعلام في الصفحات التانية → 9أ بيقع (' + (O.nav || 'مفيش') + ')'); }
{ const F = await ordersScenario({ fireMsg: true, patch: [['inbox.js', 'waRefreshNavBadge(true);', 'waRefreshNavBadge();']] });
  cal(F.anchorMissing ? F : F.escAfter > F.q.length, '(ط) كل رسالة واردة بتجيب المتصعّد → 11 بيقع (' + F.q.length + ' → ' + F.escAfter + ')'); }
{ const R = await inboxScenario({ patch: [['inbox.js', 'var lateCount=waEscEval(waEscAllRows(), null, !waEscLoaded);', 'var lateCount=waEscEval(waEscAllRows(), null, false);']] });
  cal(R.anchorMissing ? R : !/^⏰ 3 محادثات متصعّدة متأخرة/.test(R.toast), '(ز) التنبيه قبل ما المتصعّد كله ينزل → 2 بيقع (' + R.toast + ')'); }

await b.close();
console.log(bad ? `\n✗ ${bad} وقع` : '\n✓ كله عدّى');
process.exit(bad ? 1 : 0);
