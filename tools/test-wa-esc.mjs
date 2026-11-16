// «🚩 تصعيد» + زرار البوت ON/OFF في المحادثات (v86 — 16 نوفمبر، طلب المالك).
//   1) الشريحة «🚩 تصعيد (N)» بعد «غير مقروءة» على طول · العدّاد بيضم المتصعّد الأقدم من أحدث 200 (استعلام سيرفر) · ظاهرة (hit-test)
//   2) الفلتر: المتصعّد بس · الأقدم تصعيداً فوق · سطر السبب تحت كل صف · المحادثة اللي بره الـ200 موجودة
//   3) بانر السبب فوق الشات المفتوح · السبب متهرّب (XSS)
//   4) موظف رد = المحادثة بتتشال من «تصعيد» (حتى اللي بره الـ200) والعدّاد بينقص والبانر بيختفي
//   5) «✓ اتعاملت» = RPC برقم المحادثة · بتتشال من غير رسالة
//   6) زرار البوت للأدمن: مقفول → مودال → «شغّله» = ai_agent_set_auto(true) والشريط بقى ON · إلغاء المودال = صفر RPC · والقفل بنفس الشكل
//   7) الموظف: شايف الحالة · الضغطة مابتفتحش مودال ومابتناديش RPC
//   8) السيرفر من غير الأعمدة (42703): مفيش شريحة ومفيش شريط · والقايمة شغّالة
//   9) الـAgent مش متفعّل (مفيش صف / mode=off) = مفيش شريط
//  10) استعلام المتصعّد مرة عند الفتح — مش مع كل تحديث للقايمة (Egress)
//  11) رسالة البوت في الشات باسم «🤖 AI Agent»
// المعايرات (بحارس المرساة — درس 47): (أ) الفلتر على المحمّل بس → 1 · (ب) النسخة القديمة بتفضل بعد رد الموظف → 4 ·
//   (ج) الـRPC قبل تأكيد المودال → 6 · (د) الموظف يقدر يشغّل → 7 · (هـ) السبب مش متهرّب → 3 · (و) مفيش رجوع عند 42703 → 8 ·
//   (ز) رسالة البوت بتشيل التصعيد محلياً (العدّاد بيعدّ غير المتصعّد) → 1
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
const XSS = '<img src=x onerror="window.__XSS=1">';
// 260 محادثة: الأحدث c0. المتصعّدين: c5 (من ساعة · طلب شراء) · c9 (من 3 ساعات · XSS) · c250 (بره الـ200 · من 8 ساعات · استرجاع)
const CONVOS = [];
for (let i = 0; i < 260; i++) {
  CONVOS.push({ id: 'c' + i, tenant_id: TENANT, wa_id: '2010000' + String(1000 + i), customer_name: 'عميل ' + i, customer_phone: '010000' + String(1000 + i),
    last_message_at: iso(i + 1), last_inbound_at: iso(i + 1), last_message_text: 'رسالة ' + i, last_direction: 'in', unread_count: i < 3 ? 1 : 0, status: 'open',
    labels: [], note: null, ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null, ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null,
    updated_at: iso(600 + i), ai_escalated_at: null, ai_escalation_note: null, ai_hold_at: null });
}
CONVOS[5].ai_escalated_at = iso(60); CONVOS[5].ai_escalation_note = '🛒 طلب شراء — البيانات كاملة';
CONVOS[9].ai_escalated_at = iso(180); CONVOS[9].ai_escalation_note = XSS;
CONVOS[250].ai_escalated_at = iso(480); CONVOS[250].ai_escalation_note = 'عايز يسترجع الأوردر'; CONVOS[250].ai_hold_at = iso(480);
const MSGS = [
  { id: 'm1', tenant_id: TENANT, conversation_id: 'c5', direction: 'in', type: 'text', body: 'عايز أطلب', is_read: true, created_at: iso(62), wa_timestamp: iso(62), status: null, wa_message_id: 'w-1' },
  { id: 'm2', tenant_id: TENANT, conversation_id: 'c5', direction: 'out', type: 'text', body: 'ممكن الاسم والعنوان يا فندم؟', is_read: true, created_at: iso(61), wa_timestamp: iso(61), status: 'delivered', wa_message_id: 'w-2', sent_by_name: '🤖 AI Agent' },
  { id: 'm3', tenant_id: TENANT, conversation_id: 'c5', direction: 'in', type: 'text', body: 'محمد — مدينة نصر', is_read: true, created_at: iso(60), wa_timestamp: iso(60), status: null, wa_message_id: 'w-3' },
];

