/**
 * Taxation API controllers.
 *
 * GET /api/taxation/vat/customers  – Zoho Books customer list (cached 5 min)
 * GET /api/taxation/vat/report     – Invoice + credit-note totals for a date range
 *
 * Data source: raw Zoho Books invoice list (sub_total + tax_total per invoice).
 * Performance: parallel page fetching in zohoBooksClient.js (~5× faster than sequential).
 * Caching: 2-min TTL + in-flight deduplication so rapid filter changes don't re-fetch.
 */

const {
  fetchCustomers,
  fetchInvoices,
  fetchCreditNotesByCustomer,
} = require('../integrations/zoho/zohoBooksClient')
const { validateDateRange, handleZohoError } = require('./weeklyReportsController')

const KSA_VAT_RATE = 0.15

// ── Customer cache (5 min TTL) ───────────────────────────────────────────────
let _customerCache = null
const CUSTOMER_CACHE_TTL_MS = 30 * 60 * 1000  // 30 min — customer list rarely changes

async function getCachedCustomers() {
  if (_customerCache && Date.now() < _customerCache.expiresAt) return _customerCache.contacts
  const contacts = await fetchCustomers()
  _customerCache = { contacts, expiresAt: Date.now() + CUSTOMER_CACHE_TTL_MS }
  console.log(`[taxation] cached ${contacts.length} customer(s)`)
  return contacts
}

// ── VAT report cache (2 min TTL + in-flight dedup) ───────────────────────────
const VAT_CACHE_TTL_MS = 10 * 60 * 1000  // 10 min — VAT data rarely changes mid-session
const _vatCache    = new Map()
const _vatInFlight = new Map()

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

  const promise = buildFn()
    .then((result) => {
      _vatCache.set(key, { result, expiresAt: Date.now() + VAT_CACHE_TTL_MS })
      _vatInFlight.delete(key)
      return result
    })
    .catch((err) => { _vatInFlight.delete(key); throw err })

  _vatInFlight.set(key, promise)
  return promise
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return true if the record's date falls within [fromDate, toDate] (inclusive).
 * Zoho Books uses different date field names on different endpoints:
 *   invoices:     row.date
 *   credit notes: row.date or row.creditnote_date
 * If no date field is found we keep the record (can't filter what we can't read).
 */
function isWithinRange(row, fromDate, toDate) {
  const d = row.date || row.creditnote_date || row.invoice_date
  if (!d) return true
  const rowDate = String(d).slice(0, 10)   // "YYYY-MM-DD"
  return rowDate >= fromDate && rowDate <= toDate
}

