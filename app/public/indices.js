export function createIndexControls({axes,onSelect,document:doc=globalThis.document}){
 const element=doc.createElement('div');element.className='array-indices';const controls=[];
 for(const axis of axes){
  const row=doc.createElement('div');row.className='array-axis';const label=doc.createElement('label');label.textContent=axes.length>1?'第 '+(axis.dimension+1)+' 维索引':'数组索引';label.title=axis.parent;
  const input=doc.createElement('input');input.type='number';input.min='0';input.step='1';input.setAttribute('aria-label',axis.parent+' 数组索引');label.append(input);
  const previous=doc.createElement('button'),next=doc.createElement('button'),all=doc.createElement('button'),count=doc.createElement('small');previous.textContent='‹';next.textContent='›';all.textContent='整个数组';
  previous.type=next.type=all.type='button';previous.setAttribute('aria-label',axis.parent+' 上一个索引');next.setAttribute('aria-label',axis.parent+' 下一个索引');all.setAttribute('aria-label',axis.parent+' 显示整个数组');
  const commit=()=>void onSelect(axis.dimension,input.value.trim()===''?NaN:Number(input.value));input.onchange=commit;input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();commit();}};
  previous.onclick=()=>void onSelect(axis.dimension,Number(input.value)-1);next.onclick=()=>void onSelect(axis.dimension,axis.index===null?Number(input.value):Number(input.value)+1);all.onclick=()=>void onSelect(axis.dimension,null);
  row.append(label,previous,next,all,count);element.append(row);controls.push({axis,input,previous,next,all,count});
 }
 return {element,update(axes,disabled=false){controls.forEach((control,i)=>{
  const axis=axes[i]||control.axis;Object.assign(control.axis,axis);if(doc.activeElement!==control.input)control.input.value=String(axis.index??0);
  control.input.max=axis.count?String(axis.count-1):'';control.input.disabled=disabled;
  control.previous.disabled=disabled||axis.index===null||Number(control.input.value)<=0;control.next.disabled=disabled||!!axis.count&&axis.index!==null&&Number(control.input.value)>=axis.count-1;
  control.all.disabled=disabled||axis.index===null;control.all.classList.toggle('index-all-active',axis.index===null);control.count.textContent=axis.count?`0～${axis.count-1}${axis.index===null?' · 当前全部':''}`:'范围待工程加载';
 });}};
}
