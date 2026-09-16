// فلتر «📣 جه من إعلان» في صندوق المحادثات (طلب المالك 16 سبتمبر)
//
// 🔴 الفخ اللي الميزة دي مبنية حواليه: `waFetchConvos` بتجيب **أحدث 200
// محادثة بس** (`.limit(200)`) و`waConvMatches` بتفلتر على المحمّل في
// الذاكرة. فلتر بيقرا من `waConvos` لوحدها بيقول «عندك 2 من إعلان»
// والداتابيز فيها 3 — **والتالت بيختفي في صمت** (درس 6: الفلترة والترتيب
// مرتبطين، والنتيجة بتطلع غلط من غير أي خطأ في أي مكان).
//
// عشان كده الفلتر ده **بيستعلم من السيرفر** بشرطه، والنتيجة بتتحط في
// مصفوفة منفصلة (`waAdExtra`) — مش بتتدمج في `waConvos`. الدمج اتجرّب
// وطلع إن ترتيب وصول الاستعلامين بيحدد النتيجة، واختفت محادثتين من
// القايمة العادية. والبحث بالـid بيعدّي على `waConvById` اللي بتبص على
// الاتنين.
//
// ⚠️ والستب اتظبط يقطع **زي PostgREST**: بيطبّق `or(ctwa_*)` و`order`
// و`limit` على `wa_conversations`. من غير ده الفلتر من السيرفر والفلتر
// من الذاكرة بيدّوا نفس النتيجة والاختبار مايثبتش حاجة (درس 33).
//
// اللي بيتفحص:
//   1) الـchip موجود في شريط الفلاتر ومعاه العدّاد الصح **قبل أي ضغطة**
//   2) hit-test: الـchip مش مدفون + ضغطة Playwright حقيقية (درس 31/35)
//   3) 🔴 الفلتر بيعرض **3** — منهم المحادثة اللي بره أحدث 200
//   4) 🔴 كل صف معروض عليه شارة 📣 فعلاً (الفلتر والشارة مصدرهم واحد)
//   5) المحادثة العادية مش في القايمة
//   6) 🔴 الضغط على الصف المدموج بيفتح المحادثة صح (الاسم في الهيدر)
//   7) 🔴 عدّاد «غير مقروءة» بيتحسب من أحدث 200 بس — الأقدم مايدخلش فيه
//   8) الاستعلام اللي خرج فعلاً فيه شرط `ctwa_` — سيرفر مش ذاكرة
//   9) الترتيب بالأحدث
//  10) ملاحظة السقف مابتقولش «الأقدم مش بيظهر» وقت فلتر الإعلانات
//  11) الرجوع لـ«الكل» بيرجّع القايمة كاملة
//  12) متجر من غير أي إعلان → رسالة فيها **سياق** «قبل تفعيل التتبع»
//  13) معايرات:
//      (أ) خلي الفلتر يقرا من المحمّل بس  → فحص 3 يقع (2 بدل 3)
//      (ب) ضيّق الشرط على `ctwa_ad_id` بس → فحص 4 يقع (شارة من غير فلتر)
//      (ج) خلي العدّاد يضم الأقدم كمان        → فحص 7 يقع
//      (د) شيل شرط ضم الأقدم على فلترها        → فحص 1ج يقع
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:8899';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };

const TENANT = 't-test-1';
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();

const AD_ID = '120212345678900123';
const AD_BODY = '🙄 مطبخك زحمة والرُخامة مليانة مواعين وأدوات؟';
const OLD_AD_BODY = '✨ استاند امريكانا خشب زان ✨';

const base = (id, n, mins) => ({
  id, tenant_id: TENANT, wa_id: '2010' + String(n).padStart(7, '0'),
  customer_name: 'عميل ' + n, customer_phone: '2010' + String(n).padStart(7, '0'),
  last_message_at: iso(mins), last_inbound_at: iso(mins),
  last_message_text: 'أهلاً', last_direction: 'in', unread_count: 0, status: 'open',
  labels: null, note: null,
  ctwa_clid: null, ctwa_ad_id: null, ctwa_headline: null, ctwa_source_type: null,
  ctwa_ad_body: null, ctwa_source_url: null, ctwa_first_at: null, ctwa_last_at: null
});

