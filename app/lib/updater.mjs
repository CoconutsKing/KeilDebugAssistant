import {readFile,writeFile,mkdir,rename,copyFile,open} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {fork} from 'node:child_process';
import {repository,releasePage,archiveLimit,releaseInfo,newerVersion,checksumValue,hash,versionParts} from './update-package.mjs';

const latestAPI=`https://api.github.com/repos/${repository}/releases/latest`;
const assetHosts=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
async function atomic(path,value){await writeFile(path+'.tmp',JSON.stringify(value,null,2));for(let i=0;;i++){try{await rename(path+'.tmp',path);return;}catch(e){if(i===4||!['EPERM','EBUSY','EACCES'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,50));}}}
export function stageInWorker(data){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./update-stage.mjs',import.meta.url),{workerData:data});
 worker.once('message',message=>message.error?reject(Error(message.error)):resolve(message.result));worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('更新解压任务退出：'+code));});
 });}
export async function startInstaller(plan){
 await atomic(join(plan.jobDir,'install.json'),plan);
 for(const name of ['update-installer.mjs','update-package.mjs'])await copyFile(new URL(name,import.meta.url),join(plan.jobDir,name));
 const log=await open(join(plan.jobDir,'installer.log'),'a');let child;
 try{child=fork(join(plan.jobDir,'update-installer.mjs'),[join(plan.jobDir,'install.json')],{cwd:plan.root,windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd,'ipc']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('更新安装器未能就绪')),8000);const finish=(error)=>{clearTimeout(timer);child.removeListener('error',fail);child.removeListener('exit',exit);child.removeListener('message',message);error?reject(error):resolve();};const fail=e=>finish(e),exit=()=>finish(Error('更新安装器已退出')),message=m=>{if(m.ready)finish();else if(m.error)finish(Error(m.error));};child.once('error',fail);child.once('exit',exit);child.on('message',message);});
  return {apply:()=>new Promise((resolve,reject)=>child.send({apply:true},error=>{if(error){reject(error);return;}child.unref();child.channel?.unref();resolve();})),cancel:()=>child.kill()};
 }catch(e){child?.kill();throw e;}finally{await log.close();}
}

