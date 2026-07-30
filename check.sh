#!/usr/bin/env bash
# فحص ما قبل النشر — المنطق كله في tools/check.py
#
# بيدوّر على مفسّر بايثون شغّال (على ويندوز `python3` غالباً stub بتاع
# Microsoft Store فبيلزم نجرّب `python` كمان)، وبيثبّت ترميز الخرج على UTF-8
# عشان الكونسول الويندوز (cp1252) مايقعش على العربي.

set -u

# --- إيجاد بايثون شغّال فعلاً (مش الـstub) ---
PY=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c "import sys" >/dev/null 2>&1; then
      PY="$cand"
      break
    fi
  fi
done

if [ -z "$PY" ]; then
  echo "✗ مفيش بايثون شغّال. ثبّت Python 3.8+ وجرّب تاني."
  exit 2
fi

# --- التأكد إن node في الـPATH (winget مبيحدّثش الجلسة الحالية) ---
if ! command -v node >/dev/null 2>&1; then
  for guess in "/c/Program Files/nodejs" "/c/Program Files (x86)/nodejs" "${LOCALAPPDATA:-}/Programs/nodejs"; do
    if [ -x "$guess/node.exe" ]; then
      PATH="$guess:$PATH"
      export PATH
      break
    fi
  done
fi

export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

exec "$PY" "$(dirname "$0")/tools/check.py" "$@"
