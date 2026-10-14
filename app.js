'use strict';
const $=id=>document.getElementById(id), clone=v=>JSON.parse(JSON.stringify(v));
const builtinPhotos=[
 {id:'builtin-surf-flow',name:'海风与自由',url:'assets/surf-flow.jpg'},
 {id:'builtin-summer-surf',name:'夏日冲浪',url:'assets/summer-surf.jpg'}
];
let state={photos:clone(builtinPhotos),active:builtinPhotos[0].id,boards:{},favorites:[],mode:'puzzle'};
function migrateBuiltins(saved){
 const builtinIds=new Set(builtinPhotos.map(p=>p.id));
 saved.photos=[...clone(builtinPhotos),...saved.photos.filter(p=>!/^demo-\d+$/.test(p.id)&&!builtinIds.has(p.id))];
 const valid=new Set(saved.photos.map(p=>p.id));
 saved.favorites=(saved.favorites||[]).filter(t=>valid.has(t.imageId));
 for(const id of Object.keys(saved.boards)){
  if(!valid.has(id)){delete saved.boards[id];continue;}
  const b=saved.boards[id];b.slots=b.slots.map(t=>t&&valid.has(t.imageId)?t:null);b.tray=b.tray.filter(t=>valid.has(t.imageId));
 }
 if(!valid.has(saved.active))saved.active=builtinPhotos[0].id;
 return saved;
}
let images=new Map(),db=null,selected=null,history=[],geom=null,showReference=false,pointer=null,saveTimer,toastTimer,saveSequence=0;
let viewZoom=1,viewGesture=null;
const viewTouches=new Map(),MIN_ZOOM=.7,MAX_ZOOM=2;
const boardCanvas=$('board'),ctx=boardCanvas.getContext('2d');
function tile(imageId,r,c,cols,rows){return{imageId,r,c,cols,rows};}
function makeBoard(photoId,cols=3){const rows=cols+1;return{cols,rows,slots:Array.from({length:cols*rows},(_,i)=>tile(photoId,Math.floor(i/cols),i%cols,cols,rows)),tray:[],bg:'transparent',texts:[]};}
function current(){return state.boards[state.active];}
function snap(){history.push(clone({active:state.active,board:current(),favorites:state.favorites,mode:state.mode}));if(history.length>35)history.shift();}
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2700);}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('piece-of-you-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('studio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function getStored(){return new Promise((resolve,reject)=>{const tx=db.transaction('studio','readonly'),r=tx.objectStore('studio').get('session');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function persist(){clearTimeout(saveTimer);const seq=++saveSequence;$('saveStatus').textContent='● 正在保存';saveTimer=setTimeout(()=>{if(!db){$('saveStatus').textContent='● 当前会话';return;}try{const tx=db.transaction('studio','readwrite');tx.objectStore('studio').put(clone(state),'session');tx.oncomplete=()=>{if(seq===saveSequence)$('saveStatus').textContent='● 本机自动保存';};tx.onerror=()=>{$('saveStatus').textContent='● 保存未完成';toast('本机存储已满，请先导出作品。');};}catch(e){$('saveStatus').textContent='● 保存未完成';}},300);}
function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('图片无法读取'));im.src=url;});}
function dimensions(){const im=images.get(state.active);return{W:720,H:720*(im?.naturalHeight||900)/(im?.naturalWidth||720)};}
function edgeSign(kind,r,c){return ((r*7+c*13+(kind==='v'?3:0))%2)?1:-1;}
function piecePath(r,c,cols,rows,w,h){const p=new Path2D(),depth=Math.min(w,h)*.19;let x=0,y=0;p.moveTo(0,0);
 const edge=(dx,dy,sign)=>{const len=Math.hypot(dx,dy),nx=dy/len,ny=-dx/len;const q=(u,v)=>[x+dx*u+nx*v,y+dy*u+ny*v];const line=(u,v)=>p.lineTo(...q(u,v));const cubic=(a,b,c,d,e,f)=>p.bezierCurveTo(...q(a,b),...q(c,d),...q(e,f));if(!sign){line(1,0);}else{const d=depth*sign;line(.35,0);cubic(.43,0,.43,d*.1,.40,d*.45);cubic(.31,d*1.25,.43,d*1.38,.50,d*1.38);cubic(.57,d*1.38,.69,d*1.25,.60,d*.45);cubic(.57,d*.1,.57,0,.65,0);line(1,0);}x+=dx;y+=dy;};
 edge(w,0,r===0?0:-edgeSign('h',r-1,c));edge(0,h,c===cols-1?0:edgeSign('v',r,c));edge(-w,0,r===rows-1?0:edgeSign('h',r,c));edge(0,-h,c===0?0:-edgeSign('v',r,c-1));p.closePath();return p;}
function drawPiece(context,t,r,c,cols,rows,w,h,opts={}){const path=piecePath(r,c,cols,rows,w,h),im=images.get(t.imageId);if(!im)return;
 context.save();context.translate(0,opts.flat?1:3+(opts.lift||0)*.3);context.shadowColor='#30292455';context.shadowBlur=opts.flat?1:5+(opts.lift||0);context.shadowOffsetY=opts.flat?1:3;context.fillStyle='#8b7969';context.fill(path);context.restore();context.save();context.clip(path);context.drawImage(im,-t.c*w,-t.r*h,w*t.cols,h*t.rows);context.restore();
 context.save();context.strokeStyle='#40332260';context.lineWidth=opts.flat?.65:1.15;context.stroke(path);context.translate(-.4,-.7);context.strokeStyle='#ffffff88';context.lineWidth=.7;context.stroke(path);context.restore();if(opts.selected){context.save();context.strokeStyle='#a177be';context.lineWidth=Math.max(2,w*.016);context.stroke(path);context.restore();}}
