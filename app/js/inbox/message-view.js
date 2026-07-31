// بناء HTML فقاعة الرسالة وعلامات القراءة

import { esc } from '../core/dom.js';

export function waTimeShort(iso){
  if(!iso) return '';
  var d=new Date(iso), now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString('ar-EG-u-nu-latn',{hour:'2-digit',minute:'2-digit'});
  var y=new Date(now); y.setDate(now.getDate()-1);
  if(d.toDateString()===y.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar-EG-u-nu-latn',{day:'2-digit',month:'2-digit'});
}

export function waTicks(status){
  if(status==='read') return '<span class="wa-tick read">✓✓</span>';
  if(status==='delivered') return '<span class="wa-tick">✓✓</span>';
  if(status==='failed') return '<span class="wa-tick fail">!</span>';
  return '<span class="wa-tick">✓</span>'; // sent / غير محدد
}

export function waMsgInner(m, urlMap){
  var side=m.direction==='out'?'out':'in';
  var inner='';
  if(m.media_path && (m.type==='image'||m.type==='sticker')){
    var u=urlMap[m.media_path];
    inner+= u?'<a href="'+esc(u)+'" target="_blank" rel="noopener"><img class="wa-img" src="'+esc(u)+'" loading="lazy"></a>':'<div class="wa-media-fail">📷 الصورة ماتحمّلتش</div>';
    if(m.body) inner+='<div class="wa-cap">'+esc(m.body)+'</div>';
  } else if(m.media_path && (m.type==='voice'||m.type==='audio')){
    var ua=urlMap[m.media_path];
    inner+= ua?'<audio class="wa-audio" controls preload="none" src="'+esc(ua)+'"></audio>':'<div class="wa-media-fail">🎤 الصوت ماتحمّلش</div>';
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
