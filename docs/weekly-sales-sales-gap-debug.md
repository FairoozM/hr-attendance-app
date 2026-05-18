# SPHM-S — Sales Amount vs reconstruction sales qty

Read-only investigation: why **Sales Amount ≈ $20,948** but **reconstruction sales quantity = 0** for the same family and window.

| Parameter | Value |
|-----------|--------|
| Group | `other_family` |
| Family | `SPHM-S` |
| Period | 2026-05-01 → 2026-05-18 |
| Through (run date) | 2026-05-18 |

**Script:** `backend/scripts/debug-weekly-report-sales-gap.js`

```bash
# Matches closing-as-of staging (flag on)
node backend/scripts/debug-weekly-report-sales-gap.js \
  --group other_family --family SPHM-S --from 2026-05-01 --to 2026-05-18 --closing-as-of
```

---

## Executive summary

**Root cause:** Both paths use the **same** Zoho source (`GET /inventory/v1/reports/salesbyitem`). Period **Sales Amount** and **sold qty** are taken from the **full** sales-by-item response (already scoped by API `from_date` / `to_date`). With **`WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1`**, reconstruction applies a **per-line half-open date filter** `(from_date, to_date]` via `document_date`. Sales-by-item lines are normalized with **`document_date: ''`**, so **every sales line is dropped** from the opening window. Bills still have real `document_date` values → purchases count, sales do not → negative opening.

This is **not** a family-mapping bug, **not** missing invoice fallback, and **not** a warehouse-scope mismatch for this run (`all_warehouses`, filters identical).

| Path | Endpoint | Date handling | SPHM-S result |
|------|----------|---------------|---------------|
| **A — Sales Amount** | `salesbyitem` | API params only; no line `document_date` filter | **79 qty**, **$20,948.47** |
| **B — Recon qty (closing-as-of)** | Same `salesbyitem` | `filterMovementLinesByHalfOpenWindow` on `document_date` | **0 qty** (42 lines → 0 after filter) |

---

## Path A — Sales Amount

**Code:** `getSales(fromDate, toDate, salesTransactionFilter)` → `sumAmountsToMap` / `sumLinesToMap` on **all** lines → `applyTransactionMapsToRow` → `sales_amount` and `sold` on family row.

**Endpoint:** `/inventory/v1/reports/salesbyitem` (`source: zoho_inventory_reports_salesbyitem`, `fallback_used: false`).

**Date params:** `from_date=2026-05-01`, `to_date=2026-05-18` (inclusive at API).

**Matching to family:** `item_id` on line → Zoho catalog Family field → `SPHM-S`. Sales-by-item rows often have **empty `sku`** but valid **`item_id`** and **`name`** (e.g. `SPHM-S-MIX-21-1-BLACK`).

**SPHM-S totals (period path):**

| Metric | Value |
|--------|------:|
| Matched lines | 42 |
| Quantity sum | **79** |
| Amount sum | **$20,948.47** |
| Report family `sales_amount` | **$20,948.47** ✓ |

All 42 lines are `type: sales_by_item` with `document_date: (empty)`.

---

## Path B — Reconstruction sales quantity

**Code:** `getStockReconstruction` → same `getSales` lines → when closing-as-of on:

```text
salesOpen = filterMovementLinesByHalfOpenWindow(lines, fromDate, toDate)
smReconOpen = sumMovementLinesToQtyMap(salesOpen)
```

**Filter rule:** `document_date` must satisfy `date > fromDate && date <= toDate`. Empty string **fails** → line excluded.

**SPHM-S totals (recon opening window):**

| Metric | Value |
|--------|------:|
| Lines before filter | 42 |
| Lines after half-open filter | **0** |
| Opening-window qty sum | **0** |

**Contrast:** Unfiltered recon map (`recon_all_qty` in script) = **79** — same as period path. The gap is **only** the closing-as-of line-date filter, not a different API or item match.

**Bills (purchases)** use invoice/bill lines with real dates → still enter opening window → explains prior negative opening (purchases without offsetting sales in recon).

---

## Investigation answers

### 1. Are Sales-by-Item rows using item identifiers that do not match invoice lines?

**No for this family.** Same `salesbyitem` feed for both paths. Lines match catalog by **`item_id`** (and name). No invoice fallback was used (`fallback_used: false`). Identifier mismatch between salesbyitem and invoices is **not** the cause here.