export class Updater{
 constructor({version,userDir,dataDir,fetch:request=globalThis.fetch,stage=stageInWorker,install=async()=>false,canInstall=()=>false,blockedReason=()=>'',now=Date.now,firstDelay=15000,checkInterval=6*60*60*1000}={}){
  this.version=version;this.userDir=userDir;this.dataDir=dataDir;this.fetch=request;this.stage=stage;this.install=install;this.canInstall=canInstall;this.blockedReason=blockedReason;this.now=now;this.firstDelay=firstDelay;this.checkInterval=checkInterval;
  this.state={automatic:true,phase:'idle',currentVersion:version,latestVersion:'',checkedAt:0,error:'',staged:false,requested:false,releaseURL:releasePage};this.work=null;this.closed=false;this.settingsQueue=Promise.resolve();
 }
 async init(){
  await mkdir(join(this.dataDir,'updates'),{recursive:true});
  try{this.state.automatic=JSON.parse(await readFile(join(this.userDir,'updates.json'),'utf8')).automatic!==false;}catch{}
  try{const saved=JSON.parse(await readFile(join(this.dataDir,'updates','pending.json'),'utf8'));if(/^stage-[a-f0-9-]{36}$/.test(saved.job)&&newerVersion(saved.release.tag_name,this.version)){
   this.info=releaseInfo(saved.release);this.staged={jobDir:join(this.dataDir,'updates',saved.job),version:this.info.version};Object.assign(this.state,{latestVersion:this.info.version,releaseURL:this.info.page,staged:true,phase:'ready'});
  }}catch{}
  try{const result=JSON.parse(await readFile(join(this.dataDir,'updates','result.json'),'utf8'));if(result.status==='error'&&newerVersion(result.version,this.version)){this.staged=null;Object.assign(this.state,{phase:'error',error:result.error,staged:false});}}catch{}
 }
 snapshot(){return {...this.state,canUpdate:!!this.info&&newerVersion(this.info.version,this.version),waitingForDisconnect:this.state.staged&&!this.canInstall(),waitingReason:this.blockedReason()};}
 start(){this.first=setTimeout(()=>void this.check(),this.firstDelay);this.first.unref?.();this.periodic=setInterval(()=>void this.check(),this.checkInterval);this.periodic.unref?.();this.installer=setInterval(()=>void this.maybeInstall(),1000);this.installer.unref?.();}
 close(){this.closed=true;clearTimeout(this.first);clearInterval(this.periodic);clearInterval(this.installer);this.controller?.abort();}
 async setAutomatic(value){
  if(typeof value!=='boolean')throw Error('自动更新设置无效');
  const persist=()=>atomic(join(this.userDir,'updates.json'),{automatic:value});this.settingsQueue=this.settingsQueue.catch(()=>{}).then(persist);await this.settingsQueue;this.state.automatic=value;
  if(value){if(this.state.phase==='available')void this.download();else void this.maybeInstall();}
 }
 async response(url,{limit=512*1024,timeout=10000,method='GET',headers={}}={}){
  const controller=new AbortController();this.controller=controller;const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await this.fetch(url,{method,headers:{'User-Agent':'KeilDebugAssistant/'+this.version,...headers},signal:controller.signal,redirect:method==='HEAD'?'manual':'follow'});
   if(response.url){const final=new URL(response.url);if(final.protocol!=='https:'||!assetHosts.has(final.hostname)&&final.hostname!=='api.github.com')throw Error('更新响应来源无效');}
   if(method==='HEAD')return {response};
   if(response.status===304)return {response};
   if(!response.ok){await response.body?.cancel();const error=Error(response.status===403||response.status===429?'GitHub 请求频率受限，请稍后重试':`GitHub 请求失败（HTTP ${response.status}）`);error.httpStatus=response.status;throw error;}
   if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('更新文件超过大小限制');}
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit){controller.abort();throw Error('更新文件超过大小限制');}chunks.push(chunk);}
   return {response,bytes:Buffer.concat(chunks)};
  }catch(e){if(controller.signal.aborted&&(e.name==='AbortError'||e.name==='TimeoutError'||e===controller.signal.reason))throw Error(this.closed?'更新检查已停止':'连接 GitHub 超时，请检查网络后重试');throw e;}
  finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
 }
 async latest(){
  try{
   const {response,bytes}=await this.response(latestAPI,{headers:{Accept:'application/vnd.github+json',...(this.etag?{'If-None-Match':this.etag}:{})}});
   if(response.status===304&&this.release)return this.release;
   const release=JSON.parse(bytes.toString());releaseInfo(release);this.etag=response.headers.get('etag');return release;
  }catch(e){
   if(![403,429].includes(e.httpStatus))throw e;
   // Public Release redirects remain usable when the shared API rate limit is hit.
   const {response}=await this.response(releasePage+'/latest',{method:'HEAD'}),location=response.headers.get('location'),url=location&&new URL(location,releasePage);
   if(![301,302,307,308].includes(response.status)||url?.origin!=='https://github.com'||!url.pathname.startsWith('/'+repository+'/releases/tag/'))throw e;
   const tag=url.pathname.slice(('/'+repository+'/releases/tag/').length);const version=versionParts(tag).join('.'),name=`KeilDebugAssistant-v${version}-windows.zip`,prefix=`https://github.com/${repository}/releases/download/${tag}/`;
   return {tag_name:tag,assets:[name,name+'.sha256'].map(name=>({name,browser_download_url:prefix+name}))};
  }
 }
 check(){
  if(this.closed||this.state.phase==='installing')return Promise.resolve();if(this.work)return this.work;
  this.work=(async()=>{
   const previous=this.state.phase;this.state.phase='checking';this.state.error='';
   try{
    const release=await this.latest();if(this.closed)return;this.release=release;this.info=releaseInfo(release);this.state.checkedAt=this.now();this.state.latestVersion=this.info.version;this.state.releaseURL=this.info.page;
    if(!newerVersion(this.info.version,this.version)){this.state.phase='current';this.state.staged=false;return;}
    this.state.phase=this.staged?.version===this.info.version?'ready':'available';this.state.staged=this.state.phase==='ready';
    if(!this.state.staged&&(this.state.automatic||this.state.requested))await this.performDownload();
   }catch(e){if(!this.closed){this.state.error=e.message;this.state.phase=this.state.staged?'ready':'error';}}
   finally{if(this.closed)this.state.phase=previous;this.work=null;}
  })();return this.work;
 }
 async performDownload(){
  this.state.phase='downloading';this.state.error='';
  const info=this.info,{bytes:sum}=await this.response(info.checksumURL,{limit:1024}),digest=checksumValue(sum.toString(),info.name);
  if(info.digest&&info.digest.toLowerCase()!=='sha256:'+digest)throw Error('GitHub 附件摘要与 SHA256 文件不一致');
  const {bytes:archive}=await this.response(info.url,{limit:archiveLimit,timeout:120000});
  if(info.size&&archive.length!==info.size||hash(archive)!==digest)throw Error('更新包下载不完整或 SHA256 校验失败');
  if(this.closed)return;const jobDir=join(this.dataDir,'updates','stage-'+randomUUID());this.staged=await this.stage({archive,digest,version:info.version,jobDir});if(this.closed)return;
  await atomic(join(this.dataDir,'updates','pending.json'),{job:basename(jobDir),release:this.release});this.state.staged=true;this.state.phase='ready';
 }
 download(){
  if(this.closed||this.work||!this.info)return this.work||Promise.resolve();
  this.work=this.performDownload().catch(e=>{if(!this.closed){this.state.phase='error';this.state.error=e.message;}}).finally(()=>{this.work=null;});return this.work;
 }
 requestInstall(){
  if(this.state.phase==='installing')return;
  if(!this.info||!newerVersion(this.info.version,this.version))throw Error('请先检查更新，当前没有可安装的新版本');
  this.state.requested=true;this.state.error='';
  if(this.state.staged){this.state.phase='ready';void this.maybeInstall();}
  else if(this.info&&newerVersion(this.info.version,this.version))void this.download();else void this.check();
 }
 async maybeInstall(){
  if(this.closed||this.work||this.state.phase!=='ready'||!this.state.staged||!this.canInstall()||!this.state.automatic&&!this.state.requested)return;
  this.state.phase='installing';
  try{if(await this.install(this.staged,this.info)===false)this.state.phase='ready';}
  catch(e){this.state.phase='error';this.state.error=e.message;this.state.requested=false;this.state.staged=false;this.staged=null;}
 }
}
