import http from 'node:http';
import {readFile,writeFile,rename,unlink,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {SessionPool,chooseSession} from './lib/sessions.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {preferences as validatePreferences} from './lib/preferences.mjs';
import {loadCatalog} from './lib/catalog.mjs';
import {flattenGroup,selectedRows} from './lib/groups.mjs';
import {validateLayout} from './lib/layout.mjs';
import {validHistory,recordInput,toggleTarget} from './lib/history.mjs';
import {isIntegerVariable} from './public/format.js';
import {validateItem,validateWrite,watchNames,validName,memberPath} from './lib/model.mjs';
const root=new URL('./',import.meta.url),home=new URL('../',root),userRoot=process.env.KDA_USER_DIR?pathToFileURL(resolve(process.env.KDA_USER_DIR)+'/'):new URL('userdata/',home),dataRoot=process.env.KDA_DATA_DIR?pathToFileURL(resolve(process.env.KDA_DATA_DIR)+'/'):new URL('data/',home),config=new URL('panel.json',userRoot);
await mkdir(userRoot,{recursive:true});await mkdir(dataRoot,{recursive:true});
const pool=new SessionPool();let selection='auto',sessionInfo=null,sessionKey='',sessionId='',profiles={},prefs=validatePreferences({});
let items=[],mode='disconnected',client=null,status='disconnected',lastError='',interval=500,projectPath='',lastXml='',values=new Map(),busy=false;
let shuttingDown=false,connectionEpoch=0;const runtime=new URL('runtime.json',dataRoot),shutdownToken=randomUUID();
let catalog=null,catalogError='',catalogChecked=0;
let interactionRequested=false;
let defaults={min:0,max:100,step:1,pinned:true},excluded=new Set(),groupPlans=new Map(),sampleCursor=0;
let activeRoots=[],sampleRound=0;
let layout={mode:'grid',widgets:{}};
let writeHistory={};
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
try{let raw;try{raw=await readFile(config,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;raw=await readFile(new URL('panel.json',home),'utf8');}const c=JSON.parse(raw);profiles=c.profiles||{};prefs=validatePreferences(c.preferences||{});items=c.items.map(validateItem);projectPath=c.projectPath||'';sessionKey=c.sessionKey||(projectPath?projectPath.replace(/\.uvoptx$/i,'.uvprojx').toLowerCase():'');if(c.defaults||items.length){const d=validateItem({name:'defaults',...(c.defaults||items.at(-1))});defaults={min:d.min,max:d.max,step:d.step,pinned:d.pinned};}excluded=new Set(c.excluded||[]);if(c.layout)layout=validateLayout(c.layout);if(c.writeHistory&&typeof c.writeHistory==='object'&&!Array.isArray(c.writeHistory))writeHistory=c.writeHistory;}catch{}
function panelData(){return {items,projectPath,defaults,layout,writeHistory,excluded:[...excluded]};}
function applyPanel(c={}){items=(c.items||[]).map(validateItem);projectPath=c.projectPath||'';defaults=c.defaults||{min:0,max:100,step:1,pinned:true};layout=c.layout?validateLayout(c.layout):{mode:'grid',widgets:{}};writeHistory=c.writeHistory||{};excluded=new Set(c.excluded||[]);values.clear();groupPlans.clear();catalog=null;catalogError='';catalogChecked=0;lastXml='';activeRoots=[];sampleCursor=0;}
let saveQueue=Promise.resolve();
function save(){
 if(sessionKey)profiles[sessionKey]=panelData();
 const data=JSON.stringify({...panelData(),sessionKey,profiles,preferences:prefs},null,2),tmp=new URL('panel.json.tmp',userRoot);
 const result=saveQueue.catch(()=>{}).then(async()=>{await writeFile(tmp,data);await rename(tmp,config);});saveQueue=result;return result;
}
async function activateSession(info,epoch=connectionEpoch){if(epoch!==connectionEpoch||mode!=='keil')return;if(!sessionInfo||sessionInfo.port!==info.port||sessionInfo.pid!==info.pid||sessionInfo.project!==info.project){sessionId=randomUUID();values.clear();}const next=info.project?info.project.toLowerCase():'port:'+info.port;if(next!==sessionKey){if(sessionKey)profiles[sessionKey]=panelData();const same=projectPath&&info.project&&projectPath.replace(/\.uvoptx$/i,'.uvprojx').toLowerCase()===info.project.toLowerCase();if(profiles[next])applyPanel(profiles[next]);else if(!same)applyPanel();sessionKey=next;projectPath=info.project?info.project.replace(/\.uvprojx?$/i,'.uvoptx'):projectPath;await save();}if(epoch!==connectionEpoch||mode!=='keil')return;sessionInfo=info;client=pool.clients.get(info.port);keilPort=info.port;}
async function syncProject(){if(!projectPath)return;const xml=await readFile(projectPath,'utf8');if(xml===lastXml)return;lastXml=xml;for(const name of watchNames(xml))if(!excluded.has(name)&&!items.some(v=>v.name===name))items.push(validateItem({name}));await save();}
async function sample(name,epoch){try{const value=await readLive(name);if(epoch===connectionEpoch)values.set(name,{...value,updated:Date.now()});}catch(e){if(epoch!==connectionEpoch)return;values.set(name,{...values.get(name),error:e.message,editable:false});if(client?.socket?.destroyed){client=null;throw e;}}}
async function samplePanel(epoch){const active=items.filter(item=>activeRoots.includes(item.name));const selected=active.length&&++sampleRound%10!==0?active:items;const names=[...new Set(selected.flatMap(item=>planFor(item.name).group?rowsFor(item).map(v=>v.name):[item.name]))];for(let i=0;i<Math.min(8,names.length);i++){if(epoch!==connectionEpoch||mode!=='keil')break;sampleCursor%=names.length;await sample(names[sampleCursor++],epoch);if(interactionRequested)break;}}
async function poll(){if(shuttingDown)return;if(busy){setTimeout(poll,interval);return;}busy=true;const epoch=connectionEpoch;try{
  pool.applyDiscovered(null);
  if(mode==='keil'){
    const sessions=await pool.refresh(keilPort);if(epoch!==connectionEpoch)return;if(selection==='auto'&&!pool.hasDiscovered){status='connecting';lastError='';return;}const selected=chooseSession(sessions,sessionInfo?.port,selection);
    if(!selected||!['running','halted'].includes(selected.status)){if(selected&&selected.status==='waiting')await activateSession(selected,epoch);if(epoch!==connectionEpoch)return;status=selected?.status==='waiting'?'waiting':'error';values.clear();lastError=selected?.error||pool.error||'未找到可用的 Keil 会话，请检查所选窗口、UVSOCK 开关与端口。';return;}
    await activateSession(selected,epoch);if(epoch!==connectionEpoch)return;status=selected.status;
    try{await syncProject();}catch(e){catalogError='Watch 文件暂不可用：'+e.message;}
    if(epoch!==connectionEpoch)return;await refreshCatalog();if(epoch!==connectionEpoch)return;lastError='';await samplePanel(epoch);
  }
}catch(e){if(epoch===connectionEpoch){lastError=e.message;status='error';}}finally{busy=false;setTimeout(poll,interval);}}
let keilPort=4823;
function snapshot(){return {version:'2.0.7',preferences:prefs,sessionKey,sessionId,selection,session:sessionInfo,sessions:pool.sessions,sessionError:pool.error,discovering:pool.discovering,sessionScanMs:pool.scanMs,mode,status,lastError,defaults,layout,compatibility:client?.compatibility||'',catalogError,catalogBinary:catalog?.binary||'',interval,projectPath,busy,items:items.map(v=>{const plan=planFor(v.name),rows=rowsFor(v);return {...v,...values.get(v.name),...(plan.group?{...(catalog?.describe(v.name)||{}),value:'',editable:false,children:rows.map(row=>({...row,...values.get(row.name),...{min:v.min,max:v.max,step:v.step},...v.members?.[row.name],name:row.name,history:historyFor(row.name)})),totalMembers:plan.rows.length,missingMembers:v.visibleMembers?.filter(name=>!rows.some(row=>row.name===name))||[],truncated:plan.truncated}:{}),name:v.name,history:historyFor(v.name)};})};}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>1024*1024)throw Error('请求过大');}return JSON.parse(data||'{}');}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  try{
    // Same-origin only: this service can write target memory.
    const host=req.headers.host;const expected=`127.0.0.1:${server.address().port}`;
    if(host!==expected||req.headers.origin&&req.headers.origin!==`http://${expected}`||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    const path=new URL(req.url,`http://${expected}`).pathname;
    if(req.method==='GET'&&path==='/api/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot()));}
    if(req.method==='POST'&&path.startsWith('/api/')){
      if(req.headers['x-keil-client']!=='1')throw Error('缺少客户端标识');
      const b=await body(req);
      if(path==='/api/shutdown'){
        if(b.token!==shutdownToken)throw Error('关闭凭证无效');
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));void shutdown();return;
      }
      // Interface preferences do not use Keil and must never wait for target I/O.
      if(path==='/api/preferences'){
        prefs=validatePreferences({...prefs,...b.preferences});await save();
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;
      }
      if(path==='/api/connect'&&b.mode==='disconnected'){
        connectionEpoch++;mode='disconnected';status='disconnected';lastError='';sessionId=randomUUID();
        pool.close();client=null;sessionInfo=null;values.clear();await save();
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;
      }
      if(busy){interactionRequested=true;res.writeHead(409);return res.end(JSON.stringify({error:'正在采样，请稍后重试'}));}busy=true;interactionRequested=false;
      try{
        if(['/api/items','/api/layout','/api/priority','/api/project','/api/write','/api/toggle','/api/display','/api/selection','/api/group-members'].includes(path)&&b.sessionId!==sessionId)throw Error('调试会话已切换，请等待界面刷新后重试');
        if(path==='/api/connect'){
          if(b.mode!=='keil')throw Error('仅支持连接 Keil 或断开连接');
          if(b.mode==='keil'&&(!Number.isInteger(b.port)||b.port<1||b.port>65535))throw Error('端口无效');
          const epoch=++connectionEpoch;if(sessionKey)profiles[sessionKey]=panelData();mode=b.mode;lastError='';keilPort=b.port||4823;selection=b.selection==='auto'||b.selection===undefined?'auto':String(b.port);
          if(mode==='keil'){
            pool.applyDiscovered(keilPort);const chosen=chooseSession(pool.sessions,sessionInfo?.port,selection);
            if(chosen){await activateSession(chosen,epoch);if(epoch===connectionEpoch)status=['running','halted','waiting'].includes(chosen.status)?chosen.status:'connecting';}
            else{client=null;sessionInfo=null;sessionId=randomUUID();values.clear();status='connecting';}
            if(epoch===connectionEpoch)void pool.scan();
          }else{pool.close();client=null;sessionInfo=null;sessionId=randomUUID();values.clear();status='connecting';}
          if(mode==='disconnected')status='disconnected';
        }else if(path==='/api/sessions'){if(mode==='keil')await pool.refresh(Number(b.port)||keilPort,true);else{void pool.scan(true);pool.applyDiscovered(null);}
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
          const rootItem=items.find(v=>v.name===(b.root||b.name));if(!containsMember(rootItem,b.name))throw Error('该变量不属于当前调参面板');const item={...rootItem,...rootItem.members?.[b.name]},v=values.get(b.name);if(!v?.editable||!v.updated)throw Error('变量未就绪或不可写');
          const toggled=path==='/api/toggle'?toggleTarget(historyFor(b.name)):null,requested=toggled?toggled.value:b.value;
          validateWrite(item,requested,v.type);let before=Number(v.value);
          if(mode==='keil'&&client){const target=client;try{await target.status();if(b.sessionId!==sessionId)throw Error('连接已断开');const result=await target.write(b.name,requested);if(b.sessionId!==sessionId)throw Error('连接已断开');before=Number(result.beforeValue);values.set(b.name,{...result,updated:Date.now()});}catch(e){if(b.sessionId!==sessionId)throw Error('连接已断开，已取消旧会话操作');throw e;}}
          else throw Error('没有可写的调试会话');
          rememberHistory(b.name,toggled?toggled.history:recordInput(historyFor(b.name),requested,before));
        }else if(path==='/api/interval'){if(!Number.isInteger(b.interval)||b.interval<100||b.interval>10000)throw Error('刷新间隔须为 100–10000 ms');interval=b.interval;}
        else throw Error('未知操作');
        if(!['/api/priority','/api/sessions'].includes(path))await save();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));
      }finally{busy=false;}return;
    }
    const files={'/':'index.html','/app.js':'app.js','/controls.js':'controls.js','/format.js':'format.js','/layout.js':'layout.js','/editor.js':'editor.js','/search.js':'search.js','/style.css':'style.css','/keil.ico':'keil.ico','/preferences.js':'preferences.js','/session-picker.js':'session-picker.js','/member-picker.js':'member-picker.js','/notices.js':'notices.js'};if(req.method!=='GET'||!files[path]){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',path.endsWith('.ico')?'image/x-icon':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('public/'+files[path],root)));
  }catch(e){if(e.variableName&&e.actual)values.set(e.variableName,{...e.actual,updated:Date.now()});res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
async function shutdown(){if(shuttingDown)return;shuttingDown=true;pool.close();server.close();try{const saved=JSON.parse(await readFile(runtime,'utf8'));if(saved.token===shutdownToken)await unlink(runtime);}catch{}console.log('Keil Debug Assistant stopped.');}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
export {server};
server.listen(Number(process.env.PORT||3210),'127.0.0.1',async()=>{await writeFile(runtime,JSON.stringify({port:server.address().port,token:shutdownToken,pid:process.pid}));console.log(`Keil Debug Assistant: http://127.0.0.1:${server.address().port}`);void pool.scan();poll();});
