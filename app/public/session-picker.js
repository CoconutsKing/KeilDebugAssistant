const statusLabels={running:'运行中',halted:'已暂停',waiting:'等待 Debug',unavailable:'不可用',unknown:'连接中'};
export function sessionChoices(sessions,selection='auto',current=null){
 const list=[...sessions],selected=String(selection||'auto');
 if(selected!=='auto'&&!list.some(s=>String(s.port)===selected)){
  list.push(current&&String(current.port)===selected?current:{port:Number(selected),title:'已固定端口 '+selected,status:'unknown'});
 }
 return {selected,options:[{value:'auto',label:'自动 · 寻找 Debug 会话',disabled:false},...list.map(s=>({value:s.port?String(s.port):'pid:'+s.pid,label:(s.project?.split(/[\\/]/).at(-1)||s.title||'Keil')+' · '+(s.port?'端口 '+s.port+' · '+(statusLabels[s.status]||'连接中'):'无端口，请配置 UVSOCK'),title:s.project||s.title||'',disabled:!s.port}))]};
}
// Keep the latest choice visible while earlier connection requests finish.
export function createSessionSwitch({connect,onChange=()=>{}}){
 let pending=null,sequence=0,queue=Promise.resolve();
 return {get pending(){return pending;},async select(request){
  const id=++sequence;pending=request.selection;onChange();
  const task=queue.catch(()=>{}).then(()=>id===sequence?connect(request):undefined);queue=task;
  try{return await task;}finally{if(id===sequence){pending=null;onChange();}}
 }};
}
