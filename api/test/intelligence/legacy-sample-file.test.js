const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { analyzeWorkbook } = require('../../src/intelligence/excel/parser');
const { transformRow, netOutstanding, ageingEntries } = require('../../src/intelligence/transform/normalize');
const decimal=require('../../src/intelligence/transform/decimal');

const SAMPLE = path.join(__dirname, '../fixtures/intelligence/ageingoutstanding.xlsx');

describe('sample file transformation', () => {
  it('keeps debit and credit separate and validates source total', async () => {
    const analysis = await analyzeWorkbook(SAMPLE);
    const details = analysis.rows.filter((row) => row.rowType === 'DETAIL');
    const mapped = details.map((row) => transformRow(row.raw, analysis.columns).mapped);
    const debit = decimal.sum(mapped.map(row=>row.pending_bill_debit || 0));
    const credit = decimal.sum(mapped.map(row=>row.pending_bill_credit || 0));
    const total = analysis.rows.find((row) => row.rowType === 'TOTAL');
    const debitCol = analysis.columns.find((col) => col.target === 'pending_bill_debit').canonical;
    const creditCol = analysis.columns.find((col) => col.target === 'pending_bill_credit').canonical;
    assert.equal(debit,decimal.amount(total.raw[debitCol]));
    assert.equal(credit,decimal.amount(total.raw[creditCol]));
    const first = mapped.find((row) => row.account_name.includes('DILIP'));
    assert.equal(first.bill_amount, '2000000.00');
    assert.equal(first.paid_amount, '2500000.00');
    assert.equal(netOutstanding(first), '500000.00');
    const ageing = ageingEntries(first, analysis.columns);
    assert.equal(ageing[0].debit_amount, '500000.00');
    assert.equal(ageing[0].bucket_label, '0-1 Year');
  });
});
