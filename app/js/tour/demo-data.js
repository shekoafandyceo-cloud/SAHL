// بيانات تجريبية للجولة — أوردرات ومصاريف ومخزون وحركات

// ---- demo orders shown only during the tour ----
export function tourDemoOrders(){
  var now=Date.now();
  function iso(mins){ return new Date(now - mins*60000).toISOString(); }
  function thisMonth(daysAgo){
    var d=new Date();
    d.setDate(Math.max(1, d.getDate()-daysAgo));
    return d.toISOString();
  }
  return [
    { id:'demo-1042', order_uid:'DEMO-1042', customer_name:'محمد عبد الرحمن', phone:'01012345678', city:'القاهرة',
      address:'٢٧ شارع التحرير، الدقي، الجيزة', product_name:'تيربو بريمو ٥ دور', total_cost:1290,
      status:'pending', platform:'fb', payment_stage:'cod', tracking_no:'', created_at:thisMonth(0),
      call_attempts:[{iso:iso(40),result:'no_answer',by:'سارة'}],
      status_log:[{to:'pending',at:iso(120),by:'النظام'}] },
    { id:'demo-1041', order_uid:'DEMO-1041', customer_name:'إسراء طارق', phone:'01122223333', city:'الإسكندرية',
      address:'١٢ شارع فؤاد، محطة الرمل', product_name:'مطبقية ريكي ٢ دور', total_cost:980,
      status:'confirmed', platform:'ig', payment_stage:'cod', tracking_no:'', created_at:thisMonth(1),
      call_attempts:[{iso:iso(200),result:'confirmed',by:'سارة'}],
      status_log:[{to:'pending',at:iso(300),by:'النظام'},{to:'confirmed',at:iso(200),by:'سارة'}] },
    { id:'demo-1040', order_uid:'DEMO-1040', customer_name:'كريم فؤاد', phone:'01298765432', city:'المنصورة',
      address:'برج النيل، شارع الجمهورية', product_name:'استاند أمريكانا', total_cost:1150,
      status:'Out for delivery', platform:'fb', payment_stage:'cod', tracking_no:'BOS-77310', created_at:thisMonth(2),
      status_log:[{to:'pending',at:iso(900),by:'النظام'},{to:'confirmed',at:iso(800),by:'سارة'},{to:'OUT',at:iso(120),by:'أحمد (سكانر)'}] },
    { id:'demo-1039', order_uid:'DEMO-1039', customer_name:'نورهان سامح', phone:'01033334444', city:'طنطا',
      address:'شارع البحر، أمام المستشفى', product_name:'ترابيزة IKEA', total_cost:1420,
      status:'Delivered', platform:'tiktok', payment_stage:'cod', tracking_no:'BOS-77280', created_at:thisMonth(3),
      status_log:[{to:'pending',at:iso(2000),by:'النظام'},{to:'confirmed',at:iso(1900),by:'سارة'},{to:'OUT',at:iso(1500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(800),by:'شركة الشحن'}] },
    { id:'demo-1038', order_uid:'DEMO-1038', customer_name:'يوسف الديب', phone:'01555556666', city:'القاهرة',
      address:'مدينة نصر، الحي السابع', product_name:'ترولي خشب ايكيا', total_cost:870,
      status:'cancelled', platform:'fb', payment_stage:'cod', tracking_no:'', created_at:thisMonth(4),
      cancel_reason:'العميل غيّر رأيه',
      call_attempts:[{iso:iso(600),result:'refused',by:'سارة'}],
      status_log:[{to:'pending',at:iso(900),by:'النظام'},{to:'cancelled',at:iso(600),by:'سارة — السبب: العميل غيّر رأيه'}] },
    { id:'demo-1037', order_uid:'DEMO-1037', customer_name:'مريم حسن', phone:'01066667777', city:'الفيوم',
      address:'شارع الحرية، وسط البلد', product_name:'تيربو بريمو ٥ دور', total_cost:1290,
      status:'Returned to business', platform:'ig', payment_stage:'cod', tracking_no:'BOS-77199', created_at:thisMonth(6),
      status_log:[{to:'pending',at:iso(3000),by:'النظام'},{to:'confirmed',at:iso(2900),by:'سارة'},{to:'OUT',at:iso(2500),by:'أحمد (سكانر)'},{to:'Returned to business',at:iso(1200),by:'شركة الشحن'}] },
    { id:'demo-1036', order_uid:'DEMO-1036', customer_name:'أحمد صبري', phone:'01077778888', city:'القاهرة',
      address:'العباسية، شارع الأمير', product_name:'مطبقية ريكي ٢ دور', total_cost:980,
      status:'Delivered', platform:'fb', payment_stage:'cod', tracking_no:'BOS-77150', created_at:thisMonth(6),
      status_log:[{to:'pending',at:iso(4000),by:'النظام'},{to:'confirmed',at:iso(3900),by:'سارة'},{to:'OUT',at:iso(3500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(2800),by:'شركة الشحن'}] },
    { id:'demo-1035', order_uid:'DEMO-1035', customer_name:'فاطمة علي', phone:'01099990000', city:'الجيزة',
      address:'الهرم، شارع الملك فيصل', product_name:'استاند أمريكانا', total_cost:1150,
      status:'Delivered', platform:'ig', payment_stage:'cod', tracking_no:'BOS-77080', created_at:thisMonth(7),
      status_log:[{to:'pending',at:iso(5000),by:'النظام'},{to:'confirmed',at:iso(4900),by:'سارة'},{to:'OUT',at:iso(4500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(3800),by:'شركة الشحن'}] },
    { id:'demo-1034', order_uid:'DEMO-1034', customer_name:'عمر خالد', phone:'01511112222', city:'الإسكندرية',
      address:'سيدي جابر، شارع أبو قير', product_name:'ترابيزة IKEA', total_cost:1420,
      status:'Delivered', platform:'tiktok', payment_stage:'cod', tracking_no:'BOS-77010', created_at:thisMonth(8),
      status_log:[{to:'pending',at:iso(6000),by:'النظام'},{to:'confirmed',at:iso(5900),by:'سارة'},{to:'OUT',at:iso(5500),by:'أحمد (سكانر)'},{to:'Delivered',at:iso(4800),by:'شركة الشحن'}] }
  ];
}

export function tourDemoExpenses(){
  // date each expense on the SAME day as a delivered order (3,7,8 days ago) so the
  // daily profit chart never dips below zero during the tour — delivered revenue
  // on that day always covers the expense.
  function onDay(daysAgo){
    var d=new Date();
    d.setDate(Math.max(1, d.getDate()-daysAgo));
    return d.toISOString().slice(0,10);
  }
  return [
    {id:'de1', category:'إعلانات فيسبوك', amount:400, expense_date:onDay(8), note:'حملة إعلانية'},
    {id:'de2', category:'إعلانات فيسبوك', amount:400, expense_date:onDay(7), note:'حملة إعلانية'},
    {id:'de3', category:'إعلانات فيسبوك', amount:400, expense_date:onDay(3), note:'حملة إعلانية'},
    {id:'de4', category:'مرتبات', amount:300, expense_date:onDay(6), note:'عمولة تأكيد'},
    {id:'de5', category:'تغليف', amount:100, expense_date:onDay(8), note:'كراتين وشريط'}
  ];
}

export function tourDemoStock(){
  return [
    {id:'ds1', name:'تيربو بريمو ٥ دور', current_qty:14, wholesale_price:520, unit_price:1290, active:true},
    {id:'ds2', name:'مطبقية ريكي ٢ دور', current_qty:9, wholesale_price:430, unit_price:980, active:true},
    {id:'ds3', name:'استاند أمريكانا', current_qty:6, wholesale_price:510, unit_price:1150, active:true},
    {id:'ds4', name:'ترابيزة IKEA', current_qty:4, wholesale_price:640, unit_price:1420, active:true},
    {id:'ds5', name:'ترولي خشب ايكيا', current_qty:0, wholesale_price:360, unit_price:870, active:true}
  ];
}

export function tourDemoMovements(){
  var now=Date.now();
  function iso(mins){ return new Date(now - mins*60000).toISOString(); }
  function dOnly(mins){ return new Date(now - mins*60000).toISOString().slice(0,10); }
  return [
    {id:'dm1', product_id:'ds4', product_name:'ترابيزة IKEA', movement_type:'out', qty_in:0, qty_out:1, created_at:iso(1500), movement_date:dOnly(1500), tracking_no:'BOS-77280', notes:'خروج مع شركة الشحن — DEMO-1039'},
    {id:'dm2', product_id:'ds3', product_name:'استاند أمريكانا', movement_type:'out', qty_in:0, qty_out:1, created_at:iso(120), movement_date:dOnly(120), tracking_no:'BOS-77310', notes:'خروج مع شركة الشحن — DEMO-1040'},
    {id:'dm3', product_id:'ds1', product_name:'تيربو بريمو ٥ دور', movement_type:'in', qty_in:1, qty_out:0, created_at:iso(1200), movement_date:dOnly(1200), tracking_no:'BOS-77199', notes:'مرتجع رجع للمخزن — DEMO-1037'},
    {id:'dm4', product_id:'ds2', product_name:'مطبقية ريكي ٢ دور', movement_type:'in', qty_in:20, qty_out:0, created_at:iso(5000), movement_date:dOnly(5000), tracking_no:'', notes:'توريد جديد'}
  ];
}
