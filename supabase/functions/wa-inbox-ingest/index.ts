import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v18.0";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr", "audio/aac": "aac", "audio/wav": "wav",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

function extFromMime(mime?: string | null): string {
  if (!mime) return "bin";
  const base = mime.split(";")[0].trim().toLowerCase();
  return MIME_EXT[base] || "bin";
}

// للأعمدة النصية: ميتا ممكن تبعت source_id كرقم، وPostgREST بيرفضه على عمود text
function asText(v: unknown): string | null {
  return v == null ? null : String(v);
}

async function downloadMedia(
  sb: any, tenantId: string, conversationId: string, msgId: string,
  mediaId: string, mime: string | null, token: string,
): Promise<string | null> {
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!metaRes.ok) throw new Error(`meta-meta ${metaRes.status}`);
  const meta = await metaRes.json();
  const url = meta?.url;
  if (!url) throw new Error("no media url");
  const realMime = mime || meta?.mime_type || null;
  const binRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!binRes.ok) throw new Error(`meta-bin ${binRes.status}`);
  const buf = new Uint8Array(await binRes.arrayBuffer());
  const path = `${tenantId}/${conversationId}/${msgId}.${extFromMime(realMime)}`;
  const up = await sb.storage.from("wa-media").upload(path, buf, {
    contentType: realMime || "application/octet-stream", upsert: true,
  });
  if (up.error) throw up.error;
  return path;
}

async function getOrCreateConversation(
  sb: any, tenantId: string, waId: string, phone: string | null, name: string | null,
): Promise<string | null> {
  const sel = await sb.from("wa_conversations").select("id, customer_name")
    .eq("tenant_id", tenantId).eq("wa_id", waId).maybeSingle();
  if (sel.data) {
    if (name && !sel.data.customer_name) {
      await sb.from("wa_conversations").update({ customer_name: name }).eq("id", sel.data.id);
    }
    return sel.data.id;
  }
  const ins = await sb.from("wa_conversations")
    .insert({ tenant_id: tenantId, wa_id: waId, customer_phone: phone, customer_name: name })
    .select("id").single();
  if (ins.data) return ins.data.id;
  const re = await sb.from("wa_conversations").select("id")
    .eq("tenant_id", tenantId).eq("wa_id", waId).maybeSingle();
  return re.data?.id ?? null;
}

// إعلانات Click-to-WhatsApp: الرسالة بتيجي نوعها text عادي، لكن جنبها
// object اسمه referral فيه source_id (معرّف الإعلان) وheadline وctwa_clid.
// الـ ctwa_clid ده هو اللي Conversions API بيحتاجه عشان ينسب الأوردر للإعلان،
// وواتساب بيبعته **مع أول رسالة بعد الضغط بس** — لو ضاع مفيش طريقة نجيبه تاني.
async function applyReferral(
  sb: any, conversationId: string, firstTs: string | null, last: any, lastTs: string | null,
): Promise<void> {
  const stamp = lastTs || new Date().toISOString();
  await sb.from("wa_conversations").update({
    ctwa_clid:        asText(last?.ctwa_clid),
    ctwa_ad_id:       asText(last?.source_id),
    ctwa_headline:    asText(last?.headline),
    ctwa_source_type: asText(last?.source_type),
    ctwa_last_at:     stamp,
  }).eq("id", conversationId);

  // أول مرة بس — لو العميل رجع من إعلان تاني مابنمسحش تاريخ أول دخول
  await sb.from("wa_conversations")
    .update({ ctwa_first_at: firstTs || stamp })
    .eq("id", conversationId)
    .is("ctwa_first_at", null);
}

// تحديث حالة الرسائل الصادرة (تسليم/قراءة/فشل) من webhook الحالات
async function processStatuses(sb: any, tenantId: string, statuses: any[]): Promise<void> {
  const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
  for (const s of statuses) {
    const wamid = s?.id;
    const st = s?.status;
    if (!wamid || !st) continue;
    const cur = await sb.from("wa_messages").select("id, status")
      .eq("tenant_id", tenantId).eq("wa_message_id", wamid).maybeSingle();
    if (!cur.data) continue;
    const curRank = RANK[cur.data.status] || 0;
    const newRank = RANK[st] || 0;
    // ما ننزّلش الحالة لتحت (مثلاً read وصلت قبل delivered)
    if (newRank > curRank) {
      await sb.from("wa_messages").update({ status: st }).eq("id", cur.data.id);
    }
  }
}

