'use strict'

/**
 * Test double for Tabby clearing: an in-memory Zoho Books (read side = the sources interface,
 * write side = the writer interface) plus website orders, and a builder for Tabby settlement
 * XLSX files laid out like the real report. Supports failure injection on writes and a lagging
 * search index (records visible to direct reads but not yet to reference searches).
 */

const XLSX = require('xlsx')

const IDS = {
  WEBSITE: '4265011000000160061',
  SHOP: '4265011000038735005',
  UNDEPOSITED: '4265011000007120002',
  UNCLEARED: '4265011000007200848',
  COMMISSION: '4265011000007200881',
  PAYOUT_FEE: '4265011000007120006',
  INPUT_VAT: '4265011000000077044',
  INPUT_VAT_WH: '4265011000000077099',
  RAK: '4265011000000902009',
  OUTPUT_VAT: '4265011000000077046',
}

const CHART = [
  { accountId: IDS.UNDEPOSITED, accountName: 'Tabby Undeposited Funds', accountCode: '1061', accountType: 'cash', isActive: true },
  { accountId: IDS.UNCLEARED, accountName: 'Tabby Un-cleared Commission', accountCode: '1058', accountType: 'cash', isActive: true },
  { accountId: IDS.COMMISSION, accountName: 'Tabby Commission Expense', accountCode: '2125', accountType: 'expense', isActive: true },
  { accountId: IDS.PAYOUT_FEE, accountName: 'Tabby Payout Fee', accountCode: '1056', accountType: 'expense', isActive: true },
  { accountId: IDS.INPUT_VAT, accountName: 'Input VAT - All Except Basmat Goods WH', accountCode: '1085', accountType: 'other_current_asset', isActive: true },
  { accountId: IDS.INPUT_VAT_WH, accountName: 'Input VAT - Basmat Good Wh', accountCode: '5265', accountType: 'other_current_asset', isActive: true },
  { accountId: IDS.RAK, accountName: 'RAK BANK MAIN 5061', accountCode: 'RAK001', accountType: 'bank', isActive: true },
  { accountId: IDS.OUTPUT_VAT, accountName: 'Output VAT', accountCode: '2201', accountType: 'other_current_liability', isActive: true },
]

// Real statement orders booked under "Burjman Shop - Web & App" (website shop_order = true).
const SHOP_ORDER_NUMBERS = new Set(['10622', '10639', '10647', '10554', '10709', '10754'])

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
const minor = (n) => Math.round(Number(n) * 100)

function zohoError(kind) {
  if (kind === 'reject') return Object.assign(new Error('Zoho: invalid value for amount'), { httpStatus: 400, code: 'ZOHO_API_ERROR', zohoResponse: { code: 1001 } })
  if (kind === '5xx') return Object.assign(new Error('Zoho 503 service unavailable'), { httpStatus: 503 })
  return Object.assign(new Error('socket hang up / timeout'), { code: 'ETIMEDOUT' })
}

