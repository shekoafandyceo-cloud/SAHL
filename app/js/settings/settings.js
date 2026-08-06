// صفحة الإعدادات والتكاملات وتفضيلات الإشعارات

import { veilDone } from '../core/veil.js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../core/config.js';
import { $id, esc } from '../core/dom.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { showPage } from '../main.js';
import { SECRET_NOT_READY, WA_WEBHOOK_BASE_URL, WEBHOOK_BASE_URL } from '../core/config.js';
import { swallow } from '../core/log.js';
import { copyWaCallbackUrl, copyWaVerifyToken, copyWebhookUrl } from './webhook.js';
import { loadStaff, wireStaffEvents } from './staff.js';
import { currentTenant, currentTenantId, currentUser } from '../auth/auth.js';
import { refreshInboxGate } from '../orders/billing-summary.js';
import { ensureTenant, isAdmin } from '../orders/guards.js';

export var settingsBotUsername = 'sahl_operations_bot'; // default until platform_settings loads

export var TG_LOCK_DAYS = 7;          // chat id can't be changed for this many days after being set

export var tgChatLocked = false;      // computed in renderSettings, read by saveTelegram

export function loadSettings(){
  if(!isAdmin()){veilDone('settings');return;}
  if(!ensureTenant()){veilDone('settings');return;}
  // Pull fresh tenant row + platform settings (bot username) in parallel
  Promise.all([
    sb.from('v_my_tenant').select('store_name,webhook_secret,wa_webhook_secret,plan,whatsapp_phone_id,whatsapp_token,shipping_api_key,telegram_chat_id,telegram_chat_id_set_at,error_notify_chat,whatsapp_confirmation_enabled')
      .eq('id', currentTenantId).maybeSingle(),
    sb.from('platform_settings').select('key,value').eq('key','telegram_bot_username').maybeSingle(),
    // حالة توثيق رقم الواتساب. بتتحمّل هنا عشان saveWhatsApp بتنادي
    // loadSettings بعد الحفظ الناجح — فالشارة بتتحدّث من غير أي refresh.
    sb.rpc('wa_inbox_status')
  ]).then(function(results){
    var tRes = results[0], pRes = results[1], wRes = results[2];
    if(tRes.error){ toast('خطأ في تحميل الإعدادات: '+tRes.error.message,'er'); veilDone('settings'); return; }
    var t = tRes.data || {};
    if(pRes && pRes.data && pRes.data.value){ settingsBotUsername = pRes.data.value; }
    renderSettings(t);
    renderWaVerifyBadge((wRes && !wRes.error) ? wRes.data : null);
    veilDone('settings');
    loadNotifyPrefs();
    loadStaff();   // قايمة الموظفين — نداء منفصل لأنها من Edge Function مش من الفيو
  });
}

// شارة حالة توثيق رقم الواتساب فوق خانات Phone Number ID والتوكن.
// المصدر: RPC `wa_inbox_status` →
//   { verified, verified_at, has_number, has_token, sahl_ready, wa_enabled }
export function renderWaVerifyBadge(st){
  var el = $id('set-wa-verify-badge');
  if(!el) return;

  // الـRPC بترجّع NULL لو مفيش صف تاجر. ساعتها إحنا **مش عارفين** الحالة،
  // وإظهار "شغّال على رقم سهل" وقتها ممكن يكون كذب على التاجر — فنخفيها.
  if(!st){ el.style.display = 'none'; el.className = 'wa-verify-badge off'; el.textContent = ''; return; }

  var tone, html;
  if(st.verified){
    var when = '';
    if(st.verified_at){
      var d = new Date(st.verified_at);
      if(!isNaN(d)){
        try{ when = d.toLocaleDateString('ar-EG-u-nu-latn', { timeZone:'Africa/Cairo', day:'numeric', month:'long', year:'numeric' }); }
        catch(e){ when = d.toLocaleDateString(); }
      }
    }
    tone = 'ok';
    html = '✅ الرقم متحقق منه' + (when ? ' <span class="wvb-when">— اتوثّق يوم ' + esc(when) + '</span>' : '');
  } else if(st.has_number || st.has_token){
    // أي بيانات محفوظة من غير توثيق — بما فيها الحالة الناقصة (رقم من غير
    // توكن أو العكس) اللي الحفظ بيمنعها بس الداتابيز ممكن تكون فيها من تعديل أدمن
    tone = 'warn';
    html = '⚠️ البيانات محفوظة بس مش متحقق منها — احفظ تاني عشان نتأكد من ميتا';
  } else if(st.sahl_ready){
    tone = 'off';
    html = 'شغّال على رقم سهل المشترك';
  } else if(st.wa_enabled){
    // مفيش رقم خاص ورقم سهل نفسه مش متظبط على مستوى المنصة — يعني
    // `wa_should_send` هترجّع sahl_number_not_configured وأي أوردر جديد
    // هيعدّي **من غير أي رسالة تأكيد**. قول الحقيقة بدل "شغّال على رقم سهل".
    tone = 'bad';
    html = '🚫 تأكيد الواتساب مفعّل بس مش هيشتغل — مفيش رقم خاص بيك ورقم سهل المشترك لسه مش جاهز';
  } else {
    tone = 'off';
    html = 'تأكيد الواتساب متقفل';
  }

  el.className = 'wa-verify-badge ' + tone;
  el.innerHTML = html;
  el.style.display = '';
}

