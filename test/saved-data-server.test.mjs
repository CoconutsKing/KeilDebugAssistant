import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,appendFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {prepareFixture} from '../test-support/keil.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function target(dir){
 const fixture=await prepareFixture(dir),other=join(dir,'other.uvprojx');await copyFile(fixture.project,other);await copyFile(fixture.opt,other.replace('.uvprojx','.uvoptx'));
 const file=join(dir,'app/server.mjs');let source=await readFile(file,'utf8');source=source.replace(`project:${JSON.stringify(fixture.project)}}],create:`,`project:${JSON.stringify(fixture.project)}},{port:47232,pid:2,title:'Other Keil',project:${JSON.stringify(other)}}],create:`);await writeFile(file,source);
 await appendFile(join(dir,'fixture.mjs'),`
const controlPath=new URL('./target.json',import.meta.url),logPath=new URL('./write-log.json',import.meta.url);
async function control(){try{return JSON.parse(await readFile(controlPath,'utf8'));}catch{return {};}}
const originalStatus=FixtureClient.prototype.status,originalRead=FixtureClient.prototype.read,originalWrite=FixtureClient.prototype.write;
FixtureClient.prototype.connect=async function(port){this.port=port;this.socket.destroyed=false;};
FixtureClient.prototype.status=async function(){const c=await control();if(c.generation!==this.generation){this.generation=c.generation;this.values=new Map(Object.entries(initial));}if(c.debug===false){const e=Error('Target is not in debug mode');e.keilStatus=6;throw e;}return originalStatus.call(this);};
FixtureClient.prototype.read=async function(name){const c=await control();if(c.delayRead)await new Promise(r=>setTimeout(r,c.delayRead));if(c.failRead===name)throw Error('injected read failure');const result=await originalRead.call(this,name);return c.liveTypeChange===name?{...result,type:'int',value:'1'}:result;};
FixtureClient.prototype.write=async function(name,value){const c=await control();if(c.delayWrite)await new Promise(r=>setTimeout(r,c.delayWrite));let log=[];try{log=JSON.parse(await readFile(logPath,'utf8'));}catch{}log.push({name,value,port:this.port});await writeFile(logPath,JSON.stringify(log));if(c.failWrite===name)throw Error('injected write failure');const result=await originalWrite.call(this,name,value);if(c.mismatch===name){this.values.set(name,value+1);return {...result,value:String(value+1)};}return result;};
const oldLoadCatalog=loadCatalog;loadCatalog=async function(){const c=await control(),base=await oldLoadCatalog();return {...base,key:'fixture:'+c.typeChange,describe:name=>{const meta=base.describe(name);return c.typeChange&&name==='pid'?{...meta,type:'ChangedPID'}:meta;}};};
`);
 return {...fixture,other};
}
test('data presets survive Debug restart and service restart, isolate projects, preserve selected members and report interrupted writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-assistant-test-'));let child,base,state,configuration={debug:true,generation:1};
 async function config(patch){configuration={...configuration,...patch};await writeFile(join(dir,'target.json'),JSON.stringify(configuration));}
 async function start(){child=spawn(process.execPath,['app/server.mjs'],{cwd:dir,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);for(let i=0;i<100;i++){try{const runtime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));base='http://127.0.0.1:'+runtime.port;state=await(await fetch(base+'/api/state')).json();return;}catch{await pause(30);}}throw Error(output);}
 async function post(path,data={},expected=200){for(let i=0;i<100;i++){const response=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({sessionId:state.sessionId,sessionKey:state.sessionKey,...data})}),body=await response.json();if(response.status===409){await pause(25);continue;}assert.equal(response.status,expected,JSON.stringify(body));if(response.ok)state=body;return body;}throw Error('request stayed busy');}
 async function until(check){for(let i=0;i<300;i++){state=await(await fetch(base+'/api/state')).json();if(check(state))return state;await pause(20);}throw Error('state did not converge: '+JSON.stringify(state.dataJob));}
 async function done(){await until(s=>s.dataJob?.status!=='running');return state.dataJob;}
 async function log(){try{return JSON.parse(await readFile(join(dir,'write-log.json'),'utf8'));}catch{return [];}}
 async function stop(){const stopped=spawn(process.execPath,['scripts/stop.mjs'],{cwd:dir,stdio:'ignore'});assert.equal((await once(stopped,'exit'))[0],0);if(child.exitCode===null)await once(child,'exit');}
 try{
  const fixture=await target(dir);await config({});await start();assert.equal((await fetch(base+'/saved-data.js')).status,200);await post('interval',{interval:100});await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});await until(s=>s.status==='running');
  await post('items',{items:[{name:'pid',min:0,max:10,step:0.1},{name:'samples',min:0,max:100,step:1,visibleMembers:['samples[1]','samples[3]','samples[7]','samples[9]']}]});await until(s=>s.items.every(v=>v.children?.every(row=>row.updated)));
  await post('write',{root:'pid',name:'pid.kp',value:2.5});await post('write',{root:'pid',name:'pid.ki',value:0.4});
  const saveStart=performance.now();await post('data/save',{root:'pid'});assert.ok(performance.now()-saveStart<700);assert.equal((await done()).status,'done');assert.equal(state.items[0].savedData.count,2);
  const original=JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).savedData.pid;assert.deepEqual(original.values.map(row=>row.value),[2.5,0.4]);
  await post('write',{root:'pid',name:'pid.kp',value:3});await config({failRead:'pid.ki'});await post('data/save',{root:'pid'});assert.equal((await done()).status,'error');assert.deepEqual(JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).savedData.pid,original);await config({failRead:''});
  await config({debug:false,generation:2});await until(s=>s.status==='waiting');await post('data/restore',{root:'pid'},400);await config({debug:true});await until(s=>s.status==='running'&&s.items[0]?.children[0]?.value==='1.2');
  await post('data/restore',{root:'pid'});assert.equal((await done()).status,'done');assert.deepEqual(state.items[0].children.map(row=>row.value),['2.5','0.4']);
  await stop();await start();assert.equal(state.status,'disconnected');assert.equal(state.items[0].savedData.count,2);await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});await until(s=>s.status==='running');await post('data/restore',{root:'pid'});assert.equal((await done()).status,'done');assert.deepEqual(state.items[0].children.map(row=>row.value),['2.5','0.4']);
  let before=(await log()).length;await post('selection',{root:'pid',members:['pid.kp']});assert.match((await post('data/restore',{root:'pid'},400)).error,/未在当前显示范围/);assert.equal((await log()).length,before);await post('selection',{root:'pid',members:null});
  const savedItems=state.items.map(({name,min,max,step,visibleMembers,members})=>({name,min,max,step,visibleMembers,members}));await post('items',{items:[{...savedItems[0],members:{'pid.ki':{min:0,max:0.1}}},savedItems[1]]});assert.match((await post('data/restore',{root:'pid'},400)).error,/超出范围/);assert.equal((await log()).length,before);await post('items',{items:savedItems});
  await config({typeChange:true});assert.match((await post('data/restore',{root:'pid'},400)).error,/类型已变化/);assert.equal((await log()).length,before);await config({typeChange:false});
  await config({liveTypeChange:'pid.ki'});await post('data/restore',{root:'pid'});assert.equal((await done()).status,'error');assert.match(state.dataJob.error,/Keil 中成员类型已改变/);assert.equal((await log()).length,before,'Keil type mismatch was found after writing');await config({liveTypeChange:''});
  const names=['samples[1]','samples[3]','samples[7]','samples[9]'];for(let i=0;i<names.length;i++)await post('write',{root:'samples',name:names[i],value:10+i});await post('data/save',{root:'samples'});assert.equal((await done()).status,'done');const savedArray=JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).savedData.samples;assert.deepEqual(savedArray.values.map(row=>row.name),names);
  await config({debug:false,generation:3});await until(s=>s.status==='waiting');await config({debug:true});await until(s=>s.status==='running');await config({failWrite:'samples[7]'});before=(await log()).length;await post('data/restore',{root:'samples'});const failed=await done();assert.equal(failed.status,'error');assert.equal(failed.completed,2);assert.match(failed.error,/2 \/ 4/);assert.deepEqual((await log()).slice(before).map(row=>row.name),names.slice(0,3));assert.deepEqual(JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).savedData.samples,savedArray);
  await config({failWrite:''});await post('data/restore',{root:'samples'});assert.equal((await done()).status,'done');assert.deepEqual(state.items[1].children.map(row=>row.value),['10','11','12','13']);
  await config({mismatch:'samples[1]'});await post('data/restore',{root:'samples'});assert.equal((await done()).status,'error');assert.equal(state.dataJob.completed,0);assert.match(state.dataJob.error,/实际回读/);await config({mismatch:''});
  const oldSession=state.sessionId,oldKey=state.sessionKey;await post('connect',{mode:'keil',port:47232,selection:'47232'});await until(s=>s.status==='running');await post('items',{items:[{name:'pid',min:0,max:10,step:0.1}]});assert.equal(state.items[0].savedData,null);await post('data/restore',{root:'pid'},400);assert.match((await post('data/restore',{root:'pid',sessionId:oldSession,sessionKey:oldKey},400)).error,/会话已切换/);
  await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});await until(s=>s.status==='running');assert.equal(state.items[0].savedData.count,2);
  await config({delayRead:80});await post('data/save',{root:'samples'});await until(s=>s.dataJob?.status==='running');const prefsStart=performance.now();await post('preferences',{preferences:{collapsed:true}});assert.ok(performance.now()-prefsStart<700);const disconnectStart=performance.now();await post('connect',{mode:'disconnected'});assert.ok(performance.now()-disconnectStart<700);assert.equal(state.dataJob.status,'cancelled');await until(s=>!s.busy);await pause(150);assert.deepEqual(JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).savedData.samples,savedArray);
  await config({delayRead:0});await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});await until(s=>s.status==='running');await post('data/restore',{root:'samples'});assert.equal((await done()).status,'done');assert.deepEqual(state.items[1].children.map(row=>row.value),['10','11','12','13']);
  await config({delayWrite:100});await post('data/restore',{root:'samples'});await until(s=>s.dataJob?.status==='running'&&s.dataJob.phase==='writing'&&s.dataJob.completed>=1);await post('connect',{mode:'disconnected'});assert.equal(state.dataJob.status,'cancelled');assert.match(state.dataJob.error,/已开始的写入可能已生效/);await until(s=>!s.busy);const finalLog=(await log()).length;await pause(250);assert.equal((await log()).length,finalLog,'a cancelled restore kept writing');assert.ok(state.items[1].children.every(row=>!row.updated));
  await config({delayWrite:0});await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});await until(s=>s.status==='running');await post('data/restore',{root:'samples'});assert.equal((await done()).status,'done');await stop();
 }finally{
  if(child&&child.exitCode===null){child.kill();await once(child,'exit');}const resolved=resolve(dir),prefix=resolve(tmpdir())+sep;if(!resolved.startsWith(prefix)||!resolved.slice(prefix.length).startsWith('keil-assistant-test-'))throw Error('Unsafe test cleanup');await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
