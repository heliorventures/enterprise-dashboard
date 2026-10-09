# Angular intelligence consolidation implementation

Task 2 is implemented in `ui/src/app`. Existing user changes outside this ownership were preserved. No production build, commit, deployment, or live database mutation was performed.

## Result

- Outstanding uses applied search, server paging and company scope. Changing scope cancels previous summary, outstanding, ageing and reconciliation reads. Separate report/outstanding errors prevent a successful retry from hiding a report failure. Unloaded totals appear unavailable.
- Account details retain snapshot history, current/historical publication labels, ageing, exceptions and audit. Reporting dates, generation and Tally reference dates are visible. Import-file details cancel reused-route requests and progress reads, and show retained batch provenance.
- Exception queue uses true server paging and `{ items, total, page, pageSize }`, including entries beyond 500. Page/filter changes cancel prior reads. Decisions accept only resolution/rejection plus a comment; repeated submission is gated. The decision form appears beside the issue. A successful decision refreshes the authoritative page and count.
- Quality shows identifier/payment completeness counts and issue types. Audit supports entity filtering, explicit limits, recorded users/actions and before/after values.
- Outstanding, reconciliation, exceptions and quality download the complete server CSV with company/status/search scope. Exports never use the visible page as their source. Scope changes cancel pending exports, limits/errors remain visible, and object URLs are released after browser download initiation. Formula escaping and completeness limits remain API responsibilities.
- Mapping preview uses the selected account-name column; mapping changes invalidate validation. Processing is guarded against repeated submission and invalid validation. Ledger search cancellation, route changes and mapping saves use cancellable requests. Mapping decisions follow the new reconciliation generation ID returned by the API.
- Management report fallback-summary reads cancel when filters change. Daily, party and company drilldowns preserve voucher type and dates.
- Authenticated account, exception, quality and audit routes precede `imports/:id`; import navigation links expose the retained workflows.

## Verification

Authorized checks executed through `rtk`:

- Focused Angular run of `import-parity.spec.ts`, `import-workflows.spec.ts`, `report-view.spec.ts` and `latest-request.spec.ts`: 16 passed before the final refinements.
- Affected `import-parity.spec.ts` and `import-workflows.spec.ts` after the error-state and inline-decision refinements: 14 passed.
- Final `import-parity.spec.ts` after true exception paging: 9 passed. Its paging regression reaches exception 501 on page 11, checks server totals, and cancels an in-flight page 2 request.
- Final `rtk proxy npx tsc --noEmit -p tsconfig.app.json`: passed.
- Final `rtk git diff --check -- ui/src/app`: passed.

The Angular test harness compiled templates and ran mocked HTTP workflow checks. Browser visual acceptance and authenticated live API integration were not performed. The Angular skill's production-build recommendation is superseded by the explicit no-build task constraint.
