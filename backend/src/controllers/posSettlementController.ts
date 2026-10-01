'use strict'

/**
 * Mashreq POS settlement clearing API (admin only).
 * Upload → parse → import (file hash + transaction identity) → preview (RRN match, channel,
 * invoices, plan, bank) → approve the exact preview → guarded background "Post to Zoho".
 * Manual invoice mappings, terminal → channel mappings, account mappings and bank links are
 * local decisions with an audit trail; Zoho is re-read before anything is posted.
 */

const { getPosSettlementConfig, POS_ACCOUNT_ROLES, POS_CHANNEL, SOURCE_FORMAT } = require('../config/posSettlement.ts')
const { createPgPosStore, IMPORT_RESULT } = require('../services/posSettlement/posSettlementStore.ts')
const { createDefaultPosSources } = require('../services/posSettlement/posSettlementSources.ts')
const { importPosFile } = require('../services/posSettlement/posSettlementImportService.ts')
const { buildPosPreview, publicPreview } = require('../services/posSettlement/posSettlementPreviewService.ts')
const { approvePosSettlement, revokeApproval } = require('../services/posSettlement/posSettlementPostingService.ts')
const { startPostingJob, getPostingJob } = require('../services/posSettlement/posSettlementJobService.ts')
const posZoho = require('../services/posSettlement/posSettlementZoho.ts')
const model = require('../services/posSettlement/posSettlementModel.ts')
const { majorToFils, formatFils, parseMoneyToFils } = require('../services/posSettlement/posMoney.ts')
const tabbyZoho = require('../services/tabbyClearing/tabbyClearingZoho')

type Req = any
type Res = any

let deps: any = null

function getDeps() {
  if (!deps) {
    const db = require('../db')
    deps = {
      store: createPgPosStore(db.pool),
      sources: createDefaultPosSources(),
      writer: require('../services/posSettlement/posSettlementZohoWriter.ts'),
    }
  }
  return deps
}

/** Test hook. */
function setDeps(next: any) {
  deps = next
}

function actorOf(req: Req): string | null {
  return req.user && req.user.userId ? `user:${req.user.userId}` : null
}

function sendError(res: Res, err: any, label: string) {
  const status = err.status || 500
  if (status >= 500) console.error(`[pos-settlement] ${label} failed:`, err.code || '', err.message)
  return res.status(status).json({ error: err.message || `POS ${label} failed.`, code: err.code || undefined, problems: err.problems || undefined, preview: err.preview || undefined, job: err.job || undefined })
}

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}) {
  const err: any = new Error(message)
  err.status = 400
  err.code = code
  return Object.assign(err, extra)
}

const text = (v: unknown) => (v == null ? '' : String(v).trim())

async function listSettlements(_req: Req, res: Res) {
  try {
    const { store } = getDeps()
    const config = getPosSettlementConfig()
    return res.json({ settlements: await store.listSettlements({ limit: 200 }), files: await store.listFiles({ limit: 50 }), postingEnabled: config.postingEnabled, sourceFormats: Object.values(SOURCE_FORMAT) })
  } catch (err) {
    return sendError(res, err, 'settlement list')
  }
}

async function upload(req: Req, res: Res) {
  try {
    const file = req.file
    if (!file || !file.buffer || !file.buffer.length) throw badRequest('FILE_REQUIRED', 'Upload the Mashreq settlement file.')
    const sourceFormat = text(req.body && req.body.sourceFormat) || SOURCE_FORMAT.ENRICH_CSV
    if (!Object.values(SOURCE_FORMAT).includes(sourceFormat)) throw badRequest('FORMAT_UNKNOWN', `Unknown source format ${sourceFormat}.`)
    if (!/\.(csv|txt|tsv)$/i.test(file.originalname || '')) throw badRequest('FILE_TYPE', 'Mashreq files must be .csv, .txt or .tsv exports.')
    const { store } = getDeps()
    const config = getPosSettlementConfig()
    const imported = await importPosFile({ buffer: file.buffer, fileName: file.originalname, sourceFormat, store, config, actor: actorOf(req) })
    return res.status(imported.result === IMPORT_RESULT.IMPORTED ? 201 : 200).json(imported)
  } catch (err) {
    return sendError(res, err, 'upload')
  }
}

async function getPreview(req: Req, res: Res) {
  try {
    const { store, sources } = getDeps()
    const preview = await buildPosPreview({ settlementId: req.params.id, store, sources, config: getPosSettlementConfig(), deep: req.query.deep === '1', deepScan: req.query.deepScan === '1' })
    return res.json({ preview: publicPreview(preview) })
  } catch (err) {
    return sendError(res, err, 'preview')
  }
}

