import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSlug(value: unknown) {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9-_]/g, "");
}

function pickTenantPayload(raw: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {};

  if ("store_name" in raw) payload.store_name = cleanString(raw.store_name);
  if ("slug" in raw) payload.slug = cleanSlug(raw.slug);
  if ("plan" in raw) payload.plan = cleanString(raw.plan) || "starter";
  if ("monthly_price" in raw) payload.monthly_price = Number(raw.monthly_price || 0);
  if ("plan_expires_at" in raw) payload.plan_expires_at = raw.plan_expires_at || null;
  if ("notes" in raw) payload.notes = cleanString(raw.notes) || null;
  if ("active" in raw) payload.active = Boolean(raw.active);

  return payload;
}

async function requireSuperAdmin(req: Request) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase environment variables.");
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: json({ error: "unauthorized", message: "Missing Authorization token" }, 401) };
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const authUser = userData?.user;
  if (userErr || !authUser) {
    return { error: json({ error: "unauthorized", message: "Invalid or expired token" }, 401) };
  }

  const { data: profile, error: profileErr } = await admin
    .from("user_profiles")
    .select("id, full_name, role, active, is_super_admin")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return { error: json({ error: "forbidden", message: "Super Admin profile not found" }, 403) };
  }

  if (profile.active === false || profile.is_super_admin !== true) {
    return { error: json({ error: "forbidden", message: "This action requires Super Admin access" }, 403) };
  }

  return { authUser, profile };
}

