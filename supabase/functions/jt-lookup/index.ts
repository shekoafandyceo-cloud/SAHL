// jt-lookup — استعلامات J&T (قراءة/تقدير/اشتراك) + مزامنة نطاق الخدمة (PCA).
//
// مفيش أي إنشاء شحنة من هنا في الإنتاج — `raw` بيقدر ينده مسار إنشاء في
// الـSandbox بس (للتحقق من الحمولة قبل أول شحنة حقيقية).
//
// الحمولة: { action, env?, ...params }
//   config        → حالة الإعداد (من غير أسرار): البيئة · هل الأسرار موجودة · حقول addOrder · عدد PCA
//   pca_sync      → online/pca (type 4) → upsert في jt_pca
//   query         → order/getOrders { command (1|2), serialNumber[] }
//   trace         → logistics/trace { billCodes[] ≤30 }
//   waybill_info  → waybill/getWaybillInfo { waybillNos[] }
//   freight       → spmComCost/getComCost { sender, receiver, weight }
//   subscribe     → trace/subscribe { waybillCodes[], traceNode? }
//   raw           → (diag/service بس) { path, biz } — الإنشاء مسموح في sandbox بس
//
// env: الموظف دايماً على البيئة الافتراضية (JT_ENV). diag/service يقدروا يطلبوا sandbox.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildRequest, isCreateEndpoint, JT_PATHS, jtCall, redactRequest, withBusinessDigest } from "../_shared/jt.ts";
import { authCaller, cors, defaultEnv, envStatus, json, loadJtConfig } from "../_shared/jt-runtime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const ADDORDER_FIELDS = ["expressType", "deliveryType", "goodsType", "operateType", "payType", "serviceType"];

function asStrArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

