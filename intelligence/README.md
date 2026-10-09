# Helior Intelligence

Standalone **financial process intelligence** app. It does not change the existing Tally dashboard (`api/` and `ui/`).

It ingests formatted operational Excel reports, keeps the original file, normalizes accounts and outstanding balances, reconciles against **existing Tally ledgers already in PostgreSQL**, and surfaces gaps for management action.

## What it answers

For each company: what the operational report shows, what has reached Tally, what has not, how much is outstanding, how old it is, and which exceptions need an owner.

## Stack

- API: Node.js + Express on port **3010**
- UI: React + Vite on port **5173**
- Database: same PostgreSQL as the dashboard; new tables are `intel_*` only
- Excel: ExcelJS (report parser, not a naive header-row importer)

Tally figures are **read** from existing `"Companies"` / `"Ledgers"` tables through `TallyDataProvider`. Tally ingestion stays in the original application.

## Run locally

API credentials are loaded from `../api/.env` (database) with `PORT` ignored so this service stays on 3010.

```powershell
cd enterprise-dashboard-1\intelligence
npm install
npm test
npm run dev
```

```powershell
cd enterprise-dashboard-1\intelligence\ui
npm install
npm run dev
```

Open http://localhost:5173

Sign in with `admin` / `admin` unless `INTEL_USER` / `INTEL_PASSWORD` are set.

## Import the sample file

1. Imports → New import
2. Leave company as “Detect from file”
3. Upload `intelligence/samples/ageingoutstanding.xlsx`
4. Confirm title, company, period, 416 detail rows, group rows, total row
5. Review mapping (unknown columns stay in staging)
6. Validate → Process & reconcile

The parser treats `CAPITAL` / `CURRENT CAPITAL` as groups, account lines as details, and `Total` as a source-total check (`SOURCE_TOTAL_VALIDATED` or `SOURCE_TOTAL_MISMATCH`).

## Architecture

```
Excel → file store + hash
     → structure analysis
     → column mapping (database)
     → staging rows (GROUP/DETAIL/TOTAL)
     → accounts + outstanding + ageing
     → TallyDataProvider
     → reconciliation + exceptions + work queue
     → management dashboards
```

Background note: the sample is ~475 rows and is processed in the API with batch progress fields. The import tables are ready for a later queue worker (BullMQ) without changing the public API.

## Tests

`npm test` runs parser, sample-file, and reconciliation unit tests against the real workbook.
