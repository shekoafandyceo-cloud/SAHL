// ai-fee — رسوم إلغاء الأوردر اللي مع شركة الشحن (23 نوفمبر — طلب المالك: «لو في حد حب يلغي طلب و هو مع شركة الشحن يقوله انه كلفنا شحن
// و انه المفروض يحول 50% من ثمن الشحن … و يطلب منه يحول 50 جنيه فودافون كاش و انستا باي و يطلب اسكرين و يفضل يستفسر كل شوية حول ولا لا»).
// منطق نقي من غير أي import ولا شبكة: بيشتغل في Deno (wa-ai-draft) وفي Node (tools/test-ai-fee.mjs) بنفس الملف بالحرف.
//
// 🔴 الثوابت:
//   • الإعداد في ai_settings.facts.cancel_fee ({ amount, pay_to, pay_name, methods, followups }) — مش موجود أو ناقص = الميزة مقفولة،
//     والتعليمات والـschema بتاعة الموديل نفس البايتات القديمة (ai-draft.ts بياخد fee: true بس لما الإعداد سليم).
//   • «مع شركة الشحن» = J&T استلمت الأوردر من عندنا (حالة بعد الاستلام، أو حالة قبله ومعاها مسح من J&T). قبل الاستلام = الإلغاء من غير رسوم.
//   • البوت مابيلغيش الأوردر: بيطلب الرسوم وسكرين التحويل ويصعّد، والموظف يتأكد إن الفلوس وصلت ويلغي.
//   • الطلب بيتسجّل (wa_ai_fee_requests) بس لما رد البوت اللي **اتبعت فعلاً** فيه رقم التحويل، ولأوردر عليه علامة «مع شركة الشحن».
//   • التذكير: نص ثابت (من غير موديل) · جوّه نافذة الـ24 ساعة بتاعة واتساب بس · من 10 الصبح لـ 10 بالليل بتوقيت القاهرة · بحد 3 ·
//     بيقف أول ما العميل يبعت صورة (السكرين) أو يقول إنه حوّل أو يرفض أو يقرر يستلم، أو موظف يكتب في الشات، أو التصعيد يتقفل، أو الأوردر يتسلّم أو يتلغي أو يرجع.
//   • 🔴 التذكير بيتبعت بس لو العميل **ماردش** من آخر مرة البوت سأله (asked_at): أي رد منه ماحدش اتعامل معاه (البوت مقفول بالنهار، أو الموديل
//     مافهمش إنه بيقول هيحوّل) = التذكير بيقف والموظف هو اللي يكمّل — تذكير ثابت لعميل قال «مش هدفع» أسوأ من مفيش تذكير.
//     البوت لو سأل تاني (العميل قال هيحوّل · سأل على الرقم) = again: asked_at بيتحرّك والتذكير بيكمّل من بعده.
//   • 🔴 حارس (feeReplyBlocked — حالة التقييم 87: «ابعت رقم التحويل» على أوردر في السكة = الموديل طلب رسوم إلغاء من عميل عايز يدفع تمن الأوردر):
//     رد فيه رقم التحويل ومفيش طلب مفتوح بيتبعت بس لو للعميل أوردر «مع شركة الشحن» وهو نفسه طلب يلغي أو قال إنه مش هيستلم (feeCancelAsked على كلامه
//     في آخر 48 ساعة). غير كده الرد مابيتبعتش والمحادثة بتتصعّد بسطر للموظف — الرقم مش موجود في أي معلومة تانية للبوت (اتقاس 23 نوفمبر).
//     اتعاير على كلام عملاء حقيقيين (60 يوم — المحادثات اللي الموظفين بعتوا فيها الرقم): الإلغاء بيتكتب بـ«الغي/إلغاء/لغيت/كنسل/مش عاوزه/مش هستلمه»،
//     وطلب الرقم عشان يدفع تمن الأوردر قبل الاستلام («ابعت رقم التحويل» · «ايه الرقم اللي هحول عليه») مافيهوش ولا واحدة منهم.

export interface FeeCfg { amount: number; payTo: string; payName: string; methods: string; followups: boolean }
export type FeeEvent = "request" | "again" | "paid" | "refused" | "keep";
export const FEE_EVENTS: FeeEvent[] = ["request", "again", "paid", "refused", "keep"];

