// نسبة استلام العميل — مصدرين (طلب المالك 7 أكتوبر):
//  1) EasyOrders: eo_rate / eo_rate_alt — **تصنيف مش نسبة** (high · moderate · low · unknown)
//     + 'pending' لو EasyOrders ماكانتش خلصت الحساب لحظة ما الطلب وصل. بيتحسب على السيرفر
//     (trg_eo_rate_capture) من الـmetadata الخام — الواجهة بتعرض بس، عمرها ما بتحسب.
//     المعاني منقولة من لوحة EasyOrders نفسها: unknown = «عميل جديد (لا توجد طلبات)»،
//     والشريط 5/3/1/0 من 5 زي ما بيترسم عندهم بالظبط.
//  2) شركة الشحن: customer_ranking — نسبة % حقيقية (تم التسليم ÷ الكل) بنفس حدود الشارة القديمة.
// 🔴 مفيش «متوسط» بين الاتنين لسه: تصنيف + نسبة مايتجمعوش من غير قاعدة، والقاعدة قرار المالك
// (الخطوة التانية — بوسطة). لحد ما يتقرر: شارة واحدة في الجدول (EasyOrders الأول) — صفر رقم مخترع.
import { esc } from '../core/dom.js';
import { RANK_GOOD, RANK_MID } from './table.js';

export var EO_RATES = {
  high:     { lbl: 'مرتفعة', tag: 'جامد', cls: 'rk-good', steps: 5 },
  moderate: { lbl: 'متوسطة', tag: 'متوسط', cls: 'rk-mid', steps: 3 },
  low:      { lbl: 'منخفضة', tag: 'زبالة', cls: 'rk-bad', steps: 1 },
  unknown:  { lbl: 'عميل جديد — مالوش طلبات قبل كده', tag: 'جديد', cls: 'rk-new', steps: 0 }
};

// نسبة شركة الشحن كرقم — أو null لو مفيش (مش 0: الصفر نسبة حقيقية = ولا طلب اتسلّم)
export function shipRank(o){
  if(!o || o.customer_ranking === null || o.customer_ranking === undefined || o.customer_ranking === '') return null;
  var n = Number(o.customer_ranking);
  return isNaN(n) ? null : n;
}
function shipTier(n){
  return n >= RANK_GOOD ? { cls: 'rk-good', tag: 'جامد' } : (n >= RANK_MID ? { cls: 'rk-mid', tag: 'متوسط' } : { cls: 'rk-bad', tag: 'زبالة' });
}

// شارة الجدول (جنب اسم العميل) — **واحدة بس**: EasyOrders الأول، ولو مفيش فشركة الشحن، والتلميح
// فيه المصدرين لو الاتنين موجودين (شارتين جنب بعض بيتقصّوا في عمود الاسم — اتشاف في الصورة).
// pending وقيمة جديدة مش معروفة = مفيش شارة EasyOrders (التفاصيل بتقولها بالكلام) — شارة «⏳»
// كانت هتفضل للأبد لأن مفيش تحديث بييجي بعد الطلب.
export function deliveryScoreBadges(o){
  var e = o && EO_RATES[o.eo_rate];
  var n = shipRank(o);
  var shipTxt = n !== null ? 'نسبة استلام العميل عبر شركة الشحن: ' + n.toFixed(1) + '%' : '';
  if(e){
    var t1 = 'نسبة استلام العميل عند EasyOrders: ' + e.lbl + (shipTxt ? ' · ' + shipTxt : '');
    return '<span class="rk-badge ' + e.cls + ' eo-badge" title="' + esc(t1) + '">' + e.tag + '</span>';
  }
  if(n !== null){
    var t = shipTier(n);
    return '<span class="rk-badge ' + t.cls + ' ship-badge" title="' + esc(shipTxt) + '">' + t.tag + '</span>';
  }
  return '';
}

function eoMeter(e){
  var s = '';
  for(var i = 1; i <= 5; i++) s += '<i class="' + (i <= e.steps ? 'on' : '') + '"></i>';
  return '<span class="eo-meter ' + e.cls + '" aria-hidden="true">' + s + '</span>';
}
function muted(t){ return '<span class="dval ar ds-muted">' + t + '</span>'; }

// قيمة EasyOrders لرقم واحد → HTML الخانة
export function eoRateCell(v){
  if(v === null || v === undefined || v === '') return muted('مفيش تقييم');
  if(v === 'pending') return muted('⏳ EasyOrders ماكانتش خلّصت الحساب لحظة ما الطلب وصل');
  var e = EO_RATES[v];
  if(!e) return muted('قيمة جديدة من EasyOrders: ' + esc(String(v)));
  return '<span class="dval ar ds-eo">' + eoMeter(e) + '<span class="rk-badge ' + e.cls + '" style="margin:0">' + esc(e.lbl) + '</span></span>';
}

function shipCell(o){
  var n = shipRank(o);
  if(n === null) return muted('مفيش بيانات');
  var t = shipTier(n);
  return '<span class="dval ds-ship"><span class="rk-badge ' + t.cls + '" style="margin:0">' + t.tag + '</span> <span style="font-family:\'JetBrains Mono\',monospace">' + n.toFixed(1) + '%</span></span>';
}

// قسم «نسبة استلام العميل» في نافذة التفاصيل — بيظهر دايماً (الخانتين)، والفاضي بيتقال «مفيش»
export function deliveryScoreSection(o){
  var row = function(k, v, id){ return '<div class="drow"' + (id ? ' id="' + id + '"' : '') + '><span class="dkey">' + k + '</span>' + v + '</div>'; };
  var h = '<div class="dsec" data-tone="green" id="ds-sec"><div class="dstt"><span class="dstt-ico">📊</span>نسبة استلام العميل</div>'
    + row('EasyOrders', eoRateCell(o.eo_rate), 'ds-eo');
  // الرقم الإضافي: سطر بس لو EasyOrders قيّمته فعلاً (أغلب الأوردرات مالهاش رقم إضافي)
  if(o.alt_phone && o.eo_rate_alt !== null && o.eo_rate_alt !== undefined && o.eo_rate_alt !== '')
    h += row('EasyOrders — الرقم الإضافي', eoRateCell(o.eo_rate_alt), 'ds-eo-alt');
  h += row('شركة الشحن', shipCell(o), 'ds-ship') + '</div>';
  return h;
}
