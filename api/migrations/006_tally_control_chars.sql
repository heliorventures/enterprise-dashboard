UPDATE "Ledgers"
SET "LedgerName" = replace("LedgerName", E'\x04', ''),
    "GroupCategory" = replace("GroupCategory", E'\x04', '')
WHERE "LedgerName" LIKE E'%\x04%' OR "GroupCategory" LIKE E'%\x04%';

UPDATE "Vouchers"
SET "VoucherType" = replace("VoucherType", E'\x04', ''),
    "Narration" = replace(replace("Narration", E'\x04', ''), E'\r', ''),
    "PartyLedgerName" = replace("PartyLedgerName", E'\x04', '')
WHERE "VoucherType" LIKE E'%\x04%'
   OR "Narration" LIKE E'%\x04%'
   OR "PartyLedgerName" LIKE E'%\x04%';
