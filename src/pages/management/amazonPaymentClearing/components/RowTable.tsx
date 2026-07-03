import type { ParsedRowStatus, ParsedSettlementRow } from '../../../../api/amazonPaymentClearing'
import { money, RowStatusPill } from '../clearingShared'

const STATUS_FILTERS: Array<{ key: ParsedRowStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'missing_order_id', label: 'No order ID' },
  { key: 'account_level_fee', label: 'Account-level fee' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'review', label: 'Review' },
  { key: 'unknown', label: 'Unknown' },
]

export function FilterChips({
  active,
  counts,
  onSelect,
}: {
  active: ParsedRowStatus | 'all'
  counts: Record<string, number>
  onSelect: (status: ParsedRowStatus | 'all') => void
}) {
  return (
    <div className="apc-chips">
      {STATUS_FILTERS.map((chip) => {
        const count = counts[chip.key] || 0
        if (chip.key !== 'all' && count === 0) return null
        return (
          <button
            key={chip.key}
            type="button"
            className={`apc-chip${active === chip.key ? ' apc-chip--active' : ''}`}
            onClick={() => onSelect(chip.key)}
          >
            {chip.label} <span className="apc-chip__count">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

export function RowTable({
  rows,
  focusedRowNumbers,
  canMarkAccountLevelFee = false,
  onMarkAccountLevelFee,
}: {
  rows: ParsedSettlementRow[]
  focusedRowNumbers?: number[] | null
  canMarkAccountLevelFee?: boolean
  onMarkAccountLevelFee?: (rowNumber: number) => void | Promise<void>
}) {
  if (!rows.length) return <div className="apc-empty">No rows match the current filter.</div>
  const focusSet = focusedRowNumbers && focusedRowNumbers.length ? new Set(focusedRowNumbers) : null
  const showActions = canMarkAccountLevelFee && typeof onMarkAccountLevelFee === 'function'
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Amazon Order ID</th>
            <th>Category</th>
            <th>Row Type</th>
            <th>Transaction</th>
            <th>Amount Type</th>
            <th>Description</th>
            <th className="apc-money">Amount</th>
            <th>Status</th>
            <th>Blocking Reason</th>
            {showActions ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowNumber} className={focusSet?.has(row.rowNumber) ? 'apc-row--focused' : ''}>
              <td>{row.rowNumber}</td>
              <td>{row.orderId || '-'}</td>
              <td>{row.category || '-'}</td>
              <td>{row.rowClass || '-'}</td>
              <td>{row.transactionType || '-'}</td>
              <td>{row.amountType || '-'}</td>
              <td>{row.amountDescription || '-'}</td>
              <td className="apc-money">{money(row.amount)}</td>
              <td><RowStatusPill status={row.status as ParsedRowStatus} /></td>
              <td>{row.blockingReason || '-'}</td>
              {showActions ? (
                <td>
                  {row.status === 'unmatched' ? (
                    <button
                      className="ainv-btn ainv-btn--sm"
                      type="button"
                      onClick={() => void onMarkAccountLevelFee(row.rowNumber)}
                    >
                      Mark as account-level fee
                    </button>
                  ) : (
                    '-'
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
