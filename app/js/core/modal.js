// مودال تأكيد عام — أيقونة وعنوان وزرار ومدخل اختياري

import { $id } from './dom.js';

// ── Custom Modal (replaces browser confirm/prompt) ──────────────
export function showModal(opts){
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
