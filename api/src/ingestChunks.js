const { createHash } = require('node:crypto');
const db = require('./db');
const { validateSnapshot, applySnapshot, appendRows } = require('./ingest');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateManifest(input) {
  const snapshot = validateSnapshot({ ...input, ledgers: [], vouchers: [] });
  for (const key of ['chunkCount', 'ledgerCount', 'voucherCount']) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 0 || input[key] > (key === 'chunkCount' ? 10000 : 5000000)) fail(`Invalid ${key}`);
  }
  if (input.chunkCount < 1) fail('At least one chunk is required');
  const { ledgers, vouchers, ...metadata } = snapshot;
  return { ...metadata, fullSnapshot: true, chunkCount: input.chunkCount, ledgerCount: input.ledgerCount, voucherCount: input.voucherCount };
}
async function locked(work) {
  return db.transaction(async client => {
    // Same lock order as legacy ingestion; also serializes staging quota checks.
    await client.query('SELECT pg_advisory_xact_lock(74312002)');
    return work(client);
  });
}
async function begin(input) {
  const manifest = validateManifest(input);
  return locked(async client => {
    // Incomplete staging expires after seven idle days. Completed receipts remain.
    await client.query("DELETE FROM tally_uploads WHERE result IS NULL AND updated_at < now() - interval '7 days'");
    const prior = (await client.query('SELECT manifest, result FROM tally_uploads WHERE batch_id=$1', [manifest.batchId])).rows[0];
    if (prior) {
      if (digest(validateManifest(prior.manifest)) !== digest(manifest)) fail('Batch manifest conflict', 409);
      await client.query('UPDATE tally_uploads SET updated_at=now() WHERE batch_id=$1', [manifest.batchId]);
      return { ok: true, batchId: manifest.batchId, completed: Boolean(prior.result) };
    }
    if ((await client.query('SELECT 1 FROM tally_ingestions WHERE batch_id=$1', [manifest.batchId])).rowCount) fail('Batch already used by another protocol', 409);
    const count = (await client.query('SELECT count(*)::int AS count FROM tally_uploads WHERE result IS NULL')).rows[0].count;
    if (count >= 100) fail('Too many pending uploads', 429);
    await client.query('INSERT INTO tally_uploads(batch_id, manifest) VALUES ($1,$2)', [manifest.batchId, JSON.stringify(manifest)]);
    return { ok: true, batchId: manifest.batchId, completed: false };
  });
}
async function chunk(input) {
  if (typeof input?.batchId !== 'string' || !Number.isSafeInteger(input.index) || input.index < 0) fail('Invalid chunk identity');
  return locked(async client => {
    const upload = (await client.query('SELECT * FROM tally_uploads WHERE batch_id=$1 FOR UPDATE', [input.batchId])).rows[0];
    if (!upload) fail('Begin upload first', 409);
    if (upload.result) return { ok: true, completed: true, batchId: input.batchId };
    if (input.index >= upload.manifest.chunkCount) fail('Chunk index outside manifest');
    if (!Array.isArray(input.ledgers) || !Array.isArray(input.vouchers) || input.ledgers.length + input.vouchers.length > 2000) fail('Chunk allows at most 2000 rows');
    const validated = validateSnapshot({ ...upload.manifest, ledgers: input.ledgers, vouchers: input.vouchers });
    const payload = { ledgers: validated.ledgers, vouchers: validated.vouchers };
    const checksum = digest(payload);
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (bytes > 1024 * 1024) fail('Chunk exceeds 1 MiB', 413);
    const prior = (await client.query('SELECT checksum FROM tally_upload_chunks WHERE batch_id=$1 AND chunk_index=$2', [input.batchId, input.index])).rows[0];
    if (prior) {
      if (prior.checksum !== checksum) fail('Chunk content conflict', 409);
      return { ok: true, duplicate: true, batchId: input.batchId, index: input.index };
    }
    if (Number(upload.bytes) + bytes > 512 * 1024 * 1024) fail('Company snapshot exceeds 512 MiB', 413);
    const total = (await client.query('SELECT coalesce(sum(bytes),0) AS bytes FROM tally_uploads WHERE result IS NULL')).rows[0].bytes;
    if (Number(total) + bytes > 2 * 1024 ** 3) fail('Staging storage limit reached', 429);
    await client.query('INSERT INTO tally_upload_chunks VALUES ($1,$2,$3,$4)', [input.batchId, input.index, checksum, JSON.stringify(payload)]);
    await client.query('UPDATE tally_uploads SET bytes=bytes+$2, updated_at=now() WHERE batch_id=$1', [input.batchId, bytes]);
    return { ok: true, duplicate: false, batchId: input.batchId, index: input.index };
  });
}
async function complete(input) {
  if (typeof input?.batchId !== 'string') fail('batchId required');
  return locked(async client => {
    const upload = (await client.query('SELECT * FROM tally_uploads WHERE batch_id=$1 FOR UPDATE', [input.batchId])).rows[0];
    if (!upload) fail('Upload not found; begin and resend retained chunks', 409);
    if (upload.result) return { ...upload.result, duplicate: true };
    const chunks = (await client.query('SELECT chunk_index, checksum FROM tally_upload_chunks WHERE batch_id=$1 ORDER BY chunk_index', [input.batchId])).rows;
    if (chunks.length !== upload.manifest.chunkCount || chunks.some((row, index) => row.chunk_index !== index)) fail('Upload is incomplete', 409);
    const checksum = digest({ manifest: validateManifest(upload.manifest), chunks });
    const result = await applySnapshot(client, upload.manifest, checksum, async companyId => {
      await client.query('DELETE FROM "Ledgers" WHERE "CompanyID"=$1', [companyId]);
      await client.query('DELETE FROM "Vouchers" WHERE "CompanyID"=$1 AND "Source"=\'tally\'', [companyId]);
      // Database uniqueness avoids retaining all ledger names in Node memory.
      await client.query('CREATE TEMP TABLE upload_ledger_names(name text PRIMARY KEY) ON COMMIT DROP');
      let ledgerCount = 0, voucherCount = 0;
      for (const { chunk_index } of chunks) {
        const { payload } = (await client.query('SELECT payload FROM tally_upload_chunks WHERE batch_id=$1 AND chunk_index=$2', [input.batchId, chunk_index])).rows[0];
        const names = payload.ledgers.map(row => row.name.toLowerCase());
        const inserted = await client.query('INSERT INTO upload_ledger_names SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [names]);
        if (inserted.rowCount !== names.length) fail('Duplicate ledger names across chunks', 400);
        await appendRows(client, companyId, payload.ledgers, payload.vouchers);
        ledgerCount += payload.ledgers.length;
        voucherCount += payload.vouchers.length;
      }
      if (ledgerCount !== upload.manifest.ledgerCount || voucherCount !== upload.manifest.voucherCount) fail('Manifest record counts do not match chunks', 409);
      return { ledgerCount, voucherCount };
    });
    await client.query('UPDATE tally_uploads SET result=$2, bytes=0, updated_at=now() WHERE batch_id=$1', [input.batchId, JSON.stringify(result)]);
    await client.query('DELETE FROM tally_upload_chunks WHERE batch_id=$1', [input.batchId]);
    return result;
  });
}
module.exports = { validateManifest, begin, chunk, complete };
