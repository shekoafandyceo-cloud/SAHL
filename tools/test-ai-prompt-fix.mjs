// تصليح البرومبتات + حراسات الكود (21 نوفمبر — البند 3) — من غير متصفح: الملفات الثلاثة في supabase/functions/_shared بالحرف.
//  1) escReply: «ثواني/لحظة» أول الرد = «تمام يا فندم،» · «في أقرب وقت/على طول» بعد وعد الزميل بتتشال · «ثواني» في النص مابتتلمسش
//     · 23 نوفمبر: «فوراً/حالاً» من أي حتة (ليلة 22: «…لحل المشكلة فوراً» بعد 55 حرف من الوعد) · الوعد لحد 90 حرف · أفعال بالشدة · «حالياً» زي ما هي
//  2) tidyReply: «في/زي الكارت» = «في/زي الرسالة» · «بالكارت» و«كارت الضمان» زي ما هم · autoPlan بيطبّقها على رد الموديل
//  3) نفس رد البوت بالحرف (lastBotText) = مايتبعتش: answer · رموز ومسافات مختلفة · الكارت بيتبعت والرد بس اللي بيتشال · التصعيد بملاحظته ·
//     رد مختلف بيتبعت · الأوردر (النص الثابت) مش متأثر
//  4) sessionText: من آخر رسالة لحد أول سكوت 6 ساعات · بالكتير 48 ساعة · من غير أوقات = كله
//  5) freshData: كلمة من الاسم · نص كلمات العنوان · حروف الجر اللازقة («بمدينة») بتتطابق
//  6) planOrder: الاسم/العنوان مش في المحادثة الحالية = يسأل (stale) · من غير recent = زي الأول · فيه = يتسجّل
//  7) deliveryWish + planOrder: «بعد أسبوع/يوم الاتنين/أول الشهر/مسافر» = موظف يسجّل (date) · «هيوصل امتى» لأ
//  8) أوردر سابق لغاه موظف من أقل من 30 يوم (أو مش معروف مين) = موظف يراجع · العميل لغاه أو من 40 يوم = يتسجّل · التفعيل مش متأثر
//  9) نصوص التحويل الثابتة فيها «في مواعيد العمل»
// 10) historyBlock: فاصل «— (فاصل: … بعد 5 أيام …) —» بين رسالتين بينهم ≥ 6 ساعات · أقل من كده لأ · من غير أوقات = الشكل القديم بالحرف ·
//     HIST_GAP_MS = SESSION_GAP_MS
// 11) القواعد الجديدة في v2 بس (v1 نفس النص من غيرها)
// المعايرات: (أ) «ثواني» بتفضل · (ب) «في أقرب وقت» بتفضل · (ج) «الكارت» بتفضل · (د) الاستبدال بيلمس «بالكارت» · (هـ) حارس التكرار مقفول ·
//            (و) التكرار في التصعيد بيتبعت · (ز) السكوت 6 ساعات مابيقطعش · (ح) حروف الجر مابتتشالش · (ط) حارس البيانات القديمة مقفول ·
//            (ي) حارس الميعاد مقفول · (ك) الأوردر الملغي بإيد موظف مابيمنعش · (ل) الفاصل مابيتحطش · (م) الفاصل على كل رسالة · (ن) القواعد في v1
//            (س) «حالاً» البعيدة بتفضل · (ع) الوعد لحد 40 حرف زي الأول · (ف) الفعل بالشدة مابيتعرفش
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = path.join(ROOT, 'supabase/functions/_shared');
const F = { a: path.join(SH, 'ai-auto.ts'), o: path.join(SH, 'ai-order.ts'), d: path.join(SH, 'ai-draft.ts') };
const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));
let seq = 0;
async function load(k, mut) {
  if (!mut) return import(pathToFileURL(F[k]).href);
  const out = mut(SRC[k]);
  if (out === SRC[k]) throw new Error('المعايرة مالقتش المرساة');
  const f = path.join(os.tmpdir(), 'ai-fix-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, out);
  return import(pathToFileURL(f).href);
}

const NL = String.fromCharCode(10);
const H = 3600 * 1000;
const NOW = Date.parse('2026-11-21T15:04:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const D = (behavior, reply = '', card = '', note = '') => ({ behavior, intent: 'تجربة', reply, card, note });
const IN = (o) => ({ draft: null, fromModel: true, error: null, card: null, cardRepeat: 0, holdSent: false, turnsInConv: 0, turnsToday: 0, holdMessage: 'اعتذار', ...o });
const P = [{ id: 'p1', name: 'منظم المطبخ المتكامل (دور واحد)', aliases: ['المطبقية'], siteNames: ['منظم المطبخ المتكامل'],
  variants: [{ label: 'مقاس 85', stockProductId: 's85', price: 1499 }, { label: 'مقاس 65', stockProductId: 's65', price: 1399 }] }];
const ORD = (o) => ({ product: 'منظم المطبخ المتكامل (دور واحد)', variant: 'مقاس 85', qty: 1, name: 'محسن صابر', phone: 'واتساب',
  governorate: 'القاهرة', address: 'مدينة السلام اطلس ٣ بلوك ٢٠٢', ...o });
const WA = '201050005219';

function run(A, O, Dm) {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); };
  let p;

  // 1 escReply
  ok('1أ «ثواني يا فندم،» = «تمام يا فندم،»', A.escReply('ثواني يا فندم، زميلي المختص هيتابع مع حضرتك ويأكد التحويل في مواعيد العمل.') === 'تمام يا فندم، زميلي المختص هيتابع مع حضرتك ويأكد التحويل في مواعيد العمل.');
  ok('1ب «ثواني يا فندم هراجع»', A.escReply('ثواني يا فندم هراجع مع زميلي توفر اللون الأبيض وهيتابع مع حضرتك في مواعيد العمل.') === 'تمام يا فندم، هراجع مع زميلي توفر اللون الأبيض وهيتابع مع حضرتك في مواعيد العمل.');
  ok('1ج «لحظة واحدة وهراجع»', A.escReply('لحظة واحدة وهراجع مع زميلي') === 'تمام يا فندم، هراجع مع زميلي');
  ok('1د «في أقرب وقت/على طول» بعد الوعد بتتشال', A.escReply('وزميلي هيتواصل مع حضرتك في أقرب وقت.') === 'وزميلي هيتواصل مع حضرتك.' && A.escReply('زميلي هيرد على حضرتك على طول') === 'زميلي هيرد على حضرتك');
  ok('1هـ «ثواني» في النص زي ما هي', A.escReply('تمام يا فندم، ثواني') === 'تمام يا فندم، ثواني' && A.escReply('في أقرب وقت يا فندم') === 'في أقرب وقت يا فندم');
  ok('1و «فوراً» بعيدة عن الوعد (ليلة 22)', A.escReply('حقك علينا جداً يا دكتور، سجّلت لزمايلي في الإدارة ومسؤول المتابعة هيتواصل مع حضرتك أول مواعيد العمل من 12 الضهر لحل المشكلة فوراً.')
    === 'حقك علينا جداً يا دكتور، سجّلت لزمايلي في الإدارة ومسؤول المتابعة هيتواصل مع حضرتك أول مواعيد العمل من 12 الضهر لحل المشكلة.');
  ok('1ز «حالاً/فوراً» في أي حتة · «حالياً» زي ما هي', A.escReply('بنعتذر جداً، هيتم حل المشكلة حالًا') === 'بنعتذر جداً، هيتم حل المشكلة'
    && A.escReply('حالاً هبلّغ زميلي يا فندم') === 'هبلّغ زميلي يا فندم' && A.escReply('تحت أمر حضرتك، الأوردر حالياً في الطريق') === 'تحت أمر حضرتك، الأوردر حالياً في الطريق');
  ok('1ح الوعد لحد 90 حرف · «في أقرب وقت ممكن» كلها · أفعال بالشدة', A.escReply('ومسؤول المتابعة هيتواصل مع حضرتك أول ما مواعيد العمل تبدأ من 12 الضهر بخصوص الأوردر في أقرب وقت ممكن.')
    === 'ومسؤول المتابعة هيتواصل مع حضرتك أول ما مواعيد العمل تبدأ من 12 الضهر بخصوص الأوردر.'
    && A.escReply('زميلي هيكلّم حضرتك دلوقتي') === 'زميلي هيكلّم حضرتك' && A.escReply('زميلي هيتصل بحضرتك بأسرع وقت ممكن، وآسفين جداً') === 'زميلي هيتصل بحضرتك، وآسفين جداً');

  // 2 tidyReply
  ok('2أ «في الكارت» = «في الرسالة»', A.tidyReply('كل التفاصيل موضحة في الكارت، وتحت أمرك') === 'كل التفاصيل موضحة في الرسالة، وتحت أمرك'
    && A.tidyReply('الصور المتاحة هي اللي في الكارت فوق يا فندم') === 'الصور المتاحة هي اللي في الرسالة فوق يا فندم');
  ok('2ب «زي الكارت»', A.tidyReply('فيها حامل أدوات المطبخ زي الكارت.') === 'فيها حامل أدوات المطبخ زي الرسالة.');
  ok('2ج «بالكارت» و«كارت الضمان» زي ما هم', A.tidyReply('الدفع بالكارت على الموقع بس') === 'الدفع بالكارت على الموقع بس' && A.tidyReply('كارت الضمان جوه الكرتونة') === 'كارت الضمان جوه الكرتونة'
    && A.tidyReply(null) === '');
  p = A.autoPlan(IN({ draft: D('answer', 'كل التفاصيل موضحة في الكارت يا فندم') }));
  ok('2د autoPlan بيطبّقها على الرد', p.actions.length === 1 && p.actions[0].body === 'كل التفاصيل موضحة في الرسالة يا فندم');
  p = A.autoPlan(IN({ draft: D('escalate', 'ثواني يا فندم، التفاصيل في الكارت وزميلي هيتابع في مواعيد العمل', '', 'n'), escTalk: true }));
  ok('2هـ والتصعيد كمان', p.actions.length === 1 && p.actions[0].body === 'تمام يا فندم، التفاصيل في الرسالة وزميلي هيتابع في مواعيد العمل');

  // 3 التكرار
  const Q = 'ممكن حضرتك توضح المطلوب يا فندم؟';
  p = A.autoPlan(IN({ draft: D('answer', 'الشحن مجاني يا فندم'), lastBotText: 'الشحن مجاني يا فندم' }));
  ok('3أ نفس الرد = مايتبعتش ومن غير تصعيد', p.actions.length === 0 && p.escalate === null && p.reason === 'answer');
  p = A.autoPlan(IN({ draft: D('clarify', 'ممكن حضرتك توضح المطلوب يا فندم ؟'), lastBotText: Q }));
  ok('3ب رموز ومسافات مختلفة = نفس الرد', p.actions.length === 0 && p.reason === 'clarify');
  p = A.autoPlan(IN({ draft: D('answer', 'الشحن مجاني يا فندم'), lastBotText: Q }));
  ok('3ج رد مختلف بيتبعت', p.actions.length === 1 && p.actions[0].body === 'الشحن مجاني يا فندم');
  const CARD = { title: 'مطبخ', body: 'كلام الكارت', images: ['t1/quick-replies/a.jpg'] };
  p = A.autoPlan(IN({ draft: D('answer', 'الشحن مجاني يا فندم', 'مطبخ'), card: CARD, lastBotText: 'الشحن مجاني يا فندم' }));
  ok('3د الكارت بيتبعت والرد المتكرر بس اللي بيتشال', p.actions.length === 1 && p.actions[0].kind === 'image');
  p = A.autoPlan(IN({ draft: D('escalate', 'تمام يا فندم، سجّلت ده مع طلب حضرتك.', '', 'معلومة زيادة'), escTalk: true, lastBotText: 'تمام يا فندم، سجّلت ده مع طلب حضرتك.' }));
  ok('3هـ التصعيد المتكرر = سكوت والملاحظة بتفضل', p.actions.length === 0 && p.escalate === 'معلومة زيادة' && p.reason === 'escalate');
  p = A.autoPlan(IN({ draft: D('collect', 'ممكن الاسم؟'), order: { state: 'ask', text: 'ممكن الاسم؟' }, lastBotText: 'ممكن الاسم؟' }));
  ok('3و النص الثابت بتاع الأوردر مش متأثر', p.actions.length === 1 && p.actions[0].body === 'ممكن الاسم؟');
  p = A.autoPlan(IN({ draft: D('answer', 'الشحن مجاني يا فندم'), lastBotText: null }));
  ok('3ز من غير آخر رسالة = عادي', p.actions.length === 1);
  ok('3ح النافذة 5 دقايق', A.AUTO_REPEAT_WINDOW_MS === 5 * 60 * 1000);

  // 4 sessionText
  const msgs = [
    { dir: 'in', body: 'دور واحد ، الاسم : محسن صابر', at: iso(120 * H) },
    { dir: 'in', body: 'مدينة السلام اطلس ٣ بلوك ٢٠٢', at: iso(120 * H - 60000) },
    { dir: 'in', body: 'مساء الخير يافندم', at: iso(60000) },
    { dir: 'out', body: 'مساء النور يا فندم', at: iso(50000) },
    { dir: 'in', body: '', media: 'كنت عايز اعمل طلب', at: iso(0) },
  ];
  let s = O.sessionText(msgs);
  ok('4أ بعد السكوت بس', !s.all.includes('محسن') && s.all.includes('مساء الخير') && s.all.includes('مساء النور') && s.all.includes('كنت عايز اعمل طلب'));
  ok('4ب inbound = كلام العميل بس', s.inbound.includes('مساء الخير') && !s.inbound.includes('مساء النور') && s.inbound.includes('كنت عايز'));
  s = O.sessionText(msgs.map(({ at, ...m }) => m));
  ok('4ج من غير أوقات = كله', s.all.includes('محسن') && s.all.includes('مدينة السلام'));
  const chain = Array.from({ length: 14 }, (_, k) => ({ dir: 'in', body: 'رسالة' + k, at: iso((13 - k) * 5 * H) })); // كل 5 ساعات لمدة 65 ساعة
  s = O.sessionText(chain);
  ok('4د بالكتير 48 ساعة', !s.all.includes('رسالة0') && s.all.includes('رسالة13') && s.all.includes('رسالة4'));
  ok('4هـ رسايل فاضية', O.sessionText([]).all === '' && O.sessionText(null).inbound === '');
  s = O.sessionText([{ dir: 'in', body: 'الاسم قديم', at: iso(10 * H) }, { dir: 'in', body: 'جديد', at: iso(60000) }]);
  ok('4و سكوت 10 ساعات (جوّه الـ48) بيقطع', s.all === 'جديد');

  // 5 freshData
  ok('5أ الاسم والعنوان موجودين', O.freshData({ name: 'محسن صابر', address: 'مدينة السلام اطلس ٣ بلوك ٢٠٢' }, 'الاسم محسن صابر والعنوان مدينة السلام اطلس 3 بلوك 202'));
  ok('5ب الاسم مش موجود', !O.freshData({ name: 'محسن صابر', address: 'مدينة السلام' }, 'مدينة السلام لو سمحت'));
  ok('5ج كلمة واحدة من الاسم كفاية', O.freshData({ name: 'محسن صابر علي', address: '' }, 'انا محسن'));
  ok('5د أقل من نص العنوان = لأ', !O.freshData({ name: 'منى', address: 'المعادي شارع 9 عمارة 12 جنب المترو' }, 'منى المعادي'));
  ok('5هـ حروف الجر اللازقة', O.freshData({ name: 'منى', address: 'المعادي شارع النصر' }, 'منى بالمعادي وشارع النصر'));

  // 6 planOrder + stale
  let st = O.planOrder(ORD(), P, [], WA, undefined, { recent: 'مساء الخير يافندم' + NL + 'كنت عايز اعمل طلب', recentIn: 'مساء الخير يافندم', nowIso: iso(0) });
  ok('6أ بيانات قديمة = يسأل', st.kind === 'ask' && st.why === 'stale' && st.text === O.STALE_ASK_TEXT);
  st = O.planOrder(ORD(), P, [], WA);
  ok('6ب من غير recent = زي الأول', st.kind === 'create' && st.args.total === 1499);
  st = O.planOrder(ORD(), P, [], WA, undefined, { recent: 'الاسم محسن صابر العنوان مدينة السلام اطلس ٣ بلوك ٢٠٢', recentIn: 'الاسم محسن صابر', nowIso: iso(0) });
  ok('6ج البيانات في المحادثة = يتسجّل', st.kind === 'create' && st.args.customer_name === 'محسن صابر');
  st = O.planOrder(ORD({ address: 'مدينة' }), P, [], WA, undefined, { recent: 'ولا حاجة', nowIso: iso(0) });
  ok('6د العنوان الناقص بيتسأل قبل القديم', st.kind === 'ask' && st.why === 'address');

  // 7 الميعاد
  ok('7أ deliveryWish', !!O.deliveryWish('بس عايز الاستلام بعد اسبوع يوم الاتنين') && !!O.deliveryWish('يوم الجمعة') && !!O.deliveryWish('أول الشهر إن شاء الله')
    && !!O.deliveryWish('انا مسافر') && !!O.deliveryWish('بعد ٣ أيام'));
  ok('7ب الأسئلة العادية لأ', O.deliveryWish('هيوصل امتى') === null && O.deliveryWish('بتوصل امتا') === null && O.deliveryWish('التوصيل كام يوم') === null && O.deliveryWish('') === null);
  st = O.planOrder(ORD(), P, [], WA, undefined, { recent: 'محسن صابر مدينة السلام اطلس ٣ بلوك ٢٠٢ بعد اسبوع', recentIn: 'عايز الاستلام بعد اسبوع', nowIso: iso(0) });
  ok('7ج ميعاد = موظف يسجّل', st.kind === 'handoff' && st.why === 'date' && /بعد اسبوع/.test(st.note));

  // 8 أوردر سابق لغاه موظف
  const can = (by, days) => ({ order_uid: '18790', status: 'cancelled', cancelled_by: by, cancelled_at: iso(days * 24 * H) });
  st = O.planOrder(ORD(), P, [can('staff', 5)], WA, undefined, { nowIso: iso(0) });
  ok('8أ لغاه موظف من 5 أيام = موظف يراجع', st.kind === 'handoff' && st.why === 'prev_order' && /18790/.test(st.note));
  st = O.planOrder(ORD(), P, [can(null, 5)], WA, undefined, { nowIso: iso(0) });
  ok('8ب مش معروف مين لغاه = موظف يراجع', st.kind === 'handoff' && st.why === 'prev_order');
  st = O.planOrder(ORD(), P, [can('customer', 1)], WA, undefined, { nowIso: iso(0) });
  ok('8ج العميل لغاه = يتسجّل', st.kind === 'create');
  st = O.planOrder(ORD(), P, [can('staff', 40)], WA, undefined, { nowIso: iso(0) });
  ok('8د من 40 يوم = يتسجّل', st.kind === 'create');
  st = O.planOrder(ORD(), P, [{ order_uid: '1', status: 'cancelled' }], WA, undefined, { nowIso: iso(0) });
  ok('8هـ من غير وقت الإلغاء = يتسجّل', st.kind === 'create');
  const rorders = [
    { id: 'a', order_uid: 'A1', status: 'cancelled', product_name: 'x', total: 1499, cancelled_at: iso(2 * H), cancelled_by: 'customer', has_tracking: false },
    { id: 'b', order_uid: 'B1', status: 'cancelled', product_name: 'x', total: 1499, cancelled_at: iso(3 * 24 * H), cancelled_by: 'staff', has_tracking: false },
  ];
  ok('8و التفعيل مش متأثر', O.planReactivate('A1', rorders, iso(0))?.kind === 'reactivate');

  // 9 النصوص الثابتة
  ok('9 «في مواعيد العمل»', /في مواعيد العمل/.test(O.ORDER_HANDOFF_TEXT) && /في مواعيد العمل/.test(O.REACT_HANDOFF_TEXT) && /الاسم والعنوان/.test(O.STALE_ASK_TEXT));

  // 10 الفواصل
  const ctx = (history) => ({ nowIso: iso(0), facts: {}, products: [], linkedProductId: null, ad: null, cards: [], siteRows: [], stockNames: [], orders: [], ordersKnown: true, customerName: null, history });
  const hb = Dm.historyBlock(ctx(msgs.map((m) => ({ ...m, type: m.media ? 'voice' : 'text' }))));
  const lines = hb.split(NL);
  ok('10أ فاصل بعد 5 أيام في مكانه', lines.length === 6 && lines[2] === '— (فاصل: اللي تحت ده بعد 5 أيام من اللي فوقه) —' && lines[1].includes('مدينة السلام') && lines[3].includes('مساء الخير'));
  ok('10ب أقل من 6 ساعات = مفيش فاصل', lines.filter((l) => l.startsWith('— (فاصل')).length === 1);
  const plain = msgs.map(({ at, ...m }) => ({ ...m, type: m.media ? 'voice' : 'text' }));
  ok('10ج من غير أوقات = الشكل القديم بالحرف', Dm.historyBlock(ctx(plain)) === plain.map((m) => Dm.historyBlock(ctx([m]))).join(NL) && !Dm.historyBlock(ctx(plain)).includes('فاصل'));
  ok('10د gapLine', Dm.gapLine(7 * H) === '— (فاصل: اللي تحت ده بعد 7 ساعات من اللي فوقه) —' && Dm.gapLine(24 * H).includes('بعد يوم ') && Dm.gapLine(50 * H).includes('بعد يومين '));
  ok('10هـ HIST_GAP_MS = SESSION_GAP_MS', Dm.HIST_GAP_MS === O.SESSION_GAP_MS && O.SESSION_GAP_MS === 6 * H);

  // 11 القواعد في v2 بس
  const v2 = Dm.buildSystemPrompt({ esc: 'v2', hours: 'x' }), v1 = Dm.buildSystemPrompt();
  ok('11أ القواعد الجديدة في v2', ['(ح) ماتبدأش الرد بـ«ثواني»', '(ط) أي طلب محتاج حاجة تتعمل بعدين', '(ي) العميل بيطلب أوردر جديد وعايز يستلمه', '(ك) العميل طلب يلغي',
    '23. كلامك مع العميل', '«الكارت» كلمة داخلية', 'ماتكررش جملة', '«ماشاء الله»', 'ماتناقضش زميلك', 'سطر فاصل'].every((x) => v2.includes(x)));
  ok('11ب v1 من غيرها', !v1.includes('23. كلامك') && !v1.includes('(ح) ماتبدأش') && !v1.includes('سطر فاصل'));
  return fails;
}

