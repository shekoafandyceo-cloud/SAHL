// order-ship — زرار «شحن أوتوماتيك» في نافذة تفاصيل الأوردر.
//
// الشكل: فحوص قبلية هنا → نداء ويبهوك n8n (CentralORDERS مسار SHIPT CTX)
// → n8n بيحلل العنوان بالـAI ويعمل البوليصة عند شركة الشحن ويكتب
// status='BOSTA AUTO' + tracking_no **بعد نجاح رد الشركة بس**.
//
// 🔴 مصدر الحقيقة هو صف الأوردر مش رد الويبهوك: الويبهوك بيرد فوراً
// «Workflow got started» من غير نتيجة، فالواجهة بتتابع الصف لحد ما
// tracking_no يظهر (القياس الحي: 12–30 ثانية). الدالة دي **ماتلمسش
// عمود الحالة أبداً** — بتعلّم shipping_requested_at بس، عشان مايبقاش
// فيه أي احتمال «حالة شحن من غير شحنة».
//
// 🔴 الثابت الحاكم (زي tenant-staff): tenant_id عمره ما بييجي من الـbody —
// بيتقرا من بروفايل صاحب الـJWT. لو جه في الـbody بيتطنّش.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// أقل طول منطقي لعنوان يتبعت للتحليل — أقصر من كده بيرجع من n8n
// «مش صالح» بعد لفة كاملة؛ نمسكه هنا وقت الضغطة بدل ما نضيّعها
const MIN_ADDRESS = 10;
// مانع الضغط المتكرر: طلب جديد على نفس الأوردر خلال الفترة دي بيترفض —
// n8n نفسه مافيهوش حارس تكرار، فده السد الوحيد قدام «ضغطتين = شحنتين»
const COOLDOWN_SECONDS = 90;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method", message: "POST بس" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "config", message: "إعدادات السيرفر ناقصة" }, 500);
  }

  // ── الهوية: عضو نشط في متجر (أدمن أو موظف — الاتنين بيشتغلوا على الجدول)
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized", message: "لازم تسجّل دخول" }, 401);

  const { data: got, error: uErr } = await admin.auth.getUser(token);
  const caller = got?.user;
  if (uErr || !caller) {
    return json({ error: "unauthorized", message: "الجلسة انتهت — سجّل دخول تاني" }, 401);
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, tenant_id, full_name, role, active")
    .eq("id", caller.id)
    .maybeSingle();
  if (!profile || profile.active !== true || !profile.tenant_id) {
    return json({ error: "forbidden", message: "الحساب مش مفعّل" }, 403);
  }
  const tenantId = profile.tenant_id; // 🔴 من البروفايل — مش من الـbody

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* فاضي */ }
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) return json({ error: "bad_request", message: "order_id ناقص" }, 400);

  // ── التاجر لازم يكون رابط مفتاح شحن — من غيره المسار ده مالوش معنى
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, active, shipping_api_key")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant || tenant.active !== true) {
    return json({ error: "forbidden", message: "المتجر مش مفعّل" }, 403);
  }
  if (!(tenant.shipping_api_key || "").trim()) {
    return json({
      error: "no_api_key",
      message: "مفيش مفتاح شحن متسجل — سجّله من الإعدادات الأول، أو علّم الأوردر «اتشحن يدوي»",
    }, 422);
  }

  // ── الأوردر: في متجر صاحب الطلب + صالح للشحن
  const { data: order } = await admin
    .from("orders")
    .select("id, status, tracking_no, address, phone, shipping_requested_at")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!order) return json({ error: "order_not_found", message: "الأوردر مش موجود في متجرك" }, 404);

  if ((order.tracking_no || "").trim()) {
    return json({
      error: "already_has_tracking",
      message: "الأوردر له بوليصة بالفعل (" + order.tracking_no + ") — مفيش شحنة تانية",
    }, 409);
  }
  const status = String(order.status || "").toLowerCase();
  if (status !== "pending" && status !== "confirmed") {
    return json({
      error: "bad_status",
      message: "الشحن الأوتوماتيك للأوردرات الجديدة أو المؤكدة بس — الحالة الحالية: " + order.status,
    }, 422);
  }
  if (!(order.phone || "").trim()) {
    return json({ error: "bad_phone", message: "مفيش رقم تليفون على الأوردر" }, 422);
  }
  if (((order.address || "").trim()).length < MIN_ADDRESS) {
    return json({
      error: "bad_address",
      message: "العنوان قصير أو فاضي — كمّله الأول (المنطقة والشارع على الأقل) وبعدين اشحن",
    }, 422);
  }
  if (order.shipping_requested_at) {
    const age = (Date.now() - new Date(order.shipping_requested_at).getTime()) / 1000;
    if (age >= 0 && age < COOLDOWN_SECONDS) {
      return json({
        error: "recently_requested",
        message: "فيه محاولة شحن شغالة على الأوردر ده من ثواني — استنى نتيجتها الأول",
      }, 429);
    }
  }

  // ── عنوان الويبهوك من إعدادات المنصة — مش ثابت في الكود
  const { data: cfg } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", "ship_webhook_url")
    .maybeSingle();
  const hookUrl = (cfg?.value || "").trim();
  if (!hookUrl) return json({ error: "config", message: "عنوان الشحن مش متظبط — كلم الدعم" }, 500);

  // نعلّم المحاولة قبل النداء — لو n8n استلم واحنا وقعنا بعدها، العلامة
  // موجودة والواجهة هتلاقي الـtracking لما يوصل
  const requestedAt = new Date().toISOString();
  await admin.from("orders")
    .update({ shipping_requested_at: requestedAt })
    .eq("id", orderId).eq("tenant_id", tenantId);

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(hookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, order_id: orderId }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error("hook_status_" + res.status);
  } catch (_e) {
    // الويبهوك نفسه مش موصول — نرجّع العلامة ونفشل بصراحة فوراً،
    // بدل ما الواجهة تستنى 45 ثانية على حاجة عمرها ما اتبعتت
    await admin.from("orders")
      .update({ shipping_requested_at: null })
      .eq("id", orderId).eq("tenant_id", tenantId)
      .eq("shipping_requested_at", requestedAt);
    return json({
      error: "webhook_unreachable",
      message: "سيرفر الشحن مش بيرد دلوقتي — الأوردر ماتبعتش. جرّب تاني بعد شوية",
    }, 502);
  }

  return json({ ok: true, requested_at: requestedAt });
});