// 🔴 205 محادثة: أحدث 200 فيهم إعلانين، والتالت رقم 203 — **بره السقف**.
// من غير استعلام السيرفر الفلتر هيقول 2 والحقيقة 3.
const CONVOS = [];
for (let i = 0; i < 205; i++) CONVOS.push(base('c' + i, i, i + 1));
// إعلان جوّه الـ200 — بـbody
Object.assign(CONVOS[5], {
  ctwa_clid: 'ARAaBbCc123', ctwa_ad_id: AD_ID, ctwa_ad_body: AD_BODY,
  ctwa_source_type: 'ad', ctwa_first_at: iso(90), ctwa_last_at: iso(6)
});
// إعلان جوّه الـ200 — **من غير `ctwa_ad_id`**: `ad_body` لوحده.
// ده اللي بيمسك تضييق الشرط على `ad_id` (معايرة ب).
Object.assign(CONVOS[50], {
  ctwa_ad_body: 'إعلان من غير معرّف', ctwa_first_at: iso(300), ctwa_last_at: iso(51)
});
// 🔴 إعلان **بره** أحدث 200
Object.assign(CONVOS[203], {
  ctwa_clid: 'ARzzYY987', ctwa_ad_id: AD_ID, ctwa_ad_body: OLD_AD_BODY,
  ctwa_source_type: 'ad', ctwa_first_at: iso(9000), ctwa_last_at: iso(204)
});
// محادثتين فيهم غير مقروء — عشان نثبت إن العدّاد مايتغيرش بالفلتر
CONVOS[2].unread_count = 3;
CONVOS[9].unread_count = 1;
// 🔴 والمحادثة اللي بره السقف كمان — من غيرها فحص العدّاد بيعدّي
// **بالصدفة** (مفيش غير مقروء يتحسب غلط أصلاً). دي الحالة اللي بتفرّق
// بين «العدّاد بيتحسب من أحدث 200» و«العدّاد بيتحسب من كل المحمّل».
CONVOS[203].unread_count = 7;
const AD_IDS = ['c5', 'c50', 'c203'];

const MSGS = [{
  id: 'm1', tenant_id: TENANT, conversation_id: 'c203', direction: 'in', type: 'text',
  body: 'أهلاً', is_read: true, created_at: iso(204), wa_timestamp: iso(204),
  status: null, wa_message_id: 'wamid-203'
}];

async function openInbox(opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  await ctx.addInitScript(`
    window.__WA_CONVOS = ${JSON.stringify(opts.convos || CONVOS)};
    window.__WA_MSGS   = ${JSON.stringify(MSGS)};
    window.__RPC_HOOK = function(name){
      if(name === 'wa_inbox_status') return { data:{ verified:true }, error:null };
      return null;
    };
  `);
  await ctx.addInitScript(STUB);
  if (opts.routeInbox) await ctx.route('**/js/inbox/inbox.js', opts.routeInbox);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  ✗ pageerror:', e.message); bad++; });
  await p.goto(ORIGIN + '/chats', { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-inbox', { state: 'visible', timeout: 10000 });
  if (!opts.empty) await p.waitForSelector('#wa-list-body .wa-conv', { timeout: 8000 });
  await p.waitForTimeout(500);
  return p;
}

// الدليل الوحيد إن العنصر شايفه حد (درس 31/35)
const hitTest = (p, sel) => p.evaluate(async (s) => {
  const el = document.querySelector(s);
  if (!el) return 'مش موجود';
  el.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 120));
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return 'مقاس صفر';
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return (top && (top === el || el.contains(top) || top.contains(el))) ? 'ظاهر' : 'مدفون تحت ' + (top ? top.className || top.tagName : 'null');
}, sel);

const listIds = (p) => p.evaluate(() =>
  Array.from(document.querySelectorAll('#wa-list-body .wa-conv')).map(e => e.getAttribute('data-id')));

const chipText = (p, id) => p.evaluate((i) => {
  const el = document.getElementById(i);
  return el ? el.textContent.trim() : null;
}, id);

