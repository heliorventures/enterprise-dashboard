// Destructive fixtures are only permitted in an explicitly named EMPTY local test database.
if (
  process.env.DB_NAME !== "enterprise_dashboard_test" ||
  !["127.0.0.1", "localhost"].includes(process.env.DB_HOST) ||
  !process.argv.includes("--synthetic")
) {
  console.error(
    "Requires --synthetic and explicit local DB_HOST plus DB_NAME=enterprise_dashboard_test.",
  );
  process.exit(1);
}
const db = require("../src/db"),
  archive = require("../src/sourceArchive"),
  unpack = require("../src/sourceUnpack"),
  reports = require("../src/sourceReports");
const { performance } = require("node:perf_hooks");
const transaction = db.transaction;
db.transaction = (work) =>
  transaction((client) =>
    work({
      query: async (sql, args) => {
        const start = performance.now();
        try {
          return await client.query(sql, args);
        } catch (error) {
          console.error("Failed benchmark SQL:", sql.slice(0, 180));
          throw error;
        } finally {
          if (performance.now() - start > 5000)
            console.error(
              "Slow benchmark SQL:",
              Math.round(performance.now() - start) + "ms",
              sql.slice(0, 120),
            );
        }
      },
    }),
  );
const count = Number(process.env.BENCHMARK_VOUCHERS || 10000);
if (!Number.isSafeInteger(count) || count < 100 || count > 100000)
  throw new Error("BENCHMARK_VOUCHERS must be 100..100000 per company");
