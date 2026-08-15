// نافذة تفاصيل الأوردر

import { parseProductItems } from '../analytics/product-match.js';
import { currentTenantId } from '../auth/auth.js';
import { walletStateCache } from '../billing/billing.js';
import { CANCELLED_STATUSES, CR, DELIVERED_STATUSES, STATUS_OPTIONS, statusClass, statusIn, statusLabel } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { firstName, fmt, fmtD, fmtDT, money, normalizePhone, num, toLatinDigits } from '../core/format.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';
import { showPage } from '../main.js';
import { stockProducts, stockSetProducts } from '../stock/stock.js';
import { tourActive } from '../tour/tour.js';
import { attachCopyHandlers, copyable, copyTextToClipboard } from '../ui/clipboard.js';
import { askCancelReason } from './cancel-reason.js';
import { orderInventoryCost, orderInventoryCostSource } from './costs.js';
import { isAdmin } from './guards.js';
import { addCallAttempt, deleteCallAttempt, doUpdate, saveInternalNotes } from './mutations.js';
import { doFilter } from './orders.js';
import { addEmptyProductRow, renderProductsEditor, saveProducts } from './products-editor.js';
import { all, cur, fil, ordersSetSelected, sel } from './state.js';
import { manualShipFlow, shipControlsHtml, wireShipControls } from './ship.js';
import { parseStatusLog, RANK_GOOD, RANK_MID, renderTable } from './table.js';

export var intNotesTimer=null;

export var detailHistory=null;        // ملخّص طلبات العميل لشاشة التفاصيل (من كويري بالتليفون)

// حقل قابل للتعديل في نافذة التفاصيل (موبايل/عنوان): نسخ + زرار تعديل
export function fieldEditable(val,label,field){
  return '<span class="fld-wrap" data-field="'+field+'">'
    + copyable(val,label)
    + '<button class="fld-edit-btn" data-field="'+field+'" title="تعديل '+esc(label||'')+'">✏️</button>'
    + '</span>';
}

// تحديث قيمة حقل عبر sel + الذاكرة (all + fil) بعد الحفظ
export function patchOrderField(id,patch){
  var k;
  if(sel && sel.id===id){ for(k in patch){ sel[k]=patch[k]; } }
  if(all){ for(var i=0;i<all.length;i++){ if(all[i].id===id){ for(k in patch){ all[i][k]=patch[k]; } break; } } }
  if(fil){ for(var j=0;j<fil.length;j++){ if(fil[j].id===id){ for(k in patch){ fil[j][k]=patch[k]; } break; } } }
}

// ربط أزرار تعديل الموبايل/العنوان داخل نافذة التفاصيل
export function attachFieldEditors(){
  if(!$id('dcnt'))return;
  $id('dcnt').querySelectorAll('.fld-edit-btn').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      if(!sel)return;
      var field=btn.getAttribute('data-field');
      var wrap=btn.parentNode;
      var cur=(sel[field]==null?'':String(sel[field]));
      wrap.innerHTML='<input type="text" class="fld-edit-input" value="'+cur.replace(/"/g,'&quot;')+'">'
        +'<button class="fld-edit-save">حفظ</button>'
        +'<button class="fld-edit-cancel">إلغاء</button>'
        +'<span class="fld-edit-status"></span>';
      var input=wrap.querySelector('.fld-edit-input');
      input.focus(); try{input.setSelectionRange(input.value.length,input.value.length);}catch(e2){ swallow('attachFieldEditors/input.setSelectionRange', e2); }
      wrap.querySelector('.fld-edit-cancel').addEventListener('click',function(){ renderDetail(); });
      function save(){
        // التقاط الأوردر وقت الضغط — sel الحي ممكن يتبدل لأوردر تاني أو
        // يتقفل (null) قبل رد السيرفر: الباتش المحلي كان بيقع على B أو يرمي
        var ord=sel;
        if(!ord)return;
        var val=input.value.trim();
        if(field==='phone' && val){
          var digits=toLatinDigits(val).replace(/[\s-]/g,'');
          if(!/^[0-9+]{6,}$/.test(digits)){ toast('رقم الموبايل مش مظبوط','er'); return; }
          val=digits;
        }
        if(!sb||!currentTenantId){ toast('غير متصل بالسيرفر','er'); return; }
        var stt=wrap.querySelector('.fld-edit-status'); if(stt)stt.textContent='جاري الحفظ...';
        var upd={}; upd[field]=val||null;
        sb.from('orders').update(upd).eq('id',ord.id).eq('tenant_id',currentTenantId).then(function(r){
          if(r.error){ if(stt)stt.textContent=''; toast('خطأ في الحفظ: '+r.error.message,'er'); return; }
          patchOrderField(ord.id,upd);
          toast('تم تعديل '+(field==='phone'?'الموبايل':(field==='address'?'العنوان':'البيانات'))+' ✓','ok');
          try{renderTable();}catch(e3){ swallow('save/renderTable', e3); }
          if(sel===ord) renderDetail();
        });
      }
      wrap.querySelector('.fld-edit-save').addEventListener('click',save);
      input.addEventListener('keydown',function(ev){
        if(ev.key==='Enter'){ ev.preventDefault(); save(); }
        else if(ev.key==='Escape'){ renderDetail(); }
      });
    });
  });
}

