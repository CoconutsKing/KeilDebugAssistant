import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parentPort,workerData} from 'node:worker_threads';
import {hash,unpackRelease} from './update-package.mjs';

export async function stagePackage({archive,digest,version,jobDir}){
 if(hash(archive)!==digest)throw Error('更新包 SHA256 校验失败');const files=unpackRelease(archive,version);
 await mkdir(jobDir);const payload=join(jobDir,'payload');await mkdir(payload);
 for(const file of files){const target=join(payload,...file.name.split('/'));await mkdir(join(target,'..'),{recursive:true});await writeFile(target,file.data,{flag:'wx'});}
 const manifest={version,digest,files:files.map(({name,data})=>({name,hash:hash(data)}))};await writeFile(join(jobDir,'manifest.json'),JSON.stringify(manifest),{flag:'wx'});return {jobDir,version};
}
if(parentPort)stagePackage(workerData).then(result=>parentPort.postMessage({result})).catch(error=>parentPort.postMessage({error:error.message}));
