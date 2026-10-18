import http from 'node:http';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {UVSock} from './lib/uvsock.mjs';
import {loadCatalog} from './lib/catalog.mjs';
import {flattenGroup} from './lib/groups.mjs';
import {validateLayout} from './lib/layout.mjs';
import {validHistory,recordInput,toggleTarget} from './lib/history.mjs';
import {validateItem,validateWrite,watchNames,validName,memberPath} from './lib/model.mjs';
const root=new URL('./',import.meta.url),config=new URL('panel.json',root);
let items=[],mode='disconnected',client=null,status='disconnected',lastError='',interval=500,projectPath='',lastXml='',values=new Map(),busy=false;
let shuttingDown=false;const runtime=new URL('.keil-runtime.json',root),shutdownToken=randomUUID();
let catalog=null,catalogError='',catalogChecked=0;
let interactionRequested=false;
let defaults={min:0,max:100,step:1,pinned:true},excluded=new Set(),groupPlans=new Map(),sampleCursor=0;
let activeRoots=[],sampleRound=0;
let layout={mode:'grid',widgets:{}};
let writeHistory={};
function historyScope(){return mode==='demo'?'demo':projectPath||'keil';}
function historyFor(name){const history=writeHistory[historyScope()]?.[name];return validHistory(history)?history:null;}
function rememberHistory(name,history){if(!validHistory(history))return;const scope=historyScope();if(!Object.hasOwn(writeHistory,scope))writeHistory[scope]={};Object.defineProperty(writeHistory[scope],name,{value:history,writable:true,enumerable:true,configurable:true});}
function demoChildren(name){const value=demoRead(name);if(value.array)return Array.from({length:value.count},(_,i)=>({name:`${name}[${i}]`}));const keys={motor:['target_rpm','actual_rpm','enabled'],pid:['kp','ki'],board:['temperature']};return (keys[name]||(/^controllers\[[0-3]\]$/.test(name)?['gain','enabled']:[])).map(key=>({name:name+'.'+key}));}
function planFor(name){const key=(mode==='demo'?'demo':catalog?.key||'')+':'+name;if(groupPlans.has(key))return groupPlans.get(key);const describe=mode==='demo'?path=>{try{return demoRead(path);}catch{return null;}}:path=>catalog?.describe(path);const children=mode==='demo'?demoChildren:path=>{const all=[];let offset=0;do{const page=catalog?.children(path,offset);if(!page)break;all.push(...page.members);offset=page.nextOffset;}while(offset!==null&&all.length<513);return all;};const result=flattenGroup(name,describe,children);groupPlans.set(key,result);return result;}
async function refreshCatalog(force=false){if(!projectPath)return;if(!force&&Date.now()-catalogChecked<5000)return;catalogChecked=Date.now();try{catalog=await loadCatalog(projectPath);catalogError='';}catch(e){catalog=null;catalogError=e.message;}}
async function readLive(name){
 const meta=catalog?.describe(name);
 if(meta?.array){const children=catalog.children(name)?.members||[],preview=[];for(const child of children.slice(0,8)){if(interactionRequested&&preview.length)break;if(child.array||child.aggregate||child.pointer){preview.push('{…}');continue;}try{const value=(await client.read(child.name)).value;preview.push(Number.isFinite(Number(value))?String(Number(Number(value).toPrecision(7))):value);}catch(e){preview.push('不可读');}}return {...meta,name,value:'['+preview.join(', ')+(meta.count>preview.length?', …':'')+']',editable:false,preview};}
 const value=await client.read(name);if(meta?.aggregate)return {...value,...meta,value:'{…}',editable:false};
 return meta?{...value,...meta,editable:value.editable&&!meta.pointer}:value;
}
try{const c=JSON.parse(await readFile(config,'utf8'));items=c.items.map(validateItem);projectPath=c.projectPath||'';if(c.defaults||items.length){const d=validateItem({name:'defaults',...(c.defaults||items.at(-1))});defaults={min:d.min,max:d.max,step:d.step,pinned:d.pinned};}excluded=new Set(c.excluded||[]);if(c.layout)layout=validateLayout(c.layout);if(c.writeHistory&&typeof c.writeHistory==='object'&&!Array.isArray(c.writeHistory))writeHistory=c.writeHistory;}catch{}
async function save(){await writeFile(new URL('panel.json.tmp',root),JSON.stringify({items,projectPath,defaults,layout,writeHistory,excluded:[...excluded]},null,2));await rename(new URL('panel.json.tmp',root),config);}
const demo={ 'motor.target_rpm':1200,'motor.actual_rpm':1187,'pid.kp':1.2,'pid.ki':0.08,'motor.enabled':1,'board.temperature':36.5};
function demoRead(name){
  const groups={motor:['target_rpm','actual_rpm','enabled'],pid:['kp','ki'],board:['temperature']};
  if(groups[name])return {name,value:'{…}',type:'class '+name,count:groups[name].length,aggregate:true,array:false,pointer:false,editable:false};
  if(name==='samples'||name==='controllers')return {name,value:'[…] ',type:name==='samples'?'float[128]':'Controller[4]',count:name==='samples'?128:4,array:true,aggregate:false,editable:false};
  if(/^controllers\[[0-3]\]$/.test(name))return {name,value:'{…}',type:'class Controller',count:2,aggregate:true,array:false,editable:false};
  const known=Object.hasOwn(demo,name)||/^samples\[\d+\]$/.test(name)||/^controllers\[[0-3]\]\.(gain|enabled)$/.test(name);
  if(!known)throw Error('演示模式没有该变量，可使用 samples[0] 或 controllers[0].gain');
  let value=demo[name]??(name.endsWith('.enabled')?1:0.5);if(name==='motor.actual_rpm')value=(demo['motor.target_rpm']||0)+Math.round(Math.sin(Date.now()/700)*18);
  return {name,value:String(value),type:name.includes('pid')||name.includes('temperature')||name.includes('samples')||name.endsWith('.gain')?'float':'int',count:0,aggregate:false,array:false,editable:true};
}
async function syncProject(){if(!projectPath)return;const xml=await readFile(projectPath,'utf8');if(xml===lastXml)return;lastXml=xml;for(const name of watchNames(xml))if(!excluded.has(name)&&!items.some(v=>v.name===name))items.push(validateItem({name}));await save();}
async function sample(name){try{const value=mode==='demo'?demoRead(name):await readLive(name);values.set(name,{...value,updated:Date.now()});}catch(e){values.set(name,{error:e.message,editable:false});if(mode==='keil'&&client?.socket?.destroyed){client=null;throw e;}}}
async function samplePanel(){const active=items.filter(item=>activeRoots.includes(item.name));const selected=active.length&&++sampleRound%10!==0?active:items;const names=[...new Set(selected.flatMap(item=>{const plan=planFor(item.name);return plan.rows.length?plan.rows.map(v=>v.name):[item.name];}))];if(!names.length)return;const budget=mode==='demo'?names.length:8;for(let i=0;i<Math.min(budget,names.length);i++){sampleCursor%=names.length;await sample(names[sampleCursor++]);if(interactionRequested)break;}}
async function poll(){if(shuttingDown)return;if(busy){setTimeout(poll,interval);return;}busy=true;try{
  await syncProject();
  if(mode==='demo'){status='demo';await samplePanel();lastError='';}
  else if(mode==='keil'){
    await refreshCatalog();
    if(!client) {client=new UVSock();try{await client.connect(keilPort);}catch(e){client.close();client=null;throw e;}}
    try{status=await client.status();}catch(e){status='waiting';values.clear();if(client.socket?.destroyed){client=null;throw e;}if(client.legacy&&Date.now()-(client.lastOptionsRetry||0)>2000){client.lastOptionsRetry=Date.now();await client.enableExtended();}lastError='等待进入 Debug 模式：'+e.message;return;}
    lastError='';await samplePanel();
  }
}catch(e){lastError=e.message;status='error';}finally{busy=false;setTimeout(poll,interval);}}
let keilPort=4823;
function snapshot(){return {mode,status,lastError,defaults,layout,compatibility:client?.compatibility||'',catalogError,catalogBinary:catalog?.binary||'',interval,projectPath,busy,items:items.map(v=>{const plan=planFor(v.name);return {...v,...values.get(v.name),...(plan.rows.length?{...((mode==='demo'?demoRead(v.name):catalog?.describe(v.name))||{}),value:'',editable:false,children:plan.rows.map(row=>({...row,...values.get(row.name),...{min:v.min,max:v.max,step:v.step},...v.members?.[row.name],name:row.name,history:historyFor(row.name)})),truncated:plan.truncated}:{}),name:v.name,history:historyFor(v.name)};})};}
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
      if(busy){interactionRequested=true;res.writeHead(409);return res.end(JSON.stringify({error:'正在采样，请稍后重试'}));}busy=true;interactionRequested=false;
      try{
        if(path==='/api/connect'){
          if(!['demo','keil','disconnected'].includes(b.mode))throw Error('无效模式');
          if(b.mode==='keil'&&(!Number.isInteger(b.port)||b.port<1||b.port>65535))throw Error('端口无效');
          client?.close();client=null;values.clear();mode=b.mode;status='connecting';lastError='';keilPort=b.port||4823;
          if(mode==='demo'&&!items.length)items=Object.keys(demo).map(name=>validateItem({name,min:0,max:name.includes('rpm')?5000:name.includes('enabled')?1:100,step:name.includes('pid')?0.01:1,pinned:name!=='motor.actual_rpm'}));
          if(mode==='disconnected')status='disconnected';
        }else if(path==='/api/layout'){
          layout=validateLayout(b.layout);
        }else if(path==='/api/priority'){
          if(!Array.isArray(b.names)||b.names.length>500)throw Error('可见变量列表无效');activeRoots=b.names.filter(name=>items.some(v=>v.name===name));sampleCursor=0;
        }else if(path==='/api/catalog'){
          await refreshCatalog(true);
          let variables=mode==='demo'?['motor','pid','board','samples','controllers',...Object.keys(demo)].map(name=>({name,...demoRead(name)})):catalog?.variables||[];
          const known=new Set(variables.map(v=>v.name));for(const item of items)if(!known.has(item.name))variables.push({name:item.name,type:'Watch / 已配置'});
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),variables}));return;
        }else if(path==='/api/preview'){
          if(!validName(b.name))throw Error('变量路径无效');if(mode==='keil'&&!client)throw Error('Keil 尚未连接');
          const value=mode==='demo'?demoRead(b.name):await readLive(b.name);
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),selected:{...value,name:b.name}}));return;
        }else if(path==='/api/members'){
          if(!validName(b.name))throw Error('请输入完整变量路径');
          if(!['demo','keil'].includes(mode))throw Error('请先连接演示或 Keil');
          const offset=b.offset??0;if(!Number.isInteger(offset)||offset<0)throw Error('数组起始下标无效');
          if(mode==='keil'){
            await refreshCatalog();const indexed=catalog?.children(b.name,offset);
            if(indexed&&(indexed.members.length||catalog.describe(b.name)?.array)){
              for(const member of indexed.members){const cached=values.get(member.name);if(cached?.updated&&!member.expandable)member.value=cached.value;}
              res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),...indexed}));return;
            }
          }
          const parent=mode==='demo'?demoRead(b.name):await client.read(b.name);let members=[],total=parent.count;
          if(parent.array){
            if(!Number.isInteger(total)||total<0)throw Error('数组大小不可用');
            members=Array.from({length:Math.max(0,Math.min(64,total-offset))},(_,i)=>({name:`${b.name}[${offset+i}]`,type:'数组元素',expandable:true}));
          }else if(mode==='demo'){
            const names={motor:['target_rpm','actual_rpm','enabled'],pid:['kp','ki'],board:['temperature']};
            const keys=names[b.name]||(/^controllers\[[0-3]\]$/.test(b.name)?['gain','enabled']:[]);
            members=keys.map(key=>{const name=b.name+'.'+key;return {...demoRead(name),name,expandable:false};});
          }else{
            if(!client)throw Error('Keil 尚未连接');
            const result=await client.members(b.name);
            members=result.map(v=>({...v,name:memberPath(b.name,{...v,parentPointer:parent.pointer}),expandable:!!(v.count||v.aggregate||v.array||v.pointer)}));
          }
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),members,total,offset,nextOffset:parent.array&&offset+members.length<total?offset+members.length:null}));return;
        }else if(path==='/api/items'){const next=b.items;if(!Array.isArray(next)||next.length>500)throw Error('最多 500 个变量');const checked=next.map(validateItem);if(new Set(checked.map(v=>v.name)).size!==checked.length)throw Error('变量名重复');if(b.remember){const d=validateItem({name:'defaults',...b.remember});defaults={min:d.min,max:d.max,step:d.step,pinned:d.pinned};}for(const old of items)if(!checked.some(v=>v.name===old.name))excluded.add(old.name);for(const item of checked)excluded.delete(item.name);items=checked;}
        else if(path==='/api/project'){if(typeof b.path!=='string'||!b.path.toLowerCase().endsWith('.uvoptx'))throw Error('请选择 .uvoptx 文件');await readFile(b.path,'utf8');projectPath=b.path;lastXml='';catalog=null;await syncProject();await refreshCatalog(true);}
        else if(path==='/api/write'||path==='/api/toggle'){
          const rootItem=items.find(v=>v.name===(b.root||b.name));const allowed=rootItem&&(rootItem.name===b.name||planFor(rootItem.name).rows.some(row=>row.name===b.name));if(!allowed)throw Error('该变量不属于当前调参面板');const item={...rootItem,...rootItem.members?.[b.name]},v=values.get(b.name);if(!v?.editable||!v.updated)throw Error('变量未就绪或不可写');
          const toggled=path==='/api/toggle'?toggleTarget(historyFor(b.name)):null,requested=toggled?toggled.value:b.value;
          validateWrite(item,requested,v.type);let before=Number(v.value);
          if(mode==='demo'){before=Number(demoRead(b.name).value);demo[b.name]=requested;values.set(b.name,{...v,value:String(requested),updated:Date.now()});}
          else if(mode==='keil'&&client){await client.status();const result=await client.write(b.name,requested);before=Number(result.beforeValue);values.set(b.name,{...result,updated:Date.now()});}
          else throw Error('没有可写的调试会话');
          rememberHistory(b.name,toggled?toggled.history:recordInput(historyFor(b.name),requested,before));
        }else if(path==='/api/interval'){if(!Number.isInteger(b.interval)||b.interval<100||b.interval>10000)throw Error('刷新间隔须为 100–10000 ms');interval=b.interval;}
        else throw Error('未知操作');
        await save();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));
      }finally{busy=false;}return;
    }
    const files={'/':'index.html','/app.js':'app.js','/controls.js':'controls.js','/layout.js':'layout.js','/style.css':'style.css'};if(req.method!=='GET'||!files[path]){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('public/'+files[path],root)));
  }catch(e){if(e.variableName&&e.actual)values.set(e.variableName,{...e.actual,updated:Date.now()});res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
async function shutdown(){if(shuttingDown)return;shuttingDown=true;client?.close();server.close();try{const saved=JSON.parse(await readFile(runtime,'utf8'));if(saved.token===shutdownToken)await unlink(runtime);}catch{}console.log('Keil Debug Assistant stopped.');}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
server.listen(Number(process.env.PORT||3210),'127.0.0.1',async()=>{await writeFile(runtime,JSON.stringify({port:server.address().port,token:shutdownToken,pid:process.pid}));console.log(`Keil Debug Assistant: http://127.0.0.1:${server.address().port}`);poll();});



