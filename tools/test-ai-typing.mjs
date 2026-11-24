// «بيكتب...» على واتساب (24 نوفمبر — طلب المالك «مينفعش نظهره انه يبان Typing لما يكون بيكتب؟») — من غير متصفح:
// _shared/wa-typing.ts بالحرف + أماكن النداء في wa-ai-draft/index.ts + FACT_SKIP في _shared/ai-draft.ts.
//  1) typingWanted: الزرار ON (auto) بس · مش dry_run · مش واصل لسقف الردود · العلم "on" بالظبط · وقت ON DEVELOP أرقام التجربة بس · الافتراضي نايم
//  2) typingBody: status = read + typing_indicator نوعه text + message_id — من غير to ولا type (مش رسالة)
//  3) wa-typing.ts من غير import · النسخة v<رقم> من graph.facebook.com · المهلة ≤ 5 ثواني
//  4) index.ts: النداء بعد staff_active وقبل قراية الميديا والموديل · بشرط !dry و auto والعلم/ON DEVELOP · بيتستنى قبل autoRun ومن غير أي
//     return على نتيجته (فشله مابيوقفش الرد) · typingStart: try/catch ومهلة ومفيش كتابة ولا sendAction والسقوف = نفس autoPlan ·
//     مش في التقييم ولا dry_run · MSG_COLS فيها wa_message_id · dev_mode من loadStatic
//  5) ai-draft: typing_indicator في FACT_SKIP — التعليمات والدخل (v1 · v4 الثابت) بالعلم زي من غيره بالبايت
// المعايرات: (أ) من غير dry · (ب) من غير السقف · (ج) العلم truthy بدل "on" · (د) Typing قبل staff_active · (هـ) من غير await قبل autoRun ·
//            (و) من غير try/catch · (ز) typing_indicator مش في FACT_SKIP · (ح) return على نتيجة الـTyping
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = {
  t: path.join(ROOT, 'supabase/functions/_shared/wa-typing.ts'),
  d: path.join(ROOT, 'supabase/functions/_shared/ai-draft.ts'),
  a: path.join(ROOT, 'supabase/functions/_shared/ai-auto.ts'),
  i: path.join(ROOT, 'supabase/functions/wa-ai-draft/index.ts'),
};
const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));
let seq = 0;
async function load(which, src) {
  if (src === SRC[which]) return import(pathToFileURL(F[which]).href);
  const f = path.join(os.tmpdir(), 'ai-typing-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, src);
  return import(pathToFileURL(f).href);
}
function mut(which, re, to) {
  const out = SRC[which].replace(re, to);
  if (out === SRC[which]) throw new Error('المعايرة مالقتش المرساة: ' + re);
  return out;
}

const base = { dry: false, mode: 'auto', flag: undefined, devWaIds: null, waId: '201050005219', capped: false };
const cards = [{ id: 'c2', title: 'مطبخ', body: 'منظم المطبخ المتكامل 85 بـ1499' }];
const mk = (facts) => ({ facts, products: [], cards, siteRows: [], stockNames: ['منظم'], ordersKnown: true, nowIso: '2026-11-24T10:00:00Z',
  linkedProductId: null, ad: null, orders: [], customerName: null, history: [{ dir: 'in', body: 'بكام المنظم' }] });

function between(s, a, b, at) { const i = s.indexOf(a), j = s.indexOf(b, i + 1); return i !== -1 && j !== -1 && at > i && at < j; }

function checks({ T, D, A, idx }) {
  const r = [];
  const ok = (name, cond) => r.push([name, !!cond]);
  const W = (o) => T.typingWanted({ ...base, ...o });
  // 1) الـgate
  ok('1أ الافتراضي نايم (مفيش علم ولا ON DEVELOP)', W({}) === false);
  ok('1ب العلم "on" = أيوه', W({ flag: 'on' }) === true);
  ok('1ج dry_run = لأ حتى بالعلم', W({ flag: 'on', dry: true }) === false);
  ok('1د shadow/off = لأ حتى بالعلم', W({ flag: 'on', mode: 'shadow' }) === false && W({ flag: 'on', mode: 'off' }) === false);
  ok('1هـ واصل للسقف = لأ حتى بالعلم وحتى رقم التجربة', W({ flag: 'on', capped: true }) === false && W({ devWaIds: ['201050005219'], capped: true }) === false);
  ok('1و العلم لازم "on" بالظبط', [true, 'true', 'ON', 'yes', 1, ''].every((f) => W({ flag: f }) === false));
  ok('1ز ON DEVELOP: رقم التجربة = أيوه · رقم تاني = لأ · من غير رقم = لأ',
    W({ devWaIds: ['201050005219'] }) === true && W({ devWaIds: ['201050005219'], waId: '201112223334' }) === false
    && W({ devWaIds: ['201050005219'], waId: null }) === false && W({ devWaIds: [] }) === false);
  // 2) الجسم
  const b = T.typingBody('wamid.ABC');
  ok('2أ status read + typing_indicator text + message_id', b.messaging_product === 'whatsapp' && b.status === 'read' && b.message_id === 'wamid.ABC'
    && b.typing_indicator && b.typing_indicator.type === 'text');
  ok('2ب مش رسالة: من غير to ولا type ولا text', !('to' in b) && !('type' in b) && !('text' in b) && Object.keys(b).length === 4);
  // 3) الملف
  ok('3أ wa-typing.ts من غير import', !/^\s*import\s/m.test(SRC.t));
  ok('3ب النسخة من graph.facebook.com/v<رقم> · المهلة ≤ 5 ثواني', /^https:\/\/graph\.facebook\.com\/v\d+\.\d+$/.test(T.TYPING_GRAPH) && T.TYPING_TIMEOUT_MS > 0 && T.TYPING_TIMEOUT_MS <= 5000);
  // 4) index.ts
  const s = idx;
  const call = s.indexOf('typingStart(msg, st, dry)');
  const hm = s.indexOf('async function handleMessage(');
  ok('4أ النداء مرة واحدة جوّه handleMessage', s.split('typingStart(').length - 1 === 2 && call > hm && call < s.indexOf('// ── التقييم'));
  ok('4ب بعد staff_active وقبل قراية الميديا والموديل', call > s.indexOf('return { skipped: "staff_active" }') && call < s.indexOf('const todo = mediaToRead(histRows')
    && call < s.indexOf('draftFor(st, cv'));
  ok('4ج بشرط !dry و auto والعلم أو ON DEVELOP', s.includes('const typingP = !dry && st.mode === "auto" && (st.facts.typing_indicator === "on" || st.devWaIds) ? typingStart(msg, st, dry) : null;'));
  const aw = s.indexOf('const typing = typingP ? await typingP : null;');
  const ar = s.indexOf('await autoRun(msg, st, r, draftId, orders, sess, typing)');
  ok('4د بيتستنى قبل autoRun وبعد الموديل والمعاينة', aw !== -1 && ar !== -1 && aw < ar && aw > s.indexOf('draftFor(st, cv') && aw > s.indexOf('return { dry_run: true'));
  ok('4هـ فشله مابيوقفش الرد: مفيش return على typing بين الاستنى وautoRun', aw !== -1 && !/\breturn\b/.test(s.slice(aw + 10, ar)) && !/if\s*\(\s*!?typing\b/.test(s.slice(aw, ar)));
  const fs0 = s.indexOf('async function typingStart('), fe = s.indexOf('// ── المسار العادي', fs0);
  const body = fs0 !== -1 && fe !== -1 ? s.slice(fs0, fe) : '';
  ok('4و typingStart: try/catch بيرجّع نص · مهلة · مفيش كتابة ولا sendAction', /\btry \{/.test(body) && /\} catch \(e\) \{[\s\S]*return "failed";/.test(body)
    && body.includes('signal: AbortSignal.timeout(TYPING_TIMEOUT_MS)') && !/\.(insert|update|upsert|delete|rpc)\(/.test(body) && !body.includes('sendAction('));
  // 24 نوفمبر: سقف المحادثة بقى من convTurnsFor (رقم التجربة وقت ON DEVELOP من غيره) — نفس اللي planFor بيدّيه لـautoPlan
  ok('4ز السقوف = نفس autoPlan (اليوم ثم المحادثة) والـgate من wa-typing', body.includes('state.turnsToday >= AUTO_MAX_TURNS_PER_DAY || convTurnsFor(state.turnsInConv, st.devWaIds, state.waId) >= AUTO_MAX_TURNS_PER_CONV')
    && s.includes('turnsInConv: convTurnsFor(state.turnsInConv, st.devWaIds, state.waId), turnsToday: state.turnsToday,')
    && A.includes('if (i.turnsToday >= AUTO_MAX_TURNS_PER_DAY)') && A.includes('if (i.turnsInConv >= AUTO_MAX_TURNS_PER_CONV)')
    && body.includes('typingWanted({ dry, mode: st.mode, flag: st.facts.typing_indicator, devWaIds: st.devWaIds, waId: state.waId, capped })')
    && body.includes('body: JSON.stringify(typingBody(wid))') && body.includes('`${TYPING_GRAPH}/${tn.whatsapp_phone_id}/messages`'));
  const ev = s.indexOf('async function runEval('), dryA = s.indexOf('if (dry) {'), dryB = s.indexOf('return { dry_run: true');
  ok('4ح مش في التقييم ولا dry_run', !s.slice(ev).includes('typingStart(') && !s.slice(dryA, dryB).includes('typingStart(') && !s.slice(dryA, dryB).includes('typingP'));
  ok('4ط MSG_COLS فيها wa_message_id · dev_mode من loadStatic', /const MSG_COLS = "[^"]*\bwa_message_id\b[^"]*";/.test(s)
    && s.includes('select("mode, model, facts, dev_mode, dev_wa_ids")') && s.includes('devWaIds: set.data.dev_mode ?'));
  ok('4ي النتيجة في auto_result بس لما اتبعت نداء', s.includes('auto_result: typing ? { ...res, typing } : res'));
  // 5) FACT_SKIP
  const on = mk({ delivery: 'من 24 إلى 48 ساعة', typing_indicator: 'on' }), off = mk({ delivery: 'من 24 إلى 48 ساعة' });
  ok('5أ الدخل v1 والجزء الثابت v4 بالعلم = من غيره بالبايت', D.buildUserPrompt(on, 'v1') === D.buildUserPrompt(off, 'v1') && D.buildStaticUser(on) === D.buildStaticUser(off));
  ok('5ب ضابط: معلومة عادية بتغيّر الدخل', D.buildStaticUser(mk({ delivery: 'من 24 إلى 48 ساعة', x_test: 'قيمة' })) !== D.buildStaticUser(off));
  return r;
}

async function run(srcs = {}) {
  const T = await load('t', srcs.t ?? SRC.t), D = await load('d', srcs.d ?? SRC.d);
  return checks({ T, D, A: srcs.a ?? SRC.a, idx: srcs.i ?? SRC.i });
}

const main = await run();
let bad = 0;
for (const [n, c] of main) { console.log((c ? '✓ ' : '✗ ') + n); if (!c) bad++; }

// المعايرات: كل واحدة لازم توقّع فحص بعينه
const CAL = [
  ['(أ) من غير dry', { t: () => mut('t', 'if (o.dry || o.mode !== "auto" || o.capped) return false;', 'if (o.mode !== "auto" || o.capped) return false;') }, '1ج'],
  ['(ب) من غير السقف', { t: () => mut('t', 'if (o.dry || o.mode !== "auto" || o.capped) return false;', 'if (o.dry || o.mode !== "auto") return false;') }, '1هـ'],
  ['(ج) العلم truthy', { t: () => mut('t', 'if (o.flag === "on") return true;', 'if (o.flag) return true;') }, '1و'],
  ['(د) Typing قبل staff_active', { i: () => {
    const line = '  const typingP = !dry && st.mode === "auto" && (st.facts.typing_indicator === "on" || st.devWaIds) ? typingStart(msg, st, dry) : null;\n';
    const s1 = SRC.i.replace(line, '');
    if (s1 === SRC.i) throw new Error('المعايرة مالقتش المرساة (د)');
    const anchor = '  if (!dry && st.mode === "auto" && staffActive) {';
    if (!s1.includes(anchor)) throw new Error('المعايرة مالقتش المرساة (د2)');
    return s1.replace(anchor, line + anchor);
  } }, '4ب'],
  ['(هـ) من غير await قبل autoRun', { i: () => mut('i', 'const typing = typingP ? await typingP : null;', 'const typing = null;') }, '4د'],
  ['(و) من غير try/catch', { i: () => mut('i', /  \} catch \(e\) \{\n    console\.error\("wa-ai-draft typing failed"[^\n]*\n    return "failed";\n  \}/, '  } finally {}') }, '4و'],
  ['(ز) typing_indicator مش في FACT_SKIP', { d: () => mut('d', ', "typing_indicator"]);', ']);') }, '5أ'],
  ['(ح) return على نتيجة الـTyping', { i: () => mut('i', 'const typing = typingP ? await typingP : null;\n', 'const typing = typingP ? await typingP : null;\n  if (typing === "failed") return { skipped: "typing_failed" };\n') }, '4هـ'],
];
for (const [label, m, want] of CAL) {
  let res;
  try {
    const srcs = {};
    for (const [k, f] of Object.entries(m)) srcs[k] = f();
    res = await run(srcs);
  } catch (e) { console.log('✗ معايرة ' + label + ' — ' + e.message); bad++; continue; }
  const hit = res.find(([n]) => n.startsWith(want));
  if (hit && !hit[1]) console.log('✓ معايرة ' + label + ' — اتمسكت (' + want + ')');
  else { console.log('✗ معايرة ' + label + ' — الفحص ' + want + ' ماوقعش'); bad++; }
}
console.log(bad ? '✗ ' + bad + ' مشكلة' : '✓ كله تمام (' + main.length + ' فحص + ' + CAL.length + ' معايرات)');
process.exit(bad ? 1 : 0);
