// المحفظة والباقات والشحن وقفل نفاد الرصيد

import { emptyState } from '../core/empty.js';
import { veilDone } from '../core/veil.js';
import { $id } from '../core/dom.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { showPage } from '../main.js';
import { esc } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { currentTenantId } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { doFilter } from '../orders/orders.js';
import { fmtDateTime, fmtMoneyShort, loadVfcashNumber, renderBillingSummary } from '../orders/billing-summary.js';
import { ensureTenant, isAdmin } from '../orders/guards.js';

export var walletStateCache = null; // {wallet_balance, overdraft_limit, available, orders_used_cycle, max_orders, orders_remaining, overage_debt, plan, plan_name, monthly_price, per_order_price, pricing_type, subscription_status, cycle_started_at, cycle_ends_at, is_lifetime, is_depleted}

export var billingTopupFile = null;

// ---------- Load wallet state (used by topbar chip + billing page) ----------
export function loadWalletState(cb){
  if(!sb || !currentTenantId){ if(cb) cb(null); return; }
  if(tourActive){ if(cb) cb(null); return; } // tour mode: don't hit DB
  sb.from('wallet_state').select('*').eq('tenant_id', currentTenantId).maybeSingle().then(function(r){
    if(r.error){ console.warn('wallet_state load error', r.error.message); if(cb) cb(null); return; }
    walletStateCache = r.data || null;
    updateWalletChip();
    applyDepletionLock();
    if(cb) cb(walletStateCache);
  });
}

// ---------- Topbar wallet chip ----------
export function updateWalletChip(){
  var chip = $id('wallet-chip');
  if(!chip) return;
  if(!isAdmin() || !walletStateCache){ chip.style.display='none'; return; }
  chip.style.display = 'inline-flex';
  var s = walletStateCache;
  var balSeg = $id('wchip-bal-seg');
  var balEl = $id('wchip-bal');
  var planEl = $id('wchip-plan');
  var ctEl = $id('wchip-counter');

  // Balance segment
  balEl.textContent = fmtMoneyShort(s.wallet_balance);
  balSeg.classList.remove('warn','danger');
  if(s.is_depleted){ balSeg.classList.add('danger'); }
  else if(parseFloat(s.wallet_balance) < 20){ balSeg.classList.add('warn'); }

  // Plan name + counter sub-line
  var planShort = {payg:'PAYG', growth:'Growth', unlimited:'Unlimited', lifetime:'Lifetime'};
  planEl.textContent = planShort[s.plan] || (s.plan_name || '—');

  if(s.pricing_type === 'per_order'){
    ctEl.textContent = '75ق/أوردر';
  } else if(s.max_orders){
    var used = s.orders_used_cycle || 0;
    ctEl.textContent = used.toLocaleString('ar-EG') + ' / ' + s.max_orders.toLocaleString('ar-EG');
  } else {
    ctEl.textContent = 'غير محدود';
  }
  chip.onclick = function(){ showPage('billing'); };
}

// ---------- Depletion lock: blur sensitive cells when wallet is empty ----------
export function applyDepletionLock(){
  if(!walletStateCache) return;
  var locked = !!walletStateCache.is_depleted;
  document.body.classList.toggle('wallet-depleted', locked);
  // Banner on the orders page
  var banner = $id('wallet-lock-banner');
  if(locked && !banner){
    banner = document.createElement('div');
    banner.id = 'wallet-lock-banner';
    banner.className = 'lock-banner';
    banner.innerHTML = '<div class="lbtxt">🔒 رصيد المحفظة انتهى<small>بيانات الأوردرات مخفية لحد ما تشحن. اشحن دلوقتي عشان تكمّل شغلك بدون انقطاع.</small></div><button type="button" class="lock-banner-btn">شحن المحفظة</button>';
    var hostMain = $id('page-orders');
    if(hostMain) hostMain.insertBefore(banner, hostMain.firstChild);
    var btn = banner.querySelector('.lock-banner-btn');
    if(btn) btn.addEventListener('click', function(){ showPage('billing'); });
  } else if(!locked && banner){
    banner.remove();
  }
  // Re-render table to apply locked cells if currently on orders page
  if(locked && typeof doFilter === 'function'){ try{ doFilter(); }catch(e){ swallow('applyDepletionLock/doFilter', e); } }
}

