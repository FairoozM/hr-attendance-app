#!/usr/bin/env node
/**
 * One-off diagnostic: employee photo_url / photo_doc_key state (no PII beyond employee_code).
 */
require('dotenv').config()
const { query } = require('../src/db')

async function main() {
  const r = await query(`
    SELECT id, employee_code,
      photo_doc_key IS NOT NULL AS has_doc_key,
      photo_url IS NOT NULL AS has_photo_url,
      CASE
        WHEN photo_url LIKE '%X-Amz-Signature=%' THEN 'signed'
        WHEN photo_url IS NOT NULL THEN 'plain'
        ELSE 'none'
      END AS url_kind,
      LEFT(photo_doc_key, 40) AS doc_key_prefix
    FROM employees
    ORDER BY id
  `)
  const rows = r.rows
  const summary = {
    total: rows.length,
    hasDocKey: rows.filter((x) => x.has_doc_key).length,
    hasUrlNoKey: rows.filter((x) => x.has_photo_url && !x.has_doc_key).length,
    signedNoKey: rows.filter((x) => x.url_kind === 'signed' && !x.has_doc_key).length,
    plainNoKey: rows.filter((x) => x.url_kind === 'plain' && !x.has_doc_key).length,
    rows,
  }
  console.log(JSON.stringify(summary, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
