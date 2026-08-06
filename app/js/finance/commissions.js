// عمولات الـupselling — الأرصدة والتسويات والحركات. كل الحساب على السيرفر.
//
// الرصيد **تراكمي مش على مدة** (قرار المالك): الموظف بيفضل شايف مستحقه
// الكامل لحد ما المدير يعمل تسوية، والتسوية بتتخصم منه تلقائي.
//   الرصيد = مجموع العمولات المستحقة − مجموع التسويات
//
// الرصيد ممكن يبقى **سالب** — صرفنا عمولة والأوردر رجع بعدها فاتحوّلت
// «ملغية». بنعرضها صريحة «عليه X ج» بدل ما نقصّها على صفر ونخبّي الحقيقة،
// عشان المدير يخصمها من التسوية الجاية.
//
// الإلغاء **قيد عكسي مش حذف** — الموظف لازم يشوف الرقم اتغيّر ليه.

import { currentTenantId, currentUser } from '../auth/auth.js';
import { $id, esc } from '../core/dom.js';
import { fmtD, fmtDT, num } from '../core/format.js';
import { renderLoadError } from '../core/loaderr.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { isAdmin } from '../orders/guards.js';

export var commissionRows = [];        // upsell_events
export var commissionBalances = [];    // v_commission_balances
export var commissionSettlements = []; // commission_settlements

export function commissionsSetRows(v){ commissionRows = v || []; }
export function commissionsSetBalances(v){ commissionBalances = v || []; }
export function commissionsSetSettlements(v){ commissionSettlements = v || []; }

export var CM_STATUS = { pending:'معلّقة', earned:'مستحقة', void:'ملغية' };

var cmGen = 0;

// الرصيد بيتقرا من الفيو — والفيو `security_invoker` فالموظف بيشوف صفه
// والأدمن بيشوف متجره من غير أي منطق صلاحيات هنا.
export function loadCommissions(cb){
  if(!sb || !currentTenantId){ if(cb)cb(); return; }
  var myGen = ++cmGen;
  var box = $id('cm-tbody');
  if(box && isAdmin()) box.innerHTML = '<div class="ldg"><div class="spin"></div>جاري التحميل...</div>';
  Promise.all([
    sb.from('v_commission_balances')
      .select('user_id,user_name,events_count,pending_total,earned_total,void_total,settled_total,settlements_count,outstanding')
      .eq('tenant_id', currentTenantId),
    sb.from('upsell_events')
      .select('id,order_id,user_id,user_name,before_total,after_total,delta,commission_type,commission_rate,commission_amount,status,resolved_at,created_at')
      .eq('tenant_id', currentTenantId).order('created_at', { ascending:false }).limit(500),
    sb.from('commission_settlements')
      .select('id,user_id,user_name,amount,kind,reverses_id,note,created_by_name,created_at')
      .eq('tenant_id', currentTenantId).order('created_at', { ascending:false }).limit(300)
  ]).then(function(res){
    if(myGen !== cmGen) return;   // رد أقدم وصل بعد أحدث
    if(res[0].error || res[1].error || res[2].error){
      if(isAdmin()) renderLoadError('finance');
      if(cb)cb(); return;
    }
    commissionsSetBalances(res[0].data || []);
    commissionsSetRows(res[1].data || []);
    commissionsSetSettlements(res[2].data || []);
    if(isAdmin()) renderCommissions();
    if(cb)cb();
  });
}

// رصيد المستخدم الحالي — بيستخدمه شريط الموظف وصفحة «عمولتي»
export function myBalance(){
  var uid = currentUser && currentUser.id;
  if(!uid) return null;
  for(var i = 0; i < commissionBalances.length; i++){
    if(commissionBalances[i].user_id === uid) return commissionBalances[i];
  }
  return { user_id:uid, user_name:(currentUser && currentUser.name) || '—', events_count:0,
           pending_total:0, earned_total:0, void_total:0, settled_total:0,
           settlements_count:0, outstanding:0 };
}

