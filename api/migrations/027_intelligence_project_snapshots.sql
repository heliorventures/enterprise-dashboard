-- minimum-reader: 19
-- One row per project for every Excel import (generation). It records what the
-- project looked like when that file was imported so progress can be reported over
-- time. Additive only. The newest snapshot is refreshed when parties are moved so it
-- always agrees with the current project view.
CREATE TABLE intel_project_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES intel_companies(id),
  import_batch_id uuid NOT NULL REFERENCES intel_import_batches(id) ON DELETE CASCADE,
  -- Deliberately not a foreign key: history of a deleted project must stay as it was
  -- recorded and must not turn into "no project". NULL means parties in no project.
  project_id uuid,
  -- Copied so history stays readable after a project is renamed or deleted.
  project_name text,
  reporting_date date,
  -- Currency declared for the workbook amounts. NULL means undeclared: amounts are
  -- kept but never presented as money.
  currency text,
  parties integer NOT NULL DEFAULT 0,
  billed numeric(20,2) NOT NULL DEFAULT 0,
  paid numeric(20,2) NOT NULL DEFAULT 0,
  pending_debit numeric(20,2) NOT NULL DEFAULT 0,
  pending_credit numeric(20,2) NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  differences integer NOT NULL DEFAULT 0,
  unavailable integer NOT NULL DEFAULT 0,
  tally_only integer NOT NULL DEFAULT 0,
  -- NULL when the comparison with Tally was not possible for this import.
  gap numeric(20,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX intel_project_snapshots_batch_project_idx
  ON intel_project_snapshots (import_batch_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX intel_project_snapshots_company_idx ON intel_project_snapshots (company_id, reporting_date);
CREATE INDEX intel_project_snapshots_project_idx ON intel_project_snapshots (project_id);
