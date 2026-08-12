const { zohoBooksJsonRequest } = require('./zohoApiClient')
const { readZohoConfig } = require('../integrations/zoho/zohoConfig')
const { getZohoTokenDiagnostics } = require('../integrations/zoho/zohoOAuth')
const store = require('./amazonPaymentClearingStore')
const { getPaymentClearingMarketplaceConfig } = require('./amazonPaymentClearingMarketplaceConfig')

const BOOKS_V3 = '/books/v3'
const CHART_OF_ACCOUNTS_ENDPOINT = `${BOOKS_V3}/chartofaccounts`
const CHART_OF_ACCOUNTS_REQUIRED_SCOPE = 'ZohoBooks.accountants.READ'
let accountCache = null

function paymentAccountEnvFor(marketplace) {
  return getPaymentClearingMarketplaceConfig(marketplace).paymentAccountEnv
}

function buildZohoJsonStringBody(payload) {
  const form = new URLSearchParams()
  form.set('JSONString', JSON.stringify(payload))
  return form.toString()
}

function todayLocalDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildCustomerPaymentPayload(payment, opts = {}) {
  const invoices = Array.isArray(payment.invoices) && payment.invoices.length > 0
    ? payment.invoices.map((invoice) => ({
        invoice_id: invoice.invoiceId || invoice.invoice_id,
        amount_applied: Number(invoice.amountApplied ?? invoice.amount_applied ?? invoice.amount) || 0,
      }))
    : [
        {
          invoice_id: payment.invoiceId,
          amount_applied: Number(payment.amount) || 0,
        },
      ]
  return {
    customer_id: payment.customerId || opts.customerId || undefined,
    payment_mode: payment.paymentMode || 'cash',
    amount: Number(payment.amount) || 0,
    date: payment.paymentDate || opts.date || todayLocalDate(),
    reference_number: payment.referenceNumber || undefined,
    description: payment.description || undefined,
    account_id: payment.depositToAccountId || opts.depositToAccountId || undefined,
    invoices,
  }
}

function resolveJournalLineCustomerId(line, journal) {
  const lineCustomerId = clean(line.customerId || line.customer_id)
  if (lineCustomerId) return lineCustomerId
  if (Array.isArray(journal.lineItems) && journal.lineItems.length >= 2) return undefined
  return clean(journal.customerId) || undefined
}

function buildManualJournalPayload(journal, opts = {}) {
  const journalDate = journal.date || opts.date || todayLocalDate()
  const base = {
    journal_date: journalDate,
    reference_number: journal.referenceNumber || undefined,
    notes: journal.notes || undefined,
    journal_type: journal.journalType || 'both',
  }
  // Multi-line journals (e.g. Noon VAT-inclusive fee = net expense + input VAT + bridge).
  if (Array.isArray(journal.lineItems) && journal.lineItems.length >= 2) {
    return {
      ...base,
      line_items: journal.lineItems.map((line) => ({
        account_id: line.accountId || line.account_id || undefined,
        customer_id: resolveJournalLineCustomerId(line, journal),
        debit_or_credit: line.debitOrCredit || line.debit_or_credit,
        amount: Number(line.amount) || 0,
        description:
          clean(line.description) ||
          undefined,
      })),
    }
  }
  return {
    ...base,
    line_items: [
      {
        account_id: journal.debitAccountId || opts.debitAccountId || undefined,
        debit_or_credit: 'debit',
        amount: Number(journal.amount) || 0,
        description: journal.description || journal.feeType || undefined,
      },
      {
        account_id: journal.creditAccountId || opts.creditAccountId || undefined,
        debit_or_credit: 'credit',
        amount: Number(journal.amount) || 0,
        description: journal.description || journal.feeType || undefined,
      },
    ],
  }
}

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function configuredPaymentAccountMap(marketplace = 'KSA') {
  const cfg = getPaymentClearingMarketplaceConfig(marketplace)
  const paymentAccountEnv = cfg.paymentAccountEnv
  const out = new Map()
  const mapEnv = process.env[cfg.paymentAccountMapEnv]
  if (mapEnv) {
    try {
      const parsed = JSON.parse(mapEnv)
      for (const [code, value] of Object.entries(parsed || {})) {
        const accountId = clean(value?.account_id || value?.accountId || value?.id)
        if (accountId) {
          out.set(clean(code), {
            accountCode: clean(code),
            accountId,
            accountName: clean(value?.account_name || value?.accountName || value?.name),
            source: cfg.paymentAccountMapEnv,
          })
        }
      }
    } catch (err) {
      console.warn(`[amazon-payment-clearing] invalid ${cfg.paymentAccountMapEnv}:`, err.message)
    }
  }
  for (const [code, env] of Object.entries(paymentAccountEnv)) {
    const accountId = clean(process.env[env.id])
    if (!accountId) continue
    out.set(code, {
      accountCode: code,
      accountId,
      accountName: clean(process.env[env.name]) || env.defaultName,
      source: env.id,
    })
  }
  return out
}

