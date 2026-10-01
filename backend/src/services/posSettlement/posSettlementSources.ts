'use strict'

/**
 * Read-only data sources for POS settlement clearing: Zoho Books GETs and the website database.
 * Every Zoho call goes through one injected `get(path, params, opts)`, so the production client
 * (zohoApiClient, quota + logging) and a GET-only transport for dry runs are interchangeable.
 * Nothing here writes anywhere.
 */

type Get = (path: string, params: Record<string, string>, opts?: { critical?: boolean; source?: string }) => Promise<any>

const SOURCE = 'pos_settlement_preview'

function clean(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Zoho major amount → fils, from the decimal string (never a float product). */
function fils(value: unknown): number {
  const s = clean(value)
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return Math.round(num(value) * 100)
  const neg = s.startsWith('-')
  const [i, d = ''] = s.replace('-', '').split('.')
  const v = Number(i) * 100 + Number((d + '00').slice(0, 2))
  return neg ? -v : v
}

function lookupError(code: string, message: string) {
  const err: any = new Error(message)
  err.code = code
  err.status = 502
  return err
}

async function orNullOn404<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (err: any) {
    if (Number(err && err.httpStatus) === 404) return null
    throw err
  }
}

function mapInvoice(inv: any) {
  return {
    invoiceId: clean(inv.invoice_id),
    invoiceNumber: clean(inv.invoice_number),
    referenceNumber: clean(inv.reference_number),
    customerId: clean(inv.customer_id),
    customerName: clean(inv.customer_name),
    status: clean(inv.status).toLowerCase(),
    date: clean(inv.date),
    totalMinor: fils(inv.total),
    balanceMinor: fils(inv.balance),
    currencyCode: clean(inv.currency_code).toUpperCase(),
    lastModifiedTime: clean(inv.last_modified_time),
  }
}

function mapBankTransaction(t: any) {
  return {
    transactionId: clean(t.transaction_id),
    date: clean(t.date),
    amount: num(t.amount),
    amountMinor: fils(t.amount),
    transactionType: clean(t.transaction_type),
    debitOrCredit: clean(t.debit_or_credit),
    status: clean(t.status),
    referenceNumber: clean(t.reference_number),
    offsetAccountName: clean(t.offset_account_name),
    offsetAccountId: clean(t.offset_account_id),
    description: clean(t.description),
    payee: clean(t.payee),
  }
}

/** The text of the field that carries the RRN: a top-level field ("notes") or a custom field. */
function rrnFieldText(inv: any, field: string): string {
  if (!field.startsWith('cf_')) return clean(inv[field])
  const list = Array.isArray(inv.custom_fields) ? inv.custom_fields : []
  const cf = list.find((f: any) => clean(f.api_name) === field || clean(f.placeholder) === field || clean(f.label).toLowerCase() === field.slice(3).toLowerCase())
  return cf ? clean(cf.value) : clean(inv[field])
}

const LIST_PAGE_SIZE = 200
const BANK_MAX_PAGES = 25

