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
 const dir=await mkdtemp(join(tmpdir(),'keil-assistant-test-')),sockets=new Set(),reads=[],heldReads=[];let child,readError=false,actualValue=7,holdReads=false;
 const handle=socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let pending=Buffer.alloc(0);
  socket.on('data',data=>{pending=Buffer.concat([pending,data]);while(pending.length>=32&&pending.length>=pending.readUInt32LE()){
   const frame=pending.subarray(0,pending.readUInt32LE());pending=pending.subarray(frame.length);const cmd=frame.readUInt32LE(4);let status=0,value=Buffer.alloc(0);
   if(cmd===0x2004){value=Buffer.alloc(4);value.writeUInt32LE(1);}
   if(cmd===0x202b){value=Buffer.alloc(1060);value.writeInt32LE(17);value.writeUInt32LE(1,16);sstr('0x7').copy(value,20);sstr('int').copy(value,280);sstr('gain').copy(value,540);sstr('gain').copy(value,800);}
   if(cmd===0x202f)actualValue=Number(frame.subarray(52,52+frame.readUInt32LE(48)-1).toString());
   if(cmd===0x200a){const expression=frame.subarray(48,48+frame.readUInt32LE(44)-1).toString();if(expression.includes(' = '))actualValue=Number(expression.split(' = ')[1]);else reads.push(expression);if(readError)status=13;else{value=Buffer.alloc(12);value.writeUInt32LE(4);value.writeInt32LE(actualValue,4);}}
   const response=Buffer.alloc(8+value.length);response.writeUInt32LE(cmd);response.writeUInt32LE(status,4);value.copy(response,8);const reply=()=>socket.write(packet(0x3000,response));if(cmd===0x200a&&holdReads)heldReads.push(reply);else reply();
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
  const fixture=`const describe=name=>name==='buffer'?{type:'int[80]',array:true,count:80}:/^buffer\\[([0-9]|[1-7][0-9])\\]$/.test(name)?{type:'int'}:null;const loadCatalog=async()=>({key:'fixture',describe,children:name=>name==='buffer'?{members:Array.from({length:80},(_,i)=>({name:'buffer['+i+']',type:'int'})),nextOffset:null}:null});`;
  await writeFile(path,source.replace('new SessionPool();',`new SessionPool({discover:(()=>{let calls=0;return async()=>{if(++calls>1)await new Promise(r=>setTimeout(r,3000));return ${JSON.stringify(sessions)};};})()});`).replace("import {loadCatalog} from './lib/catalog.mjs';",fixture));
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
  const chosen=['buffer[1]','buffer[17]','buffer[79]'];
  await post('items',{items:[{name:'buffer',visibleMembers:chosen,members:{'buffer[1]':{min:0,max:50,step:1,hex:true}}},{name:'buffer[7]'}]});reads.length=0;
  await until(s=>s.items[0]?.children?.length===3&&s.items[0].children.every(row=>row.updated)&&s.items[1]?.updated);
  assert.deepEqual(state.items[0].children.map(row=>row.name),chosen);assert.equal(state.items[0].children[0].hex,true);assert.equal(state.items[0].children[0].max,50);
  assert.ok(reads.length>=4);assert.ok(reads.every(name=>[...chosen,'buffer[7]'].includes(name)),'hidden array members were sampled');
  await post('group-members',{name:'buffer'});assert.ok(reads.every(name=>[...chosen,'buffer[7]'].includes(name)),'opening the picker read unselected values');
  const layout={mode:'free',widgets:{buffer:{x:20,y:40,width:440,height:390}}};await post('layout',{layout});await post('selection',{root:'buffer',members:[]});reads.length=0;
  await new Promise(r=>setTimeout(r,350));await until(s=>s.items[0]?.children?.length===0);assert.ok(reads.length>0);assert.ok(reads.every(name=>name==='buffer[7]'),'empty selection must not fall back to reading the root or hidden children');assert.deepEqual(state.layout,layout);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8')).items[0].visibleMembers,[]);
  const denied=await fetch(base+'/api/write',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({root:'buffer',name:'buffer[1]',value:5,sessionKey:state.sessionKey,sessionId:state.sessionId})});assert.equal(denied.status,400);assert.match((await denied.json()).error,/不属于/);
  await post('selection',{root:'buffer',members:null});assert.equal(state.items[0].children.length,80);assert.equal(state.items[0].visibleMembers,undefined);assert.equal(state.items[0].members['buffer[1]'].hex,true);assert.deepEqual(state.layout,layout);
  holdReads=true;await until(()=>heldReads.length>0);assert.equal(state.busy,true);
  const interfaceStart=performance.now();await Promise.all([
   post('preferences',{preferences:{collapsed:true}}),post('preferences',{preferences:{theme:'dark'}}),post('preferences',{preferences:{guideOpen:false}})
  ]);assert.ok(performance.now()-interfaceStart<700,'interface preferences waited for the held Keil read');assert.equal(state.busy,true,'target read should still be blocked');
  const panel=JSON.parse(await readFile(join(dir,'userdata/panel.json'),'utf8'));assert.deepEqual(panel.preferences,{theme:'dark',collapsed:true,guideOpen:false,guideDismissed:false});assert.equal(panel.items[0].name,'buffer');assert.equal(panel.items[0].members['buffer[1]'].hex,true);assert.deepEqual(panel.layout,layout);
  const priorSession=state.sessionId,disconnectStart=performance.now();await post('connect',{mode:'disconnected'});assert.ok(performance.now()-disconnectStart<700,'disconnect waited for target I/O');assert.equal(state.mode,'disconnected');assert.equal(state.status,'disconnected');assert.notEqual(state.sessionId,priorSession);assert.equal(state.session,null);assert.ok(state.items[0].children.every(row=>!row.updated&&!row.value));
  await until(()=>sockets.size===0);const readCount=reads.length;await new Promise(r=>setTimeout(r,350));await post('sessions',{port});assert.equal(state.mode,'disconnected');assert.equal(sockets.size,0);assert.equal(reads.length,readCount,'manual disconnect resumed reading');
  holdReads=false;heldReads.length=0;
  await post('connect',{mode:'keil',port,selection:String(port)});await until(s=>s.status==='running'&&s.items[0]?.children?.some(row=>row.updated));assert.deepEqual(state.layout,layout);assert.equal(state.items[0].members['buffer[1]'].hex,true);
  const stopped=spawn(process.execPath,['scripts/stop.mjs'],{cwd:dir,stdio:'ignore'});assert.equal((await once(stopped,'exit'))[0],0);
 }finally{
  if(child&&child.exitCode===null){child.kill();await once(child,'exit');}for(const socket of sockets)socket.destroy();await Promise.all([keil,second].map(server=>new Promise(r=>server.close(r))));
  const target=resolve(dir),tempRoot=resolve(tmpdir())+sep;if(!target.startsWith(tempRoot)||!target.slice(tempRoot.length).startsWith('keil-assistant-test-'))throw Error('Unsafe cleanup path');await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