function configuredAccountByCode(accountCode, marketplace = 'KSA') {
  return configuredPaymentAccountMap(marketplace).get(clean(accountCode)) || null
}

function requiredPaymentAccountConfig(accountCode, marketplace = 'KSA') {
  return paymentAccountEnvFor(marketplace)[clean(accountCode)] || null
}

function configuredAccountMappings(marketplace = 'KSA') {
  return Array.from(configuredPaymentAccountMap(marketplace).values())
}

function tokenHasChartOfAccountsScope(tokenDiagnostics) {
  const scopes = Array.isArray(tokenDiagnostics?.scopes) ? tokenDiagnostics.scopes : []
  return (
    scopes.includes(CHART_OF_ACCOUNTS_REQUIRED_SCOPE) ||
    scopes.includes('ZohoBooks.fullaccess.all') ||
    scopes.includes('ZohoBooks.FullAccess.all')
  )
}

async function fetchChartOfAccounts() {
  if (accountCache) return accountCache
  const json = await zohoBooksJsonRequest(
    CHART_OF_ACCOUNTS_ENDPOINT,
    new URLSearchParams(),
    'GET',
    undefined,
    {
      source: 'amazon_payment_clearing_accounts',
      skipCache: false,
    }
  )
  accountCache = Array.isArray(json?.chartofaccounts)
    ? json.chartofaccounts
    : Array.isArray(json?.accounts)
      ? json.accounts
      : []
  return accountCache
}

function mapChartAccount(account) {
  return {
    accountId: clean(account?.account_id || account?.id),
    accountName: clean(account?.account_name || account?.name),
    accountCode: clean(account?.account_code || account?.code),
    accountType: clean(account?.account_type || account?.type),
    isActive: account?.is_active !== false,
    raw: account,
  }
}

async function listZohoChartAccounts() {
  return (await fetchChartOfAccounts()).map(mapChartAccount).filter((account) => account.accountId)
}

async function resolveAccountByCode(accountCode) {
  const code = String(accountCode || '').trim()
  if (!code) return null
  const accounts = await fetchChartOfAccounts()
  return accounts.find((account) => String(account?.account_code || account?.code || '').trim() === code) || null
}

function marketplaceFromPaymentOrOpts(payment = {}, opts = {}) {
  return opts.marketplace || payment.marketplace || 'KSA'
}

function missingConfiguredAccountError(accountCode, marketplace = 'KSA') {
  const code = clean(accountCode)
  const err = new Error(`Missing configured account ID for account code ${code}`)
  err.code = 'AMAZON_PAYMENT_CLEARING_ACCOUNT_ID_MISSING'
  err.accountCode = code
  err.requiredEnv = requiredPaymentAccountConfig(code, marketplace)?.id || null
  err.status = 422
  return err
}