// ════════════════ المسار الأساسي ════════════════
{
  const p = await openInbox();
  console.log('──── الـchip والعدّاد ────');

  const chip = await chipText(p, 'wa-filter-ctwa');
  ok(chip !== null, '1أ) الـchip «جه من إعلان» موجود في شريط الفلاتر');
  // 🔴 العدّاد لازم يقول 3 **من غير أي ضغطة** — واحد منهم بره أحدث 200
  ok(chip && chip.indexOf('(3)') >= 0,
     `1ب) 🔴 العدّاد صح من أول رسمة: «${chip}» — فيهم المحادثة اللي بره الـ200`);

  const allBefore = (await listIds(p)).length;
  ok(allBefore === 200, `1ج) القايمة العادية عند السقف: ${allBefore} صف`);

  ok(await hitTest(p, '#wa-filter-ctwa') === 'ظاهر', '2) hit-test: الـchip مش مدفون');
  await p.click('#wa-filter-ctwa');          // ضغطة حقيقية مش el.click()
  await p.waitForTimeout(600);

  console.log('──── القايمة بعد الفلتر ────');
  const ids = await listIds(p);
  ok(ids.length === 3, `3) 🔴 الفلتر عرض ${ids.length} محادثة (المتوقع 3)`);
  ok(ids.indexOf('c203') >= 0,
     '3ب) 🔴 المحادثة اللي بره أحدث 200 ظهرت — الاستعلام من السيرفر شغال');
  ok(AD_IDS.every(i => ids.indexOf(i) >= 0), '3ج) التلاتة كلهم موجودين');

  // 🔴 اتساق الفلتر مع الشارة: أي صف في الفلتر لازم يكون عليه 📣
  const badges = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#wa-list-body .wa-conv'))
      .map(e => !!e.querySelector('.wa-conv-ctwa')));
  ok(badges.length === 3 && badges.every(Boolean),
     '4) 🔴 كل صف في الفلتر عليه شارة 📣 فعلاً — الشرط والشارة مصدرهم واحد');

  ok(ids.indexOf('c2') < 0 && ids.indexOf('c0') < 0, '5) المحادثات العادية مش في القايمة');

  // الترتيب بالأحدث — الصف المدموج بيتحط في آخر المصفوفة فلازم يترتب
  ok(ids[0] === 'c5' && ids[1] === 'c50' && ids[2] === 'c203',
     `9) الترتيب بالأحدث: ${ids.join(' → ')}`);

  // ملاحظة السقف: نص «الأقدم مش بيظهر» غلط هنا — الفلتر ده شاف الأقدم
  const cap = await p.evaluate(() => {
    const el = document.querySelector('#wa-list-body .wa-cap-note');
    return el ? el.textContent.trim() : '';
  });
  ok(cap.indexOf('الأقدم مش بيظهر هنا ولا في البحث') < 0,
     `10) ملاحظة السقف مابتكدبش على فلتر الإعلانات (${cap ? '«' + cap + '»' : 'مفيش'})`);

  // 🔴 العدّاد لازم يتحسب من **أحدث 200** بس: c2 و c9. الصف المدموج
  // (c203) عنده 7 غير مقروء و**مايتحسبش** — هو بره السقف أصلاً، وضمّه
  // كان هيخلي الرقم يتحرك على حسب إذا كان الموظف فتح فلتر الإعلانات
  // ولا لأ. (فحص القيمة المطلقة مش المقارنة قبل/بعد — الدمج بيحصل قبل
  // أول رسمة فالمقارنة كانت هتعدّي وهي عمياء.)
  const unreadAfter = await chipText(p, 'wa-filter-unread');
  ok(unreadAfter === 'غير مقروءة (2)',
     `7) 🔴 عدّاد «غير مقروءة» بيتحسب من أحدث 200 بس: «${unreadAfter}»`);

  console.log('──── الفتح والرجوع ────');
  // 🔴 الصف المدموج لازم يفتح صح — ده اللي بيثبت إن الدمج في `waConvos`
  // خلّى البحث بالـid شغال من غير مسار تاني
  await p.click('.wa-conv[data-id="c203"]');
  await p.waitForTimeout(500);
  const head = await p.evaluate(() => ({
    name: (document.getElementById('wa-chat-name') || {}).textContent || '',
    ad: (document.getElementById('wa-chat-ctwa') || {}).textContent || ''
  }));
  ok(head.name.indexOf('عميل 203') >= 0,
     `6) 🔴 المحادثة المدموجة اتفتحت صح — الهيدر «${head.name}»`);
  ok(head.ad.indexOf('استاند امريكانا') >= 0,
     `6ب) وشارة الإعلان بتاعتها ظهرت في الهيدر`);

  // الاستعلام اللي خرج فعلاً
  const calls = await p.evaluate(() => (window.__calls || [])
    .filter(c => c.table === 'wa_conversations' && c.or).map(c => c.or));
  ok(calls.length > 0 && calls[0].indexOf('ctwa_') >= 0,
     `8) الاستعلام خرج للسيرفر بشرط الإعلانات فعلاً`);

  await p.click('.wa-filter[data-f="all"]');
  await p.waitForTimeout(400);
  const backIds = await listIds(p);
  ok(backIds.length >= 200, `11) الرجوع لـ«الكل» رجّع القايمة: ${backIds.length} صف`);

  await p.close();
}

