# Tally sender contract

`POST https://finance.heliorsoft.com/api/ingest/tally`

Headers: `Content-Type: application/json` and `Authorization: Bearer <TALLY_INGEST_TOKEN>`.
Browser basic authentication is not required for this one route; the API verifies the separate bearer token before parsing the request body. Always use HTTPS and keep the token on the sender server. A token grants import access to all companies in this deployment.

```json
{
  "batchId": "9d3e5116-8d14-4b9c-9947-d4e642c3a356",
  "capturedAt": "2026-09-10T06:00:00Z",
  "fullSnapshot": true,
  "company": {
    "externalId": "stable-tally-company-guid",
    "name": "Example Company"
  },
  "ledgers": [
    { "name": "Sales", "group": "Sales Accounts", "balance": "12345.67" }
  ],
  "vouchers": [
    {
      "date": "2026-09-10",
      "type": "Sales",
      "amount": "12345.67",
      "number": "INV-001",
      "party": "Example Customer",
      "narration": "Invoice"
    }
  ]
}
```

Send one complete company snapshot per request. Extract **all** ledgers and vouchers needed by the application before posting; a filtered date window must not be sent as a full snapshot. `ledgers` and `vouchers` are mandatory arrays. Empty arrays intentionally clear the corresponding imported data for that company; never convert extraction errors into empty arrays. Maximum body size is 20 MB and each array permits 50,000 rows. If actual company data exceeds these limits, design a staged/chunked import before using this protocol; do not split one full snapshot into multiple calls.

Use a stable company GUID as `externalId`, never its changing display name. Keep exact company names unique across the application. Renaming a known GUID is supported; a conflicting name returns 409. The sender must serialize extraction per company and use an increasing, timezone-qualified `capturedAt`. Keep clocks synchronized; timestamps over five minutes in the future are rejected.

Amounts must be decimal **strings**, with at most 16 integer and two fractional digits. Preserve the intended accounting sign. Dates use valid `YYYY-MM-DD` calendar dates. Number, party and narration are optional; omit absent number/party values or send null. Do not silently truncate source names or narration to meet field limits; rejected payloads should be investigated.

Each new snapshot replaces that company's imported ledgers and Tally vouchers in a single database transaction. Manually entered vouchers/project records are preserved. A failure rolls everything back, including the company update and receipt. This release has no project ingestion endpoint and does not infer voucher/project links.

- **200:** committed, or identical retry already committed. Response includes `ok`, `duplicate`, `companyId`, and `batchId`; new imports also return counts.
- **400:** invalid payload; correct it before retrying.
- **401:** missing or incorrect sender token.
- **409:** reused batch ID with different content, an equal/older snapshot, or company identity conflict. Investigate; do not retry indefinitely.
- **413:** body exceeds the limit.
- **500 / connection loss:** outcome may be uncertain. Retry the **same batch ID and same payload**, with backoff. Do not generate a fresh ID for retries.

The sender should persist the outgoing batch until it receives 200. Use one new UUID per new complete extraction. Identical retries do not duplicate rows, even after a newer batch has been accepted. Receipt history is retained; no automatic retention purge is configured. Monitor delivery on the sender and the dashboard's last successful sync; “sender integration” status indicates the configured mode, not a live connection to Tally.
