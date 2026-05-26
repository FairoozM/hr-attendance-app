import { api } from '../api/client'

export async function fetchNoonHealth() {
  return api.get('/api/noon/health')
}

export async function fetchNoonWhoami() {
  return api.get('/api/noon/whoami')
}

export async function fetchNoonProduct(partnerSku) {
  const normalizedSku = String(partnerSku || '').trim()
  return api.get(`/api/noon/product/${encodeURIComponent(normalizedSku)}`)
}

export async function fetchNoonProductDiagnostics(partnerSku, options = {}) {
  const normalizedSku = String(partnerSku || '').trim()
  const searchParams = new URLSearchParams()
  if (options.countryCode != null && String(options.countryCode).trim()) {
    searchParams.set('country_code', String(options.countryCode).trim().toLowerCase())
  }
  if (options.pricingBodyShape != null && String(options.pricingBodyShape).trim()) {
    searchParams.set('pricing_body_shape', String(options.pricingBodyShape).trim())
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/debug/product/${encodeURIComponent(normalizedSku)}${suffix}`)
}

export async function fetchNoonPricingDiagnostics(partnerSku, options = {}) {
  const normalizedSku = String(partnerSku || '').trim()
  const searchParams = new URLSearchParams()
  if (Array.isArray(options.countryCodes) && options.countryCodes.length) {
    searchParams.set('country_codes', options.countryCodes.join(','))
  }
  if (Array.isArray(options.bodyShapes) && options.bodyShapes.length) {
    searchParams.set('body_shapes', options.bodyShapes.join(','))
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/debug/pricing/${encodeURIComponent(normalizedSku)}${suffix}`)
}

export async function fetchNoonEligibleCatalogItems(options = {}) {
  const searchParams = new URLSearchParams()
  if (options.limit != null && String(options.limit).trim()) {
    searchParams.set('limit', String(options.limit).trim())
  }
  if (options.search != null && String(options.search).trim()) {
    searchParams.set('search', String(options.search).trim())
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/catalog/eligible-items${suffix}`)
}

export async function fetchNoonSnapshots(options = {}) {
  const searchParams = new URLSearchParams()
  if (options.search != null && String(options.search).trim()) {
    searchParams.set('search', String(options.search).trim())
  }
  if (options.countryCode != null && String(options.countryCode).trim()) {
    searchParams.set('country_code', String(options.countryCode).trim().toLowerCase())
  }
  if (options.isActive != null && String(options.isActive).trim()) {
    searchParams.set('is_active', String(options.isActive).trim())
  }
  if (options.page != null && String(options.page).trim()) {
    searchParams.set('page', String(options.page).trim())
  }
  if (options.limit != null && String(options.limit).trim()) {
    searchParams.set('limit', String(options.limit).trim())
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/snapshots${suffix}`)
}

export async function fetchNoonRichContentAudit(options = {}) {
  const searchParams = new URLSearchParams()
  if (options.countryCode != null && String(options.countryCode).trim()) {
    searchParams.set('country_code', String(options.countryCode).trim().toLowerCase())
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/rich-content-audit${suffix}`)
}

export async function fetchNoonStockFieldAudit(options = {}) {
  const searchParams = new URLSearchParams()
  if (options.countryCode != null && String(options.countryCode).trim()) {
    searchParams.set('country_code', String(options.countryCode).trim().toLowerCase())
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/stock-field-audit${suffix}`)
}

export async function fetchNoonWarehouses(options = {}) {
  const searchParams = new URLSearchParams()
  if (options.countryCode != null && String(options.countryCode).trim()) {
    searchParams.set('country_code', String(options.countryCode).trim().toLowerCase())
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/warehouses${suffix}`)
}

export async function fetchNoonStockDiagnostics(partnerSku, options = {}) {
  const normalizedSku = String(partnerSku || '').trim()
  const searchParams = new URLSearchParams()
  if (options.warehouse != null && String(options.warehouse).trim()) {
    searchParams.set('warehouse', String(options.warehouse).trim())
  }
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return api.get(`/api/noon/debug/stock/${encodeURIComponent(normalizedSku)}${suffix}`)
}

export async function syncNoonStockForSkus(options = {}) {
  return api.post('/api/noon/sync/stock', {
    country_code: String(options.countryCode || 'ae').trim().toLowerCase(),
    warehouse: String(options.warehouse || '').trim(),
    partner_skus: Array.isArray(options.partnerSkus) ? options.partnerSkus : [],
  }, { timeoutMs: 120_000 })
}

export async function syncNoonCatalogPricing(options = {}) {
  return api.post('/api/noon/sync/catalog-pricing', {
    country_code: String(options.countryCode || 'ae').trim().toLowerCase(),
    limit: Number(options.limit || 100),
  }, { timeoutMs: 120_000 })
}
