# Weekly Sales Report — closing-as-of staging enablement checklist

Scope: staging only. Validates the new **windowed Sales-by-Item** closing-as-of
reconstruction (no invoice-detail fan-out, no Zoho rate-limit pressure).

Production code unchanged. Frontend unchanged. Exports unchanged. Saved
snapshots unchanged.

---

## 1. Flags to enable in staging

Set **only** this env on the staging backend:

```
WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1
```

Restart the backend after setting it.

## 2. Flags that must stay OFF

Do **not** set any of these in staging during this validation:

- `WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS` — keep unset. Adjustments are
  excluded from the calc; we are only validating the sales-source change.
- `WEEKLY_REPORT_RECON_USE_INVOICE_DETAIL` — keep unset. This is the legacy
  invoice-detail recon path; the windowed Sales-by-Item path is the new default
  and is what we want to test.
- `WEEKLY_REPORT_RECON_PROBE_ADJUSTMENTS` — keep unset.

If any of the above are already set in staging, unset them and restart before
running comparisons.

## 3. Reports / date ranges to compare

For each report, generate the Weekly Sales Report twice — once with the flag
**off** (legacy baseline) and once with the flag **on** (new default windowed
recon) — and compare totals + selected family rows.

| Report group | from_date  | to_date    | Notes |
|--------------|------------|------------|-------|
| slow_moving  | 2026-05-01 | 2026-05-18 | through_date == to_date → after-window is skipped |
| slow_moving  | 2026-04-01 | 2026-04-30 | through_date > to_date → two Sales-by-Item calls |
| other_family | 2026-05-01 | 2026-05-18 | through_date == to_date → after-window is skipped |
| other_family | 2026-04-01 | 2026-04-30 | confirm SPHM-S family row (high movement) |

For the `other_family Apr 1–30` run, **pay special attention to SPHM-S**: this
family triggered negative opening under the legacy invoice-detail path; under
the windowed path it should be non-negative.

## 4. What to verify

For each report, on the flag-on run check:

### Columns that must be unchanged vs flag-off

- **Sales Amount** — bit-for-bit identical to legacy.
- **Purchase Amount** — bit-for-bit identical to legacy.
- **Returned to Wholesale** — bit-for-bit identical to legacy.

(These columns are sourced from period `Sales-by-Item`, bills, and vendor
credits; the closing-as-of change only affects opening/closing stock.)

### Columns that are expected to change

- **Opening Stock Value** — may shift compared to legacy. The new value is
  derived as `closing_value − net_delta_opening_window`, where the opening
  window is `(from_date, to_date]`. Direction and magnitude should be
  logically explainable by movements inside the period.
- **Closing Stock Value** — for windows where `to_date < today`, this is now
  **stock-as-of `to_date`**, not stock as it is right now. For windows where
  `to_date == today`, closing_value matches legacy (after-window is empty).

### report_meta.reconstruction must show

- `closing_as_of_to_date_enabled: true`
- `version: "v3_closing_as_of_to_date"`
- `sales_movement_source.status: "salesbyitem_windowed"`
- `sales_movement_source.requires_document_dates: false`
- `sales_movement_source.sales_reconstruction_partial: false`
- `sales_movement_source.invoice_detail_fetches: 0`
- `sales_movement_source.windowed_split_date: <to_date>`
- `sales_movement_source.in_window`: positive `line_count`, `list_truncated:
  false`
- `sales_movement_source.after_window`: positive `line_count` when
  `through_date > to_date`, or `skipped: true` when `through_date == to_date`
- `closing_as_of_reconstruction_complete: true`
- `completeness.severity: "warning"` (informational) — **not** `"critical"`
- `completeness.blocking_reasons` does **not** contain
  `salesbyitem_windowed_truncated`, `dated_invoice_sales_lines_truncated`, or
  `missing_dated_sales_lines_for_closing_as_of`.

## 5. Red flags — pause and investigate before promoting

- Any **negative** Opening Stock Value or Closing Stock Value on any family row.
- **Sales Amount** differs from the flag-off run for any family (even by
  cents). The closing-as-of change must not touch Sales Amount.
- **Purchase Amount** or **Returned to Wholesale** differs from flag-off.
- `sales_movement_source.status` is anything other than `salesbyitem_windowed`
  (e.g. `salesbyitem_windowed_truncated`, `missing_dated_sales_lines`,
  `dated_invoice_lines*`). Truncated/missing status implies the Zoho call hit
  a pagination cap or returned no rows; do not promote.
- `sales_reconstruction_partial: true`.
- `completeness.severity: "critical"`.
- Family-level Opening or Closing Stock Value swings vs flag-off that the
  business cannot account for via movements in
  `(from_date, to_date]` / `(to_date, today]`.
- `invoice_detail_fetches` > 0 — that means the invoice-detail debug path was
  somehow hit; confirm `WEEKLY_REPORT_RECON_USE_INVOICE_DETAIL` is unset.

## 6. Rollback

If any red flag fires, or if business signs off and you simply want to revert:

1. Unset the env on staging:

   ```
   unset WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE
   ```

   (or remove the line from the staging env config)
2. Restart the backend.
3. The next Weekly Sales Report will use the legacy stock basis: Opening Stock
   Value reconstructed from current live stock minus full-range deltas, Closing
   Stock Value = current live Zoho stock. No saved snapshots are touched by the
   flag flip.

No DB migration, no cache purge, and no frontend deploy required to roll back.
