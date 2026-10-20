import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionChoices,createSessionSwitch} from '../app/public/session-picker.js';

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
