// jt-ship — إنشاء شحنة J&T لأوردر واحد (order/addOrder) وتسجيل رقم البوليصة وكود الفرز.
//
// 🔴 ده المسار الوحيد اللي بيخلق شحنة J&T بفلوس حقيقية. الحراسات بالترتيب:
//   1. التصريح: موظف نشط (tenant من الـJWT) · أو service_role (n8n — tenant من صف الأوردر) · أو diag.
//   2. الأوردر في المتجر ده · من غير بوليصة · حالته pending/confirmed · تليفون مصري صالح · عنوان ≥ 10.
//   3. المرسل (tenants.sender_*) كامل · حقول addOrder الستة متسجّلة في platform_settings.jt_addorder_fields
//      (من طلب Postman الناجح — مش تخمين) · الإنتاج مفتوح بمفتاح platform_settings.jt_production_enabled=true.
//   4. عنوان المستلم بأسماء J&T: من الـbody (اختيار الموظف) → من الأوردر → من مرادفات المدينة.
//      مفيش = رفض صريح address_unresolved (صفر تخمين صامت).
//   5. منع التكرار: txlogisticId = orders.id (J&T بترفض التكرار بـ145002001/145003101)،
//      وقبل أي addOrder لو فيه محاولة سابقة بنستعلم getOrders command:1 — موجود = نسجّله بدل ما نكرر.
//      timeout بعد الإرسال = نستعلم قبل ما نعلن فشل.
//   6. الحالة بتتكتب **بعد** رد J&T بس (app.jt_record_shipment ذرية + سطر status_log).
//
// الحمولة: { order_id, receiver?: {prov, city, area}, weight_kg?, dry_run? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildRequest, JT_PATHS, jtCall, redactRequest, withBusinessDigest } from "../_shared/jt.ts";
import { authCaller, cors, defaultEnv, egMobile, json, loadJtConfig, normPlace } from "../_shared/jt-runtime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const MIN_ADDRESS = 10;
const REMARK_MAX = 200;          // من توثيق مصر: remark String(200)
const ADDORDER_FIELDS = ["expressType", "deliveryType", "goodsType", "operateType", "payType", "serviceType"];

const ORDER_COLS = "id, tenant_id, order_uid, status, tracking_no, customer_name, phone, alt_phone, city, address, product_name, manufacturer_note, var, total_cost, shipping_carrier, carrier_ref, ship_prov, ship_city, ship_area, shipping_weight_kg, jt_ship_attempted_at, jt_ship_error";

function remarkFor(o: Record<string, unknown>): string {
  // المنتجات زي ما هي متسجّلة (اسم (عدد N)) + خصائص المنتج — نفس النص بيتطبع في البوليصة
  const lines: string[] = [];
  const pn = String(o.product_name || "").replace(/\r/g, "");
  for (const part of pn.split(/\s*\+\s*|\n/)) { const t = part.trim(); if (t) lines.push(t); }
  const props = String(o.manufacturer_note || o.var || "").trim();
  if (props && !lines.some((l) => l.includes(props))) lines.push(props);
  let remark = lines.join("\n");
  if ([...remark].length > REMARK_MAX) remark = [...remark].slice(0, REMARK_MAX - 1).join("") + "…";
  return remark;
}

async function setError(orderId: string, msg: string) {
  await admin.from("orders").update({ jt_ship_error: msg.slice(0, 500) }).eq("id", orderId);
}

