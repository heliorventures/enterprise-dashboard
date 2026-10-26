const MIB = 1024 ** 2;
function fromEnvironment(env = process.env) {
  const read = (name, fallback, maximum) => {
    const text = env[name] ?? String(fallback);
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} must be an integer between 1 and ${maximum} MiB`);
    }
    return value * MIB;
  };
  const maxSnapshotBytes = read('SOURCE_SNAPSHOT_MAX_MIB', 1024, 8192);
  const maxStagingBytes = read('SOURCE_STAGING_MAX_MIB', 4096, 32768);
  if (maxStagingBytes < maxSnapshotBytes) throw new Error('SOURCE_STAGING_MAX_MIB must cover SOURCE_SNAPSHOT_MAX_MIB');
  return { maxSnapshotBytes, maxStagingBytes };
}
function assertBudget(actualBytes, limitBytes, staging = false) {
  if (actualBytes > limitBytes) throw Object.assign(new Error(
    staging ? 'Source staging capacity reached' : `Source snapshot exceeds configured ${limitBytes / MIB} MiB limit`), {
    code: staging ? 'SOURCE_STAGING_LIMIT' : 'SOURCE_SNAPSHOT_LIMIT',
    status: staging ? 429 : 413, actualBytes, limitBytes,
  });
}
module.exports = { fromEnvironment, assertBudget };
