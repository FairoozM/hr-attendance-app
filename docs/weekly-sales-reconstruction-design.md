# Weekly Sales Report — Stock Value Reconstruction Design

**Status:** Design only. No production code changes in this document.

**Report type:** Business BI **sales-price stock value** report — not accounting inventory valuation or cost-based stock.

**Related investigation docs:**
- `docs/weekly-sales-stock-movement-source-investigation.md`
- `docs/zoho-historical-stock-api-investigation.md`
- `docs/weekly-report-zoho-transactions.md`

---

## 1. Current formula (as implemented today)

Implementation lives primarily in:
- `backend/src/services/weeklyReportZohoData.js` (`fetchZohoItemRowsForGroupMembers`)
- `backend/src/integrations/zoho/weeklyReportZohoTransactions.js` (`getStockReconstruction`, `getSales`, `getPurchases`, `getVendorCredits`)

### 1.1 Anchor: current live stock (quantity)

For each report row (Zoho item matched to `item_report_groups`):

| Scope | Quantity source (`q_now`) |
|---|---|
| All warehouses | `GET /inventory/v1/items` → `stock_on_hand` (fallback: `available_stock`, `available_for_sale`) |
| Include `warehouse_id` | `GET /inventory/v1/items?warehouse_id=…` → warehouse-scoped on-hand per item |
| Exclude damaged warehouse | All-warehouse on-hand **minus** excluded warehouse on-hand (second items fetch) |

Initially both `opening_stock` and `closing_stock` placeholders are set to this same `q_now` before valuation.

### 1.2 Closing Stock Value (today)

**Not historical.** Closing is **not** reconstructed to `to_date`.

```
q_close  = q_now                           // current live quantity at report generation time
V_close  = q_close × sales_price_basis      // if sales_price_basis resolvable, else null
```

`sales_price_basis` = `resolveUnitPriceForStockValuation(item, row)` (today):
1. Zoho item `rate` (selling price / sales rate) — **intended primary basis**
2. else Zoho item `purchase_rate` (fallback when no selling rate on item)
3. else implied `sales_amount / sold` for the **report period** `[from_date, to_date]`

**Business intent:** Management wants stock value at **sales price**, not purchase cost. Metadata should label this **sales-price stock value**, not accounting inventory value.

### 1.3 Opening Stock Value (reconstructed quantity, then valued)

Opening quantity is **backward-reconciled** from current stock using transaction deltas from **`from_date` through server-local today** (`throughDate`), **not** through `to_date` only.

Reconstruction fetch (`getStockReconstruction`):
- **Sales:** all customers, `[from_date, throughDate]` — same warehouse filter as `transactionFilter` (include / exclude damaged on lines)
- **Purchases (bills):** **all vendors** in recon (`stockReconstructionAllVendors: true`), `[from_date, throughDate]`, warehouse line filter
- **Vendor credits:** **all vendors** in recon, `[from_date, throughDate]`, warehouse line filter

Per SKU (aggregated from line maps):

```
netΔ_qty_recon = purchases_qty − sales_qty − vendor_credits_qty     // window [from_date, today]

q_open  = q_close − netΔ_qty_recon
        = q_now − (purchases − sales − vendor_credits)

V_open  = q_open × sales_price_basis    // same sales-price basis as closing
```

Period columns (`sold`, `purchases`, `returned_to_wholesale`) use **`[from_date, to_date]`** only and may use **vendor-scoped** bills/credits — they do **not** drive opening/closing reconstruction.

### 1.4 Other columns (for context)

| Column | Source | Date window | Notes |
|---|---|---|---|
| `sales_amount` | `GET /inventory/v1/reports/salesbyitem` (invoice detail fallback) | `[from_date, to_date]` | **Actual sales revenue** (pre-tax net from report) — not the same as opening/closing value |
| `sold` | Invoices (or salesbyitem path) | `[from_date, to_date]` | Quantity |
| `purchases` | `GET /inventory/v1/bills` line_items | `[from_date, to_date]` | **Purchase Amount** — existing business logic (bills / purchase-side lines); document basis in metadata |
| `returned_to_wholesale` | `GET /inventory/v1/vendorcredits` | `[from_date, to_date]` | **Returned to Wholesale** — qty × sales-price basis or VC line total per existing logic |

### 1.5 Transactions currently included vs missing

