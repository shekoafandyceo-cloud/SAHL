// نسبة استلام العميل — من شركة الشحن بس (17 أكتوبر — قرار المالك: تقييم EasyOrders اتشال «مش مفيد ومضلل»).
//  ship_rank (%) + ship_rank_n (عدد شحناته المحسومة عندهم) + ship_rank_at (إمتى اتسأل) — من ship-rank-sync
//  (/consignee/ranking بالتليفون بس — من غير شحنة · 10 أكتوبر). n = 0 = عميل جديد عندهم.
//  لو ماتسألش (أوردرات قبل 10 أكتوبر) = customer_ranking القديم (اتسجّل وقت الشحن معاهم).
// 🔴 أعمدة EasyOrders (eo_rate · eo_rate_alt · eo_metadata) لسه على الجدول (تاريخ — ماتتلمسش) بس **مابتتقريش هنا خالص**:
//  كانت بتتجمع مع شركة الشحن في «متوسط الاتنين»، والقياس (17 أكتوبر) قال إنها بتلخبط الشارة — جوّه «زبالة» عند شركة الشحن
//  اللي EasyOrders قالت «منخفضة» اتسلّم منهم 64% واللي قالت «مرتفعة» 46%.
// الدرجة من النسبة نفسها (جامد ≥80 · متوسط ≥50) — نفس الرقم اللي بيتكتب في التلميح والتفاصيل، فالشارة والتفاصيل مايختلفوش.
// من المراجعة العدائية (10 أكتوبر):
//  • الأساسي «جديد» عند شركة الشحن والإضافي ليه شحنات = الشارة بالإضافي (والتلميح بيقول «الرقم الإضافي»).
//  • الموظف عدّل التليفون بعد السؤال = النسبة دي بتاعة الرقم القديم → مابتدخلش الشارة لحد ما يتسأل تاني
//    (shipP10 = app.ship_rank_p10 بالحرف — نفس القواعد، فالمقارنة بالرقم اللي اتسأل فعلاً).
import { esc } from '../core/dom.js';
import { RANK_GOOD, RANK_MID } from './table.js';