// deno-lint-ignore no-explicit-any
function firstOrder(data: any): Record<string, unknown> | null {
  if (!data) return null;
  if (Array.isArray(data)) return data.length ? data[0] : null;
  if (typeof data === "object") {
    if (Array.isArray(data.list)) return data.list[0] || null;
    if (Array.isArray(data.records)) return data.records[0] || null;
    if (data.billCode) return data;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method", message: "POST بس" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "config", message: "إعدادات السيرفر ناقصة" }, 500);

  const caller = await authCaller(req, admin, SERVICE_ROLE_KEY);
  if (caller instanceof Response) return caller;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* فاضي */ }
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) return json({ error: "bad_request", message: "order_id ناقص" }, 400);
  const dryRun = body.dry_run === true;
  const byName = caller.mode === "user" ? (caller.name || "موظف") : (caller.mode === "service" ? "واتساب" : "diag");

  // ── الأوردر ────────────────────────────────────────────────────────
  const { data: order } = await admin.from("orders").select(ORDER_COLS).eq("id", orderId).maybeSingle();
  if (!order) return json({ error: "order_not_found", message: "الأوردر مش موجود" }, 404);
  if (caller.mode === "user" && order.tenant_id !== caller.tenantId) {
    return json({ error: "order_not_found", message: "الأوردر مش موجود في متجرك" }, 404);
  }
  const tenantId = order.tenant_id as string;

  if ((order.tracking_no || "").trim()) {
    return json({ error: "already_has_tracking", message: "الأوردر له بوليصة بالفعل (" + order.tracking_no + ") — مفيش شحنة تانية",
      tracking_no: order.tracking_no, idempotent: true }, 409);
  }
  const status = String(order.status || "").toLowerCase();
  if (status !== "pending" && status !== "confirmed") {
    return json({ error: "bad_status", message: "الشحن للأوردرات الجديدة أو المؤكدة بس — الحالة الحالية: " + order.status }, 422);
  }
  const mobile = egMobile(String(order.phone || ""));
  if (!mobile) { await setError(orderId, "رقم التليفون مش مفهوم: " + order.phone); return json({ error: "bad_phone", message: "رقم التليفون مش رقم مصري صالح (11 خانة) — صلّحه الأول" }, 422); }
  const altMobile = egMobile(String(order.alt_phone || ""));
  const street = String(order.address || "").replace(/\s+/g, " ").trim();
  if (street.length < MIN_ADDRESS) { await setError(orderId, "العنوان قصير"); return json({ error: "bad_address", message: "العنوان قصير أو فاضي — كمّله الأول وبعدين اشحن" }, 422); }

  // ── التاجر: المرسل + الشركة ─────────────────────────────────────────
  const { data: tenant } = await admin.from("tenants")
    .select("id, active, shipping_provider, store_name, sender_name, sender_phone, sender_prov, sender_city, sender_area, sender_street")
    .eq("id", tenantId).maybeSingle();
  if (!tenant || tenant.active !== true) return json({ error: "forbidden", message: "المتجر مش مفعّل" }, 403);
  if (tenant.shipping_provider !== "jt") return json({ error: "provider_not_jt", message: "شركة الشحن للمتجر مش J&T (shipping_provider=" + tenant.shipping_provider + ")" }, 422);
  const senderMobile = egMobile(String(tenant.sender_phone || ""));
  const senderMissing = ["sender_name", "sender_prov", "sender_city", "sender_area", "sender_street"].filter((k) => !String(tenant[k] || "").trim());
  if (!senderMobile) senderMissing.push("sender_phone");
  if (senderMissing.length) return json({ error: "sender_incomplete", message: "بيانات المرسل ناقصة في إعدادات المتجر: " + senderMissing.join(", ") }, 422);

  // ── حقول addOrder الستة — من Postman الناجح، مش تخمين ─────────────
  const { data: fRow } = await admin.from("platform_settings").select("value").eq("key", "jt_addorder_fields").maybeSingle();
  let fields: Record<string, unknown> = {};
  try { fields = fRow?.value ? JSON.parse(fRow.value) : {}; } catch { fields = {}; }
  const missingFields = ADDORDER_FIELDS.filter((k) => fields[k] == null || String(fields[k]).trim() === "");
  if (missingFields.length) return json({ error: "fields_not_configured", message: "حقول addOrder مش متسجّلة: " + missingFields.join(", ") }, 422);

  // ── عنوان المستلم بأسماء J&T ────────────────────────────────────────
  let prov = "", city = "", area = "";
  const rc = body.receiver && typeof body.receiver === "object" ? body.receiver as Record<string, unknown> : null;
  if (rc && rc.prov && rc.city && rc.area) {
    prov = String(rc.prov).trim(); city = String(rc.city).trim(); area = String(rc.area).trim();
  } else if (order.ship_prov && order.ship_city && order.ship_area) {
    prov = order.ship_prov; city = order.ship_city; area = order.ship_area;
  } else {
    const key = normPlace(String(order.city || ""));
    if (key) {
      const { data: al } = await admin.from("jt_pca_alias").select("prov, city, area").eq("tenant_id", tenantId).eq("alias_norm", key).maybeSingle();
      if (al) { prov = al.prov; city = al.city; area = al.area; }
    }
  }
  if (!prov || !city || !area) {
    await setError(orderId, "العنوان محتاج اختيار المحافظة/المدينة/المنطقة بأسماء J&T");
    return json({ error: "address_unresolved", message: "مش عارفين نحدد المحافظة/المدينة/المنطقة بأسماء J&T للمدينة «" + (order.city || "") + "» — اختارها من نافذة الشحن", city: order.city }, 422);
  }
  // لازم تبقى من نطاق J&T (jt_pca) — اسم غلط بيترفض عند J&T بـ145003060–62 وبيضيّع لفة
  const { data: pcaRow } = await admin.from("jt_pca").select("id").eq("prov", prov).eq("city", city).eq("area", area).maybeSingle();
  if (!pcaRow) {
    const { count } = await admin.from("jt_pca").select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) return json({ error: "address_not_in_pca", message: "العنوان (" + prov + " / " + city + " / " + area + ") مش في نطاق J&T المتسجّل" }, 422);
  }

  // ── الوزن ───────────────────────────────────────────────────────────
  let weight = Number(body.weight_kg);
  if (!(weight > 0)) weight = Number(order.shipping_weight_kg);
  if (!(weight > 0)) {
    const { data: w } = await admin.from("platform_settings").select("value").eq("key", "jt_default_weight_kg").maybeSingle();
    weight = Number(w?.value);
  }
  if (!(weight > 0) || weight > 100) return json({ error: "weight_missing", message: "الوزن (كجم) مطلوب لـJ&T — حدده في نافذة الشحن" }, 422);

  // نحفظ اختيار الموظف على الأوردر (حتى لو الإرسال فشل بعدين — عشان مايعيدش الاختيار)
  await admin.from("orders").update({ ship_prov: prov, ship_city: city, ship_area: area, shipping_weight_kg: weight }).eq("id", orderId);

  // ── إعدادات J&T ─────────────────────────────────────────────────────
  const env = caller.mode !== "user" && String(body.env || "") === "sandbox" ? "sandbox" : defaultEnv();
  const cfg = loadJtConfig(env);
  if (!cfg) return json({ error: "no_creds", message: "أسرار J&T (" + env + ") مش متسجّلة" }, 500);
  if (env === "production") {
    const { data: pe } = await admin.from("platform_settings").select("value").eq("key", "jt_production_enabled").maybeSingle();
    if ((pe?.value || "") !== "true") return json({ error: "production_disabled", message: "إنشاء الشحنات على إنتاج J&T مقفول (jt_production_enabled)" }, 423);
  }
  const creds = cfg.creds;
  const cod = Number(order.total_cost) || 0;
  const remark = remarkFor(order);

  const biz = withBusinessDigest({
    txlogisticId: order.id,                        // مرجعنا عندهم = id الأوردر — بيمنع التكرار عند J&T نفسها
    expressType: String(fields.expressType),
    deliveryType: String(fields.deliveryType),
    goodsType: String(fields.goodsType),
    operateType: Number(fields.operateType),
    payType: String(fields.payType),
    serviceType: String(fields.serviceType),
    sender: {
      name: String(tenant.sender_name).trim().slice(0, 50), mobile: senderMobile, phone: senderMobile, countryCode: "EGY",
      prov: tenant.sender_prov, city: tenant.sender_city, area: tenant.sender_area, street: String(tenant.sender_street).trim().slice(0, 200),
    },
    receiver: {
      name: String(order.customer_name || "عميل").trim().slice(0, 50), mobile, phone: altMobile || mobile, countryCode: "EGY",
      prov, city, area, street: street.slice(0, 200),
    },
    weight: String(weight),
    totalQuantity: 1,
    itemsValue: String(cod),
    remark,
  }, creds);

  if (dryRun) {
    return json({ ok: true, dry_run: true, env, request: redactRequest(buildRequest(cfg, JT_PATHS.addOrder, biz), creds), remark, weight, receiver: { prov, city, area } });
  }

  // ── منع التكرار: محاولة سابقة → اسأل J&T الأول ─────────────────────
  const lookup = async (): Promise<Record<string, unknown> | null> => {
    try {
      const q = await jtCall(cfg, JT_PATHS.getOrders, withBusinessDigest({ command: 1, serialNumber: [order.id] }, creds), { timeoutMs: 15000 });
      const found = firstOrder(q.data);
      return found && found.billCode ? found : null;
    } catch { return null; }
  };
  const record = async (bill: string, sorting: unknown, fee: unknown) => {
    const { data, error } = await admin.rpc("jt_record_shipment_v1", { p_order_id: orderId, p_bill_code: bill, p_sorting_code: sorting == null ? null : String(sorting), p_fee_estimated: fee == null || fee === "" ? null : Number(fee), p_weight: weight, p_by: "J&T API · " + byName });
    if (error) throw new Error("db:" + error.message);
    // مرادف المدينة → عنوان J&T (بيخلي الأوردر الجاي بنفس المدينة يتحل أوتوماتيك)
    const key = normPlace(String(order.city || ""));
    if (key) {
      await admin.from("jt_pca_alias").upsert({ tenant_id: tenantId, alias_norm: key, prov, city, area, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,alias_norm" });
    }
    return data;
  };

  if (order.jt_ship_attempted_at) {
    const prior = await lookup();
    if (prior) {
      const rec = await record(String(prior.billCode), prior.sortingCode, prior.sumFreight);
      return json({ ok: true, recovered: true, tracking_no: String(prior.billCode), sorting_code: prior.sortingCode ?? null, fee_estimated: prior.sumFreight ?? null, record: rec, env });
    }
  }
  await admin.from("orders").update({ jt_ship_attempted_at: new Date().toISOString() }).eq("id", orderId);

  // ── الإنشاء ─────────────────────────────────────────────────────────
  let res;
  try {
    res = await jtCall(cfg, JT_PATHS.addOrder, biz, { allowCreateInProduction: env === "production", timeoutMs: 25000 });
  } catch (e) {
    // timeout/شبكة بعد الإرسال — ممكن تكون اتعملت. نسأل قبل ما نعلن فشل.
    const prior = await lookup();
    if (prior) {
      const rec = await record(String(prior.billCode), prior.sortingCode, prior.sumFreight);
      return json({ ok: true, recovered: true, tracking_no: String(prior.billCode), sorting_code: prior.sortingCode ?? null, record: rec, env });
    }
    await setError(orderId, "J&T مردّتش (" + String((e as Error).message || e) + ") — استعلمنا ومفيش شحنة");
    return json({ error: "jt_unreachable", message: "J&T مردّتش والشحنة ماتعملتش — جرّب تاني بعد شوية" }, 502);
  }

  if (res.code === "1" && res.data && typeof res.data === "object") {
    const d = res.data as Record<string, unknown>;
    const bill = String(d.billCode || "").trim();
    if (!bill) { await setError(orderId, "رد J&T من غير billCode"); return json({ error: "no_bill_code", message: "J&T ردّت بنجاح من غير رقم بوليصة", data: d }, 502); }
    const rec = await record(bill, d.sortingCode, d.sumFreight);
    return json({ ok: true, env, tracking_no: bill, sorting_code: d.sortingCode ?? null, fee_estimated: d.sumFreight ?? null, last_center: d.lastCenterName ?? null, record: rec });
  }

  // تكرار عند J&T (اتعملت قبل كده وردّها ضاع) → نجيب البوليصة ونسجّلها
  if (res.code === "145002001" || res.code === "145003101") {
    const prior = await lookup();
    if (prior) {
      const rec = await record(String(prior.billCode), prior.sortingCode, prior.sumFreight);
      return json({ ok: true, recovered: true, tracking_no: String(prior.billCode), sorting_code: prior.sortingCode ?? null, record: rec, env });
    }
  }
  const why = "J&T رفضت (" + (res.code || res.status) + "): " + (res.msg || res.raw.slice(0, 200));
  await setError(orderId, why);
  return json({ error: "jt_rejected", code: res.code, message: why, env }, 502);
});
