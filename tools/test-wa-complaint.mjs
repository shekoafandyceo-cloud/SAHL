// عدّاد الشكاوى في الشات (طلب المالك 27 سبتمبر).
//
// «الشكوى بتاخد 14 يوم للحل مع العميل — عايز Timer لما يكون شات متعلّم
// شكوى وعدّى عليه 10 أيام ينبّهنا عشان مانتنساش العميل».
//
// الشكل:
//   * `complaint_at` بيكتبه **تريجر** (`app.wa_complaint_clock`) لحظة إضافة
//     «شكوى» — المتصفح عمره ما بيبعته (العمود مش ممنوح للكتابة).
//   * `waComplaintState`: ok (< 10 أيام) · warn (10–14) · over (≥ 14) ·
//     null لو مفيش «شكوى» أو فيه «تم الحل».
//   * الصف في القايمة: سطر بعمر الشكوى · الهيدر: شريحة + بانر من 10 أيام
//   * chip «شكوى» في الشريط: «⚠️ N» — التنبيه بيبان من غير ما حد يفتح
//     الفلتر (الشكوى المنسية غالباً بره أحدث 200 فصفها مش في القايمة)
//   * فلتر «شكوى»: المفتوحة الأول والأقدم فوق
//
// اللي بيتفحص:
//   1) الحدود بالظبط: 9ي23س ok · 10ي warn · 13ي23س «باقي يوم» · 14ي over ·
//      «تم الحل» يوقف · من غير «شكوى» يوقف · تاريخ فاضي = null
//   2) 🔴 chip «شكوى» بيعدّ التنبيهات **من أول رسمة** ومنها شكوى بره الـ200
//   3) سطر العدّاد في الصفوف — والمحلولة مالهاش سطر
//   4) فلتر «شكوى»: الترتيب بالإلحاح مش بآخر رسالة
//   5) الهيدر: شريحة + بانر warn/over + «تقريبي» للتاريخ التقديري · hit-test
//   6) 🔴 تبديل المحادثة بيشيل البانر (مايفضلش بانر شكوى فوق عميل تاني)
//   7) إضافة «شكوى» بتبدأ العدّاد فوراً · 🔴 والحمولة `labels` بس
//   8) «تم الحل» بيسكّت البانر وبينقّص العدّاد
//   9) معايرات:
//      (أ) شيل شرط «تم الحل»              → فحص 3 يقع
//      (ب) شيل العدّ من waLabelExtra       → فحص 2 يقع
//      (ج) شيل مسح البانر القديم           → فحص 6 يقع
//      (د) شيل ترتيب الإلحاح               → فحص 4 يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';
const INBOX_SRC = fs.readFileSync(new URL('../app/js/inbox/inbox.js', import.meta.url), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const TENANT = 't-test-1';
const now = Date.now();
const H = 3600000, D = 24 * H;
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const base = (id, n, mins) => ({
  id, tenant_id: TENANT, wa_id: '2010' + String(n).padStart(7, '0'),
  customer_name: 'عميل ' + n, customer_phone: '2010' + String(n).padStart(7, '0'),
  last_message_at: iso(mins * 60000), last_inbound_at: iso(mins * 60000),
  last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
  labels: [], note: null, complaint_at: null, complaint_at_estimated: false,
  ctwa_clid: null, ctwa_ad_id: null, ctwa_headline: null, ctwa_source_type: null,
  ctwa_ad_body: null, ctwa_source_url: null, ctwa_first_at: null, ctwa_last_at: null
});

const CONVOS = [];
for (let i = 0; i < 600; i++) CONVOS.push(base('c' + i, i, i + 1));
// ok — يومين
Object.assign(CONVOS[3],   { labels: ['شكوى'], complaint_at: iso(2 * D + H) });
// warn — 11 يوم وساعة → باقي 3 أيام
Object.assign(CONVOS[20],  { labels: ['مهم', 'شكوى'], complaint_at: iso(11 * D + H) });
// 🔴 over — 16 يوم وتاريخ تقديري، و**بره أحدث 200** (زي شكاوى الحي المنسية)
Object.assign(CONVOS[450], { labels: ['شكوى'], complaint_at: iso(16 * D + H), complaint_at_estimated: true,
  customer_name: 'عميلة الشكوى القديمة' });
// محلولة — عمرها 20 يوم بس «تم الحل» عليها
Object.assign(CONVOS[30],  { labels: ['شكوى', 'تم الحل'], complaint_at: iso(20 * D) });
// مهم من غير شكوى
Object.assign(CONVOS[40],  { labels: ['مهم'] });

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(CONVOS)};
    window.__WA_MSGS = [];
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  if (opts.inbox) await ctx.route('**/js/inbox/inbox.js', r => r.fulfill({ contentType: 'text/javascript', body: opts.inbox }));
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(700);
  return p;
}

