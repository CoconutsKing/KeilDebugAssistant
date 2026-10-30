import net from 'node:net';
import {packet,sstr} from '../app/lib/uvsock.mjs';
import {fixtureCatalog} from './keil.mjs';

export async function createDebugTarget(options={}){
 const target={mode:'waiting',enterDelay:40,runDelay:15,commands:[],events:[],values:new Map(),pendingEnter:[],...options},sockets=new Set(),timers=new Set();
 function later(action,delay){const timer=setTimeout(()=>{timers.delete(timer);action();},delay);timers.add(timer);}
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let buffer=Buffer.alloc(0);
  const reply=(outer,cmd,data=Buffer.alloc(0),status=0)=>{if(socket.destroyed)return;const body=Buffer.alloc(8+data.length);body.writeUInt32LE(cmd);body.writeUInt32LE(status,4);data.copy(body,8);socket.write(packet(outer,body));};
  const acknowledge=(cmd,data,status=0)=>{target.events.push({kind:'ack',cmd});reply(0x3000,cmd,data,status);};
  const complete=(cmd,error)=>{target.events.push({kind:'complete',cmd});reply(0x4000,cmd,error?Buffer.concat([Buffer.alloc(12),Buffer.from('Injected probe failure\0')]):Buffer.alloc(0),error||0);};
  socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);while(buffer.length>=32&&buffer.length>=buffer.readUInt32LE()){
   const frame=buffer.subarray(0,buffer.readUInt32LE());buffer=buffer.subarray(frame.length);const cmd=frame.readUInt32LE(4),command={cmd,at:Date.now()};target.commands.push(command);
   if(cmd===0xd){acknowledge(cmd,undefined,target.mode==='waiting'?0:10);continue;}
   if(cmd===0x2004){const data=Buffer.alloc(4);data.writeUInt32LE(target.mode==='running'?1:0);acknowledge(cmd,data,target.mode==='waiting'?6:0);continue;}
   if(cmd===0x2000){
    if(target.mode!=='waiting'){acknowledge(cmd,undefined,target.mode==='running'?11:10);continue;}
    const finish=()=>{if(!target.enterError)target.mode='halted';complete(cmd,target.enterError);};
    if(target.enterBeforeAck){finish();acknowledge(cmd);continue;}acknowledge(cmd);if(target.holdEnter)target.pendingEnter.push(finish);else later(finish,target.enterDelay);continue;
   }
   if(cmd===0x2002){
    if(target.mode!=='halted'){acknowledge(cmd,undefined,target.mode==='waiting'?6:11);continue;}acknowledge(cmd);
    const finish=()=>{if(!target.runError)target.mode=target.breakpoint?'halted':'running';complete(cmd,target.runError);};later(finish,target.runDelay);continue;
   }
   if(cmd===0x200a||cmd===0x202b){
    const catalog=target.catalog||fixtureCatalog,expression=frame.subarray(48,48+frame.readUInt32LE(44)-1).toString(),[name,literal]=expression.split(' = '),meta=catalog.describe(name);command.expression=expression;
    if(target.failRead===name||target.failReads?.includes(name)){acknowledge(cmd,undefined,13);continue;}
    if(target.mode==='waiting'||!meta){acknowledge(cmd,undefined,target.mode==='waiting'?6:13);continue;}
    if(literal!==undefined)target.values.set(name,Math.fround(Number(literal)));
    const initial=name==='pid.kp'?1.2:name==='pid.ki'?0.08:/^controllers\[\d+\]\.gain$/.test(name)?Number(name.match(/\[(\d+)\]/)[1])+0.5:0,value=target.values.get(name)??initial;
    if(cmd===0x200a){const data=Buffer.alloc(12);data.writeUInt32LE(/int/.test(meta.type)?4:10);if(/int/.test(meta.type))data.writeInt32LE(value,4);else data.writeFloatLE(value,4);acknowledge(cmd,data);}
    else{const data=Buffer.alloc(1060);data.writeInt32LE(1);data.writeInt32LE(meta.count||catalog.children(name)?.total||0,8);data.writeUInt32LE(meta.array?0x40:meta.aggregate?0x20:1,16);sstr(String(value)).copy(data,20);sstr(meta.type).copy(data,280);sstr(name).copy(data,540);sstr(name).copy(data,800);acknowledge(cmd,data);}continue;
   }
   acknowledge(cmd,undefined,28);
  }});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));target.port=server.address().port;
 target.releaseEnter=()=>{for(const finish of target.pendingEnter.splice(0))finish();};
 target.close=async()=>{for(const timer of timers)clearTimeout(timer);for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));};return target;
}
