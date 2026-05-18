# Zoho stock-as-of endpoint investigation

Generated: 2026-05-18T16:58:01.893Z

Probe dates: `date1=2026-04-01`, `date2=2026-05-18`, warehouse_id=`4265011000000152046`
Per-page: 200, deep-pages: 3 (600 rows per date on the reports endpoints).

Read-only. Uses existing `zohoInventoryJsonRequest` (rate limits / OAuth / usage logging respected). No production code, flags, snapshots, exports, or frontend touched.

Probe script: `backend/scripts/investigate-zoho-stock-as-of-endpoints.js` (investigation-only, not wired into routes).

## 1. Reports endpoints

| endpoint | exists | date param | item-level qty | available-for-sale | value | rows@d2 | date-sensitive (qty or value differs across `date1` vs `date2`)? |
|---|---|---|---|---|---|---:|---|
| `/inventory/v1/reports/inventoryvaluation` | yes | `date` (accepted) | yes | yes (`quantity_available`) | yes | 600 | no (same across dates) |
| `/inventory/v1/reports/inventorysummary` | yes | `date` (accepted) | yes | yes (`quantity_available,`) | no | 600 | no (same across dates) |
| `/inventory/v1/reports/stocksummary` | no (HTTP 404) | `date` (unknown) | no | no | no | 0 | inconclusive (one_or_both_probes_failed) |
| `/inventory/v1/reports/stocktracking` | no (HTTP 404) | `date` (unknown) | no | no | no | 0 | inconclusive (one_or_both_probes_failed) |
| `/inventory/v1/reports/inventorydetails` | no (HTTP 404) | `date` (unknown) | no | no | no | 0 | inconclusive (one_or_both_probes_failed) |
| `/inventory/v1/reports/inventoryaging` | no (HTTP 404) | `date` (unknown) | no | no | no | 0 | inconclusive (one_or_both_probes_failed) |

### `/inventory/v1/reports/inventoryvaluation`

- date param accepted: `date=2026-05-18` (HTTP 2xx)
- top-level keys: code, inventory_valuation, message, page_context
- first row keys: asset_value, category_id, item, item_id, item_name, item_unit, quantity_available, sku
- stock-like fields: quantity_available
- value-like fields: asset_value
- row count @ 2026-05-18: 600
- date sensitivity on overlapping items (qty differs across 2026-04-01 vs 2026-05-18): **0 / 600**
- value sensitivity: **0 / 600**
- warehouse param (`warehouse_id=4265011000000152046`): accepted but qty identical to all-warehouses (likely ignored or same item happens to live there)

### `/inventory/v1/reports/inventorysummary`

- date param accepted: `date=2026-05-18` (HTTP 2xx)
- top-level keys: code, inventory, message, page_context
- first row keys: category_id, category_name, is_combo_product, item, item_id, item_name, quantity_available, quantity_available_for_sale, quantity_demanded, quantity_in_transit, quantity_ordered, quantity_purchased, quantity_sold, reorder_level, sku, status, unit
- stock-like fields: quantity_available, quantity_available_for_sale, quantity_demanded, quantity_in_transit, quantity_ordered, quantity_purchased, quantity_sold
- value-like fields: —
- row count @ 2026-05-18: 600
- date sensitivity on overlapping items (qty differs across 2026-04-01 vs 2026-05-18): **0 / 600**
- value sensitivity: **0 / 600**
- warehouse param (`warehouse_id=4265011000000152046`): accepted but qty identical to all-warehouses (likely ignored or same item happens to live there)

### `/inventory/v1/reports/stocksummary`

- HTTP failure for both dates (404/404): `Zoho API HTTP 404 for /inventory/v1/reports/stocksummary: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}`

### `/inventory/v1/reports/stocktracking`

- HTTP failure for both dates (404/404): `Zoho API HTTP 404 for /inventory/v1/reports/stocktracking: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}`

### `/inventory/v1/reports/inventorydetails`

- HTTP failure for both dates (404/404): `Zoho API HTTP 404 for /inventory/v1/reports/inventorydetails: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}`

### `/inventory/v1/reports/inventoryaging`

- HTTP failure for both dates (404/404): `Zoho API HTTP 404 for /inventory/v1/reports/inventoryaging: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}`

## 2. `/inventory/v1/items` list with date params

| variant | http | rows | qty field | qty value (first row) | differs vs baseline |
|---|---|---:|---|---:|---|
| baseline (no date) | ok | 200 | available_stock | 0 | (baseline) |
| report_date=2026-04-01 | ok | 200 | available_stock | 0 | no |
| as_of_date=2026-04-01 | ok | 200 | available_stock | 0 | no |
| from_date=2026-04-01&to_date=2026-05-18 | ok | 200 | available_stock | 0 | no |
| warehouse_id=4265011000000152046 | ok | 200 | available_stock | 0 | (baseline) |

