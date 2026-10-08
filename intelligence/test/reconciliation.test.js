const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileAccounts } = require('../src/reconciliation/engine');

describe('reconciliation', () => {
  it('matches on normalized name and flags amount gaps', () => {
    const result = reconcileAccounts(
      [{ outstanding_id: '1', company_id: 'c', account_name: 'DILIP KASHINATH DHOTRE - CURRENT A/C', source_amount: 500000 }],
      [{ id: 9, name: 'Dilip Kashinath Dhotre - Current A/C', normalized: require('../src/tally/provider').normalizeName('Dilip Kashinath Dhotre - Current A/C'), balance: 480000 }],
      { amount_tolerance: { amount: 1000 }, critical_difference: { amount: 100000 } }
    );
    assert.equal(result.matched[0].status, 'AMOUNT_MISMATCH');
    assert.equal(result.matched[0].matchMethod, 'NAME');
    assert.equal(result.matched[0].difference, 20000);
  });

  it('marks source rows missing in Tally', () => {
    const result = reconcileAccounts(
      [{ outstanding_id: '1', company_id: 'c', account_name: 'Unknown Party', source_amount: 100 }],
      [{ id: 1, name: 'Cash', normalized: 'cash', balance: 50 }]
    );
    assert.equal(result.matched[0].status, 'MISSING_IN_TALLY');
    assert.equal(result.missingInSource[0].status, 'MISSING_IN_SOURCE');
  });
});