export const FEE_MAX_REMINDERS = 3;
export const FEE_FIRST_GAP_MS = 3 * 3600000;      // أول تذكير بعد 3 ساعات من آخر مرة البوت سأل (asked_at)
export const FEE_NEXT_GAP_MS = 4 * 3600000;       // وبعدها كل 4 ساعات من آخر تذكير
export const FEE_WINDOW_MS = 24 * 3600000;        // نافذة واتساب: بعد 24 ساعة من آخر رسالة من العميل مفيش رسالة عادية
export const FEE_WINDOW_MARGIN_MS = 30 * 60000;   // آخر تذكير قبل ما النافذة تقفل بنص ساعة على الأقل
export const FEE_HOUR_FROM = 10, FEE_HOUR_TO = 22; // التذكير من 10 الصبح لحد قبل 10 بالليل (القاهرة)
export const FEE_OPEN_DAYS = 7;                    // طلب مفتوح أقدم من كده مابيتلمسش (صورة بعد أسبوع مش سكرين الرسوم)
export const FEE_ASK_WINDOW_MS = 48 * 3600000;     // كلام العميل اللي بيتدوّر فيه على طلب الإلغاء (feeAskText) — الإلغاء بالليل والسبب الصبح بيبقوا مع بعض

// حالات بعد ما J&T استلمت الأوردر من عندنا (نفس أسماء STATUS_AR في ai-draft.ts)
export const FEE_CARRIER_STATUSES = ["Picking up from consignee", "Received at warehouse", "In transit between Hubs", "Route Assigned", "Out for delivery", "Exception"];
// حالات قبل الاستلام — بتتحسب «مع شركة الشحن» بس لو J&T مسحت الأوردر فعلاً (carrier_status_at — مسح مالوش حالة زي Holding)
export const FEE_PREPICKUP_STATUSES = ["BOSTA AUTO", "BOSTA2", "bosta2", "bosta_assigned"];

const latin = (s: string) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));

/** الإعداد من facts.cancel_fee. null = الميزة مقفولة (مش موجود · المبلغ مش رقم موجب لحد 1000 · الرقم مش موبايل مصري). */
export function feeConfigOf(facts: Record<string, unknown> | null | undefined): FeeCfg | null {
  const raw = facts ? facts.cancel_fee : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const amount = Number(r.amount);
  const payTo = latin(String(r.pay_to ?? "")).replace(/\D/g, "");
  if (!isFinite(amount) || amount <= 0 || amount > 1000 || !/^01[0-9]{9}$/.test(payTo)) return null;
  const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  return { amount: Math.round(amount), payTo, payName: clean(r.pay_name, 60), methods: clean(r.methods, 60) || "إنستا باي أو محفظة", followups: r.followups !== false };
}

/** الأوردر مع شركة الشحن (J&T استلمته من عندنا) = إلغاؤه برسوم. */
export function feeTagOf(o: { status: string; carrier?: string | null; carrierStatusAt?: string | null }): boolean {
  const s = String(o.status || "");
  if (FEE_CARRIER_STATUSES.includes(s)) return true;
  return FEE_PREPICKUP_STATUSES.includes(s) && String(o.carrier || "") === "jt" && !!o.carrierStatusAt;
}

/** سطر «معلومات المتجر» اللي الموديل بياخد منه المبلغ والرقم (القاعدة 22(ل) في ai-draft.ts بتشاور عليه بالاسم). */
export function feeFactLine(cfg: FeeCfg): string {
  return "- رسوم الإلغاء بعد الشحن (أوردر مكتوب جنب حالته «مع شركة الشحن» بس — القاعدة 22(ل)): " + cfg.amount + " جنيه، نص تكلفة الشحن وإحنا بنتحمل النص التاني. التحويل "
    + cfg.methods + " على " + cfg.payTo + (cfg.payName ? " باسم " + cfg.payName : "") + "، والعميل يبعت سكرين شوت التحويل.";
}

/** رد البوت فيه رقم التحويل (بأي شكل أرقام · بمسافات أو من غير) = البوت طلب الرسوم. */
export function replyAsksFee(reply: unknown, cfg: FeeCfg | null): boolean {
  if (!cfg) return false;
  return latin(String(reply || "")).replace(/\D/g, "").includes(cfg.payTo);
}

