import { Fragment } from 'react'
import type { ZohoWatchlistAccount, ZohoWatchlistFutureTransaction } from '../../../api/zohoAccountWatchlist'

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

export type WatchlistAccountsTableProps = {
  accounts: ZohoWatchlistAccount[]
  refreshedAt?: string
  expandedIds: Set<string>
  removingId: string | null
  onToggleExpanded: (accountId: string) => void
  onRemove: (accountId: string) => void
}

export function WatchlistAccountsTable({
  accounts,
  refreshedAt,
  expandedIds,
  removingId,
  onToggleExpanded,
  onRemove,
}: WatchlistAccountsTableProps) {
  return (
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
                        onClick={() => onToggleExpanded(account.accountId)}
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
                    {futureCount > 0
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
                      onClick={() => onRemove(account.accountId)}
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
  )
}
