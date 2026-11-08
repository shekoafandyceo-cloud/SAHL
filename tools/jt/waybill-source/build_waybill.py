#!/usr/bin/env python3
"""
build_waybill.py — 3ataba.com × J&T Egypt waybill builder (100 × 150 mm, thermal B/W)

    python3 build_waybill.py data.sample.json --out out --name 3ataba-JT-waybill-sample --png

What it does
  1. Reads the order JSON.
  2. Generates the Code 128 barcode as inline SVG (bars = exactly 70 × 10 mm by default).
  3. Renders waybill-template.html (Jinja2) → a standalone HTML with the fonts embedded (base64).
  4. Measures the remark block in Chromium and keeps EVERYTHING on the single label: the remark
     font steps down 13 → 9 pt (one line per item), then switches to a compact inline "flow"
     layout 10 → 7 pt.  No second page, ever.
  5. Prints the PDF through Chromium (Playwright) at exactly 100 × 150 mm, then (optionally)
     rasterises page 1 to PNG at 300 dpi with pdftoppm.
  6. Prints a QA report (page size, barcode width, sorting-code text width, embedded fonts).

Requirements: python3, jinja2, python-barcode, playwright (+ chromium), poppler-utils (pdftoppm/pdfinfo/pdffonts).
"""
import argparse, base64, datetime, json, pathlib, re, subprocess, sys

from jinja2 import Environment, FileSystemLoader, select_autoescape

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = "waybill-template.html"
ARABIC_RANGE = ("U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,"
                "U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC")
FONT_FILES = [  # (family, file, weight, unicode-range or None)
    ("Cairo", "cairo-arabic-400-normal.woff2", 400, ARABIC_RANGE),
    ("Cairo", "cairo-arabic-700-normal.woff2", 700, ARABIC_RANGE),
    ("Cairo", "cairo-arabic-800-normal.woff2", 800, ARABIC_RANGE),
    ("Cairo", "cairo-latin-400-normal.woff2", 400, None),
    ("Cairo", "cairo-latin-700-normal.woff2", 700, None),
    ("Cairo", "cairo-latin-800-normal.woff2", 800, None),
    ("Liberation Sans", "LiberationSans-Regular.ttf", 400, None),
    ("Liberation Sans", "LiberationSans-Bold.ttf", 700, None),
]


# ----------------------------------------------------------------------------- barcode
def code128_modules(value: str) -> str:
    """Return the Code 128 bar/space pattern ('1' = bar) for `value` (auto subset A/B/C)."""
    import barcode  # python-barcode
    return barcode.get("code128", value).build()[0]


def barcode_svg(value: str, width_mm: float = 70.0, height_mm: float = 10.0, module_mm: float | None = None):
    """Inline SVG of the barcode. Either fit the bars into `width_mm` or use a fixed `module_mm`."""
    mods = code128_modules(value)
    n = len(mods)
    mw = module_mm if module_mm else width_mm / n
    total_w = n * mw
    rects, i = [], 0
    while i < n:
        if mods[i] == "1":
            j = i
            while j < n and mods[j] == "1":
                j += 1
            rects.append(f'<rect x="{i * mw:.4f}" y="0" width="{(j - i) * mw:.4f}" height="{height_mm}"/>')
            i = j
        else:
            i += 1
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w:.3f}mm" height="{height_mm}mm" '
           f'viewBox="0 0 {total_w:.4f} {height_mm}" shape-rendering="crispEdges" fill="#000" '
           f'style="width:{total_w:.3f}mm;height:{height_mm}mm">{"".join(rects)}</svg>')
    return svg, {"symbology": "Code 128 (auto subset)", "modules": n, "module_mm": round(mw, 4),
                 "width_mm": round(total_w, 3), "height_mm": height_mm}


def barcode_svg_vertical(value: str, length_mm: float = 54.0, bar_mm: float = 9.0):
    """Same Code 128 symbol, rotated 90°: the bars run horizontally and the code reads along the
    vertical axis (Code 128 is bidirectional, so top→bottom or bottom→top both decode)."""
    mods = code128_modules(value)
    n = len(mods)
    mw = length_mm / n
    rects, i = [], 0
    while i < n:
        if mods[i] == "1":
            j = i
            while j < n and mods[j] == "1":
                j += 1
            rects.append(f'<rect x="0" y="{i * mw:.4f}" width="{bar_mm}" height="{(j - i) * mw:.4f}"/>')
            i = j
        else:
            i += 1
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{bar_mm}mm" height="{length_mm}mm" '
           f'viewBox="0 0 {bar_mm} {length_mm}" shape-rendering="crispEdges" fill="#000" '
           f'style="width:{bar_mm}mm;height:{length_mm}mm">{"".join(rects)}</svg>')
    return svg, {"modules": n, "module_mm": round(mw, 4), "length_mm": length_mm, "bar_mm": bar_mm}


