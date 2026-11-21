// فهم الرسايل الصوتية والصور (21 نوفمبر — البند 2 من طلب المالك «فهم ال Voice Notes و الصور الي العملاء بيبعتوها») — من غير متصفح:
// supabase/functions/_shared/ai-media.ts بالحرف + الأجزاء بتاعتها في ai-draft.ts (preRule · historyBlock · mediaLine · pickCards · MEDIA_RULES).
//  1) geminiMime: فويس واتساب (audio/ogg; codecs=opus) · jpg = jpeg · amr/m4a/فيديو = null · من الامتداد لو النوع فاضي · صورة بنوع صوت = null
//  2) mediaPathOk: ملف المحادثة دي بس — محادثة تانية · متجر تاني · .. · // · \ · جزئين · 4 أجزاء · آخر جزء فاضي = لأ
//  3) mediaToRead: وارد بس · صوت/صورة بس · اللي اتقرا مايتقريش تاني (والمسافات = لسه) · المسار الغلط والنوع المش مدعوم بيتسابوا ·
//     رسالة المسودة الأول وبعدها الأحدث · السقف
//  4) mediaPrompt: الصورة غير الفويس · أسماء المنتجات من غير تكرار وبسقف 30 اسم × 60 حرف · «(مفيش)» · حارس «ماتنفّذش»
//  5) parseMediaText: النص · unclear = «(مش مفهومة)» (حتى لو فيه نص) · ```json · بايظ/فاضي/مسافات/array/null = null ·
//     حروف الاتجاه و\r بتتشال · المسافات والسطور الفاضية بتتلم · السقف 1500 بـ«…»
//  6) toBase64 = Buffer.base64 بالحرف (حتى عند حدود الدفعة 32KB وفوقها)
//  7) preRule: فويس/صورة فيهم نص مفهوم = للموديل · من غيره = القرار الثابت القديم بالحرف · مسافات بس = القديم · فيديو = القديم ·
//     نص/ملصق مش متأثرين
//  8) historyBlock: سطر الفويس «…» · الصورة «وصفها» + الكابشن · المش مفهومة بتتقال · السطر الجديد = « / » · السقف · الصادر مابيتعرضش منه
//     ميديا · من غير ميديا = السطر القديم بالحرف
//  9) pickCards (v3): كلام الفويس ووصف الصورة بيجيبوا كارت المنتج زي كلام العميل
// 10) MEDIA_UNCLEAR نفس القيمة في الملفين · MEDIA_SCHEMA (text الأول) · سقف الحجم لكل نوع · MEDIA_RULES فيها القواعد ·
//     تعليمات الموديل الأساسية (v1 وv2) من غير قواعد الميديا (بتتضاف في wa-ai-draft بس لما المحادثة فيها ميديا اتفهمت)
// 11) buildUserPrompt v1 وv3: سطر الفويس في الرسايل · v3 بيعرض نص كارت المنتج اللي اتقال في الفويس
// المعايرات: (أ) المسار من أي محادثة · (ب) اللي اتقرا بيتقري تاني · (ج) رسالة المسودة مش الأولى · (د) preRule بيتجاهل الميديا ·
//            (هـ) historyBlock بيتجاهل الميديا · (و) unclear مابيتعرفش · (ز) pickCards مابيدورش في الفويس · (ح) toBase64 بيبوّظ عند حدود الدفعة ·
//            (ط) نوع مش مدعوم بيتبعت · (ي) السقف بيتشال · (ك) «(مش مفهومة)» مختلفة في الملفين · (ل) حروف الاتجاه مابتتشالش ·
//            (م) السطر الجديد مابيتلمّش · (ن) ميديا الرسالة الصادرة بتتعرض
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSM = path.join(ROOT, 'supabase/functions/_shared/ai-media.ts');
const TSD = path.join(ROOT, 'supabase/functions/_shared/ai-draft.ts');
const SRCM = fs.readFileSync(TSM, 'utf8'), SRCD = fs.readFileSync(TSD, 'utf8');
let seq = 0;
async function load(file, src, mut) {
  if (!mut) return import(pathToFileURL(file).href);
  const out = mut(src);
  if (out === src) throw new Error('المعايرة مالقتش المرساة');
  const f = path.join(os.tmpdir(), 'ai-media-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, out);
  return import(pathToFileURL(f).href);
}

const NL = String.fromCharCode(10), CR = String.fromCharCode(13), TAB = String.fromCharCode(9);
const BIDI = [0x200b, 0x200f, 0x202b, 0x2066, 0xfeff].map((c) => String.fromCharCode(c));
const T = '9c58b214-f11d-4de5-afc7-a0de0b903f36', C = 'a391bca8-d5ec-4d5d-a981-fe1929d43d2a';
const at = (m) => '2026-11-21T10:' + String(m).padStart(2, '0') + ':00Z';
const ROWS = [
  { id: 'm1', direction: 'in', type: 'voice', created_at: at(0), media_path: T + '/' + C + '/m1.ogg', media_mime: 'audio/ogg; codecs=opus' },
  { id: 'm2', direction: 'in', type: 'image', created_at: at(5), media_path: T + '/' + C + '/m2.jpg', media_mime: 'image/jpeg' },
  { id: 'm3', direction: 'in', type: 'image', created_at: at(6), media_path: T + '/' + C + '/m3.jpg', media_mime: 'image/jpeg', ai_media_text: 'اتقرت قبل كده' },
  { id: 'm4', direction: 'out', type: 'image', created_at: at(7), media_path: T + '/' + C + '/m4.jpg', media_mime: 'image/jpeg' },
  { id: 'm5', direction: 'in', type: 'video', created_at: at(8), media_path: T + '/' + C + '/m5.mp4', media_mime: 'video/mp4' },
  { id: 'm6', direction: 'in', type: 'voice', created_at: at(9), media_path: T + '/other-conv/m6.ogg', media_mime: 'audio/ogg' },
  { id: 'm7', direction: 'in', type: 'audio', created_at: at(10), media_path: T + '/' + C + '/m7.amr', media_mime: 'audio/amr' },
  { id: 'm8', direction: 'in', type: 'voice', created_at: at(11), media_path: T + '/' + C + '/m8.ogg', media_mime: 'audio/ogg; codecs=opus' },
  { id: 'm9', direction: 'in', type: 'text', created_at: at(12), body: 'بكام' },
  { id: 'm10', direction: 'in', type: 'image', created_at: at(13), media_path: T + '/' + C + '/m10.png', media_mime: 'image/png', ai_media_text: '   ' },
  { id: 'm11', direction: 'in', type: 'voice', created_at: at(14), media_path: T + '/' + C + '/m11.ogg', media_mime: 'audio/ogg; codecs=opus' },
];
const CARDS = [
  { id: 'c1', title: 'مطبخ', body: 'أهلاً بحضرتك 🙏🏼💙' + NL + '✨ منظم المطبخ المتكامل فوق الحوض ✨' + NL + '✔️ مكان مرتب للأطباق' },
  { id: 'c2', title: 'راديو', body: 'أهلاً بحضرتك' + NL + 'راديو بلوتوث كلاسيك — بسعر 650 جنيه' },
  { id: 'c3', title: 'تيربو', body: 'أهلاً بحضرتك' + NL + 'تيربو بريمو 5 دور — رف الأطباق' },
  { id: 'c4', title: 'حمام', body: 'أهلاً بحضرتك' + NL + 'طقم الحمام الفاخر — 6 قطع' },
];
const ctxOf = (history) => ({
  nowIso: '2026-11-21T19:00:00Z', facts: {}, products: [], linkedProductId: null, ad: null, cards: CARDS,
  siteRows: [], stockNames: [], orders: [], ordersKnown: true, customerName: null, history,
});
const OLD_VOICE = { behavior: 'escalate', intent: 'رسالة صوتية', reply: '', card: '', note: 'رسالة صوتية — محتاجة زميل يسمعها ويرد.' };
const OLD_IMAGE = { behavior: 'clarify', intent: 'صورة من غير نص', reply: 'ممكن حضرتك توضح المطلوب يا فندم؟', card: '', note: 'صورة من غير نص — المساعد مابيشوفش الصور، راجعها قبل الإرسال.' };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function run(m, d) {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); };
  let r, p, h;

  // 1) geminiMime
  ok('1أ فويس واتساب', m.geminiMime('voice', 'audio/ogg; codecs=opus') === 'audio/ogg');
  ok('1ب mp3 · jpg · PNG', m.geminiMime('audio', 'audio/mpeg') === 'audio/mp3' && m.geminiMime('image', 'image/jpg') === 'image/jpeg' && m.geminiMime('image', 'IMAGE/PNG') === 'image/png');
  ok('1ج amr/m4a/فيديو = null', m.geminiMime('audio', 'audio/amr') === null && m.geminiMime('audio', 'audio/mp4') === null && m.geminiMime('video', 'video/mp4') === null);
  ok('1د صورة بنوع صوت = null', m.geminiMime('image', 'audio/ogg') === null && m.geminiMime('voice', 'image/jpeg') === null);
  ok('1هـ من الامتداد لو النوع فاضي', m.geminiMime('voice', null, T + '/' + C + '/x.ogg') === 'audio/ogg' && m.geminiMime('image', '', 'a/b/c.webp') === 'image/webp' && m.geminiMime('image', null, 'a/b/c') === null);

  // 2) mediaPathOk
  ok('2أ مسار المحادثة دي', m.mediaPathOk(T, C, T + '/' + C + '/x.ogg') === true);
  ok('2ب محادثة تانية / متجر تاني', m.mediaPathOk(T, C, T + '/other-conv/x.ogg') === false && m.mediaPathOk(T, C, 'other-tenant/' + C + '/x.ogg') === false);
  ok('2ج .. و// و\\', m.mediaPathOk(T, C, T + '/' + C + '/../x.ogg') === false && m.mediaPathOk(T, C, T + '/' + C + '//x') === false && m.mediaPathOk(T, C, T + '\\' + C + '\\x.ogg') === false);
  ok('2د عدد الأجزاء', m.mediaPathOk(T, C, T + '/' + C) === false && m.mediaPathOk(T, C, T + '/' + C + '/a/b.ogg') === false && m.mediaPathOk(T, C, T + '/' + C + '/') === false);
  ok('2هـ مش نص / متجر فاضي', m.mediaPathOk(T, C, null) === false && m.mediaPathOk(T, C, 123) === false && m.mediaPathOk('', C, T + '/' + C + '/x.ogg') === false);

  // 3) mediaToRead
  const ids = (xs) => xs.map((x) => x.id).join(',');
  r = m.mediaToRead(ROWS, T, C, 'm1');
  ok('3أ الوارد المدعوم اللي لسه مااتقراش بس', ids(m.mediaToRead(ROWS, T, C, 'm1', 99)) === 'm1,m11,m10,m8,m2');
  ok('3ب رسالة المسودة الأول وبعدها الأحدث (والسقف 4)', ids(r) === 'm1,m11,m10,m8' && m.MEDIA_MAX_PER_DRAFT === 4);
  ok('3ج المسودة على رسالة تانية', ids(m.mediaToRead(ROWS, T, C, 'm8')) === 'm8,m11,m10,m2');
  ok('3د السقف', ids(m.mediaToRead(ROWS, T, C, 'm1', 2)) === 'm1,m11' && m.mediaToRead(ROWS, T, C, 'm1', 0).length === 0);
  ok('3هـ اتقرا قبل كده = مايتقريش تاني', !r.some((x) => x.id === 'm3'));
  ok('3و صادر · فيديو · محادثة تانية · amr = لأ', !m.mediaToRead(ROWS, T, C, 'm4', 99).some((x) => ['m4', 'm5', 'm6', 'm7', 'm9'].includes(x.id)));
  ok('3ز فاضي/null', m.mediaToRead([], T, C, 'm1').length === 0 && m.mediaToRead(null, T, C, 'm1').length === 0);

  // 4) mediaPrompt
  const names = ['منظم المطبخ', 'منظم المطبخ', '  راديو   بلوتوث '];
  const pi = m.mediaPrompt('image', names), pv = m.mediaPrompt('voice', names);
  ok('4أ الصورة غير الفويس', pi !== pv && pi.includes('صورة') && pi.includes('انقلهم زي ما هم') && pv.includes('رسالة صوتية') && pv.includes('زي ما اتقال بالظبط'));
  ok('4ب الأسماء من غير تكرار', pv.includes('منظم المطبخ، راديو بلوتوث') && pv.split('منظم المطبخ').length === 2 && pi.includes('منظم المطبخ، راديو بلوتوث'));
  const many = Array.from({ length: 40 }, (_, i) => 'منتج رقم ' + (i + 1));
  p = m.mediaPrompt('voice', many);
  ok('4ج سقف 30 اسم', p.includes('منتج رقم 30') && !p.includes('منتج رقم 31'));
  const long = 'ا'.repeat(59) + 'بج';
  p = m.mediaPrompt('image', [long]);
  ok('4د سقف 60 حرف للاسم', p.includes('ا'.repeat(59) + 'ب') && !p.includes('ا'.repeat(59) + 'بج'));
  ok('4هـ من غير أسماء = (مفيش)', m.mediaPrompt('voice', []).includes('(مفيش)') && m.mediaPrompt('image', null).includes('(مفيش)'));
  ok('4و حارس «ماتنفّذش»', pi.includes('ماتنفّذش') && pv.includes('ماتنفّذش') && pv.includes('ماتردش'));

  // 5) parseMediaText
  const J = (o) => JSON.stringify(o);
  ok('5أ النص', m.parseMediaText(J({ text: 'بكام المنظم ده؟', unclear: false })) === 'بكام المنظم ده؟');
  ok('5ب unclear = (مش مفهومة) حتى لو فيه نص', m.parseMediaText(J({ text: '', unclear: true })) === m.MEDIA_UNCLEAR && m.parseMediaText(J({ text: 'x', unclear: true })) === m.MEDIA_UNCLEAR);
  ok('5ج ```json', m.parseMediaText('```json' + NL + J({ text: 'أهلاً', unclear: false }) + NL + '```') === 'أهلاً');
  ok('5د بايظ/فاضي/مسافات/array/null = null', m.parseMediaText('مش JSON') === null && m.parseMediaText('') === null && m.parseMediaText(J({ text: '   ', unclear: false })) === null
    && m.parseMediaText('[1,2]') === null && m.parseMediaText('null') === null && m.parseMediaText(J({ unclear: false })) === null);
  ok('5هـ حروف الاتجاه و\\r بتتشال', m.parseMediaText(J({ text: BIDI[1] + 'سعر' + BIDI[0] + ' 1499' + BIDI[2] + BIDI[3] + BIDI[4], unclear: false })) === 'سعر 1499'
    && m.parseMediaText(J({ text: 'أ' + CR + NL + 'ب', unclear: false })) === 'أ' + NL + 'ب');
  ok('5و المسافات والسطور الفاضية بتتلم', m.parseMediaText(J({ text: 'أ  ' + TAB + ' ب' + NL + NL + NL + NL + 'ج', unclear: false })) === 'أ ب' + NL + NL + 'ج');
  r = m.parseMediaText(J({ text: 'ا'.repeat(2000), unclear: false }));
  ok('5ز السقف 1500 بـ«…»', r.length === 1500 && r.endsWith('…') && m.MEDIA_TEXT_MAX === 1500);

  // 6) toBase64
  let b64ok = true;
  for (const n of [0, 1, 2, 3, 100, 0x8000 - 1, 0x8000, 0x8000 + 1, 70001]) {
    const buf = new Uint8Array(n);
    for (let i = 0; i < n; i++) buf[i] = (i * 131 + 7 * (i >> 8)) & 255;
    if (m.toBase64(buf) !== Buffer.from(buf).toString('base64')) b64ok = false;
  }
  ok('6 toBase64 = Buffer (حتى عند حدود الدفعة)', b64ok);

  // 7) preRule
  ok('7أ فويس فيه نص مفهوم = للموديل', d.preRule('voice', '', 'السلام عليكم بكام المنظم') === null && d.preRule('audio', null, 'عايز أرجّعه') === null);
  ok('7ب فويس من غير نص = القرار القديم بالحرف', same(d.preRule('voice', '', null), OLD_VOICE) && same(d.preRule('audio', ''), OLD_VOICE) && same(d.preRule('voice', '', '   '), OLD_VOICE));
  ok('7ج صورة من غير كلام فيها وصف = للموديل', d.preRule('image', '', 'سكرين شوت تحويل 1499 جنيه') === null);
  ok('7د صورة من غير كلام ولا وصف = السؤال القديم بالحرف', same(d.preRule('image', '', null), OLD_IMAGE) && same(d.preRule('image', '  ', ''), OLD_IMAGE));
  ok('7هـ صورة بكابشن = للموديل زي الأول', d.preRule('image', 'بكام ده؟', null) === null);
  ok('7و فيديو = زي الأول حتى لو فيه نص', d.preRule('video', '', 'أي حاجة')?.behavior === 'escalate');
  ok('7ز نص/ملصق مش متأثرين', d.preRule('text', 'بكام', 'x') === null && d.preRule('text', '', 'x')?.behavior === 'skip' && d.preRule('sticker', '', 'x')?.behavior === 'skip');

  // 8) historyBlock
  h = (hist) => d.historyBlock(ctxOf(hist));
  ok('8أ سطر الفويس «…» والسطر الجديد « / »', h([{ dir: 'in', type: 'voice', body: '', media: 'سطر أول' + NL + NL + 'سطر تاني' }]) === 'العميل: [رسالة صوتية — اللي اتقال فيها: «سطر أول / سطر تاني»]');
  ok('8ب الصورة «وصفها» + الكابشن', h([{ dir: 'in', type: 'image', body: 'متوفر أبيض؟', media: 'صورة منظم مطبخ أسود' }]) === 'العميل: [صورة — وصفها: صورة منظم مطبخ أسود] متوفر أبيض؟');
  ok('8ج المش مفهومة بتتقال', h([{ dir: 'in', type: 'voice', body: '', media: d.MEDIA_UNCLEAR }]) === 'العميل: [رسالة صوتية — مش مفهومة ومفيهاش كلام واضح]'
    && h([{ dir: 'in', type: 'image', body: '', media: d.MEDIA_UNCLEAR }]) === 'العميل: [صورة — مش واضحة ومحدش فهم فيها حاجة]');
  r = h([{ dir: 'in', type: 'voice', body: '', media: 'ب'.repeat(2000) }]);
  ok('8د سقف كلام الفويس', r.length < 960 && r.includes('…»]'));
  ok('8هـ الصادر مابيتعرضش منه ميديا', h([{ dir: 'out', type: 'image', body: 'اتفضل', media: 'وصف مش مفروض يبان' }]) === 'إحنا: [صورة] اتفضل');
  ok('8و من غير ميديا = السطر القديم بالحرف', h([{ dir: 'in', type: 'voice', body: '' }]) === 'العميل: [رسالة صوتية] ' && h([{ dir: 'in', type: 'image', body: 'بكام', media: null }]) === 'العميل: [صورة] بكام'
    && h([{ dir: 'in', type: 'text', body: 'بكام' }]) === 'العميل: بكام');

  // 9) pickCards
  const pk = (hist) => (d.pickCards(ctxOf(hist)) || []).map((c) => c.id).join(',');
  ok('9أ كلام الفويس بيجيب الكارت', pk([{ dir: 'in', type: 'voice', body: '', media: 'عايز أعرف سعر الراديو البلوتوث' }]) === 'c2');
  ok('9ب وصف الصورة بيجيب الكارت', pk([{ dir: 'in', type: 'image', body: '', media: 'صورة منظم مطبخ أسود فوق حوض' }]) === 'c1');
  ok('9ج فويس مش مفهوم = مفيش كارت (الكل)', d.pickCards(ctxOf([{ dir: 'in', type: 'voice', body: '', media: d.MEDIA_UNCLEAR }])) === null);

  // 10) الثوابت والتعليمات
  ok('10أ «(مش مفهومة)» نفس القيمة في الملفين', m.MEDIA_UNCLEAR === d.MEDIA_UNCLEAR && m.MEDIA_UNCLEAR === '(مش مفهومة)');
  ok('10ب MEDIA_SCHEMA', m.MEDIA_SCHEMA.propertyOrdering[0] === 'text' && m.MEDIA_SCHEMA.required.includes('unclear') && m.MEDIA_SCHEMA.properties.unclear.type === 'BOOLEAN');
  ok('10ج سقف الحجم لكل نوع', m.MEDIA_TYPES.every((t) => m.MEDIA_MAX_BYTES[t] > 0 && m.MEDIA_MAX_BYTES[t] <= 5 * 1024 * 1024));
  ok('10د MEDIA_RULES فيها القواعد', d.MEDIA_RULES.startsWith('# الرسايل الصوتية والصور') && d.MEDIA_RULES.includes('(clarify)') && d.MEDIA_RULES.includes('إيصال دفع = escalate')
    && d.MEDIA_RULES.includes('ماتقولش للعميل إن فيه سيستم'));
  ok('10هـ التعليمات الأساسية من غير قواعد الميديا', !d.buildSystemPrompt().includes('# الرسايل الصوتية والصور') && !d.buildSystemPrompt({ esc: 'v2', hours: 'من 12 لـ 7' }).includes('# الرسايل الصوتية والصور'));

  // 11) buildUserPrompt
  const hv = [{ dir: 'in', type: 'text', body: 'السلام عليكم' }, { dir: 'in', type: 'voice', body: '', media: 'عايز أعرف سعر الراديو البلوتوث' }];
  const line = 'العميل: [رسالة صوتية — اللي اتقال فيها: «عايز أعرف سعر الراديو البلوتوث»]';
  const u1 = d.buildUserPrompt(ctxOf(hv), 'v1'), u3 = d.buildUserPrompt(ctxOf(hv), 'v3');
  ok('11أ v1 فيه سطر الفويس', u1.includes(line));
  ok('11ب v3 فيه سطر الفويس ونص كارت الراديو بس', u3.includes(line) && u3.includes('# نص كروت المحادثة دي') && u3.includes('### كارت «راديو»') && !u3.includes('### كارت «حمام»'));
  return fails;
}

