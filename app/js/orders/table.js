// جدول الأوردرات — الرندر والتحديد الجماعي والتصفّح

import { emptyState } from '../core/empty.js';
import { walletStateCache } from '../billing/billing.js';
import { statusClass, statusLabel } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { fmt, fmtD, num, short } from '../core/format.js';
import { pRange } from '../finance/finance.js';
import { tourActive } from '../tour/tour.js';
import { printAwbForOrders } from './awb.js';
import { lockMaybe } from './billing-summary.js';
import { CALL_WAIT_MS, startTimerTick } from './call-timer.js';
import { openDetail } from './detail.js';
import { customerOrderCount } from './merge.js';
import { fetchOrdersPage } from './orders.js';
import { cur, fil, ordersPeriod, ordersSetPage, PS, selectedIds, totalCount } from './state.js';

// الأعمدة اللي الجدول + المؤقّت محتاجينها فقط (مفيش select('*'))
// حدود سمعة العميل من بوسطة (سهل تغييرها): >= جامد، >= متوسط، أقل = زبالة
export var RANK_GOOD = 80, RANK_MID = 50;

// Get deadline ISO string ONLY if order is pending and has call attempts
// Returns '' if order is not pending, or has no calls, or deadline already passed long ago
// Parse status_log safely — Supabase sometimes returns it as a JSON string
export function parseStatusLog(val){
  if(!val) return [];
  if(Array.isArray(val)) return val;
  // May be a JSON string, or even a double-encoded JSON string ("\"[...]\"")
  var v = val;
  for(var i=0;i<3;i++){
    if(Array.isArray(v)) return v;
    if(typeof v !== 'string') return [];
    try{ v = JSON.parse(v); }catch(e){ return []; }
  }
  return Array.isArray(v) ? v : [];
}

export function getCallDeadline(o){
  // Timer only runs for pending orders
  if(!o || o.status !== 'pending') return '';
  if(!Array.isArray(o.call_attempts) || !o.call_attempts.length) return '';
  var last = o.call_attempts[o.call_attempts.length - 1];
  if(!last || !last.iso) return '';
  // iso بايظ (تعديل يدوي في الداتابيز مثلاً) = NaN، وtoISOString عليها بترمي
  // RangeError جوه لوب الرندر — صف واحد فاسد كان بيوقع الجدول كله
  var t = new Date(last.iso).getTime();
  if(!isFinite(t)) return '';
  return new Date(t + CALL_WAIT_MS).toISOString();
}

