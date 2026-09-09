#!/usr/bin/env node
'use strict'

/**
 * Read-only probe of the Noon Partner API surface that could carry order data.
 *
 * Endpoint names come from the published noon API reference
 * (noon-docs.noonpartners.dev): the Reports domain is the `impex` service
 * (export category list / create export / export status) and FBPI exposes
 * ListFbpiOrders. Only list/status reads are attempted here; no export job is
 * created unless `--create-export=<category>` is passed explicitly.
 */

require('dotenv').config()

const { noonGet, noonPost } = require('../src/services/noon/noonClient')

function preview(value, max = 1500) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    return String(value)
  }
}

async function attempt(label, fn) {
  try {
    const res = await fn()
    console.log(`${label} -> HTTP ${res.status}\n    ${preview(res.data)}`)
    return res
  } catch (err) {
    const status = err?.httpStatus ?? err?.meta?.noonStatus ?? 'ERR'
    console.log(`${label} -> HTTP ${status}\n    ${preview(err?.meta?.safeBody ?? err?.message ?? err, 400)}`)
    return null
  }
}

;(async () => {
  await attempt('GET  /identity/v1/whoami', () => noonGet('/identity/v1/whoami'))

  for (const path of [
    '/impex/v1/export/category/list',
    '/v1/export/category/list',
    '/reports/v1/export/category/list',
  ]) {
    const res = await attempt(`GET  ${path}`, () => noonGet(path))
    if (res) break
    await new Promise((r) => setTimeout(r, 600))
  }

  for (const path of ['/fbpi/v1/fbpi-orders/list', '/v1/fbpi-orders/list']) {
    await attempt(`POST ${path}`, () => noonPost(path, {}))
    await new Promise((r) => setTimeout(r, 600))
  }

  const createArg = process.argv.find((a) => a.startsWith('--create-export='))
  if (createArg) {
    const category = createArg.split('=')[1]
    const from = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1]
    const to = process.argv.find((a) => a.startsWith('--to='))?.split('=')[1]
    const body = { category, ...(from ? { from_date: from } : {}), ...(to ? { to_date: to } : {}) }
    console.log(`\n# creating export ${JSON.stringify(body)}`)
    await attempt('POST /impex/v1/export/create', () => noonPost('/impex/v1/export/create', body))
  }
})().catch((e) => {
  console.error('probe failed:', e?.message || e)
  process.exit(1)
})
