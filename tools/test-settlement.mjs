// التسويات + جهة الموظف + شارة الـupsell.
//
// النطاق: الواجهة. حراسات السيرفر (نطاق المتجر · مبلغ سالب · التزوير)
// اتجرّبت على الداتابيز نفسها — 10 حالات بترانزاكشن راجعة و10 على الحالة
// الحية بعد التطبيق (UPDATE/DELETE مباشر = صفر صف).
//
// اللي بيتأكد هنا: الأرقام اللي التاجر والموظف بيشوفوها **مطابقة للفيو**،
// والرصيد السالب بيتعرض «عليه X» مش صفر، والتسوية بتيجي بالمبلغ مكتوب
// سلفاً (طلب المالك)، والشارة 🔼 بتظهر على الأوردر الصح.
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

const DATA = `
  window.__RPC = [];
  window.__CM_EVENTS = [
    { id:'e1', order_id:'o1', user_id:'u2', user_name:'سارة', before_total:500, after_total:800,
      delta:300, commission_type:'percent', commission_rate:10, commission_amount:30,
      status:'earned', resolved_at:null, created_at:'2026-08-04T10:00:00Z' },
    { id:'e2', order_id:'o2', user_id:'u2', user_name:'سارة', before_total:600, after_total:900,
      delta:300, commission_type:'percent', commission_rate:10, commission_amount:30,
      status:'pending', resolved_at:null, created_at:'2026-08-05T10:00:00Z' },
    { id:'e3', order_id:'o3', user_id:'u3', user_name:'عمر', before_total:400, after_total:1200,
      delta:800, commission_type:'fixed', commission_rate:25, commission_amount:25,
      status:'void', resolved_at:null, created_at:'2026-08-03T10:00:00Z' }
  ];
  window.__CM_SETTLE = [
    { id:'s1', user_id:'u2', user_name:'سارة', amount:20, kind:'settlement', reverses_id:null,
      note:'دفعة أولى', created_by_name:'المدير', created_at:'2026-08-05T12:00:00Z' },
    { id:'s2', user_id:'u3', user_name:'عمر', amount:50, kind:'settlement', reverses_id:null,
      note:null, created_by_name:'المدير', created_at:'2026-08-04T12:00:00Z' }
  ];
  // سارة: مستحق 30 − متصرّف 20 = 10 · عمر: مستحق 0 − متصرّف 50 = −50 (عليه)
  window.__CM_BAL = [
    { user_id:'u2', user_name:'سارة', events_count:2, pending_total:30, earned_total:30,
      void_total:0,  settled_total:20, settlements_count:1, outstanding:10 },
    { user_id:'u3', user_name:'عمر',  events_count:1, pending_total:0,  earned_total:0,
      void_total:25, settled_total:50, settlements_count:1, outstanding:-50 }
  ];
`;

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(STUB);
await p.addInitScript(DATA);
await p.addInitScript(`
  (function(){
    var mk = window.supabase.createClient;
    window.supabase.createClient = function(){
      var c = mk.apply(this, arguments), orig = c.rpc.bind(c);
      c.rpc = function(name, args){
        window.__RPC.push({ name: name, args: args });
        if(name === 'settle_commission' || name === 'reverse_settlement'){
          return Promise.resolve({ data:{ ok:true }, error:null });
        }
        return orig(name, args);
      };
      return c;
    };
  })();
`);
// أوردر واحد فيه upsell — عشان نتأكد إن الشارة بتظهر على الصح بس.
// بالـhook اللي الستب بيقراه **وقت الاستعلام**: الحقن على DOMContentLoaded
// كان بيوصل متأخر (الموديولات بتتنفّذ قبله والجدول بيبقى اترسم خلاص).
await p.addInitScript(`window.__UPSELL_IDS = ['o1'];`);
await p.goto(URL_, { waitUntil:'networkidle' });
await p.waitForSelector('#page-orders', { state:'visible' });
await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
await p.waitForTimeout(300);

// ── شارة الـupsell ──────────────────────────────────────────────────
const badges = await p.evaluate(() => ({
  total: document.querySelectorAll('#tbody .up-badge').length,
  rows:  document.querySelectorAll('#tbody tr[data-id]').length,
  onFirst: !!document.querySelector('#tbody tr[data-id] .up-badge'),
  title: (document.querySelector('#tbody .up-badge')||{}).title || ''
}));
ok(badges.total === 1, `شارة الـupsell على أوردر واحد بس — ${badges.total} من ${badges.rows}`);
ok(badges.onFirst, 'والشارة على الأوردر الصح');
ok(/upselling/.test(badges.title), `الشارة بتشرح نفسها — ${badges.title.slice(0,50)}`);