function createFakeZoho({ chart = CHART } = {}) {
  let seq = 5000
  const id = (p) => `${p}${++seq}`
  const st = { orders: [], invoices: [], payments: [], journals: [], creditNotes: [], bank: [], lagging: new Set(), reads: 0 }
  const accountName = (accountId) => (chart.find((a) => a.accountId === accountId) || {}).accountName || accountId
  const visible = (recordId) => !st.lagging.has(recordId)

  const sources = {
    async loadWebsiteOrdersByIds(ids) { st.reads++; return clone(st.orders.filter((o) => ids.includes(o.orderId))) },
    async loadWebsiteOrdersByInvoiceNumbers(nums) { st.reads++; return clone(st.orders.filter((o) => nums.includes(o.orderNumber))) },
    async findInvoicesByReference(ref) { st.reads++; return clone(st.invoices.filter((i) => i.referenceNumber === ref)) },
    async listInvoicePayments(invoiceId) {
      st.reads++
      return st.payments.filter((p) => p.invoices.some((a) => a.invoice_id === invoiceId)).map((p) => ({ paymentId: p.payment_id, invoiceId, referenceNumber: p.reference_number, amount: p.amount, date: p.date }))
    },
    async findPaymentsByReference(ref) {
      st.reads++
      return st.payments.filter((p) => p.reference_number === ref && visible(p.payment_id)).map((p) => ({ paymentId: p.payment_id, referenceNumber: p.reference_number, amount: p.amount, customerId: p.customer_id, accountId: p.account_id }))
    },
    async getCustomerPayment(pid) { st.reads++; return clone(st.payments.find((p) => p.payment_id === pid) || null) },
    async findJournalsByReference(ref) {
      st.reads++
      return st.journals.filter((j) => j.referenceNumber === ref && visible(j.journalId)).map((j) => ({ journalId: j.journalId, referenceNumber: j.referenceNumber, journalDate: j.journalDate, total: j.total }))
    },
    async listJournalsInRange(start, end) {
      st.reads++
      return st.journals.filter((j) => j.journalDate >= start && j.journalDate <= end).map((j) => ({ journalId: j.journalId, referenceNumber: j.referenceNumber, journalDate: j.journalDate, total: j.total }))
    },
    async getJournal(jid) { st.reads++; return clone(st.journals.find((j) => j.journalId === jid) || null) },
    async findCreditNotesForOrder(orderNumber, customerId) {
      st.reads++
      return clone(st.creditNotes.filter((n) => (n.creditNoteNumber === orderNumber || n.creditNoteNumber.startsWith(`${orderNumber}-`)) && n.customerId === customerId).map(({ refunds, ...n }) => n))
    },
    async getCreditNote(cid) {
      st.reads++
      const n = st.creditNotes.find((x) => x.creditNoteId === cid)
      if (!n) return null
      const { refunds, ...rest } = n
      return clone(rest)
    },
    async listCreditNoteRefunds(cid) {
      st.reads++
      const n = st.creditNotes.find((x) => x.creditNoteId === cid)
      return n ? clone(n.refunds.map(({ fromAccountId, ...r }) => r)) : []
    },
    async getCreditNoteRefund(cid, rid) {
      st.reads++
      const n = st.creditNotes.find((x) => x.creditNoteId === cid)
      const r = n && n.refunds.find((x) => x.creditNoteRefundId === rid)
      return r ? clone({ ...r, fromAccountName: accountName(r.fromAccountId) }) : null
    },
    async listBankTransactions(accountId, start, end) {
      st.reads++
      return st.bank.filter((t) => (t.from === accountId || t.to === accountId) && t.date >= start && t.date <= end).map((t) => ({
        transactionId: t.id,
        date: t.date,
        amount: t.amount,
        transactionType: 'transfer_fund',
        debitOrCredit: t.from === accountId ? 'credit' : 'debit',
        status: 'manually_added',
        referenceNumber: t.reference,
        offsetAccountName: accountName(t.from === accountId ? t.to : t.from),
        offsetAccountId: '',
        description: '',
      }))
    },
    async getBankTransaction(tid) {
      st.reads++
      const t = st.bank.find((x) => x.id === tid)
      return t ? { transactionId: t.id, date: t.date, amount: t.amount, transactionType: 'transfer_fund', referenceNumber: t.reference, fromAccountId: t.from, toAccountId: t.to } : null
    },
    async listChartAccounts() { st.reads++; return clone(chart) },
  }

  const writer = {
    calls: [],
    // Queue of injected outcomes: { kind: 'reject' | 'timeout' | '5xx' | 'noid', create?: boolean, duplicate?: boolean, lag?: boolean }
    faults: [],
    async createCustomerPayment(payload) {
      return this._write('customer_payment', payload, () => {
        const pid = id('PAY')
        st.payments.push({ payment_id: pid, ...clone(payload), account_name: accountName(payload.account_id) })
        for (const a of payload.invoices) {
          const inv = st.invoices.find((i) => i.invoiceId === a.invoice_id)
          if (!inv || minor(inv.balance) < minor(a.amount_applied)) throw zohoError('reject')
          inv.balance = (minor(inv.balance) - minor(a.amount_applied)) / 100
          if (inv.balance === 0) inv.status = 'paid'
        }
        return pid
      })
    },
    async createJournal(payload) {
      return this._write('journal', payload, () => {
        const jid = id('JRN')
        const lineItems = payload.line_items.map((l) => ({ accountId: l.account_id, accountName: accountName(l.account_id), debitOrCredit: l.debit_or_credit, amount: l.amount, customerId: '' }))
        st.journals.push({ journalId: jid, referenceNumber: payload.reference_number, journalDate: payload.journal_date, status: 'published', total: lineItems.filter((l) => l.debitOrCredit === 'debit').reduce((s, l) => s + minor(l.amount), 0) / 100, lineItems, notes: payload.notes })
        return jid
      })
    },
    async createCreditNoteRefund(creditNoteId, payload) {
      return this._write('creditnote_refund', { creditNoteId, ...payload }, () => {
        const n = st.creditNotes.find((x) => x.creditNoteId === creditNoteId)
        if (!n || minor(n.balance) < minor(payload.amount)) throw zohoError('reject')
        const rid = id('CNR')
        n.refunds.push({ creditNoteRefundId: rid, creditNoteId, date: payload.date, referenceNumber: payload.reference_number, amount: payload.amount, refundMode: payload.refund_mode, fromAccountId: payload.from_account_id })
        n.balance = (minor(n.balance) - minor(payload.amount)) / 100
        return rid
      })
    },
    async createBankTransfer(payload) {
      return this._write('bank_transfer', payload, () => {
        const tid = id('BTX')
        st.bank.push({ id: tid, date: payload.date, amount: payload.amount, from: payload.from_account_id, to: payload.to_account_id, reference: payload.reference_number })
        return tid
      })
    },
    async _write(type, payload, create) {
      this.calls.push({ type, payload: clone(payload) })
      const fault = this.faults.shift()
      if (!fault) return { recordId: create() }
      if (fault.kind === 'reject') throw zohoError('reject')
      let recordId = null
      if (fault.create) {
        recordId = create()
        if (fault.duplicate) {
          try {
            create()
          } catch (_) {
            // A duplicate may overdraw the fake invoice; the record itself is what matters.
          }
        }
        if (fault.lag) st.lagging.add(recordId)
      }
      if (fault.kind === 'noid') return { recordId: '' }
      throw zohoError(fault.kind)
    },
  }

  /** Net movement per account (debit positive, fils) across everything in the fake Zoho. */
  function ledger() {
    const bal = {}
    const add = (acc, v) => { bal[acc] = (bal[acc] || 0) + v }
    for (const p of st.payments) add(p.account_id, minor(p.amount))
    for (const j of st.journals) for (const l of j.lineItems) add(l.accountId, l.debitOrCredit === 'debit' ? minor(l.amount) : -minor(l.amount))
    for (const n of st.creditNotes) for (const r of n.refunds) add(r.fromAccountId, -minor(r.amount))
    for (const t of st.bank) { add(t.to, minor(t.amount)); add(t.from, -minor(t.amount)) }
    return bal
  }

  return { st, sources, writer, ledger, IDS }
}

