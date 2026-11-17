// «البوت يسجّل الأوردر بنفسه» (17 نوفمبر) — من غير متصفح: supabase/functions/_shared/ai-order.ts بالحرف
// + parseOrder/statusText من ai-draft.ts.
//  1) بيانات كاملة = create بالسعر المعتمد وصنف المخزون (مش أي سعر من الموديل) · الرقم الإضافي = رقم الواتساب لو العميل كتب رقم تاني
//  2) «نفس الرقم»/«واتساب»/فاضي = رقم الواتساب · رقم بايظ = سؤال
//  3) المقاس: رقم المقاس · مقاس واحد = هو · مقاسين ومفيش تحديد = سؤال بالأسماء · دورين مقاس 65 = مايتسجّلش (مش مقاس غير اللي طلبه)
//  4) منتج مش من ai_products = handoff (مش تخمين) · اسم بيطابق منتجين = handoff
//  5) المحافظة: أشكال الكتابة · مدينة مش محافظة = سؤال · شمال سيناء = مش متاح
//  6) العنوان: قصير/كلمتين/اسم المحافظة بس = سؤال
//  7) أوردر سابق مرتجع/استثناء = handoff بالرقم · أوردر مفتوح = handoff · متسلّم/ملغي بس = يتسجّل · المرتجع قبل المفتوح
//  8) العدد: 1–3 · أكتر = handoff · صفر/فاضي = 1
//  9) رسالة التأكيد: رقم الطلب والإجمالي بالفاصلة والاسم والعنوان والمحافظة ومدة التوصيل من الإعدادات
// 10) egMobile = نفس مدخلات app.eg_mobile (اللي اتجرّبت على الحي) · الملف من غير import
// 11) parseOrder (ai-draft): في collect بس · لازم منتج واسم وعنوان · السطور بتتلم
// 12) statusText: «خرج النهارده» بتوقيت القاهرة (مش 24 ساعة) · إمبارح · حالة تانية = من غير إضافة
// 13) «معلومات للـAgent» بتقول خلص = handoff · 14) وعد بتأكيد من غير order = handoff · 15) propertyOrdering في شكل الإخراج
// المعايرات: (أ) السعر من الموديل · (ب) أوردر مرتجع بيتسجّل · (ج) أوردر مفتوح بيتسجّل · (د) مقاس واحد بياخد أي رقم ·
//            (هـ) شمال سيناء بتتسجّل · (و) عنوان من كلمتين بيعدّي · (ز) العدد من غير سقف · (ح) parseOrder في أي behavior ·
//            (ط) «خرج النهارده» بالـ24 ساعة · (ي) منتج مش معروف = أول منتج
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.join(ROOT, 'supabase/functions/_shared/ai-order.ts');
const TSD = path.join(ROOT, 'supabase/functions/_shared/ai-draft.ts');
const SRC = fs.readFileSync(TS, 'utf8'), SRCD = fs.readFileSync(TSD, 'utf8');
let seq = 0;
async function load(file, src, mut) {
  if (!mut) return import(pathToFileURL(file).href);
  const out = mut(src);
  if (out === src) throw new Error('المعايرة مالقتش المرساة');
  const f = path.join(os.tmpdir(), 'ai-order-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, out);
  return import(pathToFileURL(f).href);
}

const P1 = { id: 'p1', name: 'منظم المطبخ المتكامل (دور واحد)', aliases: ['المطبقية', 'منظم المطبخ'], siteNames: ['منظم المطبخ المتكامل', 'منظم المطبخ المتكامل مقاس ٦٥'],
  variants: [{ label: 'مقاس 85', stockProductId: 's85', price: 1499 }, { label: 'مقاس 65', stockProductId: 's65', price: 1399 }] };
const P2 = { id: 'p2', name: 'منظم المطبخ المتكامل دورين', aliases: [], siteNames: ['منظم المطبخ المتكامل دورين'], variants: [{ label: 'مقاس 85', stockProductId: 's2', price: 1850 }] };
const PRODS = [P1, P2];
const WA = '201055554444';
const O = (o) => ({ product: 'منظم المطبخ المتكامل (دور واحد)', variant: 'مقاس 85', qty: 1, name: 'منى أحمد', phone: '01012345678', governorate: 'القاهرة',
  address: 'مدينة نصر شارع عباس العقاد عمارة 15', ...o });

function run(m, d) {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); };
  const plan = (o, prev = [], wa = WA) => m.planOrder(O(o), PRODS, prev, wa);
  let s;

  // 1
  s = plan({});
  ok('1أ create', s.kind === 'create' && s.args.stock_product_id === 's85' && s.args.unit_price === 1499 && s.args.total === 1499 && s.args.qty === 1);
  ok('1ب البيانات', s.kind === 'create' && s.args.phone === '01012345678' && s.args.city === 'القاهرة' && s.args.customer_name === 'منى أحمد' && s.args.variant === 'مقاس 85');
  ok('1ج الرقم الإضافي = الواتساب', s.kind === 'create' && s.args.alt_phone === '01055554444');
  ok('1د اسم المنتج للعميل بالمقاس', s.kind === 'create' && s.args.product_label === 'منظم المطبخ المتكامل (دور واحد) — مقاس 85');
  s = plan({ price: 5, unit_price: 5, total: 5 });
  ok('1هـ سعر من الموديل مالوش أثر', s.kind === 'create' && s.args.unit_price === 1499);

  // 2
  for (const ph of ['واتساب', 'نفس الرقم', '', 'نفس رقم الواتس']) {
    s = plan({ phone: ph });
    ok('2أ «' + ph + '» = رقم الواتساب', s.kind === 'create' && s.args.phone === '01055554444' && s.args.alt_phone === null);
  }
  s = plan({ phone: '٠١٠١٢٣٤٥٦٧٨' });
  ok('2ب أرقام هندية', s.kind === 'create' && s.args.phone === '01012345678');
  s = plan({ phone: '12345' });
  ok('2ج رقم بايظ = سؤال', s.kind === 'ask' && s.why === 'phone');
  s = plan({ phone: '' }, [], null);
  ok('2د مفيش رقم خالص = سؤال', s.kind === 'ask' && s.why === 'phone');

  // 3
  s = plan({ variant: 'مقاس ٦٥ عرض' });
  ok('3أ مقاس 65', s.kind === 'create' && s.args.stock_product_id === 's65' && s.args.unit_price === 1399);
  s = plan({ variant: '' });
  ok('3ب مقاسين ومفيش تحديد = سؤال بالأسماء', s.kind === 'ask' && s.why === 'variant' && s.text.includes('مقاس 85') && s.text.includes('مقاس 65'));
  s = plan({ product: 'منظم المطبخ المتكامل دورين', variant: '' });
  ok('3ج مقاس واحد = هو', s.kind === 'create' && s.args.stock_product_id === 's2' && s.args.unit_price === 1850 && s.args.product_label === 'منظم المطبخ المتكامل دورين');
  s = plan({ product: 'منظم المطبخ المتكامل دورين', variant: 'دورين' });
  ok('3د «دورين» كنوع', s.kind === 'create' && s.args.stock_product_id === 's2');
  s = plan({ product: 'منظم المطبخ المتكامل دورين', variant: 'مقاس 65' });
  ok('3هـ دورين مقاس 65 = مايتسجّلش', s.kind === 'handoff' && s.why === 'variant');

  // 4
  s = plan({ product: 'تيربو بريمو', variant: '4 دور' });
  ok('4أ منتج مش من ai_products = handoff', s.kind === 'handoff' && s.why === 'product');
  s = plan({ product: 'المطبقية' });
  ok('4ب alias', s.kind === 'create' && s.args.stock_product_id === 's85');
  s = plan({ product: 'منظم المطبخ المتكامل' });
  ok('4ج اسم الموقع بيطابق منتج واحد بالحرف', s.kind === 'create' && s.args.stock_product_id === 's85');
  s = plan({ product: '' });
  ok('4د منتج فاضي = handoff', s.kind === 'handoff');

  // 5
  for (const [g, want] of [['القاهره', 'القاهرة'], ['محافظة الجيزة', 'الجيزة'], ['اسكندرية', 'الإسكندرية'], ['الاسكندريه', 'الإسكندرية'], ['بور سعيد', 'بورسعيد'], ['بنى سويف', 'بني سويف'], ['Cairo', 'القاهرة'], ['اسوان', 'أسوان']]) {
    s = plan({ governorate: g });
    ok('5أ ' + g, s.kind === 'create' && s.args.city === want);
  }
  s = plan({ governorate: 'المنصورة' });
  ok('5ب مدينة مش محافظة = سؤال', s.kind === 'ask' && s.why === 'gov');
  s = plan({ governorate: 'شمال سيناء' });
  ok('5ج شمال سيناء', s.kind === 'ask' && s.why === 'blocked_gov' && s.text.includes('شمال سيناء'));
  s = plan({ governorate: '' });
  ok('5د فاضية = سؤال', s.kind === 'ask' && s.why === 'gov');

  // 6
  for (const a of ['', 'القاهرة', 'جنب البيت', 'مدينة نصر']) {
    s = plan({ address: a });
    ok('6 عنوان «' + a + '» = سؤال', s.kind === 'ask' && s.why === 'address');
  }

  // 7
  s = plan({}, [{ order_uid: '100', status: 'Delivered' }, { order_uid: '90', status: 'Returned to business2' }]);
  ok('7أ مرتجع = handoff بالرقم وبيتقال إنه رجع (مش «مفتوح»)', s.kind === 'handoff' && s.why === 'prev_order' && s.note.includes('#90') && s.note.includes('رجع') && !s.note.includes('مفتوح'));
  s = plan({}, [{ order_uid: '101', status: 'Exception' }]);
  ok('7ب استثناء', s.kind === 'handoff' && s.note.includes('#101'));
  s = plan({}, [{ order_uid: '102', status: 'BOSTA AUTO' }]);
  ok('7ج مفتوح', s.kind === 'handoff' && s.note.includes('#102') && s.note.includes('مفتوح'));
  s = plan({}, [{ order_uid: '103', status: 'Delivered' }, { order_uid: '104', status: 'cancelled' }, { order_uid: '105', status: 'delivered' }]);
  ok('7د متسلّم/ملغي = يتسجّل', s.kind === 'create');
  s = plan({}, [{ order_uid: '106', status: 'confirmed' }, { order_uid: '107', status: 'returned' }]);
  ok('7هـ المرتجع قبل المفتوح', s.kind === 'handoff' && s.note.includes('#107'));
  s = plan({ address: 'x' }, [{ order_uid: '108', status: 'Exception' }]);
  ok('7و البيانات الناقصة بتتسأل الأول', s.kind === 'ask');

  // 8
  s = plan({ qty: 2 });
  ok('8أ قطعتين', s.kind === 'create' && s.args.qty === 2 && s.args.total === 2998);
  s = plan({ qty: 4 });
  ok('8ب أكتر من 3 = handoff', s.kind === 'handoff' && s.why === 'qty');
  s = plan({ qty: 0 });
  ok('8ج صفر = 1', s.kind === 'create' && s.args.qty === 1);

  // 9
  s = plan({ qty: 2 });
  const t = s.kind === 'create' ? m.orderConfirmText(s.args, 'B-12', 'من 24 إلى 48 ساعة إن شاء الله') : '';
  ok('9أ رقم الطلب والإجمالي', t.includes('رقم الطلب: B-12') && t.includes('2,998 جنيه') && t.includes('(عدد 2)'));
  ok('9ب الاسم والعنوان والمحافظة', t.includes('الاسم: منى أحمد') && t.includes('مدينة نصر شارع عباس العقاد عمارة 15، القاهرة'));
  ok('9ج مدة التوصيل من الإعدادات', t.includes('التوصيل من 24 إلى 48 ساعة إن شاء الله'));
  ok('9د من غير مدة', s.kind === 'create' && !/undefined|null/.test(m.orderConfirmText(s.args, 'B-1', null)));
  ok('9هـ ملخص التصعيد', m.orderSummary(O({})).includes('منى أحمد') && m.orderSummary(O({})).includes('01012345678'));

  // 10 — نفس المدخلات اللي اتجرّبت على app.eg_mobile
  const EG = [['01012345678', '01012345678'], ['201012345678', '01012345678'], ['+20 101 234 5678', '01012345678'], ['00201012345678', '01012345678'],
    ['1012345678', '01012345678'], ['٠١٠١٢٣٤٥٦٧٨', '01012345678'], ['12345', null], ['', null], ['0221234567', null], ['010123456789', null]];
  ok('10أ egMobile', EG.every(([i, w]) => m.egMobile(i) === w));
  ok('10ب من غير import', !/^\s*import\s/m.test(SRC));
  ok('10ج نص التحويل ثابت', /زميلي/.test(m.ORDER_HANDOFF_TEXT) && m.ORDER_MAX_QTY === 3);

  // 11
  const raw = { product: 'منظم', variant: '85', qty: 2, name: 'منى', phone: '010', governorate: 'القاهرة', address: 'شارع\nعباس  العقاد' };
  ok('11أ collect', d.parseOrder('collect', raw)?.address === 'شارع عباس العقاد' && d.parseOrder('collect', raw)?.qty === 2);
  ok('11ب behavior تاني = null', d.parseOrder('answer', raw) === null && d.parseOrder('escalate', raw) === null);
  ok('11ج ناقص اسم/عنوان/منتج = null', d.parseOrder('collect', { ...raw, name: '' }) === null && d.parseOrder('collect', { ...raw, address: ' ' }) === null && d.parseOrder('collect', { ...raw, product: '' }) === null);
  ok('11د مش object = null', d.parseOrder('collect', null) === null && d.parseOrder('collect', 'x') === null && d.parseOrder('collect', [raw]) === null);
  ok('11هـ parseDraft بياخد order', d.parseDraft(JSON.stringify({ behavior: 'collect', intent: 'i', reply: 'r', card: '', note: '', order: raw }), [])?.order?.name === 'منى'
    && d.parseDraft(JSON.stringify({ behavior: 'answer', intent: 'i', reply: 'r', card: '', note: '', order: raw }), [])?.order === null);

  // 12 — 17 نوفمبر 09:50 القاهرة (07:50Z)
  const NOW = '2026-11-17T07:50:00Z';
  const L = (status, at) => d.statusText({ order_uid: '1', status, product_name: '', total: 1, created_at: NOW, status_at: at }, NOW);
  ok('12أ خرج النهارده', L('Out for delivery', '2026-11-17T07:46:00Z').endsWith('(خرج النهارده)'));
  ok('12ب إمبارح 11 بالليل (أقل من 24 ساعة) = إمبارح', L('Out for delivery', '2026-11-16T20:30:00Z').includes('إمبارح') && !L('Out for delivery', '2026-11-16T20:30:00Z').includes('النهارده'));
  ok('12ج من يومين', L('Out for delivery', '2026-11-15T10:00:00Z').includes('من 2 يوم'));
  ok('12د حالة تانية/من غير وقت = من غير إضافة', L('Delivered', NOW) === d.statusLabel('Delivered') && L('Out for delivery', null) === d.statusLabel('Out for delivery'));

  // 13 — «معلومات للـAgent» على كارت المنتج بتقول خلص = مفيش تسجيل تلقائي (المالك كتبها على كارت الدورين 17 نوفمبر)
  const withNote = (note) => m.planOrder(O({ product: 'منظم المطبخ المتكامل دورين' }), [P1, { ...P2, note }], [], WA);
  s = withNote('خلص من المخزون و مش موجود');
  ok('13أ خلص = handoff', s.kind === 'handoff' && s.why === 'stock_note');
  ok('13ب غير متوفر/مش متاح', withNote('غير متوفر حالياً').kind === 'handoff' && withNote('المقاس ده مش متاح').kind === 'handoff');
  ok('13ج معلومة عادية = يتسجّل', withNote('ثابت على الرخامة و له رجول بتثبته كويس').kind === 'create' && withNote(null).kind === 'create' && withNote('').kind === 'create');
  ok('13د ملاحظة منتج تاني مالهاش أثر', m.planOrder(O({}), [P1, { ...P2, note: 'خلص' }], [], WA).kind === 'create');

  // 14 — collect من غير order والرد بيوعد بتأكيد = موظف يسجّله (العميل مايفضلش مستني)
  s = m.orphanPromise('تمام يا فندم، ثواني وهأكد لحضرتك تسجيل الطلب.');
  ok('14أ وعد من غير بيانات = handoff', !!s && s.kind === 'handoff' && s.why === 'no_order_data');
  ok('14ب هاكد من غير همزة', !!m.orphanPromise('هاكد لحضرتك الطلب حالا'));
  ok('14ج سؤال عادي = null', m.orphanPromise('تحت أمر حضرتك يا فندم، ممكن الاسم والمحافظة والعنوان بالتفصيل ورقم الموبايل؟') === null && m.orphanPromise('') === null);

  // 15 — شكل الإخراج: propertyOrdering (من غيره الموديل بيسرح لحد سقف التوكنز لما يملا order — اتقاس على الحي)
  const RS = d.RESPONSE_SCHEMA;
  ok('15أ ترتيب الجذر و order آخره', JSON.stringify(RS.propertyOrdering) === JSON.stringify(['behavior', 'intent', 'reply', 'card', 'note', 'order']));
  ok('15ب ترتيب order وحقوله إجبارية', RS.properties.order.propertyOrdering.length === 7 && RS.properties.order.required.length === 7 && RS.properties.order.nullable === true && !RS.required.includes('order'));
  return fails;
}

