// كارت «رد مقترح» من الـAI Agent فوق خانة الكتابة (v84 — 15 نوفمبر، طلب المالك: «خلي الرسايل المقترحة تظهر للموظف عادي»)
//
// الـAgent شغّال shadow: `wa-ai-draft` بتكتب مسودة في `wa_ai_drafts` لكل رسالة واردة (بعد ~12ث انتظار + ~6ث توليد)
// وعمرها ما بتبعت للعميل. الكارت ده بيعرض المسودة للموظف، وهو اللي يقرر:
//   • «✏️ حطّه في خانة الكتابة» = النص بيتحط في الخانة **من غير إرسال** — الموظف بيراجع/يعدّل ويدوس إرسال بإيده
//   • «✕» = تجاهل (بيتسجّل rejected)
// 🔴 مفيش أي مسار هنا بيبعت للعميل. الإرسال الوحيد هو زرار الإرسال العادي (`waSend`).
// 🔴 الكتابة على المسودة من `wa_ai_draft_review` بس (DEFINER) — مفيش update مباشر (الجدول قراية بس للمتصفح).
//
// 🔴 الـEgress (قاعدة v82 — اللي اتغيّر بس): مفيش poll دوري ولا ريل-تايم. طلب صغير (~1 KB) بالـ`trigger_message_id`
// للمحادثة **المفتوحة** بس، وبس لما آخر رسالة فيها واردة من العميل: مرة عند الفتح، وللرسالة الجديدة في مواعيد
// محسوبة من وقتها (المسودة بتنزل بعد ~18ث) لحد ما تتلاقي. التاب في الخلفية = مفيش طلب (بيتأجّل لحد ما ترجع).
//
// الموديول ده مابيستوردش حاجة من inbox.js عمداً (مفيش دورة): inbox بينادي `aiDraftSync` من `renderMessages` و`aiDraftNoteSent`
// بعد نجاح الإرسال و`aiDraftReset` مع تبديل المحادثة.

import { $id, esc } from '../core/dom.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { swallow } from '../core/log.js';

// 🔴 = قايمة الاستبعاد في التريجر `trg_wa_ai_draft_enqueue` و`preRule` (_shared/ai-draft.ts) بالحرف —
// الأنواع دي مابيتعملهاش مسودة، فمابندوّرش على مسودة ليها
var AI_SKIP_TYPES = { button: 1, reaction: 1, sticker: 1, unsupported: 1 };
// مواعيد السؤال بعد وقت رسالة العميل (ms): 12ث انتظار + ~6ث توليد = ~18ث · والباقي لو الموديل اتأخر
// (اتقاس على أول 6 مسودات حية 15 نوفمبر: التوليد 4–31ث = المسودة بتنزل بعد 16–43ث من الرسالة)
var AI_DELAYS = [19000, 28000, 42000, 58000, 80000, 150000];
var AI_WINDOW_MS = 24 * 3600 * 1000;   // بعد 24 ساعة النافذة مقفولة — الرد المقترح مالوش لازمة
var AI_COLS = 'id,conversation_id,trigger_message_id,behavior,intent,body,media,status,error,created_at';

var AI_BEHAVIORS = {
  answer: 'إجابة',
  collect: 'تجميع بيانات الأوردر',
  order_lookup: 'استعلام عن أوردر',
  clarify: 'سؤال توضيحي',
  escalate: '⚠️ محتاج موظف'
};

var aiConv = null;       // المحادثة اللي الحالة دي بتاعتها
var aiTrigger = null;    // id رسالة العميل اللي مستنيين/عارضين مسودتها
var aiTriggerAt = 0;     // وقت الرسالة دي
var aiDraft = null;      // المسودة المعروضة (pending) — null = مفيش كارت
var aiTimers = [];
var aiGen = 0;           // جيل الطلبات — رد قديم (محادثة/رسالة تانية) بيترمي
var aiDeferred = false;  // طلب اتأجّل والتاب في الخلفية / الصفحة مش ظاهرة
var aiUsed = null;       // {id, body} — الموظف حط المسودة دي في الخانة (لتسجيل sent/edited بعد الإرسال)
var aiDone = {};         // trigger ids اللي اتقفلت في الجلسة (اتبعت رد · اتجاهلت) — مايتسألش عنها تاني
var aiCollapsed = null;  // الموظف طوى/فتح الكارت بإيده (null = الافتراضي: مطوي على الموبايل عشان الرسايل تبان)

function aiIsCollapsed(){
  if(aiCollapsed !== null) return aiCollapsed;
  return typeof window !== 'undefined' && window.innerWidth <= 768;
}

function aiClearTimers(){
  for(var i = 0; i < aiTimers.length; i++) clearTimeout(aiTimers[i]);
  aiTimers = [];
}

function aiHide(){
  var el = $id('wa-ai-draft');
  if(el && el.parentNode) el.parentNode.removeChild(el);
}

