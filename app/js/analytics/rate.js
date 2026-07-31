// عتبات جودة النسب — مشتركة بين جدول أداء المنتجات وجدول المنصات
// وكالندر أداء الأيام، عشان "كويس" و"وحش" يبقى لهم معنى واحد في كل مكان.
//
// العتبات: ≥75 كويس (أخضر) · 60–75 متوسط (أصفر) · <60 وحش (أحمر).
// invert=true للنسب اللي قلّتها هي الكويسة (المرتجع/الفشل) — التقييم
// بيتقلب لكن الرقم المعروض بيفضل زي ما هو.

export function rateClass(p, invert){
  if(p == null || isNaN(p)) return 'none';
  var v = invert ? 100 - p : p;
  if(v >= 75) return 'good';
  if(v >= 60) return 'mid';
  return 'bad';
}

export function ratePill(p, invert){
  if(p == null || isNaN(p)) return '<span class="rpill none">—</span>';
  return '<span class="rpill ' + rateClass(p, invert) + '"><span class="bdot"></span>' + p.toFixed(1) + '%</span>';
}

// جودة اليوم في الكالندر: متوسط النسب المتاحة (تأكيد و/أو تسليم).
// 5 درجات عشان التدرج يبان: ممتاز/كويس/متوسط/ضعيف/وحش، وnull = مفيش بيانات.
export function dayQuality(confRate, delivRate){
  var vals = [];
  if(confRate != null && !isNaN(confRate)) vals.push(confRate);
  if(delivRate != null && !isNaN(delivRate)) vals.push(delivRate);
  if(!vals.length) return { cls: 'q-none', score: null };
  var s = vals.reduce(function(a, b){ return a + b; }, 0) / vals.length;
  if(s >= 85) return { cls: 'q-good', score: s };
  if(s >= 75) return { cls: 'q-ok',   score: s };
  if(s >= 60) return { cls: 'q-mid',  score: s };
  if(s >= 45) return { cls: 'q-weak', score: s };
  return { cls: 'q-bad', score: s };
}