async function resolveConfiguredDepositAccount(payment, opts = {}) {
  const marketplace = marketplaceFromPaymentOrOpts(payment, opts)
  const configuredAccount = payment.depositToAccountId
    ? null
    : configuredAccountByCode(payment.depositToAccountCode, marketplace)
  if (configuredAccount?.accountId) {
    return {
      accountId: configuredAccount.accountId,
      accountName: payment.depositToAccountName || configuredAccount.accountName,
      source: configuredAccount.source,
    }
  }
  const depositToAccountId = clean(payment.depositToAccountId)
  if (!depositToAccountId) {
    const cached = await store.getAccountMappingByCode(clean(payment.depositToAccountCode))
    if (cached?.accountId) {
      return {
        accountId: cached.accountId,
        accountName: payment.depositToAccountName || cached.accountName,
        source: cached.source || 'cached',
      }
    }
    const tokenDiagnostics = await getZohoTokenDiagnostics().catch(() => null)
    if (tokenHasChartOfAccountsScope(tokenDiagnostics)) {
      const discovered = await resolveDepositAccount(payment, { ...opts, allowChartLookup: true, marketplace })
      if (discovered?.accountId) {
        await store.upsertAccountMapping({
          accountCode: clean(payment.depositToAccountCode),
          accountName: discovered.accountName || payment.depositToAccountName || '',
          accountId: discovered.accountId,
          source: CHART_OF_ACCOUNTS_ENDPOINT,
        }).catch((err) => {
          console.warn('[amazon-payment-clearing] failed to cache account mapping:', err.message || err)
        })
        return {
          ...discovered,
          source: CHART_OF_ACCOUNTS_ENDPOINT,
        }
      }
    }
    throw missingConfiguredAccountError(payment.depositToAccountCode, marketplace)
  }
  return {
    accountId: depositToAccountId,
    accountName: payment.depositToAccountName || '',
    source: 'payload',
  }
}

async function resolveDepositAccount(payment, opts = {}) {
  const marketplace = marketplaceFromPaymentOrOpts(payment, opts)
  if (opts.allowChartLookup === true) {
    const configuredAccount = payment.depositToAccountId
      ? null
      : configuredAccountByCode(payment.depositToAccountCode, marketplace)
    if (configuredAccount?.accountId) {
      return {
        accountId: configuredAccount.accountId,
        accountName: payment.depositToAccountName || configuredAccount.accountName,
        source: configuredAccount.source,
      }
    }
    const account = payment.depositToAccountId ? null : await resolveAccountByCode(payment.depositToAccountCode)
    const depositToAccountId = payment.depositToAccountId || account?.account_id || account?.id || ''
    if (!depositToAccountId) {
      const err = new Error(`Zoho account not found for account code ${payment.depositToAccountCode}`)
      err.code = 'ZOHO_ACCOUNT_NOT_FOUND'
      err.accountCode = payment.depositToAccountCode
      throw err
    }
    return {
      accountId: depositToAccountId,
      accountName: payment.depositToAccountName || account?.account_name || account?.name || '',
      source: payment.depositToAccountId ? 'payload' : CHART_OF_ACCOUNTS_ENDPOINT,
    }
  }
  return resolveConfiguredDepositAccount(payment, opts)
}

async function buildCustomerPaymentPayloadPreview(payment, opts = {}) {
  const account = await resolveConfiguredDepositAccount(payment, opts)
  const payload = buildCustomerPaymentPayload(payment, { ...opts, depositToAccountId: account.accountId })
  return {
    customer_id: payload.customer_id || '',
    invoice_id: payload.invoices?.[0]?.invoice_id || '',
    invoices: payload.invoices || [],
    amount: payload.amount,
    payment_date: payload.date,
    account_id: payload.account_id || '',
    account_name: account.accountName,
    reference_number: payload.reference_number || '',
    description: payload.description || '',
  }
}

async function resolveJournalAccount(account, opts = {}) {
  return resolveConfiguredDepositAccount(
    {
      depositToAccountId: account.accountId || '',
      depositToAccountCode: account.accountCode || '',
      depositToAccountName: account.accountName || '',
      marketplace: opts.marketplace || account.marketplace,
    },
    opts
  )
}

