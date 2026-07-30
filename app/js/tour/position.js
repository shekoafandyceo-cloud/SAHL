// حساب موضع فقاعة الجولة على الشاشة

export function tourPositionFor(el, bubble){
  var W=window.innerWidth, H=window.innerHeight;
  // if target is inside the order overlay, lift overlay above tour layer & hide the dark masks
  var ovl=document.getElementById('ovl');
  var inOvl = ovl && ovl.contains(el);
  var top=document.getElementById('tm-top'), bot=document.getElementById('tm-bot'),
      lef=document.getElementById('tm-lef'), rig=document.getElementById('tm-rig');
  var ring=document.getElementById('tour-ring');
  if(inOvl){
    ovl.style.zIndex='99988';
    bubble.style.zIndex='99999';
    ring.style.zIndex='99998';
    // hide masks — the overlay backdrop already dims everything behind it
    [top,bot,lef,rig].forEach(function(m){ m.style.cssText='display:none'; });
    var r2=el.getBoundingClientRect();
    var pad2=6;
    ring.style.cssText='position:fixed;z-index:99998;top:'+(r2.top-pad2)+'px;left:'+(r2.left-pad2)+'px;width:'+(r2.width+pad2*2)+'px;height:'+(r2.height+pad2*2)+'px;';
    ring.className='tour-ring';
    // place the bubble BESIDE the order panel (in the empty gutter), not over it
    var panel=ovl.querySelector('.dpan');
    var pr=panel?panel.getBoundingClientRect():r2;
    var bw2=Math.min(300, W-32), bh2=bubble.offsetHeight||220;
    var gapLeft=pr.left;                 // space to the left of the panel
    var gapRight=W-pr.right;             // space to the right of the panel
    var bLeft2, bTop2;
    if(gapLeft >= bw2+12){                       // enough room on the left
      bLeft2 = Math.max(8, pr.left - bw2 - 12);
    } else if(gapRight >= bw2+12){               // else try the right
      bLeft2 = Math.min(W - bw2 - 8, pr.right + 12);
    } else {                                     // narrow screen: center horizontally, sit near top
      bLeft2 = Math.max(12, (W-bw2)/2);
    }
    // vertically align bubble with the highlighted element, clamped to viewport
    bTop2 = Math.max(12, Math.min(r2.top - 10, H - bh2 - 12));
    bubble.style.top=bTop2+'px'; bubble.style.left=bLeft2+'px'; bubble.style.maxWidth=bw2+'px';
    bubble.className='tour-bubble arr-none';
    return;
  }
  if(ovl){ ovl.style.zIndex=''; }
  bubble.style.zIndex=''; ring.style.zIndex='';
  var r=el.getBoundingClientRect();
  var pad=8;
  // ring
  ring.style.top=(r.top-pad)+'px'; ring.style.left=(r.left-pad)+'px';
  ring.style.width=(r.width+pad*2)+'px'; ring.style.height=(r.height+pad*2)+'px';
  ring.style.display='';
  // 4 masks around target
  top.style.cssText='position:fixed;top:0;left:0;width:100%;height:'+Math.max(0,r.top-pad)+'px;';
  bot.style.cssText='position:fixed;top:'+(r.bottom+pad)+'px;left:0;width:100%;height:'+Math.max(0,H-r.bottom-pad)+'px;';
  lef.style.cssText='position:fixed;top:'+(r.top-pad)+'px;left:0;width:'+Math.max(0,r.left-pad)+'px;height:'+(r.height+pad*2)+'px;';
  rig.style.cssText='position:fixed;top:'+(r.top-pad)+'px;left:'+(r.right+pad)+'px;width:'+Math.max(0,W-r.right-pad)+'px;height:'+(r.height+pad*2)+'px;';
  [top,bot,lef,rig].forEach(function(m){m.className='tour-mask';});
  // bubble: place below target if room, else above
  var bw=Math.min(340, W-32), bh=bubble.offsetHeight||220;
  var gap=8;
  var spaceBelow=H-r.bottom;
  var bTop, arr;
  if(spaceBelow > bh+30){ bTop=r.bottom+pad+gap; arr='arr-top'; }
  else { bTop=Math.max(12, r.top-pad-bh-gap); arr='arr-bottom'; }
  // center the bubble horizontally on the target (clamped), so it sits right under it
  var cx=r.left + r.width/2;
  var bLeft=Math.min(Math.max(12, cx - bw/2), W-bw-12);
  // aim the little arrow at the target's center, clamped to stay inside the bubble
  var arrX=Math.min(Math.max(16, cx - bLeft - 7), bw-30);
  bubble.style.top=bTop+'px'; bubble.style.left=bLeft+'px'; bubble.style.maxWidth=bw+'px';
  bubble.style.setProperty('--arr-x', arrX+'px');
  bubble.className='tour-bubble '+arr;
}
