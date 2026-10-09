ALTER TABLE intel_import_batches
  ADD COLUMN company_id uuid REFERENCES intel_companies(id),
  ADD COLUMN generation integer,
  ADD COLUMN reporting_date date,
  ADD COLUMN frozen_inputs jsonb,
  ADD COLUMN lease_token uuid,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN tally_batch_id text,
  ADD COLUMN tally_balance_date date;

UPDATE intel_import_batches b SET company_id=f.company_id,
  reporting_date=f.reporting_period_to
FROM intel_import_files f WHERE f.id=b.import_file_id;
WITH numbered AS (
  SELECT id,row_number() OVER (PARTITION BY import_file_id ORDER BY started_at NULLS FIRST,id)::integer AS generation
  FROM intel_import_batches
) UPDATE intel_import_batches b SET generation=n.generation FROM numbered n WHERE b.id=n.id;
ALTER TABLE intel_import_batches ALTER COLUMN generation SET NOT NULL;
ALTER TABLE intel_import_files ADD CONSTRAINT intel_file_company_key UNIQUE(id,company_id);
ALTER TABLE intel_import_batches ADD CONSTRAINT intel_batch_company_key UNIQUE(id,company_id),
  ADD CONSTRAINT intel_batch_file_key UNIQUE(id,import_file_id),
  ADD CONSTRAINT intel_batch_file_company_fk FOREIGN KEY(import_file_id,company_id) REFERENCES intel_import_files(id,company_id);
CREATE UNIQUE INDEX intel_batches_generation_idx ON intel_import_batches(import_file_id,generation);
ALTER TABLE intel_import_files ADD COLUMN selected_batch_id uuid,
  ADD CONSTRAINT intel_file_selected_batch_fk FOREIGN KEY(selected_batch_id,id) REFERENCES intel_import_batches(id,import_file_id);
UPDATE intel_import_files f SET selected_batch_id=b.id FROM (
  SELECT DISTINCT ON (import_file_id) id,import_file_id FROM intel_import_batches ORDER BY import_file_id,generation DESC
) b WHERE f.id=b.import_file_id;
-- Legacy in-flight jobs have no durable owner; successful rows are retained.
UPDATE intel_import_batches SET status='FAILED',completed_at=now(),
  error_message='Interrupted before durable publication',progress_message='Interrupted before durable publication'
WHERE status IN ('PENDING','PROCESSING');
UPDATE intel_import_files SET status='FAILED' WHERE status='PROCESSING';
CREATE UNIQUE INDEX intel_batches_active_file_idx ON intel_import_batches(import_file_id) WHERE status='PROCESSING';

ALTER TABLE intel_reconciliations
  ADD COLUMN import_batch_id uuid REFERENCES intel_import_batches(id),
  ADD COLUMN reporting_date date,
  ADD COLUMN tally_batch_id text,
  ADD COLUMN tally_balance_date date,
  ADD COLUMN comparison_available boolean NOT NULL DEFAULT false;
UPDATE intel_reconciliations r SET import_batch_id=o.import_batch_id,reporting_date=o.reporting_date
FROM intel_outstanding o WHERE o.id=r.outstanding_id;
-- Do not invent provenance for legacy Tally-only rows.
CREATE INDEX intel_recon_batch_idx ON intel_reconciliations(import_batch_id);
ALTER TABLE intel_reconciliations ADD CONSTRAINT intel_recon_batch_company_fk
  FOREIGN KEY(import_batch_id,company_id) REFERENCES intel_import_batches(id,company_id);
ALTER TABLE intel_outstanding ADD CONSTRAINT intel_outstanding_batch_company_fk
  FOREIGN KEY(import_batch_id,company_id) REFERENCES intel_import_batches(id,company_id);

CREATE TABLE intel_company_publications (
  company_id uuid PRIMARY KEY REFERENCES intel_companies(id),
  import_batch_id uuid NOT NULL REFERENCES intel_import_batches(id),
  reporting_date date,
  published_at timestamptz NOT NULL DEFAULT now()
  ,CONSTRAINT intel_publication_batch_company_fk FOREIGN KEY(import_batch_id,company_id) REFERENCES intel_import_batches(id,company_id)
);
INSERT INTO intel_company_publications(company_id,import_batch_id,reporting_date)
SELECT DISTINCT ON (company_id) company_id,id,reporting_date
FROM intel_import_batches WHERE company_id IS NOT NULL AND status='COMPLETED'
ORDER BY company_id,reporting_date DESC NULLS LAST,completed_at DESC NULLS LAST,id DESC;

CREATE VIEW intel_current_outstanding AS
SELECT o.* FROM intel_outstanding o JOIN intel_company_publications p
ON p.company_id=o.company_id AND p.import_batch_id=o.import_batch_id;
CREATE VIEW intel_current_reconciliations AS
SELECT r.id,r.outstanding_id,r.company_id,r.tally_ledger_id,r.tally_ledger_name,r.tally_amount,r.source_amount,
  CASE WHEN r.comparison_available THEN r.difference END AS difference,
  CASE WHEN r.comparison_available THEN r.difference_pct END AS difference_pct,
  r.match_method,r.match_score,r.matching_fields,
  CASE WHEN r.comparison_available THEN r.status ELSE 'COMPARISON_UNAVAILABLE' END AS status,
  r.measure,r.import_batch_id,r.reporting_date,r.tally_batch_id,r.tally_balance_date,r.comparison_available,
  r.status AS historical_status,r.difference AS historical_difference
FROM intel_reconciliations r JOIN intel_company_publications p
ON p.company_id=r.company_id AND p.import_batch_id=r.import_batch_id;
CREATE VIEW intel_current_exceptions AS
SELECT e.id,e.company_id,e.outstanding_id,e.reconciliation_id,e.import_batch_id,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN 'COMPARISON_UNAVAILABLE' ELSE e.type END AS type,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN 'MEDIUM' ELSE e.severity END AS severity,
  e.status,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN 'Financial comparison unavailable: balance-date provenance is missing or different' ELSE e.title END AS title,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN
    e.detail || '{"status":"COMPARISON_UNAVAILABLE","difference":null,"difference_pct":null,"comparison_available":false}'::jsonb
    ELSE e.detail END AS detail,
  e.owner,e.created_at,e.updated_at,e.type AS historical_type,e.detail AS historical_detail
FROM intel_exceptions e JOIN intel_company_publications p
ON p.company_id=e.company_id AND p.import_batch_id=e.import_batch_id
LEFT JOIN intel_reconciliations r ON r.id=e.reconciliation_id;
