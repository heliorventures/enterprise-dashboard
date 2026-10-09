# Ageing outstanding sample — data dictionary

Source file: `samples/ageingoutstanding.xlsx`

This is a formatted financial report, not a flat table.

| Area | Detection |
|---|---|
| Sheet | 1 worksheet, 475 rows × 25 columns |
| Title | Row 1 merged A:Y — `AGEING OUTSTANDING EXCEL REPORT` |
| Period | Row 2 — `From :-31/03/2024 To :-31/03/2027` |
| Entity | Row 3 — company name plus business units in brackets |
| Headers | Row 4 parent / row 5 subheaders (`Bill Amount`, `Dr Amt`, `Cr Amt`) |
| Data | From row 6 |
| Groups | 53 category rows (no amount cells) |
| Details | 416 account rows |
| Total | Row 475 `Total` — validation only |

## Canonical columns

| Source | Target field |
|---|---|
| Particulars | account_name / particulars |
| Cr Days | credit_days |
| GST No. | gst_number |
| MSME No. | msme_number |
| Pan No. | pan_number |
| Up to Date \| Bill Amount | bill_amount |
| Up to Date \| Paid Amount | paid_amount |
| LAST PAYMENT REQUESITION AMT | last_payment_requisition_amount |
| LAST PAYMENT AMT | last_payment_amount |
| LAST PAYMENT DATE | last_payment_date |
| Pending Bill \| Dr Amt | pending_bill_debit |
| Pending Bill \| Cr Amt | pending_bill_credit |
| 0 to 1 Year \| Dr/Cr | age_0_1_year_debit / credit |
| 1 to 2 Year \| Dr/Cr | age_1_2_year_debit / credit |
| 2 to 3 year \| Dr/Cr | age_2_3_year_debit / credit |
| 3 to Above \| Dr/Cr | age_3_plus_year_debit / credit |
| Last Dt extra Dr/Cr | staging extra (unmapped until reviewed) |
| Trailing date column | last_date |

Ageing bucket calendar dates are stored as metadata from the header, not hard-coded.

Hierarchy is preserved as `category_path`, `level_1_category`, `level_2_category`.
