// سهل — لوحة تحكم التاجر
//
// الملف ده كان بلوك <script> inline جوه index.html. بقى ES module.
//
// ⚠️ بيعتمد على متغيّرين عامّين من الـCDN (supabase-js و chart.js) بيتحمّلوا
//    بـ<script src> كلاسيكية قبله في index.html. الكلاسيكية بتتنفّذ قبل أي
//    موديول، فـwindow.supabase و Chart متاحين وقت ما الموديول ده يشتغل.
//    متحطّش defer ولا type=module عليهم ومتنقلهمش تحت السطر ده.
//
// الموديول strict تلقائياً — "use strict" تحت زيادة مقصودة عشان الملف
// يفضل صالح لو اتحمّل كسكربت كلاسيك بالغلط.

"use strict";
// كل catch لازم يسيب أثر. الخروج الصامت هو اللي خبّى مشكلة 3.5 ساعة قبل كده
// (الدرس 5 و7 في CLAUDE.md). warn مش error عن قصد: كتير من دول فشلهم
// متوقّع (localStorage في التصفح الخاص، JSON.parse لرد مش JSON)، ولو صرّخنا
// في كلهم الضوضاء تخلّي الأثر بلا قيمة. المستوى بيتغيّر من هنا لوحده.
function swallow(where, err){
  try{ console.warn('[سهل] ' + where, err); }catch(_){}
}

// ── ملكية الحالة عبر المجالات ────────────────────────────────────────
// تحت ES modules الـbinding المستورد **للقراءة بس**: أي موديول يقدر يقرا
// `all` عادي، إنما `all = [...]` من موديول تاني بترمي TypeError وقت الربط،
// والخطأ ده بيقتل جراف الموديولات كله قبل ما ينفّذ سطر واحد.
// فكل حالة ليها مالك واحد بيصدّر setter، وأي كاتب من بره بينادي الـsetter.
// القراءة سايبة زي ما هي — الـlive bindings بتشتغل صح.
function ordersSetAll(v){ all = v || []; }
function ordersSetSelected(v){ sel = v; }
function ordersSetPageSize(v){ PS = v; }
function stockSetProducts(v){ stockProducts = v || []; }
function stockSetMovements(v){ stockMovements = v || []; }
function financeSetExpenses(v){ financeExpenses = v || []; }
function realtimeSetChannel(v){ realtimeChannel = v; }

// كل كائنات الفترة (ordersPeriod / analyticsPeriod / financePeriod) بتتعدّل
// بخصايصها مش بالاستبدال. الاستبدال كان في اتنين من التلاتة والتالت لأ، فأي
// helper مشترك كان هيشتغل مع واحد ويفشل بصمت مع التانيين. وتحت ES modules
// إسناد لـbinding مستورد بيرمي TypeError صريح.
function setPeriod(p, type, from, to){
  p.type = type;
  p.from = from || null;
  p.to   = to   || null;
  return p;
}

// ── توجيه الضغطات بالـdata-act ──────────────────────────────────────
// بديل onclick المضمّنة. سببين:
//  1. الـCSP محتاجة 'unsafe-inline' في script-src عشانها — وده بيفتح
//     الباب لأي سكربت محقون في الصفحة
//  2. تحت ES modules الدوال بتبقى في نطاق الموديول مش على window، فأي
//     onclick بيشاور على اسم عام بيموت **وقت الضغط** مش وقت التحميل:
//     مفيش خطأ في أي مكان لحد ما التاجر يدوس الزرار
// الموزّع واحد على document فبيشتغل مع الـmarkup الثابت والمتولّد سوا.
var CLICK_ACTIONS = {
  'reload':      function(){ location.reload(); },
  'tour-start':  function(){ tourStart(); },
  'tour-next':   function(){ tourNext(); },
  'tour-prev':   function(){ tourPrev(); },
  'tour-finish': function(){ tourFinish(); },
  'tour-reopen': function(){ tourReopenWelcome(); },
  'plan-select': function(el){ selectPlan(el.getAttribute('data-plan')); }
};
function initClickActions(){
  document.addEventListener('click', function(ev){
    var t = ev.target;
    if(!t || !t.closest) return;
    var el = t.closest('[data-act]');
    if(!el) return;
    var name = el.getAttribute('data-act');
    var fn = CLICK_ACTIONS[name];
    if(!fn){ swallow('clickActions', new Error('data-act مش معروف: ' + name)); return; }
    fn(el, ev);
  });
}
var sb=null, all=[], fil=[], cur=1, PS=50, sel=null, stm=null, intNotesTimer=null;
var allLoaded=false;           // هل تم تحميل كل الأوردرات للذاكرة؟ (يتحمّل lazily للماليات/الإحصائيات فقط)
var detailHistory=null;        // ملخّص طلبات العميل لشاشة التفاصيل (من كويري بالتليفون)
var currentRole = null; // 'admin' or 'employee'
var currentUser = null; // { email, name, role, tenant_id }
var currentTenantId = null; // comes from user_profiles.tenant_id after login
var currentTenant = null; // safe tenant info from public.tenants
var phoneCounts = {}; // map: phone => total order count for that customer

// ── حالة مشتركة عبر أكتر من قسم ──────────────────────────────────
// الخمسة دول كانوا متعرّفين على بعد آلاف السطور من أول موضع بيكتب فيهم
// (financeExpenses كانت الفجوة 3,600 سطر). شغّال دلوقتي بس لأن var
// بتتـhoist — وبيبقى TDZ ReferenceError فوراً لو اتحوّلوا لـlet/const،
// حتى من غير أي تقسيم. اتنقلوا لفوق عشان الكتابة تيجي بعد التعريف.
var realtimeChannel = null;  // قناة الريل-تايم — بتتصفّر في forceSuspendLogout
var pendingBostaByPhone = {};  // فهرس الدمج — loadMergeCandidates بتملاه
var stockProducts=[], stockMovements=[], currentStockTab='products';  // المخزون — الجولة بتبدّله بديمو
var waRenderedState=[], waUrlCache={};  // حالة رسم الإنبوكس
var financeExpenses = [];  // المصاريف — الجولة بتبدّلها بديمو

var SL={
  pending:'قيد الانتظار',
  confirmed:'مؤكدة',
  delivered:'تم التسليم',
  Delivered:'تم التسليم',
  cancelled:'ملغية',
  returned:'مرتجعة',
  bosta_assigned:'بوسطة',
  'BOSTA AUTO':'بوسطة اوتوماتيك',
  BOSTA2:'اوردر اتضرب',
  bosta_auto:'بوسطة اوتوماتيك',
  bosta2:'اوردر اتضرب',
  failed:'فشل',
  // Official Bosta API statuses — keep these exact strings in database
  'Exception':'استثناء',
  'Out for delivery':'في الطريق',
  'Received at warehouse':'استلام في المخزن',
  'Route Assigned':'تعيين المسار',
  'In transit between Hubs':'في النقل بين الفروع',
  'Picking up from consignee':'استلام من العميل',
  'Out for exchange':'خارج للاستبدال',
  'Returned to business':'مرتجع',
  'Returned to business2':'مرتجع مضروب',
  // Legacy aliases — for old rows only
  out_for_delivery:'في الطريق',
  received_at_warehouse:'استلام في المخزن',
  route_assigned:'تعيين المسار',
  in_transit:'في النقل',
  exception:'استثناء',
  picked_up:'تم الاستلام'
};
var STATUS_OPTIONS = ['pending','confirmed','delivered','cancelled','returned','bosta_assigned','BOSTA AUTO','BOSTA2','Delivered','Exception','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','Returned to business','Returned to business2','failed'];
var DELIVERED_STATUSES = ['delivered','Delivered'];
var CANCELLED_STATUSES = ['cancelled'];
var RETURNED_STATUSES = ['returned','Returned to business','Returned to business2'];
// Confirmation rate positive statuses:
// Any status that proves the order left Pending and entered confirmation/shipping journey.
// Exception / returned Bosta states are intentionally counted as positive for confirmation rate,
// because they are shipping/delivery outcomes, not confirmation-team failures.
var BOSTA_POSITIVE_STATUSES = [
  'confirmed',
  'bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2',
  'delivered','Delivered',
  'Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange',
  'Exception',
  'Returned to business','Returned to business2','returned',
  'out_for_delivery','received_at_warehouse','route_assigned','in_transit','picked_up','exception',
  'returned_to_business','returned_to_business2'
];
// Expected revenue = orders actually shipped or with Bosta (NOT just confirmed — those still may refuse on delivery)
var BOSTA_EXPECTED_STATUSES = ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','Exception','out_for_delivery','received_at_warehouse','route_assigned','picked_up','in_transit','exception'];
// Inventory card: count products only after the shipment is actually created/inside Bosta operation.
// Important: bosta_assigned and BOSTA AUTO are intentionally excluded.
var BOSTA_INVENTORY_STATUSES = ['BOSTA2','bosta2','Exception','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','out_for_delivery','received_at_warehouse','route_assigned','in_transit','exception','picked_up'];
// OPERATION filter = Bosta API statuses only, excluding Delivered and excluding internal Bosta statuses.
var BOSTA_OPERATION_STATUSES = ['Exception','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','out_for_delivery','received_at_warehouse','route_assigned','in_transit','exception','picked_up'];
function normStatus(s){return String(s||'').trim().toLowerCase();}
function statusIn(status, list){
  var st=normStatus(status);
  return (list||[]).some(function(x){return normStatus(x)===st;});
}
// Operation statuses set (for filter)
var CR={no_answer:'لم يرد',busy:'مشغول',refused:'رفض',confirmed:'أكد',callback:'يعاود الاتصال'};
var selectedIds = new Set();

function $id(id){return document.getElementById(id);}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmt(v){return v||'—';}
function short(s,n){s=s||'—';return s.length>n?s.slice(0,n)+'…':s;}
function num(n){return Number(n||0).toLocaleString('ar-EG');}
function fmtD(v){return v?new Date(v).toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit',year:'2-digit',timeZone:'Africa/Cairo'}):'—';}
function fmtDT(v){return v?new Date(v).toLocaleString('ar-EG',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';}
function statusClass(s){return String(s||'pending').toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'');}
function statusLabel(s){return SL[s]||SL[statusClass(s)]||s||'—';}
function pad2(n){return String(n).padStart(2,'0');}
function fmtStoredDateTime(raw){
  if(!raw)return '—';
  // Supabase stores timestamps in UTC (e.g. "2026-05-30T17:10:30+00").
  // We must convert to Cairo (UTC+2/+3) for display, otherwise everything
  // shows 3 hours earlier than reality. JS Date + toLocaleString with the
  // timeZone option handles this correctly, including DST transitions.
  var d=new Date(raw);
  if(isNaN(d.getTime())){
    // very rare fallback for malformed strings
    return String(raw);
  }
  return d.toLocaleString('ar-EG',{
    timeZone:'Africa/Cairo',
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit'
  });
}
function fmtDateOnly(raw){
  if(!raw)return '—';
  var s=String(raw).trim();
  // Date-only strings (YYYY-MM-DD, e.g. movement_date) have no timezone —
  // parse them as Cairo-local to avoid the "new Date('2026-05-30')" UTC midnight trap.
  var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m){
    var d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    return d.toLocaleDateString('ar-EG',{year:'numeric',month:'2-digit',day:'2-digit'});
  }
  return s;
}
function fmtMovementDate(v,createdAt){
  // In movements table we display created_at time; movement_date remains date-only for filtering/grouping.
  if(createdAt)return fmtStoredDateTime(createdAt);
  return fmtDateOnly(v);
}
function toast(msg,type){var t=$id('toast');t.textContent=msg;t.className='toast show '+(type||'ok');clearTimeout(t._t);t._t=setTimeout(function(){t.className='toast';},3000);}
function hasTenant(){return !!currentTenantId;}
function ensureTenant(){if(!hasTenant()){toast('حصلت مشكلة في الحساب. تواصل مع الدعم.','er');return false;}return true;}
function isAdmin(){return currentRole==='admin';}
function requireAdmin(){if(!isAdmin()){toast('الصلاحية دي للأدمن فقط','er');return false;}return true;}

function tenantDisplayName(){
  if(currentTenant && (currentTenant.store_name || currentTenant.slug)){
    return currentTenant.store_name || currentTenant.slug;
  }
  return 'سهل';
}

function applyTenantBranding(){
  var name = tenantDisplayName();
  if($id('brand-logo'))$id('brand-logo').textContent = name;
  if($id('login-logo'))$id('login-logo').textContent = '🔐 ' + name;
  if($id('setup-logo'))$id('setup-logo').textContent = '🗂 ' + name;
  document.title = name + ' — لوحة الطلبات';
}

function resetTenantBranding(){
  currentTenant = null;
  if($id('brand-logo'))$id('brand-logo').textContent = 'سهل';
  if($id('login-logo'))$id('login-logo').textContent = '🔐 سهل';
  if($id('setup-logo'))$id('setup-logo').textContent = '🗂 سهل';
  document.title = 'سهل — لوحة الطلبات';
}

// SUBSCRIPTION LOCK
function subscriptionLockState(t){
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
function showSubscriptionLock(t, reason){
  currentTenant = null;
  try{ sb.auth.signOut(); }catch(e){ swallow('showSubscriptionLock/sb.auth.signOut', e); }
  $id('login').style.display = 'none';
  $id('app').style.display = 'none';
  var existing = document.getElementById('sub-lock');
  if(existing) existing.remove();
  var store = (t && (t.store_name || t.slug)) || 'متجرك';
  var title, msg, icon;
  if(reason === 'suspended'){
    icon='⛔'; title='تم إيقاف الحساب';
    msg='تم إيقاف حساب <b>'+store+'</b> من قبل الإدارة. تواصل مع الدعم لإعادة التفعيل.';
  } else {
    icon='⏰'; title='انتهى اشتراكك';
    msg='اشتراك <b>'+store+'</b> خلص. جدّد دلوقتي عشان ترجع تستخدم النظام وكل بياناتك زي ما هي في أمان.';
  }
  var wa='https://wa.me/201201399800?text='+encodeURIComponent('عايز أجدّد اشتراك '+store+' في سهل');
  var d=document.createElement('div');
  d.id='sub-lock';
  d.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(ellipse 90% 60% at 50% 0%,#13284a,#0a1124);font-family:Cairo,sans-serif;';
  d.innerHTML=
    '<div style="max-width:460px;width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:28px;padding:40px 32px;text-align:center;box-shadow:0 40px 100px rgba(0,0,0,.4);">'
    +'<div style="font-size:64px;margin-bottom:18px;">'+icon+'</div>'
    +'<h1 style="color:#fff;font-size:1.7rem;font-weight:900;margin:0 0 14px;">'+title+'</h1>'
    +'<p style="color:#9fb3d1;font-size:1rem;line-height:1.7;font-weight:600;margin:0 0 28px;">'+msg+'</p>'
    +'<a href="'+wa+'" target="_blank" style="display:block;background:linear-gradient(135deg,#2dd4f0,#1d6ef2);color:#fff;font-weight:900;font-size:1.05rem;padding:16px;border-radius:16px;text-decoration:none;box-shadow:0 16px 40px rgba(29,110,242,.4);margin-bottom:12px;">💬 جدّد عن طريق واتساب</a>'
    +'<button data-act="reload" style="background:transparent;border:1px solid rgba(255,255,255,.2);color:#9fb3d1;font-weight:700;font-size:.9rem;padding:12px;border-radius:14px;cursor:pointer;width:100%;">🔄 جدّدت بالفعل؟ تحديث الصفحة</button>'
    +'<div style="margin-top:24px;color:#5b6b85;font-size:.8rem;">سيستم سهل · sahlgedan.com</div>'
    +'</div>';
  document.body.appendChild(d);
}
function maybeShowExpiryBanner(t, state){
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

function loadTenantAndEnter(){
  if(!ensureTenant())return;
  // v_my_tenant: الـ view بيفلتر بالتاجر جواه وبيحجب المفاتيح عن غير الأدمن.
  sb.from('v_my_tenant')
    .select('id,slug,store_name,shipping_provider,active,created_at,plan,plan_expires_at,subscription_status,grace_period_days,monthly_price')
    .eq('id', currentTenantId)
    .single()
    .then(function(r){
      if(r.error || !r.data){
        $id('login-err').textContent = 'حصلت مشكلة في تحميل بيانات الحساب. تواصل مع الدعم.';
        $id('login').style.display = 'flex';
        $id('app').style.display = 'none';
        currentTenant = null;
        return;
      }
      if(r.data.active === false){
        showSubscriptionLock(r.data, 'suspended');
        return;
      }
      var lockState = subscriptionLockState(r.data);
      if(lockState === 'expired'){
        showSubscriptionLock(r.data, 'expired');
        return;
      }
      currentTenant = r.data;
      applyTenantBranding();
      $id('login').style.display = 'none';
      $id('app').style.cssText = 'display:flex;flex-direction:column;min-height:100vh;';
      maybeShowExpiryBanner(r.data, lockState);
      loadAll();
      loadWalletState();  // load for everyone (admin + employee) — needed for depletion lock
    });
}

// Build a value with a copy button — used for copyable fields (name, phones, address)
function copyable(val,label){
  if(!val||val==='—')return '<span class="dval ar">—</span>';
  var safe=esc(val);
  var raw=String(val).replace(/"/g,'&quot;');
  var copyIco='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  return '<span class="dval-wrap"><span class="dval ar" style="white-space:normal;max-width:300px">'+safe+'</span>'
    +'<button class="copy-btn" data-copy="'+raw+'" data-label="'+esc(label||'')+'" title="نسخ">'+copyIco+'</button></span>';
}

function attachCopyHandlers(){
  document.querySelectorAll('.copy-btn[data-copy]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var val=btn.getAttribute('data-copy');
      var label=btn.getAttribute('data-label')||'النص';
      var ok=function(){
        btn.classList.add('done');
        toast('تم نسخ '+label+' ✓','ok');
        setTimeout(function(){btn.classList.remove('done');},1500);
      };
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(val).then(ok,function(){fallbackCopy(val,ok);});
      }else{fallbackCopy(val,ok);}
    });
  });
}

function fallbackCopy(text,onDone){
  var ta=document.createElement('textarea');
  ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');onDone&&onDone();}catch(e){toast('فشل النسخ','er');}
  document.body.removeChild(ta);
}

// نسخ نص جاهز للحافظة (مع fallback) — يستخدمه زرار نسخ المنتجات
function copyTextToClipboard(txt,label){
  if(!txt){toast('لا يوجد شيء للنسخ','er');return;}
  var done=function(){toast('تم نسخ '+(label||'النص')+' ✓','ok');};
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done,function(){fallbackCopy(txt,done);});
  }else{fallbackCopy(txt,done);}
}

// حقل قابل للتعديل في نافذة التفاصيل (موبايل/عنوان): نسخ + زرار تعديل
function fieldEditable(val,label,field){
  return '<span class="fld-wrap" data-field="'+field+'">'
    + copyable(val,label)
    + '<button class="fld-edit-btn" data-field="'+field+'" title="تعديل '+esc(label||'')+'">✏️</button>'
    + '</span>';
}

// تحديث قيمة حقل عبر sel + الذاكرة (all + fil) بعد الحفظ
function patchOrderField(id,patch){
  var k;
  if(sel && sel.id===id){ for(k in patch){ sel[k]=patch[k]; } }
  if(all){ for(var i=0;i<all.length;i++){ if(all[i].id===id){ for(k in patch){ all[i][k]=patch[k]; } break; } } }
  if(fil){ for(var j=0;j<fil.length;j++){ if(fil[j].id===id){ for(k in patch){ fil[j][k]=patch[k]; } break; } } }
}

// ربط أزرار تعديل الموبايل/العنوان داخل نافذة التفاصيل
function attachFieldEditors(){
  if(!$id('dcnt'))return;
  $id('dcnt').querySelectorAll('.fld-edit-btn').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      if(!sel)return;
      var field=btn.getAttribute('data-field');
      var wrap=btn.parentNode;
      var cur=(sel[field]==null?'':String(sel[field]));
      wrap.innerHTML='<input type="text" class="fld-edit-input" value="'+cur.replace(/"/g,'&quot;')+'">'
        +'<button class="fld-edit-save">حفظ</button>'
        +'<button class="fld-edit-cancel">إلغاء</button>'
        +'<span class="fld-edit-status"></span>';
      var input=wrap.querySelector('.fld-edit-input');
      input.focus(); try{input.setSelectionRange(input.value.length,input.value.length);}catch(e2){ swallow('attachFieldEditors/input.setSelectionRange', e2); }
      wrap.querySelector('.fld-edit-cancel').addEventListener('click',function(){ renderDetail(); });
      function save(){
        var val=input.value.trim();
        if(field==='phone' && val){
          var digits=toLatinDigits(val).replace(/[\s-]/g,'');
          if(!/^[0-9+]{6,}$/.test(digits)){ toast('رقم موبايل غير صالح','er'); return; }
          val=digits;
        }
        if(!sb||!currentTenantId){ toast('غير متصل بالسيرفر','er'); return; }
        var stt=wrap.querySelector('.fld-edit-status'); if(stt)stt.textContent='جاري الحفظ...';
        var upd={}; upd[field]=val||null;
        sb.from('orders').update(upd).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
          if(r.error){ if(stt)stt.textContent=''; toast('خطأ في الحفظ: '+r.error.message,'er'); return; }
          patchOrderField(sel.id,upd);
          toast('تم تعديل '+(field==='phone'?'الموبايل':(field==='address'?'العنوان':'البيانات'))+' ✓','ok');
          try{renderTable();}catch(e3){ swallow('save/renderTable', e3); }
          renderDetail();
        });
      }
      wrap.querySelector('.fld-edit-save').addEventListener('click',save);
      input.addEventListener('keydown',function(ev){
        if(ev.key==='Enter'){ ev.preventDefault(); save(); }
        else if(ev.key==='Escape'){ renderDetail(); }
      });
    });
  });
}

// Phone normalization: removes leading 0, spaces — returns 10-digit number for WhatsApp (prefixed with 20)
function normalizePhone(p){
  if(!p)return '';
  var s=toLatinDigits(p).replace(/\D/g,'').replace(/^20/,'').replace(/^0+/,'');
  return s;
}

// First word of customer name (used in WhatsApp message)
function firstName(n){
  if(!n)return '';
  return String(n).trim().split(/\s+/)[0];
}

// ── SUPABASE CONFIG (hardcoded — anon key is safe to expose, RLS + Auth protect data) ──
var SUPABASE_URL = 'https://gdphjfhelxaofugyiknb.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkcGhqZmhlbHhhb2Z1Z3lpa25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjk2MjQsImV4cCI6MjA5Mzc0NTYyNH0.RoMFhaj7zvIxKdds6mgQPv1lmT_rijNKc1lu--0sLQY';

function initApp(){
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storage:window.localStorage, storageKey:'sb-auth'}
  });
  var savedPs=localStorage.getItem('sb_ps');
  if(savedPs){var _ps=parseInt(savedPs); if([25,50,100,200].indexOf(_ps)<0)_ps=50; ordersSetPageSize(_ps); var el=$id('psize'); if(el)el.value=String(_ps);}
  // Check if user already has a valid session
  sb.auth.getSession().then(function(res){
    if(res.data && res.data.session){
      fetchProfileAndEnter(res.data.session.user);
    } else {
      $id('login').style.display = 'flex';
    }
  });
}

function fetchProfileAndEnter(authUser){
  // Look up user_profiles by auth user id to get role + tenant_id.
  // In SaaS mode, tenant_id MUST come from the profile, never from hardcoded frontend code.
  sb.from('user_profiles').select('*').eq('id', authUser.id).maybeSingle().then(function(r){
    if(r.error){
      $id('login-err').textContent = 'حصلت مشكلة في الدخول. تواصل مع الدعم.';
      $id('login').style.display = 'flex';
      sb.auth.signOut();
      return;
    }
    if(!r.data){
      // No profile yet — could be a freshly-verified signup user.
      // Try to auto-bootstrap their tenant from auth metadata.
      bootstrapTenantIfNeeded(authUser, function(err){
        if(err){
          console.error('Tenant bootstrap failed:', err);
          if(err.message === 'no_pending_signup'){
            $id('login-err').textContent = 'حصلت مشكلة. حاول تخرج وتدخل تاني، ولو المشكلة استمرت تواصل مع الدعم.';
          } else {
            $id('login-err').textContent = 'حصلت مشكلة في إنشاء المتجر: ' + (err.message || 'حاول مرة تانية');
          }
          $id('login').style.display = 'flex';
          sb.auth.signOut();
          return;
        }
        // Tenant created — retry fetching profile (should now exist)
        fetchProfileAndEnter(authUser);
      });
      return;
    }
    var profile = r.data;
    if(!profile.active){
      $id('login-err').textContent = 'الحساب موقوف حاليًا. تواصل مع الدعم.';
      $id('login').style.display = 'flex';
      sb.auth.signOut();
      return;
    }
    if(!profile.tenant_id){
      $id('login-err').textContent = 'حصلت مشكلة في الدخول. تواصل مع الدعم.';
      $id('login').style.display = 'flex';
      currentTenantId = null;
      currentTenant = null;
      resetTenantBranding();
      sb.auth.signOut();
      return;
    }
    currentTenantId = profile.tenant_id;
    currentUser = {
      email: authUser.email,
      name: profile.full_name || authUser.email,
      role: profile.role,
      tenant_id: profile.tenant_id,
      id: authUser.id
    };
    currentRole = profile.role;
    // Apply role class
    document.body.classList.remove('role-admin', 'role-employee');
    document.body.classList.add('role-' + profile.role);
    // Update user badge
    var badge = $id('user-badge');
    badge.className = 'user-badge ' + profile.role;
    badge.textContent = (profile.role === 'admin' ? '👑 ' : '👤 ') + currentUser.name;
    // Load safe tenant info and enter the dashboard.
    loadTenantAndEnter();
  });
}

function loginErrorMessage(error){
  var raw = (error && error.message) ? String(error.message) : '';
  var msg = raw.toLowerCase();
  console.error('LOGIN ERROR:', error);

  if(msg.indexOf('email not confirmed') >= 0 || msg.indexOf('not confirmed') >= 0){
    return 'الحساب لسه مش مفعّل. تواصل مع الدعم لتفعيله.';
  }
  if(msg.indexOf('invalid login credentials') >= 0 || msg.indexOf('invalid credentials') >= 0){
    return 'الإيميل أو كلمة المرور غير صحيحة.';
  }
  if(msg.indexOf('too many requests') >= 0 || msg.indexOf('rate limit') >= 0){
    return 'محاولات تسجيل دخول كتير. استنى شوية وجرّب تاني.';
  }
  if(msg.indexOf('user not found') >= 0){
    return 'الإيميل أو كلمة المرور غير صحيحة.';
  }
  return 'تعذّر تسجيل الدخول. حاول تاني أو تواصل مع الدعم.';
}

function doLogin(){
  var email = $id('login-user').value.trim();
  var pass = $id('login-pass').value;
  $id('login-err').textContent = '';
  if(!email || !pass){
    $id('login-err').textContent = 'يرجى إدخال البريد وكلمة المرور';
    return;
  }
  $id('login-err').textContent = 'جاري التحقق...';
  sb.auth.signInWithPassword({ email: email, password: pass }).then(function(r){
    if(r.error){
      $id('login-err').textContent = loginErrorMessage(r.error);
      return;
    }
    $id('login-err').textContent = '';
    fetchProfileAndEnter(r.data.user);
  }).catch(function(e){
    $id('login-err').textContent = loginErrorMessage(e);
  });
}

// Instant force-logout when the tenant is suspended by the super admin.
// No confirmation — kicks the user out immediately.
var _suspending = false;
function forceSuspendLogout(){
  if(_suspending) return;
  _suspending = true;
  try{ if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeSetChannel(null); } }catch(e){ swallow('forceSuspendLogout/sb.removeChannel', e); }
  sb.auth.signOut().then(function(){
    currentUser = null;
    currentRole = null;
    currentTenantId = null;
    currentTenant = null;
    try{ resetTenantBranding(); }catch(e){ swallow('forceSuspendLogout/resetTenantBranding', e); }
    document.body.classList.remove('role-admin', 'role-employee');
    $id('app').style.display = 'none';
    $id('login-user').value = '';
    $id('login-pass').value = '';
    $id('login-err').textContent = '⚠️ تم إيقاف الاشتراك. تواصل مع الدعم لإعادة التفعيل.';
    $id('login').style.display = 'flex';
    _suspending = false;
  });
}

function doLogout(){
  showModal({
    icon:'🚪',
    title:'تسجيل الخروج',
    sub:'هتخرج من الحساب دلوقتي.\nمتأكد؟',
    okLabel:'خروج',
    okColor:'linear-gradient(135deg,#ef4444,#dc2626)',
    onOk:function(){
      sb.auth.signOut().then(function(){
        currentUser = null;
        currentRole = null;
        currentTenantId = null;
        currentTenant = null;
        resetTenantBranding();
        document.body.classList.remove('role-admin', 'role-employee');
        $id('app').style.display = 'none';
        $id('login-user').value = '';
        $id('login-pass').value = '';
        $id('login-err').textContent = '';
        $id('login').style.display = 'flex';
      });
    }
  });
}


// ===== orders-page period scope (controls BOTH the table and the top stat cards) =====
var ordersPeriod = { type:'all', from:null, to:null };
// Bucket orders by their Cairo calendar day (YYYY-MM-DD) — SAME timezone the table shows (fmtD),
// so the period filter matches the visible dates exactly (no off-by-a-day from UTC parsing).
function cairoYMD(v){
  try{ return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)); }
  catch(e){ var d=new Date(v); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
}
function ymdAddDays(ymd, delta){
  var p=String(ymd).split('-'), dt=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));
  dt.setUTCDate(dt.getUTCDate()+delta);
  return dt.getUTCFullYear()+'-'+('0'+(dt.getUTCMonth()+1)).slice(-2)+'-'+('0'+dt.getUTCDate()).slice(-2);
}
function ordersInPeriod(){
  var p=ordersPeriod;
  if(p.type==='all') return all.slice();
  var today=cairoYMD(new Date()), fromY, toY;   // inclusive YYYY-MM-DD bounds
  if(p.type==='last3'){ fromY=ymdAddDays(today,-2); toY=today; }            // أخر 3 أيام (شامل النهاردة)
  else if(p.type==='month'){ fromY=today.slice(0,7)+'-01'; toY=today.slice(0,7)+'-31'; } // الشهر الحالي
  else if(p.type==='last30'){ fromY=ymdAddDays(today,-29); toY=today; }      // أخر 30 يوم
  else if(p.type==='custom'){ fromY=p.from||'2000-01-01'; toY=p.to||'2999-12-31'; if(fromY>toY){ var t=fromY; fromY=toY; toY=t; } }
  else return all.slice();   // 'all'
  return all.filter(function(o){ if(!o.created_at)return false; var y=cairoYMD(o.created_at); return y>=fromY && y<=toY; });
}
function setOrdersPeriod(type){
  ordersPeriod.type=type;
  var bar=$id('orders-period-bar');
  if(bar) bar.querySelectorAll('.pseg-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-period')===type); });
  var cust=$id('orders-period-custom'); if(cust) cust.classList.toggle('show', type==='custom');
  positionPeriodInd();
  if(type!=='custom') refreshOrdersScope();   // custom waits for the "تطبيق" button
}
function positionPeriodInd(){
  var bar=$id('orders-period-bar'); if(!bar) return;
  var seg=bar.querySelector('.pseg'); if(!seg) return;
  var ind=seg.querySelector('.pseg-ind'), act=seg.querySelector('.pseg-btn.active');
  if(!ind||!act) return;
  if(act.offsetWidth===0){ seg.classList.remove('has-ind'); return; }  // bar hidden → keep CSS fallback
  ind.style.transform='translate('+act.offsetLeft+'px,'+act.offsetTop+'px)';
  ind.style.width=act.offsetWidth+'px';
  ind.style.height=act.offsetHeight+'px';
  seg.classList.add('has-ind');
}
function refreshOrdersScope(){
  try{ loadOrdersCards(); }catch(e){ swallow('refreshOrdersScope/loadOrdersCards', e); }
  try{ doFilter(); }catch(e){ swallow('refreshOrdersScope/doFilter', e); }
}

// كرت "جاهز للخروج" — اضغط يروح لفلتر بوسطة + scroll للجدول
// كارت الجاهزية فوق جدول الأوردرات
function initReadyCard(){
(function(){
  var c = document.getElementById('card-ready');
  if(!c) return;
  c.addEventListener('click', function(){
    var fst = $id('fst');
    if(fst){ fst.value = 'bosta_assigned'; }
    if(window.__syncFilterUI) window.__syncFilterUI();
    try{ doFilter(); }catch(e){ swallow('refreshOrdersScope/doFilter', e); }
    window.scrollTo({ top: $id('fbar') ? $id('fbar').offsetTop - 80 : 200, behavior:'smooth' });
  });
})();

// زرار "حدد غير المطبوع" — يحدّد كل الأوردرات اللي لسه ماتطبعش في القايمة الحالية
(function(){
  var btn = document.getElementById('bb-sel-unprinted');
  if(!btn) return;
  btn.addEventListener('click', function(){
    var added = 0;
    (fil||[]).forEach(function(o){
      if(o.tracking_no && String(o.tracking_no).trim() && !(o.awb_print_count > 0)){
        selectedIds.add(o.id);
        added++;
      }
    });
    // علّم الـ checkboxes الظاهرة في الجدول
    $id('tbody').querySelectorAll('.cb-row').forEach(function(cb){
      var id = cb.getAttribute('data-id');
      if(selectedIds.has(id)){
        cb.checked = true;
        var tr = cb.closest('tr'); if(tr) tr.classList.add('sel');
      }
    });
    updateBulkBar(); updateMasterCb();
    if(added > 0){ toast('تم تحديد '+num(added)+' أوردر غير مطبوع — دوس "🖨️ طبع البوالص"','ok'); }
    else { toast('كل الأوردرات في القايمة دي اتطبعت بالفعل','er'); }
  });
})();
}



