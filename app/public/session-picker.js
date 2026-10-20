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
 let pending=null,pendingRequest=null,sequence=0,queue=Promise.resolve(),controller=null;
 return {get pending(){return pending;},get pendingRequest(){return pendingRequest;},async select(request){
  const id=++sequence;controller?.abort();controller=new AbortController();const signal=controller.signal;pending=request.selection;pendingRequest=request;onChange();
  const task=(request.mode==='disconnected'?Promise.resolve():queue.catch(()=>{})).then(()=>id===sequence?connect(request,signal):undefined);queue=task;
  try{return await task;}catch(e){if(e.name!=='AbortError'||id===sequence)throw e;}finally{if(id===sequence){pending=null;pendingRequest=null;onChange();}}
 }};
}
export function connectionView(state,pending=null){
 if(state.serviceError)return {light:'red',text:'工具服务不可用',button:'重新连接',action:'connect',connected:false,cancel:false};
 const active=pending?pending.mode==='keil':state.mode==='keil';
 if(pending?.mode==='disconnected')return {light:'yellow',text:'正在断开',button:'正在断开…',action:'disconnect',connected:false,cancel:false};
 if(pending)return {light:'yellow',text:'正在连接 Keil',button:'取消连接',action:'disconnect',connected:false,cancel:false};
 if(active&&['running','halted'].includes(state.status))return {light:'green',text:state.status==='running'?'Keil 已连接 · 运行中':'Keil 已连接 · 已暂停',button:'断开连接',action:'disconnect',connected:true,cancel:false};
 if(active&&state.status==='waiting')return {light:'yellow',text:'等待进入 Debug',button:'取消连接',action:'disconnect',connected:false,cancel:false};
 if(active&&state.status==='connecting')return {light:'yellow',text:'正在连接 Keil',button:'取消连接',action:'disconnect',connected:false,cancel:false};
 if(active)return {light:'red',text:'Keil 连接失败',button:'重新连接',action:'connect',connected:false,cancel:true};
 return {light:'red',text:'Keil 未连接',button:'连接 Keil',action:'connect',connected:false,cancel:false};
}
