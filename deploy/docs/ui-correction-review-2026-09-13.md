# UI correction review — 13 September 2026

This review follows the production screenshots showing operational diagnostics ahead of financial indicators, oversized actions, unstyled month fields, and a reported logout on browser refresh. Earlier build/test results did not establish visual acceptance.

## Implemented

- Session restoration no longer starts HTTP work from the Auth constructor. Route guards share one in-flight restoration request. Responses from an older login/session attempt cannot clear the newer session. An expired protected request clears client authentication without sending a logout request that could erase a newer cookie. Explicit sign-out still calls the logout API. Connection failures show a retry action instead of being presented as invalid credentials.
- A reusable `PageDrawer` opens from the right for Overview and report filters/information. Ledger and transaction filters use the same drawer through `FilterPanel`. Native modal dialog behavior provides the browser's focus containment; application handlers cover Escape, backdrop dismissal, focus return and navigation. Query changes keep the drawer mounted; leaving the page dismisses it.
- Overview starts with six compact indicators and charts for liquidity and company results. Management attention follows. Funding models, the original multi-series company comparison, account/group/project tables and drill-down links remain accessible in a collapsed detail section.
- Reporting-model, currency and posting-coverage diagnostics moved to Data operations. They remain available through `SourceCoverage`. Source financial analysis remains on Reports.
- Report month controls use the shared styled field system inside the drawer. Selected company and analysis period remain visible outside it. The period controls explicitly state which analysis they affect; they do not pretend to re-date closing ledger balances or legacy expense summaries.
- The duplicate Refresh analysis action was removed. The Reports page Refresh also reloads source analysis. Data operations Refresh status reloads coverage and investigation lists.
- Shared buttons now default to their content width. Ledger and transaction Export actions remain visible outside the drawer.

## Verification

- Before correction, authentication regression tests failed on overlapping session reads and an old response clearing a successful login. The filter regression failed because no drawer trigger existed.
- `npm test -- --watch=false`: **50 tests passed across 16 files**. Coverage includes real Auth/interceptor integration, expired and unavailable sessions, stale responses, explicit sign-out, drawer dismissal/draft retention/navigation, report-period form submission, the single report Refresh, executive content order, and existing finance/drill-down behavior.
- `npm run build`: **passed**, initial bundle 437.14 kB (estimated transfer 110.24 kB). This build includes the final relocation of Export actions.
- `git diff --check`: passed.

## Evidence limits and release acceptance

No browser was connected to the available browser runtime. The drawer interaction tests use jsdom substitutes for native dialog methods. Desktop/mobile visual layout, native focus trapping, date-picker appearance and production-cookie persistence have **not** received browser sign-off. These remain acceptance checks, not claims established by the build.

For browser acceptance, use desktop and narrow mobile widths: sign in and reload a protected URL; open/close each drawer with mouse and keyboard; change company and analysis period; verify visible scope and retained drafts; use Refresh and Export; inspect financial indicators/charts, negative/missing amounts, preserved detail sections, and Data operations coverage. Confirm no page-level horizontal overflow or persistent mobile navigation overlay.

No financial formulas, imported records, database migrations, backend/export implementation or production deployment were changed in this correction. Live Tally export and database reconciliation were not run. Changes are uncommitted for review; the existing `deploy/api.env.example` edit was left untouched.
