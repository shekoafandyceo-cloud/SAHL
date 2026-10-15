// سكانر المخزن v78 (15 أكتوبر مساءً — طلب المالك): أصوات بالحالة + «📥 سجّل المنتج اللي رجع» لبوليصة J&T مش في سهل
//
// 1) الخانة من نوع النتيجة على الصفحة (sahl:wh-result + sahl:whsound): خروج = out (حتى لو المخزون بقى بالسالب) · مرتجع warn
//    «قبل التشغيل» = in **بنغمة «وصل»** مش «قرار» · اتضرب قبل كده = dup · مش في سهل = سرينة · «J&T ماقالتش» / خروج فيه منتج مش
//    مربوط = النغمة العادية — من غير مقاطع = النغمات القديمة
// 2) المقاطع من wh_config.sounds: بتتفك مرة وبتشتغل (src = clip) · المقطع اللي مااتفكّش = السرينة/النغمة (وعلامة ⚠️ للأدمن) ·
//    أطول من 5ث بيتقص
// 3) القناة: العادي بيقطع العادي (cut) · العادي بيستنى ورا السرينة ومابيقطعهاش · اتنين ورا السرينة = الأخير بس (replaced) ·
//    (المراجعة) «وقّف» بيقطع «مظبوط» الشغّال على طول (كان بيستنى) · «هبعتهولك» بيتسمع والطابور فيه حاجة · والعادي اللي بعده
//    مابيقطعهوش قبل ~1.2ث
// 4) الكتم على الجهاز بيكتم المقاطع · «▶️ اسمع» في الكارت بيشتغل حتى مع الكتم
// 5) «📥 سجّل المنتج اللي رجع» (موظف): الزرار على الكارت (hit-test) · العيلة بألوانها + «غير موزع» · المش نشط مش ظاهر ·
//    الضغطة على نفس المنتج = +1 · wh_unknown_in بالمنتجات والعدد · مشغول = النافذة فاضلة ونفس client_id · الكارت بعدها
//    «اتسجّل» + «وصل» · التراجع = wh_unknown_undo مش wh_scan_undo · الضربة التانية = «اتسجّلت قبل كده» + «📥 اتسجّل يدوي» ·
//    طرد تاني اتضرب والنافذة مفتوحة = بتتقفل · «محتاجة انتباهك» فيها «📥 سجّله» · Escape بيقفل
// 6) القايمة «📥 مرتجعات من غير أوردر» للأدمن بس (العدد = اللي مااتلغاش) · الصف فيه المنتجات والتراجع · الموظف مالوش القايمة ولا النداء
// 7) كارت «🔊 أصوات السكانر» (الأدمن — ⚙️ التشغيل): رفع ملف → المحرر بالموجة · أطول من 5ث = رسالة والحفظ مقفول · الحفظ =
//    رفع WAV أحادي 22050 بمسار <tenant>/wh-sounds/<slot>-<uuid>.wav + wh_sounds_set بالمدة · بعدها السكان بيشغّل المقطع ·
//    ↺ رجّع العادي = null · الرفع وقع = مفيش wh_sounds_set · ملف بايظ = رسالة · الموظف: الكارت فاضي
// 8) (المراجعة) نافذة التسجيل: دبل كليك على «📥 سجّل» = النافذة مفتوحة وفاضية · الزرار مابيتحركش تحت الصباع بعد الاختيار ·
//    bad_product = النافذة فاضلة + رسالة · الرد وصل بعد طرد تاني = الكارت بتاع الطرد التاني + toast · conflict مابيقولش «اتراجع»
// 9) (المراجعة) الكتابة بالإيد: 12 رقم مالقيناش = زرار «📥 دي بوليصة J&T مش في سهل؟» بيضرب JEG+الرقم · 5 أرقام = مفيش زرار
// 10) (المراجعة) جهاز السكانر المفتوح بيقرا الإعداد تاني كل 5 دقايق (المقطع الجديد بيوصله) · المقطع اللي وقع بيتجرّب تاني
// المعايرات (مرساة + حارس — درس 47 · المرساة المفقودة = فشل مش نجاح): الخانة null → 1 · الكتم متجاهَل → 4 · العادي بيقطع السرينة → 3 ·
// المقطع البايظ بيتشغّل → 2 · client_id جديد مع كل ضغطة → 5 · التراجع بـwh_scan_undo → 5 · النافذة مابتتقفلش → 5 · زرار الكارت
// اتشال → 5 · زرار الانتباه اتشال → 5 · القايمة للموظف → 6 · مسار من غير uuid → 7 · الحفظ مفتوح فوق 5ث → 7 · نغمة النتيجة بدل
// نغمة الخانة → 1 · الحرج بيستنى ورا العادي → 3 · «هبعتهولك» ساكت مع الطابور → 3 · من غير مهلة «هبعتهولك» → 3 · من غير حارس
// الفتح → 8 · رسم النافذة كلها مع الاختيار → 8 · bad_product بيقفل → 8 · الرد المتأخر فوق الكارت → 8 · من غير زرار الـ12 رقم → 9 ·
// من غير قراية الإعداد في التحديث الدوري → 10
// تشغيل:  python3 tools/spa-server.py 8899 app &   ثم   cd tools && node --import ./clock-preload.mjs test-wh-sound.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import { whEncodeWav } from '../app/js/warehouse/scan-sound.js';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';
const SRC = {
  wh: new URL('../app/js/warehouse/warehouse.js', import.meta.url),
  snd: new URL('../app/js/warehouse/wh-sounds.js', import.meta.url),
  unk: new URL('../app/js/warehouse/wh-unknown.js', import.meta.url)
};
const ROUTE = { wh: '**/js/warehouse/warehouse.js', snd: '**/js/warehouse/wh-sounds.js', unk: '**/js/warehouse/wh-unknown.js' };
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const NOW = () => new Date().toISOString();

function wavOf(sec, rate, f){
  const n = Math.round(sec * rate), s = new Float32Array(n);
  for(let i = 0; i < n; i++) s[i] = 0.4 * Math.sin(2 * Math.PI * f * i / rate);
  return Buffer.from(whEncodeWav(s, rate));
}
const CLIPS = { out: wavOf(1.2, 22050, 440), in: wavOf(1.0, 22050, 660), dup: wavOf(6, 22050, 330), unknown: Buffer.from('not a wav file at all') };
const P = (slot) => `t-test-1/wh-sounds/${slot}-11111111-1111-4111-8111-11111111111${'1234'.charAt(['out','in','dup','unknown'].indexOf(slot))}.wav`;
const SOUNDS = { out: { path: P('out'), name: 'مظبوط.mp3', dur: 1.2, by: 'shekoz' }, in: { path: P('in'), name: 'وصل.mp3', dur: 1 },
  dup: { path: P('dup'), name: 'هبعتهولك.mp3', dur: 6 }, unknown: { path: P('unknown'), name: 'سرينة.mp3', dur: 2 } };

const STOCK = `window.__STOCK = [
  { id:'p1', tenant_id:'t-test-1', name:'منظم المطبخ المتكامل', current_qty:10, active:true, parent_id:null },
  { id:'tr', tenant_id:'t-test-1', name:'ترولي 3 دور', current_qty:0, active:true, parent_id:null },
  { id:'tr1', tenant_id:'t-test-1', name:'ترولي 3 دور — أسود', current_qty:4, active:true, parent_id:'tr', variant_label:'أسود' },
  { id:'tr2', tenant_id:'t-test-1', name:'ترولي 3 دور — أبيض', current_qty:2, active:true, parent_id:'tr', variant_label:'أبيض' },
  { id:'old', tenant_id:'t-test-1', name:'منتج قديم', current_qty:5, active:false, parent_id:null }
];`;
const BOARD = { ok: true, enabled: true, baseline_at: NOW(), hold_cancel_requested: false, is_admin: true,
  counts: { not_scanned: 0, not_scanned_old: 0, pile: 0, pull: 0, leak: 0, leak_cancelled: 0, stale_pile: 0, courier: 0, courier_scanned: 0,
            closed_unscanned: 0, out_today: 0, in_today: 0, unmatched_lines: 0, negative_products: 0, in_delivered: 0 },
  lists: { not_scanned: [], pile: [], pull: [], leak: [], courier: [], closed_unscanned: [], in_delivered: [], today: [] },
  returns: { counts: { courier: 0, courier_done: 0, closed_today: 0, scanned_today: 0, missing: 0, missing_old: 0, transit: 0, n8n_only: 0 },
             courier: [], missing: [], scanned: [], transit: [] } };

