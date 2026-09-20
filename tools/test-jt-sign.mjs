// عميل J&T — التوقيع والغلاف والحراسات (من غير أي شبكة).
//
// بيشغّل الملف الحقيقي `supabase/functions/_shared/jt.ts` (Node 22 بيقرا
// TypeScript مباشرة) — مش نسخة منه. اللي بيتأكد:
//   1) md5 النقي مطابق لـ`node:crypto` على: المتجهات القياسية · نص عربي ·
//      حدود الـpadding (55/56/63/64/65 بايت) · 200 بايت عشوائي
//   2) سلسلة التوقيع التلاتية مطابقة لتطبيق **مستقل** بالبايثون (hashlib)
//      من نفس المواصفة — لو الاتنين اتفقوا، الكود بيطبّق المواصفة اللي
//      اتوصفت. (⚠️ ده مابيثبتش إن المواصفة نفسها هي اللي J&T عايزاها —
//      ده بيتأكد بالطلب الناجح المحفوظ في Postman: `jt-cli --compare-digest`)
//   3) الغلاف: اللي اتوقّع عليه هو **نفس** اللي في الـbody بالبايت
//   4) الحارس: addOrder في الإنتاج بيترفض **قبل** أي نداء شبكة
//   5) التعتيم: مفيش سر بيظهر في الطلب المطبوع
//   6) معايرات (لازم تفشل): hex صغير في كلمة السر · مسافات في bizContent ·
//      شيل الحارس من الكود نفسه · سر متسرّب في التعتيم
//
// تشغيل:  node tools/test-jt-sign.mjs
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.join(HERE, '..', 'supabase', 'functions', '_shared');
const jt = await import(pathToFileURL(path.join(SHARED, 'jt.ts')).href);
const { md5Hex, md5Raw, bytesToBase64 } = await import(pathToFileURL(path.join(SHARED, 'md5.ts')).href);

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const nodeMd5Hex = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const nodeMd5B64 = (s) => createHash('md5').update(s, 'utf8').digest('base64');

// ── 1) md5 ─────────────────────────────────────────────────────────
console.log('1) md5 النقي ضد node:crypto');
ok(md5Hex('') === 'd41d8cd98f00b204e9800998ecf8427e', 'md5("") المتجه القياسي');
ok(md5Hex('abc') === '900150983cd24fb0d6963f7d28e17f72', 'md5("abc") المتجه القياسي');
ok(md5Hex('The quick brown fox jumps over the lazy dog') === '9e107d9d372bb6826bd81d3542a419d6', 'md5(fox) المتجه القياسي');
const AR = 'عميل تجريبي — القاهره، مدينه نصر، شارع 12 — تيشيرت أسود مقاس L';
ok(md5Hex(AR) === nodeMd5Hex(AR), 'نص عربي (UTF-8) مطابق');
ok(bytesToBase64(md5Raw(AR)) === nodeMd5B64(AR), 'base64 للبايتات الخام مطابق');
for(const n of [55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]){
  const s = 'x'.repeat(n);
  ok(md5Hex(s) === nodeMd5Hex(s), 'حد الـpadding عند ' + n + ' بايت');
}
let randOk = true;
for(let i = 0; i < 200; i++){
  const b = randomBytes(1 + Math.floor(Math.random() * 300));
  const mine = Array.from(md5Raw ? (await import(pathToFileURL(path.join(SHARED, 'md5.ts')).href)).md5Bytes(new Uint8Array(b)) : [], x => x.toString(16).padStart(2, '0')).join('');
  if(mine !== createHash('md5').update(b).digest('hex')){ randOk = false; break; }
}
ok(randOk, '200 مدخل بايتات عشوائي مطابق');

