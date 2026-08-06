// عمولة الـupselling — الواجهة.
//
// نطاق الاختبار ده **الواجهة بس**. الحساب الحقيقي كله على السيرفر في
// `save_order_products`، واتجرّب هناك بترانزاكشن راجعة (8 حالات) + اختبار
// RLS منفصل أثبت إن العبور بين التجار مرفوض وإن الكتابة المباشرة على
// `upsell_events` بتعدّل صفر صف.
//
// اللي بيتأكد هنا:
//  1) الفرونت بيبعت `save_order_products` مش update مباشر على orders —
//     وده الفرق بين «العمولة بتتحسب على السيرفر» و«الفرونت بيقول الرقم»
//  2) مابيبعتش الإجمالي القديم خالص (لو بعته، موظف يقدر يبعت صفر ويطلّع
//     لنفسه عمولة على الأوردر كله)
//  3) العمولة الراجعة بتوصل للموظف كرسالة
//  4) قسم الماليات بيجمّع صح ويفلتر صح
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

// ستب الـRPC + جدول العمولات
const EXTRA = `
  window.__RPC = [];
  window.__CM = [
    { id:'c1', order_id:'o1', user_id:'u2', user_name:'سارة إبراهيم', before_total:500,
      after_total:800, delta:300, commission_type:'percent', commission_rate:10,
      commission_amount:30, status:'earned',  resolved_at:'2026-08-05T10:00:00Z', created_at:'2026-08-04T10:00:00Z' },
    { id:'c2', order_id:'o2', user_id:'u2', user_name:'سارة إبراهيم', before_total:600,
      after_total:900, delta:300, commission_type:'percent', commission_rate:10,
      commission_amount:30, status:'pending', resolved_at:null, created_at:'2026-08-05T10:00:00Z' },
    { id:'c3', order_id:'o3', user_id:'u3', user_name:'عمر حسن', before_total:400,
      after_total:1200, delta:800, commission_type:'fixed', commission_rate:25,
      commission_amount:25, status:'void',    resolved_at:'2026-08-05T12:00:00Z', created_at:'2026-08-03T10:00:00Z' },
    { id:'c4', order_id:'o4', user_id:'u3', user_name:'عمر حسن', before_total:300,
      after_total:500, delta:200, commission_type:'fixed', commission_rate:25,
      commission_amount:25, status:'earned',  resolved_at:'2026-08-06T10:00:00Z', created_at:'2026-08-06T09:00:00Z' }
  ];
  // أرصدة الموظفين — بتيجي من الفيو v_commission_balances مش من الحركات.
  // كارتَي «اتصرف» و«الرصيد المستحق» بيتحسبوا منها هي، فلازم تتحقن هنا
  // وإلا الكروت تطلع صفر والتجميع بالموظف يفضل فاضي.
  window.__CM_BAL = [
    { user_id:'u2', user_name:'سارة إبراهيم', events_count:2, pending_total:30, earned_total:30,
      void_total:0,  settled_total:0,  settlements_count:0, outstanding:30 },
    { user_id:'u3', user_name:'عمر حسن',      events_count:2, pending_total:0,  earned_total:25,
      void_total:25, settled_total:25, settlements_count:1, outstanding:0 }
  ];
`;

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{ width:1440, height:1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(STUB);
await p.addInitScript(EXTRA);
// نلفّ rpc و from عشان نرصد اللي بيخرج
await p.addInitScript(`
  (function(){
    var mk = window.supabase.createClient;
    window.supabase.createClient = function(){
      var c = mk.apply(this, arguments);
      var origRpc = c.rpc.bind(c), origFrom = c.from.bind(c);
      c.rpc = function(name, args){
        window.__RPC.push({ name: name, args: args });
        if(name === 'save_order_products'){
          return Promise.resolve({ data: {
            order: { id: 'o1', product_name: args.p_product_name,
                     total_cost: args.p_total_cost == null ? 1000 : args.p_total_cost },
            upsell: args.p_total_cost != null
                    ? { commission_amount: 42, status:'pending' } : null
          }, error: null });
        }
        return origRpc(name, args);
      };
      c.from = function(t){
        window.__FROM = window.__FROM || [];
        window.__FROM.push(t);
        if(t === 'upsell_events'){
          var api = {};
          ['select','eq','order','limit'].forEach(function(m){ api[m] = function(){ return api; }; });
          api.then = function(res){ return Promise.resolve({ data: window.__CM, error: null }).then(res); };
          return api;
        }
        return origFrom(t);
      };
      return c;
    };
  })();
`);
await p.goto(URL_, { waitUntil:'networkidle' });
await p.waitForSelector('#page-orders', { state:'visible' });
await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);

// ── 1) حفظ المنتجات بيعدّي على الـRPC ────────────────────────────────
await p.click('#tbody tr[data-id]');
await p.waitForSelector('#dcnt .dsec');
await p.waitForSelector('#prod-list .prod-item');
await p.waitForTimeout(400);
await p.click('#prod-add');
await p.waitForTimeout(200);
await p.selectOption('#prod-list .prod-item:nth-child(2) .prod-select', { index: 1 });
await p.click('#save-prod');
await p.waitForTimeout(600);

