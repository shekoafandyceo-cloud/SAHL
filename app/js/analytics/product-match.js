// مطابقة أسماء المنتجات — نواة حساب التكلفة

import { toLatinDigits } from '../core/format.js';

export function normalizeProductName(n){return String(n||'غير محدد').trim()||'غير محدد';}

export function cleanProductName(part){
  return normalizeProductName(toLatinDigits(part)
    .replace(/\([^)]*(?:عدد|العدد|qty|quantity|x|×)[^)]*\)/ig,' ')
    .replace(/\[[^\]]*(?:عدد|العدد|qty|quantity|x|×)[^\]]*\]/ig,' ')
    .replace(/(?:عدد|العدد|qty|quantity)\s*[:：-]?\s*\d+/ig,' ')
    .replace(/(?:x|×)\s*\d+/ig,' ')
    .replace(/\d+\s*(?:قطعة|قطع|pcs?)/ig,' ')
    .replace(/[()\[\]{}]/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim());
}

export function extractProductQty(part){
  var t=toLatinDigits(part);
  var m=t.match(/(?:عدد|العدد|qty|quantity)\s*[:：-]?\s*(\d+)/i) || t.match(/(?:x|×)\s*(\d+)/i) || t.match(/\b(\d+)\s*(?:قطعة|قطع|pcs?)\b/i);
  var q=m?parseInt(m[1],10):1;
  return q>0?q:1;
}

// ── فصل المنتجات المتلزقة بـ " - " ────────────────────────────────
// الأوردرات الجاية من الـwebhook بتوصل كسترينج واحد والمنتجات متلزقة
// بـ" - ". الفاصل ده **غامض** — نفس العلامة مستخدمة في تلات معاني:
//   1. فاصل منتجات:    ...(عدد 1) - منظم درج معالق المطبخ (عدد 2)
//   2. جوّه اسم المنتج: استاند امريكانا 4 دور - جزامة و شماعة (عدد 1)
//   3. لاحقة variant:  ترولي 2 دور (عدد 1) - أسود
// القسمة على " - " على طول بتخلق منتجات وهمية اسمها "أسود" و"مقاس 85"،
// وبتفصل "استاند امريكانا 4 دور" عن "جزامة و شماعة" لمنتجين. النتيجة
// بتبقى غلط **في صمت** — من غير أي خطأ في أي مكان.
//
// الإشارة الوحيدة اللي بتفرّق: الفاصل الحقيقي دايماً بيجي بعد قوس
// **كمية** "(عدد N)" مقفول — مش أي قوس. القسمة بعد أي ")" كانت بتفكك
// الاسم اللي فيه قوس قبل شرطة الـvariant (زي "ترولي (3 دور) - أسود")
// وبتكتب التفكيك في الداتابيز مع أول حفظ. الحالة 2 بتنجو لأن الشرطة
// بتاعتها مش مسبوقة بقوس كمية. الحالة 3 بتعدّي القسمة، فبنمسكها بعدها:
// أي جزء مالوش علامة كمية خاصة بيه — أو علامته من غير أي اسم جنبها —
// بيترجع يتلزق باللي قبله.
//
// اتعاير على 287 أوردر (90 يوم): 191 مااتقسموش، 65 اتقسموا نضيف،
// 31 لاحقة variant اترجعت مكانها.
var SEG_QTY=/(?:عدد|qty|quantity)\s*[:：-]?\s*[0-9٠-٩]+/i;
var QTY_PAREN=/(\((?:عدد|العدد|qty|quantity)[^)]*\))\s*[-–—]\s+/ig;

export function splitProductSegments(part){
  var raw=String(part||'');
  var segs=raw.replace(QTY_PAREN,'$1\u0000').split('\u0000');
  if(segs.length<2)return [raw];
  var out=[];
  segs.forEach(function(s){
    s=s.trim();
    if(!s)return;
    // اسم متبقي بعد شيل علامات الكمية — segment كله "(عدد 2)" مش منتج
    var residue=s.replace(/\((?:عدد|العدد|qty|quantity)[^)]*\)/ig,'').replace(/[()\s]/g,'');
    if(out.length&&(!SEG_QTY.test(s)||!residue)){
      // لاحقة variant. بنلزقها باللي قبله، بس بننقل "(عدد N)" لآخر السطر —
      // renderProductsEditor بيشيل الكمية بـregex مربوط بآخر السطر ($)، فلو
      // سابناها في النص الاسم هيفضل جوّه "(عدد 1) - أسود" والحفظ هيكتب
      // "(عدد 1) - أسود (عدد 1)" وتقرا بعدين كمنتجين. تلف بيانات صامت.
      var prev=out[out.length-1];
      var m=prev.match(/\s*\((?:عدد|qty|quantity)[^)]*\)\s*$/i);
      out[out.length-1]=m?(prev.slice(0,m.index).trim()+' - '+s+' '+m[0].trim())
                        :(prev+' - '+s);
    }
    else out.push(s);
  });
  return out.length?out:[raw];
}

export function parseProductItems(raw){
  raw=normalizeProductName(raw);
  var parts=raw.split(/\s*\+\s*|\n|،|,/).map(function(x){return x.trim();}).filter(Boolean);
  if(!parts.length)parts=[raw];
  var expanded=[];
  parts.forEach(function(p){splitProductSegments(p).forEach(function(s){expanded.push(s);});});
  if(!expanded.length)expanded=[raw];
  var merged={};
  expanded.forEach(function(part){
    var qty=extractProductQty(part);
    var name=cleanProductName(part);
    if(!name||name==='غير محدد')return;
    var key=name.toLowerCase();
    if(!merged[key])merged[key]={name:name,qty:0};
    merged[key].qty+=qty;
  });
  var out=Object.keys(merged).map(function(k){return merged[k];});
  return out.length?out:[{name:raw,qty:1}];
}

// Strip ALL whitespace + lowercase — for substring containment checks
export function nameKey(s){ return String(s||'').replace(/\s+/g,'').toLowerCase(); }

// Strip Arabic 'ال' definite article prefix from each word — helps match
// "منظم المطبخ" with "منظم مطبخ" (same product, different grammar)
export function stripAlPrefix(token){ return token.replace(/^ال/,''); }

// Sort tokens alphabetically (after stripping 'ال') — handles "different word order"
export function tokenSortKey(s){
  return String(s||'').toLowerCase().split(/\s+/).filter(Boolean).map(stripAlPrefix).sort().join(' ');
}
