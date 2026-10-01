'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../src/services/posSettlement/posSettlementModel.ts')
const { getPosSettlementConfig, POS_ACCOUNT_ROLE: ROLE } = require('../src/config/posSettlement.ts')

const config = { ...getPosSettlementConfig(), organizationId: 'org' }
const SHOP = config.shopZohoCustomerId
const WEBSITE = config.websiteZohoCustomerId
const accounts = {
  [ROLE.UNDEPOSITED]: { accountId: 'A1062', accountName: 'POS-Machine Undeposited Funds' },
  [ROLE.PROCESSING]: { accountId: 'A1039', accountName: 'POS-Machine Uncleared Commission Exp' },
  [ROLE.FEE_EXPENSE]: { accountId: 'A2126', accountName: 'POS-Machine Transaction Fee' },
  [ROLE.INPUT_VAT]: { accountId: 'A1085', accountName: 'Input VAT - All Except Basmat Goods WH' },
  [ROLE.BANK]: { accountId: 'ARAK', accountName: 'RAK BANK MAIN 5061' },
}

function txn(over: any = {}) {
  return {
    id: over.id || '1', sourceRow: 2, merchantId: 'M1', terminalId: 'T1', rrn: '003042448545', stan: '000123', authCode: 'A1',
    transactionType: 'SALE', transactionDate: '2026-09-05', currency: 'AED', settlementId: null, settlementDate: null, bankReference: null,
    minor: { gross: 22780, commission: 420, otherFees: 0, vat: 21, net: 22339 }, ...over,
  }
}

const invState = (over: any = {}) => ({ invoiceId: 'I1', invoiceNumber: 'INV-043659', customerId: SHOP, referenceNumber: '20947', status: 'sent', totalMinor: 22780, balanceMinor: 22780, currencyCode: 'AED', date: '2026-09-05', payments: [], ...over })

test('identity: same RRN + compatible fields + same economics is a DUPLICATE; changed amount or date is a CONFLICT', () => {
  const a = txn()
  assert.equal(model.classifyIncoming(txn({ id: undefined }), [a]).status, 'DUPLICATE')
  const c = model.classifyIncoming(txn({ minor: { ...a.minor, net: 22338, vat: 22 } }), [a])
  assert.equal(c.status, 'CONFLICT')
  assert.deepEqual(c.differences, ['vat', 'net'])
  assert.equal(model.classifyIncoming(txn({ transactionDate: '2026-09-06' }), [a]).status, 'CONFLICT')
  // A file that does not carry MID/TID still recognises the same transaction.
  assert.equal(model.classifyIncoming(txn({ merchantId: null, terminalId: null, stan: null }), [a]).status, 'DUPLICATE')
  // Same RRN on another terminal is another transaction (RRN alone is not unique).
  const other = model.classifyIncoming(txn({ terminalId: 'T2' }), [a])
  assert.equal(other.status, 'NEW')
  assert.equal(other.rrnReused, true)
  assert.equal(model.classifyIncoming(txn({ transactionDate: '2027-06-01' }), [a]).status, 'NEW', 'RRN recycled after > 180 days')
  assert.equal(model.inFileDuplicates([txn(), txn({ sourceRow: 3 })]).length, 1)
})

test('identity keys keep the RRN as text', () => {
  const k1 = model.transactionIdentity(txn({ rrn: '003042448545' }), { organizationId: 'org', provider: 'MASHREQ' })
  const k2 = model.transactionIdentity(txn({ rrn: '3042448545' }), { organizationId: 'org', provider: 'MASHREQ' })
  assert.notEqual(k1, k2)
})

