// بصمة wa-ai-draft من المصدر (23 نوفمبر) — لازم تطابق { action: "self_check" } على النسخة المنشورة.
// الاستخدام: node tools/self-check.mjs                → البصمة من المصدر
//           node tools/self-check.mjs '<JSON من الحي>' → مقارنة جزء جزء (exit 1 لو فيه فرق)
// ليه: الباندل بيتكتب بإيد الوكيل عبر MCP — البصمة بتمسك أي حرف اتغيّر في التعليمات والنصوص والـregex وحالات التقييم.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SC = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/self-check.ts')).href);
const EV = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/wa-ai-draft/eval-cases.ts')).href);
const mine = await SC.selfCheck([EV.EVAL_CASES, EV.CTX, EV.EXPECT]);
const arg = process.argv[2];
if (!arg) { console.log(JSON.stringify(mine)); process.exit(0); }
const remote = JSON.parse(arg);
let bad = 0;
for (const k of Object.keys(mine)) {
  const same = remote[k] === mine[k];
  if (!same) bad++;
  console.log((same ? '✓ ' : '✗ ') + k + ' ' + mine[k] + (same ? '' : ' ≠ ' + remote[k]));
}
for (const k of Object.keys(remote)) if (!(k in mine)) { bad++; console.log('✗ ' + k + ' (في الحي بس)'); }
console.log(bad ? '\n✗ ' + bad + ' جزء مختلف' : '\n✓ النسخة المنشورة = المصدر');
process.exit(bad ? 1 : 0);
