import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createDebugTarget} from '../test-support/debug-target.mjs';
import {fixtureCatalog} from '../test-support/copy-catalog.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('HTTP C++ copy captures hidden nested arrays in full, preserves panel state, and cancels cleanly without writes or stale results',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-copy-test-')),target=await createDebugTarget({mode:'running',catalog:fixtureCatalog});let child,base,state;
 try{
  for(const file of ['app','scripts','package.json'])await cp(new URL('../'+file,import.meta.url),join(dir,file),{recursive:true});await cp(new URL('../test-support/copy-catalog.mjs',import.meta.url),join(dir,'fixture.mjs'));
  const project=join(dir,'copy.uvprojx');await writeFile(project,'<Project/>');await writeFile(project.replace('.uvprojx','.uvoptx'),'<ProjectOpt/>');
  const file=join(dir,'app/server.mjs'),source=await readFile(file,'utf8');await writeFile(file,source.replace("import {loadCatalog} from './lib/catalog.mjs';","import {loadCatalog} from '../fixture.mjs';").replace('new SessionPool();',`new SessionPool({discover:async()=>[{port:${target.port},pid:1,title:'Copy test',project:${JSON.stringify(project)}}]});`));
  child=spawn(process.execPath,['app/server.mjs'],{cwd:dir,windowsHide:true,env:{...process.env,PORT:'0',KDA_UPDATE_DISABLED:'1'},stdio:'ignore'});
  for(let i=0;i<100;i++){try{const runtime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));base='http://127.0.0.1:'+runtime.port;state=await(await fetch(base+'/api/state')).json();break;}catch{await pause(30);}}assert.ok(state);
  async function post(path,data={},expected=200){for(let i=0;i<200;i++){const response=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({sessionId:state.sessionId,sessionKey:state.sessionKey,...data})}),body=await response.json();if(response.status===409){await pause(20);continue;}assert.equal(response.status,expected,JSON.stringify(body));if(response.ok)state=body;return body;}throw Error('server remained busy');}
  async function until(check){for(let i=0;i<1000;i++){state=await(await fetch(base+'/api/state')).json();if(check(state))return;await pause(20);}throw Error('state did not converge: '+JSON.stringify(state.copyJob));}
  async function result(patch={},expected=200){const query=new URLSearchParams({id:state.copyJob.id,sessionId:state.sessionId,sessionKey:state.sessionKey,...patch}),response=await fetch(base+'/api/array-copy/result?'+query),body=await response.json();assert.equal(response.status,expected);return body;}
  const list=()=>state.items.map(({name,min,max,step,visibleMembers})=>({name,min,max,step,visibleMembers}));
  await post('interval',{interval:100});await post('connect',{mode:'keil',port:target.port,selection:String(target.port)});await until(s=>s.status==='running');
  await post('items',{items:[{name:'matrix',visibleMembers:['matrix[1][0]']},{name:'pid[1]',visibleMembers:['pid[1].mode']},{name:'wide',visibleMembers:[]},{name:'bad',visibleMembers:[]}]});
  for(let i=0;i<3;i++)for(let j=0;j<2;j++)target.values.set(`matrix[${i}][${j}]`,i*2+j+1);
  for(let i=0;i<2;i++){target.values.set(`pid[${i}].gains[0]`,i+0.5);target.values.set(`pid[${i}].gains[1]`,i+0.25);target.values.set(`pid[${i}].mode`,i);}
  await post('array-copy',{root:'matrix',name:'matrix',sessionId:'stale'},400);await post('array-copy',{root:'matrix',name:'pid'},400);await post('array-copy',{root:'bad',name:'bad'},400);
  const before=await readFile(join(dir,'userdata/panel.json'),'utf8');await post('array-copy',{root:'matrix',name:'matrix'});assert.equal(state.copyJob.total,6);assert.equal(state.copyJob.text,undefined);await until(s=>s.copyJob?.status==='done');let copied=await result();assert.equal(copied.text,'{\n  {1, 2},\n  {3, 4},\n  {5, 6}\n}');assert.equal(state.items[0].children.length,1);assert.equal(await readFile(join(dir,'userdata/panel.json'),'utf8'),before);await result({sessionId:'stale'},400);
  await post('array-copy',{root:'pid[1]',name:'pid'});await until(s=>s.copyJob?.status==='done');copied=await result();assert.match(copied.text,/\{0.5f, 0.25f\}/);assert.match(copied.text,/\{1.5f, 1.25f\}/);assert.equal(copied.total,6);
  target.failRead='matrix[2][1]';await post('array-copy',{root:'matrix',name:'matrix'});await until(s=>s.copyJob?.status==='error');await result({},400);target.failRead='';
  await post('array-copy',{root:'wide',name:'wide'});await until(s=>s.copyJob?.completed>0);const at=performance.now();await post('preferences',{preferences:{chromeCollapsed:true}});assert.ok(performance.now()-at<700);await post('array-copy/cancel',{id:state.copyJob.id});assert.equal(state.copyJob.status,'cancelled');await result({},400);
  for(let i=0;i<520;i++)target.values.set('wide['+i+']',i);await post('array-copy',{root:'wide',name:'wide'});await until(s=>s.copyJob?.status==='done');copied=await result();assert.equal(copied.total,520);assert.deepEqual(JSON.parse(copied.text.replace('{','[').replace('}',']')),Array.from({length:520},(_,i)=>i));assert.equal(state.items[2].children.length,0);
  await post('array-copy',{root:'wide',name:'wide'});await post('connect',{mode:'disconnected'});assert.equal(state.copyJob,null);await post('connect',{mode:'keil',port:target.port,selection:String(target.port)});await until(s=>s.status==='running');
  await post('array-copy',{root:'wide',name:'wide'});await post('items',{items:list().filter(item=>item.name!=='wide')});await until(s=>s.copyJob?.status==='error');await result({},400);
  assert.ok(target.commands.filter(command=>command.expression).every(command=>!command.expression.includes(' = ')),'copy wrote target values');
  const {token}=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));await post('shutdown',{token});if(child.exitCode===null)await once(child,'exit');
 }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}await target.close();const path=resolve(dir),prefix=resolve(tmpdir())+sep;assert.ok(path.startsWith(prefix)&&path.slice(prefix.length).startsWith('keil-copy-test-'));await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
