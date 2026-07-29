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

export function parseProductItems(raw){
  raw=normalizeProductName(raw);
  var parts=raw.split(/\s*\+\s*|\n|،|,/).map(function(x){return x.trim();}).filter(Boolean);
  if(!parts.length)parts=[raw];
  var merged={};
  parts.forEach(function(part){
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
