import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialRect,adjustRect} from '../app/public/layout.js';
import {validateLayout} from '../app/lib/layout.mjs';
test('free layout positions, resize bounds and persistence validation',()=>{
 const a=initialRect(0,1000),b=initialRect(1,1000,true);assert.ok(a.x+a.width<b.x);assert.equal(b.height,560);
 const moved=adjustRect(a,35,25);assert.equal(moved.x,32);assert.equal(moved.y,24);assert.equal(adjustRect(a,-500,-500).x,0);
 const resized=adjustRect(a,-1000,-1000,true);assert.equal(resized.width,280);assert.equal(resized.height,180);
 const layout={mode:'free',widgets:{'pid.kp':moved}};assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(layout))),layout);
 assert.throws(()=>validateLayout({mode:'free',widgets:{x:{x:NaN,y:0,width:500,height:200}}}));assert.throws(()=>validateLayout({mode:'free',widgets:{'x;reset':moved}}));
});
import {createLayout} from '../app/public/layout.js';
test('replacing a variable captures grid geometry independently of member count',()=>{
 const card=(name,rect)=>({dataset:{root:name},getBoundingClientRect:()=>rect});
 const container={querySelectorAll:()=>[card('pid',{left:420,top:180,width:600,height:550}),card('angle',{left:1040,top:180,width:300,height:550})],getBoundingClientRect:()=>({left:400,top:100})};
 const controller=createLayout({container});
 const captured=controller.capture();
 assert.deepEqual(captured,{mode:'free',widgets:{pid:{x:20,y:80,width:600,height:550},angle:{x:640,y:80,width:300,height:550}}});
 captured.widgets.replacement=captured.widgets.pid;delete captured.widgets.pid;
 assert.deepEqual(validateLayout(captured).widgets.replacement,{x:20,y:80,width:600,height:550});
});
test('replacement preserves saved free layout sizes without measuring new members',()=>{
 const container={querySelectorAll:()=>[],dataset:{},style:{},parentElement:{clientWidth:1200},classList:{toggle(){}}};
 const controller=createLayout({container,onMode(){}});
 const saved={mode:'free',widgets:{pid:{x:400,y:200,width:500,height:320}}};
 controller.sync(saved);
 const captured=controller.capture();assert.deepEqual(captured,saved);
 captured.widgets.pid.width=999;assert.deepEqual(controller.capture(),saved);
});
test('changing debug sessions discards the old layout edit and loads the new profile',async()=>{
 const container={querySelectorAll:()=>[],dataset:{},style:{},parentElement:{clientWidth:1200},classList:{toggle(){}}};let complete;
 const controller=createLayout({container,onMode(){},onError(error){throw error;},save:()=>new Promise(resolve=>{complete=resolve;})});
 controller.sync({mode:'free',widgets:{old:{x:80,y:40,width:400,height:300}}});controller.toggle();
 const next={mode:'free',widgets:{next:{x:16,y:24,width:600,height:200}}};controller.replace(next);controller.sync(next);assert.deepEqual(controller.capture(),next);complete();await Promise.resolve();
});
