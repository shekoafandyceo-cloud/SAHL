// حالة "التحميل فشل" — بديل الصفحة الفاضية الصامتة.
//
// كان: `if(err){ veilDone(page); return; }` — الحجاب بيتشال والصفحة تفضل
// على آخر حاجة كانت فيها (غالباً "جاري التحميل..." أو فاضية خالص)، فالتاجر
// يفضل مستني حاجة عمرها ما هتيجي ومفيش أي أثر يقوله إن في مشكلة.
//
// بنكتب الرسالة في كل حاويات الصفحة المعروفة — أي واحدة موجودة تتكتب،
// عشان اللي واقف على أي تبويب يشوفها من غير ما يدوّر.

import { emptyState } from './empty.js';
import { $id } from './dom.js';

var HOSTS = {
  finance:   ['fin-cost-section', 'exp-tbody'],
  analytics: ['perf-tbody', 'finplat-tbody', 'dcal'],
  stock:     ['prod-tbody', 'mov-tbody']
};

export function renderLoadError(page){
  var ids = HOSTS[page] || [];
  var html = emptyState({
    icon: '📡',
    title: 'مقدرناش نحمّل البيانات',
    sub: 'يمكن النت فصل أو السيرفر اتأخر. البيانات كلها في أمان — جرّب تاني.',
    act: 'retry-load', actLabel: '↻ حاول تاني'
  });
  for(var i=0;i<ids.length;i++){
    var el = $id(ids[i]);
    if(el) el.innerHTML = html;
  }
}
