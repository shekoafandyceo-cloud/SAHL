#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# SessionStart — بيقول للسيشن الجديدة «إحنا واقفين فين» من الحقيقة
# الحية مش من ملف ممكن يكون قديم.
#
# 🔴 سبب وجوده = درس 49: السيشن الجديدة بتبدأ من الفرع الافتراضي،
# فبتقرا CLAUDE.md عمره كام يوم وتشتغل على حقيقة فاتت — وهي واثقة.
# حصل 16 سبتمبر (كانت 14 كوميت ورا) وكان هيحصل تاني 20 سبتمبر (24).
#
# القاعدة الوحيدة هنا: **الهوك ده عمره ما يوقّف سيشن.** أي فشل جوّاه
# بيتبلع ويخرج 0 — بنر ناقص أهون من سيشن مش بتفتح.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

say(){ printf '%s\n' "$1"; }

say "════════ 🚦 سهل — حالة الريبو وقت بداية السيشن ════════"

HEAD_BR="$(git branch --show-current 2>/dev/null)"
say "الفرع: ${HEAD_BR:-<detached>}"
say "آخر كوميت: $(git log -1 --format='%h %s' 2>/dev/null | cut -c1-90)"
say "تاريخه: $(git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null)"

# ── رقم التسليم: المصافحة اللي بتكشف القِدَم في سطر واحد (درس 49)
VER="$(grep -o 'آخر نسخة اتسلّمت: v[0-9]\+' CLAUDE.md 2>/dev/null | head -1)"
if [ -n "$VER" ]; then
  say "التسليم المسجّل: ${VER#آخر نسخة اتسلّمت: } — لو المالك قال رقم أعلى، نسختك قديمة."
else
  say "🔴 CLAUDE.md مافيهوش سطر «آخر نسخة اتسلّمت» — نسخة قديمة جداً أو الملف ناقص."
fi

# ── 🔴 الفحص الأهم: فيه فرع شغل أحدث مني؟
timeout 25 git fetch --quiet --all --prune >/dev/null 2>&1

NEWEST="$(git for-each-ref --sort=-committerdate --format='%(refname:short)' \
          refs/remotes/origin 2>/dev/null | grep -v '/HEAD$' | head -1)"

if [ -n "$NEWEST" ]; then
  BEHIND="$(git rev-list --count "HEAD..$NEWEST" 2>/dev/null || echo 0)"
  AHEAD="$(git rev-list --count "$NEWEST..HEAD" 2>/dev/null || echo 0)"
  if [ "${BEHIND:-0}" -gt 0 ]; then
    say ""
    say "🔴🔴 إنت ورا بـ${BEHIND} كوميت من: $NEWEST"
    say "     آخر شغل هناك: $(git log -1 --format='%s' "$NEWEST" 2>/dev/null | cut -c1-80)"
    if [ "${AHEAD:-0}" -eq 0 ]; then
      say "     ✅ fast-forward نضيف — مفيش حاجة هتضيع:"
      say "        git merge --ff-only $NEWEST"
    else
      say "     ⚠️ وعندك ${AHEAD} كوميت مش هناك — merge عادي:"
      say "        git merge $NEWEST"
    fi
    say "     🔴 متشتغلش على CLAUDE.md قبل كده — هتقرا حقيقة فاتت (درس 49)."
  else
    say "✅ محدّث — مفيش فرع أحدث من اللي إنت عليه."
  fi
fi

DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
[ "${DIRTY:-0}" -gt 0 ] && say "⚠️ فيه ${DIRTY} ملف متغيّر مش متكوميت."

say ""
say "قبل أي نشر: bash check.sh   ·   السياق الكامل: CLAUDE.md (اقراه كله)"
say "═══════════════════════════════════════════════════════"

# ── الهارنسات محتاجة playwright — تركيبه مرة واحدة بيتكاش مع الكونتينر
if [ -f tools/package.json ] && [ ! -d tools/node_modules/playwright ]; then
  say "⏳ بركّب playwright للهارنسات…"
  (cd tools && npm install --no-audit --no-fund >/dev/null 2>&1) \
    && say "✅ playwright جاهز" \
    || say "⚠️ تركيب playwright فشل — الهارنسات مش هتشتغل لحد ما يتركّب يدوي"
fi

exit 0
