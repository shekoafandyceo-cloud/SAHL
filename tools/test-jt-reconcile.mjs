// مصالحة J&T بالسحب (30 سبتمبر) — الدوال النقية في `_shared/jt.ts` (من غير متصفح).
//
// البلاغ: JEG000543975786 (17309) «استثناء» وهو متسلّم ومتحصّل. مسح التسليم (100)
// عند J&T عمره ما وصل jt-status — الـpush بيضيع ~1% (19 من 1,995 مسح اتقاسوا).
// الحل: trace_sync بيسحب logistics/trace ويطبّق المسحات الناقصة على نفس الدالة.
//
// 🔴 الفخ اللي الملف ده بيحرسه: الـpull **مافيهوش isRefund**. من غير الاستنتاج،
// رحلة المرتجع (50/92/94/120 بعد 172) كانت هترجّع أوردر مرتجع لـ«خرج للتسليم».
//
// الفيكستشرز تسلسلات حقيقية من القياس (الوقت + الكود + الاسم بس — من غير أي
// بيانات عميل)، بترتيب J&T الحقيقي (الأحدث الأول).
//
// معايرات: (أ) شيل استنتاج المرتجع · (ب) شيل الترتيب الزمني · (ج) خلي الفلتر
// `>=` بدل `>` · (د) نسخة jt-status من parseJtTime بـDST · (هـ) «الكود الفاضي = كله» — كل واحدة لازم توقّع فحص.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.join(HERE, '..', 'supabase', 'functions', '_shared');
const JT_SRC = fs.readFileSync(path.join(SHARED, 'jt.ts'), 'utf8');
const STATUS_SRC = fs.readFileSync(path.join(HERE, '..', 'supabase', 'functions', 'jt-status', 'index.ts'), 'utf8');

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

// نسخة من jt.ts بتعديل (للمعايرة) — بتتكتب في temp جنب md5.ts عشان الـimport يشتغل
async function loadJt(mutate) {
  if (!mutate) return import(pathToFileURL(path.join(SHARED, 'jt.ts')).href);
  const src = mutate(JT_SRC);
  if (src === JT_SRC) throw new Error('المعايرة مالقتش المرساة (درس 47)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcal-'));
  fs.copyFileSync(path.join(SHARED, 'md5.ts'), path.join(dir, 'md5.ts'));
  fs.writeFileSync(path.join(dir, 'jt.ts'), src);
  return import(pathToFileURL(path.join(dir, 'jt.ts')).href + '?' + Math.random());
}

// الخريطة الحية (jt_status_map بعد migration jt_trace_reconcile) — للحساب بس
const MAP = { '10': 'Picking up from consignee', '50': 'In transit between Hubs', '92': 'Received at warehouse',
  '94': 'Out for delivery', '100': 'Delivered', '110': 'Exception', '120': 'Exception',
  '111': 'Returned to business', '13': 'Returned to business', '172': 'Returned to business',
  'name:enter branch scan': 'Received at warehouse', 'name:holding scan': 'Exception' };
// آخر حالة بعد تطبيق المسحات بالترتيب — نفس منطق jt_apply_trace (refund = خام بس)
function finalStatus(scans, start) {
  let st = start;
  for (const s of scans) {
    if (s.scanCode.startsWith('refund:')) continue;
    const t = MAP[s.scanCode]; if (!t || t === st) continue;
    const fin = ['Delivered', 'Returned to business', 'cancelled'].includes(st);
    if (fin && !['Delivered', 'Returned to business'].includes(t)) continue;
    st = t;
  }
  return st;
}
const D = (t, c, n) => ({ scanTime: t, scanTypeCode: c, scanType: n, desc: '' });

