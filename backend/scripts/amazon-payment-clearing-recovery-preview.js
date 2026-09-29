#!/usr/bin/env node
/**
 * Read-only recovery preview for an Amazon payment clearing batch.
 *
 * Re-fetches every recorded and expected Zoho entry for the batch, compares it with what the
 * clearing flow expects (accounts, amounts, allocations), and rebuilds the credit-note refund
 * plan from live Zoho reads. It never writes: the DB session is forced read-only, Zoho is only
 * reached through a GET-only client (plus the OAuth token refresh), and the app's own Zoho
 * client is disabled by removing its credentials from process.env.
 *
 * Usage:
 *   node scripts/amazon-payment-clearing-recovery-preview.js --batch 40 [--json]
 *     [--zoho-env <file>]   read Zoho credentials from this env file instead of process.env
 *     [--via-tunnel]        DATABASE_URL points at a local tunnel; keep TLS on the RDS name
 *     [--check-customer <id>] also report that Zoho customer's currency (e.g. the KSA customer)
 *     [--zoho-replay <file>] answer Zoho GETs from a JSON dump ({ "<path>?<query>": response });
 *                           requests missing from the dump are written to <file>.missing.json
 *                           (exit code 3) so they can be fetched GET-only where the credentials live
 */
const path = require('path')
const fs = require('fs')
const dns = require('dns')

const BACKEND = path.resolve(__dirname, '..')
require(path.join(BACKEND, 'node_modules/dotenv')).config({ path: path.join(BACKEND, '.env') })

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const BATCH_ID = Number(argValue('--batch'))
const AS_JSON = process.argv.includes('--json')
if (!Number.isInteger(BATCH_ID) || BATCH_ID <= 0) {
  console.error('Usage: --batch <id> is required')
  process.exit(2)
}

function readEnvFile(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
      })
  )
}

// ---- Zoho: capture credentials privately, then disable the app client --------------------------
const zohoSource = argValue('--zoho-env') ? readEnvFile(argValue('--zoho-env')) : { ...process.env }
const ZOHO = {
  accounts: (zohoSource.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com').replace(/\/+$/, ''),
  apiBase: (zohoSource.ZOHO_API_BASE_URL || zohoSource.ZOHO_BASE_URL || 'https://www.zohoapis.com')
    .replace(/\/+$/, '')
    .replace(/\/(inventory|books)\/v\d+$/, ''),
  org: zohoSource.ZOHO_ORGANIZATION_ID || zohoSource.ZOHO_INVENTORY_ORGANIZATION_ID,
  refreshToken: zohoSource.ZOHO_REFRESH_TOKEN,
  clientId: zohoSource.ZOHO_CLIENT_ID,
  clientSecret: zohoSource.ZOHO_CLIENT_SECRET,
}
for (const key of Object.keys(process.env)) if (key.startsWith('ZOHO_')) delete process.env[key]

const TOKEN_URL = `${ZOHO.accounts}/oauth/v2/token`
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url || '')
  const method = String(init.method || input?.method || 'GET').toUpperCase()
  if (method !== 'GET' && !(method === 'POST' && url === TOKEN_URL)) {
    throw new Error(`recovery preview is read-only: blocked ${method} ${url.split('?')[0]}`)
  }
  return realFetch(input, init)
}

// ---- DB: force a read-only session ------------------------------------------------------------
{
  const u = new URL(process.env.DATABASE_URL)
  if (process.argv.includes('--via-tunnel') && process.env.DATABASE_TLS_SERVERNAME) {
    const rds = process.env.DATABASE_TLS_SERVERNAME
    const tunnelHost = u.hostname
    u.hostname = rds
    const origLookup = dns.lookup
    dns.lookup = (host, opts, cb) => {
      if (typeof opts === 'function') {
        cb = opts
        opts = {}
      }
      if (host === rds) return opts && opts.all ? cb(null, [{ address: tunnelHost, family: 4 }]) : cb(null, tunnelHost, 4)
      return origLookup(host, opts, cb)
    }
  }
  u.searchParams.set('options', '-c default_transaction_read_only=on')
  process.env.DATABASE_URL = u.toString()
}

