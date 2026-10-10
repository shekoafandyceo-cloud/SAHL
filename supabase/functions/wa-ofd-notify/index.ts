// wa-ofd-notify — «المندوب في الطريق»: قالب واتساب UTILITY أوتوماتيك للعميل أول ما شحنة J&T تاخد مسح 94 ذهاب
// (11 أكتوبر — طلب المالك). فيه اسم المندوب ورقمه ورقم المحل — العميل يتفق مع المندوب على معاد، ولو فيه مشكلة يكلّمنا.
//
// ليه EF لوحدها؟
//   • مش wa-send: عقدها الرد جوّه نافذة الـ24 ساعة (وفيها حارس صريح بيرفض برّاها) — القالب ده موجود عشان يتجاوزها.
//   • مش wa-followup: دي بضغطة موظف بتوكنه (RLS) — هنا مفيش موظف، الإرسال من الجدولة.
//   • مش n8n: قاعدة أمان 1 (ممنوع تعديل آلي على وركفلوهات الإنتاج) + المنطق كله في SQL متجرّب بترانزاكشن راجعة.
//
// قرارات المالك (10 أكتوبر): أول 94 ذهاب · تاني بس لو مندوب برقم مختلف · سقف 3 للأوردر · 9 الصبح–9 بالليل القاهرة (المسح بالليل
// بيستنى 9 الصبح، بآخر مندوب، ولو الشحنة لسه ماتسلّمتش) · القالب `order_out_for_delivery_ar` ar_EG بـ5 متغيرات · مقفول لحد موافقة ميتا.
//
// المسار: pg_cron كل دقيقة → app.wa_ofd_tick (تنضيف + نداء هنا بس لو فيه مرشّحين) → wa_ofd_claim_v1 (حجز ذري ≤8) →
//   لكل صف: wa_ofd_dispatch_v1 (ختم «خرجت لميتا» قبل fetch بالظبط) → ميتا → wa_ofd_mark_v1 (النتيجة + صف في الصندوق).
//   صفر كتابة على orders (الريل-تايم كان هيعيد رسم نافذة التفاصيل ويمسح كلام الموظف).
//
// الحمولة: { dry_run?: boolean, shadow?: boolean, order_uids?: string[] (≤20) }
//   • 🔴 مفيش أي نص/رقم/اسم من الـbody — كله من الداتابيز. ومفيش ساعة هنا: الـSQL بيرجّع send_until (تغيير الساعة الصيفي في Postgres بس).
//   • dry_run = المرشّحين بالنص اللي هيتبعت (الأرقام متغطية) **من غير** claim ولا ميتا ولا سجل تشغيل.
//   • shadow مع dry_run بس = معاينة بتتجاهل mode/pilot/enabled_since (قبل التشغيل) — بتحترم الإيقاف والساعات والطازة والسقف.
//   • order_uids = اختبار موجّه — كل الحراسات بتتطبّق برضه.
// التصريح: service_role أو x-diag-token (= platform_settings.jt_diag_token) — مفيش مسار للموظف (نفس ship-rank-sync).
//
// ميزانية الدورة: آخر إرسال بيبدأ قبل 40ث ⇒ أطول دورة ≈ 40 + 10 (timeout ميتا) + النتايج < 60ث (timeout الـcron)
// وأقل بكتير من حد الـEF (150ث). الباقي بيترجع `release` (المحاولة بترجع) ويتحاول الدورة الجاية.
//
// تصنيف أخطاء ميتا (classifyMeta في _shared/wa-ofd.ts):
//   sent → صف في wa_messages (template · «تلقائي · المندوب في الطريق») · unknown (timeout/reset/2xx من غير wamid) = بيتحسب مبعوت
//   ومابيتعادش (التكرار أسوأ من الغياب) · transient → +2د ثم +5د (3 محاولات بالظبط) · recipient (131021/131026) → الرقم ده ميّت
//   للأوردر · message → نهائي + circuit (نفس الكود مرتين في الدورة أو 3 في 30د = إيقاف بتجربة بعد 3س) · run-stop (توكن/حساب/سقف)
//   → deferred +15د ووقف الدورة **وإيقاف مؤقت للمتجر** (run_stop — 15د سقف/ساعة الباقي، وبعده تجربة واحدة) · template-pause (132xxx · بارامترات القالب · رقم المحل) → إيقاف (132015 = تجربة لوحدها بعد 3س).
// الرد ودليل الحياة (wa_ofd_runs) مافيهمش أرقام ولا نصوص — أكواد بس.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildOfdParams, classifyFetchError, classifyMeta, errCode, maskDigits, maskPhone, maxPlaceholder, OFD_PARAMS,
  renderTemplate, type MetaVerdict,
} from "../_shared/wa-ofd.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const GRAPH = "https://graph.facebook.com/v18.0";
const MAX_UIDS = 20, CLAIM_LIMIT = 8, FETCH_TIMEOUT_MS = 10000, PACE_MS = 300, RUN_BUDGET_MS = 40000;

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

