# Zoho Inventory API — what the weekly report uses (and what it does not)

The backend loads weekly report rows from **Zoho Inventory REST v1** (OAuth2 refresh token, then `GET /inventory/v1/items` with pagination). The **group** filter (`slow_moving`, `other_family`, …) is **only** from the HR `item_report_groups` table, unchanged from the old Deluge era.

## What the public API provides for each item

| Need | Zoho field / behaviour | Used in HR |
|------|------------------------|------------|
| SKU | `item.sku` | Yes — primary key for group membership |
| Item name | `item.name` | Yes → `item_name` |
| Zoho internal id | `item.item_id` | Yes → `item_id` (string) |
| **Family** (custom) | `item.custom_fields[]` with `customfield_id` + `value` | Yes → `family` when `ZOHO_FAMILY_CUSTOMFIELD_ID` is set; otherwise `""` |
| Current stock | Sum of per-location `location_available_stock` (or `location_stock_on_hand` fallback) from `item.locations[]` | Yes → `closing_stock` in the report (see note below) |

## Gap vs. the old Deluge / “Inventory Summary” report

Zoho’s UI **Inventory Summary**-style report (and your former Deluge function) can expose, per **arbitrary date range** `from_date`–`to_date`:

- Opening stock at the start of the range  
- Purchases in the range  
- Returned to wholesale in the range  
- Closing stock at the end of the range  
- Sold in the range  

**Those period totals are not returned as a single `items` row in the [Items API](https://www.zoho.com/inventory/api/v1/items/).** Reconstructing the same five numbers in Node would require aggregating many other resources (bills, invoices, transfer orders, return flows, etc.) and would not be guaranteed to match Zoho’s internal “Summary” without an explicit, documented, line-by-line mapping. Per product rules we **do not** implement undisclosed or hidden math.

**Current behaviour in HR:**

- `closing_stock` is filled from **current** location stock as returned by the Items API at request time. It is **not** a historical end-of-`to_date` snapshot unless your operational clock aligns with that instant.
- `opening_stock`, `purchases`, `returned_to_wholesale`, and `sold` are returned as JSON **`null`**. The UI and Excel show **"—"**; Grand Total for a column is **"—"** if any row has `null` in that field.

## Environment variables (backend)

| Variable | Purpose |
|----------|--------|
| `ZOHO_CLIENT_ID` | OAuth client |
| `ZOHO_CLIENT_SECRET` | OAuth client |
| `ZOHO_REFRESH_TOKEN` | Long-lived refresh token (generate in Zoho API console) |
| `ZOHO_ORGANIZATION_ID` (or legacy `ZOHO_INVENTORY_ORGANIZATION_ID`) | Organization id in Zoho Inventory |
| `ZOHO_API_BASE_URL` (or legacy `ZOHO_INVENTORY_API_BASE`) | API host, default `https://www.zohoapis.com` |
| `ZOHO_FAMILY_CUSTOMFIELD_ID` | (Recommended) The Zoho `customfield_id` for the **Family** field on items. Without it, `family` is always `""`. |
| `ZOHO_ACCOUNTS_BASE` | Default `https://accounts.zoho.com` — set `https://accounts.zoho.eu` etc. if your DC differs |
| `ZOHO_INVENTORY_API_BASE` | Default `https://www.zohoapis.com` |
| `ZOHO_API_TIMEOUT_MS` | HTTP timeout (default 20000) |

Previous webhook variables (`ZOHO_REPORT_WEBHOOK_URL`, `ZOHO_REPORT_WEBHOOK_AUTH_HEADER`, …) are **no longer used** for weekly reports.

## Scopes

Create the OAuth client with at least: **`ZohoInventory.items.READ`**.

## Related code

- `backend/src/integrations/zoho/` — OAuth, HTTP, Inventory client  
- `backend/src/services/weeklyReportZohoData.js` — item → report row (no Deluge)  
- `backend/src/services/zohoService.js` — validation + group filter  
