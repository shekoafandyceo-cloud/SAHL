// عدّاد الوقت لحد ما الأوردر يتأكد — بيلوّن الصف لما يعدّي الحد

// ── End Custom Modal ─────────────────────────────────────────────
export var CALL_WAIT_MS = 90 * 60 * 1000; // 90 minutes in ms

export var timerInterval = null;

export function startTimerTick(){
  if(timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickTimers, 1000);
  tickTimers();
}

export function tickTimers(){
  var cells = document.querySelectorAll('.timer-cell[data-deadline]');
  var now = Date.now();
  cells.forEach(function(cell){
    var deadline = cell.getAttribute('data-deadline');
    var row = cell.closest('tr');
    if(!deadline){
      cell.innerHTML = '';
      if(row) row.classList.remove('call-due-row');
      return;
    }
    var remaining = new Date(deadline).getTime() - now;
    if(remaining <= 0){
      // Timer expired — alert the employee to call
      cell.innerHTML = '<span class="call-due">📞 اتصل الآن!</span>';
      if(row) row.classList.add('call-due-row');
    } else {
      // Show countdown — remaining is POSITIVE = time left before next call
      var totalSec = Math.ceil(remaining / 1000);
      var mins = Math.floor(totalSec / 60);
      var secs = totalSec % 60;
      var pct = remaining / CALL_WAIT_MS; // 1.0 = just started, 0.0 = expired
      var color = pct > 0.5 ? 'var(--green)' : pct > 0.2 ? 'var(--ora)' : 'var(--red)';
      cell.innerHTML = '<span class="call-timer" style="color:'+color+'">'
        + mins+'د '+ (secs<10?'0':'')+secs+'ث'
        + '</span>';
      if(row) row.classList.remove('call-due-row');
    }
  });
}
