const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { buildProjection, writeProjection } = require("../src/sourceModels");
const unpack = require("../src/sourceUnpack");
const { uniqueVoucherKey, ingestSnapshot } = require("../src/ingest");
const db = require("../src/db");
after(() => db.close());
const node = (tag, fields = {}, content = []) => ({
  tag,
  attributes: {},
  content: [
    ...Object.entries(fields).map(([tag, value]) => ({
      tag,
      attributes: {},
      content: value === null ? [] : [value],
    })),
    ...content,
  ],
});
const row = (collection, fields, content = [], ordinal = 0) => ({
  collection,
  ordinal,
  payload: node(collection, fields, content),
});
const adapters = { ...unpack, voucherKey: uniqueVoucherKey };
test('empty exported lists do not create inventory or hide populated alternative lists', () => {
  const rows = fixture();
  const voucher = rows.at(-1).payload;
  voucher.content.push(node('ALLINVENTORYENTRIES.LIST', {}, ['     ']));
  let result = buildProjection(rows, adapters);
  assert.equal(result.inventory.length, 0);
  assert.equal(result.issues.length, 0);
  rows.push(row('STOCKITEM', { NAME: 'Item' }));
  voucher.content.push(node('INVENTORYENTRIES.LIST', { STOCKITEMNAME: 'Item', AMOUNT: '25' }, [
    node('BATCHALLOCATIONS.LIST', {}, ['\n ']),
  ]));
  result = buildProjection(rows, adapters);
  assert.deepEqual(result.inventory.map(x => x.amount), ['25.00']);
  assert.equal(result.issues.length, 0);
});

test('populated malformed inventory remains an error', () => {
  for (const entry of [node('ALLINVENTORYENTRIES.LIST', { AMOUNT: '10' }),
    node('ALLINVENTORYENTRIES.LIST', { STOCKITEMNAME: 'Missing' }),
    { tag: 'ALLINVENTORYENTRIES.LIST', attributes: { STOCKITEMNAME: 'Missing' }, content: [] }]) {
    const rows = fixture();
    rows.at(-1).payload.content.push(entry);
    assert.ok(buildProjection(rows, adapters).issues.some(x => x.code === 'UNKNOWN_STOCK_ITEM'));
  }
});

test('XML list metadata does not turn an empty collection into a business entry', () => {
  const rows = fixture();
  rows.at(-1).payload.content.push({ tag: 'ALLINVENTORYENTRIES.LIST',
    attributes: { TYPE: 'Collection', ISLIST: 'Yes' }, content: ['\n '] });
  const result = buildProjection(rows, adapters);
  assert.equal(result.inventory.length, 0);
  assert.equal(result.issues.length, 0);
});

test('native self-parent voucher types resolve but custom self and multi-node cycles fail', () => {
  const rows = fixture();
  for (const name of ['Job Work In Order', 'Job Work Out Order', 'Material In', 'Material Out', 'Rejections In', 'Rejections Out']) {
    rows.push(row('VOUCHERTYPE', { NAME: name, PARENT: name }, [], rows.length));
  }
  const result = buildProjection(rows, adapters);
  assert.equal(result.issues.length, 0);
  for (const master of result.masters.filter(x => x.collection === 'VOUCHERTYPE')) {
    assert.ok(master.properties.resolvedRoot);
  }
  rows.push(row('VOUCHERTYPE', { NAME: 'Custom', PARENT: 'Custom' }, [], 100));
  rows.push(row('VOUCHERTYPE', { NAME: 'A', PARENT: 'B' }, [], 101));
  rows.push(row('VOUCHERTYPE', { NAME: 'B', PARENT: 'A' }, [], 102));
  assert.equal(buildProjection(rows, adapters).issues.filter(x => x.code === 'PARENT_CYCLE').length, 3);
});

