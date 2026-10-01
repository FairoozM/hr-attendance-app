#!/usr/bin/env node
/**
 * Read-only dry run of Mashreq POS settlement clearing against the real Zoho organisation.
 *
 * Imports a Mashreq file (default: a SYNTHETIC 5 Sep 2026 Enrich CSV built from the two RRNs on
 * INV-043659 / INV-043660 and the user's totals 330.65 / 6.10 / 0.31 / 324.24) into an in-memory
 * store, builds the full preview (RRN index, matching, channel, invoice state, bank, fees, plan,
 * ledger), records a local approval, and checks the posting gate.
 *
 * Safety: every Zoho Books request goes through a GET-only transport (any other method throws);
 * the writer is a stub that throws; no application database is touched (memory store). The only
 * non-GET network call is the OAuth token refresh. The website database, when configured, is
 * read with SELECTs only.
 *
 * Usage: node backend/scripts/pos-settlement-dry-run.ts [--file path.csv] [--format ENRICH_CSV] [--no-website-db] [--deep]
 */
declare const require: (id: string) => any
declare const process: { argv: string[]; exitCode: number | undefined; env: Record<string, string | undefined> }
declare const __dirname: string

const path = require('path')
const fs = require('fs')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getZohoAccessToken } = require('../src/integrations/zoho/zohoOAuth')
const { readZohoConfig } = require('../src/integrations/zoho/zohoConfig')
const { httpsRequestJson } = require('../src/integrations/zoho/zohoHttp')
const { getPosSettlementConfig } = require('../src/config/posSettlement.ts')
const { createPosSources, websiteOrderLoader } = require('../src/services/posSettlement/posSettlementSources.ts')
const { createMemoryPosStore } = require('../src/services/posSettlement/posSettlementMemoryStore.ts')
const { importPosFile } = require('../src/services/posSettlement/posSettlementImportService.ts')
const { buildPosPreview } = require('../src/services/posSettlement/posSettlementPreviewService.ts')
const { approvePosSettlement, postPosSettlement } = require('../src/services/posSettlement/posSettlementPostingService.ts')

type Json = Record<string, any>

const MAX_CALLS = 400
const calls = { get: 0, refusedNonGet: 0, byPath: {} as Record<string, number> }
const writerAttempts: string[] = []

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : null
}

/** The only Zoho Books transport in this script: GET, nothing else. */
async function zohoGet(apiPath: string, params: Record<string, string> = {}, opts: { method?: string } = {}): Promise<Json> {
  const method = opts.method || 'GET'
  if (method !== 'GET') {
    calls.refusedNonGet += 1
    throw new Error(`Dry run: ${method} ${apiPath} refused (GET only).`)
  }
  if (++calls.get > MAX_CALLS) throw new Error(`Dry run: call cap ${MAX_CALLS} reached.`)
  const bucket = apiPath.replace(/\/\d{6,}/g, '/:id')
  calls.byPath[bucket] = (calls.byPath[bucket] || 0) + 1
  const c = readZohoConfig()
  const u = new URL(`${c.apiBase}/books/v3${apiPath}`)
  u.searchParams.set('organization_id', c.organizationId)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const token = await getZohoAccessToken()
  const res = await httpsRequestJson(u.toString(), { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeoutMs: 45000 })
  const body = JSON.parse(res.body || '{}')
  if (res.status >= 400) throw Object.assign(new Error(`GET ${apiPath} → ${res.status}: ${body.message || String(res.body).slice(0, 200)}`), { httpStatus: res.status })
  return body
}

const refusingWriter = new Proxy(
  {},
  {
    get: (_t, prop) => async () => {
      writerAttempts.push(String(prop))
      throw Object.assign(new Error(`Dry run: writer.${String(prop)} refused.`), { httpStatus: 400 })
    },
  }
)

// SYNTHETIC: RRNs and gross amounts are the real 5 Sep shop invoices; the per-row commission / VAT
// split is assumed (only the totals 6.10 / 0.31 / 324.24 were given). MID/TID are placeholders.
const SYNTHETIC_5_SEP = [
  'Merchant ID,Terminal ID,RRN,STAN,Auth Code,Transaction Type,Transaction Date,Transaction Amount,Commission,VAT,Net Amount',
  'SYNTH-MID,SYNTH-TID,003042448545,,,PURCHASE,05/09/2026,227.80,4.20,0.21,223.39',
  'SYNTH-MID,SYNTH-TID,003042523578,,,PURCHASE,05/09/2026,102.85,1.90,0.10,100.85',
  'Total,,,,,,,330.65,6.10,0.31,324.24',
].join('\n')

