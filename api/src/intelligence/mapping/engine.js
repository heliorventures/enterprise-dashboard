const { guessTarget, normalizeSpace } = require('../excel/parser');

function aliasesFor(header) {
  const compact = normalizeSpace(header).toLowerCase();
  return [compact, compact.replace(/[^a-z0-9]+/g, ' ').trim()];
}

function resolveMaps(dbMaps, columns) {
  const byHeader = new Map();
  for (const row of dbMaps || []) {
    for (const alias of [row.source_header, ...(row.source_aliases || [])]) {
      byHeader.set(normalizeSpace(alias).toLowerCase(), row.target_field);
    }
  }
  const resolved = columns.map((col) => {
    const key = normalizeSpace(col.canonical).toLowerCase();
    const parentKey = normalizeSpace(col.parent || '').toLowerCase();
    let mapped = byHeader.get(key) || byHeader.get(parentKey) || col.target || guessTarget(col.canonical, col.parent, col.child);
    if (mapped === 'particulars') mapped = 'account_name';
    return { ...col, target: mapped || null, unmapped: !mapped };
  });
  if (resolved.some((col) => col.target === 'account_name')) return resolved;
  const fallback = resolved.find((col) => col.index === 1) || resolved[0];
  if (!fallback) return resolved;
  return resolved.map((col) => (
    col.index === fallback.index ? { ...col, target: 'account_name', unmapped: false } : col
  ));
}

async function loadMaps(db, { sourceSystemId, companyId } = {}) {
  const result = await db.query(
    `SELECT source_header, source_aliases, target_field
     FROM intel_column_maps
     WHERE active = true
       AND ($1::uuid IS NULL OR source_system_id = $1 OR source_system_id IS NULL)
       AND ($2::uuid IS NULL OR company_id = $2 OR company_id IS NULL)
     ORDER BY company_id NULLS LAST, source_system_id NULLS LAST, version DESC`,
    [sourceSystemId || null, companyId || null]
  );
  return result.rows;
}

async function saveDetectedMaps(db, columns, { sourceSystemId, companyId } = {}) {
  for (const col of columns) {
    if (!col.target) continue;
    await db.query(
      `INSERT INTO intel_column_maps (source_system_id, company_id, source_header, source_aliases, target_field)
       SELECT $1,$2,$3,$4,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM intel_column_maps
         WHERE source_header=$3
           AND company_id IS NOT DISTINCT FROM $2::uuid
           AND source_system_id IS NOT DISTINCT FROM $1::uuid
       )`,
      [sourceSystemId || null, companyId || null, col.canonical, aliasesFor(col.canonical), col.target]
    );
  }
}

module.exports = { resolveMaps, loadMaps, saveDetectedMaps, aliasesFor };
