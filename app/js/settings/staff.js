// موظفين المتجر — عرض وإضافة وتعطيل وحذف، كله عبر Edge Function `tenant-staff`.
//
// ليه Edge Function ومش نداء مباشر؟
//  - الإيميلات في `auth.users` والمتصفح مايقراهاش خالص
//  - إنشاء حساب بباسورد محتاج service_role — وده عمره ما ينزل للمتصفح
//  - الـRLS بتسمح لأدمن التاجر يقرا بروفايلات متجره بس (SELECT)، أما
//    INSERT/UPDATE/DELETE فسوبر أدمن بس — فالكتابة لازم تعدّي من السيرفر
//
// 🔴 المتجر بيتحدد من الـJWT جوّه الـFunction مش من هنا. أي `tenant_id`
// نبعته من المتصفح بيتطنّش — عشان تعديل الطلب من الكونسول مايوصلش لمتجر تاني.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../core/config.js';
import { $id, esc } from '../core/dom.js';
import { fmtDT } from '../core/format.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { isAdmin } from '../orders/guards.js';

export var staffUsers = [];

export function staffSetUsers(v){ staffUsers = v || []; }

// جيل التحميل — ضغطتين متتاليتين على ↻ كانوا ممكن يرندروا رد أقدم فوق أحدث
var staffGen = 0;

// نداء الـFunction — الـJWT بيتقرا وقت النداء لأن الجلسة بتتجدّد لوحدها
export async function staffCall(action, payload){
  var sess = await sb.auth.getSession();
  var tk = sess && sess.data && sess.data.session ? sess.data.session.access_token : null;
  if(!tk) throw new Error('جلسة الدخول انتهت. سجّل دخول تاني.');
  var res = await fetch(SUPABASE_URL + '/functions/v1/tenant-staff', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + tk },
    body: JSON.stringify(Object.assign({ action: action }, payload || {}))
  });
  var out = await res.json().catch(function(){ return {}; });
  if(!res.ok || !out.ok) throw new Error(out.message || 'حصلت مشكلة — حاول تاني');
  return out;
}

export function loadStaff(){
  if(!isAdmin()) return;
  var box = $id('staff-list');
  if(!box) return;
  var myGen = ++staffGen;
  box.innerHTML = '<div class="ldg"><div class="spin"></div>جاري تحميل الموظفين...</div>';
  staffCall('list').then(function(out){
    if(myGen !== staffGen) return;   // رد أقدم وصل بعد أحدث
    staffSetUsers(out.users || []);
    renderStaff();
  }).catch(function(e){
    if(myGen !== staffGen) return;
    box.innerHTML = '<div class="staff-err">مقدرناش نحمّل الموظفين — ' + esc(e.message || '') + '</div>';
  });
}

export function renderStaff(){
  var box = $id('staff-list');
  if(!box) return;
  if(!staffUsers.length){
    box.innerHTML = '<div class="staff-empty">لسه مفيش موظفين — أضف أول واحد من تحت.</div>';
    return;
  }
  var h = '<div class="staff-rows">';
  staffUsers.forEach(function(u){
    var roleLbl = u.role === 'admin' ? '👑 أدمن' : '👤 موظف';
    var seen = u.last_seen ? ('آخر دخول: ' + fmtDT(u.last_seen)) : 'لسه مدخلش';
    h += '<div class="staff-row' + (u.active ? '' : ' off') + '">'
      + '<div class="staff-main">'
      +   '<div class="staff-name">' + esc(u.full_name || '—')
      +     '<span class="staff-role ' + (u.role === 'admin' ? 'ra' : 're') + '">' + roleLbl + '</span>'
      +     (u.is_self ? '<span class="staff-you">أنت</span>' : '')
      +     (u.active ? '' : '<span class="staff-off-badge">موقوف</span>')
      +   '</div>'
      +   '<div class="staff-sub"><span class="staff-mail">' + esc(u.email || '—') + '</span>'
      +     '<span class="staff-seen">' + esc(seen) + '</span></div>'
      + '</div>'
      + '<div class="staff-acts">'
      + (u.locked
          ? '<span class="staff-locked" title="' + (u.is_self ? 'مينفعش تعدّل على حسابك من هنا' : 'الحساب ده محمي') + '">🔒</span>'
          : '<button class="staff-btn ' + (u.active ? 'warn' : 'ok') + '" data-staff-toggle="' + esc(u.id) + '" data-active="' + (u.active ? '0' : '1') + '">'
              + (u.active ? 'إيقاف' : 'تفعيل') + '</button>'
            + '<button class="staff-btn del" data-staff-del="' + esc(u.id) + '">حذف</button>')
      + '</div></div>';
  });
  h += '</div>';
  box.innerHTML = h;

  box.querySelectorAll('[data-staff-toggle]').forEach(function(b){
    b.addEventListener('click', function(){
      toggleStaff(b.getAttribute('data-staff-toggle'), b.getAttribute('data-active') === '1', b);
    });
  });
  box.querySelectorAll('[data-staff-del]').forEach(function(b){
    b.addEventListener('click', function(){ deleteStaff(b.getAttribute('data-staff-del')); });
  });
}

