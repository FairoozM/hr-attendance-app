import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getKsaCommandCenter, type CommandCenterResponse, type StockRow } from '../../api/amazonControlTower'
import { useRefreshRun } from './useRefreshRun'
import {
  DASH,
  Empty,
  FreshnessBadge,
  Kpi,
  ListingStatusBadge,
  MappingBadge,
  RunProgress,
  SectionHeader,
  SourceMeta,
  fmtAge,
  fmtDateTime,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtVolume,
} from './controlTowerUi'
import '../../styles/amazonInventoryPage.css'

function StockTable({ rows, empty }: { rows: StockRow[]; empty: string }) {
  if (!rows.length) return <Empty text={empty} />
  return (
    <div className="ainv-table-wrap overflow-x-auto">
      <table className="ainv-table w-full min-w-[60rem] text-left text-sm">
        <thead>
          <tr>
            <th>SKU</th>
            <th>ASIN</th>
            <th>Product</th>
            <th>Listing</th>
            <th className="text-right">FBA Fulfillable</th>
            <th className="text-right">Inbound</th>
            <th className="text-right">Warehouse Available</th>
            <th className="text-right">7D Units</th>
            <th className="text-right">30D Units</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="ainv-table__sku font-mono">{r.sellerSku}</td>
              <td className="font-mono">{r.asin || DASH}</td>
              <td className="max-w-md truncate" title={r.title || ''}>{r.title || DASH}</td>
              <td><ListingStatusBadge status={r.listingStatus} /></td>
              <td className="text-right">{fmtInt(r.fbaFulfillable)}</td>
              <td className="text-right">{fmtInt(r.inbound)}</td>
              <td className="text-right" title={r.warehouseAvailable == null ? `Mapping: ${r.mappingStatus}` : undefined}>
                {r.warehouseAvailable == null ? <span className="ainv-table__muted">{DASH}</span> : fmtInt(r.warehouseAvailable)}
              </td>
              <td className="text-right">{fmtInt(r.units7d)}</td>
              <td className="text-right">{fmtInt(r.units30d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AmazonKsaCommandCenterPage() {
  const [data, setData] = useState<CommandCenterResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await getKsaCommandCenter())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useRefreshRun({ watchJobTypes: ['refresh_all'], onFinished: () => void load() })

  const k = data?.kpis
  const cur = data?.currency || 'SAR'
  const salesHint = data && k?.todaySales == null ? 'No daily sales rollup yet' : undefined
  const fbaUnverified = data?.inventorySource?.fulfillmentModel !== 'FBA'
  const zeroStockTitle = fbaUnverified ? 'Zero FBA Fulfillable (unverified)' : 'Out of Stock'
  const lowStockTitle = fbaUnverified ? 'Low FBA Fulfillable' : 'Low Stock'
  const salesLabel = (base: string) => `${base} (${cur})${data?.salesProvisional ? ' · provisional' : ''}`
  const statusKnown = data?.listingStatus?.known === true
  const activeBasisHint = statusKnown ? 'Amazon listing status ACTIVE' : 'Needs listing status refresh'

  return (
    <div className="ainv-page mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ainv-page__eyebrow ainv-page__eyebrow--amber">Amazon KSA · Control Tower</p>
          <h1 className="ainv-page__title">Command Center</h1>
          <p className="ainv-page__lead">
            Read-only view of Amazon KSA sales, FBA inventory and Life Smile warehouse stock. Refreshing only reads from Amazon
            and Zoho and writes to this app&apos;s database.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ainv-btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <button
            type="button"
            className="ainv-btn ainv-btn--primary-sky"
            onClick={() => void refresh.start('refresh_all')}
            disabled={refresh.busy}
          >
            {refresh.busy ? 'Refreshing…' : 'Refresh All'}
          </button>
        </div>
      </header>

      {refresh.error ? <div className="ainv-banner ainv-banner--rose">{refresh.error}</div> : null}
      {refresh.run ? <RunProgress run={refresh.run} /> : null}
      {error ? <div className="ainv-banner ainv-banner--rose">{error}</div> : null}

      {data && k ? (
        <>
          {fbaUnverified && data.inventorySource ? (
            <div className="ainv-banner ainv-banner--amber" role="note">
              Stock source: {data.inventorySource.source}. {data.inventorySource.caveat}
            </div>
          ) : null}
          {!statusKnown ? (
            <div className="ainv-banner ainv-banner--amber" role="note">
              Amazon listing status has not been refreshed yet, so active stock is unknown and no SKU is treated as active. Run
              Refresh Capacity &amp; Health (Capacity page) or Refresh listing status (Settings).
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Active Amazon KSA stock and inactive listing warnings">
            <Kpi
              label="Active Amazon KSA Stock"
              value={fmtInt(k.activeAmazonStockUnits)}
              hint="Units at or inbound to Amazon for ACTIVE listings only (fulfillable + reserved + researching + unfulfillable + inbound)"
            />
            <Kpi
              label="Inactive SKUs with FBA Stock"
              value={fmtInt(k.inactiveSkusWithFbaStock)}
              tone={k.inactiveSkusWithFbaStock ? 'warn' : undefined}
              hint={statusKnown ? 'Not ACTIVE on Amazon but holding FBA units' : 'Needs listing status refresh'}
            />
            <Kpi
              label="Units in Inactive SKUs"
              value={fmtInt(k.unitsInInactiveSkus)}
              tone={k.unitsInInactiveSkus ? 'warn' : undefined}
              hint="Same unit definition — excluded from every active figure"
            />
            <Kpi
              label="Estimated Capacity Wasted by Inactive Stock"
              value={k.estimatedCapacityWastedByInactive ? fmtVolume(k.estimatedCapacityWastedByInactive.volumeCm3) : DASH}
              tone={k.estimatedCapacityWastedByInactive?.volumeCm3 ? 'warn' : undefined}
              hint={k.estimatedCapacityWastedByInactive ? `Volume coverage ${fmtPct(k.estimatedCapacityWastedByInactive.coveragePct)}` : undefined}
              meta={
                k.estimatedCapacityWastedByInactive ? (
                  <SourceMeta source={k.estimatedCapacityWastedByInactive.source} asOf={k.estimatedCapacityWastedByInactive.asOf} confidence={k.estimatedCapacityWastedByInactive.confidence} />
                ) : null
              }
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <Kpi label={salesLabel('Today Sales')} value={fmtMoney(k.todaySales, cur)} hint={salesHint || `Riyadh date ${data.today}`} />
            <Kpi label={salesLabel('Yesterday Sales')} value={fmtMoney(k.yesterdaySales, cur)} />
            <Kpi label={salesLabel('7D Sales')} value={fmtMoney(k.last7DaysSales, cur)} />
            <Kpi label={salesLabel('30D Sales')} value={fmtMoney(k.last30DaysSales, cur)} />
            <Kpi label="Units Sold 30D" value={fmtInt(k.unitsSold30d)} />
            <Kpi label="Active KSA SKUs" value={fmtInt(k.activeSkus)} hint={activeBasisHint} />
            <Kpi label="Active FBA SKUs" value={fmtInt(k.activeFbaSkus)} hint={statusKnown ? undefined : 'Needs listing status refresh'} />
            <Kpi label="Active MFN SKUs" value={fmtInt(k.activeMfnSkus)} hint={statusKnown ? undefined : 'Needs listing status refresh'} />
            <Kpi
              label="Active FBA Fulfillable"
              value={fmtInt(k.fbaFulfillableUnits)}
              hint={data.snapshots.inventorySnapshotAt ? `Snapshot ${fmtDateTime(data.snapshots.inventorySnapshotAt)}` : 'No FBA snapshot yet'}
            />
            <Kpi label="Active FBA Inbound" value={fmtInt(k.inboundUnits)} />
            <Kpi label="Active FBA Reserved" value={fmtInt(k.reservedUnits)} />
            <Kpi label="Active FBA Unfulfillable" value={fmtInt(k.unfulfillableUnits)} />
            <Kpi
              label={fbaUnverified ? 'Zero FBA Fulfillable SKUs' : 'Out-of-Stock SKUs'}
              value={fmtInt(k.outOfStockSkus)}
              hint={fbaUnverified ? 'Unverified — may be Seller Flex' : undefined}
            />
            <Kpi
              label={fbaUnverified ? 'Low FBA Fulfillable SKUs' : 'Low-Stock SKUs'}
              value={fmtInt(k.lowStockSkus)}
              hint={`≤ ${data.tables.lowStock.threshold} fulfillable units`}
            />
            <Kpi label="Unmapped SKUs" value={fmtInt(k.unmappedSkus)} hint="Unmapped or review required" />
          </section>

          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {statusKnown
              ? `Operational KPIs count ACTIVE Amazon listings only (listing status refreshed ${fmtDateTime(data.listingStatus?.refreshedAt)}). UNKNOWN is never treated as active.`
              : 'Listing status has not been refreshed yet: active KPIs and tables stay empty until it runs.'}{' '}
            {data.physicalAllListings
              ? `All listings, physical at Amazon (capacity view): ${fmtInt(data.physicalAllListings.fulfillable)} fulfillable · ${fmtInt(data.physicalAllListings.reserved)} reserved · ${fmtInt(data.physicalAllListings.unfulfillable)} unfulfillable · ${fmtInt(data.physicalAllListings.inbound)} inbound.`
              : ''}{' '}
            <Link className="ainv-link-emerald" to="/amazon-ksa/inventory-health?tab=inactive">Inactive listings with FBA stock →</Link>{' '}
            <Link className="ainv-link-emerald" to="/amazon-ksa/capacity">Capacity →</Link>
            {data.listingStatus?.error ? ` Listing status summary unavailable: ${data.listingStatus.error}` : ''}
          </p>

          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            Sales: {data.salesBasis} Days follow {data.timezone}.
            {data.salesProvisional && data.salesCaveat ? ` ${data.salesCaveat}` : ''}
            {data.coverage.dailySales.firstDate
              ? ` Sales history in this app: ${data.coverage.dailySales.firstDate} to ${data.coverage.dailySales.lastDate}.`
              : ''}
            {k.activeSkusWithoutFbaData ? ` ${fmtInt(k.activeSkusWithoutFbaData)} active SKUs have no FBA inventory row (e.g. merchant-fulfilled).` : ''}
          </p>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="Data Freshness" total={data.freshness.sources.length} shown={data.freshness.sources.length} />
            <div className="ainv-table-wrap overflow-x-auto">
              <table className="ainv-table w-full min-w-[48rem] text-left text-sm">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Last Success</th>
                    <th>Age</th>
                    <th>Status</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.freshness.sources.map((s) => (
                    <tr key={s.key}>
                      <td>
                        {s.label}
                        {s.currentRun ? <span className="ml-2 text-xs opacity-70">({s.currentRun.status}…)</span> : null}
                      </td>
                      <td>{fmtDateTime(s.lastSuccessAt)}</td>
                      <td>{fmtAge(s.ageMs)}</td>
                      <td><FreshnessBadge status={s.status} /></td>
                      <td className="max-w-lg text-xs" style={{ color: 'var(--text-muted)' }}>{s.lastError || DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader
              title={zeroStockTitle}
              total={data.tables.outOfStock.total}
              shown={data.tables.outOfStock.rows.length}
              note={
                fbaUnverified
                  ? 'Active SKUs where the FBA Inventory API reports 0 fulfillable units, sorted by 30-day units. Not confirmed out of stock until the fulfillment model is verified.'
                  : 'Active SKUs with 0 FBA fulfillable units, sorted by 30-day units.'
              }
            />
            <StockTable
              rows={data.tables.outOfStock.rows}
              empty={k.outOfStockSkus == null ? 'No FBA inventory snapshot yet.' : 'No active SKU reports 0 FBA fulfillable.'}
            />
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader
              title={lowStockTitle}
              total={data.tables.lowStock.total}
              shown={data.tables.lowStock.rows.length}
              note={`FBA fulfillable between 1 and ${data.tables.lowStock.threshold} units (Settings → low stock threshold).`}
            />
            <StockTable rows={data.tables.lowStock.rows} empty={k.lowStockSkus == null ? 'No FBA inventory snapshot yet.' : 'No active SKU is below the threshold.'} />
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader
              title="Unmapped SKUs"
              total={data.tables.unmapped.total}
              shown={data.tables.unmapped.rows.length}
              note="Confirm mappings in Settings / SKU Mapping."
            />
            {data.tables.unmapped.rows.length ? (
              <div className="ainv-table-wrap overflow-x-auto">
                <table className="ainv-table w-full min-w-[60rem] text-left text-sm">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>ASIN</th>
                      <th>Product</th>
                      <th>Potential Match</th>
                      <th className="text-right">Confidence</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tables.unmapped.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="ainv-table__sku font-mono">{r.sellerSku}</td>
                        <td className="font-mono">{r.asin || DASH}</td>
                        <td className="max-w-md truncate" title={r.title || ''}>{r.title || DASH}</td>
                        <td>
                          {r.potentialMatch ? (
                            <span>
                              <span className="font-mono">{r.potentialMatch.itemCode || r.potentialMatch.zohoItemId}</span>
                              {r.candidateCount > 1 ? <span className="ml-1 text-xs opacity-70">+{r.candidateCount - 1} more</span> : null}
                            </span>
                          ) : (
                            DASH
                          )}
                        </td>
                        <td className="text-right">{r.confidence == null ? DASH : `${Math.round(r.confidence * 100)}%`}</td>
                        <td><MappingBadge status={r.mappingStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="Every active SKU is mapped." />
            )}
            <div className="px-4 pb-4 pt-2 text-sm">
              <Link className="ainv-link-emerald" to="/amazon-ksa/settings/sku-mapping">Open SKU Mapping →</Link>
            </div>
          </section>
        </>
      ) : loading ? (
        <Empty text="Loading Command Center…" />
      ) : null}
    </div>
  )
}
