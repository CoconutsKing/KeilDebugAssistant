import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {releaseFiles,makeZip} from '../scripts/release.mjs';
import {hash,repository} from '../app/lib/update-package.mjs';
import {stagePackage} from '../app/lib/update-stage.mjs';
import {applyUpdate,verifyStage} from '../app/lib/update-installer.mjs';
import {prepareFixture} from '../test-support/keil.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function packageFor(version,broken=false){const files=await releaseFiles();for(const file of files)if(file.name==='package.json'){const pack=JSON.parse(file.data);pack.version=version;file.data=Buffer.from(JSON.stringify(pack));}if(broken)files.find(file=>file.name==='app/server.mjs').data=Buffer.from("throw Error('injected new startup failure');");const zip=makeZip(files),name=`KeilDebugAssistant-v${version}-windows.zip`,base=`https://github.com/${repository}/releases/download/v${version}/`;return {zip,name,digest:hash(zip),release:{tag_name:'v'+version,assets:[name,name+'.sha256'].map(name=>({name,browser_download_url:base+name}))}};}
async function cleanup(dir){const path=resolve(dir),prefix=resolve(tmpdir())+sep;assert.ok(path.startsWith(prefix)&&path.slice(prefix.length).startsWith('keil-update-test-'));await rm(path,{recursive:true,force:true,maxRetries:8,retryDelay:200});}

for(const {automatic,broken=false,tampered=false} of [{automatic:false},{automatic:true},{automatic:true,broken:true},{automatic:true,tampered:true}])test(`HTTP ${tampered?'recovery after rejected staged':broken?'rollback after failed automatic':automatic?'automatic':'manual'} update stages during Keil monitoring, then installs/restarts on disconnect while preserving all user data`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-update-test-'));let child,base,ownedRuntime,restartedPid,log='';
 try{
  const fixture=await prepareFixture(dir),pack=await packageFor('2.2.0',broken);await mkdir(join(dir,'userdata'),{recursive:true});await writeFile(join(dir,'userdata/updates.json'),JSON.stringify({automatic}));
  await writeFile(join(dir,'update-fixture.json'),JSON.stringify(pack.release));await writeFile(join(dir,'update-fixture.zip'),pack.zip);await writeFile(join(dir,'update-fixture.sha256'),pack.digest+'  '+pack.name+'\n');
  const path=join(dir,'app/server.mjs'),code=await readFile(path,'utf8');await writeFile(path,code.replace('new Updater({version,',`new Updater({firstDelay:2147483647,fetch:async url=>new Response(await readFile(new URL(url.endsWith('/latest')?'update-fixture.json':url.endsWith('.sha256')?'update-fixture.sha256':'update-fixture.zip',home))),version,`));
  if(tampered){const installerPath=join(dir,'app/lib/update-installer.mjs');await writeFile(installerPath,(await readFile(installerPath,'utf8')).replaceAll('await verifyStage(plan);','await new Promise(r=>setTimeout(r,350));await verifyStage(plan);'));}
  child=spawn(process.execPath,['app/server.mjs'],{cwd:dir,env:{...process.env,PORT:'0',KDA_UPDATE_DISABLED:'0'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  let state;
  for(let i=0;i<100;i++){try{ownedRuntime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));base='http://127.0.0.1:'+ownedRuntime.port;state=await(await fetch(base+'/api/state')).json();break;}catch{await pause(30);}}assert.ok(state,log);
  async function post(name,data={}){for(let i=0;i<100;i++){const response=await fetch(base+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({sessionId:state.sessionId,sessionKey:state.sessionKey,...data})}),body=await response.json();if(response.status===409){await pause(25);continue;}assert.equal(response.status,200,JSON.stringify(body));return state=body;}throw Error('Busy');}
  async function until(check){for(let i=0;i<300;i++){try{const response=await fetch(base+'/api/state',{signal:AbortSignal.timeout(500)});if(response.ok){state=await response.json();if(check(state))return state;}}catch{}await pause(30);}throw Error('Update did not converge: '+JSON.stringify(state.update)+' '+log);}
  await post('interval',{interval:100});await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});await until(s=>s.status==='running');await post('items',{items:[{name:'pid',min:0,max:10,step:0.1}]});await until(s=>s.items[0]?.children.every(row=>row.updated));
  await post('data/save',{root:'pid'});await until(s=>s.dataJob?.status==='done');const layout={mode:'free',widgets:{pid:{x:15,y:20,width:480,height:380}}};await post('layout',{layout});await post('preferences',{preferences:{theme:'violet',collapsed:true}});
  const checkStart=performance.now();await post('update/check');assert.ok(performance.now()-checkStart<700);await until(s=>s.update.phase===(automatic?'ready':'available'));assert.equal(state.update.latestVersion,'2.2.0');
  const before=state.items[0].children[0].updated;if(!automatic)await post('update/install');await until(s=>s.update.phase==='ready');assert.equal(state.update.waitingForDisconnect,true);await until(s=>s.items[0].children[0].updated>before);assert.equal(state.version,'2.1.0');assert.equal(state.status,'running');assert.equal(child.exitCode,null,'updater interrupted an active Keil connection');
  if(tampered){const staged=JSON.parse(await readFile(join(dir,'data/updates/pending.json'),'utf8'));await writeFile(join(dir,'data/updates',staged.job,'payload/app/server.mjs'),'changed after verification');}
  if(automatic)await fetch(base+'/api/state',{headers:{'X-Keil-UI-Editing':'1'}});
  await post('connect',{mode:'disconnected'});const panel=await readFile(join(dir,'userdata/panel.json'),'utf8');const oldPid=ownedRuntime.pid;
  if(automatic){await pause(200);assert.equal((await(await fetch(base+'/api/state')).json()).version,'2.1.0','update reloaded an active editor');}await until(s=>broken||tampered?s.version==='2.1.0'&&s.update.phase==='error':s.version==='2.2.0');ownedRuntime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));restartedPid=ownedRuntime.pid;if(tampered)assert.equal(ownedRuntime.pid,oldPid);else assert.notEqual(ownedRuntime.pid,oldPid);assert.equal(state.status,'disconnected');assert.deepEqual(state.layout,layout);assert.equal(state.preferences.theme,'violet');assert.equal(state.items[0].savedData.count,2);assert.equal(await readFile(join(dir,'userdata/panel.json'),'utf8'),panel);assert.equal(JSON.parse(await readFile(join(dir,'userdata/updates.json'),'utf8')).automatic,automatic);
  if(!tampered)await until(()=>child.exitCode===0);const pending=JSON.parse(await readFile(join(dir,'data/updates/pending.json'),'utf8'));if(!broken&&!tampered)assert.ok(await readFile(join(dir,'data/updates',pending.job,'backup/app/server.mjs'),'utf8'));else{assert.match(state.update.error,tampered?/已改变/:/启动验证失败/);assert.equal(state.update.staged,false);}
  if(tampered){await post('connect',{mode:'keil',port:fixture.port,selection:String(fixture.port)});await until(s=>s.status==='running'&&s.items[0]?.children?.every(row=>row.updated));await post('connect',{mode:'disconnected'});}
  let installed=tampered;for(let i=0;!installed&&i<100;i++){try{installed=JSON.parse(await readFile(join(dir,'data/updates/result.json'),'utf8')).status===(broken?'error':'installed');if(installed)break;}catch{}await pause(30);}assert.ok(installed,'installer never confirmed its startup health check');
  const shutdownResponse=await fetch(base+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({token:ownedRuntime.token})});assert.equal(shutdownResponse.status,200);ownedRuntime=null;
 }catch(e){console.error('UPDATE FLOW FAILURE:',e);throw e;}finally{
  if(base){try{const runtime=JSON.parse(await readFile(join(dir,'data/runtime.json'),'utf8'));await fetch(base+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({token:runtime.token}),signal:AbortSignal.timeout(1000)});}catch{}}
  if(child&&child.exitCode===null){child.kill();await once(child,'exit');}if(restartedPid){for(let i=0;i<30;i++){let alive;try{process.kill(restartedPid,0);alive=true;}catch{alive=false;}if(!alive)break;await pause(100);}try{process.kill(restartedPid,'SIGKILL');}catch{}}await pause(200);await cleanup(dir);
 }
});

