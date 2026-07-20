const {
  getCompositeCustomRates,
  updateCompositeCustomRates,
} = require('../services/uaeCompositeCustomRatesService')

/**
 * GET /api/prices/uae-composite-custom/rates
 */
async function getRatesHandler(_req, res) {
  try {
    const rates = await getCompositeCustomRates()
    res.json({ rates })
  } catch (err) {
    console.error('[uae-composite-custom rates get]', err)
    res.status(500).json({ error: 'Failed to load composite custom rates' })
  }
}

/**
 * PUT /api/prices/uae-composite-custom/rates
 */
async function putRatesHandler(req, res) {
  try {
    const body = req.body || {}
    const rates = await updateCompositeCustomRates(
      {
        vatPct: body.vatPct,
        commissionPct: body.commissionPct,
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
    console.error('[uae-composite-custom rates put]', err)
    return res.status(500).json({ error: 'Failed to update composite custom rates' })
  }
}

module.exports = {
  getRatesHandler,
  putRatesHandler,
}
