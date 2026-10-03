// بلاغ 17532 (3 أكتوبر): الموظف شال منتج من محرر المنتجات وداس «🚚 شحن J&T» قبل الحفظ،
// فالبوليصة اتعملت من المحفوظ في الداتابيز (منتجين + 1759) والحفظة اللي بعدها خلّت
// السيستم يقول 1450 والمندوب يحصّل 1759.
//
// اللي بيتأكد هنا (الستب — من غير أي شبكة):
//  1) محرر نضيف → نافذة J&T بتفتح وبتعرض المبلغ والمنتجات اللي هيتبعتوا بالحرف
//  2) صف اتشال ومااتحفظش → الشحن ممنوع (J&T + يدوي) برسالة صريحة ومفيش أي نداء
//  3) سعر اتعدّل بس → ممنوع برضه (الحفظ كان هيبعت إجمالي جديد)
//  4) بعد الحفظ → الشحن بيعدّي والنافذة بتعرض الرقم الجديد (1450 + منتج واحد)
//  5) بعد البوليصة → ملاحظة القفل ظاهرة، والحفظ المرفوض من السيرفر (jt_waybill_locked)
//     بيتقال بالعربي مش «خطأ: jt_waybill_locked» · ضابط: أوردر من غير بوليصة J&T مالوش ملاحظة
//  6) المعايرات: الحارس دايماً false · شيل الحارس من autoShipFlow · تجاهل خانات السعر ·
//     شيل ملاحظة القفل — كل واحدة لازم توقّع فحصها
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

const KITCHEN = 'منظم المطبخ المتكامل', OFFICE = 'منظم المكتب الذكي 3 أدوار';
const PCA = [{ id:1, prov:'القاهرة', city:'مدينة نصر', area:'' }];

// شكل 17532 بالحرف: منتجين، 1450 + 309 = 1759
const PRE = `
  window.__TENANT = { shipping_provider: 'jt', has_shipping_api: false, sender_name: 'عتبة', sender_phone: '01200000000', sender_prov: 'القاهرة', sender_city: 'مدينة نصر', sender_area: 'الحي السابع', sender_street: 'شارع تجريبي 1' };
  window.__JT_PCA = ${JSON.stringify(PCA)};
  window.__STOCK = [
    { id:'s1', name:${JSON.stringify(KITCHEN)}, current_qty:10, unit_price:1450, wholesale_price:900, active:true, tenant_id:'t-test-1', parent_id:null, variant_label:null },
    { id:'s2', name:${JSON.stringify(OFFICE)},  current_qty:10, unit_price:309,  wholesale_price:150, active:true, tenant_id:'t-test-1', parent_id:null, variant_label:null }
  ];
  window.__FETCH_BODIES = []; window.__SAVES = [];
  // save_order_products بيحاكي السيرفر: بعد بوليصة J&T أي تغيير = jt_waybill_locked
  window.__RPC_HOOK = function(name, args){
    if(name !== 'save_order_products') return null;
    window.__SAVES.push(args);
    var o = (window.__ORDERS || []).filter(function(x){ return x.id === args.p_order_id; })[0];
    if(o && o.shipping_carrier === 'jt' && String(o.tracking_no || '').trim()) return { data:null, error:{ message:'jt_waybill_locked' } };
    if(o){ o.product_name = args.p_product_name; if(args.p_total_cost != null) o.total_cost = args.p_total_cost; if(args.p_prices) o.line_prices = args.p_prices; }
    return { data:{ order: Object.assign({}, o), upsell:null }, error:null };
  };
  (function(){ var of = window.fetch; window.fetch = function(u, init){
    if(String(u).indexOf('/functions/v1/jt-ship') >= 0){
      var body = JSON.parse(init.body); window.__FETCH_BODIES.push(body);
      var o = (window.__ORDERS || []).filter(function(x){ return x.id === body.order_id; })[0];
      if(o){ o.tracking_no = 'JEG000543486691'; o.status = 'BOSTA AUTO'; o.shipping_carrier = 'jt'; o.jt_sorting_code = '20,I01-01,010'; }
      return Promise.resolve(new Response(JSON.stringify({ ok:true, tracking_no:'JEG000543486691', sorting_code:'20,I01-01,010', record:{ status:'BOSTA AUTO' } }), { status: 200, headers:{ 'Content-Type':'application/json' } }));
    }
    return of.apply(this, arguments);
  }; })();
`;
const POST = `
  (function(){
    var o = (window.__ORDERS || []).filter(function(x){ return x.id === 'o3'; })[0];
    o.status = 'confirmed'; o.city = 'القاهره'; o.tracking_no = null;
    o.product_name = ${JSON.stringify(KITCHEN + ' (عدد 1)\n+ ' + OFFICE + ' (عدد 1)')};
    o.total_cost = 1759;
    o.line_prices = [{ n:${JSON.stringify(KITCHEN)}, p:1450, q:1 }, { n:${JSON.stringify(OFFICE)}, p:309, q:1 }];
    var mk = window.supabase.createClient;
    window.supabase.createClient = function(){
      var c = mk.apply(this, arguments), from = c.from.bind(c);
      c.from = function(t){
        if(t !== 'jt_pca') return from(t);
        var q = { _eq:[] };
        q.select = function(){ return q; }; q.order = function(){ return q; }; q.range = function(){ return q; };
        q.eq = function(col, val){ q._eq.push([col, val]); return q; };
        q.then = function(res){
          var rows = window.__JT_PCA.filter(function(r){ return q._eq.every(function(e){ return r[e[0]] === e[1]; }); });
          return Promise.resolve({ data: rows, error:null }).then(res);
        };
        return q;
      };
      return c;
    };
  })();
`;

