// خانة سعر القطعة في محرر منتجات الأوردر — الحساب المطلق.
//
// العقد (بعد تجربة المالك الحية 8 أغسطس اللي كشفت إن حساب «الفروقات»
// بيضيّع الرقم المكتوب):
//   1. الرقم اللي في الخانة هو اللي بيتحفظ: الإجمالي = Σ(سعر × كمية)
//   2. الأسعار بتتخزن في `line_prices` — القفل والفتح بيرجّع المكتوب
//   3. مفيش أي تغيير = مانبعتش إجمالي (مانلمسش أوردر ماحدش عدّله)
//   4. سعر فاضي/مش رقم = الإجمالي مايتبعتش + رسالة توضيح
//   5. التكلفة مش في الطلب أصلاً — الفيصل بتاع الشارة/العمولة بقى على
//      السيرفر (مقارنة قايمة البضاعة) واتجرّب بترانزاكشن راجعة
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

async function openApp(pre){
  const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  if(pre) await p.addInitScript(pre);
  await p.addInitScript(STUB);
  await p.addInitScript(`
    window.__RPC = [];
    (function(){
      var mk = window.supabase.createClient;
      window.supabase.createClient = function(){
        var c = mk.apply(this, arguments), orig = c.rpc.bind(c);
        c.rpc = function(name, args){
          window.__RPC.push({ name: name, args: args });
          if(name === 'save_order_products'){
            return Promise.resolve({ data:{ order:{ id: args.p_order_id,
              product_name: args.p_product_name, total_cost: args.p_total_cost }, upsell: null }, error: null });
          }
          return orig(name, args);
        };
        return c;
      };
    })();
  `);
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return p;
}
async function openO1(p){
  await p.evaluate(() => { document.querySelector('#tbody tr[data-id="o1"]').click(); });
  await p.waitForSelector('#prod-list .prod-price', { timeout: 8000 });
  await p.waitForTimeout(300);
}
const lastSave = (p) => p.evaluate(() =>
  (window.__RPC || []).filter(c => c.name === 'save_order_products').pop());

// ════ 1) الاستمرارية: المحفوظ في line_prices بيرجع زي ما هو ════
{
  // أوردر اتحفظ فيه سعر عرض 850 قبل كده — الخانة لازم تفتح على 850 مش 1000
  const p = await openApp();
  await p.evaluate(() => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.line_prices = [{ n:'منتج أ', q:1, p:850 }]; o.total_cost = 850;
  });
  console.log('──── الاستمرارية: الرقم المكتوب بيرجع ────');
  await openO1(p);
  const v = await p.evaluate(() => (document.querySelector('#prod-list .prod-price')||{}).value);
  ok(v === '850', `الخانة فتحت على السعر المحفوظ — «${v}» [متوقع 850 مش سعر السيستم 1000]`);
  await p.close();
}

// ════ 2) مفيش line_prices + سطر واحد → إجمالي/كمية (الأوردرات القديمة) ════
{
  const p = await openApp();
  await p.evaluate(() => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.total_cost = 1200;   // سعر عرض قديم من غير line_prices
  });
  console.log('──── أوردر قديم: السعر الفعلي من الإجمالي ────');
  await openO1(p);
  const v = await p.evaluate(() => (document.querySelector('#prod-list .prod-price')||{}).value);
  ok(v === '1200', `الخانة = الإجمالي ÷ الكمية — «${v}» [متوقع 1200 مش 1000]`);
  await p.close();
}