// 17309 — الأحدث الأول زي رد J&T بالظبط
const B17309 = [
  D('2026-09-27 19:11:07', 100, 'Signing scan'),
  D('2026-09-27 17:55:37', 110, 'Abnormal parcels scan'),
  D('2026-09-27 10:33:18', 94, 'Delivery scan'),
  D('2026-09-26 21:20:28', 120, 'Left Over Scan'),
  D('2026-09-26 21:19:30', 110, 'Abnormal parcels scan'),
  D('2026-09-26 11:01:19', 94, 'Delivery scan'),
  D('2026-09-26 11:00:38', 94, 'Delivery scan'),
  D('2026-09-26 09:55:57', 92, 'Arrival Scan'),
  D('2026-09-24 23:52:03', 50, 'Sending scan'),
  D('2026-09-24 23:35:39', 92, 'Arrival Scan'),
  D('2026-09-24 16:56:44', 50, 'Sending scan'),
  D('2026-09-24 16:54:46', 10, 'Pickup scan'),
];
// JEG000530263155 — مرتجع كامل: 172 ثم رحلة الرجوع ثم 111
const BRET = [
  D('2026-09-25 12:18:30', 111, 'Return Sign'),
  D('2026-09-25 11:16:50', 94, 'Delivery scan'),
  D('2026-09-25 04:14:13', 92, 'Arrival Scan'),
  D('2026-09-24 22:52:24', 50, 'Sending scan'),
  D('2026-09-24 22:42:23', 92, 'Arrival Scan'),
  D('2026-09-24 12:51:50', 50, 'Sending scan'),
  D('2026-09-24 10:15:47', 172, 'Returned parcel scan'),
  D('2026-09-23 21:09:26', 120, 'Left Over Scan'),
  D('2026-09-23 12:30:12', 110, 'Abnormal parcels scan'),
  D('2026-09-23 11:21:54', 94, 'Delivery scan'),
  D('2026-09-23 10:40:26', 92, 'Arrival Scan'),
  D('2026-09-22 18:43:27', 10, 'Pickup scan'),
];

async function suite(jt, label) {
  const r = {};
  const s1 = jt.jtPullScans(B17309);
  r.sorted = s1.map((s) => s.rawTime).join() === [...B17309].reverse().map((d) => d.scanTime).join();
  r.noRefund1 = s1.every((s) => !s.refund);
  r.final1 = finalStatus(s1, 'BOSTA AUTO');
  // اللي عندنا: آخر push = 110 الساعة 17:55:37 (+02) — المفروض يتطبّق مسح التسليم بس
  const pend = jt.jtScansToApply(s1, '2026-09-27T15:55:37.000Z', '110');
  r.pending = pend.map((s) => s.scanCode).join();
  r.pendFinal = finalStatus(pend, 'Exception');
  const s2 = jt.jtPullScans(BRET);
  r.retCodes = s2.map((s) => s.scanCode).join();
  r.final2 = finalStatus(s2, 'BOSTA AUTO');
  // لو آخر push كان «مرتجع» (172) — الـpull بعده مايرجّعش الأوردر للسكة
  r.afterRet = finalStatus(jt.jtScansToApply(s2, '2026-09-24T08:15:47.000Z', '172'), 'Returned to business');
  // أوردر لسه مالوش مسح تتبع (order:*) → كل المسحات
  r.orderOnly = jt.jtScansToApply(s1, '2026-09-24T14:58:21.000Z', 'order:已揽收').length;
  // Holding scan بيتخزن بكود فاضي والوقت موجود → الوقت بيحكم (أول تشغيل حي 30 سبتمبر)
  r.emptyCode = jt.jtScansToApply(s1, '2026-09-27T15:55:37.000Z', '').map((s) => s.scanCode).join();
  // ومفيش وقت خالص → كله
  r.noTime = jt.jtScansToApply(s1, null, '').length;
  // توقيت متساوي: الأقرب لآخر المصفوفة أقدم
  const tie = jt.jtPullScans([D('2026-09-27 10:00:00', 110, 'A'), D('2026-09-27 10:00:00', 94, 'B')]);
  r.tie = tie.map((s) => s.scanCode).join();
  return r;
}

console.log('──── الدوال النقية ────');
const jt = await import(pathToFileURL(path.join(SHARED, 'jt.ts')).href);
const r = await suite(jt);
ok(r.sorted, '1) المسحات بتترتب زمنياً (J&T بترجّعها الأحدث الأول)');
ok(r.noRefund1, '2) أوردر مسلّم مافيهوش ولا مسح مرتجع');
ok(r.final1 === 'Delivered', `3) 17309 من الأول للآخر = Delivered (${r.final1})`);
ok(r.pending === '100', `4) 🔴 من آخر push (110 · 17:55) الناقص مسح التسليم بس (${r.pending})`);
ok(r.pendFinal === 'Delivered', `5) 🔴 وتطبيقه بيحوّل «استثناء» → Delivered (${r.pendFinal})`);
ok(r.retCodes === '10,92,94,110,120,172,refund:50,refund:92,refund:50,refund:92,refund:94,111',
   `6) 🔴 رحلة المرتجع بعد 172 بتتعلّم refund: و172/111 لأ (${r.retCodes})`);
