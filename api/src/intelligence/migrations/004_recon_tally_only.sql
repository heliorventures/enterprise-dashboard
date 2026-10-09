-- Tally ledgers with no Excel row are still compared (MISSING_IN_SOURCE).
ALTER TABLE intel_reconciliations
  ALTER COLUMN outstanding_id DROP NOT NULL;
