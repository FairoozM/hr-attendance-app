import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../Page.css'
import './AllPricesPage.css'
import { getAllPricesMarket, PRICES_MARKET_KSA, PRICES_MARKET_UAE } from './allPricesMarket'
import { ModernSelect } from '../../components/ui/ModernSelect'
import { ModernSearchInput } from '../../components/ui/ModernSearchInput'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import {
  fmtMoney,
  fmtPct,
  formatLastSavedAt,
  hydrateAllPricesStateFromBundle,
} from './allPricesEcommerceUtils'
import {
  filterHistoricalPrices,
  readAllHistoricalPriceRows,
} from './allPricesHistoricalPrices'
import { normalizeItemNo } from './allPricesVersioning'

function exportHistoricalRows(rows) {
  const payload = rows.map((row) => ({
    market: row.market,
    itemNo: row.itemNo,
    salesPriceAed: row.salesPriceAed,
    vat5: row.vat5,
    commission15: row.commission15,
    advertising15: row.advertising15,
    shipping: row.shipping,
    purchasePrice: row.purchasePrice,
    totalCost: row.totalCost,
    profitAed: row.profitAed,
    profitPercent: row.profitPercent,
    pricingStatus: row.pricingStatus,
    originalDateOfPrices: row.originalDateOfPrices,
    movedAt: row.movedAt,
    movedBy: row.movedBy,
    reason: row.reason,
    source: row.source,
    cleanupBatchId: row.cleanupBatchId,
    importBatchId: row.importBatchId,
  }))
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `historical-prices-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function HistoricalPricesPage() {
  const navigate = useNavigate()
  const { ready: prefsReady, getPref, prefsVersion } = useUserPreferences()
  const [regionFilter, setRegionFilter] = useState('all')
  const [filters, setFilters] = useState({
    search: '',
    source: '',
    reason: '',
    priceDateFrom: '',
    priceDateTo: '',
    movedFrom: '',
    movedTo: '',
  })

  const allHistoryRows = useMemo(() => {
    void prefsVersion
    return readAllHistoricalPriceRows()
  }, [getPref, prefsReady, prefsVersion])

  const activeItemsByMarket = useMemo(() => {
    void prefsVersion
    const uae = hydrateAllPricesStateFromBundle(
      getPref(getAllPricesMarket(PRICES_MARKET_UAE).prefs.ec, null),
    )
    const ksa = hydrateAllPricesStateFromBundle(
      getPref(getAllPricesMarket(PRICES_MARKET_KSA).prefs.ec, null),
    )
    return {
      [PRICES_MARKET_UAE]: new Set(
        uae.rows.map((row) => normalizeItemNo(row.itemNo)).filter(Boolean),
      ),
      [PRICES_MARKET_KSA]: new Set(
        ksa.rows.map((row) => normalizeItemNo(row.itemNo)).filter(Boolean),
      ),
    }
  }, [getPref, prefsVersion])

  const filteredRows = useMemo(
    () => filterHistoricalPrices(allHistoryRows, { ...filters, region: regionFilter }),
    [allHistoryRows, filters, regionFilter],
  )

  const sourceOptions = useMemo(
    () => [...new Set(allHistoryRows.map((row) => row.source).filter(Boolean))].sort(),
    [allHistoryRows],
  )

  if (!prefsReady) {
    return (
      <div className="page ap-ec-page">
        <div className="doc-page-hero">
          <div>
            <h1 className="doc-page-title">Historical Prices</h1>
            <p className="doc-page-subtitle">Loading historical price snapshots…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">Historical Prices</h1>
          <p className="doc-page-subtitle">
            Audit old, replaced, imported older, and duplicate-cleaned prices for UAE and KSA. These rows are never used
            for active composite pricing.
          </p>
        </div>
      </div>

      <section className="page-section ap-ec-wrap">
        <div className="ap-ec-toolbar ap-ec-toolbar--filters">
          <ModernSelect
            value={regionFilter}
            options={[
              { value: 'all',              label: 'All markets' },
              { value: PRICES_MARKET_UAE,  label: 'UAE'         },
              { value: PRICES_MARKET_KSA,  label: 'KSA'         },
            ]}
            onChange={setRegionFilter}
            aria-label="Market"
          />
          <ModernSearchInput
            placeholder="Search item no."
            value={filters.search}
            onChange={(v) => setFilters((prev) => ({ ...prev, search: v }))}
          />
          <ModernSelect
            value={filters.source}
            placeholder="All sources"
            options={[
              { value: '', label: 'All sources' },
              ...sourceOptions.map((source) => ({ value: source, label: source })),
            ]}
            onChange={(v) => setFilters((prev) => ({ ...prev, source: v }))}
          />
          <ModernSearchInput
            placeholder="Reason contains…"
            value={filters.reason}
            onChange={(v) => setFilters((prev) => ({ ...prev, reason: v }))}
          />
          <label>
            Price from{' '}
            <input
              type="date"
              value={filters.priceDateFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, priceDateFrom: e.target.value }))}
            />
          </label>
          <label>
            Price to{' '}
            <input
              type="date"
              value={filters.priceDateTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, priceDateTo: e.target.value }))}
            />
          </label>
          <label>
            Moved from{' '}
            <input
              type="date"
              value={filters.movedFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, movedFrom: e.target.value }))}
            />
          </label>
          <label>
            Moved to{' '}
            <input
              type="date"
              value={filters.movedTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, movedTo: e.target.value }))}
            />
          </label>
        </div>

        <div className="ap-ec-toolbar">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => exportHistoricalRows(filteredRows)}
            disabled={!filteredRows.length}
          >
            Export historical prices
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/prices/all-prices')}>
            All Prices (UAE)
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/prices/all-prices-ksa')}>
            All Prices (KSA)
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              setFilters({
                search: '',
                source: '',
                reason: '',
                priceDateFrom: '',
                priceDateTo: '',
                movedFrom: '',
                movedTo: '',
              })
            }
          >
            Clear filters
          </button>
          <span className="ap-ec-save-last">
            {filteredRows.length} of {allHistoryRows.length} historical rows
          </span>
        </div>

        <div className="ap-table-scroll">
          <table className="ap-ec-table ap-ec-table--history">
            <thead>
              <tr>
                <th>Market</th>
                <th>Item No.</th>
                <th>Sales Price AED</th>
                <th>VAT</th>
                <th>Commission</th>
                <th>Advertising</th>
                <th>Shipping</th>
                <th>Purchase Price</th>
                <th>Total Cost</th>
                <th>Profit AED</th>
                <th>Profit %</th>
                <th>Pricing Status</th>
                <th>Original Date</th>
                <th>Moved At</th>
                <th>Moved By</th>
                <th>Reason</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={18} className="ap-ec-empty">
                    No historical prices match these filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const rowMarket = row.market || PRICES_MARKET_UAE
                  const marketCfg = getAllPricesMarket(rowMarket)
                  const activeSet = activeItemsByMarket[rowMarket]
                  const itemKey = normalizeItemNo(row.itemNo)
                  return (
                    <tr key={`${rowMarket}-${row.historicalPriceId}`}>
                      <td>{marketCfg.label}</td>
                      <td>{row.itemNo}</td>
                      <td>{fmtMoney(row.salesPriceAed, 0)}</td>
                      <td>{fmtMoney(row.vat5)}</td>
                      <td>{fmtMoney(row.commission15)}</td>
                      <td>{fmtMoney(row.advertising15)}</td>
                      <td>{fmtMoney(row.shipping)}</td>
                      <td>{fmtMoney(row.purchasePrice)}</td>
                      <td>{fmtMoney(row.totalCost)}</td>
                      <td>{fmtMoney(row.profitAed)}</td>
                      <td>{fmtPct(row.profitPercent)}</td>
                      <td>{row.pricingStatus || '—'}</td>
                      <td>{row.originalDateOfPrices || '—'}</td>
                      <td>{formatLastSavedAt(row.movedAt)}</td>
                      <td>{row.movedBy || '—'}</td>
                      <td>{row.reason || '—'}</td>
                      <td>{row.source || '—'}</td>
                      <td>
                        {activeSet?.has(itemKey) ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => navigate(marketCfg.routeAllPrices)}
                          >
                            View current
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