async function getProfile(userId: string) {
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, tenant_id, full_name, role, active, is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function assertTenantExists(tenantId: string) {
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Tenant not found");
}

async function createUserWithProfile(input: {
  tenant_id: string;
  email: string;
  password: string;
  full_name: string;
  role: "admin" | "employee";
}) {
  const email = cleanString(input.email).toLowerCase();
  const password = String(input.password || "");
  const fullName = cleanString(input.full_name) || email;
  const role = input.role === "admin" ? "admin" : "employee";

  if (!email || !password) throw new Error("Email and password are required");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role, tenant_id: input.tenant_id },
  });

  if (createErr || !created?.user) throw createErr || new Error("Failed to create auth user");

  const authUser = created.user;
  const { error: profileErr } = await admin.from("user_profiles").upsert({
    id: authUser.id,
    tenant_id: input.tenant_id,
    full_name: fullName,
    role,
    active: true,
    is_super_admin: false,
  });

  if (profileErr) {
    await admin.auth.admin.deleteUser(authUser.id);
    throw profileErr;
  }

  return { id: authUser.id, email: authUser.email, full_name: fullName, role };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const action = cleanString(body.action);

    if (action === "create_tenant_with_admin") {
      const tenantPayload = pickTenantPayload(body.tenant || {});
      if (!tenantPayload.store_name || !tenantPayload.slug) {
        return json({ error: "validation_error", message: "store_name and slug are required" }, 400);
      }
      tenantPayload.active = body.tenant?.active !== false;

      const { data: tenant, error: tenantErr } = await admin
        .from("tenants")
        .insert(tenantPayload)
        .select("id, slug, store_name, active, plan, plan_expires_at, monthly_price, notes, created_at")
        .single();

      if (tenantErr || !tenant) throw tenantErr || new Error("Failed to create tenant");

      try {
        const userInput = body.user || {};
        const user = await createUserWithProfile({
          tenant_id: tenant.id,
          email: userInput.email,
          password: userInput.password,
          full_name: userInput.full_name,
          role: "admin",
        });
        return json({ ok: true, tenant, user });
      } catch (userErr) {
        await admin.from("tenants").delete().eq("id", tenant.id);
        throw userErr;
      }
    }

    if (action === "update_tenant") {
      const tenantId = cleanString(body.tenant_id);
      if (!tenantId) return json({ error: "validation_error", message: "tenant_id is required" }, 400);

      const tenantPayload = pickTenantPayload(body.tenant || {});
      delete tenantPayload.active;
      if (tenantPayload.store_name === "") delete tenantPayload.store_name;
      if (tenantPayload.slug === "") delete tenantPayload.slug;

      const { data, error } = await admin
        .from("tenants")
        .update(tenantPayload)
        .eq("id", tenantId)
        .select("id, slug, store_name, active, plan, plan_expires_at, monthly_price, notes, created_at")
        .single();
      if (error) throw error;
      return json({ ok: true, tenant: data });
    }

    if (action === "toggle_tenant") {
      const tenantId = cleanString(body.tenant_id);
      if (!tenantId) return json({ error: "validation_error", message: "tenant_id is required" }, 400);

      const { data, error } = await admin
        .from("tenants")
        .update({ active: Boolean(body.active) })
        .eq("id", tenantId)
        .select("id, active")
        .single();
      if (error) throw error;
      return json({ ok: true, tenant: data });
    }

    if (action === "list_employees") {
      const tenantId = cleanString(body.tenant_id);
      if (!tenantId) return json({ error: "validation_error", message: "tenant_id is required" }, 400);

      const { data: profiles, error } = await admin
        .from("user_profiles")
        .select("id, full_name, role, active, last_seen, is_super_admin")
        .eq("tenant_id", tenantId)
        .order("role", { ascending: true });
      if (error) throw error;

      const users = await Promise.all((profiles || []).map(async (profile) => {
        const { data: authData } = await admin.auth.admin.getUserById(profile.id);
        return {
          id: profile.id,
          email: authData?.user?.email || "",
          full_name: profile.full_name,
          role: profile.role,
          active: profile.active,
          last_seen: profile.last_seen,
          is_super_admin: profile.is_super_admin,
        };
      }));

      return json({ ok: true, users });
    }

    if (action === "create_employee") {
      const tenantId = cleanString(body.tenant_id);
      if (!tenantId) return json({ error: "validation_error", message: "tenant_id is required" }, 400);
      await assertTenantExists(tenantId);

      const userInput = body.user || {};
      const role = userInput.role === "admin" ? "admin" : "employee";
      const user = await createUserWithProfile({
        tenant_id: tenantId,
        email: userInput.email,
        password: userInput.password,
        full_name: userInput.full_name,
        role,
      });
      return json({ ok: true, user });
    }

    if (action === "toggle_employee") {
      const userId = cleanString(body.user_id);
      if (!userId) return json({ error: "validation_error", message: "user_id is required" }, 400);

      const profile = await getProfile(userId);
      if (!profile) return json({ error: "not_found", message: "User profile not found" }, 404);
      if (profile.is_super_admin) return json({ error: "forbidden", message: "Cannot toggle Super Admin users" }, 403);

      const { data, error } = await admin
        .from("user_profiles")
        .update({ active: Boolean(body.active) })
        .eq("id", userId)
        .select("id, active")
        .single();
      if (error) throw error;
      return json({ ok: true, user: data });
    }

    if (action === "reset_password") {
      const userId = cleanString(body.user_id);
      const password = String(body.password || "");
      if (!userId || !password) return json({ error: "validation_error", message: "user_id and password are required" }, 400);
      if (password.length < 6) return json({ error: "validation_error", message: "Password must be at least 6 characters" }, 400);

      const profile = await getProfile(userId);
      if (!profile) return json({ error: "not_found", message: "User profile not found" }, 404);
      if (profile.is_super_admin) return json({ error: "forbidden", message: "Cannot reset Super Admin password from this panel" }, 403);

      const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      return json({ ok: true, user: { id: data.user?.id } });
    }

    if (action === "delete_user") {
      const userId = cleanString(body.user_id);
      if (!userId) return json({ error: "validation_error", message: "user_id is required" }, 400);

      const profile = await getProfile(userId);
      if (profile?.is_super_admin) return json({ error: "forbidden", message: "Cannot delete Super Admin users" }, 403);

      let del = await admin.auth.admin.deleteUser(userId);
      if (del.error) {
        await admin.from("user_profiles").delete().eq("id", userId);
        del = await admin.auth.admin.deleteUser(userId);
        if (del.error && !String(del.error.message || "").toLowerCase().includes("not found")) throw del.error;
      }
      await admin.from("user_profiles").delete().eq("id", userId);
      return json({ ok: true });
    }

    return json({ error: "unknown_action", message: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("platform-admin error", e);
    return json({ error: "internal_error", message: e?.message || String(e) }, 500);
  }
});
