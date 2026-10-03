// jt-remark — نسخة الواجهة من supabase/functions/_shared/jt-remark.ts (اللي jt-ship بتستخدمها).
// 🔴 متولّدة منها بشيل الـtypes بس — tools/test-jt-remark.mjs بيستورد الاتنين ويثبت إنهم بيطلّعوا
// نفس النص بالحرف. الاستخدام هنا: معاينة نافذة شحن J&T (اللي الموظف بيشوفه = اللي هيتبعت ويتطبع)،
// والبوليصة المطبوعة للأوردرات القديمة اللي مالهاش jt_remark محفوظ.
// الترتيب: سطور المنتجات · سطر الخصائص · «ملاحظة: …» بالمساحة اللي فاضلة من الـ200 — المنتجات
// عمرها ما بتتقص عشان الملاحظة. 🔴 الملاحظات الداخلية (internal_notes) مش هنا أبداً.

export const REMARK_MAX = 200;
export const NOTE_PREFIX = "ملاحظة: ";
export const NOTE_MAX = 200;
// أقل مساحة تستاهل ملاحظة — أقل من كده بتطلع حرفين و«…» مالهمش معنى
const NOTE_MIN_ROOM = 6;

function cps(s) {
  return Array.from(s);
}

// حروف التحكم + علامات الاتجاه/العرض الصفري — بأرقام عشري مش `\u` عمداً: الـ`\u` بيتفك لحرف حقيقي
// في أدوات النقل والنشر (اتلسعنا: سطر جديد حقيقي جوّه regex = الدالة كلها SyntaxError)، والفاحص
// بيرفض علامات bidi الحرفية في المرآة.
function stripChar(cp) {
  return cp <= 31 || cp === 127 || cp === 1564 || (cp >= 8203 && cp <= 8207) ||
    (cp >= 8234 && cp <= 8238) || (cp >= 8294 && cp <= 8297);
}

/** تنظيف ملاحظة البوليصة: حروف التحكم وعلامات الاتجاه بتتشال · الروابط بتتشال (J&T عندها
 *  145003108 «Comments, descriptions, links are illegal») · كل المسافات والسطور = مسافة واحدة. */
export function cleanShipNote(raw) {
  let s = cps(String(raw ?? "")).map((ch) => (stripChar(ch.codePointAt(0) || 0) ? " " : ch)).join("");
  s = s.replace(/(?:https?:\/\/|www\.)\S+/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  const c = cps(s);
  if (c.length > NOTE_MAX) s = c.slice(0, NOTE_MAX).join("").trim();
  return s;
}

/** سطور المنتجات + الخصائص — نفس remarkFor القديمة في jt-ship بالحرف. */
export function remarkBaseLines(productName, props) {
  const lines = [];
  const pn = String(productName || "").replace(/\r/g, "");
  for (const part of pn.split(/\s*\+\s*|\n/)) { const t = part.trim(); if (t) lines.push(t); }
  const p = String(props || "").trim();
  if (p && !lines.some((l) => l.includes(p))) lines.push(p);
  return lines;
}

/** الـremark النهائي. props = manufacturer_note || var (زي ما jt-ship بتبعتها). */
export function composeRemark(productName, props, note) {
  const base = remarkBaseLines(productName, props).join("\n");
  const n = cps(base).length;
  if (n > REMARK_MAX) return cps(base).slice(0, REMARK_MAX - 1).join("") + "…";
  const clean = cleanShipNote(note);
  if (!clean) return base;
  const sep = base ? "\n" : "";
  const room = REMARK_MAX - n - sep.length - cps(NOTE_PREFIX).length;
  if (room < NOTE_MIN_ROOM) return base;
  const c = cps(clean);
  const text = c.length <= room ? clean : c.slice(0, room - 1).join("") + "…";
  return base + sep + NOTE_PREFIX + text;
}
