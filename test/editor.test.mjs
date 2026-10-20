import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replaceConfiguredItem} from '../app/public/editor.js';
test('configured variable can be replaced, dropping old member overrides while preserving explicit settings',()=>{
 const items=[{name:'pid',min:-5,max:5,step:0.1,pinned:true,visibleMembers:['pid.kp'],members:{'pid.kp':{min:0,max:3,step:0.1}}},{name:'samples[0]',min:0,max:10,step:1}];
 const replacement={name:'controllers[1]',min:-5,max:5,step:0.1,pinned:true};const next=replaceConfiguredItem(items,'pid',replacement);
 assert.deepEqual(next[0],replacement);assert.ok(items[0].members);assert.ok(!next[0].members);
 assert.ok(replaceConfiguredItem(items,'pid',{...replacement,name:'pid'} )[0].members);
 assert.deepEqual(replaceConfiguredItem(items,'pid',{...replacement,name:'pid'})[0].visibleMembers,['pid.kp']);assert.equal(next[0].visibleMembers,undefined);
 assert.throws(()=>replaceConfiguredItem(items,'pid',{...replacement,name:'samples[0]'}),/已经在面板/);assert.throws(()=>replaceConfiguredItem(items,'gone',replacement),/已被移除/);
});
