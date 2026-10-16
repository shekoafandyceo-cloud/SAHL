// زرار الشحن من نافذة التفاصيل — بعد شيل مسار بوسطة الأوتوماتيك (v80 — قرار المالك).
//
// النطاق: الواجهة. حراسات السيرفر اتجرّبت لوحدها:
//   - mark_shipped_manual: ترانزاكشن راجعة بانتحال موظف حقيقي مش سوبر
//     (عبور مرفوض · already_has_tracking · bad_status · التتبع بيتسجل)
//   - jt-ship: test-jt-ship.mjs (النافذة · الحمولة · الفشل وعلامته)
//
// اللي بيتأكد هنا:
//  1) تاجر مش J&T (shipping_provider='bosta' — الستب الافتراضي) = مفيش زرار أوتوماتيك
//     والنافذة مافيهاش شارة «محاولة ماكملتش» حتى لو صف الأوردر فيه محاولة بوسطة قديمة
//     (shipping_requested_at — بيوصل للنافذة من select('*'))
//  2) اليدوي بيعدّي على mark_shipped_manual بالتتبع المكتوب (وفاضي = null)
//  3) أوردر له بوليصة = ولا زرار
//  4) تاجر J&T = زرار «🚚 شحن J&T»
//  5) زرار 🖨️ في الجدول لأوردرات J&T بس · «حدد غير المطبوع» J&T بس · الطباعة الجماعية
//     لأوردر مش J&T بتقول السبب · اختيار مخلوط بيطبع J&T بس ويقول كام اتساب · مفيش
//     نداء لـbosta-print-awb
//  6) التيكر بيتابع شحنات J&T اللي في السكة بس — صامت لحد ما الحالة تتغيّر
//  7) معايرات: رجوع زرار الأوتوماتيك لغير J&T · زرار الطباعة لكل صف · التيكر بيراقب اللي من غير بوليصة
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const SHIP_SRC = fs.readFileSync(new URL('../app/js/orders/ship.js', import.meta.url), 'utf8');
const TABLE_SRC = fs.readFileSync(new URL('../app/js/orders/table.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

// كل نداء Edge Function بيتسجّل (الستب بيعترضه لما __FN متعرّفة) — عشان نثبت إن
// order-ship وbosta-print-awb عمرهم ما بيتندهوا
const FN_SPY = `window.__FN = function(slug, body){ return { status: 404, body: { message: 'مش متوقع: ' + slug } }; };`;

// عميل مشترك: يفتح صفحة بستب + هوكات. patch = {path, body} لموديول متعدّل (المعايرات)
async function openApp(extra){
  extra = extra || {};
  const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  if(extra.patch) for(const pt of extra.patch)
    await p.route('**/js/orders/' + pt.file, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: pt.body }));
  await p.addInitScript(FN_SPY + (extra.pre || ''));
  await p.addInitScript(STUB);
  await p.addInitScript(`
    window.__RPC = [];
    (function(){
      var mk = window.supabase.createClient;
      window.supabase.createClient = function(){
        var c = mk.apply(this, arguments), orig = c.rpc.bind(c);
        c.rpc = function(name, args){
          window.__RPC.push({ name: name, args: args });
          if(name === 'mark_shipped_manual'){
            // محاكاة كتابة السيرفر: أي refetch بعده (doFilter) لازم يرجّع الحالة الجديدة
            var row = (window.__ORDERS || []).filter(function(o){ return o.id === (args && args.p_order_id); })[0];
            if(row){ row.status = 'bosta_assigned'; if(args.p_tracking) row.tracking_no = args.p_tracking; }
            return Promise.resolve({ data:{ ok:true }, error:null });
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

async function openDetailOf(p, orderId){
  await p.evaluate((id) => {
    const tr = document.querySelector('#tbody tr[data-id="' + id + '"]');
    if(tr) tr.click();
  }, orderId);
  await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
  await p.waitForTimeout(250);
}

const fnSlugs = (p) => p.evaluate(() => (window.__FNCALLS || []).map(c => c.slug));

// ════ 1) تاجر مش J&T — مفيش أوتوماتيك خالص ════
async function bostaTenantCheck(label, extra){
  const p = await openApp(Object.assign({ pre: `
    // محاولة بوسطة قديمة من غير بوليصة (زي أوردرات سبتمبر) — كانت بتعمل شارة «ماكملتش» للأبد.
    // الجدول مابقاش بيطلب العمود، فبيوصل لنافذة التفاصيل بس (select('*'))
    window.__SHIP_REQS = { o3: new Date(Date.now() - 3*86400000).toISOString() };
  ` }, extra || {}));
  await openDetailOf(p, 'o3');
  const st = await p.evaluate(async () => {
    const os = await import('./js/orders/state.js');
    return {
      auto: !!document.getElementById('ship-auto'),
      manual: !!document.getElementById('da-bs'),
      manualTxt: (document.getElementById('da-bs') || {}).textContent || '',
      chip: !!document.getElementById('ship-chip'),
      selReq: !!(os.sel && os.sel.shipping_requested_at)
    };
  });
  await p.close();
  return { st };
}
{
  console.log('──── تاجر مش J&T ────');
  const r = await bostaTenantCheck();
  ok(!r.st.auto, 'مفيش زرار «شحن أوتوماتيك» — مسار بوسطة اتشال');
  ok(r.st.manual && /يدوي/.test(r.st.manualTxt), `وزرار اليدوي موجود — «${r.st.manualTxt.trim()}»`);
  // الفحص اللي بعده مايبقاش أعمى: المحاولة القديمة لازم تكون وصلت النافذة فعلاً
  ok(r.st.selReq, 'الأوردر المفتوح فيه محاولة بوسطة قديمة (shipping_requested_at وصل النافذة)');
  ok(!r.st.chip, 'ومع ذلك مفيش شارة «محاولة ماكملتش» جوّه النافذة');
}

// ════ 2) المسار اليدوي — التتبع بيتسجل عبر الـRPC ════
{
  const p = await openApp({});
  console.log('──── اليدوي ────');
  await openDetailOf(p, 'o3');
  await p.click('#da-bs');
  await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
  const m = await p.evaluate(() => ({
    sub: (document.getElementById('cmodal-sub')||{}).textContent || '',
    inputShown: getComputedStyle(document.getElementById('cmodal-input-wrap')).display !== 'none'
  }));
  ok(/من غير ما نبعت حاجة لشركة الشحن/.test(m.sub), 'المودال بيوضّح إن مفيش حاجة بتتبعت للشركة');
  ok(m.inputShown, 'وحقل رقم التتبع (الاختياري) ظاهر');
  await p.fill('#cmodal-input', '  TRK-MANUAL-77  ');
  await p.click('#cmodal-ok');
  await p.waitForTimeout(500);
  const rpc = await p.evaluate(() => (window.__RPC || []).filter(c => c.name === 'mark_shipped_manual').pop());
  ok(!!rpc, 'اتنده mark_shipped_manual');
  ok(rpc && rpc.args.p_order_id === 'o3' && rpc.args.p_tracking === 'TRK-MANUAL-77',
     `بالأوردر والتتبع (من غير مسافات) — ${JSON.stringify(rpc && [rpc.args.p_order_id, rpc.args.p_tracking])}`);
  const after = await p.evaluate(async () => {
    const st = await import('./js/orders/state.js');
    const inFil = (st.fil || []).filter(x => x.id === 'o3')[0] || {};
    return {
      row: { status: inFil.status, tracking_no: inFil.tracking_no },
      toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')
    };
  });
  ok(after.row.status === 'bosta_assigned' && after.row.tracking_no === 'TRK-MANUAL-77',
     `صف الجدول (fil) اتحدّث — ${after.row.status} / ${after.row.tracking_no}`);
  ok(/اتسجل/.test(after.toast), 'والرسالة بتأكد تسجيل التتبع');
  // «الموظف يدوس ويمشي» — نافذة التفاصيل لازم تتقفل مع التأكيد
  // (باج المالك 15 أغسطس: كانت بتفضل مفتوحة على نفس الأوردر)
  const ovlOpen = await p.evaluate(() => document.getElementById('ovl').classList.contains('open'));
  ok(!ovlOpen, 'نافذة التفاصيل اتقفلت ورجّعتنا للجدول');
  await p.close();
}

// ════ 2ب) اليدوي من غير تتبع — «اختياري» يعني اختياري ════
// (باج المالك 8 أغسطس: المودال العام كان بيرفض أي خانة فاضية ويحمّرها)
{
  const p = await openApp({});
  console.log('──── اليدوي من غير رقم تتبع ────');
  await openDetailOf(p, 'o3');
  await p.click('#da-bs');
  await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
  await p.click('#cmodal-ok');            // الخانة فاضية عمداً
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({
    open: getComputedStyle(document.getElementById('cmodal-backdrop')).display !== 'none',
    red: ((document.getElementById('cmodal-input')||{}).style||{}).borderColor || '',
    rpc: (window.__RPC || []).filter(c => c.name === 'mark_shipped_manual').pop()
  }));
  ok(!r.open, 'المودال قبل الفاضي واتقفل');
  ok(r.red === '', `والخانة ماتحمّرتش — «${r.red}»`);
  ok(r.rpc && r.rpc.args.p_order_id === 'o3' && r.rpc.args.p_tracking === null,
     `والـRPC اتنده بتتبع null — ${JSON.stringify(r.rpc && [r.rpc.args.p_order_id, r.rpc.args.p_tracking])}`);
  const row = await p.evaluate(async () => {
    const st = await import('./js/orders/state.js');
    return (st.fil || []).filter(x => x.id === 'o3')[0] || {};
  });
  ok(row.status === 'bosta_assigned' && !row.tracking_no,
     `والأوردر اتعلّم «شحن» من غير تتبع — ${JSON.stringify([row.status, row.tracking_no || null])}`);
  const ovlOpen2 = await p.evaluate(() => document.getElementById('ovl').classList.contains('open'));
  ok(!ovlOpen2, 'ونافذة التفاصيل اتقفلت هنا كمان');
  await p.close();
}

// ════ 3) أوردر له بوليصة = ولا زرار ════
{
  const p = await openApp({ pre: `window.__TENANT = { shipping_provider: 'jt' };` });
  console.log('──── أوردر له بوليصة ────');
  await openDetailOf(p, 'o1');   // delivered + TRK001
  const none = await p.evaluate(() => ({
    auto: !!document.getElementById('ship-auto'),
    manual: !!document.getElementById('da-bs')
  }));
  ok(!none.auto && !none.manual, 'مفيش ولا زرار شحن — بوليصة واحدة بس (حتى لتاجر J&T)');
  await p.close();
}

// ════ 4) تاجر J&T = زرار «🚚 شحن J&T» ════
{
  const p = await openApp({ pre: `window.__TENANT = { shipping_provider: 'jt' };` });
  console.log('──── تاجر J&T ────');
  await openDetailOf(p, 'o3');
  const st = await p.evaluate(() => ({
    txt: (document.getElementById('ship-auto') || {}).textContent || '',
    manual: !!document.getElementById('da-bs')
  }));
  ok(/J&T/.test(st.txt), `زرار «شحن J&T» ظاهر — «${st.txt.trim()}»`);
  ok(st.manual, 'واليدوي جنبه');
  await p.close();
}

// ════ 5) طباعة البوالص — J&T بس ════
async function printCheck(extra){
  extra = extra || {};
  // الـpre بتاع الحالة بيتضاف على الأساسي (مش بيستبدله)
  const p = await openApp(Object.assign({}, extra, { pre: `
    window.__TENANT = { shipping_provider: 'jt' };
    window.__PROPS = { o1: { shipping_carrier: 'jt' } };   // o1 بوليصة J&T · o2 بوليصة قديمة من غير شركة
  ` + (extra.pre || '') }));
  const r = await p.evaluate(() => ({
    jtBtn: !!document.querySelector('#tbody tr[data-id="o1"] .awb-btn'),
    oldBtn: !!document.querySelector('#tbody tr[data-id="o2"] .awb-btn'),
    oldTrk: (document.querySelector('#tbody tr[data-id="o2"] .awb-cell') || {}).textContent || ''
  }));
  return { p, r };
}
async function unprintedCheck(p){
  return p.evaluate(async () => {
    document.getElementById('fst').value = '__operation__';   // من غير change — بنحسب على الصفحة المعروضة
    const t = await import('./js/orders/table.js');
    t.updateUnprintedBtn();
    const btn = document.getElementById('bb-sel-unprinted');
    const txt = btn.textContent;
    btn.click();
    const st = await import('./js/orders/state.js');
    const sel = [...st.selectedIds].sort();
    document.getElementById('fst').value = '';
    return { txt, sel };
  });
}
{
  console.log('──── طباعة البوالص ────');
  const { p, r } = await printCheck();
  ok(r.jtBtn, 'زرار 🖨️ على صف بوليصة J&T');
  ok(!r.oldBtn, 'ومفيش زرار على صف بوليصة قديمة — زرار مابيعملش حاجة أسوأ من مفيش زرار');
  ok(/TRK002/.test(r.oldTrk), 'ورقم التتبع القديم لسه ظاهر');
  // «✓ حدد غير المطبوع» بيعدّ ويحدد بوالص J&T بس — بوليصة قديمة لو اتحددت مابتتطبعش
  // فكانت هتفضل «غير مطبوعة» للأبد (o1 = J&T · o2/o4/o5 = بوالص قديمة)
  const un = await unprintedCheck(p);
  ok(/\(1\)/.test(un.txt), `«حدد غير المطبوع» بيعدّ بوليصة J&T بس — «${un.txt}»`);
  ok(JSON.stringify(un.sel) === '["o1"]', `وبيحدد J&T بس — ${JSON.stringify(un.sel)}`);
  await p.evaluate(async () => { const st = await import('./js/orders/state.js'); st.selectedIds.clear(); });
  // الطباعة الجماعية لأوردر مش J&T: رسالة بالسبب ومفيش نداء لـbosta-print-awb
  // (الستب بيطبّق `.in('id', …)` زي PostgREST — o1 اللي مش مختار مابيرجعش)
  await p.click('#tbody tr[data-id="o2"] .cb-row');
  await p.waitForSelector('#bb-print', { state:'visible' });
  await p.click('#bb-print');
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /J&T/.test(t.textContent)), { timeout: 5000 }).catch(() => {});
  const after = await p.evaluate(() => ({
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '),
    btnOn: !document.getElementById('bb-print').disabled
  }));
  const slugs = await fnSlugs(p);
  ok(/مالوش بوليصة J&T/.test(after.toast), `رسالة بالسبب — «${after.toast.slice(0, 90)}»`);
  ok(!slugs.includes('bosta-print-awb'), `ومفيش نداء لـbosta-print-awb — ${JSON.stringify(slugs)}`);
  ok(after.btnOn, 'وزرار الطباعة رجع شغّال بعدها');
  await p.close();
}
{
  // اختيار مخلوط: o1 (J&T) + o2 (قديمة) → قالب J&T بيتطلب لـo1 بس ورسالة إن 1 اتساب.
  // ⚠️ window.open = null: الخطوط مابتوصلش نافذة document.write في الهارنس فـdoc.fonts.ready
  // بيعلّق والطباعة مابترجعش (درس v77) — كده printJtAwb بترجع بعد ما تطلب الصفوف
  const { p } = await printCheck({ pre: `window.open = function(){ return null; };` });
  await p.click('#tbody tr[data-id="o1"] .cb-row');
  await p.click('#tbody tr[data-id="o2"] .cb-row');
  await p.waitForSelector('#bb-print', { state:'visible' });
  await p.click('#bb-print');
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /مالوش بوليصة J&T/.test(t.textContent)), { timeout: 12000 }).catch(() => {});
  const mixed = await p.evaluate(() => {
    const awb = (window.__calls || []).filter(c => c.table === 'orders' && /jt_sorting_code/.test(String(c.cols || '')) && (c.f || []).some(f => f.op === 'in' && f.col === 'id'));
    return {
      printed: awb.length ? [...new Set(awb.flatMap(c => c.f.filter(f => f.op === 'in' && f.col === 'id').flatMap(f => f.val)))].sort() : null,
      toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')
    };
  });
  ok(JSON.stringify(mixed.printed) === '["o1"]', `اختيار مخلوط: قالب J&T اتطلب لـo1 بس — ${JSON.stringify(mixed.printed)}`);
  ok(/1 أوردر مالوش بوليصة J&T/.test(mixed.toast), `ورسالة إن أوردر واحد اتساب — «${mixed.toast.slice(0, 120)}»`);
  await p.context().close();
}

// ════ 6) التيكر: شحنات J&T اللي في السكة بس — صامت لحد التغيير ════
async function tickerWatch(extra){
  const p = await openApp(Object.assign({ pre: `
    window.__SHIP_TICK_MS = 700;
    window.__TENANT = { shipping_provider: 'jt' };
    // o2 = شحنة J&T لسه في السكة · o3 = pending من غير بوليصة (المفروض التيكر يطنّشه)
    window.__PROPS = { o2: { shipping_carrier: 'jt' } };
  `}, extra || {}));
  await p.evaluate(() => {
    window.__renders = 0;
    new MutationObserver(function(){ window.__renders++; })
      .observe(document.getElementById('tbody'), { childList: true, subtree: false });
  });
  await p.waitForTimeout(2600);   // ~3 تيكات
  const quiet = await p.evaluate(() => {
    const tick = (window.__calls || []).filter(c => c.table === 'orders'
      && String(c.cols || '').indexOf('id,status,tracking_no,carrier_status_raw') === 0);
    return { renders: window.__renders, asked: tick.length,
             ids: [...new Set(tick.flatMap(c => (c.f || []).filter(f => f.op === 'in' && f.col === 'id').flatMap(f => f.val || [])))].sort() };
  });
  return { p, quiet };
}
{
  console.log('──── التيكر ────');
  const { p, quiet } = await tickerWatch();
  ok(quiet.asked >= 2, `التيكر بيسأل السيرفر عن شحنة J&T اللي في السكة — ${quiet.asked} استعلام`);
  ok(JSON.stringify(quiet.ids) === '["o2"]', `وبيراقب شحنة J&T بس — مش أوردر من غير بوليصة ولا متقفل — ${JSON.stringify(quiet.ids)}`);
  ok(quiet.renders === 0, `ومفيش إعادة رسم للجدول من غير تغيير — ${quiet.renders}`);
  // الشحنة اتسلّمت على السيرفر (ريل-تايم ضاع) — التيكر بيلقطها
  await p.evaluate(() => { const o = (window.__ORDERS || []).filter(x => x.id === 'o2')[0]; if(o) o.status = 'Delivered'; });
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /9002/.test(t.textContent)), { timeout: 5000 }).catch(() => {});
  const moved = await p.evaluate(() => ({
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '),
    renders: window.__renders
  }));
  ok(/9002/.test(moved.toast) && /بقى/.test(moved.toast), `والتغيير وصل برسالة — «${moved.toast.slice(0, 80)}»`);
  ok(moved.renders >= 1, 'والجدول اترسم مع التغيير الفعلي بس');
  await p.close();
}

// ════ 7) معايرات ════
{
  console.log('──── معايرات ────');
  // (أ) زرار الشحن يرجع يبان لغير J&T → فحص (1) لازم يقع
  const A = "if(shippable(o) && isJt()){";
  if(SHIP_SRC.split(A).length !== 2) throw new Error('المعايرة (أ) مالقتش المرساة');
  const r = await bostaTenantCheck('', { patch: [{ file: 'ship.js', body: SHIP_SRC.replace(A, 'if(shippable(o)){') }] });
  ok(r.st.auto, 'معايرة (أ): زرار لغير J&T رجع = فحص «مفيش أوتوماتيك» كان هيقع');
  // (ب) زرار الطباعة لكل صف → فحص (5) لازم يقع
  const B = "(o.shipping_carrier==='jt'?'<button class=\"awb-btn\"";
  if(TABLE_SRC.split(B).length !== 2) throw new Error('المعايرة (ب) مالقتش المرساة');
  const { p, r: pr } = await printCheck({ patch: [{ file: 'table.js', body: TABLE_SRC.replace(B, "(true?'<button class=\"awb-btn\"") }] });
  ok(pr.oldBtn, 'معايرة (ب): زرار على البوليصة القديمة = فحص «J&T بس» كان هيقع');
  await p.close();
  // (ب2) «حدد غير المطبوع» يرجع يعدّ أي بوليصة → فحص (5) لازم يقع
  const B2 = "if(o.shipping_carrier === 'jt' && o.tracking_no && String(o.tracking_no).trim() && !(o.awb_print_count > 0)) cnt++;";
  if(TABLE_SRC.split(B2).length !== 2) throw new Error('المعايرة (ب2) مالقتش المرساة');
  const pb = await printCheck({ patch: [{ file: 'table.js', body: TABLE_SRC.replace(B2, "if(o.tracking_no && String(o.tracking_no).trim() && !(o.awb_print_count > 0)) cnt++;") }] });
  const unB = await unprintedCheck(pb.p);
  ok(!/\(1\)/.test(unB.txt), `معايرة (ب2): العدّ لكل البوالص = فحص «J&T بس» كان هيقع — «${unB.txt}»`);
  await pb.p.close();
  // (ج) التيكر يراقب أي أوردر من غير بوليصة (زي ما فرع بوسطة القديم كان بيراقب المحاولات) → فحص (6) لازم يقع
  const C = "if(o.shipping_carrier === 'jt' && (o.tracking_no||'').trim() && !shipmentSettled(o)){";
  if(SHIP_SRC.split(C).length !== 2) throw new Error('المعايرة (ج) مالقتش المرساة');
  const tw = await tickerWatch({ patch: [{ file: 'ship.js', body: SHIP_SRC.replace(C,
    "if((o.shipping_carrier === 'jt' && (o.tracking_no||'').trim() && !shipmentSettled(o)) || (!(o.tracking_no||'').trim() && !shipmentSettled(o))){") }] });
  ok(JSON.stringify(tw.quiet.ids) !== '["o2"]', `معايرة (ج): تيكر بيراقب أوردرات من غير بوليصة = فحص «J&T بس» كان هيقع — ${JSON.stringify(tw.quiet.ids)}`);
  await tw.p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
