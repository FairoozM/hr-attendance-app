const {
  getCustomRates,
  updateCustomRates,
  getSharedUaeCatalog,
} = require('../services/uaePricesCustomService')

/**
 * GET /api/prices/uae-custom/rates
 */
async function getRatesHandler(_req, res) {
  try {
    const rates = await getCustomRates()
    res.json({ rates })
  } catch (err) {
    console.error('[uae-custom rates get]', err)
    res.status(500).json({ error: 'Failed to load custom rates' })
  }
}

/**
 * PUT /api/prices/uae-custom/rates
 */
async function putRatesHandler(req, res) {
  try {
    const body = req.body || {}
    const rates = await updateCustomRates(
      {
        vatPct: body.vatPct,
        advertisingPct: body.advertisingPct,
        requiredProfitPct: body.requiredProfitPct,
      },
      { userId: req.user?.id },
    )
    res.json({ rates })
  } catch (err) {
    if (err?.code === 'VALIDATION') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[uae-custom rates put]', err)
    return res.status(500).json({ error: 'Failed to update custom rates' })
  }
}

/**
 * GET /api/prices/uae-custom/catalog
 */
async function getCatalogHandler(_req, res) {
  try {
    const catalog = await getSharedUaeCatalog()
    res.json(catalog)
  } catch (err) {
    console.error('[uae-custom catalog]', err)
    res.status(500).json({ error: 'Failed to load shared UAE catalog' })
  }
}

module.exports = {
  getRatesHandler,
  putRatesHandler,
  getCatalogHandler,
}
