// شريط الفلاتر والبحث وكروت الحالة

import { loadBilling, loadWalletState, wireBillingEvents } from '../billing/billing.js';
import { $id } from '../core/dom.js';
import { loadFinance } from '../finance/finance.js';
import { loadIssues } from '../issues/issues.js';
import { loadSettings } from '../settings/settings.js';
import { loadStock } from '../stock/stock.js';
import { tourActive } from '../tour/tour.js';
import { doFilter, loadAll, resolveCancelRequest, showCancelRequested } from './orders.js';
import { ordersSetSearchTimer, sel, stm } from './state.js';

// زرار التحديث + بحث وفلاتر الأوردرات
export function initRefreshAndSearch(){
  $id('rbtn').addEventListener('click', function(){
    // Refresh whichever page is currently visible (not just orders).
    // Wallet is refreshed for everyone (admin + employee) because the depletion lock applies to both.
    var active = document.querySelector('.tnav-btn.active');
    var page = active ? active.getAttribute('data-page') : 'orders';
    if(page === 'stock'){
      loadStock();
      loadWalletState();
    } else if(page === 'finance'){
      loadFinance();
      loadWalletState();
    } else if(page === 'billing'){
      loadBilling();
    } else if(page === 'settings'){
      loadSettings();
    } else if(page === 'issues' && typeof loadIssues === 'function'){
      loadIssues();
      loadWalletState();
    } else {
      loadAll(); // orders (and everything it pulls in)
    }
  });
  $id('qinp').addEventListener('input',function(){clearTimeout(stm);ordersSetSearchTimer(setTimeout(doFilter,240));});
  $id('fst').addEventListener('change',doFilter);
  $id('fpl').addEventListener('change',doFilter);
  $id('fpy').addEventListener('change',doFilter);

  // ---- custom animated filter dropdowns: native <select>s stay as the source of truth ----
}

export function fdropCloseAll(except){
  document.querySelectorAll('.fdrop.open').forEach(function(w){ if(w!==except) w.classList.remove('open'); });
}

export function enhanceFilters(){
  [{id:'fst',ic:'🏷️'},{id:'fpl',ic:'📣'},{id:'fpy',ic:'💳'}].forEach(function(cfg){
    var sel=$id(cfg.id); if(!sel||sel.__enhanced) return; sel.__enhanced=true;
    var wrap=document.createElement('div'); wrap.className='fdrop'; wrap.id=cfg.id+'-wrap';
    sel.parentNode.insertBefore(wrap,sel); wrap.appendChild(sel); sel.classList.add('fdrop-native');
    var btn=document.createElement('button'); btn.type='button'; btn.className='fdrop-btn';
    btn.innerHTML='<span class="fd-ic">'+cfg.ic+'</span><span class="fd-lbl"></span><span class="fd-chev">▾</span>';
    wrap.appendChild(btn);
    var panel=document.createElement('div'); panel.className='fdrop-panel'; wrap.appendChild(panel);
    Array.prototype.forEach.call(sel.options,function(opt){
      var it=document.createElement('button'); it.type='button'; it.className='fdrop-item';
      it.setAttribute('data-value',opt.value); it.appendChild(document.createTextNode(opt.textContent));
      it.addEventListener('click',function(ev){
        ev.stopPropagation();
        if(sel.value!==opt.value){ sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        sync(); wrap.classList.remove('open');
      });
      panel.appendChild(it);
    });
    function sync(){
      var o=sel.options[sel.selectedIndex]||sel.options[0];
      var lbl=wrap.querySelector('.fd-lbl'); if(lbl) lbl.textContent=o?o.textContent:'';
      wrap.classList.toggle('active', sel.value!=='');
      panel.querySelectorAll('.fdrop-item').forEach(function(it){ it.classList.toggle('sel', it.getAttribute('data-value')===sel.value); });
    }
    btn.addEventListener('click',function(ev){
      ev.stopPropagation();
      var willOpen=!wrap.classList.contains('open');
      fdropCloseAll(wrap); wrap.classList.toggle('open',willOpen);
    });
    sel.addEventListener('change',sync);
    sel.__fsync=sync; sync();
  });
}

// القوايم المنسدلة + شريط طلبات الإلغاء
export function initFilterDropdowns(){
  document.addEventListener('click',function(){ fdropCloseAll(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') fdropCloseAll(); });
  window.__syncFilterUI=function(){ ['fst','fpl','fpy'].forEach(function(id){ var s=$id(id); if(s&&s.__fsync)s.__fsync(); }); reflectStatusCards(); };
  (function(){ var b=$id('cxbar'); if(b) b.addEventListener('click', showCancelRequested); })();
  document.addEventListener('click', function(ev){ var t=ev.target; if(t && t.id==='cx-resolve'){ ev.preventDefault(); resolveCancelRequest(); } });
  enhanceFilters();
  wireBillingEvents();

  // ---- clickable status cards: tap a card to filter orders by that status (no-op during the demo/tour) ----
}

export function reflectStatusCards(){
  var v=$id('fst')?$id('fst').value:'';
  var map={pending:'s1',confirmed:'s2',delivered:'s3',cancelled:'s4',returned:'s5'};
  ['s0','s1','s2','s3','s4','s5'].forEach(function(sid){
    var el=$id(sid), card=el&&el.closest('.sc');
    if(card) card.classList.toggle('sc-on', map[v]===sid);
  });
}

export function wireStatusCards(){
  var map={s0:'',s1:'pending',s2:'confirmed',s3:'delivered',s4:'cancelled',s5:'returned'};
  Object.keys(map).forEach(function(sid){
    var val=map[sid], el=$id(sid); if(!el)return;
    var card=el.closest('.sc'); if(!card||card.__statusWired)return; card.__statusWired=true;
    card.classList.add('sc-clickable');
    card.addEventListener('click',function(e){
      if(e.target.closest('.sc-info'))return;  // keep the info "i" tooltip working
      if(tourActive)return;                    // demo: clicking does nothing
      var fst=$id('fst'); if(!fst)return;
      fst.value=val;
      fst.dispatchEvent(new Event('change',{bubbles:true}));  // runs doFilter + syncs UI + highlights card
      var anchor=$id('fbar'); if(anchor) window.scrollTo({top:Math.max(0,anchor.offsetTop-80),behavior:'smooth'});
    });
  });
}
