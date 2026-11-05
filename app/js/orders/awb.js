// طباعة بوليصة الشحن (AWB)

import { $id } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { tourActive } from '../tour/tour.js';
import { selectedIds } from './state.js';
import { printJtAwb } from './jt-awb.js';
import { currentTenantId } from '../auth/auth.js';

// ============================================================================
// طباعة البوالص — J&T بس، من القالب المعتمد في اللوحة (jt-awb.js)
// ⚠️ طباعة بوالص بوسطة القديمة (Edge Function `bosta-print-awb`) اتشالت في v80 بقرار المالك
// (آخر استخدام 24 أغسطس) — أي أوردر مش J&T بيتقال صراحةً إنه مابيتطبعش من هنا.
// ============================================================================
export async function printAwbForOrders(orderIds, btnEl){
  if(!orderIds || orderIds.length === 0){ toast('اختار أوردرات الأول','er'); return; }
  if(tourActive){ toast('الطباعة مش متاحة في جولة التعريف','er'); return; }
  var origText = '';
  if(btnEl){ origText = btnEl.textContent; btnEl.disabled = true; }
  try{
    var cr = await sb.from('orders').select('id,shipping_carrier,tracking_no').eq('tenant_id', currentTenantId).in('id', orderIds);
    if(cr.error){ toast('مقدرناش نجيب الأوردرات — حاول تاني','er'); return; }
    var rows = cr.data || [];
    var jtIds = rows.filter(function(o){ return o.shipping_carrier === 'jt' && (o.tracking_no || '').trim(); }).map(function(o){ return o.id; });
    var other = orderIds.length - jtIds.length;
    if(jtIds.length) await printJtAwb(jtIds);
    if(other > 0){
      toast((jtIds.length ? other + ' أوردر' : 'الأوردر ده') + ' مالوش بوليصة J&T — بوالص شركة الشحن القديمة أو الشحن اليدوي بتتطبع من موقع الشركة نفسها', 'er');
    }
  }catch(e){
    swallow('printAwbForOrders', e);
    toast('حصلت مشكلة في الطباعة — حاول تاني','er');
  }finally{
    if(btnEl){ btnEl.disabled = false; if(origText) btnEl.textContent = origText; }
  }
}

export function printSelectedAwb(){
  var ids = Array.from(selectedIds || []);
  if(ids.length === 0){ toast('اختار أوردرات الأول','er'); return; }
  // مفيش filter محلي — printAwbForOrders بتقرا الشركة من الـDB مباشرة
  // (الفرونت بيستخدم lazy loading، فالأوردرات مش كلها في الذاكرة دايماً)
  printAwbForOrders(ids, $id('bb-print'));
}
