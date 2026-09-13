ALTER TABLE "Ledgers" ADD COLUMN IF NOT EXISTS "SourceKey" varchar(200);
ALTER TABLE "Vouchers" ADD COLUMN IF NOT EXISTS "SourceKey" varchar(200);

WITH ranked AS (
  SELECT
    "LedgerID",
    'ledger:' || lower("LedgerName") AS base_key,
    ROW_NUMBER() OVER (PARTITION BY "CompanyID", lower("LedgerName") ORDER BY "LedgerID") AS rn
  FROM "Ledgers"
  WHERE "SourceKey" IS NULL
)
UPDATE "Ledgers" l
SET "SourceKey" = CASE WHEN r.rn = 1 THEN r.base_key ELSE r.base_key || '#' || l."LedgerID"::text END
FROM ranked r
WHERE l."LedgerID" = r."LedgerID";

WITH ranked AS (
  SELECT
    "VoucherID",
    concat_ws('|',
      'voucher',
      "VoucherDate"::text,
      "VoucherType",
      COALESCE("VoucherNumber", ''),
      to_char("Amount", 'FM9999999999999990.00'),
      COALESCE("PartyLedgerName", '')
    ) AS base_key,
    ROW_NUMBER() OVER (
      PARTITION BY "CompanyID",
        concat_ws('|',
          'voucher',
          "VoucherDate"::text,
          "VoucherType",
          COALESCE("VoucherNumber", ''),
          to_char("Amount", 'FM9999999999999990.00'),
          COALESCE("PartyLedgerName", '')
        )
      ORDER BY "VoucherID"
    ) AS rn
  FROM "Vouchers"
  WHERE "SourceKey" IS NULL AND "Source" = 'tally'
)
UPDATE "Vouchers" v
SET "SourceKey" = CASE WHEN r.rn = 1 THEN r.base_key ELSE r.base_key || '|' || r.rn::text END
FROM ranked r
WHERE v."VoucherID" = r."VoucherID";

CREATE UNIQUE INDEX IF NOT EXISTS ledgers_company_source_key
  ON "Ledgers" ("CompanyID", "SourceKey")
  WHERE "SourceKey" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_company_source_key
  ON "Vouchers" ("CompanyID", "SourceKey")
  WHERE "SourceKey" IS NOT NULL AND "Source" = 'tally';
