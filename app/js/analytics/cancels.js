// تقرير الإلغاء — تاب «🚫 الإلغاءات» في صفحة الأداء (v90 · 28 نوفمبر 2026 — طلب المالك)
//
// «جدول صغير يوريك الإلغاءات حسب السبب لكل منتج وكل أسبوع» + «⚠️ إلغاء مبكر».
// الداتا كلها من RPC واحد `cancel_report` (أدمن بس · قراية بس — migration `cancel_report`):
// التصنيف وعلامة «مبكر» بيتحسبوا على السيرفر، وهنا عرض وتجميع بس.
//
// التاب والحاوية بيتعملوا ديناميك (`initCancelsTab`) — `index.html` والـ9 صفحات ماتلمسوش.
// 🔴 Egress (قاعدة v82): مفيش poll — طلب واحد عند فتح التاب، وبعدها كاش 5 دقايق أو زرار ↻.

import { $id, esc } from '../core/dom.js';
import { num } from '../core/format.js';
import { sb } from '../core/supabase.js';
import { tourActive } from '../tour/tour.js';
import { cancelReasonLabel } from '../orders/cancel-reason.js';
import { isAdmin } from '../orders/guards.js';

var CX_TTL_MS = 5 * 60 * 1000;
var CX_WEEKS = 4;

// أسامي الأكواد اللي مش في قايمة الأزرار
var CX_EXTRA = {
  wa_customer: 'العميل لغى من زرار الواتساب',
  admin_bulk: 'إلغاء جماعي من الأدمن',
  free_text: 'كتابة حرة (قبل القايمة)',
  none: 'من غير سبب'
};
var CX_FLAG = {
  few_calls: '«مش بيرد» بأقل من 3 محاولات على يومين',
  no_contact: 'اتلغى في أول يوم من غير أي تواصل متسجّل'
};

var cx = { data: null, at: 0, loading: false, err: null, product: '', seq: 0 };

export function cxCodeLabel(code){
  return cancelReasonLabel(code) || CX_EXTRA[code] || code || '—';
}

// التاب + الحاوية — بيتنادى من initAnalyticsTabs قبل ربط الضغطات
export function initCancelsTab(){
  var page = $id('page-analytics');
  if (!page || $id('analytics-cancels-tab')) return;
  var tabs = page.querySelector('.stock-tabs');
  if (!tabs) return;
  var b = document.createElement('button');
  b.className = 'stock-tab';
  b.setAttribute('data-atab', 'cancels');
  b.textContent = '🚫 الإلغاءات';
  var emp = tabs.querySelector('[data-atab="employees"]');
  if (emp) tabs.insertBefore(b, emp); else tabs.appendChild(b);
  var box = document.createElement('div');
  box.id = 'analytics-cancels-tab';
  box.style.display = 'none';
  box.innerHTML = '<div class="cxr" id="cxr"><div class="ldg">افتح التبويب لعرض تقرير الإلغاء</div></div>';
  var after = $id('analytics-employees-tab');
  if (after && after.parentNode === page) page.insertBefore(box, after.nextSibling); else page.appendChild(box);
  box.addEventListener('click', function(e){
    var t = e.target;
    if (t && t.id === 'cxr-refresh') { renderCancelsReport(true); return; }
    if (t && t.id === 'cxr-retry') { renderCancelsReport(true); return; }
  });
  box.addEventListener('change', function(e){
    if (e.target && e.target.id === 'cxr-product') { cx.product = e.target.value || ''; cxPaint(); }
  });
}

export function renderCancelsReport(force){
  var root = $id('cxr');
  if (!root || !isAdmin()) return;
  if (tourActive) { root.innerHTML = '<div class="cxr-empty">التقرير بيتعرض على بياناتك الحقيقية بعد الجولة.</div>'; return; }
  var fresh = cx.data && (Date.now() - cx.at < CX_TTL_MS);
  if (fresh && !force) { cxPaint(); return; }
  if (cx.loading) return;
  cx.loading = true; cx.err = null;
  var seq = ++cx.seq;
  if (!cx.data) root.innerHTML = '<div class="ldg">جاري تحميل تقرير الإلغاء...</div>';
  else if ($id('cxr-refresh')) $id('cxr-refresh').classList.add('cxr-busy');
  sb.rpc('cancel_report', { p_weeks: CX_WEEKS }).then(function(r){
    if (seq !== cx.seq) return;
    cx.loading = false;
    if (r.error) {
      // السيرفر لسه مافيهوش الدالة (PGRST202 / 42883) = رسالة واضحة مش صفحة فاضية
      var missing = r.error.code === 'PGRST202' || r.error.code === '42883';
      cx.err = missing ? 'التقرير لسه مش متفعّل على السيرفر.' : ('حصل خطأ في تحميل التقرير: ' + (r.error.message || ''));
      cxPaint();
      return;
    }
    cx.data = r.data || { ok: false };
    cx.at = Date.now();
    cxPaint();
  }, function(){
    if (seq !== cx.seq) return;
    cx.loading = false; cx.err = 'تعذّر الاتصال — جرّب تاني.';
    cxPaint();
  });
}

