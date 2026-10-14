// كود البوليصة من اللي السكانر كتبه — من غير DOM (الهارنس بيختبره من node)
//
// السكانر USB «keyboard-wedge» بيبعت ضغطات زراير مش حروف: الويندوز بيحوّلها حروف حسب لغة
// الكيبورد اللي شغّالة. على العربي «JEG» بتطلع «تثل» (أو «ـُلأ» بالشيفت)، والـCapsLock بيطلّعها
// صغيرة. عشان كده عندنا طريقين:
//   1. `codeChar(e.code)` — الزرار الفعلي (KeyJ · Digit0 · Numpad0) مش الحرف، فمش فارق معاه
//      لغة الكيبورد ولا الـCapsLock. ده الطريق الأساسي في صفحة السكانر.
//   2. `scanToLatin(نص)` — احتياطي للكتابة بالإيد واللصق: بيرجّع حروف الكيبورد العربي لمكانها
//      اللاتيني (الأطول الأول: «لأ» قبل «ل»).
// 🔴 مفيش حالة بنحط فيها JEG قبل أرقام من عندنا — 12 رقم لوحدهم ممكن يبقوا باركود منتج (UPC-A).

import { toLatinDigits } from '../core/format.js';

// Arabic (101) — بالشيفت (الأطول الأول)
var SHIFT_MULTI = [['لإ', 'T'], ['لأ', 'G'], ['لآ', 'B'], ['لا', 'B']];
var SHIFT_ONE = {
  'َ': 'Q', 'ً': 'W', 'ُ': 'E', 'ٌ': 'R', 'إ': 'Y', '‘': 'U', '`': 'U',
  '÷': 'I', '×': 'O', '؛': 'P', 'ِ': 'A', 'ٍ': 'S', 'أ': 'H', 'ـ': 'J',
  '،': 'K', 'ْ': 'X', 'آ': 'N', '’': 'M'
};
// Arabic (101) — من غير شيفت
var PLAIN_ONE = {
  'ض': 'Q', 'ص': 'W', 'ث': 'E', 'ق': 'R', 'ف': 'T', 'غ': 'Y', 'ع': 'U', 'ه': 'I', 'خ': 'O', 'ح': 'P',
  'ش': 'A', 'س': 'S', 'ي': 'D', 'ب': 'F', 'ل': 'G', 'ا': 'H', 'ت': 'J', 'ن': 'K', 'م': 'L',
  'ئ': 'Z', 'ء': 'X', 'ؤ': 'C', 'ر': 'V', 'ى': 'N', 'ة': 'M'
};

var STRIP = /[​-‏‪-‮⁦-⁩؜﻿\s]/g;

export function scanToLatin(raw){
  var s = String(raw == null ? '' : raw);
  try{ s = s.normalize('NFKC'); }catch(e){ /* متصفح قديم */ }
  s = toLatinDigits(s.replace(STRIP, ''));
  for(var i = 0; i < SHIFT_MULTI.length; i++) s = s.split(SHIFT_MULTI[i][0]).join(SHIFT_MULTI[i][1]);
  var out = '';
  for(var j = 0; j < s.length; j++){
    var ch = s.charAt(j);
    out += SHIFT_ONE[ch] || PLAIN_ONE[ch] || ch;
  }
  return out.toUpperCase();
}

// الكود من أي نص: JEG/UEG + 12 رقم في أي مكان (بادئة AIM أو QR فيه لينك = بيعدّي)
var WAYBILL_RE = /([JU]EG\d{12})(?!\d)/;

export function parseWaybill(raw){
  var s = scanToLatin(raw);
  var m = s.match(WAYBILL_RE);
  if(m) return { kind: m[1].charAt(0) === 'U' ? 'jt_sandbox' : 'jt', code: m[1] };
  var digits = s.replace(/[^0-9A-Z]/g, '');
  if(/^\d{8,10}$/.test(digits)) return { kind: 'legacy', code: digits };
  if(/^\d{12,14}$/.test(digits)) return { kind: 'product_barcode', code: digits };
  return { kind: 'unknown', code: '' };
}

// الزرار الفعلي → حرف (أو '' لأي زرار تاني). مش فارق معاه لغة الكيبورد ولا CapsLock.
export function codeChar(code){
  var c = String(code || '');
  var m = c.match(/^Key([A-Z])$/);
  if(m) return m[1];
  m = c.match(/^(?:Digit|Numpad)(\d)$/);
  if(m) return m[1];
  if(c === 'Minus' || c === 'NumpadSubtract') return '-';
  return '';
}

export function isEndKey(e){
  if(!e) return false;
  if(e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter' || e.code === 'Tab') return true;
  // سكانرات «Ctrl+ASCII» بتبعت CR/LF كـCtrl+M/Ctrl+J (Ctrl+J بيفتح التحميلات في كروم)
  if(e.ctrlKey && (e.code === 'KeyM' || e.code === 'KeyJ')) return true;
  return false;
}

// بافر الضغطات: بيتبني من e.code، ولو حصل تعديل بالإيد (Backspace/أسهم) بيتعلّم «مش موثوق»
// فالقرار يرجع لنص الخانة. ومعاه أوقات الضغطات (للتمييز بين السكانر والإيد في المحادثات).
export function createKeyBuffer(){
  var buf = '', dirty = false, times = [];
  return {
    push: function(e){
      if(!e) return;
      var t = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now();
      var ch = codeChar(e.code);
      if(e.altKey){ dirty = true; return; }   // ALT+Numpad = وضع «universal keyboard»
      if(ch){ buf += ch; times.push(t); return; }
      if(/^(Shift|Caps|Control|Alt|Meta)/.test(String(e.key || '')) || /^(Shift|Caps|Control|Alt|Meta)/.test(String(e.code || ''))) return;
      dirty = true;
    },
    value: function(){ return dirty ? '' : buf; },
    // متوسط وأقصى الفجوة بين الضغطات (ms) — السكانر ≤ ~35 متوسط
    timing: function(){
      if(times.length < 2) return { n: times.length, avg: Infinity, max: Infinity };
      var sum = 0, mx = 0;
      for(var i = 1; i < times.length; i++){ var d = times[i] - times[i - 1]; sum += d; if(d > mx) mx = d; }
      return { n: times.length, avg: sum / (times.length - 1), max: mx };
    },
    reset: function(){ buf = ''; dirty = false; times = []; }
  };
}

// «ده سكانر؟» — ≥ 10 ضغطات بمتوسط ≤ 35ms وأقصى ≤ 120ms
export function looksScanned(t){
  return !!t && t.n >= 10 && t.avg <= 35 && t.max <= 120;
}
