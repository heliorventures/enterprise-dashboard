const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  analyzeWorkbook,
  parsePeriod,
  parseEntity,
  parseDate,
  parseDecimal,
  ageingFromHeader,
  guessTarget,
} = require('../src/excel/parser');

const SAMPLE = path.join(__dirname, '../samples/ageingoutstanding.xlsx');

describe('header helpers', () => {
  it('parses reporting period without hard-coded dates', () => {
    const period = parsePeriod('From :-31/03/2024 To :-31/03/2027');
    assert.equal(period.from, '2024-03-31');
    assert.equal(period.to, '2027-03-31');
  });

  it('parses company and business units from the banner', () => {
    const entity = parseEntity(' SOLVIAN INFRA AND AGRO LLP [ HEAD OFFICE, KHARAT ADGAON, MAJALGAON ROAD PROJECT, ISAPUR CANAL PROJECT ]');
    assert.equal(entity.company, 'SOLVIAN INFRA AND AGRO LLP');
    assert.equal(entity.units.length, 4);
  });

  it('maps ageing headers to canonical buckets', () => {
    const bucket = ageingFromHeader('0  to   1 Year  \n31/03/2027 to 01/04/2026');
    assert.equal(bucket.key, 'age_0_1_year');
    assert.equal(bucket.from, '2026-04-01');
    assert.equal(bucket.to, '2027-03-31');
    assert.equal(guessTarget('Pending Bill | Dr Amt', 'Pending Bill', 'Dr Amt'), 'pending_bill_debit');
    assert.equal(guessTarget('LAST PAYMENT REQUESITION AMT', 'LAST PAYMENT REQUESITION AMT', ''), 'last_payment_requisition_amount');
  });

  it('parses Indian dates and decimals', () => {
    assert.equal(parseDate('07/10/2026'), '2026-10-07');
    assert.equal(parseDecimal('1,25,000.50'), 125000.5);
  });
});

describe('sample ageing outstanding workbook', () => {
  it('detects report structure and classifies rows', async () => {
    const analysis = await analyzeWorkbook(SAMPLE);
    assert.equal(analysis.title, 'AGEING OUTSTANDING EXCEL REPORT');
    assert.equal(analysis.entity.company, 'SOLVIAN INFRA AND AGRO LLP');
    assert.equal(analysis.period.from, '2024-03-31');
    assert.equal(analysis.period.to, '2027-03-31');
    assert.equal(analysis.sheet.columns, 25);
    assert.ok(analysis.counts.dataRows >= 400);
    assert.ok(analysis.counts.groupRows >= 20);
    assert.equal(analysis.counts.totalRows, 1);
    const dilip = analysis.rows.find((row) => row.raw.Particulars === 'DILIP KASHINATH DHOTRE - CURRENT A/C');
    assert.equal(dilip.rowType, 'DETAIL');
    assert.deepEqual(dilip.categoryPath, ['CAPITAL', 'CURRENT CAPITAL']);
    const capital = analysis.rows.find((row) => row.raw.Particulars === 'CAPITAL');
    assert.equal(capital.rowType, 'GROUP');
    const total = analysis.rows.find((row) => row.rowType === 'TOTAL');
    assert.ok(total);
    const targets = new Set(analysis.columns.map((col) => col.target).filter(Boolean));
    for (const field of [
      'account_name', 'credit_days', 'gst_number', 'msme_number', 'pan_number',
      'bill_amount', 'paid_amount', 'last_payment_requisition_amount', 'last_payment_amount',
      'last_payment_date', 'pending_bill_debit', 'pending_bill_credit',
      'age_0_1_year_debit', 'age_0_1_year_credit', 'age_3_plus_year_debit', 'last_date',
    ]) {
      assert.ok(targets.has(field), `missing ${field}`);
    }
    assert.ok(analysis.columns.some((col) => col.unmapped), 'unknown columns must be retained');
  });
});
