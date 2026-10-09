# Durable intelligence backend implementation

Task 1 is implemented and verified against the dedicated disposable PostgreSQL database. The final focused intelligence command passed **46 tests, zero failures, zero skips**, including ten PostgreSQL behavior subtests and legacy migration adoption checks. No production database changes, builds, deployment, or commits occurred.

## Publication and ownership

Migration `019_intelligence_publication.sql` adds immutable import generations, frozen inputs, reporting and archived Tally dates, lease identity/heartbeat, a selected batch pointer for retry identity, and a company publication pointer. Composite foreign keys bind files, batches, reconciliations, outstanding rows and publication pointers to their company or owning file. Legacy rows and tracker evidence remain available; unowned legacy Tally-only rows receive no invented generation.

PostgreSQL file locks reserve jobs. Company advisory locks are acquired before file locks by processing and mapping mutations, preventing overlapping company publication and concurrent mapping invalidation deadlocks. Ordinary retries select an existing successful generation; explicit reprocessing creates a new generation. Publication uses one pinned transaction for accounts, source rows, outstanding, ageing, reconciliation, exceptions, completion and publication pointer. Failures roll back staged financial writes and leave the previous current publication intact.

Stale jobs are recovered during progress reads and new claims. Progress recovery uses `FOR UPDATE SKIP LOCKED` on the file and cannot reclaim a worker holding its publication lock. The owner token is checked again before publishing. Archival reference reads reuse the claim's transaction client, avoiding nested pool acquisition under concurrent workers.

## Financial inputs and reconciliation

Sparse worksheet rows retain physical row numbers. Strict dates reject rollover and trailing text; reporting-period parsing supports complete ISO dates without matching fragments. Classification uses financial-cell presence rather than successful number parsing, and repeats classification against resolved mappings before staging. Invalid and unnamed financial rows therefore cannot disappear into group or ignored rows.

Full-snapshot validation rejects duplicate account names, duplicate scalar mapping targets, missing required fields, invalid values and configured total mismatches. Exact cents arithmetic supplies monetary parsing, outstanding formulas, totals, differences, tolerances and report totals. Presentation percentages alone use floating-point arithmetic. Company mappings override global mappings and explicit null mappings remain deliberate ignores. Mapping edits invalidate affected stored validation.

Tally reference dates come from the selected archive manifest's `dateContext.ledgers.to`. Proven balances come from `finance_ledger_facts.closing_balance` for that archive batch; mutable `Ledgers.CurrentBalance` supplies no certified archived amount. Unknown or different dates yield `COMPARISON_UNAVAILABLE` and null financial differences. Manual ledger reservations run before automatic matching, and duplicate manual ownership is rejected.

Manual corrections publish a new generation in the same transaction as the mapping decision, exceptions and Tally-only membership. Corrections retain the previous generation's frozen financial mappings, rows, rules and archived Tally reference. Older decisions and exception comments remain historical.

## Read contracts

Current outstanding, reconciliation and exception views select only the company's publication. Older and undated imports remain history and cannot replace a dated current snapshot. Legacy current comparison projections withhold matching certification and financial differences while preserving original base-table history. Current account-history rows use the same safe comparison projection.

Compound dashboard, list/count, quality, account and reconciliation detail reads use repeatable read snapshots. Company gap totals include Tally-only rows independently of outstanding joins. Reconciliation provenance survives Tally-only rows. Exception queues use real server paging, and internal export array reads honor the explicit 10,001-row overflow check. Reconciliation paging uses the shared 500-row maximum consistently for LIMIT, offset and response metadata.

## Verification

Final command:

```powershell
rtk proxy powershell -NoProfile -File api/scripts/test-intelligence.ps1
```

This helper pins the dedicated loopback PostgreSQL test database and does not inherit application database credentials. Final result: **46/46 passed**, approximately 57 seconds. PostgreSQL cases verify six simultaneous process calls against the five-client pool; idempotency and successful retry after failed reprocessing; exact large balances; archived provenance despite mutable ledger changes; current versus older/undated history; publication failure rollback; immutable corrections despite intervening financial mapping/rule edits; duplicate manual ownership; polling recovery; malformed/unnamed workbook rejection; exception paging beyond 500 rows; legacy comparison suppression; compound report consistency during a concurrent publication; and concurrent mapping invalidation.

Canonical migrations 001 through 019 were applied successfully after resetting only the disposable test schema while the new, undeployed migration was still being finalized. Migration adoption tests use their own isolated schemas and verify preservation of legacy rows, historical tracker identities, idempotency and checksum protection. The standalone sample workbook regressions now assert exact decimal values and explicit date provenance.

The independent consolidation reviewer reported all ten scoped findings addressed, with no remaining important source finding. Syntax checks passed for the changed services and provider. These checks prove local source, HTTP and disposable database behavior; browser acceptance and actual VPS/container startup remain outside this task's verification.
