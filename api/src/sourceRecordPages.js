const db = require('./db');
const filters = {
  definitions: "collection <> 'VOUCHER'",
  ledgers: "collection = 'LEDGER'",
  vouchers: "collection = 'VOUCHER'",
};

// Archives are immutable after publication. The primary-key cursor bounds raw
// tree memory and preserves the same collection/ordinal order as the old query.
async function* readRows(batchId, stage, query = db.query) {
  const filter = filters[stage];
  if (!Object.hasOwn(filters, stage)) throw new Error('Invalid source projection stage');
  let collection = '', ordinal = -1;
  while (true) {
    const { rows } = await query(`SELECT collection, ordinal, payload
      FROM tally_source_records
      WHERE batch_id = $1 AND ${filter} AND (collection, ordinal) > ($2, $3)
      ORDER BY collection, ordinal LIMIT 8`, [batchId, collection, ordinal]);
    for (const row of rows) yield row;
    if (rows.length < 8) return;
    const last = rows.at(-1);
    collection = last.collection; ordinal = last.ordinal;
  }
}
module.exports = { readRows };