export function buildWaUrl(o){
  var phone=normalizePhone(o.phone);
  if(!phone)return null;
  var fn=firstName(o.customer_name);
  var msg='استاذة '+fn+' صباح الخير يافندم .. حاولنا نتصل بحضرتك بخصوص الاوردر بس مكانش في رد .. حضرتك تحبي نشحن الاوردر يافندم ؟\n\nالاوردر : '+(o.product_name||'');
  return 'https://web.whatsapp.com/send?phone=20'+phone+'&text='+encodeURIComponent(msg);
}

export function openDetail(id){
  // Guard: when the wallet is depleted, sensitive data is locked across the app.
  if(walletStateCache && walletStateCache.is_depleted && !tourActive){
    toast('بياناتك مقفلة لحد ما تشحن المحفظة','er');
    try{ showPage('billing'); }catch(e){ swallow('openDetail/showPage', e); }
    return;
  }
  if(tourActive){
    // الجولة: الأوردر موجود في بيانات الديمو في الذاكرة
    ordersSetSelected(null);for(var i=0;i<all.length;i++){if(all[i].id===id){ordersSetSelected(all[i]);break;}}
    if(!sel)return;
    detailHistory=computeHistoryFromAll(sel);
    renderDetail();
    return;
  }
  if(!sb||!currentTenantId)return;
  // الجدول عنده أعمدة محدودة بس → نجيب الأوردر كامل من السيرفر بالـ id
  ordersSetSelected(null); detailHistory=null;
  detailReqId = id;   // فتح A بعدين B بسرعة: رد A القديم مايرندرش فوق B
  $id('dtit').textContent='جاري التحميل...';
  $id('dcnt').innerHTML='<div class="ldg"><div class="spin"></div>جاري تحميل تفاصيل الطلب...</div>';
  $id('ovl').classList.add('open');
  sb.from('orders').select('*').eq('id',id).eq('tenant_id',currentTenantId).single().then(function(r){
    if(detailReqId !== id) return;   // المستخدم فتح أوردر تاني — الرد ده بقى قديم
    // النفاد وصل والطلب في السكة — مانرندرش بيانات على قفل شغّال
    if(walletStateCache && walletStateCache.is_depleted && !tourActive){ $id('ovl').classList.remove('open'); return; }
    if(r.error || !r.data){ toast('حصلت مشكلة في تحميل تفاصيل الطلب','er'); $id('ovl').classList.remove('open'); return; }
    ordersSetSelected(r.data);
    loadDetailHistory(sel, function(){ if(detailReqId === id) renderDetail(); });
  });
}

// آخر أوردر متطلوب لشاشة التفاصيل — حارس الردود القديمة
var detailReqId = null;

// إبطال الرد المعلّق عند قفل النافذة — الإغلاق من غيره كان بيسيب رد فتح
// قديم (الأوردر أو الـhistory) يرجع بعد القفل ويفتح الـoverlay تاني
export function detailAbort(){ detailReqId = null; }

