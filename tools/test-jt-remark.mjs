// ملاحظة البوليصة في الـremark (3 أكتوبر) — من غير متصفح.
//
//  1) نسخة الواجهة (app/js/orders/jt-remark.js — معاينة نافذة الشحن) = نسخة السيرفر
//     (supabase/functions/_shared/jt-remark.ts — jt-ship) بالحرف على كل الفيكستشرات. لو انحرفوا،
//     الموظف بيوافق على نص غير اللي بيتبعت لـJ&T ويتطبع.
//  2) قواعد التركيب: المنتجات عمرها ما بتتقص عشان الملاحظة · الملاحظة بالمساحة الفاضلة من 200 ·
//     الروابط وحروف التحكم وعلامات الاتجاه بتتشال · من غير ملاحظة = remarkFor القديمة بالحرف
//     (البوالص القديمة مابتتغيرش).
//  3) المعايرات: فرق حرف واحد في نسخة الواجهة · الملاحظة قبل المنتجات · من غير شيل الروابط.
// تشغيل:  node tools/test-jt-remark.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TS = path.join(ROOT, 'supabase/functions/_shared/jt-remark.ts');
const JS = path.join(ROOT, 'app/js/orders/jt-remark.js');
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const cp = (s) => Array.from(s).length;

// remarkFor القديمة في jt-ship v5 بالحرف — مرجع «من غير ملاحظة = زي ما كان»
function remarkForV5(o){
  const lines = [];
  const pn = String(o.product_name || '').replace(/\r/g, '');
  for (const part of pn.split(/\s*\+\s*|\n/)) { const t = part.trim(); if (t) lines.push(t); }
  const props = String(o.manufacturer_note || o.var || '').trim();
  if (props && !lines.some((l) => l.includes(props))) lines.push(props);
  let remark = lines.join('\n');
  if ([...remark].length > 200) remark = [...remark].slice(0, 199).join('') + '…';
  return remark;
}

const LONG = 'استاند امريكانا 5 دور - جزامة و شماعة للشنط و الملابس (عدد 2)';
const FIX = [
  // [product_name, props, note]
  ['منظم المطبخ المتكامل (عدد 1)', 'مقاس 85 عرض ', 'الاتصال قبل الوصول'],
  ['منظم المطبخ المتكامل (عدد 1)\n+ ترولي 3 دور ايكيا (عدد 2)', '', 'الدور ٢ شقة ٦'],
  ['تيربو بريمو 5 دور (عدد 1)', 'مدور 5 أدوار', 'برجاء  أن يكون التوصيل يوم السبت فقط\nسواء هذا الأسبوع أو القادم'],
  ['منظم المطبخ المتكامل (عدد 1) - منظم المكتب الذكي 3 أدوار (عدد 1)', 'مقاس 85 عرض', ''],
  [LONG + '\n+ ' + LONG + '\n+ ' + LONG, 'أبيض 5 أدوار', 'ملاحظة مش هتدخل'],            // منتجات > 200
  ['x'.repeat(186), '', 'ملاحظة طويلة شوية مش هتلحق'],                                   // مساحة 5 < 6 = من غير ملاحظة
  ['x'.repeat(170), '', 'ملاحظة بتتقص في الآخر عشان المساحة'],                           // ملاحظة بتتقص
  ['منتج (عدد 1)', '', 'شوف الفيديو https://evil.example/x?a=1 و www.bad.com قبل الاستلام'],
  ['منتج (عدد 1)', '', 'نص‏فيه‮علامات\u0000تحكم\tو؜اتجاه'],
  ['منتج (عدد 1)', '', '   '],
  ['', '', 'ملاحظة من غير منتجات'],
  ['منتج (عدد 1)', 'أسود', 'ن'.repeat(400)],
  ['😀 منتج بإيموجي (عدد 1)', '', 'تمام 👍'],
];

const ts = await import(pathToFileURL(TS).href);
const js = await import(pathToFileURL(JS).href);

// ════ 1) التطابق ════
let same = 0;
for (const [pn, pr, note] of FIX) {
  const a = ts.composeRemark(pn, pr, note), b = js.composeRemark(pn, pr, note);
  if (a === b) same++; else console.log('    ✗ اختلاف:', JSON.stringify([pn.slice(0, 30), note.slice(0, 30)]), JSON.stringify(a).slice(0, 80), '≠', JSON.stringify(b).slice(0, 80));
  if (ts.cleanShipNote(note) !== js.cleanShipNote(note)) { same--; console.log('    ✗ cleanShipNote مختلفة:', JSON.stringify(note.slice(0, 40))); }
}
ok(same === FIX.length, `1) نسخة الواجهة = نسخة jt-ship بالحرف (${same}/${FIX.length})`);