const REPLAY_FILE = argValue('--zoho-replay')
const replay = REPLAY_FILE && fs.existsSync(REPLAY_FILE) ? JSON.parse(fs.readFileSync(REPLAY_FILE, 'utf8')) : REPLAY_FILE ? {} : null
const replayMissing = new Set()

function zohoRequestKey(pathname, params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (v != null && v !== '') q.set(k, String(v))
  }
  return `${pathname}?${q}`
}

let accessToken = ''
async function zohoToken() {
  if (replay) return
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      refresh_token: ZOHO.refreshToken,
      client_id: ZOHO.clientId,
      client_secret: ZOHO.clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`Zoho token refresh failed: ${j.error || r.status}`)
  accessToken = j.access_token
}

let getCount = 0
async function zohoGet(pathname, params = {}) {
  if (replay) {
    const key = zohoRequestKey(pathname, params)
    getCount += 1
    if (!(key in replay)) {
      replayMissing.add(key)
      return null
    }
    const entry = replay[key]
    if (entry && entry.__http === 404) return null
    if (entry && entry.__http) {
      const err = new Error(`Zoho GET ${pathname} failed: HTTP ${entry.__http} ${entry.code || ''} ${entry.message || ''}`.trim())
      err.httpStatus = entry.__http
      throw err
    }
    return entry
  }
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v))
  q.set('organization_id', ZOHO.org)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    getCount += 1
    const r = await fetch(`${ZOHO.apiBase}/books/v3${pathname}?${q}`, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'User-Agent': 'lifesmile-zoho-client' },
    })
    if (r.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)))
      continue
    }
    const j = await r.json().catch(() => ({}))
    if (r.status === 404) return null
    if (!r.ok) {
      const err = new Error(`Zoho GET ${pathname} failed: HTTP ${r.status} ${j.code || ''} ${j.message || ''}`.trim())
      err.httpStatus = r.status
      throw err
    }
    return j
  }
  throw new Error(`Zoho GET ${pathname} rate limited`)
}

async function zohoListAll(pathname, key, params = {}) {
  const rows = []
  for (let page = 1; page <= 10; page += 1) {
    const j = await zohoGet(pathname, { per_page: 200, ...params, page })
    rows.push(...(j?.[key] || []))
    if (!j?.page_context?.has_more_page) return rows
  }
  throw new Error(`Zoho ${pathname} returned more than 10 pages`)
}

const zohoLookup = {
  listCustomerPayments: (params) => zohoListAll('/customerpayments', 'customerpayments', params),
  getCustomerPayment: async (id) => (await zohoGet(`/customerpayments/${encodeURIComponent(id)}`))?.payment || null,
  listJournals: (params) => zohoListAll('/journals', 'journals', params),
  getJournal: async (id) => (await zohoGet(`/journals/${encodeURIComponent(id)}`))?.journal || null,
  listCreditNotes: (params) => zohoListAll('/creditnotes', 'creditnotes', params),
  listCreditNoteRefunds: async (id) =>
    (await zohoGet(`/creditnotes/${encodeURIComponent(id)}/refunds`))?.creditnote_refunds || [],
  getCreditNoteRefund: async (cn, id) =>
    (await zohoGet(`/creditnotes/${encodeURIComponent(cn)}/refunds/${encodeURIComponent(id)}`))?.creditnote_refund || null,
}

// ---- App modules (loaded after the guards are installed) ---------------------------------------
const store = require(path.join(BACKEND, 'src/services/amazonPaymentClearingStore'))
const posting = require(path.join(BACKEND, 'src/services/amazonPaymentClearingPostingService'))
const recovery = require(path.join(BACKEND, 'src/services/amazonPaymentClearingZohoRecovery'))
const cnService = require(path.join(BACKEND, 'src/services/amazonPaymentClearingCreditNotePostingService'))
const guard = require(path.join(BACKEND, 'src/services/amazonPaymentClearingAccountGuard'))
const { settlementCurrencyForCustomer } = require(path.join(BACKEND, 'src/services/amazonPaymentClearingCurrencyService'))

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const clean = (v) => String(v ?? '').trim()

