// زرار الشحن من نافذة التفاصيل — المسارين.
//
// النطاق: الواجهة. حراسات السيرفر اتجرّبت لوحدها:
//   - mark_shipped_manual: ترانزاكشن راجعة بانتحال موظف حقيقي مش سوبر
//     (عبور مرفوض · already_has_tracking · bad_status · التتبع بيتسجل)
//   - order-ship: الفحوص القبلية جوّه الـEdge Function (منشورة v1)
//
// اللي بيتأكد هنا:
//  1) الأوتوماتيك بيبعت للـEF **من غير tenant_id في الـbody** (الثابت الحاكم)
//  2) الواجهة مابتقولش «اتشحن» غير لما tracking_no يظهر في الصف فعلاً —
//     النجاح بييجي من الـpoll مش من رد الويبهوك
//  3) اليدوي بيعدّي على mark_shipped_manual بالتتبع المكتوب
//  4) أوردر له بوليصة = ولا زرار · تاجر مش رابط API = مفيش أوتوماتيك
//  5) فشل الـEF بيظهر رسالته ومفيش نجاح كاذب
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

// عميل مشترك: يفتح صفحة بستب + هوكات، ويوصل لتفاصيل أوردر معيّن
async function openApp(extra){
  const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  if(extra && extra.pre) await p.addInitScript(extra.pre);
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
            if(window.__MANUAL_ERR) return Promise.resolve({ data:null, error:{ message: window.__MANUAL_ERR } });
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

// ════ 1) تاجر رابط API — المسار الأوتوماتيك كامل ════
{
  const p = await openApp({ pre: `
    // الـEF بترد ok — والحقيقة (التتبع) بتظهر في الصف بعد شوية زي الإنتاج
    window.__FN = function(slug, body){
      if(slug === 'order-ship'){
        setTimeout(function(){
          var o = (window.__ORDERS || []).filter(function(x){ return x.id === body.order_id; })[0];
          if(o){ o.tracking_no = 'TRKAUTO9'; o.status = 'BOSTA AUTO'; }
        }, 1200);
        return { status: 200, body: { ok: true, requested_at: new Date().toISOString() } };
      }
      return { status: 404, body: { message: 'مش معروفة' } };
    };
  `});
  console.log('──── الأوتوماتيك (تاجر رابط API) ────');
  await openDetailOf(p, 'o3');   // pending من غير tracking

  const btns = await p.evaluate(() => ({
    auto: !!document.getElementById('ship-auto'),
    manual: !!document.getElementById('da-bs'),
    manualTxt: (document.getElementById('da-bs')||{}).textContent || ''
  }));
  ok(btns.auto, 'زرار «شحن أوتوماتيك» ظاهر');
  ok(btns.manual && /يدوي/.test(btns.manualTxt), `وزرار اليدوي جنبه — «${btns.manualTxt.trim()}»`);

  // hit-test: الزرار مش مدفون (درس 31/35)
  const hit = await p.evaluate(() => {
    const el = document.getElementById('ship-auto');
    const r = el.getBoundingClientRect();
    if(r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block:'center' });
    const r2 = el.getBoundingClientRect();
    const h = document.elementFromPoint(r2.left + r2.width/2, r2.top + r2.height/2);
    return !!(h && (el === h || el.contains(h)));
  });
  ok(hit, 'الـhit-test: الزرار مكشوف');

  await p.click('#ship-auto');
  await p.waitForSelector('#cmodal-box', { state:'visible', timeout:5000 });
  const conf = await p.evaluate(() => (document.getElementById('cmodal-sub')||{}).textContent || '');
  ok(/بفلوس حقيقية/.test(conf), 'مودال التأكيد بيقول إنها بوليصة حقيقية بفلوس');
  ok(/مش هتتغير غير لما/.test(conf), 'وبيوعد إن الحالة مش هتتغير غير بالبوليصة الفعلية');
  await p.click('#cmodal-ok');
  await p.waitForTimeout(600);

  const call = await p.evaluate(() => (window.__FNCALLS || []).filter(c => c.slug === 'order-ship').pop());
  ok(!!call, 'الـEdge Function اتندهت');
  ok(call && call.body.order_id === 'o3', `بالأوردر الصح — ${call && call.body.order_id}`);
  ok(call && !('tenant_id' in call.body), '🔴 ومفيش tenant_id في الـbody — بييجي من الـJWT بس');
  ok(call && call.auth, 'والـJWT متبعت في الهيدر');

  // قبل ما التتبع يوصل: شارة «بيتبعت...» ومفيش أي نجاح معلن
  const midState = await p.evaluate(() => ({
    chip: ((document.getElementById('ship-chip')||{}).textContent || ''),
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')
  }));
  ok(/بيتبعت لشركة الشحن/.test(midState.chip), 'شارة «بيتبعت...» ظاهرة أثناء الانتظار');
  ok(!/البوليصة اتعملت/.test(midState.toasts), 'ومفيش إعلان نجاح قبل ما التتبع يظهر فعلاً');

  // الـpoll يلقط التتبع (الستب حطه بعد 1.2 ثانية — الـpoll كل 3 ثواني)
  await p.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some(t => /البوليصة اتعملت/.test(t.textContent)),
    { timeout: 15000 });
  const done = await p.evaluate(() => ({
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '),
    rowStatus: ((window.__ORDERS || []).filter(x => x.id === 'o3')[0] || {}).status,
    detailHasTrk: (document.getElementById('dcnt')||{}).textContent.indexOf('TRKAUTO9') >= 0,
    autoGone: !document.getElementById('ship-auto')
  }));
  ok(/TRKAUTO9/.test(done.toast), `النجاح معلن برقم التتبع الحقيقي — ${done.toast.slice(0,60)}`);
  ok(done.detailHasTrk, 'ورقم التتبع ظهر في نافذة التفاصيل');
  ok(done.autoGone, 'وزرار الأوتوماتيك اختفى (الأوردر بقى له بوليصة)');
  await p.close();
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
  const after = await p.evaluate(() => ({
    row: ((window.__ORDERS || []).filter(x => x.id === 'o3')[0] || {}),
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')
  }));
  ok(after.row.status === 'bosta_assigned' && after.row.tracking_no === 'TRK-MANUAL-77',
     `الصف اتحدّث محلياً — ${after.row.status} / ${after.row.tracking_no}`);
  ok(/اتسجل/.test(after.toast), 'والرسالة بتأكد تسجيل التتبع');
  await p.close();
}

