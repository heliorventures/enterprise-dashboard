ALTER TABLE "Companies" ADD COLUMN "ExternalID" varchar(200) UNIQUE;
CREATE TABLE tally_ingestions (
  batch_id varchar(200) PRIMARY KEY,
  company_id integer NOT NULL REFERENCES "Companies" ("CompanyID"),
  captured_at timestamptz NOT NULL,
  checksum text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX tally_ingestions_company ON tally_ingestions (company_id, captured_at DESC);