function createPosSources({ get, loadWebsiteOrders = null }: { get: Get; loadWebsiteOrders?: null | { byInvoiceNumbers: (n: string[]) => Promise<any[]>; posOrdersBetween: (from: string, to: string) => Promise<any[]> } }) {
  const call = (path: string, params: Record<string, string> = {}, opts: { critical?: boolean } = {}) => get(path, params, { source: SOURCE, ...opts })

  async function listAll(path: string, params: Record<string, string>, key: string, { maxPages = 5, critical = false } = {}) {
    const out: any[] = []
    for (let page = 1; page <= maxPages; page++) {
      const json = await call(path, { ...params, per_page: String(LIST_PAGE_SIZE), page: String(page) }, { critical })
      if (!json || !Array.isArray(json[key])) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho ${path} answered without a "${key}" list; lookup is not reliable.`)
      out.push(...json[key])
      if (!(json.page_context && json.page_context.has_more_page)) return out
    }
    throw lookupError('ZOHO_LOOKUP_INCOMPLETE', `Zoho ${path} has more than ${maxPages} page(s) of results; lookup is incomplete.`)
  }

  return {
    /** Invoices of one customer dated from..to (list shape: no notes). */
    async listInvoices({ customerId, dateFrom, dateTo }: { customerId: string; dateFrom: string; dateTo: string }) {
      const rows = (await listAll('/invoices', { customer_id: customerId, date_start: dateFrom, date_end: dateTo, sort_column: 'date' }, 'invoices', { maxPages: 10 })).map(mapInvoice)
      if (rows.some((i) => i.customerId !== customerId || i.date < dateFrom || i.date > dateTo)) {
        throw lookupError('ZOHO_FILTER_IGNORED', `Zoho ignored the invoice filter (customer ${customerId}, ${dateFrom}..${dateTo}); lookup is not exact.`)
      }
      return rows
    },

    /** Invoice detail with the RRN field text, or null when Zoho no longer has it. */
    async getInvoice(invoiceId: string, { rrnField = 'notes', critical = false }: { rrnField?: string; critical?: boolean } = {}) {
      const id = clean(invoiceId)
      if (!id) return null
      return orNullOn404(async () => {
        const json = await call(`/invoices/${encodeURIComponent(id)}`, {}, { critical })
        const inv = json && json.invoice
        if (!inv) return null
        return { ...mapInvoice(inv), rrnText: rrnFieldText(inv, rrnField) }
      })
    },

    /** Free-text invoice search for manual mapping (invoice number, reference, customer). */
    async searchInvoices(text: string) {
      const q = clean(text)
      if (!q) return []
      const json = await call('/invoices', { search_text: q, per_page: '25', sort_column: 'date', sort_order: 'D' })
      return (json && Array.isArray(json.invoices) ? json.invoices : []).map(mapInvoice)
    },

    /**
     * Payments applied to one invoice, read from the invoice, each with the account it was
     * deposited to (from the payment detail). An unreadable invoice is an error, never "no payments".
     */
    async listInvoicePaymentsWithAccounts(invoiceId: string, { critical = false } = {}) {
      const id = clean(invoiceId)
      const json = await orNullOn404(() => call(`/invoices/${encodeURIComponent(id)}/payments`, {}, { critical }))
      if (json === null) throw lookupError('ZOHO_INVOICE_NOT_FOUND', `Zoho invoice ${id} was not found; its payments cannot be read.`)
      if (!json || !Array.isArray(json.payments)) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho invoice ${id} payments answered without a "payments" list.`)
      if (json.page_context && json.page_context.has_more_page) throw lookupError('ZOHO_LOOKUP_INCOMPLETE', `Zoho invoice ${id} has more payments than one page.`)
      const out = []
      for (const p of json.payments) {
        const paymentId = clean(p.payment_id)
        const detailJson = paymentId ? await orNullOn404(() => call(`/customerpayments/${encodeURIComponent(paymentId)}`, {}, { critical })) : null
        const d = detailJson && (detailJson.payment || detailJson.customerpayment)
        if (!d) throw lookupError('ZOHO_LOOKUP_INCOMPLETE', `Zoho payment ${paymentId || '?'} on invoice ${id} could not be read.`)
        const applied = (Array.isArray(d.invoices) ? d.invoices : []).filter((x: any) => clean(x.invoice_id) === id).reduce((s: number, x: any) => s + fils(x.amount_applied), 0)
        out.push({
          paymentId,
          referenceNumber: clean(d.reference_number || p.reference_number),
          description: clean(d.description),
          date: clean(d.date || p.date),
          amountMinor: applied || fils(p.amount),
          paymentTotalMinor: fils(d.amount),
          accountId: clean(d.account_id),
          accountName: clean(d.account_name),
          paymentMode: clean(d.payment_mode),
          customerId: clean(d.customer_id),
        })
      }
      return out
    },

    // ── Methods used by the shared Tabby recovery checks (componentZohoState / postOne) ──

    async findPaymentsByReference(reference: string, { critical = false } = {}) {
      const ref = clean(reference)
      if (!ref) return []
      const rows = await listAll('/customerpayments', { reference_number: ref }, 'customerpayments', { critical })
      const payments = rows.map((p: any) => ({ paymentId: clean(p.payment_id), referenceNumber: clean(p.reference_number), amount: num(p.amount), date: clean(p.date), customerId: clean(p.customer_id), accountId: clean(p.account_id) }))
      if (payments.some((p: any) => p.referenceNumber !== ref)) throw lookupError('ZOHO_REFERENCE_FILTER_IGNORED', `Zoho ignored the payment reference filter for ${ref}; lookup is not exact.`)
      return payments
    },

    async listInvoicePayments(invoiceId: string, { critical = false } = {}) {
      const id = clean(invoiceId)
      const json = await orNullOn404(() => call(`/invoices/${encodeURIComponent(id)}/payments`, {}, { critical }))
      if (json === null) throw lookupError('ZOHO_INVOICE_NOT_FOUND', `Zoho invoice ${id} was not found; its payments cannot be read.`)
      if (!json || !Array.isArray(json.payments)) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho invoice ${id} payments answered without a "payments" list.`)
      return json.payments.map((p: any) => ({ paymentId: clean(p.payment_id), invoiceId: id, referenceNumber: clean(p.reference_number), amount: num(p.amount), date: clean(p.date) }))
    },

    async getCustomerPayment(paymentId: string) {
      const id = clean(paymentId)
      if (!id) return null
      const json = await orNullOn404(() => call(`/customerpayments/${encodeURIComponent(id)}`, {}, { critical: true }))
      return (json && (json.payment || json.customerpayment)) || null
    },

    async findJournalsByReference(reference: string, { critical = false } = {}) {
      const ref = clean(reference)
      if (!ref) return []
      const rows = await listAll('/journals', { reference_number_contains: ref, sort_column: 'journal_date' }, 'journals', { critical })
      const journals = rows.map((j: any) => ({ journalId: clean(j.journal_id), referenceNumber: clean(j.reference_number), journalDate: clean(j.journal_date), total: num(j.total) }))
      if (journals.some((j: any) => !j.referenceNumber.includes(ref))) throw lookupError('ZOHO_REFERENCE_FILTER_IGNORED', `Zoho ignored the journal reference filter for ${ref}; lookup is not exact.`)
      return journals.filter((j: any) => j.referenceNumber === ref)
    },

    async listJournalsInRange(dateStart: string, dateEnd: string, { critical = false } = {}) {
      const rows = await listAll('/journals', { date_start: dateStart, date_end: dateEnd, sort_column: 'journal_date', sort_order: 'A' }, 'journals', { maxPages: 10, critical })
      const out = rows.map((j: any) => ({ journalId: clean(j.journal_id), referenceNumber: clean(j.reference_number), journalDate: clean(j.journal_date), total: num(j.total) }))
      if (out.some((j: any) => j.journalDate < dateStart || j.journalDate > dateEnd)) throw lookupError('ZOHO_DATE_FILTER_IGNORED', `Zoho ignored the journal date filter ${dateStart}..${dateEnd}.`)
      return out
    },

    async getJournal(journalId: string, { critical = false } = {}) {
      const id = clean(journalId)
      if (!id) return null
      return orNullOn404(async () => {
        const json = await call(`/journals/${encodeURIComponent(id)}`, {}, { critical })
        const j = json && json.journal
        if (!j) return null
        return {
          journalId: clean(j.journal_id),
          referenceNumber: clean(j.reference_number),
          journalDate: clean(j.journal_date),
          status: clean(j.status),
          lineItems: (Array.isArray(j.line_items) ? j.line_items : []).map((l: any) => ({ accountId: clean(l.account_id), accountName: clean(l.account_name), debitOrCredit: clean(l.debit_or_credit), amount: num(l.amount) })),
        }
      })
    },

    /**
     * Every transaction on one bank/cash account dated start..end; incomplete lists fail. Zoho
     * honours the date sort on /banktransactions, so pages are read newest-first until past start.
     */
    async listBankTransactions(accountId: string, dateStart: string, dateEnd: string, { critical = false } = {}) {
      const out: any[] = []
      let previousDate: string | null = null
      for (let page = 1; page <= BANK_MAX_PAGES; page++) {
        const json = await call('/banktransactions', { account_id: accountId, date_start: dateStart, date_end: dateEnd, filter_by: 'Status.All', per_page: String(LIST_PAGE_SIZE), page: String(page), sort_column: 'date', sort_order: 'D' }, { critical })
        if (!json || !Array.isArray(json.banktransactions)) throw lookupError('ZOHO_LOOKUP_MALFORMED', 'Zoho bank transactions answered without a "banktransactions" list.')
        for (const t of json.banktransactions.map(mapBankTransaction)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho bank transaction ${t.transactionId || '?'} has no usable date.`)
          if (previousDate && t.date > previousDate) throw lookupError('ZOHO_SORT_IGNORED', 'Zoho did not return bank transactions newest-first.')
          previousDate = t.date
          if (t.date >= dateStart && t.date <= dateEnd) out.push(t)
        }
        if ((previousDate !== null && previousDate < dateStart) || !(json.page_context && json.page_context.has_more_page)) return out
      }
      throw lookupError('ZOHO_LOOKUP_INCOMPLETE', `Read ${BANK_MAX_PAGES * LIST_PAGE_SIZE} bank transactions without reaching ${dateStart}.`)
    },

    async getBankTransaction(transactionId: string, { critical = false } = {}) {
      const id = clean(transactionId)
      if (!id) return null
      return orNullOn404(async () => {
        const json = await call(`/banktransactions/${encodeURIComponent(id)}`, {}, { critical })
        const t = json && (json.banktransaction || json.bank_transaction)
        if (!t) return null
        return { ...mapBankTransaction(t), fromAccountId: clean(t.from_account_id), toAccountId: clean(t.to_account_id), fromAccountName: clean(t.from_account_name), toAccountName: clean(t.to_account_name) }
      })
    },

    async listChartAccounts() {
      const json = await call('/chartofaccounts', { filter_by: 'AccountType.All' })
      const rows = json && Array.isArray(json.chartofaccounts) ? json.chartofaccounts : null
      if (!rows) throw lookupError('ZOHO_LOOKUP_MALFORMED', 'Zoho chart of accounts answered without a "chartofaccounts" list.')
      return rows.map((a: any) => ({ accountId: clean(a.account_id), accountName: clean(a.account_name), accountCode: clean(a.account_code), accountType: clean(a.account_type).toLowerCase(), isActive: a.is_active !== false })).filter((a: any) => a.accountId)
    },

    /** Website orders by invoice number; null when the website database is not available. */
    async loadOrdersByInvoiceNumbers(numbers: string[]) {
      if (!loadWebsiteOrders) return null
      return loadWebsiteOrders.byInvoiceNumbers(numbers)
    },

    /** Website orders paid by POS created in the window; null when the website database is not available. */
    async loadPosOrdersBetween(from: string, to: string) {
      if (!loadWebsiteOrders) return null
      return loadWebsiteOrders.posOrdersBetween(from, to)
    },
  }
}