function balancePill(v){
  var n = Number(v || 0);
  if(n < 0) return '<span class="cm-owed">عليه ' + num(Math.round(Math.abs(n))) + ' ج</span>';
  return '<span class="cm-earned">مستحق ' + num(Math.round(n)) + ' ج</span>';
}

export function renderCommissions(){
  var box = $id('cm-tbody');
  if(!box) return;
  var want = $id('cm-filter-status') ? $id('cm-filter-status').value : '';
  var rows = commissionRows.filter(function(x){ return !want || x.status === want; });

  // الكروت على **كل** الحركات — الفلتر للجدول بس
  var sums = { pending:0, earned:0, void:0 }, settled = 0, outstanding = 0;
  commissionRows.forEach(function(x){
    if(sums[x.status] !== undefined) sums[x.status] += Number(x.commission_amount || 0);
  });
  commissionBalances.forEach(function(b){
    settled += Number(b.settled_total || 0);
    outstanding += Number(b.outstanding || 0);
  });
  if($id('cm-sum-pending')) $id('cm-sum-pending').textContent = num(Math.round(sums.pending)) + ' ج';
  if($id('cm-sum-earned'))  $id('cm-sum-earned').textContent  = num(Math.round(sums.earned))  + ' ج';
  if($id('cm-sum-settled')) $id('cm-sum-settled').textContent = num(Math.round(settled)) + ' ج';
  if($id('cm-sum-out'))     $id('cm-sum-out').textContent     = num(Math.round(outstanding)) + ' ج';
  if($id('cm-count'))       $id('cm-count').textContent = rows.length + ' حركة';

  // كارت لكل موظف + زرار التسوية — ده اللي بتصرف منه
  var ub = $id('cm-by-user');
  if(ub){
    var users = commissionBalances.slice().sort(function(a,b){
      return Number(b.outstanding || 0) - Number(a.outstanding || 0);
    });
    ub.innerHTML = users.length
      ? '<div class="cm-users">' + users.map(function(u){
          return '<div class="cm-user">'
            + '<div class="cm-user-name">' + esc(u.user_name || '—')
            +   '<span class="cm-user-n">' + (u.events_count || 0) + ' حركة</span></div>'
            + '<div class="cm-user-nums">'
            +   balancePill(u.outstanding)
            +   '<span class="cm-pending">معلّق ' + num(Math.round(u.pending_total || 0)) + ' ج</span>'
            +   (Number(u.settled_total || 0) !== 0
                  ? '<span class="cm-settled">اتصرف ' + num(Math.round(u.settled_total)) + ' ج</span>' : '')
            + '</div>'
            + '<button class="cm-settle-btn" data-cm-settle="' + esc(u.user_id) + '">💵 تسوية</button>'
            + '</div>';
        }).join('') + '</div>'
      : '';
    ub.querySelectorAll('[data-cm-settle]').forEach(function(b){
      b.addEventListener('click', function(){ openSettle(b.getAttribute('data-cm-settle')); });
    });
  }

  renderSettlements();

  if(!rows.length){
    box.innerHTML = '<div class="cm-empty">'
      + (commissionRows.length ? 'مفيش عمولات في الحالة دي.'
         : 'لسه مفيش عمولات upselling. فعّلها لموظف من الإعدادات ← موظفين المتجر.')
      + '</div>';
    return;
  }

  var h = '<table><thead><tr>'
    + '<th>التاريخ</th><th>الموظف</th><th>قبل</th><th>بعد</th><th>الزيادة</th>'
    + '<th>العمولة</th><th>الحالة</th><th>الأوردر</th></tr></thead><tbody>';
  rows.forEach(function(x){
    var rate = x.commission_type === 'percent'
      ? (num(x.commission_rate) + '%') : (num(x.commission_rate) + ' ج ثابت');
    h += '<tr class="cm-row" data-cm-order="' + esc(x.order_id) + '">'
      + '<td class="mn">' + esc(fmtD(x.created_at)) + '</td>'
      + '<td class="nm">' + esc(x.user_name || '—') + '</td>'
      + '<td class="mn">' + num(x.before_total) + '</td>'
      + '<td class="mn">' + num(x.after_total) + '</td>'
      + '<td class="mn cm-delta">+' + num(x.delta) + '</td>'
      + '<td class="mn cm-amt" title="' + esc(rate) + '">' + num(x.commission_amount) + ' ج</td>'
      + '<td><span class="cm-badge ' + esc(x.status) + '">' + esc(CM_STATUS[x.status] || x.status) + '</span></td>'
      + '<td><span class="cm-open">افتح ↗</span></td>'
      + '</tr>';
  });
  h += '</tbody></table>';
  box.innerHTML = h;

  // الضغط على الصف يفتح الأوردر — أسرع طريق للمراجعة
  box.querySelectorAll('.cm-row').forEach(function(tr){
    tr.addEventListener('click', function(){ openOrderFromCommission(tr.getAttribute('data-cm-order')); });
  });
}

