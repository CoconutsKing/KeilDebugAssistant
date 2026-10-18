import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialRect,adjustRect} from '../public/layout.js';
import {validateLayout} from '../lib/layout.mjs';
test('free layout positions, resize bounds and persistence validation',()=>{
 const a=initialRect(0,1000),b=initialRect(1,1000,true);assert.ok(a.x+a.width<b.x);assert.equal(b.height,560);
 const moved=adjustRect(a,35,25);assert.equal(moved.x,32);assert.equal(moved.y,24);assert.equal(adjustRect(a,-500,-500).x,0);
 const resized=adjustRect(a,-1000,-1000,true);assert.equal(resized.width,280);assert.equal(resized.height,180);
 const layout={mode:'free',widgets:{'pid.kp':moved}};assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(layout))),layout);
 assert.throws(()=>validateLayout({mode:'free',widgets:{x:{x:NaN,y:0,width:500,height:200}}}));assert.throws(()=>validateLayout({mode:'free',widgets:{'x;reset':moved}}));
});
