CREATE TABLE source_sync_runs (
  run_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status varchar(20) NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  triggered_by varchar(80) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz,
  company_total integer NOT NULL DEFAULT 0,
  company_done integer NOT NULL DEFAULT 0,
  message varchar(1000) NOT NULL DEFAULT ''
);

CREATE TABLE source_sync_items (
  item_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id integer NOT NULL REFERENCES source_sync_runs(run_id) ON DELETE CASCADE,
  company_external_id varchar(200) NOT NULL,
  company_name varchar(200) NOT NULL,
  batch_id varchar(200),
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'running', 'ok', 'skipped', 'error')),
  message varchar(1000) NOT NULL DEFAULT '',
  ledger_insert integer NOT NULL DEFAULT 0,
  ledger_update integer NOT NULL DEFAULT 0,
  ledger_unchanged integer NOT NULL DEFAULT 0,
  ledger_remove integer NOT NULL DEFAULT 0,
  voucher_insert integer NOT NULL DEFAULT 0,
  voucher_update integer NOT NULL DEFAULT 0,
  voucher_unchanged integer NOT NULL DEFAULT 0,
  voucher_remove integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX source_sync_runs_started ON source_sync_runs (started_at DESC, run_id DESC);
CREATE INDEX source_sync_items_run ON source_sync_items (run_id);
