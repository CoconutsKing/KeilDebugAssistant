import {validName,validateItem} from './model.mjs';
const childOf=(root,name)=>name===root||[root+'.',root+'[',root+'->'].some(prefix=>name.startsWith(prefix));
export function arrayAxes(name,describe=()=>null){
 if(!validName(name))return [];const axes=[];let dimension=0;
 for(const match of name.matchAll(/\[(\d+)\]/g)){
  const parent=name.slice(0,match.index),meta=describe(parent);if(!meta||meta.array)axes.push({dimension,parent,index:Number(match[1]),count:Number.isSafeInteger(meta?.count)&&meta.count>0?meta.count:null,start:match.index,end:match.index+match[0].length});dimension++;
 }
 const meta=describe(name);if(meta?.array)axes.push({dimension,parent:name,index:null,count:Number.isSafeInteger(meta.count)&&meta.count>0?meta.count:null,start:name.length,end:name.length});return axes;
}
export function reindexItem(item,dimension,index,describe){
 const axis=arrayAxes(item.name,describe).find(axis=>axis.dimension===dimension);if(!axis||!axis.count)throw Error('数组长度尚不可用，请先编译工程并连接正确的 Keil 窗口');
 if(index!==null&&(!Number.isInteger(index)||index<0||index>=axis.count))throw Error(`数组下标须为 0～${axis.count-1} 的整数`);
 const name=index===null?axis.parent:item.name.slice(0,axis.start)+'['+index+']'+item.name.slice(axis.end);if(!validName(name)||!describe(name))throw Error('该数组元素或成员不存在');
 if(name===item.name)return validateItem(item);const next={...item,name};delete next.members;delete next.visibleMembers;
 if(childOf(item.name,name)){
  // Whole array -> one branch: keep only that branch's explicit settings.
  const scalar=describe(name);if(!scalar.array&&!scalar.aggregate&&!scalar.pointer)Object.assign(next,item.members?.[name]);
  else{if(item.members)next.members=Object.fromEntries(Object.entries(item.members).filter(([path])=>childOf(name,path)&&path!==name));if(item.visibleMembers)next.visibleMembers=item.visibleMembers.filter(path=>childOf(name,path)&&path!==name);}
 }else if(childOf(name,item.name)){
  // Returning to a whole array shows the array; old branch overrides stay scoped.
  if(item.members)next.members={...item.members};
 }else{
  if(item.members)next.members=Object.fromEntries(Object.entries(item.members).map(([path,value])=>[name+path.slice(item.name.length),value]));
  if(item.visibleMembers)next.visibleMembers=item.visibleMembers.map(path=>name+path.slice(item.name.length));
 }
 return validateItem(next);
}
