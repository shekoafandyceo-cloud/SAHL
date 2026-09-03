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
      if printf '%s' "$ct" | grep -qi "text/html"; then
        echo "  ✗ $rel → $code $ct — الملف ناقص والـfallback رجّع الصفحة مكانه"
        bad=$((bad+1))
      elif [ "$code" -ge 400 ] 2>/dev/null; then
        echo "  ✗ $rel → $code — مش موجود"
        bad=$((bad+1))
      fi ;;
  esac
done < <(find "$ROOT" -type f)

echo "── فحصت $n ملف"

# الضابط: لينك قسم لازم يرجّع HTML (بعد تفعيل الـSPA) — والأصول لأ (درس 21)
orders_ct=$(curl -s -o /dev/null -w '%{content_type}' "$BASE/orders")
orders_code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/orders")
echo "── /orders → $orders_code $orders_ct"
if [ "$orders_code" = "404" ]; then
  echo "   ℹ️ الـSPA لسه مش مفعّل — اللوحة بتشتغل من غير لينكات عميقة (مقصود)"
fi

csp=$(curl -sI "$BASE/" | grep -ci "content-security-policy")
[ "$csp" -eq 1 ] && echo "── CSP: ✓ نازلة" || { echo "── CSP: ✗ مش نازلة"; bad=$((bad+1)); }

[ "$bad" -eq 0 ] && echo "✅ كله تمام" || echo "❌ $bad مشكلة"
exit $((bad > 0 ? 1 : 0))