test('empty accounting placeholders do not obscure populated alternative postings', () => {
  const rows = fixture();
  const voucher = rows.at(-1).payload;
  voucher.content = voucher.content.filter(x => x.tag !== 'AMOUNT').map(x =>
    x.tag === 'ALLLEDGERENTRIES.LIST' ? { ...x, tag: 'LEDGERENTRIES.LIST' } : x);
  voucher.content.push(node('ALLLEDGERENTRIES.LIST', {}, ['   ']));
  assert.equal(unpack.interpretVoucher(voucher).amount, '10.00');
  assert.equal(buildProjection(rows, adapters).issues.length, 0);
});
const fixture = () => [
  row("COMPANY", {
    NAME: "Example",
    GUID: "models",
    CURRENCYNAME: "INR",
    BOOKSFROM: "20260401",
  }),
  row("GROUP", { NAME: "Custom cash", PARENT: "Bank Accounts" }),
  row("GROUP", { NAME: "Custom expenses", PARENT: "Indirect Expenses" }, [], 1),
  row("VOUCHERTYPE", { NAME: "Supplier settlement", PARENT: "Payment" }),
  row("COSTCATEGORY", { NAME: "Sites" }),
  row("COSTCENTRE", { NAME: "Site A", CATEGORY: "Sites" }),
  row("LEDGER", {
    NAME: "Bank",
    PARENT: "Custom cash",
    CLOSINGBALANCE: "-90",
    OPENINGBALANCE: "-100",
  }),
  row(
    "LEDGER",
    { NAME: "Expense", PARENT: "Custom expenses", CLOSINGBALANCE: "10" },
    [],
    1,
  ),
  row(
    "VOUCHER",
    { DATE: "20260401", VOUCHERTYPENAME: "Supplier settlement", AMOUNT: "10" },
    [
      node("ALLLEDGERENTRIES.LIST", { LEDGERNAME: "Bank", AMOUNT: "10" }),
      node("ALLLEDGERENTRIES.LIST", { LEDGERNAME: "Expense", AMOUNT: "-10" }, [
        node("CATEGORYALLOCATIONS.LIST", { CATEGORY: "Sites" }, [
          node("COSTCENTREALLOCATIONS.LIST", { NAME: "Site A", AMOUNT: "-10" }),
        ]),
      ]),
    ],
  ),
];
test("masters classify custom groups and voucher types, preserving signed postings and split allocations", () => {
  const result = buildProjection(fixture(), adapters);
  assert.equal(result.issues.length, 0);
  assert.equal(result.ledgers[0].root_group, "Bank Accounts");
  assert.equal(result.ledgers[1].root_group, "Indirect Expenses");
  assert.equal(result.postings[0].base_type, "Payment");
  assert.equal(result.allocations[0].amount, "-10.00");
  assert.equal(result.coverage.postingsComplete, true);
  assert.equal(result.company.books_from, "2026-04-01");
});
test("missing detailed postings remain unavailable even with a usable voucher total", () => {
  const rows = fixture();
  rows[rows.length - 1] = row("VOUCHER", {
    DATE: "20260401",
    VOUCHERTYPENAME: "Payment",
    AMOUNT: "0",
  });
  const result = buildProjection(rows, adapters);
  assert.equal(result.coverage.postingsComplete, false);
  assert.ok(
    result.issues.some(
      (i) => i.code === "MISSING_POSTINGS" && i.severity === "warning",
    ),
  );
  assert.equal(result.postings.length, 0);
});

