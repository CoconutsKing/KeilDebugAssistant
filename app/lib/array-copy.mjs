import {validName} from './model.mjs';
import {isIntegerVariable,formatValue} from '../public/format.js';

export function initializerPlan(root,catalog,{maxLeaves=16384,maxDepth=16,maxNodes=65536}={}){
 if(!validName(root)||!catalog?.describe(root))throw Error('变量类型信息不可用，请先编译工程并连接正确的 Keil 窗口');
 const rows=[],skipped=[];let nodes=0;
 const omit=(name,reason)=>{skipped.push({name,reason});return {name,omitted:true};};
 function walk(name,depth){
  if(++nodes>maxNodes||depth>maxDepth)throw Error('数组嵌套过深或成员过多，请选择较小的子数组');
  const meta=catalog.describe(name);if(!meta)return omit(name,'类型信息不可用');
  if(meta.pointer||meta.union||/\b(?:pointer|function|void|string|union_type|reference_type|rvalue_reference_type)\b/i.test(meta.type||''))return omit(name,'非独立数值成员，已跳过');
  if(meta.array||meta.aggregate){
   const children=[],names=new Set();let offset=0,total=null;
   do{
    const page=catalog.children(name,offset);if(!page||!Array.isArray(page.members)||!page.members.length){if(!offset)return omit(name,'没有可枚举的数值成员');throw Error(name+'：成员信息不完整');}
    if(!Number.isSafeInteger(page.total)||page.total<1||total!==null&&page.total!==total)throw Error(name+'：成员数量信息无效');total=page.total;
    if(meta.array&&(!Number.isSafeInteger(meta.count)||meta.count<1||page.total!==meta.count))throw Error(name+'：数组长度信息无效');
    if(page.members.length>maxNodes-nodes)throw Error('数组成员过多，请选择较小的子数组');
    for(const child of page.members){
     const expected=meta.array?name+'['+children.length+']':null;
     if(!validName(child.name)||expected&&child.name!==expected||!meta.array&&!child.name.startsWith(name+'.')||names.has(child.name))throw Error(name+'：成员顺序或路径不完整');
     names.add(child.name);
     if(!meta.array&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(child.name.slice(name.length+1)))children.push(omit(child.name,'不是可用的 C++ 成员名'));
     else children.push(walk(child.name,depth+1));
    }
    const next=page.nextOffset;if(next!==null&&(!Number.isInteger(next)||next<=offset||next!==children.length))throw Error(name+'：成员分页信息无效');offset=next;
   }while(offset!==null);
   if(children.length!==total||meta.array&&children.length!==meta.count)throw Error(name+'：数组或结构体成员信息不完整');
   return {name,kind:meta.array?'array':'object',children};
  }
  if(rows.length>=maxLeaves)throw Error('一次最多复制 '+maxLeaves+' 个数值，请选择较小的子数组；本次未生成不完整数据');
  const row={name,type:meta.type};rows.push(row);return row;
 }
 const meta=catalog.describe(root);if(!meta.array&&!meta.aggregate)throw Error('请选择数组或结构体');
 const tree=walk(root,0);if(!rows.length)throw Error('所选范围内没有可复制的数字'+(skipped.length?`（已跳过 ${skipped.length} 项）`:''));return {tree,rows,skipped};
}

export function cppNumber(actual){
 if(!actual||actual.pointer||actual.array||actual.aggregate)throw Error('成员不是数值类型');
 const type=String(actual.valueType||actual.type||''),raw=String(actual.value??'').trim();
 if(isIntegerVariable({...actual,type})||/enumeration_type/i.test(type)){
  const value=formatValue({...actual,type:/enumeration_type/i.test(type)?'enum':type},false);
  if(!/^-?\d+$/.test(value))throw Error('整型成员数据无效');const integer=BigInt(value);
  if(integer<-(1n<<63n)||integer>(1n<<64n)-1n)throw Error('整数超出 C++ 64 位范围');
  if(integer===-(1n<<63n))return '(-9223372036854775807LL - 1)';
  return value+(integer>(1n<<63n)-1n?'ULL':integer>2147483647n||integer<-2147483648n?'LL':'');
 }
 if(!/float|double/i.test(type)||!raw||!Number.isFinite(Number(raw)))throw Error('成员不是有限数值');
 const value=Number(raw),single=!/double/i.test(type),number=single?Math.fround(value):value;
 if(!Number.isFinite(number))throw Error('浮点成员超出有效范围');
 let text=Object.is(number,-0)?'-0':String(Number(number.toPrecision(single?9:17)));
 if(!/[.e]/i.test(text))text+='.0';return text+(single?'f':'');
}

export function cppInitializer(tree,values){
 function format(node,depth){
  if(node.omitted)return null;
  if(!node.children){if(!values.has(node.name))return null;try{return cppNumber(values.get(node.name));}catch{return null;}}
  const parts=node.children.map(child=>({child,text:format(child,depth+1)}));if(parts.every(part=>part.text===null))return null;
  const included=node.kind==='object'?parts.filter(part=>part.text!==null).map(part=>({child:part.child,text:'.'+part.child.name.slice(node.name.length+1)+' = '+part.text})):parts.map(part=>({...part,text:part.text??'{}'}));
  if(included.every(part=>!part.child.children))return '{'+included.map(part=>part.text).join(', ')+'}';
  const indent='  '.repeat(depth);return '{\n'+included.map(part=>indent+'  '+part.text).join(',\n')+'\n'+indent+'}';
 }
 const text=format(tree,0);if(text===null)throw Error('所选范围内没有可复制的数字，请检查可读成员');return text;
}
