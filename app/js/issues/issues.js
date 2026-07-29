// مركز المشاكل — قواعد الكشف والعرض

import { normalizeProductName, parseProductItems } from '../analytics/product-match.js';
import { BOSTA_INVENTORY_STATUSES, RETURNED_STATUSES, statusIn } from '../core/constants.js';
import { $id, esc } from '../core/dom.js';
import { num, short } from '../core/format.js';
import { openStockProductByName, renderSmartStockAlerts, stockForecastRows, stockProducts } from '../stock/stock.js';
// جسر مؤقت — الرموز دي لسه في main.js. دورة مقصودة:
// قانونية في ES modules لأن مفيش كود بيتنفّذ وقت التقييم.
import { all, doFilter, ensureTenant, hasCostSnapshot, isAdmin, loadStockMovementsForOps, loadStockProductsForCosts, productCostByName, productExists, requireAdmin, shippedOrOperational, showPage } from '../main.js';

export function buildIssues(){
  var issues=[];
  function add(prio,type,title,detail,ref,action,scope){
    issues.push({prio:prio,type:type,title:title,detail:detail,ref:ref,action:action,scope:scope});
  }

  // الهدف هنا إن شاشة المشاكل تعرض مشاكل قابلة للتصرف، مش تعمل إنذار على كل داتا قديمة.
  // لذلك: بنجمع المشاكل المتكررة، وبنتجاهل Legacy orders القديمة في Checks الجديدة مثل Snapshot / stock_deducted.
  var nowMs=Date.now();
  var OPS_ISSUE_DAYS=21;     // مشاكل التشغيل الحديثة فقط
  var PRODUCT_ISSUE_DAYS=30; // مشاكل المنتجات من أوردرات آخر شهر
  var PENDING_OLD_HOURS=24;  // pending بعد يوم كامل، مش 6 ساعات عشان مايبقاش Noise

  function rowAgeDays(o){
    var raw=o.status_changed_at || o.created_at;
    var d=new Date(raw||'');
    if(isNaN(d.getTime()))return null;
    return (nowMs-d.getTime())/(24*60*60*1000);
  }
  function isRecent(o,days){
    var age=rowAgeDays(o);
    return age===null || age<=days;
  }
  function uidOf(o){return o.order_uid||o.tracking_no||String(o.id||'').slice(0,8);}
  function bump(map,key,data){
    if(!key)return;
    if(!map[key])map[key]=Object.assign({count:0},data||{});
    map[key].count++;
  }

  // 1) سعر الجملة صفر — Issue واحدة لكل منتج Active فقط.
  (stockProducts||[]).forEach(function(p){
    if(p.active===false)return;
    if((Number(p.wholesale_price||0)||0)<=0){
      add('high','بيانات المنتج','سعر الجملة صفر', 'المنتج ده هيخلي الأرباح أعلى من الحقيقة لأنه بيتحسب بتكلفة صفر. افتح المنتج وضيف سعر الجملة.', p.name, {kind:'stock',q:p.name}, 'data');
    }
  });

  // 2) نفاد المخزون الذكي — يظهر هنا فقط لو فيه سحب حديث فعلاً.
  stockForecastRows().filter(function(r){
    if(r.level==='ok')return false;
    if(r.product && r.product.active===false)return false;
    // ما نعتبرش منتج صفر مخزون مشكلة هنا لو مفيش عليه سحب آخر 7 أيام.
    if((r.sold7||0)<=0)return false;
    return true;
  }).forEach(function(r){
    add(r.level==='critical'?'high':'medium','نفاد مخزون ذكي',r.msg, 'المتاح '+num(r.qty)+' · سحب آخر 7 أيام '+num(r.sold7)+' · متوسط يومي '+(r.avg?r.avg.toFixed(1):'0')+' · متبقي '+(r.daysLeft===null?'غير محسوب':r.daysLeft.toFixed(1)+' يوم'), r.name, {kind:'stock',q:r.name}, 'stock');
  });

  var missingProductMap={};
  var zeroCostProductMap={};
  var noSnapshot=0, noSnapshotExample=null;
  var noDeduct=0, noDeductExample=null;

  (all||[]).forEach(function(o){
    var uid=uidOf(o);
    var ageDays=rowAgeDays(o);

    // 3) Pending قديم — آخر 21 يوم فقط وبعد 24 ساعة.
    if(o.status==='pending' && isRecent(o,OPS_ISSUE_DAYS)){
      var d=new Date(o.created_at||'');
      if(!isNaN(d.getTime()) && nowMs-d.getTime()>PENDING_OLD_HOURS*60*60*1000){
        add('medium','طلبات معلقة','Pending قديم', 'الأوردر قيد الانتظار من أكتر من '+PENDING_OLD_HOURS+' ساعة ومحتاج متابعة.', '#'+uid, {kind:'order',q:o.order_uid||o.phone||o.id}, 'ops');
      }
    }

    // 4) مشاكل تشغيل Bosta الحالية — الحديثة فقط.
    if(BOSTA_INVENTORY_STATUSES.indexOf(o.status)>=0 && isRecent(o,OPS_ISSUE_DAYS)){
      if(!o.tracking_no){
        add('high','بوسطة','شحنة في التشغيل بدون رقم تتبع', 'الأوردر داخل حالات بوسطة التشغيل لكن مفيش tracking_no محفوظ.', '#'+uid, {kind:'order',q:o.order_uid||o.phone||o.id}, 'ops');
      }
      if(!o.stock_deducted_at && o.tracking_no){
        noDeduct++;
        if(!noDeductExample)noDeductExample=o;
      }
    }

    if((o.status==='Exception' || o.status==='exception') && isRecent(o,OPS_ISSUE_DAYS)){
      add('high','بوسطة','Exception محتاج تدخل', 'الشحنة في حالة Exception ولازم تتراجع مع بوسطة أو العميل.', '#'+uid, {kind:'order',q:o.tracking_no||o.order_uid||o.phone}, 'ops');
    }

    // 5) مرتجع بدون رجوع مخزون — بس لو أصلاً كان اتخصم.
    if(statusIn(o.status,RETURNED_STATUSES) && o.stock_deducted_at && !o.stock_returned_at && isRecent(o,PRODUCT_ISSUE_DAYS)){
      add('high','مخزون','مرتجع بدون رجوع مخزون', 'الأوردر رجع لكن stock_returned_at فاضي. راجع فرع المرتجع في n8n.', '#'+uid, {kind:'order',q:o.tracking_no||o.order_uid||o.phone}, 'stock');
    }

    // 6) Snapshot missing — Issue واحدة مجمعة فقط، مش صف لكل أوردر.
    if(shippedOrOperational(o) && !hasCostSnapshot(o) && isRecent(o,OPS_ISSUE_DAYS)){
      noSnapshot++;
      if(!noSnapshotExample)noSnapshotExample=o;
    }

    // 7) مشاكل المنتج داخل الأوردرات — مجمعة بالمنتج، آخر شهر فقط.
    if(shippedOrOperational(o) && isRecent(o,PRODUCT_ISSUE_DAYS)){
      parseProductItems(o.product_name||'').forEach(function(it){
        var name=it.name;
        if(!productExists(name)){
          bump(missingProductMap,name,{name:name,example:o});
        } else if(productCostByName(name)<=0){
          bump(zeroCostProductMap,name,{name:name,example:o});
        }
      });
    }
  });

  if(noDeduct>0){
    add('high','مخزون','شحنات بدون خصم مخزون', 'فيه '+num(noDeduct)+' شحنة حديثة في التشغيل ولها رقم تتبع لكن stock_deducted_at فاضي. راجع n8n خصم المخزون.', noDeductExample?'#'+uidOf(noDeductExample):num(noDeduct), {kind:'order',q:noDeductExample?(noDeductExample.tracking_no||noDeductExample.order_uid||noDeductExample.phone):''}, 'stock');
  }

  if(noSnapshot>0){
    add('medium','Snapshot','أوردرات حديثة بدون Snapshot', 'فيه '+num(noSnapshot)+' أوردر حديث اتحرك/اتسلم لكن مفيش تكلفة محفوظة وقت الشحن. ده مش خطر فوري، بس الماليات هتستخدم أسعار المخزون الحالية كـ fallback.', noSnapshotExample?'#'+uidOf(noSnapshotExample):num(noSnapshot), {kind:'order',q:noSnapshotExample?(noSnapshotExample.tracking_no||noSnapshotExample.order_uid||noSnapshotExample.phone):''}, 'data');
  }

  Object.keys(missingProductMap).forEach(function(k){
    var r=missingProductMap[k];
    add('high','تكلفة المنتج','منتج غير موجود في المخزون', 'المنتج ظهر في '+num(r.count)+' أوردر حديث لكنه مش موجود في stock_products. ضيفه أو وحّد الاسم عشان التكلفة تتحسب صح.', r.name, {kind:'order',q:r.example?(r.example.tracking_no||r.example.order_uid||r.example.phone):r.name}, 'data');
  });

  Object.keys(zeroCostProductMap).forEach(function(k){
    var r=zeroCostProductMap[k];
    // لو المنتج نفسه اتسجل فوق كسعر صفر، ما نكررش نفس المشكلة كتير.
    var alreadyStockIssue=(stockProducts||[]).some(function(p){return normalizeProductName(p.name).toLowerCase()===normalizeProductName(r.name).toLowerCase() && (Number(p.wholesale_price||0)||0)<=0;});
    if(alreadyStockIssue)return;
    add('high','تكلفة المنتج','منتج سعره صفر في أوردرات', 'المنتج ظهر في '+num(r.count)+' أوردر حديث وتكلفته محسوبة صفر. ضيف سعر الجملة في المخزون.', r.name, {kind:'stock',q:r.name}, 'data');
  });

  var pr={high:0,medium:1,low:2};
  issues.sort(function(a,b){
    if(pr[a.prio]!==pr[b.prio])return pr[a.prio]-pr[b.prio];
    return String(a.type).localeCompare(String(b.type),'ar');
  });
  return issues;
}