let bad = 0;
const base = run(await load(TS, SRC), await load(TSD, SRCD));
if (base.length) { bad++; console.log('✗ وقع: ' + base.join(' | ')); } else console.log('✓ 15 فحص عدّوا');

const D0 = await load(TSD, SRCD), M0 = await load(TS, SRC);
const CALS = [
  ['(أ) السعر من الموديل', 'o', (s) => s.replace('unit_price: v.price, variant: v.label, total: v.price * qty,', 'unit_price: (d as any).unit_price ?? v.price, variant: v.label, total: v.price * qty,'), '1هـ'],
  ['(ب) أوردر مرتجع بيتسجّل', 'o', (s) => s.replace('const RETURNED = /returned|exception|failed/i;', 'const RETURNED = /^$/;'), '7أ'],
  ['(ج) أوردر مفتوح بيتسجّل', 'o', (s) => s.replace('const open = prev.find((o) => !CLOSED_OK.test(String(o.status || "")));', 'const open = undefined as PrevOrder | undefined;'), '7ج'],
  ['(د) مقاس واحد بياخد أي رقم', 'o', (s) => s.replace('if (vs.length === 1) return num && sizeNums.has(num) && num !== firstNum(vs[0].label) ? null : vs[0];', 'if (vs.length === 1) return vs[0];'), '3هـ'],
  ['(هـ) شمال سيناء بتتسجّل', 'o', (s) => s.replace('if (blockedGovs.some((b) => govOf(b) === gov))', 'if (false)'), '5ج'],
  ['(و) عنوان من كلمتين بيعدّي', 'o', (s) => s.replace('if (words.length < 3) return false;', '').replace('if (a.length < 12) return false;', 'if (a.length < 5) return false;'), '6'],
  ['(ز) العدد من غير سقف', 'o', (s) => s.replace('if (qty > ORDER_MAX_QTY) return', 'if (false) return'), '8ب'],
  ['(ح) parseOrder في أي behavior', 'd', (s) => s.replace('if (behavior !== "collect" || !raw', 'if (!raw'), '11ب'],
  ['(ط) «خرج النهارده» بالـ24 ساعة', 'd', (s) => s.replace('const d = Math.round((Date.parse(cairoDay(nowIso)) - Date.parse(cairoDay(o.status_at))) / 86400000);', 'const d = Math.floor((Date.parse(nowIso) - Date.parse(o.status_at)) / 86400000);'), '12ب'],
  ['(ك) ملاحظة «خلص» مابتمنعش', 'o', (s) => s.replace('if (stockOutNote(p.note)) return', 'if (false) return'), '13أ'],
  ['(ل) الوعد من غير بيانات بيعدّي', 'o', (s) => s.replace('return /ثواني|ه[اأ]كد/.test(String(reply || ""))', 'return false'), '14أ'],
  ['(م) الإخراج من غير propertyOrdering', 'd', (s) => s.replace('  propertyOrdering: ["behavior", "intent", "reply", "card", "note", "order"],', ''), '15أ'],
  ['(ي) منتج مش معروف = أول منتج', 'o', (s) => s.replace('  return tie ? null : best;', '  return tie ? null : (best || products[0]);'), '4أ'],
];
for (const [name, which, mut, expect] of CALS) {
  let f;
  try { f = which === 'o' ? run(await load(TS, SRC, mut), D0) : run(M0, await load(TSD, SRCD, mut)); } catch (e) { bad++; console.log('✗ معايرة ' + name + ': ' + e.message); continue; }
  if (f.some((x) => x.startsWith(expect))) console.log('✓ معايرة ' + name + ' — اتمسكت (' + expect + ')');
  else { bad++; console.log('✗ معايرة ' + name + ' عدّت من غير ما الفحص ' + expect + ' يقع — وقع: ' + (f.join(' | ') || 'ولا حاجة')); }
}
process.exit(bad ? 1 : 0);
