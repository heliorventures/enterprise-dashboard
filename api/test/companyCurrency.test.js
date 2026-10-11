const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { currencyCode } = require('../src/reportCurrency');
const { normalizeCurrency } = require('../src/currency');
const { buildProjection } = require('../src/sourceModels');
const unpack = require('../src/sourceUnpack');
const { uniqueVoucherKey } = require('../src/ingest');
after(() => db.close());

test('damaged source labels are missing metadata rather than explicit currencies', () => {
  for (const label of ['?', ' I? ', '\uFFFD']) assert.equal(normalizeCurrency(label), null);
  for (const label of ['USD', 'EUR', 'unsupported', 'USD?']) assert.equal(normalizeCurrency(label), label.toUpperCase());
});

test('Indian rupee labels resolve to INR without guessing foreign currencies', () => {
  for (const label of ['INR', 'inr', '₹', 'Rs', 'Rs.', 'Rupee', 'Rupees', 'Indian Rupee', ' Indian   Rupees ', '\nRs.\t']) {
    assert.equal(currencyCode(label), 'INR', label);
  }
  assert.equal(currencyCode('usd'), 'USD');
  for (const label of ['$', 'unknown', 'XXX', 'XTS', null, '']) assert.equal(currencyCode(label), null);
});

test('source company and ledger rupee aliases share one currency basis', () => {
  const row = (collection, fields) => ({ collection, ordinal: 0, payload: {
    tag: collection, attributes: {}, content: Object.entries(fields).map(([tag, value]) => ({ tag, attributes: {}, content: [value] })),
  } });
  const model = buildProjection([
    row('COMPANY', { BASECURRENCYNAME: '₹', CURRENCYNAME: 'Rupees' }),
    row('LEDGER', { NAME: 'Cash', PARENT: 'Cash-in-Hand', CURRENCYNAME: 'Rs.', CLOSINGBALANCE: '100' }),
  ], { ...unpack, voucherKey: uniqueVoucherKey });
  assert.equal(model.company.currency, 'INR');
  assert.equal(model.ledgers[0].currency, 'INR');
  assert.equal(model.coverage.uniformCurrency, true);
  assert.equal(model.issues.some(issue => /CURRENCY/.test(issue.code)), false);
});

test('damaged source labels defer to a readable base or alternate currency', () => {
  const row = (collection, fields) => ({ collection, ordinal: 0, payload: {
    tag: collection, attributes: {}, content: Object.entries(fields).map(([tag, value]) => ({ tag, attributes: {}, content: [value] })),
  } });
  for (const [base, alternate, ledger, expected] of [['?', 'INR', 'I?', 'INR'], ['USD', '?', '?', 'USD'], ['?', '?', '?', null]]) {
    const model = buildProjection([
      row('COMPANY', { BASECURRENCYNAME: base, CURRENCYNAME: alternate }),
      row('LEDGER', { NAME: 'Cash', PARENT: 'Cash-in-Hand', CURRENCYNAME: ledger, CLOSINGBALANCE: '100' }),
    ], { ...unpack, voucherKey: uniqueVoucherKey });
    assert.equal(model.company.currency, expected);
    assert.equal(model.ledgers[0].currency, null);
    assert.equal(model.coverage.uniformCurrency, expected !== null);
    assert.equal(model.issues.some(issue => issue.code === 'MIXED_CURRENCY'), false);
  }
});
