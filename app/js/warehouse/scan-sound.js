// أصوات سكانر المخزن — المنطق الصافي (15 أكتوبر مساءً — طلب المالك · v78)
//
// «لما السيستم يضرب بوليصة خروج مظبوطة يعمل صوت "مظبووووط" … دخول أو مرتجع "وصل وصل وصل" … ضرب الأوردر مرتين
// "هبعتهولك برضو" … بوليصة بتبدأ ب JEG بس مش متسجلة في سهل "سرينة"». الأربعة خانات الأدمن بيرفع فيها ملف (mp3 …)
// من «⚙️ التشغيل» — والمتصفح بيقصّه ويحوّله WAV قبل الرفع (wh-sounds.js). من غير ملف = الصوت العادي (والسرينة متولّدة).
//
// 🔴 الخانة من **نوع النتيجة** (code) مش من النبرة (tone): 14 من أول 19 مرتجع حقيقي (15 أكتوبر) رجعوا نبرة «warn» بسبب
//    تحذير «J&T قفلته قبل التشغيل ومحدش سجّله» — والمرتجع نفسه اتسجّل صح. الكارت بيفضل برتقاني (للأدمن) والصوت «وصل».
//    الاستثناء: «J&T ماقالتش إنه مرتجع» (no_return_signal — F9 ممكن يكون على طرد رايح للعميل) = صوت التنبيه مش «وصل» ·
//    والخروج اللي فيه منتج **مش مربوط** (السطر ده مااتخصمش فعلاً) = صوت التنبيه مش «مظبوط». (المراجعة) المخزون بقى بالسالب
//    (short) = «مظبوط» برضه: الطرد خرج صح والسالب شغل الأدمن (الكارت برتقاني + الشارة الحمرا) — ربع خروج النهارده كان
//    هيبقى من غير «مظبوط» بسبب أرقام المخزون مش بسبب الطرد.
// 🔴 «هبعتهولك برضو» = السيرفر قال «اتضرب قبل كده» (already_out · already_in · unknown_already_in) — مش القراية
//    المزدوجة من السكانر (نفس الكود خلال 3ث بيتطنّش من غير صوت) ولا رد اتعاد بعد ما النت رجع (replay = نفس السكان).
// ⚠️ مفيش DOM ولا Supabase هنا — الهارنس بيشغّله في node (tools/test-scan-sound.mjs).

export var WH_SOUND_SLOTS = ['out', 'in', 'dup', 'unknown'];
export var WH_SOUND_MAX_SEC = 5;          // أطول مقطع بيتحفظ (المتصفح بيقصّ)
export var WH_SOUND_PLAY_MAX = 5;         // وأطول مدة بتتشغّل = نفس اللي بيتحفظ (المراجعة: كان 4.5 والمعاينة بتسمّع 5) — حتى لو حد رفع أطول من بره
export var WH_SOUND_RATE = 22050;         // WAV أحادي 16-bit — ثانيتين ≈ 88KB
export var WH_SOUND_META = {
  out:     { t: '✅ طرد خارج اتضرب مظبوط',            q: '«مظبوووط»' },
  in:      { t: '↩️ مرتجع رجع للمخزن',                q: '«وصل وصل وصل»' },
  dup:     { t: '🔁 الطرد اتضرب قبل كده',              q: '«هبعتهولك برضو»' },
  unknown: { t: '🚨 بوليصة J&T مش متسجلة في سهل',      q: 'سرينة' }
};

var OUT_CODES = { out_ok: 1, out_leak_fix: 1 };
var IN_CODES = { in_ok: 1, in_ok_precount: 1, in_ok_leak: 1, in_ok_manual: 1, in_counted: 1, unknown_in: 1 };
var DUP_CODES = { already_out: 1, already_in: 1, unknown_already_in: 1 };

// الخانة لنتيجة من السيرفر — null = الصوت العادي حسب النبرة (وقّف · قرار · …)
export function whSoundSlot(res){
  if(!res || typeof res !== 'object') return null;
  var c = res.code, w = Array.isArray(res.warnings) ? res.warnings : [];
  if(OUT_CODES[c]) return w.indexOf('unmatched') >= 0 ? null : 'out';
  if(IN_CODES[c]) return w.indexOf('no_return_signal') >= 0 ? null : 'in';
  if(DUP_CODES[c]) return 'dup';
  if(c === 'not_found') return 'unknown';
  return null;
}