function checker(context,W,H){context.fillStyle='#fafafa';context.fillRect(0,0,W,H);const size=18;context.fillStyle='#c8c8c8';for(let y=0;y<H;y+=size)for(let x=0;x<W;x+=size)if((Math.floor(x/size)+Math.floor(y/size))%2===0)context.fillRect(x,y,size,size);}
const fonts={sans:'Arial,"PingFang SC","Microsoft YaHei",sans-serif',serif:'Georgia,"Songti SC",SimSun,serif',mono:'"Courier New",monospace'};
function drawText(context,t,W,H,highlight=false){context.save();context.translate(t.x*W,t.y*H);context.font=`${t.size}px ${fonts[t.font]||fonts.sans}`;context.fillStyle=t.color;context.textBaseline='top';const lines=t.value.split('\n');lines.forEach((s,i)=>context.fillText(s,0,i*t.size*1.25));if(highlight){const width=Math.max(...lines.map(s=>context.measureText(s).width),25);context.strokeStyle='#a177be';context.lineWidth=1.5;context.setLineDash([5,4]);context.strokeRect(-6,-5,width+12,lines.length*t.size*1.25+8);}context.restore();}
let motion=null,animationFrame=0,hoverSlot=-1,tableOrder=0;
const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const now=()=>performance.now();
function cleanTile(t){const {imageId,r,c,cols,rows}=t;return{imageId,r,c,cols,rows};}
function stagePoint(clientX,clientY){const r=boardCanvas.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top,cx=r.width/2,cy=r.height/2;return{x:cx+(x-cx)/viewZoom,y:cy+(y-cy)/viewZoom};}
function setViewZoom(value){viewZoom=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Math.round(value*100)/100));$('zoomLabel').textContent=`${Math.round(viewZoom*100)}%`;$('zoomOutBtn').disabled=viewZoom<=MIN_ZOOM;$('zoomInBtn').disabled=viewZoom>=MAX_ZOOM;renderCanvas();}
function slotCenter(i){const b=current();return{x:geom.x+(i%b.cols+.5)*geom.W/b.cols*geom.scale,y:geom.y+(Math.floor(i/b.cols)+.5)*geom.H/b.rows*geom.scale,angle:0};}
function looseCenter(t){const b=current(),margin=Math.hypot(geom.W/b.cols,geom.H/b.rows)*geom.scale*.66+4;return{x:Math.max(margin,Math.min(geom.stageW-margin,t.pose.x*geom.stageW)),y:Math.max(margin,Math.min(geom.stageH-margin,t.pose.y*geom.stageH)),angle:t.pose.angle};}
function randomPose(existing=[]){
 const w=geom?.stageW||650,h=geom?.stageH||600,pw=geom?geom.W/current().cols*geom.scale:85,ph=geom?geom.H/current().rows*geom.scale:90;
 const margin=Math.hypot(pw,ph)*.66+5;
 let best=null,bestGap=-1;
 for(let n=0;n<60;n++){
  const x=margin+Math.random()*Math.max(1,w-2*margin),y=margin+Math.random()*Math.max(1,h-2*margin);
  if(geom&&x>geom.x-pw*.16&&x<geom.x+geom.W*geom.scale+pw*.16&&y>geom.y-ph*.16&&y<geom.y+geom.H*geom.scale+ph*.16)continue;
  const gap=existing.length?Math.min(...existing.map(t=>Math.hypot((t.pose?.x||0)*w-x,(t.pose?.y||0)*h-y))):999;
  if(gap>bestGap){bestGap=gap;best={x:x/w,y:y/h,angle:(Math.random()-.5)*1.6,z:++tableOrder};}
  if(gap>Math.max(pw,ph)*.9)break;
 }
 return best||{x:.16+Math.random()*.68,y:.79+Math.random()*.10,angle:(Math.random()-.5)*1.6,z:++tableOrder};
}
function ensurePoses(){const all=current().tray;tableOrder=Math.max(tableOrder,...all.map(t=>t.pose?.z||0));for(const t of all)if(!t.pose)t.pose=randomPose(all.filter(v=>v!==t&&v.pose));}
function addLoose(t,pose){const copy=cleanTile(t);copy.pose=pose||randomPose(current().tray);current().tray.push(copy);return copy;}
function animate(m){if(reducedMotion()){motion=null;renderCanvas();return;}motion={...m,start:now(),duration:m.duration||470};queueFrame();}
function queueFrame(){if(!animationFrame)animationFrame=requestAnimationFrame(()=>{animationFrame=0;renderCanvas();});}
function motionFraction(){return motion?Math.min(1,(now()-motion.start)/motion.duration):1;}
function drawFloating(context,t,center,scale=1,lift=0){const b=current(),w=geom.W/b.cols*geom.scale,h=geom.H/b.rows*geom.scale;context.save();context.translate(center.x,center.y-lift);context.rotate(center.angle||0);context.scale(scale,scale);context.translate(-w/2,-h/2);drawPiece(context,t,t.r,t.c,t.cols,t.rows,w,h,{selected:selected?.kind==='tray'&&current().tray[selected.index]===t,lift});context.restore();}
function paintBoard(context,W,H,exporting=false){const b=current(),w=W/b.cols,h=H/b.rows;if(b.bg==='transparent'){if(!exporting)checker(context,W,H);}else{context.fillStyle=b.bg;context.fillRect(0,0,W,H);}if(showReference&&!exporting){context.drawImage(images.get(state.active),0,0,W,H);return;}
 for(let i=0;i<b.slots.length;i++){let t=b.slots[i];const r=Math.floor(i/b.cols),c=i%b.cols;if(!exporting&&((pointer?.moved&&pointer.source.kind==='board'&&pointer.source.index===i)||(motion?.kind==='snap'&&motion.target===i)))t=null;context.save();context.translate(c*w,r*h);if(t)drawPiece(context,t,r,c,b.cols,b.rows,w,h,{selected:!exporting&&selected?.kind==='board'&&selected.index===i});else{context.strokeStyle='#70687825';context.lineWidth=.8;context.stroke(piecePath(r,c,b.cols,b.rows,w,h));}context.restore();}
 b.texts.forEach((t,i)=>drawText(context,t,W,H,!exporting&&selected?.kind==='text'&&selected.index===i));}