test("identical alternative posting lists are counted once and inventory batch values do not duplicate totals", () => {
  const rows = fixture(),
    v = rows.find((r) => r.collection === "VOUCHER").payload;
  v.content = v.content.filter((n) => n.tag !== "AMOUNT");
  v.content.push(
    ...v.content
      .filter((n) => n.tag === "ALLLEDGERENTRIES.LIST")
      .map((n) => ({ ...n, tag: "LEDGERENTRIES.LIST" })),
  );
  assert.equal(unpack.interpretVoucher(v).amount, "10.00");
  rows.push(
    row("STOCKITEM", { NAME: "Item" }),
    row("GODOWN", { NAME: "Store A" }),
  );
  v.content.push(
    node("ALLINVENTORYENTRIES.LIST", { STOCKITEMNAME: "Item", AMOUNT: "20" }, [
      node("BATCHALLOCATIONS.LIST", {
        GODOWNNAME: "Store A",
        AMOUNT: "8",
        ACTUALQTY: "1 Nos",
      }),
      node("BATCHALLOCATIONS.LIST", {
        GODOWNNAME: "Store A",
        AMOUNT: "12",
        ACTUALQTY: "2 Nos",
      }),
    ]),
  );
  const model = buildProjection(rows, adapters);
  assert.equal(model.postings.length, 2);
  assert.ok(!model.issues.some((i) => i.code === "AMBIGUOUS_ENTRIES"));
  assert.deepEqual(
    model.inventory.map((m) => m.amount),
    ["8.00", "12.00"],
  );
});
test("rejects unbalanced postings, duplicate representations and references to absent ledgers", () => {
  const rows = fixture(),
    v = rows.at(-1).payload;
  v.content.push(
    node("LEDGERENTRIES.LIST", { LEDGERNAME: "Missing", AMOUNT: "1" }),
  );
  v.content
    .find((x) => x.tag === "ALLLEDGERENTRIES.LIST")
    .content.find((x) => x.tag === "AMOUNT").content = ["5"];
  const result = buildProjection(rows, adapters);
  assert.ok(result.issues.some((i) => i.code === "AMBIGUOUS_ENTRIES"));
  assert.ok(result.issues.some((i) => i.code === "UNBALANCED_POSTINGS"));
  v.content
    .find((x) => x.tag === "ALLLEDGERENTRIES.LIST")
    .content.find((x) => x.tag === "LEDGERNAME").content = ["Missing"];
  assert.ok(
    buildProjection(rows, adapters).issues.some(
      (i) => i.code === "UNKNOWN_LEDGER",
    ),
  );
});
test("cycles and missing currencies cannot silently become reliable classifications or mixed totals", () => {
  const rows = fixture();
  rows.push(
    row("GROUP", { NAME: "A", PARENT: "B" }, [], 2),
    row("GROUP", { NAME: "B", PARENT: "A" }, [], 3),
  );
  rows[0] = row("COMPANY", { NAME: "Example" });
  const result = buildProjection(rows, adapters);
  assert.ok(result.issues.some((i) => i.code === "PARENT_CYCLE"));
  assert.equal(result.coverage.uniformCurrency, false);
  assert.ok(result.issues.some((i) => i.code === "MISSING_CURRENCY"));
});
test("remaining inventory and currency masters are projected; quantities retain units", () => {
  const rows = fixture();
  for (const collection of [
    "CURRENCY",
    "STOCKGROUP",
    "STOCKCATEGORY",
    "UNIT",
    "GODOWN",
  ])
    rows.push(
      row(collection, { NAME: collection === "UNIT" ? "Nos" : collection }),
    );
  rows.push(row("STOCKITEM", { NAME: "Item A", BASEUNITS: "Nos" }));
  rows
    .find((r) => r.collection === "VOUCHER")
    .payload.content.push(
      node("ALLINVENTORYENTRIES.LIST", {
        STOCKITEMNAME: "Item A",
        ACTUALQTY: "2 Nos",
        AMOUNT: "20",
      }),
    );
  const result = buildProjection(rows, adapters);
  assert.equal(result.inventory[0].quantity_text, "2 Nos");
  assert.equal(result.inventory[0].amount, "20.00");
  assert.equal(new Set(result.masters.map((m) => m.collection)).size, 10);
});
test("reporting extensions share the ingestion transaction and failures propagate for rollback", async () => {
  const original = db.transaction;
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("SELECT checksum")) return { rows: [] };
      if (sql.includes('INSERT INTO "Companies"'))
        return { rows: [{ CompanyID: 1 }] };
      return { rows: [] };
    },
  };
  let rolledBack = false;
  db.transaction = async (work) => {
    try {
      return await work(client);
    } catch (e) {
      rolledBack = true;
      throw e;
    }
  };
  try {
    await assert.rejects(
      ingestSnapshot(
        {
          batchId: "atomic",
          capturedAt: "2026-04-01T00:00:00Z",
          fullSnapshot: true,
          company: { externalId: "e", name: "Example" },
          ledgers: [],
          vouchers: [],
        },
        {
          afterWrite: async (received) => {
            assert.equal(received, client);
            throw new Error("extension failed");
          },
        },
      ),
      /extension failed/,
    );
    assert.equal(rolledBack, true);
  } finally {
    db.transaction = original;
  }
});
test("projection persistence uses bound data and the caller transaction, with provenance on every row", async () => {
  const calls = [];
  const client = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      return { rows: [] };
    },
  };
  await writeProjection(
    client,
    7,
    { batch_id: "batch", captured_at: "2026-04-01T00:00:00Z" },
    buildProjection(fixture(), adapters),
  );
  assert.ok(calls.some((c) => c.sql.includes("INSERT INTO finance_snapshots")));
  for (const c of calls.filter((c) => c.sql.includes("jsonb_to_recordset"))) {
    assert.equal(c.args[0], 7);
    assert.equal(c.args[1], "batch");
  }
});

