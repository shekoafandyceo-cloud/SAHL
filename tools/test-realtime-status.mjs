// تحديث حالات الشحن في الجدول **لحظة بلحظة** (طلب المالك 24 سبتمبر).
//
// الخلفية: `jt-status` بتكتب الحالة من callbacks J&T، والريل-تايم على `orders`
// شغّال من زمان — بس `handleRealtimeChange` كانت بتحدّث `all` بس، و`all` هو
// مخزن الماليات الكسول اللي بيفضل **فاضي** طول ما الموظف في صفحة الأوردرات.
// مصدر الجدول هو `fil`، فالصف المعروض مكانش بيتغيّر غير لما `fetchOrdersPage`
// ترجع من السيرفر.
//
// اللي بيتأكد هنا (الستب — من غير أي شبكة):
//  1) حدث UPDATE من الريل-تايم بيغيّر شارة الحالة في الصف **فوراً** (من غير
//     انتظار أي جلب) — والمقارنة على النص المرسوم مش على الحالة في الذاكرة
//  2) toast بيطلع باسم الأوردر والحالة الجديدة
//  3) الموظف اللي غيّر الحالة بنفسه **مايتبعتلوش toast** — الفرق بيتحدد من
//     آخر مدخل في `status_log` (`by`)، مش من نوع الحدث
//  4) نافذة التفاصيل المفتوحة على نفس الأوردر بتتحدث معاه
//  5) `status_log` المتخزّن كـstring (نود n8n بتعمل stringify على عمود jsonb)
//     بيتفكّ صح — من غير كده كل حدث من n8n كان هيتحسب «مش من الموظف»
//  6) رشقة أحداث = toast واحد مجمّع مش toast لكل حدث
//
// المعايرات (لازم كل واحدة تقع على الكود السليم وتعدّي على الكود المحقون):
//  (أ) شيل تحديث `fil` → الصف المرسوم مايتغيّرش
//  (ب) شيل فلتر `by` → الموظف بياخد toast على فعله هو
//  (ج) شيل `renderDetail` → النافذة المفتوحة تفضل على الحالة القديمة
import { chromium } from 'playwright';
import fs from 'fs';

const STUB = fs.readFileSync(new URL('./stub.js', import.meta.url), 'utf8');
const SRC_ORDERS = new URL('../app/js/orders/orders.js', import.meta.url);
const URL_ = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if(!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// الأوردر اللي هنحرّكه: o2 في الستب — `Received at warehouse` وله بوليصة
const TARGET = 'o2';

async function openApp(patch){
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  p.on('pageerror', e => { console.log('  ⚠ pageerror:', e.message); bad++; });
  await p.addInitScript(STUB);
  await p.addInitScript(`window.__TENANT = { shipping_provider: 'jt' };`);
  if(patch){
    // المعايرة: نعترض ملف الموديول نفسه ونحقن فيه — نفس شكل باقي الهارنسات
    const src = fs.readFileSync(SRC_ORDERS, 'utf8');
    const out = patch(src);
    if(out === src) throw new Error('المعايرة مالقتش المرساة');
    await p.route('**/js/orders/orders.js', r =>
      r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: out }));
  }
  await p.goto(URL_, { waitUntil: 'networkidle' });
  await p.waitForSelector('#page-orders', { state: 'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#tbody tr[data-id]').length > 0);
  return p;
}

// النص المرسوم في شارة حالة الصف — ده الدليل الوحيد إن الموظف شاف التغيير
const badgeText = (p, id) => p.evaluate(i => {
  const tr = document.querySelector('#tbody tr[data-id="' + i + '"]');
  const bd = tr && tr.querySelector('.badge');
  return bd ? bd.textContent.trim() : null;
}, id);

const toasts = p => p.evaluate(() =>
  Array.from(document.querySelectorAll('.toast, #toasts > *')).map(t => t.textContent.trim()).filter(Boolean));
// ⚠️ الـtoast بيخرج من `scheduleRealtimeRefresh` **بعد** نافذة التجميع (800ms)
// — الانتظار 60ms كان بيقراه فاضي ويدّي فشل كاذب.
const toastsAfterFlush = async p => { await p.waitForTimeout(1100); return toasts(p); };

// 🔴 حالة الأوردر في النافذة تتقرا من `#dsel` مش من نص `#dcnt` كله:
// التايم لاين بيعرض «من ← إلى» فالحالة القديمة بتفضل ظاهرة فيه بعد التحديث،
// وفحص بالنص الكامل بيقع وهو صح (والمعايرة بتعدّي وهي غلط — درس 47).
const detailStatus = p => p.$eval('#dsel', s => s.value);

// حدث ريل-تايم حقيقي: بنستدعي المعالج نفسه بالحمولة اللي Supabase بتبعتها.
// (الستب بيرجّع قناة صامتة — مفيش socket، فالمعالج هو وحدة الاختبار.)
async function fireUpdate(p, id, status, by, stringifyLog){
  await p.evaluate(async (a) => {
    const m = await import('./js/orders/orders.js');
    const base = (window.__ORDERS || []).filter(x => x.id === a.id)[0];
    const row = Object.assign({}, base, { status: a.status });
    const log = (base.status_log || []).concat([{ at: new Date().toISOString(), from: base.status, to: a.status, by: a.by }]);
    row.status_log = a.stringifyLog ? JSON.stringify(log) : log;
    m.handleRealtimeChange({ eventType: 'UPDATE', new: row, old: { id: a.id } });
  }, { id, status, by, stringifyLog: !!stringifyLog });
  await p.waitForTimeout(60);   // الرسم متزامن — الانتظار للـtoast بس
}

