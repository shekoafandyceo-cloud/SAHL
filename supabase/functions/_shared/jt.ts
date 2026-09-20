// عميل J&T Express (مصر) — التوقيع والغلاف بس، من غير أي import.
//
// بيتستخدم من الـEdge Functions (Deno) ومن أداة التحقق المحلية
// `tools/jt/jt-cli.mjs` (Node) بنفس الملف بالحرف — عشان اللي اتحقق محلياً
// هو اللي هيتنشر، مش نسخة تانية ممكن تنحرف.
//
// 🔴 مصدر مواصفة التوقيع: جلسات الـSandbox اللي نجحت (20 سبتمبر) — مش
// التوثيق المصري (محتاج لوجين ومقدرناش نقراه من هنا). أي فرق بين الاتنين
// يتحسم بالطلب الناجح المحفوظ في Postman:
//   1) processedPassword = UPPER(HEX(MD5(plainPassword + "jadada236t2")))
//   2) businessDigest    = BASE64(RAW MD5(customerCode + processedPassword + privateKey))
//      — بيتحط **جوّه** bizContent في حقل `digest` (مع customerCode)
//   3) headerDigest      = BASE64(RAW MD5(bizContent كنص بالحرف + privateKey))
//      — بيتحط في الهيدر `digest` مع `apiAccount` و`timestamp` (ملّي ثانية)
//   4) الـBody: application/x-www-form-urlencoded فيه `bizContent=<JSON string>`
//      ⚠️ النص اللي بيتوقّع لازم يبقى **نفس** النص اللي بيتبعت بالبايت —
//      عشان كده buildRequest بتكوّن السترينج مرة واحدة وبترجّعه في الرد.
//
// 🔴 حراسات ثابتة (مش قابلة للتعطيل من الـbody):
//   - `isCreateEndpoint`: أي مسار بيخلق شحنة بفلوس حقيقية. `jtCall` بترفضه
//     في الإنتاج إلا لو `allowCreateInProduction: true` اتبعتت صراحةً من
//     الكود المستدعي (مش من أي حمولة خارجية). في المرحلة دي مفيش مستدعي
//     بيبعتها أصلاً — قرار المالك: ممنوع Create Order إنتاج.
//   - الأسرار مابتظهرش في أي خطأ ولا لوج: `redact()` هي اللي بتتطبع.

import { bytesToBase64, md5Hex, md5Raw } from "./md5.ts";

export const JT_PASSWORD_SALT = "jadada236t2";

export type JtEnv = "sandbox" | "production";

export interface JtCreds {
  apiAccount: string;
  privateKey: string;
  customerCode: string;
  /** كلمة السر بعد المعالجة (UPPER HEX MD5) — مش النص الصريح. */
  passwordProcessed: string;
}

export interface JtConfig {
  env: JtEnv;
  /** لحد `/api` من غير سلاش في الآخر — مثال: https://<host>/webopenplatformapi/api */
  baseUrl: string;
  creds: JtCreds;
}

/**
 * مسارات الـAPI — ⚠️ الأسماء من توثيق J&T العام (إندونيسيا) ومن اللي نجح
 * في الـSandbox المصري. أي مسار مش متأكد منه على مصر معلّم `confirm: true`
 * ولازم يتأكد من البوابة المصرية قبل ما يتبني عليه كود إنتاج.
 */
export const JT_PATHS = {
  /** إنشاء شحنة — 🔴 بفلوس حقيقية في الإنتاج. */
  addOrder: "order/addOrder",
  cancelOrder: "order/cancelOrder",
  /** Query Order — نجح في الـSandbox بـ{command:2, serialNumber:[waybill]}. */
  getOrders: "order/getOrders",
  /** Logistics Track Query — نجح في الـSandbox، التفاصيل رجعت فاضية للتجريبي. */
  trace: "logistics/trace",
  printOrder: "order/printOrder",
} as const;

/** المسارات اللي بتخلق شحنة (أو بتغيّر حالة مدفوعة) — ممنوعة في الإنتاج في المرحلة دي. */
const CREATE_PATHS = new Set<string>([JT_PATHS.addOrder]);

export function isCreateEndpoint(path: string): boolean {
  return CREATE_PATHS.has(normalizePath(path));
}