test('payout grouping: settlement id > bank reference > settlement date > transaction date; channels never split it', () => {
  assert.deepEqual(model.payoutKeyOf(txn({ settlementId: 'S9', bankReference: 'B1', settlementDate: '2026-09-07' })), { key: 'SID:S9', basis: 'SETTLEMENT_ID', date: '2026-09-07' })
  assert.equal(model.payoutKeyOf(txn({ bankReference: 'B1' })).key, 'REF:B1')
  assert.equal(model.payoutKeyOf(txn({ settlementDate: '2026-09-07' })).key, 'SDATE:2026-09-07')
  assert.equal(model.payoutKeyOf(txn()).key, 'TDATE:2026-09-05')
  assert.equal(model.payoutKeyOf(txn({ terminalId: 'WEB1' })).key, model.payoutKeyOf(txn({ terminalId: 'SHOP1' })).key)
  const code = model.settlementCodeOf('TDATE:2026-09-05', '2026-09-05', 'MSQ')
  assert.match(code, /^MSQ-20260905-[0-9A-F]{6}$/)
  assert.doesNotMatch(code, /HR|BI|attendance/i)
})

test('RRN extraction from invoice notes keeps leading zeros and ignores other numbers', () => {
  const opts = { label: /\bRRN\b/i, digits: 12, labelled: true }
  assert.deepEqual(model.extractRrns('RRN : 003042448545', opts), { rrns: ['003042448545'], malformed: [] })
  assert.deepEqual(model.extractRrns('Phone 0501234567\nRRN: 003042448545, 003042448546\nThanks', opts).rrns, ['003042448545', '003042448546'])
  assert.deepEqual(model.extractRrns('RRN:\n003042448545\n003042448546', opts).rrns, ['003042448545', '003042448546'])
  assert.deepEqual(model.extractRrns('RRN 3042448545', opts), { rrns: [], malformed: ['3042448545'] })
  assert.deepEqual(model.extractRrns('Order 003042448545', opts).rrns, [], 'no label → not an RRN')
  assert.deepEqual(model.extractRrns('003042448545', { ...opts, labelled: false }).rrns, ['003042448545'])
})

test('analysis: charges must reconcile, VAT is 5% of charges, refunds are not auto-booked', () => {
  const ok = model.analyzeSettlement([txn()], config)
  assert.deepEqual(ok.blockers, [])
  assert.equal(ok.totals.netMinor, 22339)
  const bad = model.analyzeSettlement([txn({ minor: { gross: 22780, commission: 420, otherFees: 0, vat: 21, net: 22340 } })], config)
  assert.ok(bad.blockers.some((b: any) => b.code === 'CHARGES_NOT_RECONCILED'))
  const vat = model.analyzeSettlement([txn({ minor: { gross: 22780, commission: 420, otherFees: 0, vat: 40, net: 22320 } })], config)
  assert.ok(vat.blockers.some((b: any) => b.code === 'VAT_RATE_MISMATCH'))
  const refund = model.analyzeSettlement([txn({ transactionType: 'REFUND', minor: { gross: -1000, commission: 0, otherFees: 0, vat: 0, net: -1000 } })], config)
  assert.ok(refund.blockers.some((b: any) => b.code === 'UNSUPPORTED_TRANSACTION_TYPE'))
  const split = model.analyzeSettlement([txn({ minor: { gross: 22780, commission: null, otherFees: null, vat: null, net: 22339 } })], config)
  assert.ok(split.blockers.some((b: any) => b.code === 'CHARGES_SPLIT_MISSING'))
})

test('channel: website order, terminal mapping and Zoho customer must agree', () => {
  const shopOrder = { orderId: '1', orderNumber: '20947', shopOrder: true, userAgent: 'app', paymentMethod: 'pos' }
  const appOrder = { ...shopOrder, shopOrder: false }
  assert.equal(model.resolveChannel({ txn: txn(), order: shopOrder, invoiceCustomerId: SHOP, terminalMappings: [], config }).channel, 'BURJUMAN_SHOP')
  assert.equal(model.resolveChannel({ txn: txn(), order: appOrder, invoiceCustomerId: WEBSITE, terminalMappings: [], config }).channel, 'WEB_APP')
  assert.equal(model.resolveChannel({ txn: txn(), order: { ...appOrder, userAgent: 'web' }, invoiceCustomerId: WEBSITE, terminalMappings: [], config }).channel, 'WEBSITE')
  assert.match(model.resolveChannel({ txn: txn(), order: appOrder, invoiceCustomerId: SHOP, terminalMappings: [], config }).mismatch, /disagrees/)
  assert.match(model.resolveChannel({ txn: txn(), order: shopOrder, invoiceCustomerId: WEBSITE, terminalMappings: [], config }).mismatch, /Website/)
  const tm = [{ merchantId: 'M1', terminalId: 'T1', channel: 'WEBSITE' }]
  assert.ok(model.resolveChannel({ txn: txn(), order: shopOrder, invoiceCustomerId: SHOP, terminalMappings: tm, config }).mismatch)
  assert.equal(model.resolveChannel({ txn: txn(), order: null, invoiceCustomerId: null, terminalMappings: [{ merchantId: 'M1', terminalId: null, channel: 'WEBSITE' }], config }).channel, 'WEBSITE')
  assert.equal(model.resolveChannel({ txn: txn(), order: null, invoiceCustomerId: 'X', terminalMappings: [], config }).channel, 'UNKNOWN')
})

