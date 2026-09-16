const {test}=require('node:test');
const assert=require('node:assert/strict');
const source=require('../source-export');
const node=(tag,fields={},content=[])=>({tag,attributes:{},content:[...Object.entries(fields).map(([tag,value])=>({tag,attributes:{},content:[value]})),...content]});
test('export explicitly asks for company currency, accounting dates and bill allocations',()=>{
  assert.match(source.fetchList('COMPANY'),/BaseCurrencyName/);
  assert.match(source.fetchList('COMPANY'),/BooksFrom/);
  assert.match(source.fetchList('VOUCHER'),/AllLedgerEntries.BillAllocations.BillCreditPeriod/);
  assert.match(source.fetchList('LEDGER'),/BillAllocations.OpeningBalance/);
});
test('readiness distinguishes absent amounts from explicit zero and retains bounded source locations',()=>{
  const {readiness}=require('../source-readiness');
  const check=readiness('LEDGER');
  check.add(node('LEDGER',{NAME:'Valid',CLOSINGBALANCE:''}),0);
  for(let i=1;i<=120;i++)check.add(node('LEDGER',{NAME:'Missing'}),i);
  const r=check.result();
  assert.equal(r.status,'blocked');assert.equal(r.errorCount,120);
  assert.equal(r.issues.length,20);assert.equal(r.issues[0].ordinal,1);
  assert.equal(r.issues[0].code,'MISSING_CLOSING_BALANCE');
});
test('readiness checks signed posting balance without rejecting empty inventory placeholders',()=>{
  const {readiness}=require('../source-readiness');
  const check=readiness('VOUCHER');
  const entries=[node('ALLLEDGERENTRIES.LIST',{LEDGERNAME:'A',AMOUNT:'-100.00'}),node('ALLLEDGERENTRIES.LIST',{LEDGERNAME:'B',AMOUNT:'100.00'})];
  check.add(node('VOUCHER',{GUID:'v',DATE:'20260915',AMOUNT:'100'},[...entries,node('ALLINVENTORYENTRIES.LIST',{},['  '])]),0);
  assert.equal(check.result().status,'ready');
  check.add(node('VOUCHER',{GUID:'v2',DATE:'20260915',AMOUNT:'100'},[entries[0]]),1);
  assert.ok(check.result().issues.some(i=>i.code==='UNBALANCED_POSTINGS'));
});
test('full-source reconciliation compares opening plus signed movements to closing and scopes safely',()=>{
  const {reconciliation}=require('../source-readiness');
  const check=reconciliation();
  check.add('LEDGER',node('LEDGER',{NAME:'Bank',OPENINGBALANCE:'100',CLOSINGBALANCE:'90'}),0);
  check.add('LEDGER',node('LEDGER',{NAME:'Expense',OPENINGBALANCE:'0',CLOSINGBALANCE:'10'}),1);
  check.add('VOUCHER',node('VOUCHER',{},[node('ALLLEDGERENTRIES.LIST',{LEDGERNAME:'Bank',AMOUNT:'-10'}),node('ALLLEDGERENTRIES.LIST',{LEDGERNAME:'Expense',AMOUNT:'10'})]),0);
  assert.equal(check.result(true).status,'ready');
  check.add('VOUCHER',node('VOUCHER',{},[node('ALLLEDGERENTRIES.LIST',{LEDGERNAME:'Bank',AMOUNT:'5'})]),1);
  assert.equal(check.result(true).issues[0].code,'LEDGER_RECONCILIATION_DIFFERENCE');
  const period=reconciliation({kind:'period',from:'2026-09-01',to:'2026-09-15'});
  assert.equal(period.result(true).issues[0].code,'RECONCILIATION_NOT_COMPARABLE');
});