function updateStats(){
  var monthOrders=ordersInPeriod();

  $id('s0').textContent=num(monthOrders.length);
  $id('s1').textContent=num(monthOrders.filter(function(o){return statusIn(o.status,['pending']);}).length);

  var confirmed=monthOrders.filter(function(o){return statusIn(o.status,['confirmed']);}).length;
  var delivered=monthOrders.filter(function(o){return statusIn(o.status,DELIVERED_STATUSES);}).length;
  var cancelled=monthOrders.filter(function(o){return statusIn(o.status,CANCELLED_STATUSES);}).length;
  var returned=monthOrders.filter(function(o){return statusIn(o.status,RETURNED_STATUSES);}).length;

  $id('s2').textContent=num(confirmed);
  $id('s3').textContent=num(delivered);
  $id('s4').textContent=num(cancelled);
  $id('s5').textContent=num(returned);
  
  // كرت "جاهز للخروج" (حساب من الـ cache كـ fallback؛ المصدر الأساسي هو applyOrdersStats من السيرفر)
  var bostaReadyN = monthOrders.filter(function(o){return statusIn(o.status, ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2']);}).length;
  var sRdyEl = $id('s-ready'); if(sRdyEl) sRdyEl.textContent = num(bostaReadyN);

  // نسبة التأكيد = كل الأوردرات التي اتأكدت أو دخلت رحلة بوسطة ÷ كل الأوردرات التي خرجت من Pending.
  // حالات الشحن اللاحقة مثل Delivered / Exception / Returned to business لا تنزل النسبة.
  var processed=monthOrders.filter(function(o){
    return !statusIn(o.status,['pending']);
  }).length;

  var positive=monthOrders.filter(function(o){
    return statusIn(o.status,BOSTA_POSITIVE_STATUSES);
  }).length;

  $id('s6').textContent=processed>0?((positive/processed)*100).toFixed(1)+'%':'—';

  // نسبة التسليم = الطلبات المُسلّمة ÷ الطلبات التي أنهت رحلة الشحن (تسليم + مرتجع).
  // تقيس نجاح التوصيل من الأوردرات التي اتشحنت فعلاً، وليس من إجمالي الأوردرات.
  var deliveryDecided = delivered + returned;
  $id('s7').textContent = deliveryDecided > 0 ? ((delivered/deliveryDecided)*100).toFixed(1)+'%' : '—';
}

function money(v){return num(Math.round(Number(v||0)))+' ج';}
function val(o){return Number(o.total_cost||o.total||o.amount||0)||0;}
function updateRevenueStats(){
  var monthOrders=ordersInPeriod();
  var total=monthOrders.reduce(function(s,o){return s+val(o);},0);
  var collected=monthOrders.filter(function(o){return statusIn(o.status,DELIVERED_STATUSES);}).reduce(function(s,o){return s+val(o);},0);
  var expected=monthOrders.filter(function(o){return statusIn(o.status,BOSTA_EXPECTED_STATUSES);}).reduce(function(s,o){return s+val(o);},0);
  var lost=monthOrders.filter(function(o){return statusIn(o.status,CANCELLED_STATUSES) || statusIn(o.status,RETURNED_STATUSES) || o.status==='failed';}).reduce(function(s,o){return s+val(o);},0);
  var paymob=monthOrders.filter(function(o){return o.payment_stage==='paymob';}).reduce(function(s,o){return s+val(o);},0);
  $id('rv-total').textContent=money(total);
  $id('rv-collected').textContent=money(collected);
  $id('rv-expected').textContent=money(expected);
  $id('rv-lost').textContent=money(lost);
  $id('rv-aov').textContent=monthOrders.length?money(total/monthOrders.length):'—';
  $id('rv-paymob').textContent=money(paymob);
}

function orderCostSnapshotValue(o){
  // Supports multiple possible column names so n8n/Supabase can evolve without breaking the dashboard.
  var candidates = [
    o.inventory_cost_snapshot,
    o.inventory_value_snapshot,
    o.inventory_value_at_bosta,
    o.product_cost_snapshot,
    o.products_cost_snapshot,
    o.manufacturer_cost_snapshot
  ];
  for(var i=0;i<candidates.length;i++){
    var n=Number(candidates[i]||0);
    if(n>0)return n;
  }
  return 0;
}

function hasCostSnapshot(o){
  return orderCostSnapshotValue(o)>0;
}

function orderLiveInventoryCost(o){
  var items=parseProductItems(o.product_name||'');
  return items.reduce(function(sum,it){
    return sum + (productCostByName(it.name) * (it.qty||1));
  },0);
}

function orderInventoryCost(o){
  // Prefer locked snapshot if workflow stored it at shipping time.
  // Fallback to live stock_products.wholesale_price × qty for backward compatibility.
  var snap=orderCostSnapshotValue(o);
  if(snap>0)return snap;
  return orderLiveInventoryCost(o);
}

function orderInventoryCostSource(o){
  return hasCostSnapshot(o) ? 'Snapshot محفوظ وقت الشحن' : 'Live من أسعار المخزون الحالية';
}


function loadStockProductsForCosts(done){
  if(!isAdmin()){done&&done();return;}
  // Skip the load only if stockProducts is BOTH non-empty AND has wholesale_price
  // populated. Some code paths (order-detail modal) load a narrower projection
  // without wholesale_price — that would make every COGS lookup return 0.
  var hasFullData = stockProducts && stockProducts.length &&
                    stockProducts.some(function(p){ return p.hasOwnProperty('wholesale_price'); });
  if(hasFullData){done&&done();return;}
  sb.from('v_stock_products')
    .select('id,name,current_qty,wholesale_price,unit_price,active')
    .eq('tenant_id',currentTenantId)
    .eq('active',true)
    .then(function(r){
      if(!r.error && r.data)stockSetProducts(r.data);
      done&&done();
    });
}

// ===== PRODUCT TOUR (interactive walkthrough with demo data) =====
var TOUR_KEY='sahl_tour_done_';
var tourActive=false, tourStep=0, tourSavedHTML=null;

function tourDone(){ try{return localStorage.getItem(TOUR_KEY+currentTenantId)==='1';}catch(e){return false;} }
function markTourDone(){ try{localStorage.setItem(TOUR_KEY+currentTenantId,'1');}catch(e){ swallow('markTourDone/localStorage.setItem', e); } }

// ---- demo orders shown only during the tour ----
function tourDemoOrders(){
  var now=Date.now();
  function iso(mins){ return new Date(now - mins*60000).toISOString(); }
  function thisMonth(daysAgo){
    var d=new Date();
    d.setDate(Math.max(1, d.getDate()-daysAgo));
    return d.toISOString();
  }
  return [
    { id:'demo-1042', order_uid:'DEMO-1042', customer_name:'محمد عبد الرحمن', phone:'01012345678', city:'القاهرة',
      address:'٢٧ شارع التحرير، الدقي، الجيزة', product_name:'تيربو بريمو ٥ دور', total_cost:1290,
      status:'pending', platform:'fb', payment_stage:'cod', tracking_no:'', created_at:thisMonth(0),
      call_attempts:[{iso:iso(40),result:'no_answer',by:'سارة'}],
      status_log:[{to:'pending',at:iso(120),by:'النظام'}] },
    { id:'demo-1041', order_uid:'DEMO-1041', customer_name:'إسراء طارق', phone:'01122223333', city:'الإسكندرية',
      address:'١٢ شارع فؤاد، محطة الرمل', product_name:'مطبقية ريكي ٢ دور', total_cost:980,
      status:'confirmed', platform:'ig', payment_stage:'cod', tracking_no:'', created_at:thisMonth(1),
      call_attempts:[{iso:iso(200),result:'confirmed',by:'سارة'}],
      status_log:[{to:'pending',at:iso(300),by:'النظام'},{to:'confirmed',at:iso(200),by:'سارة'}] },
    { id:'demo-1040', order_uid:'DEMO-1040', customer_name:'كريم فؤاد', phone:'01298765432', city:'المنصورة',
      address:'برج النيل، شارع الجمهورية', product_name:'استاند أمريكانا', total_cost:1150,
      status:'Out for delivery', platform:'fb', payment_stage:'cod', tracking_no:'BOS-77310', created_at:thisMonth(2),
      status_log:[{to:'pending',at:iso(900),by:'النظام'},{to:'confirmed',at:iso(800),by:'سارة'},{to:'OUT',at:iso(120),by:'أحمد (سكانر)'}] },
    { id:'demo-1039', order_uid:'DEMO-1039', customer_name:'نورهان سامح', phone:'01033334444', city:'طنطا',
      address:'شارع البحر، أمام المستشفى', product_name:'ترابيزة IKEA', total_cost:1420,
      status:'Delivered', platform:'tiktok', payment_stage:'cod', tracking_no:'BOS-77280', created_at:thisMonth(3),
      status_log:[{to:'pending',at:iso(2000),by:'النظام'},{to:'confirmed',at:iso(1900),by:'سارة'},{to:'OUT',at:iso(1500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(800),by:'بوسطة'}] },
    { id:'demo-1038', order_uid:'DEMO-1038', customer_name:'يوسف الديب', phone:'01555556666', city:'القاهرة',
      address:'مدينة نصر، الحي السابع', product_name:'ترولي خشب ايكيا', total_cost:870,
      status:'cancelled', platform:'fb', payment_stage:'cod', tracking_no:'', created_at:thisMonth(4),
      cancel_reason:'العميل غيّر رأيه',
      call_attempts:[{iso:iso(600),result:'refused',by:'سارة'}],
      status_log:[{to:'pending',at:iso(900),by:'النظام'},{to:'cancelled',at:iso(600),by:'سارة — السبب: العميل غيّر رأيه'}] },
    { id:'demo-1037', order_uid:'DEMO-1037', customer_name:'مريم حسن', phone:'01066667777', city:'الفيوم',
      address:'شارع الحرية، وسط البلد', product_name:'تيربو بريمو ٥ دور', total_cost:1290,
      status:'Returned to business', platform:'ig', payment_stage:'cod', tracking_no:'BOS-77199', created_at:thisMonth(6),
      status_log:[{to:'pending',at:iso(3000),by:'النظام'},{to:'confirmed',at:iso(2900),by:'سارة'},{to:'OUT',at:iso(2500),by:'أحمد (سكانر)'},{to:'Returned to business',at:iso(1200),by:'بوسطة'}] },
    { id:'demo-1036', order_uid:'DEMO-1036', customer_name:'أحمد صبري', phone:'01077778888', city:'القاهرة',
      address:'العباسية، شارع الأمير', product_name:'مطبقية ريكي ٢ دور', total_cost:980,
      status:'Delivered', platform:'fb', payment_stage:'cod', tracking_no:'BOS-77150', created_at:thisMonth(6),
      status_log:[{to:'pending',at:iso(4000),by:'النظام'},{to:'confirmed',at:iso(3900),by:'سارة'},{to:'OUT',at:iso(3500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(2800),by:'بوسطة'}] },
    { id:'demo-1035', order_uid:'DEMO-1035', customer_name:'فاطمة علي', phone:'01099990000', city:'الجيزة',
      address:'الهرم، شارع الملك فيصل', product_name:'استاند أمريكانا', total_cost:1150,
      status:'Delivered', platform:'ig', payment_stage:'cod', tracking_no:'BOS-77080', created_at:thisMonth(7),
      status_log:[{to:'pending',at:iso(5000),by:'النظام'},{to:'confirmed',at:iso(4900),by:'سارة'},{to:'OUT',at:iso(4500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(3800),by:'بوسطة'}] },
    { id:'demo-1034', order_uid:'DEMO-1034', customer_name:'عمر خالد', phone:'01511112222', city:'الإسكندرية',
      address:'سيدي جابر، شارع أبو قير', product_name:'ترابيزة IKEA', total_cost:1420,
      status:'Delivered', platform:'tiktok', payment_stage:'cod', tracking_no:'BOS-77010', created_at:thisMonth(8),
      status_log:[{to:'pending',at:iso(6000),by:'النظام'},{to:'confirmed',at:iso(5900),by:'سارة'},{to:'OUT',at:iso(5500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(4800),by:'بوسطة'}] }
  ];
}
function tourDemoExpenses(){
  // date each expense on the SAME day as a delivered order (3,7,8 days ago) so the
  // daily profit chart never dips below zero during the tour — delivered revenue
  // on that day always covers the expense.
  function onDay(daysAgo){
    var d=new Date();
    d.setDate(Math.max(1, d.getDate()-daysAgo));
    return d.toISOString().slice(0,10);
  }
  return [
    {id:'de1', category:'إعلانات فيسبوك', amount:400, expense_date:onDay(8), note:'حملة إعلانية'},
    {id:'de2', category:'إعلانات فيسبوك', amount:400, expense_date:onDay(7), note:'حملة إعلانية'},
    {id:'de3', category:'إعلانات فيسبوك', amount:400, expense_date:onDay(3), note:'حملة إعلانية'},
    {id:'de4', category:'مرتبات', amount:300, expense_date:onDay(6), note:'عمولة تأكيد'},
    {id:'de5', category:'تغليف', amount:100, expense_date:onDay(8), note:'كراتين وشريط'}
  ];
}

function tourDemoStock(){
  return [
    {id:'ds1', name:'تيربو بريمو ٥ دور', current_qty:14, wholesale_price:520, unit_price:1290, active:true},
    {id:'ds2', name:'مطبقية ريكي ٢ دور', current_qty:9, wholesale_price:430, unit_price:980, active:true},
    {id:'ds3', name:'استاند أمريكانا', current_qty:6, wholesale_price:510, unit_price:1150, active:true},
    {id:'ds4', name:'ترابيزة IKEA', current_qty:4, wholesale_price:640, unit_price:1420, active:true},
    {id:'ds5', name:'ترولي خشب ايكيا', current_qty:0, wholesale_price:360, unit_price:870, active:true}
  ];
}
function tourDemoMovements(){
  var now=Date.now();
  function iso(mins){ return new Date(now - mins*60000).toISOString(); }
  function dOnly(mins){ return new Date(now - mins*60000).toISOString().slice(0,10); }
  return [
    {id:'dm1', product_id:'ds4', product_name:'ترابيزة IKEA', movement_type:'out', qty_in:0, qty_out:1, created_at:iso(1500), movement_date:dOnly(1500), tracking_no:'BOS-77280', notes:'خروج مع بوسطة — DEMO-1039'},
    {id:'dm2', product_id:'ds3', product_name:'استاند أمريكانا', movement_type:'out', qty_in:0, qty_out:1, created_at:iso(120), movement_date:dOnly(120), tracking_no:'BOS-77310', notes:'خروج مع بوسطة — DEMO-1040'},
    {id:'dm3', product_id:'ds1', product_name:'تيربو بريمو ٥ دور', movement_type:'in', qty_in:1, qty_out:0, created_at:iso(1200), movement_date:dOnly(1200), tracking_no:'BOS-77199', notes:'مرتجع رجع للمخزن — DEMO-1037'},
    {id:'dm4', product_id:'ds2', product_name:'مطبقية ريكي ٢ دور', movement_type:'in', qty_in:20, qty_out:0, created_at:iso(5000), movement_date:dOnly(5000), tracking_no:'', notes:'توريد جديد'}
  ];
}

function tourBackupAndInject(){
  // remember current table + stats; swap in demo data
  tourSavedHTML = $id('tbody') ? $id('tbody').innerHTML : null;
  window.__tourRealAll = (typeof all!=='undefined') ? all : null;
  window.__tourRealStock = (typeof stockProducts!=='undefined') ? stockProducts : null;
  window.__tourRealMov = (typeof stockMovements!=='undefined') ? stockMovements : null;
  window.__tourRealExp = (typeof financeExpenses!=='undefined') ? financeExpenses : null;
  ordersSetAll(tourDemoOrders());
  stockSetProducts(tourDemoStock());
  stockSetMovements(tourDemoMovements());
  try{ financeSetExpenses(tourDemoExpenses()); }catch(e){ swallow('tourBackupAndInject/tourDemoExpenses', e); }
  try{ buildIndexes && buildIndexes(); }catch(e){ swallow('tourBackupAndInject/buildIndexes', e); }
  try{ updateStats && updateStats(); }catch(e){ swallow('tourBackupAndInject/updateStats', e); }
  try{ updateRevenueStats && updateRevenueStats(); }catch(e){ swallow('tourBackupAndInject/updateRevenueStats', e); }
  try{ renderFinanceOverview && renderFinanceOverview(); }catch(e){ swallow('tourBackupAndInject/renderFinanceOverview', e); }
  try{ updateStockStats && updateStockStats(); }catch(e){ swallow('tourBackupAndInject/updateStockStats', e); }
  try{ renderProducts && renderProducts(); }catch(e){ swallow('tourBackupAndInject/renderProducts', e); }
  try{ renderMovements && renderMovements(); }catch(e){ swallow('tourBackupAndInject/renderMovements', e); }
  try{ doFilter && doFilter(); }catch(e){ swallow('tourBackupAndInject/doFilter', e); }
}
function tourRestore(){
  if(window.__tourRealAll){ ordersSetAll(window.__tourRealAll); window.__tourRealAll=null; }
  if(typeof window.__tourRealStock!=='undefined'){ try{ stockSetProducts(window.__tourRealStock); }catch(e){ swallow('tourRestore/stockProducts', e); } window.__tourRealStock=undefined; }
  if(typeof window.__tourRealMov!=='undefined'){ try{ stockSetMovements(window.__tourRealMov); }catch(e){ swallow('tourRestore/stockMovements', e); } window.__tourRealMov=undefined; }
  if(typeof window.__tourRealExp!=='undefined'){ try{ financeSetExpenses(window.__tourRealExp); }catch(e){ swallow('tourRestore/financeExpenses', e); } window.__tourRealExp=undefined; }
  // بعد الجولة: all الحقيقي بقى فاضي (مش بيتحمّل عند البداية) — فنرجّع صفحة الأوردرات
  // الحقيقية من السيرفر بدل ما نحسبها من الذاكرة الفاضية.
  try{ buildIndexes && buildIndexes(); }catch(e){ swallow('tourRestore/buildIndexes', e); }   // يصفّر phoneCounts (all فاضي)
  try{ loadOrdersCards(); }catch(e){ swallow('tourRestore/loadOrdersCards', e); }                 // الكروت + الإيرادات من الـ RPC
  try{ loadMergeCandidates(); }catch(e){ swallow('tourRestore/loadMergeCandidates', e); }
  try{ loadBostaInventoryCard(); }catch(e){ swallow('tourRestore/loadBostaInventoryCard', e); }
  try{ doFilter(); }catch(e){ swallow('tourRestore/doFilter', e); }                        // الجدول: صفحة من السيرفر
}

// ---- the steps ----
function tourSteps(){
  return [
    {sel:'#s0', page:'orders', title:'كارت إجمالي الطلبات',
     text:'ده بيجمّع كل الأوردرات اللي نزلت الشهر الحالي بكل حالاتها — مؤكدة، ملغية، مرتجعة، تحت التسليم.. كله. الرقم ده نبضة المتجر.'},
    {sel:'#s1', page:'orders', title:'قيد الانتظار',
     text:'الأوردرات اللي لسه محتاجة تأكيد من العميل ومتاخدش فيها أي إجراء. دي أهم خانة لفريق التأكيد — كل ما تقل، كل ما الشغل ماشي.'},
    {sel:'#s2', page:'orders', title:'مؤكدة',
     text:'العميل أكّد الأوردر وجاهز يتشحن (لسه متبعتش لبوسطة). من هنا بيروح للتغليف والشحن.'},
    {sel:'#s3', page:'orders', title:'تم التسليم',
     text:'الأوردرات اللي وصلت العميل فعلاً (Delivered). دي الفلوس اللي اتحصّلت بجد.'},
    {sel:'#s4', page:'orders', title:'ملغية',
     text:'اتلغت سواء من العميل أو منك. بنتتبّعها عشان نعرف نسبة الإلغاء وأسبابها.'},
    {sel:'#s5', page:'orders', title:'مرتجعة',
     text:'رجعت بعد ما اتشحنت (مرتجع). دي بتكلّفك فلوس شحن — لو وفّرتها هتزوّد معدّل ربحك بشكل كبير.'},
    {sel:'#s6', page:'orders', title:'نسبة التأكيد',
     text:'= المؤكدة ÷ (المؤكدة + الملغية). بتقيس شطارة فريق التأكيد. الأوردرات قيد الانتظار مش بتدخل الحسبة.'},
    {sel:'#s7', page:'orders', title:'نسبة التسليم',
     text:'= المسلَّمة ÷ (المسلَّمة + المرتجعة). بتقيس نجاحك في توصيل اللي اتشحن فعلاً — مش من إجمالي الأوردرات.'},
    {sel:'#qinp', page:'orders', title:'البحث الذكي',
     text:'دوّر بأي حاجة: اسم المنتج، رقم العميل، رقم الطلب، رقم التتبع (البوليصة)، أو حتى بعنوان العميل. اكتب أي جزء وهيرشّحلك على طول.'},
    {sel:'#fst-wrap', page:'orders', title:'فلتر الحالات',
     text:'صفّي الأوردرات حسب الحالة: قيد الانتظار، مؤكدة، مع بوسطة دلوقتي، تم التسليم، ملغية، مرتجعة... عشان تركّز على اللي مهم.'},
    {sel:'#fpl-wrap', page:'orders', title:'فلتر المنصة وطريقة الدفع',
     text:'اعرف كل أوردر جه منين — فيسبوك، إنستجرام، تيك توك — وطريقة الدفع (كاش عند الاستلام أو Paymob). مفيد جداً لتقييم إعلاناتك.'},
    {sel:'#dcnt .log-list, #dcnt', page:'orders', title:'تفاصيل كل أوردر + الـ LOG',
     text:'لما تضغط على أي أوردر بيفتحلك تفاصيله كاملة زي ما إنت شايف دلوقتي. أهم حاجة: الـ LOG تحت — تاريخ كامل لكل حاجة حصلت: مين أكّد الأوردر وامتى، مين سجّل خروجه من المخزن لما ضرب البوليصة، ومين لغاه وإيه السبب. كل حركة باسم صاحبها ووقتها.',
     openOrder:'demo-1039', exact:true},
    {sel:'.timer-cell[data-deadline]:not([data-deadline=""])', page:'orders', title:'مواعيد الاتصال (تايمر ساعة ونص)',
     text:'لما الموظف يعمل محاولة اتصال والعميل مايردش، النظام بيبدأ تايمر تنازلي ساعة ونص جنب الأوردر (شوف العمود ده). كده الموظف يعرف بالظبط هيكلّم العميل تاني امتى — من غير ما يفتكر أو يكلّمه بدري ويزهّقه.',
     closeOrder:true, exact:true},
    {sel:'#nav-stock', page:'orders', title:'المخزون',
     text:'تعالى نشوف المخزون.', click:true},
    {sel:'#stock-cards-row', page:'stock', exact:true, title:'كروت المخزون',
     text:'هنا بتشوف عدد المنتجات، إجمالي القطع في المخزن، والمنتجات اللي خلصت. كل ده بيتحدّث أوتوماتيك مع كل بيع أو إرجاع.'},
    {sel:'#page-stock .stock-tabs', page:'stock', title:'حركات المخزون',
     text:'فيه تبويب "حركات المخزون" بيسجّل كل دخول وخروج: خروج لما الأوردر يضرب البوليصة، ودخول لما يرجع. كل حركة بكميتها ووقتها — فمتعرفش تتلغبط في المخزن أبداً.'},
    {sel:'#nav-finance', page:'stock', title:'الماليات',
     text:'دلوقتي أهم جزء — الماليات.', click:true},
    {sel:'#fin-revenue', page:'finance', title:'الماليات — قيمة الطلبات',
     text:'إجمالي قيمة كل الأوردرات في الفترة (بكل الحالات). ده حجم شغلك، مش الفلوس المحصّلة فعلاً.'},
    {sel:'#fin-collected', page:'finance', title:'المتحصّل فعلاً',
     text:'الفلوس اللي دخلت جيبك بجد من الأوردرات المسلَّمة. ده الرقم اللي بيهمك.'},
    {sel:'#fin-net-profit', page:'finance', title:'صافي الربح',
     text:'= المتحصّل − (تكلفة البضاعة + الشحن + التغليف + المصاريف). ده اللي كسبته صح بعد خصم كل حاجة.'},
    {sel:'#fin-cost-section', page:'finance', exact:true, title:'تفكيك التكاليف',
     text:'بنفصّلك فلوسك راحت فين بالظبط: بضاعة، شحن، إعلانات، مرتبات، تغليف... كل بند ونسبته من الإيراد. كدا تعرف فلوسك بتتهدر على إيه وتظبط الأمور أكثر.'}
  ];
}

function tourPositionFor(el, bubble){
  var W=window.innerWidth, H=window.innerHeight;
  // if target is inside the order overlay, lift overlay above tour layer & hide the dark masks
  var ovl=document.getElementById('ovl');
  var inOvl = ovl && ovl.contains(el);
  var top=document.getElementById('tm-top'), bot=document.getElementById('tm-bot'),
      lef=document.getElementById('tm-lef'), rig=document.getElementById('tm-rig');
  var ring=document.getElementById('tour-ring');
  if(inOvl){
    ovl.style.zIndex='99988';
    bubble.style.zIndex='99999';
    ring.style.zIndex='99998';
    // hide masks — the overlay backdrop already dims everything behind it
    [top,bot,lef,rig].forEach(function(m){ m.style.cssText='display:none'; });
    var r2=el.getBoundingClientRect();
    var pad2=6;
    ring.style.cssText='position:fixed;z-index:99998;top:'+(r2.top-pad2)+'px;left:'+(r2.left-pad2)+'px;width:'+(r2.width+pad2*2)+'px;height:'+(r2.height+pad2*2)+'px;';
    ring.className='tour-ring';
    // place the bubble BESIDE the order panel (in the empty gutter), not over it
    var panel=ovl.querySelector('.dpan');
    var pr=panel?panel.getBoundingClientRect():r2;
    var bw2=Math.min(300, W-32), bh2=bubble.offsetHeight||220;
    var gapLeft=pr.left;                 // space to the left of the panel
    var gapRight=W-pr.right;             // space to the right of the panel
    var bLeft2, bTop2;
    if(gapLeft >= bw2+12){                       // enough room on the left
      bLeft2 = Math.max(8, pr.left - bw2 - 12);
    } else if(gapRight >= bw2+12){               // else try the right
      bLeft2 = Math.min(W - bw2 - 8, pr.right + 12);
    } else {                                     // narrow screen: center horizontally, sit near top
      bLeft2 = Math.max(12, (W-bw2)/2);
    }
    // vertically align bubble with the highlighted element, clamped to viewport
    bTop2 = Math.max(12, Math.min(r2.top - 10, H - bh2 - 12));
    bubble.style.top=bTop2+'px'; bubble.style.left=bLeft2+'px'; bubble.style.maxWidth=bw2+'px';
    bubble.className='tour-bubble arr-none';
    return;
  }
  if(ovl){ ovl.style.zIndex=''; }
  bubble.style.zIndex=''; ring.style.zIndex='';
  var r=el.getBoundingClientRect();
  var pad=8;
  // ring
  ring.style.top=(r.top-pad)+'px'; ring.style.left=(r.left-pad)+'px';
  ring.style.width=(r.width+pad*2)+'px'; ring.style.height=(r.height+pad*2)+'px';
  ring.style.display='';
  // 4 masks around target
  top.style.cssText='position:fixed;top:0;left:0;width:100%;height:'+Math.max(0,r.top-pad)+'px;';
  bot.style.cssText='position:fixed;top:'+(r.bottom+pad)+'px;left:0;width:100%;height:'+Math.max(0,H-r.bottom-pad)+'px;';
  lef.style.cssText='position:fixed;top:'+(r.top-pad)+'px;left:0;width:'+Math.max(0,r.left-pad)+'px;height:'+(r.height+pad*2)+'px;';
  rig.style.cssText='position:fixed;top:'+(r.top-pad)+'px;left:'+(r.right+pad)+'px;width:'+Math.max(0,W-r.right-pad)+'px;height:'+(r.height+pad*2)+'px;';
  [top,bot,lef,rig].forEach(function(m){m.className='tour-mask';});
  // bubble: place below target if room, else above
  var bw=Math.min(340, W-32), bh=bubble.offsetHeight||220;
  var gap=8;
  var spaceBelow=H-r.bottom;
  var bTop, arr;
  if(spaceBelow > bh+30){ bTop=r.bottom+pad+gap; arr='arr-top'; }
  else { bTop=Math.max(12, r.top-pad-bh-gap); arr='arr-bottom'; }
  // center the bubble horizontally on the target (clamped), so it sits right under it
  var cx=r.left + r.width/2;
  var bLeft=Math.min(Math.max(12, cx - bw/2), W-bw-12);
  // aim the little arrow at the target's center, clamped to stay inside the bubble
  var arrX=Math.min(Math.max(16, cx - bLeft - 7), bw-30);
  bubble.style.top=bTop+'px'; bubble.style.left=bLeft+'px'; bubble.style.maxWidth=bw+'px';
  bubble.style.setProperty('--arr-x', arrX+'px');
  bubble.className='tour-bubble '+arr;
}

function tourRender(){
  var steps=tourSteps();
  var s=steps[tourStep];
  if(!s){ tourFinish(); return; }
  // close the order overlay unless this step wants it open
  if(!s.openOrder){ try{ if($id('ovl')) $id('ovl').classList.remove('open'); }catch(e){ swallow('tourRender/$id', e); } }
  // switch page if needed
  if(s.page && typeof showPage==='function'){
    var cur=document.querySelector('.tnav-btn.active');
    var curPage=cur?cur.getAttribute('data-page'):'orders';
    if(curPage!==s.page){ showPage(s.page); }
  }
  // open the order detail for steps that need it (e.g. the LOG step)
  if(s.openOrder){
    try{
      // seed demo stock so openDetail skips its DB query during the tour
      if(!stockProducts || !stockProducts.length){
        stockSetProducts([{id:'d1',name:'تيربو بريمو ٥ دور',current_qty:12,unit_price:1290},
                       {id:'d2',name:'مطبقية ريكي ٢ دور',current_qty:8,unit_price:980},
                       {id:'d3',name:'استاند أمريكانا',current_qty:5,unit_price:1150},
                       {id:'d4',name:'ترابيزة IKEA',current_qty:3,unit_price:1420},
                       {id:'d5',name:'ترولي خشب ايكيا',current_qty:0,unit_price:870}]);
      }
      openDetail(s.openOrder);
    }catch(e){ swallow('tourRender', e); }
  }
  var settleDelay = s.openOrder ? 260 : (s.page?380:60);
  setTimeout(function(){
    var el=document.querySelector(s.sel);
    if(!el){ // fallback: skip missing target
      tourStep++; if(tourStep>=steps.length){tourFinish();return;} tourRender(); return;
    }
    // highlight the whole card if the target is a value inside a stat card
    if(!s.exact){
      var card=el.closest('.sc, .rev-card, tr');
      if(card) el=card;
    }
    el.scrollIntoView({behavior:'smooth',block:'center'});
    // give smooth-scroll a moment (esp. inside the order overlay) before positioning
    setTimeout(function(){
      var bubble=document.getElementById('tour-bubble');
      // dots
      var dots=''; for(var i=0;i<steps.length;i++){ dots+='<span class="tour-dot'+(i===tourStep?' active':'')+'"></span>'; }
      var isLast=tourStep===steps.length-1;
      bubble.innerHTML=
        '<div class="tour-step-n">خطوة '+(tourStep+1)+' من '+steps.length+'</div>'
        +'<div class="tour-title">'+s.title+'</div>'
        +'<div class="tour-text">'+s.text+'</div>'
        +'<div class="tour-actions">'
        +'<div class="tour-dots">'+dots+'</div>'
        +'<div class="tour-btns">'
        +(tourStep>0?'<button class="tour-btn prev" data-act="tour-prev">السابق</button>':'<button class="tour-btn skip" data-act="tour-finish">تخطّي</button>')
        +'<button class="tour-btn next" data-act="tour-next">'+(isLast?'تمام، خلصنا':'التالي')+'</button>'
        +'</div></div>';
      tourPositionFor(el, bubble);
    }, 280);
  }, settleDelay);
}

function tourNext(){ var steps=tourSteps(); tourStep++; if(tourStep>=steps.length){tourFinish();return;} tourRender(); }
function tourPrev(){ if(tourStep>0){tourStep--; tourRender();} }

function tourStart(){
  if(typeof isAdmin==='function' && !isAdmin()) return;
  tourActive=true; tourStep=0;
  var center=document.getElementById('tour-center'); if(center)center.style.display='none';
  var ov=document.getElementById('tour-overlay'); ov.classList.add('active');
  tourBackupAndInject();
  tourRender();
}
function tourFinish(){
  tourActive=false;
  try{ $id('ovl').classList.remove('open'); }catch(e){ swallow('tourFinish/$id', e); }
  var ov=document.getElementById('tour-overlay'); ov.classList.remove('active');
  // BUGFIX: hide the welcome card too — if the user clicked "Skip" before starting,
  // tourStart() never ran and the welcome modal would stay visible forever.
  var center=document.getElementById('tour-center'); if(center) center.style.display='none';
  markTourDone();
  tourRestore();
  if(typeof showPage==='function') showPage('orders');
  var fab=document.getElementById('tour-fab'); if(fab)fab.style.display='flex';
}
function tourReopenWelcome(){
  var center=document.getElementById('tour-center');
  if(center) center.style.display='flex';
}

function tourMaybeAutoStart(){
  if(typeof isAdmin==='function' && !isAdmin()) return;
  // always show the FAB for admins
  var fab=document.getElementById('tour-fab'); if(fab)fab.style.display='flex';
  if(tourDone()) return;
  var center=document.getElementById('tour-center');
  if(center) center.style.display='flex';
}
// reposition on resize while active
// إعادة رسم الجولة عند تغيير المقاس
function initTourResize(){
window.addEventListener('resize', function(){ if(tourActive) tourRender(); });
// expose tour controls for inline onclick handlers (bubble + welcome card)
// exports الجولة على window اتشالت — الأزرار بقت data-act

// ===== كروت/تنبيهات صفحة الأوردرات من السيرفر (RPC + كويريهات مخصّصة) =====
// المدة الحالية بتواريخ القاهرة للـ RPC. NULL = كل الفترات.
}
function ordersPeriodCairoDates(){
  var p=ordersPeriod;
  if(p.type==='all') return null;
  var today=cairoYMD(new Date());
  if(p.type==='last3')  return { from: ymdAddDays(today,-2),  to: today };
  if(p.type==='last30') return { from: ymdAddDays(today,-29), to: today };
  if(p.type==='month'){
    var y=+today.slice(0,4), m=+today.slice(5,7), last=new Date(y,m,0).getDate();
    return { from: today.slice(0,7)+'-01', to: today.slice(0,7)+'-'+('0'+last).slice(-2) };
  }
  if(p.type==='custom'){ var f=p.from||'2000-01-01', t=p.to||'2999-12-31'; if(f>t){var x=f;f=t;t=x;} return { from:f, to:t }; }
  return null;
}

// يطبّق ناتج RPC على كروت الإحصائيات والإيرادات (بنفس معادلات updateStats/updateRevenueStats بالظبط)
function applyOrdersStats(s){
  if(tourActive || !s) return;   // لو وصل متأخر أثناء الجولة → ماتلمسش الديمو
  $id('s0').textContent=num(s.total_count);
  $id('s1').textContent=num(s.pending);
  $id('s2').textContent=num(s.confirmed);
  $id('s3').textContent=num(s.delivered);
  $id('s4').textContent=num(s.cancelled);
  $id('s5').textContent=num(s.returned);
  $id('s-ready').textContent=num(s.bosta_ready);
  $id('s6').textContent = s.processed>0 ? ((s.positive/s.processed)*100).toFixed(1)+'%' : '—';
  var dd=(s.delivered||0)+(s.returned||0);
  $id('s7').textContent = dd>0 ? ((s.delivered/dd)*100).toFixed(1)+'%' : '—';
  $id('rv-total').textContent=money(s.sum_total);
  $id('rv-collected').textContent=money(s.sum_collected);
  $id('rv-expected').textContent=money(s.sum_expected);
  $id('rv-lost').textContent=money(s.sum_lost);
  $id('rv-aov').textContent = s.total_count ? money(s.sum_total/s.total_count) : '—';
  $id('rv-paymob').textContent=money(s.sum_paymob);
  var pc=$id('orders-period-cnt');
  if(pc) pc.textContent = ordersPeriod.type==='all' ? num(s.total_count)+' طلب (كل الفترات)' : num(s.total_count)+' طلب في المدة';
}

// كروت الأوردرات (s0..s7 + الإيرادات + عدّاد المدة) في نداء RPC واحد
function loadOrdersCards(){
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  var d=ordersPeriodCairoDates();
  sb.rpc('sahl_orders_stats',{ p_tenant: currentTenantId, p_from: d?d.from:null, p_to: d?d.to:null }).then(function(r){
    if(tourActive) return;
    if(r.error || !r.data){ if(r.error&&r.error.message) console.warn('stats RPC:',r.error.message); return; }
    applyOrdersStats(r.data);
  });
}

// تنبيه الدمج: عملاء معاهم أوردرين+ جاهزين للشحن — كويري مخصّص بدل المصفوفة الكاملة
var MERGE_QUERY_STATUSES = ['bosta_assigned','BOSTA AUTO','bosta_auto','BOSTA2','bosta2'];
function loadMergeCandidates(){
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  sb.from('orders').select('order_uid,tracking_no,customer_name,city,phone,total_cost,status')
    .eq('tenant_id',currentTenantId).in('status',MERGE_QUERY_STATUSES).then(function(r){
      if(tourActive) return;
      if(r.error) return;
      pendingBostaByPhone={};
      (r.data||[]).forEach(function(o){
        var p=normalizePhone(o.phone); if(!p)return;
        if(!pendingBostaByPhone[p]) pendingBostaByPhone[p]=[];
        pendingBostaByPhone[p].push(o);
      });
      detectMergeable();
    });
}

// كارت "بضاعة مع بوسطة": تكلفة بضاعة الأوردرات في تشغيل بوسطة — كويري مخصّص
function loadBostaInventoryCard(){
  var el=$id('rv-bosta-stock'); if(!el) return;
  var sub=$id('rv-bosta-stock-sub');
  if(!isAdmin()){ el.textContent='—'; if(sub)sub.textContent='للأدمن فقط'; return; }
  if(tourActive) return;
  if(!sb||!currentTenantId) return;
  loadStockProductsForCosts(function(){
    sb.from('orders').select('product_name,inventory_cost_snapshot,inventory_value_snapshot,inventory_value_at_bosta,status')
      .eq('tenant_id',currentTenantId).in('status',BOSTA_OPERATION_STATUSES).then(function(r){
        if(tourActive) return;
        if(r.error) return;
        var orders=r.data||[];
        var total=orders.reduce(function(s,o){return s+orderInventoryCost(o);},0);
        el.textContent=money(total);
        if(sub)sub.textContent=num(orders.length)+' شحنة في التشغيل حاليًا';
      });
  });
}

// تحميل كل الأوردرات للذاكرة عند الحاجة فقط (الماليات/الإحصائيات بتحسب على كل الفترة).
function ensureAllLoaded(cb){
  if(tourActive){ cb&&cb(); return; }            // الجولة: all = بيانات ديمو محمّلة بالفعل
  if(allLoaded){ cb&&cb(); return; }
  if(!sb||!currentTenantId){ cb&&cb(); return; }
  // ⚠️ مهم: select() من غير range بيتوقف عند سقف PostgREST (١٠٠٠ صف) في صمت —
  // وده كان بيخلّي الماليات والإحصائيات تتحسب على جزء من البيانات من غير أي تحذير.
  // بنسحب على دفعات لحد ما الداتا تخلص.
  var CHUNK = 1000, acc = [], fromIdx = 0, MAXROWS = 200000;
  (function pull(){
    sb.from('orders').select('*').eq('tenant_id',currentTenantId)
      .order('created_at',{ascending:false})
      .range(fromIdx, fromIdx + CHUNK - 1)
      .then(function(r){
        if(r.error){ toast('خطأ في تحميل البيانات: '+r.error.message,'er'); cb&&cb(); return; }
        var got = r.data || [];
        acc = acc.concat(got);
        if(got.length === CHUNK && acc.length < MAXROWS){ fromIdx += CHUNK; pull(); return; }
        all = acc; allLoaded = true;
        try{ buildIndexes(); }catch(e){ swallow('pull/buildIndexes', e); }           // phoneCounts كامل
        cb&&cb();
      });
  })();
}

// عدد طلبات كل عميل لصفحة الجدول الحالية (شارة العميل المتكرر) — كويري صغير بدل تحميل الكل
function fetchPhoneCounts(rawPhones, cb){
  if(tourActive || !sb || !currentTenantId || !rawPhones || !rawPhones.length){ cb&&cb(); return; }
  sb.from('orders').select('phone').eq('tenant_id',currentTenantId).in('phone',rawPhones).then(function(r){
    if(!r.error && r.data){
      var c={};
      r.data.forEach(function(o){ var p=normalizePhone(o.phone); if(p) c[p]=(c[p]||0)+1; });
      Object.keys(c).forEach(function(k){ phoneCounts[k]=c[k]; });
    }
    cb&&cb();
  });
}

function loadAll(){
  if(!ensureTenant())return;
  selectedIds.clear();updateBulkBar();
  // مش بنحمّل كل الأوردرات عند البداية — صفحة الأوردرات كلها من السيرفر.
  // all يتحمّل lazily بس لما الماليات أو الإحصائيات تتفتح.
  all=[]; allLoaded=false;
  loadOrdersCards();         // s0..s7 + الإيرادات + عدّاد المدة من RPC
  loadMergeCandidates();     // تنبيه الدمج من كويري مخصّص
  loadBostaInventoryCard();  // كارت بضاعة بوسطة من كويري مخصّص (بيحمّل المخزون عند اللزوم)
  doFilter();                // الجدول: صفحة واحدة من السيرفر
  startRealtime();
  waRefreshNavBadge();       // عدّاد المحادثات غير المقروءة على زرار التبويب
  loadWalletState();         // للجميع (أدمن + موظف) — للقفل عند نفاد الرصيد
  try{ tourMaybeAutoStart(); }catch(e){ swallow('loadAll/tourMaybeAutoStart', e); }
}


function startRealtime(){
  // Remove any existing channel before creating a new one
  if(realtimeChannel){
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeChannel = sb
    .channel('orders-realtime-'+currentTenantId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      handleRealtimeChange(payload);
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'stock_products',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      // Update in-memory stock products when qty changes (e.g. after scanner deduction)
      if(payload.new && stockProducts){
        for(var i=0;i<stockProducts.length;i++){
          if(stockProducts[i].id === payload.new.id){
            stockProducts[i] = Object.assign(stockProducts[i], payload.new);
            break;
          }
        }
        // If stock page is open, refresh it silently
        if($id('page-stock').style.display !== 'none'){
          updateStockStats();
          loadBostaInventoryCard();
          renderProducts();
        }
      }
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'stock_movements',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      // Add new movement to in-memory list and re-render if stock page open
      if(payload.new){
        if(!stockMovements) stockSetMovements([]);
        stockMovements.unshift(payload.new);
        if($id('page-stock').style.display !== 'none') renderMovements();
      }
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'tenants',
      filter: 'id=eq.'+currentTenantId
    }, function(payload){
      // Instant suspension: if the super admin deactivates this tenant,
      // force-logout immediately without waiting for a page refresh.
      if(payload.new && payload.new.active === false){
        forceSuspendLogout();
        return;
      }
      // Wallet balance changed (super admin top-up/adjust, or plan switch) → refresh wallet state immediately
      if(payload.new && payload.old && (
        payload.new.wallet_balance !== payload.old.wallet_balance
        || payload.new.plan !== payload.old.plan
        || payload.new.overdraft_limit !== payload.old.overdraft_limit
      )){
        loadWalletState();  // refresh for everyone — depletion lock applies to all roles
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'wa_messages',
      filter: 'tenant_id=eq.'+currentTenantId
    }, function(payload){
      handleWaRealtime(payload);
    })
    .subscribe(function(status){
      if(status === 'SUBSCRIBED'){
        showRealtimeDot(true);
      } else if(status === 'CLOSED' || status === 'CHANNEL_ERROR'){
        showRealtimeDot(false);
      }
    });
}

function handleRealtimeChange(payload){
  var ev = payload.eventType;
  var row = payload.new || {};
  var oldRow = payload.old || {};

  if(ev === 'INSERT'){
    if(allLoaded) all.unshift(row);
    toast('📦 طلب جديد وصل!','ok');
  } else if(ev === 'UPDATE'){
    if(allLoaded){
      for(var i=0;i<all.length;i++){ if(all[i].id === row.id){ all[i] = row; break; } }
    }
    if(sel && sel.id === row.id){ ordersSetSelected(row); }
  } else if(ev === 'DELETE'){
    if(allLoaded) ordersSetAll(all.filter(function(o){ return o.id !== oldRow.id; }));
  }

  if(allLoaded){ try{ buildIndexes(); }catch(e){ swallow('handleRealtimeChange/buildIndexes', e); } }
  loadOrdersCards();
  loadMergeCandidates();
  loadBostaInventoryCard();
  doFilter();
  // refresh wallet (status change may have triggered a charge) — for everyone
  if(ev !== 'DELETE') loadWalletState();
}

function buildIndexes(){
  phoneCounts={};
  pendingBostaByPhone={};
  var MERGE_STATUSES = ['bosta_assigned','BOSTA AUTO','bosta_auto','BOSTA2','bosta2'];
  all.forEach(function(o){
    var p=normalizePhone(o.phone);
    if(!p)return;
    phoneCounts[p]=(phoneCounts[p]||0)+1;
    if(MERGE_STATUSES.indexOf(o.status) >= 0){
      if(!pendingBostaByPhone[p]) pendingBostaByPhone[p]=[];
      pendingBostaByPhone[p].push(o);
    }
  });
}

function showRealtimeDot(connected){
  var dot = $id('realtime-dot');
  if(!dot) return;
  dot.title = connected ? 'متصل — تحديث فوري مفعّل ✅' : 'غير متصل — تحديث يدوي فقط';
  dot.className = 'realtime-dot ' + (connected ? 'on' : 'off');
}

// Customers with 2+ orders all in "bosta_assigned" status — can be merged into one shipment
var mergeableCustomers = []; // [{ phone, name, orders: [...] }]

function detectMergeable(){
  mergeableCustomers = [];
  Object.keys(pendingBostaByPhone).forEach(function(phone){
    var orders = pendingBostaByPhone[phone];
    if(orders.length >= 2){
      mergeableCustomers.push({
        phone: phone,
        name: orders[0].customer_name || 'عميل',
        city: orders[0].city || '',
        orders: orders,
        totalCost: orders.reduce(function(s,o){return s+(o.total_cost||0);},0)
      });
    }
  });
  renderMergeAlert();
}

function renderMergeAlert(){
  var container = $id('merge-alert-container');
  if(!container) return;
  if(!mergeableCustomers.length){
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  var totalDuplicateOrders = mergeableCustomers.reduce(function(s,c){return s+c.orders.length;},0);
  var savings = mergeableCustomers.reduce(function(s,c){return s+(c.orders.length-1);},0); // shipments saved
  var h = '<div class="merge-alert">'
    + '<div class="merge-alert-header">'
    +   '<div class="merge-alert-icon">⚠️</div>'
    +   '<div class="merge-alert-title">انتبه يا ريس! فيه عملاء معاهم أوردرات متعددة جاهزة للشحن</div>'
    +   '<div class="merge-alert-count">'+mergeableCustomers.length+' عميل</div>'
    + '</div>';
  mergeableCustomers.forEach(function(c){
    var chips = c.orders.map(function(o){
      return '<span class="merge-order-chip">#'+(o.order_uid||o.tracking_no||'?')+'</span>';
    }).join('');
    h += '<div class="merge-customer">'
      + '<div style="flex:1">'
      +   '<div class="merge-cust-name">'+esc(c.name)+(c.city?' — '+esc(c.city):'')+'</div>'
      +   '<div class="merge-cust-meta">📱 '+esc(c.phone)+' · 💰 '+num(c.totalCost)+' ج · '+c.orders.length+' أوردرات</div>'
      + '</div>'
      + '<div class="merge-cust-orders">'+chips+'</div>'
      + '<button class="merge-show-btn" data-phone="'+esc(c.phone)+'">👁️ اعرض الأوردرات</button>'
      + '</div>';
  });
  h += '<div class="merge-savings">💡 لو دمجتهم في شحنة واحدة لكل عميل، هتوفر تكلفة شحن لـ '+savings+' شحنة!</div>';
  h += '</div>';
  container.innerHTML = h;
  container.style.display = 'block';
  // Wire up "show orders" buttons — filter table by phone
  container.querySelectorAll('.merge-show-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var phone = b.getAttribute('data-phone');
      $id('qinp').value = phone;
      $id('fst').value = ''; $id('fpl').value = ''; $id('fpy').value = '';
      if(window.__syncFilterUI)window.__syncFilterUI();
      doFilter();
      window.scrollTo({top: $id('fbar') ? $id('fbar').offsetTop - 80 : 200, behavior:'smooth'});
      toast('عرض أوردرات هذا العميل','ok');
    });
  });
}

function customerOrderCount(o){
  var p=normalizePhone(o.phone);
  return p ? (phoneCounts[p]||1) : 1;
}

// Statuses shown under OPERATION filter — official Bosta API movement statuses only; excludes Delivered and internal Bosta statuses
var OPERATION_STATUSES = BOSTA_OPERATION_STATUSES;

// ===== Server-side orders pagination =====
var totalCount = 0;                 // إجمالي الأوردرات المطابقة للفلتر (من عدّاد السيرفر)
var ordersLoading = false;
var BOSTA_FILTER_STATUSES = ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2'];
// الأعمدة اللي الجدول + المؤقّت محتاجينها فقط (مفيش select('*'))
// حدود سمعة العميل من بوسطة (سهل تغييرها): >= جامد، >= متوسط، أقل = زبالة
var RANK_GOOD = 80, RANK_MID = 50;
var ORDER_LIST_COLS = 'id,order_uid,tracking_no,customer_name,phone,alt_phone,city,address,product_name,payment_stage,status,status_changed_at,call_attempts,customer_notes,internal_notes,created_at,total_cost,platform,awb_printed_at,awb_print_count,customer_ranking,cancel_requested_at,cancel_resolved_at,var';

// المدة (بتوقيت القاهرة) → حدود created_at [from, to). NULL = كل الفترات.
function ordersPeriodRangeISO(){
  var p=ordersPeriod;
  if(p.type==='all') return null;
  function dISO(y,mi,d){ return new Date(y,mi,d,0,0,0,0).toISOString(); }
  var now=new Date();
  if(p.type==='month') return { fromTs:dISO(now.getFullYear(),now.getMonth(),1), toTs:dISO(now.getFullYear(),now.getMonth()+1,1) };
  if(p.type==='last3'){ var f=new Date(now); f.setDate(f.getDate()-2); return { fromTs:dISO(f.getFullYear(),f.getMonth(),f.getDate()), toTs:dISO(now.getFullYear(),now.getMonth(),now.getDate()+1) }; }
  if(p.type==='last30'){ var g=new Date(now); g.setDate(g.getDate()-29); return { fromTs:dISO(g.getFullYear(),g.getMonth(),g.getDate()), toTs:dISO(now.getFullYear(),now.getMonth(),now.getDate()+1) }; }
  if(p.type==='custom'){ var fr=p.from,to=p.to; if(fr&&to&&fr>to){var t=fr;fr=to;to=t;} var a=(fr||'2000-01-01').split('-'),b=(to||'2999-12-31').split('-'); return { fromTs:dISO(+a[0],+a[1]-1,+a[2]), toTs:dISO(+b[0],+b[1]-1,+b[2]+1) }; }
  return null;
}

// جلب صفحة واحدة من الأوردرات من Supabase بكل الفلاتر مطبّقة على مستوى الـ query.
// شريط تنبيه طلبات الإلغاء — بيعدّ كل الأوردرات اللي العميل طلب إلغاءها
function refreshCancelBar(){
  var bar=$id('cxbar');
  if(!bar) return;
  if(tourActive || !currentTenantId){ bar.style.display='none'; return; }
  sb.from('orders').select('id',{count:'exact',head:true})
    .eq('tenant_id',currentTenantId)
    .not('cancel_requested_at','is',null)
    .is('cancel_resolved_at',null)
    .then(function(r){
      var c = r && r.count || 0;
      if(!c || r.error){ bar.style.display='none'; return; }
      bar.innerHTML = '\u26A0 <span>فيه <b>'+c+'</b> '+(c===1?'أوردر العميل طلب إلغاءه':'أوردرات العملاء طلبوا إلغاءها')+' — الأوردر لسه زي ما هو، كلّمهم وقرّر.</span>'
                    + '<span class="cxb-go">عرضهم \u2190</span>';
      bar.style.display='flex';
    });
}
// إقفال يدوي: التاجر بيأكد إنه شاف وتعامل
function resolveCancelRequest(){
  if(!sel || !sel.id || !currentTenantId) return;
  if(!confirm('تأكيد إنك اتعاملت مع طلب الإلغاء ده؟\n\nالتنبيه هيختفي من اللوحة، والسجل هيفضل محفوظ.')) return;
  var btn=$id('cx-resolve');
  if(btn){ btn.disabled=true; btn.textContent='جاري الحفظ...'; }
  var upd={ cancel_resolved_at:(new Date()).toISOString() };
  if(currentUser && currentUser.id) upd.cancel_resolved_by=currentUser.id;
  sb.from('orders').update(upd).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){
      toast('خطأ: '+(r.error.message||r.error),'er');
      if(btn){ btn.disabled=false; btn.textContent='\u2713 تم التعامل'; }
      return;
    }
    sel.cancel_resolved_at=upd.cancel_resolved_at;
    toast('تم التعامل \u2713','ok');
    renderDetail();
    refreshCancelBar();
    fetchOrdersPage();
  });
}

function showCancelRequested(){
  var el=$id('fst'); if(!el) return;
  el.value='__cancelreq__';
  cur=1;
  fetchOrdersPage();
}

function fetchOrdersPage(){
  if(tourActive) return;                 // الجولة بترسم بيانات الديمو عبر doFilter()
  if(!ensureTenant()) return;
  ordersLoading = true;
  $id('tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري التحميل...</div>';
  var st=$id('fst').value, pl=$id('fpl').value, py=$id('fpy').value;
  var q=$id('qinp').value.trim();
  var fromIdx=(cur-1)*PS, toIdx=fromIdx+PS-1;
  var query=sb.from('orders').select(ORDER_LIST_COLS,{count:'exact'}).eq('tenant_id',currentTenantId);
  if(st){
    if(st==='__cancelreq__') query=query.not('cancel_requested_at','is',null).is('cancel_resolved_at',null);
    else if(st==='__operation__') query=query.in('status',OPERATION_STATUSES);
    else if(st==='bosta_assigned') query=query.in('status',BOSTA_FILTER_STATUSES);
    else if(st==='delivered') query=query.in('status',DELIVERED_STATUSES);
    else if(st==='returned') query=query.in('status',RETURNED_STATUSES);
    else query=query.eq('status',st);
  }
  if(pl) query=query.eq('platform',pl);
  if(py) query=query.eq('payment_stage',py);
  if(q){
    var qs=q.replace(/[,()*\\%]/g,' ').trim();
    if(qs){
      var lk='*'+qs+'*';
      query=query.or(['customer_name','phone','alt_phone','tracking_no','order_uid','city','address','product_name','campaign_name','platform'].map(function(c){return c+'.ilike.'+lk;}).join(','));
    }
  }
  var rng=ordersPeriodRangeISO();
  if(rng) query=query.gte('created_at',rng.fromTs).lt('created_at',rng.toTs);
  query.order('created_at',{ascending:false}).range(fromIdx,toIdx).then(function(r){
    ordersLoading=false;
    refreshCancelBar();
    if(r.error){
      toast('خطأ في تحميل الأوردرات: '+r.error.message,'er');
      $id('tbody').innerHTML='<div class="ldg">تعذّر تحميل الأوردرات. اضغط ↻ تحديث وحاول تاني.</div>';
      $id('pag').style.display='none';
      return;
    }
    fil=r.data||[];
    totalCount=(typeof r.count==='number')?r.count:fil.length;
    var hasFilter=!!(st||pl||py||q);
    $id('fcnt').textContent=num(totalCount)+(hasFilter?' نتيجة':' طلب');
    try{ updateUnprintedBtn(); }catch(e){ swallow('fetchOrdersPage/updateUnprintedBtn', e); }
    renderTable();
    // شارة العميل المتكرر: عدّ طلبات تليفونات الصفحة من كويري صغير ثم إعادة عرض
    var phs=[], seen={};
    fil.forEach(function(o){ if(o.phone && !seen[o.phone]){ seen[o.phone]=1; phs.push(o.phone); } });
    if(phs.length) fetchPhoneCounts(phs, renderTable);
  });
}

function doFilter(){
  var q=$id('qinp').value.trim().toLowerCase();
  var st=$id('fst').value, pl=$id('fpl').value, py=$id('fpy').value;
  if(tourActive){
    // الجولة التعليمية: فلترة على بيانات الديمو في الذاكرة (نفس السلوك القديم)
    var base=ordersInPeriod();
    var f=base.filter(function(o){
      if(st){
        if(st==='__operation__'){ if(OPERATION_STATUSES.indexOf(o.status)<0) return false; }
        else if(st==='bosta_assigned'){ if(BOSTA_FILTER_STATUSES.indexOf(o.status)<0) return false; }
        else if(st==='delivered'){ if(DELIVERED_STATUSES.indexOf(o.status)<0) return false; }
        else if(st==='returned'){ if(RETURNED_STATUSES.indexOf(o.status)<0) return false; }
        else if(o.status!==st) return false;
      }
      if(pl&&o.platform!==pl)return false;
      if(py&&o.payment_stage!==py)return false;
      if(q){var h=[o.customer_name,o.phone,o.alt_phone,o.tracking_no,o.order_uid,o.city,o.address,o.product_name,o.campaign_name,o.platform].filter(Boolean).join(' ').toLowerCase();if(h.indexOf(q)<0)return false;}
      return true;
    });
    cur=1; totalCount=f.length; fil=f.slice(0,PS);
    $id('fcnt').textContent=f.length!==base.length?num(f.length)+' نتيجة':num(base.length)+' طلب';
    var pc=$id('orders-period-cnt'); if(pc) pc.textContent=ordersPeriod.type==='all'?num(all.length)+' طلب (كل الفترات)':num(base.length)+' طلب في المدة';
    renderTable();
    return;
  }
  // الوضع العادي: عدّاد المدة بيتحدّث من الـ RPC (loadOrdersCards). هنا بس نجيب صفحة الجدول.
  cur=1;
  fetchOrdersPage();
}

// ── Custom Modal (replaces browser confirm/prompt) ──────────────
function showModal(opts){
  // opts: { icon, title, sub, okLabel, okColor, input, placeholder, onOk }
  var bd=$id('cmodal-backdrop');
  var box=$id('cmodal-box');
  $id('cmodal-icon').textContent=opts.icon||'';
  $id('cmodal-title').textContent=opts.title||'';
  $id('cmodal-sub').textContent=opts.sub||'';
  var inputWrap=$id('cmodal-input-wrap');
  var inp=$id('cmodal-input');
  if(opts.input){
    inputWrap.style.display='block';
    inp.placeholder=opts.placeholder||'';
    inp.value='';
    setTimeout(function(){inp.focus();},120);
  } else {
    inputWrap.style.display='none';
  }
  var okBtn=$id('cmodal-ok');
  okBtn.textContent=opts.okLabel||'تأكيد';
  okBtn.style.background=opts.okColor||'linear-gradient(135deg,var(--acc),var(--acc2))';
  okBtn.style.color=opts.okColor&&opts.okColor.indexOf('red')>=0?'#fff':'#211300';
  bd.style.display='flex';
  // Re-trigger animation
  box.style.animation='none';
  requestAnimationFrame(function(){box.style.animation='';});

  function close(){ bd.style.display='none'; }

  var okHandler=function(){
    if(opts.input){
      var val=inp.value.trim();
      if(!val){inp.style.borderColor='var(--red)';inp.focus();return;}
      close(); opts.onOk&&opts.onOk(val);
    } else {
      close(); opts.onOk&&opts.onOk();
    }
  };
  var cancelHandler=function(){ close(); };

  // Re-wire buttons (remove old listeners)
  var newOk=okBtn.cloneNode(true); okBtn.parentNode.replaceChild(newOk,okBtn);
  var newCancel=$id('cmodal-cancel').cloneNode(true); $id('cmodal-cancel').parentNode.replaceChild(newCancel,$id('cmodal-cancel'));
  $id('cmodal-ok').addEventListener('click',okHandler);
  $id('cmodal-cancel').addEventListener('click',cancelHandler);
  bd.addEventListener('click',function(e){ if(e.target===bd)cancelHandler(); },{once:true});
  // Enter key submits
  inp&&inp.addEventListener('keydown',function(e){ if(e.key==='Enter')okHandler(); });
}
// ── End Custom Modal ─────────────────────────────────────────────
var CALL_WAIT_MS = 90 * 60 * 1000; // 90 minutes in ms
var timerInterval = null;

// Get deadline ISO string ONLY if order is pending and has call attempts
// Returns '' if order is not pending, or has no calls, or deadline already passed long ago
// Parse status_log safely — Supabase sometimes returns it as a JSON string
function parseStatusLog(val){
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

function getCallDeadline(o){
  // Timer only runs for pending orders
  if(!o || o.status !== 'pending') return '';
  if(!Array.isArray(o.call_attempts) || !o.call_attempts.length) return '';
  var last = o.call_attempts[o.call_attempts.length - 1];
  if(!last || !last.iso) return '';
  var deadline = new Date(new Date(last.iso).getTime() + CALL_WAIT_MS);
  return deadline.toISOString();
}

function startTimerTick(){
  if(timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickTimers, 1000);
  tickTimers();
}

function tickTimers(){
  var cells = document.querySelectorAll('.timer-cell[data-deadline]');
  var now = Date.now();
  cells.forEach(function(cell){
    var deadline = cell.getAttribute('data-deadline');
    var row = cell.closest('tr');
    if(!deadline){
      cell.innerHTML = '';
      if(row) row.classList.remove('call-due-row');
      return;
    }
    var remaining = new Date(deadline).getTime() - now;
    if(remaining <= 0){
      // Timer expired — alert the employee to call
      cell.innerHTML = '<span class="call-due">📞 اتصل الآن!</span>';
      if(row) row.classList.add('call-due-row');
    } else {
      // Show countdown — remaining is POSITIVE = time left before next call
      var totalSec = Math.ceil(remaining / 1000);
      var mins = Math.floor(totalSec / 60);
      var secs = totalSec % 60;
      var pct = remaining / CALL_WAIT_MS; // 1.0 = just started, 0.0 = expired
      var color = pct > 0.5 ? 'var(--green)' : pct > 0.2 ? 'var(--ora)' : 'var(--red)';
      cell.innerHTML = '<span class="call-timer" style="color:'+color+'">'
        + mins+'د '+ (secs<10?'0':'')+secs+'ث'
        + '</span>';
      if(row) row.classList.remove('call-due-row');
    }
  });
}
// ── END CALL TIMER ENGINE ────────────────────────────

function renderTable(){
  var st=(cur-1)*PS, pg=fil;   // fil = الصفحة الحالية (جاية من السيرفر مباشرة)
  if(!totalCount){$id('tbody').innerHTML='<div class="ldg">مفيش أوردرات مطابقة للبحث أو الفلتر.</div>';$id('pag').style.display='none';return;}
  if(!pg.length){$id('tbody').innerHTML='<div class="ldg">لا توجد نتائج في هذه الصفحة</div>';}
  // NEW COLUMN ORDER: رقم الطلب - رقم التتبع - اسم العميل - موبايل أساسي - موبايل إضافي - المدينة - العنوان - المنتج - الحالة - التاريخ
  // Default column widths (saved per-user in localStorage)
  var DEFAULT_WIDTHS = {cb:42,uid:100,track:110,name:160,phone:120,alt:120,city:100,addr:240,prod:200,pay:75,status:120,timer:90,date:90};
  var widths;
  try{ widths = JSON.parse(localStorage.getItem('sb_cols')||'null'); }catch(e){ widths = null; }
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
      +'<td class="id">'+noteIcon+esc(fmt(o.order_uid))+cancelBadge+'</td>'
      +'<td class="mn awb-cell">'+(o.tracking_no?esc(o.tracking_no)+'<button class="awb-btn" data-id="'+o.id+'" title="طبع بوليصة بوسطة">🖨️</button>'+(o.awb_print_count>0?'<span class="awb-printed-badge" title="مطبوع '+o.awb_print_count+' مرة'+(o.awb_printed_at?' — آخر طباعة: '+fmtD(o.awb_printed_at):'')+'">✓×'+o.awb_print_count+'</span>':''):'<span class="notrack">في الانتظار</span>')+'</td>'
      +'<td class="nm">'+vipBadge+lockMaybe(fmt(o.customer_name))+rankBadge+'</td>'
      +'<td class="mn">'+lockMaybe(fmt(o.phone))+'</td>'
      +'<td class="mn">'+lockMaybe(fmt(o.alt_phone))+'</td>'
      +'<td>'+lockMaybe(fmt(o.city))+'</td>'
      +'<td class="addr" title="'+addrTitle+'">'+lockMaybe(short(o.address,45))+'</td>'
      +'<td class="pr" title="'+prodTitle+'">'+lockMaybe(short(o.product_name,30))+(!locked&&o['var']&&String(o['var']).trim()?'<span class="var-badge" title="اللون / المقاس: '+esc(String(o['var']))+'">'+esc(short(String(o['var']),18))+'</span>':'')+'</td>'
      +'<td class="pay'+(o.payment_stage==='paymob'?' paid':'')+'">'+(o.payment_stage==='paymob'?'<span class="pay-badge">مدفوع</span>':'<span class="pay-cod">COD</span>')+'</td>'
      +'<td><span class="badge '+statusClass(s)+'"><span class="bdot"></span>'+statusLabel(s)+'</span></td>'
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
        localStorage.setItem('sb_cols',JSON.stringify(widths));
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
  });
}

function updateMasterCb(){
  var cbAll=$id('cb-all');if(!cbAll)return;
  var rows=$id('tbody').querySelectorAll('.cb-row');
  if(!rows.length){cbAll.checked=false;return;}
  var checked=0;rows.forEach(function(cb){if(cb.checked)checked++;});
  cbAll.checked=checked===rows.length;
  cbAll.indeterminate=checked>0&&checked<rows.length;
}

function updateBulkBar(){
  var n=selectedIds.size;
  $id('bulkbar').classList.toggle('show',n>0);
  $id('bcnt').textContent=num(n)+' طلب محدد';
}

// زرار "حدد غير المطبوع" — يظهر بس في فلتر بوسطة/OPERATION ويحدّد كل اللي لسه ماتطبعش
function updateUnprintedBtn(){
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

function pRange(c,t){
  if(t<=7)return Array.from({length:t},function(_,i){return i+1;});
  if(c<=4)return[1,2,3,4,5,'…',t];
  if(c>=t-3)return[1,'…',t-4,t-3,t-2,t-1,t];
  return[1,'…',c-1,c,c+1,'…',t];
}
function goPage(p){var tp=Math.max(1,Math.ceil(totalCount/PS));if(p<1||p>tp)return;cur=p;if(tourActive){renderTable();}else{fetchOrdersPage();}window.scrollTo({top:0,behavior:'smooth'});}

function buildWaUrl(o){
  var phone=normalizePhone(o.phone);
  if(!phone)return null;
  var fn=firstName(o.customer_name);
  var msg='استاذة '+fn+' صباح الخير يافندم .. حاولنا نتصل بحضرتك بخصوص الاوردر بس مكانش في رد .. حضرتك تحبي نشحن الاوردر يافندم ؟\n\nالاوردر : '+(o.product_name||'');
  return 'https://web.whatsapp.com/send?phone=20'+phone+'&text='+encodeURIComponent(msg);
}

function openDetail(id){
  // Guard: when the wallet is depleted, sensitive data is locked across the app.
  if(walletStateCache && walletStateCache.is_depleted && !tourActive){
    toast('بياناتك مقفلة لحد ما تشحن المحفظة','er');
    try{ showPage('billing'); }catch(e){ swallow('openDetail/showPage', e); }
    return;
  }
  if(tourActive){
    // الجولة: الأوردر موجود في بيانات الديمو في الذاكرة
    sel=null;for(var i=0;i<all.length;i++){if(all[i].id===id){sel=all[i];break;}}
    if(!sel)return;
    detailHistory=computeHistoryFromAll(sel);
    renderDetail();
    return;
  }
  if(!sb||!currentTenantId)return;
  // الجدول عنده أعمدة محدودة بس → نجيب الأوردر كامل من السيرفر بالـ id
  sel=null; detailHistory=null;
  $id('dtit').textContent='جاري التحميل...';
  $id('dcnt').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل تفاصيل الطلب...</div>';
  $id('ovl').classList.add('open');
  sb.from('orders').select('*').eq('id',id).eq('tenant_id',currentTenantId).single().then(function(r){
    if(r.error || !r.data){ toast('تعذّر تحميل تفاصيل الطلب','er'); $id('ovl').classList.remove('open'); return; }
    sel=r.data;
    loadDetailHistory(sel, function(){ renderDetail(); });
  });
}

// ملخّص طلبات العميل من الذاكرة (للجولة)
function computeHistoryFromAll(o){
  var p=normalizePhone(o.phone);
  if(!p) return {count:1, delivered:0, cancelled:0};
  var same=all.filter(function(x){return normalizePhone(x.phone)===p;});
  var others=same.filter(function(x){return x.id!==o.id;});
  return { count: same.length,
    delivered: others.filter(function(x){return statusIn(x.status,DELIVERED_STATUSES);}).length,
    cancelled: others.filter(function(x){return statusIn(x.status,CANCELLED_STATUSES);}).length };
}

// ملخّص طلبات العميل من السيرفر بالتليفون (للبانر في شاشة التفاصيل)
function loadDetailHistory(o, cb){
  detailHistory=null;
  if(!sb||!currentTenantId||!o.phone){ cb&&cb(); return; }
  sb.from('orders').select('id,status').eq('tenant_id',currentTenantId).eq('phone',o.phone).then(function(r){
    if(!r.error && r.data){
      var others=r.data.filter(function(x){return x.id!==o.id;});
      detailHistory={ count: r.data.length,
        delivered: others.filter(function(x){return statusIn(x.status,DELIVERED_STATUSES);}).length,
        cancelled: others.filter(function(x){return statusIn(x.status,CANCELLED_STATUSES);}).length };
    }
    cb&&cb();
  });
}

function renderDetail(){
  var o=sel;
  if(!o)return;
  $id('dtit').textContent='طلب #'+(o.order_uid||o.tracking_no||o.id.slice(0,8));
  function dr(k,v){return'<div class="drow"><span class="dkey">'+k+'</span>'+v+'</div>';}

  var calls=Array.isArray(o.call_attempts)?o.call_attempts:[];
  var callsHtml='';
  if(calls.length){
    callsHtml='<div class="calls-list">';
    calls.forEach(function(c,idx){
      callsHtml+='<div class="call-item">'
        +'<span class="call-time">'+esc(c.time||'—')+'</span>'
        +'<div class="call-meta">'
        +'<span class="call-res '+(c.result||'no_answer')+'">'+(CR[c.result]||c.result||'—')+'</span>'
        +(c.note?'<span style="color:var(--txt)">— '+esc(c.note)+'</span>':'')
        +(c.by?'<span class="log-by">👤 '+esc(c.by)+'</span>':'')
        +'<button class="call-del" data-idx="'+idx+'">✕</button>'
        +'</div></div>';
    });
    callsHtml+='</div>';
  }else{
    callsHtml='<div class="calls-empty">لا توجد محاولات اتصال مسجلة</div>';
  }

  var cxBanner='';
  if(o.cancel_requested_at && !o.cancel_resolved_at){
    cxBanner='<div class="cx-banner">'
      +'<div class="cx-banner-txt">'
      +'<b>\u26A0 العميل طلب إلغاء الأوردر</b><br>'
      +'<span>الأوردر ما اتغيّرش ولا اتلغت بوليصة. كلّم العميل وقرّر — ولما تخلص دوس "تم التعامل".</span><br>'
      +'<span class="cx-banner-date">وقت الطلب: '+esc(fmtD(o.cancel_requested_at))+'</span>'
      +'</div>'
      +'<button class="cx-resolve-btn" id="cx-resolve">\u2713 تم التعامل</button>'
      +'</div>';
  } else if(o.cancel_requested_at && o.cancel_resolved_at){
    cxBanner='<div class="cx-banner cx-done">'
      +'<div class="cx-banner-txt"><b>\u2713 طلب إلغاء — تم التعامل معاه</b><br>'
      +'<span class="cx-banner-date">طلب: '+esc(fmtD(o.cancel_requested_at))+' \u00B7 اتقفل: '+esc(fmtD(o.cancel_resolved_at))+'</span></div>'
      +'</div>';
  }

  var waUrl=buildWaUrl(o);
  var hasCustomerNote = o.customer_notes && o.customer_notes.trim();

  // Returning customer detection (من كويري بالتليفون — مش من الذاكرة)
  var custCount=detailHistory?detailHistory.count:1;
  var vipBanner='';
  if(custCount>1){
    var prevDelivered=detailHistory?detailHistory.delivered:0;
    var prevCancelled=detailHistory?detailHistory.cancelled:0;
    vipBanner='<div class="vip-banner">'
      +'<div class="vip-banner-icon">⭐</div>'
      +'<div class="vip-banner-text">'
      +'<div class="vip-banner-title">عميل متكرر — مش أول طلب</div>'
      +'<div class="vip-banner-sub">طلب من قبل '+(custCount-1)+' مرة'
      +(prevDelivered>0?' · <span style="color:var(--teal)">'+prevDelivered+' تم تسليمها</span>':'')
      +(prevCancelled>0?' · <span style="color:var(--red)">'+prevCancelled+' ألغاها</span>':'')
      +'</div>'
      +'</div>'
      +'<button class="vip-show-btn" id="vip-show">إظهار التفاصيل</button>'
      +'<div class="vip-banner-count">×'+custCount+'</div>'
      +'</div>';
  }

  $id('dcnt').innerHTML=
    // WhatsApp button at top
    (waUrl?'<a class="wa-btn" id="wa-btn" href="'+esc(waUrl)+'" target="_blank" rel="noopener"><span class="wa-ico">📩</span> إرسال رسالة واتساب للعميل</a>':'')
    +cxBanner
    +vipBanner

    +'<div class="dsec"><div class="dstt">بيانات العميل</div>'
    +dr('الاسم',copyable(o.customer_name,'الاسم'))
    +(function(){
       if(o.customer_ranking===null||o.customer_ranking===undefined||o.customer_ranking==='')return '';
       var _rk=Number(o.customer_ranking); if(isNaN(_rk))return '';
       var _c=_rk>=RANK_GOOD?'rk-good':(_rk>=RANK_MID?'rk-mid':'rk-bad');
       var _l=_rk>=RANK_GOOD?'جامد':(_rk>=RANK_MID?'متوسط':'زبالة');
       return dr('سمعة العميل (بوسطة)','<span class="rk-badge '+_c+'" style="margin:0">'+_l+'</span> <span class="dval" style="font-family:\'JetBrains Mono\',monospace">'+_rk.toFixed(1)+'%</span>');
     })()
    +dr('الموبايل الأساسي',fieldEditable(o.phone,'الموبايل','phone'))
    +dr('الموبايل الإضافي',copyable(o.alt_phone,'الموبايل'))
    +dr('المدينة','<span class="dval ar">'+esc(fmt(o.city))+'</span>')
    +dr('العنوان',fieldEditable(o.address,'العنوان','address'))
    +'</div>'

    +'<div class="dsec"><div class="dstt">بيانات الطلب</div>'
    +dr('رقم الطلب','<span class="dval">'+esc(fmt(o.order_uid))+'</span>')
    +dr('رقم التتبع','<span class="dval">'+(o.tracking_no?esc(o.tracking_no):'<span style="color:var(--muted);font-style:italic">في انتظار بوسطة</span>')+'</span>')
    +'</div>'

    +'<div class="dsec"><div class="dstt">المنتجات</div>'
    +((o['var']&&String(o['var']).trim())?'<div class="drow"><span class="dkey">اللون / المقاس</span>'+copyable(String(o['var']),'اللون/المقاس')+'</div>':'')
    +'<div class="prod-list" id="prod-list"></div>'
    +'<button class="prod-add-btn" id="prod-add">+ إضافة منتج آخر</button>'
    +'<div class="save-row" style="margin-top:10px"><button class="save-btn" id="save-prod">💾 حفظ المنتجات</button><button class="copy-prod-btn" id="copy-prod">📋 نسخ كل المنتجات</button><span class="save-status" id="prod-status"></span></div>'
    +'</div>'

    +'<div class="dsec"><div class="dstt">تفاصيل إضافية</div>'
    +dr('المبلغ','<span class="dval" style="color:var(--txt);font-weight:600">'+(o.total_cost?num(o.total_cost)+' ج.م':'—')+'</span>')
    +(isAdmin()?dr('تكلفة البضاعة','<span class="dval" style="color:var(--ora);font-weight:800">'+money(orderInventoryCost(o))+'</span>'):'')
    +(isAdmin()?dr('مصدر التكلفة','<span class="dval ar">'+esc(orderInventoryCostSource(o))+'</span>'):'')
    +dr('الدفع','<span class="dval">'+esc(fmt(o.payment_stage))+'</span>')
    +dr('المنصة','<span class="dval">'+esc(fmt(o.platform))+'</span>')
    +dr('الحملة','<span class="dval" style="font-size:.76rem;direction:ltr">'+esc(fmt(o.campaign_name))+'</span>')
    +dr('تاريخ الإنشاء','<span class="dval">'+fmtDT(o.created_at)+'</span>')
    +'</div>'

    // CUSTOMER NOTES (from webhook) — highlighted yellow when present
    +'<div class="dsec"><div class="dstt">📌 ملاحظات العميل (من الويب هوك)</div>'
    +'<div class="notes-box'+(hasCustomerNote?' has-content':' notes-empty')+'">'+(hasCustomerNote?esc(o.customer_notes):'لا توجد ملاحظات من العميل')+'</div>'
    +'</div>'

    // INTERNAL NOTES (between employees) — editable
    +'<div class="dsec"><div class="dstt">💬 ملاحظات داخلية بين الموظفين</div>'
    +'<textarea class="int-notes" id="int-notes" placeholder="اكتب أي ملاحظات للموظفين الآخرين عن هذا الطلب...">'+esc(o.internal_notes||'')+'</textarea>'
    +'<div class="save-row"><button class="save-btn" id="save-notes">💾 حفظ الملاحظات</button><span class="save-status" id="save-status"></span></div>'
    +'</div>'

    +'<div class="dsec"><div class="dstt">📞 محاولات الاتصال ('+calls.length+'/9)</div>'
    +callsHtml
    +'<div class="add-call">'
    +'<select id="ca-res">'
    +'<option value="no_answer">لم يرد</option>'
    +'<option value="busy">مشغول</option>'
    +'<option value="refused">رفض</option>'
    +'<option value="confirmed">أكد</option>'
    +'<option value="callback">يعاود الاتصال</option>'
    +'</select>'
    +'<input type="text" id="ca-note" placeholder="ملاحظة (اختياري)">'
    +'<button id="ca-add">+ إضافة (الآن)</button>'
    +'</div></div>'

    +(function(){
      var slog=parseStatusLog(o.status_log);
      if(!slog.length)return '';
      // Build a chronologically-ordered copy so we can derive each entry's real
      // previous status from the entry before it (the stored "from" is often
      // a system marker like "البوت", not the actual prior status).
      var chrono = slog.slice().sort(function(a,b){
        return new Date(a.at||0) - new Date(b.at||0);
      });
      // System "from" markers that should NOT be displayed as the previous status.
      var SYS_FROM = ['البوت','Bosta API','السيستم','🤖','BOSTA AUTO'];
      function isSysFrom(v){
        if(!v) return true;
        for(var i=0;i<SYS_FROM.length;i++){ if(String(v).indexOf(SYS_FROM[i])>=0) return true; }
        return false;
      }
      // Compute real "from" for each entry = previous entry's "to".
      chrono.forEach(function(e,idx){
        if(idx>0){
          e._realFrom = chrono[idx-1].to;   // continuous chain
        } else {
          // First entry: keep its stored from unless it's a system marker.
          e._realFrom = isSysFrom(e.from) ? 'pending' : e.from;
        }
      });
      var rows='<div class="log-list">';
      chrono.slice().reverse().forEach(function(e){
        // Determine icon based on who made the change
        var byLabel = e.by || '—';
        var byIcon;
        var byClean = byLabel.replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}️ ]+/u, '').trim();
        if(byLabel.indexOf('السكانر') >= 0 || byLabel.indexOf('scanner') >= 0 || byLabel.indexOf('📷') >= 0){
          byIcon = '📷';
          byLabel = byClean || 'السكانر';
        } else if(byLabel.indexOf('واتساب') >= 0 || byLabel.indexOf('whatsapp') >= 0 || byLabel.indexOf('💬') >= 0){
          byIcon = '💬';
          byLabel = byClean || 'واتساب';
        } else if(byLabel.indexOf('البوت') >= 0 || byLabel.indexOf('Bosta API') >= 0 || byLabel.indexOf('السيستم') >= 0 || byLabel.indexOf('🤖') >= 0){
          byIcon = '⚙️';
          byLabel = byClean || 'السيستم';
        } else if(byLabel === 'manual' || byLabel === 'bulk'){
          byIcon = '👤';
        } else {
          byIcon = '👤';
        }
        var fromStatus = e._realFrom;
        rows+='<div class="log-item">'
          +'<span class="badge '+statusClass(fromStatus)+'"><span class="bdot"></span>'+statusLabel(fromStatus)+'</span>'
          +'<span class="log-arrow">←</span>'
          +'<span class="badge '+statusClass(e.to)+'"><span class="bdot"></span>'+statusLabel(e.to)+'</span>'
          +(e.reason?'<span style="color:var(--red);font-size:.76rem">— '+esc(e.reason)+'</span>':'')
          +'<span class="log-by">'+byIcon+' '+esc(byLabel)+'</span>'
          +'<span class="log-time">'+fmtDT(e.at)+'</span>'
          +'</div>';
      });
      rows+='</div>';
      return '<div class="dsec"><div class="dstt">📜 سجل تغييرات الحالة</div>'+rows+'</div>';
    })()
    +'<div class="dsec"><div class="dstt">تغيير الحالة</div>'
    +'<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge '+statusClass(o.status||'pending')+'" style="font-size:.88rem;padding:5px 12px"><span class="bdot"></span>'+statusLabel(o.status||'pending')+'</span>'
    +(o.status_changed_at?'<span style="color:var(--muted);font-size:.78rem">آخر تغيير: '+fmtDT(o.status_changed_at)+'</span>':'')
    +'</div>'
    +(o.status==='cancelled'&&o.cancel_reason?'<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#fecaca;font-size:.85rem"><b>سبب الإلغاء:</b> '+esc(o.cancel_reason)+'</div>':'')
    +'<select class="fsel" id="dsel" style="width:100%">'
    +STATUS_OPTIONS.map(function(s){return'<option value="'+s+'"'+(s===o.status?' selected':'')+'>'+statusLabel(s)+'</option>';}).join('')
    +'</select></div>'

    // 3 main action buttons: تأكيد - بوسطة - إلغاء
    +'<div class="dacts">'
    +'<button class="abtn ok" id="da-ok">✓ تأكيد</button>'
    +'<button class="abtn bs" id="da-bs">📦 بوسطة</button>'
    +'<button class="abtn cn" id="da-cn">✕ إلغاء</button>'
    +'</div>'
    +'<button class="abtn" id="da-up" style="width:100%;margin-top:8px;background:var(--sur);color:var(--txt)">تحديث الحالة المختارة ↑</button>';

  $id('da-ok').addEventListener('click',function(){doUpdate('confirmed');});
  $id('da-bs').addEventListener('click',function(){doUpdate('bosta_assigned');});
  $id('da-cn').addEventListener('click',function(){askCancelReason(function(reason){doUpdate('cancelled',reason);});});
  $id('da-up').addEventListener('click',function(){
    var v=$id('dsel').value;
    if(v==='cancelled'){askCancelReason(function(reason){doUpdate('cancelled',reason);});}
    else doUpdate(v);
  });
  $id('ca-add').addEventListener('click',addCallAttempt);
  $id('save-notes').addEventListener('click',saveInternalNotes);
  // Auto-save internal notes 1.2s after stop typing
  $id('int-notes').addEventListener('input',function(){
    clearTimeout(intNotesTimer);
    $id('save-status').textContent='يتم الحفظ تلقائياً...';
    $id('save-status').className='save-status';
    intNotesTimer=setTimeout(saveInternalNotes,1200);
  });
  $id('dcnt').querySelectorAll('.call-del').forEach(function(b){
    b.addEventListener('click',function(){deleteCallAttempt(parseInt(b.getAttribute('data-idx')));});
  });

  // Render and wire up products editor — load stock first if needed.
  // CRITICAL: must select wholesale_price too. If we don't, and the user
  // then opens Finance, loadStockProductsForCosts will skip its own load
  // (because stockProducts.length > 0) and every COGS lookup returns 0
  // because wholesale_price is undefined on these rows.
  if(!stockProducts || !stockProducts.length){
    sb.from('v_stock_products').select('id,name,current_qty,unit_price,wholesale_price').eq('tenant_id',currentTenantId).eq('active',true).order('current_qty',{ascending:false}).then(function(r){
      if(!r.error && r.data) stockSetProducts(r.data);
      renderProductsEditor(o.product_name||'');
    });
  } else {
    renderProductsEditor(o.product_name||'');
  }
  $id('prod-add').addEventListener('click', addEmptyProductRow);
  $id('save-prod').addEventListener('click',saveProducts);

  // Attach copy handlers for name/phone/address
  attachCopyHandlers();
  // تعديل الموبايل/العنوان + نسخ كل المنتجات بفورمات الأوردر
  attachFieldEditors();
  var _cpb=$id('copy-prod');
  if(_cpb){ _cpb.addEventListener('click',function(){
    var v=(sel['var']&&String(sel['var']).trim())?String(sel['var']).trim():'';
    var items=parseProductItems(sel.product_name||'');
    var txt=items.map(function(it){
      var line=it.name+' (عدد '+(it.qty||1)+')';
      return v?line+' - '+v:line;
    }).join(v?' | ':' - ');
    copyTextToClipboard(txt,'المنتجات');
  }); }

  // Wire up VIP show-history button if present
  var vipBtn=$id('vip-show');
  if(vipBtn){
    vipBtn.addEventListener('click',function(){
      var phone=normalizePhone(o.phone);
      if(!phone){toast('لا يوجد رقم موبايل','er');return;}
      // Close detail and filter table by this phone
      $id('ovl').classList.remove('open');sel=null;
      $id('qinp').value=phone;
      // Clear other filters to ensure all orders show
      $id('fst').value='';$id('fpl').value='';$id('fpy').value='';
      if(window.__syncFilterUI)window.__syncFilterUI();
      doFilter();
      window.scrollTo({top:0,behavior:'smooth'});
      toast('تم عرض كل طلبات العميل ⭐','ok');
    });
  }

  $id('ovl').classList.add('open');
}

function parseProducts(str){
  if(!str)return [''];
  var parts=String(str).split(/\s*[\n]\s*\+\s*|\s*\n\s*/).filter(function(p){return p.trim().length>0;});
  return parts.length?parts:[''];
}

function buildProductOptions(selected){
  // Build <option> list from stockProducts (already loaded when stock page loads)
  // If stock not loaded yet, just return one empty option
  var opts='<option value="">— اكتب يدوياً —</option>';
  if(stockProducts && stockProducts.length){
    stockProducts.forEach(function(p){
      var sel2=(selected && p.name===selected)?'selected':'';
      opts+='<option value="'+esc(p.name)+'" '+sel2+'>'+esc(p.name)+(p.current_qty!==undefined?' ('+num(p.current_qty)+' متاح)':'')+'</option>';
    });
  }
  return opts;
}

function renderProductsEditor(str){
  var products=parseProducts(str);
  var list=$id('prod-list');
  if(!list)return;
  var h='';
  products.forEach(function(p,i){
    // Each product row: stock dropdown + quantity input + manual text override + delete button
    h+='<div class="prod-item" data-idx="'+i+'">'
      +'<select class="prod-select prod-input" data-idx="'+i+'" style="flex:2;min-width:140px;">'+buildProductOptions(p.replace(/\s*\(عدد\s*\d+\)\s*$/, '').trim())+'</select>'
      +'<input type="text" class="prod-qty" data-idx="'+i+'" placeholder="الكمية" style="flex:0 0 70px;min-width:60px;" value="'+(p.match(/\(عدد\s*(\d+)\)/)?p.match(/\(عدد\s*(\d+)\)/)[1]:'1')+'">'
      +(products.length>1?'<button class="prod-del" data-idx="'+i+'" title="حذف">✕</button>':'')
      +'</div>';
  });
  list.innerHTML=h;
  // If a product has a name that's not in stock list → show it as first option
  list.querySelectorAll('.prod-select').forEach(function(sel2,i){
    var rawVal=products[i]||'';
    var rawName=rawVal.replace(/\s*\(عدد\s*\d+\)\s*$/, '').trim();
    // If the name isn't in the dropdown options, add it as a custom option and select it
    var found=false;
    Array.from(sel2.options).forEach(function(o){if(o.value===rawName)found=true;});
    if(rawName && !found){
      var opt=document.createElement('option');
      opt.value=rawName;opt.textContent=rawName+' (مُدخل يدوياً)';opt.selected=true;
      sel2.insertBefore(opt, sel2.options[1]||null);
    }
  });
  list.querySelectorAll('.prod-del').forEach(function(b){
    b.addEventListener('click',function(){
      var prods=collectProducts();
      prods.splice(parseInt(b.getAttribute('data-idx')),1);
      if(!prods.length)prods=[''];
      renderProductsEditor(prods.join('\n+ '));
    });
  });
}

function collectProducts(){
  var list=$id('prod-list');
  if(!list)return[];
  var rows=list.querySelectorAll('.prod-item');
  var arr=[];
  rows.forEach(function(row){
    var sel2=row.querySelector('.prod-select');
    var qtyInp=row.querySelector('.prod-qty');
    var name=(sel2?sel2.value:'').trim();
    var qty=qtyInp?parseInt(qtyInp.value)||1:1;
    if(name){
      arr.push(name+' (عدد '+qty+')'); // ALWAYS include quantity
    }
  });
  return arr;
}

// Add a completely fresh empty row to the product editor
function addEmptyProductRow(){
  var list=$id('prod-list');
  if(!list)return;
  var idx=list.querySelectorAll('.prod-item').length;
  var div=document.createElement('div');
  div.className='prod-item';
  div.setAttribute('data-idx',idx);
  div.innerHTML='<select class="prod-select prod-input" data-idx="'+idx+'" style="flex:2;min-width:140px;">'+buildProductOptions('')+'</select>'
    +'<input type="text" class="prod-qty" data-idx="'+idx+'" placeholder="الكمية" style="flex:0 0 70px;min-width:60px;" value="1">'
    +'<button class="prod-del" data-idx="'+idx+'" title="حذف">✕</button>';
  list.appendChild(div);
  // Wire delete
  div.querySelector('.prod-del').addEventListener('click',function(){
    div.remove();
    // Re-enable delete on first item if now only 1 left
    var remaining=list.querySelectorAll('.prod-item');
    if(remaining.length===1) remaining[0].querySelector('.prod-del') && (remaining[0].querySelector('.prod-del').style.display='none');
  });
  div.querySelector('.prod-select').focus();
  // Show delete button on first row now that there are multiple
  list.querySelectorAll('.prod-item').forEach(function(r){
    var b=r.querySelector('.prod-del');
    if(b)b.style.display='';
  });
}

function saveProducts(){
  if(!ensureTenant())return;
  if(!sel)return;
  var products=collectProducts();
  if(!products.length){toast('لا يمكن حفظ منتجات فارغة','er');return;}
  var combined = products.length===1 ? products[0] : products.join('\n+ ');

  // ─── Smart price update: only adjust by the DIFFERENCE between old and new product lists ───
  // This keeps the original price for any product not found in stock_products.
  function buildPriceMap(list){
    // Returns { "productName|qty": totalContribution } for products we know prices for
    var map = {};
    list.forEach(function(p){
      var match = p.match(/^(.+?)\s*\(عدد\s*(\d+)\)\s*$/);
      var name = match ? match[1].trim() : p.trim();
      var qty  = match ? parseInt(match[2]) : 1;
      var key  = name + '|' + qty;
      var stockItem = (stockProducts||[]).find(function(s){ return s.name === name; });
      if(stockItem && stockItem.unit_price){
        map[key] = (map[key] || 0) + stockItem.unit_price * qty;
      } else {
        map[key] = null; // unknown price — track presence only
      }
    });
    return map;
  }

  // Parse old product list (the one saved in the order before this edit)
  var oldProducts = parseProducts(sel.product_name || '');
  var oldMap = buildPriceMap(oldProducts);
  var newMap = buildPriceMap(products);

  // Calculate delta: sum of (new - old) for items where we have prices
  var delta = 0;
  var hasKnownChange = false;
  // Items added or increased
  Object.keys(newMap).forEach(function(key){
    if(newMap[key] === null) return; // skip unknown-price items
    var oldVal = oldMap[key] !== undefined ? (oldMap[key] || 0) : 0;
    if(oldMap[key] === undefined){
      // Brand new item → add its price
      delta += newMap[key];
      hasKnownChange = true;
    }
  });
  // Items removed
  Object.keys(oldMap).forEach(function(key){
    if(oldMap[key] === null || oldMap[key] === undefined) return;
    if(newMap[key] === undefined){
      // Removed item → subtract its price
      delta -= oldMap[key];
      hasKnownChange = true;
    }
  });

  var currentTotal = parseFloat(sel.total_cost) || 0;
  var newTotal = currentTotal + delta;
  if(newTotal < 0) newTotal = 0;

  var updateData = {product_name: combined};
  if(hasKnownChange) updateData.total_cost = newTotal;

  sb.from('orders').update(updateData).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){$id('prod-status').textContent='خطأ: '+r.error.message;$id('prod-status').className='save-status';return;}
    sel.product_name=combined;
    if(hasKnownChange) sel.total_cost=newTotal;
    for(var i=0;i<all.length;i++){
      if(all[i].id===sel.id){
        all[i].product_name=combined;
        if(hasKnownChange) all[i].total_cost=newTotal;
        break;
      }
    }
    var msg = '✓ تم الحفظ';
    if(hasKnownChange){
      var sign = delta >= 0 ? '+' : '';
      msg += ' — السعر: ' + num(newTotal) + ' ج (' + sign + num(delta) + ' ج)';
    }
    $id('prod-status').textContent = msg;
    $id('prod-status').className='save-status ok';
    setTimeout(function(){if($id('prod-status'))$id('prod-status').textContent='';},3500);
    loadOrdersCards();
    loadBostaInventoryCard();
    doFilter();
  });
}

