const { entities } = require("./reportingEntities");
const { isEmptyList } = require('./sourceTree');
const MASTER_TYPES = new Set([
  "GROUP",
  "VOUCHERTYPE",
  "CURRENCY",
  "COSTCATEGORY",
  "COSTCENTRE",
  "STOCKGROUP",
  "STOCKCATEGORY",
  "STOCKITEM",
  "UNIT",
  "GODOWN",
]);
const ROOT_GROUPS = new Set([
  "primary",
  "capital account",
  "loans (liability)",
  "current liabilities",
  "fixed assets",
  "investments",
  "current assets",
  "branch / divisions",
  "misc. expenses (asset)",
  "suspense a/c",
  "sales accounts",
  "purchase accounts",
  "direct incomes",
  "direct income",
  "indirect incomes",
  "indirect income",
  "direct expenses",
  "indirect expenses",
  "duties & taxes",
  "provisions",
  "reserves & surplus",
  "secured loans",
  "unsecured loans",
  "bank od a/c",
  "bank occ a/c",
  "bank accounts",
  "cash-in-hand",
  "sundry debtors",
  "sundry creditors",
  "stock-in-hand",
  "deposits (asset)",
  "loans & advances (asset)",
]);
const BASE_TYPES = new Set([
  "payment",
  "receipt",
  "contra",
  "journal",
  "sales",
  "purchase",
  "debit note",
  "credit note",
  "stock journal",
  "physical stock",
  "delivery note",
  "receipt note",
  "sales order",
  "purchase order",
  "memorandum",
  "reversing journal",
  "payroll",
  "attendance",
  "job work in order",
  "job work out order",
  "material in",
  "material out",
  "rejections in",
  "rejections out",
]);
const key = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const children = (node, tag) =>
  (node?.content || []).filter(
    (x) => x && typeof x === "object" && key(x.tag) === key(tag) && !isEmptyList(x),
  );

