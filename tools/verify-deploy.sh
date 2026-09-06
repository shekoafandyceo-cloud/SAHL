#!/usr/bin/env bash
# تحقق بعد النشر — بيقارن كل ملف في app/ باللي نازل فعلاً على الهواء.
#
# 🔴 ليه بالـcontent-type مش بالـstatus؟
# لما `not_found_handling: "single-page-application"` يتفعّل على الـWorker، أي
# ملف **ناقص** بيرجع `index.html` بـ**200** — من غير أي فحص للامتداد (مثبت من
# كود Cloudflare: `notFound()` في `asset-worker/src/handler.ts` مافيهاش أي فحص).
# يعني رفعة ناقص منها موديول JS بتبان **كلها 200 أخضر** والعطل الوحيد سطر MIME
# في الكونسول — وصورة ناقصة = صفر أثر في أي مكان. ده بيقتل شبكة الأمان المكتوبة
# في CLAUDE.md («كله أو مفيش»).
# فالفحص بيقارن **نوع المحتوى** مش الكود: أي أصل بيرجع text/html = ناقص.
#
# الاستخدام:  bash tools/verify-deploy.sh [BASE_URL]
set -u
BASE="${1:-https://app.sahlgedan.com}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)/app"
bad=0; n=0

echo "── التحقق من $BASE"

# قايمة الملفات بتتولّد من app/ نفسها — مش مكتوبة بالإيد عشان ماتقدمش
while IFS= read -r f; do
  rel="${f#"$ROOT"/}"
  case "$rel" in _*|*/_*) continue ;; esac   # _headers مش أصل بيتخدم
  n=$((n+1))
  ct=$(curl -s -o /dev/null -w '%{content_type}' "$BASE/$rel")
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$rel")
  # الفحص مضيّق على **الخطر الحقيقي**: أصل بيرجع HTML = الملف ناقص والـfallback
  # ابتلعه. أي حاجة تانية (307 على /index.html من تطبيع Cloudflare، أو
  # application/octet-stream للخطوط) سلوك طبيعي مش عطل — وتوسيع الفحص ليها
  # بيولّد ضوضاء بتخلي الأداة تتتجاهل (درس 9).
  case "$rel" in
    *.html) ;;                                     # HTML متوقع منه HTML
    *)
      # الترتيب مقصود: صفحة الخطأ نفسها HTML، فلو فحصنا النوع الأول كل 404
      # هيتقال عليه «fallback ابتلعه» — تشخيص غلط لعطل حقيقي.
      if [ "$code" -ge 400 ] 2>/dev/null; then
        echo "  ✗ $rel → $code — الملف مش موجود على النشرة"
        bad=$((bad+1))
      elif printf '%s' "$ct" | grep -qi "text/html"; then
        echo "  ✗ $rel → $code $ct — ناقص والـfallback رجّع الصفحة مكانه في صمت"
        bad=$((bad+1))
      fi ;;
  esac
done < <(find "$ROOT" -type f)

echo "── فحصت $n ملف"

# ════ لينكات الأقسام ════
# 🔴 «كله أو مفيش»: `probeDeepLinks` بتفتح البوابة أول ما /orders ترد 200،
# وبعدها الراوتر بيكتب لينك **لكل** قسم. فقسم واحد ناقص = لينك بيتكتب
# وبيدي 404 عند الريفريش. الفحص لازم يمر على كلهم مش على /orders بس.
# والـslugs بتتقرا من الراوتر نفسه — لستة مكتوبة هنا كانت هتنحرف في صمت.
ROUTER="$(cd "$(dirname "$0")/.." && pwd)/app/js/core/router.js"
slugs=$(sed -n '/var ROUTES = {/,/};/p' "$ROUTER" | sed -n 's/^  \([A-Za-z][A-Za-z0-9_]*\) *:.*/\1/p')
echo "── لينكات الأقسام"
served=0; miss=0
for s in $slugs; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$s")
  t=$(curl -s -o /dev/null -w '%{content_type}' "$BASE/$s")
  case "$c$t" in
    200*text/html*) served=$((served+1)) ;;
    *) echo "  ✗ /$s → $c $t"; miss=$((miss+1)) ;;
  esac
done
if [ "$miss" -eq 0 ] && [ "$served" -gt 0 ]; then
  echo "  ✓ كل الـ$served قسم بيرد 200 — اللينكات العميقة شغالة"
elif [ "$served" -eq 0 ]; then
  echo "  ℹ️ ولا قسم بيرد — اللينكات العميقة مش مفعّلة، واللوحة شغالة من غيرها (مقصود)"
else
  echo "  ❌ $miss قسم ناقص و$served شغال — **أسوأ حالة**: البوابة بتفتح"
  echo "     والراوتر بيكتب لينكات الأقسام الناقصة وبتدي 404 عند الريفريش."
  echo "     الحل: python3 tools/make-route-pages.py وإعادة الرفع كاملة."
  bad=$((bad+miss))
fi

# ضابط (درس 21): مسار مالوش ملف لازم يفضل 404 — الدليل إن شبكة الأمان حية
ghost=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/kalam-fady-mesh-mawgood")
if [ "$ghost" = "404" ]; then
  echo "  ✓ ضابط: مسار مجهول لسه بيدي 404 — يعني ملف ناقص هيبان مش هيتبلع"
else
  echo "  ⚠️ مسار مجهول رجّع $ghost مش 404 — فيه fallback شغال، وأي ملف ناقص"
  echo "     هيرجع الصفحة بـ200 في صمت. شبكة الأمان «كله أو مفيش» مش مضمونة."
fi

csp=$(curl -sI "$BASE/" | grep -ci "content-security-policy")
[ "$csp" -eq 1 ] && echo "── CSP: ✓ نازلة" || { echo "── CSP: ✗ مش نازلة"; bad=$((bad+1)); }

[ "$bad" -eq 0 ] && echo "✅ كله تمام" || echo "❌ $bad مشكلة"
exit $((bad > 0 ? 1 : 0))