# ----------------------------------------------------------------------------- fonts
def font_css(inline: bool) -> str:
    out = []
    for fam, fname, weight, urange in FONT_FILES:
        path = HERE / "fonts" / fname
        fmt = "woff2" if fname.endswith(".woff2") else "truetype"
        if inline:
            mime = "font/woff2" if fmt == "woff2" else "font/ttf"
            src = f"url(data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()})"
        else:
            src = f"url(fonts/{fname})"
        rule = f'@font-face{{font-family:"{fam}";font-style:normal;font-weight:{weight};font-display:block;src:{src} format("{fmt}");'
        if urange:
            rule += f"unicode-range:{urange};"
        rule += "}"
        out.append(rule)
    return "\n".join(out)


# ----------------------------------------------------------------------------- data
def parse_remark(remark: str) -> list[dict]:
    """Split the J&T remark text into non-empty lines, printed exactly as written (nothing dropped)."""
    return [dict(text=raw.strip()) for raw in str(remark or "").replace("\r", "").split("\n") if raw.strip()]


def item_label(it: dict) -> str:
    """Compose a remark line from a structured item: 'qty × name color — مقاس size'."""
    s = str(it.get("name", "")).strip()
    if it.get("color"):
        s += f" {it['color']}"
    if it.get("size"):
        s += f" — مقاس {it['size']}"
    q = int(it.get("qty", 1))
    return (f"عدد {q} " if q > 1 else "") + s


def fmt_num(x):
    return f"{x:g}" if isinstance(x, (int, float)) else str(x)


def logo_data_uri(path: pathlib.Path) -> str:
    mime = "image/svg+xml" if path.suffix.lower() == ".svg" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def build_context(data: dict, args) -> dict:
    # The remark is the same free text SAHL sends to J&T's "remark" field (products + notes).
    remark = data.get("remark")
    if remark is None and data.get("items"):                      # backward compatible: structured items
        remark = "\n".join(item_label(it) for it in data["items"])
        if data.get("notes"):
            remark += "\n" + data["notes"].strip()
    lines = parse_remark(remark)
    bsvg, binfo = barcode_svg(data["waybill_no"], args.barcode_width, args.barcode_height, args.barcode_module)
    vsvg, vinfo = barcode_svg_vertical(data["waybill_no"], args.vbarcode_length, args.vbarcode_bar)
    printed_at = data.get("printed_at") or datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    sample = bool(data.get("sample", False))
    ctx = dict(
        doc_title=f"3ataba × J&T waybill {data['waybill_no']}" + (" — SAMPLE" if sample else ""),
        font_css=font_css(inline=not args.link_fonts),
        logo_src=logo_data_uri(pathlib.Path(args.logo) if pathlib.Path(args.logo).is_absolute() else HERE / args.logo),
        barcode_svg=bsvg, barcode_info=binfo, barcode_v_svg=vsvg, barcode_v_info=vinfo,
        jt_hotline=data.get("jt_hotline", ""),
        waybill_no=data["waybill_no"], service_type=data.get("service_type", "Standard"),
        sorting_code=data.get("sorting_code", ""),
        cod_display=f"{fmt_num(data.get('cod_amount', 0))} ج.م",
        weight_display=f"{fmt_num(data.get('weight_kg', 1))} كجم",
        recipient=data["recipient"], sender=data["sender"],
        lines=lines,
        remark_footer=data.get("remark_footer", "يسمح بالمعاينة أمام المندوب"),
        disclaimer=("نموذج تجريبي — غير صالح للشحن" if sample else data.get("footer_note", "")),
        printed_at=printed_at,
    )
    return ctx


# ----------------------------------------------------------------------------- render / measure
def render_html(env, ctx, remark_pt: float, remark_mode: str) -> str:
    tpl = env.get_template(TEMPLATE)
    return tpl.render(**ctx, remark_pt=remark_pt, remark_mode=remark_mode)


# Fit ladder for the remark block (always ONE page): list mode first, then compact inline flow.
LADDER = [(pt, "list") for pt in (13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5, 9)] + \
         [(pt, "flow") for pt in (10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5)]


