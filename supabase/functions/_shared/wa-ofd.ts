// wa-ofd — المنطق الصافي لرسالة «المندوب في الطريق» (11 أكتوبر). من غير أي import: نفس الملف بيشتغل في Deno (wa-ofd-notify)
// وNode 22 (tools/test-wa-ofd-logic.mjs بيستورده بالحرف — مفيش نسخة تانية تنحرف).
//
// 🔴 مفيش أي حرف خفي مكتوب حرفياً هنا — كله \u escapes (عقد في check-functions.py): علامة اتجاه مدسوسة في regex
//    التنضيف كانت هتبان سليمة وهي بتسيب نفس الحرف يعدّي للعميل.
// 🔴 مفيش ساعة ولا Intl هنا — نافذة الإرسال (9–21 القاهرة) بتتحسب في SQL بس (send_until) عشان تغيير الساعة الصيفي.

export const OFD_PARAMS = 5;   // القالب الأول (order_out_for_delivery_ar)

// ترتيب المتغيرات لكل قالب — بيتختار بـparam_count بتاع صف wa_auto_templates (= أعلى {{n}} في النص المسجّل).
// 7 = القالب التاني (11 أكتوبر مساءً — طلب المالك: «احط في الرسالة اسم المنتج و سعره شامل الشحن») — مستني موافقة ميتا؛
// لحد ما صف القالب يتغيّر، الإنتاج على 5 زي ما هو.
export const OFD_LAYOUTS: Readonly<Record<number, readonly string[]>> = {
  5: ["first_name", "order_no", "courier_name", "courier_phone", "store_phone"],
  7: ["first_name", "order_no", "products", "amount", "courier_name", "courier_phone", "store_phone"],
};
export function ofdNeedsOrder(n: number): boolean {
  return (OFD_LAYOUTS[n] || []).some((k) => k === "products" || k === "amount");
}
// 🔴 الترتيب بالمكان بس كان هيعدّي قالب متسجّل بترتيب تاني (المندوب في {{3}} والمنتج في {{5}}) = نص غلط لكل العملاء من غير
// أي خطأ من ميتا (المراجعة 11 أكتوبر مساءً). فكل قالب ليه مراسي = الكلام اللي قبل كل متغير في النص المسجّل — النص لازم يحتويها
// كلها وإلا bad_template_params (= إيقاف قبل أي إرسال).
export const OFD_ANCHORS: Readonly<Record<number, readonly string[]>> = {
  5: ["أهلاً {{1}}", "رقم {{2}}", "اسم المندوب: {{3}}", "رقم المندوب: {{4}}", "على {{5}}"],
  7: ["أهلاً {{1}}", "رقم {{2}}", "المنتج: {{3}}", "(شامل الشحن): {{4}}", "اسم المندوب: {{5}}", "رقم المندوب: {{6}}", "على {{7}}"],
};
// (12 أكتوبر — المراجعة) نص اتلزق في SQL بـ'…\n…' عادي بيتخزن «\» + «n» حرفياً — المراسي والـCHECK بيعدّوه والصندوق بيعرض «\n»
// قدام الموظف في صمت؛ و\r من نسخة ويندوز. الاتنين = إيقاف قبل أي إرسال (النص الصح فيه سطور حقيقية بس).
export function ofdTemplateOk(body: unknown, n: number): boolean {
  const b = String(body ?? ""), a = OFD_ANCHORS[n];
  return !!a && !!OFD_LAYOUTS[n] && maxPlaceholder(b) === n && a.every((x) => b.includes(x)) && !b.includes("\\n") && !b.includes("\r");
}
// نص القالب التاني بالحرف (اللي المالك بيسجّله عند ميتا باسم order_out_for_delivery_v2_ar) — مرجع واحد للتسجيل والتبديل والهارنس.
export const OFD_BODY_V2 = "أهلاً {{1}}،\nطلبك رقم {{2}} خرج النهارده مع مندوب الشحن وفي الطريق ليك 🚚\n\nالمنتج: {{3}}\n"
  + "المطلوب عند الاستلام (شامل الشحن): {{4}}\n\nاسم المندوب: {{5}}\nرقم المندوب: {{6}}\n\n"
  + "تقدر تكلّم المندوب على طول لو حابب تتفق معاه على معاد الاستلام.\nولو فيه أي مشكلة كلّمنا على {{7}} أو رد على الرسالة دي.";

