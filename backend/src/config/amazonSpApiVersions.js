/**
 * Amazon SP-API path constants (single place to update when Amazon revises versions).
 * @see backend/docs/amazon-spapi-versions.md
 */

const SELLERS_MARKETPLACE_PARTICIPATIONS_PATH = '/sellers/v1/marketplaceParticipations'

const ORDERS_PATH = '/orders/v0/orders'

/**
 * @param {string} orderId
 * @returns {string}
 */
function orderItemsPath(orderId) {
  const id = String(orderId ?? '').trim()
  if (!id) {
    const err = new Error('orderId is required for orderItemsPath')
    err.code = 'AMAZON_ORDER_ID_REQUIRED'
    throw err
  }
  return `/orders/v0/orders/${encodeURIComponent(id)}/orderItems`
}

const CATALOG_ITEMS_2022_PATH = '/catalog/2022-04-01/items'

const FBA_INVENTORY_SUMMARIES_PATH = '/fba/inventory/v1/summaries'

const REPORTS_2021_PATH = '/reports/2021-06-30/reports'

/**
 * @param {string} reportId
 * @returns {string}
 */
function reportPath(reportId) {
  const id = String(reportId ?? '').trim()
  if (!id) {
    const err = new Error('reportId is required for reportPath')
    err.code = 'AMAZON_REPORT_ID_REQUIRED'
    throw err
  }
  return `/reports/2021-06-30/reports/${encodeURIComponent(id)}`
}

/**
 * @param {string} reportDocumentId
 * @returns {string}
 */
function reportDocumentPath(reportDocumentId) {
  const id = String(reportDocumentId ?? '').trim()
  if (!id) {
    const err = new Error('reportDocumentId is required for reportDocumentPath')
    err.code = 'AMAZON_REPORT_DOCUMENT_ID_REQUIRED'
    throw err
  }
  return `/reports/2021-06-30/documents/${encodeURIComponent(id)}`
}

module.exports = {
  SELLERS_MARKETPLACE_PARTICIPATIONS_PATH,
  ORDERS_PATH,
  orderItemsPath,
  CATALOG_ITEMS_2022_PATH,
  FBA_INVENTORY_SUMMARIES_PATH,
  REPORTS_2021_PATH,
  reportPath,
  reportDocumentPath,
}
