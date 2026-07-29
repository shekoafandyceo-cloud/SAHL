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
    re.compile(r"\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)"),
]
EXPORT_LIST_RE = re.compile(r"\bexport\s*\{([^}]*)\}")


def collect_exports(src):
    """أسماء الـexports المسمّاة في ملف — تقريب نصي كفاية للغرض ده."""
    names = set()
    for pat in EXPORT_PATTERNS:
        names.update(pat.findall(src))
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