function cxShortDate(iso){
  var p = String(iso || '').split('-');
  return p.length === 3 ? (Number(p[2]) + '/' + Number(p[1])) : '';
}

function cxWhen(iso){
  try {
    return new Date(iso).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ''; }
}

function cxPaint(){
  var root = $id('cxr');
  if (!root) return;
  if (cx.err && !cx.data) {
    root.innerHTML = '<div class="cxr-empty">' + esc(cx.err) + '<div><button type="button" class="cxr-btn" id="cxr-retry">↻ جرّب تاني</button></div></div>';
    return;
  }
  var d = cx.data;
  if (!d || !d.ok) { root.innerHTML = '<div class="cxr-empty">التقرير ده للأدمن بس.</div>'; return; }

  var weeks = Array.isArray(d.weeks) ? d.weeks : [];
  var rows = Array.isArray(d.rows) ? d.rows : [];
  var early = Array.isArray(d.early) ? d.early : [];
  var notes = Array.isArray(d.notes) ? d.notes : [];
  var by = Array.isArray(d.by) ? d.by : [];

  // المنتجات بالعدد (للفلتر)
  var prod = {};
  rows.forEach(function(r){ prod[r.product] = (prod[r.product] || 0) + (r.n || 0); });
  var prodList = Object.keys(prod).sort(function(a, b){ return prod[b] - prod[a]; });
  if (cx.product && !prod[cx.product]) cx.product = '';
  var pf = cx.product;
  var inP = function(x){ return !pf || x.product === pf; };

  // السبب × الأسبوع
  var widx = {};
  weeks.forEach(function(w, i){ widx[w.start] = i; });
  var byCode = {}, colTot = weeks.map(function(){ return 0; }), total = 0, earlyTotal = 0;
  rows.filter(inP).forEach(function(r){
    var i = widx[r.w];
    if (i == null) return;
    if (!byCode[r.code]) byCode[r.code] = { code: r.code, w: weeks.map(function(){ return 0; }), n: 0, early: 0 };
    byCode[r.code].w[i] += r.n || 0;
    byCode[r.code].n += r.n || 0;
    byCode[r.code].early += r.early || 0;
    colTot[i] += r.n || 0; total += r.n || 0; earlyTotal += r.early || 0;
  });
  var list = Object.keys(byCode).map(function(k){ return byCode[k]; }).sort(function(a, b){ return b.n - a.n; });
  var freeN = byCode.free_text ? byCode.free_text.n : 0;

  var h = '';
  h += '<div class="cxr-bar">'
    + '<div class="cxr-ttl">🚫 الإلغاءات حسب السبب <span class="cxr-sub">آخر ' + num(weeks.length) + ' أسابيع · الأسبوع من السبت للجمعة · بتاريخ الإلغاء</span></div>'
    + '<div class="cxr-ctl">'
    + '<select class="fsel" id="cxr-product" aria-label="المنتج"><option value="">كل المنتجات (' + num(rows.reduce(function(s, r){ return s + (r.n || 0); }, 0)) + ')</option>'
    + prodList.map(function(p){ return '<option value="' + esc(p) + '"' + (p === pf ? ' selected' : '') + '>' + esc(p) + ' (' + num(prod[p]) + ')</option>'; }).join('')
    + '</select>'
    + '<button type="button" class="cxr-btn" id="cxr-refresh" title="تحديث">↻</button>'
    + '</div></div>';

  h += '<div class="cxr-chips">'
    + '<div class="cxr-chip"><span>إجمالي الإلغاءات</span><b>' + num(total) + '</b></div>'
    + '<div class="cxr-chip' + (earlyTotal ? ' warn' : '') + '"><span>⚠️ إلغاء مبكر</span><b>' + num(earlyTotal) + '</b></div>'
    + '<div class="cxr-chip"><span>كتابة حرة (قبل القايمة)</span><b>' + num(freeN) + '</b></div>'
    + '</div>';

  if (cx.err) h += '<div class="cxr-note-line">⚠️ ' + esc(cx.err) + ' — المعروض آخر نسخة اتحمّلت.</div>';

  if (!list.length) {
    h += '<div class="cxr-empty">مفيش إلغاءات في المدة دي' + (pf ? ' للمنتج ده' : '') + '.</div>';
  } else {
    h += '<div class="twrap"><div class="thscroll"><table class="cxr-tbl"><thead><tr><th>السبب</th>'
      + weeks.map(function(w, i){
          // الموبايل بيعرض بداية الأسبوع بس (`.cxr-ws`) — 7 أعمدة مابتساعش بالمدى كله
          var last = i === weeks.length - 1;
          return '<th title="' + esc(cxShortDate(w.start) + ' – ' + cxShortDate(w.end)) + '"><span class="cxr-wf">'
            + (last ? 'الأسبوع ده' : esc(cxShortDate(w.start) + ' – ' + cxShortDate(w.end))) + '</span><span class="cxr-ws">'
            + (last ? 'الحالي' : esc(cxShortDate(w.start))) + '</span></th>';
        }).join('')
      + '<th>الإجمالي</th><th>النسبة</th></tr></thead><tbody>';
    list.forEach(function(r){
      h += '<tr><td class="nm">' + esc(cxCodeLabel(r.code))
        + (r.early ? ' <span class="cxr-early" title="إلغاء مبكر">⚠️ ' + num(r.early) + '</span>' : '') + '</td>'
        + r.w.map(function(n){ return '<td class="mn">' + (n ? num(n) : '<span class="cxr-z">—</span>') + '</td>'; }).join('')
        + '<td class="mn"><b>' + num(r.n) + '</b></td>'
        + '<td class="mn">' + (total ? Math.round(r.n / total * 100) + '%' : '—') + '</td></tr>';
    });
    h += '<tr class="cxr-tot"><td class="nm">الإجمالي</td>'
      + colTot.map(function(n){ return '<td class="mn">' + num(n) + '</td>'; }).join('')
      + '<td class="mn"><b>' + num(total) + '</b></td><td class="mn"></td></tr>';
    h += '</tbody></table></div></div>';
  }

  // ⚠️ إلغاء مبكر
  var ev = early.filter(inP);
  h += '<div class="cxr-sec"><div class="cxr-sec-t">⚠️ إلغاء مبكر <span class="cxr-sub">(' + num(ev.length) + ') — اتلغى من غير محاولات كفاية. مفيش قفل على الموظف، ده للمتابعة بس.</span></div>';
  if (!ev.length) {
    h += '<div class="cxr-empty sm">مفيش إلغاء مبكر' + (pf ? ' للمنتج ده' : '') + '. العلامة بتتحسب على الإلغاءات اللي سببها من القايمة الجديدة بس.</div>';
  } else {
    h += '<div class="cxr-list">' + ev.map(function(e){
      return '<div class="cxr-item"><div class="cxr-item-h"><bdi><b>#' + esc(e.uid) + '</b></bdi> · <bdi>' + esc(e.product) + '</bdi></div>'
        + '<div class="cxr-item-b">' + esc(cxCodeLabel(e.code)) + ' — <span class="cxr-why">' + esc(CX_FLAG[e.flag] || e.flag) + '</span></div>'
        + '<div class="cxr-item-f">لغاه <bdi>' + esc(e.by || '—') + '</bdi> · <bdi>' + esc(cxWhen(e.at)) + '</bdi> · محاولات متسجّلة: ' + num(e.calls || 0) + '</div></div>';
    }).join('') + '</div>';
  }
  h += '</div>';

  // مين لغى (على كل المنتجات — السيرفر مجمّعها من غير منتج)
  if (by.length && !pf) {
    h += '<div class="cxr-sec"><div class="cxr-sec-t">👤 مين لغى</div><div class="twrap"><div class="thscroll"><table class="cxr-tbl"><thead><tr><th>الاسم</th><th>إلغاءات</th><th>مبكر</th></tr></thead><tbody>'
      + by.map(function(b){
          return '<tr><td class="nm"><bdi>' + esc(b.by || '—') + '</bdi></td><td class="mn">' + num(b.n || 0) + '</td><td class="mn">' + (b.early ? '<span class="cxr-early">⚠️ ' + num(b.early) + '</span>' : '<span class="cxr-z">—</span>') + '</td></tr>';
        }).join('')
      + '</tbody></table></div></div></div>';
  }

  // الأسباب المكتوبة (سبب تاني + الكتابة الحرة) — مطوية
  var nv = notes.filter(inP);
  if (nv.length) {
    h += '<details class="cxr-sec cxr-notes"><summary>📝 الأسباب المكتوبة بالإيد <span class="cxr-sub">(آخر ' + num(nv.length) + ' — «سبب تاني» والكتابة الحرة القديمة)</span></summary><div class="cxr-list">'
      + nv.map(function(n){
          return '<div class="cxr-item"><div class="cxr-item-h"><bdi><b>#' + esc(n.uid) + '</b></bdi> · <bdi>' + esc(n.product) + '</bdi></div>'
            + '<div class="cxr-item-b">' + esc(n.text || '—') + '</div>'
            + '<div class="cxr-item-f"><bdi>' + esc(n.by || '—') + '</bdi> · <bdi>' + esc(cxWhen(n.at)) + '</bdi></div></div>';
        }).join('')
      + '</div></details>';
  }

  root.innerHTML = h;
}
