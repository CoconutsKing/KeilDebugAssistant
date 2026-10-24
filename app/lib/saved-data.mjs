import {validName,validateWrite} from './model.mjs';
import {isIntegerVariable} from '../public/format.js';

const typeKey=type=>String(type||'').trim().replace(/\s+/g,' ');
const belongs=(root,name)=>validName(name)&&[root+'.',root+'['].some(prefix=>name.startsWith(prefix));
export function dataRows(rows){return rows.filter(row=>!row.pointer&&!row.array&&!row.aggregate&&!/\b(?:pointer|function|string|void)\b/i.test(row.type||''));}
export function restorableValue(row){
 if(!row.editable||row.pointer||row.array||row.aggregate)throw Error('成员不可写或尚未就绪');
 const raw=String(row.value??'').trim(),value=Number(raw);
 if(!raw||!Number.isFinite(value))throw Error('成员不是可恢复的有限数值');
 if((isIntegerVariable(row)||/enum|enumeration_type/i.test(row.type||''))&&!Number.isSafeInteger(value))throw Error('整型数值超出可精确写入范围');
 if(!/float|double/i.test(row.type||'')&&Number.isInteger(value)&&!Number.isSafeInteger(value))throw Error('数值超出可精确写入范围');
 return value;
}
export function validateSavedRecord(root,record){
 if(!validName(root)||!record||record.root!==root||typeof record.type!=='string'||record.type.length>512||typeof record.source!=='string'||record.source.length>2048||!Number.isFinite(record.savedAt)||record.savedAt<=0||!Array.isArray(record.values)||!record.values.length||record.values.length>512)throw Error('保存的数据格式无效');
 const names=new Set(),values=record.values.map(row=>{
  if(!row||!belongs(root,row.name)||names.has(row.name)||typeof row.type!=='string'||!row.type||row.type.length>512||typeof row.value!=='number'||!Number.isFinite(row.value))throw Error('保存的成员数据无效');
  if(row.targetType!==undefined&&(typeof row.targetType!=='string'||!row.targetType||row.targetType.length>512))throw Error('保存的 Keil 类型无效');
  restorableValue({...row,editable:true});names.add(row.name);return {name:row.name,type:typeKey(row.type),value:row.value,...(row.targetType?{targetType:typeKey(row.targetType)}:{})};
 });
 return {root,type:typeKey(record.type),source:record.source,savedAt:record.savedAt,values};
}
export function savedRecords(input){
 const records=Object.create(null);if(!input||typeof input!=='object'||Array.isArray(input))return records;
 for(const [root,record] of Object.entries(input)){try{records[root]=validateSavedRecord(root,record);}catch{}}
 return records;
}
export function restoreRows(record,rootType,rows,item){
 if(typeKey(record.type)!==typeKey(rootType))throw Error('数组或结构体类型已变化，请重新保存当前数据');
 const available=new Map(dataRows(rows).map(row=>[row.name,row]));
 return record.values.map(saved=>{
  const row=available.get(saved.name);if(!row)throw Error('已保存成员 '+saved.name+' 未在当前显示范围内，请恢复原勾选范围后再试');
  if(typeKey(row.type)!==typeKey(saved.type))throw Error('成员 '+saved.name+' 的类型已变化，请重新保存');
  const limits={...item,...item.members?.[saved.name]};
  try{validateWrite(limits,saved.value,saved.type);}catch(e){throw Error(saved.name+'：'+e.message+'，请先调整该成员的范围');}
  return {...saved};
 });
}
// Extended Watch can use typedef names while the compatibility API uses C base types.
function targetType(type){
 const name=typeKey(type).toLowerCase().replace(/\b(?:const|volatile|restrict)\b/g,'').replace(/\s+/g,' ').trim();
 const aliases={bool:'bool',_bool:'bool',float:'f32',float32_t:'f32',double:'f64',float64_t:'f64',int8_t:'i8',uint8_t:'u8','signed char':'i8','unsigned char':'u8',int16_t:'i16',uint16_t:'u16',short:'i16','short int':'i16','signed short':'i16','signed short int':'i16','unsigned short':'u16','unsigned short int':'u16',int:'i32',signed:'i32','signed int':'i32',long:'i32','long int':'i32','signed long':'i32',int32_t:'i32',unsigned:'u32','unsigned int':'u32','unsigned long':'u32','unsigned long int':'u32',uint32_t:'u32','long long':'i64','long long int':'i64',int64:'i64',int64_t:'i64',__int64:'i64','unsigned long long':'u64','unsigned long long int':'u64',uint64:'u64',uint64_t:'u64','unsigned __int64':'u64'};
 return aliases[name]||name;
}
export function sameTargetType(a,b){return targetType(a)===targetType(b);}
