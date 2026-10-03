// «➕ أوردر جديد» + «🔁 طلب استبدال» + «ملاحظة على البوليصة» (طلبات المالك 3 أكتوبر).
//
// اللي بيتأكد هنا (الستب — من غير أي شبكة):
//  A) أوردر جديد: الزرار في شريط الأوردرات وشايفه الماوس (ديسكتوب + موبايل) · التحقق قبل الإرسال
//     (اسم · موبايل بنفس egMobile · عنوان · J&T · منتج) · المنتجات من المخزون بأسعارها · الحمولة لـ
//     create_staff_order فيها items/p_total = المجموع/المنصة/العنوان/الملاحظة ومفيش tenant_id ولا status ·
//     نجاح = toast برقم W-n + التفاصيل بتفتح على الأوردر الجديد · رفض السيرفر بيتقال بالعربي.
//  B) الاستبدال: الزرار على أوردر اتشحن بس (مش pending/confirmed) · البيانات متعبّية من الأصلي · المبلغ
//     الافتراضي = فرق السعر ولو الموظف كتب رقم مايتمسحش · p_exchange_of + المبلغ المكتوب · ربط
//     «استبدال لأوردر #…» و«اتعمله استبدال» في التفاصيل · شارة 🔁 في الجدول.
//  C) نافذة J&T: الملاحظة متعبّية من ملاحظة العميل (🔴 مش الداخلية أبداً) · المعاينة = composeRemark ·
//     تعديل الملاحظة بيوصل في الحمولة.
//  D) البوليصة المطبوعة بتطبع jt_remark بالحرف لو موجود، وغير كده زي ما كانت.
//  E) المعايرات: زرار الاستبدال على كل حاجة · شيل p_exchange_of · الملاحظة من الداخلية ·
//     الطباعة بتتجاهل jt_remark · المبلغ المكتوب بيتمسح.
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

const KITCHEN = 'منظم المطبخ المتكامل', TURBO = 'تيربو بريمو 5 دور';
const CUST_NOTE = 'الاتصال قبل الوصول', SECRET = 'سر داخلي ممنوع على البوليصة';

