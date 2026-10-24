#!/usr/bin/env python3
"""
annotate_preview.py — draws the J&T-spec measurement boxes on top of a rendered preview PNG
(for the IT review only; not part of the printable label).

    python3 annotate_preview.py out/3ataba-JT-waybill-sample.html out/3ataba-JT-waybill-sample-preview.png out/annotated.png
"""
import pathlib, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

html, png, out = (pathlib.Path(a) for a in sys.argv[1:4])
DPI = 300
JS = """() => { const q = s => { const e = document.querySelector(s); if (!e) return null; const l = document.getElementById('label').getBoundingClientRect(); const b = e.getBoundingClientRect();
  const mm = v => v / 96 * 25.4; return {x: mm(b.left - l.left), y: mm(b.top - l.top), w: mm(b.width), h: mm(b.height)}; };
  return {bars: q('#label .bc svg'), vbars: q('#label .vbc svg'), sort: q('#label .sort-box'), wb: q('#label .wb'), items: q('#label .r-items'), to: q('#label .r-to'), grid: q('#label .grid')}; }"""
with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page(); p.goto(html.resolve().as_uri()); p.evaluate("document.fonts.ready"); p.wait_for_timeout(50)
    m = p.evaluate(JS); b.close()

im = Image.open(png).convert("RGB")
W, H = im.size
canvas = Image.new("RGB", (W + 40, H + 40), "white"); canvas.paste(im, (20, 20))
d = ImageDraw.Draw(canvas)
px = lambda mm: mm / 25.4 * DPI
font = ImageFont.truetype("fonts/LiberationSans-Bold.ttf", 30)
small = ImageFont.truetype("fonts/LiberationSans-Regular.ttf", 24)
RED, BLUE, GREEN = (220, 0, 0), (0, 80, 220), (0, 140, 60)

def box(r, color, label, dy=-40):
    x0, y0 = 20 + px(r["x"]), 20 + px(r["y"]); x1, y1 = x0 + px(r["w"]), y0 + px(r["h"])
    d.rectangle([x0, y0, x1, y1], outline=color, width=4)
    d.text((x0, y0 + dy), label, fill=color, font=font)

box(m["bars"], RED, f'Barcode bars {m["bars"]["w"]:.1f} × {m["bars"]["h"]:.1f} mm — Code 128', dy=-36)
if m.get("vbars"):
    box(m["vbars"], RED, f'2nd barcode {m["vbars"]["h"]:.0f} mm × {m["vbars"]["w"]:.0f} mm, vertical', dy=px(m["vbars"]["h"]) + 6)
box(m["sort"], BLUE, f'Sorting code box {m["sort"]["w"]:.0f} × {m["sort"]["h"]:.0f} mm — Bold 20 pt', dy=px(m["sort"]["h"]) + 6)
box(m["items"], GREEN, f'Products / notes area {m["items"]["h"]:.0f} mm tall ({m["items"]["h"] / 150 * 100:.0f}% of label)', dy=px(m["items"]["h"]) - 44)
# page outline
d.rectangle([20, 20, 20 + W - 1, 20 + H - 1], outline=(120, 120, 120), width=2)
d.text((24, H + 24 - 8), f"Page 100 × 150 mm · preview {DPI} dpi · quiet zone ≈ {(94 - m['bars']['w']) / 2 - 0.35:.0f} mm each side", fill=(90, 90, 90), font=small)
canvas.save(out)
print("annotated:", out, m)
