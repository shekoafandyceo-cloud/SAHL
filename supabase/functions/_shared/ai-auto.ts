// ai-auto — قرار «البوت يبعت إيه» لما الزرار ON (16 نوفمبر — طلب المالك: البوت يستلم مكان الموظفين بعد ما يمشوا).
// منطق نقي من غير أي import ولا شبكة: بيشتغل في Deno (wa-ai-draft) وفي Node (tools/test-ai-auto.mjs) بنفس الملف بالحرف.
//
// 🔴 الثوابت:
//   • الدالة دي بتقرر بس — الإرسال نفسه في wa-ai-draft/index.ts، ومابيحصلش غير و ai_settings.mode = 'auto'.
//   • التصعيد = رسالة اعتذار **واحدة** في المحادثة (لحد ما موظف يرد) + المحادثة تدخل «تصعيد». نص الرسالة ثابت من الإعدادات
//     (hold_message) مش من الموديل: رد الموديل في escalate بيقول «زميل هيتابع حالاً» وده مش صح والموظفين مش موجودين.
//   • «طلب شراء» (collect) — 17 نوفمبر، طلب المالك «هو اللي يعمل الأوردر بنفسه … ميصعدش»: البوت بيجمّع البيانات من غير تصعيد، ولما تكمل
//     القرار في ai-order.ts (order): اتسجّل = رسالة التأكيد الثابتة بس · ناقص/مش واضح = سؤال للعميل · مايتسجّلش تلقائي (منتج مش مدعوم ·
//     عميل ليه أوردر مرتجع أو مفتوح · السيرفر رفض) = «بياناتك اتسجلت وزميل هيأكد» + «🛒 طلب شراء» في التصعيد بالسبب.
//   • سقف لكل محادثة ولكل يوم: بعده البوت بيسكت خالص (حتى رسالة الاعتذار) ويصعّد — حماية من حلقة رد آلي قصاد رد آلي.
//   • الكارت = صور الرد المحفوظ والكلام caption على آخر صورة (نفس اللي الموظف بيبعته — درس 46)، وبعده سطر الرد لو فيه.

export const BOT_NAME = "🤖 AI Agent";
export const AUTO_MAX_TURNS_PER_CONV = 10;            // ردود البوت في المحادثة الواحدة خلال النافذة
export const AUTO_TURNS_WINDOW_MS = 12 * 3600 * 1000;
export const AUTO_MAX_TURNS_PER_DAY = 400;            // لكل المتجر في 24 ساعة
export const AUTO_MAX_CARD_REPEAT = 2;                // نفس الكارت لنفس المحادثة خلال النافذة
export const AUTO_MAX_IMAGES = 5;
export const CAPTION_MAX = 1024;                      // حد ميتا للـcaption
export const HOLD_DEFAULT = "معلش يا فندم، أنا المساعد الآلي للمتجر والنقطة دي محتاجة زميل يرد على حضرتك فيها. هيتواصلوا مع حضرتك في أقرب وقت 🙏";

export interface AutoDraft { behavior: string; intent: string; reply: string; card: string; note: string }
/** نتيجة خطوة الأوردر (ai-order.ts + create_bot_order) — النص ثابت من السيستم مش من الموديل. */
export type OrderOutcome =
  | { state: "created"; text: string }                  // الأوردر اتسجّل (أو «كان هيتسجّل» في المعاينة) — text = رسالة التأكيد
  | { state: "ask"; text: string }                      // بيانات ناقصة/مش واضحة — سؤال للعميل
  | { state: "handoff"; text: string; note: string };   // مايتسجّلش تلقائي — زميل يراجع
export interface AutoCard { title: string; body: string; images: string[] }
export interface AutoIn {
  draft: AutoDraft | null;
  fromModel: boolean;          // false = قرار ثابت من غير موديل (preRule: صورة من غير نص · صوت…)
  error: string | null;        // خطأ الموديل لو draft = null
  card: AutoCard | null;       // الكارت اللي الموديل اقترحه (بصوره) — null لو مفيش
  cardRepeat: number;          // كام مرة البوت بعت نفس الكارت في المحادثة دي خلال النافذة
  holdSent: boolean;           // رسالة الاعتذار اتبعتت خلاص في التصعيد الحالي
  turnsInConv: number;         // ردود البوت في المحادثة خلال النافذة
  turnsToday: number;          // ردود البوت للمتجر كله في 24 ساعة
  holdMessage: string | null;  // من ai_settings.facts.hold_message
  order?: OrderOutcome | null; // collect والبيانات كملت — غير كده null
}
export type AutoAction =
  | { kind: "text"; body: string; tag: "reply" | "hold" | "card_text" | "order" }
  | { kind: "image"; path: string; caption: string | null };
export interface AutoPlan { actions: AutoAction[]; escalate: string | null; reason: string }

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** خطأ معناه إن الموديل مش هيرد على أي رسالة لحد ما المالك يتصرف (رصيد · مفتاح · صلاحية) — مش عطل مؤقت. */
export function modelDown(error: string | null | undefined): boolean {
  return /^(no_gemini_key|gemini_(401|402|403)\b)/.test(String(error || ""));
}

