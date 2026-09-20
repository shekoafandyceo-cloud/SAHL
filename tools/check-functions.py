# -*- coding: utf-8 -*-
"""فاحص مرآة الـEdge Functions — `supabase/functions/`.

🔴 المرآة **مش مصدر**: الحقيقة هي اللي على Supabase. الملفات هنا عشان الكود
يبقى متتبّع في git. فالفحص ده **مش** بيقارن بالحيّ (مفيش CLI ولا توكن في
البيئة دي) — هو بيمسك أشكال الفساد اللي بتحصل فعلاً لما الكود ينتقل:

  1) **فساد ترميز** — حصل بالحرف في `wa-inbox-ingest` v7: تعليق عربي اتشوّه
     في النقل (`الـ500` بقت `الـ40ذ٠0`) والكود كان سليم فمحدش واخد باله.
  2) **أقواس مش متوازنة / ملف مقصوص** — نسخة ناقصة بتفضل شكلها سليم.
  3) 🔴 **أسرار في الكود** — قاعدة أمان 3 في CLAUDE.md، ومكانتش متفحوصة
     في أي حتة قبل كده. الدوال دي بتتعامل مع توكنات ميتا ومفاتيح شحن.
  4) **العقود الموثّقة** — كل حارس مكتوب في CLAUDE.md لازم يكون موجود في
     المرآة. ده اللي بيمسك «نسخة قديمة اتحطت مكان الجديدة».

بيتشغّل من `check.sh` (الفحص الـ14) وكمان لوحده:
    python3 tools/check-functions.py
"""
import io
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FN_DIR = os.path.join(ROOT, "supabase", "functions")

errors = []


def err(m):
    errors.append(m)
    print(u"   ✗ " + m)


def ok(m):
    print(u"   ✓ " + m)


def scan_structure(s):
    """توازن الأقواس **خارج** السترينجات والكومنتات والـregex.

    ⚠️ أول نسخة مكانتش بتعرف الـregex literals، فـ`/Couldn't find/` خلّت
    الـ`'` تتقرا بداية سترينج والماسح بلع نص الملف وطلّع «أقواس مش متوازنة»
    على ملف سليم تماماً. الفاحص الغلط أسوأ من مفيش فاحص — بيدي إنذار كاذب
    فتتعوّد تتجاهله (درس 9).
    """
    i, n = 0, len(s)
    depth = {"{": 0, "(": 0, "[": 0}
    pair = {"}": "{", ")": "(", "]": "["}
    while i < n:
        c = s[i]
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "/":
            k = i - 1
            while k >= 0 and s[k] in " \t\n":
                k -= 1
            prev = s[k] if k >= 0 else "("
            if prev in "(,=:[!&|?{};+-*%~^<>" or s[max(0, k - 5):k + 1].endswith("return"):
                i += 1
                while i < n:
                    if s[i] == "\\":
                        i += 2
                        continue
                    if s[i] == "[":
                        while i < n and s[i] != "]":
                            i += 2 if s[i] == "\\" else 1
                    elif s[i] == "/":
                        break
                    elif s[i] == "\n":
                        break
                    i += 1
                i += 1
                continue
        if c in "\"'`":
            q = c
            i += 1
            while i < n:
                if s[i] == "\\":
                    i += 2
                    continue
                if s[i] == q:
                    break
                i += 1
            i += 1
            continue
        if c in depth:
            depth[c] += 1
        elif c in pair:
            depth[pair[c]] -= 1
        i += 1
    return depth


SECRET_PATTERNS = [
    (r"sbp_[A-Za-z0-9]{10,}", u"Supabase PAT"),
    (r"eyJ[A-Za-z0-9_-]{20,}\.", u"JWT"),
    (r"EAA[A-Za-z0-9]{20,}", u"Meta token"),
    (r"\bsk-[A-Za-z0-9]{20,}", u"مفتاح API"),
]


def check_file(slug):
    path = os.path.join(FN_DIR, slug, "index.ts")
    if not os.path.isfile(path):
        err(u"%s — مفيش index.ts" % slug)
        return None
    return check_source(slug, path, require_entry=True)