// ---------- Open billing page ----------
export function loadBilling(){
  if(!isAdmin()){veilDone('billing');return;}
  if(!ensureTenant()){veilDone('billing');return;}
  loadVfcashNumber(); // always fetch the latest number
  loadWalletState(function(){
    renderBillingSummary();
    renderPlanCards();
    veilDone('billing');
    loadWalletHistory();
    loadMyTopupRequests();
  });
}

export function renderPlanCards(){
  if(!sb) return;
  var grid = $id('plan-grid');
  grid.innerHTML = '<div class="ldg">جاري التحميل...</div>';
  sb.from('plans').select('*').eq('active', true).order('sort_order').then(function(r){
    if(r.error){ grid.innerHTML = '<div class="ldg">خطأ: '+esc(r.error.message)+'</div>'; return; }
    var plans = r.data || [];
    var curPlan = walletStateCache ? walletStateCache.plan : null;
    var h = '';
    plans.forEach(function(p){
      var isCurrent = (p.id === curPlan);
      var badge = '';
      var cardCls = '';
      if(isCurrent){ badge = '<span class="plan-badge current">✓ باقتك الحالية</span>'; cardCls = 'current'; }
      else if(p.id === 'growth'){ badge = '<span class="plan-badge popular">⭐ الأكثر شعبية</span>'; cardCls = 'popular'; }
      else if(p.id === 'lifetime'){ badge = '<span class="plan-badge lifetime">💎 محدودة</span>'; cardCls = 'lifetime'; }

      var priceLine;
      if(p.pricing_type === 'per_order'){
        priceLine = '<div class="plan-price">' + (parseFloat(p.per_order_price)||0).toLocaleString('ar-EG') + 'ج <small>/ أوردر مؤكد</small></div>';
      } else {
        priceLine = '<div class="plan-price">' + (parseFloat(p.monthly_price)||0).toLocaleString('ar-EG') + 'ج <small>/ شهر</small></div>';
      }

      var features = (Array.isArray(p.features) ? p.features : []);
      var fH = '<ul class="plan-features">' + features.map(function(f){ return '<li>'+esc(f)+'</li>'; }).join('') + '</ul>';

      var btnTxt = isCurrent ? 'باقتك الحالية' : 'اختيار الباقة';
      var btnCls = isCurrent ? 'plan-btn current' : 'plan-btn';

      h += '<div class="plan-card '+cardCls+'">'
        + badge
        + '<div class="plan-name">'+esc(p.name_ar)+'</div>'
        + priceLine
        + fH
        + '<button class="'+btnCls+'" '+(isCurrent?'disabled':'')+' data-act="plan-select" data-plan="'+esc(p.id)+'">'+btnTxt+'</button>'
        + '</div>';
    });
    grid.innerHTML = h;
  });
}

// Plan selection: PAYG is free to switch to; paid plans need confirmation + sufficient balance.
export var selectPlan = function(planId){
  if(!walletStateCache){ toast('انتظر اكتمال التحميل','er'); return; }
  if(walletStateCache.plan === planId){ return; }
  sb.from('plans').select('*').eq('id', planId).maybeSingle().then(function(r){
    if(r.error || !r.data){ toast('خطأ في تحميل الباقة','er'); return; }
    var p = r.data;
    var msg = 'هل تريد التبديل إلى باقة "' + p.name_ar + '"?';
    if(p.pricing_type !== 'per_order' && parseFloat(p.monthly_price) > 0){
      msg += '\n\nسيتم خصم ' + (parseFloat(p.monthly_price)).toLocaleString('ar-EG') + ' جنيه من محفظتك فوراً.';
      msg += '\nرصيدك الحالي: ' + fmtMoneyShort(walletStateCache.wallet_balance);
      if(parseFloat(walletStateCache.wallet_balance) < parseFloat(p.monthly_price)){
        msg += '\n\n⚠️ رصيدك غير كافي. اشحن المحفظة أولاً.';
      }
    }
    if(!confirm(msg)) return;

    // For PAYG: just update tenant.plan (no immediate charge — charges happen per-order)
    // For fixed plans: charge via RPC (a planned rpc; here we simulate by inserting a wallet_tx + updating tenant)
    // Since renew_subscription is for cron-based renewals, we do a direct switch here.
    switchPlan(planId, p);
  });
};