// ── تبويب العمولات للأدمن ───────────────────────────────────────────
await p.click('[data-page="finance"]');
await p.waitForSelector('#page-finance', { state:'visible' });
await p.waitForTimeout(600);
await p.click('.stock-tab[data-ftab="commissions"]');
await p.waitForSelector('#cm-by-user .cm-user', { timeout:8000 });
await p.waitForTimeout(300);

const admin = await p.evaluate(() => ({
  pending:  (document.getElementById('cm-sum-pending')||{}).textContent,
  earned:   (document.getElementById('cm-sum-earned')||{}).textContent,
  settled:  (document.getElementById('cm-sum-settled')||{}).textContent,
  out:      (document.getElementById('cm-sum-out')||{}).textContent,
  users:    [...document.querySelectorAll('.cm-user')].map(u => u.textContent.replace(/\s+/g,' ').trim()),
  owed:     [...document.querySelectorAll('.cm-owed')].map(x => x.textContent.trim()),
  settleBtns: document.querySelectorAll('[data-cm-settle]').length,
  settleRows: document.querySelectorAll('#cm-settlements tbody tr').length,
  revBtns:  document.querySelectorAll('[data-cm-rev]').length
}));
ok(/30/.test(admin.pending), `معلّق = ${admin.pending}   [متوقع 30]`);
ok(/30/.test(admin.earned),  `مستحق = ${admin.earned}   [متوقع 30]`);
ok(/70/.test(admin.settled), `اتصرف = ${admin.settled}   [متوقع 70 = 20+50]`);
ok(/-40|−40/.test(admin.out), `الرصيد = ${admin.out}   [متوقع −40 = 10 + (−50)]`);
ok(admin.owed.length === 1 && /عليه 50/.test(admin.owed[0]),
   `الرصيد السالب بيتعرض «عليه» مش صفر — ${JSON.stringify(admin.owed)}`);
ok(admin.settleBtns === 2, `زرار تسوية لكل موظف — ${admin.settleBtns}`);
ok(admin.settleRows === 2, `سجل التسويات فيه صفّين — ${admin.settleRows}`);
ok(admin.revBtns === 2, `وكل تسوية عليها زرار إلغاء — ${admin.revBtns}`);

// محاذاة جدول الحركات — الصفوف لازم تفضل table rows حقيقية.
// `.cm-row` (كلاس سطر محرر العمولة في الإعدادات) عليها display:flex،
// ولما الجدول خد نفس الكلاس بالغلط الـ<tr> اتفكّك والخلايا اترصّت
// بعيد عن عناوينها من غير أي خطأ — المالك هو اللي شافها. فحصين:
// الـdisplay نفسه + انحراف العناوين ضد الخلايا بالبكسل (فحص النتيجة
// مش الوسيلة — درس 34).
const align = await p.evaluate(() => {
  const t = document.querySelector('#cm-tbody table');
  if(!t) return { err:'no-table' };
  const ths = [...t.querySelectorAll('thead th')].map(e => e.getBoundingClientRect().x);
  const tds = [...t.querySelectorAll('tbody tr:first-child td')].map(e => e.getBoundingClientRect().x);
  const drift = ths.length === tds.length
    ? Math.max(...ths.map((x,i) => Math.abs(x - tds[i]))) : 9999;
  return { disp: getComputedStyle(t.querySelector('tbody tr')).display, drift: Math.round(drift) };
});
ok(align.disp === 'table-row', `صفوف الجدول table rows حقيقية — ${align.disp}`);
ok(align.drift <= 3, `العناوين فوق خلاياها بالظبط — أقصى انحراف ${align.drift}px`);

// الضغط على صف الحركة يفتح الأوردر
await p.click('#cm-tbody tbody tr.cm-ev-row');
await p.waitForSelector('#ovl.open', { state:'visible', timeout:6000 });
ok(true, 'الضغط على صف العمولة فتح نافذة الأوردر');
await p.evaluate(() => document.getElementById('ovl').classList.remove('open'));

// ── التسوية: المبلغ مكتوب سلفاً بالمستحق ─────────────────────────────
await p.click('.cm-user:nth-child(1) [data-cm-settle]');
await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
const modal = await p.evaluate(() => ({
  sub: (document.getElementById('cmodal-sub')||{}).textContent || '',
  val: (document.getElementById('cmodal-input')||{}).value,
  shown: getComputedStyle(document.getElementById('cmodal-input-wrap')).display
}));
ok(modal.shown !== 'none', 'خانة المبلغ ظاهرة');
ok(modal.val === '10', `المبلغ مكتوب سلفاً بكل المستحق — «${modal.val}» [متوقع 10]`);
ok(/هيتخصم من رصيده/.test(modal.sub), 'الرسالة بتقول إنه هيتخصم من رصيده');

