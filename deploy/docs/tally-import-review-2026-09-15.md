# Tally import review — 15 September 2026

## Scope and evidence

Reviewed the exporter, archived source representation, financial validation, import history, and funding calculations. Queried `enterprise_dashboard` through the existing localhost:5434 tunnel with PostgreSQL `default_transaction_read_only=on`, confirmed by the database. No database writes, migrations, promotions, deployments, or application-code changes were performed.

The latest recorded dashboard run is run 5, started 15 September at 14:14:49 IST: five companies processed, zero promoted, five failed. This matches the supplied screenshots. The working tree contains existing unrelated changes, which were preserved.

## 1. New exports contain amounts but hit validator defects

| Latest complete export | Ledgers with closing-balance field | Vouchers with amount and accounting-entry fields | Empty inventory placeholders |
| --- | ---: | ---: | ---: |
| HOMECRAFT ENTERPRISES, 15 September | 231 / 231 | 87 / 87 | 87 |
| Mr. VPP (Individual), 15 September | 2,817 / 2,817 | 1,393 / 1,393 | 1,393 |

Homecraft batch: `e1326b01-ed0d-4561-90c1-6df9a55a3370`.

Mr. VPP batch: `ffe3cf51-56c7-42f8-b2f6-3f39923fab86`.

### Empty inventory lists are incorrectly treated as movements

Every voucher in both batches contains an `ALLINVENTORYENTRIES.LIST` node with no attributes and only whitespace content. Example:

```json
{"tag":"ALLINVENTORYENTRIES.LIST","content":["     "],"attributes":{}}
```

`api/src/sourceModels.js:454` iterates these nodes as actual inventory entries. This generates one `UNKNOWN_STOCK_ITEM` error and one `MISSING_INVENTORY_AMOUNT` warning per voucher, although there is no inventory movement in that node. Both companies exported zero stock-item masters.

Homecraft's complete archived records were replayed through the existing pure projection functions without invoking ingestion: all 231 ledgers and 87 vouchers passed core financial parsing, and all 87 voucher amounts were nonzero. The projection reproduced the logged defects. A bounded Mr. VPP sample parsed to amount `-100000.00` and contained two accounting postings. Presence of the financial fields was checked across its entire batch; full-batch local replay was not completed because transferring its full payload exceeded the query timeout.

### Six predefined voucher types are incorrectly reported as cycles

The source records use the same name and parent for these predefined types:

- Job Work In Order
- Job Work Out Order
- Material In
- Material Out
- Rejections In
- Rejections Out

They are absent from `BASE_TYPES` in `api/src/sourceModels.js:48`. The resolver at line 213 follows their self-parent reference and emits `PARENT_CYCLE`. Each company in the latest five-company run has six such errors.

