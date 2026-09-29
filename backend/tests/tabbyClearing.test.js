'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

const { parseTabbyStatement, toMinor } = require('../src/services/tabbyClearing/tabbyStatementParser')
const model = require('../src/services/tabbyClearing/tabbyClearingModel')
const { getTabbyClearingConfig, ACCOUNT_ROLES } = require('../src/config/tabbyClearing')
const { createMemoryTabbyStore } = require('../src/services/tabbyClearing/tabbyClearingMemoryStore')
const { buildTabbyPreview, planRecovery, RECOVERY_ACTION } = require('../src/services/tabbyClearing/tabbyClearingPreviewService')
const { postTabbyBatch } = require('../src/services/tabbyClearing/tabbyClearingPostingService')
const zohoChecks = require('../src/services/tabbyClearing/tabbyClearingZoho')
const F = require('./fixtures/tabbyFakeZoho')

const FIX = path.join(__dirname, 'fixtures', 'tabby')
const SEP14 = fs.readFileSync(path.join(FIX, 'Tabby20260914AED.xlsx'))
const SEP28 = fs.readFileSync(path.join(FIX, 'Tabby20260928AED.xlsx'))
const NOW = new Date('2026-09-29T08:00:00Z')
const baseConfig = () => ({ ...getTabbyClearingConfig(), postingEnabled: true })
const M = (minor) => minor / 100

function analyze(buffer, config = baseConfig()) {
  const parsed = parseTabbyStatement(buffer, { fileName: 'statement.xlsx' })
  return { parsed, analysis: model.analyzeStatement(parsed, config) }
}

/** Fake Zoho + memory store with the statement imported and its sales seeded. */
async function setup(buffer, { config = baseConfig(), fake = F.createFakeZoho(), store = createMemoryTabbyStore(), mapFees = true, bank = true, seed = true } = {}) {
  const { parsed, analysis } = analyze(buffer, config)
  if (seed) F.seedSales(fake, analysis.rows)
  if (bank && analysis.totals.bankPayoutMinor > 0) {
    fake.st.bank.push({ id: `BANK-${parsed.statement.statementNumber}`, date: analysis.transferDate, amount: M(analysis.totals.bankPayoutMinor), from: F.IDS.UNDEPOSITED, to: F.IDS.RAK, reference: 'BRV-01157 - Payment Received from Tabby' })
  }
  if (mapFees && !(await store.listAccountMappings()).some((m) => m.role === 'FEES_EXPENSE')) {
    await store.saveAccountMapping({ role: 'FEES_EXPENSE', accountId: F.IDS.PAYOUT_FEE, accountName: 'Tabby Payout Fee', accountType: 'expense' }, 'user:1')
  }
  const imported = await store.importStatement({ parsed, analysis, fileName: 'statement.xlsx', actor: 'user:1' })
  const batchId = imported.batch.id
  const preview = (opts = {}) => buildTabbyPreview({ batchId, store, sources: fake.sources, config, now: opts.now || NOW, deep: opts.deep })
  const post = async (opts = {}) => {
    const p = opts.fingerprint ? { fingerprint: opts.fingerprint } : await preview({ now: opts.now })
    return postTabbyBatch({ batchId, store, sources: fake.sources, writer: fake.writer, config, actor: 'user:1', fingerprint: p.fingerprint, now: () => opts.now || NOW })
  }
  return { fake, store, config, parsed, analysis, batchId, imported, preview, post }
}

function ledgerByName(fake) {
  return Object.fromEntries(Object.entries(fake.ledger()).map(([id, v]) => [F.CHART.find((a) => a.accountId === id).accountName, M(v)]))
}

const FORBIDDEN = /HR ?(&|and) ?BI|hr-attendance|Purchase Planning|Generated from|Review completed/i

// ── Real statements ─────────────────────────────────────────────────────────

test('28 Sep statement: every mandated figure', () => {
  const { parsed, analysis } = analyze(SEP28)
  assert.equal(parsed.statement.statementNumber, 'Tabby20260928AED')
  assert.equal(parsed.fileHash, '177ad3518dda96078599e7aaed2731841f20a62bbb333585928a6e2d405369f1')
  assert.deepEqual(analysis.blockers, [])
  const t = analysis.totals
  assert.equal(t.saleCount, 6)
  assert.equal(M(t.salesGrossMinor), 3316.84)
  assert.equal(M(t.refundableCommissionMinor), 149.26)
  assert.equal(M(t.nonRefundableCommissionMinor), 66.34)
  assert.equal(M(t.commissionExpenseMinor), 215.6)
  assert.equal(M(t.transactionFixedFeeMinor), 6)
  assert.equal(M(t.transactionTotalFeeMinor), 221.6)
  assert.equal(M(t.transactionVatMinor), 11.09)
  assert.equal(M(t.transactionDeductionMinor), 232.69)
  assert.equal(M(t.prePayoutTransferMinor), 3084.15)
  assert.equal(M(t.payoutFeeMinor), 6)
  assert.equal(M(t.payoutVatMinor), 0.3)
  assert.equal(M(t.bankPayoutMinor), 3077.85)
  assert.equal(M(t.feesExpenseNetMinor), 12)
  assert.equal(M(t.inputVatNetMinor), 11.39)
  assert.equal(M(t.commissionExpenseNetMinor), 215.6)
})