const C = (n) => 'JEG0007000000' + String(n).padStart(2, '0');
const order = (n) => ({ id: 'o-' + n, uid: '182' + n, first_name: 'منى', status: 'BOSTA AUTO', tracking_no: C(n), pieces: 1, items: [{ text: 'منظم المطبخ المتكامل', qty: 1 }] });
// نتيجة wh_scan لكل كود (بأشكال السيرفر)
const RES = `window.__RES = {
  '${C(1)}': { ok:true, code:'out_ok', tone:'ok', dir:'out', applied:true, scan_id:501, order:${JSON.stringify(order(1))}, lines:[], warnings:[], options:[], dry:false },
  '${C(2)}': { ok:true, code:'in_ok_precount', tone:'warn', dir:'in', applied:true, scan_id:502, order:${JSON.stringify(order(2))}, lines:[], warnings:['unregistered_before_start'], options:[], dry:false },
  '${C(3)}': { ok:true, code:'already_out', tone:'dup', applied:false, scan_id:503, order:${JSON.stringify(order(3))}, prev:{ at:'${NOW()}', by:'ebrahim' }, dry:false },
  '${C(4)}': { ok:true, code:'not_found', tone:'stop', applied:false, scan_id:504, tracking_no:'${C(4)}', dry:false },
  '${C(5)}': { ok:true, code:'in_ok', tone:'warn', dir:'in', applied:true, scan_id:505, order:${JSON.stringify(order(5))}, lines:[], warnings:['no_return_signal'], options:[], dry:false },
  '${C(6)}': { ok:true, code:'out_ok', tone:'warn', dir:'out', applied:true, scan_id:506, order:${JSON.stringify(order(6))}, lines:[], warnings:['short'], options:[], dry:false },
  '${C(7)}': { ok:true, code:'not_found', tone:'stop', applied:false, scan_id:507, tracking_no:'${C(7)}', dry:false },
  '${C(8)}': { ok:true, code:'out_ok', tone:'ok', dir:'out', applied:true, scan_id:508, order:${JSON.stringify(order(8))}, lines:[], warnings:[], options:[], dry:false },
  '${C(9)}': { ok:true, code:'out_ok', tone:'warn', dir:'out', applied:true, scan_id:509, order:${JSON.stringify(order(9))}, lines:[], warnings:['unmatched'], options:[], dry:false },
  '${C(10)}': { ok:true, code:'blocked_cancelled', tone:'stop', applied:false, scan_id:510, order:${JSON.stringify(order(10))}, dry:false },
  '${C(11)}': { ok:true, code:'unknown_conflict', tone:'stop', applied:false, scan_id:511, tracking_no:'${C(11)}', prev:{ scan_id:700, at:'${NOW()}', by:'ebrahim' }, dry:false }
};`;
const HOOK = `
window.__WHC = []; window.__SND = []; window.__WHRES = [];
window.addEventListener('sahl:whsound', function(e){ window.__SND.push(Object.assign({ t: performance.now() }, e.detail)); });
window.addEventListener('sahl:wh-result', function(e){ window.__WHRES.push(e.detail); });
window.__RPC_HOOK = function(name, args){
  if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
  if(String(name).indexOf('wh_') !== 0) return null;
  window.__WHC.push({ name: name, args: JSON.parse(JSON.stringify(args || {})) });
  if(name === 'wh_board') return { data: window.__BOARD, error:null };
  var r = window.__WHR ? window.__WHR(name, args || {}) : null;
  if(r && typeof r.then === 'function') return r.then(function(d){ return { data: d, error:null }; });
  if(r) return { data: r, error:null };
  // رد بطيء لكود بعينه (الطابور فيه طرد تاني وقت ما النتيجة توصل) — __QLEN = طول الطابور لحظة الرد (قبل ما يتشال منه)
  if(name === 'wh_scan' && window.__SLOW && window.__SLOW === args.p_code){
    var d0 = window.__RES[args.p_code];
    return new Promise(function(res){ setTimeout(function(){ import('/js/warehouse/warehouse.js').then(function(m){
      window.__QLEN = m.whDebugState().queue.length; res({ data: d0, error:null }); }); }, 500); });
  }
  if(name === 'wh_scan') return { data: window.__RES[args.p_code] || { ok:true, code:'bad_code', tone:'stop' }, error:null };
  if(name === 'wh_unknown_list') return { data: { ok:true, rows: window.__UNK || [] }, error:null };
  return { data:{ ok:true, code:'ok' }, error:null };
};`;

