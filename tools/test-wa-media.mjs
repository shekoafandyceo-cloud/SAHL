// صور الردود المحفوظة بالـ`media id` (4 نوفمبر — Egress) — supabase/functions/_shared/wa-media.ts بالحرف، من غير متصفح
//
// اللي بيتفحص (svc وfetch وهميين — مفيش أي نداء حقيقي لميتا ولا للـStorage):
//   1) isQuickReplyPath: صور `<tenant>/quick-replies/` بس — مرفق الشات · متجر تاني · `..` = لأ
//   2) كاش جديد = الـid على طول من غير تنزيل ولا رفع
//   3) كاش أقدم من 25 يوم = تنزيل + رفع + الكاش اتحدّث
//   4) مفيش كاش = رفع: الحقول (messaging_product · type من الامتداد · file) + الكاش اتكتب
//   5) الرفع وقع = null + «-» في الكاش · خلال ساعة = null **من غير تنزيل** · بعد ساعة = محاولة تانية
//   6) التنزيل وقع = null + «-»
//   7) التنزيل علّق = null بعد المهلة (مش الإرسال يفضل معلّق)
//   8) الرفع علّق = null بعد المهلة (الـfetch اتلغى بالـsignal)
//   9) shouldRetryWithLink: 100/131053/مجهول (4xx) = آه · 5xx · النافذة · التوكن · الـrate limit = لأ
//  10) svc بيرمي = null (الدالة عمرها ما بترمي) · forgetMediaId بيمسح بالمفاتيح التلاتة
// المعايرات (كل واحدة بتحقن الشكل الغلط في نسخة من الملف وتتأكد إن فحصها **بيقع**):
//   (أ) من غير «الفشل اتفتكر ساعة» → 5 · (ب) من غير مهلة التنزيل → 7 · (ج) الإعادة على 190 → 9 ·
//   (د) أي مسار يعدّي → 1 · (هـ) الكاش القديم يتصدّق → 3
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TS = path.join(ROOT, 'supabase/functions/_shared/wa-media.ts');
const T = 'ten-1', PH = 'ph-1', TOK = 'tok';
const QR = T + '/quick-replies/1-0.png';
const DAY = 24 * 3600 * 1000;
const silence = console.error; console.error = () => {};

function fakeSvc(opts) {
  const st = { rows: opts.rows ? opts.rows.slice() : [], downloads: 0, upserts: [], deletes: [], throwOn: opts.throwOn };
  const svc = {
    from(table) {
      if (st.throwOn === 'from') throw new Error('boom');
      const f = { eqs: {} };
      const q = {
        select() { return q; },
        eq(k, v) { f.eqs[k] = v; return q; },
        maybeSingle() {
          const r = st.rows.find(x => x.tenant_id === f.eqs.tenant_id && x.phone_id === f.eqs.phone_id && x.path === f.eqs.path);
          return Promise.resolve({ data: r ? { media_id: r.media_id, uploaded_at: r.uploaded_at } : null, error: null });
        },
        upsert(row) {
          st.upserts.push(row);
          st.rows = st.rows.filter(x => !(x.tenant_id === row.tenant_id && x.phone_id === row.phone_id && x.path === row.path)).concat([row]);
          return Promise.resolve({ error: null });
        },
        delete() { return { eq(k, v) { f.eqs[k] = v; return this; }, then(res) { st.deletes.push({ ...f.eqs }); return Promise.resolve({ error: null }).then(res); } }; },
      };
      return q;
    },
    storage: { from() { return { download() {
      st.downloads++;
      if (opts.download === 'hang') return new Promise(() => {});
      if (opts.download === 'error') return Promise.resolve({ data: null, error: { message: 'x' } });
      return Promise.resolve({ data: new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }), error: null });
    } }; } },
  };
  return { svc, st };
}
function fakeFetch(mode) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    if (mode === 'hang') return new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
    if (mode === 'fail') return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: { code: 100, message: 'bad' } }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'MID-' + calls.length }) });
  };
  return { fn, calls };
}
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-11-04T17:00:00Z');

