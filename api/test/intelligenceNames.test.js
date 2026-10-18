const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { analyzeWorkbook, cleanName } = require('../src/intelligence/excel/parser');
const { stage } = require('../src/intelligence/imports/publication');
const { reconcileAccounts } = require('../src/intelligence/reconciliation/engine');

async function workbook(names) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Outstanding');
  sheet.getRow(1).values = ['Outstanding Report'];
  sheet.getRow(2).values = ['From: 01/01/2026 To: 30/09/2026'];
  sheet.getRow(3).values = ['Test Company', 'Currency: INR'];
  sheet.getRow(4).values = ['Particulars', 'Pending Bill', 'Pending Bill'];
  sheet.getRow(5).values = [null, 'Dr Amt', 'Cr Amt'];
  names.forEach(([name, debit, credit], index) => { sheet.getRow(index + 6).values = [name, debit, credit]; });
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function validate(names) {
  const analysis = await analyzeWorkbook(await workbook(names));
  const required = [{ field_key: 'account_name', label: 'Account name' }];
  return stage(analysis, analysis.columns, required, {});
}

const A = 'TDS SECTION 393(1) CODE 1008 RENT ON PLANT & MACHINERY  2%';
const B = 'TDS SECTION 393(1) CODE 1008 RENT ON PLANT & MACHINERY 2%';

test('account names keep internal spacing but lose characters that are not real spaces', () => {
  assert.equal(cleanName(`  ${A}  `), A);
  assert.equal(cleanName('A\u00a0B\tC\nD'), 'A B C D');
  assert.equal(cleanName(null), '');
});

test('two ledgers that differ only by repeated spaces are two valid accounts', async () => {
  const result = await validate([[A, 205805, 0], [B, 0, 149739], ['Other', 1, 0]]);
  assert.equal(result.validation.canProcess, true);
  assert.equal(result.validation.errors, 0);
  assert.deepEqual(result.staged.map(item => item.mapped.account_name), [A, B, 'Other']);
});

test('a genuine duplicate is still rejected and names the first row', async () => {
  const result = await validate([['Alpha Traders', 10, 0], ['ALPHA TRADERS', 5, 0]]);
  assert.equal(result.validation.canProcess, false);
  const error = result.staged[1].errors.find(item => item.code === 'DUPLICATE_ACCOUNT');
  assert.equal(error.firstRow, 6);
});

test('the exact Tally name wins the shared normalized match whatever the row order', () => {
  const ledgers = [{ id: 1, name: A, balance: '0.00' }];
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const rows = order.map(key => ({ account_id: key, account_name: key === 'a' ? A : B, source_amount: '10.00' }));
    const { matched } = reconcileAccounts(rows, ledgers, {}, {});
    const byName = new Map(matched.map((row, index) => [rows[index].account_name, row]));
    assert.equal(byName.get(A).tallyLedgerId, 1, 'exact spacing owns the ledger');
    assert.equal(byName.get(B).tallyLedgerId, null, 'the other account has no Tally ledger');
  }
});
