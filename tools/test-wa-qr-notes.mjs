// «معلومات للـAI Agent بس» في فورم الرد المحفوظ (v85 — 16 نوفمبر، طلب المالك «كله في السيستم»).
//   1) الخانة في فورم التعديل والرد الجديد · متعبّية من الصف · ظاهرة (hit-test)
//   2) الحفظ بيكتب `ai_notes` (مقصوص المسافات) · مسحها = null · والنص والاسم زي ما هم
//   3) علامة «🤖 معلومات» في قايمة الإدارة للرد اللي عليه معلومات بس
//   4) 🔴 المعلومات عمرها ما بتتبعت للعميل: ضغطة الرد = نص الرد والصور بس (ولا حرف من المعلومات في أي حمولة wa-send)
//   5) رد جديد بمعلومات: الحمولة فيها ai_notes
//   6) السيرفر من غير العمود (42703): الردود بتتحمّل عادي · الخانة مش معروضة · الحفظ من غير مفتاح ai_notes
//   7) المعلومات متهرّبة (XSS) في الفورم
// المعايرات (بحارس المرساة — درس 47): (أ) الحفظ من غير ai_notes → 2 · (ب) المعلومات بتتبعت مع الرد → 4 ·
//   (ج) مفيش رجوع للأعمدة القديمة → 6 · (د) العلامة لكل الردود → 3
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
const NOTE = 'الخامة حديد مجلفن — الوزن 5.5 كيلو';
const QR = [
  { id: 'q1', tenant_id: TENANT, title: 'مطبخ', body: 'منظم المطبخ بـ1499', media: [], sort: 0, ai_notes: NOTE },
  { id: 'q2', tenant_id: TENANT, title: 'تيربو', body: 'تيربو بريمو بـ1285', media: [], sort: 1, ai_notes: null },
  { id: 'q3', tenant_id: TENANT, title: 'خطر', body: 'نص', media: [], sort: 2, ai_notes: '<img src=x onerror="window.__XSS=1">' },
];
const CONVOS = [{ id: 'c1', tenant_id: TENANT, wa_id: '201000001', customer_name: 'عميل', customer_phone: '201000001', last_message_at: iso(1),
  last_inbound_at: iso(1), last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open', labels: [], note: null,
  ctwa_first_at: null, ctwa_ad_id: null, ctwa_clid: null, ctwa_ad_body: null, ctwa_headline: null, ctwa_source_url: null }];
const MSGS = [{ id: 'm1', tenant_id: TENANT, conversation_id: 'c1', direction: 'in', type: 'text', body: 'أهلاً', is_read: true,
  created_at: iso(1), wa_timestamp: iso(1), status: null, wa_message_id: 'wamid-1' }];

async function open(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)}; window.__WA_MSGS = ${JSON.stringify(MSGS)};
    window.__QR = ${JSON.stringify(QR)}; window.__SENT = []; window.__QR_NO_NOTES = ${opts.noCol ? 'true' : 'false'};
    window.__FN = function(slug, body){ window.__SENT.push({ slug: slug, body: body }); return { ok:true, message_id:'w'+window.__SENT.length }; };
    window.__RPC_HOOK = function(name){ if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null }; return null; };
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
  await p.click('.wa-conv[data-id="c1"]');
  await p.waitForTimeout(400);
  p.__anchorMissing = () => anchorMissing;
  return p;
}
const openMgr = async (p) => { await p.click('#wa-qrm-open'); await p.waitForTimeout(250); };
const edit = async (p, id) => { await p.click('#wa-qrm .wa-qrm-row[data-id="' + id + '"] [data-ed]'); await p.waitForTimeout(250); };
const qr = (p, id) => p.evaluate((i) => window.__QR.find(q => q.id === i), id);
const lastWrite = (p) => p.evaluate(() => { const c = (window.__calls || []).filter(c => c.table === 'wa_quick_replies' && c.payload && !('sort' in c.payload && Object.keys(c.payload).length === 1)); return c.length ? c[c.length - 1].payload : null; });
const badges = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#wa-qrm .wa-qrm-row')).map(r => r.getAttribute('data-id') + ':' + (r.querySelector('.wa-qrm-aibadge') ? 1 : 0)).join(','));

