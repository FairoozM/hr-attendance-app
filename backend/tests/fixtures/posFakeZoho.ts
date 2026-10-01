'use strict'

/**
 * Stateful fake of the Zoho Books endpoints POS settlement clearing reads, plus a writer that
 * records what would be created (and makes it visible to later reads, so verification and
 * recovery paths run for real). Account IDs and names mirror the real organisation.
 */

const ACC = {
  UND: { account_id: '4265011000012257029', account_name: 'POS-Machine Undeposited Funds', account_code: '1062', account_type: 'cash', is_active: true },
  PROC: { account_id: '4265011000012784228', account_name: 'POS-Machine Uncleared Commission Exp', account_code: '1039', account_type: 'cash', is_active: true },
  FEE: { account_id: '4265011000012257037', account_name: 'POS-Machine Transaction Fee', account_code: '2126', account_type: 'expense', is_active: true },
  VAT: { account_id: '4265011000000077044', account_name: 'Input VAT - All Except Basmat Goods WH', account_code: '1085', account_type: 'other_current_asset', is_active: true },
  RAK: { account_id: '4265011000000902009', account_name: 'RAK BANK MAIN 5061', account_code: 'RAK001', account_type: 'bank', is_active: true },
  WEB_POS: { account_id: '4265011000008347651', account_name: 'Website Uncleared POS Chg.', account_code: '1229', account_type: 'cash', is_active: true },
  STRIPE: { account_id: '4265011000000001019', account_name: 'Stripe Undeposited Funds', account_code: '1019', account_type: 'cash', is_active: true },
  CASH: { account_id: '4265011000000000777', account_name: 'Petty Cash', account_code: '1001', account_type: 'cash', is_active: true },
}

const SHOP = '4265011000038735005'
const WEBSITE = '4265011000000160061'

const money = (n: number) => Math.round(n * 100) / 100

