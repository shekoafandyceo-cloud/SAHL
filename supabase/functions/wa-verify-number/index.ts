import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH         = "https://graph.facebook.com/v18.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")   return reply(405, { ok: false, error: "method_not_allowed" });

  try {
    // ---------- 1) هوية المستخدم ----------
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return reply(401, { ok: false, message: "لازم تسجّل دخول الأول." });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return reply(401, { ok: false, message: "جلسة الدخول انتهت. سجّل دخول تاني." });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: profile } = await sb
      .from("user_profiles")
      .select("tenant_id, role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!profile?.tenant_id) {
      return reply(403, { ok: false, message: "حسابك مش مربوط بمتجر." });
    }
    if (profile.role !== "admin") {
      return reply(403, { ok: false, message: "الإعداد ده لأدمن المتجر بس." });
    }

    // ---------- 2) المدخلات ----------
    const payload   = await req.json().catch(() => ({}));
    const phoneId   = String(payload?.phone_number_id ?? "").trim();
    const token     = String(payload?.token ?? "").trim();

    // إفراغ البيانات = رجوع لرقم سهل المشترك
    if (!phoneId && !token) {
      const { error } = await sb.from("tenants")
        .update({ whatsapp_phone_id: null, whatsapp_token: null, wa_verified_at: null })
        .eq("id", profile.tenant_id);
      if (error) return reply(400, { ok: false, message: "تعذّر الحفظ: " + error.message });
      return reply(200, { ok: true, cleared: true, message: "اتشال رقمك الخاص. هتشتغل على رقم سهل المشترك." });
    }

    if (!phoneId || !token) {
      return reply(400, { ok: false, message: "لازم تدخل الرقم والتوكن مع بعض — مش واحد بس." });
    }
    if (!/^\d{10,20}$/.test(phoneId)) {
      return reply(400, { ok: false, message: "Phone Number ID لازم يكون أرقام بس (من 10 لـ 20 رقم)." });
    }

    // ---------- 3) التحقق من ميتا ----------
    let metaRes: Response;
    try {
      metaRes = await fetch(
        `${GRAPH}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (_e) {
      return reply(502, { ok: false, message: "تعذّر الاتصال بميتا دلوقتي. جرّب تاني بعد شوية." });
    }

    const meta = await metaRes.json().catch(() => ({}));

    if (!metaRes.ok) {
      const code = meta?.error?.code;
      const sub  = meta?.error?.error_subcode;
      let message = "ميتا رفضت البيانات دي.";

      if (code === 190) {
        message = "الـ Access Token غير صالح أو منتهي. اعمل توكن جديد من Meta وجرّب تاني.";
      } else if (code === 100 || metaRes.status === 404) {
        message = "الـ Phone Number ID ده مش موجود، أو التوكن ده مالوش صلاحية عليه. اتأكد إن الاتنين من نفس حساب واتساب بيزنس.";
      } else if (code === 10 || code === 200) {
        message = "التوكن مالوش صلاحية على الرقم ده. اتأكد من صلاحيات whatsapp_business_messaging.";
      } else if (meta?.error?.message) {
        message = "ميتا ردّت: " + meta.error.message;
      }

      return reply(400, { ok: false, message, meta_code: code ?? null, meta_subcode: sub ?? null });
    }

    if (String(meta?.id ?? "") !== phoneId) {
      return reply(400, { ok: false, message: "الرد من ميتا مش متطابق مع الرقم اللي دخلته. راجع البيانات." });
    }

    // ---------- 4) الحفظ + التوثيق ----------
    const { error: upErr } = await sb.from("tenants")
      .update({
        whatsapp_phone_id: phoneId,
        whatsapp_token: token,
        wa_verified_at: new Date().toISOString(),
      })
      .eq("id", profile.tenant_id);

    if (upErr) {
      // تريجر منع التكرار بيرمي 23505
      if (String(upErr.code) === "23505" || /مسجّل بالفعل/.test(upErr.message || "")) {
        return reply(409, {
          ok: false,
          message: "الرقم ده مربوط بمتجر تاني على سهل. كل متجر لازم يكون له رقم خاص بيه.",
        });
      }
      return reply(400, { ok: false, message: "تعذّر الحفظ: " + upErr.message });
    }

    return reply(200, {
      ok: true,
      verified: true,
      display_phone_number: meta?.display_phone_number ?? null,
      verified_name: meta?.verified_name ?? null,
      quality_rating: meta?.quality_rating ?? null,
      message: "تم التحقق من الرقم وحفظه ✅",
    });
  } catch (e) {
    console.error("wa-verify-number error", String(e));
    return reply(500, { ok: false, message: "حصل خطأ غير متوقع. جرّب تاني." });
  }
});
