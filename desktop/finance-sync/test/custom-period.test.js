const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scopeFor}=require('../src/period');
test('custom months cover inclusive month boundaries without timezone conversion',()=>{
  assert.deepEqual(scopeFor({kind:'custom',fromMonth:'2021-01',toMonth:'2024-02'}),{kind:'period',from:'2021-01-01',to:'2024-02-29'});
  assert.deepEqual(scopeFor({kind:'custom',fromMonth:'2025-12',toMonth:'2026-01'}),{kind:'period',from:'2025-12-01',to:'2026-01-31'});
  assert.deepEqual(scopeFor({kind:'custom',fromMonth:'2023-02',toMonth:'2023-02'}),{kind:'period',from:'2023-02-01',to:'2023-02-28'});
});
test('custom month input rejects missing, impossible, reversed and unbounded values',()=>{
  for(const value of [null,{},'custom',{kind:'custom',fromMonth:'2026-02',toMonth:'2026-01'},{kind:'custom',fromMonth:'2026-13',toMonth:'2026-14'},{kind:'custom',fromMonth:'0000-01',toMonth:'2026-01'},{kind:'custom',fromMonth:'2021-1',toMonth:'2026-01'}])assert.throws(()=>scopeFor(value),/month|period/i);
});
