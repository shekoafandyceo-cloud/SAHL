// checklist الإعداد الموجّه — بيحوّل المسجّل الجديد لتاجر نشط
//
// كارت فوق جدول الأوردرات بيعرض خطوات التجهيز وحالتها الحية، وكل خطوة
// ناقصة معاها زرار بيودّي على مكانها. بيختفي للأبد لما الخطوات تكمل
// (بيقفل نفسه) أو لما التاجر يخفيه بإيده.
//
// الحالة بتتحسب من الداتابيز مش من افتراضات: وجود أوردرات = الرابط
// متوصّل فعلاً، وجود منتجات = المخزون اشتغل، والمفاتيح من صف التاجر.
// أدمن بس، ومفيش كارت أثناء الجولة، وإعادة الحساب مخنوقة 30 ثانية.

import { currentTenantId } from '../auth/auth.js';
import { $id } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { isAdmin } from '../orders/guards.js';
import { tourActive } from '../tour/tour.js';

var lastComputed = 0;   // خنق الاستعلامات عند التنقل السريع بين التابات

function storageKey(){ return 'sahl_setup_done_' + (currentTenantId || ''); }

function isRetired(){
  try{ return localStorage.getItem(storageKey()) === '1'; }catch(e){ return false; }
}

function retire(){
  try{ localStorage.setItem(storageKey(), '1'); }catch(e){}
  var host = $id('setup-checklist');
  if(host){ host.innerHTML = ''; host.style.display = 'none'; }
}

export function setupDismiss(){ retire(); }

// force بتتخطى خنق الـ30 ثانية — للحظات اللي التاجر لسه مغيّر فيها
// حاجة بإيده (حفظ إعدادات مثلاً) ومستني يشوف العلامة بتتعلّم
export function refreshSetupChecklist(force){
  var host = $id('setup-checklist');
  if(!host) return;
  if(!sb || !currentTenantId || !isAdmin() || tourActive || isRetired()){
    host.innerHTML = ''; host.style.display = 'none'; return;
  }
  var now = Date.now();
  if(!force && now - lastComputed < 30000) return;   // الكارت المرسوم لسه ساخن
  lastComputed = now;

  Promise.all([
    sb.from('v_my_tenant').select('shipping_api_key,telegram_chat_id')
      .eq('id', currentTenantId).maybeSingle(),
    sb.from('orders').select('id', { count: 'exact', head: true })
      .eq('tenant_id', currentTenantId).limit(1),
    sb.from('stock_products').select('id', { count: 'exact', head: true })
      .eq('tenant_id', currentTenantId).limit(1)
  ]).then(function(res){
    // فشل أي استعلام = مانعرفش، مش "الخطوة ناقصة" — الكارت كان بيتهم
    // تاجر متجهز إن خطواته ناقصة لمجرد خطأ شبكة عابر
    if((res[0]&&res[0].error)||(res[1]&&res[1].error)||(res[2]&&res[2].error)){
      lastComputed = 0;   // خلّي المحاولة الجاية تعيد الحساب من غير خنق
      host.innerHTML = ''; host.style.display = 'none'; return;
    }
    var t = (res[0] && res[0].data) || {};
    var hasOrders = ((res[1] && res[1].count) || 0) > 0;
    var hasStock  = ((res[2] && res[2].count) || 0) > 0;

    var steps = [
      { done: true, label: 'حسابك اتعمل', hint: 'أهلاً بيك في سهل 👋' },
      { done: hasOrders, label: 'رابط استقبال الأوردرات', act: 'goto-settings',
        hint: hasOrders ? 'الأوردرات بتوصل ✓' : 'انسخه من الإعدادات وحطه في موقعك — الأوردرات هتيجي لوحدها' },
      { done: hasStock, label: 'سجّل منتجاتك', act: 'goto-stock',
        hint: hasStock ? 'المخزون شغّال ✓' : 'عشان المخزون يتخصم أوتوماتيك مع كل أوردر' },
      { done: !!(t.shipping_api_key && String(t.shipping_api_key).trim()), label: 'اربط بوسطة', act: 'goto-settings',
        hint: 'عشان البوالص تتطلع والتتبع يشتغل أوتوماتيك' },
      { done: !!(t.telegram_chat_id && String(t.telegram_chat_id).trim()), label: 'اربط بوت تلجرام', act: 'goto-settings',
        hint: 'تنبيهات لحظية بكل اللي بيحصل في متجرك' }
    ];
    var doneCount = steps.filter(function(s){ return s.done; }).length;

    if(doneCount === steps.length){ retire(); return; }   // كمّل — يقفل نفسه للأبد

    var rows = steps.map(function(s){
      return '<div class="suc-row' + (s.done ? ' done' : '') + '">'
        + '<span class="suc-check">' + (s.done ? '✅' : '⬜') + '</span>'
        + '<span class="suc-txt"><span class="suc-label">' + s.label + '</span>'
        + '<span class="suc-hint">' + s.hint + '</span></span>'
        + (!s.done && s.act
            ? '<button type="button" class="suc-go" data-act="' + s.act + '">يلا بينا ←</button>'
            : '')
        + '</div>';
    }).join('');

    host.innerHTML = '<div class="suc-card">'
      + '<div class="suc-head">'
      + '<div class="suc-title">🚀 جهّز متجرك <span class="suc-count">' + doneCount + '/' + steps.length + '</span></div>'
      + '<button type="button" class="suc-dismiss" data-act="setup-dismiss" title="إخفاء نهائياً">إخفاء ✕</button>'
      + '</div>'
      + '<div class="suc-bar"><span class="suc-fill" style="width:' + Math.round(doneCount / steps.length * 100) + '%"></span></div>'
      + rows + '</div>';
    host.style.display = '';
  }).catch(function(e){
    swallow('refreshSetupChecklist', e);
    host.innerHTML = ''; host.style.display = 'none';
  });
}
