const db = require('./db');
const sourceUnpack = require('./sourceUnpack');

const activeRuns = new Set();

function invalid(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function progress(done, total) {
  if (!total) return 100;
  return Math.min(100, Math.round((done / total) * 100));
}

function countsFrom(result) {
  const ledgers = result.ledgers || { insert: 0, update: 0, unchanged: 0, remove: 0 };
  const vouchers = result.vouchers || { insert: 0, update: 0, unchanged: 0, remove: 0 };
  return {
    ledger_insert: ledgers.insert || 0,
    ledger_update: ledgers.update || 0,
    ledger_unchanged: ledgers.unchanged || 0,
    ledger_remove: ledgers.remove || 0,
    voucher_insert: vouchers.insert || 0,
    voucher_update: vouchers.update || 0,
    voucher_unchanged: vouchers.unchanged || 0,
    voucher_remove: vouchers.remove || 0,
  };
}

function itemFromPromote(result) {
  if (result.duplicate) {
    const linked = result.projects?.linked || 0;
    return {
      status: 'skipped',
      message: linked
        ? `Already promoted for this dump; linked ${linked} vouchers to projects`
        : 'Already promoted for this dump',
      ...countsFrom(result),
    };
  }
  const counts = countsFrom(result);
  return {
    status: result.ok === false ? 'error' : 'ok',
    message: result.error || [
      `${counts.ledger_insert} ledgers new, ${counts.ledger_update} updated, ${counts.ledger_unchanged} unchanged, ${counts.ledger_remove} removed`,
      `${counts.voucher_insert} vouchers new, ${counts.voucher_update} updated, ${counts.voucher_unchanged} unchanged, ${counts.voucher_remove} removed`,
    ].join('; '),
    ...counts,
  };
}

function mapItem(row) {
  return {
    id: row.item_id,
    companyExternalId: row.company_external_id,
    companyName: row.company_name,
    batchId: row.batch_id,
    status: row.status,
    message: row.message,
    progress: row.status === 'pending' ? 0 : row.status === 'running' ? 50 : 100,
    ledgers: {
      insert: row.ledger_insert,
      update: row.ledger_update,
      unchanged: row.ledger_unchanged,
      remove: row.ledger_remove,
    },
    vouchers: {
      insert: row.voucher_insert,
      update: row.voucher_update,
      unchanged: row.voucher_unchanged,
      remove: row.voucher_remove,
    },
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapRun(row, items = []) {
  return {
    id: row.run_id,
    status: row.status,
    triggeredBy: row.triggered_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    companyTotal: row.company_total,
    companyDone: row.company_done,
    progress: row.status === 'running' ? progress(row.company_done, row.company_total) : row.status === 'ok' || row.status === 'error' ? 100 : progress(row.company_done, row.company_total),
    message: row.message,
    companies: items.map(mapItem),
  };
}

function finishState(items) {
  const failed = items.filter((row) => row.status === 'error').length;
  const applied = items.filter((row) => row.status === 'ok').length;
  const skipped = items.filter((row) => row.status === 'skipped').length;
  if (!items.length) return { status: 'ok', message: 'No source dumps available to promote' };
  if (failed) return { status: 'error', message: `${applied} promoted, ${skipped} already applied, ${failed} failed` };
  if (applied) return { status: 'ok', message: `${applied} companies promoted${skipped ? `, ${skipped} already applied` : ''}` };
  return { status: 'ok', message: `${skipped} companies already applied` };
}

async function failOrphans() {
  const live = [...activeRuns];
  await db.query(
    `UPDATE source_sync_items
     SET status = 'error', finished_at = COALESCE(finished_at, now()), message = 'Sync interrupted when the API restarted'
     WHERE status IN ('pending', 'running')
       AND run_id IN (
         SELECT run_id FROM source_sync_runs
         WHERE status = 'running' AND NOT (run_id = ANY($1::int[]))
       )`,
    [live.length ? live : [0]]
  );
  await db.query(
    `UPDATE source_sync_runs
     SET status = 'error', finished_at = COALESCE(finished_at, now()), message = 'Sync interrupted when the API restarted'
     WHERE status = 'running' AND NOT (run_id = ANY($1::int[]))`,
    [live.length ? live : [0]]
  );
}

async function loadRun(runId) {
  const run = (await db.query('SELECT * FROM source_sync_runs WHERE run_id = $1', [runId])).rows[0];
  if (!run) return null;
  const items = (await db.query('SELECT * FROM source_sync_items WHERE run_id = $1 ORDER BY company_name', [runId])).rows;
  return mapRun(run, items);
}

async function history({ limit = 20 } = {}) {
  await failOrphans();
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const runs = (await db.query(
    'SELECT * FROM source_sync_runs ORDER BY started_at DESC, run_id DESC LIMIT $1',
    [size]
  )).rows;
  const items = runs.length
    ? (await db.query(
      'SELECT * FROM source_sync_items WHERE run_id = ANY($1::int[]) ORDER BY company_name',
      [runs.map((row) => row.run_id)]
    )).rows
    : [];
  const byRun = new Map(runs.map((row) => [row.run_id, []]));
  for (const item of items) byRun.get(item.run_id).push(item);
  const mapped = runs.map((row) => mapRun(row, byRun.get(row.run_id) || []));
  return {
    current: mapped.find((row) => row.status === 'running') || null,
    runs: mapped,
  };
}

async function createRun(triggeredBy, snapshots) {
  const run = (await db.query(
    `INSERT INTO source_sync_runs (status, triggered_by, company_total, message)
     VALUES ('running', $1, $2, $3) RETURNING *`,
    [triggeredBy, snapshots.length, snapshots.length ? `Promoting ${snapshots.length} companies from source dumps` : 'No source dumps available to promote']
  )).rows[0];
  for (const snapshot of snapshots) {
    await db.query(
      `INSERT INTO source_sync_items (run_id, company_external_id, company_name, batch_id, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [run.run_id, snapshot.company_external_id, snapshot.company_name, snapshot.batch_id]
    );
  }
  return run.run_id;
}

async function execute(runId, { force = false } = {}) {
  activeRuns.add(runId);
  try {
    const items = (await db.query(
      'SELECT * FROM source_sync_items WHERE run_id = $1 ORDER BY company_name',
      [runId]
    )).rows;
    let done = 0;
    for (const item of items) {
      await db.query(
        `UPDATE source_sync_items SET status = 'running', started_at = now(), message = 'Reading source records'
         WHERE item_id = $1`,
        [item.item_id]
      );
      try {
        const result = await sourceUnpack.unpackBatch(item.batch_id, { force });
        const mapped = itemFromPromote(result);
        await db.query(
          `UPDATE source_sync_items
           SET status = $2, message = $3, finished_at = now(),
               ledger_insert = $4, ledger_update = $5, ledger_unchanged = $6, ledger_remove = $7,
               voucher_insert = $8, voucher_update = $9, voucher_unchanged = $10, voucher_remove = $11
           WHERE item_id = $1`,
          [
            item.item_id, mapped.status, mapped.message,
            mapped.ledger_insert, mapped.ledger_update, mapped.ledger_unchanged, mapped.ledger_remove,
            mapped.voucher_insert, mapped.voucher_update, mapped.voucher_unchanged, mapped.voucher_remove,
          ]
        );
      } catch (error) {
        await db.query(
          `UPDATE source_sync_items SET status = 'error', finished_at = now(), message = $2 WHERE item_id = $1`,
          [item.item_id, error.message.slice(0, 1000)]
        );
      }
      done += 1;
      await db.query(
        `UPDATE source_sync_runs SET company_done = $2, message = $3 WHERE run_id = $1`,
        [runId, done, `Promoted ${done} of ${items.length} companies`]
      );
    }
    const finished = (await db.query('SELECT * FROM source_sync_items WHERE run_id = $1', [runId])).rows;
    const summary = finishState(finished);
    await db.query(
      `UPDATE source_sync_runs SET status = $2, finished_at = now(), company_done = $3, message = $4 WHERE run_id = $1`,
      [runId, summary.status, finished.length, summary.message]
    );
    await db.query(
      `INSERT INTO "SyncLog" ("Source", "Status", "Message") VALUES ('tally', $1, $2)`,
      [summary.status === 'ok' ? 'ok' : 'error', summary.message]
    );
  } catch (error) {
    await db.query(
      `UPDATE source_sync_runs SET status = 'error', finished_at = now(), message = $2 WHERE run_id = $1`,
      [runId, error.message.slice(0, 1000)]
    );
    throw error;
  } finally {
    activeRuns.delete(runId);
  }
  return loadRun(runId);
}

async function start({ triggeredBy = 'dashboard', force = false, wait = false } = {}) {
  await failOrphans();
  const current = (await history({ limit: 1 })).current;
  if (current) throw invalid('A Tally sync is already running', 409, { run: current });
  const snapshots = await sourceUnpack.listPromotableSnapshots();
  const runId = await createRun(triggeredBy, snapshots);
  activeRuns.add(runId);
  const work = execute(runId, { force });
  if (wait) return work;
  work.catch((error) => console.error('Source sync failed:', error.message));
  return loadRun(runId);
}

async function recordBatch(batchId, { triggeredBy = 'source-complete' } = {}) {
  const snapshot = (await db.query(
    'SELECT batch_id, company_external_id, company_name, captured_at FROM tally_source_snapshots WHERE batch_id = $1',
    [batchId]
  )).rows[0];
  if (!snapshot) throw invalid('Source snapshot not found', 404);
  await failOrphans();
  const runId = await createRun(triggeredBy, [snapshot]);
  activeRuns.add(runId);
  const run = await execute(runId);
  const item = run.companies[0];
  return {
    ok: item?.status === 'ok' || item?.status === 'skipped',
    duplicate: item?.status === 'skipped',
    batchId,
    companyName: snapshot.company_name,
    run,
  };
}

module.exports = {
  progress,
  itemFromPromote,
  finishState,
  mapRun,
  start,
  history,
  recordBatch,
  loadRun,
};
