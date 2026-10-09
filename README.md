# Enterprise dashboard

Multi-company finance dashboard, ledger browser and transaction day book. Built with Angular 21 / TypeScript, Node.js / Express 5 and PostgreSQL.

Excel Intelligence is part of this application: one API in `api`, one Angular UI in `ui`, and one PostgreSQL database. Open **Excel imports** for workbook validation, import history, current outstanding/ageing, Tally reconciliation, exception decisions, data quality and audit history. All database changes live in `api/migrations` and run with `npm run migrate` from `api`.

Outstanding workbooks represent full company snapshots. A successful newer report replaces the company's current view while preserving earlier generations; retries do not add the same balances again. Reconciliation requires a proven matching Excel/Tally balance date. See [Intelligence workflow and data rules](docs/intelligence/README.md).

A separate service on the Tally server sends complete company snapshots to the authenticated ingestion API. The application stores and displays those snapshots; it does not require the VPS to contact Tally.

- [Technology, business review and deployment runbook](deploy/README.md)
- [Tally sender API contract](deploy/docs/tally-ingestion.md)
- [Implementation design](deploy/docs/deployment-plan.md)
- [Validation results and remaining acceptance](deploy/docs/validation.md)

Deployment uses the existing VPS PostgreSQL container and Caddy network. PowerShell scripts build and upload versioned Docker images, run migrations and health checks, and archive previous successful releases. Complete the one-time setup in the runbook before running a deployment.