async function runChecks(m) {
  const R = [];
  const ok = (id, c, msg) => R.push({ id, ok: !!c, msg });
  // 1
  ok(1, m.isQuickReplyPath(T, QR) === true, '1) صورة رد محفوظ = آه');
  ok(1, [T + '/conv-1/out-1.jpg', 'other/quick-replies/1.png', T + '/quick-replies/../x.png', null, 5].every(p => m.isQuickReplyPath(T, p) === false),
    '1) مرفق الشات · متجر تاني · «..» · مش نص = لأ');
  // 2
  {
    const { svc, st } = fakeSvc({ rows: [{ tenant_id: T, phone_id: PH, path: QR, media_id: 'MID-OLD', uploaded_at: iso(NOW - 2 * DAY) }] });
    const f = fakeFetch('ok');
    const id = await m.quickReplyMediaId({ svc, graph: 'G', fetchFn: f.fn, now: () => NOW }, T, PH, TOK, QR);
    ok(2, id === 'MID-OLD' && st.downloads === 0 && f.calls.length === 0, `2) كاش عمره يومين = ${id} من غير تنزيل (${st.downloads}) ولا رفع (${f.calls.length})`);
  }
  // 3
  {
    const { svc, st } = fakeSvc({ rows: [{ tenant_id: T, phone_id: PH, path: QR, media_id: 'MID-OLD', uploaded_at: iso(NOW - 26 * DAY) }] });
    const f = fakeFetch('ok');
    const id = await m.quickReplyMediaId({ svc, graph: 'G', fetchFn: f.fn, now: () => NOW }, T, PH, TOK, QR);
    ok(3, id === 'MID-1' && st.downloads === 1 && st.rows.find(r => r.path === QR).media_id === 'MID-1', `3) كاش عمره 26 يوم = رفع جديد ${id} والكاش اتحدّث`);
  }
  // 4
  {
    const { svc, st } = fakeSvc({});
    const f = fakeFetch('ok');
    const id = await m.quickReplyMediaId({ svc, graph: 'G', fetchFn: f.fn, now: () => NOW }, T, PH, TOK, QR);
    const c = f.calls[0];
    const fd = c && c.init.body;
    ok(4, id === 'MID-1' && c && c.url === 'G/' + PH + '/media' && c.init.method === 'POST' && /Bearer tok/.test(c.init.headers.Authorization)
      && fd.get('messaging_product') === 'whatsapp' && fd.get('type') === 'image/png' && fd.get('file') && fd.get('file').size === 7
      && st.upserts.length === 1 && st.upserts[0].media_id === 'MID-1' && st.upserts[0].uploaded_at === iso(NOW),
      `4) مفيش كاش = رفع لـ${c && c.url} (type ${fd && fd.get('type')}) والكاش اتكتب`);
  }
  // 5
  {
    const { svc, st } = fakeSvc({});
    const f = fakeFetch('fail');
    let t = NOW;
    const D = { svc, graph: 'G', fetchFn: f.fn, now: () => t };
    const a = await m.quickReplyMediaId(D, T, PH, TOK, QR);
    const failRow = st.rows.find(r => r.path === QR);
    t = NOW + 30 * 60000;
    const b = await m.quickReplyMediaId(D, T, PH, TOK, QR);
    const dl2 = st.downloads;
    t = NOW + 61 * 60000;
    await m.quickReplyMediaId(D, T, PH, TOK, QR);
    ok(5, a === null && failRow && failRow.media_id === '-' && b === null && dl2 === 1 && st.downloads === 2,
      `5) الرفع وقع = null و«-» · بعد نص ساعة من غير تنزيل (${dl2}) · بعد ساعة محاولة تانية (${st.downloads})`);
  }
  // 6
  {
    const { svc, st } = fakeSvc({ download: 'error' });
    const f = fakeFetch('ok');
    const id = await m.quickReplyMediaId({ svc, graph: 'G', fetchFn: f.fn, now: () => NOW }, T, PH, TOK, QR);
    ok(6, id === null && f.calls.length === 0 && st.rows[0] && st.rows[0].media_id === '-', '6) التنزيل وقع = null من غير رفع و«-» في الكاش');
  }
  // 7
  {
    const { svc } = fakeSvc({ download: 'hang' });
    const f = fakeFetch('ok');
    const t0 = Date.now();
    const id = await Promise.race([m.quickReplyMediaId({ svc, graph: 'G', fetchFn: f.fn, now: () => NOW, timeoutMs: 150 }, T, PH, TOK, QR),
      new Promise(r => setTimeout(() => r('HUNG'), 2000))]);
    ok(7, id === null && Date.now() - t0 < 1500, `7) التنزيل علّق = ${id} بعد ${Date.now() - t0}ms`);
  }
  // 8
  {
    const { svc, st } = fakeSvc({});
    const f = fakeFetch('hang');
    const t0 = Date.now();
    const id = await Promise.race([m.quickReplyMediaId({ svc, graph: 'G', fetchFn: f.fn, now: () => NOW, timeoutMs: 150 }, T, PH, TOK, QR),
      new Promise(r => setTimeout(() => r('HUNG'), 2000))]);
    ok(8, id === null && Date.now() - t0 < 1500 && st.rows[0] && st.rows[0].media_id === '-', `8) الرفع علّق = ${id} بعد ${Date.now() - t0}ms و«-»`);
  }
  // 9
  const yes = [[400, 100], [400, 131053], [400, undefined], [404, 131052]];
  const no = [[500, 131000], [503, undefined], [400, 131047], [400, 131051], [401, 190], [400, 10], [400, 131056], [429, 130429], [400, 4], [400, 131026], [200, undefined]];
  ok(9, yes.every(([s, c]) => m.shouldRetryWithLink(s, c) === true), '9) 100 · 131053 · مجهول (4xx) = نجرّب باللينك');
  ok(9, no.every(([s, c]) => m.shouldRetryWithLink(s, c) === false), '9) 5xx · النافذة · التوكن · الصلاحيات · الـrate limit · الرقم = لأ');
  // 10
  {
    const { svc } = fakeSvc({ throwOn: 'from' });
    let threw = false, id;
    try { id = await m.quickReplyMediaId({ svc, graph: 'G', fetchFn: fakeFetch('ok').fn, now: () => NOW }, T, PH, TOK, QR); } catch (e) { threw = true; }
    const s2 = fakeSvc({});
    await m.forgetMediaId(s2.svc, T, PH, QR);
    const d = s2.st.deletes[0] || {};
    ok(10, !threw && id === null && d.tenant_id === T && d.phone_id === PH && d.path === QR, '10) svc بيرمي = null من غير ما ترمي · forgetMediaId بالمفاتيح التلاتة');
  }
  return R;
}

