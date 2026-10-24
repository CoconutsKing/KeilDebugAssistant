import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {UVSock,packet,sstr} from '../app/lib/uvsock.mjs';

function variable(name,id,value='0'){
 const data=Buffer.alloc(1060);data.writeInt32LE(id);data.writeUInt32LE(1,16);
 sstr(value).copy(data,20);sstr('float').copy(data,280);sstr(name).copy(data,540);sstr(name).copy(data,800);return data;
}

test('fourteen extended-mode PID writes avoid a stalled Watch setter and keep member browsing',async()=>{
 const names=Array.from({length:14},(_,i)=>`pid.gain${i}`),values=new Map(names.map(name=>[name,0])),assignments=[],commands=[],sockets=new Set();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);
  const reply=(outer,cmd,data=Buffer.alloc(0),status=0)=>{const body=Buffer.alloc(8+data.length);body.writeUInt32LE(cmd);body.writeUInt32LE(status,4);data.copy(body,8);socket.write(packet(outer,body));};
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);
   while(buffer.length>=32&&buffer.length>=buffer.readUInt32LE()){
    const frame=buffer.subarray(0,buffer.readUInt32LE());buffer=buffer.subarray(frame.length);const cmd=frame.readUInt32LE(4);commands.push(cmd);
    // The old implementation hangs here, matching the slow real extended setter.
    if(cmd===0x202f)continue;
    if(cmd===0x202b){
     const name=frame.subarray(48,48+frame.readUInt32LE(44)-1).toString(),data=variable(name,names.indexOf(name)+1);
     if(name==='pid'){data.writeInt32LE(99);data.writeInt32LE(14,8);data.writeUInt32LE(0x20,16);}
     reply(0x3000,cmd,data);continue;
    }
    if(cmd===0x200a){
     const expression=frame.subarray(48,48+frame.readUInt32LE(44)-1).toString(),[name,literal]=expression.split(' = ');
     if(literal!==undefined){assignments.push(name);values.set(name,Math.fround(Number(literal)));reply(0x3000,cmd,Buffer.alloc(0),13);continue;}
     const data=Buffer.alloc(12);data.writeUInt32LE(10);data.writeFloatLE(values.get(name),4);reply(0x3000,cmd,data);continue;
    }
    reply(0x3000,cmd);
    if(cmd===0x202e){reply(0x4000,0x5040);reply(0x4000,0x5041,Buffer.concat(names.map((name,i)=>variable(name,i+1))));reply(0x4000,0x5042);}
   }
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const client=new UVSock();let timer;
 try{
  await client.connect(server.address().port);assert.equal(client.legacy,false);
  const restore=async()=>{for(let i=0;i<names.length;i++){const actual=await client.write(names[i],(i+1)/10);assert.equal(Number(actual.value),Math.fround((i+1)/10));assert.ok(actual.writeDiagnostic);}};
  await Promise.race([restore(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Batch restore waited for the extended Watch setter')),2000);})]);clearTimeout(timer);
  assert.deepEqual(assignments,names,'each assignment must be sent exactly once');assert.ok(!commands.includes(0x202f));assert.equal(client.legacy,false);
  assert.equal((await client.members('pid')).length,14,'numeric writes disabled extended member enumeration');
  values.set(names[0],7.5);assert.equal((await client.read(names[0])).value,'7.5','later Keil edits stopped synchronizing');
 }finally{clearTimeout(timer);client.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});

test('an unacknowledged expression write times out without repeating or claiming success',async()=>{
 const sockets=new Set();let assignments=0;
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=32&&buffer.length>=buffer.readUInt32LE()){
   const frame=buffer.subarray(0,buffer.readUInt32LE());buffer=buffer.subarray(frame.length);const cmd=frame.readUInt32LE(4);
   if(cmd===0x200a&&frame.subarray(48,48+frame.readUInt32LE(44)-1).toString().includes(' = ')){assignments++;continue;}
   const data=cmd===0x200a?Buffer.alloc(12):Buffer.alloc(0);if(data.length){data.writeUInt32LE(10);data.writeFloatLE(1,4);}
   const body=Buffer.alloc(8+data.length);body.writeUInt32LE(cmd);if(cmd===0xd)body.writeUInt32LE(10,4);data.copy(body,8);socket.write(packet(0x3000,body));
  }});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const client=new UVSock();
 try{await client.connect(server.address().port);await assert.rejects(client.write('pid.gain',2),/请求超时/);assert.equal(assignments,1);assert.equal(client.socket.destroyed,true);assert.equal(client.pending,null);}
 finally{client.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});
