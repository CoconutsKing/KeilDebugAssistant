import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionChoices,createSessionSwitch,connectionView} from '../app/public/session-picker.js';

test('a fixed window stays selected when the list temporarily disappears or its status changes',()=>{
 const target={port:4824,pid:2,project:'C:\\Demo\\Board.uvprojx',status:'running'};
 for(const sessions of [[],[target],[{...target,status:'waiting'}],[]]){
  const model=sessionChoices(sessions,'4824',target);assert.equal(model.selected,'4824');assert.ok(model.options.some(o=>o.value==='4824'&&!o.disabled));assert.match(model.options.find(o=>o.value==='4824').label,/Board\.uvprojx/);
 }
 assert.equal(sessionChoices([target],'auto',target).selected,'auto');
});
test('rapid window changes keep the latest choice and skip obsolete queued requests',async()=>{
 const calls=[],finish=[];const controller=createSessionSwitch({connect:request=>{calls.push(request.selection);return new Promise(resolve=>finish.push(resolve));}});
 const first=controller.select({selection:'4823'});await new Promise(resolve=>setImmediate(resolve));
 const obsolete=controller.select({selection:'4824'}),latest=controller.select({selection:'auto'});assert.equal(controller.pending,'auto');
 finish[0]();await first;assert.equal(controller.pending,'auto');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['4823','auto']);
 finish[1]();await Promise.all([obsolete,latest]);assert.equal(controller.pending,null);
});
test('a failed connection cannot discard the next user choice',async()=>{
 const calls=[];let fail;const controller=createSessionSwitch({connect:request=>{calls.push(request.selection);if(calls.length===1)return new Promise((resolve,reject)=>{fail=reject;});return Promise.resolve();}});
 const first=controller.select({selection:'4823'});first.catch(()=>{});await new Promise(resolve=>setImmediate(resolve));const next=controller.select({selection:'4824'});
 fail(Error('closed'));await assert.rejects(first);await next;assert.deepEqual(calls,['4823','4824']);assert.equal(controller.pending,null);
});

test('connection lights and button actions distinguish ready, waiting, failed and disconnected states',()=>{
 for(const status of ['running','halted']){
  const view=connectionView({mode:'keil',status});assert.equal(view.light,'green');assert.equal(view.connected,true);assert.equal(view.action,'disconnect');assert.equal(view.button,'断开连接');
 }
 for(const status of ['waiting','connecting']){const view=connectionView({mode:'keil',status});assert.equal(view.light,'yellow');assert.equal(view.connected,false);assert.equal(view.action,'disconnect');}
 const failed=connectionView({mode:'keil',status:'error'});assert.equal(failed.light,'red');assert.equal(failed.action,'connect');assert.equal(failed.cancel,true);
 const off=connectionView({mode:'disconnected',status:'disconnected'});assert.equal(off.light,'red');assert.equal(off.button,'连接 Keil');assert.equal(off.action,'connect');assert.equal(off.cancel,false);
 assert.equal(connectionView({},{mode:'keil'}).light,'yellow');assert.equal(connectionView({mode:'keil',status:'running'},{mode:'disconnected'}).connected,false);
 const offline=connectionView({mode:'keil',status:'running',serviceError:'fetch failed'});assert.equal(offline.light,'red');assert.equal(offline.connected,false);assert.equal(offline.text,'工具服务不可用');
});

test('manual disconnect aborts a pending connect and bypasses its request queue',async()=>{
 const calls=[];let oldSignal,finish;
 const controller=createSessionSwitch({connect:(request,signal)=>{calls.push(request.mode);if(request.mode==='keil'){oldSignal=signal;return new Promise(resolve=>finish=resolve);}return Promise.resolve('off');}});
 const connecting=controller.select({mode:'keil',selection:'4823'});await new Promise(resolve=>setImmediate(resolve));
 const disconnected=controller.select({mode:'disconnected',selection:'4823'});assert.equal(oldSignal.aborted,true);assert.equal(await disconnected,'off');assert.deepEqual(calls,['keil','disconnected']);assert.equal(controller.pendingRequest,null);
 finish('old response');await connecting;assert.equal(controller.pendingRequest,null);
});
