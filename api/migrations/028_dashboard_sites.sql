-- minimum-reader: 28
-- This is an access-boundary change: older binaries must not serve unscoped data.
-- Requires PostgreSQL 15+ for security-invoker views.
CREATE TABLE dashboard_sites (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hostname text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(hostname) <= 253 AND hostname = lower(hostname)
    AND hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$')
);
CREATE TABLE dashboard_site_companies (
  site_id integer NOT NULL REFERENCES dashboard_sites(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID") ON DELETE CASCADE,
  PRIMARY KEY (site_id, company_id)
);
CREATE INDEX dashboard_site_companies_company ON dashboard_site_companies(company_id);
INSERT INTO dashboard_sites(hostname,display_name) VALUES
  ('scfinance.heliorsoft.com','Solvian Group A Finance'),
  ('sbfinance.heliorsoft.com','Solvian Buildcon Finance');

-- Exact names after case/whitespace normalization; never fuzzy-match identities.
-- An empty installation stays empty until an operator maps ingested CompanyIDs.
DO $$
DECLARE expected record; matches integer; company integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "Companies") THEN
    FOR expected IN SELECT * FROM (VALUES
      ('scfinance.heliorsoft.com','Mr. VPP (Individual)'),
      ('scfinance.heliorsoft.com','SOLVIAN CONSULTANCY LLP'),
      ('scfinance.heliorsoft.com','SOLVIAN INFRA AND AGRO LLP'),
      ('scfinance.heliorsoft.com','HOMECRAFT ENTERPRISES'),
      ('scfinance.heliorsoft.com','SOLVIAN INFRASTRUCTURE AND PROJECTS LLP'),
      ('sbfinance.heliorsoft.com','SOLVIAN BUILDCON LLP')
    ) AS seed(hostname,company_name) LOOP
      SELECT count(*), min("CompanyID") INTO matches, company FROM "Companies"
      WHERE lower(btrim(regexp_replace("CompanyName",'\s+',' ','g')))=lower(expected.company_name)
        AND "IsActive";
      IF matches <> 1 THEN
        RAISE EXCEPTION 'Dashboard site seed requires exactly one active company named "%"; found %. Verify Companies names/IDs before deploying; do not create a substitute company.', expected.company_name, matches;
      END IF;
      INSERT INTO dashboard_site_companies(site_id,company_id)
        SELECT id,company FROM dashboard_sites WHERE hostname=expected.hostname;
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION dashboard_site_id() RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('dashboard.site_id',true),'')::integer
$$;
CREATE FUNCTION dashboard_unscoped() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('dashboard.access_mode',true)='system',false)
$$;
CREATE FUNCTION dashboard_site_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM dashboard_sites WHERE id=dashboard_site_id() AND enabled)
$$;
CREATE FUNCTION dashboard_company_ids() RETURNS integer[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(m.company_id),'{}'::integer[])
    FROM dashboard_site_companies m JOIN dashboard_sites s ON s.id=m.site_id
    WHERE m.site_id=dashboard_site_id() AND s.enabled
$$;

ALTER TABLE source_sync_runs ADD COLUMN site_id integer REFERENCES dashboard_sites(id)
  DEFAULT dashboard_site_id();
ALTER TABLE "SyncLog" ADD COLUMN site_id integer REFERENCES dashboard_sites(id)
  DEFAULT dashboard_site_id();

-- Attribute audit to the financial owner, not the website at the time of the event:
-- moving a company must move access to its history too. Unresolvable old events stay
-- available to database maintenance, never to a website with uncertain ownership.
ALTER TABLE intel_audit ADD COLUMN company_id uuid REFERENCES intel_companies(id) ON DELETE SET NULL;
CREATE FUNCTION dashboard_audit_company() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; recorded text;
BEGIN
  CASE NEW.entity
    WHEN 'import_file' THEN SELECT company_id INTO owner_id FROM intel_import_files WHERE id::text=NEW.entity_id;
    WHEN 'account' THEN SELECT company_id INTO owner_id FROM intel_accounts WHERE id::text=NEW.entity_id;
    WHEN 'exception' THEN SELECT company_id INTO owner_id FROM intel_exceptions WHERE id::text=NEW.entity_id;
    WHEN 'project' THEN SELECT company_id INTO owner_id FROM intel_projects WHERE id::text=NEW.entity_id;
    ELSE owner_id := NULL;
  END CASE;
  recorded := COALESCE(NEW.old_value->>'company_id',NEW.new_value->>'company_id');
  IF owner_id IS NULL AND recorded ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO owner_id FROM intel_companies WHERE id=recorded::uuid;
  END IF;
  NEW.company_id := owner_id;
  RETURN NEW;
END $$;
CREATE TRIGGER dashboard_audit_owner BEFORE INSERT OR UPDATE OF entity,entity_id,old_value,new_value
  ON intel_audit FOR EACH ROW EXECUTE FUNCTION dashboard_audit_company();
UPDATE intel_audit SET entity=entity;
CREATE INDEX intel_audit_company ON intel_audit(company_id,id DESC);

