// wa-ofd-test — رسالة تجربة لقالب «المندوب في الطريق» على رقم المالك (11 أكتوبر — طلب المالك:
// «عاوز اشوف تجربة دلوقتي على رقمي انا و بعدها نشوف هنشغلها للكل ولا لسة»).
//
// ليه EF لوحدها مش وضع جوّه wa-ofd-notify؟ الإنتاجية فيها عقود متعايرة (الختم قبل fetch · النافذة من SQL · الحجز)
// وفرع تجربة جوّاها كان هيلمسها ويستلزم نشر جديد ليها. هنا: صفر لمس للإنتاجية.
//
// الشكل:
//   • البيانات = مرشّح حقيقي من wa_ofd_candidates_v1 بالمعاينة (shadow) — نفس buildOfdParams ونفس نص القالب من الداتابيز
//     = اللي العميل هيستلمه بالحرف (الاسم الأول ورقم الطلب واسم المندوب ورقمه ورقم المحل).
//   • 🔴 المستلمين من platform_settings('wa_ofd_test').wa_ids بس — **مش** pilot_wa_ids (دي قايمة الإنتاج: العميل فيها
//     بيستلم عن أوردره هو، والتجربة بتبعت بيانات أوردر عميل تاني = تسريب لو القايمة كبرت) · الإعداد بينتهي (expires_at)
//     وبسقف إجمالي (max_sends) — الـEF بتفضل منشورة بنفس الـdiag token بتاع الكرون فمحتاجة تقفل لوحدها.
//   • 🔴 حجز ذري قبل ميتا (wa_ofd_test_reserve: قفل + انتهاء + سقف + 60ث لنفس الرقم) — مهما كانت النتيجة الحجز بيتعدّ
//     (timeout = اتبعت غالباً). مش حارس على صف الصندوق (ده بيتكتب بعد رد ميتا = ضغطتين متوازيين بيعدّوا).
//   • 🔴 صفر كتابة على wa_ofd_sends / wa_auto_templates / wa_ofd_runs / orders — الأوردر الحقيقي مايتلمسش،
//     والإيقاف الأوتوماتيك مايتأثرش. الكتابة: سجل التجربة + صف في الصندوق للرقم التجريبي (عشان delivered/read تتسجّل).
//   • خطوتين: من غير send=true = معاينة (المستلم بالرقم كامل — رقم المالك نفسه — وأرقام العميل والمندوب متغطية) ·
//     send=true لازم معاه order_uid اللي رجع في المعاينة — لو الشحنة دي مابقتش مرشّحة = no_candidate مش أوردر تاني.
//
//   • (11 أكتوبر مساءً) قالب لسه مااتفعّلش في الإنتاج (المنتج + المبلغ): platform_settings('wa_ofd_test').template =
//     {name, lang?, body, param_count} = بيتجرّب هو بدل صف الإنتاج — عشان رسالة القالب الجديد توصل رقم المالك قبل التبديل.
//     النص = المسجّل عند ميتا بالحرف (بيتكتب بـSQL مع الإعداد) · الترتيب من OFD_LAYOUTS · المنتج والمبلغ من orders (قراية بس).
//
// الحمولة: { send?: boolean, order_uid?: string }   التصريح: service_role أو x-diag-token (زي wa-ofd-notify).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildOfdParams, classifyFetchError, classifyMeta, maskDigits, maskPhone, maxPlaceholder, OFD_LAYOUTS, ofdNeedsOrder,
  renderTemplate, type MetaVerdict,
} from "../_shared/wa-ofd.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const GRAPH = "https://graph.facebook.com/v18.0";
const FETCH_TIMEOUT_MS = 10000, MAX_TO = 3;
const TEST_BY = "تجربة · المندوب في الطريق";

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

