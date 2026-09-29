'use strict'

/**
 * Tabby settlement clearing API (admin only). Upload → parse → import (statement # + SHA-256)
 * → preview → one guarded "Post to Zoho". Account mappings and the bank match are local choices.
 */

const { getTabbyClearingConfig, ACCOUNT_ROLES } = require('../config/tabbyClearing')
const { parseTabbyStatement } = require('../services/tabbyClearing/tabbyStatementParser')
const model = require('../services/tabbyClearing/tabbyClearingModel')
const { createPgTabbyStore, IMPORT_RESULT } = require('../services/tabbyClearing/tabbyClearingStore')
const { createTabbySources } = require('../services/tabbyClearing/tabbyClearingSources')
const { buildTabbyPreview, publicPreview } = require('../services/tabbyClearing/tabbyClearingPreviewService')
const { startPostingJob, getPostingJob } = require('../services/tabbyClearing/tabbyClearingJobService')
const zohoChecks = require('../services/tabbyClearing/tabbyClearingZoho')

let deps = null

function getDeps() {
  if (!deps) {
    const db = require('../db')
    deps = {
      store: createPgTabbyStore(db.pool),
      sources: createTabbySources(),
      writer: require('../services/tabbyClearing/tabbyClearingZohoWriter'),
    }
  }
  return deps
}

/** Test hook. */
function setDeps(next) {
  deps = next
}

function actorOf(req) {
  return req.user && req.user.userId ? `user:${req.user.userId}` : null
}

function sendError(res, err, label) {
  const status = err.status || 500
  if (status >= 500) console.error(`[tabby-clearing] ${label} failed:`, err.code || '', err.message)
  return res.status(status).json({
    error: err.message || `Tabby ${label} failed.`,
    code: err.code || undefined,
    problems: err.problems || undefined,
    existing: err.existing || undefined,
    preview: err.preview || undefined,
  })
}

function badRequest(code, message, extra = {}) {
  const err = new Error(message)
  err.status = 400
  err.code = code
  Object.assign(err, extra)
  return err
}

async function listBatches(_req, res) {
  try {
    const { store } = getDeps()
    return res.json({ batches: await store.listBatches({ limit: 200 }), postingEnabled: getTabbyClearingConfig().postingEnabled })
  } catch (err) {
    return sendError(res, err, 'batch list')
  }
}

async function upload(req, res) {
  try {
    const file = req.file
    if (!file || !file.buffer || !file.buffer.length) throw badRequest('FILE_REQUIRED', 'Upload the Tabby settlement report (.xlsx).')
    if (!/\.xlsx$/i.test(file.originalname || '')) throw badRequest('FILE_TYPE', 'The Tabby settlement report must be an .xlsx file.')
    const config = getTabbyClearingConfig()
    const parsed = parseTabbyStatement(file.buffer, { fileName: file.originalname })
    const fatal = parsed.problems.filter((p) => ['FILE_UNREADABLE', 'HEADERS_NOT_FOUND', 'STATEMENT_NUMBER_MISSING', 'STATEMENT_NOT_RECOGNIZED', 'MISSING_REQUIRED_HEADER'].includes(p.code))
    if (fatal.length) throw badRequest('STATEMENT_UNREADABLE', fatal.map((p) => p.message).join(' '), { problems: parsed.problems })
    const analysis = model.analyzeStatement(parsed, config)
    const { store, sources } = getDeps()
    const imported = await store.importStatement({ parsed, analysis, fileName: file.originalname, actor: actorOf(req) })
    if (imported.result === IMPORT_RESULT.STATEMENT_VERSION_CONFLICT) {
      const err = new Error(`${parsed.statement.statementNumber} was already imported from a different file (${imported.batch.fileName || 'unknown'}, SHA-256 ${imported.batch.fileHash.slice(0, 12)}…); this file (${parsed.fileHash.slice(0, 12)}…) was not imported.`)
      err.status = 409
      err.code = IMPORT_RESULT.STATEMENT_VERSION_CONFLICT
      err.existing = { batchId: imported.batch.id, fileName: imported.batch.fileName, fileHash: imported.batch.fileHash, uploadedHash: parsed.fileHash }
      throw err
    }
    const preview = await buildTabbyPreview({ batchId: imported.batch.id, store, sources, config })
    return res.status(imported.result === IMPORT_RESULT.IMPORTED ? 201 : 200).json({ result: imported.result, batchId: imported.batch.id, preview: publicPreview(preview) })
  } catch (err) {
    return sendError(res, err, 'upload')
  }
}

async function getPreview(req, res) {
  try {
    const { store, sources } = getDeps()
    const preview = await buildTabbyPreview({ batchId: req.params.id, store, sources, config: getTabbyClearingConfig(), deep: req.query.deep === '1' })
    return res.json({ preview: publicPreview(preview) })
  } catch (err) {
    return sendError(res, err, 'preview')
  }
}