// ── 2) سلسلة التوقيع ضد بايثون (تطبيق مستقل من نفس المواصفة) ───────
console.log('2) سلسلة التوقيع ضد تطبيق بايثون مستقل');
const creds = {
  apiAccount: '178098817867064328',
  privateKey: 'a0a1047cce70493c9d5d29704f05d0d9',
  customerCode: 'J0086011282',
  plain: 'Pa$$w0rd-تجريبي',
};
const py = `
import hashlib, base64, json, sys
d = json.loads(sys.stdin.read())
proc = hashlib.md5((d['plain'] + 'jadada236t2').encode('utf-8')).hexdigest().upper()
biz  = base64.b64encode(hashlib.md5((d['customerCode'] + proc + d['privateKey']).encode('utf-8')).digest()).decode()
hdr  = base64.b64encode(hashlib.md5((d['bizContent'] + d['privateKey']).encode('utf-8')).digest()).decode()
print(json.dumps({'proc': proc, 'biz': biz, 'hdr': hdr}))
`;
const processed = jt.processPassword(creds.plain);
const jcreds = { apiAccount: creds.apiAccount, privateKey: creds.privateKey, customerCode: creds.customerCode, passwordProcessed: processed };
const bizObj = jt.withBusinessDigest({ command: 2, serialNumber: ['UEG088902573105'], note: AR }, jcreds);
const bizContent = JSON.stringify(bizObj);
const pyOut = spawnSync('python3', ['-c', py], { input: JSON.stringify({ ...creds, bizContent }), encoding: 'utf8' });
ok(pyOut.status === 0, 'بايثون اشتغل (' + (pyOut.stderr || '').trim().slice(0, 80) + ')');
const ref = pyOut.status === 0 ? JSON.parse(pyOut.stdout) : {};
ok(processed === ref.proc, 'processedPassword = UPPER HEX MD5(plain+salt) — مطابق لبايثون');
ok(/^[0-9A-F]{32}$/.test(processed), 'processedPassword 32 حرف hex كبير');
ok(bizObj.digest === ref.biz, 'businessDigest = BASE64(RAW MD5(code+proc+key)) — مطابق لبايثون');
ok(bizObj.customerCode === creds.customerCode, 'customerCode جوّه bizContent');
ok(jt.headerDigest(bizContent, creds.privateKey) === ref.hdr, 'headerDigest = BASE64(RAW MD5(bizContent+key)) — مطابق لبايثون');

// ── 3) الغلاف ──────────────────────────────────────────────────────
console.log('3) الغلاف — نفس النص بالبايت في التوقيع والـbody');
const cfg = { env: 'sandbox', baseUrl: 'https://sandbox.example.invalid/webopenplatformapi/api/', creds: jcreds };
const req = jt.buildRequest(cfg, '/order/getOrders/', bizObj, 1789900000123.7);
ok(req.url === 'https://sandbox.example.invalid/webopenplatformapi/api/order/getOrders', 'الـURL: جذر + مسار من غير سلاشات زيادة');
ok(req.headers['Content-Type'] === 'application/x-www-form-urlencoded', 'Content-Type فورم');
ok(req.headers.apiAccount === creds.apiAccount && req.headers.timestamp === '1789900000123', 'apiAccount + timestamp ملّي ثانية صحيح');
const params = new URLSearchParams(req.body);
ok(params.get('bizContent') === req.bizContent, 'bizContent في الـbody بيتفك لنفس النص اللي اتوقّع عليه');
ok(jt.headerDigest(params.get('bizContent'), creds.privateKey) === req.headers.digest, 'إعادة حساب التوقيع من الـbody المفكوك = الهيدر');
ok(req.bizContent.indexOf('\n') < 0 && req.bizContent.indexOf('  ') < 0, 'JSON مضغوط (من غير مسافات) — الطلب الناجح كان كده');
ok(JSON.parse(req.bizContent).note === AR, 'العربي محفوظ زي ما هو جوّه bizContent');

// ── 4) الحارس ──────────────────────────────────────────────────────
console.log('4) حارس الإنشاء في الإنتاج');
async function spyCall(env, p, opts){
  let called = 0;
  const fetchImpl = async () => { called++; return new Response(JSON.stringify({ code: '1', msg: 'success', data: { ok: 1 } }), { status: 200 }); };
  let threw = null;
  try{ await jt.jtCall({ ...cfg, env }, p, bizObj, { fetchImpl, ...(opts || {}) }); }catch(e){ threw = e; }
  return { called, threw };
}
let r = await spyCall('production', 'order/addOrder');
ok(r.threw && r.threw.name === 'JtGuardError' && r.called === 0, 'production + addOrder → JtGuardError **قبل** أي نداء شبكة');
r = await spyCall('production', '/order/addOrder/');
ok(r.threw && r.called === 0, 'نفس الحارس مع سلاشات حوالين المسار (التطبيع)');
r = await spyCall('production', 'order/getOrders');
ok(!r.threw && r.called === 1, 'production + getOrders (قراءة) → بيعدّي');
r = await spyCall('sandbox', 'order/addOrder');
ok(!r.threw && r.called === 1, 'sandbox + addOrder → بيعدّي');
r = await spyCall('production', 'order/addOrder', { allowCreateInProduction: true });
ok(!r.threw && r.called === 1, 'production + addOrder + allowCreateInProduction صريحة → بيعدّي (للمرحلة الجاية بس)');
r = await spyCall('production', 'order/addOrder', { allowCreateInProduction: 'true' });
ok(r.threw && r.called === 0, 'allowCreateInProduction كسترينج "true" (من حمولة خارجية) → مرفوض — لازم boolean حقيقي');
const res = await jt.jtCall(cfg, 'order/getOrders', bizObj, { fetchImpl: async () => new Response('{"code":"1","msg":"success","data":[{"a":1}]}', { status: 200 }) });
ok(res.ok && res.code === '1' && res.msg === 'success' && Array.isArray(res.data), 'الرد بيتفك لـcode/msg/data');
const resBad = await jt.jtCall(cfg, 'order/getOrders', bizObj, { fetchImpl: async () => new Response('<html>502</html>', { status: 502 }) });
ok(!resBad.ok && resBad.json === null && resBad.raw.indexOf('502') >= 0, 'رد مش JSON بيرجع raw من غير ما يرمي');

