// ai-order — «البوت يسجّل الأوردر بنفسه» (17 نوفمبر — طلب المالك: «لما عميل يطلب اوردر هو اللي يعمل الاوردر بنفسه … ميصعدش»).
// منطق نقي من غير أي import ولا شبكة: بيشتغل في Deno (wa-ai-draft) وفي Node (tools/test-ai-order.mjs) بنفس الملف بالحرف.
//
// 🔴 الثوابت:
//   • الموديل بيطلّع بيانات الأوردر (order) بس — القرار «يتسجّل ولا لأ» هنا، بقواعد ثابتة: المنتج والمقاس من ai_products (ليه صنف مخزون
//     وسعر معتمد) · موبايل مصري · محافظة معروفة ومش مستثناة · عنوان واضح · العدد 1–3.
//   • السعر من السيستم (السعر المعتمد للمقاس) — عمره ما بييجي من الموديل ولا من كلام العميل.
//   • عميل ليه أوردر سابق مرتجع/استثناء، أو أوردر لسه مفتوح = مفيش تسجيل تلقائي: البيانات بتتاخد والمحادثة بتتصعّد بالسبب (قرار المالك).
//   • التسجيل نفسه RPC على السيرفر (create_bot_order — service_role بس والزرار ON) وبيعيد نفس الحراسات. الملف ده مابيكتبش حاجة.
//   • نص التأكيد للعميل ثابت من هنا (رقم الطلب والمنتج والإجمالي من السيستم) — مش من الموديل.

export interface OrderDraft { product: string; variant: string; qty: number; name: string; phone: string; governorate: string; address: string }
export interface OrderVariant { label: string; stockProductId: string; price: number | null }
export interface OrderProduct { id: string; name: string; aliases: string[]; siteNames: string[]; variants: OrderVariant[]; note?: string | null } // note = «معلومات للـAgent» على كارت المنتج
export interface PrevOrder { order_uid: string; status: string }
export interface CreateArgs {
  customer_name: string; phone: string; alt_phone: string | null; city: string; address: string;
  stock_product_id: string; qty: number; unit_price: number; variant: string; total: number; product_label: string;
}
export type OrderStep =
  | { kind: "create"; args: CreateArgs }
  | { kind: "ask"; text: string; why: string }        // بيانات ناقصة/مش واضحة — البوت يسأل العميل (من غير تصعيد)
  | { kind: "handoff"; note: string; why: string };   // مايتسجّلش تلقائي — البيانات اتاخدت وزميل يراجع (تصعيد بالسبب)

export const ORDER_MAX_QTY = 3;
export const ORDER_HANDOFF_TEXT = "تمام يا فندم، بيانات حضرتك اتسجلت، وزميلي هيراجعها ويأكد الطلب مع حضرتك.";
export const BLOCKED_GOVS = ["شمال سيناء"];

/** «معلومات للـAgent» على كارت المنتج بتقول إنه خلص/مش متوفر (المالك بيكتبها بإيده) = البوت مايسجّلش أوردره. كلمة زيادة = موظف يراجع (الاتجاه الآمن). */
export function stockOutNote(note: string | null | undefined): boolean {
  return /خلص|نفد|(مش|غير) (متوفر|موجود|متاح)/.test(normKey(String(note || "")));
}
/**
 * collect من غير order والرد بيوعد العميل بتأكيد التسجيل («ثواني وهأكد…») = الموديل نسي بيانات الأوردر.
 * من غير الحارس ده العميل بيفضل مستني تأكيد مش جاي — فالمحادثة بتروح لموظف يسجّله. null = الرد سؤال عادي (لسه بيجمّع).
 */
export function orphanPromise(reply: string): OrderStep | null {
  return /ثواني|ه[اأ]كد/.test(String(reply || ""))
    ? { kind: "handoff", why: "no_order_data", note: "العميل بعت بياناته والمساعد ماطلّعش بيانات الأوردر — راجع الشات وسجّله إنت" } : null;
}