/** تطبيع للمطابقة بس: أرقام · lowercase · تشكيل وتطويل · أ/إ/آ/ٱ = ا · ى = ي · ة = ه · ئ = ي · ؤ = و. */
function feeNorm(s: string): string {
  return latin(String(s || "")).toLowerCase().replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ئ/g, "ي").replace(/ؤ/g, "و");
}
// كلمة من جذر «لغى» (بعد التطبيع): الغي · نلغيه · هيتلغي · لغيت · لغت · ملغي · الغوه · الغيهولي … — والمصدر: إلغاء · الإلغاء · للإلغاء · بالإلغاء · إلغائه.
// 🔴 الكلمة كلها لازم تطابق (^…$) والنهاية من قايمة مقفولة: «المبلغ» · «الغالي» · «الغرفة» · «لغة» · «بلّغي» · «متلغبطة» مايطابقوش،
//    والنفي («متلغيش» · «متلغوش» · «ملغتش» = ماتلغيش/ماألغيتش) مايتحسبش طلب إلغاء.
const FEE_CANCEL_WORD = new RegExp("^(?:و|ف)?(?:"
  + "(?:ا|ي|ت|ن|م|ه|ح|هي|حي|هت|حت|هن|حن|ات|يت|تت|مت|هيت|حيت|هتت|اتت)?لغ"
  + "(?:ي|يت|يته|يتها|يتو|يتوا|يتي|ت|تي|تو|توا|ينا|يناه|يناها|يه|يها|يهم|يهولي|يهالي|يلي|يهلي|يلنا|يهلنا|و|وا|وه|وها|وهم|وهولي|ولي|وهلي|ولنا|اه|اها|ين|يين)"
  + "|(?:ب|ل|لل|بال|ال)?الغا(?:ء|ءه|ءها|يه|يها|ه|ها)?"
  + ")$");
// عبارات تانية على النص كله (بعد التطبيع). «مش عايز/محتاج/مستعد» محسوبة بس لو بعدها آخر الكلام أو الأوردر أو الشرا/الاستلام أو «خلاص/دلوقتي/حاليا…»:
// «مش عايز ادفع كاش، ابعت رقم التحويل» = بيدفع تمن الأوردر مش بيلغي. و«مش ه…» للاستلام والشرا بس («مش ههرب» · «مش هدفع» مش إلغاء).
const FEE_CANCEL_TEXT: RegExp[] = [
  /كا?نسل|cancel/u,
  /(?:^|[^\p{L}])(?:و|ف)?مش\s*(?:عايز|عاوز|محتاج|حاب|حابب|مستعد)\p{L}*(?=[ \t]*(?:$|[^\p{L}\s]|[\n\r]|(?:ال)?(?:اوردر|اورد|ارد|طلب|منتج|حاج|شحن)|ا?(?:شتري|ستلم)|اخد|خلاص|دلوقت|حالي|تاني|اصلا|خالص|بق[يا]|نهائي|منكم|منكو|شكر|بجد))/u,
  /(?:^|[^\p{L}])(?:و|ف)?مش\s*(?:ه|ح|ها|حا)\s?(?:ا?ستلم|اخد|خد|ا?شتري|كمل|قبل|قدر\s*(?:ا?ستلم|اخد)|ينفع\s*ا?ستلم)/u,
  /(?:^|[^\p{L}])(?:و|ف)?لن\s*(?:ا?ستلم|اقبل)/u,
  /(?:^|[^\p{L}])(?:و|ف)?(?:معدتش|ماعدتش|معتش|مبقتش|مابقتش|مبقيتش|مابقيتش)\s*(?:عايز|عاوز|محتاج)/u,
  /غيرت\s*رايي/u,
  /(?:^|[^\p{L}])(?:و|ف)?(?:ه|ح|ا|ها|ن|هن)?رفض(?:ه|ها|و|وه)?(?=[^\p{L}]|$)|(?:^|[^\p{L}])(?:و|ف)?(?:رافض|رفضت)/u,
  /ستغني|استغنيت/u,
  /(?:^|[^\p{L}])(?:و|ف)?(?:ي|ا|ت|ه)?رجع(?:و|ي)?(?:ه|ها|وه|يه)(?=[^\p{L}]|$)|(?:^|[^\p{L}])(?:و|ف)?رجع(?:و|وا|ي)?\s+(?:ال)?(?:اوردر|طلب|شحنه)/u,
];

