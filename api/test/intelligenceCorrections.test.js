const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { analyzeWorkbook } = require('../src/intelligence/excel/parser');
const { stage } = require('../src/intelligence/imports/publication');
const { reconcileAccounts } = require('../src/intelligence/reconciliation/engine');

test('single header keeps first account and its physical row', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Outstanding');
  sheet.addRow(['Particulars', 'Pending Bill Debit', 'Pending Bill Credit']);
  sheet.addRow(['First account', 25, 0]);
  sheet.addRow(['Second account', 0, 10]);
  const parsed = await analyzeWorkbook(await book.xlsx.writeBuffer());
  assert.deepEqual(parsed.preview.map(row => row.sourceRowNumber), [2, 3]);
  assert.equal(parsed.columns[1].target, 'pending_bill_debit');
});

test('required financial columns follow the outstanding formula and retain explicit zero', () => {
  const columns = [{canonical:'Name',target:'account_name'},{canonical:'Debit',target:'pending_bill_debit'}];
  const rows = [{rowType:'DETAIL',sourceRowNumber:2,raw:{Name:'First',Debit:0,Credit:0}}];
  const absent = stage({rows},columns,[],{});
  assert.equal(absent.validation.canProcess,false);
  assert.ok(absent.validation.missingRequired.some(field => field.field_key === 'pending_bill_credit'));
  assert.equal(stage({rows},[...columns,{canonical:'Credit',target:'pending_bill_credit'}],[],{}).validation.canProcess,true);
  const blank = stage({rows:[{rowType:'DETAIL',sourceRowNumber:2,raw:{Name:'First'}}]},[...columns,{canonical:'Credit',target:'pending_bill_credit'}],[],{});
  assert.equal(blank.validation.canProcess,false);
  const alternate = stage({rows},columns,[],{net_outstanding_formula:{expression:'bill_amount - paid_amount'}});
  assert.deepEqual(alternate.validation.missingRequired.map(field=>field.field_key),['bill_amount','paid_amount']);
});

test('durable manual identity follows ledger recreation and GUID-confirmed rename', () => {
  const rows = [{account_id:'a',account_name:'Excel party',source_amount:'12.00'}];
  const ledger = {id:99,companyId:7,sourceKey:'ledger:renamed',guid:'guid-1',name:'Renamed',balance:'12.00'};
  const context = {maps:[{account_id:'a',tally_ledger_id:1,tally_source_key:'ledger:old',tally_ledger_guid:'guid-1'}],reportingDate:'2026-09-30',balanceDate:'2026-09-30',sourceCurrency:'INR',tallyCurrency:'INR'};
  const result = reconcileAccounts(rows,[ledger],{},context);
  assert.equal(result.matched[0].tallyLedgerId,99);
  assert.equal(result.matched[0].status,'MATCHED');
  assert.equal(context.maps[0].tally_ledger_id,1);
});

test('manual identity refuses recycled IDs and ambiguous durable keys', () => {
  const rows = [{account_id:'a',account_name:'Excel party',source_amount:12}];
  const map = {account_id:'a',tally_ledger_id:1,tally_source_key:'ledger:old'};
  assert.throws(()=>reconcileAccounts(rows,[{id:1,sourceKey:'ledger:other',name:'Other',balance:12}],{},{maps:[map]}),/manual|identity|mapping/i);
  assert.throws(()=>reconcileAccounts(rows,[{id:2,sourceKey:'ledger:old',balance:12},{id:3,sourceKey:'ledger:old',balance:12}],{},{maps:[map]}),/ambiguous/i);
});

