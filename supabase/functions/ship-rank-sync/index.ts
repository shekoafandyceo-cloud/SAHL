// ship-rank-sync — «نسبة استلام العميل من شركة الشحن» من بوسطة **من غير أي شحنة** (10 أكتوبر — طلب المالك).
//
// المالك اقترح أوردر وهمي على أكونت بوسطة قديم عشان ناخد النسبة. مش محتاجينه: بوسطة عندها lookup بالتليفون
// (`POST /api/v2/consignee/ranking` — من كود البلجن الرسمي bosta-woocommerce، بيتنادى لحظة الـcheckout قبل أي
// شحنة). قراية بس — مفيش ولا نداء بيعمل حاجة عندهم. ⚠️ مش في الـOpenAPI العام = ممكن يتغيّر من غير إشعار.
//
// اللي اتقاس 10 أكتوبر (pg_net · مفتاح الأكونت القديم):
//   • الحمولة `{"phoneNumbers":["+201xxxxxxxxx", …]}` — **سقف 50 رقم** (100 = `400 errorCode 777`).
//   • الرد `data.consigneesRanking[] = {consigneePhone, deliveredDeliveriesCount, returnedDeliveriesCount,
//     deliverySuccessRate}` — والرقم اللي بوسطة ماتعرفوش **مابيرجعش خالص** (45 من 50 رجعوا).
//   • النسبة = اتسلم ÷ (اتسلم + رجع) على شبكة بوسطة كلها — 48 من 48 صف طابقوا المعادلة.
//
// المسار: pg_cron (كل دقيقتين، بس لو فيه مرشّحين) → هنا → ship_rank_candidates_v1 (≤25 أوردر = ≤50 رقم:
// الأساسي + الإضافي) → نداء واحد لبوسطة → ship_rank_apply_v1 (دفعة واحدة). التطبيع والحساب في SQL بس.
//
// الحمولة: { order_uids?: string[] (≤100), dry_run?: boolean }
//   • من غير order_uids = المرشّحين (آخر 24 ساعة اللي ماتسألتش، أو التليفون اتعدّل بعد السؤال).
//   • order_uids = أوردرات بعينها (ملء القديم بقرار المالك) — دفعات 25 ورا بعض بفاصل ثانية ونص.
//   • dry_run = بيسأل بوسطة وبيرجّع العدّ بس **من غير أي كتابة** (ولا سجل تشغيل).
// التصريح: service_role أو x-diag-token (= platform_settings.jt_diag_token) — مفيش مسار للموظف.
// المفتاح من الـVault (`bosta_rank_key:<tenant_id>`) — عمره ما بيتطبع ولا بيرجع في رد. والرد مافيهوش أرقام تليفونات.
// 🔴 اللي بيتبعت لبوسطة رقم التليفون بس — من غير اسم ولا عنوان ولا مبلغ (موافقة المالك 10 أكتوبر).
// أي رد غير 200 سليم = **مفيش كتابة** والتشغيل بيقف (ok=false في ship_rank_runs) — الدورة الجاية تحاول تاني.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const BOSTA_RANKING = "https://app.bosta.co/api/v2/consignee/ranking";
const MAX_PHONES = 50;        // سقف بوسطة (اتقاس)
const MAX_ORDERS = 25;        // = سقف ship_rank_candidates_v1 → ≤50 رقم (أساسي + إضافي)
const MAX_UIDS = 100;
const FETCH_TIMEOUT_MS = 15000;
const BATCH_PAUSE_MS = 1500;
// ردّ فاضي على دفعة كبيرة = مش طبيعي (45 من 50 رجعوا في القياس) → وقف من غير كتابة بدل ما نعلّم الكل «عميل جديد»
const EMPTY_SUSPICIOUS_AT = 10;

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

async function logRun(ok: boolean, candidates: number, tally: Record<string, number>, error: string | null) {
  try {
    await admin.from("ship_rank_runs").insert({ ok, candidates, tally, error: error ? error.slice(0, 500) : null });
    await admin.from("ship_rank_runs").delete().lt("ran_at", new Date(Date.now() - 14 * 86400000).toISOString());
  } catch { /* السجل مش أهم من السحب */ }
}

type Cand = { order_id: string; tenant_id: string; order_uid: string; p10: string; alt10: string | null };
type Row = Record<string, unknown>;

const last10 = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);

