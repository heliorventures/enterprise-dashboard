-- Dedicated company-scoped entities. Preserve old readers through a read-only UNION view.
ALTER TABLE finance_masters RENAME TO finance_masters_previous;

CREATE TABLE account_groups (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  resolved_root text GENERATED ALWAYS AS (properties->>'resolvedRoot') STORED,
  parent_source_key text,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE account_groups ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE account_groups ADD CONSTRAINT account_groups_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO account_groups(company_id,source_key,name,parent_name,properties,batch_id,ordinal) SELECT company_id,source_key,name,parent_name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='GROUP';

CREATE TABLE voucher_types (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  resolved_root text GENERATED ALWAYS AS (properties->>'resolvedRoot') STORED,
  parent_source_key text,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE voucher_types ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE voucher_types ADD CONSTRAINT voucher_types_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO voucher_types(company_id,source_key,name,parent_name,properties,batch_id,ordinal) SELECT company_id,source_key,name,parent_name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='VOUCHERTYPE';

CREATE TABLE currencies (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  decimal_places integer GENERATED ALWAYS AS (CASE WHEN properties->>'DECIMALPLACES' ~ '^[0-9]$' THEN (properties->>'DECIMALPLACES')::integer END) STORED,
  formal_name text GENERATED ALWAYS AS (properties->>'FORMALNAME') STORED,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE currencies ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE currencies ADD CONSTRAINT currencies_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO currencies(company_id,source_key,name,properties,batch_id,ordinal) SELECT company_id,source_key,name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='CURRENCY';

CREATE TABLE cost_categories (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE cost_categories ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE cost_categories ADD CONSTRAINT cost_categories_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO cost_categories(company_id,source_key,name,properties,batch_id,ordinal) SELECT company_id,source_key,name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='COSTCATEGORY';

CREATE TABLE cost_centres (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  category_name text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  parent_source_key text,
  category_source_key text,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE cost_centres ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE cost_centres ADD CONSTRAINT cost_centres_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO cost_centres(company_id,source_key,name,parent_name,category_name,properties,batch_id,ordinal) SELECT company_id,source_key,name,parent_name,category_name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='COSTCENTRE';

CREATE TABLE stock_groups (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  parent_source_key text,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE stock_groups ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE stock_groups ADD CONSTRAINT stock_groups_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO stock_groups(company_id,source_key,name,parent_name,properties,batch_id,ordinal) SELECT company_id,source_key,name,parent_name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='STOCKGROUP';

CREATE TABLE stock_categories (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  parent_source_key text,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE stock_categories ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE stock_categories ADD CONSTRAINT stock_categories_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO stock_categories(company_id,source_key,name,parent_name,properties,batch_id,ordinal) SELECT company_id,source_key,name,parent_name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='STOCKCATEGORY';

CREATE TABLE stock_items (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  category_name text,
  base_units text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  group_source_key text,
  category_source_key text,
  unit_source_key text,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE stock_items ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO stock_items(company_id,source_key,name,parent_name,category_name,base_units,properties,batch_id,ordinal) SELECT company_id,source_key,name,parent_name,category_name,base_units,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='STOCKITEM';

CREATE TABLE units (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  decimal_places integer GENERATED ALWAYS AS (CASE WHEN properties->>'DECIMALPLACES' ~ '^[0-9]$' THEN (properties->>'DECIMALPLACES')::integer END) STORED,
  formal_name text GENERATED ALWAYS AS (properties->>'FORMALNAME') STORED,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE units ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE units ADD CONSTRAINT units_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO units(company_id,source_key,name,properties,batch_id,ordinal) SELECT company_id,source_key,name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='UNIT';

CREATE TABLE godowns (
  company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
  source_key text NOT NULL,
  name text NOT NULL,
  parent_name text,
  properties jsonb NOT NULL DEFAULT '{}',
  batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
  ordinal integer NOT NULL,
  parent_source_key text,
  PRIMARY KEY(company_id,source_key)
);

ALTER TABLE godowns ADD name_key text GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE godowns ADD CONSTRAINT godowns_company_name UNIQUE(company_id,name_key) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO godowns(company_id,source_key,name,parent_name,properties,batch_id,ordinal) SELECT company_id,source_key,name,parent_name,properties,batch_id,ordinal FROM finance_masters_previous WHERE collection='GODOWN';

UPDATE account_groups m SET parent_source_key=t.source_key FROM account_groups t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.parent_name);


UPDATE voucher_types m SET parent_source_key=t.source_key FROM voucher_types t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.parent_name);


UPDATE cost_centres m SET parent_source_key=t.source_key FROM cost_centres t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.parent_name);


UPDATE cost_centres m SET category_source_key=t.source_key FROM cost_categories t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.category_name);


UPDATE stock_groups m SET parent_source_key=t.source_key FROM stock_groups t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.parent_name);


UPDATE stock_categories m SET parent_source_key=t.source_key FROM stock_categories t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.parent_name);


UPDATE stock_items m SET group_source_key=t.source_key FROM stock_groups t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.parent_name);


UPDATE stock_items m SET category_source_key=t.source_key FROM stock_categories t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.category_name);


UPDATE stock_items m SET unit_source_key=t.source_key FROM units t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.base_units);


UPDATE godowns m SET parent_source_key=t.source_key FROM godowns t WHERE t.company_id=m.company_id AND lower(t.name)=lower(m.parent_name);