export function switchPlan(planId, planRow){
  // Single atomic RPC: validates admin, checks balance, charges wallet, swaps plan, updates cycle.
  sb.rpc('switch_plan', { p_plan_id: planId }).then(function(r){
    if(r.error){
      var msg = r.error.message || 'خطأ غير معروف';
      if(/Insufficient balance/i.test(msg)){
        toast('رصيدك غير كافي لتفعيل هذه الباقة. اشحن المحفظة أولاً.','er');
      } else if(/Already on plan/i.test(msg)){
        toast('أنت بالفعل على هذه الباقة','er');
      } else if(/Admin only/i.test(msg)){
        toast('الصلاحية دي للأدمن فقط','er');
      } else {
        toast('خطأ: '+msg,'er');
      }
      return;
    }
    var res = r.data || {};
    var charged = parseFloat(res.charged)||0;
    if(charged > 0){
      toast('تم تفعيل ' + planRow.name_ar + ' وخصم ' + charged.toLocaleString('ar-EG') + ' جنيه من محفظتك ✓','ok');
    } else {
      toast('تم التحويل إلى ' + planRow.name_ar + ' بنجاح ✓','ok');
    }
    loadWalletState(function(){
      renderBillingSummary();
      renderPlanCards();
      loadWalletHistory();
    });
  });
}

// ---------- Wallet history ----------
export function loadWalletHistory(){
  var tbody = $id('wallet-history-tbody');
  if(!tbody) return;
  tbody.innerHTML = '<div class="ldg">جاري التحميل...</div>';
  sb.from('wallet_transactions')
    .select('*')
    .eq('tenant_id', currentTenantId)
    .order('created_at',{ascending:false})
    .limit(50)
    .then(function(r){
      if(r.error){ tbody.innerHTML = '<div class="ldg">خطأ: '+esc(r.error.message)+'</div>'; return; }
      var rows = r.data || [];
      if(!rows.length){ tbody.innerHTML = emptyState({icon:'💳',
        title:'مفيش حركات على المحفظة لسه',
        sub:'كل شحن رصيد أو خصم هيتسجّل هنا بالتفصيل أول بأول.'}); return; }
      var TYPES = {
        topup: 'شحن',
        order_charge: 'خصم أوردر',
        plan_charge: 'خصم باقة',
        signup_bonus: 'رصيد ترحيبي',
        adjustment: 'تعديل أدمن',
        refund: 'استرداد'
      };
      var h = '<table class="history-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>المبلغ</th><th>الرصيد بعد</th></tr></thead><tbody>';
      rows.forEach(function(t){
        var amt = parseFloat(t.amount)||0;
        var cls = amt >= 0 ? 'pos' : 'neg';
        var sign = amt >= 0 ? '+' : '−';
        h += '<tr>'
          + '<td>'+esc(fmtDateTime(t.created_at))+'</td>'
          + '<td><span class="htx-type '+esc(t.type)+'">'+esc(TYPES[t.type]||t.type)+'</span></td>'
          + '<td>'+esc(t.description||'—')+'</td>'
          + '<td class="htx-amount '+cls+'">'+sign+' '+Math.abs(amt).toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2})+'ج</td>'
          + '<td class="htx-amount">'+(parseFloat(t.balance_after)||0).toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2})+'ج</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
      tbody.innerHTML = h;
    });
}

