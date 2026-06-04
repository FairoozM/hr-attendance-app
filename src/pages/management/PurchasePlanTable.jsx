import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, FilterChip, RowBadgeList, SortHeader } from './PurchasePlanningBadges'
import {
  EMPTY_FILTERS,
  fmt,
  fmtPrice,
  getPlanRowBadges,
  getStockRemark,
  includesAnyText,
  inNumberRange,
  nextSort,
  sortRows,
} from './purchasePlanningUtils'

const DEFAULT_PLAN_SORT = { key: 'sku', direction: 'asc' }

export function PurchasePlanTable({ plan, filters, onFiltersChange, onItemChange, readOnly = false }) {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [planSort, setPlanSort] = useState(DEFAULT_PLAN_SORT)
  const [qtyDrafts, setQtyDrafts] = useState({})
  const [editedIds, setEditedIds] = useState(() => new Set())
  const [savingItemId, setSavingItemId] = useState(null)

  useEffect(() => {
    const next = {}
    for (const item of plan?.items || []) {
      next[item.id] = String(item.finalQty ?? 0)
    }
    setQtyDrafts(next)
    setEditedIds(new Set())
    setSavingItemId(null)
  }, [plan?.id])

  const commitFinalQty = useCallback(
    async (item) => {
      if (readOnly || !item) return
      const raw = qtyDrafts[item.id]
      if (raw === '' || raw == null) return
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) return
      const nextQty = Math.floor(parsed)
      if (nextQty === Number(item.finalQty || 0)) {
        setEditedIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
        return
      }
      setSavingItemId(item.id)
      try {
        await onItemChange(item.id, { finalQty: nextQty })
        setEditedIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      } finally {
        setSavingItemId((current) => (current === item.id ? null : current))
      }
    },
    [onItemChange, qtyDrafts, readOnly]
  )

  const filteredRows = useMemo(() => {
    const source = plan?.items || []
    return source.filter((item) => {
      if (filters.matchStatus && item.matchType !== filters.matchStatus) return false
      if (!includesAnyText([item.sku, item.itemName, item.vigilCode], filters.search)) return false
      if (filters.quick === 'need-order' && Number(item.finalQty || 0) <= 0) return false
      if (filters.quick === 'no-wholesale' && Number(item.wholesaleAvailableQty || 0) > 0 && item.matchType !== 'not_found')
        return false
      if (filters.quick === 'missing-price' && Number(item.purchasePrice || 0) > 0) return false
      if (filters.quick === 'composite-used' && Number(item.totalBundleUsageLast3Months || 0) <= 0) return false
      if (!inNumberRange(item.currentZohoStock, filters.stockMin, filters.stockMax)) return false
      if (!inNumberRange(item.wholesaleAvailableQty, filters.wholesaleMin, filters.wholesaleMax)) return false
      if (!inNumberRange(item.totalSalesLast3Months, filters.salesMin, filters.salesMax)) return false
      if (!inNumberRange(item.totalBundleUsageLast3Months, filters.bundleMin, filters.bundleMax)) return false
      if (!inNumberRange(item.suggestedQty, filters.suggestedMin, filters.suggestedMax)) return false
      if (!inNumberRange(item.finalQty, filters.finalMin, filters.finalMax)) return false
      if (filters.includedStatus === 'included' && !item.included) return false
      if (filters.includedStatus === 'ignored' && item.included) return false
      return true
    })
  }, [plan, filters])

  const rows = useMemo(
    () =>
      sortRows(filteredRows, planSort, {
        sku: (item) => item.sku,
        itemName: (item) => item.itemName,
        currentZohoStock: (item) => Number(item.currentZohoStock || 0),
        totalSalesLast3Months: (item) => Number(item.totalSalesLast3Months || 0),
        totalBundleUsageLast3Months: (item) => Number(item.totalBundleUsageLast3Months || 0),
        totalUsage: (item) => Number(item.totalUsageLast3Months || 0),
        suggestedQty: (item) => Number(item.suggestedQty || 0),
        wholesaleAvailableQty: (item) => Number(item.wholesaleAvailableQty || 0),
        finalQty: (item) => Number(item.finalQty || 0),
        purchasePrice: (item) => Number(item.purchasePrice || 0),
        lineTotal: (item) => Number(item.finalQty || 0) * Number(item.purchasePrice || 0),
        matchType: (item) => item.matchType,
        notes: (item) => item.notes,
        included: (item) => (item.included ? 1 : 0),
      }),
    [filteredRows, planSort]
  )

  if (!plan) {
    return <div className="pp-empty">Open or generate a draft plan to review lines.</div>
  }

  return (
    <>
      <div className="pp-filter-toolbar">
        <div className="pp-filter-toolbar__main">
          <input
            className="pp-filter-search"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Search SKU, name, or Vigil code"
          />
          <div className="pp-filter-chips">
            <FilterChip active={filters.quick === ''} onClick={() => onFiltersChange({ ...filters, quick: '' })}>
              All
            </FilterChip>
            <FilterChip
              active={filters.quick === 'need-order'}
              onClick={() => onFiltersChange({ ...filters, quick: filters.quick === 'need-order' ? '' : 'need-order' })}
            >
              Need order
            </FilterChip>
            <FilterChip
              active={filters.quick === 'missing-price'}
              onClick={() =>
                onFiltersChange({ ...filters, quick: filters.quick === 'missing-price' ? '' : 'missing-price' })
              }
            >
              Missing price
            </FilterChip>
            <FilterChip
              active={filters.quick === 'no-wholesale'}
              onClick={() =>
                onFiltersChange({ ...filters, quick: filters.quick === 'no-wholesale' ? '' : 'no-wholesale' })
              }
            >
              No wholesale
            </FilterChip>
          </div>
          <select value={filters.matchStatus} onChange={(e) => onFiltersChange({ ...filters, matchStatus: e.target.value })}>
            <option value="">Any match</option>
            <option value="exact">Exact</option>
            <option value="parent">Parent</option>
            <option value="not_found">Not found</option>
          </select>
          <select
            value={filters.includedStatus}
            onChange={(e) => onFiltersChange({ ...filters, includedStatus: e.target.value })}
          >
            <option value="">Any</option>
            <option value="included">Included</option>
            <option value="ignored">Excluded</option>
          </select>
          <button type="button" className="btn btn--sm" onClick={() => setShowAdvancedFilters((v) => !v)}>
            {showAdvancedFilters ? 'Hide advanced' : 'Advanced'}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
            Clear
          </button>
          <span className="pp-filter-count">
            {rows.length} of {plan.items.length} lines
          </span>
        </div>
        {showAdvancedFilters && (
          <div className="pp-filter-toolbar__advanced pp-filter-toolbar__advanced--wide">
            <label>
              <span>Zoho stock</span>
              <input
                type="number"
                value={filters.stockMin}
                onChange={(e) => onFiltersChange({ ...filters, stockMin: e.target.value })}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.stockMax}
                onChange={(e) => onFiltersChange({ ...filters, stockMax: e.target.value })}
                placeholder="Max"
              />
            </label>
            <label>
              <span>Vigil</span>
              <input
                type="number"
                value={filters.wholesaleMin}
                onChange={(e) => onFiltersChange({ ...filters, wholesaleMin: e.target.value })}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.wholesaleMax}
                onChange={(e) => onFiltersChange({ ...filters, wholesaleMax: e.target.value })}
                placeholder="Max"
              />
            </label>
            <label>
              <span>Sales 3M</span>
              <input
                type="number"
                value={filters.salesMin}
                onChange={(e) => onFiltersChange({ ...filters, salesMin: e.target.value })}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.salesMax}
                onChange={(e) => onFiltersChange({ ...filters, salesMax: e.target.value })}
                placeholder="Max"
              />
            </label>
            <label>
              <span>Final qty</span>
              <input
                type="number"
                value={filters.finalMin}
                onChange={(e) => onFiltersChange({ ...filters, finalMin: e.target.value })}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.finalMax}
                onChange={(e) => onFiltersChange({ ...filters, finalMax: e.target.value })}
                placeholder="Max"
              />
            </label>
          </div>
        )}
      </div>

      <div className="doc-table-wrap">
        <table className="doc-table pp-plan-table">
          <thead>
            <tr>
              <th>Include</th>
              <SortHeader label="SKU" sortKey="sku" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Product Name" sortKey="itemName" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Zoho Stock" sortKey="currentZohoStock" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Sales 3M" sortKey="totalSalesLast3Months" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader
                label="Bundle 3M"
                sortKey="totalBundleUsageLast3Months"
                sort={planSort}
                onSort={setPlanSort}
                nextSortFn={nextSort}
              />
              <SortHeader label="Total Usage" sortKey="totalUsage" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Suggested" sortKey="suggestedQty" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Vigil Avail." sortKey="wholesaleAvailableQty" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Final Qty" sortKey="finalQty" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Price" sortKey="purchasePrice" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Line Total" sortKey="lineTotal" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Match" sortKey="matchType" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
              <SortHeader label="Notes" sortKey="notes" sort={planSort} onSort={setPlanSort} nextSortFn={nextSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const lineTotal = Number(item.finalQty || 0) * Number(item.purchasePrice || 0)
              const badges = getPlanRowBadges(item)
              const isEdited = editedIds.has(item.id)
              return (
                <tr key={item.id} className={!item.included ? 'pp-row--muted' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(item.included)}
                      disabled={readOnly}
                      onChange={() => onItemChange(item.id, { included: !item.included })}
                      aria-label={`Include ${item.sku}`}
                    />
                  </td>
                  <td>
                    <strong className="pp-mono">{item.sku}</strong>
                    <RowBadgeList badges={badges} />
                  </td>
                  <td>{item.itemName}</td>
                  <td>{fmt(item.currentZohoStock)}</td>
                  <td>{fmt(item.totalSalesLast3Months)}</td>
                  <td>{fmt(item.totalBundleUsageLast3Months)}</td>
                  <td>{fmt(item.totalUsageLast3Months)}</td>
                  <td>{item.suggestedQty}</td>
                  <td>{fmt(item.wholesaleAvailableQty)}</td>
                  <td>
                    <div className="pp-qty-cell">
                      <input
                        className={`pp-qty-input${isEdited ? ' pp-qty-input--edited' : ''}`}
                        type="number"
                        min="0"
                        disabled={readOnly || savingItemId === item.id}
                        value={qtyDrafts[item.id] ?? String(item.finalQty ?? 0)}
                        onChange={(e) => {
                          setQtyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                          setEditedIds((prev) => new Set(prev).add(item.id))
                        }}
                        onBlur={() => commitFinalQty(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitFinalQty(item)
                          }
                        }}
                      />
                      {isEdited && <span className="pp-edited-tag">Unsaved</span>}
                      {savingItemId === item.id && <span className="pp-edited-tag">Saving…</span>}
                    </div>
                  </td>
                  <td className={item.purchasePrice ? 'pp-price-cell' : 'pp-price-cell pp-price-cell--missing'}>
                    {fmtPrice(item.purchasePrice)}
                  </td>
                  <td className="pp-price-cell">{lineTotal > 0 ? fmtPrice(lineTotal) : '—'}</td>
                  <td>
                    <Badge tone={item.matchType === 'exact' ? 'success' : item.matchType === 'parent' ? 'warning' : 'danger'}>
                      {item.matchType}
                    </Badge>
                  </td>
                  <td className={getStockRemark(item) ? 'pp-remark pp-remark--danger' : 'pp-remark'}>
                    {item.notes || getStockRemark(item) || '—'}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan="14" className="pp-empty-cell">
                  No lines match filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
