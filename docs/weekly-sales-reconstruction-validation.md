# Weekly Sales Report — reconstruction validation

Use the validation script to compare **legacy** vs **flagged** reconstruction modes on a real report window, without changing production routes or saved snapshots.

## Script

`backend/scripts/validate-weekly-report-reconstruction.js`

It calls the same backend path as the live report:

- `getInventoryByGroup()` → `fetchZohoItemRowsForGroupMembers()` (Zoho client + rate guards)
- `sumReportGrandTotals()` (same grand totals as the UI and export)

No duplicate calculation logic. No database writes.

## Prerequisites

- `backend/.env` with Zoho credentials (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, organization id)
- Database reachable for **read-only** `item_report_groups` membership (no writes)
- `REPORT_VENDOR_ID` / vendor config as required for your org (same as running the report in the app)

## Command examples

From the repo root:

```bash
node backend/scripts/validate-weekly-report-reconstruction.js \
  --group slow_moving \
  --from 2026-05-01 \
  --to 2026-05-18 \
  --limit 20
```

Scoped warehouse:

```bash
node backend/scripts/validate-weekly-report-reconstruction.js \
  --group slow_moving \
  --from 2026-05-01 \
  --to 2026-05-18 \
  --warehouse-id YOUR_WAREHOUSE_ID \
  --limit 20
```

Exclude damaged warehouse (all-non-damaged style scope):

```bash
node backend/scripts/validate-weekly-report-reconstruction.js \
  --group slow_moving \
  --from 2026-05-01 \
  --to 2026-05-18 \
  --exclude-warehouse-id DAMAGED_WAREHOUSE_ID \
  --limit 20
```

Help:

```bash
node backend/scripts/validate-weekly-report-reconstruction.js --help
```

## Modes compared

| Mode | Environment |
|------|-------------|
| **legacy** | No reconstruction flags |
| **adjustments only** | `WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS=1` |
| **closing as-of** | `WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1` |
| **closing + adjustments** | Both flags above |

`WEEKLY_REPORT_RECON_PROBE_ADJUSTMENTS` is cleared for all modes (metadata-only probe is not part of this comparison).

The script runs modes **sequentially** (four full report builds). Expect several Zoho round-trips; this is normal report traffic, not a bulk export.

## How to read the output

For each mode you get:

- **totals** — grand totals for `opening_stock`, `closing_stock`, `purchase_amount`, `returned_to_wholesale`, `sales_amount`
- **reconstruction** — `version`, sources included/excluded, whether adjustments apply to calculation
- **warnings_count** — from `report_meta.completeness.warnings` (or top-level warnings)
- **top changed families** — largest \|Δopening\| or \|Δclosing\| vs **legacy** (same family key)

Period columns (`sales_amount`, `purchase_amount`, `returned_to_wholesale`) should stay **unchanged** across modes; only stock value columns should move when flags apply.

## Safe to enable (green flags)

- **adjustments only**: Opening totals shift in a direction that matches known Zoho inventory adjustments; period columns unchanged; warnings stable; no source truncation errors.
- **closing as-of**: Closing totals move vs legacy when there is material activity **after** `to_date`; opening shifts consistently when anchored on reconstructed closing; movement **on** `to_date` affects opening only (not closing).
- **closing + adjustments**: Closing/opening deltas align with adjustment + post-`to_date` activity; still no change to sales/purchase/return columns.

Small, explainable family-level deltas are expected. Enable in staging with the same flags before production.

## Red flags

- Large swings in **sales_amount**, **purchase_amount**, or **returned_to_wholesale** (should not happen).
- `warnings_count` jumps or new `source_truncated` / `inventory_adjustments_source_failed` blocking reasons.
- `reconstruction.inventoryadjustments.truncated: true` with large net adjustment exposure.
- Closing-as-of mode but closing totals **identical** to legacy despite known post-`to_date` invoices/bills (date window or `document_date` missing on lines).
- Many families with `null` opening/closing where legacy had values (unit price / data regression).
- Totals change when running **legacy** twice in a row (indicates live-stock drift during the run — rerun with a shorter window).