test('14 Sep statement: mandated figures, commission and fixed fee computed independently', () => {
  const { analysis } = analyze(SEP14)
  assert.deepEqual(analysis.blockers, [])
  const t = analysis.totals
  assert.equal(t.saleCount, 13)
  assert.equal(M(t.salesGrossMinor), 6070.1)
  assert.equal(M(t.transactionTotalFeeMinor), 407.56)
  assert.equal(M(t.transactionVatMinor), 20.39)
  assert.equal(M(t.transactionDeductionMinor), 427.95)
  assert.equal(M(t.prePayoutTransferMinor), 5642.15)
  assert.equal(M(t.payoutFeeMinor), 6)
  assert.equal(M(t.payoutVatMinor), 0.3)
  assert.equal(M(t.bankPayoutMinor), 5635.85)
  assert.equal(M(t.inputVatNetMinor), 20.69)
  // Independent: straight from the sheet cells, not from the model.
  const wb = XLSX.read(SEP14)
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets.SR, { header: 1, defval: null })
  const h = aoa.findIndex((r) => r && r.includes('Refundable Commission'))
  const col = (name) => aoa[h].indexOf(name)
  const sales = aoa.slice(h + 1).filter((r) => r && r[col('Type')] === 'sale')
  const commission = sales.reduce((s, r) => s + toMinor(r[col('Refundable Commission')]).minor + toMinor(r[col('Non Refundable Commission')]).minor, 0)
  const fixed = sales.reduce((s, r) => s + toMinor(r[col('Fixed Fee')]).minor, 0)
  assert.equal(M(commission), 394.56)
  assert.equal(M(fixed), 13)
  assert.equal(t.commissionExpenseMinor, commission)
  assert.equal(t.transactionFixedFeeMinor, fixed)
  assert.equal(M(t.feesExpenseNetMinor), 19)
})

test('plan + ledger simulation clears Processing and Undeposited to 0.00 on both statements', () => {
  for (const [buf, expected] of [[SEP28, { commission: 215.6, fees: 12, vat: 11.39, bank: 3077.85, charges: 232.69 }], [SEP14, { commission: 394.56, fees: 19, vat: 20.69, bank: 5635.85, charges: 427.95 }]]) {
    const { parsed, analysis } = analyze(buf)
    const accounts = Object.fromEntries(['UNDEPOSITED', 'PROCESSING', 'COMMISSION_EXPENSE', 'FEES_EXPENSE', 'INPUT_VAT', 'BANK'].map((r) => [r, { accountId: `A-${r}` }]))
    const rows = analysis.rows.map((r) => (r.kind === 'SALE' ? { ...r, match: { matched: true, invoice: { invoiceId: `I${r.websiteOrderId}`, invoiceNumber: 'X', customerId: 'C' } } } : r))
    const plan = model.buildPostingPlan({ statementNumber: parsed.statement.statementNumber, rows, accounts, date: '2026-09-29', config: baseConfig(), bank: { status: 'BANK_MATCH_PENDING', amountMinor: analysis.totals.bankPayoutMinor } })
    const invoiceGross = Object.fromEntries(rows.filter((r) => r.kind === 'SALE').map((r) => [`I${r.websiteOrderId}`, r.economics.grossMinor]))
    const sim = model.simulateLedger(plan, { invoiceGross })
    assert.equal(M(sim.afterSales.PROCESSING), expected.charges)
    assert.equal(sim.afterChargeClearing.PROCESSING, 0)
    assert.equal(sim.final.PROCESSING, 0)
    assert.equal(sim.final.UNDEPOSITED, 0)
    assert.equal(M(sim.final.COMMISSION_EXPENSE), expected.commission)
    assert.equal(M(sim.final.FEES_EXPENSE), expected.fees)
    assert.equal(M(sim.final.INPUT_VAT), expected.vat)
    assert.equal(M(sim.final.BANK), expected.bank)
    assert.ok(Object.entries(sim.final).filter(([k]) => k.startsWith('AR:')).every(([, v]) => v === 0))
    for (const c of plan) assert.deepEqual(model.componentProblems(c), [])
  }
})

test('payout fee is a journal (Dr Fees 6.00, Dr Input VAT 0.30, Cr Undeposited 6.30), never a customer payment', () => {
  const { parsed, analysis } = analyze(SEP28)
  const accounts = { UNDEPOSITED: { accountId: 'U' }, PROCESSING: { accountId: 'P' }, COMMISSION_EXPENSE: { accountId: 'C' }, FEES_EXPENSE: { accountId: 'F' }, INPUT_VAT: { accountId: 'V' }, BANK: { accountId: 'B' } }
  const plan = model.buildPostingPlan({ statementNumber: parsed.statement.statementNumber, rows: analysis.rows, accounts, date: '2026-09-29', config: baseConfig(), bank: null })
  const fee = plan.filter((c) => c.component === 'PAYOUT_FEE')
  assert.equal(fee.length, 1)
  assert.equal(fee[0].zohoRecordType, 'journal')
  assert.equal(fee[0].reference, 'Tabby20260928AED/PAYOUT_FEE')
  assert.deepEqual(fee[0].payload.line_items, [
    { account_id: 'F', debit_or_credit: 'debit', amount: 6 },
    { account_id: 'V', debit_or_credit: 'debit', amount: 0.3 },
    { account_id: 'U', debit_or_credit: 'credit', amount: 6.3 },
  ])
  assert.ok(plan.filter((c) => c.zohoRecordType === 'customer_payment').every((c) => c.component === 'SALE_NET' || c.component === 'SALE_CHARGES'))
})

test('Zoho payloads carry no notes, descriptions or app branding', async () => {
  const s = await setup(SEP28)
  const p = await s.preview()
  for (const c of p.components) {
    const json = JSON.stringify(c.payload || {})
    assert.ok(!FORBIDDEN.test(json), json)
    assert.ok(!/"notes"|"description"/.test(json), json)
  }
})

