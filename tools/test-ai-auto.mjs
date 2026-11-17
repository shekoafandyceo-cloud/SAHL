// قرار «البوت يبعت إيه» والزرار ON (16 نوفمبر) — من غير متصفح: supabase/functions/_shared/ai-auto.ts بالحرف.
//  1) skip = ولا رسالة ولا تصعيد
//  2) escalate = رسالة الاعتذار من الإعدادات (مش رد الموديل «حالاً») + ملاحظة التصعيد · والمرة التانية = سكوت والتصعيد زي ما هو
//  3) answer = رد واحد من غير تصعيد
//  4) كارت بصوره: الكلام caption على آخر صورة بس وبعدها سطر الرد · كلام أطول من 1024 = رسالة لوحدها بعد الصور
//  5) صورة مش jpg/png بتتشال · كارت من غير صور = كلامه بس
//  6) نفس الكارت اتبعت مرتين قبل كده = مايتبعتش تالت · ولو مفيش رد كمان = اعتذار وتصعيد
//  7) collect (17 نوفمبر — البوت بيسجّل الأوردر بنفسه): لسه بيجمّع = الرد من غير تصعيد · اتسجّل = رسالة التأكيد الثابتة بس ·
//     سؤال ثابت = من غير تصعيد · مايتسجّلش تلقائي = النص الثابت + «🛒 طلب شراء» بالسبب · order مع behavior تاني = مالوش أثر · السقف قبله
//  8) صورة من غير نص (قرار ثابت) = السؤال بيتبعت + تصعيد · ونفس الملاحظة من الموديل = من غير تصعيد
//  9) السقوف: بعد 10 ردود في المحادثة أو 400 في اليوم = سكوت كامل (حتى الاعتذار) + تصعيد · skip بيفضل skip
// 10) الموديل وقع (مفيش مسودة) = اعتذار + تصعيد بالسبب
// 11) نص الاعتذار الفاضي = الافتراضي
// 12) mergeEscNote: من غير تكرار · الأحدث في الآخر · بسقف
// 13) الملف من غير import · اسم البوت ثابت
// المعايرات: (أ) التصعيد بيبعت رد الموديل · (ب) الاعتذار بيتكرر · (ج) السقف مش بيتشاف · (د) caption على كل صورة ·
//            (هـ) التحويل لموظف من غير تصعيد · (ط) رد الموديل بيتبعت مع تأكيد الأوردر · (ي) collect اللي لسه بيجمّع بيتصعّد (الشكل القديم) · (و) الكارت بيتكرر · (ز) webp بيعدّي · (ح) السقف بيسيب الاعتذار يتبعت
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.join(ROOT, 'supabase/functions/_shared/ai-auto.ts');
const SRC = fs.readFileSync(TS, 'utf8');
let seq = 0;
async function load(mut) {
  if (!mut) return import(pathToFileURL(TS).href);
  const out = mut(SRC);
  if (out === SRC) throw new Error('المعايرة مالقتش المرساة');
  const f = path.join(os.tmpdir(), 'ai-auto-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, out);
  return import(pathToFileURL(f).href);
}

const T = 't1';
const HOLD = 'معلش يا فندم — مواعيد الشغل 12 لـ 7';
const D = (behavior, reply = '', card = '', note = '') => ({ behavior, intent: 'تجربة', reply, card, note });
const IN = (o) => ({ draft: null, fromModel: true, error: null, card: null, cardRepeat: 0, holdSent: false, turnsInConv: 0, turnsToday: 0, holdMessage: HOLD, ...o });
const img = (n) => T + '/quick-replies/' + n;
const CARD3 = { title: 'مطبخ', body: 'كلام الكارت بالسعر 1499', images: [img('a.jpg'), img('b.png'), img('c.jpeg')] };

function run(m) {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); };
  const texts = (p) => p.actions.filter((a) => a.kind === 'text');
  const imgs = (p) => p.actions.filter((a) => a.kind === 'image');
  let p;

  // 1
  p = m.autoPlan(IN({ draft: D('skip') }));
  ok('1 skip', p.actions.length === 0 && p.escalate === null && p.reason === 'skip');

  // 2
  p = m.autoPlan(IN({ draft: D('escalate', 'زميل هيتابع مع حضرتك حالاً', '', 'عايز يسترجع') }));
  ok('2أ escalate = اعتذار واحد من الإعدادات', p.actions.length === 1 && p.actions[0].kind === 'text' && p.actions[0].tag === 'hold' && p.actions[0].body === HOLD);
  ok('2ب رد الموديل «حالاً» مابيتبعتش', !p.actions.some((a) => a.kind === 'text' && /حالاً/.test(a.body)));
  ok('2ج ملاحظة التصعيد', p.escalate === 'عايز يسترجع' && p.reason === 'escalate');
  p = m.autoPlan(IN({ draft: D('escalate', 'x', '', 'تاني'), holdSent: true }));
  ok('2د الاعتذار مابيتكررش', p.actions.length === 0 && p.escalate === 'تاني');
  p = m.autoPlan(IN({ draft: D('escalate', 'x', '', '') }));
  ok('2هـ من غير note = intent', p.escalate === 'تجربة');

  // 3
  p = m.autoPlan(IN({ draft: D('answer', 'الشحن مجاني يا فندم') }));
  ok('3 answer', p.actions.length === 1 && p.actions[0].tag === 'reply' && p.actions[0].body === 'الشحن مجاني يا فندم' && p.escalate === null);

  // 4
  p = m.autoPlan(IN({ draft: D('answer', 'تحب حضرتك أنهي مقاس؟', 'مطبخ'), card: CARD3 }));
  ok('4أ 3 صور + سطر الرد', imgs(p).length === 3 && texts(p).length === 1 && p.actions[3].kind === 'text' && p.actions[3].tag === 'reply');
  ok('4ب caption على الأخيرة بس', imgs(p)[0].caption === null && imgs(p)[1].caption === null && imgs(p)[2].caption === CARD3.body);
  ok('4ج ترتيب الصور', imgs(p).map((a) => a.path).join() === CARD3.images.join());
  const long = 'س'.repeat(1025);
  p = m.autoPlan(IN({ draft: D('answer', '', 'مطبخ'), card: { ...CARD3, body: long } }));
  ok('4د كلام أطول من 1024 = رسالة بعد الصور', imgs(p).every((a) => a.caption === null) && texts(p).length === 1 && texts(p)[0].tag === 'card_text' && texts(p)[0].body === long && p.actions[3] === texts(p)[0]);
  p = m.autoPlan(IN({ draft: D('answer', '', 'مطبخ'), card: { ...CARD3, body: 'س'.repeat(1024) } }));
  ok('4هـ 1024 بالظبط = caption', imgs(p)[2].caption.length === 1024 && texts(p).length === 0);

  // 5
  p = m.autoPlan(IN({ draft: D('answer', '', 'مطبخ'), card: { ...CARD3, images: [img('a.webp'), img('b.jpg')] } }));
  ok('5أ webp بيتشال', imgs(p).length === 1 && imgs(p)[0].path === img('b.jpg') && imgs(p)[0].caption === CARD3.body);
  p = m.autoPlan(IN({ draft: D('answer', '', 'مطبخ'), card: { ...CARD3, images: [] } }));
  ok('5ب من غير صور = الكلام', p.actions.length === 1 && p.actions[0].tag === 'card_text' && p.actions[0].body === CARD3.body);
  p = m.autoPlan(IN({ draft: D('answer', '', 'مطبخ'), card: { ...CARD3, images: [1, 2, 3, 4, 5, 6, 7].map((n) => img(n + '.jpg')) } }));
  ok('5ج سقف 5 صور', imgs(p).length === 5 && imgs(p)[4].caption === CARD3.body);

  // 6
  p = m.autoPlan(IN({ draft: D('answer', 'اتفضل يا فندم', 'مطبخ'), card: CARD3, cardRepeat: 2 }));
  ok('6أ الكارت مايتبعتش تالت', imgs(p).length === 0 && texts(p).length === 1 && texts(p)[0].tag === 'reply');
  p = m.autoPlan(IN({ draft: D('answer', '', 'مطبخ'), card: CARD3, cardRepeat: 2 }));
  ok('6ب مفيش حاجة تتبعت = اعتذار وتصعيد', p.actions.length === 1 && p.actions[0].tag === 'hold' && !!p.escalate && p.reason === 'empty');
  p = m.autoPlan(IN({ draft: D('answer', '', 'مطبخ'), card: CARD3, cardRepeat: 1 }));
  ok('6ج مرة واحدة قبل كده = بيتبعت', imgs(p).length === 3);

  // 7
  p = m.autoPlan(IN({ draft: D('collect', 'ممكن الاسم والعنوان يا فندم؟', '', 'ناقص العنوان') }));
  ok('7أ collect لسه بيجمّع: الرد بيتبعت من غير تصعيد', p.actions.length === 1 && p.actions[0].tag === 'reply' && p.actions[0].body === 'ممكن الاسم والعنوان يا فندم؟' && p.escalate === null && p.reason === 'collect');
  const CONF = 'تم تسجيل طلب حضرتك يا فندم\nرقم الطلب: B-7';
  p = m.autoPlan(IN({ draft: D('collect', 'ثواني وهأكد لحضرتك', 'مطبخ', 'البيانات كاملة'), card: CARD3, order: { state: 'created', text: CONF } }));
  ok('7ب اتسجّل: رسالة التأكيد الثابتة بس (من غير كارت ولا رد الموديل ولا تصعيد)', p.actions.length === 1 && p.actions[0].kind === 'text' && p.actions[0].tag === 'order' && p.actions[0].body === CONF && p.escalate === null && p.reason === 'collect');
  p = m.autoPlan(IN({ draft: D('collect', 'ثواني'), order: { state: 'ask', text: 'ممكن العنوان بالتفصيل يا فندم؟' } }));
  ok('7ج سؤال ثابت: من غير تصعيد', p.actions.length === 1 && p.actions[0].tag === 'reply' && p.actions[0].body === 'ممكن العنوان بالتفصيل يا فندم؟' && p.escalate === null);
  p = m.autoPlan(IN({ draft: D('collect', 'ثواني'), order: { state: 'handoff', text: 'بياناتك اتسجلت وزميلي هيأكد', note: 'العميل ليه أوردر سابق #100 رجع' } }));
  ok('7د مايتسجّلش تلقائي: النص الثابت + «🛒 طلب شراء» بالسبب', p.actions.length === 1 && p.actions[0].body === 'بياناتك اتسجلت وزميلي هيأكد' && typeof p.escalate === 'string' && p.escalate.startsWith('🛒 طلب شراء') && p.escalate.includes('#100'));
  p = m.autoPlan(IN({ draft: D('answer', 'الشحن مجاني'), order: { state: 'created', text: CONF } }));
  ok('7هـ order مع behavior تاني = مالوش أثر', p.actions.length === 1 && p.actions[0].body === 'الشحن مجاني');
  p = m.autoPlan(IN({ draft: D('collect', 'ثواني'), order: { state: 'created', text: CONF }, turnsInConv: m.AUTO_MAX_TURNS_PER_CONV }));
  ok('7و السقف قبل الأوردر', p.actions.length === 0 && p.reason === 'conv_cap');
  p = m.autoPlan(IN({ draft: D('collect', 'ممكن الاسم؟'), order: { state: 'created', text: '  ' } }));
  ok('7ز نص فاضي = رد الموديل', p.actions.length === 1 && p.actions[0].body === 'ممكن الاسم؟');

  // 7ح–7م — تفعيل أوردر ملغي (17 نوفمبر): النص الثابت بس · اتفعّل = من غير تصعيد · مايتفعّلش تلقائي = «🔁» بالسبب · مش في التصعيد ولا بعد السقف
  const RCONF = 'تمام يا فندم، طلب حضرتك رقم 19824 اتفعّل تاني واتأكد.';
  p = m.autoPlan(IN({ draft: D('order_lookup', 'تمام يا فندم', 'مطبخ'), card: CARD3, react: { state: 'done', text: RCONF } }));
  ok('7ح اتفعّل: رسالة التأكيد الثابتة بس (من غير كارت ولا رد الموديل ولا تصعيد)', p.actions.length === 1 && p.actions[0].kind === 'text' && p.actions[0].tag === 'order' && p.actions[0].body === RCONF && p.escalate === null && p.reason === 'order_lookup');
  p = m.autoPlan(IN({ draft: D('order_lookup', 'تمام يا فندم'), react: { state: 'handoff', text: 'زميلي هيراجع الأوردر', note: 'العميل عايز يفعّل أوردر #19819 الملغي — اللي لغاه موظف' } }));
  ok('7ط مايتفعّلش تلقائي: النص الثابت + «🔁» بالسبب', p.actions.length === 1 && p.actions[0].body === 'زميلي هيراجع الأوردر' && p.actions[0].tag === 'reply' && typeof p.escalate === 'string' && p.escalate.startsWith('🔁 تفعيل أوردر ملغي') && p.escalate.includes('#19819'));
  p = m.autoPlan(IN({ draft: D('escalate', 'زميل هيتابع', '', 'شكوى'), react: { state: 'done', text: RCONF } }));
  ok('7ي التصعيد قبل التفعيل (الاعتذار الثابت مش رسالة التفعيل)', p.reason === 'escalate' && p.actions.length === 1 && p.actions[0].tag === 'hold');
  p = m.autoPlan(IN({ draft: D('order_lookup', 'تمام'), react: { state: 'done', text: RCONF }, turnsInConv: m.AUTO_MAX_TURNS_PER_CONV }));
  ok('7ك السقف قبل التفعيل', p.actions.length === 0 && p.reason === 'conv_cap');
  p = m.autoPlan(IN({ draft: D('order_lookup', 'الأوردر متسجل ملغي'), react: { state: 'done', text: ' ' } }));
  ok('7ل نص فاضي = رد الموديل', p.actions.length === 1 && p.actions[0].body === 'الأوردر متسجل ملغي');
  p = m.autoPlan(IN({ draft: D('collect', 'ثواني'), order: { state: 'created', text: CONF }, react: { state: 'done', text: RCONF } }));
  ok('7م التفعيل قبل تسجيل أوردر جديد', p.actions.length === 1 && p.actions[0].body === RCONF);

  // 8
  p = m.autoPlan(IN({ draft: D('clarify', 'ممكن حضرتك توضح المطلوب يا فندم؟', '', 'صورة من غير نص'), fromModel: false }));
  ok('8أ صورة من غير نص: السؤال + تصعيد', p.actions.length === 1 && p.actions[0].tag === 'reply' && p.escalate === 'صورة من غير نص');
  p = m.autoPlan(IN({ draft: D('clarify', 'ممكن توضيح للمنتج يا فندم؟', '', 'مش واضح المنتج') }));
  ok('8ب توضيح من الموديل = من غير تصعيد', p.actions.length === 1 && p.escalate === null);
  p = m.autoPlan(IN({ draft: D('order_lookup', 'الأوردر في الطريق يا فندم') }));
  ok('8ج order_lookup', p.actions.length === 1 && p.escalate === null && p.reason === 'order_lookup');

  // 9
  p = m.autoPlan(IN({ draft: D('answer', 'رد'), turnsInConv: m.AUTO_MAX_TURNS_PER_CONV }));
  ok('9أ سقف المحادثة = سكوت + تصعيد', p.actions.length === 0 && !!p.escalate && p.reason === 'conv_cap');
  p = m.autoPlan(IN({ draft: D('escalate', 'x', '', 'n'), turnsInConv: m.AUTO_MAX_TURNS_PER_CONV }));
  ok('9ب السقف بيسكّت الاعتذار كمان', p.actions.length === 0 && p.reason === 'conv_cap');
  p = m.autoPlan(IN({ draft: D('answer', 'رد'), turnsInConv: m.AUTO_MAX_TURNS_PER_CONV - 1 }));
  ok('9ج تحت السقف بيرد', p.actions.length === 1 && p.reason === 'answer');
  p = m.autoPlan(IN({ draft: D('answer', 'رد'), turnsToday: m.AUTO_MAX_TURNS_PER_DAY }));
  ok('9د سقف اليوم', p.actions.length === 0 && p.reason === 'day_cap' && !!p.escalate);
  p = m.autoPlan(IN({ draft: D('skip'), turnsInConv: 99, turnsToday: 9999 }));
  ok('9هـ skip تحت السقف = من غير تصعيد', p.actions.length === 0 && p.escalate === null);
  p = m.autoPlan(IN({ draft: null, error: 'x', turnsInConv: m.AUTO_MAX_TURNS_PER_CONV }));
  ok('9و السقف قبل «مفيش مسودة»', p.actions.length === 0 && p.reason === 'conv_cap');

  // 10
  p = m.autoPlan(IN({ draft: null, error: 'gemini_timeout' }));
  ok('10 مفيش مسودة = اعتذار + تصعيد بالسبب', p.actions.length === 1 && p.actions[0].tag === 'hold' && /gemini_timeout/.test(p.escalate || '') && p.reason === 'no_draft');

  // 10ب — الموديل واقف (رصيد/مفتاح Gemini): تصعيد ساكت من غير رسالة اعتذار (wa-ai-draft بيرجّع الزرار OFF)
  p = m.autoPlan(IN({ draft: null, error: 'gemini_402: Your prepayment credits are depleted.' }));
  ok('10ب رصيد Gemini خلص = من غير رسالة', p.actions.length === 0 && p.reason === 'model_down' && /Gemini/.test(p.escalate || ''));
  ok('10ج no_gemini_key/403 برضه · 429/500/timeout لأ', m.modelDown('no_gemini_key') && m.modelDown('gemini_403: x') && !m.modelDown('gemini_429: quota') && !m.modelDown('gemini_500: x') && !m.modelDown('gemini_timeout') && !m.modelDown(null));

  // 11
  p = m.autoPlan(IN({ draft: D('escalate', '', '', 'n'), holdMessage: '   ' }));
  ok('11 الافتراضي', p.actions[0].body === m.HOLD_DEFAULT && /المساعد الآلي/.test(m.HOLD_DEFAULT));

  // 12
  ok('12أ جديد بس', m.mergeEscNote(null, 'ب') === 'ب');
  ok('12ب من غير تكرار', m.mergeEscNote('أ · ب', 'ب') === 'أ · ب' && m.mergeEscNote('ب', 'ب') === 'ب');
  ok('12ج الأحدث في الآخر', m.mergeEscNote('أ', 'ب') === 'أ · ب');
  ok('12د فاضي = القديم', m.mergeEscNote('أ', '') === 'أ' && m.mergeEscNote('', '') === null);
  ok('12هـ بسقف', m.mergeEscNote('أ'.repeat(500), 'ب'.repeat(100)).length <= 560);

  // 13
  ok('13أ من غير import', !/^\s*import\s/m.test(SRC));
  ok('13ب اسم البوت', m.BOT_NAME === '🤖 AI Agent');
  ok('13ج isSendableImage', m.isSendableImage('t/quick-replies/a.JPG') && !m.isSendableImage('t/quick-replies/a.webp') && !m.isSendableImage('t/../a.jpg') && !m.isSendableImage(null));
  return fails;
}