let bad = 0;
const real = await import(pathToFileURL(TS).href);
for (const r of await runChecks(real)) { console.log(r.ok ? '  ✓' : '  ✗', r.msg); if (!r.ok) bad++; }

console.log('──── المعايرات ────');
const src = fs.readFileSync(TS, 'utf8');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-'));
let n = 0;
async function cal(label, from, to, checkId) {
  if (src.indexOf(from) < 0) { console.log('  ✗', label, '— المرساة مالقتش'); bad++; return; }
  const f = path.join(tmpDir, 'm' + (++n) + '.ts');
  fs.writeFileSync(f, src.replace(from, to));
  const mod = await import(pathToFileURL(f).href);
  const res = await runChecks(mod);
  const fell = res.filter(r => r.id === checkId).some(r => !r.ok);
  console.log(fell ? '  ✓' : '  ✗', label, fell ? `→ فحص ${checkId} وقع` : `→ فحص ${checkId} ماوقعش!`);
  if (!fell) bad++;
}
await cal('(أ) من غير «الفشل اتفتكر ساعة»', 'if (row?.media_id === MEDIA_FAILED && age < MEDIA_FAIL_TTL_MS) return null;', '', 5);
await cal('(ب) من غير مهلة التنزيل', 'await withTimeout(Promise.resolve(d.svc.storage.from("wa-media").download(path)), ms)', 'await d.svc.storage.from("wa-media").download(path)', 7);
await cal('(ج) الإعادة على 190 (التوكن)', '  0, 3, 10, 190, 200, 131031,', '  0, 3, 10, 200, 131031,', 9);
await cal('(د) أي مسار يعدّي', 'return typeof path === "string" && !!tenantId && path.startsWith(`${tenantId}/quick-replies/`) && !path.includes("..");', 'return typeof path === "string";', 1);
await cal('(هـ) الكاش القديم يتصدّق', '&& age < MEDIA_ID_TTL_MS) return String(row.media_id);', ') return String(row.media_id);', 3);
fs.rmSync(tmpDir, { recursive: true, force: true });
console.error = silence;
console.log(bad ? `❌ ${bad} فحص وقع` : '✅ تمام');
process.exit(bad ? 1 : 0);
