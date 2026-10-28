const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/intelligence/config');
const { snapshot } = require('../src/intelligence/tally/provider');
const { reconcileAccounts } = require('../src/intelligence/reconciliation/engine');

function archive(to, { coherent = true } = {}) {
  return { query: async sql => {
    if (sql.includes('SELECT f.batch_id')) return { rows: [{ batch_id: 'source', currency: 'INR',
      coverage: { uniformCurrency: true }, captured_at: '2026-10-27T10:00:00Z',
      manifest: { dateContext: { ledgers: { from: '1901-01-01', to } } } }] };
    if (sql.includes('FROM finance_ledger_facts')) return { rows: [{ id: coherent ? 1 : null,
      name: 'Alpha', source_key: 'alpha', balance: '20.00', currency: 'INR' }] };
    if (sql.includes('FROM "Ledgers"')) return { rows: [] };
    throw new Error(`Unexpected provider query: ${sql}`);
  } };
}

function compare(reference, sourceCurrency = 'INR') {
  return reconcileAccounts([{ account_name: 'Alpha', source_amount: '20.00' }], reference.ledgers, {}, {
    reportingDate: '2027-03-31', balanceDate: reference.balanceDate,
    balanceDateAssumed: reference.balanceDateAssumed, batchId: reference.batchId,
    sourceCurrency, tallyCurrency: reference.currency,
  }).matched[0];
}

test('full-history boundary is undated and follows the existing explicit assumption policy', async t => {
  const previous = config.assumeUndatedTallyBalances;
  config.assumeUndatedTallyBalances = true;
  t.after(() => { config.assumeUndatedTallyBalances = previous; });
  const reference = await snapshot(6, archive('9999-12-31'));
  assert.equal(reference.balanceDate, null, 'the export limit is not a reporting date');
  assert.equal(reference.balanceDateAssumed, true);
  assert.equal(reference.balanceDateSource, 'full-history-export');
  assert.equal(compare(reference).status, 'MATCHED');
  assert.equal(compare(reference).balanceDate, null, 'do not fabricate a confirmed Excel or capture date');
  assert.equal(compare(reference, 'USD').status, 'COMPARISON_UNAVAILABLE');
});

test('full-history balances stay unavailable when the assumption policy is disabled', async t => {
  const previous = config.assumeUndatedTallyBalances;
  config.assumeUndatedTallyBalances = false;
  t.after(() => { config.assumeUndatedTallyBalances = previous; });
  const reference = await snapshot(6, archive('9999-12-31'));
  assert.equal(reference.balanceDate, null);
  assert.equal(reference.balanceDateAssumed, false);
  assert.equal(compare(reference).status, 'COMPARISON_UNAVAILABLE');
  assert.equal(compare(reference).difference, null);
});

test('a genuine balance date must still match the Excel date', async () => {
  const matching = await snapshot(6, archive('2027-03-31'));
  assert.equal(matching.balanceDate, '2027-03-31');
  assert.equal(compare(matching).status, 'MATCHED');
  const different = await snapshot(6, archive('2026-10-27'));
  assert.equal(different.balanceDate, '2026-10-27');
  assert.equal(compare(different).status, 'COMPARISON_UNAVAILABLE');
});

test('incoherent facts never acquire an assumed date', async () => {
  const reference = await snapshot(6, archive('9999-12-31', { coherent: false }));
  assert.equal(reference.balanceDate, null);
  assert.notEqual(reference.balanceDateAssumed, true);
});
