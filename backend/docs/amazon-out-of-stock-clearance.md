# Amazon Out of Stock Clearance

Admin-only workflow under **Amazon** navigation: `/ai/amazon-out-of-stock-clearance`.

## Purpose

1. Fetch Amazon UAE or KSA SKUs where FBA **fulfillable quantity is 0** (active listings report + FBA inventory summaries).
2. Load **Life Smile Warehouse** Zoho stock for those SKUs only.
3. Upload **Vigil wholesale** stock (session-only; not saved to Purchase Planning `vigil_stock_uploads`).
4. Calculate recommended Amazon replenishment qty = Zoho Life Smile + Vigil (optional cap).
5. Export Excel; manual overrides preserved on recalculate.

**Amazon inventory write (Stage 2)** is **not enabled**. `POST /api/amazon/out-of-stock-clearance/update-amazon` returns `501` `AMAZON_INVENTORY_UPDATE_NOT_ENABLED`.

## API routes

All require `requireAuth` + `requireAdmin`.

| Method | Path |
|--------|------|
| GET | `/api/amazon/out-of-stock-clearance/out-of-stock?marketplace=UAE\|KSA` | **Fast** — OOS rows from `amazon_zoho_stock_comparison` cache |
| POST | `/api/amazon/out-of-stock-clearance/out-of-stock/fetch` | Start **background** live SP-API job (202; poll below) |
| GET | `/api/amazon/out-of-stock-clearance/out-of-stock/fetch/:jobId` | Poll job; returns `rows` when `completed` |
| POST | `/api/amazon/out-of-stock-clearance/zoho-stock` |
| POST | `/api/amazon/out-of-stock-clearance/vigil-preview` (multipart `file`, optional `columnMapping` JSON) |
| POST | `/api/amazon/out-of-stock-clearance/calculate` |
| POST | `/api/amazon/out-of-stock-clearance/export` |
| POST | `/api/amazon/out-of-stock-clearance/update-amazon` (stub 501) |

## Environment

| Variable | Purpose |
|----------|---------|
| `ZOHO_LIFE_SMILE_WAREHOUSE_ID` / `LIFE_SMILE_WAREHOUSE_ID` / `PURCHASE_PLANNING_WAREHOUSE_ID` | Zoho warehouse ID |
| `ZOHO_LIFE_SMILE_WAREHOUSE_NAME` / `PURCHASE_PLANNING_WAREHOUSE_NAME` | Warehouse name fallback (`Life Smile Warehouse` / `LIFE SMILE`) |
| `AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY` | Optional server-side cap on recommended qty |
| `AMAZON_UAE_*` / `AMAZON_KSA_*` | Existing SP-API credentials |

## Shared code

- `amazonListingsInventoryReadService.js` — listings report + FBA inventory (also used by Amazon + Zoho Stock refresh).
- `zohoLifeSmileWarehouseService.js` — Life Smile warehouse stock map.
- `vigilStockParseService.js` — Vigil CSV/XLSX parse (also used by Purchase Planning).
- `purchasePlanningSkuMatcher.js` — Zoho ↔ Vigil color/base matching.

## Manual QA checklist

1. Log in as **admin**, open `/ai/amazon-out-of-stock-clearance`.
2. Select **UAE**, click **Fetch Amazon Out of Stock SKUs** — expect loading, then rows or empty state with warning.
3. Upload Vigil file — **Preview**, fix column mapping if prompted, **Confirm Vigil data**.
4. Click **Calculate Recommended Amazon Stock** — summary cards and table populate.
5. **Edit** a row, save manual override — recalculate preserves recommended qty.
6. Export **full** and **Ready to Update** Excel files.
7. Confirm **Update Selected SKUs on Amazon** is disabled.
8. Repeat with **KSA** if credentials configured.

## Limitations

- OOS = FBA fulfillable qty 0; merchant-fulfilled listing quantity not used.
- Live SP-API uses a **background job** (CloudFront origin timeout ~30s cannot hold a synchronous report poll). Use **Load from cache** for instant results after **Amazon + Zoho Stock → Refresh**.
- Vigil upload is in-memory for the session only.