async function approve(req: Req, res: Res) {
  try {
    const { store, sources } = getDeps()
    const out = await approvePosSettlement({ settlementId: req.params.id, store, sources, config: getPosSettlementConfig(), actor: actorOf(req), fingerprint: req.body && req.body.fingerprint, note: req.body && req.body.note })
    return res.json(out)
  } catch (err) {
    return sendError(res, err, 'approval')
  }
}

async function deleteApproval(req: Req, res: Res) {
  try {
    await revokeApproval({ settlementId: req.params.id, store: getDeps().store, actor: actorOf(req), reason: text((req.body && req.body.reason) || req.query.reason) })
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err, 'approval')
  }
}

async function post(req: Req, res: Res) {
  try {
    const { store, sources, writer } = getDeps()
    const job = await startPostingJob({ settlementId: req.params.id, store, sources, writer, config: getPosSettlementConfig(), actor: actorOf(req), fingerprint: req.body && req.body.fingerprint })
    return res.status(202).json({ job })
  } catch (err) {
    return sendError(res, err, 'posting')
  }
}

async function getPostJob(req: Req, res: Res) {
  try {
    return res.json({ job: await getPostingJob({ settlementId: req.params.id, store: getDeps().store }) })
  } catch (err) {
    return sendError(res, err, 'posting status')
  }
}

async function getActivity(req: Req, res: Res) {
  try {
    const { store } = getDeps()
    const s = await store.getSettlement(req.params.id)
    if (!s) return res.status(404).json({ error: 'Settlement not found.', code: 'SETTLEMENT_NOT_FOUND' })
    return res.json({ events: await store.listEvents(req.params.id), components: await store.listComponents(req.params.id) })
  } catch (err) {
    return sendError(res, err, 'activity')
  }
}

async function resolvedAccounts(store: any, sources: any) {
  const chart = await sources.listChartAccounts()
  const mappings = await store.listAccountMappings()
  return { chart, mappings, ...tabbyZoho.resolveAccounts(chart, mappings, POS_ACCOUNT_ROLES) }
}

/** Link an existing Zoho transfer (POS Undeposited → RAK, exactly the payout net) to the payout. */
async function postBankLink(req: Req, res: Res) {
  try {
    const transactionId = text(req.body && req.body.transactionId)
    if (!transactionId) throw badRequest('TRANSACTION_REQUIRED', 'Choose the Zoho bank transaction.')
    const { store, sources } = getDeps()
    const config = getPosSettlementConfig()
    const before = await buildPosPreview({ settlementId: req.params.id, store, sources, config, persist: false, refreshIndex: false })
    const { accounts } = await resolvedAccounts(store, sources)
    const check = await posZoho.checkManualBankLink({ sources, accounts, transactionId, amountMinor: majorToFils(before.totals.net) })
    if (!check.ok) throw badRequest('BANK_LINK_INVALID', check.message)
    await store.setBankMatch(req.params.id, { status: model.BANK_STATUS.BANK_MATCHED, transactionId, evidence: { ...check.transaction, chosenBy: actorOf(req) }, actor: actorOf(req) })
    const after = await buildPosPreview({ settlementId: req.params.id, store, sources, config, refreshIndex: false })
    return res.json({ preview: publicPreview(after) })
  } catch (err) {
    return sendError(res, err, 'bank link')
  }
}

async function deleteBankLink(req: Req, res: Res) {
  try {
    const { store } = getDeps()
    await store.setBankMatch(req.params.id, { status: null, transactionId: null, evidence: null, actor: actorOf(req) })
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err, 'bank link')
  }
}

async function dismissConflict(req: Req, res: Res) {
  try {
    const reason = text(req.body && req.body.reason)
    if (reason.length < 5) throw badRequest('REASON_REQUIRED', 'Explain why the earlier values are correct.')
    const t = await getDeps().store.dismissConflict(req.params.id, { reason, actor: actorOf(req) })
    return res.json({ transaction: t })
  } catch (err) {
    return sendError(res, err, 'conflict')
  }
}

async function searchInvoices(req: Req, res: Res) {
  try {
    const q = text(req.query.q)
    if (q.length < 3) throw badRequest('QUERY_TOO_SHORT', 'Type at least 3 characters (invoice number, order number or customer).')
    return res.json({ invoices: await getDeps().sources.searchInvoices(q) })
  } catch (err) {
    return sendError(res, err, 'invoice search')
  }
}

