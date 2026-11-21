// ⏰ الجدول + 🧪 ON DEVELOP في شريط البوت (21 نوفمبر — طلب المالك).
//   1) السطر التاني: «⏰ الجدول شغّال: بيشتغل 7م وبيقفل 11ص · الجمعة طول اليوم» + زرارين للأدمن (الجدول · ON DEVELOP) ظاهرين (hit-test)
//   2) ON DEVELOP: الضغطة بتفتح مودال فيه الرقم وتحذير العملاء · الإلغاء = صفر RPC · «شغّل التجربة» = ai_agent_set_dev(true) والشريط بقى dev بالرقم
//   3) وقت التجربة: الزرار الأساسي مقفول (ro) · ضغطته = صفر مودال وصفر ai_agent_set_auto
//   4) قفل التجربة = ai_agent_set_dev(false) والشريط رجع لحالته
//   5) الجدول: الضغطة = مودال «تقفل الجدول؟» · التأكيد = ai_agent_set_schedule(false) والسطر بقى «الجدول مقفول» · وتشغيله تاني = (true)
//   6) الموظف: شايف السطر والحالة ومافيش زراير الجدول/التجربة
//   7) السيرفر من غير الأعمدة الجديدة (42703): الشريط زي ما كان من غير السطر التاني
//   8) التجربة والبوت واقف تلقائي (mode off): «واقف تلقائي»
// المعايرات: (أ) الزرار الأساسي شغّال وقت التجربة → 3 بيقع · (ب) الموظف شايف الزراير → 6 بيقع · (ج) مفيش رجوع للمستوى القديم عند 42703 → 7 بيقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };
const cal = (r, m) => { if (r && r.anchorMissing) { console.log('  ✗ معايرة', m, '— المرساة مالقتش'); bad++; } else ok(r, 'معايرة ' + m); };

const TENANT = 't-test-1';
const now = Date.now();
const iso = (m) => new Date(now - m * 60000).toISOString();
const CONVOS = [];
for (let i = 0; i < 12; i++) {
  CONVOS.push({ id: 'c' + i, tenant_id: TENANT, wa_id: '2010000' + String(1000 + i), customer_name: 'عميل ' + i, customer_phone: '010000' + String(1000 + i),
    last_message_at: iso(i + 1), last_inbound_at: iso(i + 1), last_message_text: 'رسالة ' + i, last_direction: 'in', unread_count: 0, status: 'open',
    labels: [], note: null, ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null, ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null,
    updated_at: iso(600 + i), ai_escalated_at: null, ai_escalation_note: null, ai_hold_at: null });
}
const BASE = { tenant_id: TENANT, mode: 'off', idle_mode: 'off', auto_changed_at: null, auto_changed_by_name: null,
  schedule_on: true, schedule_start: '19:00:00', schedule_end: '11:00:00', schedule_full_dows: [5], dev_mode: false, dev_wa_ids: ['201050005219'] };