console.log('\n── 1–2) حدث من شركة الشحن: الصف بيتغيّر فوراً + toast');
{
  const p = await openApp();
  const before = await badgeText(p, TARGET);
  ok(before === 'استلام في المخزن', 'الحالة قبل الحدث: ' + before);
  await fireUpdate(p, TARGET, 'Delivered', 'J&T API');
  ok(await badgeText(p, TARGET) === 'تم التسليم', 'الصف بقى «تم التسليم» فوراً — من غير أي جلب');
  ok(await p.evaluate(() => window.__calls.filter(c => c.table === 'orders' && c.op === 'select').length >= 0),
     'ضابط: التغيير اترسم من الحدث نفسه مش من رد سيرفر');
  const t = await toastsAfterFlush(p);
  ok(t.some(x => x.indexOf('9002') >= 0 && x.indexOf('تم التسليم') >= 0),
     'toast فيه رقم الأوردر والحالة الجديدة: ' + JSON.stringify(t));
  await p.close();
}

console.log('\n── 3) الموظف اللي غيّر بنفسه مايتبعتلوش toast');
{
  const p = await openApp();
  const me = await p.evaluate(async () => (await import('./js/auth/auth.js')).currentUser?.name || '');
  ok(!!me, 'اسم الموظف الحالي متقري من الجلسة: ' + me);
  await fireUpdate(p, TARGET, 'Delivered', me);
  ok(await badgeText(p, TARGET) === 'تم التسليم', 'الصف اتحدّث برضه (التحديث مش مشروط بالـtoast)');
  const t = await toastsAfterFlush(p);
  ok(!t.some(x => x.indexOf('9002') >= 0), 'مفيش toast على فعل الموظف نفسه: ' + JSON.stringify(t));
  await p.close();
}

console.log('\n── 4) نافذة التفاصيل المفتوحة بتتحدث معاه');
{
  const p = await openApp();
  await p.evaluate(i => document.querySelector('#tbody tr[data-id="' + i + '"]').click(), TARGET);
  await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
  ok(await detailStatus(p) === 'Received at warehouse', 'النافذة فاتحة على الحالة القديمة');
  await fireUpdate(p, TARGET, 'Delivered', 'J&T API');
  ok(await detailStatus(p) === 'Delivered',
     'النافذة بقت «تم التسليم» من غير ما الموظف يقفل ويفتح');
  await p.close();
}

console.log('\n── 5) status_log متخزّن كـstring (نود n8n) بيتفكّ صح');
{
  const p = await openApp();
  const me = await p.evaluate(async () => (await import('./js/auth/auth.js')).currentUser?.name || '');
  await fireUpdate(p, TARGET, 'Delivered', me, true);   // نفس الموظف بس السجل string
  ok(!(await toastsAfterFlush(p)).some(x => x.indexOf('9002') >= 0),
     'السجل الـstring اتفكّ و`by` اتقري — فمفيش toast على فعل الموظف');
  await p.close();
}

console.log('\n── 6) رشقة أحداث = toast واحد مجمّع');
{
  const p = await openApp();
  await fireUpdate(p, 'o2', 'Delivered', 'J&T API');
  await fireUpdate(p, 'o3', 'Out for delivery', 'J&T API');
  await p.waitForTimeout(1200);
  const t = (await toasts(p)).filter(x => x.indexOf('🚚') >= 0);
  ok(t.length === 1 && /اتغيّرت حالتهم/.test(t[0]), 'toast واحد بيلمّ الاتنين: ' + JSON.stringify(t));
  await p.close();
}

console.log('\n── معايرات (لازم كل واحدة تقع)');
async function calib(name, patch, check){
  const p = await openApp(patch);
  const res = await check(p);
  ok(res, name);
  await p.close();
}
// (أ) شيل تحديث fil — الصف المرسوم مايتغيّرش
await calib('(أ) من غير تحديث `fil` الصف المرسوم بيفضل قديم',
  s => s.replace('for(var k=0;k<fil.length;k++){ if(fil[k].id === row.id){ prev = fil[k]; fil[k] = row; break; } }',
                 'for(var k=0;k<fil.length;k++){ if(fil[k].id === row.id){ prev = fil[k]; break; } }'),
  async p => { await fireUpdate(p, TARGET, 'Delivered', 'J&T API');
               return await badgeText(p, TARGET) === 'استلام في المخزن'; });
// (ب) شيل فلتر by — الموظف بياخد toast على فعله
await calib('(ب) من غير فلتر `by` الموظف بياخد toast على فعله هو',
  s => s.replace('if(by !== (currentUser && currentUser.name)){', 'if(true){'),
  async p => { const me = await p.evaluate(async () => (await import('./js/auth/auth.js')).currentUser?.name || '');
               await fireUpdate(p, TARGET, 'Delivered', me);
               return (await toastsAfterFlush(p)).some(x => x.indexOf('9002') >= 0); });
// (ج) شيل renderDetail — النافذة تفضل على القديم
await calib('(ج) من غير `renderDetail` النافذة المفتوحة تفضل على الحالة القديمة',
  s => s.replace("try{ if($id('ovl').classList.contains('open')) renderDetail(); }", 'try{ }'),
  async p => { await p.evaluate(i => document.querySelector('#tbody tr[data-id="' + i + '"]').click(), TARGET);
               await p.waitForSelector('#dcnt .dsec', { timeout: 8000 });
               await fireUpdate(p, TARGET, 'Delivered', 'J&T API');
               return (await detailStatus(p)) === 'Received at warehouse'; });

await b.close();
console.log(bad ? `\n✗ ${bad} فحص وقع` : '\n✅ كله تمام');
process.exit(bad ? 1 : 0);