// ── ضابط: خانة المبلغ إجبارية — بعد ما مودال التتبع بقى inputOptional،
//    لازم نتأكد إن الإجباري ماتفكّش معاه، وإن تحمير الرفض مابيلزقش ──
await p.fill('#cmodal-input', '');
await p.click('#cmodal-ok');
await p.waitForTimeout(250);
const rejected = await p.evaluate(() => ({
  open: getComputedStyle(document.getElementById('cmodal-backdrop')).display !== 'none',
  red: (document.getElementById('cmodal-input').style.borderColor || ''),
  calls: (window.__RPC||[]).filter(c => c.name === 'settle_commission').length
}));
ok(rejected.open && rejected.calls === 0, 'المبلغ الفاضي اترفض — المودال فاضل مفتوح ومفيش نداء');
ok(rejected.red.indexOf('red') >= 0, `والخانة اتحمّرت — «${rejected.red}»`);
await p.click('#cmodal-cancel');
await p.waitForTimeout(200);
await p.click('.cm-user:nth-child(1) [data-cm-settle]');
await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
ok(await p.evaluate(() => (document.getElementById('cmodal-input').style.borderColor || '') === ''),
   'والتحمير مالزقش بعد القفل والفتح');

await p.fill('#cmodal-input', '7');
await p.click('#cmodal-ok');
await p.waitForTimeout(400);
const sc = await p.evaluate(() => (window.__RPC||[]).filter(c => c.name === 'settle_commission').pop());
ok(sc && sc.args.p_amount === 7 && sc.args.p_user_id === 'u2',
   `التعديل اتبعت زي ما هو — ${JSON.stringify(sc && sc.args)}`);

// إلغاء التسوية = قيد عكسي
await p.click('[data-cm-rev]');
await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
const revSub = await p.evaluate(() => (document.getElementById('cmodal-sub')||{}).textContent || '');
ok(/مش هتتمسح/.test(revSub) && /قيد عكسي/.test(revSub), 'الإلغاء بيقول إنه قيد عكسي مش حذف');
await p.click('#cmodal-ok');
await p.waitForTimeout(400);
ok((await p.evaluate(() => (window.__RPC||[]).filter(c => c.name === 'reverse_settlement').length)) === 1,
   'ونداء الإلغاء اتبعت');

ok(errs.filter(e => !/favicon|ERR_/i.test(e)).length === 0,
   `صفر أخطاء صفحة${errs.length ? ' — ' + JSON.stringify(errs.slice(0,2)) : ''}`);
await b.close();

// ══ جهة الموظف — جلسة تانية بعمولة مفعّلة ═══════════════════════════
console.log('\n──── جهة الموظف ────');
const b2 = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p2 = await b2.newPage({ viewport:{ width:1440, height:1100 } });
const errs2 = []; p2.on('pageerror', e => errs2.push(e.message));
await p2.addInitScript(`window.__CM_ON = true; window.__ROLE = 'employee';`);
await p2.addInitScript(STUB);
await p2.addInitScript(DATA);
// الموظف = u1 في الستب، فنخلي الرصيد بتاعه
await p2.addInitScript(`
  window.__CM_BAL = [{ user_id:'u1', user_name:'أدمن الاختبار', events_count:2,
    pending_total:30, earned_total:90, void_total:0, settled_total:100,
    settlements_count:1, outstanding:-10 }];
  window.__CM_EVENTS = [
    { id:'e1', order_id:'o1', user_id:'u1', user_name:'أنا', before_total:500, after_total:800,
      delta:300, commission_type:'percent', commission_rate:10, commission_amount:30,
      status:'earned', resolved_at:null, created_at:'2026-08-04T10:00:00Z' }];
  window.__CM_SETTLE = [
    { id:'s1', user_id:'u1', user_name:'أنا', amount:100, kind:'settlement', reverses_id:null,
      note:'مرتب أغسطس', created_by_name:'المدير', created_at:'2026-08-05T12:00:00Z' }];
`);
await p2.goto(URL_, { waitUntil:'networkidle' });
await p2.waitForSelector('#page-orders', { state:'visible' });
await p2.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
await p2.waitForSelector('#my-cm-bar', { state:'visible', timeout:8000 });
await p2.waitForTimeout(300);

