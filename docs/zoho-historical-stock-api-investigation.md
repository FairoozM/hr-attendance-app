# Zoho Historical Stock API Investigation

Generated at: 2026-05-18T13:45:53.450Z

## Probe Limits

- Endpoint: `/inventory/v1/reports/inventoryvaluation`
- Date param used: `date=2026-05-18`
- Warehouse filter: 4265011000000152046
- Pages requested: 1
- Per-page limit: 10
- Client: existing `zohoInventoryJsonRequest` with app guardrails, usage logging, and OAuth

## Inventory Valuation Summary

| Field | Value |
|---|---|
| endpoint | `/inventory/v1/reports/inventoryvaluation` |
| date param used | `date=2026-05-18` |
| row count | 10 |
| detected value fields | asset_value |
| detected stock/on-hand fields | quantity_available |
| total value sum from returned rows | 10 |
| raw top-level keys | code, message, inventory_valuation, page_context |
| raw first row keys | item_id, item_name, item_unit, quantity_available, asset_value, sku, category_id, item |

## First Returned Item Rows

| # | Item name | SKU | Item id | Value amount | Stock/on-hand amount |
|---|---|---|---|---:|---:|
| 1 | 0674AL | 891265412621621 | 4265011000019719126 | 0 | 0 |
| 2 | 124470MN | 855654494544745466 | 4265011000009799032 | 0 | 0 |
| 3 | 2025OB-001 | 529402100401 | 4265011000013352629 | 0 | 0 |
| 4 | 2025OB-002 | 529402100402 | 4265011000024512503 | 5 | 1 |
| 5 | 2025OB-003 | 529402100403 | 4265011000020914003 | 0 | 0 |
| 6 | 2025OB-004 | 529402100404 | 4265011000029470212 | 0 | 0 |
| 7 | 2025OB-005 | 529402100405 | 4265011000026709003 | 0 | 0 |
| 8 | 2025OB-006 | 529402100406 | 4265011000026804940 | 0 | 0 |
| 9 | 2025OB-007 | 529402100407 | 4265011000028364048 | 5 | 1 |
| 10 | 2025OB-008 | 529402100408 | 4265011000029076480 | 0 | 0 |

## Comparison Conclusion

- Date-sensitive: **unclear / likely no for this sampled page**. The first 10 rows, SKUs, `asset_value`, `quantity_available`, row count, and returned-row total were identical for `date=2026-05-18` and `date=2026-05-01`.
- Warehouse filter works: **unclear / likely no for this sampled page**. `warehouse_id=4265011000000152046` was accepted without error, but the first 10 rows and returned-row total matched the all-warehouse result exactly.
- Warehouse tested: `4265011000000152046` (`LIFE SMILE`, primary active warehouse).
- Safe candidate for production: **unclear / not yet**. The endpoint is reachable and exposes `asset_value` plus `quantity_available`, but this limited sample did not prove date sensitivity or warehouse scoping. Do not replace current Weekly Sales calculations until this endpoint is validated against Zoho UI totals over a meaningful item set/date pair.

## Production Decision

Status: Do not use `/inventory/v1/reports/inventoryvaluation` for Weekly Sales Report historical stock values yet.

Reason:
The endpoint is reachable and returns `asset_value` and `quantity_available`, but our tests did not prove:
- date sensitivity
- warehouse filter behavior
- exact match with Zoho UI historical valuation

Current conclusion:
Weekly Sales Report should continue using the existing calculation path plus the new `report_meta` warning. Do not replace Opening Stock Value or Closing Stock Value with inventoryvaluation yet.

What is needed to reconsider:
1. Compare API output with Zoho UI Inventory Valuation Summary for the same date.
2. Test dates where stock definitely changed.
3. Test a non-primary warehouse or an item known to differ by warehouse.
4. Verify total asset value against a Zoho UI export.
5. Confirm supported params with Zoho docs/support.

The script remains investigation-only. Do not wire the script into app routes. Do not call this endpoint from production Weekly Sales Report code.

## Recommendation

- `inventoryvaluation` is reachable and returns value-like fields in this org.
- This output should be compared manually against the Zoho UI Inventory Valuation report for the same date and optional warehouse before production calculations change.
- Historical/as-of behavior is not proven by API success alone; verify that changing `--date` changes totals as expected and matches Zoho UI.

