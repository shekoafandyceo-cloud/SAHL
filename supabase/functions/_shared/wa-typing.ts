// «بيكتب...» على واتساب للعميل (24 نوفمبر — طلب المالك «مينفعش نظهره انه يبان Typing لما يكون بيكتب؟»).
// صفحة ميتا (typing-indicators): نداء على /messages بـ status = read + typing_indicator — يعني «اتقرت» (العلامتين الزرق)
// و«بيكتب...» مع بعض، ومفيش واحد من غير التاني. بيختفي مع أول رد مننا أو بعد 25 ثانية — وميتا بتقول «اعرضه بس لو هترد».
// منطق نقي من غير import — wa-ai-draft بينادي typingWanted وبيبعت typingBody، وtools/test-ai-typing.mjs بيختبرهم من Node.

/** النسخة من مثال صفحة ميتا نفسها (v27.0) — نداء لوحده، ومالوش علاقة بـGRAPH (v18.0) بتاع الإرسال في wa-ai-draft */
export const TYPING_GRAPH = "https://graph.facebook.com/v27.0";
/** المهلة — الرد بيستنى النداء ده قبل أول رسالة (عشان «بيكتب...» مايوصلش بعد الرد)، فلازم تبقى قصيرة */
export const TYPING_TIMEOUT_MS = 4000;

/**
 * إمتى نعرضه: البوت هيرد فعلاً (الزرار ON = mode "auto" · مش dry_run ولا التقييم · مش واصل لسقف الردود — capped)
 * و(الميزة شغّالة للكل — ai_settings.facts.typing_indicator = "on" — أو وقت 🧪 ON DEVELOP والرقم من أرقام التجربة).
 * devWaIds = null لما ON DEVELOP مقفول. أي حاجة تانية = لأ (الافتراضي نايم).
 */
export function typingWanted(o: { dry: boolean; mode: string; flag: unknown; devWaIds: string[] | null; waId: string | null; capped: boolean }): boolean {
  if (o.dry || o.mode !== "auto" || o.capped) return false;
  if (o.flag === "on") return true;
  return !!(o.devWaIds && o.waId && o.devWaIds.includes(o.waId));
}

/** جسم النداء — messageId = wa_message_id بتاع الرسالة الواردة (wamid.…) */
export function typingBody(messageId: string): Record<string, unknown> {
  return { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } };
}
