// Numeric IDs belong to a particular snapshot. Source keys survive refreshes;
// archived GUIDs additionally prove identity when a source name changes.
function resolveManualLedger(map, ledgers) {
  let matches;
  if (map.tally_ledger_guid) {
    matches = ledgers.filter(row => row.guid === map.tally_ledger_guid);
    if (!matches.length && map.tally_source_key) {
      matches = ledgers.filter(row => row.sourceKey === map.tally_source_key && !row.guid);
    }
  } else if (map.tally_source_key) {
    matches = ledgers.filter(row => row.sourceKey === map.tally_source_key);
    // Pre-upgrade frozen references have no durable fields; only their original
    // ID and exact name may be used. Never redirect them to a current ledger.
    if (!matches.length) matches = ledgers.filter(row => !row.sourceKey && Number(row.id) === Number(map.tally_ledger_id)
      && row.name === map.tally_ledger_name);
  } else {
    matches = ledgers.filter(row => Number(row.id) === Number(map.tally_ledger_id)
      && (!map.tally_ledger_name || row.name === map.tally_ledger_name));
    if (!matches.length && map.tally_ledger_name) {
      const key = `ledger:${map.tally_ledger_name.trim().toLowerCase()}`;
      matches = ledgers.filter(row => row.sourceKey === key);
    }
  }
  if (!matches.length && map.tally_ledger_name) {
    matches = ledgers.filter(row => !row.sourceKey && !row.guid && Number(row.id) === Number(map.tally_ledger_id)
      && row.name === map.tally_ledger_name);
  }
  if (matches.length > 1) throw Object.assign(new Error('Ambiguous manual ledger identity; review the account mapping'), {status:409});
  if (!matches.length) throw Object.assign(new Error(`Manual ledger mapping for ${map.tally_ledger_name || map.account_id} is unavailable; review its identity before publishing`), {status:409});
  return matches[0];
}

module.exports = {resolveManualLedger};
