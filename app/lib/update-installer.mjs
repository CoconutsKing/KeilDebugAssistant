// Copied beside the staged package before the old server exits. All imports then
// live outside app/, so replacing app/ cannot change the running installer.
import {readFile,writeFile,mkdir,rename,lstat,rm,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,installable,installUnits,requiredFiles,versionParts} from './update-package.mjs';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
function inside(root,target){const path=relative(resolve(root),resolve(target));if(!path||path==='..'||path.startsWith('..'+sep)||path.includes(':')||path.startsWith(sep))throw Error('更新路径超出安装目录');return resolve(target);}
async function plain(root,target){inside(root,target);let path=resolve(root);for(const part of relative(path,resolve(target)).split(sep)){path=join(path,part);try{if((await lstat(path)).isSymbolicLink())throw Error('更新路径不能是符号链接或目录联接');}catch(e){if(e.code!=='ENOENT')throw e;}}}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function move(from,to){for(let attempt=0;;attempt++){try{await rename(from,to);return;}catch(e){if(attempt===4||!['EPERM','EBUSY','EACCES'].includes(e.code))throw e;await pause(200);}}}
async function result(plan,value){const directory=join(plan.dataDir,'updates');await mkdir(directory,{recursive:true});const path=join(directory,'result.json');await writeFile(path+'.tmp',JSON.stringify({...value,at:Date.now()}));await move(path+'.tmp',path);}
export async function verifyStage(plan){
 const root=resolve(plan.root),job=resolve(plan.jobDir);inside(join(plan.dataDir,'updates'),job);await plain(plan.dataDir,job);
 const manifest=JSON.parse(await readFile(join(job,'manifest.json'),'utf8'));versionParts(manifest.version);
 if(manifest.version!==plan.version||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>1024)throw Error('暂存更新清单无效');
 const names=new Set();for(const file of manifest.files){
  if(!installable(file.name)||names.has(file.name.toLowerCase())||!/^[a-f0-9]{64}$/.test(file.hash))throw Error('暂存更新文件无效');names.add(file.name.toLowerCase());
  const path=join(job,'payload',...file.name.split('/'));await plain(join(job,'payload'),path);if(hash(await readFile(path))!==file.hash)throw Error('暂存更新已改变，请重新下载');
 }
 if(requiredFiles.some(name=>!names.has(name.toLowerCase())))throw Error('暂存更新缺少启动文件');
 const pack=JSON.parse(await readFile(join(job,'payload','package.json'),'utf8'));if(pack.version!==plan.version||pack.name!=='keil-debug-assistant')throw Error('暂存版本不一致');
 for(const unit of installUnits)await plain(root,join(root,...unit.split('/')));
 return manifest;
}
export async function replaceProgram(plan){
 await verifyStage(plan);const journal=[],backup=join(plan.jobDir,'backup');await mkdir(backup);
 const record=()=>writeFile(join(plan.jobDir,'transaction.json'),JSON.stringify(journal));
 async function rollback(){
  const errors=[];for(const entry of [...journal].reverse()){try{
   const target=join(plan.root,...entry.unit.split('/')),saved=join(backup,...entry.unit.split('/'));await plain(plan.root,target);
   // Recursive removal is limited to an installed managed unit within this root.
   if(entry.installed&&await exists(target)){inside(plan.root,target);await rm(target,{recursive:true,force:true,maxRetries:4,retryDelay:200});}
   if(entry.backedUp&&await exists(saved)){await mkdir(join(target,'..'),{recursive:true});await move(saved,target);}
  }catch(e){errors.push(entry.unit+'：'+e.message);}}
  if(errors.length)throw Error('回滚失败：'+errors.join('；'));
 }
 try{
  for(const unit of installUnits){
   const target=join(plan.root,...unit.split('/')),source=join(plan.jobDir,'payload',...unit.split('/')),saved=join(backup,...unit.split('/'));if(!await exists(source))continue;
   const entry={unit,backedUp:false,installed:false};journal.push(entry);await record();
   if(await exists(target)){await mkdir(join(saved,'..'),{recursive:true});await move(target,saved);entry.backedUp=true;await record();}
   await mkdir(join(target,'..'),{recursive:true});await move(source,target);entry.installed=true;await record();
  }
  return {rollback};
 }catch(e){try{await rollback();}catch(failure){throw Error(e.message+'；'+failure.message);}throw e;}
}
export async function launchServer(plan){
 const log=await open(join(plan.jobDir,'restart.log'),'a');try{const child=spawn(process.execPath,[join(plan.root,'app','server.mjs')],{cwd:plan.root,windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PORT:String(plan.port),KDA_USER_DIR:plan.userDir,KDA_DATA_DIR:plan.dataDir,KDA_NO_BROWSER:'1'}});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return child;}finally{await log.close();}
}
export async function healthy(plan,child,version){
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)return false;
  try{const runtime=JSON.parse(await readFile(join(plan.dataDir,'runtime.json'),'utf8'));if(runtime.pid===child.pid){const response=await fetch(`http://127.0.0.1:${plan.port}/api/state`,{signal:AbortSignal.timeout(500)});if(response.ok&&(await response.json()).version===version)return true;}}catch{}
  await pause(150);
 }return false;
}
async function stopChild(child){if(!child||child.exitCode!==null)return;child.kill();for(let i=0;i<30&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)throw Error('新服务尚未退出，未替换正在使用的程序文件');}
export async function applyUpdate(plan,{start=launchServer,check=healthy}={}){
 let transaction,child;try{
  transaction=await replaceProgram(plan);child=await start(plan);if(!await check(plan,child,plan.version))throw Error('新版本启动验证失败');
  await result(plan,{status:'installed',version:plan.version,previous:plan.previous});return true;
 }catch(error){
  let message=error.message;
  try{await stopChild(child);if(transaction)await transaction.rollback();await result(plan,{status:'error',version:plan.version,error:message});const previous=await start(plan);if(!await check(plan,previous,plan.previous))throw Error('旧版本启动验证失败');}catch(e){message+='；'+e.message;}
  await result(plan,{status:'error',version:plan.version,error:message});return false;
 }
}
async function run(path){
 const plan=JSON.parse(await readFile(path,'utf8'));await verifyStage(plan);
 if(!Number.isInteger(plan.pid)||plan.pid===process.pid||plan.pid<1||!Number.isInteger(plan.port)||plan.port<1||plan.port>65535)throw Error('更新启动参数无效');
 process.send?.({ready:true});await new Promise((resolve,reject)=>{const disconnected=()=>reject(Error('原服务未提交安装，更新已取消'));process.once('disconnect',disconnected);process.once('message',message=>{if(message?.apply){process.removeListener('disconnect',disconnected);resolve();}else reject(Error('安装请求无效'));});});if(process.connected)process.disconnect();
 for(let i=0;i<100;i++){let alive;try{process.kill(plan.pid,0);alive=true;}catch{alive=false;}if(!alive){await applyUpdate(plan);return;}await pause(200);}
 await result(plan,{status:'error',version:plan.version,error:'原服务尚未退出，未替换程序文件'});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv[2]).catch(e=>{process.send?.({error:e.message});console.error(e.message);process.exitCode=1;});
