#!/usr/bin/env python3
"""بيجمّع Edge Function في ملف index.ts واحد للنشر عبر MCP (مش بيتنشر من الريبو).

ليه: النشر عبر MCP محتواه بيتكتب بإيد الوكيل، و`wa-ai-draft` بملفاته الستة (~126 ألف حرف)
عدّى حد الخرج في الرد الواحد (17 نوفمبر). الباندل بيشيل الكومنتات والـtypes (~94 ألف حرف)
والمصدر في `supabase/functions/` بيفضل هو المرآة — الباندل ناتج بناء منه بس.

الاستخدام:
    npm i esbuild            # مرة، في أي فولدر مؤقت (cwd)
    python3 tools/bundle-ef.py wa-ai-draft /tmp/out/index.ts [--compact]

`--compact` (21 نوفمبر — v13 بقى ~124 ألف حرف وده قريب من الحد اللي وقع): esbuild بـ`--minify-whitespace
--line-limit=900` = نفس البرنامج بالظبط (أسماء المتغيرات والنصوص زي ما هي) من غير مسافات البداية والسطور الفاضية
(~104 ألف حرف · ~136 سطر). المقارنة بالنسخة المقروءة: `esbuild --minify-whitespace` على الاتنين = نفس الناتج بالحرف.

بعد esbuild بيحوّل لـ\\uXXXX: حروف التحكم/المخفية · الأرقام الفارسي (U+06F0–06F9) · U+0671 ·
وأي حرف غير ASCII جوّه أول regex class في normKey — عشان النسخ بالإيد مايغيّرش حرف شبيه.
"""
import re, subprocess, sys, unicodedata as U
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    args = [a for a in sys.argv[1:] if a != "--compact"]
    compact = len(args) != len(sys.argv) - 1
    if len(args) != 2:
        sys.exit(__doc__)
    fn, out = args[0], Path(args[1])
    src = ROOT / "supabase" / "functions" / fn / "index.ts"
    if not src.exists():
        sys.exit(f"مش لاقي {src}")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["npx", "esbuild", str(src), "--bundle", "--format=esm", "--platform=neutral", "--charset=utf8",
         "--legal-comments=none", "--external:https://*", "--external:npm:*", "--external:jsr:*",
         *(["--minify-whitespace", "--line-limit=900"] if compact else []),
         f"--outfile={out}", "--log-level=warning"],
        check=True,
    )
    s = out.read_text(encoding="utf-8")

    def esc(ch):
        return "\\u%04x" % ord(ch)

    buf = []
    for ch in s:
        c = U.category(ch)
        hidden = (c in ("Cc", "Cf", "Co", "Cn", "Zl", "Zp") and ch != "\n") or (c == "Zs" and ch != " ")
        buf.append(esc(ch) if hidden or "۰" <= ch <= "۹" or ch == "ٱ" else ch)
    s = "".join(buf)
    # regex classes فيها علامات تشكيل خام (Mn) = تتحوّل كلها
    def fix_class(m):
        body = m.group(1)
        if not any(U.category(c) == "Mn" for c in body):
            return m.group(0)
        return "/[" + "".join(c if ord(c) < 128 else esc(c) for c in body) + "]"
    s = re.sub(r"/\[([^\]\n]*)\]", fix_class, s)
    out.write_text(s, encoding="utf-8")
    left = [hex(ord(c)) for c in set(s) if U.category(c) in ("Cc", "Cf") and c != "\n"]
    print(f"{out}: {len(s)} حرف · {s.count(chr(10)) + 1} سطر · أطول سطر {max(map(len, s.split(chr(10))))}"
          + (f" · ⚠️ حروف مخفية فاضلة {left}" if left else ""))


if __name__ == "__main__":
    main()