async function main() {
  await zohoToken()
  const raw = await store.getBatchById(BATCH_ID)
  if (!raw) throw new Error(`Batch ${BATCH_ID} not found`)
  const marketplace = guard.requireMarketplaceCode(raw.marketplace)
  const batch = { ...raw, marketplace }
  const clearing = guard.resolveMarketplaceClearingAccounts(marketplace, { env: process.env })
  const accounts = {
    undeposited: clearing.accounts?.UNDEPOSITED?.accountId || '',
    commission: clearing.accounts?.COMMISSION?.accountId || '',
    shipping: clearing.accounts?.SHIPPING_FBA?.accountId || '',
  }
  const otherMarketplace = marketplace === 'UAE' ? 'KSA' : 'UAE'
  const otherIds = new Set(
    Object.values(guard.resolveMarketplaceClearingAccounts(otherMarketplace, { env: process.env }).accounts || {})
      .map((row) => row?.accountId)
      .filter(Boolean)
  )
  const accountName = new Map()

  const report = {
    batchId: BATCH_ID,
    marketplace,
    batchStatus: raw.status,
    postedToZoho: raw.postedToZoho,
    settlementId: raw.report?.settlementId || raw.settlementId || '',
    expectedAccounts: accounts,
    fieldChecks: {},
    salesPayments: [],
    feeJournals: [],
    creditNotePlan: null,
    proposals: [],
    flags: [],
  }

  const described = posting.describeExpectedEntries(batch, { env: process.env })
  if (described.configProblem) report.flags.push(`Account configuration problem: ${described.configProblem}`)
  report.currencyCode = described.currencyCode
  const postings = await store.listPostingsForBatch(BATCH_ID)
  const byType = new Map(postings.map((row) => [row.paymentType, row]))

  // ---- Sales payments ---------------------------------------------------------------------------
  for (const entry of described.entries.values()) {
    if (entry.group !== 'sales_payment') continue
    const local = byType.get(entry.paymentType) || null
    const expected = { ...entry.expectedFor(local), kind: 'payment', label: 'customer payment' }
    const found = await recovery.lookupCustomerPayment(expected, zohoLookup)
    const ids = new Set(found.candidates.map((c) => c.zohoId))
    const view = {
      paymentType: entry.paymentType,
      amount: entry.amount,
      referenceNumber: entry.referenceNumber,
      expectedAccountId: entry.accountId,
      local: local ? { postingId: local.id, status: local.status, zohoId: local.zohoPaymentId || '' } : null,
      lookupOutcome: found.outcome,
      candidates: [],
    }
    for (const candidate of found.candidates) {
      const detail = await zohoLookup.getCustomerPayment(candidate.zohoId)
      if (detail?.account_id) accountName.set(detail.account_id, detail.account_name)
      if (!report.fieldChecks.paymentCurrencyCode) report.fieldChecks.paymentCurrencyCode = detail && 'currency_code' in detail ? 'present' : 'absent'
      const nonAccountDiffs = candidate.diffs.filter((d) => d.field !== 'account')
      view.candidates.push({
        zohoId: candidate.zohoId,
        paymentNumber: detail?.payment_number || candidate.zohoNumber,
        date: detail?.date,
        amount: detail?.amount,
        accountId: detail?.account_id,
        accountName: detail?.account_name,
        invoiceCount: (detail?.invoices || []).length,
        lastModified: detail?.last_modified_time,
        accountStatus:
          detail?.account_id === entry.accountId
            ? 'correct'
            : otherIds.has(detail?.account_id)
              ? `pending correction (still on ${otherMarketplace} account)`
              : 'pending correction (unexpected account)',
        diffs: candidate.diffs,
        unverified: candidate.unverified,
        matchesExceptAccount: nonAccountDiffs.length === 0 && candidate.unverified.length === 0,
      })
    }
    if (local && local.zohoPaymentId && !ids.has(local.zohoPaymentId)) {
      view.flags = [`Local row points at ${local.zohoPaymentId}, which the reference lookup did not return.`]
    }
    report.salesPayments.push(view)

    const exactOrAccountOnly = view.candidates.filter((c) => c.matchesExceptAccount)
    if (!local && view.candidates.length === 1 && exactOrAccountOnly.length === 1) {
      const c = exactOrAccountOnly[0]
      report.proposals.push({
        paymentType: entry.paymentType,
        zohoId: c.zohoId,
        action:
          c.accountStatus === 'correct'
            ? `Link: POST /postings/link { paymentType: "${entry.paymentType}", zohoId: "${c.zohoId}", reason } — Zoho record already matches exactly.`
            : `After moving Zoho payment ${c.paymentNumber} to ${accountLabel(entry.accountId)}, use Link with zohoId ${c.zohoId}. Linking re-checks Zoho and refuses while the account still differs.`,
      })
    } else if (!local && view.candidates.length > 1) {
      report.proposals.push({
        paymentType: entry.paymentType,
        action: `Do not link: ${view.candidates.length} related Zoho payments exist for this reference. Resolve duplicates in Zoho first.`,
      })
    } else if (!local && view.candidates.length === 0) {
      report.proposals.push({
        paymentType: entry.paymentType,
        action: 'No Zoho payment exists for this entry. It can be posted by resuming step 9 (checks Zoho again first).',
      })
    }
  }

  // ---- Fee journals -----------------------------------------------------------------------------
  const feeExpected = Array.from(described.entries.values()).filter((row) => row.group === 'fee_journal')
  const feeResolver = posting.localJournalRowResolver(postings, 'fee', marketplace, feeExpected)
  for (const entry of feeExpected) {
    const local = feeResolver.find(entry.paymentType)
    const expected = { ...entry.expectedFor(local), kind: 'journal', label: 'manual journal' }
    const result = local?.zohoPaymentId
      ? await recovery.verifyRecordById('journal', local.zohoPaymentId, expected, zohoLookup)
      : await recovery.lookupJournal(expected, zohoLookup)
    const zohoId = local?.zohoPaymentId || result.match?.zohoId || result.candidates[0]?.zohoId || ''
    const detail = zohoId ? await zohoLookup.getJournal(zohoId) : null
    if (detail && !report.fieldChecks.journalCurrencyCode) report.fieldChecks.journalCurrencyCode = 'currency_code' in detail ? 'present' : 'absent'
    const lines = (detail?.line_items || []).map((line) => {
      if (line.account_id) accountName.set(line.account_id, line.account_name)
      return { direction: line.debit_or_credit, accountId: line.account_id, accountName: line.account_name, amount: round2(line.amount) }
    })
    const view = {
      paymentType: entry.paymentType,
      label: entry.label,
      amount: entry.amount,
      referenceNumber: entry.referenceNumber,
      local: local ? { postingId: local.id, paymentType: local.paymentType, status: local.status, zohoId: local.zohoPaymentId || '' } : null,
      zohoJournalNumber: detail?.entry_number || detail?.journal_number || '',
      zohoStatus: detail?.status || '',
      outcome: result.outcome,
      message: result.message,
      expected: { debit: entry.debitAccountId, credit: entry.creditAccountId },
      lines,
    }
    report.feeJournals.push(view)
    if (/safe-?t/i.test(`${entry.label} ${entry.paymentType} ${local?.mappingSnapshot?.feeType || ''}`)) {
      const undepositedLine = lines.find((line) => line.accountId === accounts.undeposited)
      report.flags.push(
        `SAFE-T journal ${view.zohoJournalNumber || zohoId}: Undeposited Funds is ${undepositedLine ? `on the ${undepositedLine.direction} side` : 'not on the journal'}. ` +
          'A SAFE-T reimbursement is money Amazon pays in, which normally debits Undeposited Funds and credits the claim/reimbursement account. ' +
          (undepositedLine?.direction === 'credit'
            ? 'This journal credits Undeposited Funds — confirm the intended direction with accounting before changing the mapping. Not reversed automatically.'
            : 'Direction looks consistent with a reimbursement; confirm with accounting.')
      )
    }
  }
  for (const row of feeResolver.legacy.unmapped) {
    report.flags.push(`Local fee journal row ${row.id} (${row.paymentType}, ${row.amount}) does not map to a current fee journal line.`)
  }
  if (feeResolver.legacy.ambiguous?.length) {
    report.flags.push(`${feeResolver.legacy.ambiguous.length} legacy fee journal row(s) map ambiguously to current lines.`)
  }

  // ---- Credit-note refund plan (live reads, no stubs) --------------------------------------------
  const refundCache = new Map()
  const liveRefunds = async (creditNoteId) => {
    if (!refundCache.has(creditNoteId)) refundCache.set(creditNoteId, await zohoLookup.listCreditNoteRefunds(creditNoteId))
    return refundCache.get(creditNoteId)
  }
  const plan = await cnService.buildCreditNoteApplyPlan(batch, {
    marketplace,
    refreshZoho: false,
    listRefunds: liveRefunds,
    store,
    env: process.env,
  })
  const customerId = described.customerId
  const currency = settlementCurrencyForCustomer(batch.zohoCustomerName, batch.report?.currency, 'AED')
  const cnRows = []
  let refundFieldChecked = false
  for (const row of plan.rows) {
    const cnId = clean(row.zohoCreditNoteId)
    const live = cnId ? (await zohoGet(`/creditnotes/${encodeURIComponent(cnId)}`))?.creditnote || null : null
    const refunds = cnId ? await liveRefunds(cnId) : []
    if (!refundFieldChecked && refunds.length) {
      const detail = await zohoLookup.getCreditNoteRefund(cnId, refunds[0].creditnote_refund_id)
      report.fieldChecks.refundFromAccountId = detail && 'from_account_id' in detail ? 'present' : detail ? 'absent' : 'not returned'
      refundFieldChecked = true
    }
    let createLookup = null
    if (!cnId && String(row.action).startsWith('create_')) {
      createLookup = await recovery.lookupCreditNote(
        { kind: 'credit_note', label: 'credit note', customerId, referenceNumber: clean(row.orderId), amount: row.creditNoteAmount ?? row.refundAmount, currencyCode: currency },
        zohoLookup
      )
    }
    cnRows.push({
      orderId: row.orderId,
      action: row.action,
      amount: round2(row.refundAmount ?? row.applyAmount ?? row.creditNoteAmount),
      invoice: row.zohoInvoiceNumber || '',
      creditNote: live
        ? { id: cnId, number: live.creditnote_number, status: live.status, total: live.total, balance: live.balance, customerMatches: clean(live.customer_id) === clean(customerId) }
        : cnId
          ? { id: cnId, missingInZoho: true }
          : null,
      existingRefunds: refunds.map((r) => ({ id: r.creditnote_refund_id, date: r.date, amount: r.amount, reference: r.reference_number })),
      createLookup: createLookup ? { outcome: createLookup.outcome, message: createLookup.message } : null,
      blockingReason: row.blockingReason || '',
    })
  }
  const willRefund = cnRows.filter((r) => /refund|apply/.test(r.action) && !r.action.startsWith('skipped') && r.action !== 'blocked')
  report.creditNotePlan = {
    summary: plan.summary,
    refundCount: willRefund.length,
    refundTotal: round2(willRefund.reduce((s, r) => s + r.amount, 0)),
    createCount: cnRows.filter((r) => r.action.startsWith('create_')).length,
    createTotal: round2(cnRows.filter((r) => r.action.startsWith('create_')).reduce((s, r) => s + r.amount, 0)),
    blocked: cnRows.filter((r) => r.action === 'blocked').length,
    alreadyRefundedInZoho: cnRows.filter((r) => r.existingRefunds.length > 0).length,
    creditNotesMissingInZoho: cnRows.filter((r) => r.creditNote?.missingInZoho).length,
    creditNotesOnOtherCustomer: cnRows.filter((r) => r.creditNote && r.creditNote.customerMatches === false).length,
    refundAccount: accounts.undeposited,
    rows: cnRows,
  }

  if (!refundFieldChecked && customerId) {
    const closed = (await zohoGet('/creditnotes', { customer_id: customerId, status: 'closed', per_page: 5, page: 1 }))?.creditnotes || []
    for (const note of closed) {
      const refunds = await zohoLookup.listCreditNoteRefunds(note.creditnote_id)
      if (!refunds.length) continue
      const detail = await zohoLookup.getCreditNoteRefund(note.creditnote_id, refunds[0].creditnote_refund_id)
      report.fieldChecks.refundFromAccountId = detail
        ? 'from_account_id' in detail
          ? `present (historic refund on ${note.creditnote_number}: ${detail.from_account_id} ${detail.from_account_name || ''})`.trim()
          : 'absent'
        : 'not returned'
      break
    }
  }
  const checkCustomer = argValue('--check-customer')
  for (const id of [customerId, checkCustomer].filter(Boolean)) {
    const contact = (await zohoGet(`/contacts/${encodeURIComponent(id)}`))?.contact
    report.fieldChecks[`customerCurrency:${id}`] = contact ? `${contact.contact_name} → ${contact.currency_code}` : 'not returned'
  }

  report.zohoGetRequests = getCount
  report.accountNames = Object.fromEntries(accountName)
  if (replayMissing.size) {
    fs.writeFileSync(`${REPLAY_FILE}.missing.json`, JSON.stringify(Array.from(replayMissing), null, 1))
    console.error(`${replayMissing.size} Zoho GET request(s) missing from the replay dump; wrote ${REPLAY_FILE}.missing.json`)
    process.exit(3)
  }
  printReport(report)
  function accountLabel(id) {
    return accountName.get(id) ? `${accountName.get(id)} (${id})` : id
  }
}