// ════ 2) القواعد ════
const R = (pn, pr, note) => ts.composeRemark(pn, pr, note);
ok(FIX.every(([pn, pr, note]) => cp(R(pn, pr, note)) <= 200), '2) كل الـremarks ≤ 200 حرف (توثيق J&T: remark String(200))');
ok(FIX.every(([pn, pr]) => R(pn, pr, '') === remarkForV5({ product_name: pn, manufacturer_note: pr })), '2ب) من غير ملاحظة = remarkFor v5 بالحرف (البوالص القديمة زي ما هي)');
ok(R(FIX[0][0], FIX[0][1], FIX[0][2]) === 'منظم المطبخ المتكامل (عدد 1)\nمقاس 85 عرض\nملاحظة: الاتصال قبل الوصول', '2ج) الشكل: منتجات ← خصائص ← «ملاحظة: …»');
{
  const pn = FIX[4][0];
  const r = R(pn, FIX[4][1], FIX[4][2]);
  ok(r === remarkForV5({ product_name: pn, manufacturer_note: FIX[4][1] }) && !r.includes('ملاحظة:'), '2د) منتجات فوق الـ200 → الملاحظة مابتتبعتش والمنتجات بتتقص زي ما كانت');
}
ok(!R(FIX[5][0], '', FIX[5][2]).includes('ملاحظة:'), '2هـ) مساحة أقل من 6 حروف = من غير ملاحظة (مش حرفين و«…»)');
{
  const r = R(FIX[6][0], '', FIX[6][2]);
  ok(r.startsWith('x'.repeat(170) + '\nملاحظة: ') && r.endsWith('…') && cp(r) === 200, '2و) الملاحظة بتاخد المساحة الفاضلة بالظبط وبتتقص بـ«…» — المنتجات كاملة');
}
{
  const c = ts.cleanShipNote(FIX[7][2]);
  ok(!/https?:|www\./i.test(c) && c === 'شوف الفيديو و قبل الاستلام', '2ز) الروابط بتتشال (J&T: 145003108 links are illegal) — «' + c + '»');
}
{
  const c = ts.cleanShipNote(FIX[8][2]);
  const bad = [...c].filter((ch) => { const n = ch.codePointAt(0); return n < 32 || n === 0x200f || n === 0x202e || n === 0x061c; });
  ok(bad.length === 0 && c === 'نص فيه علامات تحكم و اتجاه', '2ح) حروف التحكم وعلامات الاتجاه بتتشال — «' + c + '»');
}
ok(R('منتج (عدد 1)', '', '   ') === 'منتج (عدد 1)', '2ط) ملاحظة فاضية/مسافات = من غير سطر ملاحظة');
ok(R('', '', 'ملاحظة من غير منتجات') === 'ملاحظة: ملاحظة من غير منتجات', '2ي) من غير منتجات: الملاحظة لوحدها من غير سطر فاضي قبلها');
ok(cp(ts.cleanShipNote('ن'.repeat(400))) === 200, '2ك) الملاحظة نفسها سقفها 200 قبل التركيب');
ok(R(FIX[2][0], FIX[2][1], FIX[2][2]).endsWith('ملاحظة: برجاء أن يكون التوصيل يوم السبت فقط سواء هذا الأسبوع أو القادم'), '2ل) السطور والمسافات المزدوجة في الملاحظة = مسافة واحدة (سطر واحد في البوليصة)');
ok(R(FIX[12][0], '', FIX[12][2]) === '😀 منتج بإيموجي (عدد 1)\nملاحظة: تمام 👍', '2م) الإيموجي بيتعد حرف واحد (code points مش UTF-16)');

// ════ 3) المعايرات ════
console.log('\n  المعايرات:');
async function variant(label, mutate){
  const src = fs.readFileSync(JS, 'utf8');
  const out = mutate(src);
  if (out === src) throw new Error('المعايرة مالقتش المرساة: ' + label);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jtr-')), 'jt-remark.js');
  fs.writeFileSync(tmp, out);
  return import(pathToFileURL(tmp).href);
}
{
  const v = await variant('أ', (s) => s.replace("export const NOTE_PREFIX = \"ملاحظة: \";", "export const NOTE_PREFIX = \"ملاحظه: \";"));
  const diff = FIX.some(([pn, pr, note]) => ts.composeRemark(pn, pr, note) !== v.composeRemark(pn, pr, note));
  ok(diff, 'معايرة أ) حرف واحد مختلف في نسخة الواجهة → فحص التطابق بيمسكه');
}
{
  const v = await variant('ب', (s) => s.replace('return base + sep + NOTE_PREFIX + text;', 'return NOTE_PREFIX + text + sep + base;'));
  ok(v.composeRemark(FIX[0][0], FIX[0][1], FIX[0][2]) !== R(FIX[0][0], FIX[0][1], FIX[0][2]), 'معايرة ب) الملاحظة قبل المنتجات → فحص الشكل بيقع');
}
{
  const v = await variant('ج', (s) => s.replace('s = s.replace(/(?:https?:\\/\\/|www\\.)\\S+/gi, " ");', ''));
  ok(/https?:/.test(v.cleanShipNote(FIX[7][2])), 'معايرة ج) شيل فلتر الروابط → الرابط بيعدّي (فحص 2ز كان هيقع)');
}

console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✓ كله عدّى');
process.exit(bad ? 1 : 0);
