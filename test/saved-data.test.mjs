import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dataRows,restorableValue,validateSavedRecord,savedRecords,restoreRows,sameTargetType} from '../app/lib/saved-data.mjs';
import {savedDataMessage} from '../app/public/saved-data.js';

const record={root:'pid',type:'PID',source:'fixture.uvoptx',savedAt:1,values:[{name:'pid.kp',type:'float',value:2.5},{name:'pid.ki',type:'float',value:0.4}]};
test('Keil raw type checks accept compatible typedefs across Debug modes and reject storage changes',()=>{
 assert.equal(sameTargetType('uint32_t','unsigned int'),true);assert.equal(sameTargetType('volatile float','float32_t'),true);
 for(const [a,b] of [['float','int'],['float','double'],['uint32_t','int32_t'],['int16_t','int'],['PID*','int']])assert.equal(sameTargetType(a,b),false);
});
test('saved data preserves exact finite numeric values and rejects pointers, unsafe integers and injected expressions',()=>{
 assert.equal(restorableValue({type:'float',value:'0.0800000057',editable:true}),0.0800000057);
 assert.equal(restorableValue({type:'int',value:'0x20',editable:true}),32);
 for(const row of [{type:'uint64',value:'9007199254740993',editable:true},{type:'float',value:'NaN',editable:true},{type:'float',value:'1',editable:false},{type:'pointer',value:'0x20',editable:true,pointer:true}])assert.throws(()=>restorableValue(row));
 assert.equal(dataRows([{name:'pid.kp',type:'float'},{name:'pid.p',pointer:true},{name:'pid.array',array:true},{name:'pid.fn',type:'function'}]).length,1);
 assert.deepEqual(validateSavedRecord('pid',JSON.parse(JSON.stringify(record))),record);
 assert.throws(()=>validateSavedRecord('pid',{...record,values:[{name:'other.kp',type:'float',value:2}]}));
 assert.throws(()=>validateSavedRecord('pid',{...record,values:[{name:'pid.kp=3',type:'float',value:2}]}));
 assert.throws(()=>validateSavedRecord('pid',{...record,values:[record.values[0],record.values[0]]}));
 const restored=savedRecords({pid:record,broken:{}});assert.deepEqual(restored.pid,record);assert.equal(Object.hasOwn(restored,'broken'),false);
});
test('restore checks every saved member and range before any write, retaining explicit bulk selection',()=>{
 const rows=record.values.map(row=>({...row,editable:false})),item={name:'pid',min:0,max:10};
 assert.deepEqual(restoreRows(record,'PID',rows,item),record.values);
 assert.throws(()=>restoreRows(record,'OtherPID',rows,item),/类型已变化/);
 assert.throws(()=>restoreRows(record,'PID',[rows[0]],item),/未在当前显示范围/);
 assert.throws(()=>restoreRows(record,'PID',[rows[0],{...rows[1],type:'double'}],item),/类型已变化/);
 assert.throws(()=>restoreRows(record,'PID',rows,{...item,members:{'pid.ki':{min:0,max:0.1}}}),/pid.ki.*超出范围/);
});
test('group feedback distinguishes checking, restored readback, partial failure, and another component',()=>{
 const item={name:'pid',savedData:{count:2,savedAt:1}},job={root:'pid',action:'restore',status:'running',phase:'checking',checked:1,total:2,completed:0};
 assert.match(savedDataMessage(item,job).text,/检查 1 \/ 2/);
 assert.match(savedDataMessage(item,{...job,phase:'writing',completed:1}).text,/恢复 1 \/ 2/);
 assert.match(savedDataMessage(item,{...job,status:'done',completed:2}).text,/恢复 2 项并回读/);
 assert.deepEqual(savedDataMessage(item,{...job,status:'error',error:'已确认恢复 1 / 2 项'}),{text:'已确认恢复 1 / 2 项',error:true});
 assert.match(savedDataMessage(item,{...job,root:'other'}).text,/已保存 2 项/);
});