// patches: [[ملف, مرساة, بديل]] — الحارس بيرمي لو المرساة مالقتش حاجة (درس 47)
async function openApp(patches){
  const ctx = await b.newContext({ viewport:{ width:1440, height:1100 } });
  await ctx.route('**/data/jt-areas.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  for(const [file, a, c] of (patches || [])){
    await ctx.route('**/js/orders/' + file, async r => {
      const res = await r.fetch(); let body = await res.text(); const before = body;
      body = body.replace(a, c);
      if(body === before) throw new Error('المعايرة مالقتش المرساة: ' + String(a).slice(0, 60));
      await r.fulfill({ response: res, body });
    });
  }
  await ctx.addInitScript(PRE);
  await ctx.addInitScript(STUB);
  await ctx.addInitScript(POST);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return p;
}
async function openDetail(p, id){
  await p.evaluate((id) => { const ov = document.getElementById('ovl'); if(ov) ov.classList.remove('open'); }, id);
  await p.evaluate((id) => { const tr = document.querySelector('#tbody tr[data-id="' + id + '"]'); if(tr) tr.click(); }, id);
  await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
  await p.waitForFunction(() => document.querySelectorAll('#prod-list .prod-item').length > 0, { timeout: 8000 });
  await p.waitForTimeout(250);
}
const toastTxt = p => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const jtOpen = p => p.evaluate(() => !!document.querySelector('#jt-modal.open'));

// السيناريو الأساسي: صف اتشال → الشحن ممنوع. بيرجّع true لو الحارس اشتغل.
async function scenarioRemoved(p){
  await openDetail(p, 'o3');
  await p.click('#prod-list .prod-del[data-idx="1"]');
  await p.waitForFunction(() => document.querySelectorAll('#prod-list .prod-item').length === 1);
  await p.click('#ship-auto');
  await p.waitForTimeout(600);
  return !(await jtOpen(p)) && (await p.evaluate(() => window.__FETCH_BODIES.length)) === 0;
}
async function scenarioPriceOnly(p){
  await openDetail(p, 'o3');
  await p.fill('#prod-list .prod-price[data-idx="0"]', '1400');
  await p.click('#ship-auto');
  await p.waitForTimeout(600);
  return !(await jtOpen(p));
}

