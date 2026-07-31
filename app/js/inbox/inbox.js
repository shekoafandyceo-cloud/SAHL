// صندوق محادثات الواتساب — الحالة والتحميل والرسم والإرسال والتسميات

import { veilDone } from '../core/veil.js';
import { statusClass, statusLabel } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { normalizePhone } from '../core/format.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { waMsgInner, waTicks, waTimeShort } from './message-view.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { showPage } from '../main.js';
import { currentTenantId } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { inboxVerified, refreshInboxGate, renderInboxLocked } from '../orders/billing-summary.js';
import { openDetail } from '../orders/detail.js';
import { ensureTenant } from '../orders/guards.js';

export var waRenderedState=[], waUrlCache={};  // حالة رسم الإنبوكس

export var waConvos=[], waActiveId=null, waPollTimer=null, waRenderedCount=0;

export function waInitials(name,phone){
  var s=(name||'').trim();
  if(s) return s.charAt(0);
  var p=(phone||'').replace(/\D/g,'');
  return p?p.slice(-2):'؟';
}

export function loadInbox(){
  // wa-list-body ممكن تكون مش موجودة لو renderInboxLocked استبدلت الصفحة —
  // حارس بدل ما نقع (الهشاشة دي اتكشفت في اختبار الحجاب)
  if(tourActive){ var wlb=$id('wa-list-body'); if(wlb)wlb.innerHTML='<div class="wa-empty">التبويب ده بيشتغل بالرسائل الحقيقية بعد ما تخلّص الجولة.</div>'; return; }
  if(!ensureTenant()){veilDone('inbox');return;}
  if(inboxVerified === false){ renderInboxLocked(); veilDone('inbox'); return; }
  if(inboxVerified === null){
    refreshInboxGate().then(function(ok){ if(!ok){ renderInboxLocked(); veilDone('inbox'); } else { loadInbox(); } });
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

export function waFetchConvos(showLoading){
  if(!sb||!currentTenantId) return;
  if(showLoading) $id('wa-list-body').innerHTML='<div class="wa-empty">جاري التحميل…</div>';
  sb.from('wa_conversations').select('*').eq('tenant_id',currentTenantId)
    .order('last_message_at',{ascending:false,nullsFirst:false}).limit(200).then(function(r){
      if(r.error){ $id('wa-list-body').innerHTML='<div class="wa-empty">تعذّر تحميل المحادثات</div>'; veilDone('inbox'); return; }
      waConvos=r.data||[];
      renderConvos();
      veilDone('inbox');
    });
}

export var waSearchQuery='', waFilter='all';

export function waConvMatches(c){
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

export function waBuildFilters(){
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

export function waSetFilter(f){
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

export function renderConvos(){
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

export function openConversation(id){
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

export function waFetchMessages(convId,scroll,isPoll){
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

export function waResolveUrls(paths, cb){
  var now=Date.now(), need=[];
  for(var i=0;i<paths.length;i++){ var p=paths[i]; if(p){ var c=waUrlCache[p]; if(!c || c.exp<now) need.push(p); } }
  function out(){ var map={}; for(var k in waUrlCache){ if(waUrlCache[k].exp>=now) map[k]=waUrlCache[k].url; } cb(map); }
  if(!need.length){ out(); return; }
  sb.storage.from('wa-media').createSignedUrls(need,3600).then(function(res){
    if(res && res.data){ for(var x=0;x<res.data.length;x++){ var it=res.data[x]; if(it && it.signedUrl) waUrlCache[it.path]={url:it.signedUrl, exp:now+3000*1000}; } }
    out();
  }).catch(function(){ out(); });
}

export function waScrollBottom(box){ box.scrollTop=box.scrollHeight; setTimeout(function(){ if(box) box.scrollTop=box.scrollHeight; }, 250); }

export function renderMessages(msgs,scroll){
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

export function waMarkRead(convId){
  if(!sb||!currentTenantId) return;
  sb.from('wa_messages').update({is_read:true}).eq('conversation_id',convId).eq('direction','in').eq('is_read',false).then(function(){});
  sb.from('wa_conversations').update({unread_count:0}).eq('id',convId).eq('tenant_id',currentTenantId).then(function(r){
    if(!r||!r.error){ for(var i=0;i<waConvos.length;i++){ if(waConvos[i].id===convId){ waConvos[i].unread_count=0; break; } } renderConvos(); }
  });
}

// ----- إرسال (مرحلة 2) -----
export var waPendingImage=null, waPendingDoc=null;

export function waUpdateWindow(c){
  var lastIn=(c&&c.last_inbound_at)?new Date(c.last_inbound_at).getTime():0;
  var open=lastIn && (Date.now()-lastIn) < 24*3600*1000;
  var banner=$id('wa-window-closed'), row=$id('wa-compose-row');
  if(banner) banner.style.display=open?'none':'block';
  if(row) row.style.display=open?'flex':'none';
}

export function waPickImage(e){
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

export function waPickFile(e){
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

export function waClearImage(){
  waPendingImage=null; waPendingDoc=null;
  var prev=$id('wa-attach-preview'); if(prev){ prev.style.display='none'; prev.innerHTML=''; }
  var f=$id('wa-file'); if(f) f.value='';
  var df=$id('wa-docfile'); if(df) df.value='';
}

export function waAppendOptimistic(text,kind,url,docName){
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

export function waSend(){
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
export function handleWaRealtime(payload){
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

export function waEnsureNotifyPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission==='default'){ try{ Notification.requestPermission(); }catch(e){ swallow('waEnsureNotifyPermission/Notification.requestPermission', e); } }
}

export function waNotify(m){
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
export var waQuickReplies=[];

export function waLoadQuickReplies(){
  if(!sb||!currentTenantId) return;
  sb.from('wa_quick_replies').select('id,body').eq('tenant_id',currentTenantId).order('sort',{ascending:true}).order('created_at',{ascending:true}).then(function(r){
    if(r.error) return;
    waQuickReplies=r.data||[];
    waRenderQuickReplies();
  });
}

export function waRenderQuickReplies(){
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

export function waSaveQuickReply(){
  var inp=$id('wa-input'); var body=inp?(inp.value||'').trim():'';
  if(!body){ toast('اكتب الرد الأول في الخانة','er'); return; }
  if(!sb||!currentTenantId) return;
  sb.from('wa_quick_replies').insert({tenant_id:currentTenantId,body:body}).select('id,body').single().then(function(r){
    if(r.error){ toast('تعذّر الحفظ','er'); return; }
    waQuickReplies.push(r.data); waRenderQuickReplies(); toast('اتحفظ كرد جاهز ✅','ok');
  });
}

export function waDeleteQuickReply(id){
  if(!id||!sb) return;
  sb.from('wa_quick_replies').delete().eq('id',id).then(function(r){
    if(r.error){ toast('تعذّر الحذف','er'); return; }
    waQuickReplies=waQuickReplies.filter(function(x){return x.id!==id;}); waRenderQuickReplies();
  });
}

// ----- تصنيفات وملاحظات المحادثة -----
export var WA_LABELS=[
  {k:'مهم',c:'#ef4444'},
  {k:'VIP',c:'#8b5cf6'},
  {k:'شكوى',c:'#f59e0b'},
  {k:'تم الحل',c:'#10b981'},
  {k:'متابعة',c:'#2563eb'}
];

export function waLabelColor(k){ for(var i=0;i<WA_LABELS.length;i++){ if(WA_LABELS[i].k===k) return WA_LABELS[i].c; } return '#64748b'; }

export function waLoadConvMeta(conv){
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

export function waRenderConvLabels(conv){
  var c=$id('wa-clabels'); if(!c) return;
  var labels=(conv&&conv.labels)||[];
  if(!labels.length){ c.innerHTML='<span style="font-size:.72rem;color:var(--muted)">مفيش تصنيف</span>'; return; }
  var html='';
  for(var i=0;i<labels.length;i++){ html+='<span class="wa-clabel" style="background:'+waLabelColor(labels[i])+'">'+esc(labels[i])+'</span>'; }
  c.innerHTML=html;
}

export function waRenderLabelPicker(conv){
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

export function waToggleLabel(label){
  var conv=waConvos.filter(function(x){return x.id===waActiveId;})[0];
  if(!conv||!sb) return;
  var labels=(conv.labels||[]).slice();
  var idx=labels.indexOf(label);
  if(idx>=0) labels.splice(idx,1); else labels.push(label);
  conv.labels=labels;
  waRenderConvLabels(conv); waRenderLabelPicker(conv); renderConvos();
  sb.from('wa_conversations').update({labels:labels}).eq('id',conv.id).then(function(r){ if(r.error) toast('تعذّر حفظ التصنيف','er'); });
}

export function waSaveNote(){
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

export function waSetNavBadge(n){
  var b=$id('wa-nav-badge'); if(!b) return;
  if(n && n>0){ b.textContent = n>99?'99+':String(n); b.style.display='inline-flex'; }
  else { b.style.display='none'; }
}

export function waRefreshNavBadge(){
  if(!sb||!currentTenantId) return;
  sb.from('wa_conversations').select('unread_count').eq('tenant_id',currentTenantId).then(function(r){
    if(r.error) return;
    var total=0; (r.data||[]).forEach(function(c){ total+=(c.unread_count||0); });
    waSetNavBadge(total);
  });
}

// ----- أوردرات العميل جوّه الشات -----
export function waDateShort(iso){
  if(!iso) return '';
  try{ return new Date(iso).toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit',year:'2-digit'}); }catch(e){ return ''; }
}

export function waLoadOrders(conv){
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

// تفاعلات صندوق المحادثات
export function initInbox(){
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
}