test(
  "complete source models publish atomically and rejected follow-up data preserves every reporting table",
  { skip: process.env.DB_NAME !== "enterprise_dashboard_test" },
  async () => {
    const archive = require("../src/sourceArchive"),
      reports = require("../src/sourceReports");
    await db.migrate();
    await db.query(
      'TRUNCATE tally_source_uploads,tally_source_snapshots,tally_ingestions,"Vouchers","Projects","Ledgers","Companies","SyncLog" RESTART IDENTITY CASCADE',
    );
    async function capture(batchId, rows, capturedAt) {
      const ordinals = new Map();
      const records = rows.map((r) => {
        const ordinal = ordinals.get(r.collection) || 0;
        ordinals.set(r.collection, ordinal + 1);
        return { ...r, ordinal, sourceId: null };
      });
      const collections = archive.COLLECTIONS.map((name) => ({
        name,
        status: "success",
        count: ordinals.get(name) || 0,
      }));
      await archive.begin({
        batchId,
        capturedAt,
        company: { externalId: "models", name: "Example" },
        schemaVersion: 1,
        profile: "company-business-v1",
        recordCount: records.length,
        chunkCount: 1,
        consistency: "stable",
        collections,
      });
      await archive.chunk({ batchId, index: 0, records });
      await archive.complete({ batchId });
    }
    const rows = fixture();
    await capture("model-valid", rows, "2026-04-01T00:00:00Z");
    const first = await unpack.unpackBatch("model-valid");
    assert.equal(first.duplicate, false);
    const result = await reports.overview(String(first.companyId));
    assert.equal(result.companies[0].currency, "INR");
    assert.equal(
      result.groups.find((g) => g.name === "Bank Accounts").amount,
      "-90.00",
    );
    assert.equal(result.allocations[0].amount, "-10.00");
    assert.equal(result.postings[0].amount, "10.00");
    // Exercise the real authenticated HTTP/SQL contract used by the UI.
    const { app } = require("../src/server");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const cookie =
        "helior_session=" +
        require("../src/auth").sign(require("../src/config").dashboardUser);
      const paths = [
        "/api/companies",
        `/api/reports/source?company=${first.companyId}&fromMonth=2026-04&toMonth=2026-04`,
        `/api/reports/source/masters?company=${first.companyId}`,
        `/api/reports/source/details?company=${first.companyId}`,
        "/api/tally/archives",
        "/api/tally/issues?batch=model-valid",
        "/api/tally/source-record?batch=model-valid&collection=LEDGER&ordinal=0",
      ];
      for (const path of paths) {
        assert.equal((await fetch(base + path)).status, 401);
        const response = await fetch(base + path, { headers: { cookie } });
        assert.equal(response.status, 200, path);
        const body = await response.json();
        if (path.startsWith("/api/reports/source?"))
          assert.equal(body.postings[0].amount, "10.00");
        if (path.includes("source-record"))
          assert.equal(body.payload.tag, "LEDGER");
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    assert.equal(
      (
        await db.query(
          "SELECT relkind FROM pg_class WHERE oid='finance_masters'::regclass",
        )
      ).rows[0].relkind,
      "v",
    );
    assert.equal(
      (await db.query("SELECT category_source_key FROM cost_centres")).rows[0]
        .category_source_key,
      "sites",
    );
    assert.equal(
      (await db.query("SELECT resolved_root FROM voucher_types")).rows[0]
        .resolved_root,
      "Payment",
    );
    await assert.rejects(
      db.transaction(async (client) => {
        await client.query(
          "UPDATE cost_centres SET category_source_key='missing'",
        );
      }),
      (error) => error.code === "23503",
    );
    const april = await reports.overview({
      company: String(first.companyId),
      fromMonth: "2026-04",
      toMonth: "2026-04",
    });
    assert.equal(april.postings[0].amount, "10.00");
    const may = await reports.overview({
      company: String(first.companyId),
      fromMonth: "2026-05",
      toMonth: "2026-05",
    });
    assert.equal(may.postings.length, 0);
    assert.equal(
      may.groups.find((g) => g.name === "Bank Accounts").amount,
      "-90.00",
    );
    await assert.rejects(
      reports.overview({ fromMonth: "2026-13", toMonth: "2026-14" }),
      (error) => error.status === 400,
    );
    await assert.rejects(
      reports.overview({ fromMonth: "2026-05", toMonth: "2026-04" }),
      (error) => error.status === 400,
    );
    const page1 = await reports.details({
      company: String(first.companyId),
      pageSize: 1,
    });
    assert.equal(page1.hasMore, true);
    const page2 = await reports.details({
      company: String(first.companyId),
      pageSize: 1,
      cursor: page1.nextCursor,
    });
    assert.equal(page2.hasMore, false);
    await unpack.unpackBatch("model-valid", { force: true });
    await assert.rejects(
      reports.details({
        company: String(first.companyId),
        pageSize: 1,
        cursor: page1.nextCursor,
      }),
      (error) => error.status === 409,
    );

    assert.notEqual(page1.items[0].id, page2.items[0].id);
    assert.equal(
      (
        await reports.details({
          company: String(first.companyId),
          fromMonth: "2026-05",
          toMonth: "2026-05",
        })
      ).items.length,
      0,
    );
    await assert.rejects(
      reports.details({ company: String(first.companyId), cursor: "invalid" }),
      (error) => error.status === 400,
    );

    assert.equal(
      (await reports.masterRows({ company: String(first.companyId) })).total,
      5,
    );
    for (const detailType of ["ledger", "posting", "allocation", "inventory"])
      await reports.details({ company: String(first.companyId), detailType });
    assert.equal((await reports.archives({})).total, 1);
    assert.equal(
      (
        await reports.record({
          batch: "model-valid",
          collection: "LEDGER",
          ordinal: "0",
        })
      ).payload.tag,
      "LEDGER",
    );
    await require("../src/dashboardService").getDashboard(
      String(first.companyId),
    );
    await require("../src/reports").expenseReport({
      company: String(first.companyId),
    });
    await require("../src/reports").projectReport({
      company: String(first.companyId),
    });
    const invalid = fixture();
    invalid.find((r) => r.collection === "LEDGER").payload.content = invalid
      .find((r) => r.collection === "LEDGER")
      .payload.content.filter((n) => n.tag !== "CLOSINGBALANCE");
    await capture("model-invalid", invalid, "2026-04-02T00:00:00Z");
    await assert.rejects(
      unpack.unpackBatch("model-invalid"),
      /Financial validation failed/,
    );
    assert.ok((await reports.issues({ batch: "model-invalid" })).total > 0);
    assert.equal(
      (await reports.overview(String(first.companyId))).companies[0].batch_id,
      "model-valid",
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM finance_postings")).rows[0]
        .n,
      2,
    );
    // A failure after base books and projects have been written must roll all of them back.
    const originalTransaction = db.transaction;
    db.transaction = (work) =>
      originalTransaction((client) =>
        work({
          query: (sql, args) =>
            sql.startsWith("INSERT INTO finance_snapshots")
              ? Promise.reject(new Error("simulated publication failure"))
              : client.query(sql, args),
        }),
      );
    const updated = fixture();
    updated
      .find((r) => r.collection === "LEDGER")
      .payload.content.find((n) => n.tag === "CLOSINGBALANCE").content = [
      "-999",
    ];
    await capture("model-write-failure", updated, "2026-04-03T00:00:00Z");
    try {
      await assert.rejects(
        unpack.unpackBatch("model-write-failure"),
        /simulated publication failure/,
      );
    } finally {
      db.transaction = originalTransaction;
    }
    assert.equal(
      (
        await db.query(
          'SELECT "CurrentBalance" FROM "Ledgers" WHERE "LedgerName"=$1',
          ["Bank"],
        )
      ).rows[0].CurrentBalance,
      "-90.00",
    );
    assert.equal(
      (await db.query("SELECT batch_id FROM finance_snapshots")).rows[0]
        .batch_id,
      "model-valid",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM tally_ingestions WHERE batch_id=$1",
          ["model-write-failure"],
        )
      ).rows[0].n,
      0,
    );
    const before = (
      await db.query(
        "SELECT xmin::text version,batch_id FROM finance_postings ORDER BY entry_index",
      )
    ).rows;
    await capture("model-unchanged", fixture(), "2026-04-04T00:00:00Z");
    await unpack.unpackBatch("model-unchanged");
    const after = (
      await db.query(
        "SELECT xmin::text version,batch_id FROM finance_postings ORDER BY entry_index",
      )
    ).rows;
    assert.deepEqual(
      after,
      before,
      "unchanged detail rows must not be rewritten",
    );
    assert.equal(
      (await db.query("SELECT batch_id FROM finance_monthly_summaries LIMIT 1"))
        .rows[0].batch_id,
      "model-unchanged",
    );
    await assert.rejects(
      reports.details({
        company: String(first.companyId),
        pageSize: 1,
        cursor: page1.nextCursor,
      }),
      (error) => error.status === 409,
    );
    const removed = fixture().filter(
      (r) => r.collection !== "VOUCHER" && r.collection !== "COSTCENTRE",
    );
    await capture("model-removed", removed, "2026-04-05T00:00:00Z");
    await unpack.unpackBatch("model-removed");
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM finance_postings")).rows[0]
        .n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM finance_allocations"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM finance_monthly_summaries"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM cost_centres")).rows[0].n,
      0,
    );
    await db.query(
      'TRUNCATE tally_source_uploads,tally_source_snapshots,tally_ingestions,"Vouchers","Projects","Ledgers","Companies","SyncLog" RESTART IDENTITY CASCADE',
    );
  },
);
