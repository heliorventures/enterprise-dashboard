// Replays archived records through validation without calling any ingestion or
// persistence functions. The PostgreSQL session also enforces read-only access.
const { Client } = require('pg');
const config = require('../src/config');
const unpack = require('../src/sourceUnpack');
const { buildProjection } = require('../src/sourceModels');
const { uniqueVoucherKey } = require('../src/ingest');

async function main() {
  const batchId = process.argv[2];
  if (!batchId || process.argv.length !== 3 || batchId.length > 200) {
    throw new Error('Usage: node scripts/validate-source-readonly.js <batch-id>');
  }
  const client = new Client({ ...config.db, connectionTimeoutMillis: 8000,
    statement_timeout: 30000, options: '-c default_transaction_read_only=on' });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query(
      'SELECT batch_id,company_name,coverage_status FROM tally_source_snapshots WHERE batch_id=$1', [batchId]
    )).rows[0];
    if (!snapshot) throw new Error('Archived batch not found');
    const records = [];
    let cursor = null;
    for (;;) {
      const page = (await client.query(`SELECT collection,ordinal,payload FROM tally_source_records
        WHERE batch_id=$1 AND ($2::text IS NULL OR (collection,ordinal)>($2,$3))
        ORDER BY collection,ordinal LIMIT 100`, [batchId, cursor?.collection ?? null, cursor?.ordinal ?? null])).rows;
      records.push(...page);
      if (page.length < 100) break;
      cursor = page.at(-1);
      if (records.length % 500 === 0) console.error(`Read ${records.length} archived records`);
    }
    await client.query('ROLLBACK');
    const core = unpack.projectRecords(records);
    const model = buildProjection(records, { ...unpack, voucherKey: uniqueVoucherKey });
    const issues = [...core.issues, ...model.issues];
    const byCode = {};
    for (const issue of issues) byCode[issue.code] = (byCode[issue.code] || 0) + 1;
    let valid = snapshot.coverage_status === 'complete' && !issues.some(x => x.severity === 'error');
    try { unpack.assertPromotable(core); } catch { valid = false; }
    console.log(JSON.stringify({ ...snapshot, readOnly: true, valid, records: records.length,
      ledgers: core.ledgers.length, vouchers: core.vouchers.length,
      nonzeroVouchers: core.vouchers.filter(x => Number(x.amount) !== 0).length,
      postings: model.postings.length, inventoryMovements: model.inventory.length,
      skipped: core.skipped, issues: byCode }, null, 2));
    if (!valid) process.exitCode = 2;
  } finally { await client.end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
