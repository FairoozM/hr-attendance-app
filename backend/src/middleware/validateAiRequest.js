const MAX_FEATURES = 24
const MAX_FEATURE_LEN = 400
const MAX_STR = 4000

function sanitizeText(s, max = MAX_STR) {
  return String(s ?? '')
    .replace(/\0/g, '')
    .trim()
    .slice(0, max)
}

function validateAmazonGenerateListing(req, res, next) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}

  const sku = sanitizeText(b.sku, 255)
  const product_name = sanitizeText(b.product_name, 500)
  if (!sku || !product_name) {
    return res.status(400).json({
      success: false,
      message: 'sku and product_name are required.',
    })
  }

  const marketplaceRaw = String(b.marketplace || 'UAE').toUpperCase()
  const marketplace = marketplaceRaw === 'KSA' ? 'KSA' : 'UAE'

  const langRaw = String(b.language || 'EN').toUpperCase()
  const language = langRaw === 'AR' ? 'AR' : 'EN'

  let features = b.features
  if (!Array.isArray(features)) features = []
  features = features
    .slice(0, MAX_FEATURES)
    .map((f) => sanitizeText(f, MAX_FEATURE_LEN))
    .filter(Boolean)

  req.aiRouteMeta = { moduleName: 'amazon_listing', actionName: 'generate_listing' }
  req.aiListingInput = {
    sku,
    product_name,
    brand: sanitizeText(b.brand, 200) || 'LIFE SMILE',
    material: sanitizeText(b.material, 200),
    color: sanitizeText(b.color, 120),
    size: sanitizeText(b.size, 200),
    features,
    dimensions: sanitizeText(b.dimensions, 300),
    marketplace,
    language,
    model: b.model != null ? sanitizeText(b.model, 128) : undefined,
    is_cookware_set: Boolean(b.is_cookware_set),
  }

  next()
}

module.exports = {
  validateAmazonGenerateListing,
  sanitizeText,
}
