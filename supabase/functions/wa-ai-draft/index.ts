// wa-ai-draft — الـAI Agent بتاع الشات (shadow mode — 14 نوفمبر، طلب المالك).
// بيكتب «رد مقترح» لرسالة العميل الواردة ويخزّنه في wa_ai_drafts — والموظف يبعته/يعدّله/يرفضه من الصندوق.
//
// 🔴 الدالة دي عمرها ما بتبعت حاجة للعميل: مفيش أي نداء لميتا ولا لـwa-send هنا — الكتابة الوحيدة صف في wa_ai_drafts.
//    حتى mode='auto' بيتعامل زي 'shadow' (الإرسال التلقائي مرحلة تانية بقرار المالك).
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
// 🔴 شكل الدخل على الحي = ai_settings.facts.prompt_layout (الغايب = v1) — مش من الـbody. التحويل والرجوع بسطر إعداد بقرار المالك.
// 🔴 معلومات للـAgent (v6 — 16 نوفمبر): wa_quick_replies.ai_notes بتتحط تحت نص الكارت في الـprompt (cardBlock) — مابتتبعتش للعميل مع الكارت.
//    card_notes من الـbody للتقييم والـdry_run بس — المسار العادي بيقرا العمود وبس.
// 🔴 tokens_cached (16 نوفمبر): cachedContentTokenCount من Gemini بيتسجّل مع كل مسودة — عشان نعرف الـimplicit caching بيتطبّق فعلاً ولا لأ.
//   3) { action: "models" } — أسماء موديلات Gemini المتاحة للمفتاح (بيأكد إن المفتاح شغّال).
// التصريح: service_role أو x-diag-token (= platform_settings.jt_diag_token) — مفيش مسار للموظف (نفس wa-ofd-notify).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildSystemPrompt, buildUserPrompt, layoutOf, parseDraft, phoneForms, preRule, RESPONSE_SCHEMA, siteRowsFrom,
  type CardLite, type Draft, type DraftCtx, type HistMsg, type Layout, type OrderLite, type ProductLite, type SiteRow,
} from "../_shared/ai-draft.ts";
import { CTX, EVAL_CASES, EVAL_FACTS_EXTRA, EVAL_TENANT, EXPECT } from "./eval-cases.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEBOUNCE_MS = 12000, HISTORY_N = 20, GEMINI_TIMEOUT_MS = 40000, EVAL_MAX = 60, EVAL_POOL = 6;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-diag-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ── السياق الثابت للمتجر (قراية بس) ──────────────────────────────────
interface Static {
  mode: string; model: string; layout: Layout; facts: Record<string, unknown>;
  products: ProductLite[]; cards: CardLite[]; allCards: CardLite[]; siteRows: SiteRow[]; stockNames: string[];
  ads: Map<string, { name: string | null; productId: string | null }>;
}
async function loadStatic(tenantId: string, factsExtra?: Record<string, unknown>): Promise<Static | null> {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const [set, prods, qr, stock, site, ads] = await Promise.all([
    admin.from("ai_settings").select("mode, model, facts").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("ai_products").select("id, name, aliases, site_names, quick_reply_id, assembled, facts").eq("tenant_id", tenantId).eq("active", true),
    admin.from("wa_quick_replies").select("id, title, body, sort, ai_notes").eq("tenant_id", tenantId).order("sort", { ascending: true }),
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
  if (qr.error) qrRows = (await admin.from("wa_quick_replies").select("id, title, body, sort").eq("tenant_id", tenantId).order("sort", { ascending: true })).data;
  // deno-lint-ignore no-explicit-any
  const allCards: CardLite[] = (qrRows || []).filter((c: any) => String(c.title || "").trim() && String(c.body || "").trim())
    // deno-lint-ignore no-explicit-any
    .map((c: any) => ({ id: c.id, title: String(c.title).trim(), body: String(c.body), notes: String(c.ai_notes || "").trim() || null }));
  return {
    mode: String(set.data.mode || "off"), model: String(set.data.model || "").trim() || DEFAULT_MODEL, layout: layoutOf(facts.prompt_layout), facts,
    products: (prods.data || []) as ProductLite[],
    allCards, cards: allCards.filter((c) => !skip.includes(c.title)),
    siteRows: siteRowsFrom(site.data || []),
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
async function draftFor(st: Static, cv: ConvCtx, trigger: { type: string; body: string | null }, model: string, gen?: Record<string, any>, evalRules?: string): Promise<Result> {
  const pre = preRule(trigger.type, trigger.body);
  if (pre) return { draft: pre, model: null, tokensIn: 0, tokensOut: 0, tokensCached: 0, ms: 0, error: null };
  const ad = cv.adId ? st.ads.get(cv.adId) : null;
  const ctx: DraftCtx = {
    nowIso: new Date().toISOString(), facts: st.facts, products: st.products,
    linkedProductId: ad?.productId || null,
    ad: cv.adId ? { name: ad?.name || null, body: cv.adBody } : null,
    cards: st.cards, siteRows: st.siteRows, stockNames: st.stockNames,
    orders: cv.orders, ordersKnown: cv.ordersKnown, customerName: cv.customerName, history: cv.history,
  };
  const system = buildSystemPrompt() + (evalRules ? "\n\n# قواعد تجريبية (تقييم بس)\n" + evalRules : "");
  const g = await callGemini(model, system, buildUserPrompt(ctx, st.layout), gen);
  if (g.error) return { draft: null, model, tokensIn: 0, tokensOut: 0, tokensCached: 0, ms: g.ms, error: g.error };
  const draft = parseDraft(g.text, st.cards);
  return { draft, model, tokensIn: g.tokensIn, tokensOut: g.tokensOut, tokensCached: g.tokensCached, ms: g.ms, error: draft ? null : "bad_output" };
}

// ── المسار العادي: رسالة واردة حقيقية ───────────────────────────────
async function handleMessage(messageId: string, dry: boolean, modelOverride: string | null, layoutOverride: Layout | null, notesOverride: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const { data: msg } = await admin.from("wa_messages")
    .select("id, tenant_id, conversation_id, direction, type, body, created_at").eq("id", messageId).maybeSingle();
  if (!msg) return { skipped: "not_found" };
  if (msg.direction !== "in") return { skipped: "not_inbound" };
  const st = await loadStatic(msg.tenant_id);
  if (!st) return { skipped: "no_settings" };
  if (dry && layoutOverride) st.layout = layoutOverride; // تجربة شكل دخل تاني — dry_run بس (المسار العادي = إعداد المتجر)
  if (dry) withCardNotes(st, notesOverride);
  if (!dry && st.mode !== "shadow" && st.mode !== "auto") return { skipped: "mode_off" };
  if (!dry) await sleep(DEBOUNCE_MS);

  const { data: recent } = await admin.from("wa_messages")
    .select("id, direction, type, body, created_at").eq("tenant_id", msg.tenant_id).eq("conversation_id", msg.conversation_id)
    .order("created_at", { ascending: false }).limit(HISTORY_N + 20);
  const rows = recent || [];
  // deno-lint-ignore no-explicit-any
  const newer = rows.filter((r: any) => r.created_at > msg.created_at && r.id !== msg.id);
  if (!dry) {
    // deno-lint-ignore no-explicit-any
    if (newer.some((r: any) => r.direction === "in")) return { skipped: "superseded" }; // الرسالة الأحدث هي اللي هتعمل المسودة
    // deno-lint-ignore no-explicit-any
    if (newer.some((r: any) => r.direction === "out")) return { skipped: "answered" };  // موظف رد خلاص
  }
  // deno-lint-ignore no-explicit-any
  const history: HistMsg[] = rows.filter((r: any) => r.created_at <= msg.created_at).slice(0, HISTORY_N).reverse()
    // deno-lint-ignore no-explicit-any
    .map((r: any) => ({ dir: r.direction === "in" ? "in" : "out", type: r.type || "text", body: r.body }));

  const { data: conv } = await admin.from("wa_conversations")
    .select("id, wa_id, customer_phone, customer_name, ctwa_ad_id, ctwa_ad_body").eq("id", msg.conversation_id).eq("tenant_id", msg.tenant_id).maybeSingle();
  const forms = phoneForms(String(conv?.wa_id || conv?.customer_phone || ""));
  let orders: OrderLite[] = [];
  if (forms.length) {
    const list = forms.map((f) => `"${f}"`).join(",");
    const { data: os } = await admin.from("orders")
      .select("order_uid, status, product_name, var, manufacturer_note, total_cost, jt_cod_amount, created_at, cancel_requested_at, shipping_carrier")
      .eq("tenant_id", msg.tenant_id).or(`phone.in.(${list}),alt_phone.in.(${list})`)
      .gte("created_at", new Date(Date.now() - 60 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(4);
    // deno-lint-ignore no-explicit-any
    orders = (os || []).map((o: any) => ({
      order_uid: String(o.order_uid || ""), status: String(o.status || ""), product_name: String(o.product_name || ""),
      props: o.manufacturer_note || o.var || null, total: o.jt_cod_amount != null ? Number(o.jt_cod_amount) : (o.total_cost != null ? Number(o.total_cost) : null),
      created_at: o.created_at, cancel_requested: !!o.cancel_requested_at, carrier: o.shipping_carrier || null,
    }));
  }
  const cv: ConvCtx = {
    adId: conv?.ctwa_ad_id || null, adBody: conv?.ctwa_ad_body || null, customerName: conv?.customer_name || null,
    orders, ordersKnown: forms.length > 0, history,
  };
  const r = await draftFor(st, cv, { type: msg.type || "text", body: msg.body }, modelOverride || st.model);
  if (dry) return { dry_run: true, draft: r.draft, model: r.model, layout: st.layout, tokens_in: r.tokensIn, tokens_out: r.tokensOut, tokens_cached: r.tokensCached, ms: r.ms, error: r.error };

  if (r.draft && r.draft.behavior === "skip" && !r.model) return { skipped: "pre_rule_skip" }; // ضغطة زرار/تفاعل — مش محتاجة صف
  const cardRow = r.draft?.card ? st.cards.find((c) => c.title === r.draft!.card) : null;
  const row = {
    tenant_id: msg.tenant_id, conversation_id: msg.conversation_id, trigger_message_id: msg.id,
    intent: r.draft?.intent || null, behavior: r.draft?.behavior || "escalate",
    body: r.draft ? (r.draft.reply || null) : null,
    media: r.draft ? { card: cardRow ? { quick_reply_id: cardRow.id, title: cardRow.title } : null, note: r.draft.note || null } : null,
    model: r.model, tokens_in: r.tokensIn || null, tokens_out: r.tokensOut || null, tokens_cached: r.model ? r.tokensCached : null, latency_ms: r.ms || null,
    error: r.error ? String(r.error).slice(0, 300) : null,
  };
  const { error } = await admin.from("wa_ai_drafts").upsert(row, { onConflict: "trigger_message_id", ignoreDuplicates: true });
  return { drafted: !error, behavior: row.behavior, error: error ? "insert_failed" : r.error };
}

// ── التقييم: حالات eval-cases.ts بسياق وهمي — صفر كتابة ──────────────
// deno-lint-ignore no-explicit-any
async function runEval(from: number, to: number, modelOverride: string | null, gen?: Record<string, any>, evalRules?: string, layout?: Layout | null, cardNotes?: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const st = await loadStatic(EVAL_TENANT, EVAL_FACTS_EXTRA);
  if (!st) return { error: "no_settings" };
  if (layout) st.layout = layout;
  withCardNotes(st, cardNotes || null);
  const model = modelOverride || st.model;
  const cases = EVAL_CASES.filter((c) => c[0] >= from && c[0] <= to).slice(0, EVAL_MAX);
  const now = Date.now();
  const results: Record<string, unknown>[] = [];
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const c = cases[next++];
      const [n, ctxKey, exp, text, extra, type] = c;
      const fx = CTX[ctxKey] || {};
      const hist: HistMsg[] = [...(fx.h || []), ...(extra || [])].map((h) => {
        if (h.card) { const k = st.allCards.find((x) => x.title === h.card); return { dir: "out", type: "image", body: k ? k.body : "[كارت " + h.card + "]" } as HistMsg; }
        return { dir: h.dir, type: h.type || "text", body: h.body || "" } as HistMsg;
      });
      hist.push({ dir: "in", type: type || "text", body: text });
      const cv: ConvCtx = {
        adId: fx.ad || null, adBody: fx.adBody || null, customerName: null, ordersKnown: true, history: hist,
        orders: (fx.orders || []).map((o) => ({
          order_uid: o.order_uid, status: o.status, product_name: o.product_name, props: o.props || null, total: o.total,
          created_at: new Date(now - o.days * 86400000 - 3600000).toISOString(),
        })),
      };
      const r = await draftFor(st, cv, { type: type || "text", body: text }, model, gen, evalRules);
      const want = EXPECT[exp];
      results.push({
        n, want, got: r.draft?.behavior || null, ok: r.draft?.behavior === want, intent: r.draft?.intent || "", reply: r.draft?.reply || "",
        card: r.draft?.card || "", note: r.draft?.note || "", ms: r.ms, ti: r.tokensIn, to: r.tokensOut, tc: r.tokensCached, err: r.error,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(EVAL_POOL, cases.length) }, worker));
  results.sort((a, b) => Number(a.n) - Number(b.n));
  const sum = (k: string) => results.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return { model, layout: st.layout, count: results.length, pass: results.filter((r) => r.ok).length, ti: sum("ti"), to: sum("to"), tc: sum("tc"), results };
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
  if (action === "models") return json(await listModels());
  if (action === "eval") {
    const from = Math.max(1, Number(body?.from) || 1), to = Math.max(from, Number(body?.to) || from);
    const gen = body?.gen && typeof body.gen === "object" ? body.gen : undefined;
    const evalRules = typeof body?.rules_extra === "string" ? body.rules_extra.slice(0, 4000) : undefined;
    return json(await runEval(from, to, model, gen, evalRules, layout, cardNotes));
  }

  const messageId = String(body?.message_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return json({ error: "bad_message_id" }, 400);
  const dry = body?.dry_run === true;
  if (dry) return json(await handleMessage(messageId, true, model, layout, cardNotes));
  // المسار العادي: رد فوري والشغل في الخلفية (الانتظار 12ث + الموديل أطول من مهلة pg_net)
  const job = handleMessage(messageId, false, null, null, null).catch((e) => { console.error("wa-ai-draft", (e as Error)?.message || "error"); });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") { rt.waitUntil(job); return json({ queued: true }, 202); }
  await job;
  return json({ done: true });
});
