// صوت التنبيه (8 أكتوبر — طلب المالك): «صوت انذار او تنبيه يحصل اول ما ينزل في السيستم اي استثناء،
// مع امكانية تشغيل او تعطيل الصوت من الاعدادات».
//
// Web Audio — بنولّد النغمة في المتصفح، مفيش ملف صوت (مفيش تحميل ولا media-src).
// 🔴 المتصفح بيمنع أي صوت لحد أول ضغطة أو زرار في الصفحة (autoplay policy): الـAudioContext اللي
// بيتعمل قبلها بيفضل `suspended`. فبنفتحه مع أول ضغطة (initAlertSound) ويفضل جاهز طول الجلسة —
// والموظف بيضغط في اللوحة طول اليوم، فعملياً بيبقى جاهز من أول دقيقة. صفحة اتفتحت ومحدش لمسها = مفيش صوت
// (ده قانون المتصفح مش قرارنا) — والإعدادات فيها «▶️ جرّب الصوت» اللي هي نفسها ضغطة.

var ctx = null;
var DEVICE_KEY = 'sahl_jx_sound';   // '0' = الصوت مقفول على الجهاز ده (الافتراضي شغّال)

function getCtx(){
  if(ctx) return ctx;
  try{
    var A = window.AudioContext || window.webkitAudioContext;
    if(A) ctx = new A();
  }catch(e){ ctx = null; }
  return ctx;
}

export function unlockAudio(){
  var c = getCtx();
  if(c && c.state === 'suspended'){ try{ c.resume(); }catch(e){ /* لسه مافيش ضغطة */ } }
}

export function audioReady(){ return !!ctx && ctx.state === 'running'; }

var wired = false;
export function initAlertSound(){
  if(wired || typeof document === 'undefined') return;
  wired = true;
  // ⚠️ على اللمس pointerdown لوحده مابيعدّش «تفاعل» عند المتصفح (iOS بالذات) — touchend/pointerup/click هم اللي بيفتحوا الصوت
  ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(function(ev){
    document.addEventListener(ev, unlockAudio, true);
  });
}

export function deviceSoundOn(){
  try{ return localStorage.getItem(DEVICE_KEY) !== '0'; }catch(e){ return true; }
}
export function setDeviceSound(on){
  try{ localStorage.setItem(DEVICE_KEY, on ? '1' : '0'); }catch(e){ /* مفيش storage */ }
}

// نغمة إنذار قصيرة: 3 نبضات (عالي/واطي/عالي) × مرتين ≈ 1.6 ثانية — واضحة من غير ما تبقى مزعجة.
// بترجّع Promise<boolean>: رنّت فعلاً ولا لأ. resume() مش لحظي، فلو الصوت كان معلّق بنستناه قبل ما نحكم.
// الحدث sahl:alert بيطلع بس لما النغمة اتجدولت فعلاً (الهارنس بيعدّ الرنّات الحقيقية مش المحاولات).
export function playAlert(){
  var c = getCtx();
  if(!c) return Promise.resolve(false);
  if(c.state === 'running') return Promise.resolve(ring(c));
  var p;
  try{ p = c.resume(); }catch(e){ p = null; }
  if(!p || typeof p.then !== 'function') return Promise.resolve(c.state === 'running' ? ring(c) : false);
  return p.then(function(){ return c.state === 'running' ? ring(c) : false; }, function(){ return false; });
}

function ring(c){
  try{
    var t0 = c.currentTime + 0.02;
    var notes = [988, 784, 988, 0, 988, 784, 988];
    for(var i = 0; i < notes.length; i++){
      if(!notes[i]) continue;
      var at = t0 + i * 0.22;
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      o.connect(g); g.connect(c.destination);
      o.start(at); o.stop(at + 0.2);
    }
  }catch(e){ return false; }
  try{ window.dispatchEvent(new CustomEvent('sahl:alert')); }catch(e){ /* متصفح قديم */ }
  return true;
}

// ── أصوات سكانر المخزن (14 أكتوبر) ─────────────────────────────────────
// الموظف قدام الطرود مش قدام الشاشة — الصوت هو اللي بيقوله «تمام» أو «وقّف». كل نبرة شكل مختلف:
//   ok   = بيب واحدة عالية قصيرة (اتخصم)        in   = نغمتين طالعين (مرتجع رجع)
//   dup  = بيبتين واطيين (اتضرب قبل كده)       warn = 3 نبضات متوسطة (محتاج قرار)
//   stop = بزّ واطي طويل (وقّف — ماتسلّموش)
// مفتاح كتم لوحده (`sahl_wh_sound`) — كتم الاستثناءات مايكتمش السكانر والعكس.
var SCAN_KEY = 'sahl_wh_sound';
export function scanSoundOn(){
  try{ return localStorage.getItem(SCAN_KEY) !== '0'; }catch(e){ return true; }
}
export function setScanSound(on){
  try{ localStorage.setItem(SCAN_KEY, on ? '1' : '0'); }catch(e){ /* مفيش storage */ }
}

