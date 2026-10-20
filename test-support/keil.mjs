// Test-only target and type catalog. The release always uses the real Keil client.
import {cp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const initial={'motor.target_rpm':1200,'motor.actual_rpm':1187,'pid.kp':1.2,'pid.ki':0.08,'motor.enabled':1,'board.temperature':36.5};
const groups={motor:['motor.target_rpm','motor.actual_rpm','motor.enabled'],pid:['pid.kp','pid.ki'],board:['board.temperature']};
export function describe(name){
 if(groups[name])return {type:name==='pid'?'PID':'struct '+name,aggregate:true};
 if(name==='samples')return {type:'float[128]',array:true,count:128};
 if(name==='controllers')return {type:'Controller[4]',array:true,count:4};
 if(/^controllers\[[0-3]\]$/.test(name))return {type:'Controller',aggregate:true};
 if(name in initial||/^samples\[(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])\]$/.test(name)||/^controllers\[[0-3]\]\.(gain|enabled)$/.test(name))return {type:name.endsWith('enabled')||name.includes('rpm')?'int':'float'};
 return null;
}
function children(name,offset=0){
 let names=groups[name];
 if(name==='samples')names=Array.from({length:128},(_,i)=>`samples[${i}]`);
 if(name==='controllers')names=Array.from({length:4},(_,i)=>`controllers[${i}]`);
 if(/^controllers\[[0-3]\]$/.test(name))names=[name+'.gain',name+'.enabled'];
 if(!names)return null;
 const members=names.slice(offset,offset+64).map(name=>({name,...describe(name),expandable:!!(describe(name).array||describe(name).aggregate)}));
 return {members,total:names.length,offset,nextOffset:offset+members.length<names.length?offset+members.length:null};
}
export const fixtureCatalog={key:'fixture',binary:'',variables:[...Object.keys(groups),'samples','controllers',...Object.keys(initial)].map(name=>({name,...describe(name)})),describe,children};
export async function loadCatalog(){return fixtureCatalog;}
export class FixtureClient{
 constructor(){this.socket={destroyed:true};this.values=new Map(Object.entries(initial));}
 async connect(port){if(port!==47231)throw Error('测试端口未监听');this.socket.destroyed=false;}
 async status(){if(this.socket.destroyed)throw Error('连接已关闭');return 'running';}
 close(){this.socket.destroyed=true;}
 async read(name){await this.status();const meta=describe(name);if(!meta)throw Error('测试变量不存在：'+name);return {name,...meta,value:String(this.values.get(name)??(name.endsWith('enabled')?1:0)),editable:!meta.array&&!meta.aggregate};}
 async write(name,value){const before=await this.read(name);this.values.set(name,value);return {...await this.read(name),beforeValue:before.value};}
 async members(name){return children(name)?.members||[];}
}
export async function prepareFixture(dir){
 for(const file of ['app','scripts','package.json'])await cp(new URL('../'+file,import.meta.url),join(dir,file),{recursive:true});
 await cp(new URL('./keil.mjs',import.meta.url),join(dir,'fixture.mjs'));
 const project=join(dir,'fixture.uvprojx'),opt=join(dir,'fixture.uvoptx');
 await writeFile(project,'<Project/>');await writeFile(opt,'<WatchWindow1>'+Object.keys(initial).map(name=>'<ItemText>'+name+'</ItemText>').join('')+'</WatchWindow1>');
 const path=join(dir,'app/server.mjs'),source=await readFile(path,'utf8');
 await writeFile(path,source.replace("import {loadCatalog} from './lib/catalog.mjs';","import {loadCatalog,FixtureClient} from '../fixture.mjs';").replace('new SessionPool();',`new SessionPool({discover:async()=>[{port:47231,pid:1,title:'Keil UI Test',project:${JSON.stringify(project)}}],create:()=>new FixtureClient()});`));
 return {port:47231,project,opt,sessionKey:project.toLowerCase()};
}