test('legacy maps and frozen references preserve exact historical IDs', () => {
  const {resolveManualLedger} = require('../src/intelligence/reconciliation/identity');
  const old={id:1,name:'Original',balance:1};
  assert.equal(resolveManualLedger({tally_ledger_id:1,tally_ledger_name:'Original',tally_source_key:'ledger:original'},[old]),old);
  assert.equal(resolveManualLedger({tally_ledger_id:1,tally_ledger_name:'Original',tally_source_key:'ledger:original',tally_ledger_guid:'guid-old'},[old]),old);
  const next={id:2,name:'Original',sourceKey:'ledger:original',balance:1};
  assert.equal(resolveManualLedger({tally_ledger_id:1,tally_ledger_name:'Original'},[next]),next);
  assert.throws(()=>resolveManualLedger({tally_ledger_id:1,tally_ledger_name:'Original'},[{...next,name:'Renamed',sourceKey:'ledger:renamed'}]),/unavailable/);
});

test('frozen provider retains exact source key and GUID from archived Tally tree', async () => {
  const {snapshot} = require('../src/intelligence/tally/provider');
  const database={query:async(sql)=>({rows:sql.includes('SELECT f.batch_id')
    ? [{batch_id:'archive-1',currency:'USD',coverage:{uniformCurrency:true},manifest:{dateContext:{ledgers:{to:'2026-09-30'}}}}]
    : [{id:22,source_key:'ledger:original  name',name:'Original  Name',balance:'12.30',archive_payload:{tag:'LEDGER',attributes:{NAME:'Original  Name'},content:[{tag:'GUID',content:['guid-1']}]}}]})};
  const reference=await snapshot(7,database);
  assert.equal(reference.ledgers[0].sourceKey,'ledger:original  name');
  assert.equal(reference.ledgers[0].guid,'guid-1');
  assert.equal(reference.balanceDate,'2026-09-30');
  assert.equal(reference.currency,'USD');
  assert.equal(reference.ledgers[0].currency,'USD');
});

test('metadata-bearing accounts without measurements fail instead of becoming group headings',async()=>{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Outstanding');
  sheet.addRow(['Currency: USD']);
  sheet.addRow(['Particulars','GST','Pending Bill Debit','Pending Bill Credit']);
  sheet.addRow(['Trade creditors']);
  sheet.addRow(['Existing supplier','GST123',null,null]);
  sheet.addRow(['Other supplier','GST456',100,0]);
  const analysis=await analyzeWorkbook(await book.xlsx.writeBuffer());
  assert.equal(analysis.currency,'USD');
  assert.equal(analysis.rows[0].rowType,'GROUP');
  assert.equal(analysis.rows[1].rowType,'DETAIL');
  const result=stage(analysis,analysis.columns,[],{});
  assert.equal(result.validation.canProcess,false);
  assert.equal(result.validation.issues[0].row,4);
});

test('unknown or mixed currency never creates monetary totals or matched comparisons',()=>{
  const {aggregateBasis,reconciliationSummary,publicBatch}=require('../src/intelligence/currency');
  const input=currency=>({analysis:{currency},reference:{currency,uniformCurrency:true}});
  assert.equal(aggregateBasis([input('USD'),input('INR')]).currency,null);
  assert.equal(aggregateBasis([input(null)]).monetaryAvailable,false);
  assert.equal(aggregateBasis([input('USD'),input('USD')]).currency,'USD');
  assert.equal(publicBatch({calculated_total_debit:'100.00',frozen_inputs:null}).calculated_total_debit,null);
  assert.deepEqual(reconciliationSummary([{status:'MATCHED',count:2,difference:0},{status:'AMOUNT_MISMATCH',count:3,difference:4}],null),
    [{status:'COMPARISON_UNAVAILABLE',count:5,difference:null,currency:null}]);
  const rows=[{account_name:'Alpha',source_amount:10}];
  const ledgers=[{id:1,name:'Alpha',balance:10,currency:'USD'}];
  for(const sourceCurrency of [null,'INR']) {
    const result=reconcileAccounts(rows,ledgers,{}, {reportingDate:'2026-09-30',balanceDate:'2026-09-30',sourceCurrency,tallyCurrency:'USD'});
    assert.equal(result.matched[0].status,'COMPARISON_UNAVAILABLE');
    assert.equal(result.matched[0].difference,null);
  }
});
