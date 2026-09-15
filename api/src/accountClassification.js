// Only a resolved accounting root (or an exact native group for manual books)
// establishes expense classification. Custom names are not accounting evidence.
const EXPENSE_ROOTS = Object.freeze(['purchase accounts', 'direct expenses', 'indirect expenses']);
function isExpenseGroup(name) {
  return EXPENSE_ROOTS.includes(String(name || '').trim().toLowerCase());
}
module.exports = { EXPENSE_ROOTS, isExpenseGroup };
