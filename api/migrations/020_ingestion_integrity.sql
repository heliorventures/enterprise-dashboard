-- minimum-reader: 19
-- Preserve existing source identities while allowing the full accepted names and voucher fields.
ALTER TABLE "Ledgers" ALTER COLUMN "SourceKey" TYPE text;
ALTER TABLE "Vouchers" ALTER COLUMN "SourceKey" TYPE text;
ALTER TABLE "Projects" ALTER COLUMN "SourceKey" TYPE text;
