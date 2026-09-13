-- Additive reporting projection. Raw source archives and legacy/manual rows remain intact.
CREATE TABLE finance_snapshots (
  company_id integer PRIMARY KEY REFERENCES "Companies"("CompanyID"),
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  model_version integer NOT NULL DEFAULT 1,
  currency text,
  books_from date,
  starting_from date,
  captured_at timestamptz NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  coverage jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE finance_masters (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  collection text NOT NULL CHECK (collection IN ('GROUP','VOUCHERTYPE','CURRENCY','COSTCATEGORY','COSTCENTRE','STOCKGROUP','STOCKCATEGORY','STOCKITEM','UNIT','GODOWN')),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  category_name text,
  base_units text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  PRIMARY KEY(company_id, collection, source_key),
  UNIQUE(company_id, collection, name)
);
CREATE TABLE finance_ledger_facts (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  name text NOT NULL,
  group_name text NOT NULL,
  root_group text,
  opening_balance numeric(20,2),
  closing_balance numeric(20,2) NOT NULL,
  currency text,
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  PRIMARY KEY(company_id,name)
);
CREATE TABLE finance_postings (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  voucher_key text NOT NULL,
  entry_index integer NOT NULL,
  ledger_name text NOT NULL,
  amount numeric(20,2) NOT NULL,
  voucher_date date NOT NULL,
  voucher_type text NOT NULL,
  base_type text,
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  PRIMARY KEY(company_id,voucher_key,entry_index)
);
CREATE INDEX finance_postings_ledger_date ON finance_postings(company_id,ledger_name,voucher_date);
CREATE TABLE finance_allocations (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  voucher_key text NOT NULL,
  entry_index integer NOT NULL,
  allocation_index integer NOT NULL,
  category_name text,
  centre_name text NOT NULL,
  amount numeric(20,2),
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  PRIMARY KEY(company_id,voucher_key,entry_index,allocation_index),
  FOREIGN KEY(company_id,voucher_key,entry_index) REFERENCES finance_postings ON DELETE CASCADE
);
CREATE TABLE finance_inventory_movements (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  voucher_key text NOT NULL,
  movement_index integer NOT NULL,
  stock_item text NOT NULL,
  godown_name text,
  quantity_text text,
  amount numeric(20,2),
  voucher_date date NOT NULL,
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  PRIMARY KEY(company_id,voucher_key,movement_index)
);
CREATE TABLE source_validation_issues (
  issue_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  item_id integer REFERENCES source_sync_items(item_id),
  collection text NOT NULL,
  ordinal integer,
  field text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('error','warning')),
  code text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_validation_issues_batch ON source_validation_issues(batch_id,issue_id);