// ════ 3) أوردر له بوليصة = ولا زرار ════
{
  const p = await openApp({});
  console.log('──── أوردر له بوليصة ────');
  await openDetailOf(p, 'o1');   // delivered + TRK001
  const none = await p.evaluate(() => ({
    auto: !!document.getElementById('ship-auto'),
    manual: !!document.getElementById('da-bs')
  }));
  ok(!none.auto && !none.manual, 'مفيش ولا زرار شحن — بوليصة واحدة بس');
  await p.close();
}

// ════ 4) تاجر مش رابط API — اليدوي بس ════
{
  const p = await openApp({ pre: `window.__SHIP_API = false;` });
  console.log('──── تاجر من غير API ────');
  await openDetailOf(p, 'o3');
  const st = await p.evaluate(() => ({
    auto: !!document.getElementById('ship-auto'),
    manual: !!document.getElementById('da-bs')
  }));
  ok(!st.auto, 'مفيش زرار أوتوماتيك');
  ok(st.manual, 'وزرار «اتشحن يدوي» موجود — المسار بتاعه كامل');
  await p.close();
}

// ════ 5) فشل الـEF بيبان بصراحة — من غير نجاح كاذب ════
{
  const p = await openApp({ pre: `
    window.__FN = function(slug){
      if(slug === 'order-ship') return { status: 422, body: { error:'bad_address',
        message: 'العنوان قصير أو فاضي — كمّله الأول (المنطقة والشارع على الأقل) وبعدين اشحن' } };
      return { status: 404, body: {} };
    };
  `});
  console.log('──── فشل الفحص القبلي (عنوان قصير) ────');
  await openDetailOf(p, 'o3');
  await p.click('#ship-auto');
  await p.waitForSelector('#cmodal-box', { state:'visible' });
  await p.click('#cmodal-ok');
  await p.waitForTimeout(800);
  const fail = await p.evaluate(() => ({
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '),
    row: ((window.__ORDERS || []).filter(x => x.id === 'o3')[0] || {})
  }));
  ok(/العنوان قصير/.test(fail.toast), `رسالة الفشل الحقيقية ظهرت — ${fail.toast.slice(0,60)}`);
  ok(fail.row.status === 'pending' && !fail.row.tracking_no, 'والأوردر فضل زي ما هو — مفيش حالة كاذبة');
  await p.close();
}

