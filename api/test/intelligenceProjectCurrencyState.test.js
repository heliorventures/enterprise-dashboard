const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const config = require('../src/intelligence/config');
const projects = require('../src/intelligence/projects/service');

function summaryData(t, { companyCurrency, publishedCurrency, tallyCurrency = publishedCurrency } = {}) {
  t.mock.method(db, 'readSnapshot', work => work());
  t.mock.method(db, 'query', async sql => {
    if (/FROM intel_companies\b/.test(sql)) {
      return { rows: [{ id: 'company', name: 'Example', tally_company_id: 6, currency: companyCurrency }] };
    }
    if (sql.includes('SELECT p.company_id,b.frozen_inputs')) {
      return { rows: publishedCurrency === undefined ? [] : [{ company_id: 'company', frozen_inputs: {
        analysis: { currency: publishedCurrency }, reference: { currency: tallyCurrency, uniformCurrency: true },
      } }] };
    }
    if (sql.includes('FROM "Vouchers"')) return { rows: [{ vouchers: 0, with_amount: 0 }] };
    if (sql.includes('SELECT f.id,f.file_name')) {
      return { rows: publishedCurrency === undefined ? [] : [{ id: 'import', file_name: 'report.xlsx' }] };
    }
    if (sql.includes('FROM intel_projects') || sql.includes('FROM intel_current_outstanding')
      || sql.includes('FROM intel_current_reconciliations') || sql.includes('FROM "Projects"')
      || sql.includes("frozen_inputs->'analysis'")) return { rows: [] };
    throw new Error(`Unexpected summary query: ${sql}`);
  });
}

for (const [label, companyCurrency, expected] of [
  ['configured INR', 'INR', 'INR'],
  ['normalized rupees', 'Rs.', 'INR'],
  ['configured foreign currency', 'USD', 'USD'],
  ['missing company currency', null, 'INR'],
]) {
  test(`no published comparison shows an import instruction with ${label}`, async t => {
    const original = config.defaultCurrency;
    config.defaultCurrency = 'INR';
    t.after(() => { config.defaultCurrency = original; });
    summaryData(t, { companyCurrency });
    const result = await projects.summary('company');
    assert.equal(result.latestImport, null);
    assert.match(result.currencyMessage, /No Excel comparison has been published/);
    assert.match(result.currencyMessage, new RegExp(`Company currency: ${expected}`));
    assert.match(result.currencyMessage, /Upload and process an Excel file/);
    assert.doesNotMatch(result.currencyMessage, /snapshot is missing|does not state a currency/);
    assert.equal(result.monetaryAvailable, false);
    assert.equal(result.unassigned.excelAmount, null);
    assert.equal(result.unassigned.netDifference, null);
  });
}

test('a published INR comparison still provides monetary results', async t => {
  summaryData(t, { companyCurrency: 'INR', publishedCurrency: 'INR' });
  const result = await projects.summary('company');
  assert.equal(result.currency, 'INR');
  assert.equal(result.monetaryAvailable, true);
  assert.equal(result.currencyMessage, null);
  assert.equal(result.unassigned.netDifference, '0.00');
});

test('company INR does not override a published Excel USD versus Tally INR mismatch', async t => {
  summaryData(t, { companyCurrency: 'INR', publishedCurrency: 'USD', tallyCurrency: 'INR' });
  const result = await projects.summary('company');
  assert.equal(result.currency, null);
  assert.equal(result.monetaryAvailable, false);
  assert.match(result.currencyMessage, /Excel and Tally currencies differ/);
  assert.doesNotMatch(result.currencyMessage, /No Excel comparison/);
  assert.equal(result.unassigned.netDifference, null);
});

test('a published generation with unknown currency is not mistaken for an absent import', async t => {
  summaryData(t, { companyCurrency: 'INR', publishedCurrency: null, tallyCurrency: null });
  const result = await projects.summary('company');
  assert.equal(result.monetaryAvailable, false);
  assert.match(result.currencyMessage, /does not state a currency/);
  assert.doesNotMatch(result.currencyMessage, /No Excel comparison/);
});
