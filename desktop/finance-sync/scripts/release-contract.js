const assert=require('node:assert/strict');
// Reviewed release requirements. Do not derive this inventory from emitted
// results: an early return must fail even if all emitted results passed.
const REQUIRED_SCENARIOS=Object.freeze([
  'Passive startup and installed version',
  'First Today sync without full baseline, two sequential companies',
  'Full sync restores complete history and preserves manual entries',
  'Month replacement changes exact amounts and preserves other company/history',
  'Empty Today replacement deletes omitted vouchers only in that day',
  'Last month replacement and a voucher moved into Today reconcile both dates',
  'Full replacement removes omitted history',
  'Malformed voucher response preserves published data and stops next company',
  'Disconnected Tally preserves data without automatic retry',
  'Tally HTTP failure preserves data without automatic retry',
  'Slow Tally export times out without changing Finance',
  'Stop aborts an in-flight export and sends no further requests',
  'Failed upload retains data; manual retry resends the exact saved payload',
  'Lost acknowledgement after commit remains idempotent on manual retry',
  'Worker termination during upload survives app reopen and manual recovery',
  'Large synthetic export has exact count and decimal total',
  'Authenticated dashboard exposes published coverage and company isolation',
  'Reopening shows history and remains passive',
  'Wire evidence proves serial requests, pacing and bounded voucher windows',
]);
function validateE2EReport(report) {
  assert.equal(report?.passed,true,'E2E must explicitly pass');
  assert.ok(Array.isArray(report.scenarios),'Missing scenario evidence');
  assert.deepEqual(report.scenarios.map(s=>s.name).sort(),[...REQUIRED_SCENARIOS].sort(),'Required scenario inventory differs');
  assert.ok(report.scenarios.every(s=>s.status==='passed'),'Every required scenario must pass');
  return report.scenarios.length;
}
module.exports={REQUIRED_SCENARIOS,validateE2EReport};
