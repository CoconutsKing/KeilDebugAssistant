import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrayAxes,reindexItem} from '../app/lib/array-index.mjs';
import {fixtureCatalog} from '../test-support/keil.mjs';
const describe=fixtureCatalog.describe;

test('array index metadata covers whole arrays, class members and nested dimensions',()=>{
 assert.deepEqual(arrayAxes('controllers',describe).map(({parent,index,count})=>({parent,index,count})),[{parent:'controllers',index:null,count:4}]);
 assert.deepEqual(arrayAxes('controllers[2].gain',describe).map(({parent,index,count})=>({parent,index,count})),[{parent:'controllers',index:2,count:4}]);
 const matrix=name=>name==='matrix'?{array:true,count:3}:/^matrix\[[0-2]\]$/.test(name)?{array:true,count:5}:/^matrix\[[0-2]\]\[[0-4]\]$/.test(name)?{type:'float'}:null;
 assert.deepEqual(arrayAxes('matrix[1]',matrix).map(a=>[a.dimension,a.index,a.count]),[[0,1,3],[1,null,5]]);
 assert.deepEqual(arrayAxes('matrix[1][3]',matrix).map(a=>[a.dimension,a.index,a.count]),[[0,1,3],[1,3,5]]);
 assert.equal(reindexItem({name:'matrix[1][3]'},0,2,matrix).name,'matrix[2][3]');assert.equal(reindexItem({name:'matrix[1][3]'},1,4,matrix).name,'matrix[1][4]');
});

test('switching class-array index preserves ranges and remaps selected member settings without mutating the original',()=>{
 const original={name:'controllers[0]',min:-5,max:20,step:0.1,pinned:true,visibleMembers:['controllers[0].gain'],members:{'controllers[0].gain':{min:-1,max:5,step:0.25},'controllers[0].enabled':{hex:true}}};
 const switched=reindexItem(original,0,3,describe);
 assert.deepEqual(switched,{...original,name:'controllers[3]',visibleMembers:['controllers[3].gain'],members:{'controllers[3].gain':{min:-1,max:5,step:0.25},'controllers[3].enabled':{hex:true}}});
 assert.equal(original.name,'controllers[0]');assert.equal(reindexItem(switched,0,0,describe).members['controllers[0].enabled'].hex,true);
 const scalar=reindexItem({name:'controllers[0].gain',min:-5,max:10,step:0.2},0,2,describe);assert.equal(scalar.name,'controllers[2].gain');assert.equal(scalar.step,0.2);
});

test('whole-array selection keeps only the chosen branch and scalar limits; returning to all preserves scoped settings',()=>{
 const original={name:'controllers',min:0,max:100,step:1,visibleMembers:['controllers[0].gain','controllers[2].enabled'],members:{'controllers[0].gain':{min:0,max:5,step:0.1},'controllers[2].enabled':{hex:true}}};
 const selected=reindexItem(original,0,2,describe);assert.deepEqual(selected.visibleMembers,['controllers[2].enabled']);assert.deepEqual(selected.members,{'controllers[2].enabled':{hex:true}});
 const all=reindexItem(selected,0,null,describe);assert.equal(all.name,'controllers');assert.equal(all.visibleMembers,undefined);assert.deepEqual(all.members,selected.members);
 const scalar=reindexItem({name:'samples',min:0,max:100,step:1,members:{'samples[7]':{min:-1,max:1,step:0.01}}},0,7,describe);assert.equal(scalar.name,'samples[7]');assert.equal(scalar.min,-1);assert.equal(scalar.step,0.01);assert.equal(scalar.members,undefined);
 const empty=reindexItem({...original,visibleMembers:[]},0,1,describe);assert.deepEqual(empty.visibleMembers,[]);
});

test('index changes reject unavailable lengths, negative/fractional/out-of-range values and missing members',()=>{
 for(const index of [-1,1.2,4,Infinity,'1'])assert.throws(()=>reindexItem({name:'controllers[0]'},0,index,describe),/下标/);
 assert.throws(()=>reindexItem({name:'controllers[0]'},0,1,()=>null),/长度/);
 assert.throws(()=>reindexItem({name:'controllers[0].missing'},0,1,describe),/不存在/);
 assert.throws(()=>reindexItem({name:'pid'},0,0,describe),/长度/);assert.deepEqual(arrayAxes('x++'),[]);
});
