// jt-lookup — استعلامات J&T (قراءة/تقدير/اشتراك) + مزامنة نطاق الخدمة (PCA).
//
// مفيش أي إنشاء شحنة من هنا في الإنتاج — `raw` بيقدر ينده مسار إنشاء في
// الـSandbox بس (للتحقق من الحمولة قبل أول شحنة حقيقية). الاستثناء الوحيد
// `perm_probe` وحمولته ناقصة عمداً فمستحيل تتحوّل لشحنة — الشرح تحت.
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
//   perm_probe    → (diag/service بس) هل `order/addOrder` مفعّل على الحساب؟ **من غير ما يعمل شحنة**
//   fee_sync      → (diag/service بس) getWaybillInfo للمسلّم/المرتجع → jt_apply_fee_v1 (التكلفة النهائية + رسوم COD)
//   trace_sync    → (diag/service بس) مصالحة بالسحب: logistics/trace لكل أوردر لسه ماوصلش حالة نهائية →
//                   المسحات الناقصة على **نفس** jt_apply_trace_v1 (30 سبتمبر — الـpush بيضيع ~1%)
//   (الاتنين بيسجّلوا كل تشغيل في jt_sync_runs — الواجهة بتنبّه الأدمن لو المزامنة وقفت)
//
// env: الموظف دايماً على البيئة الافتراضية (JT_ENV). diag/service يقدروا يطلبوا sandbox.
//
// 🔴 `perm_probe` — ليه آمن رغم إنه بينده مسار إنشاء في الإنتاج (21 سبتمبر):
//   J&T بترفض بـ`145003012 API account has no interface permissions` **قبل** ما تبص في
//   محتوى الحمولة (اتقاس: نفس الرد جه على حمولة كاملة وصحيحة 100%). فالفحص بيبعت
//   حمولة **ناقصة عمداً ومحفورة في الكود** — مفيش sender ولا receiver ولا weight ولا
//   الحقول الخمسة — يعني حتى لو الصلاحية اتفتحت، J&T بترد خطأ تحقق (`145003083/84/92`
//   أو `999001030`) و**مستحيل تتعمل شحنة**. القراءة:
//     `145003012` = الصلاحية لسه مقفولة · أي كود تاني = الصلاحية اتفتحت.
//   الحمولة مابتيجيش من الـbody خالص، والـ`allowCreateInProduction` بيتبعت من الكود
//   هنا صراحةً (مش من أي حمولة خارجية) — نفس عقد الحارس في `_shared/jt.ts`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildRequest, isCreateEndpoint, JT_PATHS, jtCall, jtPullScans, jtScansToApply, redactRequest, withBusinessDigest } from "../_shared/jt.ts";
import { md5Hex } from "../_shared/md5.ts";
import { authCaller, cors, defaultEnv, envStatus, json, loadJtConfig } from "../_shared/jt-runtime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// سجل التشغيل — فشله مايوقفش المزامنة نفسها. وبيمسح اللي أقدم من 14 يوم.
async function logRun(job: "trace_sync" | "fee_sync", ok: boolean, candidates: number, tally: Record<string, unknown>, error: string | null) {
  try {
    await admin.from("jt_sync_runs").insert({ job, ok, candidates, tally, error: error ? error.slice(0, 500) : null });
    await admin.from("jt_sync_runs").delete().lt("ran_at", new Date(Date.now() - 14 * 86400000).toISOString());
  } catch { /* السجل مش أهم من المزامنة */ }
}

const PULL_BY = "J&T API · مصالحة";

