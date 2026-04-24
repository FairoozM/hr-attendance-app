/**
 * Taxation API controllers.
 *
 * GET /api/taxation/vat/customers  – Zoho Books customer list (cached 5 min)
 * GET /api/taxation/vat/report     – Invoice + credit-note totals for a date range
 *
 * Performance
 * ───────────
 * • Invoice totals use the Zoho Books `salesbycustomer` report endpoint which
 *   returns pre-aggregated per-customer rows (1-2 API calls) instead of paginating
 *   through 10 000+ individual invoice records.
 * • Credit notes fall back to the `creditnotes` report, then raw list (small volume).
 * • Report results are cached for 2 minutes (TTL) with in-flight deduplication so
 *   rapid filter changes or React StrictMode double-invocations don't cause extra calls.
 */

const {
  fetchCustomers,
  fetchSalesByCustomer,
  fetchInvoices,
  fetchCreditNotesByCustomer,
} = require('../integrations/zoho/zohoBooksClient')
const { validateDateRange, handleZohoError } = require('./weeklyReportsController')

const KSA_VAT_RATE = 0.15

// ── Customer cache (5 min TTL) ───────────────────────────────────────────────
let _customerCache = null
const CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000

async function getCachedCustomers() {
  if (_customerCache && Date.now() < _customerCache.expiresAt) return _customerCache.contacts
  const contacts = await fetchCustomers()
  _customerCache = { contacts, expiresAt: Date.now() + CUSTOMER_CACHE_TTL_MS }
  console.log(`[taxation] cached ${contacts.length} customer(s)`)
  return contacts
}

// ── VAT report cache (2 min TTL + in-flight dedup) ───────────────────────────
const VAT_CACHE_TTL_MS = 2 * 60 * 1000
const _vatCache   = new Map()   // key → { result, expiresAt }
const _vatInFlight = new Map()  // key → Promise

function makeVatKey(fromDate, toDate, customerId) {
  return `${fromDate}|${toDate}|${customerId || 'all'}`
}

