import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDwarf} from '../app/lib/catalog.mjs';
const dwarf=`
 <0><b>: Abbrev Number: 1 (DW_TAG_compile_unit)
 <1><10>: Abbrev Number: 2 (DW_TAG_variable)
 DW_AT_name : (indirect string, offset: 0): matrix
 DW_AT_type : <0x20>
 DW_AT_location : 5 byte block: 3 0 (DW_OP_addr: 20000000)
 <1><20>: Abbrev Number: 3 (DW_TAG_array_type)
 DW_AT_type : <0x50>
 <2><21>: Abbrev Number: 4 (DW_TAG_subrange_type)
 DW_AT_count : 3
 <2><22>: Abbrev Number: 4 (DW_TAG_subrange_type)
 DW_AT_upper_bound : 1
 <2><23>: Abbrev Number: 0
 <1><50>: Abbrev Number: 5 (DW_TAG_const_type)
 DW_AT_type : <0x60>
 <1><60>: Abbrev Number: 5 (DW_TAG_base_type)
 DW_AT_name : float
 <1><70>: Abbrev Number: 2 (DW_TAG_variable)
 DW_AT_name : object
 DW_AT_type : <0x80>
 DW_AT_location : (DW_OP_addr: 20000100)
 <1><80>: Abbrev Number: 6 (DW_TAG_class_type)
 DW_AT_name : Controller
 DW_AT_declaration : 1
 <1><90>: Abbrev Number: 6 (DW_TAG_class_type)
 DW_AT_name : Controller
 <2><91>: Abbrev Number: 7 (DW_TAG_member)
 DW_AT_name : gain
 DW_AT_type : <0x60>
 <2><92>: Abbrev Number: 7 (DW_TAG_member)
 DW_AT_name : next
 DW_AT_type : <0xa0>
 <2><93>: Abbrev Number: 0
 <1><a0>: Abbrev Number: 8 (DW_TAG_pointer_type)
 DW_AT_type : <0x80>
 <1><b0>: Abbrev Number: 9 (DW_TAG_subprogram)
 <2><b1>: Abbrev Number: 2 (DW_TAG_variable)
 DW_AT_name : local
 DW_AT_type : <0x60>
 DW_AT_location : (DW_OP_fbreg: 8)
`;
test('DWARF catalog resolves dimensions, typedef qualifiers, forward class declarations and pointers',()=>{
 const c=parseDwarf(dwarf);assert.deepEqual(c.variables.map(v=>v.name),['matrix','object']);assert.equal(c.describe('matrix').count,3);assert.equal(c.describe('matrix[1]').count,2);assert.equal(c.describe('matrix[1][0]').type,'float');assert.equal(c.describe('matrix[3]'),null);assert.equal(c.children('object').members[0].name,'object.gain');assert.equal(c.children('object.next').members[0].name,'object.next->gain');assert.equal(c.describe('object.next->gain').type,'float');assert.equal(c.describe('object.missing'),null);
});
test('DWARF union metadata prevents copying overlapping storage as independent aggregate members',()=>{
 const c=parseDwarf(dwarf+`\n <1><c0>: Abbrev Number: 2 (DW_TAG_variable)
 DW_AT_name : overlapping
 DW_AT_type : <0xd0>
 DW_AT_location : (DW_OP_addr: 20000200)
 <1><d0>: Abbrev Number: 6 (DW_TAG_union_type)
 DW_AT_name : Storage
 <2><d1>: Abbrev Number: 7 (DW_TAG_member)
 DW_AT_name : value
 DW_AT_type : <0x60>
 `);assert.equal(c.describe('overlapping').union,true);assert.equal(c.describe('overlapping').aggregate,true);
});
