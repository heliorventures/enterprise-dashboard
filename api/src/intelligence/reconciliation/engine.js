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
  const currency = require('../../reportCurrency').currencyCode(context.sourceCurrency);
  const tallyCurrency = require('../../reportCurrency').currencyCode(ledger?.currency || context.tallyCurrency);
  // Legacy Tally balances have no date. Only when that is explicitly allowed are they
  // treated as dated the same as the Excel; a dated snapshot must always agree.
  const sameDate = context.balanceDate ? context.reportingDate === context.balanceDate : context.balanceDateAssumed === true;
  const available = Boolean(context.reportingDate && sameDate
    && currency && currency===tallyCurrency && currency===require('../../reportCurrency').currencyCode(context.tallyCurrency));
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
    sourceCurrency:currency,tallyCurrency,currency:currency===tallyCurrency ? currency : null,
  };
}

function reconcileAccounts(sourceRows, ledgers, rules = {}, context = {}) {
  const {resolveManualLedger} = require('./identity');
  const manualLedgers = new Map();
  const mapsByAccount = new Map((context.maps || []).map(row => [row.account_id,row]));
  const reservations = new Map();
  for (const row of sourceRows) {
    const map = mapsByAccount.get(row.account_id);
    if (!map) continue;
    const ledger = resolveManualLedger(map,ledgers);
    manualLedgers.set(row.account_id,ledger);
    const id = Number(ledger.id);
    if (reservations.has(id)) throw Object.assign(new Error('Manual ledger conflict: multiple accounts reserve one ledger'), {status:409});
    reservations.set(id,row.account_id);
  }
  const used = new Set(reservations.keys());
  // Names that differ only by spacing or punctuation ("X  2%" and "X 2%") normalize to
  // the same text. Within such a group the account whose exact name equals a Tally
  // ledger name claims that ledger first, so the result does not depend on row order.
  const exactName = value => String(value ?? '').trim().toLowerCase();
  const groups = new Map();
  for (const row of sourceRows) {
    if (mapsByAccount.has(row.account_id)) continue;
    const key = normalizeName(row.account_name);
    if (key) groups.set(key, [...(groups.get(key) || []), row]);
  }
  const claims = new Map();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      const ledger = ledgers.find(item => !used.has(Number(item.id)) && exactName(item.name) === exactName(row.account_name));
      if (ledger) { used.add(Number(ledger.id)); claims.set(row, ledger); }
    }
  }
  const matched = sourceRows.map(row => {
    const manual = mapsByAccount.get(row.account_id);
    if (manual) return comparison(row,manualLedgers.get(row.account_id),{method:'MANUAL',score:1,fields:['manual_map']},rules,context);
    const account = {...row,normalized:normalizeName(row.account_name),pan:row.pan_number,gst:row.gst_number};
    const claimed = claims.get(row);
    if (claimed) {
      const match = scoreMatch(account,{...claimed,normalized:claimed.normalized || normalizeName(claimed.name)},row.source_amount || 0,claimed.balance,rules);
      return comparison(row,claimed,match,rules,context);
    }
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
