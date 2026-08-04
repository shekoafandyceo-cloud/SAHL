// كارت الفرق لازم يقارن بنفس الأيام من الشهر اللي فات — مش الشهر كله
import { chromium } from 'playwright';
import fs from 'fs';
const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url),'utf8');
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(STUB);
await p.goto(process.env.APP_URL||'http://127.0.0.1:8899/index.html',{waitUntil:'networkidle'});
await p.waitForSelector('#page-orders',{state:'visible'});
await p.waitForFunction(()=>document.querySelectorAll('#tbody tr[data-id]').length>0);
await p.waitForTimeout(600);

let bad=0; const ok=(c,m)=>{console.log(c?'  ✓':'  ✗',m); if(!c)bad++;};
const r = await p.evaluate(()=>{
  const calls=(window.__calls||[]).filter(c=>c.rpc==='sahl_orders_stats');
  // لازم تاريخ القاهرة مش تاريخ الجهاز: الـRPC بيفلتر بـ
  // (created_at at time zone 'Africa/Cairo')::date، والكونتينر ممكن يكون
  // على UTC فيبقى يوم كامل ورا القاهرة بالليل
  const cairo = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return { calls:calls.map(c=>({from:c.args.p_from,to:c.args.p_to})),
           today:cairo, dom:+cairo.slice(8,10),
           // خانات الفرق بتاعة كروت الأوردرات بس — في صفحة الماليات فيه
           // عناصر .sdelta ثابتة (تسميات) ملهاش علاقة بالمقارنة
           tips:[...document.querySelectorAll('#page-orders .sdelta')].map(d=>({t:d.textContent.trim(),ti:d.title})).filter(x=>x.t),
           // تسميات الماليات الثابتة لازم تفضل زي ما هي بعد أي مسح
           finLabels:['fin-revenue-delta','fin-margin'].map(id=>(document.getElementById(id)||{}).textContent) };
});
console.log('  نداءات الـRPC:', JSON.stringify(r.calls));
ok(r.calls.length===2, `اتنده مرتين (الحالي + المقارنة) — ${r.calls.length}`);
const prev = r.calls[1];
if(prev){
  const [py,pm,pd] = prev.to.split('-').map(Number);
  const lastPrev = new Date(py, pm, 0).getDate();
  ok(prev.from.endsWith('-01'), 'نافذة المقارنة بتبدأ من أول الشهر: '+prev.from);
  ok(pd === Math.min(r.dom, lastPrev), `بتنتهي عند نفس يوم الشهر (${pd} = min(${r.dom},${lastPrev}))`);
  ok(pd !== lastPrev || r.dom >= lastPrev, 'مش الشهر كامل (إلا لو النهاردة آخر يوم)');
}
if(r.tips.length){
  console.log('  كل الفروق:', JSON.stringify(r.tips));
  // النافذة لازم تتسمّى في الـtooltip — سواء المسار العادي («مقارنة بـ…»)
  // أو مسار «جديد» لما الشهر اللي فات صفر («مفيش بيانات في …»)
  const named = r.tips.every(x => /مقارنة بـ|مفيش بيانات في/.test(x.ti||''));
  ok(named, 'كل الـtooltips بتسمّي النافذة — عيّنة: '+r.tips[0].ti);
  ok(!/الشهر اللي فات بـ/.test(r.tips[0].ti||''), 'مفيش صياغة «الشهر اللي فات» القديمة');
} else console.log('  (مفيش فروق مرندَرة في بيانات الستب — الـRPC هو الفيصل)');
// تبديل المدة بيشغّل clearStatsDeltas — تسميات الماليات الثابتة ماتتمسحش
await p.click('#orders-period-bar .pseg-btn[data-period="last30"]');
await p.waitForTimeout(700);
const fin = await p.evaluate(()=>['fin-revenue-delta','fin-margin'].map(id=>(document.getElementById(id)||{}).textContent));
ok(fin[0] && fin[0].trim().length>0, 'بعد تبديل المدة: تسمية «تشمل كل الحالات» لسه موجودة ('+JSON.stringify(fin[0])+')');
ok(fin[1] && fin[1].trim().length>0, 'وfin-margin لسه موجود ('+JSON.stringify(fin[1])+')');
const cleared = await p.evaluate(()=>[...document.querySelectorAll('#page-orders .sdelta')].filter(d=>d.textContent.trim()).length);
ok(cleared===0, 'وفروق كروت الأوردرات اتمسحت فعلاً في المدة اللي مالهاش مقارنة ('+cleared+')');

ok(errs.filter(e=>!/favicon|ERR_/i.test(e)).length===0,'صفر أخطاء صفحة');
await b.close();
console.log(bad?`\n❌ ${bad} مشكلة`:'\n✅ تمام');
process.exit(bad?1:0);