These are documented predefined Tally inventory/order types: [Tally's predefined inventory vouchers](https://help.tallysolutions.com/docs/te9rel52/Voucher_Entry/Inventory_Vouchers/Predefined_Inventory_Vouchers_in_TallyERP.htm).

Repair must recognize supported native roots while continuing to reject actual cycles in custom hierarchies. Empty-list handling must distinguish a truly empty placeholder from an incomplete but populated movement; it must not suppress real missing-stock-item errors.

### Issue totals count warnings and repeat attempts

| Company | Findings per attempt | Breakdown | Attempts | Displayed total |
| --- | ---: | --- | ---: | ---: |
| Homecraft | 181 | 87 inventory errors + 87 inventory warnings + 6 cycle errors + 1 currency warning | 2 | 362 |
| Mr. VPP | 2,793 | 1,393 inventory errors + 1,393 inventory warnings + 6 cycle errors + 1 currency warning | 2 | 5,586 |

These totals are not counts of distinct invalid financial records. The database stores each validation attempt separately.

## 2. Three Solvian companies still use September 12 exports without amounts

| Company | Ledgers missing closing balance | Vouchers missing amount and accounting entries |
| --- | ---: | ---: |
| SOLVIAN BUILDCON LLP | 375 / 375 | 505 / 505 |
| SOLVIAN INFRA AND AGRO LLP | 510 / 510 | 2,483 / 2,483 |
| SOLVIAN INFRASTRUCTURE AND PROJECTS LLP | 28 / 28 | 35 / 35 |

These companies have no newer complete export in the database. The field absence was verified directly in all archived records for these collections, not inferred only from the error messages.

The old `deploy/bundles/tally-008/FinanceTallyAgent/source-export.js` requests only `FETCH *`. The current `deploy/tally-agent/source-export.js` explicitly requests closing balances, voucher amounts and accounting entries. The local desktop ASAR's exporter matches the current source. Archived manifests do not retain an exporter build identifier, so the exact client executable used cannot be proven from the database alone.

These older archives require a fresh client export. Dashboard Sync Tally revalidates saved source batches; it does not call the client's Tally installation to obtain missing fields.

## 3. Why old imports passed and the dashboard shows zeros

Commit `0d6a79f` accepted a missing voucher amount/entry list as `0.00` and substituted opening balance for missing ledger closing balance. Commit `d4861c2` removed those behaviors on September 13. The current validation correctly blocks these incomplete amounts before updating reporting tables.

The database shows all 3,110 imported client vouchers in legacy reporting have amount zero: Homecraft 87, Buildcon 505, Infra and Agro 2,483, Infrastructure and Projects 35. Consultancy has no reporting vouchers. These rows were imported on September 13 from September 12 captures. All 1,547 ledger rows joined by source/company/name in the provenance query matched the archived opening balance numerically; one additional Homecraft row did not join on the simple name comparison and was not included in that assertion.

No company currently has a row in `finance_snapshots`. The newer validated reporting projection has therefore not been published. Existing dashboard balances must not be described as verified current closing balances. Mr. VPP has source archives but no reporting company row because its initial promotion failed.

## 4. Exact cause of Buildcon's ₹13,491.17 spending estimate

The only nonzero Buildcon ledger selected by the dashboard's expense fallback is:

| Ledger | Immediate group | Stored balance |
| --- | --- | ---: |
| Provision for Expenses | Provision for Expenses (G) | ₹80,947.00 |

The archived group chain is `Provision for Expenses (G) → Provisions → Current Liabilities`; `ISREVENUE` is `No`. This is a liability provision, not an expense account. Its stored balance equals its archived opening balance.

With no validated hierarchy facts, `api/src/dashboardService.js:57` falls back to matching `%Expense%` in the immediate group name. That wrongly counts this provision as expense. `api/src/funds.js:71` divides the selected balance by six elapsed financial-year months in September:

`₹80,947.00 / 6 = ₹13,491.17` after rounding.

The other client companies have zero balance under that same expense-name selection, so their fallback spending estimate is zero. These zeros do not establish an absence of actual spending. Buildcon's nonzero number does not establish a successful voucher import.

The screenshot also includes `TEST - Finance Sync`. Its three nonzero vouchers and ₹7,500 spending estimate contribute to the combined total. Client reporting should explicitly exclude test data through an agreed configuration/filter; no test rows were deleted or disabled during this review.

## 5. Partial exports and currency gaps

- SOLVIAN CONSULTANCY LLP: latest archived capture is partial, September 12; ledger collection succeeded but voucher collection failed. The historical importer nevertheless imported its ledgers. Current promotion excludes partial captures.
- Phadnis Infrastructures: September 15 capture is partial; both ledger and voucher collections failed. Zero validation issues means financial validation did not run, not that the export succeeded.
- All five companies in run 5 have `MISSING_CURRENCY` warnings. The projection expects company `CURRENCYNAME`; Homecraft's archived company object does not contain it. Explicit company currency export/mapping must be verified against the source, rather than assuming INR from the UI symbol. This warning is separate from the blocking errors.
- The archived collection manifest stores failed status/count but not the original HTTP/XML failure diagnostic. Determining the exact Phadnis and Consultancy export failure requires the client's corresponding `state/logs/*.jsonl` entries (`source_collection_failed` / `tally_export_failed`). The database alone cannot establish their transport/parser errors.

## Recommended repair and verification sequence

1. Correct the projection's empty-list semantics and native voucher-type root recognition. Add regression cases for the observed source shapes and for populated malformed inventory and real custom cycles.
2. Fix expense classification to use verified account hierarchy. Treat missing financial coverage as unavailable; do not present a liability balance or zero-filled historical import as actual spending.
3. Replay the saved Homecraft and Mr. VPP batches through validation without writes. Verify all financial and hierarchy checks, currency limitations, and expected changes before publishing.
4. Obtain fresh complete exports for the three Solvian companies with missing fields. Diagnose the original client logs for Consultancy and Phadnis, then obtain complete captures for them too.
5. Confirm currency and accounting period, then compare resulting balances and voucher totals with Tally reports for the same company and period. Successful schema validation alone is not an accounting reconciliation.
6. Publish only validated company snapshots through the normal transaction-based importer under separate authorization. Preserve raw archives and validation history. Verify the final company rows and combined totals with test data excluded.

Review completed without changing application code or production data. Corrections and reimports described above are recommendations, not completed actions.

## Implementation follow-up — 15 September

After approval, implemented these application changes:

- Shared empty-list recognition for financial parsing and reporting projection. Whitespace-only list placeholders (including XML list metadata) are ignored. Populated malformed entries and business attributes remain subject to validation. Empty preferred lists no longer hide valid alternative accounting/inventory lists, and empty batch lists no longer replace a parent inventory amount.
- Added the six observed predefined voucher types to native-root recognition. Custom self-cycles and multi-node cycles still fail validation.
- Dashboard and expense reports now share exact expense-root classification. Custom names containing “Expense” or “Purchase” do not establish an accounting classification; a resolved expense hierarchy does. Liability provisions no longer enter spending estimates.
- All companies require a validated published snapshot for spending and forecasts. A combined model is unavailable if any included company lacks that validation. There is no exemption for older or direct imports. This flag does not establish accounting reconciliation or currency compatibility.
- Funding types, money formatting, budget arithmetic, assessment copy, and forecast presentation preserve unavailable values rather than rendering them as zero.
- Added `api/scripts/validate-source-readonly.js` for paged, read-only validation of saved batches. It invokes parsing/projection only, never promotion, and PostgreSQL enforces read-only access.

### Saved-source verification with the corrected validator

| Batch | Valid ledgers | Valid vouchers (all nonzero) | Accounting postings | Blocking errors |
| --- | ---: | ---: | ---: | ---: |
| Homecraft, September 15 | 231 | 87 | 229 | 0 |
| Mr. VPP, September 15 | 2,817 | 1,393 | 3,213 | 0 |

Each batch retains one `MISSING_CURRENCY` warning. No source values were changed or published. The full Mr. VPP replay completed using bounded pages; this supersedes the initial review's full-payload timeout limitation.

The September 12 Infrastructure and Projects batch still fails: 28 ledgers lack closing balances and 35 vouchers lack amounts/entries. Real missing financial data remains blocked.

A read-only call to the changed dashboard service against the live database returned zero expense-classified balance for Buildcon, unavailable spending/forecasts for the five legacy archived companies, and an unavailable combined budget. Its ₹80,947 liability provision no longer produces ₹13,491.17 of estimated spending.

### Release boundary

Validation: 32 focused API tests passed (three disposable-database tests skipped), all 56 UI tests passed, and the Angular production build passed. Independent code review found no blocking issue. The additional read-only SQL fixture regression is present in `api/test/dashboardFinancials.test.js`; its execution was blocked when the tunnel closed again. The live dashboard query and the source replays above completed before that disconnection. No signed-in browser acceptance or production publication test was performed.

API and UI deployment, publishing the validated saved batches, fresh client captures for old/partial archives, currency confirmation, and reconciliation to Tally are still pending. No commit or production data write was performed. Deploy the matching API/UI changes before evaluating dashboard behavior; existing database validation history remains historical until another authorized validation/promotion attempt.

To revalidate an archived batch without writing, run from `api`:

```powershell
node scripts/validate-source-readonly.js e1326b01-ed0d-4561-90c1-6df9a55a3370
node scripts/validate-source-readonly.js ffe3cf51-56c7-42f8-b2f6-3f39923fab86
```

The script reads the existing database configuration and prints only validation summaries. It does not save source payloads to disk.

### Testing-phase reset policy

The user clarified that this is a test environment and old data may be cleared and reloaded. Removed automatic forced replay of old ingestion receipts into a newer projection; only an explicit force request can force an import. Removed the dashboard exception for imports without a published snapshot. Corrected exports and validated publication are the single reporting contract.

After this simplification, 33 API regression tests passed with three disposable-database tests skipped. A new regression confirms ordinary publishing does not implicitly force an old receipt. The SQL fixture now expects an unpublished direct import to be unavailable too.

Reset and reload have not run. The database tunnel is refusing connections, and the choice of preserving all saved exports versus deleting old/failed archives is pending. Homecraft and Mr. VPP's September 15 exports can be reloaded after reset; the remaining old/partial captures still need fresh data from Tally.

### Reset executed after scope clarification — 15 September, 15:57 IST

The user authorized clearing reporting data while reusing the saved exports and preserving reporting capabilities. The tunnel became available, and the read-only PostgreSQL fixture test passed with the single published-snapshot rule.

Cleared 1,553 ledger rows, 3,113 voucher rows, and seven ingestion receipts in one transaction. All generated finance projection/master tables were already empty and remain empty. The reset took the ingestion/archive advisory locks, refused any running sync, used explicit table targets without CASCADE, and verified the result before committing.

Preserved all six company records, four project records, 13 saved exports, and 10,110 archived source records. Sync/validation history, schemas, views, report definitions, report pages, filters and drill-down features were not deleted. The user will trigger the reload; no sync or deployment was started by this reset.

A verified local JSON backup of the cleared tables is stored in the git-ignored path `deploy/tally-agent/state/reset-backups/reporting-before-reset-2026-09-15T10-27-05-272Z.json`. It contains financial data and must remain out of source control.

Deploy the corrected API/UI before rerunning dashboard Sync Tally. Homecraft and Mr. VPP's saved exports pass financial validation (with the previously noted currency warning). The other saved exports cannot populate complete reports because they lack required financial fields or have failed collection captures; resetting does not manufacture those fields. Report capability is preserved independently of whether a company currently has sufficient data.
