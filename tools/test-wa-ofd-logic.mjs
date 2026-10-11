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
// 12) (11 أكتوبر مساءً) الاسم الأول: «ام/أم/عبد/ابو/Om X» بيتلزقوا · لقب كامل + الاسم · لقب لازق «د/زينب» = الاسم · «HH» = «حضرتك»
// 13) المنتج: «(عدد 1)» بيتشال · المتعدد بسطر/« - » بعد قوس الكمية = « + » · « - » جوّه الاسم بيفضل · لاحقة من غير قوس = بقية الاسم ·
//     سقف 120 على منتجات كاملة + «+ N منتجات تانية» (مفيش كلمة مقصوصة ولا منتج بيختفي في صمت)
// 14) المبلغ: J&T ← الإجمالي · 1,450 جنيه · صفر = «0 جنيه» (أونلاين أو استبدال بفرق صفر) · مش رقم/سالب/فاضي = bad_amount
// 15) القالب 7 (V2_BODY = OFD_BODY_V2 = النص اللي هيتسجّل عند ميتا): الترتيب + النص المرسوم · المراسي (ترتيب تاني = مرفوض) ·
//     القالب 5 زي ما كان بالظبط
//
// المعايرات (نسخة مؤقتة محقونة + حارس مرساة — درس 47): (أ) شيل لمّ المسافات → 3 · (ب) NAME_TOKEN فضفاض → 2/3 ·
// (ج) 131005 يرجع message-permanent → 8 · (د) fetch_error → transient → 9 · (هـ) حرف في نص البذرة → 7 · (و) maskDigits من غير \+? والمسافات → 8/10 ·
// (ز) شيل لزق «ام/عبد» → 12 · (ح) المبلغ من غير الرجوع للإجمالي → 14 · (ط) تقسيم المنتج على أي « - » → 13 · (ي) القالب 7 بترتيب غلط → 15 ·
// (ك) المراسي متشالة (العدد بس) → 15 · (ل) القص على الحروف مش المنتجات → 13
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
// القالب التاني (11 أكتوبر مساءً — «احط في الرسالة اسم المنتج و سعره شامل الشحن») = اللي المالك هيسجّله عند ميتا بالحرف
const V2_BODY = 'أهلاً {{1}}،\nطلبك رقم {{2}} خرج النهارده مع مندوب الشحن وفي الطريق ليك 🚚\n\nالمنتج: {{3}}\n'
  + 'المطلوب عند الاستلام (شامل الشحن): {{4}}\n\nاسم المندوب: {{5}}\nرقم المندوب: {{6}}\n\n'
  + 'تقدر تكلّم المندوب على طول لو حابب تتفق معاه على معاد الاستلام.\nولو فيه أي مشكلة كلّمنا على {{7}} أو رد على الرسالة دي.';
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
    if(!(p[0] === 'حضرتك' || (Array.from(p[0]).length <= 30 && p[0].split(' ').length <= 4
         && p[0].split(' ').every((w) => /^[\p{L}\p{M}'\u2019-]{2,25}$/u.test(w)) && !/[./@0-9]/.test(p[0])))) fuzzShape++;
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
  // 12 — أشكال مقاسة من 60 يوم أوردرات (11 أكتوبر)
  const NAMES = [['ام يوسف محمد', 'ام يوسف'], ['أم عبد الرحمن', 'أم عبد الرحمن'], ['عبد الرحمن احمد', 'عبد الرحمن'],
    ['ابو يوسف', 'ابو يوسف'], ['Om Basel', 'Om Basel'], ['مدام حنان علي', 'مدام حنان'], ['دكتورة اسماء', 'دكتورة اسماء'],
    ['د/زينب فتحى', 'زينب'], ['د.كفايه سليمان', 'كفايه'], ['Dr.Hebatullah Awad', 'Hebatullah'], ['م/ احمد', 'احمد'],
    ['HH', 'حضرتك'], ['Ro Ro', 'حضرتك'], ['ام', 'حضرتك'], ['مدام', 'حضرتك'], ['عبد', 'حضرتك'], ['AYA Emad', 'Aya'],
    ['السيد الخياط', 'السيد'], ['مي محمد', 'مي'], ['Abd alsamed', 'Abd Alsamed'], ['مس هبه محمد', 'مس هبه'], ['مس', 'حضرتك'],
    ['Al Sayed', 'Al Sayed']];
  const nbad = NAMES.filter(([i, o]) => fn(i) !== o);
  ok(12, !nbad.length, '12) الاسم الأول على ' + NAMES.length + ' شكل حقيقي' + (nbad.length ? ' — غلط: ' + nbad.map(([i, o]) => i + '→' + fn(i) + ' (المتوقع ' + o + ')').join(' · ') : ''));
  // 13
  const P = (x) => m.ofdProducts(x);
  ok(13, P('منظم المطبخ المتكامل (عدد 1)') === 'منظم المطبخ المتكامل' && P('سبت (عدد 3)') === 'سبت (عدد 3)', '13) «(عدد 1)» بيتشال · «(عدد 3)» بيفضل');
  ok(13, P('تيربو بريمو 4 دور (عدد 1)\n+ منظم المطبخ المتكامل (عدد 2)') === 'تيربو بريمو 4 دور + منظم المطبخ المتكامل (عدد 2)'
     && P('رف (عدد 1) - بوكس IKEA ( 3 قطع ) (عدد 1)') === 'رف + بوكس IKEA ( 3 قطع )', '13) المتعدد بسطر أو « - » بعد قوس الكمية = « + »');
  ok(13, P('استاند 4 دور - جزامة و شماعة (عدد ٢)') === 'استاند 4 دور - جزامة و شماعة (عدد 2)' && P('رف (عدد 1) (عدد 1)') === 'رف',
     '13) « - » جوّه الاسم بيفضل · عدد هندي · القوس المكرر');
  ok(13, P('منظم المطبخ المتكامل (عدد 1) - مقاس 85 عرض') === 'منظم المطبخ المتكامل - مقاس 85 عرض'
     && P('ترولي (عدد 2) - أبيض') === 'ترولي - أبيض (عدد 2)', '13) لاحقة من غير قوس كمية = بقية اسم المنتج (مش منتج لوحده)');
  // شكل 17392 (6 منتجات أسماء طويلة): المنتجات الكاملة + «+ N منتجات تانية» — مفيش كلمة مقصوصة
  const six = Array.from({ length: 6 }, (_, i) => 'صاعق ومضرب الناموس الذكي رقم ' + i + ' (عدد ' + (i === 1 ? 3 : 1) + ')');
  const longP = P(six.join('\n+ '));
  const kept = longP.replace(/ \+ \d+ منتجات تانية$| \+ منتج تاني$/, '').split(' + ');
  const n6 = kept.length + Number((longP.match(/\+ (\d+) منتجات تانية$/) || [0, longP.endsWith('+ منتج تاني') ? 1 : 0])[1]);
  ok(13, Array.from(longP).length <= 120 && !longP.includes('…') && n6 === 6 && kept[1] === 'صاعق ومضرب الناموس الذكي رقم 1 (عدد 3)'
     && kept.every((k, i) => k.startsWith('صاعق ومضرب الناموس الذكي رقم ' + i)) && !/[\n\t]|\s{2,}/.test(longP), '13) سقف 120 على منتجات كاملة + الباقي بالعدد — ' + longP);
  const one = P('ا'.repeat(80) + ' ' + 'ب'.repeat(80) + ' (عدد 1)\n+ X (عدد 1)');
  ok(13, Array.from(one).length <= 120 && one.endsWith('… + منتج تاني') && !one.includes('ب') && P('') === '—' && P(null) === '—',
     '13) منتج واحد أطول من السقف = مقصوص على مسافة + «…» · الفاضي «—»');
  // 14
  const A = (c, t) => { try { return m.ofdAmount(c, t); } catch(e){ return 'ERR:' + e.message; } };
  ok(14, A(1450, 1500) === '1,450 جنيه' && A('1450.00', null) === '1,450 جنيه' && A(null, '1759.5') === '1,759.5 جنيه'
     && A(undefined, 900) === '900 جنيه' && A('', 900) === '900 جنيه' && A(1234567.891, 0) === '1,234,567.89 جنيه', '14) J&T ← الإجمالي + التنسيق');
  ok(14, A(0, 1349) === '0 جنيه' && A('0.00', '0.00') === '0 جنيه', '14) صفر عند J&T = «0 جنيه» (مش الإجمالي · ومش «مدفوع» — الاستبدال بفرق صفر)');
  ok(14, ['ERR:bad_amount'].includes(A(null, null)) && A('abc', 1) === 'ERR:bad_amount' && A(-1, 1) === 'ERR:bad_amount' && A(NaN, 5) === 'ERR:bad_amount', '14) مش رقم/سالب/فاضي = bad_amount');
  // 15
  const r7 = Object.assign({}, base, { customer_name: 'ام يوسف', order_uid: '18053', courier_name: 'Sherif Ashraf', product_name: 'سبت (عدد 2)', cod_amount: '1450.00', total_cost: 1500 });
  const p7 = m.buildOfdParams(r7, 7);
  ok(15, JSON.stringify(p7) === JSON.stringify(['ام يوسف', '18053', 'سبت (عدد 2)', '1,450 جنيه', 'Sherif Ashraf', '01000000011', '01200000800']), '15) القالب 7 بالترتيب — ' + p7.join(' | '));
  ok(15, V2_BODY === m.OFD_BODY_V2 && m.ofdTemplateOk(V2_BODY, 7) && m.ofdTemplateOk(BODY, 5) && !m.ofdTemplateOk(BODY, 7) && !m.ofdTemplateOk(V2_BODY, 5),
     '15) المراسي: النص الحالي = 5 · القالب التاني = 7 (= OFD_BODY_V2 في الموديول)');
  const swapped = V2_BODY.replace('المنتج: {{3}}', 'المنتج: {{5}}').replace('اسم المندوب: {{5}}', 'اسم المندوب: {{3}}');
  ok(15, m.maxPlaceholder(swapped) === 7 && !m.ofdTemplateOk(swapped, 7), '15) قالب 7 متسجّل بترتيب تاني (المندوب في {{3}}) = مرفوض');
  ok(15, m.maxPlaceholder(V2_BODY) === 7 && m.renderTemplate(V2_BODY, p7).includes('المنتج: سبت (عدد 2)\nالمطلوب عند الاستلام (شامل الشحن): 1,450 جنيه\n\nاسم المندوب: Sherif Ashraf'), '15) نص القالب 7 المرسوم');
  ok(15, JSON.stringify(m.buildOfdParams(r7)) === JSON.stringify(m.buildOfdParams(r7, 5)) && m.buildOfdParams(r7).length === 5
     && m.ofdNeedsOrder(7) && !m.ofdNeedsOrder(5), '15) القالب 5 زي ما كان (من غير المنتج والمبلغ)');
  thr = ''; try { m.buildOfdParams(r7, 6); } catch(e){ thr = e.message; }
  let thr2 = ''; try { m.buildOfdParams(Object.assign({}, r7, { cod_amount: null, total_cost: null }), 7); } catch(e){ thr2 = e.message; }
  ok(15, thr === 'bad_template_params' && thr2 === 'bad_amount', '15) عدد متغيرات مش معروف = bad_template_params · المبلغ ناقص = bad_amount');
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
await calib('ز (من غير لزق «ام/عبد»)', (s) => s.replace('while (j < toks.length && toks[j] && JOIN_NEXT.has(toks[j]!.toLowerCase()) && parts.length < 3) parts.push(toks[j++]!);', ''), [12]);
await calib('ح (المبلغ من غير الرجوع للإجمالي)', (s) => s.replace('String(cod).trim() === "" ? total : cod;', 'String(cod).trim() === "" ? cod : cod;'), [14]);
await calib('ط (تقسيم المنتج على أي « - »)', (s) => s.replace("(?<=\\(\\s*عدد\\s*[0-9\\u0660-\\u0669]+\\s*\\))\\s*[-+]\\s*", "\\s+[-+]\\s+"), [13]);
await calib('ي (القالب 7 بترتيب غلط)', (s) => s.replace('7: ["first_name", "order_no", "products", "amount",', '7: ["first_name", "order_no", "amount", "products",'), [15]);
await calib('ك (المراسي متشالة — العدد بس)', (s) => s.replace('maxPlaceholder(b) === n && a.every((x) => b.includes(x));', 'maxPlaceholder(b) === n;'), [15]);
await calib('ل (القص على الحروف مش المنتجات)', (s) => s.replace('  for (let k = items.length; k >= 1; k--) {', '  for (let k = items.length; k >= 1 && false; k--) {'), [13]);
await calib('و (maskDigits من غير \\+? والمسافات)', (s) => s.replace('/\\+?[0-9\\u0660-\\u0669][0-9\\u0660-\\u0669\\s-]{6,}[0-9\\u0660-\\u0669]/g', '/[0-9]{8,}/g'), [8, 10]);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(bad ? '\n❌ ' + bad + ' فشل' : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
