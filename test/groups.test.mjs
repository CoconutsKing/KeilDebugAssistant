import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flattenGroup} from '../app/lib/groups.mjs';
import {validateItem} from '../app/lib/model.mjs';
import {stepValue,createControl} from '../app/public/controls.js';
test('flatten nested object arrays, preserve pointer rows and limit huge groups',()=>{
 const describe=name=>name==='pid'?{aggregate:true}:name==='pid.gains'?{array:true}:name==='pid.next'?{pointer:true}:{type:'float'};
 const children=name=>name==='pid'?[{name:'pid.gains'},{name:'pid.next'}]:name==='pid.gains'?[{name:'pid.gains[0]'},{name:'pid.gains[1]'}]:[];
 const result=flattenGroup('pid',describe,children);assert.deepEqual(result.rows.map(r=>r.name),['pid.gains[0]','pid.gains[1]','pid.next']);assert.equal(result.truncated,false);assert.equal(flattenGroup('pid',describe,children,{limit:1}).truncated,true);
 assert.equal(validateItem({name:'pid',members:{'pid.kp':{min:-2,max:2,step:0.1}}}).members['pid.kp'].min,-2);assert.throws(()=>validateItem({name:'pid',members:{'other.kp':{}}}));
});
test('wheel increments use configured step, avoid float drift, clamp both bounds',()=>{assert.equal(stepValue(0.2,1,0,1,0.1),0.3);assert.equal(stepValue(1,1,0,1,0.1),1);assert.equal(stepValue(0,-1,0,1,0.1),0);});
test('hover wheel writes without click, coalesces ticks, and leaves focus untouched',async()=>{
 class Node {constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.listeners={};this.value='';}append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(type,fn){this.listeners[type]=fn;}contains(node){return this.children.includes(node);}}
 const prior=globalThis.document;const doc={activeElement:null,createElement:tag=>new Node(tag)};globalThis.document=doc;
 try{let sent=[];const initial={name:'pid.kp',value:'1',type:'float',editable:true,min:0,max:5,step:0.1,updated:Date.now()};const control=createControl(initial,{root:'pid',settings(){},api:async(path,data)=>{sent.push(data);return {items:[{name:'pid',children:[{...initial,value:String(data.value)}]}]};}});control.update(initial);const range=control.element.children[1].children[1];let prevented=0;for(let i=0;i<3;i++)range.listeners.wheel({deltaY:-100,preventDefault(){prevented++;}});await new Promise(r=>setTimeout(r,180));assert.equal(prevented,3);assert.equal(sent.length,1);assert.equal(sent[0].value,1.3);assert.equal(sent[0].root,'pid');assert.equal(doc.activeElement,null);control.dispose();}finally{globalThis.document=prior;}
});
test('focused controls refresh actual values immediately while unsubmitted numeric draft is preserved',async()=>{
 class Node {constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.value='';}append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(){}contains(node){return this.children.includes(node);}}
 const prior=globalThis.document;const doc={activeElement:null,createElement:tag=>new Node(tag)};globalThis.document=doc;
 try{const initial={name:'pid.kp',value:'1',type:'float',editable:true,min:0,max:5,step:0.1,updated:Date.now()};const control=createControl(initial,{root:'pid',settings(){},api:async()=>({items:[{name:'pid',children:[{...initial,value:'2.125'}]}]})});const controls=control.element.children[1],range=controls.children[1],input=controls.children[3],write=controls.children[4],actual=control.element.children[0].children[1];doc.activeElement=range;control.update({...initial,value:'3'});assert.equal(actual.textContent,'3');assert.equal(input.value,'3');doc.activeElement=input;input.value='2';input.oninput();control.update({...initial,value:'4'});assert.equal(actual.textContent,'4');assert.equal(input.value,'2');write.onclick();await new Promise(r=>setTimeout(r,10));assert.equal(actual.textContent,'2.125');assert.equal(input.value,'2.125');assert.equal(doc.activeElement,input);control.dispose();}finally{globalThis.document=prior;}
});

test('scalar and member rows keep syncing after write/toggle, normalize hex inputs, and preserve drafts and history',async()=>{
 class Node {constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.value='';}append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(){}}
 const prior=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
 try{for(const name of ['target','pid.kp','samples[2]']){
  const root=name==='pid.kp'?'pid':name==='samples[2]'?'samples':name,history={previous:3,current:21,selected:'current'};
  const initial={name,value:'0x15',type:'float',editable:true,min:0,max:100,step:1,updated:100,history};
  const control=createControl(initial,{root,settings(){},api:async(path,data)=>{const actual={...initial,value:String(path==='toggle'?3:data.value),updated:200};return {items:[root===name?actual:{name:root,children:[actual]}]};}});
  const [label,controls,,message]=control.element.children,range=controls.children[1],input=controls.children[3],write=controls.children[4],toggle=controls.children[5];
  control.update(initial);assert.equal(input.value,'21');assert.equal(range.value,'21');
  input.value='12';input.oninput();write.onclick();await new Promise(r=>setTimeout(r,0));assert.equal(message.textContent,'实际值：12');
  control.update({...initial,value:'0x1a',updated:300});assert.equal(label.children[1].textContent,'0x1a');assert.equal(input.value,'26');assert.equal(range.value,'26');assert.equal(message.textContent,'实际值：0x1a');assert.equal(toggle.textContent,'⇄ 切换到 3');
  input.value='18';input.oninput();control.update({...initial,value:'27',updated:400});assert.equal(input.value,'18');assert.equal(label.children[1].textContent,'27');assert.equal(range.value,'27');assert.equal(message.textContent,'实际值：27');
  input.onblur();await toggle.onclick();control.update({...initial,value:'9',updated:500});assert.equal(input.value,'9');assert.equal(range.value,'9');assert.equal(label.children[1].textContent,'9');assert.equal(message.textContent,'实际值：9');control.dispose();
 }}finally{globalThis.document=prior;}
});