function renderCanvas(){
 if(!images.has(state.active))return;
 const rect=boardCanvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
 const dpr=Math.min(window.devicePixelRatio||1,2);boardCanvas.width=Math.round(rect.width*dpr);boardCanvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
 const {W,H}=dimensions(),scale=Math.min((rect.width*.60)/W,(rect.height*.48)/H),x=(rect.width-W*scale)/2,y=(rect.height-H*scale)/2;
 geom={x,y,scale,W,H,stageW:rect.width,stageH:rect.height};ensurePoses();
 const f=motionFraction();if(f>=1)motion=null;
 ctx.save();ctx.translate(rect.width/2,rect.height/2);ctx.scale(viewZoom,viewZoom);ctx.translate(-rect.width/2,-rect.height/2);
 ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.shadowColor='#4a3d2b26';ctx.shadowBlur=18;ctx.shadowOffsetY=7;ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.shadowColor='transparent';ctx.clearRect(0,0,W,H);paintBoard(ctx,W,H);
 if(hoverSlot>=0){const b=current(),r=Math.floor(hoverSlot/b.cols),c=hoverSlot%b.cols;ctx.translate(c*W/b.cols,r*H/b.rows);ctx.fillStyle='#c7b0dd55';ctx.strokeStyle='#a688bb';ctx.lineWidth=3;const path=piecePath(r,c,b.cols,b.rows,W/b.cols,H/b.rows);ctx.fill(path);ctx.stroke(path);}ctx.restore();
 ctx.save();ctx.strokeStyle='#a3988c50';ctx.lineWidth=1;ctx.strokeRect(x-.5,y-.5,W*scale+1,H*scale+1);ctx.restore();
 const all=current().tray.map((t,i)=>({t,i})).sort((a,b)=>(a.t.pose.z||0)-(b.t.pose.z||0));
 for(const {t,i} of all){if(pointer?.moved&&pointer.source.kind==='tray'&&pointer.source.index===i)continue;let center=looseCenter(t),lift=0;
  if(motion?.kind==='scatter'){const from=motion.origins.get(t);if(from){const ease=1-Math.pow(1-f,3);center={x:from.x+(center.x-from.x)*ease,y:from.y+(center.y-from.y)*ease,angle:(from.angle||0)+(center.angle-(from.angle||0))*ease};lift=Math.sin(f*Math.PI)*14;}}
  drawFloating(ctx,t,center,1,lift);
 }
 if(motion?.kind==='snap'){const end=slotCenter(motion.target),from=motion.from,ease=1-Math.pow(1-Math.min(1,f/.65),3),settle=f<.65?0:(f-.65)/.35,zoom=f<.65?1.055:1-.045*Math.sin(settle*Math.PI*2)*Math.exp(-settle*2);
  drawFloating(ctx,motion.tile,{x:from.x+(end.x-from.x)*ease,y:from.y+(end.y-from.y)*ease,angle:(from.angle||0)*(1-ease)},zoom,(1-ease)*8);
  if(f>.45){ctx.save();ctx.strokeStyle=`rgba(172,146,194,${(1-f)*.7})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(end.x,end.y,Math.min(geom.W/current().cols,geom.H/current().rows)*geom.scale*(.4+f*.32),0,Math.PI*2);ctx.stroke();ctx.restore();}
 }
 if(pointer?.moved&&pointer.source.kind!=='text')drawFloating(ctx,pointer.tile,pointer.center,1.055,7);
 ctx.restore();
 if(motion)queueFrame();
}
function drawThumb(canvas,t){canvas.width=200;canvas.height=180;const ct=canvas.getContext('2d');const w=110,h=104;ct.translate(45,36);drawPiece(ct,t,t.r,t.c,t.cols,t.rows,w,h);}
function selectedTile(){if(!selected)return null;return selected.kind==='board'?current().slots[selected.index]:selected.kind==='tray'?current().tray[selected.index]:selected.kind==='favorite'?state.favorites[selected.index]:null;}
function updateSelection(){const t=selectedTile(),text=selected?.kind==='text';$('favoriteBtn').disabled=!t;$('removeBtn').disabled=!(selected?.kind==='board'&&t)&&!text;$('removeBtn').textContent=text?'删除文字':'移出画布';$('selectionLabel').textContent=text?'文字已选中，调整内容后点击「更新文字」。':t?(selected.kind==='favorite'?'收藏已选中，点击画布位置进行拼贴。':'这块很喜欢？收藏起来，带去另一张照片。'):'选中一块拼图，收藏这份小美好。';$('addTextBtn').textContent=text?'✓ 更新文字':'＋ 添加到画布';document.querySelectorAll('.tile-card,.favorite-card,.text-row').forEach(el=>el.classList.toggle('active',selected&&el.dataset.kind===selected.kind&&Number(el.dataset.index)===selected.index));renderCanvas();}
function select(s){selected=s;if(s?.kind==='text'){const t=current().texts[s.index];$('textInput').value=t.value;$('textSize').value=t.size;$('textSizeValue').value=t.size;$('fontSelect').value=t.font;$('textColor').value=t.color;}updateSelection();}
function renderAlbums(){const parent=$('albums');parent.replaceChildren();state.photos.forEach(p=>{const b=document.createElement('button');b.className='album'+(p.id===state.active?' active':'');b.title=p.name;b.setAttribute('aria-label',p.name);const im=document.createElement('img');im.src=p.url;im.alt=p.name;b.append(im);b.onclick=()=>switchPhoto(p.id);parent.append(b);});$('albumCount').textContent=String(state.photos.length).padStart(2,'0');}
function tileElement(t,index,kind){const b=document.createElement('button');b.className=kind==='tray'?'tile-card':'favorite-card';b.dataset.kind=kind;b.dataset.index=index;b.setAttribute('aria-label',`${kind==='tray'?'碎片':'收藏碎片'} ${index+1}`);const c=document.createElement('canvas');b.append(c);drawThumb(c,t);b.addEventListener('pointerdown',e=>{if(e.target.closest('.delete-fav'))return;if(kind==='favorite'){state.mode='collage';renderModes();}select({kind,index});beginPointer(e,{kind,index});if(kind==='favorite'&&isMobileUi())closeToolDrawer();});if(kind==='favorite'){const d=document.createElement('span');d.className='delete-fav';d.textContent='×';d.title='删除收藏';d.setAttribute('role','button');d.tabIndex=0;const remove=e=>{e.stopPropagation();snap();state.favorites.splice(index,1);selected=null;render();persist();};d.onclick=remove;d.onkeydown=e=>{if(e.key==='Enter')remove(e);};b.append(d);}b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(kind==='favorite'){state.mode='collage';renderModes();}select({kind,index});if(kind==='favorite'&&isMobileUi())closeToolDrawer();}});return b;}
function renderTray(){ensurePoses();$('tray').replaceChildren();$('tray').textContent=current().tray.length?'碎片都在台面上，随手拖动摆放。':'点击「打散拼图」，让碎片散落在台面上。';$('trayCount').textContent=current().tray.length;}
function renderFavorites(){const parent=$('favorites');parent.replaceChildren();state.favorites.forEach((t,i)=>parent.append(tileElement(t,i,'favorite')));if(!state.favorites.length){const e=document.createElement('div');e.className='favorite-empty';e.innerHTML='<span>♡</span>把喜欢的小碎片放在这里';parent.append(e);}}
function renderTexts(){const parent=$('textList');parent.replaceChildren();current().texts.forEach((t,i)=>{const row=document.createElement('div');row.className='text-row';row.dataset.kind='text';row.dataset.index=i;const b=document.createElement('button');b.textContent=t.value;b.onclick=()=>select({kind:'text',index:i});const d=document.createElement('button');d.textContent='×';d.setAttribute('aria-label','删除文字');d.onclick=()=>{snap();current().texts.splice(i,1);selected=null;render();persist();};row.append(b,d);parent.append(row);});}
function renderModes(){$('puzzleMode').classList.toggle('active',state.mode==='puzzle');$('collageMode').classList.toggle('active',state.mode==='collage');$('modeTag').textContent=state.mode==='puzzle'?'♡ 给自己一点慢时光':'✳ 不同照片，也可以相遇';$('trayHint').textContent=state.mode==='puzzle'?'点选碎片，再点空位 · 也可以拖拽':'任意拼接 · 拖到台面自由摆放';}
function render(){const b=current();renderAlbums();renderTray();renderFavorites();renderTexts();renderModes();document.querySelectorAll('[data-grid]').forEach(el=>el.classList.toggle('active',Number(el.dataset.grid)===b.cols));document.querySelectorAll('[data-bg]').forEach(el=>el.classList.toggle('active',el.dataset.bg===b.bg));$('workTitle').textContent=state.photos.find(p=>p.id===state.active)?.name||'我的拼图';const count=b.slots.filter(Boolean).length;$('progressLabel').textContent=`已放置 ${count} / ${b.slots.length} 块`;$('progressBar').style.width=`${count/b.slots.length*100}%`;$('undoBtn').disabled=!history.length;updateSelection();}
function switchPhoto(id){if(id===state.active)return;motion=null;pointer=null;hoverSlot=-1;state.active=id;if(!state.boards[id])state.boards[id]=makeBoard(id,current()?.cols||3);selected=null;history=[];render();persist();if(isMobileUi())closeToolDrawer();}
function worldPoint(clientX,clientY){if(!geom)return null;const p=stagePoint(clientX,clientY);return{x:(p.x-geom.x)/geom.scale,y:(p.y-geom.y)/geom.scale};}
function slotAt(pt){if(!pt||pt.x<0||pt.y<0||pt.x>=geom.W||pt.y>=geom.H)return-1;const b=current();return Math.floor(pt.y/(geom.H/b.rows))*b.cols+Math.floor(pt.x/(geom.W/b.cols));}
function textAt(pt){if(!pt)return-1;const {W,H}=dimensions(),texts=current().texts;for(let i=texts.length-1;i>=0;i--){const t=texts[i];ctx.save();ctx.font=`${t.size}px ${fonts[t.font]}`;const lines=t.value.split('\n'),width=Math.max(...lines.map(s=>ctx.measureText(s).width),30);ctx.restore();if(pt.x>=t.x*W-9&&pt.x<=t.x*W+width+9&&pt.y>=t.y*H-9&&pt.y<=t.y*H+lines.length*t.size*1.25+9)return i;}return-1;}
function correctFor(t,i){const b=current();return t&&t.imageId===state.active&&t.cols===b.cols&&t.rows===b.rows&&t.r===Math.floor(i/b.cols)&&t.c===i%b.cols;}
function sourceTile(s){return s.kind==='board'?current().slots[s.index]:s.kind==='tray'?current().tray[s.index]:state.favorites[s.index];}
function place(source,target,from=null){const b=current(),t=sourceTile(source);if(!t||target<0||target>=b.slots.length)return false;if(source.kind==='board'&&source.index===target)return false;
 if(state.mode==='puzzle'&&!correctFor(t,target)){toast('这块还没找到它的位置，再试试另一格 ♡');return false;}
 const start=from||(source.kind==='tray'?looseCenter(t):source.kind==='board'?slotCenter(source.index):{...slotCenter(target),y:slotCenter(target).y-35,angle:.1});
 snap();const old=b.slots[target];if(source.kind==='board')b.slots[source.index]=old;else{if(source.kind==='tray')b.tray.splice(source.index,1);if(old)addLoose(old);}
 b.slots[target]=cleanTile(t);selected={kind:'board',index:target};hoverSlot=-1;render();animate({kind:'snap',target,tile:cleanTile(t),from:start});persist();
 if(state.mode==='puzzle'&&b.slots.every((v,i)=>correctFor(v,i)))toast('拼好啦！给今天的耐心一点掌声 ✿');return true;
}
function removeSelected(){if(selected?.kind==='text'){snap();current().texts.splice(selected.index,1);}else if(selected?.kind==='board'&&selectedTile()){snap();addLoose(current().slots[selected.index]);current().slots[selected.index]=null;}else return;selected=null;motion=null;render();persist();}
function looseAt(pt){const b=current(),w=geom.W/b.cols*geom.scale,h=geom.H/b.rows*geom.scale;const order=b.tray.map((t,i)=>({t,i})).sort((a,b)=>(b.t.pose.z||0)-(a.t.pose.z||0));for(const {t,i} of order){const p=looseCenter(t),dx=pt.x-p.x,dy=pt.y-p.y,cs=Math.cos(p.angle),sn=Math.sin(p.angle),x=dx*cs+dy*sn+w/2,y=-dx*sn+dy*cs+h/2;ctx.save();ctx.setTransform(1,0,0,1,0,0);const hit=ctx.isPointInPath(piecePath(t.r,t.c,t.cols,t.rows,w,h),x,y);ctx.restore();if(hit)return i;}return-1;}
function beginPointer(e,s){if(e.button!==0&&e.pointerType==='mouse')return;motion=null;const pt=stagePoint(e.clientX,e.clientY);pointer={id:e.pointerId,source:clone(s),startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};
 if(s.kind==='text'){const p=worldPoint(e.clientX,e.clientY),t=current().texts[s.index];pointer.textOriginal=clone(t);pointer.offset={x:p.x-t.x*geom.W,y:p.y-t.y*geom.H};}
 else{pointer.tile=cleanTile(sourceTile(s));const center=s.kind==='tray'?looseCenter(sourceTile(s)):s.kind==='board'?slotCenter(s.index):pt;pointer.center={...center,angle:center.angle||0};pointer.offset={x:pt.x-center.x,y:pt.y-center.y};}
 try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();}
function nearbySlot(p){const pt={x:(p.center.x-geom.x)/geom.scale,y:(p.center.y-geom.y)/geom.scale};let i=slotAt(pt);if(state.mode==='puzzle'){
 const t=p.tile;if(t.imageId!==state.active||t.cols!==current().cols||t.rows!==current().rows)return-1;
 const target=t.r*current().cols+t.c,end=slotCenter(target),threshold=Math.min(geom.W/current().cols,geom.H/current().rows)*geom.scale*.52;
 return Math.hypot(p.center.x-end.x,p.center.y-end.y)<threshold?target:-1;
 }return i;
}
function dropOnTable(p){snap();const b=current(),w=geom.W/b.cols*geom.scale,h=geom.H/b.rows*geom.scale,margin=Math.hypot(w,h)*.66+4;
 const pose={x:Math.max(margin,Math.min(geom.stageW-margin,p.center.x))/geom.stageW,y:Math.max(margin,Math.min(geom.stageH-margin,p.center.y))/geom.stageH,angle:p.center.angle||((Math.random()-.5)*.24),z:++tableOrder};
 if(p.source.kind==='tray'){b.tray[p.source.index].pose=pose;selected=p.source;}else{if(p.source.kind==='board')b.slots[p.source.index]=null;addLoose(p.tile,pose);selected={kind:'tray',index:b.tray.length-1};}render();persist();
}
function cancelPointerForZoom(){if(pointer?.source.kind==='text'&&pointer.moved){current().texts[pointer.source.index]=pointer.textOriginal;history.pop();}pointer=null;hoverSlot=-1;motion=null;}
function pinchDistance(){const points=[...viewTouches.values()];return points.length<2?0:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);}
boardCanvas.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;viewTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(viewTouches.size===2){cancelPointerForZoom();viewGesture={distance:pinchDistance(),zoom:viewZoom};try{boardCanvas.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();}}, {passive:false});
window.addEventListener('pointermove',e=>{if(!viewTouches.has(e.pointerId))return;viewTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(viewGesture&&viewTouches.size>=2){const distance=pinchDistance();if(viewGesture.distance>0)setViewZoom(viewGesture.zoom*distance/viewGesture.distance);e.preventDefault();}}, {passive:false});
const endViewPointer=e=>{if(!viewTouches.has(e.pointerId))return;viewTouches.delete(e.pointerId);if(viewTouches.size<2)viewGesture=null;};
window.addEventListener('pointerup',endViewPointer);window.addEventListener('pointercancel',endViewPointer);
boardCanvas.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();setViewZoom(viewZoom*(e.deltaY>0?.92:1.08));},{passive:false});
$('zoomOutBtn').onclick=()=>setViewZoom(viewZoom-.15);$('zoomInBtn').onclick=()=>setViewZoom(viewZoom+.15);$('zoomResetBtn').onclick=()=>setViewZoom(1);
boardCanvas.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse'||viewGesture)return;const sp=stagePoint(e.clientX,e.clientY),li=looseAt(sp);
 if(li>=0){select({kind:'tray',index:li});beginPointer(e,selected);return;}
 const pt=worldPoint(e.clientX,e.clientY),ti=textAt(pt);if(ti>=0){select({kind:'text',index:ti});beginPointer(e,selected);return;}
 const i=slotAt(pt);if(i<0){select(null);return;}if(selected&&['tray','favorite'].includes(selected.kind)){place(selected,i);return;}
 if(selected?.kind==='board'&&selected.index!==i&&!current().slots[i]){place(selected,i);return;}
 if(current().slots[i]){select({kind:'board',index:i});beginPointer(e,selected);}else select(null);
});
window.addEventListener('pointermove',e=>{if(viewGesture||!pointer||pointer.id!==e.pointerId)return;const p=pointer;p.lastX=e.clientX;p.lastY=e.clientY;
 if(!p.moved&&Math.hypot(e.clientX-p.startX,e.clientY-p.startY)>5){p.moved=true;if(p.source.kind==='text')snap();}
 if(!p.moved)return;
 if(p.source.kind==='text'){const pt=worldPoint(e.clientX,e.clientY),t=current().texts[p.source.index];t.x=Math.max(0,Math.min(.96,(pt.x-p.offset.x)/geom.W));t.y=Math.max(0,Math.min(.96,(pt.y-p.offset.y)/geom.H));}
 else{const sp=stagePoint(e.clientX,e.clientY);p.center.x=sp.x-p.offset.x;p.center.y=sp.y-p.offset.y;hoverSlot=nearbySlot(p);}
 renderCanvas();e.preventDefault();},{passive:false});
window.addEventListener('pointerup',e=>{if(!pointer||pointer.id!==e.pointerId)return;const p=pointer;pointer=null;hoverSlot=-1;if(!p.moved){renderCanvas();return;}
 if(p.source.kind==='text'){render();persist();return;}const sp=stagePoint(e.clientX,e.clientY);p.center.x=sp.x-p.offset.x;p.center.y=sp.y-p.offset.y;const i=nearbySlot(p);
 if(i>=0&&place(p.source,i,p.center))return;
 if(p.source.kind==='board'&&i===p.source.index){renderCanvas();return;}
 dropOnTable(p);
});
window.addEventListener('pointercancel',()=>{if(pointer?.source.kind==='text'&&pointer.moved){current().texts[pointer.source.index]=pointer.textOriginal;history.pop();}pointer=null;hoverSlot=-1;render();});
boardCanvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)&&current().tray.length){e.preventDefault();const index=selected?.kind==='tray'?(selected.index+(e.key==='ArrowLeft'?-1:1)+current().tray.length)%current().tray.length:0;select({kind:'tray',index});}else if(e.key==='Enter'&&selected?.kind==='tray'&&state.mode==='puzzle'){const t=selectedTile();if(t.imageId===state.active&&t.cols===current().cols)place(selected,t.r*current().cols+t.c);}});
$('favoriteBtn').onclick=()=>{const t=selectedTile();if(!t)return;if(state.favorites.some(f=>JSON.stringify(cleanTile(f))===JSON.stringify(cleanTile(t)))){toast('这块已经在收纳盒里啦 ♡');return;}snap();state.favorites.push(cleanTile(t));renderFavorites();updateSelection();persist();toast('已收藏。换张照片，让它们相遇吧！');};$('removeBtn').onclick=removeSelected;
$('shuffleBtn').onclick=()=>{if(pointer)return;snap();motion=null;const b=current(),origins=new Map();for(const t of b.tray)origins.set(t,looseCenter(t));
 for(let i=0;i<b.slots.length;i++)if(b.slots[i]){const t=addLoose(b.slots[i]);origins.set(t,slotCenter(i));}b.slots.fill(null);
 const arranged=[];for(const t of b.tray){t.pose=randomPose(arranged);arranged.push(t);}selected=null;render();animate({kind:'scatter',origins,duration:680});persist();toast('散落在台面上啦，随手拿起一块吧。');};
$('resetBtn').onclick=()=>{motion=null;hoverSlot=-1;snap();const b=current();b.slots=makeBoard(state.active,b.cols).slots;b.tray=[];selected=null;render();persist();toast('已恢复完整图片，文字和底色已保留。');};
$('undoBtn').onclick=()=>{motion=null;hoverSlot=-1;const old=history.pop();if(!old)return;state.active=old.active;state.boards[old.active]=old.board;state.favorites=old.favorites;state.mode=old.mode;selected=null;render();persist();};
$('puzzleMode').onclick=()=>{state.mode='puzzle';select(null);renderModes();persist();};$('collageMode').onclick=()=>{state.mode='collage';select(null);renderModes();persist();};
document.querySelectorAll('[data-grid]').forEach(el=>el.onclick=()=>{const n=Number(el.dataset.grid);if(n===current().cols)return;motion=null;pointer=null;hoverSlot=-1;snap();const old=current(),fresh=makeBoard(state.active,n);fresh.bg=old.bg;fresh.texts=old.texts;state.boards[state.active]=fresh;selected=null;render();persist();toast(`已生成 ${fresh.slots.length} 块拼图，收藏碎片仍然保留。`);});
document.querySelectorAll('[data-bg]').forEach(el=>el.onclick=()=>{snap();current().bg=el.dataset.bg;render();persist();});$('bgColor').addEventListener('change',e=>{snap();current().bg=e.target.value;render();persist();});
$('textSize').oninput=e=>{$('textSizeValue').value=e.target.value;};
$('addTextBtn').onclick=()=>{const value=$('textInput').value.trim();if(!value){toast('先写一点想留下的话吧。');return;}snap();const t={value,font:$('fontSelect').value,color:$('textColor').value,size:Number($('textSize').value)};if(selected?.kind==='text'){Object.assign(current().texts[selected.index],t);}else{current().texts.push({...t,x:.08,y:.8});selected={kind:'text',index:current().texts.length-1};}render();persist();if(isMobileUi())closeToolDrawer();toast('文字已放好，可以拖动调整位置。');};
$('referenceBtn').addEventListener('pointerdown',e=>{showReference=true;renderCanvas();e.preventDefault();$('referenceBtn').setPointerCapture(e.pointerId);});['pointerup','pointercancel','lostpointercapture'].forEach(type=>$('referenceBtn').addEventListener(type,()=>{showReference=false;renderCanvas();}));$('referenceBtn').addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){showReference=true;renderCanvas();}});$('referenceBtn').addEventListener('keyup',()=>{showReference=false;renderCanvas();});
$('exportBtn').onclick=()=>{const {W,H}=dimensions(),out=document.createElement('canvas');out.width=W;out.height=Math.round(H);paintBoard(out.getContext('2d'),W,H,true);out.toBlob(blob=>{if(!blob){toast('导出失败，请再试一次。');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`piece-of-you-${Date.now()}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('作品已导出，空位会保留你设置的底色。');},'image/png');};
$('uploadInput').onchange=async e=>{const files=[...e.target.files];if(!files.length)return;document.querySelector('label[for=uploadInput]').classList.add('busy');let added=[];for(const file of files){try{if(file.size>25*1024*1024)throw new Error('图片超过 25MB，请先缩小');const object=URL.createObjectURL(file);let im;try{im=await loadImage(object);}finally{URL.revokeObjectURL(object);}const c=document.createElement('canvas');const scale=Math.min(1,1500/im.naturalWidth,1800/im.naturalHeight);c.width=Math.max(1,Math.round(im.naturalWidth*scale));c.height=Math.max(1,Math.round(im.naturalHeight*scale));c.getContext('2d').drawImage(im,0,0,c.width,c.height);const url=c.toDataURL('image/webp',.9),id=`photo-${crypto.randomUUID()}`;images.set(id,await loadImage(url));const photo={id,name:file.name.replace(/\.[^.]+$/,'').slice(0,35),url};state.photos.push(photo);state.boards[id]=makeBoard(id,current().cols);added.push(id);}catch(err){toast(`无法打开「${file.name.slice(0,18)}」：${err.message}`);}}if(added.length){state.active=added[0];selected=null;history=[];render();persist();if(isMobileUi())closeToolDrawer();toast(`已上传 ${added.length} 张照片。点击打散开始拼图。`);}e.target.value='';document.querySelector('label[for=uploadInput]').classList.remove('busy');};

