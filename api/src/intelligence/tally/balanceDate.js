const { parseDate } = require('../excel/parser');
const config = require('../config');

function balanceDateBasis(value) {
  const balanceDate = parseDate(value);
  if (balanceDate === '9999-12-31') {
    return { balanceDate: null, balanceDateAssumed: config.assumeUndatedTallyBalances === true,
      balanceDateSource: 'full-history-export' };
  }
  return { balanceDate };
}

function balanceDateNotes(reference, reportingDate) {
  if (reference?.balanceDateAssumed !== true) return [];
  const source = reference.balanceDateSource === 'full-history-export'
    ? 'Tally was exported for its full history; the export limit is not a confirmed balance date.'
    : 'Tally balances here carry no date.';
  return [`${source} For this comparison, Tally balances are assumed to have the same date as the Excel (${reportingDate}). A difference can be caused by timing as well as by a real mismatch.`];
}

module.exports = { balanceDateBasis, balanceDateNotes };
