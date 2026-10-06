import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  getKsaActions,
  getKsaCapacityRelease,
  getKsaInactiveWithStock,
  getKsaInventoryHealth,
  getKsaRemovalOrders,
  type ActionsResponse,
  type CapacityReleaseResponse,
  type HealthFilter,
  type HealthRow,
  type HealthStatus,
  type InactiveWithStockResponse,
  type InventoryHealthResponse,
  type RemovalOrdersResponse,
  type RemovalStatusFilter,
} from '../../api/amazonControlTower'
import { useRefreshRun } from './useRefreshRun'
import {
  DASH,
  Empty,
  HEALTH_LABEL,
  HealthBadge,
  Kpi,
  ListingStatusBadge,
  MappingIndicatorBadge,
  RunProgress,
  SectionHeader,
  SourceMeta,
  errorText,
  fmtDate,
  fmtDateTime,
  fmtInt,
  fmtNum,
  fmtPct,
  fmtVolume,
  humanize,
} from './controlTowerUi'
import '../../styles/amazonInventoryPage.css'

type TabKey = 'health' | 'inactive' | 'removals' | 'release' | 'actions'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'health', label: 'Inventory Health' },
  { key: 'inactive', label: 'Inactive with FBA Stock' },
  { key: 'removals', label: 'Removal Orders' },
  { key: 'release', label: 'Capacity Release' },
  { key: 'actions', label: 'Daily Actions' },
]

const HEALTH_FILTERS: { value: HealthFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive_with_stock', label: 'Inactive with Stock' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'all', label: 'All' },
]

const HEALTH_STATUSES: HealthStatus[] = ['ZERO_SALES', 'AGED', 'EXCESS', 'OUT_ZERO_FBA', 'SLOW', 'WATCH', 'DATA_INCOMPLETE', 'HEALTHY']

const REASON_LABEL: Record<string, string> = {
  INACTIVE_LISTING_WITH_AMAZON_STOCK: 'INACTIVE LISTING WITH AMAZON STOCK',
  UNFULFILLABLE: 'UNFULFILLABLE',
  ZERO_SALES_90D: 'ZERO SALES 90D',
  AGED_INVENTORY: 'AGED',
  EXCESS_COVER: 'EXCESS COVER',
  VERY_LOW_VELOCITY: 'VERY LOW VELOCITY',
}

const SALES_SOURCE_LABEL: Record<string, string> = {
  APP_DAILY_SALES: 'app daily sales',
  AMAZON_PLANNING_UNITS_SHIPPED: 'Amazon planning report (units shipped)',
}

/** Loads on mount, whenever `fetcher` changes (filters) and whenever `reloadKey` changes (after a refresh run). */
function useLoader<T>(fetcher: () => Promise<T>, reloadKey: number) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetcher())
      setError('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [fetcher])
  useEffect(() => {
    void load()
  }, [load, reloadKey])
  return { data, loading, error, load }
}

