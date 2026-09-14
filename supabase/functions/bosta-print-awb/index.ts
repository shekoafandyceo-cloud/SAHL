// ============================================================================
// Edge Function: bosta-print-awb (v2)
// ============================================================================
// v2: Filters orders WITHOUT tracking_no inside the function (not frontend).
//     Returns skipped_no_tracking count for clearer UX.
//     Better error messages in Arabic.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOSTA_BASE_URL = "https://app.bosta.co";
const MAX_ORDERS_PER_REQUEST = 50;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // ===== CORS preflight =====
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    // ===== 1. Parse + validate body =====
    let body: { order_ids?: string[] };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const orderIds = body?.order_ids;
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return jsonResponse(
        { error: "order_ids array is required and must contain at least one order ID" },
        400
      );
    }

    if (orderIds.length > MAX_ORDERS_PER_REQUEST) {
      return jsonResponse(
        { error: `Maximum ${MAX_ORDERS_PER_REQUEST} orders per request. Received: ${orderIds.length}` },
        400
      );
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = orderIds.filter((id) => typeof id !== "string" || !uuidRegex.test(id));
    if (invalidIds.length > 0) {
      return jsonResponse(
        { error: "Some order_ids are not valid UUIDs", invalid: invalidIds.slice(0, 5) },
        400
      );
    }

    // ===== 2. Verify user identity from JWT =====
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or malformed Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error("Missing required env vars");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized: invalid session" }, 401);
    }

    // ===== 3. Resolve tenant_id from user_profiles =====
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("tenant_id, active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("user_profiles lookup error:", profileError);
      return jsonResponse({ error: "Failed to load user profile" }, 500);
    }

    if (!profile || !profile.tenant_id) {
      return jsonResponse({ error: "User has no tenant assigned" }, 403);
    }

    if (profile.active === false) {
      return jsonResponse({ error: "User account is inactive" }, 403);
    }

    const tenantId = profile.tenant_id as string;

    // ===== 4. Fetch tenant's Bosta API key =====
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("shipping_api_key, shipping_provider")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) {
      return jsonResponse({ error: "Tenant not found" }, 404);
    }

    if (tenant.shipping_provider !== "bosta") {
      return jsonResponse(
        {
          error: `Shipping provider '${tenant.shipping_provider}' not supported yet`,
          message: "AWB printing currently supports Bosta only.",
        },
        400
      );
    }

    if (!tenant.shipping_api_key || tenant.shipping_api_key.trim().length === 0) {
      return jsonResponse(
        {
          error: "Bosta API key not configured",
          message: "حط الـ Bosta API key في الإعدادات الأول.",
        },
        400
      );
    }

    // ===== 5. Fetch orders (tenant-scoped) — NO tracking filter at DB level =====
    // We need ALL matching orders so we can report how many were skipped
    const { data: orders, error: ordersError } = await admin
      .from("orders")
      .select("id, tracking_no, customer_name, status")
      .in("id", orderIds)
      .eq("tenant_id", tenantId);

    if (ordersError) {
      console.error("orders lookup error:", ordersError);
      return jsonResponse({ error: "Failed to fetch orders" }, 500);
    }

    const foundOrders = orders || [];
    const notFoundCount = orderIds.length - foundOrders.length;

    // Split into: has tracking | no tracking
    const validOrders = foundOrders.filter(
      (o) => typeof o.tracking_no === "string" && o.tracking_no.trim().length > 0
    );
    const skippedNoTracking = foundOrders.length - validOrders.length;

    if (validOrders.length === 0) {
      return jsonResponse(
        {
          error: "No orders with tracking numbers",
          message: skippedNoTracking > 0
            ? `كل الـ ${skippedNoTracking} أوردر اللي اخترتهم مفيهمش رقم تتبع (tracking_no). لازم تتبعت لبوسطة الأول.`
            : "الأوردرات دي ملكش صلاحية عليها أو موجودةش.",
          requested_count: orderIds.length,
          found_count: foundOrders.length,
          skipped_no_tracking: skippedNoTracking,
          not_found: notFoundCount,
        },
        400
      );
    }

    // ===== 6. Call Bosta API =====
    const trackingNumbers = validOrders.map((o) => o.tracking_no!.trim()).join(",");
    const bostaUrl = `${BOSTA_BASE_URL}/api/v0/deliveries/awb?trackingNumbers=${encodeURIComponent(trackingNumbers)}`;

    let bostaResp: Response;
    try {
      bostaResp = await fetch(bostaUrl, {
        method: "GET",
        headers: {
          "Authorization": tenant.shipping_api_key,
          "Content-Type": "application/json",
        },
      });
    } catch (fetchErr) {
      console.error("Bosta fetch failed:", fetchErr);
      return jsonResponse(
        { error: "Failed to connect to Bosta API", details: String(fetchErr) },
        502
      );
    }

    if (!bostaResp.ok) {
      const errorText = await bostaResp.text();
      let errorMessage = errorText.slice(0, 500);
      try {
        const errJson = JSON.parse(errorText);
        if (errJson?.message) errorMessage = errJson.message;
      } catch {
        // not JSON
      }

      // Arabic translation of common Bosta errors
      let userFriendly = errorMessage;
      if (/final state/i.test(errorMessage)) {
        userFriendly = "بوسطة رفضت الطباعة: بعض الأوردرات في حالة نهائية (مسلّمة/ملغية/مرتجعة)";
      } else if (/Couldn't find deliveries/i.test(errorMessage)) {
        userFriendly = "بوسطة مش لاقية الشحنات دي في نظامها (ممكن لسه ما اتسجلتش)";
      }

      return jsonResponse(
        {
          error: "Bosta refused to print",
          bosta_status: bostaResp.status,
          message: userFriendly,
          original_message: errorMessage,
          attempted_count: validOrders.length,
        },
        502
      );
    }

    const bostaData = await bostaResp.json();
    if (!bostaData?.data || typeof bostaData.data !== "string") {
      return jsonResponse(
        { error: "Bosta returned no PDF data", response: bostaData },
        502
      );
    }

    // ===== 7. Mark orders as AWB-printed (atomic via RPC) =====
    const printedOrderIds = validOrders.map((o) => o.id);
    const { error: markError } = await admin.rpc("mark_awb_printed", {
      p_order_ids: printedOrderIds,
      p_tenant_id: tenantId,
    });
    if (markError) {
      console.error("mark_awb_printed RPC failed:", markError);
    }

    // ===== 8. Success response =====
    return jsonResponse({
      success: true,
      pdf_base64: bostaData.data,
      printed_count: validOrders.length,
      requested_count: orderIds.length,
      skipped_no_tracking: skippedNoTracking,
      not_found: notFoundCount,
      tracking_numbers: validOrders.map((o) => o.tracking_no),
      printed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Edge function unhandled error:", err);
    return jsonResponse(
      { error: "Internal server error", details: String(err) },
      500
    );
  }
});
