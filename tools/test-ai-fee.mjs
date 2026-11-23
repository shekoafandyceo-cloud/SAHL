// رسوم الإلغاء بعد الشحن (23 نوفمبر — طلب المالك) — من غير متصفح: supabase/functions/_shared/ai-fee.ts و ai-draft.ts بالحرف.
//  1) الإعداد (facts.cancel_fee): سليم = الحقول · مبلغ مش رقم/صفر/فوق 1000 = مقفولة · رقم مش موبايل = مقفولة · أرقام هندية بتتحوّل · followups
//  2) «مع شركة الشحن»: حالات بعد الاستلام بس · قبل الاستلام لازم مسح من J&T · متسلّم/ملغي/مؤكد/مرتجع = لأ
//  3) الرد فيه رقم التحويل (بمسافات · أرقام هندية) = طلب · رقم تاني = لأ
//  4) الحدث: الطلب بيتسجّل بس لما الرد اتبعت فعلاً ولأوردر مع شركة الشحن · صورة بعد الطلب = paid · رفض/هيستلم/حوّل من الموديل ·
//     البوت سأل تاني (fee=request أو الرقم في الرد) = again · من غير طلب مفتوح = مفيش · سطر الموظف (صورة ≠ كلام · again = مفيش سطر)
//  5) التذكير: الحد 3 · النافذة (24 ساعة − نص ساعة) · 10 الصبح لـ 10 بالليل · 3 ساعات للأول و4 بعده من آخر سؤال ·
//     🔴 العميل رد بعد آخر سؤال = التذكير بيقف (quiet)
//  6) الساعة بالقاهرة بالصيفي والشتوي
//  7) نصوص التذكير: المبلغ والرقم · الاسم في الأول · «في مواعيد العمل» في الأخير · مختلفين
//  8) الـprompt: من غير fee = مفيش ولا كلمة عن الرسوم (v1 و v2) · fee مع v1 بيتجاهل · العلامة جنب الحالة بس لما fee_tag · سطر الرسوم في كل الأشكال ·
//     cancel_fee مايتكتبش JSON · القاعدة بتشاور على نفس نص العلامة ونفس اسم السطر · الـschema: fee قبل order و order آخر حاجة · parseDraft
//  9) ai-fee.ts من غير import
// 10) 🔴 الحارس (حالة التقييم 87): طلب الإلغاء من كلام العميل — صيغ حقيقية من المحادثات اللي الموظفين بعتوا فيها رقم التحويل (60 يوم) ·
//     طلب الرقم عشان يدفع تمن الأوردر · كلمات شبه «لغى» (المبلغ · الغالي · الغرفة · متلغبطة · بلّغي) · النفي (متلغوش · ملغتش · مرفضتش) = لأ
// 11) كلام العميل: الوارد بس · من غير التفاعلات · 48 ساعة · الفويس/الصورة اللي اتفهمت · من غير وقت = بيتحسب
// 12) الحارس: 87 = no_cancel · 195 = يتبعت · طلب مفتوح = يتبعت · مفيش أوردر مع الشحن = not_shipped · رد من غير الرقم/مفيش إعداد = مفيش · سطر الموظف
// 13) الـprompt: القاعدة (ل) بتمنع الرقم لعميل ماطلبش يلغي ("escalate بالقاعدة 6") · الجزء التاني لما رسالة منك طلبت الرسوم بس
// المعايرات: (أ) قبل الاستلام من غير مسح بيتعلّم · (ب) الطلب من غير إرسال · (ج) التذكير بالليل · (د) التذكير بعد النافذة ·
//            (هـ) الساعة +2 ثابتة · (و) العلامة على كل أوردر · (ز) القاعدة في v1 · (ح) صورة من غير طلب مفتوح = paid ·
//            (ط) التذكير بعد ما العميل رد · (ي) again من غير إرسال · (ك) الحارس من غير شرط الأوردر · (ل) «لغى» من غير ^…$ ·
//            (م) «مش عايز» من غير شرط اللي بعدها · (ن) التفاعلات بتتحسب · (س) الحارس بيعدّي رد العميل اللي ماطلبش يلغي
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEE_TS = path.join(ROOT, 'supabase/functions/_shared/ai-fee.ts');
const DRAFT_TS = path.join(ROOT, 'supabase/functions/_shared/ai-draft.ts');
const SRC = { fee: fs.readFileSync(FEE_TS, 'utf8'), draft: fs.readFileSync(DRAFT_TS, 'utf8') };
let seq = 0;
async function load(which, mut) {
  const file = which === 'fee' ? FEE_TS : DRAFT_TS;
  if (!mut) return import(pathToFileURL(file).href);
  const out = mut(SRC[which]);
  if (out === SRC[which]) throw new Error('المعايرة مالقتش المرساة');
  const f = path.join(os.tmpdir(), 'ai-fee-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, out);
  return import(pathToFileURL(f).href);
}

const CFG_RAW = { amount: 50, pay_to: '01050005219', pay_name: 'عبدالمحسن صابر', methods: 'إنستا باي أو محفظة' };
const H = 3600000;
const T0 = Date.parse('2026-11-23T12:00:00Z'); // 14:00 القاهرة (شتوي +2)

function checks(F, D) {
  const r = [];
  const ok = (name, cond) => r.push([name, !!cond]);
  // 1) الإعداد
  const c = F.feeConfigOf({ cancel_fee: CFG_RAW });
  ok('1أ الإعداد السليم', c && c.amount === 50 && c.payTo === '01050005219' && c.payName === 'عبدالمحسن صابر' && c.followups === true);
  ok('1ب مبلغ صفر/سالب/نص/فوق 1000 = مقفولة', [0, -5, 'abc', 5000, null].every((a) => F.feeConfigOf({ cancel_fee: { ...CFG_RAW, amount: a } }) === null));
  ok('1ج رقم مش موبايل = مقفولة', ['123', '02012345678', '', '0105000521'].every((p) => F.feeConfigOf({ cancel_fee: { ...CFG_RAW, pay_to: p } }) === null));
  ok('1د أرقام هندية ومسافات', F.feeConfigOf({ cancel_fee: { ...CFG_RAW, pay_to: '٠١٠ ٥٠٠٠ ٥٢١٩' } })?.payTo === '01050005219');
  ok('1هـ مش موجود/array/null = مقفولة', F.feeConfigOf({}) === null && F.feeConfigOf({ cancel_fee: [1] }) === null && F.feeConfigOf(null) === null);
  ok('1و followups false · methods افتراضي', F.feeConfigOf({ cancel_fee: { ...CFG_RAW, followups: false } })?.followups === false
    && F.feeConfigOf({ cancel_fee: { amount: 50, pay_to: '01050005219' } })?.methods === 'إنستا باي أو محفظة');
  // 2) مع شركة الشحن
  const tag = (status, carrier = 'jt', at = null) => F.feeTagOf({ status, carrier, carrierStatusAt: at });
  ok('2أ حالات بعد الاستلام', ['Picking up from consignee', 'Received at warehouse', 'In transit between Hubs', 'Route Assigned', 'Out for delivery', 'Exception'].every((s) => tag(s)));
  ok('2ب قبل الاستلام من غير مسح = لأ', !tag('BOSTA AUTO') && !tag('BOSTA2') && !tag('bosta_assigned'));
  ok('2ج قبل الاستلام ومعاه مسح J&T = أيوه · بوسطة = لأ', tag('BOSTA AUTO', 'jt', '2026-11-23T08:00:00Z') && !tag('BOSTA AUTO', 'bosta', '2026-11-23T08:00:00Z'));
  ok('2د متسلّم/ملغي/مؤكد/مرتجع = لأ', ['Delivered', 'cancelled', 'confirmed', 'pending', 'Returned to business', 'Returned to business2'].every((s) => !tag(s, 'jt', '2026-11-23T08:00:00Z')));
  // 3) الرقم في الرد
  ok('3أ الرقم بمسافات وأرقام هندية', F.replyAsksFee('حوّل على 010 5000 5219 لو سمحت', c) && F.replyAsksFee('على ٠١٠٥٠٠٠٥٢١٩', c));
  ok('3ب رقم تاني أو مفيش إعداد = لأ', !F.replyAsksFee('على 01012345678', c) && !F.replyAsksFee('01050005219', null));
  // 4) الحدث
  const ev = (o) => F.feeEventOf({ cfg: c, open: false, tagged: true, image: false, sent: true, fee: null, reply: 'التحويل على 01050005219', ...o });
  ok('4أ الرد اتبعت فيه الرقم لأوردر مع الشحن = request', ev({}) === 'request');
  ok('4ب الرد مااتبعتش = مفيش', ev({ sent: false }) === null);
  ok('4ج أوردر مش مع الشحن = مفيش', ev({ tagged: false }) === null);
  ok('4د fee=request من غير الرقم = مفيش', ev({ fee: 'request', reply: 'ممكن أعرف السبب؟' }) === null);
  ok('4هـ صورة بعد طلب مفتوح = paid', ev({ open: true, image: true, reply: 'وصلت' }) === 'paid');
  ok('4و رفض/هيستلم/دفع من الموديل والطلب مفتوح', ev({ open: true, fee: 'refused', reply: '' }) === 'refused' && ev({ open: true, fee: 'keep', reply: '' }) === 'keep' && ev({ open: true, fee: 'paid', reply: '' }) === 'paid');
  ok('4ز طلب مفتوح + request أو الرقم في الرد = again (مش طلب تاني)', ev({ open: true, fee: 'request', reply: 'مستنيين السكرين' }) === 'again' && ev({ open: true }) === 'again');
  ok('4ح من غير طلب مفتوح: keep/صورة = مفيش · مفيش إعداد = مفيش', ev({ fee: 'keep', reply: '' }) === null && ev({ image: true, reply: '' }) === null && ev({ cfg: null }) === null);
  ok('4ط again محتاج الرد يتبعت · رد عادي من غير الرقم = مفيش', ev({ open: true, fee: 'request', sent: false }) === null && ev({ open: true, reply: 'تمام يا فندم' }) === null);
  ok('4ي سطر الموظف: صورة ≠ كلام · again = مفيش سطر · الأوردر في السطر', F.feeNote('paid', c, '18801', true).startsWith('📸') && F.feeNote('paid', c, '18801').startsWith('💬')
    && F.feeNote('again', c, '18801') === null && F.feeNote('request', c, '18801').includes('#18801') && F.feeNote('request', c, null).includes('01050005219'));
  // 5) التذكير
  // العميل كتب آخر حاجة قبل السؤال بدقيقة (الطلب اتسجّل بعد رسالته) — ده الشكل الطبيعي
  const at = (h) => new Date(T0 - h * H).toISOString();
  const due = (o) => F.feeReminderDue({ nowMs: T0, askedAt: at(4), lastInboundAt: at(4.02), reminders: 0, cairoHour: 14, ...o });
  ok('5أ أول تذكير بعد 3 ساعات من السؤال', due({}).due && due({ askedAt: at(2.9), lastInboundAt: at(2.95) }).why === 'gap');
  ok('5ب 🔴 العميل رد بعد آخر سؤال = quiet (الموظف يكمّل)', due({ lastInboundAt: at(1) }).quiet && due({ lastInboundAt: at(1) }).why === 'customer_replied' && !due({ lastInboundAt: at(1) }).due);
  ok('5ج بعد كده كل 4 ساعات من آخر تذكير', due({ reminders: 1, askedAt: at(3.5), lastInboundAt: at(8) }).why === 'gap' && due({ reminders: 1, askedAt: at(4), lastInboundAt: at(8) }).due);
  ok('5د الحد 3 = quiet', due({ reminders: 3 }).quiet && due({ reminders: 3 }).why === 'max');
  ok('5هـ النافذة: 23.5 ساعة من آخر رسالة = quiet · من غير رسالة = quiet', due({ lastInboundAt: at(23.5), askedAt: at(23.4) }).quiet
    && due({ lastInboundAt: null }).quiet && due({ lastInboundAt: at(23), askedAt: at(22.9) }).due);
  ok('5و بالليل لأ (من غير quiet) · 10 الصبح أيوه · 22 لأ', !due({ cairoHour: 9 }).due && !due({ cairoHour: 9 }).quiet && due({ cairoHour: 10 }).due && !due({ cairoHour: 22 }).due && due({ cairoHour: 21 }).due);
  ok('5ز askedAt بايظ = quiet', due({ askedAt: 'x' }).quiet && due({ askedAt: 'x' }).why === 'bad_row');
  // 6) الساعة بالقاهرة
  ok('6 الساعة بالقاهرة: شتوي +2 · صيفي +3', F.cairoHourOf(Date.parse('2026-11-23T08:00:00Z')) === 10 && F.cairoHourOf(Date.parse('2026-07-01T08:00:00Z')) === 11
    && F.cairoHourOf(Date.parse('2026-11-23T22:30:00Z')) === 0);
  // 7) النصوص
  const tx = [0, 1, 2].map((n) => F.feeReminderText(c, n));
  ok('7أ المبلغ والرقم في التلاتة', tx.every((t) => t.includes('50 جنيه') && t.includes('01050005219')));
  ok('7ب الاسم في الأول · «في مواعيد العمل» في الأخير · مختلفين', tx[0].includes('عبدالمحسن صابر') && tx[2].includes('في مواعيد العمل') && new Set(tx).size === 3);
  // 8) الـprompt
  const HRS = 'من السبت للخميس من 12 الضهر لـ 7 مساءً';
  const v1 = D.buildSystemPrompt(), v2 = D.buildSystemPrompt({ esc: 'v2', hours: HRS }), v2f = D.buildSystemPrompt({ esc: 'v2', hours: HRS, fee: true });
  ok('8أ من غير fee: مفيش رسوم في v1 و v2', !/رسوم الإلغاء|22\(ل\)|\(ل\)/.test(v1) && !/رسوم الإلغاء|22\(ل\)|\(ل\)/.test(v2) && !/· fee /.test(v2));
  ok('8ب fee مع v1 بيتجاهل', D.buildSystemPrompt({ esc: 'v1', fee: true }) === v1);
  ok('8ج fee مع v2: القاعدة (ل) · الاستثناء في 6 · الحقل في الإخراج', v2f.includes('(ل) رسوم الإلغاء بعد الشحن') && v2f.includes('الاستثناء الوحيد رسوم الإلغاء بعد الشحن في القاعدة 22(ل)')
    && v2f.includes('fee (رسوم الإلغاء') && v2f.length > v2.length);
  ok('8د القاعدة بتشاور على نفس نص العلامة ونفس اسم السطر', v2f.includes('«' + D.FEE_TAG_TEXT.trim() + '»') && v2f.includes('«رسوم الإلغاء بعد الشحن»')
    && F.feeFactLine(c).startsWith('- رسوم الإلغاء بعد الشحن'));
  const now = '2026-11-23T12:00:00Z';
  const O = (status, extra = {}) => ({ order_uid: '1', status, product_name: 'x', total: 1, created_at: now, status_at: now, ...extra });
  ok('8هـ العلامة بس مع fee_tag', !D.statusText(O('In transit between Hubs'), now).includes('مع شركة الشحن —')
    && D.statusText(O('In transit between Hubs', { fee_tag: true }), now).endsWith(D.FEE_TAG_TEXT)
    && D.statusText(O('Out for delivery', { fee_tag: true }), now).includes('(خرج النهارده)'));
  const ctx = { nowIso: now, facts: { delivery: 'x', cancel_fee: CFG_RAW }, products: [], linkedProductId: null, ad: null, cards: [], siteRows: [], stockNames: [], orders: [O('In transit between Hubs', { fee_tag: true })], ordersKnown: true, customerName: null, history: [{ dir: 'in', body: 'عايز الغي' }] };
  const line = F.feeFactLine(c);
  const all = ['v1', 'v2', 'v3', 'v4'].map((L) => D.buildUserPrompt({ ...ctx, feeLine: line }, L));
  ok('8و سطر الرسوم في كل الأشكال · cancel_fee مش JSON', all.every((p) => p.includes(line) && !p.includes('pay_to')));
  ok('8ز من غير feeLine مفيش سطر', ['v1', 'v2', 'v3', 'v4'].every((L) => !D.buildUserPrompt(ctx, L).includes('رسوم الإلغاء بعد الشحن')));
  const S = D.RESPONSE_SCHEMA_FEE, B = D.RESPONSE_SCHEMA;
  ok('8ح الـschema: fee قبل order و order آخر حاجة · القديم من غير fee', S.properties.fee && S.properties.fee.enum.includes('none')
    && S.propertyOrdering.indexOf('fee') === S.propertyOrdering.length - 2 && S.propertyOrdering.at(-1) === 'order' && !B.properties.fee && !B.propertyOrdering.includes('fee'));
  const pd = (o) => D.parseDraft(JSON.stringify({ behavior: 'escalate', intent: 'x', reply: 'r', card: '', note: '', ...o }), []);
  ok('8ط parseDraft: القيم المعروفة بس · none/غلط/غايب = من غير المفتاح', pd({ fee: 'paid' }).fee === 'paid' && !('fee' in pd({ fee: 'none' })) && !('fee' in pd({ fee: 'x' })) && !('fee' in pd({})));
  // 9) من غير import
  ok('9 ai-fee.ts من غير import', !/^\s*import\s/m.test(SRC.fee) && !/from\s+["']/.test(SRC.fee));
  // 10) طلب الإلغاء من كلام العميل
  const CANCEL_YES = ['عاوزة ألغى الأوردر من فضلك', 'معلش مش مستعدة أشتريه حاليا\nأسباب خاصة', 'ممكن الغي الطلب', 'مش محتاج الطلب', 'كنسل الاوردر', 'إلغاء',
    'ممكن الغي الاوردر عشان المقاس طلع مش صح', 'انا لغت الارردار كذا مره', 'قالتلو خلاص مش عاوزه', 'لاء أنا لغيت', 'انا هلغي الاوردر لظروف خاصة',
    'لو مستلمتش انهردا مش هستلمه', 'انا مطلبتش الاوردر ده اصلا ومش هستلمه', 'الغي لي الاوردر لو سمحت', 'للإلغاء', 'إلغائه', 'لا مش عاوزاه شكرا',
    'مش هقدر استلم', 'غيرت رأيي', 'هرفض الاستلام', 'رجعوا الطلب', 'مستغنية عنه', 'نلغيه؟', 'الغيهولي', 'cancel please'];
  const CANCEL_NO = ['ابعت رقم التحويل', 'ايه الرقم اللي هحول عليه', 'تمام  عاوزه رقم التحويل', 'لو فى رقم محفظة كاش أحول عليه المبلغ',
    'مش عايز ادفع كاش ابعتلي رقم التحويل', 'مش عايزة ادفع عند الاستلام', 'مستعده ادفع مش ههرب', 'كنت متلغبطه بينه وبين اوردر تاني', 'المبلغ كام',
    'هو الغالي ولا الرخيص', 'الغرفة', 'بلغي المندوب يجي بكره', 'المبالغ اللي اتحولت', 'متلغوش', 'لا ملغتش', 'حضرتك انا مرفضتش', 'رجعت البيت', 'تأكيد', ''];
  const missY = CANCEL_YES.filter((t) => !F.feeCancelAsked(t)), missN = CANCEL_NO.filter((t) => F.feeCancelAsked(t));
  ok('10أ صيغ الإلغاء الحقيقية كلها' + (missY.length ? ' — فاتت: ' + missY.join(' | ') : ''), !missY.length);
  ok('10ب طلب الرقم للدفع · كلمات شبه «لغى» · النفي = مش إلغاء' + (missN.length ? ' — اتحسبت: ' + missN.join(' | ') : ''), !missN.length);
  // 11) كلام العميل
  const hm = (dir, body, h, o = {}) => ({ dir, type: 'text', body, at: h == null ? null : new Date(T0 - h * H).toISOString(), ...o });
  const asked = F.feeAskText([hm('in', 'قديم جداً', 49), hm('in', 'عايزة الغي', 30), hm('out', 'ممكن أعرف السبب؟', 29), hm('in', '{"emoji":"👍"} cancel', 1, { type: 'reaction' }),
    hm('in', '', 0.5, { type: 'audio', media: 'عايزة ألغيه' }), hm('in', 'من غير وقت', null)], T0);
  ok('11 الوارد بس · 48 ساعة · من غير التفاعلات · الفويس المفهوم · من غير وقت = بيتحسب', asked === 'عايزة الغي\nعايزة ألغيه\nمن غير وقت');
  // 12) الحارس
  const blk = (o) => F.feeReplyBlocked({ cfg: c, reply: 'التحويل 50 جنيه على 01050005219 وابعت سكرين', open: false, tagged: true, asked: 'ابعت رقم التحويل', ...o });
  ok('12أ حالة 87: العميل طلب الرقم بس = no_cancel', blk({}) === 'no_cancel');
  ok('12ب العميل طلب يلغي (195) = يتبعت', blk({ asked: 'السلام عليكم\nعاوزة ألغي الأوردر من فضلك\nمعلش مش مستعدة أشتريه حاليا أسباب خاصة' }) === null);
  ok('12ج طلب مفتوح = يتبعت · مفيش أوردر مع الشحن = not_shipped', blk({ open: true }) === null && blk({ tagged: false, asked: 'عايز الغي' }) === 'not_shipped');
  ok('12د رد من غير الرقم · مفيش إعداد = مفيش', blk({ reply: 'ممكن أعرف السبب؟' }) === null && blk({ cfg: null }) === null);
  ok('12هـ سطر الموظف: المبلغ · «الرد ماتبعتش» · من غير الرقم', F.feeBlockNote(c, 'no_cancel').includes('50 جنيه') && F.feeBlockNote(c, 'no_cancel').includes('الرد ماتبعتش')
    && !F.feeBlockNote(c, 'no_cancel').includes('01050005219') && F.feeBlockNote(c, 'not_shipped') !== F.feeBlockNote(c, 'no_cancel'));
  // 13) الـprompt
  ok('13 القاعدة (ل): الرقم ممنوع لعميل ماطلبش يلغي · الجزء التاني بعد رسالة منك طلبت الرسوم بس', v2f.includes('ماتطلبش الرسوم أبداً ولا تكتب رقم التحويل لو: العميل ماطلبش بنفسه إلغاء الأوردر')
    && v2f.includes('ده مش إلغاء، escalate بالقاعدة 6') && v2f.includes('لو (وبس لو) فيه رسالة منك قبل كده في المحادثة دي طلبت فيها رسوم الإلغاء') && !v2.includes('رقم التحويل لو:'));
  return r;
}

const F = await load('fee'), D = await load('draft');
const res = checks(F, D);
let bad = 0;
for (const [n, v] of res) { console.log((v ? '✓ ' : '✗ ') + n); if (!v) bad++; }
const failed = (rs, prefix) => rs.some(([n, v]) => n.startsWith(prefix) && !v);

const cals = [
  ['(أ) قبل الاستلام من غير مسح بيتعلّم', 'fee', (s) => s.replace('&& !!o.carrierStatusAt;', ';'), '2ب'],
  ['(ب) الطلب من غير إرسال', 'fee', (s) => s.replace('i.tagged && i.sent && replyAsksFee', 'i.tagged && replyAsksFee'), '4ب'],
  ['(ج) التذكير بالليل', 'fee', (s) => s.replace('if (i.cairoHour < FEE_HOUR_FROM || i.cairoHour >= FEE_HOUR_TO) return { due: false, quiet: false, why: "hours" };', ''), '5و'],
  ['(د) التذكير بعد النافذة', 'fee', (s) => s.replace('i.nowMs >= lastIn + FEE_WINDOW_MS - FEE_WINDOW_MARGIN_MS', 'false'), '5هـ'],
  ['(هـ) الساعة +2 ثابتة', 'fee', (s) => s.replace('timeZone: "Africa/Cairo"', 'timeZone: "Etc/GMT-2"'), '6'],
  ['(و) العلامة على كل أوردر', 'draft', (s) => s.replace('const fee = o.fee_tag ? FEE_TAG_TEXT : "";', 'const fee = FEE_TAG_TEXT;'), '8هـ'],
  ['(ز) القاعدة في v1', 'draft', (s) => s.replace('const fee = v2 && !!o && o.fee === true;', 'const fee = !!o && o.fee === true;'), '8ب'],
  ['(ح) صورة من غير طلب مفتوح = paid', 'fee', (s) => s.replace('if (i.open && i.image) return "paid";', 'if (i.image) return "paid";'), '4ح'],
  ['(ط) التذكير بعد ما العميل رد', 'fee', (s) => s.replace('if (lastIn > asked) return { due: false, quiet: true, why: "customer_replied" };', ''), '5ب'],
  ['(ي) again من غير إرسال', 'fee', (s) => s.replace('if (i.open && i.sent && (i.fee === "request"', 'if (i.open && (i.fee === "request"'), '4ط'],
  ['(ك) الحارس من غير شرط الأوردر', 'fee', (s) => s.replace('  if (!i.tagged) return "not_shipped";\n', ''), '12ج'],
  ['(ل) «لغى» من غير ^…$', 'fee', (s) => s.replace('new RegExp("^(?:و|ف)?(?:"', 'new RegExp("(?:و|ف)?(?:"').replace('+ ")$");', '+ ")");'), '10ب'],
  ['(م) «مش عايز» من غير شرط اللي بعدها', 'fee', (s) => s.replace('\\p{L}*(?=[ \\t]*(?:$|', '\\p{L}*(?=[\\s\\S]|(?:$|'), '10ب'],
  ['(ن) التفاعلات بتتحسب', 'fee', (s) => s.replace('m.dir === "in" && m.type !== "reaction"', 'm.dir === "in"'), '11'],
  ['(س) الحارس بيعدّي أي رد', 'fee', (s) => s.replace('return feeCancelAsked(i.asked) ? null : "no_cancel";', 'return null;'), '12أ'],
];
for (const [name, which, mut, prefix] of cals) {
  const Fm = which === 'fee' ? await load('fee', mut) : F;
  const Dm = which === 'draft' ? await load('draft', mut) : D;
  const rr = checks(Fm, Dm);
  if (failed(rr, prefix)) console.log('✓ معايرة ' + name + ' — اتمسكت (' + prefix + ')');
  else { console.log('✗ معايرة ' + name + ' — ماتمسكتش (' + prefix + ')'); bad++; }
}
console.log(bad ? '\n✗ ' + bad + ' مشكلة' : '\n✓ كله تمام (' + res.length + ' فحص + ' + cals.length + ' معايرات)');
process.exit(bad ? 1 : 0);
