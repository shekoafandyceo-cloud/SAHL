// حالة الأوردرات المشتركة — المالك الوحيد للكتابة
//
// تحت ES modules الـbinding المستورد **للقراءة بس**: أي موديول يقدر يقرا
// `all` عادي (live bindings)، إنما `all = [...]` من موديول تاني بترمي
// TypeError وقت الربط، والخطأ ده بيقتل جراف الموديولات كله قبل ما ينفّذ
// سطر واحد. فكل حالة هنا ليها setter، وأي كاتب من بره بينادي الـsetter.
// القراءة سايبة زي ما هي.
//
// الحالة اللي كاتبها الوحيد موديول واحد مابتيجيش هنا — قاعدة في الموديول
// بتاعها (intNotesTimer و detailHistory في detail.js، mergeableCustomers في
// merge.js، VFCASH_NUMBER و inboxVerified في billing-summary.js).

export var all = [], fil = [], cur = 1, PS = 50, sel = null, stm = null;

export var allLoaded = false;   // هل تم تحميل كل الأوردرات للذاكرة؟ (lazy — للماليات/الإحصائيات بس)

export var phoneCounts = {};    // map: phone => إجمالي أوردرات العميل ده

export var realtimeChannel = null;  // قناة الريل-تايم — بتتصفّر في forceSuspendLogout

export var pendingBostaByPhone = {};  // فهرس الدمج — loadMergeCandidates بتملاه

export var selectedIds = new Set();   // بتتعدّل بـ.add/.clear — مش بيتعاد إسنادها

// ===== orders-page period scope (بيتحكّم في الجدول وكروت الإحصاء فوق مع بعض) =====
export var ordersPeriod = { type: 'all', from: null, to: null };

// ===== Server-side orders pagination =====
export var totalCount = 0;      // إجمالي الأوردرات المطابقة للفلتر (من عدّاد السيرفر)

export var ordersLoading = false;


// ── الـsetters — الطريقة الوحيدة للكتابة من بره الموديول ده ──────────
// الأسماء الأربعة الأولى قديمة ومستخدمة في auth.js و tour.js و main.js،
// فمتغيّرتش أسماؤها.
export function ordersSetAll(v){ all = v || []; }

export function ordersSetSelected(v){ sel = v; }

export function ordersSetPageSize(v){ PS = v; }

export function realtimeSetChannel(v){ realtimeChannel = v; }

export function ordersSetFiltered(v){ fil = v || []; }

export function ordersSetPage(v){ cur = v; }

export function ordersSetSearchTimer(v){ stm = v; }

export function ordersSetAllLoaded(v){ allLoaded = !!v; }

export function ordersSetPhoneCounts(v){ phoneCounts = v || {}; }

export function ordersSetPendingBosta(v){ pendingBostaByPhone = v || {}; }

export function ordersSetTotalCount(v){ totalCount = v || 0; }

export function ordersSetLoading(v){ ordersLoading = !!v; }

// ملحوظة: مفيش setter لـ`ordersPeriod` — `setOrdersPeriod` بتعدّل خصائصه
// (`ordersPeriod.type=…`) وماتعيدش إسناده، والتعديل على الكائن مسموح
// على binding مستورد. لو احتاج يتعاد إسناده يوم، لازم setter هنا.
