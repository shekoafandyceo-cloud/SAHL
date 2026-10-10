// «المندوب في الطريق» (11 أكتوبر) — المنطق الصافي من غير متصفح: supabase/functions/_shared/wa-ofd.ts بالحرف
// (Node 22 بيشيل الأنواع — نفس الملف اللي wa-ofd-notify بتستورده، مفيش نسخة تانية).
//
//  1) اسم المندوب من وصف J&T (فواصل/مسافات مزدوجة) · الغريب = «مندوب J&T»
//  2) الاسم الأول: حروف بس 2–25 — لينك/@/أرقام/حرف واحد = «حضرتك» (سبام من رقمنا في قالب utility)
//  3) fuzz 300 اسم: ولا متغير فاضي · ولا سطر/تاب · ولا مسافتين · الاسم الأول = NAME_TOKEN أو «حضرتك»
//  4) رقم الطلب: order_uid ← tracking_no ← «—»
//  5) الأرقام: +20/هندي → 01x · أرضي للمندوب = bad_courier_phone · خط ساخن للمحل مقبول · فاضي = bad_store_phone
//  6) renderTemplate = النص بالحرف · maxPlaceholder = 5 · $& و{{2}} جوّه القيمة بيطلعوا زي ما هم
//  7) نص القالب في البذرة (.sql) = BODY هنا بالحرف (اللي هيتسجّل عند ميتا)
//  8) classifyMeta: sent/unknown/pause/deferred/transient/permanent(recipient|message) + التفصيلة متغطية
//  9) classifyFetchError: timeout/reset = unknown · dns/refused = transient
// 10) maskDigits = app.wa_ofd_mask (مخرجات SQL من الترانزاكشن الراجعة على الحي — 10 أكتوبر)
// 11) مفيش حرف خفي مكتوب حرفياً في wa-ofd.ts
//
// المعايرات (نسخة مؤقتة محقونة + حارس مرساة — درس 47): (أ) شيل لمّ المسافات → 3 · (ب) NAME_TOKEN فضفاض → 2/3 ·
// (ج) 131005 يرجع message-permanent → 8 · (د) fetch_error → transient → 9 · (هـ) حرف في نص البذرة → 7 · (و) maskDigits من غير \+? والمسافات → 8/10
// تشغيل:  node tools/test-wa-ofd-logic.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TS = path.join(ROOT, 'supabase/functions/_shared/wa-ofd.ts');
const SQL = path.join(ROOT, 'supabase/migrations/20261011100000_wa_ofd_notify.sql');

const BODY = 'أهلاً {{1}}،\nطلبك رقم {{2}} خرج النهارده مع مندوب الشحن وفي الطريق ليك 🚚\n\nاسم المندوب: {{3}}\nرقم المندوب: {{4}}\n\n'
  + 'تقدر تكلّم المندوب على طول لو حابب تتفق معاه على معاد الاستلام.\nولو فيه أي مشكلة كلّمنا على {{5}} أو رد على الرسالة دي.';
// مخرجات app.wa_ofd_mask على الحي (run3a — 10 أكتوبر) للمتجهات دي بالترتيب
const MASK_VEC = ['+20 101 234 5678', 'call 01012345678 now', 'رقم ٠١٠١٢٣٤٥٦٧٨', 'code 131026 x', '12-34-56-78', 'abc 1234567 def'];
const MASK_SQL = ['#', 'call # now', 'رقم #', 'code 131026 x', '#', 'abc 1234567 def'];

function sqlSeedBody(sqlText){
  const i = sqlText.indexOf("E'أهلاً");
  if(i < 0) return null;
  const j = sqlText.indexOf("',", i);
  return sqlText.slice(i + 2, j).replace(/\\n/g, '\n').replace(/''/g, "'");
}