const bar = await p2.evaluate(() => {
  const el = document.getElementById('my-cm-bar');
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
  return { txt: el.textContent.replace(/\s+/g,' ').trim(), visible: r.height > 0,
           hit: !!(hit && el.contains(hit)) };
});
ok(bar.visible, 'شريط العمولة ظاهر');
// الموقع الجديد (طلب المالك): جوّه صف المدة مش فوق الجدول — المكان القديم
// بيظهر فيه تنبيه طلبات الإلغاء وكانوا بيزاحموا بعض
ok(await p2.evaluate(() => document.getElementById('my-cm-bar').parentElement.id === 'orders-period-bar'),
   'الشريط جوّه صف المدة (orders-period-bar)');
ok(/عليك 10/.test(bar.txt), `والرصيد السالب مكتوب «عليك» — ${bar.txt.slice(0,60)}`);
ok(/معلّق 30/.test(bar.txt), 'والمعلّق ظاهر معاه');
ok(bar.hit, 'الـhit-test: الشريط مش مدفون تحت حاجة');

// زرار «عمولتي» في القايمة — ظاهر + أيقونته بمقاس إخواته (كانت SVG عارية
// من غير .nv-ico فطلعت بعرض السايدبار كله) + الضغطة بتوصّل فعلاً
// (الأزرار متوصّلة بالـID واحد واحد في orders.js — الزرار ده كان ناقص)
const navBtn = await p2.evaluate(() => {
  const n = document.getElementById('nav-mycommission');
  if(!n || n.offsetParent === null) return null;
  const svg = n.querySelector('svg');
  const r = svg ? svg.getBoundingClientRect() : { width: 9999 };
  return { hasIco: !!n.querySelector('.nv-ico'), svgW: Math.round(r.width) };
});
ok(!!navBtn, 'زرار «عمولتي» ظاهر في القايمة');
ok(navBtn && navBtn.hasIco && navBtn.svgW <= 40,
   `أيقونة الزرار بمقاسها الطبيعي — ${navBtn ? navBtn.svgW : '؟'}px`);
await p2.click('#nav-mycommission');
await p2.waitForSelector('#page-mycommission', { state:'visible', timeout:6000 });
ok(true, 'ضغطة زرار القايمة فتحت صفحة «عمولتي»');
// والرجوع والدخول تاني من زرار الشريط — المسارين شغّالين
await p2.click('#nav-orders');
await p2.waitForSelector('#page-orders', { state:'visible' });
await p2.click('#my-cm-go');
await p2.waitForSelector('#page-mycommission', { state:'visible', timeout:6000 });
ok(true, 'وزرار «التفاصيل ↗» في الشريط بيوصّل برضه');
await p2.waitForTimeout(400);
const page = await p2.evaluate(() => ({
  out: (document.getElementById('my-cm-out')||{}).textContent,
  neg: (document.getElementById('my-cm-out')||{}).className,
  pending: (document.getElementById('my-cm-pending')||{}).textContent,
  settled: (document.getElementById('my-cm-settled')||{}).textContent,
  rate: (document.getElementById('my-cm-rate')||{}).textContent,
  events: document.querySelectorAll('#my-cm-events tbody tr').length,
  settles: document.querySelectorAll('#my-cm-settlements tbody tr').length,
  settleTxt: (document.querySelector('#my-cm-settlements tbody tr')||{}).textContent || ''
}));
ok(/10/.test(page.out) && /−|-/.test(page.out), `رصيده بالسالب — ${page.out}`);
ok(/cm-neg-val/.test(page.neg), 'ومتلوّن أحمر');
ok(/30/.test(page.pending), `معلّق = ${page.pending}`);
ok(/100/.test(page.settled), `اتصرفله = ${page.settled}`);
ok(/10%/.test(page.rate) && /الزيادة/.test(page.rate), `نسبته وشرحها ظاهرين — ${page.rate.slice(0,60)}`);
ok(page.events === 1, `حركاته ظاهرة — ${page.events}`);
ok(page.settles === 1, `والتسويات اللي اتعملتله — ${page.settles}`);
ok(/مرتب أغسطس/.test(page.settleTxt) && /المدير/.test(page.settleTxt),
   'وفيها الملاحظة ومين عملها');
ok(!(await p2.evaluate(() => document.querySelectorAll('#my-cm-settlements [data-cm-rev]').length)),
   'الموظف مالوش زرار إلغاء على التسوية');

ok(errs2.filter(e => !/favicon|ERR_/i.test(e)).length === 0,
   `صفر أخطاء صفحة${errs2.length ? ' — ' + JSON.stringify(errs2.slice(0,2)) : ''}`);
await b2.close();

console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
