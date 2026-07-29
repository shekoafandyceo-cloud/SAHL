// وصول الـDOM والهروب من HTML — أعلى استخدام في الملف كله (182 مستدعي لـ$id)

export function $id(id){return document.getElementById(id);}

export function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
