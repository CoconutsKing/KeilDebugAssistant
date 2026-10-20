import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {SessionPool,chooseSession,parseListeners,sessionsFrom} from '../app/lib/sessions.mjs';
import {packet} from '../app/lib/uvsock.mjs';
import {preferences} from '../app/public/preferences.js';
test('detect every Keil listener including arbitrary ports; explain duplicate-port windows',()=>{
 const listeners=parseListeners(' TCP 0.0.0.0:4823 0.0.0.0:0 LISTENING 11\n TCP [::]:4823 [::]:0 LISTENING 11\n TCP 0.0.0.0:50001 0.0.0.0:0 LISTENING 12\n TCP 127.0.0.1:9 127.0.0.1:2 ESTABLISHED 12');
 const sessions=sessionsFrom([{pid:11,title:'C:\\New\\A.uvprojx - μVision',project:'C:\\Old.uvprojx'},{pid:12,title:'B'},{pid:13,title:'C'}],listeners);
 assert.deepEqual(sessions.map(s=>s.port),[4823,50001,null]);assert.equal(sessions[0].project,'C:\\New\\A.uvprojx');assert.equal(sessions[2].status,'no-port');
});
test('auto finds second Debug session and keeps active target stable; manual never falls through',()=>{
 const a={port:4823,status:'waiting'},b={port:4824,status:'running'};
 assert.equal(chooseSession([a,b],4823),b);a.status='halted';assert.equal(chooseSession([a,b],4823),a);
 assert.equal(chooseSession([a,b],4823,'4824'),b);assert.equal(chooseSession([a,b],4823,'6000'),null);
});
test('two real UVSOCK sockets recover from status 6 and switch to another Debug window',async()=>{
 const sockets=new Set();let debugging=[false,true];
 async function endpoint(index){const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buf=Buffer.alloc(0);socket.on('data',data=>{buf=Buffer.concat([buf,data]);while(buf.length>=32&&buf.length>=buf.readUInt32LE()){const frame=buf.subarray(0,buf.readUInt32LE());buf=buf.subarray(frame.length);const cmd=frame.readUInt32LE(4),body=Buffer.alloc(cmd===0x2004&&debugging[index]?12:8);body.writeUInt32LE(cmd);if(cmd===0x2004&&!debugging[index])body.writeUInt32LE(6,4);socket.write(packet(0x3000,body));}});});server.listen(0,'127.0.0.1');await once(server,'listening');return server;}
 const servers=await Promise.all([endpoint(0),endpoint(1)]),ports=servers.map(s=>s.address().port);
 const pool=new SessionPool({discover:async()=>ports.map((port,i)=>({port,pid:i+1,title:'Window '+i}))});
 try{await pool.scan(true);let sessions=await pool.refresh(null);assert.equal(chooseSession(sessions,ports[0]).port,ports[1]);debugging=[true,false];sessions=await pool.refresh(null);assert.equal(chooseSession(sessions,ports[1]).port,ports[0]);assert.equal(chooseSession(sessions,ports[1],String(ports[1])).status,'waiting');}
 finally{pool.close();for(const socket of sockets)socket.destroy();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));}
});
test('theme/sidebar/guide preferences validate and survive JSON roundtrip',()=>{
 for(const theme of ['forest','ocean','violet','amber','dark'])assert.equal(preferences(JSON.parse(JSON.stringify({theme,collapsed:true,guideOpen:false}))).theme,theme);
 assert.deepEqual(preferences({theme:'invalid',collapsed:'yes'}),{theme:'forest',collapsed:false,guideOpen:true});
});
test('slow process discovery never blocks status polling and duplicate scans are coalesced',async()=>{
 let finish,calls=0;const pool=new SessionPool({discover:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},create:()=>({socket:{destroyed:false},async connect(){},async status(){return 'running';},close(){}})});
 try{const started=performance.now();let sessions=await pool.refresh(4823);assert.ok(performance.now()-started<500);assert.equal(sessions[0].status,'running');assert.equal(pool.discovering,true);
 const pending=pool.discovery;await pool.refresh(4823,true);assert.equal(calls,1);assert.equal(pool.discovery,pending);
 finish([{port:4823,pid:42,title:'Current project'}]);await pending;sessions=await pool.refresh(4823);assert.equal(sessions[0].pid,42);assert.equal(pool.discovering,false);
 await pool.scan();assert.equal(calls,1,'scan cooldown begins after discovery completes');}finally{pool.close();}
});
test('a late discovery from a closed session cannot overwrite the new scan',async()=>{
 const finish=[];const pool=new SessionPool({discover:()=>new Promise(resolve=>finish.push(resolve))});
 const old=pool.scan(true);await Promise.resolve();pool.close();const current=pool.scan(true);await Promise.resolve();
 finish[0]([{port:1111,pid:1}]);await old;assert.equal(pool.discovering,true);assert.equal(pool.hasDiscovered,false);
 finish[1]([{port:2222,pid:2}]);await current;pool.applyDiscovered(null);assert.deepEqual(pool.sessions.map(s=>s.port),[2222]);pool.close();
});
test('a reused TCP port owned by another Keil process reconnects the socket',async()=>{
 let pid=1,closed=0,connected=0;const pool=new SessionPool({discover:async()=>[{port:4823,pid}],create:()=>({socket:{destroyed:false},async connect(){connected++;},async status(){return 'halted';},close(){closed++;}})});
 try{await pool.scan(true);await pool.refresh(4823);pid=2;await pool.scan(true);await pool.refresh(4823);assert.equal(connected,2);assert.equal(closed,1);assert.equal(pool.sessions[0].pid,2);}finally{pool.close();}
});
test('disconnect aborts an in-progress OS scan without leaving a connection error',async()=>{
 let aborted=false;const pool=new SessionPool({discover:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));},{once:true});})});
 const scan=pool.scan(true);await Promise.resolve();pool.close();await scan;assert.equal(aborted,true);assert.equal(pool.discovering,false);assert.equal(pool.error,'');
});
