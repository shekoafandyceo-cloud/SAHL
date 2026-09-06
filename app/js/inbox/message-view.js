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

// وسم الاسم — بيرجّع سترينج فاضي لو مفيش اسم أو الرسالة واردة
export function waSenderTag(m, side){
  if(side !== 'out') return '';
  var n = (m && m.sent_by_name) ? String(m.sent_by_name).trim() : '';
  if(!n) return '';
  return '<span class="wa-sender">'+esc(n)+'</span><span class="wa-sender-sep"> · </span>';
}

// مختصر الرسالة المقتبسة — نفس تسميات تريجر «آخر رسالة» عشان يبقى شكل واحد
function waQuoteSnippet(q, hasThumb){
  // مع المصغّرة الأيقونة بقت زيادة — الصورة نفسها بتقول إنها صورة
  if(q.type==='image'||q.type==='sticker'){
    return hasThumb ? (q.body || 'صورة') : ('📷 صورة'+(q.body?(' · '+q.body):''));
  }
  if(q.type==='voice'||q.type==='audio')   return '🎤 رسالة صوتية';
  if(q.type==='document')                  return '📎 '+(q.media_filename||'ملف');
  if(q.type==='video')                     return '🎬 فيديو';
  return q.body || q.type || '';
}

// 🔴 بلوك «رد على» — بيترسم بس لو الرسالة فيها `reply_to_wa_id`.
// `byWamid` خريطة من الرسايل **المحمّلة** (أحدث 500 للمحادثة).
// لو الرسالة المقتبسة مش فيها، بنقول «رسالة أقدم» **من غير ما نخترع نص**:
// بيحصل لما تكون أقدم من الـ500، أو رسالة تأكيد آلية من n8n **مش متسجّلة
// عندنا أصلاً** (كل الصادر المتسجّل ردود بشرية من اللوحة).
export function waQuoteBlock(m, byWamid, urlMap){
  var rid = m && m.reply_to_wa_id;
  if(!rid) return '';
  var q = byWamid ? byWamid[rid] : null;
  if(!q){
    return '<div class="wa-quote wa-quote-lost">↩︎ رد على رسالة أقدم</div>';
  }
  var who = q.direction==='out' ? (q.sent_by_name || 'إحنا') : 'العميل';
  // 🔴 مصغّرة الصورة (بلاغ المالك 6 سبتمبر): «📷 صورة» كانت بتقول إنه بيرد
  // على صورة **من غير ما تقول أنهي صورة** — والموظف اللي بيرد على عميل
  // بيسأل عن سعر منتج محتاج يشوف المنتج نفسه. والرابط الموقّع بييجي من
  // `urlMap` اللي اتحل أصلاً لرسايل المحادثة.
  var thumb = '';
  if((q.type==='image'||q.type==='sticker') && q.media_path && urlMap && urlMap[q.media_path]){
    thumb = '<img class="wa-quote-thumb" src="'+esc(urlMap[q.media_path])+'" alt="" loading="lazy">';
  }
  return '<div class="wa-quote'+(q.direction==='out'?' out':'')+'">'
    + thumb
    + '<span class="wa-quote-body">'
      +'<span class="wa-quote-who">'+esc(who)+'</span>'
      +'<span class="wa-quote-txt">'+esc(String(waQuoteSnippet(q, !!thumb)).slice(0,120))+'</span>'
    +'</span>'
    +'</div>';
}

// 🔴 زرار «رد» — بيظهر بس لو الرسالة ليها `wa_message_id`.
// واتساب بيطلب معرّف الرسالة المقتبسة، فرسالة من غيره **مايتردش عليها**
// — وزرار بيبان وهو مش شغال أسوأ من زرار مش موجود (درس 16).
// data-act مش onclick: الـCSP بترفض الـinline في صمت.
function waReplyBtn(m){
  if(!m || !m.wa_message_id) return '';
  return '<button class="wa-reply-btn" type="button" data-act="wa-reply" data-mid="'
    + esc(m.id) + '" title="رد على الرسالة دي" aria-label="رد على الرسالة دي">↩︎</button>';
}

export function waMsgInner(m, urlMap, byWamid){
  var side=m.direction==='out'?'out':'in';
  // الاقتباس **فوق** المحتوى زي واتساب بالظبط
  var inner=waReplyBtn(m)+waQuoteBlock(m, byWamid, urlMap);
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
  // اسم الموظف اللي رد (طلب المالك 6 سبتمبر) — للصادر بس.
  // 🔴 الرسايل قبل 6 سبتمبر 2026 مالهاش `sent_by_name` (548 رسالة وقت البناء)
  // فبتتعرض **من غير أي اسم**. مفيش fallback ومفيش «موظف» ولا اسم المتجر —
  // نسبة مخترعة أسوأ من مفيش نسبة، والتاجر بيقرا الشات ده عشان يحاسب.
  inner+='<div class="wa-msg-time">'+waSenderTag(m, side)
        +esc(waTimeShort(m.wa_timestamp||m.created_at))+(side==='out'?waTicks(m.status):'')+'</div>';
  return inner;
}
