// نسبة استلام العميل — مصدرين (طلب المالك 7 أكتوبر · الخطوة التانية 10 أكتوبر):
//  1) EasyOrders: eo_rate / eo_rate_alt — **تصنيف مش نسبة** (high · moderate · low · unknown)
//     + 'pending' لو EasyOrders ماكانتش خلصت الحساب لحظة ما الطلب وصل. بيتحسب على السيرفر
//     (trg_eo_rate_capture) من الـmetadata الخام — الواجهة بتعرض بس، عمرها ما بتحسب.
//     المعاني منقولة من لوحة EasyOrders نفسها: unknown = «عميل جديد (لا توجد طلبات)»،
//     والشريط 5/3/1/0 من 5 زي ما بيترسم عندهم بالظبط.
//  2) شركة الشحن: ship_rank (%) + ship_rank_n (عدد شحناته المحسومة عندهم) + ship_rank_at (إمتى اتسأل) — من
//     ship-rank-sync (بوسطة /consignee/ranking بالتليفون بس — من غير شحنة · 10 أكتوبر). n = 0 = عميل جديد عندهم.
//     لو ماتسألش (أوردرات قبل 10 أكتوبر — أقدم من أسبوع) = customer_ranking القديم (اتسجّل وقت الشحن معاهم).
// 🔴 الشارة في الجدول = «متوسط الاتنين» (طلب المالك 7 أكتوبر): EasyOrders بالدرجات بتاعة شريطهم (5/3/1 من 5 =
// 100/60/20) وشركة الشحن بالنسبة نفسها، ومتوسط الموجود منهم بنفس حدود الشارة القديمة (جامد ≥80 · متوسط ≥50).
// مصدر واحد بس = هو لوحده (نفس الشكل اللي كان قبل كده بالظبط). الاتنين «جديد» = «جديد». التلميح فيه المصدرين.
import { esc } from '../core/dom.js';
import { RANK_GOOD, RANK_MID } from './table.js';

export var EO_RATES = {
  high:     { lbl: 'مرتفعة', tag: 'جامد', cls: 'rk-good', steps: 5 },
  moderate: { lbl: 'متوسطة', tag: 'متوسط', cls: 'rk-mid', steps: 3 },
  low:      { lbl: 'منخفضة', tag: 'زبالة', cls: 'rk-bad', steps: 1 },
  unknown:  { lbl: 'عميل جديد — مالوش طلبات قبل كده', tag: 'جديد', cls: 'rk-new', steps: 0 }
};

