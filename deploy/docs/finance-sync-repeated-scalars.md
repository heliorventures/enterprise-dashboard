# Finance Sync 1.3.1: repeated scalar export fields

Client evidence from 2026-09-18 confirmed that discovery returns one GUID and NAME per company, while the full company export returns two identical copies of each. Both requests succeed with HTTP 200 and return five companies. The full export's explicit FETCH fields plus wildcard produce repeated scalar nodes; the exporter previously returned null for any repeated field and then rejected the selected company with `Selected source company was not returned exactly once`.

Scalar resolution now accepts repeated leaf values only when all copies match exactly. Conflicting values and structured values remain invalid. No trimming, number coercion, first-value guessing or archived-tree rewriting is introduced. Business subcollections retain their original entries.

The change covers desktop capture/readiness and all backend consumers: archive company validation, period merge identities/dates, and financial projection. Backend consumers share `sourceTree.scalarField`. Deploy the updated API before distributing `Helior-Finance-Sync-1.3.1-Setup.exe`; an EXE-only update would leave the old backend rejecting the same records. No database migration or data deletion is required by this fix.

Regression coverage includes an anonymized five-company capture with repeated names/GUIDs, repeated dates/amounts/empty scalar balances, rejected conflicting or structured values, and unchanged raw nodes. Period replacement integration fixtures include repeated company/voucher scalars. The release simulator now returns all loaded company records and repeats scalar leaves for explicit-FETCH-plus-wildcard requests, including nested posting fields. This adds the real response pattern that the earlier synthetic tests did not represent.

Use the standard `desktop/finance-sync/scripts/release-test.ps1` gate after building. Its timestamped summary records the exact installer, source identity, database checks and end-to-end results. The client's actual accounting data still requires a controlled retry after API deployment and installation; local synthetic evidence does not establish live reconciliation.