def check_source(slug, path, require_entry):
    """نفس الفحوص على أي ملف TypeScript في المرآة.

    `require_entry=False` للموديولات المشتركة في `_shared/` (زي عميل J&T) —
    دي مالهاش `Deno.serve` بطبيعتها، بس لازم تتفحص زي الدوال بالظبط: نفس
    الترميز ونفس الأقواس و**نفس فحص الأسرار** — هي اللي بتتعامل مع مفاتيح
    J&T أصلاً.
    """
    raw = io.open(path, "rb").read()
    try:
        s = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        err(u"%s — مش UTF-8 سليم: %s" % (slug, e))
        return None

    prob = []
    if u"�" in s:
        prob.append(u"فيه U+FFFD — الترميز اتكسر")
    ctrl = sorted(set(c for c in s if unicodedata.category(c) == "Cc" and c not in "\n\t"))
    if ctrl:
        prob.append(u"حروف تحكم غريبة: %r" % ctrl)
    bidi = sorted(set(c for c in s if c in u"‎‏؜‪‫‬‭‮"))
    if bidi:
        prob.append(u"علامات bidi مدسوسة: %r" % bidi)
    for k, v in scan_structure(s).items():
        if v != 0:
            prob.append(u"أقواس %s مش متوازنة (فرق %d)" % (k, v))
    if require_entry and "Deno.serve" not in s and "serve(" not in s:
        prob.append(u"مفيش نقطة دخول")
    if not s.endswith("\n"):
        prob.append(u"الملف مش منتهي بسطر جديد")
    for pat, name in SECRET_PATTERNS:
        if re.search(pat, s):
            prob.append(u"\U0001f534 سر محتمل في الكود: " + name)

    for m in prob:
        err(u"%s — %s" % (slug, m))
    if not prob:
        ok(u"%s — %d بايت · %d سطر" % (slug, len(raw), s.count("\n")))
    return s


