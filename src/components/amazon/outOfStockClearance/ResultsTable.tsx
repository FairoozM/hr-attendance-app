import { useMemo, useState } from 'react'
import type { ClearanceResultRow, ManualMapping } from '../../../api/amazonOutOfStockClearance'

const STATUS_OPTIONS = [
  'all',
  'Ready to Update',
  'No Stock Available',
  'Zoho SKU Not Matched',
  'Vigil Not Matched',
  'Color/Base Match Used',
  'Needs Manual Review',
]

function statusBadgeClass(status: string) {
  const s = status.toLowerCase()
  if (s.includes('ready')) return 'ainv-badge ainv-badge--ok'
  if (s.includes('no stock')) return 'ainv-badge ainv-badge--neutral'
  if (s.includes('zoho')) return 'ainv-badge ainv-badge--warn'
  if (s.includes('vigil')) return 'ainv-badge ainv-badge--warn'
  if (s.includes('color') || s.includes('base')) return 'ainv-badge ainv-badge--ok'
  if (s.includes('manual')) return 'ainv-badge ainv-badge--danger'
  return 'ainv-badge ainv-badge--neutral'
}

interface ResultsTableProps {
  rows: ClearanceResultRow[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: (ids: string[]) => void
  manualMappings: Record<string, ManualMapping>
  onEditRow: (row: ClearanceResultRow) => void
}

export function ResultsTable({
  rows,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  manualMappings,
  onEditRow,
}: ResultsTableProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [matchFilter, setMatchFilter] = useState('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (matchFilter !== 'all' && row.matchMethod !== matchFilter) return false
      if (!q) return true
      return (
        row.amazonSku.toLowerCase().includes(q) ||
        row.amazonTitle.toLowerCase().includes(q) ||
        row.zohoSku.toLowerCase().includes(q) ||
        row.vigilMatchedCode.toLowerCase().includes(q)
      )
    })
  }, [rows, search, statusFilter, matchFilter])

  const readyIds = filtered.filter((r) => r.status === 'Ready to Update').map((r) => r.id)
  const allSelected = readyIds.length > 0 && readyIds.every((id) => selectedIds.has(id))

  return (
    <section className="ainv-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <h2 className="ainv-section-title">Recommendations</h2>
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <input
            type="search"
            placeholder="Search SKU or title"
            className="ainv-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="ainv-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s}
              </option>
            ))}
          </select>
          <select
            className="ainv-input"
            value={matchFilter}
            onChange={(e) => setMatchFilter(e.target.value)}
          >
            <option value="all">All match methods</option>
            <option value="direct">Direct</option>
            <option value="color_base">Color / base</option>
            <option value="manual">Manual</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>
      <div className="ainv-table-wrap mt-4" style={{ maxHeight: 'none' }}>
        <table className="ainv-table" style={{ minWidth: '1100px' }}>
          <thead>
            <tr>
              <th className="px-2 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleSelectAll(readyIds)}
                  aria-label="Select all ready rows"
                />
              </th>
              <th className="px-2 py-3">Marketplace</th>
              <th className="px-2 py-3">Amazon SKU</th>
              <th className="px-2 py-3">Title</th>
              <th className="px-2 py-3 text-right">Amazon qty</th>
              <th className="px-2 py-3 text-right">Zoho LS</th>
              <th className="px-2 py-3">Vigil</th>
              <th className="px-2 py-3 text-right">Vigil qty</th>
              <th className="px-2 py-3 text-right">Total</th>
              <th className="px-2 py-3 text-right">Recommended</th>
              <th className="px-2 py-3">Match</th>
              <th className="px-2 py-3">Status</th>
              <th className="px-2 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={13} className="py-8 text-center ainv-table__muted">
                  No rows match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const manual = manualMappings[row.amazonSku]
                const canSelect = row.status === 'Ready to Update'
                return (
                  <tr key={row.id}>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        disabled={!canSelect}
                        checked={selectedIds.has(row.id)}
                        onChange={() => onToggleSelect(row.id)}
                      />
                    </td>
                    <td className="px-2 py-2">{row.marketplace}</td>
                    <td className="px-2 py-2 font-mono text-xs">{row.amazonSku}</td>
                    <td className="max-w-[200px] truncate px-2 py-2" title={row.amazonTitle}>
                      {row.amazonTitle || '—'}
                    </td>
                    <td className="px-2 py-2 text-right">{row.amazonCurrentQty}</td>
                    <td className="px-2 py-2 text-right">{row.zohoLifeSmileQty}</td>
                    <td className="px-2 py-2">
                      <div className="font-mono text-xs">{row.vigilMatchedCode || '—'}</div>
                      {row.vigilMatchedName && (
                        <div className="truncate text-xs ainv-table__muted">{row.vigilMatchedName}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">{row.vigilQty}</td>
                    <td className="px-2 py-2 text-right">{row.totalAvailableQty}</td>
                    <td className="px-2 py-2 text-right ainv-table__qty-rec">
                      {row.recommendedAmazonUpdateQty}
                      {row.manuallyEdited || manual?.locked ? (
                        <span className="ml-1 text-xs ainv-table__status-inactive">*</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-xs">{row.matchMethod}</td>
                    <td className="px-2 py-2">
                      <span className={statusBadgeClass(row.status)}>{row.status}</span>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className="text-xs ainv-link-emerald"
                        onClick={() => onEditRow(row)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs ainv-table__muted">
        Showing {filtered.length} of {rows.length} rows. * = manually edited.
      </p>
    </section>
  )
}