// ميتا بترفض المتغير اللي فيه سطر/تاب أو >4 مسافات ورا بعض (132018) وبترفض الفاضي
export function cleanParam(s: unknown, max: number): string {
  return Array.from(String(s ?? "")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g, " ")
    .replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
}

// 🔴 الاسم جاي من فورم عام: حروف/تشكيل/'/- بس (2–25) — لينك أو @ أو أرقام = «حضرتك» (سبام من رقمنا في قالب utility)
const NAME_TOKEN = /^[\p{L}\p{M}'\u2019-]{2,25}$/u;
// (11 أكتوبر مساءً — اتقاس على 60 يوم): «ام/أم X» (50) · «عبد X» (11) · «ابو X» · «Om X» كانوا بيطلعوا «أهلاً ام،» ·
// اللقب اللازق «د/زينب» «د.كفايه» «Dr.Hebatullah» كان بيترفض كله فيطلع اسم الأب · حرفين لاتيني «HH» «Ro» = مش اسم.
// كلمة لوحدها مش اسم — بتتلزق في اللي بعدها: «ام علي» · «عبد الرحمن» · «ام عبد الرحمن» · «Om Basel»
const JOIN_NEXT = new Set(["ام", "أم", "إم", "ابو", "أبو", "ابن", "بنت", "عبد", "om", "um", "umm", "abo", "abu", "abd", "el", "al"]);
// لقب كامل بيتقال مع الاسم: «مدام حنان» · «دكتورة اسماء» — لوحده (من غير اسم بعده) = «حضرتك»
const TITLES = new Set(["مدام", "الحاج", "الحاجه", "الحاجة", "حاج", "حاجه", "حاجة", "استاذ", "أستاذ", "الاستاذ", "الأستاذ",
  "استاذه", "استاذة", "أستاذة", "الاستاذه", "الاستاذة", "الأستاذة", "دكتور", "دكتوره", "دكتورة", "الدكتور", "الدكتوره",
  "الدكتورة", "مهندس", "مهندسه", "مهندسة", "المهندس", "المهندسه", "المهندسة", "الشيخ", "شيخ", "كابتن", "انسه", "انسة", "آنسه",
  "آنسة", "مستر", "مس", "ميس", "dr", "mr", "mrs", "ms", "miss", "eng"]);
// لقب مختصر لازق في الاسم («د/زينب» «د.كفايه» «م/احمد» «Dr.Hebatullah») = الاسم بس (مش عارفين دكتور ولا دكتورة)
const GLUED = /^(?:د|م|أ|ا|dr|eng|mr|mrs|ms)[./](.+)$/iu;
function nameTok(raw: string): string | null {
  const g = raw.match(GLUED);
  const tok = g ? g[1] : raw;
  // كلمة فيها رقم أو @ أو / أو : (هاندل · لينك · «محمد3») بتترفض كلها — مش بتتقص (القص كان بيطلّع «handle» من «@handle»)
  if (/[\p{N}@\/:]/u.test(tok)) return null;
  const t = tok.replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, "");
  if (!NAME_TOKEN.test(t)) return null;
  const low = t.toLowerCase();
  if (/^[A-Za-z]{2}$/.test(t) && !JOIN_NEXT.has(low) && !TITLES.has(low)) return null;          // «HH» «Ro» «Mm»
  // لاتيني كله كابيتال أو كله سمول = «Aya» (مش «AYA» ولا «aya»)
  return /^[A-Za-z'\u2019-]+$/.test(t) && (t === t.toUpperCase() || t === low) ? t[0].toUpperCase() + low.slice(1) : t;
}
export function ofdFirstName(full: unknown): string {
  const toks = cleanParam(full, 120).split(" ").map(nameTok);
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i]) continue;
    const parts: string[] = [];
    let j = i;
    if (TITLES.has(toks[j]!.toLowerCase())) parts.push(toks[j++]!);                              // لقب واحد بالكتير
    while (j < toks.length && toks[j] && JOIN_NEXT.has(toks[j]!.toLowerCase()) && parts.length < 3) parts.push(toks[j++]!);
    const core = j < toks.length ? toks[j] : null;
    if (!core || TITLES.has(core.toLowerCase()) || JOIN_NEXT.has(core.toLowerCase())) { i = j; continue; }   // لقب/«ام» من غير اسم بعده
    parts.push(core);
    const s = parts.join(" ");
    return Array.from(s).length <= 30 ? s : core;
  }
  return "حضرتك";
}

