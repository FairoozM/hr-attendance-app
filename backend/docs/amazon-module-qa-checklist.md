# Amazon SP-API module — QA checklist (production phase 1)

Use this document before go-live and after any material change to Amazon credentials, sync logic, or dashboard queries. Check items in order where dependencies exist (environment before sync, sync before accuracy).

**Related docs:** `amazon-spapi-architecture.md`, `amazon-spapi-versions.md`, `amazonSpApiGuardrails.js` (source).

---

## 1. Environment verification

- [ ] **`AMAZON_SP_API_MODE`** matches intent: production vs sandbox (see `backend/.env.example` and team runbook). Wrong mode → wrong host or wrong token pairing.
- [ ] **SP-API base URL**: `AMAZON_PROD_SP_API_ENDPOINT` / `AMAZON_SANDBOX_SP_API_ENDPOINT` (or documented aliases) point to the correct Amazon region and environment.
- [ ] **UAE refresh token path**: `AMAZON_UAE_REFRESH_TOKEN` present; LWA pair `AMAZON_UAE_LWA_CLIENT_ID` + `AMAZON_UAE_LWA_CLIENT_SECRET`; `AMAZON_UAE_MARKETPLACE_ID` matches Seller Central marketplace for UAE.
- [ ] **KSA refresh token path**: `AMAZON_KSA_REFRESH_TOKEN` present; LWA pair `AMAZON_KSA_LWA_CLIENT_ID` + `AMAZON_KSA_LWA_CLIENT_SECRET`; `AMAZON_KSA_MARKETPLACE_ID` matches Seller Central marketplace for KSA.
- [ ] **Sandbox single-app aliases** (if used): commented or set consistently when `AMAZON_SP_API_MODE` is not production — no mixed prod/sandbox tokens on one process.
- [ ] **Backend URL** the SPA calls is the same origin (or configured API base) that mounts `/api/amazon/*` — no accidental pointing at a stale server.
- [ ] **No secrets committed**: `.env` / real tokens absent from git; only `backend/.env.example` (placeholders) in repo. CI and image builds use injected secrets, not baked files.

---

## 2. Backend verification

- [ ] **Marketplace discovery**: `npm run test:amazon-marketplaces` (from `backend/`) succeeds for the configured mode; returns expected marketplace participation data without exposing secrets in logs.
- [ ] **Production marketplace smoke (if prod)**: `npm run test:amazon-prod-uae` and/or `npm run test:amazon-prod-ksa` as applicable.
- [ ] **Sandbox smoke (if sandbox)**: `npm run test:amazon-spapi` (or team’s equivalent) passes.
- [ ] **Cache tables**: `npm run db:amazon-cache:ensure` completes without migration errors; `amazon_orders`, `amazon_order_items`, `amazon_sync_log`, `amazon_api_call_log` (and related) exist as expected.
- [ ] **UAE sync**: `npm run test:amazon-cache-sync-uae` (or controlled `POST /api/amazon/orders/sync` with a small window) completes; sync log row shows sensible counts and terminal status.
- [ ] **KSA sync**: `npm run test:amazon-cache-sync-ksa` (or equivalent POST) completes; same checks as UAE.
- [ ] **Cache read**: `npm run test:amazon-cache-read-uae` / `test:amazon-cache-read-ksa` (or `GET /api/amazon/orders` with JWT) returns cached rows without calling Amazon for the read path.
- [ ] **Request ID on error path**: `npm run test:amazon-error-request-id` (or intentional bad request that still returns a safe client payload) confirms **Amazon Request ID** surfaces where designed for support, without raw upstream bodies in logs/UI.
- [ ] **Safety audit**: `npm run audit:amazon-spapi-safety` exits **0** on the branch you are shipping.

---

## 3. Frontend verification

- [ ] **Amazon Orders** (`/ai/amazon-orders`): loads from cache on initial load; date range and marketplace selectors work; sync button behavior matches role (admin/warehouse vs others); errors show safe messages only.
- [ ] **Amazon BI Dashboard** (`/ai/amazon-dashboard`): loads aggregates from `GET /api/amazon/dashboard/orders` (cache path); preset/custom ranges behave; no unexpected live Amazon traffic when only opening the page.
- [ ] **Amazon Sync Health** (`/ai/amazon-sync-health`): visible **only to admin** in nav; page loads `GET /api/amazon/sync/health` (and optional `GET /api/amazon/rate-limits`); UAE/KSA cards, tables, cooldown, and request IDs render; **Refresh** works.
- [ ] **Non-admin blocking**: non-admin user cannot open `/ai/amazon-sync-health` (redirect to account or equivalent); `GET /api/amazon/sync/health` and `GET /api/amazon/rate-limits` return **403** with non-admin JWT.

