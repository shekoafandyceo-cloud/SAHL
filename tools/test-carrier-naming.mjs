// تسمية شركة الشحن — الفحص الساكن في check.py بيقرا الملفات، وده بيقرا
// **اللي التاجر شايفه فعلاً** بعد الرندر: نصوص + title + data-tip، على كل
// الصفحات وجوّه نافذة التفاصيل.
//
// ليه الاتنين؟ لأن الساكن سمح «اربط بوسطة» في setup-checklist.js على أساس
// إنها جنب كارت الإعدادات — والحي كشف إنها بتترندر على **صفحة الطلبات**.
// الملف بيقول مكان النص، الرندر بيقول مكانه الحقيقي.
//
// والقيم في الداتابيز (bosta_assigned · BOSTA AUTO · BOSTA2) بتتأكد إنها
// ماتلمستش — أي تغيير فيها بيكسر n8n والفلاتر.
import { chromium } from 'playwright';
import fs from 'fs';
const STUB = fs.readFileSync('./stub.js','utf8');
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({viewport:{width:1440,height:1000}});
await p.addInitScript(STUB);
await p.goto('http://127.0.0.1:8899/index.html',{waitUntil:'networkidle'});
await p.waitForSelector('#page-orders',{state:'visible'});
await p.waitForFunction(()=>document.querySelectorAll('#tbody tr[data-id]').length>0);
let bad=0; const ok=(c,m)=>{console.log(c?'  ✓':'  ✗',m); if(!c)bad++;};

// كل نص ظاهر على الصفحة كلها (بعد فتح كل الصفحات) — بدون بوسطة
const pages=['orders','stock','finance','analytics','inbox','billing','settings'];
for(const pg of pages){ await p.click(`[data-page="${pg}"]`); await p.waitForTimeout(400); }
await p.click('[data-page="orders"]'); await p.waitForTimeout(300);
await p.click('#tbody tr[data-id]'); await p.waitForSelector('#dcnt .dsec'); await p.waitForTimeout(400);

const r = await p.evaluate(()=>{
  const W='بوسطة';
  const hits=[];
  // النص المرئي
  const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let n; while((n=walk.nextNode())){ if(n.nodeValue && n.nodeValue.includes(W)){
    const el=n.parentElement; const inSettings=!!el.closest('#page-settings');
    hits.push({t:n.nodeValue.trim(), settings:inSettings, tag:el.tagName});
  }}
  // والـtitle/data-tip كمان — دي بتظهر للتاجر برضه
  document.querySelectorAll('[title],[data-tip]').forEach(el=>{
    [el.getAttribute('title'),el.getAttribute('data-tip')].forEach(v=>{
      if(v && v.includes(W)) hits.push({t:v, settings:!!el.closest('#page-settings'), tag:el.tagName+'[attr]'});
    });
  });
  // تسميات الحالات من الـselect
  const opts=[...document.querySelectorAll('#dsel option, #fst option')].map(o=>o.textContent.trim());
  return {hits, statusLabels:opts.filter(t=>/شحن|بوسطة|اتضرب/.test(t))};
});
// الموضع الوحيد المسموح: السطر الشارح تحت «ربط شركة الشحن» في الإعدادات
const ALLOW = /شركة الشحن المدعومة حاليًا: بوسطة/;
const outside = r.hits.filter(h => !ALLOW.test(h.t));
ok(outside.length===0, `صفر «بوسطة» في أي نص معروض — ${outside.length}${outside.length?' :: '+JSON.stringify(outside.slice(0,4).map(h=>({...h,t:h.t.slice(0,70)}))):''}`);
console.log('  المسموح:', r.hits.filter(h=>ALLOW.test(h.t)).map(h=>h.t.slice(0,80)).join(' · ')||'—');
console.log('  تسميات الحالات:', JSON.stringify(r.statusLabels));
ok(r.statusLabels.includes('شحن'), 'حالة bosta_assigned بقت «شحن»');
ok(r.statusLabels.includes('شحن أوتوماتيك'), 'حالة BOSTA AUTO بقت «شحن أوتوماتيك»');
ok(r.statusLabels.includes('اوردر اتضرب'), 'حالة BOSTA2 فضلت «اوردر اتضرب» (قرار المالك)');
// القيم نفسها لازم تفضل زي ما هي
const vals = await p.evaluate(()=>[...document.querySelectorAll('#dsel option')].map(o=>o.value));
ok(vals.includes('bosta_assigned') && vals.includes('BOSTA AUTO') && vals.includes('BOSTA2'),
   'قيم الداتابيز في الـselect ماتلمستش: '+JSON.stringify(vals.filter(v=>/bosta|BOSTA/i.test(v))));
await b.close();
console.log(bad?`\n❌ ${bad}`:'\n✅ تمام');
process.exit(bad?1:0);
