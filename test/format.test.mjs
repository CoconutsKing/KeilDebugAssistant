import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatValue,isIntegerVariable} from '../app/public/format.js';
import {validateItem} from '../app/lib/model.mjs';

test('radix option is limited to scalar integer types',()=>{
 for(const type of ['int','unsigned char','volatile uint8_t','int64_t','uint_fast16_t','long long','bool','enum State','size_t'])assert.equal(isIntegerVariable({type}),true,type);
 for(const type of ['float','double','const long double','unknown','Controller'])assert.equal(isIntegerVariable({type}),false,type);
 for(const flag of ['pointer','array','aggregate'])assert.equal(isIntegerVariable({type:'int',[flag]:true}),false);
});

test('decimal and hexadecimal display preserves signed and 64-bit integer values exactly',()=>{
 for(const [raw,decimal,hex] of [['26','26','0x1A'],['0xFF','255','0xFF'],['-26','-26','-0x1A'],['-0x1A','-26','-0x1A'],['0','0','0x0'],['18446744073709551615','18446744073709551615','0xFFFFFFFFFFFFFFFF'],['-9223372036854775808','-9223372036854775808','-0x8000000000000000']]){
  assert.equal(formatValue({type:'int64_t',value:raw},false),decimal);assert.equal(formatValue({type:'int64_t',value:raw},true),hex);
 }
 assert.equal(formatValue({type:'float',value:'1.25',hex:true}),'1.25');assert.equal(formatValue({type:'int',value:'不可读',hex:true}),'不可读');assert.equal(formatValue({type:'int',hex:true}),'—');
});

test('root and member radix preferences round-trip without changing old configurations',()=>{
 const config=validateItem({name:'motor',hex:true,min:-10,max:100,step:2,members:{'motor.speed':{min:-5,max:50,step:1,hex:false}}});
 assert.equal(config.hex,true);assert.deepEqual(config.members['motor.speed'],{min:-5,max:50,step:1,hex:false});assert.deepEqual(validateItem(JSON.parse(JSON.stringify(config))),config);
 const onlyDisplay=validateItem({name:'motor',min:0,max:500,step:5,members:{'motor.speed':{hex:true}}});assert.deepEqual(onlyDisplay.members['motor.speed'],{hex:true},'changing display must not create an explicit range override');
 assert.equal(Object.hasOwn(validateItem({name:'old'}),'hex'),false);assert.throws(()=>validateItem({name:'motor',hex:'true'}),/十六进制/);assert.throws(()=>validateItem({name:'motor',members:{'motor.speed':{hex:1}}}),/十六进制/);
});
