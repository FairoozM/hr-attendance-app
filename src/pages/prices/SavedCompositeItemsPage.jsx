import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import '../Page.css'
import '../management/DocumentExpiryPage.css'
import '../management/AllPricesPage.css'
import './CompositeItemsPricesPage.css'
import {
  fmtMoney,
  fmtPct,
  STORAGE_KEY_RATES,
  STORAGE_KEY_ROWS,
} from '../management/allPricesEcommerceUtils'
import {
  loadSavedCompositeItems,
  removeSavedCompositeItem,
  SAVED_COMPOSITES_UPDATED_EVENT,
  STORAGE_KEY_SAVED_COMPOSITES,
} from './compositeBundlePricingUtils'

function formatSavedDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CompositeDetailTable({ item }) {
  const rows = Array.isArray(item.components) ? item.components : []
  const economics = item.economics || {}
  return (
    <div className="ap-table-scroll cb-table-scroll cb-saved-detail">
      <table className="ap-ec-table cb-bundle-table">
        <thead>
          <tr>
            <th scope="col">Composite item no.</th>
            <th scope="col">Component item no.</th>
            <th scope="col">Matched All Prices SKU</th>
            <th scope="col">Qty</th>
            <th scope="col">Purchase price ecommerce</th>
            <th scope="col">Total component purchase</th>
            <th scope="col">Manual shipping</th>
            <th scope="col" className="cb-sales-price-cell">Suggested sales price</th>
            <th scope="col">{item.rates?.vatPct ?? 5}% VAT</th>
            <th scope="col">{item.rates?.commissionPct ?? 15}% commission</th>
            <th scope="col">{item.rates?.advertisingPct ?? 15}% advertising</th>
            <th scope="col">Total cost</th>
            <th scope="col">Profit AED</th>
            <th scope="col" className="cb-profit-percent-cell">Profit %</th>
            <th scope="col">Date of price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${item.sku}-${row.item_id || row.sku || idx}`}>
              <td>{item.sku}</td>
              <td className="cb-component-cell">
                <span className="cb-component-cell__sku">{row.sku || '—'}</span>
                {row.name && String(row.name).trim().toLowerCase() !== String(row.sku || '').trim().toLowerCase() ? (
                  <span className="cb-component-cell__name">{row.name}</span>
                ) : null}
              </td>
              <td className="cb-match-cell">
                {row.purchaseMatch ? (
                  <>
                    <span className="cb-match-cell__sku">{row.purchaseMatch.itemNo}</span>
                    {row.purchaseMatch.matchKind === 'base_without_color' ? (
                      <span className="cb-match-cell__hint">Base SKU match</span>
                    ) : null}
                  </>
                ) : (
                  <span className="cb-missing">—</span>
                )}
              </td>
              <td>{Number.isFinite(Number(row.quantity)) ? String(row.quantity) : '—'}</td>
              <td>{row.missing ? <span className="cb-missing">—</span> : fmtMoney(row.purchaseFromList, 2)}</td>
              <td>{row.lineTotal != null ? fmtMoney(row.lineTotal, 2) : '—'}</td>
              <td>
                {row.matchedListRow && Number.isFinite(Number(row.matchedListRow.shipping))
                  ? fmtMoney(row.matchedListRow.shipping, 2)
                  : '—'}
              </td>
              <td className="cb-sales-price-cell">
                {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                  ? fmtMoney(row.matchedEconomics.salesPrice, 0)
                  : '—'}
              </td>
              <td>
                {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                  ? fmtMoney(row.matchedEconomics.vatAmount, 2)
                  : '—'}
              </td>
              <td>
                {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                  ? fmtMoney(row.matchedEconomics.commissionAmount, 2)
                  : '—'}
              </td>
              <td>
                {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                  ? fmtMoney(row.matchedEconomics.advertisingAmount, 2)
                  : '—'}
              </td>
              <td>
                {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                  ? fmtMoney(row.matchedEconomics.totalCost, 2)
                  : '—'}
              </td>
              <td>
                {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                  ? fmtMoney(row.matchedEconomics.profit, 2)
                  : '—'}
              </td>
              <td className="cb-profit-percent-cell">
                {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                  ? fmtPct(row.matchedEconomics.profitPct, 2)
                  : '—'}
              </td>
              <td>{row.matchedListRow?.dateOfPrices || '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="cb-bundle-summary">
            <td className="cb-bundle-summary__label">Bundle totals</td>
            <td className="cb-bundle-summary__spacer" aria-hidden="true" />
            <td className="cb-bundle-summary__spacer" aria-hidden="true" />
            <td className="cb-bundle-summary__spacer" aria-hidden="true" />
            <td className="cb-bundle-summary__spacer" aria-hidden="true" />
            <td>{fmtMoney(item.totalPurchaseCost, 2)}</td>
            <td>{fmtMoney(item.bundleShipping, 2)}</td>
            <td className="cb-sales-price-cell">{economics.ok ? fmtMoney(economics.salesPrice, 0) : '—'}</td>
            <td>{economics.ok ? fmtMoney(economics.vatAmount, 2) : '—'}</td>
            <td>{economics.ok ? fmtMoney(economics.commissionAmount, 2) : '—'}</td>
            <td>{economics.ok ? fmtMoney(economics.advertisingAmount, 2) : '—'}</td>
            <td>{economics.ok ? fmtMoney(economics.totalCost, 2) : '—'}</td>
            <td>{economics.ok ? fmtMoney(economics.profit, 2) : '—'}</td>
            <td className="cb-profit-percent-cell">{economics.ok ? fmtPct(economics.profitPct, 2) : '—'}</td>
            <td>{item.dateOfPrice || '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function SavedCompositeItemsPage() {
  const [syncTick, setSyncTick] = useState(0)
  const [expanded, setExpanded] = useState(() => new Set())
  const [searchText, setSearchText] = useState('')

  useEffect(() => {
    const bump = (event) => {
      if (
        event.type === SAVED_COMPOSITES_UPDATED_EVENT ||
        event.type === 'focus' ||
        event.key === STORAGE_KEY_SAVED_COMPOSITES ||
        event.key === STORAGE_KEY_ROWS ||
        event.key === STORAGE_KEY_RATES
      ) {
        setSyncTick((t) => t + 1)
      }
    }
    window.addEventListener(SAVED_COMPOSITES_UPDATED_EVENT, bump)
    window.addEventListener('storage', bump)
    window.addEventListener('focus', bump)
    return () => {
      window.removeEventListener(SAVED_COMPOSITES_UPDATED_EVENT, bump)
      window.removeEventListener('storage', bump)
      window.removeEventListener('focus', bump)
    }
  }, [])

  const savedItems = useMemo(() => {
    void syncTick
    return loadSavedCompositeItems()
  }, [syncTick])

  const filteredItems = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return savedItems
    return savedItems.filter((item) => (
      String(item.sku || '').toLowerCase().includes(q) ||
      String(item.name || '').toLowerCase().includes(q)
    ))
  }, [savedItems, searchText])

  const toggleExpanded = useCallback((sku) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }, [])

  const handleRemove = useCallback((sku) => {
    if (!window.confirm(`Remove saved composite item ${sku}?`)) return
    removeSavedCompositeItem(sku)
    setExpanded((prev) => {
      const next = new Set(prev)
      next.delete(sku)
      return next
    })
    setSyncTick((t) => t + 1)
  }, [])

  return (
    <div className="page composite-prices-page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">Saved Composite Items</h1>
          <p className="doc-page-subtitle">
            Saved composite SKUs from the calculator. Each row shows the bundle totals; use the plus icon to expand
            the saved component table.
          </p>
        </div>
      </div>

      <section className="page-section cb-bundle-section" aria-label="Saved composite item SKUs">
        <div className="cb-bundle-toolbar">
          <NavLink className="btn btn--primary" to="/prices/composite-items">
            + Add / fetch composite
          </NavLink>
          <button type="button" className="btn btn--ghost" onClick={() => setSyncTick((t) => t + 1)}>
            Sync saved list
          </button>
          <label className="cb-saved-search">
            <span className="cb-saved-search__label">Search SKU / name</span>
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search saved composites..."
              autoComplete="off"
            />
          </label>
        </div>

        {savedItems.length === 0 ? (
          <p className="composite-prices-placeholder">
            No composite SKUs saved yet. Open <NavLink to="/prices/composite-items">Composite Items Prices</NavLink>,
            fetch a composite item, then click <strong>Save composite item</strong>.
          </p>
        ) : filteredItems.length === 0 ? (
          <p className="composite-prices-placeholder">
            No saved composite items match <strong>{searchText}</strong>.
          </p>
        ) : (
          <div className="ap-table-scroll cb-table-scroll">
            <table className="ap-ec-table cb-saved-table">
              <thead>
                <tr>
                  <th scope="col" className="cb-saved-table__toggle">+</th>
                  <th scope="col">Composite SKU</th>
                  <th scope="col">Name</th>
                  <th scope="col">Components</th>
                  <th scope="col">Total purchase</th>
                  <th scope="col">Manual shipping</th>
                  <th scope="col" className="cb-sales-price-cell">Suggested sales price</th>
                  <th scope="col">Total cost</th>
                  <th scope="col">Profit AED</th>
                  <th scope="col" className="cb-profit-percent-cell">Profit %</th>
                  <th scope="col">Date of price</th>
                  <th scope="col">Saved</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const economics = item.economics || {}
                  const isOpen = expanded.has(item.sku)
                  return (
                    <Fragment key={item.sku}>
                      <tr key={`${item.sku}-summary`} className="cb-saved-table__summary-row">
                        <td>
                          <button
                            type="button"
                            className="cb-saved-expand-btn"
                            onClick={() => toggleExpanded(item.sku)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${item.sku}`}
                          >
                            {isOpen ? '-' : '+'}
                          </button>
                        </td>
                        <td>
                          <strong>{item.sku}</strong>
                          {item.composite_item_id ? (
                            <span className="cb-saved-table__sub">ID {item.composite_item_id}</span>
                          ) : null}
                        </td>
                        <td>{item.name || '—'}</td>
                        <td>{Array.isArray(item.components) ? item.components.length : 0}</td>
                        <td>{fmtMoney(item.totalPurchaseCost, 2)}</td>
                        <td>{fmtMoney(item.bundleShipping, 2)}</td>
                        <td className="cb-sales-price-cell">{economics.ok ? fmtMoney(economics.salesPrice, 0) : '—'}</td>
                        <td>{economics.ok ? fmtMoney(economics.totalCost, 2) : '—'}</td>
                        <td>{economics.ok ? fmtMoney(economics.profit, 2) : '—'}</td>
                        <td className="cb-profit-percent-cell">{economics.ok ? fmtPct(economics.profitPct, 2) : '—'}</td>
                        <td>{item.dateOfPrice || '—'}</td>
                        <td>{formatSavedDate(item.updated_at)}</td>
                        <td>
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleRemove(item.sku)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr key={`${item.sku}-detail`} className="cb-saved-table__detail-row">
                          <td colSpan={13}>
                            <CompositeDetailTable item={item} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