JS_MEASURE = """
() => {
  const mm = px => px / 96 * 25.4;
  // a list overflows when its last row (+0.25em for hanging dots) ends below the list's clip edge
  const ov = el => { if (!el) return null; const last = el.lastElementChild; if (!last) return {overflow: false};
    const lb = last.getBoundingClientRect().bottom + 0.25 * parseFloat(getComputedStyle(last).fontSize);
    const edge = el.getBoundingClientRect().bottom; return {last_bottom: +lb.toFixed(1), edge: +edge.toFixed(1), overflow: lb > edge + 0.5}; };
  const r = {label: ov(document.getElementById('items-list'))};
  const st = document.getElementById('sort-text');
  if (st) { const b = st.getBoundingClientRect(); r.sort_text_mm = {w: mm(b.width), h: mm(b.height)}; }
  const sb = document.querySelector('.sort-box'); if (sb) { const b = sb.getBoundingClientRect(); r.sort_box_mm = {w: mm(b.width), h: mm(b.height)}; }
  const bc = document.querySelector('.bc svg'); if (bc) { const b = bc.getBoundingClientRect(); r.barcode_mm = {w: mm(b.width), h: mm(b.height)}; }
  const lab = document.getElementById('label'); if (lab) { const b = lab.getBoundingClientRect(); r.label_mm = {w: mm(b.width), h: mm(b.height)}; }
  const rows = {}; document.querySelectorAll('#label .row, #label .lcell').forEach(el => { const c = [...el.classList].find(x => x.startsWith('r-')); if (c) rows[c] = +mm(el.getBoundingClientRect().height).toFixed(2); });
  const side = document.getElementById('side'); if (side) { const b = side.getBoundingClientRect(); r.side_mm = {w: mm(b.width), h: mm(b.height)}; }
  const vb = document.querySelector('.vbc svg'); if (vb) { const b = vb.getBoundingClientRect(); r.vbarcode_mm = {w: mm(b.width), h: mm(b.height)}; }
  r.rows_mm = rows;
  // QA: (a) single-line elements wider than their box (would be cut at the row edge)
  r.clipped = [...document.querySelectorAll('#label .val, #label .to-name, #label .to-area, #label .from-name, #label .from-info, #label .wb, #label .brand, #label .service')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className + ': ' + el.textContent.trim().slice(0, 40));
  // (b) clip containers: last line box (+0.25em for hanging dots) must end above the clip edge
  ['.r-to', '.r-from', '.r-items .items-list'].forEach(sel => {
    const c = document.querySelector('#label ' + sel); if (!c) return;
    const edge = c.getBoundingClientRect().bottom - parseFloat(getComputedStyle(c).borderBottomWidth);
    let worst = -1e9;
    c.querySelectorAll('*').forEach(el => { if (!el.textContent.trim()) return; const b = el.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(el).fontSize); worst = Math.max(worst, b.bottom + 0.25 * fs - edge); });
    if (worst > 0.5) r.clipped.push(sel + ': content ' + mm(worst).toFixed(2) + ' mm below clip edge');
  });
  return r;
}
"""


def fix_page_size(pdf_path: pathlib.Path, w_mm: float, h_mm: float):
    """Set MediaBox/CropBox of every page to exactly w × h mm (top-left anchored). Needs PyMuPDF; skipped if absent."""
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf
        except ImportError:
            print("note: PyMuPDF not installed — page size left as Chromium produced it (≈100.16 × 150.28 mm)")
            return
    W, H = w_mm * 72 / 25.4, h_mm * 72 / 25.4
    doc = pymupdf.open(str(pdf_path))
    for pg in doc:
        # Chromium may offset the page content by a fraction of a mm: anchor the crop on the
        # label's own white background rectangle (the largest filled rect) instead of (0, 0).
        x0 = y0 = 0.0
        for d in pg.get_drawings():
            r = d["rect"]
            if d.get("fill") and r.width >= W * 0.98 and r.height >= H * 0.98:
                x0, y0 = max(0.0, r.x0), max(0.0, r.y0)
                break
        x0, y0 = min(x0, max(0.0, pg.rect.width - W)), min(y0, max(0.0, pg.rect.height - H))   # stay inside the page
        pg.set_cropbox(pymupdf.Rect(x0, y0, x0 + W, y0 + H))          # keep exactly 100 × 150 mm
        box = doc.xref_get_key(pg.xref, "CropBox")[1]
        doc.xref_set_key(pg.xref, "MediaBox", box)                    # MediaBox = CropBox (printers use MediaBox)
        doc.xref_set_key(pg.xref, "CropBox", "null")
    tmp = pdf_path.with_suffix(".tmp.pdf")
    doc.save(str(tmp), garbage=1, deflate=True)
    doc.close()
    tmp.replace(pdf_path)


