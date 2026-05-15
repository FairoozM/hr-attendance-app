# Amazon Advertising API setup (UAE / KSA)

This application can pull **Sponsored Products** campaign-level **cost** and **clicks** from the **Amazon Advertising API** (reporting v3). That path is **not** Amazon Selling Partner API (SP-API). Orders, catalog images, and inventory continue to use SP-API only.

## Facts

- **Different host:** e.g. EU Ads `https://advertising-api-eu.amazon.com` (see `AMAZON_ADS_API_ENDPOINT`).
- **Different consent:** the LWA **refresh token** used for Ads must be authorized with **Advertising API** scopes (e.g. `advertising::campaign_management`). A refresh token that only has SP-API selling roles will fail with errors such as **“no advertising scope is found”** when you call Ads endpoints or exchange token with an Ads scope.
- **Profiles:** most Ads calls need a **profile id** sent as header `Amazon-Advertising-API-Scope`. Discover ids with **`GET /v2/profiles`** after you have a working Ads-scoped access token. Store them in **`AMAZON_UAE_ADS_PROFILE_ID`** and **`AMAZON_KSA_ADS_PROFILE_ID`**.
- **Spend/clicks in app:** implemented in `amazonAdvertisingService.js` via **async report** `POST /reporting/reports` (Sponsored Products `spCampaigns`, `SUMMARY`, group by campaign), then poll and download GZIP JSON.

## Configuration (backend `.env`)

See **`backend/.env.example`** — Ads section. Summary:

| Variable | Role |
|----------|------|
| `AMAZON_ADS_API_ENDPOINT` | Ads API base URL (default EU). Alias: `AMAZON_ADS_API_HOST`. |
| `AMAZON_ADS_LWA_SCOPE` | Sent on LWA token exchange with Ads refresh token (default `advertising::campaign_management`). |
| `AMAZON_UAE_ADS_REFRESH_TOKEN` / `AMAZON_KSA_ADS_REFRESH_TOKEN` | **Required** Ads refresh tokens (do not confuse with `AMAZON_UAE_REFRESH_TOKEN` / SP-API). |
| `AMAZON_UAE_ADS_PROFILE_ID` / `AMAZON_KSA_ADS_PROFILE_ID` | Profile ids from `/v2/profiles`. |
| `AMAZON_*_ADS_LWA_CLIENT_ID` / `SECRET` | Optional; in **production**, if omitted, the code falls back to **`AMAZON_UAE_LWA_CLIENT_ID`** / **`AMAZON_KSA_*`** (same LWA app as SP-API is allowed). |
| `AMAZON_ADS_ALLOW_SP_API_REFRESH_TOKEN_FALLBACK` | Set to **`1`** only if you intentionally use the **SP-API** regional refresh token for Ads **and** that token includes Advertising scopes. **Default is off** so Ads never silently uses the wrong refresh token. |

Resolver logic lives in **`backend/src/services/amazonAdsConfigService.js`** (`getAmazonAdsConfig`).

## Safe test commands (from `backend/`)

After filling `.env` (never commit real secrets):

1. **LWA token (Ads scope)** — confirms refresh token + client + scope:

   ```bash
   npm run test:amazon-ads-lwa-uae
   npm run test:amazon-ads-lwa-ksa
   ```

2. **List profiles** — confirms token works against Ads API:

   ```bash
   npm run test:amazon-ads-profiles-uae
   npm run test:amazon-ads-profiles-ksa
   ```

Scripts print only **SUCCESS/FAILED**, marketplace, HTTP/token metadata, **12-character access token preview**, and safe error snippets — not full tokens, refresh tokens, or client secrets.

## Identifying UAE vs KSA profile rows

Open the JSON lines from `test-amazon-ads-profiles-*` and match:

- **`countryCode`** / **`currencyCode`** / **`accountInfo.marketplaceStringId`** (e.g. AE vs SA) to your intended marketplace.
- Use the **`profileId`** value in the matching row for `AMAZON_UAE_ADS_PROFILE_ID` or `AMAZON_KSA_ADS_PROFILE_ID`.

If one LWA identity owns both countries, you may see multiple profiles; pick the correct one per region.

## If you see “no advertising scope is found”

1. In Amazon LWA / Login with Amazon, **re-authorize** the application with **Advertising API** permissions so the issued refresh token includes the required scope (aligned with `AMAZON_ADS_LWA_SCOPE`).
2. Put that **Ads-specific** refresh token in **`AMAZON_UAE_ADS_REFRESH_TOKEN`** / **`AMAZON_KSA_ADS_REFRESH_TOKEN`** (do not assume the SP-API production refresh token works unless you know it carries Ads scopes).
3. Re-run **`npm run test:amazon-ads-lwa-uae`** until **SUCCESS**.

## Code map (Ads only)

| Piece | File |
|-------|------|
| Env resolution + validation | `backend/src/services/amazonAdsConfigService.js` |
| Reporting (spend/clicks) | `backend/src/services/amazonAdvertisingService.js` |
| Weekly Ads API route | `POST /api/weekly-reports/weekly-ads/amazon-ads` — `weeklyReportsController.js` |

SP-API orders, cache sync, and image helpers are unchanged by Ads work unless you explicitly share LWA app ids (supported fallback above).