# العقود الموثّقة في CLAUDE.md — (slug, وصف, دالة بترجّع bool)
CONTRACTS = [
    ("wa-send", u"حارس الرد `bad_reply_target`",
     lambda s: "bad_reply_target" in s),
    ("wa-send", u"التحقق بالتلاتة (tenant + conversation + wa_message_id)",
     lambda s: '.eq("tenant_id", conv.tenant_id)' in s and '.eq("conversation_id", conv.id)' in s
     and '.eq("wa_message_id", replyTo)' in s),
    ("wa-send", u"النسبة من التوكن مش من الـbody",
     lambda s: "auth.getUser()" in s and "body?.sent_by" not in s),
    ("wa-send", u"حارس مسار الميديا `bad_media_path` (عزل التجار)",
     lambda s: "bad_media_path" in s and "mediaPath.startsWith(prefix)" in s
     and "`${conv.tenant_id}/`" in s),
    ("wa-send", u"حارس نافذة الـ24 ساعة",
     lambda s: "window_closed" in s and "24 * 3600 * 1000" in s),
    ("wa-followup", u"الحمولة `order_id` بس — مفيش نص من المتصفح",
     lambda s: "body?.order_id" in s and "body?.text" not in s and "body?.customer_name" not in s),
    ("wa-followup", u"الأوردر بيتقرا بتوكن المستخدم (RLS)",
     lambda s: 'userClient.from("orders")' in s),
    ("wa-followup", u"النص من الداتابيز مش محفور — `no_template_body`",
     lambda s: "no_template_body" in s and "wa_followup_body" in s),
    ("wa-followup", u"cooldown 90 ثانية",
     lambda s: "COOLDOWN_MS = 90_000" in s),
    ("wa-followup", u"العلامة بتتكتب **بعد** نجاح ميتا",
     lambda s: "wa_followup_sent_at: sentAt" in s and "template_failed" in s
     and s.index("wa_followup_sent_at: sentAt") > s.index("template_failed")),
    ("wa-start", u"الحمولة رقم + معرّف قالب بس — مفيش نص من المتصفح",
     lambda s: "body?.phone" in s and "body?.template_id" in s
     and "body?.text" not in s and "body?.body" not in s and "body?.params" not in s),
    ("wa-start", u"القالب بيتقرا بتوكن المستخدم (RLS) — التصريح كله",
     lambda s: 'userClient.from("wa_start_templates")' in s),
    ("wa-start", u"tenant_id من صف القالب مش من الـbody",
     lambda s: "tpl.tenant_id" in s and "body?.tenant_id" not in s),
    ("wa-start", u"حارس النافذة المفتوحة `window_open` (مانحرقش فلوس)",
     lambda s: "window_open" in s and "last_inbound_at" in s),
    ("wa-start", u"قالب واحد لكل رقم كل 24 ساعة `too_soon`",
     lambda s: "too_soon" in s and "REOPEN_MS" in s),
    ("wa-start", u"قفل النفاد صريح (مفيش قراية أوردر تجيبه ببلاش)",
     lambda s: '"wallet_state"' in s and "is_depleted" in s and "depleted" in s),
    ("wa-start", u"الرقم بدالة الداتابيز المشتركة مش بمنطق محلي",
     lambda s: 'rpc("wa_id_from_phone"' in s),
    ("wa-start", u"المحادثة بتتعمل **بعد** نجاح ميتا",
     lambda s: 'svc.from("wa_conversations").insert(' in s and "template_failed" in s
     and s.index('svc.from("wa_conversations").insert(') > s.index("template_failed")),
    ("wa-inbox-ingest", u"v7: إصلاح مسح الـclid (keep بالمفاتيح الموجودة)",
     lambda s: "const keep" in s and "ctwa_clid" in s),
    ("wa-inbox-ingest", u"لسه بيلتقط reply_to_wa_id",
     lambda s: "reply_to_wa_id" in s),
    ("order-ship", u"tenant_id من الـJWT مش من الـbody",
     lambda s: "body.tenant_id" not in s and "body?.tenant_id" not in s),
    ("tenant-staff", u"tenant_id من بروفايل صاحب الطلب",
     lambda s: "body.tenant_id" not in s and "body?.tenant_id" not in s),
    ("platform-admin", u"سوبر أدمن بس",
     lambda s: "requireSuperAdmin" in s and "is_super_admin !== true" in s),
    ("bosta-print-awb", u"مقيّد بمتجر صاحب الطلب",
     lambda s: '.eq("tenant_id", tenantId)' in s),
    # ── عميل J&T المشترك (supabase/functions/_shared/jt.ts) ──
    ("_shared/jt", u"حارس الإنشاء في الإنتاج — boolean صريح مش من حمولة",
     lambda s: "jt_create_blocked_in_production" in s
     and 'cfg.env === "production" && opts.allowCreateInProduction !== true' in s),
    ("_shared/jt", u"النص اللي بيتوقّع عليه هو اللي بيتبعت — stringify مرة واحدة",
     lambda s: s.count("JSON.stringify(biz)") == 1
     and '"bizContent=" + encodeURIComponent(bizContent)' in s
     and "digest: headerDigest(bizContent, privateKey)" in s),
    ("_shared/jt", u"كلمة السر: UPPER HEX MD5 بالـsalt الموثّق",
     lambda s: 'JT_PASSWORD_SALT = "jadada236t2"' in s
     and "md5Hex(plainPassword + JT_PASSWORD_SALT).toUpperCase()" in s),
    ("_shared/jt", u"التعتيم موجود — الأسرار عمرها ما تتطبع",
     lambda s: "export function redactRequest" in s and '"<REDACTED>"' in s),
    ("_shared/jt", u"من غير أي import خارجي (بيشتغل في Deno وNode بنفس الملف)",
     lambda s: all(l.strip().startswith('import { bytesToBase64, md5Hex, md5Raw } from "./md5.ts"')
                   for l in s.splitlines() if l.strip().startswith("import "))),
]


def main():
    if not os.path.isdir(FN_DIR):
        err(u"supabase/functions/ مش موجود")
        return 1
    # المجلدات اللي بتبدأ بـ`_` موديولات مشتركة (مش دوال) — بتتفحص لوحدها تحت
    slugs = sorted(d for d in os.listdir(FN_DIR)
                   if os.path.isdir(os.path.join(FN_DIR, d)) and not d.startswith("_"))
    if not slugs:
        err(u"المرآة فاضية")
        return 1

    sources = {}
    for slug in slugs:
        s = check_file(slug)
        if s is not None:
            sources[slug] = s

    shared_dir = os.path.join(FN_DIR, "_shared")
    if os.path.isdir(shared_dir):
        for f in sorted(os.listdir(shared_dir)):
            if not f.endswith(".ts"):
                continue
            key = "_shared/" + f[:-3]
            s = check_source(key, os.path.join(shared_dir, f), require_entry=False)
            if s is not None:
                sources[key] = s

    for slug, label, test in CONTRACTS:
        s = sources.get(slug)
        if s is None:
            err(u"%s — العقد «%s» ماتفحصش (الملف مش مقروء)" % (slug, label))
            continue
        if not test(s):
            err(u"%s — العقد الموثّق مش موجود: %s" % (slug, label))
    if not errors:
        ok(u"كل الـ%d عقد الموثّق موجود في المرآة" % len(CONTRACTS))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