test('matching: RRN must find exactly one live invoice; date+amount never matches automatically', () => {
  const inv = { invoiceId: 'I1', invoiceNumber: 'INV-043659', customerId: SHOP, referenceNumber: '20947', status: 'sent', totalMinor: 22780, balanceMinor: 22780, currencyCode: 'AED', date: '2026-09-05', rrns: ['003042448545'] }
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [inv], manual: null, config }).status, 'MATCHED')
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [], manual: null, config }).status, 'RRN_NOT_FOUND')
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [inv, { ...inv, invoiceId: 'I2', invoiceNumber: 'INV-2' }], manual: null, config }).status, 'RRN_AMBIGUOUS')
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [{ ...inv, status: 'void' }], manual: null, config }).status, 'RRN_NOT_FOUND')
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [{ ...inv, currencyCode: 'USD' }], manual: null, config }).status, 'CURRENCY_MISMATCH')
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [{ ...inv, totalMinor: 1000 }], manual: null, config }).status, 'AMOUNT_EXCEEDS_INVOICE')
  assert.equal(model.matchTransaction({ txn: txn({ rrn: null }), rrnHits: [], manual: null, config }).status, 'RRN_INVALID')
  const possible = model.possibleMatches(txn(), [{ ...inv, rrns: [] }, { ...inv, invoiceId: 'I9', totalMinor: 1 }], 2)
  assert.deepEqual(possible.map((i: any) => i.invoiceId), ['I1'])
  // Manual split across two invoices of one customer; never across customers.
  const manual = { allocations: [{ invoiceId: 'I1', invoiceNumber: 'A', customerId: SHOP, grossMinor: 20000 }, { invoiceId: 'I2', invoiceNumber: 'B', customerId: SHOP, grossMinor: 2780 }] }
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [], manual, config }).status, 'MANUAL')
  assert.equal(model.matchTransaction({ txn: txn(), rrnHits: [], manual: { allocations: [manual.allocations[0], { ...manual.allocations[1], customerId: WEBSITE }] }, config }).status, 'CUSTOMER_MISMATCH')
})

function fiveSep() {
  const t1 = txn({ id: '1' })
  const t2 = txn({ id: '2', rrn: '003042523578', minor: { gross: 10285, commission: 190, otherFees: 0, vat: 10, net: 10085 } })
  const i1 = invState()
  const i2 = invState({ invoiceId: 'I2', invoiceNumber: 'INV-043660', referenceNumber: '20948', totalMinor: 10285, balanceMinor: 10285 })
  const a1 = model.assessInvoice({ state: i1, parts: model.splitTransaction(t1, [{ invoiceId: 'I1', grossMinor: 22780 }]), accounts, ownPrefix: 'MSQ-X/', workflowPrefix: 'MSQ', rrns: [t1.rrn] })
  const a2 = model.assessInvoice({ state: i2, parts: model.splitTransaction(t2, [{ invoiceId: 'I2', grossMinor: 10285 }]), accounts, ownPrefix: 'MSQ-X/', workflowPrefix: 'MSQ', rrns: [t2.rrn] })
  const totals = model.analyzeSettlement([t1, t2], config).totals
  return { t1, t2, a1, a2, totals }
}

