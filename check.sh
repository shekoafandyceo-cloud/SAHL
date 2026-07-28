#!/usr/bin/env bash
# فحص صحة الجافاسكربت + تكرار الـ IDs قبل أي نشر
set -e
fail=0

for f in app/index.html admin/index.html; do
  echo "── $f"

  python3 - "$f" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
blocks = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', s, re.S)
open('/tmp/_chk.js', 'w', encoding='utf-8').write('\n;\n'.join(blocks))
dups = {}
for m in re.finditer(r'\sid="([^"]+)"', s):
    dups[m.group(1)] = dups.get(m.group(1), 0) + 1
bad = {k: v for k, v in dups.items() if v > 1}
if bad:
    print("   ⚠️  IDs مكررة:", bad)
else:
    print("   ✓ مفيش IDs مكررة")
PY

  if node --check /tmp/_chk.js 2>/dev/null; then
    echo "   ✓ الجافاسكربت سليم"
  else
    echo "   ✗ خطأ في الجافاسكربت"
    node --check /tmp/_chk.js || true
    fail=1
  fi
done

[ $fail -eq 0 ] && echo && echo "✅ كله تمام — جاهز للنشر" || { echo; echo "❌ فيه مشاكل — ماتنشرش"; exit 1; }
