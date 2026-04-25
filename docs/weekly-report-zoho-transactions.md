# Weekly report — Zoho transaction sources (Phase 4)

This document records **assumptions and limitations** for the backend weekly report
when `item_report_groups` rows are filled from Zoho Inventory REST v1.

## Data sources

| Report column | Zoho source | Filter |
|---------------|-------------|--------|
| `sold` | `GET /inventory/v1/invoices` — `line_items` | Invoice `date` in `[from_date, to_date]`, `status` ≠ `void` (all customers / all sales) |
| `purchases` | `GET /inventory/v1/bills` — `line_items` | Same date rule; **all vendors** by default (not the Purchases-by-Item report). With `WEEKLY_REPORT_PURCHASES_MODE=by_contact_id` + contact id, only that vendor’s bills. |
| `returned_to_wholesale` | `GET /inventory/v1/vendorcredits` — `line_items` (list response array key is `vendor_credits`); if lines are omitted in the list payload, the backend uses `GET /vendorcredits/{id}` for matching docs. | Date in range; `vendor_id` (or `customer_id` if it matches the configured id) and **report vendor** |
| `closing_stock` | `GET /inventory/v1/items` (existing row join) | Current on-hand (e.g. `stock_on_hand` or fallbacks) at **request** time, not a historical `to_date` snapshot |
| `opening_stock` | *Derived* | **Not** read as “stock on `from_date`” from a history API. Computed as `closing − purchases + sold + returned_to_wholesale` so the five numeric columns on each row are internally consistent with the period line totals. |

## Configuration (report vendor)

- **`REPORT_VENDOR_ID`** (required in production) — Zoho `vendor_id` for the wholesale vendor, e.g. `4265011000000080014`. Used to filter **bills** (purchases) and **vendor credits** (returned to wholesale) with `vendor_id == REPORT_VENDOR_ID`.
- **`REPORT_VENDOR_NAME`** — if id is not set, documents are matched by **exact** case-insensitive `vendor_name` (not recommended if you can use the id).
- **Per group:** `WEEKLY_REPORT_VENDORS_JSON[report_group].vendor_credits_contact_id` is used when `REPORT_VENDOR_ID` is unset.
- **`WEEKLY_REPORT_VENDOR_OPTIONAL=1`** — for local tests only: if no vendor is resolved, `purchases` and `returned_to_wholesale` are **0** with a warning. **Default (unset):** if the report has at least one item row and no vendor can be resolved, the API returns **400** with `REPORT_VENDOR_NOT_CONFIGURED`.

## Pagination and scale

List APIs are paged (200 per page, up to 500 pages / ~100k rows) per endpoint. If the cap is hit, a warning is attached to the response. Very large orgs may need a narrower date range or a dedicated reporting pipeline.

## OAuth scopes (minimum to enable all columns)

- `ZohoInventory.items.READ` — already required for item rows.  
- `ZohoInventory.invoices.READ` — `sold`  
- `ZohoInventory.bills.READ` — `purchases`  
- `ZohoInventory.debitnotes.READ` (vendor credits) — `returned_to_wholesale` (name matches Zoho’s “debit note” label for this resource)

## Debug (non–production or `WEEKLY_REPORT_VENDOR_DEBUG=1`)

The JSON `zoho.transaction_debug` object (when enabled) includes list truncation flags, line counts, and a **sample** of document ids per metric; it does not dump full line payloads to avoid noise.

## Excel

Excel export reuses the same `items` and `totals` as the API; **no** transaction debug in the file.
