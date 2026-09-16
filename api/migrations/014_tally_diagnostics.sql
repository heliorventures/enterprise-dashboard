-- Independent of source snapshots: failures may happen before a batch exists.
CREATE TABLE tally_diagnostics (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid,
  batch_id text,
  company_external_id text,
  company_name text,
  collection text,
  event text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('error','warning')),
  message text NOT NULL,
  details jsonb NOT NULL,
  exporter jsonb,
  origin text NOT NULL CHECK (origin IN ('sender','api')),
  checksum text NOT NULL
);
CREATE INDEX tally_diagnostics_received ON tally_diagnostics(received_at DESC,id DESC);
CREATE INDEX tally_diagnostics_batch ON tally_diagnostics(batch_id,received_at DESC);
CREATE INDEX tally_diagnostics_company ON tally_diagnostics(company_external_id,received_at DESC);
