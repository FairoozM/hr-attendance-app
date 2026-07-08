import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../components/Modal'
import {
  addAccountToWatchlist,
  fetchAllZohoAccountsWithBalances,
  fetchWatchlistAccounts,
  removeAccountFromWatchlist,
  type ZohoWatchlistAccount,
  type ZohoWatchlistFutureTransaction,
} from '../../../api/zohoAccountWatchlist'
import './AccountBalanceWatchlistPage.css'

function formatMoney(value: number | null | undefined, currencyCode = ''): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return currencyCode ? `${formatted} ${currencyCode}` : formatted
}

function formatSignedMoney(value: number | null | undefined, currencyCode = ''): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return formatMoney(0, currencyCode)
  const sign = value > 0 ? '+' : '−'
  return `${sign}${formatMoney(Math.abs(value), currencyCode)}`
}

function formatType(type: string): string {
  const raw = String(type || '').trim()
  if (!raw) return '—'
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatRefreshedAt(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortDate(value?: string): string {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function accountMatchesQuery(account: ZohoWatchlistAccount, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const blob = [account.accountName, account.accountCode, account.accountType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return blob.includes(q)
}

function FutureTxList({
  transactions,
  currencyCode = '',
}: {
  transactions: ZohoWatchlistFutureTransaction[]
  currencyCode?: string
}) {
  if (!transactions.length) return null
  return (
    <div className="abw-future">
      <div className="abw-future__title">
        Future transactions ({transactions.length})
      </div>
      <ul className="abw-future__list">
        {transactions.map((tx, idx) => (
          <li
            key={tx.transactionId || `${tx.transactionDate}-${tx.entryNumber}-${idx}`}
            className="abw-future__row"
          >
            <div className="abw-future__main">
              <span className="abw-future__date">{formatShortDate(tx.transactionDate)}</span>
              <span className="abw-future__type">{formatType(tx.transactionType || '')}</span>
              <span className="abw-mono">{tx.entryNumber || tx.referenceNumber || '—'}</span>
            </div>
            <div className="abw-future__desc">{tx.description || '—'}</div>
            <div
              className={`abw-future__impact ${
                (tx.impact || 0) < 0 ? 'abw-future__impact--neg' : (tx.impact || 0) > 0 ? 'abw-future__impact--pos' : ''
              }`}
            >
              {formatSignedMoney(tx.impact, currencyCode)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AccountBalanceWatchlistPage() {
  const [accounts, setAccounts] = useState<ZohoWatchlistAccount[]>([])
  const [refreshedAt, setRefreshedAt] = useState<string | undefined>()
  const [asOfDate, setAsOfDate] = useState<string | undefined>()
  const [emptyMessage, setEmptyMessage] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const [pickerQuery, setPickerQuery] = useState('')
  const [allAccounts, setAllAccounts] = useState<ZohoWatchlistAccount[]>([])
  const [addingId, setAddingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const loadWatchlist = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const data = await fetchWatchlistAccounts()
      const next = Array.isArray(data.accounts) ? data.accounts : []
      setAccounts(next)
      setRefreshedAt(data.refreshedAt)
      setAsOfDate(data.asOfDate)
      setEmptyMessage(data.empty ? data.message : undefined)
      setExpandedIds((prev) => {
        const keep = new Set<string>()
        for (const id of prev) {
          if (next.some((a) => a.accountId === id && (a.futureTransactionCount || 0) > 0)) {
            keep.add(id)
          }
        }
        return keep
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlist')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadWatchlist()
  }, [loadWatchlist])

  const watchedIds = useMemo(
    () => new Set(accounts.map((a) => a.accountId)),
    [accounts],
  )

  const openPicker = useCallback(async () => {
    setPickerOpen(true)
    setPickerQuery('')
    setPickerError('')
    setPickerLoading(true)
    try {
      const data = await fetchAllZohoAccountsWithBalances()
      setAllAccounts(Array.isArray(data.accounts) ? data.accounts : [])
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Failed to load Zoho accounts')
      setAllAccounts([])
    } finally {
      setPickerLoading(false)
    }
  }, [])

  const filteredPickerAccounts = useMemo(() => {
    return allAccounts
      .filter((a) => accountMatchesQuery(a, pickerQuery))
      .filter((a) => a.isActive !== false)
      .slice(0, 80)
  }, [allAccounts, pickerQuery])

  const handleAdd = useCallback(
    async (accountId: string) => {
      setAddingId(accountId)
      setPickerError('')
      try {
        await addAccountToWatchlist(accountId)
        await loadWatchlist({ soft: true })
        setPickerOpen(false)
      } catch (err) {
        setPickerError(err instanceof Error ? err.message : 'Failed to add account')
      } finally {
        setAddingId(null)
      }
    },
    [loadWatchlist],
  )

  const handleRemove = useCallback(async (accountId: string) => {
    setRemovingId(accountId)
    setError('')
    try {
      await removeAccountFromWatchlist(accountId)
      setAccounts((prev) => {
        const next = prev.filter((a) => a.accountId !== accountId)
        setEmptyMessage(
          next.length === 0
            ? 'No accounts added yet. Add important Zoho Books accounts to monitor their balances here.'
            : undefined,
        )
        return next
      })
      setExpandedIds((prev) => {
        if (!prev.has(accountId)) return prev
        const next = new Set(prev)
        next.delete(accountId)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove account')
    } finally {
      setRemovingId(null)
    }
  }, [])

  const toggleExpanded = useCallback((accountId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }, [])

  const isEmpty = !loading && !error && accounts.length === 0

  return (
    <div className="abw-page">
      <header className="abw-header">
        <div className="abw-header__copy">
          <p className="abw-kicker">Finance</p>
          <h1 className="abw-title">Account Balance Watchlist</h1>
          <p className="abw-subtitle">
            Current balance is as of today. Full balance includes future-dated Zoho transactions.
          </p>
        </div>
        <div className="abw-header__actions">
          <button
            type="button"
            className="abw-btn abw-btn--ghost"
            onClick={() => void loadWatchlist({ soft: true })}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh Balances'}
          </button>
          <button
            type="button"
            className="abw-btn abw-btn--primary"
            onClick={() => void openPicker()}
            disabled={loading}
          >
            Add Account
          </button>
        </div>
      </header>

      {refreshedAt && !loading && !error && accounts.length > 0 ? (
        <p className="abw-meta">
          Last refreshed {formatRefreshedAt(refreshedAt)}
          {asOfDate ? ` · Current as of ${formatShortDate(asOfDate)}` : ''}
        </p>
      ) : null}

      {loading ? (
        <div className="abw-state" role="status">
          <p className="abw-state__title">Loading watchlist balances…</p>
          <p className="abw-state__body">
            Fetching Zoho current balances and checking for future-dated transactions.
            This can take a few seconds for each watched account.
          </p>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="abw-state abw-state--error" role="alert">
          <p className="abw-state__title">Could not load balances</p>
          <p className="abw-state__body">{error}</p>
          <button
            type="button"
            className="abw-btn abw-btn--primary"
            onClick={() => void loadWatchlist()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="abw-state abw-state--empty">
          <p className="abw-state__title">No accounts added yet</p>
          <p className="abw-state__body">
            {emptyMessage ||
              'No accounts added yet. Add important Zoho Books accounts to monitor their balances here.'}
          </p>
          <button type="button" className="abw-btn abw-btn--primary" onClick={() => void openPicker()}>
            Add Account
          </button>
        </div>
      ) : null}

      {!loading && !error && accounts.length > 0 ? (
        <div className="abw-table-wrap">
          <table className="abw-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Code</th>
                <th>Type</th>
                <th className="abw-num">Current balance</th>
                <th className="abw-num">Full balance</th>
                <th className="abw-num">Future impact</th>
                <th>Refreshed</th>
                <th className="abw-actions-col"> </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const futureCount = account.futureTransactionCount || 0
                const expanded = expandedIds.has(account.accountId)
                const impact = account.futureImpact
                const hasDiff =
                  account.currentBalance != null &&
                  account.fullBalance != null &&
                  Math.abs((account.fullBalance || 0) - (account.currentBalance || 0)) >= 0.005

                return (
                  <Fragment key={account.accountId}>
                    <tr>
                      <td>
                        <div className="abw-account-name">{account.accountName || '—'}</div>
                        {account.notFoundInZoho ? (
                          <div className="abw-warn">Not found in Zoho</div>
                        ) : account.balanceUnavailable ? (
                          <div className="abw-warn">Balance unavailable</div>
                        ) : null}
                        {futureCount > 0 ? (
                          <button
                            type="button"
                            className="abw-link"
                            onClick={() => toggleExpanded(account.accountId)}
                          >
                            {expanded ? 'Hide' : 'Show'} {futureCount} future txn
                            {futureCount === 1 ? '' : 's'}
                          </button>
                        ) : account.enrichError ? (
                          <div className="abw-warn">{account.enrichError}</div>
                        ) : (
                          <div className="abw-muted">No future transactions</div>
                        )}
                      </td>
                      <td className="abw-mono">{account.accountCode || '—'}</td>
                      <td>{formatType(account.accountType)}</td>
                      <td className="abw-num abw-balance">
                        {formatMoney(account.currentBalance, account.currencyCode)}
                      </td>
                      <td className={`abw-num abw-balance ${hasDiff ? 'abw-balance--full' : ''}`}>
                        {formatMoney(
                          account.fullBalance ?? account.closingBalance,
                          account.currencyCode,
                        )}
                      </td>
                      <td
                        className={`abw-num abw-impact ${
                          (impact || 0) < 0
                            ? 'abw-impact--neg'
                            : (impact || 0) > 0
                              ? 'abw-impact--pos'
                              : ''
                        }`}
                      >
                        {futureCount > 0 || (impact != null && impact !== 0)
                          ? formatSignedMoney(impact, account.currencyCode)
                          : '—'}
                      </td>
                      <td className="abw-muted">
                        {formatRefreshedAt(account.refreshedAt || refreshedAt)}
                      </td>
                      <td className="abw-actions-col">
                        <button
                          type="button"
                          className="abw-btn abw-btn--danger-ghost"
                          onClick={() => void handleRemove(account.accountId)}
                          disabled={removingId === account.accountId}
                        >
                          {removingId === account.accountId ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                    {expanded && futureCount > 0 ? (
                      <tr className="abw-expand-row">
                        <td colSpan={8}>
                          <FutureTxList
                            transactions={account.futureTransactions || []}
                            currencyCode={account.currencyCode}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        title="Add account to watchlist"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        panelClassName="abw-picker-modal"
      >
        <div className="abw-picker">
          <p className="abw-picker__hint">
            Search by account name or code. Banks, cash, clearing, VAT, and control accounts work best.
          </p>
          <input
            type="search"
            className="abw-picker__search"
            placeholder="Search name or code…"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoFocus
            disabled={pickerLoading}
          />

          {pickerError ? (
            <div className="abw-picker__error" role="alert">
              {pickerError}
            </div>
          ) : null}

          {pickerLoading ? (
            <div className="abw-picker__status">Loading Zoho chart of accounts…</div>
          ) : null}

          {!pickerLoading && filteredPickerAccounts.length === 0 ? (
            <div className="abw-picker__status">No accounts match your search.</div>
          ) : null}

          {!pickerLoading && filteredPickerAccounts.length > 0 ? (
            <ul className="abw-picker__list">
              {filteredPickerAccounts.map((account) => {
                const already = watchedIds.has(account.accountId)
                return (
                  <li key={account.accountId} className="abw-picker__row">
                    <div className="abw-picker__main">
                      <div className="abw-picker__name">{account.accountName}</div>
                      <div className="abw-picker__meta">
                        <span className="abw-mono">{account.accountCode || '—'}</span>
                        <span>{formatType(account.accountType)}</span>
                        <span className="abw-balance">
                          {formatMoney(account.currentBalance, account.currencyCode)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="abw-btn abw-btn--primary abw-btn--sm"
                      disabled={already || addingId === account.accountId}
                      onClick={() => void handleAdd(account.accountId)}
                    >
                      {already ? 'Added' : addingId === account.accountId ? 'Adding…' : 'Add'}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