// ════ 3) الرقم اللي بيتكتب هو اللي بيتبعت — مطلق مش فرق ════
{
  const p = await openApp();
  console.log('──── سيناريو المالك: 1000→900 وبعدها إعادة فتح وتعديل تاني ────');
  await openO1(p);
  await p.fill('#prod-list .prod-price', '900');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  let s = await lastSave(p);
  ok(s && s.args.p_total_cost === 900, `أول حفظ: 900 اتبعتت زي ما هي — ${s && s.args.p_total_cost}`);
  ok(s && JSON.stringify(s.args.p_prices) === JSON.stringify([{n:'منتج أ',q:1,p:900}]),
     `والأسعار اتبعتت للتخزين — ${JSON.stringify(s && s.args.p_prices)}`);
  ok(s && JSON.stringify(Object.keys(s.args).sort()) === JSON.stringify(['p_order_id','p_prices','p_product_name','p_total_cost']),
     '🔴 ومفيش أي حقل تكلفة — التكلفة ثابتة');
  // قفل وفتح: الخانة بترجع 900 (المحلي اتحدث) — وتعديل تاني لـ950 بيبعت 950
  await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); });
  await openO1(p);
  const reopened = await p.evaluate(() => (document.querySelector('#prod-list .prod-price')||{}).value);
  ok(reopened === '900', `بعد القفل والفتح الخانة على 900 — «${reopened}»`);
  await p.fill('#prod-list .prod-price', '950');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  s = await lastSave(p);
  ok(s && s.args.p_total_cost === 950, `تعديل تاني: 950 اتبعتت زي ما هي (مش 900+فرق) — ${s && s.args.p_total_cost}`);
  await p.close();
}

// ════ 4) قطعة تانية بسعر عرض — سيناريو الأوردرين ════
{
  const p = await openApp();
  console.log('──── قطعة تانية بسعر عرض ────');
  await openO1(p);
  await p.click('#prod-add');
  await p.waitForTimeout(200);
  await p.selectOption('#prod-list .prod-item:nth-child(2) .prod-select', { index: 1 });
  await p.waitForTimeout(150);
  const autofill = await p.evaluate(() =>
    (document.querySelector('#prod-list .prod-item:nth-child(2) .prod-price')||{}).value);
  ok(autofill === '1000', `اختيار المنتج ملى الخانة بسعر السيستم — «${autofill}»`);
  await p.fill('#prod-list .prod-item:nth-child(2) .prod-price', '700');
  await p.fill('#prod-list .prod-item:nth-child(2) .prod-qty', '2');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  const s = await lastSave(p);
  ok(s && s.args.p_total_cost === 2400,
     `الإجمالي = 1000 + 700×2 = 2400 — ${s && s.args.p_total_cost} [بسعر السيستم كان 3000]`);
  await p.close();
}

// ════ 5) مفيش تغيير = مانلمسش الأوردر ════
{
  const p = await openApp();
  console.log('──── حفظ من غير أي تعديل ────');
  await openO1(p);
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  const s = await lastSave(p);
  ok(s && s.args.p_total_cost === null && s.args.p_prices === null,
     `مفيش تغيير → total وprices بـnull — ${s && JSON.stringify([s.args.p_total_cost, s.args.p_prices])}`);
  await p.close();
}

// ════ 6) سعر فاضي = الإجمالي مايتبعتش + رسالة ════
{
  const p = await openApp();
  console.log('──── سعر فاضي ────');
  await openO1(p);
  await p.click('#prod-add');
  await p.waitForTimeout(200);
  await p.selectOption('#prod-list .prod-item:nth-child(2) .prod-select', { index: 1 });
  await p.fill('#prod-list .prod-item:nth-child(2) .prod-price', '');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  const s = await lastSave(p);
  const note = await p.evaluate(() => (document.getElementById('prod-status')||{}).textContent || '');
  ok(s && s.args.p_total_cost === null, `الإجمالي مااتبعتش — ${s && s.args.p_total_cost}`);
  ok(/من غير سعر/.test(note) && /ماتغيرش/.test(note), `والمستخدم اتقاله صراحةً — «${note.slice(0,60)}»`);
  await p.close();
}

// ════ 7) حذف صف بيحافظ على الأسعار المكتوبة ════
{
  const p = await openApp();
  console.log('──── حذف صف مايضيعش الأسعار ────');
  await openO1(p);
  await p.fill('#prod-list .prod-price', '880');            // عدّل سعر الصف الأول
  await p.click('#prod-add');
  await p.waitForTimeout(200);
  await p.selectOption('#prod-list .prod-item:nth-child(2) .prod-select', { index: 1 });
  await p.waitForTimeout(150);
  // امسح الصف التاني — سعر الأول المكتوب (880) لازم يفضل
  await p.click('#prod-list .prod-item:nth-child(2) .prod-del');
  await p.waitForTimeout(250);
  const kept = await p.evaluate(() => (document.querySelector('#prod-list .prod-price')||{}).value);
  ok(kept === '880', `السعر المكتوب فضل بعد الحذف — «${kept}»`);
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
