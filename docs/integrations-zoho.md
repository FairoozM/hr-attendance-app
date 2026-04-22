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

## Code layout

- `backend/src/integrations/zoho/zohoConfig.js` — read env, resolve org/api base aliases  
- `zohoHttp.js` — HTTPS with timeout → `ZOHO_API_TIMEOUT`  
- `zohoOAuth.js` — access token from refresh  
- `zohoInventoryClient.js` — Zoho API calls (transport)  
- `zohoItemFamily.js` — parse **Family** from `custom_fields`; `normalizeZohoInventoryItem`  
- `zohoAdapter.js` — facade (`getItems` → normalized items, `fetchAllItemsRaw` → raw API rows)  
- `zohoDelugeWebhookAdapter.deprecated.js` — **deprecated** placeholder (not used in routes)  
- `weeklyReportZohoData.js` — `fetchAllItemsRaw` + `normalizeZohoInventoryItem` → report rows (with `_zoho` metadata)  
- `zohoService.js` — validate rows, attach `_zoho` on API items, `item_report_groups` filter  

## Business report groups

Still **`item_report_groups` only**. Zoho **Family** is display metadata, not a membership key.

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