function saveInternalNotes(){
  if(!ensureTenant())return;
  if(!sel)return;
  var notes=$id('int-notes').value;
  sb.from('orders').update({internal_notes:notes}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){$id('save-status').textContent='خطأ: '+r.error.message;$id('save-status').className='save-status';return;}
    sel.internal_notes=notes;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].internal_notes=notes;break;}}
    $id('save-status').textContent='✓ تم الحفظ';
    $id('save-status').className='save-status ok';
    setTimeout(function(){if($id('save-status'))$id('save-status').textContent='';},2200);
  });
}

function addCallAttempt(){
  if(!ensureTenant())return;
  if(!sel)return;
  var result=$id('ca-res').value;
  var note=$id('ca-note').value.trim();
  // Use exact current time — no datetime input, no timezone conversion needed
  var now = new Date();
  var isoNow = now.toISOString();
  var formatted = now.toLocaleString('ar-EG',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
  var calls=Array.isArray(sel.call_attempts)?sel.call_attempts.slice():[];
  calls.push({time:formatted, iso:isoNow, result:result, note:note, by: currentUser ? currentUser.name : '—'});
  sb.from('orders').update({call_attempts:calls}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    sel.call_attempts=calls;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].call_attempts=calls;break;}}
    toast('تم تسجيل المحاولة ✓','ok');
    renderDetail();
  });
}