async function scenario(patch) {
  const p = await open({ patch });
  const R = {};
  await openMgr(p);
  R.badges = await badges(p);
  await edit(p, 'q1');
  R.pre = await p.evaluate(() => { const e = document.getElementById('wa-qrm-ainotes'); return e ? e.value : null; });
  R.hit = await p.evaluate(async () => { const el = document.getElementById('wa-qrm-ainotes'); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === el; });
  R.label = await p.evaluate(() => (document.querySelector('.wa-qrm-ai-lbl') || {}).textContent || '');
  await p.fill('#wa-qrm-ainotes', '  الخامة ستانلس 304 \n بيتحمل 15 كيلو  ');
  await p.click('#wa-qrm-save'); await p.waitForTimeout(400);
  R.saved = await qr(p, 'q1'); R.write = await lastWrite(p);
  await edit(p, 'q1');
  await p.fill('#wa-qrm-ainotes', '   ');
  await p.click('#wa-qrm-save'); await p.waitForTimeout(400);
  R.cleared = await qr(p, 'q1'); R.badgesAfter = await badges(p);
  // XSS
  await edit(p, 'q3');
  R.xssVal = await p.evaluate(() => document.getElementById('wa-qrm-ainotes').value);
  R.xss = await p.evaluate(() => !!window.__XSS);
  await p.click('#wa-qrm-cancel'); await p.waitForTimeout(150);
  // رد جديد بمعلومات
  await p.click('#wa-qrm-new'); await p.waitForTimeout(200);
  R.newEmpty = await p.evaluate(() => document.getElementById('wa-qrm-ainotes').value);
  await p.fill('#wa-qrm-name', 'جديد'); await p.fill('#wa-qrm-text', 'نص الرد الجديد'); await p.fill('#wa-qrm-ainotes', 'معلومة للمنتج الجديد');
  await p.click('#wa-qrm-save'); await p.waitForTimeout(400);
  R.newWrite = await lastWrite(p);
  R.anchorMissing = p.__anchorMissing();
  await p.close();
  return R;
}
async function sendScenario(patch) {
  const p = await open({ patch });
  await p.click('#wa-qr-panel .wa-qr[data-qid="q1"]'); await p.waitForTimeout(500);
  const sent = await p.evaluate(() => JSON.stringify(window.__SENT));
  const am = p.__anchorMissing(); await p.close();
  return { sent, anchorMissing: am };
}
async function noColScenario(patch) {
  const p = await open({ noCol: true, patch });
  const R = {};
  R.chips = await p.evaluate(() => document.querySelectorAll('#wa-qr-panel .wa-qr').length);
  await openMgr(p);
  R.rows = await p.evaluate(() => document.querySelectorAll('#wa-qrm .wa-qrm-row').length);
  if (R.rows) {
    await edit(p, 'q2');
    R.field = await p.evaluate(() => !!document.getElementById('wa-qrm-ainotes'));
    await p.fill('#wa-qrm-name', 'تيربو 2'); await p.click('#wa-qrm-save'); await p.waitForTimeout(400);
    R.write = await lastWrite(p); R.saved = await qr(p, 'q2');
  }
  R.anchorMissing = p.__anchorMissing();
  await p.close();
  return R;
}

{
  const R = await scenario();
  ok(R.pre === NOTE && R.hit && /AI Agent/.test(R.label) && /مابتتبعتش للعميل/.test(R.label), `1) الخانة في فورم التعديل متعبّية وظاهرة (${R.pre})`);
  ok(R.saved && R.saved.ai_notes === 'الخامة ستانلس 304 \n بيتحمل 15 كيلو' && R.saved.title === 'مطبخ' && R.saved.body === 'منظم المطبخ بـ1499'
     && R.write && R.write.ai_notes === 'الخامة ستانلس 304 \n بيتحمل 15 كيلو', '2أ) الحفظ كتب ai_notes مقصوص المسافات والاسم والنص زي ما هم');
  ok(R.cleared && R.cleared.ai_notes === null, '2ب) مسح الخانة = null');
  ok(R.badges === 'q1:1,q2:0,q3:1' && /^q1:0,q2:0,q3:1/.test(R.badgesAfter), `3) علامة «🤖 معلومات» للرد اللي عليه معلومات بس (${R.badges} → ${R.badgesAfter})`);
  ok(R.xssVal === '<img src=x onerror="window.__XSS=1">' && !R.xss, '7) المعلومات نص في الخانة — مفيش HTML بيتنفّذ');
  ok(R.newEmpty === '' && R.newWrite && R.newWrite.ai_notes === 'معلومة للمنتج الجديد' && R.newWrite.title === 'جديد' && R.newWrite.body === 'نص الرد الجديد',
     '5) رد جديد: الخانة فاضية والحمولة فيها ai_notes');
  const S = await sendScenario();
  ok(S.sent.indexOf('منظم المطبخ بـ1499') >= 0 && S.sent.indexOf('حديد مجلفن') < 0 && S.sent.indexOf('ai_notes') < 0, '4) ضغطة الرد = نص الرد بس — ولا حرف من المعلومات اتبعت');
  const N = await noColScenario();
  ok(N.chips === 3 && N.rows === 3 && N.field === false && N.write && !('ai_notes' in N.write) && N.saved && N.saved.title === 'تيربو 2',
     `6) السيرفر من غير العمود: الردود اتحمّلت (${N.chips}) · الخانة مش معروضة · الحفظ من غير المفتاح`);
}
{ const R = await scenario([["if(notesEl) row.ai_notes=aiNotes||null;", '']]);
  cal(R.anchorMissing ? R : !(R.saved && R.saved.ai_notes === 'الخامة ستانلس 304 \n بيتحمل 15 كيلو'), '(أ) الحفظ من غير ai_notes → 2أ بيقع'); }
{ const S = await sendScenario([["var text=String(item.body==null?'':item.body).trim();", "var text=String((item.body==null?'':item.body)+' '+(item.ai_notes||'')).trim();"]]);
  cal(S.anchorMissing ? S : S.sent.indexOf('حديد مجلفن') >= 0, '(ب) المعلومات بتتبعت مع الرد → 4 بيقع'); }
{ const N = await noColScenario([["if(waQrNotesOk && String(r.error.code||'')==='42703'){ waQrNotesOk=false; waLoadQuickReplies(); }", '']]);
  cal(N.anchorMissing ? N : N.chips === 0, '(ج) مفيش رجوع للأعمدة القديمة → 6 بيقع (الردود اختفت)'); }
{ const R = await scenario([["(String(q.ai_notes||'').trim()?' <span class=\"wa-qr-badge wa-qrm-aibadge\"", "(true?' <span class=\"wa-qr-badge wa-qrm-aibadge\""]]);
  cal(R.anchorMissing ? R : R.badges !== 'q1:1,q2:0,q3:1', '(د) العلامة لكل الردود → 3 بيقع'); }

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت (7 فحوص + 4 معايرات)');
process.exit(bad ? 1 : 0);
