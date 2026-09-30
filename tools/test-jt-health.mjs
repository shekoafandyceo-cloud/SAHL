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
//          (د) الإقفال (×) مابيعملش حاجة.
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
  const p = await openApp({ health: H_FRESH, patchHealth: s => s.replace('show: min >= JT_SYNC_STALE_MIN', 'show: min >= 0') });
  ok(!!(await banner(p)), 'معايرة ج: من غير العتبة البانر بيطلع على دورة عادية — فحص 8 بيمسكها');
  await p.close();
}
{
  const p = await openApp({ health: H_STALE, patchHealth: s => s.replace('dismissed = true; renderJtSyncAlert(null);', '') });
  await p.click('#jsa-x');
  ok(!!(await banner(p)), 'معايرة د: × من غير فعل = البانر فاضل — فحص 12 بيمسكها');
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
