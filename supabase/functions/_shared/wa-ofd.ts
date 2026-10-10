// wa-ofd — المنطق الصافي لرسالة «المندوب في الطريق» (11 أكتوبر). من غير أي import: نفس الملف بيشتغل في Deno (wa-ofd-notify)
// وNode 22 (tools/test-wa-ofd-logic.mjs بيستورده بالحرف — مفيش نسخة تانية تنحرف).
//
// 🔴 مفيش أي حرف خفي مكتوب حرفياً هنا — كله \u escapes (عقد في check-functions.py): علامة اتجاه مدسوسة في regex
//    التنضيف كانت هتبان سليمة وهي بتسيب نفس الحرف يعدّي للعميل.
// 🔴 مفيش ساعة ولا Intl هنا — نافذة الإرسال (9–21 القاهرة) بتتحسب في SQL بس (send_until) عشان تغيير الساعة الصيفي.

export const OFD_PARAMS = 5;

// ميتا بترفض المتغير اللي فيه سطر/تاب أو >4 مسافات ورا بعض (132018) وبترفض الفاضي
export function cleanParam(s: unknown, max: number): string {
  return Array.from(String(s ?? "")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g, " ")
    .replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
}

// 🔴 الاسم جاي من فورم عام: حروف/تشكيل/'/- بس (2–25) — لينك أو @ أو أرقام = «حضرتك» (سبام من رقمنا في قالب utility)
const NAME_TOKEN = /^[\p{L}\p{M}'\u2019-]{2,25}$/u;
export function ofdFirstName(full: unknown): string {
  for (const tok of cleanParam(full, 120).split(" ")) {
    // كلمة فيها رقم أو @ أو / أو : (هاندل · لينك · «محمد3») بتترفض كلها — مش بتتقص (القص كان بيطلّع «handle» من «@handle»)
    if (/[\p{N}@\/:]/u.test(tok)) continue;
    const t = tok.replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, "");
    if (NAME_TOKEN.test(t)) return t;
  }
  return "حضرتك";
}

// اسم المندوب من وصف J&T (فيه فواصل ومسافات مزدوجة — اتقاس) — أي حاجة غريبة = «مندوب J&T»
const COURIER_NAME = /^[\p{L}\p{M}'\u2019\- ]{2,50}$/u;
export function ofdCourierName(raw: unknown): string {
  const n = cleanParam(String(raw ?? "").replace(/\s*,\s*/g, " "), 50);
  return COURIER_NAME.test(n) ? n : "مندوب J&T";
}

// = app.ship_rank_p10 بصيغة 01xxxxxxxxx (موبايل مصري بس · أرقام هندية/فارسي بتتحوّل)
export function egLocalMobile(p: unknown): string | null {
  const d = String(p ?? "").replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x6F0)).replace(/\D/g, "");
  const m = d.match(/^(?:0020|20|0)?(1[0125]\d{8})$/);
  return m ? "0" + m[1] : null;
}

// رقم المحل: موبايل أو أرضي/خط ساخن (5–11 رقم)
export function egLocalPhone(p: unknown): string | null {
  const mob = egLocalMobile(p); if (mob) return mob;
  const d = String(p ?? "").replace(/\D/g, "");
  return /^\d{5,11}$/.test(d) ? d : null;
}

export type OfdRow = {
  customer_name?: string | null; order_uid?: string | null; tracking_no?: string | null;
  courier_name?: string | null; courier_phone?: string | null; store_phone?: string | null;
};

// المتغيرات الخمسة بالترتيب: الاسم الأول · رقم الطلب · اسم المندوب · رقم المندوب · رقم المحل — ولا واحد فاضي
export function buildOfdParams(r: OfdRow): string[] {
  const cp = egLocalMobile(r.courier_phone); if (!cp) throw new Error("bad_courier_phone");
  const sp = egLocalPhone(r.store_phone);    if (!sp) throw new Error("bad_store_phone");
  const uid = cleanParam(r.order_uid, 40) || cleanParam(r.tracking_no, 40) || "—";
  return [ofdFirstName(r.customer_name), uid, ofdCourierName(r.courier_name), cp, sp];
}

