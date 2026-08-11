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

// ════ 8) أوردر ويبهوك ملزوق بـ" - " — بيترندر صفوف مقسومة ════
// الفاصل الحقيقي دايماً بعد قوس "(عدد N)" مقفول — splitProductSegments
{
  const p = await openApp();
  await p.evaluate(() => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.product_name = 'منتج أ (عدد 1) - منظم درج المطبخ (عدد 2)';
  });
  console.log('──── أوردر ملزوق: القسمة النضيفة ────');
  await openO1(p);
  const rows = await p.evaluate(() =>
    [...document.querySelectorAll('#prod-list .prod-item')].map(r => ({
      name: r.querySelector('.prod-select').value,
      qty: r.querySelector('.prod-qty').value
    })));
  ok(rows.length === 2, `صفين مش صف ملزوق — ${rows.length}`);
  ok(rows[0] && rows[0].name === 'منتج أ' && rows[0].qty === '1',
     `الأول: «${rows[0] && rows[0].name}» عدد ${rows[0] && rows[0].qty}`);
  ok(rows[1] && rows[1].name === 'منظم درج المطبخ' && rows[1].qty === '2',
     `والتاني: «${rows[1] && rows[1].name}» عدد ${rows[1] && rows[1].qty}`);
  await p.close();
}

// ════ 9) الشرطة جوه الاسم ولاحقة الـvariant — مش منتجات وهمية ════
{
  const p = await openApp();
  await p.evaluate(() => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.product_name = 'استاند امريكانا 4 دور - جزامة و شماعة (عدد 1)';
  });
  console.log('──── الشرطة جوه الاسم المركب ────');
  await openO1(p);
  let rows = await p.evaluate(() =>
    [...document.querySelectorAll('#prod-list .prod-item .prod-select')].map(s => s.value));
  ok(rows.length === 1 && rows[0] === 'استاند امريكانا 4 دور - جزامة و شماعة',
     `الاسم المركب فضل صف واحد — ${JSON.stringify(rows)}`);
  // لاحقة variant بعد القوس: بترجع تتلزق باسمها والكمية تتنقل لآخر السطر
  await p.evaluate(() => {
    document.getElementById('ovl').classList.remove('open');
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.product_name = 'ترولي 2 دور (عدد 1) - أسود';
  });
  await openO1(p);
  const v = await p.evaluate(() => {
    const r = document.querySelector('#prod-list .prod-item');
    return { n: r.querySelector('.prod-select').value, q: r.querySelector('.prod-qty').value,
             count: document.querySelectorAll('#prod-list .prod-item').length };
  });
  ok(v.count === 1 && v.n === 'ترولي 2 دور - أسود' && v.q === '1',
     `«أسود» مش منتج — صف واحد «${v.n}» عدد ${v.q}`);
  await p.close();
}

// ════ 9ب) قوس جوه الاسم قبل الشرطة — القسمة بعد قوس الكمية بس ════
// (المراجعة العدائية: القسمة بعد أي ")" كانت بتفكك «ترولي (3 دور) - أسود»
//  وبتكتب التفكيك في الداتابيز مع أول حفظ — الكمية بتهاجر للمنتج الوهمي)
{
  const p = await openApp();
  await p.evaluate(() => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.product_name = 'ترولي (3 دور) - أسود (عدد 2)';
  });
  console.log('──── قوس جوه الاسم: مش نقطة قسمة ────');
  await openO1(p);
  let v = await p.evaluate(() => {
    const r = document.querySelector('#prod-list .prod-item');
    return { n: r.querySelector('.prod-select').value, q: r.querySelector('.prod-qty').value,
             count: document.querySelectorAll('#prod-list .prod-item').length };
  });
  ok(v.count === 1 && v.n === 'ترولي (3 دور) - أسود' && v.q === '2',
     `صف واحد سليم «${v.n}» عدد ${v.q}`);
  // round-trip الحذف: صف تاني بيتحذف — الصف اللي مالمسوش لازم يفضل سليم
  // (إعادة الرندر بتمر على collectProducts().join ← parseProducts تاني)
  await p.evaluate(() => {
    document.getElementById('ovl').classList.remove('open');
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.product_name = 'منتج أ (عدد 1) - ترولي (3 دور) - أسود (عدد 2)';
  });
  await openO1(p);
  let rows = await p.evaluate(() =>
    [...document.querySelectorAll('#prod-list .prod-item')].map(r => ({
      n: r.querySelector('.prod-select').value, q: r.querySelector('.prod-qty').value })));
  ok(rows.length === 2 && rows[1].n === 'ترولي (3 دور) - أسود' && rows[1].q === '2',
     `الملزوق اتقسم صح رغم القوس الجوّاني — ${JSON.stringify(rows.map(r=>r.n))}`);
  await p.click('#prod-list .prod-item:nth-child(1) .prod-del');
  await p.waitForTimeout(250);
  const after = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#prod-list .prod-item')];
    return items.map(r => ({ n: r.querySelector('.prod-select').value,
                             q: r.querySelector('.prod-qty').value }));
  });
  ok(after.length === 1 && after[0].n === 'ترولي (3 دور) - أسود' && after[0].q === '2',
     `🔴 بعد الحذف الصف الباقي زي ما هو — «${after[0] && after[0].n}» عدد ${after[0] && after[0].q} [مش «أسود» بكمية مهاجرة]`);
  await p.close();
}

