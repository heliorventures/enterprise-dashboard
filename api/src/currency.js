// Normalize known source labels without guessing ambiguous symbols or converting money.
const rupees = new Set(['₹', 'RS', 'RS.', 'RUPEE', 'RUPEES', 'INDIAN RUPEE', 'INDIAN RUPEES']);
// Observed damaged Tally labels carry no usable currency identity. Publication
// resolves these against the configured company currency, including its INR default.
const damaged = new Set(['?', 'I?', '\uFFFD']);
function normalizeCurrency(value) {
  const code = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
  if (damaged.has(code)) return null;
  return rupees.has(code) ? 'INR' : code || null;
}
module.exports = { normalizeCurrency };