test('5 Sep example: NET 324.24 + FEE 6.41 receipts, fee journal 6.10 + 0.31, AR and Processing cleared', () => {
  const { a1, a2, totals } = fiveSep()
  assert.deepEqual([totals.grossMinor, totals.commissionMinor, totals.vatMinor, totals.netMinor], [33065, 610, 31, 32424])
  assert.equal(a1.mode, 'NEW')
  const plan = model.buildPostingPlan({ code: 'MSQ-20260905-ABCDEF', invoices: [a1, a2], totals, accounts, date: '2026-09-05', config, feeRecognition: null, bank: { status: 'BANK_MATCHED', amountMinor: 32424 } })
  const byComponent = (rows: any[]) => [...rows].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  assert.deepEqual(byComponent(plan.map((c: any) => [c.component, c.amountMinor, c.reference])), byComponent([
    ['RECEIPT_FEE', 641, 'MSQ-20260905-ABCDEF/FEE/SHOP'],
    ['RECEIPT_NET', 32424, 'MSQ-20260905-ABCDEF/NET/SHOP'],
    ['FEE_RECOGNITION', 641, 'MSQ-20260905-ABCDEF/FEES'],
  ]))
  assert.equal(plan[plan.length - 1].component, 'FEE_RECOGNITION', 'fee journal runs after both receipts')
  const net = plan.find((c: any) => c.component === 'RECEIPT_NET')
  assert.deepEqual(net.allocations.map((a: any) => [a.invoiceNumber, a.amount]), [['INV-043659', 223.39], ['INV-043660', 100.85]])
  assert.equal(net.payload.account_id, 'A1062')
  assert.equal(net.payload.payment_mode, 'Card')
  assert.equal(net.payload.notes, undefined)
  assert.equal(net.payload.description, undefined)
  const fee = plan.find((c: any) => c.component === 'RECEIPT_FEE')
  assert.deepEqual(fee.allocations.map((a: any) => a.amount), [4.41, 2.0])
  assert.equal(fee.payload.account_id, 'A1039')
  const journal = plan.find((c: any) => c.component === 'FEE_RECOGNITION')
  assert.deepEqual(journal.lines.map((l: any) => [l.role, l.side, l.amountMinor]), [['FEE_EXPENSE', 'debit', 610], ['INPUT_VAT', 'debit', 31], ['PROCESSING', 'credit', 641]])
  assert.equal(journal.payload.notes, undefined)
  for (const c of plan) assert.deepEqual(model.componentProblems(c), [])
  const ledger = model.simulateLedger(plan, { invoices: [a1, a2], existingBankMinor: 32424 })
  assert.equal(ledger['AR:I1'], 0)
  assert.equal(ledger['AR:I2'], 0)
  assert.equal(ledger[ROLE.PROCESSING], 0)
  assert.equal(ledger[ROLE.UNDEPOSITED], 0)
  assert.equal(ledger[ROLE.BANK], 32424)
  assert.equal(ledger[ROLE.FEE_EXPENSE], 610)
  assert.equal(ledger[ROLE.INPUT_VAT], 31)
  assert.ok(!JSON.stringify(plan.map((c: any) => c.payload)).match(/HR|attendance|Purchase Planning|Generated/i))
})

test('bank: a deposit seen on RAK plans the transfer dated on the deposit; a matched transfer plans nothing', () => {
  const { a1, a2, totals } = fiveSep()
  const plan = model.buildPostingPlan({ code: 'C', invoices: [a1, a2], totals, accounts, date: '2026-09-05', config, feeRecognition: null, bank: { status: 'BANK_DEPOSIT_SEEN', amountMinor: 32424, date: '2026-09-09' } })
  const b = plan.find((c: any) => c.component === 'BANK_CLEARING')
  assert.equal(b.date, '2026-09-09')
  assert.deepEqual(b.payload, { transaction_type: 'transfer_fund', from_account_id: 'A1062', to_account_id: 'ARAK', amount: 324.24, date: '2026-09-09', reference_number: 'C/BANK' })
  const none = model.buildPostingPlan({ code: 'C', invoices: [a1, a2], totals, accounts, date: '2026-09-05', config, feeRecognition: { status: 'ALREADY_RECOGNIZED' }, bank: { status: 'BANK_DEPOSIT_NOT_FOUND', amountMinor: 32424 } })
  assert.deepEqual(none.map((c: any) => c.component).sort(), ['RECEIPT_FEE', 'RECEIPT_NET'])
})

