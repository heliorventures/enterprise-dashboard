const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  db = require("../src/db");
after(() => db.close());
test(
  "migration preserves existing master evidence, resolves relationships and backfills summaries",
  { skip: process.env.DB_NAME !== "enterprise_dashboard_test" },
  async () => {
    // The throw rolls this schema and all fixtures back after assertions.
    const rollback = new Error("rollback migration fixture");
    await assert.rejects(
      db.transaction(async (client) => {
        await client.query("CREATE SCHEMA reporting_migration_fixture");
        await client.query(
          "SET LOCAL search_path TO reporting_migration_fixture",
        );
        const folder = path.join(__dirname, "..", "migrations");
        const files = (await fs.readdir(folder))
          .filter((n) => /^\d+.*\.sql$/.test(n))
          .sort();
        for (const file of files.filter((n) => n < "012"))
          await client.query(
            await fs.readFile(path.join(folder, file), "utf8"),
          );
        await client.query(`INSERT INTO "Companies"("CompanyName") VALUES('Migration fixture');
      INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest) VALUES('migration','migration','Migration fixture','2026-04-01',1,'complete','{}');
      INSERT INTO finance_snapshots(company_id,batch_id,captured_at) VALUES(1,'migration','2026-04-01');
      INSERT INTO finance_masters(company_id,collection,source_key,name,batch_id,ordinal) VALUES(1,'UNIT','unit','Nos','migration',0),(1,'STOCKGROUP','group','Materials','migration',0);
      INSERT INTO finance_masters(company_id,collection,source_key,name,parent_name,base_units,batch_id,ordinal) VALUES(1,'STOCKITEM','item','Item','Materials','Nos','migration',0);
      INSERT INTO finance_ledger_facts(company_id,name,group_name,root_group,closing_balance,batch_id,ordinal) VALUES(1,'Bank','Bank Accounts','Bank Accounts',100,'migration',0);
      INSERT INTO finance_postings(company_id,voucher_key,entry_index,ledger_name,amount,voucher_date,voucher_type,batch_id,ordinal) VALUES(1,'v',0,'Bank',10,'2026-04-01','Payment','migration',0);`);
        await client.query(
          await fs.readFile(
            path.join(folder, "012_dedicated_reporting_entities.sql"),
            "utf8",
          ),
        );
        assert.equal(
          (await client.query("SELECT count(*)::int n FROM finance_masters"))
            .rows[0].n,
          3,
        );
        assert.deepEqual(
          (
            await client.query(
              "SELECT group_source_key,unit_source_key,batch_id FROM stock_items",
            )
          ).rows[0],
          {
            group_source_key: "group",
            unit_source_key: "unit",
            batch_id: "migration",
          },
        );
        assert.equal(
          (
            await client.query(
              "SELECT amount::text FROM finance_monthly_summaries",
            )
          ).rows[0].amount,
          "10.00",
        );
        assert.equal(
          (await client.query("SELECT model_version FROM finance_snapshots"))
            .rows[0].model_version,
          2,
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
  },
);
