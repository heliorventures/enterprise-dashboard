-- Independent source archive: never replaces current dashboard or manual rows.
CREATE TABLE tally_source_uploads (
  batch_id varchar(200) PRIMARY KEY,
  manifest jsonb NOT NULL,
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  result jsonb
);
CREATE TABLE tally_source_chunks (
  batch_id varchar(200) NOT NULL REFERENCES tally_source_uploads ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  checksum text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (batch_id, chunk_index)
);
CREATE INDEX tally_source_upload_expiry ON tally_source_uploads(updated_at) WHERE result IS NULL;

CREATE TABLE tally_source_snapshots (
  batch_id varchar(200) PRIMARY KEY,
  company_external_id varchar(200) NOT NULL,
  company_name varchar(200) NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  coverage_status text NOT NULL CHECK (coverage_status IN ('complete', 'partial')),
  manifest jsonb NOT NULL
);
CREATE INDEX tally_source_company_capture ON tally_source_snapshots(company_external_id, captured_at DESC);
CREATE TABLE tally_source_records (
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots ON DELETE CASCADE,
  collection text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_id text,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (batch_id, collection, ordinal)
);
CREATE INDEX tally_source_record_identity ON tally_source_records(collection, source_id);
-- The latest complete capture for each company/profile; partial or old retries
-- cannot displace a newer complete reporting reference. History is retained.
CREATE VIEW tally_source_latest AS
SELECT DISTINCT ON (company_external_id, schema_version)
  batch_id, company_external_id, company_name, captured_at, schema_version
FROM tally_source_snapshots
WHERE coverage_status = 'complete'
ORDER BY company_external_id, schema_version, captured_at DESC, received_at DESC, batch_id DESC;
