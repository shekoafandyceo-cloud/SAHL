#!/usr/bin/env python3
"""بيولّد صفحة لكل قسم (`app/orders.html` · `app/chats.html` …) نسخة طبق الأصل
من `app/index.html`.

🔴 ليه نسخ ملفات مش SPA fallback؟
الاستضافة Cloudflare Worker، والطريقة «الرسمية» للينكات العميقة هي
`assets.not_found_handling: "single-page-application"` — وهي **حقل في metadata
النسخة مش ملف**، فرافع الداشبورد عمره ما هيقدر يظبطها، ومعاها **أي ملف ناقص
بيرجع index.html بـ200** فشبكة الأمان «كله أو مفيش» بتموت.

النسخ بتدّي نفس النتيجة من غير التمنين ده: الاستضافة بتشيل امتداد `.html`
تلقائياً (اتقاس حيّ 6 سبتمبر على app.sahlgedan.com بملف `probe.html`):
    /probe       → 200 text/html   (من غير أي تحويل)
    /probe.html  → 307 → /probe
    /probe/      → 307 → /probe    ← **بيشيل السلاش مش بيضيفها**
السطر التالت هو اللي بيخلي الخطة سليمة: عنوان المستند بيفضل من غير سلاش
دايماً، فالمسارات النسبية جوه الصفحة (`js/main.js`) بتتحل من الجذر صح.
وأي ملف ناقص بيفضل بيدي **404 بصوت عالي**.

🔴 **كله أو مفيش**: `probeDeepLinks` في الراوتر بتفتح البوابة لما `/orders`
ترد 200، وبعدها بتكتب لينك **لكل** قسم. فلو قسم واحد مالوش ملف، لينكه
بيتكتب وبيدي 404 عند الريفريش. عشان كده الفحص في `check.py` بيصرّ على إن
**كل** slug في `ROUTES` ليه ملف مطابق بالبايت.

الاستخدام:  python3 tools/make-route-pages.py [--check]
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
INDEX = os.path.join(APP, "index.html")
ROUTER = os.path.join(APP, "js", "core", "router.js")


def slugs():
    """الـslugs بتتقرا من `router.js` نفسه — مش مكتوبة هنا تاني.

    مصدر واحد للحقيقة: أي قسم يتضاف للراوتر بياخد ملفه تلقائي، وأي قسم
    يتشال بيتمسك في الفحص. لستة متكررة هنا كانت هتنحرف في صمت."""
    src = open(ROUTER, encoding="utf-8").read()
    m = re.search(r"var ROUTES = \{(.*?)\};", src, re.S)
    if not m:
        raise SystemExit("مالقيتش ROUTES في router.js")
    return [s for s in re.findall(r"^\s*([A-Za-z][A-Za-z0-9_]*)\s*:", m.group(1), re.M)]


def main():
    check_only = "--check" in sys.argv
    index = open(INDEX, "rb").read()
    names = slugs()
    if not names:
        raise SystemExit("ROUTES فاضية")
    changed, okc = [], 0
    for s in names:
        path = os.path.join(APP, s + ".html")
        cur = open(path, "rb").read() if os.path.exists(path) else None
        if cur == index:
            okc += 1
            continue
        changed.append(s)
        if not check_only:
            open(path, "wb").write(index)
    if check_only:
        if changed:
            print("✗ صفحات أقسام ناقصة أو مش مطابقة: " + ", ".join(changed))
            return 1
        print("✓ %d صفحة قسم مطابقة لـindex.html بالبايت" % okc)
        return 0
    print("✓ %d صفحة قسم جاهزة (%d اتحدّثت)" % (len(names), len(changed)))
    if changed:
        print("  " + ", ".join(s + ".html" for s in changed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