**Included in opening recon (quantity):**
- Sales / invoices (outbound stock)
- Bills / purchases (inbound stock)
- Vendor credits (purchase returns — outbound stock)

**Included in closing (quantity):**
- Current live items API only

**Not included anywhere in stock recon:**
- Inventory adjustments (`/inventory/v1/inventoryadjustments`)
- Sales returns (`/inventory/v1/salesreturns`)
- Credit notes (`/inventory/v1/creditnotes`) as stock movements
- Transfer orders (`/inventory/v1/transferorders`)
- Stock ledger / inventory valuation snapshot APIs
- Composite assembly/disassembly events (beyond static BOM lookup)

---

## Valuation policy

This report **intentionally values stock at sales price** because management wants to see stock value based on **selling price**, not purchase cost.

| Label in UI / metadata | Meaning |
|---|---|
| **Opening Stock Value** / **Closing Stock Value** | Stock quantity × **sales price** (“sales-price stock value” / “stock value at sales price”) |
| **Sales Amount** | **Actual sales revenue** (net/pre-tax from Zoho Sales by Item) for the period |
| **Purchase Amount** | Existing business logic from bills (purchase-side document values) |
| **Returned to Wholesale** | Existing business logic (vendor credits; often qty × sales-price basis) |

**Do not describe** opening/closing columns as accounting inventory value, cost value, or COGS-based valuation.

**Do not** subtract invoice revenue (`salesbyitem.amount`, invoice `item_total`) from opening/closing stock value. Revenue answers “how much did we sell?”; opening/closing answer “what is on-hand worth at sales price?” — related concepts, **different calculations**.

---

## Value Basis Validation (sales-price BI report)

This section documents how API fields relate to a **sales-price stock value** report (not accounting cost valuation). Findings from code, movement probes, and Zoho field semantics.

### Critical distinction

| Metric | What it measures | Formula shape |
|---|---|---|
| **Sales Amount** | Period **revenue** / net sales | Sum of `salesbyitem` (or invoice) line **sales totals** in `[from_date, to_date]` |
| **Opening / Closing Stock Value** | **Stock on hand valued at sales price** | `q_reconstructed × sales_price_basis` |

Both may reference “sales price,” but **Sales Amount ≠ Opening/Closing Stock Value**. Never implement `V_close = V_now − Σ invoice.item_total` (that mixes revenue into a quantity×price model).

### Per-source notes (quantity vs sales-price value)

| # | Source | Fields available | Role in this report | Sales-price value use | Fallback | Confidence |
|---|---|---|---|---|---|---|
| 1 | **Invoices** | `quantity`, `rate`, `item_total`, … | **δ_qty** for recon | Do **not** subtract `item_total` from V; use **qty × sales_price_basis** | — | **high** qty |
| 1b | **Sales by item** | `amount`, `quantity`, … | **`sales_amount` column only** | Revenue — not used for opening/closing V | — | **high** |
| 2 | **Bills** | `quantity`, `purchase_rate`, `item_total` | **δ_qty**; **Purchase Amount** column | Purchase Amount keeps **existing bill logic** (purchase-side $) | — | **high** qty |
| 3 | **Vendor credits** | `quantity`, `item_total`, `rate`, … | **δ_qty**; **Returned to Wholesale** | Returned column: existing logic (often qty × sales price or VC line $) | — | **high** qty |
| 4 | **Inventory adjustments** | `quantity_adjusted`, `value_adjusted`, … | **δ_qty** (required new source) | Value display: **`q × sales_price_basis`** after qty recon; optional note if `value_adjusted` ≠ sales-price | incomplete if no rate | **medium** |
| 5 | **Credit notes** | `quantity`, `rate`, `item_total`, … | **δ_qty** when not duped | **`q × sales_price_basis`** — not line refund `item_total` as V delta | incomplete if no rate | **medium** |
| 6 | **Sales returns** | `quantity_received`, `rate`, `item_total`, … | **δ_qty** when received | **`q × sales_price_basis`** | incomplete if no rate | **medium** |
| 7 | **Transfer orders** | `quantity_transfer`, `sales_rate`, … | **δ_qty** per warehouse | **`q × sales_price_basis`** per leg | incomplete if no rate | **medium** |

### Anchor: `GET /items`

| Field | Use in this report |
|---|---|
| `rate` | **Primary `sales_price_basis`** for opening/closing stock value |
| `purchase_rate` | Fallback only when `rate` missing (existing code behavior) |
| `stock_on_hand` | Anchor quantity `q_now` |

