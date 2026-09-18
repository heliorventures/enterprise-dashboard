# Finance Sync 1.4.0: custom months and ledger batches

Custom month range accepts inclusive start/end months, for example January 2021
through August 2026. The desktop validates both months before starting a worker.
The existing period-replacement API receives 2021-01-01 through 2026-08-31. Tally
vouchers outside that range and manual Finance entries remain untouched. No new
backend API or database migration is required beyond the existing period API.

Today and custom ranges filter vouchers, not master creation dates. Old accounts
can still be referenced by new vouchers. Ledger masters keep the existing full
balance context and are now fetched as a lightweight MasterID list, followed by
sequential detail requests for at most 100 discovered IDs. Each numeric range is
checked against its expected identity set; missing, extra or repeated identities
abort the capture. A final lightweight discovery verifies the set is unchanged.
The existing company consistency check still applies. There is no unbatched
fallback or automatic retry when batching fails.

Every request uses the existing cancellable 500 ms pause. The UI reports ledger
batch progress. Stop cancels our request/worker; Tally may continue work it already
accepted. Batching bounds the requested record count, not the cost of calculating
one ledger or Tally's internal scan. This is not a guarantee against Tally crashes.

Tests cover month boundaries/leap years, invalid ranges, bounded ledger requests,
missing/duplicate/changed identities, Stop, and capture rejection after an
incomplete batch. Packaged smoke covers the month controls; the release gate adds
custom-range replacement against the isolated API/database. Real-client ledger
filter compatibility, Tally responsiveness and reconciliation still need a
controlled one-company retry after installation.

TDL references used for the filtering approach:
- https://help.tallysolutions.com/objects-and-collections/
- https://help.tallysolutions.com/sample-xml/