function FilterButtons<T extends string>({ options, value, onChange, counts }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; counts?: Partial<Record<T, number>> }) {
  return (
    <div className="flex flex-wrap gap-2" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} className={`ainv-btn ${value === o.value ? 'ainv-btn--primary-sky' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
          {counts && counts[o.value] != null ? ` (${fmtInt(counts[o.value])})` : ''}
        </button>
      ))}
    </div>
  )
}

function ageText(r: HealthRow): string {
  if (!r.oldestAgeBucket) return r.physicalFbaUnits > 0 ? 'Unknown' : DASH
  return r.agedUnits ? `${r.oldestAgeBucket} · ${fmtInt(r.agedUnits)} aged` : r.oldestAgeBucket
}

function capacityText(r: HealthRow): string {
  if (r.capacityUsedCm3 != null) return fmtVolume(r.capacityUsedCm3)
  return r.physicalFbaUnits > 0 ? 'VOLUME DATA MISSING' : DASH
}

function HealthTab({ refreshKey }: { refreshKey: number }) {
  const [filter, setFilter] = useState<HealthFilter>('active')
  const [healthStatus, setHealthStatus] = useState<HealthStatus | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetcher = useCallback(() => getKsaInventoryHealth({ filter, healthStatus, search, limit: 1000 }), [filter, healthStatus, search])
  const { data, loading, error } = useLoader<InventoryHealthResponse>(fetcher, refreshKey)

  return (
    <section className="ainv-panel overflow-hidden p-0">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <FilterButtons options={HEALTH_FILTERS} value={filter} onChange={(v) => { setFilter(v); setHealthStatus('') }} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="ainv-label">
              Health status
              <select className="ainv-input" value={healthStatus} onChange={(e) => setHealthStatus(e.target.value as HealthStatus | '')}>
                <option value="">All statuses</option>
                {HEALTH_STATUSES.map((s) => <option key={s} value={s}>{HEALTH_LABEL[s]}{data ? ` (${fmtInt(data.healthCounts[s])})` : ''}</option>)}
              </select>
            </label>
            <label className="ainv-label">
              Search SKU / ASIN / product
              <input className="ainv-input w-64" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </label>
          </div>
        </div>
        {data ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {HEALTH_STATUSES.map((s) => (
              <button key={s} type="button" className="ainv-btn" onClick={() => setHealthStatus(healthStatus === s ? '' : s)} aria-pressed={healthStatus === s}>
                <HealthBadge status={s} /> {fmtInt(data.healthCounts[s])}
              </button>
            ))}
          </div>
        ) : null}
        {data ? (
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {filter === 'active'
              ? 'Showing ACTIVE Amazon listings only (operational inventory). UNKNOWN or not-refreshed statuses are not treated as active.'
              : filter === 'inactive_with_stock'
                ? 'Listings that are not ACTIVE but still hold FBA stock — high-priority removal candidates (recommendation only).'
                : filter === 'suppressed'
                  ? 'Search-suppressed listings.'
                  : 'Every SKU in the SKU master, whatever its listing status.'}{' '}
            Listing status refreshed {fmtDateTime(data.listingStatusRefreshedAt)} · FBA snapshot {fmtDateTime(data.inventorySnapshotAt)}.
            {data.salesHistoryNote ? ` ${data.salesHistoryNote}` : ''} {data.marginNote}
          </p>
        ) : null}
      </div>
      {error ? <div className="ainv-banner ainv-banner--rose mx-4 mb-3">{error}</div> : null}
      {loading && !data ? (
        <Empty text="Loading inventory health…" />
      ) : data && data.rows.length ? (
        <>
          <div className="ainv-table-wrap overflow-x-auto">
            <table className="ainv-table w-full min-w-[140rem] text-left text-sm">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>ASIN</th>
                  <th>Product</th>
                  <th>Listing</th>
                  <th className="text-right">Fulfillable</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Inbound</th>
                  <th className="text-right">Unfulfillable</th>
                  <th className="text-right">Researching</th>
                  <th className="text-right">7D Sales</th>
                  <th className="text-right">30D Sales</th>
                  <th className="text-right">90D Sales</th>
                  <th className="text-right">7D Velocity</th>
                  <th className="text-right">30D Velocity</th>
                  <th className="text-right">Days of Cover</th>
                  <th>Inventory Age</th>
                  <th className="text-right">Warehouse Available</th>
                  <th className="text-right">Capacity Used</th>
                  <th>Mapping</th>
                  <th>Health Status</th>
                  <th>Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ainv-table__sku font-mono">{r.sellerSku}</td>
                    <td className="font-mono">{r.asin || DASH}</td>
                    <td className="max-w-xs truncate" title={r.title || ''}>{r.title || DASH}</td>
                    <td><ListingStatusBadge status={r.listingStatus} title={[r.listingStatusRaw && `Amazon: ${r.listingStatusRaw}`, r.listingStatusReason].filter(Boolean).join(' — ')} /></td>
                    <td className="text-right">{fmtInt(r.fulfillable)}</td>
                    <td className="text-right">{fmtInt(r.reserved)}</td>
                    <td className="text-right">{fmtInt(r.inbound)}</td>
                    <td className="text-right">{fmtInt(r.unfulfillable)}</td>
                    <td className="text-right">{fmtInt(r.researching)}</td>
                    <td className="text-right">{fmtInt(r.units7d)}</td>
                    <td className="text-right" title={r.sales30Source ? SALES_SOURCE_LABEL[r.sales30Source] : 'Unknown'}>{fmtInt(r.units30d)}</td>
                    <td className="text-right" title={r.sales90Source ? SALES_SOURCE_LABEL[r.sales90Source] : 'Unknown — insufficient history'}>
                      {fmtInt(r.units90d)}
                      {r.sales90Source === 'AMAZON_PLANNING_UNITS_SHIPPED' ? <sup title="Amazon planning report">A</sup> : null}
                    </td>
                    <td className="text-right">{fmtNum(r.velocity7d, 2)}</td>
                    <td className="text-right">{fmtNum(r.velocity30d, 2)}</td>
                    <td className="text-right">{r.daysOfCover == null ? DASH : fmtInt(r.daysOfCover)}</td>
                    <td className="text-xs" title={r.ageSnapshotDate ? `Amazon age snapshot ${r.ageSnapshotDate}` : undefined}>{ageText(r)}</td>
                    <td className="text-right">{r.warehouseAvailable == null ? <span className="ainv-table__muted" title={`Mapping: ${r.mappingIndicator}`}>{DASH}</span> : fmtInt(r.warehouseAvailable)}</td>
                    <td className="text-right text-xs" title={r.volumeSource ? `Volume source: ${humanize(r.volumeSource)}` : undefined}>{capacityText(r)}</td>
                    <td><MappingIndicatorBadge indicator={r.mappingIndicator} /></td>
                    <td><HealthBadge status={r.healthStatus} title={[r.healthReason, ...r.flags.map(humanize)].join(' · ')} /></td>
                    <td className="max-w-xs text-xs">{r.recommendedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.rows.length ? <p className="p-4 text-xs" style={{ color: 'var(--text-dim)' }}>Showing first {data.rows.length} of {fmtInt(data.total)}. Narrow with filters or search.</p> : null}
        </>
      ) : data ? (
        <Empty text={data.listingStatusRefreshedAt ? 'No SKUs match this filter.' : 'Listing status has not been refreshed yet — run Refresh Capacity & Health.'} />
      ) : null}
    </section>
  )
}

function InactiveTab({ refreshKey }: { refreshKey: number }) {
  const { data, loading, error } = useLoader<InactiveWithStockResponse>(getKsaInactiveWithStock, refreshKey)
  return (
    <>
      {error ? <div className="ainv-banner ainv-banner--rose">{error}</div> : null}
      {data ? (
        <>
          <div className="ainv-banner ainv-banner--amber" role="note">
            INACTIVE LISTINGS WITH FBA STOCK. These units take FBA capacity but cannot sell. High-priority removal candidates —
            recommendations only; removals are created by a person in Seller Central. Listings and their history are never deleted here.
          </div>
          <section className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Inactive SKUs with FBA stock" value={fmtInt(data.summary.skus)} tone={data.summary.skus ? 'warn' : undefined} />
            <Kpi label="Units in inactive SKUs" value={fmtInt(data.summary.units)} hint="On-hand + inbound" />
            <Kpi
              label="Estimated capacity wasted"
              value={data.summary.estimatedCapacityCm3 == null ? 'VOLUME DATA MISSING' : fmtVolume(data.summary.estimatedCapacityCm3)}
              hint={`Volume coverage ${fmtPct(data.summary.coveragePct)}`}
              meta={<SourceMeta source={data.summary.source} asOf={data.inventorySnapshotAt} confidence={data.summary.confidence} />}
            />
          </section>
        </>
      ) : null}
      <section className="ainv-panel overflow-hidden p-0">
        <SectionHeader title="Inactive listings with FBA stock" total={data?.rows.length} shown={data?.rows.length} note={data ? `Listing status refreshed ${fmtDateTime(data.listingStatusRefreshedAt)}` : undefined} />
        {loading && !data ? (
          <Empty text="Loading…" />
        ) : data && data.rows.length ? (
          <div className="ainv-table-wrap overflow-x-auto">
            <table className="ainv-table w-full min-w-[110rem] text-left text-sm">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>ASIN</th>
                  <th>Product</th>
                  <th>Listing status</th>
                  <th>Amazon status / reason</th>
                  <th className="text-right">Fulfillable</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Unfulfillable</th>
                  <th className="text-right">Inbound</th>
                  <th>Inventory Age</th>
                  <th>Last Sale</th>
                  <th className="text-right">30D Sales</th>
                  <th className="text-right">90D Sales</th>
                  <th className="text-right">Potential Capacity Used</th>
                  <th>Mapping</th>
                  <th>Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ainv-table__sku font-mono">{r.sellerSku}</td>
                    <td className="font-mono">{r.asin || DASH}</td>
                    <td className="max-w-xs truncate" title={r.title || ''}>{r.title || DASH}</td>
                    <td><ListingStatusBadge status={r.listingStatus} /></td>
                    <td className="max-w-sm text-xs">
                      {r.listingStatusRaw || DASH}
                      {r.listingStatusReason ? <div className="opacity-70">{r.listingStatusReason}</div> : null}
                      {r.inferredReason ? <div className="opacity-70">{r.inferredReason}</div> : null}
                    </td>
                    <td className="text-right">{fmtInt(r.fulfillable)}</td>
                    <td className="text-right">{fmtInt(r.reserved)}</td>
                    <td className="text-right">{fmtInt(r.unfulfillable)}</td>
                    <td className="text-right">{fmtInt(r.inbound)}</td>
                    <td className="text-xs" title={r.ageSnapshotDate ? `Amazon age snapshot ${r.ageSnapshotDate}` : undefined}>{ageText(r)}</td>
                    <td>{r.lastSaleDate ? fmtDate(r.lastSaleDate) : DASH}</td>
                    <td className="text-right" title={r.sales30Source ? SALES_SOURCE_LABEL[r.sales30Source] : 'Unknown'}>{fmtInt(r.units30d)}</td>
                    <td className="text-right" title={r.sales90Source ? SALES_SOURCE_LABEL[r.sales90Source] : 'Unknown — insufficient history'}>{fmtInt(r.units90d)}</td>
                    <td className="text-right text-xs" title={r.volumeSource ? `Volume source: ${humanize(r.volumeSource)}` : undefined}>{capacityText(r)}</td>
                    <td><MappingIndicatorBadge indicator={r.mappingIndicator} /></td>
                    <td className="max-w-xs text-xs">{r.recommendedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data ? (
          <Empty text={data.listingStatusRefreshedAt ? 'No inactive listing holds FBA stock.' : 'Listing status has not been refreshed yet — run Refresh Capacity & Health.'} />
        ) : null}
      </section>
    </>
  )
}

const REMOVAL_FILTERS: { value: RemovalStatusFilter; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
]

function RemovalsTab({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<RemovalStatusFilter>('OPEN')
  const fetcher = useCallback(() => getKsaRemovalOrders(status), [status])
  const { data, loading, error } = useLoader<RemovalOrdersResponse>(fetcher, refreshKey)
  const counts = data ? { ...data.counts, ALL: Object.values(data.counts).reduce((a, b) => a + b, 0) } : undefined
  return (
    <section className="ainv-panel overflow-hidden p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <FilterButtons<RemovalStatusFilter> options={REMOVAL_FILTERS} value={status} onChange={setStatus} counts={counts} />
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
          Read-only from Amazon ({data?.source || 'removal order detail report'}). {data?.completedFormula} Removal orders are never created from this app.
        </p>
      </div>
      {error ? <div className="ainv-banner ainv-banner--rose mx-4 mb-3">{error}</div> : null}
      {loading && !data ? (
        <Empty text="Loading removal orders…" />
      ) : data && data.rows.length ? (
        <div className="ainv-table-wrap overflow-x-auto">
          <table className="ainv-table w-full min-w-[100rem] text-left text-sm">
            <thead>
              <tr>
                <th>Removal ID</th>
                <th>Date</th>
                <th>SKU</th>
                <th>Product</th>
                <th>FNSKU</th>
                <th className="text-right">Requested</th>
                <th className="text-right">Completed</th>
                <th className="text-right">Cancelled</th>
                <th>Status</th>
                <th>Reason / Disposition</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono">{r.removalOrderId}</td>
                  <td>{fmtDate(r.requestDate)}</td>
                  <td className="ainv-table__sku font-mono">{r.sellerSku}</td>
                  <td className="max-w-xs truncate" title={r.title || ''}>{r.title || DASH}</td>
                  <td className="font-mono">{r.fnsku || DASH}</td>
                  <td className="text-right">{fmtInt(r.requestedQuantity)}</td>
                  <td className="text-right" title={`Shipped ${fmtInt(r.shippedQuantity)} · disposed ${fmtInt(r.disposedQuantity)} · in process ${fmtInt(r.inProcessQuantity)}`}>{fmtInt(r.completedQuantity)}</td>
                  <td className="text-right">{fmtInt(r.cancelledQuantity)}</td>
                  <td>
                    <span className={`ainv-badge ${r.statusGroup === 'OPEN' ? 'ainv-badge--warn' : r.statusGroup === 'COMPLETED' ? 'ainv-badge--ok' : 'ainv-badge--neutral'}`}>{r.statusGroup}</span>
                    {r.orderStatus && r.orderStatus.toUpperCase() !== r.statusGroup ? <div className="text-xs opacity-70">Amazon: {r.orderStatus}</div> : null}
                  </td>
                  <td className="text-xs">{[r.orderType, r.disposition].filter(Boolean).join(' · ') || DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data ? (
        <Empty text={counts && counts.ALL === 0 ? 'No removal orders loaded yet — run Refresh Capacity & Health.' : 'No removal orders with this status.'} />
      ) : null}
    </section>
  )
}

function ReleaseTab({ refreshKey }: { refreshKey: number }) {
  const { data, loading, error } = useLoader<CapacityReleaseResponse>(getKsaCapacityRelease, refreshKey)
  return (
    <>
      {error ? <div className="ainv-banner ainv-banner--rose">{error}</div> : null}
      {data ? (
        <>
          <div className="ainv-banner ainv-banner--amber" role="note">{data.note}</div>
          <section className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Opportunities" value={fmtInt(data.summary.opportunities)} />
            <Kpi label="Potential removal quantity" value={fmtInt(data.summary.potentialRemovalQty)} hint="Largest single-reason quantity per SKU (never summed across reasons)" />
            <Kpi
              label="Potential capacity released"
              value={data.summary.potentialCapacityReleasedCm3 == null ? 'VOLUME DATA MISSING' : fmtVolume(data.summary.potentialCapacityReleasedCm3)}
              hint={data.summary.volumeMissing ? `${fmtInt(data.summary.volumeMissing)} opportunities have VOLUME DATA MISSING (not counted)` : 'Shown only — not allocated to replenishment'}
              meta={<SourceMeta source={data.summary.source} asOf={data.inventorySnapshotAt} confidence={data.summary.confidence} />}
            />
          </section>
        </>
      ) : null}
      <section className="ainv-panel overflow-hidden p-0">
        <SectionHeader title="Capacity release opportunities (ranked)" total={data?.rows.length} shown={data?.rows.length} note="Inactive listings with Amazon stock first, then unfulfillable, zero sales, aged, excess cover, very low velocity." />
        {loading && !data ? (
          <Empty text="Loading…" />
        ) : data && data.rows.length ? (
          <div className="ainv-table-wrap overflow-x-auto">
            <table className="ainv-table w-full min-w-[110rem] text-left text-sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Listing</th>
                  <th>Priority</th>
                  <th>Reasons</th>
                  <th className="text-right">FBA units</th>
                  <th className="text-right">30D / 90D sales</th>
                  <th className="text-right">Potential removal qty</th>
                  <th className="text-right">Potential capacity released</th>
                  <th>Confidence</th>
                  <th>Mapping</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.sellerSku}>
                    <td className="font-mono">{i + 1}</td>
                    <td className="ainv-table__sku font-mono">{r.sellerSku}</td>
                    <td className="max-w-xs truncate" title={r.title || ''}>{r.title || DASH}</td>
                    <td><ListingStatusBadge status={r.listingStatus} /></td>
                    <td><span className={`ainv-badge ${r.priority === 'HIGH' ? 'ainv-badge--danger' : 'ainv-badge--warn'}`}>{humanize(r.priority)}</span></td>
                    <td className="max-w-sm text-xs">
                      {r.reasons.map((x) => (
                        <div key={x.reason}><strong>{REASON_LABEL[x.reason] || humanize(x.reason)}</strong> — {x.detail}</div>
                      ))}
                    </td>
                    <td className="text-right">{fmtInt(r.fbaUnits)}</td>
                    <td className="text-right">{fmtInt(r.units30d)} / {fmtInt(r.units90d)}</td>
                    <td className="text-right">{fmtInt(r.potentialRemovalQty)}</td>
                    <td className="text-right text-xs">{r.potentialCapacityReleasedCm3 == null ? 'VOLUME DATA MISSING' : fmtVolume(r.potentialCapacityReleasedCm3)}</td>
                    <td>{r.confidence}</td>
                    <td><MappingIndicatorBadge indicator={r.mappingIndicator} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data ? (
          <Empty text="No capacity release opportunities with the current thresholds." />
        ) : null}
      </section>
    </>
  )
}

const ACTION_FILTERS: { value: 'OPEN' | 'RESOLVED' | 'ALL'; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'ALL', label: 'All' },
]

function ActionsTab({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | 'ALL'>('OPEN')
  const fetcher = useCallback(() => getKsaActions(status), [status])
  const { data, loading, error } = useLoader<ActionsResponse>(fetcher, refreshKey)
  return (
    <section className="ainv-panel overflow-hidden p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <FilterButtons<'OPEN' | 'RESOLVED' | 'ALL'> options={ACTION_FILTERS} value={status} onChange={setStatus} />
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
          One row per issue (stable key); actions resolve automatically when the condition clears. Recommendations only.
        </p>
      </div>
      {error ? <div className="ainv-banner ainv-banner--rose mx-4 mb-3">{error}</div> : null}
      {loading && !data ? (
        <Empty text="Loading actions…" />
      ) : data && data.actions.length ? (
        <div className="ainv-table-wrap overflow-x-auto">
          <table className="ainv-table w-full min-w-[80rem] text-left text-sm">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Action</th>
                <th>Detail</th>
                <th>Type</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.actions.map((a) => (
                <tr key={a.actionKey}>
                  <td><span className={`ainv-badge ${a.severity === 'CRITICAL' || a.severity === 'HIGH' ? 'ainv-badge--danger' : a.severity === 'MEDIUM' ? 'ainv-badge--warn' : 'ainv-badge--neutral'}`}>{a.severity}</span></td>
                  <td>{a.title}</td>
                  <td className="max-w-lg text-xs">{a.detail || DASH}</td>
                  <td className="text-xs">{humanize(a.actionType)}</td>
                  <td className="text-xs">{fmtDateTime(a.firstSeenAt)}</td>
                  <td className="text-xs">{fmtDateTime(a.lastSeenAt)}</td>
                  <td className="text-xs">{a.status}{a.resolvedAt ? ` · ${fmtDateTime(a.resolvedAt)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data ? (
        <Empty text={status === 'OPEN' ? 'No open actions.' : 'No actions.'} />
      ) : null}
    </section>
  )
}