### Sales price basis priority

1. Zoho item **`rate`** (selling price / sales rate on item master)  
2. Existing fallbacks already in `resolveUnitPriceForStockValuation`: **`purchase_rate`**, then implied **`sales_amount / sold`** for the report period  
3. If no sales price can be resolved: **`opening_stock_value` / `closing_stock_value` = null** and metadata warning **`sales_price_basis_missing`** (quantity may still show)

### Value Basis Validation — conclusions (for implementation)

1. **Default valuation = sales price** — aligned with management; do not switch to purchase-cost as default.  
2. **Reconstruct quantities first**, then multiply by **`sales_price_basis`** for opening/closing value.  
3. **Do not subtract invoice revenue** from stock value; keep Sales Amount as its own column.  
4. **Purchase Amount** and **Returned to Wholesale** remain on their existing bases; document clearly in `report_meta`.  
5. **Next implementation problem is timing/completeness**, not valuation philosophy: closing must be as-of `to_date`, opening must include missing movement sources.

---

## 2. Proposed improved formula

### 2.1 Design principles

1. **Backward quantity reconstruction** from live stock (`q_now`) because Zoho has no production-safe historical valuation snapshot API.
2. **Value = reconstructed quantity × sales price** — intentional BI policy (see Valuation policy).
3. **Quantity-first:** include all movement sources needed for accurate `q_open@f` and `q_close@t` (adjustments, returns, transfers, post-`to_date` activity).
4. **Never subtract invoice revenue** from stock value; Sales Amount stays a separate revenue column.
5. **Label metadata** as sales-price stock value, not accounting/cost inventory value.
6. **Avoid double-counting** linked documents (sales return ↔ credit note).
7. **Never claim exact historical** until validated; document included sources and reconstruction windows in `report_meta`.

### 2.2 Sign convention (quantity only)

Define **stock delta** `δ_qty` as change to on-hand quantity (positive = stock increases). **Value** is applied after qty recon via `× sales_price_basis`, not by subtracting document line revenue totals.

| Movement | δ_qty |
|---|---|
| Sale / invoice line | `−quantity` |
| Bill / purchase line | `+quantity` |
| Vendor credit (purchase return) | `−quantity` |
| Sales return **received** | `+quantity_received` (or `+quantity` when appropriate) |
| Credit note (if not duped with sales return) | `+quantity` |
| Inventory adjustment | `+quantity_adjusted` (signed) |
| Transfer order (warehouse W) | out: `−quantity_transfer`; in: `+quantity_transfer` |

**Net delta** over interval `(start, end]`:

```
netΔ_qty(item, start, end) = Σ δ_qty
```

### 2.3 Recommended formulas

Let:
- `T` = server-local **today** (generation date)
- `f` = selected `from_date`
- `t` = selected `to_date`
- `q_now` = current scoped live quantity from items API
- `sales_price_basis` = item `rate`, else existing fallbacks in `resolveUnitPriceForStockValuation`
- `V_now` = `q_now × sales_price_basis` when basis known, else `null`

**Step 1 — Reconstruct quantities:**

```
netΔ_qty(a,b] = Σ δ_qty across all included movement sources (scoped by warehouse)

q_close@t = q_now − netΔ_qty(t, T]
q_open@f  = q_close@t − netΔ_qty(f, t]
```

**Step 2 — Value at sales price:**

```
V_close@t = q_close@t × sales_price_basis
V_open@f  = q_open@f  × sales_price_basis
```

If `sales_price_basis` is missing for a row: value columns `null`, warning `sales_price_basis_missing` (qty may still display).

**Forbidden (unchanged):**

```
V_close@t ≠ V_now − Σ invoice.item_total     // Sales Amount / revenue — not stock value
```

**Current production gaps (why we change qty path, not valuation policy):**

| Issue | Today | Proposed |
|---|---|---|
| Closing timing | `q_close = q_now` (live today, not `to_date`) | `q_close@t` from movements after `t` |
| Opening movements | invoices, bills, vendor credits only | + adjustments, returns, transfers |
| Opening window | `[from, today]` for qty | `(f, t]` from `q_close@t` |
| Valuation | `q × sales_price_basis` (already intended) | same — applied to **reconstructed** q |

**Convention:** Half-open `(start, end]` on document dates; validate one SKU vs Zoho UI before coding.

