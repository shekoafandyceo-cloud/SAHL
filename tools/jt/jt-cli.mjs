#!/usr/bin/env node
// أداة تحقق محلية لـJ&T — بتستخدم **نفس** عميل الـEdge Functions
// (`supabase/functions/_shared/jt.ts`) عشان اللي بيتأكد هنا هو اللي هيتنشر.
//
// الاستخدام:
//   node tools/jt/jt-cli.mjs query  UEG088902573105 [أكتر...]     # Query Order (command:2)
//   node tools/jt/jt-cli.mjs trace  UEG088902573105 [أكتر...]     # Logistics Track Query
//   node tools/jt/jt-cli.mjs waybill-info UEG088902573105        # waybill/getWaybillInfo (الوزن المحاسَب + الشحن)
//   node tools/jt/jt-cli.mjs pca [2|3|4]                          # المحافظات/المدن/المناطق المخدومة
//   node tools/jt/jt-cli.mjs freight '{"prov":..,"city":..,"area":..,"address":..}' '{...receiver}' 1.5
//   node tools/jt/jt-cli.mjs raw    order/getOrders '{"command":2,"serialNumber":["UEG…"]}'
//   خيارات:
//     --dry-run                 يطبع الغلاف (متعتّم) من غير أي نداء شبكة
//     --env sandbox|production  الافتراضي من JT_ENV أو sandbox
//     --env-file <path>         ملف KEY=VALUE (مش بيتقرأ من الريبو — حطه بره أو في tools/jt/.env.local المتجاهَل)
//     --timestamp <ms>          تثبيت الـtimestamp (لمقارنة التوقيع مع Postman)
//     --compare-digest <b64>    يقارن توقيع الهيدر المحسوب بواحد منسوخ من طلب Postman الناجح
//     --no-biz-digest           (raw بس) مايضيفش customerCode/digest للحمولة
//     --show-response-raw       يطبع نص الرد كما هو لو مش JSON
//
// المتغيرات (من البيئة أو --env-file):
//   JT_BASE_URL            اختيارية — الافتراضي من البوابة: demoopenapi/openapi.jtjms-eg.com/webopenplatformapi/api
//   JT_API_ACCOUNT · JT_PRIVATE_KEY · JT_CUSTOMER_CODE
//   JT_PASSWORD_PROCESSED  (UPPER HEX MD5)  — أو JT_PASSWORD (نص صريح؛ بيتعالج في الذاكرة ومابيتطبعش)
//
// 🔴 حراسات:
//   - مفيش أمر `create` هنا أصلاً. `raw order/addOrder` مرفوض في الإنتاج
//     من العميل نفسه (JtGuardError)، وفي الـSandbox محتاج --allow-create صريحة.
//   - ولا سر بيتطبع: كل المطبوع بيعدّي على redactRequest.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const jt = await import(pathToFileURL(path.join(HERE, '..', '..', 'supabase', 'functions', '_shared', 'jt.ts')).href);

// ── args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for(let i = 0; i < argv.length; i++){
  const a = argv[i];
  if(a.startsWith('--')){
    const k = a.slice(2);
    const needsVal = ['env', 'env-file', 'timestamp', 'compare-digest'].includes(k);
    flags[k] = needsVal ? argv[++i] : true;
  } else pos.push(a);
}
const op = pos[0];
if(!op || flags.help){
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 28).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(op ? 0 : 2);
}

