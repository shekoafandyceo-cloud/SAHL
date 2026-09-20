#!/usr/bin/env node
// إثبات تطابق توقيع J&T على **نفس المدخلات بالحرف** — من غير أي طلب شبكة.
//
//   node tools/jt/sign-check.mjs                    # يحسب متجهات tools/jt/sign-vectors.json ويطبع PASS/FAIL
//   node tools/jt/sign-check.mjs --print            # يطبع القيم المحسوبة كمان (عشان تقارنها بإيدك مع Postman)
//   node tools/jt/sign-check.mjs --input my.json    # ملف متجهات تاني بنفس الشكل (مثلاً بقيم Postman في expected_*)
//
// المواصفة (نفسها في supabase/functions/_shared/jt.ts):
//   processedPassword = UPPER(HEX(MD5(plainPassword + "jadada236t2")))
//   businessDigest    = BASE64(RAW MD5(UPPER(customerCode + processedPassword) + privateKey))   ← زي مثال PHP الرسمي
//   headerDigest      = BASE64(RAW MD5(bizContent + privateKey))       ← bizContent نص حرفي، مش object
//
// PASS/FAIL بيتحسب ضد **تطبيق بايثون مستقل** (hashlib) على نفس المدخلات دايماً،
// وكمان ضد expected_* لو متعبّية في الملف (من Postman مثلاً). لو expected_* فاضية
// بيتقال «no expected» مش FAIL.
// ⚠️ التطابق هنا بيثبت إن الاتنين بيطبّقوا نفس المواصفة — مش إن J&T بتقبلها.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const jt = await import(pathToFileURL(path.join(HERE, '..', '..', 'supabase', 'functions', '_shared', 'jt.ts')).href);

const argv = process.argv.slice(2);
const PRINT = argv.includes('--print');
const inIdx = argv.indexOf('--input');
const file = inIdx >= 0 ? path.resolve(argv[inIdx + 1]) : path.join(HERE, 'sign-vectors.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const vectors = Array.isArray(doc) ? doc : doc.vectors;

const PY = `
import hashlib, base64, json, sys
for d in json.loads(sys.stdin.read()):
    proc = hashlib.md5((d['plainPassword'] + 'jadada236t2').encode('utf-8')).hexdigest().upper()
    biz  = base64.b64encode(hashlib.md5(((d['customerCode'] + proc).upper() + d['privateKey']).encode('utf-8')).digest()).decode()
    hdr  = base64.b64encode(hashlib.md5((d['bizContent'] + d['privateKey']).encode('utf-8')).digest()).decode()
    print(json.dumps({'proc': proc, 'biz': biz, 'hdr': hdr}))
`;
const py = spawnSync('python3', ['-c', PY], { input: JSON.stringify(vectors), encoding: 'utf8' });
const pyRows = py.status === 0 ? py.stdout.trim().split('\n').map(l => JSON.parse(l)) : null;
if(!pyRows) console.log('⚠ python3 مش متاح — المقارنة المستقلة اتخطّت (' + (py.stderr || '').trim().slice(0, 80) + ')');

let fail = 0;
for(let i = 0; i < vectors.length; i++){
  const v = vectors[i];
  const proc = jt.processPassword(v.plainPassword);
  const biz = jt.businessDigest(v.customerCode, proc, v.privateKey);
  const hdr = jt.headerDigest(v.bizContent, v.privateKey);
  const checks = [];
  if(pyRows){
    checks.push(['python:processedPassword', proc === pyRows[i].proc]);
    checks.push(['python:businessDigest', biz === pyRows[i].biz]);
    checks.push(['python:headerDigest', hdr === pyRows[i].hdr]);
  }
  const exp = [['expected_processedPassword', proc], ['expected_businessDigest', biz], ['expected_headerDigest', hdr]];
  for(const [k, got] of exp){
    const want = String(v[k] || '').trim();
    if(want) checks.push([k.replace('expected_', 'expected:'), want === got]);
  }
  const bad = checks.filter(c => !c[1]);
  fail += bad.length;
  const tag = bad.length ? 'FAIL' : (checks.length ? 'PASS' : 'no expected');
  console.log(`${tag}  ${v.name}` + (bad.length ? '  ← ' + bad.map(c => c[0]).join(', ') : ''));
  if(PRINT){
    console.log('     processedPassword = ' + proc);
    console.log('     businessDigest    = ' + biz);
    console.log('     headerDigest      = ' + hdr);
  }
}
console.log(fail ? `\nFAIL (${fail})` : '\nPASS');
process.exit(fail ? 1 : 0);
