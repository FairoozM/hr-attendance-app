#!/usr/bin/env node
'use strict'

/**
 * Read-only probe: run the Noon OMS orders export (`noon_noonoms_ordersexport`)
 * for a date range and print the file's columns plus a few rows, so the report
 * provider can be written against the real column names.
 *
 * Usage: node scripts/probe-noon-orders-export.js 2026-09-07 2026-09-08
 */

require('dotenv').config()

const axios = require('axios')
const { noonPost } = require('../src/services/noon/noonClient')

const fromDate = process.argv[2] || '2026-09-07'
const toDate = process.argv[3] || '2026-09-08'

;(async () => {
  const created = await noonPost('/impex/v1/export/create', {
    export_category_code: 'noon_noonoms_ordersexport',
    params: { from_date: fromDate, to_date: toDate },
  })
  const exportCode = created.data?.export_code
  console.log('export_code =', exportCode)

  let status = null
  let downloadUrl = null
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 3000))
    const res = await noonPost('/impex/v1/export/status', { export_code: exportCode })
    status = res.data?.export_status
    downloadUrl = res.data?.download_url || null
    console.log(`poll ${i + 1}: status=${status} hasUrl=${Boolean(downloadUrl)}`)
    if (downloadUrl) break
    if (String(status).toLowerCase().includes('fail')) break
  }
  if (!downloadUrl) {
    console.log('no download url; final status', status)
    return
  }

  const file = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 60000 })
  const buf = Buffer.from(file.data)
  console.log('downloaded bytes =', buf.length, 'content-type =', file.headers['content-type'])
  const head = buf.slice(0, 4)
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const XLSX = require('xlsx')
    const wb = XLSX.read(buf, { type: 'buffer' })
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null })
      console.log(`sheet "${name}" rows=${rows.length}`)
      if (rows.length) {
        console.log('columns:', Object.keys(rows[0]).join(' | '))
        for (const r of rows.slice(0, 6)) console.log(JSON.stringify(r))
      }
    }
  } else {
    const text = buf.toString('utf8')
    const lines = text.split(/\r?\n/)
    console.log('lines =', lines.length)
    for (const l of lines.slice(0, 8)) console.log(l)
  }
})().catch((e) => {
  console.error('probe failed:', e?.message || e, JSON.stringify(e?.meta?.safeBody || '').slice(0, 500))
  process.exit(1)
})
