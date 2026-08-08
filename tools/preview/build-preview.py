# بنّاء المعاينة الأوفلاين — بيجمّع نسخة «سهل بداتا وهمية» من app/ + overlay/
#
# الاستخدام:  python3 tools/preview/build-preview.py <فولدر-الخرج>
#
# اللي بيحصل:
#   1. نسخ app/ كاملة (من غير _headers — مفيش CSP في المعاينة المحلية)
#   2. نسخ overlay/ فوقها: _preview/ (supabase-js + chart.js + خط Cairo
#      محليين + preview-stub.js بتاع الداتا الوهمية) + ملفات التشغيل
#   3. تحويل index.html: العنوان بيتعلّم «[معاينة]»، لينك جوجل فونتس
#      بيتبدل بـcairo.css المحلي، وسكربتات الـCDN بتتبدل بالنسخ المحلية
#      + preview-stub.js بعدهم
#
# ⚠️ أي تحويلة مالهاش مرساة في index.html = فشل صريح مش تخطي صامت —
#    لو الـmarkup اتغير، السكربت بيقولك بدل ما يطلع معاينة ناقصة.
#
# ⚠️ preview-stub.js لازم يتحدث لما أعمدة/جداول جديدة تدخل الواجهة
#    (زي line_prices) — المعاينة بترندر من الستب ده مش من الداتابيز.

import shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent   # جذر الريبو
APP = ROOT / 'app'
OVERLAY = Path(__file__).resolve().parent / 'overlay'

REPLACEMENTS = [
    ('<title>سهل — لوحة التحكم</title>',
     '<title>[معاينة] سهل — لوحة التحكم</title>'),
    ('<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;900&family=JetBrains+Mono:wght@400;500;700;800&display=swap" rel="stylesheet">',
     '<link href="./_preview/cairo.css" rel="stylesheet">'),
    ('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/dist/umd/supabase.js" integrity="sha384-faMlYZUtkJj+Sh6Bmu/L0GzPcraRWN6CW+9RH3GUrK/Z0WS9tgaNNt0tHiLxsbdb" crossorigin="anonymous"></script>',
     '<script src="./_preview/supabase.js"></script>'),
    ('<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" integrity="sha384-e6nUZLBkQ86NJ6TVVKAeSaK8jWa3NhkYWZFomE39AvDbQWeie9PlQqM3pmYW5d1g" crossorigin="anonymous"></script>',
     '  <script src="./_preview/chart.umd.min.js"></script>\n  <script src="./_preview/preview-stub.js"></script>'),
]


def main():
    if len(sys.argv) != 2:
        sys.exit('الاستخدام: python3 tools/preview/build-preview.py <فولدر-الخرج>')
    out = Path(sys.argv[1]).resolve()
    if out.exists():
        sys.exit(f'الفولدر موجود بالفعل: {out} — امسحه الأول (مفيش كتابة فوق نشرة قديمة في صمت)')

    shutil.copytree(APP, out, ignore=shutil.ignore_patterns('_headers'))
    for item in OVERLAY.iterdir():
        dst = out / item.name
        if item.is_dir():
            shutil.copytree(item, dst)
        else:
            shutil.copy2(item, dst)

    idx = out / 'index.html'
    html = idx.read_text(encoding='utf-8')
    for old, new in REPLACEMENTS:
        if html.count(old) != 1:
            sys.exit(f'مرساة مش موجودة (أو متكررة) في index.html — الـmarkup اتغير:\n  {old[:80]}…')
        html = html.replace(old, new)
    idx.write_text(html, encoding='utf-8')

    print(f'✓ المعاينة اتبنت في {out}')
    print('  جرّبها:  cd فولدر-الخرج && python3 -m http.server 8899')


if __name__ == '__main__':
    main()
