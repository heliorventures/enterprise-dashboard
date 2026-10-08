const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { analyzeWorkbook } = require('../src/excel/parser');
const { transformRow, netOutstanding, ageingEntries } = require('../src/transform/normalize');

const SAMPLE = path.join(__dirname, '../samples/ageingoutstanding.xlsx');

describe('sample file transformation', () => {
  it('keeps debit and credit separate and validates source total', async () => {
    const analysis = await analyzeWorkbook(SAMPLE);
    const details = analysis.rows.filter((row) => row.rowType === 'DETAIL');
    const mapped = details.map((row) => transformRow(row.raw, analysis.columns).mapped);
    const debit = mapped.reduce((sum, row) => sum + (Number(row.pending_bill_debit) || 0), 0);
    const credit = mapped.reduce((sum, row) => sum + (Number(row.pending_bill_credit) || 0), 0);
    const total = analysis.rows.find((row) => row.rowType === 'TOTAL');
    const debitCol = analysis.columns.find((col) => col.target === 'pending_bill_debit').canonical;
    const creditCol = analysis.columns.find((col) => col.target === 'pending_bill_credit').canonical;
    assert.ok(Math.abs(debit - Number(total.raw[debitCol])) < 0.05);
    assert.ok(Math.abs(credit - Number(total.raw[creditCol])) < 0.05);
    const first = mapped.find((row) => row.account_name.includes('DILIP'));
    assert.equal(first.bill_amount, 2000000);
    assert.equal(first.paid_amount, 2500000);
    assert.equal(netOutstanding(first), 500000);
    const ageing = ageingEntries(first, analysis.columns);
    assert.equal(ageing[0].debit_amount, 500000);
    assert.equal(ageing[0].bucket_label, '0-1 Year');
  });
});
