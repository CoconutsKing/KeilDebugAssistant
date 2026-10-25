import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UVSock} from '../app/lib/uvsock.mjs';
import {createDebugTarget} from '../test-support/debug-target.mjs';
import {debugView} from '../app/public/debug-view.js';

async function connected(options,run){const target=await createDebugTarget(options),client=new UVSock();try{await client.connect(target.port);await run(client,target);}finally{client.close();await target.close();}}

test('Debug waits for asynchronous entry completion before checking status or sending Run',()=>connected({},async(client,target)=>{
 const phases=[];assert.equal(await client.enterAndRun({onPhase:phase=>phases.push(phase)}),'running');assert.deepEqual(phases,['checking','entering','running']);
 const enter=target.events.findIndex(e=>e.kind==='complete'&&e.cmd===0x2000),run=target.events.findIndex(e=>e.kind==='ack'&&e.cmd===0x2002);assert.ok(run>enter);
 assert.deepEqual(target.commands.map(c=>c.cmd),[0xd,0x2004,0x2000,0x2004,0x2002,0x2004]);
 const count=target.commands.filter(c=>[0x2000,0x2002].includes(c.cmd)).length;await client.enterAndRun();assert.equal(target.commands.filter(c=>[0x2000,0x2002].includes(c.cmd)).length,count);
}));

test('an existing paused session runs without re-entering Debug; a breakpoint pause is reported accurately',()=>connected({mode:'halted',breakpoint:true},async(client,target)=>{
 assert.equal(await client.enterAndRun(),'halted');assert.ok(!target.commands.some(c=>c.cmd===0x2000));assert.equal(target.commands.filter(c=>c.cmd===0x2002).length,1);
}));

test('coalesced completion before the ACK is not missed',()=>connected({enterBeforeAck:true},async(client)=>{assert.equal(await client.enterAndRun(),'running');}));

test('entry errors and completion timeout never fall through to Run',async()=>{
 await connected({enterError:1},async(client,target)=>{await assert.rejects(client.enterAndRun(),/Injected probe failure/);assert.ok(!target.commands.some(c=>c.cmd===0x2002));});
 await connected({holdEnter:true},async(client,target)=>{await assert.rejects(client.enterAndRun({timeout:40}),/超时/);assert.equal(client.socket.destroyed,true);assert.ok(!target.commands.some(c=>c.cmd===0x2002));});
});

test('disconnect cancellation and a changed window after entry prevent all later Run commands',async()=>{
 await connected({holdEnter:true},async(client,target)=>{
  const abort=new AbortController(),job=client.enterAndRun({signal:abort.signal});for(let i=0;i<100&&!target.commands.some(c=>c.cmd===0x2000);i++)await new Promise(r=>setTimeout(r,2));abort.abort(Error('Disconnected'));
  await assert.rejects(job,/Disconnected/);target.releaseEnter();assert.ok(!target.commands.some(c=>c.cmd===0x2002));assert.equal(client.lifecycle,null);
 });
 await connected({},async(client,target)=>{let current=true;await assert.rejects(client.enterAndRun({onPhase:phase=>{if(phase==='entering')current=false;},assertCurrent:()=>{if(!current)throw Error('Window changed');}}),/Window changed/);assert.ok(!target.commands.some(c=>c.cmd===0x2002));});
});

test('debug controls show progress and errors in the selected window and leave an already running target alone',()=>{
 assert.equal(debugView({mode:'keil',status:'running'}).disabled,true);assert.match(debugView({mode:'keil',status:'halted'}).button,/继续运行/);
 const state={mode:'keil',status:'connecting',session:{port:4824},debugJob:{status:'running',port:4824,phase:'entering'}};assert.match(debugView(state).message,/初始化/);assert.equal(debugView(state).disabled,true);
 assert.equal(debugView({...state,debugJob:{status:'error',port:4823,error:'other window'}}).message,'');assert.match(debugView({...state,debugJob:{status:'error',port:4824,error:'probe disconnected'}}).message,/probe disconnected/);
});
