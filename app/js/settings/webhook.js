// نسخ الحقول اللي للقراءة بس في صفحة الإعدادات
// (رابط استقبال الأوردرات · Callback URL و Verify Token بتوع واتساب)

import { SECRET_NOT_READY } from '../core/config.js';
import { $id } from '../core/dom.js';
import { toast } from '../core/toast.js';

// نسخ قيمة حقل للقراءة بس مع أثر بصري على الزرار.
// requireUrl: للحقول اللي المفروض تبقى رابط — بيمنع نسخ أي نص تاني.
export function copyReadonlyField(inputId, btnId, requireUrl, emptyMsg){
  var input = $id(inputId);
  var btn = $id(btnId);
  var v = input ? input.value : '';
  // النص البديل بتاع "لسه مااتولّدش" مش قيمة — ماينفعش يتنسخ
  if(!input || !btn || !v || v === SECRET_NOT_READY || (requireUrl && v.indexOf('http') !== 0)){
    toast(emptyMsg || 'مفيش حاجة تتنسخ','er'); return;
  }
  var doneVisual = function(){
    var orig = btn.textContent;
    btn.classList.add('copied');
    btn.textContent = '✓ تم النسخ';
    setTimeout(function(){ btn.classList.remove('copied'); btn.textContent = orig; }, 1500);
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(v).then(doneVisual).catch(function(){
      // fallback to manual selection
      input.select(); document.execCommand('copy'); doneVisual();
    });
  } else {
    input.select(); document.execCommand('copy'); doneVisual();
  }
}

// Copy webhook URL to clipboard with visual feedback
export function copyWebhookUrl(){
  copyReadonlyField('set-webhook-url', 'set-webhook-copy', true, 'مفيش رابط يتنسخ');
}

// ربط واتساب بميتا
export function copyWaCallbackUrl(){
  copyReadonlyField('set-wa-callback-url', 'set-wa-callback-copy', true, 'مفيش رابط يتنسخ');
}

export function copyWaVerifyToken(){
  copyReadonlyField('set-wa-verify-token', 'set-wa-verify-copy', false, 'مفيش توكن يتنسخ');
}