// معايرة = نسخة من inbox.js بمرساة فريدة + حارس (درس 47)
function mutate(anchor, repl) {
  const n = INBOX_SRC.split(anchor).length - 1;
  if (n !== 1) throw new Error(`المرساة لازم تبقى فريدة — لقيتها ${n} مرة: ${anchor.slice(0, 60)}`);
  const out = INBOX_SRC.replace(anchor, repl);
  if (out === INBOX_SRC) throw new Error('المعايرة مالقتش المرساة');
  return out;
}

const chipText = (p) => p.evaluate(() => {
  const el = document.querySelector('#wa-filters .wa-flabel[data-label="شكوى"]');
  return el ? { t: el.textContent.trim(), alert: el.classList.contains('has-alert') } : null;
});
const rowCmp = (p, id) => p.evaluate((i) => {
  const r = document.querySelector('.wa-conv[data-id="' + i + '"] .wa-conv-cmp');
  return r ? { t: r.textContent.trim(), cls: r.className } : null;
}, id);
const listIds = (p) => p.evaluate(() =>
  Array.from(document.querySelectorAll('#wa-list-body .wa-conv')).map(e => e.getAttribute('data-id')));
const header = (p) => p.evaluate(() => {
  const c = document.getElementById('wa-cmp-chip');
  const bn = document.querySelectorAll('#wa-cmp-banner');
  return { chip: c ? c.textContent.trim() : null, chipCls: c ? c.className : '',
           banners: bn.length, banner: bn[0] ? bn[0].textContent.trim() : null, bannerCls: bn[0] ? bn[0].className : '' };
});
async function openConv(p, id) {
  await p.evaluate((i) => import('/js/inbox/inbox.js').then(m => m.openConversation(i)), id);
  await p.waitForTimeout(400);
}

// ════════════════ 1 — الحدود ════════════════
{
  const p = await openInbox();
  console.log('──── الحدود ────');
  const r = await p.evaluate(({ D, H }) => import('/js/inbox/inbox.js').then(m => {
    const n = Date.parse('2026-09-27T12:00:00Z');
    const mk = (ms, labels) => ({ labels: labels || ['شكوى'], complaint_at: new Date(n - ms).toISOString() });
    const st = (c) => { const s = m.waComplaintState(c, n); return s ? { level: s.level, text: m.waComplaintText(s) } : null; };
    return {
      d9: st(mk(10 * D - H)), d10: st(mk(10 * D)), d13: st(mk(14 * D - H)), d14: st(mk(14 * D)),
      d0: st(mk(5 * 60000)), res: st(mk(20 * D, ['شكوى', 'تم الحل'])), nolab: st(mk(20 * D, ['مهم'])),
      noat: m.waComplaintState({ labels: ['شكوى'], complaint_at: null }, n)
    };
  }), { D, H });
  ok(r.d9 && r.d9.level === 'ok', `1أ) 9 أيام و23 ساعة = ok (${JSON.stringify(r.d9)})`);
  ok(r.d10 && r.d10.level === 'warn' && /باقي 4 أيام/.test(r.d10.text), `1ب) 10 أيام بالظبط = تنبيه «باقي 4 أيام» (${r.d10 && r.d10.text})`);
  ok(r.d13 && r.d13.level === 'warn' && /باقي يوم$/.test(r.d13.text), `1ج) 13 يوم و23 ساعة = «باقي يوم» (${r.d13 && r.d13.text})`);
  ok(r.d14 && r.d14.level === 'over', `1د) 14 يوم = متأخرة (${r.d14 && r.d14.text})`);
  ok(r.d0 && /النهاردة/.test(r.d0.text), `1هـ) شكوى من 5 دقايق = «النهاردة» (${r.d0 && r.d0.text})`);
  ok(r.res === null, '1و) «تم الحل» بيوقّف العدّاد');
  ok(r.nolab === null, '1ز) من غير «شكوى» مفيش عدّاد حتى لو فيه تاريخ');
  ok(r.noat === null, '1ح) «شكوى» من غير تاريخ = مفيش عدّاد (مش «النهاردة» مخترعة)');
  await p.close();
}