/**
 * Save a manual mapping: one transaction → one or more invoices of ONE customer, amounts summing
 * to the transaction gross, each within the invoice's live balance. The automatic result, the
 * user, time and reason are kept; posting re-validates everything against Zoho again.
 */
async function postManualMapping(req: Req, res: Res) {
  try {
    const { store, sources } = getDeps()
    const config = getPosSettlementConfig()
    const txn = await store.getTransaction(req.params.id)
    if (!txn) return res.status(404).json({ error: 'Transaction not found.', code: 'TRANSACTION_NOT_FOUND' })
    if (txn.status !== model.TXN_STATUS.ACTIVE) throw badRequest('TRANSACTION_INACTIVE', `Transaction ${txn.rrn} is ${txn.status}.`)
    const reason = text(req.body && req.body.reason)
    if (reason.length < 5) throw badRequest('REASON_REQUIRED', 'Give the reason for the manual mapping.')
    const input = Array.isArray(req.body && req.body.allocations) ? req.body.allocations : []
    if (!input.length) throw badRequest('ALLOCATIONS_REQUIRED', 'Choose at least one invoice.')
    const allocations = []
    const problems: string[] = []
    for (const a of input) {
      const inv = await sources.getInvoice(text(a.invoiceId), { critical: true })
      if (!inv) {
        problems.push(`Invoice ${text(a.invoiceId)} was not found in Zoho.`)
        continue
      }
      const parsed = parseMoneyToFils(a.amount == null ? '' : String(a.amount))
      if (!parsed.ok) {
        problems.push(`${inv.invoiceNumber}: amount ${a.amount} is not a valid amount (${parsed.reason}).`)
        continue
      }
      const grossMinor: number = parsed.fils
      if (!(grossMinor > 0)) problems.push(`${inv.invoiceNumber}: amount must be positive.`)
      if (inv.status === 'void' || inv.status === 'draft') problems.push(`${inv.invoiceNumber} is ${inv.status}.`)
      if (inv.currencyCode !== config.currency) problems.push(`${inv.invoiceNumber} is in ${inv.currencyCode}.`)
      if (grossMinor > inv.balanceMinor) problems.push(`${inv.invoiceNumber}: ${formatFils(grossMinor)} is more than its open balance ${formatFils(inv.balanceMinor)}.`)
      allocations.push({ invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, customerId: inv.customerId, customerName: inv.customerName, grossMinor })
    }
    if (new Set(allocations.map((a) => a.customerId)).size > 1) problems.push('All invoices must belong to the same Zoho customer; one POS transaction never pays two customers.')
    const sum = allocations.reduce((s, a) => s + a.grossMinor, 0)
    if (sum !== txn.minor.gross) problems.push(`Allocations total ${formatFils(sum)}, the transaction is ${formatFils(txn.minor.gross)}.`)
    if (problems.length) throw badRequest('MAPPING_INVALID', problems.join(' '), { problems: problems.map((message) => ({ code: 'MAPPING_INVALID', message })) })
    const hits = txn.rrn ? await store.findInvoicesByRrns(config.organizationId, [txn.rrn]) : []
    const auto = model.matchTransaction({ txn, rrnHits: hits.filter((i: any) => i.rrns.includes(txn.rrn)), manual: null, config })
    const s = txn.payoutId ? await store.getSettlement(txn.payoutId) : null
    const saved = await store.saveManualMapping({ transactionId: txn.id, rrn: txn.rrn, allocations, autoResult: { status: auto.status, reason: auto.reason, at: new Date().toISOString() }, reason, actor: actorOf(req), settlementId: txn.payoutId, settlementCode: s && s.settlementCode })
    return res.status(201).json({ mapping: saved })
  } catch (err) {
    return sendError(res, err, 'manual mapping')
  }
}

async function getManualMappings(req: Req, res: Res) {
  try {
    return res.json({ mappings: await getDeps().store.listManualMappingHistory(req.params.id) })
  } catch (err) {
    return sendError(res, err, 'manual mapping')
  }
}

async function deleteManualMapping(req: Req, res: Res) {
  try {
    const reason = text((req.body && req.body.reason) || req.query.reason)
    if (reason.length < 5) throw badRequest('REASON_REQUIRED', 'Give the reason for revoking the mapping.')
    const { store } = getDeps()
    const m = await store.revokeManualMapping(req.params.id, { reason, actor: actorOf(req) })
    return res.json({ mapping: m })
  } catch (err) {
    return sendError(res, err, 'manual mapping')
  }
}