### 2.4 Closing vs opening change summary

| Field | Today (production) | Proposed |
|---|---|---|
| Closing qty | `q_now` (live) | `q_close@t` |
| Closing value | `q_now × sales_price_basis` | `q_close@t × sales_price_basis` |
| Opening qty | `q_now − netΔ(f, T]` (partial sources) | `q_close@t − netΔ(f, t]` (full sources) |
| Opening value | `q_open × sales_price_basis` | `q_open@f × sales_price_basis` |
| Sales Amount | `salesbyitem` revenue | **unchanged** |
| Purchase Amount | bills (existing) | **unchanged** — document purchase basis |
| Returned to Wholesale | vendor credits (existing) | **unchanged** — document / qty×price basis |

### 2.5 Double-counting controls

| Risk | Mitigation |
|---|---|
| Sales return + credit note for same return | Prefer **`salesreturns`** with `receive_status` / `quantity_received` as primary; include **creditnotes** only for stock lines **not** linked to a sales return id already counted |
| Vendor credit in period column + full recon | Keep period `returned_to_wholesale` vendor-scoped; recon uses **all vendors** — document in metadata (already true) |
| Invoices vs salesbyitem for sales | Keep salesbyitem for amounts; use **invoices** for reconstruction qty (already used in recon path) |

---

## 3. Movement source mapping

| Source | Endpoint | Date field | Line array | Item id | SKU | Qty field | Value field | Sign (δ_qty) | All WH | Include WH | Exclude WH | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Live stock anchor | `GET /items` | n/a | n/a | `item_id` | `sku` | `stock_on_hand` | `q × rate` (sales price) | anchor | yes | scoped fetch | subtract WH qty | **high** |
| Sales (qty) | `GET /invoices` (+ detail) | `date` | `line_items` | `item_id` | `sku` | `quantity` | (qty recon only) | **−** | yes | line `warehouse_id` | exclude line WH | **high** |
| Sales amount | `GET /reports/salesbyitem` | report range | `sales[]` | item fields | sku | n/a | revenue (`amount`) | n/a | yes | optional WH | n/a | **high** |
| Purchases | `GET /bills` (+ detail) | `date` | `line_items` | `item_id` | `sku` | `quantity` | Purchase Amount column | **+** | yes | line WH | exclude line WH | **high** |
| Purchase returns | `GET /vendorcredits` (+ detail) | `date` | `line_items` | `item_id` | `sku` | `quantity` | Returned to Wholesale column | **−** | yes | line WH | exclude line WH | **high** |
| Inventory adjustments | `GET /inventoryadjustments` (+ detail) | `date` | `line_items` / list row | `item_id` | `sku` | `quantity_adjusted` | `q × sales_price_basis` | **signed** | yes | `warehouse_id` | exclude WH | **medium** |
| Sales returns | `GET /salesreturns` (+ detail) | `date` | `line_items` | `item_id` | `sku` | `quantity_received` | `q × sales_price_basis` | **+** when received | yes | line WH | exclude line WH | **medium** |
| Credit notes | `GET /creditnotes` (+ detail) | `date` | `line_items` | `item_id` | `sku` | `quantity` | `q × sales_price_basis` | **+** if not dup | yes | line WH | exclude line WH | **medium** |
| Transfer orders | `GET /transferorders` (+ detail) | `date` / `transferred_date` | `line_items` | `item_id` | `sku` | `quantity_transfer` | `q × sales_price_basis` | **±** per WH | net **0** org-wide | from/to WH | exclude rules | **medium** |

---

## 4. Value method (sales-price stock value)

### 4.1 Sales price basis definition

```
sales_price_basis =
  item.rate                           // primary — Zoho selling price
  ?? item.purchase_rate               // existing fallback in code
  ?? (sales_amount / sold)            // existing implied average for period
```

This is **intentional** for management BI. Do not default to `purchase_rate` ahead of `rate`.

### 4.2 Opening / closing value (after qty reconstruction)

```
V_close@t = q_close@t × sales_price_basis
V_open@f  = q_open@f  × sales_price_basis
```

Do **not** compute opening/closing by subtracting `salesbyitem.amount` or invoice line `item_total` from `V_now`.

### 4.3 Other columns (unchanged bases, clear labels)