export function renderTable(){
  var st=(cur-1)*PS, pg=fil;   // fil = الصفحة الحالية (جاية من السيرفر مباشرة)
  if(!totalCount){
    // النفاد: السيرفر بقى مابيرجّعش ولا صف (RLS) — من غير الرسالة دي
    // التاجر المنفّد كان هيشوف "لسه مفيش أوردرات" ويفتكر بياناته ضاعت
    if(walletStateCache && walletStateCache.is_depleted && !tourActive){
      $id('tbody').innerHTML = emptyState({icon:'🔒', title:'بياناتك مقفولة لحد ما تشحن المحفظة',
          sub:'أوردراتك كلها محفوظة زي ما هي — أول ما تشحن هترجع تظهر فوراً. الأوردرات الجديدة لسه بتوصل وبتتسجل عادي.',
          act:'goto-billing', actLabel:'💳 اشحن المحفظة', adminOnly:true});
      $id('pag').style.display='none';return;}
    // تاجر جديد (مفيش أي فلتر شغّال) ≠ فلتر مش مطابق حاجة — الرسالة القديمة
    // كانت بتتهم التاجر الجديد إنه عامل بحث غلط وهو لسه فاتح لأول مرة
    var qv=$id('qinp'), noFilters = !(qv && qv.value.trim())
      && !($id('fst') && $id('fst').value) && !($id('fpl') && $id('fpl').value)
      && !($id('fpy') && $id('fpy').value) && (ordersPeriod.type==='month' || ordersPeriod.type==='all');   // month هو الافتراضي الجديد
    $id('tbody').innerHTML = noFilters
      ? emptyState({icon:'🛒', title:'لسه مفيش أوردرات',
          sub:'أول ما تحط رابط استقبال الأوردرات في موقعك أو منصة إعلاناتك، الطلبات هتظهر هنا لوحدها وهيتبعت للعميل رسالة تأكيد أوتوماتيك.',
          act:'goto-settings', actLabel:'🔗 هات رابط الاستقبال من الإعدادات', adminOnly:true})
      : emptyState({icon:'🔍', title:'مفيش أوردرات مطابقة',
          sub:'جرّب تغيّر كلمة البحث أو الفلاتر أو وسّع المدة.'});
    $id('pag').style.display='none';return;}
  if(!pg.length){$id('tbody').innerHTML='<div class="ldg">مفيش نتايج في الصفحة دي</div>';}
  // NEW COLUMN ORDER: رقم الطلب - رقم التتبع - اسم العميل - موبايل أساسي - موبايل إضافي - المدينة - العنوان - المنتج - الحالة - التاريخ
  // Default column widths (saved per-user in localStorage)
  // مجموع الافتراضيات القديم كان 1577px — أعرض من الشاشة، فعمود التاريخ
// كان نصه مقصوص بره نطاق السحب دايماً. النحافة دي بتخلي الجدول كله
// بايناً على 1440px+ (والتاجر لسه يقدر يوسّع أي عمود بالسحب)
var DEFAULT_WIDTHS = {cb:42,uid:84,track:150,name:132,phone:104,alt:96,city:84,addr:138,prod:146,pay:92,status:118,timer:104,date:94};
  var widths;
  // sb_cols2: ترقية مرة واحدة — المفتاح القديم sb_cols فيه مقاسات من عهد
  // ما كان fixed layout معطّل (width:auto)، فكانت شكلية مش فعلية. النسخة
  // الجديدة بتبدأ الكل من الافتراضيات المتوزنة، وأي تعديل يدوي بيتحفظ عادي.
  try{ widths = JSON.parse(localStorage.getItem('sb_cols2')||'null'); }catch(e){ widths = null; }
  try{ localStorage.removeItem('sb_cols'); }catch(e){}
  if(!widths) widths = Object.assign({},DEFAULT_WIDTHS);
  if(!widths.pay)widths.pay=75;
  if(!widths.timer)widths.timer=90;

  var h='<table><colgroup>'
    +'<col style="width:'+widths.cb+'px">'
    +'<col style="width:'+widths.uid+'px">'
    +'<col style="width:'+widths.track+'px">'
    +'<col style="width:'+widths.name+'px">'
    +'<col style="width:'+widths.phone+'px">'
    +'<col style="width:'+widths.alt+'px">'
    +'<col style="width:'+widths.city+'px">'
    +'<col style="width:'+widths.addr+'px">'
    +'<col style="width:'+widths.prod+'px">'
    +'<col style="width:'+widths.pay+'px">'
    +'<col style="width:'+widths.status+'px">'
    +'<col style="width:'+widths.timer+'px">'
    +'<col style="width:'+widths.date+'px">'
    +'</colgroup>'
    +'<thead><tr>'
    +'<th class="cbcol"><input type="checkbox" class="cb" id="cb-all"></th>'
    +'<th data-col="uid">رقم الطلب<div class="col-resize" data-col="uid"></div></th>'
    +'<th data-col="track">رقم التتبع<div class="col-resize" data-col="track"></div></th>'
    +'<th data-col="name">اسم العميل<div class="col-resize" data-col="name"></div></th>'
    +'<th data-col="phone">موبايل أساسي<div class="col-resize" data-col="phone"></div></th>'
    +'<th data-col="alt">موبايل إضافي<div class="col-resize" data-col="alt"></div></th>'
    +'<th data-col="city">المدينة<div class="col-resize" data-col="city"></div></th>'
    +'<th data-col="addr">العنوان<div class="col-resize" data-col="addr"></div></th>'
    +'<th data-col="prod">المنتج<div class="col-resize" data-col="prod"></div></th>'
    +'<th data-col="pay">الدفع<div class="col-resize" data-col="pay"></div></th>'
    +'<th data-col="status">الحالة<div class="col-resize" data-col="status"></div></th>'
    +'<th data-col="timer">⏱ المكالمة<div class="col-resize" data-col="timer"></div></th>'
    +'<th data-col="date">التاريخ<div class="col-resize" data-col="date"></div></th>'
    +'</tr></thead><tbody>';
  for(var i=0;i<pg.length;i++){
    var o=pg[i],s=o.status||'pending';
    var checked=selectedIds.has(o.id)?'checked':'';
    var classes=[];
    if(selectedIds.has(o.id))classes.push('sel');
    if(o.customer_notes&&o.customer_notes.trim())classes.push('has-note');
    if(o.internal_notes&&o.internal_notes.trim())classes.push('has-int-note');
    if(o.cancel_requested_at && !o.cancel_resolved_at)classes.push('cancel-req');
    var clsAttr=classes.length?' class="'+classes.join(' ')+'"':'';
    var noteIcon=(o.customer_notes&&o.customer_notes.trim())?'<span class="note-icon" title="يوجد ملاحظة من العميل">📝</span>':'';
    var vipCount=customerOrderCount(o);
    var vipBadge=vipCount>1?'<span class="vip-badge" title="عميل متكرر — '+vipCount+' طلبات">×'+vipCount+'</span>':'';
    var rankBadge='';
    if(o.customer_ranking !== null && o.customer_ranking !== undefined && o.customer_ranking !== ''){
      var _rk=Number(o.customer_ranking);
      if(!isNaN(_rk)){
        var _rkCls=_rk>=RANK_GOOD?'rk-good':(_rk>=RANK_MID?'rk-mid':'rk-bad');
        var _rkLbl=_rk>=RANK_GOOD?'جامد':(_rk>=RANK_MID?'متوسط':'زبالة');
        rankBadge='<span class="rk-badge '+_rkCls+'" title="نسبة استلام العميل عبر بوسطة: '+_rk.toFixed(1)+'%">'+_rkLbl+'</span>';
      }
    }
    var cancelBadge = (o.cancel_requested_at && !o.cancel_resolved_at)
      ? '<span class="cx-badge" title="العميل طلب إلغاء الأوردر بعد ما كان مؤكد — '+esc(fmtD(o.cancel_requested_at))+'">\u26A0 طلب إلغاء</span>'
      : '';
    var locked = walletStateCache && walletStateCache.is_depleted;
    var addrTitle = locked ? '' : esc(fmt(o.address));
    var prodTitle = locked ? '' : esc(fmt(o.product_name));
    h+='<tr data-id="'+o.id+'"'+clsAttr+'>'
      +'<td class="cbcol"><input type="checkbox" class="cb cb-row" data-id="'+o.id+'" '+checked+'></td>'
      +'<td class="id'+(cancelBadge?' has-cx':'')+'">'+noteIcon+esc(fmt(o.order_uid))+cancelBadge+'</td>'
      +'<td class="mn awb-cell">'+(o.tracking_no?esc(o.tracking_no)+'<button class="awb-btn" data-id="'+o.id+'" title="طبع بوليصة بوسطة">🖨️</button>'+(o.awb_print_count>0?'<span class="awb-printed-badge" title="مطبوع '+o.awb_print_count+' مرة'+(o.awb_printed_at?' — آخر طباعة: '+fmtD(o.awb_printed_at):'')+'">✓×'+o.awb_print_count+'</span>':''):'<span class="notrack">في الانتظار</span>')+'</td>'
      +'<td class="nm">'+vipBadge+lockMaybe(fmt(o.customer_name))+rankBadge+'</td>'
      +'<td class="mn">'+lockMaybe(fmt(o.phone))+'</td>'
      +'<td class="mn">'+lockMaybe(fmt(o.alt_phone))+'</td>'
      +'<td>'+lockMaybe(fmt(o.city))+'</td>'
      +'<td class="addr" title="'+addrTitle+'">'+lockMaybe(short(o.address,45))+'</td>'
      +'<td class="pr" title="'+prodTitle+'">'+lockMaybe(short(o.product_name,30))+(!locked&&o['var']&&String(o['var']).trim()?'<span class="var-badge" title="اللون / المقاس: '+esc(String(o['var']))+'">'+esc(short(String(o['var']),18))+'</span>':'')+'</td>'
      +'<td class="pay'+(o.payment_stage==='paymob'?' paid':'')+'">'+(o.payment_stage==='paymob'?'<span class="pay-badge">مدفوع</span>':'<span class="pay-cod">COD</span>')+'</td>'
      +'<td><span class="badge '+statusClass(s)+'"><span class="bdot"></span>'+esc(statusLabel(s))+'</span></td>'
      +'<td class="timer-cell" data-deadline="'+getCallDeadline(o)+'" data-id="'+o.id+'"></td>'
      +'<td class="mn">'+fmtD(o.created_at)+'</td>'
      +'</tr>';
  }
  h+='</tbody></table>';
  $id('tbody').innerHTML=h;
  startTimerTick(); // start/restart the 1-second countdown ticker

  $id('tbody').querySelectorAll('tr[data-id]').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.classList.contains('cb-row')||e.target.classList.contains('cbcol')||e.target.classList.contains('awb-btn'))return;
      openDetail(row.getAttribute('data-id'));
    });
  });
  $id('tbody').querySelectorAll('.cb-row').forEach(function(cb){
    cb.addEventListener('click',function(e){e.stopPropagation();});
    cb.addEventListener('change',function(){
      var id=cb.getAttribute('data-id');
      if(cb.checked)selectedIds.add(id);else selectedIds.delete(id);
      var tr=cb.closest('tr');if(tr)tr.classList.toggle('sel',cb.checked);
      updateBulkBar();updateMasterCb();
    });
  });
  
  // أزرار طباعة AWB لكل صف
  $id('tbody').querySelectorAll('.awb-btn').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var id = btn.getAttribute('data-id');
      if(id && typeof printAwbForOrders === 'function'){
        printAwbForOrders([id], btn);
      }
    });
  });
  var cbAll=$id('cb-all');
  if(cbAll){
    updateMasterCb();
    cbAll.addEventListener('change',function(){
      $id('tbody').querySelectorAll('.cb-row').forEach(function(cb){
        cb.checked=cbAll.checked;
        var id=cb.getAttribute('data-id');
        if(cbAll.checked)selectedIds.add(id);else selectedIds.delete(id);
        var tr=cb.closest('tr');if(tr)tr.classList.toggle('sel',cbAll.checked);
      });
      updateBulkBar();
    });
  }

  var tp=Math.max(1,Math.ceil(totalCount/PS));
  $id('pag').style.display='flex';
  $id('pinf').textContent=(st+1)+'–'+Math.min(st+PS,totalCount)+' من '+num(totalCount);
  var pr=pRange(cur,tp);
  var pb='<button class="pbtn" data-p="'+(cur-1)+'" '+(cur===1?'disabled':'')+'>‹</button>';
  pr.forEach(function(p){
    if(p==='…')pb+='<span style="padding:6px 7px;color:var(--muted)">…</span>';
    else pb+='<button class="pbtn'+(p===cur?' act':'')+'" data-p="'+p+'">'+p+'</button>';
  });
  pb+='<button class="pbtn" data-p="'+(cur+1)+'" '+(cur===tp?'disabled':'')+'>›</button>';
  $id('pbtns').innerHTML=pb;
  $id('pbtns').querySelectorAll('button').forEach(function(b){
    b.addEventListener('click',function(){goPage(parseInt(b.getAttribute('data-p')));});
  });

  // Column resize handlers
  $id('tbody').querySelectorAll('.col-resize').forEach(function(handle){
    handle.addEventListener('mousedown',function(e){
      e.preventDefault();e.stopPropagation();
      var col=handle.getAttribute('data-col');
      var th=handle.closest('th');
      var startX=e.clientX;
      var startW=th.offsetWidth;
      handle.classList.add('dragging');
      function onMove(ev){
        // RTL: dragging left = wider (because handle is on the left edge in RTL)
        var dx=startX-ev.clientX;
        var newW=Math.max(50,startW+dx);
        // Update colgroup col element
        var cols=$id('tbody').querySelectorAll('col');
        var colIdx=Array.from(th.parentNode.children).indexOf(th);
        if(cols[colIdx])cols[colIdx].style.width=newW+'px';
        widths[col]=newW;
      }
      function onUp(){
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
        handle.classList.remove('dragging');
        localStorage.setItem('sb_cols2',JSON.stringify(widths));
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
  });
}

export function updateMasterCb(){
  var cbAll=$id('cb-all');if(!cbAll)return;
  var rows=$id('tbody').querySelectorAll('.cb-row');
  if(!rows.length){cbAll.checked=false;return;}
  var checked=0;rows.forEach(function(cb){if(cb.checked)checked++;});
  cbAll.checked=checked===rows.length;
  cbAll.indeterminate=checked>0&&checked<rows.length;
}

export function updateBulkBar(){
  var n=selectedIds.size;
  $id('bulkbar').classList.toggle('show',n>0);
  $id('bcnt').textContent=num(n)+' طلب محدد';
}

// زرار "حدد غير المطبوع" — يظهر بس في فلتر بوسطة/OPERATION ويحدّد كل اللي لسه ماتطبعش
export function updateUnprintedBtn(){
  var btn = $id('bb-sel-unprinted');
  if(!btn) return;
  var st = $id('fst') ? $id('fst').value : '';
  var relevant = (st === 'bosta_assigned' || st === '__operation__');
  if(!relevant){ btn.classList.remove('show'); return; }
  var cnt = 0;
  (fil||[]).forEach(function(o){
    if(o.tracking_no && String(o.tracking_no).trim() && !(o.awb_print_count > 0)) cnt++;
  });
  if(cnt > 0){
    btn.classList.add('show');
    btn.textContent = '✓ حدد غير المطبوع (' + num(cnt) + ')';
  } else {
    btn.classList.remove('show');
  }
}

export function goPage(p){var tp=Math.max(1,Math.ceil(totalCount/PS));if(p<1||p>tp)return;ordersSetPage(p);if(tourActive){renderTable();}else{fetchOrdersPage();}window.scrollTo({top:0,behavior:'smooth'});}
