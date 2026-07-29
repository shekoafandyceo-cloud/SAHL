// رسائل الحالة العابرة

import { $id } from './dom.js';

export function toast(msg,type){var t=$id('toast');t.textContent=msg;t.className='toast show '+(type||'ok');clearTimeout(t._t);t._t=setTimeout(function(){t.className='toast';},3000);}