// ── Parser robustness ───────────────────────────────────────────────────────

test('header detection by name: columns reordered and header moved still parse identically', () => {
  const headers = [...F.HEADERS].reverse()
  const buf = F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', headers, rows: [F.saleRow('20001', '30001', 500), F.saleRow('20002', '30002', 250.5)], payoutFee: { fee: 6, vat: 0.3 } })
  const { analysis } = analyze(buf)
  assert.deepEqual(analysis.blockers, [])
  assert.equal(analysis.totals.saleCount, 2)
  assert.equal(M(analysis.totals.salesGrossMinor), 750.5)
})

test('missing required header, totals mismatch, unknown row, merchant/currency, VAT rate and duplicate sale are blockers', () => {
  const codes = (buf) => analyze(buf).analysis.blockers.map((b) => b.code)
  const noVat = F.HEADERS.filter((h) => h !== 'VAT Amount')
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', headers: noVat, rows: [F.saleRow('1', '2', 100)] })).includes('MISSING_REQUIRED_HEADER'))
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.saleRow('1', '2', 100)], totalsOverride: { 'Order Amount': 101 } })).includes('TOTALS_NOT_RECONCILED'))
  const unknown = F.HEADERS.map((h) => ({ 'Order Number': '9', 'website order ID': 99, Type: 'chargeback', Currency: 'AED', 'Order Amount': 10, 'Merchant Code': 'lsapp' })[h] ?? null)
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.saleRow('1', '2', 100)], extraRows: [unknown] })).includes('UNSUPPORTED_ROW'))
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.saleRow('1', '2', 100, { merchantCode: 'other' })] })).includes('MERCHANT_MISMATCH'))
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.saleRow('1', '2', 100, { currency: 'SAR' })] })).includes('CURRENCY_NOT_AED'))
  const badVat = F.saleRow('1', '2', 100)
  badVat.vat = 1; badVat.deduction = Number((badVat.totalFee + 1).toFixed(2)); badVat.transferred = Number((100 - badVat.deduction).toFixed(2))
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [badVat] })).includes('VAT_RATE_MISMATCH'))
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.saleRow('1', '2', 100), F.saleRow('1', '2', 100)] })).includes('DUPLICATE_SALE_ROW'))
  assert.ok(codes(F.buildStatementXlsx({ statementNumber: 'NOTTABBY', date: '2026-10-05', rows: [F.saleRow('1', '2', 100)] })).includes('STATEMENT_NOT_RECOGNIZED'))
})

test('refund normalization: real full/partial formats, positive-formatted rows, unsupported formats', () => {
  const config = baseConfig()
  const row = (kind, subtype, m) => ({ kind, subtype, minor: m })
  // Real rows from earlier statements.
  const full = model.normalizeRow(row('REFUND', 'refund', { orderAmount: -6000, refundableCommission: -270, nonRefundableCommission: 0, fixedFee: 0, totalFee: -270, vatAmount: -14, totalDeduction: -284, transferredAmount: -5716 }), config)
  assert.deepEqual(full.problems, [])
  assert.deepEqual(full.effects, { grossEffect: -6000, commissionEffect: -270, fixedFeeEffect: 0, vatEffect: -14, deductionEffect: -284, transferEffect: -5716, roundingEffect: 0 })
  const partial = model.normalizeRow(row('REFUND', 'partial refund', { orderAmount: -78515, refundableCommission: -3533, nonRefundableCommission: 0, fixedFee: 0, totalFee: -3533, vatAmount: -177, totalDeduction: -3710, transferredAmount: -74805 }), config)
  assert.deepEqual(partial.problems, [])
  assert.equal(partial.effects.transferEffect, -74805)
  const positive = model.normalizeRow(row('REFUND', 'refund', { orderAmount: 6000, refundableCommission: 270, nonRefundableCommission: 0, fixedFee: 0, totalFee: 270, vatAmount: 14, totalDeduction: 284, transferredAmount: 5716 }), config)
  assert.equal(positive.signNormalized, true)
  assert.deepEqual(positive.effects, full.effects)
  const broken = model.normalizeRow(row('REFUND', 'refund', { orderAmount: -6000, refundableCommission: -270, nonRefundableCommission: 0, fixedFee: 0, totalFee: -270, vatAmount: -14, totalDeduction: -284, transferredAmount: -5000 }), config)
  assert.ok(broken.problems.some((p) => p.code === 'UNSUPPORTED_REFUND_FORMAT'))
  const zero = model.normalizeRow(row('REFUND', 'refund', { orderAmount: 0, refundableCommission: 0, nonRefundableCommission: 0, fixedFee: 0, totalFee: 0, vatAmount: 0, totalDeduction: 0, transferredAmount: 0 }), config)
  assert.ok(zero.problems.some((p) => p.code === 'UNSUPPORTED_REFUND_FORMAT'))
})

// ── Import idempotency ──────────────────────────────────────────────────────

test('statement # + SHA-256: same file is ALREADY_IMPORTED, changed file is STATEMENT_VERSION_CONFLICT', async () => {
  const s = await setup(SEP28)
  assert.equal(s.imported.result, 'IMPORTED')
  const again = analyze(SEP28)
  assert.equal((await s.store.importStatement({ ...again, fileName: 'again.xlsx' })).result, 'ALREADY_IMPORTED')
  const changed = analyze(F.buildStatementXlsx({ statementNumber: 'Tabby20260928AED', date: '2026-09-28', rows: [F.saleRow('1', '2', 100)] }))
  const conflict = await s.store.importStatement({ ...changed, fileName: 'changed.xlsx' })
  assert.equal(conflict.result, 'STATEMENT_VERSION_CONFLICT')
  assert.equal((await s.store.listBatches()).length, 1)
})