| Column | Basis |
|---|---|
| **Sales Amount** | Revenue from Sales by Item (net/pre-tax) — **not** qty × rate |
| **Purchase Amount** | Existing bill line logic (purchase document values) |
| **Returned to Wholesale** | Existing vendor credit logic (qty × sales-price basis or VC line amount) |

### 4.4 Anchor (`V_now`)

```
V_now = q_now × sales_price_basis
```

### 4.5 Incomplete value rows

If `sales_price_basis` cannot be resolved: `opening_stock_value` / `closing_stock_value` = `null`, metadata `sales_price_basis_missing: true`. Quantity columns may still be populated.

### 4.6 report_meta value_basis (future)

```json
{
  "valuation_policy": "sales_price_stock_value",
  "valuation_label": "Stock value at sales price (not accounting cost)",
  "opening_stock_value": {
    "basis": "reconstructed_qty_times_sales_price",
    "sales_price_source": "item.rate_with_existing_fallbacks",
    "exact_historical": false
  },
  "closing_stock_value": {
    "basis": "reconstructed_qty_times_sales_price",
    "as_of": "to_date",
    "exact_historical": false
  },
  "sales_amount": {
    "basis": "zoho_sales_by_item_revenue",
    "note": "Not the same as opening/closing stock value"
  }
}
```

---

## 5. Date-filter problem — safe fetching

Zoho list `from_date` / `to_date` params returned the **same row counts** as unfiltered lists in probes → **do not trust API date filtering** until proven per endpoint.

### 5.1 Fetch strategy

| Step | Rule |
|---|---|
| List fetch | `page=1..N` with **no** date query params initially |
| Client filter | Keep rows where `document.date` (or `transferred_date` for transfers) ∈ target window |
| Max pages | Default **50** pages × 200 rows (existing cap); env `WEEKLY_REPORT_MOVEMENT_MAX_PAGES` |
| Detail fetch | Only when list row lacks `line_items` or warehouse on lines; cap **concurrent 4**, reuse document detail TTL cache |
| After `to_date` window | Fetch movements in `(to_date, today]` — may reuse full list cache filtered in memory |
| Period window | Fetch/filter `(from_date, to_date]` separately for opening step |

### 5.2 Cache strategy

| Cache key | TTL | Contents |
|---|---|---|
| `movement:list:inventoryadjustments` | 5–15 min (align `ZOHO_ITEMS_CACHE_TTL_MS`) | Full list snapshot, paginated to cap |
| `movement:list:salesreturns` | same | same |
| `movement:list:creditnotes` | same | same |
| `movement:list:transferorders` | same | same |
| `movement:list:vendorcredits` | existing `fetchAllVendorCreditsRaw` | already cached |
| `movement:detail:{endpoint}:{id}` | 30 min | Single document |

Invalidate on report refresh is acceptable; do **not** bust Zoho daily quota with per-report full history pulls — log warning when cap hit.

### 5.3 Warnings

- `movement_list_truncated` — pagination cap  
- `movement_date_filter_untrusted` — client-side filter only  
- `movement_detail_partial` — some documents skipped (safe-stop / errors)  
- `movement_sources_incomplete` — feature flag lists what was included  

---

## 6. Warehouse logic

### 6.1 All warehouses (`kind: all_warehouses`)

- `q_now` = global item `stock_on_hand`
- Include movement lines where line has **no** warehouse → treat as global (include) or exclude (config: default exclude unknown WH for safety)
- **Transfers:** net zero across org — **omit** from all-WH recon (or include both legs and verify net zero)

### 6.2 Include warehouse (`kind: single_warehouse`)

- `q_now` = warehouse-scoped items fetch
- Include lines where `line.warehouse_id === includeId`
- **Transfers:** apply `−qty` when `from_warehouse_id === includeId`, `+qty` when `to_warehouse_id === includeId`

### 6.3 Exclude warehouse (`kind: all_non_damaged`)

- `q_now` = global minus excluded WH stock (current behavior)
- Exclude lines where `line.warehouse_id === excludeId`
- **Transfers:** if either leg touches excluded WH, apply appropriate ± to **non-excluded** effective stock only; document as approximate

### 6.4 Sales scope nuance (unchanged)

Sales **amounts** remain business-wide when exclude-WH mode; stock recon sales qty uses `transactionFilter` (exclude damaged on lines) — keep documented.

---

## 7. Implementation sequence

### Phase A — Metadata only (inventory adjustments)

