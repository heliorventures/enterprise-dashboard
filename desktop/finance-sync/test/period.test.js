const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scopeFor}=require('../src/period');
test('period choices use local calendar dates including leap years and January rollover',()=>{
  assert.equal(scopeFor('full'),undefined);
  assert.deepEqual(scopeFor('today',new Date(2026,8,15,0,5)),{kind:'period',from:'2026-09-15',to:'2026-09-15'});
  assert.deepEqual(scopeFor('current-month',new Date(2026,8,15)),{kind:'period',from:'2026-09-01',to:'2026-09-30'});
  assert.deepEqual(scopeFor('last-month',new Date(2024,2,1)),{kind:'period',from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(scopeFor('last-month',new Date(2026,0,1)),{kind:'period',from:'2025-12-01',to:'2025-12-31'});
  assert.throws(()=>scopeFor('arbitrary'),/valid sync/);
});
