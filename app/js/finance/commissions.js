// عمولات الـupselling — العرض بس. كل الحساب على السيرفر.
//
// الموظف بيفتح الأوردر ويضيف منتج → الإجمالي يزيد → الفرق = upsell،
// و`save_order_products` (RPC ذرية) بتسجّل الحدث بعمولة محسوبة من إعدادات
// الموظف على السيرفر ومن إجمالي **صف السيرفر** قبل التعديل.
//
// دورة الحالة: `pending` أول ما تتسجّل → `earned` لما الأوردر يتسلّم →
// `void` لو رجع أو اتلغى. التحويل بتريجر على `orders` مش من هنا، عشان
// يشتغل كمان لما n8n هو اللي بيغيّر الحالة (وده اللي بيحصل في أغلب
// التسليمات) — نداء من الفرونت كان هيفوّت كل دول.

import { currentTenantId } from '../auth/auth.js';
import { $id, esc } from '../core/dom.js';
import { fmtD, num } from '../core/format.js';
import { renderLoadError } from '../core/loaderr.js';
import { sb } from '../core/supabase.js';
import { isAdmin } from '../orders/guards.js';

export var commissionRows = [];

export function commissionsSetRows(v){ commissionRows = v || []; }

export var CM_STATUS = { pending:'معلّقة', earned:'مستحقة', void:'ملغية' };

var cmGen = 0;

export function loadCommissions(){
  if(!isAdmin() || !sb || !currentTenantId) return;
  var box = $id('cm-tbody');
  if(!box) return;
  var myGen = ++cmGen;
  box.innerHTML = '<div class="ldg"><div class="spin"></div>جاري التحميل...</div>';
  sb.from('upsell_events')
    .select('id,order_id,user_id,user_name,before_total,after_total,delta,commission_type,commission_rate,commission_amount,status,resolved_at,created_at')
    .eq('tenant_id', currentTenantId)
    .order('created_at', { ascending:false })
    .limit(500)
    .then(function(r){
      if(myGen !== cmGen) return;   // رد أقدم وصل بعد أحدث
      if(r.error){ renderLoadError('finance'); return; }
      commissionsSetRows(r.data || []);
      renderCommissions();
    });
}

export function renderCommissions(){
  var box = $id('cm-tbody');
  if(!box) return;
  var want = $id('cm-filter-status') ? $id('cm-filter-status').value : '';
  var rows = commissionRows.filter(function(x){ return !want || x.status === want; });

  // الكروت بتحسب على **كل** الأحداث مش المفلترة — الفلتر للجدول بس
  var sums = { pending:0, earned:0, void:0 };
  commissionRows.forEach(function(x){
    if(sums[x.status] !== undefined) sums[x.status] += Number(x.commission_amount || 0);
  });
  if($id('cm-sum-pending')) $id('cm-sum-pending').textContent = num(Math.round(sums.pending)) + ' ج';
  if($id('cm-sum-earned'))  $id('cm-sum-earned').textContent  = num(Math.round(sums.earned))  + ' ج';
  if($id('cm-sum-void'))    $id('cm-sum-void').textContent    = num(Math.round(sums.void))    + ' ج';
  if($id('cm-count'))       $id('cm-count').textContent = rows.length + ' حركة';

  // تجميع بالموظف — ده اللي التاجر محتاجه فعلاً وقت الصرف
  var byUser = {};
  commissionRows.forEach(function(x){
    var k = x.user_id || ('n:' + (x.user_name || '—'));
    if(!byUser[k]) byUser[k] = { name: x.user_name || '—', pending:0, earned:0, n:0 };
    byUser[k].n++;
    if(x.status === 'pending') byUser[k].pending += Number(x.commission_amount || 0);
    if(x.status === 'earned')  byUser[k].earned  += Number(x.commission_amount || 0);
  });
  var users = Object.keys(byUser).map(function(k){ return byUser[k]; })
                    .sort(function(a,b){ return b.earned - a.earned; });
  var ub = $id('cm-by-user');
  if(ub){
    ub.innerHTML = users.length
      ? '<div class="cm-users">' + users.map(function(u){
          return '<div class="cm-user">'
            + '<div class="cm-user-name">' + esc(u.name) + '<span class="cm-user-n">' + u.n + ' حركة</span></div>'
            + '<div class="cm-user-nums">'
            +   '<span class="cm-earned">مستحق ' + num(Math.round(u.earned)) + ' ج</span>'
            +   '<span class="cm-pending">معلّق ' + num(Math.round(u.pending)) + ' ج</span>'
            + '</div></div>';
        }).join('') + '</div>'
      : '';
  }

  if(!rows.length){
    box.innerHTML = '<div class="cm-empty">'
      + (commissionRows.length ? 'مفيش عمولات في الحالة دي.' : 'لسه مفيش عمولات upselling. فعّلها لموظف من الإعدادات ← موظفين المتجر.')
      + '</div>';
    return;
  }

  var h = '<table><thead><tr>'
    + '<th>التاريخ</th><th>الموظف</th><th>قبل</th><th>بعد</th><th>الزيادة</th>'
    + '<th>العمولة</th><th>الحالة</th></tr></thead><tbody>';
  rows.forEach(function(x){
    var rate = x.commission_type === 'percent'
      ? (num(x.commission_rate) + '%')
      : (num(x.commission_rate) + ' ج ثابت');
    h += '<tr>'
      + '<td class="mn">' + esc(fmtD(x.created_at)) + '</td>'
      + '<td class="nm">' + esc(x.user_name || '—') + '</td>'
      + '<td class="mn">' + num(x.before_total) + '</td>'
      + '<td class="mn">' + num(x.after_total) + '</td>'
      + '<td class="mn cm-delta">+' + num(x.delta) + '</td>'
      + '<td class="mn cm-amt" title="' + esc(rate) + '">' + num(x.commission_amount) + ' ج</td>'
      + '<td><span class="cm-badge ' + esc(x.status) + '">' + esc(CM_STATUS[x.status] || x.status) + '</span></td>'
      + '</tr>';
  });
  h += '</tbody></table>';
  box.innerHTML = h;
}

export function wireCommissionEvents(){
  var f = $id('cm-filter-status');
  if(f) f.addEventListener('change', renderCommissions);
}
