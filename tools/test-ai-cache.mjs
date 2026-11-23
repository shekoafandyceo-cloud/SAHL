// كاش Gemini الصريح (23 نوفمبر — البند 5) — من غير متصفح: _shared/ai-cache.ts و _shared/ai-draft.ts بالحرف.
//  1) cacheKey: نفس الدخل = نفس المفتاح (64 hex) · موديل/تعليمات/جزء ثابت مختلف = مفتاح تاني
//  2) cacheCreateBody: الموديل بـmodels/ · التعليمات + الجزء الثابت turn من العميل · ttl بالثواني · اسم بسقف
//  3) parseCacheMeta: الاسم لازم cachedContents/… والوقت مفهوم · غير كده null · التوكنز من usageMetadata
//  4) cachePlan: create · ready بعيد = use · ready أقل من 15 دقيقة = extend · أقل من دقيقتين/اسم غريب = skip · creating/failed = skip
//  5) generateBody: بالكاش = cachedContent ومن غير system_instruction (Gemini بيرفضهم مع بعض) والمتغيّر بس ·
//     من غير كاش = التعليمات + الأجزاء · جزء واحد من غير كاش = نفس الطلب القديم بالحرف
//  6) cacheRetryable: 4xx (403/404 «CachedContent not found») = نعيد من غير كاش · 429/5xx/200 لأ
//  7) v4: الثابت + "\n\n" + المتغيّر = v2 بالحرف · الثابت نفس البايتات لمحادثات مختلفة · مفيهوش الوقت ولا أسعار الموقع ولا علامة الإعلان
//     ولا الرسايل · المتغيّر فيه كل ده · layoutOf('v4') = v4 · buildUserPrompt(v4) = v2
// المعايرات: (أ) المفتاح من غير التعليمات · (ب) system_instruction مع الكاش · (ج) 429 بيرجع من غير كاش · (د) مفيش مد ·
//            (هـ) الوقت في الجزء الثابت · (و) أي اسم كاش مقبول
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = path.join(ROOT, 'supabase/functions/_shared');
const F = { c: path.join(SH, 'ai-cache.ts'), d: path.join(SH, 'ai-draft.ts') };
const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));
let seq = 0;
async function load(k, mut) {
  if (!mut) return import(pathToFileURL(F[k]).href);
  const out = mut(SRC[k]);
  if (out === SRC[k]) throw new Error('المعايرة مالقتش المرساة');
  const f = path.join(os.tmpdir(), 'ai-cache-cal-' + process.pid + '-' + (seq++) + '.ts');
  fs.writeFileSync(f, out);
  return import(pathToFileURL(f).href);
}

const NOW = Date.parse('2026-11-23T20:00:00Z');
const MIN = 60000;
const cards = [
  { id: 'c1', title: 'مطبببببببببببببخ 2', body: '*أهلاً بحضرتك 🙏🏼💙*\n✨ *منظم المطبخ المتكامل فوق الحوض – دورين* ✨\nالسعر 1850', notes: 'خلص من المخزون' },
  { id: 'c2', title: 'مطبخ', body: 'أهلاً بحضرتك 🙏🏼💙\n✨ منظم المطبخ المتكامل فوق الحوض ✨\n85 بـ1499' },
  { id: 'c4', title: 'تيربو', body: 'أهلاً بحضرتك 🌸\nتيربو بريمو 5 أدوار متوفر حاليًا ✨\n1285' },
];
const products = [
  { id: 'p1', name: 'منظم المطبخ المتكامل (دور واحد)', aliases: ['المطبقية'], site_names: ['منظم المطبخ المتكامل'], quick_reply_id: 'c2', assembled: false,
    facts: { variants: [{ label: 'مقاس 85', site_name: 'منظم المطبخ المتكامل', card_price: 1499 }] } },
];
const base = { facts: { delivery: 'من 24 إلى 48 ساعة', prompt_layout: 'v4', esc_style: 'v2' }, products, cards,
  siteRows: [{ name: 'منظم المطبخ المتكامل', variant: 'مقاس 85 عرض', price: 1499, n: 4 }], stockNames: ['ب منتج', 'ا منتج'], ordersKnown: true };
const mk = (o) => ({ ...base, nowIso: '2026-11-23T20:00:00Z', linkedProductId: null, ad: null, orders: [], customerName: null, history: [], ...o });
const A = mk({ linkedProductId: 'p1', ad: { name: 'K' }, customerName: 'منى', history: [{ dir: 'in', body: 'بكام المنظم' }],
  orders: [{ order_uid: '19511', created_at: '2026-11-20T10:00:00Z', product_name: 'تيربو', total: 1285, status: 'Delivered' }] });
const B = mk({ nowIso: '2026-11-24T03:15:00Z', history: [{ dir: 'in', body: 'السلام عليكم' }, { dir: 'out', body: 'وعليكم السلام' }, { dir: 'in', type: 'voice', media: 'عايز التيربو' }] });