export default function AmazonKsaInventoryHealthPage() {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as TabKey | null
  const tab: TabKey = tabParam && TABS.some((t) => t.key === tabParam) ? tabParam : 'health'
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useRefreshRun({ watchJobTypes: ['refresh_health', 'refresh_all'], onFinished: () => setRefreshKey((k) => k + 1) })

  return (
    <div className="ainv-page mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ainv-page__eyebrow ainv-page__eyebrow--amber">Amazon KSA · Control Tower</p>
          <h1 className="ainv-page__title">Inventory Health</h1>
          <p className="ainv-page__lead">
            Health of ACTIVE Amazon KSA listings, inactive listings still holding FBA stock, removal orders (read-only) and capacity release
            recommendations. Nothing here changes Amazon listings, inventory or removals.{' '}
            <Link className="ainv-link-emerald" to="/amazon-ksa/capacity">Capacity →</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ainv-btn" onClick={() => setRefreshKey((k) => k + 1)}>Reload</button>
          <button type="button" className="ainv-btn ainv-btn--primary-sky" onClick={() => void refresh.start('refresh_health')} disabled={refresh.busy}>
            {refresh.busy ? 'Refreshing…' : 'Refresh Capacity & Health'}
          </button>
        </div>
      </header>

      {refresh.error ? <div className="ainv-banner ainv-banner--rose">{refresh.error}</div> : null}
      {refresh.run ? <RunProgress run={refresh.run} /> : null}

      <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Inventory health views">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`ainv-btn ${tab === t.key ? 'ainv-btn--primary-sky' : ''}`}
            onClick={() => setParams(t.key === 'health' ? {} : { tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'health' ? <HealthTab refreshKey={refreshKey} /> : null}
      {tab === 'inactive' ? <InactiveTab refreshKey={refreshKey} /> : null}
      {tab === 'removals' ? <RemovalsTab refreshKey={refreshKey} /> : null}
      {tab === 'release' ? <ReleaseTab refreshKey={refreshKey} /> : null}
      {tab === 'actions' ? <ActionsTab refreshKey={refreshKey} /> : null}
    </div>
  )
}
