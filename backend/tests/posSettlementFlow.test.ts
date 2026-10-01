'use strict'

/**
 * End-to-end POS settlement clearing against a fake Zoho: import → preview → approve → post,
 * with recovery, existing receipts, bank and fee detection, manual mapping and every guard.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeZoho, ACC, SHOP, WEBSITE } = require('./fixtures/posFakeZoho.ts')
const { createPosSources } = require('../src/services/posSettlement/posSettlementSources.ts')
const { createMemoryPosStore } = require('../src/services/posSettlement/posSettlementMemoryStore.ts')
const { importPosFile } = require('../src/services/posSettlement/posSettlementImportService.ts')
const { buildPosPreview } = require('../src/services/posSettlement/posSettlementPreviewService.ts')
const { approvePosSettlement, postPosSettlement } = require('../src/services/posSettlement/posSettlementPostingService.ts')
const { getPosSettlementConfig } = require('../src/config/posSettlement.ts')
const controller = require('../src/controllers/posSettlementController.ts')

const ACTOR = 'user:1'
const NOW = new Date('2026-09-10T08:00:00Z')

const FILE_5_SEP = [
  'Merchant ID,Terminal ID,RRN,STAN,Auth Code,Transaction Type,Transaction Date,Transaction Amount,Commission,VAT,Net Amount',
  '200600123456,BJ000001,003042448545,000123,A1B2C3,PURCHASE,05/09/2026 13:10,227.80,4.20,0.21,223.39',
  '200600123456,BJ000001,003042523578,000124,D4E5F6,PURCHASE,05/09/2026 16:45,102.85,1.90,0.10,100.85',
].join('\n')

type Order = { orderNumber: string; shopOrder: boolean; userAgent: string | null; paymentMethod: string; deleted?: boolean }

function setup({ orders, brv = true, invoices = true }: { orders?: Order[]; brv?: boolean; invoices?: boolean } = {}) {
  const zoho = createFakeZoho()
  if (invoices) {
    zoho.addInvoice({ invoiceId: 'I659', invoiceNumber: 'INV-043659', referenceNumber: '20947', customerId: SHOP, date: '2026-09-05', total: 227.8, notes: 'RRN : 003042448545' })
    zoho.addInvoice({ invoiceId: 'I660', invoiceNumber: 'INV-043660', referenceNumber: '20948', customerId: SHOP, date: '2026-09-05', total: 102.85, notes: 'RRN : 003042523578' })
  }
  if (brv) zoho.addTransfer({ transactionId: 'BRV01117', date: '2026-09-09', amount: 324.24, reference: 'BRV-01117', fromId: ACC.UND.account_id, toId: ACC.RAK.account_id })
  const orderList = (orders || [
    { orderNumber: '20947', shopOrder: true, userAgent: 'web', paymentMethod: 'pos' },
    { orderNumber: '20948', shopOrder: true, userAgent: 'app', paymentMethod: 'pos' },
  ]).map((o) => ({ orderId: o.orderNumber, deleted: false, ...o }))
  const loadWebsiteOrders = {
    byInvoiceNumbers: async (numbers: string[]) => orderList.filter((o) => numbers.includes(o.orderNumber)),
    posOrdersBetween: async () => orderList.filter((o) => o.paymentMethod === 'pos'),
  }
  const sources = createPosSources({ get: zoho.get, loadWebsiteOrders })
  const store = createMemoryPosStore()
  const config = { ...getPosSettlementConfig(), postingEnabled: true }
  let clock = NOW.getTime()
  const now = () => new Date(clock)
  const advance = (minutes: number) => { clock += minutes * 60000 }
  const preview = (extra: any = {}) => buildPosPreview({ settlementId: sid, store, sources, config, now: now(), ...extra })
  let sid = ''
  async function importText(text: string, name = 'enrich.csv') {
    const r = await importPosFile({ buffer: Buffer.from(text), fileName: name, sourceFormat: 'ENRICH_CSV', store, config, actor: ACTOR })
    if (r.settlementIds && r.settlementIds[0]) sid = String(r.settlementIds[0])
    return r
  }
  async function approveAndPost(cfg: any = config) {
    const p = await preview()
    const a = await approvePosSettlement({ settlementId: sid, store, sources, config: cfg, actor: ACTOR, fingerprint: p.fingerprint, now })
    return { approval: a, posted: await postPosSettlement({ settlementId: sid, store, sources, writer: zoho.writer, config: cfg, actor: ACTOR, fingerprint: p.fingerprint, now }) }
  }
  return { zoho, sources, store, config, now, advance, preview, importText, approveAndPost, get sid() { return sid } }
}

const codes = (list: any[]) => list.map((b) => b.code)
const comp = (p: any, name: string) => p.components.filter((c: any) => c.component === name)

test('import: file hash and transaction identity make re-imports idempotent; changed amounts conflict', async () => {
  const s = setup()
  const first = await s.importText(FILE_5_SEP)
  assert.equal(first.result, 'IMPORTED')
  assert.equal(first.settlementIds.length, 1, 'one payout, never split by channel')
  assert.equal((await s.importText(FILE_5_SEP)).result, 'ALREADY_IMPORTED')
  const [header, row1, row2] = FILE_5_SEP.split('\n')
  const reordered = await s.importText([header, row2, row1].join('\n'), 'again.csv')
  assert.equal(reordered.result, 'IMPORTED', 'another file hash')
  assert.equal(reordered.transactions.length, 2)
  assert.ok(reordered.transactions.every((t: any) => t.status === 'DUPLICATE'))
  const changed = await s.importText(FILE_5_SEP.replace('102.85,1.90,0.10,100.85', '102.85,1.80,0.09,100.96'), 'changed.csv')
  assert.equal(changed.result, 'IMPORTED')
  const conflict = changed.transactions.find((t: any) => t.status === 'CONFLICT')
  assert.ok(conflict, 'same transaction with another net is a conflict')
  const p = await s.preview()
  assert.ok(codes(p.blockers).includes('TRANSACTION_CONFLICT'))
  assert.equal(p.canApprove, false)
  assert.equal(s.zoho.writes.length, 0)
})

test('import refuses unreadable files and stores nothing', async () => {
  const s = setup()
  await assert.rejects(() => s.importText(FILE_5_SEP.replace('003042448545', '3042448545')), (e: any) => e.status === 422 && e.code === 'FILE_REFUSED')
  await assert.rejects(() => s.importText(FILE_5_SEP + '\n' + FILE_5_SEP.split('\n')[1]), (e: any) => e.code === 'FILE_REFUSED')
  assert.deepEqual(await s.store.listSettlements(), [])
})

test('5 Sep preview: BurJuman shop, NET 324.24 + FEE 6.41, fee journal, BRV-01117 linked, zero writes', async () => {
  const s = setup()
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.deepEqual(p.blockers, [])
  assert.equal(p.status, 'READY')
  assert.deepEqual(p.totals, { count: 2, gross: 330.65, commission: 6.1, otherFees: 0, vat: 0.31, charges: 6.41, net: 324.24 })
  assert.deepEqual(Object.keys(p.byChannel), ['BURJUMAN_SHOP'])
  assert.ok(p.transactions.every((t: any) => t.channel === 'BURJUMAN_SHOP' && t.match.status === 'MATCHED'))
  const net = comp(p, 'RECEIPT_NET')
  assert.equal(net.length, 1)
  assert.equal(net[0].amount, 324.24)
  assert.equal(net[0].customerId, SHOP)
  assert.equal(comp(p, 'RECEIPT_FEE')[0].amount, 6.41)
  assert.equal(comp(p, 'FEE_RECOGNITION')[0].amount, 6.41)
  assert.equal(comp(p, 'BANK_CLEARING').length, 0, 'the manual BRV transfer is linked, not duplicated')
  assert.equal(p.bank.status, 'BANK_MATCHED')
  assert.equal(p.bank.matched.referenceNumber, 'BRV-01117')
  assert.equal(p.ledger.PROCESSING.balance, 0)
  assert.equal(p.ledger.UNDEPOSITED.balance, 0)
  assert.equal(p.ledger.BANK.balance, 324.24)
  assert.equal(p.canApprove, true)
  assert.equal(p.canPost, false, 'not approved yet')
  assert.equal(s.zoho.writes.length, 0)
  assert.ok(s.zoho.calls.every((c: any) => c.method === 'GET'))
  // A second preview reads no invoice detail again (index is cached by last_modified_time).
  const before = s.zoho.calls.filter((c: any) => /^\/invoices\/[^/]+$/.test(c.path)).length
  const p2 = await s.preview()
  assert.equal(p2.rrnIndex.stats.detailRead, 0)
  assert.equal(p2.fingerprint, p.fingerprint)
  assert.ok(s.zoho.calls.filter((c: any) => /^\/invoices\/[^/]+$/.test(c.path)).length - before <= 2, 'only the live state of the two matched invoices')
})

test('posting guards: disabled server, missing approval, stale approval', async () => {
  const s = setup()
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  const args = { settlementId: s.sid, store: s.store, sources: s.sources, writer: s.zoho.writer, actor: ACTOR, fingerprint: p.fingerprint, now: s.now }
  await assert.rejects(() => postPosSettlement({ ...args, config: { ...s.config, postingEnabled: false } }), (e: any) => e.status === 403 && e.code === 'POSTING_DISABLED')
  await assert.rejects(() => postPosSettlement({ ...args, config: s.config }), (e: any) => e.code === 'NOT_APPROVED')
  await assert.rejects(() => postPosSettlement({ ...args, config: s.config, actor: null }), (e: any) => e.code === 'ACTOR_REQUIRED')
  await approvePosSettlement({ settlementId: s.sid, store: s.store, sources: s.sources, config: s.config, actor: ACTOR, fingerprint: p.fingerprint, now: s.now })
  // Zoho changes after approval: someone records a cash payment on one invoice.
  s.zoho.addPayment({ customerId: SHOP, amount: 102.85, date: '2026-09-06', reference: 'Cash', accountId: ACC.CASH.account_id, invoices: [{ invoiceId: 'I660', amount: 102.85 }] })
  s.zoho.invoices.get('I660').last_modified_time = '2026-09-06T10:00:00+0400'
  await assert.rejects(() => postPosSettlement({ ...args, config: s.config }), (e: any) => e.status === 409 && ['PREVIEW_CHANGED', 'POSTING_BLOCKED'].includes(e.code))
  assert.equal(s.zoho.writes.length, 0)
})

test('approve + post: 2 receipts and the fee journal, invoices paid, bank linked, re-post writes nothing', async () => {
  const s = setup()
  await s.importText(FILE_5_SEP)
  const { posted } = await s.approveAndPost()
  assert.equal(posted.stoppedAt, null, posted.stopReason)
  assert.equal(posted.status, 'POSTED')
  assert.deepEqual(s.zoho.writes.map((w: any) => w.kind).sort(), ['customer_payment', 'customer_payment', 'journal'])
  const net = s.zoho.writes.find((w: any) => w.kind === 'customer_payment' && w.payload.account_id === ACC.UND.account_id).payload
  assert.equal(net.amount, 324.24)
  assert.equal(net.customer_id, SHOP)
  assert.equal(net.payment_mode, 'Card')
  assert.deepEqual(net.invoices.map((i: any) => [i.invoice_id, i.amount_applied]), [['I659', 223.39], ['I660', 100.85]])
  const fee = s.zoho.writes.find((w: any) => w.kind === 'customer_payment' && w.payload.account_id === ACC.PROC.account_id).payload
  assert.equal(fee.amount, 6.41)
  const journal = s.zoho.writes.find((w: any) => w.kind === 'journal').payload
  assert.deepEqual(journal.line_items.map((l: any) => [l.account_id, l.debit_or_credit, l.amount]), [[ACC.FEE.account_id, 'debit', 6.1], [ACC.VAT.account_id, 'debit', 0.31], [ACC.PROC.account_id, 'credit', 6.41]])
  for (const w of s.zoho.writes) {
    assert.equal(w.payload.notes, undefined)
    assert.doesNotMatch(JSON.stringify(w.payload), /HR|attendance|Purchase Planning|Generated/i)
    assert.match(w.payload.reference_number, /^MSQ-20260905-[0-9A-F]{6}\//)
  }
  assert.equal(s.zoho.invoices.get('I659').balance, 0)
  assert.equal(s.zoho.invoices.get('I660').balance, 0)
  const settlement = await s.store.getSettlement(s.sid)
  assert.equal(settlement.bankTransactionId, 'BRV01117')
  assert.ok(settlement.postedAt)

  const again = await postPosSettlement({ settlementId: s.sid, store: s.store, sources: s.sources, writer: s.zoho.writer, config: s.config, actor: ACTOR, fingerprint: settlement.approval.fingerprint, now: s.now })
  assert.equal(again.status, 'POSTED')
  assert.equal(s.zoho.writes.length, 3, 'nothing posted twice')
  const p = await s.preview({ deep: true })
  assert.equal(p.status, 'POSTED')
  assert.deepEqual(p.blockers, [])
})

test('uncertain write: a timeout after Zoho created the record is recovered by reference, never re-sent', async () => {
  const s = setup()
  await s.importText(FILE_5_SEP)
  s.zoho.behaviour.failNext = 'timeout_after_create'
  const { posted } = await s.approveAndPost()
  assert.equal(posted.status, 'POSTED')
  assert.equal(s.zoho.payments.size, 2, 'exactly one NET and one FEE payment exist')
  assert.ok(posted.log.some((l: any) => /recovered/i.test(l.message)))
})

test('uncertain write with nothing in Zoho: waits the settle window, then retries once', async () => {
  const s = setup()
  await s.importText(FILE_5_SEP)
  s.zoho.behaviour.failNext = 'timeout_before_create'
  const { posted } = await s.approveAndPost()
  assert.equal(posted.status === 'POSTED', false)
  assert.ok(posted.stoppedAt)
  assert.equal(s.zoho.payments.size, 0)
  const fp = (await s.store.getSettlement(s.sid)).approval.fingerprint
  const post = () => postPosSettlement({ settlementId: s.sid, store: s.store, sources: s.sources, writer: s.zoho.writer, config: s.config, actor: ACTOR, fingerprint: fp, now: s.now })
  const early = await post()
  assert.ok(early.stoppedAt, 'still inside the settle window: not re-sent')
  assert.equal(s.zoho.payments.size, 0)
  s.advance(6)
  const later = await post()
  assert.equal(later.status, 'POSTED', later.stopReason)
  assert.equal(s.zoho.payments.size, 2)
})

test('rejected write fails cleanly and can be retried', async () => {
  const s = setup()
  await s.importText(FILE_5_SEP)
  s.zoho.behaviour.failNext = 'reject'
  const { posted } = await s.approveAndPost()
  assert.ok(posted.stoppedAt)
  assert.equal(s.zoho.payments.size, 0)
  const fp = (await s.store.getSettlement(s.sid)).approval.fingerprint
  const retry = await postPosSettlement({ settlementId: s.sid, store: s.store, sources: s.sources, writer: s.zoho.writer, config: s.config, actor: ACTOR, fingerprint: fp, now: s.now })
  assert.equal(retry.status, 'POSTED', retry.stopReason)
})

test('channel mismatch: a web-app order on the shop customer blocks', async () => {
  const s = setup({ orders: [{ orderNumber: '20947', shopOrder: false, userAgent: 'app', paymentMethod: 'pos' }, { orderNumber: '20948', shopOrder: true, userAgent: 'app', paymentMethod: 'pos' }] })
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.ok(codes(p.blockers).includes('CHANNEL_MISMATCH'))
  assert.equal(p.canApprove, false)
})

test('an invoice already paid another way blocks the payout', async () => {
  const s = setup()
  s.zoho.addPayment({ customerId: SHOP, amount: 227.8, date: '2026-09-05', reference: 'Cash sale', accountId: ACC.CASH.account_id, invoices: [{ invoiceId: 'I659', amount: 227.8 }] })
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.ok(codes(p.blockers).includes('INVOICE_ALREADY_PAID'))
})

test('existing gross POS receipts are reused: reclass journal + fee journal, no new receipts', async () => {
  const s = setup()
  s.zoho.addPayment({ customerId: SHOP, amount: 330.65, date: '2026-09-05', reference: 'POS Machine funds received 05.09.2026', accountId: ACC.UND.account_id, invoices: [{ invoiceId: 'I659', amount: 227.8 }, { invoiceId: 'I660', amount: 102.85 }] })
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.deepEqual(p.blockers, [])
  assert.ok(codes(p.warnings).includes('EXISTING_RECEIPTS_REUSED'))
  assert.deepEqual(p.components.map((c: any) => c.component), ['RECEIPT_RECLASS', 'FEE_RECOGNITION'])
  assert.equal(comp(p, 'RECEIPT_RECLASS')[0].amount, 6.41)
  const { posted } = await s.approveAndPost()
  assert.equal(posted.status, 'POSTED', posted.stopReason)
  assert.deepEqual(s.zoho.writes.map((w: any) => w.kind), ['journal', 'journal'])
})

test('fee already recognised by a manual CPV expense: fee journal skipped', async () => {
  const s = setup()
  s.zoho.addBankTxn(ACC.PROC.account_id, { date: '2026-09-09', amount: 6.41, transaction_type: 'expense', debit_or_credit: 'credit', reference_number: 'CPV-2918 POS-Machine fee INV-043659 INV-043660', offset_account_id: ACC.FEE.account_id })
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.deepEqual(p.blockers, [])
  assert.equal(p.feeRecognition.status, 'ALREADY_RECOGNIZED')
  assert.equal(comp(p, 'FEE_RECOGNITION').length, 0)
  assert.equal(p.ledger.PROCESSING.balance, 0)
})

test('an unexplained exact credit on POS Processing blocks until confirmed', async () => {
  const s = setup()
  s.zoho.addBankTxn(ACC.PROC.account_id, { date: '2026-09-09', amount: 6.41, transaction_type: 'expense', debit_or_credit: 'credit', reference_number: 'CPV-3000' })
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.ok(codes(p.blockers).includes('FEE_RECOGNITION_UNCERTAIN'))
})

test('RAK deposit seen without transfer: transfer planned on the deposit date and posted', async () => {
  const s = setup({ brv: false })
  s.zoho.addBankTxn(ACC.RAK.account_id, { date: '2026-09-08', amount: 324.24, transaction_type: 'deposit', debit_or_credit: 'debit', status: 'uncategorized' })
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.equal(p.bank.status, 'BANK_DEPOSIT_SEEN')
  const bank = comp(p, 'BANK_CLEARING')[0]
  assert.equal(bank.amount, 324.24)
  assert.equal(bank.date, '2026-09-08')
  const { posted } = await s.approveAndPost()
  assert.equal(posted.status, 'POSTED', posted.stopReason)
  assert.ok(s.zoho.writes.some((w: any) => w.kind === 'bank_transfer' && w.payload.from_account_id === ACC.UND.account_id && w.payload.to_account_id === ACC.RAK.account_id))
})

test('no deposit yet: receipts and fees post, the bank step waits', async () => {
  const s = setup({ brv: false })
  await s.importText(FILE_5_SEP)
  const p = await s.preview()
  assert.equal(p.bank.status, 'BANK_DEPOSIT_NOT_FOUND')
  assert.ok(codes(p.warnings).includes('BANK_DEPOSIT_NOT_FOUND'))
  assert.equal(p.ledger.UNDEPOSITED.balance, 324.24)
  const { posted } = await s.approveAndPost()
  assert.match(posted.stopReason, /Bank step waiting/)
  assert.equal(posted.status, 'PARTIALLY_POSTED')
})

test('manual bank link must be the exact POS → RAK transfer', async () => {
  const s = setup({ brv: false })
  s.zoho.addTransfer({ transactionId: 'T1', date: '2026-09-09', amount: 300, reference: 'BRV-9', fromId: ACC.UND.account_id, toId: ACC.RAK.account_id })
  await s.importText(FILE_5_SEP)
  controller.setDeps({ store: s.store, sources: s.sources, writer: s.zoho.writer })
  const res = fakeRes()
  await controller.postBankLink({ params: { id: s.sid }, body: { transactionId: 'T1' }, user: { userId: 1 } }, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /300/)
})

function fakeRes() {
  const res: any = { statusCode: 200, body: null }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  return res
}

test('RRN not on any invoice: possible match shown, manual mapping (one customer, exact gross, audited) resolves it', async () => {
  const s = setup({ invoices: false })
  s.zoho.addInvoice({ invoiceId: 'I659', invoiceNumber: 'INV-043659', referenceNumber: '20947', customerId: SHOP, date: '2026-09-05', total: 227.8, notes: '' })
  s.zoho.addInvoice({ invoiceId: 'I660', invoiceNumber: 'INV-043660', referenceNumber: '20948', customerId: SHOP, date: '2026-09-05', total: 102.85, notes: 'RRN : 003042523578' })
  s.zoho.addInvoice({ invoiceId: 'IW', invoiceNumber: 'INV-W', referenceNumber: '30000', customerId: WEBSITE, date: '2026-09-05', total: 500, notes: '' })
  await s.importText(FILE_5_SEP)
  let p = await s.preview()
  const t = p.transactions.find((x: any) => x.rrn === '003042448545')
  assert.equal(t.match.status, 'RRN_NOT_FOUND')
  assert.deepEqual(t.match.possible.map((i: any) => i.invoiceNumber), ['INV-043659'], 'date + amount is only a possible match')
  assert.ok(codes(p.blockers).includes('RRN_NOT_FOUND'))

  controller.setDeps({ store: s.store, sources: s.sources, writer: s.zoho.writer })
  const user = { userId: 7 }
  let res = fakeRes()
  await controller.postManualMapping({ params: { id: t.id }, body: { reason: 'Receipt shows INV-043659', allocations: [{ invoiceId: 'I659', amount: 200 }, { invoiceId: 'IW', amount: 27.8 }] }, user }, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /same Zoho customer/)
  res = fakeRes()
  await controller.postManualMapping({ params: { id: t.id }, body: { reason: 'Receipt shows INV-043659', allocations: [{ invoiceId: 'I659', amount: 200 }] }, user }, res)
  assert.match(res.body.error, /total 200.00, the transaction is 227.80/)
  res = fakeRes()
  await controller.postManualMapping({ params: { id: t.id }, body: { reason: 'Receipt shows INV-043659', allocations: [{ invoiceId: 'I659', amount: '227.805' }] }, user }, res)
  assert.match(res.body.error, /not a valid amount/)
  res = fakeRes()
  await controller.postManualMapping({ params: { id: t.id }, body: { reason: 'Receipt shows INV-043659', allocations: [{ invoiceId: 'I659', amount: 227.8 }] }, user }, res)
  assert.equal(res.statusCode, 201, JSON.stringify(res.body))
  assert.equal(res.body.mapping.actor || res.body.mapping.createdBy, 'user:7')
  assert.equal(res.body.mapping.autoResult.status, 'RRN_NOT_FOUND')

  p = await s.preview()
  assert.deepEqual(p.blockers, [])
  assert.equal(p.transactions.find((x: any) => x.rrn === '003042448545').match.status, 'MANUAL')
  assert.equal(comp(p, 'RECEIPT_NET')[0].amount, 324.24)
})
