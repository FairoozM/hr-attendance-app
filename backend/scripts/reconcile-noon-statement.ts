#!/usr/bin/env node
/**
 * Reconcile a Noon settlement statement against the Zoho postings it should produce.
 *
 * Reads the file with the same parser, row classifier and return-fee builder the
 * clearing pipeline uses, so what this prints is what the tool would post. It is a
 * check on the ledger, not a second implementation of the accounting — if this and
 * Zoho disagree, Zoho is the one that is wrong.
 *
 * Offline and read-only: no Zoho call, no database, no writes.
 *
 * Usage:
 *   node backend/scripts/reconcile-noon-statement.ts <statement.csv|xlsx> [more...]
 *   node backend/scripts/reconcile-noon-statement.ts <statement.csv> --json
 */
declare const require: (id: string) => any
declare const module: { exports: unknown }
declare const process: { argv: string[]; exitCode: number | undefined }
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void }

const fs = require('fs')
const path = require('path')

const {
  parseNoonStatementReportBuffer,
} = require('../src/services/noonPaymentClearing/noonStatementParserService')
const {
  ROW_CLASS,
  round2,
  num,
  clean,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
const {
  buildSaleParentOrderIdSet,
  parentOrderIdForRow,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingRowPredicates')
const {
  reclassifyReturnRows,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnService')
const {
  buildReturnFeeJournalLinesForRow,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnFeeService')
const {
  getNoonPaymentClearingMarketplaceConfig,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
const {
  splitVatInclusiveAmount,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingVatService')

const TOLERANCE = 0.01

interface JournalItem {
  accountCode: string
  accountName: string
  debitOrCredit: string
  amount: number
  description?: string
}

interface Posting {
  kind: string
  label: string
  reference: string
  movement1066: number
  items: JournalItem[]
}

interface Bucket {
  label: string
  rowCount: number
  movement1066: number
}

interface StatementReconciliation {
  file: string
  referenceNr: string
  statementStartDate: string
  statementEndDate: string
  rowCount: number
  parseWarnings: string[]
  buckets: Bucket[]
  expectedBankPayout: number
  recordPayment: { undeposited1066: number; commission1067: number; shipping1068: number }
  postings: Posting[]
  issues: string[]
}

function money(value: number): string {
  return round2(value).toFixed(2)
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

function isChargeRow(row: any): boolean {
  if (row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE) return true
  if (row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT) return true
  // A sale-classified row with no proceeds is logistics on someone else's week.
  return row.rowClass === ROW_CLASS.SALE_ITEM && Math.abs(num(row.netProceed)) < TOLERANCE
}

const UNALLOCATED_COMPONENTS: Array<{ field: string; label: string }> = [
  { field: 'otherOrderFees', label: 'other order fees' },
  { field: 'orderSubsidies', label: 'order subsidies' },
  { field: 'orderSubscriptionFees', label: 'order subscription fees' },
  { field: 'othersInclVat', label: 'others' },
]

function describeUnallocatedComponents(row: any): string {
  const parts = UNALLOCATED_COMPONENTS.filter(
    (component) => Math.abs(num(row[component.field])) >= TOLERANCE
  ).map((component) => `${component.label} ${money(num(row[component.field]))}`)
  return parts.length ? parts.join(', ') : 'source column not identified'
}

function feeExpenseAccount(cfg: any, normalizedFeeType: string) {
  const match = (cfg.feeJournalAccountSuggestions || []).find(
    (entry: any) => clean(entry.normalizedFeeType) === clean(normalizedFeeType)
  )
  if (!match || !clean(match.zohoAccountCode)) return null
  return { accountCode: clean(match.zohoAccountCode), accountName: clean(match.zohoAccountName) }
}

function reconcileStatement(filePath: string): StatementReconciliation {
  const buffer = fs.readFileSync(filePath)
  const parsed = parseNoonStatementReportBuffer(buffer, path.basename(filePath))
  const metadata = parsed.metadata || {}
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const saleParentSet = buildSaleParentOrderIdSet(parsed.rows)
  const rows = reclassifyReturnRows(parsed.rows, saleParentSet)

  const issues: string[] = []
  const postings: Posting[] = []
  const undeposited = cfg.undepositedFundsAccount
  const inputVat = cfg.inputVatAccount

  let salesRows = 0
  let salesMovement = 0
  let sameWeekRows = 0
  let sameWeekMovement = 0
  let crossWeekRows = 0
  let crossWeekMovement = 0
  let returnRows = 0
  let returnMovement = 0
  let feeRows = 0
  let feeMovement = 0
  let otherRows = 0
  let otherMovement = 0

  let rp1066 = 0
  let rp1067 = 0
  let rp1068 = 0

  for (const row of rows) {
    const total = round2(num(row.total))
    const label = clean(row.itemOrderId) || clean(row.parentOrderId) || `row ${row.rowNumber}`

    if (row.rowClass === ROW_CLASS.STATEMENT_FEE) {
      feeRows += 1
      feeMovement = round2(feeMovement + total)
      const gross = round2(Math.abs(total))
      const split = splitVatInclusiveAmount(gross)
      const expense = feeExpenseAccount(cfg, row.normalizedFeeType)
      if (!expense) {
        issues.push(
          `Statement fee "${clean(row.title) || label}" has no mapped expense account (${clean(row.normalizedFeeType)}).`
        )
      }
      postings.push({
        kind: 'fee_journal',
        label: `Statement fee — ${clean(row.title) || clean(row.normalizedFeeType)}`,
        reference: label,
        movement1066: round2(-gross),
        items: [
          {
            accountCode: expense ? expense.accountCode : '(unmapped)',
            accountName: expense ? expense.accountName : '(unmapped expense account)',
            debitOrCredit: 'debit',
            amount: round2(Math.abs(split.netAmount)),
          },
          {
            accountCode: inputVat.accountCode,
            accountName: inputVat.accountName,
            debitOrCredit: 'debit',
            amount: round2(Math.abs(split.vatAmount)),
          },
          {
            accountCode: undeposited.accountCode,
            accountName: undeposited.accountName,
            debitOrCredit: 'credit',
            amount: gross,
          },
        ],
      })
      continue
    }

    if (row.rowClass === ROW_CLASS.RETURN) {
      returnRows += 1
      returnMovement = round2(returnMovement + total)
      const built = buildReturnFeeJournalLinesForRow(row, { reportSnapshot: metadata }, metadata, cfg)
      const breakdown = built.breakdown
      if (breakdown.productRefundAmount >= TOLERANCE) {
        postings.push({
          kind: 'credit_note',
          label: 'Sales return — credit note refund',
          reference: breakdown.itemOrderId || label,
          movement1066: round2(-breakdown.productRefundAmount),
          items: [
            {
              accountCode: undeposited.accountCode,
              accountName: undeposited.accountName,
              debitOrCredit: 'credit',
              amount: breakdown.productRefundAmount,
            },
          ],
        })
      }
      for (const line of built.lines) {
        postings.push({
          kind: line.phase === 'settlement' ? 'return_fee_journal' : 'return_expense_journal',
          label: line.description,
          reference: line.referenceNumber || breakdown.itemOrderId || label,
          movement1066: round2(num(line.undepositedImpact)),
          items: line.journalItems || [],
        })
      }
      continue
    }

    if (row.rowClass === ROW_CLASS.SALE_ITEM && num(row.netProceed) >= TOLERANCE) {
      salesRows += 1
      salesMovement = round2(salesMovement + total)
      const commission = round2(Math.abs(num(row.referralFee)))
      const shipping = round2(Math.abs(round2(num(row.fulfillmentFee) + num(row.shippingCharges))))
      rp1066 = round2(rp1066 + total)
      rp1067 = round2(rp1067 + commission)
      rp1068 = round2(rp1068 + shipping)
      // Record Payment only splits proceeds three ways. Anything Noon deducted through
      // another column has no bucket to land in and needs its own journal.
      const unallocated = round2(round2(num(row.netProceed)) - round2(total + commission + shipping))
      if (Math.abs(unallocated) >= TOLERANCE) {
        issues.push(
          `Sale ${label}: ${money(unallocated)} outside the 1066/1067/1068 split ` +
            `(${describeUnallocatedComponents(row)}). Needs its own journal, or Record Payment ` +
            `leaves the invoice ${money(unallocated)} short.`
        )
      }
      continue
    }

    if (isChargeRow(row)) {
      const sameWeek = saleParentSet.has(parentOrderIdForRow(row))
      if (sameWeek && total <= -TOLERANCE) {
        sameWeekRows += 1
        sameWeekMovement = round2(sameWeekMovement + total)
        rp1066 = round2(rp1066 + total)
        rp1068 = round2(rp1068 + Math.abs(total))
        continue
      }
      crossWeekRows += 1
      crossWeekMovement = round2(crossWeekMovement + total)
      continue
    }

    otherRows += 1
    otherMovement = round2(otherMovement + total)
    issues.push(
      `Row ${row.rowNumber} (${clean(row.transactionType)}, ${clean(row.rowClass)}) has no posting route — ${money(total)} unaccounted.`
    )
  }

  if (Math.abs(crossWeekMovement) >= TOLERANCE) {
    postings.push({
      kind: 'settlement_adjustment_journal',
      label: `Settlement adjustment — ${crossWeekRows} cross-week charge row(s)`,
      reference: clean(metadata.referenceNr),
      movement1066: crossWeekMovement,
      items: [
        {
          accountCode: undeposited.accountCode,
          accountName: undeposited.accountName,
          debitOrCredit: crossWeekMovement < 0 ? 'credit' : 'debit',
          amount: round2(Math.abs(crossWeekMovement)),
        },
      ],
    })
  }

  const buckets: Bucket[] = [
    { label: 'Item sales (Record Payment)', rowCount: salesRows, movement1066: salesMovement },
    { label: 'Same-week logistics (folded)', rowCount: sameWeekRows, movement1066: sameWeekMovement },
    { label: 'Cross-week charges (journal)', rowCount: crossWeekRows, movement1066: crossWeekMovement },
    { label: 'Sales returns', rowCount: returnRows, movement1066: returnMovement },
    { label: 'Statement fees', rowCount: feeRows, movement1066: feeMovement },
  ]
  if (otherRows > 0) {
    buckets.push({ label: 'Unrouted rows', rowCount: otherRows, movement1066: otherMovement })
  }

  const expectedBankPayout = round2(
    rows.reduce((sum: number, row: any) => sum + num(row.total), 0)
  )
  const bucketTotal = round2(buckets.reduce((sum, bucket) => sum + bucket.movement1066, 0))
  if (Math.abs(bucketTotal - expectedBankPayout) >= TOLERANCE) {
    issues.push(
      `Bucket total ${money(bucketTotal)} does not equal the statement total ${money(expectedBankPayout)}.`
    )
  }

  const postedMovement = round2(
    postings.reduce((sum, posting) => sum + posting.movement1066, 0) + rp1066
  )
  if (Math.abs(postedMovement - expectedBankPayout) >= TOLERANCE) {
    issues.push(
      `Planned postings move 1066 by ${money(postedMovement)} but the statement settles ${money(expectedBankPayout)} ` +
        `(difference ${money(expectedBankPayout - postedMovement)}).`
    )
  }

  return {
    file: path.basename(filePath),
    referenceNr: clean(metadata.referenceNr),
    statementStartDate: clean(metadata.statementStartDate),
    statementEndDate: clean(metadata.statementEndDate),
    rowCount: rows.length,
    parseWarnings: parsed.warnings || [],
    buckets,
    expectedBankPayout,
    recordPayment: { undeposited1066: rp1066, commission1067: rp1067, shipping1068: rp1068 },
    postings,
    issues,
  }
}

function printReport(result: StatementReconciliation): void {
  const period =
    result.statementStartDate && result.statementEndDate
      ? ` (${result.statementStartDate} to ${result.statementEndDate})`
      : ''
  console.log('')
  console.log(`${result.referenceNr || result.file}${period}`)
  console.log(`${result.rowCount} rows from ${result.file}`)
  for (const warning of result.parseWarnings) console.log(`  parser warning: ${warning}`)

  console.log('')
  console.log(`  ${pad('Bucket', 34)}${padLeft('Rows', 6)}${padLeft('1066 movement', 18)}`)
  for (const bucket of result.buckets) {
    console.log(
      `  ${pad(bucket.label, 34)}${padLeft(String(bucket.rowCount), 6)}${padLeft(money(bucket.movement1066), 18)}`
    )
  }
  console.log(`  ${pad('', 40)}${padLeft('-'.repeat(16), 18)}`)
  console.log(
    `  ${pad('Expected bank payout', 40)}${padLeft(money(result.expectedBankPayout), 18)}`
  )

  console.log('')
  console.log('  Record Payment totals (customer = Noon)')
  console.log(`    1066 Undeposited        ${padLeft(money(result.recordPayment.undeposited1066), 12)}`)
  console.log(`    1067 Uncleared Commission${padLeft(money(result.recordPayment.commission1067), 11)}`)
  console.log(`    1068 Uncleared Shipping ${padLeft(money(result.recordPayment.shipping1068), 12)}`)

  const journals = result.postings.filter((posting) => posting.kind !== 'credit_note')
  const creditNotes = result.postings.filter((posting) => posting.kind === 'credit_note')

  if (creditNotes.length) {
    console.log('')
    console.log('  Credit note refunds')
    for (const note of creditNotes) {
      console.log(`    ${pad(note.reference, 28)}${padLeft(money(Math.abs(note.movement1066)), 12)} Cr 1066`)
    }
  }

  if (journals.length) {
    console.log('')
    console.log('  Journals')
    for (const journal of journals) {
      console.log(`    ${journal.label}`)
      for (const item of journal.items) {
        const side = item.debitOrCredit === 'debit' ? 'Dr' : 'Cr'
        console.log(
          `      ${side} ${pad(`${item.accountCode} ${item.accountName}`, 44)}${padLeft(money(item.amount), 12)}`
        )
      }
    }
  }

  console.log('')
  if (result.issues.length === 0) {
    console.log(`  OK — Noon Undeposited Funds must move by ${money(result.expectedBankPayout)} for this statement.`)
  } else {
    console.log(`  ${result.issues.length} issue(s):`)
    for (const issue of result.issues) console.log(`    - ${issue}`)
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const files = args.filter((arg) => arg !== '--json')

  if (files.length === 0) {
    console.error('Usage: node backend/scripts/reconcile-noon-statement.ts <statement.csv|xlsx> [more...] [--json]')
    process.exitCode = 1
    return
  }

  const results: StatementReconciliation[] = []
  for (const file of files) {
    const resolved = path.resolve(process.cwd(), file)
    if (!fs.existsSync(resolved)) {
      console.error(`Not found: ${file}`)
      process.exitCode = 1
      continue
    }
    results.push(reconcileStatement(resolved))
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const result of results) printReport(result)
    console.log('')
  }

  if (results.some((result) => result.issues.length > 0)) process.exitCode = 1
}

main()