const node = (tag, fields = {}, nested = []) => ({
  tag,
  attributes: {},
  content: [
    ...Object.entries(fields).map(([tag, value]) => ({
      tag,
      attributes: {},
      content: [String(value)],
    })),
    ...nested,
  ],
});
function recordsFor(company) {
  const rows = [],
    ordinals = new Map();
  const add = (collection, fields, nested = []) => {
    const ordinal = ordinals.get(collection) || 0;
    ordinals.set(collection, ordinal + 1);
    rows.push({
      collection,
      ordinal,
      sourceId: null,
      payload: node(collection, fields, nested),
    });
  };
  add("COMPANY", {
    NAME: company,
    GUID: company,
    CURRENCYNAME: "INR",
    BOOKSFROM: "20240401",
  });
  add("GROUP", { NAME: "Custom bank", PARENT: "Bank Accounts" });
  add("GROUP", { NAME: "Custom cost", PARENT: "Indirect Expenses" });
  add("VOUCHERTYPE", { NAME: "Site payment", PARENT: "Payment" });
  add("CURRENCY", { NAME: "INR", DECIMALPLACES: "2" });
  add("COSTCATEGORY", { NAME: "Sites" });
  for (let n = 0; n < 10; n++)
    add("COSTCENTRE", { NAME: `Site ${n}`, CATEGORY: "Sites" });
  add("STOCKGROUP", { NAME: "Materials" });
  add("STOCKCATEGORY", { NAME: "General" });
  add("UNIT", { NAME: "Nos", DECIMALPLACES: "0" });
  add("GODOWN", { NAME: "Main" });
  for (let n = 0; n < 100; n++)
    add("STOCKITEM", {
      NAME: `Item ${n}`,
      PARENT: "Materials",
      CATEGORY: "General",
      BASEUNITS: "Nos",
    });
  add("LEDGER", {
    NAME: "Bank",
    PARENT: "Custom bank",
    OPENINGBALANCE: "0",
    CLOSINGBALANCE: "100",
  });
  add("LEDGER", {
    NAME: "Expense",
    PARENT: "Custom cost",
    OPENINGBALANCE: "0",
    CLOSINGBALANCE: "-100",
  });
  for (let n = 0; n < count; n++) {
    const month = n % 24,
      date = `${2024 + Math.floor(month / 12)}${String((month % 12) + 1).padStart(2, "0")}15`;
    add(
      "VOUCHER",
      {
        GUID: `voucher-${n}`,
        DATE: date,
        VOUCHERTYPENAME: "Site payment",
        AMOUNT: "100",
      },
      [
        node("ALLLEDGERENTRIES.LIST", { LEDGERNAME: "Bank", AMOUNT: "100" }),
        node(
          "ALLLEDGERENTRIES.LIST",
          { LEDGERNAME: "Expense", AMOUNT: "-100" },
          [
            node("CATEGORYALLOCATIONS.LIST", { CATEGORY: "Sites" }, [
              node("COSTCENTREALLOCATIONS.LIST", {
                NAME: `Site ${n % 10}`,
                AMOUNT: "-100",
              }),
            ]),
          ],
        ),
        node("ALLINVENTORYENTRIES.LIST", {
          STOCKITEMNAME: `Item ${n % 100}`,
          GODOWNNAME: "Main",
          ACTUALQTY: "1 Nos",
          AMOUNT: "100",
        }),
      ],
    );
  }
  return {
    rows,
    collections: archive.COLLECTIONS.map((name) => ({
      name,
      status: "success",
      count: ordinals.get(name) || 0,
    })),
  };
}
async function capture(company, batchId, capturedAt, fixture) {
  const chunks = Math.ceil(fixture.rows.length / 500);
  await archive.begin({
    batchId,
    capturedAt,
    company: { externalId: company, name: company },
    schemaVersion: 1,
    profile: "company-business-v1",
    recordCount: fixture.rows.length,
    chunkCount: chunks,
    consistency: "stable",
    collections: fixture.collections,
  });
  for (let index = 0; index < chunks; index++)
    await archive.chunk({
      batchId,
      index,
      records: fixture.rows.slice(index * 500, (index + 1) * 500),
    });
  await archive.complete({ batchId });
}
async function measure(work, n = 15) {
  const values = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await work();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return {
    samples: n,
    medianMs: +values[Math.floor(n / 2)].toFixed(2),
    p95Ms: +values[Math.min(n - 1, Math.ceil(n * 0.95) - 1)].toFixed(2),
  };
}
(async () => {
  await db.migrate();
  if ((await db.query('SELECT count(*)::int n FROM "Companies"')).rows[0].n)
    throw new Error(
      "Benchmark requires an empty test database; it never deletes existing data",
    );
  const sync = [],
    ids = [],
    runId = Date.now();
  for (let n = 1; n <= 5; n++) {
    const company = `Synthetic ${n}`,
      fixture = recordsFor(company);
    await capture(
      company,
      `bench-${runId}-${n}-first`,
      "2026-01-01T00:00:00Z",
      fixture,
    );
    let start = performance.now();
    const result = await unpack.unpackBatch(`bench-${runId}-${n}-first`);
    const initialMs = performance.now() - start;
    ids.push(result.companyId);
    await capture(
      company,
      `bench-${runId}-${n}-repeat`,
      "2026-01-02T00:00:00Z",
      fixture,
    );
    start = performance.now();
    await unpack.unpackBatch(`bench-${runId}-${n}-repeat`);
    sync.push({
      company,
      initialMs: +initialMs.toFixed(2),
      unchangedSyncMs: +(performance.now() - start).toFixed(2),
    });
    console.error(JSON.stringify(sync.at(-1)));
  }
  await db.query("ANALYZE");
  const query = {
    company: String(ids[0]),
    fromMonth: "2025-01",
    toMonth: "2025-12",
  };
  const overview = await measure(() => reports.overview(query));
  const concurrent = await measure(
    () =>
      Promise.all(
        ids.map((id) => reports.overview({ ...query, company: String(id) })),
      ),
    5,
  );
  const firstPage = await reports.details({ ...query, pageSize: 25 });
  const drilldown = await measure(() =>
    reports.details({ ...query, pageSize: 25, cursor: firstPage.nextCursor }),
  );
  const summary = await measure(() =>
    db.query(
      "SELECT month,sum(amount) FROM finance_monthly_summaries WHERE company_id=$1 AND kind='posting' AND month >= '2025-01-01' AND month <= '2025-12-01' GROUP BY month",
      [ids[0]],
    ),
  );
  const detailAggregation = await measure(() =>
    db.query(
      "SELECT date_trunc('month',voucher_date),sum(amount) FROM finance_postings WHERE company_id=$1 AND ledger_name='Bank' AND voucher_date >= '2025-01-01' AND voucher_date < '2026-01-01' GROUP BY date_trunc('month',voucher_date)",
      [ids[0]],
    ),
  );
  const storage = (
    await db.query(
      "SELECT relname,pg_total_relation_size(relid)::text bytes,n_live_tup estimated_rows FROM pg_stat_user_tables WHERE relname LIKE 'finance_%' ORDER BY relname",
    )
  ).rows;
  const evidence = (
    await db.query(
      "SELECT count(*)::int unchanged_postings FROM finance_postings WHERE batch_id LIKE '%-first'",
    )
  ).rows[0];
  const output =
    JSON.stringify(
      {
        synthetic: true,
        companies: 5,
        vouchersPerCompany: count,
        sync,
        overview,
        concurrentFiveCompanies: concurrent,
        drilldown,
        summary,
        detailAggregation,
        evidence,
        storage,
      },
      null,
      2,
    ) + "\n";
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0)
    require("node:fs").writeFileSync(
      process.argv[outputIndex + 1],
      output,
      "utf8",
    );
  process.stdout.write(output);
})()
  .catch((error) => {
    console.error("Benchmark failed:", error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