async function getTerminals(_req: Req, res: Res) {
  try {
    const config = getPosSettlementConfig()
    return res.json({ terminals: await getDeps().store.listTerminalMappings({ provider: config.provider }), channels: Object.values(POS_CHANNEL) })
  } catch (err) {
    return sendError(res, err, 'terminal mapping')
  }
}

async function postTerminal(req: Req, res: Res) {
  try {
    const config = getPosSettlementConfig()
    const merchantId = text(req.body && req.body.merchantId)
    const terminalId = text(req.body && req.body.terminalId) || null
    const channel = text(req.body && req.body.channel)
    if (!merchantId) throw badRequest('MERCHANT_REQUIRED', 'Merchant ID (MID) is required.')
    if (!Object.values(POS_CHANNEL).includes(channel)) throw badRequest('CHANNEL_UNKNOWN', `Channel must be one of ${Object.values(POS_CHANNEL).join(', ')}.`)
    const saved = await getDeps().store.saveTerminalMapping({ provider: config.provider, merchantId, terminalId, channel, location: text(req.body.location) || null, notes: text(req.body.notes) || null }, actorOf(req))
    return res.status(201).json({ terminal: saved })
  } catch (err) {
    return sendError(res, err, 'terminal mapping')
  }
}

async function deleteTerminal(req: Req, res: Res) {
  try {
    await getDeps().store.removeTerminalMapping(req.params.id, actorOf(req))
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err, 'terminal mapping')
  }
}

async function getAccounts(_req: Req, res: Res) {
  try {
    const { store, sources } = getDeps()
    const { chart, mappings, accounts, problems } = await resolvedAccounts(store, sources)
    return res.json({
      roles: POS_ACCOUNT_ROLES.map((r: any) => ({ role: r.role, label: r.label, types: r.types, resolved: accounts[r.role] || null, problem: problems.find((p: any) => p.role === r.role) || null, mapping: mappings.find((m: any) => m.role === r.role) || null })),
      chartAccounts: chart.filter((a: any) => a.isActive !== false).map((a: any) => ({ accountId: a.accountId, accountName: a.accountName, accountCode: a.accountCode || '', accountType: a.accountType })),
    })
  } catch (err) {
    return sendError(res, err, 'account mapping')
  }
}

async function putAccount(req: Req, res: Res) {
  try {
    const role = POS_ACCOUNT_ROLES.find((r: any) => r.role === req.params.role)
    if (!role) throw badRequest('ROLE_UNKNOWN', `Unknown account role ${req.params.role}.`)
    const accountId = text(req.body && req.body.accountId)
    if (!accountId) throw badRequest('ACCOUNT_REQUIRED', 'Choose a Zoho account.')
    const { store, sources } = getDeps()
    const chart = await sources.listChartAccounts()
    const account = chart.find((a: any) => a.accountId === accountId)
    if (!account || account.isActive === false) throw badRequest('ACCOUNT_NOT_FOUND', 'That account is not an active account in the Zoho chart of accounts.')
    if (!role.types.includes(String(account.accountType).toLowerCase())) throw badRequest('ACCOUNT_TYPE_INVALID', `${account.accountName} is a ${account.accountType} account; ${role.label} needs ${role.types.join(' / ')}.`)
    if (['1019', '1013', '2270'].includes(account.accountCode)) throw badRequest('FORBIDDEN_ACCOUNT', `${account.accountName} is a Stripe clearing account and cannot carry POS money.`)
    const saved = await store.saveAccountMapping({ role: role.role, accountId, accountName: account.accountName, accountCode: account.accountCode, accountType: account.accountType }, actorOf(req))
    return res.json({ mapping: saved })
  } catch (err) {
    return sendError(res, err, 'account mapping')
  }
}

async function deleteAccount(req: Req, res: Res) {
  try {
    const role = POS_ACCOUNT_ROLES.find((r: any) => r.role === req.params.role)
    if (!role) throw badRequest('ROLE_UNKNOWN', `Unknown account role ${req.params.role}.`)
    await getDeps().store.deleteAccountMapping(role.role, actorOf(req))
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err, 'account mapping')
  }
}

module.exports = {
  listSettlements,
  upload,
  getPreview,
  approve,
  deleteApproval,
  post,
  getPostJob,
  getActivity,
  postBankLink,
  deleteBankLink,
  dismissConflict,
  searchInvoices,
  postManualMapping,
  getManualMappings,
  deleteManualMapping,
  getTerminals,
  postTerminal,
  deleteTerminal,
  getAccounts,
  putAccount,
  deleteAccount,
  setDeps,
}
