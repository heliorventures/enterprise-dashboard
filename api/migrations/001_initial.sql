CREATE TABLE "Companies" (
  "CompanyID" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "CompanyName" varchar(200) NOT NULL,
  "TallyGUID" varchar(200),
  "IsActive" boolean NOT NULL DEFAULT true,
  "CreatedDate" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX companies_name_unique ON "Companies" (lower("CompanyName"));

CREATE TABLE "Ledgers" (
  "LedgerID" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "CompanyID" integer NOT NULL REFERENCES "Companies" ("CompanyID"),
  "LedgerName" varchar(200) NOT NULL,
  "GroupCategory" varchar(100) NOT NULL,
  "CurrentBalance" numeric(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX ledgers_company ON "Ledgers" ("CompanyID");

CREATE TABLE "Projects" (
  "ProjectID" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "CompanyID" integer NOT NULL REFERENCES "Companies" ("CompanyID"),
  "ProjectName" varchar(200) NOT NULL,
  "BudgetedExpense" numeric(18,2) NOT NULL DEFAULT 0,
  "TargetRevenue" numeric(18,2) NOT NULL DEFAULT 0,
  "StartDate" date,
  "EndDate" date,
  UNIQUE ("CompanyID", "ProjectID"),
  CHECK ("EndDate" IS NULL OR "StartDate" IS NULL OR "EndDate" >= "StartDate")
);

CREATE TABLE "Vouchers" (
  "VoucherID" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "CompanyID" integer NOT NULL REFERENCES "Companies" ("CompanyID"),
  "ProjectID" integer,
  "VoucherDate" date NOT NULL,
  "VoucherType" varchar(80) NOT NULL,
  "Amount" numeric(18,2) NOT NULL,
  "Narration" varchar(400) NOT NULL DEFAULT '',
  "VoucherNumber" varchar(80),
  "PartyLedgerName" varchar(200),
  "Source" varchar(20) NOT NULL DEFAULT 'manual' CHECK ("Source" IN ('manual', 'tally')),
  FOREIGN KEY ("CompanyID", "ProjectID") REFERENCES "Projects" ("CompanyID", "ProjectID")
);
CREATE INDEX vouchers_company_date ON "Vouchers" ("CompanyID", "VoucherDate" DESC, "VoucherID" DESC);
CREATE INDEX vouchers_project ON "Vouchers" ("ProjectID");

CREATE TABLE "SyncLog" (
  "SyncID" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Source" varchar(40) NOT NULL,
  "Status" varchar(20) NOT NULL,
  "Message" varchar(1000),
  "SyncedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sync_log_latest ON "SyncLog" ("SyncedAt" DESC, "SyncID" DESC);