const PRE = `
  window.__TENANT = { shipping_provider: 'jt', has_shipping_api: false, sender_name: 'عتبة', sender_phone: '01200000000', sender_prov: 'القاهرة', sender_city: 'مدينة نصر', sender_area: 'الحي السابع', sender_street: 'شارع تجريبي 1' };
  window.__JT_PCA = [{ id:1, prov:'القاهرة', city:'مدينة نصر', area:'' }, { id:2, prov:'الجيزة', city:'الدقي', area:'' }];
  window.__STOCK = [
    { id:'s1', name:${JSON.stringify(KITCHEN)}, current_qty:10, unit_price:1450, wholesale_price:900, active:true, tenant_id:'t-test-1', parent_id:null, variant_label:null },
    { id:'s2', name:${JSON.stringify(TURBO)}, current_qty:10, unit_price:1560, wholesale_price:800, active:true, tenant_id:'t-test-1', parent_id:null, variant_label:null }
  ];
  window.__STAFF = []; window.__FETCH_BODIES = [];
  window.__RPC_HOOK = function(name, args){
    if(name !== 'create_staff_order') return null;
    window.__STAFF.push(JSON.parse(JSON.stringify(args)));
    if(window.__STAFF_REPLY) return { data: window.__STAFF_REPLY, error: null };
    var base = (window.__ORDERS || []).filter(function(x){ return x.id === 'o3'; })[0];
    var row = Object.assign({}, base, { id:'new' + window.__STAFF.length, order_uid:'W-4' + window.__STAFF.length, status:'confirmed', tracking_no:null,
      customer_name: args.p_customer_name, phone: args.p_phone, product_name: args.p_items.map(function(i){ return i.name + ' (عدد ' + i.qty + ')'; }).join('\\n+ '),
      total_cost: args.p_total, exchange_of: args.p_exchange_of || null, customer_notes: args.p_customer_notes, internal_notes: null, created_at: new Date().toISOString() });
    window.__ORDERS.unshift(row);
    return { data: { ok:true, order_id: row.id, order_uid: row.order_uid, status:'confirmed', total_cost: args.p_total }, error:null };
  };
  (function(){ var of = window.fetch; window.fetch = function(u, init){
    if(String(u).indexOf('/functions/v1/jt-ship') >= 0){
      var body = JSON.parse(init.body); window.__FETCH_BODIES.push(body);
      return Promise.resolve(new Response(JSON.stringify({ ok:true, tracking_no:'JEG000000000001', sorting_code:'20,X', record:{ status:'BOSTA AUTO' } }), { status: 200, headers:{ 'Content-Type':'application/json' } }));
    }
    return of.apply(this, arguments);
  }; })();
`;
const POST = `
  (function(){
    var o1 = window.__ORDERS.filter(function(x){ return x.id === 'o1'; })[0];   // delivered TRK001 1000
    o1.platform = 'ig'; o1.ship_prov = 'القاهرة'; o1.ship_city = 'مدينة نصر'; o1.ship_area = 'الحي العاشر'; o1.shipping_weight_kg = 2;
    var o3 = window.__ORDERS.filter(function(x){ return x.id === 'o3'; })[0];   // pending بدون بوليصة
    o3.customer_notes = ${JSON.stringify(CUST_NOTE)}; o3.internal_notes = ${JSON.stringify(SECRET)}; o3.city = 'القاهره';
    var o4 = window.__ORDERS.filter(function(x){ return x.id === 'o4'; })[0];   // استبدال لـo1
    o4.exchange_of = 'o1';
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

async function openApp(patches, viewport){
  const ctx = await b.newContext({ viewport: viewport || { width:1440, height:1100 } });
  await ctx.route('**/data/jt-areas.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ 'القاهرة': { 'مدينة نصر': ['الحي الثامن'] } }) }));
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
  await p.evaluate(() => { const ov = document.getElementById('ovl'); if(ov) ov.classList.remove('open'); });
  await p.evaluate((id) => { const tr = document.querySelector('#tbody tr[data-id="' + id + '"]'); if(tr) tr.click(); }, id);
  await p.waitForFunction((id) => document.querySelector('#dcnt .dsec') && window.__lastDetail !== undefined || true, id);
  await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
  await p.waitForTimeout(350);
}
const toastTxt = p => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
// الموظف بيسكرول للزرار قبل ما يدوس — الفحص بيعمل نفس الحاجة (elementFromPoint بإحداثيات الشاشة).
// ⚠️ behavior:'instant' إلزامي: الصفحة عليها scroll-behavior:smooth، فالسكرول العادي بيتحرك بأنيميشن
// والقياس اللي بعده على طول بيحصل قبل ما يوصل (A9 وقع كذب بالسبب ده — الزرار كان سليم)
const hit = (p, sel) => p.evaluate((sel) => { const el = document.querySelector(sel); if(!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); if(!r.width) return false; const t = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return !!t && (t === el || el.contains(t)); }, sel);
async function pickRow(p, idx, name, qty, price){
  const rows = await p.$$('#of-items .of-row');
  const row = rows[idx];
  await (await row.$('.of-prod')).selectOption(name);
  if(qty != null) await (await row.$('.of-qty')).fill(String(qty));
  if(price != null) await (await row.$('.of-price')).fill(String(price));
}
async function fillAddr(p){
  await p.waitForFunction(() => document.querySelectorAll('#of-prov option').length > 1);
  await p.selectOption('#of-prov', 'القاهرة');
  await p.selectOption('#of-city', 'مدينة نصر');
  await p.fill('#of-area', 'الحي الثامن');
}

// ════ A) أوردر جديد ════
{
  const p = await openApp();
  ok(await hit(p, '#ord-new-btn'), 'A1) زرار «➕ أوردر جديد» ظاهر في شريط الأوردرات وشايفه الماوس');
  await p.click('#ord-new-btn');
  await p.waitForSelector('#of-modal.open');
  await p.waitForFunction(() => document.querySelectorAll('#of-items .of-row').length === 1);
  ok((await p.$eval('#of-platform', s => s.value)) === 'fb' && await p.isVisible('#of-platform'), 'A2) المنصة ظاهرة وافتراضيها فيسبوك');
  ok(!(await p.isVisible('#of-cod')), 'A2ب) خانة «مبلغ التحصيل» مخفية في الأوردر العادي (الإجمالي = المجموع)');
  // التحقق قبل الإرسال
  await p.click('#of-save');
  ok((await p.textContent('#of-err')).indexOf('اسم العميل') >= 0, 'A3) من غير اسم → «اكتب اسم العميل»');
  await p.fill('#of-name', 'عميلة فيسبوك');
  await p.fill('#of-phone', '02123456789');
  await p.click('#of-save');
  ok((await p.textContent('#of-err')).indexOf('موبايل') >= 0, 'A3ب) رقم أرضي → رفض (نفس egMobile بتاع J&T)');
  await p.fill('#of-phone', '٠١٠١٢٣٤٥٦٧٨');
  await p.fill('#of-addr', 'شارع التحرير عمارة 5 الدور التالت');
  await p.click('#of-save');
  ok((await p.textContent('#of-err')).indexOf('المحافظة') >= 0, 'A3ج) أرقام عربي في الموبايل بتعدّي · من غير عنوان J&T → «كمّل المحافظة…»');
  await fillAddr(p);
  await p.click('#of-save');
  ok((await p.textContent('#of-err')).indexOf('منتج') >= 0, 'A3د) من غير منتج → رفض');
  await pickRow(p, 0, KITCHEN, 2, null);
  ok((await p.$eval('#of-items .of-row .of-price', i => i.value)) === '1450', 'A4) سعر المنتج اتملى من المخزون (1450)');
  await p.click('#of-add');
  await pickRow(p, 1, TURBO, 1, 1500);
  ok((await p.textContent('#of-sum')).indexOf('4,400') >= 0, 'A4ب) الإجمالي = 1450×2 + 1500 = 4,400 — «' + await p.textContent('#of-sum') + '»');
  await p.fill('#of-note', CUST_NOTE);
  await p.click('#of-save');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('cmodal-backdrop')).display !== 'none');
  ok((await p.textContent('#cmodal-sub')).indexOf('4,400') >= 0, 'A5) مودال التأكيد فيه المبلغ اللي هيتحصّل');
  await p.click('#cmodal-ok');
  await p.waitForFunction(() => window.__STAFF.length === 1);
  const a = await p.evaluate(() => window.__STAFF[0]);
  ok(Array.isArray(a.p_items) && a.p_items.length === 2 && a.p_items[0].name === KITCHEN && a.p_items[0].qty === 2 && a.p_items[1].price === 1500, 'A6) الحمولة: items بالأسماء والكميات والأسعار');
  ok(a.p_total === 4400 && a.p_platform === 'fb' && a.p_phone === '01012345678', 'A6ب) p_total = المجموع · المنصة · الموبايل متطبّع 01…');
  ok(a.p_ship_prov === 'القاهرة' && a.p_ship_city === 'مدينة نصر' && a.p_ship_area === 'الحي الثامن' && a.p_weight === 1, 'A6ج) عنوان J&T والوزن في الحمولة');
  ok(a.p_customer_notes === CUST_NOTE && a.p_exchange_of === null, 'A6د) الملاحظة في customer_notes · مش استبدال');
  ok(!('p_tenant_id' in a) && !('tenant_id' in a) && !('p_status' in a) && !('status' in a), 'A6هـ) مفيش tenant_id ولا status في الحمولة — السيرفر بيقررهم');
  await p.waitForFunction(() => !document.querySelector('#of-modal.open'));
  ok(/W-41/.test(await toastTxt(p)), 'A7) toast برقم الأوردر الجديد — «' + await toastTxt(p) + '»');
  await p.waitForFunction(() => /W-41/.test((document.getElementById('dtit') || {}).textContent || '') || /W-41/.test((document.getElementById('dcnt') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(/W-41/.test(await p.textContent('#dtit') + await p.textContent('#dcnt')), 'A7ب) التفاصيل اتفتحت على الأوردر الجديد (عشان «🚚 شحن J&T» على طول)');
  // رفض السيرفر
  await p.evaluate(() => { document.getElementById('ovl').classList.remove('open'); window.__STAFF_REPLY = { ok:false, error:'unknown_product', name:'منتج قديم' }; });
  await p.click('#ord-new-btn');
  await p.waitForSelector('#of-modal.open');
  await p.waitForFunction(() => document.querySelectorAll('#of-items .of-row').length === 1);
  await p.fill('#of-name', 'س'); await p.fill('#of-phone', '01111111111'); await p.fill('#of-addr', 'عنوان طويل كفاية للتجربة');
  await fillAddr(p); await pickRow(p, 0, KITCHEN, 1, null);
  await p.click('#of-save'); await p.click('#cmodal-ok');
  await p.waitForFunction(() => document.getElementById('of-err').textContent.length > 0);
  const e8 = await p.textContent('#of-err');
  ok(e8.indexOf('المخزون') >= 0 && e8.indexOf('منتج قديم') >= 0 && e8.indexOf('unknown_product') < 0, 'A8) رفض السيرفر بالعربي ومعاه اسم المنتج — «' + e8 + '»');
  ok(await p.isVisible('#of-modal') && !(await p.$eval('#of-save', b => b.disabled)), 'A8ب) الفورم فضلت مفتوحة بالبيانات والزرار رجع يشتغل');
  await p.context().close();
}
// موبايل
{
  const p = await openApp(null, { width:390, height:844 });
  ok(await hit(p, '#ord-new-btn'), 'A9) الزرار شايفه الماوس على الموبايل 390');
  await p.click('#ord-new-btn');
  await p.waitForSelector('#of-modal.open');
  const fit = await p.evaluate(() => { const r = document.querySelector('#of-modal .of-box').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; });
  ok(fit, 'A9ب) الفورم جوّه عرض الشاشة على الموبايل');
  await p.context().close();
}

// ════ B) الاستبدال ════
async function scenarioExchangeBtn(p){
  await openDetail(p, 'o3');
  const onPending = !!(await p.$('#da-ex'));
  await openDetail(p, 'o1');
  const onDelivered = !!(await p.$('#da-ex'));
  return { onPending, onDelivered };
}
{
  const p = await openApp();
  const s = await scenarioExchangeBtn(p);
  ok(s.onDelivered && !s.onPending, 'B1) «🔁 طلب استبدال» على أوردر اتشحن/اتسلّم بس — مش على pending');
  ok(await hit(p, '#da-ex'), 'B1ب) الزرار شايفه الماوس');
  await p.click('#da-ex');
  await p.waitForSelector('#of-modal.open');
  await p.waitForFunction(() => document.querySelectorAll('#of-items .of-row').length === 1);
  ok((await p.textContent('#of-ttl')).indexOf('9001') >= 0 && (await p.textContent('#of-sub')).indexOf('منتج أ') >= 0, 'B2) العنوان فيه رقم الأصلي والمنتجات القديمة ظاهرة');
  ok((await p.$eval('#of-phone', i => i.value)) === '01000000001' && (await p.$eval('#of-addr', i => i.value)).length > 5, 'B2ب) بيانات العميل متعبّية من الأصلي');
  ok(!(await p.isVisible('#of-platform')) && await p.isVisible('#of-cod'), 'B2ج) المنصة مخفية (بتتورث) وخانة مبلغ التحصيل ظاهرة');
  ok((await p.$eval('#of-note', t => t.value)).indexOf('استبدال لأوردر #9001') >= 0, 'B2د) الملاحظة الافتراضية بتقول استبدال لأوردر كام');
  await p.waitForFunction(() => document.getElementById('of-prov').value === 'القاهرة');
  ok((await p.$eval('#of-city', s => s.value)) === 'مدينة نصر' && (await p.$eval('#of-area', i => i.value)) === 'الحي العاشر', 'B2هـ) عنوان J&T من الأصلي');
  await pickRow(p, 0, TURBO, 1, null);
  ok((await p.$eval('#of-cod', i => i.value)) === '560', 'B3) المبلغ الافتراضي = فرق السعر 1560 − 1000 = 560');
  await p.fill('#of-cod', '300');
  await (await p.$('#of-items .of-row .of-qty')).fill('2');
  await p.waitForTimeout(100);
  ok((await p.$eval('#of-cod', i => i.value)) === '300', 'B3ب) المبلغ اللي الموظف كتبه مابيتمسحش لما المنتجات تتغيّر');
  await p.click('#of-save'); await p.click('#cmodal-ok');
  await p.waitForFunction(() => window.__STAFF.length === 1);
  const a = await p.evaluate(() => window.__STAFF[0]);
  ok(a.p_exchange_of === 'o1' && a.p_total === 300 && a.p_platform === null, 'B4) الحمولة: p_exchange_of = الأصلي · p_total = المكتوب · من غير منصة');
  await p.context().close();
}
{
  // ربط الاستبدال في التفاصيل + الشارة في الجدول
  const p = await openApp();
  const badge = await p.$eval('#tbody tr[data-id="o4"] td.id', td => td.textContent.indexOf('🔁') >= 0).catch(() => false);
  ok(badge, 'B5) شارة 🔁 على أوردر الاستبدال في الجدول');
  await openDetail(p, 'o4');
  await p.waitForFunction(() => { const e = document.getElementById('ex-links'); return e && e.style.display !== 'none'; }, null, { timeout: 5000 }).catch(() => {});
  const t = await p.textContent('#ex-links');
  ok(t.indexOf('استبدال') >= 0 && t.indexOf('#9001') >= 0, 'B6) تفاصيل الاستبدال: «الأوردر ده استبدال لأوردر #9001» — «' + t.trim() + '»');
  ok(t.indexOf('اتعمله استبدال') < 0, 'B6ب) أوردر مالوش استبدالات مايظهرش فيه «اتعمله استبدال» (الستب بيطبّق exchange_of فعلاً)');
  await p.click('#ex-links .ex-link');
  await p.waitForFunction(() => (document.getElementById('dcnt').textContent || '').indexOf('اتعمله استبدال') >= 0, null, { timeout: 6000 }).catch(() => {});
  const t7 = await p.textContent('#ex-links');
  ok(t7.indexOf('اتعمله استبدال') >= 0 && t7.indexOf('#9004') >= 0 && t7.indexOf('#9002') < 0, 'B7) اللينك بيفتح الأصلي وفيه «اتعمله استبدال: #9004» بس — «' + t7.trim() + '»');
  await p.context().close();
}

// ════ C) نافذة J&T — ملاحظة البوليصة ════
async function scenarioShipNote(p){
  await openDetail(p, 'o3');
  await p.click('#ship-auto');
  await p.waitForSelector('#jt-modal.open');
  await p.waitForFunction(() => !document.getElementById('jt-go').disabled);
  return { val: await p.$eval('#jt-note-in', t => t.value), prev: await p.textContent('#jt-cod') };
}
{
  const p = await openApp();
  const s = await scenarioShipNote(p);
  ok(s.val === CUST_NOTE, 'C1) خانة «ملاحظة على البوليصة» متعبّية من ملاحظة العميل');
  ok(s.prev.indexOf('ملاحظة: ' + CUST_NOTE) >= 0, 'C1ب) المعاينة فيها سطر الملاحظة زي ما هيتبعت');
  ok(s.val.indexOf(SECRET) < 0 && s.prev.indexOf(SECRET) < 0, 'C1ج) 🔴 الملاحظة الداخلية مش في الخانة ولا في المعاينة');
  await p.fill('#jt-note-in', 'الدور ٢ شقة ٦');
  ok((await p.textContent('#jt-cod')).indexOf('ملاحظة: الدور ٢ شقة ٦') >= 0, 'C2) تعديل الملاحظة بيحدّث المعاينة لحظياً');
  await p.selectOption('#jt-city', 'مدينة نصر');
  await p.fill('#jt-area', 'الحي الثامن');
  await p.click('#jt-go');
  await p.waitForFunction(() => window.__FETCH_BODIES.length === 1);
  ok((await p.evaluate(() => window.__FETCH_BODIES[0].note)) === 'الدور ٢ شقة ٦', 'C3) الملاحظة المعدّلة في حمولة jt-ship');
  await p.context().close();
}

// ════ D) البوليصة المطبوعة ════
async function scenarioAwb(p){
  return p.evaluate(async () => {
    const m = await import('./js/orders/jt-awb.js');
    const snap = m.jtRemarkLines({ product_name: 'منتج اتعدّل بعد الشحن (عدد 3)', manufacturer_note: '', jt_remark: 'منتج أ (عدد 1)\nملاحظة: الاتصال قبل الوصول' });
    const old = m.jtRemarkLines({ product_name: 'منتج أ (عدد 1)\n+ منتج ب (عدد 2)', manufacturer_note: 'أبيض ' });
    return { snap, old };
  });
}
{
  const p = await openApp();
  const r = await scenarioAwb(p);
  ok(r.snap.join('|') === 'منتج أ (عدد 1)|ملاحظة: الاتصال قبل الوصول', 'D1) البوليصة بتطبع jt_remark (اللي اتبعت لـJ&T) بالحرف — مش الصف بعد التعديل');
  ok(r.old.join('|') === 'منتج أ (عدد 1)|منتج ب (عدد 2)|أبيض', 'D2) أوردر قديم من غير jt_remark = نفس السطور القديمة بالظبط');
  await p.context().close();
}

// ════ E) المعايرات ════
console.log('\n  المعايرات:');
{
  const p = await openApp([['order-form.js', "return !!o && st !== 'pending' && st !== 'confirmed' && st !== 'cancelled';", 'return !!o;']]);
  const s = await scenarioExchangeBtn(p);
  ok(s.onPending, 'معايرة أ) زرار الاستبدال على أي أوردر → فحص B1 بيقع');
  await p.context().close();
}
{
  const p = await openApp([['order-form.js', 'p_exchange_of: f.ex ? st.orig.id : null', 'p_exchange_of: null']]);
  await openDetail(p, 'o1'); await p.click('#da-ex');
  await p.waitForSelector('#of-modal.open'); await p.waitForFunction(() => document.querySelectorAll('#of-items .of-row').length === 1);
  await p.waitForFunction(() => document.getElementById('of-prov').value === 'القاهرة');
  await pickRow(p, 0, TURBO, 1, null);
  await p.click('#of-save'); await p.click('#cmodal-ok');
  await p.waitForFunction(() => window.__STAFF.length === 1);
  ok((await p.evaluate(() => window.__STAFF[0].p_exchange_of)) !== 'o1', 'معايرة ب) شيل p_exchange_of → فحص B4 بيقع');
  await p.context().close();
}
{
  const p = await openApp([['ship.js', "noteIn.value = ord.ship_note != null && String(ord.ship_note).trim() ? ord.ship_note : (ord.customer_notes || '');", "noteIn.value = ord.internal_notes || '';"]]);
  const s = await scenarioShipNote(p);
  ok(s.val.indexOf(SECRET) >= 0, 'معايرة ج) الملاحظة من الداخلية → فحص C1ج بيقع');
  await p.context().close();
}
{
  const p = await openApp([['jt-awb.js', "if(snap.trim()) return snap.split('\\n')", "if(false) return snap.split('\\n')"]]);
  const r = await scenarioAwb(p);
  ok(r.snap.join('|') !== 'منتج أ (عدد 1)|ملاحظة: الاتصال قبل الوصول', 'معايرة د) الطباعة بتتجاهل jt_remark → فحص D1 بيقع');
  await p.context().close();
}
{
  const p = await openApp([['order-form.js', 'if(!ofState.codTouched) $id(\'of-cod\').value = String(diff);', "$id('of-cod').value = String(diff);"]]);
  await openDetail(p, 'o1'); await p.click('#da-ex');
  await p.waitForSelector('#of-modal.open'); await p.waitForFunction(() => document.querySelectorAll('#of-items .of-row').length === 1);
  await pickRow(p, 0, TURBO, 1, null);
  await p.fill('#of-cod', '300');
  await (await p.$('#of-items .of-row .of-qty')).fill('2');
  await p.waitForTimeout(100);
  ok((await p.$eval('#of-cod', i => i.value)) !== '300', 'معايرة هـ) المبلغ المكتوب بيتمسح → فحص B3ب بيقع');
  await p.context().close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✓ كله عدّى');
process.exit(bad ? 1 : 0);
