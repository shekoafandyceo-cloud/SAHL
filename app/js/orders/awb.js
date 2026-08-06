// طباعة بوليصة الشحن (AWB)

import { SUPABASE_URL } from '../core/config.js';
import { $id } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { tourActive } from '../tour/tour.js';
import { selectedIds } from './state.js';

// كروت الحالة وشريط الفترة والدرج والتحديد الجماعي
// ============================================================================
// AWB Printing — يطبع بوليصة بوسطة عبر Edge Function `bosta-print-awb`
// ============================================================================
export function _b64ToBlob(base64, mimeType){
  var byteChars = atob(base64);
  var byteArrays = [];
  var sliceSize = 512;
  for(var offset = 0; offset < byteChars.length; offset += sliceSize){
    var slice = byteChars.slice(offset, offset + sliceSize);
    var byteNumbers = new Array(slice.length);
    for(var i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, {type: mimeType});
}

export async function printAwbForOrders(orderIds, btnEl){
  if(!orderIds || orderIds.length === 0){ toast('اختار أوردرات الأول','er'); return; }
  if(tourActive){ toast('الطباعة مش متاحة في جولة التعريف','er'); return; }
  
  var origText = '';
  if(btnEl){ origText = btnEl.textContent; btnEl.disabled = true; btnEl.textContent = '⏳ جاري الطباعة...'; }
  
  try {
    var sessionResp = await sb.auth.getSession();
    var session = sessionResp && sessionResp.data && sessionResp.data.session;
    if(!session){ toast('لازم تسجل دخول الأول','er'); return; }
    
    var resp = await fetch(SUPABASE_URL + '/functions/v1/bosta-print-awb', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({order_ids: orderIds})
    });
    
    var data = await resp.json();
    
    if(!resp.ok){
      var msg = data.message || data.error || 'فشل طباعة البوليصة';
      if(data.bosta_status === 400 && /final state/i.test(msg)){
        msg = 'مينفعش تطبع بوالص أوردرات مسلّمة أو ملغية';
      }
      toast(msg, 'er');
      return;
    }
    
    if(!data.pdf_base64){ toast('شركة الشحن ما رجعتش PDF','er'); return; }
    
    var pdfBlob = _b64ToBlob(data.pdf_base64, 'application/pdf');
    var pdfUrl = URL.createObjectURL(pdfBlob);
    
    var win = window.open(pdfUrl, '_blank');
    if(!win){
      toast('السماح بفتح نوافذ جديدة في المتصفح الأول','er');
      // fallback: download — الـreturn هنا كان بيفوّت جدولة الـrevoke
      // تحت فالـPDF كله كان بيفضل معلّق في الذاكرة
      var a = document.createElement('a');
      a.href = pdfUrl;
      a.download = 'awb-'+Date.now()+'.pdf';
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(pdfUrl); }, 60000);
      return;
    }
    
    // Auto-trigger print() لما الـ PDF يتحمل — مرة واحدة بس: الـload handler
    // والـbackup timer كانوا بيطلقوا الاتنين من غير علم ببعض = دبل print dialog
    var printFired = false;
    function firePrint(){
      if(printFired) return; printFired = true;
      try{ win.focus(); win.print(); }catch(e){ swallow('printAwbForOrders/win.print', e); }
    }
    win.addEventListener('load', function(){ setTimeout(firePrint, 600); });
    // backup trigger في حالة الـ load event ما اطلقش (عارض الـPDF في كروم غالباً مابيطلقهوش)
    setTimeout(firePrint, 1500);
    
    if(data.skipped_no_tracking && data.skipped_no_tracking > 0){
      toast('✅ اتطبع '+data.printed_count+' بوليصة ('+data.skipped_no_tracking+' أوردر مفيش فيهم tracking)','ok');
    } else {
      toast('✅ اتطبع '+data.printed_count+' بوليصة','ok');
    }
    
    // امسح الـ blob URL بعد دقيقة (revoke)
    setTimeout(function(){ URL.revokeObjectURL(pdfUrl); }, 60000);
    
    // مفيش تحديث للأوردرات بعد الطباعة: الحارس القديم كان بينادي loadOrders وهي
    // مش موجودة في المشروع خالص — كان كود ميت من قبل الريفاكتور.
    
  } catch(err){
    console.error('AWB print error:', err);
    toast('فشل الاتصال بالخادم: '+(err.message||err),'er');
  } finally {
    if(btnEl){ btnEl.disabled = false; btnEl.textContent = origText || '🖨️ طبع البوالص'; }
  }
}

export function printSelectedAwb(){
  var ids = Array.from(selectedIds || []);
  if(ids.length === 0){ toast('اختار أوردرات الأول','er'); return; }
  // مفيش filter محلي — الـ Edge Function بتعمل الفلترة من DB مباشرة
  // (الفرونت بيستخدم lazy loading، فالأوردرات مش كلها في الذاكرة دايماً)
  printAwbForOrders(ids, $id('bb-print'));
}
