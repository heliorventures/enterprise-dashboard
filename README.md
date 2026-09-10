# Enterprise dashboard

Multi-company finance dashboard, ledger browser and transaction day book. Built with Angular 21 / TypeScript, Node.js / Express 5 and PostgreSQL.

A separate service on the Tally server sends complete company snapshots to the authenticated ingestion API. The application stores and displays those snapshots; it does not require the VPS to contact Tally.

- [Technology, business review and deployment runbook](deploy/README.md)
- [Tally sender API contract](deploy/docs/tally-ingestion.md)
- [Implementation design](deploy/docs/deployment-plan.md)
- [Validation results and remaining acceptance](deploy/docs/validation.md)

Deployment uses the existing VPS PostgreSQL container and Caddy network. PowerShell scripts build and upload versioned Docker images, run migrations and health checks, and archive previous successful releases. Complete the one-time setup in the runbook before running a deployment.