var SCAN_TONES = {
  ok:   { type: 'square',   notes: [[1568, 0, 0.09]] },
  in:   { type: 'triangle', notes: [[784, 0, 0.1], [1175, 0.12, 0.14]] },
  dup:  { type: 'square',   notes: [[523, 0, 0.08], [523, 0.13, 0.08]] },
  warn: { type: 'triangle', notes: [[880, 0, 0.1], [880, 0.16, 0.1], [880, 0.32, 0.1]] },
  stop: { type: 'sawtooth', notes: [[196, 0, 0.55]] }
};

export function playScanTone(kind){
  var spec = SCAN_TONES[kind] || SCAN_TONES.stop;
  var c = getCtx();
  if(!c) return Promise.resolve(false);
  var go = function(){
    if(c.state !== 'running') return false;
    try{
      var t0 = c.currentTime + 0.01;
      for(var i = 0; i < spec.notes.length; i++){
        var n = spec.notes[i], at = t0 + n[1], dur = n[2];
        var o = c.createOscillator(), g = c.createGain();
        o.type = spec.type;
        o.frequency.setValueAtTime(n[0], at);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(kind === 'stop' ? 0.4 : 0.3, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g); g.connect(c.destination);
        o.start(at); o.stop(at + dur + 0.02);
      }
    }catch(e){ return false; }
    try{ window.dispatchEvent(new CustomEvent('sahl:scan-tone', { detail: kind })); }catch(e){ /* متصفح قديم */ }
    return true;
  };
  if(c.state === 'running') return Promise.resolve(go());
  var p;
  try{ p = c.resume(); }catch(e){ p = null; }
  if(!p || typeof p.then !== 'function') return Promise.resolve(go());
  return p.then(go, function(){ return false; });
}

// ── مقاطع الأدمن + السرينة (15 أكتوبر مساءً — v78) ────────────────────
// المقطع بيتفك مرة (decodeAudioData على نفس الـAudioContext) ويتشغّل من الذاكرة — مفيش <audio> ولا media-src.
export function scanAudioCtx(){ return getCtx(); }

function whenRunning(c, fn){
  if(!c) return Promise.resolve(false);
  if(c.state === 'running') return Promise.resolve(fn());
  var p;
  try{ p = c.resume(); }catch(e){ p = null; }
  if(!p || typeof p.then !== 'function') return Promise.resolve(c.state === 'running' ? fn() : false);
  return p.then(function(){ return c.state === 'running' ? fn() : false; }, function(){ return false; });
}

// السرينة الافتراضية لـ«بوليصة J&T مش متسجلة في سهل»: صفّارة طالعة نازلة مرتين (~1.6ث) — مختلفة عن أي نبرة تانية
export var SIREN_SEC = 1.6;
export function playScanSiren(){
  var c = getCtx();
  return whenRunning(c, function(){
    try{
      var t0 = c.currentTime + 0.01, o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(620, t0);
      for(var i = 0; i < 2; i++){
        o.frequency.linearRampToValueAtTime(1350, t0 + i * 0.8 + 0.4);
        o.frequency.linearRampToValueAtTime(620, t0 + i * 0.8 + 0.8);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.04);
      g.gain.setValueAtTime(0.22, t0 + SIREN_SEC - 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + SIREN_SEC);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + SIREN_SEC + 0.02);
    }catch(e){ return false; }
    try{ window.dispatchEvent(new CustomEvent('sahl:scan-tone', { detail: 'siren' })); }catch(e){ /* قديم */ }
    return true;
  });
}

// تشغيل مقطع متفكوك — بيرجّع {stop()} (العادي بيتقطع لما نتيجة جديدة تيجي) أو null لو المتصفح لسه مانع الصوت
export function playScanBuffer(buf, maxSec){
  var c = getCtx();
  if(!buf) return Promise.resolve(null);
  return whenRunning(c, function(){
    var src;
    try{
      src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      var d = Math.min(buf.duration, maxSec || buf.duration);
      src.start(c.currentTime + 0.01, 0, d);
    }catch(e){ return null; }
    try{ window.dispatchEvent(new CustomEvent('sahl:scan-tone', { detail: 'clip' })); }catch(e){ /* قديم */ }
    return { stop: function(){ try{ src.stop(); }catch(e){ /* خلص */ } } };
  });
}

// مدة النبرة المتولّدة (للقناة — الصوت اللي بعدها بيستنى)
export function scanToneSec(kind){
  var spec = SCAN_TONES[kind] || SCAN_TONES.stop, m = 0;
  for(var i = 0; i < spec.notes.length; i++) m = Math.max(m, spec.notes[i][1] + spec.notes[i][2]);
  return m;
}