function deleteCallAttempt(idx){
  if(!ensureTenant())return;
  if(!sel)return;
  var calls=Array.isArray(sel.call_attempts)?sel.call_attempts.slice():[];
  calls.splice(idx,1);
  sb.from('orders').update({call_attempts:calls}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    sel.call_attempts=calls;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].call_attempts=calls;break;}}
    toast('تم الحذف','ok');
    renderDetail();
  });
}

function doUpdate(ns,cancelReason){
  if(!ensureTenant())return;
  if(!sel)return;
  var id=sel.id;
  var nowISO=new Date().toISOString();
  var oldStatus=sel.status||'pending';
  var log=parseStatusLog(sel.status_log).slice();
  log.push({from:oldStatus,to:ns,at:nowISO,by: currentUser ? currentUser.name : 'manual',reason:cancelReason||null});
  var update={status:ns,status_changed_at:nowISO,status_log:log};
  if(ns==='cancelled'&&cancelReason){update.cancel_reason=cancelReason;}
  sb.from('orders').update(update).eq('id',id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    for(var i=0;i<all.length;i++){if(all[i].id===id){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=log;if(ns==='cancelled'&&cancelReason)all[i].cancel_reason=cancelReason;break;}}
    $id('ovl').classList.remove('open');sel=null;
    toast('تم تحديث الحالة ✓','ok');
    loadOrdersCards();loadBostaInventoryCard();doFilter();
  });
}

function askCancelReason(callback){
  showModal({
    icon:'❌',
    title:'سبب الإلغاء',
    sub:'اكتب سبب إلغاء الطلب عشان يتسجل في اللوج',
    okLabel:'إلغاء الطلب',
    okColor:'linear-gradient(135deg,#ef4444,#dc2626)',
    input:true,
    placeholder:'مثال: العميل رفض الاستلام...',
    onOk:function(val){ callback(val); }
  });
}

function doBulkUpdate(ns){
  if(!ensureTenant())return;
  if(!ns||selectedIds.size===0)return;
  var ids=Array.from(selectedIds);
  var count=ids.length;
  showModal({
    icon: ns==='cancelled'?'❌': ns==='confirmed'?'✅':'🔄',
    title:'تغيير جماعي',
    sub:'سيتم تغيير حالة '+count+' طلب إلى "'+SL[ns]+'"\nمتأكد من التغيير؟',
    okLabel:'تأكيد التغيير',
    okColor: ns==='cancelled'?'linear-gradient(135deg,#ef4444,#dc2626)':'linear-gradient(135deg,var(--acc),var(--acc2))',
    onOk:function(){
  var nowISO=new Date().toISOString();
  var bulkReason = ns==='cancelled' ? 'إلغاء من المدير' : null;

  // نجيب حالة + سجل كل أوردر مختار من السيرفر (all مش متحمّل في صفحة الأوردرات)
  sb.from('orders').select('id,status,status_log').eq('tenant_id',currentTenantId).in('id',ids).then(function(res){
    if(res.error){ toast('خطأ: '+res.error.message,'er'); return; }
    var rows=res.data||[];
    if(!rows.length){ toast('تعذّر تحميل الأوردرات','er'); return; }
    var done=0, errors=0, n=rows.length;
    rows.forEach(function(ord){
      var oldStatus=ord.status||'pending';
      var log=parseStatusLog(ord.status_log).slice();
      log.push({from:oldStatus,to:ns,at:nowISO,by: (currentUser ? currentUser.name : 'bulk') + ' (جماعي)',reason:bulkReason});
      var update={status:ns,status_changed_at:nowISO,status_log:log};
      if(bulkReason)update.cancel_reason=bulkReason;
      sb.from('orders').update(update).eq('id',ord.id).eq('tenant_id',currentTenantId).then(function(r){
        done++;
        if(r.error){errors++;}
        else if(allLoaded){ for(var i=0;i<all.length;i++){if(all[i].id===ord.id){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=log;if(bulkReason)all[i].cancel_reason=bulkReason;break;}} }
        if(done===n){
          selectedIds.clear();updateBulkBar();
          if(errors)toast('تم تحديث '+(n-errors)+' من '+count+' (فيه '+errors+' خطأ)','er');
          else toast('تم تحديث '+count+' طلب ✓','ok');
          loadOrdersCards();loadBostaInventoryCard();doFilter();
        }
      });
    });
  });
    } // end onOk
  }); // end showModal
}

// Login wireup
// نموذج الدخول والخروج
function initLoginForm(){
$id('login-btn').addEventListener('click', doLogin);
$id('login-pass').addEventListener('keydown', function(e){ if(e.key === 'Enter') doLogin(); });
$id('login-user').addEventListener('keydown', function(e){ if(e.key === 'Enter') $id('login-pass').focus(); });
$id('logout-btn').addEventListener('click', doLogout);

// =====================================================
//  SIGNUP — view switching + handler
// =====================================================
}
function showAuthView(name){
  // hide all sboxes inside #login
  var login = document.querySelector('#login .sbox:not(#signup-view):not(#check-email-view)');
  var signup = $id('signup-view');
  var checkEmail = $id('check-email-view');
  if(login)      login.style.display      = (name === 'login')       ? '' : 'none';
  if(signup)     signup.style.display     = (name === 'signup')      ? '' : 'none';
  if(checkEmail) checkEmail.style.display = (name === 'check-email') ? '' : 'none';
}

// التسجيل وتبديل شاشات المصادقة
function initSignupForm(){
$id('show-signup-btn').addEventListener('click', function(){
  $id('signup-err').textContent = '';
  showAuthView('signup');
});
$id('back-to-login-btn').addEventListener('click', function(){
  $id('login-err').textContent = '';
  showAuthView('login');
});
$id('back-from-check-btn').addEventListener('click', function(){
  showAuthView('login');
});
$id('signup-btn').addEventListener('click', doSignup);
// Enter-to-submit on signup form
['signup-store','signup-email','signup-phone','signup-pass'].forEach(function(id){
  var el = $id(id);
  if(!el) return;
  el.addEventListener('keydown', function(e){ if(e.key === 'Enter') doSignup(); });
});
// Restrict phone field to digits
$id('signup-phone').addEventListener('input', function(){
  this.value = (this.value || '').replace(/\D/g, '').slice(0, 11);
});
}

function doSignup(){
  var store = ($id('signup-store').value || '').trim();
  var email = ($id('signup-email').value || '').trim();
  var phone = ($id('signup-phone').value || '').replace(/\D/g, '');
  var pass  = ($id('signup-pass').value  || '');
  var errEl = $id('signup-err');
  errEl.style.color = '#dc2626';
  errEl.textContent = '';

  // Client-side validation
  if(!store || store.length < 2){ errEl.textContent = 'اكتب اسم متجرك'; return; }
  if(store.length > 80){ errEl.textContent = 'اسم المتجر طويل جداً'; return; }
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ errEl.textContent = 'البريد الإلكتروني غير صحيح'; return; }
  if(!phone || phone.length !== 11 || phone.substring(0,2) !== '01'){ errEl.textContent = 'الموبايل لازم ١١ رقم يبدأ بـ 01'; return; }
  if(!pass || pass.length < 6){ errEl.textContent = 'كلمة المرور لازم ٦ أحرف على الأقل'; return; }

  var btn = $id('signup-btn');
  btn.disabled = true;
  btn.textContent = 'جاري الإنشاء...';
  errEl.style.color = '#64748b';
  errEl.textContent = 'بنبعتلك إيميل تأكيد...';

  // Stash store_name + phone in auth metadata so we can read them
  // back after email verification (used by bootstrapTenantIfNeeded).
  sb.auth.signUp({
    email: email,
    password: pass,
    options: {
      data: {
        full_name: store + ' Admin',
        pending_store_name: store,
        pending_phone: phone
      },
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  }).then(function(r){
    btn.disabled = false;
    btn.textContent = 'إنشاء الحساب';
    if(r.error){
      errEl.style.color = '#dc2626';
      errEl.textContent = signupErrorMessage(r.error);
      return;
    }
    // Two cases:
    //  (a) Email confirmation enabled (default): r.data.session is null → show check-email screen
    //  (b) Email confirmation disabled: r.data.session is present → enter dashboard directly
    if(r.data && r.data.session && r.data.user){
      // already signed-in (no email-verification step) → bootstrap straight away
      errEl.textContent = '';
      fetchProfileAndEnter(r.data.user);
    } else {
      $id('check-email-addr').textContent = email;
      showAuthView('check-email');
    }
  }).catch(function(e){
    btn.disabled = false;
    btn.textContent = 'إنشاء الحساب';
    errEl.style.color = '#dc2626';
    errEl.textContent = signupErrorMessage(e);
  });
}

function signupErrorMessage(err){
  var msg = (err && (err.message || err.error_description || err.error)) || '';
  msg = String(msg).toLowerCase();
  if(msg.indexOf('already') >= 0 || msg.indexOf('registered') >= 0 || msg.indexOf('exists') >= 0){
    return 'البريد ده مسجل بالفعل. سجّل دخول أو استخدم بريد تاني.';
  }
  if(msg.indexOf('rate') >= 0 || msg.indexOf('too many') >= 0){
    return 'محاولات كتير في وقت قصير. استنى دقيقة وحاول تاني.';
  }
  if(msg.indexOf('password') >= 0){
    return 'كلمة المرور ضعيفة. ٦ أحرف على الأقل.';
  }
  if(msg.indexOf('email') >= 0){
    return 'البريد الإلكتروني غير صحيح.';
  }
  return 'حصلت مشكلة في إنشاء الحساب. حاول تاني أو تواصل مع الدعم.';
}

// =====================================================
//  Bootstrap tenant on first login after email verification
//  Called when fetchProfileAndEnter finds no user_profiles row.
// =====================================================
function bootstrapTenantIfNeeded(authUser, onDone){
  // Pull a *fresh* user object from the server — the session user we got from
  // getSession()/signInWithPassword() can have stale user_metadata immediately
  // after email verification, so we re-fetch from the auth API to be safe.
  sb.auth.getUser().then(function(ur){
    var freshUser = (ur && ur.data && ur.data.user) || authUser || {};
    var meta = freshUser.user_metadata || (authUser && authUser.user_metadata) || {};
    var storeName = meta.pending_store_name;
    var phone     = meta.pending_phone;
    if(!storeName || !phone){
      // Surface a more diagnostic message — likely a legacy auth user with
      // no signup metadata (e.g. created manually via Supabase dashboard).
      console.warn('bootstrap: missing pending metadata', { meta: meta });
      onDone(new Error('no_pending_signup'));
      return;
    }
    sb.rpc('signup_create_tenant', {
      p_store_name: storeName,
      p_phone:      phone
    }).then(function(r){
      if(r.error){
        console.error('signup_create_tenant RPC error:', r.error);
        onDone(r.error);
        return;
      }
      onDone(null);
    }).catch(function(e){
      console.error('signup_create_tenant call failed:', e);
      onDone(e);
    });
  }).catch(function(e){
    console.error('getUser() failed during bootstrap:', e);
    // fall back to the stale user as a last resort
    var meta = (authUser && authUser.user_metadata) || {};
    var storeName = meta.pending_store_name;
    var phone     = meta.pending_phone;
    if(!storeName || !phone){ onDone(new Error('no_pending_signup')); return; }
    sb.rpc('signup_create_tenant', { p_store_name: storeName, p_phone: phone }).then(function(r){
      if(r.error){ onDone(r.error); return; }
      onDone(null);
    });
  });
}