test('failed new startup rolls program files back and never overwrites userdata; tampered stages are refused',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'keil-update-test-'));
 try{
  await prepareFixture(dir);await mkdir(join(dir,'userdata'),{recursive:true});await mkdir(join(dir,'data/updates'),{recursive:true});const panel='{"pid":[2.34,1.51],"layout":"keep"}';await writeFile(join(dir,'userdata/panel.json'),panel);
  const pack=await packageFor('2.2.0'),jobDir=join(dir,'data/updates/stage-11111111-1111-4111-8111-111111111111');await stagePackage({archive:pack.zip,digest:pack.digest,version:'2.2.0',jobDir});
  const plan={root:dir,jobDir,userDir:join(dir,'userdata'),dataDir:join(dir,'data'),port:3210,version:'2.2.0',previous:'2.1.0'},starts=[];
  assert.equal(await applyUpdate(plan,{start:async()=>{starts.push(JSON.parse(await readFile(join(dir,'package.json'),'utf8')).version);return {exitCode:0};},check:async(_plan,_child,version)=>version==='2.1.0'}),false);
  assert.deepEqual(starts,['2.2.0','2.1.0']);assert.equal(JSON.parse(await readFile(join(dir,'package.json'),'utf8')).version,'2.1.0');assert.equal(await readFile(join(dir,'userdata/panel.json'),'utf8'),panel);assert.equal(JSON.parse(await readFile(join(dir,'data/updates/result.json'),'utf8')).status,'error');
  const next=join(dir,'data/updates/stage-22222222-2222-4222-8222-222222222222');await stagePackage({archive:pack.zip,digest:pack.digest,version:'2.2.0',jobDir:next});await writeFile(join(next,'payload/app/server.mjs'),'changed');await assert.rejects(verifyStage({...plan,jobDir:next}),/已改变/);assert.equal(JSON.parse(await readFile(join(dir,'package.json'),'utf8')).version,'2.1.0');
 }finally{await cleanup(dir);}
});
