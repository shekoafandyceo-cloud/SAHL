// نسخ رابط الويب-هوك بتاع التاجر

import { $id } from '../core/dom.js';
import { toast } from '../core/toast.js';

// Copy webhook URL to clipboard with visual feedback
export function copyWebhookUrl(){
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