// ── env ─────────────────────────────────────────────────────────────
const env = { ...process.env };
if(flags['env-file']){
  const p = path.resolve(flags['env-file']);
  for(const line of fs.readFileSync(p, 'utf8').split('\n')){
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if(!m || line.trim().startsWith('#')) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const jtEnv = String(flags.env || env.JT_ENV || 'sandbox').toLowerCase();
if(jtEnv !== 'sandbox' && jtEnv !== 'production'){ console.error('✗ --env لازم sandbox أو production'); process.exit(2); }
const missing = [];
const need = (k) => { const v = (env[k] || '').trim(); if(!v) missing.push(k); return v; };
// JT_BASE_URL اختيارية: لو فاضية بناخد جذر البيئة من البوابة المصرية (jt.JT_BASE_URLS)
const baseUrl = (env.JT_BASE_URL || '').trim() || jt.JT_BASE_URLS[jtEnv];
const apiAccount = need('JT_API_ACCOUNT');
const privateKey = need('JT_PRIVATE_KEY');
const customerCode = need('JT_CUSTOMER_CODE');
let passwordProcessed = (env.JT_PASSWORD_PROCESSED || '').trim();
if(!passwordProcessed && (env.JT_PASSWORD || '').trim()) passwordProcessed = jt.processPassword(env.JT_PASSWORD);
if(!passwordProcessed) missing.push('JT_PASSWORD_PROCESSED (أو JT_PASSWORD)');
if(missing.length){
  console.error('✗ متغيرات ناقصة: ' + missing.join(' · ') + '\n  حطها في البيئة أو في ملف --env-file (بره الريبو أو tools/jt/.env.local)');
  process.exit(2);
}
if(!/^[0-9A-F]{32}$/.test(passwordProcessed)){
  console.error('✗ JT_PASSWORD_PROCESSED لازم يبقى 32 حرف hex كبير (UPPER HEX MD5) — أو ابعت JT_PASSWORD الصريحة وسيب الأداة تعالجها');
  process.exit(2);
}
const creds = { apiAccount, privateKey, customerCode, passwordProcessed };
const cfg = { env: jtEnv, baseUrl, creds };

// ── build the call ──────────────────────────────────────────────────
let callPath, biz;
if(op === 'query'){
  const wbs = pos.slice(1);
  if(!wbs.length){ console.error('✗ query محتاج رقم بوليصة واحد على الأقل'); process.exit(2); }
  callPath = jt.JT_PATHS.getOrders;
  biz = jt.withBusinessDigest({ command: 2, serialNumber: wbs }, creds);
} else if(op === 'trace'){
  const wbs = pos.slice(1);
  if(!wbs.length){ console.error('✗ trace محتاج رقم بوليصة واحد على الأقل'); process.exit(2); }
  callPath = jt.JT_PATHS.trace;
  if(wbs.length > 30){ console.error('✗ trace بياخد 30 بوليصة على الأكتر في النداء الواحد (توثيق مصر)'); process.exit(2); }
  // من توثيق مصر: billCodes مفصولة بفاصلة (صفحة logistics/trace مافيهاش customerCode/digest —
  // بنبعتهم زي ما نجح في الـSandbox؛ لو اترفض نشيلهم)
  biz = jt.withBusinessDigest({ billCodes: wbs.join(',') }, creds);
} else if(op === 'waybill-info'){
  const wbs = pos.slice(1);
  if(!wbs.length){ console.error('✗ waybill-info محتاج رقم بوليصة واحد على الأقل'); process.exit(2); }
  callPath = jt.JT_PATHS.getWaybillInfo;
  // الصفحة بتحط customerCode بس (من غير digest) — بنبعت الاتنين زي باقي الصفحات؛ لو J&T رفض نشيل digest
  biz = jt.withBusinessDigest({ waybillNos: wbs }, creds);
} else if(op === 'pca'){
  callPath = jt.JT_PATHS.pca;
  biz = jt.withBusinessDigest({ type: String(pos[1] || '4') }, creds);
} else if(op === 'freight'){
  // freight '<sender JSON>' '<receiver JSON>' <weightKg>  — كل واحد {prov,city,area,address}
  let snd, rcv;
  try{ snd = JSON.parse(pos[1]); rcv = JSON.parse(pos[2]); }catch(e){ console.error('✗ freight محتاج sender وreceiver كـJSON: {prov,city,area,address}'); process.exit(2); }
  const w = pos[3] || '1';
  callPath = jt.JT_PATHS.freightEstimate;
  biz = jt.withBusinessDigest({ sender: snd, receiver: rcv, weight: String(w) }, creds);
} else if(op === 'raw'){
  callPath = pos[1]; const j = pos[2];
  if(!callPath || !j){ console.error('✗ raw محتاج <path> <bizContent JSON>'); process.exit(2); }
  let parsed;
  try{ parsed = JSON.parse(j); }catch(e){ console.error('✗ bizContent مش JSON صالح: ' + e.message); process.exit(2); }
  biz = flags['no-biz-digest'] ? parsed : jt.withBusinessDigest(parsed, creds);
  if(jt.isCreateEndpoint(callPath)){
    if(jtEnv !== 'sandbox' || flags['allow-create'] !== true){
      console.error('✗ ' + callPath + ' بيخلق شحنة. مرفوض هنا: الإنتاج ممنوع نهائياً في المرحلة دي، والـSandbox محتاج --allow-create صريحة.');
      process.exit(3);
    }
  }
} else {
  console.error('✗ أمر مش معروف: ' + op + ' — المتاح: query · trace · waybill-info · pca · freight · raw');
  process.exit(2);
}

const now = flags.timestamp ? Number(flags.timestamp) : Date.now();
const req = jt.buildRequest(cfg, callPath, biz, now);
console.log('▶ ' + jtEnv.toUpperCase() + ' ' + req.method + ' ' + req.url);
console.log(JSON.stringify(jt.redactRequest(req, creds), null, 2));
if(flags['compare-digest']){
  const same = String(flags['compare-digest']).trim() === req.headers.digest;
  console.log(same ? '✓ توقيع الهيدر مطابق للمنسوخ من Postman' : '✗ توقيع الهيدر **مختلف** عن المنسوخ — راجع: نفس bizContent بالحرف؟ نفس privateKey؟ نفس الـtimestamp مش داخل في التوقيع أصلاً');
  if(!same) process.exitCode = 4;
}
if(flags['dry-run']){ console.log('(dry-run — مفيش نداء)'); process.exit(process.exitCode || 0); }

// ── call ────────────────────────────────────────────────────────────
let res;
try{
  res = await jt.jtCall(cfg, callPath, biz, { now, timeoutMs: 25000 });
}catch(e){
  if(e && e.name === 'JtGuardError'){ console.error('✗ اترفض من حارس العميل: ' + e.message); process.exit(3); }
  console.error('✗ النداء فشل: ' + (e && e.message || e)); process.exit(5);
}
console.log('◀ HTTP ' + res.status + (res.code != null ? ' · code=' + res.code : '') + (res.msg != null ? ' · msg=' + res.msg : ''));
if(res.json) console.log(JSON.stringify(res.json, null, 2));
else console.log(flags['show-response-raw'] ? res.raw : '(الرد مش JSON — ' + res.raw.length + ' بايت؛ استخدم --show-response-raw)');
process.exit(res.ok && (res.code === null || res.code === '1') ? 0 : 6);
