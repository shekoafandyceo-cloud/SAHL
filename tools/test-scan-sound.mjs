// app/js/warehouse/scan-sound.js — أصوات سكانر المخزن (15 أكتوبر مساءً — v78) — من غير متصفح
//
// 1) الخانة من نوع النتيجة (code) مش النبرة: مرتجع «warn» بتحذير «J&T قفلته قبل التشغيل» = «وصل» (14 من أول 19 مرتجع حي) ·
//    «J&T ماقالتش إنه مرتجع» = مش «وصل» · الخروج warn (منتج مش مربوط/بالسالب) = مش «مظبوط» · replay = نفس السكان (مش «هبعتهولك»)
// 2) الحرج: السرينة دايماً · المقطع العادي مش حرج حتى لو النبرة warn · من غير مقطع: stop/warn حرج
// 3) التقطيع: bad · range · short · long · ''
// 4) whTrimMono: الطول بمعدّل الخروج · التطبيع 0.95 · fade (أول وآخر عينة ≈ صفر) · مزج القنوات (L = −R = صمت) · خارج المدة = فاضي
// 5) whEncodeWav: RIFF/WAVE/fmt/data · PCM أحادي 16-bit · المعدّل · 1 = 32767 و−1 = −32768 · حجم البيانات
// 6) whPeaks: الطول · 0..1
// المعايرات (حارس المرساة — درس 47): الخانة من النبرة → 1 · replay = dup → 1 · شيل no_return_signal → 1 · الحرج من غير السرينة → 2 ·
// −1 = −32767 → 5 · من غير تطبيع → 4
// تشغيل:  cd tools && node test-scan-sound.mjs
import fs from 'fs';

const SRC_URL = new URL('../app/js/warehouse/scan-sound.js', import.meta.url);
const SRC = fs.readFileSync(SRC_URL, 'utf8');
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

async function load(patch){
  let src = SRC;
  if(patch){
    const out = patch(src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة (درس 47)');
    src = out;
  }
  return import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src) + '%0A//' + Math.random());
}

// نتايج بأشكال السيرفر الحقيقية (wh_scan · wh_unknown_in)
const R = {
  out_ok:      { code: 'out_ok', tone: 'ok', applied: true, dir: 'out', warnings: [] },
  out_short:   { code: 'out_ok', tone: 'warn', applied: true, dir: 'out', warnings: ['short'] },
  out_leak:    { code: 'out_leak_fix', tone: 'ok', applied: true, dir: 'out', warnings: [] },
  out_replay:  { code: 'out_ok', tone: 'ok', applied: true, dir: 'out', warnings: [], replay: true },
  in_ok:       { code: 'in_ok', tone: 'in', applied: true, dir: 'in', warnings: [] },
  in_pre_warn: { code: 'in_ok_precount', tone: 'warn', applied: true, dir: 'in', warnings: ['unregistered_before_start'] },
  in_nosig:    { code: 'in_ok', tone: 'warn', applied: true, dir: 'in', warnings: ['no_return_signal'] },
  in_counted:  { code: 'in_counted', tone: 'in', applied: false, dir: 'in', warnings: [] },
  unk_in:      { code: 'unknown_in', tone: 'in', applied: true, dir: 'in', warnings: [] },
  dup_out:     { code: 'already_out', tone: 'dup', applied: false },
  dup_in:      { code: 'already_in', tone: 'dup', applied: false },
  dup_unk:     { code: 'unknown_already_in', tone: 'dup', applied: false },
  nf:          { code: 'not_found', tone: 'stop', applied: false },
  conflict:    { code: 'unknown_conflict', tone: 'stop', applied: false },
  cancel:      { code: 'blocked_cancelled', tone: 'stop', applied: false },
  confirm:     { code: 'with_jt_confirm', tone: 'warn', options: ['in', 'out'] },
  bad:         { code: 'bad_code', tone: 'stop' },
  busy:        { code: 'busy', tone: 'warn' }
};
const WANT = { out_ok: 'out', out_short: null, out_leak: 'out', out_replay: 'out', in_ok: 'in', in_pre_warn: 'in', in_nosig: null,
  in_counted: 'in', unk_in: 'in', dup_out: 'dup', dup_in: 'dup', dup_unk: 'dup', nf: 'unknown', conflict: null, cancel: null,
  confirm: null, bad: null, busy: null };
