// تشغيل الهارنسات بتاريخ ثابت (CLOCK=2026-10-15T10:00:00Z node --import ./clock-preload.mjs test-x.mjs)
// 🔴 ليه: الفيكستشر في stub.js بتواريخ «إمبارح وأول إمبارح»، والجدول على «الشهر الحالي»
// افتراضياً — فأول يومين في أي شهر الأوردرات بتقع في الشهر اللي فات والجدول بيبان فاضي
// (اتلسعنا فيها 1 أكتوبر: كل الهارنسات وقعت بـtimeout من غير أي باج). setFixedTime بتثبّت
// Date بس والـtimers بتفضل شغّالة.
import { chromium } from 'playwright';
const T = process.env.CLOCK;
// ⚠️ الساعة ثابتة — الهارنسات اللي بتستنى وقت يعدّي (test-ship: «60 ثانية من غير بوليصة»)
// مابتنفعش بيه، والهارنسات اللي بتحسب الفيكستشر في Node بالساعة الحقيقية (test-wa-*) تتشغّل من غيره.
// 🔴 وبيمنع supabase-js الحقيقي من الـCDN: الستب بيحط window.supabase مزيّف قبل أي سكربت،
// ولو المتصفح قدر يحمّل المكتبة الحقيقية (بيئة بتثق في شهادة البروكسي) بتكتب فوقه واللوحة
// بتقف على اللوجين — كل الهارنسات بتقع بـtimeout من غير أي باج (اتلسعنا 1 أكتوبر).
const blockSb = (x) => x.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, (r) => r.abort());
const pin = async (x) => { await blockSb(x); if (T) await x.clock.setFixedTime(new Date(T)); };
{
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...a) => {
    const b = await launch(...a);
    const wrap = (obj) => {
      const np = obj.newPage.bind(obj);
      obj.newPage = async (...x) => { const p = await np(...x); await pin(p); return p; };
    };
    wrap(b);
    const nc = b.newContext.bind(b);
    // ⚠️ على مستوى الـcontext لازم يتثبّت **فور الإنشاء** — قبل أي ctx.addInitScript(STUB)،
    // وإلا الستب بيحسب تواريخ الفيكستشر بالساعة الحقيقية (init scripts بتشتغل بترتيب إضافتها).
    b.newContext = async (...x) => { const c = await nc(...x); await pin(c); return c; };
    return b;
  };
}