// deno-lint-ignore no-explicit-any
function flattenPca(data: any): Array<{ prov: string; city: string; area: string; raw: unknown }> {
  // الرد الحقيقي مش موثّق بالشكل — بنقبل: مصفوفة مسطّحة {prov,city,area} · object واحد ·
  // أو شجرة متداخلة (prov → cities → areas) بأسماء حقول شائعة.
  const out: Array<{ prov: string; city: string; area: string; raw: unknown }> = [];
  const push = (p: unknown, c: unknown, a: unknown, raw: unknown) => {
    const prov = String(p || "").trim(), city = String(c || "").trim(), area = String(a || "").trim();
    if (prov && city && area) out.push({ prov, city, area, raw });
  };
  const walk = (node: unknown, ctx: { prov?: string; city?: string }) => {
    if (!node) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, ctx); return; }
    if (typeof node !== "object") return;
    // deno-lint-ignore no-explicit-any
    const o = node as any;
    if (o.prov != null && o.city != null && o.area != null) { push(o.prov, o.city, o.area, o); return; }
    const name = o.name ?? o.areaName ?? o.cityName ?? o.provName ?? o.provinceName;
    const children = o.children ?? o.cities ?? o.areas ?? o.list ?? o.city ?? o.area;
    if (ctx.prov == null) { if (Array.isArray(children)) walk(children, { prov: String(o.prov ?? name ?? "") }); return; }
    if (ctx.city == null) { if (Array.isArray(children)) walk(children, { prov: ctx.prov, city: String(o.city ?? name ?? "") }); return; }
    push(ctx.prov, ctx.city, o.area ?? name, o);
  };
  walk(data, {});
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method", message: "POST بس" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "config", message: "إعدادات السيرفر ناقصة" }, 500);

  const caller = await authCaller(req, admin, SERVICE_ROLE_KEY);
  if (caller instanceof Response) return caller;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* فاضي */ }
  const action = String(body.action || "").trim();
  const privileged = caller.mode !== "user";
  const env = privileged && String(body.env || "") === "sandbox" ? "sandbox" : defaultEnv();

  if (action === "config") {
    const st = envStatus();
    const { data: f } = await admin.from("platform_settings").select("value").eq("key", "jt_addorder_fields").maybeSingle();
    let fields: Record<string, string> | null = null;
    try { fields = f?.value ? JSON.parse(f.value) : null; } catch { fields = null; }
    const missing = ADDORDER_FIELDS.filter((k) => !(fields && String(fields[k] ?? "").trim()));
    const { data: pe } = await admin.from("platform_settings").select("value").eq("key", "jt_production_enabled").maybeSingle();
    const { count } = await admin.from("jt_pca").select("id", { count: "exact", head: true });
    const { count: aliases } = await admin.from("jt_pca_alias").select("id", { count: "exact", head: true });
    return json({
      ok: true, caller: caller.mode, env: st.env, creds_production: st.production, creds_sandbox: st.sandbox,
      production_enabled: (pe?.value || "") === "true",
      addorder_fields_present: ADDORDER_FIELDS.filter((k) => !missing.includes(k)), addorder_fields_missing: missing,
      pca_rows: count ?? 0, alias_rows: aliases ?? 0,
    });
  }

  const cfg = loadJtConfig(env);
  if (!cfg) return json({ error: "no_creds", message: "أسرار J&T (" + env + ") مش متسجّلة في الـEdge Function secrets" }, 422);
  const creds = cfg.creds;
  let path = "", biz: Record<string, unknown> = {};

  if (action === "pca_sync") {
    path = JT_PATHS.pca; biz = withBusinessDigest({ type: "4" }, creds);
  } else if (action === "query") {
    const sn = asStrArr(body.serialNumber);
    if (!sn.length) return json({ error: "bad_request", message: "serialNumber ناقص" }, 400);
    const command = Number(body.command || 2);
    path = JT_PATHS.getOrders; biz = withBusinessDigest({ command, serialNumber: sn }, creds);
  } else if (action === "trace") {
    const codes = asStrArr(body.billCodes);
    if (!codes.length || codes.length > 30) return json({ error: "bad_request", message: "billCodes: 1–30" }, 400);
    path = JT_PATHS.trace; biz = withBusinessDigest({ billCodes: codes.join(",") }, creds);
  } else if (action === "waybill_info") {
    const codes = asStrArr(body.waybillNos);
    if (!codes.length) return json({ error: "bad_request", message: "waybillNos ناقص" }, 400);
    path = JT_PATHS.getWaybillInfo; biz = withBusinessDigest({ waybillNos: codes }, creds);
  } else if (action === "freight") {
    path = JT_PATHS.freightEstimate;
    biz = withBusinessDigest({ sender: body.sender, receiver: body.receiver, weight: String(body.weight || "1") }, creds);
  } else if (action === "subscribe") {
    const codes = asStrArr(body.waybillCodes);
    if (!codes.length) return json({ error: "bad_request", message: "waybillCodes ناقص" }, 400);
    const node = String(body.traceNode || "1&3&4&5&6&8&9&10&11&12&13&14&15");
    path = JT_PATHS.subscribe;
    biz = withBusinessDigest({ id: String(creds.apiAccount), list: codes.map((waybillCode) => ({ traceNode: node, waybillCode })) }, creds);
  } else if (action === "raw") {
    if (!privileged) return json({ error: "forbidden", message: "raw للتشخيص بس" }, 403);
    path = String(body.path || "");
    const b = (body.biz && typeof body.biz === "object") ? body.biz as Record<string, unknown> : null;
    if (!path || !b) return json({ error: "bad_request", message: "path + biz" }, 400);
    if (isCreateEndpoint(path) && env !== "sandbox") return json({ error: "forbidden", message: "الإنشاء من هنا في الـSandbox بس" }, 403);
    biz = body.no_biz_digest === true ? b : withBusinessDigest(b, creds);
  } else {
    return json({ error: "bad_request", message: "action مش معروف" }, 400);
  }

  if (body.dry_run === true) {
    return json({ ok: true, dry_run: true, env, request: redactRequest(buildRequest(cfg, path, biz), creds) });
  }

  let res;
  try {
    // الإنشاء مسموح هنا في الـSandbox بس — والحارس بيرفض الإنتاج حتى لو الفلاغ اتبعت
    res = await jtCall(cfg, path, biz, { allowCreateInProduction: false, timeoutMs: 25000 });
  } catch (e) {
    return json({ error: "jt_unreachable", message: String((e as Error).message || e), env }, 502);
  }

  if (action === "pca_sync") {
    const rows = flattenPca(res.data);
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ prov: r.prov, city: r.city, area: r.area, raw: r.raw, synced_at: new Date().toISOString() }));
      const { error } = await admin.from("jt_pca").upsert(chunk, { onConflict: "prov,city,area" });
      if (error) return json({ error: "db", message: error.message, parsed: rows.length, sample: rows.slice(0, 3) }, 500);
      upserted += chunk.length;
    }
    return json({ ok: res.code === "1", env, code: res.code, msg: res.msg, parsed: rows.length, upserted,
      sample_raw: typeof res.raw === "string" ? res.raw.slice(0, 1500) : null });
  }

  return json({ ok: res.code === "1", env, http: res.status, code: res.code, msg: res.msg, data: res.data,
    raw: res.json ? undefined : res.raw.slice(0, 2000) });
});
