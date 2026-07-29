// نسخ للحافظة مع بديل للمتصفحات القديمة

import { esc } from '../core/dom.js';

// Build a value with a copy button — used for copyable fields (name, phones, address)
export function copyable(val,label){
  if(!val||val==='—')return '<span class="dval ar">—</span>';
  var safe=esc(val);
  var raw=String(val).replace(/"/g,'&quot;');
  var copyIco='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  return '<span class="dval-wrap"><span class="dval ar" style="white-space:normal;max-width:300px">'+safe+'</span>'
    +'<button class="copy-btn" data-copy="'+raw+'" data-label="'+esc(label||'')+'" title="نسخ">'+copyIco+'</button></span>';
}

export function attachCopyHandlers(){
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

export function fallbackCopy(text,onDone){
  var ta=document.createElement('textarea');
  ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');onDone&&onDone();}catch(e){toast('فشل النسخ','er');}
  document.body.removeChild(ta);
}

// نسخ نص جاهز للحافظة (مع fallback) — يستخدمه زرار نسخ المنتجات
export function copyTextToClipboard(txt,label){
  if(!txt){toast('لا يوجد شيء للنسخ','er');return;}
  var done=function(){toast('تم نسخ '+(label||'النص')+' ✓','ok');};
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done,function(){fallbackCopy(txt,done);});
  }else{fallbackCopy(txt,done);}
}
