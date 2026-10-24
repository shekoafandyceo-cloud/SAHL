#!/usr/bin/env node
// معايرة encoder الـCode 128 بتاع بوليصة J&T (app/js/core/code128.js):
//   1) نفس نمط البارات بالحرف زي python-barcode (اللي اتعمل بيه النموذج المعتمد)
//   2) الـSVG المتولّد بيتفك بـzxing-cpp ويرجّع نفس النص — على 25 رقم بوليصة عشوائي
//   3) معايرة: قلب بار واحد → الفك بيفشل أو يرجّع نص مختلف
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { code128Modules, code128Values } = await import(pathToFileURL(path.join(HERE, '..', 'app', 'js', 'core', 'code128.js')).href);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const samples = ['UEG088902573105', 'UEG000000191681', 'AB12', '1234567890', 'X1', 'UEG12345678901A'];
for (let i = 0; i < 25; i++) samples.push('UEG' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0'));
console.log('1) نمط البارات = python-barcode');
const py = execFileSync('python3', ['-c', `
import barcode, json, sys
vals = json.loads(sys.stdin.read())
print(json.dumps({v: barcode.get("code128", v).build()[0] for v in vals}))
`], { input: JSON.stringify(samples) }).toString();
const ref = JSON.parse(py);
let same = 0;
for (const v of samples) if (ref[v] === code128Modules(v)) same++;
ok(same === samples.length, 'مطابق بالحرف على ' + same + '/' + samples.length + ' عيّنة');
console.log('2) الفك بـzxing-cpp من SVG مرسوم');
const tmp = fs.mkdtempSync('/tmp/jtawb-');
function svg(mods, w = 700, h = 100) { let x = 0, r = ''; const mw = w / mods.length; for (let i = 0; i < mods.length; i++) { if (mods[i] === '1') r += `<rect x="${(i*mw).toFixed(3)}" y="0" width="${mw.toFixed(3)}" height="${h}"/>`; } return `<svg xmlns="http://www.w3.org/2000/svg" width="${w+80}" height="${h}" viewBox="-40 0 ${w+80} ${h}"><rect x="-40" y="0" width="${w+80}" height="${h}" fill="#fff"/><g fill="#000">${r}</g></svg>`; }
const list = samples.slice(0, 12);
list.forEach((v, i) => fs.writeFileSync(path.join(tmp, i + '.svg'), svg(code128Modules(v))));
// معايرة: بار مقلوب
const bad = code128Modules(list[0]).split(''); bad[30] = bad[30] === '1' ? '0' : '1';
fs.writeFileSync(path.join(tmp, 'bad.svg'), svg(bad.join('')));
const dec = JSON.parse(execFileSync('python3', ['-c', `
import sys, json, zxingcpp, warnings
warnings.simplefilter('ignore')
import pymupdf as fitz
out = {}
for f in json.loads(sys.stdin.read()):
    doc = fitz.open(f); pix = doc[0].get_pixmap(dpi=300); png = f + '.png'; pix.save(png)
    from PIL import Image
    img = Image.open(png)
    res = zxingcpp.read_barcodes(img)
    out[f] = [(r.format.name, r.text) for r in res]
print(json.dumps(out))
`], { input: JSON.stringify(list.map((_, i) => path.join(tmp, i + '.svg')).concat([path.join(tmp, 'bad.svg')])) }).toString());
let decoded = 0;
list.forEach((v, i) => { const r = dec[path.join(tmp, i + '.svg')] || []; if (r.some(x => x[0] === 'Code128' && x[1] === v)) decoded++; });
ok(decoded === list.length, 'zxing فك ' + decoded + '/' + list.length + ' بوليصة بنفس النص');
const badR = dec[path.join(tmp, 'bad.svg')] || [];
ok(!badR.some(x => x[1] === list[0]), 'معايرة: بار مقلوب → مش بيتفك لنفس النص (' + JSON.stringify(badR) + ')');
console.log('3) الـchecksum');
const vals = code128Values('UEG088902573105');
ok(vals[0] === 104 && vals[vals.length - 1] === 106, 'يبدأ Start B وينتهي Stop (حروف أولاً)');
ok(code128Values('1234567890')[0] === 105, 'أرقام بس → Start C');
console.log(fail ? `\n✗ ${fail} فحص وقع` : `\n✓ كل الفحوص عدّت (${pass})`);
process.exit(fail ? 1 : 0);
