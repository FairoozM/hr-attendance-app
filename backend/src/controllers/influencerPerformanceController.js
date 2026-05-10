const influencerPerformanceService = require('../services/influencerPerformanceService')

function redactNetProfitUnlessAdmin(records, isAdmin) {
  if (isAdmin || !Array.isArray(records)) return records
  return records.map((row) => {
    if (!row || typeof row !== 'object') return row
    const copy = { ...row }
    delete copy.netProfitAed
    return copy
  })
}

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

async function bulkUpsertPerformanceRecords(req, res) {
  try {
    const body = req.body
    const records = body && Array.isArray(body.records) ? body.records : null
    if (!records) {
      return res.status(400).json({ error: 'Body must include a "records" array' })
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
