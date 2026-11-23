// self-check — بصمة النسخة المنشورة من wa-ai-draft (23 نوفمبر): الدالة بتتنشر باندل بيتكتب بإيد الوكيل عبر MCP (مفيش مقارنة بالبايت)،
// فـ{ action: "self_check" } بيرجّع sha256 لمخرجات الدوال النقية على مدخلات ثابتة — التعليمات · أشكال الدخل الأربعة · النصوص الثابتة ·
// الـregex (على عبارات ثابتة) · الـschema · حالات التقييم — وtools/self-check.mjs بيحسب نفس الأرقام من المصدر في Node.
// أي حرف اتغيّر في النسخ بيبان في الجزء بتاعه. 🔴 مفيش شبكة ولا داتابيز هنا — مدخلات ثابتة بس.
// ⚠️ سطر «الوقت دلوقتي» في أشكال الدخل بيتشال قبل الحساب (Intl بيختلف بين Deno وNode).
import {
  buildSystemPrompt, buildUserPrompt, FEE_TAG_TEXT, MEDIA_RULES, normAr, parseDraft, preRule, RESPONSE_SCHEMA, RESPONSE_SCHEMA_FEE, statusText, WORK_HOURS_DEFAULT,
  type DraftCtx,
} from "./ai-draft.ts";
import { escReply, HOLD_DEFAULT, mergeEscNote, tidyReply } from "./ai-auto.ts";
import { deliveryWish, normKey, ORDER_HANDOFF_TEXT, orderConfirmText, orphanPromise, REACT_HANDOFF_TEXT, reactivateConfirmText, STALE_ASK_TEXT, stockOutNote } from "./ai-order.ts";
import { MEDIA_SCHEMA, mediaPrompt, parseMediaText } from "./ai-media.ts";
import { feeAskText, feeBlockNote, feeCancelAsked, feeConfigOf, feeFactLine, feeNote, feeReminderText } from "./ai-fee.ts";

const NOW = "2026-11-23T12:00:00Z";
const PHRASES = [
  "ابعت رقم التحويل", "عاوزة ألغي الأوردر من فضلك", "معلش مش مستعدة أشتريه حاليا", "مش عايز ادفع كاش", "المبلغ كام", "الغالي", "متلغوش", "كنسل",
  "مش هستلمه", "ثواني يا فندم وهراجع مع زميلي", "زميلي هيتواصل مع حضرتك فوراً", "زي ما في الكارت", "بالكارت", "هنزل اول شهر", "بعد اسبوع يوم الاتنين",
  "مسافره", "ثواني وهأكد", "خلص من المخزون", "مش متوفر", "إلغاء", "لحظة واحدة يا فندم، زميلي هيرد حالاً", "١٢٣ أحمد", "الإسكندرية", "هيتلغي",
];
const CFG = feeConfigOf({ cancel_fee: { amount: 50, pay_to: "01050005219", pay_name: "عبدالمحسن صابر", methods: "إنستا باي أو محفظة" } });

function ctxOf(): DraftCtx {
  const o = (uid: string, status: string, extra: Record<string, unknown> = {}) =>
    ({ order_uid: uid, status, product_name: "منظم المطبخ المتكامل (عدد 1)", props: "مقاس 85 عرض", total: 1499, created_at: "2026-11-21T10:00:00Z", status_at: "2026-11-23T08:00:00Z", ...extra });
  return {
    nowIso: NOW,
    facts: { delivery: "من 24 إلى 48 ساعة إن شاء الله", shipping: "مجاني", discount_code: { code: "cash5", percent: 5 }, pickup: { address: "مدينة السلام", hours: "12–6" } },
    products: [], linkedProductId: null, ad: { name: "KitchenOrganizer", body: "منظم المطبخ المتكامل" },
    cards: [{ id: "c1", title: "مطبخ", body: "منظم المطبخ المتكامل\nمقاس 85 بـ 1499", notes: "مقاس 85 خلصان حالياً" }, { id: "c2", title: "تيربو", body: "تيربو بريمو 4 أدوار" }],
    siteRows: [{ name: "منظم المطبخ المتكامل", variant: "مقاس 85 عرض", price: 1499, n: 3 }], stockNames: ["منظم المطبخ المتكامل", "تيربو بريمو"],
    orders: [o("18801", "In transit between Hubs", { fee_tag: true }), o("18790", "cancelled", { cancel_tag: "self" }), o("18780", "Out for delivery")],
    ordersKnown: true, customerName: "منى",
    history: [{ dir: "in", body: "السلام عليكم" }, { dir: "out", body: "منظم المطبخ المتكامل\nمقاس 85 بـ 1499" }, { dir: "in", type: "voice", body: null, media: "عايزة الغي الأوردر" }],
    ...(CFG ? { feeLine: feeFactLine(CFG) } : {}),
  } as unknown as DraftCtx;
}

