# CloudFront: frontend (S3) vs API (backend)

The SPA is static files on **S3**. The Express API runs on a **separate origin** (e.g. ALB, EC2, Elastic Beanstalk, API Gateway HTTP API).

If the browser requests `https://your-cloudfront-domain/api/auth/login` and **only** the S3 website origin is configured, CloudFront serves **`index.html`** (HTTP 200, `text/html`) for `/api/*`. The app then fails with “HTML instead of JSON”.

You need **one of**:

## Option A — Path-based behaviors on a single distribution (typical)

### Required CloudFront configuration (infrastructure)

- **Separate behavior for the API** (must be ordered **above** the default):
  - **Path pattern**: `/api/*` (matches `/api/health`, `/api/auth/login`, etc.)
  - **Path pattern**: `/api` (exact) — **required** for `GET https://your-domain/api` alone. CloudFront’s `/api/*` pattern does **not** match `/api` with no extra path segment; without a `/api` behavior, that request hits **S3** (often `403 AccessDenied` XML).
  - **Origin**: backend server (ALB, custom domain to Node, etc.) — **not** the S3 static site bucket
  - **Allowed HTTP methods**: `GET`, `HEAD`, `OPTIONS`, `PUT`, `POST`, `PATCH`, `DELETE` (so login and CRUD work)
  - **Caching**: disabled (use **CachingDisabled** or **Managed-CachingDisabled**). API responses must not be cached as HTML or stale JSON.

- **Default behavior** (`*`):
  - **Origin**: frontend static hosting only (S3 or S3 website endpoint)
  - Serves the React app (`index.html` for SPA routes, hashed assets).

| Priority | Path pattern | Origin | Notes |
|----------|--------------|--------|--------|
| 1 (higher) | `/api` | **API origin** | Same settings as `/api/*`; enables `GET /api` JSON root. |
| 2 | `/api/*` | **API origin** (ALB / custom domain to Node) | Forward all methods. |
| 3 (default `*`) | `*` (default) | **S3** (or S3 + website) | SPA + hashed assets only. |

**Origin request / cache**:

- Prefer **CachingDisabled** or **Managed-CachingDisabled** policy for `/api/*` (API responses must not be cached as HTML).
- Forward headers: at minimum `Authorization`, `Content-Type`; include `Host` if your API needs it.

**CORS**: Express should allow your CloudFront domain (and dev origins) if the browser calls the API cross-origin. If `/api` is **same-origin** via CloudFront (Option A), CORS is often unnecessary for same site.

## Option B — Separate API URL (no CloudFront path split)

- Deploy the API at e.g. `https://api.example.com` (or `https://ec2-…amazonaws.com:5001` if TLS/nginx terminates there).
- **Recommended for this repo:** set **`HR_PUBLIC_API_URL`** when running `npm run deploy:frontend` so `dist/api-runtime-config.js` sets `window.__HR_API_BASE_URL__` for all users (no per-browser login setup).
- Alternatively set **`VITE_API_BASE_URL=https://api.example.com`** when building the frontend.
- CloudFront can still front **only** the SPA bucket; API uses its own DNS/TLS.

This avoids path routing on one distribution but requires CORS on the API for browser calls from `https://app.example.com` (Express `cors()` is enabled by default in this project).

## Quick check

- `curl -i https://YOUR_CLOUDFRONT_DOMAIN/api/health` should return **`Content-Type: application/json`** (or your API’s JSON error), **not** `text/html`.