let bad = 0;
const base = run(await load('a'), await load('o'), await load('d'));
if (base.length) { bad++; console.log('✗ وقع: ' + base.join(' | ')); } else console.log('✓ 11 فحص عدّوا (53 شرط)');

const A0 = await load('a'), O0 = await load('o'), D0 = await load('d');
const CALS = [
  ['(أ) «ثواني» بتفضل', 'a', (s) => s.replace('.replace(/^\\s*(?:ثواني|', '.replace(/^\\s*(?:XXXX|'), '1أ'],
  ['(ب) «في أقرب وقت» بتفضل', 'a', (s) => s.replace('|(?:في|فى)\\s+(?:أقرب|اقرب|أسرع|اسرع)\\s+وقت(?:\\s+ممكن)?|ب(?:أسرع|اسرع)\\s+وقت(?:\\s+ممكن)?|على طول|ع طول)', ')'), '1د'],
  ['(س) «حالاً» البعيدة بتفضل', 'a', (s) => s.replace('    .replace(ESC_NOW, ""))', '    )'), '1ز'],
  ['(ع) الوعد لحد 40 حرف زي الأول', 'a', (s) => s.replace('[^.،\\n]{0,90}?', '[^.،\\n]{0,40}?'), '1ح'],
  ['(ف) الفعل بالشدة مابيتعرفش', 'a', (s) => s.replace('|كل\\u0651?م|', '|كلم|'), '1ح'],
  ['(ج) «الكارت» بتفضل', 'a', (s) => s.replace('return String(reply || "").replace(/(^|[\\s،(])(في|فى|زي|زى)\\s+الكارت', 'return String(reply || "").replace(/(^|[\\s،(])(XX)\\s+الكارت'), '2أ'],
  ['(د) الاستبدال بيلمس «بالكارت»', 'a', (s) => s.replace('.replace(/(^|[\\s،(])(في|فى|زي|زى)\\s+الكارت(?=$|[\\s.،!؟?)])/g, "$1$2 الرسالة")', '.replace(/الكارت/g, "الرسالة")'), '2ج'],
  ['(هـ) حارس التكرار مقفول', 'a', (s) => s.replace('const repeat = (t: string) => !!last && repKey(t) === last;', 'const repeat = (t: string) => false && !!last && repKey(t) === last;'), '3أ'],
  ['(و) التكرار في التصعيد بيتبعت', 'a', (s) => s.replace('    if (talk && repeat(talk)) return { actions: [], escalate, reason: "escalate" };\n', ''), '3هـ'],
  ['(ز) السكوت 6 ساعات مابيقطعش', 'o', (s) => s.replace('if (isFinite(prev) && prev - t >= SESSION_GAP_MS) break;', ''), '4و'],
  ['(ح) حروف الجر مابتتشالش', 'o', (s) => s.replace('for (const p of ["وال", "بال", "لل", "ال", "و", "ب", "ل", "ف"])', 'for (const p of [])'), '5هـ'],
  ['(ط) حارس البيانات القديمة مقفول', 'o', (s) => s.replace('if (typeof opts.recent === "string" && !freshData({ name, address }, opts.recent))', 'if (false)'), '6أ'],
  ['(ي) حارس الميعاد مقفول', 'o', (s) => s.replace('const wish = opts.recentIn ? deliveryWish(opts.recentIn) : null;', 'const wish = null;'), '7ج'],
  ['(ك) الأوردر الملغي بإيد موظف مابيمنعش', 'o', (s) => s.replace('const pp = prevProblem(prev || []) || staffCancelProblem(prev || [], opts.nowIso || new Date().toISOString());', 'const pp = prevProblem(prev || []);'), '8أ'],
  ['(ل) الفاصل مابيتحطش', 'd', (s) => s.replace('if (isFinite(at) && isFinite(prevAt) && at - prevAt >= HIST_GAP_MS) lines.push(gapLine(at - prevAt));', ''), '10أ'],
  ['(م) الفاصل على كل رسالة', 'd', (s) => s.replace('at - prevAt >= HIST_GAP_MS) lines.push', 'at - prevAt >= 0) lines.push'), '10ب'],
  ['(ن) القواعد في v1 كمان', 'd', (s) => s.replace('    ...(v2 ? [\n      "22. افهم العميل الأول', '    ...(true ? [\n      "22. افهم العميل الأول'), '11ب'],
];
for (const [name, k, mut, expect] of CALS) {
  let f;
  try {
    const m = await load(k, mut);
    f = run(k === 'a' ? m : A0, k === 'o' ? m : O0, k === 'd' ? m : D0);
  } catch (e) { bad++; console.log('✗ معايرة ' + name + ': ' + e.message); continue; }
  if (f.some((x) => x.startsWith(expect))) console.log('✓ معايرة ' + name + ' — اتمسكت (' + expect + ')');
  else { bad++; console.log('✗ معايرة ' + name + ' عدّت من غير ما الفحص ' + expect + ' يقع — وقع: ' + (f.join(' | ') || 'ولا حاجة')); }
}
process.exit(bad ? 1 : 0);
