/**
 * Strict, marketplace-explicit Zoho account resolution for Amazon payment clearing
 * postings. Every accounting write must resolve its accounts through here before the
 * first POST so a UAE batch can never fall back to KSA accounts.
 */
const {
  clearingAccountDefs,
  paymentAccountEnvDefs,
  getPaymentClearingMarketplaceConfig,
  normalizeMarketplaceCode,
} = require('./amazonPaymentClearingMarketplaceConfig')

/** @typedef {'UNDEPOSITED'|'COMMISSION'|'SHIPPING_FBA'} AccountRole */
/**
 * @typedef {Object} ResolvedAccount
 * @property {AccountRole} role
 * @property {string} accountCode
 * @property {string} accountId
 * @property {string} accountName
 * @property {string} source
 */
/**
 * @typedef {Object} AccountProblem
 * @property {string} marketplace
 * @property {string} [role]
 * @property {'missing'|'conflict'|'invalid'|'cross_marketplace'|'duplicate'} kind
 * @property {string} message
 */

const ROLES = /** @type {AccountRole[]} */ (['UNDEPOSITED', 'COMMISSION', 'SHIPPING_FBA'])

function clean(value) {
  return value == null ? '' : String(value).trim()
}

/**
 * @param {unknown} marketplace
 * @returns {'KSA'|'UAE'}
 */
