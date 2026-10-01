#!/usr/bin/env node
/**
 * Read-only Zoho Books discovery for Mashreq POS settlement: where RRN lives on invoices and
 * customer payments, which existing accounts can play the POS roles, and the UAE VAT taxes.
 *
 * Every Zoho request is a GET (enforced below); the only other call is the OAuth token refresh.
 * Nothing is written to Zoho or to any database. Capped at MAX_CALLS requests.
 *
 * Usage: node backend/scripts/pos-zoho-rrn-discovery.ts [--rrn 003046469826] [--invoice-ref 21136]
 */
declare const require: (id: string) => any
declare const process: { argv: string[]; exitCode: number | undefined; env: Record<string, string | undefined> }

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { getZohoAccessToken } = require('../src/integrations/zoho/zohoOAuth')
const { readZohoConfig } = require('../src/integrations/zoho/zohoConfig')
const { httpsRequestJson } = require('../src/integrations/zoho/zohoHttp')
const { DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID, DEFAULT_SHOP_ZOHO_CUSTOMER_ID } = require('../src/config/stripeClearing')

type Json = Record<string, any>

const MAX_CALLS = 40
let calls = 0

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : null
}

async function get(path: string, params: Record<string, string> = {}): Promise<Json> {
  if (++calls > MAX_CALLS) throw new Error(`Call cap ${MAX_CALLS} reached; stopping.`)
  const c = readZohoConfig()
  const u = new URL(`${c.apiBase}/books/v3${path}`)
  u.searchParams.set('organization_id', c.organizationId)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const token = await getZohoAccessToken()
  const method = 'GET'
  const res = await httpsRequestJson(u.toString(), { method, headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeoutMs: 45000 })
  const body = JSON.parse(res.body || '{}')
  if (res.status >= 400) throw new Error(`GET ${path} → ${res.status}: ${body.message || res.body.slice(0, 200)}`)
  return body
}

const RRN_LIKE = /(?<!\d)\d{12}(?!\d)/g

/** Every string field (path → value) that contains a 12-digit run. */
function rrnLikeFields(obj: unknown, path = ''): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = []
  if (obj == null) return out
  if (typeof obj === 'string' || typeof obj === 'number') {
    const s = String(obj)
    if (RRN_LIKE.test(s)) out.push({ path, value: s.slice(0, 200) })
    RRN_LIKE.lastIndex = 0
    return out
  }
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push(...rrnLikeFields(v, `${path}[${i}]`)))
  else if (typeof obj === 'object') for (const [k, v] of Object.entries(obj as Json)) out.push(...rrnLikeFields(v, path ? `${path}.${k}` : k))
  return out
}

function customFieldsOf(rec: Json): Array<Json> {
  return (rec.custom_fields || []).map((f: Json) => ({
    customfield_id: f.customfield_id,
    api_name: f.api_name,
    label: f.label,
    data_type: f.data_type,
    value: f.value,
    value_type: typeof f.value,
  }))
}

