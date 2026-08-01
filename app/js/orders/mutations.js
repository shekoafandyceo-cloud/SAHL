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
import { parseStatusLog, updateBulkBar } from './table.js';

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
  var result=$id('ca-res').value;
  var note=$id('ca-note').value.trim();
  // Use exact current time — no datetime input, no timezone conversion needed
  var now = new Date();
  var isoNow = now.toISOString();
  var formatted = now.toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
  var calls=Array.isArray(sel.call_attempts)?sel.call_attempts.slice():[];
  calls.push({time:formatted, iso:isoNow, result:result, note:note, by: currentUser ? currentUser.name : '—'});
  sb.from('orders').update({call_attempts:calls}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    sel.call_attempts=calls;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].call_attempts=calls;break;}}
    toast('تم تسجيل المحاولة ✓','ok');
    renderDetail();
  });
}

export function deleteCallAttempt(idx){
  if(!ensureTenant())return;
  if(!sel)return;
  var calls=Array.isArray(sel.call_attempts)?sel.call_attempts.slice():[];
  calls.splice(idx,1);
  sb.from('orders').update({call_attempts:calls}).eq('id',sel.id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    sel.call_attempts=calls;
    for(var i=0;i<all.length;i++){if(all[i].id===sel.id){all[i].call_attempts=calls;break;}}
    toast('تم الحذف','ok');
    renderDetail();
  });
}

export function doUpdate(ns,cancelReason){
  if(!ensureTenant())return;
  if(!sel)return;
  var id=sel.id;
  var nowISO=new Date().toISOString();
  var oldStatus=sel.status||'pending';
  var log=parseStatusLog(sel.status_log).slice();
  log.push({from:oldStatus,to:ns,at:nowISO,by: currentUser ? currentUser.name : 'manual',reason:cancelReason||null});
  var update={status:ns,status_changed_at:nowISO,status_log:log};
  if(ns==='cancelled'&&cancelReason){update.cancel_reason=cancelReason;}
  sb.from('orders').update(update).eq('id',id).eq('tenant_id',currentTenantId).then(function(r){
    if(r.error){toast('خطأ: '+r.error.message,'er');return;}
    for(var i=0;i<all.length;i++){if(all[i].id===id){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=log;if(ns==='cancelled'&&cancelReason)all[i].cancel_reason=cancelReason;break;}}
    $id('ovl').classList.remove('open');ordersSetSelected(null);
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

  // نجيب حالة + سجل كل أوردر مختار من السيرفر (all مش متحمّل في صفحة الأوردرات)
  sb.from('orders').select('id,status,status_log').eq('tenant_id',currentTenantId).in('id',ids).then(function(res){
    if(res.error){ toast('خطأ: '+res.error.message,'er'); return; }
    var rows=res.data||[];
    if(!rows.length){ toast('حصلت مشكلة في تحميل الأوردرات','er'); return; }
    var done=0, errors=0, n=rows.length;
    rows.forEach(function(ord){
      var oldStatus=ord.status||'pending';
      var log=parseStatusLog(ord.status_log).slice();
      log.push({from:oldStatus,to:ns,at:nowISO,by: (currentUser ? currentUser.name : 'bulk') + ' (جماعي)',reason:bulkReason});
      var update={status:ns,status_changed_at:nowISO,status_log:log};
      if(bulkReason)update.cancel_reason=bulkReason;
      sb.from('orders').update(update).eq('id',ord.id).eq('tenant_id',currentTenantId).then(function(r){
        done++;
        if(r.error){errors++;}
        else if(allLoaded){ for(var i=0;i<all.length;i++){if(all[i].id===ord.id){all[i].status=ns;all[i].status_changed_at=nowISO;all[i].status_log=log;if(bulkReason)all[i].cancel_reason=bulkReason;break;}} }
        if(done===n){
          selectedIds.clear();updateBulkBar();
          if(errors)toast('تم تحديث '+(n-errors)+' من '+count+' (فيه '+errors+' خطأ)','er');
          else toast('تم تحديث '+count+' طلب ✓','ok');
          loadOrdersCards();loadBostaInventoryCard();doFilter();
        }
      });
    });
  });
    } // end onOk
  }); // end showModal
}