// ════ 1) محرر نضيف → النافذة بتفتح وبتعرض اللي هيتبعت ════
{
  const p = await openApp();
  await openDetail(p, 'o3');
  ok((await p.$$eval('#prod-list .prod-item', r => r.length)) === 2, '1) المحرر فيه المنتجين زي 17532');
  ok(!(await p.$('#prod-lock')), '1ب) أوردر من غير بوليصة مالوش ملاحظة قفل (ضابط)');
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open', { timeout: 5000 });
  const cod = await p.textContent('#jt-cod');
  ok(cod.indexOf('1,759') >= 0 && cod.indexOf(KITCHEN) >= 0 && cod.indexOf(OFFICE) >= 0, '1ج) النافذة بتعرض المبلغ والمنتجين اللي هيتبعتوا: «' + cod.replace(/\n/g, ' / ') + '»');
  await p.click('#jt-cancel');

  // ════ 2) صف اتشال ومااتحفظش → ممنوع ════
  ok(await scenarioRemoved(p), '2) صف اتشال ومااتحفظش → نافذة J&T مافتحتش ومفيش نداء jt-ship');
  const t2 = await toastTxt(p);
  ok(/ماتحفظش/.test(t2) && /حفظ المنتجات/.test(t2), '2ب) الرسالة بتقول السبب والحل: «' + t2 + '»');
  ok(/احفظ المنتجات/.test(await p.textContent('#prod-status')), '2ج) وجنب زرار الحفظ كمان');
  // اليدوي بنفس الحارس
  await p.evaluate(() => { document.getElementById('cmodal-backdrop').style.display = 'none'; });
  await p.click('#da-bs');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('cmodal-backdrop')).display === 'none'), '2د) «اتشحن يدوي» ممنوع برضه (مودال التأكيد مافتحش)');

  // ════ 4) بعد الحفظ → الشحن بيعدّي بالرقم الجديد ════
  await p.click('#save-prod');
  await p.waitForFunction(() => window.__SAVES.length === 1);
  await p.waitForTimeout(300);
  const sv = await p.evaluate(() => window.__SAVES[0]);
  ok(sv.p_product_name === KITCHEN + ' (عدد 1)' && Number(sv.p_total_cost) === 1450, '4) الحفظة بعتت منتج واحد و1450');
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open', { timeout: 5000 });
  const cod4 = await p.textContent('#jt-cod');
  ok(cod4.indexOf('1,450') >= 0 && cod4.indexOf(OFFICE) < 0, '4ب) النافذة بقت بتعرض 1,450 ومن غير المنتج اللي اتشال');
  await p.waitForFunction(() => !document.getElementById('jt-go').disabled);
  await p.fill('#jt-area', 'الحي السابع');
  await p.click('#jt-go');
  await p.waitForFunction(() => window.__FETCH_BODIES.length === 1, { timeout: 5000 });
  ok(true, '4ج) الشحن عدّى بعد الحفظ');
  await p.click('#jt-close').catch(() => {});

  // ════ 5) بعد البوليصة → القفل ظاهر والرفض بالعربي ════
  await openDetail(p, 'o3');
  ok(!!(await p.$('#prod-lock')), '5) ملاحظة القفل ظاهرة على أوردر ليه بوليصة J&T');
  ok(!(await p.$('#ship-auto')) && !(await p.$('#da-bs')), '5ب) ومفيش أي زرار شحن');
  await p.fill('#prod-list .prod-price[data-idx="0"]', '1300');
  await p.click('#save-prod');
  await p.waitForFunction(() => window.__SAVES.length === 2);
  await p.waitForTimeout(300);
  const st5 = await p.textContent('#prod-status');
  ok(/مقفول/.test(st5) && st5.indexOf('jt_waybill_locked') < 0, '5ج) رفض السيرفر بيتقال بالعربي: «' + st5.slice(0, 70) + '…»');
  ok(/J&T/.test(await toastTxt(p)), '5د) ومعاه toast');
  await openDetail(p, 'o1');
  ok(!(await p.$('#prod-lock')), '5هـ) ضابط: أوردر ببوليصة مش J&T (shipping_carrier فاضي) مالوش ملاحظة قفل');
  await p.context().close();
}

// ════ 3) سعر اتعدّل بس → ممنوع ════
{
  const p = await openApp();
  ok(await scenarioPriceOnly(p), '3) سعر اتعدّل ومااتحفظش → الشحن ممنوع');
  await p.context().close();
}

// ════ 6) المعايرات ════
console.log('\n  المعايرات:');
{
  const p = await openApp([['products-editor.js', 'export function productsEditorDirty(){', 'export function productsEditorDirty(){ return false;']]);
  ok(!(await scenarioRemoved(p)), 'معايرة أ) الحارس دايماً false → فحص 2 بيقع (النافذة فتحت)');
  await p.context().close();
}
{
  const p = await openApp([['ship.js', /(if\(!ord \|\| !shippable\(ord\)\) return;\n)  if\(blockIfProductsDirty\(\)\) return;\n(  if\(isJt\(\)\))/, '$1$2']]);
  ok(!(await scenarioRemoved(p)), 'معايرة ب) شيل الحارس من autoShipFlow → فحص 2 بيقع');
  await p.context().close();
}
{
  const p = await openApp([['products-editor.js', "    if(String(inp.getAttribute('data-init') || '') !== String(inp.value).trim()) touched = true;\n  });\n  return touched;", '  });\n  return touched;']]);
  ok(!(await scenarioPriceOnly(p)), 'معايرة ج) تجاهل خانات السعر → فحص 3 بيقع');
  await p.context().close();
}
{
  const p = await openApp([['detail.js', '+(jtWaybillLocked(o)?', '+(false?']]);
  await openDetail(p, 'o3');
  await p.evaluate(() => { const o = window.__ORDERS.filter(x => x.id === 'o3')[0]; o.tracking_no = 'JEG1'; o.shipping_carrier = 'jt'; o.status = 'BOSTA AUTO'; });
  await openDetail(p, 'o3');
  ok(!(await p.$('#prod-lock')), 'معايرة د) شيل ملاحظة القفل → فحص 5 بيقع');
  await p.context().close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✓ كله عدّى');
process.exit(bad ? 1 : 0);
