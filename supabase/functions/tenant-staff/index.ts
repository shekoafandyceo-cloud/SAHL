// tenant-staff — إدارة موظفين المتجر من لوحة التاجر.
//
// ليه Edge Function ومش RPC؟ إنشاء حساب بباسورد محتاج Supabase Admin API
// (auth.admin.createUser) واللي محتاجة service_role — ودي عمرها ما تنزل
// للمتصفح. الـFunction هي المكان الوحيد اللي المفتاح ده يقعد فيه.
//
// ليه مش توسيع `platform-admin`؟ الدالة دي بتخدم لوحة السوبر أدمن وعندها
// ثابت واحد: «سوبر أدمن بس». تخفيفه عشان ميزة تاجر = فتح سطح على أعلى
// صلاحية في المنتج. الفصل أرخص وأأمن.
//
// 🔴 الثابت الحاكم هنا: `tenant_id` **عمره ما بييجي من الـbody**. بيتقرا من
// بروفايل صاحب الـJWT. ولو جه في الـbody بيتطنّش. من غير ده أي أدمن تاجر
// يقدر يضيف موظف على متجر تاجر تاني بتعديل الطلب من الكونسول.
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

const MIN_PASSWORD = 8;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** صاحب الطلب لازم يكون أدمن نشط لمتجر — والمتجر بتاعه هو النطاق كله. */
async function requireTenantAdmin(req: Request) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { error: json({ error: "config", message: "إعدادات السيرفر ناقصة" }, 500) };
  }
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ error: "unauthorized", message: "لازم تسجّل دخول" }, 401) };

  const { data: got, error: uErr } = await admin.auth.getUser(token);
  const caller = got?.user;
  if (uErr || !caller) {
    return { error: json({ error: "unauthorized", message: "الجلسة انتهت — سجّل دخول تاني" }, 401) };
  }

  const { data: profile, error: pErr } = await admin
    .from("user_profiles")
    .select("id, tenant_id, full_name, role, active, is_super_admin")
    .eq("id", caller.id)
    .maybeSingle();

  if (pErr || !profile) {
    return { error: json({ error: "forbidden", message: "مفيش بروفايل للحساب ده" }, 403) };
  }
  if (profile.active === false) {
    return { error: json({ error: "forbidden", message: "الحساب موقوف" }, 403) };
  }
  if (profile.role !== "admin") {
    return { error: json({ error: "forbidden", message: "الصلاحية دي للأدمن فقط" }, 403) };
  }
  if (!profile.tenant_id) {
    return { error: json({ error: "forbidden", message: "الحساب مش مربوط بمتجر" }, 403) };
  }
  return { caller, profile, tenantId: profile.tenant_id as string };
}

/** الصف المستهدف لازم يكون في نفس المتجر — وده الحاجز اللي بيمنع العبور. */
async function requireSameTenantTarget(userId: string, tenantId: string) {
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, tenant_id, full_name, role, active, is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  // نفس رسالة «مش موجود» لو الصف في متجر تاني — عشان مانأكدش وجود حساب
  // بره المتجر لحد بيجرّب معرّفات
  if (!data || data.tenant_id !== tenantId) {
    return { error: json({ error: "not_found", message: "الموظف ده مش في متجرك" }, 404) };
  }
  if (data.is_super_admin) {
    return { error: json({ error: "forbidden", message: "الحساب ده محمي" }, 403) };
  }
  return { target: data };
}