async function run(C, D) {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); };

  // 1 المفتاح
  const k1 = await C.cacheKey('gemini-3.8-flash', 'sys', 'static');
  ok('1أ نفس الدخل = نفس المفتاح (64 hex)', /^[0-9a-f]{64}$/.test(k1) && k1 === await C.cacheKey('gemini-3.8-flash', 'sys', 'static'));
  ok('1ب أي جزء مختلف = مفتاح تاني', k1 !== await C.cacheKey('gemini-2.5-flash', 'sys', 'static') && k1 !== await C.cacheKey('gemini-3.8-flash', 'sys2', 'static')
    && k1 !== await C.cacheKey('gemini-3.8-flash', 'sys', 'static2') && k1 !== await C.cacheKey('gemini-3.8-flash', 'sysstatic', ''));

  // 2 جسم الإنشاء
  const cb = C.cacheCreateBody('gemini-3.8-flash', 'SYS', 'STATIC', 'x'.repeat(200));
  ok('2 جسم الإنشاء', cb.model === 'models/gemini-3.8-flash' && cb.systemInstruction.parts[0].text === 'SYS' && cb.contents.length === 1
    && cb.contents[0].role === 'user' && cb.contents[0].parts[0].text === 'STATIC' && cb.ttl === C.CACHE_TTL_S + 's' && cb.displayName.length === 120 && C.CACHE_TTL_S === 1800);

  // 3 رد Gemini
  const m = C.parseCacheMeta({ name: 'cachedContents/abc_123-x', expireTime: '2026-11-23T20:30:00.123456Z', usageMetadata: { totalTokenCount: 8421 } });
  ok('3أ رد سليم', m && m.name === 'cachedContents/abc_123-x' && m.expireAt === '2026-11-23T20:30:00.123Z' && m.tokens === 8421);
  ok('3ب اسم/وقت غريب = null', C.parseCacheMeta({ name: 'cachedContents/../x', expireTime: '2026-11-23T20:30:00Z' }) === null
    && C.parseCacheMeta({ name: 'models/x', expireTime: '2026-11-23T20:30:00Z' }) === null && C.parseCacheMeta({ name: 'cachedContents/a', expireTime: 'بكرة' }) === null
    && C.parseCacheMeta(null) === null && C.parseCacheMeta({ name: 'cachedContents/a', expireTime: '2026-11-23T20:30:00Z' }).tokens === null);

  // 4 الخطة
  const R = (min) => ({ state: 'ready', name: 'cachedContents/abc', expire_at: new Date(NOW + min * MIN).toISOString(), tokens: 8000 });
  ok('4أ create', C.cachePlan({ state: 'create' }, NOW).action === 'create');
  ok('4ب بعيد = use · قريب = extend', C.cachePlan(R(25), NOW).action === 'use' && C.cachePlan(R(25), NOW).name === 'cachedContents/abc'
    && C.cachePlan(R(10), NOW).action === 'extend' && C.cachePlan(R(10), NOW).name === 'cachedContents/abc');
  ok('4ج أقل من دقيقتين/اسم غريب = skip', C.cachePlan(R(1), NOW).action === 'skip' && C.cachePlan({ ...R(25), name: 'x/y' }, NOW).action === 'skip');
  ok('4د حد تاني بيعمله/وقع/مفيش رد = skip بسببه', C.cachePlan({ state: 'creating' }, NOW).why === 'creating' && C.cachePlan({ state: 'failed' }, NOW).why === 'failed'
    && C.cachePlan(null, NOW).why === 'no_claim');

  // 5 جسم الطلب
  const gen = { temperature: 0 };
  const withC = C.generateBody('SYS', ['VAR'], gen, 'cachedContents/abc');
  ok('5أ بالكاش: من غير system_instruction · المتغيّر بس', withC.cachedContent === 'cachedContents/abc' && !('system_instruction' in withC) && !('systemInstruction' in withC)
    && withC.contents.length === 1 && withC.contents[0].parts[0].text === 'VAR' && withC.generationConfig === gen);
  const noC = C.generateBody('SYS', ['STATIC', 'VAR'], gen, null);
  ok('5ب من غير كاش: التعليمات + الجزئين', !('cachedContent' in noC) && noC.system_instruction.parts[0].text === 'SYS' && noC.contents.length === 2
    && noC.contents.every((c) => c.role === 'user') && noC.contents[0].parts[0].text === 'STATIC');
  const old = { system_instruction: { parts: [{ text: 'SYS' }] }, contents: [{ role: 'user', parts: [{ text: 'USER' }] }], generationConfig: gen };
  ok('5ج جزء واحد من غير كاش = الطلب القديم بالحرف', JSON.stringify(C.generateBody('SYS', ['USER'], gen)) === JSON.stringify(old));

  // 6 الرجوع من غير كاش
  ok('6 4xx بس (مش 429)', C.cacheRetryable(400) && C.cacheRetryable(403) && C.cacheRetryable(404) && !C.cacheRetryable(429) && !C.cacheRetryable(500) && !C.cacheRetryable(503) && !C.cacheRetryable(200));

  // 7 الشكل v4
  const sA = D.buildStaticUser(A), sB = D.buildStaticUser(B), vA = D.buildVariableUser(A), vB = D.buildVariableUser(B);
  ok('7أ الثابت + المتغيّر = v2 بالحرف · v4 = v2', D.buildUserPrompt(A, 'v2') === sA + '\n\n' + vA && D.buildUserPrompt(B, 'v2') === sB + '\n\n' + vB
    && D.buildUserPrompt(A, 'v4') === D.buildUserPrompt(A, 'v2') && D.layoutOf('v4') === 'v4' && D.layoutOf('v5') === 'v1');
  ok('7ب الثابت نفس البايتات لمحادثتين', sA === sB);
  ok('7ج الثابت مفيهوش المحادثة ولا الوقت ولا الأسعار ولا علامة الإعلان', !/الوقت دلوقتي|أسعار الموقع|← ده منتج الإعلان|بكام المنظم|19511|منى|# الرسايل/.test(sA)
    && sA.includes('# كروت المنتجات') && sA.includes('خلص من المخزون') && sA.includes('# المخزون') && sA.startsWith('# معلومات المتجر'));
  ok('7د المتغيّر فيه كل ده', vA.startsWith('# أسعار الموقع') && /الوقت دلوقتي/.test(vA) && /بكام المنظم/.test(vA) && /19511/.test(vA) && /منى/.test(vA)
    && /العميل جه من إعلان عن: منظم المطبخ المتكامل \(دور واحد\)/.test(vA) && !vA.includes('# كروت المنتجات') && /عايز التيربو/.test(vB));
  ok('7هـ إعدادات الشكل مش في الـprompt', !/prompt_layout|esc_style|v4/.test(sA));
  return fails;
}