// اسم المندوب من وصف J&T (فيه فواصل ومسافات مزدوجة — اتقاس) — أي حاجة غريبة = «مندوب J&T»
const COURIER_NAME = /^[\p{L}\p{M}'\u2019\- ]{2,50}$/u;
export function ofdCourierName(raw: unknown): string {
  const n = cleanParam(String(raw ?? "").replace(/\s*,\s*/g, " "), 50);
  return COURIER_NAME.test(n) ? n : "مندوب J&T";
}

// = app.ship_rank_p10 بصيغة 01xxxxxxxxx (موبايل مصري بس · أرقام هندية/فارسي بتتحوّل)
export function egLocalMobile(p: unknown): string | null {
  const d = String(p ?? "").replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x6F0)).replace(/\D/g, "");
  const m = d.match(/^(?:0020|20|0)?(1[0125]\d{8})$/);
  return m ? "0" + m[1] : null;
}

// رقم المحل: موبايل أو أرضي/خط ساخن (5–11 رقم)
export function egLocalPhone(p: unknown): string | null {
  const mob = egLocalMobile(p); if (mob) return mob;
  const d = String(p ?? "").replace(/\D/g, "");
  return /^\d{5,11}$/.test(d) ? d : null;
}

// (11 أكتوبر مساءً) المنتج من orders.product_name («الاسم (عدد N)» — المتعدد بسطر جديد «\n+ » أو « - » بعد قوس الكمية،
// والاسم نفسه ممكن يكون فيه « - » فالتقسيم بعد قوس الكمية بس — نفس فكرة splitProductSegments في الواجهة: جزء من غير قوس كمية
// بعد منتج = بقية اسمه («… (عدد 1) - مقاس 85 عرض» = لاحقة خاصية قديمة) مش منتج لوحده).
// «(عدد 1)» بيتشال · «(عدد 2)» بيفضل · المتعدد بـ« + » · سقف 120 حرف **على منتجات كاملة** + «+ N منتجات تانية» (المبلغ في {{4}}
// بيغطي الكل — المنتج ماينفعش يختفي في صمت) · منتج واحد أطول من السقف بيتقص على آخر مسافة بـ«…».
// 🔴 (12 أكتوبر — المراجعة) الخاصية اللي العميل اختارها (props = manufacturer_note ← var) بتتحط بين قوسين بعد **أول** منتج:
//    24 أوردر في 30 يوم اسمهم «تيربو بريمو 5 دور» والعميل طالب «4 أدوار مدور» بسعر الـ4 — الرسالة كانت هتقول «5 دور» والبوليصة
//    (composeRemark) بتقول «4 أدوار مدور». أول منتج لأن var = cart_items[0] (اتقاس: 16 من 16 أوردر متعدد الخاصية بتاعة أوله) ·
//    مابتتكررش لو الاسم فيه نصها (نفس قاعدة remarkBaseLines) · ولو مش هتساع: المنتجات اللي بعده بتبقى «+ N» قبل ما الخاصية تتشال.
//    ولو الخاصية فيها عدد أدوار، عدد الأدوار القديم في اسم أول منتج بيتشال («تيربو بريمو 5 دور» + «4 أدوار مدور» = «تيربو بريمو
//    (4 أدوار مدور)» — اسم اللاندنج القديم كان «5 دور» للعيلة كلها والسعر بتاع الـ4).
// لاحقة خاصية المخزون اللي بتكرر آخر الاسم «تيربو بريمو 5 دور — 5 دور» بتتشال (اللي بتضيف معلومة «— 4 دور» «— أسود» بتفضل).
export const PRODUCTS_MAX = 120;
const QTY = /\(\s*عدد\s*([0-9\u0660-\u0669]+)\s*\)/gu;
const cpLen = (x: string) => Array.from(x).length;
function cutWords(x: string, max: number): string {
  const c = Array.from(x);
  if (c.length <= max) return x;
  const cut = c.slice(0, max).join(""), sp = cut.lastIndexOf(" ");
  return (sp >= max / 2 ? cut.slice(0, sp) : cut).trim();
}
function moreTail(r: number): string {
  return r <= 0 ? "" : r === 1 ? " + منتج تاني" : r === 2 ? " + منتجين تانيين" : r <= 10 ? ` + ${r} منتجات تانية` : ` + ${r} منتج تاني`;
}
function dropEchoSuffix(name: string): string {
  const vm = name.match(/^(.*\S)\s+—\s+(.+)$/u);
  return vm && (vm[1] === vm[2] || vm[1].endsWith(" " + vm[2])) ? vm[1] : name;
}
export const PROPS_MAX = 40;
const TIER_IN_PROPS = /[0-9\u0660-\u0669]+\s*(?:أدوار|ادوار|دور)/u;
const TIER_IN_NAME = /(?<=^|\s)[0-9\u0660-\u0669]+\s*(?:أدوار|ادوار|دور)(?=\s|$)/gu;
export function ofdProducts(raw: unknown, props?: unknown): string {
  const items: { name: string; q: number }[] = [];
  for (const seg of String(raw ?? "").split(/\r?\n|(?<=\(\s*عدد\s*[0-9\u0660-\u0669]+\s*\))\s*[-+]\s*/u)) {
    let q = 0;                                                                     // 0 = الجزء ده مالوش قوس كمية
    for (const m of seg.matchAll(QTY)) {
      q = Number(m[1].replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))) || 1;
    }
    const name = cleanParam(seg.replace(QTY, " ").replace(/^\s*\+\s*/, ""), 400);
    if (!name) continue;
    if (!q && items.length) { items[items.length - 1].name += " - " + name; continue; }   // بقية اسم المنتج اللي قبله
    items.push({ name, q: q || 1 });
  }
  if (!items.length) return "—";
  for (const it of items) it.name = dropEchoSuffix(it.name);
  const p = cleanParam(props, PROPS_MAX);
  if (p && TIER_IN_PROPS.test(p)) {
    items[0].name = items[0].name.replace(TIER_IN_NAME, " ").replace(/\s+/g, " ").replace(/^[\s—-]+|[\s—-]+$/gu, "").trim() || items[0].name;
  }
  const tag = p && !items[0].name.includes(p) ? ` (${p})` : "";
  const fmt = (it: { name: string; q: number }, i: number, t: string) => (i === 0 ? it.name + t : it.name) + (it.q > 1 ? ` (عدد ${it.q})` : "");
  for (const t of tag ? [tag, ""] : [""]) {
    for (let k = items.length; k >= 1; k--) {
      const s = items.slice(0, k).map((it, i) => fmt(it, i, t)).join(" + ") + moreTail(items.length - k);
      if (cpLen(s) <= PRODUCTS_MAX) return s;
    }
  }
  const tail = moreTail(items.length - 1);
  return cutWords(fmt(items[0], 0, ""), PRODUCTS_MAX - 1 - cpLen(tail)) + "…" + tail;
}