async function buildManualJournalPayloadPreview(journal, opts = {}) {
  if (Array.isArray(journal.lineItems) && journal.lineItems.length >= 2) {
    const resolvedLines = []
    for (const line of journal.lineItems) {
      const account = await resolveJournalAccount(line, opts)
      resolvedLines.push({
        account_id: account.accountId,
        account_name: account.accountName,
        customer_id: resolveJournalLineCustomerId(line, journal),
        debit_or_credit: line.debitOrCredit || line.debit_or_credit,
        amount: Number(line.amount) || 0,
        description: clean(line.description) || undefined,
      })
    }
    return {
      journal_date: journal.date || opts.date || todayLocalDate(),
      reference_number: journal.referenceNumber || '',
      notes: journal.notes || '',
      journal_type: journal.journalType || 'both',
      line_items: resolvedLines,
    }
  }
  const debit = await resolveJournalAccount(journal.debit || {}, opts)
  const credit = await resolveJournalAccount(journal.credit || {}, opts)
  const payload = buildManualJournalPayload(journal, {
    ...opts,
    debitAccountId: debit.accountId,
    creditAccountId: credit.accountId,
  })
  return {
    journal_date: payload.journal_date,
    reference_number: payload.reference_number || '',
    notes: payload.notes || '',
    journal_type: payload.journal_type,
    line_items: payload.line_items.map((line, idx) => ({
      ...line,
      account_name: idx === 0 ? debit.accountName : credit.accountName,
    })),
  }
}

async function createZohoManualJournal(journal, opts = {}) {
  let payload
  if (Array.isArray(journal.lineItems) && journal.lineItems.length >= 2) {
    const resolvedItems = []
    for (const line of journal.lineItems) {
      const account = await resolveJournalAccount(line, opts)
      resolvedItems.push({
        ...line,
        accountId: account.accountId,
        accountName: account.accountName,
      })
    }
    payload = buildManualJournalPayload({ ...journal, lineItems: resolvedItems }, opts)
  } else {
    const debit = await resolveJournalAccount(journal.debit || {}, opts)
    const credit = await resolveJournalAccount(journal.credit || {}, opts)
    payload = buildManualJournalPayload(journal, {
      ...opts,
      debitAccountId: debit.accountId,
      creditAccountId: credit.accountId,
    })
  }
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/journals`,
    new URLSearchParams(),
    'POST',
    buildZohoJsonStringBody(payload),
    {
      source: 'amazon_payment_clearing_fee_journal_post',
      skipCache: true,
      critical: true,
    }
  )
  const body = json?.journal || json || {}
  return {
    zohoJournalId: body.journal_id || body.journalId || body.id || '',
    zohoJournalNumber: body.journal_number || body.journalNumber || body.number || '',
    raw: json,
  }
}

async function getZohoCustomerPayment(paymentId, opts = {}) {
  const id = clean(paymentId)
  if (!id) return null
  try {
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/customerpayments/${encodeURIComponent(id)}`,
      new URLSearchParams(),
      'GET',
      null,
      {
        source: opts.source || 'payment_clearing_verify',
        skipCache: true,
      }
    )
    return json?.payment || json?.customerpayment || json || null
  } catch (err) {
    if (Number(err?.httpStatus) === 404) return null
    throw err
  }
}