// = wa-followup / wa-start بالحرف: تعويض مرة واحدة ($& و{{n}} جوّه القيمة بيطلعوا زي ما هم)
export function renderTemplate(body: string, vals: string[]): string {
  return body.replace(/\{\{([1-9]\d?)\}\}/g, (m, i) => { const v = vals[Number(i) - 1]; return v === undefined ? m : v; });
}

export function maxPlaceholder(body: string): number {
  let m = 0;
  for (const x of body.matchAll(/\{\{([1-9]\d?)\}\}/g)) m = Math.max(m, Number(x[1]));
  return m;
}

// = app.wa_ofd_mask بالحرف — أي نص خطأ بيتخزن من غير أرقام تليفونات (≥8 خانات بمسافات/شرط)
export function maskDigits(s: unknown): string {
  return String(s ?? "").replace(/\+?[0-9\u0660-\u0669][0-9\u0660-\u0669\s-]{6,}[0-9\u0660-\u0669]/g, "#").slice(0, 300);
}

export function maskPhone(p: unknown): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length > 6 ? d.slice(0, 3) + "…" + d.slice(-3) : "…";
}

export function errCode(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9_:.-]/g, "").slice(0, 80) || "error";
}

export type MetaVerdict = {
  kind: "sent" | "transient" | "permanent" | "unknown" | "deferred" | "pause";
  code: string; cls?: "recipient" | "message" | "config"; detail: string;
};

const PAUSE = new Set([132000, 132001, 132007, 132012, 132015, 132016]);            // القالب نفسه
const STOP  = new Set([0, 3, 4, 10, 190, 200, 368, 80007, 131005, 131030, 131031, 131042, 131045, 131048, 131057, 133000, 133010]);
                                                                                   // الحساب/التوكن/الرقم بتاعنا/السقف — بيقع على كل رسالة
const TRANS = new Set([1, 2, 130429, 131000, 131016, 131056, 133004]);
const RECIP = new Set([131021, 131026]);                                           // الرقم نفسه (مش على واتساب · نفس الراسل)

// deno-lint-ignore no-explicit-any
export function classifyMeta(httpStatus: number, j: any): MetaVerdict {
  const e = j?.error;
  if (httpStatus >= 200 && httpStatus < 300 && !e) {
    const id = j?.messages?.[0]?.id;
    return id ? { kind: "sent", code: "", detail: String(id) } : { kind: "unknown", code: "no_wamid", detail: "" };
  }
  const code = Number(e?.code), sub = Number(e?.error_subcode);
  const detail = maskDigits(e?.error_data?.details || e?.message || `http ${httpStatus}`);
  const c = Number.isFinite(code) ? String(code) : `http_${httpStatus}`;
  if (PAUSE.has(code)) return { kind: "pause", code: c, cls: "config", detail };
  if (STOP.has(code) || (code === 100 && sub === 33) || httpStatus === 401 || httpStatus === 403)
    return { kind: "deferred", code: code === 100 ? "100.33" : c, detail };
  if (TRANS.has(code) || httpStatus === 429 || httpStatus >= 500) return { kind: "transient", code: c, detail };
  if (RECIP.has(code)) return { kind: "permanent", code: c, cls: "recipient", detail };
  return { kind: "permanent", code: c, cls: "message", detail };   // 100 · 131008 · 131009 · 131051 · 132005 · مجهول (circuit بيحمي)
}

// 🔴 أي استثناء = unknown (الطلب ممكن يكون وصل ميتا: reset · رد اتقطع) — إلا خطأ قبل الاتصال أصلاً
const PRECONNECT = /dns|connection refused|failed to lookup|ENOTFOUND|ECONNREFUSED/i;
export function classifyFetchError(e: unknown): MetaVerdict {
  // deno-lint-ignore no-explicit-any
  const name = String((e as any)?.name ?? ""), msg = String((e as any)?.message ?? "");
  if (name === "TimeoutError" || name === "AbortError") return { kind: "unknown", code: "timeout", detail: "" };
  if (PRECONNECT.test(msg)) return { kind: "transient", code: "connect_error", detail: "" };
  return { kind: "unknown", code: "fetch_error", detail: "" };
}