-- Flush deferred uniqueness checks from backfill before adding foreign keys.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE account_groups ADD FOREIGN KEY(company_id,parent_source_key) REFERENCES account_groups(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE voucher_types ADD FOREIGN KEY(company_id,parent_source_key) REFERENCES voucher_types(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE cost_centres ADD FOREIGN KEY(company_id,parent_source_key) REFERENCES cost_centres(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE cost_centres ADD FOREIGN KEY(company_id,category_source_key) REFERENCES cost_categories(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE stock_groups ADD FOREIGN KEY(company_id,parent_source_key) REFERENCES stock_groups(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE stock_categories ADD FOREIGN KEY(company_id,parent_source_key) REFERENCES stock_categories(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE stock_items ADD FOREIGN KEY(company_id,group_source_key) REFERENCES stock_groups(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE stock_items ADD FOREIGN KEY(company_id,category_source_key) REFERENCES stock_categories(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE stock_items ADD FOREIGN KEY(company_id,unit_source_key) REFERENCES units(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE godowns ADD FOREIGN KEY(company_id,parent_source_key) REFERENCES godowns(company_id,source_key) DEFERRABLE INITIALLY DEFERRED;
SET CONSTRAINTS ALL DEFERRED;

CREATE VIEW finance_masters AS
SELECT company_id,'GROUP'::text collection,source_key,name,parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM account_groups
UNION ALL
SELECT company_id,'VOUCHERTYPE'::text collection,source_key,name,parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM voucher_types
UNION ALL
SELECT company_id,'CURRENCY'::text collection,source_key,name,NULL::text parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM currencies
UNION ALL
SELECT company_id,'COSTCATEGORY'::text collection,source_key,name,NULL::text parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM cost_categories
UNION ALL
SELECT company_id,'COSTCENTRE'::text collection,source_key,name,parent_name,category_name,NULL::text base_units,properties,batch_id,ordinal FROM cost_centres
UNION ALL
SELECT company_id,'STOCKGROUP'::text collection,source_key,name,parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM stock_groups
UNION ALL
SELECT company_id,'STOCKCATEGORY'::text collection,source_key,name,parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM stock_categories
UNION ALL
SELECT company_id,'STOCKITEM'::text collection,source_key,name,parent_name,category_name,base_units,properties,batch_id,ordinal FROM stock_items
UNION ALL
SELECT company_id,'UNIT'::text collection,source_key,name,NULL::text parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM units
UNION ALL
SELECT company_id,'GODOWN'::text collection,source_key,name,parent_name,NULL::text category_name,NULL::text base_units,properties,batch_id,ordinal FROM godowns;

DROP TABLE finance_masters_previous;

CREATE INDEX finance_ledger_name_folded ON finance_ledger_facts(company_id,lower(name));
CREATE INDEX finance_postings_period ON finance_postings(company_id,voucher_date,voucher_key,entry_index);
CREATE INDEX finance_inventory_period ON finance_inventory_movements(company_id,voucher_date,voucher_key,movement_index);
CREATE INDEX finance_allocations_centre ON finance_allocations(company_id,centre_name,voucher_key,entry_index,allocation_index);
CREATE INDEX source_archive_received ON tally_source_snapshots(received_at DESC,batch_id DESC);
CREATE INDEX source_sync_items_batch_latest ON source_sync_items(batch_id,item_id DESC);
CREATE TABLE finance_monthly_summaries (
 company_id integer NOT NULL REFERENCES "Companies"("CompanyID"),
 kind text NOT NULL CHECK(kind IN ('posting','allocation','inventory')),
 month date NOT NULL CHECK(extract(day from month)=1),
 name text NOT NULL,
 category_name text NOT NULL DEFAULT '',
 amount numeric,
 count bigint NOT NULL,
 valued bigint NOT NULL,
 batch_id varchar(200) NOT NULL REFERENCES tally_source_snapshots(batch_id),
 PRIMARY KEY(company_id,kind,month,name,category_name)
);
CREATE FUNCTION refresh_finance_summaries(company integer, batch varchar) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM finance_monthly_summaries WHERE company_id=company;
 INSERT INTO finance_monthly_summaries
 SELECT company,'posting',date_trunc('month',p.voucher_date)::date,'Bank and cash','',sum(p.amount),count(*),count(p.amount),batch
 FROM finance_postings p JOIN finance_ledger_facts l ON l.company_id=p.company_id AND lower(l.name)=lower(p.ledger_name)
 WHERE p.company_id=company AND lower(l.root_group) IN ('bank accounts','cash-in-hand','bank od a/c','bank occ a/c')
 GROUP BY date_trunc('month',p.voucher_date);
 INSERT INTO finance_monthly_summaries
 SELECT company,'allocation',date_trunc('month',p.voucher_date)::date,a.centre_name,coalesce(a.category_name,''),sum(a.amount),count(*),count(a.amount),batch
 FROM finance_allocations a JOIN finance_postings p USING(company_id,voucher_key,entry_index)
 WHERE a.company_id=company GROUP BY date_trunc('month',p.voucher_date),a.centre_name,coalesce(a.category_name,'');
 INSERT INTO finance_monthly_summaries
 SELECT company,'inventory',date_trunc('month',voucher_date)::date,stock_item,'',sum(amount),count(*),count(amount),batch
 FROM finance_inventory_movements WHERE company_id=company GROUP BY date_trunc('month',voucher_date),stock_item;
END $$;
ANALYZE finance_ledger_facts;
ANALYZE finance_postings;
ANALYZE finance_allocations;
ANALYZE finance_inventory_movements;
SELECT refresh_finance_summaries(company_id,batch_id) FROM finance_snapshots;
UPDATE finance_snapshots SET model_version=2;