// ════ 12 — متجر من غير أي إعلان ════
{
  const clean = CONVOS.slice(0, 20).map(c => Object.assign({}, c, {
    ctwa_clid: null, ctwa_ad_id: null, ctwa_headline: null,
    ctwa_ad_body: null, ctwa_first_at: null, ctwa_last_at: null
  }));
  const p = await openInbox({ convos: clean });
  console.log('──── متجر من غير إعلانات ────');
  const chip = await chipText(p, 'wa-filter-ctwa');
  ok(chip && chip.indexOf('(') < 0, `12أ) العدّاد مابيظهرش على الصفر: «${chip}»`);
  await p.click('#wa-filter-ctwa');
  await p.waitForTimeout(400);
  const msg = await p.evaluate(() => {
    const el = document.querySelector('#wa-list-body .wa-empty');
    return el ? el.textContent.trim() : '';
  });
  ok(msg.indexOf('مفيش محادثات جاية من إعلان') >= 0, `12ب) رسالة الفراغ ظهرت`);
  // 🔴 السياق: من غيره التاجر بيقرا «صفر» على إنها ميزة مكسورة
  ok(msg.indexOf('قبل تفعيل تتبع الإعلانات') >= 0,
     `12ج) 🔴 والرسالة فيها السياق — المحادثات القديمة مالهاش بيانات إعلان`);
  await p.close();
}

// ════════════════ المعايرات ════════════════
console.log('──── المعايرات ────');

// (أ) خلي الفلتر يقرا من المحمّل بس → فحص 3 لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("  if(f==='ctwa') waFetchAdConvos();", '');
      body = body.replace('  waFetchAdConvos();\n  waFetchConvos(true);', '  waFetchConvos(true);');
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-filter-ctwa');
  await p.waitForTimeout(600);
  const ids = await listIds(p);
  ok(ids.length === 2 && ids.indexOf('c203') < 0,
     `معايرة أ: بفلتر على المحمّل بس ظهر ${ids.length} بدل 3 والقديم اختفى — فحص 3ب بيمسكها`);
  await p.close();
}

// (ب) ضيّق الشرط على `ctwa_ad_id` بس → فحص 4 لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace(
        "  return !!(c && (c.ctwa_first_at || c.ctwa_ad_id || c.ctwa_clid || c.ctwa_ad_body || c.ctwa_headline));",
        "  return !!(c && c.ctwa_ad_id);");
      await r.fulfill({ response: res, body });
    }
  });
  await p.click('#wa-filter-ctwa');
  await p.waitForTimeout(600);
  const ids = await listIds(p);
  // c50 عليها شارة (عندها ad_body) بس الشرط الضيق مش شايفها
  const c50Badge = await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#wa-list-body .wa-conv'));
    return rows.some(e => e.getAttribute('data-id') === 'c50');
  });
  ok(!c50Badge && ids.length < 3,
     `معايرة ب: بشرط ضيق c50 (شارة من غير ad_id) اختفت من الفلتر — فحص 4 بيمسكها`);
  await p.close();
}

// (ج) خلي عدّاد غير المقروء يقرا المصفوفة المنفصلة كمان → فحص 7 لازم يقع
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace(
        '  for(var ax=0;ax<waAdExtra.length;ax++) adIds[waAdExtra[ax].id]=1;',
        '  for(var ax=0;ax<waAdExtra.length;ax++){ adIds[waAdExtra[ax].id]=1;'
        + ' var xu=waAdExtra[ax].unread_count||0; totalUnread+=xu; if(xu>0)unreadConvs++; }');
      await r.fulfill({ response: res, body });
    }
  });
  const after = await chipText(p, 'wa-filter-unread');
  ok(after === 'غير مقروءة (3)',
     `معايرة ج: لما العدّاد ضمّ المحادثة اللي بره السقف بقى «${after}» — فحص 7 بيمسكها`);
  await p.close();
}

// (د) شيل شرط الفلتر عن ضم الأقدم → فلتر «الكل» بيطلّع 201
{
  const p = await openInbox({
    routeInbox: async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace("  if(waFilter==='ctwa'){\n    // الإعلانات اللي بره أحدث 200",
                          "  if(true){\n    // الإعلانات اللي بره أحدث 200");
      await r.fulfill({ response: res, body });
    }
  });
  const ids = await listIds(p);
  ok(ids.length === 201 && ids.indexOf('c203') >= 0,
     `معايرة د: من غير الشرط فلتر «الكل» طلّع ${ids.length} صف جنب ملاحظة «أحدث 200» — فحص 1ج بيمسكها`);
  await p.close();
}

await b.close();
console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