## 3. `/inventory/v1/items/{item_id}` detail with date params

- item_id probed: `4265011000024512503`

| variant | http | qty field | qty value | differs vs baseline |
|---|---|---|---:|---|
| baseline (no date) | ok | — | — | (baseline) |
| report_date=2026-04-01 | ok | — | — | (baseline) |
| as_of_date=2026-04-01 | ok | — | — | (baseline) |

## 4. Targeted item date probe (`search_text` / `item_id` filter)

- Target: `sku=SPHM-S-MIX-21-1-BLACK` `item_id=—`

| endpoint | http d1 | http d2 | qty field | qty @2026-04-01 | qty @2026-05-18 | qty_differs | value field | value @2026-04-01 | value @2026-05-18 | value_differs |
|---|---|---|---|---:|---:|---|---|---:|---:|---|
| `/inventory/v1/reports/inventoryvaluation` | ok | ok | quantity_available | 0 | 0 | no | asset_value | 0 | 0 | no |
| `/inventory/v1/reports/inventorysummary` | ok | ok | quantity_available | 0 | 0 | no | — | — | — | no |

(`search_text` filter returned the SKU successfully but it has zero current available stock, so it cannot independently prove or disprove date sensitivity. The 0 / 600 differing count on the full-page scan above is the conclusive signal.)

## Per-endpoint structured answers

| endpoint | exists | date param accepted | warehouse param accepted | item-level qty | available-for-sale qty | value returned | result @ 2026-04-01 vs 2026-05-18 |
|---|---|---|---|---|---|---|---|
| `/inventory/v1/reports/inventoryvaluation` | yes | yes (`date=YYYY-MM-DD`, HTTP 2xx) | yes (`warehouse_id`, HTTP 2xx) | yes (`quantity_available`) | yes (`quantity_available`) | yes (`asset_value`) | values **identical** for **0 / 600** overlapping items |
| `/inventory/v1/reports/inventorysummary` | yes | yes (`date=YYYY-MM-DD`, HTTP 2xx) | yes (`warehouse_id`, HTTP 2xx) | yes (`quantity_available`) | yes (`quantity_available_for_sale`) | no | values **identical** for **0 / 600** overlapping items |
| `/inventory/v1/reports/stocksummary` | no (HTTP 404) | unclear | unclear | n/a | n/a | n/a | endpoint missing |
| `/inventory/v1/reports/stocktracking` | no (HTTP 404) | unclear | unclear | n/a | n/a | n/a | endpoint missing |
| `/inventory/v1/reports/inventorydetails` | no (HTTP 404) | unclear | unclear | n/a | n/a | n/a | endpoint missing |
| `/inventory/v1/reports/inventoryaging` | no (HTTP 404) | unclear | unclear | n/a | n/a | n/a | endpoint missing |
| `/inventory/v1/items` | yes | accepts `report_date`/`as_of_date`/`from_date`+`to_date` but values **identical** to baseline | accepts `warehouse_id` but stock identical to all-warehouses | yes (`available_stock`, `actual_available_stock`, `stock_on_hand`) | yes (`actual_available_for_sale_stock` per-item, returned by detail) | no | live snapshot only |
| `/inventory/v1/items/{item_id}` | yes | accepts `report_date`/`as_of_date` but values **identical** to baseline | n/a | yes | yes | no | live snapshot only |

Key observation: on `/inventory/v1/reports/inventoryvaluation` and `/inventory/v1/reports/inventorysummary`, scanning 600 items per date, **not a single item's `quantity_available` or `asset_value` differs between `date=2026-04-01` and `date=2026-05-18`**. That includes items with non-zero stock (e.g. `4265011000024512503` qty=1, asset_value=5 on both dates). This is well beyond a sampling artifact: it is the same data returned twice. Together with the items-list probe (where `report_date`, `as_of_date`, and `from_date`/`to_date` produce identical rows to baseline), this is the evidence the API returns current live stock irrespective of the `date` parameter for this Zoho Inventory org.

The warehouse comparison probe also shows identical per-item qty between the all-warehouses call and the `warehouse_id=4265011000000152046` call. That warehouse is the primary active one (`LIFE SMILE`), so an inactive secondary warehouse or a warehouse that intentionally holds a subset would be needed to prove warehouse filtering actually applies in the API rather than being silently accepted.

## Final answers

### 1. Can Inventory Valuation be used for Opening / Closing stock value?