// ساعة القاهرة — للتشخيص بس (ليه مفيش مرشّح)؛ الحكم نفسه من SQL
function cairoHour(): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  return Number(h);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const send = body?.send === true;
  const uidRaw = String(body?.order_uid ?? "").trim();
  if (uidRaw && !/^[A-Za-z0-9-]{1,40}$/.test(uidRaw)) return json({ ok: false, error: "bad_order_uid" }, 400);
  if (send && !uidRaw) return json({ ok: false, error: "order_uid_required" }, 400);   // الإرسال على اللي اتعاين بس

  // 1) إعداد التجربة (المستلمين · الانتهاء · السقف) — منفصل عن pilot_wa_ids
  const { data: cfgRow, error: cfgErr } = await admin.from("platform_settings").select("value").eq("key", "wa_ofd_test").maybeSingle();
  if (cfgErr) return json({ ok: false, error: "test_config_read_failed" }, 500);
  // deno-lint-ignore no-explicit-any
  let cfg: any = null;
  try { cfg = cfgRow?.value ? JSON.parse(String(cfgRow.value)) : null; } catch { cfg = null; }
  if (!cfg) return json({ ok: false, error: "no_test_config" });
  const expMs = Date.parse(String(cfg.expires_at || ""));
  if (!Number.isFinite(expMs) || Date.now() >= expMs) return json({ ok: false, error: "test_expired", expires_at: cfg.expires_at ?? null });
  const configured = Array.isArray(cfg.wa_ids) ? cfg.wa_ids.length : 0;
  const to = [...new Set((Array.isArray(cfg.wa_ids) ? cfg.wa_ids : []).map((x: unknown) => String(x ?? "").trim()))]
    .filter((x) => /^20\d{10}$/.test(x)).slice(0, MAX_TO) as string[];
  if (!to.length) return json({ ok: false, error: "no_valid_test_number", configured });

  // 2) حالة القالب — عشان «مفيش مرشّح» يتقال بسببه
  const { data: tpl, error: tplErr } = await admin.from("wa_auto_templates")
    .select("paused_at, paused_reason, send_from_hour, send_to_hour")
    .eq("tenant_id", cfg.tenant_id).eq("event", "out_for_delivery").maybeSingle();
  if (tplErr) return json({ ok: false, error: "template_read_failed" }, 500);
  if (!tpl) return json({ ok: false, error: "no_template_row" });

  // 3) مرشّح حقيقي بالمعاينة (shadow: بيتجاهل mode/pilot/enabled_since — بيحترم الإيقاف والساعات والطازة)
  const { data: cands, error: cErr } = await admin.rpc("wa_ofd_candidates_v1", { p_limit: 1, p_uids: uidRaw ? [uidRaw] : null, p_shadow: true });
  if (cErr) return json({ ok: false, error: "candidates_failed" }, 500);
  // deno-lint-ignore no-explicit-any
  const c: any = (cands || [])[0];
  if (!c) {
    const h = cairoHour();
    const reason = tpl.paused_at ? `paused:${tpl.paused_reason || "?"}`
      : (h < tpl.send_from_hour || h >= tpl.send_to_hour) ? `outside_hours:${h}`
      : uidRaw ? "order_not_candidate_now" : "no_fresh_out_for_delivery";
    return json({ ok: false, error: "no_candidate", reason });
  }
  if (c.tenant_id !== cfg.tenant_id) return json({ ok: false, error: "wrong_tenant" });
  // قالب التجربة (لو متسجّل في الإعداد) بدل قالب الإنتاج — الإنتاج نفسه مايتلمسش
  const ov = cfg.template;
  if (ov != null) {
    if (typeof ov !== "object" || !/^[a-z0-9_]{1,512}$/.test(String(ov.name || "")) || typeof ov.body !== "string"
        || !ov.body || ov.body.length > 1024) return json({ ok: false, error: "bad_test_template" });
    c.template_name = String(ov.name); c.body = ov.body; c.param_count = Number(ov.param_count);
    if (ov.lang) c.lang = String(ov.lang);
  }
  const nParams = Number(c.param_count);
  if (!OFD_LAYOUTS[nParams] || maxPlaceholder(c.body) !== nParams) return json({ ok: false, error: "bad_template_params" });
  if (ofdNeedsOrder(nParams)) {
    const { data: o, error: oErr } = await admin.from("orders").select("tenant_id, product_name, jt_cod_amount, total_cost")
      .eq("id", c.order_id).maybeSingle();
    if (oErr) return json({ ok: false, error: "order_read_failed" }, 500);
    if (o && o.tenant_id === c.tenant_id) { c.product_name = o.product_name; c.cod_amount = o.jt_cod_amount; c.total_cost = o.total_cost; }
  }
  let params: string[];
  try { params = buildOfdParams(c, nParams); } catch (e) { return json({ ok: false, error: String((e as Error).message) }); }
  const text = renderTemplate(c.body, params);
  const masked = text.replace(/0\d{9,10}/g, (m) => maskPhone(m));

  if (!send) {
    return json({ ok: true, preview: true, order_uid: c.order_uid, to, expires_at: cfg.expires_at, max_sends: cfg.max_sends ?? null,
      template: c.template_name, text: masked, next: `send:true + order_uid:"${c.order_uid}"` });
  }

  const { data: t, error: tErr } = await admin.from("tenants").select("whatsapp_phone_id, whatsapp_token").eq("id", c.tenant_id).maybeSingle();
  if (tErr) return json({ ok: false, error: "tenant_read_failed" }, 500);
  if (!t?.whatsapp_phone_id || !t?.whatsapp_token) return json({ ok: false, error: "no_wa_config" });

  const results: Array<Record<string, unknown>> = [];
  for (const waId of to) {
    // 🔴 الحجز قبل ميتا — ذري (قفل) · بيتعدّ مهما كانت النتيجة · الخطأ = مفيش إرسال (fail closed)
    const { data: rsv, error: rErr } = await admin.rpc("wa_ofd_test_reserve", { p_tenant: c.tenant_id, p_wa_id: waId, p_order_uid: c.order_uid });
    if (rErr || !rsv) { results.push({ to: waId, kind: "skipped", code: "reserve_failed" }); continue; }
    if (rsv.ok !== true) { results.push({ to: waId, kind: "skipped", code: String(rsv.reason || "reserve_refused") }); continue; }

    let v: MetaVerdict;
    try {
      const res = await fetch(`${GRAPH}/${t.whatsapp_phone_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t.whatsapp_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", recipient_type: "individual", to: waId, type: "template",
          template: { name: c.template_name, language: { code: c.lang || "ar_EG" },
            components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      v = classifyMeta(res.status, await res.json().catch(() => ({})));
    } catch (e) { v = classifyFetchError(e); }

    try {
      await admin.rpc("wa_ofd_test_finish", { p_id: rsv.id, p_kind: v.kind, p_code: v.code || null,
        p_wamid: v.kind === "sent" ? v.detail : null });
    } catch { /* السجل تاني — الحجز نفسه اتعدّ */ }

    let inbox = "skipped";
    if (v.kind === "sent") {
      try {
        await admin.from("wa_conversations").upsert(
          { tenant_id: c.tenant_id, wa_id: waId, customer_phone: "0" + waId.slice(2), last_message_at: new Date().toISOString() },
          { onConflict: "tenant_id,wa_id", ignoreDuplicates: true });
        const { data: conv } = await admin.from("wa_conversations").select("id").eq("tenant_id", c.tenant_id).eq("wa_id", waId).maybeSingle();
        const { error: mErr } = conv?.id
          ? await admin.from("wa_messages").insert({
            tenant_id: c.tenant_id, conversation_id: conv.id, wa_message_id: v.detail, direction: "out", type: "template",
            body: text, status: "sent", wa_timestamp: new Date().toISOString(), sent_by: null, sent_by_name: TEST_BY,
          })
          : { error: { message: "no_conversation" } };
        inbox = mErr ? "failed" : "ok";
      } catch { inbox = "failed"; }
    }
    results.push({ to: waId, kind: v.kind, code: v.code || null, detail: v.kind === "sent" ? null : maskDigits(v.detail),
      inbox, used: rsv.used, max: rsv.max });
  }
  return json({ ok: results.some((r) => r.kind === "sent"), order_uid: c.order_uid, results });
});