function slotsOk(m){
  const bad1 = [];
  for(const k of Object.keys(WANT)) if(m.whSoundSlot(R[k]) !== WANT[k]) bad1.push(k + '=' + m.whSoundSlot(R[k]));
  if(m.whSoundSlot(null) !== null || m.whSoundSlot('x') !== null || m.whSoundSlot({}) !== null) bad1.push('null');
  return bad1;
}
function critOk(m){
  const c = m.whSoundCritical;
  const r = [c('unknown', 'stop', false), c('unknown', 'stop', true), c('in', 'warn', true), c('out', 'ok', true), c('in', 'warn', false),
             c(null, 'stop', false), c(null, 'warn', false), c(null, 'ok', false), c('dup', 'dup', false), c('out', 'ok', false)];
  return r.join(',') === 'true,true,false,false,true,true,true,false,false,false' ? '' : r.join(',');
}
function sine(rate, sec, amp, f){ const n = Math.round(rate * sec), a = new Float32Array(n); for(let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * f * i / rate); return a; }
function trimOk(m){
  const L = sine(44100, 3, 0.3, 440), Rr = sine(44100, 3, 0.3, 440);
  const o = m.whTrimMono([L, Rr], 44100, 0.5, 2.0, 22050);
  let peak = 0; for(const v of o) peak = Math.max(peak, Math.abs(v));
  const lenOk = Math.abs(o.length - 33075) <= 1;
  const fade = Math.abs(o[0]) < 0.01 && Math.abs(o[o.length - 1]) < 0.01;
  const norm = peak > 0.93 && peak <= 0.951;
  const neg = Float32Array.from(L, v => -v);
  const z = m.whTrimMono([L, neg], 44100, 0, 1, 22050);
  let zp = 0; for(const v of z) zp = Math.max(zp, Math.abs(v));
  const empty = m.whTrimMono([L], 44100, 5, 6, 22050).length === 0 && m.whTrimMono([], 44100, 0, 1).length === 0;
  return { lenOk, fade, norm, peak, silent: zp < 1e-6, empty, len: o.length };
}
function wavOk(m){
  const s = new Float32Array([0, 1, -1, 0.5, -0.5]);
  const buf = m.whEncodeWav(s, 22050), v = new DataView(buf);
  const str = (o, n) => String.fromCharCode.apply(null, new Uint8Array(buf, o, n));
  return { riff: str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE' && str(12, 4) === 'fmt ' && str(36, 4) === 'data',
    size: buf.byteLength === 44 + 10 && v.getUint32(4, true) === 36 + 10 && v.getUint32(40, true) === 10,
    pcm: v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 22050 && v.getUint32(28, true) === 44100
      && v.getUint16(32, true) === 2 && v.getUint16(34, true) === 16,
    vals: [v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true), v.getInt16(52, true)].join(',') };
}

