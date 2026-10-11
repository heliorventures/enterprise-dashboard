-- minimum-reader: 19
-- Company currency is independent of source validation. Missing metadata uses
-- the application's declared INR default; explicit source currencies win.
CREATE FUNCTION normalize_finance_currency(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN code IN ('₹','RS','RS.','RUPEE','RUPEES','INDIAN RUPEE','INDIAN RUPEES')
    THEN 'INR' ELSE NULLIF(code,'') END
  FROM (SELECT upper(btrim(regexp_replace(value,'\s+',' ','g'))) AS code) normalized
$$;

ALTER TABLE "Companies" ADD COLUMN "Currency" text NOT NULL DEFAULT 'INR';
COMMENT ON COLUMN "Companies"."Currency" IS
  'Reporting currency; defaults to INR when source metadata is absent. No FX conversion is applied.';

CREATE FUNCTION set_company_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."Currency" := COALESCE(normalize_finance_currency(NEW."Currency"),'INR');
  RETURN NEW;
END $$;
CREATE TRIGGER company_currency_default BEFORE INSERT OR UPDATE OF "Currency" ON "Companies"
FOR EACH ROW EXECUTE FUNCTION set_company_currency();

UPDATE "Companies" c SET "Currency"=normalize_finance_currency(s.currency)
FROM finance_snapshots s
WHERE s.company_id=c."CompanyID" AND normalize_finance_currency(s.currency) IS NOT NULL;

-- Also protect compatible older publishers that explicitly write null currency.
-- Publication writes the current ledger facts before its snapshot in one transaction.
CREATE FUNCTION set_finance_snapshot_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Companies" SET "Currency"=COALESCE(normalize_finance_currency(NEW.currency),"Currency")
  WHERE "CompanyID"=NEW.company_id RETURNING "Currency" INTO NEW.currency;
  NEW.coverage := COALESCE(NEW.coverage,'{}'::jsonb) || jsonb_build_object('uniformCurrency',
    NOT EXISTS (SELECT 1 FROM finance_ledger_facts f WHERE f.company_id=NEW.company_id
      AND normalize_finance_currency(f.currency) IS NOT NULL
      AND normalize_finance_currency(f.currency) IS DISTINCT FROM NEW.currency));
  RETURN NEW;
END $$;
CREATE TRIGGER finance_snapshot_currency_default BEFORE INSERT OR UPDATE OF currency,coverage,company_id ON finance_snapshots
FOR EACH ROW EXECUTE FUNCTION set_finance_snapshot_currency();

-- Retain financial facts, source identities, capture timestamps and other coverage.
-- Companies with no validated snapshot remain without a validated snapshot.
UPDATE finance_snapshots SET currency=normalize_finance_currency(currency);