// ── 5) التعتيم ─────────────────────────────────────────────────────
console.log('5) التعتيم');
const printed = JSON.stringify(jt.redactRequest(req, jcreds));
ok(printed.indexOf(creds.privateKey) < 0, 'privateKey مش في المطبوع');
ok(printed.indexOf(processed) < 0, 'passwordProcessed مش في المطبوع');
ok(printed.indexOf(bizObj.digest) < 0 && printed.indexOf(req.headers.digest) < 0, 'التوقيعين الكاملين مش في المطبوع');
ok(printed.indexOf(creds.apiAccount) < 0, 'apiAccount الكامل مش في المطبوع');
ok(printed.indexOf('UEG088902573105') >= 0, 'بس الحمولة العادية (رقم البوليصة) باينة');

// ── 6) معايرات — لازم تفشل ────────────────────────────────────────
console.log('6) معايرات');
// (أ) hex صغير — الشكل اللي أي مطوّر ممكن يكتبه بالغلط
const lowerProc = md5Hex(creds.plain + 'jadada236t2');
ok(jt.businessDigest(creds.customerCode, lowerProc, creds.privateKey) !== ref.biz, 'معايرة: hex صغير في كلمة السر → توقيع تجاري مختلف (الفحص بيمسكه)');
// (ب) bizContent بمسافات — نفس الـobject، نص مختلف
ok(jt.headerDigest(JSON.stringify(bizObj, null, 2), creds.privateKey) !== req.headers.digest, 'معايرة: JSON بمسافات → توقيع هيدر مختلف');
// (ج) ترتيب مفاتيح مختلف — نفس المعنى، توقيع مختلف
const reordered = JSON.stringify({ serialNumber: bizObj.serialNumber, command: bizObj.command, note: bizObj.note, customerCode: bizObj.customerCode, digest: bizObj.digest });
ok(jt.headerDigest(reordered, creds.privateKey) !== req.headers.digest, 'معايرة: ترتيب مفاتيح مختلف → توقيع مختلف (فالنص لازم يتكوّن مرة واحدة)');
// (د) شيل الحارس من الكود نفسه — نسخة متلبّسة من jt.ts في مجلد مؤقت
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-cal-'));
  fs.copyFileSync(path.join(SHARED, 'md5.ts'), path.join(tmp, 'md5.ts'));
  const src = fs.readFileSync(path.join(SHARED, 'jt.ts'), 'utf8');
  const ANCHOR = 'if (isCreateEndpoint(p) && cfg.env === "production" && opts.allowCreateInProduction !== true) {';
  const before = src;
  const patched = src.replace(ANCHOR, 'if (false) {');
  if(patched === before) throw new Error('المعايرة مالقتش مرساة الحارس في jt.ts');
  fs.writeFileSync(path.join(tmp, 'jt.ts'), patched);
  const bad_jt = await import(pathToFileURL(path.join(tmp, 'jt.ts')).href);
  let called = 0, threw = null;
  try{ await bad_jt.jtCall({ ...cfg, env: 'production' }, 'order/addOrder', bizObj, { fetchImpl: async () => { called++; return new Response('{}', { status: 200 }); } }); }catch(e){ threw = e; }
  ok(!threw && called === 1, 'معايرة: شيل الحارس → الفحص (4) كان هيقع (النداء وصل للشبكة)');
  fs.rmSync(tmp, { recursive: true, force: true });
}
// (هـ) تعتيم ناقص — لو حد رجّع الهيدر كامل
{
  const leaky = { ...jt.redactRequest(req, jcreds), headers: { ...req.headers } };
  ok(JSON.stringify(leaky).indexOf(req.headers.digest) >= 0, 'معايرة: هيدرات من غير تعتيم → التوقيع الكامل بيظهر (الفحص 5 بيمسكه)');
}

console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✓ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