-- Central enforcement includes all base tables used by reports and asynchronous
-- imports, not only the company selector. FORCE covers the migration/table owner.
DO $$
DECLARE table_name text; predicate text; entry record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Companies','Ledgers','Vouchers','Projects'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY dashboard_site_access ON %I USING (dashboard_unscoped() OR "CompanyID"=ANY((SELECT dashboard_company_ids())::integer[]))',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['tally_ingestions','finance_snapshots','finance_ledger_facts',
    'finance_postings','finance_allocations','finance_inventory_movements','finance_monthly_summaries',
    'account_groups','voucher_types','currencies','cost_categories','cost_centres','stock_groups',
    'stock_categories','stock_items','units','godowns'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY dashboard_site_access ON %I USING (dashboard_unscoped() OR company_id=ANY((SELECT dashboard_company_ids())::integer[]))',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['intel_business_units','intel_user_companies','intel_import_files',
    'intel_import_batches','intel_accounts','intel_outstanding','intel_reconciliations','intel_exceptions',
    'intel_documents','intel_account_maps','intel_company_publications','intel_projects',
    'intel_project_rules','intel_project_snapshots','intel_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY dashboard_site_access ON %I USING (dashboard_unscoped() OR company_id IN (SELECT id FROM intel_companies))',table_name);
  END LOOP;
  FOR entry IN SELECT * FROM (VALUES
    ('intel_companies','tally_company_id=ANY((SELECT dashboard_company_ids())::integer[])'),
    ('tally_source_snapshots','company_external_id IN (SELECT "ExternalID" FROM "Companies")'),
    ('tally_source_records','batch_id IN (SELECT batch_id FROM tally_source_snapshots)'),
    ('source_validation_issues','batch_id IN (SELECT batch_id FROM tally_source_snapshots)'),
    ('source_sync_items','company_external_id IN (SELECT "ExternalID" FROM "Companies")'),
    ('tally_diagnostics','company_external_id IN (SELECT "ExternalID" FROM "Companies") OR (company_external_id IS NULL AND batch_id IN (SELECT batch_id FROM tally_source_snapshots))'),
    ('intel_import_rows','import_batch_id IN (SELECT id FROM intel_import_batches)'),
    ('intel_ageing','outstanding_id IN (SELECT id FROM intel_outstanding)'),
    ('intel_exception_comments','exception_id IN (SELECT id FROM intel_exceptions)'),
    ('SyncLog','dashboard_site_enabled() AND site_id=dashboard_site_id()'),
    ('tally_uploads','false'), ('tally_upload_chunks','false'),
    ('tally_source_uploads','false'), ('tally_source_chunks','false'), ('intel_users','false')
  ) AS policies(name,expression) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',entry.name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',entry.name);
    EXECUTE format('CREATE POLICY dashboard_site_access ON %I USING (dashboard_unscoped() OR (%s))',entry.name,entry.expression);
  END LOOP;
  -- Shared reference definitions are readable, but sites cannot change global rules.
  FOREACH table_name IN ARRAY ARRAY['intel_source_systems','intel_rules','intel_column_maps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    predicate := 'company_id IN (SELECT id FROM intel_companies)';
    EXECUTE format('CREATE POLICY dashboard_site_read ON %I FOR SELECT USING (dashboard_unscoped() OR (%s) OR (company_id IS NULL%s))',table_name,predicate,
      CASE WHEN table_name='intel_source_systems' THEN '' ELSE ' AND (source_system_id IS NULL OR source_system_id IN (SELECT id FROM intel_source_systems))' END);
    EXECUTE format('CREATE POLICY dashboard_site_insert ON %I FOR INSERT WITH CHECK (dashboard_unscoped() OR (%s))',table_name,predicate);
    EXECUTE format('CREATE POLICY dashboard_site_update ON %I FOR UPDATE USING (dashboard_unscoped() OR (%s)) WITH CHECK (dashboard_unscoped() OR (%s))',table_name,predicate,predicate);
    EXECUTE format('CREATE POLICY dashboard_site_delete ON %I FOR DELETE USING (dashboard_unscoped() OR (%s))',table_name,predicate);
  END LOOP;
END $$;

ALTER TABLE source_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_sync_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY dashboard_site_read ON source_sync_runs FOR SELECT USING (
  dashboard_unscoped() OR (dashboard_site_enabled() AND
    (site_id=dashboard_site_id() OR run_id IN (SELECT run_id FROM source_sync_items))));
CREATE POLICY dashboard_site_insert ON source_sync_runs FOR INSERT WITH CHECK (
  dashboard_unscoped() OR (dashboard_site_enabled() AND site_id=dashboard_site_id()));
CREATE POLICY dashboard_site_update ON source_sync_runs FOR UPDATE USING (
  dashboard_unscoped() OR (dashboard_site_enabled() AND site_id=dashboard_site_id())) WITH CHECK (
  dashboard_unscoped() OR (dashboard_site_enabled() AND site_id=dashboard_site_id()));
CREATE POLICY dashboard_site_delete ON source_sync_runs FOR DELETE USING (
  dashboard_unscoped() OR (dashboard_site_enabled() AND site_id=dashboard_site_id()));

-- A view owner must not bypass the requesting connection's policies.
ALTER VIEW tally_source_latest SET (security_invoker=true);
ALTER VIEW finance_masters SET (security_invoker=true);
ALTER VIEW intel_current_outstanding SET (security_invoker=true);
ALTER VIEW intel_current_reconciliations SET (security_invoker=true);
ALTER VIEW intel_current_exceptions SET (security_invoker=true);