// ── Matching ────────────────────────────────────────────────────────────────

test('matching: both identifiers → one order → one invoice; customer follows shop_order; bank matched to existing transfer', async () => {
  const s = await setup(SEP28)
  const p = await s.preview()
  assert.deepEqual(p.blockers, [])
  assert.equal(p.status, 'READY')
  assert.equal(p.sections.matching.matched, 6)
  const byOrder = Object.fromEntries(p.rows.filter((r) => r.kind === 'SALE').map((r) => [r.orderNumber, r.match.invoice.customerId]))
  for (const [order, customer] of Object.entries(byOrder)) assert.equal(customer, F.SHOP_ORDER_NUMBERS.has(order) ? F.IDS.SHOP : F.IDS.WEBSITE)
  assert.equal(p.bank.status, 'BANK_MATCHED')
  assert.equal(p.bank.matched.transactionId, 'BANK-Tabby20260928AED')
  assert.ok(!p.components.some((c) => c.component === 'BANK_SETTLEMENT'))
  assert.equal(p.components.length, 14)
  assert.equal(p.sections.vat.inputVat, 11.39)
  assert.equal(p.sections.clearing.final, 0)
  assert.equal(p.sections.undeposited.final, 0)
})

test('matching failures: IDENTIFIER_CONFLICT, ORDER_NOT_FOUND, CUSTOMER_MISMATCH, AMOUNT_MISMATCH, INVOICE_ALREADY_PAID', async () => {
  const s = await setup(SEP28)
  const [a, b, c, d, e] = s.analysis.rows.filter((r) => r.kind === 'SALE')
  s.fake.st.orders.find((o) => o.orderNumber === a.websiteOrderId).orderNumber = 'OTHER'
  s.fake.st.orders.push({ ...s.fake.st.orders[0], orderId: 'X-1', orderNumber: a.websiteOrderId })
  s.fake.st.orders = s.fake.st.orders.filter((o) => o.orderId !== b.orderNumber)
  s.fake.st.invoices.find((i) => i.referenceNumber === c.websiteOrderId).customerId = F.IDS.SHOP === s.fake.st.invoices.find((i) => i.referenceNumber === c.websiteOrderId).customerId ? F.IDS.WEBSITE : F.IDS.SHOP
  s.fake.st.invoices.find((i) => i.referenceNumber === d.websiteOrderId).total = 1
  s.fake.st.invoices.find((i) => i.referenceNumber === e.websiteOrderId).balance = 10
  const p = await s.preview()
  const codes = p.blockers.map((x) => x.code)
  for (const code of ['IDENTIFIER_CONFLICT', 'ORDER_NOT_FOUND', 'CUSTOMER_MISMATCH', 'AMOUNT_MISMATCH', 'INVOICE_ALREADY_PAID']) assert.ok(codes.includes(code), `${code} in ${codes}`)
  assert.equal(p.canPost, false)
})

// ── Accounts ────────────────────────────────────────────────────────────────

test('accounts: known equivalents resolve, Fees Expense needs an admin mapping, wrong types and reuse are refused', () => {
  const noMap = zohoChecks.resolveAccounts(F.CHART, [], ACCOUNT_ROLES)
  assert.equal(noMap.accounts.PROCESSING.accountId, F.IDS.UNCLEARED)
  assert.equal(noMap.accounts.INPUT_VAT.accountId, F.IDS.INPUT_VAT)
  assert.equal(noMap.accounts.BANK.accountId, F.IDS.RAK)
  assert.equal(noMap.accounts.FEES_EXPENSE, undefined)
  assert.equal(noMap.problems.find((p) => p.role === 'FEES_EXPENSE').code, 'ACCOUNT_UNMAPPED')
  assert.equal(noMap.problems.find((p) => p.role === 'FEES_EXPENSE').suggestions[0].accountName, 'Tabby Payout Fee')
  const wrongType = zohoChecks.resolveAccounts(F.CHART, [{ role: 'FEES_EXPENSE', accountId: F.IDS.RAK }], ACCOUNT_ROLES)
  assert.equal(wrongType.problems.find((p) => p.role === 'FEES_EXPENSE').code, 'ACCOUNT_TYPE_INVALID')
  const reused = zohoChecks.resolveAccounts(F.CHART, [{ role: 'FEES_EXPENSE', accountId: F.IDS.COMMISSION }], ACCOUNT_ROLES)
  assert.ok(reused.problems.some((p) => p.code === 'ACCOUNT_REUSED'))
})

test('posting stays blocked until Tabby Fees Expense is mapped', async () => {
  const s = await setup(SEP28, { mapFees: false })
  const p = await s.preview()
  assert.equal(p.canPost, false)
  assert.ok(p.blockers.some((b) => b.code === 'ACCOUNT_UNMAPPED'))
  await assert.rejects(postTabbyBatch({ batchId: s.batchId, store: s.store, sources: s.fake.sources, writer: s.fake.writer, config: s.config, actor: 'user:1', fingerprint: p.fingerprint, now: () => NOW }), (e) => e.code === 'POSTING_BLOCKED')
  assert.equal(s.fake.writer.calls.length, 0)
})

// ── Posting guards and happy path ───────────────────────────────────────────