function createFakeZoho() {
  let seq = 1000
  const id = (p: string) => `${p}${++seq}`
  const invoices = new Map<string, any>()
  const payments = new Map<string, any>()
  const journals = new Map<string, any>()
  const bank = new Map<string, any>()
  const calls: Array<{ method: string; path: string; params: Record<string, string> }> = []
  const writes: Array<{ kind: string; payload: any }> = []
  const accountById = new Map(Object.values(ACC).map((a) => [a.account_id, a]))

  function addInvoice(inv: { invoiceId?: string; invoiceNumber: string; referenceNumber: string; customerId: string; date: string; total: number; notes?: string; status?: string; currency?: string }) {
    const row = {
      invoice_id: inv.invoiceId || id('INV'),
      invoice_number: inv.invoiceNumber,
      reference_number: inv.referenceNumber,
      customer_id: inv.customerId,
      customer_name: inv.customerId === SHOP ? 'Burjman Shop - Web & App' : inv.customerId === WEBSITE ? 'Website' : 'Other customer',
      date: inv.date,
      total: inv.total,
      balance: inv.total,
      status: inv.status || 'sent',
      currency_code: inv.currency || 'AED',
      notes: inv.notes || '',
      last_modified_time: `${inv.date}T10:00:00+0400`,
      custom_fields: [],
      _payments: [] as string[],
    }
    invoices.set(row.invoice_id, row)
    return row
  }

  function addBankTxn(accountId: string, t: any) {
    const row = { transaction_id: t.transaction_id || id('BT'), date: t.date, amount: t.amount, transaction_type: t.transaction_type, debit_or_credit: t.debit_or_credit, status: t.status || 'categorized', reference_number: t.reference_number || '', offset_account_id: t.offset_account_id || '', offset_account_name: t.offset_account_name || '', description: '', from_account_id: t.from_account_id || '', to_account_id: t.to_account_id || '', from_account_name: t.from_account_name || '', to_account_name: t.to_account_name || '', _account: accountId }
    bank.set(row.transaction_id, row)
    return row
  }

  /** A customer payment already in Zoho (manual or created through the writer). */
  function addPayment(p: { customerId: string; amount: number; date: string; reference: string; accountId: string; invoices: Array<{ invoiceId: string; amount: number }>; description?: string }) {
    const pid = id('PAY')
    const acc = accountById.get(p.accountId)
    const row = { payment_id: pid, customer_id: p.customerId, amount: p.amount, date: p.date, reference_number: p.reference, description: p.description || '', account_id: p.accountId, account_name: acc ? acc.account_name : '', payment_mode: 'Card', invoices: p.invoices.map((i) => ({ invoice_id: i.invoiceId, invoice_number: invoices.get(i.invoiceId).invoice_number, amount_applied: i.amount })) }
    payments.set(pid, row)
    for (const i of p.invoices) {
      const inv = invoices.get(i.invoiceId)
      inv.balance = money(inv.balance - i.amount)
      inv._payments.push(pid)
      inv.status = inv.balance === 0 ? 'paid' : 'partially_paid'
    }
    addBankTxn(p.accountId, { date: p.date, amount: p.amount, transaction_type: 'customer_payment', debit_or_credit: 'debit', reference_number: p.reference })
    return row
  }

  function addJournal(j: { date: string; reference: string; lines: Array<{ account_id: string; debit_or_credit: string; amount: number }> }) {
    const jid = id('JRN')
    const row = { journal_id: jid, journal_date: j.date, reference_number: j.reference, status: 'published', total: j.lines.filter((l) => l.debit_or_credit === 'debit').reduce((s, l) => s + l.amount, 0), line_items: j.lines.map((l) => ({ ...l, account_name: (accountById.get(l.account_id) || {}).account_name || '' })) }
    journals.set(jid, row)
    for (const l of j.lines) addBankTxn(l.account_id, { date: j.date, amount: l.amount, transaction_type: 'journal', debit_or_credit: l.debit_or_credit, reference_number: j.reference })
    return row
  }

  function addTransfer(t: { date: string; amount: number; reference: string; fromId: string; toId: string; transactionId?: string }) {
    const from = accountById.get(t.fromId)!
    const to = accountById.get(t.toId)!
    const tid = t.transactionId || id('TRF')
    addBankTxn(t.fromId, { transaction_id: tid, date: t.date, amount: t.amount, transaction_type: 'transfer_fund', debit_or_credit: 'credit', reference_number: t.reference, offset_account_id: t.toId, offset_account_name: to.account_name, from_account_id: t.fromId, to_account_id: t.toId, from_account_name: from.account_name, to_account_name: to.account_name })
    addBankTxn(t.toId, { transaction_id: `${tid}-to`, date: t.date, amount: t.amount, transaction_type: 'transfer_fund', debit_or_credit: 'debit', reference_number: t.reference, offset_account_id: t.fromId, offset_account_name: from.account_name })
    return tid
  }

  const listInvoice = (i: any) => { const { notes, custom_fields, _payments, ...rest } = i; return rest }

  async function get(path: string, params: Record<string, string> = {}) {
    calls.push({ method: 'GET', path, params })
    let m: RegExpExecArray | null
    if (path === '/chartofaccounts') return { chartofaccounts: Object.values(ACC) }
    if (path === '/invoices') {
      let rows = [...invoices.values()]
      if (params.search_text) rows = rows.filter((i) => `${i.invoice_number} ${i.reference_number} ${i.customer_name}`.toLowerCase().includes(params.search_text.toLowerCase()))
      if (params.customer_id) rows = rows.filter((i) => i.customer_id === params.customer_id)
      if (params.date_start) rows = rows.filter((i) => i.date >= params.date_start && i.date <= params.date_end)
      return { invoices: rows.map(listInvoice), page_context: { has_more_page: false } }
    }
    if ((m = /^\/invoices\/([^/]+)\/payments$/.exec(path))) {
      const inv = invoices.get(decodeURIComponent(m[1]))
      if (!inv) throw Object.assign(new Error('not found'), { httpStatus: 404 })
      return { payments: inv._payments.map((pid: string) => { const p = payments.get(pid); const ap = p.invoices.find((x: any) => x.invoice_id === inv.invoice_id); return { payment_id: pid, reference_number: p.reference_number, amount: ap.amount_applied, date: p.date } }) }
    }
    if ((m = /^\/invoices\/([^/]+)$/.exec(path))) {
      const inv = invoices.get(decodeURIComponent(m[1]))
      if (!inv) throw Object.assign(new Error('not found'), { httpStatus: 404 })
      const { _payments, ...rest } = inv
      return { invoice: rest }
    }
    if (path === '/customerpayments') {
      const rows = [...payments.values()].filter((p) => p.reference_number === params.reference_number)
      return { customerpayments: rows.map(({ invoices: _i, ...p }) => p), page_context: { has_more_page: false } }
    }
    if ((m = /^\/customerpayments\/([^/]+)$/.exec(path))) {
      const p = payments.get(decodeURIComponent(m[1]))
      if (!p) throw Object.assign(new Error('not found'), { httpStatus: 404 })
      return { payment: p }
    }
    if (path === '/journals') {
      let rows = [...journals.values()]
      if (params.reference_number_contains) rows = rows.filter((j) => j.reference_number.includes(params.reference_number_contains))
      if (params.date_start) rows = rows.filter((j) => j.journal_date >= params.date_start && j.journal_date <= params.date_end)
      return { journals: rows.map(({ line_items, ...j }) => j), page_context: { has_more_page: false } }
    }
    if ((m = /^\/journals\/([^/]+)$/.exec(path))) {
      const j = journals.get(decodeURIComponent(m[1]))
      if (!j) throw Object.assign(new Error('not found'), { httpStatus: 404 })
      return { journal: j }
    }
    if (path === '/banktransactions') {
      const rows = [...bank.values()].filter((t) => t._account === params.account_id).sort((a, b) => b.date.localeCompare(a.date))
      return { banktransactions: rows.map(({ _account, ...t }) => t), page_context: { has_more_page: false } }
    }
    if ((m = /^\/banktransactions\/([^/]+)$/.exec(path))) {
      const t = bank.get(decodeURIComponent(m[1]))
      if (!t) throw Object.assign(new Error('not found'), { httpStatus: 404 })
      return { banktransaction: t }
    }
    throw new Error(`Fake Zoho has no GET ${path}`)
  }

  /** Writer with the posting writer's interface. `failNext` simulates Zoho outcomes. */
  const behaviour = { failNext: null as null | 'reject' | 'timeout_after_create' | 'timeout_before_create' }
  function outcome(create: () => string) {
    const mode = behaviour.failNext
    behaviour.failNext = null
    if (mode === 'reject') throw Object.assign(new Error('Zoho rejected the request'), { httpStatus: 400, zohoCode: 1001 })
    if (mode === 'timeout_before_create') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    const recordId = create()
    if (mode === 'timeout_after_create') throw Object.assign(new Error('timeout'), { httpStatus: 504 })
    return { recordId }
  }
  const writer = {
    async createCustomerPayment(payload: any) {
      writes.push({ kind: 'customer_payment', payload })
      return outcome(() => addPayment({ customerId: payload.customer_id, amount: payload.amount, date: payload.date, reference: payload.reference_number, accountId: payload.account_id, invoices: payload.invoices.map((i: any) => ({ invoiceId: i.invoice_id, amount: i.amount_applied })) }).payment_id)
    },
    async createJournal(payload: any) {
      writes.push({ kind: 'journal', payload })
      return outcome(() => addJournal({ date: payload.journal_date, reference: payload.reference_number, lines: payload.line_items }).journal_id)
    },
    async createBankTransfer(payload: any) {
      writes.push({ kind: 'bank_transfer', payload })
      return outcome(() => addTransfer({ date: payload.date, amount: payload.amount, reference: payload.reference_number, fromId: payload.from_account_id, toId: payload.to_account_id }))
    },
    async createCreditNoteRefund() {
      throw new Error('never')
    },
  }

  return { ACC, SHOP, WEBSITE, get, writer, behaviour, calls, writes, invoices, payments, journals, bank, addInvoice, addPayment, addJournal, addTransfer, addBankTxn }
}

module.exports = { createFakeZoho, ACC, SHOP, WEBSITE }
