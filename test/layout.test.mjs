import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialRect,adjustRect,canvasMetrics} from '../app/public/layout.js';
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
 assert.deepEqual(captured,{mode:'free',placement:'canvas',widgets:{pid:{x:20,y:80,width:600,height:550},angle:{x:640,y:80,width:300,height:550}}});
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

test('free-layout canvas centers after sidebar resizing, without changing saved geometry or adding overflow',()=>{
 const rects=[{x:0,y:0,width:382,height:560},{x:400,y:0,width:382,height:290}];
 assert.equal(canvasMetrics(rects,1000).offset,109);assert.equal(canvasMetrics(rects,1200).offset,209);
 assert.equal(canvasMetrics(rects,600).offset,0);assert.equal(canvasMetrics(rects,600).width,782);
 const saved=JSON.stringify(rects);canvasMetrics(rects,1600);assert.equal(JSON.stringify(rects),saved);
});

test('resizing updates actual card positions immediately and capture retains the original coordinates',()=>{
 const previousDocument=globalThis.document;globalThis.document={createElement:()=>({setAttribute(){}})};
 try{
  const saved={mode:'free',widgets:{pid:{x:0,y:0,width:382,height:560},angle:{x:400,y:0,width:382,height:290}}};let saves=0;
  const card=name=>({dataset:{root:name},style:{},isConnected:true,classList:{contains(){return false;}},append(){},querySelector:selector=>selector==='.card-head'?{prepend(){}}:{}}),cards=[card('pid'),card('angle')];
  const container={querySelectorAll:()=>cards,dataset:{},style:{},parentElement:{clientWidth:1000},classList:{toggle(){}}};
  const layout=createLayout({container,save:async()=>{saves++;},onMode(){},onError(error){throw error;}});layout.sync(saved);assert.equal(cards[0].style.left,'109px');
  container.parentElement.clientWidth=1200;layout.resize();assert.equal(cards[0].style.left,'209px');assert.equal(cards[1].style.left,'609px');assert.equal(container.style.width,'1200px');assert.deepEqual(layout.capture(),saved);assert.equal(saves,0);
 }finally{globalThis.document=previousDocument;}
});

function layoutFixture(saved,width=2000){
 const previousDocument=globalThis.document,saves=[];globalThis.document={createElement:()=>({setAttribute(){},setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){}})};
 const cards=Object.keys(saved.widgets).map(name=>{const handles=[],card={dataset:{root:name},style:{},handles,isConnected:true,classList:{contains(){return false;},add(){},remove(){}},append:handle=>handles.push(handle),querySelector:selector=>selector==='.card-head'?{prepend:handle=>handles.unshift(handle)}:{},getBoundingClientRect(){return {left:100+parseFloat(this.style.left||0),top:80+parseFloat(this.style.top||0),width:parseFloat(this.style.width||382),height:parseFloat(this.style.height||290)};}};return card;});
 const container={querySelectorAll:()=>cards,dataset:{},style:{},parentElement:{clientWidth:width},classList:{toggle(){}},getBoundingClientRect:()=>({left:100,top:80})};
 const controller=createLayout({container,save:async value=>saves.push(value),onMode(){},onError(error){throw error;}});controller.sync(saved);
 return {controller,cards,container,saves,restore(){globalThis.document=previousDocument;}};
}

test('a centered legacy layout becomes editable across the entire canvas without jumping or snapping back after save',async()=>{
 const fixture=layoutFixture({mode:'free',widgets:{pid:{x:0,y:0,width:382,height:560},angle:{x:400,y:0,width:382,height:290}}});
 try{
  const {controller,cards,container}=fixture;assert.equal(cards[0].style.left,'609px');const initial=cards.map(card=>({...card.style}));controller.toggle();assert.deepEqual(cards.map(card=>({...card.style})),initial);assert.equal(controller.capture().placement,'canvas');
  const handle=cards[0].handles[0];handle.onpointerdown({button:0,preventDefault(){},currentTarget:handle,clientX:659,clientY:100,pointerId:1});handle.onpointermove({clientX:50,clientY:100});assert.equal(cards[0].style.left,'0px');handle.onpointerup({pointerId:1});
  controller.toggle();assert.equal(cards[0].style.left,'0px');container.parentElement.clientWidth=2400;controller.resize();assert.equal(cards[0].style.left,'0px');assert.equal(cards[1].style.left,'1009px');
  const saved=validateLayout(controller.capture());assert.equal(saved.widgets.pid.x,0);assert.equal(saved.widgets.pid.width,382);assert.equal(saved.widgets.pid.height,560);assert.equal(saved.placement,'canvas');controller.replace(saved);controller.sync(saved);assert.equal(cards[0].style.left,'0px');assert.equal(cards[1].style.left,'1009px');
  await Promise.resolve();assert.ok(fixture.saves.every(value=>value.placement==='canvas'));
 }finally{fixture.restore();}
});

test('keyboard movement reaches the left edge and sidebar changes during editing keep the saved canvas positions',()=>{
 const fixture=layoutFixture({mode:'free',widgets:{pid:{x:0,y:0,width:382,height:290}}},1200);
 try{
  const {controller,cards,container}=fixture;controller.toggle();const handle=cards[0].handles[0];for(let i=0;i<60;i++)handle.onkeydown({key:'ArrowLeft',preventDefault(){}});assert.equal(cards[0].style.left,'0px');
  container.parentElement.clientWidth=1600;controller.resize();assert.equal(cards[0].style.left,'0px');handle.onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(cards[0].style.left,'8px');controller.toggle();assert.equal(cards[0].style.left,'8px');
 }finally{fixture.restore();}
});

test('manual positioning survives filtering and new member content, while automatic layout can still be restored',()=>{
 const saved={mode:'free',placement:'canvas',widgets:{pid:{x:600,y:40,width:382,height:560},angle:{x:0,y:0,width:382,height:290}}},fixture=layoutFixture(saved,2000);
 try{
  const {controller,cards,container}=fixture;container.dataset.filtered='true';const hidden=cards.pop();controller.sync(saved);assert.equal(cards[0].style.left,'600px');assert.equal(cards[0].style.top,'40px');assert.deepEqual(controller.capture(),saved);cards.push(hidden);container.dataset.filtered='false';controller.sync(saved);assert.equal(cards[1].style.left,'0px');
  controller.reset();assert.deepEqual(fixture.saves.at(-1),{mode:'grid',widgets:{}});assert.throws(()=>validateLayout({...saved,placement:'unknown'}));
 }finally{fixture.restore();}
});
