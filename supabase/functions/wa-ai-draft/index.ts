// wa-ai-draft — الـAI Agent بتاع الشات (shadow من 14 نوفمبر · الإرسال التلقائي بزرار ON/OFF من 16 نوفمبر — طلب المالك).
// بيكتب «رد مقترح» لرسالة العميل الواردة ويخزّنه في wa_ai_drafts — والموظف يبعته/يعدّله/يرفضه من الصندوق.
//
// 🔴 الإرسال للعميل (autoRun) بيحصل في حالة واحدة بس: المسار العادي (مش dry_run ولا eval) **و** ai_settings.mode = 'auto'
//    (الزرار ON — الأدمن بيشغّله من الصندوق عبر ai_agent_set_auto). في 'shadow' الدالة مابتبعتش حاجة: الكتابة الوحيدة صف في wa_ai_drafts.
//    حراسات autoRun بالترتيب: الزرار بيتقري تاني قبل الإرسال · حجز ذري للمسودة (auto_sent_at) = مفيش إرسال مرتين ·
//    العميل كتب تاني أو موظف رد = مفيش إرسال · نافذة الـ24 ساعة · سقف لكل محادثة ولكل يوم (_shared/ai-auto.ts) ·
//    الرسالة بتتسجّل في wa_messages باسم BOT_NAME ومن غير sent_by (فمابتشيلش «تصعيد») · فشل الإرسال = تصعيد من غير إعادة ·
//    3 أخطاء إرسال في ربع ساعة = الزرار بيرجع OFF لوحده. القرار نفسه (يبعت إيه) منطق نقي في _shared/ai-auto.ts.
// 🔴 (17 نوفمبر — طلب المالك) الزرار ON بس:
//    • موظف رد في المحادثة من أقل من 30 دقيقة = البوت بيسكت خالص (من غير موديل ولا رسالة) والمحادثة بتتعلّم «تصعيد» عشان ماتتنسيش.
//    • «البوت يسجّل الأوردر بنفسه»: collect والبيانات كملت → القرار في _shared/ai-order.ts (منتج من ai_products · موبايل · محافظة · عنوان واضح ·
//      مفيش أوردر سابق مرتجع/مفتوح) → RPC create_bot_order (service_role بس · بيعيد الحراسات · الزرار لازم ON) → رسالة تأكيد ثابتة برقم الطلب.
//      مايتسجّلش = «بياناتك اتسجلت وزميل هيأكد» + «🛒 طلب شراء» في التصعيد بالسبب. dry_run والتقييم بيرجّعوا القرار بس (order_preview) من غير تسجيل.
//    • «الأوردر الملغي من أقل من يومين يتفعّل تاني»: الموديل بيكتب رقم الأوردر في reactivate لما العميل يقول إنه عايزه → planReactivate
//      (العميل هو اللي لغاه من الواتساب · أقل من 48 ساعة · من غير بوليصة · مالوش أوردر تاني مفتوح/مرتجع) → RPC reactivate_bot_order
//      (service_role بس · بيعيد الحراسات · الزرار لازم ON) → «مؤكد» + رسالة تأكيد ثابتة. لغاه موظف/قديم/السيرفر رفض = زميل يراجع («🔁» في التصعيد).
// 🔴 wa-send و wa-inbox-ingest و trg_wa_after_message_insert مايتلمسوش — الإرسال هنا نداء مباشر لميتا بنفس شكل wa-send.
// 🔴 المفتاح: Secret `GEMINI_API_KEY` (Google AI Studio — Paid tier) — المالك ضافه بإيده، وعمره ما بيتطبع ولا بيرجع في رد.
// 🔴 كل المعلومات اللي الموديل بيرد منها بتتجاب من الداتابيز هنا (قراية بس): ai_settings.facts · ai_products · كروت الردود المحفوظة ·
//    أسعار الموقع (أوردرات آخر 24 ساعة) · أسماء المخزون · أوردرات العميل برقمه · آخر رسايل المحادثة. الموديل مالوش أي tool بيكتب.
//
// الحمولة (3 أشكال):
//   1) { message_id, dry_run? }  — المسار العادي (التريجر trg_wa_ai_draft_enqueue على wa_messages — شغّال من 15 نوفمبر). من غير dry_run: بيرد 202 على طول ويشتغل في
//      الخلفية: mode لازم shadow/auto · بيستنى 12ث (debounce) · رسالة أحدث من العميل = الأحدث هي اللي بترد · موظف رد خلاص = مفيش مسودة.
//      مع dry_run: بيرجّع المسودة في الرد من غير انتظار ومن غير أي كتابة (وبيتجاهل mode) — للتجربة على رسايل حقيقية.
//      مع dry_run: بيقبل كمان layout (v1/v2/v3) لتجربة شكل دخل تاني على رسالة حقيقية، وcard_notes ({اسم الكارت: معلومات}) لتجربة
//      «معلومات للـAgent» على كارت من غير أي كتابة.
//   2) { action: "eval", from, to, model?, gen?, rules_extra?, layout?, card_notes? } — بيشغّل حالات eval-cases.ts بسياق وهمي (صفر كتابة) ويرجّع النتايج.
//      rules_extra = قواعد تجريبية بتتضاف لتعليمات الموديل في التقييم بس (عمرها ما بتوصل المسار العادي).
//      layout = شكل الدخل (v1 الحالي · v2 الثابت الأول · v3 كروت المحادثة بس + فهرس) — من غيره = شكل الحي.
// 🔴 أسلوب التصعيد على الحي = ai_settings.facts.esc_style (الغايب = v1: اعتذار ثابت · v2: الموديل بيسأل الأول ورده بيتبعت — 18 نوفمبر).
//    esc_style من الـbody للتقييم والـdry_run بس.
// 🔴 شكل الدخل على الحي = ai_settings.facts.prompt_layout (الغايب = v1) — مش من الـbody. التحويل والرجوع بسطر إعداد بقرار المالك.
// 🔴 معلومات للـAgent (v6 — 16 نوفمبر): wa_quick_replies.ai_notes بتتحط تحت نص الكارت في الـprompt (cardBlock) — مابتتبعتش للعميل مع الكارت.
//    card_notes من الـbody للتقييم والـdry_run بس — المسار العادي بيقرا العمود وبس.
// 🔴 tokens_cached (16 نوفمبر): cachedContentTokenCount من Gemini بيتسجّل مع كل مسودة — عشان نعرف الـimplicit caching بيتطبّق فعلاً ولا لأ.
//   3) { action: "models" } — أسماء موديلات Gemini المتاحة للمفتاح (بيأكد إن المفتاح شغّال).
// 🔴 dry_run والتقييم بيرجّعوا كمان «لو الزرار ON كان هيبعت إيه» (auto_preview / auto) — قرار بس، من غير أي إرسال.
// التصريح: service_role أو x-diag-token (= platform_settings.jt_diag_token) — مفيش مسار للموظف (نفس wa-ofd-notify).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildSystemPrompt, buildUserPrompt, cardProductLine, effectivePrice, escStyleOf, layoutOf, MEDIA_RULES, parseDraft, phoneForms, preRule, RESPONSE_SCHEMA,
  siteRowsFrom, workHoursOf, type CardLite, type Draft, type DraftCtx, type EscStyle, type HistMsg, type Layout, type OrderLite, type ProductLite, type SiteRow,
} from "../_shared/ai-draft.ts";
import { autoPlan, AUTO_REPEAT_WINDOW_MS, AUTO_TURNS_WINDOW_MS, BOT_NAME, mergeEscNote, type AutoAction, type AutoCard, type AutoPlan, type OrderOutcome, type ReactOutcome } from "../_shared/ai-auto.ts";
import {
  cancelInfo, cancelTag, ORDER_HANDOFF_TEXT, orderConfirmText, orderSummary, orphanPromise, planOrder, planReactivate, REACT_HANDOFF_TEXT, reactivateConfirmText,
  sessionText, type CreateArgs, type OrderProduct, type OrderStep, type PrevOrder, type ReactOrder, type ReactStep,
} from "../_shared/ai-order.ts";
import { forgetMediaId, isQuickReplyPath, quickReplyMediaId, shouldRetryWithLink } from "../_shared/wa-media.ts";
import {
  geminiMime, MEDIA_MAX_BYTES, MEDIA_SCHEMA, mediaPathOk, mediaPrompt, mediaToRead, MEDIA_TYPES, parseMediaText, toBase64, type MediaRow,
} from "../_shared/ai-media.ts";
import { CTX, EVAL_CASES, EVAL_FACTS_EXTRA, EVAL_TENANT, EXPECT } from "./eval-cases.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEBOUNCE_MS = 12000, HISTORY_N = 20, GEMINI_TIMEOUT_MS = 40000, EVAL_MAX = 60, EVAL_POOL = 6, MEDIA_TIMEOUT_MS = 20000;
// أعمدة الرسالة — ومعاها أعمدة الفويس/الصورة (لو الاستعلام بيها وقع = نفس الأعمدة القديمة ومفيش فهم ميديا: السلوك القديم بالحرف)
const MSG_COLS = "id, tenant_id, conversation_id, direction, type, body, created_at";
const HIST_COLS = "id, direction, type, body, created_at, sent_by";
const MEDIA_COLS = ", media_path, media_mime, ai_media_text";
const GRAPH = "https://graph.facebook.com/v18.0";
// 🔴 نفس قايمة التريجر و preRule و AI_SKIP_TYPES (الواجهة): الأنواع دي مالهاش مسودة، فمابتتحسبش «رسالة أحدث من العميل»
const SKIP_TYPES = ["button", "reaction", "sticker", "unsupported"];
const AUTO_GAP_MS = 700, AUTO_SEND_TIMEOUT_MS = 20000, AUTO_FAIL_WINDOW_MS = 15 * 60000, AUTO_FAIL_TRIP = 3;
const STAFF_ACTIVE_MS = 30 * 60000; // موظف رد في المحادثة من أقل من كده = البوت بيسكت (الزرار ON)
const PREVIEW_ORDER_UID = "B-؟";    // رقم الطلب في المعاينة (dry_run/التقييم) — مفيش تسجيل هناك
const REACT_OK = ["answer", "collect", "clarify", "order_lookup"]; // تفعيل الأوردر الملغي في رد حقيقي بس (مش تصعيد ولا سقف ولا skip)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-diag-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EVAL_WA_ID = "201000000001"; // رقم واتساب وهمي لحالات التقييم (مفيش عميل حقيقي)

