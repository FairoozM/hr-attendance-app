const influencerPerformanceService = require('../services/influencerPerformanceService')

async function listPerformanceRecords(req, res) {
  try {
    const records = await influencerPerformanceService.listPerformanceRecords()
    res.json({ records })
  } catch (err) {
    console.error('[influencerPerformance] list error:', err)
    res.status(500).json({ error: err.message || 'Failed to load performance records' })
  }
}

async function bulkUpsertPerformanceRecords(req, res) {
  try {
    const body = req.body
    const records = body && Array.isArray(body.records) ? body.records : null
    if (!records) {
      return res.status(400).json({ error: 'Body must include a "records" array' })
    }
    const userId = req.user?.userId != null ? String(req.user.userId) : null
    const result = await influencerPerformanceService.bulkUpsertPerformanceRecords(records, userId)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[influencerPerformance] bulkUpsert error:', err)
    res.status(500).json({ error: err.message || 'Failed to save performance records' })
  }
}

async function deletePerformanceRecord(req, res) {
  try {
    const id = req.params.id
    const result = await influencerPerformanceService.deletePerformanceRecord(id)
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
