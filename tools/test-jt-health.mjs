// v62 (30 سبتمبر) — بلاغ 17309: «استثناء» وهو متسلّم عند J&T.
//
// جزئين في الواجهة (الحل الجذري نفسه على السيرفر: trace_sync كل 15 دقيقة):
//  (1) سجل الحالة المخلوط — 613 أوردر شكلهم `["[{…}]", {…}, {…}]` (نود n8n بتكتب
//      string والـSQL بيعمل append). parseStatusLog كانت بترجّع المصفوفة زي ما هي،
//      فالتايم لاين بيعمل Object.assign على النص → صف بلا `at` بيترتب الأول وبيكسر
//      سلسلة «من ← إلى» وتاريخ التأكيد بيختفي. الفيكستشر هنا **بشكل الحي بالحرف**
//      (درس 50) — اتقاس على 17309: أول عنصر string والباقي objects.
//  (2) بانر «مزامنة J&T واقفة» للأدمن من jt_sync_health — العمر من ساعة السيرفر.
//
// معايرات: (أ) parseStatusLog القديمة · (ب) العمر من ساعة الجهاز · (ج) شيل العتبة ·
//          (د) الإقفال (×) مابيعملش حاجة · (هـ) مشاكل الحسابات مش في شرط الظهور.
//  (3) 1 أكتوبر: «حسابات J&T محتاجة مراجعة» — تكلفة ماتقفلتش · مسح مش في الخريطة · COD مختلف.
//  (4) 10 أكتوبر: «سحب نسبة استلام العميل واقف» — rank_stale (شركة الشحن) · eo_stale (EasyOrders) — بيبان حتى لو
//      المتجر مش على J&T. معايرات: (و) شيل rate من شرط الظهور · (ز) المتجر مش على J&T بيخفيه.
//  (5) 11 أكتوبر: «رسايل المندوب في الطريق» (h.ofd من app.wa_ofd_health) — إيقاف بتجربة لوحدها/يدوي · آخر خطأ أحدث من آخر
//      نجاح حتى لو stale=0 · mode=off = ولا سطر · health_error = سطر · عنوان لوحده (مش تحت «سحب نسبة الاستلام»).
//      معايرات: (ح) سطر الخطأ مشروط بـstale>0 · (ط) سطور الرسايل متلزّقة في rate.
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const TABLE = new URL('../app/js/orders/table.js', import.meta.url);
const HEALTH = new URL('../app/js/orders/jt-health.js', import.meta.url);
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// شكل 17309 على الحي بالحرف: السجل القديم كله نص في أول عنصر
const FIX = `(function(){
  var o = window.__ORDERS.find(function(x){ return x.id === 'o1'; });
  o.status = 'Delivered'; o.shipping_carrier = 'jt';
  o.status_log = [
    JSON.stringify([{ from:'pending', to:'confirmed', at:'2026-09-23T16:01:08.774+02:00', by:'واتساب', reason:null }]),
    { from:'confirmed', to:'BOSTA AUTO', at:'2026-09-24T14:50:00Z', by:'J&T API · shekoz' },
    { from:'BOSTA AUTO', to:'Exception', at:'2026-09-27T15:55:37Z', by:'J&T API' },
    { from:'Exception', to:'Delivered', at:'2026-09-30T15:47:25Z', by:'J&T API · مصالحة' }
  ];
})();`;

const H_FRESH = { enabled: true, now: '2026-09-30T12:00:00Z', trace_last_ok: '2026-09-30T11:50:00Z', trace_last_run: '2026-09-30T11:50:00Z', trace_last_error: null };
const H_STALE = { enabled: true, now: '2026-09-30T12:00:00Z', trace_last_ok: '2026-09-30T09:00:00Z', trace_last_run: '2026-09-30T11:52:00Z', trace_last_error: 'jt 145003031: digest error' };

