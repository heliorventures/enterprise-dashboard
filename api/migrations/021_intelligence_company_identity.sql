-- minimum-reader: 19
-- Duplicate owners require deliberate reconciliation of financial history.
DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(format('Tally company %s: Intelligence IDs %s', tally_company_id, ids), E'\n')
  INTO conflicts FROM (
    SELECT tally_company_id, string_agg(id::text, ', ' ORDER BY id) AS ids
    FROM intel_companies WHERE tally_company_id IS NOT NULL
    GROUP BY tally_company_id HAVING count(*) > 1
  ) duplicates;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P2101', MESSAGE = 'Duplicate Intelligence company ownership prevents migration 021',
      DETAIL = conflicts,
      HINT = 'Review listed owners and their intel_import_files, intel_accounts and intel_company_publications. Reconcile ownership with an approved data plan; preserve financial history and do not bypass this guard.';
  END IF;
END $$;
ALTER TABLE intel_companies ADD CONSTRAINT intel_companies_tally_identity UNIQUE (tally_company_id);