// المبلغ اللي المندوب هيحصّله (شامل الشحن): jt_cod_amount (= itemsValue عند J&T) ← total_cost.
// صفر = «0 جنيه» (أونلاين أو استبدال بفرق صفر) · مش رقم/سالب = bad_amount (الرسالة ماتطلعش بمبلغ غلط).
export function ofdAmount(cod: unknown, total: unknown): string {
  const raw = cod === null || cod === undefined || String(cod).trim() === "" ? total : cod;
  if (raw === null || raw === undefined || String(raw).trim() === "") throw new Error("bad_amount");
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) throw new Error("bad_amount");
  if (n === 0) return "0 جنيه";   // أونلاين · استبدال بفرق صفر — الصفر لوحده صح في الحالتين (مش «مدفوع» — المراجعة)
  const [i, f] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (f === "00" ? int : int + "." + f.replace(/0$/, "")) + " جنيه";
}

export type OfdRow = {
  customer_name?: string | null; order_uid?: string | null; tracking_no?: string | null;
  courier_name?: string | null; courier_phone?: string | null; store_phone?: string | null;
  product_name?: string | null; cod_amount?: unknown; total_cost?: unknown;     // للقالب 7 بس (من orders في الـEF)
  manufacturer_note?: string | null; var?: string | null;                       // الخاصية = manufacturer_note ← var (= orderProps في الواجهة)
  line_prices?: unknown; has_upsell?: boolean | null;                           // الموظف عدّل المنتجات؟ (save_order_products)
};
// 🔴 (12 أكتوبر — المراجعة) الخاصية جاية من أول منتج في سلة اللاندنج (cart_items[0]) — والموظف لو بدّل المنتج من محرر المنتجات
// الخاصية بتفضل على الأوردر (18039: استاند «5 أدوار» اتبدّل بمنظم المطبخ = «منظم المطبخ المتكامل (5 أدوار)»). ومفيش أي سجل بأول
// منتج الأصلي، فأي أوردر المنتجات فيه اتعدّلت (line_prices · has_upsell) = من غير خاصية (زي قبل) — معلومة ناقصة أحسن من غلط.
// أوردرات الشات (create_manual_order) مالهاش line_prices: الموظف بيختار المنتج والخاصية مع بعض.
export function ofdProps(r: OfdRow): string {
  if (r.line_prices != null || r.has_upsell === true) return "";
  return String(r.manufacturer_note ?? "").trim() || String(r.var ?? "").trim();
}