test('posting guards: disabled, no actor, no fingerprint, stale fingerprint, concurrent post', async () => {
  const s = await setup(SEP28)
  const p = await s.preview()
  const args = { batchId: s.batchId, store: s.store, sources: s.fake.sources, writer: s.fake.writer, actor: 'user:1', fingerprint: p.fingerprint, now: () => NOW }
  await assert.rejects(postTabbyBatch({ ...args, config: { ...s.config, postingEnabled: false } }), (e) => e.code === 'POSTING_DISABLED')
  await assert.rejects(postTabbyBatch({ ...args, config: s.config, actor: null }), (e) => e.code === 'ACTOR_REQUIRED')
  await assert.rejects(postTabbyBatch({ ...args, config: s.config, fingerprint: '' }), (e) => e.code === 'FINGERPRINT_REQUIRED')
  await assert.rejects(postTabbyBatch({ ...args, config: s.config, fingerprint: 'stale' }), (e) => e.code === 'PREVIEW_CHANGED')
  await assert.rejects(postTabbyBatch({ ...args, config: s.config, now: () => new Date('2026-09-30T08:00:00Z') }), (e) => e.code === 'PREVIEW_CHANGED')
  const lock = await s.store.acquireStatementLock('Tabby20260928AED')
  await assert.rejects(postTabbyBatch({ ...args, config: s.config }), (e) => e.code === 'STATEMENT_POSTING_IN_PROGRESS')
  await lock.release()
  assert.equal(s.fake.writer.calls.length, 0)
})

test('28 Sep posts end to end; Processing and Undeposited end at 0.00; rerun writes nothing', async () => {
  const s = await setup(SEP28)
  const r = await s.post()
  assert.equal(r.status, 'POSTED')
  assert.equal(s.fake.writer.calls.length, 14)
  assert.deepEqual(s.fake.writer.calls.map((c) => c.type), [...Array(12).fill('customer_payment'), 'journal', 'journal'])
  assert.equal(s.fake.st.invoices.filter((i) => i.balance !== 0).length, 0)
  const ledger = ledgerByName(s.fake)
  assert.equal(ledger['Tabby Undeposited Funds'], 0)
  assert.equal(ledger['Tabby Un-cleared Commission'], 0)
  assert.equal(ledger['Tabby Commission Expense'], 215.6)
  assert.equal(ledger['Tabby Payout Fee'], 12)
  assert.equal(ledger['Input VAT - All Except Basmat Goods WH'], 11.39)
  assert.equal(ledger['RAK BANK MAIN 5061'], 3077.85)
  assert.equal((await s.store.getBatch(s.batchId)).bankTransactionId, 'BANK-Tabby20260928AED')
  const again = await s.post()
  assert.equal(again.status, 'POSTED')
  assert.equal(s.fake.writer.calls.length, 14)
  const comps = await s.store.listComponents(s.batchId)
  assert.equal(new Set(comps.map((c) => c.key)).size, comps.length)
  assert.ok(comps.every((c) => c.status === 'VERIFIED'))
})

test('14 Sep posts end to end with Input VAT 20.69 and bank 5635.85 linked', async () => {
  const s = await setup(SEP14)
  const r = await s.post()
  assert.equal(r.status, 'POSTED')
  const ledger = ledgerByName(s.fake)
  assert.equal(ledger['Tabby Undeposited Funds'], 0)
  assert.equal(ledger['Tabby Un-cleared Commission'], 0)
  assert.equal(ledger['Input VAT - All Except Basmat Goods WH'], 20.69)
  assert.equal(ledger['Tabby Commission Expense'], 394.56)
  assert.equal(ledger['Tabby Payout Fee'], 19)
})

// ── Idempotency and recovery ────────────────────────────────────────────────

test('a rejected write stops the run; the rerun posts only the missing components', async () => {
  const s = await setup(SEP28)
  s.fake.writer.faults = [undefined, undefined, { kind: 'reject' }]
  const first = await s.post()
  assert.equal(first.status, 'PARTIALLY_POSTED')
  assert.equal(first.log.at(-1).status, 'FAILED')
  assert.equal(s.fake.st.payments.length, 2)
  const second = await s.post()
  assert.equal(second.status, 'POSTED')
  assert.equal(s.fake.writer.calls.length, 3 + 12)
  assert.equal(s.fake.st.payments.length, 12)
})

test('uncertain response with the record created: recovered by reference, never duplicated', async () => {
  const s = await setup(SEP28)
  s.fake.writer.faults = [{ kind: 'timeout', create: true }]
  const r = await s.post()
  assert.equal(r.status, 'POSTED')
  assert.equal(s.fake.st.payments.length, 12)
  const first = (await s.store.listComponents(s.batchId))[0]
  assert.equal(first.recoveryStatus, 'RECOVERED')
})

test('uncertain response, search index lagging: direct invoice read still finds the payment', async () => {
  const s = await setup(SEP28)
  s.fake.writer.faults = [{ kind: '5xx', create: true, lag: true }]
  const r = await s.post()
  assert.equal(r.status, 'POSTED')
  assert.equal(s.fake.st.payments.length, 12)
})

test('uncertain response, nothing created: no resend before the settle window, one resend after', async () => {
  const s = await setup(SEP28)
  s.fake.writer.faults = [{ kind: 'timeout', create: false }]
  const first = await s.post()
  assert.equal(first.log.at(-1).status, 'POSTING_UNCERTAIN')
  assert.equal(s.fake.writer.calls.length, 1)
  const soon = new Date(NOW.getTime() + 60000)
  const waiting = await s.post({ now: soon })
  assert.equal(waiting.log[0].status, 'POSTING_UNCERTAIN')
  assert.equal(s.fake.writer.calls.length, 1)
  const later = new Date(NOW.getTime() + 6 * 60000)
  const retried = await s.post({ now: later })
  assert.equal(retried.status, 'POSTED')
  assert.equal(s.fake.writer.calls.length, 1 + 14)
  assert.equal(s.fake.st.payments.length, 12)
})

