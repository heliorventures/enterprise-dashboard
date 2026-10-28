const db = require('../db');
const config = require('../config');
const imports = require('./service');
const { balanceDateBasis } = require('../tally/balanceDate');

async function candidates(database, batchId = null) {
  return (await database.query(`SELECT b.id AS batch_id,b.import_file_id,b.company_id,b.generation,
      c.name AS company,f.file_name,b.reporting_date,b.tally_balance_date,b.tally_batch_id
    FROM intel_import_batches b
    JOIN intel_import_files f ON f.id=b.import_file_id
    JOIN intel_companies c ON c.id=b.company_id
    JOIN tally_source_snapshots s ON s.batch_id=b.tally_batch_id
    LEFT JOIN intel_company_publications p ON p.company_id=b.company_id
    WHERE b.status='COMPLETED' AND f.status='COMPLETED'
      AND (f.selected_batch_id=b.id OR p.import_batch_id=b.id)
      AND b.tally_balance_date=DATE '9999-12-31'
      AND b.frozen_inputs->'reference'->>'balanceDate'='9999-12-31'
      AND b.frozen_inputs->'reference'->>'batchId'=b.tally_batch_id
      AND s.manifest->'dateContext'->'ledgers'->>'to'='9999-12-31'
      AND ($1::uuid IS NULL OR b.id=$1)
    ORDER BY b.company_id,b.reporting_date,b.id`, [batchId])).rows;
}

async function inspect() {
  return db.readSnapshot(() => candidates(db));
}

async function repairOne(candidate) {
  return db.transaction(async client => {
    const skipped = { status: 'skipped', previous_batch_id: candidate.batch_id };
    const owner = (await client.query('SELECT company_id FROM intel_import_files WHERE id=$1', [candidate.import_file_id])).rows[0];
    if (!owner) return skipped;
    await client.query('SELECT pg_advisory_xact_lock(61009,hashtext($1))', [owner.company_id]);
    await client.query('SELECT id FROM intel_import_files WHERE id=$1 FOR UPDATE', [candidate.import_file_id]);
    const current = (await candidates(client, candidate.batch_id))[0];
    if (!current || current.import_file_id !== candidate.import_file_id) return skipped;
    if ((await client.query("SELECT 1 FROM intel_import_batches WHERE company_id=$1 AND status='PROCESSING'", [owner.company_id])).rows.length) {
      throw new Error('A company import is processing; retry the correction after it finishes');
    }
    const original = (await client.query('SELECT frozen_inputs FROM intel_import_batches WHERE id=$1', [current.batch_id])).rows[0].frozen_inputs;
    if (!Array.isArray(original?.accountMaps) || !Array.isArray(original?.reference?.ledgers)) {
      throw new Error('Original frozen mappings or ledgers are unavailable; review this generation before correction');
    }
    const reference = { ...original.reference, ...balanceDateBasis(original.reference.balanceDate) };
    const username = 'balance-date-repair';
    const reserved = await imports.claim(current.import_file_id, {
      username, reprocess: true, inputs: original, reference, accountMaps: original.accountMaps,
    }, { transaction: work => work(client) });
    if (reserved.existing) throw new Error('Import claim changed; reload the correction candidates');
    await imports.publishGeneration(client, reserved, { replacePublicationBatchId: current.batch_id });
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,old_value,new_value)
      VALUES($1,'BALANCE_DATE_CORRECTION','import_file',$2,$3,$4)`, [username, current.import_file_id,
      { batchId: current.batch_id, balanceDate: original.reference.balanceDate },
      { batchId: reserved.batch.id, balanceDate: null, balanceDateAssumed: reference.balanceDateAssumed,
        balanceDateSource: reference.balanceDateSource, tallyBatchId: reference.batchId }]);
    return { status: 'corrected', import_file_id: current.import_file_id,
      previous_batch_id: current.batch_id, batch_id: reserved.batch.id, generation: reserved.batch.generation };
  });
}

async function main(args) {
  if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('Usage: node src/intelligence/imports/repairBalanceDates.js [--apply]');
  const affected = await inspect();
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'inspect',
    assumeUndatedTallyBalances: config.assumeUndatedTallyBalances, candidates: affected }, null, 2));
  if (args.includes('--apply')) {
    for (const candidate of affected) console.log(JSON.stringify(await repairOne(candidate)));
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
}

module.exports = { inspect, repairOne };
