const { entities } = require('./reportingEntities');
const { createProjection } = require('./sourceProjection');
const key = value => String(value || '').trim().toLowerCase();

function buildProjection(rows, helpers) {
  const builder = createProjection(helpers);
  for (const row of rows) builder.definition(row);
  builder.resolveDefinitions();
  for (const row of rows) if (row.collection === 'LEDGER') builder.ledger(row);
  for (const row of rows) if (row.collection === 'VOUCHER') builder.voucher(row);
  return builder.finish();
}

// Raw trees live only for the current database page. The derived model retains
// financial fields and provenance, never the full unused Tally payloads.
async function buildProjectionFrom(readRows, helpers, onRecord = () => {}) {
  const builder = createProjection(helpers);
  for await (const row of readRows('definitions')) { builder.definition(row); onRecord(row); }
  builder.resolveDefinitions();
  for await (const row of readRows('ledgers')) builder.ledger(row);
  for await (const row of readRows('vouchers')) { builder.definition(row); builder.voucher(row); onRecord(row); }
  return builder.finish();
}


async function writeProjection(client, companyId, snapshot, model) {
  // Stage and reconcile inside the publication transaction. Unchanged rows retain
  // their original source evidence and avoid unnecessary updates/index churn.
  const masterIndex = new Map(
    model.masters.map((m) => [`${m.collection}:${key(m.name)}`, m.source_key]),
  );
  const definitions = [
    ...Object.entries(entities).map(([collection, entity]) => [
      entity.table,
      model.masters
        .filter((m) => m.collection === collection)
        .map((m) => ({
          ...m,
          ...Object.fromEntries(
            entity.relationships.map((r) => [
              r.key,
              masterIndex.get(`${r.collection}:${key(m[r.field])}`) || null,
            ]),
          ),
        })),
      [
        "source_key text",
        "name text",
        ...entity.fields.map((f) => `${f} text`),
        "properties jsonb",
        "ordinal integer",
        ...entity.relationships.map((r) => `${r.key} text`),
      ].join(","),
    ]),
    [
      "finance_ledger_facts",
      model.ledgers,
      "name text,group_name text,root_group text,opening_balance numeric,closing_balance numeric,currency text,ordinal integer",
    ],
    [
      "finance_postings",
      model.postings,
      "voucher_key text,entry_index integer,ledger_name text,amount numeric,voucher_date date,voucher_type text,base_type text,ordinal integer",
    ],
    [
      "finance_allocations",
      model.allocations,
      "voucher_key text,entry_index integer,allocation_index integer,category_name text,centre_name text,amount numeric,ordinal integer",
    ],
    [
      "finance_inventory_movements",
      model.inventory,
      "voucher_key text,movement_index integer,stock_item text,godown_name text,quantity_text text,amount numeric,voucher_date date,ordinal integer",
    ],
  ];
  for (const [table, rows, definition] of definitions) {
    const fields = definition.split(",").map((x) => x.split(" ")[0]);
    const columns = fields.join(",");
    const identity =
      table === "finance_ledger_facts"
        ? ["name"]
        : table === "finance_postings"
          ? ["voucher_key", "entry_index"]
          : table === "finance_allocations"
            ? ["voucher_key", "entry_index", "allocation_index"]
            : table === "finance_inventory_movements"
              ? ["voucher_key", "movement_index"]
              : ["source_key"];
    const stage = `stage_${table}`;
    await client.query(
      `CREATE TEMP TABLE ${stage} ON COMMIT DROP AS SELECT company_id,batch_id,${columns} FROM ${table} WITH NO DATA`,
    );
    for (let offset = 0; offset < rows.length; offset += 1000) {
      await client.query(
        `INSERT INTO ${stage}(company_id,batch_id,${columns}) SELECT $1,$2,${columns} FROM jsonb_to_recordset($3::jsonb) AS x(${definition})`,
        [
          companyId,
          snapshot.batch_id,
          JSON.stringify(rows.slice(offset, offset + 1000)),
        ],
      );
    }
    await client.query(
      `CREATE UNIQUE INDEX ON ${stage}(company_id,${identity.join(",")})`,
    );
    await client.query(`ANALYZE ${stage}`);
    await client.query(`INSERT INTO ${table} AS target(company_id,batch_id,${columns}) SELECT company_id,batch_id,${columns} FROM ${stage}
      ON CONFLICT(company_id,${identity.join(",")}) DO UPDATE SET batch_id=EXCLUDED.batch_id,${fields.map((f) => `${f}=EXCLUDED.${f}`).join(",")}
      WHERE ROW(${fields.map((f) => `target.${f}`).join(",")}) IS DISTINCT FROM ROW(${fields.map((f) => `EXCLUDED.${f}`).join(",")})`);
    await client.query(
      `DELETE FROM ${table} target WHERE company_id=$1 AND NOT EXISTS(SELECT 1 FROM ${stage} s WHERE s.company_id=target.company_id AND ${identity.map((f) => `s.${f}=target.${f}`).join(" AND ")})`,
      [companyId],
    );
  }
  // Bulk writes are not visible to autovacuum until commit. Refresh planner
  // statistics before joins, especially when publishing a new company.
  for (const table of [
    "finance_ledger_facts",
    "finance_postings",
    "finance_allocations",
    "finance_inventory_movements",
  ])
    await client.query(`ANALYZE ${table}`);
  await client.query("SELECT refresh_finance_summaries($1,$2)", [
    companyId,
    snapshot.batch_id,
  ]);
  await client.query(
    `INSERT INTO finance_snapshots(company_id,batch_id,currency,books_from,starting_from,captured_at,coverage,model_version)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,2) ON CONFLICT(company_id) DO UPDATE SET batch_id=EXCLUDED.batch_id,currency=EXCLUDED.currency,books_from=EXCLUDED.books_from,starting_from=EXCLUDED.starting_from,captured_at=EXCLUDED.captured_at,coverage=EXCLUDED.coverage,applied_at=now(),model_version=2`,
    [
      companyId,
      snapshot.batch_id,
      model.company.currency,
      model.company.books_from,
      model.company.starting_from,
      snapshot.captured_at,
      JSON.stringify({...model.coverage,history:snapshot.manifest?.historyCoverage||{kind:'full'}}),
    ],
  );
}
module.exports = { buildProjection, buildProjectionFrom, writeProjection };