function num(v){
  if(v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// = app.ship_rank_p10 بالحرف: موبايل مصري بس (1x · 01x · 201x · 2001x · 00201x — والتالت 0/1/2/5) → آخر 10 أرقام · غير كده null
var AR_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
export function shipP10(p){
  var d = String(p == null ? '' : p).replace(AR_DIGITS, function(c){
    var k = c.charCodeAt(0);
    return String(k >= 1776 ? k - 1776 : k - 1632);
  }).replace(/[^0-9]/g, '');
  if(/^1[0125][0-9]{8}$/.test(d)) return d;
  if(/^01[0125][0-9]{8}$/.test(d)) return d.slice(1);
  if(/^201[0125][0-9]{8}$/.test(d)) return d.slice(2);
  if(/^2001[0125][0-9]{8}$/.test(d)) return d.slice(3);
  if(/^00201[0125][0-9]{8}$/.test(d)) return d.slice(4);
  return null;
}
function rawPart(o, k){
  var raw = o && o.ship_rank_raw;
  if(typeof raw === 'string'){ try{ raw = JSON.parse(raw); }catch(e){ raw = null; } }
  return raw && typeof raw === 'object' && raw[k] && typeof raw[k] === 'object' ? raw[k] : null;
}
// الرقم اللي اتسأل ≠ الرقم الحالي (الموظف عدّله) — الخام هو الحكم، ولو مش موجود مانحكمش
function partStale(o, k, phone){
  var pt = rawPart(o, k);
  return !!(pt && pt.phone10 && pt.phone10 !== shipP10(phone));
}
function altRate(o){
  var an = num(o.ship_rank_alt_n), ar = num(o.ship_rank_alt);
  if(!o.alt_phone || an === null || an <= 0 || ar === null || partStale(o, 'alt', o.alt_phone)) return null;
  var pa = rawPart(o, 'primary'), al = rawPart(o, 'alt');
  if(pa && al && al.phone10 === pa.phone10) return null;   // نفس الرقم = نفس الأساسي
  return { rate: ar, n: an };
}

// شركة الشحن للأوردر:
//  { kind:'rate', rate, n, alt? } (alt = من الرقم الإضافي لأن الأساسي جديد عندهم) · { kind:'new' } (اتسأل ومالوش شحنات) ·
//  { kind:'stale' } (التليفون اتعدّل بعد السؤال) · { kind:'old', rate } (القديم وقت الشحن) · null
export function shipInfo(o){
  if(!o) return null;
  if(o.ship_rank_at){
    if(partStale(o, 'primary', o.phone)) return { kind: 'stale' };
    var n = num(o.ship_rank_n);
    var r = num(o.ship_rank);
    if(n !== null && n > 0 && r !== null) return { kind: 'rate', rate: r, n: n };
    var a = altRate(o);
    if(a) return { kind: 'rate', rate: a.rate, n: a.n, alt: true };
    return { kind: 'new' };
  }
  var old = num(o.customer_ranking);
  return old === null ? null : { kind: 'old', rate: old };
}
function tierOf(score){
  return score >= RANK_GOOD ? { cls: 'rk-good', tag: 'جامد' } : (score >= RANK_MID ? { cls: 'rk-mid', tag: 'متوسط' } : { cls: 'rk-bad', tag: 'زبالة' });
}
function shipText(s){
  if(!s) return '';
  if(s.kind === 'new') return 'شركة الشحن: عميل جديد — مالوش شحنات قبل كده';
  if(s.kind === 'old') return 'شركة الشحن (وقت الشحن معاهم): ' + s.rate.toFixed(1) + '%';
  var d = Math.round(s.rate * s.n / 100);
  return 'شركة الشحن' + (s.alt ? ' (الرقم الإضافي)' : '') + ': ' + s.rate.toFixed(1) + '% (اتسلّم ' + d + ' من ' + s.n + ')';
}

// شارة الجدول (جنب اسم العميل) — **واحدة بس** (شارتين جنب بعض بيتقصّوا في عمود الاسم — اتشاف في الصورة).
// التليفون اتعدّل بعد السؤال = مفيش شارة (النسبة بتاعة الرقم القديم — هيتسأل تاني خلال دقايق).
export function deliveryScoreBadges(o){
  var s = shipInfo(o);
  if(!s || s.kind === 'stale') return '';
  var tip = esc('نسبة استلام العميل · ' + shipText(s));
  if(s.kind === 'new') return '<span class="rk-badge rk-new ds-badge" title="' + tip + '">جديد</span>';
  var t = tierOf(s.rate);
  return '<span class="rk-badge ' + t.cls + ' ds-badge" title="' + tip + '">' + t.tag + '</span>';
}

function muted(t){ return '<span class="dval ar ds-muted">' + t + '</span>'; }
// الأرقام LTR معزولة (dir) — جوّه خانة عربي (dval ar) «45.5%» مايتقلبش لـ«%45.5»
function mono(t){ return '<span dir="ltr" style="font-family:\'JetBrains Mono\',monospace">' + t + '</span>'; }

// خانة شركة الشحن لرقم: نسبة + اتسلّم/رجع (من الخام — النافذة بتجيب الصف كامل) · جديد · القديم وقت الشحن
function shipCellFrom(rate, n, part, isOld){
  if(isOld){
    var to = tierOf(rate);
    return '<span class="dval ar ds-ship"><span class="rk-badge ' + to.cls + '" style="margin:0">' + to.tag + '</span> ' + mono(rate.toFixed(1) + '%')
      + ' <span class="ds-muted">(اتسجّلت وقت الشحن معاهم)</span></span>';
  }
  if(n === null || n <= 0 || rate === null)
    return '<span class="dval ar ds-ship"><span class="rk-badge rk-new" style="margin:0">جديد</span> <span class="ds-muted">مالوش شحنات قبل كده عند شركة الشحن</span></span>';
  var t = tierOf(rate);
  var d = part && typeof part.delivered === 'number' ? part.delivered : Math.round(rate * n / 100);
  var r = part && typeof part.returned === 'number' ? part.returned : n - d;
  return '<span class="dval ar ds-ship"><span class="rk-badge ' + t.cls + '" style="margin:0">' + t.tag + '</span> ' + mono(rate.toFixed(1) + '%')
    + ' <span class="ds-cnt">· اتسلّم ' + mono(String(d)) + ' · رجع ' + mono(String(r)) + '</span></span>';
}
// سطر «شركة الشحن» = الرقم الأساسي بس (الإضافي سطر لوحده تحت — حتى لو الشارة اتبنت عليه)
function shipCell(o){
  if(!o.ship_rank_at){
    var old = num(o.customer_ranking);
    return old === null ? muted('مفيش بيانات') : shipCellFrom(old, null, null, true);
  }
  if(partStale(o, 'primary', o.phone))
    return muted('⏳ التليفون اتعدّل بعد ما اتسأل — النسبة القديمة كانت للرقم القديم'
      // نفس شرط ship_rank_candidates_v1: الرقم الجديد سليم والأوردر من آخر 30 يوم — غير كده مش هيتسأل، فمانوعدش
      + (shipP10(o.phone) && Date.parse(o.created_at || '') > Date.now() - 30 * 86400000 ? ' (هيتسأل تاني خلال دقايق)' : ''));
  return shipCellFrom(num(o.ship_rank), num(o.ship_rank_n), rawPart(o, 'primary'), false);
}

// قسم «نسبة استلام العميل» في نافذة التفاصيل — بيظهر دايماً، والفاضي بيتقال «مفيش»
export function deliveryScoreSection(o){
  var row = function(k, v, id){ return '<div class="drow"' + (id ? ' id="' + id + '"' : '') + '><span class="dkey">' + k + '</span>' + v + '</div>'; };
  var h = '<div class="dsec" data-tone="green" id="ds-sec"><div class="dstt"><span class="dstt-ico">📊</span>نسبة استلام العميل</div>';
  h += row('شركة الشحن', shipCell(o), 'ds-ship');
  // شركة الشحن للرقم الإضافي: بس لو اتسأل ورقمه غير الأساسي وليه شحنات عندهم (ومااتعدّلش بعد السؤال)
  var a = o.ship_rank_at && !partStale(o, 'primary', o.phone) ? altRate(o) : null;
  if(a) h += row('شركة الشحن — الرقم الإضافي', shipCellFrom(a.rate, a.n, rawPart(o, 'alt'), false), 'ds-ship-alt');
  return h + '</div>';
}
