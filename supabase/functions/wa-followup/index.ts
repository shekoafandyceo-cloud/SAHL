// إرسال قالب متابعة الأوردر (utility) من زرار نافذة التفاصيل.
//
// 🔴 ليه Edge Function منفصلة مش توسيع لـ`wa-send`؟
// `wa-send` عقدها **رد جوّه نافذة التـ 24 ساعة**، وفيها حارس صريح بيرفض
// أي إرسال برّها. والقالب موجود **عشان** يتجاوزها. خلطهم في دالة واحدة
// معناه فلاق بيلغي أهم حارس فيها — وأي غلطة بعدين بتبقى رسايل مدفوعة
// بتتبعت من غير قصد.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH = "https://graph.facebook.com/v18.0";
const COOLDOWN_MS = 90_000; // نفس مدة `order-ship` — حارس الضغطة المزدوجة

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const J = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...cors } });

function firstName(full: string | null): string {
  const s = (full || "").trim();
  if (!s) return "حضرتك";
  return s.split(/\s+/)[0];
}

// تعويض متغيرات القالب **في مرة واحدة**.
// مش `replaceAll` لسببين حقيقيين: (أ) الـ`$` في نص البديل ليه معنى خاص
// (`$&` و`$'`) فاسم منتج فيه `$` كان هيتشوّه، (ب) والتعويض على مراحل
// بيخلي قيمة جوّاها `{{2}}` تتعوّض هي كمان في اللفة اللي بعديها.
function renderTemplate(body: string, vals: string[]): string {
  return body.replace(/\{\{([1-9]\d?)\}\}/g, (m, i) => {
    const v = vals[Number(i) - 1];
    return v === undefined ? m : v;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return J({ ok: false, error: "method" }, 405);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return J({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id;
    if (!orderId) return J({ ok: false, error: "missing_order" }, 400);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) 🔴 الأوردر بيتقرا **بتوكن المستخدم عبر RLS** — ده التصريح كله.
    // موظف يبعت id أوردر من متجر تاني بيرجع صفر صفوف. ونفس القراية
    // بتطبق قفل النفاد (سياسات `wallet_depleted()` على `orders`) — تاجر
    // منفّد مايقدرش يبعت رسايل مدفوعة من غير أي شغل زيادة.
    const oRes = await userClient.from("orders")
      .select("id, tenant_id, order_uid, customer_name, phone, product_name, wa_followup_sent_at")
      .eq("id", orderId).maybeSingle();
    const order = oRes.data;
    if (!order) return J({ ok: false, error: "not_allowed" }, 403);

    // 2) حارس الضغطة المزدوجة — رسالتين بفلوس من دبل كليك
    if (order.wa_followup_sent_at) {
      const age = Date.now() - new Date(order.wa_followup_sent_at).getTime();
      if (age >= 0 && age < COOLDOWN_MS) {
        return J({ ok: false, error: "too_soon", sent_at: order.wa_followup_sent_at });
      }
    }

    // 3) إعداد التاجر — القالب **من الداتابيز مش محفور في الكود**
    const tRes = await svc.from("tenants")
      .select("whatsapp_token, whatsapp_phone_id, wa_followup_template, wa_followup_lang, wa_followup_body")
      .eq("id", order.tenant_id).maybeSingle();
    const tenant = tRes.data;
    if (!tenant?.whatsapp_token || !tenant?.whatsapp_phone_id) return J({ ok: false, error: "no_wa_config" }, 400);
    if (!tenant?.wa_followup_template) return J({ ok: false, error: "no_template" }, 400);
    // 🔴 النص **مطلوب** مش اختياري: من غيره الرسالة هتتبعت للعميل وهتتسجّل
    // في الصندوق **فاضية** — فالموظف يشوف فقاعة بيضا ومايعرفش العميل بيرد
    // على إيه. خطأ إعداد أحسن من صندوق بيكدب.
    if (!tenant?.wa_followup_body) return J({ ok: false, error: "no_template_body" }, 400);

    // 4) الرقم بنفس تطبيع التريجر — دالة واحدة مشتركة في الداتابيز
    const wRes = await svc.rpc("wa_id_from_phone", { p: order.phone });
    const waId = (wRes.data ?? null) as string | null;
    if (!waId) return J({ ok: false, error: "bad_phone" }, 400);

    // 5) المتغيرات **من صف الأوردر مش من الـbody**.
    // لو جو من المتصفح، الموظف يقدر يبعت أي نص لأي عميل **برّه نافذة
    // التـ 24 ساعة** تحت غطاء قالب موافق عليه — وده بيحرق الـWABA بتاع
    // التاجر لو اتبلّغ عنه. نفس ثابت `wa-send`: الهوية من السيرفر.
    const p1 = firstName(order.customer_name);
    const p2 = String(order.order_uid ?? "").trim() || "—";
    const p3 = (order.product_name || "").trim() || "—";

    const payload = {
      messaging_product: "whatsapp",
      to: waId,
      type: "template",
      template: {
        name: tenant.wa_followup_template,
        language: { code: tenant.wa_followup_lang || "ar_EG" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: p1 },
            { type: "text", text: p2 },
            { type: "text", text: p3 },
          ],
        }],
      },
    };

    const waRes = await fetch(`${GRAPH}/${tenant.whatsapp_phone_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tenant.whatsapp_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const waJson = await waRes.json().catch(() => ({}));
    if (!waRes.ok) {
      // أكتر حاجتين متوقعين: القالب لسه تحت المراجعة، أو اسم/لغة غلط
      // بحرف. بنرجّع تفصيلة ميتا عشان الرسالة تقول السبب الحقيقي مش
      // «حصلت مشكلة» — التاجر مايقدرش يصلّح إعداد مايعرفش إيه فيه.
      const detail = waJson?.error?.message || `http ${waRes.status}`;
      console.error("wa-followup graph error", waRes.status, JSON.stringify(waJson?.error || {}));
      return J({ ok: false, error: "template_failed", detail });
    }
    const wamid = waJson?.messages?.[0]?.id || null;

    // 6) مين بعت؟ من التوكن زي `wa-send` بالظبط — الاسم عمره ما بييجي من الـbody
    let sentBy: string | null = null;
    let sentByName: string | null = null;
    try {
      const { data: authData } = await userClient.auth.getUser();
      const uid = authData?.user?.id ?? null;
      if (uid) {
        sentBy = uid;
        const pRes = await svc.from("user_profiles")
          .select("full_name, tenant_id").eq("id", uid).maybeSingle();
        if (pRes.data && pRes.data.tenant_id === order.tenant_id) {
          sentByName = (pRes.data.full_name || "").trim() || null;
        }
      }
    } catch (e) {
      // فشل قراية الاسم مايوقفش التسجيل — الرسالة اتبعتت خلاص
      console.error("wa-followup sender lookup", String(e));
    }

    // 7) المحادثة (التريجر بيعملها مع الأوردر — ودي شبكة أمان للأوردرات القديمة)
    let convId: string | null = null;
    const cRes = await svc.from("wa_conversations").select("id")
      .eq("tenant_id", order.tenant_id).eq("wa_id", waId).maybeSingle();
    if (cRes.data) convId = cRes.data.id;
    else {
      const ins = await svc.from("wa_conversations").insert({
        tenant_id: order.tenant_id, wa_id: waId,
        customer_phone: order.phone, customer_name: order.customer_name,
        last_message_at: new Date().toISOString(),
      }).select("id").single();
      convId = ins.data?.id ?? null;
    }

    // 8) الرسالة بتتسجّل في الصندوق زي أي رسالة صادرة.
    // `type:'template'` مش `text` — ده **قالب مدفوع** مش رد عادي، والتاجر
    // لازم يقدر يعدّهم بعدين. والـbody فيه النص المرسوم عشان الموظف
    // يشوف اللي اتبعت فعلاً مش اسم قالب.
    // (الواجهة بترسم أي نوع مش معروف كنص عادي — اتأكد في `waMsgInner`.)
    const rendered = renderTemplate(tenant.wa_followup_body, [p1, p2, p3]);

    if (convId) {
      await svc.from("wa_messages").insert({
        tenant_id: order.tenant_id,
        conversation_id: convId,
        wa_message_id: wamid,
        direction: "out",
        type: "template",
        body: rendered,
        status: "sent",
        wa_timestamp: new Date().toISOString(),
        sent_by: sentBy,
        sent_by_name: sentByName,
      });
    }

    // 9) العلامة على الأوردر — **بعد** ما ميتا قبلت فعلاً.
    // لو اتكتبت قبل الإرسال، محاولة فاشلة كانت هتقفل الزرار 90 ثانية
    // والعميل ماوصلوش حاجة.
    const sentAt = new Date().toISOString();
    await svc.from("orders").update({ wa_followup_sent_at: sentAt }).eq("id", order.id);

    return J({ ok: true, message_id: wamid, conversation_id: convId, sent_at: sentAt, body: rendered });
  } catch (e) {
    console.error("wa-followup error", String(e));
    return J({ ok: false, error: "server_error" }, 500);
  }
});