// ════════════════ 2-4 — القايمة والشريط ════════════════
{
  const p = await openInbox();
  console.log('──── الشريط والقايمة ────');
  const c = await chipText(p);
  ok(c && /\(4\)/.test(c.t) && /⚠️ 2/.test(c.t) && c.alert,
     `2) 🔴 chip «شكوى» من أول رسمة: ${c && c.t} — 4 شكاوى و2 محتاجين حل (منهم c450 بره الـ200)`);

  const r3 = await rowCmp(p, 'c3'), r20 = await rowCmp(p, 'c20'), r30 = await rowCmp(p, 'c30'), r40 = await rowCmp(p, 'c40');
  ok(r3 && r3.t === '⏱ شكوى من يومين' && /lvl-ok/.test(r3.cls), `3أ) صف الشكوى الجديدة: «${r3 && r3.t}»`);
  ok(r20 && /lvl-warn/.test(r20.cls) && /باقي 3 أيام/.test(r20.t), `3ب) صف الشكوى القريبة: «${r20 && r20.t}»`);
  ok(r30 === null, `3ج) 🔴 الشكوى المحلولة مالهاش عدّاد (${JSON.stringify(r30)})`);
  ok(r40 === null, '3د) «مهم» من غير شكوى مالوش عدّاد');

  await p.click('#wa-filters .wa-flabel[data-label="شكوى"]');
  await p.waitForTimeout(600);
  const ids = await listIds(p);
  ok(JSON.stringify(ids) === JSON.stringify(['c450', 'c20', 'c3', 'c30']),
     `4) فلتر «شكوى» بالإلحاح: الأقدم فوق والمحلولة آخر (${JSON.stringify(ids)})`);
  const r450 = await rowCmp(p, 'c450');
  ok(r450 && /lvl-over/.test(r450.cls) && /متأخرة/.test(r450.t) && /بـيومين/.test(r450.t),
     `4ب) الشكوى القديمة بره الـ200: «${r450 && r450.t}»`);
  await p.close();
}

