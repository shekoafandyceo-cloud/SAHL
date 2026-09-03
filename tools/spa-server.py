#!/usr/bin/env python3
"""سيرفر ملفات ساكنة بـSPA fallback — نفس سلوك `_redirects` بتاع Cloudflare Pages.

لوحة التاجر بقى ليها لينك لكل قسم (/orders · /inventory · /chats …)، والمسارات
دي مش ملفات على الديسك. السيرفر ده بيرجّع `index.html` لأي مسار **من غير امتداد**
والراوتر في المتصفح بيحلّه.

⚠️ المسارات اللي ليها امتداد (.js .css .png) **مابتقعش على الـfallback** عمداً —
لو ملف ناقص لازم يدي 404 بصوت عالي بدل ما يرجّع HTML ويخبّي العطل (درس 20:
الفشل الصامت أخطر من الفشل).

الاستخدام:  python3 spa-server.py [PORT] [DIR]
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
ROOT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.getcwd()


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
            return os.path.join(ROOT, 'index.html')
        return real

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print(f'المعاينة شغالة على http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), SPAHandler).serve_forever()