// زرار التحديث + بحث وفلاتر الأوردرات
function initRefreshAndSearch(){
$id('rbtn').addEventListener('click', function(){
  // Refresh whichever page is currently visible (not just orders).
  // Wallet is refreshed for everyone (admin + employee) because the depletion lock applies to both.
  var active = document.querySelector('.tnav-btn.active');
  var page = active ? active.getAttribute('data-page') : 'orders';
  if(page === 'stock'){
    loadStock();
    loadWalletState();
  } else if(page === 'finance'){
    loadFinance();
    loadWalletState();
  } else if(page === 'billing'){
    loadBilling();
  } else if(page === 'settings'){
    loadSettings();
  } else if(page === 'issues' && typeof loadIssues === 'function'){
    loadIssues();
    loadWalletState();
  } else {
    loadAll(); // orders (and everything it pulls in)
  }
});
$id('qinp').addEventListener('input',function(){clearTimeout(stm);stm=setTimeout(doFilter,240);});
$id('fst').addEventListener('change',doFilter);
$id('fpl').addEventListener('change',doFilter);
$id('fpy').addEventListener('change',doFilter);

// ---- custom animated filter dropdowns: native <select>s stay as the source of truth ----
}
function fdropCloseAll(except){
  document.querySelectorAll('.fdrop.open').forEach(function(w){ if(w!==except) w.classList.remove('open'); });
}
function enhanceFilters(){
  [{id:'fst',ic:'🏷️'},{id:'fpl',ic:'📣'},{id:'fpy',ic:'💳'}].forEach(function(cfg){
    var sel=$id(cfg.id); if(!sel||sel.__enhanced) return; sel.__enhanced=true;
    var wrap=document.createElement('div'); wrap.className='fdrop'; wrap.id=cfg.id+'-wrap';
    sel.parentNode.insertBefore(wrap,sel); wrap.appendChild(sel); sel.classList.add('fdrop-native');
    var btn=document.createElement('button'); btn.type='button'; btn.className='fdrop-btn';
    btn.innerHTML='<span class="fd-ic">'+cfg.ic+'</span><span class="fd-lbl"></span><span class="fd-chev">▾</span>';
    wrap.appendChild(btn);
    var panel=document.createElement('div'); panel.className='fdrop-panel'; wrap.appendChild(panel);
    Array.prototype.forEach.call(sel.options,function(opt){
      var it=document.createElement('button'); it.type='button'; it.className='fdrop-item';
      it.setAttribute('data-value',opt.value); it.appendChild(document.createTextNode(opt.textContent));
      it.addEventListener('click',function(ev){
        ev.stopPropagation();
        if(sel.value!==opt.value){ sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        sync(); wrap.classList.remove('open');
      });
      panel.appendChild(it);
    });
    function sync(){
      var o=sel.options[sel.selectedIndex]||sel.options[0];
      var lbl=wrap.querySelector('.fd-lbl'); if(lbl) lbl.textContent=o?o.textContent:'';
      wrap.classList.toggle('active', sel.value!=='');
      panel.querySelectorAll('.fdrop-item').forEach(function(it){ it.classList.toggle('sel', it.getAttribute('data-value')===sel.value); });
    }
    btn.addEventListener('click',function(ev){
      ev.stopPropagation();
      var willOpen=!wrap.classList.contains('open');
      fdropCloseAll(wrap); wrap.classList.toggle('open',willOpen);
    });
    sel.addEventListener('change',sync);
    sel.__fsync=sync; sync();
  });
}
// القوايم المنسدلة + شريط طلبات الإلغاء
function initFilterDropdowns(){
document.addEventListener('click',function(){ fdropCloseAll(); });
document.addEventListener('keydown',function(e){ if(e.key==='Escape') fdropCloseAll(); });
window.__syncFilterUI=function(){ ['fst','fpl','fpy'].forEach(function(id){ var s=$id(id); if(s&&s.__fsync)s.__fsync(); }); reflectStatusCards(); };
(function(){ var b=$id('cxbar'); if(b) b.addEventListener('click', showCancelRequested); })();
document.addEventListener('click', function(ev){ var t=ev.target; if(t && t.id==='cx-resolve'){ ev.preventDefault(); resolveCancelRequest(); } });
enhanceFilters();
wireBillingEvents();

// ---- clickable status cards: tap a card to filter orders by that status (no-op during the demo/tour) ----
}
function reflectStatusCards(){
  var v=$id('fst')?$id('fst').value:'';
  var map={pending:'s1',confirmed:'s2',delivered:'s3',cancelled:'s4',returned:'s5'};
  ['s0','s1','s2','s3','s4','s5'].forEach(function(sid){
    var el=$id(sid), card=el&&el.closest('.sc');
    if(card) card.classList.toggle('sc-on', map[v]===sid);
  });
}
function wireStatusCards(){
  var map={s0:'',s1:'pending',s2:'confirmed',s3:'delivered',s4:'cancelled',s5:'returned'};
  Object.keys(map).forEach(function(sid){
    var val=map[sid], el=$id(sid); if(!el)return;
    var card=el.closest('.sc'); if(!card||card.__statusWired)return; card.__statusWired=true;
    card.classList.add('sc-clickable');
    card.addEventListener('click',function(e){
      if(e.target.closest('.sc-info'))return;  // keep the info "i" tooltip working
      if(tourActive)return;                    // demo: clicking does nothing
      var fst=$id('fst'); if(!fst)return;
      fst.value=val;
      fst.dispatchEvent(new Event('change',{bubbles:true}));  // runs doFilter + syncs UI + highlights card
      var anchor=$id('fbar'); if(anchor) window.scrollTo({top:Math.max(0,anchor.offsetTop-80),behavior:'smooth'});
    });
  });
}
// كروت الحالة وشريط الفترة والدرج والتحديد الجماعي
function initOrdersUI(){
if($id('fst')) $id('fst').addEventListener('change',reflectStatusCards);
wireStatusCards();

// ---- orders period bar: scope table + top cards to a chosen date range (no-op during the demo) ----
(function(){
  var bar=$id('orders-period-bar'); if(!bar)return;
  bar.querySelectorAll('.pseg-btn').forEach(function(b){
    b.addEventListener('click',function(){ if(tourActive)return; setOrdersPeriod(b.getAttribute('data-period')); });
  });
  var ap=$id('op-apply');
  if(ap) ap.addEventListener('click',function(){
    if(tourActive)return;
    setPeriod(ordersPeriod, 'custom', $id('op-from').value, $id('op-to').value);
    refreshOrdersScope();
  });
  // keep the sliding pill aligned: on resize, when the bar becomes visible (after login), and once now
  window.addEventListener('resize',positionPeriodInd);
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting) positionPeriodInd(); }); }).observe(bar);
  }
  requestAnimationFrame(positionPeriodInd);
  setTimeout(positionPeriodInd,300);
})();
$id('psize').addEventListener('change',function(){PS=parseInt($id('psize').value)||50;localStorage.setItem('sb_ps',PS);cur=1;if(tourActive){doFilter();}else{fetchOrdersPage();}});
$id('xcls').addEventListener('click',function(){$id('ovl').classList.remove('open');sel=null;});
$id('ovl').addEventListener('click',function(e){if(e.target===$id('ovl')){$id('ovl').classList.remove('open');sel=null;}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){$id('ovl').classList.remove('open');sel=null;}});
$id('tdate').textContent=new Date().toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
// ============================================================================
  // AWB Printing — يطبع بوليصة بوسطة عبر Edge Function `bosta-print-awb`
  // ============================================================================
  function _b64ToBlob(base64, mimeType){
    var byteChars = atob(base64);
    var byteArrays = [];
    var sliceSize = 512;
    for(var offset = 0; offset < byteChars.length; offset += sliceSize){
      var slice = byteChars.slice(offset, offset + sliceSize);
      var byteNumbers = new Array(slice.length);
      for(var i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, {type: mimeType});
  }

  async function printAwbForOrders(orderIds, btnEl){
    if(!orderIds || orderIds.length === 0){ toast('اختار أوردرات الأول','er'); return; }
    if(tourActive){ toast('الطباعة مش متاحة في جولة التعريف','er'); return; }
    
    var origText = '';
    if(btnEl){ origText = btnEl.textContent; btnEl.disabled = true; btnEl.textContent = '⏳ جاري الطباعة...'; }
    
    try {
      var sessionResp = await sb.auth.getSession();
      var session = sessionResp && sessionResp.data && sessionResp.data.session;
      if(!session){ toast('لازم تسجل دخول الأول','er'); return; }
      
      var resp = await fetch(SUPABASE_URL + '/functions/v1/bosta-print-awb', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({order_ids: orderIds})
      });
      
      var data = await resp.json();
      
      if(!resp.ok){
        var msg = data.message || data.error || 'فشل طباعة البوليصة';
        if(data.bosta_status === 400 && /final state/i.test(msg)){
          msg = 'مينفعش تطبع بوالص أوردرات مسلّمة أو ملغية';
        }
        toast(msg, 'er');
        return;
      }
      
      if(!data.pdf_base64){ toast('بوسطة ما رجعتش PDF','er'); return; }
      
      var pdfBlob = _b64ToBlob(data.pdf_base64, 'application/pdf');
      var pdfUrl = URL.createObjectURL(pdfBlob);
      
      var win = window.open(pdfUrl, '_blank');
      if(!win){
        toast('السماح بفتح نوافذ جديدة في المتصفح الأول','er');
        // fallback: download
        var a = document.createElement('a');
        a.href = pdfUrl;
        a.download = 'awb-'+Date.now()+'.pdf';
        a.click();
        return;
      }
      
      // Auto-trigger print() لما الـ PDF يتحمل
      win.addEventListener('load', function(){
        setTimeout(function(){ try{ win.print(); }catch(e){ swallow('printAwbForOrders/win.print', e); } }, 600);
      });
      // backup trigger في حالة الـ load event ما اطلقش
      setTimeout(function(){ try{ win.focus(); win.print(); }catch(e){ swallow('printAwbForOrders/win.focus', e); } }, 1500);
      
      if(data.skipped_no_tracking && data.skipped_no_tracking > 0){
        toast('✅ اتطبع '+data.printed_count+' بوليصة ('+data.skipped_no_tracking+' أوردر مفيش فيهم tracking)','ok');
      } else {
        toast('✅ اتطبع '+data.printed_count+' بوليصة','ok');
      }
      
      // امسح الـ blob URL بعد دقيقة (revoke)
      setTimeout(function(){ URL.revokeObjectURL(pdfUrl); }, 60000);
      
      // refresh الأوردرات عشان نشوف awb_printed_at الجديد (لو في UI)
      if(typeof loadOrders === 'function'){ try{ loadOrders(); }catch(e){ swallow('printAwbForOrders/loadOrders', e); } }
      
    } catch(err){
      console.error('AWB print error:', err);
      toast('فشل الاتصال بالخادم: '+(err.message||err),'er');
    } finally {
      if(btnEl){ btnEl.disabled = false; btnEl.textContent = origText || '🖨️ طبع البوالص'; }
    }
  }

  function printSelectedAwb(){
    var ids = Array.from(selectedIds || []);
    if(ids.length === 0){ toast('اختار أوردرات الأول','er'); return; }
    // مفيش filter محلي — الـ Edge Function بتعمل الفلترة من DB مباشرة
    // (الفرونت بيستخدم lazy loading، فالأوردرات مش كلها في الذاكرة دايماً)
    printAwbForOrders(ids, $id('bb-print'));
  }
  // ============================================================================

  $id('bb-ok').addEventListener('click',function(){doBulkUpdate('confirmed');});
$id('bb-bs').addEventListener('click',function(){doBulkUpdate('bosta_assigned');});
$id('bb-cn').addEventListener('click',function(){doBulkUpdate('cancelled');});
$id('bb-sel').addEventListener('change',function(){if(this.value){doBulkUpdate(this.value);this.value='';}});
$id('bclear').addEventListener('click',function(){selectedIds.clear();updateBulkBar();renderTable();});
   $id('bb-print').addEventListener('click', printSelectedAwb);

// ─────────────────────────────────────────────────
// STOCK MANAGEMENT
// ─────────────────────────────────────────────────

// ===== WhatsApp Inbox (مرحلة 1: استقبال + قراءة) =====
}
var waConvos=[], waActiveId=null, waPollTimer=null, waRenderedCount=0;

function waInitials(name,phone){
  var s=(name||'').trim();
  if(s) return s.charAt(0);
  var p=(phone||'').replace(/\D/g,'');
  return p?p.slice(-2):'؟';
}
function waTimeShort(iso){
  if(!iso) return '';
  var d=new Date(iso), now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
  var y=new Date(now); y.setDate(now.getDate()-1);
  if(d.toDateString()===y.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit'});
}

function loadInbox(){
  if(tourActive){ $id('wa-list-body').innerHTML='<div class="wa-empty">التبويب ده بيشتغل بالرسائل الحقيقية بعد ما تخلّص الجولة.</div>'; return; }
  if(!ensureTenant()) return;
  if(inboxVerified === false){ renderInboxLocked(); return; }
  if(inboxVerified === null){
    refreshInboxGate().then(function(ok){ if(!ok){ renderInboxLocked(); } else { loadInbox(); } });
    return;
  }
  waEnsureNotifyPermission();
  waLoadQuickReplies();
  waBuildFilters();
  waFetchConvos(true);
  if(waPollTimer) clearInterval(waPollTimer);
  waPollTimer=setInterval(function(){
    var p=$id('page-inbox');
    if(!p || p.style.display==='none'){ clearInterval(waPollTimer); waPollTimer=null; return; }
    waFetchConvos(false);
    if(waActiveId) waFetchMessages(waActiveId,false,true);
  },20000);
}

function waFetchConvos(showLoading){
  if(!sb||!currentTenantId) return;
  if(showLoading) $id('wa-list-body').innerHTML='<div class="wa-empty">جاري التحميل…</div>';
  sb.from('wa_conversations').select('*').eq('tenant_id',currentTenantId)
    .order('last_message_at',{ascending:false,nullsFirst:false}).limit(200).then(function(r){
      if(r.error){ $id('wa-list-body').innerHTML='<div class="wa-empty">تعذّر تحميل المحادثات</div>'; return; }
      waConvos=r.data||[];
      renderConvos();
    });
}

var waSearchQuery='', waFilter='all';
function waConvMatches(c){
  if(waFilter==='unread' && !((c.unread_count||0)>0)) return false;
  if(waFilter.indexOf('label:')===0){
    var want=waFilter.slice(6);
    if(!(c.labels && c.labels.indexOf(want)>=0)) return false;
  }
  var q=waSearchQuery;
  if(q){
    var name=(c.customer_name||'').toLowerCase();
    var phoneN=normalizePhone(c.customer_phone||c.wa_id||'');
    var qPhone=normalizePhone(q);
    var nameHit=name.indexOf(q)>=0;
    var phoneHit=qPhone && phoneN.indexOf(qPhone)>=0;
    if(!nameHit && !phoneHit) return false;
  }
  return true;
}
function waBuildFilters(){
  var box=$id('wa-filters'); if(!box) return;
  var html='<button class="wa-filter'+(waFilter==='all'?' active':'')+'" data-f="all">الكل</button>'
    +'<button class="wa-filter'+(waFilter==='unread'?' active':'')+'" id="wa-filter-unread" data-f="unread">غير مقروءة</button>';
  for(var i=0;i<WA_LABELS.length;i++){
    var L=WA_LABELS[i]; var fv='label:'+L.k; var on=(waFilter===fv);
    html+='<button class="wa-filter wa-flabel'+(on?' active':'')+'" data-f="'+esc(fv)+'" data-label="'+esc(L.k)+'"'+(on?(' style="background:'+L.c+';border-color:transparent;color:#fff"'):'')+'>'+esc(L.k)+'</button>';
  }
  box.innerHTML=html;
  var chips=box.querySelectorAll('.wa-filter');
  for(var j=0;j<chips.length;j++){ chips[j].addEventListener('click',function(){ waSetFilter(this.getAttribute('data-f')); }); }
}
function waSetFilter(f){
  waFilter=f;
  var chips=document.querySelectorAll('#wa-filters .wa-filter');
  for(var i=0;i<chips.length;i++){
    var fv=chips[i].getAttribute('data-f'); var on=(fv===f);
    chips[i].classList.toggle('active', on);
    var lab=chips[i].getAttribute('data-label');
    if(lab){
      if(on){ chips[i].style.background=waLabelColor(lab); chips[i].style.borderColor='transparent'; chips[i].style.color='#fff'; }
      else { chips[i].style.background=''; chips[i].style.borderColor=''; chips[i].style.color=''; }
    }
  }
  renderConvos();
}

function renderConvos(){
  var body=$id('wa-list-body'); if(!body) return;
  var totalUnread=0, unreadConvs=0, labelCounts={};
  for(var k=0;k<waConvos.length;k++){
    var u=waConvos[k].unread_count||0; totalUnread+=u; if(u>0)unreadConvs++;
    var ls=waConvos[k].labels||[];
    for(var li=0;li<ls.length;li++){ labelCounts[ls[li]]=(labelCounts[ls[li]]||0)+1; }
  }
  $id('wa-list-title').textContent= totalUnread>0 ? ('المحادثات • '+totalUnread+' غير مقروء') : 'المحادثات';
  waSetNavBadge(totalUnread);
  var uf=$id('wa-filter-unread'); if(uf) uf.textContent= unreadConvs>0 ? ('غير مقروءة ('+unreadConvs+')') : 'غير مقروءة';
  var lchips=document.querySelectorAll('#wa-filters .wa-flabel');
  for(var ci=0;ci<lchips.length;ci++){ var lk=lchips[ci].getAttribute('data-label'); var ln=labelCounts[lk]||0; lchips[ci].textContent= ln>0 ? (lk+' ('+ln+')') : lk; }
  if(!waConvos.length){ body.innerHTML='<div class="wa-empty">مفيش محادثات لسه. أول ما عميل يبعتلك رسالة واتساب هتظهر هنا.</div>'; return; }
  var list=[];
  for(var x=0;x<waConvos.length;x++){ if(waConvMatches(waConvos[x])) list.push(waConvos[x]); }
  if(!list.length){
    var emptyMsg='مفيش نتائج للبحث';
    if(waFilter==='unread') emptyMsg='مفيش رسائل غير مقروءة 🎉';
    else if(waFilter.indexOf('label:')===0) emptyMsg='مفيش محادثات بالتصنيف ده';
    body.innerHTML='<div class="wa-empty">'+emptyMsg+'</div>'; return;
  }
  var html='';
  for(var i=0;i<list.length;i++){
    var c=list[i];
    var name=c.customer_name||c.customer_phone||c.wa_id;
    var unread=c.unread_count||0;
    html+='<div class="wa-conv'+(c.id===waActiveId?' active':'')+(unread>0?' has-unread':'')+'" data-id="'+esc(c.id)+'">'
      +'<div class="wa-avatar">'+esc(waInitials(c.customer_name,c.customer_phone||c.wa_id))+'</div>'
      +'<div class="wa-conv-body">'
        +'<div class="wa-conv-top"><span class="wa-conv-name">'+esc(name)+'</span><span class="wa-conv-time">'+esc(waTimeShort(c.last_message_at))+'</span></div>'
        +'<div class="wa-conv-bot"><span class="wa-conv-prev">'+esc(c.last_message_text||'')+'</span>'+(unread>0?'<span class="wa-unread">'+unread+'</span>':'')+'</div>'
        +((c.labels&&c.labels.length)?('<div class="wa-conv-labels">'+c.labels.map(function(l){return '<span class="wa-conv-label" style="background:'+waLabelColor(l)+'">'+esc(l)+'</span>';}).join('')+'</div>'):'')
      +'</div></div>';
  }
  body.innerHTML=html;
  var items=body.querySelectorAll('.wa-conv');
  for(var j=0;j<items.length;j++){ items[j].addEventListener('click',function(){ openConversation(this.getAttribute('data-id')); }); }
  if(waActiveId){ var ac=waConvos.filter(function(x){return x.id===waActiveId;})[0]; if(ac) waUpdateWindow(ac); }
}

function openConversation(id){
  waActiveId=id; waRenderedCount=0;
  var c=waConvos.filter(function(x){return x.id===id;})[0];
  $id('wa-chat-empty').style.display='none';
  $id('wa-chat-inner').style.display='flex';
  $id('wa-wrap').classList.add('show-chat');
  if(c){
    $id('wa-chat-name').textContent=c.customer_name||c.customer_phone||c.wa_id;
    $id('wa-chat-phone').textContent=c.customer_phone||c.wa_id;
    $id('wa-chat-avatar').textContent=waInitials(c.customer_name,c.customer_phone||c.wa_id);
  }
  renderConvos();
  $id('wa-msgs').innerHTML='<div class="wa-empty">جاري تحميل الرسائل…</div>';
  waRenderedState=[];
  waFetchMessages(id,true,false);
  waMarkRead(id);
  waUpdateWindow(c);
  waLoadConvMeta(c);
  waLoadOrders(c);
  waClearImage();
  if($id('wa-input')){ $id('wa-input').value=''; $id('wa-input').style.height='auto'; }
}

function waFetchMessages(convId,scroll,isPoll){
  if(!sb) return;
  sb.from('wa_messages').select('*').eq('conversation_id',convId)
    .order('created_at',{ascending:true}).limit(500).then(function(r){
      if(convId!==waActiveId) return;
      if(r.error){ if(!isPoll)$id('wa-msgs').innerHTML='<div class="wa-empty">تعذّر تحميل الرسائل</div>'; return; }
      var data=r.data||[];
      if(isPoll && data.length===waRenderedCount) return;
      var newArrived = isPoll && data.length>waRenderedCount;
      renderMessages(data, scroll);
      if(newArrived) waMarkRead(convId);
    });
}

function waTicks(status){
  if(status==='read') return '<span class="wa-tick read">✓✓</span>';
  if(status==='delivered') return '<span class="wa-tick">✓✓</span>';
  if(status==='failed') return '<span class="wa-tick fail">!</span>';
  return '<span class="wa-tick">✓</span>'; // sent / غير محدد
}
function waResolveUrls(paths, cb){
  var now=Date.now(), need=[];
  for(var i=0;i<paths.length;i++){ var p=paths[i]; if(p){ var c=waUrlCache[p]; if(!c || c.exp<now) need.push(p); } }
  function out(){ var map={}; for(var k in waUrlCache){ if(waUrlCache[k].exp>=now) map[k]=waUrlCache[k].url; } cb(map); }
  if(!need.length){ out(); return; }
  sb.storage.from('wa-media').createSignedUrls(need,3600).then(function(res){
    if(res && res.data){ for(var x=0;x<res.data.length;x++){ var it=res.data[x]; if(it && it.signedUrl) waUrlCache[it.path]={url:it.signedUrl, exp:now+3000*1000}; } }
    out();
  }).catch(function(){ out(); });
}
function waMsgInner(m, urlMap){
  var side=m.direction==='out'?'out':'in';
  var inner='';
  if(m.media_path && (m.type==='image'||m.type==='sticker')){
    var u=urlMap[m.media_path];
    inner+= u?'<a href="'+esc(u)+'" target="_blank" rel="noopener"><img class="wa-img" src="'+esc(u)+'" loading="lazy"></a>':'<div class="wa-media-fail">📷 تعذّر تحميل الصورة</div>';
    if(m.body) inner+='<div class="wa-cap">'+esc(m.body)+'</div>';
  } else if(m.media_path && (m.type==='voice'||m.type==='audio')){
    var ua=urlMap[m.media_path];
    inner+= ua?'<audio class="wa-audio" controls preload="none" src="'+esc(ua)+'"></audio>':'<div class="wa-media-fail">🎤 تعذّر تحميل الصوت</div>';
  } else if(m.media_path && (m.type==='document'||m.type==='video')){
    var ud=urlMap[m.media_path];
    var label=m.media_filename||(m.type==='video'?'فيديو':'ملف');
    inner+= ud?'<a class="wa-doc" href="'+esc(ud)+'" target="_blank" rel="noopener">📎 '+esc(label)+'</a>':'<div class="wa-media-fail">📎 '+esc(label)+'</div>';
    if(m.body) inner+='<div class="wa-cap">'+esc(m.body)+'</div>';
  } else {
    inner+='<div class="wa-text">'+esc(m.body||'')+'</div>';
  }
  inner+='<div class="wa-msg-time">'+esc(waTimeShort(m.wa_timestamp||m.created_at))+(side==='out'?waTicks(m.status):'')+'</div>';
  return inner;
}
function waScrollBottom(box){ box.scrollTop=box.scrollHeight; setTimeout(function(){ if(box) box.scrollTop=box.scrollHeight; }, 250); }
function renderMessages(msgs,scroll){
  var box=$id('wa-msgs'); if(!box) return;
  if(!msgs.length){ box.innerHTML='<div class="wa-empty">لا توجد رسائل</div>'; waRenderedCount=0; waRenderedState=[]; return; }
  // تحديث تدريجي لو الرسائل المعروضة بادئة (prefix) من القائمة الجديدة → ما نعيدش بناء كل حاجة (يمنع القفز)
  var canInc = waRenderedState.length>0 && box.querySelector('.wa-msg') && msgs.length>=waRenderedState.length;
  if(canInc){ for(var i=0;i<waRenderedState.length;i++){ if(!msgs[i] || msgs[i].id!==waRenderedState[i].id){ canInc=false; break; } } }
  if(canInc){
    // 1) حدّث حالة الرسائل الصادرة في مكانها (✓✓/قراءة) من غير إعادة بناء
    for(var i=0;i<waRenderedState.length;i++){
      if(msgs[i].direction==='out' && msgs[i].status!==waRenderedState[i].status){
        var tEl=box.querySelector('.wa-msg[data-mid="'+msgs[i].id+'"] .wa-msg-time');
        if(tEl) tEl.innerHTML=esc(waTimeShort(msgs[i].wa_timestamp||msgs[i].created_at))+waTicks(msgs[i].status);
      }
    }
    // 2) ضيف الرسائل الجديدة في الآخر بس
    var newMsgs=msgs.slice(waRenderedState.length);
    waRenderedState=msgs.map(function(m){return {id:m.id,status:m.status,direction:m.direction};});
    waRenderedCount=msgs.length;
    if(newMsgs.length){
      var nearBottom=(box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
      var npaths=[]; for(var n=0;n<newMsgs.length;n++){ if(newMsgs[n].media_path) npaths.push(newMsgs[n].media_path); }
      waResolveUrls(npaths, function(urlMap){
        var pend=box.querySelectorAll('.wa-optimistic'); for(var pi=0;pi<pend.length;pi++){ if(pend[pi].parentNode) pend[pi].parentNode.removeChild(pend[pi]); }
        var frag=''; for(var n=0;n<newMsgs.length;n++){ var m=newMsgs[n]; frag+='<div class="wa-msg '+(m.direction==='out'?'out':'in')+'" data-mid="'+esc(m.id)+'">'+waMsgInner(m,urlMap)+'</div>'; }
        box.insertAdjacentHTML('beforeend', frag);
        if(scroll || nearBottom) waScrollBottom(box);
      });
    } else if(scroll){ waScrollBottom(box); }
    return;
  }
  // إعادة بناء كاملة (أول فتح للمحادثة أو تغيّر البنية)
  var paths=[]; for(var i=0;i<msgs.length;i++){ if(msgs[i].media_path) paths.push(msgs[i].media_path); }
  waResolveUrls(paths, function(urlMap){
    var html=''; for(var i=0;i<msgs.length;i++){ var m=msgs[i]; html+='<div class="wa-msg '+(m.direction==='out'?'out':'in')+'" data-mid="'+esc(m.id)+'">'+waMsgInner(m,urlMap)+'</div>'; }
    box.innerHTML=html;
    waRenderedCount=msgs.length;
    waRenderedState=msgs.map(function(m){return {id:m.id,status:m.status,direction:m.direction};});
    waScrollBottom(box);
  });
}

function waMarkRead(convId){
  if(!sb||!currentTenantId) return;
  sb.from('wa_messages').update({is_read:true}).eq('conversation_id',convId).eq('direction','in').eq('is_read',false).then(function(){});
  sb.from('wa_conversations').update({unread_count:0}).eq('id',convId).eq('tenant_id',currentTenantId).then(function(r){
    if(!r||!r.error){ for(var i=0;i<waConvos.length;i++){ if(waConvos[i].id===convId){ waConvos[i].unread_count=0; break; } } renderConvos(); }
  });
}

// ----- إرسال (مرحلة 2) -----
var waPendingImage=null, waPendingDoc=null;

function waUpdateWindow(c){
  var lastIn=(c&&c.last_inbound_at)?new Date(c.last_inbound_at).getTime():0;
  var open=lastIn && (Date.now()-lastIn) < 24*3600*1000;
  var banner=$id('wa-window-closed'), row=$id('wa-compose-row');
  if(banner) banner.style.display=open?'none':'block';
  if(row) row.style.display=open?'flex':'none';
}

function waPickImage(e){
  var f=e.target.files&&e.target.files[0];
  if(!f) return;
  if(!/^image\//.test(f.type)){ toast('الملف لازم يكون صورة','er'); e.target.value=''; return; }
  if(f.size>5*1024*1024){ toast('الصورة كبيرة (الحد 5 ميجا)','er'); e.target.value=''; return; }
  waPendingImage=f; waPendingDoc=null;
  var df=$id('wa-docfile'); if(df) df.value='';
  var prev=$id('wa-attach-preview');
  var url=URL.createObjectURL(f);
  prev.innerHTML='<img src="'+url+'"><span style="flex:1;font-size:.82rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name)+'</span><button class="wa-attach-x" id="wa-attach-x">شيل</button>';
  prev.style.display='flex';
  $id('wa-attach-x').addEventListener('click',waClearImage);
}
function waPickFile(e){
  var f=e.target.files&&e.target.files[0];
  if(!f) return;
  // لو صورة، عاملها معاملة الصور (تظهر inline للعميل)
  if(/^image\//.test(f.type)){
    if(f.size>5*1024*1024){ toast('الصورة كبيرة (الحد 5 ميجا)','er'); e.target.value=''; return; }
    waPendingImage=f; waPendingDoc=null;
    var prevI=$id('wa-attach-preview'); var urlI=URL.createObjectURL(f);
    prevI.innerHTML='<img src="'+urlI+'"><span style="flex:1;font-size:.82rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name)+'</span><button class="wa-attach-x" id="wa-attach-x">شيل</button>';
    prevI.style.display='flex'; $id('wa-attach-x').addEventListener('click',waClearImage);
    return;
  }
  if(f.size>25*1024*1024){ toast('الملف كبير (الحد 25 ميجا)','er'); e.target.value=''; return; }
  waPendingDoc=f; waPendingImage=null;
  var imgf=$id('wa-file'); if(imgf) imgf.value='';
  var prev=$id('wa-attach-preview');
  prev.innerHTML='<span style="font-size:1.4rem">📎</span><span style="flex:1;font-size:.82rem;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name)+'</span><button class="wa-attach-x" id="wa-attach-x">شيل</button>';
  prev.style.display='flex';
  $id('wa-attach-x').addEventListener('click',waClearImage);
}
function waClearImage(){
  waPendingImage=null; waPendingDoc=null;
  var prev=$id('wa-attach-preview'); if(prev){ prev.style.display='none'; prev.innerHTML=''; }
  var f=$id('wa-file'); if(f) f.value='';
  var df=$id('wa-docfile'); if(df) df.value='';
}

function waAppendOptimistic(text,kind,url,docName){
  var box=$id('wa-msgs'); if(!box) return null;
  var empty=box.querySelector('.wa-empty'); if(empty&&empty.parentNode) empty.parentNode.removeChild(empty);
  var div=document.createElement('div');
  div.className='wa-msg out wa-msg-pending wa-optimistic';
  var inner='';
  if(kind==='image'&&url){ inner+='<img class="wa-img" src="'+url+'">'; if(text) inner+='<div class="wa-cap">'+esc(text)+'</div>'; }
  else if(kind==='doc'){ inner+='<span class="wa-doc">📎 '+esc(docName||'ملف')+'</span>'; if(text) inner+='<div class="wa-cap">'+esc(text)+'</div>'; }
  else { inner+='<div class="wa-text">'+esc(text)+'</div>'; }
  inner+='<div class="wa-msg-time">⏳</div>';
  div.innerHTML=inner;
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
  return div;
}

function waSend(){
  if(!waActiveId||!sb) return;
  var input=$id('wa-input');
  var text=(input.value||'').trim();
  if(!waPendingImage && !waPendingDoc && !text) return;
  var convAtSend=waActiveId;
  var imgFile=waPendingImage, docFile=waPendingDoc;
  var kind = imgFile?'image':(docFile?'doc':'text');
  var previewUrl = imgFile?URL.createObjectURL(imgFile):null;
  var docName = docFile?docFile.name:null;
  // فقاعة فورية تظهر في نفس اللحظة
  var bubble=waAppendOptimistic(text,kind,previewUrl,docName);
  // فضّي البوكس على طول
  input.value=''; input.style.height='auto'; waClearImage();
  function fail(code){
    if(bubble&&bubble.parentNode) bubble.parentNode.removeChild(bubble);
    if(code==='window_closed'){ toast('النافذة قفلت — العميل لازم يبعتلك رسالة جديدة','er'); waUpdateWindow(waConvos.filter(function(x){return x.id===convAtSend;})[0]); }
    else if(code==='upload'){ toast('فشل رفع الملف','er'); }
    else { toast('تعذّر الإرسال، حاول تاني','er'); }
    if(text && !$id('wa-input').value) $id('wa-input').value=text;
  }
  function done(res){
    var d=(res&&res.data)?res.data:null; var err=(res&&res.error)?res.error:null;
    if(err||!d||!d.ok){ fail(d&&d.error?d.error:''); return; }
    if(bubble){ var t=bubble.querySelector('.wa-msg-time'); if(t) t.innerHTML=esc(waTimeShort(new Date().toISOString()))+waTicks('sent'); bubble.classList.remove('wa-msg-pending'); }
    waFetchConvos(false);
  }
  if(imgFile){
    var ext=((imgFile.type.split('/')[1])||'jpg').replace('jpeg','jpg');
    var path=currentTenantId+'/'+convAtSend+'/out-'+Date.now()+'.'+ext;
    sb.storage.from('wa-media').upload(path,imgFile,{contentType:imgFile.type,upsert:false}).then(function(up){
      if(up.error){ fail('upload'); return; }
      return sb.functions.invoke('wa-send',{body:{conversation_id:convAtSend,image_path:path,caption:text}}).then(done);
    }).catch(function(){ fail('upload'); });
  } else if(docFile){
    var dext=((docFile.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8))||'bin';
    var dpath=currentTenantId+'/'+convAtSend+'/out-'+Date.now()+'.'+dext;
    sb.storage.from('wa-media').upload(dpath,docFile,{contentType:docFile.type||'application/octet-stream',upsert:false}).then(function(up){
      if(up.error){ fail('upload'); return; }
      return sb.functions.invoke('wa-send',{body:{conversation_id:convAtSend,document_path:dpath,filename:docFile.name,caption:text}}).then(done);
    }).catch(function(){ fail('upload'); });
  } else {
    sb.functions.invoke('wa-send',{body:{conversation_id:convAtSend,text:text}}).then(done).catch(function(){ fail(''); });
  }
}

// ----- realtime + عدّاد التبويب (مرحلة 3) -----
function handleWaRealtime(payload){
  var m=payload.new||{};
  var isUpdate=payload.eventType==='UPDATE';
  var inboxOpen=$id('page-inbox') && $id('page-inbox').style.display!=='none';
  if(inboxOpen){
    if(m.conversation_id && m.conversation_id===waActiveId) waFetchMessages(waActiveId,false,false);
    if(!isUpdate) waFetchConvos(false);
  } else if(!isUpdate && m.direction==='in'){
    waRefreshNavBadge();
  }
  if(!isUpdate && m.direction==='in') waNotify(m);
}
function waEnsureNotifyPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission==='default'){ try{ Notification.requestPermission(); }catch(e){ swallow('waEnsureNotifyPermission/Notification.requestPermission', e); } }
}
function waNotify(m){
  if(!('Notification' in window) || Notification.permission!=='granted') return;
  var inboxOpen=$id('page-inbox') && $id('page-inbox').style.display!=='none';
  var viewing = !document.hidden && inboxOpen && m.conversation_id===waActiveId;
  if(viewing) return;
  var conv=waConvos.filter(function(x){return x.id===m.conversation_id;})[0];
  var who = conv ? (conv.customer_name||conv.customer_phone||conv.wa_id) : 'عميل';
  var preview = m.body || (m.type==='image'?'📷 صورة':((m.type==='voice'||m.type==='audio')?'🎤 رسالة صوتية':(m.type==='document'?'📎 ملف':'رسالة جديدة')));
  try{
    var n=new Notification('💬 رسالة من '+who, { body: preview, tag: m.conversation_id });
    n.onclick=function(){ try{ window.focus(); showPage('inbox'); if(m.conversation_id) openConversation(m.conversation_id); }catch(e){ swallow('waNotify/window.focus', e); } n.close(); };
  }catch(e){ swallow('waNotify', e); }
}

// ----- ردود جاهزة -----
var waQuickReplies=[];
function waLoadQuickReplies(){
  if(!sb||!currentTenantId) return;
  sb.from('wa_quick_replies').select('id,body').eq('tenant_id',currentTenantId).order('sort',{ascending:true}).order('created_at',{ascending:true}).then(function(r){
    if(r.error) return;
    waQuickReplies=r.data||[];
    waRenderQuickReplies();
  });
}
function waRenderQuickReplies(){
  var p=$id('wa-qr-panel'); if(!p) return;
  var html='';
  for(var i=0;i<waQuickReplies.length;i++){
    var q=waQuickReplies[i];
    html+='<span class="wa-qr" data-qid="'+esc(q.id)+'"><span class="wa-qr-txt">'+esc(q.body)+'</span><span class="wa-qr-del" data-del="'+esc(q.id)+'" title="حذف">✕</span></span>';
  }
  if(!waQuickReplies.length) html+='<span class="wa-qr-empty">مفيش ردود جاهزة لسه — اكتب رد واحفظه 👇</span>';
  html+='<button class="wa-qr-add" id="wa-qr-add">＋ احفظ اللي مكتوب</button>';
  p.innerHTML=html;
  var chips=p.querySelectorAll('.wa-qr');
  for(var j=0;j<chips.length;j++){
    chips[j].addEventListener('click',function(e){
      if(e.target && e.target.getAttribute && e.target.getAttribute('data-del')) return;
      var qid=this.getAttribute('data-qid');
      var item=waQuickReplies.filter(function(x){return x.id===qid;})[0];
      if(item){ var inp=$id('wa-input'); if(inp){ inp.value=item.body; inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,120)+'px'; inp.focus(); } }
    });
  }
  var dels=p.querySelectorAll('.wa-qr-del');
  for(var k=0;k<dels.length;k++){
    dels[k].addEventListener('click',function(e){ e.stopPropagation(); waDeleteQuickReply(this.getAttribute('data-del')); });
  }
  var add=$id('wa-qr-add');
  if(add) add.addEventListener('click',waSaveQuickReply);
}
function waSaveQuickReply(){
  var inp=$id('wa-input'); var body=inp?(inp.value||'').trim():'';
  if(!body){ toast('اكتب الرد الأول في الخانة','er'); return; }
  if(!sb||!currentTenantId) return;
  sb.from('wa_quick_replies').insert({tenant_id:currentTenantId,body:body}).select('id,body').single().then(function(r){
    if(r.error){ toast('تعذّر الحفظ','er'); return; }
    waQuickReplies.push(r.data); waRenderQuickReplies(); toast('اتحفظ كرد جاهز ✅','ok');
  });
}
function waDeleteQuickReply(id){
  if(!id||!sb) return;
  sb.from('wa_quick_replies').delete().eq('id',id).then(function(r){
    if(r.error){ toast('تعذّر الحذف','er'); return; }
    waQuickReplies=waQuickReplies.filter(function(x){return x.id!==id;}); waRenderQuickReplies();
  });
}