/** العميل طلب يلغي الأوردر أو قال إنه مش هيستلمه/مش عايزه (في الكلام ده) — للحارس feeReplyBlocked بس. */
export function feeCancelAsked(text: unknown): boolean {
  const t = feeNorm(String(text || ""));
  if (!t.trim()) return false;
  if (t.split(/[^\p{L}]+/u).some((w) => !!w && FEE_CANCEL_WORD.test(w))) return true;
  return FEE_CANCEL_TEXT.some((re) => re.test(t));
}

/** كلام العميل اللي بيتدوّر فيه على طلب الإلغاء: رسايله (والفويس/الصورة اللي اتفهمت) في آخر 48 ساعة — من غير التفاعلات (جسمها JSON).
 *  رسالة من غير وقت (حالات التقييم القديمة) بتتحسب. */
export function feeAskText(msgs: { dir: string; type?: string | null; body?: string | null; media?: string | null; at?: string | null }[], nowMs: number): string {
  const from = nowMs - FEE_ASK_WINDOW_MS;
  return (msgs || []).filter((m) => !!m && m.dir === "in" && m.type !== "reaction" && !(Date.parse(String(m.at || "")) < from))
    .map((m) => [m.body, m.media].map((x) => String(x || "").trim()).filter(Boolean).join(" ")).filter(Boolean).join("\n");
}

export type FeeBlock = "not_shipped" | "no_cancel";
/** 🔴 الحارس: رد فيه رقم التحويل ومفيش طلب رسوم مفتوح (open) بيتبعت بس لو للعميل أوردر «مع شركة الشحن» (tagged) وطلب بنفسه يلغي
 *  (asked = feeAskText). null = يتبعت عادي · "not_shipped" / "no_cancel" = الرد مايتبعتش والمحادثة بتتصعّد (feeBlockNote). */
export function feeReplyBlocked(i: { cfg: FeeCfg | null; reply: unknown; open: boolean; tagged: boolean; asked: string }): FeeBlock | null {
  if (!i.cfg || i.open || !replyAsksFee(i.reply, i.cfg)) return null;
  if (!i.tagged) return "not_shipped";
  return feeCancelAsked(i.asked) ? null : "no_cancel";
}
/** سطر للموظف في «🚩 تصعيد» لما الحارس يمنع الرد. */
export function feeBlockNote(cfg: FeeCfg, why: FeeBlock): string {
  return "⚠️ البوت كان هيطلب من العميل " + cfg.amount + " جنيه رسوم إلغاء ورقم التحويل"
    + (why === "not_shipped" ? " ومفيش أوردر للعميل مع شركة الشحن" : " والعميل ماطلبش يلغي") + " — الرد ماتبعتش، شوف العميل عايز إيه";
}

/** إيه اللي حصل في الرسوم من رسالة العميل دي ورد البوت عليها. null = مفيش تغيير.
 *  open = فيه طلب رسوم مفتوح في المحادثة · tagged = للعميل أوردر «مع شركة الشحن» · image = رسالة العميل صورة ·
 *  sent = رد البوت اتبعت فعلاً · fee = اللي الموديل كتبه في الحقل fee (request/paid/refused/keep).
 *  again = الطلب مفتوح والبوت سأل تاني (العميل قال هيحوّل أو سأل على الرقم) — التذكير بيتعد من الرد ده. */
export function feeEventOf(i: { cfg: FeeCfg | null; open: boolean; tagged: boolean; image: boolean; sent: boolean; fee: string | null | undefined; reply: string }): FeeEvent | null {
  if (!i.cfg) return null;
  if (i.open && i.image) return "paid"; // صورة بعد طلب الرسوم = غالباً السكرين — الموظف هو اللي بيتأكد إن الفلوس وصلت
  if (i.open && (i.fee === "paid" || i.fee === "refused" || i.fee === "keep")) return i.fee;
  if (i.open && i.sent && (i.fee === "request" || replyAsksFee(i.reply, i.cfg))) return "again";
  if (!i.open && i.tagged && i.sent && replyAsksFee(i.reply, i.cfg)) return "request";
  return null;
}