// استيراد كسول: detail.js بيستورد من finance بشكل غير مباشر، والاستيراد
// الساكن هنا بيقفل دورة تقييم. الديناميكي بيفكها وبيحمّل عند الضغط بس.
export function openOrderFromCommission(orderId){
  if(!orderId) return;
  import('../orders/detail.js').then(function(m){ m.openDetail(orderId); })
    .catch(function(){ toast('مقدرناش نفتح الأوردر','er'); });
}

export function renderSettlements(){
  var box = $id('cm-settlements');
  if(!box) return;
  if(!commissionSettlements.length){
    box.innerHTML = '<div class="cm-empty sm">لسه مفيش تسويات.</div>';
    return;
  }
  var reversed = {};
  commissionSettlements.forEach(function(s){ if(s.reverses_id) reversed[s.reverses_id] = true; });
  var h = '<table><thead><tr><th>التاريخ</th><th>الموظف</th><th>المبلغ</th>'
        + '<th>ملاحظة</th><th>بواسطة</th>' + (isAdmin() ? '<th></th>' : '') + '</tr></thead><tbody>';
  commissionSettlements.forEach(function(s){
    var isRev = s.kind === 'reversal';
    h += '<tr class="' + (isRev ? 'cm-rev' : '') + '">'
      + '<td class="mn">' + esc(fmtDT(s.created_at)) + '</td>'
      + '<td class="nm">' + esc(s.user_name || '—') + '</td>'
      + '<td class="mn ' + (isRev ? 'cm-neg' : 'cm-pos') + '">'
      +   (isRev ? '' : '−') + num(Math.abs(Number(s.amount || 0))) + ' ج'
      +   (isRev ? '<span class="cm-rev-tag">إلغاء</span>' : '') + '</td>'
      + '<td class="pr">' + esc(s.note || '—') + '</td>'
      + '<td class="pr">' + esc(s.created_by_name || '—') + '</td>'
      + (isAdmin()
          ? '<td>' + (!isRev && !reversed[s.id]
              ? '<button class="cm-rev-btn" data-cm-rev="' + esc(s.id) + '">إلغاء</button>'
              : '') + '</td>'
          : '')
      + '</tr>';
  });
  h += '</tbody></table>';
  box.innerHTML = h;
  box.querySelectorAll('[data-cm-rev]').forEach(function(b){
    b.addEventListener('click', function(){ reverseSettlement(b.getAttribute('data-cm-rev')); });
  });
}

function balanceOf(userId){
  for(var i = 0; i < commissionBalances.length; i++){
    if(commissionBalances[i].user_id === userId) return commissionBalances[i];
  }
  return null;
}

