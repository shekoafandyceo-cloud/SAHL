#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
فاحص ما قبل النشر لمشروع سهل.

بيتنادى من ./check.sh — متشغّلوش مباشرة إلا لو عارف انت بتعمل إيه.

بيفحص لكل ملف HTML:
  1. صيغة الجافاسكربت (inline + الملفات الخارجية) عن طريق `node --check`
  2. إن كل href/src محلي بيوصل لملف موجود فعلاً على الديسك   ← القاتل الصامت رقم 1
  3. إن مفيش IDs مكررة في الـmarkup الثابت                    ← من غير false positives
  4. إن كل `import {x}` بيلاقي `export` مطابق في الملف الهدف   ← اللي node --check مبيمسكهوش
  5. إن الـCSP في _headers متسقة مع وجود inline scripts        ← بوابة أمان قاطعة

الخروج: 0 = تمام، 1 = فيه مشاكل، 2 = أدوات ناقصة.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(os.path.join(__file__, "..")))
TARGETS = ["app/index.html", "admin/index.html"]

# مسارات مش محلية — بتتخطى من فحص الوجود
REMOTE_PREFIXES = ("http://", "https://", "//", "data:", "mailto:", "tel:", "#", "javascript:")

errors = []
warnings = []


def err(msg):
    errors.append(msg)
    print("   ✗ " + msg)


def warn(msg):
    warnings.append(msg)
    print("   ⚠ " + msg)


def ok(msg):
    print("   ✓ " + msg)


def info(msg):
    print("     " + msg)


# ---------------------------------------------------------------- أدوات نصية

SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.S | re.I)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
ID_RE = re.compile(r"""\sid\s*=\s*["']([^"']+)["']""")
LINK_RE = re.compile(r"""<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>""", re.I)
SRC_RE = re.compile(r"""<(?:script|img|source|video|audio)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']""", re.I)


def is_local(url):
    """هل ده مسار محلي المفروض يكون موجود على الديسك؟"""
    u = url.strip()
    return bool(u) and not u.lower().startswith(REMOTE_PREFIXES)


def strip_scripts(html):
    """شيل محتوى كل <script> عشان فحص الـIDs يشوف الـmarkup الثابت بس.

    ده بالظبط اللي كان بيعمل false positive: id جوه سترينج جافاسكربت
    مش id حقيقي في الصفحة.
    """
    return SCRIPT_RE.sub(lambda m: "<script></script>", html)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# ------------------------------------------------------- فحص صيغة الجافاسكربت

NODE = shutil.which("node")


