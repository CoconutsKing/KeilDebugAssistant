import {isIntegerVariable,formatValue} from './format.js';
export function stepValue(value,direction,min,max,step){const next=Number(value)+Math.sign(direction)*Number(step);return Math.max(Number(min),Math.min(Number(max),Number(next.toPrecision(12))));}
export function createControl(initial,{root,api,settings}){
 let value=initial,pending=null,working=false,timer=null,draft=false,dragging=false,hasReadback=false,hexPending=null;const wrapper=document.createElement('div');wrapper.className='tuning-row';wrapper.dataset.name=initial.name;
 const label=document.createElement('div');label.className='tuning-label';const name=document.createElement('strong');name.textContent=initial.name===root?initial.name:initial.name.slice(root.length).replace(/^\./,'');name.title=initial.name;const displayed=document.createElement('span');label.append(name,displayed);
 const radixLabel=document.createElement('label');radixLabel.className='radix-option';radixLabel.title='切换实际值的显示进制，数值输入与滑条仍按十进制调节';const hex=document.createElement('input');hex.type='checkbox';hex.setAttribute('aria-label',initial.name+' 十六进制显示');const radixText=document.createElement('span');radixText.textContent='十六进制';radixLabel.append(hex,radixText);label.append(radixLabel);
 const controls=document.createElement('div');controls.className='tuning-controls';
 const minus=document.createElement('button');minus.textContent='−';minus.title='减小一个步长';
 const range=document.createElement('input');range.type='range';range.className='range';range.setAttribute('aria-label',initial.name+' 滑条');range.title='拖动修改；鼠标悬停时滚轮向上增加、向下减小';
 const plus=document.createElement('button');plus.textContent='＋';plus.title='增大一个步长';
 const input=document.createElement('input');input.type='number';input.className='tuning-number';input.setAttribute('aria-label',initial.name+' 数值');input.title='按十进制输入';
 const write=document.createElement('button');write.textContent='写入';
 const toggle=document.createElement('button');toggle.className='toggle-value';toggle.textContent='⇄ 上次值';toggle.setAttribute('aria-label',initial.name+' 切换上次值');toggle.disabled=true;
 const gear=document.createElement('button');gear.textContent='⚙';gear.title='设置此成员的范围与步长';gear.onclick=()=>settings(value);
 const message=document.createElement('div');message.className='tuning-message';
 const bounds=document.createElement('small');bounds.className='tuning-bounds';
 controls.append(minus,range,plus,input,write,toggle,gear);wrapper.append(label,controls,bounds,message);
 const integer=()=>isIntegerVariable(value);
 const formatted=(next=value)=>formatValue(next,hexPending??value.hex);
 function refreshFormat(){radixLabel.hidden=!integer();hex.disabled=hexPending!==null;hex.checked=!!(hexPending??value.hex)&&integer();displayed.textContent=value.pointer?'指针':formatted();displayed.title=integer()?'十进制：'+formatValue(value,false)+'　十六进制：'+formatValue(value,true):'';refreshToggle();}
 function resultValue(result){const parent=result.items.find(v=>v.name===root);return parent?.children?.find(v=>v.name===value.name)||(parent?.name===value.name?parent:null);}
 hex.onchange=async()=>{if(!integer()||hexPending!==null)return;hexPending=hex.checked;refreshFormat();try{const actual=resultValue(await api('display',{root,name:value.name,hex:hexPending}));if(actual)value=actual;}catch(e){message.textContent=e.message;}finally{hexPending=null;refreshFormat();if(hasReadback&&!working&&pending===null&&!value.error)message.textContent=value.writeNotice||'实际值：'+formatted();}};
 const effectiveStep=()=>integer()?Math.max(1,Math.ceil(value.step)):value.step;
 const ready=()=>value.editable&&!value.pointer&&!value.array&&!value.aggregate&&value.value!==undefined&&Number.isFinite(Number(value.value));
 function historyTarget(){const h=value.history;return h&&h.previous!==h.current&&Number.isFinite(h.previous)&&Number.isFinite(h.current)&&['current','previous'].includes(h.selected)?h[h.selected==='current'?'previous':'current']:null;}
 function refreshToggle(){const target=historyTarget();toggle.textContent=target===null?'⇄ 上次值':'⇄ 切换到 '+formatted({...value,value:target});toggle.disabled=!ready()||working||pending!==null||target===null||target<value.min||target>value.max;toggle.title=target===null?'首次成功写入不同数值后，即可在修改前的值和新值之间切换':`两个目标值：${formatted({...value,value:value.history.previous})} ↔ ${formatted({...value,value:value.history.current})}${target<value.min||target>value.max?'（目标超出当前设置范围，请先调整范围）':''}`;}
 function applyResult(result){const actual=resultValue(result);if(actual){value=actual;refreshFormat();if(pending===null){draft=false;optimistic(actual.value);}}hasReadback=true;message.textContent=actual?.writeNotice||'实际值：'+formatted();}
 function optimistic(next){const numeric=String(Number(next));input.value=numeric;range.value=numeric;}
 function schedule(next,debounce=false){if(!ready()||!Number.isFinite(next))return;pending=next;optimistic(next);refreshToggle();clearTimeout(timer);if(debounce)timer=setTimeout(flush,120);else void flush();}
 async function flush(){if(working||pending===null)return;working=true;refreshToggle();while(pending!==null){const next=pending;pending=null;message.textContent='写入并回读…';try{applyResult(await api('write',{root,name:value.name,value:next}));}catch(e){pending=null;message.textContent=e.message;optimistic(value.value);}}working=false;refreshToggle();}
 toggle.onclick=async()=>{if(toggle.disabled||working||pending!==null)return;working=true;refreshToggle();draft=false;message.textContent='切换目标并回读…';try{applyResult(await api('toggle',{root,name:value.name}));}catch(e){message.textContent=e.message;}finally{working=false;refreshToggle();if(pending!==null)void flush();}};
 function change(direction){const current=Number(input.value||value.value);schedule(stepValue(current,direction,value.min,value.max,effectiveStep()),true);}
 range.oninput=()=>{dragging=true;input.value=range.value;};range.onchange=()=>{dragging=false;draft=false;schedule(Number(range.value));};
 range.addEventListener('wheel',event=>{if(!ready()||!event.deltaY)return;event.preventDefault();change(event.deltaY<0?1:-1);},{passive:false});
 minus.onclick=()=>change(-1);plus.onclick=()=>change(1);write.onclick=()=>{draft=false;schedule(input.value===''?NaN:Number(input.value));};input.oninput=()=>{draft=true;};input.onblur=()=>{draft=false;};input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();write.click();}};
 return {element:wrapper,get busy(){return working||pending!==null||dragging;},update(next){value=next;range.min=input.min=next.min;range.max=input.max=next.max;range.step=input.step=effectiveStep();for(const node of [minus,plus,range,input,write])node.disabled=!ready();bounds.textContent=`${next.min} ～ ${next.max}　步长 ${effectiveStep()}　${next.type||'等待采样'}${next.updated?'　'+Math.max(0,Math.floor((Date.now()-next.updated)/1000))+' 秒前读取':''}`;refreshFormat();if(!working&&pending===null&&!dragging){if(!draft)input.value=ready()?String(Number(next.value)):'';range.value=ready()?String(Number(next.value)):next.min;}if(next.error)message.textContent=next.error;else if(!next.updated)message.textContent='等待读取…';else if(!working&&pending===null&&hasReadback)message.textContent=next.writeNotice||'实际值：'+formatted();else if(message.textContent==='等待读取…')message.textContent='';},dispose(){clearTimeout(timer);pending=null;}};
}

