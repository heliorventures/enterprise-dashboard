const { normalizeName } = require('../tally/provider');
const { money } = require('../transform/normalize');

function scoreMatch(account, ledger, sourceAmount, tallyAmount, rules) {
  const amountTol = Number(rules.amount_tolerance?.amount) || 1000;
  const nameExact = account.normalized === ledger.normalized;
  const nameClose = nameExact || account.normalized.includes(ledger.normalized) || ledger.normalized.includes(account.normalized);
  const panHit = account.pan && ledger.pan && account.pan === ledger.pan;
  const gstHit = account.gst && ledger.gst && account.gst === ledger.gst;
  const amountHit = Math.abs((sourceAmount || 0) - (tallyAmount || 0)) <= amountTol;
  if (panHit && nameClose) return { method: 'PAN_NAME', score: 0.97, fields: ['pan_number', 'account_name'] };
  if (gstHit && nameClose) return { method: 'GST_NAME', score: 0.95, fields: ['gst_number', 'account_name'] };
  if (nameExact && amountHit) return { method: 'NAME_AMOUNT', score: 0.9, fields: ['account_name', 'amount'] };
  if (nameExact) return { method: 'NAME', score: 0.82, fields: ['account_name'] };
  if (nameClose && amountHit) return { method: 'FUZZY_NAME_AMOUNT', score: 0.7, fields: ['account_name', 'amount'] };
  if (nameClose) return { method: 'FUZZY_NAME', score: 0.55, fields: ['account_name'] };
  return null;
}

function statusFor({ match, sourceAmount, tallyAmount, rules }) {
  if (!match) return 'MISSING_IN_TALLY';
  const critical = Number(rules.critical_difference?.amount) || 100000;
  const tol = Number(rules.amount_tolerance?.amount) || 1000;
  const diff = money((sourceAmount || 0) - (tallyAmount || 0));
  if (Math.abs(diff) <= tol) return 'MATCHED';
  if (match.score < 0.8) return 'PARTIALLY_MATCHED';
  if (Math.abs(diff) >= critical) return 'AMOUNT_MISMATCH';
  return 'AMOUNT_MISMATCH';
}

function reconcileAccounts(sourceRows, ledgers, rules = {}) {
  const used = new Set();
  const results = sourceRows.map((row) => {
    const account = {
      ...row,
      normalized: normalizeName(row.account_name),
      pan: (row.pan_number || '').replace(/\s/g, '').toUpperCase() || null,
      gst: (row.gst_number || '').replace(/\s/g, '').toUpperCase() || null,
    };
    const sourceAmount = Number(row.source_amount) || 0;
    let best = null;
    for (const ledger of ledgers) {
      if (used.has(ledger.id)) continue;
      const match = scoreMatch(account, { ...ledger, pan: null, gst: null }, sourceAmount, ledger.balance, rules);
      if (match && (!best || match.score > best.match.score)) best = { match, ledger };
    }
    if (best && best.match.score >= 0.55) used.add(best.ledger.id);
    const tallyAmount = best ? Number(best.ledger.balance) || 0 : null;
    const difference = tallyAmount == null ? sourceAmount : money(sourceAmount - tallyAmount);
    const status = statusFor({ match: best?.match, sourceAmount, tallyAmount: tallyAmount || 0, rules });
    return {
      outstandingId: row.outstanding_id,
      companyId: row.company_id,
      tallyLedgerId: best?.ledger.id || null,
      tallyLedgerName: best?.ledger.name || null,
      tallyAmount,
      sourceAmount,
      difference,
      differencePct: Math.abs(sourceAmount) >= 1 ? money((difference / Math.abs(sourceAmount)) * 100) : null,
      matchMethod: best?.match.method || null,
      matchScore: best?.match.score || null,
      matchingFields: best?.match.fields || [],
      status,
    };
  });
  const matchedIds = new Set(results.map((row) => row.tallyLedgerId).filter(Boolean));
  const missingInSource = ledgers
    .filter((ledger) => !matchedIds.has(ledger.id) && Math.abs(ledger.balance) > 0)
    .map((ledger) => ({
      outstandingId: null,
      tallyLedgerId: ledger.id,
      tallyLedgerName: ledger.name,
      tallyAmount: ledger.balance,
      sourceAmount: 0,
      difference: money(0 - ledger.balance),
      differencePct: null,
      matchMethod: null,
      matchScore: null,
      matchingFields: [],
      status: 'MISSING_IN_SOURCE',
    }));
  return { matched: results, missingInSource };
}

module.exports = { reconcileAccounts, scoreMatch };
