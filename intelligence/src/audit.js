const db = require('./db');

async function record({ username, action, entity, entityId, oldValue, newValue }) {
  await db.query(
    `INSERT INTO intel_audit (username, action, entity, entity_id, old_value, new_value)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [username || null, action, entity, entityId || null, oldValue || null, newValue || null]
  );
}

async function list({ entity, limit = 100 } = {}) {
  const result = await db.query(
    `SELECT id, username, action, entity, entity_id, old_value, new_value, created_at
     FROM intel_audit
     WHERE ($1::text IS NULL OR entity=$1)
     ORDER BY id DESC LIMIT $2`,
    [entity || null, Math.min(Number(limit) || 100, 500)]
  );
  return result.rows;
}

module.exports = { record, list };