// دليل الحياة (البانر بيقراه من app.wa_ofd_health) — error كود بس (CHECK على الجدول كمان)
async function logRun(ok: boolean, claimed: number, tenantIds: string[], tally: Record<string, number>, error: string | null) {
  try {
    await admin.from("wa_ofd_runs").insert({ ok, claimed, tenant_ids: tenantIds, tally, error: error ? errCode(error) : null });
    await admin.from("wa_ofd_runs").delete().lt("ran_at", new Date(Date.now() - 14 * 86400000).toISOString());
  } catch { /* السجل مش أهم من الإرسال */ }
}

// محاولة + إعادة واحدة (الختم والنتيجة — وقوعهم معناه صف متعلّق والتنضيف بيلمّه)
async function rpc(fn: string, args: Record<string, unknown>) {
  let r = await admin.rpc(fn, args);
  if (r.error) { await sleep(250); r = await admin.rpc(fn, args); }
  return r;
}

function sanitize(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x ?? "").trim()).filter((x) => /^[A-Za-z0-9-]{1,40}$/.test(x)))].slice(0, MAX_UIDS);
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const dry = body?.dry_run === true;
  const shadow = dry && body?.shadow === true;                 // 🔴 shadow مع dry_run بس
  const uids = sanitize(body?.order_uids);
  if (Array.isArray(body?.order_uids) && body.order_uids.length && !uids.length) {
    return json({ ok: false, error: "no_valid_uids" }, 400);   // نداء يدوي غلط — مش تشغيل، فمالوش سطر في السجل
  }

  if (dry) {
    const { data, error } = await admin.rpc("wa_ofd_candidates_v1", { p_limit: 20, p_uids: uids.length ? uids : null, p_shadow: shadow });
    if (error) return json({ ok: false, error: "candidates_failed" }, 500);
    // deno-lint-ignore no-explicit-any
    return json({ ok: true, dry_run: true, shadow, candidates: (data || []).map((c: any) => {
      let params: string[] | null = null, err: string | null = null;
      try { params = buildOfdParams(c); } catch (e) { err = String((e as Error).message); }
      return {
        order_uid: c.order_uid, to: maskPhone(c.wa_id), courier: maskPhone(c.courier_phone), send_no: c.send_no,
        due_at: c.due_at, send_until: c.send_until, scan_at: c.scan_at, probing: c.probing, error: err,
        text: params ? renderTemplate(c.body, params).replace(/0\d{9,10}/g, (m) => maskPhone(m)) : null,
      };
    }) });
  }

  const { data: claimed, error: cErr } = await admin.rpc("wa_ofd_claim_v1", { p_limit: CLAIM_LIMIT, p_uids: uids.length ? uids : null });
  if (cErr) {
    await logRun(false, 0, [], {}, "claim_failed:" + errCode(cErr.code));
    return json({ ok: false, error: "claim_failed" }, 500);
  }
  // deno-lint-ignore no-explicit-any
  const rows: any[] = claimed || [];
  const tenantIds = [...new Set(rows.map((r) => String(r.tenant_id)))];
  if (!rows.length) { await logRun(true, 0, [], { nothing: 1 }, null); return json({ ok: true, claimed: 0 }); }

  // إعداد واتساب لكل متجر (service — زي wa-followup). التوكن عمره ما بيتطبع ولا بيرجع في رد.
  const tenantCfg = new Map<string, { whatsapp_phone_id: string | null; whatsapp_token: string | null }>();
  {
    const { data: ts } = await admin.from("tenants").select("id, whatsapp_phone_id, whatsapp_token").in("id", tenantIds);
    for (const t of (ts || []) as Array<{ id: string; whatsapp_phone_id: string | null; whatsapp_token: string | null }>) {
      tenantCfg.set(String(t.id), { whatsapp_phone_id: t.whatsapp_phone_id, whatsapp_token: t.whatsapp_token });
    }
  }

  const tally: Record<string, number> = {};
  const add = (k: string) => { const key = errCode(k); tally[key] = (tally[key] || 0) + 1; };
  const runMsg = new Map<string, number>();
  let stop: string | null = null;
  const mark = async (id: number, res: Record<string, unknown>) => {
    const r = await rpc("wa_ofd_mark_v1", { p_id: id, p_result: res });
    // deno-lint-ignore no-explicit-any
    if (r.error || (r.data as any)?.ok === false) add("mark_failed");
    // deno-lint-ignore no-explicit-any
    return r.data as any;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (stop) { await mark(r.id, { outcome: "release", error_code: "run_stopped" }); add("released"); continue; }
    if (Date.now() - t0 > RUN_BUDGET_MS) { stop = "run_budget"; await mark(r.id, { outcome: "release", error_code: "run_budget" }); add("released"); continue; }
    // 🔴 نافذة الإرسال من SQL (send_until = قفلة النهارده بتوقيت القاهرة) — قبل كل إرسال
    if (Date.now() >= Date.parse(r.send_until)) { stop = "quiet_hours"; await mark(r.id, { outcome: "release", error_code: "quiet_hours" }); add("released"); continue; }
    const t = tenantCfg.get(String(r.tenant_id));
    if (!t?.whatsapp_phone_id || !t?.whatsapp_token) { await mark(r.id, { outcome: "deferred", error_code: "no_wa_config", run_stop: true }); stop = "no_wa_config"; continue; }
    if (r.param_count !== OFD_PARAMS || maxPlaceholder(r.body) !== OFD_PARAMS) {
      await mark(r.id, { outcome: "pause", error_code: "bad_template_params" }); stop = "bad_template_params"; continue;
    }
    let params: string[];
    try { params = buildOfdParams(r); }
    catch (e) {
      const m = String((e as Error).message);
      if (m === "bad_store_phone") { await mark(r.id, { outcome: "pause", error_code: m }); stop = m; }
      else { await mark(r.id, { outcome: "permanent", error_class: "message", error_code: m }); add(m); }   // 🔴 مش release: كان هيتعاد كل دقيقة للأبد
      continue;
    }
    if (i > 0) await sleep(PACE_MS);
    // 🔴 الختم قبل fetch مباشرةً: من غيره الصف «ماخرجش مننا» والتنضيف بيرجّعه deferred (مش unknown).
    //    بالحجز (claimed_at) ومتكرر بأمان: الإعادة بعد رد ضايع بترجع true لنفس الحجز (من غير كده الصف كان يبقى «اتبعت غالباً» وهو ماخرجش)
    const d = await rpc("wa_ofd_dispatch_v1", { p_id: r.id, p_claimed_at: r.claimed_at });
    if (d.error) { stop = "dispatch_failed"; await mark(r.id, { outcome: "release", error_code: "dispatch_failed" }); continue; }
    if (d.data !== true) { add("not_ours"); continue; }
    let v: MetaVerdict;
    try {
      const res = await fetch(`${GRAPH}/${t.whatsapp_phone_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t.whatsapp_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", recipient_type: "individual", to: r.wa_id, type: "template",
          template: { name: r.template_name, language: { code: r.lang || "ar_EG" },
            components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      v = classifyMeta(res.status, await res.json().catch(() => ({})));
    } catch (e) { v = classifyFetchError(e); }
    let circuit = false;
    if (v.kind === "permanent" && v.cls === "message") {
      const k = (runMsg.get(v.code) || 0) + 1; runMsg.set(v.code, k); circuit = k >= 2;
    }
    const m = v.kind === "sent"
      ? await mark(r.id, { outcome: "sent", wamid: v.detail, body: renderTemplate(r.body, params) })
      : await mark(r.id, { outcome: v.kind, error_code: v.code, error_detail: maskDigits(v.detail), error_class: v.cls, circuit,
                           run_stop: v.kind === "deferred" });   // 🔴 خطأ حساب/توكن/سقف = إيقاف مؤقت للمتجر (مش الدورة بس)
    add(v.kind === "sent" ? "sent" : v.kind + ":" + v.code);
    if (v.kind !== "sent") console.error("wa-ofd-notify", r.order_uid, v.kind, v.code);   // رقم الطلب والكود بس
    if (v.kind === "pause" || v.kind === "deferred") stop = v.kind + ":" + v.code;
    else if (m?.paused) stop = "circuit:" + v.code;
  }

  const benign = stop === "quiet_hours" || stop === "run_budget";
  const err = stop && !benign ? stop : (tally.mark_failed ? "mark_failed" : null);
  await logRun(!err, rows.length, tenantIds, tally, err ? errCode(err) : null);
  return json({ ok: !err, claimed: rows.length, tally, error: err ? errCode(err) : null });   // 🔴 مفيش أرقام ولا نصوص
});
