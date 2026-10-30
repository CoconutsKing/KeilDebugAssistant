import http from 'node:http';
import {readFile,writeFile,rename,unlink,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {SessionPool,chooseSession} from './lib/sessions.mjs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {version} from './lib/version.mjs';
import {Updater,startInstaller} from './lib/updater.mjs';
import {resolve} from 'node:path';
import {preferences as validatePreferences} from './lib/preferences.mjs';
import {loadCatalog} from './lib/catalog.mjs';
import {flattenGroup,selectedRows} from './lib/groups.mjs';
import {validateLayout} from './lib/layout.mjs';
import {validHistory,recordInput,toggleTarget} from './lib/history.mjs';
import {isIntegerVariable} from './public/format.js';
import {dataRows,restorableValue,validateSavedRecord,savedRecords,restoreRows,sameTargetType} from './lib/saved-data.mjs';
import {matchesTarget} from './lib/uvsock.mjs';
import {arrayAxes,reindexItem} from './lib/array-index.mjs';
import {initializerPlan,cppInitializer,cppNumber} from './lib/array-copy.mjs';
import {validateItem,validateWrite,watchNames,validName,memberPath} from './lib/model.mjs';
const root=new URL('./',import.meta.url),home=new URL('../',root),userRoot=process.env.KDA_USER_DIR?pathToFileURL(resolve(process.env.KDA_USER_DIR)+'/'):new URL('userdata/',home),dataRoot=process.env.KDA_DATA_DIR?pathToFileURL(resolve(process.env.KDA_DATA_DIR)+'/'):new URL('data/',home),config=new URL('panel.json',userRoot);
await mkdir(userRoot,{recursive:true});await mkdir(dataRoot,{recursive:true});
const pool=new SessionPool();let selection='auto',sessionInfo=null,sessionKey='',sessionId='',profiles={},prefs=validatePreferences({});
let items=[],mode='disconnected',client=null,status='disconnected',lastError='',interval=500,projectPath='',lastXml='',values=new Map(),busy=false;
let shuttingDown=false,updating=false,connectionEpoch=0;const runtime=new URL('runtime.json',dataRoot),shutdownToken=randomUUID();
let catalog=null,catalogError='',catalogChecked=0;
let interactionRequested=false,lastUIBusyAt=0;
let defaults={min:0,max:100,step:1,pinned:true},excluded=new Set(),groupPlans=new Map(),sampleCursor=0;
let activeRoots=[],sampleRound=0;
let layout={mode:'grid',widgets:{}};
let writeHistory={};
let savedData=savedRecords(),dataJob=null,debugJob=null,copyJob=null;
function historyScope(){return projectPath||'keil';}
function historyFor(name){const history=writeHistory[historyScope()]?.[name];return validHistory(history)?history:null;}
function rememberHistory(name,history){if(!validHistory(history))return;const scope=historyScope();if(!Object.hasOwn(writeHistory,scope))writeHistory[scope]={};Object.defineProperty(writeHistory[scope],name,{value:history,writable:true,enumerable:true,configurable:true});}
function planFor(name){const key=(catalog?.key||'')+':'+name;if(groupPlans.has(key))return groupPlans.get(key);const describe=path=>catalog?.describe(path);const children=path=>{const all=[];let offset=0;do{const page=catalog?.children(path,offset);if(!page)break;all.push(...page.members);offset=page.nextOffset;}while(offset!==null&&all.length<513);return all;};const result=flattenGroup(name,describe,children);groupPlans.set(key,result);return result;}
function rowsFor(item){return selectedRows(planFor(item.name),item.visibleMembers);}
function containsMember(item,name){return item&&(item.name===name||rowsFor(item).some(row=>row.name===name));}
async function refreshCatalog(force=false){if(!projectPath)return;if(!force&&Date.now()-catalogChecked<5000)return;catalogChecked=Date.now();try{catalog=await loadCatalog(projectPath);catalogError='';}catch(e){catalog=null;catalogError=e.message;}}
async function readLive(name){
 const meta=catalog?.describe(name);
 if(meta?.array){const children=catalog.children(name)?.members||[],preview=[];for(const child of children.slice(0,8)){if(interactionRequested&&preview.length)break;if(child.array||child.aggregate||child.pointer){preview.push('{…}');continue;}try{const value=(await client.read(child.name)).value;preview.push(Number.isFinite(Number(value))?String(Number(Number(value).toPrecision(7))):value);}catch(e){preview.push('不可读');}}return {...meta,name,value:'['+preview.join(', ')+(meta.count>preview.length?', …':'')+']',editable:false,preview};}
 const value=await client.read(name);if(meta?.aggregate)return {...value,...meta,value:'{…}',editable:false};
 return meta?{...value,...meta,editable:value.editable&&!meta.pointer}:value;
}
try{let raw;try{raw=await readFile(config,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;raw=await readFile(new URL('panel.json',home),'utf8');}const c=JSON.parse(raw);profiles=c.profiles||{};prefs=validatePreferences(c.preferences||{});items=c.items.map(validateItem);projectPath=c.projectPath||'';sessionKey=c.sessionKey||(projectPath?projectPath.replace(/\.uvoptx$/i,'.uvprojx').toLowerCase():'');if(c.defaults||items.length){const d=validateItem({name:'defaults',...(c.defaults||items.at(-1))});defaults={min:d.min,max:d.max,step:d.step,pinned:d.pinned};}excluded=new Set(c.excluded||[]);if(c.layout)layout=validateLayout(c.layout);if(c.writeHistory&&typeof c.writeHistory==='object'&&!Array.isArray(c.writeHistory))writeHistory=c.writeHistory;savedData=savedRecords(c.savedData);}catch{}
function panelData(){return {items,projectPath,defaults,layout,writeHistory,savedData,excluded:[...excluded]};}
function applyPanel(c={}){items=(c.items||[]).map(validateItem);projectPath=c.projectPath||'';defaults=c.defaults||{min:0,max:100,step:1,pinned:true};layout=c.layout?validateLayout(c.layout):{mode:'grid',widgets:{}};writeHistory=c.writeHistory||{};savedData=savedRecords(c.savedData);excluded=new Set(c.excluded||[]);values.clear();groupPlans.clear();catalog=null;catalogError='';catalogChecked=0;lastXml='';activeRoots=[];sampleCursor=0;}
let saveQueue=Promise.resolve();
function save(){
 if(sessionKey)profiles[sessionKey]=panelData();
 const data=JSON.stringify({...panelData(),sessionKey,profiles,preferences:prefs},null,2),tmp=new URL('panel.json.tmp',userRoot);
 const result=saveQueue.catch(()=>{}).then(async()=>{await writeFile(tmp,data);await rename(tmp,config);});saveQueue=result;return result;
}
function savedInfo(name){const record=savedData[name];return record?{count:record.values.length,savedAt:record.savedAt}:null;}
function dataSource(){return projectPath?resolve(projectPath).replace(/\\/g,'/').toLowerCase():'';}
function jobInfo(){if(!dataJob||dataJob.sessionKey!==sessionKey)return null;const {id,root,sessionKey:scope,action,phase,status,total,completed,checked,attempted,error,started,finished}=dataJob;return {id,root,sessionKey:scope,action,phase,status,total,completed,checked,attempted,error,started,finished};}
function cancelDataJob(message){cancelArrayCopy(message);if(dataJob?.status==='running'){dataJob.status='cancelled';dataJob.error=message+(dataJob.action==='restore'?'；已开始的写入可能已生效，请检查实际值':'；上次保存的数据仍保留');dataJob.finished=Date.now();}}
function copyJobInfo(){if(!copyJob||copyJob.sessionId!==sessionId||copyJob.sessionKey!==sessionKey)return null;const {id,root,name,status,total,completed,copied,error,started,finished}=copyJob;return {id,root,name,status,total,completed,copied,skipped:copyJob.skipped.length,skippedNames:copyJob.skipped.slice(0,3).map(row=>row.name),error,started,finished};}
function cancelArrayCopy(message){if(copyJob?.status==='running'){copyJob.status='cancelled';copyJob.error=message+'；本次未生成复制数据';copyJob.finished=Date.now();copyJob.captured.clear();}}
function copyContext(job){return job===copyJob&&job.sessionId===sessionId&&job.sessionKey===sessionKey&&job.source===dataSource()&&job.epoch===connectionEpoch&&items.some(item=>item.name===job.root);}
function assertArrayCopy(job){if(!copyContext(job)||job.status!=='running'||mode!=='keil'||shuttingDown||catalog?.key!==job.catalogKey)throw Error('连接、数组或工程类型已改变，复制已停止');}
async function startArrayCopy(request){
 if(copyJob?.status==='running'||dataJob?.status==='running'||debugJob?.status==='running')throw Error('另一个读取或调试操作正在进行，请等待完成');
 if(mode!=='keil'||!client||!['running','halted'].includes(status))throw Error('请先连接 Keil 并进入 Debug 模式');
 const epoch=connectionEpoch,context=sessionId;await refreshCatalog(true);if(epoch!==connectionEpoch||context!==sessionId||mode!=='keil')throw Error('连接已切换，请刷新后重试');
 const item=items.find(item=>item.name===request.root);if(!item)throw Error('变量已被移除');
 const candidates=[item.name,...arrayAxes(item.name,path=>catalog?.describe(path)).map(axis=>axis.parent)];if(!candidates.includes(request.name))throw Error('复制范围不属于此组件');
 const plan=initializerPlan(request.name,catalog);
 copyJob={id:randomUUID(),root:item.name,name:request.name,...plan,source:dataSource(),catalogKey:catalog?.key,sessionId,sessionKey,epoch,status:'running',total:plan.rows.length,completed:0,copied:0,captured:new Map(),error:'',started:Date.now()};
 const job=copyJob;setTimeout(()=>void runArrayCopy(job),0);
}
async function runArrayCopy(job){
 if(job!==copyJob||job.status!=='running'||shuttingDown)return;if(busy){setTimeout(()=>void runArrayCopy(job),25);return;}busy=true;
 try{
  assertArrayCopy(job);const target=client;await target.status();assertArrayCopy(job);const deadline=Date.now()+150;
  for(let i=0;i<4&&Date.now()<deadline&&job.completed<job.total;i++){
   const row=job.rows[job.completed];
   try{const actual=await target.read(row.name);assertArrayCopy(job);cppNumber(actual);job.captured.set(row.name,actual);job.copied++;}
   catch(e){assertArrayCopy(job);if(e.keilStatus===6||target.socket?.destroyed)throw e;job.skipped.push({name:row.name,reason:e.message});}
   job.completed++;
  }
  if(job.completed===job.total){assertArrayCopy(job);job.text=cppInitializer(job.tree,job.captured);job.status='done';job.finished=Date.now();job.captured.clear();}
 }catch(e){if(job.status==='running'){job.status='error';job.error=e.message+'；本次未生成复制数据';job.finished=Date.now();job.captured.clear();}}
 finally{busy=false;if(job===copyJob&&job.status==='running')setTimeout(()=>void runArrayCopy(job),50);}
}
function groupData(root){
 const item=items.find(v=>v.name===root),plan=item&&planFor(root);if(!item||!plan.group)throw Error('请选择已添加的数组或结构体组件');
 const rows=dataRows(rowsFor(item)),meta=catalog?.describe(root);if(!rows.length)throw Error('当前没有选中可保存的数值成员');
 const signature=JSON.stringify([meta?.type,rows.map(row=>{const limits={...item,...item.members?.[row.name]};return [row.name,row.type,limits.min,limits.max];})]);
 return {item,rows,type:meta?.type||'',signature};
}
function assertDataJob(job){
 if(job!==dataJob||job.status!=='running'||shuttingDown||mode!=='keil'||job.sessionId!==sessionId||job.sessionKey!==sessionKey||job.source!==dataSource()||job.epoch!==connectionEpoch)throw Error('连接或调试工程已切换，操作已停止');
 if(groupData(job.root).signature!==job.signature)throw Error('组件成员、类型或范围已改变，操作已停止');
}
async function startDataJob(action,root){
 if(copyJob?.status==='running')throw Error('正在读取复制数据，请等待完成或取消');
 if(dataJob?.status==='running')throw Error('另一个组件正在保存或恢复数据，请等待完成');
 if(mode!=='keil'||!client||!['running','halted'].includes(status))throw Error('请先连接 Keil 并进入 Debug 模式');
 const epoch=connectionEpoch,context=sessionId;await refreshCatalog(true);if(epoch!==connectionEpoch||context!==sessionId||mode!=='keil'||!client)throw Error('连接已切换，请刷新后重试');const group=groupData(root),source=dataSource();
 let rows=group.rows;
 if(action==='restore'){
  const record=savedData[root];if(!record)throw Error('此组件尚未保存数据');
  if(record.source!==source)throw Error('保存数据来自其他工程，请切回原工程后恢复');
  rows=restoreRows(record,group.type,group.rows,group.item);
 }
 const job={id:randomUUID(),root,action,source,type:group.type,signature:group.signature,rows,sessionId,sessionKey,epoch:connectionEpoch,status:'running',phase:action==='save'?'reading':'checking',total:rows.length,completed:0,checked:0,attempted:0,captured:[],error:'',started:Date.now()};
 dataJob=job;setTimeout(()=>void runDataJob(job),0);
}
// Small batches share the existing Keil lock, leaving HTTP edits and polling responsive.
async function runDataJob(job){
 if(job!==dataJob||job.status!=='running'||shuttingDown)return;
 if(busy){setTimeout(()=>void runDataJob(job),25);return;}
 busy=true;let wrote=false,current='';
 try{
  assertDataJob(job);const target=client;await target.status();assertDataJob(job);
  const deadline=Date.now()+150;
  for(let i=0;i<4&&Date.now()<deadline;i++){
   assertDataJob(job);
   if(job.phase==='reading'||job.phase==='checking'){
    const row=job.rows[job.checked];if(!row)break;current=row.name;
    const actual=await target.read(row.name);assertDataJob(job);values.set(row.name,{...actual,...catalog?.describe(row.name),updated:Date.now()});
    const value=restorableValue(actual);if(job.action==='restore'&&!sameTargetType(row.targetType||row.type,actual.type))throw Error('Keil 中成员类型已改变，请重新保存');
    if(job.action==='save'){job.captured.push({name:row.name,type:row.type,targetType:actual.type,value});job.completed++;}
    job.checked++;
   }else{
    const row=job.rows[job.completed];if(!row)break;current=row.name;job.attempted++;
    const actual=await target.write(row.name,row.value);assertDataJob(job);values.set(row.name,{...actual,...catalog?.describe(row.name),updated:Date.now()});
    if(!matchesTarget(actual.value,row.value,actual.type))throw Error('恢复未确认：请求 '+row.value+'，实际回读 '+actual.value);
    rememberHistory(row.name,recordInput(historyFor(row.name),row.value,Number(actual.beforeValue)));job.completed++;wrote=true;
   }
  }
  if(job.action==='save'&&job.checked===job.total){
   assertDataJob(job);const previous=savedData[job.root],record=validateSavedRecord(job.root,{root:job.root,type:job.type,source:job.source,savedAt:Date.now(),values:job.captured});savedData[job.root]=record;
   try{await save();}catch(e){if(previous)savedData[job.root]=previous;else delete savedData[job.root];throw e;}
   if(job.status==='running'){job.status='done';job.finished=Date.now();}
  }else if(job.phase==='checking'&&job.checked===job.total){assertDataJob(job);job.phase='writing';}
  else if(job.phase==='writing'&&job.completed===job.total){await save();if(job.status==='running'){job.status='done';job.finished=Date.now();}}
  else if(wrote)await save();
 }catch(e){
  if(e.actual&&current&&job.sessionId===sessionId&&job.epoch===connectionEpoch)values.set(current,{...e.actual,...catalog?.describe(current),updated:Date.now()});
  if(job.status==='running'){job.status='error';job.finished=Date.now();job.error=(current?current+'：':'')+e.message+(job.action==='save'?'；本次未生成新记录，上次保存的数据仍保留':`；已确认恢复 ${job.completed} / ${job.total} 项，未完成的成员请检查实际值`);}
  if(wrote&&job.sessionKey===sessionKey){try{await save();}catch{job.error+='；输入历史保存失败';}}
 }finally{busy=false;if(job===dataJob&&job.status==='running')setTimeout(()=>void runDataJob(job),50);}
}
function debugInfo(){if(!debugJob)return null;const {id,port,project,status,phase,error,started,finished}=debugJob;return {id,port,project,status,phase,error,started,finished};}
function cancelDebugJob(message){if(debugJob?.status==='running'){const job=debugJob;job.status='cancelled';job.error=message;job.finished=Date.now();const error=Error(message);job.controller.abort(error);job.client?.close(error);}}
function assertDebugJob(job){if(job!==debugJob||job.status!=='running'||job.epoch!==connectionEpoch||mode!=='keil'||shuttingDown)throw Error('连接或所选窗口已改变，已停止后续调试指令');}
function startDebugJob(request){
 if(copyJob?.status==='running')throw Error('正在读取复制数据，请等待完成或取消');
 if(request.sessionId!==sessionId||request.sessionKey!==sessionKey)throw Error('调试窗口已切换，请刷新后重试');
 if(debugJob?.status==='running')return;
 if(dataJob?.status==='running')throw Error('正在保存或恢复参数，请等待完成');
 if(!Number.isInteger(request.port)||request.port<1||request.port>65535)throw Error('端口无效');
 pool.applyDiscovered(request.port);const selectionMode=request.selection==='auto'?'auto':String(request.port),info=chooseSession(pool.sessions,sessionInfo?.port,selectionMode);if(!info?.port)throw Error('请选择可连接的 Keil 窗口');
 mode='keil';selection=selectionMode;status='connecting';lastError='';values.clear();const epoch=++connectionEpoch;
 const job={id:randomUUID(),port:info.port,pid:info.pid,project:info.project||'',status:'running',phase:'queued',error:'',started:Date.now(),epoch,controller:new AbortController()};debugJob=job;void pool.scan();setTimeout(()=>void runDebugJob(job),0);
}
async function runDebugJob(job){
 if(job!==debugJob||job.status!=='running')return;if(busy){setTimeout(()=>void runDebugJob(job),25);return;}busy=true;
 try{
  assertDebugJob(job);pool.applyDiscovered(job.port);const info=pool.sessions.find(info=>info.port===job.port);if(!info||job.pid&&info.pid&&job.pid!==info.pid)throw Error('所选端口的 Keil 窗口已改变，请重新选择');
  job.phase='connecting';let target=pool.clients.get(job.port);if(!target||target.socket?.destroyed){target?.close();target=pool.create();pool.clients.set(job.port,target);job.client=target;await target.connect(job.port);}else job.client=target;
  assertDebugJob(job);await activateSession(info,job.epoch);assertDebugJob(job);job.project=info.project||'';
  const actual=await target.enterAndRun({signal:job.controller.signal,assertCurrent:()=>assertDebugJob(job),onPhase:phase=>{assertDebugJob(job);job.phase=phase;}});assertDebugJob(job);
  info.status=actual;info.error='';status=actual;lastError='';catalogChecked=0;job.status='done';job.phase=actual;job.finished=Date.now();
 }catch(e){if(job.status==='running'){job.status='error';job.error=e.message;job.finished=Date.now();status='error';lastError=e.message;if(job.client?.socket?.destroyed)client=null;}}
 finally{busy=false;}
}
async function activateSession(info,epoch=connectionEpoch){if(epoch!==connectionEpoch||mode!=='keil')return;if(!sessionInfo||sessionInfo.port!==info.port||sessionInfo.pid!==info.pid||sessionInfo.project!==info.project){cancelDataJob('调试窗口已切换');sessionId=randomUUID();values.clear();}const next=info.project?info.project.toLowerCase():'port:'+info.port;if(next!==sessionKey){if(sessionKey)profiles[sessionKey]=panelData();const same=projectPath&&info.project&&projectPath.replace(/\.uvoptx$/i,'.uvprojx').toLowerCase()===info.project.toLowerCase();if(profiles[next])applyPanel(profiles[next]);else if(!same)applyPanel();sessionKey=next;projectPath=info.project?info.project.replace(/\.uvprojx?$/i,'.uvoptx'):projectPath;await save();}if(epoch!==connectionEpoch||mode!=='keil')return;sessionInfo=info;client=pool.clients.get(info.port);keilPort=info.port;}
async function syncProject(){if(!projectPath)return;const xml=await readFile(projectPath,'utf8');if(xml===lastXml)return;lastXml=xml;for(const name of watchNames(xml))if(!excluded.has(name)&&!items.some(v=>v.name===name))items.push(validateItem({name}));await save();}
async function sample(name,epoch){try{const value=await readLive(name);if(epoch===connectionEpoch)values.set(name,{...value,updated:Date.now()});}catch(e){if(epoch!==connectionEpoch)return;values.set(name,{...values.get(name),error:e.message,editable:false});if(client?.socket?.destroyed){client=null;throw e;}}}
async function samplePanel(epoch){const active=items.filter(item=>activeRoots.includes(item.name));const selected=active.length&&++sampleRound%10!==0?active:items;const names=[...new Set(selected.flatMap(item=>planFor(item.name).group?rowsFor(item).map(v=>v.name):[item.name]))];for(let i=0;i<Math.min(8,names.length);i++){if(epoch!==connectionEpoch||mode!=='keil')break;sampleCursor%=names.length;await sample(names[sampleCursor++],epoch);if(interactionRequested)break;}}
async function poll(){if(shuttingDown)return;if(busy||updating||debugJob?.status==='running'){setTimeout(poll,interval);return;}busy=true;const epoch=connectionEpoch;try{
  pool.applyDiscovered(null);
  if(mode==='keil'){
    const sessions=await pool.refresh(keilPort);if(epoch!==connectionEpoch)return;if(selection==='auto'&&!pool.hasDiscovered){status='connecting';lastError='';return;}const selected=chooseSession(sessions,sessionInfo?.port,selection);
    if(!selected||!['running','halted'].includes(selected.status)){if(selected&&selected.status==='waiting')await activateSession(selected,epoch);if(epoch!==connectionEpoch)return;cancelDataJob('Keil 已退出 Debug 或连接不可用');status=selected?.status==='waiting'?'waiting':'error';values.clear();lastError=selected?.error||pool.error||'未找到可用的 Keil 会话，请检查所选窗口、UVSOCK 开关与端口。';return;}
    await activateSession(selected,epoch);if(epoch!==connectionEpoch)return;status=selected.status;
    try{await syncProject();}catch(e){catalogError='Watch 文件暂不可用：'+e.message;}
    if(epoch!==connectionEpoch)return;await refreshCatalog();if(epoch!==connectionEpoch)return;lastError='';await samplePanel(epoch);
  }
}catch(e){if(epoch===connectionEpoch){lastError=e.message;status='error';}}finally{busy=false;setTimeout(poll,interval);}}
let keilPort=4823;
function snapshot(){return {version,update:updater.snapshot(),preferences:prefs,sessionKey,sessionId,selection,session:sessionInfo,sessions:pool.sessions,sessionError:pool.error,discovering:pool.discovering,sessionScanMs:pool.scanMs,mode,status,lastError,defaults,layout,dataJob:jobInfo(),debugJob:debugInfo(),copyJob:copyJobInfo(),compatibility:client?.compatibility||'',catalogError,catalogBinary:catalog?.binary||'',interval,projectPath,busy,items:items.map(v=>{const plan=planFor(v.name),rows=rowsFor(v);return {...v,...values.get(v.name),...(plan.group?{...(catalog?.describe(v.name)||{}),value:'',editable:false,children:rows.map(row=>({...row,...values.get(row.name),...{min:v.min,max:v.max,step:v.step},...v.members?.[row.name],name:row.name,history:historyFor(row.name)})),totalMembers:plan.rows.length,missingMembers:v.visibleMembers?.filter(name=>!rows.some(row=>row.name===name))||[],truncated:plan.truncated}:{}),name:v.name,indices:arrayAxes(v.name,path=>catalog?.describe(path)),history:historyFor(v.name),savedData:savedInfo(v.name)};})};}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>1024*1024)throw Error('请求过大');}return JSON.parse(data||'{}');}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  try{
    // Same-origin only: this service can write target memory.
    const host=req.headers.host;const expected=`127.0.0.1:${server.address().port}`;
    if(host!==expected||req.headers.origin&&req.headers.origin!==`http://${expected}`||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    const path=new URL(req.url,`http://${expected}`).pathname;
    if(req.method==='GET'&&path==='/api/state'){if(req.headers['x-keil-ui-editing']==='1')lastUIBusyAt=Date.now();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot()));}
    if(req.method==='GET'&&path==='/api/array-copy/result'){
      const query=new URL(req.url,`http://${expected}`).searchParams;
      if(!copyJob||query.get('id')!==copyJob.id||query.get('sessionId')!==sessionId||query.get('sessionKey')!==sessionKey||!copyContext(copyJob)||copyJob.status!=='done')throw Error('复制结果尚未就绪或数组已切换，请重新复制');
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({text:copyJob.text,total:copyJob.copied,skipped:copyJob.skipped.length,skippedNames:copyJob.skipped.slice(0,3).map(row=>row.name),skippedMembers:copyJob.skipped.slice(0,50),name:copyJob.name}));
    }
    if(req.method==='POST'&&path.startsWith('/api/')){
      if(req.headers['x-keil-client']!=='1')throw Error('缺少客户端标识');
      const b=await body(req);
      if(path==='/api/shutdown'){
        if(b.token!==shutdownToken)throw Error('关闭凭证无效');
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));void shutdown();return;
      }
      // GitHub checks/downloads never own the Keil request lock.
      if(path==='/api/update/check'){void updater.check();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot()));}
      if(path==='/api/update/install'){updater.requestInstall();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot()));}
      if(path==='/api/update/settings'){await updater.setAutomatic(b.automatic);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot()));}
      if(updating){res.writeHead(503);return res.end(JSON.stringify({error:'正在安装更新并重启，请稍候'}));}
      // Interface preferences do not use Keil and must never wait for target I/O.
      if(path==='/api/preferences'){
        prefs=validatePreferences({...prefs,...b.preferences});await save();
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;
      }
      if(path==='/api/debug/run'){startDebugJob(b);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot()));}
      if(path==='/api/array-copy/cancel'){
        if(b.sessionId!==sessionId||b.sessionKey!==sessionKey||b.id!==copyJob?.id)throw Error('复制任务已改变');cancelArrayCopy('已取消读取');res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot()));
      }
      if(path==='/api/connect'&&debugJob?.status==='running'){cancelDebugJob('连接设置已改变');connectionEpoch++;}
      if(path==='/api/connect'&&b.mode==='disconnected'){
        cancelDataJob('连接已断开');connectionEpoch++;mode='disconnected';status='disconnected';lastError='';sessionId=randomUUID();
        pool.close();client=null;sessionInfo=null;values.clear();await save();
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;
      }
      if(busy){interactionRequested=true;res.writeHead(409);return res.end(JSON.stringify({error:'正在采样，请稍后重试'}));}busy=true;interactionRequested=false;
      try{
        if(['/api/array-copy','/api/index','/api/items','/api/layout','/api/priority','/api/project','/api/write','/api/toggle','/api/display','/api/selection','/api/group-members','/api/data/save','/api/data/restore'].includes(path)&&b.sessionId!==sessionId)throw Error('调试会话已切换，请等待界面刷新后重试');
        if(path==='/api/connect'){
          if(b.mode!=='keil')throw Error('仅支持连接 Keil 或断开连接');
          if(b.mode==='keil'&&(!Number.isInteger(b.port)||b.port<1||b.port>65535))throw Error('端口无效');
          cancelDataJob('连接设置已改变');const epoch=++connectionEpoch;if(sessionKey)profiles[sessionKey]=panelData();mode=b.mode;lastError='';keilPort=b.port||4823;selection=b.selection==='auto'||b.selection===undefined?'auto':String(b.port);
          if(mode==='keil'){
            pool.applyDiscovered(keilPort);const chosen=chooseSession(pool.sessions,sessionInfo?.port,selection);
            if(chosen){await activateSession(chosen,epoch);if(epoch===connectionEpoch)status=['running','halted','waiting'].includes(chosen.status)?chosen.status:'connecting';}
            else{client=null;sessionInfo=null;sessionId=randomUUID();values.clear();status='connecting';}
            if(epoch===connectionEpoch)void pool.scan();
          }else{pool.close();client=null;sessionInfo=null;sessionId=randomUUID();values.clear();status='connecting';}
          if(mode==='disconnected')status='disconnected';
        }else if(path==='/api/sessions'){if(mode==='keil')await pool.refresh(Number(b.port)||keilPort,true);else{void pool.scan(true);pool.applyDiscovered(null);}
        }else if(path==='/api/array-copy'){
          if(b.sessionKey!==sessionKey)throw Error('调试工程已切换，请刷新后重试');await startArrayCopy(b);
        }else if(path==='/api/data/save'||path==='/api/data/restore'){
          if(b.sessionKey!==sessionKey)throw Error('调试工程已切换，请刷新后重试');
          await startDataJob(path.endsWith('/save')?'save':'restore',b.root);
        }else if(path==='/api/index'){
          if(b.sessionKey!==sessionKey)throw Error('调试工程已切换，请刷新后重试');
          const item=items.find(item=>item.name===b.root);if(!item)throw Error('变量已被移除');if(dataJob?.status==='running'&&dataJob.root===b.root)throw Error('此组件正在保存或恢复数据，请等待完成');
          await refreshCatalog(true);const next=reindexItem(item,b.dimension,b.index,path=>catalog?.describe(path));
          if(items.some(other=>other!==item&&other.name===next.name))throw Error('该变量已在面板中，不能重复添加');
          if(next.name!==item.name){
            const nextLayout=b.layout?validateLayout(b.layout):structuredClone(layout);if(nextLayout.widgets[item.name]){nextLayout.widgets[next.name]={...nextLayout.widgets[item.name]};delete nextLayout.widgets[item.name];}layout=nextLayout;
            items=items.map(other=>other===item?next:other);excluded.add(item.name);excluded.delete(next.name);activeRoots=activeRoots.map(name=>name===item.name?next.name:name);sampleCursor=0;
            for(const name of values.keys())if(name===next.name||[next.name+'.',next.name+'[',next.name+'->'].some(prefix=>name.startsWith(prefix)))values.delete(name);
          }
        }else if(path==='/api/display'){
          if(typeof b.hex!=='boolean')throw Error('十六进制显示设置无效');
          const item=items.find(v=>v.name===b.root);
          if(!containsMember(item,b.name))throw Error('该变量不属于当前调参面板');
          const meta={...values.get(b.name),...catalog?.describe(b.name)};
          if(!isIntegerVariable(meta))throw Error('仅整型变量支持十六进制显示');
          const next=item.name===b.name?{...item,hex:b.hex}:{...item,members:{...item.members,[b.name]:{...item.members?.[b.name],hex:b.hex}}};
          items=items.map(v=>v===item?validateItem(next):v);
        }else if(path==='/api/selection'){
          if(b.members!==null&&!Array.isArray(b.members))throw Error('显示成员列表无效');
          const item=items.find(v=>v.name===b.root);if(!item||!planFor(item.name).group)throw Error('请选择数组或结构体组件');
          const next={...item};if(b.members===null)delete next.visibleMembers;else next.visibleMembers=b.members;
          const checked=validateItem(next),known=new Set(planFor(item.name).rows.map(row=>row.name));
          if(checked.visibleMembers?.some(name=>!known.has(name)))throw Error('成员列表已变化，请重新打开选择列表');
          items=items.map(v=>v===item?checked:v);sampleCursor=0;
        }else if(path==='/api/group-members'){
          if(!validName(b.name))throw Error('变量路径无效');await refreshCatalog();
          const plan=planFor(b.name);if(!plan.group)throw Error(catalogError||'请选择可展开的数组或结构体');
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),groupMembers:plan.rows.map(({name,type,pointer,array,aggregate})=>({name,type,pointer,array,aggregate})),truncated:plan.truncated}));return;
        }else if(path==='/api/layout'){
          layout=validateLayout(b.layout);
        }else if(path==='/api/priority'){
          if(!Array.isArray(b.names)||b.names.length>500)throw Error('可见变量列表无效');activeRoots=b.names.filter(name=>items.some(v=>v.name===name));sampleCursor=0;
        }else if(path==='/api/catalog'){
          await refreshCatalog(true);
          let variables=catalog?.variables||[];
          const known=new Set(variables.map(v=>v.name));for(const item of items)if(!known.has(item.name))variables.push({name:item.name,type:'Watch / 已配置'});
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),variables}));return;
        }else if(path==='/api/preview'){
          if(!validName(b.name))throw Error('变量路径无效');if(mode==='keil'&&!client)throw Error('Keil 尚未连接');
          const meta=mode==='keil'?catalog?.describe(b.name):null;
          const value=b.metadataOnly&&meta&&(meta.array||meta.aggregate)?{...meta,name:b.name,value:meta.array?'['+meta.count+' 项]':'{…}'}:await readLive(b.name);
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),selected:{...value,name:b.name}}));return;
        }else if(path==='/api/members'){
          if(!validName(b.name))throw Error('请输入完整变量路径');
          if(mode!=='keil'||!client)throw Error('请先连接 Keil');
          const offset=b.offset??0;if(!Number.isInteger(offset)||offset<0)throw Error('数组起始下标无效');
          if(mode==='keil'){
            await refreshCatalog();const indexed=catalog?.children(b.name,offset);
            if(indexed&&(indexed.members.length||catalog.describe(b.name)?.array)){
              for(const member of indexed.members){const cached=values.get(member.name);if(cached?.updated&&!member.expandable)member.value=cached.value;}
              res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),...indexed}));return;
            }
          }
          const parent=await client.read(b.name);let members=[],total=parent.count;
          if(parent.array){
            if(!Number.isInteger(total)||total<0)throw Error('数组大小不可用');
            members=Array.from({length:Math.max(0,Math.min(64,total-offset))},(_,i)=>({name:`${b.name}[${offset+i}]`,type:'数组元素',expandable:true}));
          }else{
            if(!client)throw Error('Keil 尚未连接');
            const result=await client.members(b.name);
            members=result.map(v=>({...v,name:memberPath(b.name,{...v,parentPointer:parent.pointer}),expandable:!!(v.count||v.aggregate||v.array||v.pointer)}));
          }
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),members,total,offset,nextOffset:parent.array&&offset+members.length<total?offset+members.length:null}));return;
        }else if(path==='/api/items'){
          const next=b.items;if(!Array.isArray(next)||next.length>500)throw Error('最多 500 个变量');
          const checked=next.map(validateItem);if(new Set(checked.map(v=>v.name)).size!==checked.length)throw Error('变量名重复');
          if(b.rename){const {from,to}=b.rename;if(!validName(from)||!validName(to)||from===to||!items.some(v=>v.name===from)||checked.some(v=>v.name===from)||!checked.some(v=>v.name===to)||items.some(v=>v.name===to))throw Error('替换变量请求无效');}
          const remembered=b.remember?validateItem({name:'defaults',...b.remember}):null;
          if(b.rename){const {from,to}=b.rename;if(b.rename.layout)layout=validateLayout(b.rename.layout);if(layout.widgets[from]){layout.widgets[to]={...layout.widgets[from]};delete layout.widgets[from];}activeRoots=activeRoots.map(name=>name===from?to:name);}
          if(remembered)defaults={min:remembered.min,max:remembered.max,step:remembered.step,pinned:remembered.pinned};
          for(const old of items)if(!checked.some(v=>v.name===old.name))excluded.add(old.name);for(const item of checked)excluded.delete(item.name);items=checked;
        }
        else if(path==='/api/project'){if(typeof b.path!=='string'||!b.path.toLowerCase().endsWith('.uvoptx'))throw Error('请选择 .uvoptx 文件');await readFile(b.path,'utf8');projectPath=b.path;lastXml='';catalog=null;await syncProject();await refreshCatalog(true);}
        else if(path==='/api/write'||path==='/api/toggle'){
          if(b.sessionKey!==sessionKey||b.sessionId!==sessionId)throw Error('调试会话已切换，请等待界面刷新后重试');
          if(copyJob?.status==='running'&&copyJob.rows.some(row=>row.name===b.name))throw Error('此成员正在读取复制数据，请等待完成或取消');
          if(dataJob?.status==='running'&&dataJob.rows.some(row=>row.name===b.name))throw Error('此成员正在保存或恢复，请等待完成后再修改');
          const rootItem=items.find(v=>v.name===(b.root||b.name));if(!containsMember(rootItem,b.name))throw Error('该变量不属于当前调参面板');const item={...rootItem,...rootItem.members?.[b.name]},v=values.get(b.name);if(!v?.editable||!v.updated)throw Error('变量未就绪或不可写');
          const toggled=path==='/api/toggle'?toggleTarget(historyFor(b.name)):null,requested=toggled?toggled.value:b.value;
          validateWrite(item,requested,v.type);let before=Number(v.value);
          if(mode==='keil'&&client){const target=client;try{await target.status();if(b.sessionId!==sessionId)throw Error('连接已断开');const result=await target.write(b.name,requested);if(b.sessionId!==sessionId)throw Error('连接已断开');before=Number(result.beforeValue);values.set(b.name,{...result,updated:Date.now()});}catch(e){if(b.sessionId!==sessionId)throw Error('连接已断开，已取消旧会话操作');throw e;}}
          else throw Error('没有可写的调试会话');
          rememberHistory(b.name,toggled?toggled.history:recordInput(historyFor(b.name),requested,before));
        }else if(path==='/api/interval'){if(!Number.isInteger(b.interval)||b.interval<100||b.interval>10000)throw Error('刷新间隔须为 100–10000 ms');interval=b.interval;}
        else throw Error('未知操作');
        if(!['/api/array-copy','/api/priority','/api/sessions','/api/data/save','/api/data/restore'].includes(path))await save();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));
      }finally{busy=false;}return;
    }
    const files={'/':'index.html','/app.js':'app.js','/controls.js':'controls.js','/format.js':'format.js','/saved-data.js':'saved-data.js','/array-copy.js':'array-copy.js','/updates.js':'updates.js','/indices.js':'indices.js','/debug-view.js':'debug-view.js','/layout.js':'layout.js','/editor.js':'editor.js','/search.js':'search.js','/style.css':'style.css','/keil.ico':'keil.ico','/preferences.js':'preferences.js','/session-picker.js':'session-picker.js','/member-picker.js':'member-picker.js','/notices.js':'notices.js'};if(req.method!=='GET'||!files[path]){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',path.endsWith('.ico')?'image/x-icon':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('public/'+files[path],root)));
  }catch(e){if(e.variableName&&e.actual)values.set(e.variableName,{...e.actual,updated:Date.now()});res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
async function shutdown(){if(shuttingDown)return;cancelDebugJob('工具已关闭');cancelDataJob('工具已关闭');shuttingDown=true;updater.close();pool.close();server.close();try{const saved=JSON.parse(await readFile(runtime,'utf8'));if(saved.token===shutdownToken)await unlink(runtime);}catch{}console.log('Keil Debug Assistant stopped.');}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
const updater=new Updater({version,userDir:fileURLToPath(userRoot),dataDir:fileURLToPath(dataRoot),blockedReason:()=>mode!=='disconnected'?'手动断开 Keil 后安装，调试继续运行。':Date.now()-lastUIBusyAt<2000?'完成面板编辑后安装。':'当前操作完成后安装。',canInstall:()=>Date.now()-lastUIBusyAt>=2000&&mode==='disconnected'&&!busy&&!updating&&!shuttingDown&&dataJob?.status!=='running',install:async(staged,info)=>{
 if(Date.now()-lastUIBusyAt<2000||mode!=='disconnected'||busy||shuttingDown||updating||dataJob?.status==='running')return false;
 updating=true;busy=true;let installer;
 try{await save();installer=await startInstaller({root:fileURLToPath(home),jobDir:staged.jobDir,userDir:fileURLToPath(userRoot),dataDir:fileURLToPath(dataRoot),pid:process.pid,port:server.address().port,version:info.version,previous:version});await installer.apply();setTimeout(()=>void shutdown(),800);return true;}
 catch(e){installer?.cancel();updating=false;busy=false;throw e;}
}});
await updater.init();
export {server};
server.listen(Number(process.env.PORT||3210),'127.0.0.1',async()=>{await writeFile(runtime,JSON.stringify({port:server.address().port,token:shutdownToken,pid:process.pid}));console.log(`Keil Debug Assistant: http://127.0.0.1:${server.address().port}`);void pool.scan();poll();if(process.env.KDA_UPDATE_DISABLED!=='1')updater.start();});
