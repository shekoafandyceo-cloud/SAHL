// كاش Gemini الصريح للـAI Agent (explicit caching — 23 نوفمبر، البند 5 من 5: طلب المالك «تصليح الكاش»).
//
// قبله: tokens_cached ≈ صفر (مسودتين من ~700 في 15–23 نوفمبر). الـimplicit caching بتاع Gemini مش مضمون ومحتاج طلبات بنفس البداية
// ورا بعض بسرعة، والطلبات بالليل متفرقة — فكل مسودة كانت بتدفع الـprompt كامل (~9,800 توكن على 23 نوفمبر، وبيكبر).
//
// الشكل (layout «v4» في _shared/ai-draft.ts): التعليمات + بيانات المتجر الثابتة (المعلومات · المنتجات · المخزون · كل الكروت) = turn أول
// بيتخزن عند Gemini مرة (cachedContents)، وكل مسودة بتبعت الجزء المتغيّر بس (أسعار الموقع · المحادثة · الأوردرات · الرسايل)
// وبتدفع الثابت بـ10% من سعره (gemini-3.8-flash: 0.075$ بدل 0.75$ للمليون لحد 31 ديسمبر — وبعدها الضعف للاتنين) + تخزين بالساعة
// (0.50$ للمليون توكن في الساعة — وبعدها 1.00$).
// 🔴 الموديل بيشوف نفس الدخل بالظبط بالكاش ومن غيره (توثيق Gemini: الكاش prefix للطلب) — الكاش بيغيّر الفاتورة بس.
// 🔴 من غير أي import — بيشتغل في Deno (الـEF) و Node (الهارنس) بنفس الملف.

export const CACHE_TTL_S = 1800;                 // عمر الكاش 30 دقيقة — وبيتمد مع الاستخدام (التخزين بيتحاسب بالعمر)
export const CACHE_EXTEND_BELOW_MS = 15 * 60000; // فاضل أقل من 15 دقيقة = يتمد 30 دقيقة من دلوقتي قبل الطلب
export const CACHE_MIN_LEFT_MS = 2 * 60000;      // فاضل أقل من دقيقتين = مايتستخدمش (ممكن يخلص والطلب في السكة) — نفس الحد في ai_prompt_cache_claim
export const CACHE_MIN_TOKENS = 4096;            // أقل حجم للكاش على gemini-3.8-flash (توثيق Gemini) — أقل = الإنشاء بيترفض والمسودة بتمشي من غير كاش

const NAME_RE = /^cachedContents\/[A-Za-z0-9_-]{1,200}$/;

/** مفتاح الكاش = sha256 للموديل + التعليمات + الجزء الثابت: أي تغيير في أي حاجة منهم (كارت اتعدّل · منتج · سعر) = كاش جديد لوحده. */
export async function cacheKey(model: string, system: string, staticUser: string): Promise<string> {
  const buf = new TextEncoder().encode(String(model) + "\u0000" + String(system) + "\u0000" + String(staticUser));
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** جسم إنشاء الكاش: التعليمات + الجزء الثابت كـturn من العميل — نفس اللي في الطلب من غير كاش بالظبط. */
export function cacheCreateBody(model: string, system: string, staticUser: string, label: string, ttlS = CACHE_TTL_S): Record<string, unknown> {
  return {
    model: "models/" + model,
    displayName: String(label || "").slice(0, 120),
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: staticUser }] }],
    ttl: Math.max(60, Math.round(ttlS)) + "s",
  };
}

export interface CacheMeta { name: string; expireAt: string; tokens: number | null }
/** رد Gemini بعد الإنشاء أو المد: الاسم لازم cachedContents/… والوقت مفهوم — غير كده null (مانستخدمش اسم مش مفهوم). */
export function parseCacheMeta(data: unknown): CacheMeta | null {
  // deno-lint-ignore no-explicit-any
  const d = (data && typeof data === "object" ? data : {}) as Record<string, any>;
  const name = String(d.name || "");
  const exp = Date.parse(String(d.expireTime || ""));
  if (!NAME_RE.test(name) || !isFinite(exp)) return null;
  const t = Number(d.usageMetadata?.totalTokenCount);
  return { name, expireAt: new Date(exp).toISOString(), tokens: isFinite(t) && t > 0 ? Math.round(t) : null };
}

/**
 * رد ai_prompt_cache_claim → هنعمل إيه:
 *  use = الكاش موجود وفاضل فيه كتير · extend = موجود وفاضل أقل من 15 دقيقة (نمده قبل الطلب) ·
 *  create = المسودة دي اللي هتعمله (الحجز ذري في الداتابيز — واحدة بس في المرة) ·
 *  skip = حد تاني بيعمله دلوقتي أو الإنشاء/الاستخدام وقع من شوية (المسودة دي من غير كاش).
 */
export type CachePlan = { action: "use" | "extend"; name: string } | { action: "create" } | { action: "skip"; why: string };
export function cachePlan(claim: unknown, nowMs: number): CachePlan {
  const c = (claim && typeof claim === "object" ? claim : {}) as Record<string, unknown>;
  const st = String(c.state || "");
  if (st === "create") return { action: "create" };
  if (st === "ready") {
    const name = String(c.name || "");
    const exp = Date.parse(String(c.expire_at || ""));
    if (!NAME_RE.test(name) || !isFinite(exp) || exp - nowMs < CACHE_MIN_LEFT_MS) return { action: "skip", why: "bad_ready" };
    return { action: exp - nowMs < CACHE_EXTEND_BELOW_MS ? "extend" : "use", name };
  }
  return { action: "skip", why: st || "no_claim" };
}

/**
 * جسم طلب generateContent: بالكاش = اسم الكاش + الأجزاء المتغيّرة بس (التعليمات جوّه الكاش — Gemini بيرفض system_instruction مع cachedContent)
 * · من غير كاش = التعليمات + كل الأجزاء (كل جزء turn من العميل). جزء واحد من غير كاش = نفس شكل الطلب القديم بالظبط.
 */
export function generateBody(system: string, users: string[], generationConfig: Record<string, unknown>, cacheName?: string | null): Record<string, unknown> {
  const contents = users.map((t) => ({ role: "user", parts: [{ text: t }] }));
  return cacheName
    ? { cachedContent: cacheName, contents, generationConfig }
    : { system_instruction: { parts: [{ text: system }] }, contents, generationConfig };
}

/**
 * طلب بالكاش رجع 4xx (مش 429): الكاش مات أو اترفض — Gemini بيرد 403/404 «CachedContent not found (or permission denied)» —
 * فنعيد الطلب من غير كاش. 🔴 من غير الرجوع ده 403 بتاع كاش مات كان هيتحسب «المفتاح اترفض» (modelDown) والزرار يقفل لوحده.
 */
export function cacheRetryable(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}
