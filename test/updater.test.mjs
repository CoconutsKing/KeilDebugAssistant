import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {makeZip} from '../scripts/release.mjs';
import {Updater} from '../app/lib/updater.mjs';
import {releaseInfo,newerVersion,hash,unpackRelease,allowedFile,checksumValue,repository,requiredFiles} from '../app/lib/update-package.mjs';
import {stagePackage} from '../app/lib/update-stage.mjs';
import {updateView,createUpdates} from '../app/public/updates.js';

export function sampleRelease(version='2.2.0'){
 const name=`KeilDebugAssistant-v${version}-windows.zip`,base=`https://github.com/${repository}/releases/download/v${version}/`;
 const files=requiredFiles.map(name=>({name,data:Buffer.from(name==='package.json'?JSON.stringify({name:'keil-debug-assistant',version}):'// '+name)}));
 files.push({name:'userdata/README.md',data:Buffer.from('clean release')});const zip=makeZip(files),digest=hash(zip);
 return {zip,digest,files,name,release:{tag_name:'v'+version,draft:false,prerelease:false,assets:[{name,size:zip.length,browser_download_url:base+name,digest:'sha256:'+digest},{name:name+'.sha256',browser_download_url:base+name+'.sha256'}]}};
}
async function temporary(run){const dir=await mkdtemp(join(tmpdir(),'keil-update-test-'));try{await mkdir(join(dir,'userdata'));await mkdir(join(dir,'data'));return await run(dir);}finally{const path=resolve(dir),prefix=resolve(tmpdir())+sep;assert.ok(path.startsWith(prefix)&&path.slice(prefix.length).startsWith('keil-update-test-'));await rm(path,{recursive:true,force:true,maxRetries:4,retryDelay:100});}}

test('only newer stable releases and exact repository assets are accepted',()=>{
 assert.ok(newerVersion('v2.10.0','2.9.9'));assert.ok(!newerVersion('2.0.9','2.1.0'));assert.ok(!newerVersion('2.1.0','2.1.0'));
 for(const version of ['2.2.0-beta.1','2.2','v2.2.0/../','02.2.0'])assert.throws(()=>newerVersion(version,'2.1.0'));
 const {release,digest,name}=sampleRelease();assert.equal(releaseInfo(release).version,'2.2.0');assert.equal(checksumValue(digest+'  '+name+'\n',name),digest);
 assert.throws(()=>releaseInfo({...release,prerelease:true}));assert.throws(()=>releaseInfo({...release,assets:release.assets.slice(0,1)}));assert.throws(()=>releaseInfo({...release,assets:release.assets.map(a=>({...a,browser_download_url:a.browser_download_url.replace('CoconutsKing','SomeoneElse')}))}));
 assert.throws(()=>checksumValue(digest+'  unrelated.zip',name));
});

test('ZIP validation rejects damaged data, traversal, private files, duplicates and wrong versions',()=>{
 const {zip,files}=sampleRelease();assert.equal(unpackRelease(zip,'2.2.0').length,requiredFiles.length);assert.ok(!unpackRelease(zip,'2.2.0').some(f=>f.name.startsWith('userdata/')));
 const bad=Buffer.from(zip);bad[50]^=1;assert.throws(()=>unpackRelease(bad,'2.2.0'));assert.throws(()=>unpackRelease(zip,'2.3.0'));
 for(const name of ['../app/evil.js','app/../../evil.js','app\\evil.js','userdata/panel.json','data/runtime.json','.git/config','app/CON.js','app/evil.']){
  assert.equal(allowedFile(name),false);assert.throws(()=>unpackRelease(makeZip([...files,{name,data:Buffer.from('x')}]),'2.2.0'));
 }
 assert.throws(()=>unpackRelease(makeZip([...files,{name:'APP/SERVER.MJS',data:Buffer.from('duplicate')}]),'2.2.0'));
});

