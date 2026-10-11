-- minimum-reader: 19
-- Observed Tally labels '?' and 'I?' are damaged metadata, not ISO currencies.
-- Resolve them through company configuration; never infer an FX conversion.
CREATE OR REPLACE FUNCTION normalize_finance_currency(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN code IN ('?','I?',chr(65533)) THEN NULL
    WHEN code IN ('₹','RS','RS.','RUPEE','RUPEES','INDIAN RUPEE','INDIAN RUPEES') THEN 'INR'
    ELSE NULLIF(code,'') END
  FROM (SELECT upper(btrim(regexp_replace(value,'\s+',' ','g'))) AS code) normalized
$$;

-- Repair invalid company defaults left by 024. Explicit currencies are retained.
UPDATE "Companies" SET "Currency"=COALESCE(normalize_finance_currency("Currency"),'INR')
WHERE normalize_finance_currency("Currency") IS DISTINCT FROM "Currency";

-- The existing publication trigger now ignores damaged ledger labels and resolves
-- absent snapshot currency against the repaired company default. It still rejects
-- genuine foreign ledger currencies through uniformCurrency=false.
UPDATE finance_snapshots SET currency=normalize_finance_currency(currency);

-- Raw archives, native currency master identities, ledger amounts, timestamps and
-- immutable Intelligence generation inputs remain unchanged. The same normalizer
-- protects future inserts/updates through the triggers installed by 024.