export function renderSettings(t){
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
  if($id('set-webhook-url')) $id('set-webhook-url').value = wh || SECRET_NOT_READY;

  // ربط واتساب بميتا — Callback URL و Verify Token، الاتنين من wa_webhook_secret.
  // العمود بيرجع NULL لغير الأدمن (الفيو بتحرسه بـis_tenant_admin زي باقي الأسرار)،
  // وloadSettings أصلاً بترجع بدري لو المستخدم مش أدمن.
  var waSecret = t.wa_webhook_secret || '';
  if($id('set-wa-callback-url'))
    $id('set-wa-callback-url').value = waSecret ? (WA_WEBHOOK_BASE_URL + waSecret) : SECRET_NOT_READY;
  if($id('set-wa-verify-token'))
    $id('set-wa-verify-token').value = waSecret || SECRET_NOT_READY;

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

export function setNotifyGate(hasChat){
  var block = $id('np-block');
  if(block) block.classList.toggle('np-off', !hasChat);
  NOTIFY_KEYS.forEach(function(k){
    var el = $id('np-'+k);
    if(el) el.disabled = !hasChat;
  });
}

// ---- تفضيلات تنبيهات البوت ----
export var NOTIFY_KEYS = ['staff_activity','confirmations','cancellations','outgoing_today','daily_inventory'];

export function loadNotifyPrefs(){
  if(!sb) return;
  sb.rpc('get_notify_prefs').then(function(r){
    var prefs = (!r.error && r.data) ? r.data : {};
    NOTIFY_KEYS.forEach(function(k){
      var el = $id('np-'+k);
      if(el) el.checked = (prefs[k] === undefined || prefs[k] === null) ? true : !!prefs[k];
    });
  });
}

export function saveNotifyPref(key){
  var el = $id('np-'+key); if(!el) return;
  var desired = !!el.checked;
  el.disabled = true;
  var payload = {}; payload[key] = desired;
  sb.rpc('update_notify_prefs', { p_prefs: payload }).then(function(r){
    el.disabled = false;
    if(r.error){
      el.checked = !desired;
      var m = r.error.message || '';
      toast(m.indexOf('admin_only')>=0 ? 'الصلاحية دي للأدمن فقط' : ('الحفظ مانفعش: '+m), 'er');
      return;
    }
    toast(desired ? 'التنبيه اتفعّل ✓' : 'التنبيه اتقفل', 'ok');
  }).catch(function(e){
    el.disabled = false; el.checked = !desired;
    toast('خطأ: '+(e.message||e),'er');
  });
}

// Toggle password→text on secret inputs
export function toggleSecretVisibility(ev){
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
export function saveIntegrations(payload, sectionLabel, btn, onDone){
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

export function saveBosta(){
  var btn = $id('set-save-bosta');
  var key = ($id('set-bosta-key').value || '').trim();
  saveIntegrations({ p_shipping_api_key: key }, 'شركة الشحن', btn);
}

// Auto-save the WhatsApp-confirmation on/off toggle. Reverts visual state on failure.
export function saveWaConfirmToggle(){
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
export async function saveWhatsApp(){
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
      toast(out.message || 'مقدرناش نتحقق من البيانات — راجعها وحاول تاني.','er');
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

export function saveTelegram(){
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
export function sendTelegramConfirm(chatId){
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
export function wireSettingsEvents(){
  if($id('set-webhook-copy')) $id('set-webhook-copy').addEventListener('click', copyWebhookUrl);
  if($id('set-wa-callback-copy')) $id('set-wa-callback-copy').addEventListener('click', copyWaCallbackUrl);
  if($id('set-wa-verify-copy'))   $id('set-wa-verify-copy').addEventListener('click', copyWaVerifyToken);
  if($id('set-save-bosta'))   $id('set-save-bosta').addEventListener('click', saveBosta);
  if($id('set-save-wa'))      $id('set-save-wa').addEventListener('click', saveWhatsApp);
  if($id('set-wa-confirm-toggle')) $id('set-wa-confirm-toggle').addEventListener('change', saveWaConfirmToggle);
  if($id('set-save-tg'))      $id('set-save-tg').addEventListener('click', saveTelegram);
  wireStaffEvents();
  document.querySelectorAll('.settings-eye-btn').forEach(function(b){
    b.addEventListener('click', toggleSecretVisibility);
  });
  NOTIFY_KEYS.forEach(function(k){
    var el = $id('np-'+k);
    if(el) el.addEventListener('change', function(){ saveNotifyPref(k); });
  });
}
