// نافذة تفاصيل الأوردر — أقسامها لازم تبقى **بانة** فعلاً، بالقياس مش بالعين.
//
// الباج الأصلي (اتقاس على الحالة الحية قبل الإصلاح):
//   نهاري: .dpan = rgba(255,255,255,.96) ≈ #fff  و .dsec = #fff        → فرق 0
//   ليلي : .dpan = #161d2e               و .dsec = #151d30            → فرق (1,0,-2)
//   والحدّ #eef2f7 على خلفية بيضا = تباين ~1.06:1
// يعني المربع نفس لون اللوح في الوضعين، فمفيش أي حافة تمسك العين.
//
// الفحص هنا بيقيس getComputedStyle الفعلي (درس 27: بعد تاني محاولة فاشلة
// بطّل تخمين وهات الـcomputed) في **النهاري والليلي**، وبيتأكد كمان إن
// القواعد الجديدة مـتسرّبتش على .dsec بتاعة الماليات/المحفظة (نفس الكلاس).
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };

// أدوات لون داخل الصفحة بتتحقن كـ string
const HELPERS = `
  window.__rgb = function(s){
    var m = String(s||'').match(/rgba?\\(([^)]+)\\)/);
    if(!m) return null;
    var p = m[1].split(',').map(function(x){ return parseFloat(x); });
    return { r:p[0], g:p[1], b:p[2], a:(p.length>3?p[3]:1) };
  };
  // أقصى فرق على أي قناة — مقياس بسيط وكافي لـ«فيه حافة ولا لأ»
  window.__delta = function(a,b){
    var x = window.__rgb(a), y = window.__rgb(b);
    if(!x || !y) return -1;
    return Math.max(Math.abs(x.r-y.r), Math.abs(x.g-y.g), Math.abs(x.b-y.b));
  };
`;