async function main(): Promise<void> {
  const zc = readZohoConfig()
  if (zc.code !== 'ok') throw new Error(`Zoho not configured: ${zc.missing.join(', ')}`)
  const filePath = arg('--file')
  const buffer = filePath ? fs.readFileSync(filePath) : Buffer.from(SYNTHETIC_5_SEP, 'utf8')
  const fileName = filePath ? path.basename(filePath) : 'SYNTHETIC-mashreq-2026-09-05.csv'
  const config = { ...getPosSettlementConfig(), organizationId: zc.organizationId }

  let website: any = null
  let websiteNote = 'disabled (--no-website-db)'
  if (!process.argv.includes('--no-website-db')) {
    try {
      website = websiteOrderLoader()
      websiteNote = website ? 'website database (SELECT only)' : 'website database not configured'
    } catch (err: any) {
      websiteNote = `website database unavailable: ${err.message}`
    }
  }
  const sources = createPosSources({ get: (p: string, params: Record<string, string>) => zohoGet(p, params), loadWebsiteOrders: website })
  const store = createMemoryPosStore()
  const actor = 'dry-run'

  const imported = await importPosFile({ buffer, fileName, sourceFormat: arg('--format') || 'ENRICH_CSV', store, config, actor })
  const settlementId = imported.settlementIds[0]
  if (!settlementId) throw new Error(`Nothing to preview (import result ${imported.result}, role ${imported.role}).`)

  const t0 = Date.now()
  const preview = await buildPosPreview({ settlementId, store, sources, config, now: new Date(), deep: process.argv.includes('--deep') })
  const previewMs = Date.now() - t0
  const callsForPreview = calls.get

  let approval: Json = { skipped: 'preview has blockers' }
  if (preview.canApprove) {
    const a = await approvePosSettlement({ settlementId, store, sources, config, actor, fingerprint: preview.fingerprint })
    approval = { fingerprint: a.approval.fingerprint, by: a.approval.by, storedIn: 'memory store only' }
  }

  // Posting gate as configured on this machine (expected: disabled).
  let gate: Json
  try {
    await postPosSettlement({ settlementId, store, sources, writer: refusingWriter, config, actor, fingerprint: preview.fingerprint })
    gate = { result: 'NOT REFUSED (posting enabled in this environment!)' }
  } catch (err: any) {
    gate = { result: 'refused', status: err.status, code: err.code, message: err.message }
  }

  const report = {
    synthetic: !filePath,
    organizationId: zc.organizationId,
    websiteOrders: websiteNote,
    safety: { zohoGetCalls: calls.get, zohoGetCallsForPreview: callsForPreview, zohoNonGetRequestsRefused: calls.refusedNonGet, writerAttempts, zohoMutations: calls.refusedNonGet + writerAttempts.length === 0 ? 0 : 'see writerAttempts', callsByPath: calls.byPath, previewMs },
    import: { result: imported.result, counts: imported.counts, warnings: imported.warnings },
    settlement: { code: preview.settlementCode, payoutKey: preview.payoutKey, basis: preview.basis, payoutDate: preview.payoutDate, status: preview.status, canApprove: preview.canApprove, canPost: preview.canPost, postingEnabled: preview.postingEnabled },
    totals: preview.totals,
    byChannel: preview.byChannel,
    blockers: preview.blockers,
    warnings: preview.warnings,
    accounts: Object.fromEntries(Object.entries(preview.accounts.resolved).map(([role, a]: any) => [role, `${a.accountName} (${a.accountCode || '—'}) ${a.accountId} via ${a.source}`])),
    transactions: preview.transactions.map((t: any) => ({ rrn: t.rrn, gross: t.gross, commission: t.commission, vat: t.vat, net: t.net, match: t.match.status, invoices: t.match.allocations.map((a: any) => a.invoiceNumber), channel: t.channel, channelSource: t.channelSource, order: t.order, problems: t.problems })),
    invoices: preview.invoices.map((i: any) => ({ invoice: i.invoiceNumber, mode: i.mode, total: i.total, balance: i.balance, gross: i.gross, net: i.net, fee: i.fee, reclass: i.reclass, problem: i.problem })),
    bank: { status: preview.bank.status, reason: preview.bank.reason, matched: preview.bank.matched, window: preview.bank.window },
    feeRecognition: preview.feeRecognition,
    components: preview.components.map((c: any) => ({ component: c.component, reference: c.reference, date: c.date, amount: c.amount, deposit: c.depositAccount, from: c.fromAccount, to: c.toAccount, allocations: c.allocations, lines: c.lines.map((l: any) => `${l.side} ${l.account} ${l.amount.toFixed(2)}`), zoho: c.zoho && c.zoho.state, next: c.recovery.action, payload: c.payload })),
    ledger: preview.ledger,
    rrnIndex: preview.rrnIndex,
    approval,
    postingGate: gate,
  }
  const out = path.join(__dirname, '..', '..', '.repro-tmp', 'pos-dry-run.json')
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(report, null, 2))
  } catch {
    // the report is printed below as well
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err: any) => {
  console.error(`Dry run failed after ${calls.get} GET call(s): ${err && err.message ? err.message : err}`)
  process.exitCode = 1
})