async function authorized(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token && SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true;
  const diag = (req.headers.get("x-diag-token") || "").trim();
  if (!diag) return false;
  const { data: row } = await admin.from("platform_settings").select("value").eq("key", "jt_diag_token").maybeSingle();
  const expected = String(row?.value || "").trim();
  return expected.length >= 24 && diag === expected;
}

// ── Gemini ───────────────────────────────────────────────────────────
// 🔴 سقف التفكير (16 نوفمبر — بلاغ المالك عن التكلفة): الموديل كان بيفكّر براحته (medium) والتفكير بيتحاسب خرج — مسودة «بكام» خدت 4,009
//    توكن و31 ثانية والرد 75 حرف. على الـ150 حالة: low = 142 (medium 144 — جوّه التذبذب) · الخرج 89 توكن بدل ~530 · 2.8ث بدل 5.6ث.
//    thinkingLevel لموديلات gemini-3 بس (2.5 بترفضه). `gen` من التقييم بيكسب (عشان نقارن مستويات تانية).
function thinkingFor(model: string): Record<string, unknown> {
  return /^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {};
}
interface GemOut { text: string; tokensIn: number; tokensOut: number; tokensCached: number; ms: number; error: string | null }
// deno-lint-ignore no-explicit-any
async function callGemini(model: string, system: string, user: string, gen?: Record<string, any>): Promise<GemOut> {
  const key = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  const t0 = Date.now();
  if (!key) return { text: "", tokensIn: 0, tokensOut: 0, tokensCached: 0, ms: 0, error: "no_gemini_key" };
  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, ...thinkingFor(model), ...(gen || {}) },
  };
  let last = "gemini_unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), GEMINI_TIMEOUT_MS);
    try {
      const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
      });
      // deno-lint-ignore no-explicit-any
      const data: any = await res.json().catch(() => null);
      if (!res.ok) {
        last = "gemini_" + res.status + ": " + String(data?.error?.message || "").slice(0, 240);
        if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(1500); continue; }
        break;
      }
      // deno-lint-ignore no-explicit-any
      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      // deno-lint-ignore no-explicit-any
      const text = parts.filter((p: any) => typeof p?.text === "string" && !p.thought).map((p: any) => p.text).join("");
      const um = data?.usageMetadata || {};
      if (!text) { last = "gemini_empty: " + String(data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "").slice(0, 60); break; }
      return {
        text, tokensIn: Number(um.promptTokenCount) || 0,
        tokensOut: (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0),
        tokensCached: Number(um.cachedContentTokenCount) || 0, ms: Date.now() - t0, error: null,
      };
    } catch (e) {
      last = (e as Error)?.name === "AbortError" ? "gemini_timeout" : "gemini_fetch_error";
      if (attempt === 0) { await sleep(800); continue; }
    } finally { clearTimeout(timer); }
  }
  return { text: "", tokensIn: 0, tokensOut: 0, tokensCached: 0, ms: Date.now() - t0, error: last };
}

// ── فهم الرسايل الصوتية والصور (21 نوفمبر — طلب المالك) ─────────────
// نداء صغير لكل رسالة (الملف inline + تعليمات ai-media.ts) → نص بيتخزن في wa_messages.ai_media_text مرة واحدة.
// 🔴 الكتابة الوحيدة هنا: عمود ai_media_text لو لسه فاضي — ومش في dry_run ولا التقييم (store = false). أي فشل = مفيش نص = السلوك القديم.
interface MediaRead { id: string; type: string; text: string | null; error: string | null; ti: number; to: number; ms: number }
async function callGeminiMedia(model: string, prompt: string, mime: string, b64: string): Promise<{ text: string | null; ti: number; to: number; error: string | null }> {
  const key = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (!key) return { text: null, ti: 0, to: 0, error: "no_gemini_key" };
  const payload = {
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: MEDIA_SCHEMA, ...thinkingFor(model) },
  };
  let last = "gemini_unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), MEDIA_TIMEOUT_MS);
    try {
      const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload),
      });
      // deno-lint-ignore no-explicit-any
      const data: any = await res.json().catch(() => null);
      if (!res.ok) {
        last = "gemini_" + res.status + ": " + String(data?.error?.message || "").slice(0, 160);
        if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(1200); continue; }
        break;
      }
      // deno-lint-ignore no-explicit-any
      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      // deno-lint-ignore no-explicit-any
      const raw = parts.filter((p: any) => typeof p?.text === "string" && !p.thought).map((p: any) => p.text).join("");
      const um = data?.usageMetadata || {};
      const text = parseMediaText(raw);
      return { text, ti: Number(um.promptTokenCount) || 0, to: (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0), error: text ? null : "bad_output" };
    } catch (e) {
      last = (e as Error)?.name === "AbortError" ? "gemini_timeout" : "gemini_fetch_error";
      if (last === "gemini_fetch_error" && attempt === 0) { await sleep(800); continue; }
      break;
    } finally { clearTimeout(timer); }
  }
  return { text: null, ti: 0, to: 0, error: last };
}
/** أسماء منتجات المتجر لنداء الفهم: المنتجات المعتمدة + سطر المنتج في كل كارت. */
function mediaNames(st: Static): string[] {
  return [...st.products.map((p) => p.name), ...st.cards.map((c) => cardProductLine(c))].filter(Boolean);
}
async function storeMediaText(tenantId: string, messageId: string, text: string): Promise<void> {
  const up = await admin.from("wa_messages").update({ ai_media_text: text }).eq("id", messageId).eq("tenant_id", tenantId).is("ai_media_text", null);
  if (up.error) console.error("wa-ai-draft media: store failed", up.error.code || "");
}
/** يقرا رسالة صوت/صورة واحدة: الملف من wa-media (مسار المحادثة دي بس) → Gemini → النص (ويخزّنه لو store). */
async function readMedia(st: Static, tenantId: string, convId: string, row: MediaRow, store: boolean): Promise<MediaRead> {
  const t0 = Date.now();
  const type = String(row.type || "");
  const out = (text: string | null, error: string | null, ti = 0, to = 0): MediaRead => ({ id: row.id, type, text, error, ti, to, ms: Date.now() - t0 });
  const mime = geminiMime(type, row.media_mime, row.media_path);
  if (!MEDIA_TYPES.includes(type) || !mime || !mediaPathOk(tenantId, convId, row.media_path)) return out(null, "unsupported");
  const dl = await admin.storage.from("wa-media").download(String(row.media_path));
  if (dl.error || !dl.data) return out(null, "download_failed");
  const buf = new Uint8Array(await dl.data.arrayBuffer());
  if (!buf.length || buf.length > (MEDIA_MAX_BYTES[type] || 0)) return out(null, "too_big");
  const g = await callGeminiMedia(st.model, mediaPrompt(type, mediaNames(st)), mime, toBase64(buf));
  if (store && g.text) await storeMediaText(tenantId, row.id, g.text);
  return out(g.text, g.error, g.ti, g.to);
}

