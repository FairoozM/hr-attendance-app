/**
 * After `vite build`, overwrites dist/api-runtime-config.js so the SPA always knows the API origin.
 *
 * - If **HR_PUBLIC_API_URL** is set, it wins (e.g. https://api.example.com).
 * - Otherwise this repo defaults to the Life Smile CloudFront URL where /api/* is routed to Express
 *   (same host as the SPA; overrides mistaken hr_api_base_url in localStorage).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const out = path.join(root, 'dist', 'api-runtime-config.js')

/** Production SPA + /api/* distribution (see package.json CloudFront invalidation id). */
const DEFAULT_LIFESMILE_API_ORIGIN = 'https://d3ci8wu1d5dytp.cloudfront.net'

const url = (process.env.HR_PUBLIC_API_URL || DEFAULT_LIFESMILE_API_ORIGIN).trim().replace(/\/$/, '')

const body = `/**
 * Generated at deploy — do not hand-edit on S3; redeploy to change.
 * Source: HR_PUBLIC_API_URL env, or default Life Smile CloudFront (same-origin /api routing).
 */
window.__HR_API_BASE_URL__ = ${JSON.stringify(url)}
`
fs.writeFileSync(out, body, 'utf8')
console.log('[inject-api-runtime-config] wrote', out, '→', url)