// ----- تصنيفات وملاحظات المحادثة -----
var WA_LABELS=[
  {k:'مهم',c:'#ef4444'},
  {k:'VIP',c:'#8b5cf6'},
  {k:'شكوى',c:'#f59e0b'},
  {k:'تم الحل',c:'#10b981'},
  {k:'متابعة',c:'#2563eb'}
];
function waLabelColor(k){ for(var i=0;i<WA_LABELS.length;i++){ if(WA_LABELS[i].k===k) return WA_LABELS[i].c; } return '#64748b'; }
function waLoadConvMeta(conv){
  var box=$id('wa-cmeta'); if(!box){ return; }
  if(!conv){ box.style.display='none'; return; }
  box.style.display='block';
  var lp=$id('wa-label-picker'); if(lp) lp.style.display='none';
  var nb=$id('wa-note-box'); if(nb) nb.style.display='none';
  var lbtn=$id('wa-label-btn'); if(lbtn) lbtn.classList.remove('on');
  var nbtn=$id('wa-note-btn'); if(nbtn){ nbtn.classList.remove('on'); nbtn.textContent=(conv.note&&conv.note.trim())?'📝 ملاحظة •':'📝 ملاحظة'; }
  waRenderConvLabels(conv);
  var ni=$id('wa-note-input'); if(ni) ni.value=conv.note||'';
}
function waRenderConvLabels(conv){
  var c=$id('wa-clabels'); if(!c) return;
  var labels=(conv&&conv.labels)||[];
  if(!labels.length){ c.innerHTML='<span style="font-size:.72rem;color:var(--muted)">مفيش تصنيف</span>'; return; }
  var html='';
  for(var i=0;i<labels.length;i++){ html+='<span class="wa-clabel" style="background:'+waLabelColor(labels[i])+'">'+esc(labels[i])+'</span>'; }
  c.innerHTML=html;
}
function waRenderLabelPicker(conv){
  var lp=$id('wa-label-picker'); if(!lp) return;
  var labels=(conv&&conv.labels)||[];
  var html='';
  for(var i=0;i<WA_LABELS.length;i++){
    var L=WA_LABELS[i]; var on=labels.indexOf(L.k)>=0;
    html+='<span class="wa-lp'+(on?' active':'')+'" data-label="'+esc(L.k)+'" style="'+(on?('background:'+L.c+';'):'')+'">'+(on?'✓ ':'')+esc(L.k)+'</span>';
  }
  lp.innerHTML=html;
  var chips=lp.querySelectorAll('.wa-lp');
  for(var j=0;j<chips.length;j++){ chips[j].addEventListener('click',function(){ waToggleLabel(this.getAttribute('data-label')); }); }
}
function waToggleLabel(label){
  var conv=waConvos.filter(function(x){return x.id===waActiveId;})[0];
  if(!conv||!sb) return;
  var labels=(conv.labels||[]).slice();
  var idx=labels.indexOf(label);
  if(idx>=0) labels.splice(idx,1); else labels.push(label);
  conv.labels=labels;
  waRenderConvLabels(conv); waRenderLabelPicker(conv); renderConvos();
  sb.from('wa_conversations').update({labels:labels}).eq('id',conv.id).then(function(r){ if(r.error) toast('تعذّر حفظ التصنيف','er'); });
}
function waSaveNote(){
  var conv=waConvos.filter(function(x){return x.id===waActiveId;})[0];
  if(!conv||!sb) return;
  var ni=$id('wa-note-input'); var val=ni?(ni.value||'').trim():'';
  conv.note=val;
  sb.from('wa_conversations').update({note:val||null}).eq('id',conv.id).then(function(r){
    if(r.error){ toast('تعذّر حفظ الملاحظة','er'); return; }
    toast('اتحفظت الملاحظة ✅','ok');
    var nbtn=$id('wa-note-btn'); if(nbtn) nbtn.textContent=val?'📝 ملاحظة •':'📝 ملاحظة';
  });
}
function waSetNavBadge(n){
  var b=$id('wa-nav-badge'); if(!b) return;
  if(n && n>0){ b.textContent = n>99?'99+':String(n); b.style.display='inline-flex'; }
  else { b.style.display='none'; }
}
function waRefreshNavBadge(){
  if(!sb||!currentTenantId) return;
  sb.from('wa_conversations').select('unread_count').eq('tenant_id',currentTenantId).then(function(r){
    if(r.error) return;
    var total=0; (r.data||[]).forEach(function(c){ total+=(c.unread_count||0); });
    waSetNavBadge(total);
  });
}

// ----- أوردرات العميل جوّه الشات -----
function waDateShort(iso){
  if(!iso) return '';
  try{ return new Date(iso).toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit',year:'2-digit'}); }catch(e){ return ''; }
}
function waLoadOrders(conv){
  var box=$id('wa-orders'), body=$id('wa-orders-body'), title=$id('wa-orders-title');
  if(!box||!body||!conv){ if(box) box.style.display='none'; return; }
  var needle=normalizePhone(conv.customer_phone||conv.wa_id||'');
  if(!needle||!sb||!currentTenantId){ box.style.display='none'; return; }
  box.style.display='block';
  body.innerHTML='<div class="wa-orders-empty">جاري التحميل…</div>';
  if(title) title.textContent='📦 أوردرات العميل';
  sb.from('orders')
    .select('id,order_uid,status,total_cost,city,tracking_no,created_at')
    .eq('tenant_id',currentTenantId)
    .ilike('phone','%'+needle+'%')
    .order('created_at',{ascending:false})
    .limit(25)
    .then(function(r){
      // تجاهل لو المستخدم فتح محادثة تانية في الوقت ده
      if(waActiveId!==conv.id) return;
      if(r.error){ body.innerHTML='<div class="wa-orders-empty">تعذّر تحميل الأوردرات</div>'; return; }
      var rows=r.data||[];
      if(title) title.textContent='📦 أوردرات العميل ('+rows.length+')';
      if(!rows.length){ body.innerHTML='<div class="wa-orders-empty">مفيش أوردرات سابقة بنفس الرقم</div>'; return; }
      var html='';
      for(var i=0;i<rows.length;i++){
        var o=rows[i];
        var meta=[o.city, waDateShort(o.created_at)].filter(Boolean).join(' • ');
        html+='<div class="wa-order" data-oid="'+esc(o.id)+'">'
          +'<span class="badge '+statusClass(o.status)+'"><span class="bdot"></span>'+statusLabel(o.status)+'</span>'
          +(o.total_cost!=null?'<span class="wa-order-amt">'+Math.round(o.total_cost)+' ج</span>':'')
          +(meta?'<span class="wa-order-meta">'+esc(meta)+'</span>':'')
          +(o.tracking_no?'<span class="wa-order-trk">🚚 '+esc(o.tracking_no)+'</span>':'')
          +'</div>';
      }
      body.innerHTML=html;
      var cards=body.querySelectorAll('.wa-order');
      for(var j=0;j<cards.length;j++){
        cards[j].addEventListener('click',function(){ var oid=this.getAttribute('data-oid'); if(oid) openDetail(oid); });
      }
    });
}

function showPage(page){
  // Finance and Issues are admin-only in code as well, not just hidden by CSS.
  if((page==='finance' || page==='issues' || page==='billing' || page==='analytics') && !isAdmin()){
    toast('القسم ده للأدمن فقط','er');
    page='orders';
  }
  $id('page-orders').style.display  = page==='orders'  ? 'block' : 'none';
  $id('page-stock').style.display   = page==='stock'   ? 'block' : 'none';
  $id('page-finance').style.display = page==='finance' ? 'block' : 'none';
  $id('page-billing').style.display = page==='billing' ? 'block' : 'none';
  if($id('page-settings'))$id('page-settings').style.display = page==='settings' ? 'block' : 'none';
  if($id('page-issues'))$id('page-issues').style.display = page==='issues' ? 'block' : 'none';
  if($id('page-analytics'))$id('page-analytics').style.display = page==='analytics' ? 'block' : 'none';
  if($id('page-inbox'))$id('page-inbox').style.display = page==='inbox' ? 'block' : 'none';
  document.querySelectorAll('.tnav-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-page')===page);
  });
  if(page==='stock')loadStock();
  if(page==='finance')loadFinance();
  if(page==='billing')loadBilling();
  if(page==='settings')loadSettings();
  if(page==='issues')loadIssues();
  if(page==='analytics')loadAnalytics();
  if(page==='inbox')loadInbox();
}

function loadStock(){
  // During the guided tour, never hit Supabase — keep the injected demo data
  // so the cards/products/movements actually show something to learn from.
  if(tourActive){
    if(!stockProducts || !stockProducts.length) stockProducts = tourDemoStock();
    if(!stockMovements || !stockMovements.length) stockMovements = tourDemoMovements();
    updateStockStats();
    renderProducts();
    renderMovements();
    return;
  }
  if(!ensureTenant())return;
  $id('prod-tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل المنتجات...</div>';
  $id('mov-tbody').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل الحركات...</div>';

  // v_stock_products بيحجب wholesale_price عن غير الأدمن على مستوى السيرفر —
  // مش محتاجين نفلتر الأعمدة من هنا تاني.
  sb.from('v_stock_products').select('*').eq('tenant_id',currentTenantId).order('current_qty',{ascending:false}).then(function(r){
    if(r.error){toast('خطأ في المنتجات: '+r.error.message,'er');return;}
    stockProducts=r.data||[];
    updateStockStats();
    loadBostaInventoryCard();
    renderProducts();
    if(stockMovements && stockMovements.length)renderMovements();
  });
  sb.from('stock_movements').select('*').eq('tenant_id',currentTenantId).order('created_at',{ascending:false}).limit(500).then(function(r){
    if(r.error){return;}
    stockMovements=r.data||[];
    renderMovements();
  });
}

function updateStockStats(){
  $id('st-products').textContent=num(stockProducts.length);
  var totalQty=stockProducts.reduce(function(s,p){return s+(p.current_qty||0);},0);
  $id('st-qty').textContent=num(totalQty);
  var totalVal=stockProducts.reduce(function(s,p){return s+((p.current_qty||0)*(p.wholesale_price||0));},0);
  $id('st-value').textContent=num(totalVal)+' ج';
  var empty=stockProducts.filter(function(p){return (p.current_qty||0)<=0;}).length;
  $id('st-empty').textContent=num(empty);
}

function renderProducts(){
  var q=($id('prod-search').value||'').trim().toLowerCase();
  var list=stockProducts.filter(function(p){return !q||(p.name||'').toLowerCase().indexOf(q)>=0;});
  $id('prod-count').textContent=list.length!==stockProducts.length?num(list.length)+' نتيجة':num(stockProducts.length)+' منتج';

  if(!list.length){$id('prod-tbody').innerHTML='<div class="ldg">لا توجد منتجات</div>';return;}

  var isAdmin = currentRole === 'admin';
  var h='<table><thead><tr>'
    +'<th>اسم المنتج</th>'
    +'<th>المخزون</th>'
    +(isAdmin?'<th>سعر الجملة</th>':'')
    +'<th>سعر القطعة</th>'
    +(isAdmin?'<th>القيمة الإجمالية</th>':'')
    +(isAdmin?'<th></th>':'')
    +'</tr></thead><tbody>';
  list.forEach(function(p){
    var qty=p.current_qty||0;
    var qtyClass=qty<=0?'zero':qty<10?'low':'ok';
    var val=qty*(p.wholesale_price||0);
    h+='<tr>'
      +'<td class="nm">'+esc(p.name)+'</td>'
      +'<td><span class="qty-cell '+qtyClass+'">'+num(qty)+'</span></td>'
      +(isAdmin?'<td class="price-cell">'+(p.wholesale_price?num(p.wholesale_price)+' ج':'—')+'</td>':'')
      +'<td class="price-cell">'+(p.unit_price?num(p.unit_price)+' ج':'—')+'</td>'
      +(isAdmin?'<td class="price-cell">'+num(val)+' ج</td>':'')
      +(isAdmin?'<td><button class="prod-edit-btn" data-id="'+p.id+'">✏️ تعديل</button></td>':'')
      +'</tr>';
  });
  h+='</tbody></table>';
  $id('prod-tbody').innerHTML=h;
  $id('prod-tbody').querySelectorAll('.prod-edit-btn').forEach(function(b){
    b.addEventListener('click',function(){openProductEditor(b.getAttribute('data-id'));});
  });
}

function renderMovements(){
  var q=($id('mov-search').value||'').trim().toLowerCase();
  var typeFilter=$id('mov-type').value;
  var list=stockMovements.filter(function(m){
    if(typeFilter&&m.movement_type!==typeFilter)return false;
    if(q){
      var h=[m.product_name,m.tracking_no,m.notes].filter(Boolean).join(' ').toLowerCase();
      if(h.indexOf(q)<0)return false;
    }
    return true;
  });
  $id('mov-count').textContent=list.length!==stockMovements.length?num(list.length)+' نتيجة':num(stockMovements.length)+' حركة';

  if(!list.length){$id('mov-tbody').innerHTML='<div class="ldg">لا توجد حركات</div>';return;}

  var adminView=isAdmin();
  var h='<table><thead><tr>'
    +'<th>التاريخ</th>'
    +'<th>المنتج</th>'
    +(adminView?'<th>سعر الجملة</th>':'')
    +'<th>دخول</th>'
    +'<th>خروج</th>'
    +'<th>رقم التتبع</th>'
    +'<th>ملاحظات</th>'
    +'</tr></thead><tbody>';
  list.forEach(function(m){
    var wholesale=movementWholesalePrice(m);
    var wholesaleHtml=wholesale>0
      ? '<span class="movement-cost ok">'+num(wholesale)+' ج</span>'
      : '<span class="movement-cost zero" title="سعر الجملة غير مسجل أو صفر — راجع stock_products.wholesale_price">⚠️ 0 ج</span>';
    h+='<tr>'
      +'<td class="mn">'+fmtMovementDate(m.movement_date,m.created_at)+'</td>'
      +'<td class="nm">'+esc(m.product_name)+'</td>'
      +(adminView?'<td>'+wholesaleHtml+'</td>':'')
      +'<td>'+(m.qty_in?'<span class="mov-in">+'+num(m.qty_in)+'</span>':'—')+'</td>'
      +'<td>'+(m.qty_out?'<span class="mov-out">-'+num(m.qty_out)+'</span>':'—')+'</td>'
      +'<td class="mn">'+esc(fmt(m.tracking_no))+'</td>'
      +'<td class="pr">'+esc(fmt(m.notes))+'</td>'
      +'</tr>';
  });
  h+='</tbody></table>';
  $id('mov-tbody').innerHTML=h;
}


function normalizeProductName(n){return String(n||'غير محدد').trim()||'غير محدد';}
function toLatinDigits(v){
  var map={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
  return String(v||'').replace(/[٠-٩۰-۹]/g,function(d){return map[d]||d;});
}
function cleanProductName(part){
  return normalizeProductName(toLatinDigits(part)
    .replace(/\([^)]*(?:عدد|العدد|qty|quantity|x|×)[^)]*\)/ig,' ')
    .replace(/\[[^\]]*(?:عدد|العدد|qty|quantity|x|×)[^\]]*\]/ig,' ')
    .replace(/(?:عدد|العدد|qty|quantity)\s*[:：-]?\s*\d+/ig,' ')
    .replace(/(?:x|×)\s*\d+/ig,' ')
    .replace(/\d+\s*(?:قطعة|قطع|pcs?)/ig,' ')
    .replace(/[()\[\]{}]/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim());
}
function extractProductQty(part){
  var t=toLatinDigits(part);
  var m=t.match(/(?:عدد|العدد|qty|quantity)\s*[:：-]?\s*(\d+)/i) || t.match(/(?:x|×)\s*(\d+)/i) || t.match(/\b(\d+)\s*(?:قطعة|قطع|pcs?)\b/i);
  var q=m?parseInt(m[1],10):1;
  return q>0?q:1;
}
function parseProductItems(raw){
  raw=normalizeProductName(raw);
  var parts=raw.split(/\s*\+\s*|\n|،|,/).map(function(x){return x.trim();}).filter(Boolean);
  if(!parts.length)parts=[raw];
  var merged={};
  parts.forEach(function(part){
    var qty=extractProductQty(part);
    var name=cleanProductName(part);
    if(!name||name==='غير محدد')return;
    var key=name.toLowerCase();
    if(!merged[key])merged[key]={name:name,qty:0};
    merged[key].qty+=qty;
  });
  var out=Object.keys(merged).map(function(k){return merged[k];});
  return out.length?out:[{name:raw,qty:1}];
}
// Track items we couldn't match to stock during the last finance render.
// Used by the UI to show a warning banner with the offending product names.
var unmatchedCogsItems = [];

// Strip ALL whitespace + lowercase — for substring containment checks
function nameKey(s){ return String(s||'').replace(/\s+/g,'').toLowerCase(); }
// Strip Arabic 'ال' definite article prefix from each word — helps match
// "منظم المطبخ" with "منظم مطبخ" (same product, different grammar)
function stripAlPrefix(token){ return token.replace(/^ال/,''); }
// Sort tokens alphabetically (after stripping 'ال') — handles "different word order"
function tokenSortKey(s){
  return String(s||'').toLowerCase().split(/\s+/).filter(Boolean).map(stripAlPrefix).sort().join(' ');
}

function productCostByName(name){
  var raw = normalizeProductName(name);
  var nn  = raw.toLowerCase();
  var nnKey = nameKey(raw);
  var nnTokens = tokenSortKey(raw);

  // Tier 1 — exact (current behavior, fastest path)
  for(var i=0;i<stockProducts.length;i++){
    if(normalizeProductName(stockProducts[i].name).toLowerCase()===nn){
      return Number(stockProducts[i].wholesale_price||0)||0;
    }
  }
  // Tier 2 — bi-directional substring containment
  // Handles BOTH cases: order has extra words, OR stock name has extra words.
  // We pick the LONGEST matching stock name to avoid greedy false positives.
  var bestSubstr = null, bestSubstrLen = 0;
  for(var j=0;j<stockProducts.length;j++){
    var sName = normalizeProductName(stockProducts[j].name);
    var sKey = nameKey(sName);
    if(sKey.length < 8) continue; // too short → too risky for substring matches
    var hit = (nnKey.indexOf(sKey) !== -1) || (sKey.indexOf(nnKey) !== -1 && nnKey.length >= 8);
    if(hit && sKey.length > bestSubstrLen){
      bestSubstr = stockProducts[j]; bestSubstrLen = sKey.length;
    }
  }
  if(bestSubstr) return Number(bestSubstr.wholesale_price||0)||0;

  // Tier 3 — token-sort (with 'ال' stripped) — same words any order, with/without definite article
  // Handles: "ترولي ايكيا 3 دور" ≡ "ترولي 3 دور ايكيا"
  //          "منظم مطبخ متكامل" ≡ "منظم المطبخ المتكامل"
  for(var k=0;k<stockProducts.length;k++){
    if(tokenSortKey(stockProducts[k].name)===nnTokens){
      return Number(stockProducts[k].wholesale_price||0)||0;
    }
  }
  // No match → record diagnostic and return 0
  if(unmatchedCogsItems.indexOf(raw) === -1) unmatchedCogsItems.push(raw);
  return 0;
}

function movementWholesalePrice(m){
  if(!m)return 0;
  for(var i=0;i<stockProducts.length;i++){
    var p=stockProducts[i];
    if(m.product_id && p.id===m.product_id)return Number(p.wholesale_price||0)||0;
  }
  return productCostByName(m.product_name);
}
function buildProductPerformance(){
  var map={};
  ordersInRange(getAnalyticsRange()).forEach(function(o){
    var items=parseProductItems(o.product_name);
    var totalQty=items.reduce(function(s,it){return s+(it.qty||1);},0)||1;
    var isDelivered=statusIn(o.status,DELIVERED_STATUSES);
    var isReturned=statusIn(o.status,RETURNED_STATUSES);
    var isFailed=(normStatus(o.status)==='failed');
    var isPending=statusIn(o.status,['pending']);
    var isPositive=statusIn(o.status,BOSTA_POSITIVE_STATUSES);
    items.forEach(function(it){
      var name=it.name, qty=it.qty||1;
      if(!map[name])map[name]={name:name,orders:0,processed:0,qty:0,revenue:0,delivered:0,deliveredQty:0,deliveredRevenue:0,confirmed:0,cancelled:0,returned:0,failed:0,paymob:0,cost:0,profit:0};
      var r=map[name];
      var share=val(o)*(qty/totalQty);
      r.orders++;
      r.qty+=qty;
      r.revenue+=share;
      if(!isPending)r.processed++;                                  // اتعامل معاه (خرج من Pending)
      if(isDelivered){r.delivered++;r.deliveredQty+=qty;r.deliveredRevenue+=share;}
      if(isPositive)r.confirmed++;                                  // دخل رحلة الشحن
      if(statusIn(o.status,CANCELLED_STATUSES))r.cancelled++;
      if(isReturned)r.returned++;
      if(isFailed)r.failed++;
      if(o.payment_stage==='paymob')r.paymob++;
    });
  });
  return Object.keys(map).map(function(k){
    var r=map[k], c=productCostByName(r.name);
    // الربح على الأوردرات المسلَّمة فقط (محقَّق) — زي منطق الماليات، قبل الشحن والمصاريف
    r.cost=c*r.deliveredQty;
    r.profit=c?(r.deliveredRevenue-r.cost):null;
    // نسبة التأكيد = الإيجابي ÷ اللي اتعامل معاه (يستبعد Pending) — نفس كروت اللوحة
    r.confirmRate=r.processed?(r.confirmed/r.processed*100):null;
    // التسليم/المرتجع = المسلَّم ÷ (المسلَّم + المرتجع) — نفس كروت اللوحة. الفاشل مش بيدخل لأنه ما وصلش لمرحلة شحن نهائية
    var finished=r.delivered+r.returned;
    r.deliveryRate=finished?(r.delivered/finished*100):null;
    r.returnRate=finished?(r.returned/finished*100):null;
    return r;
  }).sort(function(a,b){return b.revenue-a.revenue;});
}

function renderProductPerformance(){
  var q=($id('perf-search')?($id('perf-search').value||'').trim().toLowerCase():'');
  var data=buildProductPerformance();
  var list=data.filter(function(p){return !q||p.name.toLowerCase().indexOf(q)>=0;});
  $id('pf-products').textContent=num(data.length);
  $id('pf-top-rev').textContent=data[0]?short(data[0].name,18):'—';
  var bestDel=data.slice().sort(function(a,b){return b.deliveryRate-a.deliveryRate||b.orders-a.orders;})[0];
  var worstRet=data.slice().sort(function(a,b){return b.returnRate-a.returnRate||b.orders-a.orders;})[0];
  $id('pf-top-del').textContent=bestDel?short(bestDel.name,18):'—';
  $id('pf-top-ret').textContent=worstRet?short(worstRet.name,18):'—';
  $id('perf-count').textContent=list.length!==data.length?num(list.length)+' نتيجة':num(data.length)+' منتج';
  if(!list.length){$id('perf-tbody').innerHTML='<div class="ldg">لا يوجد أداء منتجات حتى الآن</div>';return;}
  var adminView = isAdmin();
  function pct(x){return x==null?'—':x.toFixed(0)+'%';}
  var h='<table><thead><tr>'
    +'<th>المنتج</th><th>طلبات</th><th>قطع</th>'
    +'<th title="قيمة كل الأوردرات في الفترة بأي حالة — مش المتحصل فعلاً">Revenue تقديري</th>'
    +'<th title="نسبة التأكيد = اللي دخل رحلة الشحن ÷ اللي اتعامل معاه (يستبعد Pending) — نفس كروت اللوحة">مؤكد/شحن</th>'
    +'<th title="نسبة التسليم = المسلَّم ÷ (المسلَّم + المرتجع) — نفس كروت اللوحة. الفاشل مش بيدخل لأنه ما وصلش لمرحلة شحن نهائية">تسليم</th>'
    +'<th>إلغاء</th>'
    +'<th title="نسبة المرتجع = المرتجع ÷ (المسلَّم + المرتجع). الفاشل مش بيدخل لأنه ما وصلش لمرحلة شحن نهائية">مرتجع/فشل</th>'
    +'<th>Paymob</th>'
    +(adminView?'<th title="ربح تقديري على الأوردرات المسلَّمة فقط (إيراد المسلَّم − تكلفة القطع المسلَّمة)، قبل الشحن والمصاريف">ربح المنتج</th>':'')
    +'</tr></thead><tbody>';
  list.forEach(function(p){
    h+='<tr>'
      +'<td class="nm" title="'+esc(p.name)+'">'+esc(short(p.name,42))+'</td>'
      +'<td class="mn">'+num(p.orders)+'</td>'
      +'<td class="mn">'+num(p.qty)+'</td>'
      +'<td class="price-cell">'+money(p.revenue)+'</td>'
      +'<td><span class="badge confirmed"><span class="bdot"></span>'+pct(p.confirmRate)+'</span></td>'
      +'<td><span class="badge delivered"><span class="bdot"></span>'+pct(p.deliveryRate)+'</span></td>'
      +'<td class="mn">'+num(p.cancelled)+'</td>'
      +'<td><span class="badge returned"><span class="bdot"></span>'+pct(p.returnRate)+'</span></td>'
      +'<td class="mn">'+num(p.paymob)+'</td>'
      +(adminView?'<td class="price-cell">'+(p.profit===null?'—':money(p.profit))+'</td>':'')
      +'</tr>';
  });
  h+='</tbody></table>';
  $id('perf-tbody').innerHTML=h;
}

// ════════════════ PERFORMANCE ANALYTICS PAGE ════════════════
var analyticsCurrentTab = 'products';
var analyticsPeriod = { type:'month', from:null, to:null };
function getAnalyticsRange(){
  var now=new Date(), from, to, t=analyticsPeriod.type;
  if(t==='last3'){ from=new Date(now.getFullYear(),now.getMonth(),now.getDate()-2); to=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1); }
  else if(t==='last30'){ from=new Date(now.getFullYear(),now.getMonth(),now.getDate()-29); to=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1); }
  else if(t==='all'){ from=new Date(2020,0,1); to=new Date(now.getFullYear()+1,0,1); }
  else { from=new Date(now.getFullYear(),now.getMonth(),1); to=new Date(now.getFullYear(),now.getMonth()+1,1); }
  return { from:from, to:to };
}
function renderAnalyticsActive(){
  if(analyticsCurrentTab==='products') renderProductPerformance();
  else if(analyticsCurrentTab==='platforms') renderFinancePlatforms();
  // 'employees' is a static placeholder (under construction)
}
function loadAnalytics(){
  if(!isAdmin()) return;
  if(tourActive){ renderAnalyticsActive(); return; }
  if(!ensureTenant()) return;
  // الإحصائيات بتحسب على كل الفترة → نحمّل الأوردرات للذاكرة هنا (مرة واحدة)
  ensureAllLoaded(function(){
    loadStockProductsForCosts(function(){ renderAnalyticsActive(); });
  });
}

function openProductEditor(id){
  if(!requireAdmin())return;
  if(!ensureTenant())return;
  var p=null;
  if(id){for(var i=0;i<stockProducts.length;i++){if(stockProducts[i].id===id){p=stockProducts[i];break;}}}
  var isNew=!p;
  p=p||{name:'',current_qty:0,wholesale_price:0,unit_price:0};

  $id('dtit').textContent=isNew?'إضافة منتج جديد':'تعديل المنتج';
  $id('dcnt').innerHTML='<div class="dsec">'
    +'<label class="slbl" style="text-align:right;display:block">اسم المنتج</label>'
    +'<input class="sinp" id="pe-name" type="text" value="'+esc(p.name||'')+'" style="direction:rtl;text-align:right">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">'+(isNew?'الكمية الافتتاحية':'المخزون الحالي')+'</label>'
    +'<input class="sinp" id="pe-qty" type="number" value="'+(p.current_qty||0)+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">سعر الجملة (للقطعة الواحدة)</label>'
    +'<input class="sinp" id="pe-wholesale" type="number" step="0.01" value="'+(p.wholesale_price||0)+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">سعر البيع للقطعة</label>'
    +'<input class="sinp" id="pe-unit" type="number" step="0.01" value="'+(p.unit_price||0)+'">'
    +'</div>'
    +'<div class="dacts">'
    +(isNew?'':'<button class="abtn cn" id="pe-del">🗑️ حذف</button>')
    +'<button class="abtn ok" id="pe-save">💾 حفظ</button>'
    +'</div>';

  $id('pe-save').addEventListener('click',function(){
    var data={
      tenant_id:currentTenantId,
      name:$id('pe-name').value.trim(),
      current_qty:parseInt($id('pe-qty').value)||0,
      wholesale_price:parseFloat($id('pe-wholesale').value)||0,
      unit_price:parseFloat($id('pe-unit').value)||0
    };
    if(!data.name){toast('اسم المنتج مطلوب','er');return;}
    var op = isNew ? sb.from('stock_products').insert(data) : sb.from('stock_products').update(data).eq('id',p.id).eq('tenant_id',currentTenantId);
    op.then(function(r){
      if(r.error){toast('خطأ: '+r.error.message,'er');return;}
      toast(isNew?'تم إضافة المنتج ✓':'تم تحديث المنتج ✓','ok');
      $id('ovl').classList.remove('open');
      loadStock();
    });
  });

  if(!isNew){
    $id('pe-del').addEventListener('click',function(){
      if(!confirm('حذف المنتج "'+p.name+'"؟ هتُحذف كل بياناته.'))return;
      sb.from('stock_products').delete().eq('id',p.id).eq('tenant_id',currentTenantId).then(function(r){
        if(r.error){toast('خطأ: '+r.error.message,'er');return;}
        toast('تم الحذف','ok');
        $id('ovl').classList.remove('open');
        loadStock();
      });
    });
  }

  $id('ovl').classList.add('open');
}

function openMovementEditor(){
  if(!requireAdmin())return;
  if(!ensureTenant())return;
  $id('dtit').textContent='تسجيل حركة مخزون';
  var prodOptions=stockProducts.map(function(p){return '<option value="'+p.id+'" data-name="'+esc(p.name)+'">'+esc(p.name)+' (متاح: '+(p.current_qty||0)+')</option>';}).join('');
  var _nowDate=new Date();
  var nowValue=_nowDate.getFullYear()+'-'+pad2(_nowDate.getMonth()+1)+'-'+pad2(_nowDate.getDate());
  $id('dcnt').innerHTML='<div class="dsec">'
    +'<label class="slbl" style="text-align:right;display:block">المنتج</label>'
    +'<select class="fsel" id="me-prod" style="width:100%"><option value="">اختر المنتج...</option>'+prodOptions+'</select>'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">نوع الحركة</label>'
    +'<select class="fsel" id="me-type" style="width:100%"><option value="in">دخول (إضافة للمخزن)</option><option value="out">خروج (خصم من المخزن)</option></select>'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">الكمية</label>'
    +'<input class="sinp" id="me-qty" type="number" value="1" min="1">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">التاريخ</label>'
    +'<input class="sinp" id="me-date" type="date" value="'+nowValue+'">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">رقم التتبع (اختياري)</label>'
    +'<input class="sinp" id="me-uid" type="text" placeholder="رقم التتبع إذا كانت الحركة مرتبطة بشحنة">'
    +'<label class="slbl" style="text-align:right;display:block;margin-top:8px">ملاحظات</label>'
    +'<input class="sinp" id="me-notes" type="text" placeholder="ملاحظة (اختياري)" style="direction:rtl;text-align:right">'
    +'</div>'
    +'<div class="dacts">'
    +'<button class="abtn ok" id="me-save">💾 تسجيل الحركة</button>'
    +'</div>';

  $id('me-save').addEventListener('click',function(){
    var prodSel=$id('me-prod');
    var prodId=prodSel.value;
    if(!prodId){toast('اختر المنتج','er');return;}
    var prodName=prodSel.options[prodSel.selectedIndex].getAttribute('data-name');
    var type=$id('me-type').value;
    var qty=parseInt($id('me-qty').value)||0;
    if(qty<=0){toast('الكمية يجب أن تكون أكبر من صفر','er');return;}
    var data={
      tenant_id:currentTenantId,
      product_id:prodId,
      product_name:prodName,
      movement_type:type,
      qty_in: type==='in'?qty:0,
      qty_out:type==='out'?qty:0,
      // movement_date is date-only; actual timestamp comes from created_at.
      movement_date: $id('me-date').value,
      tracking_no:$id('me-uid').value.trim()||null,
      notes:$id('me-notes').value.trim()||null
    };
    sb.from('stock_movements').insert(data).then(function(r){
      if(r.error){toast('خطأ: '+r.error.message,'er');return;}
      toast('تم تسجيل الحركة ✓ المخزون اتحدث تلقائياً','ok');
      $id('ovl').classList.remove('open');
      loadStock();
    });
  });

  $id('ovl').classList.add('open');
}

// Stock event wireup
// التنقّل بين الصفحات وتابات المخزون والتحليلات
function initNavAndStock(){
$id('nav-orders').addEventListener('click',function(){showPage('orders');});
$id('nav-stock').addEventListener('click',function(){showPage('stock');});
if($id('nav-issues'))$id('nav-issues').addEventListener('click',function(){showPage('issues');});
$id('nav-finance').addEventListener('click',function(){showPage('finance');});
if($id('nav-billing'))$id('nav-billing').addEventListener('click',function(){showPage('billing');});
if($id('nav-settings'))$id('nav-settings').addEventListener('click',function(){showPage('settings');});
if($id('nav-analytics'))$id('nav-analytics').addEventListener('click',function(){showPage('analytics');});
if($id('nav-inbox'))$id('nav-inbox').addEventListener('click',function(){showPage('inbox');});
if($id('wa-refresh'))$id('wa-refresh').addEventListener('click',function(){waFetchConvos(true);if(waActiveId)waFetchMessages(waActiveId,true,false);});
if($id('wa-search'))$id('wa-search').addEventListener('input',function(){ waSearchQuery=(this.value||'').trim().toLowerCase(); renderConvos(); });
if($id('wa-back'))$id('wa-back').addEventListener('click',function(){var w=$id('wa-wrap');if(w)w.classList.remove('show-chat');waActiveId=null;renderConvos();});
if($id('wa-send-btn'))$id('wa-send-btn').addEventListener('click',waSend);
if($id('wa-qr-btn'))$id('wa-qr-btn').addEventListener('click',function(){ var p=$id('wa-qr-panel'); if(p) p.classList.toggle('open'); });
if($id('wa-docattach'))$id('wa-docattach').addEventListener('click',function(){ var f=$id('wa-docfile'); if(f) f.click(); });
if($id('wa-docfile'))$id('wa-docfile').addEventListener('change',waPickFile);
if($id('wa-label-btn'))$id('wa-label-btn').addEventListener('click',function(){ var lp=$id('wa-label-picker'); if(!lp) return; var show=lp.style.display==='none'; if(show){ var conv=waConvos.filter(function(x){return x.id===waActiveId;})[0]; waRenderLabelPicker(conv); } lp.style.display=show?'flex':'none'; this.classList.toggle('on',show); });
if($id('wa-note-btn'))$id('wa-note-btn').addEventListener('click',function(){ var nb=$id('wa-note-box'); if(!nb) return; var show=nb.style.display==='none'; nb.style.display=show?'flex':'none'; this.classList.toggle('on',show); if(show){ var ni=$id('wa-note-input'); if(ni) ni.focus(); } });
if($id('wa-note-save'))$id('wa-note-save').addEventListener('click',waSaveNote);
if($id('wa-orders-head'))$id('wa-orders-head').addEventListener('click',function(){var b=$id('wa-orders-body'),a=$id('wa-orders-arrow');if(!b)return;var collapsed=b.classList.toggle('collapsed');if(a)a.textContent=collapsed?'▸':'▾';});
if($id('wa-attach'))$id('wa-attach').addEventListener('click',function(){var f=$id('wa-file');if(f)f.click();});
if($id('wa-file'))$id('wa-file').addEventListener('change',waPickImage);
if($id('wa-input')){
  $id('wa-input').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();waSend();}});
  $id('wa-input').addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';});
}
document.querySelectorAll('.stock-tab[data-tab]').forEach(function(b){
  b.addEventListener('click',function(){
    currentStockTab=b.getAttribute('data-tab');
    document.querySelectorAll('.stock-tab[data-tab]').forEach(function(x){x.classList.toggle('active',x===b);});
    $id('stock-products-tab').style.display = currentStockTab==='products'?'block':'none';
    $id('stock-movements-tab').style.display = currentStockTab==='movements'?'block':'none';
  });
});
$id('prod-search').addEventListener('input',renderProducts);
$id('mov-search').addEventListener('input',renderMovements);
$id('mov-type').addEventListener('change',renderMovements);
$id('perf-search').addEventListener('input',renderProductPerformance);
// Analytics (performance) sub-tabs
document.querySelectorAll('.stock-tab[data-atab]').forEach(function(b){
  b.addEventListener('click',function(){
    analyticsCurrentTab=b.getAttribute('data-atab');
    document.querySelectorAll('.stock-tab[data-atab]').forEach(function(x){x.classList.toggle('active',x===b);});
    $id('analytics-products-tab').style.display = analyticsCurrentTab==='products'?'block':'none';
    $id('analytics-platforms-tab').style.display = analyticsCurrentTab==='platforms'?'block':'none';
    $id('analytics-employees-tab').style.display = analyticsCurrentTab==='employees'?'block':'none';
    if($id('analytics-period-bar'))$id('analytics-period-bar').style.display = analyticsCurrentTab==='employees'?'none':'';
    renderAnalyticsActive();
  });
});
document.querySelectorAll('.aperiod-btn').forEach(function(b){
  b.addEventListener('click',function(){
    setPeriod(analyticsPeriod, b.getAttribute('data-aperiod'));
    document.querySelectorAll('.aperiod-btn').forEach(function(x){x.classList.toggle('active',x===b);});
    renderAnalyticsActive();
  });
});
$id('add-product-btn').addEventListener('click',function(){openProductEditor(null);});
$id('add-mov-btn').addEventListener('click',openMovementEditor);


