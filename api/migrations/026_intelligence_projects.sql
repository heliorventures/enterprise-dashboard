-- minimum-reader: 19
-- Project dimension for Excel imports. Additive only: existing Intelligence
-- tables, views and Tally tables keep their meaning. A project groups Excel
-- parties (accounts) of one company. Assignment comes from keyword rules on the
-- party name or from a user decision that always wins over rules.
CREATE TABLE intel_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES intel_companies(id),
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  tally_project_id integer REFERENCES "Projects"("ProjectID") ON DELETE SET NULL,
  budget_expense numeric(18,2) CHECK (budget_expense IS NULL OR budget_expense >= 0),
  target_revenue numeric(18,2) CHECK (target_revenue IS NULL OR target_revenue >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
CREATE UNIQUE INDEX intel_projects_company_name_idx ON intel_projects (company_id, lower(btrim(name)));
CREATE INDEX intel_projects_tally_idx ON intel_projects (tally_project_id);

CREATE TABLE intel_project_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  keyword text NOT NULL CHECK (length(btrim(keyword)) BETWEEN 2 AND 80),
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, company_id) REFERENCES intel_projects(id, company_id) ON DELETE CASCADE
);
-- One keyword belongs to one project per company, so a party never matches two
-- projects through identical text.
CREATE UNIQUE INDEX intel_project_rules_keyword_idx ON intel_project_rules (company_id, lower(btrim(keyword)));
CREATE INDEX intel_project_rules_project_idx ON intel_project_rules (project_id);

ALTER TABLE intel_accounts
  ADD COLUMN project_id uuid REFERENCES intel_projects(id) ON DELETE SET NULL,
  ADD COLUMN project_source text CHECK (project_source IN ('RULE','MANUAL'));
CREATE INDEX intel_accounts_project_idx ON intel_accounts (company_id, project_id);