// ملخّص طلبات العميل من الذاكرة (للجولة)
export function computeHistoryFromAll(o){
  var p=normalizePhone(o.phone);
  if(!p) return {count:1, delivered:0, cancelled:0};
  var same=all.filter(function(x){return normalizePhone(x.phone)===p;});
  var others=same.filter(function(x){return x.id!==o.id;});
  return { count: same.length,
    delivered: others.filter(function(x){return statusIn(x.status,DELIVERED_STATUSES);}).length,
    cancelled: others.filter(function(x){return statusIn(x.status,CANCELLED_STATUSES);}).length };
}

// ملخّص طلبات العميل من السيرفر بالتليفون (للبانر في شاشة التفاصيل)
export function loadDetailHistory(o, cb){
  detailHistory=null;
  if(!sb||!currentTenantId||!o.phone){ cb&&cb(); return; }
  var forId=o.id;
  sb.from('orders').select('id,status').eq('tenant_id',currentTenantId).eq('phone',o.phone).then(function(r){
    // رد تاريخ قديم مايكتبش فوق تاريخ الأوردر المفتوح حالياً
    if(!sel || sel.id!==forId){ cb&&cb(); return; }
    if(!r.error && r.data){
      var others=r.data.filter(function(x){return x.id!==o.id;});
      detailHistory={ count: r.data.length,
        delivered: others.filter(function(x){return statusIn(x.status,DELIVERED_STATUSES);}).length,
        cancelled: others.filter(function(x){return statusIn(x.status,CANCELLED_STATUSES);}).length };
    }
    cb&&cb();
  });
}

