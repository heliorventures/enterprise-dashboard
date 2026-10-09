const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const parser = require('../src/intelligence/excel/parser');
const { resolveMaps } = require('../src/intelligence/mapping/engine');
const { transformValue, netOutstanding } = require('../src/intelligence/transform/normalize');
const { reconcileAccounts } = require('../src/intelligence/reconciliation/engine');

test('sparse worksheet preserves physical row numbers through final row', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Outstanding');
  sheet.getRow(1).values = ['Outstanding Report'];
  sheet.getRow(2).values = ['From: 01/01/2026 To: 30/09/2026'];
  sheet.getRow(3).values = ['Test Company'];
  sheet.getRow(4).values = ['Particulars', 'Pending Bill'];
  sheet.getRow(5).values = [null, 'Dr Amt'];
  sheet.getRow(15).values = ['Sparse account', 12.34];
  const analysis = await parser.analyzeWorkbook(await book.xlsx.writeBuffer());
  assert.equal(analysis.counts.dataRows, 1);
  assert.equal(analysis.preview[0].sourceRowNumber, 15);
});

test('calendar date validation rejects rollover and trailing text', () => {
  for (const invalid of ['31/02/2026', '2026-13-01', '2026-02-29', '2026-01-01 garbage', '03/04/123']) {
    assert.equal(parser.parseDate(invalid), null, invalid);
  }
  assert.equal(parser.parseDate('29/02/2024'), '2024-02-29');
  assert.equal(parser.parsePeriod('From: 2026-01-01 To: 2026-09-30').to,'2026-09-30');
  assert.equal(parser.parsePeriod('From: 2026-09-30 To: 2026-01-01').to,null);
});

test('company mapping precedes global mapping and explicit ignore survives guessing', () => {
  const columns = [{index:1, canonical:'Particulars', target:'account_name'}, {index:2,canonical:'Bill Amount',target:'bill_amount'}];
  const resolved = resolveMaps([
    {source_header:'Particulars',target_field:'account_name'},
    {source_header:'Bill Amount',target_field:null},
    {source_header:'Bill Amount',target_field:'bill_amount'},
  ], columns);
  assert.equal(resolved[1].target, null);
  assert.equal(resolved[1].ignored, true);
});

test('financial arithmetic preserves cents beyond Number safe integer range', () => {
  assert.equal(transformValue('bill_amount', '90,071,992,547,409.91').value, '90071992547409.91');
  assert.equal(netOutstanding({pending_bill_debit:'90071992547409.91',pending_bill_credit:'90071992547409.90'}), '0.01');
  assert.equal(transformValue('credit_days', '2.5').error.code, 'INVALID_INTEGER');
});

test('manual ledger reservation precedes automatic matching', () => {
  const rows = [
    {outstanding_id:'auto',account_id:'a',account_name:'Alpha',source_amount:'10.00'},
    {outstanding_id:'manual',account_id:'b',account_name:'Different',source_amount:'10.00'},
  ];
  const result = reconcileAccounts(rows, [{id:1,name:'Alpha',normalized:'alpha',balance:'10.00'}], {}, {
    maps:[{account_id:'b',tally_ledger_id:1}], reportingDate:'2026-09-30',balanceDate:'2026-09-30',
  });
  assert.equal(result.matched[0].tallyLedgerId, null);
  assert.equal(result.matched[1].tallyLedgerId, 1);
  assert.equal(result.matched[1].matchMethod, 'MANUAL');
  assert.equal(result.missingInSource.length, 0);
});

test('unknown and different balance dates cannot assert financial matching', () => {
  const rows = [{outstanding_id:'one',account_name:'Alpha',source_amount:'10.00'}];
  const ledgers = [{id:1,name:'Alpha',normalized:'alpha',balance:'10.00'}];
  for (const balanceDate of [null, '2026-09-29']) {
    const result = reconcileAccounts(rows, ledgers, {}, {reportingDate:'2026-09-30',balanceDate});
    assert.equal(result.matched[0].status, 'COMPARISON_UNAVAILABLE');
    assert.equal(result.matched[0].difference, null);
  }
});

test('manual duplicate ledger ownership is rejected', () => {
  assert.throws(() => reconcileAccounts([
    {account_id:'a',account_name:'Alpha',source_amount:1},
    {account_id:'b',account_name:'Beta',source_amount:1},
  ],[{id:1,name:'Alpha',normalized:'alpha',balance:1}],{}, {maps:[
    {account_id:'a',tally_ledger_id:1},{account_id:'b',tally_ledger_id:1},
  ]}), /multiple|conflict|reserved/i);
});
