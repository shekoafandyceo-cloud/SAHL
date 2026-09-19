// صندوق محادثات الواتساب — الحالة والتحميل والرسم والإرسال والتسميات

import { skelList } from '../core/skeleton.js';
import { emptyState } from '../core/empty.js';
import { veilDone } from '../core/veil.js';
import { statusClass, statusLabel } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { normalizePhone } from '../core/format.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { showModal } from '../core/modal.js';
import { waMetaRow, waMsgInner, waQuoteBlock, waSenderTag, waTimeShort } from './message-view.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { showPage } from '../main.js';
import { currentTenantId, currentUser } from '../auth/auth.js';
import { tourActive } from '../tour/tour.js';
import { loadWalletState, walletStateCache } from '../billing/billing.js';
import { clearInboxLock, inboxVerified, refreshInboxGate, renderInboxLocked } from '../orders/billing-summary.js';
import { openDetail } from '../orders/detail.js';
import { stockProducts, stockSetProducts } from '../stock/stock.js';
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
  // النفاد: السيرفر مش بيرجّع محادثات (RLS) — قفل كامل (رسالة + إيقاف poll + مسح الشات)
  if(walletStateCache && walletStateCache.is_depleted){
    inboxDepletionLock();
    veilDone('inbox'); return;
  }
  if(inboxVerified === false){ renderInboxLocked(); veilDone('inbox'); return; }
  if(inboxVerified === null){
    refreshInboxGate().then(function(ok){ if(!ok){ renderInboxLocked(); veilDone('inbox'); } else { loadInbox(); } });
    return;
  }
  clearInboxLock();   // القفل overlay — بيتشال من غير reload أول ما التوثيق يثبت
  waEnsureNotifyPermission();
  waLoadQuickReplies();
  waLoadStartTemplates();
  waBuildFilters();
  // عدّاد شارة الإعلانات لازم يبقى صح **من أول رسمة** مش بعد الضغط —
  // رقم على الـchip بيتغير لما تدوس عليه = رقم بيكدب قبل الضغطة.
  waFetchAdConvos();
  waFetchAdNames();
  // نفس السبب بالظبط لعدّادات التصنيفات — استعلام واحد لكل الـ9
  waFetchLabelConvos();
  waFetchConvos(true);
  if(waPollTimer) clearInterval(waPollTimer);
  waPollTimer=setInterval(function(){
    var p=$id('page-inbox');
    if(!p || p.style.display==='none'){ clearInterval(waPollTimer); waPollTimer=null; return; }
    waFetchConvos(false);
    if(waActiveId) waFetchMessages(waActiveId,false,true);
  },20000);
}

// وصلنا لسقف الـ200 محادثة؟ — البحث محلي على المعروض بس، فلازم نقول
// بصراحة إن الأقدم مش هنا بدل ما يبان إن دي كل المحادثات
export var waConvosCapped=false;

var WA_LOCK_MSG='<div class="wa-empty">🔒 المحادثات مقفولة لحد ما تشحن المحفظة — كلها محفوظة وهترجع فوراً بعد الشحن.</div>';

// القفل لحظة النفاد: الشات المفتوح كان بيفضل معروض، والـpoll القديم
// (مابيتوقفش في مسار النفاد بتاع loadInbox) كان بعد ≤20 ثانية بيستبدل
// رسالة القفل بـ"مفيش محادثات لسه" المضللة ويمسح الشات بـ"مفيش رسايل"
export function inboxDepletionLock(){
  if(waPollTimer){ clearInterval(waPollTimer); waPollTimer=null; }
  waActiveId=null; waRenderedState=[]; waRenderedCount=0;
  var wrap=$id('wa-wrap'); if(wrap) wrap.classList.remove('show-chat');   // الموبايل: يرجع لعرض القايمة اللي فيها الرسالة
  var inner=$id('wa-chat-inner'); if(inner) inner.style.display='none';
  var empty=$id('wa-chat-empty'); if(empty) empty.style.display='';
  var msgs=$id('wa-msgs'); if(msgs) msgs.innerHTML='';
  var body=$id('wa-list-body'); if(body) body.innerHTML=WA_LOCK_MSG;
}

// جيل جلب القايمة — poll وrealtime وتحديث يدوي بيتسابقوا، وsnapshot أقدم
// كان بيرجّع unread/preview قديم لحد الدورة الجاية
var waConvGen=0;
export function waFetchConvos(showLoading){
  if(!sb||!currentTenantId) return;
  // النفاد: الـRLS بترجّع صفر صفوف — الرد كان بيستبدل رسالة القفل بحالة فاضية عادية
  if(walletStateCache && walletStateCache.is_depleted) return;
  var myGen=++waConvGen;
  if(showLoading) $id('wa-list-body').innerHTML=skelList(6);
  sb.from('wa_conversations').select('*').eq('tenant_id',currentTenantId)
    .order('last_message_at',{ascending:false,nullsFirst:false}).limit(200).then(function(r){
      if(myGen!==waConvGen) return;   // طلب أحدث خرج بعدنا
      if(r.error){ $id('wa-list-body').innerHTML='<div class="wa-empty">حصلت مشكلة في تحميل المحادثات</div>'; veilDone('inbox'); return; }
      waConvos=r.data||[];
      waConvosCapped=(waConvos.length===200);
      renderConvos();
      veilDone('inbox');
    });
}

export var waSearchQuery='', waFilter='all';

export function waConvMatches(c){
  if(waFilter==='unread' && !((c.unread_count||0)>0)) return false;
  if(waFilter==='ctwa' && !waIsFromAd(c)) return false;
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
  // 🔴 صفّين منفصلين: chips النظام بتلفّ عادي، والتصنيفات في صف بيتزحلق
  // أفقي. بعد ما بقوا 9، الشريط الموحّد كان بياخد 4 صفوف (135px) ويقص
  // محادثة كاملة من القايمة على كل شاشة — اتقاس. (قرار المالك.)
  // ⚠️ كل المحددات في الملف ده على `#wa-filters .wa-filter` — محدد
  // **أحفاد** فالتعشيش مابيكسرهاش.
  var html='<div class="wa-f-sys">'
    +'<button class="wa-filter'+(waFilter==='all'?' active':'')+'" data-f="all">الكل</button>'
    +'<button class="wa-filter'+(waFilter==='unread'?' active':'')+'" id="wa-filter-unread" data-f="unread">غير مقروءة</button>'
    // 📣 chip نظام مش تصنيف — بيتحسب من أعمدة `ctwa_*` مش من `labels[]`
    +'<button class="wa-filter wa-fad'+(waFilter==='ctwa'?' active':'')+'" id="wa-filter-ctwa" data-f="ctwa"'
    +' title="المحادثات اللي العميل دخلها من إعلان Click-to-WhatsApp">📣 جه من إعلان</button>'
    +'</div><div class="wa-f-labels">';
  for(var i=0;i<WA_LABELS.length;i++){
    var L=WA_LABELS[i]; var fv='label:'+L.k; var on=(waFilter===fv);
    html+='<button class="wa-filter wa-flabel'+(on?' active':'')+'" data-f="'+esc(fv)+'" data-label="'+esc(L.k)+'"'+(on?(' style="background:'+L.c+';border-color:transparent;color:#fff"'):'')+'>'+esc(L.k)+'</button>';
  }
  html+='</div>';
  box.innerHTML=html;
  var chips=box.querySelectorAll('.wa-filter');
  for(var j=0;j<chips.length;j++){ chips[j].addEventListener('click',function(){ waSetFilter(this.getAttribute('data-f')); }); }
}

