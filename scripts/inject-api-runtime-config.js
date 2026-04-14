/**
 * After `vite build`, overwrites dist/api-runtime-config.js when HR_PUBLIC_API_URL is set.
 * This makes production browsers call Express on EC2/ALB instead of CloudFront /api (HTML/403).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const out = path.join(root, 'dist', 'api-runtime-config.js')
const url = (process.env.HR_PUBLIC_API_URL || '').trim().replace(/\/$/, '')

if (!url) {
  console.log('[inject-api-runtime-config] HR_PUBLIC_API_URL not set; using public/api-runtime-config.js from build')
  process.exit(0)
}

const body = `/**
 * Generated at deploy from HR_PUBLIC_API_URL — do not hand-edit on S3; redeploy to change.
 */
window.__HR_API_BASE_URL__ = ${JSON.stringify(url)}
`
fs.writeFileSync(out, body, 'utf8')
console.log('[inject-api-runtime-config] wrote', out)
