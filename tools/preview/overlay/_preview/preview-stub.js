/* ══════════════════════════════════════════════════════════════════════
   وضع المعاينة — عميل Supabase مزيّف بداتا وهمية.
   الصفحة دي **مابتلمسش الداتابيز خالص**: مفيش أي طلب شبكة لسوبابيز،
   ومفيش أي احتمال إنك تغيّر أوردر حقيقي أو تبعت رسالة واتساب.
   أي «حفظ» هنا بيرجّع نجاح وهمي وخلاص.
   الملف ده للمعاينة المحلية بس — عمره ما يتنشر.
   ══════════════════════════════════════════════════════════════════════ */
(function(){
  // المعاينة: التيكر أسرع عشان علامة الجدول تتقلب قدام عين المجرّب
  window.__SHIP_TICK_MS = 7000;
  window.__SHIP_STALE_MIN = 0.35;   // 21 ثانية — عشان تجربة «المحاولة ماكملتش» تبان قدام المجرّب

  var TENANT = 'preview-tenant';
  var UID    = 'preview-user';
  try{ localStorage.setItem('sahl_tour_done_' + UID, '1'); }catch(e){}

  function iso(daysAgo, h, m){
    var d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h||12, m||0, 0, 0);
    return d.toISOString();
  }
  function ymd(daysAgo){
    var d = new Date(); d.setDate(d.getDate() - daysAgo);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  var NAMES = ['منى عبد الرحمن','سارة إبراهيم','هدى مصطفى','نورهان سيد','ياسمين فتحي',
               'أميرة كمال','دعاء حسن','مروة السيد','رانيا عادل','شيماء محمود',
               'إنجي طارق','فاطمة الزهراء','نجلاء عصام','ملك أشرف','جيهان رمزي'];
  var CITIES = ['القاهرة','الجيزة','الإسكندرية','الدقهلية','الشرقية','القليوبية'];
  var ADDRS  = ['مدينة نصر، شارع عباس العقاد، عمارة 15، الدور 3، شقة 7',
                'المهندسين، شارع جامعة الدول العربية، برج النيل، الدور 9',
                'سموحة، شارع فوزي معاذ، عمارة 22، الدور 5، شقة 11',
                'المنصورة، شارع الجمهورية، أمام مستشفى الطوارئ، عمارة 4',
                'التجمع الخامس، الحي الأول، فيلا 88',
                'شبرا الخيمة، شارع ترعة الجبل، عمارة 31، الدور 2'];
  var PRODUCTS = ['ترولي 2 دور ب ترابيزة خشب ايكيا','منظم المطبخ المتكامل',
                  'تيربو بريمو 5 دور','استاند أمريكانا','رف حائط خشب زان'];
  var PLATFORMS = ['facebook','instagram','tiktok','whatsapp'];
  var STATUSES = [
    'pending','pending','pending','confirmed','confirmed',
    'bosta_assigned','BOSTA AUTO','BOSTA2','Out for delivery','Received at warehouse',
    'delivered','Delivered','Delivered','Delivered','returned',
    'cancelled','Exception','Route Assigned'
  ];

  var ORDERS = [];
  for(var i = 0; i < 46; i++){
    var st   = STATUSES[i % STATUSES.length];
    var days = i % 26;                         // موزّعين على الشهر عشان الكالندر يبان
    var prod = PRODUCTS[i % PRODUCTS.length];
    var qty  = (i % 3) + 1;
    var shipped = ['delivered','Delivered','returned','Returned to business'].indexOf(st) >= 0;
    ORDERS.push({
      id:'ord-'+i, tenant_id:TENANT,
      shipping_requested_at:null, line_prices:null,
      // شارة 🔼 — نفس الأوردرات اللي ليها حركة upsell (ord-0 … ord-8)
      has_upsell: i < 9,
      order_uid:String(10400 + i),
      tracking_no: (st === 'pending' || st === 'confirmed' || st === 'cancelled') ? null : ('7'+(31200000 + i*137)),
      customer_name: NAMES[i % NAMES.length],
      phone:'010' + String(20000000 + i*13571).slice(0,8),
      alt_phone: i % 5 === 0 ? '011' + String(40000000 + i*911).slice(0,8) : null,
      city: CITIES[i % CITIES.length],
      address: ADDRS[i % ADDRS.length],
      product_name: prod + ' (عدد ' + qty + ')',
      total_cost: 615 + (i % 7) * 95,
      status: st,
      payment_stage: i % 6 === 0 ? 'paymob' : 'cod',
      platform: PLATFORMS[i % PLATFORMS.length],
      campaign_name: 'CMP-' + (2100 + (i % 5)),
      created_at: iso(days, 9 + (i % 11), (i * 7) % 60),
      status_changed_at: iso(Math.max(0, days - 1), 14, 0),
      customer_notes: i % 7 === 0 ? 'من فضلك الاتصال قبل التسليم بساعة' : null,
      internal_notes: i % 9 === 0 ? 'العميلة طلبت تأجيل التسليم للأسبوع الجاي' : null,
      customer_ranking: i % 4 === 0 ? (55 + (i % 45)) : null,
      customer_ranking_at: i % 4 === 0 ? iso(days, 15, 0) : null,
      real_shipping_fee: shipped ? (85 + (i % 4) * 9) : 0,
      inventory_cost_snapshot: 380 + (i % 5) * 45,
      inventory_value_snapshot: 0,
      inventory_value_at_bosta: 0,
      packaging_cost: 0,
      awb_print_count: (st.indexOf('BOSTA') === 0 || st === 'bosta_assigned') ? (i % 2) : 0,
      awb_printed_at: null,
      cancel_requested_at: i === 5 ? iso(1, 11, 20) : null,
      cancel_resolved_at: null,
      cancel_reason: st === 'cancelled' ? 'العميلة غيّرت رأيها' : null,
      bosta_size:null, bosta_delivery_id:null, real_shipping_fee_at:null,
      stock_deducted_at:null, stock_returned_at:null, billed_at:null, wa_charged_at:null,
      'var': i % 3 === 0 ? 'أسود' : null,
      // خصائص المنتج كاملة من الويبهوك — المعاينة بترندر منها مش من الداتابيز
      manufacturer_note: i % 3 === 0 ? 'أسود 4 أدوار' : (i % 3 === 1 ? 'مقاس 85 عرض' : null),
      manufacturer_cost: i % 3 === 0 ? 375 : null,
      call_attempts: i % 4 === 0 ? [
        {time:'05/08/2026، 11:20', iso: iso(1,11,20), result:'no_answer', note:'', by:'سارة'},
        {time:'05/08/2026، 14:05', iso: iso(1,14,5),  result:'confirmed', note:'أكدت الأوردر', by:'سارة'}
      ] : [],
      status_log: [
        {from:null, to:'pending',   at: iso(days, 9, 0),  by:'النظام', reason:null},
        {from:'pending', to:'confirmed', at: iso(days, 12, 0), by:'واتساب', reason:null}
      ].concat(shipped ? [{from:'confirmed', to:st, at: iso(Math.max(0,days-2), 16, 0), by:'شركة الشحن', reason:null}] : [])
    });
  }

  // منتجات المخزون — أول منتج عيلة بخصائص (ألوان) عشان الميزة تبان في المعاينة
  var STOCK = PRODUCTS.map(function(nm, i){
    return { id:'prd-'+i, tenant_id:TENANT, name:nm, active:true,
             current_qty: [3, 62, 9, 0, 109][i],
             unit_price:  [615, 1000, 630, 450, 320][i],
             wholesale_price: [380, 640, 395, 260, 190][i],
             parent_id:null, variant_label:null };
  });
  [['أسود',28],['أبيض',12],['روز',3]].forEach(function(v, k){
    STOCK.push({ id:'prd-0-v'+k, tenant_id:TENANT, name:PRODUCTS[0]+' — '+v[0], active:true,
                 current_qty:v[1], unit_price:615, wholesale_price:380,
                 parent_id:'prd-0', variant_label:v[0] });
  });

  // حركات المخزون — ده اللي عمود التاريخ بيتجرّب عليه
  var MOVES = [];
  for(var k = 0; k < 22; k++){
    var out = k % 3 !== 0;
    MOVES.push({
      id:'mv-'+k, tenant_id:TENANT,
      product_id:'prd-'+(k % PRODUCTS.length),
      product_name: PRODUCTS[k % PRODUCTS.length],
      movement_type: out ? 'out' : 'in',
      qty_in:  out ? 0 : ((k % 4) + 1),
      qty_out: out ? 1 : 0,
      created_at: iso(k % 9, 9 + (k % 12), (k * 11) % 60),
      movement_date: ymd(k % 9),
      tracking_no: out ? String(3576415002 + k * 9137) : null,
      notes: out ? null : 'توريد من المورّد'
    });
  }

  var TABLES = {
    user_profiles: [{ id:UID, tenant_id:TENANT, role:'admin', active:true, full_name:'أدمن المعاينة', is_super_admin:false }],
    v_my_tenant: [{ id:TENANT, slug:'preview', store_name:'متجر المعاينة', active:true, plan:'payg',
      plan_expires_at:null, subscription_status:'active', grace_period_days:3, monthly_price:0,
      shipping_provider:'bosta', created_at: iso(120, 10, 0),
      whatsapp_phone_id:'', whatsapp_token:'', shipping_api_key:'b_preview_key', has_shipping_api:true,
      telegram_chat_id:'', telegram_chat_id_set_at:null, error_notify_chat:'',
      whatsapp_confirmation_enabled:true,
      webhook_secret:'preview-webhook-secret', wa_webhook_secret:'preview-wa-secret' }],
    tenant_subscription_state: [{ id:TENANT, computed_status:'active', days_remaining:30 }],
    wallet_state: [{ tenant_id:TENANT, wallet_balance:340, overdraft_limit:0, available:340,
      orders_used_cycle:46, max_orders:null, orders_remaining:null, overage_debt:0,
      plan:'payg', plan_name:'الدفع مقابل الاستخدام', monthly_price:0, per_order_price:1.5,
      pricing_type:'payg', subscription_status:'active',
      cycle_started_at: iso(6,0,0), cycle_ends_at: iso(-24,0,0), is_lifetime:false, is_depleted:false }],
    upsell_events: (function(){
      var U=[]; var who=[['s2','سارة إبراهيم','percent',10],['s3','عمر حسن','fixed',25]];
      for(var i=0;i<9;i++){ var w=who[i%2]; var d=200+(i%4)*150;
        U.push({ id:'ue'+i, tenant_id:TENANT, order_id:'ord-'+i, user_id:w[0], user_name:w[1],
          before_total:500+i*50, after_total:500+i*50+d, delta:d, commission_type:w[2],
          commission_rate:w[3], commission_amount: w[2]==='percent'? Math.round(d*w[3]/100) : w[3],
          status:['pending','earned','earned','void'][i%4], resolved_at:null, created_at:iso(i%8,10,0) }); }
      return U;
    })(),
    // التسويات + أرصدة الموظفين — عشان المعاينة تعرض الميزة الجديدة كاملة
    commission_settlements: [
      { id:'st1', tenant_id:TENANT, user_id:'s2', user_name:'سارة إبراهيم', amount:40,
        kind:'settlement', reverses_id:null, note:'مرتب أغسطس', created_by_name:'أدمن المعاينة',
        created_at: iso(3,12,0) },
      { id:'st2', tenant_id:TENANT, user_id:'s3', user_name:'عمر حسن', amount:90,
        kind:'settlement', reverses_id:null, note:null, created_by_name:'أدمن المعاينة',
        created_at: iso(5,12,0) },
      { id:'st3', tenant_id:TENANT, user_id:'s3', user_name:'عمر حسن', amount:-25,
        kind:'reversal', reverses_id:'st2', note:'الأوردر رجع بعد الصرف',
        created_by_name:'أدمن المعاينة', created_at: iso(2,12,0) }
    ],
    v_commission_balances: [],   // بتتحسب تحت من الحركات والتسويات
    orders: ORDERS,
    v_stock_products: STOCK,
    stock_products: STOCK,
    stock_movements: MOVES,
    wa_conversations: [], wa_messages: [], wa_quick_replies: [],
    plans: [], wallet_transactions: [], topup_requests: [], expenses: [],
    platform_settings: [{ key:'telegram_bot_username', value:'sahl_operations_bot' },
                        { key:'vfcash_number', value:'01000000000' }]
  };

  // الأرصدة بتتحسب من الحركات والتسويات — مش أرقام مكتوبة بالإيد،
  // عشان لو المعاينة اتغيّرت داتاها الكروت تفضل متسقة مع الجداول.
  (function(){
    var by = {};
    TABLES.upsell_events.forEach(function(e){
      var b = by[e.user_id] || (by[e.user_id] = { user_id:e.user_id, user_name:e.user_name,
        events_count:0, pending_total:0, earned_total:0, void_total:0,
        settled_total:0, settlements_count:0, outstanding:0 });
      b.events_count++;
      if(e.status === 'pending') b.pending_total += Number(e.commission_amount||0);
      else if(e.status === 'earned') b.earned_total += Number(e.commission_amount||0);
      else b.void_total += Number(e.commission_amount||0);
    });
    TABLES.commission_settlements.forEach(function(x){
      var b = by[x.user_id] || (by[x.user_id] = { user_id:x.user_id, user_name:x.user_name,
        events_count:0, pending_total:0, earned_total:0, void_total:0,
        settled_total:0, settlements_count:0, outstanding:0 });
      b.settled_total += Number(x.amount||0);
      b.settlements_count++;
    });
    TABLES.v_commission_balances = Object.keys(by).map(function(k){
      var b = by[k]; b.outstanding = b.earned_total - b.settled_total; return b;
    });
  })();

  // قطع الأعمدة زي PostgREST — عشان المعاينة تتصرّف زي السيرفر بالظبط
  function project(rows, cols){
    if(!cols || cols === '*' || String(cols).indexOf('*') >= 0) return rows;
    var keys = String(cols).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    return rows.map(function(r){
      var o = {}; keys.forEach(function(k){ if(k in r) o[k] = r[k]; }); return o;
    });
  }

  function rowsFor(t, st){
    var rows = (TABLES[t] || []).slice();
    if(t === 'orders'){
      if(st.gte) rows = rows.filter(function(o){ return o.created_at >= st.gte; });
      if(st.lt)  rows = rows.filter(function(o){ return o.created_at <  st.lt;  });
      if(st.eqId) rows = rows.filter(function(o){ return o.id === st.eqId; });
      if(st.eqStatus) rows = rows.filter(function(o){ return o.status === st.eqStatus; });
      if(st.inStatus) rows = rows.filter(function(o){ return st.inStatus.indexOf(o.status) >= 0; });
      if(st.eqPhone)  rows = rows.filter(function(o){ return o.phone === st.eqPhone; });
      rows.sort(function(a,b){ return a.created_at < b.created_at ? 1 : -1; });
    }
    if(t === 'stock_movements') rows.sort(function(a,b){ return a.created_at < b.created_at ? 1 : -1; });
    return rows;
  }

  function builder(table){
    var st = { table: table }, writing = false;
    var api = {};
    ['select','eq','in','is','not','gte','lt','lte','gt','ilike','or','order','range','limit']
      .forEach(function(m){
        api[m] = function(a, b){
          if(m === 'select') st.cols = a;
          if(m === 'gte' && a === 'created_at') st.gte = b;
          if(m === 'lt'  && a === 'created_at') st.lt  = b;
          if(m === 'eq'){ if(a === 'status') st.eqStatus = b; if(a === 'id') st.eqId = b; if(a === 'phone') st.eqPhone = b; }
          if(m === 'in'  && a === 'status') st.inStatus = b;
          return api;
        };
      });
    ['update','insert','delete','upsert'].forEach(function(m){
      api[m] = function(){ writing = true; return api; };
    });
    api.maybeSingle = function(){ st.single = true; return api; };
    api.single      = function(){ st.single = true; return api; };
    api.then = function(res){
      // الكتابة بترجّع نجاح وهمي — مفيش أي حاجة بتتغيّر في أي مكان
      if(writing) return Promise.resolve({ data:null, error:null }).then(res);
      var rows = project(rowsFor(table, st), st.cols);
      return Promise.resolve(st.single
        ? { data: rows[0] || null, error:null }
        : { data: rows, error:null, count: rows.length }).then(res);
    };
    return api;
  }

  function stats(args){
    var rows = TABLES.orders.slice();
    if(args && args.p_from) rows = rows.filter(function(o){ return o.created_at.slice(0,10) >= args.p_from; });
    if(args && args.p_to)   rows = rows.filter(function(o){ return o.created_at.slice(0,10) <= args.p_to; });
    var D = ['delivered','Delivered'], R = ['returned','Returned to business','Returned to business2'];
    var B = ['bosta_assigned','BOSTA AUTO','BOSTA2','Out for delivery','Received at warehouse','Route Assigned','Exception'];
    var n = function(f){ return rows.filter(f).length; };
    var s = function(f){ return rows.filter(f).reduce(function(a,o){ return a + (o.total_cost||0); }, 0); };
    return { total_count: rows.length,
      pending:   n(function(o){ return o.status === 'pending'; }),
      confirmed: n(function(o){ return o.status === 'confirmed'; }),
      delivered: n(function(o){ return D.indexOf(o.status) >= 0; }),
      cancelled: n(function(o){ return o.status === 'cancelled'; }),
      returned:  n(function(o){ return R.indexOf(o.status) >= 0; }),
      bosta_ready: n(function(o){ return ['bosta_assigned','BOSTA AUTO','BOSTA2'].indexOf(o.status) >= 0; }),
      processed: n(function(o){ return o.status !== 'pending'; }),
      positive:  n(function(o){ return o.status !== 'pending'; }),
      sum_total:     s(function(){ return true; }),
      sum_collected: s(function(o){ return D.indexOf(o.status) >= 0; }),
      sum_expected:  s(function(o){ return B.indexOf(o.status) >= 0; }),
      sum_lost:      s(function(o){ return R.indexOf(o.status) >= 0 || o.status === 'cancelled'; }),
      sum_paymob:    s(function(o){ return o.payment_stage === 'paymob'; }) };
  }

  var chan = { on: function(){ return chan; },
               subscribe: function(cb){ if(cb) setTimeout(function(){ cb('SUBSCRIBED'); }, 0); return chan; } };

  // زرار «شحن أوتوماتيك» بينده Edge Function بـfetch مباشر — في المعاينة
  // بنمثّل الرحلة: رد ok فوري، وبعد ~4 ثواني «البوليصة بتتعمل» فالتتبع
  // يظهر والـpoll يلقطه — نفس إيقاع الإنتاج (12–30ث) بس أسرع للتجربة.
  var _fetch = window.fetch;
  window.fetch = function(url, opt){
    var u = String(url || '');
    if(u.indexOf('/functions/v1/order-ship') >= 0){
      var body = {}; try{ body = JSON.parse((opt && opt.body) || '{}'); }catch(e){}
      var mo = TABLES.orders.filter(function(o){ return o.id === body.order_id; })[0];
      if(mo && !(mo.tracking_no||'')){
        // كل تالت محاولة «بتفشل في صمت» (زي n8n لما يقع) — عشان المالك
        // يشوف العلامة الصفرا ورسالة «ماكملتش» بنفسه في المعاينة
        window.__shipSim = (window.__shipSim||0)+1;
        if(window.__shipSim % 3 !== 0)
          setTimeout(function(){ mo.tracking_no = '7' + String(90000000 + Math.floor(Math.random()*9999999)); mo.status = 'BOSTA AUTO'; }, 4000);
        var ra = new Date().toISOString(); mo.shipping_requested_at = ra;
        return Promise.resolve(new Response(JSON.stringify({ ok:true, requested_at: ra }), { status:200, headers:{'Content-Type':'application/json'} }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error:'already_has_tracking', message:'الأوردر له بوليصة بالفعل' }), { status:409, headers:{'Content-Type':'application/json'} }));
    }
    if(u.indexOf('/functions/v1/') >= 0){
      return Promise.resolve(new Response(JSON.stringify({ ok:false, message:'وضع المعاينة' }), { status:200, headers:{'Content-Type':'application/json'} }));
    }
    return _fetch.apply(this, arguments);
  };

  var client = {
    auth: {
      getSession: function(){ return Promise.resolve({ data:{ session:{ user:{ id:UID, email:'preview@sahl.local' }, access_token:'preview' } }, error:null }); },
      getUser:    function(){ return Promise.resolve({ data:{ user:{ id:UID, email:'preview@sahl.local', user_metadata:{} } }, error:null }); },
      signInWithPassword: function(){ return Promise.resolve({ data:{ user:{ id:UID, email:'preview@sahl.local' } }, error:null }); },
      signOut:    function(){ return Promise.resolve({ error:null }); },
      onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; }
    },
    from: builder,
    rpc: function(name, args){
      if(name === 'save_order_products'){
      // بنكتب في صف المعاينة فعلاً — عشان الجدول والفلاتر يعكسوا السعر الجديد
      var so = TABLES.orders.filter(function(o){ return o.id === (args&&args.p_order_id); })[0];
      if(so){ so.product_name = args.p_product_name; if(args.p_total_cost != null) so.total_cost = args.p_total_cost; if(args.p_prices != null) so.line_prices = args.p_prices; }
      var amt = args && args.p_total_cost != null ? Math.round(args.p_total_cost * 0.02) : null;
      return Promise.resolve({ data:{ order:{ id:args.p_order_id, product_name:args.p_product_name,
        total_cost:args.p_total_cost }, upsell: amt ? { commission_amount:amt, status:'pending' } : null }, error:null });
    }
    if(name === 'set_upsell_commission') return Promise.resolve({ data:{ ok:true }, error:null });
    if(name === 'settle_commission' || name === 'reverse_settlement')
      return Promise.resolve({ data:{ ok:true }, error:null });
    if(name === 'mark_shipped_manual'){
      var mo = TABLES.orders.filter(function(o){ return o.id === args.p_order_id; })[0];
      if(!mo) return Promise.resolve({ data:null, error:{ message:'order_not_found' } });
      if((mo.tracking_no||'')) return Promise.resolve({ data:null, error:{ message:'already_has_tracking' } });
      mo.status = 'bosta_assigned';
      if(args.p_tracking) mo.tracking_no = args.p_tracking;
      return Promise.resolve({ data:{ ok:true }, error:null });
    }
    if(name === 'sahl_orders_stats') return Promise.resolve({ data: stats(args), error:null });
      if(name === 'wa_inbox_status')   return Promise.resolve({ data:{ verified:false, has_number:false, has_token:false, sahl_ready:false, wa_enabled:true }, error:null });
      if(name === 'get_notify_prefs')  return Promise.resolve({ data:{}, error:null });
      return Promise.resolve({ data:null, error:null });
    },
    channel: function(){ return chan; },
    removeChannel: function(){},
    storage: { from: function(){ return {
      createSignedUrls: function(){ return Promise.resolve({ data:[], error:null }); },
      upload: function(){ return Promise.resolve({ data:null, error:{ message:'المعاينة مابترفعش ملفات' } }); }
    }; } },
    functions: { invoke: function(){ return Promise.resolve({ data:{ ok:false, message:'وضع المعاينة' }, error:null }); } }
  };

  // موظفين وهميين — نداء Edge Function `tenant-staff` بيتعمله اعتراض هنا
  var STAFF = [
    { id:'preview-user', email:'preview@sahl.local', full_name:'أدمن المعاينة', role:'admin',
      active:true, last_seen:new Date().toISOString(), is_self:true, locked:true },
    { id:'s2', email:'sara@preview.local', full_name:'سارة إبراهيم', role:'employee',
      active:true, last_seen:null, is_self:false, locked:false,
      upsell_commission_enabled:true, upsell_commission_type:'percent', upsell_commission_value:10 },
    { id:'s3', email:'omar@preview.local', full_name:'عمر حسن', role:'employee',
      active:false, last_seen:null, is_self:false, locked:false }
  ];
  var _fetch = window.fetch;
  window.fetch = function(url, opt){
    var u = String(url || '');
    if(u.indexOf('/functions/v1/tenant-staff') >= 0){
      var body = {}; try{ body = JSON.parse((opt && opt.body) || '{}'); }catch(e){}
      var out = { ok:true };
      if(body.action === 'list') out.users = STAFF;
      else if(body.action === 'create'){
        STAFF = STAFF.concat([{ id:'s'+(STAFF.length+1), email:body.email, full_name:body.full_name,
          role:body.role, active:true, last_seen:null, is_self:false, locked:false }]);
      }
      else if(body.action === 'toggle') STAFF = STAFF.map(function(x){ return x.id===body.user_id?Object.assign({},x,{active:body.active}):x; });
      else if(body.action === 'delete') STAFF = STAFF.filter(function(x){ return x.id !== body.user_id; });
      return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve(out); } });
    }
    return _fetch.apply(window, arguments);
  };

  // لازم بعد سكربت الـCDN عشان مايتكتبش فوقه
  window.supabase = { createClient: function(){ return client; } };

  // شريحة تنبيه في الركن — مش شريط عريض، عشان ماتغطيش صفوف الجدول
  document.addEventListener('DOMContentLoaded', function(){
    var chip = document.createElement('div');
    chip.textContent = '🧪 وضع المعاينة — داتا وهمية';
    chip.title = 'مفيش أي اتصال بالداتابيز. أي «حفظ» هنا مابيعملش حاجة.';
    chip.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:99999;background:#7c3aed;'
      + 'color:#fff;font:800 12px Cairo,sans-serif;padding:6px 12px;border-radius:999px;'
      + 'box-shadow:0 6px 18px rgba(124,58,237,.45);pointer-events:none;opacity:.92;';
    document.body.appendChild(chip);
  });
})();