$('helpBtn').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();$('startBtn').onclick=()=>$('helpDialog').close();$('helpDialog').addEventListener('click',e=>{if(e.target===$('helpDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='Delete'||e.key==='Backspace'){if(selected){e.preventDefault();removeSelected();}}if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();$('undoBtn').click();}if(e.key==='Escape')select(null);});
new ResizeObserver(()=>renderCanvas()).observe(boardCanvas);
async function init(){try{db=await openDb();const saved=await getStored();if(saved?.photos?.length&&saved.boards){state=migrateBuiltins(saved);}}catch(e){$('saveStatus').textContent='● 当前会话';}const results=await Promise.allSettled(state.photos.map(async p=>{images.set(p.id,await loadImage(p.url));return p.id;}));const failed=results.map((r,i)=>r.status==='rejected'?state.photos[i].id:null).filter(Boolean);if(failed.length){state.photos=state.photos.filter(p=>!failed.includes(p.id));state.favorites=state.favorites.filter(t=>!failed.includes(t.imageId));Object.values(state.boards).forEach(b=>{b.slots=b.slots.map(t=>t&&!failed.includes(t.imageId)?t:null);b.tray=b.tray.filter(t=>!failed.includes(t.imageId));});}if(!state.photos.length){$('loading').textContent='示例图片加载失败，请刷新页面。';return;}if(!images.has(state.active))state.active=state.photos[0].id;if(!state.boards[state.active])state.boards[state.active]=makeBoard(state.active);$('loading').hidden=true;render();}

const toolNames={photos:'我的照片',puzzle:'拼图设置',favorites:'灵感收纳盒',background:'画布底色',text:'写点什么'};
let mobileUiActive=false,activeTool=null,drawerReturnFocus=null;
const mobileMedia=window.matchMedia?.('(max-width:850px)');
function isMobileUi(){return mobileUiActive;}
function markToolTabs(tool){document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-expanded',String(b.dataset.tool===tool));});document.querySelectorAll('[data-drawer-tool]').forEach(b=>b.classList.toggle('active',b.dataset.drawerTool===tool));}
function openToolDrawer(tool){if(!mobileUiActive||!toolNames[tool])return;resetDrawerDrag();activeTool=tool;$('drawerTitle').textContent=toolNames[tool];document.querySelectorAll('[data-tool-panel]').forEach(p=>p.hidden=p.dataset.toolPanel!==tool);markToolTabs(tool);if(!$('toolDrawer').open){drawerReturnFocus=document.activeElement;$('toolDrawer').showModal();}const scroll=$('toolDrawer').querySelector?.('.drawer-scroll');if(scroll)scroll.scrollTop=0;}
function closeToolDrawer(){resetDrawerDrag();if($('toolDrawer').open)$('toolDrawer').close();activeTool=null;markToolTabs(null);}

let drawerGesture=null,drawerSettleTimer=0;
function resetDrawerDrag(){clearTimeout(drawerSettleTimer);drawerSettleTimer=0;drawerGesture=null;const d=$('toolDrawer');d.classList.remove('dragging');d.style.transform='';d.style.transition='';}
function startDrawerDrag(x,y,id,type){if(!$('toolDrawer').open)return;resetDrawerDrag();drawerGesture={x,y,lastY:y,lastTime:now(),velocity:0,delta:0,id,type};}
function moveDrawerDrag(x,y){const g=drawerGesture;if(!g)return false;const dy=y-g.y,dx=x-g.x;
 if(g.type==='touch'&&!g.delta&&(dy<-6||Math.abs(dx)>Math.max(10,dy))){drawerGesture=null;return false;}
 if(dy<=6&&!g.delta)return false;
 const time=now();g.velocity=(y-g.lastY)/Math.max(1,time-g.lastTime);g.lastTime=time;g.lastY=y;g.delta=Math.max(0,dy);
 const d=$('toolDrawer');d.classList.add('dragging');d.style.transition='none';d.style.transform=`translateY(${g.delta}px)`;return true;
}
function endDrawerDrag(cancelled=false){const g=drawerGesture;if(!g)return;drawerGesture=null;const d=$('toolDrawer');const threshold=Math.max(48,Math.min(90,d.getBoundingClientRect().height*.2));
 const dismiss=!cancelled&&(g.delta>=threshold||(g.delta>=24&&g.velocity>.5&&now()-g.lastTime<100));
 if(reducedMotion()){resetDrawerDrag();if(dismiss)closeToolDrawer();return;}
 d.style.transition='transform .18s ease-out';d.style.transform=dismiss?`translateY(${d.getBoundingClientRect().height+20}px)`:'translateY(0px)';
 drawerSettleTimer=setTimeout(()=>{if(dismiss)closeToolDrawer();else resetDrawerDrag();},180);
}
function setupDrawerSwipe(){const grip=$('drawerGrip'),scroll=$('drawerScroll');
 grip.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse')return;startDrawerDrag(e.clientX,e.clientY,e.pointerId,'pointer');try{grip.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});
 grip.addEventListener('pointermove',e=>{if(drawerGesture?.type!=='pointer'||drawerGesture.id!==e.pointerId)return;moveDrawerDrag(e.clientX,e.clientY);});
 grip.addEventListener('pointerup',e=>{if(drawerGesture?.type==='pointer'&&drawerGesture.id===e.pointerId){if(e.clientY!==drawerGesture.lastY)moveDrawerDrag(e.clientX,e.clientY);endDrawerDrag();}});
 grip.addEventListener('pointercancel',()=>endDrawerDrag(true));grip.addEventListener('lostpointercapture',()=>{if(drawerGesture?.type==='pointer')endDrawerDrag(true);});
 grip.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();closeToolDrawer();}});
 scroll.addEventListener('touchstart',e=>{if(e.touches.length!==1||scroll.scrollTop>0||e.target.closest('button,input,textarea,select,label,[role="button"]'))return;const t=e.touches[0];startDrawerDrag(t.clientX,t.clientY,t.identifier,'touch');},{passive:true});
 scroll.addEventListener('touchmove',e=>{if(drawerGesture?.type!=='touch')return;if(e.touches.length!==1){endDrawerDrag(true);return;}const t=e.touches[0];if(t.identifier!==drawerGesture.id)return;if(moveDrawerDrag(t.clientX,t.clientY)&&e.cancelable)e.preventDefault();},{passive:false});
 scroll.addEventListener('touchend',()=>{if(drawerGesture?.type==='touch')endDrawerDrag();});scroll.addEventListener('touchcancel',()=>{if(drawerGesture?.type==='touch')endDrawerDrag(true);});
}
const movableControls=[
 ['photosSection','photosPanel'],['modesSection','puzzlePanel'],['gridSection','puzzlePanel'],['resetBtn','puzzleActions'],['helpBtn','puzzleActions'],
 ['favoritesSection','favoritesPanel'],['backgroundSection','backgroundPanel'],['textSection','textPanel'],
 ['undoBtn','quickActions'],['referenceBtn','quickActions'],['shuffleBtn','quickActions'],['exportBtn','quickActions']
];
const controlHomes=[];
function setupMobileUi(){
 for(const [id,panel] of movableControls){const node=$(id);if(!node?.parentNode)continue;const marker=document.createElement('span');marker.hidden=true;node.parentNode.insertBefore(marker,node);controlHomes.push({node,marker,panel});}
 const apply=()=>{const mobile=Boolean(mobileMedia?.matches);if(mobile===mobileUiActive)return;closeToolDrawer();mobileUiActive=mobile;$('mobileDock').hidden=!mobile;
  for(const {node,marker,panel} of controlHomes){if(mobile)$(panel).append(node);else marker.parentNode.insertBefore(node,marker.nextSibling);}
  if(mobile){const actions=$('puzzleActions');if(actions?.parentNode)$('puzzlePanel').append(actions);}
  const exportLabel=$('exportBtn').querySelector?.('.export-label');if(exportLabel)exportLabel.textContent=mobile?'导出':'导出作品';updateViewportHeight();if(current())renderCanvas();
 };
 document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>openToolDrawer(b.dataset.tool));document.querySelectorAll('[data-drawer-tool]').forEach(b=>b.onclick=()=>openToolDrawer(b.dataset.drawerTool));
 setupDrawerSwipe();
 $('toolDrawer').addEventListener('close',()=>{resetDrawerDrag();activeTool=null;markToolTabs(null);if(drawerReturnFocus?.isConnected)drawerReturnFocus.focus?.();});
 $('toolDrawer').addEventListener('click',e=>{if(e.target!==$('toolDrawer'))return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeToolDrawer();});
 mobileMedia?.addEventListener?.('change',apply);apply();
}
function updateViewportHeight(){if(!document.documentElement?.style)return;const height=window.visualViewport?.height||window.innerHeight;if(height)document.documentElement.style.setProperty('--app-height',`${Math.round(height)}px`);}
window.visualViewport?.addEventListener('resize',updateViewportHeight);window.addEventListener('resize',updateViewportHeight);
setupMobileUi();

init();
