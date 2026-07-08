/**
 * Zoho Books Account Balance Watchlist API.
 */

const service = require('../services/zohoAccountWatchlistService')

function safeMessage(err) {
  const msg = err && err.message ? String(err.message) : 'Request failed'
  return msg.slice(0, 500)
}

function statusForError(err) {
  if (err?.status && Number.isFinite(Number(err.status))) return Number(err.status)
  switch (err?.code) {
    case 'VALIDATION':
      return 400
    case 'ZOHO_TOKEN_EXPIRED':
    case 'ZOHO_OAUTH_ERROR':
      return 401
    case 'ZOHO_SCOPE_MISSING':
      return 403
    case 'ACCOUNT_NOT_FOUND':
      return 404
    case 'ZOHO_NOT_CONFIGURED':
      return 503
    case 'ZOHO_HTTP_429':
    case 'ZOHO_SYNC_PAUSED':
      return 429
    default:
      return 500
  }
}

function sendError(res, err, fallbackCode = 'ZOHO_ACCOUNT_WATCHLIST_ERROR') {
  const code = err?.code || fallbackCode
  const status = statusForError(err)
  console.error('[zoho-account-watchlist]', code, safeMessage(err))
  return res.status(status).json({
    success: false,
    error: safeMessage(err),
    code,
  })
}

/** GET /api/zoho/account-watchlist/accounts — all CoA with balances for picker */
async function getAllAccounts(req, res) {
  try {
    const json = await service.listAllAccountsWithBalances()
    return res.json({ success: true, ...json })
  } catch (err) {
    return sendError(res, err)
  }
}

/** GET /api/zoho/account-watchlist — watched accounts with balances */
async function getWatchlist(req, res) {
  try {
    const json = await service.listWatchlistWithBalances()
    return res.json({ success: true, ...json })
  } catch (err) {
    return sendError(res, err)
  }
}

/** POST /api/zoho/account-watchlist — add account */
async function postWatchlist(req, res) {
  try {
    const json = await service.addAccountToWatchlist(req.body || {}, req.user?.userId ?? null)
    return res.status(json.alreadyWatched ? 200 : 201).json({ success: true, ...json })
  } catch (err) {
    return sendError(res, err)
  }
}

/** DELETE /api/zoho/account-watchlist/:accountId */
async function deleteWatchlistAccount(req, res) {
  try {
    const json = await service.removeAccountFromWatchlist(req.params.accountId)
    return res.json({ success: true, ...json })
  } catch (err) {
    return sendError(res, err)
  }
}

module.exports = {
  getAllAccounts,
  getWatchlist,
  postWatchlist,
  deleteWatchlistAccount,
}