async function open(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const settings = opts.settings === undefined ? [{ tenant_id: TENANT, mode: 'shadow', auto_changed_at: null, auto_changed_by_name: null }] : opts.settings;
  await ctx.addInitScript(`
    window.__ROLE = ${JSON.stringify(opts.role || 'admin')};
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)}; window.__WA_MSGS = ${JSON.stringify(MSGS)};
    window.__AI_SETTINGS = ${JSON.stringify(settings)};
    window.__ESC_NO_COL = ${opts.noCols ? 'true' : 'false'}; window.__AI_NO_COLS = ${opts.noCols ? 'true' : 'false'};
    window.__SENT = [];
    // wa-send: السيرفر بيشيل التصعيد لما موظف يرد (التريجر) وبيحرّك updated_at
    window.__FN = function(slug, body){
      window.__SENT.push({ slug: slug, body: body });
      if(slug === 'wa-send'){ (window.__WA_CONVOS || []).forEach(function(c){ if(c.id === body.conversation_id){ c.ai_escalated_at = null; c.ai_escalation_note = null; c.ai_hold_at = null; c.updated_at = new Date(Date.now() + 1000).toISOString(); } }); }
      return { ok:true, message_id:'w'+window.__SENT.length, sent_by_name:'أدمن الاختبار' };
    };
    window.__RPC_HOOK = function(name, args){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      if(name === 'ai_agent_set_auto'){
        if(window.__ROLE !== 'admin') return { data:{ ok:false, error:'admin_only' }, error:null };
        var s = (window.__AI_SETTINGS || [])[0]; if(!s) return { data:{ ok:false, error:'agent_off' }, error:null };
        s.mode = args.p_on ? 'auto' : (s.idle_mode === 'off' ? 'off' : 'shadow'); s.auto_changed_at = new Date().toISOString(); s.auto_changed_by_name = 'أدمن الاختبار';
        return { data:{ ok:true, mode:s.mode, by:'أدمن الاختبار' }, error:null };
      }
      if(name === 'wa_ai_escalation_dismiss'){
        (window.__WA_CONVOS || []).forEach(function(c){ if(c.id === args.p_conversation_id){ c.ai_escalated_at = null; c.ai_escalation_note = null; c.updated_at = new Date(Date.now() + 1000).toISOString(); } });
        return { data:{ ok:true, cleared:1 }, error:null };
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
const chipText = (p) => p.evaluate(() => { const e = document.getElementById('wa-filter-esc'); return e ? e.textContent : null; });
const listIds = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#wa-list-body .wa-conv')).map(r => r.getAttribute('data-id')).join(','));
const hit = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); }, sel);
const rpcs = (p, name) => p.evaluate((n) => (window.__calls || []).filter(c => c.rpc === n).map(c => c.args), name);
const escQueries = (p) => p.evaluate(() => (window.__calls || []).filter(c => c.table === 'wa_conversations' && c.not && c.not.col === 'ai_escalated_at').length);
const send = async (p, text) => { await p.fill('#wa-input', text); await p.click('#wa-send-btn'); await p.waitForTimeout(900); };

async function filterScenario(patch) {
  const p = await open({ patch });
  const R = {};
  R.chip = await chipText(p);
  R.order = await p.evaluate(() => Array.from(document.querySelectorAll('#wa-filters .wa-f-sys .wa-filter')).map(e => e.getAttribute('data-f')).join(','));
  R.alert = await p.evaluate(() => { const e = document.getElementById('wa-filter-esc'); return !!e && e.classList.contains('has-alert'); });
  R.chipHit = await hit(p, '#wa-filter-esc');
  R.q0 = await escQueries(p);
  await p.click('#wa-filter-esc'); await p.waitForTimeout(400);
  R.ids = await listIds(p);
  R.notes = await p.evaluate(() => Array.from(document.querySelectorAll('#wa-list-body .wa-conv .wa-conv-esc span')).map(e => e.textContent).join(' | '));
  // فتح المتصعّدة اللي فيها XSS
  const has = (id) => p.evaluate((i) => !!document.querySelector('.wa-conv[data-id="' + i + '"]'), id);
  if (await has('c9')) { await p.click('.wa-conv[data-id="c9"]'); await p.waitForTimeout(400); }
  R.bannerXss = await p.evaluate(() => { const e = document.getElementById('wa-esc-banner'); return e ? e.textContent : null; });
  R.xss = await p.evaluate(() => !!window.__XSS);
  // فتح اللي بره الـ200 والرد عليها
  R.hasOld = await has('c250');
  if (R.hasOld) { await p.click('.wa-conv[data-id="c250"]'); await p.waitForTimeout(400); }
  R.bannerOld = await p.evaluate(() => { const e = document.getElementById('wa-esc-banner'); return e ? e.textContent : null; });
  R.head = await p.evaluate(() => document.getElementById('wa-chat-name').textContent);
  if (R.hasOld) { await send(p, 'تحت أمر حضرتك يا فندم'); await p.waitForTimeout(700); }
  R.afterReplyChip = await chipText(p);
  R.afterReplyIds = await listIds(p);
  R.afterReplyBanner = await p.evaluate(() => !!document.getElementById('wa-esc-banner'));
  // «اتعاملت» على c5
  if (await has('c5')) { await p.click('.wa-conv[data-id="c5"]'); await p.waitForTimeout(400); }
  R.botName = await p.evaluate(() => document.getElementById('wa-msgs').textContent.indexOf('🤖 AI Agent') >= 0);
  R.doneHit = await hit(p, '#wa-esc-done');
  if (R.doneHit) { await p.click('#wa-esc-done'); await p.waitForTimeout(500); }
  R.dismiss = await rpcs(p, 'wa_ai_escalation_dismiss');
  R.afterDoneChip = await chipText(p);
  R.afterDoneIds = await listIds(p);
  R.sentCount = await p.evaluate(() => window.__SENT.filter(x => x.slug === 'wa-send').length);
  R.q1 = await escQueries(p);
  R.anchorMissing = p.__anchorMissing();
  await p.close();
  return R;
}
async function botScenario(opts) {
  const p = await open(opts);
  const R = {};
  const bar = () => p.evaluate(() => { const e = document.getElementById('wa-ai-bar'); return e ? { cls: e.className, txt: e.textContent, sw: (document.getElementById('wa-ai-sw') || {}).textContent } : null; });
  const modal = () => p.evaluate(() => { const m = document.getElementById('cmodal-backdrop'); return !!m && m.style.display === 'flex'; });
  R.bar0 = await bar();
  R.swHit = R.bar0 ? await hit(p, '#wa-ai-sw') : false;
  if (R.bar0) {
    await p.click('#wa-ai-sw'); await p.waitForTimeout(250);
    R.modal1 = await modal();
    R.modalTxt = await p.evaluate(() => (document.getElementById('cmodal-title').textContent + ' ' + document.getElementById('cmodal-sub').textContent));
    if (R.modal1) { await p.click('#cmodal-cancel'); await p.waitForTimeout(200); }
    R.rpcAfterCancel = (await rpcs(p, 'ai_agent_set_auto')).length;
    R.barAfterCancel = await bar();
    if (opts.role !== 'employee') {
      await p.click('#wa-ai-sw'); await p.waitForTimeout(250);
      await p.click('#cmodal-ok'); await p.waitForTimeout(500);
      R.rpcOn = await rpcs(p, 'ai_agent_set_auto');
      R.barOn = await bar();
      await p.click('#wa-ai-sw'); await p.waitForTimeout(250);
      R.modalOffTxt = await p.evaluate(() => document.getElementById('cmodal-title').textContent);
      R.modalOffSub = await p.evaluate(() => document.getElementById('cmodal-sub').textContent);
      await p.click('#cmodal-ok'); await p.waitForTimeout(500);
      R.rpcOff = await rpcs(p, 'ai_agent_set_auto');
      R.barOff = await bar();
    }
  }
  R.rows = await p.evaluate(() => document.querySelectorAll('#wa-list-body .wa-conv').length);
  R.chip = await chipText(p);
  R.anchorMissing = p.__anchorMissing();
  await p.close();
  return R;
}

{
  const R = await filterScenario();
  ok(R.chip === '🚩 تصعيد (3)' && R.alert && /^all,unread,esc,ctwa$/.test(R.order) && R.chipHit, `1) الشريحة بعد «غير مقروءة» وبعدّاد بيضم اللي بره الـ200 (${R.chip} · ${R.order})`);
  ok(R.ids === 'c250,c9,c5', `2أ) الفلتر: المتصعّد بس والأقدم تصعيداً فوق (${R.ids})`);
  ok(R.notes.indexOf('عايز يسترجع الأوردر') >= 0 && R.notes.indexOf('🛒 طلب شراء — البيانات كاملة') >= 0, '2ب) سطر السبب تحت كل صف');
  ok(R.bannerXss && R.bannerXss.indexOf('<img') >= 0 && !R.xss, '3) بانر السبب نص متهرّب — مفيش HTML بيتنفّذ');
  ok(R.bannerOld && R.bannerOld.indexOf('عايز يسترجع الأوردر') >= 0 && R.head === 'عميل 250', `3ب) محادثة بره الـ200 اتفتحت باسمها وبانرها (${R.head})`);
  ok(R.afterReplyChip === '🚩 تصعيد (2)' && R.afterReplyIds === 'c9,c5' && !R.afterReplyBanner, `4) موظف رد = اتشالت من «تصعيد» والعدّاد نقص والبانر اختفى (${R.afterReplyChip} · ${R.afterReplyIds})`);
  ok(R.doneHit && R.dismiss.length === 1 && R.dismiss[0].p_conversation_id === 'c5' && R.afterDoneChip === '🚩 تصعيد (1)' && R.afterDoneIds === 'c9' && R.sentCount === 1,
     `5) «✓ اتعاملت» = RPC برقم المحادثة ومن غير رسالة (${R.afterDoneChip} · ${R.afterDoneIds})`);
  ok(R.q0 === 1 && R.q1 === 2, `10) استعلام المتصعّد: ${R.q0} عند الفتح · ${R.q1} بعد ضغطة الفلتر وردّين وتحديثات القايمة (مش مع كل تحديث)`);
  ok(R.botName, '11) رسالة البوت في الشات باسم «🤖 AI Agent»');

  const B = await botScenario({});
  ok(B.bar0 && /off/.test(B.bar0.cls) && /مقفول/.test(B.bar0.txt) && B.bar0.sw === 'OFF' && B.swHit, '6أ) الشريط: البوت مقفول والزرار OFF وظاهر');
  ok(B.modal1 && /تشغّل البوت/.test(B.modalTxt) && /بنفسه/.test(B.modalTxt) && B.rpcAfterCancel === 0 && /off/.test(B.barAfterCancel.cls), '6ب) الضغطة بتفتح مودال · الإلغاء = صفر RPC والحالة زي ما هي');
  ok(B.rpcOn && B.rpcOn.length === 1 && B.rpcOn[0].p_on === true && B.barOn && /\bon\b/.test(B.barOn.cls) && /شغّال/.test(B.barOn.txt) && B.barOn.sw === 'ON' && /أدمن الاختبار/.test(B.barOn.txt),
     '6ج) «شغّله» = ai_agent_set_auto(true) والشريط بقى ON بمين شغّله');
  ok(/تقفل البوت/.test(B.modalOffTxt || '') && B.rpcOff.length === 2 && B.rpcOff[1].p_on === false && /off/.test(B.barOff.cls), '6د) القفل بنفس الشكل = ai_agent_set_auto(false)');

  const E = await botScenario({ role: 'employee' });
  ok(E.bar0 && /مقفول/.test(E.bar0.txt) && !E.modal1 && E.rpcAfterCancel === 0, '7) الموظف شايف الحالة · ضغطته مابتفتحش مودال ومابتناديش RPC');

  const N = await botScenario({ noCols: true });
  ok(N.bar0 === null && N.chip === null && N.rows > 0, `8) السيرفر من غير الأعمدة: مفيش شريط ومفيش شريحة والقايمة شغّالة (${N.rows} صف)`);
  const Z = await botScenario({ settings: [] });
  const O = await botScenario({ settings: [{ tenant_id: TENANT, mode: 'off', auto_changed_at: null, auto_changed_by_name: null }] });
  ok(Z.bar0 === null && O.bar0 === null && Z.chip === '🚩 تصعيد (3)', '9) الـAgent مش متفعّل (مفيش صف / off) = مفيش شريط — والشريحة زي ما هي');
  // 12) طلب المالك: OFF = واقف خالص (idle_mode='off') — الشريط لازم يفضل ظاهر وإلا مفيش طريق يشغّله
  const I = await botScenario({ settings: [{ tenant_id: TENANT, mode: 'off', idle_mode: 'off', auto_changed_at: null, auto_changed_by_name: null }] });
  ok(I.bar0 && /off/.test(I.bar0.cls) && /واقف خالص/.test(I.bar0.txt) && I.bar0.sw === 'OFF' && I.swHit, '12أ) القفل الكامل (off + idle off): الشريط ظاهر وبيقول «واقف خالص»');
  ok(I.rpcOn && I.rpcOn.length === 1 && I.barOn && /شغّال/.test(I.barOn.txt) && /هيقف خالص/.test(I.modalOffSub || '') && I.barOff && /واقف خالص/.test(I.barOff.txt),
     '12ب) بيشتغل من القفل الكامل · ومودال القفل بيقول إنه هيقف خالص · وبيرجع «واقف خالص»');
  ok(!/هيقف خالص/.test(B.modalOffSub || '') && /يقترح بس/.test(B.modalOffSub || '') && /بيقترح بس/.test(B.barOff.txt), '12ج) ضابط: idle shadow = «بيقترح بس» زي ما هو');
}
{ const I = await botScenario({ settings: [{ tenant_id: TENANT, mode: 'off', idle_mode: 'off', auto_changed_at: null, auto_changed_by_name: null }],
    patch: [[" || (d.mode==='off' && idle==='off')", '']] });
  cal(I.anchorMissing ? I : I.bar0 === null, '(ح) القفل الكامل من غير شريط → 12أ بيقع'); }
{ const R = await filterScenario([['waEscExtra=(r.data||[]).filter(waIsEscalated);', 'waEscExtra=[];']]);
  cal(R.anchorMissing ? R : R.chip !== '🚩 تصعيد (3)', '(أ) الفلتر على المحمّل بس → 1 بيقع (' + R.chip + ')'); }
{ const R = await filterScenario([[' waConvReplaceIn(waEscExtra, n);', '']]);
  cal(R.anchorMissing ? R : !(R.afterReplyChip === '🚩 تصعيد (2)' && R.afterReplyIds === 'c9,c5'), '(ب) النسخة القديمة بتفضل بعد رد الموظف → 4 بيقع (' + R.afterReplyChip + ')'); }
{ const B = await botScenario({ patch: [["    showModal({ icon:'🤖', title:'تشغّل البوت؟',", "    waAiSet(true);\n    showModal({ icon:'🤖', title:'تشغّل البوت؟',"]] });
  cal(B.anchorMissing ? B : B.rpcAfterCancel !== 0, '(ج) الـRPC قبل تأكيد المودال → 6ب بيقع'); }
{ const E = await botScenario({ role: 'employee', patch: [["  if(!(currentUser && currentUser.role==='admin')){ toast('الأدمن بس اللي بيشغّل ويقفل البوت','er'); return; }\n", '']] });
  cal(E.anchorMissing ? E : !!E.modal1, '(د) الموظف يقدر يشغّل → 7 بيقع'); }
{ const R = await filterScenario([["(note?(': <b>'+esc(note)+'</b>'):'')", "(note?(': <b>'+note+'</b>'):'')"]]);
  cal(R.anchorMissing ? R : !!R.xss, '(هـ) السبب مش متهرّب → 3 بيقع'); }
{ const N = await botScenario({ noCols: true, patch: [["if(r.error.code==='42703'){ waEscOk=false;", "if(false){ waEscOk=false;"]] });
  cal(N.anchorMissing ? N : N.chip !== null, '(و) مفيش رجوع عند 42703 → 8 بيقع'); }
{ const R = await filterScenario([['    if(waIsEscalated(waConvos[k])) escCount++;', '    escCount++;']]);
  cal(R.anchorMissing ? R : R.chip !== '🚩 تصعيد (3)', '(ز) العدّاد بيعدّ غير المتصعّد → 1 بيقع (' + R.chip + ')'); }

await b.close();
console.log(bad ? `\n✗ ${bad} وقع` : '\n✓ كله عدّى');
process.exit(bad ? 1 : 0);