/** الأجزاء اللي بتتحسب بصمتها (نفس الترتيب والمحتوى في Deno وNode). evalData = [EVAL_CASES, CTX, EXPECT] من wa-ai-draft. */
export function selfCheckParts(evalData: unknown): Record<string, unknown> {
  const ctx = ctxOf();
  const noTime = (s: string) => s.split("\n").filter((l) => !l.startsWith("- الوقت دلوقتي")).join("\n");
  const ev = ["request", "again", "paid", "refused", "keep"] as const;
  return {
    sys: [buildSystemPrompt(), buildSystemPrompt({ esc: "v2", hours: WORK_HOURS_DEFAULT }), buildSystemPrompt({ esc: "v2", hours: WORK_HOURS_DEFAULT, fee: true }), MEDIA_RULES],
    user: ["v1", "v2", "v3", "v4"].map((L) => noTime(buildUserPrompt(ctx, L as "v1"))),
    schema: [RESPONSE_SCHEMA, RESPONSE_SCHEMA_FEE, MEDIA_SCHEMA],
    texts: [HOLD_DEFAULT, ORDER_HANDOFF_TEXT, REACT_HANDOFF_TEXT, STALE_ASK_TEXT, FEE_TAG_TEXT, mediaPrompt("image", ["منظم المطبخ"]), mediaPrompt("voice", ["تيربو"]),
      orderConfirmText({ customer_name: "منى", phone: "01012345678", alt_phone: null, city: "القاهرة", address: "مدينة نصر شارع 9", stock_product_id: "x", qty: 2, unit_price: 1499, variant: "مقاس 85", total: 2998, product_label: "منظم المطبخ — مقاس 85" } as never, "B-7", "من 24 إلى 48 ساعة"),
      reactivateConfirmText({ id: "x", order_uid: "18801", status: "cancelled", product_name: "منظم المطبخ", total: 1499 } as never, null)],
    fee: CFG ? [feeFactLine(CFG), ...[0, 1, 2].map((n) => feeReminderText(CFG, n)), ...ev.map((e) => feeNote(e, CFG, "18801", e === "paid")), feeBlockNote(CFG, "no_cancel"), feeBlockNote(CFG, "not_shipped"),
      feeAskText([{ dir: "in", body: "عايزة الغي", at: "2026-11-22T12:00:00Z" }, { dir: "in", type: "reaction", body: "x" }, { dir: "out", body: "y" }], Date.parse(NOW))] : null,
    phrases: PHRASES.map((p) => [feeCancelAsked(p), escReply(p), tidyReply(p), normKey(p), normAr(p), deliveryWish(p), orphanPromise(p), stockOutNote(p)]),
    status: ctx.orders.map((o) => statusText(o, NOW)),
    pre: ["text", "voice", "image", "button", "video"].map((t) => [preRule(t, ""), preRule(t, "x"), preRule(t, "", "y")]),
    parse: [parseDraft('{"behavior":"escalate","intent":"x","reply":"r","card":"مطبخ","note":"n","fee":"paid"}', ctx.cards),
      parseMediaText('{"text":"عايزة الغي","unclear":false}'), parseMediaText('{"text":"","unclear":true}'), mergeEscNote("a", "b")],
    eval: evalData,
  };
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
/** sha256 لنص الملف اللي بيتنفّذ نفسه (url = import.meta.url) — في الباندل المنشور ده بصمة بالبايت للنسخ كله (tools/self-check.mjs --bundle).
 *  الـruntime مابيسمحش بقراية المصدر = بيرجع السبب نص (مش خطأ) والأجزاء فوق بتفضل هي الدليل. */
export async function selfSource(url: string): Promise<string> {
  try {
    // deno-lint-ignore no-explicit-any
    const D = (globalThis as any).Deno;
    return await sha(await D.readTextFile(new URL(url)));
  } catch (e) {
    return "error: " + String((e as Error)?.message || e).slice(0, 160);
  }
}
/** { جزء: أول 16 حرف من sha256(JSON) } + all = بصمة الكل. */
export async function selfCheck(evalData: unknown): Promise<Record<string, string>> {
  const parts = selfCheckParts(evalData);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parts)) out[k] = await sha(JSON.stringify(v));
  out.all = await sha(JSON.stringify(out));
  return out;
}
