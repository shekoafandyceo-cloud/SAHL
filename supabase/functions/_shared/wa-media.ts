// wa-media — صور الردود المحفوظة بالـ`media id` بتاع ميتا (4 نوفمبر — `Egress`).
//
// 🔴 ليه: `wa-send` كان بيبعت كل صورة بلينك موقّع جديد، فميتا بتنزّل الصورة من الـStorage **مع كل إرسال**.
// الردود المحفوظة بتتبعت 85–156 صورة في اليوم (اتقاس) = ميتا لوحدها نزّلت 177 MB يوم 3 نوفمبر، والميزانية
// لحد آخر الدورة ~75 MB/يوم للمشروع كله. الـ`media id` بيعيش 30 يوم عند ميتا ويتبعت لأي عميل من نفس الرقم،
// فالصورة بتتنزل من عندنا مرة كل 25 يوم (جدول `wa_media_ids`).
//
// القواعد (كلها متفحوصة في tools/test-wa-media.mjs بـfetch/svc وهميين):
//  · صور `<tenant>/quick-replies/…` بس — مرفق الشات بيتبعت مرة فالرفع لميتا مالوش لازمة.
//  · **أي فشل = null** والإرسال بيكمّل باللينك زي قبل v83 بالظبط — الدالة عمرها ما بترمي.
//  · الرفع فشل (أو التنزيل) = بنفتكر الفشل ساعة (`media_id = '-'`) — من غيرها كل إرسال كان هينزّل الصورة
//    من الـStorage وبعدين يبعت باللينك (ميتا تنزّلها تاني) = ضعف الـEgress وقت ما ميتا واقعة.
//  · التنزيل والرفع ليهم مهلة 10 ثواني — تعليق في أي واحد فيهم = اللينك (مش الإرسال يفضل معلّق لحد 150ث).
//  · مفيش import — بيشتغل في Deno (wa-send) وفي Node (الهارنس) بنفس الملف.

export const MEDIA_ID_TTL_MS = 25 * 24 * 3600 * 1000;   // ميتا: 30 يوم
export const MEDIA_FAIL_TTL_MS = 60 * 60 * 1000;          // فشل اتفتكر ساعة
export const MEDIA_STEP_TIMEOUT_MS = 10000;
export const MEDIA_FAILED = "-";

export function isQuickReplyPath(tenantId: string, path: unknown): boolean {
  return typeof path === "string" && !!tenantId && path.startsWith(`${tenantId}/quick-replies/`) && !path.includes("..");
}

// 🔴 الـ`media id` اترفض = نبعت **مرة** باللينك — بس لو الخطأ ممكن يكون من الصورة نفسها.
// · 5xx = ممكن ميتا تكون قبلت الرسالة فعلاً — إعادة = صورة مكررة عند العميل → لأ.
// · أخطاء مالهاش علاقة بالصورة (النافذة · التوكن · الصلاحيات · الـrate limit · الرقم) = اللينك هيقع بنفس الشكل،
//   والإعادة بتكلّف تنزيل من الـStorage على الفاضي → لأ.
// · غير كده (100 «Invalid parameter» · 131053 «Media upload error» · كود مجهول) = نجرّب باللينك.
const NOT_MEDIA_CODES = new Set([
  131047, 131051, 470,                  // نافذة الـ24 ساعة / نوع رسالة
  0, 3, 10, 190, 200, 131031,           // توكن · صلاحيات · حساب مقفول
  4, 80007, 130429, 131048, 131056,     // rate limits
  131026, 131021,                       // الرقم نفسه
]);
export function shouldRetryWithLink(httpStatus: number, code: unknown): boolean {
  if (!(httpStatus >= 400 && httpStatus < 500)) return false;
  const c = Number(code);
  if (Number.isFinite(c) && NOT_MEDIA_CODES.has(c)) return false;
  return true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<null>((resolve) => { t = setTimeout(() => resolve(null), ms); });
  return Promise.race([p, timer]).finally(() => { if (t !== undefined) clearTimeout(t); });
}

export interface MediaDeps {
  // deno-lint-ignore no-explicit-any
  svc: any;
  graph: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

// deno-lint-ignore no-explicit-any
async function remember(d: MediaDeps, tenantId: string, phoneId: string, path: string, mediaId: string, at: number): Promise<void> {
  try {
    await d.svc.from("wa_media_ids").upsert(
      { tenant_id: tenantId, phone_id: phoneId, path, media_id: mediaId, uploaded_at: new Date(at).toISOString() },
      { onConflict: "tenant_id,phone_id,path" });
  } catch { /* الكاش مش شرط للإرسال */ }
}

/** الـ`media id` لصورة رد محفوظ (من الكاش أو رفع جديد) — أو null = ابعت باللينك. عمرها ما بترمي. */
export async function quickReplyMediaId(d: MediaDeps, tenantId: string, phoneId: string, token: string, path: string): Promise<string | null> {
  const now = d.now || Date.now;
  const fetchFn = d.fetchFn || fetch;
  const ms = d.timeoutMs || MEDIA_STEP_TIMEOUT_MS;
  try {
    if (!isQuickReplyPath(tenantId, path) || !phoneId || !token) return null;
    const c = await d.svc.from("wa_media_ids").select("media_id, uploaded_at")
      .eq("tenant_id", tenantId).eq("phone_id", phoneId).eq("path", path).maybeSingle();
    const row = c && !c.error ? c.data : null;
    const age = row?.uploaded_at ? now() - new Date(row.uploaded_at).getTime() : Infinity;
    if (row?.media_id === MEDIA_FAILED && age < MEDIA_FAIL_TTL_MS) return null;
    if (row?.media_id && row.media_id !== MEDIA_FAILED && age < MEDIA_ID_TTL_MS) return String(row.media_id);

    const dl = await withTimeout(Promise.resolve(d.svc.storage.from("wa-media").download(path)), ms);
    // deno-lint-ignore no-explicit-any
    const blob: any = dl && !(dl as any).error ? (dl as any).data : null;
    if (!blob) { await remember(d, tenantId, phoneId, path, MEDIA_FAILED, now()); return null; }
    const mime = /\.png$/i.test(path) ? "image/png" : "image/jpeg";
    const fd = new FormData();
    fd.append("messaging_product", "whatsapp");
    fd.append("type", mime);
    fd.append("file", new Blob([await blob.arrayBuffer()], { type: mime }), path.split("/").pop() || "image");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    let id: string | null = null;
    try {
      const up = await fetchFn(`${d.graph}/${phoneId}/media`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd, signal: ctl.signal,
      });
      const uj = await up.json().catch(() => ({}));
      id = (up.ok && uj?.id) ? String(uj.id) : null;
      if (!id) console.error("wa-media upload", up.status, JSON.stringify(uj?.error || {}));
    } catch (e) {
      console.error("wa-media upload", String(e));
    } finally {
      clearTimeout(t);
    }
    await remember(d, tenantId, phoneId, path, id || MEDIA_FAILED, now());
    return id;
  } catch (e) {
    console.error("wa-media", String(e));
    return null;
  }
}

/** الـ`media id` طلع بايظ (اللينك نجح بعده) — نمسحه عشان الإرسال الجاي يرفع من جديد. */
// deno-lint-ignore no-explicit-any
export async function forgetMediaId(svc: any, tenantId: string, phoneId: string, path: string): Promise<void> {
  try {
    await svc.from("wa_media_ids").delete().eq("tenant_id", tenantId).eq("phone_id", phoneId).eq("path", path);
  } catch { /* مش شرط */ }
}