async function emailFor(id: string) {
  try {
    const { data } = await admin.auth.admin.getUserById(id);
    return data?.user?.email || "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await requireTenantAdmin(req);
  if ("error" in auth) return auth.error;
  const { caller, tenantId } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const action = str(body.action);

    // ── قايمة موظفين المتجر ────────────────────────────────────────────
    // الإيميلات في auth.users والمتصفح مايقراهاش، فالقايمة بتعدّي من هنا.
    if (action === "list") {
      const { data: rows, error } = await admin
        .from("user_profiles")
        .select("id, full_name, role, active, last_seen, created_at, is_super_admin, upsell_commission_enabled, upsell_commission_type, upsell_commission_value")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const users = await Promise.all((rows || []).map(async (r) => ({
        id: r.id,
        email: await emailFor(r.id),
        full_name: r.full_name,
        role: r.role,
        active: r.active,
        last_seen: r.last_seen,
        created_at: r.created_at,
        // إعدادات العمولة للعرض بس — الحساب الفعلي بيتم في save_order_products
        // من صف الموظف على السيرفر، فالقيم دي مالهاش أي أثر لو اتزوّرت
        upsell_commission_enabled: r.upsell_commission_enabled === true,
        upsell_commission_type: r.upsell_commission_type,
        upsell_commission_value: r.upsell_commission_value,
        is_self: r.id === caller.id,
        // الأدمن مايقدرش يلمس نفسه ولا حساب محمي — الواجهة بتقفل الأزرار
        // بناءً على ده، والسيرفر بيرفض برضه لو اتحايل عليها
        locked: r.id === caller.id || r.is_super_admin === true,
      })));
      return json({ ok: true, users });
    }

    // ── إضافة موظف ─────────────────────────────────────────────────────
    if (action === "create") {
      const email = str(body.email).toLowerCase();
      const password = String(body.password || "");
      const fullName = str(body.full_name) || email;
      const role = body.role === "admin" ? "admin" : "employee";

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "validation", message: "البريد الإلكتروني مش مظبوط" }, 400);
      }
      if (password.length < MIN_PASSWORD) {
        return json({ error: "validation", message: `كلمة المرور لازم ${MIN_PASSWORD} حروف على الأقل` }, 400);
      }
      if (!str(body.full_name)) {
        return json({ error: "validation", message: "اكتب اسم الموظف" }, 400);
      }

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,   // الأدمن هو اللي بيعمل الحساب — مفيش إيميل تأكيد
        user_metadata: { full_name: fullName, role, tenant_id: tenantId },
      });
      if (cErr || !created?.user) {
        const m = String(cErr?.message || "").toLowerCase();
        if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
          return json({ error: "duplicate", message: "البريد ده مسجّل بالفعل" }, 409);
        }
        throw cErr || new Error("failed to create user");
      }

      const { error: pErr } = await admin.from("user_profiles").upsert({
        id: created.user.id,
        tenant_id: tenantId,
        full_name: fullName,
        role,
        active: true,
        is_super_admin: false,   // ممنوع تصعيد الصلاحية من هنا — أبداً
      });
      if (pErr) {
        // البروفايل فشل → نمسح حساب الـauth بدل ما يفضل يتيم ويقفل الإيميل
        await admin.auth.admin.deleteUser(created.user.id);
        throw pErr;
      }

      return json({ ok: true, user: { id: created.user.id, email, full_name: fullName, role, active: true } });
    }

    // ── تعطيل / تفعيل ──────────────────────────────────────────────────
    if (action === "toggle") {
      const userId = str(body.user_id);
      if (!userId) return json({ error: "validation", message: "user_id مطلوب" }, 400);
      if (userId === caller.id) {
        return json({ error: "forbidden", message: "مينفعش تعطّل نفسك" }, 403);
      }
      const t = await requireSameTenantTarget(userId, tenantId);
      if ("error" in t) return t.error;

      const active = Boolean(body.active);
      const { data, error } = await admin
        .from("user_profiles")
        .update({ active })
        .eq("id", userId)
        .eq("tenant_id", tenantId)   // حزام وحمّالة — الفلتر تاني مرة
        .select("id, active")
        .single();
      if (error) throw error;
      return json({ ok: true, user: data });
    }

    // ── حذف نهائي ──────────────────────────────────────────────────────
    // ⚠️ اسم الموظف مكتوب جوه status_log و call_attempts في الأوردرات.
    // الحذف مابيمسحهاش (وده مقصود — السجل التاريخي مايتغيّرش)، بس
    // مايبقاش فيه حساب وراها.
    if (action === "delete") {
      const userId = str(body.user_id);
      if (!userId) return json({ error: "validation", message: "user_id مطلوب" }, 400);
      if (userId === caller.id) {
        return json({ error: "forbidden", message: "مينفعش تمسح نفسك" }, 403);
      }
      const t = await requireSameTenantTarget(userId, tenantId);
      if ("error" in t) return t.error;

      // البروفايل الأول: لو مسح الـauth فشل، مايبقاش فيه صف بيدي وصول
      const { error: dErr } = await admin
        .from("user_profiles")
        .delete()
        .eq("id", userId)
        .eq("tenant_id", tenantId);
      if (dErr) throw dErr;

      const del = await admin.auth.admin.deleteUser(userId);
      if (del.error && !String(del.error.message || "").toLowerCase().includes("not found")) {
        throw del.error;
      }
      return json({ ok: true });
    }

    return json({ error: "unknown_action", message: `أكشن مش معروف: ${action}` }, 400);
  } catch (e) {
    console.error("tenant-staff", e);
    return json({ error: "internal", message: (e as Error)?.message || String(e) }, 500);
  }
});
