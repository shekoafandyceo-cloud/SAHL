// بدء محادثة واتساب مع رقم عمره ما كلّمنا — طلب المالك 16 سبتمبر.
//
// 🔴 ليه Edge Function تالتة مستقلة مش توسيع لـ`wa-send` ولا `wa-followup`؟
// `wa-send` عقدها **الرد جوّه نافذة الـ24 ساعة** وفيها حارس صريح بيرفض أي
// إرسال برّها. و`wa-followup` عقدها **قالب مربوط بأوردر قايم** — الحمولة
// `order_id` بس والمتغيرات بتتقرا من صف الأوردر. الحالة دي مالهاش أوردر
// أصلاً (العميل كلّم التاجر على الموبايل وطلب رسالة)، فخلطها في أي من
// الاتنين معناه فلاق بيلغي حارس أساسي — وأي غلطة بعدين بتبقى رسايل مدفوعة
// بتتبعت من غير قصد.
//
// 🔴 والحمولة **رقم + معرّف قالب بس**. مفيش ولا حرف نص جاي من المتصفح:
// نص القالب وقيم متغيراته بيتقروا من `wa_start_templates` على السيرفر.
// لو جم من الفرونت، أي موظف يقدر يبعت أي كلام لأي رقم **برّه النافذة**
// تحت غطا قالب موافق عليه. نفس الثابت الحاكم في `wa-send` و`wa-followup`.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH = "https://graph.facebook.com/v18.0";

// نافذة خدمة الـ24 ساعة بتاعة واتساب — مش رقم من عندنا.
const WINDOW_MS = 24 * 60 * 60 * 1000;
// 🔴 قالب واحد لكل رقم كل 24 ساعة. ده حارس **تكلفة وبان** مش راحة:
// `chat_start_ar` تصنيفه `marketing` عند ميتا، والإرسال المتكرر لأرقام
// مكلّمتناش هو بالظبط النمط اللي بيولّد البلاغات والبان.
const REOPEN_MS = 24 * 60 * 60 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const J = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...cors } });

// تعويض متغيرات القالب **في مرة واحدة** — منقولة بالحرف من `wa-followup`.
// مش `replaceAll` لسببين حقيقيين: (أ) الـ`$` في نص البديل ليه معنى خاص
// (`$&` و`$'`) فقيمة فيها `$` كانت هتتشوّه، (ب) والتعويض على مراحل بيخلي
// قيمة جوّاها `{{2}}` تتعوّض هي كمان في اللفة اللي بعديها.
function renderTemplate(body: string, vals: string[]): string {
  return body.replace(/\{\{([1-9]\d?)\}\}/g, (m, i) => {
    const v = vals[Number(i) - 1];
    return v === undefined ? m : v;
  });
}