async function openApp(opts){
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  await p.addInitScript(STUB);
  await p.addInitScript(`window.__TENANT = { shipping_provider: 'jt' };` + FIX
    + `window.__HEALTH = ${JSON.stringify(opts.health === undefined ? H_FRESH : opts.health)};`
    + `window.__RPC_HOOK = function(n){ if(n === 'jt_sync_health') return { data: window.__HEALTH, error: null }; };`);
  for(const [url, file, patch] of [['**/js/orders/table.js', TABLE, opts.patchTable], ['**/js/orders/jt-health.js', HEALTH, opts.patchHealth]]){
    if(!patch) continue;
    const src = fs.readFileSync(file, 'utf8');
    const out = patch(src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة (درس 47)');
    await p.route(url, r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(URL_, { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-orders', { state: 'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  await p.waitForTimeout(250);
  return p;
}

async function timeline(p){
  await p.evaluate(() => document.querySelector('#tbody tr[data-id="o1"]').click());
  await p.waitForFunction(() => document.querySelector('#dcnt .log-list'), null, { timeout: 8000 });
  return p.evaluate(async () => {
    const { statusLabel } = await import('/js/core/constants.js');
    const items = [...document.querySelectorAll('#dcnt .log-list .log-item')].map(it => {
      const bs = it.querySelectorAll('.badge');
      return { from: bs[0] && bs[0].textContent.trim(), to: bs[1] && bs[1].textContent.trim(), by: (it.querySelector('.log-by') || {}).textContent || '' };
    });
    return { items, L: { pending: statusLabel('pending'), confirmed: statusLabel('confirmed'), auto: statusLabel('BOSTA AUTO'), exc: statusLabel('Exception'), del: statusLabel('Delivered') } };
  });
}
function chainOk(t){
  // المعروض الأحدث الأول: from كل صف = to الصف اللي تحته
  for(let i = 0; i + 1 < t.items.length; i++) if(t.items[i].from !== t.items[i + 1].to) return false;
  return true;
}
async function banner(p){
  return p.evaluate(() => {
    const el = document.getElementById('jt-sync-alert');
    const a = el && el.querySelector('.jt-sync-alert');
    if(!a || el.style.display === 'none') return null;
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { text: a.textContent.replace(/\s+/g, ' ').trim(), hit: !!(hit && a.contains(hit)) };
  });
}

console.log('── (1) سجل الحالة المخلوط');
{
  const p = await openApp({});
  const t = await timeline(p);
  ok(t.items.length === 4, `1) 4 صفوف في التايم لاين (${t.items.length})`);
  const oldest = t.items[t.items.length - 1];
  ok(oldest && oldest.to === t.L.confirmed && /واتساب/.test(oldest.by), `2) 🔴 التأكيد القديم (جوّه النص) ظاهر: «${oldest && oldest.from} ← ${oldest && oldest.to}» ${oldest && oldest.by.trim()}`);
  ok(chainOk(t), '3) 🔴 سلسلة «من ← إلى» متصلة: ' + t.items.map(x => x.from + '←' + x.to).join(' | '));
  ok(t.items[0].to === t.L.del && /مصالحة/.test(t.items[0].by), `4) الأحدث فوق = ${t.L.del} بـ«مصالحة» (${t.items[0].to} · ${t.items[0].by.trim()})`);
  ok(!t.items.some(x => !x.to || x.to === '—'), '5) مفيش صف «—» من غير حالة');
  const pure = await p.evaluate(async () => {
    const { parseStatusLog } = await import('/js/orders/table.js');
    return {
      whole: parseStatusLog(JSON.stringify([{ to: 'a' }, { to: 'b' }])).length,
      dbl: parseStatusLog(JSON.stringify(JSON.stringify([{ to: 'a' }]))).length,
      arr: parseStatusLog([{ to: 'a' }]).length,
      bare: parseStatusLog({ to: 'a' }).length,
      junk: parseStatusLog('مش JSON').length + parseStatusLog(null).length + parseStatusLog(['{bad']).length,
    };
  });
  ok(pure.whole === 2 && pure.dbl === 1 && pure.arr === 1, `6) الأشكال القديمة لسه شغالة: نص ${pure.whole} · نص مزدوج ${pure.dbl} · مصفوفة ${pure.arr}`);
  ok(pure.bare === 0 && pure.junk === 0, `7) object لوحده بره مصفوفة/زبالة = صفر (${pure.bare}/${pure.junk})`);
  await p.close();
}

console.log('── (2) بانر المزامنة');
{
  let p = await openApp({ health: H_FRESH });
  ok(!(await banner(p)), '8) مزامنة ماشية (من 10 دقايق) = مفيش بانر');
  await p.close();

  p = await openApp({ health: H_STALE });
  const s = await banner(p);
  ok(s && /واقفة/.test(s.text) && /من 3 ساعات/.test(s.text), '9) 🔴 واقفة من 3 ساعات = بانر بالعمر من ساعة السيرفر — ' + (s && s.text.slice(0, 70)));
  ok(s && /145003031/.test(s.text), '10) آخر خطأ ظاهر في البانر');
  ok(s && s.hit, '11) البانر مش مدفون (elementFromPoint — درس 31)');
  await p.click('#jsa-x');
  ok(!(await banner(p)), '12) × بيقفله (درس 9)');
  await p.close();

  p = await openApp({ health: null });
  ok(!(await banner(p)), '13) موظف (الـRPC بترجع null) = مفيش بانر');
  await p.close();
  p = await openApp({ health: Object.assign({}, H_STALE, { enabled: false }) });
  ok(!(await banner(p)), '14) متجر مش على J&T = مفيش بانر');
  await p.close();
  p = await openApp({ health: Object.assign({}, H_STALE, { trace_last_ok: null }) });
  const n = await banner(p);
  ok(n && /عمرها ما اشتغلت/.test(n.text), '15) عمر المزامنة ما نجحت = بانر «عمرها ما اشتغلت»');
  await p.close();
}

console.log('── (3) حسابات J&T محتاجة مراجعة (1 أكتوبر)');
{
  const H_ISS = Object.assign({}, H_FRESH, { fee_stuck: ['17309', 'W-22'], unmapped_48h: 2,
    cod_mismatch: [{ uid: '17260', total: 3328, jt: 3554, status: 'Delivered' }] });
  let p = await openApp({ health: H_ISS });
  const s = await banner(p);
  ok(s && /حسابات J&T محتاجة مراجعة/.test(s.text), '16) 🔴 مزامنة شغّالة بس فيه مشاكل حسابات = بانر «محتاجة مراجعة»');
  ok(s && !/مزامنة حالات J&T واقفة/.test(s.text), '17) المزامنة شغّالة = مفيش «واقفة» في البانر');
  ok(s && /17309، W-22/.test(s.text) && /2 مسح بنوع جديد/.test(s.text), '18) تكلفة شحن ماتقفلتش + مسح مش في الخريطة ظاهرين');
  ok(s && /17260/.test(s.text) && /3,554/.test(s.text) && /3,328/.test(s.text), '19) 🔴 اختلاف الـCOD بالأرقام التلاتة (الأوردر · J&T · عندنا)');
  await p.close();

  p = await openApp({ health: Object.assign({}, H_STALE, { cod_mismatch: [{ uid: '17399', total: 2845, jt: 2745 }] }) });
  const s2 = await banner(p);
  ok(s2 && /مزامنة حالات J&T واقفة/.test(s2.text) && /17399/.test(s2.text), '20) واقفة + مشكلة حسابات = الاتنين في نفس البانر');
  await p.close();

  // سطر «التحصيل عند J&T» في نافذة التفاصيل
  p = await openApp({ health: H_FRESH });
  await p.evaluate(() => { const o = window.__ORDERS.find((x) => x.id === 'o1'); o.jt_cod_amount = Number(o.total_cost || 0) + 226; });
  await p.evaluate(() => document.querySelector('#tbody tr[data-id="o1"]').click());
  await p.waitForFunction(() => document.querySelector('#dcnt .log-list'), null, { timeout: 8000 });
  const row = await p.evaluate(() => { const r = document.getElementById('jt-cod-row'); return r ? r.textContent : null; });
  ok(row && /226\.00/.test(row), '21) 🔴 COD عند J&T مختلف = سطر «التحصيل عند J&T» بالفرق (' + (row || 'مفيش').slice(0, 60) + ')');
  await p.close();
  p = await openApp({ health: H_FRESH });
  await p.evaluate(() => { const o = window.__ORDERS.find((x) => x.id === 'o1'); o.jt_cod_amount = Number(o.total_cost || 0); });
  await p.evaluate(() => document.querySelector('#tbody tr[data-id="o1"]').click());
  await p.waitForFunction(() => document.querySelector('#dcnt .log-list'), null, { timeout: 8000 });
  ok(await p.evaluate(() => !document.getElementById('jt-cod-row')), '22) COD مطابق = مفيش سطر (مايبقاش ضجيج على 220 أوردر سليم)');
  await p.close();
}

console.log('── (4) سحب نسبة استلام العميل واقف (10 أكتوبر)');
const H_RATE = Object.assign({}, H_FRESH, { rank_enabled: true, rank_stale: 4, rank_last_error: 'auth_401', eo_stale: 0 });
{
  let p = await openApp({ health: H_RATE });
  const s = await banner(p);
  ok(s && /سحب نسبة استلام العميل واقف/.test(s.text) && /4 أوردر ماتسألش/.test(s.text), '23) 🔴 rank_stale = بانر «سحب نسبة استلام العميل واقف» بالعدد — ' + (s && s.text.slice(0, 90)));
  ok(s && /auth_401/.test(s.text) && !/مزامنة حالات J&T واقفة/.test(s.text), '24) آخر خطأ السحب ظاهر · J&T شغّالة = مفيش «واقفة»');
  ok(s && !/بوسطة/.test(s.text), '25) اسم الشركة مش في النص (check_carrier_naming)');
  await p.close();

  p = await openApp({ health: Object.assign({}, H_FRESH, { rank_enabled: true, rank_stale: 0, eo_stale: 3 }) });
  const e = await banner(p);
  ok(e && /EasyOrders: 3 أوردر/.test(e.text) && !/شركة الشحن: /.test(e.text), '26) eo_stale = سطر EasyOrders لوحده');
  await p.close();

  p = await openApp({ health: Object.assign({}, H_RATE, { rank_enabled: false }) });
  ok(!(await banner(p)), '27) مفيش مفتاح لشركة الشحن (rank_enabled=false) = مفيش سطر ولا بانر');
  await p.close();

  p = await openApp({ health: Object.assign({}, H_RATE, { enabled: false }) });
  const n = await banner(p);
  ok(n && /سحب نسبة استلام العميل واقف/.test(n.text) && !/J&T/.test(n.text), '28) متجر مش على J&T والسحب واقف = البانر بسطر السحب بس');
  await p.close();

  p = await openApp({ health: Object.assign({}, H_FRESH, { rank_enabled: true, rank_stale: 0, eo_stale: 0 }) });
  ok(!(await banner(p)), '29) السحب ماشي (صفر) = مفيش بانر');
  await p.close();
}

console.log('── (5) رسايل «المندوب في الطريق» (11 أكتوبر)');
const OFD = (o) => Object.assign({}, H_FRESH, { ofd: Object.assign({ mode: 'on', stale: 0, overdue: 0, unparsed_24h: 0, cap_hit: false, max_per_day: 150 }, o) });
{
  let p = await openApp({ health: OFD({ paused: '132015 template paused', paused_until: '2026-10-10T15:00:00Z' }) });
  let s = await banner(p);
  ok(s && /رسايل «المندوب في الطريق» واقفة/.test(s.text) && /هتتجرّب تاني لوحدها/.test(s.text), '30) إيقاف 132015 = «هتتجرّب تاني لوحدها» — ' + (s && s.text.slice(0, 90)));
  ok(s && !/سحب نسبة استلام العميل واقف/.test(s.text) && /رسايل «المندوب في الطريق»/.test(s.text), '31) عنوان لوحده — مش تحت «سحب نسبة استلام العميل واقف»');
  await p.close();
  p = await openApp({ health: OFD({ paused: 'circuit_unknown' }) });
  s = await banner(p);
  ok(s && /اطلب من Claude/.test(s.text), '32) إيقاف يدوي (من غير paused_until) = «اطلب من Claude يشغّلها تاني»');
  await p.close();
  p = await openApp({ health: OFD({ last_error: 'claim_failed:57014', last_error_at: '2026-09-30T11:55:00Z', last_ok: '2026-09-30T11:40:00Z' }) });
  s = await banner(p);
  ok(s && /وقف بخطأ: claim_failed:57014/.test(s.text), '33) 🔴 آخر خطأ أحدث من آخر نجاح (stale=0) = سطر الخطأ — ' + (s && s.text.slice(0, 90)));
  await p.close();
  p = await openApp({ health: OFD({ mode: 'off', last_error: 'x', paused: 'y' }) });
  ok(!(await banner(p)), '34) mode=off = مفيش ولا سطر (الميزة مقفولة لحد موافقة ميتا)');
  await p.close();
  p = await openApp({ health: Object.assign({}, H_FRESH, { enabled: false, ofd: { health_error: '42P01' } }) });
  s = await banner(p);
  ok(s && /فحص رسايل «المندوب في الطريق» نفسه وقع/.test(s.text), '35) health_error = سطر «الفحص نفسه وقع» (حتى لو المتجر مش على J&T)');
  await p.close();
}

console.log('── المعايرات');
{
  const OLD = `export function parseStatusLog(val){
  if(!val) return [];
  if(Array.isArray(val)) return val;
  var v = val;
  for(var i=0;i<3;i++){ if(Array.isArray(v)) return v; if(typeof v !== 'string') return []; try{ v = JSON.parse(v); }catch(e){ return []; } }
  return Array.isArray(v) ? v : [];
}
function __unused_new(val){`;
  const p = await openApp({ patchTable: s => s.replace('export function parseStatusLog(val){', OLD) });
  const t = await timeline(p);
  const oldest = t.items[t.items.length - 1];
  ok(!(oldest && oldest.to === t.L.confirmed) || !chainOk(t), `معايرة أ: parseStatusLog القديمة كسرت التايم لاين — فحص 2/3 بيمسكها (${t.items.map(x => x.from + '←' + x.to).join(' | ')})`);
  await p.close();
}
{
  const p = await openApp({ health: H_FRESH, patchHealth: s => s.replace("var now = Date.parse(h.now || '');", 'var now = Date.now();') });
  ok(!!(await banner(p)), 'معايرة ب: العمر من ساعة الجهاز طلّع بانر كاذب — فحص 8 بيمسكها');
  await p.close();
}
{
  const p = await openApp({ health: H_FRESH, patchHealth: s => s.replace('var stale = min >= JT_SYNC_STALE_MIN;', 'var stale = min >= 0;') });
  ok(!!(await banner(p)), 'معايرة ج: من غير العتبة البانر بيطلع على دورة عادية — فحص 8 بيمسكها');
  await p.close();
}
{
  const p = await openApp({ health: H_STALE, patchHealth: s => s.replace('dismissed = true; renderJtSyncAlert(null);', '') });
  await p.click('#jsa-x');
  ok(!!(await banner(p)), 'معايرة د: × من غير فعل = البانر فاضل — فحص 12 بيمسكها');
  await p.close();
}

{
  const H_ISS = Object.assign({}, H_FRESH, { cod_mismatch: [{ uid: '17260', total: 3328, jt: 3554 }] });
  const p = await openApp({ health: H_ISS, patchHealth: s => s.replace('show: stale || issues.length > 0', 'show: stale') });
  ok(!(await banner(p)), 'معايرة هـ: من غير المشاكل في شرط الظهور، اختلاف الـCOD بيعدّي في صمت — فحص 16 بيمسكها');
  await p.close();
}

{
  const p = await openApp({ health: H_RATE, patchHealth: s => s.replace(' || rate.length > 0, stale: stale', ', stale: stale') });
  ok(!(await banner(p)), 'معايرة و: من غير السحب في شرط الظهور، الشارة بتختفي في صمت — فحص 23 بيمسكها');
  await p.close();
}
{
  const p = await openApp({ health: Object.assign({}, H_RATE, { enabled: false }), patchHealth: s => s.replace('  if(!h.enabled) return rateOnly;', "  if(!h.enabled) return { show: false };") });
  ok(!(await banner(p)), 'معايرة ز: متجر مش على J&T بيخفي تنبيه السحب — فحص 28 بيمسكها');
  await p.close();
}

{
  const p = await openApp({ health: OFD({ last_error: 'claim_failed:57014', last_error_at: '2026-09-30T11:55:00Z', last_ok: '2026-09-30T11:40:00Z' }),
    patchHealth: s => s.replace('  if(o.last_error && (', '  if(Number(o.stale||0) > 0 && o.last_error && (') });
  ok(!(await banner(p)), 'معايرة ح: سطر الخطأ مشروط بـstale>0 = الخطأ بيعدّي في صمت — فحص 33 بيمسكها');
  await p.close();
}
{
  const p = await openApp({ health: OFD({ paused: '132015 template paused', paused_until: '2026-10-10T15:00:00Z' }),
    patchHealth: s => s.replace('  var ofd = ofdIssues(h);', '  var ofd = []; rate = rate.concat(ofdIssues(h));') });
  const s = await banner(p);
  ok(s && /سحب نسبة استلام العميل واقف/.test(s.text), 'معايرة ط: سطور الرسايل تحت عنوان السحب — فحص 31 بيمسكها');
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
