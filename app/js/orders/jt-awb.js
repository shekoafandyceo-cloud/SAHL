// طباعة بوليصة J&T المعتمدة (100 × 150 مم) من اللوحة — بيانات الشحنة الفعلية
// على القالب اللي J&T اعتمدته (tools/jt/waybill-source/waybill-template.html).
//
// 🔴 القالب معتمد — الأبعاد عقد: باركود أفقي 70×10 مم · رأسي 54×9 مم ·
//    كود الفرز داخل 35×10 مم Bold 20pt · الملاحظات = نفس remark اللي اتبعت لـJ&T.
// 🔴 كود الفرز بيتطبع **بالحرف** زي ما J&T رجّعته في sortingCode — مفيش تحويل.
// 🔴 الملاحظات = product_name + خصائص المنتج (نفس remarkFor في jt-ship) — ومفيش
//    صفحة تانية أبداً: سلّم تصغير 13→9pt قايمة ثم 10→6.5pt سطر متصل (زي build_waybill.py).
//
// الطباعة في نافذة جديدة (about:blank بترث CSP الأصل): مفيش inline script —
// الأصل هو اللي بيرسم ويقيس ويطبع. الخطوط واللوجو من /fonts و/img (font-src 'self').

import { currentTenant, currentTenantId } from '../auth/auth.js';
import { code128Modules } from '../core/code128.js';
import { routeBase } from '../core/router.js';
import { esc } from '../core/dom.js';
import { swallow } from '../core/log.js';
import { sb } from '../core/supabase.js';
import { toast } from '../core/toast.js';

