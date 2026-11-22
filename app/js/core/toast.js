// رسائل الحالة العابرة

import { $id } from './dom.js';

// ms اختياري (الافتراضي 3 ثواني) — تنبيه طابور التصعيد بيطوّله عشان يتقري (v89)
export function toast(msg,type,ms){var t=$id('toast');t.textContent=msg;t.className='toast show '+(type||'ok');clearTimeout(t._t);t._t=setTimeout(function(){t.className='toast';},(ms>0)?ms:3000);}
