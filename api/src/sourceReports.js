const db = require("./db");
const { companyFilter, paging } = require("./filters");
function pageOf(query) {
  return paging(query.page || 1, Math.min(Number(query.pageSize || 25), 100));
}
function batchFilter(value) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 200)
    throw Object.assign(new Error("Invalid batch ID"), { status: 400 });
  return value;
}
function monthValue(value) {
  if (value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value)
  )
    throw Object.assign(new Error("Reporting month must be YYYY-MM"), {
      status: 400,
    });
  return value;
}
async function periodOf(query, id, client) {
  let from = monthValue(query.fromMonth),
    to = monthValue(query.toMonth);
  if (from && to && from > to)
    throw Object.assign(new Error("Start month must not follow end month"), {
      status: 400,
    });
  if (!from && !to) {
    const latest = (
      await client.query(
        `SELECT coalesce(max(coverage->>'latestVoucherMonth'),(SELECT to_char(max(month),'YYYY-MM') FROM finance_monthly_summaries WHERE ($1=0 OR company_id=$1)),to_char(max(captured_at),'YYYY-MM')) AS latest_month FROM finance_snapshots WHERE ($1=0 OR company_id=$1)`,
        [id],
      )
    ).rows[0]?.latest_month;
    to = latest || new Date().toISOString().slice(0, 7);
    const date = new Date(`${to}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 11);
    from = date.toISOString().slice(0, 7);
  } else if (!from || !to)
    throw Object.assign(new Error("Both reporting months are required"), {
      status: 400,
    });
  return { fromMonth: from, toMonth: to };
}
async function overview(query = {}, client) {
  if (typeof query !== "object") query = { company: query };
  const id = companyFilter(query.company);
  const period = await periodOf(query, id, client);
  const companies = await client.query(
    `SELECT c."CompanyID"::text id,c."CompanyName" name,s.batch_id,s.currency,
    s.books_from,s.starting_from,s.captured_at,s.applied_at,s.coverage,
    (SELECT count(*)::int FROM source_validation_issues i WHERE i.batch_id=s.batch_id) issue_count
    FROM "Companies" c LEFT JOIN finance_snapshots s ON s.company_id=c."CompanyID"
    WHERE c."IsActive" AND ($1=0 OR c."CompanyID"=$1) ORDER BY c."CompanyName"`,
    [id],
  );
  const groups = await client.query(
    `SELECT f.company_id::text company_id,COALESCE(f.root_group,'Unclassified') name,
    sum(f.closing_balance)::text amount,count(*)::int count FROM finance_ledger_facts f
    JOIN "Companies" c ON c."CompanyID"=f.company_id WHERE c."IsActive" AND ($1=0 OR f.company_id=$1)
    GROUP BY f.company_id,f.root_group ORDER BY f.company_id,abs(sum(f.closing_balance)) DESC`,
    [id],
  );
  const readSummary = async (kind) =>
    client.query(
      `SELECT m.company_id::text company_id,${kind === "posting" ? "to_char(m.month,'YYYY-MM')" : "m.name"} name,
      ${kind === "allocation" ? "NULLIF(m.category_name,'') category_name," : ""}
      sum(m.amount)::text amount,sum(m.count)::int count,sum(m.valued)::int valued
     FROM finance_monthly_summaries m JOIN "Companies" c ON c."CompanyID"=m.company_id
     WHERE c."IsActive" AND ($1=0 OR m.company_id=$1) AND m.kind=$2 AND m.month >= $3::date AND m.month <= $4::date
     GROUP BY m.company_id,${kind === "posting" ? "m.month" : "m.name"}${kind === "allocation" ? ",m.category_name" : ""}
     ORDER BY m.company_id,name`,
      [id, kind, period.fromMonth + "-01", period.toMonth + "-01"],
    );
  const allocations = await readSummary("allocation");
  const inventory = await readSummary("inventory");
  const postings = await readSummary("posting");
  const masters = await client.query(
    `SELECT m.company_id::text company_id,m.collection,count(*)::int count FROM finance_masters m
    JOIN "Companies" c ON c."CompanyID"=m.company_id WHERE c."IsActive" AND ($1=0 OR m.company_id=$1)
    GROUP BY m.company_id,m.collection ORDER BY m.company_id,m.collection`,
    [id],
  );
  return {
    period,
    companies: companies.rows,
    groups: groups.rows,
    allocations: allocations.rows,
    inventory: inventory.rows,
    postings: postings.rows,
    masters: masters.rows,
  };
}
async function archives(query = {}, client) {
  const id = companyFilter(query.company),
    { size, current, offset } = pageOf(query);
  const where = `FROM tally_source_snapshots s LEFT JOIN "Companies" c ON c."ExternalID"=s.company_external_id WHERE ($1=0 OR c."CompanyID"=$1)`;
  const total = (
    await client.query(`SELECT count(*)::int count ${where}`, [id])
  ).rows[0].count;
  const rows = await client.query(
    `SELECT s.batch_id id,s.company_name,s.captured_at,s.received_at,s.coverage_status,s.manifest->'collections' collections,s.manifest->'exporter' exporter,
    (SELECT count(*)::int FROM tally_diagnostics d WHERE d.batch_id=s.batch_id) diagnostic_count,
    (SELECT i.status FROM source_sync_items i WHERE i.batch_id=s.batch_id ORDER BY i.item_id DESC LIMIT 1) sync_status,
    (SELECT count(*)::int FROM source_validation_issues i WHERE i.batch_id=s.batch_id) issue_count
    ${where} ORDER BY s.received_at DESC,s.batch_id DESC LIMIT $2 OFFSET $3`,
    [id, size, offset],
  );
  return { items: rows.rows, total, page: current, pageSize: size };
}
async function issues(query = {}, client) {
  const id = companyFilter(query.company),
    batch = batchFilter(query.batch),
    { size, current, offset } = pageOf(query);
  const where = `FROM source_validation_issues i JOIN tally_source_snapshots s USING(batch_id)
    LEFT JOIN "Companies" c ON c."ExternalID"=s.company_external_id WHERE ($1=0 OR c."CompanyID"=$1) AND ($2::text IS NULL OR i.batch_id=$2)`;
  const total = (
    await client.query(`SELECT count(*)::int count ${where}`, [id, batch])
  ).rows[0].count;
  const rows = await client.query(
    `SELECT i.issue_id::text id,s.company_name,i.batch_id,i.collection,i.ordinal,i.field,i.severity,i.code,i.message,i.created_at ${where}
    ORDER BY i.issue_id DESC LIMIT $3 OFFSET $4`,
    [id, batch, size, offset],
  );
  return { items: rows.rows, total, page: current, pageSize: size };
}
async function record(query = {}, client) {
  const batch = batchFilter(query.batch),
    ordinal = Number(query.ordinal);
  if (
    !batch ||
    !/^[A-Z]+$/.test(String(query.collection)) ||
    query.ordinal === undefined ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0
  )
    throw Object.assign(
      new Error(
        "Batch, collection and nonnegative record ordinal are required",
      ),
      { status: 400 },
    );
  const result = await client.query(
    "SELECT payload FROM tally_source_records WHERE batch_id=$1 AND collection=$2 AND ordinal=$3",
    [batch, query.collection, ordinal],
  );
  if (!result.rows.length)
    throw Object.assign(new Error("Source record not found"), { status: 404 });
  return result.rows[0];
}
async function masterRows(query = {}, client) {
  const id = companyFilter(query.company),
    { size, current, offset } = pageOf(query);
  const collection = batchFilter(query.collection);
  const where = `FROM finance_masters m JOIN "Companies" c ON c."CompanyID"=m.company_id WHERE c."IsActive" AND ($1=0 OR m.company_id=$1) AND ($2::text IS NULL OR m.collection=$2)`;
  const total = (
    await client.query(`SELECT count(*)::int count ${where}`, [id, collection])
  ).rows[0].count;
  const rows = await client.query(
    `SELECT m.company_id||':'||m.collection||':'||m.source_key id,c."CompanyName" company_name,m.* ${where} ORDER BY c."CompanyName",m.collection,m.name LIMIT $3 OFFSET $4`,
    [id, collection, size, offset],
  );
  return { items: rows.rows, total, page: current, pageSize: size };
}
async function details(query = {}, client) {
  const id = companyFilter(query.company),
    { size } = pageOf(query);
  const type = query.detailType || "posting";
  const sources = {
    ledger: `SELECT company_id,name record_key,-1 entry_index,-1 detail_index,name,closing_balance amount,NULL::date voucher_date,batch_id,ordinal,'LEDGER' collection,group_name context FROM finance_ledger_facts`,
    posting: `SELECT company_id,voucher_key record_key,entry_index,-1 detail_index,ledger_name name,amount,voucher_date,batch_id,ordinal,'VOUCHER' collection,voucher_type context FROM finance_postings`,
    allocation: `SELECT a.company_id,a.voucher_key record_key,a.entry_index,a.allocation_index detail_index,a.centre_name name,a.amount,p.voucher_date,a.batch_id,a.ordinal,'VOUCHER' collection,a.category_name context FROM finance_allocations a JOIN finance_postings p USING(company_id,voucher_key,entry_index)`,
    inventory: `SELECT company_id,voucher_key record_key,movement_index entry_index,-1 detail_index,stock_item name,amount,voucher_date,batch_id,ordinal,'VOUCHER' collection,quantity_text context FROM finance_inventory_movements`,
  };
  if (!Object.hasOwn(sources, type))
    throw Object.assign(new Error("Invalid detail type"), { status: 400 });
  const name = batchFilter(query.name),
    period = await periodOf(query, id, client);
  const published = (
    await client.query(
      `SELECT s.company_id,s.batch_id,s.model_version,s.applied_at FROM finance_snapshots s JOIN "Companies" c ON c."CompanyID"=s.company_id WHERE c."IsActive" AND ($1=0 OR s.company_id=$1) ORDER BY s.company_id`,
      [id],
    )
  ).rows;
  const scope = require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify([id, type, name, period, published]))
    .digest("hex");
  let after = null;
  if (query.cursor) {
    try {
      if (typeof query.cursor !== "string" || query.cursor.length > 8192)
        throw new Error();
      const token = JSON.parse(
        Buffer.from(query.cursor, "base64url").toString("utf8"),
      );
      if (token.scope !== scope)
        throw Object.assign(
          new Error(
            "Source data or filters changed. Return to the first page.",
          ),
          { status: 409 },
        );
      after = token.after;
      if (
        !Array.isArray(after) ||
        after.length !== 4 ||
        !Number.isSafeInteger(after[0]) ||
        typeof after[1] !== "string" ||
        !Number.isSafeInteger(after[2]) ||
        !Number.isSafeInteger(after[3])
      )
        throw new Error();
    } catch (error) {
      if (error.status) throw error;
      throw Object.assign(new Error("Invalid source cursor"), { status: 400 });
    }
  }
  const values = [id, name, period.fromMonth + "-01", period.toMonth + "-01"];
  let seek = "";
  if (after) {
    values.push(...after);
    seek =
      "AND (r.company_id,r.record_key,r.entry_index,r.detail_index) > ($5::integer,$6::text,$7::integer,$8::integer)";
  }
  values.push(size + 1);
  const result = await client.query(
    `SELECT r.*,c."CompanyName" company_name,s.currency,r.amount::text amount
    FROM (${sources[type]}) r JOIN "Companies" c ON c."CompanyID"=r.company_id JOIN finance_snapshots s ON s.company_id=r.company_id
    WHERE c."IsActive" AND ($1=0 OR r.company_id=$1) AND ($2::text IS NULL OR r.name=$2)
      AND (${type === "ledger" ? "true OR " : ""}(r.voucher_date >= $3::date AND r.voucher_date < $4::date + interval '1 month')) ${seek}
    ORDER BY r.company_id,r.record_key,r.entry_index,r.detail_index LIMIT $${values.length}`,
    values,
  );
  const hasMore = result.rows.length > size,
    rows = result.rows.slice(0, size),
    last = rows.at(-1);
  const identity = (r) => [
    r.company_id,
    r.record_key,
    r.entry_index,
    r.detail_index,
  ];
  return {
    items: rows.map((r) => ({ ...r, id: JSON.stringify(identity(r)) })),
    total: null,
    page: 1,
    pageSize: size,
    period,
    hasMore,
    nextCursor: hasMore
      ? Buffer.from(JSON.stringify({ scope, after: identity(last) })).toString(
          "base64url",
        )
      : null,
  };
}
module.exports = Object.fromEntries(
  Object.entries({
    overview,
    archives,
    issues,
    record,
    masterRows,
    details,
  }).map(([name, read]) => [
    name,
    (query) =>
      db.transaction(async (client) => {
        // All sections and counts in a response describe one committed source version.
        await client.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        return read(query, client);
      }),
  ]),
);