// ── السياق الثابت للمتجر (قراية بس) ──────────────────────────────────
interface Static {
  mode: string; model: string; layout: Layout; esc: EscStyle; facts: Record<string, unknown>;
  products: ProductLite[]; cards: CardLite[]; allCards: CardLite[]; siteRows: SiteRow[]; stockNames: string[];
  cardMedia: Map<string, string[]>; // صور كل كارت (مسارات wa-media) — للإرسال التلقائي بس، مابتدخلش الـprompt
  orderProducts: OrderProduct[];    // المنتجات اللي البوت بيسجّل أوردرها (ai_products اللي مقاساتها مربوطة بصنف مخزون) بالسعر المعتمد
  ads: Map<string, { name: string | null; productId: string | null }>;
}
async function loadStatic(tenantId: string, factsExtra?: Record<string, unknown>): Promise<Static | null> {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const [set, prods, qr, stock, site, ads] = await Promise.all([
    admin.from("ai_settings").select("mode, model, facts").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("ai_products").select("id, name, aliases, site_names, quick_reply_id, assembled, facts").eq("tenant_id", tenantId).eq("active", true),
    admin.from("wa_quick_replies").select("id, title, body, sort, media, ai_notes").eq("tenant_id", tenantId).order("sort", { ascending: true }),
    admin.from("stock_products").select("name").eq("tenant_id", tenantId).eq("active", true).limit(400),
    admin.from("orders").select("product_name, total_cost, var, manufacturer_note, platform, exchange_of, line_prices, has_upsell")
      .eq("tenant_id", tenantId).gte("created_at", since).limit(1000),
    admin.from("ctwa_ads").select("ad_id, ad_name, ai_product_id").eq("tenant_id", tenantId),
  ]);
  if (set.error || !set.data) return null;
  const facts = { ...((set.data.facts as Record<string, unknown>) || {}), ...(factsExtra || {}) };
  const skip = Array.isArray(facts.skip_cards) ? (facts.skip_cards as unknown[]).map((x) => String(x).trim()) : [];
  // الاستعلام بالعمود الجديد وقع (العمود اتشال/الكاش قديم) = الكروت ماتختفيش: نرجع للاستعلام القديم من غير المعلومات
  // deno-lint-ignore no-explicit-any
  let qrRows: any[] | null = qr.data;
  if (qr.error) qrRows = (await admin.from("wa_quick_replies").select("id, title, body, sort, media").eq("tenant_id", tenantId).order("sort", { ascending: true })).data;
  const cardMedia = new Map<string, string[]>();
  // deno-lint-ignore no-explicit-any
  for (const c of (qrRows || []) as any[]) {
    // deno-lint-ignore no-explicit-any
    const paths = Array.isArray(c.media) ? c.media.map((m: any) => String(m?.path || "")).filter(Boolean) : [];
    if (paths.length) cardMedia.set(String(c.id), paths);
  }
  // deno-lint-ignore no-explicit-any
  const allCards: CardLite[] = (qrRows || []).filter((c: any) => String(c.title || "").trim() && String(c.body || "").trim())
    // deno-lint-ignore no-explicit-any
    .map((c: any) => ({ id: c.id, title: String(c.title).trim(), body: String(c.body), notes: String(c.ai_notes || "").trim() || null }));
  const products = (prods.data || []) as ProductLite[];
  const siteRows = siteRowsFrom(site.data || []);
  const orderProducts: OrderProduct[] = products.map((p) => {
    // deno-lint-ignore no-explicit-any
    const vs = (Array.isArray(p.facts?.variants) ? p.facts.variants : []) as any[];
    return {
      id: p.id, name: p.name, aliases: p.aliases || [], siteNames: p.site_names || [],
      // deno-lint-ignore no-explicit-any
      variants: vs.filter((v: any) => v && v.stock_product_id).map((v: any) => ({ label: String(v.label || ""), stockProductId: String(v.stock_product_id), price: effectivePrice(v, vs, siteRows).price })),
    };
  }).filter((p) => p.variants.length);
  return {
    mode: String(set.data.mode || "off"), model: String(set.data.model || "").trim() || DEFAULT_MODEL, layout: layoutOf(facts.prompt_layout), esc: escStyleOf(facts.esc_style), facts,
    products, orderProducts,
    allCards, cards: allCards.filter((c) => !skip.includes(c.title)), cardMedia,
    siteRows,
    // deno-lint-ignore no-explicit-any
    stockNames: (stock.data || []).map((s: any) => String(s.name || "").trim()).filter(Boolean),
    // deno-lint-ignore no-explicit-any
    ads: new Map((ads.data || []).map((a: any) => [String(a.ad_id), { name: a.ad_name || null, productId: a.ai_product_id || null }])),
  };
}

// تجربة «معلومات للـAgent» على كارت من غير أي كتابة — للتقييم والـdry_run بس (المسار العادي = عمود ai_notes وبس)
function withCardNotes(st: Static, m: Record<string, unknown> | null): void {
  if (!m) return;
  const put = (c: CardLite): CardLite => (typeof m[c.title] === "string" ? { ...c, notes: String(m[c.title]).slice(0, 1500) } : c);
  st.cards = st.cards.map(put); st.allCards = st.allCards.map(put);
}

interface ConvCtx {
  adId: string | null; adBody: string | null; customerName: string | null;
  orders: OrderLite[]; ordersKnown: boolean; history: HistMsg[];
}
interface Result { draft: Draft | null; model: string | null; tokensIn: number; tokensOut: number; tokensCached: number; ms: number; error: string | null }

// deno-lint-ignore no-explicit-any
async function draftFor(st: Static, cv: ConvCtx, trigger: { type: string; body: string | null; media?: string | null }, model: string, gen?: Record<string, any>, evalRules?: string): Promise<Result> {
  const pre = preRule(trigger.type, trigger.body, trigger.media);
  if (pre) return { draft: pre, model: null, tokensIn: 0, tokensOut: 0, tokensCached: 0, ms: 0, error: null };
  const ad = cv.adId ? st.ads.get(cv.adId) : null;
  const ctx: DraftCtx = {
    nowIso: new Date().toISOString(), facts: st.facts, products: st.products,
    linkedProductId: ad?.productId || null,
    ad: cv.adId ? { name: ad?.name || null, body: cv.adBody } : null,
    cards: st.cards, siteRows: st.siteRows, stockNames: st.stockNames,
    orders: cv.orders, ordersKnown: cv.ordersKnown, customerName: cv.customerName, history: cv.history,
  };
  // تعليمات الفويس والصور بتتضاف بس لو المحادثة فيها حاجة اتفهمت (21 نوفمبر) — غير كده التعليمات نفس البايتات القديمة
  const hasMedia = cv.history.some((m) => m.dir === "in" && !!String(m.media || "").trim());
  const system = buildSystemPrompt(st.esc === "v2" ? { esc: "v2", hours: workHoursOf(st.facts) } : undefined) + (hasMedia ? "\n\n" + MEDIA_RULES : "")
    + (evalRules ? "\n\n# قواعد تجريبية (تقييم بس)\n" + evalRules : "");
  const g = await callGemini(model, system, buildUserPrompt(ctx, st.layout), gen);
  if (g.error) return { draft: null, model, tokensIn: 0, tokensOut: 0, tokensCached: 0, ms: g.ms, error: g.error };
  const draft = parseDraft(g.text, st.cards);
  return { draft, model, tokensIn: g.tokensIn, tokensOut: g.tokensOut, tokensCached: g.tokensCached, ms: g.ms, error: draft ? null : "bad_output" };
}

