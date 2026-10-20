import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32,makeZip,releaseFiles} from '../scripts/release.mjs';
test('release allowlist excludes all personal state and creates a valid ZIP directory',async()=>{
 const files=await releaseFiles(),names=files.map(f=>f.name);
 assert.ok(names.includes('app/server.mjs'));assert.ok(names.includes('app/scripts/discover.ps1'));assert.ok(names.includes('app/public/keil.ico'));
 assert.deepEqual(names.filter(n=>n.startsWith('userdata/')),['userdata/README.md']);assert.deepEqual(names.filter(n=>n.startsWith('data/')),['data/README.md']);
 assert.ok(!names.some(n=>/panel\.json|runtime\.json|research\/|\.git\/|\.uvoptx$|\.axf$/.test(n)));
 assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
 const zip=makeZip(files),end=zip.subarray(-22);assert.equal(end.readUInt32LE(),0x06054b50);assert.equal(end.readUInt16LE(10),files.length);
 let pos=end.readUInt32LE(16),count=0;while(zip.readUInt32LE(pos)===0x02014b50){const size=zip.readUInt16LE(pos+28),name=zip.subarray(pos+46,pos+46+size).toString(),local=zip.readUInt32LE(pos+42);assert.equal(zip.readUInt32LE(local),0x04034b50);assert.equal(zip.subarray(local+30,local+30+size).toString(),name);assert.ok(names.includes(name));count++;pos+=46+size;}
 assert.equal(count,files.length);
});
