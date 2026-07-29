// سؤال سبب الإلغاء قبل تسجيله

import { showModal } from '../core/modal.js';

export function askCancelReason(callback){
  showModal({
    icon:'❌',
    title:'سبب الإلغاء',
    sub:'اكتب سبب إلغاء الطلب عشان يتسجل في اللوج',
    okLabel:'إلغاء الطلب',
    okColor:'linear-gradient(135deg,#ef4444,#dc2626)',
    input:true,
    placeholder:'مثال: العميل رفض الاستلام...',
    onOk:function(val){ callback(val); }
  });
}
