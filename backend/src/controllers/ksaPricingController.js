const { lookupSkuDimensionsBatch } = require('../services/ksaPricingZohoService')

async function postZohoDimensions(req, res) {
  try {
    const skus = Array.isArray(req.body?.skus) ? req.body.skus : []
    if (!skus.length) {
      return res.status(400).json({ error: 'skus array is required' })
    }
    const results = await lookupSkuDimensionsBatch(skus)
    res.json({ results })
  } catch (err) {
    const code = err?.code || 'KSA_PRICING_ZOHO_ERROR'
    res.status(err?.code === 'ZOHO_NOT_CONFIGURED' ? 503 : 500).json({
      error: err?.message || 'Zoho dimension lookup failed',
      code,
    })
  }
}

module.exports = {
  postZohoDimensions,
}