let bad = 0;
const base = run(await load(TSM, SRCM), await load(TSD, SRCD));
if (base.length) { bad++; console.log('✗ وقع: ' + base.join(' | ')); } else console.log('✓ 11 فحص عدّوا');

const M0 = await load(TSM, SRCM), D0 = await load(TSD, SRCD);
const CALS = [
  ['(أ) المسار من أي محادثة', 'm', (s) => s.replace('parts[0] === tenantId && parts[1] === convId && !!parts[2]', 'parts[0] === tenantId && !!parts[2]'), '2ب'],
  ['(ب) اللي اتقرا بيتقري تاني', 'm', (s) => s.replace('&& !String(r.ai_media_text || "").trim() ', ''), '3أ'],
  ['(ج) رسالة المسودة مش الأولى', 'm', (s) => s.replace('a.id === triggerId ? -1 : b.id === triggerId ? 1 : ', ''), '3ب'],
  ['(د) preRule بيتجاهل الميديا', 'd', (s) => s.replace('if ((t === "audio" || t === "voice" || t === "image") && String(media || "").trim()) return null;', ''), '7أ'],
  ['(هـ) historyBlock بيتجاهل الميديا', 'd', (s) => s.replace('if (media) return who + ": " + mediaLine(', 'if (false) return who + ": " + mediaLine('), '8أ'],
  ['(و) unclear مابيتعرفش', 'm', (s) => s.replace('if (o.unclear === true) return MEDIA_UNCLEAR;', ''), '5ب'],
  ['(ز) pickCards مابيدورش في الفويس', 'd', (s) => s.replace('if (media && media !== MEDIA_UNCLEAR) texts.push(media);', ''), '9أ'],
  ['(ح) toBase64 بيبوّظ عند حدود الدفعة', 'm', (s) => s.replace('i += 0x8000)', 'i += 0x7fff)'), '6'],
  ['(ط) نوع مش مدعوم بيتبعت', 'm', (s) => s.replace('return AUDIO_OK[base] || null;', 'return AUDIO_OK[base] || base || null;'), '1ج'],
  ['(ي) السقف بيتشال', 'm', (s) => s.replace('return ok.slice(0, Math.max(0, max));', 'return ok;'), '3ب'],
  ['(ك) «(مش مفهومة)» مختلفة في الملفين', 'd', (s) => s.replace('export const MEDIA_UNCLEAR = "(مش مفهومة)";', 'export const MEDIA_UNCLEAR = "(مش واضحة)";'), '10أ'],
  ['(ل) حروف الاتجاه مابتتشالش', 'm', (s) => s.replace(/\.replace\(\/\[[^\]]*\]\/g, ""\)/, ''), '5هـ'],
  ['(م) السطر الجديد مابيتلمّش', 'd', (s) => s.replace('const flat = media.replace(/\\s*\\n+\\s*/g, " / ");', 'const flat = media;'), '8أ'],
  ['(ن) ميديا الرسالة الصادرة بتتعرض', 'd', (s) => s.replace('const media = m.dir === "in" ? String(m.media || "").trim() : "";' + NL + '  if (media) return who', 'const media = String(m.media || "").trim();' + NL + '  if (media) return who'), '8هـ'],
];
for (const [name, which, mut, expect] of CALS) {
  let f;
  try { f = which === 'm' ? run(await load(TSM, SRCM, mut), D0) : run(M0, await load(TSD, SRCD, mut)); } catch (e) { bad++; console.log('✗ معايرة ' + name + ': ' + e.message); continue; }
  if (f.some((x) => x.startsWith(expect))) console.log('✓ معايرة ' + name + ' — اتمسكت (' + expect + ')');
  else { bad++; console.log('✗ معايرة ' + name + ' عدّت من غير ما الفحص ' + expect + ' يقع — وقع: ' + (f.join(' | ') || 'ولا حاجة')); }
}
process.exit(bad ? 1 : 0);