async function open(opts){
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  p.on('dialog', d => d.dismiss());
  if(opts.role) await p.addInitScript(`window.__ROLE = '${opts.role}';`);
  if(opts.muted) await p.addInitScript(`try{ localStorage.setItem('sahl_wh_sound', '0'); }catch(e){}`);
  await p.addInitScript(STUB);
  await p.addInitScript(HOOK + STOCK + RES + `window.__BOARD = ${JSON.stringify(opts.board || BOARD)};`
    + (opts.clips ? `window.__WH_CONFIG = [{ tenant_id:'t-test-1', sounds:${JSON.stringify(SOUNDS)} }];
       window.__MEDIA = ${JSON.stringify(Object.fromEntries(Object.keys(SOUNDS).map(k => [SOUNDS[k].path, ORIGIN + '/__clip/' + k + '.wav'])))};` : '')
    + (opts.init || ''));
  await p.route('**/__clip/*', r => {
    const k = r.request().url().split('/').pop().replace('.wav', '');
    r.fulfill({ status: 200, contentType: 'audio/wav', body: CLIPS[k] || Buffer.from('') });
  });
  for(const k of Object.keys(opts.patch || {})){
    const src = fs.readFileSync(SRC[k], 'utf8');
    const out = opts.patch[k](src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة (درس 47): ' + k);
    await p.route(ROUTE[k], r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(ORIGIN + '/warehouse', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-warehouse', { state: 'visible', timeout: 10000 });
  await p.waitForFunction(() => document.querySelectorAll('#wh-chips .wh-chip').length > 0, null, { timeout: 8000 });
  if(opts.clips) await p.waitForFunction(() => import('/js/warehouse/wh-sounds.js').then(m => {
    const d = m.whSoundsDebug().bufs; return Object.keys(d).length === 4 && Object.values(d).every(v => v === 'ok' || v === 'fail');
  }), null, { timeout: 8000, polling: 200 });
  return p;
}
const calls = (p, name) => p.evaluate(n => (window.__WHC || []).filter(c => c.name === n), name);
async function scan(p, code){
  await p.evaluate((code) => {
    const t = () => document.activeElement || document.body;
    for(const ch of code.split('')){
      t().dispatchEvent(new KeyboardEvent('keydown', { code: /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch, key: ch, bubbles: true, cancelable: true }));
    }
    t().dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
  }, code);
}
const snd = (p) => p.evaluate(() => window.__SND.map(x => ({ slot: x.slot, src: x.src, tone: x.tone, reason: x.reason, sec: x.sec, t: Math.round(x.t) })));
const hit = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if(!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect(), x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!x && (x === el || el.contains(x));
}, sel);

// ── 1 · الخانات من غير مقاطع ──
async function slots(patch){
  const p = await open({ patch });
  await p.click('#wh-input');
  for(const n of [1, 2, 3, 4, 5, 6, 9]){ await scan(p, C(n)); await wait(n === 4 ? 2100 : 900); }
  const R = { res: await p.evaluate(() => window.__WHRES.map(x => x.slot === undefined ? 'u' : x.slot)), snd: await snd(p) };
  await p.context().close();
  return R;
}
const s1 = await slots();
const s1src = s1.snd.filter(x => x.src !== 'cut').map(x => (x.slot || '-') + ':' + x.src + (x.src === 'tone' ? ':' + x.tone : '')).join(' ');
const S1_RES = JSON.stringify(['out', 'in', 'dup', 'unknown', null, 'out', null]);
const S1_SRC = 'out:tone:ok in:tone:in dup:tone:dup unknown:siren -:tone:warn out:tone:ok -:tone:warn';
ok(JSON.stringify(s1.res) === S1_RES && s1src === S1_SRC && !s1.snd.some(x => x.src === 'cut'),
  '1) الخانة من نوع النتيجة: خروج (والمخزون بالسالب برضه) · مرتجع warn «قبل التشغيل» = in بنغمة «وصل» · اتضرب قبل كده = dup · مش في سهل = سرينة · «J&T ماقالتش» وخروج فيه مش مربوط = عادي · من غير مقاطع = النغمات (' + JSON.stringify(s1.res) + ' · ' + s1src + ')');

// ── 2 · المقاطع ──
async function clips(patch){
  const p = await open({ patch, clips: true });
  const R = { dbg: await p.evaluate(() => import('/js/warehouse/wh-sounds.js').then(m => m.whSoundsDebug().bufs)) };
  await p.click('#wh-input');
  for(const n of [1, 2, 3, 4]){ await scan(p, C(n)); await wait(n === 3 ? 5400 : n === 4 ? 2100 : 1500); }
  R.snd = await snd(p);
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('#wh-snd .wh-snd-row', { state: 'attached', timeout: 4000 });
  R.card = await p.evaluate(() => Array.from(document.querySelectorAll('#wh-snd .wh-snd-row')).map(r => r.getAttribute('data-slot') + '|' + r.querySelector('.wh-snd-cur').textContent));
  await p.context().close();
  return R;
}
const s2 = await clips();
const s2src = s2.snd.filter(x => x.src !== 'cut').map(x => (x.slot || '-') + ':' + x.src).join(' ');
const dupSec = (s2.snd.find(x => x.slot === 'dup' && x.src === 'clip') || {}).sec;
ok(s2.dbg[P('out')] === 'ok' && s2.dbg[P('unknown')] === 'fail' && s2src === 'out:clip in:clip dup:clip unknown:siren' && dupSec === 5
   && /مظبوط\.mp3/.test(s2.card[0] || '') && /⚠️ مقدرناش نشغّله/.test(s2.card[3] || '') && !/⚠️/.test(s2.card[0] || ''),
  '2) المقاطع: بتتفك وبتشتغل (out · in حتى لو النبرة warn · dup) · المقطع اللي مااتفكّش = السرينة + ⚠️ للأدمن · 6ث بيتقص لـ5 (' + s2src + ' · ' + dupSec + ' · ' + JSON.stringify(s2.dbg) + ')');

// ── 3 · القناة ──
async function channel(patch){
  const p = await open({ patch, clips: true });
  await p.click('#wh-input');
  // عادي بعد عادي = قطع
  await scan(p, C(1)); await wait(150); await scan(p, C(3)); await wait(5600);
  const a = await snd(p);
  await p.evaluate(() => { window.__SND.length = 0; });
  // سرينة (المقطع وقع = سرينة) وبعدها عادي = بيستنى · وتاني عادي = الأخير بس
  await scan(p, C(4)); await wait(150); await scan(p, C(1)); await wait(150); await scan(p, C(8)); await wait(3500);
  const c = await snd(p);
  // (المراجعة) «وقّف» بعد «مظبوط» بـ300ms = بيقطعه على طول (كان بيستنى لحد ما المقطع يخلص)
  await p.evaluate(() => { window.__SND.length = 0; window.__WHRES.length = 0; });
  await scan(p, C(1)); await wait(300); await scan(p, C(10)); await wait(2600);
  const d = await snd(p);
  const dRes = await p.evaluate(() => window.__WHRES.map(x => x.code));
  // (المراجعة) «هبعتهولك» والطابور فيه طرد = بيتسمع · والعادي اللي بعده بيستنى المهلة (~1.2ث) مش لحد آخر المقطع (5ث)
  await p.evaluate((c) => { window.__SND.length = 0; window.__SLOW = c; }, C(3));
  await scan(p, C(3)); await wait(80); await scan(p, C(8)); await wait(2600);
  const e = await snd(p);
  const q = await p.evaluate(() => window.__QLEN);
  await p.context().close();
  return { a, c, d, dRes, e, q };
}
const s3 = await channel();
const a3 = s3.a.map(x => (x.slot || '-') + ':' + x.src).join(' ');
const sir = s3.c.find(x => x.src === 'siren'), outAfter = s3.c.find(x => x.slot === 'out' && x.src === 'clip');
const d3o = s3.d.find(x => x.slot === 'out' && x.src === 'clip'), d3s = s3.d.find(x => x.slot === null && x.src === 'tone');
const d3 = s3.d.map(x => (x.slot || '-') + ':' + x.src).join(' ');
const e3d = s3.e.find(x => x.slot === 'dup' && x.src === 'clip'), e3o = s3.e.find(x => x.slot === 'out' && x.src === 'clip');
const e3 = s3.e.map(x => (x.slot || '-') + ':' + x.src + (x.reason ? ':' + x.reason : '')).join(' ');
const c3 = s3.c.map(x => (x.slot || '-') + ':' + x.src + (x.reason ? ':' + x.reason : '')).join(' ');
ok(a3 === 'out:clip out:cut dup:clip' && c3 === 'unknown:siren out:none:replaced out:clip' && !!sir && !!outAfter && outAfter.t - sir.t >= 1500,
  '3) القناة: العادي بيقطع العادي · العادي بيستنى السرينة (' + (outAfter && sir ? outAfter.t - sir.t : '?') + 'ms) ومابيقطعهاش · اتنين ورا السرينة = الأخير بس (' + a3 + ' | ' + c3 + ')');
ok(JSON.stringify(s3.dRes) === JSON.stringify(['out_ok', 'blocked_cancelled']) && d3 === 'out:clip out:cut -:tone' && !!d3o && !!d3s && d3s.t - d3o.t < 600,
  '3ب) «وقّف» بيقطع «مظبوط» الشغّال على طول (' + (d3o && d3s ? d3s.t - d3o.t : '?') + 'ms · ' + d3 + ')');
ok(s3.q >= 2 && !!e3d && !!e3o && e3o.t - e3d.t >= 1050 && e3o.t - e3d.t <= 2000 && e3.indexOf('dup:clip') >= 0 && e3.indexOf('dup:clip') < e3.indexOf('out:clip'),
  '3ج) «هبعتهولك» بيتسمع والطابور فيه طرد (' + s3.q + ') · «مظبوط» اللي بعده بيستنى المهلة مش آخر المقطع (' + (e3d && e3o ? e3o.t - e3d.t : '?') + 'ms · ' + e3 + ')');

// ── 4 · الكتم ──
async function mute(patch){
  const p = await open({ patch, clips: true, muted: true });
  await p.click('#wh-input');
  await scan(p, C(1)); await wait(400);
  const a = await snd(p);
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('#wh-snd [data-whs="play"][data-slot="out"]', { state: 'attached', timeout: 4000 });
  await p.evaluate(() => { window.__SND.length = 0; document.querySelector('#wh-snd details').open = true; });
  await p.click('#wh-snd [data-whs="play"][data-slot="out"]'); await wait(300);
  const c = await snd(p);
  await p.context().close();
  return { a, c };
}
const s4 = await mute();
ok(s4.a.length === 1 && s4.a[0].src === 'none' && s4.a[0].reason === 'muted' && s4.c.length === 1 && s4.c[0].src === 'clip',
  '4) الكتم على الجهاز بيكتم المقاطع · «▶️ اسمع» بيشتغل مع الكتم (' + JSON.stringify([s4.a, s4.c]) + ')');

// ── 5 · «📥 سجّل المنتج اللي رجع» (موظف) ──
const UNK_OK = (code) => `{ ok:true, code:'unknown_in', tone:'in', applied:true, dir:'in', scan_id:777, tracking_no:'${code}', warnings:[], dry:false, by:'ebrahim',
  lines:[{ text:'ترولي 3 دور — أسود', qty:2, dir:'in', state:'posted', matched_by:'manual', product_id:'tr1', product_name:'ترولي 3 دور — أسود', qty_after:6 }] }`;
async function unknown(patch){
  const p = await open({ patch, role: 'employee', init: `var __n = 0; window.__WHR = function(n, a){
    if(n === 'wh_unknown_in'){ __n++; if(__n === 1) return { ok:false, code:'busy', tone:'warn' }; return ${UNK_OK(C(4))}; }
    if(n === 'wh_unknown_undo') return { ok:true, code:'undone', tone:'warn', applied:true, scan_id:778 };
    if(n === 'wh_scan' && a.p_code === '${C(4)}' && window.__REG) return { ok:true, code:'unknown_already_in', tone:'dup', applied:false, scan_id:779, tracking_no:'${C(4)}',
      prev:{ scan_id:777, at:'${NOW()}', by:'ebrahim' }, lines:${UNK_OK(C(4))}.lines, dry:false };
    return null; };` });
  const R = {};
  await p.click('#wh-input');
  await scan(p, C(4)); await wait(300);
  R.btn = await hit(p, '#wh-result [data-wh-act="unk-open"]');
  R.unkList = (await calls(p, 'wh_unknown_list')).length;
  R.chip = await p.evaluate(() => !!document.querySelector('#wh-chips [data-wh-list="unknown"]'));
  await p.click('#wh-result [data-wh-act="unk-open"]');
  await p.waitForSelector('#wh-unk .wh-unk-p', { timeout: 4000 });
  await wait(500);   // حارس الفتح (الضغطة التانية من دبل كليك بتتطنّش أول 450ms)
  R.prods = await p.evaluate(() => ({
    fam: Array.from(document.querySelectorAll('#wh-unk .wh-unk-fam')).map(f => f.querySelector('.wh-unk-fam-h').textContent + ':' + Array.from(f.querySelectorAll('.wh-unk-p')).map(x => x.textContent).join('/')),
    all: Array.from(document.querySelectorAll('#wh-unk .wh-unk-p')).map(x => x.getAttribute('data-pid')).join(','),
    code: document.querySelector('#wh-unk .wh-unk-code').textContent }));
  R.saveDis = await p.evaluate(() => document.querySelector('#wh-unk [data-whu="save"]').disabled);
  await p.click('#wh-unk [data-whu="pick"][data-pid="tr1"]');
  await p.click('#wh-unk [data-whu="pick"][data-pid="tr1"]');
  await p.click('#wh-unk [data-whu="pick"][data-pid="p1"]');
  await p.click('#wh-unk [data-whu="rm"][data-i="1"]');
  R.sel = await p.evaluate(() => Array.from(document.querySelectorAll('#wh-unk .wh-unk-it')).map(x => x.querySelector('.wh-unk-it-n').textContent + '×' + x.querySelector('.wh-unk-q').textContent).join(','));
  R.saveHit = await hit(p, '#wh-unk [data-whu="save"]');
  await p.click('#wh-unk [data-whu="save"]'); await wait(300);
  R.afterBusy = await p.evaluate(() => !!document.getElementById('wh-unk'));
  await p.click('#wh-unk [data-whu="save"]'); await wait(400);
  const ins = await calls(p, 'wh_unknown_in');
  R.ins = ins.map(c => c.args);
  R.closed = await p.evaluate(() => !document.getElementById('wh-unk'));
  R.card = await p.evaluate(() => { const el = document.getElementById('wh-result'); const u = el.querySelector('[data-wh-act="undo"]');
    return { cls: el.className, t: el.querySelector('.wh-r-title').textContent, kind: u ? u.getAttribute('data-kind') : null, scan: u ? u.getAttribute('data-scan') : null }; });
  R.lastSlot = await p.evaluate(() => (window.__WHRES[window.__WHRES.length - 1] || {}).slot);
  // التراجع
  await p.click('#wh-result [data-wh-act="undo"]');
  await p.waitForSelector('#cmodal-backdrop[style*="flex"]', { timeout: 3000 });
  R.modal = await p.evaluate(() => document.getElementById('cmodal-title').textContent);
  await p.fill('#cmodal-input', 'اتسجّل بالغلط');
  await p.click('#cmodal-ok'); await wait(400);
  R.undo = { unk: (await calls(p, 'wh_unknown_undo')).map(c => c.args), scan: (await calls(p, 'wh_scan_undo')).length };
  // الضربة التانية بعد التسجيل
  await p.evaluate(() => { window.__REG = true; });
  await wait(3100);   // نفس الكود خلال 3ث = قراية مزدوجة من السكانر (بتتطنّش)
  await p.click('#wh-input');
  await scan(p, C(4)); await wait(400);
  R.again = await p.evaluate(() => { const el = document.getElementById('wh-result'); return { t: el.querySelector('.wh-r-title').textContent, prev: (el.querySelector('.wh-r-prev') || {}).textContent || '' }; });
  R.againSlot = await p.evaluate(() => (window.__WHRES[window.__WHRES.length - 1] || {}).slot);
  // نافذة مفتوحة + طرد تاني اتضرب = بتتقفل · «محتاجة انتباهك» فيها «📥 سجّله»
  await scan(p, C(7)); await wait(300);
  await p.click('#wh-result [data-wh-act="unk-open"]');
  await p.waitForSelector('#wh-unk', { timeout: 3000 });
  await wait(500);
  await p.click('#wh-unk [data-whu="pick"][data-pid="p1"]').catch(() => {});
  await scan(p, C(1)); await wait(400);
  R.closedOther = await p.evaluate(() => !document.getElementById('wh-unk'));
  R.toast = await p.evaluate(() => document.body.textContent.indexOf('نافذة التسجيل اتقفلت') >= 0);
  R.attnBtn = await p.evaluate((c) => { const x = document.querySelector('#wh-attn [data-wh-act="unk-open"]'); return x ? x.getAttribute('data-code') === c : false; }, C(7));
  if(R.attnBtn){
    await p.click('#wh-attn [data-wh-act="unk-open"]');
    await p.waitForSelector('#wh-unk', { timeout: 3000 });
    R.attnCode = await p.evaluate(() => document.querySelector('#wh-unk .wh-unk-code').textContent);
    await p.keyboard.press('Escape'); await wait(150);
    R.esc = await p.evaluate(() => !document.getElementById('wh-unk'));
  }
  await p.context().close();
  return R;
}
const s5 = await unknown();
const i5 = s5.ins || [];
ok(s5.btn && s5.unkList === 0 && !s5.chip && /JEG000700000004/.test(s5.prods.code || '') && s5.saveDis
   && s5.prods.fam.length === 1 && /^ترولي 3 دور:أسود\/أبيض\/\(اللون مش معروف — غير موزع\)$/.test(s5.prods.fam[0]) && !/old/.test(s5.prods.all)
   && s5.sel === 'ترولي 3 دور — أسود×2' && s5.saveHit && s5.afterBusy
   && i5.length === 2 && i5[0].p_client_id === i5[1].p_client_id && /^[0-9a-f-]{36}$/.test(i5[1].p_client_id) && i5[1].p_code === C(4)
   && JSON.stringify(i5[1].p_items) === JSON.stringify([{ product_id: 'tr1', qty: 2 }])
   && s5.closed && /tone-in/.test(s5.card.cls) && /المنتج اللي رجع اتسجّل/.test(s5.card.t) && s5.card.kind === 'unknown' && s5.card.scan === '777' && s5.lastSlot === 'in'
   && /تسجيل المنتج/.test(s5.modal) && s5.undo.unk.length === 1 && s5.undo.unk[0].p_scan_id === 777 && s5.undo.scan === 0
   && /اتسجّلت قبل كده/.test(s5.again.t) && /📥 اتسجّل يدوي/.test(s5.again.prev) && s5.againSlot === 'dup'
   && s5.closedOther && s5.toast && s5.attnBtn && /JEG000700000007/.test(s5.attnCode || '') && s5.esc,
  '5) «📥 سجّل المنتج اللي رجع» (موظف): الزرار ظاهر (hit-test) · العيلة بألوانها + «غير موزع» · المش نشط مش ظاهر · +1 بالضغطة · مشغول = النافذة فاضلة ونفس client_id · بعدها «اتسجّل» + «وصل» · التراجع wh_unknown_undo · الضربة التانية «اتسجّلت قبل كده» · طرد تاني = النافذة اتقفلت · «📥 سجّله» في الانتباه · Escape ('
    + JSON.stringify({ btn: s5.btn, fam: s5.prods.fam, sel: s5.sel, busy: s5.afterBusy, ins: i5.map(x => [x.p_client_id && x.p_client_id.slice(0, 8), JSON.stringify(x.p_items)]), card: s5.card, slot: s5.lastSlot, undo: s5.undo, again: s5.again, other: [s5.closedOther, s5.toast, s5.attnBtn, s5.esc] }) + ')');

// ── 6 · القايمة للأدمن ──
const UNK_ROWS = `window.__UNK = [
  { id:901, t:'JEG000799999901', at:'${NOW()}', by:'ebrahim', note:null, mine:false, reversed:false, reversed_by:null,
    lines:[{ product_name:'منظم المطبخ المتكامل', qty:2 }, { product_name:'ترولي <img src=x onerror="window.__XSS=1">', qty:1 }] },
  { id:900, t:'JEG000799999900', at:'${NOW()}', by:'shekoz', note:null, mine:true, reversed:true, reversed_by:'shekoz', lines:[{ product_name:'منظم', qty:1 }] }
];`;
async function adminList(patch, role){
  const p = await open({ patch, role, init: UNK_ROWS });
  await wait(500);
  const R = { calls: (await calls(p, 'wh_unknown_list')).map(c => c.args), chip: await p.evaluate(() => { const c = document.querySelector('#wh-chips [data-wh-list="unknown"]'); return c ? c.textContent : null; }) };
  if(R.chip){
    await p.click('#wh-chips [data-wh-list="unknown"]'); await wait(200);
    R.rows = await p.evaluate(() => Array.from(document.querySelectorAll('#wh-lists .wh-row')).map(r => ({ txt: r.textContent,
      undo: (r.querySelector('[data-wh-act="undo"]') || { getAttribute: () => null }).getAttribute('data-kind') })));
    R.xss = await p.evaluate(() => !!window.__XSS);
  }
  await p.context().close();
  return R;
}
const s6a = await adminList();
const s6e = await adminList(null, 'employee');
const r6 = s6a.rows || [];
ok(s6a.calls.length >= 1 && s6a.calls[0].p_days === 30 && /مرتجعات من غير أوردر/.test(s6a.chip || '') && /1/.test(s6a.chip || '') && !/2/.test(s6a.chip || '')
   && r6.length === 2 && /منظم المطبخ المتكامل ×2/.test(r6[0].txt) && /<img src=x/.test(r6[0].txt) && r6[0].undo === 'unknown' && /اتلغى/.test(r6[1].txt) && r6[1].undo === null && !s6a.xss
   && s6e.calls.length === 0 && s6e.chip === null,
  '6) «📥 مرتجعات من غير أوردر» للأدمن (العدد = اللي مااتلغاش) · المنتجات والتراجع بـdata-kind · XSS نص · الموظف مالوش القايمة ولا النداء (' + JSON.stringify({ a: s6a.chip, rows: r6.map(x => x.undo), e: [s6e.calls.length, s6e.chip] }) + ')');

// ── 7 · كارت الأصوات (الأدمن) ──
async function upload(patch, opt){
  opt = opt || {};
  const p = await open({ patch, role: opt.role, init: (opt.uploadFail ? '' : 'window.__UPLOAD_OK = true;')
    + `window.__WHR = function(n, a){ if(n === 'wh_sounds_set'){ var s = {}; Object.keys(a.p || {}).forEach(function(k){ if(a.p[k]) s[k] = Object.assign({ by:'أدمن' }, a.p[k]); }); window.__WH_CONFIG = [{ tenant_id:'t-test-1', sounds:s }]; return { ok:true, sounds:s }; } return null; };` });
  const R = {};
  if(opt.role === 'employee'){
    R.html = await p.evaluate(() => document.getElementById('wh-snd').innerHTML);
    await p.context().close();
    return R;
  }
  await p.click('.wh-tab[data-wh-tab="count"]');
  await p.waitForSelector('#wh-snd .wh-snd-row', { state: 'attached', timeout: 4000 });
  await p.evaluate(() => { document.querySelector('#wh-snd details').open = true; });
  R.rows = await p.evaluate(() => Array.from(document.querySelectorAll('#wh-snd .wh-snd-row')).map(r => r.getAttribute('data-slot')).join(','));
  const file = opt.badFile ? { name: 'x.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('garbage') } : { name: 'مظبوط.mp3', mimeType: 'audio/wav', buffer: wavOf(8, 44100, 500) };
  await p.setInputFiles('#wh-snd input.wh-snd-file[data-slot="out"]', file);
  if(opt.badFile){
    await wait(800);
    R.toast = await p.evaluate(() => document.body.textContent.indexOf('مش عارف يقرا الملف') >= 0);
    R.ed = await p.evaluate(() => !!document.querySelector('#wh-snd .wh-snd-ed'));
    await p.context().close();
    return R;
  }
  await p.waitForSelector('#wh-snd .wh-snd-ed canvas.wh-snd-wave', { timeout: 5000 });
  R.def = await p.evaluate(() => [document.querySelector('[data-whs="start"]').value, document.querySelector('[data-whs="end"]').value].join('-'));
  await p.fill('#wh-snd [data-whs="end"]', '6');
  R.long = await p.evaluate(() => ({ dis: document.querySelector('[data-whs="ed-save"]').disabled, err: document.querySelector('.wh-snd-err').textContent, hidden: document.querySelector('.wh-snd-err').hidden }));
  await p.fill('#wh-snd [data-whs="start"]', '1');
  await p.fill('#wh-snd [data-whs="end"]', '3');
  R.okDis = await p.evaluate(() => document.querySelector('[data-whs="ed-save"]').disabled);
  await p.click('#wh-snd [data-whs="ed-save"]'); await wait(700);
  R.up = await p.evaluate(async () => {
    const f = (window.__UPLOAD_FILES || []).slice(-1)[0]; if(!f) return null;
    const ab = await f.file.arrayBuffer(), v = new DataView(ab);
    return { path: f.path, ct: f.contentType, type: f.file.type, riff: String.fromCharCode.apply(null, new Uint8Array(ab, 0, 4)),
             ch: v.getUint16(22, true), rate: v.getUint32(24, true), bytes: ab.byteLength };
  });
  R.set = (await calls(p, 'wh_sounds_set')).map(c => c.args);
  R.cur = await p.evaluate(() => (document.querySelector('#wh-snd .wh-snd-row[data-slot="out"] .wh-snd-cur') || {}).textContent || '');
  R.edGone = await p.evaluate(() => !document.querySelector('#wh-snd .wh-snd-ed'));
  if(!opt.uploadFail){
    await p.click('.wh-tab[data-wh-tab="scan"]');
    await p.click('#wh-input');
    await p.evaluate(() => { window.__SND.length = 0; });
    await scan(p, C(1)); await wait(400);
    R.play = await snd(p);
    await p.click('.wh-tab[data-wh-tab="count"]');
    await p.evaluate(() => { document.querySelector('#wh-snd details').open = true; });
    await p.click('#wh-snd [data-whs="reset"][data-slot="out"]');
    await p.waitForSelector('#cmodal-backdrop[style*="flex"]', { timeout: 3000 });
    await p.click('#cmodal-ok'); await wait(400);
    R.reset = (await calls(p, 'wh_sounds_set')).map(c => c.args).slice(-1)[0];
    R.cur2 = await p.evaluate(() => (document.querySelector('#wh-snd .wh-snd-row[data-slot="out"] .wh-snd-cur') || {}).textContent || '');
  } else {
    R.toast = await p.evaluate(() => document.body.textContent.indexOf('مقدرناش نرفع') >= 0);
  }
  await p.context().close();
  return R;
}
const s7 = await upload();
const s7f = await upload(null, { uploadFail: true });
const s7b = await upload(null, { badFile: true });
const s7e = await upload(null, { role: 'employee' });
const u7 = s7.up || {}, set7 = (s7.set || [])[0] || {};
ok(s7.rows === 'out,in,dup,unknown' && s7.def === '0.0-2.5' && s7.long.dis && !s7.long.hidden && /أطول من 5 ثواني/.test(s7.long.err) && !s7.okDis
   && /^t-test-1\/wh-sounds\/out-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.wav$/.test(u7.path || '') && u7.ct === 'audio/wav' && u7.type === 'audio/wav'
   && u7.riff === 'RIFF' && u7.ch === 1 && u7.rate === 22050 && Math.abs(u7.bytes - (44 + 2 * 44100)) <= 4
   && set7.p && set7.p.out && set7.p.out.path === u7.path && set7.p.out.name === 'مظبوط.mp3' && set7.p.out.dur === 2
   && /مظبوط\.mp3/.test(s7.cur) && s7.edGone && (s7.play || []).length === 1 && s7.play[0].src === 'clip' && s7.play[0].slot === 'out'
   && s7.reset && s7.reset.p && s7.reset.p.out === null && /النغمة العادية/.test(s7.cur2)
   && s7f.set.length === 0 && s7f.toast && s7b.toast && !s7b.ed && s7e.html === '',
  '7) كارت الأصوات: المحرر بالموجة · 5ث+ = رسالة والحفظ مقفول · WAV أحادي 22050 بمسار <tenant>/wh-sounds/out-<uuid>.wav · wh_sounds_set بالمدة · السكان بيشغّل المقطع · ↺ = null · الرفع وقع = مفيش حفظ · ملف بايظ = رسالة · الموظف فاضي ('
    + JSON.stringify({ def: s7.def, long: s7.long, up: u7, set: set7, play: s7.play, reset: s7.reset, fail: [s7f.set.length, s7f.toast], badf: [s7b.toast, s7b.ed], emp: s7e.html }) + ')');


// ── 8 · نافذة التسجيل (المراجعة) ──
async function unknown2(patch){
  const p = await open({ patch, role: 'employee', init: `var __n = 0; window.__WHR = function(n, a){
    if(n === 'wh_unknown_in'){ __n++; if(__n === 1) return { ok:false, code:'bad_product', tone:'stop' };
      return new Promise(function(r){ setTimeout(function(){ r(${UNK_OK(C(4))}); }, 900); }); }
    return null; };` });
  const R = {};
  await p.click('#wh-input');
  await scan(p, C(4)); await wait(300);
  await p.dblclick('#wh-result [data-wh-act="unk-open"]');
  await p.waitForSelector('#wh-unk .wh-unk-p', { timeout: 4000 }).catch(() => {});
  await wait(700);
  R.dbl = await p.evaluate(() => ({ open: !!document.getElementById('wh-unk'), items: document.querySelectorAll('#wh-unk .wh-unk-it').length }));
  if(!R.dbl.open){ await p.click('#wh-result [data-wh-act="unk-open"]'); await p.waitForSelector('#wh-unk .wh-unk-p', { timeout: 4000 }); await wait(500); }
  const rect = () => p.evaluate(() => { const r = document.querySelector('#wh-unk [data-whu="pick"][data-pid="tr1"]').getBoundingClientRect(); return Math.round(r.top) + ',' + Math.round(r.left); });
  const r0 = await rect();
  await p.click('#wh-unk [data-whu="pick"][data-pid="p1"]');
  const r1 = await rect();
  await p.click('#wh-unk [data-whu="pick"][data-pid="tr1"]');
  const r2 = await rect();
  R.pos = [r0, r1, r2];
  R.sel = await p.evaluate(() => Array.from(document.querySelectorAll('#wh-unk .wh-unk-it')).map(x => x.querySelector('.wh-unk-it-n').textContent + '×' + x.querySelector('.wh-unk-q').textContent).join(','));
  R.on = await p.evaluate(() => Array.from(document.querySelectorAll('#wh-unk .wh-unk-p.on')).map(x => x.getAttribute('data-pid')).sort().join(','));
  // bad_product = النافذة فاضلة + رسالة
  await p.click('#wh-unk [data-whu="save"]'); await wait(500);
  R.bad = await p.evaluate(() => ({ open: !!document.getElementById('wh-unk'), toast: document.body.textContent.indexOf('اتشال من المخزون') >= 0,
    cls: document.getElementById('wh-result').getAttribute('data-code') }));
  if(!R.bad.open){ R.stale = {}; R.log = []; R.conf = ''; await p.context().close(); return R; }   // المعايرة (ق) — مفيش نافذة نكمّل عليها
  // الرد متأخر وطرد تاني اتضرب = الكارت بتاع الطرد التاني
  await p.click('#wh-unk [data-whu="save"]'); await wait(150);
  R.busyOpen = await p.evaluate(() => !!document.getElementById('wh-unk'));
  await p.keyboard.press('Escape');   // مشغول = Escape مابيقفلش
  await p.evaluate(() => { const b = document.getElementById('wh-unk'); if(b) b.remove(); document.getElementById('wh-input').focus(); });
  await scan(p, C(1)); await wait(1400);
  R.stale = await p.evaluate(() => ({ card: document.getElementById('wh-result').getAttribute('data-code'),
    toast: document.body.textContent.indexOf('اتم — النتيجة في') >= 0 }));
  R.log = await p.evaluate(() => import('/js/warehouse/warehouse.js').then(m => m.whDebugState().log.map(x => (x.res || {}).code)));
  // conflict: مابيقولش «اتراجع»
  await scan(p, C(11)); await wait(400);
  R.conf = await p.evaluate(() => document.getElementById('wh-result').textContent);
  await p.context().close();
  return R;
}
const s8 = await unknown2();
ok(s8.dbl.open && s8.dbl.items === 0 && s8.pos[0] === s8.pos[1] && s8.pos[1] === s8.pos[2]
   && s8.sel === 'منظم المطبخ المتكامل×1,ترولي 3 دور — أسود×1' && s8.on === 'p1,tr1'
   && s8.bad.open && s8.bad.toast && s8.bad.cls === 'not_found' && s8.busyOpen
   && s8.stale.card === 'out_ok' && s8.stale.toast && s8.log.indexOf('unknown_in') >= 0
   && /متتراجعش/.test(s8.conf) && !/يتراجع عن التسجيل/.test(s8.conf),
  '8) النافذة: دبل كليك = مفتوحة وفاضية · الزرار مابيتحركش بعد الاختيار (' + s8.pos.join(' | ') + ') · bad_product = فاضلة + رسالة · الرد المتأخر = الكارت للطرد التاني + toast · conflict «متتراجعش» ('
    + JSON.stringify({ dbl: s8.dbl, sel: s8.sel, on: s8.on, bad: s8.bad, stale: s8.stale, log: s8.log }) + ')');

// ── 9 · الكتابة بالإيد: 12 رقم ──
async function typed(patch){
  const p = await open({ patch, role: 'employee', init: `window.__WHR = function(n, a){ if(n === 'wh_lookup') return { ok:true, rows:[] }; return null; };` });
  const R = {};
  const typeIn = async (q) => { await p.fill('#wh-input', q); await p.press('#wh-input', 'Enter'); await wait(400); };
  await typeIn('000700000004');
  R.lk = (await calls(p, 'wh_lookup')).map(c => c.args.p_q);
  R.btn = await p.evaluate(() => { const x = document.querySelector('#wh-result [data-wh-act="pick"]'); return x ? x.getAttribute('data-code') : null; });
  R.hint = await p.evaluate(() => document.getElementById('wh-result').textContent.indexOf('الـ12 رقم') >= 0);
  R.scans0 = (await calls(p, 'wh_scan')).length;
  if(R.btn){ await p.click('#wh-result [data-wh-act="pick"]'); await wait(400); }
  R.scan = (await calls(p, 'wh_scan')).map(c => c.args.p_code);
  R.card = await p.evaluate(() => document.getElementById('wh-result').getAttribute('data-code'));
  await typeIn('12345');
  R.btn5 = await p.evaluate(() => !!document.querySelector('#wh-result [data-wh-act="pick"]'));
  await p.context().close();
  return R;
}
const s9 = await typed();
ok(JSON.stringify(s9.lk.slice(0, 1)) === JSON.stringify(['000700000004']) && s9.btn === C(4) && s9.hint && s9.scans0 === 0
   && JSON.stringify(s9.scan) === JSON.stringify([C(4)]) && s9.card === 'not_found' && !s9.btn5,
  '9) 12 رقم مالقيناش = زرار صريح بيضرب JEG+الرقم (مش أوتوماتيك) → سرينة · 5 أرقام = مفيش زرار (' + JSON.stringify(s9) + ')');

// ── 10 · الإعداد بيتقري تاني والصفحة مفتوحة (المقطع الجديد + اللي وقع) ──
const FAST = { wh: s => s.replace('var WH_BOARD_MS = 30000;', 'var WH_BOARD_MS = 800;'),
               snd: s => s.replace('var CFG_MS = 5 * 60000,', 'var CFG_MS = 1500,') };
async function refresh(patch){
  const pt = { wh: (s) => (patch && patch.wh ? patch.wh(FAST.wh(s)) : FAST.wh(s)), snd: (s) => (patch && patch.snd ? patch.snd(FAST.snd(s)) : FAST.snd(s)) };
  const p = await open({ patch: pt, clips: true });
  const R = { before: await p.evaluate(() => import('/js/warehouse/wh-sounds.js').then(m => m.whSoundsDebug().bufs)) };
  const NEWP = 't-test-1/wh-sounds/out-22222222-2222-4222-8222-222222222222.wav';
  CLIPS.unknown = wavOf(1.5, 22050, 880);   // الملف بقى سليم (الجهاز لازم يجرّبه تاني)
  await p.evaluate(({ NEWP, ORIGIN }) => {
    const s = JSON.parse(JSON.stringify(window.__WH_CONFIG[0].sounds));
    s.out = { path: NEWP, name: 'مظبوط-جديد.mp3', dur: 1 };
    window.__WH_CONFIG = [{ tenant_id: 't-test-1', sounds: s }];
    window.__MEDIA[NEWP] = ORIGIN + '/__clip/in.wav';
  }, { NEWP, ORIGIN });
  await wait(4500);
  R.after = await p.evaluate(() => import('/js/warehouse/wh-sounds.js').then(m => { const d = m.whSoundsDebug(); return { bufs: d.bufs, out: (d.cfg.out || {}).path }; }));
  R.NEWP = NEWP;
  CLIPS.unknown = Buffer.from('not a wav file at all');
  await p.context().close();
  return R;
}
const s10 = await refresh();
ok(s10.before[P('unknown')] === 'fail' && s10.after.out === s10.NEWP && s10.after.bufs[s10.NEWP] === 'ok' && s10.after.bufs[P('unknown')] === 'ok',
  '10) جهاز مفتوح: المقطع الجديد بيوصله من غير ريفريش · المقطع اللي وقع بيتجرّب تاني (' + JSON.stringify(s10) + ')');

// ── المعايرات ─────────────────────────────────────────────────────────
console.log('المعايرات');
// 🔴 المرساة المفقودة = المعايرة وقعت (كانت `r.err ||` بتعدّيها — درس 47): أي خطأ تاني (timeout …) = الفحص اتكسر = عدّى
const cal = (r, cond, msg) => {
  const anchorMiss = /المرساة/.test((r && r.err) || '');
  let hit = false;
  try{ hit = !!((r && r.err) || cond()); }catch(e){ hit = true; }   // الفحص نفسه اتكسر = المعايرة وصلت
  ok(!anchorMiss && hit, msg + (anchorMiss ? ' ⚠ ' + r.err : ''));
};
{
  const r = await slots({ wh: s => s.replace('  var tone = whTone(res), slot = whSoundSlot(res);', '  var tone = whTone(res), slot = null;') }).catch(e => ({ err: String(e) }));
  cal(r, () => JSON.stringify(r.res) !== S1_RES, 'معايرة (أ) الخانة null → 1 وقع');
}
{
  const r = await mute({ snd: s => s.replace("  if(!item.force && !scanSoundOn()){", "  if(false){") }).catch(e => ({ err: String(e) }));
  cal(r, () => !(r.a.length === 1 && r.a[0].reason === 'muted'), 'معايرة (ب) الكتم متجاهَل → 4 وقع');
}
{
  const r = await channel({ snd: s => s.replace("    } else if(ch.cur.crit || ch.q.length){ setPend(item); return; }", "    } else if(ch.q.length){ setPend(item); return; }") }).catch(e => ({ err: String(e) }));
  cal(r, () => r.c.some(x => x.src === 'cut'), 'معايرة (ج) العادي بيقطع السرينة → 3 وقع');
}
{
  const r = await clips({ snd: s => s.replace("  return b && typeof b === 'object' ? b : null;", "  return b || null;") }).catch(e => ({ err: String(e) }));
  cal(r, () => !r.snd.some(x => x.slot === 'unknown' && x.src === 'siren'), 'معايرة (د) المقطع البايظ بيتشغّل بدل السرينة → 2 وقع');
}
{
  const r = await unknown({ unk: s => s.replace('p_client_id: s.cid,', 'p_client_id: uuid(),') }).catch(e => ({ err: String(e) }));
  cal(r, () => !(r.ins && r.ins.length === 2 && r.ins[0].p_client_id === r.ins[1].p_client_id), 'معايرة (هـ) client_id جديد مع كل ضغطة → 5 وقع');
}
{
  const r = await unknown({ wh: s => s.replace("sb.rpc(unk ? 'wh_unknown_undo' : 'wh_scan_undo',", "sb.rpc('wh_scan_undo',") }).catch(e => ({ err: String(e) }));
  cal(r, () => !(r.undo && r.undo.unk.length === 1 && r.undo.scan === 0), 'معايرة (و) التراجع بـwh_scan_undo → 5 وقع');
}
{
  const r = await unknown({ wh: s => s.replace("  if(it.cid !== 'unk' && whUnknownCloseIfOther(pc))", "  if(false)") }).catch(e => ({ err: String(e) }));
  cal(r, () => !r.closedOther, 'معايرة (ز) النافذة مابتتقفلش مع طرد تاني → 5 وقع');
}
{
  const r = await unknown({ wh: s => s.replace("  if(res.code === 'not_found' && res.tracking_no){\n    acts +=", "  if(false){\n    acts +=") }).catch(e => ({ err: String(e) }));
  cal(r, () => !r.btn, 'معايرة (ح) زرار الكارت اتشال → 5 وقع');
}
{
  const r = await unknown({ wh: s => s.replace("      + (r.code === 'not_found' && r.tracking_no ? '<button", "      + (false ? '<button") }).catch(e => ({ err: String(e) }));
  cal(r, () => !r.attnBtn, 'معايرة (ط) زرار «محتاجة انتباهك» اتشال → 5 وقع');
}
{
  const r = await adminList({ wh: s => s.replace("return (whUnk || []).filter(function(x){ return !x.reversed; }).length; }, admin: true }", "return (whUnk || []).filter(function(x){ return !x.reversed; }).length; } }") }, 'employee').catch(e => ({ err: String(e) }));
  cal(r, () => r.chip !== null, 'معايرة (ي) القايمة للموظف → 6 وقع');
}
{
  const r = await upload({ snd: s => s.replace("var path = currentTenantId + '/wh-sounds/' + slot + '-' + uuid() + '.wav';", "var path = currentTenantId + '/wh-sounds/' + slot + '.wav';") }).catch(e => ({ err: String(e) }));
  cal(r, () => !/-[0-9a-f]{8}-/.test((r.up || {}).path || ''), 'معايرة (ك) مسار من غير uuid → 7 وقع');
}
{
  const r = await upload({ snd: s => s.replace("  if(sv){ sv.disabled = !!(chk || ed.busy);", "  if(sv){ sv.disabled = !!ed.busy;") }).catch(e => ({ err: String(e) }));
  cal(r, () => !r.long.dis, 'معايرة (ل) الحفظ مفتوح فوق 5ث → 7 وقع');
}
{
  const r = await slots({ snd: s => s.replace("  var tn = (slot && !clip && DEF_TONE[slot]) || tone || 'stop';", "  var tn = tone || 'stop';") }).catch(e => ({ err: String(e) }));
  const src = r.snd ? r.snd.filter(x => x.src !== 'cut').map(x => (x.slot || '-') + ':' + x.src + (x.src === 'tone' ? ':' + x.tone : '')).join(' ') : '';
  cal(r, () => src !== S1_SRC, 'معايرة (م) نغمة النتيجة بدل نغمة الخانة («وصل» بقت «قرار») → 1 وقع');
}
{
  const r = await channel({ snd: s => s.replace("    if(item.crit){\n      if(ch.cur.crit){ ch.q.push(item); return; }\n      stopCur();\n    }", "    if(item.crit){ ch.q.push(item); return; }") }).catch(e => ({ err: String(e) }));
  cal(r, () => { const o = r.d.find(x => x.slot === 'out' && x.src === 'clip'), t = r.d.find(x => x.slot === null && x.src === 'tone'); return !(o && t && t.t - o.t < 600); }, 'معايرة (ن) الحرج بيستنى ورا «مظبوط» → 3ب وقع');
}
{
  const r = await channel({ wh: s => s.replace(" || !whQueue.length || slot === 'dup') whSound(slot, tone);", " || !whQueue.length) whSound(slot, tone);") }).catch(e => ({ err: String(e) }));
  cal(r, () => !r.e.some(x => x.slot === 'dup' && x.src === 'clip'), 'معايرة (س) «هبعتهولك» ساكت والطابور فيه طرد → 3ج وقع');
}
{
  const r = await channel({ snd: s => s.replace("    else if(ch.cur.slot === 'dup' && Date.now() - ch.cur.at < DUP_HOLD_MS){", "    else if(false){") }).catch(e => ({ err: String(e) }));
  cal(r, () => { const d = r.e.find(x => x.slot === 'dup' && x.src === 'clip'), o = r.e.find(x => x.slot === 'out' && x.src === 'clip'); return !(d && o && o.t - d.t >= 1050); }, 'معايرة (ع) «مظبوط» بيقطع «هبعتهولك» على طول → 3ج وقع');
}
{
  // الحارسين مع بعض: وقت الفتح + الضغطة المكررة (detail > 1) — أي واحد فيهم لوحده بيمسك الدبل كليك
  const r = await unknown2({ unk: s => s.replace("  if(Date.now() - (st.openedAt || 0) < OPEN_GUARD_MS) return;", "").replace("  if(e.detail > 1 && a !== 'inc' && a !== 'dec') return;", "") }).catch(e => ({ err: String(e) }));
  cal(r, () => !(r.dbl.open && r.dbl.items === 0), 'معايرة (ف) من غير حارس الفتح والضغطة المكررة (دبل كليك) → 8 وقع');
}
{
  const r = await unknown2({ unk: s => s.replace("  else if(a === 'save'){ save(); return; }\n  renderSel();", "  else if(a === 'save'){ save(); return; }\n  render();")
    .replace("    + '<div class=\"wh-unk-list\">' + prodButtons() + '</div>'\n    + '<div class=\"wh-unk-sel\">' + selHtml() + '</div>'", "    + '<div class=\"wh-unk-sel\">' + selHtml() + '</div>'\n    + '<div class=\"wh-unk-list\">' + prodButtons() + '</div>'") }).catch(e => ({ err: String(e) }));
  cal(r, () => r.pos[0] !== r.pos[1] || r.pos[1] !== r.pos[2], 'معايرة (ص) الاختيار فوق القايمة والرسم كامل → 8 وقع');
}
{
  const r = await unknown2({ unk: s => s.replace("    if(KEEP_OPEN[res.code]){", "    if(false){") }).catch(e => ({ err: String(e) }));
  cal(r, () => !r.bad.open, 'معايرة (ق) bad_product بيقفل النافذة → 8 وقع');
}
{
  const r = await unknown2({ wh: s => s.replace("    if((whCard && whCard.code && whCard.code !== code) || whQueue.length){", "    if(false){") }).catch(e => ({ err: String(e) }));
  cal(r, () => r.stale.card !== 'out_ok', 'معايرة (ر) الرد المتأخر فوق كارت الطرد التاني → 8 وقع');
}
{
  const r = await typed({ wh: s => s.replace("      var full = /^\\d{12}$/.test(String(q)) ? 'JEG' + q : '';", "      var full = '';") }).catch(e => ({ err: String(e) }));
  cal(r, () => r.btn !== C(4), 'معايرة (ش) من غير زرار الـ12 رقم → 9 وقع');
}
{
  const r = await refresh({ wh: s => s.replace("    if(whPageVisible()) whLoadSounds(false);\n", "") }).catch(e => ({ err: String(e) }));
  cal(r, () => r.after.out !== r.NEWP, 'معايرة (ت) من غير قراية الإعداد في التحديث الدوري → 10 وقع');
}
{
  const r = await refresh({ snd: s => s.replace("    Object.keys(bufs).forEach(function(p){ if(bufs[p] === 'fail') delete bufs[p]; });", "    if(force) Object.keys(bufs).forEach(function(p){ if(bufs[p] === 'fail') delete bufs[p]; });") }).catch(e => ({ err: String(e) }));
  cal(r, () => r.after.bufs[P('unknown')] !== 'ok', 'معايرة (ث) المقطع اللي وقع مابيتجرّبش تاني → 10 وقع');
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كله عدّى');
process.exit(bad ? 1 : 0);