export function normalizePath(path: string): string {
  return String(path || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

// ── التوقيع ──────────────────────────────────────────────────────────

/** UPPER(HEX(MD5(plain + salt))) */
export function processPassword(plainPassword: string): string {
  return md5Hex(plainPassword + JT_PASSWORD_SALT).toUpperCase();
}

/** BASE64(RAW MD5(customerCode + passwordProcessed + privateKey)) — جوّه bizContent */
export function businessDigest(customerCode: string, passwordProcessed: string, privateKey: string): string {
  return bytesToBase64(md5Raw(customerCode + passwordProcessed + privateKey));
}

/** BASE64(RAW MD5(bizContent + privateKey)) — في الهيدر */
export function headerDigest(bizContent: string, privateKey: string): string {
  return bytesToBase64(md5Raw(bizContent + privateKey));
}

/**
 * بيضيف customerCode + digest (التوقيع التجاري) للحمولة.
 * الترتيب: الحقول الأصلية الأول ثم customerCode ثم digest — الترتيب مش
 * مؤثر في التوقيع لأن الهيدر بيتوقّع على السترينج النهائي أياً كان.
 */
export function withBusinessDigest<T extends Record<string, unknown>>(biz: T, creds: JtCreds): T & { customerCode: string; digest: string } {
  return {
    ...biz,
    customerCode: creds.customerCode,
    digest: businessDigest(creds.customerCode, creds.passwordProcessed, creds.privateKey),
  };
}

// ── الغلاف ───────────────────────────────────────────────────────────

export interface JtRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  /** الـbody النهائي (x-www-form-urlencoded) */
  body: string;
  /** السترينج اللي اتوقّع عليه بالحرف — نفسه اللي جوّه body */
  bizContent: string;
  timestamp: number;
}

/**
 * بيبني الطلب كامل. `biz` بيتحوّل لـJSON **مرة واحدة** (JSON.stringify من غير
 * مسافات)، والهيدر بيتوقّع على النص ده نفسه، والـbody بيشيل نفس النص.
 */
export function buildRequest(cfg: JtConfig, path: string, biz: Record<string, unknown>, now: number = Date.now()): JtRequest {
  const p = normalizePath(path);
  if (!p) throw new Error("jt_bad_path");
  if (!cfg.baseUrl) throw new Error("jt_config_missing:baseUrl");
  const { apiAccount, privateKey } = cfg.creds;
  if (!apiAccount || !privateKey) throw new Error("jt_config_missing:creds");
  const bizContent = JSON.stringify(biz);
  const timestamp = Math.floor(now);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    apiAccount: String(apiAccount),
    digest: headerDigest(bizContent, privateKey),
    timestamp: String(timestamp),
  };
  const body = "bizContent=" + encodeURIComponent(bizContent);
  return {
    url: cfg.baseUrl.replace(/\/+$/, "") + "/" + p,
    method: "POST",
    headers,
    body,
    bizContent,
    timestamp,
  };
}

// ── النداء ───────────────────────────────────────────────────────────

export interface JtCallOptions {
  /** 🔴 لازم تتبعت صراحةً من الكود — مش من أي حمولة خارجية. */
  allowCreateInProduction?: boolean;
  timeoutMs?: number;
  /** للاختبار: بديل لـfetch */
  fetchImpl?: typeof fetch;
  now?: number;
}

export interface JtResult {
  ok: boolean;
  status: number;
  /** الرد كـJSON لو اتفك، وإلا null */
  json: Record<string, unknown> | null;
  raw: string;
  request: JtRequest;
  /** J&T بترجّع code/msg/data — code "1" = نجاح في الـSandbox المقاس */
  code: string | null;
  msg: string | null;
  data: unknown;
}

export class JtGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JtGuardError";
  }
}

export async function jtCall(cfg: JtConfig, path: string, biz: Record<string, unknown>, opts: JtCallOptions = {}): Promise<JtResult> {
  const p = normalizePath(path);
  if (isCreateEndpoint(p) && cfg.env === "production" && opts.allowCreateInProduction !== true) {
    throw new JtGuardError("jt_create_blocked_in_production");
  }
  const request = buildRequest(cfg, p, biz, opts.now);
  const f = opts.fetchImpl || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await f(request.url, { method: "POST", headers: request.headers, body: request.body, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
  const raw = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch { /* مش JSON */ }
  const code = json && json.code != null ? String(json.code) : null;
  const msg = json && json.msg != null ? String(json.msg) : null;
  return { ok: res.ok, status: res.status, json, raw, request, code, msg, data: json ? json.data : undefined };
}

// ── التعتيم — الأسرار عمرها ما تتطبع ─────────────────────────────────

export function redact(value: string, keep = 3): string {
  const s = String(value ?? "");
  if (!s) return "";
  if (s.length <= keep * 2) return "*".repeat(s.length);
  return s.slice(0, keep) + "…" + s.slice(-keep) + " (" + s.length + ")";
}

/** نسخة من الطلب صالحة للطباعة — الهيدرات الحساسة متعتّمة. */
export function redactRequest(r: JtRequest, creds: JtCreds): Record<string, unknown> {
  const headers = { ...r.headers, apiAccount: redact(r.headers.apiAccount), digest: redact(r.headers.digest, 4) };
  let biz = r.bizContent;
  // التوقيع التجاري وكود العميل جوّه bizContent
  try {
    const o = JSON.parse(biz);
    if (o && typeof o === "object") {
      if ("digest" in o) o.digest = redact(String(o.digest), 4);
      if ("customerCode" in o) o.customerCode = redact(String(o.customerCode));
      biz = JSON.stringify(o);
    }
  } catch { /* سيبه */ }
  for (const secret of [creds.privateKey, creds.passwordProcessed]) {
    if (secret) biz = biz.split(secret).join("<REDACTED>");
  }
  return { url: r.url, method: r.method, headers, bizContent: biz, timestamp: r.timestamp };
}