// ════ 6) علامة «بيتبعت» جوه إطار الحالة في الجدول ════
{
  const p = await openApp({ pre: `window.__SHIP_REQS = { o3: new Date().toISOString() };` });
  console.log('──── علامة الجدول: بيتبعت ────');
  const ind = await p.evaluate(() => {
    const tr = document.querySelector('#tbody tr[data-id="o3"]');
    const el = tr && tr.querySelector('.ship-ind');
    return el ? { cls: el.className, inBadge: !!el.closest('.badge'),
                  title: el.title || '' } : null;
  });
  ok(!!ind, 'العلامة ظاهرة على صف الأوردر');
  ok(ind && /wait/.test(ind.cls), 'وبتلف (تحميل) — الطلب لسه طازة');
  ok(ind && ind.inBadge, 'وجوه نفس إطار كلمة الحالة (طلب المالك)');
  ok(ind && /أوتوماتيك/.test(ind.title), 'والتلميح بيشرح');
  // الأوردرات التانية من غير علامة
  const others = await p.evaluate(() => document.querySelectorAll('#tbody .ship-ind').length);
  ok(others === 1, `والعلامة على أوردر واحد بس — ${others}`);
  await p.close();
}

// ════ 7) العلامة الصفرا — المحاولة ماكملتش ════
{
  const p = await openApp({ pre: `window.__SHIP_REQS = { o3: new Date(Date.now() - 10*60000).toISOString() };` });
  console.log('──── علامة الجدول: صفرا (ماكملتش) ────');
  const ind = await p.evaluate(() => {
    const tr = document.querySelector('#tbody tr[data-id="o3"]');
    const el = tr && tr.querySelector('.ship-ind');
    return el ? { cls: el.className, inBadge: !!el.closest('.badge'), title: el.title || '',
                  bg: getComputedStyle(el).backgroundColor } : null;
  });
  ok(ind && /warn/.test(ind.cls), 'العلامة بقت تحذير — الطلب قديم من غير بوليصة');
  ok(ind && /245, 158, 11/.test(ind.bg), `ولونها أصفر فعلاً — ${ind && ind.bg}`);
  ok(ind && /يدوي/.test(ind.title), 'والتلميح بيوجّه للشحن اليدوي');
  // وجوه النافذة: تحذير مكتوب + زرار الأوتوماتيك راجع للمحاولة تاني
  await openDetailOf(p, 'o3');
  const inPopup = await p.evaluate(() => ({
    chip: ((document.getElementById('ship-chip')||{}).textContent || ''),
    auto: !!document.getElementById('ship-auto'),
    manual: !!document.getElementById('da-bs')
  }));
  ok(/ماكملتش/.test(inPopup.chip), 'وجوه النافذة التحذير مكتوب صريح');
  ok(inPopup.auto && inPopup.manual, 'والزرارين متاحين — يعيد المحاولة أو يشحن يدوي');
  await p.close();
}

// ════ 8) التيكر: الموظف مشي يشتغل — العلامة بتتحدث لوحدها ════
{
  const p = await openApp({ pre: `
    window.__SHIP_TICK_MS = 700;
    window.__SHIP_REQS = { o3: new Date().toISOString() };
  ` });
  console.log('──── التيكر: النجاح بيوصل للجدول من غير ما يفتح الأوردر ────');
  const before = await p.evaluate(() =>
    !!document.querySelector('#tbody tr[data-id="o3"] .ship-ind.wait'));
  ok(before, 'العلامة بتلف في الأول');
  // «n8n» كتب البوليصة على السيرفر — من غير ما النافذة تكون مفتوحة خالص
  await p.evaluate(() => {
    const o = (window.__ORDERS || []).filter(x => x.id === 'o3')[0];
    o.tracking_no = 'TRKTICK1'; o.status = 'BOSTA AUTO';
  });
  await p.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some(t => /TRKTICK1/.test(t.textContent)),
    { timeout: 10000 });
  const after = await p.evaluate(() => ({
    ind: !!document.querySelector('#tbody tr[data-id="o3"] .ship-ind'),
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|'),
    badge: (document.querySelector('#tbody tr[data-id="o3"] .badge')||{}).textContent || ''
  }));
  ok(/9003/.test(after.toast), `الرسالة بتقول أنهي أوردر — ${after.toast.slice(0,70)}`);
  ok(!after.ind, 'والعلامة اختفت — الأوردر بقى له بوليصة');
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ تمام');
process.exit(bad ? 1 : 0);