// ── Production wiring ───────────────────────────────────────────────────────

function mapOrder(row: any) {
  return {
    orderId: clean(row.id),
    orderNumber: clean(row.invoice_number),
    paymentMethod: clean(row.payment_method),
    shopOrder: row.shop_order === true,
    userAgent: clean(row.user_agent) || null,
    totalMinor: fils(row.total_amount),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    deleted: row.deleted === true,
  }
}

const ORDER_COLUMNS = `o.id::text AS id, o.invoice_number, o.payment_method::text AS payment_method, o.shop_order, o.user_agent::text AS user_agent,
  ROUND(o.total_amount::numeric, 2)::text AS total_amount, o.created_at, (o.deleted_at IS NOT NULL) AS deleted`

function websiteOrderLoader() {
  const websiteDb = require('../../db/lifesmileWebsiteDb')
  if (!websiteDb.isConfigured()) return null
  return {
    async byInvoiceNumbers(numbers: string[]) {
      const list = [...new Set(numbers.map(clean).filter(Boolean))]
      if (!list.length) return []
      const { rows } = await websiteDb.readQuery(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.invoice_number = ANY($1::text[])`, [list])
      return rows.map(mapOrder)
    },
    async posOrdersBetween(from: string, to: string) {
      const { rows } = await websiteDb.readQuery(
        `SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.payment_method::text = 'pos' AND o.created_at >= $1::date - INTERVAL '1 day' AND o.created_at < $2::date + INTERVAL '2 day'`,
        [from, to],
      )
      return rows.map(mapOrder)
    },
  }
}

/** Sources backed by zohoApiClient (quota, logging, token refresh) and the website database. */
function createDefaultPosSources() {
  const { zohoBooksJsonRequest } = require('../zohoApiClient')
  const get: Get = (path, params, opts = {}) =>
    zohoBooksJsonRequest(`/books/v3${path}`, new URLSearchParams(params), 'GET', undefined, { source: opts.source || SOURCE, skipCache: true, critical: opts.critical === true })
  return createPosSources({ get, loadWebsiteOrders: websiteOrderLoader() })
}

module.exports = { createPosSources, createDefaultPosSources, websiteOrderLoader, mapInvoice, mapBankTransaction, rrnFieldText, fils }
