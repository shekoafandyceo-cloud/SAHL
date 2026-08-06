// عميل Supabase مزيّف — بيتحقن قبل أي سكربت في الصفحة (addInitScript).
// الهدف: تشغيل اللوحة بدخول أدمن حقيقي من غير أي طلب شبكة.
(function(){
  window.__calls = [];          // كل الاستعلامات اللي خرجت — للتأكيد بعدين
  var TENANT = 't-test-1';
  // كارت ترحيب الجولة بيغطي الشاشة لأدمن جديد ويمنع أي ضغطة — بنعلّمها خالصة.
  // المفتاح بالـuid حسب العقد الجديد (كان بالـtenantId قبل دفعة 3).
  try{ localStorage.setItem('sahl_tour_done_u1','1'); }catch(e){}

  // أوردرات ديمو: يومين محددين بتواريخ محلية معروفة
  function iso(d,h){ var x=new Date(); x.setDate(x.getDate()-d); x.setHours(h,30,0,0); return x.toISOString(); }
  function ymdLocal(d){ var x=new Date(); x.setDate(x.getDate()-d);
    return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); }
  window.__DAY1 = ymdLocal(1);   // إمبارح — 3 أوردرات
  window.__DAY2 = ymdLocal(2);   // أول إمبارح — 2 أوردر

  // كل أوردر فيه **كل** الأعمدة اللي الماليات/الإحصائيات ممكن تلمسها،
  // بقيم مميزة — عشان لو عمود اتنسي من ALL_COLS الأرقام تتغيّر وتتمسك.
  function mk(o){
    return Object.assign({
      tenant_id:TENANT, order_uid:'9000', tracking_no:'TRK000', customer_name:'عميل',
      phone:'01000000000', alt_phone:null, city:'القاهرة', address:'عنوان طويل للاختبار',
      product_name:'منتج أ (عدد 1)', total_cost:1000, payment_stage:'cod', platform:'fb',
      campaign_name:'حملة', real_shipping_fee:0, inventory_cost_snapshot:0,
      inventory_value_snapshot:0, inventory_value_at_bosta:0, packaging_cost:0,
      customer_notes:null, internal_notes:null, customer_ranking:null,
      cancel_requested_at:null, cancel_resolved_at:null, awb_print_count:0,
      status_changed_at:null, call_attempts:[], status_log:[{at:iso(3,9),to:'confirmed',by:'x'}],
      'var':null
    }, o);
  }
  var ORDERS = [
    mk({id:'o1', order_uid:'9001', status:'delivered',             total_cost:1000, created_at:iso(1,10), phone:'01000000001', product_name:'منتج أ (عدد 1)', tracking_no:'TRK001', real_shipping_fee:97,  inventory_cost_snapshot:610, platform:'fb',     payment_stage:'cod'}),
    mk({id:'o2', order_uid:'9002', status:'Received at warehouse', total_cost:1500, created_at:iso(1,12), phone:'01000000002', product_name:'منتج ب (عدد 2)', tracking_no:'TRK002', real_shipping_fee:0,   inventory_value_snapshot:820, platform:'ig',    payment_stage:'paymob'}),
    mk({id:'o3', order_uid:'9003', status:'pending',               total_cost:1200, created_at:iso(1,14), phone:'01000000003', product_name:'منتج ج (عدد 1)', tracking_no:null,     real_shipping_fee:0,   platform:'tiktok', payment_stage:'cod'}),
    mk({id:'o4', order_uid:'9004', status:'delivered',             total_cost:900,  created_at:iso(2,11), phone:'01000000004', product_name:'منتج أ (عدد 3)', tracking_no:'TRK004', real_shipping_fee:112, inventory_value_at_bosta:1830, platform:'fb', payment_stage:'paymob'}),
    mk({id:'o5', order_uid:'9005', status:'returned',              total_cost:800,  created_at:iso(2,13), phone:'01000000005', product_name:'منتج ب (عدد 1)', tracking_no:'TRK005', real_shipping_fee:88,  inventory_cost_snapshot:410, platform:'ig',    payment_stage:'cod'}),
    mk({id:'o6', order_uid:'9006', status:'cancelled',             total_cost:700,  created_at:iso(2,15), phone:'01000000006', product_name:'منتج ج (عدد 2)', tracking_no:null,     platform:'tiktok', payment_stage:'cod'})
  ];
  window.__ORDERS = ORDERS;

  // قطع الأعمدة زي PostgREST بالظبط — من غيره الستب بيرجّع الصف كامل
  // مهما طلب الكود، فتضييق الأعمدة يعدّي من الاختبار وهو ناقص.
  window.__project = true;
  function project(rows, cols){
    if(!window.__project || !cols || cols === '*' || cols.indexOf('*') >= 0) return rows;
    var keys = cols.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    return rows.map(function(r){
      var out = {};
      keys.forEach(function(k){ if(Object.prototype.hasOwnProperty.call(r,k)) out[k] = r[k]; });
      return out;
    });
  }

  var TABLES = {
    user_profiles: [{id:'u1', tenant_id:TENANT, role:'admin', active:true, full_name:'أدمن الاختبار'}],
    v_my_tenant:   [{id:TENANT, slug:'test', store_name:'متجر الاختبار', active:true, plan:'growth', plan_expires_at:null, subscription_status:'active', grace_period_days:3, monthly_price:0, shipping_provider:'bosta', created_at:iso(30,10)}],
    tenant_subscription_state: [{id:TENANT, computed_status:'active', days_remaining:30}],
    wallet_state:  [{tenant_id:TENANT, wallet_balance:500, overdraft_limit:0, available:500, orders_used_cycle:5, max_orders:1000, orders_remaining:995, overage_debt:0, plan:'growth', plan_name:'Growth', monthly_price:299, per_order_price:0.75, pricing_type:'monthly', subscription_status:'active', cycle_started_at:iso(10,0), cycle_ends_at:iso(-20,0), is_lifetime:false, is_depleted:false}],
    orders: ORDERS,
    v_stock_products: [{id:'p1', name:'منتج أ', current_qty:10, unit_price:1000, wholesale_price:600, active:true, tenant_id:TENANT}],
    stock_products: [],
    stock_movements: [],
    wa_conversations: [], wa_messages: [], wa_quick_replies: [],
    plans: [], wallet_transactions: [], topup_requests: [], expenses: [],
    platform_settings: [{key:'vfcash_number', value:'01000000000'}]
  };

  function rowsFor(table, st){
    // حركات المخزون بتتقري من window.__MOVEMENTS وقت الاستعلام مش وقت التحميل —
    // كده الاختبار يقدر يحقنها من غير ما يعتمد على ترتيب addInitScript،
    // والافتراضي [] عشان الاختبارات القديمة تفضل بنفس السلوك بالحرف.
    var rows = (table === 'stock_movements' ? (window.__MOVEMENTS || []) : (TABLES[table] || [])).slice();
    if(table === 'orders'){
      // نطبّق فلاتر التاريخ زي السيرفر بالظبط — ده جوهر الاختبار
      if(st.gte && st.gte.col === 'created_at') rows = rows.filter(function(o){ return o.created_at >= st.gte.val; });
      if(st.lt  && st.lt.col  === 'created_at') rows = rows.filter(function(o){ return o.created_at <  st.lt.val;  });
      if(st.eqStatus) rows = rows.filter(function(o){ return o.status === st.eqStatus; });
      if(st.inStatus) rows = rows.filter(function(o){ return st.inStatus.indexOf(o.status) >= 0; });
    }
    return rows;
  }

  function builder(table){
    var st = { table: table };
    var api = {};
    ['select','eq','in','is','not','gte','lt','lte','gt','ilike','or','order','range','limit','update','insert','delete','upsert'].forEach(function(m){
      api[m] = function(a, b){
        if(m === 'select') st.cols = a;
        if(m === 'gte' && a === 'created_at') st.gte = {col:a, val:b};
        if(m === 'lt'  && a === 'created_at') st.lt  = {col:a, val:b};
        if(m === 'eq'  && a === 'status')     st.eqStatus = b;
        if(m === 'in'  && a === 'status')     st.inStatus = b;
        if(m === 'range'){ st.from = a; st.to = b; }
        return api;
      };
    });
    api.maybeSingle = function(){ st.single = true; return api; };
    api.single      = function(){ st.single = true; return api; };
    api.then = function(res){
      window.__calls.push(JSON.parse(JSON.stringify(st)));
      if(window.__failOrders && table === 'orders' && String(st.cols||'').indexOf('created_at') >= 0){
        return Promise.resolve({data:null, error:{message:'شبكة مقطوعة (اختبار)'}}).then(res);
      }
      var rows = project(rowsFor(table, st), st.cols);
      var out = st.single ? {data: rows[0] || null, error:null} : {data: rows, error:null, count: rows.length};
      return Promise.resolve(out).then(res);
    };
    return api;
  }

  function statsFor(args){
    var rows = TABLES.orders.slice();
    if(args && args.p_from) rows = rows.filter(function(o){ return o.created_at.slice(0,10) >= args.p_from; });
    if(args && args.p_to)   rows = rows.filter(function(o){ return o.created_at.slice(0,10) <= args.p_to; });
    var D=['delivered','Delivered'], R=['returned','Returned to business'];
    var n=function(f){ return rows.filter(f).length; };
    var s=function(f){ return rows.filter(f).reduce(function(a,o){return a+(o.total_cost||0);},0); };
    return {total_count:rows.length, pending:n(function(o){return o.status==='pending';}),
      confirmed:n(function(o){return o.status==='confirmed';}), delivered:n(function(o){return D.indexOf(o.status)>=0;}),
      cancelled:n(function(o){return o.status==='cancelled';}), returned:n(function(o){return R.indexOf(o.status)>=0;}),
      bosta_ready:0, processed:n(function(o){return o.status!=='pending';}), positive:n(function(o){return o.status!=='pending';}),
      sum_total:s(function(){return true;}), sum_collected:s(function(o){return D.indexOf(o.status)>=0;}),
      sum_expected:0, sum_lost:0, sum_paymob:0};
  }

  var chan = {}; ['on'].forEach(function(m){ chan[m]=function(){ return chan; }; });
  chan.subscribe = function(cb){ if(cb) setTimeout(function(){ cb('SUBSCRIBED'); },0); return chan; };

  var client = {
    auth: {
      // access_token لازم يكون موجود — الكود بيقراه عشان ينادي الـEdge Functions
      // (staff.js و wa-verify-number). من غيره النداء بيفشل بـ«الجلسة انتهت».
      getSession: function(){ return Promise.resolve({data:{session:{user:{id:'u1', email:'admin@test.local'}, access_token:'stub-jwt'}}, error:null}); },
      getUser:    function(){ return Promise.resolve({data:{user:{id:'u1', email:'admin@test.local', user_metadata:{}}}, error:null}); },
      signOut:    function(){ return Promise.resolve({error:null}); },
      onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; }
    },
    from: builder,
    rpc: function(name, args){
      window.__calls.push({rpc:name, args:args||null});
      if(name === 'sahl_orders_stats') return Promise.resolve({data: statsFor(args), error:null});
      if(name === 'wa_inbox_status')   return Promise.resolve({data:{verified:false}, error:null});
      return Promise.resolve({data:null, error:null});
    },
    channel: function(){ return chan; },
    removeChannel: function(){},
    storage: { from: function(){ return {
      createSignedUrls: function(){ return Promise.resolve({data:[], error:null}); },
      upload: function(){ return Promise.resolve({data:null, error:{message:'stub'}}); }
    }; } },
    functions: { invoke: function(){ return Promise.resolve({data:{ok:false}, error:null}); } }
  };

  // اعتراض نداءات Edge Functions — بيتفعّل بس لو الاختبار حط window.__FN
  // (الافتراضي مطفي فالاختبارات القديمة بنفس سلوكها بالحرف)
  var _fetch = window.fetch;
  window.fetch = function(url, opt){
    var u = String(url || '');
    if(window.__FN && u.indexOf('/functions/v1/') >= 0){
      var slug = u.split('/functions/v1/')[1].split('?')[0];
      var body = {};
      try{ body = JSON.parse((opt && opt.body) || '{}'); }catch(e){}
      window.__FNCALLS = window.__FNCALLS || [];
      window.__FNCALLS.push({ slug: slug, body: body, auth: !!(opt && opt.headers && opt.headers.Authorization) });
      var out = window.__FN(slug, body);
      return Promise.resolve({
        ok: out.status ? out.status < 400 : true,
        status: out.status || 200,
        json: function(){ return Promise.resolve(out.body); }
      });
    }
    return _fetch.apply(window, arguments);
  };

  window.supabase = { createClient: function(){ return client; } };
})();