const m = await load();
console.log('scan-sound.js');
const s1 = slotsOk(m);
ok(!s1.length, '1) الخانة من نوع النتيجة: مرتجع warn بتحذير «قبل التشغيل» = وصل · «J&T ماقالتش» ≠ وصل · خروج warn ≠ مظبوط · replay ≠ هبعتهولك · not_found = سرينة · الوقّف/القرار = عادي (' + s1.join(' ') + ')');
const c2 = critOk(m);
ok(!c2, '2) الحرج: السرينة دايماً · المقطع مش حرج حتى لو warn · من غير مقطع stop/warn حرج (' + c2 + ')');
const t = m.whTrimCheck;
const t3 = [t(10, 0, 2), t(10, 'x', 2), t(10, 3, 2), t(10, -1, 2), t(10, 9, 10.5), t(10, 1, 1.1), t(10, 0, 5), t(10, 0, 5.2), t(NaN, 0, 1)].join('|');
ok(t3 === '|bad|range|range|range|short||long|bad', '3) التقطيع: bad · range · short · long · 5 ثواني بالظبط مسموح (' + t3 + ')');
const r4 = trimOk(m);
ok(r4.lenOk && r4.fade && r4.norm && r4.silent && r4.empty, '4) whTrimMono: الطول بمعدّل 22050 · تطبيع 0.95 · fade · مزج القنوات · خارج المدة فاضي (' + JSON.stringify(r4) + ')');
const w5 = wavOk(m);
ok(w5.riff && w5.size && w5.pcm && w5.vals === '0,32767,-32768,16384,-16384', '5) whEncodeWav: الهيدر · PCM أحادي 16-bit 22050 · القيم الحدّية (' + JSON.stringify(w5) + ')');
const pk = m.whPeaks([sine(22050, 1, 0.5, 200)], 50);
ok(pk.length === 50 && pk.every(x => x >= 0 && x <= 1) && Math.max(...pk) > 0.45, '6) whPeaks: الطول والمدى');
ok(m.WH_SOUND_SLOTS.join(',') === 'out,in,dup,unknown' && m.WH_SOUND_MAX_SEC === 5 && m.WH_SOUND_PLAY_MAX <= m.WH_SOUND_MAX_SEC,
  '7) الخانات الأربعة بالترتيب · أقصى تشغيل ≤ أقصى تقطيع');

console.log('المعايرات');
{
  const x = await load(s => s.replace("  if(OUT_CODES[c]) return res.tone === 'warn' ? null : 'out';\n  if(IN_CODES[c]) return w.indexOf('no_return_signal') >= 0 ? null : 'in';\n  if(DUP_CODES[c]) return 'dup';\n  if(c === 'not_found') return 'unknown';\n  return null;",
    "  return ({ ok: 'out', in: 'in', dup: 'dup' })[res.tone] || (c === 'not_found' ? 'unknown' : null);"));
  ok(slotsOk(x).length > 0 && slotsOk(x).some(k => /^in_pre_warn/.test(k)), 'معايرة (أ) الخانة من النبرة → 1 وقع (' + slotsOk(x).join(' ') + ')');
}
{
  const x = await load(s => s.replace("  var c = res.code, w = Array.isArray(res.warnings) ? res.warnings : [];\n", "  var c = res.code, w = Array.isArray(res.warnings) ? res.warnings : [];\n  if(res.replay) return 'dup';\n"));
  ok(slotsOk(x).some(k => /^out_replay/.test(k)), 'معايرة (ب) replay = هبعتهولك → 1 وقع');
}
{
  const x = await load(s => s.replace("  if(IN_CODES[c]) return w.indexOf('no_return_signal') >= 0 ? null : 'in';", "  if(IN_CODES[c]) return 'in';"));
  ok(slotsOk(x).some(k => /^in_nosig/.test(k)), 'معايرة (ج) شيل no_return_signal → 1 وقع');
}
{
  const x = await load(s => s.replace("  if(slot === 'unknown') return true;\n", ''));
  ok(!!critOk(x), 'معايرة (د) السرينة مش حرجة → 2 وقع');
}
{
  const x = await load(s => s.replace('Math.round(s * 32768) : Math.round(s * 32767)', 'Math.round(s * 32767) : Math.round(s * 32767)'));
  ok(wavOk(x).vals !== '0,32767,-32768,16384,-16384', 'معايرة (هـ) −1 = −32767 → 5 وقع');
}
{
  const x = await load(s => s.replace('  var g = peak > 0.01 ? 0.95 / peak : 1;', '  var g = 1;'));
  ok(!trimOk(x).norm, 'معايرة (و) من غير تطبيع → 4 وقع');
}
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