// ─────────────────────────────────────────────────
// SMART STOCK ALERTS + ISSUES CENTER
// ─────────────────────────────────────────────────
}
function parseMovementDate(m){
  var raw=m.created_at || m.movement_date;
  if(!raw)return null;
  var d=new Date(raw);
  return isNaN(d.getTime())?null:d;
}

function recentQtyOutByProduct(days){
  var now=Date.now();
  var windowMs=days*24*60*60*1000;
  var map={};
  (stockMovements||[]).forEach(function(m){
    if(m.movement_type!=='out')return;
    var d=parseMovementDate(m); if(!d)return;
    if(now-d.getTime()>windowMs)return;
    var name=normalizeProductName(m.product_name);
    var key=name.toLowerCase();
    map[key]=(map[key]||0)+(Number(m.qty_out||0)||0);
  });
  return map;
}

function stockForecastRows(){
  var out7=recentQtyOutByProduct(7);
  var rows=(stockProducts||[]).map(function(p){
    var name=normalizeProductName(p.name);
    var qty=Number(p.current_qty||0)||0;
    var sold7=out7[name.toLowerCase()]||0;
    var avg=sold7/7;
    var daysLeft=avg>0 ? qty/avg : null;
    var level='ok', msg='مخزون مستقر';
    if(qty<=0){level='critical';msg='نفد من المخزون';daysLeft=0;}
    else if(avg>0 && daysLeft<=3){level='critical';msg='هينفد خلال 3 أيام أو أقل';}
    else if(avg>0 && daysLeft<=7){level='warn';msg='هينفد خلال أسبوع تقريبًا';}
    else if(avg===0 && qty>0 && qty<10){level='warn';msg='مخزون قليل لكن مفيش سحب حديث';}
    return {product:p,name:name,qty:qty,sold7:sold7,avg:avg,daysLeft:daysLeft,level:level,msg:msg,wholesale:Number(p.wholesale_price||0)||0};
  });
  rows.sort(function(a,b){
    var pr={critical:0,warn:1,ok:2};
    if(pr[a.level]!==pr[b.level])return pr[a.level]-pr[b.level];
    var da=a.daysLeft===null?9999:a.daysLeft, db=b.daysLeft===null?9999:b.daysLeft;
    return da-db;
  });
  return rows;
}

function renderSmartStockAlerts(targetId, limit){
  var target=$id(targetId);
  if(!target)return;
  var rows=stockForecastRows().filter(function(r){return r.level!=='ok';}).slice(0,limit||6);
  if(!rows.length){
    target.innerHTML='<div class="smart-alert-card info"><div class="alert-head"><span>✅</span><span class="alert-title">المخزون مستقر حاليًا</span></div><div class="alert-sub">مفيش منتجات متوقعة تنفد قريبًا بناءً على حركات الخروج آخر 7 أيام.</div></div>';
    return;
  }
  target.innerHTML=rows.map(function(r){
    var cls=r.level==='critical'?'critical':'warn';
    var icon=r.level==='critical'?'🚨':'⚠️';
    var daysTxt=r.daysLeft===null?'غير محسوب':(r.daysLeft<=0?'نفد':r.daysLeft.toFixed(1)+' يوم');
    return '<div class="smart-alert-card '+cls+'">'
      + '<div class="alert-head"><span>'+icon+'</span><span class="alert-title">'+esc(short(r.name,34))+'</span><span class="alert-badge">'+esc(r.msg)+'</span></div>'
      + '<div class="alert-main">'+daysTxt+'</div>'
      + '<div class="alert-sub">المتاح: '+num(r.qty)+' قطعة · سحب آخر 7 أيام: '+num(r.sold7)+' · متوسط يومي: '+(r.avg?r.avg.toFixed(1):'0')+' قطعة</div>'
      + '<div class="alert-actions"><button class="alert-action" data-stock-search="'+esc(r.name)+'">افتح المنتج</button></div>'
      + '</div>';
  }).join('');
  target.querySelectorAll('[data-stock-search]').forEach(function(b){
    b.addEventListener('click',function(){openStockProductByName(b.getAttribute('data-stock-search'));});
  });
}

function openStockProductByName(name){
  showPage('stock');
  currentStockTab='products';
  document.querySelectorAll('.stock-tab[data-tab]').forEach(function(x){x.classList.toggle('active',x.getAttribute('data-tab')==='products');});
  $id('stock-products-tab').style.display='block';
  $id('stock-movements-tab').style.display='none';
  if($id('prod-search'))$id('prod-search').value=name||'';
  renderProducts();
  window.scrollTo({top:0,behavior:'smooth'});
}

function loadStockMovementsForOps(done){
  if(stockMovements && stockMovements.length){done&&done();return;}
  sb.from('stock_movements').select('*').eq('tenant_id',currentTenantId).order('created_at',{ascending:false}).limit(1000).then(function(r){
    if(!r.error && r.data)stockSetMovements(r.data);
    done&&done();
  });
}

function shippedOrOperational(o){
  return BOSTA_INVENTORY_STATUSES.indexOf(o.status)>=0 || statusIn(o.status,DELIVERED_STATUSES) || statusIn(o.status,RETURNED_STATUSES) || o.status==='failed';
}

function productExists(name){
  var nn=normalizeProductName(name).toLowerCase();
  return (stockProducts||[]).some(function(p){return normalizeProductName(p.name).toLowerCase()===nn;});
}


function buildIssues(){
  var issues=[];
  function add(prio,type,title,detail,ref,action,scope){
    issues.push({prio:prio,type:type,title:title,detail:detail,ref:ref,action:action,scope:scope});
  }

  // الهدف هنا إن شاشة المشاكل تعرض مشاكل قابلة للتصرف، مش تعمل إنذار على كل داتا قديمة.
  // لذلك: بنجمع المشاكل المتكررة، وبنتجاهل Legacy orders القديمة في Checks الجديدة مثل Snapshot / stock_deducted.
  var nowMs=Date.now();
  var OPS_ISSUE_DAYS=21;     // مشاكل التشغيل الحديثة فقط
  var PRODUCT_ISSUE_DAYS=30; // مشاكل المنتجات من أوردرات آخر شهر
  var PENDING_OLD_HOURS=24;  // pending بعد يوم كامل، مش 6 ساعات عشان مايبقاش Noise

  function rowAgeDays(o){
    var raw=o.status_changed_at || o.created_at;
    var d=new Date(raw||'');
    if(isNaN(d.getTime()))return null;
    return (nowMs-d.getTime())/(24*60*60*1000);
  }
  function isRecent(o,days){
    var age=rowAgeDays(o);
    return age===null || age<=days;
  }
  function uidOf(o){return o.order_uid||o.tracking_no||String(o.id||'').slice(0,8);}
  function bump(map,key,data){
    if(!key)return;
    if(!map[key])map[key]=Object.assign({count:0},data||{});
    map[key].count++;
  }

  // 1) سعر الجملة صفر — Issue واحدة لكل منتج Active فقط.
  (stockProducts||[]).forEach(function(p){
    if(p.active===false)return;
    if((Number(p.wholesale_price||0)||0)<=0){
      add('high','بيانات المنتج','سعر الجملة صفر', 'المنتج ده هيخلي الأرباح أعلى من الحقيقة لأنه بيتحسب بتكلفة صفر. افتح المنتج وضيف سعر الجملة.', p.name, {kind:'stock',q:p.name}, 'data');
    }
  });

  // 2) نفاد المخزون الذكي — يظهر هنا فقط لو فيه سحب حديث فعلاً.
  stockForecastRows().filter(function(r){
    if(r.level==='ok')return false;
    if(r.product && r.product.active===false)return false;
    // ما نعتبرش منتج صفر مخزون مشكلة هنا لو مفيش عليه سحب آخر 7 أيام.
    if((r.sold7||0)<=0)return false;
    return true;
  }).forEach(function(r){
    add(r.level==='critical'?'high':'medium','نفاد مخزون ذكي',r.msg, 'المتاح '+num(r.qty)+' · سحب آخر 7 أيام '+num(r.sold7)+' · متوسط يومي '+(r.avg?r.avg.toFixed(1):'0')+' · متبقي '+(r.daysLeft===null?'غير محسوب':r.daysLeft.toFixed(1)+' يوم'), r.name, {kind:'stock',q:r.name}, 'stock');
  });

  var missingProductMap={};
  var zeroCostProductMap={};
  var noSnapshot=0, noSnapshotExample=null;
  var noDeduct=0, noDeductExample=null;

  (all||[]).forEach(function(o){
    var uid=uidOf(o);
    var ageDays=rowAgeDays(o);

    // 3) Pending قديم — آخر 21 يوم فقط وبعد 24 ساعة.
    if(o.status==='pending' && isRecent(o,OPS_ISSUE_DAYS)){
      var d=new Date(o.created_at||'');
      if(!isNaN(d.getTime()) && nowMs-d.getTime()>PENDING_OLD_HOURS*60*60*1000){
        add('medium','طلبات معلقة','Pending قديم', 'الأوردر قيد الانتظار من أكتر من '+PENDING_OLD_HOURS+' ساعة ومحتاج متابعة.', '#'+uid, {kind:'order',q:o.order_uid||o.phone||o.id}, 'ops');
      }
    }

    // 4) مشاكل تشغيل Bosta الحالية — الحديثة فقط.
    if(BOSTA_INVENTORY_STATUSES.indexOf(o.status)>=0 && isRecent(o,OPS_ISSUE_DAYS)){
      if(!o.tracking_no){
        add('high','بوسطة','شحنة في التشغيل بدون رقم تتبع', 'الأوردر داخل حالات بوسطة التشغيل لكن مفيش tracking_no محفوظ.', '#'+uid, {kind:'order',q:o.order_uid||o.phone||o.id}, 'ops');
      }
      if(!o.stock_deducted_at && o.tracking_no){
        noDeduct++;
        if(!noDeductExample)noDeductExample=o;
      }
    }

    if((o.status==='Exception' || o.status==='exception') && isRecent(o,OPS_ISSUE_DAYS)){
      add('high','بوسطة','Exception محتاج تدخل', 'الشحنة في حالة Exception ولازم تتراجع مع بوسطة أو العميل.', '#'+uid, {kind:'order',q:o.tracking_no||o.order_uid||o.phone}, 'ops');
    }

    // 5) مرتجع بدون رجوع مخزون — بس لو أصلاً كان اتخصم.
    if(statusIn(o.status,RETURNED_STATUSES) && o.stock_deducted_at && !o.stock_returned_at && isRecent(o,PRODUCT_ISSUE_DAYS)){
      add('high','مخزون','مرتجع بدون رجوع مخزون', 'الأوردر رجع لكن stock_returned_at فاضي. راجع فرع المرتجع في n8n.', '#'+uid, {kind:'order',q:o.tracking_no||o.order_uid||o.phone}, 'stock');
    }

    // 6) Snapshot missing — Issue واحدة مجمعة فقط، مش صف لكل أوردر.
    if(shippedOrOperational(o) && !hasCostSnapshot(o) && isRecent(o,OPS_ISSUE_DAYS)){
      noSnapshot++;
      if(!noSnapshotExample)noSnapshotExample=o;
    }

    // 7) مشاكل المنتج داخل الأوردرات — مجمعة بالمنتج، آخر شهر فقط.
    if(shippedOrOperational(o) && isRecent(o,PRODUCT_ISSUE_DAYS)){
      parseProductItems(o.product_name||'').forEach(function(it){
        var name=it.name;
        if(!productExists(name)){
          bump(missingProductMap,name,{name:name,example:o});
        } else if(productCostByName(name)<=0){
          bump(zeroCostProductMap,name,{name:name,example:o});
        }
      });
    }
  });

  if(noDeduct>0){
    add('high','مخزون','شحنات بدون خصم مخزون', 'فيه '+num(noDeduct)+' شحنة حديثة في التشغيل ولها رقم تتبع لكن stock_deducted_at فاضي. راجع n8n خصم المخزون.', noDeductExample?'#'+uidOf(noDeductExample):num(noDeduct), {kind:'order',q:noDeductExample?(noDeductExample.tracking_no||noDeductExample.order_uid||noDeductExample.phone):''}, 'stock');
  }

  if(noSnapshot>0){
    add('medium','Snapshot','أوردرات حديثة بدون Snapshot', 'فيه '+num(noSnapshot)+' أوردر حديث اتحرك/اتسلم لكن مفيش تكلفة محفوظة وقت الشحن. ده مش خطر فوري، بس الماليات هتستخدم أسعار المخزون الحالية كـ fallback.', noSnapshotExample?'#'+uidOf(noSnapshotExample):num(noSnapshot), {kind:'order',q:noSnapshotExample?(noSnapshotExample.tracking_no||noSnapshotExample.order_uid||noSnapshotExample.phone):''}, 'data');
  }

  Object.keys(missingProductMap).forEach(function(k){
    var r=missingProductMap[k];
    add('high','تكلفة المنتج','منتج غير موجود في المخزون', 'المنتج ظهر في '+num(r.count)+' أوردر حديث لكنه مش موجود في stock_products. ضيفه أو وحّد الاسم عشان التكلفة تتحسب صح.', r.name, {kind:'order',q:r.example?(r.example.tracking_no||r.example.order_uid||r.example.phone):r.name}, 'data');
  });

  Object.keys(zeroCostProductMap).forEach(function(k){
    var r=zeroCostProductMap[k];
    // لو المنتج نفسه اتسجل فوق كسعر صفر، ما نكررش نفس المشكلة كتير.
    var alreadyStockIssue=(stockProducts||[]).some(function(p){return normalizeProductName(p.name).toLowerCase()===normalizeProductName(r.name).toLowerCase() && (Number(p.wholesale_price||0)||0)<=0;});
    if(alreadyStockIssue)return;
    add('high','تكلفة المنتج','منتج سعره صفر في أوردرات', 'المنتج ظهر في '+num(r.count)+' أوردر حديث وتكلفته محسوبة صفر. ضيف سعر الجملة في المخزون.', r.name, {kind:'stock',q:r.name}, 'data');
  });

  var pr={high:0,medium:1,low:2};
  issues.sort(function(a,b){
    if(pr[a.prio]!==pr[b.prio])return pr[a.prio]-pr[b.prio];
    return String(a.type).localeCompare(String(b.type),'ar');
  });
  return issues;
}

var _allIssues = []; // cache for filter

function renderIssues(){
  if(!isAdmin())return;
  _allIssues = buildIssues();
  var high=_allIssues.filter(function(i){return i.prio==='high';}).length;
  var med=_allIssues.filter(function(i){return i.prio==='medium';}).length;
  var data=_allIssues.filter(function(i){return i.scope==='data';}).length;
  if($id('iss-high'))$id('iss-high').textContent=num(high);
  if($id('iss-medium'))$id('iss-medium').textContent=num(med);
  if($id('iss-data'))$id('iss-data').textContent=num(data);
  if($id('iss-total'))$id('iss-total').textContent=num(_allIssues.length);
  renderSmartStockAlerts('issues-stock-alerts',4);
  renderIssuesTable();
}

function renderIssuesTable(){
  var q=($id('issues-search')&&$id('issues-search').value||'').trim().toLowerCase();
  var prio=($id('issues-filter-prio')&&$id('issues-filter-prio').value)||'';
  var scope=($id('issues-filter-scope')&&$id('issues-filter-scope').value)||'';
  var issues=_allIssues.filter(function(i){
    if(prio && i.prio!==prio)return false;
    if(scope && i.scope!==scope)return false;
    if(q){
      var hay=[i.title,i.type,i.detail,i.ref].filter(Boolean).join(' ').toLowerCase();
      if(hay.indexOf(q)<0)return false;
    }
    return true;
  });
  if($id('iss-filtered-count'))$id('iss-filtered-count').textContent=num(issues.length)+' مشكلة';

  var tb=$id('issues-tbody'); if(!tb)return;
  if(!_allIssues.length){tb.innerHTML='<div class="ldg" style="color:var(--green);padding:28px;">✅ ممتاز — مفيش مشاكل موجودة دلوقتي</div>';return;}
  if(!issues.length){tb.innerHTML='<div class="ldg">لا توجد مشاكل تطابق الفلتر</div>';return;}

  var prioConfig={
    high:{label:'🚨 عاجل',cls:'high'},
    medium:{label:'⚠️ متوسط',cls:'medium'},
    low:{label:'ℹ️ منخفض',cls:'low'}
  };
  var scopeIcon={ops:'⚙️',stock:'📦',data:'📊'};
  var scopeLabel={ops:'تشغيل',stock:'مخزون',data:'بيانات'};

  var h='<table><thead><tr>'
    +'<th style="width:90px">الأولوية</th>'
    +'<th style="width:80px">النوع</th>'
    +'<th>المشكلة</th>'
    +'<th>التفاصيل</th>'
    +'<th style="width:90px">المرجع</th>'
    +'<th style="width:60px">إجراء</th>'
    +'</tr></thead><tbody>';

  issues.forEach(function(i,idx){
    var pc=prioConfig[i.prio]||{label:i.prio,cls:'low'};
    var sc=scopeIcon[i.scope]||'';
    var rowBg=i.prio==='high'?'rgba(239,68,68,.04)':i.prio==='medium'?'rgba(249,115,22,.03)':'';
    h+='<tr style="background:'+rowBg+'">'
      +'<td><span class="issue-prio '+pc.cls+'">'+pc.label+'</span></td>'
      +'<td><span style="font-size:.78rem;color:var(--muted)">'+sc+' '+esc(scopeLabel[i.scope]||i.scope||'')+'</span></td>'
      +'<td class="nm" style="font-weight:800;">'+esc(i.title)+'</td>'
      +'<td class="pr" style="font-size:.8rem;color:var(--muted2);max-width:340px;" title="'+esc(i.detail)+'">'+esc(short(i.detail,100))+'</td>'
      +'<td class="mn" style="font-size:.78rem;color:var(--blue);">'+esc(i.ref||'—')+'</td>'
      +'<td><button class="issue-action-btn" data-issue-idx="'+idx+'">فتح →</button></td>'
      +'</tr>';
  });
  h+='</tbody></table>';
  tb.innerHTML=h;
  tb.querySelectorAll('[data-issue-idx]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var i=issues[parseInt(btn.getAttribute('data-issue-idx'),10)];
      if(!i||!i.action)return;
      if(i.action.kind==='stock')openStockProductByName(i.action.q);
      else if(i.action.kind==='order'){
        showPage('orders');
        $id('qinp').value=i.action.q||'';$id('fst').value='';$id('fpl').value='';$id('fpy').value='';
        if(window.__syncFilterUI)window.__syncFilterUI();
        doFilter(); window.scrollTo({top:0,behavior:'smooth'});
      }
    });
  });
}