- Add fetch + aggregate adjustments in parallel (read-only path)
- Populate `report_meta.reconstruction_sources` with counts, truncated flags
- **No** change to `opening_stock` / `closing_stock` values
- Feature flag: `WEEKLY_REPORT_RECON_PROBE_ADJUSTMENTS=1` (default off)

### Phase B — Adjustments in calculation (behind flag)

- Implement `netΔ_qty` from adjustments into `q_open@f` / `q_close@t`
- Value via `q × sales_price_basis` (same as other rows)
- Flag: `WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS=1`
- Compare sample SKUs to Zoho UI manually

### Phase C — Sales returns + credit notes (behind flag)

- Add `salesreturns` (primary) + deduped `creditnotes`
- Flag: `WEEKLY_REPORT_RECON_INCLUDE_SALES_RETURNS=1`
- Sub-flag: `WEEKLY_REPORT_RECON_INCLUDE_CREDITNOTES=1` (only if dedup on)

### Phase D — Transfer orders (warehouse-scoped reports only)

- Enable only when `warehouse_id` set or exclude mode
- Flag: `WEEKLY_REPORT_RECON_INCLUDE_TRANSFERS=1`
- Skip for all-warehouse reports (net zero)

### Phase E — Tests + Zoho UI validation

- Fixture tests per movement sign (quantity)
- Assert `V = q × sales_price_basis` and Sales Amount ≠ opening/closing
- Manual checklist: 3 items × 2 dates × 1 warehouse — qty vs management expectation
- Promote flags to default only after sign-off

---

## 8. Risk controls

### 8.1 Feature flags

| Flag | Purpose |
|---|---|
| `WEEKLY_REPORT_RECON_PROBE_ADJUSTMENTS` | Phase A metadata probe |
| `WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS` | Phase B qty/value |
| `WEEKLY_REPORT_RECON_INCLUDE_SALES_RETURNS` | Phase C |
| `WEEKLY_REPORT_RECON_INCLUDE_CREDITNOTES` | Phase C optional |
| `WEEKLY_REPORT_RECON_INCLUDE_TRANSFERS` | Phase D |
| `WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE` | Master switch for closing qty/value as-of `to_date` |
| `WEEKLY_REPORT_MOVEMENT_MAX_PAGES` | Pagination safety cap |

### 8.2 report_meta fields (additive)

```json
{
  "reconstruction": {
    "version": "v2_backward",
    "anchor_date": "2026-05-18",
    "closing_as_of": "to_date",
    "sources_included": ["invoices", "bills", "vendorcredits", "inventoryadjustments"],
    "sources_excluded": ["transferorders"],
    "sources_probe_only": [],
    "date_filter_mode": "client_side",
    "truncated": false,
    "warnings": []
  }
}
```

Update `missing_for_exact_historical_stock` dynamically from `sources_excluded`.

### 8.3 Tests needed

| Test | Assert |
|---|---|
| Sign: sale | δ_qty negative |
| Sign: bill | δ_qty positive |
| Sign: vendor credit | δ_qty negative |
| Sign: adjustment +10 | δ_qty +10 |
| Sign: transfer WH A→B | A: −q, B: +q, all-WH: 0 |
| Closing@t | `q_close@t = q_now − netΔ(t,T]` |
| Opening@f | `q_open@f = q_close@t − netΔ(f,t]` |
| Dedup CN vs SR | Same return not double-counted |
| Truncation | Warning when `list_truncated` |
| No sales price on item | Value null, qty may still compute; warning set |
| Feature flags off | Matches legacy formula |

### 8.4 Rollback

All calculation changes behind flags; default off until Phase E sign-off. Metadata-only Phase A is safe at `PROBE` flag.

---

## Appendix — Legacy vs proposed (one item)

```
Legacy:
  q_close = q_now
  q_open  = q_now − (purchases − sales − vendor_credits)   over [from, today]
  V_*     = q_* × sales_price_basis   (already sales-price intent; wrong q timing)

Proposed:
  q_close@t = q_now − netΔ_qty(t, T]
  q_open@f  = q_close@t − netΔ_qty(f, t]
  V_close@t = q_close@t × sales_price_basis
  V_open@f  = q_open@f  × sales_price_basis
```

Where `netΔ_qty` uses the sign table in §2.2 and sources in §3. Valuation policy (sales price) is unchanged; **quantity reconstruction and as-of dates** are what improve.