test('existing gross receipt in POS Undeposited: reused, reclass journal moves the fee part, no new receipts', () => {
  const { t1 } = fiveSep()
  const state = invState({ balanceMinor: 0, status: 'paid', payments: [{ paymentId: 'P1', amountMinor: 22780, referenceNumber: 'POS Machine funds received 05.09.2026', accountId: 'A1062' }] })
  const a = model.assessInvoice({ state, parts: model.splitTransaction(t1, [{ invoiceId: 'I1', grossMinor: 22780 }]), accounts, ownPrefix: 'C/', workflowPrefix: 'MSQ', rrns: [t1.rrn] })
  assert.equal(a.mode, 'EXISTING_RECEIPTS')
  assert.equal(a.reclassMinor, 441)
  const totals = model.analyzeSettlement([t1], config).totals
  const plan = model.buildPostingPlan({ code: 'C', invoices: [a], totals, accounts, date: '2026-09-05', config, feeRecognition: null, bank: { status: 'BANK_MATCHED', amountMinor: totals.netMinor } })
  assert.deepEqual(plan.map((c: any) => c.component), ['RECEIPT_RECLASS', 'FEE_RECOGNITION'])
  assert.deepEqual(plan[0].lines.map((l: any) => [l.role, l.side, l.amountMinor]), [['PROCESSING', 'debit', 441], ['UNDEPOSITED', 'credit', 441]])
  const ledger = model.simulateLedger(plan, { invoices: [a], existingBankMinor: totals.netMinor })
  assert.equal(ledger[ROLE.UNDEPOSITED], 0)
  assert.equal(ledger[ROLE.PROCESSING], 0)
})

test('existing manual NET/FEE receipts exactly as the statement: reused with nothing to reclassify', () => {
  const { t1 } = fiveSep()
  const state = invState({ balanceMinor: 0, payments: [
    { paymentId: 'P1', amountMinor: 22339, referenceNumber: 'POS Machine funds received', accountId: 'A1062' },
    { paymentId: 'P2', amountMinor: 441, referenceNumber: 'POS Machine commission paid', accountId: 'A1039' },
  ] })
  const a = model.assessInvoice({ state, parts: model.splitTransaction(t1, [{ invoiceId: 'I1', grossMinor: 22780 }]), accounts, ownPrefix: 'C/', workflowPrefix: 'MSQ', rrns: [] })
  assert.equal(a.mode, 'EXISTING_RECEIPTS')
  assert.equal(a.reclassMinor, 0)
})

test('invoice states that block: already paid elsewhere, conflicting RRN payment, mismatched existing receipts, insufficient balance', () => {
  const { t1 } = fiveSep()
  const parts = model.splitTransaction(t1, [{ invoiceId: 'I1', grossMinor: 22780 }])
  const run = (state: any) => model.assessInvoice({ state, parts, accounts, ownPrefix: 'C/', workflowPrefix: 'MSQ', rrns: [t1.rrn] })
  assert.equal(run(invState({ balanceMinor: 0, payments: [{ paymentId: 'P', amountMinor: 22780, referenceNumber: 'Cash', accountId: 'CASH' }] })).problem.code, 'INVOICE_ALREADY_PAID')
  assert.equal(run(invState({ balanceMinor: 0, payments: [{ paymentId: 'P', amountMinor: 22780, referenceNumber: 'RRN 003042448545', accountId: 'STRIPE' }] })).problem.code, 'CONFLICTING_PAYMENT')
  assert.equal(run(invState({ balanceMinor: 12780, payments: [{ paymentId: 'P', amountMinor: 10000, referenceNumber: 'POS partial', accountId: 'A1062' }] })).problem.code, 'EXISTING_RECEIPTS_MISMATCH')
  assert.equal(run(invState({ balanceMinor: 10000, payments: [{ paymentId: 'P', amountMinor: 12780, referenceNumber: 'Cash part', accountId: 'CASH' }] })).problem.code, 'BALANCE_INSUFFICIENT')
  // Mixed payment: cash paid part, POS pays the rest → NEW and partial is fine.
  const mixed = model.assessInvoice({ state: invState({ totalMinor: 30000, balanceMinor: 22780, payments: [{ paymentId: 'P', amountMinor: 7220, referenceNumber: 'Cash', accountId: 'CASH' }] }), parts, accounts, ownPrefix: 'C/', workflowPrefix: 'MSQ', rrns: [] })
  assert.equal(mixed.mode, 'NEW')
})