function loadIssues(){
  if(!requireAdmin())return;
  if(!ensureTenant())return;
  var tb=$id('issues-tbody'); if(tb)tb.innerHTML='<div class="ldg"><div class="spin"></div>جاري تحليل المشاكل...</div>';
  loadStockProductsForCosts(function(){
    loadStockMovementsForOps(function(){
      renderIssues();
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// ════════════════ FINANCE SECTION (admin only) ═════════════════
// ═══════════════════════════════════════════════════════════════
var SHIPPING_COST_DEFAULT = 85;
// سعر الشحن الحقيقي من Bosta (شامل VAT) لو اتسجّل، وإلا الافتراضي 85
function orderShippingCost(o){
  var f = parseFloat(o && o.real_shipping_fee);
  return (isFinite(f) && f > 0) ? f : SHIPPING_COST_DEFAULT;
}
var financeCurrentTab = 'overview';
var financePeriod = { type: 'month', from: null, to: null };
var financeChartInstance = null;

// Get period date range
function parseLocalYMD(s){ var p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+p[2],0,0,0,0); }
function getPeriodRange(){
  var now = new Date();
  var from, to, t = financePeriod.type;
  if(t === 'last3'){
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate()-2);
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
  } else if(t === 'month'){
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth()+1, 1);
  } else if(t === 'last30'){
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate()-29);
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
  } else if(t === 'custom'){
    from = financePeriod.from ? parseLocalYMD(financePeriod.from) : new Date(2020,0,1);
    to = financePeriod.to ? new Date(parseLocalYMD(financePeriod.to).getTime() + 86400000) : new Date(now.getFullYear()+1,0,1);
  } else { // 'all'
    from = new Date(2020,0,1);
    to = new Date(now.getFullYear()+1, 0, 1);
  }
  return { from: from, to: to };
}
// pick a sensible chart granularity that matches the selected finance period
function autoChartGran(){
  if(financePeriod.type==='all') return 'monthly';
  var r=getPeriodRange(), span=Math.max(1,Math.round((new Date(r.to)-new Date(r.from))/86400000));
  if(span<=31) return 'daily';
  if(span<=183) return 'weekly';
  if(span<=730) return 'monthly';
  return 'yearly';
}

function ordersInRange(range){
  return all.filter(function(o){
    var d = new Date(o.created_at);
    return d >= range.from && d < range.to;
  });
}

function expensesInRange(range){
  return financeExpenses.filter(function(e){
    var d = new Date(e.expense_date);
    return d >= range.from && d < range.to;
  });
}

// ============================================================
// BILLING / WALLET MODULE
// ============================================================
// Vodafone Cash number — loaded dynamically from platform_settings (updatable by super admin)
var VFCASH_NUMBER = '—';
function loadVfcashNumber(){
  if(!sb) return;
  sb.from('platform_settings').select('value').eq('key','vfcash_number').maybeSingle().then(function(r){
    if(r.error || !r.data) return;
    VFCASH_NUMBER = r.data.value || '—';
    var el = $id('vfcash-number');
    if(el) el.textContent = VFCASH_NUMBER;
  });
}
var walletStateCache = null; // {wallet_balance, overdraft_limit, available, orders_used_cycle, max_orders, orders_remaining, overage_debt, plan, plan_name, monthly_price, per_order_price, pricing_type, subscription_status, cycle_started_at, cycle_ends_at, is_lifetime, is_depleted}
var billingTopupFile = null;

// ---------- Load wallet state (used by topbar chip + billing page) ----------
function loadWalletState(cb){
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

function fmtMoney(n){
  var v = parseFloat(n) || 0;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ar-EG', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + 'ج';
}
function fmtMoneyShort(n){
  var v = parseFloat(n) || 0;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ar-EG', {maximumFractionDigits: 2}) + 'ج';
}
function fmtDate(s){ if(!s) return '—'; var d=new Date(s); return d.toLocaleDateString('ar-EG',{day:'numeric',month:'short',year:'numeric'}); }
function fmtDateTime(s){ if(!s) return '—'; var d=new Date(s); return d.toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); }

// ---------- Topbar wallet chip ----------
function updateWalletChip(){
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
function applyDepletionLock(){
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

// helper used inside the row renderer (defined in the existing table code)
function lockMaybe(value){
  if(walletStateCache && walletStateCache.is_depleted){
    // Never put the real value in the DOM — inspect/copy/screen-readers would expose it.
    // Render a fixed placeholder; the actual data stays only in the in-memory `all` array.
    return '<span class="locked-cell">••••••••</span>';
  }
  return esc(String(value||''));
}

// ---------- Open billing page ----------
function loadBilling(){
  if(!isAdmin()) return;
  if(!ensureTenant()) return;
  loadVfcashNumber(); // always fetch the latest number
  loadWalletState(function(){
    renderBillingSummary();
    renderPlanCards();
    loadWalletHistory();
    loadMyTopupRequests();
  });
}

function renderBillingSummary(){
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

function renderPlanCards(){
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
var selectPlan = function(planId){
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

function switchPlan(planId, planRow){
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
function loadWalletHistory(){
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
      if(!rows.length){ tbody.innerHTML = '<div class="ldg">لا توجد حركات بعد</div>'; return; }
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
function loadMyTopupRequests(){
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
function submitTopupRequest(){
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
function wireBillingEvents(){
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

// ============================================================
//  SETTINGS PAGE — profile, webhook, bosta, whatsapp, telegram
// ============================================================
var WEBHOOK_BASE_URL = 'https://play.sheko.tech/webhook/orders?s=';
var settingsBotUsername = 'sahl_operations_bot'; // default until platform_settings loads
var TG_LOCK_DAYS = 7;          // chat id can't be changed for this many days after being set
var tgChatLocked = false;      // computed in renderSettings, read by saveTelegram

function loadSettings(){
  if(!isAdmin()) return;
  if(!ensureTenant()) return;
  // Pull fresh tenant row + platform settings (bot username) in parallel
  Promise.all([
    sb.from('v_my_tenant').select('store_name,webhook_secret,plan,whatsapp_phone_id,whatsapp_token,shipping_api_key,telegram_chat_id,telegram_chat_id_set_at,error_notify_chat,whatsapp_confirmation_enabled')
      .eq('id', currentTenantId).maybeSingle(),
    sb.from('platform_settings').select('key,value').eq('key','telegram_bot_username').maybeSingle()
  ]).then(function(results){
    var tRes = results[0], pRes = results[1];
    if(tRes.error){ toast('خطأ في تحميل الإعدادات: '+tRes.error.message,'er'); return; }
    var t = tRes.data || {};
    if(pRes && pRes.data && pRes.data.value){ settingsBotUsername = pRes.data.value; }
    renderSettings(t);
    loadNotifyPrefs();
  });
}

function renderSettings(t){
  // Profile section
  if($id('set-store-name')) $id('set-store-name').textContent = t.store_name || '—';
  if($id('set-email'))      $id('set-email').textContent = (currentUser && currentUser.email) || '—';
  var planMap = { payg: 'الدفع مقابل الاستخدام', growth: 'Growth', unlimited: 'Unlimited', lifetime: 'Lifetime ♾️' };
  var planLabel = planMap[t.plan] || t.plan || '—';
  if($id('set-plan'))       $id('set-plan').innerHTML = esc(planLabel) + ' <a href="#" id="set-plan-link" style="color:var(--acc);font-weight:700;font-size:.82rem;margin-right:6px;">تغيير</a>';
  var planLink = $id('set-plan-link');
  if(planLink) planLink.addEventListener('click', function(e){ e.preventDefault(); showPage('billing'); });

  // Webhook URL — read-only, built from webhook_secret
  var wh = t.webhook_secret ? (WEBHOOK_BASE_URL + t.webhook_secret) : '';
  if($id('set-webhook-url')) $id('set-webhook-url').value = wh || 'لم يتم إنشاؤه بعد — تواصل مع الدعم';

  // Bosta
  if($id('set-bosta-key')) $id('set-bosta-key').value = t.shipping_api_key || '';

  // WhatsApp
  if($id('set-wa-phone-id')) $id('set-wa-phone-id').value = t.whatsapp_phone_id || '';
  if($id('set-wa-token'))    $id('set-wa-token').value    = t.whatsapp_token || '';
  if($id('set-wa-confirm-toggle')) $id('set-wa-confirm-toggle').checked = !!t.whatsapp_confirmation_enabled;

  // Telegram
  if($id('set-tg-chat'))     $id('set-tg-chat').value     = t.telegram_chat_id || '';
  if($id('set-tg-err-chat')) $id('set-tg-err-chat').value = t.error_notify_chat || '';
  // Edit lock: once a chat id is set, it can't be changed for TG_LOCK_DAYS days.
  (function(){
    var input = $id('set-tg-chat');
    var note  = $id('set-tg-lock-note');
    tgChatLocked = false;
    var setAt = t.telegram_chat_id_set_at ? new Date(t.telegram_chat_id_set_at).getTime() : 0;
    var unlockTs = 0;
    if(t.telegram_chat_id && setAt){
      unlockTs = setAt + TG_LOCK_DAYS * 24 * 60 * 60 * 1000;
      if(Date.now() < unlockTs) tgChatLocked = true;
    }
    if(input){
      input.disabled = tgChatLocked;
      input.style.opacity = tgChatLocked ? '0.6' : '';
      input.style.cursor  = tgChatLocked ? 'not-allowed' : '';
    }
    if(note){
      if(tgChatLocked){
        var ds = '';
        try{
          ds = new Date(unlockTs).toLocaleDateString('ar-EG-u-nu-latn', { timeZone:'Africa/Cairo', day:'numeric', month:'long', year:'numeric' });
        }catch(e){ ds = new Date(unlockTs).toLocaleDateString(); }
        note.innerHTML = '🔒 الـ Chat ID اتقفل للتعديل بعد ما اتحفظ. تقدر تغيّره تاني يوم <strong>' + esc(ds) + '</strong>، أو تتواصل مع خدمة العملاء لو محتاج تغيّره قبل كده.';
        note.style.display = '';
      } else {
        note.style.display = 'none';
        note.innerHTML = '';
      }
    }
  })();
  var botLink = $id('set-tg-bot-link');
  if(botLink){
    botLink.href = 'https://t.me/' + settingsBotUsername;
    botLink.textContent = '@' + settingsBotUsername;
  }

  // بوابة تنبيهات البوت: من غير Chat ID محفوظ الليستة رمادية ومقفولة
  setNotifyGate(!!(t.telegram_chat_id && String(t.telegram_chat_id).trim()));
}

function setNotifyGate(hasChat){
  var block = $id('np-block');
  if(block) block.classList.toggle('np-off', !hasChat);
  NOTIFY_KEYS.forEach(function(k){
    var el = $id('np-'+k);
    if(el) el.disabled = !hasChat;
  });
}

// ---- تفضيلات تنبيهات البوت ----
var NOTIFY_KEYS = ['staff_activity','confirmations','cancellations','outgoing_today','daily_inventory'];
function loadNotifyPrefs(){
  if(!sb) return;
  sb.rpc('get_notify_prefs').then(function(r){
    var prefs = (!r.error && r.data) ? r.data : {};
    NOTIFY_KEYS.forEach(function(k){
      var el = $id('np-'+k);
      if(el) el.checked = (prefs[k] === undefined || prefs[k] === null) ? true : !!prefs[k];
    });
  });
}
function saveNotifyPref(key){
  var el = $id('np-'+key); if(!el) return;
  var desired = !!el.checked;
  el.disabled = true;
  var payload = {}; payload[key] = desired;
  sb.rpc('update_notify_prefs', { p_prefs: payload }).then(function(r){
    el.disabled = false;
    if(r.error){
      el.checked = !desired;
      var m = r.error.message || '';
      toast(m.indexOf('admin_only')>=0 ? 'الصلاحية دي للأدمن فقط' : ('تعذّر الحفظ: '+m), 'er');
      return;
    }
    toast(desired ? 'التنبيه اتفعّل ✓' : 'التنبيه اتقفل', 'ok');
  }).catch(function(e){
    el.disabled = false; el.checked = !desired;
    toast('خطأ: '+(e.message||e),'er');
  });
}

// Copy webhook URL to clipboard with visual feedback
function copyWebhookUrl(){
  var input = $id('set-webhook-url');
  var btn = $id('set-webhook-copy');
  if(!input || !btn || !input.value || input.value.indexOf('http') !== 0){
    toast('لا يوجد رابط لنسخه','er'); return;
  }
  var doneVisual = function(){
    var orig = btn.textContent;
    btn.classList.add('copied');
    btn.textContent = '✓ تم النسخ';
    setTimeout(function(){ btn.classList.remove('copied'); btn.textContent = orig; }, 1500);
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(input.value).then(doneVisual).catch(function(){
      // fallback to manual selection
      input.select(); document.execCommand('copy'); doneVisual();
    });
  } else {
    input.select(); document.execCommand('copy'); doneVisual();
  }
}

// Toggle password→text on secret inputs
function toggleSecretVisibility(ev){
  var btn = ev.currentTarget;
  var targetId = btn.getAttribute('data-target');
  var input = $id(targetId);
  if(!input) return;
  if(input.type === 'password'){
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

// Generic save helper — sends only the listed fields, preserving others.
// onDone (optional) runs after a successful save, with no arguments.
function saveIntegrations(payload, sectionLabel, btn, onDone){
  var origText = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'جاري الحفظ...'; }
  sb.rpc('update_tenant_integrations', payload).then(function(r){
    if(btn){ btn.disabled = false; btn.textContent = origText; }
    if(r.error){
      var m = (r.error.message || '') + ' ' + (r.error.details || '');
      if(m.indexOf('telegram_locked') >= 0){
        var when = '';
        var mt = m.match(/telegram_locked:([0-9T:\-Z]+)/);
        if(mt){ var dl = new Date(mt[1]); if(!isNaN(dl)){ try{ when = dl.toLocaleDateString('ar-EG-u-nu-latn', { timeZone:'Africa/Cairo', day:'numeric', month:'long', year:'numeric' }); }catch(e){ when = dl.toLocaleDateString(); } } }
        toast(when ? ('مش هينفع تغيّر الـ Chat ID دلوقتي — جرّب تاني يوم ' + when + ' أو اتواصل مع خدمة العملاء.')
                   : 'مش هينفع تغيّر الـ Chat ID قبل أسبوع من آخر تعديل — اتواصل مع خدمة العملاء.', 'er');
        return;
      }
      if(m.indexOf('duplicate_telegram_chat_id') >= 0 || m.indexOf('telegram_chat_id_unique') >= 0 || r.error.code === '23505'){
        toast('رقم الـ Chat ID ده متربط بمتجر تاني بالفعل — كل متجر لازم Chat ID مختلف.','er');
      } else {
        toast('خطأ في حفظ ' + sectionLabel + ': ' + (r.error.message || ''), 'er');
      }
      return;
    }
    toast('تم حفظ ' + sectionLabel + ' بنجاح ✓','ok');
    if(typeof onDone === 'function') onDone();
  }).catch(function(e){
    if(btn){ btn.disabled = false; btn.textContent = origText; }
    toast('خطأ في الحفظ: ' + (e.message || e), 'er');
  });
}

function saveBosta(){
  var btn = $id('set-save-bosta');
  var key = ($id('set-bosta-key').value || '').trim();
  saveIntegrations({ p_shipping_api_key: key }, 'بوسطة', btn);
}

// Auto-save the WhatsApp-confirmation on/off toggle. Reverts visual state on failure.
function saveWaConfirmToggle(){
  var el = $id('set-wa-confirm-toggle'); if(!el) return;
  var desired = !!el.checked;
  el.disabled = true;
  sb.rpc('update_tenant_integrations', { p_whatsapp_confirmation_enabled: desired }).then(function(r){
    el.disabled = false;
    if(r.error){ el.checked = !desired; toast('متعملش تحديث ميزة الواتساب: ' + (r.error.message || ''), 'er'); return; }
    toast(desired ? 'اتفعّل تأكيد الواتساب ✓' : 'اتطفّى تأكيد الواتساب', 'ok');
  }).catch(function(e){ el.disabled = false; el.checked = !desired; toast('خطأ: ' + (e.message || e), 'er'); });
}

// الحفظ بيمرّ على تحقق حقيقي من ميتا — مش مجرد تخزين نص
async function saveWhatsApp(){
  var btn = $id('set-save-wa');
  var phoneId = ($id('set-wa-phone-id').value || '').trim();
  var token   = ($id('set-wa-token').value || '').trim();

  if((phoneId && !token) || (!phoneId && token)){
    toast('لازم تدخل الرقم والتوكن مع بعض — أو تسيب الاتنين فاضيين عشان تستخدم رقم سهل.','er');
    return;
  }
  if(!phoneId && !token){
    if(!confirm('هتشيل رقمك الخاص وتشتغل على رقم سهل المشترك.\n\nتأكيد؟')) return;
  }

  var orig = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = phoneId ? 'بنتأكد من ميتا...' : 'جاري الحفظ...'; }

  try{
    var sess = await sb.auth.getSession();
    var tk = sess && sess.data && sess.data.session ? sess.data.session.access_token : null;
    if(!tk) throw new Error('جلسة الدخول انتهت. سجّل دخول تاني.');

    var res = await fetch(SUPABASE_URL + '/functions/v1/wa-verify-number', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer '+tk },
      body: JSON.stringify({ phone_number_id: phoneId, token: token })
    });
    var out = await res.json().catch(function(){ return {}; });

    if(btn){ btn.disabled = false; btn.textContent = orig; }

    if(!res.ok || !out.ok){
      toast(out.message || 'تعذّر التحقق من البيانات.','er');
      return;
    }
    toast(out.message || 'تم ✓','ok');
    if(out.verified && out.display_phone_number){
      toast('الرقم المتحقق منه: ' + out.display_phone_number, 'ok');
    }
    loadSettings();
    refreshInboxGate();
  }catch(err){
    if(btn){ btn.disabled = false; btn.textContent = orig; }
    toast('خطأ: ' + (err.message || err), 'er');
  }
}

// ---- بوابة تبويب المحادثات: مفتوح للموثّقين بس ----
var inboxVerified = null;
function refreshInboxGate(){
  if(!sb) return Promise.resolve(false);
  return sb.rpc('wa_inbox_status').then(function(r){
    var d = (!r.error && r.data) ? r.data : {};
    inboxVerified = !!d.verified;
    return inboxVerified;
  }).catch(function(){ inboxVerified = null; return false; });
}
function renderInboxLocked(){
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

function saveTelegram(){
  var btn = $id('set-save-tg');
  var chat = ($id('set-tg-chat').value || '').trim();
  var err  = ($id('set-tg-err-chat').value || '').trim();
  // Client-side validation: must be numeric (Telegram chat IDs are integers, can be negative for groups)
  var isNumericId = function(v){ return v === '' || /^-?\d+$/.test(v); };
  if(!isNumericId(err)){  toast('Chat ID للأخطاء لازم يكون أرقام بس','er'); return; }

  // If the chat id is locked, only the error-notify field can change.
  // Omit p_telegram_chat_id entirely (NULL = preserve) and skip the confirm ping.
  if(tgChatLocked){
    saveIntegrations({ p_error_notify_chat: err }, 'تلجرام', btn);
    return;
  }

  if(!isNumericId(chat)){ toast('Chat ID لازم يكون أرقام بس','er'); return; }
  saveIntegrations({ p_telegram_chat_id: chat, p_error_notify_chat: err }, 'تلجرام', btn, function(){
    // After a successful save, ask the bot to send a confirmation message —
    // only when a chat id is actually set (clearing it shouldn't notify).
    if(chat) sendTelegramConfirm(chat);
    // Re-pull so the lock state + note reflect the new set time immediately.
    loadSettings();
  });
}

// Pings the central Telegram bot (n8n webhook) so it sends "تم الربط بنجاح" to the tenant's chat.
// The webhook holds the bot token. A send failure usually means the user hasn't pressed Start yet.
function sendTelegramConfirm(chatId){
  if(!chatId) return;
  var TG_CONFIRM_WEBHOOK = 'https://play.sheko.tech/webhook/confirmchatid';
  var payload = {
    event: 'telegram_linked',
    tenant_id: currentTenantId,
    slug: (currentTenant && currentTenant.slug) || null,
    store_name: (currentTenant && currentTenant.store_name) || null,
    chat_id: chatId,
    message: 'تم الربط بنجاح ✅'
  };
  fetch(TG_CONFIRM_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    return res.text().then(function(txt){
      var body = null; try{ body = txt ? JSON.parse(txt) : null; }catch(e){ swallow('sendTelegramConfirm/JSON.parse', e); }
      return { httpOk: res.ok, body: body };
    });
  }).then(function(r){
    if(!r.httpOk){
      toast('اتحفظ ✓ بس حصلت مشكلة في إرسال رسالة التأكيد.','er');
      return;
    }
    if(r.body && r.body.ok === false){
      if(r.body.error === 'telegram_send_failed'){
        toast('اتحفظ ✓ بس البوت مش قادر يبعتلك. افتح البوت ودوس Start وبعدين احفظ تاني.','er');
      } else {
        toast('اتحفظ ✓ بس مقدرناش نبعت رسالة التأكيد على تلجرام.','er');
      }
      return;
    }
    toast('بعتنالك رسالة تأكيد على تلجرام ✓','ok');
  }).catch(function(){
    toast('اتحفظ ✓ بس مقدرناش نبعت رسالة التأكيد دلوقتي.','er');
  });
}

// Wire all settings buttons on first DOMContentLoaded equivalent (inside IIFE)
function wireSettingsEvents(){
  if($id('set-webhook-copy')) $id('set-webhook-copy').addEventListener('click', copyWebhookUrl);
  if($id('set-save-bosta'))   $id('set-save-bosta').addEventListener('click', saveBosta);
  if($id('set-save-wa'))      $id('set-save-wa').addEventListener('click', saveWhatsApp);
  if($id('set-wa-confirm-toggle')) $id('set-wa-confirm-toggle').addEventListener('change', saveWaConfirmToggle);
  if($id('set-save-tg'))      $id('set-save-tg').addEventListener('click', saveTelegram);
  document.querySelectorAll('.settings-eye-btn').forEach(function(b){
    b.addEventListener('click', toggleSecretVisibility);
  });
  NOTIFY_KEYS.forEach(function(k){
    var el = $id('np-'+k);
    if(el) el.addEventListener('change', function(){ saveNotifyPref(k); });
  });
}

function loadFinance(){
  // During the guided tour, keep the injected demo numbers (real COGS from demo
  // stock + demo expenses) instead of fetching the empty real tenant data.
  if(tourActive){
    if(!isAdmin())return;
    if(!stockProducts || !stockProducts.length) stockSetProducts(tourDemoStock());
    if(!financeExpenses || !financeExpenses.length) financeExpenses = tourDemoExpenses();
    renderFinance();
    return;
  }
  if(!requireAdmin())return;
  if(!ensureTenant())return;
  // الماليات بتحسب على كل الفترة → نحمّل الأوردرات للذاكرة هنا (مرة واحدة)
  ensureAllLoaded(function(){
    // Finance depends on wholesale_price from stock_products, so load stock first.
    loadStockProductsForCosts(function(){
      sb.from('expenses').select('*').eq('tenant_id', currentTenantId).order('expense_date', {ascending:false}).then(function(r){
        if(r.error){ console.error(r.error); toast('خطأ في تحميل المصاريف','er'); return; }
        financeExpenses = r.data || [];
        renderFinance();
      });
    });
  });
}

function renderFinance(){
  if(!isAdmin())return;
  renderFinanceOverview();
  renderExpenses();
}

function renderFinanceOverview(){
  var range = getPeriodRange();
  var orders = ordersInRange(range);
  var expenses = expensesInRange(range);

  // Reset diagnostics — productCostByName() will repopulate this as it processes items
  unmatchedCogsItems = [];

  // Revenue calculations — use SAME status lists as orders page for consistency
  var totalRevenue = orders.reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);
  var collected = orders.filter(function(o){return statusIn(o.status, DELIVERED_STATUSES);}).reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);
  var expected = orders.filter(function(o){return statusIn(o.status, BOSTA_EXPECTED_STATUSES);}).reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);
  var lost = orders.filter(function(o){return statusIn(o.status, CANCELLED_STATUSES) || statusIn(o.status, RETURNED_STATUSES) || o.status==='failed';}).reduce(function(s,o){ return s + (parseFloat(o.total_cost)||0); }, 0);

  // Cost calculations — for DELIVERED orders only (those we paid costs on)
  var deliveredOrders = orders.filter(function(o){return statusIn(o.status, DELIVERED_STATUSES);});
  var manufacturerCost = deliveredOrders.reduce(function(s,o){ return s + orderInventoryCost(o); }, 0);
  var shippingCost = deliveredOrders.reduce(function(s,o){ return s + orderShippingCost(o); }, 0);
  var packagingCost = deliveredOrders.reduce(function(s,o){ return s + (parseFloat(o.packaging_cost)||0); }, 0);

  // ALSO charge shipping for orders that bounced/returned (we paid Bosta anyway)
  // الشحن بيتخصم لما الأوردر يتسلّم أو يرجع مرتجع فقط — دول الحالتين اللي
  // بوسطة بتحاسب عليهم فعلاً. الملغي والفاشل و Exception (تأجيل/رفض مؤقت)
  // لسه ماتحسمتش، ولما تحسم هتبقى إما تسليم أو مرتجع ويتخصم وقتها.
  var lostOrdersShipping = orders.filter(function(o){
    return statusIn(o.status, RETURNED_STATUSES);
  }).reduce(function(s,o){ return s + orderShippingCost(o); }, 0);
  shippingCost += lostOrdersShipping;

  // Manual expenses by category
  var expSalaries  = expenses.filter(function(e){return e.category==='مرتبات';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expAds       = expenses.filter(function(e){return e.category==='إعلانات فيسبوك';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expPackaging = expenses.filter(function(e){return e.category==='تغليف';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expBills     = expenses.filter(function(e){return e.category==='فواتير';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expWarehouse = expenses.filter(function(e){return e.category==='مخزن';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var expOther     = expenses.filter(function(e){return e.category==='متفرقات';}).reduce(function(s,e){return s+parseFloat(e.amount);},0);
  var totalManualExpenses = expSalaries + expAds + expPackaging + expBills + expWarehouse + expOther;

  var totalCosts = manufacturerCost + shippingCost + packagingCost + totalManualExpenses;
  var netProfit = collected - totalCosts;
  var marginPct = collected > 0 ? (netProfit/collected*100) : 0;
  var aov = deliveredOrders.length > 0 ? (collected/deliveredOrders.length) : 0;

  // Render top cards
  $id('fin-revenue').textContent = num(totalRevenue.toFixed(0))+' ج';
  $id('fin-collected').textContent = num(collected.toFixed(0))+' ج';
  $id('fin-expected').textContent = num(expected.toFixed(0))+' ج';
  $id('fin-lost').textContent = num(lost.toFixed(0))+' ج';

  // Net profit: green if profit, red if loss, white/default if zero
  var npEl = $id('fin-net-profit');
  npEl.textContent = num(netProfit.toFixed(0))+' ج';
  npEl.classList.remove('profit-positive','profit-negative','profit-zero');
  var profitCard = npEl.closest('.sc');
  if(profitCard){
    profitCard.classList.remove('profit-positive-card','profit-negative-card','profit-zero-card');
    profitCard.style.borderColor = '';
    profitCard.style.background = '';
  }
  if(netProfit > 0){
    npEl.classList.add('profit-positive');
    if(profitCard){
      profitCard.style.borderColor = 'rgba(16,185,129,.45)';
      profitCard.style.background = 'rgba(16,185,129,.06)';
    }
  } else if(netProfit < 0){
    npEl.classList.add('profit-negative');
    if(profitCard){
      profitCard.style.borderColor = 'rgba(239,68,68,.45)';
      profitCard.style.background = 'rgba(239,68,68,.06)';
    }
  } else {
    npEl.classList.add('profit-zero');
  }

  $id('fin-margin-pct').textContent = marginPct.toFixed(1)+'%';
  $id('fin-total-costs').textContent = num(totalCosts.toFixed(0))+' ج';
  $id('fin-aov').textContent = num(aov.toFixed(0))+' ج';

  // Cost breakdown
  var costRows = [
    {label:'💰 المتحصل (إيرادات فعلية)', value:collected, isRevenue:true, tip:'إجمالي قيمة الأوردرات Delivered فقط في الفترة المختارة.'},
    {label:'🏭 تكلفة المنتجات (جملة)', value:-manufacturerCost, alwaysShow:true, tip:'الأولوية للـ Snapshot المحفوظ وقت الشحن. لو مش موجود، بيتحسب Live من سعر الجملة الحالي في المخزون × الكمية.'},
    {label:'🚚 تكلفة الشحن الحقيقية (شامل المرتجع)', value:-shippingCost, tip:'سعر الشحن الحقيقي من Bosta (شامل VAT) لكل أوردر اتسلّم، وللي لسه ماجبناش سعره الحقيقي بنحسبه 85 جنيه. وبيتحسب كمان لكل أوردر مرتجع أو فاشل عنده رقم تتبع لأن الشحنة خرجت فعلاً.'},
    {label:'📦 تكلفة التغليف', value:-packagingCost, tip:'تكلفة التغليف المسجلة على الأوردرات المسلمة من عمود packaging_cost لو موجود.'},
    {label:'👤 مرتبات', value:-expSalaries, tip:'مصاريف فئة المرتبات المسجلة يدويًا في الفترة.'},
    {label:'📱 إعلانات فيسبوك', value:-expAds, tip:'مصاريف إعلانات فيسبوك المسجلة يدويًا في الفترة.'},
    {label:'📦 تغليف (مصاريف يدوية)', value:-expPackaging, tip:'مصاريف تغليف عامة أضفتها يدويًا في تبويب المصاريف.'},
    {label:'🧾 فواتير', value:-expBills, tip:'إجمالي الفواتير المسجلة يدويًا في الفترة.'},
    {label:'🏭 مخزن', value:-expWarehouse, tip:'مصاريف المخزن المسجلة يدويًا في الفترة.'},
    {label:'🔧 متفرقات', value:-expOther, tip:'أي مصاريف أخرى مسجلة يدويًا في الفترة.'},
    {label:'💎 صافي الربح', value:netProfit, isProfit:true, tip:'صافي الربح النهائي بعد خصم كل التكاليف والمصاريف من المتحصل فعلاً.'}
  ];
  var html = '';

  // Warning banner — show ABOVE the breakdown if any products couldn't be matched to stock
  if(unmatchedCogsItems.length > 0){
    var sample = unmatchedCogsItems.slice(0,5).map(function(n){return '<li style="margin:2px 0;">'+esc(n)+'</li>';}).join('');
    var more = unmatchedCogsItems.length > 5 ? '<li style="margin:2px 0;color:var(--muted);">… و '+(unmatchedCogsItems.length-5)+' غيرها</li>' : '';
    html += '<div style="background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1.5px dashed rgba(234,88,12,.5);border-radius:14px;padding:14px 18px;margin-bottom:14px;">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
      +'<span style="font-size:1.2rem;">⚠️</span>'
      +'<b style="color:#9a3412;font-size:.95rem;">'+unmatchedCogsItems.length+' منتج في الأوردرات مش لاقي ليه match في المخزون</b>'
      +'</div>'
      +'<p style="margin:0 0 8px;color:#7c2d12;font-size:.82rem;font-weight:600;line-height:1.7;">تكلفة المنتجات دي محسوبة بصفر (مش بتتخصم من الربح). راجع أسماء المنتجات في الأوردرات أو ضيفهم للمخزون عشان الحسابات تطلع صح.</p>'
      +'<ul style="margin:0;padding-right:18px;font-size:.78rem;color:#7c2d12;font-family:\'JetBrains Mono\',monospace;">'+sample+more+'</ul>'
      +'</div>';
  }

  costRows.forEach(function(r){
    if(r.value === 0 && !r.isRevenue && !r.isProfit && !r.alwaysShow) return;
    var pct = collected > 0 ? (Math.abs(r.value)/collected*100).toFixed(1) : 0;
    var cls = 'cost-row';
    var sign = '';
    var color = 'var(--red)';
    if(r.isRevenue){
      sign = '';
      color = 'var(--blue)';
    } else if(r.isProfit){
      if(r.value > 0){ cls = 'cost-row profit'; color = 'var(--green)'; sign = '+'; }
      else if(r.value < 0){ cls = 'cost-row profit-negative'; color = 'var(--red)'; sign = '-'; }
      else { cls = 'cost-row profit-zero'; color = 'var(--txt)'; sign = ''; }
    } else {
      sign = r.value < 0 ? '-' : '+';
    }
    html += '<div class="'+cls+'">'
      + '<span class="info-i" tabindex="0" title="'+esc(r.tip||r.label)+'" data-tip="'+esc(r.tip||r.label)+'">i</span>'
      + '<div class="cost-row-label">'+r.label+'</div>'
      + '<div class="cost-row-value" style="color:'+color+'">'+sign+num(Math.abs(r.value).toFixed(0))+' ج</div>'
      + '<div class="cost-row-pct">'+pct+'% من الإيرادات</div>'
      + '</div>';
  });
  $id('fin-cost-breakdown').innerHTML = html;

  renderFinanceChart();
}

var financeChartPeriod = 'monthly';
var financeChartManual = false;   // true once the user picks a granularity manually

function renderFinanceChart(){
  var canvas = $id('fin-chart');
  if(!canvas || typeof Chart === 'undefined') return;

  var now = new Date();
  var labels = [], revData = [], profData = [];

  function calcPeriod(from, to){
    var orders = all.filter(function(o){ var d=new Date(o.created_at); return d>=from && d<to; });
    var exps = financeExpenses.filter(function(e){ var d=new Date(e.expense_date); return d>=from && d<to; });
    var rev = orders.filter(isDeliveredOrder).reduce(function(s,o){return s+(parseFloat(o.total_cost)||0);},0);
    var costs = orders.filter(isDeliveredOrder).reduce(function(s,o){return s+orderInventoryCost(o);},0)
      + orders.filter(function(o){return isDeliveredOrder(o)||statusIn(o.status,RETURNED_STATUSES);}).reduce(function(s,o){return s+orderShippingCost(o);},0)
      + orders.filter(isDeliveredOrder).reduce(function(s,o){return s+(parseFloat(o.packaging_cost)||0);},0)
      + exps.reduce(function(s,e){return s+parseFloat(e.amount);},0);
    return { rev: Math.round(rev), profit: Math.round(rev - costs) };
  }

  // Chart window follows the SELECTED finance period exactly.
  var range = getPeriodRange();
  var from = new Date(range.from), to = new Date(range.to);
  if(financePeriod.type === 'all'){
    // span the actual data: earliest order → end of current month
    var minD = null;
    all.forEach(function(o){ var d=new Date(o.created_at); if(!isNaN(d) && (!minD || d<minD)) minD=d; });
    from = minD ? new Date(minD.getFullYear(), minD.getMonth(), 1) : new Date(now.getFullYear(), 0, 1);
    to = new Date(now.getFullYear(), now.getMonth()+1, 1);
  }
  var spanDays = Math.max(1, Math.round((to - from)/86400000));
  if(!financeChartManual) financeChartPeriod = autoChartGran();   // follow the period by default
  var gran = financeChartPeriod;
  // safety clamps so the bucket count stays sane
  if(spanDays <= 3 && gran!=='daily') gran='daily';
  if(gran==='daily' && spanDays > 92) gran='weekly';
  if(gran==='weekly' && spanDays > 2*366) gran='monthly';
  financeChartPeriod = gran;
  document.querySelectorAll('.chart-period-btn').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-cp')===gran); });

  if(gran === 'daily'){
    var d0 = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    while(d0 < to){
      var d1 = new Date(d0.getTime() + 86400000);
      var rD = calcPeriod(d0, d1 > to ? to : d1);
      labels.push(d0.toLocaleDateString('ar-EG',{day:'numeric',month:'short'}));
      revData.push(rD.rev); profData.push(rD.profit);
      d0 = d1;
    }
  } else if(gran === 'weekly'){
    var w0 = new Date(from), wi = 1;
    while(w0 < to){
      var w1 = new Date(w0.getTime() + 7*86400000);
      var rW = calcPeriod(w0, w1 > to ? to : w1);
      labels.push('أسبوع '+(wi++));
      revData.push(rW.rev); profData.push(rW.profit);
      w0 = w1;
    }
  } else if(gran === 'yearly'){
    var lastY = new Date(to.getTime()-1).getFullYear();
    for(var y = from.getFullYear(); y <= lastY; y++){
      var rY = calcPeriod(new Date(y,0,1), new Date(y+1,0,1));
      labels.push(String(y));
      revData.push(rY.rev); profData.push(rY.profit);
    }
  } else {
    // monthly
    var m0 = new Date(from.getFullYear(), from.getMonth(), 1);
    while(m0 < to){
      var m1 = new Date(m0.getFullYear(), m0.getMonth()+1, 1);
      var rM = calcPeriod(m0, m1 > to ? to : m1);
      labels.push(m0.toLocaleDateString('ar-EG',{month:'short',year:'2-digit'}));
      revData.push(rM.rev); profData.push(rM.profit);
      m0 = m1;
    }
  }

  if(financeChartInstance){ financeChartInstance.destroy(); }
  financeChartInstance = new Chart(canvas, {
    type:'line',
    data:{
      labels:labels,
      datasets:[
        {label:'الإيرادات', data:revData, borderColor:'rgba(59,130,246,1)', backgroundColor:'rgba(59,130,246,.1)', fill:true, tension:.35, pointRadius:3, pointHoverRadius:6},
        {label:'صافي الربح', data:profData, borderColor:'rgba(16,185,129,1)', backgroundColor:'rgba(16,185,129,.1)', fill:true, tension:.35, pointRadius:3, pointHoverRadius:6}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins:{
        legend:{position:'top',labels:{font:{family:'Cairo',weight:'700'},padding:16}},
        tooltip:{callbacks:{label:function(ctx){return ctx.dataset.label+': '+ctx.parsed.y.toLocaleString('ar-EG')+' ج';}}}
      },
      scales:{
        y:{beginAtZero:true, ticks:{font:{family:'JetBrains Mono'}, callback:function(v){return v.toLocaleString('ar-EG');}}},
        x:{ticks:{font:{family:'Cairo',size:financeChartPeriod==='daily'?9:11}}}
      }
    }
  });
}

// Status category helpers
function isDeliveredOrder(o){ return o.status === 'delivered' || o.status === 'Delivered'; }
function isWithBosta(o){
  return ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2',
    'Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs',
    'Picking up from consignee','Out for exchange'].indexOf(o.status) >= 0;
}
function isConfirmedForFinance(o){
  // Explicitly exclude pending/cancelled from confirmation calculations.
  if(!o || o.status==='pending' || o.status==='cancelled') return false;
  return o.status==='confirmed'
    || statusIn(o.status, BOSTA_POSITIVE_STATUSES)
    || statusIn(o.status, DELIVERED_STATUSES)
    || statusIn(o.status, RETURNED_STATUSES)
    || o.status==='Exception'
    || o.status==='exception'
    || o.status==='failed';
}

// ────────────────── EXPENSES TAB ──────────────────
function renderExpenses(){
  var q = ($id('exp-search').value || '').trim().toLowerCase();
  var cat = $id('exp-filter-cat').value;
  var range = getPeriodRange();
  var list = financeExpenses.filter(function(e){
    var d = new Date(e.expense_date);
    if(d < range.from || d >= range.to) return false;
    if(cat && e.category !== cat) return false;
    if(q && (e.note||'').toLowerCase().indexOf(q) < 0 && e.category.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  $id('exp-count').textContent = num(list.length) + ' مصروف';

  // Update category summary cards
  function sumCat(c){ return list.filter(function(e){return e.category===c;}).reduce(function(s,e){return s+parseFloat(e.amount);},0); }
  $id('exp-sum-salaries').textContent = num(sumCat('مرتبات').toFixed(0))+' ج';
  $id('exp-sum-ads').textContent = num(sumCat('إعلانات فيسبوك').toFixed(0))+' ج';
  $id('exp-sum-packaging').textContent = num(sumCat('تغليف').toFixed(0))+' ج';
  $id('exp-sum-bills').textContent = num(sumCat('فواتير').toFixed(0))+' ج';
  $id('exp-sum-warehouse').textContent = num(sumCat('مخزن').toFixed(0))+' ج';
  $id('exp-sum-other').textContent = num(sumCat('متفرقات').toFixed(0))+' ج';

  if(!list.length){ $id('exp-tbody').innerHTML = '<div class="ldg">لا توجد مصاريف</div>'; return; }

  var h = '<table><thead><tr>'
    + '<th>التاريخ</th><th>الفئة</th><th>المبلغ</th><th>ملاحظة</th><th></th>'
    + '</tr></thead><tbody>';
  list.forEach(function(e){
    var catSafe = e.category.replace(' ','-').replace('فيسبوك','');
    h += '<tr>'
      + '<td class="mn">'+fmtD(e.expense_date)+'</td>'
      + '<td><span class="exp-cat-badge exp-cat-'+e.category.split(' ')[0]+'">'+esc(e.category)+'</span></td>'
      + '<td class="mn" style="font-weight:900;color:var(--red);">'+num(e.amount)+' ج</td>'
      + '<td>'+esc(e.note||'')+'</td>'
      + '<td><div class="exp-row-actions">'
      +   '<button class="exp-edit-btn" data-id="'+e.id+'">✏️</button>'
      +   '<button class="exp-del-btn" data-id="'+e.id+'">🗑️</button>'
      +   '</div></td>'
      + '</tr>';
  });
  h += '</tbody></table>';
  $id('exp-tbody').innerHTML = h;

  $id('exp-tbody').querySelectorAll('.exp-edit-btn').forEach(function(b){
    b.addEventListener('click', function(){ openExpenseEditor(b.getAttribute('data-id')); });
  });
  $id('exp-tbody').querySelectorAll('.exp-del-btn').forEach(function(b){
    b.addEventListener('click', function(){ deleteExpense(b.getAttribute('data-id')); });
  });
}

function openExpenseEditor(id){
  var exp = null;
  if(id){
    for(var i=0;i<financeExpenses.length;i++){ if(financeExpenses[i].id === id){ exp = financeExpenses[i]; break; } }
  }
  var isNew = !exp;
  // Build today's date in Cairo timezone (local), NOT UTC.
  // toISOString().slice(0,10) returns the UTC date which can be off-by-one
  // for users in Cairo between 22:00-23:59 (summer) or 21:00-23:59 (winter).
  var _t = new Date();
  var todayLocal = _t.getFullYear()+'-'+pad2(_t.getMonth()+1)+'-'+pad2(_t.getDate());
  exp = exp || { category:'إعلانات فيسبوك', amount:0, expense_date:todayLocal, note:'' };

  $id('dtit').textContent = isNew ? 'إضافة مصروف' : 'تعديل مصروف';
  $id('dcnt').innerHTML = '<div class="dsec">'
    + '<label class="slbl" style="text-align:right;display:block">الفئة</label>'
    + '<select class="fsel" id="exp-cat" style="width:100%">'
    +   ['مرتبات','إعلانات فيسبوك','تغليف','فواتير','مخزن','متفرقات'].map(function(c){
          return '<option value="'+c+'" '+(c===exp.category?'selected':'')+'>'+c+'</option>';
        }).join('')
    + '</select>'
    + '<label class="slbl" style="text-align:right;display:block;margin-top:10px">المبلغ (جنيه)</label>'
    + '<input class="sinp" id="exp-amount" type="number" step="0.01" value="'+exp.amount+'">'
    + '<label class="slbl" style="text-align:right;display:block;margin-top:10px">التاريخ</label>'
    + '<input class="sinp" id="exp-date" type="date" value="'+(exp.expense_date||'').slice(0,10)+'">'
    + '<label class="slbl" style="text-align:right;display:block;margin-top:10px">ملاحظة</label>'
    + '<input class="sinp" id="exp-note" type="text" value="'+esc(exp.note||'')+'" style="direction:rtl;text-align:right">'
    + '</div>'
    + '<div class="dacts">'
    +   (isNew ? '' : '<button class="abtn cn" id="exp-del">🗑️ حذف</button>')
    +   '<button class="abtn ok" id="exp-save">💾 حفظ</button>'
    + '</div>';

  $id('exp-save').addEventListener('click', function(){
    var data = {
      tenant_id: currentTenantId,
      category: $id('exp-cat').value,
      amount: parseFloat($id('exp-amount').value) || 0,
      expense_date: $id('exp-date').value,
      note: $id('exp-note').value.trim() || null,
      created_by: currentUser ? currentUser.id : null
    };
    if(data.amount <= 0){ toast('المبلغ لازم يكون أكبر من صفر','er'); return; }
    var op = isNew
      ? sb.from('expenses').insert(data)
      : sb.from('expenses').update({category:data.category, amount:data.amount, expense_date:data.expense_date, note:data.note}).eq('id', exp.id).eq('tenant_id', currentTenantId);
    op.then(function(r){
      if(r.error){ toast('خطأ: '+r.error.message,'er'); return; }
      toast(isNew ? 'تم إضافة المصروف ✓' : 'تم التحديث ✓','ok');
      $id('ovl').classList.remove('open');
      loadFinance();
    });
  });

  if(!isNew){
    $id('exp-del').addEventListener('click', function(){ deleteExpense(exp.id); });
  }

  $id('ovl').classList.add('open');
}

function deleteExpense(id){
  if(!confirm('حذف المصروف؟')) return;
  sb.from('expenses').delete().eq('id', id).eq('tenant_id', currentTenantId).then(function(r){
    if(r.error){ toast('خطأ: '+r.error.message,'er'); return; }
    toast('تم الحذف','ok');
    $id('ovl').classList.remove('open');
    loadFinance();
  });
}

// ────────────────── PRODUCT FINANCIAL PERFORMANCE TAB ──────────────────
function renderFinancePlatforms(){
  if(!$id('finplat-tbody')) return;
  var orders = ordersInRange(getAnalyticsRange());
  var PLAT = { fb:{name:'Facebook',ic:'📘'}, ig:{name:'Instagram',ic:'📸'}, tiktok:{name:'TikTok',ic:'🎵'} };
  var by = {};
  orders.forEach(function(o){
    var key = PLAT[o.platform] ? o.platform : 'other';
    if(!by[key]) by[key] = { key:key, total:0, processed:0, positive:0, delivered:0, returned:0 };
    var b = by[key];
    b.total++;
    if(!statusIn(o.status, ['pending'])) b.processed++;            // اتعامل معاه (خرج من قيد الانتظار)
    if(statusIn(o.status, BOSTA_POSITIVE_STATUSES)) b.positive++;  // مؤكَّد / دخل رحلة الشحن
    if(statusIn(o.status, DELIVERED_STATUSES)) b.delivered++;
    if(statusIn(o.status, RETURNED_STATUSES)) b.returned++;
  });
  var list = Object.keys(by).map(function(k){
    var b = by[k];
    b.confRate = b.processed > 0 ? (b.positive / b.processed * 100) : null;   // = نسبة التأكيد (كروت اللوحة)
    var dd = b.delivered + b.returned;
    b.delivRate = dd > 0 ? (b.delivered / dd * 100) : null;                   // = نسبة التسليم (كروت اللوحة)
    var meta = PLAT[k] || { name:'أخرى', ic:'🌐' };
    b.label = meta.name; b.ic = meta.ic;
    return b;
  });
  list.sort(function(a,b){ return b.total - a.total; });

  if($id('finplat-count')) $id('finplat-count').textContent = num(list.length) + ' منصة';
  if(!list.length){ $id('finplat-tbody').innerHTML = '<div class="ldg">لا توجد بيانات في الفترة المختارة</div>'; return; }

  function rateColor(p){ if(p==null) return 'var(--muted)'; if(p>=75) return 'var(--green)'; if(p>=70) return 'var(--ora)'; return 'var(--red)'; }
  function rateTxt(p){ return p==null ? '—' : p.toFixed(1)+'%'; }

  var h = '<table><thead><tr>'
    + '<th>المنصة</th>'
    + '<th>إجمالي الطلبات</th>'
    + '<th>نسبة التأكيد</th>'
    + '<th>نسبة التسليم</th>'
    + '<th>تم التسليم</th>'
    + '<th>مرتجعة</th>'
    + '</tr></thead><tbody>';
  list.forEach(function(b){
    h += '<tr>'
      + '<td class="nm">'+b.ic+' '+esc(b.label)+'</td>'
      + '<td class="mn">'+num(b.total)+'</td>'
      + '<td class="mn" style="color:'+rateColor(b.confRate)+';font-weight:900">'+rateTxt(b.confRate)+'</td>'
      + '<td class="mn" style="color:'+rateColor(b.delivRate)+';font-weight:900">'+rateTxt(b.delivRate)+'</td>'
      + '<td class="mn" style="color:var(--green)">'+num(b.delivered)+'</td>'
      + '<td class="mn" style="color:var(--ora)">'+num(b.returned)+'</td>'
      + '</tr>';
  });
  h += '</tbody></table>';
  $id('finplat-tbody').innerHTML = h;
}


// ────────────────── FINANCE EVENT WIREUP ──────────────────
// الفاينانس والمصاريف والمشاكل والتلميحات
function initFinanceAndIssues(){
document.querySelectorAll('.period-btn').forEach(function(b){
  b.addEventListener('click', function(){
    var type = b.getAttribute('data-period');
    document.querySelectorAll('.period-btn').forEach(function(x){ x.classList.toggle('active', x===b); });
    var crow = $id('fin-custom-row');
    if(type === 'custom'){ if(crow) crow.style.display='flex'; return; }  // wait for طبّق
    if(crow) crow.style.display='none';
    setPeriod(financePeriod, type);
    financeChartManual = false;             // chart auto-follows the new period
    financeChartPeriod = autoChartGran();
    renderFinance();
  });
});

// Chart period toggle (daily/weekly/monthly/yearly)
document.querySelectorAll('.chart-period-btn').forEach(function(b){
  b.addEventListener('click', function(){
    financeChartManual = true;   // user override — stops auto-following the period
    financeChartPeriod = b.getAttribute('data-cp');
    document.querySelectorAll('.chart-period-btn').forEach(function(x){ x.classList.toggle('active', x===b); });
    renderFinanceChart();
  });
});
$id('fin-custom-apply').addEventListener('click', function(){
  var from = $id('fin-from').value;
  var to = $id('fin-to').value;
  if(!from || !to){ toast('اختر التاريخين','er'); return; }
  if(from > to){ var sw=from; from=to; to=sw; }
  setPeriod(financePeriod, 'custom', from, to);
  document.querySelectorAll('.period-btn').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-period')==='custom'); });
  financeChartManual = false;
  financeChartPeriod = autoChartGran();   // chart follows the custom range
  renderFinance();
});
// Finance tabs
document.querySelectorAll('.stock-tab[data-ftab]').forEach(function(b){
  b.addEventListener('click', function(){
    financeCurrentTab = b.getAttribute('data-ftab');
    document.querySelectorAll('.stock-tab[data-ftab]').forEach(function(x){ x.classList.toggle('active', x===b); });
    $id('finance-overview-tab').style.display = financeCurrentTab==='overview' ? 'block' : 'none';
    $id('finance-expenses-tab').style.display = financeCurrentTab==='expenses' ? 'block' : 'none';
  });
});
$id('exp-search').addEventListener('input', renderExpenses);
$id('exp-filter-cat').addEventListener('change', renderExpenses);
$id('add-expense-btn').addEventListener('click', function(){ openExpenseEditor(null); });
if($id('issues-refresh'))$id('issues-refresh').addEventListener('click',loadIssues);
if($id('issues-search'))$id('issues-search').addEventListener('input',renderIssuesTable);
if($id('issues-filter-prio'))$id('issues-filter-prio').addEventListener('change',renderIssuesTable);
if($id('issues-filter-scope'))$id('issues-filter-scope').addEventListener('change',renderIssuesTable);

// ═══════════════════ END FINANCE SECTION ═══════════════════════

// ═══════════════════ INFO TOOLTIP (floating, never clipped) ═══════════════
(function initInfoTooltips(){
  var tip = document.createElement('div');
  tip.id = 'sc-floating-tip';
  document.body.appendChild(tip);

  function showTip(icon){
    var text = icon.getAttribute('data-tip');
    if(!text) return;
    tip.textContent = text;
    tip.classList.add('show');
    // Measure after content set
    var r = icon.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    // Position above the icon, aligned so arrow (right:18px) points near icon
    var left = r.left + r.width/2 - (tw - 18);
    var top = r.top - th - 10;
    // Keep within viewport
    if(left < 8) left = 8;
    if(left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    if(top < 8){ // not enough room above → show below
      top = r.bottom + 10;
      tip.style.setProperty('--arrow-side','top');
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip(){ tip.classList.remove('show'); }

  document.addEventListener('mouseover', function(e){
    var icon = e.target.closest('.sc-info');
    if(icon) showTip(icon);
  });
  document.addEventListener('mouseout', function(e){
    if(e.target.closest('.sc-info')) hideTip();
  });
  // Mobile: tap to toggle
  document.addEventListener('click', function(e){
    var icon = e.target.closest('.sc-info');
    if(icon){
      if(tip.classList.contains('show')) hideTip();
      else showTip(icon);
      e.stopPropagation();
    } else {
      hideTip();
    }
  });
})();

}
// Auto-init on page load — no setup screen needed
// ── ترتيب التشغيل ────────────────────────────────────────────────
// كان ضمنياً بترتيب السطور في الملف: أي نقل نود أو تقسيم لموديولات
// كان بيغيّره في صمت. بقى صريح ومقصود. الترتيب هنا = الترتيب اللي
// كان بيحصل فعلاً قبل التغيير.
initClickActions();
initReadyCard();
initTourResize();
initLoginForm();
initSignupForm();
initRefreshAndSearch();
initFilterDropdowns();
initOrdersUI();
initNavAndStock();
wireSettingsEvents();
initFinanceAndIssues();

initApp();
