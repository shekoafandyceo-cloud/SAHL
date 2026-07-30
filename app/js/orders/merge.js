// تنبيه الدمج — عملاء معاهم أكتر من أوردر جاهز للشحن

import { $id, esc } from '../core/dom.js';
import { normalizePhone, num } from '../core/format.js';
import { toast } from '../core/toast.js';
import { doFilter } from './orders.js';
import { pendingBostaByPhone, phoneCounts } from './state.js';

// Customers with 2+ orders all in "bosta_assigned" status — can be merged into one shipment
export var mergeableCustomers = []; // [{ phone, name, orders: [...] }]

export function detectMergeable(){
  mergeableCustomers = [];
  Object.keys(pendingBostaByPhone).forEach(function(phone){
    var orders = pendingBostaByPhone[phone];
    if(orders.length >= 2){
      mergeableCustomers.push({
        phone: phone,
        name: orders[0].customer_name || 'عميل',
        city: orders[0].city || '',
        orders: orders,
        totalCost: orders.reduce(function(s,o){return s+(o.total_cost||0);},0)
      });
    }
  });
  renderMergeAlert();
}

export function renderMergeAlert(){
  var container = $id('merge-alert-container');
  if(!container) return;
  if(!mergeableCustomers.length){
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  var totalDuplicateOrders = mergeableCustomers.reduce(function(s,c){return s+c.orders.length;},0);
  var savings = mergeableCustomers.reduce(function(s,c){return s+(c.orders.length-1);},0); // shipments saved
  var h = '<div class="merge-alert">'
    + '<div class="merge-alert-header">'
    +   '<div class="merge-alert-icon">⚠️</div>'
    +   '<div class="merge-alert-title">انتبه يا ريس! فيه عملاء معاهم أوردرات متعددة جاهزة للشحن</div>'
    +   '<div class="merge-alert-count">'+mergeableCustomers.length+' عميل</div>'
    + '</div>';
  mergeableCustomers.forEach(function(c){
    var chips = c.orders.map(function(o){
      return '<span class="merge-order-chip">#'+(o.order_uid||o.tracking_no||'?')+'</span>';
    }).join('');
    h += '<div class="merge-customer">'
      + '<div style="flex:1">'
      +   '<div class="merge-cust-name">'+esc(c.name)+(c.city?' — '+esc(c.city):'')+'</div>'
      +   '<div class="merge-cust-meta">📱 '+esc(c.phone)+' · 💰 '+num(c.totalCost)+' ج · '+c.orders.length+' أوردرات</div>'
      + '</div>'
      + '<div class="merge-cust-orders">'+chips+'</div>'
      + '<button class="merge-show-btn" data-phone="'+esc(c.phone)+'">👁️ اعرض الأوردرات</button>'
      + '</div>';
  });
  h += '<div class="merge-savings">💡 لو دمجتهم في شحنة واحدة لكل عميل، هتوفر تكلفة شحن لـ '+savings+' شحنة!</div>';
  h += '</div>';
  container.innerHTML = h;
  container.style.display = 'block';
  // Wire up "show orders" buttons — filter table by phone
  container.querySelectorAll('.merge-show-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var phone = b.getAttribute('data-phone');
      $id('qinp').value = phone;
      $id('fst').value = ''; $id('fpl').value = ''; $id('fpy').value = '';
      if(window.__syncFilterUI)window.__syncFilterUI();
      doFilter();
      window.scrollTo({top: $id('fbar') ? $id('fbar').offsetTop - 80 : 200, behavior:'smooth'});
      toast('عرض أوردرات هذا العميل','ok');
    });
  });
}

export function customerOrderCount(o){
  var p=normalizePhone(o.phone);
  return p ? (phoneCounts[p]||1) : 1;
}