let bad = 0;
const C0 = await load('c'), D0 = await load('d');
const base0 = await run(C0, D0);
if (base0.length) { bad++; console.log('✗ وقع: ' + base0.join(' | ')); } else console.log('✓ 7 فحوص عدّوا (18 شرط)');

const CALS = [
  ['(أ) المفتاح من غير التعليمات', 'c', (s) => s.replace('String(model) + "\\u0000" + String(system) + "\\u0000" + String(staticUser)', 'String(model) + "\\u0000" + String(staticUser)'), '1ب'],
  ['(ب) system_instruction مع الكاش', 'c', (s) => s.replace('? { cachedContent: cacheName, contents, generationConfig }', '? { cachedContent: cacheName, system_instruction: { parts: [{ text: system }] }, contents, generationConfig }'), '5أ'],
  ['(ج) 429 بيرجع من غير كاش', 'c', (s) => s.replace('return status >= 400 && status < 500 && status !== 429;', 'return status >= 400 && status < 500;'), '6'],
  ['(د) مفيش مد', 'c', (s) => s.replace('return { action: exp - nowMs < CACHE_EXTEND_BELOW_MS ? "extend" : "use", name };', 'return { action: "use", name };'), '4ب'],
  ['(هـ) الوقت في الجزء الثابت', 'd', (s) => s.replace('  const out = staticHead(ctx);\n  allCardsBlock(ctx, out);\n  return out.join("\\n");', '  const out = staticHead(ctx);\n  allCardsBlock(ctx, out);\n  out.push("- الوقت دلوقتي: " + ctx.nowIso);\n  return out.join("\\n");'), '7ب'],
  ['(و) أي اسم كاش مقبول', 'c', (s) => s.replace('const NAME_RE = /^cachedContents\\/[A-Za-z0-9_-]{1,200}$/;', 'const NAME_RE = /./;'), '3ب'],
];
for (const [name, k, mut, expect] of CALS) {
  let f;
  try {
    const m = await load(k, mut);
    f = await run(k === 'c' ? m : C0, k === 'd' ? m : D0);
  } catch (e) { bad++; console.log('✗ معايرة ' + name + ': ' + e.message); continue; }
  if (f.some((x) => x.startsWith(expect))) console.log('✓ معايرة ' + name + ' — اتمسكت (' + expect + ')');
  else { bad++; console.log('✗ معايرة ' + name + ' — الفحص ' + expect + ' ماوقعش (وقع: ' + (f.join(' | ') || 'ولا حاجة') + ')'); }
}
console.log(bad ? '\n✗ ' + bad + ' مشكلة' : '\n✓ كله تمام (7 فحوص + 6 معايرات)');
process.exit(bad ? 1 : 0);