### 2. Is invoice fallback missing data due to status/date/pagination?

**Not applicable** — fast path succeeded (322 report rows, 2 pages, not truncated). Invoice fallback was not invoked.

### 3. Is reconstruction using invoice quantity while Sales Amount uses report quantity?

**No.** Both use **salesbyitem** quantity and amount from the same normalized lines. Reconstruction applies an **extra** `document_date` window filter that Sales Amount does **not**.

### 4. Is SPHM-S sales coming from Sales-by-Item only and not invoice detail?

**Yes** — and that is **correct** for production today. Invoice detail is only a fallback when salesbyitem fails. The bug is treating aggregated salesbyitem lines like dated movement documents when splitting opening vs closing windows.

### 5. What exact fix is recommended?

When `WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1` and sales source is `salesbyitem` (lines with `type: sales_by_item` and empty `document_date`):

1. **Preferred:** For aggregated sales-by-item lines, **do not** apply `filterMovementLinesByHalfOpenWindow` on `document_date`. Treat the fetch as already bounded by `from_date`/`to_date` (and `throughDate` for the recon fetch), and assign opening vs after-`to_date` buckets using **report period boundaries** (e.g. opening window = full period sales when `to_date` is period end and `throughDate` is today), **or**
2. **Alternative:** Use **invoice line detail** (`getSalesFromInvoicesSlow`) for reconstruction windows only (dated `document_date` per line), while keeping salesbyitem for period Sales Amount, **or**
3. **Minimal:** If `document_date` is empty and `type === 'sales_by_item'`, include line in opening window when API `from_date`/`to_date` overlap the requested opening window (document once in code comments).

**Do not** change calculations in this step — this doc is for design/review.

**Also:** With closing-as-of off, legacy recon sums **all** sales lines in `[fromDate, throughDate]` without per-line date filter → SPHM-S would get **79** sales qty in recon; the $20k / 0 qty split is specific to **closing-as-of + salesbyitem**.

---

## API / filter checklist (this run)

| Check | Result |
|-------|--------|
| Period vs recon warehouse filter | Same (`{}` all warehouses) |
| Period vs recon endpoint | Same (`salesbyitem`) |
| Pagination / truncation | No |
| Invoice status filter | N/A (no invoices) |
| Family mapping | 129 catalog SKUs, 42 with sales; all `SPHM-S` |
| `document_date` on sales lines | **42/42 empty** |
| Closing-as-of opening window | `(2026-05-01, 2026-05-18]` |

---

## Top sales-by-item rows (period path)

| item_id | name | qty | amount |
|---------|------|----:|-------:|
| 4265011000037866001 | SPHM-S-MIX-21-1-BLACK | 4 | 3,062.84 |
| 4265011000039479137 | SPHM-S-MIX-52-1B-BEIGE | 1 | 2,528.57 |
| 4265011000038499008 | SPHM-S-MIX-52-1-BLACK | 1 | 2,494.29 |
| 4265011000037041142 | SPHM-S-CK-6-3-BLACK | 9 | 1,566.63 |
| 4265011000037866059 | SPHM-S-MIX-21-1-BLUE | 2 | 1,531.42 |

All gap rows share reason: `empty_document_date_salesbyitem; closing_as_of_half_open_filter_drops_aggregated_sales`.

---

## Related

- [weekly-sales-negative-family-debug.md](./weekly-sales-negative-family-debug.md) — negative opening driven by bills without recon sales offset  
- [weekly-sales-reconstruction-design.md](./weekly-sales-reconstruction-design.md) — closing-as-of windows  
- `backend/scripts/debug-weekly-report-negative-family.js` — item-level movement breakdown
- `backend/scripts/investigate-invoice-list-ordering.js` — invoice list date params and sort probe (read-only)

---

## Follow-up — invoice list ordering / date params (SPHM-S April 2026)

Capped targeted run for **SPHM-S, Apr 1 – Apr 30** found `matching_sales_lines_in_window = 0` while `matching_sales_lines_total = 12` (target SKUs were found, but only **outside** the April window). Probe `backend/scripts/investigate-invoice-list-ordering.js` confirms why.

### Invoice list date params (production recon)

`getStockReconstructionUncached(fromDate, throughDate, opts)` →
`getSalesFromInvoicesSlow(fromDate, throughDate, opts)` →

