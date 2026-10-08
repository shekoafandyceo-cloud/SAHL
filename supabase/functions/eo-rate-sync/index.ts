// eo-rate-sync — سحب «نسبة استلام العميل» من EasyOrders للأوردرات اللي الويبهوك وصّلها من غيرها (8 أكتوبر).
//
// 🔴 ليه: EasyOrders بتحسب التقييم وتكتبه على الأوردر عندها بعد ~0.3–0.5ث من إنشائه، والويبهوك بيتبني
// لحظة الإنشاء — سباق خسرناه في 8 من أول 9 أوردرات. الـAPI العام بيرجّع الأوردر بالـmetadata كاملة
// (`metadata[phone] = {rate_result, delivery_rate_status, order_delivery_rate_id}`) — اتقاس على العشرة.
//
// المسار: pg_cron (كل دقيقتين، بس لو فيه مرشّحين) → هنا → لكل مرشّح:
//   GET https://api.easy-orders.net/api/v1/external-apps/orders/short/<order_uid>  (Api-Key · orders:read)
//   → eo_rate_apply_v1(order_id, metadata) — بتدمج الـmetadata وتريجر trg_eo_rate_capture بيحسب eo_rate.
// قراية بس من EasyOrders — مفيش ولا نداء بيغيّر حاجة عندهم.
//
// الحمولة: { limit?: 1..30, order_uids?: string[], dry_run?: boolean }
//   • من غير order_uids = المرشّحين من eo_rate_candidates_v1 (45ث–24 ساعة · ≤5 محاولات كل 10 دقايق).
//   • order_uids = أوردرات بعينها (اختبار/ملء قديم بقرار المالك) — من غير شرط الوقت ولا العدد.
//   • dry_run = بيقرا من EasyOrders وبيرجّع اللي لقاه **من غير أي كتابة** (ولا حتى سجل محاولة).
// التصريح: service_role أو x-diag-token (= platform_settings.jt_diag_token) — مفيش مسار للموظف.
// المفتاح من الـVault (`eo_api_key:<tenant_id>` عبر eo_api_keys_v1) — عمره ما بيتطبع ولا بيرجع في رد.
// الرد مافيهوش أرقام تليفونات (مفاتيح الـmetadata) — رقم الأوردر والتقييم بس.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const EO_ORDER_BY_SHORT = "https://api.easy-orders.net/api/v1/external-apps/orders/short/";
const MAX_PER_RUN = 30;   // سقف EasyOrders 40 طلب/دقيقة، والـcron كل دقيقتين = ≤15 في الدقيقة
const FETCH_TIMEOUT_MS = 10000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-diag-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function authorized(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token && SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true;
  const diag = (req.headers.get("x-diag-token") || "").trim();
  if (!diag) return false;
  const { data: row } = await admin.from("platform_settings").select("value").eq("key", "jt_diag_token").maybeSingle();
  const expected = String(row?.value || "").trim();
  return expected.length >= 24 && diag === expected;
}

// سجل التشغيل — فشله مايوقفش السحب. وبينضّف: التشغيلات > 14 يوم · المحاولات > 3 أيام (بره نافذة الـ24 ساعة).
async function logRun(ok: boolean, candidates: number, tally: Record<string, number>, error: string | null) {
  try {
    await admin.from("eo_sync_runs").insert({ ok, candidates, tally, error: error ? error.slice(0, 500) : null });
    await admin.from("eo_sync_runs").delete().lt("ran_at", new Date(Date.now() - 14 * 86400000).toISOString());
    await admin.from("eo_rate_checks").delete().lt("last_at", new Date(Date.now() - 3 * 86400000).toISOString());
  } catch { /* السجل مش أهم من السحب */ }
}

type Cand = { order_id: string; tenant_id: string; order_uid: string };