// ── الإرسال التلقائي (الزرار ON) ─────────────────────────────────────
interface AutoState {
  ok: boolean; waId: string | null; lastInboundAt: string | null; escAt: string | null; escNote: string | null;
  holdSent: boolean; turnsInConv: number; turnsToday: number; cardRepeat: number;
  lastBotText: string | null; // آخر رسالة نص من البوت في المحادثة من أقل من 5 دقايق (حارس التكرار)
}
const NO_STATE: AutoState = { ok: false, waId: null, lastInboundAt: null, escAt: null, escNote: null, holdSent: false, turnsInConv: 0, turnsToday: 0, cardRepeat: 0, lastBotText: null };
/** حالة المحادثة والسقوف. أي استعلام وقع (أعمدة لسه مااتضافتش مثلاً) = ok:false = مفيش إرسال. */
async function autoState(tenantId: string, convId: string, cardTitle: string | null, exceptDraftId: string | null): Promise<AutoState> {
  const sinceConv = new Date(Date.now() - AUTO_TURNS_WINDOW_MS).toISOString();
  const sinceDay = new Date(Date.now() - 24 * 3600000).toISOString();
  const sinceRep = new Date(Date.now() - AUTO_REPEAT_WINDOW_MS).toISOString();
  const [cv, inConv, today, lastBot] = await Promise.all([
    admin.from("wa_conversations").select("wa_id, last_inbound_at, ai_escalated_at, ai_escalation_note, ai_hold_at")
      .eq("id", convId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("wa_ai_drafts").select("id, auto_result").eq("tenant_id", tenantId).eq("conversation_id", convId)
      .gt("auto_sent_n", 0).gte("auto_sent_at", sinceConv).limit(80),
    admin.from("wa_ai_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
      .gt("auto_sent_n", 0).gte("auto_sent_at", sinceDay),
    admin.from("wa_messages").select("body").eq("tenant_id", tenantId).eq("conversation_id", convId).eq("direction", "out")
      .eq("type", "text").eq("sent_by_name", BOT_NAME).gte("created_at", sinceRep).order("created_at", { ascending: false }).limit(1),
  ]);
  if (cv.error || !cv.data || inConv.error || today.error) return NO_STATE;
  // deno-lint-ignore no-explicit-any
  const rows = ((inConv.data || []) as any[]).filter((r) => r.id !== exceptDraftId);
  return {
    ok: true, waId: cv.data.wa_id || null, lastInboundAt: cv.data.last_inbound_at || null,
    escAt: cv.data.ai_escalated_at || null, escNote: cv.data.ai_escalation_note || null, holdSent: !!cv.data.ai_hold_at,
    turnsInConv: rows.length, turnsToday: Number(today.count) || 0,
    cardRepeat: cardTitle ? rows.filter((r) => r.auto_result?.card === cardTitle).length : 0,
    lastBotText: !lastBot.error && lastBot.data && lastBot.data[0] ? String(lastBot.data[0].body || "") || null : null, // القراية وقعت = من غير الحارس ده
  };
}
function planFor(st: Static, r: Result, state: AutoState, tenantId: string, order: OrderOutcome | null = null, react: ReactOutcome | null = null): { plan: AutoPlan; card: AutoCard | null } {
  const cardRow = r.draft?.card ? st.cards.find((c) => c.title === r.draft!.card) : null;
  // صور الكارت: مسارات `<tenant>/quick-replies/…` بس (نفس شرط wa-media) — صورة بمسار تاني بتتساب بدل ما توقّع الرد كله
  const card: AutoCard | null = cardRow
    ? { title: cardRow.title, body: cardRow.body, images: (st.cardMedia.get(cardRow.id) || []).filter((p) => isQuickReplyPath(tenantId, p)) } : null;
  const plan = autoPlan({
    draft: r.draft, fromModel: !!r.model, error: r.error, card, cardRepeat: state.cardRepeat, holdSent: state.holdSent,
    turnsInConv: state.turnsInConv, turnsToday: state.turnsToday,
    holdMessage: typeof st.facts.hold_message === "string" ? st.facts.hold_message as string : null,
    order, react, escTalk: st.esc === "v2", lastBotText: state.lastBotText,
  });
  return { plan, card };
}

// ── الأوردر من البوت (17 نوفمبر) ─────────────────────────────────────
/** خطوة الأوردر لمسودة collect بياناتها كملت. null = مفيش order في المسودة (البوت لسه بيجمّع). قرار بس — مفيش كتابة. */
function orderStepFor(st: Static, r: Result, prev: PrevOrder[], waId: string | null, sess: { all: string; inbound: string } | null): OrderStep | null {
  const d = r.draft;
  if (!d || d.behavior !== "collect") return null;
  if (!d.order) return orphanPromise(d.reply); // الرد بيوعد بتأكيد ومفيش بيانات أوردر = موظف يسجّله
  // «معلومات للـAgent» على كارت المنتج (بتتقري وقت القرار — card_notes بتاع التقييم بيتطبّق عليها): «خلص» = مفيش تسجيل تلقائي
  const noteOf = (pid: string) => st.allCards.find((c) => c.id === st.products.find((x) => x.id === pid)?.quick_reply_id)?.notes || null;
  // 21 نوفمبر: البيانات لازم تبان في «المحادثة الحالية» (sess.all) · وطلب ميعاد استلام معين في كلام العميل (sess.inbound) = موظف يسجّل
  return planOrder(d.order, st.orderProducts.map((p) => ({ ...p, note: noteOf(p.id) })), prev, waId, undefined,
    sess ? { recent: sess.all, recentIn: sess.inbound, nowIso: new Date().toISOString() } : {});
}
const handoffOutcome = (r: Result, note: string): OrderOutcome =>
  ({ state: "handoff", text: ORDER_HANDOFF_TEXT, note: note + (r.draft?.order ? " · " + orderSummary(r.draft.order) : "") });
/** نتيجة الخطوة كنص للعميل. create محتاجة رقم الطلب (من التسجيل الحقيقي، أو PREVIEW_ORDER_UID في المعاينة). */
function orderOutcome(st: Static, r: Result, step: OrderStep, uid: string): OrderOutcome {
  if (step.kind === "ask") return { state: "ask", text: step.text };
  if (step.kind === "handoff") return handoffOutcome(r, step.note);
  return { state: "created", text: orderConfirmText(step.args, uid, typeof st.facts.delivery === "string" ? st.facts.delivery as string : null) };
}
function orderPreview(step: OrderStep | null): Record<string, unknown> | null {
  if (!step) return null;
  if (step.kind === "create") return { would: "create", product: step.args.product_label, qty: step.args.qty, total: step.args.total, city: step.args.city };
  return { would: step.kind, why: step.why };
}
const ORDER_REFUSED: Record<string, string> = {
  has_returned_order: "العميل ليه أوردر سابق رجع/مااستلموش — راجع قبل ما تسجّل الجديد",
  has_open_order: "العميل عنده أوردر لسه مفتوح — ممكن يكون تكرار",
  duplicate: "فيه أوردر اتسجّل بنفس الرقم من دقايق — راجع قبل ما تسجّل",
  day_cap: "البوت وصل للحد اليومي لتسجيل الأوردرات — سجّل الأوردر إنت",
  bot_off: "الزرار اتقفل قبل التسجيل — سجّل الأوردر إنت",
};
/** تسجيل الأوردر على السيرفر (create_bot_order — بيعيد الحراسات كلها). أي رفض أو خطأ = مفيش أوردر والسبب بيرجع. */
async function createBotOrder(tenantId: string, a: CreateArgs): Promise<{ ok: true; uid: string; id: string } | { ok: false; error: string; ref: string | null }> {
  const { data, error } = await admin.rpc("create_bot_order", {
    p_tenant: tenantId, p_customer_name: a.customer_name, p_phone: a.phone, p_alt_phone: a.alt_phone, p_city: a.city, p_address: a.address,
    p_stock_product_id: a.stock_product_id, p_qty: a.qty, p_unit_price: a.unit_price, p_var: a.variant,
  });
  // deno-lint-ignore no-explicit-any
  const d: any = data;
  if (error || !d) return { ok: false, error: "rpc_error", ref: null };
  if (d.ok === true && d.order_uid && d.order_id) return { ok: true, uid: String(d.order_uid), id: String(d.order_id) };
  return { ok: false, error: String(d.error || "refused").slice(0, 40), ref: d.order_uid ? String(d.order_uid) : null };
}

// ── تفعيل أوردر ملغي (17 نوفمبر) ─────────────────────────────────────
const deliveryFact = (st: Static): string | null => (typeof st.facts.delivery === "string" ? st.facts.delivery as string : null);
const toReact = (o: OrderLite): ReactOrder => ({
  id: String(o.id || ""), order_uid: o.order_uid, status: o.status, product_name: o.product_name, total: o.total,
  cancelled_at: o.cancelled_at || null, cancelled_by: o.cancelled_by || null, has_tracking: !!o.has_tracking,
});
/** خطوة التفعيل لمسودة فيها reactivate. null = مفيش (أو الرقم مش أوردر ملغي للعميل ده) — رد الموديل يتبعت زي ما هو. قرار بس — مفيش كتابة. */
function reactStepFor(r: Result, orders: OrderLite[]): ReactStep | null {
  const d = r.draft;
  if (!d || !d.reactivate) return null;
  return planReactivate(d.reactivate, orders.map(toReact), new Date().toISOString());
}
const reactHandoff = (note: string): ReactOutcome => ({ state: "handoff", text: REACT_HANDOFF_TEXT, note });
/** نتيجة الخطوة كنص للعميل — للمعاينة (dry_run/التقييم): «كان هيتفعّل» من غير أي كتابة. */
function reactOutcomePreview(st: Static, step: ReactStep): ReactOutcome {
  return step.kind === "reactivate" ? { state: "done", text: reactivateConfirmText(step.order, deliveryFact(st)) } : reactHandoff(step.note);
}
function reactPreview(step: ReactStep | null): Record<string, unknown> | null {
  if (!step) return null;
  return step.kind === "reactivate" ? { would: "reactivate", uid: step.order.order_uid } : { would: "handoff", why: step.why };
}
const REACT_REFUSED: Record<string, string> = {
  has_returned_order: "العميل ليه أوردر تاني رجع/مااستلموش — راجع قبل ما تفعّله",
  has_open_order: "العميل عنده أوردر تاني لسه مفتوح — ممكن يكون تكرار",
  not_customer_cancel: "اللي لغاه موظف مش العميل — راجع سبب الإلغاء",
  too_old: "اتلغى من أكتر من يومين — راجعه وفعّله إنت",
  has_tracking: "الأوردر ليه بوليصة شحن — راجعه",
  already_reactivated: "البوت فعّله مرة قبل كده والعميل لغاه تاني — راجعه",
  not_cancelled: "حالة الأوردر اتغيّرت — راجعه",
  bot_off: "الزرار اتقفل قبل التفعيل — فعّله إنت",
};
/** التفعيل على السيرفر (reactivate_bot_order — بيعيد الحراسات كلها). أي رفض أو خطأ = الأوردر زي ما هو والسبب بيرجع. */
async function reactivateBotOrder(tenantId: string, orderId: string, waId: string | null): Promise<{ ok: true; uid: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("reactivate_bot_order", { p_tenant: tenantId, p_order_id: orderId, p_wa_id: waId || "" });
  // deno-lint-ignore no-explicit-any
  const d: any = data;
  if (error || !d) return { ok: false, error: "rpc_error" };
  if (d.ok === true && d.order_uid) return { ok: true, uid: String(d.order_uid) };
  return { ok: false, error: String(d.error || "refused").slice(0, 40) };
}

/** موظف رد في المحادثة من أقل من نص ساعة والزرار ON: البوت ساكت — بس المحادثة تتعلّم «تصعيد» عشان رسالة العميل ماتتنسيش لو الموظف مشي. */
async function staffActiveFlag(tenantId: string, convId: string): Promise<void> {
  const { data: cv } = await admin.from("wa_conversations").select("ai_escalated_at, ai_escalation_note").eq("id", convId).eq("tenant_id", tenantId).maybeSingle();
  if (!cv) return;
  const up = await admin.from("wa_conversations").update({
    ai_escalated_at: cv.ai_escalated_at || new Date().toISOString(),
    ai_escalation_note: mergeEscNote(cv.ai_escalation_note, "العميل كتب وموظف كان بيرد في المحادثة من أقل من نص ساعة — البوت سكت"),
  }).eq("id", convId).eq("tenant_id", tenantId);
  if (up.error) console.error("wa-ai-draft auto: staff-active flag failed", up.error.code || "");
}
function planPreview(plan: AutoPlan): Record<string, unknown> {
  return {
    reason: plan.reason, escalate: plan.escalate,
    actions: plan.actions.map((a) => a.kind === "image" ? { kind: "image", caption: a.caption ? a.caption.slice(0, 80) : null } : { kind: "text", tag: a.tag, body: a.body }),
  };
}

/** رسالة واحدة لميتا + صف في wa_messages باسم البوت. بيرجّع null لو اتبعتت، أو سبب الفشل (من غير أي إعادة — التكرار أسوأ من الغياب). */
async function sendAction(a: AutoAction, tenantId: string, convId: string, to: string, phoneId: string, token: string): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  let payload: any;
  let storedType = "text", storedBody: string | null = null, mediaPath: string | null = null, usedMediaId = false;
  if (a.kind === "image") {
    if (!isQuickReplyPath(tenantId, a.path)) return "bad_media_path";
    const cap = a.caption ? { caption: a.caption } : {};
    const mediaId = await quickReplyMediaId({ svc: admin, graph: GRAPH }, tenantId, phoneId, token, a.path);
    if (mediaId) { usedMediaId = true; payload = { messaging_product: "whatsapp", to, type: "image", image: { id: mediaId, ...cap } }; }
    else {
      const signed = await admin.storage.from("wa-media").createSignedUrl(a.path, 600);
      const link = signed.data?.signedUrl;
      if (!link) return "media_url_failed";
      payload = { messaging_product: "whatsapp", to, type: "image", image: { link, ...cap } };
    }
    storedType = "image"; storedBody = a.caption || null; mediaPath = a.path;
  } else {
    payload = { messaging_product: "whatsapp", to, type: "text", text: { body: a.body } };
    storedBody = a.body;
  }
  // deno-lint-ignore no-explicit-any
  const post = async (): Promise<{ ok: boolean; status: number; j: any } | null> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), AUTO_SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: "POST", signal: ctl.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      return { ok: res.ok, status: res.status, j: await res.json().catch(() => ({})) };
    } catch { return null; } finally { clearTimeout(timer); }
  };
  let out = await post();
  if (!out) return "wa_fetch_error"; // مش عارفين اتبعتت ولا لأ — مابنعيدش
  if (!out.ok && usedMediaId && a.kind === "image" && shouldRetryWithLink(out.status, out.j?.error?.code)) {
    const signed = await admin.storage.from("wa-media").createSignedUrl(a.path, 600);
    const link = signed.data?.signedUrl;
    if (link) {
      payload.image = { link, ...(a.caption ? { caption: a.caption } : {}) };
      out = await post();
      if (!out) return "wa_fetch_error";
      if (out.ok) await forgetMediaId(admin, tenantId, phoneId, a.path);
    }
  }
  if (!out.ok) return "wa_" + out.status + ": " + String(out.j?.error?.message || "").slice(0, 160);
  const ins = await admin.from("wa_messages").insert({
    tenant_id: tenantId, conversation_id: convId, wa_message_id: out.j?.messages?.[0]?.id || null, direction: "out",
    type: storedType, body: storedBody, media_path: mediaPath, status: "sent", wa_timestamp: new Date().toISOString(),
    sent_by: null, sent_by_name: BOT_NAME,
  });
  if (ins.error) console.error("wa-ai-draft auto: message sent but not stored", ins.error.code || "");
  return null;
}