| Zoho param | Value sent | Source |
|------------|------------|--------|
| `date_start` | `fromDate` (selected report `from_date`) | `URLSearchParams.set('date_start', fromDate)` |
| `date_end` | **`throughDate`** (today / run-date) | `URLSearchParams.set('date_end', toDate)` where `toDate` arg = `throughDate` |
| `sort_column` | _not set_ | — |
| `sort_order` | _not set_ | — |
| `status` | _not set_ | client-side `isNotVoidStatus` filter only |

**Important:** the second arg `toDate` inside `getSalesFromInvoicesSlow` is the report's **`throughDate` (today)**, not the user's selected `to_date`. The wider `date_end` is intentional for closing-as-of (recon needs `[from_date, throughDate]` to compute the half-open closing window `(to_date, throughDate]`), but it combines badly with default ordering.

### Observed list ordering (probe, single page = 200 rows)

| Probe | `date_start` | `date_end` | sort params | `first_20` dates | apr / may counts |
|-------|--------------|------------|-------------|------------------|------------------|
| prod-style (recon today) | 2026-04-01 | 2026-05-18 | _none_ | 19× `2026-05-17`, 1× `2026-05-16` | **apr=0**, may=200 |
| prod-range + `sort=date,A` | 2026-04-01 | 2026-05-18 | `date / A` | 20× `2026-04-01` | **apr=200**, may=0 |
| prod-range + `sort=date,D` | 2026-04-01 | 2026-05-18 | `date / D` | 20× `2026-05-17` | apr=0, may=200 |
| narrow `date_end=to_date` | 2026-04-01 | 2026-04-30 | _none_ | 20× `2026-04-30` | **apr=200**, may=0 |
| narrow + `sort=date,A` | 2026-04-01 | 2026-04-30 | `date / A` | 20× `2026-04-01` | apr=200, may=0 |

**Default order = newest first (`sort_order=D`)**. With `date_end=throughDate=2026-05-18`, the first **2 pages × 200 rows = 400 rows** are entirely **May 8 – May 17** invoices. No April invoice is even loaded into the in-memory list, so no April SPHM-S line can match — `matching_sales_lines_in_window = 0` is inevitable under the 2-page / 80-detail cap, regardless of detail-fetch order or target prefilter.

`sort_column=date` is supported by Zoho Inventory `/invoices` (probe confirmed `A` and `D` produce different orderings; same param style already used in `backend/src/integrations/zoho/zohoBooksClient.js`).

### Why April SPHM-S dated lines were not found under caps

1. Production recon fetches with `date_end = throughDate (today)`, default sort = **newest first**.
2. List cap = 2 pages × 200 = **400 rows** → the most recent 400 invoices, all dated **2026-05-08 – 2026-05-17**.
3. Detail-fetch cap (80) only sees those 400 May invoices → matched SPHM-S lines (12 found) are **all May**, none fall inside `(2026-04-01, 2026-04-30]`.
4. Date-sorting the **already-fetched 400** ascending (current targeted-debug behavior) cannot rescue invoices that were never on those pages.

### Recommended next fix (not implemented in this step)

For targeted/validation runs (closing-as-of, narrow opening window), apply **one of** the following — both confirmed safe by probe, neither changes Sales Amount logic:

1. **Send sort to Zoho list** for recon invoice fetch:
   - `sort_column=date`, `sort_order=A` (oldest first) when reconstruction window starts well before `throughDate`.
   - First N rows then deterministically cover the early portion of `[from_date, throughDate]`, so detail caps hit relevant invoices first.
2. **Split the recon fetch into two list queries** (`[from_date, to_date]` and `(to_date, throughDate]`) so detail-fetch caps are applied per-window. The first query already returns April-only invoices in this org (200-row page = Apr 21 → Apr 30; need 2–3 pages to cover Apr 1 → Apr 30).

Both should be added behind the same opt-in path used by `--stop-after-matching-sales-lines` (validation/targeted debug), not turned on by default in production, until a wider validation confirms no regression. Production caps + `dated_invoice_lines_truncated` critical metadata stay as-is.

### Probe usage

```bash
node backend/scripts/investigate-invoice-list-ordering.js \
  --from 2026-04-01 --to 2026-04-30 --probe-sort --probe-narrow
```