let bad = 0;
const fails = run(await load());
if (fails.length) { bad++; console.log('✗ وقع: ' + fails.join(' | ')); } else console.log('✓ 13 فحص عدّوا');

const CALS = [
  ['(ل) رصيد Gemini خلص = رسالة اعتذار لكل عميل', (s) => s.replace('if (!d && modelDown(i.error))', 'if (false)'), '10ب'],
  ['(أ) التصعيد بيبعت رد الموديل', (s) => s.replace('return { actions: hold(), escalate: cut(String(d.note || d.intent || "محتاجة موظف").trim(), 400), reason: "escalate" };',
    'return { actions: [{ kind: "text", body: d.reply, tag: "reply" }], escalate: cut(String(d.note || d.intent || "محتاجة موظف").trim(), 400), reason: "escalate" };'), '2أ'],
  ['(ب) الاعتذار بيتكرر', (s) => s.replace('(i.holdSent ? [] : [{ kind: "text", body: holdText, tag: "hold" }])', '([{ kind: "text", body: holdText, tag: "hold" }])'), '2د'],
  ['(ج) سقف المحادثة مش بيتشاف', (s) => s.replace('if (i.turnsInConv >= AUTO_MAX_TURNS_PER_CONV)', 'if (false)'), '9أ'],
  ['(د) caption على كل صورة', (s) => s.replace('caption: inCaption && i === imgs.length - 1 ? body : null', 'caption: inCaption ? body : null'), '4ب'],
  ['(هـ) التحويل لموظف من غير تصعيد', (s) => s.replace('escalate: cut("🛒 طلب شراء — " + (String(o.note || "").trim() || "راجع البيانات وسجّل الأوردر"), 400), reason: "collect" };', 'escalate: null, reason: "collect" };'), '7د'],
  ['(ن) رد الموديل بيتبعت بدل تأكيد التفعيل', (s) => s.replace('if (i.react && String(i.react.text || "").trim()) {', 'if (false) {'), '7ح'],
  ['(س) مايتفعّلش تلقائي من غير تصعيد', (s) => s.replace('escalate: cut("🔁 تفعيل أوردر ملغي — " + (String(x.note || "").trim() || "راجع الأوردر وفعّله"), 400), reason: d.behavior };', 'escalate: null, reason: d.behavior };'), '7ط'],
  ['(ع) التفعيل قبل التصعيد', (s) => {
    const a = '  // تفعيل أوردر ملغي: النص الثابت بس', b = '  // الأوردر: بيانات كملت';
    const i0 = s.indexOf(a), i1 = s.indexOf(b), e = '  if (d.behavior === "escalate")';
    if (i0 < 0 || i1 < 0 || !s.includes(e)) return s;
    const block = s.slice(i0, i1);
    return s.replace(block, '').replace(e, block + e);
  }, '7ي'],
  ['(ط) رد الموديل بيتبعت مع تأكيد الأوردر', (s) => s.replace('if (d.behavior === "collect" && i.order && String(i.order.text || "").trim()) {', 'if (false) {'), '7ب'],
  ['(ي) collect اللي لسه بيجمّع بيتصعّد (الشكل القديم)', (s) => s.replace('  if (!i.fromModel && note) escalate = cut(note, 400);', '  if (d.behavior === "collect") escalate = "🛒 طلب شراء"; else if (!i.fromModel && note) escalate = cut(note, 400);'), '7أ'],
  ['(ك) الأوردر قبل السقف', (s) => {
    const a = '  // الأوردر: بيانات كملت → النص الثابت بس (من غير كارت ولا رد الموديل)\n';
    const i0 = s.indexOf(a), i1 = s.indexOf('  const actions: AutoAction[] = [];');
    const cap = '  // السقوف قبل أي حاجة تانية: بعدها البوت بيسكت خالص\n';
    if (i0 < 0 || i1 < 0 || !s.includes(cap)) return s;
    const block = s.slice(i0, i1);
    return s.replace(block, '').replace(cap, block.replace('if (d.behavior === "collect"', 'if (d && d.behavior === "collect"') + cap);
  }, '7و'],
  ['(و) الكارت بيتكرر', (s) => s.replace('if (i.card && i.cardRepeat < AUTO_MAX_CARD_REPEAT)', 'if (i.card)'), '6أ'],
  ['(ز) webp بيعدّي', (s) => s.replace('(card.images || []).filter(isSendableImage)', '(card.images || [])'), '5أ'],
  ['(ح) السقف بعد التصعيد (الاعتذار بيتبعت)', (s) => {
    const cap = '  if (i.turnsInConv >= AUTO_MAX_TURNS_PER_CONV)\n    return { actions: [], escalate: "البوت رد " + i.turnsInConv + " مرات في المحادثة دي ووقف — كمّل إنت مع العميل", reason: "conv_cap" };\n';
    const esc = '  if (d.behavior === "escalate")\n    return { actions: hold(), escalate: cut(String(d.note || d.intent || "محتاجة موظف").trim(), 400), reason: "escalate" };\n';
    if (!s.includes(cap) || !s.includes(esc)) return s;
    return s.replace(cap, '').replace(esc, esc + cap.replace('i.turnsInConv >= AUTO', 'i.turnsInConv >= AUTO'));
  }, '9ب'],
];
for (const [name, mut, expect] of CALS) {
  let f;
  try { f = run(await load(mut)); } catch (e) { bad++; console.log('✗ معايرة ' + name + ': ' + e.message); continue; }
  if (f.some((x) => x.startsWith(expect))) console.log('✓ معايرة ' + name + ' — اتمسكت (' + expect + ')');
  else { bad++; console.log('✗ معايرة ' + name + ' عدّت من غير ما الفحص ' + expect + ' يقع — وقع: ' + (f.join(' | ') || 'ولا حاجة')); }
}
process.exit(bad ? 1 : 0);
