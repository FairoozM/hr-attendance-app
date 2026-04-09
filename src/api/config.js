/**
 * Production: set VITE_API_BASE_URL to your Express API origin (no trailing slash), e.g.
 * https://api.yourdomain.com — then rebuild. Leave unset for local dev (Vite proxies /api).
 * Same-origin /api on CloudFront: see docs/cloudfront-api-routing.md
 */
export const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
