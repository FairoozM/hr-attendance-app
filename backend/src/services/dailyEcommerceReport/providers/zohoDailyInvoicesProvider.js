'use strict'

/**
 * Fetch Zoho Books invoices for one calendar day with line items.
 * Customer names map to ecommerce channels (exact Zoho contact names).
 */

const { zohoBooksJsonRequest } = require('../../zohoApiClient')

const BOOKS_V3 = '/books/v3'
const DETAIL_CONCURRENCY = 3

/** Channel key → Zoho Books customer_name values (exact trim match). */
const CHANNEL_CUSTOMERS = {
  amazon_uae: ['Amazon'],
  amazon_ksa: ['KSA-Amazon'],
  noon_uae: ['Noon'],
  noon_ksa: ['KSA-Noon'],
  carrefour_uae: ['Carrefour'],
  /** Life Smile uses website DB; these Zoho names are for reconciliation only */
  life_smile_website: ['Website'],
  life_smile_shop: ['Burjman Shop - Web & App'],
}

const NON_PRODUCT_NAME_RE =
  /coupon|discount|smile\s*point|wallet|courier|shipping|delivery|rounding|adjustment/i

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next
      next += 1
      // eslint-disable-next-line no-await-in-loop
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.min(limit, Math.max(1, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

/**
 * List invoices for date (inclusive). Uses date_start/date_end.
 * @param {string} dateYmd
 * @returns {Promise<object[]>}
 */
async function listInvoicesForDate(dateYmd) {
  const all = []
  let page = 1
  while (page <= 10) {
    const sp = new URLSearchParams({
      // Exact calendar day filter (same as VAT / manual probes). date_start/date_end
      // without matching filter semantics can over-fetch and blow the Zoho quota.
      date: dateYmd,
      filter_by: 'Status.All',
      page: String(page),
      per_page: '200',
    })
    // eslint-disable-next-line no-await-in-loop
    const json = await zohoBooksJsonRequest(`${BOOKS_V3}/invoices`, sp, 'GET', undefined, {
      skipCache: true,
      source: 'daily_ecommerce_invoices',
    })
    const batch = Array.isArray(json?.invoices) ? json.invoices : []
    all.push(...batch)
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return all
}

async function fetchInvoiceDetail(invoiceId) {
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/invoices/${encodeURIComponent(invoiceId)}`,
    new URLSearchParams(),
    'GET',
    undefined,
    { skipCache: true, source: 'daily_ecommerce_invoice_detail' },
  )
  return json?.invoice || null
}

/**
 * Resolve display item code from a Zoho line item.
 * Books often stores barcode in `sku` and seller item code in `name`.
 */
function lineItemCode(line) {
  const name = String(line?.name || '').trim()
  const sku = String(line?.sku || '').trim()
  if (name && !NON_PRODUCT_NAME_RE.test(name)) return name
  if (sku && !NON_PRODUCT_NAME_RE.test(sku)) return sku
  return name || sku || '(missing SKU)'
}

function isProductLine(line) {
  const name = String(line?.name || '')
  const sku = String(line?.sku || '')
  if (NON_PRODUCT_NAME_RE.test(name) || NON_PRODUCT_NAME_RE.test(sku)) return false
  const qty = Number(line?.quantity)
  if (!Number.isFinite(qty) || qty === 0) return false
  return true
}

function isVoidOrDraft(inv) {
  const s = String(inv?.status || '').toLowerCase()
  return s === 'void' || s === 'draft'
}

/**
 * @param {string} dateYmd
 * @returns {Promise<{
 *   byChannel: Record<string, object[]>,
 *   all: object[],
 *   warnings: string[],
 * }>}
 */
async function loadZohoInvoicesByChannel(dateYmd) {
  const warnings = []
  let list
  try {
    list = await listInvoicesForDate(dateYmd)
  } catch (err) {
    const e = new Error(err && err.message ? err.message : String(err))
    e.code = 'ZOHO_INVOICE_LIST_FAILED'
    throw e
  }

  const customerToChannel = new Map()
  for (const [channel, names] of Object.entries(CHANNEL_CUSTOMERS)) {
    for (const name of names) customerToChannel.set(name, channel)
  }

  const usable = list.filter((inv) => {
    if (isVoidOrDraft(inv)) return false
    const customer = String(inv.customer_name || '').trim()
    return customerToChannel.has(customer)
  })

  const details = await mapPool(usable, DETAIL_CONCURRENCY, async (inv) => {
    try {
      const full = await fetchInvoiceDetail(inv.invoice_id)
      await sleep(120)
      return full || inv
    } catch (err) {
      warnings.push(
        `Zoho invoice ${inv.invoice_number || inv.invoice_id}: ${err.message || String(err)}`,
      )
      return { ...inv, line_items: [], _detailFailed: true }
    }
  })

  /** @type {Record<string, object[]>} */
  const byChannel = {
    amazon_uae: [],
    amazon_ksa: [],
    noon_uae: [],
    noon_ksa: [],
    carrefour_uae: [],
    life_smile_website: [],
    life_smile_shop: [],
  }

  for (const inv of details) {
    const customer = String(inv.customer_name || '').trim()
    const channel = customerToChannel.get(customer)
    if (!channel) continue
    byChannel[channel].push(inv)
  }

  return { byChannel, all: details, warnings }
}

/**
 * Convert Zoho invoices into report orders.
 * @param {object[]} invoices
 * @param {{ orderNumberFn?: (inv: object) => string, currency?: string }} opts
 */
function invoicesToOrders(invoices, opts = {}) {
  const orders = []
  let quantity = 0
  let salesAmountAED = 0
  let couponDiscountAED = 0
  let shippingChargedAED = 0
  let missingSku = 0

  for (const inv of invoices || []) {
    const lines = Array.isArray(inv.line_items) ? inv.line_items : []
    const productLines = lines.filter(isProductLine)
    const items = []
    let lineQty = 0
    for (const line of productLines) {
      const code = lineItemCode(line)
      if (code === '(missing SKU)') missingSku += 1
      const qty = Math.max(0, Math.trunc(Number(line.quantity) || 0))
      lineQty += qty
      items.push({
        sku: code,
        quantity: qty,
        unitAmount: line.rate != null ? Number(line.rate) : undefined,
        lineAmount: line.item_total != null ? Number(line.item_total) : undefined,
      })
    }

    for (const line of lines) {
      const name = String(line.name || '')
      if (/coupon|discount|smile\s*point/i.test(name)) {
        couponDiscountAED += Math.abs(Number(line.rate) || Number(line.item_total) || 0)
      }
      if (/courier|shipping|delivery/i.test(name)) {
        shippingChargedAED += Math.abs(Number(line.rate) || Number(line.item_total) || 0)
      }
    }

    if (items.length === 0) {
      // Still count the invoice amount with a placeholder line so the order appears
      items.push({ sku: '(no product lines)', quantity: 0 })
    }

    const amount = Number(inv.total)
    const amountAED = Number.isFinite(amount) ? amount : 0
    const orderNumber = opts.orderNumberFn
      ? opts.orderNumberFn(inv)
      : String(inv.reference_number || inv.invoice_number || inv.invoice_id || '').trim()

    quantity += lineQty
    salesAmountAED += amountAED

    orders.push({
      orderId: String(inv.invoice_id || orderNumber),
      orderNumber: orderNumber || String(inv.invoice_number || ''),
      orderDate: inv.date ? `${inv.date}T12:00:00.000Z` : null,
      status: String(inv.status || ''),
      items,
      originalAmount: amountAED,
      originalCurrency: String(inv.currency_code || opts.currency || 'AED').toUpperCase(),
      amountAED,
      zohoInvoiceNumber: inv.invoice_number || null,
      referenceNumber: inv.reference_number || null,
    })
  }

  return {
    orders,
    quantity,
    salesAmountAED: Math.round((salesAmountAED + Number.EPSILON) * 100) / 100,
    couponDiscountAED: Math.round((couponDiscountAED + Number.EPSILON) * 100) / 100,
    shippingChargedAED: Math.round((shippingChargedAED + Number.EPSILON) * 100) / 100,
    missingSku,
  }
}

module.exports = {
  CHANNEL_CUSTOMERS,
  loadZohoInvoicesByChannel,
  invoicesToOrders,
  lineItemCode,
  isProductLine,
  listInvoicesForDate,
}