function requireMarketplaceCode(marketplace) {
  const raw = clean(marketplace).toUpperCase()
  if (raw !== 'KSA' && raw !== 'UAE') {
    const err = new Error('Posting requires an explicit Amazon marketplace (KSA or UAE) on the settlement batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_MARKETPLACE_REQUIRED'
    err.status = 422
    throw err
  }
  return /** @type {'KSA'|'UAE'} */ (raw)
}

function marketplaceKey(code) {
  return code === 'UAE' ? 'uae' : 'ksa'
}

/**
 * @param {'KSA'|'UAE'} code
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ map: Record<string, string>, problems: AccountProblem[] }}
 */
function readAccountMapEnv(code, env) {
  const cfg = getPaymentClearingMarketplaceConfig(code)
  const raw = clean(env[cfg.paymentAccountMapEnv])
  /** @type {Record<string, string>} */
  const map = {}
  if (!raw) return { map, problems: [] }
  try {
    const parsed = JSON.parse(raw)
    for (const [accountCode, value] of Object.entries(parsed || {})) {
      const accountId = clean(value?.account_id || value?.accountId || value?.id)
      if (accountId) map[clean(accountCode)] = accountId
    }
    return { map, problems: [] }
  } catch (err) {
    return {
      map,
      problems: [{ marketplace: code, kind: 'invalid', message: `${cfg.paymentAccountMapEnv} is not valid JSON.` }],
    }
  }
}

/**
 * Resolve the three clearing accounts for one marketplace without any fallback to
 * another marketplace, chart-of-accounts guessing, or cached name lookups.
 * @param {unknown} marketplace
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ marketplace: 'KSA'|'UAE', accounts: Record<AccountRole, ResolvedAccount|null>, problems: AccountProblem[] }}
 */
function resolveMarketplaceClearingAccounts(marketplace, opts = {}) {
  const env = opts.env || process.env
  const code = requireMarketplaceCode(marketplace)
  const key = marketplaceKey(code)
  const defs = clearingAccountDefs(key)
  const envDefs = paymentAccountEnvDefs(key)
  const { map, problems } = readAccountMapEnv(code, env)
  /** @type {Record<AccountRole, ResolvedAccount|null>} */
  const accounts = { UNDEPOSITED: null, COMMISSION: null, SHIPPING_FBA: null }

  for (const role of ROLES) {
    const def = defs[role]
    const envDef = envDefs[def.accountCode]
    const fromEnv = clean(env[envDef.id])
    const fromMap = clean(map[def.accountCode])
    const verified = clean(def.verifiedAccountId)
    const candidates = [
      fromEnv ? { id: fromEnv, source: envDef.id } : null,
      fromMap ? { id: fromMap, source: getPaymentClearingMarketplaceConfig(code).paymentAccountMapEnv } : null,
      verified ? { id: verified, source: 'verified_default' } : null,
    ].filter(Boolean)
    const distinct = Array.from(new Set(candidates.map((row) => row.id)))
    if (!candidates.length) {
      problems.push({
        marketplace: code,
        role,
        kind: 'missing',
        message: `${code} ${def.defaultName} (${def.accountCode}) has no Zoho account id. Set ${envDef.id}.`,
      })
      continue
    }
    if (distinct.length > 1) {
      problems.push({
        marketplace: code,
        role,
        kind: 'conflict',
        message:
          `${code} ${def.defaultName} (${def.accountCode}) has conflicting account ids: ` +
          candidates.map((row) => `${row.source}=${row.id}`).join(', ') +
          '. Remove the incorrect setting.',
      })
      continue
    }
    accounts[role] = {
      role,
      accountCode: def.accountCode,
      accountId: distinct[0],
      accountName: clean(env[envDef.name]) || def.defaultName,
      source: candidates[0].source,
    }
  }

  const seen = new Map()
  for (const role of ROLES) {
    const account = accounts[role]
    if (!account) continue
    if (seen.has(account.accountId)) {
      problems.push({
        marketplace: code,
        role,
        kind: 'duplicate',
        message: `${code} ${role} and ${seen.get(account.accountId)} both use Zoho account ${account.accountId}.`,
      })
    }
    seen.set(account.accountId, role)
  }
  return { marketplace: code, accounts, problems }
}

/**
 * Account ids configured for the *other* marketplace (env, map, or verified default).
 * @param {'KSA'|'UAE'} code
 * @param {NodeJS.ProcessEnv} env
 */
function otherMarketplaceAccountIds(code, env) {
  const other = code === 'UAE' ? 'KSA' : 'UAE'
  const key = marketplaceKey(other)
  const defs = clearingAccountDefs(key)
  const envDefs = paymentAccountEnvDefs(key)
  const { map } = readAccountMapEnv(other, env)
  const ids = new Map()
  for (const role of ROLES) {
    const def = defs[role]
    for (const id of [clean(env[envDefs[def.accountCode].id]), clean(map[def.accountCode]), clean(def.verifiedAccountId)]) {
      if (id) ids.set(id, `${other} ${def.defaultName}`)
    }
  }
  return ids
}

/**
 * @param {{ debit?: { accountId?: string }, credit?: { accountId?: string } }} line
 */
function journalLineAccountIds(line) {
  return [clean(line?.debit?.accountId), clean(line?.credit?.accountId)]
}

/**
 * Validate every account a posting run can touch. Throws before any accounting write
 * when anything is missing or conflicting.
 * @param {{
 *   marketplace: unknown,
 *   feeJournalLines?: Array<{ feeType?: string, debit?: { accountId?: string }, credit?: { accountId?: string } }>,
 *   env?: NodeJS.ProcessEnv,
 * }} input
 */
function assertPostingAccountsReady(input) {
  const env = input.env || process.env
  const resolved = resolveMarketplaceClearingAccounts(input.marketplace, { env })
  const problems = [...resolved.problems]
  const foreign = otherMarketplaceAccountIds(resolved.marketplace, env)

  for (const role of ROLES) {
    const account = resolved.accounts[role]
    if (account && foreign.has(account.accountId)) {
      problems.push({
        marketplace: resolved.marketplace,
        role,
        kind: 'cross_marketplace',
        message: `${resolved.marketplace} ${account.accountName} resolves to ${account.accountId}, which is configured for ${foreign.get(account.accountId)}.`,
      })
    }
  }

  for (const line of input.feeJournalLines || []) {
    const [debitId, creditId] = journalLineAccountIds(line)
    const label = clean(line.feeType) || 'fee journal'
    if (!debitId || !creditId) {
      problems.push({
        marketplace: resolved.marketplace,
        kind: 'missing',
        message: `${resolved.marketplace} ${label} journal mapping is missing a debit or credit Zoho account id.`,
      })
      continue
    }
    for (const id of [debitId, creditId]) {
      if (foreign.has(id)) {
        problems.push({
          marketplace: resolved.marketplace,
          kind: 'cross_marketplace',
          message: `${resolved.marketplace} ${label} journal uses ${id}, which is configured for ${foreign.get(id)}.`,
        })
      }
    }
  }

  if (problems.length) {
    const err = new Error(
      `Zoho account configuration for ${resolved.marketplace} is incomplete or conflicting. Nothing was posted. ` +
        problems.map((row) => row.message).join(' ')
    )
    err.code = 'AMAZON_PAYMENT_CLEARING_ACCOUNT_CONFIG_INVALID'
    err.status = 422
    err.problems = problems
    throw err
  }
  return resolved
}

/**
 * Strict lookup of a clearing account by its Zoho account code.
 * @param {unknown} marketplace
 * @param {string} accountCode
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {ResolvedAccount}
 */
function requireClearingAccountByCode(marketplace, accountCode, opts = {}) {
  const resolved = assertPostingAccountsReady({ marketplace, env: opts.env })
  const code = clean(accountCode)
  const account = ROLES.map((role) => resolved.accounts[role]).find((row) => row && row.accountCode === code)
  if (!account) {
    const err = new Error(
      `Account code ${code || '(empty)'} is not a ${resolved.marketplace} Amazon clearing account. Nothing was posted.`
    )
    err.code = 'AMAZON_PAYMENT_CLEARING_ACCOUNT_CONFIG_INVALID'
    err.status = 422
    throw err
  }
  return account
}

module.exports = {
  ROLES,
  requireMarketplaceCode,
  resolveMarketplaceClearingAccounts,
  assertPostingAccountsReady,
  requireClearingAccountByCode,
  normalizeMarketplaceCode,
}