## Multi-range Validation Results

Runs executed with `validate-weekly-report-reconstruction.js` against live Zoho (org `816097772`), generation date **2026-05-18**. No production flags were enabled; script-only env toggles.

### Cross-run patterns

| Pattern | Observation |
|---------|-------------|
| Period columns | **Unchanged** in every run — `sales_amount`, `purchase_amount`, and `returned_to_wholesale` matched legacy exactly in all four modes. |
| Warnings | **3** in every mode (standard historical-stock disclaimers only). No `source_truncated` or source-failure blocking reasons. |
| Adjustments-only | **No grand-total or family-level stock deltas** in any window. `inventoryadjustments.net_quantity_adjusted: 0` for all runs (no signed adjustment net in recon fetch windows, or adjustments outside scope). |
| Closing as-of | **Opening** grand totals always moved vs legacy when the period had movement; **closing** grand total often **unchanged** vs legacy because `to_date` is near “today” and post-`to_date` net movement is small at aggregate level. |
| Per-family closing Δ | In `slow_moving`, top families showed **closing Δ = 0** vs legacy (live stock already equals as-of-`to_date` at family level). Opening absorbed period reconstruction. |
| Closing + adjustments | **Identical totals to closing-as-of alone** in every run (adjustments had no net effect in these windows). |

---

### 1. `slow_moving` — 2026-05-01 → 2026-05-18 (short recent)

| Mode | Opening | Closing | Purchase | Returns | Sales |
|------|---------|---------|----------|---------|-------|
| Legacy | 45,123 | 37,295 | 0 | 0 | 5,349.23 |
| Adjustments only | 45,123 | 37,295 | 0 | 0 | 5,349.23 |
| Closing as-of | 37,295 | 37,295 | 0 | 0 | 5,349.23 |
| Closing + adj | 37,295 | 37,295 | 0 | 0 | 5,349.23 |

**Top 5 families (closing as-of vs legacy)** — opening Δ only; closing Δ = 0 each:

| Family | Legacy opening | Mode opening | Δ opening |
|--------|----------------|--------------|-----------|
| Acrylic | 7,220 | 1,052 | −6,168 |
| CUT | 6,217 | 4,774 | −1,443 |
| LIFESS | 1,362 | 1,145 | −217 |

**Period columns unchanged:** Yes. **Warnings:** 3. **Red flags:** None for reconstruction logic; `purchase_amount` 0 is a vendor/period data issue, not flag-related.

---

### 2. `slow_moving` — 2026-04-01 → 2026-04-30 (earlier month)

| Mode | Opening | Closing | Purchase | Returns | Sales |
|------|---------|---------|----------|---------|-------|
| Legacy | 57,386 | 37,295 | 361 | 190 | 8,146.22 |
| Adjustments only | 57,386 | 37,295 | 361 | 190 | 8,146.22 |
| Closing as-of | 37,124 | 37,295 | 361 | 190 | 8,146.22 |
| Closing + adj | 37,124 | 37,295 | 361 | 190 | 8,146.22 |

**Top 5 families (closing as-of vs legacy):**

| Family | Legacy opening | Mode opening | Δ opening | Legacy closing | Mode closing | Δ closing |
|--------|----------------|--------------|-----------|----------------|--------------|-----------|
| Acrylic | 16,973 | 1,098 | −15,875 | 1,052 | 1,052 | 0 |
| CUT | 7,705 | 4,774 | −2,931 | 4,774 | 4,774 | 0 |
| FL SHINE | 12,980 | 12,002 | −978 | 12,002 | 12,002 | 0 |
| LIFESS | 1,368 | 1,040 | −328 | 1,145 | 1,145 | 0 |
| APRON | 5,535 | 5,385 | −150 | 5,385 | 5,385 | 0 |