// كل الشغل التقيل (داتا بيز + تنزيل ميديا) بيحصل هنا في الخلفية
async function processPayload(payload: any, secret: string): Promise<void> {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const secRow = await sb.from("platform_settings").select("value").eq("key", "wa_ingest_secret").maybeSingle();
  const expected = secRow.data?.value || "";
  if (expected && secret !== expected) return;

  const entry = payload?.entry?.[0] ?? payload?.body?.entry?.[0];
  const value = entry?.changes?.[0]?.value;
  if (!value) return;

  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const tenantRes = await sb.from("tenants").select("id, whatsapp_token")
    .eq("whatsapp_phone_id", String(phoneNumberId)).maybeSingle();
  const tenant = tenantRes.data;
  if (!tenant) return;

  // 1) webhook الحالات (delivery/read) — مفيهوش messages
  const statuses = value?.statuses;
  if (Array.isArray(statuses) && statuses.length > 0) {
    await processStatuses(sb, tenant.id, statuses);
    return;
  }

  // 2) webhook الرسائل الواردة
  const messages = value?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;

  const contact = value?.contacts?.[0];
  const waId = contact?.wa_id || messages[0]?.from;
  if (!waId) return;
  const customerName = contact?.profile?.name || null;
  const customerPhone = String(waId).replace(/^20/, "0");

  const conversationId = await getOrCreateConversation(sb, tenant.id, String(waId), customerPhone, customerName);
  if (!conversationId) return;

  let firstRef: any = null, firstRefTs: string | null = null;
  let lastRef: any = null, lastRefTs: string | null = null;

  for (const m of messages) {
    const waMsgId = m?.id || null;
    if (waMsgId) {
      const dup = await sb.from("wa_messages").select("id")
        .eq("tenant_id", tenant.id).eq("wa_message_id", waMsgId).maybeSingle();
      if (dup.data) continue;
    }
    const ts = m?.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null;
    // «رد على رسالة»: واتساب بيبعت context.id = معرّف الرسالة المقتبسة.
    // بنخزّن المعرّف بس — واتساب **مابيبعتش نص** الرسالة المقتبسة،
    // فالواجهة بتحلّه من الرسايل المحمّلة. ولو مالقتهاش (رسالة أقدم من
    // الـ500، أو رسالة تأكيد آلية من n8n مش متسجّلة عندنا) بتقول «رد على
    // رسالة أقدم» من غير ما تخترع نص.
    const replyTo: string | null = m?.context?.id ?? null;
    // referral موجود بس لو الرسالة جاية من إعلان CTWA
    const referral = m?.referral ?? null;
    if (referral) {
      if (!firstRef) { firstRef = referral; firstRefTs = ts; }
      lastRef = referral; lastRefTs = ts;
    }
    let type = m?.type || "other";
    let body: string | null = null;
    let mediaId: string | null = null;
    let mediaMime: string | null = null;
    let mediaFilename: string | null = null;

    if (type === "text") {
      body = m?.text?.body ?? null;
    } else if (type === "image") {
      mediaId = m?.image?.id ?? null; mediaMime = m?.image?.mime_type ?? null; body = m?.image?.caption ?? null;
    } else if (type === "audio") {
      mediaId = m?.audio?.id ?? null; mediaMime = m?.audio?.mime_type ?? null;
      if (m?.audio?.voice === true) type = "voice";
    } else if (type === "voice") {
      mediaId = m?.voice?.id ?? null; mediaMime = m?.voice?.mime_type ?? null;
    } else if (type === "video") {
      mediaId = m?.video?.id ?? null; mediaMime = m?.video?.mime_type ?? null; body = m?.video?.caption ?? null;
    } else if (type === "document") {
      mediaId = m?.document?.id ?? null; mediaMime = m?.document?.mime_type ?? null;
      mediaFilename = m?.document?.filename ?? null; body = m?.document?.caption ?? null;
    } else if (type === "sticker") {
      mediaId = m?.sticker?.id ?? null; mediaMime = m?.sticker?.mime_type ?? null;
    } else if (type === "button") {
      body = m?.button?.text ?? m?.button?.payload ?? null;
    } else if (type === "interactive") {
      body = m?.interactive?.button_reply?.title ?? m?.interactive?.list_reply?.title ?? null;
    } else {
      try { body = JSON.stringify(m?.[type] ?? {}); } catch { body = null; }
    }

    let mediaPath: string | null = null;
    if (mediaId && tenant.whatsapp_token) {
      try {
        mediaPath = await downloadMedia(sb, tenant.id, conversationId, waMsgId || crypto.randomUUID(), mediaId, mediaMime, tenant.whatsapp_token);
      } catch (e) {
        console.error("media download failed", String(e));
      }
    }

    await sb.from("wa_messages").insert({
      tenant_id: tenant.id,
      conversation_id: conversationId,
      wa_message_id: waMsgId,
      direction: "in",
      type,
      body,
      media_path: mediaPath,
      media_mime: mediaMime,
      media_filename: mediaFilename,
      wa_timestamp: ts,
      reply_to_wa_id: replyTo,
      referral,
    });
  }

  if (lastRef) {
    try {
      await applyReferral(sb, conversationId, firstRefTs, lastRef, lastRefTs);
    } catch (e) {
      // الرسالة اتسجّلت بالفعل وفيها referral خام — فشل التسطيح مايضيّعش البيانات
      console.error("referral apply failed", String(e));
    }
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("ok", { status: 200 });
    const payload = await req.json().catch(() => ({}));
    const secret = req.headers.get("x-sahl-secret") || "";
    const work = processPayload(payload, secret);
    // @ts-ignore - EdgeRuntime متاح في Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work.catch((e: any) => console.error("bg error", String(e))));
    } else {
      await work.catch((e: any) => console.error("work error", String(e)));
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("handler error", String(e));
    return new Response("ok", { status: 200 });
  }
});
