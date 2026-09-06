#!/usr/bin/env python3
"""سيرفر ملفات ساكنة بيحاكي استضافة الـWorker — عشان الاختبارات والمعاينة.

لوحة التاجر بقى ليها لينك لكل قسم (/orders · /inventory · /chats …).

🔴 **الآلية الحقيقية نسخ ملفات مش SPA fallback**: فيه `app/orders.html` وأخواتها
(نسخ بالبايت من `index.html`، بيتولّدوا بـ`tools/make-route-pages.py`)،
والاستضافة بتشيل امتداد `.html` تلقائياً. اتقاس حيّ 6 سبتمبر بملف `probe.html`:
    /probe → 200 · /probe.html → 307 → /probe · /probe/ → 307 → /probe
فالسيرفر ده بيعمل نفس الحاجة: `<مسار>` → `<مسار>.html` لو موجود.

⚠️ المسارات اللي ليها امتداد (.js .css .png) **مابتقعش على أي fallback** عمداً —
لو ملف ناقص لازم يدي 404 بصوت عالي بدل ما يرجّع HTML ويخبّي العطل (درس 20:
الفشل الصامت أخطر من الفشل). ودي بالظبط الميزة اللي كانت هتضيع مع
`not_found_handling: "single-page-application"`.

⚠️ والـfallback على `index.html` لمسار مجهول من غير امتداد **متسايب عن قصد**:
الاستضافة الحقيقية بتدي 404 هناك، بس الهارنس محتاجه عشان يختبر سلوك الراوتر
لما مسار مجهول يوصل للوحة (زي بوكمارك لقسم اتشال، أو popstate).

الاستخدام:  python3 spa-server.py [PORT] [DIR] [--strict]

`--strict` بيشيل الـfallback ويخلي السلوك **مطابق للاستضافة الحقيقية** (مسار
مجهول = 404). بيتستخدم في معايرة `verify-deploy.sh` — من غيره السيرفر بيخدم
كل مسار من `index.html` فمعايرة «قسم ناقص» بتعدّي كذب.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
STRICT = '--strict' in sys.argv
PORT = int(ARGS[0]) if len(ARGS) > 0 else 8899
ROOT = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else os.getcwd()


class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        real = super().translate_path(path)
        if os.path.isdir(real):
            index = os.path.join(real, 'index.html')
            if os.path.exists(index):
                return index
        if not os.path.exists(real):
            # امتداد موجود = أصل حقيقي ناقص → سيبه يطلّع 404
            if os.path.splitext(real)[1]:
                return real
            # نفس تطبيع الاستضافة: `/orders` → `orders.html` لو موجود
            if os.path.exists(real + '.html'):
                return real + '.html'
            if STRICT:
                return real          # زي الاستضافة الحقيقية: 404
            return os.path.join(ROOT, 'index.html')
        return real

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print(f'المعاينة شغالة على http://localhost:{PORT}'
          + (' (صارم — من غير fallback)' if STRICT else ''))
    ThreadingHTTPServer(('127.0.0.1', PORT), SPAHandler).serve_forever()