// تبديل المحادثة · الرجوع للقايمة · قفل النفاد — كارت عميل مايفضلش فوق شات عميل تاني
export function aiDraftReset(){
  aiGen++;
  aiClearTimers();
  aiConv = null; aiTrigger = null; aiTriggerAt = 0; aiDraft = null; aiDeferred = false; aiUsed = null;
  aiHide();
}

// آخر رسالة «حقيقية» في المحادثة: لو واردة من العميل = هي اللي ليها مسودة · لو صادرة = اترد عليه خلاص
function aiTargetOf(msgs){
  for(var i = (msgs || []).length - 1; i >= 0; i--){
    var m = msgs[i];
    if(!m) continue;
    if(m.direction === 'out') return null;
    if(AI_SKIP_TYPES[m.type || 'text']) continue;   // ضغطة زرار/تفاعل بعد كلام العميل — المسودة على الكلام
    return m;
  }
  return null;
}

// بيتنادى من renderMessages مع كل رسم (رخيص — مفيش طلب غير لما رسالة العميل الأخيرة تتغيّر)
export function aiDraftSync(convId, msgs){
  if(!convId){ aiDraftReset(); return; }
  if(convId !== aiConv){ aiDraftReset(); aiConv = convId; }
  var t = aiTargetOf(msgs);
  if(!t || !t.id || aiDone[t.id]){
    // اترد عليه (أو مفيش رسايل) — الكارت والمواعيد بيتشالوا
    if(aiTrigger || aiDraft){ aiGen++; aiClearTimers(); aiTrigger = null; aiDraft = null; aiDeferred = false; aiHide(); }
    return;
  }
  if(t.id === aiTrigger){
    if(aiDraft) aiRender();                 // الكارت اتشال مع رسم (مثلاً النافذة اتفتحت) — يرجع
    else if(aiDeferred) aiFetch();          // كان متأجّل والتاب/الصفحة رجعت
    return;
  }
  // رسالة عميل جديدة: المسودة القديمة بقت على كلام فات
  aiGen++; aiClearTimers(); aiDraft = null; aiUsed = null; aiDeferred = false; aiHide();
  aiTrigger = t.id;
  aiTriggerAt = Date.parse(t.created_at || '') || Date.now();
  var rawAge = Date.now() - aiTriggerAt;
  var age = Math.max(0, rawAge);   // ساعة الجهاز ورا السيرفر بشوية = نعتبرها لسه واصلة
  if(age > AI_WINDOW_MS) return;
  // ساعة الجهاز ورا السيرفر بأكتر من دقيقة = مانعرفش الرسالة عمرها قد إيه — نسأل دلوقتي كمان
  var immediate = rawAge < -60000, myGen = aiGen;
  AI_DELAYS.forEach(function(d){
    var wait = d - age;
    if(wait <= 0){ immediate = true; return; }
    aiTimers.push(setTimeout(function(){ if(myGen === aiGen && !aiDraft) aiFetch(); }, wait));
  });
  if(immediate) aiFetch();
}

function aiVisible(){
  if(typeof document !== 'undefined' && document.hidden) return false;
  var p = $id('page-inbox');
  return !!(p && p.style.display !== 'none');
}

function aiFetch(){
  if(!sb || !aiTrigger) return;
  if(!aiVisible()){ aiDeferred = true; return; }
  aiDeferred = false;
  var myGen = aiGen, trig = aiTrigger;
  sb.from('wa_ai_drafts').select(AI_COLS).eq('trigger_message_id', trig).limit(1).then(function(r){
    if(myGen !== aiGen || trig !== aiTrigger) return;   // محادثة/رسالة تانية — رد قديم
    if(!r || r.error) return;                           // الجدول مش موجود/نت — المعاد الجاي بيجرّب
    var row = (r.data || [])[0];
    if(!row) return;                                    // لسه ماتعملتش — المعاد الجاي
    aiClearTimers();
    if(row.status !== 'pending'){ aiDone[trig] = 1; return; }   // زميل اتعامل معاها خلاص
    aiDraft = row;
    aiRender();
  }, function(e){ swallow('aiFetch', e); });
}

function aiNote(d){ return (d && d.media && d.media.note) ? String(d.media.note) : ''; }
function aiCardTitle(d){ return (d && d.media && d.media.card && d.media.card.title) ? String(d.media.card.title) : ''; }

