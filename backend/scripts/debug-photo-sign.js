#!/usr/bin/env node
/** Test S3 presign for employees with photo_doc_key; append NDJSON to DEBUG_LOG_PATH if set. */
require('dotenv').config()
const fs = require('fs')
const { query } = require('../src/db')
const s3Service = require('../services/s3Service')

const LOG_PATH = process.env.DEBUG_LOG_PATH || ''

function agentLog(payload) {
  const line = `${JSON.stringify({ sessionId: '0027ca', timestamp: Date.now(), ...payload })}\n`
  if (LOG_PATH) {
    try {
      fs.appendFileSync(LOG_PATH, line)
    } catch (_) {}
  }
  console.log(line.trim())
}

async function main() {
  const r = await query(`
    SELECT id, employee_code, photo_doc_key
    FROM employees
    WHERE photo_doc_key IS NOT NULL
    ORDER BY id
  `)
  for (const row of r.rows) {
    try {
      const url = await s3Service.getDownloadUrl({ key: row.photo_doc_key, expiresIn: 3600 })
      agentLog({
        hypothesisId: 'H3',
        location: 'debug-photo-sign.js',
        message: 'sign_ok',
        data: { employeeId: row.id, employeeCode: row.employee_code, urlLen: url?.length || 0 },
      })
    } catch (err) {
      agentLog({
        hypothesisId: 'H3',
        location: 'debug-photo-sign.js',
        message: 'sign_failed',
        data: {
          employeeId: row.id,
          employeeCode: row.employee_code,
          error: err?.message || String(err),
          code: err?.code,
        },
      })
    }
  }
  agentLog({
    hypothesisId: 'H3',
    location: 'debug-photo-sign.js',
    message: 'sign_run_complete',
    data: { count: r.rows.length },
  })
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    agentLog({
      hypothesisId: 'H3',
      message: 'sign_script_error',
      data: { error: e?.message || String(e) },
    })
    process.exit(1)
  })
