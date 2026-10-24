import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {prepareFixture} from '../test-support/keil.mjs';

test('Keil array/class browsing, selected member writes, and stop script closes only the service',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-assistant-test-'));
 let child;
 try{
  const fixture=await prepareFixture(dir);
  child=spawn(process.execPath,['app/server.mjs'],{cwd:dir,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  let runtime;for(let attempt=0;attempt<100;attempt++){try{runtime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,30));}}
  assert.ok(runtime,'Server failed to start: '+output);
  const base=`http://127.0.0.1:${runtime.port}`;
  let sessionId,sessionKey;
  async function post(path,data){for(let i=0;i<30;i++){const response=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({...data,sessionId,...(['write','toggle'].includes(path)?{sessionKey}:{})})});const body=await response.json();if(response.status===409){await new Promise(r=>setTimeout(r,30));continue;}assert.ok(response.ok,JSON.stringify(body));sessionId=body.sessionId;sessionKey=body.sessionKey;return body;}throw Error('Server remained busy');}
  const fresh=await (await fetch(base+'/api/state')).json();assert.equal(fresh.status,'disconnected');assert.equal(fresh.items.length,0);assert.equal(fresh.projectPath,'');assert.deepEqual(fresh.preferences,{theme:'forest',collapsed:false,guideOpen:true,guideDismissed:false});assert.equal(fresh.version,'2.1.0');
  for(const route of ['/','/app.js','/style.css','/format.js','/preferences.js','/session-picker.js','/member-picker.js','/notices.js','/keil.ico'])assert.equal((await fetch(base+route)).status,200);
  const html=await(await fetch(base+'/')).text();assert.doesNotMatch(html,/id="mode"|id="demoStart"|演示/);assert.match(html,/id="connectionLed"/);assert.match(html,/id="guideClose"/);
  const removed=await fetch(base+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({mode:'demo'})});assert.equal(removed.status,400);
  await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});
  let ready=false;for(let i=0;i<100;i++){const state=await(await fetch(base+'/api/state')).json();sessionId=state.sessionId;sessionKey=state.sessionKey;if(state.status==='running'&&state.items.length===6&&state.items.every(v=>v.updated)){ready=true;break;}await new Promise(r=>setTimeout(r,30));}assert.ok(ready,'fixture did not connect');
  let preferencesState=await post('preferences',{preferences:{theme:'dark',collapsed:true,guideOpen:false,guideDismissed:false}});assert.deepEqual(preferencesState.preferences,{theme:'dark',collapsed:true,guideOpen:false,guideDismissed:false});
  let displayState=await post('display',{root:'motor.enabled',name:'motor.enabled',hex:true});assert.equal(displayState.items.find(v=>v.name==='motor.enabled').hex,true);
  assert.equal(JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).items.find(v=>v.name==='motor.enabled').hex,true);
  const unsupported=await fetch(base+'/api/display',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({root:'pid.kp',name:'pid.kp',hex:true,sessionId})});assert.equal(unsupported.status,400);assert.match((await unsupported.json()).error,/仅整型/);
  const stale=await fetch(base+'/api/write',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({sessionKey,sessionId:'old',name:'pid.kp',value:3})});assert.equal(stale.status,400);assert.match((await stale.json()).error,/会话已切换/);
  const staleLayout=await fetch(base+'/api/layout',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({sessionId:'old',layout:{mode:'grid',widgets:{}}})});assert.equal(staleLayout.status,400);assert.match((await staleLayout.json()).error,/会话已切换/);
  const catalog=await post('catalog',{});assert.ok(catalog.variables.some(v=>v.name==='samples'&&v.array));
  const preview=await post('preview',{name:'controllers[2].gain'});assert.equal(preview.selected.type,'float');
  let result=await post('members',{name:'samples'});assert.equal(result.members.length,64);assert.equal(result.nextOffset,64);
  result=await post('members',{name:'samples',offset:64});assert.equal(result.members.at(-1).name,'samples[127]');assert.equal(result.nextOffset,null);
  result=await post('members',{name:'controllers'});assert.equal(result.members.length,4);
  result=await post('members',{name:'controllers[2]'});assert.equal(result.members[0].name,'controllers[2].gain');
  await post('items',{items:[{name:'controllers[2].gain',min:0,max:10,step:0.1}]});
  for(let i=0;i<50;i++){const state=await (await fetch(base+'/api/state')).json();if(state.items[0]?.updated)break;await new Promise(r=>setTimeout(r,30));}
  result=await post('write',{name:'controllers[2].gain',value:2.3});assert.equal(result.items[0].value,'2.3');
  result=await post('items',{items:[{name:'pid',min:0,max:10,step:0.1,members:{'pid.kp':{min:-5,max:5,step:0.25}}},{name:'samples'},{name:'controllers[2]',min:0,max:10,step:1}],remember:{min:-5,max:5,step:0.25,pinned:true}});
  assert.equal(result.items[0].children.length,2);assert.equal(result.items[1].children.length,128);assert.equal(result.items[0].children[0].step,0.25);
  result=await post('display',{root:'controllers[2]',name:'controllers[2].enabled',hex:true});assert.equal(result.items[2].children.find(v=>v.name.endsWith('.enabled')).hex,true);assert.equal(result.items[2].children.find(v=>v.name.endsWith('.gain')).hex,undefined);
  const displayConfig=JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).items[2];assert.deepEqual(displayConfig.members['controllers[2].enabled'],{hex:true});
  for(let i=0;i<50;i++){const state=await (await fetch(base+'/api/state')).json();if(state.items[0]?.children[0]?.updated)break;await new Promise(r=>setTimeout(r,30));}
  result=await post('write',{root:'pid',name:'pid.kp',value:2.5});assert.equal(result.items[0].children[0].value,'2.5');
  assert.deepEqual(result.items[0].children[0].history,{previous:1.2,current:2.5,selected:'current'});
  result=await post('toggle',{root:'pid',name:'pid.kp'});assert.equal(result.items[0].children[0].value,'1.2');
  result=await post('toggle',{root:'pid',name:'pid.kp'});assert.equal(result.items[0].children[0].value,'2.5');
  result=await post('write',{root:'pid',name:'pid.kp',value:3});assert.equal(result.items[0].children[0].history.previous,2.5);
  result=await post('toggle',{root:'pid',name:'pid.kp'});assert.equal(result.items[0].children[0].value,'2.5');
  const saved=JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8'));assert.equal(saved.defaults.step,0.25);assert.ok(saved.excluded.includes('controllers[2].gain'));
  assert.equal(saved.writeHistory[fixture.opt]['pid.kp'].current,3);assert.equal(saved.writeHistory[fixture.opt]['pid.kp'].selected,'previous');
  const layout={mode:'free',widgets:{pid:{x:32,y:48,width:480,height:420}}};result=await post('layout',{layout});assert.deepEqual(result.layout,layout);assert.deepEqual(JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).layout,layout);
  result=await post('items',{items:[{name:'board',min:0,max:10,step:0.1,pinned:true}],rename:{from:'pid',to:'board'}});assert.equal(result.items[0].name,'board');assert.deepEqual(result.layout.widgets.board,layout.widgets.pid);assert.ok(!result.layout.widgets.pid);assert.ok(!result.items[0].members);
  const captured={mode:'free',widgets:{board:{x:64,y:88,width:640,height:360}}};
  result=await post('items',{items:[{name:'samples'}],rename:{from:'board',to:'samples',layout:captured}});
  assert.equal(result.items[0].children.length,128);assert.deepEqual(result.layout,{mode:'free',widgets:{samples:captured.widgets.board}});
  assert.deepEqual(JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).layout,result.layout);
  const project=join(dir,'fixture.uvoptx');await (await import('node:fs/promises')).writeFile(project,'<WatchWindow1><ItemText>pid.kp</ItemText></WatchWindow1>');
  await post('project',{path:project});await post('items',{items:[{name:'pid'}]});await (await import('node:fs/promises')).writeFile(project,'<WatchWindow1>\n<ItemText>pid.kp</ItemText>\n</WatchWindow1>');await new Promise(r=>setTimeout(r,600));
  assert.ok(!(await (await fetch(base+'/api/state')).json()).items.some(v=>v.name==='pid.kp'));
  const denied=await fetch(base+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:'{"token":"wrong"}'});assert.equal(denied.status,400);
  const stopped=spawn(process.execPath,['scripts/stop.mjs'],{cwd:dir,stdio:'pipe'});const [code]=await once(stopped,'exit');assert.equal(code,0);
  if(child.exitCode===null)await once(child,'exit');assert.equal(child.exitCode,0);await assert.rejects(readFile(join(dir,'data/runtime.json')));
 }finally{
  if(child&&child.exitCode===null)child.kill();
  const target=resolve(dir),tempRoot=resolve(tmpdir())+sep;
  if(!target.startsWith(tempRoot)||!target.slice(tempRoot.length).startsWith('keil-assistant-test-'))throw Error('Unsafe temporary cleanup path');
  await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});