def main():
    ap = argparse.ArgumentParser(description="Build a 3ataba × J&T waybill PDF (100×150 mm).")
    ap.add_argument("data", help="order JSON file")
    ap.add_argument("--out", default="out", help="output directory")
    ap.add_argument("--name", default=None, help="base file name (default: waybill-<waybill_no>)")
    ap.add_argument("--png", action="store_true", help="also rasterise page 1 to PNG (300 dpi)")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--link-fonts", action="store_true", help="reference fonts/ by path instead of embedding base64")
    ap.add_argument("--barcode-width", type=float, default=70.0, help="bar area width in mm (default 70)")
    ap.add_argument("--barcode-height", type=float, default=10.0, help="bar height in mm (default 10)")
    ap.add_argument("--logo", default="assets/3ataba-logo-wordmark-black.png",
                    help="brand logo (PNG/SVG, black on transparent) placed in the header")
    ap.add_argument("--vbarcode-length", type=float, default=54.0, help="vertical (2nd) barcode length in mm (default 54)")
    ap.add_argument("--vbarcode-bar", type=float, default=9.0, help="vertical (2nd) barcode bar height in mm (default 9)")
    ap.add_argument("--barcode-module", type=float, default=None,
                    help="fixed module width in mm (e.g. 0.5 = 4 dots @203 dpi); overrides --barcode-width")
    args = ap.parse_args()

    data = json.loads(pathlib.Path(args.data).read_text(encoding="utf-8"))
    out_dir = pathlib.Path(args.out); out_dir.mkdir(parents=True, exist_ok=True)
    name = args.name or f"waybill-{data['waybill_no']}"
    html_path, pdf_path = out_dir / f"{name}.html", out_dir / f"{name}.pdf"

    env = Environment(loader=FileSystemLoader(str(HERE)), autoescape=select_autoescape(["html"]))
    ctx = build_context(data, args)
    items = ctx["lines"]

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()

        def load(pt, mode):
            html_path.write_text(render_html(env, ctx, pt, mode), encoding="utf-8")
            page.goto(html_path.resolve().as_uri())
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(50)
            return page.evaluate(JS_MEASURE)

        # --- fit loop: one page only. Step the remark down the ladder until it fits. ------------
        fitted = None
        for pt, mode in LADDER:
            m = load(pt, mode)
            if not m["label"]["overflow"]:
                fitted = (pt, mode)
                break
        if fitted is None:                                   # even 7 pt flow overflows → keep it, warn loudly
            fitted = LADDER[-1]
            print(f"WARNING: remark ({len(items)} lines) does not fit even at {fitted[0]} pt flow — the end is clipped. "
                  "Shorten the remark text in SAHL for this order.", file=sys.stderr)
        remark_pt, remark_mode = fitted
        # Chromium quantises the page size (100 mm → 100.16 mm); print, then trim the MediaBox to exactly 100 × 150 mm.
        page.pdf(path=str(pdf_path), width="100mm", height="150mm", print_background=True,
                 prefer_css_page_size=False, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
        browser.close()
    fix_page_size(pdf_path, 100.0, 150.0)

    # --- QA -------------------------------------------------------------------------------
    info = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True).stdout
    size = re.search(r"Page size:\s+([\d.]+) x ([\d.]+) pts", info)
    fonts = subprocess.run(["pdffonts", str(pdf_path)], capture_output=True, text=True).stdout
    pages = re.search(r"Pages:\s+(\d+)", info)
    print("=== QA report ===")
    if size:
        w, h = float(size.group(1)) * 25.4 / 72, float(size.group(2)) * 25.4 / 72
        print(f"page size      : {w:.2f} × {h:.2f} mm   (target 100 × 150)")
    print(f"pages          : {pages.group(1) if pages else '?'}  (always 1)")
    print(f"barcode        : {ctx['barcode_info']}")
    print(f"barcode box    : {m['barcode_mm']['w']:.2f} × {m['barcode_mm']['h']:.2f} mm (measured)")
    print(f"2nd barcode    : vertical, {m['vbarcode_mm']['h']:.2f} mm long × {m['vbarcode_mm']['w']:.2f} mm bars, module {ctx['barcode_v_info']['module_mm']} mm ; side column {m['side_mm']['w']:.1f} × {m['side_mm']['h']:.1f} mm")
    print(f"sorting box    : {m['sort_box_mm']['w']:.2f} × {m['sort_box_mm']['h']:.2f} mm ; text {m['sort_text_mm']['w']:.2f} × {m['sort_text_mm']['h']:.2f} mm (Bold 20 pt)")
    print(f"rows (mm)      : {m['rows_mm']}")
    print(f"remark         : {len(items)} lines → {remark_pt} pt, {remark_mode} mode" + ("  (fits)" if not m["label"]["overflow"] else "  (CLIPPED)"))
    print(f"clipped text   : {m['clipped'] or 'none'}")
    print("embedded fonts :")
    print("\n".join("   " + l for l in fonts.strip().splitlines()))

    if args.png:
        prefix = out_dir / f"{name}-preview"
        subprocess.run(["pdftoppm", "-r", str(args.dpi), "-png", "-f", "1", "-l", "1", "-singlefile", str(pdf_path), str(prefix)], check=True)
        print(f"preview        : {prefix}.png ({args.dpi} dpi)")
    print(f"pdf            : {pdf_path}")
    print(f"html (source)  : {html_path}")


if __name__ == "__main__":
    main()