---

## 4. Data accuracy verification

Perform after a successful sync for an explicit **createdAfter / createdBefore** window you can reproduce in Seller Central.

- [ ] **Order count (spot check)**: Seller Central (or Reports) **yesterday** (or chosen day) order count for the marketplace **≈** dashboard/orders cache count for the same window (allow small timing skew for “created” vs “last updated” definitions — document any known delta).
- [ ] **Total sales by marketplace**: BI dashboard totals for UAE vs KSA align with expectations from Seller Central or exported reports for the same range (currency and tax display understood).
- [ ] **SKU presence**: known SKUs from recent orders appear in line items / dashboard breakdown where expected; no systematic empty SKU column when Amazon returned ASIN/SKU.
- [ ] **Image behavior**: SKU thumbnails or catalog-backed images match policy (lazy load, fallbacks); `includeSkuImages` off vs on if you test both; no broken layout when images missing.

---

## 5. Guardrail verification

- [ ] **Manual sync cooldown**: after a finished sync, immediate second manual sync is **rejected or skipped** with the documented reason until cooldown elapses (`MANUAL_SYNC_COOLDOWN_MINUTES` in `amazonSpApiGuardrails.js`).
- [ ] **Max range**: selecting or posting a range **wider than 7 days** is rejected (or clamped) consistently on UI and API (`MAX_SYNC_RANGE_DAYS`).
- [ ] **No live Amazon on page load**: network tab on Orders and BI Dashboard shows **no** SP-API calls from the browser; only your backend `/api/amazon/orders`, `/api/amazon/dashboard/orders`, `/api/amazon/sync/status`, etc.
- [ ] **No buyer PII in UI**: no full addresses, phone numbers, or buyer email in tables or tooltips; sync health and errors remain **safe summaries** only.

---

## 6. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| **Incomplete cache / “range not covered”** | Run sync for the exact window; inspect `amazon_sync_log` success rows and `GET /api/amazon/sync/status` / Sync Health `recentSyncs`. |
| **HTTP 429 throttling** | Inspect `amazon_api_call_log`, Sync Health **recent429Count** and rate-limit summary; increase spacing between operations; avoid parallel syncs; wait and retry. |
| **403 unauthorized** | LWA credentials, refresh token revoked/expired, wrong marketplace app pairing, or calling admin-only routes without admin role. |
| **Missing SKU** | Order item payload in cache — catalog enrichment path; confirm ASIN/Seller SKU mapping in Amazon reports. |
| **Missing images** | Catalog image cache / rate limits; `AMAZON_DEBUG_CATALOG_IMAGES` only in non-prod if used; dashboard `includeSkuImages` flag. |
| **Amazon Support** | Collect **`amazonRequestId`** from error responses, sync metadata, Sync Health, or `amazon_api_call_log`; include marketplace, approximate time (UTC), and operation name. Never send refresh tokens or client secrets. |

---

## 7. Go-live readiness checklist

- [ ] All **section 1** items signed off for the target environment (prod vs sandbox).
- [ ] All **section 2** items pass on the release candidate build/commit.
- [ ] **Section 3** verified on staging (or prod smoke) with real roles: admin, warehouse, read-only AI hub user.
- [ ] **Section 4** spot checks documented with screenshots or note of Seller Central report used.
- [ ] **Section 5** guardrails re-verified after any change to `amazonSpApiGuardrails.js` or sync entrypoints.
- [ ] **Monitoring**: error logs alert on repeated sync failure or 429 spikes; DB disk acceptable for cache growth.
- [ ] **Rollback**: known good env snapshot or previous image tag; procedure to disable sync button / feature flag if needed.
- [ ] **Ownership**: on-call knows where docs live (`backend/docs/`) and how to run `audit:amazon-spapi-safety` before hotfixes.

---

**Sign-off**

| Role | Name | Date | Notes |
|------|------|------|-------|
| QA | | | |
| Engineering | | | |
| Product / Ops | | | |
