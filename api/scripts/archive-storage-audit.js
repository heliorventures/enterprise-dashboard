// Read-only inventory. No archive deletion or retention expiry is performed.
const db = require("../src/db");
(async () => {
  const result = await db.readSnapshot(async () => ({
    generatedAt: new Date().toISOString(),
    policy:
      "Retain all source evidence until a retention and verified external-archive policy is approved.",
    storage: (
      await db.query(`SELECT relname table_name,pg_total_relation_size(relid)::text bytes,n_live_tup estimated_rows
      FROM pg_stat_user_tables WHERE relname LIKE 'tally_source_%' OR relname='source_validation_issues' ORDER BY pg_total_relation_size(relid) DESC`)
    ).rows,
    companies: (
      await db.query(`SELECT company_external_id,company_name,count(*)::int batches,
      min(captured_at) oldest_capture,max(captured_at) latest_capture,
      count(*) FILTER(WHERE coverage_status='partial')::int partial_batches
      FROM tally_source_snapshots GROUP BY company_external_id,company_name ORDER BY company_external_id`)
    ).rows,
    protectedReferences: (
      await db.query(`SELECT 'published_snapshots' reason,count(DISTINCT batch_id)::int batches FROM finance_snapshots
      UNION ALL SELECT 'master_evidence',count(DISTINCT batch_id)::int FROM finance_masters
      UNION ALL SELECT 'ledger_evidence',count(DISTINCT batch_id)::int FROM finance_ledger_facts
      UNION ALL SELECT 'posting_evidence',count(DISTINCT batch_id)::int FROM finance_postings
      UNION ALL SELECT 'allocation_evidence',count(DISTINCT batch_id)::int FROM finance_allocations
      UNION ALL SELECT 'inventory_evidence',count(DISTINCT batch_id)::int FROM finance_inventory_movements
      UNION ALL SELECT 'validation_history',count(DISTINCT batch_id)::int FROM source_validation_issues`)
    ).rows,
  }));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
})()
  .catch((error) => {
    console.error("Archive audit failed:", error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
