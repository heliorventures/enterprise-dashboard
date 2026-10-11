-- minimum-reader: 19
ALTER TABLE intel_account_maps ADD COLUMN tally_source_key text;
ALTER TABLE intel_account_maps ADD COLUMN tally_ledger_guid text;
ALTER TABLE intel_account_maps ADD COLUMN identity_write_version bigint NOT NULL DEFAULT 0;

-- Exact ID/name/company evidence only. Historical IDs and frozen inputs remain
-- immutable. Unresolved legacy maps are resolved conservatively at publication.
UPDATE intel_account_maps m SET tally_source_key=l."SourceKey"
FROM intel_companies c, "Ledgers" l
WHERE c.id=m.company_id AND l."CompanyID"=c.tally_company_id
  AND l."LedgerID"=m.tally_ledger_id AND l."LedgerName"=m.tally_ledger_name;

WITH archived_guids AS (
  SELECT m.id, min(trim(child->'content'->>0)) AS guid
  FROM intel_account_maps m
  JOIN intel_companies c ON c.id=m.company_id
  JOIN finance_ledger_facts f ON f.company_id=c.tally_company_id AND f.name=m.tally_ledger_name
  JOIN tally_source_records r ON r.batch_id=f.batch_id AND r.collection='LEDGER' AND r.ordinal=f.ordinal
  CROSS JOIN LATERAL jsonb_array_elements(r.payload->'content') child
  WHERE m.tally_source_key IS NOT NULL AND upper(child->>'tag')='GUID'
  GROUP BY m.id
  HAVING bool_and(jsonb_typeof(child->'content')='array' AND jsonb_array_length(child->'content')=1
    AND jsonb_typeof(child->'content'->0)='string')
    AND count(DISTINCT trim(child->'content'->>0))=1
)
UPDATE intel_account_maps m SET tally_ledger_guid=NULLIF(a.guid,'')
FROM archived_guids a WHERE a.id=m.id;

CREATE UNIQUE INDEX intel_account_maps_source_identity ON intel_account_maps(company_id,tally_source_key)
  WHERE tally_source_key IS NOT NULL;
CREATE UNIQUE INDEX intel_account_maps_guid_identity ON intel_account_maps(company_id,tally_ledger_guid)
  WHERE tally_ledger_guid IS NOT NULL;

-- UPDATE OF fires for explicitly assigned columns, even if their values did not
-- change. Alphabetical trigger order distinguishes a new writer supplying valid
-- identity fields from an old writer retaining them accidentally on retargeting.
CREATE FUNCTION intel_account_map_identity_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.identity_write_version := OLD.identity_write_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER intel_account_map_01_identity_write
  BEFORE UPDATE OF tally_source_key,tally_ledger_guid ON intel_account_maps
  FOR EACH ROW EXECUTE FUNCTION intel_account_map_identity_write();

CREATE FUNCTION intel_account_map_legacy_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tally_ledger_id IS DISTINCT FROM OLD.tally_ledger_id OR NEW.tally_ledger_name IS DISTINCT FROM OLD.tally_ledger_name)
    AND NEW.identity_write_version = OLD.identity_write_version THEN
    NEW.tally_source_key := NULL;
    NEW.tally_ledger_guid := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER intel_account_map_02_legacy_identity_guard
  BEFORE UPDATE OF tally_ledger_id,tally_ledger_name ON intel_account_maps
  FOR EACH ROW EXECUTE FUNCTION intel_account_map_legacy_identity_guard();
