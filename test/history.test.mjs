import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordInput,toggleTarget,validHistory} from '../app/lib/history.mjs';
import {UVSock,matchesTarget,numericLiteral} from '../app/lib/uvsock.mjs';
test('two-target history toggles repeatedly and new input replaces the inactive target',()=>{
 let h=recordInput(null,10,0);assert.deepEqual(h,{previous:0,current:10,selected:'current'});
 let switched=toggleTarget(h);assert.equal(switched.value,0);h=switched.history;assert.equal(toggleTarget(h).value,10);
 h=recordInput(h,20,999);assert.deepEqual(h,{previous:0,current:20,selected:'current'});assert.equal(toggleTarget(h).value,0);
 assert.deepEqual(recordInput(h,20,999),h);assert.equal(recordInput(null,5,5),null);assert.ok(!validHistory({previous:0,current:Infinity,selected:'current'}));assert.throws(()=>toggleTarget(null));
});
test('numeric literals are independent of Keil default integer radix',()=>{assert.equal(numericLiteral(10,'int'),'0xa');assert.equal(numericLiteral(-10,'int'),'-0xa');assert.equal(numericLiteral(10,'float'),'10.0');assert.ok(matchesTarget(String(Math.fround(0.1)),0.1,'float'));assert.ok(!matchesTarget('1',2,'float'));});
test('status 13 after assignment is accepted only when independent readback matches',async()=>{
 const c=new UVSock();c.legacy=true;let reads=0,writes=0;c.read=async name=>({name,value:++reads===1?'0':String(Math.fround(0.1)),type:'float',editable:true});c.request=async()=>{writes++;const e=Error('Keil 状态 13: Error in expression');e.keilStatus=13;throw e;};const result=await c.write('target',0.1);assert.equal(writes,1);assert.equal(reads,2);assert.ok(result.writeDiagnostic);
 reads=0;c.read=async name=>({name,value:'0',type:'float',editable:true});await assert.rejects(c.write('target',0.1),/写入未确认/);assert.equal(writes,2);
});
test('transient status 13 readback is retried without repeating assignment',async()=>{const c=new UVSock();c.legacy=true;let reads=0,writes=0;c.read=async name=>{reads++;if(reads===2){const e=Error('Error in expression');e.keilStatus=13;throw e;}return {name,value:reads===1?'0':'3',type:'float',editable:true};};c.request=async()=>{writes++;};const result=await c.write('target',3);assert.equal(result.value,'3');assert.equal(reads,3);assert.equal(writes,1);});
