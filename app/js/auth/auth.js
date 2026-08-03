// الدخول والتسجيل والخروج وهوية المستأجر

import { refreshSetupChecklist } from '../ui/setup-checklist.js';
import { maybeShowExpiryBanner, subscriptionLockState } from '../billing/expiry.js';
import { $id, esc } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { loadAll } from '../orders/orders.js';
import { ensureTenant } from '../orders/guards.js';
import { realtimeChannel, realtimeSetChannel } from '../orders/state.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.

export var currentRole = null; // 'admin' or 'employee'
export var currentUser = null; // { email, name, role, tenant_id }
export var currentTenantId = null; // comes from user_profiles.tenant_id after login
export var currentTenant = null; // safe tenant info from public.tenants

export function hasTenant(){return !!currentTenantId;}

export function tenantDisplayName(){
  if(currentTenant && (currentTenant.store_name || currentTenant.slug)){
    return currentTenant.store_name || currentTenant.slug;
  }
  return 'سهل';
}

export function applyTenantBranding(){
  var name = tenantDisplayName();
  if($id('brand-logo'))$id('brand-logo').textContent = name;
  if($id('login-logo'))$id('login-logo').textContent = '🔐 ' + name;
  if($id('setup-logo'))$id('setup-logo').textContent = '🗂 ' + name;
  document.title = name + ' — لوحة الطلبات';
}

export function resetTenantBranding(){
  currentTenant = null;
  if($id('brand-logo'))$id('brand-logo').textContent = 'سهل';
  if($id('login-logo'))$id('login-logo').textContent = '🔐 سهل';
  if($id('setup-logo'))$id('setup-logo').textContent = '🗂 سهل';
  document.title = 'سهل — لوحة الطلبات';
}

export function showSubscriptionLock(t, reason){
  currentTenant = null;
  try{ sb.auth.signOut(); }catch(e){ swallow('showSubscriptionLock/sb.auth.signOut', e); }
  $id('login').style.display = 'none';
  $id('app').style.display = 'none';
  var existing = document.getElementById('sub-lock');
  if(existing) existing.remove();
  // esc لأن الاسم بيتحقن في innerHTML تحت — اسم متجر فيه < أو markup
  // كان بيترندر HTML على شاشة القفل
  var store = esc((t && (t.store_name || t.slug)) || 'متجرك');
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

export function loadTenantAndEnter(){
  if(!ensureTenant())return;
  // v_my_tenant: الـ view بيفلتر بالتاجر جواه وبيحجب المفاتيح عن غير الأدمن.
  // tenant_subscription_state: حالة الاشتراك محسوبة بساعة السيرفر (computed_status
  // وdays_remaining) — الحكم بيها مش بساعة جهاز التاجر: ساعة متأخرة كانت بتفتح
  // حساب منتهي، ومتقدمة كانت بتقفل حساب دافع.
  Promise.all([
    sb.from('v_my_tenant')
      .select('id,slug,store_name,shipping_provider,active,created_at,plan,plan_expires_at,subscription_status,grace_period_days,monthly_price')
      .eq('id', currentTenantId)
      .single(),
    sb.from('tenant_subscription_state')
      .select('id,computed_status,days_remaining')
      .eq('id', currentTenantId)
      .maybeSingle()
  ]).then(function(res){
      var r = res[0], srv = res[1];
      if(r.error || !r.data){
        $id('login-err').textContent = 'حصلت مشكلة في تحميل بيانات الحساب. تواصل مع الدعم.';
        $id('login').style.display = 'flex';
        $id('app').style.display = 'none';
        currentTenant = null;
        return;
      }
      // فشل قراءة حالة السيرفر مش بيقفل الدخول — بنرجع لحساب الساعة المحلية
      if(srv && !srv.error && srv.data){
        r.data.computed_status = srv.data.computed_status;
        r.data.days_remaining_server = srv.data.days_remaining;
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
      $id('app').style.cssText = 'display:flex;';   // الاتجاه والارتفاع من CSS (.sidenav layout) — مش inline (درس 27)
      maybeShowExpiryBanner(r.data, lockState);
      loadAll();
      // loadWalletState بتتنده جوّه loadAll() — النداء التاني هنا كان بيطلق
      // طلبين متزامنين لنفس الفيو والردود مالهاش ترتيب مضمون
      refreshSetupChecklist();  // كارت تجهيز المتجر — أدمن بس وبيقفل نفسه لما يكمل
    });
}

export function fetchProfileAndEnter(authUser){
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
    // كارت المستخدم أسفل السايدبار — نفس البيانات، مكانها الطبيعي في شكل SaaS
    var snUser = $id('sn-user');
    if(snUser){
      snUser.style.display = '';
      $id('sn-avatar').textContent = (currentUser.name || '؟').trim().charAt(0) || '؟';
      $id('sn-uname').textContent = currentUser.name;
      $id('sn-urole').textContent = profile.role === 'admin' ? '👑 أدمن' : '👤 موظف';
    }
    // Load safe tenant info and enter the dashboard.
    loadTenantAndEnter();
  });
}