// كل الفحوص على موديول (أصلي أو محقون) — بترجّع [{id, ok, msg}]
function runChecks(m, sqlText){
  const R = [];
  const ok = (id, c, msg) => R.push({ id, ok: !!c, msg });
  // 1
  ok(1, m.ofdCourierName('Mahmoud goma Al , Sayed') === 'Mahmoud goma Al Sayed', '1) اسم المندوب: الفاصلة اتشالت — ' + m.ofdCourierName('Mahmoud goma Al , Sayed'));
  ok(1, m.ofdCourierName('Mohamed Mahmoud  Mahmoud') === 'Mohamed Mahmoud Mahmoud', '1) المسافات المزدوجة اتلمّت');
  ok(1, ['Ahmed 2', 't.me/x', '<b>', ''].every((x) => m.ofdCourierName(x) === 'مندوب J&T'), '1) اسم غريب/فاضي = «مندوب J&T»');
  // 2
  const fn = (x) => m.ofdFirstName(x);
  ok(2, fn('أحمد محمد') === 'أحمد' && fn('') === 'حضرتك' && fn('..محمد علي') === 'محمد', '2) الاسم الأول + الفاضي + نقط قبله');
  ok(2, fn('01012345678') === 'حضرتك' && fn('www.x.com') === 'حضرتك' && fn('@handle') === 'حضرتك', '2) أرقام/لينك/@ = «حضرتك»');
  ok(2, fn('t.me/xyz أحمد') === 'أحمد', '2) لينك قبل الاسم = الاسم اللي بعده — ' + fn('t.me/xyz أحمد'));
  ok(2, fn('م') === 'حضرتك' && fn('محمد3') === 'حضرتك' && fn('ا'.repeat(30)) === 'حضرتك', '2) حرف واحد · اسم فيه رقم · 30 حرف = «حضرتك»');
  ok(2, fn('\nمحمد\tعلي') === 'محمد', '2) سطر/تاب بيتشالوا');
  // 3 fuzz
  const parts = ['أحمد', 'Mohamed', '😀', '\u200f', '\u202e', 'https://x.y/z', 'www.a.com', '@me', '0101234567', '١٢٣', 'محمد3', '\n', '\t', '   ', "O'Neil", 'عبد-الله', '.', '/', 'ـــ', 'إ'];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let fuzzBad = 0, fuzzShape = 0;
  for(let i = 0; i < 300; i++){
    const nm = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => parts[Math.floor(rnd() * parts.length)]).join(rnd() < .5 ? ' ' : '');
    const cn = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => parts[Math.floor(rnd() * parts.length)]).join(' , ');
    const p = m.buildOfdParams({ customer_name: nm, order_uid: rnd() < .2 ? '' : '1' + i, tracking_no: 'JEG' + i, courier_name: cn, courier_phone: '01000000011', store_phone: '19999' });
    if(p.length !== 5 || p.some((x) => !x || /[\n\t]/.test(x) || /\s{2,}/.test(x))) fuzzBad++;
    if(!(p[0] === 'حضرتك' || (/^[\p{L}\p{M}'\u2019-]{2,25}$/u.test(p[0]) && !/[./@0-9]/.test(p[0])))) fuzzShape++;
  }
  ok(3, fuzzBad === 0, '3) fuzz 300: ولا متغير فاضي/سطر/تاب/مسافتين (' + fuzzBad + ')');
  ok(3, fuzzShape === 0, '3) fuzz 300: الاسم الأول حروف بس أو «حضرتك» (' + fuzzShape + ')');
  // 4
  const base = { customer_name: 'أحمد', courier_name: 'Ali', courier_phone: '01000000011', store_phone: '01200000800' };
  ok(4, m.buildOfdParams(Object.assign({}, base, { order_uid: '17955' }))[1] === '17955'
     && m.buildOfdParams(Object.assign({}, base, { order_uid: '', tracking_no: 'JEG1' }))[1] === 'JEG1'
     && m.buildOfdParams(Object.assign({}, base, { order_uid: null, tracking_no: null }))[1] === '—', '4) order_uid ← tracking_no ← «—»');
  // 5
  ok(5, m.egLocalMobile('+201012345678') === '01012345678' && m.egLocalMobile('٠١٠١٢٣٤٥٦٧٨') === '01012345678' && m.egLocalMobile('00201512345678') === '01512345678', '5) +20/هندي/0020 → 01x');
  let thr = '';
  try { m.buildOfdParams(Object.assign({}, base, { courier_phone: '0225252525' })); } catch(e){ thr = e.message; }
  ok(5, thr === 'bad_courier_phone', '5) مندوب برقم أرضي = bad_courier_phone (' + thr + ')');
  ok(5, m.buildOfdParams(Object.assign({}, base, { store_phone: '19xxx'.replace('xxx', '123') }))[4] === '19123', '5) خط ساخن للمحل مقبول');
  thr = ''; try { m.buildOfdParams(Object.assign({}, base, { store_phone: '' })); } catch(e){ thr = e.message; }
  ok(5, thr === 'bad_store_phone', '5) رقم المحل فاضي = bad_store_phone');
  // 6
  const pr = ['أحمد', '17955', 'Sherif Ashraf Ismail', '01000000011', '01200000800'];
  const exp = 'أهلاً أحمد،\nطلبك رقم 17955 خرج النهارده مع مندوب الشحن وفي الطريق ليك 🚚\n\nاسم المندوب: Sherif Ashraf Ismail\nرقم المندوب: 01000000011\n\n'
    + 'تقدر تكلّم المندوب على طول لو حابب تتفق معاه على معاد الاستلام.\nولو فيه أي مشكلة كلّمنا على 01200000800 أو رد على الرسالة دي.';
  ok(6, m.renderTemplate(BODY, pr) === exp, '6) النص المرسوم بالحرف');
  ok(6, m.maxPlaceholder(BODY) === 5 && m.OFD_PARAMS === 5, '6) maxPlaceholder = 5');
  ok(6, m.renderTemplate('{{1}}-{{2}}', ['$&', '{{2}}']) === '$&-{{2}}', '6) $& و{{2}} جوّه القيمة بيطلعوا زي ما هم');
  // 7
  ok(7, sqlSeedBody(sqlText) === BODY, '7) نص البذرة في الـmigration = BODY بالحرف');
  // 8
  const cm = (st, j) => m.classifyMeta(st, j);
  const k = (v) => v.kind + (v.cls ? '/' + v.cls : '');
  ok(8, k(cm(200, { messages: [{ id: 'wamid.1' }] })) === 'sent' && cm(200, { messages: [{ id: 'wamid.1' }] }).detail === 'wamid.1', '8) 200+wamid = sent');
  ok(8, k(cm(200, {})) === 'unknown', '8) 200 من غير wamid = unknown');
  ok(8, [132015, 132001, 132000].every((c) => k(cm(400, { error: { code: c } })) === 'pause/config'), '8) 132015/132001/132000 = pause');
  ok(8, [190, 131048, 368, 131005, 133010, 133000, 131030].every((c) => k(cm(400, { error: { code: c } })) === 'deferred'), '8) الحساب/التوكن/السقف = deferred (وقف الدورة)');
  ok(8, k(cm(400, { error: { code: 100, error_subcode: 33 } })) === 'deferred' && k(cm(400, { error: { code: 100 } })) === 'permanent/message', '8) 100+33 = deferred · 100 = permanent/message');
  ok(8, [130429, 131000].every((c) => k(cm(400, { error: { code: c } })) === 'transient') && k(cm(500, {})) === 'transient' && k(cm(429, {})) === 'transient', '8) 130429/131000/500/429 = transient');
  ok(8, k(cm(400, { error: { code: 131026 } })) === 'permanent/recipient' && k(cm(400, { error: { code: 131009 } })) === 'permanent/message' && k(cm(400, { error: { code: 999999 } })) === 'permanent/message', '8) 131026 = recipient · 131009/مجهول = message');
  const det = cm(400, { error: { code: 131009, error_data: { details: 'param +20 101 234 5678 bad' } } }).detail;
  ok(8, det.includes('#') && !/\d{7,}/.test(det.replace(/\s/g, '')), '8) التفصيلة متغطية — ' + det);
  // 9
  const fe = (e) => { const v = m.classifyFetchError(e); return v.kind + ':' + v.code; };
  ok(9, fe({ name: 'TimeoutError' }) === 'unknown:timeout', '9) timeout = unknown');
  ok(9, fe(new TypeError('error sending request: connection reset')) === 'unknown:fetch_error', '9) reset = unknown (ممكن يكون وصل ميتا)');
  ok(9, fe(new TypeError('error trying to connect: dns error: failed to lookup address')) === 'transient:connect_error'
     && fe(new TypeError('tcp connect error: Connection refused')) === 'transient:connect_error', '9) dns/refused (قبل الاتصال) = transient');
  // 10
  const mv = MASK_VEC.map((v) => m.maskDigits(v));
  ok(10, JSON.stringify(mv) === JSON.stringify(MASK_SQL), '10) maskDigits = app.wa_ofd_mask على 6 متجهات — ' + mv.join(' | '));
  return R;
}

let bad = 0;
const report = (R) => { for(const r of R){ console.log(r.ok ? '  ✓' : '  ✗', r.msg); if(!r.ok) bad++; } };
const SQLTXT = fs.readFileSync(SQL, 'utf8');
const SRC = fs.readFileSync(TS, 'utf8');
const real = await import(pathToFileURL(TS).href);
console.log('── الموديول الأصلي');
report(runChecks(real, SQLTXT));
const inv = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(SRC);
console.log(!inv ? '  ✓' : '  ✗', '11) مفيش حرف خفي مكتوب حرفياً في wa-ofd.ts'); if(inv) bad++;

// ── المعايرات: نسخة مؤقتة محقونة — كل واحدة لازم توقّع الفحص بتاعها
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ofd-'));
let n = 0;
async function calib(name, patch, ids, sqlPatch){
  const out = patch ? patch(SRC) : SRC;
  if(patch && out === SRC) throw new Error('المعايرة مالقتش المرساة (درس 47): ' + name);
  const f = path.join(tmpDir, 'm' + (n++) + '.ts');
  fs.writeFileSync(f, out);
  const mod = await import(pathToFileURL(f).href);
  const sqlT = sqlPatch ? sqlPatch(SQLTXT) : SQLTXT;
  if(sqlPatch && sqlT === SQLTXT) throw new Error('المعايرة مالقتش المرساة (درس 47): ' + name);
  const R = runChecks(mod, sqlT);
  const failed = [...new Set(R.filter((r) => !r.ok).map((r) => r.id))];
  const hit = ids.every((id) => failed.includes(id));
  console.log(hit ? '  ✓' : '  ✗', 'معايرة ' + name + ': الفحص ' + ids.join('/') + ' وقع (وقع: ' + (failed.join(',') || 'ولا حاجة') + ')');
  if(!hit) bad++;
}
console.log('── المعايرات');
await calib('أ (من غير لمّ المسافات)', (s) => s.replace('.replace(/\\s+/g, " ").trim()', '.trim()'), [3]);
await calib('ب (NAME_TOKEN فضفاض)', (s) => s.replace("const NAME_TOKEN = /^[\\p{L}\\p{M}'\\u2019-]{2,25}$/u;", 'const NAME_TOKEN = /\\p{L}/u;'), [2]);
await calib('ج (131005 رجع message-permanent)', (s) => s.replace('131005, ', ''), [8]);
await calib('د (fetch_error → transient)', (s) => s.replace('return { kind: "unknown", code: "fetch_error", detail: "" };', 'return { kind: "transient", code: "fetch_error", detail: "" };'), [9]);
await calib('هـ (حرف في نص البذرة)', null, [7], (t) => t.replace("E'أهلاً {{1}}،", "E'أهلا {{1}}،"));
await calib('و (maskDigits من غير \\+? والمسافات)', (s) => s.replace('/\\+?[0-9\\u0660-\\u0669][0-9\\u0660-\\u0669\\s-]{6,}[0-9\\u0660-\\u0669]/g', '/[0-9]{8,}/g'), [8, 10]);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(bad ? '\n❌ ' + bad + ' فشل' : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
