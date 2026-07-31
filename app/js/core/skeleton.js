// صفوف هيكلية (skeleton) — بتظهر مكان المحتوى وهو بيتجلب من السيرفر
//
// مكمّلة لحجاب التحميل (core/veil.js) مش بديلة له: الحجاب لأول دخول
// التاب في الجلسة، ودي للجلبات اللي جوه الصفحة — فلترة، بحث، قلب صفحة،
// تغيير مدة — اللي الحجاب عمداً مش بيظهر فيها.
//
// المحتوى الحقيقي بيحل مكان الأشكال في نفس الأماكن فمفيش قفزة، والعين
// بتقرا "جدول جاي" بدل ما تستنى spinner. النصوص كلها ثابتة من الكود.

// صفوف جدول: كل صف شرايط بعرض أعمدة الأوردرات تقريباً (RTL)
export function skelTable(n){
  var widths = [3, 8, 9, 13, 10, 8, 16, 12, 8, 7]; // نِسَب أعمدة الجدول تقريبية
  var row = '<div class="skel-row">' + widths.map(function(w){
    return '<span class="skel-bar" style="width:' + w + '%"></span>';
  }).join('') + '</div>';
  var out = '<div class="skel" role="status" aria-label="جاري التحميل">';
  for(var i = 0; i < (n || 8); i++) out += row;
  return out + '</div>';
}

// قايمة محادثات: دايرة (أفاتار) + سطرين
export function skelList(n){
  var item = '<div class="skel-item">'
    + '<span class="skel-circle"></span>'
    + '<span class="skel-lines"><span class="skel-bar" style="width:55%"></span>'
    + '<span class="skel-bar thin" style="width:80%"></span></span></div>';
  var out = '<div class="skel" role="status" aria-label="جاري التحميل">';
  for(var i = 0; i < (n || 6); i++) out += item;
  return out + '</div>';
}
