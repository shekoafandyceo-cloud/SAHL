import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH = "https://graph.facebook.com/v18.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const J = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...cors } });

Deno.serve(async (req: Request) => {
  // CORS preflight (المتصفح بيبعت OPTIONS الأول)
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return J({ ok: false, error: "method" }, 405);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return J({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const conversationId = body?.conversation_id;
    const text = (body?.text ?? "").toString().trim();
    const imagePath = body?.image_path ?? null;
    const documentPath = body?.document_path ?? null;
    const filename = (body?.filename ?? "").toString();
    const caption = (body?.caption ?? "").toString();
    const replyToRaw = body?.reply_to ?? null;
    const replyTo = replyToRaw ? String(replyToRaw).trim() : null;
    if (!conversationId) return J({ ok: false, error: "missing_conversation" }, 400);
    if (!text && !imagePath && !documentPath) return J({ ok: false, error: "empty_message" }, 400);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) تصريح + تحميل المحادثة عبر RLS
    const convRes = await userClient.from("wa_conversations")
      .select("id, tenant_id, wa_id, last_inbound_at").eq("id", conversationId).maybeSingle();
    const conv = convRes.data;
    if (!conv) return J({ ok: false, error: "not_allowed" }, 403);

    // 1أ‌ب) 🔴 **مسار الميديا جاي من المتصفح فمايتصدّقش.** الرابط الموقّع
    // بيتعمل بـservice، يعني بيتخطى سياسة الـStorage اللي بتعزل بأول مجلد
    // (= معرّف المتجر). من غير الحارس ده موظف يبعت مسار بتاع **متجر تاني**
    // في `image_path`، وإحنا نوقّعه ونبعته لرقم هو بيتحكم فيه — تسريب
    // ميديا بين التجار بضغطة. نفس منطق `bad_reply_target`: **رفض صريح**.
    // (والمسارات اللي اللوحة بتبنيها كلها `<tenant_id>/…` أصلاً، سواء
    // مرفق المحادثة أو صور الردود الجاهزة.)
    const mediaPath = imagePath || documentPath;
    if (mediaPath) {
      const prefix = `${conv.tenant_id}/`;
      if (typeof mediaPath !== "string" || !mediaPath.startsWith(prefix) || mediaPath.includes("..")) {
        console.error("wa-send bad media path", String(mediaPath).slice(0, 80));
        return J({ ok: false, error: "bad_media_path" }, 400);
      }
    }

    // 1ب) 🔴 مين اللي بيبعت؟ **من التوكن مش من الـbody**.
    // لو الاسم جه من الطلب، أي حد يقدر ينسب رسالته لزميله. والعمودين دول
    // متمنوعين على `authenticated` بصلاحيات الأعمدة، فده المسار الوحيد ليهم.
    // الاسم **لقطة مجمّدة** وقت الإرسال — تغييره بعدين مايعيدش كتابة التاريخ.
    // وفشل قراءة الاسم مايوقفش الإرسال: رسالة من غير نسبة أحسن من رسالة
    // ماتبعتتش (والواجهة بتعرض «من غير اسم» مش اسم مخترع).
    let sentBy: string | null = null;
    let sentByName: string | null = null;
    try {
      const { data: authData } = await userClient.auth.getUser();
      const uid = authData?.user?.id ?? null;
      if (uid) {
        sentBy = uid;
        const pRes = await svc.from("user_profiles")
          .select("full_name, tenant_id").eq("id", uid).maybeSingle();
        // حارس: الاسم يتسجّل بس لو الموظف من نفس متجر المحادثة
        if (pRes.data && pRes.data.tenant_id === conv.tenant_id) {
          sentByName = (pRes.data.full_name || "").trim() || null;
        }
      }
    } catch (e) {
      console.error("wa-send sender lookup", String(e));
    }

    // 1ج) 🔴 الرد على رسالة معينة — **المعرّف جاي من المتصفح فمايتصدّقش**.
    // من غير الحارس ده: موظف يبعت wamid بتاع **محادثة تانية** (أو تاجر
    // تاني) ونخزنه في `reply_to_wa_id`، فالواجهة ترسم اقتباس لرسالة مش
    // من هنا = تسريب محتوى بين المحادثات. فالتحقق **بالثلاثة مع بعض**:
    // نفس المتجر + نفس المحادثة + المعرّف.
    // وبـservice مش بتوكن المستخدم: المحادثة اتصرح عليها فوق بالفعل عبر RLS.
    let ctxId: string | null = null;
    if (replyTo) {
      const q = await svc.from("wa_messages").select("wa_message_id")
        .eq("tenant_id", conv.tenant_id)
        .eq("conversation_id", conv.id)
        .eq("wa_message_id", replyTo)
        .maybeSingle();
      // مش موجودة في المحادثة دي = **رفض صريح** مش تجاهل صامت.
      // لو تجاهلناها، الموظف هيفتكر إنه رد والعميل هيوصله نص سايح.
      if (!q.data) return J({ ok: false, error: "bad_reply_target" }, 400);
      ctxId = q.data.wa_message_id;
    }

    // 2) نافذة الـ 24 ساعة
    const lastIn = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
    if (!lastIn || (Date.now() - lastIn) >= 24 * 3600 * 1000) {
      return J({ ok: false, error: "window_closed" });
    }

    // 3) مفاتيح الـ tenant (service)
    const tRes = await svc.from("tenants").select("whatsapp_token, whatsapp_phone_id").eq("id", conv.tenant_id).maybeSingle();
    const tenant = tRes.data;
    if (!tenant?.whatsapp_token || !tenant?.whatsapp_phone_id) return J({ ok: false, error: "no_wa_config" }, 400);

    // 4) بناء الرسالة
    let payload: any;
    let storedType = "text";
    let storedBody: string | null = text || null;
    if (imagePath) {
      const signed = await svc.storage.from("wa-media").createSignedUrl(imagePath, 600);
      const link = signed.data?.signedUrl;
      if (!link) return J({ ok: false, error: "media_url_failed" }, 500);
      payload = { messaging_product: "whatsapp", to: conv.wa_id, type: "image", image: { link, ...(caption ? { caption } : {}) } };
      storedType = "image"; storedBody = caption || null;
    } else if (documentPath) {
      const signed = await svc.storage.from("wa-media").createSignedUrl(documentPath, 600);
      const link = signed.data?.signedUrl;
      if (!link) return J({ ok: false, error: "media_url_failed" }, 500);
      payload = { messaging_product: "whatsapp", to: conv.wa_id, type: "document", document: { link, ...(filename ? { filename } : {}), ...(caption ? { caption } : {}) } };
      storedType = "document"; storedBody = caption || null;
    } else {
      payload = { messaging_product: "whatsapp", to: conv.wa_id, type: "text", text: { body: text } };
    }
    // `context` في **جذر** الحمولة — من توثيق ميتا الرسمي (BaseMessageProperties)،
    // فبيشتغل مع النص والصورة والملف سوا.
    if (ctxId) payload.context = { message_id: ctxId };

    // 5) إرسال عبر Cloud API
    const waRes = await fetch(`${GRAPH}/${tenant.whatsapp_phone_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tenant.whatsapp_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const waJson = await waRes.json().catch(() => ({}));
    if (!waRes.ok) {
      const code = waJson?.error?.code;
      if (code === 131047 || code === 131051 || code === 470) return J({ ok: false, error: "window_closed" });
      console.error("wa api error", waRes.status, JSON.stringify(waJson?.error || {}));
      // 🔴 رفض بسبب الاقتباس: توثيق ميتا **مابيذكرش** أكواد محددة
      // للـcontext (ولا حدود عمر الرسالة المقتبسة)، فمانفترضش رقم.
      // بنستخدم المعلومة الوحيدة المؤكدة: لو فيه اقتباس والإرسال فشل،
      // الموظف يعرف يجرب من غير رد بدل «حصلت مشكلة» العامة.
      if (ctxId) return J({ ok: false, error: "reply_failed", detail: waJson?.error?.message || `http ${waRes.status}` });
      return J({ ok: false, error: "wa_error", detail: waJson?.error?.message || `http ${waRes.status}` });
    }
    const wamid = waJson?.messages?.[0]?.id || null;

    // 6) تخزين الرسالة الصادرة (status=sent — webhook الحالات بيرقّيها)
    const ins = await svc.from("wa_messages").insert({
      tenant_id: conv.tenant_id,
      conversation_id: conv.id,
      wa_message_id: wamid,
      direction: "out",
      type: storedType,
      body: storedBody,
      media_path: imagePath || documentPath,
      media_filename: documentPath ? (filename || null) : null,
      status: "sent",
      wa_timestamp: new Date().toISOString(),
      sent_by: sentBy,
      sent_by_name: sentByName,
      reply_to_wa_id: ctxId,
    }).select("id").single();

    return J({ ok: true, message_id: wamid, row_id: ins.data?.id || null, sent_by_name: sentByName, reply_to: ctxId });
  } catch (e) {
    console.error("wa-send error", String(e));
    return J({ ok: false, error: "server_error" }, 500);
  }
});
