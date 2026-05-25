/**
 * linearWorkspaceController.js
 * REST handlers for linear_* shared workspace tables.
 * All user-facing errors return JSON.
 */
const svc = require('../services/linearWorkspaceService')

function userId(req) {
  return req.user?.userId || req.user?.id || null
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message })
}

// ── Docs ──────────────────────────────────────────────────────────────────────

async function listDocs(req, res) {
  try {
    res.json(await svc.listDocs())
  } catch (e) {
    console.error('[linearWorkspace] listDocs:', e.message)
    sendError(res, 500, 'Failed to list docs')
  }
}

async function getDoc(req, res) {
  try {
    const doc = await svc.getDoc(req.params.id)
    if (!doc) return sendError(res, 404, 'Doc not found')
    res.json(doc)
  } catch (e) {
    sendError(res, 500, 'Failed to get doc')
  }
}

async function createDoc(req, res) {
  try {
    if (!req.body?.title?.trim()) return sendError(res, 400, 'title is required')
    res.status(201).json(await svc.createDoc(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createDoc:', e.message)
    sendError(res, 500, 'Failed to create doc')
  }
}

async function updateDoc(req, res) {
  try {
    const doc = await svc.updateDoc(req.params.id, req.body, userId(req))
    if (!doc) return sendError(res, 404, 'Doc not found')
    res.json(doc)
  } catch (e) {
    sendError(res, 500, 'Failed to update doc')
  }
}

async function deleteDoc(req, res) {
  try {
    await svc.deleteDoc(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 500, 'Failed to delete doc')
  }
}

// ── Intake ────────────────────────────────────────────────────────────────────

async function listIntake(req, res) {
  try { res.json(await svc.listIntake()) }
  catch (e) { sendError(res, 500, 'Failed to list intake') }
}

async function createIntake(req, res) {
  try {
    if (!req.body?.title?.trim()) return sendError(res, 400, 'title is required')
    res.status(201).json(await svc.createIntake(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createIntake:', e.message)
    sendError(res, 500, 'Failed to create intake item')
  }
}

async function updateIntake(req, res) {
  try {
    const item = await svc.updateIntake(req.params.id, req.body, userId(req))
    if (!item) return sendError(res, 404, 'Intake item not found')
    res.json(item)
  } catch (e) { sendError(res, 500, 'Failed to update intake item') }
}

async function deleteIntake(req, res) {
  try {
    await svc.deleteIntake(req.params.id)
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete intake item') }
}

// ── Mobile Releases ───────────────────────────────────────────────────────────

async function listMobileReleases(req, res) {
  try { res.json(await svc.listMobileReleases()) }
  catch (e) { sendError(res, 500, 'Failed to list mobile releases') }
}

async function createMobileRelease(req, res) {
  try {
    if (!req.body?.name?.trim()) return sendError(res, 400, 'name is required')
    res.status(201).json(await svc.createMobileRelease(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createMobileRelease:', e.message)
    sendError(res, 500, 'Failed to create mobile release')
  }
}

async function updateMobileRelease(req, res) {
  try {
    const item = await svc.updateMobileRelease(req.params.id, req.body, userId(req))
    if (!item) return sendError(res, 404, 'Mobile release not found')
    res.json(item)
  } catch (e) { sendError(res, 500, 'Failed to update mobile release') }
}

async function deleteMobileRelease(req, res) {
  try {
    await svc.deleteMobileRelease(req.params.id)
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete mobile release') }
}

// ── Deployments ───────────────────────────────────────────────────────────────

async function listDeployments(req, res) {
  try { res.json(await svc.listDeployments()) }
  catch (e) { sendError(res, 500, 'Failed to list deployments') }
}

async function createDeployment(req, res) {
  try {
    if (!req.body?.name?.trim()) return sendError(res, 400, 'name is required')
    res.status(201).json(await svc.createDeployment(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createDeployment:', e.message)
    sendError(res, 500, 'Failed to create deployment')
  }
}

async function updateDeployment(req, res) {
  try {
    const item = await svc.updateDeployment(req.params.id, req.body, userId(req))
    if (!item) return sendError(res, 404, 'Deployment not found')
    res.json(item)
  } catch (e) { sendError(res, 500, 'Failed to update deployment') }
}

async function deleteDeployment(req, res) {
  try {
    await svc.deleteDeployment(req.params.id)
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete deployment') }
}

// ── Checklist Runs ────────────────────────────────────────────────────────────

async function listChecklistRuns(req, res) {
  try {
    const { context_type, context_id } = req.query
    res.json(await svc.listChecklistRuns({ context_type, context_id }))
  } catch (e) { sendError(res, 500, 'Failed to list checklist runs') }
}

async function upsertChecklistRun(req, res) {
  try {
    if (!req.body?.context_type || !req.body?.context_id) {
      return sendError(res, 400, 'context_type and context_id are required')
    }
    res.json(await svc.upsertChecklistRun(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] upsertChecklistRun:', e.message)
    sendError(res, 500, 'Failed to save checklist run')
  }
}

async function deleteChecklistRun(req, res) {
  try {
    await svc.deleteChecklistRun(req.params.id)
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete checklist run') }
}

module.exports = {
  listDocs, getDoc, createDoc, updateDoc, deleteDoc,
  listIntake, createIntake, updateIntake, deleteIntake,
  listMobileReleases, createMobileRelease, updateMobileRelease, deleteMobileRelease,
  listDeployments, createDeployment, updateDeployment, deleteDeployment,
  listChecklistRuns, upsertChecklistRun, deleteChecklistRun,
}
