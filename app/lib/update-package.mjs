import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';

export const repository='CoconutsKing/KeilDebugAssistant';
export const releasePage=`https://github.com/${repository}/releases`;
export const archiveLimit=32*1024*1024;
export const requiredFiles=['package.json','app/server.mjs','scripts/start.mjs','scripts/stop.mjs','start.cmd','stop.bat'];
export const installUnits=['app','docs','scripts/start.mjs','scripts/stop.mjs','start.cmd','stop.bat','package.json','README.md','CHANGELOG.md'];
export function versionParts(version){const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);if(!match||match.slice(1).some(n=>Number(n)>2147483647))throw Error('版本号无效');return match.slice(1).map(Number);}
export function newerVersion(next,current){const a=versionParts(next),b=versionParts(current);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
export function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function allowedFile(name){return typeof name==='string'&&name.length<240&&!name.includes('\\')&&!name.includes(':')&&!name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$|[\x00-\x1f]/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))&&(/^(?:app|docs)\//.test(name)||['scripts/start.mjs','scripts/stop.mjs','start.cmd','stop.bat','package.json','README.md','CHANGELOG.md','userdata/README.md','data/README.md'].includes(name));}
export function installable(name){return allowedFile(name)&&!name.startsWith('userdata/')&&!name.startsWith('data/');}
export function releaseInfo(release){
 if(!release||release.draft||release.prerelease)throw Error('未找到正式版本');
 const version=versionParts(release.tag_name).join('.'),tag=release.tag_name,name=`KeilDebugAssistant-v${version}-windows.zip`,prefix=`https://github.com/${repository}/releases/download/${tag}/`;
 const asset=release.assets?.find(a=>a.name===name),checksum=release.assets?.find(a=>a.name===name+'.sha256');
 if(!asset||!checksum||asset.browser_download_url!==prefix+name||checksum.browser_download_url!==prefix+name+'.sha256'||asset.size>archiveLimit)throw Error('正式版缺少有效的 Windows 压缩包或 SHA256 文件');
 return {version,tag,name,url:prefix+name,checksumURL:prefix+name+'.sha256',page:`${releasePage}/tag/${tag}`,...(asset.digest?{digest:asset.digest}:{}),...(asset.size?{size:asset.size}:{})};
}
export function checksumValue(text,name){const match=/^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/i.exec(text);if(!match||match[2]!==name)throw Error('SHA256 文件格式不正确');return match[1].toLowerCase();}
export function unpackRelease(bytes,version){
 const archive=Buffer.from(bytes);if(archive.length<22||archive.length>archiveLimit)throw Error('更新包大小无效');
 const end=archive.length-22;if(archive.readUInt32LE(end)!==0x06054b50||archive.readUInt16LE(end+20)!==0||archive.readUInt32LE(end+4)!==0)throw Error('不支持的 ZIP 格式');
 const count=archive.readUInt16LE(end+10),offset=archive.readUInt32LE(end+16),length=archive.readUInt32LE(end+12);
 if(!count||count>1024||count!==archive.readUInt16LE(end+8)||offset+length!==end)throw Error('ZIP 目录无效');
 const files=[],seen=new Set();let position=offset,total=0;
 for(let i=0;i<count;i++){
  if(position+46>end||archive.readUInt32LE(position)!==0x02014b50)throw Error('ZIP 目录损坏');
  const flags=archive.readUInt16LE(position+8),method=archive.readUInt16LE(position+10),crc=archive.readUInt32LE(position+16),packed=archive.readUInt32LE(position+20),size=archive.readUInt32LE(position+24),nameLength=archive.readUInt16LE(position+28),extra=archive.readUInt16LE(position+30),comment=archive.readUInt16LE(position+32),local=archive.readUInt32LE(position+42);
  const attributes=archive.readUInt32LE(position+38),disk=archive.readUInt16LE(position+34),name=archive.subarray(position+46,position+46+nameLength).toString('utf8');
  position+=46+nameLength+extra+comment;total+=size;
  if(position>end||disk||!allowedFile(name)||seen.has(name.toLowerCase())||flags&1||![0,8].includes(method)||total>64*1024*1024||size>16*1024*1024||(attributes>>>16&0xf000)===0xa000)throw Error('ZIP 包含无效、重复或不允许的文件');
  seen.add(name.toLowerCase());
  if(local+30>offset||archive.readUInt32LE(local)!==0x04034b50||archive.readUInt16LE(local+8)!==method||archive.readUInt16LE(local+6)!==flags)throw Error('ZIP 文件头无效');
  const localNameLength=archive.readUInt16LE(local+26),localExtra=archive.readUInt16LE(local+28),start=local+30+localNameLength+localExtra;
  if(start+packed>offset||archive.subarray(local+30,local+30+localNameLength).toString('utf8')!==name)throw Error('ZIP 文件边界无效');
  const compressed=archive.subarray(start,start+packed),data=method===0?Buffer.from(compressed):inflateRawSync(compressed,{maxOutputLength:Math.max(1,size)});
  if(data.length!==size||crc32(data)!==crc)throw Error('ZIP 文件校验失败');files.push({name,data});
 }
 if(position!==end||requiredFiles.some(name=>!files.some(f=>f.name===name)))throw Error('更新包缺少主程序或启动文件');
 const pack=JSON.parse(files.find(f=>f.name==='package.json').data.toString());if(pack.name!=='keil-debug-assistant'||pack.version!==version)throw Error('更新包版本与 Release 不一致');
 return files.filter(f=>installable(f.name));
}
