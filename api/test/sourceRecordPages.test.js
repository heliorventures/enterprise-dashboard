const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
after(() => db.close());

test('raw archive reads advance a bounded key cursor without offset scans or all-row loading', async () => {
  const { readRows } = require('../src/sourceRecordPages');
  const calls = [], saved = Array.from({ length: 19 }, (_, ordinal) => ({ collection: 'VOUCHER', ordinal, payload: {} }));
  const query = async (sql, values) => {
    calls.push({ sql, values });
    assert.match(sql, /LIMIT 8/);
    assert.doesNotMatch(sql, /OFFSET/);
    assert.match(sql, /collection = 'VOUCHER'/);
    assert.equal(values[0], 'batch');
    return { rows: saved.filter(r => r.ordinal > values[2]).slice(0, 8) };
  };
  const rows = [];
  for await (const row of readRows('batch', 'vouchers', query)) rows.push(row);
  assert.deepEqual(rows, saved);
  assert.deepEqual(calls.map(c => c.values[2]), [-1, 7, 15]);
  await assert.rejects(async () => { for await (const _ of readRows('batch', 'untrusted', query)) {} }, /stage/i);
});
