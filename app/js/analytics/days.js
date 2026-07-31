// كالندر أداء الأيام — شبكة شهرية كبيرة، كل يوم مربع فيه نسبة التأكيد
// والتسليم، ولونه بيتدرج (أخضر → أصفر → أحمر) حسب جودة اليوم.
//
// الحسابات بنفس معادلات كروت اللوحة وجدول المنصات بالظبط:
//   تأكيد = اللي دخل رحلة الشحن ÷ اللي اتعامل معاه (يستبعد Pending)
//   تسليم = المسلَّم ÷ (المسلَّم + المرتجع)
// نسبة التسليم للأيام القريبة بتبقى "—" بصدق — الشحنات لسه ماخلصتش،
// ووقتها جودة اليوم بتتحسب من التأكيد لوحده (rate.js/dayQuality).
//
// المالك الوحيد لحالة الشهر المعروض هو الموديول ده.

import { $id } from '../core/dom.js';
import { num } from '../core/format.js';
import { all } from '../orders/state.js';
import { BOSTA_POSITIVE_STATUSES, DELIVERED_STATUSES, RETURNED_STATUSES, statusIn } from '../core/constants.js';
import { dayQuality } from './rate.js';

var MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
var WDAYS  = ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];

// null = لسه ما اتفتحش — أول رندر بياخد الشهر الحالي
var daysY = null, daysM = null;

function ensureMonth(){
  if(daysY === null){ var n = new Date(); daysY = n.getFullYear(); daysM = n.getMonth(); }
}

export function daysShift(d){
  ensureMonth();
  var m = daysM + d;
  daysY += Math.floor(m / 12);
  daysM = ((m % 12) + 12) % 12;
  renderDaysCalendar();
}

export function daysToday(){
  var n = new Date();
  daysY = n.getFullYear(); daysM = n.getMonth();
  renderDaysCalendar();
}

// تجميع أوردرات الشهر يوم-بيوم (بتوقيت المتصفح — نفس منطق ordersInRange)
function aggregateMonth(y, m){
  var by = {};
  (all || []).forEach(function(o){
    var d = new Date(o.created_at);
    if(d.getFullYear() !== y || d.getMonth() !== m) return;
    var k = d.getDate();
    if(!by[k]) by[k] = { total:0, processed:0, positive:0, delivered:0, returned:0 };
    var b = by[k];
    b.total++;
    if(!statusIn(o.status, ['pending'])) b.processed++;
    if(statusIn(o.status, BOSTA_POSITIVE_STATUSES)) b.positive++;
    if(statusIn(o.status, DELIVERED_STATUSES)) b.delivered++;
    if(statusIn(o.status, RETURNED_STATUSES)) b.returned++;
  });
  return by;
}

export function renderDaysCalendar(){
  var host = $id('dcal');
  if(!host) return;
  ensureMonth();
  var y = daysY, m = daysM;
  var now = new Date();
  var isCurMonth = (y === now.getFullYear() && m === now.getMonth());
  var todayD = now.getDate();
  var daysInMonth = new Date(y, m + 1, 0).getDate();
  var firstCol = (new Date(y, m, 1).getDay() + 1) % 7;   // السبت = العمود الأول
  var by = aggregateMonth(y, m);

  var h = '<div class="dcal-head">'
    + '<button type="button" class="dcal-nav" data-act="days-prev" title="الشهر اللي فات">‹</button>'
    + '<div class="dcal-title">' + MONTHS[m] + ' <span class="dcal-year">' + y + '</span>'
    + (isCurMonth ? '' : ' <button type="button" class="dcal-today" data-act="days-today">ارجع للشهر الحالي</button>')
    + '</div>'
    + '<button type="button" class="dcal-nav" data-act="days-next" title="الشهر الجاي">›</button>'
    + '</div>';

  h += '<div class="dcal-grid">';
  WDAYS.forEach(function(w){ h += '<div class="dcal-wd">' + w + '</div>'; });
  for(var e = 0; e < firstCol; e++) h += '<div class="dcal-day q-empty"></div>';

  var monthAgg = { total:0, processed:0, positive:0, delivered:0, returned:0 };
  for(var day = 1; day <= daysInMonth; day++){
    var b = by[day];
    var isFuture = isCurMonth ? day > todayD : new Date(y, m, day) > now;
    var isToday = isCurMonth && day === todayD;
    if(isFuture){
      h += '<div class="dcal-day q-future"><span class="dcal-num">' + num(day) + '</span></div>';
      continue;
    }
    if(!b){
      h += '<div class="dcal-day q-none' + (isToday ? ' today' : '') + '" title="مفيش أوردرات في اليوم ده">'
        + '<span class="dcal-num">' + num(day) + '</span><span class="dcal-cnt">مفيش أوردرات</span></div>';
      continue;
    }
    Object.keys(monthAgg).forEach(function(k){ monthAgg[k] += b[k]; });
    var conf = b.processed > 0 ? (b.positive / b.processed * 100) : null;
    var fin = b.delivered + b.returned;
    var deliv = fin > 0 ? (b.delivered / fin * 100) : null;
    var q = dayQuality(conf, deliv);
    var tip = num(b.total) + ' أوردر — اتعامل مع ' + num(b.processed)
      + ' · اتأكد ' + num(b.positive)
      + ' · اتسلم ' + num(b.delivered) + ' · رجع ' + num(b.returned);
    h += '<div class="dcal-day ' + q.cls + (isToday ? ' today' : '') + '" title="' + tip + '">'
      + '<span class="dcal-num">' + num(day) + '</span>'
      + '<span class="dcal-cnt">' + num(b.total) + ' أوردر</span>'
      + '<span class="dcal-rate">تأكيد ' + (conf == null ? '—' : conf.toFixed(0) + '%') + '</span>'
      + '<span class="dcal-rate">تسليم ' + (deliv == null ? '—' : deliv.toFixed(0) + '%') + '</span>'
      + '</div>';
  }
  h += '</div>';

  // ملخص الشهر تحت الشبكة + مفتاح الألوان
  var mc = monthAgg.processed > 0 ? (monthAgg.positive / monthAgg.processed * 100) : null;
  var mf = monthAgg.delivered + monthAgg.returned;
  var md = mf > 0 ? (monthAgg.delivered / mf * 100) : null;
  h += '<div class="dcal-foot">'
    + '<div class="dcal-sum">إجمالي الشهر: <b>' + num(monthAgg.total) + '</b> أوردر'
    + ' · تأكيد <b>' + (mc == null ? '—' : mc.toFixed(1) + '%') + '</b>'
    + ' · تسليم <b>' + (md == null ? '—' : md.toFixed(1) + '%') + '</b></div>'
    + '<div class="dcal-legend">'
    + '<span class="dcal-lg q-good">ممتاز ≥85</span>'
    + '<span class="dcal-lg q-ok">كويس 75+</span>'
    + '<span class="dcal-lg q-mid">متوسط 60+</span>'
    + '<span class="dcal-lg q-weak">ضعيف 45+</span>'
    + '<span class="dcal-lg q-bad">وحش &lt;45</span>'
    + '<span class="dcal-lg q-none">مفيش بيانات</span>'
    + '</div></div>';

  host.innerHTML = h;
}