export function openSettle(userId){
  var b = balanceOf(userId);
  if(!b) return;
  var out = Number(b.outstanding || 0);
  if(out <= 0){
    toast(out < 0 ? ('الرصيد بالسالب — ' + (b.user_name||'الموظف') + ' عليه ' + num(Math.round(Math.abs(out))) + ' ج')
                  : 'مفيش مستحق للصرف دلوقتي', 'er');
    return;
  }
  showModal({
    icon: '💵',
    title: 'تسوية عمولة ' + (b.user_name || ''),
    sub: 'المستحق دلوقتي ' + num(Math.round(out)) + ' ج.\n'
       + 'المبلغ اللي هتصرفه هيتخصم من رصيده على طول، وهو هيشوف التسوية في صفحته.',
    input: true,
    inputValue: String(Math.round(out)),
    placeholder: 'المبلغ بالجنيه',
    okLabel: 'سجّل التسوية',
    okColor: 'linear-gradient(135deg,#10b981,#059669)',
    onOk: function(val){
      var amt = parseFloat(val);
      if(!isFinite(amt) || amt <= 0){ toast('اكتب مبلغ أكبر من صفر','er'); return; }
      sb.rpc('settle_commission', { p_user_id: userId, p_amount: amt, p_note: null }).then(function(r){
        if(r.error){
          var m = r.error.message || '';
          toast(m.indexOf('admin_only') >= 0 ? 'الصلاحية دي للأدمن فقط'
              : m.indexOf('user_not_found') >= 0 ? 'الموظف ده مش في متجرك'
              : ('مانفعش: ' + m), 'er');
          return;
        }
        toast('اتسجّلت تسوية ' + num(Math.round(amt)) + ' ج ✓','ok');
        loadCommissions();
      });
    }
  });
}

export function reverseSettlement(id){
  showModal({
    icon: '↩️',
    title: 'إلغاء التسوية',
    sub: 'التسوية مش هتتمسح — هيتسجّل قيد عكسي والمبلغ هيرجع للمستحق.\n'
       + 'الموظف هيشوف القيدين، فمفيش رقم بيتغيّر من غير سبب ظاهر.',
    okLabel: 'سجّل الإلغاء',
    okColor: 'linear-gradient(135deg,#f59e0b,#d97706)',
    onOk: function(){
      sb.rpc('reverse_settlement', { p_settlement_id: id, p_note: null }).then(function(r){
        if(r.error){
          var m = r.error.message || '';
          toast(m.indexOf('already_reversed') >= 0 ? 'التسوية دي اتلغت قبل كده'
              : m.indexOf('admin_only') >= 0 ? 'الصلاحية دي للأدمن فقط'
              : ('مانفعش: ' + m), 'er');
          loadCommissions();
          return;
        }
        toast('اتسجّل قيد الإلغاء ✓','ok');
        loadCommissions();
      });
    }
  });
}

export function wireCommissionEvents(){
  var f = $id('cm-filter-status');
  if(f) f.addEventListener('change', renderCommissions);
}


// ══ جهة الموظف ═══════════════════════════════════════════════════════
// الموظف مابيدخلش الماليات (admin-only)، فبيشوف رصيده في مكانين:
// شريط فوق جدول الطلبات (المكان اللي قاعد عليه) وصفحة «عمولتي» بالتفاصيل.
// الأرقام كلها من نفس الفيو — الـRLS بترجّعله صفه هو بس.

export function myCommissionEnabled(){
  return !!(currentUser && currentUser.upsell_commission_enabled);
}

// الزرار في القايمة بيظهر بس للموظف اللي عمولته مفعّلة — الأدمن عنده
// الصورة الكاملة في الماليات فمش محتاج نسخة مصغّرة
export function refreshMyCommissionNav(){
  var btn = $id('nav-mycommission');
  if(!btn) return;
  btn.style.display = (myCommissionEnabled() && !isAdmin()) ? '' : 'none';
}

export function renderMyCommissionBar(){
  var bar = $id('my-cm-bar');
  if(!bar) return;
  if(!myCommissionEnabled() || isAdmin()){ bar.style.display = 'none'; bar.innerHTML = ''; return; }
  var b = myBalance();
  if(!b){ bar.style.display = 'none'; return; }
  var out = Number(b.outstanding || 0);
  bar.innerHTML = '<span class="my-cm-ico">💰</span>'
    + '<span class="my-cm-txt">عمولتك</span>'
    + (out < 0
        ? '<span class="cm-owed">عليك ' + num(Math.round(Math.abs(out))) + ' ج</span>'
        : '<span class="cm-earned">ليك ' + num(Math.round(out)) + ' ج</span>')
    + '<span class="cm-pending">معلّق ' + num(Math.round(b.pending_total || 0)) + ' ج</span>'
    + '<span class="my-cm-n">' + (b.events_count || 0) + ' حركة</span>'
    + '<button class="my-cm-go" id="my-cm-go">التفاصيل ↗</button>';
  bar.style.display = '';
  var go = $id('my-cm-go');
  if(go) go.addEventListener('click', function(){
    import('../main.js').then(function(m){ m.showPage('mycommission'); });
  });
}