async function getCachedVatReport(fromDate, toDate, customerId, buildFn) {
  const key = makeVatKey(fromDate, toDate, customerId)

  const cached = _vatCache.get(key)
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[taxation] cache HIT ${key}`)
    return cached.result
  }

  if (_vatInFlight.has(key)) {
    console.log(`[taxation] dedup HIT ${key}`)
    return _vatInFlight.get(key)
  }

  const promise = buildFn().then((result) => {
    _vatCache.set(key, { result, expiresAt: Date.now() + VAT_CACHE_TTL_MS })
    _vatInFlight.delete(key)
    return result
  }).catch((err) => {
    _vatInFlight.delete(key)
    throw err
  })

  _vatInFlight.set(key, promise)
  return promise
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(v) {
  if (v == null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * Normalise a row from the salesbycustomer report OR a raw invoice record
 * into our standard { customer_id, customer_name, count, taxable_amount, tax_amount, total }.
 */
function normaliseSalesRow(row) {
  const status = row.status ? String(row.status).toLowerCase() : ''
  if (status === 'void' || status === 'voided') return null

  // Report endpoint fields differ from list endpoint fields
  const customerId   = row.customer_id   || row.contact_id || ''
  const customerName = row.customer_name || row.contact_name || 'Unknown'

  // salesbycustomer report uses invoice_count; list uses nothing (1 per row)
  const count     = parseNum(row.invoice_count ?? row.creditnote_count ?? 1)
  const subTotal  = parseNum(row.sub_total ?? row.taxable_amount ?? row.amount_before_tax)
  const taxAmount = parseNum(row.tax_amount ?? row.tax_total ?? row.tax)
  const total     = parseNum(row.total     ?? row.invoice_total ?? row.amount)

  return { customer_id: customerId, customer_name: customerName, count, taxable_amount: subTotal, tax_amount: taxAmount, total }
}

/**
 * Aggregate a list of normalised rows into one row per customer.
 */
function aggregateRows(rows) {
  const map = new Map()
  for (const raw of rows) {
    const row = normaliseSalesRow(raw)
    if (!row) continue
    if (!map.has(row.customer_id)) {
      map.set(row.customer_id, { ...row })
    } else {
      const e = map.get(row.customer_id)
      e.count          += row.count
      e.taxable_amount += row.taxable_amount
      e.tax_amount     += row.tax_amount
      e.total          += row.total
    }
  }
  return Array.from(map.values()).sort((a, b) => a.customer_name.localeCompare(b.customer_name))
}

function grandTotals(rows) {
  let taxable = 0, tax = 0, total = 0
  for (const r of rows) { taxable += r.taxable_amount; tax += r.tax_amount; total += r.total }
  return { taxable, tax, effective_tax: tax > 0 ? tax : taxable * KSA_VAT_RATE, total }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function getVatCustomers(_req, res) {
  try {
    const contacts = await getCachedCustomers()
    return res.json({ contacts })
  } catch (err) {
    const zohoCode = err?.zohoCode ?? err?.body?.code ?? err?.code
    if (zohoCode === 57 || String(zohoCode) === '57' || err?.status === 401) {
      return res.status(503).json({
        code: 'ZOHO_NOT_CONFIGURED',
        message:
          'Zoho Books API access is not authorized. ' +
          'The current refresh token does not include ZohoBooks scopes. ' +
          'Please re-issue the Zoho OAuth token with ZohoBooks.contacts.READ scope.',
      })
    }
    return handleZohoError(res, err, 'getVatCustomers')
  }
}

/**
 * GET /api/taxation/vat/report?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD[&customer_id=]
 *
 * Uses the salesbycustomer report endpoint for invoices (fast) and
 * the creditnotes report endpoint for credit notes (fast fallback to list).
 * Results are cached for 2 minutes.
 */
async function getVatReport(req, res) {
  const range = validateDateRange(req, res)
  if (!range) return

  const customerId = req.query.customer_id && String(req.query.customer_id).trim() !== ''
    ? String(req.query.customer_id).trim()
    : null

  try {
    const result = await getCachedVatReport(range.from_date, range.to_date, customerId, async () => {
      const t0 = Date.now()

      // Fetch invoice totals via the fast report endpoint.
      // If salesbycustomer report returns 0 rows (can happen for very new orgs),
      // fall back to raw invoice list (capped at 15 pages).
      const [salesResult, cnResult] = await Promise.all([
        fetchSalesByCustomer(range.from_date, range.to_date, customerId),
        fetchCreditNotesByCustomer(range.from_date, range.to_date, customerId),
      ])

      let invoiceSource = salesResult
      if (salesResult.rows.length === 0 && !salesResult.truncated) {
        // Report endpoint returned nothing — fall back to list (single customer only)
        console.log('[taxation] salesbycustomer report empty, falling back to invoice list')
        invoiceSource = await fetchInvoices(range.from_date, range.to_date, customerId)
      }

      console.log(
        `[taxation] vat-report from=${range.from_date} to=${range.to_date}` +
        ` customer=${customerId || 'all'}` +
        ` invoices=${invoiceSource.rows.length} cn=${cnResult.rows.length}` +
        ` ${Date.now() - t0}ms`
      )

      const invoiceRows    = aggregateRows(invoiceSource.rows)
      const creditNoteRows = aggregateRows(cnResult.rows)
      const invTotals      = grandTotals(invoiceRows)
      const cnTotals       = grandTotals(creditNoteRows)

      return {
        from_date:    range.from_date,
        to_date:      range.to_date,
        customer_id:  customerId,
        invoices:     invoiceRows,
        credit_notes: creditNoteRows,
        totals: {
          invoice_taxable:  invTotals.taxable,
          invoice_tax:      invTotals.effective_tax,
          invoice_total:    invTotals.total,
          cn_taxable:       cnTotals.taxable,
          cn_tax:           cnTotals.effective_tax,
          cn_total:         cnTotals.total,
        },
        meta: {
          invoice_truncated:     invoiceSource.truncated,
          credit_note_truncated: cnResult.truncated,
          vat_rate:              KSA_VAT_RATE,
        },
      }
    })

    return res.json(result)
  } catch (err) {
    const zohoCode = err?.zohoCode ?? err?.body?.code ?? err?.code
    if (zohoCode === 57 || String(zohoCode) === '57' || err?.status === 401) {
      return res.status(503).json({
        code: 'ZOHO_NOT_CONFIGURED',
        message:
          'Zoho Books API access is not authorized. ' +
          'The current refresh token does not include ZohoBooks scopes. ' +
          'Please re-issue the Zoho OAuth token with: ' +
          'ZohoBooks.invoices.READ, ZohoBooks.creditnotes.READ, ZohoBooks.contacts.READ',
      })
    }
    return handleZohoError(res, err, 'getVatReport')
  }
}

module.exports = { getVatCustomers, getVatReport }
