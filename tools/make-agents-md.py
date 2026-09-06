#!/usr/bin/env python3
"""بيولّد `AGENTS.md` من `CLAUDE.md`.

ليه أصلاً؟ Codex (وأدوات تانية) بتقرا `AGENTS.md`، وClaude بيقرا `CLAUDE.md`.
والحل الساذج — نسخة يدوية تانية — هو **أخطر حل**: بعد شهر كل ملف بيقول
حقيقة مختلفة ومحدش واخد باله. ده نفس منطق صفحات الأقسام (`orders.html`
وأخواتها): **مصدر واحد للحقيقة + توليد + فحص بيمنع الانحراف**.

الشكل: مقدمة متولّدة (تحذير «ماتعدّلش هنا» + خلاصة «اقرا ده قبل ما تقترح
أي حاجة») ثم **`CLAUDE.md` كامل** حرفياً.

🔴 والخلاصة نفسها **مستخرجة من `CLAUDE.md`** مش مكتوبة هنا تاني — لو اتكتبت
هنا كانت هتنحرف عن الأصل وهي بالظبط الحتة اللي المفروض تمنع الانحراف.

الاستخدام:  python3 tools/make-agents-md.py [--check]
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "CLAUDE.md")
OUT = os.path.join(ROOT, "AGENTS.md")

# أقسام بتتسحب حرفياً للمقدمة — دي اللي بتوفّر أطول وقت على مراجع جديد
DIGEST_SECTIONS = [
    "## اللغة",
    "## 🔴 المبدأ المعماري الحاكم",
    "## 🔴 قواعد أمان لازمة",
    "## أسلوب الشغل (مهم جداً)",
    "## قرارات محسومة (متتناقشش تاني)",
]


def section(text, heading):
    """يرجّع القسم من عنوانه لحد العنوان اللي بعده على نفس المستوى."""
    lines = text.split("\n")
    try:
        start = lines.index(heading)
    except ValueError:
        raise SystemExit("مالقيتش القسم ده في CLAUDE.md: " + heading)
    out = [lines[start]]
    for ln in lines[start + 1:]:
        if ln.startswith("## "):
            break
        out.append(ln)
    # نشيل الفواصل والسطور الفاضية من الآخر
    while out and out[-1].strip() in ("", "---"):
        out.pop()
    return "\n".join(out)


HEADER = """<!-- ⚠️ ملف متولّد آلياً — ماتعدّلش فيه. -->
<!-- المصدر: CLAUDE.md · التوليد: python3 tools/make-agents-md.py -->

# سهل (Sahl) — دليل الوكلاء

> **الملف ده متولّد من `CLAUDE.md`.** أي تعديل هنا **بيضيع** مع أول توليد.
> عايز تغيّر حاجة؟ عدّل `CLAUDE.md` وشغّل `python3 tools/make-agents-md.py`.
> و`bash check.sh` بيرفض النشر لو الاتنين اختلفوا.

---

## 🔴 اقرا ده قبل ما تقترح أي حاجة

المشروع ده **شغّال على الهواء بأوردرات وفلوس حقيقية**، وعدّى عليه مراجعات
كتير. أكتر حاجة بتضيّع وقت في المراجعات إن الوكيل بيقترح حاجة **اتقررت خلاص**
أو **اتفحصت على الحالة الحية وطلعت غلط**. القسم ده موجود عشان تبدأ من حيث
انتهينا.

**قبل أي اقتراح، اتأكد إنه:**
1. مش في «قرارات محسومة» تحت — دي قرارات المالك ومش بتتناقش تاني.
2. مش في «المخاطر المفتوحة» في الملف الكامل — دول متشخّصين ومؤجّلين **بقرار**،
   مش منسيين.
3. **متحقق منه على الحالة الحية** (داتابيز/وركفلو/ملف) مش من قراءة الكود بس.
   الوثيقة مش دليل — اتلسعنا من ده قبل كده (درس 24).

**وقبل أي تعديل على الفرونت:** `bash check.sh` — بيمسك 12 حاجة، ستة منهم
مايقدرش يمسكهم لا `node --check` ولا المتصفح.
**وأي ميزة ضغط أو تغيير في مصدر بيانات** محتاجة هارنس متصفح كمان، **ومعاير
بحقن الباج اللي اتعمل عشانه** (درس 14) — التفاصيل في قسم «هارنس المتصفح».

---

## الخلاصة السريعة

> منسوخة حرفياً من الأقسام المقابلة في `CLAUDE.md` — الملف الكامل تحت.

"""

FULL_INTRO = """

---
---

# الملف الكامل (`CLAUDE.md`)

> كل اللي فوق موجود تحت كمان — الجزء ده هو **`CLAUDE.md` حرفياً** عشان مفيش
> حتة تضيع في الاختصار.

"""


def build():
    src = open(SRC, encoding="utf-8").read()
    digest = "\n\n---\n\n".join(section(src, h) for h in DIGEST_SECTIONS)
    return HEADER + digest + FULL_INTRO + src


def main():
    want = build()
    check_only = "--check" in sys.argv
    cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else None
    if cur == want:
        print("✓ AGENTS.md متطابق مع CLAUDE.md")
        return 0
    if check_only:
        print("✗ AGENTS.md مش متطابق مع CLAUDE.md" if cur is not None else "✗ AGENTS.md مش موجود")
        print("  الحل: python3 tools/make-agents-md.py")
        return 1
    open(OUT, "w", encoding="utf-8").write(want)
    print("✓ AGENTS.md اتولّد (%d سطر)" % want.count("\n"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
