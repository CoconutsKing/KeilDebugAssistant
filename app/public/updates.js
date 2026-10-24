export function updateView(state={}){
 const automatic=state.automatic!==false,phase=state.phase||'idle',version=state.latestVersion?'V'+state.latestVersion:'尚未检查';
 const messages={idle:'后台静默检查新版本，不影响变量监测。',checking:'正在检查 GitHub 正式版…',current:'当前版本无需更新。',available:'发现新版本，可手动更新。',downloading:'正在后台下载并校验更新包…',ready:state.waitingForDisconnect&&(automatic||state.requested)?'更新已下载。'+(state.waitingReason||'手动断开 Keil 后安装，调试继续运行。'):automatic||state.requested?'更新已就绪，即将安装并重启。':'更新已就绪，点击下方按钮安装。',installing:'正在安装并重启工具，页面将自动重新连接。',error:'更新未完成，可检查网络后重试；现有调试功能可继续使用。'};
 return {latest:version,message:messages[phase]||messages.idle,error:state.error||'',busy:['checking','downloading','installing'].includes(phase),canInstall:state.canUpdate!==false&&!!state.latestVersion&&['available','ready','error'].includes(phase),button:state.waitingForDisconnect?'排队更新（断开后安装）':state.staged?'安装更新并重启':'下载更新并重启',badge:['available','downloading','ready','installing'].includes(phase)};
}
export function createUpdates({document,api,render}){
 const $=id=>document.getElementById(id);let pending=false,localError='';
 const request=async(path,data={})=>{pending=true;localError='';render();try{await api('update/'+path,data);}catch(e){localError=e.message;}finally{pending=false;render();}};
 $('updates').onclick=()=>{$('updateDialog').showModal();};$('closeUpdate').onclick=()=>$('updateDialog').close();
 $('checkUpdate').onclick=()=>void request('check');$('installUpdate').onclick=()=>void request('install');$('automaticUpdate').onchange=()=>void request('settings',{automatic:$('automaticUpdate').checked});
 return {update(state){
  const view=updateView(state);$('updates').classList.toggle('has-update',view.badge);$('updates').title=view.badge?'软件更新：发现新版本':'软件更新';
  $('updateCurrent').textContent='V'+(state?.currentVersion||'—');$('updateLatest').textContent=view.latest;$('updateMessage').textContent=view.message;
  $('updateError').textContent=localError||view.error;
  $('automaticUpdate').checked=state?.automatic!==false;$('automaticUpdate').disabled=pending||state?.phase==='installing';
  $('checkUpdate').disabled=pending||view.busy;$('installUpdate').disabled=pending||view.busy||!view.canInstall;$('installUpdate').textContent=view.button;
  $('updateChecked').textContent=state?.checkedAt?'上次检查：'+new Date(state.checkedAt).toLocaleString('zh-CN',{hour12:false}):'';
 }};
}
