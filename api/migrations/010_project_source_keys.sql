ALTER TABLE "Projects" ADD COLUMN IF NOT EXISTS "SourceKey" varchar(200);

UPDATE "Projects"
SET "SourceKey" = 'project:' || lower("ProjectName")
WHERE "SourceKey" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_company_source_key
  ON "Projects" ("CompanyID", "SourceKey")
  WHERE "SourceKey" IS NOT NULL;