/** Website orders + open Zoho invoices for every sale row of a parsed statement. */
function seedSales(fake, analysisRows, { invoiceNumbers = {}, shopOrders = SHOP_ORDER_NUMBERS } = {}) {
  for (const r of analysisRows.filter((x) => x.kind === 'SALE')) {
    if (fake.st.orders.some((o) => o.orderId === r.orderNumber)) continue
    const gross = r.minor.orderAmount / 100
    const shop = shopOrders.has(r.orderNumber)
    fake.st.orders.push({ orderId: r.orderNumber, orderNumber: r.websiteOrderId, orderStatus: 'delivered', paymentStatus: 'completed', paymentMethod: 'tabby', shopOrder: shop, finalAmount: gross, refundAmount: 0, createdAt: `${r.saleRefundDay}T08:00:00.000Z`, deleted: false })
    fake.st.invoices.push({ invoiceId: `INVID-${r.websiteOrderId}`, invoiceNumber: invoiceNumbers[r.websiteOrderId] || `INV-${r.websiteOrderId}`, referenceNumber: r.websiteOrderId, customerId: shop ? IDS.SHOP : IDS.WEBSITE, status: 'sent', total: gross, balance: gross, currencyCode: 'AED', date: r.saleRefundDay })
  }
}

const HEADERS = ['Order Number', 'website order ID', 'Sale/Refund Date', 'Merchant Name', 'Merchant Code', 'Product Type', 'Type', 'Currency', 'Order Amount', 'Commission Rate', 'Refundable Commission', 'Non Refundable Commission', 'Fixed Fee', 'Total Fee', 'VAT Amount', 'VAT Rate', 'Total Deduction', 'Transferred amount', 'Transfer Date']

function serial(ymd, time = '10:00:00') {
  return Date.parse(`${ymd}T${time}Z`) / 86400000 + 25569
}

/**
 * Tabby settlement report laid out like the real file (metadata in B/D, header on row 11 from
 * column B, payout fee row, totals row, note). Row amounts are major units.
 * @param {{ statementNumber: string, date: string, rows: object[], payoutFee?: { fee: number, vat: number } | null,
 *   totalsOverride?: object, headers?: string[], merchantCode?: string, extraRows?: any[][] }} spec
 */