export function loginErrorMessage(error){
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
  return 'مش قادرين ندخّلك دلوقتي. حاول تاني أو تواصل مع الدعم.';
}

export function doLogin(){
  var email = $id('login-user').value.trim();
  var pass = $id('login-pass').value;
  $id('login-err').textContent = '';
  if(!email || !pass){
    $id('login-err').textContent = 'اكتب البريد وكلمة المرور الأول';
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
export var _suspending = false;

export function forceSuspendLogout(){
  if(_suspending) return;
  _suspending = true;
  try{ if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeSetChannel(null); } }catch(e){ swallow('forceSuspendLogout/sb.removeChannel', e); }
  // reload كامل زي doLogout بالظبط — التنضيف اليدوي القديم كان بيسيب
  // كاشات الموديولات (المحفظة/الإنبوكس/المخزون) وwaPollTimer والـDOM
  // المرندر عايشين لجلسة الحساب اللي بعده على نفس التاب.
  // الرسالة بتوصل لشاشة اللوجين بعد الـreload عبر sessionStorage.
  function finish(){
    try{ sessionStorage.setItem('sahl_suspend_msg','1'); }catch(e){ swallow('forceSuspendLogout/sessionStorage', e); }
    location.reload();
  }
  sb.auth.signOut().then(finish).catch(finish);
}

export function doLogout(){
  showModal({
    icon:'🚪',
    title:'تسجيل الخروج',
    sub:'هتخرج من الحساب دلوقتي.\nمتأكد؟',
    okLabel:'خروج',
    okColor:'linear-gradient(135deg,#ef4444,#dc2626)',
    onOk:function(){
      sb.auth.signOut().then(function(){
        // reload كامل بدل التنضيف اليدوي: الكاشات الموديولية (منتجات
        // المخزون بأسعارها، بوابة الإنبوكس، المحادثات...) والـDOM المرندر
        // كانوا بيعيشوا للحساب اللي بعده — أسرع عزل مضمون بين الجلسات.
        // التفضيلات (sahl_dark وأخواتها) في localStorage فبتعيش عادي.
        location.reload();
      });
    }
  });
}

// Login wireup
// نموذج الدخول والخروج
export function initLoginForm(){
  $id('login-btn').addEventListener('click', doLogin);
  $id('login-pass').addEventListener('keydown', function(e){ if(e.key === 'Enter') doLogin(); });
  $id('login-user').addEventListener('keydown', function(e){ if(e.key === 'Enter') $id('login-pass').focus(); });
  $id('logout-btn').addEventListener('click', doLogout);

  // =====================================================
  //  SIGNUP — view switching + handler
  // =====================================================
}

export function showAuthView(name){
  // hide all sboxes inside #login
  var login = document.querySelector('#login .sbox:not(#signup-view):not(#check-email-view)');
  var signup = $id('signup-view');
  var checkEmail = $id('check-email-view');
  if(login)      login.style.display      = (name === 'login')       ? '' : 'none';
  if(signup)     signup.style.display     = (name === 'signup')      ? '' : 'none';
  if(checkEmail) checkEmail.style.display = (name === 'check-email') ? '' : 'none';
}

// التسجيل وتبديل شاشات المصادقة
export function initSignupForm(){
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

export function doSignup(){
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
  if(!phone || phone.length !== 11 || phone.substring(0,2) !== '01'){ errEl.textContent = 'الموبايل لازم 11 رقم يبدأ بـ 01'; return; }
  if(!pass || pass.length < 6){ errEl.textContent = 'كلمة المرور لازم 6 أحرف'; return; }

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

export function signupErrorMessage(err){
  var msg = (err && (err.message || err.error_description || err.error)) || '';
  msg = String(msg).toLowerCase();
  if(msg.indexOf('already') >= 0 || msg.indexOf('registered') >= 0 || msg.indexOf('exists') >= 0){
    return 'البريد ده مسجل بالفعل. سجّل دخول أو استخدم بريد تاني.';
  }
  if(msg.indexOf('rate') >= 0 || msg.indexOf('too many') >= 0){
    return 'محاولات كتير في وقت قصير. استنى دقيقة وحاول تاني.';
  }
  if(msg.indexOf('password') >= 0){
    return 'كلمة المرور ضعيفة — لازم 6 أحرف على الأقل.';
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
export function bootstrapTenantIfNeeded(authUser, onDone){
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
