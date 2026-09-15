const {test}=require('node:test');
const assert=require('node:assert/strict');
const source=require('../source-export');
test('period exports restrict vouchers and preserve full-context master balances',()=>{
  const scope={kind:'period',from:'2026-09-01',to:'2026-09-15'};
  const xml=source.request('VOUCHER','Example',scope);
  assert.match(xml,/>20260901<\/SVFROMDATE>/);
  assert.match(xml,/<FILTER>FinancePeriodFilter<\/FILTER>/);
  assert.match(source.request('LEDGER','Example',scope),/>19010101<\/SVFROMDATE>/);
  assert.throws(()=>source.request('VOUCHER','Example',{...scope,from:'2026-02-30'}),/date/i);
});
