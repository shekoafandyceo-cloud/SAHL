// كارت موظفين المتجر — الواجهة والحراسات اللي فيها.
//
// النطاق: ده بيختبر **الواجهة** بستب بيمثّل الـEdge Function.
// حراسات السيرفر (نطاق المتجر · ممنوع تلمس نفسك · ممنوع تلمس محمي)
// مالهاش قيمة إلا لو اتجرّبت على السيرفر نفسه — والاختبار ده بيتأكد بس إن
// الواجهة **بتبعت اللي المفروض** وبتحترم `locked` اللي جاي من السيرفر،
// و**مابتبعتش tenant_id** أصلاً (الثابت الحاكم في الـFunction).
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

// ستب الـEdge Function — بيحاكي ردود tenant-staff
const FN = `
  window.__STAFF = [
    { id:'u1', email:'admin@test.local', full_name:'أدمن الاختبار', role:'admin',
      active:true, last_seen:'2026-08-05T10:00:00Z', is_self:true,  locked:true },
    { id:'u2', email:'sara@test.local',  full_name:'سارة إبراهيم',  role:'employee',
      active:true, last_seen:null,                    is_self:false, locked:false },
    { id:'u3', email:'omar@test.local',  full_name:'عمر حسن',       role:'employee',
      active:false, last_seen:null,                   is_self:false, locked:false },
    { id:'u4', email:'boss@test.local',  full_name:'سوبر أدمن',     role:'admin',
      active:true, last_seen:null,                    is_self:false, locked:true }
  ];
  window.__FN = function(slug, body){
    if(slug !== 'tenant-staff') return { status:404, body:{ error:'nf' } };
    if(body.action === 'list')   return { body:{ ok:true, users: window.__STAFF } };
    if(body.action === 'create'){
      if(window.__FAIL_CREATE) return { status:409, body:{ error:'duplicate', message:'البريد ده مسجّل بالفعل' } };
      window.__STAFF = window.__STAFF.concat([{ id:'u9', email:body.email,
        full_name:body.full_name, role:body.role, active:true, last_seen:null,
        is_self:false, locked:false }]);
      return { body:{ ok:true, user:{ id:'u9' } } };
    }
    if(body.action === 'toggle'){
      window.__STAFF = window.__STAFF.map(function(u){
        return u.id === body.user_id ? Object.assign({}, u, { active: body.active }) : u; });
      return { body:{ ok:true } };
    }
    if(body.action === 'delete'){
      window.__STAFF = window.__STAFF.filter(function(u){ return u.id !== body.user_id; });
      return { body:{ ok:true } };
    }
    return { status:400, body:{ error:'unknown_action', message:'أكشن مش معروف' } };
  };
`;

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{ width:1440, height:1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(STUB);
await p.addInitScript(FN);
await p.goto(URL_, { waitUntil:'networkidle' });
await p.waitForSelector('#page-orders', { state:'visible' });

await p.click('[data-page="settings"]');
await p.waitForSelector('#page-settings', { state:'visible' });
await p.waitForSelector('#staff-list .staff-row', { timeout:8000 });
await p.waitForTimeout(300);

const rows = () => p.evaluate(() => [...document.querySelectorAll('#staff-list .staff-row')].map(r => ({
  name: (r.querySelector('.staff-name')||{}).textContent?.trim() || '',
  mail: (r.querySelector('.staff-mail')||{}).textContent?.trim() || '',
  off: r.classList.contains('off'),
  locked: !!r.querySelector('.staff-locked'),
  btns: [...r.querySelectorAll('.staff-btn')].map(x => x.textContent.trim())
})));

let r = await rows();
ok(r.length === 4, `اتعرضوا 4 موظفين — ${r.length}`);
ok(r[0].locked && r[0].btns.length === 0, 'حسابي أنا مقفول — مفيش أزرار عليه');
ok(r[3].locked && r[3].btns.length === 0, 'الحساب المحمي (سوبر أدمن) مقفول');
ok(!r[1].locked && r[1].btns.join('|') === 'إيقاف|حذف', `الموظف النشط عليه إيقاف+حذف — ${r[1].btns.join('|')}`);
ok(r[2].off && r[2].btns[0] === 'تفعيل', 'الموظف الموقوف شكله مختلف وزراره «تفعيل»');
ok(r[1].mail === 'sara@test.local', `الإيميل ظاهر — ${r[1].mail}`);

// 🔴 الثابت: الواجهة مابتبعتش tenant_id خالص
const calls0 = await p.evaluate(() => window.__FNCALLS || []);
ok(calls0.length > 0 && calls0.every(c => !('tenant_id' in c.body)),
   `صفر tenant_id في أي نداء — ${calls0.length} نداء`);
ok(calls0.every(c => c.auth), 'كل نداء معاه Authorization');

// إضافة موظف
await p.fill('#staff-name', 'نورهان سيد');
await p.fill('#staff-email', 'nour@test.local');
await p.fill('#staff-pass', 'short');
await p.click('#staff-add');
await p.waitForTimeout(400);
let created = await p.evaluate(() => (window.__FNCALLS||[]).filter(c => c.body.action === 'create').length);
ok(created === 0, 'باسورد قصيرة اتوقفت في الواجهة — مفيش نداء اتبعت');

await p.fill('#staff-pass', 'password123');
await p.click('#staff-add');
await p.waitForSelector('#staff-list .staff-row:nth-child(5)', { timeout:8000 });
r = await rows();
ok(r.length === 5, `بعد الإضافة بقوا 5 — ${r.length}`);
const cr = await p.evaluate(() => (window.__FNCALLS||[]).filter(c => c.body.action === 'create').pop());
ok(cr && cr.body.role === 'employee' && cr.body.email === 'nour@test.local' && !('tenant_id' in cr.body),
   `طلب الإنشاء مظبوط ومن غير tenant_id — ${JSON.stringify(cr && cr.body).slice(0,110)}`);
const cleared = await p.evaluate(() => ['staff-name','staff-email','staff-pass'].map(i => document.getElementById(i).value));
ok(cleared.every(v => v === ''), 'الحقول اتفضّت بعد النجاح — مفيش باسورد فاضلة على الشاشة');

// إيقاف موظف — لازم تأكيد الأول
await p.click('#staff-list .staff-row:nth-child(2) .staff-btn.warn');
await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
const modalTxt = await p.evaluate(() => (document.getElementById('cmodal-sub')||{}).textContent || '');
ok(/مش هيقدر يسجّل دخول/.test(modalTxt), 'رسالة التأكيد بتشرح الأثر');
ok(/يعمل تحديث|يقفل الصفحة/.test(modalTxt), 'وبتصارح إن الجلسة المفتوحة بتفضل شغّالة لحد التحديث');
await p.click('#cmodal-ok');
await p.waitForTimeout(500);
r = await rows();
ok(r[1].off && r[1].btns[0] === 'تفعيل', 'بعد الإيقاف الصف بقى موقوف وزراره «تفعيل»');

// حذف — تأكيد بيحذّر من السجل التاريخي
await p.click('#staff-list .staff-row:nth-child(3) .staff-btn.del');
await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
const delTxt = await p.evaluate(() => (document.getElementById('cmodal-sub')||{}).textContent || '');
ok(/سجل الأوردرات/.test(delTxt), 'تحذير الحذف بيقول إن الاسم بيفضل في سجل الأوردرات');
ok(/إيقاف/.test(delTxt), 'وبيقترح «إيقاف» كبديل');
await p.click('#cmodal-ok');
await p.waitForTimeout(500);
ok((await rows()).length === 4, 'الحذف نفّذ');

// خطأ من السيرفر لازم يوصل للتاجر بنصه
await p.evaluate(() => { window.__FAIL_CREATE = true; });
await p.fill('#staff-name', 'مكرر');
await p.fill('#staff-email', 'dup@test.local');
await p.fill('#staff-pass', 'password123');
await p.click('#staff-add');
await p.waitForTimeout(600);
const toastTxt = await p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
ok(/مسجّل بالفعل/.test(toastTxt), `رسالة السيرفر ظهرت للتاجر — ${toastTxt.slice(0,60)}`);
const btnBack = await p.evaluate(() => { const b = document.getElementById('staff-add'); return { d: b.disabled, t: b.textContent.trim() }; });
ok(!btnBack.d && /إضافة/.test(btnBack.t), 'الزرار رجع شغّال بعد الفشل مش عالق على «جاري الإنشاء»');

ok(errs.filter(e => !/favicon|ERR_/i.test(e)).length === 0,
   `صفر أخطاء صفحة${errs.length ? ' — ' + JSON.stringify(errs.slice(0,2)) : ''}`);

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