/** Starts posting in the background (202); the page polls GET /batches/:id/post-job. */
async function post(req, res) {
  try {
    const { store, sources, writer } = getDeps()
    const job = await startPostingJob({
      batchId: req.params.id,
      store,
      sources,
      writer,
      config: getTabbyClearingConfig(),
      actor: actorOf(req),
      fingerprint: req.body && req.body.fingerprint,
    })
    return res.status(202).json({ job })
  } catch (err) {
    if (err && err.code === 'POSTING_IN_PROGRESS') return res.status(409).json({ error: err.message, code: err.code, job: err.job })
    return sendError(res, err, 'posting')
  }
}

async function getPostJob(req, res) {
  try {
    const { store } = getDeps()
    return res.json({ job: await getPostingJob({ batchId: req.params.id, store }) })
  } catch (err) {
    return sendError(res, err, 'posting status')
  }
}

async function getActivity(req, res) {
  try {
    const { store } = getDeps()
    const batch = await store.getBatch(req.params.id)
    if (!batch) return res.status(404).json({ error: 'Batch not found.', code: 'BATCH_NOT_FOUND' })
    return res.json({ events: await store.listEvents(req.params.id), components: await store.listComponents(req.params.id) })
  } catch (err) {
    return sendError(res, err, 'activity')
  }
}

async function getAccounts(_req, res) {
  try {
    const { store, sources } = getDeps()
    const chart = await sources.listChartAccounts()
    const mappings = await store.listAccountMappings()
    const { accounts, problems } = zohoChecks.resolveAccounts(chart, mappings, ACCOUNT_ROLES)
    return res.json({
      roles: ACCOUNT_ROLES.map((r) => ({ role: r.role, label: r.label, types: r.types, resolved: accounts[r.role] || null, problem: problems.find((p) => p.role === r.role) || null, mapping: mappings.find((m) => m.role === r.role) || null })),
      chartAccounts: chart.filter((a) => a.isActive !== false).map((a) => ({ accountId: a.accountId, accountName: a.accountName, accountCode: a.accountCode || '', accountType: a.accountType })),
    })
  } catch (err) {
    return sendError(res, err, 'account mapping')
  }
}

async function putAccount(req, res) {
  try {
    const role = ACCOUNT_ROLES.find((r) => r.role === req.params.role)
    if (!role) throw badRequest('ROLE_UNKNOWN', `Unknown account role ${req.params.role}.`)
    const accountId = String((req.body && req.body.accountId) || '').trim()
    if (!accountId) throw badRequest('ACCOUNT_REQUIRED', 'Choose a Zoho account.')
    const { store, sources } = getDeps()
    const chart = await sources.listChartAccounts()
    const account = chart.find((a) => a.accountId === accountId)
    if (!account || account.isActive === false) throw badRequest('ACCOUNT_NOT_FOUND', 'That account is not an active account in the Zoho chart of accounts.')
    if (!role.types.includes(String(account.accountType).toLowerCase())) throw badRequest('ACCOUNT_TYPE_INVALID', `${account.accountName} is a ${account.accountType} account; ${role.label} needs ${role.types.join(' / ')}.`)
    const saved = await store.saveAccountMapping({ role: role.role, accountId, accountName: account.accountName, accountCode: account.accountCode, accountType: account.accountType }, actorOf(req))
    return res.json({ mapping: saved })
  } catch (err) {
    return sendError(res, err, 'account mapping')
  }
}

async function deleteAccount(req, res) {
  try {
    const role = ACCOUNT_ROLES.find((r) => r.role === req.params.role)
    if (!role) throw badRequest('ROLE_UNKNOWN', `Unknown account role ${req.params.role}.`)
    await getDeps().store.deleteAccountMapping(role.role, actorOf(req))
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err, 'account mapping')
  }
}

/** Admin picks which existing Zoho transfer settles an ambiguous bank payout (local link only). */
async function postBankMatch(req, res) {
  try {
    const transactionId = String((req.body && req.body.transactionId) || '').trim()
    if (!transactionId) throw badRequest('TRANSACTION_REQUIRED', 'Choose the Zoho bank transaction.')
    const { store, sources } = getDeps()
    const config = getTabbyClearingConfig()
    const preview = await buildTabbyPreview({ batchId: req.params.id, store, sources, config, persist: false })
    const candidate = (preview.bank.candidates || []).find((t) => t.transactionId === transactionId)
    if (!candidate) throw badRequest('TRANSACTION_NOT_A_CANDIDATE', 'That Zoho transaction is not a transfer of this payout amount between Tabby Undeposited Funds and the bank.')
    await store.setBankMatch(req.params.id, { status: model.BANK_STATUS.BANK_MATCHED, transactionId, evidence: { ...candidate, chosenBy: actorOf(req) }, actor: actorOf(req) })
    const after = await buildTabbyPreview({ batchId: req.params.id, store, sources, config })
    return res.json({ preview: publicPreview(after) })
  } catch (err) {
    return sendError(res, err, 'bank match')
  }
}

module.exports = { listBatches, upload, getPreview, post, getPostJob, getActivity, getAccounts, putAccount, deleteAccount, postBankMatch, setDeps }