async function createZohoCustomerPayment(payment, opts = {}) {
  const account = await resolveConfiguredDepositAccount(payment, opts)
  const depositToAccountId = account.accountId
  const payload = buildCustomerPaymentPayload(payment, { ...opts, depositToAccountId })
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/customerpayments`,
    new URLSearchParams(),
    'POST',
    buildZohoJsonStringBody(payload),
    {
      source: 'amazon_payment_clearing_post',
      skipCache: true,
      critical: true,
    }
  )
  const body = json?.payment || json?.customerpayment || json || {}
  return {
    zohoPaymentId: body.payment_id || body.customerpayment_id || body.paymentId || body.id || '',
    payment_id: body.payment_id || body.customerpayment_id || body.paymentId || body.id || '',
    raw: json,
  }
}

async function getAccountDiagnostics(marketplace = 'KSA') {
  const cfg = getPaymentClearingMarketplaceConfig(marketplace)
  const paymentAccountEnv = cfg.paymentAccountEnv
  const config = readZohoConfig()
  const organizationId = config.code === 'ok' ? config.organizationId : null
  let oauthScopes = null
  let oauthScopeRaw = null
  let oauthScopesAvailable = false
  let oauthError = null
  try {
    const tokenDiagnostics = await getZohoTokenDiagnostics()
    oauthScopes = tokenDiagnostics.scopes
    oauthScopeRaw = tokenDiagnostics.scopeRaw
    oauthScopesAvailable = tokenDiagnostics.scopesAvailable
  } catch (err) {
    oauthError = {
      code: err?.code || 'ZOHO_OAUTH_ERROR',
      message: err?.message || 'Failed to inspect Zoho OAuth token',
      httpStatus: err?.httpStatus || null,
    }
  }

  let chartOfAccountsAccessResult
  try {
    const accounts = await fetchChartOfAccounts()
    chartOfAccountsAccessResult = {
      ok: true,
      count: accounts.length,
      error: null,
    }
  } catch (err) {
    chartOfAccountsAccessResult = {
      ok: false,
      count: 0,
      error: {
        code: err?.code || 'ZOHO_API_ERROR',
        message: err?.message || 'Chart of accounts lookup failed',
        httpStatus: err?.httpStatus || null,
      },
    }
  }

  const sampleAccountLookupResult = []
  const cachedMappings = await store.getAccountMappings().catch(() => [])
  for (const code of Object.keys(paymentAccountEnv)) {
    const configured = configuredAccountByCode(code, marketplace)
    if (configured) {
      sampleAccountLookupResult.push({
        accountCode: code,
        accountId: configured.accountId,
        accountName: configured.accountName,
        source: configured.source,
        chartOfAccountsApiCalled: false,
      })
      continue
    }
    const cached = cachedMappings.find((row) => row.accountCode === code)
    if (cached?.accountId) {
      sampleAccountLookupResult.push({
        accountCode: code,
        accountId: cached.accountId,
        accountName: cached.accountName || paymentAccountEnv[code].defaultName,
        source: cached.source || 'cached',
        chartOfAccountsApiCalled: false,
      })
      continue
    }
    if (chartOfAccountsAccessResult.ok) {
      const discovered = await resolveAccountByCode(code).catch(() => null)
      if (discovered) {
        const mapping = await store.upsertAccountMapping({
          accountCode: code,
          accountName: discovered.account_name || discovered.name || paymentAccountEnv[code].defaultName,
          accountId: discovered.account_id || discovered.id,
          source: CHART_OF_ACCOUNTS_ENDPOINT,
        }).catch(() => null)
        sampleAccountLookupResult.push({
          accountCode: code,
          accountId: mapping?.accountId || discovered.account_id || discovered.id || null,
          accountName: mapping?.accountName || discovered.account_name || discovered.name || paymentAccountEnv[code].defaultName,
          source: mapping?.source || CHART_OF_ACCOUNTS_ENDPOINT,
          chartOfAccountsApiCalled: true,
        })
        continue
      }
    }
    sampleAccountLookupResult.push({
      accountCode: code,
      accountId: null,
      accountName: paymentAccountEnv[code].defaultName,
      source: CHART_OF_ACCOUNTS_ENDPOINT,
      chartOfAccountsApiCalled: true,
    })
  }

  return {
    marketplace: cfg.code,
    organizationId,
    accountLookupEndpoint: CHART_OF_ACCOUNTS_ENDPOINT,
    requiredOAuthScope: CHART_OF_ACCOUNTS_REQUIRED_SCOPE,
    oauthScopes,
    oauthScopeRaw,
    oauthScopesAvailable,
    oauthError,
    configuredAccountMappings: configuredAccountMappings(marketplace),
    cachedAccountMappings: cachedMappings,
    chartOfAccountsAccessResult,
    sampleAccountLookupResult,
  }
}

module.exports = {
  CHART_OF_ACCOUNTS_ENDPOINT,
  CHART_OF_ACCOUNTS_REQUIRED_SCOPE,
  buildCustomerPaymentPayload,
  buildManualJournalPayload,
  buildCustomerPaymentPayloadPreview,
  buildManualJournalPayloadPreview,
  createZohoCustomerPayment,
  getZohoCustomerPayment,
  createZohoManualJournal,
  configuredAccountByCode,
  configuredAccountMappings,
  getAccountDiagnostics,
  listZohoChartAccounts,
  missingConfiguredAccountError,
  resolveAccountByCode,
  resolveConfiguredDepositAccount,
  resolveDepositAccount,
  todayLocalDate,
}