function num(v){
  if(v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// شركة الشحن لرقم الأوردر الأساسي:
//  { kind:'rate', rate, n } · { kind:'new' } (اتسأل ومالوش شحنات عندهم) · { kind:'old', rate } (القديم وقت الشحن) · null
export function shipInfo(o){
  if(!o) return null;
  if(o.ship_rank_at){
    var n = num(o.ship_rank_n);
    var r = num(o.ship_rank);
    if(n !== null && n > 0 && r !== null) return { kind: 'rate', rate: r, n: n };
    return { kind: 'new' };
  }
  var old = num(o.customer_ranking);
  return old === null ? null : { kind: 'old', rate: old };
}
// نسبة شركة الشحن كرقم — أو null (مش 0: الصفر نسبة حقيقية = ولا طلب اتسلّم)
export function shipRank(o){
  var s = shipInfo(o);
  return s && (s.kind === 'rate' || s.kind === 'old') ? s.rate : null;
}
function tierOf(score){
  return score >= RANK_GOOD ? { cls: 'rk-good', tag: 'جامد' } : (score >= RANK_MID ? { cls: 'rk-mid', tag: 'متوسط' } : { cls: 'rk-bad', tag: 'زبالة' });
}
var EO_SCORE = { high: 100, moderate: 60, low: 20 };

function shipText(s){
  if(!s) return '';
  if(s.kind === 'new') return 'شركة الشحن: عميل جديد — مالوش شحنات قبل كده';
  if(s.kind === 'old') return 'شركة الشحن (وقت الشحن معاهم): ' + s.rate.toFixed(1) + '%';
  var d = Math.round(s.rate * s.n / 100);
  return 'شركة الشحن: ' + s.rate.toFixed(1) + '% (اتسلّم ' + d + ' من ' + s.n + ')';
}

// المتوسط اللي الشارة بتتبني عليه — null لو مفيش ولا رقم
export function deliveryScore(o){
  var eo = o && Object.prototype.hasOwnProperty.call(EO_SCORE, o.eo_rate) ? EO_SCORE[o.eo_rate] : null;
  var sh = shipRank(o);
  var parts = [];
  if(eo !== null) parts.push(eo);
  if(sh !== null) parts.push(sh);
  if(!parts.length) return null;
  var sum = 0;
  for(var i = 0; i < parts.length; i++) sum += parts[i];
  return { score: sum / parts.length, both: parts.length === 2, eo: eo, ship: sh };
}

// شارة الجدول (جنب اسم العميل) — **واحدة بس** (شارتين جنب بعض بيتقصّوا في عمود الاسم — اتشاف في الصورة).
// pending وقيمة جديدة مش معروفة من EasyOrders = مالهاش وزن (التفاصيل بتقولها بالكلام).
export function deliveryScoreBadges(o){
  var e = o && EO_RATES[o.eo_rate];
  var s = shipInfo(o);
  var tip = [];
  if(e) tip.push('EasyOrders: ' + e.lbl);
  if(s) tip.push(shipText(s));
  var ds = deliveryScore(o);
  if(ds){
    var t = tierOf(ds.score);
    var head = ds.both ? 'نسبة استلام العميل — متوسط المصدرين: ' + Math.round(ds.score) + ' من 100' : 'نسبة استلام العميل';
    return '<span class="rk-badge ' + t.cls + ' ds-badge" title="' + esc(head + ' · ' + tip.join(' · ')) + '">' + t.tag + '</span>';
  }
  // مفيش ولا رقم: «جديد» لو أي مصدر قال إنه عميل جديد
  if((e && o.eo_rate === 'unknown') || (s && s.kind === 'new'))
    return '<span class="rk-badge rk-new ds-badge" title="' + esc('نسبة استلام العميل · ' + tip.join(' · ')) + '">جديد</span>';
  return '';
}

function eoMeter(e){
  var s = '';
  for(var i = 1; i <= 5; i++) s += '<i class="' + (i <= e.steps ? 'on' : '') + '"></i>';
  return '<span class="eo-meter ' + e.cls + '" aria-hidden="true">' + s + '</span>';
}
function muted(t){ return '<span class="dval ar ds-muted">' + t + '</span>'; }
function mono(t){ return '<span style="font-family:\'JetBrains Mono\',monospace">' + t + '</span>'; }

// قيمة EasyOrders لرقم واحد → HTML الخانة
export function eoRateCell(v){
  if(v === null || v === undefined || v === '') return muted('مفيش تقييم');
  if(v === 'pending') return muted('⏳ EasyOrders ماكانتش خلّصت الحساب لحظة ما الطلب وصل');
  var e = EO_RATES[v];
  if(!e) return muted('قيمة جديدة من EasyOrders: ' + esc(String(v)));
  return '<span class="dval ar ds-eo">' + eoMeter(e) + '<span class="rk-badge ' + e.cls + '" style="margin:0">' + esc(e.lbl) + '</span></span>';
}

// خانة شركة الشحن لرقم: نسبة + اتسلّم/رجع (من الخام — النافذة بتجيب الصف كامل) · جديد · القديم وقت الشحن
function shipCellFrom(rate, n, part, isOld){
  if(isOld){
    var to = tierOf(rate);
    return '<span class="dval ds-ship"><span class="rk-badge ' + to.cls + '" style="margin:0">' + to.tag + '</span> ' + mono(rate.toFixed(1) + '%')
      + ' <span class="ds-muted">(اتسجّلت وقت الشحن معاهم)</span></span>';
  }
  if(n === null || n <= 0 || rate === null)
    return '<span class="dval ar ds-ship"><span class="rk-badge rk-new" style="margin:0">جديد</span> <span class="ds-muted">مالوش شحنات قبل كده عند شركة الشحن</span></span>';
  var t = tierOf(rate);
  var d = part && typeof part.delivered === 'number' ? part.delivered : Math.round(rate * n / 100);
  var r = part && typeof part.returned === 'number' ? part.returned : n - d;
  return '<span class="dval ds-ship"><span class="rk-badge ' + t.cls + '" style="margin:0">' + t.tag + '</span> ' + mono(rate.toFixed(1) + '%')
    + ' <span class="ds-cnt">· اتسلّم ' + mono(String(d)) + ' · رجع ' + mono(String(r)) + '</span></span>';
}
function rawPart(o, k){
  var raw = o && o.ship_rank_raw;
  if(typeof raw === 'string'){ try{ raw = JSON.parse(raw); }catch(e){ raw = null; } }
  return raw && typeof raw === 'object' && raw[k] && typeof raw[k] === 'object' ? raw[k] : null;
}
function shipCell(o){
  var s = shipInfo(o);
  if(!s) return muted('مفيش بيانات');
  if(s.kind === 'old') return shipCellFrom(s.rate, null, null, true);
  if(s.kind === 'new') return shipCellFrom(null, 0, null, false);
  return shipCellFrom(s.rate, s.n, rawPart(o, 'primary'), false);
}

// قسم «نسبة استلام العميل» في نافذة التفاصيل — بيظهر دايماً، والفاضي بيتقال «مفيش»
export function deliveryScoreSection(o){
  var row = function(k, v, id){ return '<div class="drow"' + (id ? ' id="' + id + '"' : '') + '><span class="dkey">' + k + '</span>' + v + '</div>'; };
  var h = '<div class="dsec" data-tone="green" id="ds-sec"><div class="dstt"><span class="dstt-ico">📊</span>نسبة استلام العميل</div>';
  // المتوسط اللي في الجدول — سطر بس لما المصدرين موجودين (غير كده الشارة = المصدر الوحيد)
  var ds = deliveryScore(o);
  if(ds && ds.both){
    var t = tierOf(ds.score);
    h += row('المتوسط (اللي في الجدول)', '<span class="dval ds-avg"><span class="rk-badge ' + t.cls + '" style="margin:0">' + t.tag + '</span> '
      + mono(String(Math.round(ds.score))) + ' <span class="ds-muted">من 100 — EasyOrders ' + ds.eo + ' + شركة الشحن ' + Math.round(ds.ship) + '</span></span>', 'ds-avg');
  }
  h += row('EasyOrders', eoRateCell(o.eo_rate), 'ds-eo');
  // الرقم الإضافي: سطر بس لو EasyOrders قيّمته فعلاً (أغلب الأوردرات مالهاش رقم إضافي)
  if(o.alt_phone && o.eo_rate_alt !== null && o.eo_rate_alt !== undefined && o.eo_rate_alt !== '')
    h += row('EasyOrders — الرقم الإضافي', eoRateCell(o.eo_rate_alt), 'ds-eo-alt');
  h += row('شركة الشحن', shipCell(o), 'ds-ship');
  // شركة الشحن للرقم الإضافي: بس لو اتسأل ورقمه غير الأساسي وليه شحنات عندهم
  var pa = rawPart(o, 'primary'), al = rawPart(o, 'alt');
  var altN = num(o.ship_rank_alt_n), altR = num(o.ship_rank_alt);
  if(o.alt_phone && o.ship_rank_at && al && (!pa || al.phone10 !== pa.phone10) && altN !== null && altN > 0 && altR !== null)
    h += row('شركة الشحن — الرقم الإضافي', shipCellFrom(altR, altN, al, false), 'ds-ship-alt');
  return h + '</div>';
}