// الصوت حرج = بيقطع العادي وبيستنى دوره ورا الحرج (وقّف · قرار · السرينة) — العادي (مظبوط · وصل · هبعتهولك) بيقطع العادي
// اللي قبله. (المراجعة) الخانة ليها صوتها حتى من غير مقطع (wh-sounds.js بيشغّل نبرتها الافتراضية: مظبوط ok · وصل in ·
// هبعتهولك dup) — فالخانة مش حرجة إلا السرينة، مهما كانت نبرة النتيجة (مرتجع warn «قبل التشغيل» = «وصل» مش «قرار»)
export function whSoundCritical(slot, tone, hasClip){
  if(slot) return slot === 'unknown';
  return tone === 'stop' || tone === 'warn';
}

// ── تقطيع المقطع (المتصفح) ───────────────────────────────────────────
// المدخل: قنوات Float32Array (من AudioBuffer) + معدّل العينة · المخرج: Float32Array أحادي بمعدّل WH_SOUND_RATE من start
// لـ end (ثواني) · مطبّع لـ0.95 (المقاطع اللي جاية من أفلام صوتها متفاوت جداً) · fade 15ms في الأول والآخر (من غير «تكّة»)
export function whTrimCheck(dur, start, end){
  var s = Number(start), e = Number(end), d = Number(dur);
  if(!isFinite(s) || !isFinite(e) || !isFinite(d)) return 'bad';
  if(s < 0 || e > d + 0.001 || s >= e) return 'range';
  if(e - s < 0.2) return 'short';
  if(e - s > WH_SOUND_MAX_SEC + 0.001) return 'long';
  return '';
}

export function whTrimMono(channels, srcRate, start, end, outRate){
  outRate = outRate || WH_SOUND_RATE;
  var nch = channels.length;
  if(!nch || !srcRate) return new Float32Array(0);
  var len = channels[0].length;
  var a = Math.max(0, Math.floor(start * srcRate)), b = Math.min(len, Math.ceil(end * srcRate));
  if(b <= a) return new Float32Array(0);
  var n = Math.max(1, Math.round((b - a) * outRate / srcRate));
  var out = new Float32Array(n), ratio = srcRate / outRate, peak = 0;
  for(var i = 0; i < n; i++){
    // متوسط القنوات + خطي بين العينتين (كفاية لمقطع كلام ثانيتين)
    var pos = a + i * ratio, i0 = Math.floor(pos), f = pos - i0, i1 = Math.min(b - 1, i0 + 1), v = 0;
    for(var c = 0; c < nch; c++){ var ch = channels[c]; v += (ch[i0] || 0) * (1 - f) + (ch[i1] || 0) * f; }
    v /= nch;
    out[i] = v;
    var av = v < 0 ? -v : v;
    if(av > peak) peak = av;
  }
  var g = peak > 0.01 ? 0.95 / peak : 1;
  var fade = Math.min(Math.floor(outRate * 0.015), Math.floor(n / 4));
  for(var j = 0; j < n; j++){
    var k = 1;
    if(j < fade) k = j / fade;
    else if(j >= n - fade) k = (n - 1 - j) / fade;
    out[j] = Math.max(-1, Math.min(1, out[j] * g * k));
  }
  return out;
}

// WAV PCM 16-bit أحادي — ArrayBuffer
export function whEncodeWav(samples, rate){
  rate = rate || WH_SOUND_RATE;
  var n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  var str = function(off, s){ for(var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for(var i = 0; i < n; i++){
    var s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return buf;
}

// شكل الموجة للعرض (n عمود · أقصى قيمة في كل عمود 0..1)
export function whPeaks(channels, n){
  var len = channels.length ? channels[0].length : 0, out = new Array(n);
  for(var i = 0; i < n; i++){
    var a = Math.floor(i * len / n), b = Math.max(a + 1, Math.floor((i + 1) * len / n)), m = 0;
    for(var j = a; j < b && j < len; j += Math.max(1, Math.floor((b - a) / 64))){
      for(var c = 0; c < channels.length; c++){ var x = channels[c][j]; if(x < 0) x = -x; if(x > m) m = x; }
    }
    out[i] = Math.min(1, m);
  }
  return out;
}
