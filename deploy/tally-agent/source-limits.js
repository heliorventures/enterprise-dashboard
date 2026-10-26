const LEGACY_MAX_BYTES = 500 * 1024 ** 2;
const MAX_BYTES = 8 * 1024 ** 3;
function snapshotLimit(config = {}) {
  const value = config.sourceSnapshotMaxBytes ?? LEGACY_MAX_BYTES;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BYTES) throw new Error('Invalid source snapshot budget');
  return value;
}
function assertBudget(actualBytes, config) {
  const limitBytes = snapshotLimit(config);
  if (actualBytes > limitBytes) throw Object.assign(new Error(`Source snapshot exceeds configured ${limitBytes / 1024 ** 2} MiB limit`), {
    code: 'SOURCE_SNAPSHOT_LIMIT', actualBytes, limitBytes,
  });
}
async function negotiate(config, token, fetcher = fetch) {
  const response = await fetcher(config.apiUrl + '/api/ingest/tally/source/capabilities', {
    headers: { Authorization: 'Bearer ' + token }, redirect: 'error',
    signal: config.signal ? AbortSignal.any([config.signal, AbortSignal.timeout(config.requestTimeoutMs)]) : AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return { sourceSnapshotMaxBytes: LEGACY_MAX_BYTES };
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`API capabilities: HTTP ${response.status}`);
  }
  let value;
  try { value = await response.json(); }
  catch { throw new Error('Invalid source capabilities acknowledgement'); }
  if (value?.protocol !== 1 || !Number.isSafeInteger(value.maxSnapshotBytes) || value.maxSnapshotBytes < 1 || value.maxSnapshotBytes > MAX_BYTES) {
    throw new Error('Invalid source capabilities acknowledgement');
  }
  return { sourceSnapshotMaxBytes: value.maxSnapshotBytes };
}
module.exports = { negotiate, snapshotLimit, assertBudget };
