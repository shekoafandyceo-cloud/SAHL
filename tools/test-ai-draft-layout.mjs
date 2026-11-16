// شكل الدخل بتاع الـAI Agent (16 نوفمبر) — من غير متصفح: supabase/functions/_shared/ai-draft.ts بالحرف.
//  1) v1 هو الافتراضي (من غير layout = v1) وقيمة غريبة في الإعداد = v1
//  2) prompt_layout / skip_cards / discontinued مابيدخلوش «معلومات المتجر» في أي شكل
//  3) v2: الجزء الثابت (لحد «أسعار الموقع») نفس البايتات لمحادثتين مختلفتين — ومن غير علامة الإعلان
//  4) v3: كارت منتج الإعلان + الكارت اللي اتبعت + كروت كلمات العميل · الفهرس فيه كل الكروت · مفيش كارت اتعرف = كل الكروت
//  5) v3: «بيتحمل» مابتجيبش «بيت مجات» (الكلمة القصيرة بالتطابق مش بالاحتواء) · «التروللي» بتجيب الترولي
//  6) v2 و v3 فيهم نفس سطور «المحادثة دي/الأوردرات/الرسايل» بتاعة v1 بالحرف
//  7) معلومات للـAgent (ai_notes) تحت نص الكارت · من غيرها نفس النص بالحرف · v3 للكارت المعروض بس · سقف 1500
// المعايرات: (و) السطر من غير معلومات · (ز) v1 من غيرها · (ح) من غير سقف · (أ) الافتراضي v2 · (ب) prompt_layout بيدخل الـprompt · (ج) علامة الإعلان في الجزء الثابت · (د) الكلمة القصيرة بالاحتواء · (هـ) مفيش fallback
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.join(ROOT, 'supabase/functions/_shared/ai-draft.ts');
const SRC = fs.readFileSync(TS, 'utf8');
let seq = 0;
async function load(mut) {
  if (!mut) return import(pathToFileURL(TS).href);
  const out = mut(SRC);
  if (out === SRC) throw new Error('المعايرة مالقتش المرساة');
  const f = path.join(os.tmpdir(), 'ai-draft-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, out);
  return import(pathToFileURL(f).href);
}
const cards = [
  { id: 'c1', title: 'مطبببببببببببببخ 2', body: '*أهلاً بحضرتك 🙏🏼💙*\n✨ *منظم المطبخ المتكامل فوق الحوض – دورين* ✨\nالسعر 1850' },
  { id: 'c2', title: 'مطبخ', body: 'أهلاً بحضرتك 🙏🏼💙\n✨ منظم المطبخ المتكامل فوق الحوض ✨\n85 بـ1499' },
  { id: 'c4', title: 'تيربو', body: 'أهلاً بحضرتك 🌸\nتيربو بريمو 5 أدوار متوفر حاليًا ✨\n1285' },
  { id: 'c6', title: 'تروولي 3 دور ايكيا', body: 'أهلاً بحضرتك 🌸\nترولي التنظيم العملي بـ 3 أدوار متوفر حاليًا ✨' },
  { id: 'c7', title: 'طقم حمام', body: '*أهلاً بحضرتك*\n✨ *طقم إكسسوارات الحمام العصري 6 في 1* ✨' },
  { id: 'c8', title: 'بيت مجات', body: 'أهلاً بحضرتك\n✨ بيت المجات ايكيا — رتّبي مجاتك ☕' },
  { id: 'c9', title: 'ميكروويف', body: '✨ ستاند الميكروويف القابل للتمدد ✨\nاستغلي المساحة' },
  { id: 'c11', title: 'امريكانا', body: 'أهلا بحضرتك ✨\nالجزامة الـ5 دور متوفرة دلوقتي بسعر 695 بدل 900 جنيه 🎉' },
];
const products = [
  { id: 'p2', name: 'منظم المطبخ المتكامل دورين', aliases: [], site_names: [], quick_reply_id: 'c1', assembled: false, facts: { variants: [{ label: 'دورين', card_price: 1850 }] } },
  { id: 'p1', name: 'منظم المطبخ المتكامل (دور واحد)', aliases: ['المطبقية'], site_names: ['منظم المطبخ المتكامل'], quick_reply_id: 'c2', assembled: false, facts: { variants: [{ label: 'مقاس 85', site_name: 'منظم المطبخ المتكامل', card_price: 1499 }] } },
];
const base = { nowIso: '2026-11-16T02:00:00Z', facts: { delivery: 'من 24 إلى 48 ساعة', skip_cards: ['مطور'], discontinued: ['الاستاند القابل للطي'], prompt_layout: 'v3' },
  products, cards, siteRows: [{ name: 'منظم المطبخ المتكامل', variant: 'مقاس 85 عرض', price: 1499, n: 4 }], stockNames: ['ب منتج', 'ا منتج'], orders: [], ordersKnown: true, customerName: 'س' };
const mk = (o) => ({ ...base, linkedProductId: null, ad: null, history: [], ...o });
const H = (t) => [{ dir: 'in', body: t }];
const C = {
  kitchen: mk({ linkedProductId: 'p1', ad: { name: 'K' }, history: [{ dir: 'in', body: 'Hello!' }, { dir: 'out', type: 'image', body: cards[1].body }, { dir: 'in', body: 'بكام' }] }),
  none: mk({ history: H('بكام') }),
  turbo: mk({ history: H('عايزة اعرف تفاصيل التيربو') }),
  tahmol: mk({ linkedProductId: 'p1', ad: { name: 'K' }, history: H('هل بيتحمل كل الاطباق') }),
  trolley: mk({ history: H('بكام التروللي ال3 ادوار') }),
  bath: mk({ linkedProductId: 'p1', ad: { name: 'K' }, history: H('طب مش موجود طقم الحمام 6قطع') }),
};
const titles = (p) => (p ? p.map((x) => x.title).join('+') : 'ALL');
function run(M) {
  const r = {};
  const v1 = M.buildUserPrompt(C.kitchen);
  r.c1 = v1 === M.buildUserPrompt(C.kitchen, 'v1') && v1.includes('← ده منتج الإعلان') && v1.indexOf('# كروت المنتجات') < v1.indexOf('# المخزون')
    && M.layoutOf('zz') === 'v1' && M.layoutOf(undefined) === 'v1' && M.layoutOf('v3') === 'v3';
  r.c2 = ['v1', 'v2', 'v3'].every((l) => { const p = M.buildUserPrompt(C.kitchen, l); return !p.includes('prompt_layout') && !p.includes('skip_cards') && !p.includes('- discontinued'); });
  const a = M.buildUserPrompt(C.kitchen, 'v2'), b = M.buildUserPrompt(C.turbo, 'v2');
  const cut = a.indexOf('# أسعار الموقع');
  r.c3 = cut > 0 && a.slice(0, cut) === b.slice(0, b.indexOf('# أسعار الموقع')) && !a.slice(0, cut).includes('← ده منتج الإعلان') && a.includes('- العميل جه من إعلان عن: منظم المطبخ المتكامل (دور واحد)');
  const v3 = M.buildUserPrompt(C.kitchen, 'v3');
  r.c4 = titles(M.pickCards(C.kitchen)) === 'مطبخ' && titles(M.pickCards(C.none)) === 'ALL' && titles(M.pickCards(C.turbo)) === 'تيربو'
    && titles(M.pickCards(C.bath)) === 'مطبخ+طقم حمام' && cards.every((c) => v3.includes('- كارت «' + c.title + '»')) && v3.includes('### كارت «مطبخ»') && !v3.includes('### كارت «تيربو»')
    && M.buildUserPrompt(C.none, 'v3') === M.buildUserPrompt(C.none, 'v2');
  r.c5 = titles(M.pickCards(C.tahmol)) === 'مطبخ' && titles(M.pickCards(C.trolley)) === 'تروولي 3 دور ايكيا';
  const tail = (p) => p.slice(p.indexOf('# المحادثة دي'));
  r.c6 = tail(M.buildUserPrompt(C.turbo, 'v2')) === tail(M.buildUserPrompt(C.turbo)) && tail(M.buildUserPrompt(C.turbo, 'v3')) === tail(M.buildUserPrompt(C.turbo));
  // 7) معلومات للـAgent (ai_notes): تحت نص الكارت في كل الأشكال · كارت من غير معلومات = نفس النص بالحرف · v3 للكارت المعروض بس · سقف 1500
  const NOTE = 'الخامة ستانلس 304 — بيتحمل لحد 15 كيلو للدور';
  const withN = (ctx, n) => ({ ...ctx, cards: ctx.cards.map((c) => (c.title === 'تيربو' ? { ...c, notes: n } : c)) });
  const after = (p) => { const i = p.indexOf('### كارت «تيربو»'); return i < 0 ? '' : p.slice(i, i + 400); };
  const same = (n) => ['v1', 'v2', 'v3'].every((L) => M.buildUserPrompt(withN(C.turbo, n), L) === M.buildUserPrompt(C.turbo, L));
  r.c7 = ['v1', 'v2', 'v3'].every((L) => { const a = after(M.buildUserPrompt(withN(C.turbo, NOTE), L)); return a.includes('1285\n(معلومات مؤكدة من صاحب المتجر') && a.includes('مابتتبعتش للعميل زي ما هي)\n' + NOTE); })
    && same(null) && same('') && same('  \n ')
    && ['v1', 'v2', 'v3'].every((L) => !M.buildUserPrompt(C.turbo, L).includes('معلومات مؤكدة من صاحب المتجر') && !M.buildUserPrompt(withN(C.turbo, ' '), L).includes('معلومات مؤكدة من صاحب المتجر'))
    && !M.buildUserPrompt(withN(C.kitchen, NOTE), 'v3').includes(NOTE) && M.buildUserPrompt(withN(C.kitchen, NOTE), 'v2').includes(NOTE)
    && !M.buildUserPrompt(withN(C.turbo, 'ن'.repeat(1700)), 'v1').includes('ن'.repeat(1501)) && M.buildUserPrompt(withN(C.turbo, 'ن'.repeat(1700)), 'v1').includes('ن'.repeat(1500) + '…');
  return r;
}
let bad = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) bad++; };
const R = run(await load());
ok(R.c1, '1) v1 هو الافتراضي · قيمة غريبة = v1');
ok(R.c2, '2) مفاتيح الإعدادات مابتدخلش الـprompt');
ok(R.c3, '3) v2: الجزء الثابت نفس البايتات ومن غير علامة الإعلان');
ok(R.c4, '4) v3: كروت المحادثة + الفهرس · مفيش كارت اتعرف = الكل');
ok(R.c5, '5) v3: الكلمة القصيرة بالتطابق · الحرف المكرر');
ok(R.c6, '6) ذيل المحادثة = v1 بالحرف');
ok(R.c7, '7) معلومات للـAgent تحت نص الكارت · من غيرها نفس النص بالحرف · v3 للكارت المعروض بس · سقف 1500');
const cal = async (name, mut, key) => {
  let fired = false;
  try { const r = run(await load(mut)); fired = r[key] === false; } catch (e) { console.log('  ✗ معايرة', name, '—', e.message); bad++; return; }
  ok(fired, 'معايرة ' + name + ' → الفحص ' + key + ' بيقع');
};
await cal('(أ) الافتراضي v2', (s) => s.replace('layout: Layout = "v1"', 'layout: Layout = "v2"'), 'c1');
await cal('(ب) prompt_layout بيدخل الـprompt', (s) => s.replace('"skip_cards", "discontinued", "prompt_layout"', '"skip_cards", "discontinued"'), 'c2');
await cal('(ج) علامة الإعلان في الجزء الثابت', (s) => s.replace('const noAd: DraftCtx = { ...ctx, linkedProductId: null };', 'const noAd: DraftCtx = ctx;'), 'c3');
await cal('(د) الكلمة القصيرة بالاحتواء', (s) => s.replace('k.length >= 5 ? hay.includes(k) : words.has(k)', 'hay.includes(k)'), 'c5');
await cal('(هـ) مفيش fallback', (s) => s.replace('if (!hit.size || hit.size > Math.max(4, Math.floor(ctx.cards.length / 2))) return null;', 'if (hit.size > 99) return null;'), 'c4');
await cal('(و) سطر المعلومات بيتحط من غير معلومات', (s) => s.replace('(notes ? "\\n" + NOTES_LABEL + "\\n" + cut(notes, 1500) : "")', '("\\n" + NOTES_LABEL + "\\n" + cut(notes, 1500))'), 'c7');
await cal('(ز) v1 من غير المعلومات', (s) => s.replace('ctx.cards.map(cardBlock)', 'ctx.cards.map((c) => "### كارت «" + c.title + "»\\n" + cut(c.body, 1200))'), 'c7');
await cal('(ح) من غير سقف للمعلومات', (s) => s.replace('cut(notes, 1500)', 'notes'), 'c7');
console.log(bad ? '\n✗ فيه ' + bad + ' فحص وقع' : '\n✓ كله تمام (7 فحوص + 8 معايرات)');
process.exit(bad ? 1 : 0);