export function loadMyCommission(){
  loadCommissions(function(){ renderMyCommission(); renderMyCommissionBar(); });
}

export function renderMyCommission(){
  var b = myBalance();
  if(!b) return;
  var out = Number(b.outstanding || 0);
  if($id('my-cm-out')){
    $id('my-cm-out').textContent = (out < 0 ? '−' : '') + num(Math.round(Math.abs(out))) + ' ج';
    $id('my-cm-out').className = 'sval' + (out < 0 ? ' cm-neg-val' : '');
  }
  if($id('my-cm-pending')) $id('my-cm-pending').textContent = num(Math.round(b.pending_total || 0)) + ' ج';
  if($id('my-cm-settled')) $id('my-cm-settled').textContent = num(Math.round(b.settled_total || 0)) + ' ج';

  // نسبته ونوع عمولته — عشان يقدر يراجع الحساب بنفسه
  var rate = $id('my-cm-rate');
  if(rate){
    var t = currentUser && currentUser.upsell_commission_type;
    var v = currentUser && currentUser.upsell_commission_value;
    rate.innerHTML = t
      ? '📐 عمولتك: <b>' + (t === 'percent' ? esc(String(v)) + '% من مبلغ الزيادة' : esc(String(v)) + ' ج لكل عملية')
        + '</b> — بتستحق لما الأوردر يتسلّم، وبتتلغي لو رجع أو اتلغى.'
      : '';
    rate.style.display = t ? '' : 'none';
  }

  var uid = currentUser && currentUser.id;
  var mine = commissionRows.filter(function(x){ return x.user_id === uid; });
  var ev = $id('my-cm-events');
  if(ev){
    ev.innerHTML = mine.length
      ? '<table><thead><tr><th>التاريخ</th><th>قبل</th><th>بعد</th><th>الزيادة</th><th>عمولتك</th><th>الحالة</th></tr></thead><tbody>'
        + mine.map(function(x){
            return '<tr>'
              + '<td class="mn">' + esc(fmtD(x.created_at)) + '</td>'
              + '<td class="mn">' + num(x.before_total) + '</td>'
              + '<td class="mn">' + num(x.after_total) + '</td>'
              + '<td class="mn cm-delta">+' + num(x.delta) + '</td>'
              + '<td class="mn cm-amt">' + num(x.commission_amount) + ' ج</td>'
              + '<td><span class="cm-badge ' + esc(x.status) + '">' + esc(CM_STATUS[x.status] || x.status) + '</span></td>'
              + '</tr>';
          }).join('')
        + '</tbody></table>'
      : '<div class="cm-empty sm">لسه مفيش حركات upselling ليك.</div>';
  }

  var st = $id('my-cm-settlements');
  if(st){
    var ms = commissionSettlements.filter(function(x){ return x.user_id === uid; });
    st.innerHTML = ms.length
      ? '<table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظة</th><th>بواسطة</th></tr></thead><tbody>'
        + ms.map(function(x){
            var isRev = x.kind === 'reversal';
            return '<tr class="' + (isRev ? 'cm-rev' : '') + '">'
              + '<td class="mn">' + esc(fmtDT(x.created_at)) + '</td>'
              + '<td class="mn ' + (isRev ? 'cm-neg' : 'cm-pos') + '">'
              +   (isRev ? '' : '−') + num(Math.abs(Number(x.amount || 0))) + ' ج'
              +   (isRev ? '<span class="cm-rev-tag">إلغاء</span>' : '') + '</td>'
              + '<td class="pr">' + esc(x.note || '—') + '</td>'
              + '<td class="pr">' + esc(x.created_by_name || '—') + '</td>'
              + '</tr>';
          }).join('')
        + '</tbody></table>'
      : '<div class="cm-empty sm">لسه مفيش تسويات.</div>';
  }
}
