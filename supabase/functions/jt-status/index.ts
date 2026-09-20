// jt-status — استقبال الـcallbacks التلاتة من J&T (مفيش JWT — J&T بتنده مباشرة):
//   POST /jt-status/trace       ← logistics/statusFeedback   (تحديثات التتبع — بديل BOSTA_WEBHOOK)
//   POST /jt-status/order       ← orderserve/statusFeedback  (اتوزّع/اتلمّ/اتاخد/اتلغى + الوزن)
//   POST /jt-status/settlement  ← other/settlementReturn     (الفاتورة بعد المراجعة = real_shipping_fee المؤكد)
//
// 🔴 التحقق: الهيدر digest = Base64(MD5(bizContent + privateKey)) بمفتاحنا. مش موقّع = 401 ومفيش أي كتابة.
// كل حمولة بتتسجّل خام في jt_events (idempotent بالـhash) **قبل** التطبيق — لو التطبيق فشل الخام موجود.
// الحالة بتتغيّر بس لو scanTypeCode له خريطة في jt_status_map (فاضية لحد أول حمولة حقيقية — متثبتش عقد بالتخمين).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { md5Hex } from "../_shared/md5.ts";
import { verifyCallbackDigest } from "../_shared/jt.ts";
import { callbackKeys } from "../_shared/jt-runtime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function reply(code: string, msg: string, status = 200, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ code, msg, data: null, ...extra }), { status, headers: { "Content-Type": "application/json" } });
}

/** "2026-09-20 10:26:15" (توقيت مصر عند J&T) → ISO. لو الشكل مختلف نرجّع null ونسجّل الخام. */
function parseJtTime(s: unknown): string | null {
  const t = String(s || "").trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) { const d = new Date(t); return isNaN(d.getTime()) ? null : d.toISOString(); }
  // مصر UTC+3 صيفاً / +2 شتاءً — J&T مصر بتبعت بالتوقيت المحلي (مش موثّق؛ الخام محفوظ لو طلع غير كده)
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const d = new Date(utc);
  const cairoOffsetMin = (() => {
    // DST مصر (من 2023): آخر جمعة في أبريل → آخر خميس في أكتوبر
    const y = d.getUTCFullYear();
    const lastFriApr = new Date(Date.UTC(y, 3, 30)); while (lastFriApr.getUTCDay() !== 5) lastFriApr.setUTCDate(lastFriApr.getUTCDate() - 1);
    const lastThuOct = new Date(Date.UTC(y, 9, 31)); while (lastThuOct.getUTCDay() !== 4) lastThuOct.setUTCDate(lastThuOct.getUTCDate() - 1);
    return d >= lastFriApr && d < lastThuOct ? 180 : 120;
  })();
  return new Date(utc - cairoOffsetMin * 60000).toISOString();
}