/** سطر للموظف في «🚩 تصعيد» — null للـagain (الطلب متسجّل خلاص · مفيش جديد للموظف). image = الدفع اتعرف من صورة مش من كلام. */
export function feeNote(ev: FeeEvent, cfg: FeeCfg, uid: string | null, image = false): string | null {
  const o = uid ? " (أوردر #" + uid + ")" : "";
  if (ev === "request") return "💸 اتطلب من العميل " + cfg.amount + " جنيه رسوم إلغاء" + o + " — مستني سكرين التحويل على " + cfg.payTo + "، وبعدها الغي الأوردر مع J&T";
  if (ev === "again") return null;
  if (ev === "paid")
    return (image ? "📸 العميل بعت صورة بعد طلب الرسوم (غالباً سكرين التحويل)" : "💬 العميل قال إنه حوّل رسوم الإلغاء")
      + o + " — اتأكد إن الـ" + cfg.amount + " جنيه وصلت على " + cfg.payTo + " وبعدها الغي الأوردر مع J&T";
  if (ev === "refused") return "🚫 العميل رفض يدفع رسوم الإلغاء" + o + " — القرار ليك";
  return "✅ العميل رجع في الإلغاء وقال هيستلم" + o + " — ماتلغيش الأوردر";
}

/** الساعة في القاهرة (0–23) — بالصيفي. */
export function cairoHourOf(ms: number): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return Number(h) % 24;
}

/** التذكير الجاي جه وقته؟ quiet = مفيش تذكيرات تاني للطلب ده (الحد · النافذة قفلت أو هتقفل · العميل رد ومحدش اتعامل مع رده).
 *  askedAt = آخر مرة البوت سأل (الطلب · السؤال التاني · آخر تذكير) والوقت بيتعد منها. */
export function feeReminderDue(i: { nowMs: number; askedAt: string; lastInboundAt: string | null; reminders: number; cairoHour: number }): { due: boolean; quiet: boolean; why: string } {
  if (i.reminders >= FEE_MAX_REMINDERS) return { due: false, quiet: true, why: "max" };
  const lastIn = i.lastInboundAt ? Date.parse(i.lastInboundAt) : NaN;
  if (!isFinite(lastIn) || i.nowMs >= lastIn + FEE_WINDOW_MS - FEE_WINDOW_MARGIN_MS) return { due: false, quiet: true, why: "window" };
  const asked = Date.parse(i.askedAt);
  if (!isFinite(asked)) return { due: false, quiet: true, why: "bad_row" };
  if (lastIn > asked) return { due: false, quiet: true, why: "customer_replied" };
  if (i.cairoHour < FEE_HOUR_FROM || i.cairoHour >= FEE_HOUR_TO) return { due: false, quiet: false, why: "hours" };
  const gap = i.reminders === 0 ? FEE_FIRST_GAP_MS : FEE_NEXT_GAP_MS;
  if (i.nowMs - asked < gap) return { due: false, quiet: false, why: "gap" };
  return { due: true, quiet: false, why: "due" };
}

/** نص التذكير (n = كام تذكير اتبعت قبل كده) — بنفس كلام الموظفين في الشات (حوّلت ولا لسه · الرقم · السكرين). */
export function feeReminderText(cfg: FeeCfg, n: number): string {
  if (n <= 0)
    return "أهلاً يا فندم، حضرتك حوّلت الـ" + cfg.amount + " جنيه ولا لسه؟ التحويل " + cfg.methods + " على " + cfg.payTo + (cfg.payName ? " باسم " + cfg.payName : "")
      + "، وابعتلنا سكرين التحويل أول ما تحوّل.";
  if (n === 1) return "يا فندم لسه مستنيين سكرين تحويل الـ" + cfg.amount + " جنيه على " + cfg.payTo + " (" + cfg.methods + ").";
  return "يا فندم بنفكّر حضرتك بتحويل الـ" + cfg.amount + " جنيه على " + cfg.payTo + " وسكرين التحويل، وزميلي المختص هيتابع مع حضرتك في مواعيد العمل.";
}
