# Zoho integration (Node backend)

Weekly reports use the **Zoho Inventory REST API** from the Express backend (OAuth refresh token + `GET /inventory/v1/items`). **Deluge custom functions are not** the primary report engine.

## Environment (backend)

| Variable | Required | Notes |
|----------|----------|--------|
| `ZOHO_CLIENT_ID` | Yes | OAuth client |
| `ZOHO_CLIENT_SECRET` | Yes | OAuth client |
| `ZOHO_REFRESH_TOKEN` | Yes | Long-lived refresh token |
| `ZOHO_ORGANIZATION_ID` | Yes | Zoho organization id (alias: `ZOHO_INVENTORY_ORGANIZATION_ID`) |
| `ZOHO_API_BASE_URL` | No | Default `https://www.zohoapis.com` (alias: `ZOHO_INVENTORY_API_BASE`) |
| `ZOHO_ACCOUNTS_BASE` | No | Default `https://accounts.zoho.com` (use `.eu` / other DC if needed) |
| `ZOHO_FAMILY_CUSTOMFIELD_ID` | No | Item custom field for **Family** (metadata only) |
| `ZOHO_API_TIMEOUT_MS` | No | Default 20000 |
| `WEEKLY_REPORT_VENDORS_JSON` | No | Per-`report_group` vendor scoping for **vendor credits** and optional **purchases** (contact ids). SOLD and stock are never filtered by vendor. See `backend/src/services/weeklyReportVendorConfig.js`. |
| `WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID` | No | Fallback: Zoho **contact** id for vendor-credit (returned-to-wholesale) lines if not set in JSON. |
| `WEEKLY_REPORT_PURCHASES_MODE` | No | `unfiltered` (default) or `by_contact_id` with `WEEKLY_REPORT_PURCHASES_CONTACT_ID` |
| `WEEKLY_REPORT_PURCHASES_CONTACT_ID` | No | When purchases mode is `by_contact_id`, count purchases for this contact only. |
| `WEEKLY_REPORT_VENDOR_DEBUG` | No | `1` = include `zoho.vendor_filter_debug` in production (booleans only, no ids). |
| `REPORT_VENDOR_ID` / `REPORT_VENDOR_NAME` | No | Whitelist vendor for **Bills** (purchases) and **vendor credits** (returned to wholesale) only; `sold` is still all vendors. |
| `WEEKLY_REPORT_VENDOR_OPTIONAL` | No | `1` = allow missing `REPORT_VENDOR_ID` in dev/test; default requires vendor for non-empty reports. |
| `docs/weekly-report-zoho-transactions.md` | | Full assumptions, scopes, and the derived **opening** formula. |

## Code layout

- `backend/src/integrations/zoho/zohoConfig.js` — read env, resolve org/api base aliases  
- `zohoHttp.js` — HTTPS with timeout → `ZOHO_API_TIMEOUT`  
- `zohoOAuth.js` — access token from refresh  
- `zohoInventoryClient.js` — Zoho API calls (transport)  
- `zohoItemFamily.js` — parse **Family** from `custom_fields`; `normalizeZohoInventoryItem`  
- `zohoAdapter.js` — facade (`getItems` → normalized items, `fetchAllItemsRaw` → raw API rows)  
- `zohoDelugeWebhookAdapter.deprecated.js` — **deprecated** placeholder (not used in routes)  
- `weeklyReportZohoData.js` — `fetchZohoItemRowsForGroupMembers`: `item_report_groups` ∩ Zoho items, placeholder stock (see `phase2_stock_placeholders` in `ZOHO_WEEKLY_REPORT_INTEGRATION`)  
- `zohoService.js` — validate rows, attach `_zoho` on API items; membership driven by `fetchZohoItemRowsForGroupMembers` (no post-filter)  

## Business report groups

Still **`item_report_groups` only**. Zoho **Family** is display metadata, not a membership key.

## Temporary debug (remove in production)

- `GET /api/debug/zoho/items` (admin JWT) — first 20 items: `getItems()` + `fetchAllItemsRaw` merged; see `debugZohoController.js`.

## Gaps vs Deluge “summary”

See `docs/zoho-inventory-api-coverage.md` — period-level columns may be `null` when the public Items API does not provide them; no hidden calculations.

## Error codes (JSON `code` field)

| Code | Typical HTTP |
|------|----------------|
| `ZOHO_NOT_CONFIGURED` | 503 |
| `ZOHO_OAUTH_ERROR` | 502 (auth / token refresh) |
| `ZOHO_API_ERROR` | 502 |
| `ZOHO_API_TIMEOUT` | 504 |
| `ZOHO_API_NETWORK_ERROR` | 502 |
| `WEBHOOK_INVALID_RESPONSE` | 502 (invalid row shape; name kept for compatibility) |