function aiRender(){
  var d = aiDraft, host = $id('wa-compose');
  if(!d || !host){ aiHide(); return; }
  // النافذة مقفولة = خانة الكتابة مخفية — الكارت مالوش مكان
  var row = $id('wa-compose-row');
  if(row && row.style.display === 'none'){ aiHide(); return; }
  var body = String(d.body || '').trim(), note = aiNote(d), card = aiCardTitle(d);
  // مفيش حاجة تتعرض (skip · موديل وقع من غير ملاحظة) = مفيش كارت
  if(d.behavior === 'skip' || (!body && !note && !card)){ aiHide(); return; }
  var beh = AI_BEHAVIORS[d.behavior] || '';
  var h = '<div class="wa-ai-head" data-ai="toggle" title="اطوي/افتح الرد المقترح">'
    + '<span class="wa-ai-tag">🤖 رد مقترح</span>'
    + (beh ? '<span class="wa-ai-beh b-' + esc(d.behavior) + '">' + esc(beh) + '</span>' : '')
    + '<span class="wa-ai-trial">تجربة — راجعه كويس قبل أي استخدام</span>'
    + '<span class="wa-ai-arrow">▾</span>'
    + '<button type="button" class="wa-ai-x" data-ai="reject" title="تجاهل الاقتراح">✕</button>'
    + '</div>';
  if(body) h += '<div class="wa-ai-body">' + esc(body) + '</div>';
  if(card) h += '<div class="wa-ai-card">📎 ومعاه كارت «' + esc(card) + '» من الردود المحفوظة</div>';
  if(note) h += '<div class="wa-ai-note">📝 ملاحظة ليك: ' + esc(note) + '</div>';
  if(body) h += '<div class="wa-ai-acts"><button type="button" class="wa-ai-use" data-ai="use">✏️ حطّه في خانة الكتابة</button>'
    + '<span class="wa-ai-hint">مابيتبعتش لوحده — انت اللي بتدوس إرسال</span></div>';
  var el = $id('wa-ai-draft');
  if(!el){
    el = document.createElement('div');
    el.className = 'wa-ai'; el.id = 'wa-ai-draft';
    // فوق زراير الردود المحفوظة وخانة الكتابة
    var before = $id('wa-qr-panel') || row;
    if(before && before.parentNode === host) host.insertBefore(el, before); else host.appendChild(el);
  }
  el.setAttribute('data-did', d.id);
  el.classList.toggle('collapsed', aiIsCollapsed());
  if(el.innerHTML !== h) el.innerHTML = h;
}

function aiReview(id, status, finalBody){
  if(!sb || !id) return;
  try{
    sb.rpc('wa_ai_draft_review', { p_id: id, p_status: status, p_final_body: finalBody == null ? null : String(finalBody) })
      .then(function(r){ if(r && r.error) swallow('aiReview/' + status, r.error); }, function(e){ swallow('aiReview', e); });
  }catch(e){ swallow('aiReview/call', e); }
}

function aiUse(){
  var d = aiDraft, inp = $id('wa-input');
  if(!d || !inp) return;
  var body = String(d.body || '').trim();
  if(!body) return;
  var cur = String(inp.value || '').trim();
  // كلام الموظف مايتمسحش — يبعته أو يمسحه الأول
  if(cur && cur !== body){ toast('خانة الكتابة فيها كلام — ابعته أو امسحه الأول', 'er'); return; }
  inp.value = body;
  try{ inp.dispatchEvent(new Event('input', { bubbles: true })); }catch(e){ swallow('aiUse/input', e); }
  inp.focus();
  aiUsed = { id: d.id, body: body };
}

function aiReject(){
  var d = aiDraft;
  if(!d) return;
  aiReview(d.id, 'rejected', null);
  if(aiTrigger) aiDone[aiTrigger] = 1;
  aiGen++; aiClearTimers(); aiDraft = null; aiUsed = null; aiHide();
}

// بعد نجاح إرسال رسالة من خانة الكتابة (waSend): لو الموظف كان حاطط المسودة في الخانة = sent (زي ما هي) أو edited
// (عدّلها). لو رد من دماغه = المسودة بتفضل pending (التقرير بيقارنها بالرد الفعلي من wa_messages) والكارت بيتشال.
export function aiDraftNoteSent(convId, text){
  if(!convId || convId !== aiConv) return;
  var t = String(text || '').trim();
  if(aiDraft && aiUsed && aiUsed.id === aiDraft.id && t) aiReview(aiDraft.id, t === aiUsed.body ? 'sent' : 'edited', t);
  if(aiTrigger) aiDone[aiTrigger] = 1;
  aiGen++; aiClearTimers(); aiDraft = null; aiUsed = null; aiDeferred = false; aiHide();
}

export function initAiDraft(){
  var host = $id('wa-compose');
  if(host) host.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('[data-ai]') : null;
    if(!b || !host.contains(b)) return;
    var act = b.getAttribute('data-ai');
    if(act === 'use') aiUse();
    else if(act === 'reject') aiReject();
    else if(act === 'toggle'){ aiCollapsed = !aiIsCollapsed(); var el = $id('wa-ai-draft'); if(el) el.classList.toggle('collapsed', aiCollapsed); }
  });
  // التاب رجعت قدامك وكان فيه سؤال متأجّل
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && aiDeferred && aiTrigger && !aiDraft) aiFetch();
  });
}

// للهارنس بس (test-wa-ai-draft)
export function aiDraftDebug(){
  return { conv: aiConv, trigger: aiTrigger, draft: aiDraft ? aiDraft.id : null, timers: aiTimers.length, deferred: aiDeferred, used: aiUsed ? aiUsed.id : null };
}
