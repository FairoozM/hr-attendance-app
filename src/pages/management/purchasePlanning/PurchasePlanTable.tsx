import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BadgeTone, MatchType, PlanFilters, PlanItem, PlanItemPatch, PurchasePlan, SortState } from './purchasePlanningTypes'
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

const DEFAULT_PLAN_SORT: SortState = { key: 'sku', direction: 'asc' }

const MATCH_BADGES: Record<MatchType, { label: string; tone: BadgeTone }> = {
  exact: { label: 'Exact', tone: 'success' },
  parent: { label: 'Parent', tone: 'warning' },
  not_found: { label: 'Not found', tone: 'danger' },
}

const PLAN_TABLE_COLUMNS = 14

interface PurchasePlanTableProps {
  plan: PurchasePlan | null
  filters: PlanFilters
  onFiltersChange: (filters: PlanFilters) => void
  onItemChange: (itemId: number, patch: PlanItemPatch) => Promise<void> | void
  readOnly?: boolean
}

export function PurchasePlanTable({ plan, filters, onFiltersChange, onItemChange, readOnly = false }: PurchasePlanTableProps) {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [planSort, setPlanSort] = useState(DEFAULT_PLAN_SORT)
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({})
  const [editedIds, setEditedIds] = useState<Set<number>>(() => new Set())
  const [savingItemId, setSavingItemId] = useState<number | null>(null)
  const editedIdsRef = useRef(editedIds)
  editedIdsRef.current = editedIds

  const serverQtyKey = useMemo(
    () => (plan?.items || []).map((item) => `${item.id}:${item.finalQty}`).join('|'),
    [plan?.items]
  )

  useEffect(() => {
    editedIdsRef.current = new Set()
    setEditedIds(new Set())
  }, [plan?.id])

  useEffect(() => {
    setQtyDrafts((prev) => {
      const next: Record<number, string> = {}
      const edited = editedIdsRef.current
      for (const item of plan?.items || []) {
        next[item.id] = edited.has(item.id) ? (prev[item.id] ?? String(item.finalQty ?? 0)) : String(item.finalQty ?? 0)
      }
      return next
    })
    setSavingItemId(null)
  }, [plan?.id, plan?.items, serverQtyKey])

  const commitFinalQty = useCallback(
    async (item: PlanItem) => {
      if (readOnly) return
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

  const setFilter = <K extends keyof PlanFilters>(key: K, value: PlanFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value })
  const toggleQuick = (quick: PlanFilters['quick']) => setFilter('quick', filters.quick === quick ? '' : quick)
  const sortProps = { sort: planSort, onSort: setPlanSort, nextSortFn: nextSort }

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
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search SKU, name, or Vigil code"
          />
          <div className="pp-filter-chips">
            <FilterChip active={filters.quick === ''} onClick={() => setFilter('quick', '')}>
              All
            </FilterChip>
            <FilterChip
              active={filters.quick === 'need-order'}
              onClick={() => toggleQuick('need-order')}
            >
              Need order
            </FilterChip>
            <FilterChip
              active={filters.quick === 'missing-price'}
              onClick={() => toggleQuick('missing-price')}
            >
              Missing price
            </FilterChip>
            <FilterChip
              active={filters.quick === 'no-wholesale'}
              onClick={() => toggleQuick('no-wholesale')}
            >
              No wholesale
            </FilterChip>
          </div>
          <select value={filters.matchStatus} onChange={(e) => setFilter('matchStatus', e.target.value as PlanFilters['matchStatus'])}>
            <option value="">Any match</option>
            <option value="exact">Exact</option>
            <option value="parent">Parent</option>
            <option value="not_found">Not found</option>
          </select>
          <select
            value={filters.includedStatus}
            onChange={(e) => setFilter('includedStatus', e.target.value as PlanFilters['includedStatus'])}
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
            {rows.length} of {plan.items?.length ?? 0} lines
          </span>
        </div>
        {showAdvancedFilters && (
          <div className="pp-filter-toolbar__advanced pp-filter-toolbar__advanced--wide">
            <label>
              <span>Zoho stock</span>
              <input
                type="number"
                value={filters.stockMin}
                onChange={(e) => setFilter('stockMin', e.target.value)}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.stockMax}
                onChange={(e) => setFilter('stockMax', e.target.value)}
                placeholder="Max"
              />
            </label>
            <label>
              <span>Vigil</span>
              <input
                type="number"
                value={filters.wholesaleMin}
                onChange={(e) => setFilter('wholesaleMin', e.target.value)}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.wholesaleMax}
                onChange={(e) => setFilter('wholesaleMax', e.target.value)}
                placeholder="Max"
              />
            </label>
            <label>
              <span>Sales 3M</span>
              <input
                type="number"
                value={filters.salesMin}
                onChange={(e) => setFilter('salesMin', e.target.value)}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.salesMax}
                onChange={(e) => setFilter('salesMax', e.target.value)}
                placeholder="Max"
              />
            </label>
            <label>
              <span>Final qty</span>
              <input
                type="number"
                value={filters.finalMin}
                onChange={(e) => setFilter('finalMin', e.target.value)}
                placeholder="Min"
              />
              <input
                type="number"
                value={filters.finalMax}
                onChange={(e) => setFilter('finalMax', e.target.value)}
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
              <SortHeader label="SKU" sortKey="sku" {...sortProps} />
              <SortHeader label="Product Name" sortKey="itemName" {...sortProps} />
              <SortHeader label="Zoho Stock" sortKey="currentZohoStock" {...sortProps} />
              <SortHeader label="Sales 3M" sortKey="totalSalesLast3Months" {...sortProps} />
              <SortHeader
                label="Bundle 3M"
                sortKey="totalBundleUsageLast3Months"
                {...sortProps}
              />
              <SortHeader label="Total Usage" sortKey="totalUsage" {...sortProps} />
              <SortHeader label="Suggested" sortKey="suggestedQty" {...sortProps} />
              <SortHeader label="Vigil Avail." sortKey="wholesaleAvailableQty" {...sortProps} />
              <SortHeader label="Final Qty" sortKey="finalQty" {...sortProps} />
              <SortHeader label="Price" sortKey="purchasePrice" {...sortProps} />
              <SortHeader label="Line Total" sortKey="lineTotal" {...sortProps} />
              <SortHeader label="Match" sortKey="matchType" {...sortProps} />
              <SortHeader label="Notes" sortKey="notes" {...sortProps} />
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
                    <Badge tone={MATCH_BADGES[item.matchType]?.tone || 'muted'}>
                      {MATCH_BADGES[item.matchType]?.label || item.matchType}
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
                <td colSpan={PLAN_TABLE_COLUMNS} className="pp-empty-cell">
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