async function open(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const settings = [Object.assign({}, BASE, opts.set || {})];
  await ctx.addInitScript(`
    window.__ROLE = ${JSON.stringify(opts.role || 'admin')};
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)}; window.__WA_MSGS = [];
    window.__AI_SETTINGS = ${JSON.stringify(settings)};
    window.__AI_NO_NEW_COLS = ${opts.noNewCols ? 'true' : 'false'};
    window.__FN = function(){ return { ok:true }; };
    window.__RPC_HOOK = function(name, args){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      var s = (window.__AI_SETTINGS || [])[0];
      if(name === 'ai_agent_set_auto'){
        if(window.__ROLE !== 'admin') return { data:{ ok:false, error:'admin_only' }, error:null };
        if(s.dev_mode) return { data:{ ok:false, error:'dev_mode' }, error:null };
        s.mode = args.p_on ? 'auto' : (s.idle_mode === 'off' ? 'off' : 'shadow'); s.auto_changed_at = new Date().toISOString(); s.auto_changed_by_name = 'أدمن الاختبار';
        return { data:{ ok:true, mode:s.mode, by:'أدمن الاختبار' }, error:null };
      }
      if(name === 'ai_agent_set_dev'){
        if(window.__ROLE !== 'admin') return { data:{ ok:false, error:'admin_only' }, error:null };
        if(args.p_on){ s.dev_prev_mode = s.mode; s.dev_mode = true; s.mode = 'auto'; }
        else { s.dev_mode = false; s.mode = s.dev_prev_mode || 'off'; }
        return { data:{ ok:true, dev_mode:s.dev_mode, mode:s.mode, by:'أدمن الاختبار' }, error:null };
      }
      if(name === 'ai_agent_set_schedule'){
        if(window.__ROLE !== 'admin') return { data:{ ok:false, error:'admin_only' }, error:null };
        s.schedule_on = !!args.p_on;
        return { data:{ ok:true, schedule_on:s.schedule_on, mode:s.mode, by:'أدمن الاختبار' }, error:null };
      }
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  let anchorMissing = false;
  if (opts.patch) await ctx.route('**/js/inbox/inbox.js', async r => {
    const res = await r.fetch(); let body = await res.text();
    for (const [a, c] of opts.patch) { const before = body; body = body.replace(a, c); if (body === before) anchorMissing = true; }
    await r.fulfill({ response: res, body });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(350);
  p.__anchorMissing = () => anchorMissing;
  return p;
}
const hit = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); }, sel);
const rpcs = (p, name) => p.evaluate((n) => (window.__calls || []).filter(c => c.rpc === n).map(c => c.args), name);
const bar = (p) => p.evaluate(() => { const e = document.getElementById('wa-ai-bar'); if (!e) return null;
  const sub = e.querySelector('.wa-ai-sub'); const sw = document.getElementById('wa-ai-sw');
  return { cls: e.className, txt: e.textContent, sub: sub ? sub.textContent : null, sw: sw ? sw.textContent : null, swRo: !!sw && sw.classList.contains('ro'),
    sched: !!document.getElementById('wa-ai-sched'), dev: !!document.getElementById('wa-ai-dev') }; });
const modal = (p) => p.evaluate(() => { const m = document.getElementById('cmodal-backdrop'); return !!m && m.style.display === 'flex'; });
const modalTxt = (p) => p.evaluate(() => document.getElementById('cmodal-title').textContent + ' ' + document.getElementById('cmodal-sub').textContent);

async function adminScenario(opts) {
  const p = await open(opts);
  const R = {};
  R.b0 = await bar(p);
  R.schedHit = R.b0 && R.b0.sched ? await hit(p, '#wa-ai-sched') : false;
  R.devHit = R.b0 && R.b0.dev ? await hit(p, '#wa-ai-dev') : false;
  if (R.b0 && R.b0.dev) {
    await p.click('#wa-ai-dev'); await p.waitForTimeout(250);
    R.devModal = await modal(p); R.devModalTxt = await modalTxt(p);
    if (R.devModal) { await p.click('#cmodal-cancel'); await p.waitForTimeout(200); }
    R.devRpcAfterCancel = (await rpcs(p, 'ai_agent_set_dev')).length;
    await p.click('#wa-ai-dev'); await p.waitForTimeout(250);
    await p.click('#cmodal-ok'); await p.waitForTimeout(500);
    R.devRpcOn = await rpcs(p, 'ai_agent_set_dev');
    R.bDev = await bar(p);
    // الزرار الأساسي وقت التجربة
    await p.click('#wa-ai-sw'); await p.waitForTimeout(250);
    R.mainModalInDev = await modal(p);
    if (R.mainModalInDev) { await p.click('#cmodal-ok'); await p.waitForTimeout(400); }
    R.mainRpcInDev = (await rpcs(p, 'ai_agent_set_auto')).length;
    R.toastInDev = await p.evaluate(() => document.getElementById('toast').textContent);
    // قفل التجربة
    await p.click('#wa-ai-dev'); await p.waitForTimeout(250);
    R.devOffTxt = await modalTxt(p);
    await p.click('#cmodal-ok'); await p.waitForTimeout(500);
    R.devRpcOff = await rpcs(p, 'ai_agent_set_dev');
    R.bAfterDev = await bar(p);
    // الجدول
    await p.click('#wa-ai-sched'); await p.waitForTimeout(250);
    R.schedOffTxt = await modalTxt(p);
    await p.click('#cmodal-ok'); await p.waitForTimeout(500);
    R.schedRpc1 = await rpcs(p, 'ai_agent_set_schedule');
    R.bSchedOff = await bar(p);
    await p.click('#wa-ai-sched'); await p.waitForTimeout(250);
    R.schedOnTxt = await modalTxt(p);
    await p.click('#cmodal-ok'); await p.waitForTimeout(500);
    R.schedRpc2 = await rpcs(p, 'ai_agent_set_schedule');
    R.bSchedOn = await bar(p);
  }
  R.anchorMissing = p.__anchorMissing();
  await p.close();
  return R;
}

{
  const A = await adminScenario({});
  ok(A.b0 && /الجدول شغّال/.test(A.b0.sub || '') && /7م/.test(A.b0.sub) && /11ص/.test(A.b0.sub) && /الجمعة طول اليوم/.test(A.b0.sub)
     && A.b0.sched && A.b0.dev && A.schedHit && A.devHit, `1) السطر التاني بالمواعيد + زراير الأدمن ظاهرة (${A.b0 && A.b0.sub})`);
  ok(A.devModal && /ON DEVELOP/.test(A.devModalTxt) && /01050005219/.test(A.devModalTxt) && /العملاء مش هياخدوا/.test(A.devModalTxt) && /أوردر حقيقي/.test(A.devModalTxt)
     && A.devRpcAfterCancel === 0 && A.devRpcOn.length === 1 && A.devRpcOn[0].p_on === true
     && A.bDev && /\bdev\b/.test(A.bDev.cls) && /ON DEVELOP/.test(A.bDev.txt) && /01050005219/.test(A.bDev.txt) && /العملاء مش بياخدوا/.test(A.bDev.txt),
     '2) ON DEVELOP: مودال بالرقم والتحذير · الإلغاء صفر RPC · التأكيد = set_dev(true) والشريط بقى dev بالرقم');
  ok(A.bDev && A.bDev.swRo && !A.mainModalInDev && A.mainRpcInDev === 0 && /اقفل التجربة الأول/.test(A.toastInDev || ''),
     `3) وقت التجربة الزرار الأساسي مقفول: صفر مودال وصفر set_auto (${A.toastInDev})`);
  ok(/تقفل ON DEVELOP/.test(A.devOffTxt || '') && A.devRpcOff.length === 2 && A.devRpcOff[1].p_on === false && A.bAfterDev && !/\bdev\b/.test(A.bAfterDev.cls) && /واقف خالص/.test(A.bAfterDev.txt),
     '4) قفل التجربة = set_dev(false) والشريط رجع «واقف خالص»');
  ok(/تقفل الجدول/.test(A.schedOffTxt || '') && A.schedRpc1.length === 1 && A.schedRpc1[0].p_on === false && /الجدول مقفول/.test(A.bSchedOff.sub || '')
     && /تشغّل الجدول/.test(A.schedOnTxt || '') && /الجمعة/.test(A.schedOnTxt) && A.schedRpc2.length === 2 && A.schedRpc2[1].p_on === true && /الجدول شغّال/.test(A.bSchedOn.sub || ''),
     '5) الجدول: قفل وتشغيل بمودال = set_schedule(false/true) والسطر بيتغيّر');

  const E = await open({ role: 'employee', set: { dev_mode: true, mode: 'auto' } });
  const eb = await bar(E); await E.close();
  ok(eb && /الجدول شغّال/.test(eb.sub || '') && !eb.sched && !eb.dev && /ON DEVELOP/.test(eb.txt) && eb.swRo, '6) الموظف: شايف الجدول وحالة التجربة · مفيش زراير الجدول/التجربة');

  const N = await open({ noNewCols: true });
  const nb = await bar(N); await N.close();
  ok(nb && nb.sub === null && /واقف خالص/.test(nb.txt) && nb.sw === 'OFF', '7) السيرفر من غير الأعمدة الجديدة: الشريط زي ما كان من غير السطر التاني');

  const S = await open({ set: { dev_mode: true, mode: 'off' } });
  const sb_ = await bar(S); await S.close();
  ok(sb_ && /\bdev\b/.test(sb_.cls) && /واقف تلقائي/.test(sb_.txt), '8) التجربة والبوت واقف تلقائي = «واقف تلقائي»');
}
{ const A = await adminScenario({ patch: [["  if(waAi.dev){ toast('وقت ON DEVELOP الزرار ده مقفول — اقفل التجربة الأول','er'); return; }\n", '']] });
  cal(A.anchorMissing ? A : !(!A.mainModalInDev && A.mainRpcInDev === 0), '(أ) الزرار الأساسي شغّال وقت التجربة → 3 بيقع'); }
{ const E = await open({ role: 'employee', patch: [['    if(admin){\n      html+=', '    if(true){\n      html+=']] });
  const eb = await bar(E); const am = E.__anchorMissing(); await E.close();
  cal(am ? { anchorMissing: true } : !!(eb && eb.sched), '(ب) الموظف شايف الزراير → 6 بيقع'); }
{ const N = await open({ noNewCols: true, patch: [["if(r.error.code==='42703' && waAiColsLv>0){ waAiColsLv--; waLoadAiState(); }", '']] });
  const nb = await bar(N); const am = N.__anchorMissing(); await N.close();
  cal(am ? { anchorMissing: true } : nb === null, '(ج) مفيش رجوع للمستوى القديم عند 42703 → 7 بيقع'); }

await b.close();
console.log(bad ? `\n✗ ${bad} وقع` : '\n✓ كله عدّى');
process.exit(bad ? 1 : 0);