test('silent checks coalesce, stage verified downloads off the target lock and wait for disconnection',()=>temporary(async dir=>{
 const fixture=sampleRelease();let connected=true,installs=0,requests=0,releaseRequests=0;let respond;
 const fetch=async url=>{requests++;if(url.endsWith('/latest')){releaseRequests++;await new Promise(r=>respond=r);return new Response(JSON.stringify(fixture.release));}return new Response(url.endsWith('.sha256')?fixture.digest+'  '+fixture.name+'\n':fixture.zip);};
 const updater=new Updater({version:'2.1.0',userDir:join(dir,'userdata'),dataDir:join(dir,'data'),fetch,stage:stagePackage,canInstall:()=>!connected,install:async()=>{installs++;return false;}});await updater.init();
 const a=updater.check(),b=updater.check();assert.equal(a,b);assert.equal(updater.snapshot().phase,'checking');respond();await a;
 assert.equal(releaseRequests,1);assert.equal(requests,3);assert.equal(updater.snapshot().phase,'ready');assert.equal(updater.snapshot().waitingForDisconnect,true);await updater.maybeInstall();assert.equal(installs,0);
 await updater.setAutomatic(false);connected=false;await updater.maybeInstall();assert.equal(installs,0);updater.requestInstall();await new Promise(r=>setTimeout(r,0));assert.equal(installs,1);
 const settings=JSON.parse(await readFile(join(dir,'userdata/updates.json'),'utf8'));assert.equal(settings.automatic,false);updater.close();
 const restarted=new Updater({version:'2.1.0',userDir:join(dir,'userdata'),dataDir:join(dir,'data'),canInstall:()=>true});await restarted.init();assert.equal(restarted.snapshot().automatic,false);assert.equal(restarted.snapshot().staged,true);restarted.close();
}));

test('manual updates work with automatic installation off; offline and corrupt downloads remain isolated',()=>temporary(async dir=>{
 const fixture=sampleRelease();let offline=true,corrupt=false;
 const fetch=async url=>{if(offline)throw Error('offline');if(url.endsWith('/latest'))return new Response(JSON.stringify(fixture.release));return new Response(url.endsWith('.sha256')?fixture.digest+'  '+fixture.name+'\n':corrupt?Buffer.from('damaged'):fixture.zip);};
 const updater=new Updater({version:'2.1.0',userDir:join(dir,'userdata'),dataDir:join(dir,'data'),fetch,stage:stagePackage,canInstall:()=>false});await updater.init();await updater.setAutomatic(false);
 await updater.check();assert.equal(updater.snapshot().phase,'error');assert.match(updater.snapshot().error,/offline/);
 offline=false;await updater.check();assert.equal(updater.snapshot().phase,'available');assert.equal(updater.snapshot().staged,false);
 corrupt=true;updater.requestInstall();await updater.work;assert.equal(updater.snapshot().phase,'error');assert.equal(updater.snapshot().staged,false);
 corrupt=false;updater.requestInstall();await updater.work;assert.equal(updater.snapshot().phase,'ready');assert.equal(updater.snapshot().requested,true);updater.close();
}));

test('API throttling uses the same repository public Release redirect without credentials',()=>temporary(async dir=>{
 const fixture=sampleRelease(),seen=[];const updater=new Updater({version:'2.2.0',userDir:join(dir,'userdata'),dataDir:join(dir,'data'),fetch:async(url,options)=>{seen.push({url,options});return url.startsWith('https://api.')?new Response('',{status:403}):new Response(null,{status:302,headers:{location:`https://github.com/${repository}/releases/tag/v2.2.0`}});}});await updater.init();await updater.check();assert.equal(updater.snapshot().phase,'current');assert.equal(seen.length,2);assert.equal(seen[1].options.method,'HEAD');assert.ok(seen.every(({options})=>!options.headers.Authorization));updater.close();
}));

test('update messages distinguish quiet checks, queued installs, manual mode and errors',()=>{
 assert.equal(updateView({phase:'checking'}).busy,true);assert.equal(updateView({phase:'idle'}).badge,false);assert.match(updateView({phase:'ready',waitingForDisconnect:true}).message,/调试继续运行/);assert.match(updateView({phase:'ready',automatic:false}).message,/点击/);assert.equal(updateView({phase:'error',error:'network'}).error,'network');assert.equal(updateView({phase:'available',latestVersion:'2.2.0'}).canInstall,true);
});

test('manual action errors remain visible after polling renders and settings can be retried',async()=>{
 const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,{classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);}};
 let fail=true,controller;const state={phase:'current',currentVersion:'2.1.0',latestVersion:'2.0.9',canUpdate:false,automatic:true};
 controller=createUpdates({document,api:async()=>{if(fail)throw Error('local service unavailable');},render:()=>controller.update(state)});controller.update(state);
 elements.get('checkUpdate').onclick();await new Promise(r=>setTimeout(r,0));controller.update(state);assert.match(elements.get('updateError').textContent,/local service unavailable/);assert.equal(elements.get('installUpdate').disabled,true);
 fail=false;elements.get('checkUpdate').onclick();await new Promise(r=>setTimeout(r,0));assert.equal(elements.get('updateError').textContent,'');assert.equal(elements.get('checkUpdate').disabled,false);
});