/** 3 أخطاء إرسال في ربع ساعة = الزرار بيرجع OFF لوحده (توكن اتلغى · الرقم اتقفل · ميتا واقعة) — البوت مايفضلش يحاول طول الليل. */
async function autoBreaker(tenantId: string): Promise<void> {
  const since = new Date(Date.now() - AUTO_FAIL_WINDOW_MS).toISOString();
  const { count } = await admin.from("wa_ai_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
    .gte("auto_sent_at", since).not("auto_result->>error", "is", null);
  if ((Number(count) || 0) < AUTO_FAIL_TRIP) return;
  await autoOff(tenantId, "إيقاف تلقائي — أخطاء إرسال");
}
/** الزرار بيرجع OFF لوحده (أخطاء إرسال · الموديل واقف: رصيد/مفتاح Gemini) — وبيتسجّل في ai_mode_log. */
async function autoOff(tenantId: string, by: string): Promise<void> {
  // OFF = ai_settings.idle_mode: 'off' واقف خالص · غير كده (أو القراية وقعت) 'shadow' — الاتنين مابيبعتوش للعميل.
  const { data: cur } = await admin.from("ai_settings").select("idle_mode").eq("tenant_id", tenantId).maybeSingle();
  const back = cur?.idle_mode === "off" ? "off" : "shadow";
  const { data } = await admin.from("ai_settings").update({ mode: back, auto_changed_at: new Date().toISOString(), auto_changed_by_name: by })
    .eq("tenant_id", tenantId).eq("mode", "auto").select("tenant_id");
  if (data && data.length) await admin.from("ai_mode_log").insert({ tenant_id: tenantId, mode: back, by_name: by });
}

// deno-lint-ignore no-explicit-any
async function autoRun(msg: any, st: Static, r: Result, draftId: string, prevOrders: OrderLite[], sess: { all: string; inbound: string }): Promise<Record<string, unknown>> {
  // 1) الزرار لسه ON؟ (المالك ممكن يكون طفّاه وإحنا مستنيين الموديل)
  const { data: now1 } = await admin.from("ai_settings").select("mode").eq("tenant_id", msg.tenant_id).maybeSingle();
  if (now1?.mode !== "auto") return { auto: "mode_changed" };
  // 2) حجز ذري — نداء مكرر لنفس الرسالة مايبعتش مرتين
  const { data: claim } = await admin.from("wa_ai_drafts").update({ auto_sent_at: new Date().toISOString(), auto_sent_n: 0 })
    .eq("id", draftId).is("auto_sent_at", null).select("id");
  if (!claim || !claim.length) return { auto: "already_claimed" };
  const finish = async (res: Record<string, unknown>, n: number, markSent: boolean): Promise<Record<string, unknown>> => {
    await admin.from("wa_ai_drafts").update({ auto_sent_n: n, auto_result: res }).eq("id", draftId);
    if (markSent) await admin.from("wa_ai_drafts").update({ status: "sent" }).eq("id", draftId).eq("status", "pending");
    return { auto: res.reason, sent: n, error: res.error || null };
  };
  // 3) العميل كتب تاني (رسالته هي اللي هترد) أو حد رد خلاص
  //    (نفس شكل الفحص اللي قبل الموديل: أحدث الرسايل والمقارنة هنا — من غير فلتر وقت في الاستعلام)
  const { data: latest, error: newerErr } = await admin.from("wa_messages").select("id, direction, type, sent_by, created_at")
    .eq("tenant_id", msg.tenant_id).eq("conversation_id", msg.conversation_id).order("created_at", { ascending: false }).limit(30);
  if (newerErr) return finish({ reason: "recheck_error", error: null }, 0, false);
  // deno-lint-ignore no-explicit-any
  const newer = (latest || []).filter((x: any) => x.created_at > msg.created_at && x.id !== msg.id);
  // deno-lint-ignore no-explicit-any
  if ((newer || []).some((x: any) => x.direction === "in" && !SKIP_TYPES.includes(String(x.type)))) return finish({ reason: "superseded", error: null }, 0, false);
  // deno-lint-ignore no-explicit-any
  if ((newer || []).some((x: any) => x.direction === "out" && x.sent_by)) return finish({ reason: "answered", error: null }, 0, false);
  // 4) الحالة والسقوف ونافذة الـ24 ساعة
  const state = await autoState(msg.tenant_id, msg.conversation_id, r.draft?.card || null, draftId);
  if (!state.ok) return finish({ reason: "state_error", error: null }, 0, false);
  const lastIn = state.lastInboundAt ? Date.parse(state.lastInboundAt) : 0;
  if (!lastIn || Date.now() - lastIn >= 24 * 3600000) return finish({ reason: "window_closed", error: null }, 0, false);
  let { plan, card } = planFor(st, r, state, msg.tenant_id);
  // الموديل واقف (رصيد/مفتاح Gemini): تصعيد ساكت للمحادثة دي والزرار يرجع OFF — مفيش رسالة اعتذار لكل عميل طول الليل
  if (plan.reason === "model_down") await autoOff(msg.tenant_id, "إيقاف تلقائي — رصيد/مفتاح Gemini");
  // 4ب) الأوردر: collect والبيانات كملت (والسقوف عدّت — plan.reason = collect) → القرار، ولو «يتسجّل» التسجيل على السيرفر قبل رسالة التأكيد
  let orderInfo: Record<string, unknown> | null = null;
  // 4أ) العميل عايز أوردره الملغي (reactivate) — قبل أي تسجيل جديد: تفعيل نفس الأوردر أحسن من أوردر مكرر. رد حقيقي بس (السقوف عدّت).
  const rstep = REACT_OK.includes(plan.reason) ? reactStepFor(r, prevOrders) : null;
  if (rstep) {
    let ro: ReactOutcome;
    if (rstep.kind === "reactivate") {
      const done = await reactivateBotOrder(msg.tenant_id, rstep.order.id, state.waId);
      if (done.ok) { ro = { state: "done", text: reactivateConfirmText(rstep.order, deliveryFact(st)) }; orderInfo = { state: "reactivated", uid: done.uid, id: rstep.order.id }; }
      else {
        ro = reactHandoff("العميل عايز يفعّل أوردر #" + rstep.order.order_uid + " الملغي — " + (REACT_REFUSED[done.error] || "السيستم مافعّلوش (" + done.error + ") — فعّله إنت"));
        orderInfo = { state: "react_refused", why: done.error };
      }
    } else { ro = reactHandoff(rstep.note); orderInfo = { state: "react_handoff", why: rstep.why }; }
    ({ plan, card } = planFor(st, r, state, msg.tenant_id, null, ro));
  }
  const step = !rstep && plan.reason === "collect" ? orderStepFor(st, r, prevOrders, state.waId, sess) : null;
  if (step) {
    let outcome: OrderOutcome;
    if (step.kind === "create") {
      const made = await createBotOrder(msg.tenant_id, step.args);
      if (made.ok) { outcome = orderOutcome(st, r, step, made.uid); orderInfo = { state: "created", uid: made.uid, id: made.id, total: step.args.total }; }
      else {
        outcome = handoffOutcome(r, (ORDER_REFUSED[made.error] || "السيستم ماسجّلش الأوردر (" + made.error + ") — سجّله إنت") + (made.ref ? " (#" + made.ref + ")" : ""));
        orderInfo = { state: "refused", why: made.error };
      }
    } else { outcome = orderOutcome(st, r, step, PREVIEW_ORDER_UID); orderInfo = { state: step.kind, why: step.why }; }
    ({ plan, card } = planFor(st, r, state, msg.tenant_id, outcome));
  }
  // 5) الإرسال — بالترتيب، وأول فشل بيوقّف الباقي
  let sent = 0, sendErr: string | null = null, holdNow = false, cardSent = false;
  const kinds: string[] = [];
  if (plan.actions.length) {
    const { data: tenant } = await admin.from("tenants").select("whatsapp_token, whatsapp_phone_id").eq("id", msg.tenant_id).maybeSingle();
    if (!tenant?.whatsapp_token || !tenant?.whatsapp_phone_id || !state.waId) sendErr = "no_wa_config";
    else for (const a of plan.actions) {
      if (sent) await sleep(AUTO_GAP_MS);
      const e = await sendAction(a, msg.tenant_id, msg.conversation_id, state.waId, String(tenant.whatsapp_phone_id), String(tenant.whatsapp_token));
      if (e) { sendErr = e; break; }
      sent++;
      if (a.kind === "image") { kinds.push("image"); cardSent = true; }
      else { kinds.push(a.tag); if (a.tag === "hold") holdNow = true; if (a.tag === "card_text") cardSent = true; }
    }
  }
  // 6) «تصعيد» على المحادثة (بيتشال لما موظف يرد — trg_wa_ai_escalation_clear)
  const madeNote = orderInfo && orderInfo.state === "created" ? "الأوردر " + String(orderInfo.uid) + " اتسجّل بس رسالة التأكيد ماوصلتش للعميل · "
    : orderInfo && orderInfo.state === "reactivated" ? "الأوردر " + String(orderInfo.uid) + " اتفعّل تاني بس رسالة التأكيد ماوصلتش للعميل · " : "";
  const escNote = sendErr ? mergeEscNote(plan.escalate, madeNote + "البوت معرفش يبعت الرد (" + sendErr.slice(0, 120) + ")") : plan.escalate;
  if (escNote || holdNow) {
    const patch: Record<string, unknown> = {};
    if (escNote) { patch.ai_escalated_at = state.escAt || new Date().toISOString(); patch.ai_escalation_note = mergeEscNote(state.escNote, escNote); }
    if (holdNow) patch.ai_hold_at = new Date().toISOString();
    const up = await admin.from("wa_conversations").update(patch).eq("id", msg.conversation_id).eq("tenant_id", msg.tenant_id);
    if (up.error) console.error("wa-ai-draft auto: escalation flag failed", up.error.code || "");
  }
  // 7) الأثر على المسودة — «sent» للرد الحقيقي اللي اتبعت كله بس (التصعيد بيفضل pending عشان الموظف يشوف الملاحظة)
  const realReply = ["answer", "collect", "clarify", "order_lookup"].includes(plan.reason);
  const out = await finish({ reason: plan.reason, kinds, card: cardSent && card ? card.title : null, escalated: !!escNote, error: sendErr, ...(orderInfo ? { order: orderInfo } : {}) }, sent, realReply && sent > 0 && !sendErr);
  if (sendErr) await autoBreaker(msg.tenant_id);
  return out;
}

// ── المسار العادي: رسالة واردة حقيقية ───────────────────────────────
async function handleMessage(messageId: string, dry: boolean, modelOverride: string | null, layoutOverride: Layout | null, notesOverride: Record<string, unknown> | null, escOverride: EscStyle | null): Promise<Record<string, unknown>> {
  // deno-lint-ignore no-explicit-any
  let mq: any = await admin.from("wa_messages").select(MSG_COLS + MEDIA_COLS).eq("id", messageId).maybeSingle();
  if (mq.error) mq = await admin.from("wa_messages").select(MSG_COLS).eq("id", messageId).maybeSingle();
  const msg = mq.data;
  if (!msg) return { skipped: "not_found" };
  if (msg.direction !== "in") return { skipped: "not_inbound" };
  const st = await loadStatic(msg.tenant_id);
  if (!st) return { skipped: "no_settings" };
  if (dry && layoutOverride) st.layout = layoutOverride; // تجربة شكل دخل تاني — dry_run بس (المسار العادي = إعداد المتجر)
  if (dry) withCardNotes(st, notesOverride);
  if (dry && escOverride) st.esc = escOverride; // تجربة أسلوب تصعيد تاني — dry_run بس (المسار العادي = إعداد المتجر)
  if (!dry && st.mode !== "shadow" && st.mode !== "auto") return { skipped: "mode_off" };
  // 🔴 فهم الفويس/الصورة بتاعة الرسالة دي بيبدأ مع الانتظار (12ث) مش بعده — وبيتخزن حتى لو رسالة أحدث جت (مسودتها بتقراه من غير نداء تاني)
  const early = !dry && mediaToRead([msg], msg.tenant_id, msg.conversation_id, msg.id, 1).length
    ? readMedia(st, msg.tenant_id, msg.conversation_id, msg, true) : null;
  if (!dry) await sleep(DEBOUNCE_MS);
  const earlyRead = early ? await early : null;

  const histQ = (cols: string) => admin.from("wa_messages").select(cols).eq("tenant_id", msg.tenant_id).eq("conversation_id", msg.conversation_id)
    .order("created_at", { ascending: false }).limit(HISTORY_N + 20);
  // deno-lint-ignore no-explicit-any
  let hq: any = await histQ(HIST_COLS + MEDIA_COLS);
  if (hq.error) hq = await histQ(HIST_COLS);
  // deno-lint-ignore no-explicit-any
  const rows: any[] = hq.data || [];
  // deno-lint-ignore no-explicit-any
  const newer = rows.filter((r: any) => r.created_at > msg.created_at && r.id !== msg.id);
  if (!dry) {
    // deno-lint-ignore no-explicit-any
    if (newer.some((r: any) => r.direction === "in" && !SKIP_TYPES.includes(String(r.type)))) return { skipped: "superseded" }; // الرسالة الأحدث هي اللي هتعمل المسودة (تفاعل/زرار مالوش مسودة فمابيتحسبش)
    // deno-lint-ignore no-explicit-any
    // 🔴 «اترد عليها» = رسالة من **موظف** (sent_by) بس. رسالة البوت نفسه أو رسالة «المندوب في الطريق» التلقائية مش رد على رسالة العميل دي:
    //    من غير الشرط، عميل كتب رسالة تانية في الثانية اللي البوت بيبعت فيها رد الأولى كانت رسالته التانية بتتساب من غير رد.
    if (newer.some((r: any) => r.direction === "out" && r.sent_by)) return { skipped: "answered" };
  }
  // 🔴 (17 نوفمبر — قرار المالك) موظف رد في المحادثة من أقل من 30 دقيقة = البوت مايدخلش وسط كلامه: مفيش موديل ولا مسودة ولا رسالة.
  //    الزرار ON بس — في shadow المسودة اقتراح للموظف نفسه فبتتعمل عادي.
  const staffCut = Date.now() - STAFF_ACTIVE_MS;
  // deno-lint-ignore no-explicit-any
  const staffActive = rows.some((r: any) => r.direction === "out" && r.sent_by && Date.parse(r.created_at) >= staffCut);
  if (!dry && st.mode === "auto" && staffActive) { await staffActiveFlag(msg.tenant_id, msg.conversation_id); return { skipped: "staff_active" }; }
  // deno-lint-ignore no-explicit-any
  const histRows: any[] = rows.filter((r: any) => r.created_at <= msg.created_at).slice(0, HISTORY_N);
  // الفويس/الصور اللي لسه مااتفهمتش في الرسايل دي (رسالة المسودة الأول · بسقف) — واللي اتقرت مع الانتظار مابتتقريش تاني
  if (earlyRead?.text) for (const x of histRows) if (x.id === msg.id && !x.ai_media_text) x.ai_media_text = earlyRead.text;
  const todo = mediaToRead(histRows, msg.tenant_id, msg.conversation_id, msg.id).filter((x) => !(earlyRead && x.id === msg.id));
  const reads: MediaRead[] = earlyRead ? [earlyRead] : [];
  if (todo.length) {
    const got = await Promise.all(todo.map((x) => readMedia(st, msg.tenant_id, msg.conversation_id, x, !dry)));
    for (const g of got) { reads.push(g); if (g.text) for (const x of histRows) if (x.id === g.id) x.ai_media_text = g.text; }
  }
  const history: HistMsg[] = [...histRows].reverse()
    .map((x) => ({ dir: x.direction === "in" ? "in" : "out", type: x.type || "text", body: x.body, media: x.direction === "in" ? x.ai_media_text || null : null, at: x.created_at || null }));
  const sess = sessionText(history); // «المحادثة الحالية» لحارس الأوردر (من آخر رسالة لحد أول سكوت 6 ساعات)
  const triggerMedia: string | null = histRows.find((x) => x.id === msg.id)?.ai_media_text || null;

  const { data: conv } = await admin.from("wa_conversations")
    .select("id, wa_id, customer_phone, customer_name, ctwa_ad_id, ctwa_ad_body").eq("id", msg.conversation_id).eq("tenant_id", msg.tenant_id).maybeSingle();
  const forms = phoneForms(String(conv?.wa_id || conv?.customer_phone || ""));
  let orders: OrderLite[] = [];
  if (forms.length) {
    const list = forms.map((f) => `"${f}"`).join(",");
    const { data: os } = await admin.from("orders")
      .select("id, order_uid, status, product_name, var, manufacturer_note, total_cost, jt_cod_amount, created_at, cancel_requested_at, shipping_carrier, carrier_status_at, status_changed_at, tracking_no, status_log")
      .eq("tenant_id", msg.tenant_id).or(`phone.in.(${list}),alt_phone.in.(${list})`)
      .gte("created_at", new Date(Date.now() - 60 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(6);
    // deno-lint-ignore no-explicit-any
    const nowIso = new Date().toISOString();
    // deno-lint-ignore no-explicit-any
    orders = (os || []).map((o: any) => {
      const status = String(o.status || "");
      // مين لغى وإمتى — من سجل الحالة (للأوردر الملغي بس)
      const ci = status.toLowerCase() === "cancelled" ? cancelInfo(o.status_log, o.status_changed_at) : { at: null, by: null };
      const base = { status, cancelled_at: ci.at, cancelled_by: ci.by, has_tracking: !!String(o.tracking_no || "").trim() };
      return {
        id: String(o.id || ""), order_uid: String(o.order_uid || ""), product_name: String(o.product_name || ""),
        props: o.manufacturer_note || o.var || null, total: o.jt_cod_amount != null ? Number(o.jt_cod_amount) : (o.total_cost != null ? Number(o.total_cost) : null),
        created_at: o.created_at, cancel_requested: !!o.cancel_requested_at, carrier: o.shipping_carrier || null,
        status_at: o.carrier_status_at || o.status_changed_at || null,
        ...base, cancel_tag: cancelTag(base, nowIso),
      };
    });
  }
  const cv: ConvCtx = {
    adId: conv?.ctwa_ad_id || null, adBody: conv?.ctwa_ad_body || null, customerName: conv?.customer_name || null,
    orders, ordersKnown: forms.length > 0, history,
  };
  const r = await draftFor(st, cv, { type: msg.type || "text", body: msg.body, media: triggerMedia }, modelOverride || st.model);
  const mediaUse = reads.length ? reads.map((x) => ({ type: x.type, ok: !!x.text, error: x.error, ti: x.ti, to: x.to, ms: x.ms })) : null;
  if (dry) {
    // «لو الزرار ON كان هيبعت إيه» — قراية بس، من غير أي إرسال ولا كتابة
    const state = await autoState(msg.tenant_id, msg.conversation_id, r.draft?.card || null, null);
    let plan = planFor(st, r, state, msg.tenant_id).plan;
    const rstep = REACT_OK.includes(plan.reason) ? reactStepFor(r, orders) : null;
    if (rstep) plan = planFor(st, r, state, msg.tenant_id, null, reactOutcomePreview(st, rstep)).plan;
    const step = !rstep && plan.reason === "collect" ? orderStepFor(st, r, orders, state.waId || String(conv?.wa_id || ""), sess) : null;
    if (step) plan = planFor(st, r, state, msg.tenant_id, orderOutcome(st, r, step, PREVIEW_ORDER_UID)).plan;
    const auto_preview = { state_ok: state.ok, staff_active: staffActive, ...planPreview(plan), order_preview: orderPreview(step), react_preview: reactPreview(rstep) };
    const media_read = reads.map((x) => ({ id: x.id, type: x.type, text: x.text, error: x.error, ti: x.ti, to: x.to, ms: x.ms }));
    return { dry_run: true, draft: r.draft, model: r.model, layout: st.layout, esc: st.esc, tokens_in: r.tokensIn, tokens_out: r.tokensOut, tokens_cached: r.tokensCached, ms: r.ms, error: r.error, auto_preview, media_read };
  }

  if (r.draft && r.draft.behavior === "skip" && !r.model) return { skipped: "pre_rule_skip" }; // ضغطة زرار/تفاعل — مش محتاجة صف
  const cardRow = r.draft?.card ? st.cards.find((c) => c.title === r.draft!.card) : null;
  const row = {
    tenant_id: msg.tenant_id, conversation_id: msg.conversation_id, trigger_message_id: msg.id,
    intent: r.draft?.intent || null, behavior: r.draft?.behavior || "escalate",
    body: r.draft ? (r.draft.reply || null) : null,
    media: r.draft ? { card: cardRow ? { quick_reply_id: cardRow.id, title: cardRow.title } : null, note: r.draft.note || null, ...(mediaUse ? { read: mediaUse } : {}) } : null,
    model: r.model, tokens_in: r.tokensIn || null, tokens_out: r.tokensOut || null, tokens_cached: r.model ? r.tokensCached : null, latency_ms: r.ms || null,
    error: r.error ? String(r.error).slice(0, 300) : null,
  };
  // select = نعرف الصف اتدخل فعلاً ولا كان موجود (نداء مكرر) — المكرر مابيبعتش حاجة
  const { data: ins, error } = await admin.from("wa_ai_drafts").upsert(row, { onConflict: "trigger_message_id", ignoreDuplicates: true }).select("id");
  const draftId = !error && ins && ins.length ? String(ins[0].id) : null;
  // 🔴 الإرسال للعميل: الزرار ON بس (mode = 'auto') — وفي shadow مفيش أي نداء لميتا
  const auto = st.mode === "auto" && draftId ? await autoRun(msg, st, r, draftId, orders, sess) : null;
  return { drafted: !error, behavior: row.behavior, error: error ? "insert_failed" : r.error, ...(auto || {}) };
}

// ── التقييم: حالات eval-cases.ts بسياق وهمي — صفر كتابة ──────────────
// deno-lint-ignore no-explicit-any
async function runEval(from: number, to: number, modelOverride: string | null, gen?: Record<string, any>, evalRules?: string, layout?: Layout | null, cardNotes?: Record<string, unknown> | null, esc?: EscStyle | null): Promise<Record<string, unknown>> {
  const st = await loadStatic(EVAL_TENANT, EVAL_FACTS_EXTRA);
  if (!st) return { error: "no_settings" };
  if (layout) st.layout = layout;
  if (esc) st.esc = esc;
  withCardNotes(st, cardNotes || null);
  const model = modelOverride || st.model;
  const cases = EVAL_CASES.filter((c) => c[0] >= from && c[0] <= to).slice(0, EVAL_MAX);
  const now = Date.now();
  const results: Record<string, unknown>[] = [];
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const c = cases[next++];
      const [n, ctxKey, exp, text, extra, type, media] = c; // media = اللي السيستم فهمه من الفويس/الصورة (حالات 177+)
      const fx = CTX[ctxKey] || {};
      const hist: HistMsg[] = [...(fx.h || []), ...(extra || [])].map((h) => {
        const at = h.ago != null ? { at: new Date(now - h.ago * 3600000).toISOString() } : {}; // حالات 185+: الرسالة من كام ساعة (فواصل الوقت)
        if (h.card) { const k = st.allCards.find((x) => x.title === h.card); return { dir: "out", type: "image", body: k ? k.body : "[كارت " + h.card + "]", ...at } as HistMsg; }
        return { dir: h.dir, type: h.type || "text", body: h.body || "", ...at } as HistMsg;
      });
      const timed = hist.some((h) => !!h.at); // حالة فيها أوقات (ago) = الرسالة نفسها دلوقتي — غير كده نفس الشكل القديم من غير أوقات
      hist.push({ dir: "in", type: type || "text", body: text, media: media || null, ...(timed ? { at: new Date(now).toISOString() } : {}) });
      const cv: ConvCtx = {
        adId: fx.ad || null, adBody: fx.adBody || null, customerName: null, ordersKnown: true, history: hist,
        orders: (fx.orders || []).map((o) => {
          // أوردر ملغي وهمي: cancel = مين لغاه · cancel_days = من كام يوم (كسور مسموحة)
          const base = {
            status: o.status, cancelled_at: o.cancel_days != null ? new Date(now - o.cancel_days * 86400000).toISOString() : null,
            cancelled_by: o.cancel || null, has_tracking: false,
          };
          return {
            id: "eval-" + o.order_uid, order_uid: o.order_uid, product_name: o.product_name, props: o.props || null, total: o.total,
            created_at: new Date(now - o.days * 86400000 - 3600000).toISOString(),
            status_at: o.status_days != null ? new Date(now - o.status_days * 86400000).toISOString() : null,
            ...base, cancel_tag: cancelTag(base, new Date(now).toISOString()),
          };
        }),
      };
      const r = await draftFor(st, cv, { type: type || "text", body: text, media: media || null }, model, gen, evalRules);
      const want = EXPECT[exp];
      let ap = planFor(st, r, { ...NO_STATE, ok: true }, EVAL_TENANT).plan; // «لو ON» بحالة محادثة نضيفة — قرار بس، مفيش إرسال في التقييم
      const rstep = REACT_OK.includes(ap.reason) ? reactStepFor(r, cv.orders) : null; // قرار التفعيل بس — مفيش كتابة في التقييم
      if (rstep) ap = planFor(st, r, { ...NO_STATE, ok: true }, EVAL_TENANT, null, reactOutcomePreview(st, rstep)).plan;
      const step = !rstep && ap.reason === "collect" ? orderStepFor(st, r, cv.orders, EVAL_WA_ID, sessionText(hist)) : null; // قرار الأوردر بس — مفيش تسجيل في التقييم
      if (step) ap = planFor(st, r, { ...NO_STATE, ok: true }, EVAL_TENANT, orderOutcome(st, r, step, PREVIEW_ORDER_UID)).plan;
      results.push({
        n, want, got: r.draft?.behavior || null, ok: r.draft?.behavior === want, intent: r.draft?.intent || "", reply: r.draft?.reply || "",
        card: r.draft?.card || "", note: r.draft?.note || "", ms: r.ms, ti: r.tokensIn, to: r.tokensOut, tc: r.tokensCached, err: r.error,
        auto: ap.reason, auto_n: ap.actions.length, auto_esc: ap.escalate ? 1 : 0,
        order: r.draft?.order || null, order_step: orderPreview(step), reactivate: r.draft?.reactivate || null, react_step: reactPreview(rstep),
        auto_text: (step || rstep || ap.reason === "escalate") && ap.actions[0]?.kind === "text" ? ap.actions[0].body : undefined,
        auto_tag: ap.reason === "escalate" && ap.actions[0]?.kind === "text" ? ap.actions[0].tag : undefined,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(EVAL_POOL, cases.length) }, worker));
  results.sort((a, b) => Number(a.n) - Number(b.n));
  const sum = (k: string) => results.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return { model, layout: st.layout, esc: st.esc, count: results.length, pass: results.filter((r) => r.ok).length, ti: sum("ti"), to: sum("to"), tc: sum("tc"), results };
}

async function listModels(): Promise<Record<string, unknown>> {
  const key = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (!key) return { error: "no_gemini_key" };
  try {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json().catch(() => null);
    if (!res.ok) return { error: "gemini_" + res.status + ": " + String(data?.error?.message || "").slice(0, 200) };
    // deno-lint-ignore no-explicit-any
    const names = (data?.models || []).filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
      // deno-lint-ignore no-explicit-any
      .map((m: any) => String(m.name || "").replace(/^models\//, "")).filter((n: string) => n.startsWith("gemini"));
    return { ok: true, models: names };
  } catch { return { error: "gemini_fetch_error" }; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);
  // deno-lint-ignore no-explicit-any
  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const action = String(body?.action || "");
  const model = typeof body?.model === "string" && /^[\w.\-]{3,60}$/.test(body.model) ? body.model : null;
  const layout: Layout | null = body?.layout === "v1" || body?.layout === "v2" || body?.layout === "v3" ? body.layout : null;
  const cardNotes: Record<string, unknown> | null = body?.card_notes && typeof body.card_notes === "object" && !Array.isArray(body.card_notes) ? body.card_notes : null;
  const esc: EscStyle | null = body?.esc_style === "v1" || body?.esc_style === "v2" ? body.esc_style : null;
  if (action === "models") return json(await listModels());
  if (action === "eval") {
    const from = Math.max(1, Number(body?.from) || 1), to = Math.max(from, Number(body?.to) || from);
    const gen = body?.gen && typeof body.gen === "object" ? body.gen : undefined;
    const evalRules = typeof body?.rules_extra === "string" ? body.rules_extra.slice(0, 4000) : undefined;
    return json(await runEval(from, to, model, gen, evalRules, layout, cardNotes, esc));
  }

  const messageId = String(body?.message_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return json({ error: "bad_message_id" }, 400);
  const dry = body?.dry_run === true;
  if (dry) return json(await handleMessage(messageId, true, model, layout, cardNotes, esc));
  // المسار العادي: رد فوري والشغل في الخلفية (الانتظار 12ث + الموديل أطول من مهلة pg_net)
  const job = handleMessage(messageId, false, null, null, null, null).catch((e) => { console.error("wa-ai-draft", (e as Error)?.message || "error"); });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") { rt.waitUntil(job); return json({ queued: true }, 202); }
  await job;
  return json({ done: true });
});
