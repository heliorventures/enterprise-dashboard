// Tally emits empty subcollections as whitespace-only .LIST nodes. Keep the
// archive intact, but do not interpret those placeholders as business records.
function isEmptyList(node) {
  return /\.LIST$/i.test(node?.tag || '') &&
    Array.isArray(node.content) &&
    node.content.every(value => typeof value === 'string' && !value.trim()) &&
    Object.entries(node.attributes || {}).every(([name, value]) =>
      /^(TYPE|ISLIST)$/i.test(name) || !String(value).trim());
}

// Resolve repeated FETCH + wildcard scalar fields without changing the archive.
// Conflicts and structured values stay invalid; repeated lists are never merged.
function scalarField(node, name) {
  const matches=(node?.content||[]).filter(child=>child&&typeof child==='object'&&child.tag.toUpperCase()===name&&!isEmptyList(child));
  if(matches.length) {
    if(matches.some(child=>!child.content.every(value=>typeof value==='string')))return null;
    const values=matches.map(child=>child.content.join(''));
    return values.every(value=>value===values[0])?values[0]:null;
  }
  const key=Object.keys(node?.attributes||{}).find(attribute=>attribute.toUpperCase()===name);
  return key===undefined?null:node.attributes[key];
}

module.exports = { isEmptyList, scalarField };
