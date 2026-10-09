CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS intel_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  tally_company_id integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES intel_companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS intel_source_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES intel_companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('TALLY','EXCEL','ERP','OPERATIONAL','OTHER')),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS intel_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN (
    'SUPER_ADMIN','CEO','VP','COMPANY_ADMIN','FINANCE_MANAGER','FINANCE_USER',
    'OPERATIONS_MANAGER','OPERATIONS_USER','AUDITOR','VIEWER'
  )),
  password_hash text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS intel_user_companies (
  user_id uuid NOT NULL REFERENCES intel_users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES intel_companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS intel_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES intel_companies(id) ON DELETE CASCADE,
  source_system_id uuid REFERENCES intel_source_systems(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  UNIQUE (company_id, source_system_id, key)
);

CREATE TABLE IF NOT EXISTS intel_field_catalog (
  field_key text PRIMARY KEY,
  label text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('text','integer','decimal','date','boolean')),
  required boolean NOT NULL DEFAULT false,
  group_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS intel_column_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system_id uuid REFERENCES intel_source_systems(id) ON DELETE CASCADE,
  company_id uuid REFERENCES intel_companies(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  source_header text NOT NULL,
  source_aliases text[] NOT NULL DEFAULT '{}',
  target_field text REFERENCES intel_field_catalog(field_key),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS intel_import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES intel_companies(id),
  source_system_id uuid REFERENCES intel_source_systems(id),
  file_name text NOT NULL,
  stored_path text NOT NULL,
  file_hash text NOT NULL,
  file_size integer NOT NULL,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'UPLOADED',
  reporting_period_from date,
  reporting_period_to date,
  detected_title text,
  detected_company text,
  mapping_version integer NOT NULL DEFAULT 1,
  analysis jsonb
);

CREATE TABLE IF NOT EXISTS intel_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_file_id uuid NOT NULL REFERENCES intel_import_files(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  total_rows integer NOT NULL DEFAULT 0,
  successful_rows integer NOT NULL DEFAULT 0,
  warning_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  group_rows integer NOT NULL DEFAULT 0,
  detail_rows integer NOT NULL DEFAULT 0,
  source_total_status text,
  source_total_debit numeric(18,2),
  source_total_credit numeric(18,2),
  calculated_total_debit numeric(18,2),
  calculated_total_credit numeric(18,2),
  progress_percent integer NOT NULL DEFAULT 0,
  progress_message text,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);

CREATE TABLE IF NOT EXISTS intel_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES intel_import_batches(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL,
  worksheet text,
  row_type text NOT NULL CHECK (row_type IN ('GROUP','DETAIL','TOTAL','HEADER','IGNORED')),
  raw_data jsonb NOT NULL,
  mapped_data jsonb,
  category_path text[] NOT NULL DEFAULT '{}',
  validation_status text NOT NULL DEFAULT 'PENDING',
  errors jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS intel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES intel_companies(id) ON DELETE CASCADE,
  parent_account_id uuid REFERENCES intel_accounts(id),
  account_name text NOT NULL,
  account_type text,
  level_1_category text,
  level_2_category text,
  category_path text[] NOT NULL DEFAULT '{}',
  gst_number text,
  pan_number text,
  msme_number text,
  credit_days numeric,
  UNIQUE (company_id, account_name)
);

CREATE TABLE IF NOT EXISTS intel_outstanding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES intel_companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES intel_accounts(id) ON DELETE CASCADE,
  import_batch_id uuid REFERENCES intel_import_batches(id) ON DELETE SET NULL,
  import_row_id uuid REFERENCES intel_import_rows(id) ON DELETE SET NULL,
  reporting_date date,
  bill_amount numeric(18,2) NOT NULL DEFAULT 0,
  paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  pending_bill_debit numeric(18,2) NOT NULL DEFAULT 0,
  pending_bill_credit numeric(18,2) NOT NULL DEFAULT 0,
  last_payment_requisition_amount numeric(18,2),
  last_payment_amount numeric(18,2),
  last_payment_date date,
  last_date date,
  extra jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS intel_ageing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outstanding_id uuid NOT NULL REFERENCES intel_outstanding(id) ON DELETE CASCADE,
  ageing_bucket text NOT NULL,
  bucket_from date,
  bucket_to date,
  bucket_label text,
  debit_amount numeric(18,2) NOT NULL DEFAULT 0,
  credit_amount numeric(18,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS intel_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outstanding_id uuid NOT NULL REFERENCES intel_outstanding(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES intel_companies(id) ON DELETE CASCADE,
  tally_ledger_id integer,
  tally_ledger_name text,
  tally_amount numeric(18,2),
  source_amount numeric(18,2),
  difference numeric(18,2),
  difference_pct numeric(12,4),
  match_method text,
  match_score numeric(6,3),
  matching_fields text[] NOT NULL DEFAULT '{}',
  status text NOT NULL,
  measure text NOT NULL DEFAULT 'pending_net'
);

CREATE TABLE IF NOT EXISTS intel_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES intel_companies(id) ON DELETE CASCADE,
  outstanding_id uuid REFERENCES intel_outstanding(id) ON DELETE SET NULL,
  reconciliation_id uuid REFERENCES intel_reconciliations(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES intel_import_batches(id) ON DELETE SET NULL,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'OPEN',
  title text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  owner text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_exception_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES intel_exceptions(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES intel_companies(id) ON DELETE CASCADE,
  exception_id uuid REFERENCES intel_exceptions(id) ON DELETE CASCADE,
  outstanding_id uuid REFERENCES intel_outstanding(id) ON DELETE SET NULL,
  document_type text NOT NULL DEFAULT 'OTHER',
  file_name text NOT NULL,
  stored_path text NOT NULL,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_audit (
  id bigserial PRIMARY KEY,
  username text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intel_import_files_hash_idx ON intel_import_files(file_hash);
CREATE INDEX IF NOT EXISTS intel_import_files_company_idx ON intel_import_files(company_id);
CREATE INDEX IF NOT EXISTS intel_import_rows_batch_idx ON intel_import_rows(import_batch_id);
CREATE INDEX IF NOT EXISTS intel_accounts_company_idx ON intel_accounts(company_id);
CREATE INDEX IF NOT EXISTS intel_accounts_gst_idx ON intel_accounts(gst_number);
CREATE INDEX IF NOT EXISTS intel_accounts_pan_idx ON intel_accounts(pan_number);
CREATE INDEX IF NOT EXISTS intel_outstanding_company_idx ON intel_outstanding(company_id);
CREATE INDEX IF NOT EXISTS intel_outstanding_account_idx ON intel_outstanding(account_id);
CREATE INDEX IF NOT EXISTS intel_outstanding_batch_idx ON intel_outstanding(import_batch_id);
CREATE INDEX IF NOT EXISTS intel_outstanding_dates_idx ON intel_outstanding(reporting_date, last_payment_date);
CREATE INDEX IF NOT EXISTS intel_ageing_outstanding_idx ON intel_ageing(outstanding_id);
CREATE INDEX IF NOT EXISTS intel_recon_company_idx ON intel_reconciliations(company_id);
CREATE INDEX IF NOT EXISTS intel_recon_status_idx ON intel_reconciliations(status);
CREATE INDEX IF NOT EXISTS intel_exceptions_company_idx ON intel_exceptions(company_id);
CREATE INDEX IF NOT EXISTS intel_exceptions_status_idx ON intel_exceptions(status, type);
CREATE INDEX IF NOT EXISTS intel_audit_entity_idx ON intel_audit(entity, entity_id);
CREATE INDEX IF NOT EXISTS intel_audit_created_idx ON intel_audit(created_at);

INSERT INTO intel_source_systems (name, type)
SELECT name, type FROM (VALUES
  ('Excel export','EXCEL'),
  ('Tally','TALLY'),
  ('Operational application','OPERATIONAL'),
  ('ERP','ERP')
) AS seed(name, type)
WHERE NOT EXISTS (SELECT 1 FROM intel_source_systems s WHERE s.name = seed.name);

INSERT INTO intel_field_catalog (field_key, label, data_type, required, group_name) VALUES
  ('account_name','Account name','text', true, 'account'),
  ('particulars','Particulars','text', false, 'account'),
  ('credit_days','Credit days','integer', false, 'account'),
  ('gst_number','GST number','text', false, 'identity'),
  ('msme_number','MSME number','text', false, 'identity'),
  ('pan_number','PAN number','text', false, 'identity'),
  ('bill_amount','Bill amount','decimal', false, 'financial'),
  ('paid_amount','Paid amount','decimal', false, 'financial'),
  ('last_payment_requisition_amount','Last payment requisition amount','decimal', false, 'payment'),
  ('last_payment_amount','Last payment amount','decimal', false, 'payment'),
  ('last_payment_date','Last payment date','date', false, 'payment'),
  ('pending_bill_debit','Pending bill debit','decimal', false, 'outstanding'),
  ('pending_bill_credit','Pending bill credit','decimal', false, 'outstanding'),
  ('age_0_1_year_debit','0-1 year debit','decimal', false, 'ageing'),
  ('age_0_1_year_credit','0-1 year credit','decimal', false, 'ageing'),
  ('age_1_2_year_debit','1-2 year debit','decimal', false, 'ageing'),
  ('age_1_2_year_credit','1-2 year credit','decimal', false, 'ageing'),
  ('age_2_3_year_debit','2-3 year debit','decimal', false, 'ageing'),
  ('age_2_3_year_credit','2-3 year credit','decimal', false, 'ageing'),
  ('age_3_plus_year_debit','3+ year debit','decimal', false, 'ageing'),
  ('age_3_plus_year_credit','3+ year credit','decimal', false, 'ageing'),
  ('last_date','Last date','date', false, 'payment')
ON CONFLICT (field_key) DO NOTHING;

INSERT INTO intel_users (username, display_name, role)
SELECT 'admin', 'Administrator', 'SUPER_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM intel_users WHERE username='admin');

INSERT INTO intel_rules (key, value)
SELECT seed.key, seed.value::jsonb
FROM (VALUES
  ('amount_tolerance','{"amount":1000}'),
  ('date_tolerance_days','{"days":3}'),
  ('critical_difference','{"amount":100000}'),
  ('gst_required','{"required":false}'),
  ('fail_import_on_total_mismatch','{"enabled":false}'),
  ('outstanding_measure','{"field":"pending_net"}'),
  ('net_outstanding_formula','{"expression":"pending_bill_debit - pending_bill_credit"}')
) AS seed(key, value)
WHERE NOT EXISTS (SELECT 1 FROM intel_rules r WHERE r.key=seed.key AND r.company_id IS NULL);
