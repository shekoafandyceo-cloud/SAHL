// خانة سعر القطعة في محرر منتجات الأوردر.
//
// القاعدة: التعديل على **سعر البيع في الأوردر ده بس** — سعر المنتج في
// المخزون وسعر التكلفة (snapshots) مايتلمسوش. الخانة بتتملى بسعر السيستم
// تلقائياً، فسيب من غير تعديل = الفرق صفر والإجمالي ثابت. سعر عرض مكتوب
// بالإيد = الفرق بيتحسب بيه (طلب المالك: قطعة تانية بسعر عرض أقل).
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

async function openApp(){
  const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
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
  // o1: «منتج أ (عدد 1)» — موجود في المخزون بسعر 1000 وإجمالي الأوردر 1000
  await p.evaluate(() => { document.querySelector('#tbody tr[data-id="o1"]').click(); });
  await p.waitForSelector('#prod-list .prod-item', { timeout: 8000 });
  await p.waitForTimeout(300);
  return p;
}

const lastSave = (p) => p.evaluate(() =>
  (window.__RPC || []).filter(c => c.name === 'save_order_products').pop());

// ════ 1) الخانة بتتملى بسعر السيستم + الحفظ من غير تعديل مابيلمسش الإجمالي ════
{
  const p = await openApp();
  console.log('──── التهيئة والحفظ من غير تعديل ────');
  const init = await p.evaluate(() => ({
    price: (document.querySelector('#prod-list .prod-price')||{}).value,
    dir: getComputedStyle(document.querySelector('#prod-list .prod-price')).direction
  }));
  ok(init.price === '1000', `الخانة اتملت بسعر السيستم — «${init.price}» [متوقع 1000]`);
  ok(init.dir === 'ltr', 'والأرقام بتترسم ltr');

  await p.click('#save-prod');
  await p.waitForTimeout(400);
  const s1 = await lastSave(p);
  ok(s1 && s1.args.p_total_cost === null, `حفظ من غير تعديل → الإجمالي مايتلمسش (null) — ${s1 && s1.args.p_total_cost}`);
  await p.close();
}

// ════ 2) تعديل سعر القطعة بيظبط إجمالي الأوردر ده بس ════
{
  const p = await openApp();
  console.log('──── خصم على القطعة الموجودة ────');
  await p.fill('#prod-list .prod-price', '900');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  const s = await lastSave(p);
  ok(s && s.args.p_total_cost === 900, `السعر 1000→900 → الإجمالي 1000−100=900 — ${s && s.args.p_total_cost}`);
  ok(s && JSON.stringify(Object.keys(s.args).sort()) === JSON.stringify(['p_order_id','p_product_name','p_total_cost']),
     '🔴 ومفيش أي حقل تكلفة في الطلب — التكلفة ثابتة زي ما هي');
  await p.close();
}

// ════ 3) سيناريو المالك: قطعة تانية بسعر عرض ════
{
  const p = await openApp();
  console.log('──── قطعة تانية بسعر عرض ────');
  await p.click('#prod-add');
  await p.waitForTimeout(200);
  await p.selectOption('#prod-list .prod-item:nth-child(2) .prod-select', { index: 1 });
  await p.waitForTimeout(150);
  // اختيار المنتج ملى السعر بسعر السيستم — نقطة البداية
  const autofill = await p.evaluate(() =>
    (document.querySelector('#prod-list .prod-item:nth-child(2) .prod-price')||{}).value);
  ok(autofill === '1000', `اختيار المنتج ملى الخانة بسعر السيستم — «${autofill}»`);
  // التاجر بيكتب سعر العرض والكمية
  await p.fill('#prod-list .prod-item:nth-child(2) .prod-price', '700');
  await p.fill('#prod-list .prod-item:nth-child(2) .prod-qty', '2');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  const s = await lastSave(p);
  ok(s && s.args.p_total_cost === 2400,
     `الإجمالي = 1000 + (700×2 عرض) = 2400 — ${s && s.args.p_total_cost} [بسعر السيستم كان هيبقى 3000]`);
  ok(/منتج أ \(عدد 2\)/.test(s && s.args.p_product_name), 'والمنتج الجديد اتسجل بكميته');
  await p.close();
}

// ════ 4) سعر فاضي/كلام = مجهول — الإجمالي مايتلمسش ════
{
  const p = await openApp();
  console.log('──── سعر مش رقم = مانلمسش الإجمالي ────');
  await p.click('#prod-add');
  await p.waitForTimeout(200);
  await p.selectOption('#prod-list .prod-item:nth-child(2) .prod-select', { index: 1 });
  await p.fill('#prod-list .prod-item:nth-child(2) .prod-price', '');
  await p.click('#save-prod');
  await p.waitForTimeout(400);
  const s = await lastSave(p);
  ok(s && s.args.p_total_cost === null,
     `سعر فاضي → الإجمالي مايتلمسش (null) — ${s && s.args.p_total_cost}`);
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