## Comparison Runs

### 2026-05-18 all warehouses

Command: `node backend/scripts/investigate-zoho-historical-stock-reports.js --date 2026-05-18 --limit 10`

- Row count: 10
- Total value sum from returned rows: 10
- Detected value fields: asset_value
- Detected stock/on-hand fields: quantity_available

| # | Item name | SKU | Item id | Asset/value | Quantity available |
|---|---|---|---|---:|---:|
| 1 | 0674AL | 891265412621621 | 4265011000019719126 | 0 | 0 |
| 2 | 124470MN | 855654494544745466 | 4265011000009799032 | 0 | 0 |
| 3 | 2025OB-001 | 529402100401 | 4265011000013352629 | 0 | 0 |
| 4 | 2025OB-002 | 529402100402 | 4265011000024512503 | 5 | 1 |
| 5 | 2025OB-003 | 529402100403 | 4265011000020914003 | 0 | 0 |
| 6 | 2025OB-004 | 529402100404 | 4265011000029470212 | 0 | 0 |
| 7 | 2025OB-005 | 529402100405 | 4265011000026709003 | 0 | 0 |
| 8 | 2025OB-006 | 529402100406 | 4265011000026804940 | 0 | 0 |
| 9 | 2025OB-007 | 529402100407 | 4265011000028364048 | 5 | 1 |
| 10 | 2025OB-008 | 529402100408 | 4265011000029076480 | 0 | 0 |
### 2026-05-01 all warehouses

Command: `node backend/scripts/investigate-zoho-historical-stock-reports.js --date 2026-05-01 --limit 10`

- Row count: 10
- Total value sum from returned rows: 10
- Detected value fields: asset_value
- Detected stock/on-hand fields: quantity_available

| # | Item name | SKU | Item id | Asset/value | Quantity available |
|---|---|---|---|---:|---:|
| 1 | 0674AL | 891265412621621 | 4265011000019719126 | 0 | 0 |
| 2 | 124470MN | 855654494544745466 | 4265011000009799032 | 0 | 0 |
| 3 | 2025OB-001 | 529402100401 | 4265011000013352629 | 0 | 0 |
| 4 | 2025OB-002 | 529402100402 | 4265011000024512503 | 5 | 1 |
| 5 | 2025OB-003 | 529402100403 | 4265011000020914003 | 0 | 0 |
| 6 | 2025OB-004 | 529402100404 | 4265011000029470212 | 0 | 0 |
| 7 | 2025OB-005 | 529402100405 | 4265011000026709003 | 0 | 0 |
| 8 | 2025OB-006 | 529402100406 | 4265011000026804940 | 0 | 0 |
| 9 | 2025OB-007 | 529402100407 | 4265011000028364048 | 5 | 1 |
| 10 | 2025OB-008 | 529402100408 | 4265011000029076480 | 0 | 0 |
### 2026-05-18 warehouse 4265011000000152046

Command: `node backend/scripts/investigate-zoho-historical-stock-reports.js --date 2026-05-18 --warehouse-id 4265011000000152046 --limit 10`

- Row count: 10
- Total value sum from returned rows: 10
- Detected value fields: asset_value
- Detected stock/on-hand fields: quantity_available

| # | Item name | SKU | Item id | Asset/value | Quantity available |
|---|---|---|---|---:|---:|
| 1 | 0674AL | 891265412621621 | 4265011000019719126 | 0 | 0 |
| 2 | 124470MN | 855654494544745466 | 4265011000009799032 | 0 | 0 |
| 3 | 2025OB-001 | 529402100401 | 4265011000013352629 | 0 | 0 |
| 4 | 2025OB-002 | 529402100402 | 4265011000024512503 | 5 | 1 |
| 5 | 2025OB-003 | 529402100403 | 4265011000020914003 | 0 | 0 |
| 6 | 2025OB-004 | 529402100404 | 4265011000029470212 | 0 | 0 |
| 7 | 2025OB-005 | 529402100405 | 4265011000026709003 | 0 | 0 |
| 8 | 2025OB-006 | 529402100406 | 4265011000026804940 | 0 | 0 |
| 9 | 2025OB-007 | 529402100407 | 4265011000028364048 | 5 | 1 |
| 10 | 2025OB-008 | 529402100408 | 4265011000029076480 | 0 | 0 |
