// أصوات سكانر المخزن — تحميل مقاطع الأدمن + قناة الصوت + كارت «🔊 أصوات السكانر» (15 أكتوبر مساءً — v78)
//
// المقاطع: wh_config.sounds = {out|in|dup|unknown: {path, name, dur}} — ملفات WAV في wa-media تحت <tenant>/wh-sounds/
// (الأدمن بيرفع أي صيغة المتصفح بيقراها → بيختار الجزء → المتصفح بيقصّه ويطبّع صوته ويحوّله WAV قبل الرفع، فكل
// الأجهزة بتقرا نفس الصيغة). كل جهاز بيجيب الإعداد مع دخول الصفحة وكل 5 دقايق، ويفك المقطع **مرة** في الذاكرة
// (decodeAudioData — مفيش <audio> ولا رابط بيخلص بعد ساعة). المقطع وقع أو مااتفكّش = النغمة العادية.
//
// 🔴 القناة: صوت واحد في المرة. الحرج (وقّف · قرار · السرينة) بيستنى دوره ومايتقطعش — العادي (مظبوط · وصل · هبعتهولك)
//    بيقطع العادي اللي شغّال (الموظف بيضرب كل ثانية ونص — آخر نتيجة هي المهمة) وبيستنى ورا الحرج (آخر واحد بس).
// 🔴 الكتم على الجهاز (🔔 · sahl_wh_sound) بيكتم المقاطع كمان — و«▶️ اسمع» في الكارت بيشتغل حتى لو مكتوم (تجربة).

import { $id, esc } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { showModal } from '../core/modal.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { playScanBuffer, playScanSiren, playScanTone, scanAudioCtx, scanSoundOn, scanToneSec, SIREN_SEC, unlockAudio } from '../core/alert-sound.js';
import { currentRole, currentTenantId } from '../auth/auth.js';
import { WH_SOUND_MAX_SEC, WH_SOUND_META, WH_SOUND_PLAY_MAX, WH_SOUND_RATE, WH_SOUND_SLOTS, whEncodeWav, whPeaks,
         whSoundCritical, whTrimCheck, whTrimMono } from './scan-sound.js';

var cfg = {};                 // wh_config.sounds
var bufs = {};                // path → AudioBuffer | 'loading' | 'fail'
var cfgAt = 0, cfgLoading = null, cfgFor = '';
var CFG_MS = 5 * 60000;

function uuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){ /* قديم */ }
  var b = new Uint8Array(16);
  try{ crypto.getRandomValues(b); }catch(e){ for(var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  var h = Array.prototype.map.call(b, function(x){ return (x + 256).toString(16).slice(1); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

function decode(c, ab){
  return new Promise(function(res, rej){
    try{
      var p = c.decodeAudioData(ab, res, rej);
      if(p && typeof p.then === 'function') p.then(res, rej);
    }catch(e){ rej(e); }
  });
}

export function whSoundsCfg(){ return cfg; }
export function whClipFor(slot){
  var v = slot && cfg[slot], b = v && v.path ? bufs[v.path] : null;
  return b && typeof b === 'object' ? b : null;
}

// الإعداد + المقاطع — force = بعد حفظ الأدمن أو دخول الصفحة بعد غياب (المقطع اللي وقع بيتجرّب تاني)
export function whLoadSounds(force){
  if(!sb || !currentTenantId) return Promise.resolve();
  if(cfgFor !== currentTenantId){ cfg = {}; bufs = {}; cfgAt = 0; cfgFor = currentTenantId; }
  if(cfgLoading) return cfgLoading;
  if(!force && cfgAt && Date.now() - cfgAt < CFG_MS) return Promise.resolve();
  cfgLoading = Promise.resolve(sb.from('wh_config').select('sounds').eq('tenant_id', currentTenantId).maybeSingle()).then(function(r){
    cfgLoading = null;
    if(!r || r.error) return;
    cfgAt = Date.now();
    var s = r.data && r.data.sounds;
    cfg = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
    if(force) Object.keys(bufs).forEach(function(p){ if(bufs[p] === 'fail') delete bufs[p]; });
    renderSnd();
    return fetchClips();
  }, function(e){ cfgLoading = null; swallow('wh-sounds/cfg', e); });
  return cfgLoading;
}

function fetchClips(){
  var c = scanAudioCtx();
  if(!c || !sb) return Promise.resolve();
  var paths = [];
  WH_SOUND_SLOTS.forEach(function(s){ var v = cfg[s]; if(v && v.path && !bufs[v.path] && paths.indexOf(v.path) < 0) paths.push(v.path); });
  if(!paths.length) return Promise.resolve();
  paths.forEach(function(p){ bufs[p] = 'loading'; });
  return Promise.resolve(sb.storage.from('wa-media').createSignedUrls(paths, 600)).then(function(r){
    var list = (r && !r.error && r.data) || [];
    return Promise.all(paths.map(function(p){
      var x = list.filter(function(y){ return y && y.path === p; })[0];
      if(!x || !x.signedUrl){ bufs[p] = 'fail'; return null; }
      return fetch(x.signedUrl).then(function(res){
        if(!res.ok) throw new Error('http_' + res.status);
        return res.arrayBuffer();
      }).then(function(ab){ return decode(c, ab); }).then(function(b){ bufs[p] = b; }, function(e){
        bufs[p] = 'fail'; swallow('wh-sounds/clip', e);
      });
    }));
  }, function(e){ paths.forEach(function(p){ bufs[p] = 'fail'; }); swallow('wh-sounds/sign', e); }).then(function(){ renderSnd(); });
}

// ── القناة ───────────────────────────────────────────────────────────
var ch = { cur: null, q: [], pend: null, timer: null };

function emit(d){ try{ window.dispatchEvent(new CustomEvent('sahl:whsound', { detail: d })); }catch(e){ /* قديم */ } }

// slot = whSoundSlot(res) (أو null) · tone = نبرة السيرفر (احتياطي لو مفيش مقطع)
export function whSound(slot, tone, opt){
  opt = opt || {};
  var clip = slot ? whClipFor(slot) : null;
  var item = { slot: slot || null, tone: tone || 'stop', clip: clip, crit: whSoundCritical(slot, tone, !!clip), force: !!opt.force };
  if(!item.force && !scanSoundOn()){ emit({ slot: item.slot, tone: item.tone, src: 'none', reason: 'muted' }); return; }
  if(ch.cur){
    if(item.crit){ ch.q.push(item); return; }
    if(ch.cur.crit){
      if(ch.pend) emit({ slot: ch.pend.slot, tone: ch.pend.tone, src: 'none', reason: 'replaced' });
      ch.pend = item; return;
    }
    stopCur();
  }
  startItem(item);
}

function startItem(item){
  var src, sec, p;
  if(item.clip){ src = 'clip'; sec = Math.min(item.clip.duration, WH_SOUND_PLAY_MAX); p = playScanBuffer(item.clip, WH_SOUND_PLAY_MAX); }
  else if(item.slot === 'unknown'){ src = 'siren'; sec = SIREN_SEC; p = playScanSiren(); }
  else { src = 'tone'; sec = scanToneSec(item.tone); p = playScanTone(item.tone); }
  var cur = { crit: item.crit, h: null, stopped: false, slot: item.slot };
  ch.cur = cur;
  Promise.resolve(p).then(function(h){ if(h && typeof h === 'object'){ cur.h = h; if(cur.stopped) h.stop(); } }, function(){ /* مفيش صوت */ });
  emit({ slot: item.slot, tone: item.tone, src: src, crit: item.crit, sec: sec, at: Date.now() });
  clearTimeout(ch.timer);
  ch.timer = setTimeout(next, Math.round(sec * 1000) + (item.crit ? 250 : 80));
}
function stopCur(){
  var c = ch.cur;
  if(c){ c.stopped = true; if(c.h) c.h.stop(); emit({ slot: c.slot, src: 'cut' }); }
  clearTimeout(ch.timer);
  ch.cur = null;
}
function next(){
  ch.cur = null;
  var n = ch.q.shift();
  if(!n && ch.pend){ n = ch.pend; ch.pend = null; }
  if(n) startItem(n);
}

// ── كارت الأدمن (⚙️ التشغيل) ─────────────────────────────────────────
var sndOpen = false;
var ed = null;   // {slot, name, ch, rate, dur, start, end, peaks, busy}
var TRIM_MSG = { bad: 'اكتب أرقام صح', range: 'البداية لازم تبقى قبل النهاية وجوّه مدة الملف', short: 'الجزء قصير قوي (أقل من 0.2 ثانية)',
                 long: 'الجزء أطول من ' + WH_SOUND_MAX_SEC + ' ثواني — قصّره (الموظف بيضرب كل ثانية ونص)' };
var SET_MSG = { not_allowed: 'الأدمن بس', bad_path: 'مسار الملف مش مظبوط', file_missing: 'الملف ماوصلش السيرفر — جرّب تاني',
                bad_dur: 'المدة مش مظبوطة', bad_slot: 'خانة مش معروفة' };

export function whSoundsRender(){ renderSnd(); }

function renderSnd(){
  var el = $id('wh-snd'); if(!el) return;
  if(currentRole !== 'admin'){ el.innerHTML = ''; return; }
  var nC = WH_SOUND_SLOTS.filter(function(s){ return cfg[s] && cfg[s].path; }).length;
  var h = '<details class="wh-snd-box"' + (sndOpen || ed ? ' open' : '') + '><summary>🔊 أصوات السكانر'
    + '<span class="wh-snd-sum">' + (nC ? nC + ' من 4 بصوت متغيّر' : 'الأصوات العادية — تقدر تحط افيهات') + '</span></summary>'
    + '<p class="wh-hint">ارفع ملف صوت (mp3 · m4a · wav …) لكل حالة واختار منه الجزء اللي عايزه (لحد ' + WH_SOUND_MAX_SEC + ' ثواني). '
    + 'الصوت بيشتغل على كل أجهزة السكانر — والموظف يقدر يكتمه على جهازه من 🔔.</p>';
  WH_SOUND_SLOTS.forEach(function(s){
    var v = cfg[s], m = WH_SOUND_META[s], b = v && v.path ? bufs[v.path] : null;
    h += '<div class="wh-snd-row" data-slot="' + s + '">'
      + '<div class="wh-snd-l"><b>' + esc(m.t) + '</b> <span class="wh-snd-q">' + esc(m.q) + '</span><div class="wh-snd-cur">'
      + (v && v.path
          ? '📎 ' + esc(v.name || 'ملف') + ' · <span dir="ltr">' + esc(String(v.dur || '')) + '</span>ث' + (v.by ? ' · ' + esc(v.by) : '')
            + (b === 'fail' ? ' <span class="wh-snd-bad">⚠️ مقدرناش نشغّله على الجهاز ده — هيشتغل الصوت العادي</span>' : b === 'loading' ? ' ⏳' : '')
          : (s === 'unknown' ? 'السرينة العادية' : 'النغمة العادية'))
      + '</div></div><div class="wh-snd-acts">'
      + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whs="play" data-slot="' + s + '">▶️ اسمع</button>'
      + '<label class="wh-btn wh-btn-sm wh-snd-up">📤 ' + (v && v.path ? 'غيّره' : 'ارفع ملف')
      + '<input type="file" class="wh-snd-file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.opus,.webm" data-whs="file" data-slot="' + s + '"></label>'
      + (v && v.path ? '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whs="reset" data-slot="' + s + '">↺ رجّع العادي</button>' : '')
      + '</div>' + (ed && ed.slot === s ? edHtml() : '') + '</div>';
  });
  el.innerHTML = h + '</details>';
  if(ed) drawWave();
}

function edHtml(){
  var chk = whTrimCheck(ed.dur, ed.start, ed.end);
  return '<div class="wh-snd-ed">'
    + '<div class="wh-snd-ed-h">📎 ' + esc(ed.name) + ' — مدته <span dir="ltr">' + ed.dur.toFixed(1) + '</span>ث · اختار الجزء (اضغط على الموجة = يبدأ من هنا)</div>'
    + '<canvas class="wh-snd-wave" width="600" height="56"></canvas>'
    + '<div class="wh-snd-ed-r">'
    + '<label>من <input type="number" class="wh-snd-n" data-whs="start" min="0" step="0.1" dir="ltr" value="' + ed.start.toFixed(1) + '"> ث</label>'
    + '<label>لـ <input type="number" class="wh-snd-n" data-whs="end" min="0" step="0.1" dir="ltr" value="' + ed.end.toFixed(1) + '"> ث</label>'
    + '<span class="wh-snd-len" dir="ltr">' + Math.max(0, ed.end - ed.start).toFixed(1) + 's</span>'
    + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whs="ed-play">▶️ اسمع الجزء ده</button>'
    + '<button type="button" class="wh-btn wh-btn-main wh-btn-sm" data-whs="ed-save"' + (chk || ed.busy ? ' disabled' : '') + '>' + (ed.busy ? '⏳ بيترفع…' : '💾 احفظ') + '</button>'
    + '<button type="button" class="wh-btn wh-btn-ghost wh-btn-sm" data-whs="ed-cancel">✖ إلغاء</button></div>'
    + '<div class="wh-hint bad wh-snd-err"' + (chk ? '' : ' hidden') + '>' + (chk ? esc(TRIM_MSG[chk]) : '') + '</div></div>';
}

// تحديث المحرر من غير رسم كامل (الخانة اللي الأدمن بيكتب فيها مابتفقدش الفوكس)
function edRefresh(){
  var el = $id('wh-snd'); if(!el || !ed) return;
  var chk = whTrimCheck(ed.dur, ed.start, ed.end);
  var len = el.querySelector('.wh-snd-len'); if(len) len.textContent = Math.max(0, ed.end - ed.start).toFixed(1) + 's';
  var sv = el.querySelector('[data-whs="ed-save"]');
  if(sv){ sv.disabled = !!(chk || ed.busy); sv.textContent = ed.busy ? '⏳ بيترفع…' : '💾 احفظ'; }
  var er = el.querySelector('.wh-snd-err');
  if(er){ er.hidden = !chk; er.textContent = chk ? TRIM_MSG[chk] : ''; }
  drawWave();
}

function drawWave(){
  var el = $id('wh-snd'); var cv = el && el.querySelector('.wh-snd-wave');
  if(!cv || !ed || !cv.getContext) return;
  var g = cv.getContext('2d'); if(!g) return;
  var W = cv.width, H = cv.height, n = ed.peaks.length;
  g.clearRect(0, 0, W, H);
  var a = ed.start / ed.dur * W, b = ed.end / ed.dur * W;
  g.fillStyle = 'rgba(59,130,246,.18)'; g.fillRect(a, 0, Math.max(1, b - a), H);
  for(var i = 0; i < n; i++){
    var x = i * W / n, inSel = x >= a && x <= b, hh = Math.max(1, ed.peaks[i] * (H - 6));
    g.fillStyle = inSel ? '#2563eb' : '#94a3b8';
    g.fillRect(x, (H - hh) / 2, Math.max(1, W / n - 0.5), hh);
  }
}

function edSegment(){
  return whTrimMono(ed.ch, ed.rate, ed.start, ed.end, WH_SOUND_RATE);
}
function monoBuffer(mono){
  var c = scanAudioCtx(); if(!c || !mono.length) return null;
  try{
    var b = c.createBuffer(1, mono.length, WH_SOUND_RATE);
    if(b.copyToChannel) b.copyToChannel(mono, 0); else b.getChannelData(0).set(mono);
    return b;
  }catch(e){ swallow('wh-sounds/buffer', e); return null; }
}

function onFile(inp){
  var f = inp.files && inp.files[0], slot = inp.getAttribute('data-slot');
  inp.value = '';
  if(!f || WH_SOUND_SLOTS.indexOf(slot) < 0) return;
  if(f.size > 25 * 1024 * 1024){ toast('الملف كبير قوي (أكتر من 25 ميجا) — قصّه الأول', 'er'); return; }
  var c = scanAudioCtx();
  if(!c){ toast('المتصفح ده مابيشغّلش صوت', 'er'); return; }
  unlockAudio();
  Promise.resolve(f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer()).then(function(ab){ return decode(c, ab); }).then(function(buf){
    var chs = [];
    for(var i = 0; i < buf.numberOfChannels; i++) chs.push(buf.getChannelData(i));
    var dur = buf.duration;
    ed = { slot: slot, name: String(f.name || 'صوت').slice(0, 80), ch: chs, rate: buf.sampleRate, dur: dur,
           start: 0, end: Math.min(dur, slot === 'unknown' ? 3 : 2.5), peaks: whPeaks(chs, 240), busy: false };
    sndOpen = true;
    renderSnd();
  }, function(e){ swallow('wh-sounds/decode', e); toast('المتصفح مش عارف يقرا الملف ده — جرّب mp3 أو wav', 'er'); });
}

function edSave(){
  if(!ed || ed.busy || whTrimCheck(ed.dur, ed.start, ed.end) || !sb || !currentTenantId) return;
  var e0 = ed, slot = ed.slot, mono = edSegment();
  if(!mono.length) return;
  var wav = whEncodeWav(mono, WH_SOUND_RATE);
  var path = currentTenantId + '/wh-sounds/' + slot + '-' + uuid() + '.wav';
  var dur = Math.round(mono.length / WH_SOUND_RATE * 100) / 100;
  e0.busy = true; edRefresh();
  var blob = new Blob([wav], { type: 'audio/wav' });
  Promise.resolve(sb.storage.from('wa-media').upload(path, blob, { contentType: 'audio/wav', upsert: false })).then(function(r){
    if(!r || r.error) throw { code: 'upload' };
    var p = {}; p[slot] = { path: path, name: e0.name, dur: dur };
    return sb.rpc('wh_sounds_set', { p: p });
  }).then(function(r){
    var d = r && !r.error && r.data;
    if(!d || !d.ok) throw { code: (d && d.code) || 'error' };
    cfg = d.sounds && typeof d.sounds === 'object' ? d.sounds : cfg;
    cfgAt = Date.now();
    var b = monoBuffer(mono);
    if(b) bufs[path] = b;           // المقطع جاهز على الجهاز ده — مش محتاجين نجيبه تاني
    if(ed === e0) ed = null;
    renderSnd();
    toast('اتحفظ ✓ — هيشتغل على كل أجهزة السكانر (الأجهزة المفتوحة خلال 5 دقايق)', 'ok');
  }).catch(function(e){
    e0.busy = false;
    if(ed === e0) edRefresh();
    toast(e && e.code === 'upload' ? 'مقدرناش نرفع الملف — جرّب تاني' : (SET_MSG[e && e.code] || 'مقدرناش نحفظ — جرّب تاني'), 'er');
  });
}

function resetSlot(slot){
  if(!sb || !cfg[slot]) return;
  showModal({ icon: '↺', title: 'ترجّع الصوت العادي؟', sub: WH_SOUND_META[slot].t + ' — هيرجع ' + (slot === 'unknown' ? 'للسرينة العادية' : 'للنغمة العادية') + ' على كل الأجهزة.',
    okLabel: 'رجّعه', onOk: function(){
      var p = {}; p[slot] = null;
      Promise.resolve(sb.rpc('wh_sounds_set', { p: p })).then(function(r){
        var d = r && !r.error && r.data;
        if(!d || !d.ok){ toast(SET_MSG[d && d.code] || 'مقدرناش نحفظ — جرّب تاني', 'er'); return; }
        cfg = d.sounds && typeof d.sounds === 'object' ? d.sounds : {};
        cfgAt = Date.now();
        renderSnd();
        toast('رجع الصوت العادي ✓', 'ok');
      });
    } });
}

var DEF_TONE = { out: 'ok', in: 'in', dup: 'dup', unknown: 'stop' };
function playSlot(slot){
  unlockAudio();
  whSound(slot, DEF_TONE[slot] || 'ok', { force: true });
}

function onClick(e){
  var t = e.target.closest ? e.target.closest('[data-whs]') : null;
  if(!t) return;
  var a = t.getAttribute('data-whs');
  if(a === 'play') playSlot(t.getAttribute('data-slot'));
  else if(a === 'reset') resetSlot(t.getAttribute('data-slot'));
  else if(a === 'ed-cancel'){ ed = null; renderSnd(); }
  else if(a === 'ed-save') edSave();
  else if(a === 'ed-play'){
    if(!ed || whTrimCheck(ed.dur, ed.start, ed.end)) return;
    unlockAudio();
    var b = monoBuffer(edSegment());
    if(b) playScanBuffer(b, WH_SOUND_MAX_SEC + 0.5);
  }
}
function onInput(e){
  var t = e.target;
  if(!ed || !t || !t.getAttribute) return;
  var a = t.getAttribute('data-whs');
  if(a !== 'start' && a !== 'end') return;
  var v = parseFloat(String(t.value || '').replace(/[٠-٩]/g, function(d){ return String(d.charCodeAt(0) - 1632); }));
  if(!isFinite(v)) v = NaN;
  if(a === 'start') ed.start = v; else ed.end = v;
  edRefresh();
}
function onChange(e){
  var t = e.target;
  if(t && t.getAttribute && t.getAttribute('data-whs') === 'file') onFile(t);
}
function onWave(e){
  var cv = e.target;
  if(!ed || !cv.classList || !cv.classList.contains('wh-snd-wave')) return;
  var r = cv.getBoundingClientRect();
  // الموجة من الشمال لليمين (الوقت) حتى في صفحة عربي
  var x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
  var len = isFinite(ed.end - ed.start) && ed.end > ed.start ? ed.end - ed.start : 2;
  ed.start = Math.round(x * ed.dur * 10) / 10;
  ed.end = Math.round(Math.min(ed.dur, ed.start + Math.min(len, WH_SOUND_MAX_SEC)) * 10) / 10;
  var el = $id('wh-snd');
  var si = el && el.querySelector('[data-whs="start"]'), ei = el && el.querySelector('[data-whs="end"]');
  if(si) si.value = ed.start.toFixed(1);
  if(ei) ei.value = ed.end.toFixed(1);
  edRefresh();
}
function onToggle(e){
  var d = e.target;
  if(d && d.classList && d.classList.contains('wh-snd-box')) sndOpen = d.open;
}

var wired = false;
export function whSoundsInit(){
  var el = $id('wh-snd');
  if(!el || wired) return;
  wired = true;
  el.addEventListener('click', onClick);
  el.addEventListener('click', onWave);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('toggle', onToggle, true);
}

// للهارنس
export function whSoundsDebug(){
  var b = {};
  Object.keys(bufs).forEach(function(p){ b[p] = typeof bufs[p] === 'object' ? 'ok' : bufs[p]; });
  return { cfg: cfg, bufs: b, cur: ch.cur ? { slot: ch.cur.slot, crit: ch.cur.crit } : null, q: ch.q.length, pend: !!ch.pend };
}
