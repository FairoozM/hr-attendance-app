# Amazon SP-API — architecture (current and future)

This document describes how the app integrates with **Amazon Selling Partner API (SP-API)** today and how we intend to evolve toward **event-driven** updates without changing the mental model: **the browser talks only to our backend; data shown in Orders and BI comes from the local cache.**

---

## Current architecture (production)

End-to-end flow:

```text
Amazon SP-API  →  guarded backend sync (LWA + REST)  →  PostgreSQL cache tables  →  REST API  →  frontend (Orders + BI Dashboard)
```

- **Amazon SP-API**: LWA access tokens and REST calls run **only on the server** (`amazonSpApiService`, sync, catalog helpers). Credentials never ship to the browser.
- **Guarded backend sync**: `POST /api/amazon/orders/sync` and related logic apply spacing, cooldowns, per-operation limits, and API call logging (`amazonRateLimitService`, `amazonOrdersCacheStore`). Sync is a **controlled reconciliation** over a bounded time window (see guardrail config).
- **Local DB cache**: Orders and line items are stored in PII-safe form (`amazon_orders`, `amazon_order_items`, sync logs, API call logs). The cache is the **system of record for the UI**.
- **Frontend dashboards**: `GET /api/amazon/orders` and `GET /api/amazon/dashboard/orders` read **cache only** — no live `getOrders` / `getOrderItems` on each page load.

Supporting docs: `amazon-spapi-versions.md`, `amazonSpApiGuardrails.js`, request ID / error patterns in code comments near `safeAmazonRequest`.

---

## Why we avoid direct frontend Amazon calls

- **Secrets and tokens**: LWA client secrets, refresh tokens, and access tokens must never live in JavaScript bundles or browser storage for SP-API.
- **Trust boundary**: All Amazon traffic stays on infrastructure we control (audit, rate limits, logging, PII stripping).
- **Consistency**: One implementation of signing, retries, and guardrails — no duplicate or divergent client logic in the SPA.

The frontend only calls paths under **`/api/amazon/...`** on our own API origin.

---

## Why we avoid high-frequency polling

- **Rate limits and account health**: Tight loops against `getOrders`, `getOrderItems`, or catalog endpoints risk throttling (HTTP 429), increased latency, and operational noise.
- **Cost and complexity**: Polling does not scale linearly with SKU count or marketplace count; it pushes complexity into backoff logic that is better solved with **push** notifications where Amazon supports them.
- **Wrong abstraction**: “Refresh everything every minute” duplicates work already available as **change events** from Amazon for many use cases.

**Current sync is manual/guarded reconciliation** — operators or schedules trigger sync when needed, within documented guardrails. That is intentional, not a gap to fill with aggressive polling.

---

## Future target: event-driven notifications

When product requirements need **faster propagation of changes** (orders, inventory, etc.) without increasing poll frequency:

```text
Amazon Notifications API  →  (subscription)  →  SQS or EventBridge  →  backend worker  →  same PostgreSQL cache  →  unchanged frontend
```

1. **Subscribe** in Seller Central / SP-API to the notification types you need (per application and marketplace, per Amazon’s model).
2. **Deliver** messages to **Amazon SQS** (common) or **Amazon EventBridge** — managed queues/rules, DLQs, and replay as appropriate.
3. **Worker**: A dedicated process (ECS task, Lambda, or similar) **consumes** queue messages, **validates** payload shape and authenticity (signatures, ROPC, etc., per Amazon docs), then **updates the same cache tables** the Orders page and BI dashboard already read.
4. **No frontend change** required for read paths: the UI remains cache-first.

**Placeholder only (not wired):** `backend/src/services/amazonNotificationIngestionService.js` — stub handlers for future SQS/EventBridge consumers. **No** production routes or pollers call it yet.

---

## What not to do (examples)

| Anti-pattern | Why |
|--------------|-----|
| Poll **1,000 SKUs every minute** for price/inventory via Catalog / Listings APIs | Unbounded API usage, throttling, and poor fit vs inventory notifications where available. |
| Call **`getOrderItems` on every dashboard or orders page load** | Violates cache-first design; duplicates work and stresses order-item rate limits. |
| Run **sync every few seconds** “to be fresh” | Bypasses guardrails; should be notifications + infrequent reconciliation instead. |
| Log **full raw Amazon payloads** in application logs | May contain buyer PII, tokens in error bodies, or sensitive fields — log **safe summaries** and **Amazon Request IDs** only. |

---

## Scheduled sync: fallback, not primary driver

- **Primary (future)**: Push path from Notifications → queue → worker → cache updates for entities Amazon notifies on.
- **Fallback / reconciliation**: **Scheduled or manual** sync over a bounded window (e.g. daily or on-demand) to correct drift, missed notifications, or new edge cases.

Scheduled sync should **not** become the main high-frequency mechanism; it complements notifications and human-triggered refresh.

---

## Credentials and secrets

| Environment | Practice |
|-------------|----------|
| **Local** | Use `backend/.env` (or your team’s standard) with **variable names only** documented in `backend/.env.example`. Never commit real secrets. |
| **Production** | Prefer **AWS Secrets Manager**, the hosting platform’s secret store, or equivalent — inject at runtime; do not bake secrets into images or client bundles. |

---

## References

- Endpoint version matrix: `backend/docs/amazon-spapi-versions.md`
- Guardrail constants: `backend/src/config/amazonSpApiGuardrails.js`
- Static checks: `npm run audit:amazon-spapi-safety` (from `backend/`)