export function waSetFilter(f){
  waFilter=f;
  // الجلب عند التبديل بس — الصفوف الأقدم من أحدث 200 مابتتغيرش كتير،
  // والـpoll العادي (كل 20 ثانية) بيجيب أي محادثة إعلان جديدة لأنها بتبقى
  // في الأحدث أصلاً.
  if(f==='ctwa') waFetchAdConvos();
  // نفس المنطق: الجلب عند التبديل عشان الصفوف المصنّفة اللي بره أحدث 200
  // تنزل. العدّادات نفسها نزلت مع `loadInbox` فالرقم على الـchip مابيتغيرش
  // لما تدوس عليه.
  if(f.indexOf('label:')===0) waFetchLabelConvos();
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

// شارة «جه من إعلان» — البيانات من wa_conversations.ctwa_* اللي
// كانت بتوصل المتصفح وتترمي. 🔴 **مفيش معرّف إعلان في العرض أبداً**
// (قرار المالك 14 سبتمبر): الموظف بيرد على عميل، مش بيحلل حملات.
//
// 🔴 **الترتيب اتغيّر 16 سبتمبر بعد أول التقاط حي.** كان `headline` هو
// المصدر، وأول إعلان حقيقي كشف إن ميتا بتحط فيه **اسم الصفحة**:
// «3ataba.com — عتبة دوت كوم» على إعلان اسمه KitchenOrganizer. يعني نفس
// النص على كل إعلانات المتجر — شارة موجودة وبتقول صفر معلومة.
// `referral.body` (كوبي الإعلان) هو اللي بيعرّفه فعلاً، وسطر واحد منه
// بيدي الموظف الإجابة فوراً. درس 26 حرفياً: الشكل اتراجع والسلوك لأ.
function waFirstLine(v){
  var t=String(v==null?'':v).replace(/\u200e|\u200f|\u061c/g,'').trim();
  if(!t) return '';
  var lines=t.split(/[\r\n]+/);
  for(var i=0;i<lines.length;i++){ var L=lines[i].trim(); if(L) return L; }
  return '';
}
// 🔴 اسم الإعلان في Meta — **مش بييجي في الـwebhook خالص**، فبييجي من
// جدول `ctwa_ads`. السبب من بلاغ حي (16 سبتمبر): إعلانين مختلفين ممكن
// يبقى ليهم **نفس الكوبي بالحرف** — `FOMO HOOK` و`realone` نص إعلانهم
// واحد، فالشارة كانت بتقول نفس الكلام على الاتنين والمالك مش قادر يفرّق.
// نفس درس 44 بس على مستوى أعمق: نقلنا من `headline` لـ`body` لأن الأول
// مكانش مميّز، والتاني كمان مش مميّز.
export var waAdNames={};

export function waFetchAdNames(){
  if(!sb||!currentTenantId) return;
  sb.from('ctwa_ads').select('ad_id,ad_name').eq('tenant_id',currentTenantId).then(function(r){
    if(r.error||!r.data) return;   // فشل الجلب بيرجّعنا للكوبي — مش قايمة فاضية
    var m={};
    for(var i=0;i<r.data.length;i++){
      var n=String(r.data[i].ad_name==null?'':r.data[i].ad_name).trim();
      if(r.data[i].ad_id && n) m[r.data[i].ad_id]=n;
    }
    waAdNames=m;
    renderConvos();
    var ac=waConvById(waActiveId); if(ac) waUpdateCtwa(ac);
  });
}

export function waAdName(c){
  if(!c||!c.ctwa_ad_id) return '';
  return waAdNames[c.ctwa_ad_id]||'';
}

export function waCtwaText(c){
  if(!c) return '';
  // الاسم الأول — هو الوحيد المضمون إنه مميّز بين إعلانين
  var nm=waAdName(c);
  if(nm) return nm;
  var b=waFirstLine(c.ctwa_ad_body);
  if(b) return b;
  // الإعلانات اللي اتلقطت قبل 16 سبتمبر مالهاش body متخزّن، والـheadline
  // أحسن من لا حاجة. ⚠️ عينة واحدة بس هي اللي أثبتت إنه اسم الصفحة —
  // ماينفعش نشيله على أساس إنه غلط دايماً.
  var h=String(c.ctwa_headline==null?'':c.ctwa_headline).trim();
  if(h) return h;
  // فيه إعلان بس مفيش أي نص — ميتا مش دايماً بتبعت body ولا headline.
  // بنقول الحقيقة من غير نص مخترع (نفس قاعدة «رد على رسالة أقدم»).
  if(c.ctwa_ad_id||c.ctwa_clid) return 'جه من إعلان';
  return '';
}

// 🔴 العنوان جاي من حمولة خارجية (ميتا) — `javascript:` في href **بيتنفّذ
// عند الضغط**، فالمرور من غير فحص = XSS بضغطة واحدة. بنسمح بـhttp/https بس.
// (ومابنعتمدش على `new URL` لوحدها: بترضى بـjavascript: عادي.)
export function waCtwaUrl(c){
  var u=String((c&&c.ctwa_source_url)==null?'':c.ctwa_source_url).trim();
  if(!u) return '';
  return /^https?:\/\//i.test(u) ? u : '';
}

// التلميح بيشيل نص الإعلان **كامل** — السطر الأول بيعرّف، والباقي بيأكّد.
// ومعاه العنوان: التلميح نفسه مايتضغطش (خاصية title مش HTML)، بس الشارة
// بقت لينك — فده بيقول للموظف إنها تتفتح وبيوريه رايحة فين قبل ما يدوس.
export function waCtwaTitle(c){
  var full=String((c&&c.ctwa_ad_body)==null?'':c.ctwa_ad_body).trim();
  var url=waCtwaUrl(c);
  var nm=waAdName(c);
  // الشارة بتعرض الاسم بس (سطر واحد) — فالتلميح هو المكان اللي الكوبي
  // بيبان فيه كامل، وبيفضل مهم لأن إعلانين ممكن يشتركوا في الكوبي
  var t=full ? ('نص الإعلان:\n'+full) : 'العميل دخل من إعلان واتساب';
  if(nm) t = 'الإعلان: '+nm+(full?('\n\n'+t):'');
  if(url) t+='\n\n🔗 افتح الإعلان: '+url;
  return t;
}

// بتتنادى من فتح المحادثة **ومن renderConvos** — العميل ممكن يدوس على
// الإعلان والشات مفتوح قدام الموظف، فالشارة لازم تظهر مع أول جلب مش عند إعادة الفتح.
export function waUpdateCtwa(c){
  var box=$id('wa-chat-ctwa'); if(!box) return;
  var t=waCtwaText(c);
  if(!t){
    box.style.display='none'; box.textContent='';
    box.removeAttribute('title'); box.removeAttribute('href');
    box.removeAttribute('target'); box.removeAttribute('rel');
    box.classList.remove('is-link');
    return;
  }
  box.style.display='';
  box.textContent='📣 '+t;
  box.title=waCtwaTitle(c);
  var url=waCtwaUrl(c);
  if(url){
    box.setAttribute('href',url);
    box.setAttribute('target','_blank');
    // noopener إلزامي مع target=_blank — من غيره الصفحة المفتوحة
    // بتوصل لـwindow.opener وتقدر تنقّل لوحة التاجر لأي مكان
    box.setAttribute('rel','noopener noreferrer');
    box.classList.add('is-link');
  } else {
    box.removeAttribute('href'); box.removeAttribute('target');
    box.removeAttribute('rel'); box.classList.remove('is-link');
  }
}

// ----- فلتر «جه من إعلان» -----
// 🔴 ده **مش label**: الـlabels بيكتبها الموظف في `labels[]`، وأعمدة
// `ctwa_*` مقفولة عن المتصفح عمداً (14 سبتمبر) عشان النسبة ماتتزوّرش.
// فهو chip نظام زي «غير مقروءة» — مالوش مدخل في `WA_LABELS` ولا في
// `waToggleLabel`.
//
// 🔴 الشرط بيطابق **اللي الشارة بتظهر عليه** بالحرف + `ctwa_first_at`
// (العلامة الوحيدة اللي `applyReferral` بتكتبها مع أي referral مهما كانت
// الحقول التانية فاضية). لو الشرطين اتفرّقوا، هتلاقي محادثة عليها شارة 📣
// ومش بتظهر في الفلتر — وده فلتر بيكدب.
export function waIsFromAd(c){
  return !!(c && (c.ctwa_first_at || c.ctwa_ad_id || c.ctwa_clid || c.ctwa_ad_body || c.ctwa_headline));
}

// نفس الشرط بلغة PostgREST — **لازم يفضلوا متطابقين**
var WA_AD_OR = 'ctwa_first_at.not.is.null,ctwa_ad_id.not.is.null,ctwa_clid.not.is.null,ctwa_ad_body.not.is.null,ctwa_headline.not.is.null';

// 🔴 القايمة بتجيب **أحدث 200 محادثة بس** (`waFetchConvos`)، والفلترة
// بتحصل على المحمّل في الذاكرة. يعني فلتر يقرا من `waConvos` لوحدها
// بيقول «عندك محادثتين من إعلان» والداتابيز فيها 9 — **والباقي بيختفي في
// صمت** (درس 6: الفلترة والترتيب مرتبطين). فالفلتر ده بيستعلم من
// **السيرفر** بشرطه، والنتيجة بتتحط في مصفوفة **منفصلة**.
//
// ⚠️ **ومابتتدمجش في `waConvos`.** جرّبنا الدمج وطلع إن ترتيب وصول
// الاستعلامين هو اللي بيحدد النتيجة: الإعلانات لو نزلت الأول بتتعلّم
// «إضافية»، وبعدين الجلب العادي بيجيب نفس الصفوف ضمن الـ200 فتتشال منه —
// واختفت محادثتين من القايمة العادية في الاختبار. بالفصل، `waConvos`
// بتفضل **نسخة السيرفر زي ما هي** فعدّادات غير المقروء والتصنيفات وشارة
// القايمة الجانبية مالهاش أي علاقة بالفلتر ده.
export var waAdExtra=[], waAdCapped=false;

// 🔴 المحادثات اللي عليها تصنيف — بتتجلب من السيرفر زي الإعلانات بالظبط.
// السبب مقيس مش نظري (19 سبتمبر): `waFetchConvos` بتجيب **أحدث 200** بس،
// وعند 3ataba المحادثة رقم 200 عمرها **يومين** — يعني **6 من 18** محادثة
// عليها تصنيف كانت **بره النافذة**، فالفلتر بتاعها بيقول «مفيش محادثات
// بالتصنيف ده» وهي موجودة. تلت التصنيفات بيختفوا في صمت (درس 6).
// والتصنيفات الجديدة (استرجاع · استبدال · مكتمل) طبيعتها إنها على محادثات
// **أقدم** — فمن غير الجلب ده كانوا هيتولدوا مكسورين.
//
// ⚠️ المحادثات اللي عليها تصنيف مجموعة صغيرة بطبيعتها (18 من 2,037)،
// فاستعلام واحد بيكفي **لكل** التصنيفات — أرخص من استعلام لكل chip،
// وبيدّي العدّادات الصح من أول رسمة (عدّاد بيتغير لما تدوس عليه = عدّاد
// بيكدب، نفس مبدأ chip الإعلانات).
export var waLabelExtra=[], waLabelCapped=false;
var WA_LABEL_LIMIT=500;

// 🔴 البحث بالـid لازم يشوف الاتنين: صف من الفلتر مالوش مدخل هنا، الضغط
// عليه بيفتح الشات وهيدره فاضل بتاع المحادثة اللي قبلها — اسم عميل فوق
// شات عميل تاني (نفس عيلة «الشارة المعلّقة» اللي اتصلحت 14 سبتمبر).
export function waConvById(id){
  if(!id) return undefined;
  for(var i=0;i<waConvos.length;i++){ if(waConvos[i].id===id) return waConvos[i]; }
  for(var j=0;j<waAdExtra.length;j++){ if(waAdExtra[j].id===id) return waAdExtra[j]; }
  // من غير السطر ده الضغط على صف جاي من فلتر التصنيف بيفتح الشات
  // وهيدره فاضل بتاع المحادثة اللي قبلها
  for(var m=0;m<waLabelExtra.length;m++){ if(waLabelExtra[m].id===id) return waLabelExtra[m]; }
  return undefined;
}

// كل المحادثات اللي عليها تصنيف — استعلام واحد لكل التصنيفات.
// بيتنادى من `loadInbox` (عشان العدّادات تبقى صح من أول رسمة) ومن
// `waSetFilter` عند التبديل لتصنيف ومن `waToggleLabel` بعد أي تعديل.
export function waFetchLabelConvos(){
  if(!sb||!currentTenantId) return;
  if(walletStateCache && walletStateCache.is_depleted) return;
  sb.from('wa_conversations').select('*').eq('tenant_id',currentTenantId)
    .not('labels','is',null)
    .order('last_message_at',{ascending:false,nullsFirst:false}).limit(WA_LABEL_LIMIT)
    .then(function(r){
      if(r.error) return;   // الفلتر بيفضل على المحمّل — أحسن من قايمة فاضية
      var rows=r.data||[];
      waLabelCapped=(rows.length===WA_LABEL_LIMIT);
      // `.not(labels,is,null)` بترجّع كمان الصفوف اللي مصفوفتها فاضية
      // (الموظف شال آخر تصنيف) — دي مش «عليها تصنيف»
      waLabelExtra=rows.filter(function(c){ return c.labels && c.labels.length; });
      if(waConvos.length) renderConvos();
    });
}

export function waFetchAdConvos(){
  if(!sb||!currentTenantId) return;
  if(walletStateCache && walletStateCache.is_depleted) return;
  sb.from('wa_conversations').select('*').eq('tenant_id',currentTenantId)
    .or(WA_AD_OR)
    .order('last_message_at',{ascending:false,nullsFirst:false}).limit(200)
    .then(function(r){
      if(r.error) return;   // الفلتر بيفضل على المحمّل — أحسن من قايمة فاضية
      waAdExtra=r.data||[];
      waAdCapped=(waAdExtra.length===200);
      // لو الجلب الأساسي لسه مانزلش، الرسم هنا بيعرض **الإعلانات بس**
      // كأنها القايمة كلها — ومضة قايمة غلط. `waFetchConvos` بترسم
      // بنفسها أول ما تنزل.
      if(waConvos.length) renderConvos();
    });
}

export function renderConvos(){
  var body=$id('wa-list-body'); if(!body) return;
  var totalUnread=0, unreadConvs=0, labelCounts={}, adIds={}, seenConvIds={};
  for(var k=0;k<waConvos.length;k++){
    seenConvIds[waConvos[k].id]=1;
    if(waIsFromAd(waConvos[k])) adIds[waConvos[k].id]=1;
    var u=waConvos[k].unread_count||0; totalUnread+=u; if(u>0)unreadConvs++;
    var ls=waConvos[k].labels||[];
    for(var li=0;li<ls.length;li++){ labelCounts[ls[li]]=(labelCounts[ls[li]]||0)+1; }
  }
  // ⚠️ عدّاد الإعلانات والتصنيفات بيضموا الأقدم من الـ200 (الاتنين ليهم
  // استعلام سيرفر) — **غير المقروء لوحده** هو اللي لسه على نسخة الـ200،
  // وده مقصود: الرسايل الجديدة بتبقى في الأحدث أصلاً.
  for(var ax=0;ax<waAdExtra.length;ax++) adIds[waAdExtra[ax].id]=1;
  // الصفوف اللي بره أحدث 200 بتتعدّ هنا. الـdedupe بالـid و`waConvos`
  // هي الأحدث (مصدر الـpoll) فبتكسب لو الصف في الاتنين.
  for(var lx=0;lx<waLabelExtra.length;lx++){
    var lc=waLabelExtra[lx]; if(seenConvIds[lc.id]) continue;
    var els=lc.labels||[];
    for(var lj=0;lj<els.length;lj++){ labelCounts[els[lj]]=(labelCounts[els[lj]]||0)+1; }
  }
  var adCount=0;
  for(var ak in adIds){ if(Object.prototype.hasOwnProperty.call(adIds,ak)) adCount++; }
  $id('wa-list-title').textContent= totalUnread>0 ? ('المحادثات • '+totalUnread+' غير مقروء') : 'المحادثات';
  waSetNavBadge(totalUnread);
  var uf=$id('wa-filter-unread'); if(uf) uf.textContent= unreadConvs>0 ? ('غير مقروءة ('+unreadConvs+')') : 'غير مقروءة';
  var af=$id('wa-filter-ctwa');
  if(af) af.textContent= adCount>0 ? ('📣 جه من إعلان ('+adCount+(waAdCapped?'+':'')+')') : '📣 جه من إعلان';
  var lchips=document.querySelectorAll('#wa-filters .wa-flabel');
  for(var ci=0;ci<lchips.length;ci++){ var lk=lchips[ci].getAttribute('data-label'); var ln=labelCounts[lk]||0; lchips[ci].textContent= ln>0 ? (lk+' ('+ln+(waLabelCapped?'+':'')+')') : lk; }
  if(!waConvos.length && !waAdExtra.length){
    // النفاد مش "مفيش محادثات" — الرسالة الغلط كانت بتوحي إن البيانات ضاعت
    if(walletStateCache && walletStateCache.is_depleted){ body.innerHTML=WA_LOCK_MSG; return; }
    body.innerHTML=emptyState({icon:'💬',
      title:'مفيش محادثات لسه',
      sub:'أول ما عميل يرد على رسالة التأكيد أو يبعتلك على واتساب، المحادثة هتظهر هنا.'}); return; }
  var list=[];
  for(var x=0;x<waConvos.length;x++){ if(waConvMatches(waConvos[x])) list.push(waConvos[x]); }
  if(waFilter==='ctwa'){
    // الإعلانات اللي بره أحدث 200 بتتضاف **هنا بس** — الفلتر ده وحده
    // هو اللي استعلم عنها، وباقي الفلاتر لسه على نسخة الـ200.
    var seen={};
    for(var y=0;y<list.length;y++) seen[list[y].id]=1;
    for(var z=0;z<waAdExtra.length;z++){
      if(!seen[waAdExtra[z].id] && waConvMatches(waAdExtra[z])) list.push(waAdExtra[z]);
    }
    list.sort(function(a,b){ return String(b.last_message_at||'').localeCompare(String(a.last_message_at||'')); });
  } else if(waFilter.indexOf('label:')===0){
    // نفس منطق الإعلانات بالحرف: المحادثات المصنّفة اللي بره أحدث 200
    // بتتضاف **هنا بس**. `waLabelExtra` بتفضل منفصلة عن `waConvos` —
    // الدمج فيها اتجرّب في فلتر الإعلانات وطلع إن ترتيب وصول الاستعلامين
    // هو اللي بيحدد النتيجة، واختفت محادثتين من القايمة العادية.
    var seenL={};
    for(var y2=0;y2<list.length;y2++) seenL[list[y2].id]=1;
    for(var z2=0;z2<waLabelExtra.length;z2++){
      if(!seenL[waLabelExtra[z2].id] && waConvMatches(waLabelExtra[z2])) list.push(waLabelExtra[z2]);
    }
    list.sort(function(a,b){ return String(b.last_message_at||'').localeCompare(String(a.last_message_at||'')); });
  }
  if(!list.length){
    var emptyMsg='مفيش نتائج للبحث';
    if(waFilter==='unread') emptyMsg='مفيش رسائل غير مقروءة 🎉';
    // 🔴 السياق ضروري هنا: المحادثات اللي قبل تفعيل تتبع الإعلانات مالهاش
    // بيانات إعلان **حتى لو جت من إعلان فعلاً** — من غير السطر ده التاجر
    // بيقرا «صفر» على إنها عطل في الميزة.
    else if(waFilter==='ctwa') emptyMsg='مفيش محادثات جاية من إعلان لسه<br><span style="font-size:.76rem">المحادثات اللي قبل تفعيل تتبع الإعلانات مالهاش بيانات إعلان حتى لو جت من إعلان.</span>';
    // الفلتر ده بيستعلم من السيرفر فـ«مفيش» هنا معناها مفيش فعلاً —
    // مش «مفيش في أحدث 200». والسياق بيتقال بس لو وصلنا السقف.
    else if(waFilter.indexOf('label:')===0) emptyMsg='مفيش محادثات بالتصنيف ده'
      +(waLabelCapped?'<br><span style="font-size:.76rem">وصلنا سقف '+WA_LABEL_LIMIT+' محادثة مصنّفة — لو التصنيف على محادثة أقدم من كده مش هيظهر هنا.</span>':'');
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
        +'<div class="wa-conv-bot"><span class="wa-conv-prev'+(c.last_direction?'':' wa-conv-none')+'">'+esc(c.last_message_text || (c.last_direction ? '' : 'أوردر جديد — العميل لسه مبعتش'))+'</span>'+(unread>0?'<span class="wa-unread">'+unread+'</span>':'')+'</div>'
        +((c.labels&&c.labels.length)?('<div class="wa-conv-labels">'+c.labels.map(function(l){return '<span class="wa-conv-label" style="background:'+waLabelColor(l)+'">'+esc(l)+'</span>';}).join('')+'</div>'):'')
        +(waCtwaText(c)?('<div class="wa-conv-ctwa" title="'+esc(waCtwaTitle(c))+'">📣 <span>'+esc(waCtwaText(c))+'</span>'
        +(waCtwaUrl(c)?('<a class="wa-conv-ad-link" href="'+esc(waCtwaUrl(c))+'" target="_blank" rel="noopener noreferrer" title="افتح الإعلان على فيسبوك">↗</a>'):'')
        +'</div>'):'')
      +'</div></div>';
  }
  // مؤشر النقص: القايمة عند السقف = فيه أقدم مش معروض ولا بيدخل البحث
  // 🔴 ملاحظة السقف غلط وقت فلتر الإعلانات: الفلتر ده بيستعلم من السيرفر
  // بشرطه فبيشوف الأقدم كمان. نص «الأقدم مش بيظهر» هنا كان هيخلي التاجر
  // يفتكر إن فيه إعلانات مخفية وهي معروضة.
  if(waFilter==='ctwa'){
    if(waAdCapped) html+='<div class="wa-cap-note">معروض أحدث 200 محادثة من إعلانات — الأقدم مش هنا</div>';
  } else if(waFilter.indexOf('label:')===0){
    // نفس سبب استثناء الإعلانات: الفلتر ده استعلم من السيرفر فهو شايف
    // الأقدم. نص «الأقدم مش بيظهر» هنا كان هيخلي التاجر يدوّر على
    // محادثات مصنّفة **وهي معروضة قدامه**.
    if(waLabelCapped) html+='<div class="wa-cap-note">معروض أحدث '+WA_LABEL_LIMIT+' محادثة مصنّفة — الأقدم مش هنا</div>';
  } else if(waConvosCapped) html+='<div class="wa-cap-note">معروض أحدث 200 محادثة — الأقدم مش بيظهر هنا ولا في البحث</div>';
  body.innerHTML=html;
  var items=body.querySelectorAll('.wa-conv');
  for(var j=0;j<items.length;j++){ items[j].addEventListener('click',function(){ openConversation(this.getAttribute('data-id')); }); }
  // 🔴 لينك الإعلان جوّه صف قابل للضغط: من غير stopPropagation الضغطة بتفتح
  // الإعلان **وتبدّل المحادثة** في نفس الوقت — الموظف بيروح لشات تاني من غير
  // ما يقصد وهو بصّ على تاب جديدة، فمايلاحظش.
  var adLinks=body.querySelectorAll('.wa-conv-ad-link');
  for(var al=0;al<adLinks.length;al++){
    adLinks[al].addEventListener('click',function(e){ e.stopPropagation(); });
  }
  if(waActiveId){ var ac=waConvById(waActiveId); if(ac){ waUpdateWindow(ac); waUpdateCtwa(ac); } }
}

export function openConversation(id){
  waActiveId=id; waRenderedCount=0;
  var c=waConvById(id);
  $id('wa-chat-empty').style.display='none';
  $id('wa-chat-inner').style.display='flex';
  $id('wa-wrap').classList.add('show-chat');
  if(c){
    $id('wa-chat-name').textContent=c.customer_name||c.customer_phone||c.wa_id;
    $id('wa-chat-phone').textContent=c.customer_phone||c.wa_id;
    $id('wa-chat-avatar').textContent=waInitials(c.customer_name,c.customer_phone||c.wa_id);
  }
  // محادثة مش موجودة في القايمة = مفيش شارة، مش شارة اللي قبليها
  waUpdateCtwa(c);
  renderConvos();
  // فقاعات optimistic لسه شغالة (صورة بتترفع): المسح المباشر بـinnerHTML
  // كان بيرمي الـDOM من غير revoke فالـobjectURL يفضل معلّق في الذاكرة
  var msgsBox=$id('wa-msgs');
  if(msgsBox){
    var pendOpt=msgsBox.querySelectorAll('.wa-optimistic');
    for(var poi=0;poi<pendOpt.length;poi++) waRevokeBubbleUrl(pendOpt[poi]);
    msgsBox.innerHTML='<div class="wa-empty">جاري تحميل الرسائل…</div>';
  }
  waRenderedState=[];
  waFetchMessages(id,true,false);
  waMarkRead(id);
  waUpdateWindow(c);
  waLoadConvMeta(c);
  waLoadOrders(c);
  waClearImage();
  if($id('wa-input')){ $id('wa-input').value=''; $id('wa-input').style.height='auto'; }
  // 🔴 اقتباس من محادثة قديمة في محادثة جديدة = رد على رسالة مش موجودة
  waClearReplyTo();
  // 🔴 ونفس الحكاية للرد الجاهز المحضّر: تختار رد بصور، تفتح محادثة
  // تانية، تدوس إرسال — فيروح لعميل تاني خالص. والسيرفر **مش** هيرفضه
  // (المسارات بتاعة نفس المتجر)، فالحارس هنا هو الوحيد.
  waClearPendingQr();
  // 🔴 والفورم كمان: تفتحها لعميل، تبدّل المحادثة، تدوس «سجّل» — فيتسجّل
  // أوردر باسم وتليفون العميل اللي فات على شات عميل تاني. الحقول بتتعبّى
  // من المحادثة وقت الفتح، فسيبها مفتوحة = بيانات قديمة على شاشة جديدة.
  waNewOrderClose();
}

// جيل جلب الرسائل — الحارس القديم (convId===waActiveId) بيحمي من محادثة
// تانية بس: طلبين لنفس المحادثة (poll + realtime) بيعدّوا منه الاتنين،
// وsnapshot أقدم كان يوصل بعد الأحدث فيشيل رسالة لسه ظاهرة مؤقتاً
var waMsgGen=0;
export function waFetchMessages(convId,scroll,isPoll){
  if(!sb) return;
  var myGen=++waMsgGen;
  // descending + reverse = أحدث 500 — الترتيب التصاعدي كان بيجيب أقدم 500
  // والمحادثة اللي عدّت الحد كانت بتتجمد على القديم للأبد
  sb.from('wa_messages').select('*').eq('conversation_id',convId)
    .order('created_at',{ascending:false}).limit(500).then(function(r){
      if(convId!==waActiveId) return;
      if(myGen!==waMsgGen) return;   // رد أقدم لنفس المحادثة
      if(r.error){ if(!isPoll)$id('wa-msgs').innerHTML='<div class="wa-empty">حصلت مشكلة في تحميل الرسائل</div>'; return; }
      var data=(r.data||[]).reverse();
      // مقارنة الطول لوحدها بتفشل لما العدد ثابت على الحد (500) والنافذة
      // بتنزلق — آخر id هو الفيصل
      var lastRendered = waRenderedState.length ? waRenderedState[waRenderedState.length-1].id : null;
      var lastNew = data.length ? data[data.length-1].id : null;
      if(isPoll && data.length===waRenderedCount && lastNew===lastRendered) return;
      var newArrived = isPoll && !!data.length && lastNew!==lastRendered;
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

// ════ الرد على رسالة معينة (طلب المالك 6 سبتمبر) ════
// 🔴 الحالة دي **بتتصفّر في 3 مواضع**: تبديل المحادثة · نجاح الإرسال ·
// إلغاء يدوي. لو فضلت، الموظف بيفتح محادثة تانية ويرد فيلزق اقتباس من
// محادثة قديمة — والسيرفر هيرفضه بس الواجهة كانت هتكدب لحد ما يرفض.
export var waReplyTo = null;
// آخر قايمة رسايل اترسمت — منها بنجيب الرسالة الكاملة اللي هنرد عليها
export var waLastMsgs = [];

export function waSetReplyTo(mid){
  var box=$id('wa-msgs'); if(!box) return;
  // بندوّر في الرسايل المرسومة عشان مانحتفظش بنسخة تانية من الحالة
  var found = null;
  for(var i=0;i<waRenderedState.length;i++){ if(waRenderedState[i].id===mid) found=waRenderedState[i]; }
  // waRenderedState فيها الملخص بس — الرسالة الكاملة لازم تتجاب من الجلب الأخير
  waReplyTo = (waLastMsgs || []).filter(function(m){ return m.id===mid; })[0] || null;
  if(!waReplyTo || !waReplyTo.wa_message_id){ waReplyTo = null; waRenderReplyBar(); return; }
  waRenderReplyBar();
  var inp=$id('wa-input'); if(inp) inp.focus();
}

export function waClearReplyTo(){ waReplyTo = null; waRenderReplyBar(); }

export function waRenderReplyBar(){
  var bar=$id('wa-reply-bar'), body=$id('wa-reply-bar-body');
  if(!bar||!body) return;
  if(!waReplyTo){ bar.style.display='none'; body.innerHTML=''; return; }
  // نفس رسم الاقتباس بتاع الفقاعات — عشان اللي في المعاينة هو اللي هيبان
  // في الشات بالظبط، مش تمثيل تاني ممكن ينحرف
  var map={}; map[waReplyTo.wa_message_id]=waReplyTo;
  var paths = waReplyTo.media_path ? [waReplyTo.media_path] : [];
  waResolveUrls(paths, function(urlMap){
    if(!waReplyTo) return;   // اتلغى وإحنا بنحل الروابط
    body.innerHTML = waQuoteBlock({ reply_to_wa_id: waReplyTo.wa_message_id }, map, urlMap);
    bar.style.display='flex';
  });
}

export function waScrollBottom(box){ box.scrollTop=box.scrollHeight; setTimeout(function(){ if(box) box.scrollTop=box.scrollHeight; }, 250); }

export function renderMessages(msgs,scroll){
  var box=$id('wa-msgs'); if(!box) return;
  // التقاط المحادثة وقت البدء — waResolveUrls غير متزامنة، ولو المستخدم
  // بدّل محادثة قبل ما توقيعات الميديا ترجع كانت رسايل A بتترسم جوه B
  var forConv = waActiveId;
  // خريطة معرّف واتساب → الرسالة، عشان بلوك «رد على» يلاقي المقتبسة.
  // بتتبني من **كل** المحمّل مش من الجديد بس — الرد ساعات على رسالة قديمة.
  var byWamid = {};
  for(var w=0; w<msgs.length; w++){ if(msgs[w].wa_message_id) byWamid[msgs[w].wa_message_id]=msgs[w]; }
  waLastMsgs = msgs;
  if(!msgs.length){ box.innerHTML='<div class="wa-empty">لسه مفيش رسايل — المحادثة دي اتفتحت مع أوردر العميل.<br>أول ما يبعت أي حاجة هتظهر هنا وتقدر ترد عليه.</div>'; waRenderedCount=0; waRenderedState=[]; return; }
  // تحديث تدريجي لو الرسائل المعروضة بادئة (prefix) من القائمة الجديدة → ما نعيدش بناء كل حاجة (يمنع القفز)
  var canInc = waRenderedState.length>0 && box.querySelector('.wa-msg') && msgs.length>=waRenderedState.length;
  if(canInc){ for(var i=0;i<waRenderedState.length;i++){ if(!msgs[i] || msgs[i].id!==waRenderedState[i].id){ canInc=false; break; } } }
  if(canInc){
    // 1) حدّث حالة الرسائل الصادرة في مكانها (✓✓/قراءة) من غير إعادة بناء
    for(var i=0;i<waRenderedState.length;i++){
      if(msgs[i].direction==='out' && msgs[i].status!==waRenderedState[i].status){
        var tEl=box.querySelector('.wa-msg[data-mid="'+msgs[i].id+'"] .wa-msg-time');
        if(tEl) tEl.innerHTML=waMetaRow(msgs[i], 'out');   // السطر كامل مش الوقت بس
      }
    }
    // 2) ضيف الرسائل الجديدة في الآخر بس
    var newMsgs=msgs.slice(waRenderedState.length);
    waRenderedState=msgs.map(function(m){return {id:m.id,status:m.status,direction:m.direction};});
    waRenderedCount=msgs.length;
    if(newMsgs.length){
      var nearBottom=(box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
      // 🔴 مش بس ميديا الرسايل الجديدة: لو رسالة جديدة **رد على صورة قديمة**،
      // مسار الصورة القديمة لازم يتحل كمان وإلا المصغّرة بتطلع فاضية.
      // (الرسم الكامل تحت بيحل كل المحادثة فمش محتاج ده.)
      var npaths=[];
      for(var n=0;n<newMsgs.length;n++){
        if(newMsgs[n].media_path) npaths.push(newMsgs[n].media_path);
        var qm = newMsgs[n].reply_to_wa_id ? byWamid[newMsgs[n].reply_to_wa_id] : null;
        if(qm && qm.media_path && npaths.indexOf(qm.media_path) < 0) npaths.push(qm.media_path);
      }
      waResolveUrls(npaths, function(urlMap){
        if(waActiveId!==forConv) return;   // المستخدم بدّل محادثة — رد قديم
        var pend=box.querySelectorAll('.wa-optimistic'); for(var pi=0;pi<pend.length;pi++){ waRevokeBubbleUrl(pend[pi]); if(pend[pi].parentNode) pend[pi].parentNode.removeChild(pend[pi]); }
        var frag=''; for(var n=0;n<newMsgs.length;n++){ var m=newMsgs[n]; frag+='<div class="wa-msg '+(m.direction==='out'?'out':'in')+'" data-mid="'+esc(m.id)+'">'+waMsgInner(m,urlMap,byWamid)+'</div>'; }
        box.insertAdjacentHTML('beforeend', frag);
        if(scroll || nearBottom) waScrollBottom(box);
      });
    } else if(scroll){ waScrollBottom(box); }
    return;
  }
  // إعادة بناء كاملة (أول فتح للمحادثة أو تغيّر البنية)
  // الـrebuild بيحصل كمان لما نافذة الـ500 تنزلق (الأقدم بيقع فالـprefix
  // بيفشل) — القفز الإجباري لآخر الشات كان بيسحب القارئ من مكانه
  var wasNearBottom = !box.querySelector('.wa-msg') || (box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
  var prevScrollTop = box.scrollTop;
  var paths=[]; for(var i=0;i<msgs.length;i++){ if(msgs[i].media_path) paths.push(msgs[i].media_path); }
  waResolveUrls(paths, function(urlMap){
    if(waActiveId!==forConv) return;   // المستخدم بدّل محادثة — رد قديم
    var olds=box.querySelectorAll('.wa-optimistic'); for(var oi=0;oi<olds.length;oi++) waRevokeBubbleUrl(olds[oi]);
    var html='';
    // النافذة عند السقف = فيه أقدم مش معروض — نقولها بدل ما يبان إن دي كل الرسائل
    if(msgs.length===500) html+='<div class="wa-cap-note">معروض أحدث 500 رسالة — الأقدم مش بيظهر هنا</div>';
    for(var i=0;i<msgs.length;i++){ var m=msgs[i]; html+='<div class="wa-msg '+(m.direction==='out'?'out':'in')+'" data-mid="'+esc(m.id)+'">'+waMsgInner(m,urlMap,byWamid)+'</div>'; }
    box.innerHTML=html;
    waRenderedCount=msgs.length;
    waRenderedState=msgs.map(function(m){return {id:m.id,status:m.status,direction:m.direction};});
    if(scroll || wasNearBottom) waScrollBottom(box);
    else box.scrollTop=prevScrollTop;   // كان قاري فوق — يفضل تقريباً مكانه
  });
}

export function waMarkRead(convId){
  if(!sb||!currentTenantId) return;
  sb.from('wa_messages').update({is_read:true}).eq('conversation_id',convId).eq('direction','in').eq('is_read',false).then(function(){});
  sb.from('wa_conversations').update({unread_count:0}).eq('id',convId).eq('tenant_id',currentTenantId).then(function(r){
    if(!r||!r.error){ var cc=waConvById(convId); if(cc) cc.unread_count=0; renderConvos(); }
  });
}

// ----- إرسال (مرحلة 2) -----
export var waPendingImage=null, waPendingDoc=null;

// blob URLs بتاعة المعاينات — لازم revoke وإلا بتتراكم في الذاكرة
// (كل اختيار صورة كان بيسيب اللي قبله معلّق لحد ما التاب يتقفل)
var waPreviewUrl=null;
function waSetPreviewUrl(url){
  if(waPreviewUrl){ try{ URL.revokeObjectURL(waPreviewUrl); }catch(e){} }
  waPreviewUrl=url;
}
function waRevokeBubbleUrl(el){
  if(el && el.dataset && el.dataset.objurl){ try{ URL.revokeObjectURL(el.dataset.objurl); }catch(e){} }
}

export function waUpdateWindow(c){
  var lastIn=(c&&c.last_inbound_at)?new Date(c.last_inbound_at).getTime():0;
  var open=lastIn && (Date.now()-lastIn) < 24*3600*1000;
  var banner=$id('wa-window-closed'), row=$id('wa-compose-row');
  if(banner){
    banner.style.display=open?'none':'block';
    // 🔴 من 6 سبتمبر المحادثة بتظهر مع الأوردر قبل ما العميل يبعت أي حاجة
    // (تريجر `wa_conv_on_order`). النص القديم «النافذة قفلت — العميل لازم
    // يبعتلك رسالة **جديدة**» بيقرا غلط هنا: مفيش نافذة قفلت أصلاً، العميل
    // لسه مبعتش ولا مرة. و`last_direction` بيتحط من تريجر الرسايل بس، فهو
    // الفيصل الصح بين الحالتين.
    if(!open) banner.textContent = (c && !c.last_direction)
      ? '💬 العميل لسه مبعتش أي رسالة — واتساب مابيسمحش نبدأ إحنا. أول ما يبعت هتقدر ترد عليه.'
      : '🔒 نافذة الرد (24 ساعة) قفلت — العميل لازم يبعتلك رسالة جديدة عشان تقدر ترد عليه.';
  }
  if(row) row.style.display=open?'flex':'none';
  // المعاينة جزء من الكتابة — لو الكتابة مقفولة تختفي معاها بدل ما تفضل
  // معلّقة فوق بانر «مش هتقدر ترد»
  if(!open){ waClearReplyTo(); waClearPendingQr(); }
}

export function waPickImage(e){
  var f=e.target.files&&e.target.files[0];
  if(!f) return;
  if(!/^image\//.test(f.type)){ toast('الملف لازم يكون صورة','er'); e.target.value=''; return; }
  if(f.size>5*1024*1024){ toast('الصورة كبيرة (الحد 5 ميجا)','er'); e.target.value=''; return; }
  waPendingImage=f; waPendingDoc=null;
  waClearPendingQr();   // مرفق بالإيد بيكسب على الرد الجاهز — نيّة أحدث
  var df=$id('wa-docfile'); if(df) df.value='';
  var prev=$id('wa-attach-preview');
  var url=URL.createObjectURL(f);
  waSetPreviewUrl(url);
  prev.innerHTML='<img src="'+url+'"><span style="flex:1;font-size:.82rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name)+'</span><button class="wa-attach-x" id="wa-attach-x">شيل</button>';
  prev.style.display='flex';
  $id('wa-attach-x').addEventListener('click',waClearImage);
}

export function waPickFile(e){
  var f=e.target.files&&e.target.files[0];
  if(!f) return;
  waClearPendingQr();   // مرفق بالإيد بيكسب على الرد الجاهز — نيّة أحدث
  // لو صورة، عاملها معاملة الصور (تظهر inline للعميل)
  if(/^image\//.test(f.type)){
    if(f.size>5*1024*1024){ toast('الصورة كبيرة (الحد 5 ميجا)','er'); e.target.value=''; return; }
    waPendingImage=f; waPendingDoc=null;
    var prevI=$id('wa-attach-preview'); var urlI=URL.createObjectURL(f);
    waSetPreviewUrl(urlI);
    prevI.innerHTML='<img src="'+urlI+'"><span style="flex:1;font-size:.82rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name)+'</span><button class="wa-attach-x" id="wa-attach-x">شيل</button>';
    prevI.style.display='flex'; $id('wa-attach-x').addEventListener('click',waClearImage);
    return;
  }
  if(f.size>25*1024*1024){ toast('الملف كبير (الحد 25 ميجا)','er'); e.target.value=''; return; }
  waPendingDoc=f; waPendingImage=null;
  waSetPreviewUrl(null);   // معاينة صورة سابقة — الـURL كان بيفضل معلّق لحد الاختيار الجاي
  var imgf=$id('wa-file'); if(imgf) imgf.value='';
  var prev=$id('wa-attach-preview');
  prev.innerHTML='<span style="font-size:1.4rem">📎</span><span style="flex:1;font-size:.82rem;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name)+'</span><button class="wa-attach-x" id="wa-attach-x">شيل</button>';
  prev.style.display='flex';
  $id('wa-attach-x').addEventListener('click',waClearImage);
}

export function waClearImage(){
  waPendingImage=null; waPendingDoc=null;
  waSetPreviewUrl(null);
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
  if(kind==='image'&&url){ div.dataset.objurl=url; inner+='<img class="wa-img" src="'+url+'">'; if(text) inner+='<div class="wa-cap">'+esc(text)+'</div>'; }
  else if(kind==='doc'){ inner+='<span class="wa-doc">📎 '+esc(docName||'ملف')+'</span>'; if(text) inner+='<div class="wa-cap">'+esc(text)+'</div>'; }
  else { inner+='<div class="wa-text">'+esc(text)+'</div>'; }
  // الاقتباس بيظهر في الفقاعة من أول لحظة زي الاسم — الموظف شايف بالظبط
  // اللي هيوصل للعميل قبل ما السيرفر يرد
  if(waReplyTo && waReplyTo.wa_message_id){
    var qmap={}; qmap[waReplyTo.wa_message_id]=waReplyTo;
    var qurl={};
    if(waReplyTo.media_path && waUrlCache[waReplyTo.media_path]) qurl[waReplyTo.media_path]=waUrlCache[waReplyTo.media_path].url;
    inner = waQuoteBlock({ reply_to_wa_id: waReplyTo.wa_message_id }, qmap, qurl) + inner;
  }
  // الاسم بيظهر من أول لحظة مش بعد ما السيرفر يرد — عشان مايتنطّش قدام الموظف.
  // ده **عرض بس**: الاسم اللي بيتخزن بيتقرا من الـJWT جوه wa-send، والفرونت
  // عمره ما بيبعت اسم (العمود ممنوع عليه بصلاحيات الأعمدة أصلاً).
  var meName = (currentUser && currentUser.name) ? currentUser.name : '';
  inner+='<div class="wa-msg-time">'+waSenderTag({ sent_by_name: meName }, 'out')+'⏳</div>';
  // (⏳ بدل الوقت عمداً — الرسالة لسه ماتبعتتش فمفيش وقت حقيقي نكتبه)
  div.innerHTML=inner;
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
  return div;
}

export function waSend(){
  if(!waActiveId||!sb) return;
  var input=$id('wa-input');
  var text=(input.value||'').trim();
  // رد جاهز بصور: مسار مستقل (صور بالتسلسل وبعدين الكلام) — بس من نفس
  // الزرار عشان الموظف مايتعلمش سلوكين
  if(waPendingQr){ waSendQuickReply(text); return; }
  if(!waPendingImage && !waPendingDoc && !text) return;
  var convAtSend=waActiveId;
  // 🔴 بنلقط الرد **قبل** ما نصفّره — الإرسال غير متزامن والموظف ممكن
  // يبدأ رسالة تانية قبل ما دي ترد
  var replyAtSend = (waReplyTo && waReplyTo.wa_message_id) ? waReplyTo.wa_message_id : null;
  var imgFile=waPendingImage, docFile=waPendingDoc;
  var kind = imgFile?'image':(docFile?'doc':'text');
  var previewUrl = imgFile?URL.createObjectURL(imgFile):null;
  var docName = docFile?docFile.name:null;
  // فقاعة فورية تظهر في نفس اللحظة
  var bubble=waAppendOptimistic(text,kind,previewUrl,docName);
  // فضّي البوكس على طول
  input.value=''; input.style.height='auto'; waClearImage();
  waClearReplyTo();   // بعد الفقاعة عشان الاقتباس يترسم فيها
  function fail(code){
    waRevokeBubbleUrl(bubble);
    if(bubble&&bubble.parentNode) bubble.parentNode.removeChild(bubble);
    if(code==='window_closed'){ toast('النافذة قفلت — العميل لازم يبعتلك رسالة جديدة','er'); waUpdateWindow(waConvById(convAtSend)); }
    else if(code==='upload'){ toast('فشل رفع الملف','er'); }
    else if(code==='bad_reply_target'){ toast('الرسالة اللي بتحاول ترد عليها مش في المحادثة دي','er'); }
    // حارس مسار الميديا في `wa-send` (v8) — المفروض ماتوصلش للموظف أبداً
    // لأن اللوحة بتبني المسار بنفسها، فظهورها معناها فيه حاجة غلط في الرفع
    else if(code==='bad_media_path'){ toast('الملف مش من ملفات متجرك — جرّب ترفعه تاني','er'); }
    else if(code==='reply_failed'){ toast('واتساب رفض الرد على الرسالة دي (غالباً قديمة) — ابعتها كرسالة عادية','er'); }
    else { toast('الرسالة ماتبعتتش — حاول تاني','er'); }
    if(text && !$id('wa-input').value) $id('wa-input').value=text;
  }
  function done(res){
    var d=(res&&res.data)?res.data:null; var err=(res&&res.error)?res.error:null;
    if(err||!d||!d.ok){ fail(d&&d.error?d.error:''); return; }
    if(bubble){ var t=bubble.querySelector('.wa-msg-time');
      // الاسم من رد السيرفر (مصدر الحقيقة) وإلا اسمي المحلي — والاتنين ممكن
      // يبقوا فاضيين فمايتكتبش حاجة
      // مفيش `wa_message_id` لسه فمفيش زرار رد — وده صح: مانقدرش نرد على
      // رسالة معرّفها عندنا لسه ماوصلش. أول جلب بيرجّع الصف كامل بالزرار.
      if(t) t.innerHTML=waMetaRow({
        direction:'out', status:'sent', wa_timestamp:new Date().toISOString(),
        sent_by_name: (d.sent_by_name || (currentUser && currentUser.name) || '')
      }, 'out');
      bubble.classList.remove('wa-msg-pending'); }
    waFetchConvos(false);
  }
  if(imgFile){
    var ext=((imgFile.type.split('/')[1])||'jpg').replace('jpeg','jpg');
    var path=currentTenantId+'/'+convAtSend+'/out-'+Date.now()+'.'+ext;
    sb.storage.from('wa-media').upload(path,imgFile,{contentType:imgFile.type,upsert:false}).then(function(up){
      if(up.error){ fail('upload'); return; }
      return sb.functions.invoke('wa-send',{body:{conversation_id:convAtSend,image_path:path,caption:text,reply_to:replyAtSend}}).then(done);
    }).catch(function(){ fail('upload'); });
  } else if(docFile){
    var dext=((docFile.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8))||'bin';
    var dpath=currentTenantId+'/'+convAtSend+'/out-'+Date.now()+'.'+dext;
    sb.storage.from('wa-media').upload(dpath,docFile,{contentType:docFile.type||'application/octet-stream',upsert:false}).then(function(up){
      if(up.error){ fail('upload'); return; }
      return sb.functions.invoke('wa-send',{body:{conversation_id:convAtSend,document_path:dpath,filename:docFile.name,caption:text,reply_to:replyAtSend}}).then(done);
    }).catch(function(){ fail('upload'); });
  } else {
    sb.functions.invoke('wa-send',{body:{conversation_id:convAtSend,text:text,reply_to:replyAtSend}}).then(done).catch(function(){ fail(''); });
  }
}

// 🔴🔴 **ميتا مابتضمنش ترتيب التسليم — موثّق بالحرف:**
// «When sending a series of messages, the order in which messages are
//  delivered is **not guaranteed to match the order of your API requests**»
// والطريقة الوحيدة المضمونة في التوثيق هي انتظار `delivered` في الـwebhook
// قبل كل رسالة — **ومرفوضة هنا** لأن موبايل العميل لو مقفول التأكيد
// مابيجيش والرد ميكملش خالص.
//
// النسخة الأولى بعتت الصور بالتسلسل وبعدها الكلام رسالة مستقلة، وده اتجرّب
// حيّ (16 سبتمبر) **وطلع غلط عند العميل**: صورة ← كلام ← صورة. نداءاتنا
// كانت مرتبة (اتقاس: 19:13:37 · 19:13:39 · 19:13:41) والترتيب اتقلب عند
// ميتا. المعايرة اللي كانت موجودة بتثبت إن **نداءاتنا** مرتبة — وده حقيقي
// ومالوش علاقة باللي بيوصل للعميل (درس 26 بالحرف).
//
// 🔴 الشكل الحالي (قرار المالك بعد البلاغ): **الكلام caption على آخر صورة**.
// كده عدد الرسايل N مش N+1، والكلام **مستحيل** يتوسط الصور لأنه جزء من
// رسالة واحدة معاها. الصور ممكن تتبدل بين بعضها — ضرر شكلي مقبول.
//
// ⚠️ وحد الـcaption عند ميتا **1024 حرف** (موثّق). النص الأطول من كده
// بيرجع رسالة مستقلة في الآخر — رسالة اتبعتت بترتيب مش مظبوط أحسن من
// رسالة ميتا ترفضها وماتوصلش أصلاً.
//
// ⚠️ ولو صورة في النص وقعت، **بنقف** — مانكملش. العميل استلم صورتين من
// تلاتة وكلام بيتكلم عن التالتة = رسالة بتلخبط أكتر من رسالة ماوصلتش،
// والموظف بيشوف الغلط ويقرر.
var WA_CAPTION_MAX=1024;   // حد ميتا الموثّق للـcaption

export function waSendQuickReply(text){
  var convAtSend=waActiveId;
  var med=waPendingQr.media.slice();
  // الكلام بيركب آخر صورة طالما داخل الحد، وغير كده بيتبعت لوحده
  var asCaption = !!(text && med.length && text.length<=WA_CAPTION_MAX);
  var replyAtSend=(waReplyTo && waReplyTo.wa_message_id) ? waReplyTo.wa_message_id : null;
  var input=$id('wa-input');
  if(input){ input.value=''; input.style.height='auto'; }
  waClearPendingQr();
  waClearReplyTo();
  var btn=$id('wa-send-btn'); if(btn) btn.disabled=true;
  var sent=0;
  function done(){
    if(btn) btn.disabled=false;
    waFetchMessages(convAtSend,false,false);
    waFetchConvos(false);
  }
  function fail(code){
    if(btn) btn.disabled=false;
    if(code==='window_closed'){ toast('النافذة قفلت — العميل لازم يبعتلك رسالة جديدة','er'); waUpdateWindow(waConvById(convAtSend)); }
    else if(code==='bad_media_path') toast('صور الرد الجاهز مش من ملفات متجرك — امسح الرد واعمله تاني','er');
    else if(sent>0) toast('اتبعت '+sent+' من '+med.length+' صورة وبعدين وقف — الباقي والكلام مااتبعتوش','er');
    else toast('الرد الجاهز مااتبعتش — حاول تاني','er');
    // اللي مااتبعتش بيرجع للخانة عشان الموظف يقرر — مش بيضيع في صمت
    if(text && input && !input.value) input.value=text;
    waFetchMessages(convAtSend,false,false);
    waFetchConvos(false);
  }
  var i=0;
  function next(){
    if(waActiveId!==convAtSend){ done(); return; }   // الموظف بدّل المحادثة
    if(i>=med.length){
      // الكلام راكب آخر صورة خلاص — مفيش رسالة تانية
      if(!text || asCaption){ done(); return; }
      sb.functions.invoke('wa-send',{body:{conversation_id:convAtSend,text:text}})
        .then(function(res){
          var d=(res&&res.data)?res.data:null;
          if(!d||!d.ok){ fail(d&&d.error?d.error:''); return; }
          done();
        }).catch(function(){ fail(''); });
      return;
    }
    var m=med[i];
    // الاقتباس على أول رسالة بس — رد على نفس الرسالة 3 مرات تزحّم الشات
    var payload={conversation_id:convAtSend, image_path:m.path};
    if(asCaption && i===med.length-1) payload.caption=text;
    if(i===0 && replyAtSend) payload.reply_to=replyAtSend;
    sb.functions.invoke('wa-send',{body:payload}).then(function(res){
      var d=(res&&res.data)?res.data:null;
      if(!d||!d.ok){ fail(d&&d.error?d.error:''); return; }
      sent++; i++; next();
    }).catch(function(){ fail(''); });
  }
  next();
}

// ----- realtime + عدّاد التبويب (مرحلة 3) -----
export function handleWaRealtime(payload){
  if(tourActive) return;   // الإنبوكس وقت الجولة placeholder — مايتكتبش فوقه بمحادثات حقيقية
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
  var conv=waConvById(m.conversation_id);
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
  sb.from('wa_quick_replies').select('id,body,media').eq('tenant_id',currentTenantId).order('sort',{ascending:true}).order('created_at',{ascending:true}).then(function(r){
    if(r.error) return;
    waQuickReplies=r.data||[];
    waRenderQuickReplies();
  });
}

// عدد صور الرد — الشكل المخزّن مصفوفة، والصف القديم بيرجّع `[]` من
// الـdefault. أي قيمة مش مصفوفة بتتقري صفر بدل ما ترمي.
export function waQrMedia(q){
  var m=(q&&q.media);
  return (m && m.length && typeof m.length==='number') ? m : [];
}

export function waRenderQuickReplies(){
  var p=$id('wa-qr-panel'); if(!p) return;
  var html='';
  for(var i=0;i<waQuickReplies.length;i++){
    var q=waQuickReplies[i];
    var med=waQrMedia(q);
    var body=String(q.body==null?'':q.body).trim();
    // رد صور بس: النص فاضي عن قصد (الـCHECK في الداتابيز بيسمح بده طالما
    // فيه صور). شريحة من غير أي نص = شريحة مايعرفش حد هي إيه.
    var label=body || (med.length?('صور بس ('+med.length+')'):'—');
    html+='<span class="wa-qr" data-qid="'+esc(q.id)+'">'
      +(med.length?('<span class="wa-qr-badge">📎'+med.length+'</span>'):'')
      +'<span class="wa-qr-txt">'+esc(label)+'</span>'
      +'<span class="wa-qr-del" data-del="'+esc(q.id)+'" title="حذف">✕</span></span>';
  }
  if(!waQuickReplies.length) html+='<span class="wa-qr-empty">مفيش ردود جاهزة لسه — اكتب رد واحفظه 👇</span>';
  html+='<button class="wa-qr-add" id="wa-qr-add">＋ احفظ اللي مكتوب</button>';
  html+='<button class="wa-qr-add" id="wa-qr-new-media">🖼️ رد بصور</button>';
  p.innerHTML=html;
  var chips=p.querySelectorAll('.wa-qr');
  for(var j=0;j<chips.length;j++){
    chips[j].addEventListener('click',function(e){
      if(e.target && e.target.getAttribute && e.target.getAttribute('data-del')) return;
      waUseQuickReply(this.getAttribute('data-qid'));
    });
  }
  var dels=p.querySelectorAll('.wa-qr-del');
  for(var k=0;k<dels.length;k++){
    dels[k].addEventListener('click',function(e){ e.stopPropagation(); waDeleteQuickReply(this.getAttribute('data-del')); });
  }
  var add=$id('wa-qr-add');
  if(add) add.addEventListener('click',waSaveQuickReply);
  var addm=$id('wa-qr-new-media');
  if(addm) addm.addEventListener('click',waQrEditorOpen);
}

// ----- استخدام رد جاهز -----
// 🔴 **مفيش إرسال بضغطة واحدة.** الرد بصور بيتحط «محضّر» فوق خانة الكتابة
// والموظف بيدوس إرسال — زي الواتساب بيزنس بالظبط. ضغطة واحدة كانت تبعت
// 3 رسايل لعميل حقيقي من غير رجعة، والشريحة جنب شرايح تانية في لوحة
// بتتفتح بضغطة.
export var waPendingQr=null;

export function waUseQuickReply(qid){
  var item=waQuickReplies.filter(function(x){return x.id===qid;})[0];
  if(!item) return;
  var inp=$id('wa-input');
  if(inp){ inp.value=String(item.body==null?'':item.body); inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,120)+'px'; inp.focus(); }
  var med=waQrMedia(item);
  if(!med.length){ waClearPendingQr(); return; }
  // مرفق مختار بالإيد + رد جاهز بصور = نيّتين مختلفتين على نفس الضغطة.
  // آخر اختيار بيكسب، والتاني بيتشال **صراحةً** مش بيفضل معلّق.
  waClearImage();
  waPendingQr={ id:item.id, media:med.slice() };
  waRenderPendingQr();
}

export function waClearPendingQr(){
  waPendingQr=null;
  var bar=$id('wa-qr-staged'); if(bar){ bar.style.display='none'; }
  var body=$id('wa-qr-staged-body'); if(body) body.innerHTML='';
}

export function waRenderPendingQr(){
  var bar=$id('wa-qr-staged'), body=$id('wa-qr-staged-body');
  if(!bar||!body||!waPendingQr) return;
  var med=waPendingQr.media;
  body.innerHTML='<span class="wa-qr-staged-txt">🖼️ رد جاهز — '+med.length+' صورة هتتبعت قبل الكلام</span>';
  bar.style.display='flex';
  // المصغّرات بتتحل بروابط موقّعة زي أي ميديا تانية — الوسم بيتحط بعد
  // ما الرابط ينزل عشان مايبانش مكسور (نفس فخ مصغّرة الرد المقتبس)
  var paths=[];
  for(var i=0;i<med.length;i++){ if(med[i] && med[i].path) paths.push(med[i].path); }
  if(!paths.length || !sb) return;
  sb.storage.from('wa-media').createSignedUrls(paths,3600).then(function(res){
    if(!waPendingQr || !res || !res.data) return;
    var imgs='';
    for(var j=0;j<res.data.length;j++){
      var u=res.data[j] && res.data[j].signedUrl;
      if(u) imgs+='<img src="'+esc(u)+'" alt="">';
    }
    if(imgs) body.innerHTML=imgs+body.innerHTML;
  });
}

// ----- محرر الرد بصور -----
// الصور بتترفع **وقت الحفظ** مرة واحدة على `<tenant>/quick-replies/…`،
// وبعدها كل إرسال بيستخدم نفس المسار — مفيش رفع مع كل رسالة.
// (سياسة الـStorage الموجودة بتعزل بأول مجلد = المتجر، فمفيش سياسة جديدة.)
var waQrEdFiles=[], waQrEdUrls=[];

export function waQrEditorOpen(){
  var ed=$id('wa-qr-editor'); if(!ed) return;
  waQrEditorReset();
  var t=$id('wa-qr-ed-text');
  // اللي مكتوب في خانة الشات بيتنقل للمحرر — الموظف غالباً كاتب الرد فعلاً
  var inp=$id('wa-input');
  if(t){ t.value=inp?(inp.value||''):''; }
  ed.style.display='block';
  if(t) t.focus();
}

export function waQrEditorClose(){
  var ed=$id('wa-qr-editor'); if(ed) ed.style.display='none';
  waQrEditorReset();
}

function waQrEditorReset(){
  // blob URLs المعاينة لازم تترجع وإلا بتتراكم مع كل فتح
  for(var i=0;i<waQrEdUrls.length;i++){ try{ URL.revokeObjectURL(waQrEdUrls[i]); }catch(e){} }
  waQrEdFiles=[]; waQrEdUrls=[];
  var t=$id('wa-qr-ed-text'); if(t) t.value='';
  var f=$id('wa-qr-ed-file'); if(f) f.value='';
  waQrEditorThumbs();
}

export function waQrEditorPick(e){
  var f=e.target.files&&e.target.files[0];
  e.target.value='';
  if(!f) return;
  if(!/^image\//.test(f.type)){ toast('الملف لازم يكون صورة','er'); return; }
  if(f.size>5*1024*1024){ toast('الصورة كبيرة (الحد 5 ميجا)','er'); return; }
  // السقف 5 — نفس الـCHECK في الداتابيز. كل صورة رسالة واتساب مستقلة
  // (مفيش «ألبوم» في الـAPI)، فرد بـ12 صورة = 12 رسالة على العميل.
  if(waQrEdFiles.length>=5){ toast('الحد 5 صور للرد الواحد','er'); return; }
  waQrEdFiles.push(f);
  waQrEdUrls.push(URL.createObjectURL(f));
  waQrEditorThumbs();
}

function waQrEditorThumbs(){
  var box=$id('wa-qr-ed-thumbs'); if(!box) return;
  var html='';
  for(var i=0;i<waQrEdUrls.length;i++){
    html+='<span class="wa-qr-thumb"><img src="'+esc(waQrEdUrls[i])+'" alt="">'
      +'<button class="wa-qr-thumb-x" data-idx="'+i+'" title="شيل">✕</button></span>';
  }
  box.innerHTML=html;
  var xs=box.querySelectorAll('.wa-qr-thumb-x');
  for(var j=0;j<xs.length;j++){
    xs[j].addEventListener('click',function(){
      var idx=parseInt(this.getAttribute('data-idx'),10);
      if(isNaN(idx)) return;
      try{ URL.revokeObjectURL(waQrEdUrls[idx]); }catch(e){}
      waQrEdFiles.splice(idx,1); waQrEdUrls.splice(idx,1);
      waQrEditorThumbs();
    });
  }
}

export function waQrEditorSave(){
  if(!sb||!currentTenantId) return;
  var t=$id('wa-qr-ed-text');
  var body=t?(t.value||'').trim():'';
  if(!body && !waQrEdFiles.length){ toast('اكتب نص أو ضيف صورة','er'); return; }
  var btn=$id('wa-qr-ed-save');
  if(btn){ btn.disabled=true; btn.textContent='بيحفظ…'; }
  function fail(m){
    if(btn){ btn.disabled=false; btn.textContent='احفظ الرد'; }
    toast(m||'الحفظ مانفعش — حاول تاني','er');
  }
  // الرفع **بالتسلسل** عشان الترتيب اللي الموظف شافه في المحرر هو نفسه
  // اللي العميل هيشوفه
  var media=[], i=0;
  function next(){
    if(i>=waQrEdFiles.length){ save(); return; }
    var f=waQrEdFiles[i];
    var ext=((f.type.split('/')[1])||'jpg').replace('jpeg','jpg');
    var path=currentTenantId+'/quick-replies/'+Date.now()+'-'+i+'.'+ext;
    sb.storage.from('wa-media').upload(path,f,{contentType:f.type,upsert:false}).then(function(up){
      if(up.error){ fail('فشل رفع الصورة'); return; }
      media.push({path:path,mime:f.type,name:f.name});
      i++; next();
    }).catch(function(){ fail('فشل رفع الصورة'); });
  }
  function save(){
    sb.from('wa_quick_replies').insert({tenant_id:currentTenantId,body:body,media:media})
      .select('id,body,media').single().then(function(r){
        if(btn){ btn.disabled=false; btn.textContent='احفظ الرد'; }
        if(r.error){ toast('الحفظ مانفعش — حاول تاني','er'); return; }
        waQuickReplies.push(r.data);
        waQrEditorClose();
        waRenderQuickReplies();
        toast('الرد اتحفظ ✅','ok');
      });
  }
  next();
}

export function waSaveQuickReply(){
  var inp=$id('wa-input'); var body=inp?(inp.value||'').trim():'';
  if(!body){ toast('اكتب الرد الأول في الخانة','er'); return; }
  if(!sb||!currentTenantId) return;
  sb.from('wa_quick_replies').insert({tenant_id:currentTenantId,body:body,media:[]}).select('id,body,media').single().then(function(r){
    if(r.error){ toast('الحفظ مانفعش — حاول تاني','er'); return; }
    waQuickReplies.push(r.data); waRenderQuickReplies(); toast('اتحفظ كرد جاهز ✅','ok');
  });
}

export function waDeleteQuickReply(id){
  if(!id||!sb) return;
  sb.from('wa_quick_replies').delete().eq('id',id).then(function(r){
    if(r.error){ toast('الحذف مانفعش — حاول تاني','er'); return; }
    waQuickReplies=waQuickReplies.filter(function(x){return x.id!==id;}); waRenderQuickReplies();
  });
}

// ----- تصنيفات وملاحظات المحادثة -----
// ⚠️ التصنيفات **مالهاش CHECK في الداتابيز** (`wa_conversations.labels`
// عمود `text[]` حر — اتأكد على الحي)، فالمصفوفة دي هي التعريف الوحيد.
// معناها كمان إن أي تصنيف اتشال من هنا بيفضل مكتوب على المحادثات
// القديمة وبيترسم باللون الرمادي بتاع `waLabelColor` — فالحذف مش مجاني.
//
// 🔴 الترتيب: الخمسة الأولانيين في أماكنهم زي ما هم (التاجر متعوّد
// عليهم ومستخدمهم فعلاً — تم الحل 11 · شكوى 4 · مهم 4 · VIP 2)،
// والأربعة الجداد (طلب المالك 19 سبتمبر) اتحطوا وراهم بترتيب رحلة
// الأوردر: طلب ← استبدال ← استرجاع ← مكتمل.
//
// ⚠️ ولا لون منهم قريب من `#64748b` — ده لون الـfallback بتاع تصنيف
// **مش معروف**، ولو تصنيف حقيقي أخده التاجر مش هيفرّق بين «مكتمل»
// و«تصنيف مش في القايمة».
export var WA_LABELS=[
  {k:'مهم',c:'#ef4444'},
  {k:'VIP',c:'#8b5cf6'},
  {k:'شكوى',c:'#f59e0b'},
  {k:'تم الحل',c:'#10b981'},
  {k:'متابعة',c:'#2563eb'},
  {k:'طلب واتساب',c:'#15803d'},
  {k:'استبدال',c:'#0891b2'},
  {k:'استرجاع',c:'#db2777'},
  {k:'مكتمل',c:'#78350f'}
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
  var conv=waConvById(waActiveId);
  if(!conv||!sb) return;
  var labels=(conv.labels||[]).slice();
  var idx=labels.indexOf(label);
  if(idx>=0) labels.splice(idx,1); else labels.push(label);
  conv.labels=labels;
  waRenderConvLabels(conv); waRenderLabelPicker(conv); renderConvos();
  sb.from('wa_conversations').update({labels:labels}).eq('id',conv.id).then(function(r){
    if(r.error){ toast('التصنيف ماتحفظش — حاول تاني','er'); return; }
    // العدّادات على الـchips بتتحسب من `waLabelExtra` كمان — من غير
    // الجلب ده، محادثة أخدت أول تصنيف ليها وهي بره أحدث 200 مابتتعدّش
    waFetchLabelConvos();
  });
}

export function waSaveNote(){
  var conv=waConvById(waActiveId);
  if(!conv||!sb) return;
  var ni=$id('wa-note-input'); var val=ni?(ni.value||'').trim():'';
  conv.note=val;
  sb.from('wa_conversations').update({note:val||null}).eq('id',conv.id).then(function(r){
    if(r.error){ toast('الملاحظة ماتحفظتش — حاول تاني','er'); return; }
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

// ═══ «إنشاء طلب» يدوي من الشات (طلب المالك 16 سبتمبر) ═══
// العميل بيطلب على الواتساب ويكتب بياناته، والموظف بيسجّل الأوردر زي أي
// أوردر جاي من اللاندنج.
//
// 🔴 **كل الحراسات على السيرفر** في `create_manual_order` (SECURITY DEFINER):
// `tenant_id` من الـJWT · رقم الطلب في نطاق `W-` منفصل عن ترقيم اللاندنج ·
// cooldown 90 ثانية. اللي هنا **راحة للموظف بس** — رسالة أوضح قبل ما
// يستنى الشبكة، مش حاجز.
//
// 🔴 **الحالة عمرها ما بتيجي من المتصفح** — الدالة هي اللي بتقررها.
// من 19 سبتمبر الأوردر بينزل **مؤكد** (طلب المالك: العميل أكّد على
// الواتساب أصلاً). والدالة بتعمل ده بـ`INSERT pending` ثم `UPDATE`
// لـ`confirmed` **في نفس الترانزاكشن** — مش `INSERT` مباشر بـ`confirmed`،
// لأن `charge_order_on_status_change` بتعدّي أي إدخال أول بحالة محاسَبة
// **من غير خصم وللأبد** (اتقاس بترانزاكشن راجعة). يعني الخصم بقى بيحصل
// **لحظة الإنشاء** مش بعد ضغطة الموظف — وعشان كده بننادي
// `loadWalletState()` بعد النجاح تحت.
export function waNewOrderOpen(){
  var box=$id('wa-neworder'); if(!box) return;
  var conv=waConvById(waActiveId); if(!conv) return;
  // البيانات اللي إحنا متأكدين منها بتتعبّى من المحادثة — ده كل الفرق
  // بين «فورم» و«فورم من الشات»
  var nm=$id('wa-no-name'); if(nm) nm.value=String(conv.customer_name||'').trim();
  var ph=$id('wa-no-phone');
  if(ph){
    // `wa_id` بيبقى `20xxxxxxxxxx` والأوردرات متخزّنة محلي `01xxxxxxxxx`
    // (4,051 من 4,076 صف — اتقاس). السيرفر بيطبّع برضه، بس الموظف لازم
    // يشوف الرقم بالشكل اللي بيتعامل بيه.
    var raw=String(conv.customer_phone||conv.wa_id||'').replace(/\D/g,'');
    ph.value = (raw.length===12 && raw.indexOf('20')===0) ? ('0'+raw.slice(2)) : raw;
  }
  ['wa-no-alt','wa-no-city','wa-no-address','wa-no-product','wa-no-var','wa-no-total','wa-no-notes']
    .forEach(function(id){ var e=$id(id); if(e) e.value=''; });
  var q=$id('wa-no-qty'); if(q) q.value='1';
  box.style.display='block';
  waNewOrderProducts();
  if(nm) nm.focus();
}

export function waNewOrderClose(){ var b=$id('wa-neworder'); if(b) b.style.display='none'; }

// قايمة المنتجات من المخزون — الاسم لازم يطابق `stock_products` وإلا
// التكلفة والخصم مش هيلاقوا المنتج (فيه تنبيه في صفحة issues بيرصد ده).
// بنعرض الأسماء الكاملة زي ما هي، والموظف يقدر يكتب اسم بره القايمة.
function waNewOrderProducts(){
  var dl=$id('wa-no-prodlist'); if(!dl) return;
  function fill(){
    var html='';
    for(var i=0;i<stockProducts.length;i++){
      var n=stockProducts[i] && stockProducts[i].name;
      if(n) html+='<option value="'+esc(n)+'"></option>';
    }
    dl.innerHTML=html;
  }
  if(stockProducts && stockProducts.length){ fill(); return; }
  if(!sb||!currentTenantId) return;
  sb.from('v_stock_products').select('id,name,current_qty,unit_price,wholesale_price,parent_id,variant_label')
    .eq('tenant_id',currentTenantId).eq('active',true).order('current_qty',{ascending:false}).then(function(r){
      if(!r.error && r.data) stockSetProducts(r.data);
      fill();
    });
}

export function waNewOrderSave(){
  if(!sb) return;
  var conv=waConvById(waActiveId); if(!conv) return;
  var val=function(id){ var e=$id(id); return e?(e.value||'').trim():''; };
  var name=val('wa-no-name'), phone=val('wa-no-phone'), address=val('wa-no-address');
  var product=val('wa-no-product'), total=val('wa-no-total');
  var qty=parseInt(val('wa-no-qty'),10); if(!qty||qty<1) qty=1;
  if(!name){ toast('اكتب اسم العميل','er'); return; }
  if(!phone){ toast('اكتب تليفون العميل','er'); return; }
  if(address.length<10){ toast('العنوان قصير — شركة الشحن بترفضه','er'); return; }
  if(!product){ toast('اكتب المنتج','er'); return; }
  if(total===''||isNaN(Number(total))||Number(total)<0){ toast('اكتب إجمالي صحيح','er'); return; }

  // نفس صيغة n8n بالحرف: «الاسم (عدد N)». أي شكل تاني بيكسر
  // `parseProductItems` ومحرر المنتجات في نافذة التفاصيل.
  var productName=product+' (عدد '+qty+')';
  var btn=$id('wa-no-save');
  if(btn){ btn.disabled=true; btn.textContent='بيسجّل…'; }
  sb.rpc('create_manual_order',{
    p_customer_name:name, p_phone:phone, p_city:val('wa-no-city'), p_address:address,
    p_product_name:productName, p_total_cost:Number(total),
    p_alt_phone:val('wa-no-alt')||null, p_customer_notes:val('wa-no-notes')||null,
    p_var:val('wa-no-var')||null
  }).then(function(r){
    if(btn){ btn.disabled=false; btn.textContent='سجّل الطلب'; }
    var d=r&&r.data;
    if(r&&r.error){ toast('الطلب مااتسجّلش — حاول تاني','er'); return; }
    if(!d||!d.ok){
      var e=d&&d.error;
      // كل رفض بيتقال بسببه الحقيقي — «حصلت مشكلة» بتخلي الموظف يعيد
      // المحاولة بنفس البيانات الغلط
      if(e==='duplicate') toast('فيه طلب لنفس الرقم اتسجّل من شوية — راجع القايمة','er');
      else if(e==='bad_phone') toast('رقم التليفون مش مظبوط','er');
      else if(e==='bad_alt_phone') toast('التليفون التاني مش مظبوط','er');
      else if(e==='short_address') toast('العنوان قصير — شركة الشحن بترفضه','er');
      else if(e==='bad_total') toast('الإجمالي مش صحيح','er');
      else if(e==='not_allowed') toast('حسابك مش مفعّل على متجر','er');
      else toast('الطلب مااتسجّلش — حاول تاني','er');
      return;
    }
    toast('الطلب اتسجّل ✅ '+d.order_uid+' — مؤكد','ok');
    waNewOrderClose();
    // 🔴 الإنشاء بقى بيخصم (الأوردر بينزل مؤكد)، فشريط الباقة والرصيد
    // بيبقوا على قيمة قديمة من غير النداء ده — والأخطر إن
    // `walletStateCache.is_depleted` بيفضل `false` محلياً لو الأوردر ده
    // هو اللي وصّل المحفظة للنفاد، فالواجهة مش هتقفل.
    loadWalletState();
    // كارت أوردرات العميل بيدوّر بالتليفون فالطلب الجديد بيظهر لوحده
    waLoadOrders(waConvById(waActiveId));
  }).catch(function(){
    if(btn){ btn.disabled=false; btn.textContent='سجّل الطلب'; }
    toast('الطلب مااتسجّلش — حاول تاني','er');
  });
}

// ----- أوردرات العميل جوّه الشات -----
export function waDateShort(iso){
  if(!iso) return '';
  try{ return new Date(iso).toLocaleDateString('ar-EG-u-nu-latn',{day:'2-digit',month:'2-digit',year:'2-digit'}); }catch(e){ return ''; }
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
      if(r.error){ body.innerHTML='<div class="wa-orders-empty">حصلت مشكلة في تحميل الأوردرات</div>'; return; }
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

// ═══ «شات جديد» — بدء محادثة مع رقم عمره ما كلّمنا (طلب المالك 16 سبتمبر) ═══
// العميل بيكلّم التاجر على الموبايل ويقوله «ابعتلي على واتساب». واتساب
// مابيسمحش نبدأ إحنا برسالة عادية — نافذة الـ24 ساعة مافتحتش أصلاً لأن
// العميل عمره ما بعت حاجة. القالب هو الطريق الوحيد.
//
// 🔴 **كل الحراسات على السيرفر** في `wa-start`: التصريح بقراية القالب
// بتوكن المستخدم عبر RLS · النص وقيم المتغيرات من الداتابيز مش من هنا ·
// النافذة المفتوحة بترفض (رسالة عادية ببلاش) · قالب واحد لكل رقم كل 24
// ساعة · قفل النفاد. اللي هنا **راحة للموظف بس**، مش حاجز.
export var waStartTpls=[];

export function waLoadStartTemplates(){
  if(!sb||!currentTenantId) return;
  sb.from('wa_start_templates').select('id,label,body,params,template_name,lang')
    .eq('tenant_id',currentTenantId).eq('enabled',true).order('label')
    .then(function(r){
      if(r.error){ swallow('wa_start_templates',r.error); return; }
      waStartTpls=r.data||[];
      waNewChatFillTpls();
      // 🔴 مفيش قالب مسجّل = الزرار مايبانش خالص (درس 16). زرار بيفتح
      // فورم مالهاش ولا قالب = وعد كاذب، والموظف بيدوس ومايحصلش حاجة.
      var b=$id('wa-newchat-btn');
      if(b) b.style.display = waStartTpls.length ? '' : 'none';
      if(!waStartTpls.length) waNewChatClose();
    });
}

export function waStartTplById(id){
  for(var i=0;i<waStartTpls.length;i++){ if(waStartTpls[i].id===id) return waStartTpls[i]; }
  return null;
}

// 🔴 نسخة طبق الأصل من `renderTemplate` في `wa-start` — **لازم يفضلوا
// متطابقين**. المعاينة اللي الموظف بيوافق عليها لازم تبقى بالحرف هي اللي
// ميتا هتبعتها؛ أي انحراف = مودال بيكدب على رسالة بفلوس.
// و`replace` بمرة واحدة مش `replaceAll` لسببين: الـ`$` في نص البديل ليه
// معنى خاص (`$&` و`$'`)، والتعويض على مراحل بيخلي قيمة جوّاها `{{2}}`
// تتعوّض هي كمان في اللفة اللي بعديها.
export function waStartRender(t){
  if(!t) return '';
  var vals = Array.isArray(t.params) ? t.params : [];
  return String(t.body||'').replace(/\{\{([1-9]\d?)\}\}/g, function(m,i){
    var v = vals[Number(i)-1];
    return v===undefined ? m : String(v);
  });
}

function waNewChatFillTpls(){
  var sel=$id('wa-nc-tpl'); if(!sel) return;
  var keep=sel.value;
  var html='';
  for(var i=0;i<waStartTpls.length;i++){
    html+='<option value="'+esc(waStartTpls[i].id)+'">'+esc(waStartTpls[i].label||waStartTpls[i].template_name||'قالب')+'</option>';
  }
  sel.innerHTML=html;
  if(keep && waStartTplById(keep)) sel.value=keep;
  waNewChatPreview();
}

export function waNewChatPreview(){
  var sel=$id('wa-nc-tpl'), box=$id('wa-nc-prev');
  if(!box) return;
  // `textContent` مش `innerHTML` — النص جاي من الداتابيز وبيتعرض زي ما هو
  box.textContent = waStartRender(waStartTplById(sel?sel.value:''));
}

export function waNewChatOpen(){
  var box=$id('wa-newchat'); if(!box) return;
  if(!waStartTpls.length){ toast('مفيش قالب مسجّل لبدء المحادثات','er'); return; }
  var ph=$id('wa-nc-phone'); if(ph) ph.value='';
  var nm=$id('wa-nc-name'); if(nm) nm.value='';
  box.style.display='flex';
  waNewChatFillTpls();
  if(ph) ph.focus();
}

export function waNewChatClose(){ var b=$id('wa-newchat'); if(b) b.style.display='none'; }

export function waNewChatSend(){
  if(!sb) return;
  var ph=$id('wa-nc-phone'), nm=$id('wa-nc-name'), sel=$id('wa-nc-tpl');
  var phone=ph?(ph.value||'').trim():'';
  var name=nm?(nm.value||'').trim():'';
  var tpl=waStartTplById(sel?sel.value:'');
  // فحص خفيف بس: التطبيع الحقيقي على السيرفر بنفس دالة تريجر المحادثات،
  // وهو اللي بيقرر. هنا بنمنع الضغطة الفاضية مش أكتر.
  if(phone.replace(/\D/g,'').length<10){ toast('اكتب رقم صحيح','er'); return; }
  if(!tpl){ toast('اختار القالب','er'); return; }

  // 🔴 مودال بالنص المرسوم كامل — الرسالة بفلوس وبتوصل عميل حقيقي،
  // فالموظف بيوافق على **اللي العميل هيقراه** مش على «رسالة بدء محادثة».
  // نفس عقد مودال متابعة الأوردر بالحرف.
  showModal({
    icon:'💬',
    title:'تبعت للرقم '+phone+'؟',
    sub:waStartRender(tpl)+'\n\n— رسالة قالب مدفوعة من رقم المتجر.',
    okLabel:'ابعت',
    onOk:function(){
      var btn=$id('wa-nc-send');
      if(btn){ btn.disabled=true; btn.textContent='بيبعت…'; }
      var restore=function(){ if(btn){ btn.disabled=false; btn.textContent='ابعت'; } };
      sb.functions.invoke('wa-start',{body:{phone:phone,template_id:tpl.id,name:name||null}})
        .then(function(res){
          restore();
          var d=(res&&res.data)?res.data:null;
          if(!d||!d.ok){
            var e=d&&d.error;
            // كل رفض بيتقال بسببه الحقيقي — «حصلت مشكلة» بتخلي الموظف
            // يعيد المحاولة بنفس الإدخال الغلط
            if(e==='window_open'){
              toast('العميل ده كلّمنا في آخر 24 ساعة — ابعتله رسالة عادية ببلاش','er');
              waNewChatClose();
              if(d.conversation_id){ waFetchConvos(false); openConversation(d.conversation_id); }
            }
            else if(e==='too_soon'){ toast('اتبعتله قالب في آخر 24 ساعة — استنى','er'); if(d.conversation_id) openConversation(d.conversation_id); }
            else if(e==='bad_phone') toast('الرقم مش مظبوط','er');
            else if(e==='no_wa_config') toast('الواتساب مش مركّب على المتجر','er');
            else if(e==='depleted') toast('الرصيد خلص — اشحن عشان تبعت','er');
            else if(e==='not_allowed') toast('حسابك مش مفعّل على متجر','er');
            else if(e==='template_disabled') toast('القالب ده متوقف','er');
            else if(e==='bad_template_params') toast('إعداد القالب مش مظبوط — راجع متغيراته','er');
            // سبب ميتا الحقيقي (قالب تحت المراجعة · لغة غلط · رقم مش على
            // واتساب) — التاجر مايقدرش يصلّح إعداد مايعرفش إيه فيه
            else if(e==='template_failed') toast('واتساب رفض: '+(d.detail||'سبب غير معروف'),'er');
            else toast('الرسالة ماتبعتتش — حاول تاني','er');
            return;
          }
          toast('الرسالة اتبعتت ✅','ok');
          waNewChatClose();
          // الشات بيتفتح على طول — ده كل الهدف من الزرار
          waFetchConvos(false);
          if(d.conversation_id) openConversation(d.conversation_id);
        })
        .catch(function(){ restore(); toast('الرسالة ماتبعتتش — حاول تاني','er'); });
    }
  });
}

// تفاعلات صندوق المحادثات
export function initInbox(){
  if($id('wa-refresh'))$id('wa-refresh').addEventListener('click',function(){waFetchConvos(true);if(waActiveId)waFetchMessages(waActiveId,true,false);});
  if($id('wa-search'))$id('wa-search').addEventListener('input',function(){ waSearchQuery=(this.value||'').trim().toLowerCase(); renderConvos(); });
  if($id('wa-back'))$id('wa-back').addEventListener('click',function(){var w=$id('wa-wrap');if(w)w.classList.remove('show-chat');waActiveId=null;renderConvos();});
  if($id('wa-send-btn'))$id('wa-send-btn').addEventListener('click',waSend);
  if($id('wa-reply-cancel'))$id('wa-reply-cancel').addEventListener('click',waClearReplyTo);
  // Esc بيلغي الرد — أسرع من الوصول للزرار وانت بتكتب
  if($id('wa-input'))$id('wa-input').addEventListener('keydown',function(e){
    if(e.key==='Escape' && waReplyTo){ e.preventDefault(); waClearReplyTo(); }
  });
  if($id('wa-qr-btn'))$id('wa-qr-btn').addEventListener('click',function(){
    var p=$id('wa-qr-panel'); if(p) p.classList.toggle('open');
    if(p && !p.classList.contains('open')) waQrEditorClose();
  });
  if($id('wa-qr-ed-cancel'))$id('wa-qr-ed-cancel').addEventListener('click',waQrEditorClose);
  if($id('wa-qr-ed-addimg'))$id('wa-qr-ed-addimg').addEventListener('click',function(){ var f=$id('wa-qr-ed-file'); if(f) f.click(); });
  if($id('wa-qr-ed-file'))$id('wa-qr-ed-file').addEventListener('change',waQrEditorPick);
  if($id('wa-qr-ed-save'))$id('wa-qr-ed-save').addEventListener('click',waQrEditorSave);
  if($id('wa-qr-staged-cancel'))$id('wa-qr-staged-cancel').addEventListener('click',waClearPendingQr);
  if($id('wa-neworder-btn'))$id('wa-neworder-btn').addEventListener('click',function(e){
    // الزرار جوّه هيدر بيطوي الكارت بالضغط — من غير ده الفورم بتفتح والكارت
    // بيتطوي في نفس اللحظة
    e.stopPropagation();
    var b=$id('wa-neworder');
    if(b && b.style.display!=='none') waNewOrderClose(); else waNewOrderOpen();
  });
  if($id('wa-newchat-btn'))$id('wa-newchat-btn').addEventListener('click',function(){
    var b=$id('wa-newchat');
    if(b && b.style.display!=='none') waNewChatClose(); else waNewChatOpen();
  });
  if($id('wa-nc-cancel'))$id('wa-nc-cancel').addEventListener('click',waNewChatClose);
  if($id('wa-nc-tpl'))$id('wa-nc-tpl').addEventListener('change',waNewChatPreview);
  if($id('wa-nc-send'))$id('wa-nc-send').addEventListener('click',waNewChatSend);
  if($id('wa-no-cancel'))$id('wa-no-cancel').addEventListener('click',waNewOrderClose);
  if($id('wa-no-save'))$id('wa-no-save').addEventListener('click',waNewOrderSave);
  if($id('wa-docattach'))$id('wa-docattach').addEventListener('click',function(){ var f=$id('wa-docfile'); if(f) f.click(); });
  if($id('wa-docfile'))$id('wa-docfile').addEventListener('change',waPickFile);
  if($id('wa-label-btn'))$id('wa-label-btn').addEventListener('click',function(){ var lp=$id('wa-label-picker'); if(!lp) return; var show=lp.style.display==='none'; if(show){ var conv=waConvById(waActiveId); waRenderLabelPicker(conv); } lp.style.display=show?'flex':'none'; this.classList.toggle('on',show); });
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
