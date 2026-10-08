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
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
}

export function deviceSoundOn(){
  try{ return localStorage.getItem(DEVICE_KEY) !== '0'; }catch(e){ return true; }
}
export function setDeviceSound(on){
  try{ localStorage.setItem(DEVICE_KEY, on ? '1' : '0'); }catch(e){ /* مفيش storage */ }
}

// نغمة إنذار قصيرة: 3 نبضات (عالي/واطي/عالي) × مرتين ≈ 1.6 ثانية — واضحة من غير ما تبقى مزعجة
export function playAlert(){
  try{ window.dispatchEvent(new CustomEvent('sahl:alert')); }catch(e){ /* متصفح قديم */ }
  var c = getCtx();
  if(!c) return false;
  if(c.state === 'suspended'){ try{ c.resume(); }catch(e){ /* */ } }
  if(c.state !== 'running') return false;
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
    return true;
  }catch(e){ return false; }
}
