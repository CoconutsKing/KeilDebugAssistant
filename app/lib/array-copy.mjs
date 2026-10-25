import {validName} from './model.mjs';
import {isIntegerVariable,formatValue} from '../public/format.js';

export function initializerPlan(root,catalog,{maxLeaves=16384,maxDepth=16,maxNodes=65536}={}){
 if(!validName(root)||!catalog?.describe(root))throw Error('变量类型信息不可用，请先编译工程并连接正确的 Keil 窗口');
 const rows=[];let nodes=0;
 function walk(name,depth){
  if(++nodes>maxNodes||depth>maxDepth)throw Error('数组嵌套过深或成员过多，请选择较小的子数组');
  const meta=catalog.describe(name);if(!meta||meta.pointer||meta.union||/\b(?:pointer|function|void|string|union_type)\b/i.test(meta.type||''))throw Error(name+'：此类型无法转换为数值初始化列表');
  if(meta.array||meta.aggregate){
   const children=[],names=new Set();let offset=0,total=null;
   do{
    const page=catalog.children(name,offset);if(!page||!Array.isArray(page.members)||!page.members.length)throw Error(name+'：成员信息不完整');
    if(!Number.isSafeInteger(page.total)||page.total<1||total!==null&&page.total!==total)throw Error(name+'：成员数量信息无效');total=page.total;
    if(meta.array&&(!Number.isSafeInteger(meta.count)||meta.count<1||page.total!==meta.count))throw Error(name+'：数组长度信息无效');
    if(page.members.length>maxNodes-nodes)throw Error('数组成员过多，请选择较小的子数组');
    for(const child of page.members){
     const expected=meta.array?name+'['+children.length+']':null;
     if(!validName(child.name)||expected&&child.name!==expected||!meta.array&&!child.name.startsWith(name+'.')||names.has(child.name))throw Error(name+'：成员顺序或路径不完整');
     names.add(child.name);children.push(walk(child.name,depth+1));
    }
    const next=page.nextOffset;if(next!==null&&(!Number.isInteger(next)||next<=offset||next!==children.length))throw Error(name+'：成员分页信息无效');offset=next;
   }while(offset!==null);
   if(children.length!==total||meta.array&&children.length!==meta.count)throw Error(name+'：数组或结构体成员信息不完整');
   return {name,children};
  }
  if(rows.length>=maxLeaves)throw Error('一次最多复制 '+maxLeaves+' 个数值，请选择较小的子数组；本次未生成不完整数据');
  const row={name,type:meta.type};rows.push(row);return row;
 }
 const meta=catalog.describe(root);if(!meta.array&&!meta.aggregate)throw Error('请选择数组或结构体');
 const tree=walk(root,0);return {tree,rows};
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
  if(!node.children){if(!values.has(node.name))throw Error(node.name+'：未读取到完整数据');return cppNumber(values.get(node.name));}
  if(node.children.every(child=>!child.children))return '{'+node.children.map(child=>format(child,depth+1)).join(', ')+'}';
  const indent='  '.repeat(depth);return '{\n'+node.children.map(child=>indent+'  '+format(child,depth+1)).join(',\n')+'\n'+indent+'}';
 }
 return format(tree,0);
}