// ════ 10) 🔴 سد الـupsell الوهمي: تعديل سعر على أوردر ملزوق ════
// التمثيل اتغير (صف ملزوق ← صفين) بس البضاعة زي ما هي — لازم يتبعت
// الاسم المخزن **نفسه** عشان مقارنة السيرفر تطلع صفر تغيير، وإلا أي
// حفظة بتتعلم upsell وهمي لو الإجمالي زاد (عيلة أحداث إبراهيم الوهمية)
{
  const GLUED = 'منتج أ (عدد 1) - منظم درج المطبخ (عدد 2)';
  const p = await openApp();
  await p.evaluate((g) => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.product_name = g; o.total_cost = 500;
  }, GLUED);
  console.log('──── الملزوق: تعديل سعر بس ≠ تغيير بضاعة ────');
  await openO1(p);
  await p.fill('#prod-list .prod-item:nth-child(2) .prod-price', '200');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  let s = await lastSave(p);
  ok(s && s.args.p_product_name === GLUED,
     '🔴 الاسم اتبعت زي ما هو مخزن — السيرفر مايشوفش «بضاعة اتغيرت»');
  ok(s && s.args.p_total_cost === 1400,
     `والإجمالي من الصفوف المقسومة: 1000 + 200×2 = 1400 — ${s && s.args.p_total_cost}`);
  ok(s && JSON.stringify(s.args.p_prices) ===
       JSON.stringify([{n:'منتج أ',q:1,p:1000},{n:'منظم درج المطبخ',q:2,p:200}]),
     'والأسعار اتخزنت بأسماء الصفوف المقسومة');
  // القفل والفتح: الأسعار بترجع على الصفوف المقسومة رغم إن الاسم المخزن ملزوق
  await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); });
  await openO1(p);
  const back = await p.evaluate(() =>
    [...document.querySelectorAll('#prod-list .prod-price')].map(i => i.value));
  ok(JSON.stringify(back) === JSON.stringify(['1000','200']),
     `بعد القفل والفتح الأسعار راجعة — ${JSON.stringify(back)}`);
  await p.close();
}

// ════ 11) الملزوق من غير أي لمسة = مانبعتش تغيير · وإضافة فعلية = القسمة بتتكتب ════
{
  const GLUED = 'منتج أ (عدد 1) - منظم درج المطبخ (عدد 2)';
  const p = await openApp();
  await p.evaluate((g) => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o1')[0];
    o.product_name = g;
  }, GLUED);
  console.log('──── الملزوق: حفظ فاضي vs إضافة حقيقية ────');
  await openO1(p);
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  let s = await lastSave(p);
  ok(s && s.args.p_product_name === GLUED && s.args.p_total_cost === null && s.args.p_prices === null,
     `حفظ من غير لمسة: الاسم زي ما هو + null/null — ${s && JSON.stringify([s.args.p_total_cost, s.args.p_prices])}`);
  // دلوقتي إضافة منتج فعلية — هنا بس التمثيل المقسوم النضيف يتكتب
  await p.click('#prod-add');
  await p.waitForTimeout(200);
  await p.selectOption('#prod-list .prod-item:nth-child(3) .prod-select', { index: 1 });
  await p.waitForTimeout(150);
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  s = await lastSave(p);
  ok(s && s.args.p_product_name !== GLUED && s.args.p_product_name.indexOf('\n+ ') >= 0
       && /منتج أ \(عدد 1\)\n\+ منظم درج المطبخ \(عدد 2\)/.test(s.args.p_product_name),
     'إضافة فعلية: الاسم اتكتب بالتمثيل المقسوم — والسيرفر يشوف البضاعة المضافة بس');
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
