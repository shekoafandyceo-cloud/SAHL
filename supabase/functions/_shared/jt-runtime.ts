// jt-runtime — الحتة المشتركة بين jt-ship · jt-status · jt-lookup:
// قراءة إعدادات J&T من secrets الـEdge Functions، والتصريح، والتطبيع.
//
// 🔴 الأسرار من Deno.env بس — مفيش سر في الجدول ولا في الكود:
//   JT_ENV=production|sandbox  (الافتراضي production)
//   JT_API_ACCOUNT · JT_PRIVATE_KEY · JT_CUSTOMER_CODE · JT_PASSWORD (أو JT_PASSWORD_PROCESSED)
//   JT_SBX_API_ACCOUNT · JT_SBX_PRIVATE_KEY · JT_SBX_CUSTOMER_CODE · JT_SBX_PASSWORD (اختياري — للـSandbox)
//
// التصريح بتلات أشكال (بالترتيب):
//   1. Bearer = service_role  → n8n (مسار تأكيد الواتساب) — موثوق، التاجر من صف الأوردر
//   2. x-diag-token = platform_settings.jt_diag_token → تشخيص من الداتابيز (pg_net) — من غير أي سر J&T
//   3. Bearer = JWT مستخدم → موظف نشط، tenant_id من البروفايل (نفس ثابت tenant-staff)
import { JT_BASE_URLS, type JtConfig, type JtEnv, processPassword } from "./jt.ts";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-diag-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export interface JtEnvStatus {
  env: JtEnv;
  production: boolean;
  sandbox: boolean;
}

function readCreds(prefix: string) {
  const g = (k: string) => (Deno.env.get(prefix + k) || "").trim();
  const apiAccount = g("API_ACCOUNT"), privateKey = g("PRIVATE_KEY"), customerCode = g("CUSTOMER_CODE");
  let passwordProcessed = g("PASSWORD_PROCESSED");
  if (!passwordProcessed && g("PASSWORD")) passwordProcessed = processPassword(g("PASSWORD"));
  if (!apiAccount || !privateKey || !customerCode || !passwordProcessed) return null;
  return { apiAccount, privateKey, customerCode, passwordProcessed };
}

/** إعدادات البيئة المطلوبة — null لو أسرارها مش متسجّلة. */
export function loadJtConfig(env: JtEnv): JtConfig | null {
  const creds = env === "sandbox" ? readCreds("JT_SBX_") : readCreds("JT_");
  if (!creds) return null;
  const override = (Deno.env.get(env === "sandbox" ? "JT_SBX_BASE_URL" : "JT_BASE_URL") || "").trim();
  return { env, baseUrl: override || JT_BASE_URLS[env], creds };
}

export function defaultEnv(): JtEnv {
  const e = (Deno.env.get("JT_ENV") || "production").trim().toLowerCase();
  return e === "sandbox" ? "sandbox" : "production";
}

export function envStatus(): JtEnvStatus {
  return { env: defaultEnv(), production: !!readCreds("JT_"), sandbox: !!readCreds("JT_SBX_") };
}

/** كل المفاتيح الخاصة اللي ممكن callback يتوقّع بيها (إنتاج + Sandbox لو موجودة). */
export function callbackKeys(): string[] {
  const out: string[] = [];
  for (const p of ["JT_", "JT_SBX_"]) {
    const k = (Deno.env.get(p + "PRIVATE_KEY") || "").trim();
    if (k) out.push(k);
  }
  return out;
}

// ── التصريح ──────────────────────────────────────────────────────────
export type Caller =
  | { mode: "service" }
  | { mode: "diag" }
  | { mode: "user"; userId: string; tenantId: string; name: string; role: string };

// deno-lint-ignore no-explicit-any
export async function authCaller(req: Request, admin: any, serviceKey: string): Promise<Caller | Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token && serviceKey && token === serviceKey) return { mode: "service" };
  const diag = (req.headers.get("x-diag-token") || "").trim();
  if (diag) {
    const { data: row } = await admin.from("platform_settings").select("value").eq("key", "jt_diag_token").maybeSingle();
    const expected = (row?.value || "").trim();
    if (expected && expected.length >= 24 && diag === expected) return { mode: "diag" };
    return json({ error: "unauthorized", message: "diag token غلط" }, 401);
  }
  if (!token) return json({ error: "unauthorized", message: "لازم تسجّل دخول" }, 401);
  const { data: got, error } = await admin.auth.getUser(token);
  const user = got?.user;
  if (error || !user) return json({ error: "unauthorized", message: "الجلسة انتهت — سجّل دخول تاني" }, 401);
  const { data: profile } = await admin
    .from("user_profiles").select("id, tenant_id, full_name, role, active").eq("id", user.id).maybeSingle();
  if (!profile || profile.active !== true || !profile.tenant_id) return json({ error: "forbidden", message: "الحساب مش مفعّل" }, 403);
  return { mode: "user", userId: user.id, tenantId: profile.tenant_id, name: profile.full_name || "", role: profile.role || "" };
}

// ── تطبيع ────────────────────────────────────────────────────────────
const AR_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };

export function latinDigits(s: string): string {
  return String(s || "").replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] || d);
}

/** رقم مصري محلي 11 خانة (01xxxxxxxxx) — J&T بتطلب mobile/phone String(11). null لو مش مفهوم. */
export function egMobile(raw: string): string | null {
  let d = latinDigits(raw).replace(/\D/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = "0" + d;
  if (/^01[0-9]{9}$/.test(d)) return d;
  return null;
}

/** تطبيع نص المدينة للمرادفات: أرقام لاتيني · شيل التشكيل/التطويل/bidi · توحيد الهمزات والتاء المربوطة · مسافات. */
export function normPlace(s: string): string {
  return latinDigits(String(s || ""))
    .replace(/[ً-ْـ\u200e\u200f\u061c]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/^ال/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function nowIso(): string {
  return new Date().toISOString();
}