function buildProjection(
  rows,
  { field, amount, date, interpretVoucher, voucherKey },
) {
  const model = {
    masters: [],
    ledgers: [],
    postings: [],
    allocations: [],
    inventory: [],
    issues: [],
    company: {},
    coverage: {},
  };
  const issue = (row, fieldName, code, message, severity = "error") =>
    model.issues.push({
      collection: row.collection,
      ordinal: row.ordinal,
      field: fieldName,
      code,
      message,
      severity,
    });
  const text = (node, name) => {
    const value = field(node, name);
    return typeof value === "string" && value.trim()
      ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() ||
          null
      : null;
  };
  const money = (row, node, name, required = false) => {
    const value = field(node, name);
    if (value === null) {
      if (required)
        issue(
          row,
          name,
          "MISSING_AMOUNT",
          "Required accounting amount was not exported",
        );
      return null;
    }
    if (!String(value).trim()) return "0.00"; // Tally explicitly exported an empty amount.
    try {
      return amount(value);
    } catch {
      issue(
        row,
        name,
        "INVALID_AMOUNT",
        "Amount format is not supported; inspect source record",
      );
      return null;
    }
  };
  for (const row of rows) {
    model.coverage[row.collection] = (model.coverage[row.collection] || 0) + 1;
    const p = row.payload;
    if (row.collection === "COMPANY") {
      // BaseCurrencyName describes the company's accounting currency. Keep
      // CurrencyName as an exposed native alternative, never infer INR.
      const baseCurrency=text(p, "BASECURRENCYNAME"),currency=text(p, "CURRENCYNAME");
      model.company.currency = baseCurrency || currency;
      if(baseCurrency&&currency&&key(baseCurrency)!==key(currency))
        issue(row,"BASECURRENCYNAME","CURRENCY_LABEL_DIFFERENCE","Company currency labels differ; base currency is used. Inspect the archived company record.","warning");
      for (const [target, source] of [
        ["books_from", "BOOKSFROM"],
        ["starting_from", "STARTINGFROM"],
      ]) {
        const value = text(p, source);
        try {
          model.company[target] = value ? date(value) : null;
        } catch {
          issue(
            row,
            source,
            "INVALID_PERIOD",
            "Company accounting date could not be read",
            "warning",
          );
        }
      }
    }
    if (!MASTER_TYPES.has(row.collection)) continue;
    const name =
      text(p, "NAME") || (row.collection === "UNIT" ? text(p, "SYMBOL") : null);
    if (!name) {
      issue(row, "NAME", "MISSING_NAME", "Master name is required");
      continue;
    }
    if (name.length > (row.collection === "VOUCHERTYPE" ? 80 : 200))
      issue(
        row,
        "NAME",
        "NAME_TOO_LONG",
        "Master name exceeds supported reporting length; source remains intact",
      );
    const properties = {};
    for (const name of [
      "ISREVENUE",
      "ISDEEMEDPOSITIVE",
      "ISADDABLE",
      "ISBILLWISEON",
      "ORIGINALNAME",
      "FORMALNAME",
      "DECIMALPLACES",
      "ISSIMPLEUNIT",
      "ADDITIONALUNITS",
      "CONVERSION",
      "GSTAPPLICABLE",
      "BASECURRENCYNAME",
    ])
      properties[name] = text(p, name);
    model.masters.push({
      collection: row.collection,
      source_key: text(p, "GUID") || text(p, "MASTERID") || key(name),
      name,
      parent_name: text(p, "PARENT"),
      category_name: text(p, "CATEGORY"),
      base_units: text(p, "BASEUNITS"),
      properties,
      ordinal: row.ordinal,
    });
  }
  const index = new Map();
  const sourceKeys = new Set();
  for (const m of model.masters) {
    const id = `${m.collection}:${key(m.name)}`;
    if (index.has(id))
      issue(m, "NAME", "DUPLICATE_MASTER", "Duplicate master name");
    const sourceId = `${m.collection}:${m.source_key}`;
    if (sourceKeys.has(sourceId))
      issue(
        m,
        "GUID",
        "DUPLICATE_SOURCE_ID",
        "Duplicate master source identity",
      );
    sourceKeys.add(sourceId);
    index.set(id, m);
  }
  function root(collection, name, row) {
    const visited = new Set();
    let current = name;
    const recognized =
      collection === "GROUP"
        ? ROOT_GROUPS
        : collection === "VOUCHERTYPE"
          ? BASE_TYPES
          : new Set(["primary"]);
    while (current) {
      const id = key(current);
      if (visited.has(id)) {
        issue(
          row,
          "PARENT",
          "PARENT_CYCLE",
          "Master hierarchy contains a cycle",
        );
        return null;
      }
      visited.add(id);
      if (recognized.has(id) && id !== "primary") return current;
      const master = index.get(`${collection}:${id}`);
      if (!master) {
        if (id !== "primary")
          issue(
            row,
            "PARENT",
            "UNRESOLVED_PARENT",
            "No matching parent definition; classification unavailable",
            "warning",
          );
        return id === "primary" ? current : null;
      }
      if (!master.parent_name || key(master.parent_name) === "primary")
        return master.name;
      current = master.parent_name;
    }
    return null;
  }
  for (const m of model.masters) {
    if (["GROUP", "VOUCHERTYPE"].includes(m.collection))
      m.properties.resolvedRoot = root(m.collection, m.name, m);
    if (
      ["COSTCENTRE", "STOCKGROUP", "STOCKCATEGORY", "GODOWN"].includes(
        m.collection,
      )
    )
      root(m.collection, m.name, m);
    if (
      m.collection === "COSTCENTRE" &&
      m.category_name &&
      !index.has(`COSTCATEGORY:${key(m.category_name)}`)
    )
      issue(
        m,
        "CATEGORY",
        "UNRESOLVED_CATEGORY",
        "Cost category definition is missing",
        "warning",
      );
    if (
      m.collection === "STOCKITEM" &&
      m.base_units &&
      !index.has(`UNIT:${key(m.base_units)}`)
    )
      issue(
        m,
        "BASEUNITS",
        "UNRESOLVED_UNIT",
        "Stock item unit definition is missing",
        "warning",
      );
  }
  const ledgerNames = new Set(
    rows
      .filter((r) => r.collection === "LEDGER")
      .map((r) => key(text(r.payload, "NAME"))),
  );
  for (const row of rows.filter((r) => r.collection === "LEDGER")) {
    const p = row.payload,
      name = text(p, "NAME"),
      group = text(p, "PARENT");
    if (!name || name.length > 200)
      issue(
        row,
        "NAME",
        "INVALID_LEDGER_NAME",
        "Ledger name exceeds supported reporting length or is missing",
      );
    model.ledgers.push({
      name,
      group_name: group,
      root_group: root("GROUP", group, row),
      opening_balance: money(row, p, "OPENINGBALANCE"),
      closing_balance: money(row, p, "CLOSINGBALANCE", true),
      currency: text(p, "CURRENCYNAME"),
      ordinal: row.ordinal,
    });
  }
  let voucherCount = 0,
    postedCount = 0;
  const used = new Map();
  const voucherIdentities = new Set();
  for (const row of rows.filter((r) => r.collection === "VOUCHER")) {
    let voucher;
    try {
      voucher = interpretVoucher(row.payload);
    } catch {
      continue;
    } // Core projection records the precise failure.
    if (!voucher) continue;
    voucherCount++;
    const month = voucher.date.slice(0, 7);
    if (
      !model.coverage.latestVoucherMonth ||
      month > model.coverage.latestVoucherMonth
    )
      model.coverage.latestVoucherMonth = month;
    const p = row.payload;
    const guid = text(p, "GUID"),
      masterId = text(p, "MASTERID");
    const voucher_key = guid
      ? `guid:${guid}`
      : masterId
        ? `master:${masterId}`
        : voucherKey(voucher, used);
    if (voucherIdentities.has(voucher_key))
      issue(
        row,
        "GUID",
        "DUPLICATE_VOUCHER_ID",
        "Duplicate voucher source identity",
      );
    voucherIdentities.add(voucher_key);
    const all = children(p, "ALLLEDGERENTRIES.LIST"),
      legacy = children(p, "LEDGERENTRIES.LIST");
    // These are alternative representations, never sum both.
    if (all.length && legacy.length) {
      const signature = (list) =>
        JSON.stringify(
          list
            .map((n) => [key(text(n, "LEDGERNAME")), field(n, "AMOUNT")])
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        );
      if (signature(all) !== signature(legacy))
        issue(
          row,
          "LEDGERENTRIES.LIST",
          "AMBIGUOUS_ENTRIES",
          "Accounting-entry representations differ; resolve before publishing",
        );
    }
    const entries = all.length ? all : legacy;
    if (!entries.length)
      issue(
        row,
        "ALLLEDGERENTRIES.LIST",
        "MISSING_POSTINGS",
        "Voucher total is available but detailed accounting postings are unavailable",
        "warning",
      );
    else postedCount++;
    let sum = 0n;
    entries.forEach((entry, entry_index) => {
      const ledger_name = text(entry, "LEDGERNAME"),
        value = money(row, entry, "AMOUNT", true);
      if (!ledger_name || !ledgerNames.has(key(ledger_name)))
        issue(
          row,
          "LEDGERNAME",
          "UNKNOWN_LEDGER",
          "Accounting entry references a missing ledger",
        );
      if (value !== null) sum += BigInt(value.replace(".", ""));
      model.postings.push({
        voucher_key,
        entry_index,
        ledger_name,
        amount: value,
        voucher_date: voucher.date,
        voucher_type: voucher.type,
        base_type: root("VOUCHERTYPE", voucher.type, row),
        ordinal: row.ordinal,
      });
      const categories = children(entry, "CATEGORYALLOCATIONS.LIST");
      const allocations = categories.flatMap((c) =>
        children(c, "COSTCENTREALLOCATIONS.LIST").map((n) => ({
          node: n,
          category: text(c, "CATEGORY"),
        })),
      );
      allocations.push(
        ...children(entry, "COSTCENTREALLOCATIONS.LIST").map((node) => ({
          node,
          category: null,
        })),
      );
      allocations.forEach(({ node, category }, allocation_index) => {
        const centre_name = text(node, "NAME") || text(node, "COSTCENTRENAME");
        if (!centre_name || !index.has(`COSTCENTRE:${key(centre_name)}`))
          issue(
            row,
            "COSTCENTRENAME",
            "UNKNOWN_CENTRE",
            "Allocation references a missing cost centre",
          );
        const allocationAmount = money(row, node, "AMOUNT");
        if (allocationAmount === null)
          issue(
            row,
            "AMOUNT",
            "MISSING_ALLOCATION_AMOUNT",
            "Allocation amount is unavailable",
            "warning",
          );
        if (category && !index.has(`COSTCATEGORY:${key(category)}`))
          issue(
            row,
            "CATEGORY",
            "UNKNOWN_CATEGORY",
            "Allocation references a missing cost category",
          );
        model.allocations.push({
          voucher_key,
          entry_index,
          allocation_index,
          category_name: category,
          centre_name,
          amount: allocationAmount,
          ordinal: row.ordinal,
        });
      });
    });
    if (entries.length && sum !== 0n)
      issue(
        row,
        "AMOUNT",
        "UNBALANCED_POSTINGS",
        "Signed accounting postings do not balance",
      );
    const allInventory = children(p, "ALLINVENTORYENTRIES.LIST"),
      inventory = allInventory.length
        ? allInventory
        : children(p, "INVENTORYENTRIES.LIST");
    let movement_index = 0;
    inventory.forEach((entry) => {
      const stock_item = text(entry, "STOCKITEMNAME");
      if (!stock_item || !index.has(`STOCKITEM:${key(stock_item)}`))
        issue(
          row,
          "STOCKITEMNAME",
          "UNKNOWN_STOCK_ITEM",
          "Inventory movement references a missing stock item",
        );
      const batches = children(entry, "BATCHALLOCATIONS.LIST");
      // Batch values replace their parent total so warehouse splits are never double counted.
      for (const movement of batches.length ? batches : [entry]) {
        const inventoryAmount = money(row, movement, "AMOUNT"),
          godown_name = text(movement, "GODOWNNAME");
        if (inventoryAmount === null)
          issue(
            row,
            "AMOUNT",
            "MISSING_INVENTORY_AMOUNT",
            "Inventory movement value is unavailable",
            "warning",
          );
        if (godown_name && !index.has(`GODOWN:${key(godown_name)}`))
          issue(
            row,
            "GODOWNNAME",
            "UNKNOWN_GODOWN",
            "Warehouse definition is unavailable",
            "warning",
          );
        model.inventory.push({
          voucher_key,
          movement_index: movement_index++,
          stock_item,
          godown_name,
          quantity_text: text(movement, "ACTUALQTY"),
          amount: inventoryAmount,
          voucher_date: voucher.date,
          ordinal: row.ordinal,
        });
      }
    });
  }
  model.coverage.uniformCurrency =
    Boolean(model.company.currency) &&
    model.ledgers.every(
      (l) => !l.currency || key(l.currency) === key(model.company.currency),
    );
  if (!model.coverage.uniformCurrency && model.company.currency)
    model.issues.push({
      collection: "LEDGER",
      ordinal: null,
      field: "CURRENCYNAME",
      severity: "warning",
      code: "MIXED_CURRENCY",
      message:
        "Ledger currencies differ; consolidated monetary charts require a confirmed conversion basis",
    });
  model.coverage.vouchers = voucherCount;
  model.coverage.vouchersWithPostings = postedCount;
  model.coverage.postingsComplete =
    voucherCount > 0 && voucherCount === postedCount;
  if (!model.company.currency)
    model.issues.push({
      collection: "COMPANY",
      ordinal: 0,
      field: "CURRENCYNAME",
      severity: "warning",
      code: "MISSING_CURRENCY",
      message:
        "Company reporting currency is unavailable; cross-company money totals are disabled",
    });
  return model;
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
module.exports = { buildProjection, writeProjection };
