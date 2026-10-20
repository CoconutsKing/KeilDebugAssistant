import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreferenceController,preferences} from '../app/public/preferences.js';
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));

test('sidebar responds synchronously, ignores stale polling, and coalesces rapid clicks to the latest state',async()=>{
 const calls=[],finish=[],changes=[];const initial=preferences({guideOpen:false});
 const controller=createPreferenceController({save:patch=>{calls.push(patch);return new Promise(resolve=>finish.push(resolve));},onChange:value=>changes.push(value.collapsed)});
 controller.reconcile(initial);controller.set({collapsed:true});assert.equal(controller.current.collapsed,true);assert.equal(changes.at(-1),true,'must paint before the save promise resolves');
 controller.reconcile(initial);assert.equal(controller.current.collapsed,true,'old server state must not undo the click');
 controller.set({collapsed:false});controller.set({collapsed:true});controller.set({collapsed:false});assert.equal(controller.current.collapsed,false);assert.deepEqual(calls,[{collapsed:true}]);
 finish[0]({...initial,collapsed:true});await nextTurn();assert.equal(controller.current.collapsed,false);assert.deepEqual(calls,[{collapsed:true},{collapsed:false}]);
 finish[1](initial);await nextTurn();assert.equal(controller.current.collapsed,false);
});

test('interface preference patches merge while saving without resetting the latest theme or guide choice',async()=>{
 const calls=[],finish=[];const controller=createPreferenceController({save:patch=>{calls.push(patch);return new Promise(resolve=>finish.push(resolve));}});
 controller.set({collapsed:true});controller.set({theme:'dark'});controller.set({guideOpen:false});
 assert.deepEqual(controller.current,{theme:'dark',collapsed:true,guideOpen:false,guideDismissed:false});
 finish[0](preferences({collapsed:true}));await nextTurn();assert.deepEqual(calls[1],{theme:'dark',guideOpen:false});assert.deepEqual(controller.current,{theme:'dark',collapsed:true,guideOpen:false,guideDismissed:false});
 finish[1](controller.current);await nextTurn();assert.deepEqual(controller.current,{theme:'dark',collapsed:true,guideOpen:false,guideDismissed:false});
});

test('failed preference saves roll back only the failed choice and do not discard a newer click',async()=>{
 const failures=[],finish=[];let attempt=0;
 const controller=createPreferenceController({save:patch=>{attempt++;return new Promise((resolve,reject)=>finish.push({resolve,reject,patch}));},onError:e=>failures.push(e.message)});
 controller.set({collapsed:true});controller.set({collapsed:false});finish[0].reject(Error('first save failed'));await nextTurn();assert.equal(controller.current.collapsed,false);assert.equal(attempt,2);assert.deepEqual(finish[1].patch,{collapsed:false});finish[1].resolve(preferences());await nextTurn();
 controller.set({collapsed:true});finish[2].reject(Error('cannot save'));await nextTurn();assert.equal(controller.current.collapsed,false);assert.deepEqual(failures,['first save failed','cannot save']);
});

test('tutorial dismissal is immediate, persists separately from folding and can be reopened',async()=>{
 let remote=preferences();const controller=createPreferenceController({save:async patch=>remote=preferences({...remote,...patch})});
 controller.set({guideOpen:false,guideDismissed:true});assert.equal(controller.current.guideDismissed,true);await nextTurn();assert.equal(remote.guideDismissed,true);
 const reloaded=createPreferenceController({save:async patch=>remote=preferences({...remote,...patch})});reloaded.reconcile(JSON.parse(JSON.stringify(remote)));assert.equal(reloaded.current.guideDismissed,true);
 reloaded.set({guideOpen:true,guideDismissed:false});assert.equal(reloaded.current.guideOpen,true);assert.equal(reloaded.current.guideDismissed,false);await nextTurn();assert.equal(remote.guideDismissed,false);
});