function buildStatementXlsx(spec) {
  const headers = spec.headers || HEADERS
  const aoa = Array.from({ length: 10 }, () => [])
  aoa[1] = [null, 'Date', null, spec.date.split('-').reverse().join('/')]
  aoa[2] = [null, 'Statement #', null, spec.statementNumber]
  aoa[3] = [null, 'Company Name', null, 'BASMAT AL HAYAT GENERAL TRADING L.L.C']
  aoa[10] = [null, ...headers]
  const cell = (r, h) => {
    const m = {
      'Order Number': r.orderNumber,
      'website order ID': r.websiteOrderId == null ? null : Number(r.websiteOrderId),
      'Sale/Refund Date': serial(r.day || spec.date),
      'Merchant Name': 'Life Smile | App',
      'Merchant Code': r.merchantCode || spec.merchantCode || 'lsapp',
      'Product Type': r.productType || 'Installments: 3 Months',
      Type: r.type,
      Currency: r.currency || 'AED',
      'Order Amount': r.amount,
      'Commission Rate': r.rate == null ? 6.5 : r.rate,
      'Refundable Commission': r.refundable,
      'Non Refundable Commission': r.nonRefundable,
      'Fixed Fee': r.fixed,
      'Total Fee': r.totalFee,
      'VAT Amount': r.vat,
      'VAT Rate': 0.05,
      'Total Deduction': r.deduction,
      'Transferred amount': r.transferred,
      'Transfer Date': serial(spec.date, '00:00:00'),
    }
    return m[h]
  }
  const sum = (k) => spec.rows.reduce((s, r) => s + minor(r[k] || 0), 0) / 100
  for (const r of spec.rows) aoa.push([null, ...headers.map((h) => cell(r, h))])
  if (spec.payoutFee) {
    const pf = spec.payoutFee
    aoa.push([null, ...headers.map((h) => ({ 'Product Type': 'Payout fee', 'Total Fee': pf.fee, 'VAT Amount': pf.vat, 'VAT Rate': 0.05, 'Transferred amount': -((minor(pf.fee) + minor(pf.vat)) / 100) })[h])])
  }
  for (const extra of spec.extraRows || []) aoa.push([null, ...extra])
  const totals = {
    'Order Amount': sum('amount'),
    'Refundable Commission': sum('refundable'),
    'Non Refundable Commission': sum('nonRefundable'),
    'Fixed Fee': sum('fixed'),
    'Total Fee': sum('totalFee'),
    'VAT Amount': sum('vat'),
    'Total Deduction': sum('deduction'),
    'Transferred amount': (minor(sum('transferred')) - (spec.payoutFee ? minor(spec.payoutFee.fee) + minor(spec.payoutFee.vat) : 0)) / 100,
    ...(spec.totalsOverride || {}),
  }
  aoa.push([null, ...headers.map((h) => (h in totals ? totals[h] : null))])
  aoa.push([])
  aoa.push([null, 'Note: This is not an official tax invoice, you shall receive your tax invoice after the end of the month. Payout fee is charged in case transferred total amount is less than certain and you use any payout cycle except month.'])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'SR')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/** A consistent Tabby row: commission 4.5 % refundable + 2 % non-refundable, 1.00 fixed, 5 % VAT. */
function saleRow(orderNumber, websiteOrderId, amount, extra = {}) {
  const a = minor(amount)
  const refundable = Math.round(a * 0.045)
  const nonRefundable = Math.round(a * 0.02)
  const fixed = 100
  const totalFee = refundable + nonRefundable + fixed
  const vat = Math.round(totalFee * 0.05)
  const deduction = totalFee + vat
  return { orderNumber, websiteOrderId, type: 'sale', amount, refundable: refundable / 100, nonRefundable: nonRefundable / 100, fixed: fixed / 100, totalFee: totalFee / 100, vat: vat / 100, deduction: deduction / 100, transferred: (a - deduction) / 100, ...extra }
}

/** Refund row in Tabby's real format: refundable commission (and its VAT) come back, the rest is retained. */
function refundRow(orderNumber, websiteOrderId, amount, { partial = false, fixedBack = 0, ...extra } = {}) {
  const a = minor(amount)
  const refundable = Math.round(a * 0.045)
  const fixed = minor(fixedBack)
  const totalFee = refundable + fixed
  const vat = Math.round(totalFee * 0.05)
  const deduction = totalFee + vat
  return { orderNumber, websiteOrderId, type: partial ? 'partial refund' : 'refund', productType: 'Installments', amount: -a / 100, refundable: -refundable / 100, nonRefundable: 0, fixed: -fixed / 100, totalFee: -totalFee / 100, vat: -vat / 100, deduction: -deduction / 100, transferred: -(a - deduction) / 100, ...extra }
}

module.exports = { createFakeZoho, seedSales, buildStatementXlsx, saleRow, refundRow, IDS, CHART, SHOP_ORDER_NUMBERS, HEADERS }