function printReport(report) {
  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`Batch ${report.batchId} · ${report.marketplace} · status ${report.batchStatus} · postedToZoho ${report.postedToZoho} · currency ${report.currencyCode}`)
  console.log('Expected clearing accounts:', report.expectedAccounts)
  console.log('\n== Sales payments')
  for (const p of report.salesPayments) {
    console.log(`- ${p.paymentType} ${p.amount} ref ${p.referenceNumber} · local ${p.local ? `${p.local.status} ${p.local.zohoId}` : 'none'} · lookup ${p.lookupOutcome}`)
    for (const c of p.candidates) {
      console.log(`    #${c.paymentNumber} ${c.zohoId} ${c.date} ${c.amount} · ${c.invoiceCount} invoices · ${c.accountName} → ${c.accountStatus}`)
      if (c.diffs.length) console.log(`      diffs: ${c.diffs.map((d) => `${d.field} (expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)})`).join('; ')}`)
      if (c.unverified.length) console.log(`      not returned by Zoho: ${c.unverified.join(', ')}`)
    }
  }
  console.log('\n== Fee journals')
  for (const j of report.feeJournals) {
    console.log(`- ${j.label} ${j.amount} · journal ${j.zohoJournalNumber || '-'} (${j.zohoStatus || '-'}) · ${j.outcome}: ${j.message}`)
    for (const l of j.lines) console.log(`    ${l.direction.padEnd(6)} ${l.amount} ${l.accountName} (${l.accountId})`)
  }
  const cn = report.creditNotePlan
  console.log('\n== Credit-note refund plan (live)')
  console.log(`refund ${cn.refundCount} for ${cn.refundTotal} (of which create-then-refund ${cn.createCount} for ${cn.createTotal}) · blocked ${cn.blocked} · already refunded in Zoho ${cn.alreadyRefundedInZoho} · CN missing in Zoho ${cn.creditNotesMissingInZoho} · CN on other customer ${cn.creditNotesOnOtherCustomer}`)
  console.log('plan summary:', JSON.stringify(cn.summary))
  console.table(
    cn.rows.map((r) => ({
      order: r.orderId,
      action: r.action,
      amount: r.amount,
      cn: r.creditNote ? r.creditNote.number || r.creditNote.id : '-',
      cnStatus: r.creditNote ? (r.creditNote.missingInZoho ? 'MISSING' : `${r.creditNote.status} bal ${r.creditNote.balance}`) : '-',
      refunds: r.existingRefunds.length,
      createLookup: r.createLookup?.outcome || '',
      blocked: r.blockingReason.slice(0, 60),
    }))
  )
  console.log('\n== Proposals')
  for (const p of report.proposals) console.log(`- ${p.paymentType}: ${p.action}`)
  console.log('\n== Flags')
  for (const f of report.flags) console.log(`- ${f}`)
  console.log('\n== Zoho field checks', JSON.stringify(report.fieldChecks))
  console.log(`Zoho GET requests: ${report.zohoGetRequests}. No writes were attempted.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERR', err.code || '', err.message)
    process.exit(1)
  })
