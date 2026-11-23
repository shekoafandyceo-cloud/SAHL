// بصمة wa-ai-draft من المصدر (23 نوفمبر) — لازم تطابق { action: "self_check" } على النسخة المنشورة.
// الاستخدام: node tools/self-check.mjs                → البصمة من المصدر
//           node tools/self-check.mjs '<JSON من الحي>' → مقارنة جزء جزء (exit 1 لو فيه فرق)
//           … --bundle /tmp/v17/index.ts           → وكمان source = sha256 للباندل نفسه بالبايت (لو الـruntime سمح بقراية المصدر)
// ليه: الباندل بيتكتب بإيد الوكيل عبر MCP — البصمة بتمسك أي حرف اتغيّر في التعليمات والنصوص والـregex وحالات التقييم.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SC = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/self-check.ts')).href);
const EV = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/wa-ai-draft/eval-cases.ts')).href);
const mine = await SC.selfCheck([EV.EVAL_CASES, EV.CTX, EV.EXPECT]);
const argv = process.argv.slice(2);
const bi = argv.indexOf('--bundle');
let bundleSha = null;
if (bi >= 0) {
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  bundleSha = crypto.createHash('sha256').update(fs.readFileSync(argv[bi + 1], 'utf8'), 'utf8').digest('hex').slice(0, 16);
  argv.splice(bi, 2);
}
const arg = argv[0];
if (!arg && bundleSha) { console.log(JSON.stringify({ ...mine, source: bundleSha })); process.exit(0); }
if (!arg) { console.log(JSON.stringify(mine)); process.exit(0); }
const remote = JSON.parse(arg);
let bad = 0;
for (const k of Object.keys(mine)) {
  const same = remote[k] === mine[k];
  if (!same) bad++;
  console.log((same ? '✓ ' : '✗ ') + k + ' ' + mine[k] + (same ? '' : ' ≠ ' + remote[k]));
}
if ('source' in remote) {
  if (!bundleSha) console.log('… source ' + remote.source + ' (مقارنته محتاجة --bundle <الملف اللي اتنشر>)');
  else if (remote.source === bundleSha) console.log('✓ source ' + bundleSha + ' — الملف المنشور = الباندل بالبايت');
  else if (String(remote.source).startsWith('error:')) console.log('… source مااتقراش على الحي (' + remote.source + ') — الأجزاء فوق هي الدليل');
  else { bad++; console.log('✗ source ' + bundleSha + ' ≠ ' + remote.source); }
}
for (const k of Object.keys(remote)) if (!(k in mine) && k !== 'source') { bad++; console.log('✗ ' + k + ' (في الحي بس)'); }
console.log(bad ? '\n✗ ' + bad + ' جزء مختلف' : '\n✓ النسخة المنشورة = المصدر');
process.exit(bad ? 1 : 0);
