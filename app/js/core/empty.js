// حالة فاضية موحّدة — إيه ده + ليه فاضي + أول خطوة أعملها
//
// كل جدول/قايمة فاضية كانت بتطبع سطر ميّت زي "لا توجد منتجات" — فصحى
// ناشفة وسط منتج كله مصري، ومن غير أي توجيه. الدالة دي بتبني بلوك
// موحّد: أيقونة + عنوان + شرح + زرار CTA اختياري.
//
// الـCTA بيشتغل بـdata-act (الموزّع في main.js) — ممنوع أي onclick
// مضمّن بالـCSP. والأكشنز الأدمن بتاخد class="admin-only" فتتخفي
// للموظف تلقائياً من CSS الأدوار.
//
// النصوص كلها ثابتة من الكود — مفيش أي بيانات مستخدم بتتحقن هنا.

export function emptyState(o){
  var h = '<div class="empt">'
    + '<div class="empt-ico">' + (o.icon || '📭') + '</div>'
    + '<div class="empt-title">' + o.title + '</div>';
  if(o.sub) h += '<div class="empt-sub">' + o.sub + '</div>';
  if(o.act) h += '<button type="button" class="empt-btn' + (o.adminOnly ? ' admin-only' : '') + '" data-act="' + o.act + '">' + o.actLabel + '</button>';
  return h + '</div>';
}
