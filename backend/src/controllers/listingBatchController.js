const {
  createBatchFromUpload,
  listBatches,
  getBatch,
  validateBatch,
  applyDefaultsToBatch,
  updateRow,
  bulkAction,
} = require('../services/listingBatchService')
const {
  listDefaultProfiles,
  createDefaultProfile,
  updateDefaultProfile,
} = require('../services/listingDefaultsService')
const {
  startGeneration,
  getGenerationJob,
  cancelGenerationJob,
  generateOneRow,
} = require('../services/listingBulkGenerationService')
const { exportBatchWorkbook } = require('../services/amazonFlatFileExportService')

async function uploadBatch(req, res) {
  try {
    const result = await createBatchFromUpload({
      file: req.file,
      reqUser: req.user,
      batchName: req.body?.batch_name,
    })
    res.json({ success: true, batch: result })
  } catch (err) {
    const status = err.code === 'UNSUPPORTED_FILE_TYPE' || err.code === 'SKU_COLUMN_MISSING' ? 400 : 500
    res.status(status).json({ success: false, error: err.message || 'Upload failed', code: err.code || 'UPLOAD_FAILED' })
  }
}

async function getBatches(req, res) {
  res.json({ items: await listBatches({ limit: req.query?.limit }) })
}

async function getBatchDetail(req, res) {
  const batch = await getBatch(req.params.batchId, {
    includeRows: true,
    limit: req.query?.limit,
    offset: req.query?.offset,
    search: req.query?.search,
    status: req.query?.status,
  })
  if (!batch) return res.status(404).json({ error: 'Batch not found' })
  res.json({ batch })
}

async function postApplyDefaults(req, res) {
  const result = await applyDefaultsToBatch(req.params.batchId, { ...req.body, reqUser: req.user })
  res.json({ success: true, ...result })
}

async function postValidate(req, res) {
  res.json({ success: true, ...(await validateBatch(req.params.batchId)) })
}

async function postGenerate(req, res) {
  const job = await startGeneration(req.params.batchId, {
    reqUser: req.user,
    mode: req.body?.mode || 'balanced',
    rowIds: req.body?.rowIds || [],
  })
  res.json({ success: true, job })
}

async function getGenerationStatus(req, res) {
  res.json({ job: getGenerationJob(req.params.batchId) })
}

async function postCancelGeneration(req, res) {
  res.json({ job: cancelGenerationJob(req.params.batchId) })
}

async function postGenerateRow(req, res) {
  const row = await generateOneRow(req.params.batchId, req.params.rowId, {
    reqUser: req.user,
    only: req.body?.only || '',
  })
  if (!row) return res.status(404).json({ error: 'Row not found' })
  res.json({ success: true, row })
}

async function patchRow(req, res) {
  const row = await updateRow(req.params.batchId, req.params.rowId, {
    values: req.body?.values || {},
    status: req.body?.status,
    reqUser: req.user,
  })
  if (!row) return res.status(404).json({ error: 'Row not found' })
  res.json({ success: true, row })
}

async function postBulkAction(req, res) {
  res.json({ success: true, ...(await bulkAction(req.params.batchId, req.body || {})) })
}

async function postExport(req, res) {
  const out = await exportBatchWorkbook(req.params.batchId, { approvedOnly: Boolean(req.body?.approvedOnly) })
  if (!out) return res.status(404).json({ error: 'Batch not found' })
  res.setHeader('Content-Type', out.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename.replace(/"/g, '')}"`)
  res.send(out.buffer)
}

async function getDefaultProfiles(req, res) {
  res.json({ items: await listDefaultProfiles() })
}

async function postDefaultProfile(req, res) {
  res.json({ success: true, profile: await createDefaultProfile({ ...req.body, reqUser: req.user }) })
}

async function patchDefaultProfile(req, res) {
  const profile = await updateDefaultProfile(req.params.id, req.body || {})
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  res.json({ success: true, profile })
}

module.exports = {
  uploadBatch,
  getBatches,
  getBatchDetail,
  postApplyDefaults,
  postValidate,
  postGenerate,
  getGenerationStatus,
  postCancelGeneration,
  postGenerateRow,
  patchRow,
  postBulkAction,
  postExport,
  getDefaultProfiles,
  postDefaultProfile,
  patchDefaultProfile,
}