function findStaff(id){
  for(var i = 0; i < staffUsers.length; i++){ if(staffUsers[i].id === id) return staffUsers[i]; }
  return null;
}

export function toggleStaff(id, makeActive, btn){
  var u = findStaff(id);
  if(!u) return;
  if(btn && btn.disabled) return;
  var go = function(){
    if(btn){ btn.disabled = true; btn.textContent = '...'; }
    staffCall('toggle', { user_id: id, active: makeActive }).then(function(){
      toast(makeActive ? ('تم تفعيل ' + (u.full_name || 'الموظف') + ' ✓') : ('تم إيقاف ' + (u.full_name || 'الموظف')), 'ok');
      loadStaff();
    }).catch(function(e){
      if(btn){ btn.disabled = false; }
      toast(e.message || 'مانفعش', 'er');
      loadStaff();
    });
  };
  if(!makeActive){
    showModal({
      icon: '⛔',
      title: 'إيقاف الموظف',
      sub: (u.full_name || 'الموظف') + ' مش هيقدر يسجّل دخول تاني.\n'
         + 'لو فاتح دلوقتي هيفضل شغّال لحد ما يقفل الصفحة أو يعمل تحديث.',
      okLabel: 'إيقاف',
      okColor: 'linear-gradient(135deg,#f59e0b,#d97706)',
      onOk: go
    });
    return;
  }
  go();
}

export function deleteStaff(id){
  var u = findStaff(id);
  if(!u) return;
  showModal({
    icon: '🗑️',
    title: 'حذف الموظف نهائياً',
    sub: 'هتمسح حساب ' + (u.full_name || '') + ' (' + (u.email || '') + ') خالص، ومش هينفع يرجع.\n\n'
       + 'اسمه هيفضل مكتوب في سجل الأوردرات اللي اشتغل عليها — بس من غير حساب وراه.\n'
       + 'لو عايز توقفه بس، استخدم «إيقاف».',
    okLabel: 'حذف نهائي',
    okColor: 'linear-gradient(135deg,#ef4444,#dc2626)',
    onOk: function(){
      staffCall('delete', { user_id: id }).then(function(){
        toast('تم حذف الموظف', 'ok');
        loadStaff();
      }).catch(function(e){ toast(e.message || 'مانفعش', 'er'); loadStaff(); });
    }
  });
}

export function addStaff(){
  var btn = $id('staff-add');
  if(btn && btn.disabled) return;   // دبل-كليك على شبكة بطيئة = محاولتين إنشاء
  var name  = ($id('staff-name').value  || '').trim();
  var email = ($id('staff-email').value || '').trim().toLowerCase();
  var pass  = ($id('staff-pass').value  || '');
  var role  = $id('staff-role').value === 'admin' ? 'admin' : 'employee';

  // التحقق هنا للراحة بس — السيرفر بيتحقق تاني وهو الحاجز الحقيقي
  if(!name){ toast('اكتب اسم الموظف','er'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast('البريد الإلكتروني مش مظبوط','er'); return; }
  if(pass.length < 8){ toast('كلمة المرور لازم 8 حروف على الأقل','er'); return; }

  var orig = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'جاري الإنشاء...'; }
  staffCall('create', { full_name: name, email: email, password: pass, role: role }).then(function(){
    if(btn){ btn.disabled = false; btn.textContent = orig; }
    $id('staff-name').value = '';
    $id('staff-email').value = '';
    $id('staff-pass').value = '';
    $id('staff-role').value = 'employee';
    toast('تم إنشاء حساب ' + name + ' ✓ — اديله البريد والباسورد', 'ok');
    loadStaff();
  }).catch(function(e){
    if(btn){ btn.disabled = false; btn.textContent = orig; }
    toast(e.message || 'مانفعش', 'er');
  });
}

export function wireStaffEvents(){
  var add = $id('staff-add');
  if(add) add.addEventListener('click', addStaff);
  // Enter في أي حقل = إضافة
  ['staff-name','staff-email','staff-pass'].forEach(function(id){
    var el = $id(id);
    if(el) el.addEventListener('keydown', function(ev){ if(ev.key === 'Enter'){ ev.preventDefault(); addStaff(); } });
  });
  try{ if($id('staff-pass')) $id('staff-pass').setAttribute('autocomplete','new-password'); }
  catch(e){ swallow('wireStaffEvents/autocomplete', e); }
}
