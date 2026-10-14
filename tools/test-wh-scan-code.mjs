// سكانر المخزن (14 أكتوبر) — app/js/warehouse/scan-code.js من غير متصفح.
//
//  1) scanToLatin: الكيبورد العربي (تثل · ـُلأ بالشيفت) · CapsLock · أرقام هندي/فارسي · علامات الاتجاه
//  2) parseWaybill: JEG/UEG في أي مكان (بادئة AIM · لينك QR) · 13 رقم = مش بوليصة · 8–10 = القديم · 12–14 = باركود منتج
//  3) codeChar: الزرار الفعلي (KeyJ · Digit0 · Numpad7) مش الحرف
//  4) createKeyBuffer: البافر من e.code · Backspace/Alt = «مش موثوق» · Shift/CapsLock بيتطنّشوا
//  5) looksScanned: 15 ضغطة كل 10ms = سكانر · كل 150ms = إيد · 5 ضغطات = مش كفاية
//  6) isEndKey: Enter · NumpadEnter · Tab · Ctrl+J/M — مش J لوحدها
//  7) نفس نتيجة `app.wh_code` على السيرفر لكل مدخل في TABLE (القيم المتوقعة اتقاست من الدالة الحية 14 أكتوبر)
//  8) ذيل البافر (المحادثات): كلام بالإيد بطيء وبعده سكان سريع = timing(15) سكانر و timing() كله إيد · tail(15) = الكود ·
//     markAt(15) = مكان الكارسر قبل أول زرار في الكود · Ctrl+V = «مش موثوق» ومابيضيفش V
//
// المعايرات (مرساة + حارس — درس 47): شيل «تثل» من الخريطة (ت→J) → 1 · شيل (?!\d) → 2 · codeChar من e.key → 3 ·
// البافر مابيتعلّمش dirty → 4 · حد السرعة 1000ms → 5 · timing(n) بيتجاهل n → 8
// تشغيل:  cd tools && node test-wh-scan-code.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const SRC = new URL('../app/js/warehouse/scan-code.js', import.meta.url);
const FMT = new URL('../app/js/core/format.js', import.meta.url);
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

// نفس الملفين في فولدر مؤقت (عشان المعايرة تعدّل نسخة مش الأصل)
async function load(patch){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whsc-'));
  fs.mkdirSync(path.join(dir, 'core')); fs.mkdirSync(path.join(dir, 'warehouse'));
  fs.copyFileSync(FMT, path.join(dir, 'core', 'format.js'));
  let src = fs.readFileSync(SRC, 'utf8');
  if(patch){ const out = patch(src); if(out === src) throw new Error('المعايرة مالقتش المرساة (درس 47)'); src = out; }
  fs.writeFileSync(path.join(dir, 'warehouse', 'scan-code.js'), src);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  return import(pathToFileURL(path.join(dir, 'warehouse', 'scan-code.js')).href);
}

const CODE = 'JEG000538937803';
// [المدخل، المتوقع من app.wh_code] — اتقاس من الدالة الحية
export const TABLE = [
  ['JEG000538937803', 'JEG000538937803'],
  ['jeg000538937803', 'JEG000538937803'],
  ['تثل000538937803', 'JEG000538937803'],
  ['ـُلأ000538937803', 'JEG000538937803'],
  ['تثل٠٠٠٥٣٨٩٣٧٨٠٣', 'JEG000538937803'],
  ['‎JEG000538937803‏', 'JEG000538937803'],
  [']C0JEG000538937803', 'JEG000538937803'],
  ['https://jtexpress.eg/t/JEG000538937803?x=1', 'JEG000538937803'],
  ['JEG0005389378031', null],
  ['UEG088902635684', 'UEG088902635684'],
  ['عثل088902635684', 'UEG088902635684'],
  ['38937803', null],
  ['622300123456', null],
  ['JEG00053893780', null],
  ['', null]
];

