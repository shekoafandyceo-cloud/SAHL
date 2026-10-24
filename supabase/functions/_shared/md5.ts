// md5 — تطبيق نقي (من غير أي import) عشان يشتغل في Deno (Edge Functions)
// وفي Node (الهارنسات المحلية) بنفس البايتات.
//
// ليه مش Web Crypto؟ `crypto.subtle.digest` مافيهاش MD5 في المتصفح ولا في
// Deno من غير `@std/crypto` (WASM)، وNode عنده `node:crypto` بس Deno لأ —
// فالمشترك الوحيد اللي بيدي نفس الناتج في الاتنين هو تطبيق يدوي.
// J&T بتوقّع MD5 على بايتات UTF-8 (الأسماء والعناوين عربي) — فالدخل هنا
// دايماً بيتحوّل لـUTF-8 الأول، ومعايرته في tools/test-jt-sign.mjs ضد
// `node:crypto` وPython `hashlib` على نص عربي.

const K = new Uint32Array(64);
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/** MD5 على بايتات — بيرجّع 16 بايت خام. */
export function md5Bytes(input: Uint8Array): Uint8Array {
  const len = input.length;
  // padding: 0x80 ثم أصفار ثم الطول بالبت little-endian (64 بت)
  const padLen = ((len + 8) >>> 6 << 6) + 64;
  const buf = new Uint8Array(padLen);
  buf.set(input);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, bits >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(bits / 4294967296) >>> 0, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return out;
}

/** MD5 على نص (UTF-8) — بيرجّع البايتات الخام. */
export function md5Raw(text: string): Uint8Array {
  return md5Bytes(new TextEncoder().encode(text));
}

/** MD5 على نص — hex صغير (32 حرف). */
export function md5Hex(text: string): string {
  return Array.from(md5Raw(text), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64 لبايتات خام — من غير Buffer/btoa عشان نفس الكود يشتغل في الاتنين. */
export function bytesToBase64(bytes: Uint8Array): string {
  const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += T[(n >>> 18) & 63] + T[(n >>> 12) & 63] +
      (i + 1 < bytes.length ? T[(n >>> 6) & 63] : "=") +
      (i + 2 < bytes.length ? T[n & 63] : "=");
  }
  return out;
}