// ════════════════ 5-8 — الهيدر والتعديل ════════════════
{
  const p = await openInbox();
  console.log('──── الهيدر ────');
  await openConv(p, 'c20');
  let h = await header(p);
  ok(/lvl-warn/.test(h.chipCls) && /باقي 3 أيام/.test(h.chip || ''), `5أ) شريحة الهيدر: «${h.chip}»`);
  ok(h.banners === 1 && /لازم تتحل/.test(h.banner || '') && /تم الحل/.test(h.banner || ''),
     `5ب) بانر التنبيه وفيه المطلوب: «${h.banner}»`);
  const ht = await p.evaluate(() => {
    const el = document.getElementById('wa-cmp-banner'); if (!el) return 'مش موجود';
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return (t && (t === el || el.contains(t))) ? 'ظاهر' : 'مدفون تحت ' + (t ? t.className : 'null');
  });
  ok(ht === 'ظاهر', `5ج) hit-test على البانر: ${ht}`);

  await openConv(p, 'c450');
  h = await header(p);
  ok(/lvl-over/.test(h.bannerCls) && /التاريخ تقريبي/.test(h.banner || ''), `5د) المتأخرة + «تقريبي»: «${h.banner}»`);

  await openConv(p, 'c3');
  h = await header(p);
  ok(h.chip === '⏱ شكوى من يومين' && h.banners === 0,
     `6) 🔴 التبديل لشكوى جديدة شال البانر (بانرات: ${h.banners}، الشريحة: «${h.chip}»)`);

  console.log('──── التعديل ────');
  await openConv(p, 'c40');
  await p.click('#wa-label-btn'); await p.waitForTimeout(200);
  await p.evaluate(() => { window.__calls.length = 0; });
  await p.click('#wa-label-picker .wa-lp[data-label="شكوى"]'); await p.waitForTimeout(300);
  h = await header(p);
  ok(h.chip === '⏱ شكوى النهاردة', `7أ) إضافة «شكوى» بدأت العدّاد فوراً: «${h.chip}»`);
  const pay = await p.evaluate(() => (window.__calls || [])
    .filter(c => c.table === 'wa_conversations' && c.payload).map(c => Object.keys(c.payload)));
  ok(pay.length === 1 && JSON.stringify(pay[0]) === '["labels"]',
     `7ب) 🔴 الحمولة labels بس — التاريخ من التريجر مش من المتصفح (${JSON.stringify(pay)})`);
  await p.click('#wa-label-picker .wa-lp[data-label="شكوى"]'); await p.waitForTimeout(300);
  h = await header(p);
  ok(h.chip === null, '7ج) شيل «شكوى» شال العدّاد');

  await openConv(p, 'c20');
  await p.click('#wa-label-btn'); await p.waitForTimeout(200);
  await p.click('#wa-label-picker .wa-lp[data-label="تم الحل"]'); await p.waitForTimeout(400);
  h = await header(p);
  const c = await chipText(p);
  ok(h.banners === 0 && h.chip === null, '8أ) «تم الحل» سكّت البانر والشريحة');
  ok(c && /⚠️ 1/.test(c.t), `8ب) والعدّاد على الـchip نزل لـ1 (${c && c.t})`);
  await p.close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');
{
  const p = await openInbox({ inbox: mutate(" || ls.indexOf(WA_RESOLVED_LABEL)>=0) return null;", ") return null;") });
  const r30 = await rowCmp(p, 'c30');
  ok(r30 !== null, `معايرة أ: من غير شرط «تم الحل» المحلولة طلع عليها «${r30 && r30.t}» — فحص 3ج بيمسكها`);
  await p.close();
}
{
  const p = await openInbox({ inbox: mutate("var lcs=waComplaintState(lc); if(lcs && lcs.level!=='ok') cmpAlert++;", '') });
  const c = await chipText(p);
  ok(c && /⚠️ 1/.test(c.t), `معايرة ب: من غير عدّ الأقدم من الـ200 الـchip قال «${c && c.t}» — فحص 2 بيمسكها`);
  await p.close();
}
{
  const p = await openInbox({ inbox: mutate("var oldB=$id('wa-cmp-banner'); if(oldB) oldB.remove();", '') });
  await openConv(p, 'c20'); await openConv(p, 'c3');
  const h = await header(p);
  ok(h.banners >= 1, `معايرة ج: من غير المسح فضل ${h.banners} بانر فوق شكوى جديدة — فحص 6 بيمسكها`);
  await p.close();
}
{
  const p = await openInbox({ inbox: mutate("if(waFilter==='label:'+WA_COMPLAINT_LABEL){", 'if(false){') });
  await p.click('#wa-filters .wa-flabel[data-label="شكوى"]'); await p.waitForTimeout(600);
  const ids = await listIds(p);
  ok(ids[0] !== 'c450', `معايرة د: من غير ترتيب الإلحاح أول صف بقى ${ids[0]} — فحص 4 بيمسكها`);
  await p.close();
}

console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
await b.close();
process.exit(bad ? 1 : 0);
