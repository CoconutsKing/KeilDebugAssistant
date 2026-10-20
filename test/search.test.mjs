import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchVariables} from '../app/public/search.js';
const variables=[{name:'joint_target_angles',type:'float[7]'},{name:'pid.kp',type:'float'},{name:'motor_joint',type:'int'},{name:'samples[4]',type:'float'}];
test('variable search matches names and types ignoring case and outer whitespace',()=>{assert.deepEqual(searchVariables(variables,'  JOINT ').map(v=>v.name),['joint_target_angles','motor_joint']);assert.equal(searchVariables(variables,'float').length,3);assert.equal(searchVariables(variables,'joint float')[0].name,'joint_target_angles');assert.equal(searchVariables(variables,'samples[4]')[0].name,'samples[4]');});
test('empty search restores all choices; missing result is empty without changing the source',()=>{assert.deepEqual(searchVariables(variables,''),variables);assert.deepEqual(searchVariables(variables,'missing'),[]);assert.equal(variables[0].name,'joint_target_angles');});