test('legacy panel migrates to userdata and survives changing to another session',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-assistant-test-'));let child;
 try{
  const fixture=await prepareFixture(dir);
  const legacy={items:[{name:'saved.gain',min:-2,max:5,step:0.25,hex:true}],projectPath:'C:\\Example\\Demo.uvoptx',layout:{mode:'free',widgets:{'saved.gain':{x:40,y:80,width:500,height:300}}}};
  await writeFile(join(dir,'panel.json'),JSON.stringify(legacy));
  child=spawn(process.execPath,['app/server.mjs'],{cwd:dir,env:{...process.env,PORT:'0'},stdio:'ignore'});
  let runtime;for(let i=0;i<100;i++){try{runtime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,30));}}
  assert.ok(runtime);const base=`http://127.0.0.1:${runtime.port}`;let state=await (await fetch(base+'/api/state')).json();assert.equal(state.items[0].name,'saved.gain');
  let response;for(let i=0;i<30;i++){response=await fetch(base+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({mode:'keil',port:fixture.port,selection:String(fixture.port)})});if(response.status!==409)break;await new Promise(r=>setTimeout(r,30));}assert.ok(response.ok);
  const saved=JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')),prior=saved.profiles['c:\\example\\demo.uvprojx'];assert.equal(prior.items[0].name,'saved.gain');assert.equal(prior.items[0].hex,true);assert.deepEqual(prior.layout,legacy.layout);assert.equal(saved.sessionKey,fixture.sessionKey);assert.ok(!saved.items.some(v=>v.name==='saved.gain'));
  const stopped=spawn(process.execPath,['scripts/stop.mjs'],{cwd:dir,stdio:'ignore'});assert.equal((await once(stopped,'exit'))[0],0);
 }finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}const target=resolve(dir),tempRoot=resolve(tmpdir())+sep;if(!target.startsWith(tempRoot)||!target.slice(tempRoot.length).startsWith('keil-assistant-test-'))throw Error('Unsafe temporary cleanup path');await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
