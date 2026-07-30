// حالة الاشتراك وبانر قرب الانتهاء

import { $id } from '../core/dom.js';

// SUBSCRIPTION LOCK
export function subscriptionLockState(t){
  if(!t) return 'active';
  if(t.plan === 'enterprise' && Number(t.monthly_price) === 0) return 'active';
  if(!t.plan_expires_at) return 'active';
  var exp = new Date(t.plan_expires_at).getTime();
  var now = Date.now();
  if(now <= exp) return 'active';
  var graceDays = (t.grace_period_days != null) ? t.grace_period_days : 3;
  var graceEnd = exp + graceDays*24*60*60*1000;
  if(now <= graceEnd) return 'grace';
  return 'expired';
}

export function maybeShowExpiryBanner(t, state){
  if(!t || !t.plan_expires_at) return;
  if(t.plan === 'enterprise' && Number(t.monthly_price) === 0) return;
  var exp = new Date(t.plan_expires_at).getTime();
  var days = Math.ceil((exp - Date.now())/(24*60*60*1000));
  var show=false, text='', bg='';
  if(state === 'grace'){
    show=true; bg='linear-gradient(90deg,#fef2f2,#fff)';
    text='⚠️ اشتراكك خلص ومتاح ليك فترة سماح قصيرة. جدّد دلوقتي قبل ما النظام يتقفل.';
  } else if(days >= 0 && days <= 7){
    show=true; bg='linear-gradient(90deg,#fff7ed,#fff)';
    text='⏰ اشتراكك هيخلص خلال '+days+' يوم. جدّد عشان متتقطعش الخدمة.';
  }
  if(!show) return;
  var ex=document.getElementById('expiry-banner'); if(ex)ex.remove();
  var wa='https://wa.me/201201399800?text='+encodeURIComponent('عايز أجدّد اشتراك سهل');
  var b=document.createElement('div');
  b.id='expiry-banner';
  b.style.cssText='background:'+bg+';border-bottom:1px solid rgba(0,0,0,.06);padding:10px 16px;display:flex;align-items:center;justify-content:center;gap:14px;font-size:.85rem;font-weight:700;color:#92400e;flex-wrap:wrap;';
  b.innerHTML=text+' <a href="'+wa+'" target="_blank" style="background:#1d6ef2;color:#fff;padding:6px 14px;border-radius:999px;text-decoration:none;font-weight:800;">جدّد الآن</a>';
  var appEl=$id('app');
  if(appEl) appEl.insertBefore(b, appEl.firstChild);
}
