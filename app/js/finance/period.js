// نطاق الفترة الزمنية للفاينانس

export var financePeriod = { type: 'month', from: null, to: null };

// Get period date range
export function parseLocalYMD(s){ var p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+p[2],0,0,0,0); }

export function getPeriodRange(){
  var now = new Date();
  var from, to, t = financePeriod.type;
  if(t === 'last3'){
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate()-2);
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
  } else if(t === 'month'){
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth()+1, 1);
  } else if(t === 'last30'){
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate()-29);
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
  } else if(t === 'custom'){
    from = financePeriod.from ? parseLocalYMD(financePeriod.from) : new Date(2020,0,1);
    to = financePeriod.to ? new Date(parseLocalYMD(financePeriod.to).getTime() + 86400000) : new Date(now.getFullYear()+1,0,1);
  } else { // 'all'
    from = new Date(2020,0,1);
    to = new Date(now.getFullYear()+1, 0, 1);
  }
  return { from: from, to: to };
}

// pick a sensible chart granularity that matches the selected finance period
export function autoChartGran(){
  if(financePeriod.type==='all') return 'monthly';
  var r=getPeriodRange(), span=Math.max(1,Math.round((new Date(r.to)-new Date(r.from))/86400000));
  if(span<=31) return 'daily';
  if(span<=183) return 'weekly';
  if(span<=730) return 'monthly';
  return 'yearly';
}