// نداء واحد لبوسطة لدفعة أوردرات (متجر واحد). بيرجّع خريطة آخر-10-أرقام → الصف، أو سبب الوقف.
async function lookup(key: string, phones: string[]): Promise<{ map?: Map<string, Row>; stop?: string }> {
  let res: Response;
  try {
    res = await fetch(BOSTA_RANKING, {
      method: "POST",
      headers: { "authorization": key, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ phoneNumbers: phones.map((p) => "+20" + p) }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (_e) { return { stop: "fetch_error" }; }
  if (res.status === 429) { await res.body?.cancel(); return { stop: "rate_limited" }; }
  if (res.status === 401 || res.status === 403) { await res.body?.cancel(); return { stop: "auth_" + res.status }; }
  if (res.status >= 500) { await res.body?.cancel(); return { stop: "http_" + res.status }; }
  // deno-lint-ignore no-explicit-any
  let j: any = null;
  try { j = await res.json(); } catch { return { stop: "bad_json_" + res.status }; }
  if (!res.ok) {
    // 400 = تحقق (سقف الـ50 مثلاً) — الرسالة بتاعتهم مافيهاش أرقام، بس بتتقص احتياطاً
    const msg = String(j?.message ?? "").replace(/\d{6,}/g, "#").slice(0, 120);
    return { stop: "http_" + res.status + (j?.errorCode ? "_" + j.errorCode : "") + (msg ? ": " + msg : "") };
  }
  const arr = j?.data?.consigneesRanking;
  if (j?.success !== true || !Array.isArray(arr)) return { stop: "bad_response" };
  if (!arr.length && phones.length >= EMPTY_SUSPICIOUS_AT) return { stop: "empty_response" };
  const wanted = new Set(phones);
  const map = new Map<string, Row>();
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const k = last10((r as Row).consigneePhone);
    if (k.length === 10 && wanted.has(k) && !map.has(k)) map.set(k, r as Row);
  }
  return { map };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const dry = body?.dry_run === true;

  const { data: keys, error: kErr } = await admin.rpc("ship_rank_keys_v1");
  if (kErr) return json({ error: "keys_failed", message: kErr.message }, 500);
  const keyByTenant = new Map<string, string>();
  for (const k of (keys || []) as Array<{ tenant_id: string; api_key: string }>) {
    if (k?.tenant_id && k?.api_key) keyByTenant.set(String(k.tenant_id), String(k.api_key));
  }
  if (!keyByTenant.size) {
    if (!dry) await logRun(false, 0, {}, "no_api_key");
    return json({ ok: false, error: "no_api_key" }, 200);
  }

  // الدفعات: كل دفعة ≤25 أوردر من ship_rank_candidates_v1 (التطبيع والفلترة هناك)
  const uids: string[] = Array.isArray(body?.order_uids)
    ? [...new Set(body.order_uids.map((x: unknown) => String(x ?? "").trim()).filter((x: string) => /^[A-Za-z0-9-]{1,40}$/.test(x)))].slice(0, MAX_UIDS) as string[]
    : [];
  const uidChunks: Array<string[] | null> = [];
  if (uids.length) for (let i = 0; i < uids.length; i += MAX_ORDERS) uidChunks.push(uids.slice(i, i + MAX_ORDERS));
  else uidChunks.push(null);

  const tally: Record<string, number> = {};
  const add = (k: string, n = 1) => { tally[k] = (tally[k] || 0) + n; };
  let candidates = 0;
  let stop: string | null = null;
  let answered = 0;

  outer:
  for (let ci = 0; ci < uidChunks.length; ci++) {
    if (ci > 0) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    const { data, error } = await admin.rpc("ship_rank_candidates_v1", { p_limit: MAX_ORDERS, p_uids: uidChunks[ci] });
    if (error) { stop = "candidates_failed: " + error.message; break; }
    const cands = (data || []) as Cand[];
    candidates += cands.length;

    // متجر واحد في النداء (المفتاح بتاعه)
    const byTenant = new Map<string, Cand[]>();
    for (const c of cands) {
      if (!keyByTenant.has(String(c.tenant_id))) { add("no_key_for_tenant"); continue; }
      const a = byTenant.get(String(c.tenant_id)) || [];
      a.push(c); byTenant.set(String(c.tenant_id), a);
    }
    for (const [tenant, list] of byTenant) {
      const phones: string[] = [];
      for (const c of list) for (const p of [c.p10, c.alt10]) if (p && !phones.includes(p)) phones.push(p);
      if (!phones.length) continue;
      if (phones.length > MAX_PHONES) { stop = "too_many_phones"; break outer; }   // مستحيل بالسقفين — حارس
      const r = await lookup(keyByTenant.get(tenant)!, phones);
      if (r.stop) { stop = r.stop; break outer; }
      answered++;
      const map = r.map!;
      add("phones_asked", phones.length);
      add("phones_known", map.size);
      const items = list.map((c) => ({
        order_id: c.order_id, p10: c.p10, alt10: c.alt10,
        primary: map.get(c.p10) ?? null,
        alt: c.alt10 ? (map.get(c.alt10) ?? null) : null,
      }));
      if (dry) { add("dry_orders", items.length); continue; }
      const { data: ar, error: aErr } = await admin.rpc("ship_rank_apply_v1", { p_items: items });
      if (aErr) { stop = "apply_failed: " + aErr.message; break outer; }
      // deno-lint-ignore no-explicit-any
      const t = ((ar as any)?.tally || {}) as Record<string, number>;
      for (const [k, v] of Object.entries(t)) add(k, Number(v) || 0);
    }
  }

  const runError = stop || (candidates > 0 && answered === 0 && !tally.no_key_for_tenant ? "no_answer" : null);
  if (!dry) await logRun(!runError, candidates, tally, runError);
  return json({ ok: !runError, dry_run: dry, candidates, tally, error: runError }, 200);
});
