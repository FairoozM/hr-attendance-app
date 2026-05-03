const { lookupCompositeItemBySku } = require('../services/compositeItemsZohoLookup')

async function postLookup(req, res) {
  try {
    const sku = req.body && req.body.sku != null ? String(req.body.sku) : ''
    const data = await lookupCompositeItemBySku(sku)
    return res.json(data)
  } catch (err) {
    const code = err.code || 'LOOKUP_FAILED'
    if (code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({
        error: err.message || 'Zoho not configured',
        code,
        hint: 'Set Zoho OAuth env vars on the API server. Composite lookup needs scope ZohoInventory.compositeitems.READ.',
      })
    }
    if (code === 'INVALID_SKU') {
      return res.status(400).json({ error: err.message, code })
    }
    if (code === 'COMPOSITE_SKU_NOT_FOUND') {
      return res.status(404).json({ error: err.message, code })
    }
    if (code === 'COMPOSITE_NO_COMPONENTS') {
      return res.status(422).json({ error: err.message, code })
    }
    if (code === 'COMPOSITE_SKU_AMBIGUOUS') {
      return res.status(409).json({ error: err.message, code })
    }
    if (code === 'ZOHO_INVALID_COMPOSITE_ID') {
      return res.status(400).json({ error: err.message, code })
    }
    const status =
      code === 'ZOHO_API_ERROR' || code === 'ZOHO_API_TIMEOUT' || code === 'ZOHO_OAUTH_ERROR'
        ? 502
        : 500
    console.error('[composite-items/lookup]', code, err.message)
    return res.status(status).json({
      error: err.message || 'Composite lookup failed',
      code,
    })
  }
}

module.exports = {
  postLookup,
}
