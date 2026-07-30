// عميل Supabase — مصدر واحد لكل الموديولات
//
// `sb` مصدَّرة كـlet عشان الـlive binding: أي موديول بيستوردها بيشوف
// القيمة الحالية، مش نسخة وقت الاستيراد. عشان كده الـ64 استخدام
// (sb.from / sb.auth / sb.functions ...) بتفضل زي ما هي بالظبط.
//
// الكتابة من مكان واحد بس — setSb() اللي بتتنادى من initApp. الإسناد
// المباشر لـbinding مستورد من موديول تاني بيرمي TypeError وقت الربط.
//
// ⚠️ بتفضل null لحد ما initApp تشتغل. متقراهاش على مستوى الموديول
//    (خارج أي دالة) — هتلاقيها null. كل الاستخدامات الحالية جوه دوال.

export let sb = null;

export function setSb(client) {
  if (!client) throw new Error('setSb: عميل فاضي');
  sb = client;
}
