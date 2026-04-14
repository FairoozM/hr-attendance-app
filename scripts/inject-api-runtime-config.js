/**
 * After `vite build`, overwrites dist/api-runtime-config.js so the SPA can pin the API origin.
 *
 * - If **HR_PUBLIC_API_URL** is set (e.g. https://api.example.com or https://ec2-…:5001), it is baked in.
 * - If unset, writes an **empty** string so `getApiBaseUrl()` uses localStorage (`backendUrl`
 *   from the login “API server” field) or VITE_API_BASE_URL — **never** default to the SPA
 *   CloudFront host (that only serves S3; /api/* returns 403 HTML unless you add a CF behavior).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const out = path.join(root, 'dist', 'api-runtime-config.js')

const raw = (process.env.HR_PUBLIC_API_URL || '').trim().replace(/\/$/, '')
const url = raw

const body = `/**
 * Generated at deploy — do not hand-edit on S3; redeploy to change.
 * Source: HR_PUBLIC_API_URL at build time, or empty (then use login API URL / VITE_API_BASE_URL).
 */
window.API_RUNTIME_CONFIG = { API_BASE_URL: ${JSON.stringify(url)} }
`
fs.writeFileSync(out, body, 'utf8')
console.log('[inject-api-runtime-config] wrote', out, '→', url)