def node_check(source, label, as_module):
    """بيرجّع True لو الصيغة سليمة. as_module بيحدد ESM ولا script كلاسيك."""
    if not NODE:
        return None
    suffix = ".mjs" if as_module else ".js"
    fd, tmp = tempfile.mkstemp(suffix=suffix, prefix="sahl_chk_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(source)
        p = subprocess.run([NODE, "--check", tmp], capture_output=True, text=True, encoding="utf-8", errors="replace")
        if p.returncode == 0:
            return True
        detail = (p.stderr or p.stdout or "").strip().splitlines()
        err("%s — خطأ صيغة" % label)
        for line in detail[:6]:
            info(line)
        return False
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def looks_like_esm(src):
    return re.search(r"^\s*(import\s|export\s|export\{|import\{)", src, re.M) is not None


# ------------------------------------------------------- فحص import / export

IMPORT_RE = re.compile(
    r"""import\s+(?:(?P<clause>[^'"]+?)\s+from\s+)?["'](?P<path>[^'"]+)["']""", re.S
)

EXPORT_PATTERNS = [
    re.compile(r"\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)"),
    re.compile(r"\bexport\s+class\s+([A-Za-z_$][\w$]*)"),
]
# تصريح واحد ممكن يصدّر أسماء كتير: export var a=[], b=null, c=0;
EXPORT_DECL_RE = re.compile(r"\bexport\s+(?:const|let|var)\s+(.*)")
EXPORT_LIST_RE = re.compile(r"\bexport\s*\{([^}]*)\}")


def collect_exports(src):
    """أسماء الـexports المسمّاة في ملف — تقريب نصي كفاية للغرض ده."""
    names = set()
    for pat in EXPORT_PATTERNS:
        names.update(pat.findall(src))
    for tail in EXPORT_DECL_RE.findall(src):
        tail = re.sub(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`", "S", tail)
        tail = re.sub(r"//.*$", "", tail)
        depth, cur, parts = 0, "", []
        for ch in tail:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
            if ch == "," and depth == 0:
                parts.append(cur)
                cur = ""
            else:
                cur += ch
        parts.append(cur)
        for p in parts:
            mm = re.match(r"\s*([A-Za-z_$][\w$]*)", p)
            if mm:
                names.add(mm.group(1))
    for block in EXPORT_LIST_RE.findall(src):
        for piece in block.split(","):
            piece = piece.strip()
            if not piece:
                continue
            # `a as b` بيصدّر b
            parts = re.split(r"\s+as\s+", piece)
            names.add(parts[-1].strip())
    if re.search(r"\bexport\s+default\b", src):
        names.add("default")
    if re.search(r"\bexport\s*\*", src):
        names.add("*")  # re-export — بنوقف الفحص عليه
    return names


def parse_import_bindings(clause):
    """بيرجّع (named, wants_default, is_namespace)."""
    clause = clause.strip()
    named, wants_default, namespace = [], False, False
    m = re.search(r"\{([^}]*)\}", clause)
    if m:
        for piece in m.group(1).split(","):
            piece = piece.strip()
            if piece:
                named.append(re.split(r"\s+as\s+", piece)[0].strip())
        clause = clause[: m.start()] + clause[m.end():]
    if re.search(r"\*\s+as\s+", clause):
        namespace = True
        clause = re.sub(r"\*\s+as\s+[A-Za-z_$][\w$]*", "", clause)
    if re.sub(r"[,\s]", "", clause):
        wants_default = True
    return named, wants_default, namespace


def check_module_graph(js_files, base_dir):
    """يتأكد إن كل import بيلاقي ملفه وبيلاقي الأسماء اللي بيطلبها."""
    if not js_files:
        return
    cache = {}
    for path in sorted(js_files):
        src = read(path)
        for m in IMPORT_RE.finditer(src):
            target = m.group("path")
            if not is_local(target):
                continue
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            rel_from = os.path.relpath(path, ROOT).replace("\\", "/")
            if not os.path.isfile(resolved):
                err("%s: import لملف مش موجود ← %s" % (rel_from, target))
                continue
            clause = m.group("clause")
            if not clause:
                continue  # import للأثر الجانبي بس
            if resolved not in cache:
                cache[resolved] = collect_exports(read(resolved))
            available = cache[resolved]
            if "*" in available:
                continue  # فيه re-export — مش هنحكم
            named, wants_default, _ns = parse_import_bindings(clause)
            for name in named:
                if name not in available:
                    err("%s: بيستورد {%s} من %s — مفيش export بالاسم ده"
                        % (rel_from, name, target))
            if wants_default and "default" not in available:
                err("%s: بيستورد default من %s — مفيش export default" % (rel_from, target))


# ----------------------------------------------- إسناد لـbinding مستورد

def check_import_writes(path, rel):
    """
    الإسناد لاسم مستورد بيرمي TypeError: Assignment to constant variable.

    ده أخطر شكل في التقسيم: بيحصل لما دالة تتنقل لموديول والحالة اللي
    بتكتب فيها تفضل مكانها. بيفشل **وقت التشغيل** ساعة ما الدالة تتنادى —
    يعني ممكن يعدّي من كل فحص تحميل ومن كل اختبار مش بيوصل للمسار ده.
    (حصل فعلاً: tour.js اتنقلت وهي بتكتب tourActive، والاختبار عدّى لأن
    tourStart بترجع بدري لما المستخدم مش أدمن.)
    """
    src = read(path)
    code = js_strip(src)
    imported = set()
    for m in IMPORT_RE.finditer(src):
        if not m.group("clause"):
            continue
        named, _d, _ns = parse_import_bindings(m.group("clause"))
        imported.update(named)
        for mm in re.finditer(r"\bas\s+([A-Za-z_$][\w$]*)", m.group("clause")):
            imported.add(mm.group(1))
    if not imported:
        return True
    # اسم مستورد وكمان متصرّح محلياً في أي نطاق: التصريح المحلي بيحجب
    # المستورد، فالإسناد قانوني. مش هنقدر نفرّق النطاقات بدقة فبنستثنيه.
    shadowed = set()
    for pat in (r"\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)",
                r"\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)",
                r"\bcatch\s*\(\s*([A-Za-z_$][\w$]*)"):
        shadowed.update(re.findall(pat, code))
    for m in re.finditer(r"function\s*\*?\s*[A-Za-z_$]*\s*\(([^)]*)\)|\(([^()]*)\)\s*=>", code):
        for g in m.groups():
            if not g:
                continue
            for p in g.split(","):
                p = p.strip().split("=")[0].strip()
                if re.fullmatch(r"[A-Za-z_$][\w$]*", p):
                    shadowed.add(p)
    # التصريحات المتعددة كمان: var a=1, b=2
    for m in re.finditer(r"\b(?:var|let|const)\s+([^;\n]*)", code):
        for p in m.group(1).split(","):
            mm = re.match(r"\s*([A-Za-z_$][\w$]*)", p)
            if mm:
                shadowed.add(mm.group(1))

    bad = {}
    for name in imported - shadowed:
        for m in re.finditer(r"(?<![.\w$])" + re.escape(name)
                             + r"\s*(?:=(?![=>])|\+\+|--|\+=|-=|\*=|/=|\|\|=|&&=|\?\?=)", code):
            pre = code[max(0, m.start() - 16):m.start()]
            if re.search(r"(var|let|const|function|case|import)\s*$", pre):
                continue
            bad.setdefault(name, []).append(code[:m.start()].count("\n") + 1)
    for name, lns in sorted(bad.items()):
        err("%s: بيكتب في `%s` وهي مستوردة — TypeError وقت التشغيل (سطور %s)"
            % (rel, name, lns[:6]))
    return not bad


# ------------------------------------------- أسماء مستخدمة من غير ما تتعرّف

JS_GLOBALS = set("""
window document console navigator location history screen localStorage sessionStorage
Math JSON Date Array Object String Number Boolean RegExp Function Symbol BigInt Proxy Reflect
Error TypeError RangeError SyntaxError ReferenceError EvalError URIError AggregateError
Promise Set Map WeakMap WeakSet WeakRef FinalizationRegistry Intl
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame
cancelAnimationFrame requestIdleCallback structuredClone reportError
alert confirm prompt fetch Headers Request Response FormData URL URLSearchParams
Blob File FileReader AbortController AbortSignal TextEncoder TextDecoder
Image Audio Option Event CustomEvent MouseEvent KeyboardEvent EventTarget Node Element
HTMLElement DocumentFragment MutationObserver IntersectionObserver ResizeObserver
Notification crypto atob btoa performance matchMedia getComputedStyle
Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array
ArrayBuffer DataView
undefined NaN Infinity globalThis arguments this null true false
supabase Chart
""".split())

# كلمات مفتاحية مش أسماء
JS_KEYWORDS = set("""
var let const function class return if else for while do switch case break continue
new delete typeof instanceof in of void throw try catch finally yield await async
export import from as default extends super static get set
""".split())


def js_strip(src):
    """يشيل الكومنتات والسترينجات والـregex literals، ويحافظ على عدد الأسطر."""
    out = []
    i, n = 0, len(src)
    prev = ""
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
            continue
        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", src[i:j]))
            i = j
            continue
        if c in "'\"`":
            q, j = c, i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            out.append(re.sub(r"[^\n]", " ", src[i:min(j + 1, n)]))
            i = j + 1
            prev = "val"
            continue
        if c == "/" and prev in ("", "op"):
            j, ok = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "/":
                    ok = True
                    break
                j += 1
            if ok:
                # كل الرايات بعد القفلة كمان (g, i, m, s, u, y, d) — من غيرها
                # بتتقري كأنها أسماء
                k = j + 1
                while k < n and src[k] in "gimsuyd":
                    k += 1
                out.append(" " * (k - i))
                i = k
                prev = "val"
                continue
        out.append(c)
        if not c.isspace():
            prev = "op" if c in "=(,{[;:!&|?+-*%<>~^" else "val"
        i += 1
    return "".join(out)


def check_free_identifiers(path, rel):
    """
    اسم بيتستخدم في موديول من غير ما يكون متعرّف فيه ولا مستورد ولا global.

    ده اللي حصل مع ui/clipboard.js: اتنقلت من main.js وهي بتنادي toast()،
    والـimport ما اتنقلش معاها. `node --check` مابيشوفوش (الصياغة سليمة)،
    وفحص الـimport→export مابيشوفوش (بيتأكد من الموجود مش الناقص).
    الفشل بيحصل **وقت الضغط**: نسخ من شاشة تفاصيل الأوردر بيرمي
    ReferenceError جوه then() فبيطلع unhandled rejection في الكونسول بس.
    """
    src = read(path)
    code = js_strip(src)

    declared = set(JS_KEYWORDS)
    for m in IMPORT_RE.finditer(src):
        if m.group("clause"):
            named, _d, _ns = parse_import_bindings(m.group("clause"))
            declared.update(named)
            for mm in re.finditer(r"\bas\s+([A-Za-z_$][\w$]*)", m.group("clause")):
                declared.add(mm.group(1))
            mm = re.match(r"\s*([A-Za-z_$][\w$]*)", m.group("clause"))
            if mm:
                declared.add(mm.group(1))

    # تصريحات var/let/const — لازم تتفك بالكامل: تصريح واحد ممكن يشيل
    # أسماء كتير (var all=[], fil=[], cur=1, PS=50, ...) وأخد الأول بس
    # بيدي إيجابيات كاذبة بالجملة
    for m in re.finditer(r"\b(?:var|let|const)\s", code):
        i, depth = m.end(), 0
        seg = ""
        while i < len(code):
            c = code[i]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif c == ";" and depth == 0:
                break
            elif c == "\n" and depth == 0 and re.match(r"\s*(?:var|let|const|function|if|for|while|return)\b",
                                                       code[i:i + 40]):
                break
            seg += c
            i += 1
        d, cur = 0, ""
        parts = []
        for c in seg:
            if c in "([{":
                d += 1
            elif c in ")]}":
                d -= 1
            if c == "," and d == 0:
                parts.append(cur)
                cur = ""
            else:
                cur += c
        parts.append(cur)
        for p in parts:
            lhs = p.split("=")[0]
            for nm in re.findall(r"[A-Za-z_$][\w$]*", lhs):
                declared.add(nm)

    for pat in (r"\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)",
                r"\bclass\s+([A-Za-z_$][\w$]*)",
                r"\bcatch\s*\(\s*([A-Za-z_$][\w$]*)",
                r"\bfor\s*\(\s*([A-Za-z_$][\w$]*)\s+(?:in|of)\b"):
        declared.update(re.findall(pat, code))
    # باراميترات
    for m in re.finditer(r"function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)"
                         r"|function\s*\(([^)]*)\)"
                         r"|\(([^()]*)\)\s*=>"
                         r"|([A-Za-z_$][\w$]*)\s*=>", code):
        for g in m.groups():
            if not g:
                continue
            for p in g.split(","):
                p = p.strip().split("=")[0].strip().lstrip(".")
                if re.fullmatch(r"[A-Za-z_$][\w$]*", p):
                    declared.add(p)

    free, typeof_only = {}, {}
    for m in re.finditer(r"([A-Za-z_$][\w$]*)", code):
        name = m.group(1)
        if name in declared or name in JS_GLOBALS:
            continue
        before = code[:m.start()].rstrip()
        if before.endswith(".") or before.endswith("?."):
            continue                      # خاصية مش اسم
        after = code[m.end():].lstrip()
        # `X:` عادةً مفتاح object literal أو label — إلا لو قبله `?` فده
        # فرع ternary والاسم قيمة حقيقية. غير الاستثناء ده كان بيخبّي
        # مرجع حر جوه `cond ? name : null`.
        if after.startswith(":") and not before.endswith("?"):
            continue
        if before.endswith("{") or before.endswith(","):
            if after.startswith(("}", ",")):
                continue                  # اختصار object literal
        ln = code[:m.start()].count("\n") + 1
        # `typeof X` قانوني على اسم غير معرّف ومابيرميش — بس بيفضل رائحة
        if re.search(r"\btypeof\s*$", before):
            typeof_only.setdefault(name, []).append(ln)
            continue
        free.setdefault(name, []).append(ln)

    for name, lns in sorted(free.items()):
        err("%s: بيستخدم `%s` من غير تعريف ولا import — سطور %s"
            % (rel, name, lns[:6]))
    for name, lns in sorted(typeof_only.items()):
        if name not in free:
            warn("%s: `typeof %s` واسم %s مش موجود في المشروع — الحارس دايماً false (سطور %s)"
                 % (rel, name, name, lns[:4]))
    return not free


# --------------------------------------------- دوال محبوسة جوه نطاق أضيق

FN_DECL = re.compile(r"^(?P<ind>[ \t]*)(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)\s*\(")


def check_trapped_functions(path):
    """
    دالة معرّفة جوه دالة تانية، وبتتنادى من برّه المدى بتاعها.

    الباج ده حصل فعلاً: كتلة طباعة البوليصة كانت مزوّدة مستوى indentation،
    فأداة لفّ الـwiring حسبتها جزء من المنطقة وحبستها جوه initOrdersUI.
    النداء من صف الجدول محمي بـ`typeof X === 'function'` فبقى يفشل **في
    صمت** — الزرار مايعملش حاجة ومفيش أي خطأ في أي مكان.

    مافيش أداة تانية بتمسك ده: `node --check` بيشوف الصياغة بس، والمتصفح
    مش بيشتكي لأن الحارس بيبلع الفشل.
    """
    src = read(path)
    lines = src.split("\n")
    stripped = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    stripped = re.sub(r"//[^\n]*", " ", stripped)
    stripped = re.sub(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`", "S", stripped)
    slines = stripped.split("\n")

    # دوال المستوى الأعلى ومداها: من سطر التعريف لحد أول سطر لاحق مسافته صفر
    tops = []
    for i, l in enumerate(lines):
        m = FN_DECL.match(l)
        if m and m.group("ind") == "":
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j].startswith((" ", "\t", "}"))):
                j += 1
            tops.append({"name": m.group("name"), "start": i, "end": j - 1})

    # أسماء بتتكرر في نطاقات مختلفة أو بتيجي كباراميتر مش بتتحكم عليها:
    # المرجع من برّه ساعتها ممكن يكون لتصريح تاني خالص.
    decl_count = {}
    for l in slines:
        m = FN_DECL.match(l)
        if m:
            decl_count[m.group("name")] = decl_count.get(m.group("name"), 0) + 1
    params = set()
    for m in re.finditer(r"function\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)|function\s*\(([^)]*)\)"
                         r"|\(([^()]*)\)\s*=>", stripped):
        for g in m.groups():
            if g:
                for p in g.split(","):
                    p = p.strip().split("=")[0].strip()
                    if re.fullmatch(r"[A-Za-z_$][\w$]*", p):
                        params.add(p)
    locals_ = set(re.findall(r"(?:^|[;{}\s])(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=[^=]", stripped))

    # دوال متداخلة (مسافة > 0) جوه كل واحدة
    for t in tops:
        for i in range(t["start"] + 1, t["end"] + 1):
            m = FN_DECL.match(lines[i])
            if not m or m.group("ind") == "":
                continue
            name = m.group("name")
            # الاسم لازم يكون فريد: تصريح واحد، ومش باراميتر ولا متغيّر محلي
            # في أي مكان تاني — وإلا المرجع من برّه ممكن يبقى لحاجة تانية
            if decl_count.get(name, 0) != 1 or name in params or name in locals_:
                continue
            outside = []
            for k, sl in enumerate(slines):
                if t["start"] <= k <= t["end"]:
                    continue
                if re.search(r"(?<![.\w$])" + re.escape(name) + r"(?![\w$])", sl):
                    outside.append(k + 1)
            if outside:
                err("%s: %s() معرّفة جوه %s() (سطر %d) وبتتنادى من برّه — سطور %s"
                    % (os.path.relpath(path, ROOT).replace("\\", "/"), name,
                       t["name"], i + 1, outside[:5]))


# ------------------------------------------------------------ بوابة أمان CSP

def check_csp(html_path, has_inline_script):
    """
    لو الـCSP شالت 'unsafe-inline' من script-src والملف لسه فيه inline <script>،
    المتصفح هيرفض ينفّذ الجافاسكربت كله والداشبورد بيبقى شاشة ميتة.
    ده بالظبط الفخ اللي وقعت فيه الخطة الأصلية.
    """
    headers = os.path.join(os.path.dirname(html_path), "_headers")
    if not os.path.isfile(headers):
        return
    text = read(headers)
    m = re.search(r"script-src([^;]*)", text)
    if not m:
        return
    directive = m.group(1)
    if has_inline_script and "'unsafe-inline'" not in directive:
        err("_headers: script-src من غير 'unsafe-inline' والملف لسه فيه inline <script> "
            "— الجافاسكربت كله هيترفض في المتصفح")
    if not has_inline_script and "'unsafe-inline'" in directive:
        warn("_headers: مفيش inline <script> خلاص — تقدر تشيل 'unsafe-inline' من script-src "
             "(سيبها في style-src)")


# ------------------------------------------------- تثبيت سكربتات الـCDN + SRI

CDN_SCRIPT_RE = re.compile(
    r"""<script\b([^>]*\bsrc\s*=\s*["'](https?://[^"']+)["'][^>]*)>""", re.I)
# النسخة بتيجي بعد اسم الحزمة بـ@ وبتبدأ برقم. الـ@ بتاعة الـscope (@supabase/…)
# بتبدأ بحرف فمابتتلقطش.
VERSION_RE = re.compile(r"@(\d[^/]*)")
SRI_RE = re.compile(r"""\bintegrity\s*=\s*["']\s*sha(256|384|512)-[A-Za-z0-9+/=]+\s*["']""", re.I)
CROSSORIGIN_RE = re.compile(r"""\bcrossorigin\b""", re.I)


def check_cdn_pinning(html_path, html):
    """
    كل سكربت خارجي من CDN لازم: نسخة مثبّتة كاملة + integrity + crossorigin،
    ولازم يبقى مذكور بمساره الكامل في script-src.

    التاج العائم (@2) بينزّل أي minor جديد تلقائياً على سطح بيحرّك فلوس.
    و integrity من غير crossorigin بيتجاهله المتصفح **في صمت** على الطلبات
    العابرة للأصول — يعني الحماية تبان موجودة وهي مش شغّالة.
    """
    rel = os.path.relpath(html_path, ROOT).replace("\\", "/")
    headers_path = os.path.join(os.path.dirname(html_path), "_headers")
    directive = ""
    if os.path.isfile(headers_path):
        m = re.search(r"script-src([^;]*)", read(headers_path))
        if m:
            directive = m.group(1)

    before = len(errors)
    found = []
    for m in CDN_SCRIPT_RE.finditer(html):
        attrs, url = m.group(1), m.group(2)
        found.append(url)

        ver = VERSION_RE.search(url.split("://", 1)[-1])
        if not ver:
            err("%s: %s — مفيش نسخة في المسار خالص" % (rel, url))
        elif not re.fullmatch(r"\d+\.\d+\.\d+", ver.group(1)):
            err("%s: نسخة عائمة (@%s) — ثبّتها كاملة (major.minor.patch): %s"
                % (rel, ver.group(1), url))

        if not SRI_RE.search(attrs):
            err("%s: مفيش integrity على %s — أي تغيير في الـCDN بينفّذ عندنا"
                % (rel, url))
        elif not CROSSORIGIN_RE.search(attrs):
            err("%s: فيه integrity من غير crossorigin على %s — المتصفح بيتجاهل "
                "الـintegrity في صمت" % (rel, url))

        if directive and url not in directive:
            err("%s: %s مش مذكور بمساره الكامل في script-src — لو الـdirective "
                "بتسمح بالهوست كله فأي ملف تاني عليه ينفّذ" % (rel, url))

    # مسار مثبّت في الـCSP وماحدش بيستخدمه = بقايا نسخة قديمة
    for tok in directive.split():
        if tok.startswith(("http://", "https://")) and "/" in tok.split("://", 1)[1]:
            if tok not in found:
                warn("_headers: script-src فيها %s ومفيش <script> بيناديه — "
                     "بقايا نسخة قديمة" % tok)

    if found and len(errors) == before:
        ok("سكربتات الـCDN مثبّتة بنسخة كاملة + integrity + crossorigin (%d)" % len(found))


# --------------------------------------------------------------- فحص ملف واحد

def check_html(rel_path):
    path = os.path.join(ROOT, rel_path)
    print("── " + rel_path)
    if not os.path.isfile(path):
        err("الملف مش موجود")
        return

    html = read(path)
    base = os.path.dirname(path)
    raw = html.encode("utf-8")
    lines = html.splitlines()
    longest = max((len(l) for l in lines), default=0)
    info("%s بايت | %d سطر | أطول سطر %d حرف" % (format(len(raw), ","), len(lines), longest))

    # --- 1. الجافاسكربت ---
    inline_blocks, external_js = [], []
    for m in SCRIPT_RE.finditer(html):
        attrs, body = m.group(1), m.group(2)
        src_m = re.search(r"""\bsrc\s*=\s*["']([^"']+)["']""", attrs)
        if src_m:
            if is_local(src_m.group(1)):
                external_js.append(src_m.group(1))
        elif body.strip():
            inline_blocks.append((body, "module" in attrs))

    info("inline scripts: %d | خارجية محلية: %d" % (len(inline_blocks), len(external_js)))

    # كل ملفات الجافاسكربت المحلية — اللي متربطة بـ<script src> واللي بتتحمّل بالـimport
    js_paths = []
    for srel in external_js:
        p = os.path.normpath(os.path.join(base, srel))
        if os.path.isfile(p) and p not in js_paths:
            js_paths.append(p)
    js_dir = os.path.join(base, "js")
    if os.path.isdir(js_dir):
        for dirpath, _dirs, files in os.walk(js_dir):
            for f in sorted(files):
                if f.endswith((".js", ".mjs")):
                    p = os.path.join(dirpath, f)
                    if p not in js_paths:
                        js_paths.append(p)

    # فحص الصيغة — محتاج node
    if not NODE:
        err("node مش متسطّب — مفيش فحص صيغة. ثبّته: winget install OpenJS.NodeJS.LTS")
    else:
        all_ok = True
        for i, (body, is_mod) in enumerate(inline_blocks, 1):
            label = "%s inline #%d" % (rel_path, i)
            if node_check(body, label, is_mod) is False:
                all_ok = False
        for p in js_paths:
            src = read(p)
            label = os.path.relpath(p, ROOT).replace("\\", "/")
            if node_check(src, label, looks_like_esm(src)) is False:
                all_ok = False
        if all_ok:
            ok("الجافاسكربت سليم (%d inline + %d ملف خارجي)" % (len(inline_blocks), len(js_paths)))

    # فحص جراف الموديولات — تحليل نصي، مش محتاج node
    check_module_graph(js_paths, base)

    # دوال محبوسة جوه نطاق أضيق من اللي بتتنادى منه
    before = len(errors)
    for p in js_paths:
        check_trapped_functions(p)
    if js_paths and len(errors) == before:
        ok("مفيش دوال محبوسة جوه نطاق أضيق")

    # أسماء مستخدمة من غير تعريف ولا import
    before = len(errors)
    for p in js_paths:
        check_free_identifiers(p, os.path.relpath(p, ROOT).replace("\\", "/"))
    if js_paths and len(errors) == before:
        ok("كل اسم مستخدم متعرّف أو مستورد")

    # إسناد لـbinding مستورد
    before = len(errors)
    for p in js_paths:
        check_import_writes(p, os.path.relpath(p, ROOT).replace("\\", "/"))
    if js_paths and len(errors) == before:
        ok("مفيش إسناد لأي binding مستورد")

    # --- 2. وجود كل مسار محلي ---
    missing = []
    for url in LINK_RE.findall(html) + SRC_RE.findall(html):
        if is_local(url):
            target = os.path.normpath(os.path.join(base, url.split("?")[0].split("#")[0]))
            if not os.path.isfile(target):
                missing.append(url)
    if missing:
        for u in missing:
            err("مرجع لملف مش موجود: %s" % u)
    else:
        ok("كل الـhref/src المحلية موجودة على الديسك")

    # --- 3. IDs مكررة في الـmarkup الثابت ---
    static = strip_scripts(COMMENT_RE.sub("", html))
    counts = {}
    for i in ID_RE.findall(static):
        counts[i] = counts.get(i, 0) + 1
    dups = {k: v for k, v in counts.items() if v > 1}
    if dups:
        for k, v in sorted(dups.items()):
            err("ID مكرر في الـmarkup: %s (×%d)" % (k, v))
    else:
        ok("مفيش IDs مكررة في الـmarkup الثابت (%d id)" % len(counts))

    # --- 4. IDs مكررة جوه سترينجات الجافاسكربت (تحذير مش فشل) ---
    js_counts = {}
    for body, _ in inline_blocks:
        for i in ID_RE.findall(body):
            js_counts[i] = js_counts.get(i, 0) + 1
    js_dups = {k: v for k, v in js_counts.items() if v > 1}
    if js_dups:
        for k, v in sorted(js_dups.items()):
            warn("id=\"%s\" متولّد من %d مواضع في الجافاسكربت — اتأكد إنهم مش بيتواجدوا مع بعض" % (k, v))

    # --- 5. بوابة CSP ---
    check_csp(path, has_inline_script=bool(inline_blocks))

    # --- 6. تثبيت سكربتات الـCDN + SRI ---
    check_cdn_pinning(path, html)


# ---------------------------------------------------------------------- main

def main():
    if sys.version_info < (3, 8):
        print("محتاج Python 3.8+")
        return 2
    for t in TARGETS:
        check_html(t)
        print()
    if errors:
        print("❌ %d مشكلة — ماتنشرش" % len(errors))
        return 1
    if warnings:
        print("✅ كله تمام (و %d تحذير) — جاهز للنشر" % len(warnings))
    else:
        print("✅ كله تمام — جاهز للنشر")
    return 0


if __name__ == "__main__":
    sys.exit(main())
