'use strict'

const {
  buildDailyEcommerceLedger,
} = require('../services/ecommerceLedger/dailyEcommerceLedgerService')
const {
  buildEcommerceSummaryReport,
} = require('../services/ecommerceSummary/ecommerceSummaryService')
const { assertYmd, todayUaeYmd } = require('../services/ecommerceAccounting/accountNature')

function resolveDate(req) {
  const raw = String(req.query?.date || req.body?.date || '').trim()
  if (!raw) return todayUaeYmd()
  return assertYmd(raw)
}

async function getDailyEcommerceLedger(req, res) {
  try {
    const date = resolveDate(req)
    const report = await buildDailyEcommerceLedger({ date })
    return res.json(report)
  } catch (err) {
    const status = err.code === 'BAD_REQUEST' ? 400 : 500
    console.error('[dailyEcommerceLedger]', err)
    return res.status(status).json({
      error: err.message || 'Failed to build Daily Ecommerce Ledger',
      code: err.code || 'LEDGER_ERROR',
    })
  }
}

async function getEcommerceSummaryReport(req, res) {
  try {
    const date = resolveDate(req)
    const report = await buildEcommerceSummaryReport({ date })
    return res.json(report)
  } catch (err) {
    const status = err.code === 'BAD_REQUEST' ? 400 : 500
    console.error('[ecommerceSummary]', err)
    return res.status(status).json({
      error: err.message || 'Failed to build Ecommerce Summary Report',
      code: err.code || 'SUMMARY_ERROR',
    })
  }
}

module.exports = {
  getDailyEcommerceLedger,
  getEcommerceSummaryReport,
}
