import {readFile,stat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validName} from './model.mjs';
const run=promisify(execFile);
const unwrapTags=new Set(['typedef','const_type','volatile_type','restrict_type','atomic_type']);
const decode=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
export function parseDwarf(text){
 const entries=new Map(),stack=[];let current;
 for(const line of text.split(/\r?\n/)){
  const die=line.match(/^\s*<(\d+)><([\da-f]+)>: Abbrev Number: \d+(?: \(DW_TAG_(\w+)\))?/i);
  if(die){const depth=Number(die[1]);stack.length=depth;current=null;if(!die[3])continue;current={id:parseInt(die[2],16),tag:die[3],attrs:{},children:[],parent:stack[depth-1]};entries.set(current.id,current);current.parent?.children.push(current);stack[depth]=current;continue;}
  const attr=line.match(/DW_AT_(\w+)\s*:\s*(.*)/);if(current&&attr)current.attrs[attr[1]]=attr[2].replace(/^\(indirect[^)]*\):\s*/,'').trim();
 }
 const ref=s=>{const m=s?.match(/<0x([\da-f]+)>/i);return m?entries.get(parseInt(m[1],16)):null;};
 const fullTypes=new Map();for(const e of entries.values())if(['class_type','structure_type','union_type'].includes(e.tag)&&e.attrs.name&&e.children.some(c=>c.tag==='member')){const prior=fullTypes.get(e.attrs.name);if(!prior||e.children.length>prior.children.length)fullTypes.set(e.attrs.name,e);}
 function attr(e,key,seen=new Set()){if(!e||seen.has(e.id))return undefined;seen.add(e.id);return e.attrs[key]??attr(ref(e.attrs.specification||e.attrs.abstract_origin),key,seen);}
 function unwrapped(e){const seen=new Set();while(e&&unwrapTags.has(e.tag)&&!seen.has(e.id)){seen.add(e.id);e=ref(e.attrs.type);}if(e?.attrs.declaration&&fullTypes.has(e.attrs.name))e=fullTypes.get(e.attrs.name);return e;}
 function shape(type,dimensions){let e=unwrapped(type);if(!e)return {entry:null,dims:[]};const dims=dimensions??(e.tag==='array_type'?e.children.filter(c=>c.tag==='subrange_type').map(c=>{const n=c.attrs.count??(c.attrs.upper_bound!==undefined?String(Number(c.attrs.upper_bound)+1-Number(c.attrs.lower_bound||0)):null);return n===null?null:Number(n);}):[]);return {entry:e,dims};}
 function info(s){const e=s.entry;if(!e)return {type:'unknown',array:false,aggregate:false,pointer:false,count:0};const array=e.tag==='array_type'&&s.dims.length>0,aggregate=['class_type','structure_type','union_type'].includes(e.tag);return {type:array?(unwrapped(ref(e.attrs.type))?.attrs.name||'元素')+s.dims.map(n=>`[${n??'?'}]`).join(''):e.attrs.name||(e.tag==='pointer_type'?'pointer':e.tag),array,aggregate,pointer:e.tag==='pointer_type',...(e.tag==='union_type'?{union:true}:{}),count:array?s.dims[0]:aggregate?e.children.filter(c=>c.tag==='member').length:0};}
 const globals=new Map();for(const e of entries.values()){
  if(e.tag!=='variable'||!/DW_OP_addr:/.test(e.attrs.location||''))continue;
  // Include namespace globals and static objects with concrete locations, exclude stack locals.
  if(e.parent&&!['compile_unit','namespace'].includes(e.parent.tag))continue;
  let name=attr(e,'name');if(!name)continue;
  let parent=e.parent;while(parent&&parent.tag!=='compile_unit'){if(parent.tag==='namespace'&&parent.attrs.name)name=parent.attrs.name+'::'+name;parent=parent.parent;}
  if(!validName(name))continue;const type=ref(attr(e,'type'));if(type)globals.set(name,{name,type,shape:shape(type)});
 }
 function find(name){
  const root=[...globals.keys()].filter(n=>name===n||name.startsWith(n+'.')||name.startsWith(n+'[')||name.startsWith(n+'->')).sort((a,b)=>b.length-a.length)[0];if(!root)return null;
  let s=globals.get(root).shape,rest=name.slice(root.length),path=root;
  while(rest){const index=rest.match(/^\[(\d+)\]/);if(index){if(s.entry?.tag!=='array_type'||!s.dims.length)return null;const i=Number(index[1]);if(!Number.isInteger(s.dims[0])||i>=s.dims[0])return null;s=s.dims.length>1?shape(s.entry,s.dims.slice(1)):shape(ref(s.entry.attrs.type));path+=index[0];rest=rest.slice(index[0].length);continue;}
   const member=rest.match(/^(\.|->)([A-Za-z_$][\w$]*)/);if(!member)return null;let e=s.entry;if(member[1]==='->'){if(e?.tag!=='pointer_type')return null;e=unwrapped(ref(e.attrs.type));}if(!e)return null;
   const child=e.children.find(c=>c.tag==='member'&&attr(c,'name')===member[2]);if(!child)return null;s=shape(ref(attr(child,'type')));path+=member[0];rest=rest.slice(member[0].length);
  }return s;
 }
 function children(name,offset=0){let s=find(name);if(!s)return null;let meta=info(s);if(meta.array){if(!Number.isSafeInteger(meta.count)||meta.count<0)return null;const members=Array.from({length:Math.max(0,Math.min(64,meta.count-offset))},(_,i)=>{const path=`${name}[${offset+i}]`;const child=info(find(path));return {name:path,...child,expandable:child.array||child.aggregate||child.pointer};});return {members,total:meta.count,offset,nextOffset:offset+members.length<meta.count?offset+members.length:null};}
  let e=s.entry,separator='.';if(e?.tag==='pointer_type'){e=unwrapped(ref(e.attrs.type));separator='->';}
  if(!e)return null;const members=e.children.filter(c=>c.tag==='member'&&attr(c,'name')).map(c=>{const child=info(shape(ref(attr(c,'type'))));return {name:name+separator+attr(c,'name'),...child,expandable:child.array||child.aggregate||child.pointer};}).filter(v=>validName(v.name));return {members,total:members.length,offset:0,nextOffset:null};
 }
 return {variables:[...globals.values()].map(v=>({name:v.name,...info(v.shape)})).sort((a,b)=>a.name.localeCompare(b.name)),describe:name=>{const s=find(name);return s?info(s):null;},children};
}
let cache;
export async function loadCatalog(projectPath){
 if(!projectPath)throw Error('请先导入当前 Keil 工程的 Watch 配置，以定位编译产物');
 const project=projectPath.replace(/\.uvoptx$/i,'.uvprojx'),xml=await readFile(project,'utf8');
 const directory=decode(xml.match(/<OutputDirectory>(.*?)<\/OutputDirectory>/s)?.[1]||''),name=decode(xml.match(/<OutputName>(.*?)<\/OutputName>/s)?.[1]||'');if(!name)throw Error('工程未配置输出名称');
 const binary=resolve(dirname(project),directory.replace(/\\/g,'/'),name.endsWith('.axf')?name:name+'.axf');const details=await stat(binary);const key=binary+':'+details.mtimeMs;
 if(cache?.key===key)return cache;
 let result;try{result=await run('arm-none-eabi-readelf',['--debug-dump=info',binary],{maxBuffer:128*1024*1024,timeout:20000,windowsHide:true});}catch(e){throw Error('无法读取 AXF 调试信息，请确保 ARM GNU 工具链的 arm-none-eabi-readelf 在 PATH 中：'+e.message);}
 const catalog=parseDwarf(result.stdout);cache={key,binary,warning:result.stderr?.trim()||'',...catalog};return cache;
}
