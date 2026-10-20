import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMemberSelection} from '../app/public/member-picker.js';
import {connectionNotices} from '../app/public/notices.js';
import {selectedRows} from '../app/lib/groups.mjs';
import {validateItem} from '../app/lib/model.mjs';

test('bulk member selection searches metadata, changes only matching rows, and preserves canonical order',()=>{
 const rows=[{name:'pid.kp',type:'float'},{name:'pid.ki',type:'float'},{name:'pid.enabled',type:'bool'}],model=createMemberSelection(rows);
 assert.equal(model.count,3);assert.equal(model.value(),undefined);model.set(model.rows('FLOAT').map(v=>v.name),false);assert.deepEqual(model.value(),['pid.enabled']);
 model.set(['pid.ki','pid.kp','foreign'],true);assert.equal(model.value(),undefined);model.set(rows.map(v=>v.name),false);assert.deepEqual(model.value(),[]);assert.equal(model.rows('  pid.KP float ')[0].name,'pid.kp');
 const original=['pid.enabled','pid.kp'],restored=createMemberSelection(rows,original);assert.deepEqual(restored.value(),['pid.kp','pid.enabled']);assert.deepEqual(original,['pid.enabled','pid.kp']);assert.equal(restored.rows('missing').length,0);
});

test('group filtering and configuration distinguish all, selected, and zero members',()=>{
 const rows=[{name:'a[0]'},{name:'a[1]'}],plan={rows,group:true};assert.equal(selectedRows(plan,undefined),rows);assert.deepEqual(selectedRows(plan,['a[1]']),[rows[1]]);assert.deepEqual(selectedRows(plan,[]),[]);
 const config=validateItem({name:'a',visibleMembers:['a[1]']});assert.deepEqual(config.visibleMembers,['a[1]']);assert.deepEqual(validateItem(JSON.parse(JSON.stringify(config))),config);assert.deepEqual(validateItem({name:'a',visibleMembers:[]}).visibleMembers,[]);assert.equal(Object.hasOwn(validateItem({name:'old'}),'visibleMembers'),false);
 for(const visibleMembers of [null,'a[1]',['a[0]','a[0]'],['other.x'],['a[0]++'],Array.from({length:513},(_,i)=>'a['+i+']')])assert.throws(()=>validateItem({name:'a',visibleMembers}),/显示成员列表/);
});

test('connection area suppresses normal diagnostics while retaining real errors and warnings',()=>{
 const normal={status:'running',selection:'4824',compatibility:'兼容读取模式：进入 Debug 前连接可启用类成员枚举',discovering:true,sessions:[{port:4824}],lastError:'',sessionError:''};assert.deepEqual(connectionNotices(normal),{error:'',warning:''});
 assert.deepEqual(connectionNotices({...normal,status:'connecting',lastError:'正在后台识别 Keil 窗口…'}),{error:'',warning:''});
 assert.equal(connectionNotices({...normal,status:'waiting',lastError:'等待 Debug：请进入调试'}).error,'等待 Debug：请进入调试');assert.equal(connectionNotices({...normal,status:'error',lastError:'连接超时'}).error,'连接超时');
 assert.match(connectionNotices({...normal,sessionError:'窗口识别失败'}).warning,/窗口识别失败/);assert.match(connectionNotices({...normal,sessions:[{port:null}]}).warning,/未监听端口/);
});