export function renderDetail(){
  var o=sel;
  if(!o)return;
  $id('dtit').textContent='طلب #'+(o.order_uid||o.tracking_no||o.id.slice(0,8));
  function dr(k,v){return'<div class="drow"><span class="dkey">'+k+'</span>'+v+'</div>';}

  var calls=Array.isArray(o.call_attempts)?o.call_attempts:[];
  var callsHtml='';
  if(calls.length){
    callsHtml='<div class="calls-list">';
    calls.forEach(function(c,idx){
      callsHtml+='<div class="call-item">'
        +'<span class="call-time">'+esc(c.time||'—')+'</span>'
        +'<div class="call-meta">'
        +'<span class="call-res '+String(c.result||'no_answer').replace(/[^a-z0-9_-]/g,'')+'">'+esc(CR[c.result]||c.result||'—')+'</span>'
        +(c.note?'<span style="color:var(--txt)">— '+esc(c.note)+'</span>':'')
        +(c.by?'<span class="log-by">👤 '+esc(c.by)+'</span>':'')
        +'<button class="call-del" data-idx="'+idx+'">✕</button>'
        +'</div></div>';
    });
    callsHtml+='</div>';
  }else{
    callsHtml='<div class="calls-empty">لسه مفيش محاولات اتصال متسجّلة</div>';
  }

  var cxBanner='';
  if(o.cancel_requested_at && !o.cancel_resolved_at){
    cxBanner='<div class="cx-banner">'
      +'<div class="cx-banner-txt">'
      +'<b>\u26A0 العميل طلب إلغاء الأوردر</b><br>'
      +'<span>الأوردر ما اتغيّرش ولا اتلغت بوليصة. كلّم العميل وقرّر — ولما تخلص دوس "تم التعامل".</span><br>'
      +'<span class="cx-banner-date">وقت الطلب: '+esc(fmtD(o.cancel_requested_at))+'</span>'
      +'</div>'
      +'<button class="cx-resolve-btn" id="cx-resolve">\u2713 تم التعامل</button>'
      +'</div>';
  } else if(o.cancel_requested_at && o.cancel_resolved_at){
    cxBanner='<div class="cx-banner cx-done">'
      +'<div class="cx-banner-txt"><b>\u2713 طلب إلغاء — تم التعامل معاه</b><br>'
      +'<span class="cx-banner-date">طلب: '+esc(fmtD(o.cancel_requested_at))+' \u00B7 اتقفل: '+esc(fmtD(o.cancel_resolved_at))+'</span></div>'
      +'</div>';
  }

  var waUrl=buildWaUrl(o);
  var hasCustomerNote = o.customer_notes && o.customer_notes.trim();

  // Returning customer detection (من كويري بالتليفون — مش من الذاكرة)
  var custCount=detailHistory?detailHistory.count:1;
  var vipBanner='';
  if(custCount>1){
    var prevDelivered=detailHistory?detailHistory.delivered:0;
    var prevCancelled=detailHistory?detailHistory.cancelled:0;
    vipBanner='<div class="vip-banner">'
      +'<div class="vip-banner-icon">⭐</div>'
      +'<div class="vip-banner-text">'
      +'<div class="vip-banner-title">عميل متكرر — مش أول طلب</div>'
      +'<div class="vip-banner-sub">طلب من قبل '+(custCount-1)+' مرة'
      +(prevDelivered>0?' · <span style="color:var(--teal)">'+prevDelivered+' تم تسليمها</span>':'')
      +(prevCancelled>0?' · <span style="color:var(--red)">'+prevCancelled+' ألغاها</span>':'')
      +'</div>'
      +'</div>'
      +'<button class="vip-show-btn" id="vip-show">إظهار التفاصيل</button>'
      +'<div class="vip-banner-count">×'+custCount+'</div>'
      +'</div>';
  }

  $id('dcnt').innerHTML=
    // WhatsApp button at top
    (waUrl?'<a class="wa-btn" id="wa-btn" href="'+esc(waUrl)+'" target="_blank" rel="noopener"><span class="wa-ico">📩</span> إرسال رسالة واتساب للعميل</a>':'')
    +cxBanner
    +vipBanner

    +'<div class="dsec" data-tone="blue"><div class="dstt"><span class="dstt-ico">\uD83D\uDC64</span>بيانات العميل</div>'
    +dr('الاسم',copyable(o.customer_name,'الاسم'))
    +(function(){
       if(o.customer_ranking===null||o.customer_ranking===undefined||o.customer_ranking==='')return '';
       var _rk=Number(o.customer_ranking); if(isNaN(_rk))return '';
       var _c=_rk>=RANK_GOOD?'rk-good':(_rk>=RANK_MID?'rk-mid':'rk-bad');
       var _l=_rk>=RANK_GOOD?'جامد':(_rk>=RANK_MID?'متوسط':'زبالة');
       return dr('سمعة العميل (شركة الشحن)','<span class="rk-badge '+_c+'" style="margin:0">'+_l+'</span> <span class="dval" style="font-family:\'JetBrains Mono\',monospace">'+_rk.toFixed(1)+'%</span>');
     })()
    +dr('الموبايل الأساسي',fieldEditable(o.phone,'الموبايل','phone'))
    +dr('الموبايل الإضافي',copyable(o.alt_phone,'الموبايل'))
    +dr('المدينة','<span class="dval ar">'+esc(fmt(o.city))+'</span>')
    +dr('العنوان',fieldEditable(o.address,'العنوان','address'))
    +'</div>'

    +'<div class="dsec" data-tone="purple"><div class="dstt"><span class="dstt-ico">\uD83E\uDDFE</span>بيانات الطلب</div>'
    +dr('رقم الطلب','<span class="dval">'+esc(fmt(o.order_uid))+'</span>')
    +dr('رقم التتبع','<span class="dval">'+(o.tracking_no?esc(o.tracking_no):'<span style="color:var(--muted);font-style:italic">في انتظار شركة الشحن</span>')+'</span>')
    +'</div>'

    +'<div class="dsec" data-tone="orange"><div class="dstt"><span class="dstt-ico">\uD83D\uDCE6</span>المنتجات</div>'
    +((o['var']&&String(o['var']).trim())?'<div class="drow"><span class="dkey">اللون / المقاس</span>'+copyable(String(o['var']),'اللون/المقاس')+'</div>':'')
    +'<div class="prod-list" id="prod-list"></div>'
    +'<button class="prod-add-btn" id="prod-add">+ إضافة منتج آخر</button>'
    +'<div class="save-row" style="margin-top:10px"><button class="save-btn" id="save-prod">💾 حفظ المنتجات</button><button class="copy-prod-btn" id="copy-prod">📋 نسخ كل المنتجات</button><span class="save-status" id="prod-status"></span></div>'
    +'</div>'

    +'<div class="dsec" data-tone="sky"><div class="dstt"><span class="dstt-ico">\uD83E\uDDEE</span>تفاصيل إضافية</div>'
    +dr('المبلغ','<span class="dval" style="color:var(--txt);font-weight:600">'+(o.total_cost?num(o.total_cost)+' ج.م':'—')+'</span>')
    +(isAdmin()?dr('تكلفة البضاعة','<span class="dval" style="color:var(--ora);font-weight:800">'+money(orderInventoryCost(o))+'</span>'):'')
    +(isAdmin()?dr('مصدر التكلفة','<span class="dval ar">'+esc(orderInventoryCostSource(o))+'</span>'):'')
    +dr('الدفع','<span class="dval">'+esc(fmt(o.payment_stage))+'</span>')
    +dr('المنصة','<span class="dval">'+esc(fmt(o.platform))+'</span>')
    +dr('الحملة','<span class="dval" style="font-size:.76rem;direction:ltr">'+esc(fmt(o.campaign_name))+'</span>')
    +dr('تاريخ الإنشاء','<span class="dval">'+fmtDT(o.created_at)+'</span>')
    +'</div>'

    // CUSTOMER NOTES (from webhook) — highlighted yellow when present
    +'<div class="dsec" data-tone="orange"><div class="dstt"><span class="dstt-ico">📌</span>ملاحظات العميل (من الويب هوك)</div>'
    +'<div class="notes-box'+(hasCustomerNote?' has-content':' notes-empty')+'">'+(hasCustomerNote?esc(o.customer_notes):'مفيش ملاحظات من العميل')+'</div>'
    +'</div>'

    // INTERNAL NOTES (between employees) — editable
    +'<div class="dsec" data-tone="sky"><div class="dstt"><span class="dstt-ico">💬</span>ملاحظات داخلية بين الموظفين</div>'
    +'<textarea class="int-notes" id="int-notes" placeholder="اكتب أي ملاحظات للموظفين الآخرين عن هذا الطلب...">'+esc(o.internal_notes||'')+'</textarea>'
    +'<div class="save-row"><button class="save-btn" id="save-notes">💾 حفظ الملاحظات</button><span class="save-status" id="save-status"></span></div>'
    +'</div>'

    +'<div class="dsec" data-tone="green"><div class="dstt"><span class="dstt-ico">📞</span>محاولات الاتصال ('+calls.length+'/9)</div>'
    +callsHtml
    +'<div class="add-call">'
    +'<select id="ca-res">'
    +'<option value="no_answer">لم يرد</option>'
    +'<option value="busy">مشغول</option>'
    +'<option value="refused">رفض</option>'
    +'<option value="confirmed">أكد</option>'
    +'<option value="callback">يعاود الاتصال</option>'
    +'</select>'
    +'<input type="text" id="ca-note" placeholder="ملاحظة (اختياري)">'
    +'<button id="ca-add">+ إضافة (الآن)</button>'
    +'</div></div>'

    +(function(){
      var slog=parseStatusLog(o.status_log);
      if(!slog.length)return '';
      // Build a chronologically-ordered copy so we can derive each entry's real
      // previous status from the entry before it (the stored "from" is often
      // a system marker like "البوت", not the actual prior status).
      // نسخة عميقة للعناصر مش بس المصفوفة: slice() بينسخ المصفوفة والعناصر
      // بتفضل نفس الـobjects بتوع o.status_log — الشرح (_realFrom) كان بيتكتب
      // عليها، وأول تغيير حالة بعدها كان بيبعته للداتابيز جوه السجل
      var chrono = slog.map(function(e){ return Object.assign({}, e); }).sort(function(a,b){
        return new Date(a.at||0) - new Date(b.at||0);
      });
      // System "from" markers that should NOT be displayed as the previous status.
      var SYS_FROM = ['البوت','Bosta API','السيستم','🤖','BOSTA AUTO'];
      function isSysFrom(v){
        if(!v) return true;
        for(var i=0;i<SYS_FROM.length;i++){ if(String(v).indexOf(SYS_FROM[i])>=0) return true; }
        return false;
      }
      // Compute real "from" for each entry = previous entry's "to".
      chrono.forEach(function(e,idx){
        if(idx>0){
          e._realFrom = chrono[idx-1].to;   // continuous chain
        } else {
          // First entry: keep its stored from unless it's a system marker.
          e._realFrom = isSysFrom(e.from) ? 'pending' : e.from;
        }
      });
      var rows='<div class="log-list">';
      chrono.slice().reverse().forEach(function(e){
        // Determine icon based on who made the change
        var byLabel = e.by || '—';
        var byIcon;
        var byClean = byLabel.replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}️ ]+/u, '').trim();
        if(byLabel.indexOf('السكانر') >= 0 || byLabel.indexOf('scanner') >= 0 || byLabel.indexOf('📷') >= 0){
          byIcon = '📷';
          byLabel = byClean || 'السكانر';
        } else if(byLabel.indexOf('واتساب') >= 0 || byLabel.indexOf('whatsapp') >= 0 || byLabel.indexOf('💬') >= 0){
          byIcon = '💬';
          byLabel = byClean || 'واتساب';
        } else if(byLabel.indexOf('البوت') >= 0 || byLabel.indexOf('Bosta API') >= 0 || byLabel.indexOf('السيستم') >= 0 || byLabel.indexOf('🤖') >= 0){
          byIcon = '⚙️';
          byLabel = byClean || 'السيستم';
        } else if(byLabel === 'manual' || byLabel === 'bulk'){
          byIcon = '👤';
        } else {
          byIcon = '👤';
        }
        var fromStatus = e._realFrom;
        rows+='<div class="log-item">'
          +'<span class="badge '+statusClass(fromStatus)+'"><span class="bdot"></span>'+esc(statusLabel(fromStatus))+'</span>'
          +'<span class="log-arrow">←</span>'
          +'<span class="badge '+statusClass(e.to)+'"><span class="bdot"></span>'+esc(statusLabel(e.to))+'</span>'
          +(e.reason?'<span style="color:var(--red);font-size:.76rem">— '+esc(e.reason)+'</span>':'')
          +'<span class="log-by">'+byIcon+' '+esc(byLabel)+'</span>'
          +'<span class="log-time">'+fmtDT(e.at)+'</span>'
          +'</div>';
      });
      rows+='</div>';
      return '<div class="dsec" data-tone="purple"><div class="dstt"><span class="dstt-ico">📜</span>سجل تغييرات الحالة</div>'+rows+'</div>';
    })()
    +'<div class="dsec" data-tone="blue"><div class="dstt"><span class="dstt-ico">\uD83D\uDD01</span>تغيير الحالة</div>'
    +'<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge '+statusClass(o.status||'pending')+'" style="font-size:.88rem;padding:5px 12px"><span class="bdot"></span>'+statusLabel(o.status||'pending')+'</span>'
    +(o.status_changed_at?'<span style="color:var(--muted);font-size:.78rem">آخر تغيير: '+fmtDT(o.status_changed_at)+'</span>':'')
    +'</div>'
    +(o.status==='cancelled'&&o.cancel_reason?'<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#fecaca;font-size:.85rem"><b>سبب الإلغاء:</b> '+esc(o.cancel_reason)+'</div>':'')
    +'<select class="fsel" id="dsel" style="width:100%">'
    +STATUS_OPTIONS.map(function(s){return'<option value="'+s+'"'+(s===o.status?' selected':'')+'>'+statusLabel(s)+'</option>';}).join('')
    +'</select></div>'

    // منطقة الشحن: شارة المتابعة/التحذير + زرار الأوتوماتيك (للرابط API بس)
    +'<div class="ship-area" id="ship-area">'+shipControlsHtml(o)+'</div>'
    // 3 main action buttons: تأكيد - شحن يدوي - إلغاء
    // «اتشحن يدوي» بيسجّل رقم التتبع كمان — والأوردر اللي له بوليصة مابيشوفهوش
    +'<div class="dacts">'
    +'<button class="abtn ok" id="da-ok">✓ تأكيد</button>'
    +((o.tracking_no||'').trim()?'':'<button class="abtn bs" id="da-bs">📦 اتشحن يدوي</button>')
    +'<button class="abtn cn" id="da-cn">✕ إلغاء</button>'
    +'</div>'
    +'<button class="abtn" id="da-up" style="width:100%;margin-top:8px;background:var(--sur);color:var(--txt)">تحديث الحالة المختارة ↑</button>';

  $id('da-ok').addEventListener('click',function(){doUpdate('confirmed');});
  if($id('da-bs'))$id('da-bs').addEventListener('click',function(){manualShipFlow();});
  wireShipControls();
  $id('da-cn').addEventListener('click',function(){askCancelReason(function(reason){doUpdate('cancelled',reason);});});
  $id('da-up').addEventListener('click',function(){
    var v=$id('dsel').value;
    if(v==='cancelled'){askCancelReason(function(reason){doUpdate('cancelled',reason);});}
    else doUpdate(v);
  });
  $id('ca-add').addEventListener('click',addCallAttempt);
  $id('save-notes').addEventListener('click',saveInternalNotes);
  // Auto-save internal notes 1.2s after stop typing
  $id('int-notes').addEventListener('input',function(){
    clearTimeout(intNotesTimer);
    $id('save-status').textContent='يتم الحفظ تلقائياً...';
    $id('save-status').className='save-status';
    intNotesTimer=setTimeout(saveInternalNotes,1200);
  });
  $id('dcnt').querySelectorAll('.call-del').forEach(function(b){
    b.addEventListener('click',function(){deleteCallAttempt(parseInt(b.getAttribute('data-idx')));});
  });

  // Render and wire up products editor — load stock first if needed.
  // CRITICAL: must select wholesale_price too. If we don't, and the user
  // then opens Finance, loadStockProductsForCosts will skip its own load
  // (because stockProducts.length > 0) and every COGS lookup returns 0
  // because wholesale_price is undefined on these rows.
  if(!stockProducts || !stockProducts.length){
    sb.from('v_stock_products').select('id,name,current_qty,unit_price,wholesale_price,parent_id,variant_label').eq('tenant_id',currentTenantId).eq('active',true).order('current_qty',{ascending:false}).then(function(r){
      if(!r.error && r.data) stockSetProducts(r.data);
      // فتح أوردر تاني أثناء التحميل: رد A كان بيرسم منتجاته جوّه مودال B،
      // والحفظ بعدها كان بيكتب منتجات A على B
      if(sel && sel.id===o.id) renderProductsEditor(o.product_name||'');
    });
  } else {
    renderProductsEditor(o.product_name||'');
  }
  $id('prod-add').addEventListener('click', addEmptyProductRow);
  $id('save-prod').addEventListener('click',saveProducts);

  // Attach copy handlers for name/phone/address
  attachCopyHandlers();
  // تعديل الموبايل/العنوان + نسخ كل المنتجات بفورمات الأوردر
  attachFieldEditors();
  var _cpb=$id('copy-prod');
  if(_cpb){ _cpb.addEventListener('click',function(){
    var v=(sel['var']&&String(sel['var']).trim())?String(sel['var']).trim():'';
    var items=parseProductItems(sel.product_name||'');
    var txt=items.map(function(it){
      var line=it.name+' (عدد '+(it.qty||1)+')';
      return v?line+' - '+v:line;
    }).join(v?' | ':' - ');
    copyTextToClipboard(txt,'المنتجات');
  }); }

  // Wire up VIP show-history button if present
  var vipBtn=$id('vip-show');
  if(vipBtn){
    vipBtn.addEventListener('click',function(){
      var phone=normalizePhone(o.phone);
      if(!phone){toast('مفيش رقم موبايل','er');return;}
      // Close detail and filter table by this phone
      $id('ovl').classList.remove('open');ordersSetSelected(null);detailAbort();
      $id('qinp').value=phone;
      // Clear other filters to ensure all orders show
      $id('fst').value='';$id('fpl').value='';$id('fpy').value='';
      if(window.__syncFilterUI)window.__syncFilterUI();
      doFilter();
      window.scrollTo({top:0,behavior:'smooth'});
      toast('تم عرض كل طلبات العميل ⭐','ok');
    });
  }

  $id('ovl').classList.add('open');
}
