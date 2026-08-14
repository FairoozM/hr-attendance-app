#!/usr/bin/env node
/**
 * Read-only golden capture for the Noon payment clearing pipeline.
 *
 * Dumps the deterministic, offline part of the pipeline for a saved batch: row
 * classification, fee journals, settlement adjustment journal, payment plans and
 * the undeposited reconciliation. Nothing here touches Zoho, so the output is a
 * stable fingerprint of the accounting logic that a refactor must not move.
 *
 * Usage:
 *   node backend/scripts/dump-noon-clearing-preview.js --list
 *   node backend/scripts/dump-noon-clearing-preview.js --batch 3
 *   node backend/scripts/dump-noon-clearing-preview.js --batch 3 --out tests/golden/batch-3.json
 *   node backend/scripts/dump-noon-clearing-preview.js --all --out-dir tests/golden
 */
const path = require('path')
const fs = require('fs')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const store = require('../src/services/noonPaymentClearing/noonPaymentClearingStore')
const { buildNoonClearingFingerprint } = require('../src/services/noonPaymentClearing/noonPaymentClearingFingerprint')

function parseArgs(argv) {
  const args = { list: false, all: false, batch: null, out: null, outDir: null }
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--list') args.list = true
    else if (token === '--all') args.all = true
    else if (token === '--batch') args.batch = Number(argv[++i])
    else if (token === '--out') args.out = argv[++i]
    else if (token === '--out-dir') args.outDir = argv[++i]
  }
  return args
}

function writeJson(filePath, value) {
  const resolved = path.resolve(process.cwd(), filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`)
  return resolved
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.list) {
    const batches = await store.listSavedBatches(200)
    for (const b of batches) {
      console.log(
        `${String(b.batchId).padStart(4)}  ${String(b.referenceNr || '').padEnd(26)}  ${String(b.status || '').padEnd(10)}  settlement=${b.settlementTotal}`
      )
    }
    return
  }

  const targets = []
  if (args.all) {
    const batches = await store.listSavedBatches(200)
    targets.push(...batches.map((b) => b.batchId))
  } else if (Number.isFinite(args.batch)) {
    targets.push(args.batch)
  } else {
    console.error('Specify --batch <id>, --all, or --list.')
    process.exitCode = 1
    return
  }

  for (const batchId of targets) {
    const batch = await store.getBatchById(batchId)
    if (!batch) {
      console.error(`Batch ${batchId} not found.`)
      process.exitCode = 1
      continue
    }
    const fingerprint = buildNoonClearingFingerprint(batch)
    if (args.outDir) {
      const file = path.join(args.outDir, `batch-${batchId}.json`)
      console.log(`wrote ${writeJson(file, fingerprint)}`)
    } else if (args.out) {
      console.log(`wrote ${writeJson(args.out, fingerprint)}`)
    } else {
      console.log(JSON.stringify(fingerprint, null, 2))
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