async function suite(m, label){
  const { scanToLatin, parseWaybill, codeChar, createKeyBuffer, looksScanned, isEndKey } = m;
  const r = {};
  // 1
  r.s1 = scanToLatin('تثل000538937803') === CODE && scanToLatin('ـُلأ000538937803') === CODE
      && scanToLatin('jeg000538937803') === CODE && scanToLatin('تثل٠٠٠٥٣٨٩٣٧٨٠٣') === CODE
      && scanToLatin('‏ JEG 0005 3893 7803 ') === CODE;
  // 2
  const pw = (s) => parseWaybill(s);
  r.s2 = pw(']C0' + CODE).kind === 'jt' && pw(']C0' + CODE).code === CODE
      && pw('https://x.eg/' + CODE + '?a').code === CODE
      && pw(CODE + '1').kind !== 'jt'
      && pw('UEG088902635684').kind === 'jt_sandbox'
      && pw('38937803').kind === 'legacy' && pw('622300123456').kind === 'product_barcode'
      && pw('hello').kind === 'unknown';
  // 7 — كل الجدول
  r.s7 = TABLE.every(([inp, exp]) => { const p = pw(inp); const got = (p.kind === 'jt' || p.kind === 'jt_sandbox') ? p.code : null; return got === exp; });
  // 3
  r.s3 = codeChar('KeyJ') === 'J' && codeChar('Digit0') === '0' && codeChar('Numpad7') === '7' && codeChar('Enter') === '' && codeChar('ShiftLeft') === '';
  // 4
  const ev = (code, key, t, extra) => Object.assign({ code, key, timeStamp: t }, extra || {});
  const keysFor = (s, step) => s.split('').map((ch, i) => /\d/.test(ch) ? ev('Digit' + ch, ch, i * step) : ev('Key' + ch, ({ J: 'ت', E: 'ث', G: 'ل' })[ch] || ch, i * step));
  let kb = createKeyBuffer();
  kb.push(ev('ShiftLeft', 'Shift', 0)); kb.push(ev('CapsLock', 'CapsLock', 0));
  keysFor(CODE, 10).forEach(e => kb.push(e));
  const v1 = kb.value();
  kb.push(ev('Backspace', 'Backspace', 200));
  const v2 = kb.value();
  kb.reset();
  kb.push(ev('KeyJ', 'j', 0, { altKey: true }));
  const v3 = kb.value();
  r.s4 = v1 === CODE && v2 === '' && v3 === '';
  // 5
  kb = createKeyBuffer(); keysFor(CODE, 10).forEach(e => kb.push(e)); const fast = looksScanned(kb.timing());
  kb = createKeyBuffer(); keysFor(CODE, 150).forEach(e => kb.push(e)); const slow = looksScanned(kb.timing());
  kb = createKeyBuffer(); keysFor('JEG00', 10).forEach(e => kb.push(e)); const few = looksScanned(kb.timing());
  r.s5 = fast === true && slow === false && few === false;
  // 6
  r.s6 = isEndKey({ code: 'Enter', key: 'Enter' }) && isEndKey({ code: 'NumpadEnter', key: 'Enter' }) && isEndKey({ code: 'Tab', key: 'Tab' })
      && isEndKey({ code: 'KeyJ', key: 'j', ctrlKey: true }) && isEndKey({ code: 'KeyM', key: 'm', ctrlKey: true })
      && !isEndKey({ code: 'KeyJ', key: 'j' });
  // 8 — كلام «سلام» بالإيد (150ms) وبعده سكان (10ms) بعلامة الكارسر
  kb = createKeyBuffer();
  ['KeyS', 'KeyG', 'KeyH', 'KeyL'].forEach((c, i) => kb.push(ev(c, 'سلام'[i], i * 150), i));
  keysFor(CODE, 10).forEach((e, i) => { e.timeStamp = 1000 + i * 10; kb.push(e, 4 + i); });
  const tailOk = kb.tail(15) === CODE && kb.markAt(15) === 4 && kb.markAt(1) === 18;
  const tim = looksScanned(kb.timing(15)) === true && looksScanned(kb.timing()) === false;
  const kc = createKeyBuffer();
  kc.push(ev('KeyV', 'v', 0, { ctrlKey: true }));
  r.s8 = tailOk && tim && kc.value() === '' && kc.tail(5) === '';
  if(label) return r;
  ok(r.s1, '1) الكيبورد العربي/الشيفت/CapsLock/أرقام هندي/علامات الاتجاه → JEG000538937803');
  ok(r.s2, '2) البوليصة في أي مكان (AIM · لينك) · 13 رقم مش بوليصة · UEG تجريبي · القديم · باركود منتج');
  ok(r.s3, '3) codeChar من الزرار الفعلي');
  ok(r.s4, '4) البافر من e.code · Backspace/Alt = مش موثوق · Shift/CapsLock بيتطنّشوا');
  ok(r.s5, '5) looksScanned: سريع = سكانر · بطيء/قليل = إيد');
  ok(r.s6, '6) isEndKey: Enter · NumpadEnter · Tab · Ctrl+J/M — مش J لوحدها');
  ok(r.s7, '7) ' + TABLE.length + ' مدخل = نفس نتيجة app.wh_code على السيرفر');
  ok(r.s8, '8) ذيل البافر: كلام بالإيد + سكان = timing(15) سكانر · tail/markAt صح · Ctrl+V مش حرف');
  return r;
}

console.log('scan-code.js');
await suite(await load());

console.log('المعايرات');
const cal = async (name, key, patch) => {
  const r = await suite(await load(patch), true);
  ok(r[key] === false, 'معايرة ' + name + ' → الفحص ' + key.slice(1) + ' وقع');
};
await cal('(أ) شيل ت→J', 's1', s => s.replace("'ت': 'J', ", ''));
await cal('(ب) شيل (?!\\d)', 's2', s => s.replace('([JU]EG\\d{12})(?!\\d)', '([JU]EG\\d{12})'));
await cal('(ج) codeChar من الحرف', 's3', s => s.replace("if(m) return m[1];\n  m = c.match(/^(?:Digit|Numpad)(\\d)$/);", "if(m) return '';\n  m = c.match(/^(?:Digit|Numpad)(\\d)$/);"));
await cal('(د) البافر مابيتعلّمش dirty', 's4', s => s.replace('      dirty = true;\n    },', '    },'));
await cal('(هـ) حد السرعة 1000ms', 's5', s => s.replace('t.avg <= 35 && t.max <= 120', 't.avg <= 1000 && t.max <= 2000'));
await cal('(و) timing(n) بيتجاهل n', 's8', s => s.replace('var ts = (n && n > 0) ? times.slice(-n) : times;', 'var ts = times;'));

console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
