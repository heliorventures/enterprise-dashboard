const { test } = require('node:test');
const assert = require('node:assert/strict');
const { progress, itemFromPromote, finishState } = require('../src/sourceSync');

test('sync progress and item summaries stay incremental', () => {
  assert.equal(progress(0, 0), 100);
  assert.equal(progress(1, 4), 25);
  assert.deepEqual(itemFromPromote({ duplicate: true }), {
    status: 'skipped',
    message: 'Already promoted for this dump',
    ledger_insert: 0, ledger_update: 0, ledger_unchanged: 0, ledger_remove: 0,
    voucher_insert: 0, voucher_update: 0, voucher_unchanged: 0, voucher_remove: 0,
  });
  const applied = itemFromPromote({
    ok: true,
    ledgers: { insert: 2, update: 1, unchanged: 10, remove: 0 },
    vouchers: { insert: 0, update: 3, unchanged: 80, remove: 1 },
  });
  assert.equal(applied.status, 'ok');
  assert.match(applied.message, /2 ledgers new/);
  assert.equal(applied.voucher_update, 3);
  assert.deepEqual(finishState([]), { status: 'ok', message: 'No source dumps available to promote' });
  assert.equal(finishState([{ status: 'ok' }, { status: 'skipped' }]).status, 'ok');
  assert.equal(finishState([{ status: 'ok' }, { status: 'error' }]).status, 'error');
});
