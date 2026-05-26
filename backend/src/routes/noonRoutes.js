const express = require('express')

const auth = require('../middleware/auth')
const { getNoonAuthStatus, getNoonLoginScopeDebug } = require('../services/noon/noonAuthService')
const { readNoonConfig } = require('../services/noon/noonConfig')
const { isNoonServiceError, toNoonErrorPayload } = require('../services/noon/noonErrors')
const {
  debugProductLookup,
  debugPricingRequestVariants,
  getEligibleCatalogItems,
  getProductOffers,
  getWhoami,
} = require('../services/noon/noonProductService')
const {
  listNoonProductSnapshots,
  syncNoonCatalogPricing,
} = require('../services/noon/noonSnapshotSyncService')
const { auditNoonRichContent } = require('../services/noon/noonRichContentAuditService')
const {
  auditNoonStockFields,
  debugNoonStock,
  discoverNoonWarehouses,
  syncNoonStockForSkus,
} = require('../services/noon/noonStockService')

const router = express.Router()

function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next)
  }
}

function sanitizeConfigStatus() {
  const config = readNoonConfig()
  return {
    code: config.code,
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    userAgent: config.userAgent,
    jsonPath: config.jsonPath,
    jsonPathExists: config.jsonPathExists,
    projectCodeConfigured: config.projectCodeConfigured,
    apiMode: config.apiMode,
    missing: config.missing,
    errors: config.errors,
  }
}

function getErrorMessages(error) {
  if (isNoonServiceError(error)) {
    return [error.message, ...(error.details || [])].filter(Boolean)
  }
  return ['Noon request failed.']
}

function sendNoonError(res, error) {
  if (isNoonServiceError(error)) {
    return res.status(error.httpStatus).json(toNoonErrorPayload(error))
  }
  return res.status(500).json(toNoonErrorPayload(error))
}

function sendScopedProductNotFound(res, partnerSku) {
  return res.status(404).json({
    ok: false,
    code: 'NOON_PRODUCT_NOT_FOUND_OR_NOT_SCOPED',
    partnerSku,
    message:
      'Noon returned 404. This usually means the SKU is not found for the authenticated project/session, the SKU is not an offer SKU, or NOON_PROJECT_CODE is missing/wrong.',
    noonStatus: 404,
    hint: 'Confirm exact Noon partner_sku and configure NOON_PROJECT_CODE if needed.',
  })
}

router.use(auth.requireAuth, auth.requireAdmin)

router.get('/health', wrap(async (_req, res) => {
  const configStatus = sanitizeConfigStatus()
  const authStatus = getNoonAuthStatus()
  const errors = [...configStatus.errors]
  let authenticated = false
  let whoami = null
  let whoamiProjectCode = null
  let whoamiPartnerCode = null

  if (configStatus.enabled && configStatus.configured) {
    try {
      const result = await getWhoami()
      authenticated = true
      whoami = result
      const summary = result && result.summary && typeof result.summary === 'object' ? result.summary : {}
      whoamiProjectCode =
        typeof summary.projectCode === 'string' && summary.projectCode.trim()
          ? summary.projectCode.trim()
          : null
      whoamiPartnerCode =
        typeof summary.partnerCode === 'string' && summary.partnerCode.trim()
          ? summary.partnerCode.trim()
          : null
    } catch (error) {
      errors.push(...getErrorMessages(error))
    }
  }

  res.json({
    ok: Boolean(configStatus.enabled && configStatus.configured && authenticated),
    enabled: configStatus.enabled,
    configured: configStatus.configured,
    authenticated,
    whoamiProjectCode,
    whoamiPartnerCode,
    configStatus: {
      ...configStatus,
      authCache: authStatus,
      loginScopeDebug: getNoonLoginScopeDebug(),
    },
    whoami,
    errors,
  })
}))