function svgFromModules(mods, widthMm, heightMm){
  var n = mods.length, mw = widthMm / n, rects = '', i = 0;
  while(i < n){
    if(mods[i] === '1'){ var j = i; while(j < n && mods[j] === '1') j++;
      rects += '<rect x="' + (i * mw).toFixed(4) + '" y="0" width="' + ((j - i) * mw).toFixed(4) + '" height="' + heightMm + '"/>'; i = j; }
    else i++;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + widthMm.toFixed(4) + ' ' + heightMm + '" shape-rendering="crispEdges" fill="#000" style="width:' + widthMm + 'mm;height:' + heightMm + 'mm;display:block">' + rects + '</svg>';
}
function svgVertical(mods, lengthMm, barMm){
  var n = mods.length, mw = lengthMm / n, rects = '', i = 0;
  while(i < n){
    if(mods[i] === '1'){ var j = i; while(j < n && mods[j] === '1') j++;
      rects += '<rect x="0" y="' + (i * mw).toFixed(4) + '" width="' + barMm + '" height="' + ((j - i) * mw).toFixed(4) + '"/>'; i = j; }
    else i++;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + barMm + ' ' + lengthMm.toFixed(4) + '" shape-rendering="crispEdges" fill="#000" style="width:' + barMm + 'mm;height:' + lengthMm + 'mm;display:block">' + rects + '</svg>';
}

// ── الملاحظات — نفس remarkFor في jt-ship (200 حرف) ───────────────
export function jtRemarkLines(o){
  var lines = [];
  String(o.product_name || '').replace(/\r/g, '').split(/\s*\+\s*|\n/).forEach(function(p){ var t = p.trim(); if(t) lines.push(t); });
  var props = String(o.manufacturer_note || o['var'] || '').trim();
  if(props && !lines.some(function(l){ return l.indexOf(props) >= 0; })) lines.push(props);
  return lines;
}

var ARABIC_RANGE = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
function fontCss(){
  var base = location.origin + routeBase() + 'fonts/';
  var files = [['Cairo','cairo-arabic-400-normal.woff2',400,ARABIC_RANGE],['Cairo','cairo-arabic-700-normal.woff2',700,ARABIC_RANGE],['Cairo','cairo-arabic-800-normal.woff2',800,ARABIC_RANGE],
    ['Cairo','cairo-latin-400-normal.woff2',400,null],['Cairo','cairo-latin-700-normal.woff2',700,null],['Cairo','cairo-latin-800-normal.woff2',800,null],
    ['Liberation Sans','LiberationSans-Regular.ttf',400,null],['Liberation Sans','LiberationSans-Bold.ttf',700,null]];
  return files.map(function(f){
    var fmt = f[1].slice(-5) === 'woff2' ? 'woff2' : 'truetype';
    return '@font-face{font-family:"' + f[0] + '";font-style:normal;font-weight:' + f[2] + ';font-display:block;src:url(' + base + f[1] + ') format("' + fmt + '");' + (f[3] ? 'unicode-range:' + f[3] + ';' : '') + '}';
  }).join('\n');
}

// CSS القالب المعتمد — منقول بالحرف من waybill-template.html (بس @page/label)
var LABEL_CSS = '@page{size:100mm 150mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}'
+ '.label{width:100mm;height:150mm;padding:3mm;overflow:hidden;direction:rtl;font-family:"Cairo","Liberation Sans",Arial,sans-serif;font-size:9pt;line-height:1.25;position:relative;background:#fff;page-break-after:always;break-after:page}'
+ '.label:last-child{page-break-after:auto;break-after:auto}'
+ '.grid{width:94mm;height:144mm;border:.35mm solid #000;display:flex;flex-direction:column}.row{border-bottom:.35mm solid #000;flex:0 0 auto;display:flex;min-height:0}.row:last-child{border-bottom:0}'
+ '.lbl{font:700 6.3pt "Cairo";line-height:1.15}.val{font:800 10pt "Cairo";line-height:1.2;white-space:nowrap}.en{font-family:"Liberation Sans",Arial,sans-serif}.tag{display:inline-block;font:700 8pt "Liberation Sans",Arial,sans-serif;margin-left:1.2mm;vertical-align:1pt}'
+ '.r-head{height:9mm;align-items:center;padding:0 1.5mm}.jt{width:34mm;font:700 15pt "Liberation Sans",Arial,sans-serif;line-height:1;white-space:nowrap}.jt small{font-size:8.5pt;letter-spacing:.5pt;margin-left:1mm}.brand{flex:1;display:flex;justify-content:center;align-items:center}.brand img.logo{height:7.4mm;width:auto;display:block}.service{width:24mm;text-align:right;font:700 10pt "Liberation Sans",Arial,sans-serif}'
+ '.r-bar{height:16.5mm;flex-direction:column;align-items:center;justify-content:center}.bc svg{display:block;width:70mm;height:10mm}.wb{font:700 11.5pt "Liberation Sans",Arial,sans-serif;letter-spacing:.35mm;margin-top:.9mm;line-height:1}'
+ '.body{display:grid;grid-template-columns:1fr 14mm;direction:ltr}.body>.lcell{grid-column:1;border-bottom:.35mm solid #000;direction:rtl;display:flex;min-width:0}.body>.lcell:last-child{border-bottom:0}.side{grid-column:2;grid-row:1/span 4;border-left:.35mm solid #000;display:flex;align-items:center;justify-content:center;gap:.6mm;direction:ltr}.vbc svg{display:block;width:9mm;height:54mm}.vwb{writing-mode:vertical-rl;transform:rotate(180deg);font:700 7pt "Liberation Sans",Arial,sans-serif;letter-spacing:.2mm;line-height:1;white-space:nowrap}'
+ '.r-info{height:9mm}.r-info .cell{flex:1;display:flex;flex-direction:column;justify-content:center;padding:.6mm 1.5mm .9mm;min-width:0}.r-info .cell:first-child{flex:1.25;border-left:.35mm solid #000}.c-cod .val{font-size:11pt}'
+ '.r-sort{height:12.5mm;align-items:center;justify-content:center}.sort-box{width:35mm;height:10mm;display:flex;align-items:center;justify-content:center;font:700 20pt "Liberation Sans",Arial,sans-serif;line-height:1;white-space:nowrap;direction:ltr}'
+ '.r-to{min-height:31mm;max-height:40mm;flex-direction:column;padding:.8mm 1.5mm 1mm;overflow:hidden}.to-name{font:800 13pt "Cairo";line-height:1.2;white-space:nowrap}.to-phones{font:700 12pt "Liberation Sans",Arial,sans-serif;line-height:1.2}.to-area{font:800 11.5pt "Cairo";line-height:1.2;white-space:nowrap}.to-addr{font:700 10.5pt "Cairo";line-height:1.3}'
+ '.r-from{height:9.5mm;flex-direction:column;justify-content:center;padding:.5mm 1.5mm .8mm;overflow:hidden}.from-name{font:800 10pt "Cairo";line-height:1.2;white-space:nowrap}.from-name .en{font:700 8pt "Liberation Sans",Arial,sans-serif}.from-name bdi.ph{font:700 9.5pt "Liberation Sans",Arial,sans-serif}.from-info{font:700 8.5pt "Cairo";line-height:1.2;white-space:nowrap}'
+ '.r-items{flex:1 1 auto;flex-direction:column;padding:.6mm 1.5mm .4mm}.items-head{display:flex;justify-content:space-between;align-items:center;flex:0 0 auto;font:700 7.5pt "Cairo";border-bottom:.25mm solid #000;padding-bottom:.2mm;margin-bottom:.6mm}.items-head .en{font-size:7pt}'
+ '.items-list{--fs:13pt;list-style:none;margin:0;padding:0 0 1.2mm;flex:1 1 auto;overflow:hidden;min-height:0;font:800 var(--fs) "Cairo";line-height:1.3}.items-list li{display:block}.items-list.flow{line-height:1.25}.items-list.flow li{display:inline}.items-list.flow li+li::before{content:"\\2022";margin:0 .45em}'
+ '.items-foot{flex:0 0 auto;text-align:center;font:800 10pt "Cairo";line-height:1.3;border-top:.25mm solid #000;margin-top:.4mm;padding-top:.4mm}'
+ '.r-foot{min-height:6mm;flex-direction:column;justify-content:center;padding:.3mm 1.5mm .5mm}.foot-l1{display:flex;justify-content:space-between;align-items:center;line-height:1.05;white-space:nowrap;direction:ltr}.hot{font:700 8.5pt "Liberation Sans",Arial,sans-serif;min-width:18mm}.hot svg{width:3mm;height:3mm;vertical-align:-.5mm;margin-right:.8mm}.foot-wb{font:700 10.5pt "Liberation Sans",Arial,sans-serif;letter-spacing:.25mm}.meta{font:400 6.5pt "Liberation Sans",Arial,sans-serif;line-height:1;white-space:nowrap;min-width:18mm;text-align:right}'
+ '@media screen{body{background:#888;padding:5mm}.label{margin:0 auto 5mm;box-shadow:0 0 3mm rgba(0,0,0,.4)}}';

var LADDER = [[13,'list'],[12.5,'list'],[12,'list'],[11.5,'list'],[11,'list'],[10.5,'list'],[10,'list'],[9.5,'list'],[9,'list'],[10,'flow'],[9.5,'flow'],[9,'flow'],[8.5,'flow'],[8,'flow'],[7.5,'flow'],[7,'flow'],[6.5,'flow']];
var PHONE_SVG = '<svg viewBox="0 0 24 24"><path fill="#000" d="M6.6 2.5c.6-.3 1.3 0 1.6.6l1.9 3.7c.3.6.1 1.3-.4 1.7L8.3 9.6c1.3 2.6 3.5 4.8 6.1 6.1l1.1-1.4c.4-.5 1.1-.7 1.7-.4l3.7 1.9c.6.3.9 1 .6 1.6l-1 2.6c-.3.7-1 1.1-1.7 1C10.4 20.2 3.8 13.6 3 5.2c-.1-.7.3-1.4 1-1.7z"/></svg>';
var JT_HOTLINE = '15865';

function fmtNum(x){ var n = Number(x); return isFinite(n) ? String(+n.toFixed(2)) : String(x || ''); }

// HTML بوليصة واحدة — كل القيم بتتهرّب (esc) والباركود SVG متولّد هنا
export function jtLabelHtml(o, sender, printedAt){
  var wb = String(o.tracking_no || '').trim();
  var mods = code128Modules(wb);
  var lines = jtRemarkLines(o);
  var logo = location.origin + routeBase() + 'img/3ataba-logo-wordmark-black.png';
  return '<div class="label" data-id="' + esc(o.id) + '"><div class="grid">'
    + '<div class="row r-head" dir="ltr"><div class="jt">J&amp;T<small>EXPRESS</small></div><div class="brand"><img class="logo" src="' + logo + '" alt="3ataba.com"></div><div class="service">Standard</div></div>'
    + '<div class="row r-bar" dir="ltr"><div class="bc">' + svgFromModules(mods, 70, 10) + '</div><div class="wb">' + esc(wb) + '</div></div>'
    + '<div class="row body">'
    + '<div class="lcell r-info"><div class="cell c-cod"><div class="lbl">COD — مبلغ التحصيل</div><div class="val">' + fmtNum(o.total_cost) + ' ج.م</div></div><div class="cell c-wt"><div class="lbl">Weight — الوزن</div><div class="val">' + fmtNum(o.shipping_weight_kg || 1) + ' كجم</div></div></div>'
    + '<div class="side"><div class="vwb">' + esc(wb) + '</div><div class="vbc">' + svgVertical(mods, 54, 9) + '</div></div>'
    + '<div class="lcell r-sort"><div class="sort-box"><span class="sort-text">' + esc(o.jt_sorting_code || '') + '</span></div></div>'
    + '<div class="lcell r-to"><div class="to-name"><span class="tag">To:</span>' + esc(o.customer_name || '') + '</div>'
    + '<div class="to-phones"><bdi>' + esc(o.phone || '') + '</bdi>' + (o.alt_phone ? ' — <bdi>' + esc(o.alt_phone) + '</bdi>' : '') + '</div>'
    + '<div class="to-area">' + esc(o.ship_prov || o.city || '') + (o.ship_city ? ' — ' + esc(o.ship_city) : '') + (o.ship_area ? ' — ' + esc(o.ship_area) : '') + '</div>'
    + '<div class="to-addr">' + esc(o.address || '') + '</div></div>'
    + '<div class="lcell r-from"><div class="from-name"><span class="tag">FROM:</span>' + esc(sender.name) + ' <bdi class="en">3ataba.com</bdi> &nbsp;·&nbsp; <bdi class="ph">' + esc(sender.phone) + '</bdi></div><div class="from-info">' + esc(sender.address) + '</div></div>'
    + '</div>'
    + '<div class="row r-items"><div class="items-head"><span><span class="en">REMARKS</span> — الملاحظات</span></div>'
    + '<ol class="items-list" style="--fs:13pt">' + lines.map(function(l){ return '<li>' + esc(l) + '</li>'; }).join('') + '</ol>'
    + '<div class="items-foot">يسمح بالمعاينة أمام المندوب</div></div>'
    + '<div class="row r-foot"><div class="foot-l1"><span class="hot">' + PHONE_SVG + JT_HOTLINE + '</span><span class="foot-wb">' + esc(wb) + '</span><span class="meta">' + esc(printedAt) + '</span></div></div>'
    + '</div></div>';
}

// سلّم التصغير — صفحة واحدة دايماً (نفس LADDER بتاعة build_waybill.py)
function fitLabel(doc, label){
  var list = label.querySelector('.items-list');
  if(!list || !list.lastElementChild) return;
  for(var i = 0; i < LADDER.length; i++){
    list.style.setProperty('--fs', LADDER[i][0] + 'pt');
    list.classList.toggle('flow', LADDER[i][1] === 'flow');
    var last = list.lastElementChild;
    var lb = last.getBoundingClientRect().bottom + 0.25 * parseFloat(doc.defaultView.getComputedStyle(last).fontSize);
    if(lb <= list.getBoundingClientRect().bottom + 0.5) return;
  }
}

function senderFromTenant(){
  var t = currentTenant || {};
  var addr = [t.sender_prov, t.sender_city, t.sender_area, t.sender_street].filter(Boolean).join(' — ');
  return { name: t.sender_name || t.store_name || 'عتبة', phone: t.sender_phone || t.support_phone || '', address: addr };
}

export var JT_AWB_COLS = 'id,order_uid,tracking_no,jt_sorting_code,awb_print_count,shipping_carrier,total_cost,shipping_weight_kg,customer_name,phone,alt_phone,city,address,ship_prov,ship_city,ship_area,product_name,manufacturer_note,var';

// طباعة بوالص J&T لمجموعة أوردرات — صفحة لكل أوردر في نافذة واحدة
export async function printJtAwb(orderIds){
  if(!orderIds || !orderIds.length) return;
  var r = await sb.from('orders').select(JT_AWB_COLS).eq('tenant_id', currentTenantId).in('id', orderIds);
  var rows = (r && r.data || []).filter(function(o){ return (o.tracking_no || '').trim() && o.shipping_carrier === 'jt'; });
  if(!rows.length){ toast('مفيش بوليصة J&T في الأوردرات دي', 'er'); return; }
  var missingSort = rows.filter(function(o){ return !(o.jt_sorting_code || '').trim(); });
  if(missingSort.length) toast('⚠️ ' + missingSort.length + ' بوليصة من غير كود فرز من J&T — هتتطبع بمكانه فاضي', 'er');
  var win = window.open('', '_blank');
  if(!win){ toast('السماح بفتح نوافذ جديدة في المتصفح الأول', 'er'); return; }
  var printedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  var sender = senderFromTenant();
  var doc = win.document;
  doc.open();
  doc.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>J&T waybills</title><style>' + fontCss() + LABEL_CSS + '</style></head><body>'
    + rows.map(function(o){ return jtLabelHtml(o, sender, printedAt); }).join('') + '</body></html>');
  doc.close();
  try{ if(doc.fonts && doc.fonts.ready) await doc.fonts.ready; }catch(e){ swallow('printJtAwb/fonts', e); }
  await new Promise(function(res){ setTimeout(res, 120); });
  Array.prototype.forEach.call(doc.querySelectorAll('.label'), function(l){ fitLabel(doc, l); });
  try{ win.focus(); win.print(); }catch(e){ swallow('printJtAwb/print', e); }
  // عدّاد الطباعة (نفس أعمدة بوسطة) — بيغذّي «حدد غير المطبوع»
  var ids = rows.map(function(o){ return o.id; });
  try{
    for(var i = 0; i < rows.length; i++){
      await sb.from('orders').update({ awb_printed_at: new Date().toISOString(), awb_print_count: (Number(rows[i].awb_print_count) || 0) + 1 })
        .eq('id', rows[i].id).eq('tenant_id', currentTenantId);
    }
  }catch(e){ swallow('printJtAwb/count', e); }
  toast('✅ اتطبع ' + ids.length + ' بوليصة J&T', 'ok');
  return ids;
}