async function readBiz(req: Request): Promise<string> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const text = await req.text();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const p = new URLSearchParams(text);
    return p.get("bizContent") || "";
  }
  // JSON مباشر أو {bizContent: "..."} أو form من غير content-type صح
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object" && typeof j.bizContent === "string") return j.bizContent;
    return text;
  } catch {
    const p = new URLSearchParams(text);
    return p.get("bizContent") || text;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return reply("1", "jt-status up");
  if (req.method !== "POST") return reply("0", "POST only", 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply("0", "server config", 500);

  const url = new URL(req.url);
  const seg = url.pathname.replace(/\/+$/, "").split("/").pop() || "";
  const kind = (["trace", "order", "settlement"].includes(seg) ? seg : (url.searchParams.get("kind") || "unknown")) as "trace" | "order" | "settlement" | "unknown";

  const bizContent = await readBiz(req);
  const digest = req.headers.get("digest") || "";
  const keys = await callbackKeys(admin);
  const digestOk = keys.length > 0 && keys.some((k) => verifyCallbackDigest(bizContent, digest, k));

  let payload: Record<string, unknown> = {};
  try { const p = JSON.parse(bizContent); if (p && typeof p === "object") payload = p; } catch { payload = { _raw: bizContent.slice(0, 4000) }; }

  const billCode = String(payload.billCode || payload.waybillNo || payload.waybillCode || "").trim() || null;
  const txlogisticId = String(payload.txlogisticId || "").trim() || null;
  const hash = md5Hex(kind + "|" + bizContent);

  // الخام الأول — حتى لو التوقيع غلط (بيتسجّل digest_ok=false ومابيتطبّقش)
  const { data: ev, error: evErr } = await admin.from("jt_events")
    .insert({ kind: kind === "unknown" ? "unknown" : kind, bill_code: billCode, txlogistic_id: txlogisticId, payload, payload_hash: hash, digest_ok: digestOk })
    .select("id").maybeSingle();
  if (evErr && !/duplicate|unique/i.test(evErr.message)) return reply("0", "db: " + evErr.message, 500);
  if (!ev) return reply("1", "duplicate — already received");           // نفس الحمولة وصلت قبل كده
  if (!digestOk) return reply("0", "bad digest", 401);
  if (kind === "unknown") { await admin.from("jt_events").update({ apply_note: "unknown kind" }).eq("id", ev.id); return reply("1", "stored"); }

  const notes: string[] = [];
  let orderId: string | null = null, tenantId: string | null = null;
  try {
    if (kind === "trace") {
      const details = Array.isArray(payload.details) ? payload.details as Record<string, unknown>[] : [];
      const bc = billCode || (details[0] && String(details[0].billCode || "")) || "";
      const sorted = [...details].sort((a, b) => String(a.scanTime || "").localeCompare(String(b.scanTime || "")));
      for (const d of sorted) {
        const { data: r } = await admin.rpc("jt_apply_trace_v1", {
          p_bill_code: String(d.billCode || bc), p_scan_type: String(d.scanType || ""), p_scan_code: String(d.scanTypeCode ?? ""),
          p_scan_at: parseJtTime(d.scanTime), p_desc: String(d.desc || d.probleDescription || "") });
        notes.push(String(r?.note || "?")); if (r?.order_id) orderId = String(r.order_id);
      }
      if (!details.length) notes.push("no details");
    } else if (kind === "order") {
      const scanType = String(payload.scanType || "");
      const w = Number(payload.weight ?? payload.Weight);
      const { data: r } = await admin.rpc("jt_apply_trace_v1", {
        p_bill_code: billCode || "", p_scan_type: "order:" + scanType, p_scan_code: "order:" + scanType,
        p_scan_at: parseJtTime(payload.time), p_desc: String(payload.reason || "") });
      notes.push(String(r?.note || "?")); if (r?.order_id) orderId = String(r.order_id);
      if (orderId && w > 0) await admin.from("orders").update({ shipping_weight_kg: w }).eq("id", orderId);
      // مفيش billCode لسه (أوردر اتوزّع قبل الطباعة) → نربط بالـtxlogisticId
      if (!orderId && txlogisticId) {
        const { data: o } = await admin.from("orders").select("id").eq("id", txlogisticId).maybeSingle();
        if (o) { orderId = o.id; await admin.from("orders").update({ carrier_status_raw: "order:" + scanType, carrier_status_at: parseJtTime(payload.time) || new Date().toISOString() }).eq("id", o.id); notes.push("linked_by_txlogisticId"); }
      }
    } else if (kind === "settlement") {
      const { data: r } = await admin.rpc("jt_apply_settlement_v1", {
        p_bill_code: billCode || "", p_total_freight: Number(payload.totalFreight), p_charge_weight: Number(payload.packageChargeWeight) || null });
      notes.push(String(r?.note || (r?.ok ? "applied" : "?"))); if (r?.order_id) orderId = String(r.order_id);
    }
    if (orderId) {
      const { data: o } = await admin.from("orders").select("tenant_id").eq("id", orderId).maybeSingle();
      tenantId = o?.tenant_id || null;
    }
    await admin.from("jt_events").update({ applied: true, apply_note: notes.join(","), order_id: orderId, tenant_id: tenantId }).eq("id", ev.id);
  } catch (e) {
    await admin.from("jt_events").update({ applied: false, apply_note: "error: " + String((e as Error).message || e) }).eq("id", ev.id);
    return reply("0", "apply failed", 500);
  }
  return reply("1", "success");
});
