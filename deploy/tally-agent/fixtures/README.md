# Repeatable deployed API test

These synthetic files represent two versions of the same `TEST - Finance Sync` company, GUID `finance-sync-fixture-company-2026`. They affect that test company's imported records and contribute to the dashboard's All companies totals. No cleanup is automatic.

From the repository root:

```powershell
# Inspect extraction without uploading or reading a token.
.\deploy\tally-agent\run-fixture.ps1 -Version 1 -DryRun

# Create/update only the synthetic company through the deployed API.
.\deploy\tally-agent\run-fixture.ps1 -Version 1

# After checking version 1 on the website, test replacement and refresh.
.\deploy\tally-agent\run-fixture.ps1 -Version 2
```

The runner starts an ephemeral loopback XML server, feeds the fixture through the real Tally XML extractor and persistent sender, then shuts down the simulator. It does not connect to your Tally installation. Uploads use the existing begin/chunk/complete endpoints; no new application deployment is required for the fixture tools if staged ingestion is already deployed.

The sender token is read from `deploy/api.env.example` by default for this workspace. Supply `-TokenEnvFile C:\private\finance-api.env` to use another env file containing `TALLY_INGEST_TOKEN=...`. The value is passed in the child process environment and is not printed or copied to the generated configuration. Do not commit credentials in example files. `-ApiUrl` can select another HTTPS test deployment explicitly.

| Selected test company | Version 1 | Version 2 |
| --- | ---: | ---: |
| Ledgers | 5 | 5 |
| Vouchers | 2 | 3 |
| Revenue | 100,000 | 150,000 |
| Expenses | 30,000 | 45,000 |
| Profit | 70,000 | 105,000 |
| Cash | 25,000 | 40,000 |
| Receivables | 15,000 | 20,000 |
| Payables | 8,000 | 10,000 |

After each upload, reload the website and select the test company; the dashboard does not poll automatically. In Transactions, select the test company and include September 2026 in any date filter. Version 2 updates TEST-P001 to 45,000 and adds TEST-S002 at 50,000. There should be three vouchers total, not five. The figures are synthetic dashboard inputs, not a balanced accounting dataset.

Logs: `deploy/tally-agent/state/fixture-test/logs/*.jsonl`. They distinguish extracted records, acknowledged chunks, and final committed counts. A successful API receipt proves commit; visible dashboard verification is a separate check. On upload failure, rerun the same version to resume the pending batch before switching versions. Test state and dry-run previews remain ignored by Git.

## Executed against the deployed application

On 2026-09-11 (India time), both versions were sent through the simulator and real sender to `https://finance.heliorsoft.com`. Version 1 batch `41ccc3c4-809b-4a53-a89b-6be1b6f1b967` received committed counts of 5 ledgers / 2 vouchers. Version 2 batch `36674ac3-77a2-414a-98cb-53f063a70143` received committed counts of 5 ledgers / 3 vouchers. Both completed with zero retries and `duplicate: false`. Version 2 is the final test snapshot left on the deployed application. No connected browser was available; visible dashboard figures remain to be confirmed after page refresh. Five local sender/fixture regression tests also passed.
