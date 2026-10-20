import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {UVSock} from './uvsock.mjs';
const run=promisify(execFile);
export function parseListeners(text){return text.split(/\r?\n/).flatMap(line=>{const m=line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);return m?[{port:Number(m[1]),pid:Number(m[2])}]:[];});}
export function sessionsFrom(processes,listeners){return processes.flatMap(p=>{const ports=[...new Set(listeners.filter(l=>l.pid===p.pid).map(l=>l.port))];const project=p.title?.match(/([A-Z]:\\.*?\.uv(?:projx?|mpwx?))/i)?.[1]||p.project||'';return (ports.length?ports:[null]).map(port=>({pid:p.pid,port,title:p.title||project.split(/[\\/]/).at(-1)||'Keil µVision',project,executable:p.executable||'',status:port?'unknown':'no-port'}));});}
export async function discoverSessions({signal}={}){
 if(process.platform!=='win32')return [];
 const [{stdout},{stdout:net}]=await Promise.all([run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../scripts/discover.ps1',import.meta.url))],{windowsHide:true,timeout:8000,maxBuffer:1024*1024,signal}),run('netstat.exe',['-ano','-p','tcp'],{windowsHide:true,timeout:8000,signal})]);
 const data=JSON.parse(stdout.replace(/^\uFEFF/,'').trim()||'[]');return sessionsFrom(Array.isArray(data)?data:[data],parseListeners(net));
}
// Never move away from a working session: pending writes always belong to the displayed target.
export function chooseSession(sessions,currentPort,selection='auto'){
 const available=sessions.filter(s=>s.port);
 if(selection!=='auto')return available.find(s=>s.port===Number(selection))||null;
 return available.find(s=>s.port===currentPort&&['running','halted'].includes(s.status))||available.find(s=>['running','halted'].includes(s.status))||available.find(s=>s.port===currentPort)||available[0]||null;
}
export class SessionPool{
 constructor({discover=discoverSessions,create=()=>new UVSock(),scanInterval=15000}={}){
  this.discover=discover;this.create=create;this.scanInterval=scanInterval;this.clients=new Map();this.sessions=[];this.scanned=0;this.scanMs=0;this.error='';this.discovering=false;this.hasDiscovered=false;this.discovery=null;this.pendingSessions=null;this.generation=0;
 }
 // Process enumeration is slow on Windows. It must never own the Keil request lock.
 scan(force=false){
  if(this.discovery)return this.discovery;
  if(!force&&this.hasDiscovered&&Date.now()-this.scanned<this.scanInterval)return Promise.resolve();
  const generation=this.generation,started=Date.now(),controller=new AbortController();this.scanController=controller;this.discovering=true;
  this.discovery=Promise.resolve().then(()=>this.discover({signal:controller.signal})).then(sessions=>{if(generation!==this.generation)return;this.pendingSessions=sessions;this.error='';}).catch(error=>{if(generation===this.generation)this.error='窗口识别失败，可填写端口手动连接：'+error.message;}).finally(()=>{if(generation!==this.generation)return;this.scanned=Date.now();this.scanMs=this.scanned-started;this.hasDiscovered=true;this.discovering=false;this.discovery=null;this.scanController=null;});
  return this.discovery;
 }
 applyDiscovered(extraPort){
  if(this.pendingSessions){
   const previous=this.sessions;this.sessions=this.pendingSessions.map(session=>{const prior=previous.find(s=>s.port===session.port&&s.pid===session.pid);return prior?{...session,status:prior.status,error:prior.error}:session;});this.pendingSessions=null;
   const ports=new Set(this.sessions.filter(s=>s.port).map(s=>s.port));
   for(const [port,c] of this.clients){const before=previous.find(s=>s.port===port),after=this.sessions.find(s=>s.port===port);if(!ports.has(port)||(before?.pid&&after?.pid&&before.pid!==after.pid)){c.close();this.clients.delete(port);}}
  }
  if(extraPort&&!this.sessions.some(s=>s.port===extraPort))this.sessions.push({port:extraPort,pid:null,title:'手动端口 '+extraPort,project:'',status:'unknown'});
 }
 async refresh(extraPort=4823,force=false){
  void this.scan(force);this.applyDiscovered(extraPort);
  for(const s of this.sessions){
   if(!s.port)continue;let c=this.clients.get(s.port);
   try{if(!c||c.socket?.destroyed){c?.close();c=this.create();this.clients.set(s.port,c);await c.connect(s.port);}s.status=await c.status();s.error='';}
   catch(e){s.status=e.keilStatus===6?'waiting':'unavailable';s.error=e.message;if(c?.socket?.destroyed)this.clients.delete(s.port);if(c?.legacy&&e.keilStatus===6&&Date.now()-(c.lastOptionsRetry||0)>3000){c.lastOptionsRetry=Date.now();try{await c.enableExtended();}catch{}}}
  }
  return this.sessions;
 }
 close(){this.generation++;this.scanController?.abort();this.scanController=null;this.discovery=null;this.pendingSessions=null;this.discovering=false;this.hasDiscovered=false;this.scanned=0;this.sessions=[];for(const c of this.clients.values())c.close();this.clients.clear();}
}
