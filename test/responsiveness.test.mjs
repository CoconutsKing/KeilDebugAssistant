import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {packet,sstr} from '../app/lib/uvsock.mjs';

test('HTTP edits/deletion and sampling remain responsive during a slow window scan; transient reads recover',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-assistant-test-')),sockets=new Set();let child,readError=false,actualValue=7;
 const handle=socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let pending=Buffer.alloc(0);
  socket.on('data',data=>{pending=Buffer.concat([pending,data]);while(pending.length>=32&&pending.length>=pending.readUInt32LE()){
   const frame=pending.subarray(0,pending.readUInt32LE());pending=pending.subarray(frame.length);const cmd=frame.readUInt32LE(4);let status=0,value=Buffer.alloc(0);
   if(cmd===0x2004){value=Buffer.alloc(4);value.writeUInt32LE(1);}
   if(cmd===0x202b){value=Buffer.alloc(1060);value.writeInt32LE(17);value.writeUInt32LE(1,16);sstr('0x7').copy(value,20);sstr('int').copy(value,280);sstr('gain').copy(value,540);sstr('gain').copy(value,800);}
   if(cmd===0x202f)actualValue=Number(frame.subarray(52,52+frame.readUInt32LE(48)-1).toString());
   if(cmd===0x200a){if(readError)status=13;else{value=Buffer.alloc(12);value.writeUInt32LE(4);value.writeInt32LE(actualValue,4);}}
   const response=Buffer.alloc(8+value.length);response.writeUInt32LE(cmd);response.writeUInt32LE(status,4);value.copy(response,8);socket.write(packet(0x3000,response));
  }});
 };
 const keil=net.createServer(handle),second=net.createServer(handle);
 try{
  keil.listen(0,'127.0.0.1');await once(keil,'listening');const port=keil.address().port;
  second.listen(0,'127.0.0.1');await once(second,'listening');const secondPort=second.address().port;
  for(const file of ['app','scripts','package.json'])await cp(new URL('../'+file,import.meta.url),join(dir,file),{recursive:true});
  const path=join(dir,'app/server.mjs'),source=await readFile(path,'utf8');
  // Inject a slow OS scan only into this disposable test checkout.
  const firstProject=join(dir,'first.uvprojx'),secondProject=join(dir,'second.uvprojx');
  for(const project of [firstProject,secondProject]){await writeFile(project,'<Project/>');await writeFile(project.replace('.uvprojx','.uvoptx'),'<ProjectOpt/>');}
  const sessions=[{port,pid:1,title:'First Keil',project:firstProject},{port:secondPort,pid:2,title:'Second Keil',project:secondProject}];
  await writeFile(path,source.replace('new SessionPool();',`new SessionPool({discover:(()=>{let calls=0;return async()=>{if(++calls>1)await new Promise(r=>setTimeout(r,3000));return ${JSON.stringify(sessions)};};})()});`));
  child=spawn(process.execPath,['app/server.mjs'],{cwd:dir,env:{...process.env,PORT:'0'},stdio:'ignore'});
  let runtime;for(let i=0;i<100;i++){try{runtime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,30));}}
  assert.ok(runtime);const base=`http://127.0.0.1:${runtime.port}`;let state=await(await fetch(base+'/api/state')).json();
  async function post(path,data){for(let i=0;i<60;i++){const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({...data,sessionId:state.sessionId})});const next=await r.json();if(r.status===409){await new Promise(r=>setTimeout(r,30));continue;}assert.ok(r.ok,JSON.stringify(next));return state=next;}throw Error('Server busy');}
  async function until(check){for(let i=0;i<100;i++){state=await(await fetch(base+'/api/state')).json();if(check(state))return state;await new Promise(r=>setTimeout(r,30));}throw Error('State did not converge');}
  await post('interval',{interval:100});await post('connect',{mode:'keil',port,selection:'auto'});await until(s=>s.session?.pid===1&&s.status==='running');
  await post('items',{items:[{name:'gain'}]});await until(s=>s.items[0]?.value==='7');const before=state.items[0].updated;
  const originalId=state.sessionId;await post('connect',{mode:'keil',port,selection:String(port)});assert.equal(state.selection,String(port));assert.equal(state.sessionId,originalId,'same-session connect must preserve the working socket and context');
  const switchStart=performance.now();await post('connect',{mode:'keil',port:secondPort,selection:String(secondPort)});assert.ok(performance.now()-switchStart<700);assert.equal(state.projectPath,secondProject.replace('.uvprojx','.uvoptx'));assert.equal(state.selection,String(secondPort));assert.equal(state.discovering,false,'selection restarted window discovery');
  await post('connect',{mode:'keil',port,selection:String(port)});assert.equal(state.projectPath,firstProject.replace('.uvprojx','.uvoptx'));assert.equal(state.items[0].name,'gain');await until(s=>s.items[0]?.updated);
  const scanStart=performance.now();await post('sessions',{port});assert.ok(performance.now()-scanStart<700,'window scan blocked the HTTP request');assert.equal(state.discovering,true);
  const editStart=performance.now();await post('items',{items:[{name:'gain',max:50}]});assert.ok(performance.now()-editStart<700);assert.equal(state.discovering,true);
  await until(s=>s.items[0]?.updated>before);assert.equal(state.discovering,true,'sampling only resumed after the slow scan ended');
  const deleteStart=performance.now();await post('items',{items:[]});assert.ok(performance.now()-deleteStart<700);assert.equal(state.items.length,0);assert.equal(state.discovering,true);
  await post('items',{items:[{name:'gain'}]});await until(s=>s.items[0]?.value==='7');
  readError=true;await until(s=>s.items[0]?.error);assert.equal(state.items[0].value,'7');assert.ok(state.items[0].updated);assert.equal(state.items[0].editable,false);
  readError=false;await until(s=>s.items[0]?.updated&&!s.items[0].error&&s.items[0].editable);assert.equal(state.items[0].value,'7');
  await post('write',{root:'gain',name:'gain',value:12,sessionKey:state.sessionKey});assert.equal(state.items[0].value,'12');
  const history=state.items[0].history,writtenAt=state.items[0].updated;
  actualValue=4;await until(s=>s.items[0]?.value==='4'&&s.items[0].updated>writtenAt);assert.deepEqual(state.items[0].history,history,'external samples must not replace the two user targets');
  await post('toggle',{root:'gain',name:'gain',sessionKey:state.sessionKey});assert.equal(state.items[0].value,'7');
  actualValue=19;await until(s=>s.items[0]?.value==='19');await post('toggle',{root:'gain',name:'gain',sessionKey:state.sessionKey});assert.equal(state.items[0].value,'12');
  const stopped=spawn(process.execPath,['scripts/stop.mjs'],{cwd:dir,stdio:'ignore'});assert.equal((await once(stopped,'exit'))[0],0);
 }finally{
  if(child&&child.exitCode===null){child.kill();await once(child,'exit');}for(const socket of sockets)socket.destroy();await Promise.all([keil,second].map(server=>new Promise(r=>server.close(r))));
  const target=resolve(dir),tempRoot=resolve(tmpdir())+sep;if(!target.startsWith(tempRoot)||!target.slice(tempRoot.length).startsWith('keil-assistant-test-'))throw Error('Unsafe cleanup path');await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