const DIG: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};
const latin = (s: string) => String(s ?? "").replace(/[٠-٩۰-۹]/g, (d) => DIG[d] || d);
/** تطبيع للمطابقة بس: أرقام لاتيني · من غير تشكيل ولا تطويل · أ/إ/آ = ا · ة = ه · ى = ي · أي رمز = مسافة. */
export function normKey(s: string): string {
  return latin(String(s ?? "")).toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const firstNum = (s: string) => (latin(s).match(/\d+/) || [""])[0];

/** موبايل مصري بالشكل المحلي 01xxxxxxxxx — نفس app.eg_mobile بالحرف. null لو مش موبايل مصري. */
export function egMobile(p: string): string | null {
  let d = latin(String(p ?? "")).replace(/[^0-9]/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = "0" + d;
  return /^01[0-9]{9}$/.test(d) ? d : null;
}

// المحافظات الـ27 بالاسم اللي بيتسجّل + أشكال العميل بيكتبها بيه (بعد التطبيع).
const GOVS: [string, string[]][] = [
  ["القاهرة", ["cairo"]], ["الجيزة", ["giza"]], ["الإسكندرية", ["اسكندريه", "alexandria", "alex"]],
  ["القليوبية", []], ["الدقهلية", []], ["الشرقية", []], ["الغربية", []], ["المنوفية", []], ["البحيرة", []],
  ["كفر الشيخ", []], ["دمياط", []], ["بورسعيد", ["بور سعيد"]], ["الإسماعيلية", []], ["السويس", []], ["الفيوم", []],
  ["بني سويف", []], ["المنيا", []], ["أسيوط", []], ["سوهاج", []], ["قنا", []], ["الأقصر", []], ["أسوان", []],
  ["البحر الأحمر", []], ["الوادي الجديد", []], ["مطروح", ["مرسي مطروح"]], ["شمال سيناء", []], ["جنوب سيناء", []],
];
const bare = (k: string) => k.replace(/^محافظه\s+/, "").replace(/^ال/, "");
/** اسم المحافظة المعتمد من نص العميل/الموديل. null لو مش محافظة معروفة (اسم مدينة مثلاً). */
export function govOf(text: string): string | null {
  const k = bare(normKey(text));
  if (!k) return null;
  for (const [name, alts] of GOVS) {
    if (bare(normKey(name)) === k) return name;
    if (alts.some((a) => bare(normKey(a)) === k)) return name;
  }
  return null;
}

/** عنوان «واضح» بالحد الأدنى الثابت: 3 كلمات و12 حرف على الأقل ومش اسم المحافظة لوحده. (الحكم الأدق — شارع وعلامة — من الموديل قبل ما يملا order.) */
export function addressClear(address: string, gov: string | null): boolean {
  const a = String(address ?? "").replace(/\s+/g, " ").trim();
  if (a.length < 12) return false;
  const words = normKey(a).split(" ").filter(Boolean);
  if (words.length < 3) return false;
  if (gov && bare(normKey(a)) === bare(normKey(gov))) return false;
  return true;
}

const RETURNED = /returned|exception|failed/i;
const CLOSED_OK = /^(delivered|cancelled)$/i;
function prevProblem(prev: PrevOrder[]): string | null {
  const bad = prev.find((o) => RETURNED.test(String(o.status || "")));
  if (bad) return "العميل ليه أوردر سابق #" + bad.order_uid + " رجع/مااستلموش — راجع قبل ما تسجّل الجديد";
  const open = prev.find((o) => !CLOSED_OK.test(String(o.status || "")));
  if (open) return "العميل عنده أوردر #" + open.order_uid + " لسه مفتوح — ممكن يكون تكرار";
  return null;
}

function pickProduct(text: string, products: OrderProduct[]): OrderProduct | null {
  const k = normKey(text);
  if (!k) return null;
  const names = (p: OrderProduct) => [p.name, ...(p.aliases || []), ...(p.siteNames || [])].map(normKey).filter(Boolean);
  const exact = products.filter((p) => names(p).includes(k));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // مش مطابق بالحرف: أطول اسم المنتج جوّه النص (أو العكس) — ولازم يطلع منتج واحد
  let best: OrderProduct | null = null, bestLen = 0, tie = false;
  for (const p of products) {
    const len = Math.max(0, ...names(p).filter((n) => k.includes(n) || n.includes(k)).map((n) => Math.min(n.length, k.length)));
    if (!len) continue;
    if (len > bestLen) { best = p; bestLen = len; tie = false; } else if (len === bestLen) tie = true;
  }
  return tie ? null : best;
}
function pickVariant(text: string, p: OrderProduct, sizeNums: Set<string>): OrderVariant | "ask" | null {
  const vs = p.variants || [];
  if (!vs.length) return null;
  const num = firstNum(text), k = normKey(text);
  // مقاس واحد للمنتج: لو العميل طالب رقم مقاس موجود عند منتج تاني ومش عند ده («دورين مقاس 65») = مش متسجّل — مانسجّلش مقاس غير اللي طلبه
  if (vs.length === 1) return num && sizeNums.has(num) && num !== firstNum(vs[0].label) ? null : vs[0];
  const byNum = num ? vs.filter((v) => firstNum(v.label) === num) : [];
  if (byNum.length === 1) return byNum[0];
  const byText = k ? vs.filter((v) => normKey(v.label) === k) : [];
  if (byText.length === 1) return byText[0];
  return "ask";
}
const money = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * القرار: يتسجّل · يتسأل العميل · يتحوّل لموظف.
 * waId = رقم واتساب العميل (2010…) — بيتاخد رقم الموبايل لو العميل قال «نفس الرقم»، وبيتسجّل رقم إضافي لو كتب رقم تاني.
 */
export function planOrder(d: OrderDraft, products: OrderProduct[], prev: PrevOrder[], waId: string | null, blockedGovs: string[] = BLOCKED_GOVS): OrderStep {
  const p = pickProduct(d.product, products);
  if (!p) return { kind: "handoff", why: "product", note: "المنتج «" + String(d.product || "").slice(0, 60) + "» مش من المنتجات اللي البوت بيسجّلها — سجّل الأوردر إنت" };
  if (stockOutNote(p.note)) return { kind: "handoff", why: "stock_note", note: "«معلومات للـAgent» على كارت المنتج بتقول إنه خلص/مش متوفر — راجع قبل ما تسجّل" };
  const sizeNums = new Set(products.flatMap((x) => (x.variants || []).map((y) => firstNum(y.label))).filter(Boolean));
  const v = pickVariant(d.variant, p, sizeNums);
  if (v === "ask") return { kind: "ask", why: "variant", text: "تحب حضرتك أنهي مقاس يا فندم: " + p.variants.map((x) => x.label).join(" ولا ") + "؟" };
  if (!v || !v.stockProductId) return { kind: "handoff", why: "variant", note: "المقاس/النوع «" + String(d.variant || "").slice(0, 40) + "» مش متسجّل للمنتج ده — سجّل الأوردر إنت" };
  if (typeof v.price !== "number" || !isFinite(v.price) || v.price <= 0) return { kind: "handoff", why: "price", note: "السعر المعتمد للمقاس ده مش متسجّل — سجّل الأوردر إنت" };

  const qty = Math.trunc(Number(d.qty) || 1);
  if (qty < 1) return { kind: "ask", why: "qty", text: "حضرتك محتاج كام قطعة يا فندم؟" };
  if (qty > ORDER_MAX_QTY) return { kind: "handoff", why: "qty", note: "العميل طالب " + qty + " قطع — راجع وسجّل الأوردر إنت" };

  const name = String(d.name || "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || /^[\d\s]+$/.test(latin(name))) return { kind: "ask", why: "name", text: "ممكن الاسم يا فندم؟" };

  const waLocal = waId ? egMobile(waId) : null;
  const rawPhone = String(d.phone || "").trim();
  const samePhone = !rawPhone || /واتس|نفس/.test(rawPhone);
  const phone = samePhone ? waLocal : egMobile(rawPhone);
  if (!phone) return { kind: "ask", why: "phone", text: "ممكن رقم موبايل صحيح (11 رقم) يا فندم؟" };

  const gov = govOf(d.governorate);
  if (!gov) return { kind: "ask", why: "gov", text: "ممكن حضرتك تقول المحافظة يا فندم؟" };
  if (blockedGovs.some((b) => govOf(b) === gov)) return { kind: "ask", why: "blocked_gov", text: "معلش يا فندم، الشحن مش متاح لمحافظة " + gov + " حالياً." };
  const address = String(d.address || "").replace(/\s+/g, " ").trim();
  if (!addressClear(address, gov)) return { kind: "ask", why: "address", text: "ممكن العنوان بالتفصيل يا فندم: المنطقة واسم الشارع ورقم العمارة وعلامة مميزة؟" };

  const pp = prevProblem(prev || []);
  if (pp) return { kind: "handoff", why: "prev_order", note: pp };

  return {
    kind: "create",
    args: {
      customer_name: name.slice(0, 80), phone, alt_phone: waLocal && waLocal !== phone ? waLocal : null, city: gov, address: address.slice(0, 300),
      stock_product_id: v.stockProductId, qty, unit_price: v.price, variant: v.label, total: v.price * qty,
      product_label: p.name + (p.variants.length > 1 ? " — " + v.label : ""),
    },
  };
}

/** رسالة التأكيد للعميل بعد التسجيل — كل أرقامها من السيستم. */
export function orderConfirmText(a: CreateArgs, orderUid: string, delivery: string | null): string {
  const lines = [
    "تم تسجيل طلب حضرتك يا فندم",
    "رقم الطلب: " + orderUid,
    "المنتج: " + a.product_label + (a.qty > 1 ? " (عدد " + a.qty + ")" : ""),
    "الإجمالي عند الاستلام: " + money(a.total) + " جنيه شامل الشحن",
    "الاسم: " + a.customer_name,
    "العنوان: " + a.address + "، " + a.city,
  ];
  const del = String(delivery || "").trim();
  lines.push((del ? "التوصيل " + del : "هنتواصل مع حضرتك بميعاد التوصيل") + "، والمعاينة متاحة قبل الاستلام.");
  return lines.join("\n");
}

/** ملخص بيانات الأوردر لملاحظة التصعيد (لما البوت مايسجّلش) — عشان الموظف مايرجعش يقرا الشات كله. */
export function orderSummary(d: OrderDraft): string {
  const parts = [d.product, d.variant, Number(d.qty) > 1 ? "عدد " + d.qty : "", d.name, d.phone, d.governorate, d.address]
    .map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return parts.join(" · ").slice(0, 260);
}
