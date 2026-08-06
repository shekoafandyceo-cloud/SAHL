// تصنيف حالات الأوردر — قيم حرفية لازم تفضل مطابقة للداتابيز

export var SL={
  pending:'قيد الانتظار',
  confirmed:'مؤكدة',
  delivered:'تم التسليم',
  Delivered:'تم التسليم',
  cancelled:'ملغية',
  returned:'مرتجعة',
  bosta_assigned:'شحن',
  'BOSTA AUTO':'شحن أوتوماتيك',
  BOSTA2:'اوردر اتضرب',
  bosta_auto:'شحن أوتوماتيك',
  bosta2:'اوردر اتضرب',
  failed:'فشل',
  // Official Bosta API statuses — keep these exact strings in database
  'Exception':'استثناء',
  'Out for delivery':'في الطريق',
  'Received at warehouse':'استلام في المخزن',
  'Route Assigned':'تعيين المسار',
  'In transit between Hubs':'في النقل بين الفروع',
  'Picking up from consignee':'استلام من العميل',
  'Out for exchange':'خارج للاستبدال',
  'Returned to business':'مرتجع',
  'Returned to business2':'مرتجع مضروب',
  // Legacy aliases — for old rows only
  out_for_delivery:'في الطريق',
  received_at_warehouse:'استلام في المخزن',
  route_assigned:'تعيين المسار',
  in_transit:'في النقل',
  exception:'استثناء',
  picked_up:'تم الاستلام'
};

export var STATUS_OPTIONS = ['pending','confirmed','delivered','cancelled','returned','bosta_assigned','BOSTA AUTO','BOSTA2','Delivered','Exception','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','Returned to business','Returned to business2','failed'];

export var DELIVERED_STATUSES = ['delivered','Delivered'];

export var CANCELLED_STATUSES = ['cancelled'];

export var RETURNED_STATUSES = ['returned','Returned to business','Returned to business2'];

// Confirmation rate positive statuses:
// Any status that proves the order left Pending and entered confirmation/shipping journey.
// Exception / returned Bosta states are intentionally counted as positive for confirmation rate,
// because they are shipping/delivery outcomes, not confirmation-team failures.
export var BOSTA_POSITIVE_STATUSES = [
  'confirmed',
  'bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2',
  'delivered','Delivered',
  'Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange',
  'Exception',
  'Returned to business','Returned to business2','returned',
  'out_for_delivery','received_at_warehouse','route_assigned','in_transit','picked_up','exception',
  'returned_to_business','returned_to_business2'
];

// Expected revenue = orders actually shipped or with Bosta (NOT just confirmed — those still may refuse on delivery)
export var BOSTA_EXPECTED_STATUSES = ['bosta_assigned','BOSTA AUTO','BOSTA2','bosta_auto','bosta2','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','Exception','out_for_delivery','received_at_warehouse','route_assigned','picked_up','in_transit','exception'];

// Inventory card: count products only after the shipment is actually created/inside Bosta operation.
// Important: bosta_assigned and BOSTA AUTO are intentionally excluded.
export var BOSTA_INVENTORY_STATUSES = ['BOSTA2','bosta2','Exception','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','out_for_delivery','received_at_warehouse','route_assigned','in_transit','exception','picked_up'];

// OPERATION filter = Bosta API statuses only, excluding Delivered and excluding internal Bosta statuses.
export var BOSTA_OPERATION_STATUSES = ['Exception','Out for delivery','Received at warehouse','Route Assigned','In transit between Hubs','Picking up from consignee','Out for exchange','out_for_delivery','received_at_warehouse','route_assigned','in_transit','exception','picked_up'];

export function normStatus(s){return String(s||'').trim().toLowerCase();}

export function statusIn(status, list){
  var st=normStatus(status);
  return (list||[]).some(function(x){return normStatus(x)===st;});
}

// Operation statuses set (for filter)
export var CR={no_answer:'لم يرد',busy:'مشغول',refused:'رفض',confirmed:'أكد',callback:'يعاود الاتصال'};

export function statusClass(s){return String(s||'pending').toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'');}

export function statusLabel(s){return SL[s]||SL[statusClass(s)]||s||'—';}