function parseNum(v) {
  if (v == null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * Normalise a raw Zoho Books invoice or credit note row.
 *
 * VAT is ALWAYS calculated at the KSA rate (15%) of the taxable amount.
 * Zoho Books does not store VAT amounts for this organisation (tax_total=0),
 * so total = sub_total on every Zoho record.
 *
 * The invoice LIST endpoint often omits sub_total, so we fall back to total
 * (safe because total == sub_total when no tax is recorded).
 *
 *   taxable_amount = sub_total  (or row.total when sub_total absent)
 *   tax_amount     = taxable × 15%
 *   gross_total    = taxable × 1.15
 */
function normaliseRow(row) {
  const status = row.status ? String(row.status).toLowerCase() : ''
  if (status === 'void' || status === 'voided') return null

  const customerId   = row.customer_id   || row.contact_id  || ''
  const customerName = row.customer_name || row.contact_name || 'Unknown'

  // Prefer sub_total; fall back to total (they're equal when no VAT is recorded)
  const zohoTotal = parseNum(row.total ?? row.invoice_total ?? row.creditnote_total ?? 0)
  const subTotal  = parseNum(row.sub_total ?? row.amount_before_tax ?? zohoTotal)
  const taxAmount = subTotal * KSA_VAT_RATE
  const total     = subTotal + taxAmount

  return {
    customer_id:    customerId,
    customer_name:  customerName,
    count:          1,
    taxable_amount: subTotal,
    tax_amount:     taxAmount,
    total,
  }
}

/**
 * Aggregate a flat list of per-document rows into one row per customer.
 */
function aggregateByCustomer(rows) {
  const map = new Map()
  for (const raw of rows) {
    const row = normaliseRow(raw)
    if (!row) continue
    if (!map.has(row.customer_id)) {
      map.set(row.customer_id, { ...row })
    } else {
      const e = map.get(row.customer_id)
      e.count          += 1
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
  return { taxable, tax, total }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function getVatCustomers(req, res) {
  try {
    if (req.query.bust === '1') _customerCache = null   // force fresh fetch
    const contacts = await getCachedCustomers()
    return res.json({ contacts })
  } catch (err) {
    const zohoCode = err?.zohoCode ?? err?.body?.code ?? err?.code
    if (zohoCode === 57 || String(zohoCode) === '57' || err?.status === 401) {
      return res.status(503).json({
        code: 'ZOHO_NOT_CONFIGURED',
        message: 'Zoho Books API access is not authorized. Re-issue the Zoho OAuth token with ZohoBooks.contacts.READ scope.',
      })
    }
    return handleZohoError(res, err, 'getVatCustomers')
  }
}

/**
 * GET /api/taxation/vat/report?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD[&customer_id=]
 *
 * Fetches raw invoices (with sub_total + tax_total) and credit notes in parallel.
 * Invoice pages are fetched in parallel batches — see zohoBooksClient.fetchInvoices().
 * Results cached 2 minutes.
 */
async function getVatReport(req, res) {
  const range = validateDateRange(req, res)
  if (!range) return

  const customerId = req.query.customer_id && String(req.query.customer_id).trim() !== ''
    ? String(req.query.customer_id).trim()
    : null

  // Allow cache-busting from the Refresh button
  if (req.query.bust === '1') {
    const key = makeVatKey(range.from_date, range.to_date, customerId)
    _vatCache.delete(key)
  }

  try {
    const result = await getCachedVatReport(range.from_date, range.to_date, customerId, async () => {
      const t0 = Date.now()

      const [invResult, cnResult] = await Promise.all([
        fetchInvoices(range.from_date, range.to_date, customerId),
        fetchCreditNotesByCustomer(range.from_date, range.to_date, customerId),
      ])

      // Post-fetch date safety filter — ensures records outside the requested
      // range are never included even if the Zoho API filter has edge cases.
      const filteredInvoices = invResult.rows.filter((r) => isWithinRange(r, range.from_date, range.to_date))
      const filteredCNs      = cnResult.rows.filter((r) => isWithinRange(r, range.from_date, range.to_date))

      const excluded = (invResult.rows.length - filteredInvoices.length) + (cnResult.rows.length - filteredCNs.length)
      if (excluded > 0) {
        console.warn(`[taxation] post-filter excluded ${excluded} record(s) outside date range`)
      }

      console.log(
        `[taxation] vat-report from=${range.from_date} to=${range.to_date}` +
        ` customer=${customerId || 'all'}` +
        ` invoices=${filteredInvoices.length} cn=${filteredCNs.length}` +
        ` ${Date.now() - t0}ms`
      )

      const invoiceRows    = aggregateByCustomer(filteredInvoices)
      const creditNoteRows = aggregateByCustomer(filteredCNs)
      const invTotals      = grandTotals(invoiceRows)
      const cnTotals       = grandTotals(creditNoteRows)

      return {
        from_date:    range.from_date,
        to_date:      range.to_date,
        customer_id:  customerId,
        invoices:     invoiceRows,
        credit_notes: creditNoteRows,
        totals: {
          invoice_taxable: invTotals.taxable,
          invoice_tax:     invTotals.tax,
          invoice_total:   invTotals.total,
          cn_taxable:      cnTotals.taxable,
          cn_tax:          cnTotals.tax,
          cn_total:        cnTotals.total,
        },
        meta: {
          invoice_truncated:     invResult.truncated,
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
          'Zoho Books API access is not authorized. Re-issue the Zoho OAuth token with: ' +
          'ZohoBooks.invoices.READ, ZohoBooks.creditnotes.READ, ZohoBooks.contacts.READ',
      })
    }
    return handleZohoError(res, err, 'getVatReport')
  }
}

module.exports = { getVatCustomers, getVatReport }
