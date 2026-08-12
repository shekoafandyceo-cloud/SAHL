// تنسيق العرض: أرقام وتواريخ وفلوس وتليفونات — توقيت القاهرة

export function fmt(v){return v||'—';}

export function short(s,n){s=s||'—';return s.length>n?s.slice(0,n)+'…':s;}

// فواصل الأرقام لازم لاتينية ومن غير علامات اتجاه: بعض بيئات الـICU
// (سفاري وغيرها) بتحقن ALM/RLM جنب فاصلة الألوف في تنسيق ar-EG، فالرقم
// بيتكسر لمقاطع بتتقلب في سياق RTL — «4,208.92» بتتقري «208.92,4»
// (اتشاف حي على جهاز المالك 11 أغسطس — نفس فخ التواريخ المشروح تحت).
// en-US فواصلها ثابتة، وstripBidi ضمان تاني.
export function num(n){return stripBidi(Number(n||0).toLocaleString('en-US'));}

// الـlocale العربي بيحقن علامات اتجاه خفية (U+200F RLM · U+200E LRM · U+061C ALM)
// بين مقاطع التاريخ. جوّه خلية direction:ltr العلامة بتفتح مقطع RTL جوّه سطر
// LTR فالمقاطع بتتقلب واليوم بيطير لآخر السطر.
// أي دالة بترجّع تاريخ معروض **لازم** تعدّي على stripBidi — الحارس في مكان
// واحد بدل ما كل formatter جديد يقع في نفس الفخ. (fmtD/fmtDT كانوا متصلّحين
// وfmtStoredDateTime لأ — فعمود التاريخ في حركات المخزون فضل مقلوب.)
export function stripBidi(s){return String(s==null?'':s).replace(/[\u200e\u200f\u061c]/g,'');}

export function fmtD(v){return v?stripBidi(new Date(v).toLocaleDateString('ar-EG-u-nu-latn',{day:'2-digit',month:'2-digit',year:'2-digit',timeZone:'Africa/Cairo'})):'—';}

export function fmtDT(v){return v?stripBidi(new Date(v).toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})):'—';}

export function pad2(n){return String(n).padStart(2,'0');}

export function fmtStoredDateTime(raw){
  if(!raw)return '—';
  // Supabase stores timestamps in UTC (e.g. "2026-05-30T17:10:30+00").
  // We must convert to Cairo (UTC+2/+3) for display, otherwise everything
  // shows 3 hours earlier than reality. JS Date + toLocaleString with the
  // timeZone option handles this correctly, including DST transitions.
  var d=new Date(raw);
  if(isNaN(d.getTime())){
    // very rare fallback for malformed strings
    return String(raw);
  }
  return stripBidi(d.toLocaleString('ar-EG-u-nu-latn',{
    timeZone:'Africa/Cairo',
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit'
  }));
}

export function fmtDateOnly(raw){
  if(!raw)return '—';
  var s=String(raw).trim();
  // Date-only strings (YYYY-MM-DD, e.g. movement_date) have no timezone —
  // parse them as Cairo-local to avoid the "new Date('2026-05-30')" UTC midnight trap.
  var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m){
    var d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    return stripBidi(d.toLocaleDateString('ar-EG-u-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit'}));
  }
  return s;
}

export function fmtMovementDate(v,createdAt){
  // In movements table we display created_at time; movement_date remains date-only for filtering/grouping.
  if(createdAt)return fmtStoredDateTime(createdAt);
  return fmtDateOnly(v);
}

// نفس بيانات fmtMovementDate بس مقسومة: التاريخ لوحده والوقت لوحده.
// السبب مش تجميل — التاريخ أرقام (LTR) والوقت بينتهي بـ«م»/«ص» (حرف عربي RTL).
// لما يتحطوا في سترينج واحد جوّه خلية LTR، الـ«م» بتفتح مقطع RTL في آخر السطر
// والمقاطع بتتزحلق. فصلهم في عنصرين = كل واحد صندوق اتجاه مستقل، فمفيش تفاعل
// أصلاً — وبيقرا أوضح كمان (التاريخ فوق والساعة تحته باهتة).
export function fmtMovementDateParts(v,createdAt){
  var TZ='Africa/Cairo';
  if(createdAt){
    var d=new Date(createdAt);
    if(!isNaN(d.getTime())){
      return {
        date: stripBidi(d.toLocaleDateString('ar-EG-u-nu-latn',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'})),
        time: stripBidi(d.toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit'}))
      };
    }
  }
  // مفيش created_at (أو مالوش معنى) → movement_date التاريخ-بس، من غير وقت
  return { date: fmtDateOnly(v), time: '' };
}

// Phone normalization: removes leading 0, spaces — returns 10-digit number for WhatsApp (prefixed with 20)
export function normalizePhone(p){
  if(!p)return '';
  var s=toLatinDigits(p).replace(/\D/g,'').replace(/^20/,'').replace(/^0+/,'');
  return s;
}

// First word of customer name (used in WhatsApp message)
export function firstName(n){
  if(!n)return '';
  return String(n).trim().split(/\s+/)[0];
}

// Bucket orders by their Cairo calendar day (YYYY-MM-DD) — SAME timezone the table shows (fmtD),
// so the period filter matches the visible dates exactly (no off-by-a-day from UTC parsing).
export function cairoYMD(v){
  try{ return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)); }
  catch(e){ var d=new Date(v); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
}

export function ymdAddDays(ymd, delta){
  var p=String(ymd).split('-'), dt=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));
  dt.setUTCDate(dt.getUTCDate()+delta);
  return dt.getUTCFullYear()+'-'+('0'+(dt.getUTCMonth()+1)).slice(-2)+'-'+('0'+dt.getUTCDate()).slice(-2);
}

export function money(v){return num(Math.round(Number(v||0)))+' ج';}

export function val(o){return Number(o.total_cost||o.total||o.amount||0)||0;}

export function toLatinDigits(v){
  var map={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
  return String(v||'').replace(/[٠-٩۰-۹]/g,function(d){return map[d]||d;});
}