// المتغيرات بترتيب القالب (OFD_LAYOUTS[n]) — ولا واحد فاضي. الـ5: الاسم الأول · رقم الطلب · اسم المندوب · رقمه · رقم المحل
export function buildOfdParams(r: OfdRow, n: number = OFD_PARAMS): string[] {
  const keys = OFD_LAYOUTS[n]; if (!keys) throw new Error("bad_template_params");
  const cp = egLocalMobile(r.courier_phone); if (!cp) throw new Error("bad_courier_phone");
  const sp = egLocalPhone(r.store_phone);    if (!sp) throw new Error("bad_store_phone");
  const v: Record<string, string> = {
    first_name: ofdFirstName(r.customer_name),
    order_no: cleanParam(r.order_uid, 40) || cleanParam(r.tracking_no, 40) || "—",
    courier_name: ofdCourierName(r.courier_name), courier_phone: cp, store_phone: sp,
  };
  if (keys.includes("products")) v.products = ofdProducts(r.product_name, ofdProps(r));
  if (keys.includes("amount")) v.amount = ofdAmount(r.cod_amount, r.total_cost);
  return keys.map((k) => v[k]);
}

// = wa-followup / wa-start بالحرف: تعويض مرة واحدة ($& و{{n}} جوّه القيمة بيطلعوا زي ما هم)
export function renderTemplate(body: string, vals: string[]): string {
  return body.replace(/\{\{([1-9]\d?)\}\}/g, (m, i) => { const v = vals[Number(i) - 1]; return v === undefined ? m : v; });
}

