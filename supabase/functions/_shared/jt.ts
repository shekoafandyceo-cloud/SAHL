// عميل J&T Express (مصر) — التوقيع والغلاف بس، من غير أي import.
//
// بيتستخدم من الـEdge Functions (Deno) ومن أداة التحقق المحلية
// `tools/jt/jt-cli.mjs` (Node) بنفس الملف بالحرف — عشان اللي اتحقق محلياً
// هو اللي هيتنشر، مش نسخة تانية ممكن تنحرف.
//
// 🔴 مصدر مواصفة التوقيع: مثال PHP الرسمي من بوابة مصر
// (download.jtjms-eg.com/open/PHP+signature+example.zip — اتقرا 20 سبتمبر)
// + جلسات الـSandbox اللي نجحت. أي فرق يتحسم بالطلب الناجح المحفوظ في Postman:
//   1) processedPassword = UPPER(HEX(MD5(plainPassword + "jadada236t2")))
//   2) businessDigest    = BASE64(RAW MD5(UPPER(customerCode + processedPassword) + privateKey))
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
 * جذور البيئتين — من بوابة مصر نفسها (`app.js` بتاع open.jtjms-eg.com،
 * اتقرا 20 سبتمبر 2026). لحد `/api` من غير سلاش في الآخر.
 */
export const JT_BASE_URLS: Record<JtEnv, string> = {
  sandbox: "https://demoopenapi.jtjms-eg.com/webopenplatformapi/api",
  production: "https://openapi.jtjms-eg.com/webopenplatformapi/api",
};

/**
 * مسارات الـAPI — **من توثيق بوابة مصر** (open.jtjms-eg.com — الصفحات
 * مضمّنة في الـJS بتاع البوابة ومحفوظة في `tools/jt/docs/`). كل مسار هنا
 * له صفحة بنفس الاسم هناك؛ اللي مش موجود هناك مش موجود هنا.
 */
export const JT_PATHS = {
  /** إنشاء شحنة — 🔴 بفلوس حقيقية في الإنتاج. الرد فيه billCode + sortingCode + sumFreight. */
  addOrder: "order/addOrder",
  /** إنشاء شحنة «loose» — نفس الخطورة. */
  addLooseOrder: "order/addLooseOrder",
  /** إلغاء — بيغيّر حالة شحنة قايمة. */
  cancelOrder: "order/cancelOrder",
  /** Query Order — command 1 برقم أوردرنا · 2 برقم البوليصة · 3 بفترة · 4 serial. */
  getOrders: "order/getOrders",
  /** تتبع — billCodes مفصولة بفاصلة، حد أقصى 30. */
  trace: "logistics/trace",
  /** الاشتراك في دفع التحديثات — {id: apiAccount, list:[{traceNode, waybillCode}]} حد أقصى 1000. */
  subscribe: "trace/subscribe",
  /** بوليصة J&T نفسها كـPDF base64 — {billCode, printSize, printCod, showCustomerOrderId}. */
  printOrder: "order/printOrder",
  /** معلومات البوليصة — {customerCode, waybillNos[]} → isSign · packageChargeWeight · totalFreight · freight. */
  getWaybillInfo: "waybill/getWaybillInfo",
  /** تقدير الشحن — sender/receiver {prov, city, area, address} + weight → totalPrice. */
  freightEstimate: "spmComCost/getComCost",
  /** نطاق المحافظات/المدن/المناطق المخدومة — {type: 2|3|4}. */
  pca: "online/pca",
  /** هل العنوان جوّه نطاق الخدمة. */
  cover: "online/cover",
  /** كود الفرز الثلاثي من العنوان — {sender?, receiver}. */
  threeSegmentCode: "threeCode/getThreeSegmentCode",
  /** بيانات الفرع + كود الفرز من العنوان. */
  networkInfo: "network/getInfo",
} as const;

/**
 * المسارات اللي بتخلق شحنة أو بتغيّر حالتها عند J&T — ممنوعة في الإنتاج في
 * المرحلة دي (قرار المالك). القراءة والتقدير والاشتراك مسموحين.
 */
const CREATE_PATHS = new Set<string>([JT_PATHS.addOrder, JT_PATHS.addLooseOrder, JT_PATHS.cancelOrder]);

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

/**
 * BASE64(RAW MD5(UPPER(customerCode + passwordProcessed) + privateKey)) — جوّه bizContent.
 * الـUPPER على (customerCode + كلمة السر المعالجة) مع بعض بالحرف زي مثال PHP
 * الرسمي من بوابة مصر (`strtoupper($customerCode.md5($pwd.'jadada236t2'))`):
 * كلمة السر المعالجة أصلاً UPPER، فالفرق الوحيد لو كود العميل فيه حروف صغيرة.
 */
export function businessDigest(customerCode: string, passwordProcessed: string, privateKey: string): string {
  return bytesToBase64(md5Raw((customerCode + passwordProcessed).toUpperCase() + privateKey));
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
