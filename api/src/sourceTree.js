// Tally emits empty subcollections as whitespace-only .LIST nodes. Keep the
// archive intact, but do not interpret those placeholders as business records.
function isEmptyList(node) {
  return /\.LIST$/i.test(node?.tag || '') &&
    Array.isArray(node.content) &&
    node.content.every(value => typeof value === 'string' && !value.trim()) &&
    Object.entries(node.attributes || {}).every(([name, value]) =>
      /^(TYPE|ISLIST)$/i.test(name) || !String(value).trim());
}

module.exports = { isEmptyList };