// تلخيص التقييمات اللي رجعت من غير ما نرجّع أرقام التليفونات نفسها (مفاتيح الـmetadata)
function rateSummary(meta: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (k === "tracking" || !v || typeof v !== "object") continue;
    // deno-lint-ignore no-explicit-any
    const o = v as any;
    out.push(String(o.rate_result ?? "?") + "/" + String(o.delivery_rate_status ?? "?"));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const limit = Math.max(1, Math.min(MAX_PER_RUN, Number(body?.limit) || MAX_PER_RUN));
  const dry = body?.dry_run === true;

  const { data: keys, error: kErr } = await admin.rpc("eo_api_keys_v1");
  if (kErr) return json({ error: "keys_failed", message: kErr.message }, 500);
  const keyByTenant = new Map<string, string>();
  for (const k of (keys || []) as Array<{ tenant_id: string; api_key: string }>) {
    if (k?.tenant_id && k?.api_key) keyByTenant.set(String(k.tenant_id), String(k.api_key));
  }
  if (!keyByTenant.size) {
    if (!dry) await logRun(false, 0, {}, "no_api_key");
    return json({ ok: false, error: "no_api_key" }, 200);
  }

  let cands: Cand[] = [];
  const explicit = Array.isArray(body?.order_uids)
    ? body.order_uids.map((x: unknown) => String(x ?? "").trim()).filter((x: string) => /^[0-9]+$/.test(x)).slice(0, limit)
    : [];
  if (explicit.length) {
    const { data, error } = await admin.from("orders").select("id, tenant_id, order_uid")
      .in("order_uid", explicit).in("tenant_id", [...keyByTenant.keys()]);
    if (error) return json({ error: "orders_failed", message: error.message }, 500);
    cands = (data || []).map((r: { id: string; tenant_id: string; order_uid: string }) =>
      ({ order_id: r.id, tenant_id: r.tenant_id, order_uid: r.order_uid }));
  } else {
    const { data, error } = await admin.rpc("eo_rate_candidates_v1", { p_limit: limit });
    if (error) { if (!dry) await logRun(false, 0, {}, "candidates_failed: " + error.message); return json({ error: "candidates_failed", message: error.message }, 500); }
    cands = (data || []) as Cand[];
  }

  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
  const results: Array<Record<string, unknown>> = [];
  let fatal: string | null = null;

  // محاولة فشلت = بتتسجّل (بتستهلك واحدة من الـ5) — إلا في dry_run
  const mark = async (c: Cand, note: string) => {
    bump(note);
    results.push({ order_uid: c.order_uid, note });
    if (!dry) { try { await admin.rpc("eo_rate_apply_v1", { p_order_id: c.order_id, p_meta: null, p_note: note }); } catch { /* */ } }
  };

  for (const c of cands) {
    const key = keyByTenant.get(String(c.tenant_id));
    if (!key) { bump("no_key_for_tenant"); continue; }
    let res: Response;
    try {
      res = await fetch(EO_ORDER_BY_SHORT + encodeURIComponent(c.order_uid), {
        headers: { "Api-Key": key, "Accept": "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (_e) { await mark(c, "fetch_error"); continue; }

    if (res.status === 429) { bump("rate_limited"); await res.body?.cancel(); break; }   // ماتستهلكش محاولات — الدورة الجاية
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // المفتاح نفسه مرفوض («Api-Key not found» = 400) — وقف التشغيل كله ومتحرقش محاولات الأوردرات
      const t = (await res.text().catch(() => "")).slice(0, 200);
      fatal = "auth_" + res.status + (t ? ": " + t : "");
      bump("auth_error");
      break;
    }
    if (res.status === 404) { await res.body?.cancel(); await mark(c, "not_found"); continue; }
    if (!res.ok) { await res.body?.cancel(); await mark(c, "http_" + res.status); continue; }

    // deno-lint-ignore no-explicit-any
    let j: any = null;
    try { j = await res.json(); } catch { await mark(c, "bad_json"); continue; }
    if (String(j?.short_id ?? "") !== String(c.order_uid)) { await mark(c, "short_id_mismatch"); continue; }
    const meta = j?.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) { await mark(c, "no_meta"); continue; }

    if (dry) {
      bump("dry_read");
      results.push({ order_uid: c.order_uid, note: "dry_read", rates: rateSummary(meta) });
      continue;
    }
    const { data: r, error: aErr } = await admin.rpc("eo_rate_apply_v1", { p_order_id: c.order_id, p_meta: meta, p_note: null });
    if (aErr) { bump("apply_error"); results.push({ order_uid: c.order_uid, note: "apply_error", message: aErr.message }); continue; }
    // deno-lint-ignore no-explicit-any
    const rr = (r || {}) as any;
    bump(String(rr.note || "applied"));
    results.push({ order_uid: c.order_uid, note: rr.note, eo_rate: rr.eo_rate ?? null, eo_rate_alt: rr.eo_rate_alt ?? null });
  }

  if (!dry) await logRun(!fatal, cands.length, tally, fatal);
  return json({ ok: !fatal, dry_run: dry, candidates: cands.length, tally, results, error: fatal }, 200);
});
