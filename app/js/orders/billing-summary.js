// ملخّص الفوترة وبوابة الإنبوكس داخل صفحة الأوردرات

import { walletStateCache } from '../billing/billing.js';
import { $id, esc } from '../core/dom.js';
import { sb } from '../core/supabase.js';
import { fmtMoney } from '../finance/finance.js';
import { showPage } from '../main.js';

// ============================================================
// BILLING / WALLET MODULE
// ============================================================
// Vodafone Cash number — loaded dynamically from platform_settings (updatable by super admin)
export var VFCASH_NUMBER = '—';

export function loadVfcashNumber(){
  if(!sb) return;
  sb.from('platform_settings').select('value').eq('key','vfcash_number').maybeSingle().then(function(r){
    if(r.error || !r.data) return;
    VFCASH_NUMBER = r.data.value || '—';
    var el = $id('vfcash-number');
    if(el) el.textContent = VFCASH_NUMBER;
  });
}

export function fmtMoneyShort(n){
  var v = parseFloat(n) || 0;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ar-EG', {maximumFractionDigits: 2}) + 'ج';
}

export function fmtDate(s){ if(!s) return '—'; var d=new Date(s); return d.toLocaleDateString('ar-EG',{day:'numeric',month:'short',year:'numeric'}); }

export function fmtDateTime(s){ if(!s) return '—'; var d=new Date(s); return d.toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); }

// helper used inside the row renderer (defined in the existing table code)
export function lockMaybe(value){
  if(walletStateCache && walletStateCache.is_depleted){
    // Never put the real value in the DOM — inspect/copy/screen-readers would expose it.
    // Render a fixed placeholder; the actual data stays only in the in-memory `all` array.
    return '<span class="locked-cell">••••••••</span>';
  }
  return esc(String(value||''));
}

export function renderBillingSummary(){
  var s = walletStateCache;
  if(!s) return;
  $id('bill-balance').textContent = fmtMoney(s.wallet_balance);
  var hint = '';
  if(s.is_depleted){ hint = '⚠️ الرصيد انتهى — اشحن دلوقتي'; }
  else if(parseFloat(s.overdraft_limit) > 0){ hint = 'سماح: ' + fmtMoneyShort(s.overdraft_limit); }
  else { hint = 'بدون سماح (PAYG)'; }
  $id('bill-balance-hint').textContent = hint;

  $id('bill-plan-name').textContent = s.plan_name || '—';
  if(s.pricing_type === 'per_order'){
    $id('bill-plan-price').textContent = (parseFloat(s.per_order_price)||0).toLocaleString('ar-EG') + 'ج / أوردر مؤكد';
  } else {
    $id('bill-plan-price').textContent = (parseFloat(s.monthly_price)||0).toLocaleString('ar-EG') + 'ج / شهر';
  }

  // Cycle stat
  if(s.max_orders){
    $id('bill-cycle-used').textContent = (s.orders_used_cycle||0).toLocaleString('ar-EG') + ' / ' + s.max_orders.toLocaleString('ar-EG');
    var rem = s.orders_remaining;
    if(rem !== null && rem < 0){
      $id('bill-cycle-hint').textContent = '⚠️ تجاوزت بـ ' + Math.abs(rem) + ' أوردر · مديونية: ' + fmtMoneyShort(s.overage_debt);
    } else {
      $id('bill-cycle-hint').textContent = (rem || 0) + ' أوردر متبقّي';
    }
  } else if(s.pricing_type === 'per_order'){
    $id('bill-cycle-used').textContent = (s.orders_used_cycle||0).toLocaleString('ar-EG');
    $id('bill-cycle-hint').textContent = 'أوردر مؤكد · بتُحاسَب 75 قرش لكل واحد';
  } else {
    $id('bill-cycle-used').textContent = (s.orders_used_cycle||0).toLocaleString('ar-EG');
    $id('bill-cycle-hint').textContent = 'أوردر مؤكد · بدون سقف';
  }

  // Renewal
  if(s.cycle_ends_at){
    $id('bill-renew-date').textContent = fmtDate(s.cycle_ends_at);
    var days = Math.ceil((new Date(s.cycle_ends_at) - new Date()) / 86400000);
    $id('bill-renew-hint').textContent = (days > 0 ? 'بعد ' + days + ' يوم' : (days === 0 ? 'اليوم' : 'متأخر ' + Math.abs(days) + ' يوم'));
  } else {
    $id('bill-renew-date').textContent = '—';
    $id('bill-renew-hint').textContent = (s.pricing_type === 'per_order' ? 'لا يوجد تجديد (PAYG)' : '—');
  }

  // VF cash number
  $id('vfcash-number').textContent = VFCASH_NUMBER;
}

// ---- بوابة تبويب المحادثات: مفتوح للموثّقين بس ----
export var inboxVerified = null;

export function refreshInboxGate(){
  if(!sb) return Promise.resolve(false);
  return sb.rpc('wa_inbox_status').then(function(r){
    var d = (!r.error && r.data) ? r.data : {};
    inboxVerified = !!d.verified;
    return inboxVerified;
  }).catch(function(){ inboxVerified = null; return false; });
}

export function renderInboxLocked(){
  var wrap = $id('wa-wrap');
  if(!wrap) return;
  wrap.innerHTML =
    '<div class="inbox-lock">'
    + '<div class="inbox-lock-ico">💬</div>'
    + '<h3>المحادثات متاحة للمتاجر اللي ربطت رقم واتساب خاص بيها</h3>'
    + '<p>عشان نستقبل رسايل عملائك ونعرضهالك هنا، لازم تربط رقم واتساب بيزنس بتاعك مع الـ Access Token. '
    + 'ولو شغّال على رقم سهل المشترك، الرسايل بتروح لخدمة عملاء متجرك مباشرةً زي ما هو مكتوب في رسالة التأكيد.</p>'
    + '<button class="sbtn" id="inbox-go-settings">اربط رقمك دلوقتي ←</button>'
    + '</div>';
  var b = $id('inbox-go-settings');
  if(b) b.addEventListener('click', function(){ showPage('settings'); });
}