async function measure(dark){
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport:{ width:1440, height:900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(`try{ localStorage.setItem('sahl_dark','${dark ? '1' : '0'}'); }catch(e){}`);
  await p.addInitScript(STUB);
  await p.addInitScript(HELPERS);
  await p.goto(URL_, { waitUntil:'networkidle' });
  await p.waitForSelector('#page-orders', { state:'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);

  // ضغطة Playwright حقيقية (hit-tested) — مش el.click() (درس 35)
  await p.click('#tbody tr[data-id]');
  await p.waitForSelector('#ovl.open', { state:'visible' });
  await p.waitForSelector('#dcnt .dsec');
  await p.waitForTimeout(400);

  const r = await p.evaluate(() => {
    const cs = el => getComputedStyle(el);
    const pan = document.querySelector('#ovl .dpan');
    const panBg = cs(pan).backgroundColor;
    const secs = [...document.querySelectorAll('#dcnt .dsec')].map(s => {
      const t = s.querySelector('.dstt');
      const before = getComputedStyle(s, '::before');
      const sr = s.getBoundingClientRect();
      let hit = null;
      if(t){
        // الأقسام اللي تحت الطيّة بترجّع null من elementFromPoint — مش لأنها
        // مدفونة بل لأنها بره الـviewport. بنجيبها للشاشة الأول عشان الفحص
        // يقيس الحجب فعلاً مش موقع الـscroll (درس 31/35).
        t.scrollIntoView({ block:'center' });
        const tr = t.getBoundingClientRect();
        const el = document.elementFromPoint(tr.x + tr.width/2, tr.y + tr.height/2);
        hit = !!(el && s.contains(el));
      }
      return {
        tone: s.getAttribute('data-tone'),
        title: t ? t.textContent.trim().slice(0,28) : null,
        bg: cs(s).backgroundColor,
        border: cs(s).borderTopColor,
        stripW: before.width,
        stripBg: before.backgroundColor,
        titleSize: t ? parseFloat(cs(t).fontSize) : 0,
        titleWeight: t ? parseInt(cs(t).fontWeight,10) : 0,
        titleColor: t ? cs(t).color : null,
        titleBg: t ? cs(t).backgroundColor : null,
        icoBox: t && t.querySelector('.dstt-ico') ? t.querySelector('.dstt-ico').getBoundingClientRect().width : 0,
        w: sr.width, hit
      };
    });
    return { panBg, secs };
  });

  // تسريب القواعد على .dsec بره النافذة (الماليات) — نفس الكلاس بالظبط
  await p.evaluate(() => { document.querySelector('#ovl').classList.remove('open'); });
  await p.click('[data-page="finance"]');
  await p.waitForSelector('#page-finance', { state:'visible' });
  await p.waitForTimeout(300);
  const leak = await p.evaluate(() => {
    const el = document.getElementById('fin-cost-section');
    if(!el) return null;
    const bf = getComputedStyle(el, '::before');
    return { stripW: bf.width, content: bf.content, radius: getComputedStyle(el).borderRadius };
  });

  // المعايرة: نرجّع الباج بالحرف — نخلي خلفية القسم = خلفية اللوح
  await p.evaluate(() => { document.querySelector('#ovl').classList.add('open'); });
  const calib = await p.evaluate(() => {
    const pan = document.querySelector('#ovl .dpan');
    const sec = document.querySelector('#dcnt .dsec');
    if(!pan || !sec) return null;
    const panBg = getComputedStyle(pan).backgroundColor;
    const orig = sec.style.background;
    sec.style.background = panBg;           // شكل الباج القديم بالظبط
    const d = window.__delta(getComputedStyle(sec).backgroundColor, panBg);
    sec.style.background = orig;            // رجّع
    const back = window.__delta(getComputedStyle(sec).backgroundColor, panBg);
    return { withBug:d, restored:back };
  });

  await b.close();
  return { ...r, leak, calib, errs: errs.filter(e => !/favicon|ERR_/i.test(e)) };
}

// فرق اللون بيتحسب هنا (نفس منطق __delta) عشان نقدر نأكّد بره الصفحة كمان
const rgb = s => { const m = String(s||'').match(/rgba?\(([^)]+)\)/); if(!m) return null;
  const p = m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; };
const delta = (a,b) => { const x=rgb(a), y=rgb(b); if(!x||!y) return -1;
  return Math.max(Math.abs(x.r-y.r), Math.abs(x.g-y.g), Math.abs(x.b-y.b)); };

const MIN_SURFACE = 6;   // أقل فرق مقبول بين الكارت واللوح (كان 0 و2)
const MIN_BORDER  = 10;  // الحدّ لازم يبان على خلفية الكارت (كان #eef2f7 على أبيض ≈ 4)

for(const dark of [false, true]){
  const mode = dark ? 'الليلي 🌙' : 'النهاري ☀️';
  console.log(`\n════════ ${mode} ════════`);
  const r = await measure(dark);

  ok(r.secs.length >= 8, `عدد الأقسام في النافذة = ${r.secs.length} (متوقع 8+)`);
  console.log(`  خلفية اللوح: ${r.panBg}`);

  let worstSurface = 999, worstBorder = 999, worstName = '';
  for(const s of r.secs){
    const dS = delta(s.bg, r.panBg);
    const dB = delta(s.border, s.bg);
    if(dS < worstSurface){ worstSurface = dS; worstName = s.title; }
    if(dB < worstBorder) worstBorder = dB;
  }
  ok(worstSurface >= MIN_SURFACE,
     `كل قسم متفرّق عن اللوح — أقل فرق ${worstSurface} (الحد ${MIN_SURFACE}) عند «${worstName}»`);
  ok(worstBorder >= MIN_BORDER,
     `حدّ كل قسم بان على خلفيته — أقل فرق ${worstBorder} (الحد ${MIN_BORDER})`);

  const noStrip = r.secs.filter(s => !s.stripW || parseFloat(s.stripW) <= 0);
  ok(noStrip.length === 0, `كل قسم عليه شريط لوني — بدون شريط: ${noStrip.length}`);

  const stripInvisible = r.secs.filter(s => delta(s.stripBg, s.bg) < MIN_BORDER);
  ok(stripInvisible.length === 0,
     `الشريط بانٍ فعلاً (مش نفس لون الكارت) — مخفيين: ${stripInvisible.map(s=>s.title).join(' · ') || 'ولا واحد'}`);

  // الجذر 14px، و02-base بتفرض font-weight:700 !important على كل حاجة —
  // فالعنوان لازم يكسرها بـ900 وإلا بيبقى بنفس وزن الصفوف اللي تحته.
  const weakTitle = r.secs.filter(s => s.titleSize < 14 || s.titleWeight < 900);
  ok(weakTitle.length === 0,
     `كل العناوين وزنها 900 وحجمها ≥14px — الضعيف: ${weakTitle.map(s=>`${s.title}(${s.titleSize}px/${s.titleWeight})`).join(', ') || 'ولا واحد'}`);

  const titleFlat = r.secs.filter(s => delta(s.titleBg, s.bg) < 3);
  ok(titleFlat.length === 0,
     `شريط العنوان متمايز عن جسم الكارت — مسطّح: ${titleFlat.map(s=>s.title).join(' · ') || 'ولا واحد'}`);

  const noIco = r.secs.filter(s => !s.icoBox || s.icoBox < 12);
  ok(noIco.length === 0, `كل قسم عليه أيقونة مرسومة — ناقص: ${noIco.map(s=>s.title).join(' · ') || 'ولا واحد'}`);

  ok(r.secs.every(s => s.hit !== false), 'الـhit-test: كل عنوان قسم مكشوف مش مدفون تحت حاجة');

  // مفيش تسريب على .dsec بتاعة الماليات
  if(r.leak){
    ok(parseFloat(r.leak.stripW || 0) === 0 || r.leak.content === 'none',
       `القواعد مـتسرّبتش على .dsec في الماليات (::before = ${r.leak.content} / ${r.leak.stripW})`);
  } else ok(false, 'مالقيناش #fin-cost-section عشان نتأكد من التسريب');

  // المعايرة
  ok(r.calib && r.calib.withBug === 0,
     `المعايرة: لما نرجّع الباج (خلفية القسم = خلفية اللوح) الفرق بيرجع 0 — طلع ${r.calib && r.calib.withBug}`);
  ok(r.calib && r.calib.restored >= MIN_SURFACE,
     `وبعد الرجوع الفرق رجع ${r.calib && r.calib.restored} — المعايرة مالوّثتش الحالة`);

  ok(r.errs.length === 0, `صفر أخطاء صفحة${r.errs.length ? ' — ' + JSON.stringify(r.errs.slice(0,3)) : ''}`);
}

console.log(bad ? `\n❌ ${bad} مشكلة` : '\n✅ كل الفحوص عدّت — النهاري والليلي');
process.exit(bad ? 1 : 0);
