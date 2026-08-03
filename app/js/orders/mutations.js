// تعديلات الأوردر — الحالة والملاحظات ومحاولات الاتصال

import { currentTenantId, currentUser } from '../auth/auth.js';
import { SL } from '../core/constants.js';
import { $id } from '../core/dom.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { loadBostaInventoryCard, loadOrdersCards } from './cards.js';
import { renderDetail } from './detail.js';
import { ensureTenant } from './guards.js';
import { doFilter } from './orders.js';
import { all, allLoaded, ordersSetSelected, sel, selectedIds } from './state.js';
import { updateBulkBar } from './table.js';

export function saveInternalNotes(){
  if(!ensureTenant())return;
  if(!sel)return;
  var notes=$id('int-notes').value;
  // التقاط الأوردر وقت البدء — sel الحي ممكن يتغير قبل رد السيرفر
  // (المستخدم فتح أوردر تاني) فكانت ملاحظات A بتتكتب محلياً على B
  var ord=sel;
  sb.from('orders').update({internal_notes:notes}).eq('id',ord.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){$id('save-status').textContent='خطأ: '+r.error.message;$id('save-status').className='save-status';return;}
    ord.internal_notes=notes;
    for(var i=0;i<all.length;i++){if(all[i].id===ord.id){all[i].internal_notes=notes;break;}}
    $id('save-status').textContent='✓ تم الحفظ';
    $id('save-status').className='save-status ok';
    setTimeout(function(){if($id('save-status'))$id('save-status').textContent='';},2200);
  });
}

export function addCallAttempt(){
  if(!ensureTenant())return;
  if(!sel)return;
  var ord=sel;   // التقاط الأوردر — sel الحي ممكن يتبدل قبل رد السيرفر
  var result=$id('ca-res').value;
  var note=$id('ca-note').value.trim();
  // Use exact current time — no datetime input, no timezone conversion needed
  var now = new Date();
  var isoNow = now.toISOString();
  var formatted = now.toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
  // إلحاق ذري على السيرفر (append_call_attempt) — الكتابة القديمة كانت
  // بتبعت المصفوفة كاملة، وكتابتين متزامنتين (موظفين أو موظف + n8n)
  // آخرهم كان بيمسح محاولة الأول
  var attempt={time:formatted, iso:isoNow, result:result, note:note, by: currentUser ? currentUser.name : '—'};
  sb.rpc('append_call_attempt',{p_order_id:ord.id, p_attempt:attempt}).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    if(!r.data){toast('الأوردر مش موجود','er');return;}
    ord.call_attempts=r.data;   // السجل الكامل زي ما السيرفر شايفه
    for(var i=0;i<all.length;i++){if(all[i].id===ord.id){all[i].call_attempts=r.data;break;}}
    toast('تم تسجيل المحاولة ✓','ok');
    if(sel===ord) renderDetail();
  });
}

export function deleteCallAttempt(idx){
  if(!ensureTenant())return;
  if(!sel)return;
  var ord=sel;
  var calls=Array.isArray(ord.call_attempts)?ord.call_attempts:[];
  var target=calls[idx];
  if(target && target.iso){
    // الحذف بهوية المحاولة (iso) ذرياً — الفهرس بيتزحزح مع الكتابة المتزامنة
    sb.rpc('delete_call_attempt',{p_order_id:ord.id, p_iso:target.iso}).then(function(r){
      if(r.error){toast('خطأ: '+r.error.message,'er');return;}
      if(!r.data){toast('الأوردر مش موجود','er');return;}
      ord.call_attempts=r.data;
      for(var i=0;i<all.length;i++){if(all[i].id===ord.id){all[i].call_attempts=r.data;break;}}
      toast('تم الحذف','ok');
      if(sel===ord) renderDetail();
    });
    return;
  }
  // محاولة قديمة من غير iso (نادرة) — المسار القديم بالمصفوفة الكاملة
  var next=calls.slice(); next.splice(idx,1);
  sb.from('orders').update({call_attempts:next}).eq('id',ord.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    ord.call_attempts=next;
    for(var i=0;i<all.length;i++){if(all[i].id===ord.id){all[i].call_attempts=next;break;}}
    toast('تم الحذف','ok');
    if(sel===ord) renderDetail();
  });
}

export function doUpdate(ns,cancelReason){
  if(!ensureTenant())return;
  if(!sel)return;
  var ord=sel;   // التقاط — رد تحديث A ماينفعش يقفل مودال B اللي اتفتح بعده
  var id=ord.id;
  var nowISO=new Date().toISOString();
  // set_order_status: تغيير الحالة + إلحاق السجل ذرياً على السيرفر —
  // from بتتحسب من صف السيرفر (مش من نسخة المتصفح اللي ممكن تكون قديمة)،
  // والإلحاق مابيمسحش سجل حد كتب في نفس اللحظة
  sb.rpc('set_order_status',{p_order_id:id, p_status:ns,
      p_by: currentUser ? currentUser.name : 'manual',
      p_cancel_reason: (ns==='cancelled'&&cancelReason)?cancelReason:null}).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    if(!r.data){toast('الأوردر مش موجود','er');return;}
    for(var i=0;i<all.length;i++){if(all[i].id===id){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=r.data;if(ns==='cancelled'&&cancelReason)all[i].cancel_reason=cancelReason;break;}}
    if(sel===ord){ $id('ovl').classList.remove('open'); ordersSetSelected(null); }
    toast('تم تحديث الحالة ✓','ok');
    loadOrdersCards();loadBostaInventoryCard();doFilter();
  });
}

export function doBulkUpdate(ns){
  if(!ensureTenant())return;
  if(!ns||selectedIds.size===0)return;
  var ids=Array.from(selectedIds);
  var count=ids.length;
  showModal({
    icon: ns==='cancelled'?'❌': ns==='confirmed'?'✅':'🔄',
    title:'تغيير جماعي',
    sub:'سيتم تغيير حالة '+count+' طلب إلى "'+SL[ns]+'"\nمتأكد من التغيير؟',
    okLabel:'تأكيد التغيير',
    okColor: ns==='cancelled'?'linear-gradient(135deg,#ef4444,#dc2626)':'linear-gradient(135deg,var(--acc),var(--acc2))',
    onOk:function(){
  var nowISO=new Date().toISOString();
  var bulkReason = ns==='cancelled' ? 'إلغاء من المدير' : null;
  var byLabel = (currentUser ? currentUser.name : 'bulk') + ' (جماعي)';

  // set_order_status لكل أوردر — مفيش pre-fetch للسجلات خالص: السيرفر
  // بيقرا from من صفه وبيلحق ذرياً، فمفيش نافذة يتمسح فيها سجل حد تاني
  var done=0, errors=0, n=ids.length;
  ids.forEach(function(oid){
    sb.rpc('set_order_status',{p_order_id:oid, p_status:ns, p_by:byLabel, p_cancel_reason:bulkReason}).then(function(r){
      done++;
      if(r.error || !r.data){errors++;}
      else if(allLoaded){ for(var i=0;i<all.length;i++){if(all[i].id===oid){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=r.data;if(bulkReason)all[i].cancel_reason=bulkReason;break;}} }
      if(done===n){
        selectedIds.clear();updateBulkBar();
        if(errors)toast('تم تحديث '+(n-errors)+' من '+count+' (فيه '+errors+' خطأ)','er');
        else toast('تم تحديث '+count+' طلب ✓','ok');
        loadOrdersCards();loadBostaInventoryCard();doFilter();
      }
    });
  });
    } // end onOk
  }); // end showModal
}
