import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializerPlan,cppInitializer,cppNumber} from '../app/lib/array-copy.mjs';
import {arrayCopyOptions,arrayCopyMessage,copyText} from '../app/public/array-copy.js';

function arrays(count=3,inner=2){return {
 describe(name){if(name==='matrix')return {array:true,count};if(/^matrix\[\d+\]$/.test(name))return {array:true,count:inner};return /^matrix\[\d+\]\[\d+\]$/.test(name)?{type:'int'}:null;},
 children(name,offset=0){const length=name==='matrix'?count:inner,members=Array.from({length:Math.min(64,length-offset)},(_,i)=>({name:name+'['+(i+offset)+']'}));return {members,total:length,nextOffset:offset+members.length<length?offset+members.length:null};}
};}
test('C++ copy preserves every nested dimension and reads beyond monitor and page limits',()=>{
 const catalog=arrays(300,2),plan=initializerPlan('matrix',catalog);assert.equal(plan.rows.length,600);assert.equal(plan.rows.at(-1).name,'matrix[299][1]');
 const values=new Map(plan.rows.map((row,i)=>[row.name,{type:'int',value:String(i)}]));const text=cppInitializer(plan.tree,values);assert.deepEqual(JSON.parse(text.replaceAll('{','[').replaceAll('}',']')),Array.from({length:300},(_,i)=>[2*i,2*i+1]));
 assert.equal(cppInitializer(initializerPlan('matrix[2]',catalog).tree,values),'{4, 5}');
});
test('array of structures includes nested member arrays in declaration order',()=>{
 const metadata={pid:{array:true,count:2},'pid[0]':{aggregate:true},'pid[1]':{aggregate:true}};
 const catalog={describe:name=>metadata[name]||(/\.gains$/.test(name)?{array:true,count:2}:/\.mode$/.test(name)?{type:'int'}:/\.gains\[\d\]$/.test(name)?{type:'float'}:null),children(name){const members=(name==='pid'?['pid[0]','pid[1]']:/pid\[\d\]$/.test(name)?[name+'.gains',name+'.mode']:[name+'[0]',name+'[1]']).map(name=>({name}));return {members,total:members.length,nextOffset:null};}};
 const plan=initializerPlan('pid',catalog),values=new Map(plan.rows.map((row,i)=>[row.name,{type:row.type,value:String(i)}]));
 assert.equal(cppInitializer(plan.tree,values),'{\n  {\n    {0.0f, 1.0f},\n    2\n  },\n  {\n    {3.0f, 4.0f},\n    5\n  }\n}');
});
test('C++ numeric formatting preserves float bits, double precision and exact signed/unsigned 64-bit values',()=>{
 assert.equal(cppNumber({type:'int',value:'0xFF'}),'255');assert.equal(cppNumber({type:'bool',value:'1'}),'1');
 assert.equal(cppNumber({type:'uint64',value:'18446744073709551615'}),'18446744073709551615ULL');assert.equal(cppNumber({type:'int64',value:'-9223372036854775808'}),'(-9223372036854775807LL - 1)');
 assert.equal(cppNumber({type:'uint32_t',value:'4294967295'}),'4294967295LL');assert.equal(cppNumber({type:'CustomFloat',valueType:'float',value:'1.25'}),'1.25f');
 assert.equal(cppNumber({type:'float',value:'-0'}),'-0.0f');assert.equal(cppNumber({type:'double',value:'1.2345678901234567'}),'1.2345678901234567');
 for(const value of [0.1,-0.1,1e-38,3.4028234663852886e38]){const literal=cppNumber({type:'float',value:String(Math.fround(value))});assert.equal(Math.fround(Number(literal.slice(0,-1))),Math.fround(value));}
 for(const row of [{type:'float',value:'NaN'},{type:'double',value:'Infinity'},{type:'int',value:'1;run()'},{type:'int',value:'1',pointer:true},{type:'int64',value:'18446744073709551616'}])assert.throws(()=>cppNumber(row));
});
test('incomplete, unsupported and excessively large copies fail instead of emitting partial initializers',()=>{
 assert.throws(()=>initializerPlan('matrix;run()',arrays()));assert.throws(()=>initializerPlan('matrix',arrays(),{maxLeaves:5}),/最多复制/);assert.throws(()=>initializerPlan('matrix',arrays(),{maxDepth:1}),/嵌套/);
 for(const change of [{describe:()=>({pointer:true,type:'pointer'})},{describe:()=>({aggregate:true,union:true})},{children:()=>({members:[{name:'matrix[2]'}],total:3,nextOffset:null})},{children:()=>({members:[],total:3,nextOffset:0})}])assert.throws(()=>initializerPlan('matrix',{...arrays(),...change}));
 assert.throws(()=>cppInitializer(initializerPlan('matrix',arrays()).tree,new Map()),/未读取/);
});
test('copy scope includes whole parent arrays, explicit subarrays and current aggregate without duplicates',()=>{
 assert.deepEqual(arrayCopyOptions({name:'matrix[1]',array:true,indices:[{parent:'matrix'},{parent:'matrix[1]'}]}).map(option=>option.name),['matrix[1]','matrix']);
 assert.deepEqual(arrayCopyOptions({name:'pid[1]',children:[],indices:[{parent:'pid'}]}).map(option=>option.name),['pid','pid[1]']);
 assert.deepEqual(arrayCopyOptions({name:'scalar'}),[]);assert.deepEqual(arrayCopyOptions({name:'values',array:true,children:[],indices:[{parent:'values'}]}).map(option=>option.name),['values']);
 assert.match(arrayCopyMessage('matrix',{root:'matrix',name:'matrix',status:'running',completed:2,total:6}).text,/2 \/ 6/);assert.equal(arrayCopyMessage('other',{root:'matrix',status:'error',error:'failed'}).text,'');assert.equal(arrayCopyMessage('matrix',{root:'matrix',status:'error',error:'failed'}).error,true);
});
test('clipboard failure keeps the complete text for an explicit user copy',async()=>{
 let copied,fallback;const text='{{1, 2}, {3, 4}}';assert.equal(await copyText(text,{clipboard:{writeText:async value=>{copied=value;}}}),true);assert.equal(copied,text);
 assert.equal(await copyText(text,{clipboard:{writeText:async()=>{throw Error('denied');}},fallback:value=>{fallback=value;}}),false);assert.equal(fallback,text);
});
