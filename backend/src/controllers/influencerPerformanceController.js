const influencerPerformanceService = require('../services/influencerPerformanceService')

/**
 * @typedef {object} InfluencerPerformanceRecordBody
 * @property {string} [id]
 * @property {string} [contractId]
 * @property {string} [influencerId]
 * @property {string} [date] YYYY-MM-DD check-in date
 * @property {string} [platform]
 * @property {string} [postUrl]
 * @property {string} [campaignName]
 * @property {string} [videoTitle]
 * @property {string} [contractStartDate]
 * @property {string} [contractEndDate]
 * @property {number|string} [monitoringDays] Clamped 3–5 server-side
 * @property {number|string} [views]
 * @property {number|string} [likes]
 * @property {number|string} [comments]
 * @property {number|string} [shares]
 * @property {number|string} [saves]
 * @property {number|string} [storyViews]
 * @property {number|string} [salesAed]
 * @property {number|string} [cost]
 * @property {number|string} [netProfitAed] Admin-only; stripped for non-admins
 * @property {string} [notes]
 */

/**
 * @param {InfluencerPerformanceRecordBody[]|unknown} records
 * @param {boolean} isAdmin
 * @returns {InfluencerPerformanceRecordBody[]|unknown}
 */
function redactNetProfitUnlessAdmin(records, isAdmin) {
  if (isAdmin || !Array.isArray(records)) return records
  return records.map((row) => {
    if (!row || typeof row !== 'object') return row
    const copy = { ...row }
    delete copy.netProfitAed
    return copy
  })
}

/**
 * @param {InfluencerPerformanceRecordBody} [record]
 */
function buildContractFromRecord(record = {}) {
  return {
    id: record.contractId,
    influencerId: record.influencerId,
    platform: record.platform || '',
    campaignName: record.campaignName || '',
    videoTitle: record.videoTitle || record.campaignName || 'Contracted video',
    postUrl: record.postUrl || '',
    contractStartDate: record.contractStartDate || record.date || '',
    monitoringDays: record.monitoringDays || 5,
  }
}

/**
 * GET /api/influencers/performance-records
 * Returns { records, contracts }. Rankings/totals are computed on the client.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listPerformanceRecords(req, res) {
  try {
    const isAdmin = req.user?.role === 'admin'
    const records = await influencerPerformanceService.listPerformanceRecords()
    const savedContracts = await influencerPerformanceService.listPerformanceContracts()
    const contractsById = new Map(savedContracts.map((contract) => [String(contract.id), contract]))
    records.forEach((record) => {
      if (record.contractId && !contractsById.has(String(record.contractId))) {
        contractsById.set(String(record.contractId), buildContractFromRecord(record))
      }
    })
    res.json({
      records: redactNetProfitUnlessAdmin(records, isAdmin),
      contracts: Array.from(contractsById.values()),
    })
  } catch (err) {
    console.error('[influencerPerformance] list error:', err)
    res.status(500).json({ error: err.message || 'Failed to load performance records' })
  }
}

/**
 * POST /api/influencers/performance-records/bulk-upsert
 * Body: { records: InfluencerPerformanceRecordBody[] }
 * Each row requires id, influencerId, and date (YYYY-MM-DD).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function bulkUpsertPerformanceRecords(req, res) {
  try {
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be a JSON object with a "records" array' })
    }
    const records = Array.isArray(body.records) ? body.records : null
    if (!records) {
      return res.status(400).json({ error: 'Body must include a "records" array' })
    }
    const invalidIndex = records.findIndex(
      (row) => !row || typeof row !== 'object' || Array.isArray(row),
    )
    if (invalidIndex >= 0) {
      return res.status(400).json({ error: `records[${invalidIndex}] must be an object` })
    }
    const userId = req.user?.userId != null ? String(req.user.userId) : null
    const isAdmin = req.user?.role === 'admin'
    const result = await influencerPerformanceService.bulkUpsertPerformanceRecords(records, userId, isAdmin)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[influencerPerformance] bulkUpsert error:', err)
    res.status(500).json({ error: err.message || 'Failed to save performance records' })
  }
}

/**
 * DELETE /api/influencers/performance-records/:id
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function deletePerformanceRecord(req, res) {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : ''
    if (!id) {
      return res.status(400).json({ error: 'Record id is required' })
    }
    const userId = req.user?.userId != null ? String(req.user.userId) : null
    const result = await influencerPerformanceService.deletePerformanceRecord(id, userId)
    if (!result.deleted) {
      return res.status(404).json({ error: 'Record not found' })
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[influencerPerformance] delete error:', err)
    res.status(500).json({ error: err.message || 'Failed to delete record' })
  }
}

module.exports = {
  listPerformanceRecords,
  bulkUpsertPerformanceRecords,
  deletePerformanceRecord,
}
