# SPHM-S negative opening — debug findings

Read-only investigation for **closing-as-of** reconstruction (`WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1`) on:

| Parameter | Value |
|-----------|--------|
| Group | `other_family` |
| Family | `SPHM-S` |
| Period | 2026-05-01 → 2026-05-18 |
| Through (today at run) | 2026-05-18 |

**Script:** `backend/scripts/debug-weekly-report-negative-family.js`

```bash
node backend/scripts/debug-weekly-report-negative-family.js \
  --group other_family --family SPHM-S --from 2026-05-01 --to 2026-05-18
```

No production flags were enabled. One report build + cached recon lists (no extra Zoho burst beyond normal report traffic).

---

## Executive summary

**Root cause (best hypothesis):** Negative opening is **not** because invoice sales quantities exceed live stock in the reconstruction window. It is because **bill (purchase) quantities in the opening window exceed live on-hand quantity**, while **invoice-based sales quantities in that same window sum to zero** for SPHM-S SKUs—even though **period `sales_amount` is ~$20,948** from the separate Sales-by-Item path.

Closing-as-of logic is working as coded:

```
q_close@to_date = q_now − netΔ(after to_date)   → 135 − 0 = 135  (no post–to_date movement)
q_open@from_date = q_close − netΔ(opening window)
netΔ(opening) = purchases − sales − vendor_credits  → 215 − 0 − 0 = 215
q_open = 135 − 215 = −80 units (family total)
```

At **SKU level**, **48 of 129** rows have negative reconstructed opening qty; the worst cases are SKUs with **live qty 0** but **positive bill lines in May** (inbound only in recon).

---

## Family-level numbers (2026-05-01 → 2026-05-18)

| Metric | Value |
|--------|------:|
| Family aggregate opening (value) | **−9,064** |
| Family aggregate closing (value) | **33,626** |
| Period `sales_amount` (unchanged by flags) | **20,948.47** |
| Sum of live `q_now` (units) | **135** |
| Invoice sales qty — opening window | **0** |
| Invoice sales qty — after to_date | **0** |
| Bill purchase qty — opening window | **215** |
| Bill purchase qty — after to_date | **0** |
| Vendor credit qty (both windows) | **0** |
| Inventory adjustments (both windows) | **0** |
| Reconstructed closing qty (sum) | **135** |
| Reconstructed opening qty (sum) | **−80** |

Formula check: `135 − 215 = −80` ✓

Because `to_date` equals run date (2026-05-18), the **after-to_date window is empty**, so reconstructed closing qty equals live qty. The negative opening is entirely from the **opening window** (May 1–18 bills with no offsetting invoice sales in recon).

---

## Top contributors (negative opening qty)

| SKU | q_now | purch (open) | sales (open) | q_close | q_open | Sample bills |
|-----|------:|-------------:|-------------:|--------:|-------:|--------------|
| 6294021014519 | 0 | 9 | 0 | 0 | **−9** | 2026-05-04, 05-08, 05-18 |
| 6294021013048 | 1 | 7 | 0 | 1 | **−6** | 2026-05-08, 05-18 |
| 6294021014571 | 0 | 6 | 0 | 0 | **−6** | 2026-05-08, 05-15, 05-18 |
| 6294021014151 | 2 | 7 | 0 | 2 | **−5** | 2026-05-04, 05-08, 05-18 |
| 6294021013307 | 1 | 6 | 0 | 1 | **−5** | 2026-05-08, 05-15, 05-18 |
| 6294021007955 | 1 | 5 | 0 | 1 | **−4** | 2026-05-08, 05-18 |
| 6294021007870 | 0 | 4 | 0 | 0 | **−4** | 2026-05-04, 05-15 |
| 6294021007962 | 1 | 5 | 0 | 1 | **−4** | 2026-05-08, 05-18 |
| 6294021007979 | 1 | 5 | 0 | 1 | **−4** | 2026-05-08, 05-18 |
| 6294021013901 | 1 | 5 | 0 | 1 | **−4** | 2026-05-08, 05-18 |

Document samples show **only purchase (bill) lines**—no sales, vendor credit, or adjustment lines for these SKUs in the recon lists.

---

## Answers to investigation questions

### 1. Is negative opening caused by sales quantities exceeding current stock?

**No—not in the reconstruction movement set.**

- Period **`sales_amount` is ~$20,948** (Sales-by-Item / period column).
- **Invoice sales quantities in the opening window are 0** for all summed SPHM-S SKUs.
- Negative opening is driven by **purchases (215 units) > live stock (135 units)** with **no sales offset in the same recon pipeline**.

