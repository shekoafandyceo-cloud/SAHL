// المحفظة والباقات والشحن وقفل نفاد الرصيد

import { $id } from '../core/dom.js';
import { sb } from '../core/supabase.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { showPage } from '../main.js';
import { swallow } from '../core/log.js';
import { currentTenantId } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { doFilter, loadAll } from '../orders/orders.js';
import { ordersSetSelected } from '../orders/state.js';
import { inboxDepletionLock } from '../inbox/inbox.js';

export var walletStateCache = null; // {wallet_balance, overdraft_limit, available, orders_used_cycle, max_orders, orders_remaining, overage_debt, plan, plan_name, monthly_price, per_order_price, pricing_type, subscription_status, cycle_started_at, cycle_ends_at, is_lifetime, is_depleted}

// ---------- Load wallet state (يغذّي قفل النفاد) ----------
// جيل النداء + التقاط التاجر: الردود مالهاش ترتيب مضمون — رد قديم كان
// ممكن يكتب snapshot أقدم فوق الأحدث (يقفل بعد الشحن أو يفك قفل نافد)،
// ورد متأخر بعد force logout كان بيرجّع كاش تاجر قديم لجلسة اللي بعده
var walletGen = 0;
export function loadWalletState(cb){
  if(!sb || !currentTenantId){ if(cb) cb(null); return; }
  if(tourActive){ if(cb) cb(null); return; } // tour mode: don't hit DB
  var myGen = ++walletGen, forTenant = currentTenantId;
  sb.from('wallet_state').select('*').eq('tenant_id', forTenant).maybeSingle().then(function(r){
    if(myGen !== walletGen || forTenant !== currentTenantId){ if(cb) cb(null); return; }
    if(r.error){ console.warn('wallet_state load error', r.error.message); if(cb) cb(null); return; }
    var wasDepleted = !!(walletStateCache && walletStateCache.is_depleted);
    walletStateCache = r.data || null;
    var nowDepleted = !!(walletStateCache && walletStateCache.is_depleted);
    applyDepletionLock(!wasDepleted && nowDepleted);
    // القفل اترفع (شحن وصل): السيرفر بقى يرجّع البيانات تاني (RLS) —
    // نعيد تحميل الأوردرات فوراً بدل ما التاجر يفضل شايف صفحة مقفولة
    if(wasDepleted && !nowDepleted){ loadAll(); }
    if(cb) cb(walletStateCache);
  });
}

// ---------- Depletion lock: blur sensitive cells when wallet is empty ----------
// justLocked = النفاد لسه حاصل في اللحظة دي (انتقال active → depleted):
// وقتها بس بنقفل المعروض فعلاً (نافذة التفاصيل المفتوحة + الشات) — القفل
// كان بيمسك الجداول الجاية ويسيب اللي على الشاشة مكشوف
export function applyDepletionLock(justLocked){
  if(!walletStateCache) return;
  var locked = !!walletStateCache.is_depleted;
  document.body.classList.toggle('wallet-depleted', locked);
  // بانر على كل صفحة أرقامها من الأوردرات — الماليات والإحصائيات تحت
  // النفاد بيجيلهم صفر صفوف من الـRLS فكانوا بيعرضوا أصفار كأنها حقيقية
  [{id:'page-orders', sub:'بيانات الأوردرات مخفية لحد ما تشحن. اشحن دلوقتي عشان تكمّل شغلك بدون انقطاع.'},
   {id:'page-finance', sub:'الأرقام هنا هتبان أصفار لحد ما تشحن — بياناتك كلها محفوظة وهترجع فوراً بعد الشحن.'},
   {id:'page-analytics', sub:'الأرقام هنا هتبان أصفار لحد ما تشحن — بياناتك كلها محفوظة وهترجع فوراً بعد الشحن.'}
  ].forEach(function(pg){
    var host = $id(pg.id); if(!host) return;
    var bid = 'wallet-lock-banner-' + pg.id;
    var banner = document.getElementById(bid);
    if(locked && !banner){
      banner = document.createElement('div');
      banner.id = bid;
      banner.className = 'lock-banner';
      banner.innerHTML = '<div class="lbtxt">🔒 رصيد المحفظة انتهى<small>'+pg.sub+'</small></div><button type="button" class="lock-banner-btn">شحن المحفظة</button>';
      host.insertBefore(banner, host.firstChild);
      var btn = banner.querySelector('.lock-banner-btn');
      if(btn) btn.addEventListener('click', function(){ showPage('billing'); });
    } else if(!locked && banner){
      banner.remove();
    }
  });
  if(locked && justLocked){
    // نافذة التفاصيل المفتوحة والشات المفتوح — القفل بيلحقهم مش بس الجاي.
    // (على الانتقال بس: عشان refresh دوري للمحفظة أثناء النفاد مايقفلش
    // محرر منتج مفتوح من صفحة المخزون — المخزون مش جوه قفل الـRLS)
    var ovl = $id('ovl');
    if(ovl && ovl.classList.contains('open')){ ovl.classList.remove('open'); ordersSetSelected(null); }
    try{ inboxDepletionLock(); }catch(e){ swallow('applyDepletionLock/inboxDepletionLock', e); }
  }
  // Re-render table to apply locked cells if currently on orders page
  if(locked){ try{ doFilter(); }catch(e){ swallow('applyDepletionLock/doFilter', e); } }
}
