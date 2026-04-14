/**
 * After `vite build`, overwrites dist/api-runtime-config.js so the SPA can pin the API origin.
 *
 * - If **HR_PUBLIC_API_URL** is set (e.g. https://api.example.com or https://ec2-…:5001), it is baked in.
 * - Values are also read from repo-root **.env.deploy** if present (KEY=VALUE lines; does not override
 *   variables already set in the environment).
 * - If unset, writes an **empty** string so `getApiBaseUrl()` uses localStorage (`backendUrl`
 *   from the login “API server” field) or VITE_API_BASE_URL — **never** default to the SPA
 *   CloudFront host (that only serves S3; /api/* returns 403 HTML unless you add a CF behavior).
 *
 * When **HR_REQUIRE_PUBLIC_API_URL=1** (set by `deploy-all.sh`) and the URL is still empty, exits
 * with code 1 so production deploys cannot ship a broken same-origin /api configuration.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const out = path.join(root, 'dist', 'api-runtime-config.js')

function loadEnvDeployFile() {
  const p = path.join(root, '.env.deploy')
  if (!fs.existsSync(p)) return
  const text = fs.readFileSync(p, 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvDeployFile()

const raw = (process.env.HR_PUBLIC_API_URL || '').trim().replace(/\/$/, '')
const url = raw

if (!url && process.env.HR_REQUIRE_PUBLIC_API_URL === '1') {
  console.error(
    '[inject-api-runtime-config] HR_PUBLIC_API_URL is required for this deploy (HR_REQUIRE_PUBLIC_API_URL=1).\n' +
      '  Set it in the shell or add repo-root .env.deploy with:\n' +
      '    HR_PUBLIC_API_URL=https://your-express-host.example.com\n' +
      '  (HTTPS origin where Node serves /api/* — not the CloudFront SPA URL unless /api is routed there.)'
  )
  process.exit(1)
}

const body = `/**
 * Generated at deploy — do not hand-edit on S3; redeploy to change.
 * Source: HR_PUBLIC_API_URL at build time, or empty (then use login API URL / VITE_API_BASE_URL).
 */
window.API_RUNTIME_CONFIG = { API_BASE_URL: ${JSON.stringify(url)} }
`
fs.writeFileSync(out, body, 'utf8')
console.log('[inject-api-runtime-config] wrote', out, '→', url)