async function main(): Promise<void> {
  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') throw new Error(`Zoho not configured: ${cfg.missing.join(', ')}`)
  const report: Json = { organizationId: cfg.organizationId, customers: { website: DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID, shop: DEFAULT_SHOP_ZOHO_CUSTOMER_ID } }

  // 1. Invoice custom field definitions
  try {
    const cf = await get('/settings/fields', { entity: 'invoice' })
    report.invoiceFieldDefinitions = (cf.fields || []).filter((f: Json) => f.is_custom_field || String(f.field_name || '').startsWith('cf_')).map((f: Json) => ({ field_id: f.field_id, field_name: f.field_name, label: f.label_name || f.label, data_type: f.data_type, is_active: f.is_active }))
  } catch (err: any) {
    report.invoiceFieldDefinitions = { error: err.message }
  }

  // 2. Recent invoices of both POS customers (list keys + detail of a sample)
  report.invoices = {}
  for (const [label, customerId] of [['shop', DEFAULT_SHOP_ZOHO_CUSTOMER_ID], ['website', DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID]]) {
    const list = await get('/invoices', { customer_id: customerId, per_page: '50', sort_column: 'date', sort_order: 'D' })
    const items: Json[] = list.invoices || []
    const withRrn = items.filter((i) => rrnLikeFields(i).length > 0)
    const sampleIds = [...withRrn.slice(0, 3), ...items.filter((i) => !withRrn.includes(i)).slice(0, 1)].map((i) => i.invoice_id)
    const details: Json[] = []
    for (const id of sampleIds) {
      const d = (await get(`/invoices/${id}`)).invoice || {}
      details.push({
        invoice_id: d.invoice_id,
        invoice_number: d.invoice_number,
        date: d.date,
        status: d.status,
        total: d.total,
        balance: d.balance,
        reference_number: d.reference_number,
        salesperson_name: d.salesperson_name,
        custom_fields: customFieldsOf(d),
        rrnLikeFields: rrnLikeFields(d),
        payments: (d.payments || []).map((p: Json) => ({ payment_id: p.payment_id, amount: p.amount, reference_number: p.reference_number, payment_mode: p.payment_mode, account_name: p.account_name, description: p.description })),
      })
    }
    report.invoices[label] = {
      listCount: items.length,
      listKeys: items[0] ? Object.keys(items[0]).sort() : [],
      listCustomKeys: items[0] ? Object.keys(items[0]).filter((k) => k.startsWith('cf_') || k === 'custom_fields' || k === 'custom_field_hash') : [],
      listWithRrnLike: withRrn.length,
      listRrnLikeSample: withRrn.slice(0, 5).map((i) => ({ invoice_number: i.invoice_number, date: i.date, total: i.total, balance: i.balance, status: i.status, reference_number: i.reference_number, fields: rrnLikeFields(i) })),
      details,
    }
  }

  // 3. Recent customer payments of both customers
  report.payments = {}
  for (const [label, customerId] of [['shop', DEFAULT_SHOP_ZOHO_CUSTOMER_ID], ['website', DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID]]) {
    const list = await get('/customerpayments', { customer_id: customerId, per_page: '100', sort_column: 'date', sort_order: 'D' })
    const items: Json[] = list.customerpayments || []
    const modes: Json = {}
    const accounts: Json = {}
    for (const p of items) {
      modes[p.payment_mode || '(blank)'] = (modes[p.payment_mode || '(blank)'] || 0) + 1
      accounts[p.account_name || '(blank)'] = (accounts[p.account_name || '(blank)'] || 0) + 1
    }
    const withRrn = items.filter((p) => rrnLikeFields(p).length > 0)
    let detail: Json | null = null
    if (withRrn[0]) {
      const d = (await get(`/customerpayments/${withRrn[0].payment_id}`)).payment || {}
      detail = { payment_id: d.payment_id, reference_number: d.reference_number, description: d.description, payment_mode: d.payment_mode, account_name: d.account_name, account_id: d.account_id, amount: d.amount, custom_fields: customFieldsOf(d), rrnLikeFields: rrnLikeFields(d), invoices: (d.invoices || []).map((i: Json) => ({ invoice_number: i.invoice_number, amount_applied: i.amount_applied })) }
    }
    report.payments[label] = {
      listCount: items.length,
      listKeys: items[0] ? Object.keys(items[0]).sort() : [],
      paymentModes: modes,
      depositAccounts: accounts,
      withRrnLike: withRrn.length,
      rrnLikeSample: withRrn.slice(0, 5).map((p) => ({ date: p.date, amount: p.amount, payment_mode: p.payment_mode, account_name: p.account_name, reference_number: p.reference_number, invoice_numbers: p.invoice_numbers, fields: rrnLikeFields(p) })),
      detail,
    }
  }

  // 4. Optional: look one RRN / website invoice reference up directly
  const rrn = arg('--rrn')
  if (rrn) {
    const inv = await get('/invoices', { search_text: rrn, per_page: '25' })
    const pay = await get('/customerpayments', { search_text: rrn, per_page: '25' })
    report.rrnLookup = {
      rrn,
      invoices: (inv.invoices || []).map((i: Json) => ({ invoice_number: i.invoice_number, customer_name: i.customer_name, total: i.total, balance: i.balance, reference_number: i.reference_number, fields: rrnLikeFields(i) })),
      payments: (pay.customerpayments || []).map((p: Json) => ({ payment_number: p.payment_number, amount: p.amount, reference_number: p.reference_number, account_name: p.account_name, fields: rrnLikeFields(p) })),
    }
  }
  const ref = arg('--invoice-ref')
  if (ref) {
    const inv = await get('/invoices', { reference_number: ref, per_page: '25' })
    report.invoiceRefLookup = { ref, invoices: (inv.invoices || []).map((i: Json) => ({ invoice_id: i.invoice_id, invoice_number: i.invoice_number, customer_name: i.customer_name, total: i.total, balance: i.balance, status: i.status, fields: rrnLikeFields(i) })) }
  }

  // 5. Chart of accounts candidates for the POS roles
  const coa = await get('/chartofaccounts', { per_page: '200', filter_by: 'AccountType.Active' })
  const rx = /pos|mashreq|rak|input vat|undeposited|processing|un-?cleared|card|machine|commission/i
  report.accountCandidates = (coa.chartofaccounts || []).filter((a: Json) => rx.test(a.account_name || '')).map((a: Json) => ({ account_id: a.account_id, account_name: a.account_name, account_code: a.account_code, account_type: a.account_type, is_active: a.is_active }))
  report.chartPageHasMore = Boolean(coa.page_context && coa.page_context.has_more_page)

  // 6. Taxes
  const taxes = await get('/settings/taxes')
  report.taxes = (taxes.taxes || []).map((t: Json) => ({ tax_id: t.tax_id, tax_name: t.tax_name, tax_percentage: t.tax_percentage, tax_type: t.tax_type, tax_specific_type: t.tax_specific_type }))

  // 7. How POS receipts are booked and cleared today
  if (process.argv.includes('--pos-history')) {
    const accountByName = (name: string) => (coa.chartofaccounts || []).find((a: Json) => a.account_name === name)
    const fee = await get('/chartofaccounts/4265011000012257037').catch((err: any) => ({ error: err.message }))
    report.posFeeAccount = fee.chart_of_account ? { account_id: fee.chart_of_account.account_id, account_name: fee.chart_of_account.account_name, account_code: fee.chart_of_account.account_code, account_type: fee.chart_of_account.account_type, is_active: fee.chart_of_account.is_active } : fee
    const posPayments: Json[] = []
    for (const customerId of [DEFAULT_SHOP_ZOHO_CUSTOMER_ID, DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID]) {
      const list = await get('/customerpayments', { customer_id: customerId, per_page: '100', sort_column: 'date', sort_order: 'D' })
      posPayments.push(...(list.customerpayments || []).filter((p: Json) => /^POS-Machine/.test(p.account_name || '')))
    }
    report.posPayments = posPayments.slice(0, 30).map((p) => ({ date: p.date, customer: p.customer_name, amount: p.amount, payment_mode: p.payment_mode, account: p.account_name, reference_number: p.reference_number, description: p.description, invoice_numbers: p.invoice_numbers, custom_fields_list: p.custom_fields_list }))
    if (posPayments[0]) {
      const d = (await get(`/customerpayments/${posPayments[0].payment_id}`)).payment || {}
      report.posPaymentDetail = { reference_number: d.reference_number, description: d.description, payment_mode: d.payment_mode, account_name: d.account_name, custom_fields: customFieldsOf(d), invoices: (d.invoices || []).map((i: Json) => ({ invoice_number: i.invoice_number, amount_applied: i.amount_applied, total: i.total })) }
    }
    for (const name of ['POS-Machine Undeposited Funds', 'POS-Machine Uncleared Commission Exp']) {
      const acc = accountByName(name)
      if (!acc) continue
      const txns = await get('/banktransactions', { account_id: acc.account_id, per_page: '60', sort_column: 'date', sort_order: 'D', filter_by: 'Status.All' })
      report[`activity:${name}`] = (txns.banktransactions || []).map((t: Json) => ({ date: t.date, type: t.transaction_type, dc: t.debit_or_credit, amount: t.amount, reference_number: t.reference_number, offset: t.offset_account_name, payee: t.payee, description: String(t.description || '').slice(0, 80) }))
    }
  }

  // 8. RRN on specific invoices (website invoice numbers) and payment custom field definitions
  const refs = arg('--refs')
  if (refs) {
    for (const entity of ['customer_payment', 'customerpayment']) {
      try {
        const cf = await get('/settings/fields', { entity })
        report[`fieldDefinitions:${entity}`] = (cf.fields || []).filter((f: Json) => f.is_custom_field || String(f.field_name || '').startsWith('cf_')).map((f: Json) => ({ field_id: f.field_id, field_name: f.field_name, label: f.label_name || f.label, data_type: f.data_type }))
        break
      } catch (err: any) {
        report[`fieldDefinitions:${entity}`] = { error: err.message }
      }
    }
    report.invoicesByRef = []
    for (const ref of refs.split(',')) {
      const list = (await get('/invoices', { reference_number: ref.trim(), per_page: '10' })).invoices || []
      for (const i of list.slice(0, 1)) {
        const d = (await get(`/invoices/${i.invoice_id}`)).invoice || {}
        const { line_items: _li, ...rest } = d
        report.invoicesByRef.push({ ref, invoice_number: d.invoice_number, date: d.date, total: d.total, balance: d.balance, status: d.status, notes: d.notes, terms: d.terms, custom_fields: customFieldsOf(d), tags: d.tags, rrnLikeOutsideLines: rrnLikeFields(rest), payments: (d.payments || []).map((p: Json) => ({ reference_number: p.reference_number, description: p.description, amount: p.amount, account_name: p.account_name })) })
      }
    }
  }

  report.zohoGetCalls = calls
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err: any) => {
  console.error(`Discovery failed after ${calls} GET call(s): ${err && err.message ? err.message : err}`)
  process.exitCode = 1
})
