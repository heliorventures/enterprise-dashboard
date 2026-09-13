UPDATE "Ledgers"
SET "LedgerName" = btrim("LedgerName"),
    "GroupCategory" = btrim("GroupCategory")
WHERE "LedgerName" <> btrim("LedgerName") OR "GroupCategory" <> btrim("GroupCategory");

UPDATE "Vouchers"
SET "VoucherType" = btrim("VoucherType"),
    "Narration" = btrim("Narration"),
    "PartyLedgerName" = btrim("PartyLedgerName")
WHERE "VoucherType" <> btrim("VoucherType")
   OR "Narration" <> btrim("Narration")
   OR ("PartyLedgerName" IS NOT NULL AND "PartyLedgerName" <> btrim("PartyLedgerName"));