const rpc = await p.evaluate(() => (window.__RPC || []).filter(c => c.name === 'save_order_products'));
ok(rpc.length === 1, `اتنده save_order_products مرة — ${rpc.length}`);
// الفحص الحقيقي: مفيش ولا استعلام كتابة راح لـorders مباشرةً.
// (الستب بيسجّل كل نداء from — الكتابة بتيجي من غير `select`)
const direct = await p.evaluate(() => (window.__calls || [])
  .filter(c => c.table === 'orders' && c.cols === undefined).length);
ok(direct === 0, `صفر كتابة مباشرة على orders — ${direct}`);
if(rpc[0]){
  const a = rpc[0].args;
  ok(!('p_before' in a) && !('p_old_total' in a) && !('before_total' in a),
     `مفيش «الإجمالي القديم» في الطلب — ${JSON.stringify(Object.keys(a))}`);
  ok('p_order_id' in a && 'p_product_name' in a && 'p_total_cost' in a,
     'الطلب فيه المعرّف والمنتجات والإجمالي الجديد بس');
}

// ── 2) العمولة الراجعة بتوصل للموظف ──────────────────────────────────
// الرسالة دي جاية من مسار saveProducts الحقيقي بعد ضغطة «حفظ المنتجات» فوق —
// مش نداء toast يدوي (ده كان هيختبر toast.js مش الميزة)
const toastTxt = await p.evaluate(() =>
  [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
ok(/عمولة upselling/.test(toastTxt) && /42/.test(toastTxt),
   `رسالة العمولة ظهرت بالمبلغ — ${toastTxt.slice(0,80)}`);
ok(/بتستحق لما الأوردر يتسلّم/.test(toastTxt),
   'والرسالة بتقول إنها معلّقة لحد التسليم — مش بتوعد بفلوس مضمونة');

// ── 3) قسم العمولات في الماليات ──────────────────────────────────────
await p.evaluate(() => { const o = document.getElementById('ovl'); if(o) o.classList.remove('open'); });
await p.click('[data-page="finance"]');
await p.waitForSelector('#page-finance', { state:'visible' });
await p.waitForTimeout(600);
await p.click('.stock-tab[data-ftab="commissions"]');
await p.waitForSelector('#cm-tbody table tbody tr', { timeout:8000 });
await p.waitForTimeout(300);

const sums = await p.evaluate(() => ({
  pending: (document.getElementById('cm-sum-pending')||{}).textContent,
  earned:  (document.getElementById('cm-sum-earned')||{}).textContent,
  settled: (document.getElementById('cm-sum-settled')||{}).textContent,
  out:     (document.getElementById('cm-sum-out')||{}).textContent,
  rows:    document.querySelectorAll('#cm-tbody tbody tr').length,
  users:   [...document.querySelectorAll('.cm-user')].map(u => u.textContent.replace(/\s+/g,' ').trim())
}));
// المعلّق والمستحق بيتحسبوا من **الحركات**: معلّق 30 · مستحق 30+25=55.
// المتصرّف والرصيد بيتحسبوا من **الفيو**: اتصرف 0+25=25 · الرصيد 30+0=30.
// التقسيمة دي مقصودة — التسويات مالهاش علاقة بجدول الحركات.
ok(/30/.test(sums.pending), `المعلّق = ${sums.pending}   [متوقع 30 ج]`);
ok(/55/.test(sums.earned),  `المستحق = ${sums.earned}   [متوقع 55 ج]`);
ok(/25/.test(sums.settled), `اتصرف = ${sums.settled}   [متوقع 25 ج]`);
ok(/30/.test(sums.out),     `الرصيد المستحق = ${sums.out}   [متوقع 30 ج]`);
ok(sums.rows === 4, `الجدول فيه 4 حركات — ${sums.rows}`);
ok(sums.users.length === 2, `التجميع بالموظف: موظفين — ${sums.users.length}`);
console.log('  ' + sums.users.join('\n  '));

// الحالات معروضة بالعربي — **قبل** الفلتر عشان التلاتة يبانوا
const badgesAll = await p.evaluate(() => [...new Set([...document.querySelectorAll('.cm-badge')].map(x => x.textContent.trim()))].sort());
ok(badgesAll.length === 3 && badgesAll.every(t => ['معلّقة','مستحقة','ملغية'].indexOf(t) >= 0),
   `التلات حالات بالعربي — ${JSON.stringify(badgesAll)}`);

// الفلتر
await p.selectOption('#cm-filter-status', 'earned');
await p.waitForTimeout(300);
const after = await p.evaluate(() => ({
  rows: document.querySelectorAll('#cm-tbody tbody tr').length,
  cnt: (document.getElementById('cm-count')||{}).textContent,
  pending: (document.getElementById('cm-sum-pending')||{}).textContent
}));
ok(after.rows === 2, `فلتر «مستحقة» رجّع صفّين — ${after.rows}`);
ok(/30/.test(after.pending), 'كروت الإجمالي مابتتأثرش بالفلتر — بتفضل على الكل');


ok(errs.filter(e => !/favicon|ERR_/i.test(e)).length === 0,
   `صفر أخطاء صفحة${errs.length ? ' — ' + JSON.stringify(errs.slice(0,2)) : ''}`);

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