// أعلى رقم متغير مذكور في النص. `{{1}}` و`{{3}}` من غير `{{2}}` = 3،
// عشان القايمة اللي بتتبعت لميتا لازم تبقى متصلة من 1.
function maxPlaceholder(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{([1-9]\d?)\}\}/g)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return J({ ok: false, error: "method" }, 405);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return J({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const rawPhone = typeof body?.phone === "string" ? body.phone : "";
    const templateId = body?.template_id;
    // اسم اختياري **للصندوق بس** — عمره ما بيدخل حمولة ميتا. الموظف عارف
    // مين كلّمه، والمحادثة من غير اسم بتبقى رقم أصمّ في القايمة.
    const rawName = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!rawPhone) return J({ ok: false, error: "missing_phone" }, 400);
    if (!templateId) return J({ ok: false, error: "missing_template" }, 400);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) 🔴 القالب بيتقرا **بتوكن المستخدم عبر RLS** — ده التصريح كله.
    // سياسة `wa_start_templates_select` شرطها `tenant_id = app.current_tenant_id()`،
    // ودي بترجع null لأي حد مش موظف نشط في متجر. فموظف بيبعت `template_id`
    // بتاع متجر تاني بياخد صفر صفوف، و`tenant_id` بييجي **من الصف** مش من
    // الـbody — نفس الثابت الحاكم في `tenant-staff` و`order-ship`.
    const tplRes = await userClient.from("wa_start_templates")
      .select("id, tenant_id, template_name, lang, body, params, enabled")
      .eq("id", templateId).maybeSingle();
    const tpl = tplRes.data;
    if (!tpl) return J({ ok: false, error: "not_allowed" }, 403);
    if (!tpl.enabled) return J({ ok: false, error: "template_disabled" }, 400);

    const tenantId = tpl.tenant_id as string;

    // 2) قفل النفاد. `wa-followup` بياخده ببلاش لأنه بيقرا `orders` (وسياساتها
    // فيها `wallet_depleted()`)، وإحنا مش بنقرا أوردر — فلازم صريح. تاجر
    // منفّد مايبعتش رسايل مدفوعة.
    const wRes = await svc.from("wallet_state").select("is_depleted").eq("tenant_id", tenantId).maybeSingle();
    if (wRes.data?.is_depleted) return J({ ok: false, error: "depleted" }, 402);

    // 3) القالب لازم يكون متسق مع نفسه: عدد المتغيرات المسجّلة = أعلى `{{n}}`
    // في النص. لو أقل، العميل بيستلم `{{2}}` حرفياً (أو ميتا بترفض) —
    // خطأ إعداد أحسن من رسالة مشوّهة لعميل حقيقي.
    const params: string[] = Array.isArray(tpl.params) ? tpl.params.map((x: unknown) => String(x ?? "")) : [];
    const need = maxPlaceholder(String(tpl.body || ""));
    if (need !== params.length) {
      console.error("wa-start param mismatch", tpl.template_name, need, params.length);
      return J({ ok: false, error: "bad_template_params", need, have: params.length }, 400);
    }

    // 4) الرقم بنفس تطبيع تريجر المحادثات (`app.wa_id_from_phone`) — دالة
    // واحدة مشتركة في الداتابيز. نسخة تانية من المنطق هنا = الرد بتاع
    // العميل بيروح لخيط تاني أو محادثة مكررة بتتعمل جنبها.
    const nRes = await svc.rpc("wa_id_from_phone", { p: rawPhone });
    const waId = (nRes.data ?? null) as string | null;
    if (!waId) return J({ ok: false, error: "bad_phone" }, 400);

    // 5) إعداد الواتساب بتاع التاجر
    const tRes = await svc.from("tenants")
      .select("whatsapp_token, whatsapp_phone_id")
      .eq("id", tenantId).maybeSingle();
    const tenant = tRes.data;
    if (!tenant?.whatsapp_token || !tenant?.whatsapp_phone_id) return J({ ok: false, error: "no_wa_config" }, 400);

    // 6) المحادثة الموجودة (لو موجودة) — تريجر الأوردرات بيعمل محادثات
    // لأرقام عمرها ما بعتت، فوجود الصف **مش** معناه إن العميل كلّمنا.
    const cRes = await svc.from("wa_conversations")
      .select("id, last_inbound_at").eq("tenant_id", tenantId).eq("wa_id", waId).maybeSingle();
    let convId: string | null = cRes.data?.id ?? null;

    // 🔴 النافذة مفتوحة = رسالة عادية ببلاش. قالب مدفوع هنا فلوس بتتحرق
    // من غير أي فايدة، فبنرفض وبنرجّع `conversation_id` عشان الواجهة تفتح
    // الشات على طول بدل ما تقول «حصلت مشكلة».
    if (cRes.data?.last_inbound_at) {
      const age = Date.now() - new Date(cRes.data.last_inbound_at).getTime();
      if (age >= 0 && age < WINDOW_MS) {
        return J({ ok: false, error: "window_open", conversation_id: convId });
      }
    }

    // 7) قالب تاني للرقم ده في آخر 24 ساعة؟ بنقف. ده بيشمل قوالب
    // `wa-followup` كمان **عن قصد** — الاتنين رسايل مدفوعة بتوصل نفس
    // العميل، والعدّاد بتاع ميتا مابيفرقش بينهم.
    if (convId) {
      const mRes = await svc.from("wa_messages")
        .select("wa_timestamp").eq("conversation_id", convId)
        .eq("direction", "out").eq("type", "template")
        .order("wa_timestamp", { ascending: false }).limit(1);
      const last = mRes.data?.[0]?.wa_timestamp;
      if (last) {
        const age = Date.now() - new Date(last).getTime();
        if (age >= 0 && age < REOPEN_MS) {
          return J({ ok: false, error: "too_soon", sent_at: last, conversation_id: convId });
        }
      }
    }

    // 8) الإرسال
    const components = params.length
      ? [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }]
      : [];
    const payload = {
      messaging_product: "whatsapp",
      to: waId,
      type: "template",
      template: {
        name: tpl.template_name,
        language: { code: tpl.lang || "ar_EG" },
        ...(components.length ? { components } : {}),
      },
    };

    const waRes = await fetch(`${GRAPH}/${tenant.whatsapp_phone_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tenant.whatsapp_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const waJson = await waRes.json().catch(() => ({}));
    if (!waRes.ok) {
      // أكتر حاجة متوقعة: القالب لسه تحت المراجعة، أو اسم/لغة غلط بحرف،
      // أو الرقم مش على واتساب. بنرجّع تفصيلة ميتا عشان الرسالة تقول السبب
      // الحقيقي — التاجر مايقدرش يصلّح إعداد مايعرفش إيه فيه.
      const detail = waJson?.error?.message || `http ${waRes.status}`;
      console.error("wa-start graph error", waRes.status, JSON.stringify(waJson?.error || {}));
      return J({ ok: false, error: "template_failed", detail });
    }
    const wamid = waJson?.messages?.[0]?.id || null;

    // 9) مين بعت؟ من التوكن زي `wa-send` بالظبط — الاسم عمره ما بييجي من الـbody
    let sentBy: string | null = null;
    let sentByName: string | null = null;
    try {
      const { data: authData } = await userClient.auth.getUser();
      const uid = authData?.user?.id ?? null;
      if (uid) {
        sentBy = uid;
        const pRes = await svc.from("user_profiles").select("full_name, tenant_id").eq("id", uid).maybeSingle();
        if (pRes.data && pRes.data.tenant_id === tenantId) {
          sentByName = (pRes.data.full_name || "").trim() || null;
        }
      }
    } catch (e) {
      // فشل قراية الاسم مايوقفش التسجيل — الرسالة اتبعتت خلاص
      console.error("wa-start sender lookup", String(e));
    }

    // 10) المحادثة بتتعمل **بعد** ما ميتا قبلت. لو اتعملت قبل الإرسال،
    // محاولة فاشلة كانت بتسيب محادثة فاضية في الصندوق لعميل عمرنا ما
    // كلمناه — نفس منطق علامة `wa_followup_sent_at` اللي بتتكتب بعد القبول.
    if (!convId) {
      const ins = await svc.from("wa_conversations").insert({
        tenant_id: tenantId,
        wa_id: waId,
        customer_phone: "0" + waId.slice(2),
        customer_name: rawName || null,
        last_message_at: new Date().toISOString(),
      }).select("id").single();
      convId = ins.data?.id ?? null;
      if (!convId) {
        // سباق مع `wa-inbox-ingest` لو العميل رد في نفس اللحظة — نجيبها تاني
        const again = await svc.from("wa_conversations").select("id")
          .eq("tenant_id", tenantId).eq("wa_id", waId).maybeSingle();
        convId = again.data?.id ?? null;
      }
    }

    // 11) الرسالة بتتسجّل في الصندوق زي أي رسالة صادرة.
    // `type:'template'` مش `text` — ده **قالب مدفوع** والتاجر لازم يقدر
    // يعدّهم بعدين، وحارس الـ24 ساعة فوق بيقرا من هنا بالظبط.
    const rendered = renderTemplate(String(tpl.body || ""), params);
    if (convId) {
      await svc.from("wa_messages").insert({
        tenant_id: tenantId,
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

    return J({ ok: true, conversation_id: convId, message_id: wamid, wa_id: waId, body: rendered });
  } catch (e) {
    console.error("wa-start error", String(e));
    return J({ ok: false, error: "server_error" }, 500);
  }
});