**Period columns unchanged:** Yes. **Warnings:** 3. **Red flags:** Large opening drops with zero closing change at family level — expected when `to_date` is in the past but live closing already reflects “now”; finance should sanity-check Acrylic/CUT opening vs books.

---

### 3. `slow_moving` — 2026-05-15 → 2026-05-18 (very short)

| Mode | Opening | Closing | Purchase | Returns | Sales |
|------|---------|---------|----------|---------|-------|
| Legacy | 37,406 | 37,295 | 0 | 0 | 105.71 |
| Adjustments only | 37,406 | 37,295 | 0 | 0 | 105.71 |
| Closing as-of | 37,295 | 37,295 | 0 | 0 | 105.71 |
| Closing + adj | 37,295 | 37,295 | 0 | 0 | 105.71 |

**Top families (closing as-of):** Only **LIFESS** material — opening 1,256 → 1,145 (Δ −111); closing Δ 0.

**Period columns unchanged:** Yes. **Warnings:** 3. **Red flags:** None. Short window behaves as expected (small sales, opening converges toward live closing).

---

### 4. `other_family` — 2026-05-01 → 2026-05-18

67 families (unmapped Zoho families). Same period columns across modes.

| Mode | Opening | Closing | Purchase | Returns | Sales |
|------|---------|---------|----------|---------|-------|
| Legacy | 1,400,078.34 | 1,448,785.34 | 240,395 | 691 | 177,868.09 |
| Adjustments only | 1,400,078.34 | 1,448,785.34 | 240,395 | 691 | 177,868.09 |
| Closing as-of | 1,209,081.34 | 1,448,785.34 | 240,395 | 691 | 177,868.09 |
| Closing + adj | 1,209,081.34 | 1,448,785.34 | 240,395 | 691 | 177,868.09 |

**Top 5 families (closing as-of vs legacy)** — by \|Δopening\|:

| Family | Legacy opening | Mode opening | Δ opening | Δ closing |
|--------|----------------|--------------|-----------|-----------|
| LIFEP17S | 104,507 | 77,630 | −26,877 | 0 |
| SPHM-S | 13,713 | **−9,064** | −22,777 | 0 |
| LIFEP17 | 163,407 | 141,167 | −22,240 | 0 |
| LIFEP7S (not in groups) | 446,038 | 425,641 | −20,397 | 0 |
| LIFEP18 | 52,374 | 36,540 | −15,834 | 0 |

**Period columns unchanged:** Yes. **Warnings:** 3. **Red flags:**

- **Negative reconstructed opening** at family level (e.g. SPHM-S −9,064) — sales-price valuation × reconstructed qty can go negative when movement net exceeds anchor; needs business review before trusting family-level opening in `other_family`.
- Very large aggregate opening swing (−191k) with **unchanged** closing grand total — same structural pattern as `slow_moving`, amplified by family count.

---

## Final recommendation

| Flag | Recommendation |
|------|----------------|
| **All flags (production)** | **Keep off** until staging sign-off. |
| **`WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS`** | **Do not enable yet.** Validation showed zero net adjustment effect in all tested windows (`net_quantity_adjusted: 0`). Re-run after confirming Zoho has adjustments in-range, or validate a window known to contain adjustments. |
| **`WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE`** | **Enable only in staging** for manual business review with finance/ops. Math behaves consistently (period columns stable, opening anchored on reconstructed closing, no extra warnings). Not safe for blind production enablement: large opening shifts, and **negative family-level opening** possible on broad groups like `other_family`. |
| **Closing + adjustments** | Same as closing-as-of for these runs; no incremental benefit observed until adjustments contribute non-zero net qty. |

**Suggested path:** Staging with `WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1` → compare 2–3 report windows per group with finance → spot-check top Δ families (especially negative opening) → only then consider production, still without adjustments flag until adjustment data validates.

## Related design

See `docs/weekly-sales-reconstruction-design.md` for formulas and phase plan.