So the business sees high sales dollars on the report, but **stock reconstruction does not subtract those sales** for this family in May (invoice recon path).

### 2. Are purchases missing?

**No—purchases are present and are the main driver.**  
215 units from bills in `(2026-05-01, 2026-05-18]`. Many SKUs with `q_now = 0` still show bill qty (inbound in books, not yet on hand or already sold via channels not in invoice recon).

### 3. Are transfer orders likely needed?

**Likely yes** for a trustworthy full ledger. SPHM-S is a large SKU family (129 lines). Inbound bills without matching invoice-outbound in recon, plus high period sales $, is consistent with **stock moving via paths not modeled** (transfers between warehouses, assemblies, or shipments not aligned to invoice line items).

### 4. Are sales returns / credit notes likely needed?

**Possibly**, but **vendor credits in recon are 0** for this family in May. Customer **credit notes / sales returns** are not in the formula yet; if returns exist in Zoho, they would reduce outbound and change opening. Worth checking separately—they are not the primary explanation here because **sales outbound is already zero** in recon.

### 5. Is family mapping or SKU matching wrong?

**Unlikely for this case.**

- All 129 item rows show Zoho custom field family **`SPHM-S`**.
- SKUs are distinct barcodes (e.g. `6294021014519`, `SPHM-S-NSET-BEIGE`, `SPHMGL-S-28-BLUE`).
- Negative opening is explained per-SKU by **bills − live**, not by wrong family bucket.

### 6. Is SPHM-S a composite/bundle family causing parent/component mismatch?

**Possible operational factor, not a code bug.**

- Many SKUs are **sets** (`NSET`, `2HWOK`, `3F`, `SHR`, pot sizes `16P`/`20P`/`24P`).
- Bills often hit **set SKUs** while live stock sits on **other variants** with `q_now > 0`.
- That amplifies “inbound on paper, no on-hand” per line—but the **dominant issue remains sales not flowing through invoice recon** while purchases do.

### 7. What exact sources are missing before closing-as-of can be trusted?

| Source | Status in May SPHM-S debug | Impact |
|--------|---------------------------|--------|
| **Invoices (sales qty in recon)** | **0 units in opening window** despite **$20,948 period sales** | Critical gap — opening omits outbound |
| Bills (purchases) | Present (215 units) | Drives negative opening |
| Vendor credits | 0 in window | — |
| Inventory adjustments | 0 in window | — |
| Sales returns / credit notes | Not in formula | Unknown |
| Transfer orders | Not in formula | Likely material for this family |
| Align Sales-by-Item with invoice recon | Architectural | Period sales $ do not affect `q_open` today |

**Before trusting closing-as-of for SPHM-S / other_family:**

1. Reconcile why **Sales-by-Item period sales** do not appear as **invoice line quantities** on the same SKUs in the recon window (mapping, timing, B2B vs retail channel, or invoice date vs sales date).
2. Add or validate **transfer orders** (and eventually returns) for large `other_family` buckets.
3. Treat **negative opening qty** as “incomplete ledger,” not as physical negative stock—valuation multiplies negative qty × sales price → large negative **opening value** (−$9,064 family total).

---

## Closing-as-of behavior for this run

- `closing_reconstruction_window`: `(2026-05-18, 2026-05-18]` → **empty** (to_date is today).
- Reconstructed **closing qty = live qty** (135).
- Reconstructed **opening** absorbs full May bill activity without May invoice sales in recon.
- Family **closing value** (33,626) vs sum of item closing amounts differs because aggregation uses **valued family row** from many SKUs (including high unit prices on lines with qty 0).

---

## Recommendation

| Action | Guidance |
|--------|----------|
| **Production flags** | Keep **off** |
| **Closing-as-of for `other_family`** | **Not trustworthy** until invoice sales appear in recon for families with high `sales_amount`, or sales-by-item qty is wired into reconstruction |
| **SPHM-S specifically** | Use as a **case study**: compare Zoho Sales-by-Item vs invoice lines for top-selling SKUs in May |
| **Next debug** | Pick one high-sales SKU from period salesbyitem; dump invoice lines vs bill lines for that `item_id` in May |

---

## Related docs

- [weekly-sales-reconstruction-validation.md](./weekly-sales-reconstruction-validation.md) — multi-range flag comparison  
- [weekly-sales-reconstruction-design.md](./weekly-sales-reconstruction-design.md) — formulas and phases  
- Script: [backend/scripts/debug-weekly-report-negative-family.js](../backend/scripts/debug-weekly-report-negative-family.js)