test('uncertain response that created two records: AMBIGUOUS_RECOVERY stops the run', async () => {
  const s = await setup(SEP28)
  s.fake.writer.faults = [{ kind: 'timeout', create: true, duplicate: true }]
  const r = await s.post()
  assert.equal(r.log.at(-1).code, 'AMBIGUOUS_RECOVERY')
  assert.equal(r.status, 'NEEDS_REVIEW')
  assert.equal(s.fake.writer.calls.length, 1)
  const p = await s.preview()
  assert.ok(p.blockers.some((b) => b.code === 'AMBIGUOUS_RECOVERY'))
})

test('a Zoho record with our reference but different content is a conflict, never re-posted', async () => {
  const s = await setup(SEP28)
  const p0 = await s.preview()
  const c = p0.components[0]
  s.fake.st.payments.push({ payment_id: 'PAY-X', customer_id: c.customerId, amount: 1, reference_number: c.reference, account_id: F.IDS.UNDEPOSITED, invoices: [{ invoice_id: c.invoiceId, amount_applied: 1 }] })
  const inv = s.fake.st.invoices.find((i) => i.invoiceId === c.invoiceId)
  inv.balance = (Math.round(inv.balance * 100) - 100) / 100
  const p = await s.preview()
  assert.equal(p.components[0].recovery.action, RECOVERY_ACTION.NEEDS_REVIEW)
  assert.equal(p.canPost, false)
  await assert.rejects(s.post({ fingerprint: p.fingerprint }), (e) => e.code === 'POSTING_BLOCKED')
  assert.equal(s.fake.writer.calls.length, 0)
})

test('planRecovery covers every local/Zoho combination', () => {
  const opts = { nowMs: NOW.getTime(), settleMs: 5 * 60000 }
  const at = (ms) => new Date(NOW.getTime() - ms).toISOString()
  assert.equal(planRecovery({ state: 'MISSING' }, null, opts).action, 'POST_ELIGIBLE')
  assert.equal(planRecovery({ state: 'MISSING' }, { status: 'FAILED' }, opts).action, 'RETRY_ELIGIBLE')
  assert.equal(planRecovery({ state: 'MISSING' }, { status: 'POSTING_UNCERTAIN', uncertainSince: at(60000) }, opts).action, 'WAIT_UNCERTAIN')
  assert.equal(planRecovery({ state: 'MISSING' }, { status: 'POSTING_UNCERTAIN', uncertainSince: at(600000) }, opts).action, 'RECHECK_THEN_RETRY')
  assert.equal(planRecovery({ state: 'MISSING' }, { status: 'VERIFIED', zohoRecordId: 'x' }, opts).action, 'NEEDS_REVIEW')
  assert.equal(planRecovery({ state: 'VERIFIED', recordId: 'a' }, { status: 'PLANNED' }, opts).action, 'SKIP_VERIFIED')
  assert.equal(planRecovery({ state: 'VERIFIED', recordId: 'a' }, { status: 'VERIFIED', zohoRecordId: 'b' }, opts).action, 'NEEDS_REVIEW')
  assert.equal(planRecovery({ state: 'AMBIGUOUS' }, null, opts).code, 'AMBIGUOUS_RECOVERY')
  assert.equal(planRecovery({ state: 'LOOKUP_FAILED' }, null, opts).action, 'LOOKUP_FAILED')
})

// ── Bank ────────────────────────────────────────────────────────────────────

test('bank: no existing transfer → BANK_MATCH_PENDING → posting records Undeposited → RAK once', async () => {
  const s = await setup(SEP28, { bank: false })
  const p = await s.preview()
  assert.equal(p.bank.status, 'BANK_MATCH_PENDING')
  const bankC = p.components.find((c) => c.component === 'BANK_SETTLEMENT')
  assert.deepEqual(bankC.payload, { transaction_type: 'transfer_fund', from_account_id: F.IDS.UNDEPOSITED, to_account_id: F.IDS.RAK, amount: 3077.85, date: '2026-09-29', reference_number: 'Tabby20260928AED/BANK_SETTLEMENT' })
  const r = await s.post()
  assert.equal(r.status, 'POSTED')
  assert.equal(s.fake.st.bank.length, 1)
  assert.equal(ledgerByName(s.fake)['Tabby Undeposited Funds'], 0)
  await s.post()
  assert.equal(s.fake.st.bank.length, 1)
})

test('bank: two candidate transfers → BANK_MATCH_AMBIGUOUS; everything else posts; admin link completes it', async () => {
  const s = await setup(SEP28)
  s.fake.st.bank.push({ id: 'BANK-2', date: '2026-09-29', amount: 3077.85, from: F.IDS.UNDEPOSITED, to: F.IDS.RAK, reference: 'BRV-xxx' })
  const p = await s.preview()
  assert.equal(p.bank.status, 'BANK_MATCH_AMBIGUOUS')
  assert.deepEqual(p.blockers, [])
  const r = await s.post()
  assert.equal(r.status, 'PARTIALLY_POSTED')
  assert.match(r.stopReason, /Bank step waiting/)
  await s.store.setBankMatch(s.batchId, { status: 'BANK_MATCHED', transactionId: 'BANK-2', evidence: {} })
  const after = await s.preview()
  assert.equal(after.bank.status, 'BANK_MATCHED')
  assert.equal(after.status, 'POSTED')
})