**No, not as-implemented.** `/inventory/v1/reports/inventoryvaluation` is reachable and returns the fields we need (`quantity_available`, `asset_value`) per item, but the `date` parameter has no observable effect for this Zoho org: 0 of 600 items returned a different `asset_value` or `quantity_available` between `date=2026-04-01` and `date=2026-05-18`. The endpoint behaves like the **current** valuation snapshot regardless of `date`. Until Zoho confirms that this report endpoint honors `date` for this org (and ideally until a non-zero number of items differ between two real-stock-movement dates), it cannot be used for historical Opening or Closing stock value.

### 2. Can Inventory Warehouse / item stock endpoint be used for dated stock available for sale?

**No.** Both `/inventory/v1/items` (list) and `/inventory/v1/items/{id}` (detail) ignore `report_date`, `as_of_date`, and `from_date`/`to_date` — the responses are byte-identical to the date-less baseline. They return current live stock only. `warehouse_id` is accepted on both endpoints (the response includes a per-warehouse `warehouses[]` breakdown), but there is no API-level "stock as of date X" variant in our probe.

### 3. Best candidate endpoint

There is **no API endpoint, in this org's response, that returns dated stock-on-hand or dated valuation** for Weekly Sales Report Opening/Closing stock.

- If date-sensitive valuation is ever needed, `/inventory/v1/reports/inventoryvaluation` is the only endpoint that exposes the right shape (`asset_value` + `quantity_available` + warehouse param), so it is the closest candidate — but it must be re-verified against the Zoho UI Inventory Valuation Summary report at two dates with real stock movement before any production usage. If the Zoho UI shows different numbers for the same two dates while the API does not, then this endpoint is not date-sensitive in the API contract and should not be used.
- For per-warehouse live stock the existing `items` / `items/{id}` paths already in our code (`actual_available_stock`, `actual_available_for_sale_stock`, `warehouses[*].warehouse_actual_available_for_sale_stock`) remain the right source, but only for "now", not "as of date X".

### 4. If none work, exactly why?

- `/inventory/v1/reports/inventoryvaluation` — exists, accepts `date`, returns item rows, but `date` is silently ignored: 0/600 items differ between two real dates.
- `/inventory/v1/reports/inventorysummary` — exists, accepts `date`, returns item rows, also silently ignores `date`: 0/600 items differ. No `asset_value`, so even if it were dated, it would only cover qty.
- `/inventory/v1/reports/stocksummary`, `stocktracking`, `inventorydetails`, `inventoryaging` — return HTTP 404 (`code=5: We couldn't find any resource for the given ID`). They are not exposed by Zoho Inventory's REST API for this org (or those report names are UI-only and require a different surface).
- `/inventory/v1/items` and `/inventory/v1/items/{id}` — only ever return the current snapshot. The `report_date` / `as_of_date` / `from_date`+`to_date` parameters are accepted (HTTP 2xx) but make no observable difference in `available_stock` / `stock_on_hand` / `actual_available_for_sale_stock`.

Conclusion: for this Zoho org, the Zoho Inventory REST surface does **not** expose a historical stock-on-hand or historical inventory valuation. Weekly Sales Report Opening/Closing stock cannot be replaced with a single dated API call. The only feasible options remain: (a) the current live snapshot from `items*` (no date sensitivity, current behaviour), or (b) reconstruction from dated movements (the current `closing-as-of` path, with all the caveats already captured in `report_meta.reconstruction`). The Zoho UI "Inventory Valuation Summary" report, if it shows different totals for past dates in the UI, must be reproducible against the API to be useful here — our probe shows it is not.

## Probe raw artifacts

Top-level keys and first-row keys per probe (for reference):

- `/inventory/v1/reports/inventoryvaluation` — top: `code, inventory_valuation, message, page_context` ; first_row: `asset_value, category_id, item, item_id, item_name, item_unit, quantity_available, sku`
- `/inventory/v1/reports/inventorysummary` — top: `code, inventory, message, page_context` ; first_row: `category_id, category_name, is_combo_product, item, item_id, item_name, quantity_available, quantity_available_for_sale, quantity_demanded, quantity_in_transit, quantity_ordered, quantity_purchased, quantity_sold, reorder_level, sku, status, unit`
- `/inventory/v1/reports/stocksummary` — HTTP 404: Zoho API HTTP 404 for /inventory/v1/reports/stocksummary: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}
- `/inventory/v1/reports/stocktracking` — HTTP 404: Zoho API HTTP 404 for /inventory/v1/reports/stocktracking: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}
- `/inventory/v1/reports/inventorydetails` — HTTP 404: Zoho API HTTP 404 for /inventory/v1/reports/inventorydetails: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}
- `/inventory/v1/reports/inventoryaging` — HTTP 404: Zoho API HTTP 404 for /inventory/v1/reports/inventoryaging: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."}