export function isSendableImage(path: unknown): boolean {
  return typeof path === "string" && /\.(jpe?g|png)$/i.test(path) && !path.includes("..");
}

/** صور الكارت والكلام caption على الأخيرة · كلام أطول من حد ميتا = رسالة لوحدها بعد الصور · من غير صور = الكلام بس. */
export function cardActions(card: AutoCard): AutoAction[] {
  const imgs = (card.images || []).filter(isSendableImage).slice(0, AUTO_MAX_IMAGES);
  const body = String(card.body || "").trim();
  if (!imgs.length) return body ? [{ kind: "text", body, tag: "card_text" }] : [];
  const inCaption = !!body && body.length <= CAPTION_MAX;
  const out: AutoAction[] = imgs.map((path, i) => ({ kind: "image", path, caption: inCaption && i === imgs.length - 1 ? body : null }));
  if (body && !inCaption) out.push({ kind: "text", body, tag: "card_text" });
  return out;
}

export function autoPlan(i: AutoIn): AutoPlan {
  const holdText = String(i.holdMessage || "").trim() || HOLD_DEFAULT;
  const hold = (): AutoAction[] => (i.holdSent ? [] : [{ kind: "text", body: holdText, tag: "hold" }]);
  const d = i.draft;

  if (d && d.behavior === "skip") return { actions: [], escalate: null, reason: "skip" };
  // السقوف قبل أي حاجة تانية: بعدها البوت بيسكت خالص
  if (i.turnsToday >= AUTO_MAX_TURNS_PER_DAY)
    return { actions: [], escalate: "البوت وصل للحد اليومي للردود ووقف — المحادثة دي محتاجة موظف", reason: "day_cap" };
  if (i.turnsInConv >= AUTO_MAX_TURNS_PER_CONV)
    return { actions: [], escalate: "البوت رد " + i.turnsInConv + " مرات في المحادثة دي ووقف — كمّل إنت مع العميل", reason: "conv_cap" };

  // الموديل نفسه واقف (رصيد Gemini خلص · المفتاح اترفض): مفيش رسالة اعتذار لكل عميل — تصعيد ساكت، وwa-ai-draft بيرجّع الزرار OFF
  if (!d && modelDown(i.error))
    return { actions: [], escalate: "المساعد واقف — رصيد أو مفتاح Gemini (" + cut(String(i.error), 60) + ") — المحادثة دي محتاجة موظف", reason: "model_down" };
  if (!d) return { actions: hold(), escalate: "المساعد معرفش يكتب رد" + (i.error ? " (" + cut(String(i.error), 80) + ")" : ""), reason: "no_draft" };
  if (d.behavior === "escalate")
    return { actions: hold(), escalate: cut(String(d.note || d.intent || "محتاجة موظف").trim(), 400), reason: "escalate" };

  // الأوردر: بيانات كملت → النص الثابت بس (من غير كارت ولا رد الموديل)
  if (d.behavior === "collect" && i.order && String(i.order.text || "").trim()) {
    const o = i.order;
    if (o.state === "handoff")
      return { actions: [{ kind: "text", body: o.text, tag: "reply" }], escalate: cut("🛒 طلب شراء — " + (String(o.note || "").trim() || "راجع البيانات وسجّل الأوردر"), 400), reason: "collect" };
    return { actions: [{ kind: "text", body: o.text, tag: o.state === "created" ? "order" : "reply" }], escalate: null, reason: "collect" };
  }

  const actions: AutoAction[] = [];
  if (i.card && i.cardRepeat < AUTO_MAX_CARD_REPEAT) actions.push(...cardActions(i.card));
  const reply = String(d.reply || "").trim();
  if (reply) actions.push({ kind: "text", body: reply, tag: "reply" });
  if (!actions.length) return { actions: hold(), escalate: "المساعد طلّع رد فاضي — محتاجة موظف", reason: "empty" };

  let escalate: string | null = null;
  const note = String(d.note || "").trim();
  // collect والبيانات لسه ماكملتش = البوت بيكمّل يجمّع من غير تصعيد (قرار المالك 17 نوفمبر)
  if (!i.fromModel && note) escalate = cut(note, 400); // صورة من غير نص: البوت مابيشوفش الصور
  return { actions, escalate, reason: d.behavior };
}

/** ملاحظة التصعيد الجديدة فوق القديمة: من غير تكرار · الأحدث في الآخر · بسقف. */
export function mergeEscNote(prev: string | null | undefined, next: string | null | undefined, max = 560): string | null {
  const a = String(prev || "").trim(), b = String(next || "").trim();
  if (!b) return a || null;
  if (!a || a === b || a.includes(b)) return a || b;
  const joined = a + " · " + b;
  return joined.length <= max ? joined : cut(b, max);
}