const ADDORDER_FIELDS = ["expressType", "deliveryType", "goodsType", "operateType", "payType"];   // serviceType اختياري

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
    const st = await envStatus(admin);
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

  const cfg = await loadJtConfig(env, admin);
  if (!cfg) return json({ error: "no_creds", message: "أسرار J&T (" + env + ") مش متسجّلة (لا في secrets البيئة ولا في الـVault)" }, 422);
  const creds = cfg.creds;
  // fee_sync — تكلفة الشحن النهائية للأوردرات المسلّمة/المرتجعة (بيتنده من pg_cron كل 15 دقيقة)
  if (action === "fee_sync") {
    if (!privileged) return json({ error: "forbidden", message: "fee_sync للتشخيص/الجدولة بس" }, 403);
    const { data: cand, error: cErr } = await admin.rpc("jt_fee_candidates_v1", { p_limit: Math.min(Number(body.limit) || 60, 200) });
    if (cErr) { await logRun("fee_sync", false, 0, {}, "db: " + cErr.message); return json({ error: "db", message: cErr.message }, 500); }
    const codes = (cand || []).map((r: { bill_code: string }) => String(r.bill_code || "")).filter(Boolean);
    const tally: Record<string, number> = {};
    const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
    for (let i = 0; i < codes.length; i += 30) {
      const batch = codes.slice(i, i + 30);
      let r;
      try {
        r = await jtCall(cfg, JT_PATHS.getWaybillInfo, withBusinessDigest({ waybillNos: batch }, creds), { timeoutMs: 25000 });
      } catch (e) {
        const m = String((e as Error).message || e);
        await logRun("fee_sync", false, codes.length, tally, "jt_unreachable: " + m);
        return json({ ok: false, error: "jt_unreachable", message: m, candidates: codes.length, tally }, 502);
      }
      if (r.code !== "1") { await logRun("fee_sync", false, codes.length, tally, "jt " + r.code + ": " + r.msg); return json({ ok: false, code: r.code, msg: r.msg, candidates: codes.length, tally }, 502); }
      // deno-lint-ignore no-explicit-any
      const rows: any[] = Array.isArray(r.data) ? r.data : [];
      // deno-lint-ignore no-explicit-any
      const byCode = new Map<string, any>(rows.map((x) => [String(x.waybillNo || ""), x]));
      for (const bc of batch) {
        const x = byCode.get(bc);   // J&T بتسقط البوليصة اللي لسه مااتمسحتش من الرد في صمت → no_data
        const freight = x ? Number(x.totalFreight ?? x.freight) : NaN;
        const { data: a, error: aErr } = await admin.rpc("jt_apply_fee_v1", {
          p_bill_code: bc,
          p_freight: Number.isFinite(freight) ? freight : null,
          p_charge_weight: x && Number.isFinite(Number(x.packageChargeWeight)) ? Number(x.packageChargeWeight) : null,
          p_is_sign: x && Number.isFinite(Number(x.isSign)) ? Number(x.isSign) : null,
          p_source: "waybill_info",
        });
        bump(aErr ? "error" : String(a?.note || "?"));
      }
    }
    await logRun("fee_sync", true, codes.length, tally, null);
    return json({ ok: true, env, candidates: codes.length, tally });
  }

  // trace_sync — المصالحة بالسحب (بيتنده من pg_cron كل 15 دقيقة)
  // 🔴 الـpush مش مضمون: 17309 فضل «استثناء» 3 أيام وهو متسلّم لأن مسح التسليم ماوصلش.
  // هنا بنسحب التتبع ونطبّق **بس** المسحات الأحدث من آخر مسح عندنا، على نفس الدالة
  // ونفس الخريطة — فالـpush والـpull مستحيل يدّوا نتيجتين مختلفتين لنفس المسح.
  if (action === "trace_sync") {
    if (!privileged) return json({ error: "forbidden", message: "trace_sync للتشخيص/الجدولة بس" }, 403);
    const { data: cand, error: cErr } = await admin.rpc("jt_trace_candidates_v1", { p_limit: Math.min(Number(body.limit) || 300, 1000) });
    if (cErr) { await logRun("trace_sync", false, 0, {}, "db: " + cErr.message); return json({ error: "db", message: cErr.message }, 500); }
    // deno-lint-ignore no-explicit-any
    const byBill = new Map<string, any>((cand || []).map((c: any) => [String(c.bill_code || ""), c]));
    const codes = [...byBill.keys()].filter(Boolean);
    const tally: Record<string, number> = {};
    const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
    const changed: Array<{ bill: string; status: string }> = [];
    for (let i = 0; i < codes.length; i += 30) {
      const batch = codes.slice(i, i + 30);
      let r;
      try {
        r = await jtCall(cfg, JT_PATHS.trace, withBusinessDigest({ billCodes: batch.join(",") }, creds), { timeoutMs: 25000 });
      } catch (e) {
        const m = String((e as Error).message || e);
        await logRun("trace_sync", false, codes.length, tally, "jt_unreachable: " + m);
        return json({ ok: false, error: "jt_unreachable", message: m, candidates: codes.length, tally }, 502);
      }
      if (r.code !== "1") {
        await logRun("trace_sync", false, codes.length, tally, "jt " + r.code + ": " + r.msg);
        return json({ ok: false, code: r.code, msg: r.msg, candidates: codes.length, tally }, 502);
      }
      // deno-lint-ignore no-explicit-any
      const items: any[] = Array.isArray(r.data) ? r.data : [];
      for (const it of items) {
        const bc = String(it?.billCode || "");
        const c = byBill.get(bc);
        if (!c) { bump("not_candidate"); continue; }
        const scans = jtScansToApply(jtPullScans(it?.details), c.carrier_status_at, c.carrier_status_code);
        if (!scans.length) { bump("up_to_date"); continue; }
        for (const sc of scans) {
          // الخام في jt_events (kind=pull) — من غير otp ولا صور التوقيع
          const { data: ev } = await admin.from("jt_events").insert({
            kind: "pull", bill_code: bc, order_id: c.order_id, tenant_id: c.tenant_id, digest_ok: true,
            payload_hash: md5Hex("pull|" + bc + "|" + sc.rawTime + "|" + sc.scanCode),
            payload: { source: "logistics/trace", billCode: bc, scanTime: sc.rawTime, scanCode: sc.scanCode, scanType: sc.scanType, desc: sc.desc.slice(0, 300), refund: sc.refund },
          }).select("id").maybeSingle();
          const { data: a, error: aErr } = await admin.rpc("jt_apply_trace_v1", {
            p_bill_code: bc, p_scan_type: sc.scanType, p_scan_code: sc.scanCode, p_scan_at: sc.scanAt, p_desc: sc.desc, p_by: PULL_BY });
          const note = aErr ? "error" : String(a?.note || "?");
          bump(note);
          if (ev?.id) await admin.from("jt_events").update({ applied: !aErr, apply_note: aErr ? "error: " + aErr.message : note }).eq("id", ev.id);
          if (note === "status_set") changed.push({ bill: bc, status: String(a?.status || "") });
        }
      }
    }
    await logRun("trace_sync", true, codes.length, { ...tally, changed: changed.length }, null);
    return json({ ok: true, env, candidates: codes.length, tally, changed });
  }

  let path = "", biz: Record<string, unknown> = {};
  let permProbe = false;   // فحص الصلاحية بحمولة ناقصة — الشرح في هيدر الملف

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
  } else if (action === "perm_probe") {
    if (!privileged) return json({ error: "forbidden", message: "perm_probe للتشخيص بس" }, 403);
    permProbe = true;
    path = JT_PATHS.addOrder;
    // 🔴 محفورة هنا عمداً وناقصة — مفيش sender/receiver/weight/الحقول الخمسة.
    // أي تعديل يخليها كاملة بيحوّل الفحص لإنشاء شحنة حقيقية بفلوس. متلمسهاش.
    biz = withBusinessDigest({ txlogisticId: "SAHL-PERMISSION-PROBE-DO-NOT-SHIP" }, creds);
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
    // الإنشاء مسموح هنا في الـSandbox بس. الاستثناء الوحيد `perm_probe` — حمولته ناقصة
    // عمداً ومحفورة في الكود، فمستحيل تتحوّل لشحنة (الشرح في هيدر الملف).
    res = await jtCall(cfg, path, biz, { allowCreateInProduction: permProbe, timeoutMs: 25000 });
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

  if (permProbe) {
    const blocked = res.code === "145003012";
    return json({ ok: !blocked, env, probe: "order/addOrder", permission: blocked ? "DENIED" : "GRANTED",
      code: res.code, msg: res.msg,
      note: blocked
        ? "الصلاحية لسه مقفولة — 145003012 بيرجع قبل أي تحقق من الحمولة"
        : "الصلاحية اتفتحت — الرد ده خطأ تحقق على الحمولة الناقصة عمداً، ومفيش شحنة اتعملت" });
  }

  return json({ ok: res.code === "1", env, http: res.status, code: res.code, msg: res.msg, data: res.data,
    raw: res.json ? undefined : res.raw.slice(0, 2000) });
});
