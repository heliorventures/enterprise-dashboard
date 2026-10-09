const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stage, shouldPublish } = require('../src/intelligence/imports/publication');
const columns = [{canonical:'Name',target:'account_name'}, {canonical:'Debit',target:'pending_bill_debit',type:'decimal'}];
test('full snapshot rejects duplicate accounts instead of last-row-wins or summation', () => {
  const analysis = {rows:[{rowType:'DETAIL',raw:{Name:'Alpha',Debit:'1.00'},sourceRowNumber:1}, {rowType:'DETAIL',raw:{Name:' alpha ',Debit:'2.00'},sourceRowNumber:2}]};
  const result = stage(analysis,columns,[{field_key:'account_name'}],{});
  assert.equal(result.validation.canProcess,false);
  assert.equal(result.staged[1].errors[0].code,'DUPLICATE_ACCOUNT');
});
test('exact totals and configurable total rejection survive large balances', () => {
  const result = stage({rows:[{rowType:'DETAIL',raw:{Name:'Alpha',Debit:'90071992547409.91'}}, {rowType:'TOTAL',raw:{Debit:'90071992547409.92'}}]},columns,[],{fail_import_on_total_mismatch:{enabled:true}});
  assert.equal(result.totals.calcDebit,'90071992547409.91');
  assert.equal(result.validation.canProcess,false);
});
test('publication selects latest dated generation while undated and older remain history', () => {
  assert.equal(shouldPublish('2026-09-30','2026-08-31'),false);
  assert.equal(shouldPublish('2026-09-30',null),false);
  assert.equal(shouldPublish('2026-09-30','2026-09-30'),true);
  assert.equal(shouldPublish(null,'2026-09-30'),true);
});
test('duplicate financial targets reject ambiguous scalar overwrite',()=>{
  const result=stage({rows:[{rowType:'DETAIL',raw:{Name:'Alpha',Debit:'1.00',Other:'2.00'}}]},[...columns,{canonical:'Other',target:'pending_bill_debit'}],[],{});
  assert.equal(result.validation.canProcess,false);
  assert.equal(result.validation.issues[0].errors[0].code,'DUPLICATE_TARGET');
});