export function maxPlaceholder(body: string): number {
  let m = 0;
  for (const x of body.matchAll(/\{\{([1-9]\d?)\}\}/g)) m = Math.max(m, Number(x[1]));
  return m;
}

// = app.wa_ofd_mask بالحرف — أي نص خطأ بيتخزن من غير أرقام تليفونات (≥8 خانات بمسافات/شرط)
export function maskDigits(s: unknown): string {
  return String(s ?? "").replace(/\+?[0-9\u0660-\u0669][0-9\u0660-\u0669\s-]{6,}[0-9\u0660-\u0669]/g, "#").slice(0, 300);
}

export function maskPhone(p: unknown): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length > 6 ? d.slice(0, 3) + "…" + d.slice(-3) : "…";
}

export function errCode(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9_:.-]/g, "").slice(0, 80) || "error";
}

export type MetaVerdict = {
  kind: "sent" | "transient" | "permanent" | "unknown" | "deferred" | "pause";
  code: string; cls?: "recipient" | "message" | "config"; detail: string;
};

const PAUSE = new Set([132000, 132001, 132007, 132012, 132015, 132016]);            // القالب نفسه
const STOP  = new Set([0, 3, 4, 10, 190, 200, 368, 80007, 131005, 131030, 131031, 131042, 131045, 131048, 131057, 133000, 133010]);
                                                                                   // الحساب/التوكن/الرقم بتاعنا/السقف — بيقع على كل رسالة
const TRANS = new Set([1, 2, 130429, 131000, 131016, 131056, 133004]);
const RECIP = new Set([131021, 131026]);                                           // الرقم نفسه (مش على واتساب · نفس الراسل)

// deno-lint-ignore no-explicit-any
export function classifyMeta(httpStatus: number, j: any): MetaVerdict {
  const e = j?.error;
  if (httpStatus >= 200 && httpStatus < 300 && !e) {
    const id = j?.messages?.[0]?.id;
    return id ? { kind: "sent", code: "", detail: String(id) } : { kind: "unknown", code: "no_wamid", detail: "" };
  }
  const code = Number(e?.code), sub = Number(e?.error_subcode);
  const detail = maskDigits(e?.error_data?.details || e?.message || `http ${httpStatus}`);
  const c = Number.isFinite(code) ? String(code) : `http_${httpStatus}`;
  if (PAUSE.has(code)) return { kind: "pause", code: c, cls: "config", detail };
  if (STOP.has(code) || (code === 100 && sub === 33) || httpStatus === 401 || httpStatus === 403)
    return { kind: "deferred", code: code === 100 ? "100.33" : c, detail };
  if (TRANS.has(code) || httpStatus === 429 || httpStatus >= 500) return { kind: "transient", code: c, detail };
  if (RECIP.has(code)) return { kind: "permanent", code: c, cls: "recipient", detail };
  return { kind: "permanent", code: c, cls: "message", detail };   // 100 · 131008 · 131009 · 131051 · 132005 · مجهول (circuit بيحمي)
}

// 🔴 أي استثناء = unknown (الطلب ممكن يكون وصل ميتا: reset · رد اتقطع) — إلا خطأ قبل الاتصال أصلاً
const PRECONNECT = /dns|connection refused|failed to lookup|ENOTFOUND|ECONNREFUSED/i;
export function classifyFetchError(e: unknown): MetaVerdict {
  // deno-lint-ignore no-explicit-any
  const name = String((e as any)?.name ?? ""), msg = String((e as any)?.message ?? "");
  if (name === "TimeoutError" || name === "AbortError") return { kind: "unknown", code: "timeout", detail: "" };
  if (PRECONNECT.test(msg)) return { kind: "transient", code: "connect_error", detail: "" };
  return { kind: "unknown", code: "fetch_error", detail: "" };
}