// ---------- My topup requests ----------
export function loadMyTopupRequests(){
  var tbody = $id('my-topups-tbody');
  if(!tbody) return;
  tbody.innerHTML = '<div class="ldg">جاري التحميل...</div>';
  sb.from('topup_requests')
    .select('*')
    .eq('tenant_id', currentTenantId)
    .order('created_at',{ascending:false})
    .limit(20)
    .then(function(r){
      if(r.error){ tbody.innerHTML = '<div class="ldg">خطأ: '+esc(r.error.message)+'</div>'; return; }
      var rows = r.data || [];
      if(!rows.length){ tbody.innerHTML = '<div class="ldg">لم ترسل طلبات شحن بعد</div>'; return; }
      var ST = {pending:'قيد المراجعة',approved:'تم القبول ✓',rejected:'مرفوض'};
      var h = '<table class="history-table"><thead><tr><th>التاريخ</th><th>المبلغ</th><th>الرقم المُحوّل منه</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>';
      rows.forEach(function(t){
        h += '<tr>'
          + '<td>'+esc(fmtDateTime(t.created_at))+'</td>'
          + '<td class="htx-amount pos">+'+(parseFloat(t.amount)||0).toLocaleString('ar-EG')+'ج</td>'
          + '<td>'+esc(t.sender_phone||'—')+'</td>'
          + '<td><span class="tup-status '+esc(t.status)+'">'+esc(ST[t.status]||t.status)+'</span></td>'
          + '<td>'+esc(t.reject_reason||'—')+'</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
      tbody.innerHTML = h;
    });
}

// ---------- Submit topup request ----------
export function submitTopupRequest(){
  var amount = parseFloat($id('topup-amount').value);
  var phone = ($id('topup-phone').value||'').trim();
  var fileInput = $id('topup-screenshot');
  var file = fileInput && fileInput.files && fileInput.files[0];

  if(!amount || amount < 50){ toast('أقل مبلغ شحن 50 جنيه','er'); return; }
  if(!phone || phone.length < 10){ toast('أدخل رقم الموبايل اللي حوّلت منه','er'); return; }

  var btn = $id('topup-submit');
  btn.disabled = true;
  btn.textContent = 'جاري الإرسال...';

  function doInsert(screenshotUrl){
    sb.rpc('request_topup', {
      p_amount: amount,
      p_sender_phone: phone,
      p_screenshot_url: screenshotUrl || null
    }).then(function(r){
      btn.disabled = false;
      btn.textContent = 'إرسال طلب الشحن';
      if(r.error){ toast('خطأ: '+r.error.message,'er'); return; }
      toast('تم إرسال طلب الشحن. هتتم المراجعة وإضافة الرصيد خلال ساعات ✓','ok');
      $id('topup-amount').value = '';
      $id('topup-phone').value = '';
      if(fileInput) fileInput.value = '';
      $id('topup-fname').textContent = 'لم يتم اختيار ملف';
      billingTopupFile = null;
      loadMyTopupRequests();
    });
  }

  if(!file){
    doInsert(null);
    return;
  }
  // Upload to Supabase Storage bucket "topup-screenshots"
  var ext = (file.name.split('.').pop()||'jpg').toLowerCase();
  var path = currentTenantId + '/' + Date.now() + '.' + ext;
  sb.storage.from('topup-screenshots').upload(path, file, {cacheControl:'3600', upsert:false}).then(function(r){
    if(r.error){
      // If bucket doesn't exist or upload fails, submit without screenshot
      console.warn('Screenshot upload failed:', r.error.message);
      toast('تعذّر رفع الصورة، هنرسل الطلب بدونها','er');
      doInsert(null);
      return;
    }
    // الـ bucket بقى خاص — بنخزّن المسار بس، ولوحة الأدمن بتعمل Signed URL وقت العرض
    doInsert(path);
  });
}

// Wire up topup form events (on page load via DOMContentLoaded — done at bottom of script)
export function wireBillingEvents(){
  var fileInput = $id('topup-screenshot');
  if(fileInput){
    fileInput.addEventListener('change', function(){
      var f = fileInput.files && fileInput.files[0];
      $id('topup-fname').textContent = f ? f.name : 'لم يتم اختيار ملف';
      billingTopupFile = f;
    });
  }
  var submitBtn = $id('topup-submit');
  if(submitBtn) submitBtn.addEventListener('click', submitTopupRequest);
  var refreshBtn = $id('bill-refresh');
  if(refreshBtn) refreshBtn.addEventListener('click', function(){ loadBilling(); });
}
