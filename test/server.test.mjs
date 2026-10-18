import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('demo array/class browsing, selected member writes, and stop script closes only the service',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-assistant-test-'));
 let child;
 try{
  for(const file of ['server.mjs','stop.mjs','lib'])await cp(new URL('../'+file,import.meta.url),join(dir,file),{recursive:true});
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  let runtime;for(let attempt=0;attempt<100;attempt++){try{runtime=JSON.parse(await readFile(join(dir,'.keil-runtime.json'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,30));}}
  assert.ok(runtime,'Server failed to start: '+output);
  const base=`http://127.0.0.1:${runtime.port}`;
  async function post(path,data){for(let i=0;i<30;i++){const response=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify(data)});const body=await response.json();if(response.status===409){await new Promise(r=>setTimeout(r,30));continue;}assert.ok(response.ok,JSON.stringify(body));return body;}throw Error('Server remained busy');}
  await post('connect',{mode:'demo'});
  const catalog=await post('catalog',{});assert.ok(catalog.variables.some(v=>v.name==='samples'&&v.array));
  const preview=await post('preview',{name:'controllers[2].gain'});assert.equal(preview.selected.type,'float');
  let result=await post('members',{name:'samples'});assert.equal(result.members.length,64);assert.equal(result.nextOffset,64);
  result=await post('members',{name:'samples',offset:64});assert.equal(result.members.at(-1).name,'samples[127]');assert.equal(result.nextOffset,null);
  result=await post('members',{name:'controllers'});assert.equal(result.members.length,4);
  result=await post('members',{name:'controllers[2]'});assert.equal(result.members[0].name,'controllers[2].gain');
  await post('items',{items:[{name:'controllers[2].gain',min:0,max:10,step:0.1}]});
  for(let i=0;i<50;i++){const state=await (await fetch(base+'/api/state')).json();if(state.items[0]?.updated)break;await new Promise(r=>setTimeout(r,30));}
  result=await post('write',{name:'controllers[2].gain',value:2.3});assert.equal(result.items[0].value,'2.3');
  result=await post('items',{items:[{name:'pid',min:0,max:10,step:0.1,members:{'pid.kp':{min:-5,max:5,step:0.25}}},{name:'samples'}],remember:{min:-5,max:5,step:0.25,pinned:true}});
  assert.equal(result.items[0].children.length,2);assert.equal(result.items[1].children.length,128);assert.equal(result.items[0].children[0].step,0.25);
  for(let i=0;i<50;i++){const state=await (await fetch(base+'/api/state')).json();if(state.items[0]?.children[0]?.updated)break;await new Promise(r=>setTimeout(r,30));}
  result=await post('write',{root:'pid',name:'pid.kp',value:2.5});assert.equal(result.items[0].children[0].value,'2.5');
  assert.deepEqual(result.items[0].children[0].history,{previous:1.2,current:2.5,selected:'current'});
  result=await post('toggle',{root:'pid',name:'pid.kp'});assert.equal(result.items[0].children[0].value,'1.2');
  result=await post('toggle',{root:'pid',name:'pid.kp'});assert.equal(result.items[0].children[0].value,'2.5');
  result=await post('write',{root:'pid',name:'pid.kp',value:3});assert.equal(result.items[0].children[0].history.previous,2.5);
  result=await post('toggle',{root:'pid',name:'pid.kp'});assert.equal(result.items[0].children[0].value,'2.5');
  const saved=JSON.parse(await readFile(join(dir,'panel.json'),'utf8'));assert.equal(saved.defaults.step,0.25);assert.ok(saved.excluded.includes('controllers[2].gain'));
  assert.equal(saved.writeHistory.demo['pid.kp'].current,3);assert.equal(saved.writeHistory.demo['pid.kp'].selected,'previous');
  const layout={mode:'free',widgets:{pid:{x:32,y:48,width:480,height:420}}};result=await post('layout',{layout});assert.deepEqual(result.layout,layout);assert.deepEqual(JSON.parse(await readFile(join(dir,'panel.json'),'utf8')).layout,layout);
  result=await post('items',{items:[{name:'board',min:0,max:10,step:0.1,pinned:true}],rename:{from:'pid',to:'board'}});assert.equal(result.items[0].name,'board');assert.deepEqual(result.layout.widgets.board,layout.widgets.pid);assert.ok(!result.layout.widgets.pid);assert.ok(!result.items[0].members);
  const project=join(dir,'fixture.uvoptx');await (await import('node:fs/promises')).writeFile(project,'<WatchWindow1><ItemText>pid.kp</ItemText></WatchWindow1>');
  await post('project',{path:project});await post('items',{items:[{name:'pid'}]});await (await import('node:fs/promises')).writeFile(project,'<WatchWindow1>\n<ItemText>pid.kp</ItemText>\n</WatchWindow1>');await new Promise(r=>setTimeout(r,600));
  assert.ok(!(await (await fetch(base+'/api/state')).json()).items.some(v=>v.name==='pid.kp'));
  const denied=await fetch(base+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:'{"token":"wrong"}'});assert.equal(denied.status,400);
  const stopped=spawn(process.execPath,['stop.mjs'],{cwd:dir,stdio:'pipe'});const [code]=await once(stopped,'exit');assert.equal(code,0);
  if(child.exitCode===null)await once(child,'exit');assert.equal(child.exitCode,0);await assert.rejects(readFile(join(dir,'.keil-runtime.json')));
 }finally{
  if(child&&child.exitCode===null)child.kill();
  const target=resolve(dir),tempRoot=resolve(tmpdir())+sep;
  if(!target.startsWith(tempRoot)||!target.slice(tempRoot.length).startsWith('keil-assistant-test-'))throw Error('Unsafe temporary cleanup path');
  await rm(target,{recursive:true,force:true});
 }
});