test('multiple transactions on one invoice and one transaction split across invoices stay exact', () => {
  const t1 = txn({ id: '1', minor: { gross: 10000, commission: 185, otherFees: 0, vat: 9, net: 9806 } })
  const t2 = txn({ id: '2', rrn: '003042448546', minor: { gross: 5000, commission: 92, otherFees: 0, vat: 5, net: 4903 } })
  const parts = [...model.splitTransaction(t1, [{ invoiceId: 'I1', grossMinor: 10000 }]), ...model.splitTransaction(t2, [{ invoiceId: 'I1', grossMinor: 5000 }])]
  const a = model.assessInvoice({ state: invState({ totalMinor: 15000, balanceMinor: 15000 }), parts, accounts, ownPrefix: 'C/', workflowPrefix: 'MSQ', rrns: [] })
  assert.equal(a.netMinor + a.feeMinor, 15000)
  const split = model.splitTransaction(txn(), [{ invoiceId: 'I1', grossMinor: 20000 }, { invoiceId: 'I2', grossMinor: 2780 }])
  assert.equal(split.reduce((s: number, p: any) => s + p.netMinor, 0), 22339)
  assert.equal(split.reduce((s: number, p: any) => s + p.feeMinor, 0), 441)
})

test('4 Sep example totals: 2,725.25 gross, 54.50 commission, 2.72 VAT, 2,668.03 net', () => {
  const rows = [
    txn({ id: 'a', rrn: '003038986263', minor: { gross: 34340, commission: 687, otherFees: 0, vat: 34, net: 33619 } }),
    txn({ id: 'b', rrn: '003039026340', minor: { gross: 215815, commission: 4316, otherFees: 0, vat: 216, net: 211283 } }),
    txn({ id: 'c', rrn: '003039170399', minor: { gross: 22270, commission: 445, otherFees: 0, vat: 22, net: 21803 } }),
    txn({ id: 'd', rrn: '003039999999', minor: { gross: 100, commission: 2, otherFees: 0, vat: 0, net: 98 } }),
  ]
  const a = model.analyzeSettlement(rows, config)
  assert.deepEqual([a.totals.grossMinor, a.totals.commissionMinor, a.totals.vatMinor, a.totals.netMinor], [272525, 5450, 272, 266803])
})

test('fingerprint changes when anything posted would change', () => {
  const { a1, a2, totals, t1, t2 } = fiveSep()
  const plan = model.buildPostingPlan({ code: 'C', invoices: [a1, a2], totals, accounts, date: '2026-09-05', config, feeRecognition: null, bank: null })
  const fp = model.postingFingerprint({ code: 'C', date: '2026-09-05', components: plan, bank: null, feeRecognition: null, transactions: [t1, t2] })
  assert.equal(fp, model.postingFingerprint({ code: 'C', date: '2026-09-05', components: plan, bank: null, feeRecognition: null, transactions: [t2, t1] }))
  const other = model.buildPostingPlan({ code: 'C', invoices: [a1, a2], totals, accounts: { ...accounts, [ROLE.UNDEPOSITED]: { accountId: 'X', accountName: 'X' } }, date: '2026-09-05', config, feeRecognition: null, bank: null })
  assert.notEqual(fp, model.postingFingerprint({ code: 'C', date: '2026-09-05', components: other, bank: null, feeRecognition: null, transactions: [t1, t2] }))
})