router.get('/whoami', wrap(async (_req, res) => {
  try {
    const result = await getWhoami()
    res.json({
      ok: true,
      raw: result.raw,
      summary: result.summary,
    })
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/product/:partnerSku', wrap(async (req, res) => {
  const partnerSku = String(req.params.partnerSku || '').trim()
  try {
    const result = await getProductOffers(partnerSku)
    res.json({
      ok: true,
      partnerSku,
      raw: result.raw,
      summary: result.summary,
    })
  } catch (error) {
    if (isNoonServiceError(error) && error.httpStatus === 404) {
      return sendScopedProductNotFound(res, partnerSku)
    }
    return sendNoonError(res, error)
  }
}))

router.get('/debug/product/:partnerSku', wrap(async (req, res) => {
  try {
    const partnerSku = String(req.params.partnerSku || '').trim()
    const countryCode = String(req.query.country_code || req.query.countryCode || '').trim()
    const pricingBodyShape = String(req.query.pricing_body_shape || req.query.pricingBodyShape || '').trim()
    const result = await debugProductLookup(partnerSku, { countryCode, pricingBodyShape })
    res.json(result)
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/debug/pricing/:partnerSku', wrap(async (req, res) => {
  try {
    const partnerSku = String(req.params.partnerSku || '').trim()
    const rawCountryCodes = String(req.query.country_codes || req.query.countryCodes || '').trim()
    const rawBodyShapes = String(req.query.body_shapes || req.query.bodyShapes || '').trim()
    const countryCodes = rawCountryCodes
      ? rawCountryCodes.split(',').map((entry) => entry.trim()).filter(Boolean)
      : undefined
    const bodyShapes = rawBodyShapes
      ? rawBodyShapes.split(',').map((entry) => entry.trim()).filter(Boolean)
      : undefined
    const result = await debugPricingRequestVariants(partnerSku, { countryCodes, bodyShapes })
    res.json(result)
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/catalog/eligible-items', wrap(async (req, res) => {
  try {
    const limit = req.query.limit
    const search = req.query.search
    const result = await getEligibleCatalogItems({ limit, search })

    let firstItemDiagnostics = null
    const firstPartnerSku =
      Array.isArray(result.items) && result.items[0] && typeof result.items[0].partnerSku === 'string'
        ? result.items[0].partnerSku.trim()
        : ''

    if (firstPartnerSku) {
      firstItemDiagnostics = await debugProductLookup(firstPartnerSku)
    }

    res.json({
      ok: true,
      count: result.count,
      totalCount: result.totalCount,
      items: result.items,
      raw: result.raw,
      firstItemDiagnostics,
    })
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/snapshots', wrap(async (req, res) => {
  try {
    const result = await listNoonProductSnapshots({
      search: req.query.search,
      countryCode: req.query.country_code || req.query.countryCode,
      isActive: req.query.is_active || req.query.isActive,
      page: req.query.page,
      limit: req.query.limit,
    })
    res.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/rich-content-audit', wrap(async (req, res) => {
  try {
    const result = await auditNoonRichContent({
      countryCode: req.query.country_code || req.query.countryCode,
    })
    res.json(result)
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/stock-field-audit', wrap(async (req, res) => {
  try {
    const result = await auditNoonStockFields({
      countryCode: req.query.country_code || req.query.countryCode,
    })
    res.json(result)
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/warehouses', wrap(async (req, res) => {
  try {
    const result = await discoverNoonWarehouses({
      countryCode: req.query.country_code || req.query.countryCode,
    })
    res.json(result)
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.get('/debug/stock/:partnerSku', wrap(async (req, res) => {
  try {
    const partnerSku = String(req.params.partnerSku || '').trim()
    const warehouse = String(req.query.warehouse || '').trim()
    const result = await debugNoonStock(partnerSku, warehouse)
    res.json(result)
  } catch (error) {
    if (error && error.message && !isNoonServiceError(error)) {
      return res.status(400).json({ ok: false, error: error.message })
    }
    sendNoonError(res, error)
  }
}))

router.post('/sync/stock', wrap(async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const result = await syncNoonStockForSkus({
      countryCode: body.country_code || body.countryCode,
      warehouse: body.warehouse,
      partnerSkus: body.partner_skus || body.partnerSkus,
    })
    res.json(result)
  } catch (error) {
    sendNoonError(res, error)
  }
}))

router.post('/sync/catalog-pricing', wrap(async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const result = await syncNoonCatalogPricing({
      countryCode: body.country_code || body.countryCode,
      limit: body.limit,
    })
    res.json(result)
  } catch (error) {
    sendNoonError(res, error)
  }
}))

module.exports = router
