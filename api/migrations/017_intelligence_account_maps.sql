CREATE TABLE IF NOT EXISTS intel_account_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES intel_companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES intel_accounts(id) ON DELETE CASCADE,
  tally_ledger_id integer NOT NULL,
  tally_ledger_name text NOT NULL,
  mapped_by text,
  mapped_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('AUTO', 'MANUAL')),
  UNIQUE (company_id, account_id)
);

CREATE INDEX IF NOT EXISTS intel_account_maps_ledger_idx ON intel_account_maps (company_id, tally_ledger_id);
