const { normalizeName } = require('../tally/provider');
const decimal = require('../transform/decimal');

function scoreMatch(account, ledger, sourceAmount, tallyAmount, rules) {
  const nameExact = Boolean(account.normalized && account.normalized === ledger.normalized);
  const nameClose = Boolean(account.normalized && ledger.normalized && (nameExact || account.normalized.includes(ledger.normalized) || ledger.normalized.includes(account.normalized)));
  const amountHit = decimal.abs(decimal.subtract(sourceAmount, tallyAmount)) <= decimal.cents(rules.amount_tolerance?.amount ?? 1000);
  if (account.pan && ledger.pan && account.pan === ledger.pan && nameClose) return {method:'PAN_NAME',score:0.97,fields:['pan_number','account_name']};
  if (account.gst && ledger.gst && account.gst === ledger.gst && nameClose) return {method:'GST_NAME',score:0.95,fields:['gst_number','account_name']};
  if (nameExact && amountHit) return {method:'NAME_AMOUNT',score:0.9,fields:['account_name','amount']};
  if (nameExact) return {method:'NAME',score:0.82,fields:['account_name']};
  if (nameClose && amountHit) return {method:'FUZZY_NAME_AMOUNT',score:0.7,fields:['account_name','amount']};
  if (nameClose) return {method:'FUZZY_NAME',score:0.55,fields:['account_name']};
  return null;
}

function comparison(row, ledger, match, rules, context) {
  const sourceAmount = decimal.amount(row.source_amount || 0);
  const tallyAmount = ledger ? decimal.amount(ledger.balance) : null;
  const available = Boolean(context.reportingDate && context.balanceDate && context.reportingDate === context.balanceDate);
  const difference = available ? decimal.subtract(sourceAmount, tallyAmount || 0) : null;
  const status = available ? !ledger ? 'MISSING_IN_TALLY' : decimal.abs(difference) <= decimal.cents(rules.amount_tolerance?.amount ?? 1000)
    ? 'MATCHED' : (match?.score || 0) < 0.8 ? 'PARTIALLY_MATCHED' : 'AMOUNT_MISMATCH' : 'COMPARISON_UNAVAILABLE';
  return {
    outstandingId:row.outstanding_id || null, companyId:row.company_id || null,
    tallyLedgerId:ledger?.id || null, tallyLedgerName:ledger?.name || null,
    sourceAmount, tallyAmount, difference,
    differencePct: difference != null && decimal.abs(sourceAmount) >= 100n ? Number(difference) / Math.abs(Number(sourceAmount)) * 100 : null,
    matchMethod:match?.method || null, matchScore:match?.score || null, matchingFields:match?.fields || [], status,
    reportingDate:context.reportingDate || null, balanceDate:context.balanceDate || null,
    tallyBatchId:context.batchId || null, comparisonAvailable:available,
  };
}

function reconcileAccounts(sourceRows, ledgers, rules = {}, context = {}) {
  const ledgerById = new Map(ledgers.map(row => [Number(row.id),row]));
  const mapsByAccount = new Map((context.maps || []).map(row => [row.account_id,row]));
  const reservations = new Map();
  for (const row of sourceRows) {
    const map = mapsByAccount.get(row.account_id);
    if (!map) continue;
    const id = Number(map.tally_ledger_id);
    if (reservations.has(id)) throw Object.assign(new Error('Manual ledger conflict: multiple accounts reserve one ledger'), {status:409});
    reservations.set(id,row.account_id);
  }
  const used = new Set(reservations.keys());
  const matched = sourceRows.map(row => {
    const manual = mapsByAccount.get(row.account_id);
    if (manual) return comparison(row,ledgerById.get(Number(manual.tally_ledger_id)),{method:'MANUAL',score:1,fields:['manual_map']},rules,context);
    const account = {...row,normalized:normalizeName(row.account_name),pan:row.pan_number,gst:row.gst_number};
    let best = null;
    for (const ledger of ledgers) {
      if (used.has(Number(ledger.id))) continue;
      const match = scoreMatch(account,{...ledger,normalized:ledger.normalized || normalizeName(ledger.name)},row.source_amount || 0,ledger.balance,rules);
      if (match && (!best || match.score > best.match.score)) best = {ledger,match};
    }
    if (best) used.add(Number(best.ledger.id));
    return comparison(row,best?.ledger,best?.match,rules,context);
  });
  const matchedIds = new Set(matched.map(row => row.tallyLedgerId));
  const missingInSource = ledgers.filter(row => !matchedIds.has(row.id) && decimal.abs(row.balance) > 0n).map(ledger => {
    const row = comparison({source_amount:0},ledger,null,rules,context);
    return {...row,status:row.comparisonAvailable ? 'MISSING_IN_SOURCE' : 'COMPARISON_UNAVAILABLE'};
  });
  return {matched,missingInSource};
}

module.exports = { reconcileAccounts, scoreMatch, comparison };