test('bank: a transfer claimed by another statement is never reused', async () => {
  const store = createMemoryTabbyStore()
  const fake = F.createFakeZoho()
  const a = await setup(SEP28, { store, fake })
  await a.post()
  const twin = F.buildStatementXlsx({ statementNumber: 'Tabby20260929AED', date: '2026-09-28', rows: [], payoutFee: null, extraRows: [] })
  const { parsed, analysis } = analyze(twin)
  analysis.totals.bankPayoutMinor = a.analysis.totals.bankPayoutMinor
  const claims = await store.listBankClaims()
  const match = await zohoChecks.findBankMatch({ sources: fake.sources, accounts: { UNDEPOSITED: { accountId: F.IDS.UNDEPOSITED }, BANK: { accountId: F.IDS.RAK, accountName: 'RAK BANK MAIN 5061' } }, amountMinor: 307785, transferDate: '2026-09-28', statementNumber: parsed.statement.statementNumber, ownReference: 'x', claims, batchId: 'other', config: baseConfig() })
  assert.equal(match.status, 'BANK_MATCH_PENDING')
  assert.equal(match.skipped[0].claimedBy, 'Tabby20260928AED')
  const other = await store.importStatement({ parsed, analysis, fileName: 'twin.xlsx' })
  await assert.rejects(store.setBankMatch(other.batch.id, { status: 'BANK_MATCHED', transactionId: 'BANK-Tabby20260928AED' }), (e) => e.code === 'BANK_RECORD_ALREADY_CLAIMED')
})

// ── Refunds ─────────────────────────────────────────────────────────────────

/** A sale settled in one statement, refunds in later ones; credit notes booked by the returns flow. */
async function refundScenario({ refunds, creditNotes = [{ number: '30001', total: 1000, balance: 1000 }], extraSales = [] }) {
  const store = createMemoryTabbyStore()
  const fake = F.createFakeZoho()
  const sale = F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.saleRow('20001', '30001', 1000)], payoutFee: { fee: 6, vat: 0.3 } })
  const s1 = await setup(sale, { store, fake })
  assert.equal((await s1.post()).status, 'POSTED')
  for (const cn of creditNotes) fake.st.creditNotes.push({ creditNoteId: `CN-${cn.number}`, creditNoteNumber: cn.number, referenceNumber: '', customerId: F.IDS.WEBSITE, status: 'open', date: '2026-10-08', total: cn.total, balance: cn.balance, currencyCode: 'AED', invoiceId: 'INVID-30001', refunds: [] })
  const buf = F.buildStatementXlsx({ statementNumber: 'Tabby20261012AED', date: '2026-10-12', rows: [...extraSales, ...refunds] })
  const s2 = await setup(buf, { store, fake })
  return { store, fake, s1, s2 }
}

test('full refund of an order settled in an earlier statement: credit note refund + commission/VAT reversals, retained charges stay', async () => {
  const { fake, s2 } = await refundScenario({ refunds: [F.refundRow('20001', '30001', 1000)], extraSales: [F.saleRow('20002', '30002', 2000)] })
  const p = await s2.preview()
  assert.deepEqual(p.blockers, [])
  const refund = p.rows.find((r) => r.kind === 'REFUND')
  assert.equal(refund.refund.kind, 'FULL_REFUND')
  assert.equal(refund.refund.creditNote.creditNoteNumber, '30001')
  const comps = Object.fromEntries(p.components.map((c) => [c.component, c]))
  assert.equal(comps.REFUND_PAYMENT.amount, 1000)
  assert.equal(comps.REFUND_PAYMENT.payload.from_account_id, F.IDS.UNDEPOSITED)
  assert.equal(comps.REFUND_PAYMENT.reference, 'Tabby20261012AED/30001/R1/REFUND')
  assert.deepEqual(comps.REFUND_COMMISSION_REVERSAL.lines.map((l) => [l.role, l.side, l.amount]), [['UNDEPOSITED', 'debit', 45], ['COMMISSION_EXPENSE', 'credit', 45]])
  assert.deepEqual(comps.REFUND_VAT_REVERSAL.lines.map((l) => [l.role, l.side, l.amount]), [['UNDEPOSITED', 'debit', 2.25], ['INPUT_VAT', 'credit', 2.25]])
  assert.equal(comps.REFUND_FEE_REVERSAL, undefined, 'fixed fee and non-refundable commission are retained')
  const phases = p.components.map((c) => c.component)
  assert.ok(phases.indexOf('SALE_CHARGES') < phases.indexOf('REFUND_PAYMENT'))
  const r = await s2.post()
  assert.equal(r.status, 'POSTED')
  const ledger = ledgerByName(fake)
  assert.equal(ledger['Tabby Undeposited Funds'], 0)
  assert.equal(ledger['Tabby Un-cleared Commission'], 0)
  assert.equal(fake.st.creditNotes[0].balance, 0)
})