export var _allIssues = []; // cache for filter

export function renderIssues(){
  if(!isAdmin())return;
  _allIssues = buildIssues();
  var high=_allIssues.filter(function(i){return i.prio==='high';}).length;
  var med=_allIssues.filter(function(i){return i.prio==='medium';}).length;
  var data=_allIssues.filter(function(i){return i.scope==='data';}).length;
  if($id('iss-high'))$id('iss-high').textContent=num(high);
  if($id('iss-medium'))$id('iss-medium').textContent=num(med);
  if($id('iss-data'))$id('iss-data').textContent=num(data);
  if($id('iss-total'))$id('iss-total').textContent=num(_allIssues.length);
  renderSmartStockAlerts('issues-stock-alerts',4);
  renderIssuesTable();
}

export function renderIssuesTable(){
  var q=($id('issues-search')&&$id('issues-search').value||'').trim().toLowerCase();
  var prio=($id('issues-filter-prio')&&$id('issues-filter-prio').value)||'';
  var scope=($id('issues-filter-scope')&&$id('issues-filter-scope').value)||'';
  var issues=_allIssues.filter(function(i){
    if(prio && i.prio!==prio)return false;
    if(scope && i.scope!==scope)return false;
    if(q){
      var hay=[i.title,i.type,i.detail,i.ref].filter(Boolean).join(' ').toLowerCase();
      if(hay.indexOf(q)<0)return false;
    }
    return true;
  });
  if($id('iss-filtered-count'))$id('iss-filtered-count').textContent=num(issues.length)+' مشكلة';

  var tb=$id('issues-tbody'); if(!tb)return;
  if(!_allIssues.length){tb.innerHTML='<div class="ldg" style="color:var(--green);padding:28px;">✅ ممتاز — مفيش مشاكل موجودة دلوقتي</div>';return;}
  if(!issues.length){tb.innerHTML='<div class="ldg">لا توجد مشاكل تطابق الفلتر</div>';return;}

  var prioConfig={
    high:{label:'🚨 عاجل',cls:'high'},
    medium:{label:'⚠️ متوسط',cls:'medium'},
    low:{label:'ℹ️ منخفض',cls:'low'}
  };
  var scopeIcon={ops:'⚙️',stock:'📦',data:'📊'};
  var scopeLabel={ops:'تشغيل',stock:'مخزون',data:'بيانات'};

  var h='<table><thead><tr>'
    +'<th style="width:90px">الأولوية</th>'
    +'<th style="width:80px">النوع</th>'
    +'<th>المشكلة</th>'
    +'<th>التفاصيل</th>'
    +'<th style="width:90px">المرجع</th>'
    +'<th style="width:60px">إجراء</th>'
    +'</tr></thead><tbody>';

  issues.forEach(function(i,idx){
    var pc=prioConfig[i.prio]||{label:i.prio,cls:'low'};
    var sc=scopeIcon[i.scope]||'';
    var rowBg=i.prio==='high'?'rgba(239,68,68,.04)':i.prio==='medium'?'rgba(249,115,22,.03)':'';
    h+='<tr style="background:'+rowBg+'">'
      +'<td><span class="issue-prio '+pc.cls+'">'+pc.label+'</span></td>'
      +'<td><span style="font-size:.78rem;color:var(--muted)">'+sc+' '+esc(scopeLabel[i.scope]||i.scope||'')+'</span></td>'
      +'<td class="nm" style="font-weight:800;">'+esc(i.title)+'</td>'
      +'<td class="pr" style="font-size:.8rem;color:var(--muted2);max-width:340px;" title="'+esc(i.detail)+'">'+esc(short(i.detail,100))+'</td>'
      +'<td class="mn" style="font-size:.78rem;color:var(--blue);">'+esc(i.ref||'—')+'</td>'
      +'<td><button class="issue-action-btn" data-issue-idx="'+idx+'">فتح →</button></td>'
      +'</tr>';
  });
  h+='</tbody></table>';
  tb.innerHTML=h;
  tb.querySelectorAll('[data-issue-idx]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var i=issues[parseInt(btn.getAttribute('data-issue-idx'),10)];
      if(!i||!i.action)return;
      if(i.action.kind==='stock')openStockProductByName(i.action.q);
      else if(i.action.kind==='order'){
        showPage('orders');
        $id('qinp').value=i.action.q||'';$id('fst').value='';$id('fpl').value='';$id('fpy').value='';
        if(window.__syncFilterUI)window.__syncFilterUI();
        doFilter(); window.scrollTo({top:0,behavior:'smooth'});
      }
    });
  });
}

export function loadIssues(){
  if(!requireAdmin())return;
  if(!ensureTenant())return;
  var tb=$id('issues-tbody'); if(tb)tb.innerHTML='<div class="ldg"><div class="spin"></div>جاري تحليل المشاكل...</div>';
  loadStockProductsForCosts(function(){
    loadStockMovementsForOps(function(){
      renderIssues();
    });
  });
}
