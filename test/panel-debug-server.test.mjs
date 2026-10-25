import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createDebugTarget} from '../test-support/debug-target.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('HTTP array reindex preserves geometry/settings/presets and Debug/Run controls only the selected window, with cancellation and failure recovery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-panel-test-')),first=await createDebugTarget({mode:'running'}),second=await createDebugTarget();let child,base,state;
 try{
  for(const file of ['app','scripts','package.json'])await cp(new URL('../'+file,import.meta.url),join(dir,file),{recursive:true});await cp(new URL('../test-support/keil.mjs',import.meta.url),join(dir,'fixture.mjs'));
  const sessions=[first,second].map((target,i)=>({port:target.port,pid:i+1,title:'Keil '+(i+1),project:join(dir,(i?'second':'first')+'.uvprojx')}));
  for(const session of sessions){await writeFile(session.project,'<Project/>');await writeFile(session.project.replace('.uvprojx','.uvoptx'),'<ProjectOpt/>');}
  const path=join(dir,'app/server.mjs'),source=await readFile(path,'utf8');await writeFile(path,source.replace("import {loadCatalog} from './lib/catalog.mjs';","import {loadCatalog} from '../fixture.mjs';").replace('new SessionPool();',`new SessionPool({discover:async()=>${JSON.stringify(sessions)}});`));
  async function start(){child=spawn(process.execPath,['app/server.mjs'],{cwd:dir,windowsHide:true,env:{...process.env,PORT:'0',KDA_UPDATE_DISABLED:'1'},stdio:'ignore'});for(let i=0;i<100;i++){try{const runtime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));base='http://127.0.0.1:'+runtime.port;state=await(await fetch(base+'/api/state')).json();return;}catch{await pause(30);}}throw Error('test server did not start');}
  async function post(path,data={},expected=200){for(let i=0;i<150;i++){const response=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({sessionId:state.sessionId,sessionKey:state.sessionKey,...data})}),body=await response.json();if(response.status===409&&expected!==409){await pause(20);continue;}assert.equal(response.status,expected,JSON.stringify(body));if(response.ok)state=body;return body;}throw Error('request remained busy');}
  async function until(check){for(let i=0;i<400;i++){state=await(await fetch(base+'/api/state')).json();if(check(state))return state;await pause(20);}throw Error('state did not converge: '+JSON.stringify({status:state.status,job:state.debugJob}));}
  async function stop(){const {token}=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));await post('shutdown',{token});if(child.exitCode===null)await once(child,'exit');}
  const configItems=()=>state.items.map(({name,min,max,step,pinned,members,visibleMembers,hex})=>({name,min,max,step,pinned,members,visibleMembers,hex}));
  await start();await post('interval',{interval:100});await post('connect',{mode:'keil',port:first.port,selection:String(first.port)});await until(s=>s.status==='running'&&s.session?.pid===1);
  await post('items',{items:[{name:'controllers[0]',min:-2,max:10,step:0.1,pinned:true,visibleMembers:['controllers[0].gain'],members:{'controllers[0].gain':{min:-1,max:5,step:0.25},'controllers[0].enabled':{hex:true}}},{name:'samples[3]',min:-5,max:5,step:0.05}]});await until(s=>s.items.every(item=>item.children?item.children.every(row=>row.updated):item.updated));
  await post('write',{root:'controllers[0]',name:'controllers[0].gain',value:2.25});await post('data/save',{root:'controllers[0]'});await until(s=>s.dataJob?.status==='done');
  const rect={x:0,y:40,width:382,height:430},layout={mode:'free',placement:'canvas',widgets:{'controllers[0]':rect,'samples[3]':{x:400,y:40,width:382,height:290}}};await post('layout',{layout});
  await post('index',{root:'controllers[0]',dimension:0,index:1});assert.equal(state.items[0].name,'controllers[1]');assert.deepEqual(state.layout.widgets['controllers[1]'],rect);assert.deepEqual(state.items[0].visibleMembers,['controllers[1].gain']);assert.equal(state.items[0].members['controllers[1].gain'].step,0.25);assert.equal(state.items[0].savedData,null);assert.equal(state.layout.placement,'canvas');
  await until(s=>s.items[0].children[0].value==='1.5');const stored=JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8'));assert.equal(stored.savedData['controllers[0]'].values[0].value,2.25);
  await post('index',{root:'controllers[1]',dimension:0,index:4},400);assert.equal(state.items[0].name,'controllers[1]');await post('index',{root:'controllers[1]',dimension:0,index:2,sessionId:'stale'},400);
  await post('items',{items:[...configItems(),{name:'controllers[2]'}]});await post('index',{root:'controllers[1]',dimension:0,index:2},400);await post('items',{items:configItems().filter(item=>item.name!=='controllers[2]')});
  await post('index',{root:'controllers[1]',dimension:0,index:0});assert.equal(state.items[0].savedData.count,1);assert.deepEqual(state.layout.widgets['controllers[0]'],rect);assert.equal(state.items[0].history,null);
  await until(s=>s.items[0].children[0].updated);assert.equal(state.items[0].children[0].history.current,2.25);
  await post('index',{root:'controllers[0]',dimension:0,index:null});assert.equal(state.items[0].name,'controllers');assert.equal(state.items[0].children.length,8);await post('index',{root:'controllers',dimension:0,index:2});assert.deepEqual(state.layout.widgets['controllers[2]'],rect);
  await post('index',{root:'samples[3]',dimension:0,index:7});assert.equal(state.items[1].name,'samples[7]');assert.equal(state.items[1].step,0.05);assert.deepEqual(state.layout.widgets['samples[7]'],layout.widgets['samples[3]']);
  await post('preferences',{preferences:{collapsed:true,chromeCollapsed:true,guideDismissed:true}});await stop();await start();assert.equal(state.preferences.chromeCollapsed,true);assert.equal(state.preferences.collapsed,true);assert.equal(state.items[0].name,'controllers[2]');assert.equal(state.layout.placement,'canvas');assert.deepEqual(state.layout.widgets['controllers[2]'],rect);
  await post('interval',{interval:100});await post('connect',{mode:'keil',port:first.port,selection:String(first.port)});await until(s=>s.status==='running'&&s.items[0]?.children.every(row=>row.updated));
  first.mode='waiting';first.holdEnter=true;await until(s=>s.status==='waiting');const startAt=performance.now();await post('debug/run',{port:first.port,selection:String(first.port)});assert.ok(performance.now()-startAt<700);await until(s=>s.debugJob?.phase==='entering');const jobId=state.debugJob.id;
  const prefsAt=performance.now();await post('preferences',{preferences:{chromeCollapsed:false}});assert.ok(performance.now()-prefsAt<700,'top preferences waited for Debug initialization');await post('debug/run',{port:first.port,selection:String(first.port)});assert.equal(state.debugJob.id,jobId);
  await post('debug/run',{port:first.port,selection:String(first.port),sessionId:'stale'},400);await post('connect',{mode:'disconnected'});assert.equal(state.debugJob.status,'cancelled');first.releaseEnter();await until(s=>!s.busy);assert.ok(!first.commands.some(command=>command.cmd===0x2002));
  await post('debug/run',{port:second.port,selection:String(second.port)});await until(s=>s.debugJob?.status==='done'&&s.status==='running'&&s.session?.port===second.port);assert.equal(second.commands.filter(c=>c.cmd===0x2000).length,1);assert.equal(second.commands.filter(c=>c.cmd===0x2002).length,1);assert.equal(first.mode,'halted');
  await post('debug/run',{port:second.port,selection:String(second.port)});await until(s=>s.debugJob?.status==='done');assert.equal(second.commands.filter(c=>c.cmd===0x2002).length,1,'running target was restarted');
  await post('connect',{mode:'keil',port:first.port,selection:String(first.port)});await until(s=>s.status==='halted'&&s.session?.port===first.port);await post('debug/run',{port:first.port,selection:String(first.port)});await until(s=>s.debugJob?.status==='done'&&s.status==='running');assert.equal(first.commands.filter(c=>c.cmd===0x2000).length,1);assert.equal(first.commands.filter(c=>c.cmd===0x2002).length,1);
  first.mode='waiting';await until(s=>s.status==='waiting');await post('debug/run',{port:first.port,selection:String(first.port)});await until(s=>s.debugJob?.phase==='entering');await post('connect',{mode:'keil',port:second.port,selection:String(second.port)});first.releaseEnter();await until(s=>s.status==='running'&&s.session?.port===second.port);assert.equal(first.commands.filter(c=>c.cmd===0x2002).length,1,'switching windows sent Run to the old target');
  second.mode='waiting';second.enterError=1;await until(s=>s.status==='waiting');await post('debug/run',{port:second.port,selection:String(second.port)});await until(s=>s.debugJob?.status==='error');assert.match(state.debugJob.error,/Injected probe failure/);assert.equal(second.commands.filter(c=>c.cmd===0x2002).length,1);
  await stop();
 }finally{
  if(child&&child.exitCode===null){child.kill();await once(child,'exit');}await Promise.all([first.close(),second.close()]);const path=resolve(dir),prefix=resolve(tmpdir())+sep;assert.ok(path.startsWith(prefix)&&path.slice(prefix.length).startsWith('keil-panel-test-'));await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