ok(r.final2 === 'Returned to business', `7) المرتجع الكامل = Returned to business (${r.final2})`);
ok(r.afterRet === 'Returned to business', `8) 🔴 مرتجع + مسحات رحلة الرجوع مايرجّعوهوش «خرج للتسليم» (${r.afterRet})`);
ok(r.orderOnly === B17309.length, `9) أوردر من غير مسح تتبع (order:*) بياخد كل المسحات (${r.orderOnly})`);
ok(r.emptyCode === '100', `10أ) 🔴 كود فاضي (Holding scan) + وقت → الأحدث بس مش الرحلة كلها (${r.emptyCode})`);
ok(r.noTime === B17309.length, `10ب) من غير وقت خالص → كل المسحات (${r.noTime})`);
ok(r.tie === '94,110', `10) توقيت متساوي: ترتيب J&T محفوظ (${r.tie})`);

console.log('──── parseJtTime = نسخة jt-status بالحرف ────');
const m = STATUS_SRC.match(/function parseJtTime\(s: unknown\): string \| null \{[\s\S]*?\n\}/);
ok(!!m, '11أ) لقينا parseJtTime في jt-status');
const statusFn = m ? new Function('return (' + m[0].replace('(s: unknown): string | null', '(s)') + ')')() : null;
const samples = ['2026-09-27 19:11:07', '2026-03-01 00:00:00', '2026-12-31 23:59:59', '2026-07-15 02:30', '2026-09-27T19:11:07', '', 'غلط', null];
for (let i = 0; i < 40; i++) {
  const d = new Date(Date.UTC(2026, i % 12, 1 + (i * 7) % 28, (i * 5) % 24, (i * 13) % 60, (i * 17) % 60));
  samples.push(d.toISOString().slice(0, 19).replace('T', ' '));
}
const diffs = statusFn ? samples.filter((x) => jt.parseJtTime(x) !== statusFn(x)) : samples;
ok(diffs.length === 0, `11ب) 🔴 المشتركة = jt-status على ${samples.length} قيمة (اختلاف: ${JSON.stringify(diffs.slice(0, 3))})`);
ok(jt.parseJtTime('2026-09-27 19:11:07') === '2026-09-27T17:11:07.000Z', '11ج) UTC+2 ثابت حتى في الصيف');

console.log('──── المعايرات ────');
{
  const j = await loadJt((s) => s.replace('if (code === "172") returning = true;', ''));
  const x = await suite(j);
  ok(x.afterRet !== 'Returned to business' || !x.retCodes.includes('refund:'),
     `معايرة أ: من غير استنتاج المرتجع بقى «${x.afterRet}» — فحص 6/8 بيمسكها`);
}
{
  const j = await loadJt((s) => s.replace('.sort((a, b) => a.t.localeCompare(b.t) || b.i - a.i);', ';'));
  const x = await suite(j);
  ok(!x.sorted || x.final1 !== 'Delivered', `معايرة ب: من غير الترتيب النهائي بقى «${x.final1}» — فحص 1/3 بيمسكها`);
}
{
  const j = await loadJt((s) => s.replace('Date.parse(s.scanAt) > since', 'Date.parse(s.scanAt) >= since'));
  const x = await suite(j);
  ok(x.pending !== '100', `معايرة ج: بـ>= رجع المسح اللي اتطبّق تاني (${x.pending}) — فحص 4 بيمسكها`);
}
{
  const dst = m ? m[0].replace('utc - 120 * 60000', 'utc - 180 * 60000') : '';
  const f = dst ? new Function('return (' + dst.replace('(s: unknown): string | null', '(s)') + ')')() : null;
  const d2 = f ? samples.filter((x) => jt.parseJtTime(x) !== f(x)) : [];
  ok(d2.length > 0, `معايرة د: jt-status بـ+3 اختلفت في ${d2.length} قيمة — فحص 11ب بيمسكها`);
}

{
  const j = await loadJt((s) => s.replace('if (code.startsWith("order:") ||', 'if (!code || code.startsWith("order:") ||'));
  const x = await suite(j);
  ok(x.emptyCode !== '100', `معايرة هـ: رجوع «الكود الفاضي = كله» رجّع ${x.emptyCode.split(',').length} مسح — فحص 10أ بيمسكها`);
}

console.log(bad ? `\n❌ ${bad} فحص وقع` : '\n✅ كل الفحوص عدّت');
process.exit(bad ? 1 : 0);
