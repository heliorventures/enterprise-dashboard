-- minimum-reader: 19
-- Retain historical amounts/statuses; current comparisons require a confirmed
-- matching workbook and Tally currency in the immutable generation inputs.
CREATE OR REPLACE VIEW intel_current_reconciliations AS
SELECT r.id,r.outstanding_id,r.company_id,r.tally_ledger_id,r.tally_ledger_name,r.tally_amount,r.source_amount,
  CASE WHEN available.value THEN r.difference END AS difference,
  CASE WHEN available.value THEN r.difference_pct END AS difference_pct,
  r.match_method,r.match_score,r.matching_fields,
  CASE WHEN available.value THEN r.status ELSE 'COMPARISON_UNAVAILABLE' END AS status,
  r.measure,r.import_batch_id,r.reporting_date,r.tally_batch_id,r.tally_balance_date,available.value AS comparison_available,
  r.status AS historical_status,r.difference AS historical_difference
FROM intel_reconciliations r JOIN intel_company_publications p
ON p.company_id=r.company_id AND p.import_batch_id=r.import_batch_id
JOIN intel_import_batches b ON b.id=r.import_batch_id
CROSS JOIN LATERAL (SELECT COALESCE(r.comparison_available
  AND b.frozen_inputs->'analysis'->>'currency' ~ '^[A-Z]{3}$'
  AND b.frozen_inputs->'analysis'->>'currency'=b.frozen_inputs->'reference'->>'currency'
  AND b.frozen_inputs->'reference'->>'uniformCurrency'='true',false) AS value) available;

CREATE OR REPLACE VIEW intel_current_exceptions AS
SELECT e.id,e.company_id,e.outstanding_id,e.reconciliation_id,e.import_batch_id,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN 'COMPARISON_UNAVAILABLE' ELSE e.type END AS type,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN 'MEDIUM' ELSE e.severity END AS severity,
  e.status,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN 'Financial comparison unavailable: balance dates or currencies are unknown or different' ELSE e.title END AS title,
  CASE WHEN r.id IS NOT NULL AND NOT r.comparison_available THEN
    e.detail || '{"status":"COMPARISON_UNAVAILABLE","difference":null,"difference_pct":null,"comparison_available":false}'::jsonb
    ELSE e.detail END AS detail,
  e.owner,e.created_at,e.updated_at,e.type AS historical_type,e.detail AS historical_detail
FROM intel_exceptions e JOIN intel_company_publications p
ON p.company_id=e.company_id AND p.import_batch_id=e.import_batch_id
LEFT JOIN intel_current_reconciliations r ON r.id=e.reconciliation_id;
