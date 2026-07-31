// حجاب التحميل عند أول دخول تاب — بدل ما التاجر يشوف أصفار كدابة
// لحد ما البيانات توصل من الداتابيز.
//
// العقد:
// - showPage بتنادي veilBegin(pageId) قبل ما تنادي الـloader.
// - كل loader بينادي veilDone(pageId) عند أول نقطة بتبقى فيها الأرقام
//   الأساسية حقيقية — وفي كل مسارات الخروج البدرية والأخطاء كمان.
// - الحجاب بيظهر **مرة واحدة لكل تاب في الجلسة**: بعد أول تحميل ناجح
//   البيانات بتفضل في الذاكرة، وإعادة الـblur على أرقام حقيقية وقت
//   الريفرش الخلفي هتخلّي التطبيق يحس أبطأ مش أوضح.
// - صمّام أمان 6 ثواني: loader بيقع في صمت (درس 5) مايسيبش الصفحة
//   مغبّشة للأبد — الحجاب كوزمتيك مش بوابة.
// - أثناء الجولة مفيش حجاب خالص: بياناتها ديمو فورية، والـblur هيتعارك
//   مع الـspotlight بتاعها.

import { $id } from './dom.js';
import { tourActive } from '../tour/tour.js';

var seen = {};    // التابات اللي خلّصت أول تحميل
var timers = {};

export function veilBegin(pageId){
  if(seen[pageId] || tourActive) return;
  var host = $id('page-' + pageId);
  if(!host) return;
  var v = host.querySelector(':scope > .pg-veil');
  if(!v){
    v = document.createElement('div');
    v.className = 'pg-veil';
    v.setAttribute('role', 'status');
    v.innerHTML = '<div class="pg-veil-box"><div class="pg-veil-spin"></div><div class="pg-veil-txt">بنحمّل بياناتك...</div></div>';
    host.appendChild(v);
  }
  host.classList.add('pg-busy');
  host.setAttribute('aria-busy', 'true');
  clearTimeout(timers[pageId]);
  timers[pageId] = setTimeout(function(){ veilDone(pageId); }, 6000);
}

export function veilDone(pageId){
  seen[pageId] = true;
  clearTimeout(timers[pageId]);
  var host = $id('page-' + pageId);
  if(!host) return;
  host.classList.remove('pg-busy');
  host.removeAttribute('aria-busy');
}