test('partial and multiple refunds on one order share a credit note; cumulative protection and duplicates', async () => {
  const { s2 } = await refundScenario({
    refunds: [F.refundRow('20001', '30001', 300, { partial: true, day: '2026-10-10' }), F.refundRow('20001', '30001', 200, { partial: true, day: '2026-10-11' })],
    creditNotes: [{ number: '30001', total: 500, balance: 500 }],
  })
  const p = await s2.preview()
  assert.deepEqual(p.blockers, [])
  const refs = p.components.filter((c) => c.component === 'REFUND_PAYMENT').map((c) => [c.reference, c.amount])
  assert.deepEqual(refs, [['Tabby20261012AED/30001/R1/REFUND', 300], ['Tabby20261012AED/30001/R2/REFUND', 200]])
  assert.equal(p.rows.filter((r) => r.kind === 'REFUND')[1].refund.cumulativeRefunded, 500)
  assert.equal((await s2.post()).status, 'POSTED')

  // Same refund row again in a later statement → duplicate; more than the invoice → overrun.
  const dup = F.buildStatementXlsx({ statementNumber: 'Tabby20261019AED', date: '2026-10-19', rows: [F.refundRow('20001', '30001', 300, { partial: true, day: '2026-10-10' }), F.refundRow('20001', '30001', 600, { partial: true, day: '2026-10-18' })] })
  const s3 = await setup(dup, { store: s2.store, fake: s2.fake })
  const codes = (await s3.preview()).blockers.map((b) => b.code)
  assert.ok(codes.includes('DUPLICATE_REFUND'))
  assert.ok(codes.includes('REFUND_OVERRUN'))
})

test('refund without a Zoho credit note is blocked (credit notes are never created)', async () => {
  const { s2 } = await refundScenario({ refunds: [F.refundRow('20001', '30001', 100, { partial: true })], creditNotes: [] })
  const p = await s2.preview()
  assert.ok(p.blockers.some((b) => b.code === 'CREDIT_NOTE_MISSING'))
  assert.equal(p.canPost, false)
})

test('sale and its refund in the same statement: sale clears first, refund follows', async () => {
  const store = createMemoryTabbyStore()
  const fake = F.createFakeZoho()
  const buf = F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.refundRow('20001', '30001', 400, { partial: true, day: '2026-10-04' }), F.saleRow('20001', '30001', 1000, { day: '2026-10-01' })], payoutFee: { fee: 6, vat: 0.3 } })
  const { analysis } = analyze(buf)
  F.seedSales(fake, analysis.rows)
  fake.st.creditNotes.push({ creditNoteId: 'CN-1', creditNoteNumber: '30001', referenceNumber: '', customerId: F.IDS.WEBSITE, status: 'open', date: '2026-10-04', total: 400, balance: 400, currencyCode: 'AED', invoiceId: 'INVID-30001', refunds: [] })
  const s = await setup(buf, { store, fake, seed: false })
  const p = await s.preview()
  assert.deepEqual(p.blockers, [])
  const order = p.components.map((c) => c.component)
  assert.deepEqual(order.slice(0, 3), ['SALE_NET', 'SALE_CHARGES', 'REFUND_CREDIT_NOTE'])
  assert.equal((await s.post()).status, 'POSTED')
  assert.equal(ledgerByName(fake)['Tabby Undeposited Funds'], 0)
  assert.equal(ledgerByName(fake)['Tabby Un-cleared Commission'], 0)
})

test('refund format that does not reconcile is UNSUPPORTED_REFUND_FORMAT and blocks posting', async () => {
  const bad = F.refundRow('20001', '30001', 100)
  bad.transferred = -50
  const { s2 } = await refundScenario({ refunds: [bad] })
  const p = await s2.preview()
  assert.ok(p.blockers.some((b) => b.code === 'UNSUPPORTED_REFUND_FORMAT'))
})

// ── Preview sections ────────────────────────────────────────────────────────

test('preview exposes every review section', async () => {
  const s = await setup(SEP14)
  const p = await s.preview()
  for (const key of ['settlement', 'sales', 'commission', 'fees', 'vat', 'clearing', 'undeposited', 'refunds', 'matching', 'ledger']) assert.ok(p.sections[key], key)
  assert.equal(p.sections.commission.expense, 394.56)
  assert.equal(p.sections.fees.feesExpense, 19)
  assert.equal(p.sections.vat.inputVat, 20.69)
  assert.equal(p.sections.undeposited.bankPayout, 5635.85)
  assert.equal(p.sections.settlement.totalCheck.every((c) => c.difference === 0), true)
})

test('bank listing: Zoho ignores the date filter, so pages are read newest-first and filtered locally', async () => {
  const { listBankTransactionsWith } = require('../src/services/tabbyClearing/tabbyClearingSources')
  const tx = (id, date, amount = 1) => ({ transaction_id: id, date, amount, transaction_type: 'transfer_fund', reference_number: id })
  const pages = [
    [tx('a', '2026-09-29'), tx('b', '2026-09-28', 3077.85), tx('c', '2026-09-18', 5635.85)],
    [tx('d', '2026-09-03'), tx('e', '2026-08-31')],
    [tx('never', '2026-02-10')],
  ]
  const requested = []
  const get = async (_p, params) => {
    requested.push(params.page)
    const i = Number(params.page) - 1
    return { banktransactions: pages[i], page_context: { has_more_page: i < pages.length - 1 } }
  }
  const rows = await listBankTransactionsWith(get, 'acct', '2026-09-11', '2026-09-28')
  assert.deepEqual(rows.map((r) => r.transactionId), ['b', 'c'])
  assert.deepEqual(requested, ['1', '2'])

  const unsorted = async () => ({ banktransactions: [tx('x', '2026-09-01'), tx('y', '2026-09-20')], page_context: { has_more_page: false } })
  await assert.rejects(listBankTransactionsWith(unsorted, 'acct', '2026-09-11', '2026-09-28'), (e) => e.code === 'ZOHO_SORT_IGNORED')

  const endless = async (_p, params) => ({ banktransactions: [tx(`p${params.page}`, '2026-09-29')], page_context: { has_more_page: true } })
  await assert.rejects(listBankTransactionsWith(endless, 'acct', '2026-09-11', '2026-09-28'), (e) => e.code === 'ZOHO_LOOKUP_INCOMPLETE')
})
